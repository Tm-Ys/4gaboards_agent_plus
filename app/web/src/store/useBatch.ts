import { create } from "zustand";
import { postSSE } from "../api/client";
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
  run: (ids: string[]) => Promise<void>;
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
  run: async (ids) => {
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
      await postSSE("/api/batch", { ids }, {
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
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  reset: () =>
    set({ status: "idle", index: 0, total: 0, currentScenario: null, currentSteps: [], outcomes: [], result: null, error: null }),
}));
