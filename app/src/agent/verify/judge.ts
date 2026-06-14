// 独立 LLM 判官：场景 + 执行轨迹(每步观察) + 最终观察 → PASS/FAIL + 失败定位 + 原因。
// 不受 actor 自评影响（transcript 只含事实）。冲突时以判官为准。

import { chatJson } from "../../llm";
import { serializeScenario } from "../react/prompt";
import { buildTranscript } from "./transcript";
import type { TestScenario } from "../../schemas";
import type { ReActRunResult } from "../react/types";

export interface Verdict {
  pass: boolean;
  confidence: "high" | "medium" | "low";
  /** 失败的最相关段落（1-based），通过为 null */
  failedPhase: number | null;
  /** 失败步骤一句话描述，通过为 null */
  failedStep: string | null;
  /** 判定理由（失败时即失败原因，要具体） */
  reason: string;
  /** 已确认的预期特征 */
  matched: string[];
  /** 未确认的预期特征 */
  missed: string[];
}

const SYSTEM_PROMPT = `你是独立的 Web 测试判官。给定一个测试场景、它的执行轨迹（每步的动作/结果/页面观察）和最终观察，独立判定该场景是否执行成功。

【原则】
- 只看证据（轨迹中的页面观察、最终观察），不要受执行者任何自评/情绪影响。
- 执行者的思考不在证据中——你看到的只有"做了什么动作"和"页面当时是什么样"。

【判定方法】
1. 逐个检查场景每个段落(phase)的 expectation.key_features：这些是"成功"的可观察特征。
2. 在【执行轨迹的每步页面观察】和【最终观察】里找证据：该特征是否出现过、或最终仍存在。
3. 全部特征均有证据 → pass=true；否则 pass=false。
4. 失败时：failedPhase（最相关的段落号，1-based 整数），failedStep（一句话指出失败处），reason（具体失败原因）。
5. confidence：证据明确→high；有歧义/部分缺失→medium；证据严重不足→low。

【输出】严格输出下面的 JSON，不要任何额外文字：
{
  "pass": true,
  "confidence": "high",
  "failedPhase": null,
  "failedStep": null,
  "reason": "中文：为什么这样判（失败时=失败原因）",
  "matched": ["已确认的特征"],
  "missed": ["未确认的特征"]
}`;

export async function judgeScenario(scenario: TestScenario, run: ReActRunResult): Promise<Verdict> {
  const user = `【测试场景】\n${serializeScenario(scenario)}\n\n${buildTranscript(run)}`;
  const data = await chatJson(SYSTEM_PROMPT, user, { temperature: 0.1 });

  const confRaw = String(data.confidence ?? "medium");
  const confidence: Verdict["confidence"] =
    confRaw === "high" || confRaw === "medium" || confRaw === "low" ? confRaw : "medium";

  return {
    pass: Boolean(data.pass),
    confidence,
    failedPhase: typeof data.failedPhase === "number" && Number.isFinite(data.failedPhase) ? data.failedPhase : null,
    failedStep: typeof data.failedStep === "string" && data.failedStep.trim() ? data.failedStep : null,
    reason: String(data.reason ?? "").trim(),
    matched: Array.isArray(data.matched) ? data.matched.map(String) : [],
    missed: Array.isArray(data.missed) ? data.missed.map(String) : [],
  };
}
