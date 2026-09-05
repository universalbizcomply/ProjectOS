/**
 * One governance turn: a stopped loop asks the reviewer, and acts on the answer or refuses to.
 *
 * THIS IS THE PIECE THAT MAKES THE CONTRACTS REACHABLE. Before it, the contracts existed and nothing
 * called them — the loop ended at its stop and the owner carried it onward by hand. This module is
 * the sequence between those two points, and it is deliberately a sequence of refusals with one call
 * in the middle, the same shape as the loop it serves.
 *
 * THE ORDER IS THE SAFETY ARGUMENT, so it is written out:
 *
 *   1. ROUTE FIRST. If the stop is the owner's, nothing else happens — no request is built, no
 *      transport is selected, no money is spent asking a question nobody may answer.
 *   2. IDENTIFY THE REQUEST DETERMINISTICALLY. The id is derived from what is being asked about, not
 *      allocated, so a restart mid-objective re-derives the SAME id. That single choice is what makes
 *      duplicate protection work at every layer at once: the ledger counts the call once, and a
 *      decision already acted on is refused as a replay instead of being applied twice.
 *   3. ISOLATION BEFORE TRANSPORT. A thread binding that belongs to another project or another
 *      checkout stops the turn before anything is sent, because the damage from sending is done at
 *      the moment of sending.
 *   4. BUDGET BEFORE THE CALL. Checked against the ESTIMATE. A limit tested after the money is gone
 *      is a report, not a limit.
 *   5. ONLY THEN THE CALL. And any failure of it — unreachable, spend-limited, malformed, unresolved
 *      credential — becomes the owner's explicit three-way choice. Never a second transport.
 *   6. CHECK THE ANSWER BEFORE APPLYING IT. `checkGatekeeperDecision` judges it against expectations
 *      the runtime established, and `applyVerdictToStop` receives the checked record together with
 *      that judgement, so a verdict cannot be applied without it.
 *
 * THE PROTECTED SET IS DERIVED HERE, NOT RECEIVED. Between routing and the request, the phase's
 * declared owner gates are unioned with the constitutional `ALWAYS_OWNER_ONLY` floor, and that one
 * set is both what the reviewer is told and what its answer is judged against. Before this, the turn
 * used `brief.phase.requiredOwnerGates` verbatim and the floor was applied only in degraded mode and
 * `reconcile` — so a phase that forgot to declare `push` made `push` grantable, and no floor stood in
 * the way. A protection that exists but does not cover the live path is not a protection.
 *
 * WHAT THIS MODULE NEVER DOES: decide anything itself, retry a transport, hold a secret, or turn an
 * absent answer into a permissive one.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 * Owner-only floor added in PROJECTOS-LIVE-GATE-OWNER-FLOOR-HARDENING1A.
 */
import { createHash } from 'node:crypto';
import {
  GATEKEEPER_REQUEST_SCHEMA_VERSION,
  GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
  authoriseRequestSpend,
  checkGatekeeperDecision,
  checkThreadBinding,
  enforcedOwnerOnlyActions,
  estimateCostMicroUsd,
  type TechnicalDelegationCondition,
  estimateInputTokensFromText,
  evaluateBudget,
  gatekeeperRequestDigest,
  modelForAsk,
  recordCall,
  selectGatekeeperTransport,
  selectTier,
  summariseLedger,
  type BudgetPolicy,
  type GatekeeperDecisionRecord,
  type GatekeeperRequest,
  type GatekeeperTransportDescriptor,
  type GovernanceThreadBinding,
  type LedgerEntry,
  type ModelPolicy,
  type RateCard,
  type TransportAvailability,
  type GatekeeperUnavailabilityCause,
  type CheckedTechnicalDecision,
} from '@projectos/core';
import type { CredentialResolver } from './credentialResolver.js';
import { applyVerdictToStop, routeStop, type NextLoopAction } from './gatekeeperRouting.js';
import type { BrokeredTransport } from './transports/brokeredHttpPort.js';
import {
  submitToOpenAi,
  GATEKEEPER_OUTPUT_TOKEN_LIMIT,
  gatekeeperOutputAnomaly,
  type HttpPort,
  type TransportOutcome,
} from './transports/openaiResponses.js';
import type { LoopStop, LoopStopCode } from './outcome.js';

