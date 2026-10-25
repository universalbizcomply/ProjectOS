/**
 * One CLOSURE turn: a phase that has been pushed and is eligible asks its closure authority, and gets
 * back either a checkable decision or a refusal.
 *
 * THE ORDER IS THE SAFETY ARGUMENT, and it is deliberately the same order `takeGatekeeperTurn` uses,
 * because the failure modes are the same ones:
 *
 *   1. IDENTIFY THE REQUEST DETERMINISTICALLY. The id is derived from what is being asked about, so
 *      a restart re-derives the SAME id — the ledger counts one call and the broker's replay guard
 *      refuses a second.
 *   2. ISOLATION BEFORE TRANSPORT. A thread binding belonging to another project or checkout stops
 *      the turn before anything is sent, because the damage from sending is done at the moment of
 *      sending.
 *   3. THE INSTALLATION'S POLICY BEFORE ADMISSION. A call that provably cannot be made is never
 *      reserved against the budget, and any reservation an earlier attempt left is released here.
 *   4. BUDGET BEFORE THE CALL, against the ESTIMATE. A limit tested after the money is gone is a
 *      report, not a limit.
 *   5. ONLY THEN THE CALL. Any failure of it — unreachable, spend-limited, malformed, unresolved
 *      credential — is an outcome the owner reads, never a second transport and never a permissive
 *      default.
 *   6. CHECK THE ANSWER BEFORE ANYTHING IS WRITTEN. `checkClosureResponse` judges it against
 *      expectations the runtime established, and the record to write is produced ONLY from an answer
 *      that passed.
 *
 * WHAT THIS MODULE NEVER DOES: decide anything itself, write a file, touch git, retry a transport,
 * hold a secret, close a phase, or turn an absent answer into a permissive one. It has no `System`
 * and cannot acquire one — durability belongs to the command that composes it, exactly as it does for
 * the gatekeeper turn.
 *
 * AND IT PRODUCES NO AUTHORITY. A returned `decision` is a record to WRITE. Writing it changes
 * nothing: `checkClosureDecision` still refuses an uncommitted decision, and G4 still refuses a
 * closure without one. The owner's commit is the authenticity anchor and this module cannot reach it.
 *
 * Created in PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A.
 */
import {
  CLOSURE_ASK,
  CLOSURE_REQUEST_SCHEMA_VERSION,
  PHASE_CLOSURE_SCOPE,
  GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
  authoriseRequestSpend,
  checkClosureResponse,
  checkThreadBinding,
  closureDecisionRecordFrom,
  closureEvidenceDigest,
  closureRequestDigest,
  deriveClosureRequestId,
  estimateCostMicroUsd,
  estimateInputTokensFromText,
  reservationOrNull,
  carriedContextTokens,
  utf8ByteLength,
  evaluateBudget,
  modelForAsk,
  recordCall,
  selectGatekeeperTransport,
  selectTier,
  summariseLedger,
  type BudgetPolicy,
  type ClosureDecisionRecord,
  type ClosureRequest,
  type ClosureResponseRecord,
  type GatekeeperTransportDescriptor,
  type GatekeeperUnavailabilityCause,
  type GovernanceThreadBinding,
  type LedgerEntry,
  type ModelPolicy,
  type RateCard,
  type TransportAvailability,
  CLOSURE_DECISION_SCHEMA_VERSION,
  CLOSURE_RESPONSE_DECISIONS,
  checkHostClosureAttestation,
  hostCorrelationFor,
  provenanceClaimsIn,
  type ClosureResponseExpectations,
  type DecisionProvenanceStamp,
  type GatekeeperProvenance,
  type HostAttestationSummary,
  type HostClosureReviewOutcome,
  type HostClosureReviewPort,
} from '@projectos/core';
import {
  awaitInteractiveAnswer,
  INTERACTIVE_HANDOFF_SCHEMA_VERSION,
  type InteractiveDecisionPort,
  type InteractiveQuestion,
} from './interactiveGatekeeper.js';
import type { CredentialResolver } from './credentialResolver.js';
import type { BrokeredTransport } from './transports/brokeredHttpPort.js';
import { GATEKEEPER_OUTPUT_TOKEN_LIMIT, gatekeeperOutputAnomaly, type HttpPort } from './transports/openaiResponses.js';
import { submitClosureRequest, buildClosureResponsesBody, type ClosureTransportOutcome } from './transports/closureResponses.js';
import { lastBilledUsage } from './gatekeeperTurn.js';

