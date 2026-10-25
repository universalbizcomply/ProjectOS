/**
 * The INTERACTIVE gatekeeper turn: the owner is working with the ChatGPT gatekeeper, and its bound
 * decision is handed back to the loop.
 *
 * THE SAME TURN, A DIFFERENT ACQUISITION. Routing, the request and its deterministic id, the enforced
 * owner-only set, the decision contract, the evidence record and the verdict's application are exactly
 * the ones `takeGatekeeperTurn` uses — imported, not re-derived. What differs is only how the answer
 * arrives: instead of a provider call, ProjectOS writes the question down (`publishRequest`), and the
 * decision the ChatGPT gatekeeper produced is read back for THAT request id (`awaitDecision`).
 *
 * THE ORDER, and what each step stands in the way of:
 *
 *   1. ROUTE FIRST. An owner's stop is the owner's in this mode too; no question is written.
 *   2. FORM THE REQUEST with the shared derivation, so a re-run asks the same question under the same id.
 *   3. PUBLISH, THEN WAIT FOR THE ANSWER. Absent means WAIT — never a guess, never another reviewer,
 *      never unattended mode, and never the implementer answering itself.
 *   4. REFUSE A RECORD THAT CLAIMS A PROVENANCE. How a decision was obtained is this route's to say; a
 *      record carrying an attestation field is trying to be Host-independent evidence, and is refused.
 *   5. CHECK IT with `checkGatekeeperDecision` against expectations the runtime established — project,
 *      phase, subject, request digest, the committed delegation's decider, replay, owner-only actions.
 *   6. RECORD, THEN SPEND, THEN APPLY. Durable provenance and single use are both preconditions of
 *      acting; a failure of either leaves the verdict unapplied.
 *
 * WHAT THIS CANNOT PROMISE. The decision arrives as a file in the governed checkout, and under this
 * project's trust model (`tamperProof: false`) anything that can write the checkout can write one. What
 * stands in the way is what stands in the way of every governance record here: the decider must be the
 * one the owner's COMMITTED delegation names, never an implementer name; the record must bind this
 * exact request; and no code path in ProjectOS ever writes one. It is the owner's relay, made checkable.
 *
 * Pure apart from the injected ports. Created in PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A.
 */
import {
  checkGatekeeperDecision,
  gatekeeperRequestDigest,
  provenanceClaimsIn,
  GATEKEEPER_DECISION_SCHEMA_VERSION,
  type DecisionProvenanceStamp,
  type GatekeeperDecisionRecord,
  type GatekeeperRequest,
  type GatekeeperVerdict,
  type LedgerEntry,
} from '@projectos/core';
import { applyVerdictToStop, routeStop, type NextLoopAction } from './gatekeeperRouting.js';
import { formGatekeeperRequest, type GatekeeperTurnInput, type GatekeeperTurnResult } from './gatekeeperTurn.js';

export const INTERACTIVE_HANDOFF_SCHEMA_VERSION = '1.0.0';

/** What every interactive question has in common: which kind of question it is, and its derived id. */
export interface InteractiveQuestion {
  readonly schemaVersion: string;
  readonly handoffKind: string;
  readonly requestId: string;
}

/** The question, written down for the owner to carry to the ChatGPT gatekeeper. Holds no secret. */
export interface InteractiveHandoff extends InteractiveQuestion {
  readonly handoffKind: 'interactive-gatekeeper-request';
  readonly instructions: readonly string[];
  readonly stop: { readonly code: string; readonly detail: string };
  /** The verdicts that can answer this stop. Any other verdict is refused on return. */
  readonly applicableVerdicts: readonly GatekeeperVerdict[];
  readonly request: GatekeeperRequest;
  readonly requestDigest: string;
  /** The binding fields the answer must carry verbatim, and the fields the gatekeeper fills in. */
  readonly decisionTemplate: Readonly<Record<string, unknown>>;
  readonly evidenceText: string;
}

