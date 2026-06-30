// A 层 · 领域工具（照 4gaBoardsDocs 写，驱动真实 UI，返回结构化状态）。
// P0 种子：auth.login / board.create / board.open / card.create。
// card.* 选择器基于 docs 描述，将在 P1.5 按板视图实际 DOM 校准。

import { z } from "zod";
import type { Locator, Page } from "playwright";
import { registry, type TraceStep, type ToolContext } from "./registry";

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

// ── 视图与卡片的通用 helper（card_open / view_switch / list_view_* / card_edit_description 共用）──

/** 拼 namespace 全名：批量资源加前缀，单场景 namespace 为空则原名。 */
function namespaced(ctx: ToolContext, name: string): string {
  return ctx.namespace ? `${ctx.namespace}-${name}` : name;
}

/** 若当前在卡片详情页（/cards/:id），Escape 关闭 modal——它会遮挡视图切换按钮与列表视图列头。返回是否关闭过。 */
async function closeCardModalIfOpen(page: Page): Promise<boolean> {
  if (page.url().includes("/cards/")) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

/** 当前是否处于列表视图（DOM 特征：表格列头；视图切换不改变 URL，不能靠 url() 判定）。 */
async function isListView(page: Page): Promise<boolean> {
  return (await page.locator('th[class*="headerCell"]').count().catch(() => 0)) > 0;
}

/** 确保卡片详情 modal 已打开（card_open + card_edit_description 共用）。双回退查 card：namespace 全名 → 原名。 */
async function ensureCardOpen(
  page: Page,
  ctx: ToolContext,
  cardName: string,
): Promise<{ ok: boolean; fullName: string; url: string; reason?: string }> {
  const fullName = namespaced(ctx, cardName);
  // 幂等：同名 card modal 已开
  if (page.url().includes("/cards/") && (await page.getByRole("dialog").isVisible().catch(() => false))) {
    return { ok: true, fullName, url: page.url() };
  }
  let card = page.locator(`[class*="Card_name"][title="${fullName}"]`).first();
  if ((await card.count().catch(() => 0)) === 0) {
    card = page.locator(`[class*="Card_name"][title="${cardName}"]`).first();
    if ((await card.count().catch(() => 0)) === 0) {
      return { ok: false, fullName, url: page.url(), reason: `未找到卡片 "${cardName}"（确认在看板视图且名称准确）` };
    }
  }
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await card.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800); // socket 拉 card 详情
  const opened = page.url().includes("/cards/") || (await page.getByRole("dialog").isVisible().catch(() => false));
  return { ok: opened, fullName, url: page.url(), reason: opened ? undefined : "点击卡片后详情 modal 未出现" };
}

/** 确保处于列表视图（不在则点切换按钮；card modal 残留先关）。返回是否触发了切换。 */
async function ensureListView(page: Page): Promise<boolean> {
  await closeCardModalIfOpen(page);
  if (await isListView(page)) return false;
  const btn = page.getByTitle(/switch to list view|切换到列表视图/i).first();
  if ((await btn.count().catch(() => 0)) === 0) return false;
  await btn.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.waitForSelector('th[class*="headerCell"]', { timeout: 15_000 }).catch(() => {});
  return true;
}

/** 确保处于看板视图（不在则切；card modal 残留先关）。看板视图特征=List_headerName。返回是否触发切换。 */
async function ensureBoardView(page: Page): Promise<boolean> {
  await closeCardModalIfOpen(page);
  if ((await page.locator('[class*="List_headerName"]').count().catch(() => 0)) > 0) return false;
  const btn = page.getByTitle(/switch to board view|切换到看板视图/i).first();
  if ((await btn.count().catch(() => 0)) === 0) return false;
  await btn.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.waitForSelector('[class*="List_headerName"]', { timeout: 15_000 }).catch(() => {});
  return true;
}

/**
 * 进卡片描述编辑态：点 Edit/Add Description 入口 → 等 @uiw/react-md-editor textarea。
 * card_edit_description 与 card_text_editor 共用。返回 textarea locator 与失败原因。
 */
async function enterDescriptionEdit(
  page: Page,
): Promise<{ ok: boolean; textarea: Locator | null; reason?: string }> {
  let entry = page.getByTitle(/edit description|编辑描述/i).first();
  if ((await entry.count().catch(() => 0)) === 0) {
    entry = page.getByTitle(/add description|添加描述/i).first();
  }
  if ((await entry.count().catch(() => 0)) === 0) {
    return { ok: false, textarea: null, reason: "卡片详情里未找到描述编辑入口" };
  }
  await entry.scrollIntoViewIfNeeded().catch(() => {});
  await entry.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForSelector(".w-md-editor-text-input", { timeout: 8_000 }).catch(() => {});
  const ta = page.locator(".w-md-editor-text-input").first();
  if ((await ta.count().catch(() => 0)) === 0) {
    return { ok: false, textarea: null, reason: "描述编辑器 textarea 未出现" };
  }
  return { ok: true, textarea: ta };
}

/**
 * 读 @uiw md-editor 当前显示模式。模式由根节点 class 指示（recon 实测）：
 * w-md-editor-show-edit / w-md-editor-show-live / w-md-editor-show-preview；
 * 全屏：根节点或 body 带 fullscreen 类，兜底用编辑器高度≈视口。
 */
async function readEditorMode(
  page: Page,
): Promise<{ mode: "edit" | "live" | "preview" | null; edit: boolean; preview: boolean; fullscreen: boolean }> {
  const cls = (await page.locator(".w-md-editor").first().getAttribute("class").catch(() => "")) ?? "";
  const edit = /\bw-md-editor-show-edit\b/.test(cls);
  const live = /\bw-md-editor-show-live\b/.test(cls);
  const preview = /\bw-md-editor-show-preview\b/.test(cls);
  const mode = edit ? "edit" : live ? "live" : preview ? "preview" : null;
  const fsClass = /fullscreen/i.test(cls) || (await page.locator("[class*='fullscreen']").count().catch(() => 0)) > 0;
  const editorBox = await page.locator(".w-md-editor").first().boundingBox().catch(() => null);
  const viewportH = page.viewportSize()?.height ?? 0;
  const fullscreen = fsClass || (!!editorBox && viewportH > 0 && editorBox.height >= viewportH * 0.85);
  return { mode, edit: edit || live, preview: preview || live, fullscreen };
}

