/**
 * WHETHER THE PROGRAMME CARRIES ON TO ANOTHER PHASE — the one place that decides it.
 *
 * WHAT WAS MISSING. `projectos run` invoked `runLoop` exactly once. `selectNextPhase` already picked
 * the next phase of the approved plan correctly — in plan order, never stepping over a stuck one —
 * and nothing ever asked it a second time. So a technically finished phase ended the process, and
 * the programme advanced only when the owner typed something. `projectos closure` had the same
 * shape: it closed a phase and exited.
 *
 * ONE AUTHORITY, TWO CALLERS. The obvious fix is a loop in `run.ts` and another in `closure.ts`, and
 * that is the thing to avoid: two continuation paths disagree eventually, and the disagreement is
 * discovered by a programme continuing when it should have stopped. Both callers ask this module,
 * and this module runs no phase itself — the caller supplies `runPhase`, so the decision is testable
 * with no repository, no worker and no network.
 *
 * IT IS A CONTINUATION AUTHORITY, NOT AN APPROVAL AUTHORITY. Continuing does not approve anything.
 * Every phase it starts runs the identical gate chain it would have run had the owner typed the
 * command himself: Doctor preflight, the worker's own grants, the checks, the reviews, the owner-only
 * floor, the budget. This module can only decide whether to ASK for another phase; everything that
 * could refuse one still refuses it.
 *
 * THE TERMINATION ARGUMENT, because an unattended loop that cannot end is worse than one that never
 * starts:
 *
 *   1. ANY STOP ENDS IT. Every `LoopStop` is either the owner's decision or a defect, and neither is
 *      something to walk past. There is deliberately no list of "stops we may continue through" —
 *      such a list is exactly how an owner gate becomes negotiable.
 *   2. NO PROGRESS ENDS IT. If a pass leaves the selected phase unchanged, the next pass would do
 *      the same thing again. Repeating it is not continuation, it is a spin.
 *   3. A HARD BOUND ENDS IT REGARDLESS. Even a programme that keeps making progress stops after
 *      `MAX_PHASES_PER_INVOCATION`, so a plan that grows while it runs cannot run for ever.
 *
 * Created for RUN-TO-COMPLETION.
 */

/**
 * The most phases one invocation will carry, however well it is going.
 *
 * NOT A SAFETY LIMIT ON CORRECTNESS — rules 1 and 2 above end the loop on anything that matters.
 * This ends it on SUCCESS, which is the case those rules cannot see: an approved plan is finite, so
 * a run that has completed this many phases in one go has either finished the plan or is being fed
 * phases by something that is still writing them. Both are worth handing back for.
 */
export const MAX_PHASES_PER_INVOCATION = 25;

/** What one phase attempt produced, in the only terms continuation needs. */
export interface PhaseAttempt {
  /** The phase the runner actually selected and worked on, or null when it selected none. */
  readonly phaseId: string | null;
  /**
   * Why the run ended, or null when it ended with nothing outstanding.
   *
   * Any value here ends the programme. It is carried as a code and a detail rather than a boolean
   * so the report can say which stop, in the loop's own vocabulary.
   */
  readonly stopCode: string | null;
  readonly stopDetail: string | null;
  /** False when the run refused to start at all — a broken environment, not a governed outcome. */
  readonly ok: boolean;
  /** Every line the attempt produced, carried through so the caller reports one narrative. */
  readonly lines: readonly string[];
}

export type ContinuationEnd =
  /** The plan has no phase left to work on. The only end that means "finished". */
  | 'PROGRAMME_COMPLETE'
  /** A phase run ended on a stop — the owner's, or a defect. Named in `reasons`. */
  | 'STOPPED'
  /** A pass left the selected phase where it was; running it again would repeat it. */
  | 'NO_PROGRESS'
  /** The attempt could not run at all. */
  | 'REFUSED'
  /** `MAX_PHASES_PER_INVOCATION` reached with the plan still unfinished. */
  | 'BOUND_REACHED';

export interface ContinuationResult {
  readonly end: ContinuationEnd;
  /** Phases this invocation actually worked on, in order. */
  readonly phasesRun: readonly string[];
  readonly reasons: readonly string[];
  readonly lines: readonly string[];
}

/**
 * Whether a completed attempt permits another one.
 *
 * PURE, AND SEPARATE FROM THE DRIVER, so the rule can be read and tested on its own. The driver
 * below is then only a loop around it, which is the part that cannot go subtly wrong.
 */
