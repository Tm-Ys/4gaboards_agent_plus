// 配置：定位仓库根、加载 .env、集中暴露路径与设置。
// 仓库根判定依据是「同时存在 4gaBoards/ 与 4gaBoardsDocs/」，与运行时工作目录无关。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = path.resolve(here);
  // here = app/src，向上两层到仓库根
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(dir, "4gaBoardsDocs")) &&
      fs.existsSync(path.join(dir, "4gaBoards"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

loadDotenv({ path: path.join(REPO_ROOT, ".env") });

export const settings = {
  deepseekApiKey: process.env.DEEPSEEK_API ?? "",
  deepseekUrl: process.env.DEEPSEEK_URL_OPENAI ?? "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  docsDir: path.join(REPO_ROOT, "4gaBoardsDocs", "docs"),
  appSourceDir: path.join(REPO_ROOT, "4gaBoards"),
  outputsDir: path.join(REPO_ROOT, "app", "outputs"),
} as const;
