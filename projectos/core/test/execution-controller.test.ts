import { describe, it, expect } from 'vitest';
import { setup, registerReq, mut, ownerCtx } from './execution-helpers.js';

function expectOk<T>(o: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!o.ok) throw new Error(`expected ok, got ${o.error.code}: ${o.error.message}`);
  return o.value;
}

describe('execution controller — lifecycle', () => {
  it('register -> start -> pause -> resume -> stop follows the happy path', () => {
    const { ctrl, store } = setup();
    expect(expectOk(ctrl.register(registerReq())).state).toBe('READY');
    expect(expectOk(ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY' }))).state).toBe('RUNNING');
    expect(expectOk(ctrl.pause(mut({ idempotencyKey: 'kp', expectedState: 'RUNNING' }))).state).toBe('PAUSED');
    expect(expectOk(ctrl.resume(mut({ idempotencyKey: 'kr', expectedState: 'PAUSED' }))).state).toBe('RUNNING');
    const stopped = expectOk(ctrl.stop(mut({ idempotencyKey: 'kt', expectedState: 'RUNNING' })));
    expect(stopped.state).toBe('STOPPED');
    expect(store.get('op1')?.state).toBe('STOPPED');
    expect(stopped.evidenceRef).not.toBeNull();
  });

  it('status and list read without mutating', () => {
    const { ctrl } = setup();
    ctrl.register(registerReq());
    expect(expectOk(ctrl.status({ operationId: 'op1', actor: ownerCtx(), requestedAt: '2026-07-13T00:00:00.000Z' })).changed).toBe(false);
    expect(expectOk(ctrl.list({ actor: ownerCtx(), requestedAt: '2026-07-13T00:00:00.000Z' }))).toHaveLength(1);
  });
});

describe('execution controller — identity binding & guards', () => {
  it('rejects wrong project / phase / environment', () => {
    const { ctrl } = setup();
    ctrl.register(registerReq());
    const wrongP = ctrl.start(mut({ idempotencyKey: 'a', expectedState: 'READY', projectId: 'other' }));
    const wrongPh = ctrl.start(mut({ idempotencyKey: 'b', expectedState: 'READY', phaseId: 'PHX' }));
    expect(wrongP.ok).toBe(false); if (!wrongP.ok) expect(wrongP.error.code).toBe('WRONG_PROJECT');
    expect(wrongPh.ok).toBe(false); if (!wrongPh.ok) expect(wrongPh.error.code).toBe('WRONG_PHASE');
  });

  it('blocks unknown/unsupported environment (never treats UNKNOWN as LOCAL)', () => {
    const { ctrl } = setup();
    const r = ctrl.register(registerReq({ environment: 'unknown' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('WRONG_ENVIRONMENT');
  });

  it('rejects an invalid transition (pause from READY)', () => {
    const { ctrl } = setup();
    ctrl.register(registerReq());
    const r = ctrl.pause(mut({ idempotencyKey: 'z', expectedState: 'READY' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('enforces expectedState (optimistic concurrency)', () => {
    const { ctrl } = setup();
    ctrl.register(registerReq());
    const r = ctrl.start(mut({ idempotencyKey: 'z', expectedState: 'RUNNING' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('EXPECTED_STATE_MISMATCH');
  });

  it('rejects duplicate operationId and malformed operationId', () => {
    const { ctrl } = setup();
    ctrl.register(registerReq());
    const dup = ctrl.register(registerReq({ idempotencyKey: 'k2' }));
    expect(dup.ok).toBe(false); if (!dup.ok) expect(dup.error.code).toBe('DUPLICATE_OPERATION');
    const bad = ctrl.register(registerReq({ operationId: 'bad id!', idempotencyKey: 'k3' }));
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error.code).toBe('MALFORMED_RECORD');
  });

  it('returns NOT_FOUND for a command on an unknown operation', () => {
    const { ctrl } = setup();
    const r = ctrl.start(mut({ operationId: 'nope', idempotencyKey: 'z', expectedState: 'READY' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('emergency stop forces CANCELLED via terminate (distinct from stop; never phase closure)', () => {
    const { ctrl, provider, store } = setup();
    ctrl.register(registerReq());
    ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY' }));
    const e = ctrl.emergencyStop(mut({ idempotencyKey: 'ke', expectedState: 'RUNNING' }));
    expect(expectOk(e).state).toBe('CANCELLED');
    expect(provider.calls.terminate).toBe(1);
    expect(provider.calls.stop).toBe(0);
    expect(store.get('op1')?.state).toBe('CANCELLED');
  });
});
