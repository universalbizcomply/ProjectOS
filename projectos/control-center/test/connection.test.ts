import { describe, test, expect } from 'vitest';
import {
  ConnectionManager,
  ReconnectManager,
  Heartbeat,
  DaemonConnection,
  backoffDelay,
  BACKOFF_MAX_MS,
} from '../src/daemon/connection.js';
import { LiveStore } from '../src/daemon/store.js';
import { createFakeScheduler } from './helpers.js';

describe('ConnectionManager', () => {
  test('transitions and writes to store', () => {
    const store = new LiveStore();
    const cm = new ConnectionManager(store);
    cm.connecting(2);
    expect(cm.state).toBe('connecting');
    expect(store.getState().reconnectAttempt).toBe(2);
    cm.connected();
    expect(cm.state).toBe('connected');
    expect(store.getState().reconnectAttempt).toBe(0);
    cm.disconnected(3);
    expect(cm.state).toBe('disconnected');
    expect(store.getState().reconnectAttempt).toBe(3);
  });
});

describe('backoffDelay', () => {
  test('grows exponentially then caps', () => {
    expect(backoffDelay(0)).toBe(500);
    expect(backoffDelay(1)).toBe(1000);
    expect(backoffDelay(2)).toBe(2000);
    expect(backoffDelay(20)).toBe(BACKOFF_MAX_MS);
  });
});

describe('ReconnectManager', () => {
  test('schedules with growing delay, resets, cancels', () => {
    const sched = createFakeScheduler();
    const rm = new ReconnectManager(sched);
    let runs = 0;
    const d0 = rm.schedule(() => (runs += 1));
    expect(d0).toBe(500);
    expect(rm.attempt).toBe(1);
    sched.advance(500);
    expect(runs).toBe(1);
    const d1 = rm.schedule(() => (runs += 1));
    expect(d1).toBe(1000);
    rm.reset();
    expect(rm.attempt).toBe(0);
    sched.advance(2000); // cancelled by reset → no run
    expect(runs).toBe(1);
  });

  test('scheduling twice cancels the first', () => {
    const sched = createFakeScheduler();
    const rm = new ReconnectManager(sched);
    let a = 0;
    let b = 0;
    rm.schedule(() => (a += 1));
    rm.schedule(() => (b += 1)); // replaces
    sched.advance(5000);
    expect(a).toBe(0);
    expect(b).toBe(1);
  });
});

describe('Heartbeat', () => {
  test('re-arms each interval until stopped', () => {
    const sched = createFakeScheduler();
    const hb = new Heartbeat(sched, 1000);
    let beats = 0;
    hb.start(() => (beats += 1));
    expect(hb.running).toBe(true);
    sched.advance(1000);
    sched.advance(1000);
    sched.advance(1000);
    expect(beats).toBe(3);
    hb.stop();
    expect(hb.running).toBe(false);
    sched.advance(5000);
    expect(beats).toBe(3);
  });
});

describe('DaemonConnection', () => {
  test('tracks liveness window', () => {
    const c = new DaemonConnection();
    c.markMessage(1000);
    expect(c.lastMessageAt).toBe(1000);
    expect(c.isAlive(1500, 1000)).toBe(true);
    expect(c.isAlive(2500, 1000)).toBe(false);
  });
});
