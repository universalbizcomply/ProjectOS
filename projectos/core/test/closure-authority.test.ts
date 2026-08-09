/**
 * Closure authority — turning an inert plan record into real, confined authority.
 *
 * `governance.closureDelegation` was recorded in plan v1.1 but read by nothing. Wiring it into the
 * closure decision is the moment it becomes capable of granting power, so every one of these is an
 * attempt to obtain closure that MUST fail. The single positive case is the narrow one the owner
 * actually delegated.
 *
 * The rule under test is not "the UI hides the button" — it is that the runtime refuses.
 */
import { describe, it, expect } from 'vitest';
import {
  authoriseClosure,
  grantNote,
  isImplementerIdentity,
  type ClosureAuthorityInput,
  type ClosureDelegation,
} from '../src/closureAuthority.js';
import { createPhase, transitionPhase, type Phase } from '../src/phase.js';
import { evaluateClosureEligibility, CLOSURE_READY_STATUS, type G4Facts } from '../src/closureEligibility.js';

/** A fully satisfied G4 gate. The delegation is necessary; this is the other half. */
const HEAD = 'a'.repeat(40);
function eligibleVerdict(phaseId = 'X1A') {
  const f: G4Facts = {
    governedProjectId: 'projectos', planProjectId: 'projectos', activePlanVersion: '1.2',
    planReady: true, planUnmetReasons: [], phaseId, phaseInActivePlan: true,
    phaseStatus: CLOSURE_READY_STATUS, validatorsPass: true, checksPass: true,
    evidenceReportPresent: true, headedProofRequired: false, headedProofPass: true,
    reviewsComplete: true, unresolvedCriticalOrHigh: 0, protectedEffectOccurred: false,
    implementationHead: HEAD, remoteReconciled: true, workingTreeClean: true,
    delegationValidForProject: true, authorityAssertedByCaller: false,
    decisionBoundToPhaseId: phaseId, evidenceSubjectHead: HEAD,
    subjectIsAncestorOfHead: true, substantiveChangesSinceSubject: [],
  };
  return evaluateClosureEligibility(f);
}

const DELEGATION: ClosureDelegation = {
  delegatedBy: 'Murad',
  delegatedTo: 'ChatGPT',
  delegationDate: '2026-08-09',
  delegatedScope: ['phase-closure', 'programme-closure'],
  projectScope: 'projectos',
  excludesProtectedActions: true,
};

function input(over: Partial<ClosureAuthorityInput> = {}): ClosureAuthorityInput {
  return {
    governedProjectId: 'projectos',
    planProjectId: 'projectos',
    owner: 'Murad',
    implementer: 'Claude Code',
    closureAuthority: 'ChatGPT',
    delegation: DELEGATION,
    actorRole: 'advisor',
    actorIdentity: 'ChatGPT',
    scope: 'phase-closure',
    eligibility: eligibleVerdict(),
    ...over,
  };
}

/** Drive a phase to the only state closure is legal from. */
function atAwaitingClosure(): Phase {
  let p = createPhase({ phaseId: 'X1A', project: 'ProjectOS', objective: 'o' });
  for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure'] as const) {
    const r = transitionPhase(p, to, 'implementer', '2026-08-09T00:00:00Z');
    if (!r.ok) throw new Error(`setup failed at ${to}: ${r.error}`);
    p = r.value;
  }
  return p;
}

describe('the delegated close that was actually granted', () => {
  it('W15 the gatekeeper may close ProjectOS phases under the recorded delegation', () => {
    const r = authoriseClosure(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.basis).toBe('delegated');
      expect(r.value.authorisedIdentity).toBe('ChatGPT');
      expect(grantNote(r.value)).toContain('projectos-scoped phase-closure delegation');
    }
  });

  it('the grant actually closes the phase, and the basis is auditable in history', () => {
    const grant = authoriseClosure(input());
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const r = transitionPhase(atAwaitingClosure(), 'closed', 'advisor', '2026-08-09T01:00:00Z', grantNote(grant.value), grant.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('closed');
      const last = r.value.history[r.value.history.length - 1];
      expect(last?.by).toBe('advisor');
      expect(last?.note).toContain('ChatGPT');
    }
  });

  it('the owner can still close directly, with no delegation involved', () => {
    const r = authoriseClosure(input({ actorRole: 'owner', actorIdentity: 'Murad', delegation: null }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.basis).toBe('owner');
  });
});