export interface ClosureTurnInput {
  readonly projectId: string;
  readonly phaseId: string;
  /** The exact POST-PUSH subject the closure evidence was established at. */
  readonly subjectHead: string;
  readonly repositoryRoot: string;
  /** The canonical closure evidence, as text. Its digest binds the request. */
  readonly evidenceText: string;
  /** Who the ACTIVE APPROVED PLAN delegates closure to. Never a caller's claim. */
  readonly expectedDecider: string;
  /** The governed project's owner, used only to judge an acceptance the response may not author. */
  readonly owner: string;
  /** Ids the closure evidence records as unresolved HIGH at this subject. */
  readonly unresolvedHighIds: readonly string[];
  readonly at: string;
}

export interface ClosureTurnDeps {
  readonly transport: GatekeeperTransportDescriptor | null;
  readonly availability: TransportAvailability;
  readonly resolver: CredentialResolver;
  readonly broker?: {
    readonly transport: BrokeredTransport;
    readonly governedRoot: string;
    readonly installationAllows?: () => { readonly allowed: boolean; readonly reasons: readonly string[] };
  };
  readonly http: HttpPort;
  readonly modelPolicy: ModelPolicy;
  readonly rateCards: Readonly<Record<string, RateCard>>;
  readonly budget: BudgetPolicy;
  /** Everything spent so far. Read, never written, by this module. */
  readonly ledger: readonly LedgerEntry[];
  /** Serialised budget admission, when a durable ledger exists. See `admitGatekeeperSpend`. */
  readonly admitSpend?: (request: {
    readonly requestId: string;
    readonly projectId: string;
    readonly phaseId: string;
    readonly model: string;
    readonly estimateMicroUsd: number;
    readonly at: string;
  }) => { readonly allowed: boolean; readonly reasons: readonly string[] };
  readonly releaseUndispatched?: (requestId: string) => void;
  readonly resolveSpend?: (
    request: { readonly requestId: string; readonly projectId: string; readonly phaseId: string },
    cause: string,
    /** The Host-authoritative dispatch fact, when the Host route stated one. */
    providerDispatched?: boolean,
  ) => void;
  readonly threadBinding: GovernanceThreadBinding | null;
  /** Closure decision ids already consumed for this phase, so a replayed answer is refused. */
  readonly consumedDecisionIds: readonly string[];
  /** Set only for a local rehearsal route; see `gatekeeperTransport.ts`. */
  readonly rehearsalOnly?: boolean;
  /** A rehearsal authority, used INSTEAD of the network when the route is a rehearsal one. */
  readonly rehearsalReviewer?: (request: ClosureRequest, evidenceText: string) => ClosureTransportOutcome;
  /**
   * UNATTENDED MODE (hybrid routing). The closure question goes ONLY to ProjectOSHost, which asks the
   * independent provider and attests what it returned. With no Host closure route composed the turn
   * waits: it never falls back to the in-process provider call, to an interactive answer, or to the
   * implementer. Absent only for the pre-hybrid composition the unit tests use; `closure request`
   * always states a mode.
   */
  readonly mode?: 'unattended';
  readonly hostReview?: HostClosureReviewPort;
}

/**
 * INTERACTIVE MODE: the owner carries the closure question to the ChatGPT closure authority and its bound
 * answer is handed back through the same port a stopped loop uses. No transport, price or credential.
 */
export interface InteractiveClosureDeps {
  readonly mode: 'interactive';
  readonly interactive: InteractiveDecisionPort;
  /** Closure decision ids already consumed for this phase, so a replayed answer is refused. */
  readonly consumedDecisionIds: readonly string[];
}

/** The closure question, written down for the owner to carry to the ChatGPT closure authority. */
export interface InteractiveClosureHandoff extends InteractiveQuestion {
  readonly handoffKind: 'interactive-closure-request';
  readonly instructions: readonly string[];
  readonly request: ClosureRequest;
  readonly requestDigest: string;
  /** The binding fields the answer must carry verbatim, and the fields the authority fills in. */
  readonly decisionTemplate: Readonly<Record<string, unknown>>;
  readonly evidenceText: string;
}

