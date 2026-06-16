// 开发期 recon v3：全局 dump（卡片详情是 /cards/:id 页面路由，非 [role=dialog]）。
// 运行：npx tsx src/agent/recon-card-tools.ts [--headed]

import fs from "node:fs";
import type { Page } from "playwright";
import { BrowserSession } from "./browser/context";
import { registry, type ToolContext } from "./tools/registry";
import { settings } from "../config";
import "./tools/browser";
import "./tools/domain";

const headless = !process.argv.slice(2).includes("--headed");

/** 全局 dump：所有 input 的 placeholder/name + 所有 button/a 的 title/aria/text + cursor:resize 元素。 */
async function dumpGlobal(page: Page, label: string) {
  const info = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")].map((i) => ({
      ph: (i as HTMLInputElement).placeholder,
      name: i.name,
      visible: !!(i as HTMLElement).offsetParent,
    }));
    const titled = [...document.querySelectorAll("button,a,[role=button]")]
      .map((b) => ({
        title: b.getAttribute("title"),
        aria: b.getAttribute("aria-label"),
        text: ((b as HTMLElement).innerText || b.textContent || "").trim().slice(0, 16),
        visible: !!(b as HTMLElement).offsetParent,
      }))
      .filter((b) => (b.title || b.aria) && b.visible);
    // resize 手柄：cursor 含 resize 的元素（全局 + 编辑器内）
    const cursorEls = [...document.querySelectorAll("*")]
      .map((el) => ({ cls: (el.className || "").toString().slice(0, 40), cur: getComputedStyle(el).cursor, vis: !!(el as HTMLElement).offsetParent }))
      .filter((e) => /resize/i.test(e.cur) && e.vis);
    const editorClass = document.querySelector(".w-md-editor")?.getAttribute("class") ?? null;
    return { inputs, titled, cursorEls, editorClass };
  });
  console.log(`\n[DUMP ${label}]`);
  console.log("  editorClass:", info.editorClass);
  console.log("  inputs:", JSON.stringify(info.inputs));
  console.log("  titled btns:", JSON.stringify(info.titled));
  console.log("  resize-cursor els:", JSON.stringify(info.cursorEls));
}

function show(label: string, r: unknown) {
  const res = r as { ok?: boolean; summary?: string; data?: Record<string, unknown>; trace?: { label: string }[] };
  console.log(`\n── ${label} ──  ok=${res.ok} | ${res.summary}`);
  if (res.data) console.log("  data:", JSON.stringify(res.data));
}

async function main() {
  console.log("工具数:", registry.all().length, "新工具:", registry.get("card_manage_labels") && registry.get("card_text_editor") ? "✓" : "✗");
  const session = await BrowserSession.launch({ headless });
  const ctx: ToolContext = { session, page: session.page, namespace: `R${Date.now().toString().slice(-6)}` };
  console.log("namespace:", ctx.namespace);
  const page = session.page;

  try {
    show("auth_login", await registry.execute("auth_login", {}, ctx));

    let boardReady = false;
    for (let i = 0; i < 3 && !boardReady; i++) {
      await registry.execute("board_create", { name: "B", project: "Getting started", template: "Simple" }, ctx);
      await registry.execute("board_open", { name: "B" }, ctx);
      await page.waitForTimeout(1500);
      boardReady = (await page.locator('[class*="List_headerName"]').count().catch(() => 0)) > 0;
    }
    if (!boardReady) throw new Error("建板失败");
    console.log("board ready");

    let cardOk = false;
    for (let i = 0; i < 3 && !cardOk; i++) {
      await registry.execute("card_create", { title: "C" }, ctx);
      await page.waitForTimeout(800);
      cardOk = (await page.locator(`[class*="Card_name"][title="${ctx.namespace}-C"]`).count().catch(() => 0)) > 0;
    }
    console.log("card ready:", cardOk);

    // 打开卡片详情页
    await registry.execute("card_open", { cardName: "C" }, ctx);
    await page.waitForTimeout(2000);

    // ── LABELS ──
    console.log("\n========== LABELS ==========");
    await dumpGlobal(page, "卡片详情页（找 Add label / description 入口）");

    // 点 Add label（全局 title）
    const addBtn = page.locator('button[title*="add label" i]').first();
    if (await addBtn.count().catch(() => 0).then((c) => c > 0)) {
      await addBtn.click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(900);
      await dumpGlobal(page, "标签弹层已开（找 search/create/label 项）");
    } else {
      console.log("⚠ 未找到 Add label 按钮");
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);

    show("labels create", await registry.execute("card_manage_labels", { cardName: "C", action: "create", labelName: "L1", color: "#ff1744" }, ctx));
    await dumpGlobal(page, "create 后（L1 是否在列表）");
    show("labels toggle on L1", await registry.execute("card_manage_labels", { cardName: "C", action: "toggle", labelName: "L1", on: "on" }, ctx));
    show("labels edit L1->L1x", await registry.execute("card_manage_labels", { cardName: "C", action: "edit", labelName: "L1", newLabelName: "L1x" }, ctx));

    // ── EDITOR ──
    console.log("\n========== EDITOR ==========");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    // 回看板再开卡片，确保干净
    await registry.execute("board_open", { name: "B" }, ctx);
    await page.waitForTimeout(1000);
    await registry.execute("card_open", { cardName: "C" }, ctx);
    await page.waitForTimeout(2000);

    // 点描述编辑入口（Edit/Add Description）
    let entry = page.locator('[title*="description" i]').first();
    await entry.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await dumpGlobal(page, "描述编辑态（editor class + resize 手柄 + help）");

    const readMode = async () => (await page.locator(".w-md-editor").first().getAttribute("class").catch(() => "")) ?? "";
    console.log("初始 editor class:", (await readMode()).slice(0, 120));
    for (const [m, k] of [["edit", "Control+7"], ["live", "Control+8"], ["preview", "Control+9"]] as const) {
      await page.locator(".w-md-editor-text-input").first().click({ timeout: 5_000 }).catch(() => {});
      await page.keyboard.press(k).catch(() => {});
      await page.waitForTimeout(500);
      console.log(`  按 ${k}(${m}):`, (await readMode()).match(/w-md-editor-show-\w+|fullscreen/i)?.join(",") ?? "(无变化)");
    }
    await page.keyboard.press("Control+0").catch(() => {});
    await page.waitForTimeout(500);
    console.log("  按 Control+0(全屏):", (await readMode()).slice(0, 160));
    await dumpGlobal(page, "全屏后 editor class");
    await page.keyboard.press("Escape").catch(() => {});

    show("editor switch preview", await registry.execute("card_text_editor", { cardName: "C", action: "switch_mode", mode: "preview" }, ctx));
    show("editor switch live", await registry.execute("card_text_editor", { cardName: "C", action: "switch_mode", mode: "live" }, ctx));
    show("editor switch edit", await registry.execute("card_text_editor", { cardName: "C", action: "switch_mode", mode: "edit" }, ctx));
    show("editor switch fullscreen", await registry.execute("card_text_editor", { cardName: "C", action: "switch_mode", mode: "fullscreen" }, ctx));
    show("editor resize", await registry.execute("card_text_editor", { cardName: "C", action: "resize", direction: "larger" }, ctx));
    show("editor help", await registry.execute("card_text_editor", { cardName: "C", action: "help" }, ctx));

    fs.mkdirSync(settings.outputsDir, { recursive: true });
    await page.screenshot({ path: `${settings.outputsDir}/recon-card-tools.png` }).catch(() => {});
    console.log("\n✅ recon v3 完成");
  } finally {
    await session.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
