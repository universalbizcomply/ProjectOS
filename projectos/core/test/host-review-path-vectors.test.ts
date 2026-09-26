/**
 * THE CROSS-LANGUAGE PROOF, AGENT SIDE.
 *
 * `projectos/contracts/host-review-path-vectors.v1.json` holds real bytes from BOTH languages. Its
 * `agent` half was produced by this implementation and was SERVED by the real Rust Host
 * (`review_vectors_tests.rs` feeds those exact bytes through the real decoder, composition, execution
 * rung, responder and review operation). Its `host` half is what that real Rust run emitted.
 *
 * So this file proves two things and hand-authors neither: that this implementation STILL produces the
 * agent half byte for byte, and that the real Host's frames and response records are accepted by the
 * real agent decoder, the real record verifier and the EXISTING decision and attestation checks.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkClosureResponse, checkHostClosureAttestation } from '../src/closureTransport.js';
import { checkGatekeeperDecision } from '../src/gatekeeperDecision.js';
import { candidateEvidenceDigest, type EvidenceChange } from '../src/candidateEvidence.js';
import { checkHostAttestation, hostCorrelationFor } from '../src/gatekeeperMode.js';
import {
  committedCandidateDigest,
  credentialRefIdentityDigest,
  modelPolicyIdentityDigest,
  phaseIdentityDigest,
  planIdentityDigest,
  projectIdentityDigest,
  repositoryIdentityDigest,
} from '../src/hostIdentityDigests.js';
import {
  buildHostReviewSubject,
  closureRecordFromHost,
  gatekeeperRecordFromHost,
  hostEvidenceRefOf,
  hostExchangeFileName,
  readHostResponseRecord,
  type HostResponseExpectations,
  type HostReviewAsk,
} from '../src/hostReviewEnvelope.js';
import {
  decodeInstalledHostStatus,
  decodeProtectedOperationResponse,
  encodeControllerHello,
  encodeProtectedOperationRequest,
  hostBindingDigest,
  hostNonceForRunId,
  serviceReadyRefusal,
  type HostBindingSubject,
} from '../src/hostReviewWire.js';

const V = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'host-review-path-vectors.v1.json'), 'utf8'),
) as {
  contract: string;
  inputs: Record<string, string>;
  agent: {
    nonceHex: string;
    controllerHelloFrameHex: string;
    claim: HostBindingSubject;
    bindingDigest: string;
    exchanges: { ask: HostReviewAsk; requestId: string; correlation: string; subject: string; parameterDigest: string; requestFrameHex: string }[];
  };
  host: {
    attested: HostExchange[];
    failedNotDispatched: HostExchange;
    failedDispatched: HostExchange;
  };
};

interface HostExchange {
  ask: HostReviewAsk;
  correlation: string;
  serviceReadyFrameHex: string;
  statusFrameHex: string;
  responseFrameHex: string;
  responseState: string;
  responseResult: string;
  evidenceRef: string;
  responseRecordFileName: string;
  responseRecord: string;
}

const I = V.inputs;
const nonce = hostNonceForRunId(Buffer.from(I['runIdHex']!, 'hex'));
const hex = (b: Buffer | null): string => (b === null ? '' : b.toString('hex'));

function claim(): HostBindingSubject {
  return {
    project: hex(projectIdentityDigest(I['projectId']!)),
    repository: hex(repositoryIdentityDigest(I['repository']!)),
    plan: hex(planIdentityDigest(I['planRef']!)),
    planDigest: I['planDigest']!,
    phase: hex(phaseIdentityDigest(I['phaseId']!)),
    candidateDigest: hex(committedCandidateDigest(I['subjectCommit']!)),
    modelPolicy: hex(modelPolicyIdentityDigest(I['modelPolicy']!)),
    credentialRef: hex(credentialRefIdentityDigest(I['credentialRef']!)),
  };
}

/** `inputs.evidence`: the changed paths BOTH languages hash (PROJECTOS-HOST-REVIEW-PATH1B). */
interface VectorEvidenceEntry {
  change: EvidenceChange;
  path: string;
  oldMode: string;
  newMode: string;
  oldId: string;
  newId: string;
  contentsUtf8?: string;
}
const VECTOR_EVIDENCE = (V.inputs as unknown as { evidence: VectorEvidenceEntry[] }).evidence;

