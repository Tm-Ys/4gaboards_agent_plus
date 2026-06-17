// CLI：P5 变异测试 → Mutation Score。两层：
//   --layer spec  （默认）Layer 1：改 expectation，真跑正确 app，重判官（测判官对【规约级】错误的敏感度）。
//   --layer trace Layer 2：往真实轨迹注入故障（执行异常/布局/语义），用原场景重判官（测判官对【行为级】故障的敏感度）。
//
// 用法：
//   npm run run-mutation -- --scenario board-create-happy-path            # Layer1 单场景
//   npm run run-mutation -- --layer trace --scenario board-create-happy-path   # Layer2 单场景
//   npm run run-mutation -- --layer trace                                  # Layer2 默认子集
//   npm run run-mutation -- --feature board --limit 3
//
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
  scenarioSubtotal,
  type BucketScore,
  type MutationSummary,
  type ScoredScenario,
} from "../mutation/report";

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

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
function fmtBucket(b: BucketScore): string {
  return `${b.killed}/${b.total}（${pct(b.score)}）`;
}
function bucketFromKilled(killed: number, total: number): BucketScore {
  return { total, killed, survived: total - killed, score: total ? killed / total : 0 };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const layer = args.layer === "trace" ? "trace" : "spec";
  const setName = typeof args.set === "string" ? args.set : "basic";
  const maxSteps = typeof args.maxSteps === "string" ? Number(args.maxSteps) || 20 : 20;
  const { scenarios } = loadScenarioSet(setName);
  const byId = new Map(scenarios.scenarios.map((s) => [s.id, s]));

  // 选择场景
  const filter: Record<string, unknown> = { layer };
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
  console.log(`▶ 变异测试 Layer ${layer === "spec" ? "1 (spec)" : "2 (trace)"}：集="${setName}" maxSteps=${maxSteps}；${list.length} 个场景候选`);
  console.log(`  过滤：${JSON.stringify(filter)}`);
  if (missing.length) console.log(`  ⚠ 未找到的场景：${missing.join(", ")}`);
  if (list.length === 0) return 0;
  console.log("");

  const t0 = Date.now();
  const specReports: ScenarioMutationReport[] = [];
  const traceScored: ScoredScenario[] = [];
  const traceRaw: ScenarioFaultReport[] = [];

  for (let i = 0; i < list.length; i++) {
    const sc = list[i]!;
    console.log(`[${i + 1}/${list.length}] ${sc.id} [${sc.difficulty}]`);
    if (layer === "spec") {
      const rep = await runMutation(sc, {
        maxSteps,
        onScenario: (sid, pass, n) => console.log(`  基线 ${pass ? "✅ PASS" : "❌ FAIL"} → ${n} 个变异体`),
        onMutant: (idx, total, r) =>
          console.log(
            `    [${idx}/${total}] ${r.mutant.operatorId.padEnd(16)} (${r.mutant.category.padEnd(8)}) ${r.mutant.description} → ${r.killed ? "💀 killed" : "🐸 survived"}`,
          ),
      });
      specReports.push(rep);
      if (rep.skipped) console.log(`  ⏭ 跳过：${rep.skipReason}`);
      else console.log(`  小计：killed ${fmtBucket(scenarioSubtotal(rep))}`);
    } else {
      const rep = await runMutationTrace(sc, {
        maxSteps,
        onScenario: (sid, pass, n) => console.log(`  基线 ${pass ? "✅ PASS" : "❌ FAIL"} → ${n} 个故障`),
        onFault: (idx, total, r) =>
          console.log(
            `    [${idx}/${total}] ${r.fault.operatorId.padEnd(16)} (${r.fault.category.padEnd(8)}) ${r.fault.description} → ${r.killed ? "💀 killed" : "🐸 survived"}`,
          ),
      });
      traceRaw.push(rep);
      if (rep.skipped) {
        console.log(`  ⏭ 跳过：${rep.skipReason}`);
      } else {
        const k = rep.results.filter((r) => r.killed).length;
        console.log(`  小计：killed ${fmtBucket(bucketFromKilled(k, rep.results.length))}`);
        traceScored.push({
          scenarioId: rep.scenarioId,
          featureId: rep.featureId,
          skipped: false,
          items: rep.results.map((r) => ({
            id: r.fault.id,
            category: r.fault.category,
            operatorId: r.fault.operatorId,
            description: r.fault.description,
            detail: r.fault.detail,
            killed: r.killed,
            reason: r.verdict.reason,
          })),
        });
      }
    }
  }

  const summary: MutationSummary =
    layer === "spec" ? summarizeMutation(specReports) : summarizeScored("trace", traceScored);
  printSummary(summary, layer, t0);

  // 落盘
  const dir = path.join(settings.outputsDir, "mutation");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(dir, `mutation-${ts}.json`);
  const reports = layer === "spec" ? specReports : traceRaw;
  fs.writeFileSync(
    outPath,
    JSON.stringify({ startedAt: new Date().toISOString(), layer, setName, filter, maxSteps, summary, reports }, null, 2),
    "utf-8",
  );
  console.log(`\n💾 报告已写入：${outPath}`);
  return 0;
}

function printSummary(summary: MutationSummary, layer: "spec" | "trace", t0: number): void {
  console.log("\n" + "═".repeat(64));
  console.log(
    `场景：变异 ${summary.scenariosMutated} / 跳过 ${summary.scenariosSkipped} / 共 ${summary.scenariosTotal}  |  耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  const layerName = layer === "spec" ? "1 (spec·改 expectation)" : "2 (trace·注入故障)";
  console.log(`Mutation Score Layer ${layerName}（总体）：${fmtBucket(summary.overall)}`);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
