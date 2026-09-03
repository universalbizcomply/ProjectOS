/**
 * The owner surface must show what the canonical records SAY.
 *
 * These tests feed this repository's real `.projectops/project-config.json`, real approved plan and
 * real current-state through the projection — the same files the runtime governs from. A hand-kept
 * literal cannot satisfy them, which is the whole point: the previous surface drifted to a seed of
 * three accepted phases while the canonical record said sixteen, and its "pinned" test caught it only
 * after the fact.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { projectGovernedState, type GovernedInputs } from '../src/governed/governedProjection';
import { isGovernedStateMessage, GOVERNED_MESSAGE_KIND } from '../src/governed/types';

const REPO = resolve(__dirname, '../../..');
const require_ = createRequire(import.meta.url);

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, rel), 'utf8')) as Record<string, unknown>;
}

const config = readJson('.projectops/project-config.json');
const planMemory = config['planMemory'] as Record<string, string> | undefined;
const PLAN_REL = planMemory?.['planPath'] ?? '.projectops/plan.json';
const STATE_REL = planMemory?.['currentStatePath'];
const plan = readJson(PLAN_REL);
const currentState = STATE_REL === undefined ? null : readJson(STATE_REL);

/** The REAL engine — the same module the runtime uses. Readiness is never asserted from the record. */
const engine = require_(resolve(REPO, 'projectos/validators/plan-governance-engine.cjs')) as {
  evaluatePlanReady(p: unknown): { ready: boolean; reasons: readonly string[] };
};

function phaseRecords(): Record<string, unknown>[] {
  const dir = join(REPO, '.projectops/phases');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>);
}

function inputs(over: Partial<GovernedInputs> = {}): GovernedInputs {
  return {
    config,
    plan,
    currentState,
    phaseRecords: phaseRecords(),
    readiness: engine.evaluatePlanReady(plan),
    planPath: PLAN_REL,
    branch: 'projectos-v3',
    head: 'deadbeef',
    observedAt: '2026-08-09T04:00:00Z',
    ...over,
  };
}

/**
 * Phase ids taken from whichever plan is ACTIVE, never spelled out.
 *
 * Four tests below used to name V3 phases literally. The moment a second programme was approved they
 * failed for a reason that had nothing to do with what they were testing — the same lesson two other
 * tests in this file already record. A test about a computation must not be pinned to the programme
 * that happened to be running when it was written.
 */
/** A closing history entry shaped as `transitionPhase` writes it, naming its authorising decision. */
function closedBy(by: string, decisionId = 'TEST-CLOSURE-DECISION1A') {
  return [{ from: 'awaiting_closure', to: 'closed', by, at: '2026-08-11T14:00:00Z', note: `closed, decision ${decisionId}` }];
}

/** The decision the runtime would have written and consumed for a genuine closure of `phaseId`. */
function decisionFor(phaseId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const gov = plan['governance'] as Record<string, unknown>;
  return {
    schemaVersion: '1.0.0',
    decisionId: 'TEST-CLOSURE-DECISION1A',
    phaseId,
    projectId: plan['projectId'],
    scope: 'phase-closure',
    decidedBy: gov['owner'],
    decidedAt: '2026-08-11T13:00:00Z',
    evidenceSubjectHead: 'c'.repeat(40),
    decision: 'close',
    consumedAt: '2026-08-11T14:00:00Z',
    ...over,
  };
}

const PHASE_IDS = (plan['phases'] as { phaseId: string }[]).map((x) => x.phaseId);
const LAST_ID = PHASE_IDS[PHASE_IDS.length - 1]!;

/* ------------------------------------------------------------------------------------------------
 * A PROGRAMME SHAPE THE TESTS OWN, rather than whichever programme happens to be active.
 *
 * Several assertions below need a chain: a last phase that DEPENDS on a second-last one, so that
 * "unmet dependency", "not startable" and "a delegated closure satisfies the dependency" can be
 * expressed at all. Borrowing that from `config.planMemory.planPath` worked only while the active
 * plan happened to have two or more phases. When a legitimately approved single-phase programme
 * became authoritative, `SECOND_LAST_ID` was `undefined` and those assertions became IMPOSSIBLE
 * rather than false — the same trap already recorded a few tests below, where one test was moved
 * onto stated fixture data for exactly this reason.
 *
 * The fixture clones the real plan, so governance, closure delegation and schema shape stay genuine
 * and readiness is still computed by the real engine; only the phase list is stated here. Tests that
 * are really about the live repository keep reading the live plan.
 * ---------------------------------------------------------------------------------------------- */
