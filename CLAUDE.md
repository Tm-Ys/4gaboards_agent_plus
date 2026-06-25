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
   - **Python（`scenario_generator/`）= 已验证原型**：prompt 与 JSON schema 与 `app/` 完全一致、产物互通，保留作参考与快速实验。**Python 包管理必须用 `uv`**（不得用 pip/conda/poetry），工作流：`uv venv && source .venv/bin/activate && uv pip install -e .`。如本地无 uv：`curl -LsSf https://astral.sh/uv/install.sh | sh`。
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
- ✅ **P1.5**：preferences 用户级设置簇工具（`settings_open`/`settings_toggle`/`settings_select`）。侦察证伪原假设——instance 开关簇被 demo 站 demoMode 物理禁用、不可救（已文档化为环境受限）；转向 preferences 簇，settings 簇批量通过率 68%。
- ✅ **P4**：健壮性。① 状态隔离 `resetAccountLanguage`（每场景恢复英文，settings 簇 68%→84%）；② 命名空间 + REST 清理 `cleanupTestProjects`（按 `${ns}-` 前缀删 board/project）；③ 拖拽 `card_drag`（rbd mouse 多步 move）。并发因单账号 + auth 限流 + 全局 state 不可行（已诚实标注）。
- ✅ **领域工具扩展**：A 层 8→**18 工具**。card/view 前置+编辑（`card_open`/`view_switch`/`card_edit_description`）、list 簇列操作（`list_view_menu_action`/`toggle_column`/`sort`）、card 详情（`card_menu_action`/`edit_title`/`manage_comments`/`toggle_section`）；共享 helper（`namespaced`/`ensureCardOpen`/`ensureListView`/`ensureBoardView`/`closeCardModalIfOpen`/`isListView`）。CLI `--feature` 改前缀匹配。三簇验证 view 3/4、list-view 4/6、card 10/21。
- ✅ **card 工具补全**：A 层 18→**20 工具**。新增 `card_manage_labels`（toggle/create/edit；彩色按钮+`button[title]` 定位+socket 轮询读 nameActive）与 `card_text_editor`（switch_mode 点工具栏模式按钮/resize 拖 `.w-md-editor-bar`/help）。抽 `enterDescriptionEdit`/`readEditorMode`。五场景 **3/5**：switch-modes、resize、manage-labels-2 PASS；open-help（@uiw window.open 环境受限）、manage-labels-1（复杂 medium）FAIL。
- ✅ **P5 变异测试（oracle 评估）**：给独立判官打分（被测=判官，app 恒正确）。**Layer1**（改 expectation，真跑正确 app，重判官）= **spec-sensitivity ≈ 0%**——判官无视 expectation、靠 title+steps+trace 推断核心目标，goal-level 全改也 0/3，且会主动推翻亲眼看到的 spec 矛盾。**Layer2**（往真实轨迹注入故障、用原场景重判官）= **3/9 (33%)**——判官做**多源证据和解**，单步失败被幸存证据（卡片数 2→3、URL、列表）救回；薄证据场景（sort/theme/toggle）100% killed，富证据/多步（board/card/view/notifications）0%。结论：判官「不查规约、查行为；行为故障检出依赖证据是否冗余」。代码 `app/src/agent/mutation/`，CLI `run-mutation --layer spec|trace`。
- ✅ **P6 判官加固·strict 变体**：新增 strict 判官（逐条核对 expectation + 终态优先历史不救 + must-have/nice-to-have 分类 + 状态可表达性降级），与 lenient 并存。`--judge both` 两判官对比（`baselineOverride` 复用基线，浏览器只跑一次、判官跑两遍）。实测：Layer1 board-create lenient **0%→strict 57%**（must-kill 0→38%；entity-swap/state-swap/soft 大幅提升，**negate 仍 0% 弱点**）；宽松代价（30 场景零浏览器重判）真实 PASS 率 lenient **46%**/strict **25%**，**strict 误杀 7 个真实通过（-21pp）**。另修 `chatJson` 3 次重试 + 变异体/故障循环单条容错（DeepSeek 偶发畸形 JSON 曾让 `--judge both` 整批崩）。代码 `verify/judge.ts` + `mutation/{runMutation,runMutationTrace,report}` + `cli/{run-mutation,run-judge-cost}` + `llm.ts`，CLI `run-mutation --judge both` / `run-judge-cost --batch`。
- ✅ **前端（牛皮纸控制台）**：Vite+React+TS（`app/web/`）+ Hono SSE 后端（`app/server/`）。三列看板（任务一 catalog / 任务二 Run 实时轨迹+batch / 任务三 mutation+宽松代价三角），牛皮纸皮肤（web-design-engineer skill）。`runReactLoop` 加 `onStep` 回调透传到 SSE。`npm run dev` → http://localhost:5173。实测 board-create Run SSE：6 步 PASS（high）。

