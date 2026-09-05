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
} from '@projectos/core';
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
  ) => void;
  readonly threadBinding: GovernanceThreadBinding | null;
  /** Closure decision ids already consumed for this phase, so a replayed answer is refused. */
  readonly consumedDecisionIds: readonly string[];
  /** Set only for a local rehearsal route; see `gatekeeperTransport.ts`. */
  readonly rehearsalOnly?: boolean;
  /** A rehearsal authority, used INSTEAD of the network when the route is a rehearsal one. */
  readonly rehearsalReviewer?: (request: ClosureRequest, evidenceText: string) => ClosureTransportOutcome;
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
}

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

  // 1. IDENTIFY THE REQUEST DETERMINISTICALLY.
  const evidenceDigest = closureEvidenceDigest(input.evidenceText);
  const request: ClosureRequest = {
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
  lines.push(`closure request ${request.requestId} (${CLOSURE_ASK}) for ${input.phaseId} at ${input.subjectHead.slice(0, 7)}`);

  // A CLOSURE QUESTION WITH NO AUTHORITY TO ASK IS NOT ASKED. Without a delegate every answer would
  // be refused by `checkClosureResponse` anyway — this simply refuses before spending to find out.
  if (input.expectedDecider.trim() === '') {
    return stopped('NOT_SENT', lines, request, [
      'the active approved plan records no closure delegate, so there is nobody this project may ask',
      'closure remains the owner\'s; record a governance.closureDelegation, or close through the owner',
    ]);
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

  // 5. THE CALL.
  const outcome =
    deps.rehearsalOnly === true && deps.rehearsalReviewer !== undefined
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
  const checked = checkClosureResponse(record, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    scope: PHASE_CLOSURE_SCOPE,
    expectedDecider: input.expectedDecider,
    evidenceSubjectHead: input.subjectHead,
    requestDigest: closureRequestDigest(request),
    alreadyConsumedDecisionIds: deps.consumedDecisionIds,
    owner: input.owner,
    unresolvedHighIds: input.unresolvedHighIds,
  });
  const problems = anomaly === null ? checked : [anomaly, ...checked];
  const answered = typeof record.decision === 'string' ? record.decision : null;

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
  };
}
