// 任务一·步骤2：测试场景生成（TypeScript 版）。
// 策略：长上下文直填 + 按功能点生成，把每个功能点的【来源文档整篇】+【功能点描述】送入 LLM，
// 按 [ [step]+ [expectation]? ]+ 格式产出可执行测试场景。prompt 与 Python 版完全一致。
//
// 用法：
//   npm run scenarios [-- --features PATH] [-- --workers K] [-- --limit N]
//                     [-- --only id1,id2] [-- --out PATH]

import fs from "node:fs";
import path from "node:path";
import { settings } from "./config";
import { readDoc } from "./docs";
import { chatJson } from "./llm";
import { mapWithConcurrency } from "./concurrency";
import { parseArgs, asInt } from "./cli";
import {
  FeatureCatalogSchema,
  ScenarioCatalogSchema,
  TestScenarioSchema,
  type FeatureCatalog,
  type FeaturePoint,
  type ScenarioCatalog,
  type TestScenario,
} from "./schemas";

const SYSTEM_PROMPT = `你是一名资深软件测试工程师。任务：给定 4gaBoards（看板/Kanban Web 应用）的一个【功能点】及其【来源文档全文】，生成可被浏览器自动化智能体执行的结构化测试场景。

【场景结构】每个测试场景 = [ [step]+ [expectation]? ]+，即：一组操作步骤后可跟一个预期状态（检查点）；一个场景可包含多个这样的「步骤组 + 检查点」段落，用于在关键节点验证中间状态。

【生成原则】
1. 可执行：操作步骤必须是真实、具体的 UI 操作（点击 / 输入 / 拖拽 / 选择 / 快捷键），引用文档中出现的真实元素名（按钮、菜单项、字段名）。不要写抽象动作。
2. 抗幻觉：只基于来源文档内容生成；文档没写的元素或行为不要臆造。
3. 预期可验证：每个 expectation 的 key_features 必须是【可观察】特征（出现的元素、文本、状态、数值变化、消失/出现），能据此判断步骤是否成功。
4. 前置条件：明确写出执行前需要的状态（如「已登录 demo」「已存在项目 P 与看板 B」「列表中已有卡片 C」）。
5. 场景数量：为该功能点生成 1~3 个场景——必含 happy_path（主流程）；仅当文档支撑时再补充 variant（文档提到的另一种操作路径）或 edge_case（边界 / 取消 / 异常）。不要为凑数臆造。
6. 资源命名：steps[].target 使用通用描述（如「目标看板」「目标卡片」），不要硬编码具体资源名称；资源实际名称由执行时注入。expectation.key_features 只描述可观察特征类别（如「看板名称可见」），不要写具体资源名称。

【字段说明】
- steps[].action：具体操作，中文，引用真实 UI 元素名。
- steps[].target：操作对象/元素，可空。
- expectation.description：预期状态，中文。
- expectation.key_features：可观察的判定特征列表。
- preconditions：前置条件列表。
- phases：[step]+ [expectation]? 的有序段落。
- difficulty：easy | medium | hard。
- tags：从 happy_path / variant / edge_case / error_handling 中选取。

【id 规则】全局唯一，kebab-case，建议 <feature_id>-<语义或序号>，如 card-create-1、card-create-via-menu。

【输出】严格输出下面的 JSON，不要任何额外文字：
{
  "feature_id": "<对应的功能点 id>",
  "scenarios": [
    {
      "id": "<...>",
      "feature_id": "<同上>",
      "title": "<场景标题，中文>",
      "description": "<一句话说明>",
      "preconditions": ["..."],
      "difficulty": "easy|medium|hard",
      "tags": ["happy_path"],
      "phases": [
        {
          "steps": [
            {"action": "...", "target": "..."}
          ],
          "expectation": {
            "description": "...",
            "key_features": ["..."]
          }
        }
      ]
    }
  ]
}
`;

const docCache = new Map<string, string>();

function docFor(feature: FeaturePoint): { name: string; content: string } {
  const name = feature.source_files[0] ?? "";
  if (!name) return { name: "", content: "" };
  if (!docCache.has(name)) {
    try {
      docCache.set(name, readDoc(name));
    } catch {
      docCache.set(name, "");
    }
  }
  return { name, content: docCache.get(name) ?? "" };
}

function featureBlock(f: FeaturePoint): string {
  return [
    `- id: ${f.id}`,
    `  module: ${f.module}`,
    `  name: ${f.name}`,
    `  description: ${f.description}`,
    `  key_elements: ${f.key_elements.length ? f.key_elements.join(", ") : "(无)"}`,
    `  difficulty: ${f.difficulty}`,
    "",
  ].join("\n");
}

function buildUserPrompt(feature: FeaturePoint): string {
  const { name, content } = docFor(feature);
  return `请为以下功能点生成测试场景。\n\n【功能点】\n${featureBlock(feature)}\n【来源文档全文：${name || "(无)"}】\n${content}\n`;
}

