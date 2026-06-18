// POST /api/mutation → SSE: scenario → mutant|fault* → summary → [comparison] → done
// 单场景变异测试，layer(spec/trace) × judge(lenient/strict/both)。both=跑一次基线+两判官复用+compareJudges。

import { Hono } from "hono";
import { runScenario, type ScenarioRunResult } from "../../src/agent/runner/runScenario";
import { resetAccountLanguage } from "../../src/agent/runner/resetState";
import { runMutation, type ScenarioMutationReport } from "../../src/agent/mutation/runMutation";
import { runMutationTrace, type ScenarioFaultReport } from "../../src/agent/mutation/runMutationTrace";
import {
  summarizeMutation,
  summarizeScored,
  compareJudges,
  scoredFromMutationReports,
  type ScoredScenario,
} from "../../src/agent/mutation/report";
import { loadScenarioSet } from "../../src/scenarioStore";
import { sseStream, type Emit } from "../lib/sse";
import { tryAcquire, release } from "../lib/lock";
import type { JudgeMode } from "../../src/agent/verify/judge";
import type { TestScenario } from "../../src/schemas";

const app = new Hono();
type Layer = "spec" | "trace";

async function runOne(
  layer: Layer,
  sc: TestScenario,
  mode: JudgeMode,
  maxSteps: number,
  baseline: ScenarioRunResult | undefined,
  emit: Emit,
): Promise<ScenarioMutationReport | ScenarioFaultReport> {
  const onScenario = (_sid: string, pass: boolean, n: number) =>
    void emit("scenario", { mode, baselinePass: pass, count: n });
  if (layer === "spec") {
    return runMutation(sc, {
      maxSteps,
      judgeMode: mode,
      baselineOverride: baseline,
      onScenario,
      onMutant: (i, t, r) =>
        void emit("mutant", {
          mode,
          index: i,
          total: t,
          operatorId: r.mutant.operatorId,
          category: r.mutant.category,
          description: r.mutant.description,
          killed: r.killed,
        }),
    });
  }
  return runMutationTrace(sc, {
    maxSteps,
    judgeMode: mode,
    baselineOverride: baseline,
    onScenario,
    onFault: (i, t, r) =>
      void emit("fault", {
        mode,
        index: i,
        total: t,
        operatorId: r.fault.operatorId,
        category: r.fault.category,
        description: r.fault.description,
        killed: r.killed,
      }),
  });
}

// trace report → ScoredScenario（CLI run-mutation 的 scoredOf 逻辑）
function scoredFromTrace(rep: ScenarioFaultReport): ScoredScenario {
  return {
    scenarioId: rep.scenarioId,
    featureId: rep.featureId,
    skipped: rep.skipped,
    items: rep.skipped
      ? []
      : rep.results.map((r) => ({
          id: r.fault.id,
          category: r.fault.category,
          operatorId: r.fault.operatorId,
          description: r.fault.description,
          detail: r.fault.detail,
          killed: r.killed,
          reason: r.verdict.reason,
        })),
  };
}

function summarizeOne(layer: Layer, r: ScenarioMutationReport | ScenarioFaultReport) {
  return layer === "spec"
    ? summarizeMutation([r as ScenarioMutationReport])
    : summarizeScored("trace", [scoredFromTrace(r as ScenarioFaultReport)]);
}
function scoredOne(layer: Layer, r: ScenarioMutationReport | ScenarioFaultReport): ScoredScenario[] {
  return layer === "spec"
    ? scoredFromMutationReports([r as ScenarioMutationReport])
    : [scoredFromTrace(r as ScenarioFaultReport)];
}

app.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    scenarioId?: string;
    set?: string;
    layer?: Layer;
    judge?: JudgeMode | "both";
    maxSteps?: number;
  } | null;
  if (!body?.scenarioId) return c.json({ error: "scenarioId required" }, 400);
  const set = body.set ?? "basic";
  const { scenarios } = loadScenarioSet(set);
  const sc = scenarios.scenarios.find((s) => s.id === body.scenarioId);
  if (!sc) return c.json({ error: "scenario not found" }, 404);

  const layer: Layer = body.layer === "trace" ? "trace" : "spec";
  const judgeSel = body.judge === "strict" || body.judge === "both" ? body.judge : "lenient";
  const maxSteps = body.maxSteps ?? 20;

  if (!tryAcquire("mutation")) return c.json({ error: "another task is running" }, 409);

  return sseStream(c, async (emit) => {
    try {
      if (judgeSel === "both") {
        const ns = `mut-${sc.id}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        await emit("scenario", { mode: "baseline", baselinePass: false, count: 0, note: "跑基线（浏览器）…" });
        const baseline = await runScenario(sc, {
          maxSteps,
          headless: true,
          namespace: ns,
          cleanup: resetAccountLanguage,
        });
        await emit("scenario", { mode: "baseline", baselinePass: baseline.verdict.pass });
        const lr = await runOne(layer, sc, "lenient", maxSteps, baseline, emit);
        const sr = await runOne(layer, sc, "strict", maxSteps, baseline, emit);
        const comparison = compareJudges(
          layer,
          summarizeOne(layer, lr),
          summarizeOne(layer, sr),
          scoredOne(layer, lr),
          scoredOne(layer, sr),
        );
        await emit("comparison", comparison);
        await emit("done", { judge: "both", layer });
      } else {
        const r = await runOne(layer, sc, judgeSel, maxSteps, undefined, emit);
        await emit("summary", summarizeOne(layer, r));
        await emit("done", { judge: judgeSel, layer });
      }
    } catch (e) {
      await emit("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      release();
    }
  });
});

export default app;
