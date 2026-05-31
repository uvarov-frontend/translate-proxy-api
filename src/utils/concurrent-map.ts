/**
 * Maps over an array with a bounded concurrency limit.
 *
 * Unlike Promise.all — which launches everything at once — this function
 * keeps at most `concurrency` promises running at any given time.
 * Useful for batch operations where spawning N upstream requests in parallel
 * could overwhelm the remote service or get the server IP rate-limited/banned.
 */
export async function concurrentMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );

  return results;
}