export type ClosureTurnOutcome =
  /** The authority answered `close` and the answer passed every check. `decision` is what to WRITE. */
  | 'DECIDED_CLOSE'
  /** The authority answered, and its answer was `do-not-close` or `awaiting-owner`. */
  | 'DECIDED_NOT_CLOSE'
  /** An answer came back and did not pass its checks. Nothing is written. */
  | 'ANSWER_REFUSED'
  /** No answer came back. The owner's three choices apply, exactly as on the technical route. */
  | 'UNAVAILABLE'
  /** Interactive: the question is written down and the ChatGPT closure authority has not answered it. */
  | 'AWAITING_GATEKEEPER'
  /** The turn stopped before anything was sent. */
  | 'NOT_SENT';

export interface ClosureTurnResult {
  readonly outcome: ClosureTurnOutcome;
  /**
   * The record to write, and ONLY when `outcome` is `DECIDED_CLOSE`.
   *
   * It carries no `consumedAt`, is not committed, and grants nothing. A caller holding one still has
   * to write it, present it to the owner, and wait — which is the whole point of Route A.
   */
  readonly decision: ClosureDecisionRecord | null;
  /** The authority's own word, when one arrived. Null when nothing was answered. */
  readonly answered: string | null;
  /** Every reason an answer was refused. Empty when there was nothing to refuse. */
  readonly problems: readonly string[];
  /** Human-readable trace. Never contains a credential. */
  readonly lines: readonly string[];
  /** The request that was formed, whether or not it was sent. */
  readonly request: ClosureRequest | null;
  /** A cost entry to append, when a call was actually made. */
  readonly ledgerEntry: LedgerEntry | null;
  readonly ownerChoices: readonly string[] | null;
  readonly unavailabilityCause: GatekeeperUnavailabilityCause | null;
  readonly providerResponseId: string | null;
  /**
   * The evidence class of an ACCEPTED answer, stamped by the route that obtained it — never read from
   * the answer. Absent whenever no answer was accepted, and for the pre-hybrid composition.
   */
  readonly provenance?: GatekeeperProvenance;
  readonly hostAttestationId?: string;
}

/**
 * The closure request for this exact question — THE ONE DERIVATION both acquisition paths share, so an
 * interactive and an unattended closure ask the same question under the same deterministic id.
 */
export function formClosureRequest(input: ClosureTurnInput): ClosureRequest {
  const evidenceDigest = closureEvidenceDigest(input.evidenceText);
  return {
    schemaVersion: CLOSURE_REQUEST_SCHEMA_VERSION,
    requestId: deriveClosureRequestId({
      projectId: input.projectId,
      phaseId: input.phaseId,
      subjectHead: input.subjectHead,
      evidenceDigest,
    }),
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectHead: input.subjectHead,
    evidenceDigest,
    expectedDecider: input.expectedDecider,
    scope: PHASE_CLOSURE_SCOPE,
  };
}

/** What every closure answer is judged against, whichever route delivered it. */
function closureExpectations(
  input: ClosureTurnInput,
  request: ClosureRequest,
  consumedDecisionIds: readonly string[],
): ClosureResponseExpectations {
  return {
    projectId: input.projectId,
    phaseId: input.phaseId,
    scope: PHASE_CLOSURE_SCOPE,
    expectedDecider: input.expectedDecider,
    evidenceSubjectHead: input.subjectHead,
    requestDigest: closureRequestDigest(request),
    alreadyConsumedDecisionIds: consumedDecisionIds,
    owner: input.owner,
    unresolvedHighIds: input.unresolvedHighIds,
  };
}

const NO_DELEGATE = [
  'the active approved plan records no closure delegate, so there is nobody this project may ask',
  'closure remains the owner\'s; record a governance.closureDelegation, or close through the owner',
];

