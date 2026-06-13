// 任务一·步骤1：功能点提取（TypeScript 版）。
// 策略：长上下文直填 + 按模块（每个功能文档）提取，逐模块出功能点后合并去重。非 RAG。
// prompt 与 Python 版完全一致。
//
// 用法：
//   npm run extract [-- --limit N] [-- --workers K] [-- --out PATH]

import fs from "node:fs";
import path from "node:path";
import { settings } from "./config";
import { listFunctionalDocs, readDoc } from "./docs";
import { chatJson } from "./llm";
import { mapWithConcurrency } from "./concurrency";
import { parseArgs, asInt } from "./cli";
import { FeaturePointSchema, type FeatureCatalog, type FeaturePoint } from "./schemas";

const SYSTEM_PROMPT = `你是一名资深软件测试工程师与 QA 架构师。你的任务：阅读 4gaBoards（一个看板/Kanban Web 应用）用户手册的【单个功能模块文档】，提取出该模块中所有"可测试的功能点（feature point）"。

【提取原则】
1. 全面性：覆盖文档中描述的所有用户可操作的功能，尽量不遗漏。
2. 准确性：只提取文档中明确描述的功能，严禁臆造文档中没有的能力（避免幻觉）；不确定时不提取。
3. 粒度：每个功能点应是一个"可独立测试的用户能力"，例如"创建卡片""在列表间拖拽移动卡片""为卡片添加标签"。不要过细，也不要过粗。具体规则：
   - **合并同族微操作**：一组紧密相关、属于同一能力的细操作必须合并为一个功能点，把具体变体写进 key_elements。典型例子是富文本编辑器工具栏——不要把"加粗""斜体""删除线""标题""列表""链接""引用""代码""表格"等拆成各自的功能点，而应按"能力"归并（如"富文本：行内格式""富文本：块级元素""富文本：插入链接/图片/提及""富文本：编辑器视图切换"），key_elements 列出 bold/italic/heading/list/link 等具体项。
   - 同理，快捷键集合、一组同质的设置开关也应按能力归并，而非逐项拆分。
   - 反例：不要为每个工具栏按钮、每个快捷键、每个设置项单独建立功能点。
   - 也不要过粗（如"卡片管理"这种涵盖一切的笼统功能点）。
4. 可执行性：功能点应能指导后续生成浏览器自动化测试场景（含操作步骤与预期状态）。

【id 规则】全局唯一，kebab-case，英文，建议以模块前缀开头（如 card-create、board-share）。
【difficulty】easy=路径明确、UI 可直接验证；medium=多步操作或需前置条件；hard=涉及权限/异步/边界场景。

【输出】严格输出下面的 JSON 结构，不要任何额外文字或解释：
{
  "module": "<模块名，英文，来自文档主题>",
  "source_file": "<你正在阅读的文档文件名>",
  "feature_points": [
    {
      "id": "<...>",
      "module": "<模块名，英文>",
      "name": "<功能名，中文>",
      "description": "<一句话描述，中文>",
      "source_section": "<文档中的来源小节/标题，原文，可空字符串>",
      "key_elements": ["<可观察 UI 元素或关键操作，中英均可>"],
      "difficulty": "easy|medium|hard"
    }
  ]
}
`;

function buildUserPrompt(filename: string, content: string): string {
  return (
    `以下是 4gaBoards 用户手册中【${filename}】模块的完整文档内容。请按上述规则提取功能点。\n\n` +
    `--- 文档：${filename} ---\n${content}\n--- 文档结束 ---`
  );
}

function guessModule(filename: string): string {
  return filename.replace(/\.md$/, "").replace(/-/g, " ");
}

async function extractForDoc(filename: string): Promise<FeaturePoint[]> {
  const content = readDoc(filename);
  const data = await chatJson(SYSTEM_PROMPT, buildUserPrompt(filename, content));
  const module = (data.module as string | undefined) ?? guessModule(filename);
  const rawList = (data.feature_points as Record<string, unknown>[]) ?? [];

  const out: FeaturePoint[] = [];
  for (const r of rawList) {
    const coerced = {
      ...r,
      module: (r.module as string | undefined) ?? module,
      source_files: Array.from(
        new Set([...((r.source_files as string[] | undefined) ?? []), filename]),
      ),
    };
    const parsed = FeaturePointSchema.safeParse(coerced);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.error(
        `    ⚠️ 跳过 ${filename} 的一个功能点（校验失败）: ${parsed.error.message}`,
      );
    }
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const workers = asInt(args.workers, 4);
  const limit = typeof args.limit === "string" ? asInt(args.limit, 0) : undefined;

  let docs = listFunctionalDocs();
  if (limit) docs = docs.slice(0, limit);
  console.error(`📚 待提取功能文档：${docs.length} 个 -> ${JSON.stringify(docs)}`);

  const allFeatures: FeaturePoint[] = [];
  const failures: string[] = [];

  type R = { ok: true; doc: string; features: FeaturePoint[] } | { ok: false; doc: string; error: string };
  const results: R[] = await mapWithConcurrency(docs, workers, async (doc): Promise<R> => {
    try {
      const features = await extractForDoc(doc);
      return { ok: true, doc, features };
    } catch (e) {
      return { ok: false, doc, error: e instanceof Error ? e.message : String(e) };
    }
  });

  for (const r of results) {
    if (r.ok) {
      const mod = r.features[0]?.module ?? guessModule(r.doc);
      console.error(`  ✅ ${r.doc}: ${r.features.length} 个功能点 (module=${mod})`);
      allFeatures.push(...r.features);
    } else {
      failures.push(r.doc);
      console.error(`  ❌ ${r.doc}: ${r.error}`);
    }
  }

  // 按 id 去重
  const seen = new Set<string>();
  const deduped: FeaturePoint[] = [];
  for (const fp of allFeatures) {
    if (seen.has(fp.id)) continue;
    seen.add(fp.id);
    deduped.push(fp);
  }

  const catalog: FeatureCatalog = {
    generator: "scenario_generator.extract_features",
    model: settings.deepseekModel,
    feature_points: deduped,
  };

  const outPath = typeof args.out === "string" ? args.out : path.join(settings.outputsDir, "features.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), "utf-8");

  // 摘要
  const byModule = new Map<string, number>();
  for (const fp of deduped) byModule.set(fp.module, (byModule.get(fp.module) ?? 0) + 1);

  console.error("\n" + "=".repeat(60));
  console.error(`🎯 共提取 ${deduped.length} 个功能点，覆盖 ${byModule.size} 个模块`);
  for (const [mod, n] of [...byModule.entries()].sort()) console.error(`  - ${mod}: ${n}`);
  console.error(`失败文档：${failures.length}`);
  console.error(`💾 已写入：${outPath}`);
  return failures.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
