export interface IndexedBlock {
  id: string; root_id: string; box: string; hpath: string; type: string; content: string;
}
export interface Notebook { id: string; name: string; closed: boolean }

export async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(new Error("请求思源内核超时，请重试。")), 15000);
  try {
    const response = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new Error(`思源 API 请求失败（${response.status}）。`);
    const result = await response.json() as { code: number; msg: string; data: T };
    if (result.code !== 0) throw new Error(result.msg || "思源内核返回错误。");
    return result.data;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export function sqlString(value: string): string { return `'${value.replace(/'/g, "''")}'`; }

/** Keyset paging avoids both the user's search result limit and OFFSET degradation. */
export function blockQuery(cursor: string, scope: { notebook?: string; root?: string }, limit = 500): string {
  // These types have editable text DOM; rendering-only blocks have different source representations.
  const where = ["type IN ('d', 'p', 'h', 'c', 't')", `id > ${sqlString(cursor)}`];
  if (scope.notebook) where.push(`box = ${sqlString(scope.notebook)}`);
  if (scope.root) where.push(`root_id = ${sqlString(scope.root)}`);
  return `SELECT id, root_id, box, hpath, type, content FROM blocks WHERE ${where.join(" AND ")} ORDER BY id ASC LIMIT ${Math.max(1, Math.floor(limit))}`;
}
