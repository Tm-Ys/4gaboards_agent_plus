import { useCatalog } from "../store/useCatalog";
import { useRun } from "../store/useRun";

export function RunPanel() {
  const selectedId = useCatalog((s) => s.selectedId);
  const status = useRun((s) => s.status);
  const run = useRun((s) => s.run);
  const reset = useRun((s) => s.reset);
  const running = status === "running";

  return (
    <div className="runpanel">
      <div className="runpanel__warn">⚠ 点 Run 会真改 demo 站数据（namespace 自动隔离、跑完清理）</div>
      <div className="runpanel__ctrl">
        <button
          className={"btn btn--run" + (running ? " is-running" : "")}
          disabled={!selectedId || running}
          onClick={() => selectedId && void run(selectedId)}
        >
          {running ? "运行中…" : "▶ Run 场景"}
        </button>
        {status !== "idle" && (
          <button className="btn" onClick={reset}>
            清空
          </button>
        )}
      </div>
      <div className="runpanel__sel">{selectedId ? `目标：${selectedId}` : "← 先在任务一选一个场景"}</div>
    </div>
  );
}