function stopped(
  outcome: ClosureTurnOutcome,
  lines: readonly string[],
  request: ClosureRequest | null,
  problems: readonly string[],
): ClosureTurnResult {
  return {
    outcome,
    decision: null,
    answered: null,
    problems,
    lines,
    request,
    ledgerEntry: null,
    ownerChoices: null,
    unavailabilityCause: null,
    providerResponseId: null,
  };
}

/**
 * The authority could not be reached, for whatever reason.
 *
 * ONE EXIT FOR EVERY CAUSE, exactly as on the technical route: no transport, unreachable,
 * spend-limited, credential unresolved, reply unusable. They differ in the reason text and in nothing
 * else, because the decision they lead to is the same one and it is the owner's.
 */
function unavailable(
  lines: readonly string[],
  request: ClosureRequest | null,
  cause: GatekeeperUnavailabilityCause,
  reasons: readonly string[],
  ledgerEntry: LedgerEntry | null = null,
): ClosureTurnResult {
  return {
    outcome: 'UNAVAILABLE',
    decision: null,
    answered: null,
    problems: reasons,
    lines: [
      ...lines,
      'the closure authority could not be reached, so this phase is not closed and no decision was written',
      ...reasons,
      `owner choices: ${GATEKEEPER_UNAVAILABLE_OWNER_CHOICES.join('  |  ')}`,
    ],
    request,
    ledgerEntry,
    ownerChoices: GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
    unavailabilityCause: cause,
    providerResponseId: null,
  };
}

/**
 * Ask the closure authority whether this phase closes, and return what to do next.
 *
 * Pure apart from the injected HTTP, broker, credential and ledger ports, so every path — including
 * the failure paths that matter most — is exercised with no network, no key and no repository.
 */
