/**
 * Clock helpers — pure. Uptime is computed from two monotonic readings supplied by the
 * system port, so it never touches the wall clock directly.
 */

/** Milliseconds elapsed between a start reading and a later reading (never negative). */
export function uptimeMs(startMonotonicMs: number, nowMonotonicMs: number): number {
  return Math.max(0, nowMonotonicMs - startMonotonicMs);
}
