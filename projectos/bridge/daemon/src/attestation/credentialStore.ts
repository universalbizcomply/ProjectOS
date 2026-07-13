/**
 * OwnerCredentialStore — typed CRUD + status transitions over a RecordStore. Enforces immutable
 * identity fields, optimistic concurrency, and one-way status (revoked/rotated can never return to
 * ACTIVE). This phase never enrolls a real credential; tests supply synthetic records under test
 * policy. Created in PROJECTOS-OWNER-ATTESTATION-STORE1A.
 */
import { failWith, succeed, type Outcome } from './errors.js';
import { requireWritable } from './policy.js';
import { isVerifiedKeyProtectionEvidence, type VerifiedKeyProtectionEvidence } from './capabilities.js';
import type { RecordStore } from './persistence.js';
import { keyProtectionNotPromoted, validateCredentialRecord } from './validation.js';
import { ATTESTATION_SCHEMA_VERSION, type AttestationPolicy, type CredentialStatus, type OwnerCredentialRecord, type StoreIntegrityStatus } from './types.js';

/** Fields that can never change after creation. */
const IMMUTABLE: readonly (keyof OwnerCredentialRecord)[] = [
  'credentialId', 'ownerReference', 'installationId', 'deviceReference', 'rpId',
  'publicKey', 'publicKeyFormat', 'signatureAlgorithm', 'coseAlgorithm', 'createdAt',
];

export interface OwnerCredentialStore {
  integrityStatus(): StoreIntegrityStatus;
  create(draft: OwnerCredentialRecord): Outcome<OwnerCredentialRecord>;
  get(credentialId: string): OwnerCredentialRecord | null;
  list(): readonly OwnerCredentialRecord[];
  revoke(credentialId: string, expectedRevision: number, reason: string): Outcome<OwnerCredentialRecord>;
  markRotated(credentialId: string, expectedRevision: number, successorCredentialId?: string): Outcome<OwnerCredentialRecord>;
  disable(credentialId: string, expectedRevision: number): Outcome<OwnerCredentialRecord>;
  recordLastUsed(credentialId: string, expectedRevision: number, at: string): Outcome<OwnerCredentialRecord>;
  /** Raise keyProtection ONLY with a genuinely-minted, operation-bound VerifiedKeyProtectionEvidence. */
  classifyKeyProtection(credentialId: string, expectedRevision: number, evidence: VerifiedKeyProtectionEvidence): Outcome<OwnerCredentialRecord>;
}

export class DefaultOwnerCredentialStore implements OwnerCredentialStore {
  readonly #store: RecordStore<OwnerCredentialRecord>;
  readonly #policy: AttestationPolicy;
  readonly #clock: () => string;

  constructor(deps: { store: RecordStore<OwnerCredentialRecord>; policy: AttestationPolicy; clock: () => string }) {
    this.#store = deps.store;
    this.#policy = deps.policy;
    this.#clock = deps.clock;
  }

