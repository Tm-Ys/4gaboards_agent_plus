// CLI：P5 变异测试 → Mutation Score。两层 × 三判官档：
//   --layer spec   （默认）Layer 1：改 expectation，真跑正确 app，重判官（测判官对【规约级】错误的敏感度）。
//   --layer trace  Layer 2：往真实轨迹注入故障（执行异常/布局/语义），用原场景重判官（测判官对【行为级】故障的敏感度）。
//   --judge lenient（默认）| strict | both：判官严格档；both 并排对比两判官，量化宽松代价。
//
// 用法：
//   npm run run-mutation -- --scenario board-create-happy-path                  # Layer1·lenient 单场景
//   npm run run-mutation -- --layer trace --judge both                          # Layer2·两判官对比
//   npm run run-mutation -- --layer spec --judge both --feature board --limit 3
//
// both 模式：每场景跑一次基线（真浏览器），两判官复用同一 trace（baselineOverride，零浏览器）。
// 报告落 app/outputs/mutation/mutation-<ts>.json（gitignored）。

import fs from "node:fs";
import path from "node:path";
import { settings } from "../../config";
import { loadScenarioSet } from "../../scenarioStore";
import { parseArgs } from "../../cli";
import { runMutation, type ScenarioMutationReport } from "../mutation/runMutation";
import { runMutationTrace, type ScenarioFaultReport } from "../mutation/runMutationTrace";
import {
  summarizeMutation,
  summarizeScored,
  scoredFromMutationReports,
  scenarioSubtotal,
  compareJudges,
  type BucketScore,
  type MutationSummary,
  type ScoredScenario,
  type JudgeComparison,
} from "../mutation/report";
import { runScenario, type ScenarioRunResult } from "../runner/runScenario";
import { resetAccountLanguage } from "../runner/resetState";
import type { JudgeMode } from "../verify/judge";
import type { TestScenario } from "../../schemas";

// 开发期代表性子集：覆盖 board/card/list/view/settings/sidebar/notifications。
const DEFAULT_SUBSET = [
  "board-create-happy-path",
  "card-create-happy-path",
  "list-view-single-sort-1",
  "view-board-1",
  "settings-theme-1",
  "sidebar-toggle-1",
  "notifications-filter-happy-path",
];

