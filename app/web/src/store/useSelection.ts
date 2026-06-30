import { create } from "zustand";

// 选中状态：串联任务一（测试链目录）与任务二（执行器）。
// 任务一点链标题 → setModule(module)；任务二读 selectedModule 决定"执行选中链"跑哪个模块。
// 为 null 表示未选链（任务二的执行按钮禁用）。
interface SelectionState {
  selectedModule: string | null;
  setModule: (module: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedModule: null,
  setModule: (module) => set({ selectedModule: module }),
}));
