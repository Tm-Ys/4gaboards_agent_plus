# 4gaboards Agent Plus

基于大模型的 **测试场景自动生成 + 智能测试执行** 工具，目标应用为 [4gaBoards](https://github.com/RARgames/4gaBoards)（一个开源看板 / Kanban Web 应用）。

本项目是一个课程实践课题：通过阅读 4gaBoards 的**用户手册与源码**，让大模型自动提取功能点、生成可执行的测试场景，再由一个 ReAct 智能体在浏览器中自主执行这些测试场景并判定通过与否。

---

## 一、项目背景

随着 Web Agent 快速发展，人们对其在复杂 Web 应用中的测试可用性提出了更高要求。现有 Web Agent 在 WebArena 等基准上仍表现出较高的任务失败率，原因在于：

1. Web 应用业务逻辑复杂且高度领域化；
2. 大模型存在幻觉，且缺乏待测应用的领域知识，容易输出与事实不符的信息；
3. 难以在执行完操作后准确判定任务是否成功。

软件文档（手册）蕴含大量业务知识，可帮助 Agent 更好地理解功能、判断执行结果。本项目旨在设计一种基于大模型的**测试场景生成与自主执行工具**：

1. 自动提取用户手册中的知识，生成功能覆盖全面、粒度适宜、具有可执行性的测试场景；
2. 基于大模型智能体，自主执行测试场景，对目标应用开展全面的功能测试。

---

## 二、任务定义

### 任务一：基于用户手册的测试场景自动生成

**目标**：基于大模型从用户手册中提取知识，生成测试场景。

**要求**

- 能够根据用户手册提取软件的主要功能点；
- 根据每个功能点生成结构化的测试场景；
- 支持功能点、测试场景的可视化展示。

**测试场景的构成**

```
测试场景 = [ [step]+ [expectation]? ]+
```

- **操作步骤（step）**：完成功能所需的具体操作步骤；
- **预期状态（expectation）**：功能完成后的预期状态，相当于**测试预言**，包含用于评估功能是否成功完成的关键特征。

### 任务二：测试场景驱动的智能测试智能体

**目标**：构建基于大模型的 Web 测试智能体，自动执行任务一生成的测试场景。

架构至少包含以下要素（可自主扩展）：

- **规划（Planning）**：根据测试场景自主规划执行计划；
- **记忆（Memory）**：辅助执行的上下文信息；
- **执行（Execution）**：与浏览器交互，执行规划动作；
- **验证（Verification）**：根据整个测试轨迹验证测试场景是否执行成功、功能是否正确。

---

## 三、关键设计决策（当前阶段）

> 这一节记录本项目在探索中确定的工程方向，便于团队对齐。

1. **交付代码全部自研，上游仓库只作参考。**
   `4gaBoards/`（源码）与 `4gaBoardsDocs/`（文档）是第三方上游仓库，**可以参考其代码结构、前后端风格与文档内容，但不能直接复用其中的代码**。本项目所有交付代码（测试场景生成器、智能体、可视化前端等）均由我们自行编写、自包含于本仓库根目录。

2. **知识来源：源码 + 手册双通道。**
   直接抓取目标网站的 doc 来生成测试用例效果不佳。改为直接读取本地 clone 的 **4gaBoards 源码** 与 **官方文档**，作为任务一的知识输入。

3. **检索策略：长上下文直填，而非 RAG。**
   在本项目场景下 RAG 效果不佳——它会检索到语义相近但不相同的内容填充 Prompt，反而引入噪声。由于所用大模型具备 **1M 上下文**，生成测试用例时倾向于**直接把对应文档整段送入上下文**，而非依赖向量检索。（`.env` 中仍保留 `RETRIEVER_MODE` 以备对比实验。）

4. **智能体架构：ReAct。**
   任务二必须基于 ReAct（Reason + Act）架构实现。

5. **大模型：国产模型。**
   允许 / 优先使用 DeepSeek V4 Flash。

6. **被测应用：线上 Demo。**
   任务二直接对官方 Demo（`demo.4gaboards.com`）执行测试，无需本地运行 4gaBoards。

---

## 四、仓库结构

```
4gaboard_agent_plus/
├── README.md              # 本文件
├── CLAUDE.md              # 给 Claude Code 的项目工作指南
├── .env.example           # 环境变量模板（真实 .env 不入库）
├── 4gaBoards/             # 【只读参考】目标应用源码，上游 RARgames/4gaBoards
├── 4gaBoardsDocs/         # 【只读参考 + 知识源】目标应用用户手册，上游 RARgames/4gaBoardsDocs
├── scenario_generator/    # 【任务一·Python 原型】功能点提取 + 场景生成（已验证）
│   ├── src/scenario_generator/
│   └── outputs/           #   生成产物（不入库）
└── app/                   # 【主交付·TypeScript】生成逻辑移植 + 任务二 Agent + 前端
    ├── src/
    │   ├── schemas.ts         # zod schema + TS 类型（前端/生成/Agent 共享契约）
    │   ├── extractFeatures.ts # 任务一·步骤1
    │   ├── generateScenarios.ts # 任务一·步骤2
    │   └── scenarioStore.ts   # 场景集加载，默认路由 basic
    └── outputs/basic/         # 固化默认场景集（118 功能点 / 179 场景，入库）
```

> ⚠️ **重要约束**：`4gaBoards/` 与 `4gaBoardsDocs/` 各自是**独立的 git 仓库**（指向上游 `RARgames/...`），是**只读参考资料**：可作为任务一的知识输入、可在自研时参考其代码风格，但**不得直接复用其代码**，也不要修改这两个子目录的内容。本项目交付代码放在仓库根目录下、由我们自行编写。

### 用户手册的功能性文档（任务一的主要输入）

位于 `4gaBoardsDocs/docs/*.md`，覆盖：account、project、board、list、card、view（board-view / list-view）、sidebar、notifications、settings（instance / project / admin）、import-export、shortcuts、structure 等。`docs/dev/*` 为安装 / 部署相关文档，测试场景生成一般不依赖。

---

## 五、环境与准备

### 5.0 首次克隆

```bash
git clone https://github.com/Tm-Ys/4gaboards_agent_plus.git
cd 4gaboards_agent_plus

# 1) 只读参考仓库（不入本仓库版本库，需单独 clone 到根目录）
git clone https://github.com/RARgames/4gaBoards.git 4gaBoards
git clone https://github.com/RARgames/4gaBoardsDocs.git 4gaBoardsDocs

# 2) 配置密钥
cp .env.example .env   # 然后填入真实值（.env 不入库）

# 3) 安装依赖
cd scenario_generator && uv sync && cd ..        # 任务一 Python 原型
cd app && npm install && cd ..                    # TS 主程序（生成 + Agent + 前端）
```

> `4gaBoards/`、`4gaBoardsDocs/`、`.env`、`node_modules/`、`.venv/`、`outputs/` 均已在 `.gitignore` 中，不会入库。

### 5.1 凭据与 API

所有密钥统一放在根目录 `.env`（**切勿提交**）。当前包含：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API` / `DEEPSEEK_URL_OPENAI` / `DEEPSEEK_MODEL` | DeepSeek（OpenAI 兼容）调用 |
| `TOOL_API` / `TOOL_API_URL_OPENAI` / `TOOL_EMBEDDING_MODEL` / `TOOL_RERANKING_MODEL` | Embedding / Reranking（RAG 实验用） |
| `TARGET_APP_DOCS_URL` / `TARGET_APP_DEMO_URL` | 文档站与 Demo 站地址 |
| `4GABOARD_ACCOUNT` / `4GABOARD_PASSWORD` / `4GABOARD_CLIENT_ID` / `4GABOARD_PWD` | 4gaBoards 登录与认证 |
| `RETRIEVER_MODE` | 检索策略：`embedding`（RAG）/ `page_index`（关键词 / 标题匹配） |

### 5.2 运行时

- **TypeScript / Node.js（`app/`，主交付）**：任务一生成逻辑（已从 Python 移植）、任务二 ReAct Agent（浏览器自动化）、可视化前端都在此实现。`app/src/schemas.ts` 是三方共享类型契约。
- **Python（`scenario_generator/`，原型）**：已验证的任务一原型，prompt / schema 与 `app/` 一致、产物互通；用 `uv` 管理依赖，保留作快速实验。

### 5.3 目标应用

- 用户手册：<https://docs.4gaboards.com/>
- 应用 Demo：<https://demo.4gaboards.com/>
- 计算设备：无特殊要求，能完成赛题即可。
- 版本控制：**必须使用 Git**。

---

## 六、评分标准

### 基础功能档

- **任务一**：根据用户手册能够识别主要功能点，并生成主要功能的测试场景，测试场景的生成格式符合要求。
- **任务二**：智能体能够执行任务一中识别的简单测试场景，能够验证执行完整性与功能正确性。

### 提升创新档

**任务一**

- **正确性与全面性**：确保从手册等文档中检索到的信息真实有效，尽量避免大模型“幻觉”导致的错误；尽可能全面覆盖文档包含的功能并避免遗漏。
- **粒度与可执行性**：功能划分粒度应合适，既不能过细导致难以组合成实际功能，也不宜过粗以致无法指导具体操作；同时保证生成的测试场景具有可执行性，能被现有 Web 测试智能体有效执行。

**任务二**

- **通过率与稳定性**：提升智能体执行测试场景的准确率，简单、中等难度场景能正确通过，甚至通过部分困难场景；也可考虑提升执行效率。
- **变异测试**：支持对测试场景进行变异，能识别典型的应用错误（执行异常、布局问题、语义错误等）。
- **结果验证**：能根据执行轨迹正确识别执行结果（成功与失败），对执行失败准确输出失败原因。

> 鼓励所有创新方法设计以及评估策略设计（评估方法与指标等）。

---

## 七、当前进展与路线

- [x] 收集目标应用源码（`4gaBoards/`）与官方文档（`4gaBoardsDocs/`）作为参考与知识来源。
- [x] 确定核心方向：自研交付、长上下文直填 > RAG、源码 + 手册双通道、ReAct 架构、对线上 Demo 测试。
- [x] 初始化本项目 git 仓库并关联远程：<https://github.com/Tm-Ys/4gaboards_agent_plus.git>
- [x] 任务一：功能点提取 + 结构化测试场景生成（长上下文直填；Python 原型 `scenario_generator/` + TS 移植 `app/`）。
- [ ] 任务一：功能点 / 测试场景的可视化展示（TS + Node）—— 暂缓。
- [~] 任务二：ReAct 智能体（规划/记忆/执行/验证）对 `demo.4gaboards.com` 执行测试。**P0–P3 + P1.5 + P4 + 领域工具扩展 + card 工具补全已完成**：基线 43% → settings 簇 68% → **P4 健壮性**（state 隔离 / 命名空间清理 / 拖拽 `card_drag`）+ **领域工具扩展**（A 层 8→18 工具）+ **card 工具补全**（A 层 18→**20**：`card_manage_labels` toggle/create/edit、`card_text_editor` switch_mode/resize/help）。card 补全五场景 **3/5**（switch-modes / resize / manage-labels-2 PASS）。+ **P5 变异测试**（Layer1 spec-sensitivity≈0% / Layer2 Mutation Score 33%）+ **P6 判官加固**（strict 判官变体 + 宽松代价三角：Layer1 lenient 0%→strict 57%，真实 PASS 率 46%→25%、strict 误杀 7）。下一步前端。
- [ ] 任务二（提升档）：场景变异与典型应用错误识别。

---

## 八、任务二实现方案

> **实现状态（2026-06）**：P0–P3 + P1.5 + **P4 + 领域工具扩展 + card 工具补全已完成**。Agent（Playwright + 两层工具 + function-calling）、
> 独立 LLM 判官、批量 harness、健壮性地基（state 隔离 / 命名空间清理 / 拖拽）全部就绪。基线 43% → settings 簇 **84%**。
> **P4 + 工具扩展**：A 层 8→**18 工具**——card/view 前置+编辑（`card_open` / `view_switch` / `card_edit_description`）、list 簇列操作（`list_view_menu_action` / `toggle_column` / `sort`）、card 详情（`card_menu_action` / `edit_title` / `manage_comments` / `toggle_section`）。
> **card 工具补全**：A 层 18→**20 工具**——`card_manage_labels`（toggle/create/edit；4gaBoards 标签是彩色按钮，选中=nameActive 类，状态经 socket 往返需轮询）+ `card_text_editor`（switch_mode 点工具栏模式按钮 / resize 拖 `.w-md-editor-bar` / help）。五场景验证 **3/5 PASS**（switch-modes / resize / manage-labels-2）。
> 下一步 P5 变异 + 前端。
> 运行：`cd app && npm run run-scenario -- --id <id>` / `npm run run-batch -- --feature card --difficulty easy`。

任务二 = **ReAct 智能体**消费任务一的 `TestScenario`，在 `demo.4gaboards.com` 端到端执行，
用 **LLM-as-judge** 判定通过/失败。核心 headless，产出结构化轨迹与结果，供前端渲染。

**架构**：ReAct 循环（观察 → 思考 → 执行）+ **两层工具** + 原生 function calling（DeepSeek 支持）：

- **A 层 · 领域工具**：照 4gaBoardsDocs 写、按任务一模块组织（auth / board / list / card / view / settings …），每个对应一项文档能力；**驱动真实 UI**（点真按钮、填真表单），返回结构化领域状态。
- **B 层 · 通用浏览器工具**：`click / fill / press / scroll / goto / observe / done`，兜底 A 层未覆盖的步骤；`observe()` 即观察本身。
- **观察空间**：文本可访问性树（AX tree）+ 元素 ref，**模型无关**（适配 DeepSeek 文本模型）；截图作为可选 VLM 增强。

**两条底线（端到端测试有效性）**：
1. 被测动作必须走**真实 UI**，不得用后端 API 走捷径；**后端 API 仅用于前置数据准备**（登录态、播种数据）。
2. 验证看**真实渲染页**（AX/截图），不只信工具返回的"成功"——这样才能抓布局/语义错误。

**四要素**：规划（场景 `phases` 作计划骨架）/ 记忆（短期轨迹 + scratchpad）/ 执行（Playwright 工具执行器）/ 验证（两层 LLM judge：步骤检查点 + 场景终判）。

**路线**：✅ P0 浏览器地基 + 工具框架 → ✅ P1 跑通 happy_path → ✅ P1.5 设置簇工具（settings 84%）→ ✅ P2 judge → ✅ P3 批量 harness + 通过率报告 → ✅ P4 健壮性（state 隔离 / 拖拽 / 清理）+ 领域工具扩展（A 层 8→18 工具）→ ✅ card 工具补全（A 层 18→20 工具，5 场景 3/5）→ ✅ P5 变异测试（Mutation Score 33%，判官 oracle 评估）→ ⬜ 前端（牛皮纸看板风交互控制台，见末尾「今日进度」）。

> 完整设计（两层工具架构、目录设想、已知难点、底线细则）见 [CLAUDE.md](CLAUDE.md)「任务二实现方案」。

---

## 九、相关链接

- 本项目仓库：<https://github.com/Tm-Ys/4gaboards_agent_plus.git>
- 目标应用源码（仅参考）：<https://github.com/RARgames/4gaBoards>
- 目标应用文档源（仅参考）：<https://github.com/RARgames/4gaBoardsDocs>
- 用户手册站：<https://docs.4gaboards.com/>
- 应用 Demo：<https://demo.4gaboards.com/>

---

## 今日进度（2026-06-18）

**今天干了什么**

- **P5 变异测试完成并提交（`460241f`）**：给独立 LLM 判官打分（被测 = 判官，app 恒正确），新增 `app/src/agent/mutation/` + CLI `npm run run-mutation -- --layer spec|trace`。
  - **Layer 1**（改 expectation，真跑正确 app，重判官）= **spec-sensitivity ≈ 0%**——判官无视 expectation、靠 title+steps+trace 推断核心目标；把 title+desc+expectation+steps 整体改成另一目标也 0/3 全存活，且会**主动推翻亲眼看到的 spec 矛盾**（自述「实际选了 Simple 而非指定的 Kanban，但核心目标达成」）。
  - **Layer 2**（往真实轨迹注入故障、用原场景重判官）= **Mutation Score 3/9 (33%)**——判官做**多源证据和解**，单个失败步骤会被幸存证据救回（card-create 自述「card_create 首次失败，但列表卡片数 2→3，创建成功」）。薄证据/单动作场景（list-sort / settings-theme / sidebar-toggle）**100% killed**；富证据/多步（board / card / view / notifications）**0%**。
  - **结论**：判官「**不查规约、查行为；行为故障的检出依赖证据是否冗余**」——富证据场景要所有证据通道同时失败才会 FAIL。

**前端组织方案（讨论定型，下次开工用）**

- **定位**：交互控制台——浏览任务一 catalog、触发并实时看任务二场景执行（ReAct 轨迹）、触发并看 P5 变异分数；答辩演示用。
- **栈**：Vite + React + TS（前端）+ Node 后端（Hono，SSE 流式进度），复用现有 TS 函数、不 shell CLI。
- **视觉**：看板风结构（三列 任务一 / 任务二 / P5，每场景一张卡，贴合被测 4gaBoards）+ **Claude 牛皮纸皮肤**（暖黄牛皮纸底 + 衬线细字体 + Claude 橘土点缀）。
- **复用点**：`loadScenarioSet`（catalog）、`runScenario`（需给 `runReactLoop` 加 `onStep` 回调，唯一要改的现有代码）、`runMutation`/`runMutationTrace`（已有 `onMutant`/`onScenario`/`onFault` 可喂 SSE）、读 `outputs/runs` + `outputs/mutation` 已有报告。
- **约束**：单账号串行（全局 in-flight 锁）；批量只支持加载已有报告、不实时跑。
- **分期**：① 先做只读牛皮纸看板外壳（catalog + 已有报告）锁样式；② 再加 Node 后端 + SSE + Run 按钮做交互。

**Skill（`ConardLi/garden-skills`，下次用）**

- **`web-design-engineer`** ✅：前端 build 阶段用，HTML/CSS/JS/React 出「惊艳级」页面，自带 style-recipes 风格锚点，适合定制「牛皮纸看板」皮肤。装法：把该仓库作为 plugin 加到 `.claude/`。
- `beautiful-article`：下次若要精美 HTML 报告可用（任意素材 → 精美文章；本次未用，今日进度走 Markdown）。

---

## P6 判官加固（2026-06-18 续）

**今天又干了什么**（在 P5 基础上，处理「P5 后可选项」之判官加固）：

- **strict 判官变体 + 宽松代价量化**：新增逐条核对 expectation 的 strict 判官（`judge.ts` 加 `JudgeMode`：终态优先历史不救 + must-have/nice-to-have 分类 + 状态可表达性降级 + 跨语言强映射），与既有宽松 lenient 并存、默认 lenient 不破坏既有行为。
- **`--judge both` 两判官对比**：runner 加 `baselineOverride` 复用基线 trace（浏览器只跑一次、判官跑两遍）；`report.ts` 加 `compareJudges`（strict-only kills = 宽松漏检锚点）。
- **实测（Layer1 board-create-happy-path）**：lenient **0/14（must-kill 0%）** → strict **8/14（must-kill 38%）**。按算子 entity-swap 0→67%、state-swap 0→100%、soft 类 0→75-100%；**negate 0→0%（strict 弱点，取反类仍漏，待 prompt 调优）**。
- **宽松代价（30 场景零浏览器重判）**：真实 PASS 率 lenient **46%** / strict **25%**，**strict 误杀 7 个真实通过（-21pp）**。误杀里 ~2 个是真问题（board-view-toggle 终态视图、board-export-csv 操作路径偏离）、~5 个 strict 太严（headless 下载无 UI 提示 / 终态本就该关 / demo 无数据）。
- **健壮性修复**：DeepSeek 偶发畸形 JSON 曾让 `--judge both`（调用翻倍）整批崩 → `chatJson` 加 3 次重试 + 变异体/故障循环单条容错（跳过失败项不崩、不丢已跑结果）。
- 代码：`verify/judge.ts` + `mutation/{runMutation,runMutationTrace,report}` + `cli/{run-mutation,run-judge-cost}` + `llm.ts`。CLI `npm run run-mutation -- --judge both` / `npm run run-judge-cost -- --batch <report>`。

**结论**：宽松判官（lenient）高通过率但零规约敏感（Layer1 0%）；严格判官（strict）有规约敏感（Layer1 must-kill 38%）但误杀真实通过（-21pp）——这张 trade-off 三角表就是「宽松代价」的量化交付，对应评分标准「结果验证」提升档。
