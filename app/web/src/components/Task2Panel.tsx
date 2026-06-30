import { useCatalog } from "../store/useCatalog";
import { useBaseline } from "../store/useBaseline";
import { useBatch } from "../store/useBatch";
import { useSelection } from "../store/useSelection";
import { TraceStepView } from "./TraceStepView";

// 任务二：执行器。读任务一选中的链。
// 流程（手动，不自动跑 baseline）：
// 1. 手动点「执行基准」→ 跑 P0+P1，成功后页面进入稳定起点，session 入池凭 token 复用。
// 2. 「执行选中链」按钮在基准未成功前禁用（灰 + 提示"先执行基准"）。
// 3. 基准成功 + 已选链 → 点「执行选中链」，在同一 session 上跑该模块的拓扑序场景链。
export function Task2Panel() {
  const features = useCatalog((s) => s.features);
  const scenarios = useCatalog((s) => s.scenarios);
  const selectedModule = useSelection((s) => s.selectedModule);

  const bs = useBaseline();
  const batchStatus = useBatch((s) => s.status);
  const batchIndex = useBatch((s) => s.index);
  const batchTotal = useBatch((s) => s.total);
  const batchCurrent = useBatch((s) => s.currentScenario);
  const batchSteps = useBatch((s) => s.currentSteps);
  const batchOutcomes = useBatch((s) => s.outcomes);
  const batchResult = useBatch((s) => s.result);
  const batchError = useBatch((s) => s.error);
  const runBatch = useBatch((s) => s.run);
  const resetBatch = useBatch((s) => s.reset);

  const baselineReady = bs.status === "done" && bs.token !== null;
  const running = bs.status === "running" || batchStatus === "running";

  // 选中链的场景数
  const selectedChainCount = (() => {
    if (!selectedModule) return 0;
    const ids = new Set(
      (features?.feature_points ?? []).filter((f) => f.module === selectedModule).map((f) => f.id),
    );
    return (scenarios?.scenarios ?? []).filter((s) => ids.has(s.feature_id)).length;
  })();

  // 执行选中链：收集该模块全部场景 id，用基准 token 复用 session。
  const runSelectedChain = () => {
    if (!selectedModule || !baselineReady) return;
    const fps = new Set(
      (features?.feature_points ?? []).filter((f) => f.module === selectedModule).map((f) => f.id),
    );
    const ids = (scenarios?.scenarios ?? []).filter((s) => fps.has(s.feature_id)).map((s) => s.id);
    if (ids.length === 0) return;
    void runBatch(ids, { module: selectedModule, sessionToken: bs.token ?? undefined });
  };

  return (
    <div className="task2">
      <div className="task2__warn">⚠ 会真改 demo 站数据（namespace 隔离、跑完清理）</div>

      {/* 第一步：执行基准（手动） */}
      <div className="task2__baseline">
        <button
          className={"btn btn--run" + (bs.status === "running" ? " is-running" : "")}
          disabled={running}
          onClick={() => void bs.run()}
          title="开浏览器 → 登录 → 建项目/看板/列表/卡片，进入稳定测试起点"
        >
          {bs.status === "running" ? "基准执行中…" : "▶ 执行基准"}
        </button>
        {bs.status !== "idle" && bs.status !== "running" && (
          <button className="btn btn--sm" onClick={bs.reset} disabled={running}>
            清空
          </button>
        )}
      </div>

      {/* 基准 P1 每步进度 */}
      {bs.steps.length > 0 && (
        <div className="task2__bs-steps">
          {bs.steps.map((s, i) => (
            <div key={i} className={"outcome " + (s.ok ? "is-ok" : "is-bad")}>
              <span className="outcome__mark">{s.ok ? "✓" : "✗"}</span>
              <span className="outcome__id">{s.purpose}</span>
            </div>
          ))}
        </div>
      )}
      {bs.summary && <div className="task2__bs-done">✓ {bs.summary}</div>}
      {bs.error && <div className="timeline__err">⚠ {bs.error}</div>}

      {/* 第二步：执行选中链（基准就绪 + 已选链 才可点） */}
      <div className="task2__chain-launch">
        <div className="task2__chain-sel">
          {selectedModule ? (
            <>已选：<b>{selectedModule} 链</b>（{selectedChainCount} 场景）</>
          ) : (
            <>← 先在任务一选一条模块链</>
          )}
        </div>
        <button
          className={"btn btn--run" + (batchStatus === "running" ? " is-running" : "")}
          disabled={running || !baselineReady || !selectedModule}
          onClick={runSelectedChain}
          title={
            !baselineReady
              ? "请先执行基准"
              : !selectedModule
                ? "请先在任务一选一条链"
                : "在同一 session 上跑该模块的拓扑序场景链"
          }
        >
          {batchStatus === "running" ? "链路执行中…" : "▶ 执行选中链"}
        </button>
        {!baselineReady && selectedModule && (
          <div className="task2__chain-hint">⚠ 基准未就绪，请先点「执行基准」</div>
        )}
      </div>

      {/* 模块链执行进度 / 错误（error 时也显示，避免 UI 闪退回未执行） */}
      {(batchStatus === "running" || batchStatus === "error" || batchResult || batchOutcomes.length > 0) && (
        <div className="task2__chain">
          {(batchStatus === "running" || batchResult) && (
            <div className="bar">
              <div className="bar__label">{batchResult ? "完成" : "链路进度"}</div>
              <div className="bar__track">
                <div
                  className="bar__fill"
                  style={{ width: `${batchTotal ? (batchIndex / batchTotal) * 100 : 0}%` }}
                />
              </div>
              <div className="bar__num">
                {batchIndex}/{batchTotal}
                {batchResult ? `（PASS ${(batchResult.passRate * 100).toFixed(0)}%）` : ""}
              </div>
            </div>
          )}
          {batchCurrent && (
            <div className="batch-run__cur">
              <div className="batch-run__cur-id">▶ {batchCurrent}</div>
              {batchSteps.map((s) => (
                <TraceStepView key={s.step} step={s} />
              ))}
            </div>
          )}
          {batchOutcomes.length > 0 && (
            <div className="batch__outcomes">
              {batchOutcomes.map((o, i) => (
                <div
                  key={i}
                  className={"outcome " + (o.error ? "is-err" : o.pass ? "is-ok" : "is-bad")}
                >
                  <span className="outcome__mark">{o.error ? "⚠" : o.pass ? "✓" : "✗"}</span>
                  <span className="outcome__id">{o.scenarioId}</span>
                </div>
              ))}
            </div>
          )}
          {batchStatus !== "idle" && (
            <button className="btn btn--sm" onClick={resetBatch} disabled={running}>
              清空链结果
            </button>
          )}
          {batchError && (
            <div className="timeline__err">
              ⚠ {batchError}
              {/session|expired|410|token/i.test(batchError) && (
                <div className="task2__chain-hint">基准会话已过期（后端重启或超时）。请重新点「执行基准」再跑链。</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
