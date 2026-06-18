import { useEffect } from "react";
import { useReports } from "../store/useReports";
import type { BatchReport } from "../types";

export function BatchReportView() {
  const { runs, runsFile, runsData, loadLists, loadRuns } = useReports();
  useEffect(() => {
    void loadLists();
  }, [loadLists]);
  const batches = runs.filter((r) => r.type === "batch");

  return (
    <div className="panel">
      <div className="panel__ctrl">
        <select
          value={runsFile ?? ""}
          onChange={(e) => e.target.value && void loadRuns(e.target.value)}
          className="select"
        >
          <option value="">选择 batch 报告…</option>
          {batches.map((r) => (
            <option key={r.file} value={r.file}>
              {r.file}
            </option>
          ))}
        </select>
      </div>
      {!runsData ? (
        <p className="placeholder">加载 batch 报告看通过率与逐场景结果</p>
      ) : (
        <BatchBody data={runsData} />
      )}
    </div>
  );
}

function BatchBody({ data }: { data: BatchReport }) {
  const s = data.summary;
  return (
    <div className="batch">
      <div className="batch__rate">
        <span className="batch__rate-num">{(s.passRate * 100).toFixed(0)}%</span>
        <span className="batch__rate-sub">
          通过率 · {s.pass}/{s.total}
        </span>
      </div>
      <div className="batch__grid">
        <Metric label="通过" value={s.pass} />
        <Metric label="失败" value={s.fail} />
        <Metric label="异常" value={s.error} />
        <Metric label="平均步数" value={s.avgSteps} />
      </div>
      <div>
        <div className="batch__sec-title">按难度</div>
        {Object.entries(s.byDifficulty).map(([k, v]) => (
          <div key={k} className="kv">
            <span>{k}</span>
            <span>
              {v.pass}/{v.total}
            </span>
          </div>
        ))}
      </div>
      <div>
        <div className="batch__sec-title">逐场景（{data.outcomes.length}）</div>
        <div className="batch__outcomes">
          {data.outcomes.map((o, i) => (
            <div
              key={i}
              className={"outcome " + (o.result ? (o.result.verdict.pass ? "is-ok" : "is-bad") : "is-err")}
            >
              <span className="outcome__mark">{o.result ? (o.result.verdict.pass ? "✓" : "✗") : "⚠"}</span>
              <span className="outcome__id">{o.scenario.id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <div className="metric__v">{value}</div>
      <div className="metric__l">{label}</div>
    </div>
  );
}