export type InteractiveDecisionRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly record: GatekeeperDecisionRecord }
  | { readonly kind: 'unreadable'; readonly detail: string };

/**
 * Where the question is written and the answer is read. A PORT: this module touches no disk.
 */
export interface InteractiveDecisionPort {
  /** Write the question down. Idempotent for the same question; anything but the two words is a refusal. */
  publishRequest(handoff: InteractiveQuestion): 'written' | 'already-published' | string;
  /** The decision supplied for this request, if any, waiting no longer than the port's own bound. */
  awaitDecision(requestId: string): InteractiveDecisionRead;
  /** Spend the decision so it can never be applied twice. Only `'consumed'` permits acting. */
  consumeDecision(requestId: string): 'consumed' | string;
  /** Where the owner finds the question and saves the answer — named in the WAIT message. */
  locations(requestId: string): { readonly request: string; readonly decision: string };
}

export interface InteractiveGatekeeperDeps {
  readonly mode: 'interactive';
  readonly interactive: InteractiveDecisionPort;
  /** Keep an ACCEPTED decision as evidence, stamped with this route's provenance. Grants nothing. */
  readonly recordDecisionEvidence?: (
    record: GatekeeperDecisionRecord,
    provenance: DecisionProvenanceStamp,
  ) => 'written' | 'already-recorded' | string;
  readonly consumedDecisionIds: readonly string[];
  /** Interactive review spends nothing. Present so the loop's shared bookkeeping reads one shape. */
  readonly ledger?: readonly LedgerEntry[];
}

const PROVENANCE: DecisionProvenanceStamp = { kind: 'InteractiveGatekeeperDecision' };

function result(
  action: NextLoopAction,
  lines: readonly string[],
  request: GatekeeperRequest | null,
  extra: Partial<GatekeeperTurnResult> = {},
): GatekeeperTurnResult {
  return {
    action,
    lines,
    request,
    ledgerEntry: null,
    ownerChoices: null,
    unavailabilityCause: null,
    providerResponseId: null,
    checkedDecision: null,
    ...extra,
  };
}

function handoffFor(input: GatekeeperTurnInput, request: GatekeeperRequest, requestDigest: string): InteractiveHandoff {
  return gatekeeperHandoff({
    stop: { code: input.stop.code, detail: input.stop.detail },
    applicableVerdicts: routeStop(input.stop).applicableVerdicts,
    request,
    requestDigest,
    expectedDecider: input.expectedDecider,
    evidenceText: input.evidenceText,
  });
}

/**
 * The written question for any gatekeeper request — a stopped loop's, or a reconciliation's.
 *
 * `stop` names what the question is about; `applicableVerdicts` is every answer it accepts.
 */
export function gatekeeperHandoff(args: {
  readonly stop: { readonly code: string; readonly detail: string };
  readonly applicableVerdicts: readonly GatekeeperVerdict[];
  readonly request: GatekeeperRequest;
  readonly requestDigest: string;
  readonly expectedDecider: string;
  readonly evidenceText: string;
}): InteractiveHandoff {
  const { request, requestDigest } = args;
  return {
    schemaVersion: INTERACTIVE_HANDOFF_SCHEMA_VERSION,
    handoffKind: 'interactive-gatekeeper-request',
    instructions: [
      'Give this request, including evidenceText, to the ChatGPT gatekeeper.',
      'Its answer is the decisionTemplate with decision, reason, nextClaudeInstruction, allowedActions, ' +
        'forbiddenActions, ownerApprovalRequired and decidedAt filled in, and every other field unchanged.',
      `decision must be one of: ${args.applicableVerdicts.join(', ')}.`,
      'allowedActions may never name an action in request.ownerOnlyActions.',
      'Save the answer as JSON at the decision path ProjectOS reported, then run again.',
    ],
    requestId: request.requestId,
    stop: args.stop,
    applicableVerdicts: args.applicableVerdicts,
    request,
    requestDigest,
    decisionTemplate: {
      schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
      decisionId: `GKDEC-${request.requestId}`,
      projectId: request.projectId,
      phaseId: request.phaseId,
      subjectCommit: request.subjectCommit,
      requestDigest,
      decidedBy: args.expectedDecider,
      decision: null,
      reason: null,
      nextClaudeInstruction: null,
      allowedActions: [],
      forbiddenActions: [],
      ownerApprovalRequired: null,
      decidedAt: null,
    },
    evidenceText: args.evidenceText,
  };
}

