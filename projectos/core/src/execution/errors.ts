/**
 * Typed, redacted execution errors + a richer Outcome than the string-only core Result, because
 * commands must return a stable error CODE (not just prose). Messages are short and never carry
 * secret material or raw provider output. Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A.
 */

export type ExecutionErrorCode =
  | 'INVALID_TRANSITION'
  | 'EXPECTED_STATE_MISMATCH'
  | 'DUPLICATE_OPERATION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'WRONG_PROJECT'
  | 'WRONG_PHASE'
  | 'WRONG_ENVIRONMENT'
  | 'UNAUTHORISED_ACTOR'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_CAPABILITY_UNSUPPORTED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_FAILURE'
  | 'MALFORMED_RECORD'
  | 'RECOVERY_REQUIRED'
  | 'TERMINAL_OPERATION'
  | 'NOT_FOUND'
  /** Production policy requires an explicitly-supplied cryptographic evidence hasher (fail-closed). */
  | 'INSECURE_EVIDENCE_HASHER'
  /** The requested recovery does not match the block's typed recovery strategy. */
  | 'RECOVERY_STRATEGY_MISMATCH';

export interface ExecutionError {
  readonly code: ExecutionErrorCode;
  readonly message: string;
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ExecutionError };

export function succeed<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function failWith<T = never>(code: ExecutionErrorCode, message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}