/** `inputs.ancestry` (F2): the ordered chain both languages bind. */
interface VectorAncestryStep {
  commit: string;
  parent: string;
  entries?: (VectorEvidenceEntry & { vanishedContentsUtf8?: string })[];
}
const VECTOR_ANCESTRY = (V.inputs as unknown as { ancestry: VectorAncestryStep[] }).ancestry;
const vectorAncestry = () =>
  VECTOR_ANCESTRY.map((s) => ({
    commit: s.commit,
    parent: s.parent,
    entries: (s.entries ?? []).map((e) => ({
      change: e.change,
      path: e.path,
      oldMode: parseInt(e.oldMode, 8),
      newMode: parseInt(e.newMode, 8),
      oldId: e.oldId,
      newId: e.newId,
      vanishedContents: e.vanishedContentsUtf8 === undefined ? null : Buffer.from(e.vanishedContentsUtf8, 'utf8'),
    })),
  }));

/** THE AGENT'S OWN RECOMPUTATION, by this implementation, from the vector's two commits and entries. */
function agentEvidence(): { baselineCommit: string; evidenceDigest: string } {
  const computed = candidateEvidenceDigest({
    baselineCommit: I['baselineCommit']!,
    candidateCommit: I['subjectCommit']!,
    entries: VECTOR_EVIDENCE.map((e) => ({
      change: e.change,
      path: e.path,
      oldMode: parseInt(e.oldMode, 8),
      newMode: parseInt(e.newMode, 8),
      oldId: e.oldId,
      newId: e.newId,
      contents: e.contentsUtf8 === undefined ? null : Buffer.from(e.contentsUtf8, 'utf8'),
    })),
    ancestry: vectorAncestry(),
  });
  if (computed.digest === null) throw new Error(`the vector evidence is not evidence: ${computed.problems.join('; ')}`);
  return { baselineCommit: I['baselineCommit']!, evidenceDigest: computed.digest };
}

function expectations(x: HostExchange, over: Partial<HostResponseExpectations> = {}): HostResponseExpectations {
  return {
    correlation: x.correlation,
    ask: x.ask,
    evidenceRef: x.evidenceRef,
    wireResult: x.responseResult as 'Succeeded' | 'Failed',
    claim: claim(),
    delegationId: I['delegationId']!,
    evidence: agentEvidence(),
    ...over,
  };
}

