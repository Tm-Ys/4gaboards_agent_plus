// POST /api/run/scenario → SSE：step* → verdict → done
// 单场景实时执行（浏览器跑一次，onStep 推每步）。全局锁，并发 409。

import { Hono } from "hono";
import { runScenario } from "../../src/agent/runner/runScenario";
import { loadScenarioSet } from "../../src/scenarioStore";
import { sseStream } from "../lib/sse";
import { tryAcquire, release } from "../lib/lock";

const app = new Hono();

app.post("/scenario", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    scenarioId?: string;
    set?: string;
    maxSteps?: number;
  } | null;
  if (!body?.scenarioId) return c.json({ error: "scenarioId required" }, 400);

  const set = body.set ?? "basic";
  const { scenarios } = loadScenarioSet(set);
  const sc = scenarios.scenarios.find((s) => s.id === body.scenarioId);
  if (!sc) return c.json({ error: "scenario not found" }, 404);

  if (!tryAcquire("run-scenario")) return c.json({ error: "another task is running" }, 409);

  const ns = `web-${sc.id}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return sseStream(c, async (emit) => {
    try {
      const result = await runScenario(sc, {
        maxSteps: body.maxSteps ?? 20,
        headless: true,
        namespace: ns,
        onStep: (s) => void emit("step", s),
      });
      await emit("verdict", result.verdict);
      await emit("done", {
        stepCount: result.stepCount,
        durationMs: result.durationMs,
        done: result.done,
        timedOut: result.timedOut,
      });
    } finally {
      release();
    }
  });
});

export default app;
