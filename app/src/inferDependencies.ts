// Task1 增强：一次性把全部 FeaturePoint 交给 LLM，推理跨功能点前置依赖，
// 写回 features.json，并给 baseline happy_path 场景打标。
//
// 用法：
//   npm run infer-deps
//   npm run infer-deps -- --features outputs/basic/features.json
//                         --scenarios outputs/basic/scenarios.json
//                         --out outputs/basic/features.json
//                         --baseline-tags outputs/basic/baseline_tags.json

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./cli";
import { settings } from "./config";
import { chatJson } from "./llm";
import {
  FeatureCatalogSchema,
  ScenarioCatalogSchema,
  type FeatureCatalog,
  type FeaturePoint,
  type ScenarioCatalog,
} from "./schemas";
import { DependencyGraph } from "./agent/dependencyGraph";

const BASELINE_P0_TOOL = "auth_login";
const BASELINE_P1_FEATURE_IDS = new Set([
  "project-create",
  "board-create",
  "list-create",
  "card-create",
]);

const SYSTEM_PROMPT = `你是 4gaBoards 测试架构师。下面会提供该应用的全部功能点列表。请一次性推理每个功能点依赖哪些前置功能点，并判断其 happy_path 是否属于 baseline/P1。

【依赖规则】
1. 只能引用输入中真实存在的功能点 id；id 必须原样输出，禁止把 kebab-case 改成 snake_case，禁止臆造 auth_login 等不存在的功能点。
2. 注册类 account 功能没有依赖。登录是 Task2 runner 的 auth_login 工具前置，不是当前 FeaturePoint，不要写入 prerequisite_feature_ids。
3. 结构层严格按顺序：project-create → board-create → list-create → card-create。
4. create/read/update/delete 模式：delete/edit/reorder/move 等操作依赖相应 create；卡片详情面板操作依赖打开卡片所需的创建能力。
5. instance 设置类不依赖项目/看板；仅在输入中存在对应登录或权限 FeaturePoint 时才能引用它们。
6. list-view 操作依赖 board-create，以及输入中负责切换/进入列表视图的真实 FeaturePoint。
7. 侧边栏操作通常依赖至少一个 project/board；只引用输入中真实存在且必要的最小前置集合。
8. prerequisite_feature_ids 写直接前置即可，避免把同一条依赖链的所有祖先重复列出；运行时会计算传递闭包。
9. 不得自依赖；不确定的依赖宁可不写，避免幻觉。

【baseline/P1 判定规则】
只有以下功能点为 true：
- project-create
- board-create
- list-create
- card-create
其余功能点一律为 false。登录由 runner 的 auth_login 工具承担，属于 baseline/P0，不是 FeaturePoint。

【输出】严格输出 JSON，不要任何额外文字：
{
  "feature_points": [
    {
      "id": "board-create",
      "prerequisite_feature_ids": ["project-create"],
      "baseline_p1": true
    }
  ]
}`;

interface InferredFeature {
  id: string;
  prerequisite_feature_ids: string[];
  baseline_p1: boolean;
}

interface BaselineTagEntry {
  id: string;
  kind: "tool" | "feature";
  tag: "baseline/P0" | "baseline/P1";
}

interface BaselineTagsFile {
  description: string;
  entries: BaselineTagEntry[];
}

function resolvePath(value: string | boolean | undefined, fallback: string): string {
  return path.resolve(typeof value === "string" ? value : fallback);
}

function buildUserPrompt(features: FeaturePoint[]): string {
  const compact = features.map((feature) => ({
    id: feature.id,
    module: feature.module,
    name: feature.name,
    description: feature.description,
    source_files: feature.source_files,
    source_section: feature.source_section,
    key_elements: feature.key_elements,
    difficulty: feature.difficulty,
  }));
  return `以下是全部 ${features.length} 个 FeaturePoint。请严格使用其中的 id 推理依赖。\n\n${JSON.stringify(compact, null, 2)}`;
}

function parseInference(
  data: Record<string, unknown>,
  featureIds: Set<string>,
): Map<string, InferredFeature> {
  const rows = Array.isArray(data.feature_points) ? data.feature_points : [];
  const inferred = new Map<string, InferredFeature>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const raw = row as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!featureIds.has(id)) {
      if (id) console.warn(`⚠️ LLM 返回未知功能点 id，已跳过：${id}`);
      continue;
    }

    const prerequisites = Array.isArray(raw.prerequisite_feature_ids)
      ? raw.prerequisite_feature_ids.map(String)
      : [];
    const validPrerequisites: string[] = [];
    for (const prerequisiteId of prerequisites) {
      if (prerequisiteId === id) {
        console.warn(`⚠️ ${id} 出现自依赖，已跳过`);
        continue;
      }
      if (!featureIds.has(prerequisiteId)) {
        console.warn(`⚠️ ${id} 引用了不存在的前置 ${prerequisiteId}，已跳过`);
        continue;
      }
      if (!validPrerequisites.includes(prerequisiteId)) {
        validPrerequisites.push(prerequisiteId);
      }
    }

    const llmBaseline = raw.baseline_p1 === true;
    const expectedBaseline = BASELINE_P1_FEATURE_IDS.has(id);
    if (llmBaseline !== expectedBaseline) {
      console.warn(
        `⚠️ ${id} 的 baseline_p1=${llmBaseline} 与固定规则 ${expectedBaseline} 不符，按固定规则写入`,
      );
    }
    inferred.set(id, {
      id,
      prerequisite_feature_ids: validPrerequisites,
      baseline_p1: expectedBaseline,
    });
  }
  return inferred;
}

