import { create } from "zustand";
import { postSSE } from "../api/client";
import type { ReActStep, Verdict } from "../types";

interface DoneInfo {
  stepCount: number;
  durationMs: number;
  done: boolean;
  timedOut: boolean;
}

interface RunState {
  status: "idle" | "running" | "done" | "error";
  steps: ReActStep[];
  verdict: Verdict | null;
  done: DoneInfo | null;
  error: string | null;
  scenarioId: string | null;
  run: (scenarioId: string) => Promise<void>;
  reset: () => void;
}

export const useRun = create<RunState>((set) => ({
  status: "idle",
  steps: [],
  verdict: null,
  done: null,
  error: null,
  scenarioId: null,
  run: async (scenarioId) => {
    set({ status: "running", steps: [], verdict: null, done: null, error: null, scenarioId });
    try {
      await postSSE("/api/run/scenario", { scenarioId }, {
        step: (s) => set((st) => ({ steps: [...st.steps, s as ReActStep] })),
        verdict: (v) => set({ verdict: v as Verdict }),
        done: (d) => set({ done: d as DoneInfo, status: "done" }),
        error: (e) =>
          set({ status: "error", error: (e as { message?: string }).message ?? String(e) }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg.includes("→ 409") ? "另一个任务正在跑（单账号串行）" : msg });
    }
  },
  reset: () => set({ status: "idle", steps: [], verdict: null, done: null, error: null, scenarioId: null }),
}));
