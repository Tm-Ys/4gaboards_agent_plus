// DeepSeek（OpenAI 兼容）封装：JSON 模式调用，返回解析后的对象。
// 自定义 fetch 走本地代理（见 http.ts）。

import OpenAI from "openai";
import { settings } from "./config";
import { proxyFetch } from "./http";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  if (!settings.deepseekApiKey) {
    throw new Error("未配置 DEEPSEEK_API，请检查仓库根目录 .env");
  }
  client = new OpenAI({
    apiKey: settings.deepseekApiKey,
    baseURL: settings.deepseekUrl,
    // 注入代理感知 fetch；无代理时 proxyFetch 等价于原生 fetch
    fetch: proxyFetch as unknown as OpenAI["fetch"],
    timeout: 120_000,
  });
  return client;
}

export interface ChatJsonOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function chatJson(
  system: string,
  user: string,
  opts: ChatJsonOptions = {},
): Promise<Record<string, unknown>> {
  const c = getClient();
  const resp = await c.chat.completions.create({
    model: opts.model ?? settings.deepseekModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: opts.temperature ?? 0.2,
    response_format: { type: "json_object" },
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  });
  const content = resp.choices[0]?.message?.content ?? "{}";
  return JSON.parse(stripCodeFence(content));
}

/** 兜底：剥离个别模型即便 JSON 模式也可能包裹的 ```json 围栏。 */
function stripCodeFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines[0]?.startsWith("```")) lines.shift();
    if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
    t = lines.join("\n").trim();
  }
  return t;
}
