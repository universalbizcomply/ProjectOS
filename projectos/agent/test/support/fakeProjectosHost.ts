/**
 * A TEST-ONLY ProjectOSHost, behind the real `HostIpcTransport` seam.
 *
 * WHY IT EXISTS. The real turn derives its own request id, so the correlation of a turn-level proof is
 * not one the recorded cross-language vectors cover. This simulator answers ANY well-formed request the
 * way the real Host does, so the REAL client, the REAL record verifier and the REAL decision and
 * attestation checks can be driven through the real hybrid turn.
 *
 * WHAT KEEPS IT HONEST. It is not the definition of anything: `host-review-path-vectors.v1.json` holds
 * the real Host's bytes, and `host-review-client.test.ts` proves this simulator emits the SAME frame
 * layout and the SAME record shape as those bytes. It contacts nothing, spends nothing and holds no
 * credential; its "provider" is a constant.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { createHash } from 'node:crypto';
import {
  HOST_HEADER_LEN,
  HOST_MESSAGE_KIND,
  HOST_VERDICT_FOR,
  HOST_VERDICT_FOR_CLOSURE,
  committedCandidateDigest,
  credentialRefIdentityDigest,
  hostBindingDigest,
  hostNonceForRunId,
  modelPolicyIdentityDigest,
  phaseIdentityDigest,
  planIdentityDigest,
  projectIdentityDigest,
  repositoryIdentityDigest,
  type ClosureResponseDecision,
  type GatekeeperVerdict,
} from '@projectos/core';
import type { HostIpcExchange, HostIpcTransport, SubjectWrite } from '../../src/loop/transports/hostIpcTransport.js';

export const FAKE_HOST_RUN_ID = Buffer.from('FAKEHOST', 'ascii');

export type FakeHostBehaviour =
  | 'approve'
  | 'absent'
  | 'not-accepting'
  | 'no-answer'
  | 'policy-refused'
  | 'credential-unavailable'
  | 'provider-unavailable'
  | 'malformed-response'
  | 'wrong-correlation'
  | 'missing-record'
  | 'tampered-record'
  | 'oversized-record'
  | 'trailing-data-record'
  | 'wrong-project'
  | 'wrong-phase'
  | 'wrong-subject'
  | 'wrong-request-digest'
  | 'invalid-attestation'
  | 'other-host-facts'
  /** PROJECTOS-HOST-REVIEW-PATH1B: the Host attests evidence the agent did not compute. */
  | 'other-evidence'
  /** ...or measured the candidate from a baseline other than the approved one. */
  | 'other-baseline'
  /** ...or answers with the revision that bound no evidence at all. */
  | 'attestation-revision-1'
  /** ...or states a provider cost beside the amount it admitted, which no Host can know. */
  | 'claims-provider-cost';

export interface FakeHostOptions {
  readonly behaviour?: FakeHostBehaviour;
  /** The service epoch this "instance" is running at. */
  readonly epoch?: bigint;
  /**
   * What the owner's delegation and the Host's own sources resolve to. The simulator hashes THESE - never
   * the agent's claim - into the binding digest it compares the request against, as the real Host does.
   */
  readonly facts: {
    readonly repository: string;
    readonly planRef: string;
    readonly planDigest: string;
    readonly delegationId: string;
    readonly modelPolicy: string;
    readonly credentialRef: string;
    /** The approved baseline the simulated Host "resolved" from its durable plan record. */
    readonly baselineCommit: string;
    /** The digest of the evidence the simulated Host "derived" and showed its reviewer. */
    readonly evidenceDigest: string;
  };
  readonly gatekeeperVerdict?: GatekeeperVerdict;
  readonly closureDecision?: ClosureResponseDecision;
  readonly allowedActions?: readonly string[];
  readonly decidedBy?: string;
  readonly subjectWrite?: SubjectWrite;
}

export interface FakeHost extends HostIpcTransport {
  readonly exchanges: number;
  readonly requestsServed: number;
  readonly providerCalls: number;
  readonly inbox: ReadonlyMap<string, Buffer>;
  readonly outbox: ReadonlyMap<string, Buffer>;
  readonly discarded: readonly string[];
  behave(next: FakeHostBehaviour): void;
}

