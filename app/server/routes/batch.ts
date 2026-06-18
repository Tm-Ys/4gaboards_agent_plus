// POST /api/batch → SSE: step*(带 scenarioId) → outcome → ... → done
// 批量执行选中场景（全量测试）。单账号串行，全局锁。

import { Hono } from "hono";
import { runBatch } from "../../src/agent/runner/runBatch";
import { loadScenarioSet } from "../../src/scenarioStore";
import { sseStream } from "../lib/sse";
import { tryAcquire, release } from "../lib/lock";

const app = new Hono();

app.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    ids?: string[];
    set?: string;
    maxSteps?: number;
  } | null;
  const set = body?.set ?? "basic";
  const { scenarios } = loadScenarioSet(set);
  const want = body?.ids ?? scenarios.scenarios.map((s) => s.id);
  const list = scenarios.scenarios.filter((s) => want.includes(s.id));
  if (list.length === 0) return c.json({ error: "no scenarios selected" }, 400);

  if (!tryAcquire("run-batch")) return c.json({ error: "another task is running" }, 409);

  return sseStream(c, async (emit) => {
    try {
      const report = await runBatch(list, {
        maxSteps: body?.maxSteps ?? 20,
        onProgress: (i, total, o) =>
          void emit("outcome", {
            index: i,
            total,
            scenarioId: o.scenario.id,
            pass: o.result?.verdict.pass ?? false,
            error: o.error,
          }),
        onStep: (sid, step) => void emit("step", { scenarioId: sid, step }),
      });
      await emit("done", {
        total: report.total,
        pass: report.summary.pass,
        fail: report.summary.fail,
        passRate: report.summary.passRate,
      });
    } catch (e) {
      await emit("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      release();
    }
  });
});

export default app;
