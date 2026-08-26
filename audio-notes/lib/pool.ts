/**
 * A fixed-size concurrency pool.
 *
 * The fan-out needs exactly one thing: run N tasks, at most K at a time, and
 * do not let one failure cancel the rest. That last part is what rules out
 * Promise.all -- it rejects on the first failure, which would throw away
 * fourteen good transcriptions because the fifteenth chunk got a 400.
 * Promise.allSettled would preserve the results but starts all N at once.
 *
 * So: a worker pool. K workers pull from a shared cursor until the queue is
 * empty. Results land at their original index, because chunk 7's text has to
 * end up between chunk 6 and chunk 8.
 */

export type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

/**
 * Runs `task` over every item with at most `limit` in flight.
 *
 * Results are returned in input order regardless of completion order, and
 * every task is always awaited -- a rejection is captured, never thrown.
 *
 * `onSettle` fires as each task lands, which is what lets the pipeline write
 * progress to the database while the fan-out is still running. Without it the
 * user would see 0/15 and then 15/15 with nothing in between.
 */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onSettle?: (result: Settled<R>, item: T, index: number) => void | Promise<void>,
): Promise<Settled<R>[]> {
  const results = new Array<Settled<R>>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      // Single-threaded event loop: this read-and-increment cannot interleave,
      // so no two workers ever claim the same index.
      const index = cursor++;
      if (index >= items.length) return;

      const item = items[index];
      let settled: Settled<R>;
      try {
        settled = { status: "fulfilled", value: await task(item, index) };
      } catch (reason) {
        settled = { status: "rejected", reason };
      }
      results[index] = settled;

      // A failing progress callback must not take down the pool.
      try {
        await onSettle?.(settled, item, index);
      } catch {
        // Deliberately swallowed: progress reporting is not worth failing over.
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
