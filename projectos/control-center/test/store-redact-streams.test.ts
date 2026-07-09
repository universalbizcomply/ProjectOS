import { describe, test, expect } from 'vitest';
import { LiveStore, INITIAL_STATE } from '../src/daemon/store.js';
import { redact, containsSecret } from '../src/daemon/redact.js';
import { EventStream, HealthStream, matchEvent, filterEvents } from '../src/daemon/eventStream.js';
import { makeHealth } from './helpers.js';
import type { LiveEvent } from '../src/daemon/types.js';

const ev = (over: Partial<LiveEvent> = {}): LiveEvent => ({
  id: 'e1', at: '2026-07-09T12:34:56.000Z', type: 'FILES_CHANGED', project: 'p', phase: 'X', actor: 'implementer', ...over,
});

describe('LiveStore', () => {
  test('notifies only on real change', () => {
    const store = new LiveStore();
    let n = 0;
    const off = store.subscribe(() => (n += 1));
    store.update({ connection: 'connected' });
    expect(store.getState().connection).toBe('connected');
    expect(n).toBe(1);
    store.update({ connection: 'connected' }); // same → no notify
    expect(n).toBe(1);
    store.update({}); // empty → no notify
    expect(n).toBe(1);
    off();
    store.update({ connection: 'disconnected' });
    expect(n).toBe(1);
    expect(store.listenerCount).toBe(0);
  });

  test('starts from INITIAL_STATE', () => {
    expect(new LiveStore().getState()).toEqual(INITIAL_STATE);
  });
});

describe('redact', () => {
  test('scrubs and detects secrets', () => {
    expect(redact('sbp_abcdefghijklmnopqrstuvwxyz012345')).toContain('[REDACTED]');
    expect(redact('vcp_abcdefghijklmnopqrstuvwx')).toContain('[REDACTED]');
    expect(redact('plain text')).toBe('plain text');
    expect(containsSecret('sb_secret_abcdefghijklmnopqrst')).toBe(true);
    expect(containsSecret('clean')).toBe(false);
  });
});

describe('EventStream', () => {
  test('prepends newest first and caps', () => {
    const s = new EventStream(2);
    s.push(ev({ id: 'a' }));
    s.push(ev({ id: 'b' }));
    const snap = s.push(ev({ id: 'c' }));
    expect(snap.map((e) => e.id)).toEqual(['c', 'b']);
    expect(s.size).toBe(2);
    s.clear();
    expect(s.size).toBe(0);
  });
});

describe('HealthStream', () => {
  test('keeps latest + bounded history', () => {
    const h = new HealthStream(2);
    expect(h.latest).toBeNull();
    h.set(makeHealth({ uptimeMs: 1 }));
    h.set(makeHealth({ uptimeMs: 2 }));
    h.set(makeHealth({ uptimeMs: 3 }));
    expect(h.latest?.uptimeMs).toBe(3);
    expect(h.history.map((x) => x.uptimeMs)).toEqual([2, 3]);
  });
});

describe('event filtering', () => {
  test('matchEvent honours each field + text search', () => {
    const e = ev({ project: 'app', worker: 'claude-code', type: 'FILES_CHANGED' });
    expect(matchEvent(e, {})).toBe(true);
    expect(matchEvent(e, { project: 'app' })).toBe(true);
    expect(matchEvent(e, { project: 'other' })).toBe(false);
    expect(matchEvent(e, { worker: 'claude-code' })).toBe(true);
    expect(matchEvent(e, { worker: 'gpt' })).toBe(false);
    expect(matchEvent(e, { type: 'FILES_CHANGED' })).toBe(true);
    expect(matchEvent(e, { type: 'OTHER' })).toBe(false);
    expect(matchEvent(e, { text: 'claude' })).toBe(true);
    expect(matchEvent(e, { text: 'zzz' })).toBe(false);
  });

  test('matchEvent text search covers actor when worker absent', () => {
    const e = ev({ worker: undefined, actor: 'owner' });
    expect(matchEvent(e, { text: 'owner' })).toBe(true);
  });

  test('filterEvents returns matching subset', () => {
    const list = [ev({ id: 'a', project: 'x' }), ev({ id: 'b', project: 'y' })];
    expect(filterEvents(list, { project: 'y' }).map((e) => e.id)).toEqual(['b']);
  });
});
