// 数据模型（zod schema + TS 类型）。字段与 Python 版 pydantic 模型一一对应，
// 保证两端 JSON 产物互通。这些类型也是后续前端可视化与任务二 Agent 的共享契约。

import { z } from "zod";

// ----------------------------- 功能点 ----------------------------- //

export const FeaturePointSchema = z.object({
  id: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string(),
  source_files: z.array(z.string()).default([]),
  source_section: z.string().default(""),
  key_elements: z.array(z.string()).default([]),
  difficulty: z.string().default("easy"),
  prerequisite_feature_ids: z.array(z.string()).default([]),
});
export type FeaturePoint = z.infer<typeof FeaturePointSchema>;

export const FeatureCatalogSchema = z.object({
  generator: z.string().default("scenario_generator.extract_features"),
  model: z.string().default(""),
  feature_points: z.array(FeaturePointSchema).default([]),
});
export type FeatureCatalog = z.infer<typeof FeatureCatalogSchema>;

// ----------------------------- 测试场景 ----------------------------- //
// 场景构成：[ [step]+ [expectation]? ]+

export const ScenarioStepSchema = z.object({
  action: z.string(),
  target: z.string().default(""),
});
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ExpectationSchema = z.object({
  description: z.string(),
  key_features: z.array(z.string()).default([]),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

export const ScenarioPhaseSchema = z.object({
  steps: z.array(ScenarioStepSchema),
  expectation: ExpectationSchema.nullable().default(null),
});
export type ScenarioPhase = z.infer<typeof ScenarioPhaseSchema>;

export const TestScenarioSchema = z.object({
  id: z.string(),
  feature_id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  preconditions: z.array(z.string()).default([]),
  phases: z.array(ScenarioPhaseSchema),
  difficulty: z.string().default("easy"),
  tags: z.array(z.string()).default([]),
});
export type TestScenario = z.infer<typeof TestScenarioSchema>;

export const ScenarioCatalogSchema = z.object({
  generator: z.string().default("scenario_generator.generate_scenarios"),
  model: z.string().default(""),
  scenarios: z.array(TestScenarioSchema).default([]),
});
export type ScenarioCatalog = z.infer<typeof ScenarioCatalogSchema>;
