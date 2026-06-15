// A 层 · 领域工具（照 4gaBoardsDocs 写，驱动真实 UI，返回结构化状态）。
// P0 种子：auth.login / board.create / board.open / card.create。
// card.* 选择器基于 docs 描述，将在 P1.5 按板视图实际 DOM 校准。

import { z } from "zod";
import type { Locator, Page } from "playwright";
import { registry, type TraceStep } from "./registry";

// 设置页基础：demo 域名 + 等待设置表格渲染（4gaBoards 设置页异步 fetch core settings，慢）。
const DEMO_ORIGIN = (process.env.TARGET_APP_DEMO_URL ?? "https://demo.4gaboards.com").replace(/\/+$/, "");

const SETTINGS_WAIT_TEXT: Record<string, string> = {
  preferences: "text=/Preferences|Theme|Language|Modify settings|Current Value|General/i",
  account: "text=/Account|Username|Email|Name|Profile/i",
  users: "text=/Users|Admin|Username|Add User/i",
};

/** 进入指定设置页并等表格渲染（不能只 networkidle，会停在 Loading Spinner）。 */
async function openSettingsPage(page: Page, kind: "preferences" | "account" | "users") {
  await page.goto(`${DEMO_ORIGIN}/settings/${kind}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector(SETTINGS_WAIT_TEXT[kind] ?? "text=/Settings/i", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1500); // 让 socket 数据落表
}

/** 读某设置行的文本（压缩空白、截断），作判官核对 Current Value 的证据。 */
async function readRowText(row: Locator): Promise<string> {
  return (await row.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
}

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

registry.register({
  name: "settings_open",
  layer: "A",
  description:
    "导航到 4gaBoards 设置页（preferences 偏好 / account 账户 / users 用户管理）。走真实 UI 路由跳转，等设置表格渲染完成（异步加载较慢，内置等待），trace 回报打开后的页面观察。每次操作 settings_* 工具前先调用，确保在正确页面。",
  params: z.object({
    page: z
      .enum(["preferences", "account", "users"])
      .describe("设置页：preferences=偏好(开关/下拉/语言/主题)；account=账户资料；users=用户管理"),
  }),
  run: async ({ page: kind }, ctx) => {
    const trace: TraceStep[] = [];
    await openSettingsPage(ctx.page, kind);
    const o = await ctx.session.observe();
    trace.push({ label: `已打开 ${kind} 设置页`, observation: o.text });
    return {
      ok: true,
      summary: `已导航到 ${kind} 设置页；URL=${o.url}，可见 ${o.elements.length} 元素`,
      data: { page: kind, url: o.url },
      trace,
    };
  },
});

registry.register({
  name: "settings_toggle",
  layer: "A",
  description:
    "切换 preferences 偏好设置里的某个开关（如 Compact Sidebar / Subscribe to new boards / Hide Card Modal Activity / Hide Closest Due Date / Email Notifications）。驱动真实 UI：点开关圆点 span.switchRound 翻转，不走后端 API。幂等：可指定 want=on/off，已满足则跳过。trace 回报点击前 checked、点击后 checked、所在行文本（含 Current Value 的 Enabled/Disabled）。",
  params: z.object({
    name: z
      .string()
      .min(1)
      .describe(
        "设置项名（preferences 页左侧列文本，如 'Compact Sidebar'、'Subscribe to new boards'、'Hide Card Modal Activity'）。给完整名称避免子串歧义。",
      ),
    want: z
      .enum(["on", "off"])
      .optional()
      .describe("目标状态。on=开启，off=关闭；不填则强制翻转一次"),
    index: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("同名/同子串开关有多个时（如 5 个 Subscribe），指定第几个（0-based，默认 0）"),
  }),
  run: async ({ name, want, index }, ctx) => {
    const trace: TraceStep[] = [];
    const idx = index ?? 0;
    const rows = ctx.page.locator("tr, [role=row]").filter({ hasText: name });
    const count = await rows.count().catch(() => 0);
    if (count === 0) {
      return { ok: false, summary: `未找到设置项 "${name}"（确认已先 settings_open 到 preferences 页）`, trace };
    }
    const row = rows.nth(Math.min(idx, count - 1));
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await ctx.page.waitForTimeout(200);

    const checkbox = row.locator('input[class*="Radio_input"]').first();
    const before = await checkbox.isChecked().catch(() => null);
    if (before === null) {
      return { ok: false, summary: `"${name}" 行没有开关控件（可能是下拉项，改用 settings_select）`, trace };
    }
    const wantChecked = want === "on" ? true : want === "off" ? false : !before;
    trace.push({ label: `读 "${name}" 当前状态`, observation: `checked=${before}（目标=${wantChecked}）` });

    if (before === wantChecked) {
      trace.push({ label: `已处于目标状态，跳过（幂等）`, observation: await readRowText(row) });
      return {
        ok: true,
        summary: `"${name}" 已是 ${before ? "on" : "off"}，无需切换`,
        data: { name, before, after: before, want: wantChecked, skipped: true },
        trace,
      };
    }

    await row.locator('span[class*="switchRound"]').first().click({ timeout: 10_000 });
    await ctx.page.waitForTimeout(900); // onUpdate → socket 写库 → 表格重渲染
    const after = await checkbox.isChecked().catch(() => null);
    trace.push({
      label: `点击开关后`,
      observation: `checked ${before}→${after}；行文本：${await readRowText(row)}`,
    });
    const o = await ctx.session.observe();
    trace.push({ label: `切换后页面观察`, observation: o.text });
    const ok = after === wantChecked;
    return {
      ok,
      summary: ok
        ? `"${name}" ${before ? "on" : "off"}→${after ? "on" : "off"}`
        : `"${name}" 切换后 checked=${after}（期望 ${wantChecked}）`,
      data: { name, before, after, want: wantChecked, confirmed: ok, url: o.url },
      trace,
    };
  },
});

registry.register({
  name: "settings_select",
  layer: "A",
  description:
    "在 preferences 偏好设置里选某个下拉/选项值（如 Language=中文 / Theme=GitHub Dark / Default View=Board View / List View Style=Compact / Preferred Details Font=Monospace / Users Settings Style=Default / Theme Shape=Rounded）。驱动真实 UI：可搜索 Dropdown 用键入+Tab 选中（selectFirstOnSearch 自动命中首项）；按钮行选项（如 Theme Shape）点对应按钮。trace 回报每步与选择后行文本（Current Value 列）。",
  params: z.object({
    name: z
      .string()
      .min(1)
      .describe(
        "设置项名（如 'Language'、'Theme'、'Default View'、'List View Style'、'Preferred Details Font'、'Users Settings Style'、'Theme Shape'）",
      ),
    value: z
      .string()
      .min(1)
      .describe(
        "目标值文本（与选项/按钮 title 一致，如 '中文'、'GitHub Dark'、'Board View'、'Compact'、'Monospace'、'Default'、'Rounded'）",
      ),
  }),
  run: async ({ name, value }, ctx) => {
    const trace: TraceStep[] = [];
    const rows = ctx.page.locator("tr, [role=row]").filter({ hasText: name });
    if ((await rows.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `未找到设置项 "${name}"（确认已先 settings_open 到 preferences 页）`, trace };
    }
    const row = rows.nth(0);
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await ctx.page.waitForTimeout(200);

    const dropdownInput = row.locator('input[class*="Dropdown_dropdownSearchInput"]').first();
    const isDropdown = (await dropdownInput.count().catch(() => 0)) > 0;

    if (isDropdown) {
      // 可搜索 Dropdown：键入 + Tab（selectFirstOnSearch 命中首项 + 关闭浮层），复用 board_create 模式
      await dropdownInput.click({ timeout: 10_000 });
      await ctx.page.waitForTimeout(300);
      await dropdownInput.fill(value);
      await ctx.page.waitForTimeout(450); // 等过滤
      await ctx.page.keyboard.press("Tab");
      await ctx.page.waitForTimeout(500);
      trace.push({ label: `在下拉 "${name}" 里键入 "${value}" 并 Tab 选中` });
    } else {
      // 按钮行（如 Theme Shape）：按 title → 按钮名 → 文本回退定位
      let target = row.locator(`button[title="${value}"]`).first();
      if ((await target.count().catch(() => 0)) === 0) target = row.getByRole("button", { name: value }).first();
      if ((await target.count().catch(() => 0)) === 0) target = row.locator("button").filter({ hasText: value }).first();
      if ((await target.count().catch(() => 0)) === 0) {
        return { ok: false, summary: `"${name}" 行未找到值 "${value}" 的按钮/选项`, trace };
      }
      await target.click({ timeout: 10_000 });
      await ctx.page.waitForTimeout(500);
      trace.push({ label: `点击选项按钮 "${value}"` });
    }

    await ctx.page.waitForTimeout(600);
    const rowText = await readRowText(row);
    trace.push({ label: `选择后行文本`, observation: rowText }); // Current Value 列（input.value 不可靠）
    const o = await ctx.session.observe();
    trace.push({ label: `选择后页面观察`, observation: o.text });
    const confirmed = rowText.toLowerCase().includes(value.toLowerCase());
    return {
      ok: true,
      summary: `已将 "${name}" 设为 "${value}"${confirmed ? "（行文本已确认）" : "（请在观察中确认）"}`,
      data: { name, value, rowText, confirmed, url: o.url },
      trace,
    };
  },
});
