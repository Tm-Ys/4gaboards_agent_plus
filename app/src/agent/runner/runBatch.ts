// 批量执行 harness：顺序跑一批场景，各自独立 session，汇总判官结论为通过率报告。
// 顺序跑（共享 demo 账号，并行会互相踩数据）。单个场景失败/异常不中断整批。
// Task1/Task2 增强（乙层）：新增 --module 模式，同模块场景共享一个 session +
// 一次 baseline，按依赖拓扑序串成测试链（Layer2）。

import { BrowserSession } from "../browser/context";
import { registry, type ToolContext } from "../tools/registry";
import "../tools/browser"; // 注册 B 层
import "../tools/domain"; // 注册 A 层
import { runReactLoop } from "../react/loop";
import { judgeScenario } from "../verify/judge";
import { runScenario, type ScenarioRunResult } from "./runScenario";
import { resetAccountLanguage } from "./resetState";
import { cleanupTestProjects } from "./cleanup";
import { loadBaseline, runBaseline } from "./runBaseline";
import { DependencyGraph } from "../dependencyGraph";
import type { FeatureCatalog, TestScenario } from "../../schemas";
import type { ReActStep } from "../react/types";

export interface BatchOutcome {
  scenario: TestScenario;
  result?: ScenarioRunResult;
  error?: string;
}

export interface BatchSummary {
  total: number;
  pass: number;
  fail: number; // 判官 FAIL
  error: number; // 运行异常
  passRate: number; // 0..1（pass / 有判官结果的总数）
  byDifficulty: Record<string, { pass: number; total: number }>;
  byTag: Record<string, { pass: number; total: number }>;
  avgSteps: number;
  avgMs: number;
}

export interface BatchReport {
  startedAt: string;
  setName: string;
  filter: Record<string, unknown>;
  /** 本批命名空间（资源前缀 + 清理 + 并发隔离用）。 */
  namespace?: string;
  total: number;
  summary: BatchSummary;
  outcomes: BatchOutcome[];
}

export interface RunBatchOptions {
  maxSteps?: number;
  setName?: string;
  filter?: Record<string, unknown>;
  onProgress?: (index: number, total: number, o: BatchOutcome) => void;
  /** 每场景后恢复账号级 state（默认 true）。设 false 可复现无隔离的原批量行为。 */
  reset?: boolean;
  /** 批尾删除本批创建的测试 project（默认 true，按命名空间前缀）。 */
  cleanup?: boolean;
  /** 每步回调（带 scenarioId，前端全量测试实时轨迹用）。 */
  onStep?: (scenarioId: string, step: ReActStep) => void;
  // ↓↓↓ Task1/Task2 增强（乙层）：module 链式模式 ↓↓↓
  /** 模块链模式：指定 module 时，同模块场景共享一个 session + baseline，按依赖拓扑序成链。 */
  module?: string;
  /** 依赖图实例（module 模式按拓扑序排序场景）。 */
  depGraph?: DependencyGraph;
  /** 全量场景（module 模式用于按 feature 解析 happy_path）。 */
  scenarioLookup?: TestScenario[];
  /** feature 目录（module 模式按 module 字段分组）。 */
  features?: FeatureCatalog;
  /** 会话池：传入基准已建好的 ctx（含登录态 + baseline 资源），模块链复用同一页面状态，跳过 launch/登录/重建。 */
  pooledCtx?: ToolContext;
}

