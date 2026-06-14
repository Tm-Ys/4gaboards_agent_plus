// B 层 · 通用浏览器工具：基于"最近观察"的 ref 操作真实页面。兜底 A 层未覆盖的步骤。
// 工具名用下划线（OpenAI/DeepSeek 函数名仅允许 [a-zA-Z0-9_-]）。

import { z } from "zod";
import { registry } from "./registry";

function resolveRef(ctx: import("./registry").ToolContext, ref: number) {
  const obs = ctx.session.getObs();
  if (ref < 0 || ref >= obs.elements.length) {
    throw new Error(`ref=${ref} 越界（当前 0..${obs.elements.length - 1}），先 browser_observe 刷新`);
  }
  return obs.resolve(ref);
}

async function reObserve(ctx: import("./registry").ToolContext) {
  return ctx.session.observe();
}

registry.register({
  name: "browser_observe",
  layer: "B",
  description: "观察当前页面，返回可交互元素列表（带 ref）。每次动作后调用以刷新页面状态。",
  params: z.object({}),
  run: async (_args, ctx) => {
    const o = await ctx.session.observe();
    return {
      ok: true,
      summary: `观察到 ${o.elements.length} 个可交互元素；URL=${o.url}`,
      data: { url: o.url, title: o.title, elements: o.elements },
    };
  },
});

registry.register({
  name: "browser_click",
  layer: "B",
  description: "点击最近观察中指定 ref 的元素。",
  params: z.object({ ref: z.number().int().nonnegative() }),
  run: async ({ ref }, ctx) => {
    const locator = resolveRef(ctx, ref);
    const name = ctx.session.getObs().elements[ref]?.name ?? "";
    await locator.click({ timeout: 10_000 });
    await ctx.page.waitForTimeout(600);
    const o = await reObserve(ctx);
    return { ok: true, summary: `已点击 ref=${ref}${name ? ` "${name}"` : ""}；现 ${o.elements.length} 元素`, data: { url: o.url } };
  },
});

registry.register({
  name: "browser_fill",
  layer: "B",
  description: "在最近观察中指定 ref 的输入框填入文本（会先清空）。",
  params: z.object({ ref: z.number().int().nonnegative(), text: z.string() }),
  run: async ({ ref, text }, ctx) => {
    const locator = resolveRef(ctx, ref);
    await locator.fill(text, { timeout: 10_000 });
    await ctx.page.waitForTimeout(300);
    const o = await reObserve(ctx);
    return { ok: true, summary: `已填入 ref=${ref}: "${text.slice(0, 50)}"`, data: { url: o.url } };
  },
});

registry.register({
  name: "browser_press",
  layer: "B",
  description: "按键，如 Enter / Escape / Tab / Control+Enter（用于确认、快捷键、关闭模态等）。",
  params: z.object({ key: z.string().describe("KeyboardEvent key，如 Enter、Escape、Control+Enter") }),
  run: async ({ key }, ctx) => {
    await ctx.page.keyboard.press(key);
    await ctx.page.waitForTimeout(500);
    const o = await reObserve(ctx);
    return { ok: true, summary: `已按键 ${key}；现 ${o.elements.length} 元素`, data: { url: o.url } };
  },
});

registry.register({
  name: "browser_scroll",
  layer: "B",
  description: "滚动页面。",
  params: z.object({
    direction: z.enum(["up", "down"]).default("down"),
    amount: z.number().int().positive().default(400),
  }),
  run: async ({ direction, amount }, ctx) => {
    const dy = direction === "down" ? amount : -amount;
    await ctx.page.mouse.wheel(0, dy);
    await ctx.page.waitForTimeout(400);
    const o = await reObserve(ctx);
    return { ok: true, summary: `滚动 ${direction} ${amount}px`, data: { url: o.url } };
  },
});

registry.register({
  name: "browser_goto",
  layer: "B",
  description: "导航到指定 URL（慎用，仅在确有需要时）。",
  params: z.object({ url: z.string().url() }),
  run: async ({ url }, ctx) => {
    await ctx.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await ctx.session.waitForReady();
    const o = await reObserve(ctx);
    return { ok: true, summary: `已导航到 ${o.url}；${o.elements.length} 元素`, data: { url: o.url } };
  },
});

registry.register({
  name: "browser_done",
  layer: "B",
  description: "表示当前场景执行结束（任务完成或无法继续）。",
  params: z.object({ result: z.string().describe("一句话结果说明，如 成功完成 / 卡在某步：原因") }),
  run: async ({ result }) => ({ ok: true, done: true, summary: `场景结束：${result}` }),
});
