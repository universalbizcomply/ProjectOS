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
  grantNote,
  isImplementerIdentity,
  type ClosureAuthorityInput,
  type ClosureDelegation,
} from '../src/closureAuthority.js';
import {
  checkClosureDecision,
  consumedDecisionIds,
  validateOwnerAcceptedHighFindings,
  OWNER_ACCEPTANCE_SCOPE,
  CLOSURE_DECISION_SCHEMA_VERSION,
} from '../src/closureDecision.js';
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
    unresolvedCritical: 0,
    unresolvedHighIds: [],
    ownerAcceptedHighIds: [],
    acceptanceProblems: [],
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

/**
 * Findings from the adversarial review of the correction itself. Each broke the property in a way
 * the identity/role logic never touched — by scope, by resettable state, or by what "committed"
 * actually covered — so each gets a permanent case.
 */
describe('the review found four more ways through, and none of them work now', () => {
  it('S1 core refuses ANY closure without a grant, including one performed as owner', () => {
    // The old carve-out `by !== 'owner'` meant the string 'owner' was sufficient at the core
    // boundary, so every protection lived in one caller and any other caller walked around it. The
    // Control Centre's project surface did exactly that.
    const at = '2026-08-10T22:00:00Z';
    const p: Phase = { phaseId: PHASE, project: 'ProjectOS', objective: 'o', status: 'awaiting_closure', history: [] };
    for (const role of ['owner', 'advisor', 'implementer'] as const) {
      const r = transitionPhase(p, 'closed', role, at);
      expect(r.ok, role).toBe(false);
      if (!r.ok) expect(r.error, role).toContain('requires a closure grant');
    }
    // A real grant still closes it, so the rule is a gate and not a wall.
    const granted = authoriseClosure(input({ decisionProblems: [], decisionId: 'GK-CLOSE-PHASE18-0001' }));
    expect(granted.ok).toBe(true);
    if (granted.ok) expect(transitionPhase(p, 'closed', 'advisor', at, undefined, granted.value).ok).toBe(true);
  });

  it('S2 a decision that has been consumed cannot be used again, even with a fresh phase history', () => {
    // Replay tracking used to live only in the phase's history, which `phase new --force` erases.
    // The marker is in the DECISION now, which a phase reset does not touch.
    const spent = { ...GOOD_DECISION, consumedAt: '2026-08-10T21:30:00Z' };
    const problems = checkClosureDecision(spent, expectations({ alreadyConsumedDecisionIds: [] }));
    expect(problems.join(' ')).toContain('already consumed');
    expect(authoriseClosure(input({ decisionProblems: problems })).ok).toBe(false);
  });

  it('S3 a caller-supplied note cannot poison the replay ledger', () => {
    // `--note "decision 00000000"` used to be captured instead of the real id, because the search
    // was unanchored and the caller's text came first. The id is read from the END of the note.
    const real = 'closed by ChatGPT under the projectos-scoped phase-closure delegation, decision GK-REAL-0001';
    expect(consumedDecisionIds([{ to: 'closed', note: `decision GK-DECOY-0000 — ${real}` }])).toEqual(['GK-REAL-0001']);
    // A note that is ONLY a decoy yields nothing, rather than a false consumption.
    expect(consumedDecisionIds([{ to: 'closed', note: 'decision GK-DECOY-0000' }])).toEqual([]);
  });

  it('S4 an owner closure records its decision id, so owner closures are visible to replay detection', () => {
    // The owner grant omitted decisionId entirely, so `grantNote` produced a note with no decision
    // reference and no owner closure could ever be seen as consuming anything.
    const r = authoriseClosure(input({ actorRole: 'owner', actorIdentity: 'Murad', decisionProblems: [], decisionId: 'OWN-0001' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.decisionId).toBe('OWN-0001');
      expect(grantNote(r.value)).toContain('decision OWN-0001');
      expect(consumedDecisionIds([{ to: 'closed', note: grantNote(r.value) }])).toEqual(['OWN-0001']);
    }
  });

  it('S5 an implementer identity is caught through homoglyphs and diacritics', () => {
    for (const name of ['Claude', 'Claudé', 'CLAUDE', 'c l a u d e', 'Anthropic']) {
      expect(isImplementerIdentity(name), name).toBe(true);
    }
  });
});

/**
 * Owner acceptance of a residual HIGH.
 *
 * The acceptance IS authority, so it is judged exactly as the decision is judged: nothing in the
 * entry is believed about the world. Every binding below must be able to refuse on its own,
 * because a mechanism that only works when everything is right is not a control.
 */
describe('validateOwnerAcceptedHighFindings', () => {
  const SUBJECT = 'b'.repeat(40);
  const EXPECT = {
    phaseId: 'PROJECTOS-RECOVERY-INSTALLED-APP1A',
    evidenceSubjectHead: SUBJECT,
    owner: 'Murad',
    unresolvedHighIds: ['SR-1'],
  };
  const ENTRY = {
    findingId: 'SR-1',
    severity: 'HIGH',
    acceptedBy: 'Murad',
    phaseId: 'PROJECTOS-RECOVERY-INSTALLED-APP1A',
    evidenceSubjectHead: SUBJECT,
    scope: OWNER_ACCEPTANCE_SCOPE,
  };
  const run = (over: unknown, expectOver: Partial<typeof EXPECT> = {}) =>
    validateOwnerAcceptedHighFindings({ ownerAcceptedFindings: over } as never, { ...EXPECT, ...expectOver });

  it('accepts a correctly bound HIGH', () => {
    const v = run([ENTRY]);
    expect(v.problems).toEqual([]);
    expect(v.acceptedHighIds).toEqual(['SR-1']);
  });

  it('an absent field is not an error — a phase with nothing to accept says nothing', () => {
    expect(validateOwnerAcceptedHighFindings({} as never, EXPECT)).toEqual({ acceptedHighIds: [], problems: [] });
    expect(validateOwnerAcceptedHighFindings(null, EXPECT)).toEqual({ acceptedHighIds: [], problems: [] });
  });

  it('refuses a CRITICAL by name, not by silently ignoring it', () => {
    const v = run([{ ...ENTRY, severity: 'CRITICAL' }]);
    expect(v.acceptedHighIds).toEqual([]);
    expect(v.problems.join(' ')).toMatch(/CRITICAL can never be owner-accepted/);
  });

  it('refuses every wrong binding on its own', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['wrong acceptedBy', { ...ENTRY, acceptedBy: 'Claude' }, /is not the owner/],
      ['wrong phase', { ...ENTRY, phaseId: 'SOME-OTHER-PHASE1A' }, /bound to phase/],
      ['wrong subject commit', { ...ENTRY, evidenceSubjectHead: 'c'.repeat(40) }, /an acceptance of other bytes is stale/],
      ['blank scope', { ...ENTRY, scope: '   ' }, /not the only permitted acceptance scope/],
      ['missing scope', { findingId: 'SR-1', severity: 'HIGH', acceptedBy: 'Murad', phaseId: EXPECT.phaseId, evidenceSubjectHead: SUBJECT }, /not the only permitted acceptance scope/],
      ['unknown finding id', { ...ENTRY, findingId: 'SR-9' }, /does not record as an unresolved HIGH/],
      ['blank finding id', { ...ENTRY, findingId: '  ' }, /names no findingId/],
      ['wrong severity', { ...ENTRY, severity: 'MEDIUM' }, /expected "HIGH"/],
      ['not an object', 'SR-1 accepted by Murad', /is not an object/],
    ];
    for (const [name, entry, pattern] of cases) {
      const v = run([entry]);
      expect(v.acceptedHighIds, name).toEqual([]);
      expect(v.problems.join(' '), name).toMatch(pattern);
    }
  });

  it('refuses a free-text note in place of a structured acceptance', () => {
    expect(run('Murad accepts the residual HIGH').problems.join(' ')).toMatch(/is not an array/);
  });

  it('refuses when the evidence names no subject to bind against', () => {
    expect(run([ENTRY], { evidenceSubjectHead: null }).problems.join(' ')).toMatch(/names no valid subject commit/);
  });

  it('accepting one HIGH does not accept another, and a repeat is refused', () => {
    const v = run([ENTRY], { unresolvedHighIds: ['SR-1', 'SR-2'] });
    expect(v.acceptedHighIds).toEqual(['SR-1']);
    expect(run([ENTRY, ENTRY]).problems.join(' ')).toMatch(/repeats findingId/);
  });

  it('a plan with no recorded owner authorises nothing at all', () => {
    // The blank owner is refused BEFORE any entry is judged: '' === '' would otherwise pass.
    expect(run([{ ...ENTRY, acceptedBy: undefined }], { owner: '' }).acceptedHighIds).toEqual([]);
    expect(run([{ ...ENTRY, acceptedBy: '' }], { owner: '' }).problems.join(' ')).toMatch(/records no owner/);
  });
});

