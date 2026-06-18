import { useEffect, useState } from "react";
import { useCatalog } from "../store/useCatalog";
import { ScenarioCard } from "./ScenarioCard";

export function ScenarioList() {
  const { scenarios, sets, set, loading, error, load, selectedId, select } = useCatalog();
  const [q, setQ] = useState("");
  useEffect(() => {
    void load();
  }, [load]);

  const list = scenarios?.scenarios ?? [];
  const filtered = q
    ? list.filter((s) => (s.id + s.title + s.feature_id).toLowerCase().includes(q.toLowerCase()))
    : list;

  return (
    <div className="scen-list">
      <div className="scen-list__ctrl">
        <select value={set} onChange={(e) => void load(e.target.value)} className="select">
          {sets.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 id/标题…" className="input" />
      </div>
      <div className="scen-list__meta">
        {loading ? "加载中…" : error ? error : `${filtered.length}/${list.length} 场景`}
      </div>
      <div className="scen-list__items">
        {filtered.map((s) => (
          <ScenarioCard key={s.id} s={s} selected={s.id === selectedId} onSelect={() => select(s.id)} />
        ))}
      </div>
    </div>
  );
}
