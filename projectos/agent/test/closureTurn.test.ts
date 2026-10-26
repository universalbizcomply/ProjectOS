/**
 * The closure turn, deterministically, with no network and no secret.
 *
 * Every path a real closure request can take is exercised here through injected ports: the ordinary
 * cycle, the authority being unreachable, the spend limit refusing before the call, the provider
 * refusing because of ITS spend limit, a restart re-deriving the same request, another project's
 * thread binding, an answer that is well-formed but not about this, and an answer that is a technical
 * verdict wearing a closure record's clothes.
 *
 * WHAT IT DOES NOT PROVE: that a real closure authority behaves this way. It proves ProjectOS does.
 *
 * NO PROVIDER REQUEST IS MADE AND NOTHING IS SPENT. The HTTP port is a fake in every case, and the
 * assertions include that the fake was never called on the paths where nothing should be sent.
 */
import { describe, it, expect } from 'vitest';
import { takeClosureTurn, type ClosureTurnDeps, type ClosureTurnInput } from '../src/loop/closureTurn.js';
import { buildClosureResponsesBody, closureSystemInstruction } from '../src/loop/transports/closureResponses.js';
import { GATEKEEPER_OUTPUT_TOKEN_LIMIT } from '../src/loop/transports/openaiResponses.js';
import { inMemoryResolverForTests, unprovisionedResolver } from '../src/loop/credentialResolver.js';
import {
  APPROVED_PILOT_POLICY,
  CLOSURE_ASK,
  CLOSURE_DECISION_SCHEMA_VERSION,
  CLOSURE_REQUEST_SCHEMA_VERSION,
  PHASE_CLOSURE_SCOPE,
  closureEvidenceDigest,
  closureRequestDigest,
  deriveClosureRequestId,
  type ClosureRequest,
  type GatekeeperTransportDescriptor,
  type RateCard,
} from '@projectos/core';
import type { HttpPort, HttpResponse } from '../src/loop/transports/openaiResponses.js';

const PROJECT = 'projectos';
const PHASE = 'PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A';
const SUBJECT = 'c00b1b22091aaade4fa3644e980424c7f798c559';
const ROOT = 'C:/dev/ProjectOS';
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
const DECIDER = 'ChatGPT';
const EVIDENCE = 'validators 141/141; reviews complete; 0 CRITICAL, 0 HIGH; pushed and reconciled';

const RATE: RateCard = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

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
  projectId: PROJECT,
  repositoryRoot: ROOT,
  providerThreadId: 'resp_7f3a9c2e5b81d40a',
  transportId: 'openai-primary',
  createdAt: '2026-09-02T20:00:00+01:00',
};

function input(over: Partial<ClosureTurnInput> = {}): ClosureTurnInput {
  return {
    projectId: PROJECT,
    phaseId: PHASE,
    subjectHead: SUBJECT,
    repositoryRoot: ROOT,
    evidenceText: EVIDENCE,
    expectedDecider: DECIDER,
    owner: 'Murad',
    unresolvedHighIds: [],
    at: '2026-09-02T21:30:00+01:00',
    ...over,
  };
}

/** The request the turn will form for the default input, so a test can compute its digest. */
function expectedRequest(): ClosureRequest {
  const evidenceDigest = closureEvidenceDigest(EVIDENCE);
  return {
    schemaVersion: CLOSURE_REQUEST_SCHEMA_VERSION,
    requestId: deriveClosureRequestId({ projectId: PROJECT, phaseId: PHASE, subjectHead: SUBJECT, evidenceDigest }),
    projectId: PROJECT,
    phaseId: PHASE,
    subjectHead: SUBJECT,
    evidenceDigest,
    expectedDecider: DECIDER,
    scope: PHASE_CLOSURE_SCOPE,
  };
}

