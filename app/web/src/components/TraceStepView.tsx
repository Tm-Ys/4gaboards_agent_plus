import type { ReActStep } from "../types";

export function TraceStepView({ step }: { step: ReActStep }) {
  const cls = step.ok === false ? " is-bad" : step.ok === true ? " is-ok" : "";
  const args = step.args as Record<string, unknown> | undefined;
  const argKeys = args && typeof args === "object" ? Object.keys(args) : [];

  return (
    <div className={"trace" + cls}>
      <div className="trace__head">
        <span className="trace__n">{step.step}</span>
        {step.tool && <span className="trace__tool">{step.tool}</span>}
        {step.ok === false && <span className="trace__mark">✗</span>}
        {step.ok === true && <span className="trace__mark trace__mark--ok">✓</span>}
      </div>
      {step.thought && <div className="trace__thought">{step.thought}</div>}
      {argKeys.length > 0 && <pre className="trace__args">{JSON.stringify(args)}</pre>}
      {step.result && <div className="trace__result">{step.result}</div>}
      {step.trace && step.trace.length > 0 && (
        <div className="trace__sub">
          {step.trace.map((t, i) => (
            <div key={i} className="trace__sub-item">
              <span className="trace__sub-label">· {t.label}</span>
              {t.observation && <pre className="trace__obs">{t.observation}</pre>}
            </div>
          ))}
        </div>
      )}
      {step.observation && <pre className="trace__obs">{step.observation}</pre>}
    </div>
  );
}
