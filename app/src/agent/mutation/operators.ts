// 规则式 expectation 变异算子（Layer 1）。
// 纯函数、完全可复现、不依赖 LLM。每个算子对单个 Expectation 作用，
// 返回 0..N 个变异（含深拷贝后的 mutatedExpectation）。
//
// 分类：must-kill = 与真实轨迹矛盾、判官理应必杀；soft = 描述性漂移、判官刻意宽松下可存活。
// 词表按算子【互不相交】分区，避免同一 token 被多个算子重复变异。

import type { Expectation } from "../../schemas";

export type MutantCategory = "must-kill" | "soft";

/** 单条 expectation 变异：算子标识 + 分类 + 人类可读说明 + 变异后的 expectation。 */
export interface ExpectationMutation {
  operatorId: string;
  category: MutantCategory;
  /** 变异了什么（如「取反：出现→消失」） */
  description: string;
  mutatedExpectation: Expectation;
}

export interface MutationOperator {
  id: string;
  category: MutantCategory;
  apply: (exp: Expectation) => ExpectationMutation[];
}

// ----------------------------- 词表（互斥分区） ----------------------------- //

// C1 取反/反义：动作/存在性动词
export const ANTONYMS: [string, string][] = [
  ["出现", "消失"],
  ["显示", "隐藏"],
  ["成功", "失败"],
  ["添加", "删除"],
  ["新增", "移除"],
  ["启用", "禁用"],
  ["可见", "不可见"],
];

// C4 状态/属性/方向/语言取反（与 C1 互斥）
export const STATE_PAIRS: [string, string][] = [
  ["升序", "降序"],
  ["向上", "向下"],
  ["勾选", "未勾选"],
  ["选中", "未选中"],
  ["暗色", "亮色"],
  ["中文", "English"],
];

// C2 实体循环：看板→卡片→列表→看板；项目→看板（每个期望只取首个命中，产 1 个）
const ENTITY_CYCLE: [string, string][] = [
  ["看板", "卡片"],
  ["卡片", "列表"],
  ["列表", "看板"],
  ["项目", "看板"],
];
const TEMPLATE_PAIR: [string, string] = ["Simple", "Kanban"];

// C5 关键字漂移（soft）：近义但错的名词
const DRIFT: [string, string][] = [
  ["卡片", "任务"],
  ["看板", "工作区"],
  ["列表", "分组"],
];

// C3 中文数字映射（篡改成不同值）
const CN_NUM: Record<string, string> = {
  一: "五", 二: "六", 三: "五", 四: "八", 五: "九",
  六: "二", 七: "三", 八: "四", 九: "一", 十: "二十",
};

// C6 增特征：插入一条真实轨迹里【不会出现】的描述性特征
const SPURIOUS_FEATURE = "页面顶部出现绿色成功提示横幅（toast）";

// ----------------------------- 工具函数 ----------------------------- //

function cloneExp(exp: Expectation): Expectation {
  return { description: exp.description, key_features: [...exp.key_features] };
}

/** 在 description + 所有 key_features 上全局替换 token a→b（返回新 expectation，不改原对象）。 */
function replaceToken(exp: Expectation, a: string, b: string): Expectation {
  const next = cloneExp(exp);
  next.description = next.description.split(a).join(b);
  next.key_features = next.key_features.map((f) => f.split(a).join(b));
  return next;
}

function hasToken(exp: Expectation, a: string): boolean {
  return exp.description.includes(a) || exp.key_features.some((f) => f.includes(a));
}

/**
 * 对一组对词生成变异：每对一个变异。
 * 仅当【恰好命中一侧】才生成（都有=歧义/可能等价，跳过；都无=不适用，跳过）。
 */
function swapsFromPairs(
  exp: Expectation,
  pairs: [string, string][],
  operatorId: string,
  category: MutantCategory,
  label: (from: string, to: string) => string,
): ExpectationMutation[] {
  const out: ExpectationMutation[] = [];
  for (const [a, b] of pairs) {
    const hasA = hasToken(exp, a);
    const hasB = hasToken(exp, b);
    if (hasA === hasB) continue;
    const [from, to] = hasA ? [a, b] : [b, a];
    out.push({
      operatorId,
      category,
      description: label(from, to),
      mutatedExpectation: replaceToken(exp, from, to),
    });
  }
  return out;
}

// ----------------------------- 算子 ----------------------------- //

