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

**当前位置**：**可视化前端已完成**（2026-06-18）。牛皮纸看板控制台（Vite+React+Hono SSE），三列：任务一 catalog / 任务二 Run 实时轨迹+batch / 任务三 mutation+宽松代价三角。`npm run dev` → http://localhost:5173，实测 board-create Run SSE 6 步 PASS（high）。前端复用现有 TS（`loadScenarioSet`/`runScenario`(+onStep)/`runMutation`/`judgeScenario`），仅 `loop.ts`+`runScenario.ts` 加 onStep。**任务二 P0–P6 + 前端，全栈完成。**

**P4 健壮性（已完成）**：① 状态隔离 `resetAccountLanguage`（每场景恢复英文，settings 簇 68%→84%）；② 命名空间 + REST 清理 `cleanupTestProjects`（按 `${ns}-` 前缀删 board/project）；③ 拖拽 `card_drag`（react-beautiful-dnd mouse 多步 move，非 click/dragAndDrop）。

**领域工具扩展（已完成，A 层 8→18）**：
- card/view 前置+编辑：`card_open`（开详情 `/cards/:id`）、`view_switch`（board/list，DOM 特征判态非 URL）、`card_edit_description`（md-editor Save/Ctrl+Enter）。
- list 簇列操作：`list_view_menu_action`（Ellipsis 菜单 fit_content/fit_screen/...）、`list_view_toggle_column`（原生 checkbox setChecked 幂等）、`list_view_sort`（三态循环，sortDescFirst 因列而异）。
- card 详情：`card_menu_action`（省略号菜单 copy_link/check_activity/duplicate/...）、`card_edit_title`、`card_manage_comments`、`card_toggle_section`。
- helper：`namespaced`/`ensureCardOpen`/`ensureListView`/`ensureBoardView`/`closeCardModalIfOpen`/`isListView`（抽自 board_open/card_create 双回退模式）。CLI `--feature` 改前缀匹配。

**card 工具补全（已完成，A 层 18→20）**：补齐 manage_labels / text_view 两个簇。
- `card_manage_labels`（toggle/create/edit）：4gaBoards 标签是**彩色按钮**（选中=nameActive 类，非 checkbox）；弹层搜索框占位符实测 `"Search labels or create one..."`；标签项定位用 `button[title="<name>"]`（recon 实测 title=标签名，比 role name 稳）；toggle 选中态经 **socket 往返**更新，需**轮询 ~4s** 读 class 变化（弱网下 700ms 不够）；create 后标签自动选中。
- `card_text_editor`（switch_mode/resize/help）：@uiw/react-md-editor@4。模式由根节点 class 指示 `w-md-editor-show-edit/live/preview`，全屏根/body 带 fullscreen 类；**Ctrl+7/8/9/0 在本版本未绑定**（工具栏只有 Ctrl+1~6 标题）→ 改点**工具栏右侧模式按钮**（extraCommands，title 含 edit/live/preview/full）；resize 手柄=`.w-md-editor-bar`（cursor s-resize，docs 称"右下角三圆点"）；help 按钮 title="Open help"。
- helper：抽 `enterDescriptionEdit`（card_edit_description 复用）、`readEditorMode`（读根 class）。
- 五场景验证：text-view-switch-modes ✅、text-view-resize ✅、manage-labels-2 ✅、**open-help ❌**（@uiw `commands.help` 的 window.open 在 headless 不产生 Playwright 可追踪 popup，环境受限，类比 instance demoMode）、**manage-labels-1 ❌**（复杂 medium 多步编排，create/toggle 已可用但全序列+rename 对 agent 偏难）。

**P5 变异测试（已完成，2026-06-18）**——给独立判官打分（被测=判官，app 恒正确）：
- **Layer1 场景级（改 expectation，真跑正确 app，重判官）= spec-sensitivity ≈ 0%**。判官无视 expectation、靠 title+steps+trace 推断核心目标；把 title+desc+expectation+steps **整体**改成另一目标（goal-level）也 0/3 全存活，且会**主动推翻亲眼看到的 spec 矛盾**（Simple vs Kanban：判官自述「实际选了 Simple 而非指定的 Kanban，但核心目标达成」）。
- **Layer2 轨迹级（往真实轨迹注入故障、用原场景重判官）= 3/9 (33%)**。判官做**多源证据和解**：单个失败步骤会被幸存证据救回（card-create 自述「card_create 首次失败，但列表 Open 卡片数 2→3，创建成功」；notifications「步骤3点击失败被后续弥补」）。分化：薄证据/单动作（list-sort/settings-theme/sidebar-toggle）**100% killed**；富证据/多步（board/card/view/notifications）**0%**。按算子 exec-failure 3/7、layout-missing 0/2；semantic-flip 因 finalObs 多英文/符号 AX 树、中文状态 token 难命中而少触发。
- 结论：判官「**不查规约、查行为；且行为故障检出依赖证据是否冗余**」——富证据场景要全通道失败才 FAIL。
- 代码 `app/src/agent/mutation/`（operators/mutants=Layer1，traceFaults/runMutationTrace=Layer2，runMutation/report 共用）；CLI `npm run run-mutation -- --layer spec|trace [--scenario|--feature|--limit]`。报告落 `app/outputs/mutation/`（gitignored）。

