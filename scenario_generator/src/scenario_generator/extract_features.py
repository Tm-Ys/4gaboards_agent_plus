"""功能点提取（任务一第一步）。

策略（见仓库根 README「关键设计决策」）：**长上下文直填 + 按模块提取**。
对每个功能模块文档，把整篇内容送入 LLM 上下文，提取该模块的全部可测试功能点，
最后合并、去重、输出统一的 FeatureCatalog。

用法：
    uv run python -m scenario_generator.extract_features [--limit N] [--workers K] [--out PATH]
"""

from __future__ import annotations

import argparse
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .config import settings
from .docs import list_functional_docs, read_doc
from .llm import chat_json
from .schema import FeatureCatalog, FeaturePoint, ModuleFeatureResult

SYSTEM_PROMPT = """\
你是一名资深软件测试工程师与 QA 架构师。你的任务：阅读 4gaBoards（一个看板/Kanban Web 应用）\
用户手册的【单个功能模块文档】，提取出该模块中所有"可测试的功能点（feature point）"。

【提取原则】
1. 全面性：覆盖文档中描述的所有用户可操作的功能，尽量不遗漏。
2. 准确性：只提取文档中明确描述的功能，严禁臆造文档中没有的能力（避免幻觉）；不确定时不提取。
3. 粒度：每个功能点应是一个"可独立测试的用户能力"，例如"创建卡片""在列表间拖拽移动卡片""为卡片添加标签"。\
不要过细，也不要过粗。具体规则：
   - **合并同族微操作**：一组紧密相关、属于同一能力的细操作必须合并为一个功能点，把具体变体写进 key_elements。\
典型例子是富文本编辑器工具栏——不要把"加粗""斜体""删除线""标题""列表""链接""引用""代码""表格"等拆成各自的功能点，\
而应按"能力"归并（如"富文本：行内格式""富文本：块级元素""富文本：插入链接/图片/提及""富文本：编辑器视图切换"），\
key_elements 列出 bold/italic/heading/list/link 等具体项。
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
"""


def build_user_prompt(filename: str, content: str) -> str:
    return (
        f"以下是 4gaBoards 用户手册中【{filename}】模块的完整文档内容。"
        f"请按上述规则提取功能点。\n\n"
        f"--- 文档：{filename} ---\n{content}\n--- 文档结束 ---"
    )


def _guess_module(filename: str) -> str:
    return filename.removesuffix(".md").replace("-", " ").title()


def extract_for_doc(filename: str) -> ModuleFeatureResult:
    """对单个功能文档做长上下文功能点提取。"""
    content = read_doc(filename)
    data = chat_json(SYSTEM_PROMPT, build_user_prompt(filename, content))

    # 兜底：模型偶尔会漏填 module / source_file / source_files
    data.setdefault("module", _guess_module(filename))
    data.setdefault("source_file", filename)
    for fp in data.get("feature_points", []):
        fp.setdefault("module", data["module"])
        src_files = fp.get("source_files") or []
        if filename not in src_files:
            src_files = [*src_files, filename]
        fp["source_files"] = src_files

    return ModuleFeatureResult.model_validate(data)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="从 4gaBoards 用户手册提取功能点（长上下文直填）。"
    )
    parser.add_argument("--workers", type=int, default=4, help="并发请求数")
    parser.add_argument(
        "--limit", type=int, default=None, help="只处理前 N 个文档（调试用）"
    )
    parser.add_argument("--out", type=str, default=None, help="输出 JSON 路径")
    args = parser.parse_args()

    docs = list_functional_docs()
    if args.limit:
        docs = docs[: args.limit]
    print(f"📚 待提取功能文档：{len(docs)} 个 -> {docs}", file=sys.stderr)

    all_features: list[FeaturePoint] = []
    failures: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        future_to_doc = {pool.submit(extract_for_doc, d): d for d in docs}
        for fut in as_completed(future_to_doc):
            doc = future_to_doc[fut]
            try:
                result = fut.result()
            except Exception as e:  # noqa: BLE001
                failures.append((doc, f"{e}\n{traceback.format_exc()}"))
                print(f"  ❌ {doc}: {e}", file=sys.stderr)
                continue
            all_features.extend(result.feature_points)
            print(
                f"  ✅ {doc}: {len(result.feature_points)} 个功能点 "
                f"(module={result.module})",
                file=sys.stderr,
            )

    # 按 id 去重，冲突时保留先到者
    seen: set[str] = set()
    deduped: list[FeaturePoint] = []
    for fp in all_features:
        if fp.id in seen:
            continue
        seen.add(fp.id)
        deduped.append(fp)

    catalog = FeatureCatalog(model=settings.deepseek_model, feature_points=deduped)

    out_path = Path(args.out) if args.out else settings.outputs_dir / "features.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        catalog.model_dump_json(indent=2, ensure_ascii=False), encoding="utf-8"
    )

    by_module = catalog.by_module()
    print(file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(
        f"🎯 共提取 {len(deduped)} 个功能点，覆盖 {len(by_module)} 个模块",
        file=sys.stderr,
    )
    for mod, fps in sorted(by_module.items()):
        print(f"  - {mod}: {len(fps)}", file=sys.stderr)
    print(f"失败文档：{len(failures)}", file=sys.stderr)
    print(f"💾 已写入：{out_path}", file=sys.stderr)
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
