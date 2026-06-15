// CLI：跑单个测试场景的 ReAct 闭环。
// 用法：
//   npm run run-scenario -- --id board-create-happy-path
//   npm run run-scenario -- --feature board-create          # 取该 feature 第一个 happy_path
//   npm run run-scenario -- --list                          # 列出所有场景 id
//   npm run run-scenario -- --id <id> --headed --maxSteps 15

import fs from "node:fs";
import path from "node:path";
import { settings } from "../../config";
import { loadScenarioSet } from "../../scenarioStore";
import { parseArgs } from "../../cli";
import { runScenario } from "../runner/runScenario";
import { resetAccountLanguage } from "../runner/resetState";

function pickScenario(
  scenarios: { id: string; feature_id: string; tags: string[]; title: string }[],
  args: Record<string, string | boolean>,
) {
  if (typeof args.id === "string") {
    return scenarios.find((s) => s.id === args.id) ?? null;
  }
  if (typeof args.feature === "string") {
    const ofFeat = scenarios.filter((s) => s.feature_id === args.feature);
    return ofFeat.find((s) => s.tags.includes("happy_path")) ?? ofFeat[0] ?? null;
  }
  return null;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const setName = typeof args.set === "string" ? args.set : "basic";
  const { scenarios } = loadScenarioSet(setName);
  const list = scenarios.scenarios;

  if (args.list) {
    console.log(`场景集 "${setName}" 共 ${list.length} 个场景：`);
    for (const s of list) console.log(`  ${s.id.padEnd(36)} [${s.difficulty}] ${s.title}`);
    return 0;
  }

  const scenario = pickScenario(
    list.map((s) => ({ id: s.id, feature_id: s.feature_id, tags: s.tags, title: s.title })),
    args,
  );
  if (!scenario) {
    console.error("未指定场景：用 --id <id> 或 --feature <featureId>，或 --list 查看。");
    return 2;
  }
  const full = list.find((s) => s.id === scenario.id)!;

  const maxSteps = typeof args.maxSteps === "string" ? Number(args.maxSteps) || 20 : 20;
  const headless = args.headed === true ? false : true;

  console.log(`▶ 运行场景：${full.id}（${full.title}）`);
  console.log(`  headless=${headless}, maxSteps=${maxSteps}\n`);

  const cleanup = args.reset === true ? resetAccountLanguage : undefined;
  const result = await runScenario(full, { headless, maxSteps, cleanup });

  // 落盘轨迹
  const runsDir = path.join(settings.outputsDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(runsDir, `${full.id}-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");

  // 摘要：Actor + 判官双栏
  console.log("─".repeat(60));
  const actorEnd = result.done ? "✅ done" : result.timedOut ? "⏱ 超时" : "↩ 收尾";
  console.log(`Actor ：${actorEnd} | likelySuccess=${result.likelySuccess} | 步数=${result.stepCount} | ${result.durationMs}ms`);
  if (result.doneSummary) console.log(`        自评：${result.doneSummary}`);

  const v = result.verdict;
  const phaseTag = v.failedPhase ? ` — 失败于 段落${v.failedPhase}` : "";
  console.log(`判官 ：${v.pass ? "✅ PASS" : "❌ FAIL"}（confidence=${v.confidence}）${phaseTag}`);
  if (v.matched.length) console.log(`        已确认：${v.matched.join("；")}`);
  if (v.missed.length) console.log(`        未确认：${v.missed.join("；")}`);
  if (v.failedStep) console.log(`        失败处：${v.failedStep}`);
  console.log(`        理由：${v.reason}`);
  if (result.likelySuccess !== v.pass) {
    console.log(`        ⚠ actor 自评(${result.likelySuccess}) 与判官(${v.pass}) 不一致`);
  }

  console.log("步骤：");
  for (const st of result.steps) {
    const tag = st.tool ? `${st.tool}` : "(思考)";
    const ok = st.ok === undefined ? "" : st.ok ? " ✓" : " ✗";
    console.log(`  ${st.step}. [${tag}]${ok} ${st.result ?? (st.thought ?? "").slice(0, 80)}`);
  }
  console.log(`\n💾 轨迹已写入：${outPath}`);
  return result.verdict.pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
