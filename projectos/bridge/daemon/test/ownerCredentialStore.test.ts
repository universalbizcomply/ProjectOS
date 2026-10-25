import { describe, test, expect } from 'vitest';
import {
  DefaultOwnerCredentialStore, InMemoryRecordStore, validateCredentialRecord, validateRpId, keyProtectionNotPromoted,
  type OwnerCredentialRecord,
} from '../src/attestation/index.js';
import { credentialDraft, CLOCK, NOW, issueTestKeyProtectionEvidence } from './attestation-helpers.js';

function store() {
  return new DefaultOwnerCredentialStore({ store: new InMemoryRecordStore<OwnerCredentialRecord>(), policy: 'test', clock: CLOCK });
}

describe('credential record validation', () => {
  test('a valid record passes', () => {
    expect(validateCredentialRecord(credentialDraft(), 'test').ok).toBe(true);
  });
  test('invalid base64url credential id fails', () => {
    const r = validateCredentialRecord(credentialDraft({ credentialId: 'not base64!' }), 'test');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('MALFORMED_RECORD');
  });
  test('unsupported algorithm fails', () => {
    const r = validateCredentialRecord(credentialDraft({ coseAlgorithm: -257 }), 'test');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('UNSUPPORTED_ALGORITHM');
  });
  test('keyProtection above UNKNOWN requires evidence', () => {
    const bad = validateCredentialRecord(credentialDraft({ keyProtection: 'TPM_ATTESTED' }), 'test');
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error.code).toBe('INVALID_KEY_PROTECTION');
    const good = validateCredentialRecord(credentialDraft({ keyProtection: 'OS_PROTECTED', keyProtectionEvidenceRef: 'ev-1' }), 'test');
    expect(good.ok).toBe(true);
  });
  test('a forbidden secret-bearing field fails closed', () => {
    const rec = { ...credentialDraft(), privateKey: 'leak' } as unknown as OwnerCredentialRecord;
    const r = validateCredentialRecord(rec, 'test');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('MALFORMED_RECORD');
  });
  test('production requires platform authenticator + user verification', () => {
    expect(validateCredentialRecord(credentialDraft({ authenticatorAttachment: 'cross-platform' }), 'production').ok).toBe(false);
    expect(validateCredentialRecord(credentialDraft({ userVerificationRequirement: 'preferred' }), 'production').ok).toBe(false);
    expect(validateCredentialRecord(credentialDraft(), 'production').ok).toBe(true);
  });
  test('keyProtection cannot be promoted on update', () => {
    expect(keyProtectionNotPromoted('OS_PROTECTED', 'TPM_ATTESTED')).toBe(false);
    expect(keyProtectionNotPromoted('TPM_ATTESTED', 'OS_PROTECTED')).toBe(true);
  });
});

describe('rp id validation', () => {
  test('placeholder rp id rejected in production', () => {
    const r = validateRpId('owner-trust.projectos.local', 'production');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('PLACEHOLDER_RP_ID');
    expect(validateRpId('com.universalbizcomply.projectos.control', 'production').ok).toBe(false);
  });
  test('scheme / port / wildcard / IP / whitespace rejected', () => {
    for (const bad of ['https://x.com', 'x.com:443', '*.x.com', '10.0.0.1', 'x .com', 'localhost']) {
      expect(validateRpId(bad, 'production').ok).toBe(false);
    }
  });
  test('valid domain accepted', () => {
    expect(validateRpId('attest.projectos-owner.net', 'production').ok).toBe(true);
  });
});