describe('the candidate evidence both languages recompute (PROJECTOS-HOST-REVIEW-PATH1B)', () => {
  it('this implementation reproduces the digest the REAL Host attested', () => {
    // Not a comparison with a constant this file chose: the right-hand side is read out of the record
    // the real Rust Host produced, for every attested exchange.
    for (const x of V.host.attested) {
      const attestation = (JSON.parse(x.responseRecord) as { attestation: { evidenceDigest: string; baselineCommit: string; schemaVersion: number } }).attestation;
      expect(attestation.schemaVersion).toBe(2);
      expect(attestation.baselineCommit).toBe(I['baselineCommit']);
      expect(agentEvidence().evidenceDigest).toBe(attestation.evidenceDigest);
    }
  });

  it('matches the independently pinned encoding vector', () => {
    const Z = '0'.repeat(40);
    const X = 'a'.repeat(40);
    const pinned = candidateEvidenceDigest({
      baselineCommit: '1'.repeat(40),
      candidateCommit: '2'.repeat(40),
      // Deliberately NOT in path order: the digest must not depend on the order git reported.
      entries: [
        { change: 'added', path: 'src/new.rs', oldMode: 0, newMode: 0o100644, oldId: Z, newId: X, contents: Buffer.from('fn main() {}\n') },
        { change: 'deleted', path: 'old.txt', oldMode: 0o100644, newMode: 0, oldId: X, newId: Z, contents: null },
        { change: 'modified', path: 'run.sh', oldMode: 0o100644, newMode: 0o100755, oldId: X, newId: X, contents: Buffer.from('#!/bin/sh\n') },
      ],
      // F2: the one-commit ancestry linking the two pinned endpoints.
      ancestry: [{ commit: '2'.repeat(40), parent: '1'.repeat(40), entries: [] }],
    });
    expect(pinned.problems).toEqual([]);
    // Pinned independently: the Rust unit pin and a Python replication both give this digest.
    expect(pinned.digest).toBe('9b928df73f9461668591886dbf910157e0281f58ed5fd05564f325f36119a0f7');
  });

  it('refuses what the Host refuses, rather than hashing it', () => {
    const base = {
      baselineCommit: '1'.repeat(40),
      candidateCommit: '2'.repeat(40),
      ancestry: [{ commit: '2'.repeat(40), parent: '1'.repeat(40), entries: [] }],
    };
    const Z = '0'.repeat(40);
    const X = 'a'.repeat(40);
    const added = { change: 'added' as const, path: 'a', oldMode: 0, newMode: 0o100644, oldId: Z, newId: X, contents: Buffer.from('x') };
    const refused: [string, Parameters<typeof candidateEvidenceDigest>[0]][] = [
      ['a submodule pointer', { ...base, entries: [{ ...added, newMode: 0o160000 }] }],
      ['an unknown mode', { ...base, entries: [{ ...added, newMode: 0o100664 }] }],
      ['a path with a space', { ...base, entries: [{ ...added, path: 'a b' }] }],
      ['an abbreviated identity', { ...base, entries: [{ ...added, newId: 'abc1234' }] }],
      ['an addition with a baseline side', { ...base, entries: [{ ...added, oldId: X }] }],
      ['a present side without contents', { ...base, entries: [{ ...added, contents: null }] }],
      ['a duplicate path', { ...base, entries: [added, added] }],
      ['a reference instead of a commit', { ...base, baselineCommit: 'HEAD', entries: [] }],
      ['an ancestry that does not link', { ...base, entries: [added], ancestry: [] }],
      ['an ancestry with a stray tip', { ...base, entries: [added], ancestry: [...base.ancestry, { commit: 'b'.repeat(40), parent: '2'.repeat(40), entries: [] }] }],
      ['one byte over the per-file bound', { ...base, entries: [{ ...added, contents: Buffer.alloc(1_048_577) }] }],
    ];
    for (const [name, input] of refused) {
      const r = candidateEvidenceDigest(input);
      expect(r.digest, name).toBeNull();
      expect(r.problems.length, name).toBeGreaterThan(0);
    }
  });

  it('an attestation over OTHER evidence, another baseline or the old revision is refused', () => {
    const x = V.host.attested[0]!;
    const bytes = Buffer.from(x.responseRecord, 'utf8');
    expect(readHostResponseRecord(bytes, expectations(x)).problems).toEqual([]);

    const otherEvidence = readHostResponseRecord(bytes, expectations(x, { evidence: { ...agentEvidence(), evidenceDigest: 'ee'.repeat(32) } }));
    expect(otherEvidence.record).toBeNull();
    expect(otherEvidence.problems.join(' ')).toContain('evidence the agent cannot reproduce');

    const otherBaseline = readHostResponseRecord(bytes, expectations(x, { evidence: { ...agentEvidence(), baselineCommit: 'c'.repeat(40) } }));
    expect(otherBaseline.record).toBeNull();
    expect(otherBaseline.problems.join(' ')).toContain('different baseline');

    // A REVISION 1 ATTESTATION binds no evidence at all. Re-bound to the wire so the ONLY thing wrong
    // with it is the revision and the two missing fields.
    const parsed = JSON.parse(x.responseRecord) as { attestation: Record<string, unknown> };
    parsed.attestation['schemaVersion'] = 1;
    delete parsed.attestation['baselineCommit'];
    delete parsed.attestation['evidenceDigest'];
    const old = Buffer.from(JSON.stringify(parsed), 'utf8');
    const stale = readHostResponseRecord(old, expectations(x, { evidenceRef: hostEvidenceRefOf(old) }));
    expect(stale.record).toBeNull();
    expect(stale.problems.join(' ')).toContain('does not bind candidate evidence');
  });
});