const hex = (b: Buffer | null): string => (b === null ? '' : b.toString('hex'));

export function fakeProjectosHost(options: FakeHostOptions): FakeHost {
  let behaviour: FakeHostBehaviour = options.behaviour ?? 'approve';
  const epoch = options.epoch ?? 7n;
  const nonce = hostNonceForRunId(FAKE_HOST_RUN_ID);
  const inbox = new Map<string, Buffer>();
  const outbox = new Map<string, Buffer>();
  const consumed = new Set<string>();
  const discarded: string[] = [];
  let exchanges = 0;
  let requestsServed = 0;
  let providerCalls = 0;

  const frame = (kind: number, payload: Buffer): Buffer => {
    const out = Buffer.alloc(HOST_HEADER_LEN + payload.length);
    Buffer.from('POS1', 'ascii').copy(out, 0);
    out.writeUInt16BE(1, 4);
    out[6] = kind;
    nonce.copy(out, 7);
    out.writeUInt16BE(payload.length, 39);
    payload.copy(out, HOST_HEADER_LEN);
    return out;
  };
  const ready = (): Buffer => frame(HOST_MESSAGE_KIND.ServiceReady, Buffer.from([2]));
  const status = (accepting: boolean): Buffer =>
    frame(HOST_MESSAGE_KIND.InstalledHostStatus, Buffer.concat([Buffer.from([1, 1, 3, 1, accepting ? 2 : 1]), Buffer.from('0123abcd4567ef01', 'ascii')]));
  const response = (correlation: string, state: number, reason: number, result: number, evidenceRef: string): Buffer => {
    const p = Buffer.alloc(44);
    Buffer.from(correlation, 'hex').copy(p, 0);
    p[16] = state;
    p[17] = reason;
    p[18] = result;
    p.writeBigUInt64BE(epoch, 19);
    Buffer.from(evidenceRef, 'hex').copy(p, 27);
    p[43] = 1;
    return frame(HOST_MESSAGE_KIND.ProtectedOperationResponse, p);
  };
  const evidenceRefOf = (record: Buffer): string => createHash('sha256').update(record).digest('hex').slice(0, 32);
  const REJECTED = 1;
  const COMPLETED = 3;
  const NOT_RUN = 1;
  const SUCCEEDED = 2;
  const FAILED = 3;
  const BINDING_MISMATCH = 3;
  const EPOCH_MISMATCH = 5;
  const SEQUENCE_REFUSED = 6;
  const POLICY_REFUSED = 8;
  const NO_REASON = 8;

  const serve = (request: Buffer): Buffer | null => {
    requestsServed += 1;
    const p = request.subarray(HOST_HEADER_LEN);
    const correlation = p.subarray(0, 16).toString('hex');
    const claimedEpoch = p.readBigUInt64BE(24);
    const approvalRef = p.subarray(65, 97).toString('hex');
    const parameterDigest = p.subarray(97, 129).toString('hex');
    const refuse = (reason: number): Buffer => response(correlation, REJECTED, reason, NOT_RUN, '00'.repeat(16));

    // The Host's own order: the epoch BEFORE anything is consumed.
    if (claimedEpoch !== epoch) return refuse(EPOCH_MISMATCH);
    if (behaviour === 'policy-refused') return refuse(POLICY_REFUSED);
    if (consumed.has(correlation)) return refuse(SEQUENCE_REFUSED);
    consumed.add(correlation);
    const subject = inbox.get(correlation);
    if (subject === undefined || createHash('sha256').update(subject).digest('hex') !== parameterDigest) return refuse(BINDING_MISMATCH);
    if (approvalRef !== options.facts.delegationId) return refuse(BINDING_MISMATCH);

    const s = JSON.parse(subject.toString('utf8')) as { ask: 'gatekeeper' | 'closure'; correlation: string; declared: Record<string, string> };
    // THE HOST'S OWN BINDING DIGEST, from the Host's own facts. The project, phase and candidate are the
    // ones this simulated Host "resolved" (the real Host's resolution of them is proven in Rust); the
    // other five come from `facts`, so an agent configured with a wrong one is refused here.
    const f = options.facts;
    const expected = hostBindingDigest({
      project: hex(projectIdentityDigest(s.declared['projectId']!)),
      repository: hex(repositoryIdentityDigest(f.repository)),
      plan: hex(planIdentityDigest(f.planRef)),
      planDigest: f.planDigest,
      phase: hex(phaseIdentityDigest(s.declared['phaseId']!)),
      candidateDigest: hex(committedCandidateDigest(s.declared['subjectCommit']!)),
      modelPolicy: hex(modelPolicyIdentityDigest(f.modelPolicy)),
      credentialRef: hex(credentialRefIdentityDigest(f.credentialRef)),
    });
    if (expected === null || p.subarray(32, 64).toString('hex') !== expected) return refuse(BINDING_MISMATCH);
    if (behaviour === 'no-answer') return null;

    const declared = { ...s.declared };
    if (behaviour === 'wrong-project') declared['projectId'] = 'some-other-project';
    if (behaviour === 'wrong-phase') declared['phaseId'] = 'SOME-OTHER-PHASE';
    if (behaviour === 'wrong-subject') {
      declared['subjectCommit'] = '7e15629506400000000000000000000000000000';
      if (declared['evidenceSubjectHead'] !== undefined) declared['evidenceSubjectHead'] = declared['subjectCommit'];
    }
    if (behaviour === 'wrong-request-digest') declared['requestDigest'] = `sha256:${'cd'.repeat(32)}`;

    const failed = (dispatched: boolean): Buffer => {
      const record = Buffer.from(JSON.stringify({ schemaVersion: 1, correlation, ask: s.ask, outcome: 'failed', providerDispatched: dispatched, declared }), 'utf8');
      outbox.set(correlation, record);
      return response(correlation, COMPLETED, NO_REASON, FAILED, evidenceRefOf(record));
    };
    if (behaviour === 'credential-unavailable') return failed(false);
    providerCalls += 1;
    if (behaviour === 'provider-unavailable') return failed(true);

    const closure = s.ask === 'closure';
    const verdict = closure ? (options.closureDecision ?? 'close') : (options.gatekeeperVerdict ?? 'APPROVED_TO_PROCEED');
    const hostVerdict = closure ? HOST_VERDICT_FOR_CLOSURE[verdict as ClosureResponseDecision] : HOST_VERDICT_FOR[verdict as GatekeeperVerdict];
    const allowedActions = closure ? [] : [...(options.allowedActions ?? ['commit', 'push'])];
    const ownerApprovalRequired = closure;
    const other = behaviour === 'other-host-facts';
    const record = {
      schemaVersion: 1,
      correlation,
      ask: s.ask,
      outcome: 'attested',
      providerDispatched: true,
      declared,
      decision: {
        decisionId: `HOSTDEC-${correlation}`,
        verdict,
        reason: 'independently reviewed by the simulated provider',
        nextInstruction: 'carry out the approved technical continuation',
        allowedActions,
        forbiddenActions: ['production-deploy'],
        ownerApprovalRequired,
        decidedBy: options.decidedBy ?? 'ChatGPT',
        // One minute after the question its worlds ask: a closure answer's decidedAt must fall in the
        // window of its question (PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A).
        decidedAt: '2026-09-10T20:01:00Z',
      },
      attestation: {
        schemaVersion: behaviour === 'attestation-revision-1' ? 1 : 2,
        attestationId: createHash('sha256').update(`attestation:${correlation}`).digest('hex'),
        requestCorrelation: behaviour === 'invalid-attestation' ? 'ee'.repeat(16) : correlation,
        project: hex(projectIdentityDigest(other ? 'another-project' : s.declared['projectId']!)),
        repository: hex(repositoryIdentityDigest(s.declared['repository']!)),
        plan: hex(planIdentityDigest(s.declared['planRef']!)),
        planDigest: options.facts.planDigest,
        phase: hex(phaseIdentityDigest(s.declared['phaseId']!)),
        candidateDigest: hex(committedCandidateDigest(s.declared['subjectCommit']!)),
        // Revision 2, in the real Host's field order. Revision 1 carried neither.
        ...(behaviour === 'attestation-revision-1'
          ? {}
          : {
              baselineCommit: behaviour === 'other-baseline' ? 'c'.repeat(40) : options.facts.baselineCommit,
              evidenceDigest: behaviour === 'other-evidence' ? 'ee'.repeat(32) : options.facts.evidenceDigest,
            }),
        delegationId: options.facts.delegationId,
        providerResponseId: `resp_fake_${correlation.slice(0, 8)}`,
        provider: 'fake-independent-provider',
        model: 'fake-model',
        tier: s.ask,
        verdict: hostVerdict,
        allowedActions,
        ownerApprovalRequired,
        // Revision 2 states the amount the Host ADMITTED, never a provider cost. Revision 1 keeps its
        // historical field, which is exactly why an unattended review refuses it.
        ...(behaviour === 'attestation-revision-1'
          ? { costMicroUsd: 2500 }
          : behaviour === 'claims-provider-cost'
            ? { admittedCostMicroUsd: 2500, costMicroUsd: 2500 }
            : { admittedCostMicroUsd: 2500 }),
        attestedAtEpochS: 1_788_000_000,
      },
      usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 },
    };
    let bytes = Buffer.from(JSON.stringify(record), 'utf8');
    const evidenceRef = evidenceRefOf(bytes);
    if (behaviour === 'tampered-record') bytes = Buffer.from(bytes.toString('utf8').replace('independently reviewed', 'INDEPENDENTLY REVIEWED'), 'utf8');
    if (behaviour === 'oversized-record') bytes = Buffer.concat([bytes, Buffer.alloc(64 * 1024, 0x20)]);
    if (behaviour === 'trailing-data-record') bytes = Buffer.concat([bytes, Buffer.from('{"approved":true}', 'utf8')]);
    if (behaviour !== 'missing-record') outbox.set(correlation, bytes);
    const answered = behaviour === 'wrong-correlation' ? 'ee'.repeat(16) : correlation;
    // A record altered AFTER the Host bound it keeps the ORIGINAL evidence reference on the wire.
    const bound = behaviour === 'oversized-record' || behaviour === 'trailing-data-record' ? evidenceRefOf(bytes) : evidenceRef;
    return response(answered, COMPLETED, NO_REASON, SUCCEEDED, bound);
  };

  return {
    runId: FAKE_HOST_RUN_ID,
    get exchanges() {
      return exchanges;
    },
    get requestsServed() {
      return requestsServed;
    },
    get providerCalls() {
      return providerCalls;
    },
    inbox,
    outbox,
    discarded,
    behave(next): void {
      behaviour = next;
    },
    writeSubject(correlation, bytes): SubjectWrite {
      if (options.subjectWrite === 'failed') return 'failed';
      const existing = inbox.get(correlation);
      if (existing !== undefined && !existing.equals(bytes)) return 'failed';
      inbox.set(correlation, Buffer.from(bytes));
      return 'written';
    },
    discardSubject(correlation): void {
      discarded.push(correlation);
      inbox.delete(correlation);
    },
    exchange(frames): HostIpcExchange {
      exchanges += 1;
      if (behaviour === 'absent') return { kind: 'not-sent', stage: 'connect', detail: 'the Host endpoint could not be reached: ENOENT', readyFrame: null, statusFrame: null };
      if (!frames.expectedReady.equals(ready())) return { kind: 'not-sent', stage: 'handshake', detail: 'the Host did not answer with the expected ServiceReady', readyFrame: ready(), statusFrame: null };
      if (behaviour === 'not-accepting') {
        return { kind: 'not-sent', stage: 'withheld', detail: 'the Host reports it is not accepting protected operations; the request was withheld', readyFrame: ready(), statusFrame: status(false) };
      }
      let answer = serve(frames.request);
      if (behaviour === 'malformed-response' && answer !== null) answer = Buffer.concat([answer, Buffer.from([0])]);
      return { kind: 'sent', readyFrame: ready(), statusFrame: status(true), responseFrame: answer, detail: answer === null ? 'the Host closed the connection without answering' : 'answered' };
    },
    readResponseRecord(correlation): Buffer | null {
      const bytes = outbox.get(correlation);
      return bytes === undefined || bytes.length === 0 || bytes.length > 64 * 1024 ? null : bytes;
    },
  };
}