/**
 * Ask the ChatGPT gatekeeper through the owner, and act on its answer or wait for it.
 */
export function takeInteractiveTurn(input: GatekeeperTurnInput, deps: InteractiveGatekeeperDeps): GatekeeperTurnResult {
  // 1. ROUTE FIRST.
  if (routeStop(input.stop).audience === 'owner') {
    return result(applyVerdictToStop(input.stop, { decision: undefined, problems: ['not asked'] }), [
      `stop ${input.stop.code} is the owner's; no gatekeeper request was made`,
    ], null);
  }

  // 2. THE SHARED DERIVATION.
  const { ask, ownerOnlyActions, request } = formGatekeeperRequest(input);
  const requestDigest = gatekeeperRequestDigest(request);
  const decisionId = `GKDEC-${request.requestId}`;
  const lines: string[] = [`interactive gatekeeper request ${request.requestId} (${ask}) for ${input.stop.code}`];
  const stopped = `STOPPED (${input.stop.code}): ${input.stop.detail}`;

  // 3. PUBLISH, THEN WAIT FOR THE ANSWER.
  const answer = awaitInteractiveAnswer(deps.interactive, handoffFor(input, request, requestDigest), 'this stop');
  if (answer.kind === 'stop') {
    if (answer.line !== null) lines.push(answer.line);
    return result({ kind: 'owner', reasons: [stopped, ...answer.reasons] }, lines, request);
  }
  const record = answer.record;

  // 4 + 5. A PROVENANCE CLAIM, THE WRONG DECISION ID, OR ANYTHING THE CONTRACT REFUSES.
  const problems: string[] = [
    ...provenanceClaimsIn(record).map(
      (field) =>
        `the supplied decision carries '${field}'; how a decision was obtained is recorded by the route that ` +
        'received it, and an interactive decision can never be presented as Host-attested evidence',
    ),
    ...(record.decisionId === decisionId
      ? []
      : [`the supplied decision is ${JSON.stringify(record.decisionId)}, but this request's decision is '${decisionId}'`]),
    ...checkGatekeeperDecision(record, {
      projectId: input.projectId,
      phaseId: input.phaseId,
      subjectCommit: input.subjectCommit,
      requestDigest,
      expectedDecider: input.expectedDecider,
      alreadyConsumedDecisionIds: deps.consumedDecisionIds,
      ownerOnlyActions,
    }),
  ];

  // 6. RECORD, THEN SPEND, THEN APPLY — only for a decision the checks accepted.
  if (problems.length === 0 && deps.recordDecisionEvidence !== undefined) {
    const recorded = deps.recordDecisionEvidence(record, PROVENANCE);
    if (recorded !== 'written' && recorded !== 'already-recorded') {
      return result(
        {
          kind: 'owner',
          reasons: [
            stopped,
            'the interactive gatekeeper decided, and ProjectOS could not durably record that decision — so it was NOT acted on',
            `evidence: ${recorded}`,
          ],
        },
        lines,
        request,
      );
    }
  }
  if (problems.length === 0) {
    const spent = deps.interactive.consumeDecision(request.requestId);
    if (spent !== 'consumed') {
      return result({ kind: 'owner', reasons: [stopped, `the interactive decision was not applied: ${spent}`] }, lines, request);
    }
  }

  const action = applyVerdictToStop(input.stop, {
    decision: record.decision as string,
    nextClaudeInstruction: typeof record.nextClaudeInstruction === 'string' ? record.nextClaudeInstruction : null,
    problems,
  });
  if (problems.length === 0) lines.push(`interactive gatekeeper decision ${decisionId} accepted (InteractiveGatekeeperDecision)`);
  return result(action, lines, request, {
    ...(problems.length > 0
      ? {}
      : {
          provenance: PROVENANCE.kind,
          checkedDecision: {
            problems: [],
            decisionId,
            projectId: input.projectId,
            phaseId: input.phaseId,
            subjectCommit: input.subjectCommit,
            allowedActions: Array.isArray(record.allowedActions) ? record.allowedActions.map(String) : [],
            // Filled by the runner, which alone knows the candidate it showed; see gatekeeperTurn.ts.
            reviewedCandidateDigest: '',
          },
        }),
  });
}

