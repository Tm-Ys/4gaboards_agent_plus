// Layer 2 轨迹级故障注入：在【真实基线轨迹】上注入【自洽】的行为故障，模拟「app 表现错了」。
// 只改 trace 证据（步骤结果 / 页面观察），不改场景 expectation；重判官时用【原场景】。
// 判官对故障判 FAIL = killed（察觉行为异常）；判 PASS = survived（漏检）。
//
// 关键：故障必须【自洽】——不能只改一处留下大量矛盾的成功证据（宽松判官会把矛盾往成功方向和解）。
// 故用 namespace 前缀定位本场景创建的资源，连同其证据一并清除/篡改，不留字面「故障」标记。
//
// 三类故障（执行异常/布局/语义），均 must-kill：
//   F1 exec-failure   创建类步骤结果改失败 + 从所有观察抹掉该资源 → 一致呈现「未创建」
//   F2 layout-missing 仅从 finalObs 抹掉资源（步骤仍报成功）→ 「动作成功但未渲染」
//   F3 semantic-flip  finalObs/观察翻转首个状态/反义 token（升序↔降序、出现↔消失…）

import type { ReActRunResult } from "../react/types";
import type { TestScenario } from "../../schemas";
import { ANTONYMS, STATE_PAIRS } from "./operators";

export interface Fault {
  id: string;
  operatorId: "exec-failure" | "layout-missing" | "semantic-flip";
  category: "must-kill";
  description: string;
  detail: string;
  faultedRun: ReActRunResult;
}

function cloneRun(r: ReActRunResult): ReActRunResult {
  return JSON.parse(JSON.stringify(r)) as ReActRunResult;
}

/** 把文本中含 namespace 资源的行删掉；全空则给个「无内容」占位。 */
function stripResource(t: string | undefined, ns: string): string | undefined {
  if (!t || !ns || !t.includes(ns)) return t;
  const kept = t.split("\n").filter((l) => !l.includes(ns));
  const out = kept.join("\n").trim();
  return out || "（页面无可交互元素）";
}

/** F1 执行异常：创建类步骤结果改失败 + 所有观察抹掉资源 → 一致呈现「未创建」。 */
function execFailure(run: ReActRunResult, ns: string, id: string): Fault {
  const r = cloneRun(run);
  let tainted = 0;
  for (const s of r.steps) {
    s.observation = stripResource(s.observation, ns);
    if (s.trace) for (const tr of s.trace) tr.observation = stripResource(tr.observation, ns);
    if (s.result && ns && s.result.includes(ns)) {
      s.ok = false;
      s.result = "失败：目标元素未找到/超时，动作未完成。";
      tainted++;
    }
  }
  r.finalObservation = stripResource(r.finalObservation, ns) ?? r.finalObservation;
  // 若没命中创建结果（ns 不在 result 里），兜底：最后一个实质步骤标记失败
  if (tainted === 0) {
    for (let i = r.steps.length - 1; i >= 0; i--) {
      const s = r.steps[i];
      if (s && s.tool && s.tool !== "browser_done" && s.result) {
        s.ok = false;
        s.result = "失败：目标元素未找到/超时，动作未完成。";
        break;
      }
    }
  }
  return {
    id,
    operatorId: "exec-failure",
    category: "must-kill",
    description: "执行异常：创建步骤失败 + 抹掉资源证据（一致未创建）",
    detail: "创建类步骤结果改为失败，并从所有观察抹掉 namespace 资源，使轨迹一致呈现「未创建」",
    faultedRun: r,
  };
}

/** F2 布局缺失：仅从 finalObs 抹掉资源（步骤仍报成功）→ 「动作成功但未渲染」。无 namespace 命中则返回 null。 */
function layoutMissing(run: ReActRunResult, ns: string, id: string): Fault | null {
  if (!ns || !run.finalObservation.includes(ns)) return null;
  const r = cloneRun(run);
  r.finalObservation = stripResource(r.finalObservation, ns) ?? r.finalObservation;
  return {
    id,
    operatorId: "layout-missing",
    category: "must-kill",
    description: "布局缺失：finalObs 抹掉资源（步骤仍报成功）",
    detail: "仅从最终观察抹掉 namespace 资源，步骤结果保持成功，模拟「动作成功但未渲染」",
    faultedRun: r,
  };
}

/** F3 语义翻转：finalObs/观察翻转首个命中的状态或反义 token。无命中则返回 null。 */
function semanticFlip(run: ReActRunResult, id: string): Fault | null {
  const r = cloneRun(run);
  const pairs = [...ANTONYMS, ...STATE_PAIRS];
  let hit: [string, string] | null = null;
  for (const [a, b] of pairs) {
    if (r.finalObservation.includes(a)) {
      hit = [a, b];
      break;
    }
    if (r.finalObservation.includes(b)) {
      hit = [b, a];
      break;
    }
  }
  if (!hit) return null;
  const [from, to] = hit;
  r.finalObservation = r.finalObservation.split(from).join(to);
  for (const s of r.steps) {
    if (s.observation && s.observation.includes(from)) {
      s.observation = s.observation.split(from).join(to);
      break;
    }
  }
  return {
    id,
    operatorId: "semantic-flip",
    category: "must-kill",
    description: `语义翻转：观察里 ${from}→${to}`,
    detail: `最终观察（及首个相关步骤观察）中的「${from}」翻转为「${to}」，与期望矛盾`,
    faultedRun: r,
  };
}

/** 给定基线轨迹 + 场景 + namespace，生成全部故障。 */
export function generateFaults(run: ReActRunResult, scenario: TestScenario, namespace: string): Fault[] {
  const base = scenario.id;
  const ns = namespace;
  const faults: Fault[] = [execFailure(run, ns, `${base}-f0-exec`)];
  const lm = layoutMissing(run, ns, `${base}-f1-layout`);
  if (lm) faults.push(lm);
  const sf = semanticFlip(run, `${base}-f2-semantic`);
  if (sf) faults.push(sf);
  return faults;
}
