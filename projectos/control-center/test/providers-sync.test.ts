import { describe, test, expect } from 'vitest';
import { LiveStore } from '../src/daemon/store.js';
import { EventStream } from '../src/daemon/eventStream.js';
import { StatusSynchroniser } from '../src/daemon/synchroniser.js';
import {
  selectHealth,
  selectWorkers,
  selectPhases,
  selectProjects,
  selectNotifications,
  selectPendingReviews,
  selectApprovals,
  selectOnlineWorkers,
  DaemonHealthProvider,
  WorkerStatusProvider,
  PhaseStatusProvider,
  NotificationProvider,
} from '../src/daemon/providers.js';
import { makeSnapshot } from './helpers.js';
import type { LivePhase, LiveWorker } from '../src/daemon/types.js';

const worker = (over: Partial<LiveWorker> = {}): LiveWorker => ({
  worker: 'claude-code', provider: 'claude-code', project: 'p', phase: 'X', status: 'implementing', online: true, updatedAt: 't', ...over,
});
const phase = (over: Partial<LivePhase> = {}): LivePhase => ({
  project: 'p', phase: 'X', stage: 'awaiting_review', status: 'awaiting_review', validators: 'pass', decisionRequired: true, worker: 'claude-code', blockers: [], ...over,
});

describe('StatusSynchroniser', () => {
  test('applySnapshot redacts and populates slices', () => {
    const store = new LiveStore();
    const sync = new StatusSynchroniser();
    sync.applySnapshot(
      store,
      makeSnapshot({
        workers: [worker({ currentAction: 'token sbp_abcdefghijklmnopqrstuvwxyz012345' })],
        phases: [phase({ blockers: ['sbp_abcdefghijklmnopqrstuvwxyz012345'], branch: 'main' })],
        projects: [{ project: 'p', phase: 'X', stage: 'implementing', worker: 'claude-code', validators: 'pass', decisionRequired: false }],
        notifications: [{ kind: 'review-required', project: 'p', phase: 'X', at: 't', message: 'review vcp_abcdefghijklmnopqrstuvwx' }],
      }),
    );
    const s = store.getState();
    expect(s.workers[0]?.currentAction).toContain('[REDACTED]');
    expect(s.phases[0]?.blockers[0]).toContain('[REDACTED]');
    expect(s.notifications[0]?.message).toContain('[REDACTED]');
    expect(JSON.stringify(s)).not.toContain('sbp_abcdefghijkl');
  });

  test('applyEvent pushes to stream and store unless paused', () => {
    const store = new LiveStore();
    const sync = new StatusSynchroniser();
    const stream = new EventStream();
    const e = { id: 'e1', at: 't', type: 'FILES_CHANGED', project: 'p', phase: 'X', actor: 'implementer', worker: 'claude-code' };
    sync.applyEvent(store, stream, e, false);
    expect(store.getState().events).toHaveLength(1);
    sync.applyEvent(store, stream, { ...e, id: 'e2' }, true); // paused → buffer grows, store frozen
    expect(stream.size).toBe(2);
    expect(store.getState().events).toHaveLength(1);
  });

  test('applyNotification prepends redacted', () => {
    const store = new LiveStore();
    const sync = new StatusSynchroniser();
    sync.applyNotification(store, { kind: 'worker-offline', project: 'p', phase: 'X', at: 't', message: 'x' });
    expect(store.getState().notifications).toHaveLength(1);
  });
});

describe('providers/selectors', () => {
  const store = new LiveStore();
  new StatusSynchroniser().applySnapshot(
    store,
    makeSnapshot({
      workers: [worker(), worker({ worker: 'chatgpt', online: false, status: 'offline' })],
      phases: [phase(), phase({ phase: 'Y', stage: 'implementing', decisionRequired: false })],
      projects: [{ project: 'p', phase: 'X', stage: 'awaiting_review', worker: 'claude-code', validators: 'pass', decisionRequired: true }],
      notifications: [{ kind: 'prompt-ready', project: 'p', phase: 'X', at: 't', message: 'm' }],
    }),
  );

  test('selectors return expected slices', () => {
    expect(selectHealth(store)?.running).toBe(true);
    expect(selectWorkers(store)).toHaveLength(2);
    expect(selectPhases(store)).toHaveLength(2);
    expect(selectProjects(store)).toHaveLength(1);
    expect(selectNotifications(store)).toHaveLength(1);
    expect(selectPendingReviews(store)).toHaveLength(1);
    expect(selectApprovals(store)).toHaveLength(1);
    expect(selectOnlineWorkers(store)).toHaveLength(1);
  });

  test('provider objects expose get + subscribe', () => {
    const hp = new DaemonHealthProvider(store);
    const wp = new WorkerStatusProvider(store);
    const pp = new PhaseStatusProvider(store);
    const np = new NotificationProvider(store);
    expect(hp.get()?.running).toBe(true);
    expect(wp.get()).toHaveLength(2);
    expect(pp.get()).toHaveLength(2);
    expect(np.get()).toHaveLength(1);
    let fired = 0;
    const off = hp.subscribe(() => (fired += 1));
    store.update({ connection: 'connected' });
    expect(fired).toBe(1);
    off();
  });
});
