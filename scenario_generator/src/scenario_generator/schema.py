"""功能点与目录的数据模型（pydantic）。

这些模型既是内部数据结构，也是与 LLM JSON 输出之间的契约。
"""

from __future__ import annotations

from collections import defaultdict

from pydantic import BaseModel, Field


class FeaturePoint(BaseModel):
    """一个可测试的功能点（feature point）。"""

    id: str = Field(
        ..., description="全局唯一 id，kebab-case，建议带模块前缀，如 card-create"
    )
    module: str = Field(..., description="模块名，英文，如 Card")
    name: str = Field(..., description="功能名，中文")
    description: str = Field(..., description="一句话功能描述，中文")
    source_files: list[str] = Field(
        default_factory=list, description="来源文档文件名（可追溯、抗幻觉）"
    )
    source_section: str = Field(
        default="", description="文档中的来源小节/标题，原文，可空"
    )
    key_elements: list[str] = Field(
        default_factory=list, description="参与该功能的可观察 UI 元素 / 关键操作"
    )
    difficulty: str = Field("easy", description="easy | medium | hard")


class ModuleFeatureResult(BaseModel):
    """单模块功能点提取的返回结构（LLM JSON 输出契约）。"""

    module: str
    source_file: str
    feature_points: list[FeaturePoint]


class FeatureCatalog(BaseModel):
    """全量功能点目录（合并所有模块后的产物）。"""

    generator: str = "scenario_generator.extract_features"
    model: str = ""
    feature_points: list[FeaturePoint] = Field(default_factory=list)

    def by_module(self) -> dict[str, list[FeaturePoint]]:
        groups: dict[str, list[FeaturePoint]] = defaultdict(list)
        for fp in self.feature_points:
            groups[fp.module].append(fp)
        return dict(groups)


# --------------------------------------------------------------------------- #
# 测试场景模型（任务一第二步）
# 场景构成：[ [step]+ [expectation]? ]+
# --------------------------------------------------------------------------- #


class ScenarioStep(BaseModel):
    """一个具体操作步骤。"""

    action: str = Field(..., description="具体操作，中文，引用真实 UI 元素名")
    target: str = Field(default="", description="操作对象/元素，可空")


class Expectation(BaseModel):
    """预期状态（测试预言）。"""

    description: str = Field(..., description="预期状态描述，中文")
    key_features: list[str] = Field(
        default_factory=list, description="用于判断该状态是否达成的可观察关键特征"
    )


class ScenarioPhase(BaseModel):
    """[step]+ [expectation]? —— 一组操作步骤 + 可选的预期状态检查点。

    一个测试场景由多个 phase 顺序组成，便于在关键节点验证中间状态。
    """

    steps: list[ScenarioStep]
    expectation: Expectation | None = None


class TestScenario(BaseModel):
    """一个测试场景。"""

    id: str = Field(..., description="全局唯一 id，kebab-case")
    feature_id: str = Field(..., description="关联的功能点 id")
    title: str = Field(..., description="场景标题，中文")
    description: str = Field(default="", description="一句话场景说明")
    preconditions: list[str] = Field(
        default_factory=list, description="前置条件（登录、已有项目/看板等）"
    )
    phases: list[ScenarioPhase] = Field(
        ..., description="[ [step]+ [expectation]? ]+ 的有序段落"
    )
    difficulty: str = Field("easy", description="easy | medium | hard")
    tags: list[str] = Field(
        default_factory=list,
        description="happy_path / variant / edge_case / error_handling 等",
    )


class ScenarioCatalog(BaseModel):
    """全量测试场景目录。"""

    generator: str = "scenario_generator.generate_scenarios"
    model: str = ""
    scenarios: list[TestScenario] = Field(default_factory=list)

    def by_feature(self) -> dict[str, list[TestScenario]]:
        groups: dict[str, list[TestScenario]] = defaultdict(list)
        for s in self.scenarios:
            groups[s.feature_id].append(s)
        return dict(groups)
