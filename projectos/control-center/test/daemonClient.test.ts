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