/** An interactive answer, or why there is none yet. `line` is set only while the question waits. */
export type InteractiveAnswer =
  | { readonly kind: 'answer'; readonly record: GatekeeperDecisionRecord }
  | {
      readonly kind: 'stop';
      readonly cause: 'not-written' | 'pre-existing' | 'waiting' | 'unreadable';
      readonly reasons: readonly string[];
      readonly line: string | null;
    };

/**
 * Publish the question, then wait for its answer — THE ONE ACQUISITION every interactive question uses:
 * a stopped loop's, a closure's and a reconciliation's.
 *
 * It returns the supplied record UNJUDGED. What it guarantees is only that the record answers a question
 * THIS call wrote; every check of the record itself belongs to the caller's own contract.
 */
export function awaitInteractiveAnswer(
  port: InteractiveDecisionPort,
  question: InteractiveQuestion,
  subject = 'this stop',
  rerun = 'projectos run --execute --gate-wait-minutes <n>',
): InteractiveAnswer {
  const where = port.locations(question.requestId);
  const stop = (cause: Extract<InteractiveAnswer, { kind: 'stop' }>['cause'], reasons: readonly string[], line: string | null = null): InteractiveAnswer => ({
    kind: 'stop',
    cause,
    reasons,
    line,
  });
  const published = port.publishRequest(question);
  if (published !== 'written' && published !== 'already-published') {
    return stop('not-written', [`the interactive gatekeeper request could not be written: ${published}`]);
  }
  // ONLY A QUESTION THIS RUN WROTE CAN BE ANSWERED. The question's bytes are deterministic, so anything
  // that ran before the gate — the worker included — could write a byte-identical question AND an answer
  // beside it, and the two would be indistinguishable from a real exchange. A question that already
  // existed is therefore never answered: nobody can establish that ProjectOS asked it. The owner clears
  // it and the next run asks afresh — rare in practice, because the answer arrives while the asking run
  // holds its gate open, and a later run derives a new question from its own evidence.
  if (published === 'already-published') {
    return stop('pre-existing', [
      'a request for this exact question already existed before this run asked it, and ProjectOS cannot ' +
        'establish that it wrote it — an answer planted beside it would look genuine — so no answer to it is accepted',
      `  to ask again: run again with --supersede-stale-request, which archives ${where.request} and any ` +
        `${where.decision} under superseded/ and asks afresh; never delete them by hand`,
    ]);
  }
  const read = port.awaitDecision(question.requestId);
  if (read.kind === 'absent') {
    return stop(
      'waiting',
      [
        `WAITING FOR THE INTERACTIVE GATEKEEPER: ${subject} needs the ChatGPT gatekeeper's decision and none has been supplied`,
        `  the question: ${where.request}`,
        `  save the decision as: ${where.decision}`,
        'ProjectOS will not decide this itself, will not ask any other reviewer and will not switch to unattended mode',
        'a decision answers only the question it was given: a later run asks again with its own evidence, so ' +
          `save the answer while a run is waiting on it (${rerun})`,
      ],
      `waiting for the interactive gatekeeper decision at ${where.decision}`,
    );
  }
  if (read.kind === 'unreadable') {
    return stop('unreadable', [`the supplied interactive decision could not be used: ${read.detail}`]);
  }
  return { kind: 'answer', record: read.record };
}