/**
 * The question each stop asks, in the vocabulary the model policy prices.
 *
 * A SEPARATE MAPPING FROM THE ROUTING TABLE, because they answer different questions: routing decides
 * WHO may answer, this decides WHAT is being asked and therefore which model reviews it. Keeping them
 * apart means a change to pricing cannot quietly change who is allowed to decide.
 */
export const STOP_ASKS: { readonly [K in LoopStopCode]: string } = {
  UNRESOLVED_CRITICAL_OR_HIGH: 'security-review',
  // Named for completeness because the type demands it. It is never dispatched: the routing table
  // sends this stop to the owner with no answerable verdict, so no request is ever built from it.
  DOCTOR_PREFLIGHT_FAILED: 'doctor-preflight-failed',
  CORRECTION_EXHAUSTED: 'correction-exhausted',
  REVIEW_OUTSTANDING: 'evidence-review',
  WORKER_REFUSED: 'worker-refusal',
  WORKER_TIMED_OUT: 'worker-timeout',
  EFFECTS_NOT_ATTESTED: 'effects-unattested',
  PROTECTED_EFFECT: 'ambiguity',
  OWNER_GATE: 'ambiguity',
  SCOPE_DECISION: 'ambiguity',
  // THE EXISTING ASK, NOT A NEW ONE. What the reviewer is shown is the same evidence pack a
  // `REVIEW_OUTSTANDING` question carries — checks, findings, effects and the candidate — and it is
  // priced by the same model. A separate ask would have added a pricing entry and a vocabulary term
  // for a question the corpus already describes.
  CONTINUATION_READY: 'evidence-review',
};

export interface GatekeeperTurnInput {
  readonly stop: LoopStop;
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly repositoryRoot: string;
  /** The evidence the reviewer reads. Its digest binds the request. */
  readonly evidenceText: string;
  /**
   * The owner-only actions THIS PHASE declares, from the approved plan's `requiredOwnerGates`.
   *
   * NOT the set that is enforced. The constitutional floor is added to it inside the turn — see
   * `enforcedOwnerOnlyActions` at the top of `takeGatekeeperTurn` — so a caller cannot narrow the
   * protected set by passing a short list, or an empty one.
   */
  readonly ownerOnlyActions: readonly string[];
  /**
   * Proof that this project's committed delegation grants a technical continuation, when it does.
   *
   * ABSENT IS THE DEFAULT AND THE SAFE ANSWER. Without it the full constitutional floor applies and
   * this turn behaves exactly as it did before the owner's conditional decision — which is what keeps
   * every caller that has not been told about the split restrictive rather than quietly relaxed.
   *
   * IT IS A CAPABILITY TOKEN, NOT A BOOLEAN. `TechnicalDelegationCondition` is branded with a symbol
   * private to core, so it cannot be written by hand; the only production source is
   * `resolveTechnicalDelegation`, which reads the owner's COMMITTED record through git. It is passed
   * in rather than resolved here because this module's permitted dependencies deliberately exclude
   * everything that touches disk or git.
   *
   * AND IT AUTHORISES NOTHING BY ITSELF. All it does is stop `commit` and `push` being struck out of
   * the request before the reviewer has seen them. Whether either may then happen is still the live
   * decision's to say, and after that the executor's whole conjunction.
   */
  readonly technicalDelegation?: TechnicalDelegationCondition | null;
  /** Who the approved plan says reviews. Never a caller's claim. */
  readonly expectedDecider: string;
  readonly at: string;
}

