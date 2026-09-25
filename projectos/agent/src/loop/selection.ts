/**
 * Which phase the loop may work on next — and, far more often, why it may not work on any.
 *
 * ONE COMPLETION LEDGER. Completeness and authorisation are asked of `governedContext`, the same
 * module the phase-creation gate uses. A loop that judged completeness its own way would be a second
 * ledger, and the first symptom of disagreement would be the loop starting a phase the gate then
 * refuses — an infinite retry that looks like progress.
 *
 * SELECTION NEVER WRITES. It reads the plan, the durable phase records and the declared current
 * state, and returns a decision. The caller acts on it. Keeping the choice free of effects is what
 * makes it testable without a repository and reviewable without running it.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { System } from '../system.js';
import type { Phase, PhaseStatus } from '@projectos/core';
import { loadPhase, isSafePhaseId } from '../phaseStore.js';
import {
  approvedPlanPhases,
  authorisePhase,
  completedPhaseIds,
  type AuthorisedPlanPhase,
  type GovernedContext,
} from '../governedContext.js';

export type SelectionStopCode =
  /** The plan declares no phases. Reported as itself — an empty plan is not a finished one. */
  | 'NO_PHASES'
  /** Every phase of the approved plan is recorded complete. */
  | 'PROGRAMME_COMPLETE'
  /** The next phase sits at a status only the owner may move it from. */
  | 'OWNER_DECISION_REQUIRED'
  /** The next phase was closed as blocked. The loop does not step over it. */
  | 'PHASE_BLOCKED'
  /** The authorisation gate refused the phase the plan puts next. */
  | 'DEPENDENCY_NOT_SATISFIED'
  | 'PHASE_NOT_AUTHORISED'
  /** A durable phase record exists for a phase the plan does not contain, or is unreadable. */
  | 'RECORD_DISAGREES_WITH_PLAN'
  /**
   * The plan names a phase whose id cannot safely become a filename.
   *
   * The plan schema constrains `phaseId` to a non-empty string and nothing more, and a phase id
   * becomes a path in several stores. `phaseStore` declines such an id, but the loop must not START
   * work it could never record — so this is a refusal to run, not a bookkeeping problem.
   */
  | 'UNSAFE_PHASE_ID';

export interface SelectionStop {
  readonly code: SelectionStopCode;
  readonly detail: string;
}

export type PhaseSelection =
  | { readonly kind: 'start'; readonly planPhase: AuthorisedPlanPhase }
  | { readonly kind: 'continue'; readonly planPhase: AuthorisedPlanPhase; readonly record: Phase }
  | { readonly kind: 'stop'; readonly reason: SelectionStop };

/**
 * Statuses the loop may carry forward on its own. Everything else is either terminal or belongs to
 * someone else: `awaiting_closure` is the owner's, and `rolled_back` is a deliberate human decision
 * to redo work that the loop must not quietly resume.
 */
const LOOP_MAY_CONTINUE: ReadonlySet<PhaseStatus> = new Set<PhaseStatus>([
  'draft',
  'prompted',
  'implementing',
  'validating',
  'evidence',
  'awaiting_review',
]);

/** Statuses that stop the loop and name whose decision it now is. */
const STOPS_AT: Readonly<Partial<Record<PhaseStatus, SelectionStopCode>>> = {
  awaiting_closure: 'OWNER_DECISION_REQUIRED',
  closed_as_blocked: 'PHASE_BLOCKED',
  rolled_back: 'OWNER_DECISION_REQUIRED',
};

function stop(code: SelectionStopCode, detail: string): PhaseSelection {
  return { kind: 'stop', reason: { code, detail } };
}

/**
 * THE ONE HISTORICAL-TO-CONTINUATION PAIRING — ratified in PROJECTOS-HOST-REVIEW-PATH1B.
 *
 * The planning mechanism cannot retire an unfinished phase, so the historical host review phase is
 * still FIRST in plan order, while the owner has ruled that no candidate of it alone may ever become
 * final. Left to the first-incomplete rule the loop would implement exactly the phase it must not.
 *
 * THESE ARE SOURCE CONSTANTS, NOT DATA. The pairing is read from the code the governed checkout has
 * committed and from nowhere else: not the plan, not the current state, not the work record. Anything
 * the implementer can write at run time must not be able to nominate a pair, because a writable
 * pairing is a way to make the loop skip any phase. `val-projectos-work-record-not-authority1a` pins
 * that the pair is exactly this one and that nothing else in the agent spells a second.
 */
const HISTORICAL_PHASE_ID = 'PROJECTOS-HOST-REVIEW-PATH1A';
const CONTINUATION_PHASE_ID = 'PROJECTOS-HOST-REVIEW-PATH1B';

