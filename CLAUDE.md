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

## 任务二实现方案（ReAct + 领域工具）

目标：ReAct 智能体消费任务一的 `TestScenario`，在 `demo.4gaboards.com` 上端到端执行，
用 LLM-as-judge 判定通过/失败。核心 headless，产出结构化轨迹与结果，供前端渲染。
输入契约：`app/src/schemas.ts` 的 `TestScenario`，经 `loadScenarioSet("basic")` 加载。

### 架构总览
- ReAct 循环：观察 → 思考（选工具） → 执行（tool call） → 观察 …… 直至 `done` 或步数上限（≤20/场景）。
- 动作层 = **两层工具 + 原生 function calling**（DeepSeek 支持）：
  - **A 层 领域工具**：照 4gaBoardsDocs 写，按任务一模块组织（auth / board / list / card / view / settings …），
    每个对应一项文档能力；**驱动真实 UI**（点真按钮、填真表单），返回结构化领域状态。
  - **B 层 通用浏览器工具**：`browser.click(ref) / fill / press / scroll / goto / observe() / done` —— 兜底 A 层未覆盖的步骤；`observe()` 即观察本身。
- 观察空间 = **文本可访问性树（AX tree）+ 元素 ref**，模型无关（适配 DeepSeek 文本模型）；截图作为可选 VLM 增强。
- 工具注册：`app/src/agent/tools/`，每个工具声明 `{ name, description, params(zod), handler(page, args) }`，
  从 zod 自动生成 OpenAI function schema。**加工具 = 加文件**。

### ⚠️ 两条底线（端到端测试有效性，写代码时必须守）
1. **被测动作必须走真实 UI**，不得用后端 API 走捷径（否则变成测 API 而非 Web 应用）。
   **后端 API 仅用于「前置数据准备」**（登录态、播种 project/board），绝不用于被测动作本身。
2. **验证看真实渲染页**：judge 核对 expectation 的 `key_features` 时取真实页面观察（AX/截图），
   不能只信工具返回的"成功"——这样才能抓布局/语义错误（提升档要求）。

### 四要素落地
- **规划**：场景 `phases[]` 是高层计划骨架；Agent 维护"当前 step 指针"，把抽象步骤操作化为工具调用。
- **记忆**：短期轨迹（thought/action/observation，超长则摘要压缩）+ scratchpad（记本场景创建的资源名，便于验证/清理）。长期（后期）：跨场景常见模式复用。
- **执行**：Playwright 工具执行器；元素找不到/超时作为 observation 反馈回去。
- **验证**：两层 **LLM judge（独立角色，避免执行者自评偏差）**：① 步骤检查点（每个 expectation 到达时核对 key_features）；② 场景终判（review 全轨迹 → PASS/FAIL + 失败步骤 + 原因）。

### docs → 工具桥（任务一衔接）
任务一的 118 个 feature point 基本就是工具清单。可从 feature catalog 自动脚手架工具 stub
（name 取 feature id、params 从 key_elements 推），Playwright handler 人工补。这是 Task1→Task2 的干净闭环。

### 已知难点
- **拖拽**（看板核心）：AX-tree Agent 对"拖到哪"判断弱 → Agent 指定目标列表 ref + Playwright `dragTo`。
- **登录/数据隔离**：demo 共享站点，用 `4GABOARD_*` 登录，带时间戳的 project/board 名，跑完清理。
- **成本/稳定性**：179 场景 × 十几步 × 每步一调用，需步数预算、重试、并发控制、开发期先跑 `easy`+`happy_path` 子集。
- **judge 误判**：后期用「规则启发式 + judge」双通道交叉验证。

### 分阶段路线（✅=已完成）
- ✅ **P0**：Playwright + 观察构建器（AX→ref 文本）+ 工具注册框架 + B 层通用工具 + A 层种子（auth_login / board_create / board_open / card_create）。
- ✅ **P1**：ReAct 循环（function-calling ↔ registry）跑通 board-create happy_path；agent 能自适应真实 UI、失败自恢复。
- ✅ **P2**：独立 LLM 判官（场景级终判 PASS/FAIL + 失败定位 + 原因）；trace 机制让多步封装工具对判官可见；判官抓实质（核心达成即 PASS，描述性/语言不匹配项记 missed 不翻盘）。
- ✅ **P3**：批量 harness（`run-batch`）+ 通过率报告。**基线 43%**（30 个 easy+happy_path：board 5/5、admin 3/3、account 1/1 全过；**instance 设置开关类 0/13 全挂**）。
- ⬜ **P1.5（下一步）**：按模块扩 A 层工具库。**优先 instance/settings 开关类**（救回 0/13 的 instance 簇），再 card/list/view/notifications。
- ⬜ **P4**：健壮性（轨迹摘要压缩、并发、拖拽、清理 demo 数据、截图可选）。
- ⬜ **P5**：提升档（场景变异 + oracle 比对）。
- ⬜ **前端**：渲染轨迹与结果；任务一面板接 `loadScenarioSet`。

