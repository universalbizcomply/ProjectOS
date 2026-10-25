import { describe, test, expect } from 'vitest';
import { NullTransport } from '../src/daemon/nullTransport.js';
import { InProcessTransport } from '../src/daemon/inProcessTransport.js';
import { StatusSynchroniser } from '../src/daemon/synchroniser.js';
import { LiveStore } from '../src/daemon/store.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { createFakeScheduler, createFakeTransport, makeSnapshot } from './helpers.js';
import type { BridgeDaemon, HealthSnapshot, PhaseState, WorkerState } from '@projectos/bridge-daemon';
import type { TransportMessage } from '../src/daemon/types.js';

describe('NullTransport', () => {
  test('reports closed on connect and requestSnapshot is inert', () => {
    const t = new NullTransport();
    const msgs: TransportMessage[] = [];
    const off = t.onMessage((m) => msgs.push(m));
    t.connect();
    expect(msgs).toEqual([{ kind: 'closed' }]);
    t.requestSnapshot();
    t.disconnect();
    expect(msgs).toHaveLength(1);
    off();
    t.connect();
    expect(msgs).toHaveLength(1); // unsubscribed
    expect(t.kind).toBe('null');
  });
});

describe('synchroniser optional-field branches', () => {
  test('handles workers/phases/projects without optional fields', () => {
    const store = new LiveStore();
    const sync = new StatusSynchroniser();
    const worker: import('../src/daemon/types.js').LiveWorker = {
      worker: 'w', provider: 'p', project: 'p', phase: 'X', status: 'idle', online: true, updatedAt: 't',
    };
    sync.applySnapshot(
      store,
      makeSnapshot({
        workers: [worker],
        phases: [{ project: 'p', phase: 'X', stage: 'created', status: 'draft', validators: 'unknown', decisionRequired: false, worker: 'w', blockers: [] }],
        projects: [{ project: 'p', phase: 'X', stage: 'created', worker: 'w', validators: 'unknown', decisionRequired: false }],
      }),
    );
    expect(store.getState().workers[0]?.currentAction).toBeUndefined();
    expect(store.getState().phases[0]?.branch).toBeUndefined();
    expect(store.getState().projects[0]?.branch).toBeUndefined();
  });
});

describe('inProcessTransport optional-field branches', () => {
  test('maps a worker/phase without currentAction/branch and an event without worker', () => {
    const phase: PhaseState = {
      project: 'app', phase: 'X', stage: 'ready', status: 'prompted', updatedAt: 't',
      worker: '', source: 'cli', version: '0.1.0', lastSeq: 0, validators: 'unknown', decisionRequired: false,
    };
    const worker: WorkerState = {
      id: 'w', project: 'app', phase: 'X', worker: 'w', provider: 'w', status: 'idle', online: true, updatedAt: 't',
    };
    const health: HealthSnapshot = {
      running: true, version: '0.1.0', uptimeMs: 0, projects: 0, workers: 0, watchers: 0,
      pendingEvents: 0, pendingPrompts: 0, pendingReports: 0, pendingApprovals: 0,
    };
    const daemon = {
      phaseStates: () => [phase],
      workers: new Map([['app:X:w', worker]]),
      health: () => health,
      notifications: [],
      bus: { subscribe: () => () => {} },
    } as unknown as BridgeDaemon;
    const t = new InProcessTransport(daemon);
    const msgs: TransportMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    t.connect();
    const snap = msgs[0];
    if (snap?.kind === 'snapshot') {
      expect(snap.snapshot.health.recovered).toBe(true); // phases.length>0
      expect(snap.snapshot.workers[0]?.currentAction).toBeUndefined();
      expect(snap.snapshot.phases[0]?.branch).toBeUndefined();
    }
  });

  test('recovered is false when there are no phases', () => {
    const health: HealthSnapshot = {
      running: true, version: '0.1.0', uptimeMs: 0, projects: 0, workers: 0, watchers: 0,
      pendingEvents: 0, pendingPrompts: 0, pendingReports: 0, pendingApprovals: 0,
    };
    const daemon = {
      phaseStates: () => [],
      workers: new Map(),
      health: () => health,
      notifications: [],
      bus: { subscribe: () => () => {} },
    } as unknown as BridgeDaemon;
    const t = new InProcessTransport(daemon);
    const msgs: TransportMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    t.connect();
    const snap = msgs[0];
    if (snap?.kind === 'snapshot') expect(snap.snapshot.health.recovered).toBe(false);
  });
});

describe('DaemonClient accessors', () => {
  test('exposes eventStream, healthStream, connectionState', () => {
    const sched = createFakeScheduler();
    const transport = createFakeTransport();
    const client = new DaemonClient(transport, sched);
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() });
    expect(client.eventStream.size).toBe(0);
    expect(client.healthStream.latest?.running).toBe(true);
    expect(client.connectionState).toBe('connected');
    client.stop();
  });
});
