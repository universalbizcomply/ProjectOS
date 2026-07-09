import { describe, test, expect, vi } from 'vitest';
import {
  makeEvent,
  validateEvent,
  isCanonicalType,
  isInternalType,
  isKnownType,
} from '../src/events/eventTypes.js';
import { EventBus } from '../src/events/eventBus.js';
import {
  parseEventLog,
  nextSeq,
  appendEvent,
  eventsForPhase,
  latestOfType,
} from '../src/events/eventLog.js';
import type { BridgeEvent } from '../src/types.js';

function ev(over: Partial<BridgeEvent> = {}): BridgeEvent {
  return makeEvent({
    id: 'evt_1',
    seq: 0,
    type: 'PHASE_CREATED',
    project: 'p',
    phase: 'X1A',
    at: '2026-07-09T00:00:00.000Z',
    actor: 'agent',
    source: 'test',
    ...over,
  }) as BridgeEvent;
}

describe('event type guards', () => {
  test('classifies canonical/internal/known', () => {
    expect(isCanonicalType('PHASE_CREATED')).toBe(true);
    expect(isCanonicalType('WORKER_ONLINE')).toBe(false);
    expect(isInternalType('WORKER_ONLINE')).toBe(true);
    expect(isKnownType('SYNC_COMPLETED')).toBe(true);
    expect(isKnownType('NOPE')).toBe(false);
  });
});

describe('validateEvent', () => {
  test('accepts a well-formed canonical event', () => {
    expect(validateEvent(ev()).ok).toBe(true);
  });

  test('rejects non-canonical, bad actor, missing fields', () => {
    const bad = ev({ type: 'WORKER_ONLINE', actor: 'nobody' as never, project: '' });
    const r = validateEvent(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(1);
  });

  test('rejects a secret in the payload', () => {
    const bad = ev({ payload: { token: 'sbp_abcdefghijklmnopqrstuvwxyz012345' } });
    expect(validateEvent(bad).errors.some((e) => e.includes('secret'))).toBe(true);
  });

  test('rejects negative seq', () => {
    expect(validateEvent(ev({ seq: -1 })).errors.some((e) => e.includes('seq'))).toBe(true);
  });
});

describe('makeEvent', () => {
  test('includes optionals only when provided', () => {
    const e = makeEvent({
      id: 'i',
      seq: 1,
      type: 'FILES_CHANGED',
      project: 'p',
      phase: 'X',
      at: 't',
      actor: 'implementer',
      source: 's',
      worker: 'claude-code',
      relatedFiles: ['a.ts'],
    });
    expect(e.worker).toBe('claude-code');
    expect(e.relatedFiles).toEqual(['a.ts']);
    expect(e.decisionRequired).toBe(false);
  });
});

describe('EventBus', () => {
  test('publishes to subscribers and unsubscribes', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));
    bus.publish(ev());
    expect(seen).toEqual(['PHASE_CREATED']);
    expect(bus.size).toBe(1);
    off();
    bus.publish(ev());
    expect(seen).toHaveLength(1);
  });

  test('isolates a throwing subscriber', () => {
    const onError = vi.fn();
    const bus = new EventBus(onError);
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    bus.publish(ev());
    expect(onError).toHaveBeenCalledOnce();
    expect(seen).toEqual(['PHASE_CREATED']);
  });
});

describe('eventLog', () => {
  const line = (o: object) => JSON.stringify(o);

  test('parseEventLog keeps well-formed, drops the rest', () => {
    const text = [
      line({ id: 'a', seq: 0, type: 'PHASE_CREATED' }),
      line({ nope: true }),
      '{bad}',
    ].join('\n');
    const { events, skipped } = parseEventLog(text);
    expect(events).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  test('nextSeq ignores internal (-1) events', () => {
    const events = [ev({ seq: 0 }), ev({ seq: 5 }), ev({ seq: -1 })];
    expect(nextSeq(events)).toBe(6);
    expect(nextSeq([])).toBe(0);
  });

  test('appendEvent is immutable', () => {
    const a = [ev({ seq: 0 })];
    const b = appendEvent(a, ev({ seq: 1 }));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  test('eventsForPhase + latestOfType', () => {
    const events = [
      ev({ seq: 0, phase: 'A', type: 'PHASE_CREATED' }),
      ev({ seq: 1, phase: 'B', type: 'PHASE_CREATED' }),
      ev({ seq: 2, phase: 'A', type: 'FILES_CHANGED' }),
    ];
    expect(eventsForPhase(events, 'A')).toHaveLength(2);
    expect(latestOfType(events, 'PHASE_CREATED')?.phase).toBe('B');
    expect(latestOfType(events, 'NONE')).toBeUndefined();
  });
});
