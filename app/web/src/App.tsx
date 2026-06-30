import type { ReactNode } from "react";
import { UnlockButton } from "./components/UnlockButton";
import { ScenarioList } from "./components/ScenarioList";
import { Task2Panel } from "./components/Task2Panel";
import { BatchReportView } from "./components/BatchReportView";
import { MutationLauncher } from "./components/MutationLauncher";
import { MutationReportView } from "./components/MutationReportView";
import { JudgeCostView } from "./components/JudgeCostView";

// 三列看板：任务一 / 任务二 / 任务三，对应论文三个贡献。
export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">4gaBoards 测试智能体</h1>
        <span className="topbar__sub">场景生成 · ReAct 执行 · 变异与判官</span>
        <UnlockButton />
      </header>
      <main className="board">
        <Column title="任务一" subtitle="测试链目录">
          <ScenarioList />
        </Column>
        <Column title="任务二" subtitle="基准与执行链">
          <Task2Panel />
          <hr className="col-divider" />
          <BatchReportView />
        </Column>
        <Column title="任务三" subtitle="变异测试">
          <MutationLauncher />
          <hr className="col-divider" />
          <MutationReportView />
          <hr className="col-divider" />
          <JudgeCostView />
        </Column>
      </main>
    </div>
  );
}

function Column({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="column">
      <header className="column__head">
        <h2 className="column__title">{title}</h2>
        <span className="column__sub">{subtitle}</span>
      </header>
      <div className="column__body">{children}</div>
    </section>
  );
}
