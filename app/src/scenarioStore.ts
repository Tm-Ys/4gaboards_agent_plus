// 场景集（scenario set）加载：把「生成产物」组织成命名集，便于任务二 Agent 复用，
// 不必每次重新生成。
//
// 约定：每个集是一个目录 app/outputs/<setName>/，内含 features.json 与 scenarios.json。
// 默认集为 "basic"（已固化的完整场景集，179 场景 / 118 功能点 / 100% 覆盖）。
//
// 用法：
//   import { loadScenarioSet } from "./scenarioStore";
//   const { features, scenarios } = loadScenarioSet();        // 默认 basic
//   const alt = loadScenarioSet("my-experiment");

import fs from "node:fs";
import path from "node:path";
import { settings } from "./config";
import {
  FeatureCatalogSchema,
  ScenarioCatalogSchema,
  type FeatureCatalog,
  type ScenarioCatalog,
} from "./schemas";

export const DEFAULT_SCENARIO_SET = "basic";

export interface ScenarioSet {
  name: string;
  dir: string;
  features: FeatureCatalog;
  scenarios: ScenarioCatalog;
}

export function scenarioSetDir(name: string = DEFAULT_SCENARIO_SET): string {
  return path.join(settings.outputsDir, name);
}

/** 列出 outputs/ 下所有可用的场景集名（存在 scenarios.json 的子目录）。 */
export function listScenarioSets(): string[] {
  if (!fs.existsSync(settings.outputsDir)) return [];
  return fs
    .readdirSync(settings.outputsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => fs.existsSync(path.join(settings.outputsDir, d.name, "scenarios.json")))
    .map((d) => d.name)
    .sort();
}

/** 加载指定场景集（默认 basic）。集不存在或缺 scenarios.json 时抛错并给出提示。 */
export function loadScenarioSet(name: string = DEFAULT_SCENARIO_SET): ScenarioSet {
  const dir = scenarioSetDir(name);
  const scenPath = path.join(dir, "scenarios.json");
  if (!fs.existsSync(scenPath)) {
    const available = listScenarioSets();
    throw new Error(
      `场景集 "${name}" 不存在（${scenPath}）。` +
        (available.length ? `可用集：${available.join(", ")}` : "可用 npm run scenarios 生成后放入 outputs/<setName>/。"),
    );
  }

  const scenarios = ScenarioCatalogSchema.parse(
    JSON.parse(fs.readFileSync(scenPath, "utf-8")),
  ) as ScenarioCatalog;

  const featPath = path.join(dir, "features.json");
  const features: FeatureCatalog = fs.existsSync(featPath)
    ? (FeatureCatalogSchema.parse(JSON.parse(fs.readFileSync(featPath, "utf-8"))) as FeatureCatalog)
    : { generator: "", model: "", feature_points: [] };

  return { name, dir, features, scenarios };
}