describe('acceptance authority cannot be satisfied by blanks', () => {
  const SUBJECT = 'b'.repeat(40);
  const BASE = {
    findingId: 'SR-1', severity: 'HIGH', acceptedBy: 'Murad', phaseId: 'P1A',
    evidenceSubjectHead: SUBJECT, scope: OWNER_ACCEPTANCE_SCOPE,
  };
  const EXPECT = { phaseId: 'P1A', evidenceSubjectHead: SUBJECT, owner: 'Murad', unresolvedHighIds: ['SR-1'] };

  it('a plan with no owner authorises nothing, even against a blank acceptedBy', () => {
    const v = validateOwnerAcceptedHighFindings(
      { ownerAcceptedFindings: [{ ...BASE, acceptedBy: '' }] } as never,
      { ...EXPECT, owner: '' },
    );
    expect(v.acceptedHighIds).toEqual([]);
    expect(v.problems.join(' ')).toMatch(/records no owner/);
  });

  it('a blank subject on both sides is not a binding', () => {
    const v = validateOwnerAcceptedHighFindings(
      { ownerAcceptedFindings: [{ ...BASE, evidenceSubjectHead: '' }] } as never,
      { ...EXPECT, evidenceSubjectHead: '' },
    );
    expect(v.acceptedHighIds).toEqual([]);
    expect(v.problems.join(' ')).toMatch(/no valid subject commit/);
  });

  it('an entry whose subject is not a commit-shaped string is refused', () => {
    const v = validateOwnerAcceptedHighFindings({ ownerAcceptedFindings: [{ ...BASE, evidenceSubjectHead: 'HEAD' }] } as never, EXPECT);
    expect(v.acceptedHighIds).toEqual([]);
    expect(v.problems.join(' ')).toMatch(/names no valid evidence subject commit/);
  });
});

