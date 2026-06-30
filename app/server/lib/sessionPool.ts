// 持久浏览器 session 注册表：让基准请求与后续模块链请求**复用同一 session**。
// SSE 是单请求单响应，而「执行基准 → 选模块跑链」是两次请求。基准跑完不关 session，
// 凭 token 入池；模块链请求带 token 取出复用，跑完关闭出池。
//
// 三道防泄漏防线：
// 1. 基准失败 / 模块链结束或异常：立即 close(token) 移出池。
// 2. 空闲超时（默认 5 分钟）：兜底关闭无人认领的 session，防遗忘泄漏。
// 3. 进程退出时 Hono 不保证回调，故主要靠前两道 + 超时。

import { randomBytes } from "node:crypto";
import { BrowserSession } from "../../src/agent/browser/context";
import type { ToolContext } from "../../src/agent/tools/registry";
import "../../src/agent/tools/browser"; // 注册 B 层
import "../../src/agent/tools/domain"; // 注册 A 层

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟空闲兜底

interface Entry {
  token: string;
  ctx: ToolContext;
  lastTouched: number;
  /** 到期时清理 session。每开一个 session 起一个定时器，关闭时清除。 */
  timer: NodeJS.Timeout;
}

const pool = new Map<string, Entry>();

/** 开一个 headless session 并入池，返回 token。调用方负责在用完后 close(token)。 */
export async function openSession(namespace: string): Promise<{ token: string; ctx: ToolContext }> {
  const session = await BrowserSession.launch({ headless: true });
  const ctx: ToolContext = { session, page: session.page, namespace };
  const token = randomBytes(9).toString("base64url");
  const arm = (): NodeJS.Timeout => setTimeout(() => void closeSession(token), IDLE_TIMEOUT_MS);
  const entry: Entry = { token, ctx, lastTouched: Date.now(), timer: arm() };
  pool.set(token, entry);
  return { token, ctx };
}

/** 取出 session 复用（重置空闲定时器）。不存在返回 null（可能已超时关闭）。 */
export function getSession(token: string): ToolContext | null {
  const entry = pool.get(token);
  if (!entry) return null;
  entry.lastTouched = Date.now();
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void closeSession(token), IDLE_TIMEOUT_MS);
  return entry.ctx;
}

/** 关闭并移出池。已不存在则无操作（幂等）。 */
export async function closeSession(token: string): Promise<void> {
  const entry = pool.get(token);
  if (!entry) return;
  pool.delete(token);
  clearTimeout(entry.timer);
  try {
    await entry.ctx.session.close();
  } catch {
    // 关闭失败忽略（可能已被 demo 站回收）。
  }
}