describe('the agent half is still what this implementation produces', () => {
  it('the contract is the one both languages read', () => {
    expect(V.contract).toBe('projectos.host-review-path-vectors.v1');
    expect(V.host, 'the Host half has not been recorded').not.toBeNull();
  });

  it('derives the nonce, the hello, the claim and the binding digest the real Host accepted', () => {
    expect(nonce.toString('hex')).toBe(V.agent.nonceHex);
    expect(encodeControllerHello(nonce).toString('hex')).toBe(V.agent.controllerHelloFrameHex);
    expect(claim()).toEqual(V.agent.claim);
    expect(hostBindingDigest(claim())).toBe(V.agent.bindingDigest);
  });

  it.each(V.agent.exchanges.map((x) => [x.ask, x] as const))('builds the %s subject and request frame byte for byte', (_ask, x) => {
    expect(hostCorrelationFor(x.requestId)).toBe(x.correlation);
    const subject = buildHostReviewSubject({
      ask: x.ask,
      correlation: x.correlation,
      declared: {
        projectId: I['projectId']!,
        repository: I['repository']!,
        planRef: I['planRef']!,
        phaseId: I['phaseId']!,
        subjectCommit: I['subjectCommit']!,
        requestId: x.requestId,
        requestDigest: I['requestDigest']!,
        ...(x.ask === 'closure' ? { scope: I['closureScope']!, evidenceSubjectHead: I['closureEvidenceSubjectHead']! } : {}),
      },
      providerRequest: I['providerRequest']!,
    });
    expect(subject?.bytes.toString('utf8')).toBe(x.subject);
    expect(subject?.parameterDigest).toBe(x.parameterDigest);
    const frame = encodeProtectedOperationRequest(nonce, {
      correlation: x.correlation,
      sequence: BigInt(I['sequence']!),
      claimedServiceEpoch: BigInt(I['serviceEpoch']!),
      bindingDigest: V.agent.bindingDigest,
      approvalRef: I['delegationId']!,
      parameterDigest: x.parameterDigest,
    });
    expect(frame?.toString('hex')).toBe(x.requestFrameHex);
  });
});

