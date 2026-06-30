// POST /api/baseline → SSE：step*(P1 每步完成) → done{token, summary} | error
// 执行全局基准：开浏览器 session 入池 → 登录(P0) → 建 project/board/list/card(P1)。
// 成功后 session 保留在池里（带 token 返回前端），供后续模块链请求复用同一页面状态。
// 失败时 session 立即关闭出池（防泄漏）。

import { Hono } from "hono";
import { registry } from "../../src/agent/tools/registry";
import { loadScenarioSet } from "../../src/scenarioStore";
import { loadBaseline, runBaseline } from "../../src/agent/runner/runBaseline";
import { sseStream } from "../lib/sse";
import { tryAcquire, release } from "../lib/lock";
import { openSession, closeSession } from "../lib/sessionPool";

const app = new Hono();

app.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { set?: string; maxSteps?: number } | null;
  const set = body?.set ?? "basic";
  const baseline = loadBaseline(set);
  if (!baseline) return c.json({ error: "baseline.json not found" }, 404);

  const { scenarios } = loadScenarioSet(set);

  if (!tryAcquire("run-baseline")) return c.json({ error: "another task is running" }, 409);

  return sseStream(c, async (emit) => {
    const namespace = `bs-${Date.now().toString(36)}`;
    const { token, ctx } = await openSession(namespace);
    try {
      // P0：登录（runBaseline skipLogin=false 时内部执行 auth_login）。
      const result = await runBaseline(ctx, baseline, {
        namespace,
        scenarios: scenarios.scenarios,
        maxSteps: body?.maxSteps ?? 20,
        skipLogin: false,
        onProgress: (o) => void emit("step", o),
      });
      const summary = result.alreadyReady
        ? "页面已就绪，跳过 P1 创建"
        : `P1 完成：${result.steps.length} 步全部成功`;
      // session 不关闭，token 交前端，供模块链复用。
      await emit("done", { token, summary, alreadyReady: result.alreadyReady });
    } catch (e) {
      // 基线失败：立即关闭 session 出池，避免泄漏 + 释放全局锁。
      await closeSession(token);
      await emit("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      release();
    }
  });
});

export default app;
