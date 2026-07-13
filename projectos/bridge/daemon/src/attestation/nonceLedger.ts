/**
 * AttestationChallengeLedger — persistent single-use challenge lifecycle: ISSUED → RESERVED →
 * CONSUMED (with EXPIRED / BLOCKED / INVALID terminals). A nonce can never be reused, a reserved
 * nonce is never silently released, and recovery of a reserved record consults an injected
 * transaction-outcome resolver (never the approval engine directly). No signing/verification here.
 * Created in PROJECTOS-OWNER-ATTESTATION-STORE1A.
 */
import { failWith, succeed, type Outcome } from './errors.js';
import { requireNonceGenerator, requireProductionNonceClass, requireWritable } from './policy.js';
import type { VerifiedSecureNonceGenerator } from './capabilities.js';
import type { RecordStore } from './persistence.js';
import { validateChallengeRecord } from './validation.js';
import { ATTESTATION_SCHEMA_VERSION, type AttestationChallengeRecord, type AttestationPolicy, type StoreIntegrityStatus } from './types.js';

export interface IssueInput {
  readonly nonceId: string;
  readonly approvalId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly environment: string;
  readonly decision: 'approved' | 'rejected';
  readonly operationFingerprint: string;
  readonly chatGptGateReference?: string;
  readonly requestRevision: number;
  readonly credentialId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** The binding a reservation/consume must match exactly (any change → CHALLENGE_BINDING_MISMATCH). */
export interface ChallengeBinding {
  readonly approvalId: string;
  readonly decision: 'approved' | 'rejected';
  readonly operationFingerprint: string;
  readonly credentialId: string;
  readonly requestRevision: number;
}

export type TransactionOutcome = 'consumed' | 'absent' | 'unknown';
export type TransactionOutcomeResolver = (record: AttestationChallengeRecord) => TransactionOutcome;

export interface AttestationChallengeLedger {
  integrityStatus(): StoreIntegrityStatus;
  issue(input: IssueInput): Outcome<AttestationChallengeRecord>;
  get(nonceId: string): AttestationChallengeRecord | null;
  reserve(nonceId: string, expectedRevision: number, reservationId: string, binding: ChallengeBinding): Outcome<AttestationChallengeRecord>;
  consume(nonceId: string, expectedRevision: number, reservationId: string, binding: ChallengeBinding, resultReference: string): Outcome<AttestationChallengeRecord>;
  expire(nonceId: string, expectedRevision: number): Outcome<AttestationChallengeRecord>;
  block(nonceId: string, expectedRevision: number, failureCode: string): Outcome<AttestationChallengeRecord>;
  recover(nonceId: string, resolve: TransactionOutcomeResolver): Outcome<AttestationChallengeRecord>;
}

export class DefaultAttestationChallengeLedger implements AttestationChallengeLedger {
  readonly #store: RecordStore<AttestationChallengeRecord>;
  readonly #policy: AttestationPolicy;
  readonly #clock: () => string;
  readonly #gen: VerifiedSecureNonceGenerator | null;

  constructor(deps: { store: RecordStore<AttestationChallengeRecord>; policy: AttestationPolicy; clock: () => string; nonceGenerator: VerifiedSecureNonceGenerator | null }) {
    this.#store = deps.store;
    this.#policy = deps.policy;
    this.#clock = deps.clock;
    this.#gen = deps.nonceGenerator;
  }

  integrityStatus(): StoreIntegrityStatus { return this.#store.integrityStatus(); }

  #expired(record: AttestationChallengeRecord): boolean {
    return Date.parse(this.#clock()) >= Date.parse(record.expiresAt);
  }

  #bindingMatches(record: AttestationChallengeRecord, b: ChallengeBinding): boolean {
    return record.approvalId === b.approvalId && record.decision === b.decision &&
      record.operationFingerprint === b.operationFingerprint && record.credentialId === b.credentialId &&
      record.requestRevision === b.requestRevision;
  }

