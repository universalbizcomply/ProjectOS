/**
 * Browser Scheduler — the real timer adapter (the I/O boundary; excluded from coverage like
 * the daemon's system.ts). Tests inject a virtual-clock scheduler instead.
 */
import type { Scheduler } from './ports.js';

export const realScheduler: Scheduler = {
  setTimer: (fn: () => void, ms: number): number => setTimeout(fn, ms) as unknown as number,
  clearTimer: (handle: number): void => clearTimeout(handle),
  now: (): number => Date.now(),
};