function answer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION,
    decisionId: 'CLOSURE-TRANSPORT1A-DECISION1A',
    decision: 'close',
    projectId: PROJECT,
    phaseId: PHASE,
    scope: PHASE_CLOSURE_SCOPE,
    decidedBy: DECIDER,
    decidedAt: '2026-09-02T21:31:00+01:00',
    evidenceSubjectHead: SUBJECT,
    requestDigest: closureRequestDigest(expectedRequest()),
    note: 'accepted for closure',
    ownerAcceptedFindings: [],
    ...over,
  };
}

function okReply(body: Record<string, unknown>): HttpResponse {
  return {
    kind: 'response',
    status: 200,
    body: JSON.stringify({
      id: 'resp_closure_0001',
      created_at: '2026-09-02T21:31:00+01:00',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(body) }] }],
      usage: { input_tokens: 12_000, input_tokens_details: { cached_tokens: 2_000 }, output_tokens: 400 },
    }),
  };
}

function fakeHttp(reply: HttpResponse): { http: HttpPort; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    http: {
      post(req) {
        sent.push(req.body);
        return reply;
      },
    },
  };
}

function deps(over: Partial<ClosureTurnDeps> = {}, reply: HttpResponse = okReply(answer())): { deps: ClosureTurnDeps; sent: string[] } {
  const { http, sent } = fakeHttp(reply);
  return {
    sent,
    deps: {
      transport: TRANSPORT,
      availability: { reachable: true },
      resolver: inMemoryResolverForTests(REF, 'sk-test-000000000000000000'),
      http,
      modelPolicy: APPROVED_PILOT_POLICY,
      rateCards: { 'gpt-5.6-terra': RATE, 'gpt-5.6-luna': { ...RATE, model: 'gpt-5.6-luna' } },
      budget: { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 },
      ledger: [],
      threadBinding: BINDING,
      consumedDecisionIds: [],
      ...over,
    },
  };
}

describe('the ordinary closure turn', () => {
  it('asks once, checks the answer, and returns a record to WRITE — not authority', () => {
    const d = deps();
    const result = takeClosureTurn(input(), d.deps);

    expect(result.outcome).toBe('DECIDED_CLOSE');
    expect(result.problems).toEqual([]);
    expect(result.decision).not.toBeNull();
    // The record carries no consumption marker and nothing that could look like a grant.
    expect((result.decision as Record<string, unknown>)['consumedAt']).toBeUndefined();
    expect((result.decision as Record<string, unknown>)['allowedActions']).toBeUndefined();
    expect(result.ledgerEntry?.requestId).toBe(expectedRequest().requestId);
    expect(d.sent).toHaveLength(1);
  });

  it('sends the closure schema and the closure ask, never a technical review', () => {
    const d = deps();
    takeClosureTurn(input(), d.deps);
    const body = JSON.parse(d.sent[0] as string) as Record<string, unknown>;
    const format = ((body['text'] as Record<string, unknown>)['format']) as Record<string, unknown>;
    expect(format['name']).toBe('projectos_closure_decision');
    expect(String(body['instructions'])).toContain(`  ask: ${CLOSURE_ASK}`);
    expect(String(body['instructions'])).toContain(`  subject: ${SUBJECT}`);
    // The technical schema's fields must not be requested here.
    const schema = format['schema'] as { required: readonly string[] };
    expect(schema.required).not.toContain('allowedActions');
    expect(schema.required).toContain('evidenceSubjectHead');
  });

  it('re-derives the same request after a restart, so the same question is never bought twice', () => {
    const first = takeClosureTurn(input(), deps().deps);
    const second = takeClosureTurn(input(), deps().deps);
    expect(second.request?.requestId).toBe(first.request?.requestId);
  });
});