  issue(input: IssueInput): Outcome<AttestationChallengeRecord> {
    const gate = requireWritable(this.#policy, this.#store.integrityStatus());
    if (!gate.ok) return gate;
    const g = requireNonceGenerator(this.#policy, this.#gen);
    if (!g.ok) return g;
    const at = this.#clock();
    const classification = g.value.mode === 'production' ? 'cryptographic' : 'synthetic-test';
    const record: AttestationChallengeRecord = {
      schemaVersion: ATTESTATION_SCHEMA_VERSION, revision: 0, nonceId: input.nonceId,
      nonceValue: g.value.next(), nonceClassification: classification,
      approvalId: input.approvalId, projectId: input.projectId, phaseId: input.phaseId, environment: input.environment,
      decision: input.decision, operationFingerprint: input.operationFingerprint,
      ...(input.chatGptGateReference !== undefined ? { chatGptGateReference: input.chatGptGateReference } : {}),
      requestRevision: input.requestRevision, credentialId: input.credentialId,
      issuedAt: input.issuedAt, expiresAt: input.expiresAt, state: 'ISSUED', createdAt: at, updatedAt: at,
    };
    const pc = requireProductionNonceClass(this.#policy, record.nonceClassification);
    if (!pc.ok) return pc;
    const v = validateChallengeRecord(record, this.#policy);
    if (!v.ok) return v;
    return this.#store.create(input.nonceId, record).ok
      ? succeed(record)
      : failWith('NONCE_ALREADY_EXISTS', 'nonce id already exists');
  }

  get(nonceId: string): AttestationChallengeRecord | null { return this.#store.get(nonceId); }

  reserve(nonceId: string, expectedRevision: number, reservationId: string, binding: ChallengeBinding): Outcome<AttestationChallengeRecord> {
    const gate = requireWritable(this.#policy, this.#store.integrityStatus());
    if (!gate.ok) return gate;
    const rec = this.#store.get(nonceId);
    if (rec === null) return failWith('NONCE_NOT_FOUND', 'no such nonce');
    if (rec.revision !== expectedRevision) return failWith('STALE_REVISION', 'revision mismatch');
    if (rec.state === 'CONSUMED') return failWith('NONCE_ALREADY_CONSUMED', 'nonce already consumed');
    if (rec.state === 'RESERVED') return failWith('NONCE_RESERVED', 'nonce already reserved');
    if (rec.state !== 'ISSUED') return failWith('MALFORMED_RECORD', `cannot reserve from ${rec.state}`);
    if (this.#expired(rec)) return this.#commit(nonceId, expectedRevision, { ...rec, state: 'EXPIRED' }, 'NONCE_EXPIRED');
    if (!this.#bindingMatches(rec, binding)) return failWith('CHALLENGE_BINDING_MISMATCH', 'reservation binding mismatch');
    const at = this.#clock();
    return this.#write(nonceId, expectedRevision, { ...rec, state: 'RESERVED', reservationId, reservedAt: at, revision: rec.revision + 1, updatedAt: at });
  }

  consume(nonceId: string, expectedRevision: number, reservationId: string, binding: ChallengeBinding, resultReference: string): Outcome<AttestationChallengeRecord> {
    const gate = requireWritable(this.#policy, this.#store.integrityStatus());
    if (!gate.ok) return gate;
    const rec = this.#store.get(nonceId);
    if (rec === null) return failWith('NONCE_NOT_FOUND', 'no such nonce');
    // Idempotent duplicate consume: identical reservation + result → return the prior consumed record.
    if (rec.state === 'CONSUMED') {
      if (rec.reservationId === reservationId && rec.resultReference === resultReference && this.#bindingMatches(rec, binding)) return succeed(rec);
      return failWith('NONCE_ALREADY_CONSUMED', 'nonce already consumed with a different transaction');
    }
    if (rec.revision !== expectedRevision) return failWith('STALE_REVISION', 'revision mismatch');
    if (rec.state !== 'RESERVED') return failWith('RESERVATION_MISMATCH', `cannot consume from ${rec.state}`);
    if (rec.reservationId !== reservationId) return failWith('RESERVATION_MISMATCH', 'reservation id mismatch');
    if (this.#expired(rec)) return this.#commit(nonceId, expectedRevision, { ...rec, state: 'EXPIRED' }, 'NONCE_EXPIRED');
    if (!this.#bindingMatches(rec, binding)) return failWith('CHALLENGE_BINDING_MISMATCH', 'consume binding mismatch');
    const at = this.#clock();
    return this.#write(nonceId, expectedRevision, { ...rec, state: 'CONSUMED', consumedAt: at, resultReference, revision: rec.revision + 1, updatedAt: at });
  }

  expire(nonceId: string, expectedRevision: number): Outcome<AttestationChallengeRecord> {
    const rec = this.#store.get(nonceId);
    if (rec === null) return failWith('NONCE_NOT_FOUND', 'no such nonce');
    if (rec.state === 'CONSUMED') return failWith('NONCE_ALREADY_CONSUMED', 'consumed nonce is immutable');
    if (rec.revision !== expectedRevision) return failWith('STALE_REVISION', 'revision mismatch');
    const at = this.#clock();
    return this.#write(nonceId, expectedRevision, { ...rec, state: 'EXPIRED', revision: rec.revision + 1, updatedAt: at });
  }

  block(nonceId: string, expectedRevision: number, failureCode: string): Outcome<AttestationChallengeRecord> {
    const rec = this.#store.get(nonceId);
    if (rec === null) return failWith('NONCE_NOT_FOUND', 'no such nonce');
    if (rec.state === 'CONSUMED') return failWith('NONCE_ALREADY_CONSUMED', 'consumed nonce is immutable');
    if (rec.revision !== expectedRevision) return failWith('STALE_REVISION', 'revision mismatch');
    const at = this.#clock();
    return this.#write(nonceId, expectedRevision, { ...rec, state: 'BLOCKED', failureCode, revision: rec.revision + 1, updatedAt: at });
  }

  /** Reconcile a RESERVED nonce after a restart: only a durably-consumed transaction may finalize it. */
  recover(nonceId: string, resolve: TransactionOutcomeResolver): Outcome<AttestationChallengeRecord> {
    const rec = this.#store.get(nonceId);
    if (rec === null) return failWith('NONCE_NOT_FOUND', 'no such nonce');
    if (rec.state === 'CONSUMED') return succeed(rec);
    if (rec.state !== 'RESERVED') return failWith('MALFORMED_RECORD', `cannot recover from ${rec.state}`);
    const at = this.#clock();
    const outcome = resolve(rec);
    if (outcome === 'consumed') {
      return this.#write(nonceId, rec.revision, { ...rec, state: 'CONSUMED', consumedAt: at, resultReference: rec.resultReference ?? 'recovered', revision: rec.revision + 1, updatedAt: at });
    }
    // Absent or uncertain → never silently release; block, require a new nonce.
    return this.#write(nonceId, rec.revision, { ...rec, state: 'BLOCKED', failureCode: 'TRANSACTION_OUTCOME_UNKNOWN', revision: rec.revision + 1, updatedAt: at });
  }

  #write(nonceId: string, expectedRevision: number, next: AttestationChallengeRecord): Outcome<AttestationChallengeRecord> {
    const v = validateChallengeRecord(next, this.#policy);
    if (!v.ok) return v;
    return this.#store.update(nonceId, expectedRevision, next);
  }

  /** Commit a terminal transition then report the intended failure code. */
  #commit(nonceId: string, expectedRevision: number, next: AttestationChallengeRecord, code: 'NONCE_EXPIRED'): Outcome<AttestationChallengeRecord> {
    const at = this.#clock();
    this.#store.update(nonceId, expectedRevision, { ...next, revision: next.revision + 1, updatedAt: at });
    return failWith(code, 'nonce expired');
  }
}