export interface GatekeeperTurnDeps {
  readonly transport: GatekeeperTransportDescriptor | null;
  readonly availability: TransportAvailability;
  readonly resolver: CredentialResolver;
  /** The trusted installation-side transport, when composed. See `submitToOpenAi`. */
  readonly broker?: {
    readonly transport: BrokeredTransport;
    readonly governedRoot: string;
    /** The installation's committed policy on spending for this project. Asked before the broker
     *  is invoked, so a refusal is knowably a call that was never made. */
    readonly installationAllows?: () => { readonly allowed: boolean; readonly reasons: readonly string[] };
  };
  readonly http: HttpPort;
  readonly modelPolicy: ModelPolicy;
  readonly rateCards: Readonly<Record<string, RateCard>>;
  readonly budget: BudgetPolicy;
  /** Everything spent so far. Read, never written, by this module. */
  readonly ledger: readonly LedgerEntry[];
  /**
   * Serialised budget admission. Decides and records the estimate under one lock, so concurrent
   * processes cannot both spend the same remaining allowance. Absent in tests and rehearsals, where
   * there is no durable ledger and nothing to race against.
   */
  /**
   * Close out the reservation `admitSpend` made, when the call produced no answer.
   *
   * A PORT, like `admitSpend`, because this file decides nothing about durability: the entrypoint
   * owns the ledger. Optional so a test or a rehearsal that never reserved need not supply one.
   */
  /** Release a reservation for a call this attempt is refusing before any dispatch is possible. */
  readonly releaseUndispatched?: (requestId: string) => void;
  readonly resolveSpend?: (
    request: { readonly requestId: string; readonly projectId: string; readonly phaseId: string },
    cause: string,
  ) => void;

  /**
   * Keep an ACCEPTED decision as durable evidence. A PORT, for the same reason as the two above:
   * this file owns no durability.
   *
   * Called only after the decision checker accepted the record. It grants nothing and is never read
   * back for authority — returning a word describing what was kept, so a conflict or a failure is
   * visible in the run's own lines rather than silent. Optional, so a test or rehearsal with no
   * governed root need not supply one.
   */
  readonly recordDecisionEvidence?: (
    record: GatekeeperDecisionRecord,
  ) => 'written' | 'already-recorded' | string;

  readonly admitSpend?: (request: {
    readonly requestId: string;
    readonly projectId: string;
    readonly phaseId: string;
    readonly model: string;
    readonly estimateMicroUsd: number;
    readonly at: string;
  }) => { readonly allowed: boolean; readonly reasons: readonly string[] };
  readonly threadBinding: GovernanceThreadBinding | null;
  /**
   * The provider's id for the previous turn in this project's governance conversation.
   *
   * SEPARATE FROM THE THREAD BINDING, and the separation was learned the hard way: the first live
   * call sent the binding's `providerThreadId` as `previous_response_id` and OpenAI answered
   * HTTP 400, because ProjectOS's own record of which conversation this is had been mistaken for the
   * provider's record of what was said last. They are different facts. The binding proves ISOLATION —
   * that this project owns this conversation — and exists before any call has been made. This
   * continues the CONVERSATION and can only exist after one.
   */
  readonly previousResponseId?: string | null;
  /** Who the configured transport claims to be. Stamped as the decision's provenance. */
  readonly transportDecider: string;
  readonly consumedDecisionIds: readonly string[];
  /** Set only for a local rehearsal route; see `gatekeeperTransport.ts`. */
  readonly rehearsalOnly?: boolean;
  /** A rehearsal reviewer, used INSTEAD of the network when the route is a rehearsal one. */
  readonly rehearsalReviewer?: (request: GatekeeperRequest, evidenceText: string) => TransportOutcome;
}

