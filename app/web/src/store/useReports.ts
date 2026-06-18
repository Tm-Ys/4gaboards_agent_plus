import { create } from "zustand";
import { getJson } from "../api/client";
import type { ReportEntry, BatchReport, MutationFile, JudgeCostReport } from "../types";

interface ReportsState {
  runs: ReportEntry[];
  mutation: ReportEntry[];
  runsFile: string | null;
  mutationFile: string | null;
  judgeCostFile: string | null;
  runsData: BatchReport | null;
  mutationData: MutationFile | null;
  judgeCostData: JudgeCostReport | null;
  loadLists: () => Promise<void>;
  loadRuns: (file: string) => Promise<void>;
  loadMutation: (file: string) => Promise<void>;
  loadJudgeCost: (file: string) => Promise<void>;
}

export const useReports = create<ReportsState>((set) => ({
  runs: [],
  mutation: [],
  runsFile: null,
  mutationFile: null,
  judgeCostFile: null,
  runsData: null,
  mutationData: null,
  judgeCostData: null,
  loadLists: async () => {
    const [runs, mutation] = await Promise.all([
      getJson<ReportEntry[]>("/api/runs"),
      getJson<ReportEntry[]>("/api/mutation"),
    ]);
    set({ runs, mutation });
  },
  loadRuns: async (file) => {
    const data = await getJson<BatchReport>(`/api/reports/runs/${encodeURIComponent(file)}`);
    set({ runsFile: file, runsData: data });
  },
  loadMutation: async (file) => {
    const data = await getJson<MutationFile>(`/api/reports/mutation/${encodeURIComponent(file)}`);
    set({ mutationFile: file, mutationData: data });
  },
  loadJudgeCost: async (file) => {
    const data = await getJson<JudgeCostReport>(`/api/reports/mutation/${encodeURIComponent(file)}`);
    set({ judgeCostFile: file, judgeCostData: data });
  },
}));
