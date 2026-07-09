/**
 * Test helpers — a virtual-clock Scheduler and a controllable DaemonTransport, plus a
 * snapshot builder. Everything is deterministic (no real timers).
 */
import type { DaemonTransport, Scheduler, TransportListener } from '../src/daemon/ports.js';
import type { DaemonSnapshot, LiveHealth, TransportMessage } from '../src/daemon/types.js';

export interface FakeScheduler extends Scheduler {
  advance(ms: number): void;
  clock: number;
  pending(): number;
}

export function createFakeScheduler(): FakeScheduler {
  const timers = new Map<number, { fn: () => void; at: number }>();
  let clock = 0;
  let nextId = 0;
  const sched: FakeScheduler = {
    clock: 0,
    setTimer(fn, ms) {
      nextId += 1;
      timers.set(nextId, { fn, at: clock + ms });
      return nextId;
    },
    clearTimer(handle) {
      timers.delete(handle);
    },
    now() {
      return clock;
    },
    pending() {
      return timers.size;
    },
    advance(ms) {
      const target = clock + ms;
      // Run due timers in time order until the target is reached; re-armed timers with a
      // future fire time are left for the next advance.
      for (;;) {
        let soonestId = -1;
        let soonestAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < soonestAt) {
            soonestAt = t.at;
            soonestId = id;
          }
        }
        if (soonestId === -1) break;
        const t = timers.get(soonestId)!;
        timers.delete(soonestId);
        clock = t.at;
        this.clock = clock;
        t.fn();
      }
      clock = target;
      this.clock = clock;
    },
  };
  return sched;
}

export interface FakeTransport extends DaemonTransport {
  emit(message: TransportMessage): void;
  connects: number;
  disconnects: number;
  snapshotRequests: number;
}

export function createFakeTransport(): FakeTransport {
  const listeners = new Set<TransportListener>();
  const t: FakeTransport = {
    kind: 'fake',
    connects: 0,
    disconnects: 0,
    snapshotRequests: 0,
    connect() {
      this.connects += 1;
    },
    disconnect() {
      this.disconnects += 1;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestSnapshot() {
      this.snapshotRequests += 1;
    },
    emit(message) {
      for (const l of listeners) l(message);
    },
  };
  return t;
}

export function makeHealth(over: Partial<LiveHealth> = {}): LiveHealth {
  return {
    running: true,
    version: '0.1.0',
    uptimeMs: 1000,
    projects: 1,
    workers: 1,
    watchers: 1,
    pendingEvents: 0,
    pendingPrompts: 0,
    pendingReports: 0,
    pendingApprovals: 0,
    recovered: false,
    ...over,
  };
}

export function makeSnapshot(over: Partial<DaemonSnapshot> = {}): DaemonSnapshot {
  return {
    health: makeHealth(),
    workers: [],
    phases: [],
    projects: [],
    notifications: [],
    ...over,
  };
}