const ZERO_BUCKET: BucketScore = { total: 0, killed: 0, survived: 0, score: 0 };

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
function fmtBucket(b: BucketScore): string {
  return `${b.killed}/${b.total}（${pct(b.score)}）`;
}
function bucketFromKilled(killed: number, total: number): BucketScore {
  return { total, killed, survived: total - killed, score: total ? killed / total : 0 };
}
function pp(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(0)}pp`;
}
function stamp(): string {
  return Date.now().toString(36);
}

type JudgeSel = "lenient" | "strict" | "both";

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const layer = args.layer === "trace" ? "trace" : "spec";
  const setName = typeof args.set === "string" ? args.set : "basic";
  const maxSteps = typeof args.maxSteps === "string" ? Number(args.maxSteps) || 20 : 20;
  const judge: JudgeSel = args.judge === "strict" || args.judge === "both" ? (args.judge as JudgeSel) : "lenient";
  const modes: JudgeMode[] = judge === "both" ? ["lenient", "strict"] : [judge];
  const { scenarios } = loadScenarioSet(setName);
  const byId = new Map(scenarios.scenarios.map((s) => [s.id, s]));

  // 选择场景
  const filter: Record<string, unknown> = { layer, judge };
  let ids: string[];
  if (typeof args.scenario === "string") {
    ids = [args.scenario];
    filter.scenario = args.scenario;
  } else if (typeof args.feature === "string") {
    ids = scenarios.scenarios.filter((s) => s.feature_id.startsWith(args.feature as string)).map((s) => s.id);
    filter.feature = args.feature;
  } else {
    ids = [...DEFAULT_SUBSET];
    filter.subset = "default";
  }
  if (typeof args.limit === "string") {
    const n = Number(args.limit) || ids.length;
    ids = ids.slice(0, n);
    filter.limit = n;
  }

  const list = ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const missing = ids.filter((id) => !byId.has(id));
  console.log(
    `▶ 变异测试 Layer ${layer === "spec" ? "1 (spec)" : "2 (trace)"}：集="${setName}" judge=${judge} maxSteps=${maxSteps}；${list.length} 个场景候选`,
  );
  console.log(`  过滤：${JSON.stringify(filter)}`);
  if (missing.length) console.log(`  ⚠ 未找到的场景：${missing.join(", ")}`);
  if (list.length === 0) return 0;
  console.log("");

  const t0 = Date.now();
  const specReports: Record<JudgeMode, ScenarioMutationReport[]> = { lenient: [], strict: [] };
  const traceRaw: Record<JudgeMode, ScenarioFaultReport[]> = { lenient: [], strict: [] };

  const tag = (mode: JudgeMode) => (judge === "both" ? `[${mode}] ` : "");

  // 单场景 × 单 mode 执行（spec/trace 分支），进度打印带 mode 前缀（both 时）。
  const runOneMode = async (sc: TestScenario, mode: JudgeMode, baseline?: ScenarioRunResult): Promise<void> => {
    if (layer === "spec") {
      const rep = await runMutation(sc, {
        maxSteps,
        judgeMode: mode,
        baselineOverride: baseline,
        onScenario: (_sid, pass, n) =>
          console.log(`  ${tag(mode)}基线 ${pass ? "✅ PASS" : "❌ FAIL"} → ${n} 个变异体`),
        onMutant: (idx, total, r) =>
          console.log(
            `    ${tag(mode)}[${idx}/${total}] ${r.mutant.operatorId.padEnd(16)} (${r.mutant.category.padEnd(8)}) ${r.mutant.description} → ${r.killed ? "💀 killed" : "🐸 survived"}`,
          ),
      });
      specReports[mode].push(rep);
      if (rep.skipped) console.log(`  ${tag(mode)}⏭ 跳过：${rep.skipReason}`);
      else console.log(`  ${tag(mode)}小计：killed ${fmtBucket(scenarioSubtotal(rep))}`);
    } else {
      const rep = await runMutationTrace(sc, {
        maxSteps,
        judgeMode: mode,
        baselineOverride: baseline,
        onScenario: (_sid, pass, n) =>
          console.log(`  ${tag(mode)}基线 ${pass ? "✅ PASS" : "❌ FAIL"} → ${n} 个故障`),
        onFault: (idx, total, r) =>
          console.log(
            `    ${tag(mode)}[${idx}/${total}] ${r.fault.operatorId.padEnd(16)} (${r.fault.category.padEnd(8)}) ${r.fault.description} → ${r.killed ? "💀 killed" : "🐸 survived"}`,
          ),
      });
      traceRaw[mode].push(rep);
      if (rep.skipped) console.log(`  ${tag(mode)}⏭ 跳过：${rep.skipReason}`);
      else {
        const k = rep.results.filter((r) => r.killed).length;
        console.log(`  ${tag(mode)}小计：killed ${fmtBucket(bucketFromKilled(k, rep.results.length))}`);
      }
    }
  };

  for (let i = 0; i < list.length; i++) {
    const sc = list[i]!;
    console.log(`[${i + 1}/${list.length}] ${sc.id} [${sc.difficulty}]`);

    if (judge === "both") {
      // both：跑一次基线（真浏览器），两 mode 复用（baselineOverride，零浏览器）。
      const ns = `mut-${sc.id}-${stamp()}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      let baseline: ScenarioRunResult | undefined;
      try {
        baseline = await runScenario(sc, {
          maxSteps,
          headless: true,
          namespace: ns,
          cleanup: resetAccountLanguage,
        });
      } catch (e) {
        console.log(`  ⚠ 基线运行异常：${e instanceof Error ? e.message : e}（两判官均跳过该场景）`);
      }
      if (baseline) {
        console.log(`  基线 ${baseline.verdict.pass ? "✅ PASS" : "❌ FAIL"}（两判官共享此 trace）`);
        for (const mode of modes) await runOneMode(sc, mode, baseline);
      }
    } else {
      await runOneMode(sc, modes[0]!);
    }
  }

  // 汇总 + 落盘
  const dir = path.join(settings.outputsDir, "mutation");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(dir, `mutation-${ts}.json`);
  const header = { startedAt: new Date().toISOString(), layer, setName, filter, maxSteps, judge };

  if (layer === "spec") {
    if (judge === "both") {
      const comparison = compareJudges(
        "spec",
        summarizeMutation(specReports.lenient),
        summarizeMutation(specReports.strict),
        scoredFromMutationReports(specReports.lenient),
        scoredFromMutationReports(specReports.strict),
      );
      printComparison(comparison, t0);
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          { ...header, summaries: { lenient: comparison.lenient, strict: comparison.strict }, comparison, reports: { lenient: specReports.lenient, strict: specReports.strict } },
          null,
          2,
        ),
        "utf-8",
      );
    } else {
      const summary = summarizeMutation(specReports[judge]);
      summary.judgeMode = judge;
      printSummary(summary, layer, t0);
      fs.writeFileSync(outPath, JSON.stringify({ ...header, summary, reports: specReports[judge] }, null, 2), "utf-8");
    }
  } else {
    // trace：CLI 构造 scored（含 skipped 场景，保 scenariosSkipped 计数准确）
    const scoredOf = (mode: JudgeMode): ScoredScenario[] =>
      traceRaw[mode].map((rep) => ({
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
      }));
    if (judge === "both") {
      const comparison = compareJudges(
        "trace",
        summarizeScored("trace", scoredOf("lenient")),
        summarizeScored("trace", scoredOf("strict")),
        scoredOf("lenient"),
        scoredOf("strict"),
      );
      printComparison(comparison, t0);
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          { ...header, summaries: { lenient: comparison.lenient, strict: comparison.strict }, comparison, reports: { lenient: traceRaw.lenient, strict: traceRaw.strict } },
          null,
          2,
        ),
        "utf-8",
      );
    } else {
      const summary = summarizeScored("trace", scoredOf(judge));
      summary.judgeMode = judge;
      printSummary(summary, layer, t0);
      fs.writeFileSync(outPath, JSON.stringify({ ...header, summary, reports: traceRaw[judge] }, null, 2), "utf-8");
    }
  }

  console.log(`\n💾 报告已写入：${outPath}`);
  return 0;
}