describe("the real Host's bytes are accepted by the real agent", () => {
  const all = [...V.host.attested, V.host.failedNotDispatched, V.host.failedDispatched];

  it.each(all.map((x, i) => [`${i}:${x.ask}:${x.responseResult}`, x] as const))('frames of %s decode strictly under the exchange nonce', (_n, x) => {
    expect(serviceReadyRefusal(Buffer.from(x.serviceReadyFrameHex, 'hex'), nonce)).toBeNull();
    const status = decodeInstalledHostStatus(Buffer.from(x.statusFrameHex, 'hex'), nonce);
    expect(status.ok && status.value.protectedOperations).toBe('Authorised');
    const response = decodeProtectedOperationResponse(Buffer.from(x.responseFrameHex, 'hex'), nonce);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.value.correlation).toBe(x.correlation);
    expect(response.value.state).toBe(x.responseState);
    expect(response.value.result).toBe(x.responseResult);
    expect(response.value.evidenceRef).toBe(x.evidenceRef);
    expect(response.value.serviceEpoch).toBe(BigInt(I['serviceEpoch']!));
    // THE RECORD IS BOUND TO THE WIRE by a digest the agent recomputes.
    expect(hostEvidenceRefOf(Buffer.from(x.responseRecord, 'utf8'))).toBe(x.evidenceRef);
    expect(x.responseRecordFileName).toBe(hostExchangeFileName(x.correlation, 'response'));
  });

  it('a technical review passes the EXISTING decision and attestation checks', () => {
    const x = V.host.attested.find((a) => a.ask === 'gatekeeper')!;
    const requestId = V.agent.exchanges.find((a) => a.ask === 'gatekeeper')!.requestId;
    const read = readHostResponseRecord(Buffer.from(x.responseRecord, 'utf8'), expectations(x));
    expect(read.problems).toEqual([]);
    expect(read.record?.outcome).toBe('attested');
    if (read.record?.outcome !== 'attested') return;
    const record = gatekeeperRecordFromHost(read.record);
    expect(
      checkGatekeeperDecision(record, {
        projectId: I['projectId']!,
        phaseId: I['phaseId']!,
        subjectCommit: I['subjectCommit']!,
        requestDigest: I['requestDigest']!,
        expectedDecider: 'ChatGPT',
        alreadyConsumedDecisionIds: [],
        ownerOnlyActions: ['production-deploy'],
      }),
    ).toEqual([]);
    expect(checkHostAttestation(read.record.attestation, { requestId, record })).toEqual([]);
    expect(read.record.usage).toEqual({ inputTokens: 2000, cachedInputTokens: 1500, outputTokens: 300 });
  });

  it('a closure review passes the EXISTING closure response and attestation checks', () => {
    const x = V.host.attested.find((a) => a.ask === 'closure')!;
    const requestId = V.agent.exchanges.find((a) => a.ask === 'closure')!.requestId;
    const read = readHostResponseRecord(Buffer.from(x.responseRecord, 'utf8'), expectations(x));
    expect(read.problems).toEqual([]);
    if (read.record?.outcome !== 'attested') throw new Error('expected an attested closure record');
    const record = closureRecordFromHost(read.record);
    expect(
      checkClosureResponse(record, {
        projectId: I['projectId']!,
        phaseId: I['phaseId']!,
        scope: I['closureScope']!,
        expectedDecider: 'ChatGPT',
        evidenceSubjectHead: I['closureEvidenceSubjectHead']!,
        requestDigest: I['requestDigest']!,
        alreadyConsumedDecisionIds: [],
        owner: 'Murad',
        unresolvedHighIds: [],
      }),
    ).toEqual([]);
    expect(checkHostClosureAttestation(read.record.attestation, { requestId, record })).toEqual([]);
  });

  it('a failure record states the HOST-authoritative dispatch fact, per class', () => {
    for (const [x, dispatched] of [
      [V.host.failedNotDispatched, false],
      [V.host.failedDispatched, true],
    ] as const) {
      const read = readHostResponseRecord(Buffer.from(x.responseRecord, 'utf8'), expectations(x));
      expect(read.problems).toEqual([]);
      expect(read.record).toMatchObject({ outcome: 'failed', providerDispatched: dispatched });
    }
  });
});

describe('the existing checks refuse a wrong answer on this path', () => {
  const x = V.host.attested.find((a) => a.ask === 'gatekeeper')!;
  const read = readHostResponseRecord(Buffer.from(x.responseRecord, 'utf8'), expectations(x));
  if (read.record?.outcome !== 'attested') throw new Error('expected an attested record');
  const record = gatekeeperRecordFromHost(read.record);
  const expectOk = {
    projectId: I['projectId']!,
    phaseId: I['phaseId']!,
    subjectCommit: I['subjectCommit']!,
    requestDigest: I['requestDigest']!,
    expectedDecider: 'ChatGPT',
    alreadyConsumedDecisionIds: [] as string[],
    ownerOnlyActions: [] as string[],
  };

  it.each([
    ['wrong project', { projectId: 'another-project' }],
    ['wrong phase', { phaseId: 'ANOTHER-PHASE' }],
    ['wrong evidence subject', { subjectCommit: '7e15629506400000000000000000000000000000' }],
    ['wrong request digest', { requestDigest: 'cd'.repeat(32) }],
    ['a replayed decision', { alreadyConsumedDecisionIds: [String(record.decisionId)] }],
    ['an implementer acting as gatekeeper', { expectedDecider: 'someone-else' }],
  ] as const)('%s is refused by checkGatekeeperDecision', (_n, over) => {
    expect(checkGatekeeperDecision(record, { ...expectOk, ...over }).length).toBeGreaterThan(0);
  });

  it('an attestation for another request, or disagreeing with the decision, is refused by checkHostAttestation', () => {
    expect(checkHostAttestation(read.record!.outcome === 'attested' ? read.record!.attestation : null, { requestId: 'GKREQ-some-other-request', record }).length).toBeGreaterThan(0);
    const attestation = read.record!.outcome === 'attested' ? read.record!.attestation : null;
    const requestId = V.agent.exchanges[0]!.requestId;
    expect(checkHostAttestation(attestation, { requestId, record: { ...record, decision: 'DO_NOT_PROCEED' } }).length).toBeGreaterThan(0);
    expect(checkHostAttestation(attestation, { requestId, record: { ...record, allowedActions: ['commit'] } }).length).toBeGreaterThan(0);
    expect(checkHostAttestation(null, { requestId, record }).length).toBeGreaterThan(0);
  });
});