export interface GatekeeperTurnResult {
  readonly action: NextLoopAction;
  /** Human-readable trace for the CLI. Never contains a credential. */
  readonly lines: readonly string[];
  /** The request that was formed, whether or not it was sent. */
  readonly request: GatekeeperRequest | null;
  /** A cost entry to append, when a call was actually made. */
  readonly ledgerEntry: LedgerEntry | null;
  /** Present when the turn ended in the owner's three-way choice. */
  readonly ownerChoices: readonly string[] | null;
  /**
   * Why the gatekeeper could not answer, as a closed value — null whenever it did answer, or
   * whenever the stop was never the reviewer's to take. This is what a degraded grant's outage
   * identity binds; the human-readable reasons beside it never are.
   */
  readonly unavailabilityCause: GatekeeperUnavailabilityCause | null;
  /** The provider's id for this turn, to be carried into the next one. Null when nothing was sent. */
  readonly providerResponseId: string | null;
  /**
   * The decision AS CHECKED, when one was received and `checkGatekeeperDecision` accepted it.
   *
   * NULL WHENEVER THERE IS NOT ONE — no request made, transport unavailable, or the record refused.
   * It carries the check's own `problems` (empty, by construction of the branch that sets it) so a
   * consumer cannot use it without also receiving the evidence that it was checked; that is the same
   * structural device `applyVerdictToStop` uses, for the same reason.
   *
   * IT IS NOT AUTHORITY BY ITSELF. It is one limb of the technical-continuation conjunction, which
   * also requires a valid committed delegation, the action being in `allowedActions`, the action
   * being in the closed vocabulary, and every binding still holding. Surfaced here because the runner
   * is where those other limbs live — not because holding it means anything.
   */
  readonly checkedDecision: CheckedTechnicalDecision | null;
}

function ownerAction(reasons: readonly string[]): NextLoopAction {
  return { kind: 'owner', reasons };
}

/**
 * The request id for this exact question.
 *
 * DERIVED, NOT ALLOCATED. A counter or a timestamp would produce a different id after a restart, and
 * the same question would then be asked — and paid for — twice, with two decisions that each look
 * fresh. Hashing what the question is ABOUT makes the identity of the question survive the process
 * that asked it. Changing any part of the evidence changes the id, which is correct: that is a
 * different question.
 */
export function deriveRequestId(input: {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly ask: string;
  readonly evidenceDigest: string;
}): string {
  const canonical = JSON.stringify([
    input.projectId,
    input.phaseId,
    input.subjectCommit,
    input.ask,
    input.evidenceDigest,
  ]);
  return `GKREQ-${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24)}`;
}

/** The digest of the evidence as presented. Binds the request to what the reviewer actually read. */
export function evidenceDigest(evidenceText: string): string {
  return `sha256:${createHash('sha256').update(evidenceText, 'utf8').digest('hex')}`;
}

/**
 * Ask the gatekeeper about a stopped loop, and return what the loop should do next.
 *
 * Pure apart from the injected HTTP and credential ports, so the whole turn — including the failure
 * paths that matter most — is testable with no network, no key and no repository.
 */