const FIXTURE_PHASE = (plan['phases'] as Record<string, unknown>[])[0]!;
function fixturePhase(id: string, dependsOn: readonly string[]): Record<string, unknown> {
  return { ...FIXTURE_PHASE, phaseId: id, dependsOn: [...dependsOn] };
}
const FX_FIRST = 'FIXTURE-PHASE-ONE1A';
const FX_SECOND_LAST = 'FIXTURE-PHASE-TWO1A';
const FX_LAST = 'FIXTURE-PHASE-THREE1A';
const FIXTURE_IDS = [FX_FIRST, FX_SECOND_LAST, FX_LAST];
const FIXTURE_PLAN: Record<string, unknown> = {
  ...plan,
  phases: [
    fixturePhase(FX_FIRST, []),
    fixturePhase(FX_SECOND_LAST, [FX_FIRST]),
    fixturePhase(FX_LAST, [FX_SECOND_LAST]),
  ],
};
/** Inputs over the stated programme shape. Readiness still comes from the real engine. */
function fixtureInputs(over: Partial<GovernedInputs> = {}): GovernedInputs {
  return inputs({
    plan: FIXTURE_PLAN,
    readiness: engine.evaluatePlanReady(FIXTURE_PLAN),
    currentState: null,
    phaseRecords: [],
    ...over,
  });
}

describe('governed projection reflects canonical records, not a seed', () => {
  test('programme counters come from the canonical current-state file', () => {
    const p = projectGovernedState(inputs());
    expect(p.programme.acceptedPhaseCount).toBe(currentState?.['acceptedPhaseCount']);
    expect(p.programme.totalPhaseCount).toBe(currentState?.['totalPhaseCount']);
    expect(p.programme.completionPercentage).toBe(currentState?.['completionPercentage']);
    // Derived, not asserted — the same rule the programme validators enforce.
    const derived =
      Math.round((p.programme.acceptedPhaseCount / p.programme.totalPhaseCount) * 1000) / 10;
    expect(p.programme.completionPercentage).toBe(derived);
  });

  test('every approved phase appears exactly once, in plan order', () => {
    const p = projectGovernedState(inputs());
    const planIds = (plan['phases'] as { phaseId: string }[]).map((x) => x.phaseId);
    expect(p.phases.map((x) => x.phaseId)).toEqual(planIds);
  });

  test('readiness is the engine verdict and the declared status is shown separately', () => {
    const p = projectGovernedState(inputs());
    expect(p.plan.ready).toBe(true);
    expect(p.plan.unmetReasons).toEqual([]);
    expect(p.plan.declaredStatus).toBe(plan['planStatus']);
    expect(p.plan.planVersion).toBe(plan['planVersion']);
  });

  test('a forged PLAN READY string does not make the surface show ready', () => {
    // The record still SAYS "PLAN READY"; the engine verdict says otherwise. The surface must follow
    // the verdict, exactly as the runtime does.
    const p = projectGovernedState(
      inputs({ readiness: { ready: false, reasons: ['approval.approvedBy is the implementer'] } }),
    );
    expect(p.plan.declaredStatus).toBe('PLAN READY');
    expect(p.plan.ready).toBe(false);
    expect(p.nextSafeAction).toContain('not READY');
    // and nothing is offered as startable while the plan is not ready
    expect(p.phases.every((x) => !x.startable)).toBe(true);
    expect(p.nextStartablePhase).toBeNull();
  });
});

