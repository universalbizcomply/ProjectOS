/**
 * The constitutional owner-only floor, on the LIVE gatekeeper path.
 *
 * WHY THIS FILE EXISTS. `ALWAYS_OWNER_ONLY` was written as "a floor, not the list" — five actions
 * whose whole purpose is that a human decided, refused regardless of what a phase remembered to
 * declare. It was reached from degraded mode and from `reconcile`, and from nowhere else. The live
 * gatekeeper turn — the one transition that takes a real reviewer's answer and applies it — was
 * handed `brief.phase.requiredOwnerGates` raw, so the approved plan was the ONLY thing standing
 * between a decision and a protected action. A phase that omitted `push` from its gates made `push`
 * grantable by a model.
 *
 * The floor was untouched and it did not cover the path that mattered. These tests are the
 * difference between those two sentences.
 *
 * Created in PROJECTOS-LIVE-GATE-OWNER-FLOOR-HARDENING1A.
 */
import { describe, it, expect } from 'vitest';
import { takeGatekeeperTurn, type GatekeeperTurnDeps, type GatekeeperTurnInput } from '../src/loop/gatekeeperTurn.js';
import { inMemoryResolverForTests } from '../src/loop/credentialResolver.js';
import {
  ALWAYS_OWNER_ONLY,
  APPROVED_PILOT_POLICY,
  enforcedOwnerOnlyActions,
  type GatekeeperTransportDescriptor,
  type RateCard,
} from '@projectos/core';
// The agent's degraded-mode module re-exports the floor from core. Imported here so the re-export is
// PROVEN to be the same object rather than assumed: every existing caller still spells it that way.
import { ALWAYS_OWNER_ONLY as FLOOR_VIA_DEGRADED_MODE } from '../src/loop/degradedMode.js';
import type { HttpPort, HttpResponse } from '../src/loop/transports/openaiResponses.js';
import type { LoopStop } from '../src/loop/outcome.js';

const SUBJECT = 'c4989eb0000000000000000000000000000000aa';
const PHASE = 'PROJECTOS-LIVE-GATE-OWNER-FLOOR-HARDENING1A';
const ROOT = 'C:/dev/ProjectOS';
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';

const RATE: RateCard = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};
const LUNA: RateCard = { ...RATE, model: 'gpt-5.6-luna', inputMicroUsdPerMillion: 100_000, outputMicroUsdPerMillion: 400_000 };

const TRANSPORT: GatekeeperTransportDescriptor = {
  transportId: 'openai-primary',
  kind: 'openai-responses',
  model: 'gpt-5.6-terra',
  capabilities: ['submit-request', 'receive-decision'],
  credentialRef: REF,
  commercialApproval: true,
};

const BINDING = {
  schemaVersion: '1.0.0',
  projectId: 'projectos',
  repositoryRoot: ROOT,
  providerThreadId: 'resp_7f3a9c2e5b81d40a',
  transportId: 'openai-primary',
  createdAt: '2026-08-17T20:00:00+01:00',
};

const stop: LoopStop = { code: 'UNRESOLVED_CRITICAL_OR_HIGH', detail: 'CRITICAL GK-1 — tenant filter missing' };

/**
 * A phase whose declared owner gates do NOT overlap the floor.
 *
 * `deploy-approval` is this phase's own gate and appears in no floor; none of the five floor actions
 * appear here. That separation is what lets each test below say WHICH of the two sources refused,
 * instead of proving only that something did.
 */
const PHASE_ONLY_GATES = ['deploy-approval'];

function input(over: Partial<GatekeeperTurnInput> = {}): GatekeeperTurnInput {
  return {
    stop,
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    repositoryRoot: ROOT,
    evidenceText: 'validators 138/138; one unresolved CRITICAL in the ledger query',
    ownerOnlyActions: PHASE_ONLY_GATES,
    expectedDecider: 'ChatGPT',
    at: '2026-08-17T23:30:00+01:00',
    ...over,
  };
}

function fakeHttp(reply: HttpResponse): { http: HttpPort; sent: Array<{ body: string }> } {
  const sent: Array<{ body: string }> = [];
  return {
    sent,
    http: {
      post(req) {
        sent.push({ body: req.body });
        return reply;
      },
    },
  };
}