export function takeClosureTurn(input: ClosureTurnInput, deps: ClosureTurnDeps): ClosureTurnResult {
  const lines: string[] = [];

  // 1. IDENTIFY THE REQUEST DETERMINISTICALLY — through the one derivation both modes share.
  const request = formClosureRequest(input);
  lines.push(`closure request ${request.requestId} (${CLOSURE_ASK}) for ${input.phaseId} at ${input.subjectHead.slice(0, 7)}`);

  // A CLOSURE QUESTION WITH NO AUTHORITY TO ASK IS NOT ASKED. Without a delegate every answer would
  // be refused by `checkClosureResponse` anyway — this simply refuses before spending to find out.
  if (input.expectedDecider.trim() === '') {
    return stopped('NOT_SENT', lines, request, NO_DELEGATE);
  }

  // 2. ISOLATION BEFORE TRANSPORT.
  if (deps.transport !== null) {
    const bindingProblems = checkThreadBinding(deps.threadBinding, {
      projectId: input.projectId,
      repositoryRoot: input.repositoryRoot,
      transportId: deps.transport.transportId,
    });
    if (bindingProblems.length > 0) {
      return stopped('NOT_SENT', lines, request, [
        'the governance thread for this project could not be established, so nothing was sent',
        ...bindingProblems,
      ]);
    }
  }

  const selection = selectGatekeeperTransport(
    deps.transport,
    deps.availability,
    deps.rehearsalOnly === true ? { rehearsalOnly: true } : {},
  );
  if (selection.outcome === 'UNAVAILABLE') {
    return unavailable(lines, request, selection.cause, selection.reasons);
  }
  const transport = selection.transport;

  // UNATTENDED MEANS HOST-ATTESTED, OR NOTHING. Checked before any price is computed or any estimate
  // reserved, so a project whose Host closure route is not composed spends and records nothing — and in
  // this mode nothing below can reach the in-process provider call.
  const hostClosure = deps.mode === 'unattended' ? deps.hostReview : undefined;
  if (deps.mode === 'unattended' && hostClosure === undefined) {
    return unavailable(lines, request, 'TRANSPORT_NOT_CONFIGURED', [
      'this project is in UNATTENDED gatekeeper mode, whose closure answers come only through the ProjectOS ' +
        'Host attestation route, and no Host closure review route is composed',
      'no provider was called and no other route was tried: unattended mode never falls back to an ' +
        'in-process provider call, to an interactive answer, or to the implementer',
    ]);
  }

  const model = modelForAsk(CLOSURE_ASK, deps.modelPolicy);
  const rate = deps.rateCards[model];
  if (rate === undefined) {
    return stopped('NOT_SENT', lines, request, [
      `no rate card is configured for model '${model}', so the cost of this call cannot be established`,
      'a call whose price is unknown is not made',
    ]);
  }
  lines.push(`tier ${selectTier(CLOSURE_ASK)} -> model ${model}`);

  // 3. A CALL THAT CANNOT HAPPEN IS NOT PAID FOR, AND ITS RESERVATION IS RELEASED.
  //
  // The same ordering C11-W2-F8 established on the technical route, and for the same reason: asking
  // the installation's committed policy BEFORE admission means no estimate is ever reserved for a
  // call that provably cannot be made, and it is the only moment a reservation left by an earlier
  // run can be released.
  const policy = deps.broker?.installationAllows?.();
  if (policy !== undefined && !policy.allowed) {
    deps.releaseUndispatched?.(request.requestId);
    return unavailable(lines, request, 'TRANSPORT_NOT_APPROVED', [
      'this installation does not authorise the governed project to spend its credential, so no closure ' +
        'request was made',
      ...policy.reasons,
    ]);
  }

  // 4. BUDGET, AGAINST THE WHOLE REQUEST AND THE LIMIT ACTUALLY ON THE WIRE.
  //
  // This priced `input.evidenceText` alone, which is not what the provider bills. `previous_response_id`
  // with `store: true` makes it replay the entire stored conversation as fresh input — measured at
  // 21.9x the reservation on one real call, growing without limit. The body is therefore built first
  // and priced by its own bytes, and anything the provider will replay is bounded or the call is
  // refused. Same ruling as the technical route: the governed closure question is STATELESS, because
  // it is bound to an exact subject and carries its own complete evidence.
  const continuation = {
    previousResponseId: null as string | null,
    lastBilledTurn: lastBilledUsage(deps.ledger),
  };
  const requestBody = buildClosureResponsesBody(request, input.evidenceText, {
    model,
    credentialRef: transport.credentialRef ?? '',
    previousResponseId: continuation.previousResponseId,
  });
  const carried = carriedContextTokens({
    continuesStoredConversation: continuation.previousResponseId !== null,
    lastBilledTurn: continuation.lastBilledTurn,
  });
  if (carried === null) {
    return stopped('NOT_SENT', lines, request, [
      'this call would continue a stored provider conversation whose replayed size ProjectOS has no ' +
        'billing record to bound, so its cost cannot be established',
      'a call whose price is unknown is not made',
    ]);
  }
  // A RESERVATION THAT CANNOT BE COMPUTED IS A REFUSAL, NOT A CRASH — see the same guard on the
  // technical route. `reservationInputTokens` throws rather than ever returning zero, and a throw at
  // a dispatch site would take the process down instead of refusing one call.
  const reservedInput = reservationOrNull({
    requestBytes: utf8ByteLength(requestBody),
    carriedContextTokens: carried,
  });
  if (reservedInput === null) {
    return stopped('NOT_SENT', lines, request, [
      'this request could not be priced, so it was not made',
      'a call whose price is unknown is not made',
    ]);
  }
  const estimate = estimateCostMicroUsd(
    { inputTokens: reservedInput, outputTokens: GATEKEEPER_OUTPUT_TOKEN_LIMIT },
    rate,
  );
  const totals = summariseLedger(deps.ledger, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    month: input.at.slice(0, 7),
  });
  const spend =
    deps.admitSpend === undefined
      ? authoriseRequestSpend(estimate, totals, deps.budget)
      : deps.admitSpend({
          requestId: request.requestId,
          projectId: input.projectId,
          phaseId: input.phaseId,
          model,
          estimateMicroUsd: estimate,
          at: input.at,
        });
  lines.push(
    `budget ${evaluateBudget(totals, deps.budget).status}: month ${totals.monthMicroUsd} micro-USD, this call ~${estimate}`,
  );
  if (!spend.allowed) {
    return stopped('NOT_SENT', lines, request, [
      'the ProjectOS spend limit refused this closure call before it was made',
      ...spend.reasons,
    ]);
  }

  // 5. THE CALL. In unattended mode it goes to the Host and nowhere else.
  const hosted =
    hostClosure?.reviewClosure({
      request,
      requestDigest: closureRequestDigest(request),
      correlation: hostCorrelationFor(request.requestId),
      body: requestBody,
    }) ?? null;
  const attestation: HostAttestationSummary | null = hosted !== null && hosted.kind === 'attested' ? hosted.attestation : null;
  const outcome =
    hosted !== null
      ? closureFromHost(hosted)
      : deps.rehearsalOnly === true && deps.rehearsalReviewer !== undefined
      ? deps.rehearsalReviewer(request, input.evidenceText)
      : submitClosureRequest(
          request,
          input.evidenceText,
          {
            model,
            credentialRef: transport.credentialRef ?? '',
            // The same value the reservation was priced against; see the ruling above.
            previousResponseId: continuation.previousResponseId,
            ...(deps.broker === undefined
              ? {}
              : {
                  broker: {
                    transport: deps.broker.transport,
                    governedRoot: deps.broker.governedRoot,
                    ...(deps.broker.installationAllows === undefined
                      ? {}
                      : { installationAllows: deps.broker.installationAllows }),
                    projectId: input.projectId,
                    phaseId: input.phaseId,
                  },
                }),
          },
          deps.resolver,
          deps.http,
        );

  if (outcome.kind === 'unavailable') {
    // THE RESERVATION MUST NOT OUTLIVE THE CALL IT WAS FOR. Admission wrote a provisional entry; no
    // answer came back, so it is closed out here — released when the cause proves nothing was
    // dispatched, retained and marked otherwise.
    deps.resolveSpend?.(
      { requestId: request.requestId, projectId: input.projectId, phaseId: input.phaseId },
      outcome.cause,
      outcome.providerDispatched,
    );
    return unavailable(lines, request, outcome.cause, outcome.reasons);
  }

  const entry = recordCall({
    requestId: request.requestId,
    projectId: input.projectId,
    phaseId: input.phaseId,
    usage: outcome.usage,
    rate,
    at: input.at,
  });
  // WHAT THIS LINE MAY CLAIM. It said "recorded", and on this route nothing in the governed project
  // records it — the caller deliberately supplies no ledger ports, because a write here would dirty
  // the tree at the moment G4-13 is re-evaluated. A turn that reports a durable write it did not
  // make is the same class of untruth this programme has corrected twice before, so it states the
  // COST and leaves "where it was recorded" to the composition that actually knows.
  lines.push(`closure authority answered; this call cost ${entry.costMicroUsd} micro-USD (${entry.requestId})`);

  // THE BILL STAYS AS REPORTED. This only asks whether the provider stayed inside the limit the
  // request carried; a call that generated more than it was permitted to is not a normally bounded
  // decision, so it joins the problems and stops being treated as one.
  const anomaly = gatekeeperOutputAnomaly(outcome.usage.outputTokens);
  if (anomaly !== null) lines.push(anomaly);

  // 6. CHECK THE ANSWER BEFORE ANYTHING IS WRITTEN.
  const record: ClosureResponseRecord = outcome.record;
  const checked = checkClosureResponse(record, closureExpectations(input, request, deps.consumedDecisionIds));
  // UNATTENDED: the Host's attestation must vouch for THIS answer, or the answer is not written.
  const attestationProblems =
    deps.mode === 'unattended' ? checkHostClosureAttestation(attestation, { requestId: request.requestId, record }) : [];
  const checkedWithAnomaly = anomaly === null ? checked : [anomaly, ...checked];
  const problems = [...checkedWithAnomaly, ...attestationProblems];
  const answered = typeof record.decision === 'string' ? record.decision : null;
  // The route's own statement of how this answer was obtained. Never read from the answer.
  const stamp: DecisionProvenanceStamp | undefined =
    deps.mode === 'unattended' && attestation !== null && typeof attestation.attestationId === 'string'
      ? { kind: 'HostIndependentProviderAttestation', hostAttestationId: attestation.attestationId }
      : undefined;
  const provenance =
    stamp === undefined
      ? {}
      : {
          provenance: stamp.kind,
          ...(stamp.hostAttestationId === undefined ? {} : { hostAttestationId: stamp.hostAttestationId }),
        };

  if (problems.length > 0) {
    return {
      outcome: 'ANSWER_REFUSED',
      decision: null,
      answered,
      problems,
      lines: [...lines, 'the closure answer did not pass its checks, so NOTHING was written'],
      request,
      ledgerEntry: entry,
      ownerChoices: null,
      unavailabilityCause: null,
      providerResponseId: outcome.providerResponseId,
    };
  }

  // `do-not-close` and `awaiting-owner` write nothing. A closure decision file that says "not closed"
  // would be an artefact whose absence and whose presence both have to be interpreted; there is only
  // ever a record when there is a decision to close.
  if (answered !== 'close') {
    return {
      outcome: 'DECIDED_NOT_CLOSE',
      decision: null,
      answered,
      problems: [],
      lines: [...lines, `the closure authority answered '${answered}', so no closure decision was written`],
      request,
      ledgerEntry: entry,
      ownerChoices: null,
      unavailabilityCause: null,
      providerResponseId: outcome.providerResponseId,
      ...provenance,
    };
  }

  return {
    outcome: 'DECIDED_CLOSE',
    // BUILT FROM THE ANSWER'S OWN VALUES. Nothing is stamped, substituted or paraphrased — see
    // `closureDecisionRecordFrom`. This is a record to write; it is not authority and cannot become
    // authority without the owner's commit.
    decision: closureDecisionRecordFrom(record),
    answered,
    problems: [],
    lines: [...lines, `the closure authority decided to close ${input.phaseId} at ${input.subjectHead.slice(0, 7)}`],
    request,
    ledgerEntry: entry,
    ownerChoices: null,
    unavailabilityCause: null,
    providerResponseId: outcome.providerResponseId,
    ...provenance,
  };
}