export function takeGatekeeperTurn(input: GatekeeperTurnInput, deps: GatekeeperTurnDeps): GatekeeperTurnResult {
  const lines: string[] = [];

  // 1. ROUTE FIRST.
  const route = routeStop(input.stop);
  if (route.audience === 'owner') {
    return {
      action: applyVerdictToStop(input.stop, { decision: undefined, problems: ['not asked'] }),
      lines: [`stop ${input.stop.code} is the owner's; no gatekeeper request was made`],
      request: null,
      ledgerEntry: null,
      ownerChoices: null,
      unavailabilityCause: null,
      providerResponseId: null,
      checkedDecision: null,
    };
  }

  // THE OWNER-ONLY SET IS THE PHASE'S DECLARATION PLUS THE CONSTITUTIONAL FLOOR.
  //
  // DERIVED HERE, NOT SUPPLIED. `ALWAYS_OWNER_ONLY` was written as "a floor, not the list" — actions
  // whose whole purpose is that a human decided, refused regardless of what a phase remembered to
  // declare. It was applied in degraded mode and in `reconcile`, and NOT on this path: the live turn
  // took `brief.phase.requiredOwnerGates` verbatim, so the approved plan was the only thing standing
  // between a reviewer's decision and a protected action. A phase that omitted `push` from its gates
  // made `push` grantable by a model, and the floor was untouched the whole time. Applying it inside
  // the transition rather than at the call site is what makes it structural: there is no argument
  // through which a caller — present or future — can narrow the protected set.
  //
  // ONE DERIVATION, USED TWICE. The reviewer is TOLD this set and the answer is JUDGED against it.
  // Telling it a shorter list and then refusing what it proposed in good faith would be a refusal the
  // reviewer could not have avoided, and two separately-computed sets could drift into exactly that.
  //
  // IT ONLY EVER WIDENS RELATIVE TO THE PHASE'S DECLARATION. `enforcedOwnerOnlyActions` is a
  // deduplicated union, so a phase gate outside the floor is still enforced and a phase that restates
  // the floor changes nothing.
  //
  // THE ONE NARROWING, AND IT IS THE OWNER'S. A proven technical delegation omits `commit` and `push`
  // — and only those two — so the reviewer may be asked about an ordinary continuation at all. The
  // condition is a branded token, not a flag, and it is `null` unless a caller genuinely resolved one;
  // `phaseOwnerGates` is still added afterwards, so a plan that declares `commit` keeps it owner-only
  // regardless. Nothing absolute is reachable by this route: production, payments, sends, credentials
  // and closure are in `ABSOLUTE_OWNER_ONLY`, which no argument to that function can subtract from.
  //
  // Added in PROJECTOS-LIVE-GATE-OWNER-FLOOR-HARDENING1A; made conditional in
  // PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A under "APPROVE B6 CONDITIONAL TECHNICAL FLOOR".
  const ownerOnlyActions = enforcedOwnerOnlyActions(input.ownerOnlyActions, input.technicalDelegation ?? null);

  // 2. IDENTIFY THE REQUEST DETERMINISTICALLY.
  const ask = STOP_ASKS[input.stop.code];
  const digest = evidenceDigest(input.evidenceText);
  const request: GatekeeperRequest = {
    schemaVersion: GATEKEEPER_REQUEST_SCHEMA_VERSION,
    requestId: deriveRequestId({
      projectId: input.projectId,
      phaseId: input.phaseId,
      subjectCommit: input.subjectCommit,
      ask,
      evidenceDigest: digest,
    }),
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit: input.subjectCommit,
    ask,
    evidenceDigests: [digest],
    // The ENFORCED set, so the reviewer is told what will actually be refused. Note this is one of
    // the fields `gatekeeperRequestDigest` covers and NOT one `deriveRequestId` covers: the identity
    // of the question is what is being asked about, and the protected set is policy applied to the
    // answer. A restart therefore still re-derives the same id and buys no second call.
    ownerOnlyActions,
  };
  lines.push(`gatekeeper request ${request.requestId} (${ask}) for ${input.stop.code}`);

  // 3. ISOLATION BEFORE TRANSPORT.
  if (deps.transport !== null) {
    const bindingProblems = checkThreadBinding(deps.threadBinding, {
      projectId: input.projectId,
      repositoryRoot: input.repositoryRoot,
      transportId: deps.transport.transportId,
    });
    if (bindingProblems.length > 0) {
      return {
        action: ownerAction([
          `STOPPED (${input.stop.code}): ${input.stop.detail}`,
          'the governance thread for this project could not be established, so nothing was sent',
          ...bindingProblems,
        ]),
        lines,
        request,
        ledgerEntry: null,
        ownerChoices: null,
        unavailabilityCause: null,
        providerResponseId: null,
        checkedDecision: null,
      };
    }
  }

  // 4. TRANSPORT, THEN BUDGET — both before anything is sent.
  const selection = selectGatekeeperTransport(
    deps.transport,
    deps.availability,
    deps.rehearsalOnly === true ? { rehearsalOnly: true } : {},
  );
  if (selection.outcome === 'UNAVAILABLE') {
    return unavailable(input, lines, request, selection.cause, selection.reasons);
  }
  const transport = selection.transport;

  const model = modelForAsk(ask, deps.modelPolicy);
  const rate = deps.rateCards[model];
  if (rate === undefined) {
    return {
      action: ownerAction([
        `STOPPED (${input.stop.code}): ${input.stop.detail}`,
        `no rate card is configured for model '${model}', so the cost of this call cannot be established`,
        'a call whose price is unknown is not made',
      ]),
      lines,
      request,
      ledgerEntry: null,
      ownerChoices: null,
      unavailabilityCause: null,
      providerResponseId: null,
      checkedDecision: null,
    };
  }
  lines.push(`tier ${selectTier(ask)} -> model ${model}`);

  // A CALL THAT CANNOT HAPPEN IS NOT PAID FOR, AND ITS RESERVATION IS RELEASED (C11-W2-F8).
  //
  // The installation's committed allowlist decides whether it will spend on this project at all, and
  // a refusal there is final and pre-dispatch. Asking it BEFORE admission means no estimate is ever
  // reserved for a call that provably cannot be made — and it is also the only moment at which a
  // reservation left by an earlier run can be released, because admission would otherwise refuse the
  // request first and the transport, where classification used to happen, would never be reached.
  // That is what stranded the C11 witness: a retained charge for a call nobody made, behind a gate
  // that could not be satisfied.
  const policy = deps.broker?.installationAllows?.();
  if (policy !== undefined && !policy.allowed) {
    // The narrow release: this attempt is refusing before anything can be dispatched, so the
    // reservation for the identical question is a charge for a call nobody made.
    deps.releaseUndispatched?.(request.requestId);
    return unavailable(input, lines, request, 'TRANSPORT_NOT_APPROVED', [
      'this installation does not authorise the governed project to spend its credential, so no ' +
        'request was made',
      ...policy.reasons,
    ]);
  }

  // The estimate uses the evidence actually being sent, so it is a real bound rather than a nominal one.
  // UTF-8 bytes through the one conservative estimator — not UTF-16 length divided by four.
  const estimatedInput = estimateInputTokensFromText(input.evidenceText);
  const estimate = estimateCostMicroUsd(
    // The number the provider is actually held to, imported rather than repeated: a reservation that
    // does not match the limit on the wire is not a reservation.
    { inputTokens: estimatedInput, outputTokens: GATEKEEPER_OUTPUT_TOKEN_LIMIT },
    rate,
  );
  const totals = summariseLedger(deps.ledger, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    month: input.at.slice(0, 7),
  });
  // ADMISSION, NOT MERELY A CHECK.
  //
  // `deps.ledger` is the snapshot this process took when it started, and a snapshot is exactly what
  // made C17-F1 possible: two runs each read it, each found room under the hard stop, and each paid.
  // When an admission port is supplied it re-reads the ledger under an exclusive lock, decides, and
  // records the estimate before releasing it — so the second run sees the first call already counted.
  // Without a port (unit tests, rehearsals) the original snapshot check still applies, which is
  // correct there: one process, no ledger on disk, nothing to serialise against.
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
  const budgetStatus = evaluateBudget(totals, deps.budget);
  lines.push(`budget ${budgetStatus.status}: month ${totals.monthMicroUsd} micro-USD, this call ~${estimate}`);
  if (!spend.allowed) {
    return {
      action: ownerAction([
        `STOPPED (${input.stop.code}): ${input.stop.detail}`,
        'the ProjectOS spend limit refused this gatekeeper call before it was made',
        ...spend.reasons,
      ]),
      lines,
      request,
      ledgerEntry: null,
      ownerChoices: null,
      unavailabilityCause: null,
      providerResponseId: null,
      checkedDecision: null,
    };
  }

  // 5. THE CALL.
  const outcome =
    deps.rehearsalOnly === true && deps.rehearsalReviewer !== undefined
      ? deps.rehearsalReviewer(request, input.evidenceText)
      : submitToOpenAi(
          request,
          input.evidenceText,
          {
            model,
            decidedBy: deps.transportDecider,
            credentialRef: transport.credentialRef ?? '',
            previousResponseId: deps.previousResponseId ?? null,
            // When the installation composes a trusted transport, the credential is resolved inside
            // it and never in this process.
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
    // THE RESERVATION MUST NOT OUTLIVE THE CALL IT WAS FOR (C11-W2-F6). Admission wrote a provisional
    // entry before this attempt; no answer came back, so it is closed out here — released when the
    // cause proves nothing was dispatched, retained and marked otherwise. Without this the next run
    // was refused as "already in the ledger" BEFORE the gatekeeper was attempted, which withdrew the
    // owner's degraded-mode choice entirely.
    deps.resolveSpend?.(
      { requestId: request.requestId, projectId: input.projectId, phaseId: input.phaseId },
      outcome.cause,
    );
    return unavailable(input, lines, request, outcome.cause, outcome.reasons);
  }

  const entry = recordCall({
    requestId: request.requestId,
    projectId: input.projectId,
    phaseId: input.phaseId,
    usage: outcome.usage,
    rate,
    at: input.at,
  });
  lines.push(`gatekeeper answered; recorded ${entry.costMicroUsd} micro-USD against ${entry.requestId}`);

  // THE BILL IS ALREADY RECORDED ABOVE, AND IT STAYS AS REPORTED. This only asks whether the
  // provider stayed inside the limit the request carried. A call that generated more than it was
  // permitted to is not a normally bounded governance decision, so it joins `problems` and stops
  // being applied as one — it is not clamped, not hidden, and not retried.
  const outputAnomaly = gatekeeperOutputAnomaly(outcome.usage.outputTokens);
  if (outputAnomaly !== null) lines.push(outputAnomaly);

  // 6. CHECK THE ANSWER BEFORE APPLYING IT.
  const checked = checkGatekeeperDecision(outcome.record, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit: input.subjectCommit,
    requestDigest: gatekeeperRequestDigest(request),
    expectedDecider: input.expectedDecider,
    alreadyConsumedDecisionIds: deps.consumedDecisionIds,
    // THE SAME SET THE REQUEST CARRIED — the one derivation above, never `input`'s narrower version.
    // Judging the answer against a smaller list than the reviewer was shown is how a protected action
    // gets granted by a decision that looked, to both sides, entirely well behaved.
    ownerOnlyActions,
  });
  const problems = outputAnomaly === null ? checked : [outputAnomaly, ...checked];

  // 7. WRITE DOWN WHAT WAS DECIDED — AND DO NOT ACT UNTIL THAT SUCCEEDED.
  //
  // The ledger records that a call happened and what it cost. It has never recorded the VERDICT, the
  // grounds, or what the verdict permitted, so once the process ended ProjectOS could no longer say
  // what it acted on. That is an audit gap today and a continuity gap for an autonomous loop.
  //
  // AFTER THE CHECK, NEVER BEFORE: `problems` is empty only when `checkGatekeeperDecision` accepted
  // the record AND the provider stayed inside its output bound, so a refused or malformed answer
  // leaves no accepted-decision record behind to be mistaken for one later.
  //
  // AND BEFORE THE ACTION, NEVER AFTER. Recording used to be best-effort: the verdict was applied
  // whether or not the write landed. That defeated the whole point — an action taken on a decision
  // nothing recorded is exactly the untraceable step this contract exists to prevent, and under an
  // autonomous loop it is a step nobody could later account for. So durable provenance is now a
  // PRECONDITION of acting, and a failed or contradicted write stops the turn and hands it to the
  // owner.
  //
  // A CONTRADICTION IS THE MORE DANGEROUS CASE, not the lesser one: different evidence already
  // stored under this deterministic id means two different answers exist for one question, and the
  // runtime cannot know which one it is about to act on. It refuses rather than guesses, and the
  // stored record is left exactly as it was — the conflicting file is not authority either.
  //
  // A PORT, like `admitSpend` and `resolveSpend`, because this file decides nothing about
  // durability — the entrypoint owns the writing. Writing still changes nothing about AUTHORITY: the
  // verdict is applied from the CHECKED record in this transition, never from anything read back.
  // Successful persistence is a precondition, not a permit.
  //
  // Absent port = no governed root to write into (a rehearsal or a unit test). Production always
  // supplies one; `commands/run.ts` and `commands/reconcile.ts` are the only callers that can.
  if (problems.length === 0 && deps.recordDecisionEvidence !== undefined) {
    const recorded = deps.recordDecisionEvidence(outcome.record);
    if (recorded !== 'written' && recorded !== 'already-recorded') {
      lines.push(`decision evidence could not be recorded: ${recorded}`);
      return {
        action: ownerAction([
          `STOPPED (${input.stop.code}): ${input.stop.detail}`,
          'the gatekeeper decided, and ProjectOS could not durably record that decision — so the ' +
            'decision was NOT acted on',
          `evidence: ${recorded}`,
          'a decision ProjectOS cannot account for afterwards is not one it may act on; resolve the ' +
            'recording problem, then ask again',
        ]),
        lines,
        request,
        ledgerEntry: entry,
        ownerChoices: null,
        unavailabilityCause: null,
        providerResponseId: outcome.providerResponseId,
        checkedDecision: null,
      };
    }
    if (recorded === 'already-recorded') lines.push('decision evidence: already recorded, unchanged');
  }

  const action = applyVerdictToStop(input.stop, {
    decision: outcome.record.decision as string,
    nextClaudeInstruction:
      typeof outcome.record.nextClaudeInstruction === 'string' ? outcome.record.nextClaudeInstruction : null,
    problems,
  });

  return {
    action,
    lines,
    request,
    ledgerEntry: entry,
    ownerChoices: null,
    unavailabilityCause: null,
    providerResponseId: outcome.providerResponseId,
    // ONLY WHEN THE CHECK ACCEPTED IT. `problems` is empty exactly here, so a caller receiving a
    // non-null value is receiving a decision this transition judged usable — and receiving the
    // judgement with it, so it cannot be consumed as though the check had not run.
    checkedDecision:
      problems.length > 0
        ? null
        : {
            problems: [],
            decisionId: String(outcome.record.decisionId ?? ''),
            projectId: String(outcome.record.projectId ?? ''),
            phaseId: String(outcome.record.phaseId ?? ''),
            subjectCommit: String(outcome.record.subjectCommit ?? ''),
            allowedActions: Array.isArray(outcome.record.allowedActions)
              ? outcome.record.allowedActions.map(String)
              : [],
            // Filled by the caller, which is the only party that knows which candidate it showed the
            // reviewer. Left empty here rather than guessed: a digest invented in this module would
            // compare equal to nothing and refuse everything, which looks like a safety property and
            // is actually a bug that hides one.
            reviewedCandidateDigest: '',
          },
  };
}

