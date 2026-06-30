import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "../store/useCatalog";
import { useSelection } from "../store/useSelection";
import { ScenarioCard } from "./ScenarioCard";

// 任务一：测试链目录（默认折叠）。
// 三层结构：
// 1. Baseline 基线链（只读展示 8 步，执行入口在任务二）
// 2. 16 条模块链（按 module 分组，点击标题选中该链喂给任务二；可展开预览拓扑序功能点）
// 3. 「展开全部 179 场景」兜底（默认藏，排查具体场景时用）
export function ScenarioList() {
  const features = useCatalog((s) => s.features);
  const scenarios = useCatalog((s) => s.scenarios);
  const sets = useCatalog((s) => s.sets);
  const set = useCatalog((s) => s.set);
  const loading = useCatalog((s) => s.loading);
  const error = useCatalog((s) => s.error);
  const load = useCatalog((s) => s.load);
  const selectedId = useCatalog((s) => s.selectedId);
  const select = useCatalog((s) => s.select);
  const selectedModule = useSelection((s) => s.selectedModule);
  const setModule = useSelection((s) => s.setModule);

  const [expandedChain, setExpandedChain] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const fps = features?.feature_points ?? [];
  const all = scenarios?.scenarios ?? [];

  // 按 module 分组：module → 该模块的功能点（保持 features.json 顺序）
  const modules = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const f of fps) {
      if (!seen.has(f.module)) {
        seen.add(f.module);
        ordered.push(f.module);
      }
    }
    return ordered;
  }, [fps]);

  // 每个模块的功能点 + 场景数
  const chainOf = (module: string) => fps.filter((f) => f.module === module);
  const scenarioCountOf = (module: string) => {
    const ids = new Set(chainOf(module).map((f) => f.id));
    return all.filter((s) => ids.has(s.feature_id)).length;
  };
  const scenariosOf = (module: string) => {
    const ids = new Set(chainOf(module).map((f) => f.id));
    return all.filter((s) => ids.has(s.feature_id));
  };

  // Baseline 8 步（硬编码摘要，匹配后端 baseline.json）
  const baselineSteps = [
    "P0 登录",
    "P1 创建项目",
    "P1 创建看板",
    "P1 创建列表 A",
    "P1 创建列表 B",
    "P1 建卡片 1",
    "P1 建卡片 2",
    "P1 建卡片 3",
  ];

  return (
    <div className="chain-dir">
      <div className="scen-list__ctrl">
        <select value={set} onChange={(e) => void load(e.target.value)} className="select">
          {sets.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="scen-list__meta">{loading ? "加载中…" : error ? error : `${modules.length} 条模块链 · ${all.length} 场景`}</div>

      <div className="chain-dir__items">
        {/* Baseline 基线链（只读展示，执行在任务二） */}
        <div className="chain">
          <div
            className="chain__head chain__head--baseline"
            onClick={() => setExpandedChain(expandedChain === "__baseline__" ? null : "__baseline__")}
          >
            <span className="chain__toggle">{expandedChain === "__baseline__" ? "▾" : "▸"}</span>
            <span className="chain__icon">📋</span>
            <span className="chain__name">Baseline 基线链</span>
            <span className="chain__cnt">8 步</span>
          </div>
          {expandedChain === "__baseline__" && (
            <div className="chain__body">
              {baselineSteps.map((s, i) => (
                <div key={i} className="chain__step">{s}</div>
              ))}
              <div className="chain__hint">只读展示 · 去任务二点「执行基准」</div>
            </div>
          )}
        </div>

        {/* 16 条模块链 */}
        {modules.map((m) => {
          const cnt = scenarioCountOf(m);
          const isSelected = selectedModule === m;
          const isExpanded = expandedChain === m;
          return (
            <div key={m} className={"chain" + (isSelected ? " is-sel" : "")}>
              <div className="chain__head">
                <span
                  className="chain__toggle"
                  onClick={() => setExpandedChain(isExpanded ? null : m)}
                >
                  {isExpanded ? "▾" : "▸"}
                </span>
                <span className="chain__icon">🔗</span>
                <button
                  className={"chain__name-btn" + (isSelected ? " is-sel" : "")}
                  onClick={() => setModule(isSelected ? null : m)}
                  title={`选中「${m} 链」去任务二执行`}
                >
                  {m} 链
                </button>
                <span className="chain__cnt">{cnt} 场景</span>
              </div>
              {isExpanded && (
                <div className="chain__body">
                  {chainOf(m).length === 0 ? (
                    <div className="chain__hint">无功能点</div>
                  ) : (
                    <>
                      <div className="chain__feat-order">
                        {chainOf(m).map((f, i) => (
                          <span key={f.id} className="chain__feat">
                            {i > 0 && <span className="chain__arrow"> → </span>}
                            {f.id}
                          </span>
                        ))}
                      </div>
                      <div className="chain__scen-list">
                        {scenariosOf(m).map((s) => (
                          <ScenarioCard
                            key={s.id}
                            s={s}
                            selected={s.id === selectedId}
                            onSelect={() => select(s.id)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 兜底：展开全部 179 场景 */}
      <button className="chain-dir__all-toggle" onClick={() => setShowAll((v) => !v)}>
        {showAll ? "▴ 收起全部场景" : `▾ 展开全部 ${all.length} 场景`}
      </button>
      {showAll && <FlatList scenarios={all} selectedId={selectedId} onSelect={select} />}
    </div>
  );
}

function FlatList({
  scenarios,
  selectedId,
  onSelect,
}: {
  scenarios: { id: string; title: string; feature_id: string; tags: string[]; difficulty: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = q
    ? scenarios.filter((s) => (s.id + s.title + s.feature_id).toLowerCase().includes(q.toLowerCase()))
    : scenarios;
  return (
    <div className="chain-dir__flat">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 id/标题…" className="input" />
      <div className="scen-list__items">
        {filtered.map((s) => (
          <ScenarioCard
            key={s.id}
            s={s as never}
            selected={s.id === selectedId}
            onSelect={() => onSelect(s.id)}
          />
        ))}
      </div>
      <div className="scen-list__meta">{filtered.length}/{scenarios.length} 场景</div>
    </div>
  );
}
