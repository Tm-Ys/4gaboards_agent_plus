# Task1 / Task2 增强：原子操作依赖 + Baseline 基线


## 零、全局技术栈约束

本项目已确定的技术选型。**所有新增代码必须沿用现有栈，不得引入新语言/框架/构建工具。**

### 语言与运行时

| 组件 | 语言 | 运行时 | 包管理 |
|------|------|--------|--------|
| 主交付程序 `app/` | TypeScript | Node.js >= 20 | npm |
| 前端 `app/web/` | TypeScript + React | Vite 开发服务器 | npm |
| 后端 `app/server/` | TypeScript + Hono | tsx 直接执行 | npm |
| Python 原型（仅甲涉及） | Python 3.12+ | uv | 见下方 uv 要求 |

### TypeScript 侧关键依赖

| 包 | 用途 |
|----|------|
| `openai` | LLM 调用（DeepSeek，OpenAI 兼容接口） |
| `playwright` | 浏览器自动化 |
| `zod` | 数据校验 / schema 定义 |
| `dotenv` | `.env` 加载 |
| `undici` | HTTP 代理（ProxyAgent） |
| `tsx` | TypeScript 直接执行（不编译） |
| `concurrently` | 并行运行多个 npm script |

### TypeScript 运行方式

- 脚本入口全部用 `tsx` 直接执行，**不需要 `tsc` 编译**，**不需要 webpack/esbuild 打包**。
- 类型检查用 `npm run typecheck`（即 `tsc --noEmit`，仅检查不产出）。
- 前端 `app/web/` 用 Vite 构建，开发时 `npm run dev` 启动 Vite + Hono 双服务器。
- 新增 npm script 在 `app/package.json` 中注册，格式参照现有 `"extract": "tsx src/extractFeatures.ts"`。

### Python 侧要求（仅甲涉及）

- **必须使用 `uv`**，不得用 `pip`、`conda`、`poetry` 等。
- 如果本地未安装 `uv`：
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
- 工作流：
  ```bash
  cd scenario_generator
  uv venv                           # 创建虚拟环境
  source .venv/bin/activate         # 激活（macOS/Linux）
  uv pip install -e .               # 安装项目依赖
  uv pip install httpx pydantic python-dotenv  # 按需加包
  ```
- `uv` 依赖声明在 `pyproject.toml` 的 `[project].dependencies` 中。如需加新依赖，编辑 `pyproject.toml` 后 `uv pip install -e .`。

### 外部约束

- **LLM 模型**：DeepSeek V4 Flash（`deepseek-v4-flash`），OpenAI 兼容接口。API key 在 `.env` 的 `DEEPSEEK_API_KEY`。`chatJson` 函数封装在 `app/src/llm.ts`，内置 JSON 解析 + 重试。
- **被测站点**：`demo.4gaboards.com`（线上共享 Demo，非本地部署）。被测动作必须走真实 UI（Playwright），**不得用后端 API 走捷径**。后端 API 仅可做前置数据准备（登录态注入）和收尾清理（REST API 删除 project/board）。
- **参考目录**：`4gaBoards/`、`4gaBoardsDocs/` 是只读参考。**不要修改**这两个目录里的文件，**不要**直接复用其源代码。

### 环境变量

- 根目录 `.env` 包含所有密钥和配置。用 `dotenv`（Node）或 `python-dotenv`（Python）加载。
- `.env` 绝不提交 git。新增密钥后同步脱敏模板到 `.env.example`。
- 读取方式：TypeScript 中 `import "dotenv/config"; process.env.XXX`；Python 中 `from dotenv import load_dotenv; load_dotenv(); os.getenv("XXX")`。


---

## 一、项目是干什么的

