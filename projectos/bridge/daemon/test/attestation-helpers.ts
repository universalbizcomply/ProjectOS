import {
  ATTESTATION_SCHEMA_VERSION, issueTestStoreProtection, issueTestNonceGenerator, issueTestKeyProtectionEvidence,
  BoundedFsRecordStore,
  type AttestationChallengeRecord, type OwnerCredentialRecord, type RawFs, type VerifiedStoreProtection, type VerifiedSecureNonceGenerator,
} from '../src/attestation/index.js';
import type { IssueInput, ChallengeBinding } from '../src/attestation/nonceLedger.js';

export const NOW = '2026-07-13T00:00:00.000Z';
export const CLOCK = (): string => NOW;

/** A TEST-mode store-protection capability (production rejects it). */
export function testProtection(rootId = 'C:/store/owner-trust/v1'): VerifiedStoreProtection { return issueTestStoreProtection(rootId); }
/** A TEST-mode secure-nonce capability (production rejects it). */
export function testNonceGen(seed = 0): VerifiedSecureNonceGenerator { return issueTestNonceGenerator(seed); }
export { issueTestKeyProtectionEvidence };

export function credentialDraft(over: Partial<OwnerCredentialRecord> = {}): OwnerCredentialRecord {
  return {
    schemaVersion: ATTESTATION_SCHEMA_VERSION, recordRevision: 0, credentialId: 'cred-abc123',
    ownerReference: 'owner-ref-1', installationId: 'install-1', deviceReference: 'device-1',
    rpId: 'attest.projectos-owner.net', credentialName: 'ProjectOS Owner',
    publicKeyFormat: 'cose', publicKey: 'cG92bGljS2V5Qnl0ZXM', signatureAlgorithm: 'ES256', coseAlgorithm: -7,
    authenticatorAttachment: 'platform', userVerificationRequirement: 'required', discoverability: 'non-discoverable',
    backupEligibility: false, backupState: false, keyProtection: 'UNKNOWN', status: 'ACTIVE',
    rotationLineage: [], createdAt: NOW, updatedAt: NOW, ...over,
  };
}

export function issueInput(over: Partial<IssueInput> = {}): IssueInput {
  return {
    nonceId: 'nonce-1', approvalId: 'appr-1', projectId: 'projectos', phaseId: 'PH1', environment: 'local',
    decision: 'approved', operationFingerprint: 'fp-abc', requestRevision: 3, credentialId: 'cred-abc123',
    issuedAt: NOW, expiresAt: '2026-07-13T00:05:00.000Z', ...over,
  };
}

export function binding(over: Partial<ChallengeBinding> = {}): ChallengeBinding {
  return { approvalId: 'appr-1', decision: 'approved', operationFingerprint: 'fp-abc', credentialId: 'cred-abc123', requestRevision: 3, ...over };
}

/** In-memory fake RawFs: a path→content map with idempotent realpath. */
export function fakeRawFs(): RawFs & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    readFile: (p) => map.get(p) ?? null,
    writeFile: (p, c) => { map.set(p, c); },
    rename: (from, to) => { const v = map.get(from); if (v === undefined) throw new Error('rename: missing source'); map.set(to, v); map.delete(from); },
    realpath: (p) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
    mkdirp: () => { /* no-op */ },
    readdir: (dir) => { const d = dir.replace(/\\/g, '/').replace(/\/+$/, ''); return [...map.keys()].filter((k) => k.startsWith(`${d}/`)).map((k) => k.slice(d.length + 1)); },
    removeFile: (p) => { map.delete(p); },
    exists: (p) => map.has(p),
    dump: () => map,
  };
}

/** A test-policy bounded-fs store for a record type. */
export function boundedTestStore<T extends { readonly recordRevision?: number; readonly revision?: number }>(root: string, protection: VerifiedStoreProtection | null = testProtection()) {
  return new BoundedFsRecordStore<T>({
    fs: fakeRawFs(), root, policy: 'test', protection, clock: CLOCK,
    parse: (raw) => { try { return JSON.parse(raw) as T; } catch { return null; } },
    serialise: (r) => JSON.stringify(r),
  });
}