export async function runBatch(scenarios: TestScenario[], opts: RunBatchOptions = {}): Promise<BatchReport> {
  // module 链式模式：共享 session + 一次 baseline + 拓扑序场景。
  if (opts.module) {
    return runModuleChain(scenarios, opts);
  }
  const startedAt = new Date().toISOString();
  const outcomes: BatchOutcome[] = [];
  // 命名空间：本批资源加前缀、批尾按前缀清理、并发隔离用。
  const namespace = `p4-${Date.now().toString(36)}`;

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i]!;
    const o: BatchOutcome = { scenario: sc };
    try {
      const cleanup = opts.reset === false ? undefined : resetAccountLanguage;
      o.result = await runScenario(sc, {
        maxSteps: opts.maxSteps ?? 20,
        cleanup,
        namespace,
        onStep: opts.onStep ? (step) => opts.onStep!(sc.id, step) : undefined,
      });
    } catch (e) {
      o.error = e instanceof Error ? e.message : String(e);
    }
    outcomes.push(o);
    opts.onProgress?.(i + 1, scenarios.length, o);
  }

  // 批尾清理：删除本批创建的测试 project（级联删 board）。teardown 走 REST，非被测动作。
  if (opts.cleanup !== false) {
    try {
      const c = await cleanupTestProjects({ namespace });
      if (c.deleted > 0) console.log(`[cleanup] 删除 ${c.deleted} 个测试资源（board/project，namespace=${namespace}）`);
    } catch (e) {
      console.warn(`[cleanup] 清理失败（不影响通过率）：${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    startedAt,
    setName: opts.setName ?? "basic",
    filter: opts.filter ?? {},
    namespace,
    total: scenarios.length,
    summary: summarize(outcomes),
    outcomes,
  };
}

/**
 * 模块链式执行（Layer2）：一个 session + 一次 baseline，把同模块的全部场景按依赖拓扑序串成一条链。
 * 链上前一个场景的页面状态自然成为后一个场景的前置（baseline 已就绪，多数场景无需额外前置）。
 * 单个场景失败不中断整链（记录 error 继续下一个，便于定位链上首个断点）。
 */
async function runModuleChain(scenarios: TestScenario[], opts: RunBatchOptions): Promise<BatchReport> {
  const startedAt = new Date().toISOString();
  const maxSteps = opts.maxSteps ?? 20;
  const lookup = opts.scenarioLookup ?? scenarios;

  // 拓扑序：按 dependencyGraph 的模块顺序排列本批场景（同 feature 内按 happy_path 优先）。
  const ordered = orderScenariosByModule(scenarios, opts);

  const outcomes: BatchOutcome[] = [];
  // 复用池里的 session（基准已就绪）则直接用；否则自建 session + 登录 + 跑基线。
  const ownsSession = !opts.pooledCtx; // 自建的 session 需在本函数结束时关闭；复用的由调用方（会话池）管理。
  const namespace = opts.pooledCtx?.namespace ?? `mod-${Date.now().toString(36)}`;
  let ctx: ToolContext;
  if (opts.pooledCtx) {
    ctx = opts.pooledCtx;
    ctx.namespace = namespace;
  } else {
    const session = await BrowserSession.launch({ headless: true });
    ctx = { session, page: session.page, namespace };
  }
  try {
    if (ownsSession) {
      // P0：登录（整链共享一次登录态）。
      const login = await registry.execute("auth_login", {}, ctx);
      if (!login.ok) throw new Error(`登录失败：${login.summary}`);

      // 基线：让页面进入"看板+列表+卡片就绪"起点。失败则整链前置未就绪，但仍尝试跑场景以定位断点。
      const baseline = loadBaseline();
      if (baseline) {
        try {
          const br = await runBaseline(ctx, baseline, { namespace, scenarios: lookup, maxSteps });
          console.log(`[baseline] ${br.alreadyReady ? "页面已就绪，跳过 P1" : "P1 执行完毕"}`);
        } catch (e) {
          console.warn(`[baseline] 基线失败（继续跑链以定位断点）：${e instanceof Error ? e.message : e}`);
        }
      }
    }

    // 链：按拓扑序逐个跑场景（共享 session；前一个的页面状态即下一个的前置）。
    for (let i = 0; i < ordered.length; i++) {
      const sc = ordered[i]!;
      const o: BatchOutcome = { scenario: sc };
      try {
        const react = await runReactLoop(ctx, sc, { maxSteps });
        const verdict = await judgeScenario(sc, react);
        o.result = {
          ...react,
          scenarioId: sc.id,
          scenarioTitle: sc.title,
          featureId: sc.feature_id,
          startedAt,
          durationMs: 0,
          stepCount: react.steps.length,
          verdict,
        };
      } catch (e) {
        o.error = e instanceof Error ? e.message : String(e);
      }
      outcomes.push(o);
      opts.onProgress?.(i + 1, ordered.length, o);
    }
  } finally {
    // 自建 session 在此关闭；复用的池 session 由调用方（会话池）管理，不在此关。
    if (ownsSession) await ctx.session.close();
  }

  // 批尾清理（按 namespace 前缀删本链资源）。
  // 仅自建 session 时清理（删的是链自己建的资源）；复用池 session 时不删——基准资源可能被复用，
  // 且会话池的 closeSession 负责关闭 session，资源清理交由基准生命周期。
  if (ownsSession && opts.cleanup !== false) {
    try {
      const c = await cleanupTestProjects({ namespace });
      if (c.deleted > 0) console.log(`[cleanup] 删除 ${c.deleted} 个测试资源（namespace=${namespace}）`);
    } catch (e) {
      console.warn(`[cleanup] 清理失败（不影响通过率）：${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    startedAt,
    setName: opts.setName ?? "basic",
    filter: { ...opts.filter, module: opts.module },
    namespace,
    total: ordered.length,
    summary: summarize(outcomes),
    outcomes,
  };
}

/** 模块链排序：按依赖图的拓扑顺序排列，happy_path 优先于变体。 */
function orderScenariosByModule(scenarios: TestScenario[], opts: RunBatchOptions): TestScenario[] {
  if (!opts.depGraph) return scenarios;
  // 取本模块 feature 的拓扑序，建立 feature -> 序号 索引。
  const moduleFeatures = opts.features?.feature_points.filter((f) => f.module === opts.module) ?? [];
  const orderedFeatures = opts.depGraph.getByModule(opts.module ?? "");
  const orderOf: Record<string, number> = {};
  orderedFeatures.forEach((f, idx) => (orderOf[f.id] = idx));
  moduleFeatures.forEach((f) => {
    if (!(f.id in orderOf)) orderOf[f.id] = orderedFeatures.length;
  });
  const happyRank = (s: TestScenario): number => (s.tags.includes("happy_path") ? 0 : 1);
  return [...scenarios].sort((a, b) => {
    const fa = orderOf[a.feature_id] ?? 999;
    const fb = orderOf[b.feature_id] ?? 999;
    if (fa !== fb) return fa - fb;
    return happyRank(a) - happyRank(b);
  });
}

function bump(bucket: Record<string, { pass: number; total: number }>, key: string, pass: boolean) {
  const b = (bucket[key] ??= { pass: 0, total: 0 });
  b.total++;
  if (pass) b.pass++;
}

function summarize(outcomes: BatchOutcome[]): BatchSummary {
  const judged = outcomes.filter((o) => o.result);
  const total = outcomes.length;
  let pass = 0;
  let stepsSum = 0;
  let msSum = 0;
  const byDifficulty: Record<string, { pass: number; total: number }> = {};
  const byTag: Record<string, { pass: number; total: number }> = {};

  for (const o of judged) {
    const ok = o.result!.verdict.pass;
    if (ok) pass++;
    stepsSum += o.result!.stepCount;
    msSum += o.result!.durationMs;
    bump(byDifficulty, o.scenario.difficulty, ok);
    for (const t of o.scenario.tags) bump(byTag, t, ok);
  }

  return {
    total,
    pass,
    fail: judged.filter((o) => !o.result!.verdict.pass).length,
    error: outcomes.length - judged.length,
    passRate: judged.length ? pass / judged.length : 0,
    byDifficulty,
    byTag,
    avgSteps: judged.length ? Math.round(stepsSum / judged.length) : 0,
    avgMs: judged.length ? Math.round(msSum / judged.length) : 0,
  };
}
