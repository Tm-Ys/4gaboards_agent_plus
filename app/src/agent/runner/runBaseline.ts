// 全局基线执行（Task1/Task2 增强·乙层）。
// 在一个已建立的 browser session 内，把页面推进到"看板 + 多个列表 + 多张卡片就绪"的稳定测试起点。
//
// 设计要点（详见 todo 第七节 7.2）：
// - P0（auth_login）不可逆，整个 session 只跑一次。本函数假定调用方已完成登录
//   （runScenario 在调用前已 execute("auth_login")）；独立 CLI 调用时可传 skipLogin:false 自行登录。
// - P1 可重跑：先做 DOM pre-check，若页面已有本 namespace 前缀的资源即视为就绪跳过；
//   否则先用 REST 清理旧基线资源（cleanupTestProjects），再按 baseline.json 顺序逐个执行 P1 场景。
// - P1 场景的 step.params（listName/boardName 等）通过注入 precondition 的方式交给 ReAct 循环
//   （runReactLoop 无 params 槽、buildSystemPrompt 只读 scenario，故走 precondition 通道）。
// - 基线只"执行"不做 judge：以 runReactLoop 的 likelySuccess 判定每步成败。
//
// 本模块不创建/关闭 session——session 生命周期由调用方（runScenario / runModuleChain）管理，
// 以便基线与后续目标场景共享同一页面状态。

import fs from "node:fs";
import path from "node:path";
import { settings } from "../../config";
import { registry, type ToolContext } from "../tools/registry";
import { runReactLoop } from "../react/loop";
import { cleanupTestProjects } from "./cleanup";
import type { TestScenario } from "../../schemas";

/** baseline.json 中 P0 条目：执行一个领域工具（目前仅 auth_login）。 */
export interface BaselineP0Step {
  tool_name: string;
  purpose: string;
}

/** baseline.json 中 P1 条目：引用 scenarios.json 中已有的 happy_path 场景，可带命名参数。 */
export interface BaselineP1Step {
  scenario_id: string;
  feature_id: string;
  purpose: string;
  params?: Record<string, string>;
  /** true 表示该步创建的资源应加 namespace 前缀（由 domain 工具的 namespaced() 自动处理）。 */
  namespace?: boolean;
}

export interface BaselineConfig {
  description?: string;
  p0: BaselineP0Step[];
  p1: BaselineP1Step[];
}

/** 基线就绪后已覆盖的 feature id——autoSetup 的前置链应跳过这些（避免重复建资源）。 */
export const BASELINE_P1_FEATURE_IDS = new Set([
  "project-create",
  "board-create",
  "list-create",
  "card-create",
]);

export interface BaselineStepOutcome {
  purpose: string;
  ok: boolean;
  summary: string;
}

export interface BaselineResult {
  /** DOM pre-check 命中：页面已有基线资源，整段 P1 被跳过。 */
  alreadyReady: boolean;
  /** P1 完整执行完毕。 */
  completed: boolean;
  steps: BaselineStepOutcome[];
}

export interface RunBaselineOptions {
  namespace: string;
  /** 用于解析 P1 条目的 scenario_id。 */
  scenarios: TestScenario[];
  maxSteps?: number;
  /** 调用方已完成 P0 登录则传 true（默认），跳过 p0 执行。 */
  skipLogin?: boolean;
  /** 每个 P1 步骤完成后的回调（含 purpose/ok/summary）；前端实时进度用。 */
  onProgress?: (outcome: BaselineStepOutcome) => void;
}

/** 读取某场景集的 baseline.json（甲层产出的基线引用序列）。缺失返回 null。 */
export function loadBaseline(setName: string = "basic"): BaselineConfig | null {
  const p = path.join(settings.outputsDir, setName, "baseline.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as BaselineConfig;
}

/**
 * DOM pre-check：页面是否已含本 namespace 前缀的资源。
 * 基线创建的所有资源名都带 `${namespace}-` 前缀（domain 工具 namespaced()），故只要页面上
 * 出现该前缀文本即可判定基线已就绪。用容错定位器 + 短超时，不依赖具体 class 名。
 */
export async function checkBaselineReady(page: import("playwright").Page, namespace: string): Promise<boolean> {
  try {
    // 转义 regex 特殊字符；前缀形如 p4-xxxx-，匹配其字面量。
    const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await page.locator(`text=/${escaped}-/`).first().waitFor({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 把 step.params 注入一个克隆场景的 preconditions，让 ReAct 循环读到指定命名。
 * 不改原场景；返回浅拷贝（preconditions 新数组）。
 */
function withParams(scenario: TestScenario, params?: Record<string, string>): TestScenario {
  if (!params || Object.keys(params).length === 0) return scenario;
  const hint = `本次执行使用以下指定命名参数，请严格使用这些名称创建资源（不要自行改名）：${JSON.stringify(params)}`;
  return { ...scenario, preconditions: [...scenario.preconditions, hint] };
}

/**
 * 执行 P0 + P1 基线。session 由调用方持有，本函数不关闭它。
 */
export async function runBaseline(
  ctx: ToolContext,
  config: BaselineConfig,
  opts: RunBaselineOptions,
): Promise<BaselineResult> {
  const steps: BaselineStepOutcome[] = [];
  const maxSteps = opts.maxSteps ?? 20;

  // P0：登录（不可逆，整个 session 一次）。调用方通常已完成，skipLogin 默认 true。
  if (opts.skipLogin !== false) {
    for (const step of config.p0) {
      const r = await registry.execute(step.tool_name, {}, ctx);
      steps.push({ purpose: step.purpose, ok: r.ok, summary: r.summary });
      if (!r.ok) throw new Error(`基线 P0 失败（${step.tool_name}）：${r.summary}`);
    }
  }

  // P1 pre-check：页面已就绪则跳过整段创建。
  const ready = await checkBaselineReady(ctx.page, opts.namespace);
  if (ready) {
    return { alreadyReady: true, completed: false, steps };
  }

  // 页面被污染：先清理旧基线资源（按 namespace 前缀删 project/board，REST teardown）。
  try {
    await cleanupTestProjects({ namespace: opts.namespace });
  } catch (e) {
    // 清理失败不致命——可能本就没旧资源；记录后继续重建。
    console.warn(`[baseline] 清理旧资源失败（继续重建）：${e instanceof Error ? e.message : e}`);
  }

  // P1：按顺序执行每个引用场景（只执行，不 judge）。
  for (const step of config.p1) {
    const scenario = opts.scenarios.find((s) => s.id === step.scenario_id);
    if (!scenario) {
      throw new Error(`基线 P1 引用了不存在的场景 id：${step.scenario_id}`);
    }
    const target = withParams(scenario, step.params);
    const react = await runReactLoop(ctx, target, { maxSteps });
    const ok = react.likelySuccess;
    const outcome: BaselineStepOutcome = {
      purpose: step.purpose,
      ok,
      summary: ok
        ? (react.doneSummary ?? `P1 完成：${step.purpose}`)
        : `P1 未成功：${step.purpose}（done=${react.done}, timedOut=${react.timedOut}）`,
    };
    steps.push(outcome);
    opts.onProgress?.(outcome);
    if (!ok) throw new Error(`基线 P1 失败：${step.purpose}`);
  }

  return { alreadyReady: false, completed: true, steps };
}
