import { create } from "zustand";
import { postSSE } from "../api/client";
import { useBaseline } from "./useBaseline";
import type { ReActStep } from "../types";

interface OutcomeLite {
  scenarioId: string;
  pass: boolean;
  error?: string;
}

interface BatchResult {
  total: number;
  pass: number;
  fail: number;
  passRate: number;
}

interface BatchState {
  status: "idle" | "running" | "done" | "error";
  difficulties: { easy: boolean; medium: boolean; hard: boolean };
  index: number;
  total: number;
  currentScenario: string | null;
  currentSteps: ReActStep[];
  outcomes: OutcomeLite[];
  result: BatchResult | null;
  error: string | null;
  toggleDiff: (d: "easy" | "medium" | "hard") => void;
  run: (ids: string[], opts?: { module?: string; sessionToken?: string }) => Promise<void>;
  reset: () => void;
}

export const useBatch = create<BatchState>((set) => ({
  status: "idle",
  difficulties: { easy: true, medium: false, hard: false },
  index: 0,
  total: 0,
  currentScenario: null,
  currentSteps: [],
  outcomes: [],
  result: null,
  error: null,
  toggleDiff: (d) => set((s) => ({ difficulties: { ...s.difficulties, [d]: !s.difficulties[d] } })),
  run: async (ids, opts) => {
    set({
      status: "running",
      index: 0,
      total: ids.length,
      currentScenario: null,
      currentSteps: [],
      outcomes: [],
      result: null,
      error: null,
    });
    try {
      await postSSE("/api/batch", { ids, module: opts?.module, sessionToken: opts?.sessionToken }, {
        step: (d) => {
          const p = d as { scenarioId: string; step: ReActStep };
          set((s) =>
            p.scenarioId === s.currentScenario
              ? { currentSteps: [...s.currentSteps, p.step] }
              : { currentScenario: p.scenarioId, currentSteps: [p.step] },
          );
        },
        outcome: (d) => {
          const p = d as { index: number; total: number; scenarioId: string; pass: boolean; error?: string };
          set((s) => ({
            index: p.index,
            total: p.total,
            outcomes: [...s.outcomes, { scenarioId: p.scenarioId, pass: p.pass, error: p.error }],
            currentSteps: [],
          }));
        },
        done: (d) => set({ result: d as BatchResult, status: "done" }),
        error: (e) => set({ status: "error", error: (e as { message?: string }).message ?? String(e) }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg });
      // 会话过期（后端重启/超时清池）：基准 token 已失效，重置基准状态，
      // 让 UI 引导用户重新执行基准，而不是拿着废 token 反复 410。
      if (/session|expired|410/i.test(msg)) {
        useBaseline.getState().reset();
      }
    }
  },
  reset: () =>
    set({ status: "idle", index: 0, total: 0, currentScenario: null, currentSteps: [], outcomes: [], result: null, error: null }),
}));
