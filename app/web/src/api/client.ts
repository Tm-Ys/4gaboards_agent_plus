// 前端 API 客户端：只读 GET + 交互 POST→SSE（fetch stream 手解）。
// 同源（dev vite proxy /api → 后端 8787；生产后端托管）。

export async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

export type SseHandlers = Record<string, (data: unknown) => void>;

/** POST + SSE：按 \n\n 分块解析 event:/data:，遇 end 停读。 */
export async function postSSE(path: string, body: unknown, handlers: SseHandlers): Promise<void> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw new Error(`${path} → ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (event === "end") return;
      const h = handlers[event];
      if (h && data) {
        try {
          h(JSON.parse(data));
        } catch {
          /* 忽略畸形事件 */
        }
      }
    }
  }
}
