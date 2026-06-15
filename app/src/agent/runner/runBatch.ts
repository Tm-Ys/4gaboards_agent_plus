// 批量执行 harness：顺序跑一批场景，各自独立 session，汇总判官结论为通过率报告。
// 顺序跑（共享 demo 账号，并行会互相踩数据）。单个场景失败/异常不中断整批。

import { runScenario, type ScenarioRunResult } from "./runScenario";
import { resetAccountLanguage } from "./resetState";
import type { TestScenario } from "../../schemas";

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
}

export async function runBatch(scenarios: TestScenario[], opts: RunBatchOptions = {}): Promise<BatchReport> {
  const startedAt = new Date().toISOString();
  const outcomes: BatchOutcome[] = [];

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i]!;
    const o: BatchOutcome = { scenario: sc };
    try {
      const cleanup = opts.reset === false ? undefined : resetAccountLanguage;
      o.result = await runScenario(sc, { maxSteps: opts.maxSteps ?? 20, cleanup });
    } catch (e) {
      o.error = e instanceof Error ? e.message : String(e);
    }
    outcomes.push(o);
    opts.onProgress?.(i + 1, scenarios.length, o);
  }

  return {
    startedAt,
    setName: opts.setName ?? "basic",
    filter: opts.filter ?? {},
    total: scenarios.length,
    summary: summarize(outcomes),
    outcomes,
  };
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