/** The Host's closure answer in the shape the rest of the turn already judges. The attestation is kept apart. */
function closureFromHost(hosted: HostClosureReviewOutcome): ClosureTransportOutcome {
  if (hosted.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      cause: hosted.cause,
      reasons: hosted.reasons,
      spendLimited: hosted.cause === 'PROVIDER_SPEND_LIMITED',
      ...(hosted.providerDispatched === undefined ? {} : { providerDispatched: hosted.providerDispatched }),
    };
  }
  const responseId = hosted.attestation.providerResponseId;
  return {
    kind: 'response',
    record: hosted.record,
    providerResponseId: typeof responseId === 'string' ? responseId : null,
    usage: hosted.usage,
  };
}

/**
 * The decision id an interactive closure answer must carry. Derived from the request id, so an answer
 * written for one closure question is refused as the answer to any other.
 */
export function interactiveClosureDecisionId(requestId: string): string {
  return `CLDEC-${requestId.replace(/^CLREQ-/, '')}`;
}

function closureHandoff(
  input: ClosureTurnInput,
  request: ClosureRequest,
  requestDigest: string,
  decisionId: string,
): InteractiveClosureHandoff {
  return {
    schemaVersion: INTERACTIVE_HANDOFF_SCHEMA_VERSION,
    handoffKind: 'interactive-closure-request',
    instructions: [
      'Give this closure request, including evidenceText, to the ChatGPT closure authority.',
      'Its answer is the decisionTemplate with decision, note and decidedAt filled in, and every other field unchanged.',
      `decision must be one of: ${CLOSURE_RESPONSE_DECISIONS.join(', ')}.`,
      "ownerAcceptedFindings stays an empty list: accepting a residual HIGH is the owner's act, never the closure authority's.",
      'A "close" answer closes nothing by itself: ProjectOS writes it for the owner to read and commit.',
      'Save the answer as JSON at the decision path ProjectOS reported while the request is still waiting.',
    ],
    requestId: request.requestId,
    request,
    requestDigest,
    decisionTemplate: {
      schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION,
      decisionId,
      projectId: request.projectId,
      phaseId: request.phaseId,
      scope: request.scope,
      decidedBy: input.expectedDecider,
      evidenceSubjectHead: input.subjectHead,
      requestDigest,
      decision: null,
      note: null,
      decidedAt: null,
      ownerAcceptedFindings: [],
    },
    evidenceText: input.evidenceText,
  };
}

