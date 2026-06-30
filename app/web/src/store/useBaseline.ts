import { create } from "zustand";
import { postSSE } from "../api/client";

/** 基线 P1 单步结果（后端 step 事件）。 */
interface BaselineStep {
  purpose: string;
  ok: boolean;
  summary: string;
}

interface BaselineDone {
  token: string;
  summary: string;
  alreadyReady: boolean;
}

interface BaselineState {
  status: "idle" | "running" | "done" | "error";
  steps: BaselineStep[];
  token: string | null;
  summary: string | null;
  error: string | null;
  run: () => Promise<void>;
  reset: () => void;
}

// 基线执行 SSE：P1 每步完成 → step*，成功 → done{token}，失败 → error。
// token 是会话池凭据，成功后交给模块链请求复用同一浏览器 session。
export const useBaseline = create<BaselineState>((set) => ({
  status: "idle",
  steps: [],
  token: null,
  summary: null,
  error: null,
  run: async () => {
    set({ status: "running", steps: [], token: null, summary: null, error: null });
    try {
      await postSSE("/api/baseline", {}, {
        step: (s) => set((st) => ({ steps: [...st.steps, s as BaselineStep] })),
        done: (d) => {
          const info = d as BaselineDone;
          set({ status: "done", token: info.token, summary: info.summary });
        },
        error: (e) =>
          set({ status: "error", error: (e as { message?: string }).message ?? String(e) }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg.includes("→ 409") ? "另一个任务正在跑（单账号串行）" : msg });
    }
  },
  reset: () => set({ status: "idle", steps: [], token: null, summary: null, error: null }),
}));
