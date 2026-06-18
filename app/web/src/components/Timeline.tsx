import { useRun } from "../store/useRun";
import { TraceStepView } from "./TraceStepView";
import { VerdictBadge } from "./VerdictBadge";

export function Timeline() {
  const { steps, verdict, done, status, error } = useRun();

  if (status === "idle" && steps.length === 0) {
    return null;
  }

  return (
    <div className="timeline">
      {steps.map((s) => (
        <TraceStepView key={s.step} step={s} />
      ))}
      {verdict && <VerdictBadge verdict={verdict} />}
      {done && (
        <div className="timeline__done">
          {done.stepCount} 步 · {(done.durationMs / 1000).toFixed(1)}s · {done.timedOut ? "超时收尾" : done.done ? "正常完成" : "异常"}
        </div>
      )}
      {error && <div className="timeline__err">⚠ {error}</div>}
    </div>
  );
}
