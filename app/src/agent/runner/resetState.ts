// 账号级 server-side state 恢复（P4.1 批量状态隔离）。
// 批量 harness 每个场景执行后调用，把被测动作改掉的账号持久偏好恢复到默认，
// 避免污染后续场景——典型例子：settings-language 把语言切成中文后，后续 toggle 场景
// 登录后 UI 仍是中文，英文 hasText（如 "Compact Sidebar"）失配导致批量 FAIL。
// 复用 domain.ts 的设置页定位模式（行内 Dropdown 键入 + Tab 选中）。

import type { ToolContext } from "../tools/registry";

const DEMO_ORIGIN = (process.env.TARGET_APP_DEMO_URL ?? "https://demo.4gaboards.com").replace(/\/+$/, "");

/**
 * 把 preferences 的 Language 设回 "Detect automatically"（默认英文），
 * 消除切语言类场景对后续批量场景的 UI 语言污染。
 */
export async function resetAccountLanguage(ctx: ToolContext): Promise<void> {
  const page = ctx.page;
  await page.goto(`${DEMO_ORIGIN}/settings/preferences`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // 设置表格异步 fetch core settings，较慢；等 Language 行渲染
  await page.waitForSelector("text=/Language|语言|Preferences/i", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const row = page.locator("tr, [role=row]").filter({ hasText: /Language|语言/ }).first();
  const inp = row.locator('input[class*="Dropdown_dropdownSearchInput"]').first();
  // 点开 Language 下拉浮层
  await inp.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  // 直接点 "Detect automatically / 自动检测" 选项。注意：不能用 fill("Detect automatically")+Tab——
  // language 选项走 i18n，中文 UI 下选项文本是"自动检测"等中文，英文 fill 在 Dropdown 的 startsWith
  // 过滤里匹配不到，selectFirstOnSearch 不命中、Tab 提交 null，语言不会变。改为点浮层选项
  //（选项 DOM = div[class*="dropdownItem"]，文本随 UI 语言，用正则覆盖中英文）。
  const detectItem = page.locator('[class*="dropdownItem"]').filter({ hasText: /detect|自动|automat/i }).first();
  await detectItem.click({ timeout: 8_000 });
  await page.waitForTimeout(1200); // 等 onChange → socket 写库 → UI 切回
}