function updateFeatures(
  catalog: FeatureCatalog,
  inferred: Map<string, InferredFeature>,
): FeatureCatalog {
  const missing: string[] = [];
  const feature_points = catalog.feature_points.map((feature) => {
    const result = inferred.get(feature.id);
    if (!result) {
      missing.push(feature.id);
      return { ...feature, prerequisite_feature_ids: [] };
    }
    return {
      ...feature,
      prerequisite_feature_ids: result.prerequisite_feature_ids,
    };
  });
  if (missing.length) {
    console.warn(
      `⚠️ LLM 未返回 ${missing.length} 个功能点，已写空依赖：${missing.join(", ")}`,
    );
  }
  return { ...catalog, feature_points };
}

function updateScenarioTags(catalog: ScenarioCatalog): {
  catalog: ScenarioCatalog;
  tagged: string[];
} {
  const tagged: string[] = [];
  const scenarios = catalog.scenarios.map((scenario) => {
    if (
      !BASELINE_P1_FEATURE_IDS.has(scenario.feature_id) ||
      !scenario.tags.includes("happy_path")
    ) {
      return scenario;
    }
    tagged.push(scenario.id);
    return {
      ...scenario,
      tags: [...new Set([...scenario.tags, "baseline/P1"])],
    };
  });
  return { catalog: { ...catalog, scenarios }, tagged };
}

function baselineTagsFile(): BaselineTagsFile {
  return {
    description:
      "Baseline 标签索引。P0 登录由 auth_login 领域工具执行；P1 条目关联 FeaturePoint 的 happy_path 场景。",
    entries: [
      { id: BASELINE_P0_TOOL, kind: "tool", tag: "baseline/P0" },
      ...[...BASELINE_P1_FEATURE_IDS].map(
        (id): BaselineTagEntry => ({ id, kind: "feature", tag: "baseline/P1" }),
      ),
    ],
  };
}

function validateOutputs(
  features: FeatureCatalog,
  scenarios: ScenarioCatalog,
  taggedScenarioIds: string[],
): void {
  const graph = new DependencyGraph(features.feature_points);
  if (!graph.validateNoCycles()) {
    throw new Error("LLM 推理结果存在依赖环，拒绝写入 features.json");
  }

  if (taggedScenarioIds.length !== BASELINE_P1_FEATURE_IDS.size) {
    throw new Error(
      `baseline/P1 happy_path 数量异常：期望 ${BASELINE_P1_FEATURE_IDS.size}，实际 ${taggedScenarioIds.length}`,
    );
  }
  for (const featureId of BASELINE_P1_FEATURE_IDS) {
    const tagged = scenarios.scenarios.filter(
      (scenario) =>
        scenario.feature_id === featureId &&
        scenario.tags.includes("happy_path") &&
        scenario.tags.includes("baseline/P1"),
    );
    if (tagged.length !== 1) {
      throw new Error(
        `功能点 ${featureId} 的 baseline/P1 happy_path 应恰好 1 个，实际 ${tagged.length}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const basicDir = path.join(settings.outputsDir, "basic");
  const featuresPath = resolvePath(
    args.features,
    path.join(basicDir, "features.json"),
  );
  const scenariosPath = resolvePath(
    args.scenarios,
    path.join(basicDir, "scenarios.json"),
  );
  const outputPath = resolvePath(args.out, featuresPath);
  const baselineTagsPath = resolvePath(
    args["baseline-tags"],
    path.join(path.dirname(outputPath), "baseline_tags.json"),
  );

  if (!fs.existsSync(featuresPath)) {
    throw new Error(`找不到功能点文件：${featuresPath}`);
  }
  if (!fs.existsSync(scenariosPath)) {
    throw new Error(`找不到场景文件：${scenariosPath}`);
  }

  const featureCatalog = FeatureCatalogSchema.parse(
    JSON.parse(fs.readFileSync(featuresPath, "utf-8")),
  ) as FeatureCatalog;
  const scenarioCatalog = ScenarioCatalogSchema.parse(
    JSON.parse(fs.readFileSync(scenariosPath, "utf-8")),
  ) as ScenarioCatalog;
  const featureIds = new Set(
    featureCatalog.feature_points.map((feature) => feature.id),
  );

  console.error(
    `🧠 一次性推理 ${featureCatalog.feature_points.length} 个功能点的前置依赖`,
  );
  const data = await chatJson(
    SYSTEM_PROMPT,
    buildUserPrompt(featureCatalog.feature_points),
    { temperature: 0.1, maxTokens: 32_000 },
  );
  const inferred = parseInference(data, featureIds);
  const updatedFeatures = updateFeatures(featureCatalog, inferred);
  const updatedScenarios = updateScenarioTags(scenarioCatalog);
  validateOutputs(
    updatedFeatures,
    updatedScenarios.catalog,
    updatedScenarios.tagged,
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(updatedFeatures, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    scenariosPath,
    JSON.stringify(updatedScenarios.catalog, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    baselineTagsPath,
    JSON.stringify(baselineTagsFile(), null, 2),
    "utf-8",
  );

  console.error(`✅ LLM 返回有效功能点：${inferred.size}/${featureIds.size}`);
  console.error(
    `🏷️ baseline/P1 场景：${updatedScenarios.tagged.join(", ")}`,
  );
  console.error(`💾 features：${outputPath}`);
  console.error(`💾 scenarios：${scenariosPath}`);
  console.error(`💾 baseline tags：${baselineTagsPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
