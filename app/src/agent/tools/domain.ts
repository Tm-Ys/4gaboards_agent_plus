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

    // 2. 进描述编辑态：先试已有描述（Edit Description），再试空描述（Add Description）
    let entry = page.getByTitle(/edit description|编辑描述/i).first();
    if ((await entry.count().catch(() => 0)) === 0) {
      entry = page.getByTitle(/add description|添加描述/i).first();
    }
    if ((await entry.count().catch(() => 0)) === 0) {
      return { ok: false, summary: `卡片 "${r.fullName}" 详情里未找到描述编辑入口`, data: { cardName: r.fullName }, trace };
    }
    await entry.scrollIntoViewIfNeeded().catch(() => {});
    await entry.click({ timeout: 10_000 }).catch(() => {});
    trace.push({ label: "点击描述编辑入口" });

    // 3. 等 textarea（@uiw/md-editor 渲染，稳定 class）
    await page.waitForSelector(".w-md-editor-text-input", { timeout: 8_000 }).catch(() => {});
    const ta = page.locator(".w-md-editor-text-input").first();
    if ((await ta.count().catch(() => 0)) === 0) {
      return { ok: false, summary: "描述编辑器 textarea 未出现", data: { cardName: r.fullName }, trace };
    }

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
