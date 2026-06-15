// 单场景执行 harness：登录(前置) → ReAct 循环 → 结果 → 关闭。
// 登录作为前置由 runner 完成（符合"API/UI 仅作前置"的底线），循环开始时已登录。

import { BrowserSession } from "../browser/context";
import { registry, type ToolContext } from "../tools/registry";
import "../tools/browser"; // 注册 B 层
import "../tools/domain"; // 注册 A 层
import { runReactLoop } from "../react/loop";
import { judgeScenario, type Verdict } from "../verify/judge";
import type { TestScenario } from "../../schemas";
import type { ReActRunResult } from "../react/types";

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
}

export async function runScenario(
  scenario: TestScenario,
  opts: RunScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const session = await BrowserSession.launch({ headless: opts.headless ?? true });
  const ctx: ToolContext = { session, page: session.page };
  try {
    // 前置：登录（场景.preconditions 默认含"已登录"）
    const login = await registry.execute("auth_login", {}, ctx);
    if (!login.ok) throw new Error(`登录失败：${login.summary}`);

    const react = await runReactLoop(ctx, scenario, { maxSteps: opts.maxSteps ?? 20 });
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
