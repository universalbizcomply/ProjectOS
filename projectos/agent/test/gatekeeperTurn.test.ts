/**
 * The whole governance turn, deterministically, with no network and no secret.
 *
 * This is the mocked end-to-end proof the phase requires. Every path a real run can take is exercised
 * here through injected ports: the ordinary cycle, the reviewer being unreachable, the spend limit
 * refusing before the call, the provider refusing because of ITS spend limit, a restart re-deriving
 * the same request, another project's binding, and a reply that is well-formed but not about this.
 *
 * WHAT IT DOES NOT PROVE: that a real OpenAI reviewer behaves this way. It proves ProjectOS does.
 */
import { describe, it, expect } from 'vitest';
import {
  takeGatekeeperTurn,
  deriveRequestId,
  evidenceDigest,
  STOP_ASKS,
  type GatekeeperTurnDeps,
  type GatekeeperTurnInput,
} from '../src/loop/gatekeeperTurn.js';
import { unprovisionedResolver, inMemoryResolverForTests } from '../src/loop/credentialResolver.js';
import { gatekeeperRequestDigest } from '@projectos/core';
import type { HttpPort, HttpResponse } from '../src/loop/transports/openaiResponses.js';
import {
  APPROVED_PILOT_POLICY,
  GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
  type GatekeeperTransportDescriptor,
  type LedgerEntry,
  type RateCard,
} from '@projectos/core';
import type { LoopStop } from '../src/loop/outcome.js';

const SUBJECT = 'c4989eb0000000000000000000000000000000aa';
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const ROOT = 'C:/dev/ProjectOS';
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
const OWNER_ONLY = ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'];

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

const criticalStop: LoopStop = {
  code: 'UNRESOLVED_CRITICAL_OR_HIGH',
  detail: 'CRITICAL GK-1 — tenant filter missing',
};

function input(over: Partial<GatekeeperTurnInput> = {}): GatekeeperTurnInput {
  return {
    stop: criticalStop,
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    repositoryRoot: ROOT,
    evidenceText: 'validators 130/130; one unresolved CRITICAL in the ledger query',
    ownerOnlyActions: OWNER_ONLY,
    expectedDecider: 'ChatGPT',
    at: '2026-08-17T23:30:00+01:00',
    ...over,
  };
}

/** A provider that returns exactly the reply the test wants, and records what it was sent. */
function fakeHttp(reply: HttpResponse): { http: HttpPort; sent: Array<{ headers: Record<string, string>; body: string }> } {
  const sent: Array<{ headers: Record<string, string>; body: string }> = [];
  return {
    sent,
    http: {
      post(req) {
        sent.push({ headers: { ...req.headers }, body: req.body });
        return reply;
      },
    },
  };
}

function okReply(decision: Record<string, unknown>, usage?: Record<string, unknown>): HttpResponse {
  return {
    kind: 'response',
    status: 200,
    body: JSON.stringify({
      id: 'resp_abc123def456',
      created_at: '2026-08-17T23:30:05+01:00',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(decision) }] }],
      usage: usage ?? { input_tokens: 17_088, input_tokens_details: { cached_tokens: 7_000 }, output_tokens: 800 },
    }),
  };
}

const AMENDMENT = {
  decision: 'AMENDMENT_REQUIRED',
  reason: 'the finding is real',
  nextClaudeInstruction: 'Add the tenant predicate and re-run validate-all.',
  allowedActions: ['implement', 'run-validators'],
  forbiddenActions: [...OWNER_ONLY],
  ownerApprovalRequired: false,
  risks: [],
  carryForward: [],
};

function deps(over: Partial<GatekeeperTurnDeps> = {}): GatekeeperTurnDeps {
  return {
    transport: TRANSPORT,
    availability: { reachable: true },
    resolver: inMemoryResolverForTests(REF, 'sk-test-not-a-real-key-000000000000'),
    http: fakeHttp(okReply(AMENDMENT)).http,
    modelPolicy: APPROVED_PILOT_POLICY,
    rateCards: { 'gpt-5.6-terra': RATE, 'gpt-5.6-luna': LUNA },
    budget: { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 },
    ledger: [],
    threadBinding: BINDING,
    transportDecider: 'ChatGPT',
    consumedDecisionIds: [],
    ...over,
  };
}

