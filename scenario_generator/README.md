# scenario_generator

4gaBoards 测试场景生成器（任务一）。基于**长上下文直填**（非 RAG）从用户手册提取功能点、生成结构化测试场景。

## 目录约定

- `src/scenario_generator/` — 自研 Python 包
  - `config.py` — 读取仓库根 `.env`，集中配置
  - `docs.py` — 加载 `4gaBoardsDocs/docs/` 功能文档（只读参考 + 知识源）
  - `schema.py` — 功能点 / 场景的 pydantic 数据模型
  - `llm.py` — DeepSeek（OpenAI 兼容）封装，JSON 模式
  - `extract_features.py` — 功能点提取入口
- `outputs/` — 生成的 JSON 产物（默认不入库）

## 环境依赖

- 仓库根 `.env` 需配置 `DEEPSEEK_API` / `DEEPSEEK_URL_OPENAI` / `DEEPSEEK_MODEL`。
- Python ≥ 3.11，用 [uv](https://docs.astral.sh/uv/) 管理依赖。

## 安装

```bash
cd scenario_generator
uv sync
```

## 提取功能点

```bash
# 全量提取（并发 4）
uv run python -m scenario_generator.extract_features

# 调试：只处理前 2 个文档
uv run python -m scenario_generator.extract_features --limit 2

# 自定义并发 / 输出路径
uv run python -m scenario_generator.extract_features --workers 8 --out ./outputs/features.json
```

输出：`outputs/features.json`（`FeatureCatalog`，按模块组织的功能点列表）。

## 设计要点

- **长上下文直填**：每个功能模块文档**整篇**送入 LLM 上下文，不做向量检索 / 分块（见仓库根 README「关键设计决策」）。
- **按模块提取**：一次调用处理一个模块文档，天然具备来源可追溯性，便于抗幻觉与定位。
- **并发**：多文档用线程池并发请求。
