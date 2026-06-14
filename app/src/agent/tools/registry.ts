// 工具注册框架：领域工具(A)与通用浏览器工具(B)统一注册、执行，
// 并从 zod schema 自动生成 OpenAI function-calling 的 tools 定义（供 P1 接入 LLM）。

import { z } from "zod";
import type { Page } from "playwright";
import type { BrowserSession } from "../browser/context";

export interface ToolContext {
  session: BrowserSession;
  page: Page;
}

export interface ToolResult {
  ok: boolean;
  /** 给 LLM 的人类可读结果摘要 */
  summary: string;
  /** 结构化返回（如创建的资源名/id），供验证用 */
  data?: unknown;
  /** 是否表示当前场景执行完成（done 工具用） */
  done?: boolean;
}

export interface ToolDef<P = Record<string, unknown>> {
  name: string;
  description: string;
  layer: "A" | "B";
  params: z.ZodType<P>;
  run: (args: P, ctx: ToolContext) => Promise<ToolResult>;
}

class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register<P>(t: ToolDef<P>): this {
    if (!/^[a-zA-Z0-9_-]+$/.test(t.name)) {
      throw new Error(
        `非法工具名 "${t.name}"：OpenAI/DeepSeek 函数名仅允许 [a-zA-Z0-9_-]（用下划线，不要点）`,
      );
    }
    this.tools.set(t.name, t as unknown as ToolDef);
    return this;
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  all(): ToolDef[] {
    return [...this.tools.values()];
  }

  /** 执行工具：查表 → zod 校验参数 → 运行 handler，异常封装为失败结果。 */
  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const t = this.tools.get(name);
    if (!t) return { ok: false, summary: `未知工具: ${name}` };
    const parsed = t.params.safeParse(args);
    if (!parsed.success) {
      return { ok: false, summary: `参数校验失败: ${parsed.error.message}` };
    }
    try {
      return await t.run(parsed.data as never, ctx);
    } catch (e) {
      return { ok: false, summary: `工具执行异常: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 生成 OpenAI function-calling 的 tools 定义（zod v4 → JSON Schema）。 */
  toOpenAITools() {
    return this.all().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: z.toJSONSchema(t.params) as object,
      },
    }));
  }
}

export const registry = new ToolRegistry();
