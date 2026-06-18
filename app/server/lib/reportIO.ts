// 报告目录读取：列 outputs/runs、outputs/mutation，读单文件。
// 安全：文件名白名单（仅 [A-Za-z0-9._-]+.json）+ resolve 后必须仍在目录内（防穿越）。

import fs from "node:fs";
import path from "node:path";
import { settings } from "../../src/config";

const FILE_RE = /^[A-Za-z0-9._-]+\.json$/;

export interface ReportEntry {
  file: string;
  type: string; // runs: batch|single；mutation: mutation|judge-cost
  size: number;
  mtime: string;
}

export function listDir(sub: "runs" | "mutation"): ReportEntry[] {
  const dir = path.join(settings.outputsDir, sub);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      const st = fs.statSync(path.join(dir, file));
      return { file, type: classify(sub, file), size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function readReport(sub: "runs" | "mutation", file: string): unknown | null {
  if (!FILE_RE.test(file)) return null;
  const dir = path.join(settings.outputsDir, sub);
  const full = path.resolve(dir, file);
  const rel = path.relative(dir, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // 逃出目录
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

function classify(sub: "runs" | "mutation", file: string): string {
  if (sub === "runs") return file.startsWith("batch-") ? "batch" : "single";
  return file.startsWith("judge-cost-") ? "judge-cost" : "mutation";
}
