// SSE 流封装：把 Hono 的 streamSSE 包成一个「给 emit 函数，handler 里随便推事件」的形态。
// 调用方：return sseStream(c, async (emit) => { ...; emit("step", s); ... })。
// 出错自动发 error 事件；结束自动发 end（前端据此停读）。

import { streamSSE } from "hono/streaming";
import type { Context } from "hono";

export type Emit = (event: string, data: unknown) => Promise<void>;

export function sseStream(c: Context, handler: (emit: Emit) => Promise<void>) {
  return streamSSE(c, async (stream) => {
    const emit: Emit = async (event, data) => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };
    try {
      await handler(emit);
    } catch (e) {
      await emit("error", { message: e instanceof Error ? e.message : String(e) });
    }
    await stream.writeSSE({ event: "end", data: "" });
  });
}
