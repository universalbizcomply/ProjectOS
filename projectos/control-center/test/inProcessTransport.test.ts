import { describe, test, expect } from 'vitest';
import { InProcessTransport } from '../src/daemon/inProcessTransport.js';
import type {
  BridgeDaemon,
  BridgeEvent,
  HealthSnapshot,
  Notification,
  PhaseState,
  WorkerState,
} from '@projectos/bridge-daemon';
import type { TransportMessage } from '../src/daemon/types.js';

function makeFakeDaemon() {
  const handlers = new Set<(e: BridgeEvent) => void>();
  const phase: PhaseState = {
    project: 'app', phase: 'X1A', stage: 'implementing', status: 'implementing',
    updatedAt: 't', worker: 'claude-code', source: 'vscode', version: '0.1.0', lastSeq: 3,
    validators: 'pass', decisionRequired: false, branch: 'main', blockers: ['b'],
  };
  const workerState: WorkerState = {
    id: 'wst_claude-code', project: 'app', phase: 'X1A', worker: 'claude-code',
    provider: 'claude-code', status: 'implementing', online: true, updatedAt: 't', currentAction: 'edit',
  };
  const health: HealthSnapshot = {
    running: true, version: '0.1.0', uptimeMs: 100, projects: 1, workers: 1, watchers: 1,
    pendingEvents: 0, pendingPrompts: 0, pendingReports: 0, pendingApprovals: 0,
  };
  const notif: Notification = { kind: 'review-required', project: 'app', phase: 'X1A', at: 't', message: 'review' };

  const daemon = {
    phaseStates: () => [phase],
    workers: new Map([['app:X1A:claude-code', workerState]]),
    health: () => health,
    notifications: [notif] as readonly Notification[],
    bus: {
      subscribe: (fn: (e: BridgeEvent) => void) => {
        handlers.add(fn);
        return () => handlers.delete(fn);
      },
    },
  };
  const publish = (e: BridgeEvent): void => {
    for (const h of handlers) h(e);
  };
  return { daemon: daemon as unknown as BridgeDaemon, publish, handlerCount: () => handlers.size };
}

const bridgeEvent: BridgeEvent = {
  id: 'evt_1', seq: 4, type: 'FILES_CHANGED', project: 'app', phase: 'X1A',
  at: 't', actor: 'implementer', source: 'vscode', worker: 'claude-code', decisionRequired: false,
};

describe('InProcessTransport', () => {
  test('connect emits a mapped snapshot', () => {
    const { daemon } = makeFakeDaemon();
    const t = new InProcessTransport(daemon);
    const msgs: TransportMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    t.connect();
    const snap = msgs.find((m) => m.kind === 'snapshot');
    expect(snap?.kind).toBe('snapshot');
    if (snap?.kind === 'snapshot') {
      expect(snap.snapshot.health.recovered).toBe(true);
      expect(snap.snapshot.workers[0]?.worker).toBe('claude-code');
      expect(snap.snapshot.workers[0]?.currentAction).toBe('edit');
      expect(snap.snapshot.phases[0]?.branch).toBe('main');
      expect(snap.snapshot.projects[0]?.phase).toBe('X1A');
      expect(snap.snapshot.notifications[0]?.kind).toBe('review-required');
    }
  });

  test('a bus event relays an event + a fresh snapshot', () => {
    const { daemon, publish } = makeFakeDaemon();
    const t = new InProcessTransport(daemon);
    const msgs: TransportMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    t.connect();
    msgs.length = 0;
    publish(bridgeEvent);
    expect(msgs.map((m) => m.kind)).toEqual(['event', 'snapshot']);
    const evt = msgs[0];
    if (evt?.kind === 'event') expect(evt.event.type).toBe('FILES_CHANGED');
  });

  test('requestSnapshot re-emits; disconnect unsubscribes', () => {
    const { daemon, publish, handlerCount } = makeFakeDaemon();
    const t = new InProcessTransport(daemon);
    const msgs: TransportMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    t.connect();
    expect(handlerCount()).toBe(1);
    msgs.length = 0;
    t.requestSnapshot();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.kind).toBe('snapshot');
    t.disconnect();
    expect(handlerCount()).toBe(0);
    msgs.length = 0;
    publish(bridgeEvent); // no subscribers → nothing relayed
    expect(msgs).toHaveLength(0);
  });
});
