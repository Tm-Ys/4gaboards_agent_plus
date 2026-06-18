// 只读报告路由：
//   GET /api/runs            列 outputs/runs（batch/single）
//   GET /api/mutation        列 outputs/mutation（mutation/judge-cost）
//   GET /api/reports/runs/:file       读单份 runs 报告
//   GET /api/reports/mutation/:file   读单份 mutation/judge-cost 报告

import { Hono } from "hono";
import { listDir, readReport } from "../lib/reportIO";

const app = new Hono();

app.get("/runs", (c) => c.json(listDir("runs")));
app.get("/mutation", (c) => c.json(listDir("mutation")));
app.get("/reports/runs/:file", (c) => {
  const data = readReport("runs", c.req.param("file"));
  return data ? c.json(data) : c.json({ error: "not found" }, 404);
});
app.get("/reports/mutation/:file", (c) => {
  const data = readReport("mutation", c.req.param("file"));
  return data ? c.json(data) : c.json({ error: "not found" }, 404);
});

export default app;
