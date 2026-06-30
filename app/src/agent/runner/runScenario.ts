// 单场景执行 harness：登录(前置) → ReAct 循环 → 结果 → 关闭。
// 登录作为前置由 runner 完成（符合"API/UI 仅作前置"的底线），循环开始时已登录。

import { BrowserSession } from "../browser/context";
import { registry, type ToolContext } from "../tools/registry";
import "../tools/browser"; // 注册 B 层
import "../tools/domain"; // 注册 A 层
import { runReactLoop } from "../react/loop";
import { judgeScenario, type Verdict } from "../verify/judge";
import { DependencyGraph } from "../dependencyGraph";
import {
  BASELINE_P1_FEATURE_IDS,
  loadBaseline,
  runBaseline,
  type BaselineConfig,
} from "./runBaseline";
import type { FeaturePoint, TestScenario } from "../../schemas";
import type { ReActRunResult, ReActStep } from "../react/types";

export interface ScenarioRunResult extends ReActRunResult {
  scenarioId: string;
  scenarioTitle: string;
  featureId: string;
  startedAt: string;
  durationMs: number;
  stepCount: number;
  /** 独立判官结论（PASS/FAIL + 原因）。actor 自评见 likelySuccess / doneSummary。 */
  verdict: Verdict;
}

export interface RunScenarioOptions {
  headless?: boolean;
  maxSteps?: number;
  /** 场景执行后、session 关闭前的账号 state 恢复钩子（批量隔离 language 等 server-side 偏好用）。 */
  cleanup?: (ctx: ToolContext) => Promise<void>;
  /** 批量命名空间：board/card 创建加前缀，便于批尾清理与并发隔离。 */
  namespace?: string;
  /** 每步回调（透传给 runReactLoop，前端实时轨迹用）。 */
  onStep?: (step: ReActStep) => void;
  // ↓↓↓ Task1/Task2 增强（乙层） ↓↓↓
  /** 自动处理前置：登录后先跑基线，再跑目标场景的传递前置链（独立 CLI 入口用）。默认 false，保持原行为。 */
  autoSetup?: boolean;
  /** 依赖图实例（autoSetup 时计算传递前置）。 */
  depGraph?: DependencyGraph;
  /** 基线配置（autoSetup 时跑基线 P1）。未传则从场景集 baseline.json 读取。 */
  baseline?: BaselineConfig;
  /** 解析前置链所需的全量场景（按 feature_id 查找 happy_path）。 */
  scenarioLookup?: TestScenario[];
}

/**
 * autoSetup 的前置链：跑完基线后，目标场景仍可能依赖 baseline 未覆盖的功能点
 * （如 card_move 依赖 view_switch）。对每个这样的前置 feature，跑它的 happy_path 场景（只执行不 judge）。
 */
async function autoSetupPrerequisites(
  ctx: ToolContext,
  scenario: TestScenario,
  opts: RunScenarioOptions,
): Promise<void> {
  if (!opts.depGraph || !opts.scenarioLookup) return;
  const maxSteps = opts.maxSteps ?? 20;

  // 传递前置，拓扑序；过滤掉已被 baseline 覆盖的 create 类，避免重复建资源。
  const transitive = opts.depGraph.getTransitivePrerequisites(scenario.feature_id);
  const needed = transitive.filter((f) => !BASELINE_P1_FEATURE_IDS.has(f.id));
  if (needed.length === 0) return;

  for (const feature of needed) {
    const preScenario = pickHappyPath(opts.scenarioLookup!, feature.id);
    if (!preScenario) {
      // 无对应 happy_path 场景的前置（如纯导航类），跳过——基线已覆盖大部分结构性前置。
      continue;
    }
    const react = await runReactLoop(ctx, preScenario, { maxSteps });
    if (!react.likelySuccess) {
      throw new Error(`前置链失败：${feature.id}（${preScenario.id}）done=${react.done} timedOut=${react.timedOut}`);
    }
  }
}

/** 在场景集里找某 feature 的 happy_path（首选），否则取该 feature 的第一个场景。 */
function pickHappyPath(scenarios: TestScenario[], featureId: string): TestScenario | undefined {
  const ofFeat = scenarios.filter((s) => s.feature_id === featureId);
  return ofFeat.find((s) => s.tags.includes("happy_path")) ?? ofFeat[0];
}

export async function runScenario(
  scenario: TestScenario,
  opts: RunScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const session = await BrowserSession.launch({ headless: opts.headless ?? true });
  const ctx: ToolContext = { session, page: session.page, namespace: opts.namespace };
  try {
    // 前置：登录（场景.preconditions 默认含"已登录"）
    const login = await registry.execute("auth_login", {}, ctx);
    if (!login.ok) throw new Error(`登录失败：${login.summary}`);

    // autoSetup：登录后、目标场景前，确保基线就绪 + 跑传递前置链。
    // 仅在独立 CLI 入口（如 run-feature --auto-setup）启用；runChain 链式模式不复用本路径。
    if (opts.autoSetup) {
      const baseline = opts.baseline ?? loadBaseline();
      if (baseline) {
        const ns = opts.namespace ?? `baseline-${Date.now().toString(36)}`;
        if (!opts.namespace) ctx.namespace = ns;
        await runBaseline(ctx, baseline, { namespace: ns, scenarios: opts.scenarioLookup ?? [], maxSteps: opts.maxSteps });
      }
      await autoSetupPrerequisites(ctx, scenario, opts);
    }

    const react = await runReactLoop(ctx, scenario, { maxSteps: opts.maxSteps ?? 20, onStep: opts.onStep });
    // 独立判官：场景 + 轨迹（含每步观察）+ 最终观察
    const verdict = await judgeScenario(scenario, react);
    return {
      ...react,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      featureId: scenario.feature_id,
      startedAt,
      durationMs: Date.now() - t0,
      stepCount: react.steps.length,
      verdict,
    };
  } finally {
    // 批量隔离：场景执行后、关 session 前恢复账号级持久 state（如 language）。
    // 失败不影响本场景结果（仅记录），避免恢复异常污染通过率统计。
    if (opts.cleanup) {
      try {
        await opts.cleanup(ctx);
      } catch (e) {
        console.warn(`[cleanup] 账号 state 恢复失败（不影响场景结果）：${e instanceof Error ? e.message : e}`);
      }
    }
    await session.close();
  }
}
