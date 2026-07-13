/**
 * Owner-attestation storage types — closed value sets only. No private key, no authentication
 * token/session, no PIN/biometric/cookie field exists anywhere in these records. This phase stores
 * public credential metadata + single-use challenge state; it never enrolls, signs or verifies.
 * Created in PROJECTOS-OWNER-ATTESTATION-STORE1A.
 */

export const ATTESTATION_SCHEMA_VERSION = '1.0.0' as const;

/** Policy under which a store/ledger operates. */
export type AttestationPolicy = 'production' | 'test';

/**
 * Closed key-protection classification. Default UNKNOWN. Anything above UNKNOWN must carry a
 * `keyProtectionEvidenceRef`; a caller can never self-select a stronger class and production policy
 * never silently promotes it.
 */
export type KeyProtection = 'UNKNOWN' | 'OS_PROTECTED' | 'DEVICE_BOUND_VERIFIED' | 'TPM_ATTESTED';

export type CredentialStatus = 'ACTIVE' | 'REVOKED' | 'ROTATED' | 'DISABLED' | 'MALFORMED_BLOCKED';
export type ChallengeState = 'ISSUED' | 'RESERVED' | 'CONSUMED' | 'EXPIRED' | 'BLOCKED' | 'INVALID';

/** Per-store integrity capability; approval/attestation paths require PRODUCTION_PROTECTION_READY. */
export type StoreIntegrityStatus =
  | 'TEST_ISOLATED'
  | 'PRODUCTION_PROTECTION_READY'
  | 'PRODUCTION_PROTECTION_UNAVAILABLE'
  | 'MALFORMED_BLOCKED';

export type AuthenticatorAttachment = 'platform' | 'cross-platform' | 'unknown';
export type UserVerificationRequirement = 'required' | 'preferred' | 'discouraged';
export type Discoverability = 'discoverable' | 'non-discoverable' | 'unknown';
export type PublicKeyFormat = 'cose' | 'spki';
export type NonceClassification = 'cryptographic' | 'synthetic-test';

/** Only ES256 is permitted in this phase. */
export type SignatureAlgorithm = 'ES256';

export interface RelyingPartyConfig {
  readonly rpId: string;
}

export interface OwnerCredentialRecord {
  readonly schemaVersion: string;
  readonly recordRevision: number;
  readonly credentialId: string; // base64url
  readonly ownerReference: string; // opaque, non-secret
  readonly installationId: string;
  readonly deviceReference: string;
  readonly rpId: string;
  readonly credentialName: string;
  readonly publicKeyFormat: PublicKeyFormat;
  readonly publicKey: string; // encoded public-key bytes (base64url); NEVER a private key
  readonly signatureAlgorithm: SignatureAlgorithm;
  readonly coseAlgorithm: number; // -7 for ES256
  readonly authenticatorAttachment: AuthenticatorAttachment;
  readonly userVerificationRequirement: UserVerificationRequirement;
  readonly discoverability: Discoverability;
  readonly backupEligibility: boolean;
  readonly backupState: boolean;
  readonly aaguid?: string;
  readonly attestationFormat?: string;
  readonly keyProtection: KeyProtection;
  readonly keyProtectionEvidenceRef?: string;
  readonly status: CredentialStatus;
  readonly enrolledAt?: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly predecessorCredentialId?: string;
  readonly rotationLineage: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AttestationChallengeRecord {
  readonly schemaVersion: string;
  readonly revision: number;
  readonly nonceId: string;
  readonly nonceValue: string; // SENSITIVE — redacted from safe views/logs/errors/reports
  readonly nonceClassification: NonceClassification;
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
  readonly state: ChallengeState;
  readonly reservationId?: string;
  readonly reservedAt?: string;
  readonly consumedAt?: string;
  readonly resultReference?: string;
  readonly failureCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A challenge view with the nonce value stripped — the only shape safe to log/serialise/report. */
export type SafeChallengeView = Omit<AttestationChallengeRecord, 'nonceValue'> & { readonly nonceValue: '[REDACTED]' };

export function toSafeChallengeView(record: AttestationChallengeRecord): SafeChallengeView {
  return { ...record, nonceValue: '[REDACTED]' };
}
