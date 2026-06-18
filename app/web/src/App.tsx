import type { ReactNode } from "react";
import { ScenarioList } from "./components/ScenarioList";
import { RunPanel } from "./components/RunPanel";
import { Timeline } from "./components/Timeline";
import { BatchReportView } from "./components/BatchReportView";
import { MutationReportView } from "./components/MutationReportView";
import { JudgeCostView } from "./components/JudgeCostView";

// 三列看板：任务一 / 任务二 / 任务三，对应论文三个贡献。
export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">4gaBoards 测试智能体</h1>
        <span className="topbar__sub">场景生成 · ReAct 执行 · 变异与判官</span>
      </header>
      <main className="board">
        <Column title="任务一" subtitle="场景目录">
          <ScenarioList />
        </Column>
        <Column title="任务二" subtitle="执行与轨迹">
          <RunPanel />
          <Timeline />
          <hr className="col-divider" />
          <BatchReportView />
        </Column>
        <Column title="任务三" subtitle="变异与宽松代价">
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