describe('phase state comes from durable core records', () => {
  test('a phase with a live record shows its real core status and history', () => {
    // STATED, not borrowed. This asserted that the repository was mid-phase with at least one live
    // record, which is a fact about today's programme rather than about the projection. A programme
    // whose phase has not been started yet has no such record and the test became impossible.
    const p = projectGovernedState(
      fixtureInputs({
        phaseRecords: [
          {
            phaseId: FX_FIRST,
            status: 'implementing',
            history: [{ from: 'draft', to: 'implementing', by: 'implementer', at: '2026-08-17T00:00:00.000Z' }],
          },
        ],
      }),
    );
    const live = p.phases.find((x) => x.status !== 'not-started' && !x.closedByRecord);
    expect(live).toBeDefined();
    expect(live?.phaseId).toBe(FX_FIRST);
    expect(live?.status).toBe('implementing');
    expect(live?.history.length).toBeGreaterThan(0);
  });

  test('phases closed only by the programme record are marked as such, not as core-driven', () => {
    // Stated in the FIXTURE. It used to be borrowed from the live programme, which worked only while
    // the active plan happened to carry record-only closures; a programme whose phases are all closed
    // through the runtime has none, and the assertion became impossible rather than false.
    const p = projectGovernedState(
      inputs({ currentState: { ...(currentState ?? {}), completedPhases: [LAST_ID] }, phaseRecords: [] }),
    );
    const byRecord = p.phases.filter((x) => x.closedByRecord);
    expect(byRecord.map((x) => x.phaseId)).toContain(LAST_ID);
    for (const ph of byRecord) expect(ph.status).toBe('not-started');
  });

  test('a phase already carrying a record is not offered as startable', () => {
    const p = projectGovernedState(inputs());
    for (const ph of p.phases) {
      if (ph.history.length > 0) expect(ph.startable).toBe(false);
    }
  });

  test('a phase already recorded complete is never offered as startable', () => {
    // Regression: the first live run offered PROJECTOS-V3-BASELINE-RECONCILE1A — closed years of
    // programme time ago, but with no core record — as the next thing to start. Offering a closed
    // phase invites a refusal the owner cannot act on.
    const p = projectGovernedState(inputs());
    const done = new Set(p.programme.completedPhases);
    for (const ph of p.phases) {
      if (done.has(ph.phaseId)) expect(ph.startable).toBe(false);
    }
    expect(p.nextStartablePhase === null || !done.has(p.nextStartablePhase.phaseId)).toBe(true);
  });

  test('no phase is offered as next-to-start while another is in flight', () => {
    // Plan v1.1 makes Phase 17 mechanically eligible from Phase 16 alone, so without this rule the
    // surface would point at reliability hardening while the integration phase was still open.
    //
    // The programme is now CLOSED, so nothing is in flight in the live records and this scenario has
    // to be stated rather than borrowed: put one phase back in flight in the FIXTURE.
    const p = projectGovernedState(
      inputs({
        phaseRecords: [{ phaseId: LAST_ID, status: 'implementing', history: [] }],
      }),
    );
    expect(p.activePhase).not.toBeNull();
    expect(p.nextStartablePhase).toBeNull();
    // The invariant is that the surface points at the phase in flight and offers no other phase to
    // start. The exact wording is status-dependent — it changed the moment Phase 12 legitimately
    // reached awaiting_closure — so assert the invariant, not the prose.
    expect(p.nextSafeAction).toContain(p.activePhase!.phaseId);
  });

  test('a finished programme says so, instead of inventing an unmet dependency', () => {
    // Regression from the post-V3 self-hosting pilot: with every phase complete, nothing is
    // startable — and the surface told the owner "every remaining phase has an unmet dependency.
    // Close the phase it depends on first." There was no such phase.
    //
    // Completion is stated in the FIXTURE, derived from the plan's own phase list, rather than
    // borrowed from the live programme happening to be at 19/19. Two tests below, this file already
    // learned that lesson the hard way; a test pinned to the current position would start failing
    // the day a phase is appended, for a reason that has nothing to do with this message.
    const allIds = (plan['phases'] as { phaseId: string }[]).map((x) => x.phaseId);
    const p = projectGovernedState(
      inputs({ currentState: { ...(currentState ?? {}), completedPhases: allIds }, phaseRecords: [] }),
    );
    expect(p.activePhase).toBeNull();
    expect(p.nextStartablePhase).toBeNull();
    expect(p.nextSafeAction).toContain('Every phase in the approved plan is complete');
    expect(p.nextSafeAction).not.toContain('unmet dependency');
    // Completion must not read as permission to do anything further.
    expect(p.nextSafeAction).toContain('new owner-approved plan');
  });

  test('a genuinely blocked programme still gets the dependency message', () => {
    // The other half, and the one that actually pins the fix: the original wording must still fire
    // when phases really are blocked, or one always-true message has simply replaced another.
    //
    // Getting there needs care. With no records at all the ROOT phase is startable, so the
    // projection takes the "authorised to start" branch and never reaches the fallback — an earlier
    // version of this test asserted against that state and proved nothing. Here the root phase
    // carries a record that is NOT an owner closure: it is therefore neither startable (a record
    // exists) nor complete (not owner-closed), which blocks everything that depends on it.
    // A blocked programme needs something to be blocked BY, so the shape is stated: the root carries
    // a non-owner-closure record, which leaves the phases that depend on it genuinely unmet. A
    // single-phase programme has no dependants and could never express this.
    const p = projectGovernedState(
      fixtureInputs({
        phaseRecords: [{ phaseId: FX_FIRST, status: 'closed', history: [] }],
      }),
    );
    expect(p.activePhase).toBeNull();
    expect(p.nextStartablePhase).toBeNull();
    expect(p.phases.some((x) => x.unmetDependencies.length > 0)).toBe(true);
    expect(p.nextSafeAction).toContain('unmet dependency');
    expect(p.nextSafeAction).not.toContain('Every phase in the approved plan is complete');
  });

  test('unmet dependencies are computed, and a phase whose dependency is open is not startable', () => {
    // This used to lean on the live programme position, where Phase 17 was open — then Phase 17
    // closed and the assertion started passing vacuously in reverse. The unmet dependency is now
    // created IN THE FIXTURE, so the property is about the computation rather than about where the
    // programme happens to be.
    const open = projectGovernedState(fixtureInputs());
    const last = open.phases[open.phases.length - 1];
    expect(last?.phaseId).toBe(FX_LAST);
    expect(last?.unmetDependencies).toContain(FX_SECOND_LAST);
    expect(last?.startable).toBe(false);

    // And the other half, ALSO stated in the fixture. It used to read the live current-state and pass
    // only while the programme happened to sit one phase from the end; under a freshly approved plan
    // the same assertion is simply false, for a reason that has nothing to do with the computation.
    const satisfied = projectGovernedState(
      fixtureInputs({ currentState: { completedPhases: FIXTURE_IDS.slice(0, -1) } }),
    );
    const satisfiedLast = satisfied.phases[satisfied.phases.length - 1];
    expect(satisfiedLast?.unmetDependencies).toEqual([]);
  });

  test('a GENUINE delegated closure counts as complete; a forged role string does not', () => {
    // This asserted that `by: advisor` alone was enough. It was wrong: a role is a string, this
    // programme is tamperProof:false, and anything able to write the phase record can write
    // `advisor`. What must be established is the DECISION the closure consumed — so a forgery has to
    // produce a matching committed decision file too, which is a reviewable diff rather than one
    // line inside a record nobody reads.
    // Stated shape: the closure has to satisfy a DEPENDANT, which a single-phase programme has none of.
    const target = FX_SECOND_LAST;
    const gov = plan['governance'] as Record<string, unknown>;
    const del = gov['closureDelegation'] as Record<string, unknown> | undefined;
    const delegate = del === undefined ? null : String(del['delegatedTo']);
    const records = [{ phaseId: target, status: 'closed', history: closedBy(delegate === null ? 'owner' : 'advisor') }];
    const decision = decisionFor(target, delegate === null ? {} : { decidedBy: delegate });

    // C / D: the genuine pair is accepted.
    const genuine = projectGovernedState({
      ...fixtureInputs(),
      phaseRecords: records,
      closureDecisions: { [target]: decision },
    });
    expect(genuine.phases.find((x) => x.phaseId === FX_LAST)?.unmetDependencies).toEqual([]);

    // A / B: the SAME record with no decision behind it is not a completion.
    const forged = projectGovernedState({ ...fixtureInputs(), phaseRecords: records });
    expect(forged.phases.find((x) => x.phaseId === FX_LAST)?.unmetDependencies).toContain(target);

    // F: every way of breaking the binding fails closed.
    for (const broken of [
      { ...decision, consumedAt: undefined },
      { ...decision, decision: 'reject' },
      { ...decision, decidedBy: 'Mallory' },
      { ...decision, decidedBy: 'Claude Code' },
      { ...decision, phaseId: 'SOMETHING-ELSE1A' },
      { ...decision, projectId: 'polygo' },
      { ...decision, decisionId: 'NOT-THE-ONE-NAMED1A' },
    ]) {
      const p = projectGovernedState({
        ...fixtureInputs(),
        phaseRecords: records,
        closureDecisions: { [target]: broken },
      });
      expect(p.phases.find((x) => x.phaseId === FX_LAST)?.unmetDependencies).toContain(target);
    }
  });

  test('completion evidence requires an OWNER closure, matching the runtime gate exactly', () => {
    // Stated shape, for the same reason: the owner closure must satisfy a phase that depends on it.
    const target = FX_SECOND_LAST;
    const base = fixtureInputs();
    const claimed = projectGovernedState({
      ...base,
      phaseRecords: [{ phaseId: target, status: 'closed', history: [] }],
    });
    expect(claimed.phases.find((x) => x.phaseId === FX_LAST)?.unmetDependencies)
      .toContain(target);

    const ownerClosed = projectGovernedState({
      ...base,
      phaseRecords: [{ phaseId: target, status: 'closed', history: closedBy('owner') }],
      closureDecisions: { [target]: decisionFor(target) },
    });
    expect(ownerClosed.phases.find((x) => x.phaseId === FX_LAST)?.unmetDependencies).toEqual([]);
  });
});

