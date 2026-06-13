// 代理感知的 fetch：本机若设置了 HTTP/HTTPS 代理（如本地 7890），自动走代理。
// undici 的 ProxyAgent 只支持 http(s) 代理，不支持 socks，因此优先取 HTTPS_PROXY/HTTP_PROXY。

import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

function pickProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

const proxyUrl = pickProxyUrl();
const dispatcher: Dispatcher | undefined = proxyUrl
  ? new ProxyAgent(proxyUrl)
  : undefined;

/**
 * 包装 undici fetch，绑到代理 dispatcher。供 openai SDK 作为自定义 fetch 注入，
 * 这样只有 LLM 调用走代理，不影响其它代码。
 */
export function proxyFetch(
  input: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1],
): ReturnType<typeof undiciFetch> {
  return undiciFetch(input, dispatcher ? { ...(init as object), dispatcher } : init);
}

export const hasProxy = Boolean(proxyUrl);