const C1_NEGATE: MutationOperator = {
  id: "negate",
  category: "must-kill",
  apply: (exp) =>
    swapsFromPairs(exp, ANTONYMS, "negate", "must-kill", (a, b) => `取反：${a}→${b}`),
};

const C2_ENTITY: MutationOperator = {
  id: "entity-swap",
  category: "must-kill",
  apply: (exp) => {
    const out: ExpectationMutation[] = [];
    // 实体循环：首个命中的实体整体替换到目标（每期望至多 1 个，避免过多）
    for (const [a, b] of ENTITY_CYCLE) {
      if (hasToken(exp, a)) {
        out.push({
          operatorId: "entity-swap",
          category: "must-kill",
          description: `实体错配：${a}→${b}`,
          mutatedExpectation: replaceToken(exp, a, b),
        });
        break;
      }
    }
    // 模板对（独立一条，与实体互不影响）
    const [t1, t2] = TEMPLATE_PAIR;
    if (hasToken(exp, t1) !== hasToken(exp, t2)) {
      const [from, to] = hasToken(exp, t1) ? [t1, t2] : [t2, t1];
      out.push({
        operatorId: "entity-swap",
        category: "must-kill",
        description: `模板错配：${from}→${to}`,
        mutatedExpectation: replaceToken(exp, from, to),
      });
    }
    return out;
  },
};

const C3_NUMBER: MutationOperator = {
  id: "number-tamper",
  category: "must-kill",
  apply: (exp) => {
    const text = `${exp.description} ${exp.key_features.join(" ")}`;
    // 阿拉伯数字（首个），改成不同的非零值
    const m = text.match(/[0-9]+/);
    const digit = m?.[0];
    if (digit) {
      const n = parseInt(digit, 10);
      const nn = n <= 1 ? n + 3 : n + 2;
      return [
        {
          operatorId: "number-tamper",
          category: "must-kill",
          description: `数值篡改：${digit}→${nn}`,
          mutatedExpectation: replaceToken(exp, digit, String(nn)),
        },
      ];
    }
    // 中文数字（首个）
    const cm = text.match(/[一二三四五六七八九十]+/);
    const cn = cm?.[0];
    if (cn && CN_NUM[cn]) {
      return [
        {
          operatorId: "number-tamper",
          category: "must-kill",
          description: `数值篡改：${cn}→${CN_NUM[cn]}`,
          mutatedExpectation: replaceToken(exp, cn, CN_NUM[cn]),
        },
      ];
    }
    return [];
  },
};

const C4_STATE: MutationOperator = {
  id: "state-swap",
  category: "must-kill",
  apply: (exp) =>
    swapsFromPairs(exp, STATE_PAIRS, "state-swap", "must-kill", (a, b) => `状态取反：${a}→${b}`),
};

const C5_DRIFT: MutationOperator = {
  id: "keyword-drift",
  category: "soft",
  apply: (exp) =>
    swapsFromPairs(exp, DRIFT, "keyword-drift", "soft", (a, b) => `关键字漂移：${a}→${b}`).slice(0, 1),
};

const C6_FEATURE: MutationOperator = {
  id: "feature-add-del",
  category: "soft",
  apply: (exp) => {
    const out: ExpectationMutation[] = [];
    // 增：插一条 trace 里不会有的描述性特征
    if (!exp.key_features.some((f) => f.includes("toast"))) {
      const mutated = cloneExp(exp);
      mutated.key_features = [...mutated.key_features, SPURIOUS_FEATURE];
      out.push({
        operatorId: "feature-add-del",
        category: "soft",
        description: `增特征：+「${SPURIOUS_FEATURE}」`,
        mutatedExpectation: mutated,
      });
    }
    // 删：移除一条 key_feature（至少 2 条时）
    if (exp.key_features.length >= 2) {
      const mutated = cloneExp(exp);
      const removed = mutated.key_features.shift()!;
      out.push({
        operatorId: "feature-add-del",
        category: "soft",
        description: `删特征：-「${removed}」`,
        mutatedExpectation: mutated,
      });
    }
    return out;
  },
};

export const OPERATORS: MutationOperator[] = [C1_NEGATE, C2_ENTITY, C3_NUMBER, C4_STATE, C5_DRIFT, C6_FEATURE];

/** 对单个 expectation 汇总所有算子的变异。 */
export function generateMutations(exp: Expectation): ExpectationMutation[] {
  return OPERATORS.flatMap((o) => o.apply(exp));
}
