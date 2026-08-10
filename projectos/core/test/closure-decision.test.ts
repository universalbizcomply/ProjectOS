/**
 * The final-gate authority defect, and the property that must hold instead.
 *
 * WHAT HAPPENED. `phase advance --to closed --delegated`, typed by the implementer, closed Phase 18.
 * Every G4 predicate was satisfied, the delegate's identity was resolved from the approved plan
 * rather than from the caller — and that was precisely the problem. Nothing in the system represented
 * a DECISION, so "the conditions for a decision are met" was silently treated as "the delegate has
 * decided". The plan says the implementer "can neither approve nor close, and cannot act as either
 * the owner or the gatekeeper"; the code did not enforce it.
 *
 * THE PROPERTY. A caller-supplied flag, role or identity confers NO closure power — and this must
 * remain true when every evidence predicate passes, because that is the case it failed in.
 */
import { describe, it, expect } from 'vitest';
import {
  authoriseClosure,
  isImplementerIdentity,
  type ClosureAuthorityInput,
  type ClosureDelegation,
} from '../src/closureAuthority.js';
import { checkClosureDecision, consumedDecisionIds, CLOSURE_DECISION_SCHEMA_VERSION } from '../src/closureDecision.js';
import { evaluateClosureEligibility, CLOSURE_READY_STATUS, type G4Facts } from '../src/closureEligibility.js';
import { transitionPhase, type Phase } from '../src/phase.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'c'.repeat(40);
const PHASE = 'PROJECTOS-V3-FINAL-E2E-CLOSURE1A';

const DELEGATION: ClosureDelegation = {
  delegatedBy: 'Murad',
  delegatedTo: 'ChatGPT',
  delegationDate: '2026-08-09',
  delegatedScope: ['phase-closure', 'programme-closure'],
  projectScope: 'projectos',
  excludesProtectedActions: true,
};

/** A FULLY eligible G4 verdict — the state the system was in when the breach happened. */
function eligibleVerdict() {
  const facts: G4Facts = {
    governedProjectId: 'projectos',
    planProjectId: 'projectos',
    activePlanVersion: '1.3',
    planReady: true,
    planUnmetReasons: [],
    phaseId: PHASE,
    phaseInActivePlan: true,
    phaseStatus: CLOSURE_READY_STATUS,
    validatorsPass: true,
    checksPass: true,
    evidenceReportPresent: true,
    headedProofRequired: false,
    headedProofPass: true,
    reviewsComplete: true,
    unresolvedCriticalOrHigh: 0,
    protectedEffectOccurred: false,
    implementationHead: HEAD,
    remoteReconciled: true,
    workingTreeClean: true,
    delegationValidForProject: true,
    authorityAssertedByCaller: false,
    decisionBoundToPhaseId: PHASE,
    evidenceSubjectHead: HEAD,
    subjectIsAncestorOfHead: true,
    substantiveChangesSinceSubject: [],
    requiredValidators: ['validate-all'],
    passingValidatorNames: ['validate-all'],
    validationRecordProblems: [],
  };
  const v = evaluateClosureEligibility(facts);
  expect(v.eligible).toBe(true); // the premise of every test below
  return v;
}

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
    phaseId: PHASE,
    eligibility: eligibleVerdict(),
    ...over,
  };
}

const GOOD_DECISION = {
  schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION,
  decisionId: 'GK-CLOSE-PHASE18-0001',
  phaseId: PHASE,
  projectId: 'projectos',
  scope: 'phase-closure',
  decidedBy: 'ChatGPT',
  decidedAt: '2026-08-10T21:00:00Z',
  evidenceSubjectHead: HEAD,
  decision: 'close',
};

function expectations(over: Record<string, unknown> = {}) {
  return {
    phaseId: PHASE,
    projectId: 'projectos',
    scope: 'phase-closure',
    expectedDecider: 'ChatGPT',
    evidenceSubjectHead: HEAD,
    isCommitted: true,
    alreadyConsumedDecisionIds: [] as readonly string[],
    ...over,
  };
}