describe('authority is projected truthfully', () => {
  test('the ProjectOS-only closure delegation is surfaced with its scope', () => {
    const p = projectGovernedState(inputs());
    expect(p.authority.owner).toBe('Murad');
    expect(p.authority.implementer).toBe('Claude Code');
    const del = p.authority.closureDelegation;
    expect(del).not.toBeNull();
    expect(del?.delegatedBy).toBe('Murad');
    expect(del?.projectScope).toBe(p.projectId);
    expect(del?.excludesProtectedActions).toBe(true);
    expect(p.authority.closureAuthority).toBe(del?.delegatedTo);
  });

  test('a plan with no delegation projects none rather than inventing one', () => {
    const noDelegation = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    delete (noDelegation['governance'] as Record<string, unknown>)['closureDelegation'];
    const p = projectGovernedState(inputs({ plan: noDelegation }));
    expect(p.authority.closureDelegation).toBeNull();
  });

  test('safety state comes from the project config', () => {
    const p = projectGovernedState(inputs());
    expect(p.safety.productionFreeze).toBe(true);
    expect(p.safety.forbiddenActions).toContain('production-deploy');
    expect(p.safety.approvalGates).toContain('phase-closure');
  });

  test('a protected branch is identified as protected', () => {
    const p = projectGovernedState(inputs({ branch: 'main' }));
    expect(p.repository.onProtectedBranch).toBe(true);
    expect(projectGovernedState(inputs()).repository.onProtectedBranch).toBe(false);
  });
});

