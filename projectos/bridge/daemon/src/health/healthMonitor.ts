/**
 * Health monitor — pure. Computes a point-in-time health snapshot from the daemon's counts
 * and an injected uptime. Consumed by the CLI/dashboard for a "is the daemon alive and what
 * is pending" read-out.
 */
import { DAEMON_VERSION } from '../constants.js';
import type { HealthSnapshot } from '../types.js';
import { uptimeMs } from '../utils/clock.js';

export interface HealthInput {
  readonly running: boolean;
  readonly startMonotonicMs: number;
  readonly nowMonotonicMs: number;
  readonly projects: number;
  readonly workers: number;
  readonly watchers: number;
  readonly pendingEvents: number;
  readonly pendingPrompts: number;
  readonly pendingReports: number;
  readonly pendingApprovals: number;
}

export function computeHealth(input: HealthInput): HealthSnapshot {
  return {
    running: input.running,
    version: DAEMON_VERSION,
    uptimeMs: uptimeMs(input.startMonotonicMs, input.nowMonotonicMs),
    projects: input.projects,
    workers: input.workers,
    watchers: input.watchers,
    pendingEvents: input.pendingEvents,
    pendingPrompts: input.pendingPrompts,
    pendingReports: input.pendingReports,
    pendingApprovals: input.pendingApprovals,
  };
}
