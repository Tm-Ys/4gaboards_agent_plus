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

export function current(): Running | null {
  return running;
}
