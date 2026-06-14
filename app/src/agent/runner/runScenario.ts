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
}

export async function runScenario(
  scenario: TestScenario,
  opts: RunScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const session = await BrowserSession.launch({ headless: opts.headless ?? true });
  try {
    const ctx: ToolContext = { session, page: session.page };
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
    await session.close();
  }
}
