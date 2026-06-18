# 4gaBoards 智能测试工具 · 技术报告

> 基于大模型的**测试场景自动生成 + 智能测试执行**工具，目标应用 [4gaBoards](https://github.com/RARgames/4gaBoards)（开源看板 Web 应用）。
> 本报告为答辩 PPT 的素材源。

---

## 摘要

本项目针对 Web Agent 在复杂 Web 应用测试中**失败率高**的问题（业务逻辑领域化、大模型幻觉、执行结果难判定）。通过「**用户手册 → 测试场景自动生成 → ReAct 智能体自主执行 → 独立判官验证**」的全自动闭环，在 4gaBoards demo 站上端到端测试。

- **任务一**：从手册提取 **118 个功能点**、生成 **179 个结构化测试场景**（100% 覆盖）；
- **任务二**：ReAct 智能体配 **20 个领域工具** + **独立 LLM 判官**执行，并用**变异测试**评估判官质量（双档判官量化「宽松代价」）；
- **前端**：牛皮纸看板控制台可视化，实时看 agent 边想边做边判。

---

## 一、项目背景与目标

### 1.1 问题
Web Agent 在 WebArena 等基准上失败率高，原因：
1. Web 应用业务逻辑复杂且高度领域化；
2. 大模型存在幻觉，缺乏待测应用领域知识；
3. 难以在执行后准确判定任务是否成功（**test oracle 问题**）。

### 1.2 思路
软件文档（用户手册）蕴含大量业务知识，可帮 Agent 理解功能、判断结果。本项目：
1. 自动提取手册知识 → 生成功能覆盖全面、粒度适宜、**可执行**的测试场景；
2. 基于大模型智能体，自主执行场景并判定通过/失败。

### 1.3 目标应用
[4gaBoards](https://github.com/RARgames/4gaBoards)（开源看板 Web 应用），对其 [demo 站](https://demo.4gaboards.com) 测试（不需本地部署）。

---

## 二、整体架构

三阶段闭环：

```
用户手册 ──任务一──▶ 测试场景 ──任务二──▶ 执行轨迹 ──判官──▶ PASS/FAIL
(4gaBoardsDocs)    (179 场景)   (ReAct+Playwright)  (独立 LLM)
                                            │
                                            ▼
                                    变异测试评估判官
```

**技术栈**：TypeScript 主交付（`app/`）+ Python 原型（`scenario_generator/`）；大模型 **DeepSeek V4 Flash**（OpenAI 兼容）；浏览器自动化 **Playwright**；前端 **Vite + React + Hono**。

---

## 三、任务一：测试场景自动生成

### 3.1 知识源（双通道）
- **用户手册** `4gaBoardsDocs/docs/*.md`：account/project/board/list/card/view/sidebar/notifications/settings/import-export/shortcuts 等；
- **源码** `4gaBoards/`：理解真实接口与数据模型（REST API 结构）。

### 3.2 检索策略：长上下文直填 > RAG
本项目场景下 RAG 效果不佳——它会检索到**语义相近但不相同**的内容，反而引入噪声。由于所用大模型具备 **1M 上下文**，生成时**直接把对应文档整段送入上下文**，而非向量检索。（`.env` 保留 `RETRIEVER_MODE` 备对比实验。）

### 3.3 生成流程
1. **功能点提取**（`extractFeatures.ts`）：按模块（每篇功能文档）提取，逐模块出功能点后合并去重。**合并同族微操作**（如富文本工具栏按「能力」归并，不逐按钮拆分；快捷键集合、同质设置开关同理）。
2. **场景生成**（`generateScenarios.ts`）：按功能点，把「功能点 + 来源文档全文」送 LLM，产出结构化场景。每个功能点产 1~3 个场景（必含 happy_path，文档支撑时补 variant/edge_case）。

### 3.4 场景格式（测试预言）
```
测试场景 = [ [step]+ [expectation]? ]+
```
- **step**：具体 UI 操作（点击/输入/拖拽/选择/快捷键），引用真实元素名；
- **expectation**：预期状态（**测试预言**），含可观察的 `key_features`（出现的元素、文本、状态、数值变化）。
- 一个场景可含多个「步骤组 + 检查点」段落，在关键节点验证中间状态。

### 3.5 成果
- **118 个功能点 / 179 个测试场景 / 100% 功能覆盖**；
- 场景粒度适中、可执行（能被任务二实际跑起来）；
- 固化为默认场景集 `basic`（入库），任务二无需每次重新生成。

---

## 四、任务二：ReAct 测试智能体

### 4.1 ReAct 架构
**观察 → 思考（选工具）→ 执行（tool call）→ 观察** …… 直至 `done` 或步数上限（≤20/场景）。用**原生 function calling**（DeepSeek 支持）。

### 4.2 两层工具设计
- **A 层 领域工具（20 个）**：照 4gaBoards 文档写、按模块组织（auth/board/list/card/view/settings），每个对应一项文档能力，**驱动真实 UI**（点真按钮、填真表单），返回结构化领域状态。
- **B 层 通用浏览器工具**：`click / fill / press / scroll / goto / observe / done`，兜底 A 层未覆盖步骤；`observe()` 即观察本身。

> **docs→tools 桥（创新点）**：任务一的 118 个功能点基本就是工具清单，可从 feature catalog 自动脚手架工具 stub（name 取 feature id、params 从 key_elements 推），Playwright handler 人工补。这是 Task1→Task2 的干净闭环。

### 4.3 观察空间：文本可访问性树（AX tree）
把页面渲染成「文本 AX 树 + 元素 ref」，**模型无关**（适配 DeepSeek 文本模型，不依赖 VLM）。每个可交互元素形如 `[ref] role "name"`。截图作为可选 VLM 增强。

### 4.4 四要素落地
| 要素 | 实现 |
|---|---|
| **规划** | 场景 `phases[]` 是高层计划骨架；Agent 维护 step 指针，把抽象步骤操作化为工具调用 |
| **记忆** | 短期轨迹（thought/action/observation）+ scratchpad（记本场景创建资源名，便于验证/清理） |
| **执行** | Playwright 工具执行器；元素找不到/超时作为 observation 反馈回去 |
| **验证** | **独立 LLM 判官**（两层：步骤检查点 + 场景终判 PASS/FAIL + 失败定位 + 原因） |

**两条底线**（端到端测试有效性）：
1. 被测动作**必须走真实 UI**，不得用后端 API 走捷径（API 仅用于前置数据准备/清理）；
2. 验证看**真实渲染页**（AX/截图），不只信工具返回的"成功"——这样才能抓布局/语义错误。

### 4.5 独立 LLM 判官（核心）
**独立于执行 agent**：`transcript` 只呈现**事实**（动作+结果+每步观察+终态），**不含 actor 思考/自评**，避免执行者自我合理化污染判定。证据不截断（DeepSeek 上下文充裕）。

**两档严格性**（`JudgeMode`）：
- **lenient**（默认，P0–P5 既有）：抓实质不死抠字面，expectation 当参考线索，核心目标达成即 PASS。
- **strict**（P6 新增）：逐条核对 `key_features`，must-have 矛盾即 FAIL；**终态优先、历史步骤成功不救终态缺席**；状态可表达性降级（控制误杀）。

### 4.6 变异测试（P5，oracle 评估）
给独立判官打分（**被测 = 判官，app 恒正确**）：
- **Layer1（改 expectation，真跑正确 app，重判官）= spec-sensitivity ≈ 0%**——判官无视 expectation、靠 title+steps+trace 推断核心目标，goal-level 全改也存活。
- **Layer2（往真实轨迹注入故障，用原场景重判官）= 3/9 (33%)**——判官做**多源证据和解**，单步失败被幸存证据救回。薄证据/单动作场景 100% killed，富证据/多步 0%。
- **结论**：判官「**不查规约、查行为；行为故障检出依赖证据是否冗余**」。

> 用**复用轨迹模型**（1 次真跑 + N 次重判）隔离判官，不重跑浏览器。

### 4.7 判官加固（P6，量化宽松代价）
- **strict 判官变体**：逐条核对 + 终态优先 + must-have/nice-to-have 分类 + 跨语言强映射。
- **实测 Layer1 board-create**：lenient **0/14（must-kill 0%）** → strict **8/14（must-kill 38%）**。entity-swap 0→67%、state-swap 0→100%、soft 类 0→75-100%；negate 仍 0%（弱点）。
- **宽松代价**（30 场景零浏览器重判）：真实 PASS 率 lenient **46%** / strict **25%**，**strict 误杀 7 个真实通过（-21pp）**——约 2 个真问题 + 约 5 个 strict 太严。

### 4.8 健壮性（P4）
- **状态隔离**：每场景恢复账号级 state（如语言），settings 簇 68%→**84%**；
- **命名空间 + REST 清理**：按 `ns-` 前缀删测试 board/project；
- **拖拽**：react-beautiful-dnd mouse 多步 move（看板核心交互，非 click/dragAndDrop）。

### 4.9 通过率
- **基线 43%**（30 easy+happy_path）：board 5/5、admin 3/3、account 1/1 全过；**instance 设置开关 0/13**（demo 站 demoMode 物理禁用，环境受限）；
- 去掉环境受限的 instance 簇，**可测场景 lenient 通过率 ~80%**。

---

## 五、可视化前端：牛皮纸看板控制台

Vite + React + TS（前端 `app/web/`）+ Hono SSE 后端（`app/server/`，复用现有 TS 函数、不 shell CLI）。

**三列看板**（贴合被测 4gaBoards 看板风）：
- **任务一**：场景 catalog（搜索/选择）+ 重新生成场景按钮；
- **任务二**：Run 实时轨迹（onStep SSE，答辩高潮）+ 全量测试（难度筛选/进度条/每步）+ batch 报告加载；
- **任务三**：变异测试（layer spec/trace × judge lenient/strict/both）+ 宽松代价三角。

**牛皮纸皮肤**：暖黄牛皮纸底 + 衬线 Source Serif 标题 + Claude 橘土点缀（web-design-engineer skill）。

**实测** board-create Run SSE：6 步 PASS（observe → click Add Board → board_create 一步创建 → confirm → done，65s，判官 high-confidence PASS）。

---

## 六、关键技术决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | **交付自研**，不抄上游 | 4gaBoards 源码/文档只作参考，本项目代码全自研 |
| 2 | **长上下文直填 > RAG** | RAG 引入语义近似噪声；1M 上下文够用 |
| 3 | **ReAct 架构** | 推理+执行交替，适配 Web 测试的探索性 |
| 4 | **两层工具**（领域+通用） | 领域工具稳（一步完成多步功能）、通用兜底 |
| 5 | **独立 LLM 判官** | 避免 actor 自评偏差；判官只看事实 |
| 6 | **国产模型 DeepSeek** | OpenAI 兼容、成本低、function calling 支持 |

---

## 七、实验结果汇总

| 维度 | 结果 |
|---|---|
| 任务一 场景生成 | **118 功能点 / 179 场景 / 100% 覆盖** |
| 任务二 基线通过率 | 43%（easy+happy_path） |
| 可测场景通过率 | **~80%**（去环境受限 instance 簇） |
| settings 簇（P4 后） | **84%** |
| Layer2 变异 Mutation Score | 33%（薄证据 100% / 富证据 0%） |
| Layer1 strict must-kill | **0% → 38%**（vs lenient） |
| 宽松代价 | strict 误杀 7 个真实通过（**-21pp**） |

---

## 八、创新点

1. **docs→tools 桥**：任务一 feature catalog 自动脚手架任务二工具 stub，Task1→Task2 干净闭环。
2. **独立判官 + 变异测试评估 oracle**：用变异测试给判官打分（被测=判官），量化判官质量——把「判官准不准」从主观变可测。
3. **双档判官量化宽松代价**：lenient vs strict，trade-off 三角表（通过率 ↔ 规约敏感）。
4. **复用轨迹模型**：1 次真跑 + N 次重判，隔离判官、省浏览器开销。

---

## 九、不足与展望

- **环境受限**：instance 簇被 demo 站 demoMode 物理禁用（已诚实文档化，转向 preferences 簇）。
- **判官弱点**：strict 的 negate 类仍 0%（取反类漏检，待 prompt 调优/规则双通道）；富证据场景变异检出低（要全通道失败才 FAIL）。
- **展望**：规则启发式双通道补存在性核对；manage-labels-1 复杂编排优化；前端实时变异/judge-cost 交互增强。

---

## 附：运行入口

```bash
cd app
npm run extract && npm run scenarios                              # 任务一：生成场景
npm run run-scenario -- --id board-create-happy-path              # 任务二：单场景（含判官）
npm run run-batch -- --difficulty easy --tag happy_path --limit 30 # 任务二：批量+通过率
npm run run-mutation -- --layer trace                             # P5 变异测试
npm run run-mutation -- --layer spec --judge both                 # P6 两判官对比
npm run run-judge-cost -- --batch outputs/runs/batch-*.json       # P6 宽松代价三角
npm run dev                                                       # 前端控制台 → http://localhost:5173
```

报告落 `TECHNICAL_REPORT.md`；轨迹/报告落 `app/outputs/`（gitignored）；详细设计见 `CLAUDE.md`。
