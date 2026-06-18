import { create } from "zustand";
import { postSSE } from "../api/client";
import type { MutationSummary, JudgeComparison } from "../types";

interface MutEvent {
  type: "scenario" | "mutant" | "fault";
  mode?: string;
  baselinePass?: boolean;
  count?: number;
  note?: string;
  index?: number;
  total?: number;
  operatorId?: string;
  category?: string;
  description?: string;
  killed?: boolean;
}

interface MutState {
  status: "idle" | "running" | "done" | "error";
  layer: "spec" | "trace";
  judge: "lenient" | "strict" | "both";
  events: MutEvent[];
  summary: MutationSummary | null;
  comparison: JudgeComparison | null;
  error: string | null;
  setLayer: (l: "spec" | "trace") => void;
  setJudge: (j: "lenient" | "strict" | "both") => void;
  launch: (scenarioId: string) => Promise<void>;
  reset: () => void;
}

export const useMutation = create<MutState>((set, get) => ({
  status: "idle",
  layer: "spec",
  judge: "lenient",
  events: [],
  summary: null,
  comparison: null,
  error: null,
  setLayer: (l) => set({ layer: l }),
  setJudge: (j) => set({ judge: j }),
  launch: async (scenarioId) => {
    set({ status: "running", events: [], summary: null, comparison: null, error: null });
    try {
      const { layer, judge } = get();
      await postSSE("/api/mutation", { scenarioId, layer, judge }, {
        scenario: (d) => set((s) => ({ events: [...s.events, { type: "scenario", ...(d as object) }] })),
        mutant: (d) => set((s) => ({ events: [...s.events, { type: "mutant", ...(d as object) }] })),
        fault: (d) => set((s) => ({ events: [...s.events, { type: "fault", ...(d as object) }] })),
        summary: (d) => set({ summary: d as MutationSummary }),
        comparison: (d) => set({ comparison: d as JudgeComparison }),
        done: () => set({ status: "done" }),
        error: (e) => set({ status: "error", error: (e as { message?: string }).message ?? String(e) }),
      });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  reset: () => set({ status: "idle", events: [], summary: null, comparison: null, error: null }),
}));