describe('one ordinary governance turn', () => {
  it('asks the reviewer and turns the answer into the loop\'s next move', () => {
    const result = takeGatekeeperTurn(input(), deps());
    expect(result.action).toEqual({ kind: 'retry', instruction: 'Add the tenant predicate and re-run validate-all.' });
    expect(result.request?.ask).toBe('security-review');
    expect(result.ledgerEntry).not.toBeNull();
    expect(result.ledgerEntry?.costMicroUsd).toBeGreaterThan(0);
  });

  it('sends the credential in a header and never puts it in the trace', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(fake.sent[0]?.headers['Authorization']).toContain('sk-test-not-a-real-key');
    const trace = [...result.lines, ...(result.action.kind === 'owner' ? result.action.reasons : [])].join(' ');
    expect(trace).not.toContain('sk-test');
  });

  it('prices a security review at the strong tier and evidence review at the cheap one', () => {
    const strong = takeGatekeeperTurn(input(), deps());
    expect(strong.lines.join(' ')).toContain('gpt-5.6-terra');
    const cheap = takeGatekeeperTurn(
      input({ stop: { code: 'REVIEW_OUTSTANDING', detail: 'code-review has no record' } }),
      deps({ http: fakeHttp(okReply({ ...AMENDMENT, nextClaudeInstruction: 'Run the review.' })).http }),
    );
    expect(cheap.lines.join(' ')).toContain('gpt-5.6-luna');
  });

  it('subtracts cached tokens from the input count rather than charging both rates', () => {
    const result = takeGatekeeperTurn(input(), deps());
    expect(result.ledgerEntry?.usage.inputTokens).toBe(17_088 - 7_000);
    expect(result.ledgerEntry?.usage.cachedInputTokens).toBe(7_000);
  });
});

describe('stops that are the owner\'s', () => {
  it.each(['PROTECTED_EFFECT', 'OWNER_GATE', 'SCOPE_DECISION'] as const)('never sends a request for %s', (code) => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(input({ stop: { code, detail: 'x' } }), deps({ http: fake.http }));
    expect(result.action.kind).toBe('owner');
    expect(result.request).toBeNull();
    expect(fake.sent).toEqual([]);
    expect(result.ledgerEntry).toBeNull();
  });

  it('maps every stop code to an ask, so none is unpriced', () => {
    for (const ask of Object.values(STOP_ASKS)) expect(typeof ask).toBe('string');
  });
});

describe('when the reviewer cannot be reached', () => {
  const expectOwnerChoice = (result: ReturnType<typeof takeGatekeeperTurn>) => {
    expect(result.action.kind).toBe('owner');
    expect(result.ownerChoices).toEqual(GATEKEEPER_UNAVAILABLE_OWNER_CHOICES);
    expect(result.ledgerEntry).toBeNull();
  };

  it('offers the owner the three choices when the network fails', () => {
    const fake = fakeHttp({ kind: 'transport-error', detail: 'ECONNRESET' });
    expectOwnerChoice(takeGatekeeperTurn(input(), deps({ http: fake.http })));
  });

  it('offers the three choices when the credential is not provisioned, and does not fall back', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(
      input(),
      deps({ resolver: unprovisionedResolver('no secret store entry exists yet'), http: fake.http }),
    );
    expectOwnerChoice(result);
    // Nothing was sent: the credential is resolved before the call, not after it fails.
    expect(fake.sent).toEqual([]);
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('has not been provisioned'))).toBe(true);
    expect(result.action.reasons.some((r) => r.includes('no fallback'))).toBe(true);
  });

  it('offers the three choices when no transport is configured at all', () => {
    expectOwnerChoice(takeGatekeeperTurn(input(), deps({ transport: null })));
  });

  // NO SECOND TRANSPORT, EVER. The turn takes one descriptor and has nowhere to put another.
  it('never tries an alternative route', () => {
    const fake = fakeHttp({ kind: 'transport-error', detail: 'ECONNRESET' });
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(fake.sent.length).toBe(1);
    expect(result.action.kind).toBe('owner');
  });
});

