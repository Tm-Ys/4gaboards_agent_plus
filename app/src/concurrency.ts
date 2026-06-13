// 简单的并发池：限制同时进行的异步任务数。不引入额外依赖。

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]!, idx);
    }
  };
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}
