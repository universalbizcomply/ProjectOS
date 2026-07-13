/**
 * Runtime structural + policy validation for owner-attestation records (the daemon validates with
 * TypeScript, not JSON Schema). Fails closed. Rejects placeholder/invalid RP IDs and any
 * self-promoted key-protection or forbidden secret-bearing field under production.
 * Created in PROJECTOS-OWNER-ATTESTATION-STORE1A.
 */
import { failWith, succeed, type Outcome } from './errors.js';
import { ATTESTATION_SCHEMA_VERSION } from './types.js';
import type { AttestationChallengeRecord, AttestationPolicy, KeyProtection, OwnerCredentialRecord } from './types.js';

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** RFC1035-ish domain label syntax (no scheme/port/whitespace/wildcard/IP). */
const DOMAIN = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Known placeholders that must never pass production (do NOT hardcode a real production RP ID). */
const PLACEHOLDER_RP_IDS: ReadonlySet<string> = new Set([
  'com.universalbizcomply.projectos.control',
  'owner-trust.projectos.local',
  'example.com', 'example.org', 'localhost', 'changeme', 'change-me', 'placeholder', 'todo', 'test', 'test.local',
]);

const KEY_PROTECTION_RANK: Readonly<Record<KeyProtection, number>> = {
  UNKNOWN: 0, OS_PROTECTED: 1, DEVICE_BOUND_VERIFIED: 2, TPM_ATTESTED: 3,
};

/** Forbidden keys that must never appear on a stored credential (defence-in-depth). */
const FORBIDDEN_CREDENTIAL_KEYS: readonly string[] = [
  'privateKey', 'private_key', 'secret', 'password', 'pin', 'biometric', 'cookie', 'jwt', 'token',
  'accessToken', 'refreshToken', 'session', 'apiKey',
];

export function isBase64Url(s: string): boolean {
  return typeof s === 'string' && s.length > 0 && BASE64URL.test(s);
}

/** Validate an RP ID. Under production, placeholder/invalid values fail closed. */
export function validateRpId(rpId: string, policy: AttestationPolicy): Outcome<true> {
  if (typeof rpId !== 'string' || rpId.trim() === '') return failWith('INVALID_RP_ID', 'empty rpId');
  if (rpId !== rpId.trim() || /\s/.test(rpId)) return failWith('INVALID_RP_ID', 'rpId has whitespace');
  if (/:\/\//.test(rpId) || /:\d+$/.test(rpId)) return failWith('INVALID_RP_ID', 'rpId must not include a scheme or port');
  if (rpId.includes('*')) return failWith('INVALID_RP_ID', 'rpId must not contain a wildcard');
  if (IPV4.test(rpId)) return failWith('INVALID_RP_ID', 'rpId must not be an IP address');
  if (policy === 'production') {
    if (PLACEHOLDER_RP_IDS.has(rpId.toLowerCase())) return failWith('PLACEHOLDER_RP_ID', 'placeholder rpId rejected in production');
    if (rpId.toLowerCase() === 'localhost') return failWith('INVALID_RP_ID', 'localhost rejected in production');
    if (!DOMAIN.test(rpId)) return failWith('INVALID_RP_ID', 'rpId is not valid domain syntax');
  }
  return succeed(true);
}

/** Validate a strict owner-credential record. */
export function validateCredentialRecord(record: OwnerCredentialRecord, policy: AttestationPolicy): Outcome<true> {
  if (record.schemaVersion !== ATTESTATION_SCHEMA_VERSION) return failWith('UNSUPPORTED_SCHEMA_VERSION', 'unsupported schema version');
  for (const k of FORBIDDEN_CREDENTIAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, k)) return failWith('MALFORMED_RECORD', `forbidden field present: ${k}`);
  }
  if (!isBase64Url(record.credentialId)) return failWith('MALFORMED_RECORD', 'credentialId must be base64url');
  if (!isBase64Url(record.publicKey)) return failWith('INVALID_PUBLIC_KEY', 'publicKey must be base64url-encoded bytes');
  if (record.publicKeyFormat !== 'cose' && record.publicKeyFormat !== 'spki') return failWith('INVALID_PUBLIC_KEY', 'unsupported public key format');
  if (record.signatureAlgorithm !== 'ES256' || record.coseAlgorithm !== -7) return failWith('UNSUPPORTED_ALGORITHM', 'only ES256 (COSE -7) is permitted');
  const rp = validateRpId(record.rpId, policy);
  if (!rp.ok) return rp;
  // Key-protection: anything above UNKNOWN requires evidence; never inferred.
  if (KEY_PROTECTION_RANK[record.keyProtection] > 0 && (record.keyProtectionEvidenceRef ?? '').trim() === '') {
    return failWith('INVALID_KEY_PROTECTION', `keyProtection '${record.keyProtection}' requires an evidence reference`);
  }
  if (policy === 'production') {
    // Device-bound policy: the primary owner credential must NOT be a synced multi-device passkey
    // or an external authenticator.
    if (record.authenticatorAttachment !== 'platform') return failWith('MALFORMED_RECORD', 'production requires a platform authenticator (not cross-platform/unknown)');
    if (record.userVerificationRequirement !== 'required') return failWith('MALFORMED_RECORD', 'production requires user verification (not preferred/discouraged)');
    if (record.discoverability !== 'non-discoverable') return failWith('MALFORMED_RECORD', 'production requires a non-discoverable credential');
    if (typeof record.backupEligibility !== 'boolean' || record.backupEligibility !== false) return failWith('MALFORMED_RECORD', 'production requires backupEligibility=false (no synced passkey)');
    if (typeof record.backupState !== 'boolean' || record.backupState !== false) return failWith('MALFORMED_RECORD', 'production requires backupState=false (not backed up)');
  }
  return succeed(true);
}

/** A later update must not raise keyProtection or change an immutable identity field. */
export function keyProtectionNotPromoted(prev: KeyProtection, next: KeyProtection): boolean {
  return KEY_PROTECTION_RANK[next] <= KEY_PROTECTION_RANK[prev];
}

/** Validate a challenge record's structural shape. */
export function validateChallengeRecord(record: AttestationChallengeRecord, policy: AttestationPolicy): Outcome<true> {
  if (record.schemaVersion !== ATTESTATION_SCHEMA_VERSION) return failWith('UNSUPPORTED_SCHEMA_VERSION', 'unsupported schema version');
  if (record.nonceId.trim() === '' || record.nonceValue.trim() === '') return failWith('MALFORMED_RECORD', 'missing nonce id/value');
  if (!isBase64Url(record.credentialId)) return failWith('MALFORMED_RECORD', 'credentialId must be base64url');
  if (record.decision !== 'approved' && record.decision !== 'rejected') return failWith('MALFORMED_RECORD', 'invalid decision');
  if (record.operationFingerprint.trim() === '') return failWith('MALFORMED_RECORD', 'missing operation fingerprint');
  if (policy === 'production' && record.nonceClassification !== 'cryptographic') {
    return failWith('SYNTHETIC_REJECTED_IN_PRODUCTION', 'synthetic nonce rejected under production policy');
  }
  return succeed(true);
}
