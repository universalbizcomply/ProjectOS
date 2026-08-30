import { describe, test, expect } from 'vitest';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { createFakeScheduler, createFakeTransport, makeSnapshot, makeHealth } from './helpers.js';
import type { LiveEvent } from '../src/daemon/types.js';

const event = (over: Partial<LiveEvent> = {}): LiveEvent => ({
  id: 'e1', at: 't', type: 'FILES_CHANGED', project: 'p', phase: 'X', actor: 'implementer', ...over,
});

function setup() {
  const sched = createFakeScheduler();
  const transport = createFakeTransport();
  const client = new DaemonClient(transport, sched, {
    heartbeatMs: 1000,
    livenessTimeoutMs: 2000,
  });
  return { sched, transport, client };
}

describe('DaemonClient', () => {
  test('start connects and reports connecting', () => {
    const { transport, client } = setup();
    client.start();
    client.start(); // idempotent
    expect(transport.connects).toBe(1);
    expect(client.connectionState).toBe('connecting');
  });

  test('snapshot marks connected and populates store', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({
      kind: 'snapshot',
      snapshot: makeSnapshot({
        workers: [{ worker: 'claude-code', provider: 'claude-code', project: 'p', phase: 'X', status: 'implementing', online: true, updatedAt: 't' }],
      }),
    });
    expect(client.connectionState).toBe('connected');
    expect(client.store.getState().workers).toHaveLength(1);
    expect(client.store.getState().health?.running).toBe(true);
  });

  test('events append; pause freezes the visible list', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() });
    transport.emit({ kind: 'event', event: event({ id: 'a' }) });
    expect(client.store.getState().events).toHaveLength(1);
    client.setPaused(true);
    transport.emit({ kind: 'event', event: event({ id: 'b' }) });
    expect(client.store.getState().events).toHaveLength(1);
    client.setPaused(false);
    expect(client.store.getState().events).toHaveLength(2);
    expect(client.paused).toBe(false);
  });

  test('health and notification messages update the store', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'health', health: makeHealth({ uptimeMs: 42 }) });
    expect(client.store.getState().health?.uptimeMs).toBe(42);
    transport.emit({ kind: 'notification', notification: { kind: 'prompt-ready', project: 'p', phase: 'X', at: 't', message: 'm' } });
    expect(client.store.getState().notifications).toHaveLength(1);
  });

  test('heartbeat requests a snapshot while alive', () => {
    const { sched, transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() }); // marks message at t=0
    sched.advance(1000); // beat: alive → requestSnapshot
    expect(transport.snapshotRequests).toBe(1);
  });

  test('silent drop → disconnected → auto reconnect', () => {
    const { sched, transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() }); // last message at t=0
    // Beats at 1000, 2000 stay alive; by 3000 the 2000ms liveness window is exceeded.
    sched.advance(3000);
    expect(client.connectionState).toBe('disconnected');
    // Reconnect backoff (500ms) then a fresh connect.
    const connectsBefore = transport.connects;
    sched.advance(500);
    expect(client.connectionState).toBe('connecting');
    expect(transport.connects).toBe(connectsBefore + 1);
    expect(transport.disconnects).toBeGreaterThan(0);
  });

  test('governed state does not survive the connection that produced it', () => {
    const { sched, transport, client } = setup();
    client.start();
    // A live projection arrives and the surface would render it as canonical, live truth.
    transport.emit({
      kind: 'governed',
      state: { connected: true, projectId: 'projectos' } as never,
    });
    expect(client.store.getState().governed).toMatchObject({ connected: true });

    // The runtime then dies. Governed state is a LIVE claim, so it must not outlive the connection —
    // otherwise the owner keeps reading "Live · Canonical runtime state" against nothing at all.
    transport.emit({ kind: 'closed' });

    const governed = client.store.getState().governed;
    expect(governed).not.toBeNull();
    expect(governed!.connected).toBe(false);
    // and the owner is told what to do about it, not merely that something is wrong
    expect((governed as { detail: string }).detail).toContain('Restart ProjectOS');
  });

  test('closed message triggers reconnect', () => {
    const { sched, transport, client } = setup();
    client.start();
    transport.emit({ kind: 'closed' });
    expect(client.connectionState).toBe('disconnected');
    sched.advance(500);
    expect(client.connectionState).toBe('connecting');
  });

  test('stop tears down and ignores later messages', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() });
    client.stop();
    expect(transport.disconnects).toBeGreaterThan(0);
    expect(client.connectionState).toBe('disconnected');
    const before = client.store.getState().events.length;
    transport.emit({ kind: 'event', event: event({ id: 'z' }) }); // unsubscribed → ignored
    expect(client.store.getState().events.length).toBe(before);
  });
});

/* ------------------------------------------------------------------------------------------------
 * LIVENESS HAS EXACTLY ONE SOURCE — PROJECTOS-PROVIDER-RUNTIME-TRUTH-FIX1A.
 *
 * `governedRun.active` is what the Health surface is now allowed to call "Working". These prove the
 * link between the daemon that owns the child process and the store the surfaces read, and — the
 * part that matters for authority — that nothing else can set it.
 * --------------------------------------------------------------------------------------------- */
describe('the live run fact comes from the daemon and nowhere else', () => {
  test('nothing is live until the daemon says a run started', () => {
    const { client } = setup();
    client.start();
    expect(client.store.getState().governedRun.active).toBe(false);
  });

  test('run-started makes it live; run-finished ends it', () => {
    const { transport, client } = setup();
    client.start();

    transport.emit({ kind: 'run-started', phaseId: 'TWO', resumed: false } as never);
    expect(client.store.getState().governedRun.active).toBe(true);
    expect(client.store.getState().governedRun.phaseId).toBe('TWO');

    transport.emit({ kind: 'run-finished', phaseId: 'TWO', exitCode: 0 } as never);
    expect(client.store.getState().governedRun.active).toBe(false);
    expect(client.store.getState().governedRun.lastExitCode).toBe(0);
  });

  test('a governed snapshot full of started sessions does not make anything live', () => {
    // THE DEFECT, AT THE OTHER END OF THE WIRE. Session records arrive inside the governed state;
    // they are history. Only the daemon's own run events may move the live flag.
    const { transport, client } = setup();
    client.start();
    transport.emit({
      kind: 'governed',
      state: {
        connected: true,
        sessions: [
          { sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'started', exitCode: null },
        ],
      },
    } as never);
    expect(client.store.getState().governedRun.active).toBe(false);
  });

  test('a finished run does not resurrect on the next output line', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', phaseId: 'TWO', resumed: false } as never);
    transport.emit({ kind: 'run-finished', phaseId: 'TWO', exitCode: 1 } as never);
    transport.emit({ kind: 'run-output', phaseId: 'TWO', stream: 'stdout', line: 'trailing' } as never);
    expect(client.store.getState().governedRun.active).toBe(false);
  });
});