describe('worker sessions are projected newest first', () => {
  test('sorts by startedAt descending regardless of input order', () => {
    const p = projectGovernedState(
      inputs({
        sessionRecords: [
          { sessionId: 'S-OLD', phaseId: 'P1', workerId: 'w', kind: 'claude', startedAt: '2026-08-01T00:00:00Z', state: 'exited', exitCode: 1 },
          { sessionId: 'S-NEW', phaseId: 'P1', workerId: 'w', kind: 'claude', startedAt: '2026-08-20T00:00:00Z', state: 'exited', exitCode: 0 },
        ],
      }),
    );
    expect(p.sessions.map((s) => s.sessionId)).toEqual(['S-NEW', 'S-OLD']);
  });

  test('a record with no sessionId is dropped rather than shown as an empty option', () => {
    const p = projectGovernedState(inputs({ sessionRecords: [{ phaseId: 'P1', state: 'exited' }] }));
    expect(p.sessions).toEqual([]);
  });

  test('exitCode is null when absent or non-numeric, never coerced to 0', () => {
    const p = projectGovernedState(
      inputs({ sessionRecords: [{ sessionId: 'S1', phaseId: 'P1', workerId: 'w', kind: 'claude', startedAt: 't', state: 'started' }] }),
    );
    expect(p.sessions[0]?.exitCode).toBeNull();
  });
});

describe('governed message envelope', () => {
  test('recognises a governed state message and rejects anything else', () => {
    expect(isGovernedStateMessage({ kind: GOVERNED_MESSAGE_KIND, state: { connected: false } })).toBe(true);
    expect(isGovernedStateMessage({ kind: 'snapshot', payload: {} })).toBe(false);
    expect(isGovernedStateMessage({ kind: GOVERNED_MESSAGE_KIND })).toBe(false);
    expect(isGovernedStateMessage(null)).toBe(false);
  });
});

