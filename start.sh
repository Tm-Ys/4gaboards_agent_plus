#!/usr/bin/env bash
# 一键启动：检查/配置环境 → 启动控制台（后端 8787 + 前端 5173）→ 提示打开页面。
# 用法：bash start.sh   （可重复跑，已装过的会跳过）
set -euo pipefail

# 切到仓库根（脚本所在目录）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

cyan() { printf "\033[36m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }

echo ""
cyan "════════════════════════════════════════════"
cyan "  4gaBoards 智能测试工具 · 一键启动"
cyan "════════════════════════════════════════════"
echo ""

# ---------- 1. Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 node。请先安装 Node.js >= 20（https://nodejs.org）"
  exit 1
fi
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌ node 版本过低（$(node -v)），需要 >= 20"
  exit 1
fi
green "✓ Node.js $(node -v)"

# ---------- 2. .env 密钥 ----------
if [ ! -f .env ]; then
  echo "❌ 未找到根目录 .env（密钥配置文件）"
  echo ""
  echo "   请先复制模板并填入真实值："
  echo "     cp .env.example .env"
  echo "     # 然后用编辑器打开 .env，填入："
  echo "     #   DEEPSEEK_API      = <你的 DeepSeek API key>"
  echo "     #   4GABOARD_ACCOUNT   = <demo 登录账号>"
  echo "     #   4GABOARD_PASSWORD  = <demo 登录密码>"
  echo "     #   （其余项见 .env.example 注释）"
  echo ""
  echo "   配好后重新运行：bash start.sh"
  exit 1
fi
green "✓ .env 已配置"

# ---------- 3. app 依赖 ----------
if [ ! -d app/node_modules ]; then
  echo "▶ 安装 app 依赖（首次较慢）…"
  (cd app && npm install)
else
  green "✓ app 依赖已安装"
fi

# ---------- 4. 前端依赖 ----------
if [ ! -d app/web/node_modules ]; then
  echo "▶ 安装前端依赖（首次较慢）…"
  (cd app/web && npm install)
else
  green "✓ 前端依赖已安装"
fi

# ---------- 5. Playwright 浏览器（任务二执行要） ----------
echo "▶ 确保 Playwright 浏览器（chromium）…"
(cd app && npx playwright install chromium >/dev/null 2>&1 || echo "   ⚠ playwright install 跳过/失败，任务二执行可能不可用")

# ---------- 6. 可选：4gaBoardsDocs（任务一重新生成场景才需要） ----------
if [ ! -d 4gaBoardsDocs ]; then
  yellow "ℹ 未 clone 4gaBoardsDocs（仅「重新生成场景」按钮需要；浏览/跑已有场景不需要）"
  echo "   如需：git clone https://github.com/RARgames/4gaBoardsDocs.git"
fi

# ---------- 7. 启动 ----------
echo ""
cyan "════════════════════════════════════════════"
cyan "  环境就绪，启动控制台…"
cyan "════════════════════════════════════════════"
echo ""
green "  👉 请在浏览器打开：  http://localhost:5173"
echo ""
echo "  · 前端（牛皮纸控制台）：http://localhost:5173"
echo "  · 后端 API：            http://localhost:8787"
echo "  · 停止：按 Ctrl+C"
echo ""
echo "  首次点「Run 场景」会启动浏览器跑测试（约几十秒~几分钟）。"
echo ""

cd app && exec npm run dev
