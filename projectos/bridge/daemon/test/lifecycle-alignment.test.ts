/**
 * Lifecycle alignment (PROJECTOS-V2-STABILISATION1A).
 *
 * Pins the daemon's phase-stage machine against the documented Core/CLI ↔ daemon alignment
 * (docs/architecture/projectos-phase-lifecycle-alignment.md). The intent: the daemon is the
 * stricter, authoritative delivery ledger — a phase must be committed + pushed (reach
 * ready_to_push/pushed) or rolled back before `closed`, and closure is never reachable from
 * `approved` directly. Governance (owner-only closure) is unchanged; these are guards, not
 * behaviour changes.
 */
import { describe, test, expect } from 'vitest';
import { isAllowedTransition, stageForEvent, stageToStatus } from '../src/state/stateMachine.js';
import type { PhaseStage } from '../src/types.js';

describe('phase lifecycle alignment', () => {
  test('closed is reachable ONLY from ready_to_push, pushed, or rolled_back', () => {
    const canClose = (from: PhaseStage) => isAllowedTransition(from, 'closed');
    // Allowed sources.
    expect(canClose('ready_to_push')).toBe(true);
    expect(canClose('pushed')).toBe(true);
    expect(canClose('rolled_back')).toBe(true);
    // NOT allowed — commit/push must happen first; no approved→closed shortcut.
    for (const from of [
      'created', 'ready', 'implementing', 'validating', 'evidence', 'awaiting_review',
      'approved', 'ready_to_commit', 'committed', 'blocked',
    ] as PhaseStage[]) {
      expect(canClose(from)).toBe(false);
    }
  });

  test('the commit/push spine is strict (each step advances by one)', () => {
    expect(isAllowedTransition('approved', 'ready_to_commit')).toBe(true);
    expect(isAllowedTransition('ready_to_commit', 'committed')).toBe(true);
    expect(isAllowedTransition('committed', 'ready_to_push')).toBe(true);
    expect(isAllowedTransition('ready_to_push', 'pushed')).toBe(true);
    // Cannot skip the spine.
    expect(isAllowedTransition('approved', 'committed')).toBe(false);
    expect(isAllowedTransition('approved', 'pushed')).toBe(false);
    expect(isAllowedTransition('committed', 'closed')).toBe(false);
  });

  test('the commit/push stages all persist as the Core status awaiting_closure', () => {
    for (const stage of ['approved', 'ready_to_commit', 'committed', 'ready_to_push', 'pushed'] as PhaseStage[]) {
      expect(stageToStatus(stage)).toBe('awaiting_closure');
    }
    expect(stageToStatus('awaiting_review')).toBe('awaiting_review');
    expect(stageToStatus('closed')).toBe('closed');
  });

  test('PHASE_CLOSED is an owner event that targets the closed stage', () => {
    // The daemon maps the owner-authored PHASE_CLOSED to the closed stage; adjacency (above)
    // then gates whether it is legal from the current stage.
    expect(stageForEvent('PHASE_CLOSED')).toBe('closed');
    // OWNER_APPROVED only reaches approved, never closed (no self-close / no shortcut).
    expect(stageForEvent('OWNER_APPROVED')).toBe('approved');
  });
});
