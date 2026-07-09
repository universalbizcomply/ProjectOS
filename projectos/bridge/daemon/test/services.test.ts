import { describe, test, expect } from 'vitest';
import { buildDashboardSnapshot } from '../src/sync/dashboardSync.js';
import { notificationsForEvent } from '../src/notifications/notificationService.js';
import { rebuildFromEvents, pendingDecisions, pendingReviews } from '../src/recovery/recoveryManager.js';
import { computeHealth } from '../src/health/healthMonitor.js';
import { Logger, shouldLog, formatLine } from '../src/logging/logger.js';
import { applyWorkerEvent } from '../src/workers/workerManager.js';
import type { WorkerMap } from '../src/workers/workerManager.js';
import { initialState, applyEvent } from '../src/state/stateManager.js';
import { makeEvent } from '../src/events/eventTypes.js';
import type { BridgeEvent, BridgeEventType, PhaseState } from '../src/types.js';

let seq = 0;
function ev(type: BridgeEventType, over: Partial<BridgeEvent> = {}): BridgeEvent {
  seq += 1;
  return makeEvent({
    id: `e${seq}`,
    seq,
    type,
    project: 'p',
    phase: 'X1A',
    at: '2026-07-09T00:00:00.000Z',
    actor: 'agent',
    source: 's',
    ...over,
  }) as BridgeEvent;
}

describe('dashboardSync', () => {
  test('projects redacted, secret-free summaries', () => {
    let s: PhaseState = initialState('p', 'X1A', 't', 's');
    s = { ...s, blockers: ['token sbp_abcdefghijklmnopqrstuvwxyz012345'] };
    let workers: WorkerMap = new Map();
    workers = applyWorkerEvent(workers, ev('IMPLEMENTATION_STARTED', { worker: 'claude-code' }));
    const snap = buildDashboardSnapshot([s], workers, 't');
    expect(snap.projects).toHaveLength(1);
    expect(JSON.stringify(snap)).not.toContain('sbp_abcdefghijkl');
    expect(snap.projects[0]?.workers[0]?.worker).toBe('claude-code');
  });
});

describe('notifications', () => {
  test('maps events to notifications', () => {
    expect(notificationsForEvent(ev('PROMPT_READY'))[0]?.kind).toBe('prompt-ready');
    expect(notificationsForEvent(ev('REPORT_CREATED'))[0]?.kind).toBe('report-ready');
    expect(notificationsForEvent(ev('REVIEW_READY'))[0]?.kind).toBe('review-required');
    expect(notificationsForEvent(ev('EVIDENCE_CREATED', { decisionRequired: true }))[0]?.kind).toBe(
      'approval-required',
    );
    expect(notificationsForEvent(ev('EVIDENCE_CREATED'))).toEqual([]);
    expect(notificationsForEvent(ev('VALIDATION_COMPLETED', { payload: { result: 'fail' } }))[0]?.kind).toBe(
      'validation-failed',
    );
    expect(notificationsForEvent(ev('VALIDATION_COMPLETED', { payload: { result: 'pass' } }))).toEqual([]);
    expect(notificationsForEvent(ev('WORKER_OFFLINE', { worker: 'w' }))[0]?.kind).toBe('worker-offline');
    expect(notificationsForEvent(ev('DAEMON_STARTED', { payload: { restart: true } }))[0]?.kind).toBe(
      'daemon-restarted',
    );
    expect(notificationsForEvent(ev('DAEMON_STARTED', { payload: { restart: false } }))).toEqual([]);
    expect(notificationsForEvent(ev('SYNC_COMPLETED'))[0]?.kind).toBe('dashboard-synced');
    expect(notificationsForEvent(ev('PROMPT_READ'))).toEqual([]);
  });
});

describe('recovery', () => {
  test('rebuildFromEvents reconstructs state + workers and counts refusals', () => {
    const events = [
      ev('PHASE_CREATED', { worker: 'claude-code' }),
      ev('PROMPT_READY'),
      ev('IMPLEMENTATION_STARTED', { worker: 'claude-code' }),
      ev('OWNER_APPROVED'), // illegal from implementing → refused
    ];
    const r = rebuildFromEvents(events);
    expect(r.phases.get('p:X1A')?.stage).toBe('implementing');
    expect(r.workers.size).toBe(1);
    expect(r.refusedTransitions).toBe(1);
  });

  test('pendingDecisions and pendingReviews filter', () => {
    let s = initialState('p', 'X1A', 't', 's');
    s = applyEvent(s, ev('PHASE_CREATED')).state;
    s = applyEvent(s, ev('PROMPT_READY')).state;
    s = applyEvent(s, ev('IMPLEMENTATION_STARTED')).state;
    s = applyEvent(s, ev('VALIDATION_STARTED')).state;
    s = applyEvent(s, ev('EVIDENCE_CREATED', { decisionRequired: true })).state;
    s = applyEvent(s, ev('REVIEW_READY', { decisionRequired: true })).state;
    const map = new Map([['p:X1A', s]]);
    expect(pendingReviews(map)).toHaveLength(1);
    expect(pendingDecisions(map)).toHaveLength(1);
  });
});

describe('health', () => {
  test('computeHealth reflects inputs and clamps uptime', () => {
    const h = computeHealth({
      running: true,
      startMonotonicMs: 1000,
      nowMonotonicMs: 4000,
      projects: 3,
      workers: 5,
      watchers: 3,
      pendingEvents: 1,
      pendingPrompts: 2,
      pendingReports: 0,
      pendingApprovals: 4,
    });
    expect(h.running).toBe(true);
    expect(h.uptimeMs).toBe(3000);
    expect(h.projects).toBe(3);
    expect(h.pendingApprovals).toBe(4);
  });
});

describe('logger', () => {
  test('shouldLog respects severity ranks', () => {
    expect(shouldLog('INFO', 'INFO')).toBe(true);
    expect(shouldLog('WARN', 'INFO')).toBe(false);
    expect(shouldLog('WARN', 'ERROR')).toBe(true);
    expect(shouldLog('INFO', 'EVENT')).toBe(true);
  });

  test('formatLine redacts msg and fields', () => {
    const out = formatLine({
      level: 'INFO',
      at: 't',
      msg: 'token sbp_abcdefghijklmnopqrstuvwxyz012345',
      fields: { k: 'vcp_abcdefghijklmnopqrstuvwx' },
    });
    expect(out).not.toContain('sbp_abcdefghijkl');
    expect(out).not.toContain('vcp_abcdefghijkl');
    expect(out).toContain('[REDACTED]');
  });

  test('Logger filters by level and emits through sink', () => {
    const lines: string[] = [];
    const log = new Logger((l) => lines.push(l), () => 't', 'WARN');
    log.info('quiet');
    expect(lines).toHaveLength(0);
    log.warn('loud', { a: 1 });
    log.error('boom');
    log.event('ev'); // rank 15 < WARN(20) → suppressed
    expect(lines).toHaveLength(2);
    log.setLevel('INFO');
    log.event('now shown');
    expect(lines).toHaveLength(3);
  });
});
