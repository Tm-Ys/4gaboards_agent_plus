// 批尾清理（P4.2 数据清理）：删除本批量创建的测试 project（级联删其 board）。
// 走后端 REST（teardown，非被测动作；符合 CLAUDE.md「后端 API 仅作前置/teardown」底线）。
// 按 runBatch 生成的 namespace 前缀过滤，只删本批资源，不碰账号原有数据。

import { proxyFetch } from "../../http";

const DEMO_ORIGIN = (process.env.TARGET_APP_DEMO_URL ?? "https://demo.4gaboards.com").replace(/\/+$/, "");
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

interface Project {
  id: number;
  name: string;
}

/** 用 .env 凭据换 access-token JWT（POST /api/access-tokens → {item: jwt}）。 */
async function getAccessToken(): Promise<string> {
  const emailOrUsername = process.env["4GABOARD_ACCOUNT"];
  const password = process.env["4GABOARD_PASSWORD"];
  if (!emailOrUsername || !password) throw new Error("缺少 4GABOARD_ACCOUNT / 4GABOARD_PASSWORD");

  const r = await proxyFetch(`${DEMO_ORIGIN}/api/access-tokens`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ emailOrUsername, password }),
  });
  if (!r.ok) throw new Error(`access-tokens 换 token 失败：HTTP ${r.status}`);
  const j = (await r.json()) as { item: string };
  if (!j.item) throw new Error("access-tokens 响应无 item 字段");
  return j.item;
}

/**
 * 删除命名空间前缀匹配的测试资源：board（board_create 给 name 加了 namespace 前缀，在现有
 * project 下创建）+ project（若有 project-create 类场景）。删 board 级联清其 card。
 * demo 账号是它创建资源的 manager，有删除权限；demoMode 不拦截 project/board 删除。
 */
export async function cleanupTestProjects({ namespace }: { namespace: string }): Promise<{
  deleted: number;
  failed: number;
}> {
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };

  // GET /api/projects → { items: projects, included: { boards, ... } }，含当前账号可见的全部 board
  const r = await proxyFetch(`${DEMO_ORIGIN}/api/projects`, { headers: auth });
  if (!r.ok) throw new Error(`列出 projects 失败：HTTP ${r.status}`);
  const j = (await r.json()) as { items?: Project[]; included?: { boards?: Project[] } };

  const prefix = `${namespace}-`;
  const boards = (j.included?.boards ?? []).filter((b) => typeof b.name === "string" && b.name.startsWith(prefix));
  const projects = (j.items ?? []).filter((p) => typeof p.name === "string" && p.name.startsWith(prefix));

  let deleted = 0;
  let failed = 0;
  for (const b of boards) {
    const dr = await proxyFetch(`${DEMO_ORIGIN}/api/boards/${b.id}`, { method: "DELETE", headers: auth });
    if (dr.ok || dr.status === 204) deleted++;
    else failed++;
  }
  for (const p of projects) {
    const dr = await proxyFetch(`${DEMO_ORIGIN}/api/projects/${p.id}`, { method: "DELETE", headers: auth });
    if (dr.ok || dr.status === 204) deleted++;
    else failed++;
  }
  return { deleted, failed };
}
