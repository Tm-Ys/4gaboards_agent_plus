// 极简 CLI 参数解析（不引入 commander 等依赖）。
// 支持 --flag 与 --key value 两种形式。

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

export function asInt(v: string | boolean | undefined, fallback: number): number {
  if (typeof v !== "string") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
