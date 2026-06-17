// Layer 1 变异测试运行器：
//   基线真跑（原 expectation，正确 app）→ 固化 trace → 逐变异体重判官（复用同一 trace）。
//
// 被测对象 = 独立 LLM 判官 judgeScenario。app 恒为正确；变异只改 expectation。
// 复用同一 trace 把「判官是否察觉」单独隔离出来（不被 agent 对改写期望的适应性污染）。
//
// 判定：判官对【错误期望】判 FAIL = killed（察觉）；判 PASS = survived（漏检）。

import { runScenario, type ScenarioRunResult } from "../runner/runScenario";
import { resetAccountLanguage } from "../runner/resetState";
import { judgeScenario, type Verdict } from "../verify/judge";
import { generateMutants, type Mutant } from "./mutants";
import type { TestScenario } from "../../schemas";

export interface MutantResult {
  mutant: Mutant;
  verdict: Verdict;
  /** 判官是否察觉：对错误期望判 FAIL = killed */
  killed: boolean;
}

export interface ScenarioMutationReport {
  scenarioId: string;
  scenarioTitle: string;
  featureId: string;
  /** 基线（原 expectation）判官是否 PASS */
  baselinePass: boolean;
  baselineVerdict: Verdict | null;
  /** 基线未 PASS 则不参与变异（无法判定存活） */
  skipped: boolean;
  skipReason?: string;
  mutantCount: number;
  results: MutantResult[];
}

export interface MutationRunOptions {
  maxSteps?: number;
  headless?: boolean;
  /** 命名空间（资源前缀 + 清理），默认按场景 id + 时间戳生成。 */
  namespace?: string;
  onMutant?: (idx: number, total: number, r: MutantResult) => void;
  onScenario?: (scenarioId: string, baselinePass: boolean, mutantCount: number) => void;
}

export async function runMutation(
  scenario: TestScenario,
  opts: MutationRunOptions = {},
): Promise<ScenarioMutationReport> {
  const namespace =
    opts.namespace ?? `mut-${scenario.id}-${stamp()}`.replace(/[^a-zA-Z0-9_-]/g, "-");

  // 1. 基线真跑：原 expectation + 正确 app。cleanup 恢复账号级 state（语言等），避免污染后续场景的基线 trace。
  let baseline: ScenarioRunResult;
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

  // 2. 基线必须 PASS：否则无法判定变异体存活（判官可能「因别的原因」FAIL）。
  if (!baseline.verdict.pass) {
    return {
      ...emptyReport(scenario, `基线判官 FAIL，跳过变异：${baseline.verdict.reason.slice(0, 80)}`),
      baselineVerdict: baseline.verdict,
    };
  }

  // 3. 生成变异体（仅 expectation 改动），复用基线 trace 逐个重判官。
  const mutants = generateMutants(scenario);
  opts.onScenario?.(scenario.id, true, mutants.length);

  const results: MutantResult[] = [];
  for (let i = 0; i < mutants.length; i++) {
    const m = mutants[i]!;
    const verdict = await judgeScenario(m.mutatedScenario, baseline);
    const killed = !verdict.pass; // 错误期望被判 FAIL = 觉察
    const r: MutantResult = { mutant: m, verdict, killed };
    results.push(r);
    opts.onMutant?.(i + 1, mutants.length, r);
  }

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    featureId: scenario.feature_id,
    baselinePass: true,
    baselineVerdict: baseline.verdict,
    skipped: false,
    mutantCount: mutants.length,
    results,
  };
}

function emptyReport(scenario: TestScenario, skipReason: string): ScenarioMutationReport {
  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    featureId: scenario.feature_id,
    baselinePass: false,
    baselineVerdict: null,
    skipped: true,
    skipReason,
    mutantCount: 0,
    results: [],
  };
}

// Date.now 在 workflow 脚本里被禁用，但这里是普通 tsx 运行时，可用。
function stamp(): string {
  return Date.now().toString(36);
}