registry.register({
  name: "auth_login",
  layer: "A",
  description: "用 .env 凭据登录 4gaBoards demo（走真实登录表单：填 email/username + password 并提交）。若账号不存在（demo 站清理过闲置账号），自动用同组凭据注册后再登录。",
  params: z.object({}),
  run: async (_args, ctx) => {
    await ctx.session.login();
    const o = await ctx.session.observe();
    const loggedIn = !o.url.includes("/login");
    return {
      ok: loggedIn,
      summary: loggedIn
        ? `已登录 4gaBoards；URL=${o.url}，可见 ${o.elements.length} 个元素`
        : `登录失败：仍停在登录页（URL=${o.url}）`,
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
    // 批量命名空间：资源加前缀，便于批尾清理与并发隔离（单场景 namespace 为空，行为不变）
    const fullName = ctx.namespace ? `${ctx.namespace}-${name}` : name;
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
    await nameInput.fill(fullName);
    trace.push({ label: `填看板名 "${fullName}"` });
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
    const created = o.elements.some((e) => e.name.includes(fullName));
    if (created) {
      // 打开新看板，提供"看板视图/预置列表"证据（板视图列表经 socket 加载，需等待）
      const link = ctx.page.getByRole("link", { name: fullName }).first();
      await link.click({ timeout: 10_000 }).catch(() => {});
      await ctx.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await ctx.page.waitForTimeout(3000);
      o = await ctx.session.observe();
      trace.push({ label: "打开新看板视图", observation: o.text });
    }
    return {
      ok: created,
      summary: created
        ? `已创建看板 "${fullName}"（项目 ${project}${template ? `，模板 ${template}` : ""}）`
        : `已提交创建看板 "${fullName}"（请在观察中确认）`,
      data: { name: fullName, project, template, url: o.url, confirmed: created },
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
    // 优先找命名空间前缀的全名（本批创建的资源），找不到回退原 name（非本批/预存资源）
    const fullName = ctx.namespace ? `${ctx.namespace}-${name}` : name;
    let link = ctx.page.getByRole("link", { name: fullName }).first();
    if ((await link.count().catch(() => 0)) === 0) link = ctx.page.getByRole("link", { name }).first();
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
  description: "在当前看板的第一个列表底部创建卡片：点击 Add Card → 填标题 → Enter。需先处于某个看板视图。",
  params: z.object({ title: z.string().min(1).describe("卡片标题") }),
  run: async ({ title }, ctx) => {
    const fullTitle = ctx.namespace ? `${ctx.namespace}-${title}` : title;
    // 等看板视图 list 渲染（board_create 后立即 card_create 时，list 经 socket 加载较慢）
    await ctx.page.waitForSelector('[class*="List_headerName"]', { timeout: 20_000 }).catch(() => {});
    const addCard = ctx.page.getByRole("button", { name: /add card/i }).first();
    await addCard.waitFor({ timeout: 15_000 });
    await addCard.click();
    await ctx.page.waitForTimeout(800);
    // card 创建框是全局 textarea（placeholder "Enter card name..."），不在 list draggable 内
    const titleInput = ctx.page.getByPlaceholder(/enter card name/i).first();
    await titleInput.waitFor({ timeout: 8_000 });
    await titleInput.fill(fullTitle);
    await ctx.page.keyboard.press("Enter");
    await ctx.page.waitForTimeout(1000);
    // observe 看不到 card（card 是 div 无 role，不在 INTERACTIVE_SELECTOR），用语义 selector 直接确认
    const card = ctx.page.locator(`[class*="Card_name"][title="${fullTitle}"]`);
    const created = (await card.count().catch(() => 0)) > 0;
    const o = await ctx.session.observe();
    return {
      ok: created,
      summary: created ? `已创建卡片 "${fullTitle}"` : `已提交创建卡片 "${fullTitle}"（请在观察中确认）`,
      data: { title: fullTitle, url: o.url, confirmed: created },
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

registry.register({
  name: "card_drag",
  layer: "A",
  description:
    "把当前看板视图里的某张卡片拖到指定列表（看板核心交互）。驱动真实拖拽：用 page.mouse down→多步 move→up 模拟 react-beautiful-dnd（不能用 click/dragAndDrop——click 会打开卡片详情、dragAndDrop 不触发 onDragEnd）。trace 回报拖动前后卡片所在的列表（data-rbd-droppable-id）。需先处于某看板视图。",
  params: z.object({
    cardName: z.string().min(1).describe("要拖动的卡片标题（与卡片显示名一致）"),
    targetListName: z.string().min(1).describe("目标列表名（列表标题，如 Open / Todo / In Progress / Done）"),
  }),
  run: async ({ cardName, targetListName }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;

    // 定位 card：标题锚点 → 上溯到 rbd draggable 根（observation 看不到 card 根，必须语义 selector）
    const cardTitle = page.locator(`[class*="Card_name"][title="${cardName}"]`).first();
    if ((await cardTitle.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `未找到卡片 "${cardName}"（确认在看板视图且卡片名准确）`, trace };
    }
    const cardRoot = cardTitle.locator("xpath=ancestor::*[@data-rbd-draggable-id][1]").first();
    const cardBox = await cardRoot.boundingBox();
    if (!cardBox) return { ok: false, summary: `卡片 "${cardName}" 无法取坐标`, trace };

    // 定位目标 list 的 drop 区：标题锚点 → list 根 → 内部主 droppable（^="list:" 排除 listAdd:/listCollapsed:）
    const listHeader = page.locator(`[class*="List_headerName"][title="${targetListName}"]`).first();
    if ((await listHeader.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `未找到列表 "${targetListName}"`, trace };
    }
    const listRoot = listHeader.locator("xpath=ancestor::*[@data-rbd-draggable-id][1]").first();
    const dropZone = listRoot.locator('[data-rbd-droppable-id^="list:"]').first();
    const targetBox = await dropZone.boundingBox();
    if (!targetBox) return { ok: false, summary: `列表 "${targetListName}" 的拖放区无法取坐标`, trace };
    const targetDropId = await dropZone.getAttribute("data-rbd-droppable-id").catch(() => "?");

    const beforeList = await cardRoot
      .evaluate((el) => el.closest("[data-rbd-droppable-id]")?.getAttribute("data-rbd-droppable-id") ?? "?")
      .catch(() => "?");
    trace.push({ label: `拖动前卡片所在 droppable=${beforeList}（目标 ${targetDropId}）` });

    // 拖拽：move 到 card 中心 → down → 多步插值 move 到 list 中心 → up（rbd 需连续 move 触发 lift/drop）
    const sx = cardBox.x + cardBox.width / 2;
    const sy = cardBox.y + cardBox.height / 2;
    const ex = targetBox.x + targetBox.width / 2;
    const ey = targetBox.y + targetBox.height / 2;
    await page.mouse.move(sx, sy);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t, { steps: 1 });
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(1000); // 等 onDragEnd → moveCard → socket 写库

    const afterList = await cardRoot
      .evaluate((el) => el.closest("[data-rbd-droppable-id]")?.getAttribute("data-rbd-droppable-id") ?? "?")
      .catch(() => "?");
    trace.push({ label: `拖动后卡片所在 droppable=${afterList}` });
    const ok = afterList !== "?" && afterList === targetDropId;
    return {
      ok,
      summary: ok
        ? `已把卡片 "${cardName}" 拖到列表 "${targetListName}"`
        : `已拖动 "${cardName}"（拖后=${afterList}，目标=${targetDropId}，请观察确认）`,
      data: { cardName, targetListName, beforeList, afterList, targetDropId, confirmed: ok },
      trace,
    };
  },
});

registry.register({
  name: "card_open",
  layer: "A",
  description:
    "打开某张卡片的详情弹窗（点击卡片标题，URL 变 /cards/:id）。是编辑描述/标签/截止日期/移动等卡片操作的前置。幂等：若同名 card modal 已打开则跳过。card 名会自动加 namespace 前缀（批量场景给创建时的短名即可）。trace 回报打开前后的页面观察。",
  params: z.object({
    cardName: z.string().min(1).describe("卡片标题（与卡片显示名一致；批量场景用创建时的短名）"),
  }),
  run: async ({ cardName }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    trace.push({ label: "点击卡片前", observation: (await ctx.session.observe()).text });
    const r = await ensureCardOpen(page, ctx, cardName);
    if (!r.ok) {
      return {
        ok: false,
        summary: r.reason ?? `未能打开卡片 "${cardName}"`,
        data: { cardName, fullName: r.fullName, url: r.url },
        trace,
      };
    }
    const o = await ctx.session.observe();
    trace.push({ label: "已打开卡片详情", observation: o.text });
    return {
      ok: true,
      summary: `已打开卡片 "${r.fullName}" 详情；URL=${r.url}`,
      data: { cardName, fullName: r.fullName, url: r.url, modalOpened: true, confirmed: true },
      trace,
    };
  },
});

registry.register({
  name: "view_switch",
  layer: "A",
  description:
    "在当前看板切换视图：board=看板视图（卡片列表拖拽）；list=列表视图（表格列、可排序/列显隐/适应宽度）。驱动真实 UI：点视图切换按钮（switchViewButton）。幂等：已处于目标视图则跳过。若卡片详情弹窗开着会先关闭（否则遮挡按钮）。trace 回报切换前后视图观察。",
  params: z.object({
    view: z.enum(["board", "list"]).describe("目标视图：board=看板视图；list=列表视图"),
  }),
  run: async ({ view }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    const closedModal = await closeCardModalIfOpen(page);
    if (closedModal) trace.push({ label: "关闭残留卡片详情弹窗" });

    const btn = page
      .getByTitle(view === "board" ? /switch to board view|切换到看板视图/i : /switch to list view|切换到列表视图/i)
      .first();
    if ((await btn.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `未找到切换到 ${view} 视图的按钮（确认在某个看板页）`, trace };
    }
    const beforeActive = await btn.evaluate((el) => (el.className || "").includes("active")).catch(() => false);
    trace.push({ label: `读当前视图：${view} active=${beforeActive}` });

    if (!beforeActive) {
      await btn.click({ timeout: 10_000 }).catch(() => {});
      // 视图切换不改变 URL，靠 DOM 特征等渲染
      if (view === "list") {
        await page.waitForSelector('th[class*="headerCell"]', { timeout: 15_000 }).catch(() => {});
      } else {
        await page.waitForSelector('[class*="List_headerName"]', { timeout: 15_000 }).catch(() => {});
      }
      await page.waitForTimeout(800);
    }

    const confirmed =
      view === "list"
        ? await isListView(page)
        : (await page.locator('[class*="List_headerName"]').count().catch(() => 0)) > 0;
    const o = await ctx.session.observe();
    trace.push({ label: "切换后视图观察", observation: o.text });
    // beforeActive 说明已处于目标视图（即使 DOM 特征未匹配也算成功）
    const ok = confirmed || beforeActive;
    return {
      ok,
      summary: beforeActive
        ? `已处于 ${view} 视图${confirmed ? "（幂等跳过）" : ""}`
        : confirmed
          ? `已切换到 ${view} 视图`
          : `已点击切换到 ${view} 视图（请在观察中确认）`,
      data: { view, beforeActive, confirmed, url: o.url },
      trace,
    };
  },
});

registry.register({
  name: "card_edit_description",
  layer: "A",
  description:
    "编辑某张卡片的描述（markdown）。驱动真实 UI：打开卡片详情 → 进描述编辑 → 填文本 → 提交（Save 或 Ctrl+Enter）。幂等打开 modal。trace 回报编辑前后描述区文本。card 名自动加 namespace 前缀。",
  params: z.object({
    cardName: z.string().min(1).describe("卡片标题（工具自动加 namespace 前缀）"),
    text: z.string().describe("要写入的描述文本（markdown）"),
    submit: z
      .enum(["save", "ctrl_enter"])
      .optional()
      .describe("提交方式：save=点 Save 按钮；ctrl_enter=Ctrl+Enter 快捷键；默认 save"),
  }),
  run: async ({ cardName, text, submit }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    // 1. 确保卡片 modal 打开
    const r = await ensureCardOpen(page, ctx, cardName);
    if (!r.ok) {
      trace.push({ label: `打开卡片失败：${r.reason}` });
      return { ok: false, summary: r.reason ?? `未能打开卡片 "${cardName}"`, data: { cardName }, trace };
    }
    trace.push({ label: `已打开卡片 "${r.fullName}" 详情` });

    // 2. 进描述编辑态（enterDescriptionEdit：Edit/Add Description 入口 → 等 md-editor textarea）
    const ed = await enterDescriptionEdit(page);
    if (!ed.ok || !ed.textarea) {
      return { ok: false, summary: ed.reason ?? `卡片 "${r.fullName}" 详情里未找到描述编辑入口`, data: { cardName: r.fullName }, trace };
    }
    const ta = ed.textarea;
    trace.push({ label: "点击描述编辑入口" });

    // 4. 填文本（fill 自动清空；@uiw/md-editor 的 fill 偶不触发 onChange，失败回退 keyboard.type）
    await ta.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(200);
    await ta.fill(text).catch(async () => {
      trace.push({ label: "fill 未触发 onChange，回退 keyboard.type" });
      await page.keyboard.type(text, { delay: 5 });
    });
    trace.push({ label: `填描述文本（${text.length} 字符）` });

    // 5. 提交
    const mode = submit ?? "save";
    if (mode === "ctrl_enter") {
      await ta.press("Control+Enter");
      trace.push({ label: "Ctrl+Enter 提交" });
    } else {
      const save = page.getByRole("button", { name: /^save$|^保存$/i }).last();
      await save.click({ timeout: 8_000 }).catch(() => {});
      trace.push({ label: "点击 Save 提交" });
    }
    await page.waitForTimeout(1000); // onUpdate → socket 写库 → 重渲染为 MDPreview

    // 6. 确认：读描述区文本（MDPreview 渲染在 descriptionText）
    const descText = await page.locator('[class*="descriptionText"]').first().innerText().catch(() => "");
    const norm = descText.replace(/\s+/g, " ").trim();
    const preview = norm.slice(0, 200);
    const head = text.slice(0, 20).trim();
    const saved = head.length > 0 && norm.toLowerCase().includes(head.toLowerCase());
    trace.push({ label: "保存后描述区", observation: preview || "(空)" });
    const o = await ctx.session.observe();
    trace.push({ label: "最终观察", observation: o.text });
    return {
      ok: saved,
      summary: saved
        ? `已保存卡片 "${r.fullName}" 描述（${text.length} 字符）`
        : `已提交描述编辑（请在观察中确认；描述区="${preview}"）`,
      data: { cardName: r.fullName, text, submit: mode, saved, descriptionPreview: preview, url: o.url },
      trace,
    };
  },
});

registry.register({
  name: "list_view_menu_action",
  layer: "A",
  description:
    "在列表视图执行右上角 Ellipsis(Edit List View) 菜单动作：select_columns(打开列选择面板)/reset_visibility(重置列显示为默认)/fit_content(适应内容宽度)/fit_screen(适应屏幕宽度)/reset_sorting(重置列排序)。驱动真实 UI：自动切到列表视图 → 开菜单 → 点对应项。select_columns 会留在列选择面板（后续用 list_view_toggle_column 显隐列）。trace 回报切换/菜单/执行后观察。",
  params: z.object({
    action: z
      .enum(["select_columns", "reset_visibility", "fit_content", "fit_screen", "reset_sorting"])
      .describe(
        "select_columns=打开列选择面板；reset_visibility=重置列显示为默认；fit_content=适应内容宽度；fit_screen=适应屏幕宽度；reset_sorting=重置列排序",
      ),
  }),
  run: async ({ action }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    const switched = await ensureListView(page);
    if (switched) trace.push({ label: "已切换到列表视图" });

    const ellipsis = page.getByTitle(/edit list view|编辑列表视图/i).first();
    if ((await ellipsis.count().catch(() => 0)) === 0) {
      return { ok: false, summary: "未找到列表视图的 Edit List View(Ellipsis) 菜单按钮（确认已切到列表视图）", trace };
    }
    await ellipsis.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500); // FloatingPortal 渲染
    trace.push({ label: "已打开 Edit List View 菜单" });

    // fit_content / fit_screen 英文都含 "Adjust Columns to Fit"，按结尾区分；中文"重置列宽"(content) vs "适应屏幕宽度"(screen)
    const patterns: Record<string, RegExp> = {
      select_columns: /select columns|选择列/i,
      reset_visibility: /reset column visibility|重置列显示/i,
      fit_content: /adjust columns to fit content$|重置列宽$/i,
      fit_screen: /fit screen|适应屏幕宽度/i,
      reset_sorting: /reset column sorting|重置列排序/i,
    };
    const item = page.getByRole("button", { name: patterns[action] }).first();
    if ((await item.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `菜单中未找到 "${action}" 选项`, trace };
    }
    await item.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800); // socket 写 userPrefs

    const o = await ctx.session.observe();
    const extra: Record<string, unknown> = {};
    if (action === "select_columns") {
      extra.columnsPanelOpen = await page.getByText(/select columns|选择列/i).first().isVisible().catch(() => false);
    }
    trace.push({ label: `执行 ${action} 后`, observation: o.text });
    return {
      ok: true,
      summary:
        action === "select_columns"
          ? "已打开列选择面板（用 list_view_toggle_column 显隐列）"
          : `已执行列表视图菜单动作 ${action}`,
      data: { action, url: o.url, confirmed: true, ...extra },
      trace,
    };
  },
});

registry.register({
  name: "list_view_toggle_column",
  layer: "A",
  description:
    "在列表视图显示/隐藏某列（如 Name/Labels/List/Due Date/Tasks/Notifications 等）。驱动真实 UI：打开列选择面板 → 切换该列复选框(原生 input checkbox)。幂等：可指定 visible=on/off，已满足则跳过。trace 回报切换前后 checked + 列头可见性。",
  params: z.object({
    column: z.string().min(1).describe("列名（与列头 headerTitle 一致，如 Name/Labels/List/Due Date/Tasks/Notifications）"),
    visible: z.enum(["on", "off"]).optional().describe("目标显隐：on=显示；off=隐藏；不填则翻转一次"),
  }),
  run: async ({ column, visible }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    const switched = await ensureListView(page);
    if (switched) trace.push({ label: "已切换到列表视图" });

    // 开列选择面板：点 Ellipsis → Select Columns
    const ellipsis = page.getByTitle(/edit list view|编辑列表视图/i).first();
    await ellipsis.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /select columns|选择列/i }).first().click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(500);
    trace.push({ label: "已打开列选择面板" });

    // 定位该列的 checkbox：Checkbox 组件根 title=Toggle <column>，内部 input[type=checkbox]
    const toggle = page.getByTitle(new RegExp(`toggle ${column}|切换.*${column}`, "i")).first();
    if ((await toggle.count().catch(() => 0)) === 0) {
      await page.keyboard.press("Escape").catch(() => {});
      return { ok: false, summary: `列选择面板未找到列 "${column}" 的切换项`, trace };
    }
    const cb = toggle.locator('input[type="checkbox"]').first();
    const before = await cb.isChecked().catch(() => null);
    const wantChecked = visible === "on" ? true : visible === "off" ? false : before === null ? true : !before;
    trace.push({ label: `读 "${column}" checked=${before}（目标=${wantChecked}）` });

    if (before === wantChecked) {
      await page.keyboard.press("Escape").catch(() => {});
      const headerVisible = await page.getByRole("columnheader", { name: new RegExp(`^${column}$`, "i") }).first().isVisible().catch(() => false);
      trace.push({ label: `已处于目标状态（幂等）；列头可见=${headerVisible}` });
      return {
        ok: true,
        summary: `"${column}" 列已 ${wantChecked ? "显示" : "隐藏"}，无需切换`,
        data: { column, before, after: before, want: wantChecked, confirmed: true, headerVisible },
        trace,
      };
    }

    // setChecked 语义操作触发 onChange；失败回退 click
    await cb.setChecked(wantChecked).catch(() => cb.click({ timeout: 8_000 }).catch(() => {}));
    await page.waitForTimeout(600); // toggleVisibility → useEffect → onUserPrefsUpdate
    const after = await cb.isChecked().catch(() => null);
    await page.keyboard.press("Escape").catch(() => {}); // 关列选择子面板
    const headerVisible = await page
      .getByRole("columnheader", { name: new RegExp(`^${column}$`, "i") })
      .first()
      .isVisible()
      .catch(() => false);
    trace.push({ label: `切换后 checked=${after}；列头可见=${headerVisible}` });
    const o = await ctx.session.observe();
    trace.push({ label: "最终观察", observation: o.text });
    const ok = after === wantChecked || headerVisible === wantChecked;
    return {
      ok,
      summary: ok
        ? `"${column}" 列 checked ${before}→${after}（${wantChecked ? "显示" : "隐藏"}）`
        : `"${column}" 列切换后 checked=${after}（期望 ${wantChecked}），请观察确认`,
      data: { column, before, after, want: wantChecked, confirmed: ok, headerVisible },
      trace,
    };
  },
});

registry.register({
  name: "list_view_sort",
  layer: "A",
  description:
    "在列表视图按某列排序（升/降序）。驱动真实 UI：点列头切换排序。列排序是三态（未排序→asc/desc→移除，且不同列首次方向不同：Name/Labels/Due Date 默认升序优先，Notifications/Tasks/Timer 等降序优先），工具按目标 direction 循环点击到目标态（读 sortingIconRotated 判方向）。多列排序(shift+click)本工具不覆盖。trace 回报排序前后状态与点击次数。",
  params: z.object({
    column: z.string().min(1).describe("要排序的列名（列头 headerTitle，如 Name/Labels/Due Date/Tasks 等）"),
    direction: z.enum(["asc", "desc"]).optional().describe("目标方向：asc=升序；desc=降序；不填则点一次（按列首方向）"),
  }),
  run: async ({ column, direction }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    const switched = await ensureListView(page);
    if (switched) trace.push({ label: "已切换到列表视图" });

    // 精确匹配列名，避免 "Date" 命中 "Due Date"；回退 th[title]
    let header = page.getByRole("columnheader", { name: new RegExp(`^${column}$`, "i") }).first();
    if ((await header.count().catch(() => 0)) === 0) {
      header = page.locator(`th[title="${column}"]`).first();
      if ((await header.count().catch(() => 0)) === 0) {
        return { ok: false, summary: `列表视图未找到列头 "${column}"`, trace };
      }
    }

    // 读排序态：无 sortingIndicator=未排序；有 sortingIconRotated=降序，否则升序
    const readState = async (): Promise<"asc" | "desc" | null> => {
      const ind = header.locator('[class*="sortingIndicator"]').first();
      if ((await ind.count().catch(() => 0)) === 0) return null;
      const rotated = await ind.locator('[class*="sortingIconRotated"]').count().catch(() => 0);
      return rotated > 0 ? "desc" : "asc";
    };

    const before = await readState();
    trace.push({ label: `排序前 ${column}=${before ?? "未排序"}` });

    let cur = before;
    let clicks = 0;
    const target = direction ?? null;
    // 点到目标态（三态循环最多 3 次）；无目标时点 1 次
    while (clicks < (target ? 3 : 1)) {
      if (target && cur === target) break;
      await header.click({ timeout: 8_000 }).catch(() => {});
      clicks++;
      await page.waitForTimeout(400);
      cur = await readState();
      if (!target) break;
    }
    const o = await ctx.session.observe();
    trace.push({ label: `排序后 ${column}=${cur ?? "未排序"}（点 ${clicks} 次）`, observation: o.text });
    const confirmed = target ? cur === target : cur !== null;
    return {
      ok: confirmed,
      summary: confirmed
        ? `已按 ${column} ${cur ?? ""}排序`
        : `已点击 ${column} 列头 ${clicks} 次（当前=${cur ?? "未排序"}，目标=${target ?? "toggle"}）`,
      data: { column, before, after: cur, target: target ?? "toggle", clicks, confirmed },
      trace,
    };
  },
});

registry.register({
  name: "card_menu_action",
  layer: "A",
  description:
    "当场景涉及【复制链接/查看活动/复制卡片/移动/删除卡片】等卡片菜单操作时，【优先用本工具】一步完成，不要用 browser_click 手动 hover 卡片→点 Edit Card→点菜单项（多步易在浮层上失败）。点卡片省略号(Edit Card)菜单的某一项：copy_link(复制链接)/check_activity(查看活动)/duplicate(复制卡片)/move(移动卡片)/delete(删除卡片)/edit_members(编辑成员)/edit_labels(编辑标签)/edit_due_date(编辑到期)/edit_timer(编辑计时器)/edit_name(编辑名称)。驱动真实 UI：看板视图 hover 卡片显示省略号 → 点 Edit Card → 点菜单项。card 名自动加 namespace 前缀。copy_link/check_activity/duplicate 一步完成；edit_*/move/delete 点开后打开对应子面板（后续用 browser_click 或专用工具完成）。",
  params: z.object({
    cardName: z.string().min(1).describe("卡片标题（工具自动加 namespace 前缀）"),
    item: z
      .enum(["copy_link", "check_activity", "duplicate", "move", "delete", "edit_members", "edit_labels", "edit_due_date", "edit_timer", "edit_name"])
      .describe("菜单项"),
  }),
  run: async ({ cardName, item }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    await closeCardModalIfOpen(page);
    const switched = await ensureBoardView(page);
    if (switched) trace.push({ label: "已切换到看板视图" });

    const fullName = namespaced(ctx, cardName);
    let card = page.locator(`[class*="Card_name"][title="${fullName}"]`).first();
    if ((await card.count().catch(() => 0)) === 0) {
      card = page.locator(`[class*="Card_name"][title="${cardName}"]`).first();
      if ((await card.count().catch(() => 0)) === 0) {
        return { ok: false, summary: `未找到卡片 "${cardName}"（确认在看板视图且卡片名准确）`, trace };
      }
    }
    // hover 卡片让省略号(Edit Card)按钮显示（popupWrapper CSS hover）
    await card.hover().catch(() => {});
    await page.waitForTimeout(400);
    const menuBtn = page.getByTitle(/edit card|编辑卡片/i).first();
    if ((await menuBtn.isVisible().catch(() => false)) === false) {
      // 备用：直接点 class（hover 未触达时）
      await card.locator('xpath=../..').locator('button[class*="editCardButton"]').first().click({ timeout: 5_000 }).catch(() => {});
    } else {
      await menuBtn.click({ timeout: 8_000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    trace.push({ label: "已打开卡片菜单" });

    const patterns: Record<string, RegExp> = {
      copy_link: /copy link|复制链接/i,
      check_activity: /check activity|查看活动/i,
      duplicate: /duplicate card|复制卡片/i,
      move: /move card|移动卡片/i,
      delete: /delete card|删除卡片/i,
      edit_members: /edit members|编辑成员/i,
      edit_labels: /edit labels|编辑标签/i,
      edit_due_date: /edit due date|编辑到期时间/i,
      edit_timer: /edit timer|编辑时间/i,
      edit_name: /edit name|编辑名称/i,
    };
    const menuItem = page.getByRole("button", { name: patterns[item] }).first();
    if ((await menuItem.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `卡片菜单未找到 "${item}" 项`, trace };
    }
    await menuItem.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const o = await ctx.session.observe();
    trace.push({ label: `点击菜单项 ${item} 后`, observation: o.text });
    const oneShot = ["copy_link", "check_activity", "duplicate"].includes(item);
    return {
      ok: true,
      summary: oneShot
        ? `已执行卡片菜单 ${item}（卡片 "${fullName}"）`
        : `已打开卡片菜单 "${item}" 子面板（卡片 "${fullName}"），后续用 browser_click 或专用工具完成`,
      data: { cardName: fullName, item, url: o.url, confirmed: true },
      trace,
    };
  },
});

registry.register({
  name: "card_edit_title",
  layer: "A",
  description:
    "编辑卡片标题（在卡片详情 modal 点标题 → 输入新标题 → Enter 保存）。card 名自动加 namespace 前缀；新标题也会加前缀。trace 回报编辑前后标题。",
  params: z.object({
    cardName: z.string().min(1).describe("当前卡片标题（工具自动加 namespace 前缀定位）"),
    title: z.string().min(1).describe("新标题（工具自动加 namespace 前缀）"),
  }),
  run: async ({ cardName, title }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    const r = await ensureCardOpen(page, ctx, cardName);
    if (!r.ok) {
      return { ok: false, summary: r.reason ?? `未能打开卡片 "${cardName}"`, data: { cardName }, trace };
    }
    trace.push({ label: `已打开卡片 "${r.fullName}" 详情` });

    // 点标题进入编辑（headerTitle + cursorPointer）
    const titleDiv = page.locator('[class*="headerTitle"]').first();
    await titleDiv.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const ta = page.getByPlaceholder(/enter card name|输入卡片标题/i).first();
    if ((await ta.count().catch(() => 0)) === 0) {
      return { ok: false, summary: "标题编辑框未出现", data: { cardName: r.fullName }, trace };
    }
    await ta.fill(title).catch(async () => {
      await page.keyboard.type(title);
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);

    const newTitle = namespaced(ctx, title);
    const byName = await page.locator(`[class*="Card_name"][title="${newTitle}"]`).count().catch(() => 0);
    const headerText = await page.locator('[class*="headerTitle"]').first().innerText().catch(() => "");
    const confirmed = byName > 0 || headerText.includes(title);
    const o = await ctx.session.observe();
    trace.push({ label: `改标题为 "${newTitle}"，confirmed=${confirmed}`, observation: o.text });
    return {
      ok: confirmed,
      summary: confirmed ? `已改卡片标题为 "${newTitle}"` : `已提交改标题 "${newTitle}"（请确认）`,
      data: { cardName: r.fullName, newTitle, confirmed, url: o.url },
      trace,
    };
  },
});

registry.register({
  name: "card_manage_comments",
  layer: "A",
  description:
    "给卡片添加评论（在详情 modal 点 Add comment → 输入 → Ctrl+Enter 或 Save）。card 名自动加 namespace 前缀。trace 回报。",
  params: z.object({
    cardName: z.string().min(1).describe("卡片标题（工具自动加 namespace 前缀）"),
    text: z.string().describe("评论内容（markdown）"),
    submit: z.enum(["save", "ctrl_enter"]).optional().describe("提交：save=点 Save；ctrl_enter=Ctrl+Enter；默认 save"),
  }),
  run: async ({ cardName, text, submit }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    const r = await ensureCardOpen(page, ctx, cardName);
    if (!r.ok) {
      return { ok: false, summary: r.reason ?? `未能打开卡片 "${cardName}"`, data: { cardName }, trace };
    }
    trace.push({ label: `已打开卡片 "${r.fullName}" 详情` });

    // 展开 CommentEdit（Add comment 按钮）
    const addBtn = page.getByRole("button", { name: /add comment|添加评论/i }).first();
    await addBtn.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const ta = page.getByPlaceholder(/enter comment/i).first();
    if ((await ta.count().catch(() => 0)) === 0) {
      return { ok: false, summary: "评论输入框未出现", data: { cardName: r.fullName }, trace };
    }
    await ta.fill(text).catch(async () => {
      await page.keyboard.type(text);
    });
    trace.push({ label: `填评论（${text.length} 字符）` });

    const mode = submit ?? "save";
    if (mode === "ctrl_enter") {
      await ta.press("Control+Enter");
    } else {
      await page.getByRole("button", { name: /^save$|^保存$/i }).last().click({ timeout: 8_000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);

    const head = text.slice(0, 20).trim();
    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const saved = head.length > 0 && bodyText.includes(head.toLowerCase());
    const o = await ctx.session.observe();
    trace.push({ label: `提交评论后，saved=${saved}`, observation: o.text });
    return {
      ok: saved,
      summary: saved ? `已添加评论（${text.length} 字符）` : `已提交评论（请在观察中确认）`,
      data: { cardName: r.fullName, text, submit: mode, saved, url: o.url },
      trace,
    };
  },
});

registry.register({
  name: "card_toggle_section",
  layer: "A",
  description:
    "在卡片详情 modal 折叠/展开某区块（description 描述 / tasks 任务 / comments 评论 / attachments 附件）。驱动真实 UI：点区块 toggle 按钮（Minus=展开/Plus=折叠）。card 名自动加 namespace 前缀。trace 回报切换后观察。",
  params: z.object({
    cardName: z.string().min(1).describe("卡片标题（工具自动加 namespace 前缀）"),
    section: z.enum(["description", "tasks", "comments", "attachments"]).describe("区块名"),
    shown: z.enum(["on", "off"]).optional().describe("目标：on=展开显示；off=折叠隐藏；不填则翻转一次"),
  }),
  run: async ({ cardName, section, shown }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;
    const r = await ensureCardOpen(page, ctx, cardName);
    if (!r.ok) {
      return { ok: false, summary: r.reason ?? `未能打开卡片 "${cardName}"`, data: { cardName }, trace };
    }
    trace.push({ label: `已打开卡片 "${r.fullName}" 详情` });

    const toggle = page.getByTitle(new RegExp(`toggle ${section}|切换.*${section}`, "i")).first();
    if ((await toggle.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `未找到 "${section}" 区块的 toggle 按钮（该区块可能不存在）`, data: { cardName: r.fullName }, trace };
    }
    await toggle.scrollIntoViewIfNeeded().catch(() => {});
    await toggle.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(600);
    const o = await ctx.session.observe();
    trace.push({ label: `toggle "${section}"（目标 ${shown ?? "toggle"}）后`, observation: o.text });
    return {
      ok: true,
      summary: `已切换 "${section}" 区块显隐（目标 ${shown ?? "toggle"}）`,
      data: { cardName: r.fullName, section, want: shown ?? "toggle", url: o.url },
      trace,
    };
  },
});

// ── 标签管理 ────────────────────────────────────────────────────────────
// 4gaBoards 标签是「彩色按钮」（选中=nameActive 高亮），并非 checkbox。
// 弹层入口两处：卡片详情 Labels 区的 Add label 加号 / 卡片 hover 省略号 → Add/remove labels。
// 新建/重命名表单（LabelsStep/AddStep/EditStep）：名输入框(placeholder enterLabelName)、预设色按钮(title=hex,name=color)、Enter 提交。

registry.register({
  name: "card_manage_labels",
  layer: "A",
  description:
    "管理卡片标签（4gaBoards 标签是彩色按钮，选中=高亮 nameActive 态，非 checkbox）。三种动作：" +
    "toggle=勾选/取消一个已有标签（按 labelName 匹配，on 控制方向）；" +
    "create=新建标签（labelName 为名，可选 color 十六进制如 #ff1744，默认取预设第一色）；" +
    "edit=重命名已有标签（labelName=原名，newLabelName=新名）。" +
    "entry=modal（默认，卡片详情点 Labels 区的 Add label 加号）或 menu（hover 卡片省略号 → Add/remove labels）。" +
    "驱动真实 UI，card 名自动加 namespace 前缀。trace 回报弹层与结果观察。",
  params: z.object({
    cardName: z.string().min(1).describe("卡片标题（工具自动加 namespace 前缀）"),
    action: z.enum(["toggle", "create", "edit"]).describe("toggle=勾选/取消已有标签；create=新建标签；edit=重命名"),
    entry: z.enum(["modal", "menu"]).optional().describe("打开标签弹层入口：modal=卡片详情 Add label 加号（默认）；menu=hover 省略号→Add/remove labels"),
    labelName: z.string().optional().describe("toggle/edit=要匹配的已有标签名；create=新标签名"),
    newLabelName: z.string().optional().describe("edit 专用：重命名后的新名称"),
    color: z.string().optional().describe("create 专用：标签颜色十六进制（如 #ff1744）；不填取预设第一色"),
    on: z.enum(["on", "off"]).optional().describe("toggle 专用：on=选中；off=取消；不填则翻转一次"),
  }),
  run: async ({ cardName, action, entry, labelName, newLabelName, color, on }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;

    // 1. 打开卡片详情（modal 入口需 modal 开着；menu 入口随后会关 modal 回看板视图 hover）
    const r = await ensureCardOpen(page, ctx, cardName);
    if (!r.ok) {
      return { ok: false, summary: r.reason ?? `未能打开卡片 "${cardName}"`, data: { cardName }, trace };
    }
    trace.push({ label: `已打开卡片 "${r.fullName}" 详情` });

    // 2. 打开标签弹层
    const ent = entry ?? "modal";
    if (ent === "menu") {
      await closeCardModalIfOpen(page);
      const switched = await ensureBoardView(page);
      if (switched) trace.push({ label: "已切换到看板视图" });
      const card = page.locator(`[class*="Card_name"][title="${r.fullName}"]`).first();
      await card.hover().catch(() => {});
      await page.waitForTimeout(400);
      await page.getByTitle(/edit card|编辑卡片/i).first().click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
      const item = page
        .getByRole("button", { name: /add\/remove labels|添加\/移除标签|edit labels|编辑标签/i })
        .first();
      if ((await item.count().catch(() => 0)) === 0) {
        return { ok: false, summary: `卡片菜单未找到 Add/remove labels 项`, data: { cardName: r.fullName }, trace };
      }
      await item.click({ timeout: 8_000 }).catch(() => {});
    } else {
      const addBtn = page.getByTitle(/add label|添加标签/i).first();
      if ((await addBtn.count().catch(() => 0)) === 0) {
        return { ok: false, summary: `卡片详情未找到 Labels 区的 Add label 入口`, data: { cardName: r.fullName }, trace };
      }
      await addBtn.scrollIntoViewIfNeeded().catch(() => {});
      await addBtn.click({ timeout: 8_000 }).catch(() => {});
    }
    await page.waitForTimeout(600);
    // 弹层渲染：等搜索框（list 态可见）
    await page
      .waitForSelector('input[placeholder*="label" i], input[placeholder*="标签"]', { timeout: 8_000 })
      .catch(() => {});
    trace.push({ label: `已打开标签弹层（entry=${ent}）` });

    // 在搜索框输入标签名以精确定位（LabelsStep 按名称子串过滤；占位符实测 "Search labels or create one..."）
    const searchInput = page.getByPlaceholder(/search labels|搜索标签|标签/i).first();
    const fillSearch = async (text: string) => {
      const box = (await searchInput.count().catch(() => 0)) > 0 ? searchInput : page.locator('input[placeholder*="label" i], input[placeholder*="标签"]').first();
      await box.fill(text).catch(async () => {
        await box.click().catch(() => {});
        await page.keyboard.type(text);
      });
      await page.waitForTimeout(300);
    };

    if (action === "create") {
      const name = (labelName ?? "").trim();
      if (!name) return { ok: false, summary: "create 需要 labelName", data: { cardName: r.fullName }, trace };
      const createBtn = page.getByTitle(/create new label|创建新标签/i).first();
      if ((await createBtn.count().catch(() => 0)) === 0) {
        return { ok: false, summary: "标签弹层未找到 Create new label 按钮", data: { cardName: r.fullName }, trace };
      }
      await createBtn.click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
      const nameInput = page.getByPlaceholder(/enter label name|输入标签名称/i).first();
      if ((await nameInput.count().catch(() => 0)) === 0) {
        return { ok: false, summary: "新建标签名输入框未出现", data: { cardName: r.fullName }, trace };
      }
      await nameInput.fill(name).catch(async () => {
        await page.keyboard.type(name);
      });
      if (color) {
        await page
          .locator(`button[name="color"][title="${color.toLowerCase()}"]`)
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
      }
      await nameInput.press("Enter").catch(async () => {
        await page.getByRole("button", { name: /^create label$|^创建标签$/i }).last().click({ timeout: 8_000 }).catch(() => {});
      });
      await page.waitForTimeout(900);
      // 确认：新建后返回标签列表，标签作为彩色按钮（title=name）出现
      const created =
        (await page.locator(`button[title="${name}"]`).count().catch(() => 0)) > 0 ||
        (await page.getByRole("button", { name, exact: true }).count().catch(() => 0)) > 0;
      const o = await ctx.session.observe();
      trace.push({ label: `新建标签 "${name}" 后，created=${created}`, observation: o.text });
      return {
        ok: created,
        summary: created ? `已新建标签 "${name}"` : `已提交新建标签 "${name}"（请观察确认）`,
        data: { cardName: r.fullName, action, labelName: name, color, created, url: o.url },
        trace,
      };
    }

    if (action === "edit") {
      const cur = (labelName ?? "").trim();
      const next = (newLabelName ?? "").trim();
      if (!cur || !next) {
        return { ok: false, summary: "edit 需要 labelName(原名) 与 newLabelName(新名)", data: { cardName: r.fullName }, trace };
      }
      await fillSearch(cur);
      // 标签项=彩色按钮，title=标签名（recon 实测）；按 title 定位最稳，role name 兜底
      let nameLabel = page.locator(`button[title="${cur}"]`).first();
      if ((await nameLabel.count().catch(() => 0)) === 0) {
        nameLabel = page.getByRole("button", { name: cur, exact: true }).first();
      }
      if ((await nameLabel.count().catch(() => 0)) === 0) {
        return { ok: false, summary: `弹层未找到标签 "${cur}"`, data: { cardName: r.fullName }, trace };
      }
      // 同行铅笔（title editLabel）；过滤后弹层通常只剩该标签，直接按 title 取
      const pencil = page.getByTitle(/edit label|编辑标签/i).first();
      if ((await pencil.count().catch(() => 0)) === 0) {
        return { ok: false, summary: `标签 "${cur}" 未找到编辑铅笔`, data: { cardName: r.fullName }, trace };
      }
      await pencil.click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
      const nameInput = page.getByPlaceholder(/enter label name|输入标签名称/i).first();
      if ((await nameInput.count().catch(() => 0)) === 0) {
        return { ok: false, summary: "重命名输入框未出现", data: { cardName: r.fullName }, trace };
      }
      await nameInput.fill(next).catch(async () => {
        await page.keyboard.type(next);
      });
      await nameInput.press("Enter").catch(async () => {
        await page.getByRole("button", { name: /^update label$|^更新标签$|^save$/i }).last().click({ timeout: 8_000 }).catch(() => {});
      });
      await page.waitForTimeout(800);
      // 确认：重命名后新名标签按钮（title=新名）出现，旧名消失
      const renamed =
        (await page.locator(`button[title="${next}"]`).count().catch(() => 0)) > 0 ||
        (await page.getByRole("button", { name: next, exact: true }).count().catch(() => 0)) > 0;
      const o = await ctx.session.observe();
      trace.push({ label: `重命名 "${cur}"→"${next}" 后，renamed=${renamed}`, observation: o.text });
      return {
        ok: renamed,
        summary: renamed ? `已重命名标签 "${cur}"→"${next}"` : `已提交重命名（请观察确认）`,
        data: { cardName: r.fullName, action, labelName: cur, newLabelName: next, renamed, url: o.url },
        trace,
      };
    }

    // action === "toggle"
    const target = (labelName ?? "").trim();
    if (!target) return { ok: false, summary: "toggle 需要 labelName", data: { cardName: r.fullName }, trace };
    await fillSearch(target);
    let nameLabel = page.locator(`button[title="${target}"]`).first();
    if ((await nameLabel.count().catch(() => 0)) === 0) {
      nameLabel = page.getByRole("button", { name: target, exact: true }).first();
    }
    if ((await nameLabel.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `弹层未找到标签 "${target}"`, data: { cardName: r.fullName }, trace };
    }
    const classBefore = (await nameLabel.getAttribute("class").catch(() => "")) ?? "";
    const wasActive = /nameActive|active/i.test(classBefore);
    await nameLabel.click({ timeout: 8_000 }).catch(() => {});
    // 标签选中态经 socket 往返更新（弱网下慢），轮询最多 ~4s 等 class 变化
    const readActive = async (): Promise<boolean> => {
      const loc = page.locator(`button[title="${target}"]`).first();
      const cls = (await loc.getAttribute("class").catch(() => "")) ?? "";
      return /nameActive|active/i.test(cls);
    };
    let nowActive = wasActive;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(450);
      nowActive = await readActive();
      if (nowActive !== wasActive) break; // 已变化
    }
    const o = await ctx.session.observe();
    trace.push({ label: `toggle "${target}"：${wasActive}→${nowActive}`, observation: o.text });
    let ok = nowActive !== wasActive;
    if (on === "on") ok = nowActive;
    else if (on === "off") ok = !nowActive;
    return {
      ok,
      summary: `已切换标签 "${target}" 选中态（${wasActive}→${nowActive}，目标 ${on ?? "toggle"}）`,
      data: { cardName: r.fullName, action, labelName: target, on: on ?? "toggle", wasActive, nowActive, url: o.url },
      trace,
    };
  },
});

// ── 描述 Markdown 编辑器（@uiw/react-md-editor@4）──────────────────────
// recon 实测：① 模式由根节点 class 指示 w-md-editor-show-edit/live/preview；全屏根/body 带 fullscreen 类。
// ② Ctrl+7/8/9/0 在本版本未绑定（工具栏只有 Ctrl+1~6 标题）→ 改用工具栏右侧模式按钮（extraCommands，title 含 edit/live/preview/full）切换。
// ③ 拖动手柄=.w-md-editor-bar（cursor s-resize，docs 称"右下角三圆点"）；④ 帮助按钮 title="Open help" → markdownguide.org。
// ⑤ preview 模式下 textarea 不在 DOM，故进编辑态以 .w-md-editor 根为准（不要求 textarea）。

registry.register({
  name: "card_text_editor",
  layer: "A",
  description:
    "操作卡片描述的 Markdown 编辑器（@uiw/react-md-editor）。需先进描述编辑态（工具自动）。三种动作：" +
    "switch_mode=切视图模式（mode: edit=仅源码 / live=左源码右预览 / preview=仅预览 / fullscreen=全屏切换；点工具栏右侧模式按钮，读编辑器 class 确认）；" +
    "resize=拖编辑器底部 .w-md-editor-bar 手柄放大/缩小（direction larger/smaller）；" +
    "help=点帮助按钮(Open help)打开 Markdown 基本语法页 markdownguide.org。" +
    "驱动真实 UI，trace 回报模式/高度/popup。card 名自动加 namespace 前缀。",
  params: z.object({
    cardName: z.string().min(1).describe("卡片标题（工具自动加 namespace 前缀）"),
    action: z.enum(["switch_mode", "resize", "help"]).describe("switch_mode=切视图模式；resize=拖手柄改大小；help=打开帮助页"),
    mode: z.enum(["edit", "live", "preview", "fullscreen"]).optional().describe("switch_mode 专用：edit/live/preview/fullscreen"),
    direction: z.enum(["larger", "smaller"]).optional().describe("resize 专用：larger(默认)/smaller"),
  }),
  run: async ({ cardName, action, mode, direction }, ctx) => {
    const trace: TraceStep[] = [];
    const page = ctx.page;

    const r = await ensureCardOpen(page, ctx, cardName);
    if (!r.ok) {
      return { ok: false, summary: r.reason ?? `未能打开卡片 "${cardName}"`, data: { cardName }, trace };
    }
    trace.push({ label: `已打开卡片 "${r.fullName}" 详情` });

    // 进描述编辑态：点 Edit/Add Description → 等 .w-md-editor 根（preview 模式无 textarea，故以根为准）
    let entry = page.getByTitle(/edit description|编辑描述/i).first();
    if ((await entry.count().catch(() => 0)) === 0) {
      entry = page.getByTitle(/add description|添加描述/i).first();
    }
    if ((await entry.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `卡片 "${r.fullName}" 详情未找到描述编辑入口`, data: { cardName: r.fullName }, trace };
    }
    await entry.scrollIntoViewIfNeeded().catch(() => {});
    await entry.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForSelector(".w-md-editor", { timeout: 10_000 }).catch(() => {});
    const editor = page.locator(".w-md-editor").first();
    if ((await editor.count().catch(() => 0)) === 0) {
      return { ok: false, summary: "描述编辑器未出现", data: { cardName: r.fullName }, trace };
    }
    trace.push({ label: "已进入描述编辑态" });

    if (action === "switch_mode") {
      const m = mode ?? "live";
      const before = await readEditorMode(page);
      const reached = (after: { mode: string | null; fullscreen: boolean }) =>
        (m === "edit" && after.mode === "edit") ||
        (m === "live" && after.mode === "live") ||
        (m === "preview" && after.mode === "preview") ||
        (m === "fullscreen" && after.fullscreen);

      // 主路径：点工具栏右侧模式按钮（@uiw v4 extraCommands，title 含模式名）
      const titleFrag = m === "fullscreen" ? "full" : m;
      const modeBtn = page.locator(`.w-md-editor button[title*="${titleFrag}" i]`).first();
      if (await modeBtn.count().catch(() => 0).then((c) => c > 0)) {
        await modeBtn.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(500);
      } else {
        // 兜底：textarea 可见时试快捷键
        const ta = page.locator(".w-md-editor-text-input").first();
        if (await ta.count().catch(() => 0).then((c) => c > 0)) {
          await ta.click({ timeout: 5_000 }).catch(() => {});
          const sc: Record<string, string> = { edit: "Control+7", live: "Control+8", preview: "Control+9", fullscreen: "Control+0" };
          await page.keyboard.press(sc[m] ?? "Control+8").catch(() => {});
          await page.waitForTimeout(400);
        }
      }
      let after = await readEditorMode(page);
      trace.push({
        label: `switch_mode ${m}：mode=${before.mode},fs=${before.fullscreen} → mode=${after.mode},fs=${after.fullscreen}`,
      });
      const ok = reached(after);
      const o = await ctx.session.observe();
      return {
        ok,
        summary: `已切换编辑器到 ${m}（mode=${after.mode},fullscreen=${after.fullscreen}，ok=${ok}）`,
        data: { cardName: r.fullName, action, mode: m, before, after, url: o.url },
        trace,
      };
    }

    if (action === "resize") {
      const dir = direction ?? "larger";
      const boxBefore = await editor.boundingBox().catch(() => null);
      // 拖动手柄：.w-md-editor-bar（cursor s-resize）
      const handle = page.locator(".w-md-editor-bar, .w-md-editor-drag-bar, [class*='drag-bar']").first();
      if ((await handle.count().catch(() => 0)) === 0 || !boxBefore) {
        return { ok: false, summary: "未找到编辑器拖动手柄（.w-md-editor-bar）", data: { cardName: r.fullName, action }, trace };
      }
      const hBox = await handle.boundingBox().catch(() => null);
      if (hBox) {
        const cx = hBox.x + hBox.width / 2;
        const cy = hBox.y + hBox.height / 2;
        const dy = dir === "larger" ? 120 : -80;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx, cy + dy, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(500);
      }
      const boxAfter = await editor.boundingBox().catch(() => null);
      const grew = !!boxBefore && !!boxAfter && boxAfter.height > boxBefore.height + 5;
      const shrank = !!boxBefore && !!boxAfter && boxAfter.height < boxBefore.height - 5;
      const ok = dir === "larger" ? grew : shrank;
      trace.push({ label: `resize ${dir}：高度 ${boxBefore?.height ?? "?"} → ${boxAfter?.height ?? "?"}，ok=${ok}` });
      const o = await ctx.session.observe();
      return {
        ok,
        summary: `已${dir === "larger" ? "放大" : "缩小"}编辑器（高 ${boxBefore?.height}→${boxAfter?.height}）`,
        data: { cardName: r.fullName, action, direction: dir, heightBefore: boxBefore?.height, heightAfter: boxAfter?.height, ok, url: o.url },
        trace,
      };
    }

    // action === "help"：点工具栏帮助按钮(Open help) → 新标签页打开 markdownguide.org
    const helpBtn = page
      .locator('.w-md-editor button[title*="help" i], .w-md-editor [aria-label*="help" i], .w-md-editor a[title*="help" i]')
      .first();
    if ((await helpBtn.count().catch(() => 0)) === 0) {
      return { ok: false, summary: "未找到编辑器帮助按钮", data: { cardName: r.fullName, action }, trace };
    }
    await helpBtn.scrollIntoViewIfNeeded().catch(() => {});
    // @uiw commands.help 用 window.open 开新标签；用 context 级 'page' 事件兜底 page 级 'popup'
    const context = page.context();
    const newPagePromise = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
    await helpBtn.click({ timeout: 8_000 }).catch(() => {});
    const newPage = await newPagePromise;
    let helpUrl = "";
    if (newPage) {
      await newPage.waitForLoadState("domcontentloaded", { timeout: 12_000 }).catch(() => {});
      helpUrl = newPage.url();
      await newPage.close().catch(() => {});
    }
    if (!helpUrl || helpUrl === "about:blank") helpUrl = page.url();
    const ok = /markdownguide\.org|basic-syntax/i.test(helpUrl);
    trace.push({ label: `help：url=${helpUrl}，ok=${ok}（newPage=${!!newPage}）` });
    const o = await ctx.session.observe();
    return {
      ok,
      summary: ok ? `已打开 Markdown 基本语法页（${helpUrl}）` : `已点帮助按钮（url=${helpUrl}，请确认）`,
      data: { cardName: r.fullName, action, helpUrl, ok, url: o.url },
      trace,
    };
  },
});