function okReply(decision: Record<string, unknown>): HttpResponse {
  return {
    kind: 'response',
    status: 200,
    body: JSON.stringify({
      id: 'resp_abc123def456',
      created_at: '2026-08-17T23:30:05+01:00',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(decision) }] }],
      usage: { input_tokens: 17_088, input_tokens_details: { cached_tokens: 7_000 }, output_tokens: 800 },
    }),
  };
}

/** A verdict that continues the work, parameterised by what it claims it may do. */
function amendmentGranting(allowedActions: readonly string[]): Record<string, unknown> {
  return {
    decision: 'AMENDMENT_REQUIRED',
    reason: 'the finding is real',
    nextClaudeInstruction: 'Add the tenant predicate and re-run validate-all.',
    allowedActions: [...allowedActions],
    forbiddenActions: ['production-deploy'],
    ownerApprovalRequired: false,
    risks: [],
    carryForward: [],
  };
}

function deps(reply: Record<string, unknown>, over: Partial<GatekeeperTurnDeps> = {}): GatekeeperTurnDeps {
  return {
    transport: TRANSPORT,
    availability: { reachable: true },
    resolver: inMemoryResolverForTests(REF, 'sk-test-not-a-real-key-000000000000'),
    http: fakeHttp(okReply(reply)).http,
    modelPolicy: APPROVED_PILOT_POLICY,
    rateCards: { 'gpt-5.6-terra': RATE, 'gpt-5.6-luna': LUNA },
    budget: { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000, phaseHardStopAtMicroUsd: 5_000_000, dayHardStopAtMicroUsd: 5_000_000 },
    ledger: [],
    threadBinding: BINDING,
    transportDecider: 'ChatGPT',
    consumedDecisionIds: [],
    ...over,
  };
}

/** Every reason a refusal gave, as one searchable string. Empty when the turn did not refuse. */
function refusalText(result: ReturnType<typeof takeGatekeeperTurn>): string {
  return result.action.kind === 'owner' ? result.action.reasons.join(' | ') : '';
}

describe('the live gate enforces the phase own owner gates', () => {
  it('refuses a decision granting an action the phase declared owner-only', () => {
    const result = takeGatekeeperTurn(input(), deps(amendmentGranting(['implement', 'deploy-approval'])));
    expect(result.action.kind).toBe('owner');
    expect(refusalText(result)).toContain("decision grants 'deploy-approval'");
    expect(refusalText(result)).toContain('can never authorise it');
  });
});

describe('the live gate ALSO enforces the constitutional floor', () => {
  // THE LOAD-BEARING REGRESSION. This phase declares no floor action at all. Before this hardening
  // each decision below was ACCEPTED, and the loop continued under a verdict that had claimed
  // authority over a protected action.
  it.each([...ALWAYS_OWNER_ONLY])('refuses a decision granting %s even though the phase never declared it', (action) => {
    expect(PHASE_ONLY_GATES).not.toContain(action);
    const result = takeGatekeeperTurn(input(), deps(amendmentGranting(['implement', action])));
    expect(result.action.kind).toBe('owner');
    expect(refusalText(result)).toContain(`decision grants '${action}'`);
    expect(refusalText(result)).toContain('can never authorise it');
  });

  // A5 IN ITS BLUNTEST FORM: a phase that declares no gates whatsoever is still floored.
  it('holds when the phase declares no owner gates at all', () => {
    const result = takeGatekeeperTurn(input({ ownerOnlyActions: [] }), deps(amendmentGranting(['implement', 'push'])));
    expect(result.action.kind).toBe('owner');
    expect(refusalText(result)).toContain("decision grants 'push'");
  });

  // The set the REVIEWER IS TOLD must be the set that will be enforced. Telling it a smaller list and
  // then refusing what it proposed in good faith is a refusal the reviewer could not have avoided.
  it('tells the reviewer the enforced set, not the phase declaration alone', () => {
    const result = takeGatekeeperTurn(input(), deps(amendmentGranting(['implement'])));
    expect(result.request?.ownerOnlyActions).toEqual(enforcedOwnerOnlyActions(PHASE_ONLY_GATES));
    for (const action of ALWAYS_OWNER_ONLY) expect(result.request?.ownerOnlyActions).toContain(action);
    expect(result.request?.ownerOnlyActions).toContain('deploy-approval');
  });
});

