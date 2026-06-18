// POST /api/regenerate → SSE: log* → done
// 重新生成任务一场景目录：spawn `npm run extract` + `npm run scenarios`（覆盖 features.json + scenarios.json）。
// 不改 extract/generate 现有代码（它们是 main+exit 脚本，不能 import），用 spawn 调 CLI。

import { spawn } from "node:child_process";
import path from "node:path";
import { Hono } from "hono";
import { settings } from "../../src/config";
import { sseStream } from "../lib/sse";
import type { Emit } from "../lib/sse";
import { tryAcquire, release } from "../lib/lock";

const app = new Hono();
const APP_DIR = path.resolve(settings.outputsDir, "..");
const STRIP_ANSI = /\x1b\[[0-9;]*m/g;

function runScript(emit: Emit, script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("npm", ["run", script], {
      cwd: APP_DIR,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const onStream = (stream: NodeJS.ReadableStream) => {
      let buf = "";
      stream.on("data", (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          const clean = l.replace(STRIP_ANSI, "").trim();
          if (clean) void emit("log", { script, line: clean });
        }
      });
    };
    onStream(p.stdout);
    onStream(p.stderr);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

app.post("/", async (c) => {
  if (!tryAcquire("regenerate")) return c.json({ error: "another task is running" }, 409);
  return sseStream(c, async (emit) => {
    try {
      await emit("log", { script: "start", line: "▶ 重新生成场景目录：extract → scenarios（约 5-10 分钟）" });
      await runScript(emit, "extract");
      await runScript(emit, "scenarios");
      await emit("done", { ok: true });
    } catch (e) {
      await emit("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      release();
    }
  });
});

export default app;
