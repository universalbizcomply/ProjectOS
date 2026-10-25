import { describe, test, expect } from 'vitest';
import {
  BoundedFsRecordStore, DefaultAttestationChallengeLedger, InMemoryRecordStore,
  toSafeChallengeView, isWithinRoot,
  type AttestationChallengeRecord, type OwnerCredentialRecord,
} from '../src/attestation/index.js';
import { credentialDraft, issueInput, binding, CLOCK, fakeRawFs, testNonceGen, testProtection } from './attestation-helpers.js';

function fsCredStore(fs = fakeRawFs()) {
  return {
    fs,
    store: new BoundedFsRecordStore<OwnerCredentialRecord>({
      fs, root: 'C:/store/owner-trust/v1', policy: 'test', protection: null, clock: CLOCK,
      parse: (raw) => { try { return JSON.parse(raw) as OwnerCredentialRecord; } catch { return null; } },
      serialise: (r) => JSON.stringify(r),
    }),
  };
}

describe('nonce confidentiality', () => {
  test('safe challenge view redacts the nonce value', () => {
    const l = new DefaultAttestationChallengeLedger({ store: new InMemoryRecordStore<AttestationChallengeRecord>(), policy: 'test', clock: CLOCK, nonceGenerator: testNonceGen() });
    l.issue(issueInput());
    const rec = l.get('nonce-1'); expect(rec).not.toBeNull();
    const safe = toSafeChallengeView(rec!);
    expect(safe.nonceValue).toBe('[REDACTED]');
    expect(JSON.stringify(safe)).not.toContain('synthetic-test-nonce');
  });

  test('an error message never leaks the nonce value', () => {
    const l = new DefaultAttestationChallengeLedger({ store: new InMemoryRecordStore<AttestationChallengeRecord>(), policy: 'test', clock: CLOCK, nonceGenerator: testNonceGen() });
    l.issue(issueInput());
    const r = l.reserve('nonce-1', 0, 'resv-1', binding({ operationFingerprint: 'changed' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.message).not.toContain('nonce-');
  });
});

describe('no secret / no private key in credential records', () => {
  test('record shape carries no private key field', () => {
    const keys = Object.keys(credentialDraft());
    for (const forbidden of ['privateKey', 'private_key', 'secret', 'token', 'jwt', 'cookie', 'session', 'pin']) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
    }
  });
});

describe('bounded filesystem safety', () => {
  test('a key containing a path separator is blocked (traversal)', () => {
    const { store } = fsCredStore();
    const r = store.create('a/b', credentialDraft());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('PATH_TRAVERSAL_BLOCKED');
  });

  test('atomic replace: update writes the new record, no partial', () => {
    const { store, fs } = fsCredStore();
    store.create('cred-abc123', credentialDraft());
    const updated = { ...credentialDraft(), recordRevision: 1, credentialName: 'Rotated' };
    expect(store.update('cred-abc123', 0, updated).ok).toBe(true);
    expect(store.get('cred-abc123')?.credentialName).toBe('Rotated');
    // no abandoned temp file remains
    expect([...fs.dump().keys()].some((k) => k.includes('.tmp-'))).toBe(false);
  });

  test('malformed persisted JSON fails closed', () => {
    const { store, fs } = fsCredStore();
    fs.writeFile('C:/store/owner-trust/v1/cred-x.json', '{ not json');
    expect(store.get('cred-x')).toBeNull();
    const r = store.update('cred-x', 0, credentialDraft());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('MALFORMED_RECORD');
  });

  test('the store never writes outside its trust root', () => {
    expect(isWithinRoot('C:/store/owner-trust/v1', 'C:/store/owner-trust/v1/cred.json')).toBe(true);
    expect(isWithinRoot('C:/store/owner-trust/v1', 'C:/store/other/cred.json')).toBe(false);
  });
});

describe('no approval / no execution side effect', () => {
  test('the ledger only manages challenge state — no approval/decision execution API exists', () => {
    const l = new DefaultAttestationChallengeLedger({ store: new InMemoryRecordStore<AttestationChallengeRecord>(), policy: 'test', clock: CLOCK, nonceGenerator: testNonceGen() });
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(l));
    for (const forbidden of ['approve', 'decide', 'execute', 'commit', 'push', 'deploy', 'send']) {
      expect(api).not.toContain(forbidden);
    }
  });
});
