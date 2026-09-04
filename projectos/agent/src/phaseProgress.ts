/**
 * Record, in the canonical phase record, the lifecycle the autonomous loop actually drove.
 *
 * THE DEFECT THIS EXISTS FOR. On 2026-09-04 the loop ran `validation-cache` end to end: the worker
 * implemented, five checks passed, the live gatekeeper approved the continuation, and ProjectOS
 * committed `40e068f` and pushed it. `work.v1.json` said `COMPLETE`. The owner's plan screen said
 * `0 of 4 · PLAN READY`, and `.projectops/phases/validation-cache.json` did not exist at all.
 *
 * Nothing downstream was lying. `syncCurrentState` recomputes the declared state from the phase
 * records, and the phase records are the lifecycle authority — it reported `activePhase: null`
 * because no record had ever been written. `selectNextPhase` is built to read those records, and
 * even stops at `awaiting_closure` with `OWNER_DECISION_REQUIRED`. Every part of the lifecycle was
 * in place except the one that writes it down. The loop reported its progress to `work.v1` and to
 * nothing else, so a completed phase left no lifecycle trace and the plan could never advance.
 *
 * WHAT THIS IS NOT. It is not a second lifecycle. Every transition goes through core's
 * `transitionPhase`, so the legal-transition rules, the closure-grant requirement and the
 * owner-only targets all apply here exactly as they do to `projectos phase advance`. It introduces
 * no status, no ordering and no authority of its own.
 *
 * IT CAN NEVER CLOSE A PHASE. `awaiting_closure` is the furthest it will go, and that is checked
 * twice: `LIFECYCLE_ORDER` stops there, and `refuseOwnerOnly` refuses before core is even asked.
 * Core would refuse anyway — closure needs a grant only `authoriseClosure` can mint — but a
 * boundary this important is stated where it is read, not left to be inferred from a callee.
 * Completion still means what it always meant: a genuine owner-or-delegate closure, adjudicated by
 * `isGenuineClosure`, which nothing written here can satisfy.
 *
 * IT IS EVIDENCE, NEVER PERMISSION. Nothing reads these records back to decide what the loop may
 * do next within a run, and a failure to record never fails the run — but it is always REPORTED,
 * because silence about a record that did not get written is how the drift started.
 */
import type { System } from './system.js';
import {
  createPhase,
  transitionPhase,
  isTerminal,
  requiresOwner,
  type Phase,
  type PhaseStatus,
  type Role,
} from '@projectos/core';
import { loadPhase, savePhase, isSafePhaseId } from './phaseStore.js';
import { authorisePhase, type GovernedContext } from './governedContext.js';
import { syncCurrentState } from './currentStateStore.js';

/**
 * The happy path, in order, and no further.
 *
 * Each consecutive pair is a legal transition in core's `PHASE_TRANSITIONS`, which is what lets a
 * walk between two of these be performed one honest step at a time rather than as a leap. The list
 * ENDS at `awaiting_closure` on purpose: the two statuses beyond it are the owner's.
 */
const LIFECYCLE_ORDER: readonly PhaseStatus[] = [
  'draft',
  'prompted',
  'implementing',
  'validating',
  'evidence',
  'awaiting_review',
  'awaiting_closure',
];

/** Statuses the loop must not move a phase out of, whatever it reports next. */
function isSettled(status: PhaseStatus): boolean {
  return isTerminal(status) || status === 'rolled_back';
}

function orderOf(status: PhaseStatus): number {
  return LIFECYCLE_ORDER.indexOf(status);
}

/**
 * What a reported work state means for the phase's lifecycle, or null for "this says nothing".
 *
 * ONLY WHAT THE STATE ACTUALLY ESTABLISHES. `PLANNING` and `RESUMING` describe the loop's own
 * position and claim nothing about the phase, so they move nothing. `BLOCKED` deliberately moves
 * nothing either: the loop stopping is not a rollback, and recording one would assert a decision
 * nobody made — the stop code and detail in `work.v1` are where a stop is described.
 *
 * `COMPLETE` maps to `awaiting_closure` and NOT to `closed`, because that is the truth: the work of
 * the phase is finished and the decision that ends it belongs to the owner.
 */
export function phaseStatusForWork(state: string): PhaseStatus | null {
  switch (state) {
    case 'QUEUED':
      return 'prompted';
    case 'WAITING_AI':
    case 'EXECUTING':
    case 'CORRECTION_REQUIRED':
      return 'implementing';
    case 'VALIDATING':
      return 'validating';
    case 'AWAITING_GATE':
    case 'WAITING_OWNER':
    case 'GATE_APPROVED':
      return 'awaiting_review';
    case 'COMPLETE':
      return 'awaiting_closure';
    default:
      return null;
  }
}

/**
 * The only work state that may move a phase BACKWARD, and why no other one may.
 *
 * `EXECUTING` is reported twice in a run: once for the worker, and again for each technical
 * continuation action AFTER the gatekeeper has approved. Treating the second one as "implementing"
 * would drag the record back from `awaiting_review` and make a successful commit look like a
 * correction. So regression is confined to the single state that genuinely means it: the reviewer
 * asked for changes.
 */
