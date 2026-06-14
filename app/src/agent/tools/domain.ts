// A 层 · 领域工具（照 4gaBoardsDocs 写，驱动真实 UI，返回结构化状态）。
// P0 种子：auth.login / board.create / board.open / card.create。
// card.* 选择器基于 docs 描述，将在 P1.5 按板视图实际 DOM 校准。

import { z } from "zod";
import { registry, type TraceStep } from "./registry";

registry.register({
  name: "auth_login",
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
  name: "board_create",
  layer: "A",
  description:
    "创建看板（一步完成，比手动多步更稳）：点击 Add Board → 填看板名 → 选项目(必填) → 可选选模板 → 提交。可搜索下拉用键入+Tab 方式，避免浮层遮挡。",
  params: z.object({
    name: z.string().min(1).describe("新看板名称"),
    project: z.string().min(1).describe("所属项目名（必填，如 'Getting started'）"),
    template: z
      .string()
      .optional()
      .describe("模板名（可选，如 'Simple' 会带预置列表；不填用 Empty 空模板）"),
  }),
  run: async ({ name, project, template }, ctx) => {
    const trace: TraceStep[] = [];
    // 模态内可搜索下拉的输入框：第 0 个=项目，第 1 个=模板
    const dropdownSearch = ctx.page.locator('[class*="Dropdown_dropdownSearchInput"]');
    const nameInput = ctx.page.getByPlaceholder("Enter board name...", { exact: false });
    // 1. 打开 Add Board 模态（幂等：若已打开则跳过，避免 agent 先手动开过、再重复点 opener）
    if (!(await nameInput.isVisible().catch(() => false))) {
      await ctx.page.getByRole("button", { name: "Add Board" }).first().click({ timeout: 10_000 });
      await ctx.page.waitForTimeout(800);
    }
    await nameInput.waitFor({ timeout: 10_000 });
    // 记录模态打开后的观察（判官核对段落1"弹窗出现/含输入框、模板、导入"用）
    trace.push({ label: "打开 Add Board 模态", observation: (await ctx.session.observe()).text });
    // 2. 看板名
    await nameInput.fill(name);
    trace.push({ label: `填看板名 "${name}"` });
    // 3. 项目：键入搜索（selectFirstOnSearch 自动选中）+ Tab 关闭下拉
    const projInput = dropdownSearch.nth(0);
    await projInput.click({ timeout: 10_000 });
    await ctx.page.waitForTimeout(300);
    await projInput.fill(project);
    await ctx.page.waitForTimeout(450);
    await ctx.page.keyboard.press("Tab");
    await ctx.page.waitForTimeout(300);
    trace.push({ label: `选项目 "${project}"` });
    // 4. 模板（可选）：同样键入搜索 + Tab
    if (template) {
      const tplInput = dropdownSearch.nth(1);
      await tplInput.click({ timeout: 10_000 });
      await ctx.page.waitForTimeout(300);
      await tplInput.fill(template);
      await ctx.page.waitForTimeout(450);
      await ctx.page.keyboard.press("Tab");
      await ctx.page.waitForTimeout(300);
      trace.push({ label: `选模板 "${template}"` });
    }
    // 5. 提交：模态提交按钮也叫 "Add Board"，DOM 顺序在开启按钮之后 → .last()
    const addBtns = ctx.page.getByRole("button", { name: "Add Board" });
    if ((await addBtns.count()) >= 2) {
      await addBtns.last().click();
    } else {
      await nameInput.press("Enter");
    }
    await ctx.page.waitForTimeout(1500);
    await ctx.session.waitForReady();
    let o = await ctx.session.observe();
    trace.push({ label: "提交创建后", observation: o.text });
    const created = o.elements.some((e) => e.name.includes(name));
    if (created) {
      // 打开新看板，提供"看板视图/预置列表"证据（板视图列表经 socket 加载，需等待）
      const link = ctx.page.getByRole("link", { name }).first();
      await link.click({ timeout: 10_000 }).catch(() => {});
      await ctx.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await ctx.page.waitForTimeout(3000);
      o = await ctx.session.observe();
      trace.push({ label: "打开新看板视图", observation: o.text });
    }
    return {
      ok: created,
      summary: created
        ? `已创建看板 "${name}"（项目 ${project}${template ? `，模板 ${template}` : ""}）`
        : `已提交创建看板 "${name}"（请在观察中确认）`,
      data: { name, project, template, url: o.url, confirmed: created },
      trace,
    };
  },
});

registry.register({
  name: "board_open",
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
  name: "card_create",
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
