import type { Verdict } from "../types";

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const confClass = verdict.confidence === "high" ? "easy" : verdict.confidence === "medium" ? "medium" : "hard";
  return (
    <div className={"verdict " + (verdict.pass ? "is-ok" : "is-bad")}>
      <div className="verdict__head">
        <span className="verdict__pass">{verdict.pass ? "✓ PASS" : "✗ FAIL"}</span>
        <span className={"badge badge--" + confClass}>{verdict.confidence}</span>
      </div>
      <div className="verdict__reason">{verdict.reason}</div>
      {verdict.matched.length > 0 && (
        <div className="verdict__feats">
          <span className="verdict__feats-l">已确认</span>
          {verdict.matched.map((m, i) => (
            <span key={i} className="feat feat--ok">
              {m}
            </span>
          ))}
        </div>
      )}
      {verdict.missed.length > 0 && (
        <div className="verdict__feats">
          <span className="verdict__feats-l">未确认</span>
          {verdict.missed.map((m, i) => (
            <span key={i} className="feat feat--miss">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