describe('THE BREACH — eligibility is not a decision', () => {
  it('B1 the exact incident: fully eligible, delegation valid, NO decision => REFUSED', () => {
    // This is `phase advance --to closed --delegated` reduced to its authority decision. Before the
    // fix it returned a grant. It must now refuse, and say why in the operator's terms.
    const r = authoriseClosure(input({ decisionProblems: checkClosureDecision(null, expectations()) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('GATEKEEPER_DECISION_MISSING');
      expect(r.error).toContain('G4 eligibility is not a decision');
    }
  });

  it('B2 a caller that never looked for a decision is refused — silence is not absence of a requirement', () => {
    const r = authoriseClosure(input()); // decisionProblems undefined
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('GATEKEEPER_DECISION_NOT_ESTABLISHED');
  });

  it('B3 no caller-supplied role or identity can substitute for the decision', () => {
    // Every shape the incident could have taken. None of them may produce a grant.
    const attempts: Partial<ClosureAuthorityInput>[] = [
      { actorRole: 'advisor', actorIdentity: 'ChatGPT' },
      { actorRole: 'advisor', actorIdentity: 'chatgpt' },
      { actorRole: 'advisor', actorIdentity: 'ChatGPT (gatekeeper)' },
      { actorRole: 'implementer', actorIdentity: 'ChatGPT' },
      { actorRole: 'advisor', actorIdentity: 'Murad' },
      { actorRole: 'owner', actorIdentity: 'ChatGPT' },
    ];
    for (const over of attempts) {
      const r = authoriseClosure(input({ ...over, decisionProblems: checkClosureDecision(null, expectations()) }));
      expect(r.ok, JSON.stringify(over)).toBe(false);
    }
  });

  it('B4 the implementer can never close, decision or not — the plan says so and this enforces it', () => {
    const withDecision = { decisionProblems: [] as readonly string[], decisionId: 'GK-CLOSE-PHASE18-0001' };
    expect(authoriseClosure(input({ actorRole: 'implementer', ...withDecision })).ok).toBe(false);
    expect(authoriseClosure(input({ actorIdentity: 'Claude Code', ...withDecision })).ok).toBe(false);
    expect(authoriseClosure(input({ actorIdentity: 'claude-code-agent', ...withDecision })).ok).toBe(false);
    for (const name of ['Claude', 'Anthropic', 'an AI agent', 'copilot', 'assistant', 'some bot'])
      expect(isImplementerIdentity(name), name).toBe(true);
  });

  it('B5 a grant cannot be forged: transitionPhase refuses a hand-made one', () => {
    const at = '2026-08-10T21:00:00Z';
    const phase: Phase = { phaseId: PHASE, project: 'ProjectOS', objective: 'o', status: 'awaiting_closure', history: [] };
    // A plain object shaped like a grant. The brand is a private symbol, so this is the closest a
    // caller can get — and TypeScript is not the control here; the runtime refusal is.
    const forged = { basis: 'delegated', authorisedIdentity: 'ChatGPT', projectScope: 'projectos', scope: 'phase-closure', phaseId: 'SOME-OTHER-PHASE' } as never;
    expect(transitionPhase(phase, 'closed', 'advisor', at, undefined, forged).ok).toBe(false);
    expect(transitionPhase(phase, 'closed', 'implementer', at).ok).toBe(false);
    expect(transitionPhase(phase, 'closed', 'advisor', at).ok).toBe(false);
  });
});

describe('THE LEGITIMATE PATH — a decision, bound and committed', () => {
  it('L1 G4 complete + a valid committed decision => a grant is minted', () => {
    const problems = checkClosureDecision(GOOD_DECISION, expectations());
    expect(problems).toEqual([]);
    const r = authoriseClosure(input({ decisionProblems: problems, decisionId: GOOD_DECISION.decisionId }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.basis).toBe('delegated');
      expect(r.value.authorisedIdentity).toBe('ChatGPT');
      expect(r.value.decisionId).toBe(GOOD_DECISION.decisionId);
    }
  });

  it('L2 a decision without G4 is refused — the two are independent, and both are required', () => {
    const notEligible = evaluateClosureEligibility({
      ...({} as G4Facts),
      governedProjectId: 'projectos',
      planProjectId: 'projectos',
      activePlanVersion: '1.3',
      planReady: false,
      planUnmetReasons: ['plan not ready'],
      phaseId: PHASE,
      phaseInActivePlan: true,
      phaseStatus: CLOSURE_READY_STATUS,
      validatorsPass: null,
      checksPass: null,
      evidenceReportPresent: false,
      headedProofRequired: false,
      headedProofPass: null,
      reviewsComplete: null,
      unresolvedCriticalOrHigh: null,
      protectedEffectOccurred: false,
      implementationHead: HEAD,
      remoteReconciled: true,
      workingTreeClean: true,
      delegationValidForProject: true,
      authorityAssertedByCaller: false,
      decisionBoundToPhaseId: PHASE,
      evidenceSubjectHead: HEAD,
      subjectIsAncestorOfHead: true,
      substantiveChangesSinceSubject: [],
      requiredValidators: [],
      passingValidatorNames: [],
      validationRecordProblems: [],
    });
    const r = authoriseClosure(input({ eligibility: notEligible, decisionProblems: [], decisionId: 'GK-CLOSE-PHASE18-0001' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('G4_NOT_SATISFIED');
  });

  it('L3 an UNCOMMITTED decision is refused — that is the whole boundary under tamperProof:false', () => {
    const problems = checkClosureDecision(GOOD_DECISION, expectations({ isCommitted: false }));
    expect(problems.join(' ')).toContain('not committed');
    expect(authoriseClosure(input({ decisionProblems: problems })).ok).toBe(false);
  });

  it('L4 a decision bound to a different evidence subject is stale and refused', () => {
    const problems = checkClosureDecision({ ...GOOD_DECISION, evidenceSubjectHead: OTHER }, expectations());
    expect(problems.join(' ')).toContain('stale');
    expect(authoriseClosure(input({ decisionProblems: problems })).ok).toBe(false);
  });

  it('L5 a decision for another phase or another project cannot be reused', () => {
    expect(checkClosureDecision({ ...GOOD_DECISION, phaseId: 'SOME-OTHER-PHASE1A' }, expectations()).join(' ')).toContain('is for phase');
    expect(checkClosureDecision({ ...GOOD_DECISION, projectId: 'polygo' }, expectations()).join(' ')).toContain('is for project');
    expect(checkClosureDecision({ ...GOOD_DECISION, scope: 'programme-closure' }, expectations()).join(' ')).toContain('scope');
  });

  it('L6 a decision that names someone other than the plan-recorded authority is refused', () => {
    // The decider comes from the plan and from the basis being claimed. A record claiming to be from
    // anyone else — including the owner, and including the implementer — is not this decision.
    for (const who of ['Murad', 'Claude Code', 'ChatGPT-5', '']) {
      expect(checkClosureDecision({ ...GOOD_DECISION, decidedBy: who }, expectations()).join(' '), who).toContain('not the recorded authority');
    }
    // And symmetrically for an OWNER closure: the delegate's decision is not the owner's.
    expect(
      checkClosureDecision({ ...GOOD_DECISION, decidedBy: 'ChatGPT' }, expectations({ expectedDecider: 'Murad' })).join(' '),
    ).toContain('not the recorded authority');
  });

  it('L7 a decision cannot be replayed once its id appears in the closing history', () => {
    const problems = checkClosureDecision(GOOD_DECISION, expectations({ alreadyConsumedDecisionIds: [GOOD_DECISION.decisionId] }));
    expect(problems.join(' ')).toContain('already consumed');
    expect(authoriseClosure(input({ decisionProblems: problems })).ok).toBe(false);
    // and the id is recoverable from a real closing note, which is what makes the check work at all
    expect(
      consumedDecisionIds([
        { to: 'awaiting_closure', note: 'walked forward' },
        { to: 'closed', note: 'closed by ChatGPT under the projectos-scoped phase-closure delegation, decision GK-CLOSE-PHASE18-0001' },
      ]),
    ).toEqual(['GK-CLOSE-PHASE18-0001']);
  });

  it('L8 a malformed or wrong-version decision record is refused rather than partly believed', () => {
    expect(checkClosureDecision({ ...GOOD_DECISION, schemaVersion: '0.9' }, expectations()).join(' ')).toContain('schemaVersion');
    expect(checkClosureDecision({ ...GOOD_DECISION, decision: 'reject' }, expectations()).join(' ')).toContain('does not decide to close');
    expect(checkClosureDecision({ ...GOOD_DECISION, decisionId: 'short' }, expectations()).join(' ')).toContain('decisionId');
    expect(checkClosureDecision({ ...GOOD_DECISION, decidedAt: '' }, expectations()).join(' ')).toContain('decidedAt');
    expect(checkClosureDecision({ ...GOOD_DECISION, evidenceSubjectHead: 'nope' }, expectations()).join(' ')).toContain('evidence subject');
  });

  it('L9 a closure evidence record with no subject cannot be decided against', () => {
    expect(checkClosureDecision(GOOD_DECISION, expectations({ evidenceSubjectHead: null })).join(' ')).toContain('names no subject');
  });
});
