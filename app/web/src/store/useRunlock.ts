import { create } from "zustand";
import { getJson } from "../api/client";

// 全局运行锁状态：轮询 /api/runlock，提供强制解锁（应对请求卡死/僵尸锁）。
interface Running {
  kind: string;
  startedAt: string;
}
interface RunlockState {
  running: Running | null;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
}

export const useRunlock = create<RunlockState>((set) => ({
  running: null,
  refresh: async () => {
    try {
      const d = await getJson<{ running: Running | null }>("/api/runlock");
      set({ running: d.running });
    } catch {
      /* 后端短暂不可用，忽略 */
    }
  },
  clear: async () => {
    try {
      await fetch("/api/runlock/clear", { method: "POST" });
    } finally {
      set({ running: null });
    }
  },
}));
