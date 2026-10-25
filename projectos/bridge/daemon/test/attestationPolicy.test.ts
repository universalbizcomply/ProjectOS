import { describe, test, expect } from 'vitest';
import {
  DefaultOwnerCredentialStore, DefaultAttestationChallengeLedger, InMemoryRecordStore, BoundedFsRecordStore,
  effectiveIntegrityStatus, isVerifiedStoreProtection, isVerifiedSecureNonceGenerator,
  type OwnerCredentialRecord, type AttestationChallengeRecord, type VerifiedStoreProtection, type VerifiedSecureNonceGenerator,
} from '../src/attestation/index.js';
import { credentialDraft, issueInput, CLOCK, fakeRawFs, testProtection, testNonceGen } from './attestation-helpers.js';

function prodFsCred(protection: VerifiedStoreProtection | null) {
  const store = new BoundedFsRecordStore<OwnerCredentialRecord>({
    fs: fakeRawFs(), root: 'C:/store/owner-trust/v1', policy: 'production', protection, clock: CLOCK,
    parse: (raw) => { try { return JSON.parse(raw) as OwnerCredentialRecord; } catch { return null; } },
    serialise: (r) => JSON.stringify(r),
  });
  return new DefaultOwnerCredentialStore({ store, policy: 'production', clock: CLOCK });
}

describe('opaque capability forgeability', () => {
  test('a plain object cannot satisfy the store-protection capability', () => {
    const forged = { meta: { mode: 'production', verifierId: 'x', protectionVersion: 'v1', verifiedRootId: 'r', verifiedAt: CLOCK(), expiresAt: '9999-01-01T00:00:00.000Z', evidenceRef: 'e' } } as unknown as VerifiedStoreProtection;
    expect(isVerifiedStoreProtection(forged)).toBe(false);
    const s = prodFsCred(forged);
    expect(s.integrityStatus()).toBe('PRODUCTION_PROTECTION_UNAVAILABLE');
    const r = s.create(credentialDraft());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('STORE_PROTECTION_REQUIRED');
  });

  test('serialized protection metadata cannot restore the capability', () => {
    const cap = testProtection();
    const roundTripped = JSON.parse(JSON.stringify(cap)) as unknown;
    expect(isVerifiedStoreProtection(roundTripped)).toBe(false);
  });

  test('a plain generator marked cryptographic is not a verified capability', () => {
    const forged = { mode: 'production', next: () => 'x' } as unknown as VerifiedSecureNonceGenerator;
    expect(isVerifiedSecureNonceGenerator(forged)).toBe(false);
  });
});

describe('production fails closed (no production capability issuable this phase)', () => {
  test('production credential store with no protection fails closed', () => {
    const r = prodFsCred(null).create(credentialDraft());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('STORE_PROTECTION_REQUIRED');
  });

  test('a TEST protection capability is rejected under production policy', () => {
    const s = prodFsCred(testProtection());
    expect(s.integrityStatus()).toBe('PRODUCTION_PROTECTION_UNAVAILABLE');
    expect(s.create(credentialDraft()).ok).toBe(false);
  });

  test('production ledger cannot issue without a verified secure generator', () => {
    const l = new DefaultAttestationChallengeLedger({ store: new InMemoryRecordStore<AttestationChallengeRecord>(), policy: 'production', clock: CLOCK, nonceGenerator: null });
    const r = l.issue(issueInput());
    expect(r.ok).toBe(false);
  });

  test('a TEST nonce generator is rejected under production policy', () => {
    const store = new BoundedFsRecordStore<AttestationChallengeRecord>({
      fs: fakeRawFs(), root: 'C:/store/nonces/v1', policy: 'production', protection: testProtection('C:/store/nonces/v1'), clock: CLOCK,
      parse: (raw) => { try { return JSON.parse(raw) as AttestationChallengeRecord; } catch { return null; } },
      serialise: (r) => JSON.stringify(r),
    });
    const l = new DefaultAttestationChallengeLedger({ store, policy: 'production', clock: CLOCK, nonceGenerator: testNonceGen() });
    // store protection is a test cap → fails the protection gate first (still fail-closed).
    expect(l.issue(issueInput()).ok).toBe(false);
  });

  test('effectiveIntegrityStatus: test → TEST_ISOLATED; production without a verified cap → UNAVAILABLE', () => {
    expect(effectiveIntegrityStatus('test', null, CLOCK())).toBe('TEST_ISOLATED');
    expect(effectiveIntegrityStatus('production', null, CLOCK())).toBe('PRODUCTION_PROTECTION_UNAVAILABLE');
    expect(effectiveIntegrityStatus('production', testProtection(), CLOCK())).toBe('PRODUCTION_PROTECTION_UNAVAILABLE');
  });
});