### 实际目录（已实现）
```
app/src/agent/
├── browser/   # context.ts(会话/登录/waitForReady) · observation.ts(AX→ref，含 heading)
├── tools/     # registry.ts(注册+toOpenAITools+trace) · browser.ts(B层) · domain.ts(A层)
├── react/     # prompt.ts · types.ts · loop.ts(ReAct 循环)
├── verify/    # transcript.ts(证据文本，不截断) · judge.ts(独立判官)
├── mutation/  # P5 变异测试：operators/mutants(Layer1 spec) · traceFaults/runMutationTrace(Layer2 trace) · runMutation · report
├── runner/    # runScenario.ts(单场景) · runBatch.ts(批量+报告聚合)
├── cli/       # run.ts(--id/--feature) · run-batch.ts(--difficulty/--tag/--limit) · run-mutation.ts(--layer spec|trace)
├── recon.ts            # 选择器侦察脚本（开发期）
├── recon-card-tools.ts # card_manage_labels / card_text_editor 选择器校准（开发期）
├── recon-editor-modes.ts # @uiw md-editor 模式按钮侦察（开发期）
└── smoke.ts   # 工具直接调用冒烟（开发期）
```
> `planning/`、`memory/` 暂未独立成目录（规划靠场景 phases 作骨架、记忆用 ReAct 轨迹，已够用）。

**任务二运行**：
```bash
cd app
npm run run-scenario -- --id board-create-happy-path          # 单场景（含判官）
npm run run-scenario -- --list                                # 列场景
npm run run-batch -- --difficulty easy --tag happy_path --limit 30   # 批量+通过率
npm run run-mutation -- --layer trace                # P5 Layer2：注入 trace 故障→重判官→Mutation Score
npm run run-mutation -- --layer spec --scenario board-create-happy-path   # P5 Layer1：改 expectation→重判官
npm run run-mutation -- --layer spec --judge both    # P6：lenient vs strict 两判官并排对比（both 复用基线，浏览器只跑一次）
npm run run-judge-cost -- --batch outputs/runs/batch-*.json   # P6：零浏览器宽松代价三角（lenient vs strict 真实PASS率 + 误杀明细）
npm run dev                              # 前端控制台（vite 5173 + hono 8787，牛皮纸看板，Run 实时轨迹 + 报告加载）
```
轨迹/报告落 `app/outputs/runs/`（gitignored）。

参考（只读）：`4gaBoards/tests/` 是 Playwright e2e，可借鉴该应用的 DOM 结构与登录鉴权写法，但代码自研。

---

## 🔜 下次接着做（handoff）

**当前位置（2026-06-25）**：**Task1/Task2 增强方案已定稿**——原子操作依赖关系标注 + Baseline 基线路径。讨论全部完成，`todo.md` 已写出（两人分工方案），待开工。

### 背景：为什么要做

Task1 的 118 个 FeaturePoint 是**扁平的**——没有跨功能点的依赖关系。`board_delete` 需要先有看板，但 FeaturePoint 里没有 `prerequisite_feature_ids` 指向 `board_create`。Task2 跑大批场景时 Agent 频繁因缺前置状态而失败。

### 方案核心设计