describe('the provider\'s own spend limit', () => {
  // A 429 FOR SPEND IS NOT A 429 FOR RATE. One says "later"; the other says "not until somebody
  // decides something", and retrying against the second is an outage wearing a budget's clothes.
  it('is reported as a budget decision, not a temporary failure', () => {
    const fake = fakeHttp({
      kind: 'response',
      status: 429,
      body: JSON.stringify({ error: { code: 'project_spend_limit_exceeded', message: 'limit reached' } }),
    });
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(result.action.kind).toBe('owner');
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('spend limit was reached'))).toBe(true);
    expect(result.action.reasons.some((r) => r.includes('retrying cannot resolve it'))).toBe(true);
  });

  it('treats an ordinary rate-limit 429 as a plain unavailability', () => {
    const fake = fakeHttp({ kind: 'response', status: 429, body: JSON.stringify({ error: { code: 'rate_limit_exceeded' } }) });
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('retrying cannot resolve it'))).toBe(false);
  });
});

describe('the ProjectOS spend limit', () => {
  const spent = (micro: number): LedgerEntry[] => [
    {
      requestId: 'GKREQ-earlier',
      projectId: 'projectos',
      phaseId: PHASE,
      model: 'gpt-5.6-terra',
      usage: { inputTokens: 1, outputTokens: 1 },
      costMicroUsd: micro,
      at: '2026-08-17T10:00:00+01:00',
    },
  ];

  it('refuses the call BEFORE it is made once the month is spent', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(input(), deps({ ledger: spent(5_000_000), http: fake.http }));
    expect(result.action.kind).toBe('owner');
    expect(fake.sent).toEqual([]);
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('refused this gatekeeper call before it was made'))).toBe(true);
  });

  it('reports the warning threshold while still allowing the call', () => {
    const result = takeGatekeeperTurn(input(), deps({ ledger: spent(2_500_000) }));
    expect(result.lines.join(' ')).toContain('WARNING');
    expect(result.action.kind).toBe('retry');
  });

  it('refuses when no rate card exists for the chosen model, rather than calling blind', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(input(), deps({ rateCards: {}, http: fake.http }));
    expect(fake.sent).toEqual([]);
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('cost of this call cannot be established'))).toBe(true);
  });
});

describe('restart and resume', () => {
  // THE WHOLE OF DUPLICATE PROTECTION RESTS ON THIS. A derived id survives the process that made it.
  it('re-derives the same request id for the same question', () => {
    const a = takeGatekeeperTurn(input(), deps());
    const b = takeGatekeeperTurn(input(), deps());
    expect(a.request?.requestId).toBe(b.request?.requestId);
  });

  it('derives a different id when the evidence changes', () => {
    const a = takeGatekeeperTurn(input(), deps());
    const b = takeGatekeeperTurn(input({ evidenceText: 'something else entirely' }), deps());
    expect(a.request?.requestId).not.toBe(b.request?.requestId);
  });

  it('derives a different id at a different subject commit', () => {
    const a = deriveRequestId({ projectId: 'projectos', phaseId: PHASE, subjectCommit: SUBJECT, ask: 'x', evidenceDigest: 'd' });
    const b = deriveRequestId({ projectId: 'projectos', phaseId: PHASE, subjectCommit: 'f'.repeat(40), ask: 'x', evidenceDigest: 'd' });
    expect(a).not.toBe(b);
  });

  it('refuses to apply a decision whose id was already acted on', () => {
    const first = takeGatekeeperTurn(input(), deps());
    const decisionId = `GKDEC-${first.request?.requestId}`;
    const replay = takeGatekeeperTurn(input(), deps({ consumedDecisionIds: [decisionId] }));
    expect(replay.action.kind).toBe('owner');
    if (replay.action.kind !== 'owner') throw new Error('unreachable');
    expect(replay.action.reasons.some((r) => r.includes('cannot be replayed'))).toBe(true);
  });

  it('counts a repeated call once in the ledger', () => {
    const first = takeGatekeeperTurn(input(), deps());
    const again = takeGatekeeperTurn(input(), deps({ ledger: [first.ledgerEntry!] }));
    expect(again.ledgerEntry?.requestId).toBe(first.ledgerEntry?.requestId);
  });
});