async function generateForFeature(feature: FeaturePoint): Promise<TestScenario[]> {
  const data = await chatJson(SYSTEM_PROMPT, buildUserPrompt(feature));
  const rawList = (data.scenarios as Record<string, unknown>[]) ?? [];
  const out: TestScenario[] = [];
  rawList.forEach((s, i) => {
    const coerced = {
      ...s,
      feature_id: feature.id,
      id: (s.id as string | undefined) ?? `${feature.id}-${i + 1}`,
    };
    const parsed = TestScenarioSchema.safeParse(coerced);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.error(`    ⚠️ 跳过 ${feature.id} 第 ${i + 1} 个场景（校验失败）: ${parsed.error.message}`);
    }
  });
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const workers = asInt(args.workers, 6);
  const limit = typeof args.limit === "string" ? asInt(args.limit, 0) : undefined;
  const onlySet =
    typeof args.only === "string"
      ? new Set(args.only.split(",").map((s) => s.trim()).filter(Boolean))
      : null;

  const featPath = typeof args.features === "string" ? args.features : path.join(settings.outputsDir, "features.json");
  if (!fs.existsSync(featPath)) {
    console.error(`❌ 找不到功能点文件：${featPath}，请先运行 extract。`);
    return 2;
  }

  const rawCatalog = FeatureCatalogSchema.parse(JSON.parse(fs.readFileSync(featPath, "utf-8"))) as FeatureCatalog;
  const allFeatures = rawCatalog.feature_points;
  const featureIds = new Set(allFeatures.map((f) => f.id));

  let features: FeaturePoint[];
  if (onlySet) {
    features = allFeatures.filter((f) => onlySet.has(f.id));
    const unknown = [...onlySet].filter((id) => !featureIds.has(id));
    if (unknown.length) console.error(`⚠️ 未知的功能点 id：${JSON.stringify(unknown)}`);
  } else if (limit) {
    features = allFeatures.slice(0, limit);
  } else {
    features = allFeatures;
  }

  console.error(`📥 本次处理 ${features.length} 个功能点（全集 ${allFeatures.length}），开始生成测试场景（workers=${workers}）`);

  type R = { ok: true; feature: FeaturePoint; scenarios: TestScenario[] } | { ok: false; feature: FeaturePoint; error: string };
  const results: R[] = await mapWithConcurrency(features, workers, async (feature): Promise<R> => {
    try {
      const scenarios = await generateForFeature(feature);
      return { ok: true, feature, scenarios };
    } catch (e) {
      return { ok: false, feature, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const newScenarios: TestScenario[] = [];
  const failed: FeaturePoint[] = [];
  for (const r of results) {
    if (r.ok) {
      newScenarios.push(...r.scenarios);
      console.error(`  ✅ ${r.feature.id}: ${r.scenarios.length} 个场景`);
    } else {
      failed.push(r.feature);
      console.error(`  ❌ ${r.feature.id} (${r.feature.name}): ${r.error}`);
    }
  }

  const outPath = typeof args.out === "string" ? args.out : path.join(settings.outputsDir, "scenarios.json");

  // 与现有产物合并：--only 时保留其它功能点的旧场景，仅替换本次重跑的
  let baseScenarios: TestScenario[] = [];
  if (onlySet && fs.existsSync(outPath)) {
    const existing = ScenarioCatalogSchema.parse(JSON.parse(fs.readFileSync(outPath, "utf-8"))) as ScenarioCatalog;
    baseScenarios = existing.scenarios.filter((s) => !onlySet.has(s.feature_id));
  }
  const merged = [...baseScenarios, ...newScenarios];

  // 按 id 去重
  const seen = new Set<string>();
  const deduped: TestScenario[] = [];
  for (const s of merged) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    deduped.push(s);
  }

  const catalog: ScenarioCatalog = {
    generator: "scenario_generator.generate_scenarios",
    model: settings.deepseekModel,
    scenarios: deduped,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), "utf-8");

  // 覆盖率与标签分布（按全集统计）
  const covered = new Set(deduped.map((s) => s.feature_id));
  const missing = [...featureIds].filter((id) => !covered.has(id));
  const byTag = new Map<string, number>();
  for (const s of deduped) for (const t of s.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1);

  console.error("\n" + "=".repeat(60));
  console.error(`🎯 共生成 ${deduped.length} 个测试场景，覆盖 ${covered.size}/${featureIds.size} 个功能点`);
  console.error(`失败功能点：${failed.length}`);
  if (missing.length) console.error(`⚠️ 未覆盖功能点(${missing.length})：${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " ..." : ""}`);
  if (byTag.size) console.error(`场景标签分布：${[...byTag.entries()].sort().map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.error(`💾 已写入：${outPath}`);
  return failed.length || missing.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