describe('the response record is untrusted, whole', () => {
  const x = V.host.attested[0]!;
  const good = Buffer.from(x.responseRecord, 'utf8');
  const refused = (bytes: Buffer, over: Partial<HostResponseExpectations> = {}): readonly string[] => {
    const r = readHostResponseRecord(bytes, expectations(x, over));
    expect(r.record).toBeNull();
    return r.problems;
  };
  /** Re-bind a MODIFIED record to the wire, so the test reaches the check it is about. */
  const rebound = (mutate: (o: Record<string, any>) => void): readonly string[] => {
    const o = JSON.parse(x.responseRecord) as Record<string, any>;
    mutate(o);
    const bytes = Buffer.from(JSON.stringify(o), 'utf8');
    return refused(bytes, { evidenceRef: hostEvidenceRefOf(bytes) });
  };

  it('one changed byte breaks the binding to the wire', () => {
    const tampered = Buffer.from(good);
    tampered[tampered.length - 2] ^= 0x01;
    expect(refused(tampered).join(' ')).toMatch(/does not hash to the evidence reference/);
  });
  it('an empty, oversized or non-JSON record is refused', () => {
    expect(refused(Buffer.alloc(0)).length).toBeGreaterThan(0);
    const big = Buffer.alloc(64 * 1024 + 1, 0x20);
    expect(refused(big, { evidenceRef: hostEvidenceRefOf(big) }).join(' ')).toMatch(/bound/);
    const junk = Buffer.from('not json', 'utf8');
    expect(refused(junk, { evidenceRef: hostEvidenceRefOf(junk) }).join(' ')).toMatch(/not JSON/);
    const trailing = Buffer.concat([good, Buffer.from(' {}', 'utf8')]);
    expect(refused(trailing, { evidenceRef: hostEvidenceRefOf(trailing) }).join(' ')).toMatch(/not JSON/);
  });
  it('another correlation, another ask and a wire/record disagreement are refused', () => {
    expect(refused(good, { correlation: 'ee'.repeat(16) }).join(' ')).toMatch(/different correlation/);
    expect(refused(good, { ask: 'closure' }).join(' ')).toMatch(/different question/);
    expect(refused(good, { wireResult: 'Failed' }).join(' ')).toMatch(/wire completion reported Failed/);
  });
  it('an unknown field anywhere is refused, never ignored', () => {
    expect(rebound((o) => { o['credential'] = 'x'; }).join(' ')).toMatch(/unknown field credential/);
    expect(rebound((o) => { o['declared']['extra'] = 'x'; }).join(' ')).toMatch(/unknown field declared\.extra/);
    expect(rebound((o) => { o['decision']['reasoning'] = 'hidden'; }).join(' ')).toMatch(/unknown field decision\.reasoning/);
    expect(rebound((o) => { o['attestation']['apiKey'] = 'x'; }).join(' ')).toMatch(/unknown field attestation\.apiKey/);
  });
  it('an attestation over OTHER Host facts than the agent claimed is refused', () => {
    for (const k of ['project', 'repository', 'plan', 'planDigest', 'phase', 'candidateDigest', 'delegationId']) {
      expect(rebound((o) => { o['attestation'][k] = 'ee'.repeat(32); }).join(' '), k).toMatch(new RegExp(`different ${k}`));
    }
  });
  it('an attested record with no attestation, no decision or no usage is refused', () => {
    expect(rebound((o) => { delete o['attestation']; }).join(' ')).toMatch(/carries no attestation/);
    expect(rebound((o) => { delete o['decision']; }).join(' ')).toMatch(/carries no decision/);
    expect(rebound((o) => { delete o['usage']; }).join(' ')).toMatch(/carries no usage/);
    expect(rebound((o) => { o['providerDispatched'] = false; }).join(' ')).toMatch(/claims no provider was dispatched/);
  });
});

