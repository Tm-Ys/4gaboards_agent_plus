import { useEffect } from "react";
import { useReports } from "../store/useReports";
import type { MutationFile, MutationSummary, BucketScore } from "../types";

const isBoth = (d: MutationFile): d is Extract<MutationFile, { judge: "both" }> =>
  (d as { judge?: string }).judge === "both";
const isSingle = (d: MutationFile): d is Extract<MutationFile, { judge: "lenient" | "strict" }> =>
  (d as { judge?: string }).judge === "lenient" || (d as { judge?: string }).judge === "strict";

const pct = (b: BucketScore) => `${(b.score * 100).toFixed(0)}%`;
const pctN = (n: number) => `${(n * 100).toFixed(0)}%`;

export function MutationReportView() {
  const { mutation, mutationFile, mutationData, loadLists, loadMutation } = useReports();
  useEffect(() => {
    void loadLists();
  }, [loadLists]);
  const muts = mutation.filter((r) => r.type === "mutation");

  return (
    <div className="panel">
      <div className="panel__ctrl">
        <select
          value={mutationFile ?? ""}
          onChange={(e) => e.target.value && void loadMutation(e.target.value)}
          className="select"
        >
          <option value="">选择 mutation 报告…</option>
          {muts.map((r) => (
            <option key={r.file} value={r.file}>
              {r.file}
            </option>
          ))}
        </select>
      </div>
      {!mutationData ? (
        <p className="placeholder">加载变异报告看 must-kill 得分与两判官对比</p>
      ) : (
        <MutationBody data={mutationData} />
      )}
    </div>
  );
}

function SummaryCard({ sum, label }: { sum: MutationSummary; label?: string }) {
  const mk = sum.byCategory["must-kill"];
  return (
    <div className="mut-sum">
      {label && <div className="mut-sum__label">{label}</div>}
      <div className="mut-sum__row">
        <span>总体</span>
        <span className="mut-score">
          {sum.overall.killed}/{sum.overall.total}（{pct(sum.overall)}）
        </span>
      </div>
      {mk && (
        <div className="mut-sum__row">
          <span>must-kill</span>
          <span className="mut-score">
            {mk.killed}/{mk.total}（{pct(mk)}）
          </span>
        </div>
      )}
    </div>
  );
}

function MutationBody({ data }: { data: MutationFile }) {
  if (isBoth(data)) {
    const cmp = data.comparison;
    const only = cmp.itemDiff.filter((x) => x.strictOnly);
    return (
      <div className="mut">
        <div className="mut__pair">
          <SummaryCard sum={data.summaries.lenient} label="lenient" />
          <SummaryCard sum={data.summaries.strict} label="strict" />
        </div>
        <div className="mut__delta">
          must-kill {pctN(cmp.mustKillDelta.lenientScore)} → {pctN(cmp.mustKillDelta.strictScore)}
          （strict 多杀 +{Math.max(0, cmp.mustKillDelta.strictKilled - cmp.mustKillDelta.lenientKilled)}）
        </div>
        <div className="mut__cmp">
          <div className="batch__sec-title">按算子</div>
          {Object.entries(cmp.byOperatorDelta).map(([op, b]) => (
            <div key={op} className="kv">
              <span className="kv__k">{op}</span>
              <span>
                {b.lenient.killed}/{b.lenient.total} → {b.strict.killed}/{b.strict.total}
              </span>
            </div>
          ))}
          {only.length > 0 && <div className="batch__sec-title">strict-only 宽松漏检（{only.length}）</div>}
          {only.map((x) => (
            <div key={x.id} className="cmp-item">
              💀 [{x.category}] {x.operatorId} · {x.description}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const sum = isSingle(data) ? data.summary : (data as Extract<MutationFile, { summary: MutationSummary }>).summary;
  const label = isSingle(data) ? data.judge : undefined;
  return (
    <div className="mut">
      <SummaryCard sum={sum} label={label} />
    </div>
  );
}