describe('credential store CRUD + transitions', () => {
  test('create then get, revoke is terminal', () => {
    const s = store();
    expect(s.create(credentialDraft()).ok).toBe(true);
    expect(s.get('cred-abc123')?.status).toBe('ACTIVE');
    const rev = s.revoke('cred-abc123', 0, 'stolen device');
    expect(rev.ok && rev.value.status).toBe('REVOKED');
    // a revoked credential cannot be disabled/reactivated
    const dis = s.disable('cred-abc123', 1);
    expect(dis.ok).toBe(false); if (!dis.ok) expect(dis.error.code).toBe('IMMUTABLE_FIELD_CHANGE');
  });
  test('duplicate credential id fails', () => {
    const s = store();
    s.create(credentialDraft());
    const dup = s.create(credentialDraft());
    expect(dup.ok).toBe(false); if (!dup.ok) expect(dup.error.code).toBe('CREDENTIAL_ALREADY_EXISTS');
  });
  test('stale revision fails', () => {
    const s = store();
    s.create(credentialDraft());
    const r = s.revoke('cred-abc123', 5, 'x');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('STALE_REVISION');
  });
  test('rotate records lineage and is terminal', () => {
    const s = store();
    s.create(credentialDraft());
    const rot = s.markRotated('cred-abc123', 0, 'cred-successor');
    expect(rot.ok && rot.value.status).toBe('ROTATED');
    expect(rot.ok && rot.value.rotationLineage).toContain('cred-successor');
  });
  test('recordLastUsed preserves immutable identity', () => {
    const s = store();
    s.create(credentialDraft());
    const u = s.recordLastUsed('cred-abc123', 0, '2026-07-13T00:01:00.000Z');
    expect(u.ok && u.value.lastUsedAt).toBe('2026-07-13T00:01:00.000Z');
    expect(u.ok && u.value.rpId).toBe('attest.projectos-owner.net');
  });
});

describe('device-bound production policy', () => {
  test.each([
    ['cross-platform attachment', { authenticatorAttachment: 'cross-platform' as const }],
    ['unknown attachment', { authenticatorAttachment: 'unknown' as const }],
    ['UV preferred', { userVerificationRequirement: 'preferred' as const }],
    ['discoverable', { discoverability: 'discoverable' as const }],
    ['unknown discoverability', { discoverability: 'unknown' as const }],
    ['backupEligibility true', { backupEligibility: true }],
    ['backupState true', { backupState: true }],
  ])('production rejects %s', (_l, over) => {
    expect(validateCredentialRecord(credentialDraft(over), 'production').ok).toBe(false);
  });
  test('a platform, UV-required, non-discoverable, non-backed-up credential is accepted', () => {
    expect(validateCredentialRecord(credentialDraft(), 'production').ok).toBe(true);
  });
});

describe('key-protection classification (verified evidence only)', () => {
  function keyEv(over: Record<string, unknown> = {}) {
    return issueTestKeyProtectionEvidence({ credentialId: 'cred-abc123', installationId: 'install-1', deviceReference: 'device-1', classification: 'OS_PROTECTED', verificationMethod: 'test', verifiedAt: NOW, evidenceRef: 'ev-1', ...over });
  }
  test('create rejects a caller-supplied key-protection above UNKNOWN', () => {
    const s = store();
    for (const kp of ['OS_PROTECTED', 'DEVICE_BOUND_VERIFIED', 'TPM_ATTESTED'] as const) {
      const r = s.create(credentialDraft({ credentialId: `cred-${kp}`, keyProtection: kp, keyProtectionEvidenceRef: 'forged-ref' }));
      expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('INVALID_KEY_PROTECTION');
    }
    // a UNKNOWN create succeeds and stays UNKNOWN
    expect(s.create(credentialDraft()).ok).toBe(true);
    expect(s.get('cred-abc123')?.keyProtection).toBe('UNKNOWN');
  });
  test('classifyKeyProtection with verified test evidence promotes; a plain object is rejected', () => {
    const s = store(); s.create(credentialDraft());
    const bad = s.classifyKeyProtection('cred-abc123', 0, { meta: { classification: 'OS_PROTECTED' } } as never);
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error.code).toBe('INVALID_KEY_PROTECTION');
    const ok = s.classifyKeyProtection('cred-abc123', 0, keyEv());
    expect(ok.ok && ok.value.keyProtection).toBe('OS_PROTECTED');
  });
  test('evidence not bound to this credential/device is rejected', () => {
    const s = store(); s.create(credentialDraft());
    const r = s.classifyKeyProtection('cred-abc123', 0, keyEv({ deviceReference: 'other-device' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('CHALLENGE_BINDING_MISMATCH');
  });
  test('TPM_ATTESTED cannot be minted in this phase (test evidence)', () => {
    const s = store(); s.create(credentialDraft());
    const r = s.classifyKeyProtection('cred-abc123', 0, keyEv({ classification: 'TPM_ATTESTED' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('INVALID_KEY_PROTECTION');
  });
  test('a revoked credential cannot be classified', () => {
    const s = store(); s.create(credentialDraft());
    s.revoke('cred-abc123', 0, 'x');
    const r = s.classifyKeyProtection('cred-abc123', 1, keyEv());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('IMMUTABLE_FIELD_CHANGE');
  });
});
