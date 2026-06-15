// DEV-ONLY 侦察脚本（不参与 agent 运行；package.json 无 script，勿当产物）。
// 结论已沉淀进 domain.ts 的 settings_* 工具：
//   · instance 开关簇受 demo 站 demoMode 限制、物理 disabled → 放弃（见 outputs/basic/README.md）。
//   · preferences 开关 = Radio_input(checked) + span.switchRound(点击目标)；下拉 = Dropdown_dropdownSearchInput 键入+Tab。
// 运行：cd app && npx tsx src/agent/recon-settings.ts

import { BrowserSession } from "./browser/context";
import { settings } from "../config";
import path from "node:path";
import fs from "node:fs";

const DEMO = (process.env.TARGET_APP_DEMO_URL ?? "https://demo.4gaboards.com").replace(/\/+$/, "");

interface ToggleDump {
  tag: string;
  type: string | null;
  role: string | null;
  cls: string;
  disabled: boolean;
  ariaChecked: string | null;
  ariaPressed: string | null;
  label: string;
  html: string;
}

async function dumpToggles(page: import("playwright").Page, label: string) {
  console.log(`\n========== ${label} ==========`);
  console.log("URL  :", page.url());
  console.log("Title:", await page.title().catch(() => "?"));

  // demoMode 信号：Header 的 GitHub/Feedback 横幅、设置页 demoMode 说明
  const demoNotice = await page
    .locator("text=/demo mode|github\\.com\\/RARgames/i")
    .count()
    .catch(() => 0);
  const demoExplain = await page.locator("text=/demo/i").count().catch(() => 0);
  console.log(`demoMode 信号：GitHub/demo 横幅节点数=${demoNotice}，含 'demo' 文本节点数=${demoExplain}`);

  // 设置表格异步 fetch core settings + activities，较慢；轮询等到表格/文本出现
  await page
    .waitForSelector("text=/registration|Instance settings|Modify settings|Preferences|Theme|Language/i", { timeout: 25000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  const bodyText = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1500));
  console.log("页面可见文本(前1500):\n" + bodyText + "\n");

  const toggles = await page.evaluate(() => {
    const sel = [
      'input[type="checkbox"]',
      '[role="switch"]',
      '[role="checkbox"]',
      "button[aria-pressed]",
      '[class*="Toggle"]',
      '[class*="toggle"]',
      '[class*="Switch"]',
      '[class*="switch"]',
    ].join(", ");
    const out: any[] = [];
    document.querySelectorAll(sel).forEach((el) => {
      const e = el as HTMLElement;
      let label = "";
      const row = e.closest("tr, [role=row], li, [class*=row], [class*=Row]");
      if (row) label = ((row as HTMLElement).innerText || "").trim().replace(/\s+/g, " ").slice(0, 90);
      out.push({
        tag: e.tagName.toLowerCase(),
        type: e.getAttribute("type"),
        role: e.getAttribute("role"),
        cls: (e.getAttribute("class") || "").slice(0, 70),
        disabled: (e as any).disabled === true || e.getAttribute("disabled") !== null || e.getAttribute("aria-disabled") === "true",
        ariaChecked: e.getAttribute("aria-checked"),
        ariaPressed: e.getAttribute("aria-pressed"),
        label,
        html: e.outerHTML.slice(0, 200),
      });
    });
    return out as ToggleDump[];
  });

  console.log(`\n发现疑似开关 ${toggles.length} 个：`);
  for (const t of toggles) {
    console.log(
      `  · <${t.tag}${t.type ? ` type=${t.type}` : ""}${t.role ? ` role=${t.role}` : ""}> ` +
        `disabled=${t.disabled} aria-checked=${t.ariaChecked} aria-pressed=${t.ariaPressed}` +
        (t.label ? `\n      标签行: "${t.label}"` : "") +
        `\n      class: ${t.cls}` +
        `\n      html: ${t.html}`,
    );
  }
  return toggles;
}

async function tryClickFirst(page: import("playwright").Page, toggles: ToggleDump[]) {
  // 找第一个非 disabled 的开关试着点一下，看能否切换（验证可交互性）
  const t = toggles.find((x) => !x.disabled);
  if (!t) {
    console.log("\n[试探点击] 没有非 disabled 的开关可点 → 全部禁用，印证 demoMode 限制");
    return;
  }
  console.log(`\n[试探点击] 尝试点第一个非 disabled 开关: "${t.label}"`);
  try {
    // 用 class 定位重试
    const sel = `${t.tag}${t.cls ? `[class*="${t.cls.split(" ")[0]}"]` : ""}`;
    await page.locator(sel).first().click({ timeout: 5000 });
    await page.waitForTimeout(800);
    console.log("  点击未抛错；观察状态是否变化需看截图/二次 dump");
  } catch (e) {
    console.log("  点击失败:", e instanceof Error ? e.message.slice(0, 160) : String(e));
  }
}

/** 点击验证：对某设置项，依次试点 switchRound/label/隐藏 checkbox，看哪个触发 checked 翻转。 */
async function verifyToggle(page: import("playwright").Page, settingName: string) {
  console.log(`\n[点击验证] 设置项 "${settingName}"`);
  const row = page.locator("tr, [role=row]").filter({ hasText: settingName }).first();
  await row.waitFor({ timeout: 8000 }).catch(() => {});
  const checkbox = row.locator('input[class*="Radio_input"]').first();
  const before = await checkbox.isChecked().catch(() => null);
  console.log(`  点击前: checked=${before}`);
  for (const sel of ['span[class*="switchRound"]', "label", 'input[class*="Radio_input"]']) {
    try {
      await row.locator(sel).first().click({ timeout: 4000 });
      await page.waitForTimeout(1000);
      const after = await checkbox.isChecked().catch(() => null);
      const changed = after !== before;
      console.log(`  · 点 ${sel}: checked ${before} → ${after}${changed ? "  ✓ 触发切换" : "  (未变)"}`);
      if (changed) break; // 已切换就停，避免切回
    } catch (e) {
      console.log(`  · 点 ${sel} 失败: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    }
  }
}

async function main() {
  const session = await BrowserSession.launch({ headless: true });
  try {
    console.log("→ 登录 demo");
    await session.login();
    // 4gaBoards 用 socket.io 鉴权，session 建立需要时间；等网络空闲 + 缓冲
    await session.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await session.page.waitForTimeout(8000);
    console.log("登录后 URL:", session.page.url());

    fs.mkdirSync(settings.outputsDir, { recursive: true });

    // 1) instance 设置页
    await session.page.goto(`${DEMO}/settings/instance`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await session.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await session.page.waitForTimeout(2500);
    const instToggles = await dumpToggles(session.page, "INSTANCE 设置页 /settings/instance");
    await tryClickFirst(session.page, instToggles);
    await session.page.screenshot({ path: path.join(settings.outputsDir, "recon-instance.png"), fullPage: false });

    // 2) preferences 设置页（用户级，对照——应不受 demoMode 影响）
    await session.page.goto(`${DEMO}/settings/preferences`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await session.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await session.page.waitForTimeout(2000);
    const prefToggles = await dumpToggles(session.page, "PREFERENCES 用户级设置页 /settings/preferences");
    await verifyToggle(session.page, "Compact Sidebar");
    await session.page.screenshot({ path: path.join(settings.outputsDir, "recon-preferences.png"), fullPage: false });

    console.log("\nSHOT :", path.join(settings.outputsDir, "recon-instance.png"), "+", "recon-preferences.png");
  } finally {
    await session.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
