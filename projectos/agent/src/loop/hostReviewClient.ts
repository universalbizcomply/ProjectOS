/**
 * THE PRODUCTION HOST REVIEW CLIENT — the agent's implementation of `HostReviewPort` and
 * `HostClosureReviewPort`.
 *
 * WHAT IT IS. One ordered exchange with ProjectOSHost, and the strict judgement of everything that comes
 * back. It forms the agent's CLAIM about what is being reviewed, writes the question where the Host
 * reads it, performs one status-then-review exchange on the Host's existing endpoint, and returns either
 * an attested CANDIDATE decision (which the turn then judges with the existing decision and attestation
 * checks) or a typed unavailability carrying the HOST-AUTHORITATIVE dispatch fact.
 *
 * WHAT IT IS NOT, AND CANNOT BECOME.
 *  - It is not a provider client. There is no HTTP, no model name sent anywhere, no credential read, and
 *    no code path that reaches a provider: the only thing this file can talk to is a local pipe.
 *  - It has NO fallback. No interactive route, no direct-provider route, no implementer self-review. An
 *    exchange that does not produce a verified attested record produces `unavailable`, and the turn stops
 *    for the owner exactly as it does for every other unavailability.
 *  - It mints nothing. The binding digest is a claim the Host compares with its own facts; the record and
 *    the attestation are the Host's, and are treated as untrusted until every check has passed.
 *
 * `providerDispatched` IS NEVER INFERRED FROM THE FRAME. It is `false` only where nothing was sent, where
 * the Host answered `NotRun`, or where the Host's own failure record says no provider was reached. Every
 * other ending — no answer, an unreadable answer, a record that fails verification — is `true`, because
 * money that may have been spent is never released on a guess.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import {
  closureRecordFromHost,
  committedCandidateDigest,
  credentialRefIdentityDigest,
  decodeInstalledHostStatus,
  decodeProtectedOperationResponse,
  encodeControllerHello,
  encodeProtectedOperationRequest,
  gatekeeperRecordFromHost,
  hostBindingDigest,
  hostNonceForRunId,
  modelPolicyIdentityDigest,
  phaseIdentityDigest,
  planIdentityDigest,
  projectIdentityDigest,
  readHostResponseRecord,
  repositoryIdentityDigest,
  serviceReadyRefusal,
  buildHostReviewSubject,
  HOST_MESSAGE_KIND,
  HOST_HEADER_LEN,
  type GatekeeperUnavailabilityCause,
  type HostBindingSubject,
  type HostClosureReviewCall,
  type HostClosureReviewOutcome,
  type HostClosureReviewPort,
  type HostResponseRecord,
  type HostReviewAsk,
  type HostReviewCall,
  type HostReviewDeclared,
  type HostReviewOutcome,
  type HostReviewPort,
} from '@projectos/core';
import type { HostReviewActivation } from './hostReviewActivation.js';
import type { CandidateEvidenceSource } from './hostCandidateEvidence.js';
import type { HostIpcTransport } from './transports/hostIpcTransport.js';

/** How one exchange ended, before it is shaped for either port. */
type Ended =
  | { readonly kind: 'attested'; readonly record: Extract<HostResponseRecord, { outcome: 'attested' }> }
  | { readonly kind: 'unavailable'; readonly cause: GatekeeperUnavailabilityCause; readonly providerDispatched: boolean; readonly reasons: readonly string[] };

function unavailable(cause: GatekeeperUnavailabilityCause, providerDispatched: boolean, ...reasons: string[]): Ended {
  return { kind: 'unavailable', cause, providerDispatched, reasons };
}

/** The expected `ServiceReady`, byte for byte: the hello's header with kind 2 and the service role. */
function expectedServiceReady(nonce: Buffer): Buffer {
  const ready = Buffer.from(encodeControllerHello(nonce));
  ready[6] = HOST_MESSAGE_KIND.ServiceReady;
  ready[HOST_HEADER_LEN] = 2;
  return ready;
}

export interface HostReviewClientDeps {
  readonly activation: HostReviewActivation;
  readonly transport: HostIpcTransport;
  /**
   * The agent's OWN reading of the candidate (PROJECTOS-HOST-REVIEW-PATH1B): the evidence digest it
   * recomputes from the approved baseline and the candidate with its own repository access. REQUIRED -
   * there is no client without it, so no attestation can be accepted unchecked.
   */
  readonly candidateEvidence: CandidateEvidenceSource;
}

/**
 * Build both ports over one activation and one transport. The last service epoch the Host taught this
 * process is remembered IN MEMORY ONLY, so a later request usually needs no discovery round.
 */
