# CLAUDE.md

本文件为 Claude Code（及任何 AI 编码助手）在本仓库工作时的指南。先读这里，再动手。

---

## 项目是什么

一个课程实践课题：**基于大模型的测试场景自动生成 + 智能测试执行工具**，目标应用是 [4gaBoards](https://github.com/RARgames/4gaBoards)（开源看板 Web 应用）。

- **任务一**：读用户手册（+ 源码），让 LLM 提取功能点、生成结构化测试场景。场景格式 `[ [step]+ [expectation]? ]+`。
- **任务二**：基于 ReAct 的 Web 测试智能体，在浏览器里执行任务一的场景并判定成功 / 失败（规划 / 记忆 / 执行 / 验证）。

详见 [README.md](README.md)。

---

## ⚠️ 最关键的约束：两个子目录是只读参考，不是我们的代码

```
4gaBoards/        # 第三方上游源码 (RARgames/4gaBoards)，自带 .git
4gaBoardsDocs/    # 第三方上游文档 (RARgames/4gaBoardsDocs)，自带 .git
```

- **它们各自是独立的 git 仓库**，指向上游，**不是本项目的子模块**。
- **只能参考**：可读其文档内容作为任务一的知识输入；可参考其前后端代码风格来写我们自己的代码。
- **不得直接复用其代码**，**不要修改这两个目录里的任何文件**。
- **本项目的交付代码全部自研**，放在仓库根目录下，目前两个自有目录：
  - `scenario_generator/` — 任务一的 **Python 原型**（已验证，prompt/schema 与 TS 版互通）。
  - `app/` — **TypeScript 主交付程序**（任务一生成逻辑已移植；任务二 Agent + 前端也在此实现）。
- 被测对象是**线上 Demo**（`demo.4gaboards.com`），**不需要**在本仓库运行 4gaBoards。

> 简记：根目录之外的两份是“字典和范文”，只许看、不许抄、不许改；我们自己写的字，写在根目录。

---

## 版本库（已初始化并推送）

项目根目录已是 git 仓库（分支 `main`），远程 `origin = https://github.com/Tm-Ys/4gaboards_agent_plus.git`。

`.gitignore` 已排除（**都不会入库**）：
- `.env`（密钥，绝不提交）、`.claude/`
- `/4gaBoards/`、`/4gaBoardsDocs/`（只读参考，各自有上游，需单独 clone）
- `node_modules/`、`.venv/`、`__pycache__/`、`outputs/*`（生成产物）

提交前若新增密钥，确认它没被 `git add`；可用 `git grep --cached <片段>` 扫描暂存内容。
提交身份为仓库级：`Tm-Ys <Tm-Ys@users.noreply.github.com>`，可改。

---

## 已确定的技术方向（写代码时遵循）

1. **交付自研**，不抄上游。
2. **检索策略 = 长上下文直填**：生成测试场景时把整段文档直接喂给 LLM，**不要默认走 RAG**。`.env` 里 `RETRIEVER_MODE` 仅用于对比实验。
3. **智能体 = ReAct**（Reason + Act）。
4. **大模型用国产**：首选 **DeepSeek V4 Flash**（`.env` `DEEPSEEK_MODEL=deepseek-v4-flash`，OpenAI 兼容接口）；备选 GLM-4.6V / 4.7、Qwen3-VL-Plus、DeepSeek V3。
5. **语言分工（已更新）**：
   - **TypeScript（`app/`）= 主交付程序**：任务一生成逻辑已从 Python 移植至此；**任务二 Agent（ReAct + 浏览器自动化）与前端可视化也在此实现**。`app/src/schemas.ts`（zod）是前端 / 生成 / Agent 三方共享的类型契约。
   - **Python（`scenario_generator/`）= 已验证原型**：prompt 与 JSON schema 与 `app/` 完全一致、产物互通，保留作参考与快速实验。
   - 本机联网需走本地代理：Python 加 `httpx[socks]`；Node 用 `undici` `ProxyAgent` 包自定义 fetch 注入 openai SDK（见 `app/src/http.ts`），**注意 undici 不支持 socks，取 `HTTPS_PROXY` 而非 `all_proxy`**。

---

## .env：所有密钥在这里，绝不提交

根目录 `.env` 已含：DeepSeek（OpenAI 兼容）、Embedding / Reranking（RAG 实验用）、`TARGET_APP_DOCS_URL` / `TARGET_APP_DEMO_URL`、`4GABOARD_*` 登录凭据、`RETRIEVER_MODE`。

- 读取方式：Python 用 `python-dotenv`，Node 用 `dotenv`。
- **永远不要**把 `.env` 内容、真实 Key、账号密码写进代码、日志、提交信息或对话里。展示配置示例时用占位符。
- 若新增密钥，同步更新 `.env.example`（脱敏模板）并在此登记用途。

---

## 用户手册知识源（任务一输入）

功能性文档在 `4gaBoardsDocs/docs/*.md`：account、project、board、list、card、view（board-view / list-view）、sidebar、notifications、settings（instance / project / admin）、import-export、shortcuts、structure 等。`docs/dev/*` 是安装 / 部署文档，**测试场景生成一般不依赖**。

4gaBoards 的 REST API 结构可参考 `4gaBoards/server/api/`（controllers / models / policies 等），用于理解被测应用的真实接口与数据模型。

---

## 工作习惯

- **语言**：面向用户的输出（README、注释、日志、UI 文案）用**中文**，与现有 README 风格一致；代码标识符用英文。
- **动手前先读**：改任何自有代码前，先读相关文件；触碰 `4gaBoards/`、`4gaBoardsDocs/` 前停下，它们是只读参考。
- **测试场景产出要可执行**：任务一的产物必须能被任务二的智能体实际跑起来——步骤粒度适中、预期状态可验证。
- **变更可逆性**：初始化 git、推远程、改动 `.env`、修改两个子目录等操作，先与用户确认再执行。

---

## 任务二入口：场景集（scenario set）

任务二 Agent 不必每次重新生成场景，直接加载已固化的命名场景集：

- 约定：`app/outputs/<setName>/{features.json, scenarios.json}`。
- **默认集 `basic`**：已入库（118 功能点 / 179 场景 / 100% 覆盖），是任务二默认数据源。
- 入口（`app/src/scenarioStore.ts`）：
  ```ts
  import { loadScenarioSet } from "./scenarioStore";
  const { features, scenarios } = loadScenarioSet();   // 默认 basic
  ```
- 想跑实验版场景：`npm run scenarios` 生成后放进 `app/outputs/<实验名>/`，再 `loadScenarioSet("<实验名>")`。
- 仅 `outputs/basic/` 入库，其余 `outputs/*` 仍 gitignore。

---

## 当前状态（2026-06）

- ✅ 收集参考源码与文档；核心方向已定。
- ✅ 任务一完成：`scenario_generator/`（Python 原型）+ `app/`（TS 移植，schema 互通）。功能点提取 + 测试场景生成均已跑通（长上下文直填）。
- ✅ 固化默认场景集 `basic`（`app/outputs/basic/`，179 场景）+ `scenarioStore.ts` 默认路由，任务二无需每次重新生成。
- ✅ 仓库已 `git init`、推送至 `origin/main`；`.env`/参考仓库/产物均已 gitignore。
- ⬜ 任务二 Agent（ReAct + Playwright，对 demo.4gaboards.com）尚未开始；将复用 `app/src/schemas.ts` 的 `TestScenario` 类型作为输入契约。
- ⬜ 可视化前端（TS）暂缓。
