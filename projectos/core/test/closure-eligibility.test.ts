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
  isClosureTailPath,
  CLOSURE_READY_STATUS,
  CLOSURE_TAIL_PATHS,
  G4_PREDICATE_COUNT,
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
    evidenceSubjectHead: HEAD,
    subjectIsAncestorOfHead: true,
    substantiveChangesSinceSubject: [],
    requiredValidators: ['validate-all'],
    passingValidatorNames: ['validate-all', 'validate-desktop-e2e'],
    validationRecordProblems: [],
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
    expect(v.satisfied).toHaveLength(G4_PREDICATE_COUNT);
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
      // A verified gatekeeper decision. Eligibility alone stopped being sufficient after an
      // implementer closed Phase 18 with every predicate satisfied — see closure-decision.test.ts.
      decisionProblems: [],
      decisionId: 'GK-TEST-DECISION-0001',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.basis).toBe('delegated');
  });

  it('C14b the same fully eligible gate WITHOUT a decision refuses — eligibility is not a decision', () => {
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
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('GATEKEEPER_DECISION_NOT_ESTABLISHED');
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

  it('an OWNER close is not conditional on this gate — but it IS conditional on the owner deciding', () => {
    const ownerInput = {
      governedProjectId: 'projectos',
      planProjectId: 'projectos',
      owner: 'Murad',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      delegation: DELEGATION,
      actorRole: 'owner' as const,
      actorIdentity: 'Murad',
      scope: 'phase-closure' as const,
    };
    // `--as owner` is a caller-supplied string. Before the Phase-18 correction it was sufficient on
    // its own — no G4, no decision, nothing. That was the larger half of the same defect.
    expect(authoriseClosure(ownerInput).ok).toBe(false);
    expect(authoriseClosure({ ...ownerInput, decisionProblems: ['no decision'] }).ok).toBe(false);

    // With the owner's own verified decision it succeeds, and still without any G4 verdict: an
    // owner's authority is not conditional on the evidence gate, only on having actually decided.
    const r = authoriseClosure({ ...ownerInput, decisionProblems: [], decisionId: 'OWN-DECISION-0001' });
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

  it('C10/H4 a substantive change after the evidence subject is stale', () => {
    const v = evaluateClosureEligibility(
      facts({
        evidenceSubjectHead: 'b'.repeat(40),
        substantiveChangesSinceSubject: ['projectos/core/src/phase.ts'],
      }),
    );
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


/**
 * PROVENANCE — the deadlock, and the rule that replaced it.
 *
 * Requiring the evidence commit to EQUAL the closing commit was unsatisfiable: closure evidence lives
 * at a tracked path, so writing it dirties the tree, committing it advances HEAD past the evidence,
 * and re-pointing the evidence advances HEAD again. A tracked commit cannot contain its own SHA.
 *
 * What the equality protected is preserved exactly — the thing tested must be the thing closed — so
 * these tests are mostly attempts to slip a substantive change into the closure tail.
 */
describe('evidence-subject provenance', () => {
  const SUBJECT = 'b'.repeat(40);

  it('H1 subject == head, nothing changed since: eligible', () => {
    expect(evaluateClosureEligibility(facts()).eligible).toBe(true);
  });

  it('H3/H12 a descendant head carrying ONLY closure-tail metadata is accepted', () => {
    // This is the case the old rule made impossible, and it is the ordinary workflow.
    const v = evaluateClosureEligibility(
      facts({ evidenceSubjectHead: SUBJECT, subjectIsAncestorOfHead: true, substantiveChangesSinceSubject: [] }),
    );
    expect(v.eligible).toBe(true);
  });

  it('H8 a subject that is not an ancestor of the current head is refused', () => {
    const v = evaluateClosureEligibility(
      facts({ evidenceSubjectHead: SUBJECT, subjectIsAncestorOfHead: false }),
    );
    expect(v.eligible).toBe(false);
    expect(v.unmet.some((u) => u.code === 'G4-12' && u.detail.includes('not an ancestor'))).toBe(true);
  });

  it('H4/H5/H6/H11 any substantive path in the tail makes the evidence stale', () => {
    for (const path of [
      'projectos/core/src/closureAuthority.ts',
      'projectos/control-center/src/owner/OwnerControlPlane.tsx',
      'projectos/state/projectos-v3.plan.json',
      'projectos/validators/validate-all.cjs',
      'docs/architecture/projectos-v3.1-crosswalk.md',
      'projectos/control-center/src-tauri/src/app.rs',
    ]) {
      const v = evaluateClosureEligibility(
        facts({ evidenceSubjectHead: SUBJECT, substantiveChangesSinceSubject: [path] }),
      );
      expect(v.eligible, path).toBe(false);
      expect(v.unmet.some((u) => u.code === 'G4-12')).toBe(true);
    }
  });

  it('the evidence must name a subject at all', () => {
    const v = evaluateClosureEligibility(facts({ evidenceSubjectHead: null }));
    expect(v.eligible).toBe(false);
    expect(v.unmet.some((u) => u.code === 'G4-12' && u.detail.includes('no subject commit'))).toBe(true);
  });

  it('H2/H10 a dirty tree is still refused, and H9 an unreconciled remote too', () => {
    expect(evaluateClosureEligibility(facts({ workingTreeClean: false })).eligible).toBe(false);
    expect(evaluateClosureEligibility(facts({ remoteReconciled: false })).eligible).toBe(false);
  });

  it('the closure-tail allowlist admits exactly the workflow paths and nothing else', () => {
    for (const ok of [
      '.projectops/phases/PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.json',
      '.projectops/closure/PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.json',
      'knowledge/reports/2026-08-09_ProjectOS_X_CLOSED.md',
      'knowledge/ProjectOS Reports Index.md',
      'projectos/state/projectos-v3.current-state.json',
      'projectos/state/projectos-v3.session.json',
    ]) {
      expect(isClosureTailPath(ok), ok).toBe(true);
    }
    for (const no of [
      'projectos/state/projectos-v3.plan.json',
      'projectos/state/versions/projectos-v3.plan.v1.2-candidate.json',
      'projectos/core/src/phase.ts',
      'projectos/validators/validate-all.cjs',
      '.projectops/project-config.json',
      '.projectops/closure/../../projectos/core/src/phase.ts',
      '.projectops/phases/',
      'knowledge/reports/',
      'package.json',
    ]) {
      expect(isClosureTailPath(no), no).toBe(false);
    }
  });

  it('the allowlist is small enough to read, and excludes the plan', () => {
    expect(CLOSURE_TAIL_PATHS.length).toBeLessThanOrEqual(8);
    expect(CLOSURE_TAIL_PATHS.some((p) => p.includes('plan'))).toBe(false);
  });

  it('V10 a validator-run record is tail ONLY in its exact subject-named shape', () => {
    // It must be a tail path at all — the record can only exist after the commit it describes. But
    // admitting the DIRECTORY would make any hand-placed file under it non-substantive, which is a
    // hole, so only `<40-hex>.json` qualifies.
    expect(isClosureTailPath(`.projectops/validation/${'b'.repeat(40)}.json`)).toBe(true);
    for (const no of [
      '.projectops/validation/latest.json',
      '.projectops/validation/notes.md',
      '.projectops/validation/' + 'b'.repeat(39) + '.json',
      '.projectops/validation/' + 'b'.repeat(41) + '.json',
      '.projectops/validation/' + 'B'.repeat(40) + '.json',
      '.projectops/validation/sub/' + 'b'.repeat(40) + '.json',
      '.projectops/validation/',
      '.projectops/validation/' + 'b'.repeat(40) + '.json.bak',
    ]) {
      expect(isClosureTailPath(no), no).toBe(false);
    }
    // And it cannot launder a source change: a substantive path stays substantive.
    expect(isClosureTailPath('projectos/core/src/closureEligibility.ts')).toBe(false);
  });
});

/**
 * G4-17 — plan-declared required validators, proven BY NAME.
 *
 * The hole this closes: `validatorsPass` is one boolean, so a phase whose approved plan demands a
 * specific validator could close with that validator never having run, and the plan's
 * `requiredValidators` were read by nothing. Every case below is a closure that must not happen.
 */
describe('V required validators are proven by name, not by a boolean', () => {
  it('V1 a declared validator with a passing bound result satisfies the predicate', () => {
    const v = evaluateClosureEligibility(
      facts({
        requiredValidators: ['validate-all', 'validate-zero-relay-continuity'],
        passingValidatorNames: ['validate-all', 'validate-zero-relay-continuity', 'validate-desktop-e2e'],
      }),
    );
    expect(v.eligible).toBe(true);
    expect(v.satisfied).toContain('G4-17');
  });

  it('V2 a required validator absent from the record REFUSES, and is named', () => {
    const v = evaluateClosureEligibility(
      facts({
        requiredValidators: ['validate-all', 'validate-zero-relay-continuity'],
        passingValidatorNames: ['validate-all'],
      }),
    );
    expect(v.eligible).toBe(false);
    const u = v.unmet.find((x) => x.code === 'G4-17');
    expect(u).toBeDefined();
    expect(u?.detail).toContain('validate-zero-relay-continuity');
  });

  it('V3 a required validator recorded as FAILING refuses — a failing run leaves it off the passing list', () => {
    // The deriving layer only ever puts PASSING names in `passingValidatorNames`, so "failed" and
    // "absent" reach the gate identically and both refuse. Asserted so the equivalence is deliberate.
    const v = evaluateClosureEligibility(
      facts({ requiredValidators: ['validate-reliability-hardening'], passingValidatorNames: [] }),
    );
    expect(v.unmet.map((x) => x.code)).toContain('G4-17');
  });

  it('V4 a missing validator-run record refuses', () => {
    const v = evaluateClosureEligibility(
      facts({
        requiredValidators: ['validate-all'],
        passingValidatorNames: [],
        validationRecordProblems: ['no validator-run record at .projectops/validation/<subject>.json'],
      }),
    );
    expect(v.eligible).toBe(false);
    expect(v.unmet.find((x) => x.code === 'G4-17')?.detail).toContain('no validator-run record');
  });

  it('V5 a record bound to a different subject refuses even when the names all match', () => {
    const v = evaluateClosureEligibility(
      facts({
        requiredValidators: ['validate-all'],
        passingValidatorNames: ['validate-all'],
        validationRecordProblems: ['validator-run record is bound to ccccccc, not the evidence subject aaaaaaa'],
      }),
    );
    expect(v.eligible).toBe(false);
    expect(v.unmet.find((x) => x.code === 'G4-17')?.detail).toContain('not the evidence subject');
  });

  it('V6 a malformed record refuses rather than reading as an empty pass list', () => {
    const v = evaluateClosureEligibility(
      facts({
        requiredValidators: ['validate-all'],
        passingValidatorNames: ['validate-all'],
        validationRecordProblems: ['validator-run record has no results array'],
      }),
    );
    expect(v.eligible).toBe(false);
    expect(v.unmet.map((x) => x.code)).toContain('G4-17');
  });

  it('V7 validatorsPass=true does NOT substitute for a named required validator', () => {
    // The precise defect: the closure evidence asserts the suite passed, and the gate believed it.
    const v = evaluateClosureEligibility(
      facts({
        validatorsPass: true,
        requiredValidators: ['validate-zero-relay-continuity'],
        passingValidatorNames: ['validate-all', 'validate-reliability-hardening'],
      }),
    );
    expect(v.satisfied).toContain('G4-5'); // the old boolean is still satisfied …
    expect(v.eligible).toBe(false); // … and it is no longer enough.
    expect(v.unmet.map((x) => x.code)).toEqual(['G4-17']);
  });

  it('V8 unrelated passing validators do not substitute for the missing required name', () => {
    const v = evaluateClosureEligibility(
      facts({
        requiredValidators: ['validate-zero-relay-continuity'],
        passingValidatorNames: Array.from({ length: 200 }, (_, i) => `validate-other-${i}`),
      }),
    );
    expect(v.eligible).toBe(false);
    expect(v.unmet.find((x) => x.code === 'G4-17')?.detail).toContain('validate-zero-relay-continuity');
  });

  it('V9 a phase declaring no required validators gains no invented requirement', () => {
    // Vacuous truth on purpose: every already-closed phase and Phase 18 must keep behaving exactly
    // as before. An empty record is irrelevant when the plan asks for nothing.
    const v = evaluateClosureEligibility(
      facts({
        requiredValidators: [],
        passingValidatorNames: [],
        validationRecordProblems: ['no validator-run record at all'],
      }),
    );
    expect(v.eligible).toBe(true);
    expect(v.satisfied).toContain('G4-17');
  });

  it('V11 evidence cannot be reused across phases: the decision binding and the subject both hold', () => {
    // Same passing validators, wrong phase -> G4-16 refuses; wrong subject -> G4-17 refuses. Reuse
    // has to fail on BOTH axes, otherwise one record could close a second phase.
    expect(unmetCodes({ decisionBoundToPhaseId: 'SOME-OTHER-PHASE1A' })).toContain('G4-16');
    expect(
      evaluateClosureEligibility(
        facts({ validationRecordProblems: ['validator-run record is bound to another subject'] }),
      ).unmet.map((x) => x.code),
    ).toContain('G4-17');
  });

  it('V12 the required list is a FACT, and every name in it must be met', () => {
    // The gate cannot invent or drop names: whatever the deriving layer read off the active approved
    // plan is exactly what must appear. Proven over the whole subset lattice of a three-name list.
    const required = ['a', 'b', 'c'];
    for (let mask = 0; mask < 8; mask++) {
      const passing = required.filter((_, i) => (mask & (1 << i)) !== 0);
      const v = evaluateClosureEligibility(facts({ requiredValidators: required, passingValidatorNames: passing }));
      expect(v.eligible, `mask ${mask}`).toBe(passing.length === 3);
      if (passing.length < 3) {
        const detail = v.unmet.find((x) => x.code === 'G4-17')?.detail ?? '';
        for (const name of required.filter((n) => !passing.includes(n))) expect(detail).toContain(name);
      }
    }
  });

  it('the basis note tells the truth about which validators carried the closure', () => {
    const note = g4BasisNote(facts({ requiredValidators: ['validate-all', 'validate-zero-relay-continuity'] }));
    expect(note).toContain(`all ${G4_PREDICATE_COUNT} predicates`);
    expect(note).toContain('validate-zero-relay-continuity');
    expect(g4BasisNote(facts({ requiredValidators: [] }))).toContain('no plan-required validators');
  });
});