**P6 判官加固·strict 变体（已完成，2026-06-18）**——量化宽松代价：
- **strict 判官**（`judge.ts` 加 `JudgeMode`：逐条核对 expectation + 终态优先历史不救 + must-have/nice-to-have 分类 + 状态可表达性降级 + 跨语言强映射），与既有 lenient 并存，默认 lenient 不破坏既有行为。
- **Layer1 board-create both 实测**：lenient **0/14（must-kill 0%）** → strict **8/14（must-kill 38%）**。按算子 entity-swap 0→67%、state-swap 0→100%、soft(keyword/feature) 0→75-100%；**negate 0→0%（strict 弱点，取反类仍漏，待 prompt 调优）**。
- **宽松代价（30 场景零浏览器重判）**：真实 PASS 率 lenient 46% / strict 25%，**strict 误杀 7 个真实通过（-21pp）**。误杀里 ~2 个是真问题（board-view-toggle 终态视图、board-export-csv 操作路径偏离）、~5 个 strict 太严（headless 下载无 UI 提示 / 终态本就该关 / demo 无数据）。
- **`--judge both`**：runner 加 `baselineOverride` 复用基线 trace（浏览器只跑一次、判官跑两遍）；`report.ts` 加 `compareJudges`（strict-only kills = 宽松漏检锚点）。
- **健壮性修复**：DeepSeek 偶发畸形 JSON 曾让 `--judge both`（调用翻倍）整批崩 → `chatJson` 加 3 次重试 + 变异体/故障循环单条容错（跳过失败项不崩、不丢已跑结果）。
- 代码：`verify/judge.ts`(JudgeMode/STRICT prompt) + `mutation/{runMutation,runMutationTrace}`(judgeMode/baselineOverride 透传) + `mutation/report.ts`(compareJudges/JudgeComparison) + `cli/run-mutation.ts`(--judge both) + `cli/run-judge-cost.ts`(宽松代价三角，零浏览器) + `llm.ts`(chatJson 重试)。

**前端组织方案（2026-06-18 定型 → ✅ 已实现，见 `app/web/`+`app/server/`）**：
- **定位**：交互控制台——浏览任务一 catalog、触发并实时看任务二场景执行（ReAct 轨迹）、触发并看 P5 变异分数；答辩演示用。
- **栈**：Vite + React + TS（前端）+ Node 后端（Hono，SSE 流式进度），复用现有 TS 函数、不 shell CLI。
- **视觉**：看板风结构（三列 任务一 / 任务二 / P5，每场景一张卡，贴合被测 4gaBoards）+ **Claude 牛皮纸皮肤**（暖黄牛皮纸底 + 衬线细字体 + Claude 橘土点缀）。
- **复用点**：`loadScenarioSet`（catalog，已入库 basic）、`runScenario`（需给 `runReactLoop` 加 `onStep` 回调，唯一要改的现有代码）、`runMutation`/`runMutationTrace`（已有 `onMutant`/`onScenario`/`onFault` 可直接喂 SSE）、读 `outputs/runs` + `outputs/mutation` 已有报告。
- **约束**：单账号串行（全局 in-flight 锁，并发 409）；运行真改 demo 站数据（runner 已含 namespace 清理）；批量（30 场景 ~1h）只支持加载已有报告、不实时跑。
- **分期**：① 先做只读牛皮纸看板外壳（catalog + 已有报告）锁样式；② 再加 Node 后端 + SSE + Run 按钮做交互。
- **Skill**：前端 build 用 `ConardLi/garden-skills` 的 **`web-design-engineer`**（HTML/CSS/JS/React 出「惊艳级」页面，自带 style-recipes 风格锚点，适合定制牛皮纸看板皮肤；装法：作为 plugin 加到 `.claude/`）；精美 HTML 报告可备用 `beautiful-article`。

**之后**（可选增强）：① ~~前端实时变异/judge-cost 交互 route~~ ——**变异实时 route 已做**（`/api/mutation` SSE + `MutationLauncher` + `useMutation`），judge-cost 实时未做（演示用已有报告加载足够）；② strict 判官加固 negate 类（已加 STRICT「否定强矛盾」prompt 段，待验证；Layer2 `--judge both` 代码就绪、待全量跑）；③ manage-labels-1 edit-rename、open-help popup 替代；④ 答辩视觉打磨（看 5173 后微调）。