  integrityStatus(): StoreIntegrityStatus { return this.#store.integrityStatus(); }

  create(draft: OwnerCredentialRecord): Outcome<OwnerCredentialRecord> {
    const gate = requireWritable(this.#policy, this.#store.integrityStatus());
    if (!gate.ok) return gate;
    // Creation NEVER trusts a caller-supplied key-protection above UNKNOWN — raising it needs
    // an opaque VerifiedKeyProtectionEvidence via classifyKeyProtection().
    if (draft.keyProtection !== undefined && draft.keyProtection !== 'UNKNOWN') {
      return failWith('INVALID_KEY_PROTECTION', 'keyProtection must start UNKNOWN; use classifyKeyProtection with verified evidence');
    }
    const at = this.#clock();
    const record: OwnerCredentialRecord = {
      ...draft, schemaVersion: ATTESTATION_SCHEMA_VERSION, recordRevision: 0,
      keyProtection: 'UNKNOWN', status: 'ACTIVE', createdAt: at, updatedAt: at, rotationLineage: draft.rotationLineage ?? [],
    };
    const v = validateCredentialRecord(record, this.#policy);
    if (!v.ok) return v;
    return this.#store.create(record.credentialId, record);
  }

  classifyKeyProtection(credentialId: string, expectedRevision: number, evidence: VerifiedKeyProtectionEvidence): Outcome<OwnerCredentialRecord> {
    if (!isVerifiedKeyProtectionEvidence(evidence)) return failWith('INVALID_KEY_PROTECTION', 'a verified key-protection evidence capability is required');
    const m = evidence.meta;
    if (this.#policy === 'production' && m.mode !== 'production') return failWith('INVALID_KEY_PROTECTION', 'synthetic key-protection evidence rejected under production');
    if (m.classification === 'UNKNOWN') return failWith('INVALID_KEY_PROTECTION', 'classification must be above UNKNOWN');
    if (m.classification === 'TPM_ATTESTED' && m.mode !== 'production') return failWith('INVALID_KEY_PROTECTION', 'TPM_ATTESTED cannot be minted in this phase');
    return this.#transition(credentialId, expectedRevision, (prev, at) => {
      if (prev.status === 'REVOKED' || prev.status === 'ROTATED') return failWith('IMMUTABLE_FIELD_CHANGE', `cannot classify a ${prev.status.toLowerCase()} credential`);
      if (m.credentialId !== prev.credentialId || m.installationId !== prev.installationId || m.deviceReference !== prev.deviceReference) {
        return failWith('CHALLENGE_BINDING_MISMATCH', 'evidence is not bound to this credential/device');
      }
      // Ordinary promotion guard is bypassed HERE only because the evidence is a verified capability.
      return succeed({ ...prev, keyProtection: m.classification, keyProtectionEvidenceRef: m.evidenceRef, recordRevision: prev.recordRevision + 1, updatedAt: at });
    }, { allowKeyProtectionChange: true });
  }

  get(credentialId: string): OwnerCredentialRecord | null { return this.#store.get(credentialId); }
  list(): readonly OwnerCredentialRecord[] { return this.#store.list(); }

  #transition(
    credentialId: string,
    expectedRevision: number,
    mutate: (prev: OwnerCredentialRecord, at: string) => Outcome<OwnerCredentialRecord>,
    opts: { allowKeyProtectionChange?: boolean } = {},
  ): Outcome<OwnerCredentialRecord> {
    const gate = requireWritable(this.#policy, this.#store.integrityStatus());
    if (!gate.ok) return gate;
    const prev = this.#store.get(credentialId);
    if (prev === null) return failWith('CREDENTIAL_NOT_FOUND', 'no such credential');
    if (prev.status === 'MALFORMED_BLOCKED') return failWith('MALFORMED_RECORD', 'credential is malformed-blocked');
    if (prev.recordRevision !== expectedRevision) return failWith('STALE_REVISION', 'revision mismatch');
    const at = this.#clock();
    const built = mutate(prev, at);
    if (!built.ok) return built;
    const next = built.value;
    for (const k of IMMUTABLE) {
      if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) return failWith('IMMUTABLE_FIELD_CHANGE', `immutable field changed: ${String(k)}`);
    }
    // Ordinary transitions may never promote keyProtection; only classifyKeyProtection (verified evidence) may.
    if (opts.allowKeyProtectionChange !== true && !keyProtectionNotPromoted(prev.keyProtection, next.keyProtection)) {
      return failWith('INVALID_KEY_PROTECTION', 'keyProtection cannot be promoted without verified evidence');
    }
    const v = validateCredentialRecord(next, this.#policy);
    if (!v.ok) return v;
    return this.#store.update(credentialId, expectedRevision, next);
  }

  #setStatus(prev: OwnerCredentialRecord, at: string, status: CredentialStatus, extra: Partial<OwnerCredentialRecord> = {}): Outcome<OwnerCredentialRecord> {
    if (status === 'ACTIVE' && (prev.status === 'REVOKED' || prev.status === 'ROTATED')) {
      return failWith(prev.status === 'REVOKED' ? 'CREDENTIAL_REVOKED' : 'CREDENTIAL_ROTATED', `cannot reactivate a ${prev.status.toLowerCase()} credential`);
    }
    return succeed({ ...prev, ...extra, status, recordRevision: prev.recordRevision + 1, updatedAt: at });
  }

  revoke(credentialId: string, expectedRevision: number, reason: string): Outcome<OwnerCredentialRecord> {
    return this.#transition(credentialId, expectedRevision, (prev, at) => this.#setStatus(prev, at, 'REVOKED', { revokedAt: at, revocationReason: reason }));
  }

  markRotated(credentialId: string, expectedRevision: number, successorCredentialId?: string): Outcome<OwnerCredentialRecord> {
    return this.#transition(credentialId, expectedRevision, (prev, at) =>
      this.#setStatus(prev, at, 'ROTATED', successorCredentialId !== undefined ? { rotationLineage: [...prev.rotationLineage, successorCredentialId] } : {}));
  }

  disable(credentialId: string, expectedRevision: number): Outcome<OwnerCredentialRecord> {
    return this.#transition(credentialId, expectedRevision, (prev, at) => {
      if (prev.status === 'REVOKED' || prev.status === 'ROTATED') return failWith('IMMUTABLE_FIELD_CHANGE', `cannot disable a ${prev.status.toLowerCase()} credential`);
      return this.#setStatus(prev, at, 'DISABLED');
    });
  }

  recordLastUsed(credentialId: string, expectedRevision: number, at: string): Outcome<OwnerCredentialRecord> {
    return this.#transition(credentialId, expectedRevision, (prev, now) => succeed({ ...prev, lastUsedAt: at, recordRevision: prev.recordRevision + 1, updatedAt: now }));
  }
}
