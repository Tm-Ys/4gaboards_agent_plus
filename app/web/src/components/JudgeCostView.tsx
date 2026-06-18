import { useEffect } from "react";
import { useReports } from "../store/useReports";
import type { JudgeCostReport } from "../types";

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function JudgeCostView() {
  const mutation = useReports((s) => s.mutation);
  const judgeCostFile = useReports((s) => s.judgeCostFile);
  const judgeCostData = useReports((s) => s.judgeCostData);
  const loadLists = useReports((s) => s.loadLists);
  const loadJudgeCost = useReports((s) => s.loadJudgeCost);
  useEffect(() => {
    void loadLists();
  }, [loadLists]);
  const costs = mutation.filter((r) => r.type === "judge-cost");

  return (
    <div className="panel">
      <div className="panel__ctrl">
        <select
          value={judgeCostFile ?? ""}
          onChange={(e) => e.target.value && void loadJudgeCost(e.target.value)}
          className="select"
        >
          <option value="">选择 judge-cost 报告…</option>
          {costs.map((r) => (
            <option key={r.file} value={r.file}>
              {r.file}
            </option>
          ))}
        </select>
      </div>
      {!judgeCostData ? (
        <p className="placeholder">加载宽松代价三角（lenient vs strict 真实 PASS 率 + 误杀）</p>
      ) : (
        <CostBody data={judgeCostData} />
      )}
    </div>
  );
}

function CostBody({ data }: { data: JudgeCostReport }) {
  const l = data.passRate.lenient;
  const s = data.passRate.strict;
  const drop = (l.rate - s.rate) * 100;
  return (
    <div className="cost">
      <div className="cost__title">宽松代价三角</div>
      <div className="cost__bars">
        <Bar label="lenient" rate={l.rate} pass={l.pass} total={l.total} />
        <Bar label="strict" rate={s.rate} pass={s.pass} total={s.total} />
      </div>
      <div className="cost__drop">
        strict 误杀 {data.falsePositives.length}（PASS 率 {drop >= 0 ? "-" : "+"}
        {Math.abs(drop).toFixed(0)}pp · 判 {data.scenariosJudged} 场景）
      </div>
      {data.falsePositives.length > 0 && (
        <div>
          <div className="batch__sec-title">误杀明细（{data.falsePositives.length}）</div>
          <div className="cost__fp">
            {data.falsePositives.map((e) => (
              <div key={e.scenarioId} className="cost__fp-item">
                <span className="cost__fp-id">
                  [{e.difficulty}] {e.scenarioId}
                </span>
                <span className="cost__fp-reason">{e.strict.reason.slice(0, 140)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ label, rate, pass, total }: { label: string; rate: number; pass: number; total: number }) {
  return (
    <div className="bar">
      <div className="bar__label">{label}</div>
      <div className="bar__track">
        <div className="bar__fill" style={{ width: `${rate * 100}%` }} />
      </div>
      <div className="bar__num">
        {pct(rate)}（{pass}/{total}）
      </div>
    </div>
  );
}