/**
 * The reviewer could not be reached, for whatever reason.
 *
 * ONE EXIT FOR EVERY CAUSE — no transport configured, unreachable, spend-limited, credential
 * unresolved, reply unusable. They differ in the reason text and in nothing else, because the
 * decision they lead to is the same one and it is the owner's: wait, accept the risk, or stop.
 */
function unavailable(
  input: GatekeeperTurnInput,
  lines: readonly string[],
  request: GatekeeperRequest | null,
  cause: GatekeeperUnavailabilityCause,
  reasons: readonly string[],
): GatekeeperTurnResult {
  return {
    action: ownerAction([
      `STOPPED (${input.stop.code}): ${input.stop.detail}`,
      'the gatekeeper could not be reached, so this run continues only on an explicit decision by the owner',
      ...reasons,
      `owner choices: ${GATEKEEPER_UNAVAILABLE_OWNER_CHOICES.join('  |  ')}`,
    ]),
    lines,
    request,
    ledgerEntry: null,
    ownerChoices: GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
    // THE MATERIAL CAUSE, SEPARATE FROM THE PROSE ABOVE. The reasons are for a person to read and
    // change freely; this is what an outage identity may bind, and it is the ONLY part of this
    // result that may.
    unavailabilityCause: cause,
    providerResponseId: null,
    checkedDecision: null,
  };
}
