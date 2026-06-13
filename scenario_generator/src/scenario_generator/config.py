"""配置：定位仓库根、加载 .env、集中暴露设置。

仓库根的判定依据是「同时存在 4gaBoards/ 与 4gaBoardsDocs/」，与运行时的工作目录无关，
便于在不同位置启动脚本。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def find_repo_root() -> Path:
    """向上查找同时包含 4gaBoardsDocs/ 与 4gaBoards/ 的目录作为仓库根。"""
    start = Path(__file__).resolve()
    for parent in [start, *start.parents]:
        if (parent / "4gaBoardsDocs").is_dir() and (parent / "4gaBoards").is_dir():
            return parent
    # 回退到当前工作目录（仅用于离线测试场景）
    return Path.cwd()


REPO_ROOT = find_repo_root()

# 仓库根目录的 .env 含所有密钥
load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    # DeepSeek（OpenAI 兼容）
    deepseek_api: str = os.getenv("DEEPSEEK_API", "")
    deepseek_url: str = os.getenv("DEEPSEEK_URL_OPENAI", "https://api.deepseek.com")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    # 只读参考 + 知识源
    docs_dir: Path = REPO_ROOT / "4gaBoardsDocs" / "docs"
    app_source_dir: Path = REPO_ROOT / "4gaBoards"

    # 产物输出
    outputs_dir: Path = REPO_ROOT / "scenario_generator" / "outputs"


settings = Settings()
