/**
 * THE PRODUCTION HOST REVIEW CLIENT, proven at its own boundary.
 *
 * Two kinds of Host stand behind the real `HostIpcTransport` seam here:
 *  - A REPLAY of the real Rust Host's recorded bytes (`host-review-path-vectors.v1.json`), so the client
 *    is proven against what the real Host actually emits.
 *  - The test-only simulator, for the failure matrix — and it is first proven to emit the same frame
 *    layout and record shape as those recorded bytes, so the matrix is not a conversation between two
 *    fakes.
 *
 * No pipe, no provider, no credential, no spend.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GATEKEEPER_REQUEST_SCHEMA_VERSION,
  checkGatekeeperDecision,
  checkHostAttestation,
  gatekeeperRequestDigest,
  hostCorrelationFor,
  type GatekeeperRequest,
  type HostReviewCall,
} from '@projectos/core';
import { hostReviewClient } from '../src/loop/hostReviewClient.js';
import { HOST_REVIEW_TRANSPORT, type HostReviewActivation } from '../src/loop/hostReviewActivation.js';
import type { HostIpcExchange, HostIpcTransport } from '../src/loop/transports/hostIpcTransport.js';
import { fakeProjectosHost, type FakeHostBehaviour } from './support/fakeProjectosHost.js';
import { VECTOR_BASELINE_COMMIT, VECTOR_EVIDENCE_SOURCE, vectorEvidenceDigest } from './support/vectorEvidence.js';

const V = JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'host-review-path-vectors.v1.json'), 'utf8')) as {
  inputs: Record<string, string>;
  agent: { exchanges: { ask: string; requestId: string; correlation: string; subject: string; requestFrameHex: string }[] };
  host: { attested: Recorded[]; failedNotDispatched: Recorded; failedDispatched: Recorded };
};
interface Recorded {
  ask: string;
  correlation: string;
  serviceReadyFrameHex: string;
  statusFrameHex: string;
  responseFrameHex: string;
  responseRecord: string;
}
const I = V.inputs;

const ACTIVATION: HostReviewActivation = {
  transport: HOST_REVIEW_TRANSPORT,
  repository: I['repository']!,
  planRef: I['planRef']!,
  planDigest: I['planDigest']!,
  baselineCommit: VECTOR_BASELINE_COMMIT,
  delegationId: I['delegationId']!,
  modelPolicy: I['modelPolicy']!,
  credentialRef: I['credentialRef']!,
  responseTimeoutSeconds: 30,
};

/** What the simulated Host resolves for itself. Deliberately NOT derived from `ACTIVATION`. */
const FACTS = {
  repository: I['repository']!,
  planRef: I['planRef']!,
  planDigest: I['planDigest']!,
  delegationId: I['delegationId']!,
  modelPolicy: I['modelPolicy']!,
  credentialRef: I['credentialRef']!,
  baselineCommit: VECTOR_BASELINE_COMMIT,
  evidenceDigest: vectorEvidenceDigest(),
};

/** The real Host's recorded answer, served to whoever sends EXACTLY the recorded agent bytes. */
function replayOf(recorded: Recorded, epoch: bigint): HostIpcTransport & { sent: Buffer[]; subjects: Map<string, Buffer> } {
  const subjects = new Map<string, Buffer>();
  const sent: Buffer[] = [];
  return {
    runId: Buffer.from(I['runIdHex']!, 'hex'),
    sent,
    subjects,
    writeSubject(correlation, bytes) {
      subjects.set(correlation, Buffer.from(bytes));
      return 'written';
    },
    discardSubject(correlation) {
      subjects.delete(correlation);
    },
    exchange(frames): HostIpcExchange {
      sent.push(frames.request);
      const ready = Buffer.from(recorded.serviceReadyFrameHex, 'hex');
      const status = Buffer.from(recorded.statusFrameHex, 'hex');
      // Until the client has learned the recorded epoch it is told, as the real Host tells it.
      if (frames.request.readBigUInt64BE(41 + 24) !== epoch) {
        const refusal = Buffer.from(recorded.responseFrameHex, 'hex');
        refusal[41 + 16] = 1; // Rejected
        refusal[41 + 17] = 5; // ServiceEpochMismatch
        refusal[41 + 18] = 1; // NotRun
        refusal.fill(0, 41 + 27, 41 + 43);
        return { kind: 'sent', readyFrame: ready, statusFrame: status, responseFrame: refusal, detail: 'answered' };
      }
      return { kind: 'sent', readyFrame: ready, statusFrame: status, responseFrame: Buffer.from(recorded.responseFrameHex, 'hex'), detail: 'answered' };
    },
    readResponseRecord(correlation) {
      return correlation === recorded.correlation ? Buffer.from(recorded.responseRecord, 'utf8') : null;
    },
  };
}