describe('the implementer can never close, by any route', () => {
  it('W13 refused by role', () => {
    const r = authoriseClosure(input({ actorRole: 'implementer', actorIdentity: 'Claude Code' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('IMPLEMENTER_CANNOT_CLOSE');
  });

  it('refused when claiming the advisor role under an implementer identity', () => {
    for (const id of ['Claude Code', 'claude', 'Claude Opus 5', 'Anthropic', 'some-ai', 'helper bot']) {
      const r = authoriseClosure(input({ actorRole: 'advisor', actorIdentity: id }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('IMPLEMENTER_CANNOT_CLOSE');
    }
  });

  it('refused even if the plan itself tried to delegate to the implementer', () => {
    const r = authoriseClosure(
      input({ delegation: { ...DELEGATION, delegatedTo: 'Claude Code' }, actorIdentity: 'Claude Code' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('IMPLEMENTER_CANNOT_CLOSE');
  });

  it('the state machine refuses implementer closure independently of the authority module', () => {
    // Second, independent check at the point of effect: even holding a valid grant, role
    // `implementer` cannot reach `closed`.
    const grant = authoriseClosure(input());
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const r = transitionPhase(atAwaitingClosure(), 'closed', 'implementer', '2026-08-09T01:00:00Z', undefined, grant.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("requires role 'owner'");
  });
});

describe('a delegation cannot escape its project or its scope', () => {
  it('W16 the same advisor action on another project is refused', () => {
    const r = authoriseClosure(input({ governedProjectId: 'polygo', planProjectId: 'polygo' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('DELEGATION_WRONG_PROJECT');
  });

  it('a ProjectOS delegation carried into another project is refused', () => {
    // The exact leak this guards: PolyGo's runtime somehow reading ProjectOS's delegation record.
    const r = authoriseClosure(input({ governedProjectId: 'polygo' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('DELEGATION_WRONG_PROJECT');
  });

  it('W14 a scope the owner did not delegate is refused', () => {
    const r = authoriseClosure(
      input({ delegation: { ...DELEGATION, delegatedScope: ['phase-closure'] }, scope: 'programme-closure' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('DELEGATION_SCOPE_MISMATCH');
  });

  it('a delegation that does not exclude protected actions is refused', () => {
    const r = authoriseClosure(input({ delegation: { ...DELEGATION, excludesProtectedActions: false } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('DELEGATION_CARRIES_PROTECTED_ACTIONS');
  });

  it('a delegation granted by anyone but the owner is refused', () => {
    const r = authoriseClosure(input({ delegation: { ...DELEGATION, delegatedBy: 'ChatGPT' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('DELEGATION_WRONG_DELEGATOR');
  });

  it('an actor who is not the delegate is refused', () => {
    const r = authoriseClosure(input({ actorIdentity: 'Someone Else' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('DELEGATION_WRONG_ACTOR');
  });

  it('a delegated close with no stated identity is refused', () => {
    const r = authoriseClosure(input({ actorIdentity: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ACTOR_IDENTITY_MISSING');
  });

  it('closureAuthority disagreeing with the delegate is refused', () => {
    const r = authoriseClosure(input({ closureAuthority: 'Murad' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('AUTHORITY_DISAGREEMENT');
  });

  it('no delegation at all leaves closure owner-only, unchanged', () => {
    const r = authoriseClosure(input({ delegation: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('NO_DELEGATION');
  });

  it('a malformed delegation is refused rather than partially honoured', () => {
    for (const bad of [
      { ...DELEGATION, delegatedTo: '' },
      { ...DELEGATION, delegatedBy: '' },
      { ...DELEGATION, projectScope: '' },
      { ...DELEGATION, delegatedScope: [] },
    ]) {
      const r = authoriseClosure(input({ delegation: bad as ClosureDelegation }));
      expect(r.ok).toBe(false);
    }
  });

  it('an owner close under a name that is not the owner is refused', () => {
    const r = authoriseClosure(input({ actorRole: 'owner', actorIdentity: 'ChatGPT' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('OWNER_IDENTITY_MISMATCH');
  });
});

describe('a grant cannot be repurposed', () => {
  it('W17 a closure grant cannot authorise any non-closure transition', () => {
    const grant = authoriseClosure(input());
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const p = createPhase({ phaseId: 'Y1A', project: 'ProjectOS', objective: 'o' });
    const r = transitionPhase(p, 'prompted', 'advisor', '2026-08-09T01:00:00Z', undefined, grant.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('cannot authorise the transition');
  });

  it('closure without a grant is still refused for the advisor', () => {
    const r = transitionPhase(atAwaitingClosure(), 'closed', 'advisor', '2026-08-09T01:00:00Z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("requires role 'owner'");
  });

  it('an illegal transition is still illegal with a valid grant', () => {
    const grant = authoriseClosure(input());
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const draft = createPhase({ phaseId: 'Z1A', project: 'ProjectOS', objective: 'o' });
    const r = transitionPhase(draft, 'closed', 'advisor', '2026-08-09T01:00:00Z', undefined, grant.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Illegal transition');
  });
});

describe('implementer-identity detection', () => {
  it('catches spelling variants and leaves real people alone', () => {
    for (const id of ['Claude', 'claude-code', 'ClaudeCode', 'Anthropic', 'an AI', 'assistant', 'copilot', 'llm']) {
      expect(isImplementerIdentity(id)).toBe(true);
    }
    for (const id of ['Murad', 'ChatGPT', 'Alice', 'gatekeeper']) {
      expect(isImplementerIdentity(id)).toBe(false);
    }
  });
});
