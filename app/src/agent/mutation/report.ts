// Mutation Score 聚合（Layer1 / Layer2 共用）。
// 主指标 = must-kill 得分（判官对「与实现矛盾」的检出率，存活即真漏检）。
// 次指标 = soft 得分（描述性漂移敏感度，低不一定缺陷——判官本就刻意宽松）。
//
// 通用化：两类变异都归一成 ScoredItem（category/operatorId/description/detail/killed），
// detail 在 Layer1=期望差异、Layer2=故障摘要。

import type { ScenarioMutationReport } from "./runMutation";

export interface BucketScore {
  total: number;
  killed: number;
  survived: number;
  score: number; // killed / total（total=0 时为 0）
}

/** 归一化的单条变异结果（Layer1=期望变异体；Layer2=trace 故障）。 */
export interface ScoredItem {
  /** 变异体/故障 id */
  id: string;
  category: string; // must-kill / soft
  operatorId: string; // negate / entity-swap / exec-failure / ...
  description: string;
  /** Layer1=期望差异；Layer2=故障摘要（供人工核验） */
  detail: string;
  killed: boolean;
  reason: string; // 判官理由
}

/** 归一化的单场景结果。skipped=true（基线未 PASS/异常）时 items 为空。 */
export interface ScoredScenario {
  scenarioId: string;
  featureId: string;
  skipped: boolean;
  items: ScoredItem[];
}

export interface MutationSummary {
  layer: "spec" | "trace";
  scenariosTotal: number;
  scenariosMutated: number; // 基线 PASS 且产出了变异体/故障
  scenariosSkipped: number; // 基线 FAIL/异常
  overall: BucketScore;
  byCategory: Record<string, BucketScore>; // must-kill / soft
  byOperator: Record<string, BucketScore>;
  byModule: Record<string, BucketScore>; // feature_id 首段
  /** 存活（判官漏检），供人工核验：真漏检 vs 等价变异 */
  survived: SurvivedEntry[];
}

export interface SurvivedEntry {
  scenarioId: string;
  id: string;
  operatorId: string;
  category: string;
  description: string;
  detail: string;
  reason: string;
}

function emptyBucket(): BucketScore {
  return { total: 0, killed: 0, survived: 0, score: 0 };
}

function bump(b: BucketScore, killed: boolean): void {
  b.total++;
  if (killed) b.killed++;
  else b.survived++;
  b.score = b.total ? b.killed / b.total : 0;
}

function moduleOf(featureId: string): string {
  return featureId.split("-")[0] ?? "unknown";
}

/** 通用打分：接收归一化的 ScoredScene[]。Layer1/Layer2 共用。 */
export function summarizeScored(layer: "spec" | "trace", scenarios: ScoredScenario[]): MutationSummary {
  const overall = emptyBucket();
  const byCategory: Record<string, BucketScore> = {};
  const byOperator: Record<string, BucketScore> = {};
  const byModule: Record<string, BucketScore> = {};
  const survived: SurvivedEntry[] = [];
  let scenariosMutated = 0;
  let scenariosSkipped = 0;

  for (const sc of scenarios) {
    if (sc.skipped || sc.items.length === 0) {
      scenariosSkipped++;
      continue;
    }
    scenariosMutated++;
    const mod = moduleOf(sc.featureId);
    for (const it of sc.items) {
      bump(overall, it.killed);
      bump((byCategory[it.category] ??= emptyBucket()), it.killed);
      bump((byOperator[it.operatorId] ??= emptyBucket()), it.killed);
      bump((byModule[mod] ??= emptyBucket()), it.killed);
      if (!it.killed) {
        survived.push({
          scenarioId: sc.scenarioId,
          id: it.id,
          operatorId: it.operatorId,
          category: it.category,
          description: it.description,
          detail: it.detail,
          reason: it.reason,
        });
      }
    }
  }

  return {
    layer,
    scenariosTotal: scenarios.length,
    scenariosMutated,
    scenariosSkipped,
    overall,
    byCategory,
    byOperator,
    byModule,
    survived,
  };
}

/** Layer1 适配：把 ScenarioMutationReport[] 映射成 ScoredScene[] 再打分。 */
export function summarizeMutation(reports: ScenarioMutationReport[]): MutationSummary {
  const scenarios: ScoredScenario[] = reports.map((r) => ({
    scenarioId: r.scenarioId,
    featureId: r.featureId,
    skipped: r.skipped,
    items: r.results.map((mr) => ({
      id: mr.mutant.id,
      category: mr.mutant.category,
      operatorId: mr.mutant.operatorId,
      description: mr.mutant.description,
      detail: `原：${expText(mr.mutant.originalExpectation)}\n     变异：${expText(mr.mutant.mutatedExpectation)}`,
      killed: mr.killed,
      reason: mr.verdict.reason,
    })),
  }));
  return summarizeScored("spec", scenarios);
}

/** Layer2 适配：直接接收 ScoredScene[]（由 runMutationTrace 构造）。 */
export function summarizeTrace(scenarios: ScoredScenario[]): MutationSummary {
  return summarizeScored("trace", scenarios);
}

function expText(e: { description: string; key_features: string[] }): string {
  return e.key_features.length ? `${e.description} ｜ kf: ${e.key_features.join("；")}` : e.description;
}

/** 单场景小计（CLI 进度用）。 */
export function scenarioSubtotal(r: ScenarioMutationReport): BucketScore {
  const b = emptyBucket();
  for (const mr of r.results) bump(b, mr.killed);
  return b;
}