**1. FeaturePoint 加 `prerequisite_feature_ids`（一次 LLM 推理）**

`schemas.ts` 的 `FeaturePointSchema` 新增 `prerequisite_feature_ids: z.array(z.string()).default([])`。新建 `inferDependencies.ts`：读全部 118 个 FP 一次性喂给 LLM，推理每个 FP 依赖哪些前置 FP。产出更新后的 `features.json`（静态元数据，Task2 直接读，不重复调 LLM）。

**2. 双层 Tag 体系：Baseline（全局基线）**

现有 tag：`happy_path` / `variant` / `edge_case` / `error_handling`。新增 baseline 标记：
- `baseline/P0`：不可逆操作，整个 session 只跑一次（`auth_login`）
- `baseline/P1`：可重跑的资源创建（`project_create` → `board_create` → `list_create×2` → `card_create×3`）

P1 资源名用 `happy_path_yyyymmdd_hhmm` 前缀。`baseline.json` 定义基线场景引用序列（不是新场景，是引用现有 scenarios.json 中的场景 id）。

**3. 执行模型**

```
session 开始:
  run(baseline/P0) → 登录
  run(baseline/P1) → 建项目 + 看板 + 2 列表 + 3 卡片 → 停在 board-view
  DOM pre-check: 页面已有 happy_path_* 资源？是 → 跳过 P1
  run(board_edit)   → 直接测（看板已在页面上）
  run(card_move)    → 直接测（卡片已在页面上）
  ...
  run(board_delete) → 链条末尾，删后不留残
session 结束: REST API 清理全部 baseline 资源
```

**不需要的**：图数据库（118 节点用内存邻接表）、Buffer 层（页面即状态）、新实体类型（FeaturePoint 粒度已够）、新 `category` 字段（`module` 已是分类轴）。

**4. 新增文件（待实现）**

| 文件 | 说明 | 归属 |
|------|------|------|
| `inferDependencies.ts` | LLM 推理依赖 + baseline 打标 | 甲 |
| `dependencyGraph.ts` | 邻接表 DAG（拓扑排序、传递闭包） | 甲 |
| `outputs/basic/baseline.json` | 基线场景引用序列 | 甲 |
| `runner/runBaseline.ts` | P0/P1 执行 + DOM pre-check | 乙 |
| 改 `runner/runScenario.ts` | 增加 `autoSetup` 选项 | 乙 |
| 改 `runner/runBatch.ts` | 增加 `--module` 按元件跑链条 | 乙 |

**5. 详细设计 → `todo.md`**

完整方案、分工细则、prompt 模板、伪代码均在 [`todo.md`](todo.md)。两人分工：甲做数据层（schema + LLM 推理 + DAG + baseline.json），乙做执行层（runner + CLI）。

### 当前状态（2026-06）

- ✅ 收集参考源码与文档；核心方向已定。
- ✅ 任务一完成：功能点提取 + 测试场景生成均已跑通（长上下文直填）。
- ✅ 固化默认场景集 `basic`（179 场景 / 118 功能点）。
- ✅ 任务二 P0–P6 全栈完成：ReAct Agent + 独立 LLM 判官 + 批量 harness + 健壮性 + 变异测试 + 前端牛皮纸控制台。
- ✅ **Task1/Task2 增强方案已定稿**（2026-06-25）：依赖关系 + Baseline 基线，`todo.md` 已出，待开工。
- ⚠️ 已知：弱网批量偶发超时；open-help 环境受限；manage-labels-1 编排偏难。

### 别忘的关键约束

1. 工具驱动真实 UI、不走后端 API（API 仅前置/清理）
2. 工具名只能 `[a-zA-Z0-9_-]`（用下划线）
3. 判官证据不要截断（DeepSeek 上下文充裕）
4. 多步工具用 trace 回报中间观察
5. `4gaBoards/`、`4gaBoardsDocs/` 只读参考，不修改不复用
6. `.env` 绝不提交；Python 必须 `uv`；TypeScript 全部 `tsx` 直接执行
7. 卡片/列表根 observation 看不到（无 role），必须语义 selector
