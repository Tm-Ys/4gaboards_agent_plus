// 加载 4gaBoards 用户手册的功能性文档（任务一的知识源）。
// 只取 docs/ 顶层功能性文档，排除 donate / additional-info 等非功能页。

import fs from "node:fs";
import path from "node:path";
import { settings } from "./config";

const EXCLUDED_DOCS = new Set(["donate.md", "additional-info.md"]);

export function docPath(name: string): string {
  return path.join(settings.docsDir, name);
}

export function readDoc(name: string): string {
  return fs.readFileSync(docPath(name), "utf-8");
}

export function listFunctionalDocs(): string[] {
  const available = fs
    .readdirSync(settings.docsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return available.filter((f) => !EXCLUDED_DOCS.has(f));
}
