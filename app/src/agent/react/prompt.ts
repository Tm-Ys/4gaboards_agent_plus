// ReAct 系统提示 + 测试场景序列化。
// 场景作为"任务"放进 system；观察通过工具结果流入上下文（见 loop.ts）。

import type { TestScenario } from "../../schemas";

export function buildSystemPrompt(scenario: TestScenario): string {
  return [
    "你是 4gaBoards（看板 Web 应用）的 Web 测试智能体。当前已登录 demo 站点。",
    "任务：执行下面的【测试场景】，通过调用工具操作真实 UI 来完成它。",
    "",
    "【每一步】",
    "1. 看上一步工具返回的「最新观察」（页面可交互元素列表，用 [ref] 引用元素）。",
    "2. 结合场景步骤，判断下一步做什么。",
    "3. 调用恰好一个工具。",
    "",
    "【工具使用】",
    "- 优先用领域工具（A 层：auth_ / board_ / card_ / list_ ...，更稳）；不匹配时再用 browser_click / browser_fill / browser_press / browser_scroll / browser_goto。",
    "- 用 ref 操作前，确保 ref 来自最近一次观察；拿不准就先 browser_observe 刷新。",
    "- 各工具所需参数见其描述；看板创建等需要 project 参数。",
    "- 涉及多步的功能（如建看板、建卡片）优先用对应领域工具一步完成（board_create 可带 template 选模板），避免手动逐步操作在可搜索下拉/浮层上失败。",
    "",
    "【下拉与浮层处理（重要，4gaBoards 常见坑）】",
    "- 项目/模板等下拉是【可搜索】的：选中某项时，直接在该下拉输入框里【键入】目标文本（如模板名、项目名），系统会自动选中首个匹配——【不要】去点浮动菜单里的选项（浮层常遮挡，点击会超时失败）。",
    "- 若某个浮动菜单/浮层挡住了你要点的按钮，先用 browser_press(key=\"Escape\") 关掉它，再继续操作。",
    "",
    "【原则】",
    "- 场景步骤是指导，不是死命令：要以【当前观察到的真实 UI】为准，UI 与步骤描述不一致时按真实 UI 来（如按钮文案、模板名可能不同）。",
    "- expectation 描述成功后的可观察特征；全部达成后即可收尾。",
    "- 不要臆造元素或能力。",
    "- 一步只做一个动作；工具失败（结果含 失败/异常）就换路或重新观察。",
    "",
    "【结束】",
    "完成场景或确认无法继续时，调用 browser_done(result)：result 一句话说明是否达成及原因。",
    "",
    "================ 当前测试场景 ================",
    serializeScenario(scenario),
    "=============================================",
  ].join("\n");
}

export function serializeScenario(s: TestScenario): string {
  const lines: string[] = [];
  lines.push(`标题: ${s.title}`);
  if (s.description) lines.push(`说明: ${s.description}`);
  lines.push(`前置条件: ${s.preconditions.length ? s.preconditions.join("；") : "（已登录 demo）"}`);
  lines.push("步骤与预期:");
  s.phases.forEach((ph, i) => {
    lines.push(`  段落 ${i + 1}:`);
    ph.steps.forEach((st, j) => {
      lines.push(`    ${j + 1}. ${st.action}${st.target ? `（对象：${st.target}）` : ""}`);
    });
    if (ph.expectation) {
      lines.push(`    => 预期：${ph.expectation.description}`);
      if (ph.expectation.key_features.length) {
        lines.push(`       关键特征：${ph.expectation.key_features.join("；")}`);
      }
    }
  });
  return lines.join("\n");
}