### 实际目录（已实现）
```
app/src/agent/
├── browser/   # context.ts(会话/登录/waitForReady) · observation.ts(AX→ref，含 heading)
├── tools/     # registry.ts(注册+toOpenAITools+trace) · browser.ts(B层) · domain.ts(A层)
├── react/     # prompt.ts · types.ts · loop.ts(ReAct 循环)
├── verify/    # transcript.ts(证据文本，不截断) · judge.ts(独立判官)
├── runner/    # runScenario.ts(单场景) · runBatch.ts(批量+报告聚合)
├── cli/       # run.ts(--id/--feature) · run-batch.ts(--difficulty/--tag/--limit)
├── recon.ts   # 选择器侦察脚本（开发期）
└── smoke.ts   # 工具直接调用冒烟（开发期）
```
> `planning/`、`memory/` 暂未独立成目录（规划靠场景 phases 作骨架、记忆用 ReAct 轨迹，已够用）。

**任务二运行**：
```bash
cd app
npm run run-scenario -- --id board-create-happy-path          # 单场景（含判官）
npm run run-scenario -- --list                                # 列场景
npm run run-batch -- --difficulty easy --tag happy_path --limit 30   # 批量+通过率
```
轨迹/报告落 `app/outputs/runs/`（gitignored）。

参考（只读）：`4gaBoards/tests/` 是 Playwright e2e，可借鉴该应用的 DOM 结构与登录鉴权写法，但代码自研。

---

## 🔜 下次接着做（handoff）

**当前位置**：任务二 P0–P3 完成，**基线通过率 43%**（30 个 easy+happy_path）。
完整报告：`app/outputs/runs/batch-2026-06-14T16-21-49-547Z.json`（gitignored；可重跑复现）。

**最高杠杆的下一步 = P1.5：补 `instance/settings` 开关类领域工具**（基线里 instance 0/13 是最大失分簇）：
1. **侦察**：改 `app/src/agent/recon.ts` 打开 instance 设置页，dump toggle/checkbox 的 DOM——开关多为自定义组件，`browser_click` 点不动（不可见/disabled），要找可点的真实元素或用 `check()`/`click({force})`。
2. **建工具**：在 `app/src/agent/tools/domain.ts` 加 `settings_open`（进设置页）、`settings_toggle`（按标签名切开关、返回新状态），照 board_create 模式（幂等、键入搜索、trace 回报中间观察）。
3. **回归**：`npm run run-batch -- --difficulty easy --tag happy_path --limit 30`，看 instance 簇与整体通过率提升。

**之后**：扩 notifications/list/card/view 工具 → 跑 medium/hard 子集 → P4（并发、demo 数据清理、拖拽、变异）→ 前端。

**别忘的关键约束**：① 工具驱动真实 UI、不走后端 API；② 工具名只能 `[a-zA-Z0-9_-]`（用下划线）；③ 判官证据不要截断（DeepSeek 上下文充裕）；④ 多步工具用 trace 回报中间观察，否则判官看不到中间态。

---

## 当前状态（2026-06）

- ✅ 收集参考源码与文档；核心方向已定。
- ✅ 任务一完成：`scenario_generator/`（Python 原型）+ `app/`（TS 移植，schema 互通）。功能点提取 + 测试场景生成均已跑通（长上下文直填）。
- ✅ 固化默认场景集 `basic`（`app/outputs/basic/`，179 场景）+ `scenarioStore.ts` 默认路由，任务二无需每次重新生成。
- ✅ 仓库已 `git init`、推送至 `origin/main`；`.env`/参考仓库/产物均已 gitignore。
- ✅ 任务二 P0–P3 完成：ReAct Agent（浏览器+观察+两层工具+function-calling）+ 独立 LLM 判官 + 批量 harness。**基线通过率 43%**（board/admin/account 全过，instance 设置开关类 0/13 待补工具）。
- ⬜ **下一步 P1.5**：补 instance/settings 开关类领域工具（见上方「🔜 下次接着做」）。
- ⬜ 可视化前端（TS）暂缓。
