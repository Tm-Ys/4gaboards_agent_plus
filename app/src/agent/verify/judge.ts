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

const SYSTEM_PROMPT = `你是独立的 Web 测试判官。给定测试场景、执行轨迹（每步动作/结果/页面观察）、最终观察，独立判定场景是否【实质上】执行成功。

【核心原则：抓实质，不死抠字面】
- 判定的核心是"场景描述的功能是否真的完成了"（如：看板是否真的被创建、卡片是否真的被添加、操作是否真的生效）。
- 场景 expectation 的 key_features 是参考线索，不是逐字核对清单：
  - 描述性/理想化特征（如标题的精确措辞、UI 是英文而特征用中文描述、纯视觉的"高亮/选中/动画"状态），若文本观察里不易直接确认——不要仅凭这类单项就判 FAIL。
  - 仅当【实质性预期结果】缺证据（该创建的没创建、该出现的没出现、动作明显失败/超时未完成）才判 FAIL。
- 你看到的证据只有动作与页面观察（可交互元素 + 标题/链接的列表）。注意 UI 实际语言可能与场景描述语言不同，按语义而非字面匹配。

【方法】
1. 先判断场景【核心目标】是否达成（看最终观察 + 轨迹里关键动作的结果）。
2. 能确认的特征放 matched；未能确认的放 missed，并在 reason 中区分"实质性缺失"与"描述性/不易验证"。
3. pass = 核心目标达成且无实质性缺失。

【输出】严格输出 JSON，不要额外文字：
{
  "pass": true,
  "confidence": "high",
  "failedPhase": null,
  "failedStep": null,
  "reason": "中文：核心目标是否达成及依据",
  "matched": ["已确认的特征"],
  "missed": ["未确认的特征（注明是实质性还是描述性）"]
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