function printSummary(summary: MutationSummary, layer: "spec" | "trace", t0: number): void {
  console.log("\n" + "═".repeat(64));
  console.log(
    `场景：变异 ${summary.scenariosMutated} / 跳过 ${summary.scenariosSkipped} / 共 ${summary.scenariosTotal}  |  耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  const layerName = layer === "spec" ? "1 (spec·改 expectation)" : "2 (trace·注入故障)";
  const modeTag = summary.judgeMode ? `·${summary.judgeMode}` : "";
  console.log(`Mutation Score Layer ${layerName}${modeTag}（总体）：${fmtBucket(summary.overall)}`);
  const mk = summary.byCategory["must-kill"];
  const soft = summary.byCategory["soft"];
  if (mk) console.log(`  主指标 must-kill：${fmtBucket(mk)}`);
  if (soft) console.log(`  次指标 soft：${fmtBucket(soft)}（低 ≠ 缺陷，判官本就宽松）`);

  const fmtMap = (m: Record<string, BucketScore>) =>
    Object.entries(m)
      .map(([k, v]) => `${k} ${fmtBucket(v)}`)
      .join("，");
  if (Object.keys(summary.byOperator).length) console.log(`按算子：${fmtMap(summary.byOperator)}`);
  if (Object.keys(summary.byModule).length) console.log(`按模块：${fmtMap(summary.byModule)}`);

  if (summary.survived.length) {
    console.log(`\n存活（${summary.survived.length}，待人工核验 真漏检 vs 等价变异）：`);
    for (const s of summary.survived) {
      console.log(`  🐸 [${s.category}] ${s.scenarioId} · ${s.operatorId} · ${s.description}`);
      console.log(`       判官理由：${s.reason.slice(0, 120)}`);
    }
  }
}

function printComparison(cmp: JudgeComparison, t0: number): void {
  console.log("\n" + "═".repeat(64));
  const layerName = cmp.layer === "spec" ? "1 (spec·改 expectation)" : "2 (trace·注入故障)";
  console.log(`两判官对比 Layer ${layerName}  |  耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const l = cmp.lenient;
  const s = cmp.strict;
  const lmk = l.byCategory["must-kill"] ?? ZERO_BUCKET;
  const smk = s.byCategory["must-kill"] ?? ZERO_BUCKET;
  console.log(`  lenient 总体：${fmtBucket(l.overall).padEnd(14)} must-kill ${fmtBucket(lmk)}`);
  console.log(`  strict  总体：${fmtBucket(s.overall).padEnd(14)} must-kill ${fmtBucket(smk)}`);
  console.log(`  △ strict 多杀 must-kill：+${Math.max(0, cmp.mustKillDelta.strictKilled - cmp.mustKillDelta.lenientKilled)}（${pct(lmk.score)} → ${pct(smk.score)}，${pp((smk.score - lmk.score) * 100)}）`);

  console.log(`\n按算子（lenient → strict）：`);
  for (const [op, b] of Object.entries(cmp.byOperatorDelta)) {
    const d = (b.strict.score - b.lenient.score) * 100;
    console.log(`  ${op.padEnd(16)} lenient ${fmtBucket(b.lenient)} → strict ${fmtBucket(b.strict)}  ${pp(d)}`);
  }

  const strictOnly = cmp.itemDiff.filter((x) => x.strictOnly);
  if (strictOnly.length) {
    console.log(`\nstrict-only kills（宽松漏检而 strict 抓到，${strictOnly.length}）：`);
    for (const x of strictOnly) {
      console.log(`  💀 [${x.category}] ${x.scenarioId} · ${x.operatorId} · ${x.description}`);
    }
  }
  const lenientOnly = cmp.itemDiff.filter((x) => x.lenientOnly);
  if (lenientOnly.length) {
    console.log(`\nlenient-only kills（strict 反而放过，${lenientOnly.length}，多为 soft 类）：`);
    for (const x of lenientOnly) {
      console.log(`  🐸 [${x.category}] ${x.scenarioId} · ${x.operatorId} · ${x.description}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
