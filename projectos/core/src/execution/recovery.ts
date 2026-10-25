/**
 * Typed block-reason and recovery-strategy model.
 *
 * A record only ever enters BLOCKED / UNAVAILABLE with a CLOSED, typed reason — never a free-form
 * string — and each reason maps to exactly one allowed recovery strategy. A provider probe may
 * clear ONLY a state-unknown block; it can never clear an authority, identity, environment,
 * governance or malformed-record block. Pure/deterministic. Created in PROJECTOS-EXECUTION-RUNTIME-CORE1C.
 */

export type BlockReason =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_STATE_UNKNOWN'
  | 'PROVIDER_CAPABILITY_MISSING'
  | 'IDENTITY_MISMATCH'
  | 'AUTHORITY_REQUIRED'
  | 'ENVIRONMENT_UNVERIFIED'
  | 'MALFORMED_RECORD'
  | 'CONCURRENCY_CONFLICT'
  | 'GOVERNANCE_GUARD'
  | 'OWNER_ACTION_REQUIRED'
  | 'RECOVERY_REQUIRED'
  | 'OTHER_FAIL_CLOSED';

export type RecoveryStrategy =
  | 'RECHECK_PROVIDER_AVAILABILITY'
  | 'PROBE_PROVIDER_STATE'
  | 'REVERIFY_IDENTITY'
  | 'REVERIFY_ENVIRONMENT'
  | 'REQUIRE_TRUSTED_OWNER_ACTION'
  | 'RELOAD_AND_VALIDATE_RECORD'
  | 'REQUIRE_NEW_OPERATION'
  | 'NOT_RECOVERABLE';

/** The single allowed recovery strategy for each block reason. */
export const BLOCK_REASON_STRATEGY: Readonly<Record<BlockReason, RecoveryStrategy>> = {
  PROVIDER_UNAVAILABLE: 'RECHECK_PROVIDER_AVAILABILITY',
  PROVIDER_STATE_UNKNOWN: 'PROBE_PROVIDER_STATE',
  PROVIDER_CAPABILITY_MISSING: 'RECHECK_PROVIDER_AVAILABILITY',
  IDENTITY_MISMATCH: 'REQUIRE_NEW_OPERATION',
  AUTHORITY_REQUIRED: 'REQUIRE_TRUSTED_OWNER_ACTION',
  ENVIRONMENT_UNVERIFIED: 'REVERIFY_ENVIRONMENT',
  MALFORMED_RECORD: 'RELOAD_AND_VALIDATE_RECORD',
  CONCURRENCY_CONFLICT: 'RELOAD_AND_VALIDATE_RECORD',
  GOVERNANCE_GUARD: 'REQUIRE_TRUSTED_OWNER_ACTION',
  OWNER_ACTION_REQUIRED: 'REQUIRE_TRUSTED_OWNER_ACTION',
  RECOVERY_REQUIRED: 'PROBE_PROVIDER_STATE',
  OTHER_FAIL_CLOSED: 'NOT_RECOVERABLE',
};

/** A provider probe may clear ONLY a state-unknown block. Never authority/identity/env/governance/malformed. */
const PROBE_CLEARABLE: ReadonlySet<BlockReason> = new Set<BlockReason>(['PROVIDER_STATE_UNKNOWN', 'RECOVERY_REQUIRED']);
/** Reasons whose recovery re-checks provider availability/capability (no operation-state probe). */
const RECHECK_AVAILABILITY: ReadonlySet<BlockReason> = new Set<BlockReason>(['PROVIDER_UNAVAILABLE', 'PROVIDER_CAPABILITY_MISSING']);

export function recoveryStrategyFor(reason: BlockReason): RecoveryStrategy {
  return BLOCK_REASON_STRATEGY[reason];
}

/** True iff a provider STATE probe is permitted for this reason. */
export function probeAllowedFor(reason: BlockReason): boolean {
  return PROBE_CLEARABLE.has(reason);
}

/** True iff recovery for this reason re-checks provider availability/capability (no state probe). */
export function rechecksAvailabilityFor(reason: BlockReason): boolean {
  return RECHECK_AVAILABILITY.has(reason);
}

/** Owner-visible, redacted default next action for a block reason. */
export function nextActionFor(reason: BlockReason): string {
  switch (recoveryStrategyFor(reason)) {
    case 'RECHECK_PROVIDER_AVAILABILITY': return 'Recover once the provider is available';
    case 'PROBE_PROVIDER_STATE': return 'Recover to re-probe the provider state';
    case 'REVERIFY_IDENTITY': return 'Re-verify the operation identity before recovery';
    case 'REVERIFY_ENVIRONMENT': return 'Re-verify the environment before recovery';
    case 'REQUIRE_TRUSTED_OWNER_ACTION': return 'A trusted owner action is required to resolve this operation';
    case 'RELOAD_AND_VALIDATE_RECORD': return 'Reload and validate the record, then recover';
    case 'REQUIRE_NEW_OPERATION': return 'Register a new operation to proceed';
    case 'NOT_RECOVERABLE': return 'This operation cannot be recovered; register a new operation';
  }
}
