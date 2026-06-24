# 4gaboard_agent_plus

基于大模型的 **测试场景自动生成 + 智能测试执行** 工具，目标应用 [4gaBoards](https://github.com/RARgames/4gaBoards)（开源看板 Web 应用）。

> 课程实践课题。读 4gaBoards 的用户手册与源码，让大模型自动提取功能点、生成可执行测试场景，再由 ReAct 智能体在浏览器中自主执行并判定通过与否。

### 📖 文档导航

- **[技术报告](TECHNICAL_REPORT.md)** —— 完整设计、架构、实验结果、创新点（答辩 PPT 素材源）
- **[开发日志](开发日志.md)** —— 开发过程与阶段性进展
- `CLAUDE.md` —— 给 AI 编码助手的项目工作指南

---

## 这个项目做什么

一个全自动闭环，对 4gaBoards demo 站端到端测试：

```
用户手册 ──任务一──▶ 测试场景 ──任务二──▶ 执行轨迹 ──判官──▶ PASS/FAIL
```

- **任务一**：从手册提取 **118 个功能点**、生成 **179 个结构化测试场景**（100% 覆盖）。
- **任务二**：ReAct 智能体 + **20 个领域工具** + 独立 LLM 判官执行；并用变异测试评估判官质量、量化「宽松代价」。
- **前端**：牛皮纸看板控制台，实时看 agent 边想边做边判。

完整设计与技术细节见 **[技术报告](TECHNICAL_REPORT.md)**。

---

## 仓库结构

```
4gaboard_agent_plus/
├── README.md / TECHNICAL_REPORT.md / 开发日志.md
├── .env.example           # 环境变量模板（真实 .env 不入库）
├── start.sh               # 一键启动前端控制台
├── 4gaBoards/             # 【只读参考】目标应用源码（上游 RARgames/4gaBoards）
├── 4gaBoardsDocs/         # 【只读参考 + 知识源】目标应用用户手册
├── scenario_generator/    # 【任务一·Python 原型】功能点提取 + 场景生成
└── app/                   # 【主交付·TypeScript】生成 + Agent + 前端
    ├── src/               #   schemas / extract / generate / agent/
    ├── server/            #   Hono SSE 后端
    ├── web/               #   Vite + React 前端
    └── outputs/basic/     #   固化默认场景集（118 功能点 / 179 场景，入库）
```

> ⚠️ `4gaBoards/`、`4gaBoardsDocs/` 各自是**独立的 git 仓库**（指向上游），是**只读参考**：可作任务一知识输入、可参考其代码风格，但**不得直接复用其代码、不得修改其内容**。本项目交付代码全自研、放在根目录下。

---

## 快速开始

### 1. 克隆与配置

```bash
git clone https://github.com/Tm-Ys/4gaboards_agent_plus.git
cd 4gaboard_agent_plus

# 1) 只读参考仓库（不入本仓库版本库，需单独 clone 到根目录）
git clone https://github.com/RARgames/4gaBoards.git 4gaBoards
git clone https://github.com/RARgames/4gaBoardsDocs.git 4gaBoardsDocs

# 2) 配置密钥
cp .env.example .env   # 填入真实值（.env 不入库）

# 3) 安装依赖
cd scenario_generator && uv sync && cd ..   # 任务一 Python 原型
cd app && npm install && cd ..              # TS 主程序（生成 + Agent + 前端）
```

> `4gaBoards/`、`4gaBoardsDocs/`、`.env`、`node_modules/`、`.venv/`、`outputs/` 均已在 `.gitignore`，不会入库。

### 2. 环境变量（`.env`）

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API` / `DEEPSEEK_URL_OPENAI` / `DEEPSEEK_MODEL` | DeepSeek（OpenAI 兼容）调用 |
| `TOOL_API` / `TOOL_API_URL_OPENAI` / `TOOL_EMBEDDING_MODEL` / `TOOL_RERANKING_MODEL` | Embedding / Reranking（RAG 实验用） |
| `TARGET_APP_DOCS_URL` / `TARGET_APP_DEMO_URL` | 文档站与 Demo 站地址 |
| `4GABOARD_ACCOUNT` / `4GABOARD_PASSWORD` / `4GABOARD_CLIENT_ID` / `4GABOARD_PWD` | 4gaBoards 登录与认证 |
| `RETRIEVER_MODE` | 检索策略：`embedding`（RAG）/ `page_index`（关键词 / 标题匹配） |

### 3. 运行

```bash
cd app
npm run dev                # 前端控制台 → http://localhost:5173（最常用，答辩演示）

npm run extract && npm run scenarios                               # 任务一：生成场景
npm run run-scenario -- --id board-create-happy-path               # 任务二：单场景（含判官）
npm run run-batch -- --difficulty easy --tag happy_path --limit 30 # 任务二：批量 + 通过率
npm run run-mutation -- --layer trace                              # 变异测试（注入轨迹故障）
npm run run-mutation -- --layer spec --judge both                  # 两判官对比（lenient vs strict）
```

或一键启动：`./start.sh`。完整运行入口见 **[技术报告 · 附录](TECHNICAL_REPORT.md#附运行入口)**。

> 版本控制用 **Git**；轨迹 / 报告落 `app/outputs/`（gitignored）。

---

## 相关链接

- 本项目仓库：<https://github.com/Tm-Ys/4gaboards_agent_plus>
- 目标应用源码（仅参考）：<https://github.com/RARgames/4gaBoards>
- 目标应用文档源（仅参考）：<https://github.com/RARgames/4gaBoardsDocs>
- 用户手册站：<https://docs.4gaboards.com/>
- 应用 Demo：<https://demo.4gaboards.com/>
