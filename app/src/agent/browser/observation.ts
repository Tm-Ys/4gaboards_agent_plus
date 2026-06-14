// 观察构建器：把当前页面转成"可交互元素 + ref"的文本表示（模型无关）。
// agent 看到 ref，动作执行器用同一快照的 ref→Locator 解析后操作真实 UI。
// 这是 browser-use / WebArena 类 web agent 的主流做法，比裸 ariaSnapshot 更可控。

import type { Locator, Page } from "playwright";

// 视为"可观察"的选择器：可交互元素 + 标题/段落文本（让判官能看到标题等）
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="heading"]',
  '[contenteditable="true"]',
].join(", ");

export interface ObsElement {
  ref: number; // 连续编号，仅对可见元素
  role: string; // role 或标签名
  name: string; // 可访问名（aria-label / 文本 / placeholder / title）
  type?: string; // input 类型
  value?: string; // input 当前值（截断）
}

export interface Observation {
  url: string;
  title: string;
  elements: ObsElement[];
  text: string;
  /** 用 ref 解析回 Locator（同一快照内有效；下一次 observe 后失效）。 */
  resolve: (ref: number) => Locator;
}

interface RawEl {
  tag: string;
  role: string;
  name: string;
  type: string;
  value: string;
  visible: boolean;
}

export async function observe(page: Page): Promise<Observation> {
  const loc = page.locator(INTERACTIVE_SELECTOR);
  const raw = await loc.evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      const tag = e.tagName.toLowerCase();
      const name = (
        e.getAttribute("aria-label") ||
        e.getAttribute("title") ||
        (e.innerText || "").trim() ||
        e.getAttribute("placeholder") ||
        ""
      ).slice(0, 120);
      return {
        tag,
        role: e.getAttribute("role") || "",
        name,
        type: e.getAttribute("type") || "",
        value: (e as HTMLInputElement).value || "",
        visible: e.checkVisibility ? e.checkVisibility() : e.offsetParent !== null,
      } satisfies RawEl;
    }),
  );

  const refToIndex = new Map<number, number>();
  const elements: ObsElement[] = [];
  let ref = 0;
  for (let i = 0; i < raw.length; i++) {
    const d = raw[i]!;
    if (!d.visible) continue;
    const role = d.role || d.tag;
    elements.push({
      ref,
      role,
      name: d.name,
      ...(d.type && d.tag === "input" ? { type: d.type } : {}),
      ...(d.value && (d.tag === "input" || d.tag === "textarea")
        ? { value: d.value.slice(0, 80) }
        : {}),
    });
    refToIndex.set(ref, i);
    ref++;
    if (elements.length >= 200) break; // 上限，防爆
  }

  const text = formatObservation(page.url(), await page.title(), elements);
  return { url: page.url(), title: await page.title(), elements, text, resolve: (r) => loc.nth(refToIndex.get(r) ?? -1) };
}

function formatObservation(url: string, title: string, elements: ObsElement[]): string {
  const lines: string[] = [];
  lines.push(`# 当前页面观察`);
  lines.push(`URL: ${url}`);
  lines.push(`Title: ${title}`);
  if (elements.length === 0) {
    lines.push(`（未检测到可交互元素）`);
  } else {
    lines.push(`可交互元素（用 ref 引用）：`);
    for (const e of elements) {
      const parts = [`[${e.ref}]`, e.role];
      if (e.type) parts.push(`type=${e.type}`);
      if (e.name) parts.push(`"${e.name}"`);
      if (e.value) parts.push(`(value="${e.value}")`);
      lines.push(parts.join(" "));
    }
  }
  return lines.join("\n");
}
