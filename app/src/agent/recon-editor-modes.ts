// 聚焦 recon：找出 @uiw md-editor 的 edit/live/preview/fullscreen 切换按钮选择器。
// 运行：npx tsx src/agent/recon-editor-modes.ts

import type { Page } from "playwright";
import { BrowserSession } from "./browser/context";
import { registry, type ToolContext } from "./tools/registry";
import "./tools/browser";
import "./tools/domain";

async function dumpEditorButtons(page: Page) {
  const info = await page.evaluate(() => {
    const root = document.querySelector(".w-md-editor");
    if (!root) return { found: false };
    // 所有按钮/a，带全部可能有用的属性
    const btns = [...root.querySelectorAll("button,a,[role=button]")].map((b) => {
      const attrs: Record<string, string | null> = {};
      for (const a of b.getAttributeNames()) {
        if (/^(title|aria-label|data-|name|class|role)$/.test(a)) attrs[a] = b.getAttribute(a);
      }
      return { attrs, text: (b.textContent || "").trim().slice(0, 12) };
    });
    // class 里含 edit/live/preview/full/mode/tab 的元素
    const modeEls = [...root.querySelectorAll("*")]
      .map((el) => ({ tag: el.tagName, cls: (el.className || "").toString() }))
      .filter((e) => /\b(edit|live|preview|full|mode|tab)\b/i.test(e.cls));
    return { found: true, rootClass: root.className, btnCount: btns.length, btns, modeEls };
  });
  console.log("\n[DUMP editor buttons]");
  console.log("  rootClass:", info.found ? info.rootClass : "(无 editor)");
  if (info.found) {
    console.log("  mode-related 元素:", JSON.stringify(info.modeEls, null, 0));
    console.log("  所有按钮:");
    for (const b of info.btns ?? []) console.log("   ", JSON.stringify({ ...b.attrs, text: b.text }));
  }
}

async function main() {
  const session = await BrowserSession.launch({ headless: true });
  const ctx: ToolContext = { session, page: session.page, namespace: `E${Date.now().toString().slice(-6)}` };
  const page = session.page;
  try {
    await registry.execute("auth_login", {}, ctx);
    for (let i = 0; i < 3; i++) {
      await registry.execute("board_create", { name: "B", project: "Getting started", template: "Simple" }, ctx);
      await registry.execute("board_open", { name: "B" }, ctx);
      await page.waitForTimeout(1500);
      if ((await page.locator('[class*="List_headerName"]').count().catch(() => 0)) > 0) break;
    }
    for (let i = 0; i < 3; i++) {
      await registry.execute("card_create", { title: "C" }, ctx);
      await page.waitForTimeout(800);
      if ((await page.locator(`[class*="Card_name"][title="${ctx.namespace}-C"]`).count().catch(() => 0)) > 0) break;
    }
    // 开卡片详情 + 进描述编辑态（带重试，弱网下偶发 about:blank）
    let editorReady = false;
    for (let attempt = 0; attempt < 3 && !editorReady; attempt++) {
      if (page.url() === "about:blank" || !page.url().includes("4gaboards")) {
        console.log(`URL 异常(${page.url()})，重新登录`);
        await registry.execute("auth_login", {}, ctx);
      }
      await registry.execute("board_open", { name: "B" }, ctx);
      await page.waitForTimeout(1500);
      await registry.execute("card_open", { cardName: "C" }, ctx);
      await page.waitForTimeout(2000);
      console.log(`尝试 ${attempt + 1} card_open 后 URL:`, page.url());
      const addDesc = page.getByTitle(/add description|edit description/i).first();
      if ((await addDesc.count().catch(() => 0)) > 0) {
        await addDesc.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.waitForSelector(".w-md-editor", { timeout: 12_000 }).catch(() => {});
        editorReady = (await page.locator(".w-md-editor").count().catch(() => 0)) > 0;
      }
    }
    console.log("editor 就绪:", editorReady);
    await dumpEditorButtons(page);
  } finally {
    await session.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