本项目是一个课程实践课题：**基于大模型的测试场景自动生成 + 智能测试执行工具**，目标应用是 [4gaBoards](https://github.com/RARgames/4gaBoards)（一个开源的看板 Web 应用）。

整个管道分两步：

- **Task1（生成）**：读取 4gaBoards 的用户手册文档，让 LLM 提取出所有可测试的功能点（FeaturePoint），再为每个功能点生成结构化的浏览器自动化测试场景（TestScenario）。
- **Task2（执行）**：基于 ReAct（推理+行动）的 Web 测试智能体，用 Playwright 在 `demo.4gaboards.com` 上实际执行 Task1 产出的测试场景，并由独立的 LLM 判官给出 PASS/FAIL 结论。

目前在 `app/outputs/basic/` 里固化了 118 个功能点、179 个测试场景，Task2 的 Agent、判官、批量执行、变异测试等功能均已完成。本次改动旨在让 Task1 的数据更结构化（加依赖关系），从而让 Task2 的执行更自动化（自动处理前置、按模块跑测试链）。


## 二、为什么要做这件事

### 当前的问题

现在 Task1 生成了 118 个功能点（FeaturePoint）和 179 个测试场景（TestScenario）。但这些功能点是**扁平的**——没有跨功能点的依赖关系。

比如 `board_delete`（删除看板）这个操作，前置条件是"要有一个看板"——你得先跑 `board_create` 把它建出来。但 `board_delete` 的 FeaturePoint 里完全没有指向 `board_create` 的结构化引用，只是在场景的 `preconditions` 里有一段自然语言描述："已存在一个待删除的看板"。

Task2 的 Agent 拿到这个场景，直接执行时发现没看板可删，当场失败。

### 本次改动的目的

**给每个功能点标注"前置操作"的依赖关系**，然后在 Task2 执行时：

1. **Layer 1（逐项测试）**：跑 `board_delete` 之前，自动先跑 `board_create`，再跑 `board_delete`。每个原子操作都不再有"缺前置"的问题。

2. **Layer 2（按元件组装测试链）**：把同一模块（如 card 模块）的所有功能点按依赖顺序串联，跑完一条链 = 该模块的完整测试。比如 card 链：`board_create → card_create → card_edit → card_move → ... → card_delete`。

3. **Baseline（全局基线路径）**：设计一条从登录到"看板+列表+卡片就绪"的全局基线。跑完之后页面就处于一个稳定的测试起点，后续几乎所有操作的测试都直接在这个起点上行事，不再重复建资源。Baseline 分两层：
   - `P0`：登录（整个 session 只跑一次）
   - `P1`：创建项目 → 创建看板 → 创建多个列表 → 创建多张卡片（页面被污染了可以清理后重跑）

---

## 三、讨论过程摘要

> 每次讨论的设计结论，供理解"为什么是这个方案"。

### 讨论 1：要不要新增一个 `AtomicOperation` 实体？

现有 `FeaturePoint` 粒度已经足够原子化（`board-create`、`card-delete` 等），不需要新增第三个实体类型。直接增强 FeaturePoint 加一个 `prerequisite_feature_ids` 字段即可。

### 讨论 2：要不要引入图数据库？

不需要。118 个节点、约 200 条边，用一个 `Map<string, Set<string>>` 的邻接表在内存里就能装下。需要的算法只有拓扑排序和传递闭包，约 100 行 TypeScript 代码搞定。

### 讨论 3：要不要加 `category` 分类字段？

不需要。现有 `module` 字段已经是分类——`module` 直接对应 4gaBoardsDocs 的文档文件（`board.md`、`card.md`），天然就是 Layer 2 测试链的分组依据。

### 讨论 4：happy_path 的重新定义

现在的 `happy_path` 其实是**单功能点的测试场景**（比如 `card_create` 的 happy_path 是"创建一张卡片"），不是一条"路径"。

我们希望的设计：
- 全局只有**一条 Baseline 路径**：登录 → 项目 → 看板 → 多个列表 → 多张卡片。命名资源用 `happy_path_yyyymmdd_hhmm` 前缀。
- 其他所有功能点的测试都**基于 Baseline 已就绪**。比如测 `card_edit`，Agent 先在页面上确认 Baseline 特征存在（有 `happy_path_` 前缀的看板/卡片），有就直接开测，没有就重跑 Baseline/P1。
- 每个 FP 的 scenario 不需要在 preconditions 里重复描述"已登录、已有看板"——改为引用 baseline 即可。

### 讨论 5：双层 Tag 体系

场景的 `tags` 字段现有的值：`happy_path`、`variant`、`edge_case`、`error_handling`。本次新增基线标记：

| Tag | 含义 |
|-----|------|
| `baseline/P0` | 不可逆操作，整个 session 只跑一次（目前只含 auth_login） |
| `baseline/P1` | 可重跑的资源创建（project_create、board_create、list_create、card_create） |
| `happy_path` | 功能点的主流程（依赖 baseline 就绪） |
| `variant` | 变体路径 |
| `edge_case` | 边界场景 |
| `error_handling` | 异常处理 |

一个场景可以同时带多个 tag，比如 `board_create` 的 happy_path 场景同时打 `baseline/P1` 和 `happy_path`。

### 讨论 6：Buffer 层要不要？

不需要。浏览器页面本身就是 Buffer。页面上的 DOM 是唯一的真相源——card_create 跑完之后，卡片就在页面上了，后续操作直接找它。

唯一需要全局标记的是 `login_flag`（登录是否已完成），因为登录是 P0 不可逆的。

### 讨论 7：LLM 提取是一次性的

依赖推理是 LLM 一次性完成的工作，跑完产出的 `features.json` 就是静态数据。Task2 运行时直接读 JSON，不再调 LLM 推理依赖。

### 讨论 8：Baseline Pre-check 用轻量 DOM

判断页面是否符合 baseline 特征不需要调 LLM——直接用 Playwright 的 `page.locator` 找含 `happy_path_` 命名前缀的看板 DOM 元素。找到 → 基线就绪；找不到 → 重跑 baseline/P1。

### 讨论 9：Baseline 中卡片数量和分布由 Runner 控制

`baseline.json` 描述要求（如"3 张卡片、跨 2 个列表"），runner 在执行时传参控制 domain tool（`card_create`）的执行次数和参数。不要试图在生成的 scenario 步骤里硬编码数量。

---

## 四、涉及的文件

```
app/src/
├── schemas.ts                    # 改：FeaturePoint 加 prerequisite_feature_ids
├── scenarioStore.ts              # 读：不变，无需改动
├── generateScenarios.ts          # 改：prompt 加 happy_path 质量约束
│
├── agent/
│   ├── runner/
│   │   ├── runScenario.ts        # 改：支持 autoSetup 选项
│   │   ├── runBatch.ts           # 改：支持 --module 按元件跑链条
│   │   └── runBaseline.ts        # 新：P0/P1 执行 + DOM pre-check
│   │
│   └── dependencyGraph.ts        # 新：DAG 工具类（拓扑排序、传递闭包）
│
├── inferDependencies.ts          # 新：LLM 读全部 FP → 推理依赖 + baseline 打标
│
├── outputs/
│   └── basic/
│       ├── features.json         # 改：含 prerequisite_feature_ids
│       ├── scenarios.json        # 改：含 baseline/P0, baseline/P1 tag
│       └── baseline.json         # 新：基线场景引用序列
│
└── cli/
    └── run.ts                    # 改：支持 --module

scenario_generator/src/scenario_generator/
└── schema.py                     # 改：与 schemas.ts 同步
```

---

## 五、分工

### 甲：数据层（Schema + 依赖推理 + DAG 工具）

**工作内容**：
1. 修改 `schemas.ts`：`FeaturePointSchema` 加 `prerequisite_feature_ids: z.array(z.string()).default([])`
2. 同步修改 `scenario_generator/src/scenario_generator/schema.py`
3. 编写 `inferDependencies.ts`：LLM 一次性推理全部 FP 的依赖关系 + baseline 打标
4. 编写 `dependencyGraph.ts`：邻接表 DAG 工具类
5. 编写 `baseline.json`：基线场景引用序列
6. 更新 `generateScenarios.ts` prompt

**交付物**：`features.json`（含 prerequisite）、`scenarios.json`（含双层 tag）、`baseline.json`、`dependencyGraph.ts`

**Skill requirement**：TypeScript、LLM prompt 工程

---

### 乙：执行层（Runner + Baseline 执行 + Task2 集成）

**工作内容**：
1. 编写 `runBaseline.ts`：执行 P0/P1 基线路径，含 DOM pre-check
2. 修改 `runScenario.ts`：加 `autoSetup` 选项，利用 `dependencyGraph` 自动跑前置
3. 修改 `runBatch.ts`：加 `--module` 参数支持按元件跑链条
4. 修改 `cli/run.ts`：加 `--module` 参数

**交付物**：`runBaseline.ts`、改好的 `runScenario.ts`、`runBatch.ts`、`cli/run.ts`

**Skill requirement**：TypeScript、Playwright、Task2 Agent 流程理解

---

## 六、甲的工作细则

### 6.1 修改 schemas.ts

**文件**：`app/src/schemas.ts`

**改动**：在 `FeaturePointSchema` 中新增一个字段：

```typescript
export const FeaturePointSchema = z.object({
  id: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string(),
  source_files: z.array(z.string()).default([]),
  source_section: z.string().default(""),
  key_elements: z.array(z.string()).default([]),
  difficulty: z.string().default("easy"),
  // ↓↓↓ 新增 ↓↓↓
  prerequisite_feature_ids: z.array(z.string()).default([]),
});
```

现有字段和顺序不要动，只在末尾追加。`prerequisite_feature_ids` 的值是其他 FeaturePoint 的 `id`，例如 `card_delete` 的值为 `["board_create", "card_create"]`。

**同步修改 Python 版**：`scenario_generator/src/scenario_generator/schema.py` 对应的 Pydantic model 也加 `prerequisite_feature_ids: list[str] = []`。

### 6.2 编写 inferDependencies.ts

**文件**：新建 `app/src/inferDependencies.ts`

**目标**：读现有的 `features.json`（118 个 FP），全部喂给 LLM，一次调用完成两件事：
1. 推理每个 FP 的 `prerequisite_feature_ids`
2. 判定哪些 FP 的 happy_path 场景属于 `baseline/P1`

**为什么需要 LLM**：依赖关系无法全部用代码硬编码。例如 `card_move` 依赖 `card_create` 和 `board_create`（需要有卡片和多个列表），这个规则需要阅读文档内容才能判定。但 118 个 FP 并不大，一次 LLM 调用就能全量处理。

**入口**：新增 npm script `"infer-deps": "tsx src/inferDependencies.ts"`

**实现要点**：

1. 从 `app/outputs/basic/features.json`（或 `--features` 参数指定）读取全部 FeaturePoint
2. 构造 LLM prompt：

```
你是 4gaBoards 测试架构师。下面是该应用的全部功能点列表（JSON 数组）。
请为每个功能点推理它的前置依赖。

【依赖规则】
- 注册/登录操作（account 模块）没有依赖
- 结构层严格按顺序：project_create → board_create → list_create → card_create
- create/read/update/delete 模式：delete 依赖 create，edit 依赖 create，reorder 依赖 create
- 导航/入口类：进入某个设置页面的操作依赖登录（auth_login）
- 弹窗/面板操作：依赖入口功能点（如 card_menu_action 依赖 card_open）
- instance 设置类不依赖项目/看板，只依赖登录 + admin 权限
- list-view 操作依赖 board_create + view_switch（切到列表视图）
- 侧边栏操作依赖登录 + 至少有一个 project/board

【baseline 判定规则】
以下功能点的 happy_path 场景应标注 baseline/P1：
- project_create, board_create, list_create（且需要至少2个列表）, card_create（且需要至少3张卡片）
其余功能点不标 baseline tag。

【输出】严格输出 JSON，不要任何额外文字：
{
  "feature_points": [
    {
      "id": "board-create",
      "prerequisite_feature_ids": ["project_create", "auth_login"],
      "baseline_p1": true
    },
    ...
  ]
}
```

3. LLM 返回 JSON 后，将 `prerequisite_feature_ids` 写回每个 FeaturePoint
4. 将 `baseline_p1` 信息记录到另一个文件 `baseline_tags.json`，供乙在打场景 tag 时使用
5. 最终写出更新后的 `features.json`

**注意**：
- `chatJson` 函数在 `app/src/llm.ts` 中，用法见 `extractFeatures.ts`
- 如果 LLM 返回的 JSON 里有不存在的 feature id（幻觉），跳过并记录 warning
- 保留原有 features.json 的所有字段不动，只追加 `prerequisite_feature_ids`

### 6.3 编写 dependencyGraph.ts

**文件**：新建 `app/src/agent/dependencyGraph.ts`

**目标**：一个纯数据的工具类，不依赖 Playwright、不调 LLM。

**构造函数**：接收 `FeaturePoint[]` 数组，构建邻接表（`Map<featureId, Set<prerequisiteId>>`）。

**需要实现的方法**：

```typescript
class DependencyGraph {
  constructor(features: FeaturePoint[]);

  // 获取某个功能点的直接前置（一级依赖）
  getDirectPrerequisites(featureId: string): FeaturePoint[];

  // 获取某个功能点的全部传递前置（递归展开，拓扑排序后返回）
  // 例如 card_delete → [auth_login, project_create, board_create, card_create]
  getTransitivePrerequisites(featureId: string): FeaturePoint[];

  // 获取某个功能点的全部下游（"谁依赖我"）
  // 用于判断删掉我之后会不会影响别人
  getDependents(featureId: string): FeaturePoint[];

  // 获取某个模块的全部功能点，按拓扑序排列
  getByModule(module: string): FeaturePoint[];

  // 验证无环（DFS 检测）
  validateNoCycles(): boolean;

  // 按层级分组：[ [Layer0无依赖], [Layer1], ... ]
  getLayers(): FeaturePoint[][];
}
```

**拓扑排序算法**：Kahn 算法（BFS）或 DFS 后序遍历。注意可能有多个根节点（如 `auth_login` 和 `account_register_email` 都是根）。

**传递闭包**：DFS 从目标节点向上递归，收集所有祖先。注意去重和避免重复访问（visited set）。

### 6.4 编写 baseline.json

**文件**：新建 `app/outputs/basic/baseline.json`

**目标**：定义基线场景的引用序列。不是新生成场景，而是引用已有 scenarios.json 中的场景。

**格式**：

```json
{
  "description": "全局基线路径。P0 不可逆（只跑一次），P1 可重跑（清理后重建）。",
  "p0": [
    {
      "scenario_id": "auth_login的happy_path场景id",
      "feature_id": "account-login（或实际对应的feature id）",
      "purpose": "建立登录态"
    }
  ],
  "p1": [
    {
      "scenario_id": "project-create 的 happy_path 场景id",
      "feature_id": "project-create",
      "purpose": "创建项目容器",
      "namespace": true
    },
    {
      "scenario_id": "board-create 的 happy_path 场景id",
      "feature_id": "board-create",
      "purpose": "创建看板",
      "namespace": true
    },
    {
      "scenario_id": "list-create 的 happy_path 场景id",
      "feature_id": "list-create",
      "purpose": "创建列表 1",
      "params": { "listName": "List-A" },
      "namespace": true
    },
    {
      "scenario_id": "list-create 的 happy_path 场景id",
      "feature_id": "list-create",
      "purpose": "创建列表 2",
      "params": { "listName": "List-B" },
      "namespace": true
    },
    {
      "scenario_id": "card-create 的 happy_path 场景id",
      "feature_id": "card-create",
      "purpose": "在 List-A 创建卡片 1",
      "params": { "listName": "List-A" },
      "namespace": true
    },
    {
      "scenario_id": "card-create 的 happy_path 场景id",
      "feature_id": "card-create",
      "purpose": "在 List-A 创建卡片 2",
      "params": { "listName": "List-A" },
      "namespace": true
    },
    {
      "scenario_id": "card-create 的 happy_path 场景id",
      "feature_id": "card-create",
      "purpose": "在 List-B 创建卡片 3",
      "params": { "listName": "List-B" },
      "namespace": true
    }
  ]
}
```

**说明**：
- `scenario_id` 需从现有 `scenarios.json` 中找到对应场景的实际 id（如 `board-create-1`）
- 甲需要先查 scenarios.json 确定这些场景 id，填入 baseline.json
- P1 中同一个 `list_create` 场景被引用两次、`card_create` 三次——runner 会在不同参数下重复执行
- `namespace: true` 表示创建时用 `happy_path_yyyymmdd_hhmm` 前缀命名

### 6.5 Tag 场景（标记 baseline/P0、baseline/P1）

**目标**：给现有 scenarios.json 中对应的场景打上基线 tag。

具体需要打标：
- `auth_login` 的 happy_path 场景 → 加 `baseline/P0` tag
- `project_create`、`board_create`、`list_create`、`card_create` 的 happy_path 场景 → 加 `baseline/P1` tag

**实现方式**：在 `inferDependencies.ts` 中一并处理。LLM 返回的 `baseline_p1` 标记写到 `baseline_tags.json`，然后一个脚本读 scenarios.json，找到对应 FP 的 happy_path 场景，追加 tag。

或更简单：直接在 `inferDependencies.ts` 中硬编码——baseline 涉及的 FP 就那几个（project_create、board_create、list_create、card_create），直接在代码里枚举，去 scenarios.json 里找它们的 happy_path 场景并加 tag。

**注意**：tag 是 `string[]` 类型的数组，直接 `.push("baseline/P0")` 或 `.push("baseline/P1")`。

### 6.6 更新 generateScenarios.ts prompt（可选增强）

**当前问题**：生成的 happy_path 场景在步骤描述中硬编码了资源名（如 "点击看板'Test Board'"），这在 baseline 环境下无法使用（实际资源名叫 `happy_path_202606251430_board`）。

**改动**：在 system prompt 中加一条约束：

```
场景的 steps[].target 使用通用描述（如"目标看板"、"目标卡片"），
不要硬编码具体的资源名称。资源的实际名称由执行时注入。
expectation.key_features 也只描述可观察特征类别（如"看板名称可见"），
不写具体名称。
```

**但注意**：如果 domain tool 已经能处理命名（从 `ctx.namespace` 读取前缀），那这条 prompt 约束可选——不改也不影响 runner 正常工作。

### 6.7 验证

甲完成后应确认：
1. `npm run typecheck` 通过
2. `features.json` 里每个 FP 都有 `prerequisite_feature_ids` 字段（即使为空数组 `[]`）
3. `dependencyGraph.validateNoCycles()` 返回 `true`
4. `baseline_tags.json` 中有 5 个 FP（project_create、board_create、list_create、card_create + auth_login）被标记

---

## 七、乙的工作细则

### 7.1 理解现有 Task2 的执行流程

在读以下文件之前，先理解 Task2 的一个场景是怎么跑的：

```
runScenario(scenario)
  ├─ BrowserSession.launch()          // 启动 Playwright 浏览器
  ├─ registry.execute("auth_login")   // 登录
  ├─ runReactLoop(ctx, scenario)      // ReAct 循环：观察 → 选工具 → 执行 → 观察 → ...
  │     └─ 每步调 buildSystemPrompt(scenario) → LLM → tool call → 结果
  ├─ judgeScenario(scenario, trace)   // 独立判官打分 PASS/FAIL
  └─ session.close()                  // 关浏览器
```

关键文件：
- `app/src/agent/runner/runScenario.ts`：单场景执行入口
- `app/src/agent/runner/runBatch.ts`：批量执行入口
- `app/src/agent/react/loop.ts`：ReAct 循环（`runReactLoop`）
- `app/src/agent/react/prompt.ts`：LLM 系统提示构建
- `app/src/agent/tools/registry.ts`：工具注册（`registry.execute(name, args, ctx)`）
- `app/src/scenarioStore.ts`：加载场景集（`loadScenarioSet("basic")`）
- `app/src/agent/cli/run.ts`：CLI 入口
- `app/src/agent/cli/run-batch.ts`：批量 CLI 入口

### 7.2 编写 runBaseline.ts

**文件**：新建 `app/src/agent/runner/runBaseline.ts`

**目标**：在一个 browser session 内跑完 P0 + P1 基线，使页面达到"看板 + 列表 + 卡片就绪"的状态。

**核心逻辑**：

```typescript
async function runBaseline(
  session: BrowserSession,
  baselineConfig: BaselineConfig,   // 读自 baseline.json
  opts: { namespace: string }
): Promise<BaselineResult> {

  // P0: 不可逆操作
  if (!loginFlag) {
    await registry.execute("auth_login", {}, ctx);
    loginFlag = true;
  }

  // P1: 可重跑的资源创建
  // 检查页面是否已有 baseline 资源
  const ready = await checkBaselineReady(session.page, opts.namespace);
  if (ready) return { alreadyReady: true };

  // 清理旧 baseline 资源（REST API 前缀删除）
  await cleanupBaselineResources(opts.namespace);

  // 按 baseline.json 的顺序逐个执行
  for (const step of baselineConfig.p1) {
    const scenario = findScenario(step.scenario_id);
    // 跑场景（不做 judge，只确保执行）
    const result = await runReactLoop(ctx, scenario, {
      ...step.params,  // 如 { listName: "List-A" }
      namespace: opts.namespace,
    });
    if (!result.likelySuccess) {
      throw new Error(`Baseline P1 失败: ${step.purpose}`);
    }
  }

  return { alreadyReady: false, completed: true };
}
```

**DOM pre-check 实现**（`checkBaselineReady`）：

```typescript
async function checkBaselineReady(
  page: Page,
  namespace: string
): Promise<boolean> {
  // 在页面上找包含 namespace 前缀的元素
  // 比如找看板标题：class 含 "BoardHeader" 且 text 含 namespace
  const nsPattern = namespace; // 如 "happy_path_202606251430"
  try {
    const boardFound = await page.locator(
      `[class*="Board_name"]:has-text("${nsPattern}")`
    ).first().waitFor({ timeout: 3000 });
    return !!boardFound;
  } catch {
    return false;
  }
}
```

**关键设计点**：
- P0 的 login_flag 是全局单例（模块级变量），整个进程内只跑一次登录
- P1 每次跑之前先做 DOM pre-check，如果页面已有 baseline 资源就直接跳过
- 如果 DOM pre-check 不通过（页面被污染了），先用 REST API 清理旧 baseline 资源（带 namespace 前缀的 project/board），再重建
- Baseline 跑完后的资源名带 `happy_path_yyyymmdd_hhmm` 前缀，方便 pre-check 定位
- `params.listName` 传给 domain tool 的 `card_create`，让它知道在哪个列表下建卡片

### 7.3 修改 runScenario.ts

**目标**：runner 在跑单个 scenario 之前，自动检查并处理前置依赖。

**改动方式**：在 `runScenario` 函数中加一个可选参数 `autoSetup`，以及依赖 dependencyGraph。

```typescript
export interface RunScenarioOptions {
  headless?: boolean;
  maxSteps?: number;
  cleanup?: (ctx: ToolContext) => Promise<void>;
  namespace?: string;
  onStep?: (step: ReActStep) => void;
  // ↓↓↓ 新增 ↓↓↓
  autoSetup?: boolean;                 // 是否自动处理前置依赖
  depGraph?: DependencyGraph;           // 依赖图实例
  baselineConfig?: BaselineConfig;      // 基线配置
}
```

**autoSetup 流程**：
1. 开 session、登录
2. 如果 `autoSetup && baselineConfig`：先跑 `runBaseline`（确保 baseline 就绪）
3. 如果 `autoSetup && depGraph`：查 `scenario.feature_id` 的传递前置
   - 过滤掉已在 baseline 中覆盖的（project_create、board_create 等）
   - 对剩余前置，跑它们的 happy_path 场景（只执行，不 judge）
4. 跑目标 scenario（正常 judge）

**注意**：
- `autoSetup` 默认 `false`，不破坏现有行为
- autoSetup 只在 `runScenario` 作为独立入口时启用（如 `run-feature` CLI）
- 在 `runChain`（测试链）模式下，前一个场景的页面状态自然就是下一个场景的前置，不需要 autoSetup

### 7.4 修改 runBatch.ts

**目标**：支持按 module 运行测试链。

当前 `run-batch` 支持 `--difficulty`、`--tag`、`--limit`。新增 `--module` 参数：

```bash
# 跑 card 模块的全部场景（按依赖拓扑序）
npm run run-batch -- --module card

# 跑 board 模块
npm run run-batch -- --module board
```

**实现**：
1. 先用 `dependencyGraph.getByModule(module)` 获取该模块的全部 FeaturePoint（已是拓扑序）
2. 对每个 FP，收集它的所有 scenario（happy_path + variant + edge_case）
3. 开一个 session → 跑 baseline → 按顺序跑每个 scenario
4. 因为 baseline 已经就绪，大多数场景不需要额外前置

**报告**：和现有 batch 报告格式一致（通过率、失败原因），另外加一行"模块链路执行状态"（链条是否跑通）。

### 7.5 修改 cli/run.ts

新增 `--module` 参数，委托给 `runBatch` 的 module 模式。

### 7.6 验证

乙完成后应确认：
1. `npm run typecheck` 通过
2. 找一个有依赖的功能点（如 `card_delete`），在 CLI 中用 `--auto-setup` 跑，确认先跑了 `board_create` → `card_create` 再跑 `card_delete`
3. 跑 `--module card` 看整条链条能否走通
4. Baseline DOM pre-check 在正常页面和空白页面上都能正确判断

---

## 八、项目当前环境

**运行 Task1 生成**（在 `app/` 目录下）：
```bash
npm run extract       # 功能点提取
npm run scenarios     # 场景生成
npm run infer-deps    # 依赖推理（本次新增）
```

**运行 Task2 测试**（在 `app/` 目录下）：
```bash
npm run run-scenario -- --id board-create-happy-path
npm run run-batch -- --difficulty easy --limit 5
```

**类型检查**：
```bash
npm run typecheck
```

**注意**：
- `.env` 在项目根目录，包含 DeepSeek API key 和 demo 站登录凭据
- demo 站是 `demo.4gaboards.com`（共享站点），操作的资源都要带命名空间前缀
- `4gaBoards/` 和 `4gaBoardsDocs/` 是只读参考，不要修改里面的文件
