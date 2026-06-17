// 场景级变异体组装：对每个含 expectation 的 phase 作用算子，
// 深拷贝场景、仅替换该 phase 的 expectation，产出完整 mutatedScenario。
// 不动 steps / 动作 —— 变异只发生在「期望」侧。

import type { TestScenario, Expectation } from "../../schemas";
import { generateMutations } from "./operators";
import type { MutantCategory } from "./operators";

export interface Mutant {
  /** 变异体唯一 id：场景id-phaseIdx-算子id-序号 */
  id: string;
  scenarioId: string;
  phaseIndex: number;
  operatorId: string;
  category: MutantCategory;
  /** 变异了什么（人类可读） */
  description: string;
  /** 原 expectation */
  originalExpectation: Expectation;
  /** 变异后 expectation */
  mutatedExpectation: Expectation;
  /** 完整场景副本，仅 phases[phaseIndex].expectation 被替换 */
  mutatedScenario: TestScenario;
}

function cloneScenario(s: TestScenario): TestScenario {
  return JSON.parse(JSON.stringify(s)) as TestScenario;
}

/** 给定场景，生成全部变异体（遍历每个含 expectation 的 phase）。 */
export function generateMutants(scenario: TestScenario): Mutant[] {
  const mutants: Mutant[] = [];
  scenario.phases.forEach((ph, phaseIndex) => {
    if (!ph.expectation) return;
    const exps = generateMutations(ph.expectation);
    exps.forEach((m, i) => {
      const mutated = cloneScenario(scenario);
      mutated.phases[phaseIndex]!.expectation = m.mutatedExpectation;
      mutants.push({
        id: `${scenario.id}-p${phaseIndex}-${m.operatorId}-${i}`,
        scenarioId: scenario.id,
        phaseIndex,
        operatorId: m.operatorId,
        category: m.category,
        description: m.description,
        originalExpectation: ph.expectation!,
        mutatedExpectation: m.mutatedExpectation,
        mutatedScenario: mutated,
      });
    });
  });
  return mutants;
}
