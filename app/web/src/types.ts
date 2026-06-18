// 前端镜像类型（前端 tsconfig 不含后端 ../src，故自行镜像契约字段）。

export interface Expectation {
  description: string;
  key_features: string[];
}
export interface ScenarioStep {
  action: string;
  target?: string;
}
export interface ScenarioPhase {
  steps: ScenarioStep[];
  expectation: Expectation | null;
}
export interface TestScenario {
  id: string;
  feature_id: string;
  title: string;
  description: string;
  preconditions: string[];
  phases: ScenarioPhase[];
  difficulty: string;
  tags: string[];
}
export interface FeaturePoint {
  id: string;
  module: string;
  name: string;
  description: string;
  source_files: string[];
  source_section: string;
  key_elements: string[];
  difficulty: string;
}
export interface ScenarioCatalog {
  generator: string;
  model: string;
  scenarios: TestScenario[];
}
export interface FeatureCatalog {
  generator: string;
  model: string;
  feature_points: FeaturePoint[];
}

export interface Verdict {
  pass: boolean;
  confidence: "high" | "medium" | "low";
  failedPhase: number | null;
  failedStep: string | null;
  reason: string;
  matched: string[];
  missed: string[];
}
export interface ReActStep {
  step: number;
  thought?: string;
  tool?: string;
  args?: unknown;
  result?: string;
  observation?: string;
  trace?: { label: string; observation?: string }[];
  ok?: boolean;
}
export interface ScenarioRunResult {
  done: boolean;
  timedOut: boolean;
  steps: ReActStep[];
  finalObservation: string;
  doneSummary?: string;
  likelySuccess: boolean;
  scenarioId: string;
  scenarioTitle: string;
  featureId: string;
  startedAt: string;
  durationMs: number;
  stepCount: number;
  verdict: Verdict;
}

export interface BatchSummary {
  total: number;
  pass: number;
  fail: number;
  error: number;
  passRate: number;
  byDifficulty: Record<string, { pass: number; total: number }>;
  byTag: Record<string, { pass: number; total: number }>;
  avgSteps: number;
  avgMs: number;
}
export interface BatchOutcome {
  scenario: TestScenario;
  result?: ScenarioRunResult;
  error?: string;
}
export interface BatchReport {
  startedAt: string;
  setName: string;
  filter: Record<string, unknown>;
  namespace?: string;
  total: number;
  summary: BatchSummary;
  outcomes: BatchOutcome[];
}

export interface BucketScore {
  total: number;
  killed: number;
  survived: number;
  score: number;
}
export interface MutationSummary {
  layer: "spec" | "trace";
  judgeMode?: string;
  scenariosTotal: number;
  scenariosMutated: number;
  scenariosSkipped: number;
  overall: BucketScore;
  byCategory: Record<string, BucketScore>;
  byOperator: Record<string, BucketScore>;
  byModule: Record<string, BucketScore>;
  survived: {
    scenarioId: string;
    id: string;
    operatorId: string;
    category: string;
    description: string;
    detail: string;
    reason: string;
  }[];
}

export interface ItemVerdictDiff {
  scenarioId: string;
  id: string;
  operatorId: string;
  category: string;
  description: string;
  lenientKilled: boolean;
  strictKilled: boolean;
  strictOnly: boolean;
  lenientOnly: boolean;
}
export interface JudgeComparison {
  layer: string;
  lenient: MutationSummary;
  strict: MutationSummary;
  mustKillDelta: {
    lenientKilled: number;
    strictKilled: number;
    total: number;
    lenientScore: number;
    strictScore: number;
  };
  byOperatorDelta: Record<string, { lenient: BucketScore; strict: BucketScore }>;
  itemDiff: ItemVerdictDiff[];
}

// mutation 报告三结构（按 judge 字段分支）
export type MutationFile =
  | { summary: MutationSummary; reports: unknown[] }
  | { judge: "lenient" | "strict"; summary: MutationSummary; reports: unknown[] }
  | {
      judge: "both";
      summaries: { lenient: MutationSummary; strict: MutationSummary };
      comparison: JudgeComparison;
      reports: { lenient: unknown[]; strict: unknown[] };
    };

export function detectMutationShape(j: MutationFile): "plain" | "single" | "both" {
  if ((j as { judge?: string }).judge === "both") return "both";
  if ((j as { judge?: string }).judge) return "single";
  return "plain";
}

export interface PerScenario {
  scenarioId: string;
  title: string;
  difficulty: string;
  originalVerdictPass: boolean;
  lenient: { pass: boolean; reason: string };
  strict: { pass: boolean; reason: string };
  falsePositive: boolean;
  strictPassLenientFail: boolean;
}
export interface JudgeCostReport {
  startedAt: string;
  sourceBatch: string;
  scenariosJudged: number;
  scenariosSkipped: number;
  passRate: {
    lenient: { pass: number; total: number; rate: number };
    strict: { pass: number; total: number; rate: number };
  };
  falsePositives: PerScenario[];
  lenientOnlyFails: PerScenario[];
  perScenario: PerScenario[];
}

export interface ReportEntry {
  file: string;
  type: string; // runs: batch|single；mutation: mutation|judge-cost
  size: number;
  mtime: string;
}
