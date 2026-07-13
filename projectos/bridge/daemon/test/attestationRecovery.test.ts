import { describe, test, expect } from 'vitest';
import {
  DefaultAttestationChallengeLedger, InMemoryRecordStore,
  type AttestationChallengeRecord,
} from '../src/attestation/index.js';
import { issueInput, binding, CLOCK, testNonceGen } from './attestation-helpers.js';

/** Reserve a nonce and return the shared store so a "restarted" ledger can be built over it. */
function reserved() {
  const store = new InMemoryRecordStore<AttestationChallengeRecord>();
  const l = new DefaultAttestationChallengeLedger({ store, policy: 'test', clock: CLOCK, nonceGenerator: testNonceGen() });
  l.issue(issueInput());
  l.reserve('nonce-1', 0, 'resv-1', binding());
  return { store, l };
}

describe('crash-safe reservation recovery', () => {
  test('a RESERVED nonce survives a daemon "restart" (new ledger over the same store)', () => {
    const { store } = reserved();
    const restarted = new DefaultAttestationChallengeLedger({ store, policy: 'test', clock: CLOCK, nonceGenerator: testNonceGen() });
    expect(restarted.get('nonce-1')?.state).toBe('RESERVED');
  });

  test('recovery finalizes CONSUMED only when the transaction resolver proves consumed', () => {
    const { store } = reserved();
    const restarted = new DefaultAttestationChallengeLedger({ store, policy: 'test', clock: CLOCK, nonceGenerator: testNonceGen() });
    const r = restarted.recover('nonce-1', () => 'consumed');
    expect(r.ok && r.value.state).toBe('CONSUMED');
  });

  test.each([['absent'], ['unknown']] as const)('uncertain reservation (%s) is BLOCKED, never silently released', (outcome) => {
    const { store } = reserved();
    const restarted = new DefaultAttestationChallengeLedger({ store, policy: 'test', clock: CLOCK, nonceGenerator: testNonceGen() });
    const r = restarted.recover('nonce-1', () => outcome);
    expect(r.ok && r.value.state).toBe('BLOCKED');
    expect(r.ok && r.value.failureCode).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    // never back to ISSUED, never released for reuse
    expect(store.get('nonce-1')?.state).toBe('BLOCKED');
  });

  test('a reserved nonce is never automatically released back to ISSUED', () => {
    const { l } = reserved();
    expect(l.get('nonce-1')?.state).toBe('RESERVED');
  });
});
