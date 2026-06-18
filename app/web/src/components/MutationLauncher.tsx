import { useCatalog } from "../store/useCatalog";
import { useMutation } from "../store/useMutation";

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function MutationLauncher() {
  const selectedId = useCatalog((s) => s.selectedId);
  const layer = useMutation((s) => s.layer);
  const judge = useMutation((s) => s.judge);
  const status = useMutation((s) => s.status);
  const events = useMutation((s) => s.events);
  const summary = useMutation((s) => s.summary);
  const comparison = useMutation((s) => s.comparison);
  const error = useMutation((s) => s.error);
  const setLayer = useMutation((s) => s.setLayer);
  const setJudge = useMutation((s) => s.setJudge);
  const launch = useMutation((s) => s.launch);
  const reset = useMutation((s) => s.reset);
  const running = status === "running";

  return (
    <div className="mut-launch">
      <div className="mut-launch__ctrl">
        <select
          value={layer}
          onChange={(e) => setLayer(e.target.value as "spec" | "trace")}
          className="select"
          disabled={running}
        >
          <option value="spec">Layer1 · spec（改 expectation）</option>
          <option value="trace">Layer2 · trace（注入故障）</option>
        </select>
        <select
          value={judge}
          onChange={(e) => setJudge(e.target.value as "lenient" | "strict" | "both")}
          className="select"
          disabled={running}
        >
          <option value="lenient">lenient 判官</option>
          <option value="strict">strict 判官</option>
          <option value="both">both 对比</option>
        </select>
        <button
          className="btn btn--sm btn--run"
          disabled={running || !selectedId}
          onClick={() => selectedId && launch(selectedId)}
        >
          {running ? "测试中…" : "▶ 变异测试"}
        </button>
        {status !== "idle" && (
          <button className="btn btn--sm" onClick={reset}>
            清空
          </button>
        )}
      </div>
      <div className="mut-launch__sel">{selectedId ? `目标：${selectedId}` : "← 先在任务一选场景"}</div>
      {events.length > 0 && (
        <div className="mut-launch__events">
          {events.map((e, i) => {
            if (e.type === "scenario")
              return (
                <div key={i} className="mut-evt mut-evt--scen">
                  [{e.mode}] 基线 {e.baselinePass ? "✅" : "…"} {e.note ?? ""}
                </div>
              );
            return (
              <div key={i} className={"mut-evt" + (e.killed ? " is-kill" : "")}>
                {e.killed ? "💀" : "🐸"} [{e.mode}] {e.operatorId} · {e.description}
              </div>
            );
          })}
        </div>
      )}
      {summary && !comparison && (
        <div className="mut-sum">
          <div className="mut-sum__row">
            <span>总体</span>
            <span className="mut-score">
              {summary.overall.killed}/{summary.overall.total}（{pct(summary.overall.score)}）
            </span>
          </div>
          {summary.byCategory["must-kill"] && (
            <div className="mut-sum__row">
              <span>must-kill</span>
              <span className="mut-score">
                {summary.byCategory["must-kill"].killed}/{summary.byCategory["must-kill"].total}
              </span>
            </div>
          )}
        </div>
      )}
      {comparison && (
        <div className="mut__delta">
          must-kill {pct(comparison.mustKillDelta.lenientScore)} → {pct(comparison.mustKillDelta.strictScore)}
          （strict 多杀 +{Math.max(0, comparison.mustKillDelta.strictKilled - comparison.mustKillDelta.lenientKilled)}）
        </div>
      )}
      {error && <div className="timeline__err">⚠ {error}</div>}
    </div>
  );
}
