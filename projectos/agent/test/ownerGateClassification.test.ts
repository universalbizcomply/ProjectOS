/**
 * OWNER GATES ARE ENFORCED AS WRITTEN, NOT ONLY AS TOKENS — PROJECTOS-BOOT-CONTINUE1A.
 *
 * Plans v1.6 and v1.7 wrote their gates as sentences. The runtime compared gates against exact action
 * tokens, so "Commit, push, merge and phase closure remain owner-gated." reserved nothing, and under a
 * technical-continuation delegation the loop would have committed and pushed. These tests pin the
 * classification that closes that: named actions become tokens, and anything the runtime cannot
 * classify reserves every delegable technical action.
 */
import { describe, it, expect } from 'vitest';
import { TECHNICAL_ACTIONS } from '@projectos/core';
import { classifyOwnerGates } from '../src/loop/brief.js';

const ALL_TECHNICAL = [...TECHNICAL_ACTIONS];

describe('classifyOwnerGates', () => {
  it('keeps known tokens exactly and adds nothing when every gate is a known token', () => {
    expect(classifyOwnerGates(['secrets-handling', 'payment-or-live-charge'])).toEqual([
      'secrets-handling',
      'payment-or-live-charge',
    ]);
    expect(classifyOwnerGates(['commit', 'push'])).toEqual(['commit', 'push']);
  });

  it('reads the v1.7 prose gate as the actions it names', () => {
    const gates = classifyOwnerGates(['Commit, push, merge and phase closure remain owner-gated.']);
    for (const t of ['commit', 'push', 'ff-only-integration', 'phase-closure']) expect(gates).toContain(t);
  });

  it('FAIL CLOSED: prose naming no mappable action reserves every technical action', () => {
    const gates = classifyOwnerGates([
      'Implementation starts from the accepted clean baseline in a clean worktree, never from the primary checkout.',
    ]);
    for (const t of ALL_TECHNICAL) expect(gates).toContain(t);
  });

  it('FAIL CLOSED: prose naming a protected action with no token reserves every technical action', () => {
    const gates = classifyOwnerGates(['Commit and production deployment stay with the owner.']);
    for (const t of ALL_TECHNICAL) expect(gates).toContain(t);
  });

  it('FAIL CLOSED: an owner-named token the runtime does not know is kept and reserves every technical action', () => {
    const gates = classifyOwnerGates(['secrets-handling', 'owner-review']);
    expect(gates).toContain('owner-review');
    for (const t of ALL_TECHNICAL) expect(gates).toContain(t);
  });

  it('maps credentials and payment prose to their absolute owner-only tokens', () => {
    expect(classifyOwnerGates(['Credentials are handled by the owner only.'])).toContain('secrets-handling');
    expect(classifyOwnerGates(['No live charge or refund.'])).toContain('payment-or-live-charge');
  });

  it('ignores empty entries and never returns a duplicate', () => {
    const gates = classifyOwnerGates(['', 'commit', 'Commit stays owner-gated.']);
    expect(gates.filter((g) => g === 'commit')).toHaveLength(1);
    expect(gates).not.toContain('');
  });

  it('FAIL CLOSED: a mapped word beside an unmapped synonym for push reserves every technical action', () => {
    for (const prose of [
      'Closure and shipping the branch to origin stay with the owner.',
      'Closure, and publishing or uploading the work, stay with the owner.',
      'Closure and tagging a release stay with the owner.',
      // No synonym list can be complete, so ANY prose gate reserves every technical action.
      'Phase closure and landing on main stay with the owner.',
      'Phase closure and the pull request stay with the owner.',
      'Closure and check-in of the work stay with the owner.',
    ]) {
      const gates = classifyOwnerGates([prose]);
      for (const action of TECHNICAL_ACTIONS) expect(gates, prose).toContain(action);
    }
  });
});