/**
 * Is this the historical phase of the pairing, PARKED — a `draft` record implementation never resumes?
 *
 * For the durable current state, which must not call a parked historical record "work in flight": it
 * is never selected for implementation, so beside the running continuation phase it is not a second
 * active phase, and on its own it is not execution. ONLY that phase and ONLY as a `draft` — once the
 * governed reconciliation and closure operation moves it, it is in flight like any other phase. Asked
 * here because this module is the one place the pairing may be named.
 */
export function isParkedHistoricalPhase(phaseId: string, status: string): boolean {
  return phaseId === HISTORICAL_PHASE_ID && status === 'draft';
}

/**
 * Apply the pairing to the phase the first-incomplete rule produced.
 *
 * Returns the phase to carry on with, or a stop. It only ever SUBSTITUTES the continuation for the
 * historical phase or REFUSES; it never steps over the historical phase to reach a later one, which
 * would be the silent reordering the first-incomplete rule exists to prevent.
 */
function applyHistoricalPairing(
  next: AuthorisedPlanPhase,
  phases: readonly AuthorisedPlanPhase[],
  complete: ReadonlySet<string>,
): AuthorisedPlanPhase | PhaseSelection {
  if (next.phaseId !== HISTORICAL_PHASE_ID) return next;
  const continuation = phases.find((p) => p.phaseId === CONTINUATION_PHASE_ID);
  if (continuation !== undefined && !complete.has(CONTINUATION_PHASE_ID)) return continuation;
  return stop(
    'OWNER_DECISION_REQUIRED',
    `phase '${HISTORICAL_PHASE_ID}' is never selected for implementation execution; it is offered only to ` +
      `the governed reconciliation and closure operation, by owner decision, against the accepted cumulative ` +
      `candidate of '${CONTINUATION_PHASE_ID}'`,
  );
}

/**
 * The next phase of the approved plan, in plan order.
 *
 * The first phase that is not recorded complete is THE phase — not the first phase that happens to
 * be startable. Skipping a stuck phase to find work would silently reorder an owner-approved plan.
 */
export function selectNextPhase(sys: System, root: string, context: GovernedContext): PhaseSelection {
  const phases = approvedPlanPhases(context);
  if (phases.length === 0) {
    return stop('NO_PHASES', `the approved plan at ${context.planPath} declares no phases, so there is nothing to run`);
  }

  const { ids: complete, stateProblem } = completedPhaseIds(sys, root, context);
  const firstIncomplete = phases.find((p) => !complete.has(p.phaseId));
  if (firstIncomplete === undefined) {
    return stop(
      'PROGRAMME_COMPLETE',
      `every one of the ${phases.length} approved phase(s) is recorded complete; the loop has nothing left to start`,
    );
  }
  const paired = applyHistoricalPairing(firstIncomplete, phases, complete);
  if ('kind' in paired) return paired;
  const next = paired;

  if (!isSafePhaseId(next.phaseId)) {
    return stop(
      'UNSAFE_PHASE_ID',
      `the approved plan names phase '${next.phaseId}', whose id cannot safely become a record ` +
        'filename; a phase id must be 4-128 characters of letters, digits, underscore or hyphen',
    );
  }

  const record = loadPhase(sys, root, next.phaseId);
  if (record !== null) {
    const stopCode = STOPS_AT[record.status];
    if (stopCode !== undefined) {
      return stop(
        stopCode,
        `phase '${next.phaseId}' is ${record.status}; that is not a state the loop may move it from`,
      );
    }
    if (!LOOP_MAY_CONTINUE.has(record.status)) {
      // `closed` without the phase appearing complete means the record and the completion sources
      // disagree. Reporting it beats treating either side as authoritative.
      const why = stateProblem === null ? '' : ` (${stateProblem})`;
      return stop(
        'RECORD_DISAGREES_WITH_PLAN',
        `phase '${next.phaseId}' records status '${record.status}' but is not recorded complete${why}`,
      );
    }
    return { kind: 'continue', planPhase: next, record };
  }

  // No durable record yet: starting it must pass the very gate that admits a new phase.
  const authorised = authorisePhase(sys, root, context, next.phaseId);
  if (!authorised.ok) return stop(authorised.code, authorised.detail);
  return { kind: 'start', planPhase: authorised.planPhase };
}

/** Render a selection stop for the CLI, in the same shape every other refusal uses. */
export function selectionStopLines(reason: SelectionStop): readonly string[] {
  return [`STOPPED (${reason.code}): ${reason.detail}`];
}
