"""DeepSeek（OpenAI 兼容）封装：以 JSON 模式调用，返回解析后的 dict。"""

from __future__ import annotations

import json
from typing import Any

from openai import OpenAI

from .config import settings

_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        if not settings.deepseek_api:
            raise RuntimeError("未配置 DEEPSEEK_API，请检查仓库根目录 .env")
        _client = OpenAI(
            api_key=settings.deepseek_api, base_url=settings.deepseek_url
        )
    return _client


def chat_json(
    system: str,
    user: str,
    *,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    timeout: float | None = 120.0,
) -> dict[str, Any]:
    """以 JSON 模式调用 LLM，返回解析后的 dict。

    使用 response_format=json_object，调用方需在 prompt 中提及 JSON。
    """
    client = get_client()
    kwargs: dict[str, Any] = dict(
        model=model or settings.deepseek_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    if max_tokens:
        kwargs["max_tokens"] = max_tokens
    if timeout:
        kwargs["timeout"] = timeout

    resp = client.chat.completions.create(**kwargs)
    content = resp.choices[0].message.content or "{}"
    content = _strip_code_fence(content)
    return json.loads(content)


def _strip_code_fence(text: str) -> str:
    """兜底：个别模型即便指定 JSON 模式也可能包裹 ```json 围栏。"""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    return text.strip()
