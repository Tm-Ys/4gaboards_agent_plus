import { useEffect, useState } from "react";
import { useCatalog } from "../store/useCatalog";
import { useGenerate } from "../store/useGenerate";
import { ScenarioCard } from "./ScenarioCard";

export function ScenarioList() {
  const scenarios = useCatalog((s) => s.scenarios);
  const sets = useCatalog((s) => s.sets);
  const set = useCatalog((s) => s.set);
  const loading = useCatalog((s) => s.loading);
  const error = useCatalog((s) => s.error);
  const load = useCatalog((s) => s.load);
  const selectedId = useCatalog((s) => s.selectedId);
  const select = useCatalog((s) => s.select);
  const gen = useGenerate();
  const [q, setQ] = useState("");

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (gen.status === "done") void load();
  }, [gen.status, load]);

  const list = scenarios?.scenarios ?? [];
  const filtered = q
    ? list.filter((s) => (s.id + s.title + s.feature_id).toLowerCase().includes(q.toLowerCase()))
    : list;

  return (
    <div className="scen-list">
      <div className="scen-gen">
        <button
          className="btn btn--sm"
          disabled={gen.status === "running"}
          onClick={() => void gen.regenerate()}
          title="重新跑 extract + scenarios，覆盖当前场景集（约 5-10 分钟）"
        >
          {gen.status === "running" ? "生成中…" : "↻ 重新生成场景"}
        </button>
        {gen.status === "running" && gen.logs.length > 0 && (
          <span className="scen-gen__cur">{gen.logs[gen.logs.length - 1]?.line.slice(0, 60)}</span>
        )}
        {gen.status === "error" && <span className="scen-gen__err">⚠ {gen.error}</span>}
      </div>
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
