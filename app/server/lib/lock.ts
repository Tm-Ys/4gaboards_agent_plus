// 全局 in-flight 锁：demo 站单账号，同一时刻只允许一个交互任务（Run/变异/judge-cost）。
// 并发触发的第二个返回 409（前端据此禁用 Run 按钮并提示）。

interface Running {
  kind: string;
  startedAt: string;
}

let running: Running | null = null;

export function tryAcquire(kind: string): boolean {
  if (running) return false;
  running = { kind, startedAt: new Date().toISOString() };
  return true;
}

export function release(): void {
  running = null;
}

/** 强制清锁（前端「强制解锁」按钮用）：仅清锁状态，不中断后端正在跑的请求。
 * 用于应对请求卡死/僵尸锁。注意：若原请求还在真的跑浏览器操作，清锁后可能并发，应仅在确认卡死时用。 */
export function forceRelease(): void {
  running = null;
}

export function current(): Running | null {
  return running;
}
