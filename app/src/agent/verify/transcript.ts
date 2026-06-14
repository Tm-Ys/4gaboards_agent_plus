// 把一次运行的轨迹渲染成"证据文本"供判官审视。
// 刻意只呈现【动作 + 结果 + 每步观察】（事实），不含 actor 的思考/自评，
// 避免执行者的自我合理化干扰独立判官。
// 观察不截断（DeepSeek 上下文充裕，截断会丢失关键证据如靠后的列表/卡片元素）。

import type { ReActRunResult } from "../react/types";

export function buildTranscript(r: ReActRunResult): string {
  const lines: string[] = [];
  lines.push(`【执行轨迹】共 ${r.steps.length} 步；结束方式：${r.done ? "done" : r.timedOut ? "超时" : "无工具调用收尾"}`);

  for (const s of r.steps) {
    const mark = s.ok === false ? " ✗" : s.ok === true ? " ✓" : "";
    lines.push(`\n步骤 ${s.step}：${s.tool ? `[${s.tool}]` : "(未调用工具)"}${mark}`);
    if (s.args && typeof s.args === "object" && Object.keys(s.args as object).length) {
      lines.push(`  参数：${JSON.stringify(s.args)}`);
    }
    if (s.result) lines.push(`  结果：${s.result}`);
    if (s.trace?.length) {
      lines.push(`  工具内部步骤：`);
      for (const t of s.trace) {
        lines.push(
          t.observation
            ? `    · ${t.label}：\n${t.observation.split("\n").map((l) => "      " + l).join("\n")}`
            : `    · ${t.label}`,
        );
      }
    }
    if (s.observation) {
      lines.push(`  页面观察：\n${s.observation.split("\n").map((l) => "    " + l).join("\n")}`);
    }
  }

  lines.push(`\n【最终观察】`);
  lines.push(r.finalObservation);
  return lines.join("\n");
}