/**
 * Ask the ChatGPT closure authority through the owner, and judge its answer — the INTERACTIVE closure.
 *
 * THE SAME QUESTION AND THE SAME CONTRACT AS THE UNATTENDED TURN. The request comes from
 * `formClosureRequest` and the answer is judged by `checkClosureResponse` against the same runtime
 * expectations; only the acquisition differs, and it is the same port a stopped loop uses. Nothing is
 * priced, reserved or sent to any provider.
 *
 * AND IT PRODUCES NO AUTHORITY, exactly as the unattended turn does not: a `DECIDED_CLOSE` result is a
 * record to write for the OWNER to read and commit. The owner's commit, `checkClosureDecision` and G4
 * still stand between it and a closed phase.
 */
export function takeInteractiveClosureTurn(input: ClosureTurnInput, deps: InteractiveClosureDeps): ClosureTurnResult {
  const request = formClosureRequest(input);
  const lines: string[] = [
    `interactive closure request ${request.requestId} (${CLOSURE_ASK}) for ${input.phaseId} at ${input.subjectHead.slice(0, 7)}`,
  ];
  if (input.expectedDecider.trim() === '') return stopped('NOT_SENT', lines, request, NO_DELEGATE);

  const requestDigest = closureRequestDigest(request);
  const decisionId = interactiveClosureDecisionId(request.requestId);
  const answer = awaitInteractiveAnswer(
    deps.interactive,
    closureHandoff(input, request, requestDigest, decisionId),
    'this closure',
    `projectos closure request --id ${input.phaseId} --execute --gate-wait-minutes <n>`,
  );
  if (answer.kind === 'stop') {
    const outcome: ClosureTurnOutcome =
      answer.cause === 'waiting' ? 'AWAITING_GATEKEEPER' : answer.cause === 'unreadable' ? 'ANSWER_REFUSED' : 'NOT_SENT';
    return stopped(outcome, answer.line === null ? lines : [...lines, answer.line], request, answer.reasons);
  }

  // A PROVENANCE CLAIM, THE WRONG DECISION ID, OR ANYTHING THE CLOSURE CONTRACT REFUSES.
  const record = answer.record as unknown as ClosureResponseRecord;
  const problems: string[] = [
    ...provenanceClaimsIn(record).map(
      (field) =>
        `the supplied closure answer carries '${field}'; how an answer was obtained is recorded by the route ` +
        'that received it, and an interactive answer can never be presented as Host-attested evidence',
    ),
    ...(record.decisionId === decisionId
      ? []
      : [`the supplied closure answer is ${JSON.stringify(record.decisionId)}, but this question's decision is '${decisionId}'`]),
    ...checkClosureResponse(record, closureExpectations(input, request, deps.consumedDecisionIds)),
  ];
  const answered = typeof record.decision === 'string' ? record.decision : null;
  if (problems.length > 0) {
    return {
      ...stopped('ANSWER_REFUSED', [...lines, 'the interactive closure answer did not pass its checks, so NOTHING was written'], request, problems),
      answered,
    };
  }

  // SPENT BEFORE IT IS WRITTEN FOR THE OWNER, so one answer can never be presented twice.
  const spent = deps.interactive.consumeDecision(request.requestId);
  if (spent !== 'consumed') {
    return stopped('ANSWER_REFUSED', lines, request, [`the interactive closure answer was not used: ${spent}`]);
  }
  const accepted = { answered, request, ledgerEntry: null, ownerChoices: null, unavailabilityCause: null, providerResponseId: null, problems: [], provenance: 'InteractiveGatekeeperDecision' as const };
  if (answered !== 'close') {
    return {
      ...accepted,
      outcome: 'DECIDED_NOT_CLOSE',
      decision: null,
      lines: [...lines, `the closure authority answered '${answered}', so no closure decision was written`],
    };
  }
  return {
    ...accepted,
    outcome: 'DECIDED_CLOSE',
    decision: closureDecisionRecordFrom(record),
    lines: [
      ...lines,
      `the closure authority decided to close ${input.phaseId} at ${input.subjectHead.slice(0, 7)} (InteractiveGatekeeperDecision)`,
    ],
  };
}
