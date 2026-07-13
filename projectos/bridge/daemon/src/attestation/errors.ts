/**
 * Typed, redacted errors + Outcome for the owner-attestation storage foundation.
 *
 * Messages are short and never carry a nonce value, private key, path, token, cookie, session or
 * stack trace. Created in PROJECTOS-OWNER-ATTESTATION-STORE1A.
 */
export type AttestationErrorCode =
  | 'STORE_PROTECTION_REQUIRED'
  | 'STORE_PROTECTION_INVALID'
  | 'INVALID_STORE_ROOT'
  | 'PATH_TRAVERSAL_BLOCKED'
  | 'MALFORMED_RECORD'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'CREDENTIAL_ALREADY_EXISTS'
  | 'CREDENTIAL_NOT_FOUND'
  | 'CREDENTIAL_REVOKED'
  | 'CREDENTIAL_ROTATED'
  | 'STALE_REVISION'
  | 'IMMUTABLE_FIELD_CHANGE'
  | 'INVALID_RP_ID'
  | 'PLACEHOLDER_RP_ID'
  | 'UNSUPPORTED_ALGORITHM'
  | 'INVALID_PUBLIC_KEY'
  | 'INVALID_KEY_PROTECTION'
  | 'NONCE_GENERATOR_REQUIRED'
  | 'NONCE_ALREADY_EXISTS'
  | 'NONCE_NOT_FOUND'
  | 'NONCE_EXPIRED'
  | 'NONCE_ALREADY_CONSUMED'
  | 'NONCE_RESERVED'
  | 'RESERVATION_MISMATCH'
  | 'CHALLENGE_BINDING_MISMATCH'
  | 'TRANSACTION_OUTCOME_UNKNOWN'
  | 'SYNTHETIC_REJECTED_IN_PRODUCTION'
  | 'PERSISTENCE_FAILURE'
  | 'INTERNAL_ERROR_REDACTED';

export interface AttestationError {
  readonly code: AttestationErrorCode;
  readonly message: string;
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AttestationError };

export function succeed<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function failWith<T = never>(code: AttestationErrorCode, message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}
