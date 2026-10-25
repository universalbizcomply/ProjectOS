import { describe, test, expect } from 'vitest';
import {
  DefaultAttestationChallengeLedger, InMemoryRecordStore,
  type AttestationChallengeRecord,
} from '../src/attestation/index.js';
import { issueInput, binding, CLOCK, testNonceGen } from './attestation-helpers.js';

function ledger(clock: () => string = CLOCK) {
  return new DefaultAttestationChallengeLedger({
    store: new InMemoryRecordStore<AttestationChallengeRecord>(), policy: 'test', clock,
    nonceGenerator: testNonceGen(),
  });
}

describe('nonce ledger lifecycle', () => {
  test('issue → reserve → consume', () => {
    const l = ledger();
    expect(l.issue(issueInput()).ok).toBe(true);
    expect(l.get('nonce-1')?.state).toBe('ISSUED');
    const r = l.reserve('nonce-1', 0, 'resv-1', binding());
    expect(r.ok && r.value.state).toBe('RESERVED');
    const c = l.consume('nonce-1', 1, 'resv-1', binding(), 'result-ref-1');
    expect(c.ok && c.value.state).toBe('CONSUMED');
  });

  test('duplicate issue fails', () => {
    const l = ledger();
    l.issue(issueInput());
    const dup = l.issue(issueInput());
    expect(dup.ok).toBe(false); if (!dup.ok) expect(dup.error.code).toBe('NONCE_ALREADY_EXISTS');
  });

  test('reserve with wrong binding (e.g. changed fingerprint/project) fails', () => {
    const l = ledger();
    l.issue(issueInput());
    const r = l.reserve('nonce-1', 0, 'resv-1', binding({ operationFingerprint: 'fp-CHANGED' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('CHALLENGE_BINDING_MISMATCH');
  });

  test('reserve stale revision fails; reserved cannot be re-reserved', () => {
    const l = ledger();
    l.issue(issueInput());
    expect(l.reserve('nonce-1', 9, 'resv-1', binding()).ok).toBe(false);
    l.reserve('nonce-1', 0, 'resv-1', binding());
    const again = l.reserve('nonce-1', 1, 'resv-2', binding());
    expect(again.ok).toBe(false); if (!again.ok) expect(again.error.code).toBe('NONCE_RESERVED');
  });

  test('consume requires the matching reservation id', () => {
    const l = ledger();
    l.issue(issueInput());
    l.reserve('nonce-1', 0, 'resv-1', binding());
    const c = l.consume('nonce-1', 1, 'WRONG', binding(), 'r');
    expect(c.ok).toBe(false); if (!c.ok) expect(c.error.code).toBe('RESERVATION_MISMATCH');
  });

  test('duplicate identical consume returns the prior result; conflicting consume fails', () => {
    const l = ledger();
    l.issue(issueInput());
    l.reserve('nonce-1', 0, 'resv-1', binding());
    l.consume('nonce-1', 1, 'resv-1', binding(), 'result-1');
    const dup = l.consume('nonce-1', 2, 'resv-1', binding(), 'result-1');
    expect(dup.ok && dup.value.state).toBe('CONSUMED');
    const conflict = l.consume('nonce-1', 2, 'resv-1', binding(), 'result-DIFFERENT');
    expect(conflict.ok).toBe(false); if (!conflict.ok) expect(conflict.error.code).toBe('NONCE_ALREADY_CONSUMED');
  });

  test('consumed nonce is immutable (expire/block refused)', () => {
    const l = ledger();
    l.issue(issueInput());
    l.reserve('nonce-1', 0, 'resv-1', binding());
    l.consume('nonce-1', 1, 'resv-1', binding(), 'r');
    expect(l.expire('nonce-1', 2).ok).toBe(false);
    expect(l.block('nonce-1', 2, 'x').ok).toBe(false);
  });

  test('expired nonce cannot reserve', () => {
    let t = '2026-07-13T00:00:00.000Z';
    const l = ledger(() => t);
    l.issue(issueInput({ expiresAt: '2026-07-13T00:00:10.000Z' }));
    t = '2026-07-13T00:10:00.000Z'; // past expiry
    const r = l.reserve('nonce-1', 0, 'resv-1', binding());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('NONCE_EXPIRED');
    expect(l.get('nonce-1')?.state).toBe('EXPIRED');
  });
});