const MAY_REGRESS = 'CORRECTION_REQUIRED';

export interface PhaseProgressResult {
  /** Transitions actually written, in order. Empty when the record was already where it should be. */
  readonly moved: readonly PhaseStatus[];
  /** Created a phase record that did not exist. */
  readonly created: boolean;
  /** Why nothing (or not everything) was recorded. Absent when there was nothing to say. */
  readonly problem?: string;
}

/**
 * Do these two name the same project?
 *
 * Compares identities rather than strings: case and non-alphanumeric characters are noise here,
 * because one side is a human-facing display name and the other is a configuration id for the same
 * thing. `ProjectOS` and `projectos` are the same project; `PolyGo` and `projectos` are not.
 */
function sameProjectIdentity(a: string, b: string): boolean {
  const key = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ka = key(a);
  const kb = key(b);
  // A RECORD THAT NAMES NO PROJECT IS NOT THIS RUN'S TO CLAIM. Treating an empty side as "no
  // disagreement" would have made a blank `project` field weaker than the strict comparison this
  // replaced -- the one shape a stale or hand-edited record is most likely to have.
  return ka === kb;
}

/** Refused before core is asked. See the header: this boundary is stated where it is read. */
function refuseOwnerOnly(to: PhaseStatus): string | null {
  return requiresOwner(to)
    ? `refusing to record '${to}': closure is the owner's decision and the loop may never write it`
    : null;
}

/**
 * Bring the phase record into line with one reported work state.
 *
 * Creates the record when the loop has started a phase that has none — through `authorisePhase`,
 * the same gate `projectos phase new` passes, so a phase the owner never approved is still refused
 * here. Then walks the record to the mapped status one legal transition at a time, and reconciles
 * the declared current-state from the records afterwards.
 */
export function recordPhaseProgress(
  sys: System,
  root: string,
  context: GovernedContext,
  report: {
    readonly state: string;
    readonly phaseId: string;
    /**
     * The gate decision this run has actually recorded, when one exists. It is EVIDENCE, and the
     * only thing that lets the step into `awaiting_closure` be attributed to the advisor: without
     * it, that attribution would be a role string asserted by the code claiming it, which is the
     * exact failure `closureDecision.ts` was written to end. A degraded or unreviewed run reaching
     * COMPLETE is the implementer's own work and is recorded as such.
     */
    readonly gateDecisionId?: string | null;
  },
  project: string,
): PhaseProgressResult {
  // BEFORE ANY PATH IS BUILT. `phaseStore` enforces this too, and would simply decline; refusing
  // here is what turns a silent no-op into a reported one.
  if (!isSafePhaseId(report.phaseId)) {
    return {
      moved: [],
      created: false,
      problem: `phase id '${report.phaseId}' cannot safely become a record filename; nothing was written`,
    };
  }

  const target = phaseStatusForWork(report.state);
  if (target === null) return { moved: [], created: false };

  const ownerOnly = refuseOwnerOnly(target);
  if (ownerOnly !== null) return { moved: [], created: false, problem: ownerOnly };

  let record: Phase | null = loadPhase(sys, root, report.phaseId);
  let created = false;
  if (record === null) {
    // A record is only ever created for a phase the ACTIVE APPROVED PLAN authorises, with the
    // objective that plan states. Refusing beats inventing a governed record from a loop report.
    const auth = authorisePhase(sys, root, context, report.phaseId);
    if (!auth.ok) {
      return { moved: [], created: false, problem: `${auth.code}: ${auth.detail}` };
    }
    const objective = (auth.planPhase.description ?? '').trim();
    if (objective === '') {
      return {
        moved: [],
        created: false,
        problem:
          `the approved plan records no description for '${report.phaseId}', so there is no objective to ` +
          'write; refusing rather than persisting a placeholder',
      };
    }
    record = createPhase({ phaseId: report.phaseId, project, objective });
    if (!savePhase(sys, root, record)) {
      return { moved: [], created: false, problem: `the record for '${report.phaseId}' could not be written` };
    }
    created = true;
  }

  // A RECORD THAT BELONGS TO SOMETHING ELSE IS NOT THIS RUN'S TO MOVE. One root is normally one
  // project, but a stale record left behind by another, or two plans reusing a phase id, would
  // otherwise be silently transitioned by whoever ran next.
  //
  // COMPARED AS IDENTITIES, NOT AS STRINGS. A phase record stores `project` as the DISPLAY name
  // `phase new --project` was given (defaulting to `ProjectOS`), while the loop only knows the
  // configuration's `projectId` (`projectos`). Demanding those be equal compared two different
  // KINDS of thing, and refused to record the lifecycle of the very project it was protecting —
  // observed on a real run, which reported `belongs to project 'ProjectOS', not 'projectos'` and
  // wrote nothing. Normalising both sides keeps the protection that matters — a record naming a
  // genuinely different project still fails — without inventing a disagreement out of casing and
  // punctuation.
  if (sameProjectIdentity(record.project, project) === false) {
    return {
      moved: [],
      created,
      problem:
        `the existing record for '${report.phaseId}' belongs to project '${record.project}', not ` +
        `'${project}'; nothing was written`,
    };
  }

  if (isSettled(record.status)) {
    return {
      moved: [],
      created,
      problem: `phase '${report.phaseId}' is '${record.status}'; the loop does not move a phase out of that`,
    };
  }

  const from = orderOf(record.status);
  const to = orderOf(target);
  if (from === -1 || to === -1) {
    return { moved: [], created, problem: `no recordable path from '${record.status}' to '${target}'` };
  }

  // FORWARD ONLY, EXCEPT FOR A CORRECTION. See MAY_REGRESS.
  let path: readonly PhaseStatus[];
  if (to > from) {
    path = LIFECYCLE_ORDER.slice(from + 1, to + 1);
  } else if (to < from && report.state === MAY_REGRESS) {
    path = [target];
  } else {
    path = [];
  }
  if (path.length === 0) {
    if (created) syncCurrentState(sys, root, context, 'implementer');
    return { moved: [], created };
  }

  const moved: PhaseStatus[] = [];
  let problem: string | undefined;
  for (const step of path) {
    // The role is the truth about who moved it. Everything up to review is the implementer's own
    // work; the step into `awaiting_closure` follows the reviewer's decision, so it is recorded as
    // the advisor's. Neither can close: `isGenuineClosure` reads only entries whose `to` is
    // `closed`, and nothing written here ever is.
    const reviewed = typeof report.gateDecisionId === 'string' && report.gateDecisionId.trim() !== '';
    const by: Role = step === 'awaiting_closure' && reviewed ? 'advisor' : 'implementer';
    const note =
      step === 'awaiting_closure'
        ? `work complete; the loop recorded this and awaits the owner${reviewed ? ', after a recorded gate decision' : ''}`
        : `recorded by the autonomous loop (${report.state})`;
    const next = transitionPhase(record, step, by, sys.now(), note);
    if (!next.ok) {
      problem = `could not record '${record.status}' -> '${step}': ${next.error}`;
      break;
    }
    record = next.value;
    if (!savePhase(sys, root, record)) {
      problem = `the record for '${report.phaseId}' could not be written at '${step}'`;
      break;
    }
    moved.push(step);
  }

  // The durable memory must not contradict the records just written. Same call, same reason, as
  // every other transition in `phase.ts`.
  syncCurrentState(sys, root, context, 'implementer');
  return problem === undefined ? { moved, created } : { moved, created, problem };
}