describe('multi-project isolation', () => {
  it('refuses before sending when the thread belongs to another project', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(
      input(),
      deps({ threadBinding: { ...BINDING, projectId: 'polygo' }, http: fake.http }),
    );
    expect(fake.sent).toEqual([]);
    expect(result.action.kind).toBe('owner');
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('could not be established'))).toBe(true);
  });

  it('refuses when the thread belongs to another checkout of the same project', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(
      input(),
      deps({ threadBinding: { ...BINDING, repositoryRoot: 'C:/dev/ProjectOS-copy' }, http: fake.http }),
    );
    expect(fake.sent).toEqual([]);
    expect(result.action.kind).toBe('owner');
  });

  it('refuses when no thread has been established for this project', () => {
    const result = takeGatekeeperTurn(input(), deps({ threadBinding: null }));
    expect(result.action.kind).toBe('owner');
  });

  // THE BINDING PROVES ISOLATION; IT IS NOT THE CONVERSATION. An earlier version sent the binding's
  // own id as `previous_response_id` and the first live call returned HTTP 400 - ProjectOS's record
  // of WHICH conversation this is had been mistaken for the provider's record of what was said last.
  // They are separate facts, and only one of them exists before any call has been made.
  it('does not send the thread binding id as the provider conversation id', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(fake.sent[0]?.body).not.toContain('previous_response_id');
    expect(fake.sent[0]?.body).not.toContain('resp_7f3a9c2e5b81d40a');
  });

  /**
   * THE GOVERNED REVIEW IS NOW STATELESS, AND THIS TEST IS THE INVERSE OF WHAT IT USED TO ASSERT.
   *
   * It required the turn to send `previous_response_id` whenever one had been issued. That is the
   * behaviour that broke the budget: `store: true` plus a continuation makes the provider replay the
   * whole stored conversation and bill it again as fresh input, and the reservation never saw a byte
   * of it. Measured on `GKREQ-b045e264`: 8,408 tokens reserved, 184,232 billed — 21.9x — and across
   * one thread's fifty calls the input grew from 1,599 to 187,452, unbounded and uncached.
   *
   * Nothing in the decision contract wanted it. A decision is bound to an exact `subjectCommit` and
   * `requestDigest`, carries its own complete evidence, and is judged on binding, replay and
   * authority — none of which consults a conversation. `projectos reconcile` has always sent
   * `previousResponseId: null` and its decisions pass the same checker.
   *
   * So the turn must NOT continue a stored conversation even when one is offered.
   */
  it('never continues a stored conversation — the turn cannot even be given one', () => {
    // STRONGER THAN THE ASSERTION IT REPLACES. The deps no longer carry a `previousResponseId` at
    // all, so this is not "the turn declines to use it" but "there is nothing to use". The security
    // review of this change flagged the leftover field as a footgun: a future edit wiring it into the
    // dispatch while the pricing call kept the local null would silently restore the exact
    // priced-vs-dispatched mismatch that cost 21.9x. Removing it means that edit does not compile.
    const fake = fakeHttp(okReply(AMENDMENT));
    takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(fake.sent[0]?.body).not.toContain('previous_response_id');
    expect(Object.keys(deps({}))).not.toContain('previousResponseId');
  });

  it('reserves against the whole request body, not the evidence inside it', () => {
    // The reservation line names both halves of the bound, so an under-reservation is legible in the
    // run's own output rather than only in the ledger a month later.
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    const reservation = result.lines.find((l) => l.startsWith('reservation:'));
    expect(reservation).toBeDefined();
    expect(reservation).toContain('request bytes');
    expect(reservation).toContain('carried context token(s)');
    // The body really is bigger than the evidence it carries — instructions, schema and binding.
    const evidenceBytes = Buffer.byteLength(input().evidenceText, 'utf8');
    const bodyBytes = Buffer.byteLength(String(fake.sent[0]?.body ?? ''), 'utf8');
    expect(bodyBytes).toBeGreaterThan(evidenceBytes);
    expect(reservation).toContain(String(bodyBytes));
  });

  it('returns the provider response id so the next turn can continue the thread', () => {
    const result = takeGatekeeperTurn(input(), deps());
    expect(result.providerResponseId).toBe('resp_abc123def456');
  });
});

