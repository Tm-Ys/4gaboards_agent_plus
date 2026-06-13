"""加载 4gaBoards 用户手册的功能性文档（任务一的知识源）。

`4gaBoardsDocs/docs/*.md` 中，`docs/dev/*` 属于安装/部署，与功能测试无关，
这里只取顶层目录下的功能性文档，并排除捐赠/附加信息等非功能页。
"""

from __future__ import annotations

from pathlib import Path

from .config import settings

# 非功能性页面：捐赠、附加信息，默认不参与提取。
EXCLUDED_DOCS: set[str] = {"donate.md", "additional-info.md"}


def doc_path(name: str) -> Path:
    return settings.docs_dir / name


def read_doc(name: str) -> str:
    """读取单个功能文档的完整内容（含 frontmatter），整篇返回以供长上下文直填。"""
    return doc_path(name).read_text(encoding="utf-8")


def list_functional_docs() -> list[str]:
    """返回顶层 docs/ 下、存在且未被排除的功能文档文件名（按字母序）。"""
    available = sorted(p.name for p in settings.docs_dir.glob("*.md"))
    return [n for n in available if n not in EXCLUDED_DOCS]