describe('a proposal is projected with what it says, bounded, and nothing when it says nothing', () => {
  const record = (over: Record<string, unknown> = {}) => ({
    schemaVersion: '1.0.0',
    objectiveId: 'd1',
    origin: 'authored',
    planStatus: 'PLAN DRAFTED',
    generatedAt: '2026-09-03T21:44:27.678Z',
    draft: {
      businessVision: 'Prove one real Forge outcome end to end.',
      phaseCandidates: [
        { phaseId: 'C1', purpose: 'Configure the offline run as a check.', riskLevel: 'medium', dependencies: [] },
        { phaseId: 'C2', purpose: 'Owner decisions.', riskLevel: 'medium', dependencies: ['C1'] },
        { phaseId: '', purpose: 'a phase with no id is not a step', riskLevel: 'low', dependencies: [] },
        'not an object',
      ],
      ownerDecisionsRequired: ['Before C3: decide the worker write grant.'],
    },
    ...over,
  });

  test('vision, steps and owner decisions come from the draft body', () => {
    const p = projectGovernedState(inputs({ draftRecords: [record()] }));
    const d = p.planDrafts.find((x) => x.draftId === 'd1')!;
    expect(d.summary).toBe('Prove one real Forge outcome end to end.');
    expect(d.steps).toEqual([
      { id: 'C1', purpose: 'Configure the offline run as a check.', risk: 'medium' },
      { id: 'C2', purpose: 'Owner decisions.', risk: 'medium' },
    ]);
    expect(d.ownerDecisions).toEqual(['Before C3: decide the worker write grant.']);
  });

  test('a record without a draft body projects no content fields at all', () => {
    const p = projectGovernedState(inputs({ draftRecords: [record({ draft: undefined })] }));
    const d = p.planDrafts.find((x) => x.draftId === 'd1')!;
    expect(d).not.toHaveProperty('summary');
    expect(d).not.toHaveProperty('steps');
    expect(d).not.toHaveProperty('ownerDecisions');
  });

  test('decisions recorded only at the top level of the record are still shown (the digest-bound copy)', () => {
    const p = projectGovernedState(
      inputs({ draftRecords: [record({ ownerDecisionsRequired: ['Top-level decision.'], draft: { businessVision: 'v', phaseCandidates: [] } })] }),
    );
    expect(p.planDrafts.find((x) => x.draftId === 'd1')!.ownerDecisions).toEqual(['Top-level decision.']);
  });

  test('bidirectional overrides and control characters never reach the owner', () => {
    const p = projectGovernedState(
      inputs({ draftRecords: [record({ draft: { businessVision: 'Approve\u202E this\u0007 plan\u2066', phaseCandidates: [], ownerDecisionsRequired: [] } })] }),
    );
    expect(p.planDrafts.find((x) => x.draftId === 'd1')!.summary).toBe('Approve this plan');
  });

  test('text shaped like a secret is withheld, not shown', () => {
    const p = projectGovernedState(
      inputs({
        draftRecords: [
          record({
            draft: {
              businessVision: 'Use api_key=abcdefghijklmnop1234 to reach the provider.',
              phaseCandidates: [{ phaseId: 'C1', purpose: 'token sk-abcdefghijklmnopqrstuvwxyz0123', riskLevel: 'low', dependencies: [] }],
              ownerDecisionsRequired: ['Decide whether tokens are the right word here.'],
            },
          }),
        ],
      }),
    );
    const d = p.planDrafts.find((x) => x.draftId === 'd1')!;
    expect(d.summary).toContain('withheld');
    expect(d.steps![0]!.purpose).toContain('withheld');
    // An ordinary sentence that merely mentions tokens is not a secret.
    expect(d.ownerDecisions![0]).toBe('Decide whether tokens are the right word here.');
  });

  test('only the most recent proposals travel; the protocol line stays bounded', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      record({ objectiveId: `d${i}`, generatedAt: `2026-09-03T21:${String(i).padStart(2, '0')}:00.000Z` }),
    );
    const p = projectGovernedState(inputs({ draftRecords: many }));
    expect(p.planDrafts.length).toBe(8);
    expect(p.planDrafts[0]!.draftId).toBe('d19');
  });

  test('what is shown is bounded: a long vision is clipped, a long phase list is capped', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ phaseId: `P${i}`, purpose: 'x', riskLevel: 'low', dependencies: [] }));
    const p = projectGovernedState(
      inputs({ draftRecords: [record({ draft: { businessVision: 'v'.repeat(1000), phaseCandidates: many, ownerDecisionsRequired: Array.from({ length: 20 }, () => 'd'.repeat(1000)) } })] }),
    );
    const d = p.planDrafts.find((x) => x.draftId === 'd1')!;
    expect(d.summary!.length).toBeLessThanOrEqual(400);
    expect(d.steps!.length).toBe(12);
    expect(d.ownerDecisions!.length).toBe(8);
    expect(d.ownerDecisions![0]!.length).toBeLessThanOrEqual(400);
  });
});