/**
 * The glue between the loop's progress reports and the phase record, as one testable thing.
 *
 * It lived inline in `run.ts`, where nothing could reach it: the only way to exercise the
 * gate-decision carry, the crash guard or the de-duplication was to start a real governed run. The
 * behaviour it holds is small but load-bearing, and it is exactly the integration point the defect
 * this module exists to fix came from — so it is composed here and wired there.
 */
export interface LifecycleRecorder {
  /** Record one progress report. Never throws, whatever the state of the records on disk. */
  readonly record: (progress: { readonly state: string; readonly phaseId: string; readonly gateDecisionId?: string | null }) => void;
  /** Everything that went wrong, each said once, in the order first seen. */
  readonly problems: () => readonly string[];
}

export function createLifecycleRecorder(
  sys: System,
  root: string,
  context: GovernedContext,
  project: string,
): LifecycleRecorder {
  const problems: string[] = [];
  /**
   * The gate decision this run has recorded, carried forward across reports.
   *
   * The loop names it on the reports that produce one and not on the terminal COMPLETE, so without
   * this the completion could not tell whether a reviewer had been involved. Remembered rather than
   * assumed: a run that never reached a reviewer must not be written down as one that did.
   */
  let lastGateDecisionId: string | null = null;
  return {
    record: (progress): void => {
      if (typeof progress.gateDecisionId === 'string' && progress.gateDecisionId.trim() !== '') {
        lastGateDecisionId = progress.gateDecisionId;
      }
      // NOTHING HERE MAY END THE RUN. This is bookkeeping about work that has already happened, and
      // the guarantee stated at the top of this file is that a failure to record never fails a run.
      // A thrown error would have broken that guarantee in the case that most needs it -- an
      // unreadable record -- and crashed an unattended loop after it had already committed and
      // pushed. It becomes the same reported problem as any other, and the run carries on.
      try {
        const outcome = recordPhaseProgress(
          sys,
          root,
          context,
          { ...progress, gateDecisionId: progress.gateDecisionId ?? lastGateDecisionId },
          project,
        );
        if (outcome.problem !== undefined && !problems.includes(outcome.problem)) {
          problems.push(outcome.problem);
        }
      } catch (error: unknown) {
        // Said once, however many reports hit the same obstacle: a record that cannot be written
        // fails the same way on every transition, and ten identical lines would bury the run's own
        // output.
        const said = `the phase record could not be updated: ${error instanceof Error ? error.message : String(error)}`;
        if (!problems.includes(said)) problems.push(said);
      }
    },
    problems: (): readonly string[] => problems,
  };
}
