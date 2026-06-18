// CLI：宽松代价量化——读已有 batch 报告，用 lenient + strict 判官各重判真实场景，
// 产出两判官真实 PASS 率 + strict 误杀明细（falsePositives = 宽松代价锚点）。
// 零浏览器（复用 batch 报告里固化的 trace）；纯判官调用。
//
// 用法：
//   npm run run-judge-cost -- --latest                                   # 用最新 batch 报告
//   npm run run-judge-cost -- --batch app/outputs/runs/batch-...json     # 指定报告
//
// 三角表的另两列（Layer1/Layer2 must-kill）由 `run-mutation --judge both` 提供，本脚本不重复跑变异。
// 报告落 app/outputs/mutation/judge-cost-<ts>.json（gitignored）。

import fs from "node:fs";
import path from "node:path";
import { settings } from "../../config";
import { parseArgs } from "../../cli";
import { judgeScenario, type JudgeMode } from "../verify/judge";
import type { BatchReport } from "../runner/runBatch";
import type { TestScenario } from "../../schemas";

interface ModeVerdict {
  pass: boolean;
  reason: string;
}

interface PerScenario {
  scenarioId: string;
  title: string;
  difficulty: string;
  /** batch 报告里宽松判官当初的结论（参照基线） */
  originalVerdictPass: boolean;
  lenient: ModeVerdict;
  strict: ModeVerdict;
  /** lenient PASS 但 strict FAIL = strict 误杀（宽松代价） */
  falsePositive: boolean;
  /** lenient FAIL 但 strict PASS = strict 反而通过（罕见） */
  strictPassLenientFail: boolean;
}

interface JudgeCostReport {
  startedAt: string;
  sourceBatch: string;
  scenariosJudged: number;
  scenariosSkipped: number; // outcome 无 result（运行异常）
  passRate: Record<JudgeMode, { pass: number; total: number; rate: number }>;
  falsePositives: PerScenario[];
  lenientOnlyFails: PerScenario[];
  perScenario: PerScenario[];
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // 定位 batch 报告
  let batchPath: string;
  if (args.latest) {
    const dir = path.join(settings.outputsDir, "runs");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("batch-") && f.endsWith(".json"))
      .sort();
    if (!files.length) {
      console.error(`未在 ${dir} 找到 batch 报告`);
      return 1;
    }
    batchPath = path.join(dir, files[files.length - 1]!);
  } else if (typeof args.batch === "string") {
    batchPath = args.batch;
  } else {
    console.error("用法：--batch <path> 或 --latest（用最新 batch 报告）");
    return 1;
  }
  console.log(`▶ 宽松代价量化：源 ${batchPath}`);

  const raw = JSON.parse(fs.readFileSync(batchPath, "utf-8")) as BatchReport;

  const perScenario: PerScenario[] = [];
  let skipped = 0;
  let errored = 0;
  for (let i = 0; i < raw.outcomes.length; i++) {
    const o = raw.outcomes[i]!;
    if (!o.result) {
      skipped++;
      continue;
    }
    const sc = o.scenario as TestScenario;
    // o.result 是完整 ScenarioRunResult（含 steps/observation/finalObservation）→ 直接喂判官，零浏览器。
    try {
      const lenient = await judgeScenario(sc, o.result, { mode: "lenient" });
      const strict = await judgeScenario(sc, o.result, { mode: "strict" });
      const entry: PerScenario = {
        scenarioId: sc.id,
        title: sc.title,
        difficulty: sc.difficulty,
        originalVerdictPass: o.result.verdict.pass,
        lenient: { pass: lenient.pass, reason: lenient.reason },
        strict: { pass: strict.pass, reason: strict.reason },
        falsePositive: lenient.pass && !strict.pass,
        strictPassLenientFail: !lenient.pass && strict.pass,
      };
      perScenario.push(entry);
      const mark = entry.falsePositive ? "  ⚠ strict 误杀" : entry.strictPassLenientFail ? "  (strict 放过)" : "";
      console.log(
        `  [${i + 1}/${raw.outcomes.length}] ${sc.id}：lenient ${lenient.pass ? "✅" : "❌"} / strict ${strict.pass ? "✅" : "❌"}${mark}`,
      );
    } catch (e) {
      errored++;
      console.log(
        `  [${i + 1}/${raw.outcomes.length}] ${sc.id}：⚠ 判官调用失败（${e instanceof Error ? e.message : e}），跳过`,
      );
    }
  }

  const judged = perScenario.length;
  const passOf = (mode: JudgeMode) => {
    const pass = perScenario.filter((e) => (mode === "lenient" ? e.lenient.pass : e.strict.pass)).length;
    return { pass, total: judged, rate: judged ? pass / judged : 0 };
  };
  const falsePositives = perScenario.filter((e) => e.falsePositive);
  const lenientOnlyFails = perScenario.filter((e) => e.strictPassLenientFail);

  const report: JudgeCostReport = {
    startedAt: new Date().toISOString(),
    sourceBatch: path.basename(batchPath),
    scenariosJudged: judged,
    scenariosSkipped: skipped,
    passRate: { lenient: passOf("lenient"), strict: passOf("strict") },
    falsePositives,
    lenientOnlyFails,
    perScenario,
  };

  // 打印三角表
  console.log("\n" + "═".repeat(64));
  console.log(`宽松代价（源 ${report.sourceBatch}，判 ${judged} 场景，跳过 ${skipped} 无 trace / ${errored} 判官失败）`);
  console.log(`  真实 PASS 率  lenient ${pct(report.passRate.lenient.rate)}（${report.passRate.lenient.pass}/${judged}）`);
  console.log(`               strict  ${pct(report.passRate.strict.rate)}（${report.passRate.strict.pass}/${judged}）`);
  const drop = (report.passRate.lenient.rate - report.passRate.strict.rate) * 100;
  console.log(
    `  △ strict 误杀真实通过：${falsePositives.length} 个（PASS 率 ${drop >= 0 ? "-" : "+"}${Math.abs(drop).toFixed(0)}pp）`,
  );
  if (lenientOnlyFails.length) {
    console.log(`  △ strict 反而放过（lenient FAIL→strict PASS）：${lenientOnlyFails.length} 个`);
  }

  if (falsePositives.length) {
    console.log(`\nstrict 误杀明细（lenient PASS / strict FAIL —— 宽松代价锚点，按 difficulty 抽检）：`);
    for (const e of falsePositives) {
      console.log(`  ⚠ [${e.difficulty}] ${e.scenarioId} · ${e.title}`);
      console.log(`      strict 理由：${e.strict.reason.slice(0, 180)}`);
    }
  }

  // 落盘
  const dir = path.join(settings.outputsDir, "mutation");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(dir, `judge-cost-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n💾 报告已写入：${outPath}`);
  return 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
