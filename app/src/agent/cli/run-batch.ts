// CLI：批量跑场景，出通过率报告。
// 用法：
//   npm run run-batch -- --limit 3                                # 冒烟
//   npm run run-batch -- --difficulty easy --tag happy_path       # easy happy_path 子集
//   npm run run-batch -- --feature board-create                   # 某功能点的所有场景
//   npm run run-batch -- --difficulty easy,medium --limit 50 --maxSteps 15

import fs from "node:fs";
import path from "node:path";
import { settings } from "../../config";
import { loadScenarioSet } from "../../scenarioStore";
import { parseArgs } from "../../cli";
import { runBatch } from "../runner/runBatch";

function csv(v: string | boolean | undefined): Set<string> | undefined {
  if (typeof v !== "string") return undefined;
  return new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(0)}%` : "-";
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const setName = typeof args.set === "string" ? args.set : "basic";
  const maxSteps = typeof args.maxSteps === "string" ? Number(args.maxSteps) || 20 : 20;
  const { scenarios } = loadScenarioSet(setName);
  let list = [...scenarios.scenarios];

  const diffSet = csv(args.difficulty);
  const tagSet = csv(args.tag);
  const feature = typeof args.feature === "string" ? args.feature : undefined;
  const filter: Record<string, unknown> = {};
  if (diffSet) { filter.difficulty = [...diffSet]; list = list.filter((s) => diffSet.has(s.difficulty)); }
  if (tagSet) { filter.tag = [...tagSet]; list = list.filter((s) => s.tags.some((t) => tagSet.has(t))); }
  if (feature) { filter.feature = feature; list = list.filter((s) => s.feature_id.startsWith(feature)); }
  if (typeof args.limit === "string") {
    const n = Number(args.limit) || list.length;
    list = list.slice(0, n);
    filter.limit = n;
  }

  console.log(`▶ 批量运行：集="${setName}" 共 ${list.length} 个场景；maxSteps=${maxSteps}`);
  console.log(`  过滤：${JSON.stringify(filter)}`);
  if (list.length === 0) {
    console.log("没有匹配的场景。");
    return 0;
  }
  console.log("");

  const t0 = Date.now();
  const report = await runBatch(list, {
    maxSteps,
    setName,
    filter,
    onProgress: (i, n, o) => {
      const tag = o.result
        ? `${o.result.verdict.pass ? "✅ PASS" : "❌ FAIL"} — ${o.result.verdict.reason.slice(0, 70)}`
        : `⚠️ 异常 — ${(o.error ?? "").slice(0, 70)}`;
      console.log(`[${i}/${n}] ${o.scenario.id.padEnd(34)} ${tag}`);
    },
  });

  // 落盘
  const runsDir = path.join(settings.outputsDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(runsDir, `batch-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  // 摘要
  const s = report.summary;
  console.log("\n" + "═".repeat(64));
  console.log(`总数 ${s.total} | 通过 ${s.pass} | 失败 ${s.fail} | 异常 ${s.error} | 通过率 ${pct(s.pass, s.pass + s.fail)} | 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`平均步数 ${s.avgSteps} | 平均 ${(s.avgMs / 1000).toFixed(1)}s/场景`);
  const fmtBucket = (b: Record<string, { pass: number; total: number }>) =>
    Object.entries(b).map(([k, v]) => `${k} ${v.pass}/${v.total}(${pct(v.pass, v.total)})`).join("，");
  console.log(`按难度：${fmtBucket(s.byDifficulty) || "（无）"}`);
  console.log(`按标签：${fmtBucket(s.byTag) || "（无）"}`);

  // 失败/异常清单
  const fails = report.outcomes.filter((o) => o.result && !o.result.verdict.pass);
  const errs = report.outcomes.filter((o) => o.error);
  if (fails.length) {
    console.log("\n失败场景：");
    for (const o of fails) {
      const v = o.result!.verdict;
      console.log(`  ✗ ${o.scenario.id} [${o.scenario.difficulty}] — ${v.reason.slice(0, 100)}`);
    }
  }
  if (errs.length) {
    console.log("\n异常场景：");
    for (const o of errs) console.log(`  ⚠ ${o.scenario.id} — ${(o.error ?? "").slice(0, 100)}`);
  }

  console.log(`\n💾 报告已写入：${outPath}`);
  return 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