describe('the residual-HIGH note does not break replay detection', () => {
  // consumedDecisionIds is $-anchored on ', decision <id>'. The residual marker is inserted BEFORE
  // the basis note precisely so the id stays last; if that ever inverts, a spent decision becomes
  // replayable, which is the worst failure this file guards against.
  it('still reads the decision id from a note carrying an owner-accepted residual HIGH', () => {
    const note =
      'owner-accepted residual HIGH, unresolved and carried forward: SR-1 — ' +
      'closed by ChatGPT under the projectos-scoped phase-closure delegation, decision GK-DEC-0001';
    expect(consumedDecisionIds([{ to: 'closed', note }])).toEqual(['GK-DEC-0001']);
  });

  it('a finding id shaped like a decision suffix cannot spoof the id, because the basis note follows it', () => {
    const note =
      'owner-accepted residual HIGH, unresolved and carried forward: , decision FORGEDID1 — ' +
      'closed by ChatGPT under the projectos-scoped phase-closure delegation, decision GK-DEC-0002';
    expect(consumedDecisionIds([{ to: 'closed', note }])).toEqual(['GK-DEC-0002']);
  });

  it('a caller note plus a residual marker plus the basis still yields the real id', () => {
    const note =
      'installed-app proof — owner-accepted residual HIGH, unresolved and carried forward: SR-1 — ' +
      'closed by owner Murad, decision OWN-DEC-0003';
    expect(consumedDecisionIds([{ to: 'closed', note }])).toEqual(['OWN-DEC-0003']);
  });
});

/**
 * Scope is a machine contract, not prose. Free text satisfied "non-empty" while asserting the
 * opposite of what this mechanism permits, so exactly one literal is accepted.
 */
describe('acceptance scope is one exact literal', () => {
  const SUBJECT = 'b'.repeat(40);
  const EXPECT = { phaseId: 'P1A', evidenceSubjectHead: SUBJECT, owner: 'Murad', unresolvedHighIds: ['SR-1'] };
  const BASE = {
    findingId: 'SR-1', severity: 'HIGH', acceptedBy: 'Murad', phaseId: 'P1A',
    evidenceSubjectHead: SUBJECT, scope: OWNER_ACCEPTANCE_SCOPE,
  };
  const run = (scope: unknown) =>
    validateOwnerAcceptedHighFindings({ ownerAcceptedFindings: [{ ...BASE, scope }] } as never, EXPECT);

  it('S1 the exact canonical scope is accepted', () => {
    const v = run(OWNER_ACCEPTANCE_SCOPE);
    expect(v.problems).toEqual([]);
    expect(v.acceptedHighIds).toEqual(['SR-1']);
  });

  it('S2 blank or missing scope is refused', () => {
    for (const s of ['', '   ', undefined, null]) {
      const v = run(s);
      expect(v.acceptedHighIds).toEqual([]);
      expect(v.problems.join(' ')).toMatch(/not the only permitted acceptance scope/);
    }
  });

  it('S3 a wildcard scope is refused', () => {
    expect(run('*').acceptedHighIds).toEqual([]);
  });

  it('S4 "all projects forever" is refused', () => {
    expect(run('all projects forever').acceptedHighIds).toEqual([]);
  });

  it('S5 any other non-empty scope is refused, including a plausible one', () => {
    for (const s of [
      'production and external distribution',
      'local ProjectOS operational-recovery closure only',
      'phase-closure',
      'Phase-Closure-Only',
      ' phase-closure-only ',
    ]) {
      expect(run(s).acceptedHighIds, s).toEqual([]);
    }
  });

  it('the canonical literal is what the mechanism documents', () => {
    expect(OWNER_ACCEPTANCE_SCOPE).toBe('phase-closure-only');
  });
});
