import { create } from "zustand";
import { postSSE } from "../api/client";

interface LogLine {
  script: string;
  line: string;
}

interface GenState {
  status: "idle" | "running" | "done" | "error";
  logs: LogLine[];
  error: string | null;
  regenerate: () => Promise<void>;
  reset: () => void;
}

export const useGenerate = create<GenState>((set) => ({
  status: "idle",
  logs: [],
  error: null,
  regenerate: async () => {
    set({ status: "running", logs: [], error: null });
    try {
      await postSSE("/api/regenerate", {}, {
        log: (l) => set((s) => ({ logs: [...s.logs, l as LogLine] })),
        done: () => set({ status: "done" }),
        error: (e) => set({ status: "error", error: (e as { message?: string }).message ?? String(e) }),
      });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  reset: () => set({ status: "idle", logs: [], error: null }),
}));
