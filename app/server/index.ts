// Hono 后端入口：只读路由（catalog/reports）+ 交互路由（runScenario/mutation/judge-cost，后续加）。
// 端口 8787；开发期前端 vite 5173 proxy /api → 8787；生产托管 web/dist（SPA）。

import fs from "node:fs";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import "dotenv/config";
import catalog from "./routes/catalog";
import reports from "./routes/reports";
import runScenarioRoute from "./routes/runScenario";
import { current as currentLock } from "./lib/lock";

const app = new Hono();

// 只读
app.route("/api/scenarios", catalog);
app.route("/api", reports);
// 交互（SSE）
app.route("/api/run", runScenarioRoute);

// 当前在跑任务（前端据此禁用 Run 按钮）
app.get("/api/runlock", (c) => c.json({ running: currentLock() }));

// 生产：托管前端构建产物（仅当 web/dist 存在；开发期前端走 vite 5173）
if (fs.existsSync("./web/dist")) {
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`▶ 控制台后端 → http://localhost:${info.port}（前端 dev: http://localhost:5173）`);
});