describe('nothing is sent when it must not be', () => {
  it('refuses before sending when the plan records no closure delegate', () => {
    const d = deps();
    const result = takeClosureTurn(input({ expectedDecider: '' }), d.deps);
    expect(result.outcome).toBe('NOT_SENT');
    expect(result.problems.join(' ')).toContain('records no closure delegate');
    expect(d.sent).toHaveLength(0);
  });

  it('refuses before sending when the thread binding belongs to another project', () => {
    const d = deps({ threadBinding: { ...BINDING, projectId: 'polygo' } });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.outcome).toBe('NOT_SENT');
    expect(result.problems.join(' ')).toContain('is for project "polygo"');
    expect(d.sent).toHaveLength(0);
  });

  it('refuses before sending when the spend limit is already reached', () => {
    const d = deps({ budget: { warnAtMicroUsd: 1, hardStopAtMicroUsd: 1 } });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.outcome).toBe('NOT_SENT');
    expect(result.problems.join(' ')).toContain('spend limit refused this closure call before it was made');
    expect(d.sent).toHaveLength(0);
  });

  it('releases the reservation and refuses when the installation does not authorise this project', () => {
    const released: string[] = [];
    const d = deps({
      broker: {
        transport: { post: () => ({ kind: 'transport-error', detail: 'never reached' }) },
        governedRoot: ROOT,
        installationAllows: () => ({ allowed: false, reasons: ['project not in the installation allowlist'] }),
      },
      releaseUndispatched: (id) => released.push(id),
    });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.outcome).toBe('UNAVAILABLE');
    expect(result.unavailabilityCause).toBe('TRANSPORT_NOT_APPROVED');
    expect(released).toEqual([expectedRequest().requestId]);
    expect(d.sent).toHaveLength(0);
  });

  it('refuses when no rate card prices the model, rather than making a call of unknown cost', () => {
    const d = deps({ rateCards: {} });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.outcome).toBe('NOT_SENT');
    expect(result.problems.join(' ')).toContain('a call whose price is unknown is not made');
    expect(d.sent).toHaveLength(0);
  });
});

describe('when the authority cannot answer', () => {
  it('turns a transport failure into the owner\'s three choices, not a permissive default', () => {
    const d = deps({}, { kind: 'transport-error', detail: 'connect ETIMEDOUT' });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.outcome).toBe('UNAVAILABLE');
    expect(result.decision).toBeNull();
    expect(result.ownerChoices).not.toBeNull();
  });

  it('distinguishes the provider\'s own spend limit from an outage', () => {
    const d = deps({}, { kind: 'response', status: 429, body: '{"error":{"code":"project_spend_limit_exceeded"}}' });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.unavailabilityCause).toBe('PROVIDER_SPEND_LIMITED');
  });

  it('refuses a reply that does not satisfy the declared schema rather than interpreting it', () => {
    const d = deps({}, { kind: 'response', status: 200, body: JSON.stringify({ output: [{ content: [{ type: 'refusal' }] }] }) });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.outcome).toBe('UNAVAILABLE');
    expect(result.problems.join(' ')).toContain('no structured decision');
  });

  it('closes out the reservation when a call produced no answer', () => {
    const resolved: string[] = [];
    const d = deps(
      { resolveSpend: (req, cause) => resolved.push(`${req.requestId}:${cause}`) },
      { kind: 'transport-error', detail: 'boom' },
    );
    takeClosureTurn(input(), d.deps);
    expect(resolved).toEqual([`${expectedRequest().requestId}:PROVIDER_UNAVAILABLE`]);
  });

  it('refuses when the credential cannot be resolved, and never falls back to a second transport', () => {
    const d = deps({ resolver: unprovisionedResolver('no credential here') });
    const result = takeClosureTurn(input(), d.deps);
    expect(result.outcome).toBe('UNAVAILABLE');
    expect(result.unavailabilityCause).toBe('CREDENTIAL_UNAVAILABLE');
    expect(d.sent).toHaveLength(0);
  });
});

