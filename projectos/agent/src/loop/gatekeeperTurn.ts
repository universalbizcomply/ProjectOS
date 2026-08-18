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
 * WHAT THIS MODULE NEVER DOES: decide anything itself, retry a transport, hold a secret, or turn an
 * absent answer into a permissive one.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import { createHash } from 'node:crypto';
import {
  GATEKEEPER_REQUEST_SCHEMA_VERSION,
  GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
  authoriseRequestSpend,
  checkGatekeeperDecision,
  checkThreadBinding,
  estimateCostMicroUsd,
  evaluateBudget,
  gatekeeperRequestDigest,
  modelForAsk,
  recordCall,
  selectGatekeeperTransport,
  selectTier,
  summariseLedger,
  type BudgetPolicy,
  type GatekeeperRequest,
  type GatekeeperTransportDescriptor,
  type GovernanceThreadBinding,
  type LedgerEntry,
  type ModelPolicy,
  type RateCard,
  type TransportAvailability,
} from '@projectos/core';
import type { CredentialResolver } from './credentialResolver.js';
import { applyVerdictToStop, routeStop, type NextLoopAction } from './gatekeeperRouting.js';
import { submitToOpenAi, type HttpPort, type TransportOutcome } from './transports/openaiResponses.js';
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
  CORRECTION_EXHAUSTED: 'correction-exhausted',
  REVIEW_OUTSTANDING: 'evidence-review',
  WORKER_REFUSED: 'worker-refusal',
  EFFECTS_NOT_ATTESTED: 'effects-unattested',
  PROTECTED_EFFECT: 'ambiguity',
  OWNER_GATE: 'ambiguity',
  SCOPE_DECISION: 'ambiguity',
};

export interface GatekeeperTurnInput {
  readonly stop: LoopStop;
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly repositoryRoot: string;
  /** The evidence the reviewer reads. Its digest binds the request. */
  readonly evidenceText: string;
  readonly ownerOnlyActions: readonly string[];
  /** Who the approved plan says reviews. Never a caller's claim. */
  readonly expectedDecider: string;
  readonly at: string;
}

export interface GatekeeperTurnDeps {
  readonly transport: GatekeeperTransportDescriptor | null;
  readonly availability: TransportAvailability;
  readonly resolver: CredentialResolver;
  readonly http: HttpPort;
  readonly modelPolicy: ModelPolicy;
  readonly rateCards: Readonly<Record<string, RateCard>>;
  readonly budget: BudgetPolicy;
  /** Everything spent so far. Read, never written, by this module. */
  readonly ledger: readonly LedgerEntry[];
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
  /** The provider's id for this turn, to be carried into the next one. Null when nothing was sent. */
  readonly providerResponseId: string | null;
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
      providerResponseId: null,
    };
  }

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
    ownerOnlyActions: input.ownerOnlyActions,
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
        providerResponseId: null,
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
    return unavailable(input, lines, request, selection.reasons);
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
      providerResponseId: null,
    };
  }
  lines.push(`tier ${selectTier(ask)} -> model ${model}`);

  // The estimate uses the evidence actually being sent, so it is a real bound rather than a nominal one.
  const estimatedInput = Math.ceil(input.evidenceText.length / 4);
  const estimate = estimateCostMicroUsd({ inputTokens: estimatedInput, outputTokens: 800 }, rate);
  const totals = summariseLedger(deps.ledger, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    month: input.at.slice(0, 7),
  });
  const spend = authoriseRequestSpend(estimate, totals, deps.budget);
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
      providerResponseId: null,
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
            credentialRef: transport.credentialRef ?? '',
            previousResponseId: deps.previousResponseId ?? null,
          },
          deps.resolver,
          deps.http,
        );

  if (outcome.kind === 'unavailable') {
    return unavailable(input, lines, request, outcome.reasons);
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

  // 6. CHECK THE ANSWER BEFORE APPLYING IT.
  const problems = checkGatekeeperDecision(outcome.record, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit: input.subjectCommit,
    requestDigest: gatekeeperRequestDigest(request),
    expectedDecider: input.expectedDecider,
    alreadyConsumedDecisionIds: deps.consumedDecisionIds,
    ownerOnlyActions: input.ownerOnlyActions,
  });

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
    providerResponseId: outcome.providerResponseId,
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
    providerResponseId: null,
  };
}