export function mayContinueAfter(attempt: PhaseAttempt, previousPhaseId: string | null): {
  readonly continue: boolean;
  readonly end: ContinuationEnd | null;
  readonly reasons: readonly string[];
} {
  if (!attempt.ok) {
    return {
      continue: false,
      end: 'REFUSED',
      reasons: ['the phase run refused to start, so nothing was continued'],
    };
  }
  if (attempt.phaseId === null) {
    // The runner selected nothing. That is `selectNextPhase` reporting the plan is finished, or that
    // the next phase belongs to somebody else — either way there is nothing here to carry forward.
    return {
      continue: false,
      end: 'PROGRAMME_COMPLETE',
      reasons: ['the approved plan has no phase left for the loop to work on'],
    };
  }
  if (attempt.stopCode !== null) {
    // EVERY stop ends it. See the termination argument: a list of stops that may be walked past is
    // how an owner gate becomes negotiable.
    return {
      continue: false,
      end: 'STOPPED',
      reasons: [
        `phase '${attempt.phaseId}' stopped: ${attempt.stopCode}`,
        ...(attempt.stopDetail === null ? [] : [attempt.stopDetail]),
        'the programme does not continue past a stop; it is either the owner\'s decision or a defect',
      ],
    };
  }
  if (previousPhaseId !== null && attempt.phaseId === previousPhaseId) {
    return {
      continue: false,
      end: 'NO_PROGRESS',
      reasons: [
        `phase '${attempt.phaseId}' was selected again after a pass that reported no stop, so the ` +
          'programme is not advancing and another identical pass would not change that',
      ],
    };
  }
  return { continue: true, end: null, reasons: [] };
}

export interface ContinuationDeps {
  /**
   * Run the next eligible phase, once. Supplied by the caller so this module touches no repository.
   *
   * It is the SAME entry both callers already use, not a second execution path — continuation adds
   * no way to run a phase that did not exist before it.
   */
  readonly runPhase: () => PhaseAttempt;
  /** Reported before each attempt, so an operator watching sees the programme move. */
  readonly onPhaseStart?: (index: number) => void;
}

/**
 * Carry the approved programme forward until something says stop.
 *
 * Runs at least one phase — a caller asking to continue is asking for work to happen — and then
 * keeps going only while `mayContinueAfter` permits it.
 */
export function continueProgramme(deps: ContinuationDeps): ContinuationResult {
  const phasesRun: string[] = [];
  const lines: string[] = [];
  let previousPhaseId: string | null = null;

  for (let index = 0; index < MAX_PHASES_PER_INVOCATION; index += 1) {
    deps.onPhaseStart?.(index);
    const attempt = deps.runPhase();
    lines.push(...attempt.lines);
    if (attempt.phaseId !== null && attempt.ok) phasesRun.push(attempt.phaseId);

    const verdict = mayContinueAfter(attempt, previousPhaseId);
    if (!verdict.continue) {
      return { end: verdict.end ?? 'STOPPED', phasesRun, reasons: verdict.reasons, lines };
    }
    previousPhaseId = attempt.phaseId;
  }

  return {
    end: 'BOUND_REACHED',
    phasesRun,
    reasons: [
      `${MAX_PHASES_PER_INVOCATION} phases were carried in one invocation and the plan is still not ` +
        'finished; the programme is handed back rather than continued indefinitely',
    ],
    lines,
  };
}

/**
 * A phase-runner result, in the terms continuation needs.
 *
 * ONE ADAPTER, SHARED BY BOTH CALLERS, so `run` and `closure` cannot disagree about what a stop is.
 * Structural rather than typed against `RunResult` on purpose: this module is deliberately free of
 * every dependency that touches a repository, and importing the runner's types would drag them in.
 */
export function phaseAttemptOf(result: {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly phaseId?: string;
  readonly stop?: { readonly code: string; readonly detail: string } | null;
}): PhaseAttempt {
  return {
    ok: result.ok === true,
    lines: result.lines ?? [],
    phaseId: typeof result.phaseId === 'string' && result.phaseId !== '' ? result.phaseId : null,
    stopCode: result.stop?.code ?? null,
    stopDetail: result.stop?.detail ?? null,
  };
}

/** How the end of a continuation reads to an operator. One place, so both callers say the same thing. */
export function continuationLines(result: ContinuationResult): readonly string[] {
  const ran =
    result.phasesRun.length === 0
      ? 'No phase was carried.'
      : `Phases carried in this invocation (${result.phasesRun.length}): ${result.phasesRun.join(', ')}.`;
  return [
    '',
    ran,
    `Programme continuation ended: ${result.end}`,
    ...result.reasons.map((r) => `  ${r}`),
  ];
}