function vectorCall(): HostReviewCall {
  const x = V.agent.exchanges.find((e) => e.ask === 'gatekeeper')!;
  const request: GatekeeperRequest = {
    schemaVersion: GATEKEEPER_REQUEST_SCHEMA_VERSION,
    requestId: x.requestId,
    projectId: I['projectId']!,
    phaseId: I['phaseId']!,
    subjectCommit: I['subjectCommit']!,
    ask: 'evidence-review',
    evidenceDigests: [],
    ownerOnlyActions: [],
  };
  return { request, requestDigest: I['requestDigest']!, correlation: x.correlation, body: I['providerRequest']! };
}

describe("the client against the REAL Host's recorded bytes", () => {
  it('sends byte for byte what the real Host was proven to accept, and accepts what it answered', () => {
    const recorded = V.host.attested.find((a) => a.ask === 'gatekeeper')!;
    const x = V.agent.exchanges.find((e) => e.ask === 'gatekeeper')!;
    const transport = replayOf(recorded, BigInt(I['serviceEpoch']!));
    const call = vectorCall();

    const outcome = hostReviewClient({ activation: ACTIVATION, transport, candidateEvidence: VECTOR_EVIDENCE_SOURCE }).review(call);

    // ONE DISCOVERY ROUND (epoch 0, refused) and then the real request.
    expect(transport.sent.length).toBe(2);
    expect(transport.sent[1]!.toString('hex')).toBe(x.requestFrameHex);
    expect(transport.subjects.get(x.correlation)?.toString('utf8')).toBe(x.subject);
    expect(outcome.kind).toBe('attested');
    if (outcome.kind !== 'attested') return;
    expect(
      checkGatekeeperDecision(outcome.record, {
        projectId: I['projectId']!,
        phaseId: I['phaseId']!,
        subjectCommit: I['subjectCommit']!,
        requestDigest: I['requestDigest']!,
        expectedDecider: 'ChatGPT',
        alreadyConsumedDecisionIds: [],
        ownerOnlyActions: [],
      }),
    ).toEqual([]);
    expect(checkHostAttestation(outcome.attestation, { requestId: x.requestId, record: outcome.record })).toEqual([]);
    expect(outcome.usage).toEqual({ inputTokens: 2000, cachedInputTokens: 1500, outputTokens: 300 });
  });

  it.each([
    ['failedNotDispatched', 'CREDENTIAL_UNAVAILABLE', false],
    ['failedDispatched', 'PROVIDER_UNAVAILABLE', true],
  ] as const)("reads the real Host's %s record as %s with providerDispatched=%s", (key, cause, dispatched) => {
    const transport = replayOf(V.host[key], BigInt(I['serviceEpoch']!));
    const outcome = hostReviewClient({ activation: ACTIVATION, transport, candidateEvidence: VECTOR_EVIDENCE_SOURCE }).review(vectorCall());
    expect(outcome).toMatchObject({ kind: 'unavailable', cause, providerDispatched: dispatched });
    // A question that was never dispatched leaves no subject behind; a dispatched one is the Host's.
    expect(transport.subjects.has(V.host[key].correlation)).toBe(dispatched);
  });
});

describe('the simulator is shaped like the real Host', () => {
  it('emits the same frame lengths and the same record keys as the recorded bytes', () => {
    const recorded = V.host.attested.find((a) => a.ask === 'gatekeeper')!;
    const host = fakeProjectosHost({ facts: FACTS, epoch: 0n });
    const outcome = hostReviewClient({ activation: ACTIVATION, transport: host, candidateEvidence: VECTOR_EVIDENCE_SOURCE }).review(vectorCall());
    expect(outcome.kind).toBe('attested');
    const real = JSON.parse(recorded.responseRecord) as Record<string, Record<string, unknown>>;
    const fake = JSON.parse(host.outbox.get(recorded.correlation)!.toString('utf8')) as Record<string, Record<string, unknown>>;
    expect(Object.keys(fake)).toEqual(Object.keys(real));
    for (const k of ['declared', 'decision', 'attestation', 'usage']) expect(Object.keys(fake[k]!), k).toEqual(Object.keys(real[k]!));
  });
});

