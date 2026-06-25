"""测试场景生成（任务一第二步）。

输入：outputs/features.json（任务一第一步的功能点目录）。
策略（见仓库根 README「关键设计决策」）：**长上下文直填 + 按功能点生成**。
对每个功能点，把其【来源文档整篇】+【功能点描述】送入 LLM，按
[ [step]+ [expectation]? ]+ 格式生成可执行测试场景：必含 happy_path，文档支撑时
补充 variant / edge_case，杜绝臆造。

用法：
    uv run python -m scenario_generator.generate_scenarios [--features PATH] [--workers K] [--out PATH]
"""

from __future__ import annotations

import argparse
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .config import settings
from .docs import read_doc
from .llm import chat_json
from .schema import (
    FeatureCatalog,
    FeaturePoint,
    ScenarioCatalog,
    TestScenario,
)

SYSTEM_PROMPT = """\
你是一名资深软件测试工程师。任务：给定 4gaBoards（看板/Kanban Web 应用）的一个【功能点】\
及其【来源文档全文】，生成可被浏览器自动化智能体执行的结构化测试场景。

【场景结构】每个测试场景 = [ [step]+ [expectation]? ]+，即：一组操作步骤后可跟一个预期状态\
（检查点）；一个场景可包含多个这样的「步骤组 + 检查点」段落，用于在关键节点验证中间状态。

【生成原则】
1. 可执行：操作步骤必须是真实、具体的 UI 操作（点击 / 输入 / 拖拽 / 选择 / 快捷键），引用文档中\
出现的真实元素名（按钮、菜单项、字段名）。不要写抽象动作。
2. 抗幻觉：只基于来源文档内容生成；文档没写的元素或行为不要臆造。
3. 预期可验证：每个 expectation 的 key_features 必须是【可观察】特征（出现的元素、文本、状态、\
数值变化、消失/出现），能据此判断步骤是否成功。
4. 前置条件：明确写出执行前需要的状态（如「已登录 demo」「已存在项目 P 与看板 B」「列表中已有卡片 C」）。
5. 场景数量：为该功能点生成 1~3 个场景——必含 happy_path（主流程）；仅当文档支撑时再补充 variant\
（文档提到的另一种操作路径）或 edge_case（边界 / 取消 / 异常）。不要为凑数臆造。
6. 资源命名：steps[].target 使用通用描述（如「目标看板」「目标卡片」），不要硬编码具体资源名称；\
资源实际名称由执行时注入。expectation.key_features 只描述可观察特征类别（如「看板名称可见」），\
不要写具体资源名称。

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
"""


# 加载过的文档缓存，避免对同一文档重复读盘
_doc_cache: dict[str, str] = {}


def _doc_for(feature: FeaturePoint) -> tuple[str, str]:
    """返回 (文档文件名, 文档全文)；找不到则空串。"""
    name = feature.source_files[0] if feature.source_files else ""
    if not name:
        return ("", "")
    if name not in _doc_cache:
        try:
            _doc_cache[name] = read_doc(name)
        except FileNotFoundError:
            _doc_cache[name] = ""
    return (name, _doc_cache[name])


def _feature_block(f: FeaturePoint) -> str:
    return (
        f"- id: {f.id}\n"
        f"  module: {f.module}\n"
        f"  name: {f.name}\n"
        f"  description: {f.description}\n"
        f"  key_elements: {', '.join(f.key_elements) if f.key_elements else '(无)'}\n"
        f"  difficulty: {f.difficulty}\n"
    )


def build_user_prompt(feature: FeaturePoint) -> str:
    doc_name, doc = _doc_for(feature)
    return (
        "请为以下功能点生成测试场景。\n\n"
        f"【功能点】\n{_feature_block(feature)}\n"
        f"【来源文档全文：{doc_name or '(无)'}】\n{doc}\n"
    )


