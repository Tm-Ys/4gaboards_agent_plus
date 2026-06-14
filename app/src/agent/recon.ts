// P0 侦察脚本（开发期）：登录 demo → 等待渲染 → 观察 + 截图。
// 运行：npx tsx src/agent/recon.ts

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { settings } from "../config";
import { observe } from "./browser/observation";

const DEMO = process.env.TARGET_APP_DEMO_URL ?? "https://demo.4gaboards.com/";

function proxyServer(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

async function main() {
  const emailOrUsername = process.env["4GABOARD_ACCOUNT"];
  const password = process.env["4GABOARD_PASSWORD"];
  if (!emailOrUsername || !password) throw new Error("缺少 4GABOARD_ACCOUNT / 4GABOARD_PASSWORD");

  const px = proxyServer();
  const browser = await chromium.launch({ headless: true, ...(px ? { proxy: { server: px } } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 诊断：捕获控制台与页面错误
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[console.${m.type()}]`, m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  // 诊断：抓 api / socket 相关请求
  const reqLog: string[] = [];
  page.on("response", (r) => {
    const u = r.url();
    if (/socket\.io|\/api\/|access-tokens|\/core|\/boards|wss:|\/sails/i.test(u)) {
      reqLog.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\//, "")}`.slice(0, 160));
    }
  });

  console.log("→ goto", DEMO);
  await page.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);

  console.log("→ 登录");
  await page.fill('input[name="emailOrUsername"]', emailOrUsername);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  // 等 URL 离开 /login，再等网络空闲 + 渲染
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(12000);

  // localStorage 概览
  const lsKeys = await page.evaluate(() => Object.keys(localStorage));
  console.log("\n[localStorage keys]", lsKeys);

  const obs = await observe(page);
  console.log("\nURL  :", obs.url);
  console.log("TITLE:", obs.title);
  console.log(`可交互元素: ${obs.elements.length}`);
  console.log("\n" + obs.text);

  console.log("\n[请求日志 (socket/api)]");
  console.log(reqLog.length ? reqLog.join("\n") : "（无匹配请求）");

  // 兜底诊断：若元素为空，dump HTML / iframe / root 内容
  if (obs.elements.length === 0) {
    const html = await page.content();
    const frames = page.frames().map((f) => f.url());
    const rootHtml = await page.locator("#root").innerHTML().catch(() => "(无 #root)");
    console.log(`\n[诊断] HTML 长度=${html.length}, frames=${frames.length}:`, frames);
    console.log(`[诊断] #root innerHTML 长度=${rootHtml.length}`);
    console.log("[诊断] #root 前 1500 字符:\n" + rootHtml.slice(0, 1500));
  }

  fs.mkdirSync(settings.outputsDir, { recursive: true });
  const shot = path.join(settings.outputsDir, "recon-dashboard.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log("\nSHOT :", shot);

  // 探 Add Board 模态框选择器
  console.log("\n→ 点击 Add Board 探模态");
  await page.getByRole("button", { name: "Add Board" }).click().catch((e) => console.log("click 失败:", String(e).slice(0, 120)));
  await page.waitForTimeout(1500);
  const modalObs = await observe(page);
  console.log("\n=== Add Board 模态观察 ===");
  console.log(modalObs.text);
  // dump 模态内 input 定位信息
  const inputs = await page
    .locator("input:visible")
    .evaluateAll((els) =>
      els.map((e) => ({
        placeholder: e.getAttribute("placeholder"),
        value: (e as HTMLInputElement).value,
        cls: (e.getAttribute("class") || "").slice(0, 48),
      })),
    );
  console.log("\n=== 模态 input 详情 ===");
  console.log(JSON.stringify(inputs, null, 2));
  await page.screenshot({ path: path.join(settings.outputsDir, "recon-addboard.png"), fullPage: false });

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