describe('neither source replaces the other', () => {
  it('enforces the union, and leaves an ordinary technical action alone', () => {
    const enforced = enforcedOwnerOnlyActions(PHASE_ONLY_GATES);
    for (const action of [...ALWAYS_OWNER_ONLY, ...PHASE_ONLY_GATES]) expect(enforced).toContain(action);
    // The whole point of a floor is that it stops PROTECTED actions and nothing else.
    const result = takeGatekeeperTurn(input(), deps(amendmentGranting(['implement', 'run-validators'])));
    expect(result.action).toEqual({ kind: 'retry', instruction: 'Add the tenant predicate and re-run validate-all.' });
  });

  it('has one definition, however a caller spells the import', () => {
    expect(FLOOR_VIA_DEGRADED_MODE).toBe(ALWAYS_OWNER_ONLY);
  });

  it('is deterministic and deduplicated when a phase restates a floor action', () => {
    // The active ProjectOS plan declares exactly the floor, so this is the real case, not a contrived one.
    //
    // ASSERTED AS A SET, NOT A SEQUENCE. Order was never a property of the enforced list — nothing
    // reads it positionally, every consumer asks `includes` — and pinning it once meant the
    // conditional-floor split failed a test for rearranging two constants while protecting exactly
    // the same actions. Content and deduplication are what matter, so those are what is asserted.
    const restated = enforcedOwnerOnlyActions([...ALWAYS_OWNER_ONLY]);
    expect([...restated].sort()).toEqual([...ALWAYS_OWNER_ONLY].sort());
    expect(new Set(restated).size).toBe(restated.length);
    // Content does not depend on how many times, or in which order, the caller repeats itself.
    expect([...enforcedOwnerOnlyActions(['push', 'push', 'deploy-approval'])].sort()).toEqual(
      [...enforcedOwnerOnlyActions(['deploy-approval', 'push'])].sort(),
    );
  });
});

describe('what this hardening did not change', () => {
  it('still refuses when the plan names a different reviewer than the transport reports', () => {
    const result = takeGatekeeperTurn(input({ expectedDecider: 'SomeoneElse' }), deps(amendmentGranting(['implement'])));
    expect(result.action.kind).toBe('owner');
    expect(refusalText(result)).toContain('did not pass its own checks');
  });

  // THE IMPLEMENTER CAN NEVER BE THE GATEKEEPER. Held by the decider check, not by the floor — proven
  // here so that a change to either becomes visible from this file.
  it('refuses a decision the implementer took, however the plan names it', () => {
    const result = takeGatekeeperTurn(
      input({ expectedDecider: 'Claude' }),
      deps(amendmentGranting(['implement']), { transportDecider: 'Claude' }),
    );
    expect(result.action.kind).toBe('owner');
    expect(refusalText(result)).toContain('implementer can never act as its own gatekeeper');
  });

  it('still refuses a decision whose id was already acted on', () => {
    const first = takeGatekeeperTurn(input(), deps(amendmentGranting(['implement'])));
    const replay = takeGatekeeperTurn(
      input(),
      deps(amendmentGranting(['implement']), { consumedDecisionIds: [`GKDEC-${first.request?.requestId}`] }),
    );
    expect(replay.action.kind).toBe('owner');
    expect(refusalText(replay)).toContain('cannot be replayed');
  });

  // The request IDENTITY is the question, not the policy applied to the answer. Widening the
  // owner-only set must not make a restart look like a new question and buy a second call.
  it('leaves the request id derived from the question, not from the owner-only set', () => {
    const narrow = takeGatekeeperTurn(input({ ownerOnlyActions: [] }), deps(amendmentGranting(['implement'])));
    const wide = takeGatekeeperTurn(input({ ownerOnlyActions: PHASE_ONLY_GATES }), deps(amendmentGranting(['implement'])));
    expect(narrow.request?.requestId).toBe(wide.request?.requestId);
  });
});
