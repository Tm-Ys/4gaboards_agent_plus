import type { TestScenario } from "../types";

export function ScenarioCard({
  s,
  selected,
  onSelect,
}: {
  s: TestScenario;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={"scen-card" + (selected ? " is-sel" : "")} onClick={onSelect}>
      <div className="scen-card__head">
        <span className="scen-card__id">{s.id}</span>
        <span className={"badge badge--" + s.difficulty}>{s.difficulty}</span>
      </div>
      <div className="scen-card__title">{s.title}</div>
      <div className="scen-card__tags">
        <span className="tag tag--feature">{s.feature_id}</span>
        {s.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}