describe('a reply that is well formed but not an answer to this', () => {
  it('refuses a decision the checks reject, and says why', () => {
    // The runtime stamps the bindings, so the way to reach a mismatch is to change what the runtime
    // expects — here, the plan names a different reviewer than the transport reports.
    const result = takeGatekeeperTurn(input({ expectedDecider: 'SomeoneElse' }), deps());
    expect(result.action.kind).toBe('owner');
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('did not pass its own checks'))).toBe(true);
  });

  it('refuses a verdict that grants an owner-only action', () => {
    const grabby = { ...AMENDMENT, allowedActions: ['implement', 'push'] };
    const result = takeGatekeeperTurn(input(), deps({ http: fakeHttp(okReply(grabby)).http }));
    expect(result.action.kind).toBe('owner');
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('can never authorise it'))).toBe(true);
  });

  it('refuses a reply carrying no structured decision', () => {
    const fake = fakeHttp({ kind: 'response', status: 200, body: JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'I think it looks fine' }] }] }) });
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(result.action.kind).toBe('owner');
    if (result.action.kind !== 'owner') throw new Error('unreachable');
    expect(result.action.reasons.some((r) => r.includes('refused rather than interpreted'))).toBe(true);
  });

  it('refuses a provider refusal rather than parsing it as a decision', () => {
    const fake = fakeHttp({ kind: 'response', status: 200, body: JSON.stringify({ output: [{ content: [{ type: 'refusal', refusal: 'I cannot help' }] }] }) });
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(result.action.kind).toBe('owner');
  });

  it('refuses an unknown verdict rather than reading it as approval', () => {
    const odd = { ...AMENDMENT, decision: 'LOOKS_FINE' };
    const result = takeGatekeeperTurn(input(), deps({ http: fakeHttp(okReply(odd)).http }));
    expect(result.action.kind).toBe('owner');
  });
});

describe('the evidence binds the request', () => {
  it('digests exactly what was presented', () => {
    const text = 'validators 130/130';
    expect(evidenceDigest(text)).toBe(evidenceDigest(text));
    expect(evidenceDigest(text)).not.toBe(evidenceDigest(text + ' '));
  });

  it('sends the digest so the reviewer answers a question it can see the identity of', () => {
    const fake = fakeHttp(okReply(AMENDMENT));
    const result = takeGatekeeperTurn(input(), deps({ http: fake.http }));
    expect(fake.sent[0]?.body).toContain(result.request!.requestId);
  });
});

/* ------------------------------------------------------------------------------------------------
 * WHAT WAS DECIDED IS KEPT — PROJECTOS-EXECUTION-DECISION-PROVENANCE-FIX1A.
 *
 * The ledger recorded that a call happened and what it cost; it never recorded the VERDICT, the
 * grounds, or what the verdict permitted. Once a run ended, ProjectOS could not say what it acted on.
 *
 * The record kept here is EVIDENCE, never a permit. These prove both halves: that an accepted
 * decision is handed to the durability port, and that a refused or malformed one is not — because a
 * record that exists is the thing a future reader is most likely to mistake for permission.
 * --------------------------------------------------------------------------------------------- */
