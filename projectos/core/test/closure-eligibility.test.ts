/**
 * G4 closure eligibility — proving `delegated: true` is not an authority token.
 *
 * A valid delegation says WHO MAY HOLD the conditional authority. These tests exist because that is
 * easy to mistake for "the conditions are met": without the gate, a caller asks for a delegated
 * close, the runtime finds a valid delegation, and the phase closes. Every case below is a closure
 * that must NOT happen, plus the single case that must.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateClosureEligibility,
  g4BasisNote,
  CLOSURE_READY_STATUS,
  type G4Facts,
} from '../src/closureEligibility.js';
import { authoriseClosure, type ClosureDelegation } from '../src/closureAuthority.js';

const HEAD = 'a'.repeat(40);

/** Every predicate satisfied. Each test breaks exactly one thing. */
function facts(over: Partial<G4Facts> = {}): G4Facts {
  return {
    governedProjectId: 'projectos',
    planProjectId: 'projectos',
    activePlanVersion: '1.2',
    planReady: true,
    planUnmetReasons: [],
    phaseId: 'PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A',
    phaseInActivePlan: true,
    phaseStatus: CLOSURE_READY_STATUS,
    validatorsPass: true,
    checksPass: true,
    evidenceReportPresent: true,
    headedProofRequired: true,
    headedProofPass: true,
    reviewsComplete: true,
    unresolvedCriticalOrHigh: 0,
    protectedEffectOccurred: false,
    implementationHead: HEAD,
    remoteReconciled: true,
    workingTreeClean: true,
    delegationValidForProject: true,
    authorityAssertedByCaller: false,
    decisionBoundToPhaseId: 'PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A',
    evidenceHead: HEAD,
    ...over,
  };
}

const DELEGATION: ClosureDelegation = {
  delegatedBy: 'Murad',
  delegatedTo: 'ChatGPT',
  delegationDate: '2026-08-09',
  delegatedScope: ['phase-closure', 'programme-closure'],
  projectScope: 'projectos',
  excludesProtectedActions: true,
};

function unmetCodes(over: Partial<G4Facts>): readonly string[] {
  return evaluateClosureEligibility(facts(over)).unmet.map((u) => u.code);
}

