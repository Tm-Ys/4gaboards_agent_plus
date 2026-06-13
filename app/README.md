# app — 4gaBoards Agent Plus（TypeScript）

4gaBoards 测试场景生成器 + 智能测试 Agent 的 TypeScript 实现，全栈统一。

本目录是项目的**主交付代码**（Python 版 `scenario_generator/` 为已验证原型，逻辑移植至此）。
`4gaBoards/` 与 `4gaBoardsDocs/` 是只读参考，不在此目录内修改。

## 目录结构

```
app/
├── package.json
├── tsconfig.json
├── src/
│   ├── config.ts            # 定位仓库根 + 读 .env + 路径
│   ├── http.ts              # 代理感知的 fetch（本机 SOCKS/HTTP 代理）
│   ├── docs.ts              # 加载功能性文档
│   ├── schemas.ts           # zod schema + TS 类型（前端/生成/Agent 共享契约）
│   ├── llm.ts               # DeepSeek（OpenAI 兼容）封装，JSON 模式
│   ├── concurrency.ts       # 并发池工具
│   ├── extractFeatures.ts   # 任务一·步骤1：功能点提取
│   ├── generateScenarios.ts # 任务一·步骤2：测试场景生成
│   └── scenarioStore.ts     # 场景集加载，默认路由 basic（任务二入口）
└── outputs/                 # 生成的 JSON 产物（仅 basic/ 入库）
    └── basic/               # 固化默认场景集：features.json + scenarios.json
```

## 环境依赖

- Node ≥ 20（开发机为 Node 23）。
- 仓库根 `.env` 需配置 `DEEPSEEK_API` / `DEEPSEEK_URL_OPENAI` / `DEEPSEEK_MODEL`。
- 本机若设置了 `HTTPS_PROXY` / `HTTP_PROXY`（如本地代理），`http.ts` 会自动走代理。

## 安装

```bash
cd app
npm install
```

## 运行

```bash
# 任务一·步骤1：功能点提取 -> outputs/features.json
npm run extract
npm run extract -- --limit 2          # 调试：只处理前 2 个文档
npm run extract -- --workers 8

# 任务一·步骤2：测试场景生成 -> outputs/scenarios.json
npm run scenarios
npm run scenarios -- --only card-create,board-create   # 补跑指定功能点并合并
npm run scenarios -- --limit 5
```

类型检查：`npm run typecheck`。

## 场景集与任务二入口

为避免任务二 Agent 每次重新生成场景，产物组织成**命名场景集** `outputs/<setName>/`，默认集为 **`basic`**（已入库，118 功能点 / 179 场景 / 100% 覆盖）。任务二直接加载：

```ts
import { loadScenarioSet } from "./scenarioStore";
const { features, scenarios } = loadScenarioSet();   // 默认 basic
// loadScenarioSet("my-exp")                          // 加载其它命名集
```

跑实验版场景：`npm run scenarios` 生成后放入 `outputs/<实验名>/`，再 `loadScenarioSet("<实验名>")`。

## 与 Python 版的关系

- prompt 与 JSON schema 完全一致，产物字段互通，TS 版可直接消费 Python 版生成的 JSON，反之亦然。
- TS 版的 `schemas.ts` 是后续前端可视化与任务二 Agent 的共享类型契约。