describe('an accepted decision is kept as evidence, and a refused one is not', () => {
  function capture() {
    const kept: Record<string, unknown>[] = [];
    return {
      kept,
      port: (record: Record<string, unknown>) => {
        kept.push(record);
        return 'written' as const;
      },
    };
  }

  it('hands the accepted decision to the durability port, with the four bindings intact', () => {
    const c = capture();
    const inp = input();
    const result = takeGatekeeperTurn(inp, deps({ recordDecisionEvidence: c.port as never }));

    expect(c.kept).toHaveLength(1);
    // A: persistence succeeded, so the verdict applies.
    expect(result.action).toEqual({ kind: 'retry', instruction: 'Add the tenant predicate and re-run validate-all.' });
    const kept = c.kept[0]!;
    // A2 — the four bindings the decision contract already enforces survive into the evidence.
    expect(kept['projectId']).toBe(inp.projectId);
    expect(kept['phaseId']).toBe(inp.phaseId);
    expect(kept['subjectCommit']).toBe(inp.subjectCommit);
    expect(kept['requestDigest']).toBe(gatekeeperRequestDigest(result.request!));
    // A3 — and so does what was decided, and on what grounds.
    expect(kept['decision']).toBe('AMENDMENT_REQUIRED');
    expect(kept['reason']).toBe('the finding is real');
    expect(kept['allowedActions']).toEqual(['implement', 'run-validators']);
    expect(kept['forbiddenActions']).toEqual([...OWNER_ONLY]);
    expect(kept['decidedBy']).toBeDefined();
    expect(kept['decidedAt']).toBeDefined();
  });

  it('A4/A9: a reply grabbing an owner-only action is refused, and never kept', () => {
    // THE BINDINGS CANNOT BE FAKED BY A REPLY AT ALL — the runtime stamps project, phase, subject and
    // digest, and never asks the model for them, so a self-consistent lie about WHAT a decision is
    // about is unrepresentable. What a reply does control is what it tries to authorise, so that is
    // what this drives: a verdict reaching for an owner-only action is refused, and a refused
    // decision leaves no accepted-decision record behind to be mistaken for one.
    const grabbing = { ...AMENDMENT, allowedActions: ['implement', OWNER_ONLY[0]] };
    const c = capture();
    const result = takeGatekeeperTurn(
      input(),
      deps({ http: fakeHttp(okReply(grabbing)).http, recordDecisionEvidence: c.port as never }),
    );

    expect(c.kept).toHaveLength(0);
    expect(result.action.kind).toBe('owner');
  });

  it('A4: an unrecognised verdict is never kept', () => {
    // "An unknown verdict is not a permissive one" — and it is not a recordable one either.
    const invented = { ...AMENDMENT, decision: 'LOOKS_FINE_TO_ME' };
    const c = capture();
    takeGatekeeperTurn(
      input(),
      deps({ http: fakeHttp(okReply(invented)).http, recordDecisionEvidence: c.port as never }),
    );
    expect(c.kept).toHaveLength(0);
  });

  it('A4: a replayed decision is never kept a second time', () => {
    const c = capture();
    const inp = input();
    const first = takeGatekeeperTurn(inp, deps({ recordDecisionEvidence: c.port as never }));
    const spent = `GKDEC-${first.request!.requestId}`;

    takeGatekeeperTurn(inp, deps({ consumedDecisionIds: [spent], recordDecisionEvidence: c.port as never }));
    expect(c.kept).toHaveLength(1);
  });

  it('the turn proceeds unchanged when nothing is recording', () => {
    // The port is optional: durability is the entrypoint's business, and its absence must not change
    // what the runtime decides.
    const withPort = takeGatekeeperTurn(input(), deps({ recordDecisionEvidence: capture().port as never }));
    const without = takeGatekeeperTurn(input(), deps());
    expect(without.action).toEqual(withPort.action);
  });

  it('C: a decision that could not be recorded is NOT acted on', () => {
    // THE CORRECTION THIS AMENDMENT EXISTS FOR. Recording was best-effort, so a verdict applied
    // whether or not the write landed — an action taken on a decision nothing recorded, which is
    // the untraceable step the provenance contract exists to prevent.
    const result = takeGatekeeperTurn(
      input(),
      deps({ recordDecisionEvidence: (() => 'refused: evidence could not be written') as never }),
    );

    expect(result.action.kind).toBe('owner');
    expect(result.action.kind === 'owner' ? result.action.reasons.join(' ') : '').toContain('NOT acted on');
    // The bill still stands: the call really happened, and pretending otherwise would lose the cost.
    expect(result.ledgerEntry).not.toBeNull();
  });

  it('D: contradictory stored evidence stops the action rather than choosing between answers', () => {
    // Two different answers under one deterministic id: the runtime cannot know which it would be
    // acting on, so it refuses. The stored record is untouched and grants nothing either way.
    const result = takeGatekeeperTurn(
      input(),
      deps({ recordDecisionEvidence: (() => 'conflict: different decision evidence already recorded') as never }),
    );

    expect(result.action.kind).toBe('owner');
    expect(result.action.kind === 'owner' ? result.action.reasons.join(' ') : '').toContain('conflict');
  });

  it('B: byte-identical evidence already recorded is not a conflict, and the verdict applies', () => {
    // A restart re-derives the same question and can receive the same answer. Provenance is intact,
    // so there is nothing to refuse.
    const result = takeGatekeeperTurn(
      input(),
      deps({ recordDecisionEvidence: (() => 'already-recorded') as never }),
    );
    expect(result.action).toEqual({ kind: 'retry', instruction: 'Add the tenant predicate and re-run validate-all.' });
  });
});