describe('an answer that does not pass its checks writes nothing', () => {
  const cases: readonly [string, Record<string, unknown>, string][] = [
    ['a technical verdict', { decision: 'APPROVED_FOR_CLOSURE' }, 'is not one of: close'],
    ['another phase', { phaseId: 'SOME-OTHER-PHASE1A' }, 'is for phase'],
    ['another project', { projectId: 'polygo' }, 'is for project'],
    ['another subject', { evidenceSubjectHead: 'a'.repeat(40) }, 'an answer about other bytes is stale'],
    ['another question', { requestDigest: `sha256:${'1'.repeat(64)}` }, 'an answer to a different question'],
    ['another decider', { decidedBy: 'Someone Else' }, 'is not the plan\'s closure authority'],
    // PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A: the time the live agency closure answer carried, twenty months
    // before its question. An answer produced in this call cannot predate the question it answers.
    ['an invented decision time', { decidedAt: '2025-02-15T00:00:00Z' }, 'before this question was asked'],
  ];
  for (const [name, over, fragment] of cases) {
    it(`refuses ${name}`, () => {
      const result = takeClosureTurn(input(), deps({}, okReply(answer(over))).deps);
      expect(result.outcome).toBe('ANSWER_REFUSED');
      expect(result.decision).toBeNull();
      expect(result.problems.join(' | ')).toContain(fragment);
    });
  }

  it('refuses a replayed decision id', () => {
    const result = takeClosureTurn(input(), deps({ consumedDecisionIds: ['CLOSURE-TRANSPORT1A-DECISION1A'] }).deps);
    expect(result.outcome).toBe('ANSWER_REFUSED');
    expect(result.problems.join(' ')).toContain('cannot be replayed');
  });

  it('still records the cost, because the call happened whatever the answer turned out to be', () => {
    const result = takeClosureTurn(input(), deps({}, okReply(answer({ decision: 'APPROVED_FOR_CLOSURE' }))).deps);
    expect(result.ledgerEntry).not.toBeNull();
  });
});

describe('DO_NOT_CLOSE and AWAITING_OWNER close nothing', () => {
  for (const decision of ['do-not-close', 'awaiting-owner']) {
    it(`writes no decision for '${decision}'`, () => {
      const result = takeClosureTurn(input(), deps({}, okReply(answer({ decision }))).deps);
      expect(result.outcome).toBe('DECIDED_NOT_CLOSE');
      expect(result.decision).toBeNull();
      expect(result.answered).toBe(decision);
    });
  }
});

// PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A: a model cannot know the time, so the question carries it.
describe('the closure question tells the authority when it was asked', () => {
  it('the request actually sent names the time of the question and the form decidedAt must take', () => {
    const d = deps();
    takeClosureTurn(input(), d.deps);
    expect(d.sent).toHaveLength(1);
    const body = JSON.parse(d.sent[0] as string) as { instructions: string };
    expect(body.instructions).toContain(`at or just after ${input().at}, the time this question was asked`);
    expect(body.instructions).toContain('full ISO-8601 instant with a zone');
  });
});

describe('the request body binds what the trusted broker will check', () => {
  it('states each binding exactly once, at the position the broker reads', () => {
    const instructions = closureSystemInstruction(expectedRequest());
    for (const key of ['project', 'phase', 'subject', 'ask']) {
      const matches = instructions.split('\n').filter((l) => new RegExp(`^ {2}${key}:[ \\t]*\\S+[ \\t]*$`).test(l));
      expect(matches).toHaveLength(1);
    }
  });

  it('opens the user text with the request id, which is the only place the broker counts it', () => {
    const body = JSON.parse(
      buildClosureResponsesBody(expectedRequest(), EVIDENCE, { model: 'gpt-5.6-terra', credentialRef: REF }),
    ) as Record<string, unknown>;
    const input0 = (body['input'] as { content: { text: string }[] }[])[0];
    expect((input0 as { content: { text: string }[] }).content[0]?.text.split('\n')[0]).toBe(
      `requestId: ${expectedRequest().requestId}`,
    );
    // Asserted through the constant, so the wire and the ledger's reserve can never disagree; the
    // literal was raised from 800 after a live call returned incomplete with no verdict.
    expect(body['max_output_tokens']).toBe(GATEKEEPER_OUTPUT_TOKEN_LIMIT);
  });

  it('never puts a credential in the body', () => {
    const d = deps();
    takeClosureTurn(input(), d.deps);
    expect(d.sent[0]).not.toContain('sk-test');
  });
});
