// P0 冒烟：端到端走"工具"路径，验证 浏览器会话 + 观察 + 注册框架 + A/B 层工具。
// 运行：npx tsx src/agent/smoke.ts

import fs from "node:fs";
import path from "node:path";
import { BrowserSession } from "./browser/context";
import { registry, type ToolContext } from "./tools/registry";
import { settings } from "../config";
import "./tools/browser"; // 注册 B 层（副作用）
import "./tools/domain"; // 注册 A 层（副作用）

async function main() {
  console.log("已注册工具:", registry.all().map((t) => `${t.layer}:${t.name}`).join(", "));
  console.log("OpenAI function-calling 定义数:", registry.toOpenAITools().length);
  console.log("");

  const session = await BrowserSession.launch({ headless: true });
  const ctx: ToolContext = { session, page: session.page };
  try {
    let r = await registry.execute("auth_login", {}, ctx);
    console.log("[auth.login]   ", r.summary);

    r = await registry.execute("browser_observe", {}, ctx);
    console.log("[observe]       ", r.summary);

    const stamp = `P0Board-${Date.now().toString().slice(-8)}`;
    r = await registry.execute("board_create", { name: stamp, project: "Getting started" }, ctx);
    console.log("[board.create]  ", r.summary, "confirmed=", (r.data as { confirmed?: boolean })?.confirmed);

    r = await registry.execute("board_open", { name: stamp }, ctx);
    console.log("[board.open]    ", r.summary);

    fs.mkdirSync(settings.outputsDir, { recursive: true });
    await session.page.screenshot({ path: path.join(settings.outputsDir, "smoke-after-create.png") });
    console.log("[screenshot]    ", path.join(settings.outputsDir, "smoke-after-create.png"));

    r = await registry.execute("browser_observe", {}, ctx);
    console.log("[observe board] ", r.summary);

    r = await registry.execute("browser_done", { result: "P0 冒烟完成" }, ctx);
    console.log("[done]          ", r.summary, "done=", r.done);
  } finally {
    await session.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
