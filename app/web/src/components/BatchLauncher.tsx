import { useCatalog } from "../store/useCatalog";
import { useBatch } from "../store/useBatch";
import { TraceStepView } from "./TraceStepView";

export function BatchLauncher() {
  const scenarios = useCatalog((s) => s.scenarios);
  const difficulties = useBatch((s) => s.difficulties);
  const toggleDiff = useBatch((s) => s.toggleDiff);
  const status = useBatch((s) => s.status);
  const index = useBatch((s) => s.index);
  const total = useBatch((s) => s.total);
  const currentScenario = useBatch((s) => s.currentScenario);
  const currentSteps = useBatch((s) => s.currentSteps);
  const outcomes = useBatch((s) => s.outcomes);
  const result = useBatch((s) => s.result);
  const error = useBatch((s) => s.error);
  const run = useBatch((s) => s.run);
  const reset = useBatch((s) => s.reset);

  const all = scenarios?.scenarios ?? [];
  const selected = all.filter((s) => difficulties[s.difficulty as "easy" | "medium" | "hard"]);
  const running = status === "running";

  return (
    <div className="batch-run">
      <div className="batch-run__ctrl">
        {(["easy", "medium", "hard"] as const).map((d) => (
          <label key={d} className="chk">
            <input type="checkbox" checked={difficulties[d]} onChange={() => toggleDiff(d)} /> {d}
          </label>
        ))}
        <button
          className="btn btn--sm btn--run"
          disabled={running || selected.length === 0}
          onClick={() => run(selected.map((s) => s.id))}
          title="按选中难度批量跑所有场景（单账号串行，可能很久）"
        >
          {running ? "测试中…" : `▶ 全量测试 ${selected.length}`}
        </button>
        {status !== "idle" && (
          <button className="btn btn--sm" onClick={reset}>
            清空
          </button>
        )}
      </div>
      {(running || result) && (
        <div className="bar">
          <div className="bar__label">{result ? "完成" : "进度"}</div>
          <div className="bar__track">
            <div className="bar__fill" style={{ width: `${total ? (index / total) * 100 : 0}%` }} />
          </div>
          <div className="bar__num">
            {index}/{total}
            {result ? `（PASS ${(result.passRate * 100).toFixed(0)}%）` : ""}
          </div>
        </div>
      )}
      {currentScenario && (
        <div className="batch-run__cur">
          <div className="batch-run__cur-id">
            ▶ {currentScenario}（第 {Math.min(index + 1, total)}/{total}）
          </div>
          {currentSteps.map((s) => (
            <TraceStepView key={s.step} step={s} />
          ))}
        </div>
      )}
      {outcomes.length > 0 && (
        <div className="batch__outcomes">
          {outcomes.map((o) => (
            <div
              key={o.scenarioId}
              className={"outcome " + (o.error ? "is-err" : o.pass ? "is-ok" : "is-bad")}
            >
              <span className="outcome__mark">{o.error ? "⚠" : o.pass ? "✓" : "✗"}</span>
              <span className="outcome__id">{o.scenarioId}</span>
            </div>
          ))}
        </div>
      )}
      {error && <div className="timeline__err">⚠ {error}</div>}
    </div>
  );
}