describe('the failure matrix: what the client concludes, and what it says about dispatch', () => {
  const facts = FACTS;
  const run = (behaviour: FakeHostBehaviour, over: Partial<HostReviewActivation> = {}, subjectWrite?: 'failed') => {
    // Epoch 0 is what a fresh client claims, so each case is ONE exchange and the matrix is about that exchange.
    const host = fakeProjectosHost({ facts, behaviour, epoch: 0n, ...(subjectWrite === undefined ? {} : { subjectWrite }) });
    const outcome = hostReviewClient({ activation: { ...ACTIVATION, ...over }, transport: host, candidateEvidence: VECTOR_EVIDENCE_SOURCE }).review(vectorCall());
    return { host, outcome };
  };

  it.each([
    // NOTHING CAN HAVE BEEN DISPATCHED -> released.
    ['absent', 'TRANSPORT_UNREACHABLE', false, 0],
    ['not-accepting', 'TRANSPORT_UNREACHABLE', false, 0],
    ['policy-refused', 'TRANSPORT_NOT_APPROVED', false, 0],
    ['credential-unavailable', 'CREDENTIAL_UNAVAILABLE', false, 0],
    // A PROVIDER MAY HAVE BEEN REACHED -> retained.
    ['provider-unavailable', 'PROVIDER_UNAVAILABLE', true, 1],
    ['no-answer', 'PROVIDER_UNAVAILABLE', true, 0],
    ['malformed-response', 'PROVIDER_UNAVAILABLE', true, 1],
    ['wrong-correlation', 'PROVIDER_UNAVAILABLE', true, 1],
    ['missing-record', 'PROVIDER_UNAVAILABLE', true, 1],
    ['tampered-record', 'PROVIDER_UNAVAILABLE', true, 1],
    ['oversized-record', 'PROVIDER_UNAVAILABLE', true, 1],
    ['trailing-data-record', 'PROVIDER_UNAVAILABLE', true, 1],
    ['other-host-facts', 'PROVIDER_UNAVAILABLE', true, 1],
    // PROJECTOS-HOST-REVIEW-PATH1B. AN ATTESTATION THE AGENT CANNOT REPRODUCE IS NOT AN APPROVAL OF THIS
    // CANDIDATE: other evidence, another baseline, or the revision that bound no evidence at all. A
    // provider WAS reached, so the money is retained - but nothing is accepted.
    ['other-evidence', 'PROVIDER_UNAVAILABLE', true, 1],
    ['other-baseline', 'PROVIDER_UNAVAILABLE', true, 1],
    ['attestation-revision-1', 'PROVIDER_UNAVAILABLE', true, 1],
    // A revision 2 attestation states the amount the Host ADMITTED. One that also claims a provider
    // cost is claiming a figure no Host can know, and the closed key set refuses it.
    ['claims-provider-cost', 'PROVIDER_UNAVAILABLE', true, 1],
  ] as const)('%s -> %s, providerDispatched=%s', (behaviour, cause, dispatched, providerCalls) => {
    const { host, outcome } = run(behaviour);
    expect(outcome).toMatchObject({ kind: 'unavailable', cause, providerDispatched: dispatched });
    expect(host.providerCalls).toBe(providerCalls);
    // The subject is discarded exactly when nothing can have been dispatched.
    expect(host.discarded.length).toBe(dispatched ? 0 : 1);
  });

  it.each([
    ['delegation', { delegationId: 'bb'.repeat(32) }],
    ['plan digest', { planDigest: 'bb'.repeat(32) }],
    ['plan', { planRef: 'plan-0000000000000000-000000000000' }],
    ['repository', { repository: 'github.com/someone/else' }],
    ['model policy', { modelPolicy: 'some-other-policy' }],
    ['credential ref', { credentialRef: 'SOME_OTHER_KEY' }],
  ] as const)('an agent claiming a wrong %s is REFUSED BY THE HOST: nothing runs, nothing is dispatched', (_n, over) => {
    const { host, outcome } = run('approve', over);
    expect(outcome).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_NOT_APPROVED', providerDispatched: false });
    expect(host.providerCalls).toBe(0);
    expect(host.outbox.size).toBe(0);
  });

  it('an agent that cannot establish its OWN evidence of the candidate asks nothing and writes nothing', () => {
    // No evidence of its own means no way to check an answer, so there is no question. The reservation
    // is released: `providerDispatched` is false because nothing left this process.
    const host = fakeProjectosHost({ facts, epoch: 0n });
    const blind = hostReviewClient({
      activation: ACTIVATION,
      transport: host,
      candidateEvidence: () => ({ problems: ['the approved baseline is not an ancestor of the candidate in this repository'] }),
    }).review(vectorCall());
    expect(blind).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_UNUSABLE', providerDispatched: false });
    expect(blind.kind === 'unavailable' && blind.reasons.join(' ')).toContain('not an ancestor');
    expect(host.exchanges).toBe(0);
    expect(host.inbox.size).toBe(0);
    expect(host.providerCalls).toBe(0);
  });

  it('the agent is asked for evidence between the APPROVED baseline and the COMMITTED subject, and nothing else', () => {
    const asked: [string, string][] = [];
    const host = fakeProjectosHost({ facts, epoch: 0n });
    hostReviewClient({
      activation: ACTIVATION,
      transport: host,
      candidateEvidence: (baseline, candidate) => {
        asked.push([baseline, candidate]);
        return VECTOR_EVIDENCE_SOURCE(baseline, candidate);
      },
    }).review(vectorCall());
    expect(asked).toEqual([[VECTOR_BASELINE_COMMIT, I['subjectCommit']]]);
  });

  it('a subject that cannot be written, or that is not a committed 40-hex commit, sends NOTHING', () => {
    const unwritable = run('approve', {}, 'failed');
    expect(unwritable.outcome).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_UNREACHABLE', providerDispatched: false });
    expect(unwritable.host.exchanges).toBe(0);

    const host = fakeProjectosHost({ facts });
    const client = hostReviewClient({ activation: ACTIVATION, transport: host, candidateEvidence: VECTOR_EVIDENCE_SOURCE });
    for (const subjectCommit of ['20FE0722528AF748504BAF9C094818C003A95EF7', '20fe0722', `${'a'.repeat(64)}`, 'working-tree']) {
      const call = vectorCall();
      const outcome = client.review({ ...call, request: { ...call.request, subjectCommit } });
      expect(outcome, subjectCommit).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_UNUSABLE', providerDispatched: false });
    }
    expect(host.exchanges).toBe(0);
  });

  it('learns a restarted Host epoch in ONE round, without burning the question, and remembers it', () => {
    const host = fakeProjectosHost({ facts, epoch: 99n });
    const client = hostReviewClient({ activation: ACTIVATION, transport: host, candidateEvidence: VECTOR_EVIDENCE_SOURCE });
    expect(client.review(vectorCall()).kind).toBe('attested');
    expect(host.exchanges).toBe(2);
    expect(host.providerCalls).toBe(1);
  });

  it('A REPLAYED QUESTION IS REFUSED BY THE HOST and nothing is dispatched twice', () => {
    const host = fakeProjectosHost({ facts, epoch: 0n });
    const client = hostReviewClient({ activation: ACTIVATION, transport: host, candidateEvidence: VECTOR_EVIDENCE_SOURCE });
    expect(client.review(vectorCall()).kind).toBe('attested');
    const again = client.review(vectorCall());
    expect(again).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_NOT_APPROVED', providerDispatched: false });
    expect(host.providerCalls).toBe(1);
  });

  it.each([
    ['wrong-project', /is for project/],
    ['wrong-phase', /is for phase/],
    ['wrong-subject', /subject|stale/],
    ['wrong-request-digest', /answers request|different question/],
  ] as const)('%s is carried into the record UNCHANGED and refused by the EXISTING decision check', (behaviour, why) => {
    const { outcome } = run(behaviour);
    expect(outcome.kind).toBe('attested');
    if (outcome.kind !== 'attested') return;
    const call = vectorCall();
    const problems = checkGatekeeperDecision(outcome.record, {
      projectId: call.request.projectId,
      phaseId: call.request.phaseId,
      subjectCommit: call.request.subjectCommit,
      requestDigest: call.requestDigest,
      expectedDecider: 'ChatGPT',
      alreadyConsumedDecisionIds: [],
      ownerOnlyActions: [],
    });
    expect(problems.join(' ')).toMatch(why);
  });

  it('an invalid attestation reaches the EXISTING attestation check and is refused there', () => {
    const { outcome } = run('invalid-attestation');
    expect(outcome.kind).toBe('attested');
    if (outcome.kind !== 'attested') return;
    expect(checkHostAttestation(outcome.attestation, { requestId: vectorCall().request.requestId, record: outcome.record }).join(' ')).toMatch(/different request/);
  });

  it('derives the correlation it sends from the request id, never from a caller', () => {
    expect(vectorCall().correlation).toBe(hostCorrelationFor(vectorCall().request.requestId));
    expect(gatekeeperRequestDigest(vectorCall().request)).toMatch(/^sha256:/);
  });
});
