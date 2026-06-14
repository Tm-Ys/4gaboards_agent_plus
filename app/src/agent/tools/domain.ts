// A 层 · 领域工具（照 4gaBoardsDocs 写，驱动真实 UI，返回结构化状态）。
// P0 种子：auth.login / board.create / board.open / card.create。
// card.* 选择器基于 docs 描述，将在 P1.5 按板视图实际 DOM 校准。

import { z } from "zod";
import { registry } from "./registry";

registry.register({
  name: "auth.login",
  layer: "A",
  description: "用 .env 凭据登录 4gaBoards demo（走真实登录表单：填 email/username + password 并提交）。",
  params: z.object({}),
  run: async (_args, ctx) => {
    await ctx.session.login();
    const o = await ctx.session.observe();
    return {
      ok: true,
      summary: `已登录 4gaBoards；URL=${o.url}，可见 ${o.elements.length} 个元素`,
      data: { url: o.url },
    };
  },
});

registry.register({
  name: "board.create",
  layer: "A",
  description:
    "创建看板：点击 Add Board → 填看板名 → 选择所属项目（必填）→ 提交。需指定 project。",
  params: z.object({
    name: z.string().min(1).describe("新看板名称"),
    project: z.string().min(1).describe("所属项目名（必填，如 'Getting started'）"),
  }),
  run: async ({ name, project }, ctx) => {
    // 1. 打开 Add Board 模态（开启前只有一个 "Add Board"）
    await ctx.page.getByRole("button", { name: "Add Board" }).first().click({ timeout: 10_000 });
    await ctx.page.waitForTimeout(800);
    // 2. 填看板名
    const nameInput = ctx.page.getByPlaceholder("Enter board name...", { exact: false });
    await nameInput.waitFor({ timeout: 10_000 });
    await nameInput.fill(name);
    // 3. 选项目（可搜索下拉）：点开 → 点匹配项；失败则键入搜索 + selectFirstOnSearch
    const projInput = ctx.page.getByPlaceholder("Select project", { exact: false });
    await projInput.first().click();
    await ctx.page.waitForTimeout(400);
    const opt = ctx.page.getByRole("option", { name: project }).first();
    if (await opt.count().catch(() => 0)) {
      await opt.click();
    } else {
      await projInput.first().fill(project);
      await ctx.page.waitForTimeout(500);
      await ctx.page.keyboard.press("Enter");
    }
    await ctx.page.waitForTimeout(300);
    // 4. 提交：模态提交按钮也叫 "Add Board"，DOM 顺序在开启按钮之后 → 取 .last()
    const addBtns = ctx.page.getByRole("button", { name: "Add Board" });
    if ((await addBtns.count()) >= 2) {
      await addBtns.last().click();
    } else {
      await nameInput.press("Enter");
    }
    await ctx.page.waitForTimeout(1500);
    await ctx.session.waitForReady();
    const o = await ctx.session.observe();
    const created = o.elements.some((e) => e.name.includes(name));
    return {
      ok: created,
      summary: created ? `已创建看板 "${name}"（项目 ${project}）` : `已提交创建看板 "${name}"（请在观察中确认）`,
      data: { name, project, url: o.url, confirmed: created },
    };
  },
});

registry.register({
  name: "board.open",
  layer: "A",
  description: "打开指定名称的看板（在侧边栏点击该看板）。",
  params: z.object({ name: z.string().min(1).describe("要打开的看板名") }),
  run: async ({ name }, ctx) => {
    const link = ctx.page.getByRole("link", { name }).first();
    await link.waitFor({ timeout: 10_000 });
    await link.click();
    await ctx.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await ctx.page.waitForTimeout(2000);
    const o = await ctx.session.observe();
    return {
      ok: true,
      summary: `已打开看板 "${name}"；URL=${o.url}，${o.elements.length} 元素`,
      data: { name, url: o.url },
    };
  },
});

registry.register({
  name: "card.create",
  layer: "A",
  description: "在当前看板的第一个列表底部创建卡片：点击 + Add Card → 填标题 → Enter。需先处于某个看板视图。",
  params: z.object({ title: z.string().min(1).describe("卡片标题") }),
  run: async ({ title }, ctx) => {
    const addCard = ctx.page.getByRole("button", { name: /\+\s*add card/i }).first();
    await addCard.waitFor({ timeout: 10_000 });
    await addCard.click();
    await ctx.page.waitForTimeout(500);
    // 卡片标题输入框（一般 placeholder 含 "card" 或为空文本框）
    const titleInput = ctx.page.locator('textarea:visible, input:visible').last();
    await titleInput.waitFor({ timeout: 5_000 });
    await titleInput.fill(title);
    await ctx.page.keyboard.press("Enter");
    await ctx.page.waitForTimeout(1000);
    const o = await ctx.session.observe();
    const created = o.elements.some((e) => e.name.includes(title));
    return {
      ok: created,
      summary: created ? `已创建卡片 "${title}"` : `已提交创建卡片 "${title}"（请在观察中确认）`,
      data: { title, url: o.url, confirmed: created },
    };
  },
});
