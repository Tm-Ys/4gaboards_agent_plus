// Layer 2 变异测试运行器：轨迹级故障注入。
//   基线真跑（原 expectation，正确 app）→ 固化 trace → 注入故障 → 用【原场景】重判官。
//
// 与 Layer 1 的区别：变异发生在【轨迹证据】侧（模拟 app 表现错），场景 expectation 保持正确。
// 被测对象仍是判官：对「行为故障」判 FAIL = killed（察觉）；判 PASS = survived（漏检）。
// 这是判官真正会响应的层面（trace 行为证据），预期能产出有判别力的 Mutation Score。

import { runScenario, type ScenarioRunResult } from "../runner/runScenario";
import { resetAccountLanguage } from "../runner/resetState";
import { judgeScenario, type Verdict, type JudgeMode } from "../verify/judge";
import { generateFaults, type Fault } from "./traceFaults";
import type { TestScenario } from "../../schemas";

export interface FaultResult {
  fault: Fault;
  verdict: Verdict;
  killed: boolean;
}

export interface ScenarioFaultReport {
  scenarioId: string;
  scenarioTitle: string;
  featureId: string;
  baselinePass: boolean;
  baselineVerdict: Verdict | null;
  skipped: boolean;
  skipReason?: string;
  faultCount: number;
  results: FaultResult[];
}

export interface TraceRunOptions {
  maxSteps?: number;
  headless?: boolean;
  namespace?: string;
  onFault?: (idx: number, total: number, r: FaultResult) => void;
  onScenario?: (scenarioId: string, baselinePass: boolean, faultCount: number) => void;
  /** 判官严格档，默认 lenient（既有行为）。strict=逐条核对 expectation。 */
  judgeMode?: JudgeMode;
  /** 复用既有基线 trace：传入则跳过基线真跑+清理（零浏览器）。--judge both / run-judge-cost 用。 */
  baselineOverride?: ScenarioRunResult;
}

export async function runMutationTrace(
  scenario: TestScenario,
  opts: TraceRunOptions = {},
): Promise<ScenarioFaultReport> {
  const namespace = opts.namespace ?? `mut2-${scenario.id}-${stamp()}`.replace(/[^a-zA-Z0-9_-]/g, "-");

  // 1. 基线：baselineOverride 复用既有 trace（零浏览器，--judge both / run-judge-cost 用）；否则真跑。
  let baseline: ScenarioRunResult;
  if (opts.baselineOverride) {
    baseline = opts.baselineOverride;
  } else {
    try {
      baseline = await runScenario(scenario, {
        maxSteps: opts.maxSteps ?? 20,
        headless: opts.headless ?? true,
        namespace,
        cleanup: resetAccountLanguage,
      });
    } catch (e) {
      return emptyReport(scenario, `基线运行异常：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. 基线必须 PASS：否则无法判定故障存活
  if (!baseline.verdict.pass) {
    return {
      ...emptyReport(scenario, `基线判官 FAIL，跳过：${baseline.verdict.reason.slice(0, 80)}`),
      baselineVerdict: baseline.verdict,
    };
  }

  // 3. 注入故障，复用基线 trace，用【原场景】重判官
  const faults = generateFaults(baseline, scenario, namespace);
  opts.onScenario?.(scenario.id, true, faults.length);

  const results: FaultResult[] = [];
  for (let i = 0; i < faults.length; i++) {
    const f = faults[i]!;
    // 注意：场景用【原】scenario（expectation 正确），run 用 faultedRun（行为故障）
    let verdict: Verdict;
    try {
      verdict = await judgeScenario(scenario, f.faultedRun, { mode: opts.judgeMode });
    } catch (e) {
      console.warn(`[mutation] 故障 ${f.id} 判官失败，跳过：${e instanceof Error ? e.message : e}`);
      continue;
    }
    const killed = !verdict.pass;
    const r: FaultResult = { fault: f, verdict, killed };
    results.push(r);
    opts.onFault?.(i + 1, faults.length, r);
  }

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    featureId: scenario.feature_id,
    baselinePass: true,
    baselineVerdict: baseline.verdict,
    skipped: false,
    faultCount: faults.length,
    results,
  };
}

function emptyReport(scenario: TestScenario, skipReason: string): ScenarioFaultReport {
  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    featureId: scenario.feature_id,
    baselinePass: false,
    baselineVerdict: null,
    skipped: true,
    skipReason,
    faultCount: 0,
    results: [],
  };
}

function stamp(): string {
  return Date.now().toString(36);
}