describe('C14 every predicate genuinely true — and only then', () => {
  it('is eligible, and enumerates what it checked rather than merely staying silent', () => {
    const v = evaluateClosureEligibility(facts());
    expect(v.eligible).toBe(true);
    expect(v.unmet).toEqual([]);
    expect(v.satisfied).toHaveLength(16);
    expect(g4BasisNote(facts())).toContain('pre-issued ChatGPT ProjectOS G4 gate');
  });

  it('C14 a delegated grant is minted when the delegation AND the gate both hold', () => {
    const r = authoriseClosure({
      governedProjectId: 'projectos',
      planProjectId: 'projectos',
      owner: 'Murad',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      delegation: DELEGATION,
      actorRole: 'advisor',
      actorIdentity: 'ChatGPT',
      scope: 'phase-closure',
      phaseId: facts().phaseId,
      eligibility: evaluateClosureEligibility(facts()),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.basis).toBe('delegated');
  });
});

describe('the delegation alone authorises nothing', () => {
  it('a delegated close with NO gate verdict is refused', () => {
    const r = authoriseClosure({
      governedProjectId: 'projectos',
      planProjectId: 'projectos',
      owner: 'Murad',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      delegation: DELEGATION,
      actorRole: 'advisor',
      actorIdentity: 'ChatGPT',
      scope: 'phase-closure',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('G4_NOT_ESTABLISHED');
  });

  it('a delegated close with an UNMET gate is refused, naming the predicates', () => {
    const r = authoriseClosure({
      governedProjectId: 'projectos',
      planProjectId: 'projectos',
      owner: 'Murad',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      delegation: DELEGATION,
      actorRole: 'advisor',
      actorIdentity: 'ChatGPT',
      scope: 'phase-closure',
      phaseId: facts().phaseId,
      eligibility: evaluateClosureEligibility(facts({ headedProofPass: null, validatorsPass: null })),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('G4_NOT_SATISFIED');
      expect(r.error).toContain('G4-8');
    }
  });

  it('an OWNER close is not conditional on this gate', () => {
    const r = authoriseClosure({
      governedProjectId: 'projectos',
      planProjectId: 'projectos',
      owner: 'Murad',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      delegation: DELEGATION,
      actorRole: 'owner',
      actorIdentity: 'Murad',
      scope: 'phase-closure',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.basis).toBe('owner');
  });
});

describe('each G4 predicate refuses on its own', () => {
  it('C1 the phase is not closure-ready', () => {
    for (const status of ['validating', 'implementing', 'draft', 'evidence', 'awaiting_review']) {
      expect(unmetCodes({ phaseStatus: status })).toContain('G4-4');
    }
  });

  it('C2 the required headed proof is absent or failing', () => {
    expect(unmetCodes({ headedProofPass: null })).toContain('G4-8');
    expect(unmetCodes({ headedProofPass: false })).toContain('G4-8');
    // ...and a phase that does not require one is not blocked by its absence.
    expect(unmetCodes({ headedProofRequired: false, headedProofPass: null })).not.toContain('G4-8');
  });

  it('C3 no durable evidence report', () => {
    expect(unmetCodes({ evidenceReportPresent: false })).toContain('G4-7');
  });

  it('C4 validators not recorded passing', () => {
    expect(unmetCodes({ validatorsPass: null })).toContain('G4-5');
    expect(unmetCodes({ validatorsPass: false })).toContain('G4-5');
    expect(unmetCodes({ checksPass: null })).toContain('G4-6');
  });

  it('C5 unresolved CRITICAL/HIGH, or an unestablished count', () => {
    expect(unmetCodes({ unresolvedCriticalOrHigh: 1 })).toContain('G4-10');
    expect(unmetCodes({ unresolvedCriticalOrHigh: null })).toContain('G4-10');
    expect(unmetCodes({ reviewsComplete: null })).toContain('G4-9');
  });

  it('C6 wrong project', () => {
    expect(unmetCodes({ governedProjectId: 'polygo', planProjectId: 'polygo' })).toContain('G4-1');
    expect(unmetCodes({ planProjectId: 'polygo' })).toContain('G4-1');
  });

  it('C7 the plan is not READY', () => {
    expect(unmetCodes({ planReady: false, planUnmetReasons: ['approval.approvalStatus is not approved'] })).toContain('G4-2');
  });

  it('C8 the phase is not in the active plan', () => {
    expect(unmetCodes({ phaseInActivePlan: false })).toContain('G4-3');
  });

  it('C9 a decision bound to another phase cannot be replayed', () => {
    expect(unmetCodes({ decisionBoundToPhaseId: 'PROJECTOS-V3-RELIABILITY-HARDENING1A' })).toContain('G4-16');
    expect(unmetCodes({ decisionBoundToPhaseId: '' })).toContain('G4-16');
  });

  it('C10 evidence established at a different head is stale', () => {
    const v = evaluateClosureEligibility(facts({ evidenceHead: 'b'.repeat(40) }));
    expect(v.eligible).toBe(false);
    expect(v.unmet.some((u) => u.code === 'G4-12' && u.detail.includes('re-establish'))).toBe(true);
  });

  it('C11 the caller supplied part of the authority', () => {
    expect(unmetCodes({ authorityAssertedByCaller: true })).toContain('G4-15');
  });

  it('C12 no valid project-scoped delegation', () => {
    expect(unmetCodes({ delegationValidForProject: false })).toContain('G4-14');
  });

  it('C13 a protected effect was recorded', () => {
    expect(unmetCodes({ protectedEffectOccurred: true })).toContain('G4-11');
  });

  it('the repository must be pushed, reconciled and clean', () => {
    expect(unmetCodes({ remoteReconciled: false })).toContain('G4-12');
    expect(unmetCodes({ implementationHead: null })).toContain('G4-12');
    expect(unmetCodes({ workingTreeClean: false })).toContain('G4-13');
  });

  it('reports EVERY unmet predicate, not just the first', () => {
    const v = evaluateClosureEligibility(
      facts({ phaseStatus: 'validating', headedProofPass: null, validatorsPass: null, workingTreeClean: false }),
    );
    expect(v.unmet.map((u) => u.code)).toEqual(expect.arrayContaining(['G4-4', 'G4-8', 'G4-5', 'G4-13']));
    expect(v.eligible).toBe(false);
  });
});
