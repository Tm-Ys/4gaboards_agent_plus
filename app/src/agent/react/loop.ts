// ReAct 循环：LLM function-calling ↔ 工具 registry。
// 每步：模型基于"最新观察"选一个工具 → 执行 → 把结果+新观察塞回上下文 → 继续。
// 观察通过工具结果流入上下文（工具执行后会 re-observe 并设置 session 的最近观察）。

import type OpenAI from "openai";
import { chatWithTools } from "../../llm";
import { registry, type ToolContext } from "../tools/registry";
import type { TestScenario } from "../../schemas";
import { buildSystemPrompt } from "./prompt";
import type { ReActRunResult, ReActStep } from "./types";

export interface RunReactLoopOptions {
  maxSteps?: number;
  /** 每步完成后回调（前端 SSE 实时轨迹用）。 */
  onStep?: (step: ReActStep) => void;
}

export async function runReactLoop(
  ctx: ToolContext,
  scenario: TestScenario,
  opts: RunReactLoopOptions = {},
): Promise<ReActRunResult> {
  const maxSteps = opts.maxSteps ?? 20;
  const tools = registry.toOpenAITools() as unknown as OpenAI.Chat.Completions.ChatCompletionTool[];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(scenario) },
    {
      role: "user",
      content: "请执行上述测试场景。开始前先 browser.observe 看当前页面，再逐步完成。",
    },
  ];
  const steps: ReActStep[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const resp = await chatWithTools(messages, tools, { temperature: 0.2 });
    const msg = resp.choices[0]?.message;
    if (!msg) break;

    const thought = (msg.content ?? "").toString().slice(0, 600);
    const toolCalls = msg.tool_calls ?? [];

    // assistant 消息入历史（含 thought 与 tool_calls）
    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);

    // 无 tool_call → 模型自行收尾
    if (toolCalls.length === 0) {
      steps.push({ step, thought });
      opts.onStep?.(steps[steps.length - 1]!);
      return finalize(false, false, steps, ctx, thought.slice(0, 300));
    }

    // 逐个执行 tool_call（v6 联合类型，按 function 收窄）
    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = { _raw: tc.function.arguments };
      }
      const result = await registry.execute(name, args, ctx);
      const obsText = safeObsText(ctx);
      const traceText = result.trace?.length
        ? "\n-- 工具内部步骤 --\n" +
          result.trace
            .map((t) => `· ${t.label}${t.observation ? "：\n" + t.observation : ""}`)
            .join("\n")
        : "";
      const toolContent = result.summary + traceText + (obsText ? `\n\n-- 最新观察 --\n${obsText}` : "");
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolContent,
      } as OpenAI.Chat.Completions.ChatCompletionToolMessageParam);
      steps.push({
        step,
        thought,
        tool: name,
        args,
        result: result.summary,
        observation: obsText,
        trace: result.trace,
        ok: result.ok,
      });
      opts.onStep?.(steps[steps.length - 1]!);

      if (result.done) {
        return finalize(true, false, steps, ctx, result.summary);
      }
    }
  }

  return finalize(false, true, steps, ctx);
}

function finalize(
  done: boolean,
  timedOut: boolean,
  steps: ReActStep[],
  ctx: ToolContext,
  doneSummary?: string,
): ReActRunResult {
  return {
    done,
    timedOut,
    steps,
    finalObservation: safeObsText(ctx),
    doneSummary,
    likelySuccess: done && !timedOut,
  };
}

function safeObsText(ctx: ToolContext): string {
  try {
    return ctx.session.getObs().text;
  } catch {
    return "";
  }
}
