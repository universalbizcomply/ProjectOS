import { describe, it, expect } from 'vitest';
import { can, isOwnerOnly, actionsFor } from '../src/permissions.js';
import {
  classifyAction,
  isGatedAction,
  DEFAULT_SAFETY_GATES,
  GATE_PATTERNS,
} from '../src/risk.js';
import { requestApproval, decide, isApproved } from '../src/approval.js';
import { GATE_KEYS } from '../src/types.js';

const AT = '2026-07-08T00:00:00.000Z';

describe('permissions', () => {
  it('lets the owner do everything', () => {
    for (const action of actionsFor('owner')) {
      expect(can('owner', action)).toBe(true);
    }
    expect(can('owner', 'close_phase')).toBe(true);
    expect(can('owner', 'implement')).toBe(true);
  });

  it('forbids implementer and advisor from approving or closing', () => {
    for (const role of ['implementer', 'advisor'] as const) {
      expect(can(role, 'approve')).toBe(false);
      expect(can(role, 'close_phase')).toBe(false);
      expect(can(role, 'override_gate')).toBe(false);
    }
  });

  it('lets the implementer implement but not architect', () => {
    expect(can('implementer', 'implement')).toBe(true);
    expect(can('implementer', 'architect_phase')).toBe(false);
  });

  it('lets the advisor architect and recommend closure', () => {
    expect(can('advisor', 'architect_phase')).toBe(true);
    expect(can('advisor', 'recommend_closure')).toBe(true);
    expect(can('advisor', 'implement')).toBe(false);
  });

  it('flags owner-only actions', () => {
    expect(isOwnerOnly('close_phase')).toBe(true);
    expect(isOwnerOnly('implement')).toBe(false);
  });
});

describe('risk engine', () => {
  it('defines all eight canonical gates', () => {
    expect(Object.keys(DEFAULT_SAFETY_GATES).sort()).toEqual([...GATE_KEYS].sort());
  });

  it('classifies known dangerous actions', () => {
    expect(classifyAction('deploy to prod').gate).toBe('productionDeployGate');
    expect(classifyAction('DROP TABLE users').gate).toBe('productionDbMutationGate');
    expect(classifyAction('issue a refund').gate).toBe('paymentGate');
    expect(classifyAction('send email to customers').gate).toBe('realMessagingGate');
    expect(classifyAction('print the API key').gate).toBe('secretsHandlingGate');
    expect(classifyAction('git push --force').gate).toBe('forcePushProhibition');
    // Closure approvals are owner-gated: an implementer must not be able to self-decide one.
    for (const action of [
      'close phase SANDBOX-PHASE-1',
      'closing phase SANDBOX-PHASE-1',
      'close the phase',
      // PAST TENSE must gate too — `clos(e|ing|ure)` alone cannot match "closed".
      'mark phase SANDBOX-PHASE-1 as closed',
      'phase SANDBOX-PHASE-1 closure',
      'phase SANDBOX-PHASE-1 closed',
    ]) {
      expect(classifyAction(action).gate).toBe('closureAuthorityGate');
      expect(classifyAction(action).gated).toBe(true);
    }
    // …and ordinary work that merely mentions both words is NOT swept in.
    for (const benign of [
      'close the modal in the UI',
      'close a GitHub issue in this phase',
      'close the file handle during this phase',
      'phase out the legacy closer',
    ]) {
      expect(classifyAction(benign).gated).toBe(false);
    }
  });

  it('gives every safety gate a matching pattern (no silently unreachable gate)', () => {
    // `GATE_RISK` is a Record<GateKey, ...> so TypeScript enforces exhaustiveness, but the pattern
    // table is a plain array and does not — which is exactly how `closureAuthorityGate` shipped
    // defined-but-unreachable. This test is the missing exhaustiveness check.
    const patterned = new Set(GATE_PATTERNS.map((p) => p.gate));
    for (const gate of Object.keys(DEFAULT_SAFETY_GATES)) {
      expect(patterned.has(gate as keyof typeof DEFAULT_SAFETY_GATES)).toBe(true);
    }
  });

  it('marks force push as prohibited and critical', () => {
    const c = classifyAction('force-push to main');
    expect(c.prohibited).toBe(true);
    expect(c.risk).toBe('critical');
    expect(c.gated).toBe(true);
  });

  it('treats unknown actions as low risk and ungated', () => {
    const c = classifyAction('rename a local variable');
    expect(c.gated).toBe(false);
    expect(c.prohibited).toBe(false);
    expect(c.risk).toBe('low');
    expect(c.gate).toBeUndefined();
  });

  it('isGatedAction is a convenience wrapper', () => {
    expect(isGatedAction('production deploy')).toBe(true);
    expect(isGatedAction('write a unit test')).toBe(false);
  });
});

describe('approval engine', () => {
  it('gated action: owner can approve, others cannot', () => {
    const req = requestApproval('a1', 'production deploy', 'implementer', AT);
    expect(req.gated).toBe(true);
    const denied = decide(req, 'approved', 'implementer', AT);
    expect(denied.ok).toBe(false);
    const approved = decide(req, 'approved', 'owner', AT, { note: 'ok' });
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(isApproved(approved.value)).toBe(true);
      expect(approved.value.decidedBy).toBe('owner');
      expect(approved.value.note).toBe('ok');
    }
  });

  it('prohibited action requires explicit override even for the owner', () => {
    const req = requestApproval('a2', 'force push', 'implementer', AT);
    expect(req.prohibited).toBe(true);
    const noOverride = decide(req, 'approved', 'owner', AT);
    expect(noOverride.ok).toBe(false);
    const withOverride = decide(req, 'approved', 'owner', AT, { override: true });
    expect(withOverride.ok).toBe(true);
  });

  it('owner may reject a prohibited action without override', () => {
    const req = requestApproval('a3', 'force push', 'implementer', AT);
    const rejected = decide(req, 'rejected', 'owner', AT);
    expect(rejected.ok).toBe(true);
    if (rejected.ok) expect(rejected.value.state).toBe('rejected');
  });

  it('ungated action can be self-approved by the requester', () => {
    const req = requestApproval('a4', 'refactor helper', 'implementer', AT);
    expect(req.gated).toBe(false);
    const r = decide(req, 'approved', 'implementer', AT);
    expect(r.ok).toBe(true);
  });

  it('cannot decide an already-decided request', () => {
    const req = requestApproval('a5', 'refactor', 'implementer', AT);
    const first = decide(req, 'approved', 'implementer', AT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = decide(first.value, 'rejected', 'owner', AT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain('already');
  });
});