def generate_for_feature(feature: FeaturePoint) -> list[TestScenario]:
    """为单个功能点生成测试场景（长上下文直填）。"""
    data = chat_json(SYSTEM_PROMPT, build_user_prompt(feature))
    raw_scenarios = data.get("scenarios", []) or []

    out: list[TestScenario] = []
    for i, s in enumerate(raw_scenarios):
        s["feature_id"] = feature.id
        s.setdefault("id", f"{feature.id}-{i + 1}")
        try:
            out.append(TestScenario.model_validate(s))
        except Exception as e:  # noqa: BLE001
            print(
                f"    ⚠️ 跳过 {feature.id} 第 {i + 1} 个场景（校验失败）: {e}",
                file=sys.stderr,
            )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="根据功能点生成结构化测试场景。")
    parser.add_argument(
        "--features", type=str, default=None, help="features.json 路径"
    )
    parser.add_argument("--workers", type=int, default=6, help="并发请求数")
    parser.add_argument(
        "--limit", type=int, default=None, help="只处理前 N 个功能点（调试用）"
    )
    parser.add_argument(
        "--only",
        type=str,
        default=None,
        help="只重跑指定功能点（逗号分隔 id），与现有 scenarios.json 合并",
    )
    parser.add_argument("--out", type=str, default=None, help="输出 JSON 路径")
    args = parser.parse_args()

    feat_path = (
        Path(args.features) if args.features else settings.outputs_dir / "features.json"
    )
    if not feat_path.exists():
        print(
            f"❌ 找不到功能点文件：{feat_path}，请先运行 extract_features。",
            file=sys.stderr,
        )
        return 2

    catalog = FeatureCatalog.model_validate_json(feat_path.read_text(encoding="utf-8"))
    all_features = catalog.feature_points
    feature_ids = {f.id for f in all_features}

    only_set: set[str] | None = None
    if args.only:
        only_set = {s.strip() for s in args.only.split(",") if s.strip()}
        features = [f for f in all_features if f.id in only_set]
        unknown = only_set - feature_ids
        if unknown:
            print(f"⚠️ 未知的功能点 id：{sorted(unknown)}", file=sys.stderr)
    elif args.limit:
        features = all_features[: args.limit]
    else:
        features = all_features

    print(
        f"📥 本次处理 {len(features)} 个功能点（全集 {len(all_features)}），"
        f"开始生成测试场景（workers={args.workers}）",
        file=sys.stderr,
    )

    new_scenarios: list[TestScenario] = []
    failed_features: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        fut_to_feat = {pool.submit(generate_for_feature, f): f for f in features}
        for fut in as_completed(fut_to_feat):
            f = fut_to_feat[fut]
            try:
                scs = fut.result()
            except Exception as e:  # noqa: BLE001
                failed_features.append((f.id, f"{e}\n{traceback.format_exc()}"))
                print(f"  ❌ {f.id} ({f.name}): {e}", file=sys.stderr)
                continue
            new_scenarios.extend(scs)
            print(f"  ✅ {f.id}: {len(scs)} 个场景", file=sys.stderr)

    # 与现有产物合并：--only 时保留其它功能点的旧场景，仅替换本次重跑的
    out_path = (
        Path(args.out) if args.out else settings.outputs_dir / "scenarios.json"
    )
    base_scenarios: list[TestScenario] = []
    if only_set and out_path.exists():
        existing = ScenarioCatalog.model_validate_json(
            out_path.read_text(encoding="utf-8")
        )
        base_scenarios = [
            s for s in existing.scenarios if s.feature_id not in only_set
        ]
    merged = base_scenarios + new_scenarios

    # 按 id 去重
    seen: set[str] = set()
    deduped: list[TestScenario] = []
    for s in merged:
        if s.id in seen:
            continue
        seen.add(s.id)
        deduped.append(s)

    out_catalog = ScenarioCatalog(model=settings.deepseek_model, scenarios=deduped)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        out_catalog.model_dump_json(indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # 覆盖率与标签分布（始终按全集功能点统计）
    covered = {s.feature_id for s in deduped}
    missing = feature_ids - covered

    by_tag: dict[str, int] = {}
    for s in deduped:
        for t in s.tags:
            by_tag[t] = by_tag.get(t, 0) + 1

    print(file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(
        f"🎯 共生成 {len(deduped)} 个测试场景，覆盖 "
        f"{len(covered)}/{len(feature_ids)} 个功能点",
        file=sys.stderr,
    )
    print(f"失败功能点：{len(failed_features)}", file=sys.stderr)
    if missing:
        shown = sorted(missing)[:20]
        more = " ..." if len(missing) > 20 else ""
        print(f"⚠️ 未覆盖功能点({len(missing)})：{shown}{more}", file=sys.stderr)
    if by_tag:
        dist = ", ".join(f"{k}={v}" for k, v in sorted(by_tag.items()))
        print(f"场景标签分布：{dist}", file=sys.stderr)
    print(f"💾 已写入：{out_path}", file=sys.stderr)
    return 0 if not failed_features and not missing else 1


if __name__ == "__main__":
    sys.exit(main())
