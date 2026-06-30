// POST /api/batch → SSE: step*(带 scenarioId) → outcome → ... → done
// 批量执行选中场景（全量测试）。单账号串行，全局锁。
// 任务二增强：支持模块链模式（module）+ 会话池复用（sessionToken）。
//   - 带 sessionToken：从池取基准已建好的 session 复用（DOM pre-check 命中→跳过重建），跑完关闭出池。
//   - 带 module：按模块过滤场景 + 构造依赖图，走 runModuleChain 链式模式（同 session 串成一条链）。

import { Hono } from "hono";
import { runBatch } from "../../src/agent/runner/runBatch";
import { loadScenarioSet } from "../../src/scenarioStore";
import { DependencyGraph } from "../../src/agent/dependencyGraph";
import { sseStream } from "../lib/sse";
import { tryAcquire, release } from "../lib/lock";
import { getSession, closeSession } from "../lib/sessionPool";

const app = new Hono();

app.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    ids?: string[];
    set?: string;
    maxSteps?: number;
    module?: string;
    sessionToken?: string;
  } | null;
  const set = body?.set ?? "basic";
  const setBundle = loadScenarioSet(set);
  const all = setBundle.scenarios.scenarios;

  // 模块链模式：按 module 过滤场景（场景无 module 字段，经 feature 目录反查）。
  const module = body?.module;
  let list = all;
  if (module) {
    const modOf = new Map(setBundle.features.feature_points.map((f) => [f.id, f.module]));
    list = all.filter((s) => modOf.get(s.feature_id) === module);
  } else if (body?.ids) {
    const want = body.ids;
    list = all.filter((s) => want.includes(s.id));
  }
  if (list.length === 0) return c.json({ error: "no scenarios selected" }, 400);

  // 会话池复用：带 token 取基准的 session（模块链跑在同一页面状态上）。
  const pooledCtx = body?.sessionToken ? getSession(body.sessionToken) : null;
  if (body?.sessionToken && !pooledCtx) {
    return c.json({ error: "session expired or not found" }, 410);
  }

  if (!tryAcquire("run-batch")) return c.json({ error: "another task is running" }, 409);

  return sseStream(c, async (emit) => {
    try {
      const report = await runBatch(list, {
        maxSteps: body?.maxSteps ?? 20,
        setName: set,
        filter: { ids: body?.ids, module },
        module,
        depGraph: module ? new DependencyGraph(setBundle.features.feature_points) : undefined,
        scenarioLookup: all,
        features: setBundle.features,
        pooledCtx: pooledCtx ?? undefined,
        onProgress: (i, total, o) =>
          void emit("outcome", {
            index: i,
            total,
            scenarioId: o.scenario.id,
            pass: o.result?.verdict.pass ?? false,
            error: o.error,
          }),
        onStep: (sid, step) => void emit("step", { scenarioId: sid, step }),
      });
      await emit("done", {
        total: report.total,
        pass: report.summary.pass,
        fail: report.summary.fail,
        passRate: report.summary.passRate,
      });
    } catch (e) {
      await emit("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      // 复用了池里的 session：跑完关闭出池（基准使命已完成）。
      if (body?.sessionToken) await closeSession(body.sessionToken);
      release();
    }
  });
});

export default app;