**已知问题（非工具缺陷）**：
- 弱网下批量 `page.goto` 登录/清理偶发 60s 超时；cleanup 语言恢复在弱网下脆弱。
- 判官严格性：card-delete-via-bin（按 Delete 键 vs 点 bin 图标）、open-card-by-clicking-row（抓"点行空白区"操作方式）——核心目标其实达成。
- card 簇剩余 FAIL：open-help（环境受限）、manage-labels-1（复杂 medium）、view-activity-comment(波形图标)、card-edit-title/copy-link/check-activity（agent 未调用已有工具，编排问题非工具缺陷）。

**别忘的关键约束**：① 工具驱动真实 UI、不走后端 API（API 仅前置/清理）；② 工具名只能 `[a-zA-Z0-9_-]`（用下划线）；③ 判官证据不要截断（DeepSeek 上下文充裕）；④ 多步工具用 trace 回报中间观察，否则判官看不到中间态；⑤ 卡片/列表根 observation 看不到（无 role），必须语义 selector（`[class*="Card_name"][title]` 等）。

---

## 当前状态（2026-06）

- ✅ 收集参考源码与文档；核心方向已定。
- ✅ 任务一完成：`scenario_generator/`（Python 原型）+ `app/`（TS 移植，schema 互通）。功能点提取 + 测试场景生成均已跑通（长上下文直填）。
- ✅ 固化默认场景集 `basic`（`app/outputs/basic/`，179 场景）+ `scenarioStore.ts` 默认路由，任务二无需每次重新生成。
- ✅ 仓库已 `git init`、推送至 `origin/main`；`.env`/参考仓库/产物均已 gitignore。
- ✅ 任务二 P0–P3 + P1.5 + **P4 完成**：ReAct Agent + 独立 LLM 判官 + 批量 harness + 健壮性地基。
- ✅ **P4 健壮性（2026-06-15/16）**：① 状态隔离（`resetAccountLanguage` 每场景恢复英文）；② 命名空间 + REST 清理（`cleanupTestProjects` 按前缀删 board/project）；③ 拖拽工具 `card_drag`（rbd mouse 多步 move）。settings 簇 68%→84%。
- ✅ **领域工具扩展**：A 层 8→**18 工具**。新增 card_open/view_switch/card_edit_description（card/view 簇前置+编辑）、list_view_menu_action/toggle_column/sort（list 簇列操作）、card_menu_action/edit_title/manage_comments/toggle_section（card 详情菜单/编辑）。CLI `--feature` 改前缀匹配。三簇验证：view 3/4、list-view 4/6、card 10/21（含网络异常）。
- ✅ **card 工具补全（2026-06-16）**：A 层 18→**20 工具**。新增 `card_manage_labels`（toggle/create/edit，彩色按钮+socket 轮询）与 `card_text_editor`（switch_mode/resize/help，工具栏模式按钮+.w-md-editor-bar）。抽 `enterDescriptionEdit`/`readEditorMode` helper。五场景验证 **3/5**：switch-modes / resize / manage-labels-2 PASS；open-help（环境受限）/ manage-labels-1（复杂 medium）FAIL。
- ✅ **P5 变异测试（2026-06-18）**：Layer1 改 expectation→spec-sensitivity≈0%（判官靠核心目标推断、无视 expectation）；Layer2 注入 trace 故障→Mutation Score **3/9 (33%)**（薄证据场景 100%、富证据 0%，判官多源证据和解）。代码 `app/src/agent/mutation/`，CLI `run-mutation --layer spec|trace`。
- ✅ **P6 判官加固·strict 变体（2026-06-18）**：strict 判官（逐条核对+终态优先+must-have/nice-to-have 分类），`--judge both` 两判官对比。Layer1 board-create lenient 0%→strict 57%（must-kill 0→38%，negate 仍 0% 弱点）；宽松代价 lenient 46%/strict 25%，strict 误杀 7 个真实通过（-21pp）。修 `chatJson` 重试 + 循环容错。代码 `verify/judge.ts`+`mutation/*`+`cli/{run-mutation,run-judge-cost}`+`llm.ts`，CLI `run-mutation --judge both` / `run-judge-cost`。
- ✅ **可视化前端（2026-06-18）**：牛皮纸看板控制台（Vite+React+Hono SSE，`app/web/`+`app/server/`）。三列：catalog / Run 实时轨迹（onStep SSE）+ batch / mutation 三结构 + judge-cost 三角。`npm run dev`→5173。实测 board-create Run 6 步 PASS。仅 `loop.ts`+`runScenario.ts` 加 onStep，余皆新增。
- ⚠️ 已知：弱网下批量 `page.goto` 登录/清理偶发超时（非工具缺陷）；open-help 受 @uiw window.open 限制；manage-labels-1 复杂 medium 待编排优化；P5 Layer2 的 semantic-flip 偶发不触发（finalObs 多英文/符号 AX 树，中文状态 token 难命中）、layout-missing 仅创建类场景适用（需 namespace 资源在 finalObs）。