describe('every frame decoder is strict', () => {
  const x = V.host.attested[0]!;
  const response = Buffer.from(x.responseFrameHex, 'hex');
  const refusal = (buf: Buffer, n: Buffer = nonce): string => {
    const r = decodeProtectedOperationResponse(buf, n);
    return r.ok ? 'ACCEPTED' : r.refusal;
  };
  it('refuses bad magic, an unknown version, truncation, trailing data, a wrong kind, a wrong nonce and an unknown enum byte', () => {
    const flip = (i: number): Buffer => { const b = Buffer.from(response); b[i] ^= 0xff; return b; };
    expect(refusal(flip(0))).toBe('BadMagic');
    expect(refusal(flip(5))).toBe('UnknownVersion');
    expect(refusal(response.subarray(0, 40))).toBe('TruncatedHeader');
    expect(refusal(response.subarray(0, response.length - 1))).toBe('TruncatedPayload');
    expect(refusal(Buffer.concat([response, Buffer.from([0])]))).toBe('TrailingData');
    expect(refusal(Buffer.from(x.statusFrameHex, 'hex'))).toBe('UnexpectedMessageKind');
    expect(refusal(response, hostNonceForRunId(Buffer.from('OTHERRUN', 'ascii')))).toBe('NonceMismatch');
    const badEnum = Buffer.from(response);
    badEnum[41 + 16] = 0x7f;
    expect(refusal(badEnum)).toBe('UnknownStatusEnum');
    const oversize = Buffer.from(response);
    oversize.writeUInt16BE(0xffff, 39);
    expect(refusal(oversize)).toBe('OversizedPayload');
  });
  it('never encodes a malformed request', () => {
    const base = { correlation: 'ab'.repeat(16), sequence: 1n, claimedServiceEpoch: 1n, bindingDigest: 'ab'.repeat(32), approvalRef: 'ab'.repeat(32), parameterDigest: 'ab'.repeat(32) };
    expect(encodeProtectedOperationRequest(nonce, base)).not.toBeNull();
    expect(encodeProtectedOperationRequest(nonce, { ...base, correlation: 'AB'.repeat(16) })).toBeNull();
    expect(encodeProtectedOperationRequest(nonce, { ...base, bindingDigest: 'ab'.repeat(31) })).toBeNull();
    expect(encodeProtectedOperationRequest(nonce, { ...base, sequence: -1n })).toBeNull();
    expect(encodeProtectedOperationRequest(nonce, { ...base, claimedServiceEpoch: 1n << 64n })).toBeNull();
    expect(hostBindingDigest({ ...claim(), project: 'zz' })).toBeNull();
  });
  it('refuses a subject over the Host bound', () => {
    expect(
      buildHostReviewSubject({
        ask: 'gatekeeper',
        correlation: 'ab'.repeat(16),
        declared: { projectId: 'p', repository: 'r', planRef: 'pl', phaseId: 'ph', subjectCommit: 'c', requestId: 'q', requestDigest: 'd' },
        providerRequest: 'x'.repeat(64 * 1024),
      }),
    ).toBeNull();
  });
});