export function hostReviewClient(deps: HostReviewClientDeps): HostReviewPort & HostClosureReviewPort {
  let knownEpoch = 0n;

  const ask = (input: {
    readonly ask: HostReviewAsk;
    readonly correlation: string;
    readonly projectId: string;
    readonly phaseId: string;
    readonly subjectCommit: string;
    readonly declared: HostReviewDeclared;
    readonly body: string;
  }): Ended => {
    const a = deps.activation;

    // 1. THE CLAIM. The agent's own view of the nine bound facts. The candidate is the COMMITTED subject
    //    and nothing else: a working-tree digest is never substituted, and a commit id that is not
    //    exactly 40 lower-case hex is refused here rather than sent.
    const candidate = committedCandidateDigest(input.subjectCommit);
    if (candidate === null) {
      return unavailable('TRANSPORT_UNUSABLE', false, 'the review subject is not an immutable 40-character commit id; the Host reviews COMMITTED candidates only');
    }
    const claim: HostBindingSubject = {
      project: projectIdentityDigest(input.projectId).toString('hex'),
      repository: repositoryIdentityDigest(a.repository).toString('hex'),
      plan: planIdentityDigest(a.planRef).toString('hex'),
      planDigest: a.planDigest,
      phase: phaseIdentityDigest(input.phaseId).toString('hex'),
      candidateDigest: candidate.toString('hex'),
      modelPolicy: modelPolicyIdentityDigest(a.modelPolicy).toString('hex'),
      credentialRef: credentialRefIdentityDigest(a.credentialRef).toString('hex'),
    };
    const bindingDigest = hostBindingDigest(claim);
    const subject = buildHostReviewSubject({ ask: input.ask, correlation: input.correlation, declared: input.declared, providerRequest: input.body });
    if (bindingDigest === null || subject === null) {
      return unavailable('TRANSPORT_UNUSABLE', false, 'the review subject could not be formed within the Host bound; nothing was sent');
    }

    // 1b. THE AGENT'S OWN EVIDENCE, BEFORE ANYTHING IS WRITTEN OR SENT. The Host will attest the digest
    //     of what it showed the reviewer; the agent recomputes that digest from the same approved
    //     baseline and candidate so it can refuse an attestation over anything else. If the agent cannot
    //     read its own candidate there is nothing to check an answer against, so nothing is asked - and
    //     because nothing was dispatched, the caller releases its reservation.
    const own = deps.candidateEvidence(a.baselineCommit, input.subjectCommit);
    if ('problems' in own) {
      return unavailable('TRANSPORT_UNUSABLE', false, 'the agent could not establish its own evidence of the candidate; nothing was sent', ...own.problems);
    }
    const evidence = { baselineCommit: a.baselineCommit, evidenceDigest: own.digest };

    // 2. THE QUESTION, where the Host reads it. One-shot and derived-name on both sides.
    if (deps.transport.writeSubject(input.correlation, subject.bytes) !== 'written') {
      return unavailable('TRANSPORT_UNREACHABLE', false, 'the review subject could not be written to the Host request inbox; nothing was sent');
    }

    const nonce = hostNonceForRunId(deps.transport.runId);
    const exchangeOnce = (epoch: bigint): Ended | { readonly kind: 'epoch'; readonly epoch: bigint } => {
      const request = encodeProtectedOperationRequest(nonce, {
        correlation: input.correlation,
        // One exchange per connection, and one connection per session: the first sequence on it.
        sequence: 1n,
        claimedServiceEpoch: epoch,
        bindingDigest,
        approvalRef: a.delegationId,
        parameterDigest: subject.parameterDigest,
      });
      if (request === null) return unavailable('TRANSPORT_UNUSABLE', false, 'the request frame could not be encoded; nothing was sent');

      const x = deps.transport.exchange({
        hello: encodeControllerHello(nonce),
        expectedReady: expectedServiceReady(nonce),
        request,
        responseTimeoutMs: a.responseTimeoutSeconds * 1000,
      });
      if (x.kind === 'not-sent') {
        return unavailable('TRANSPORT_UNREACHABLE', false, `ProjectOSHost was not asked (${x.stage}): ${x.detail}`);
      }

      // THE REQUEST WAS WRITTEN. From here every doubt is "may have been dispatched".
      const readyRefusal = serviceReadyRefusal(x.readyFrame, nonce);
      const status = decodeInstalledHostStatus(x.statusFrame, nonce);
      if (readyRefusal !== null || !status.ok || status.value.protectedOperations !== 'Authorised') {
        return unavailable('PROVIDER_UNAVAILABLE', true, 'the Host status exchange did not verify strictly after the request was written');
      }
      if (x.responseFrame === null) return unavailable('PROVIDER_UNAVAILABLE', true, `ProjectOSHost did not answer: ${x.detail}`);
      const decoded = decodeProtectedOperationResponse(x.responseFrame, nonce);
      if (!decoded.ok) return unavailable('PROVIDER_UNAVAILABLE', true, `the Host response frame was refused (${decoded.refusal})`);
      const response = decoded.value;
      if (response.correlation !== input.correlation) return unavailable('PROVIDER_UNAVAILABLE', true, 'the Host answered a different correlation');

      if (response.state === 'Rejected') {
        // A refusal says NOTHING RAN, and says so in a field of its own. Anything else under `Rejected`
        // is two answers at once and is believed as neither.
        if (response.result !== 'NotRun') return unavailable('PROVIDER_UNAVAILABLE', true, 'the Host response is a refusal that also claims an execution');
        if (response.reason === 'ServiceEpochMismatch') return { kind: 'epoch', epoch: response.serviceEpoch };
        return unavailable('TRANSPORT_NOT_APPROVED', false, `ProjectOSHost refused the review before anything ran (${response.reason})`);
      }
      if (response.state !== 'Completed' || response.result === 'NotRun') {
        return unavailable('PROVIDER_UNAVAILABLE', true, `the Host response is not a completion (${response.state}/${response.result})`);
      }
      knownEpoch = response.serviceEpoch;

      // 3. THE RECORD. Read once, under its derived name, and believed only after every check.
      const bytes = deps.transport.readResponseRecord(input.correlation);
      if (bytes === null) return unavailable('PROVIDER_UNAVAILABLE', true, 'the Host completed the review but its response record could not be read');
      const read = readHostResponseRecord(bytes, {
        correlation: input.correlation,
        ask: input.ask,
        evidenceRef: response.evidenceRef,
        wireResult: response.result,
        claim,
        delegationId: a.delegationId,
        evidence,
      });
      if (read.record === null) return unavailable('PROVIDER_UNAVAILABLE', true, ...read.problems);
      if (read.record.outcome === 'failed') {
        // THE HOST'S OWN STATEMENT, from a record bound to the wire: the only place `false` may come
        // from after a completion.
        return read.record.providerDispatched
          ? unavailable('PROVIDER_UNAVAILABLE', true, 'ProjectOSHost ran the review and no usable attested answer resulted')
          : unavailable('CREDENTIAL_UNAVAILABLE', false, 'ProjectOSHost could not resolve the gatekeeper credential, so no provider was called');
      }
      return { kind: 'attested', record: read.record };
    };

    let ended = exchangeOnce(knownEpoch);
    if (ended.kind === 'epoch') {
      // ONE DISCOVERY ROUND, AND ONLY ONE. The Host refuses a stale epoch BEFORE it reads the subject,
      // admits the request or records a replay identity, so the same question may be asked again with
      // the epoch that refusal carried. A second mismatch is not retried: that is not a restart race.
      knownEpoch = ended.epoch;
      ended = exchangeOnce(knownEpoch);
      if (ended.kind === 'epoch') ended = unavailable('TRANSPORT_NOT_APPROVED', false, 'ProjectOSHost refused the service epoch it had itself just reported');
    }
    // A QUESTION THAT WAS NEVER ASKED LEAVES NO FILE BEHIND. Only when nothing can have been dispatched:
    // after a dispatch the Host owns the subject.
    if (ended.kind === 'unavailable' && !ended.providerDispatched) deps.transport.discardSubject(input.correlation);
    return ended;
  };

  return {
    review(call: HostReviewCall): HostReviewOutcome {
      const r = call.request;
      const ended = ask({
        ask: 'gatekeeper',
        correlation: call.correlation,
        projectId: r.projectId,
        phaseId: r.phaseId,
        subjectCommit: r.subjectCommit,
        declared: {
          projectId: r.projectId,
          repository: deps.activation.repository,
          planRef: deps.activation.planRef,
          phaseId: r.phaseId,
          subjectCommit: r.subjectCommit,
          requestId: r.requestId,
          requestDigest: call.requestDigest,
        },
        body: call.body,
      });
      if (ended.kind === 'unavailable') return ended;
      return { kind: 'attested', record: gatekeeperRecordFromHost(ended.record), attestation: ended.record.attestation, usage: ended.record.usage };
    },
    reviewClosure(call: HostClosureReviewCall): HostClosureReviewOutcome {
      const r = call.request;
      const ended = ask({
        ask: 'closure',
        correlation: call.correlation,
        projectId: r.projectId,
        phaseId: r.phaseId,
        subjectCommit: r.subjectHead,
        declared: {
          projectId: r.projectId,
          repository: deps.activation.repository,
          planRef: deps.activation.planRef,
          phaseId: r.phaseId,
          subjectCommit: r.subjectHead,
          requestId: r.requestId,
          requestDigest: call.requestDigest,
          scope: r.scope,
          evidenceSubjectHead: r.subjectHead,
        },
        body: call.body,
      });
      if (ended.kind === 'unavailable') return ended;
      return { kind: 'attested', record: closureRecordFromHost(ended.record), attestation: ended.record.attestation, usage: ended.record.usage };
    },
  };
}
