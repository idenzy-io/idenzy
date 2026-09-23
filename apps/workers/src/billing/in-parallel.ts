/**
 * Runs `work` over `items` with at most `limit` in flight, and waits for all of them.
 *
 * A pure leaf helper (PROJECT.md 7.2.10). Each call must handle its own failure: one that throws
 * rejects the whole run, which is what a caller that catches per item never lets happen.
 */
export async function inParallel<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(lanes);
}
