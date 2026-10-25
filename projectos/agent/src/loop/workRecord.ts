/**
 * WHERE AUTONOMOUS WORK IS, WHEN NOTHING IS RUNNING.
 *
 * ProjectOS could already carry one phase from a worker through evidence, a live gatekeeper call and
 * a correction, autonomously, inside a single `runLoop`. What it could not do is remember any of that
 * across a process boundary: the loop returned, the process ended, and the next start re-derived
 * everything from scratch with no account of what had already been done or why it had stopped.
 *
 * This is that account, and it is deliberately ONE record per project — not a second queue.
 *
 * WHAT IT IS NOT, AND THIS IS THE WHOLE DESIGN:
 *
 *   - NOT AN ORCHESTRATOR. `runLoop` remains the only execution loop.
 *   - NOT A PLANNER. `selectNextPhase` remains the only phase selection, and the phase records
 *     remain the only inventory of governed work. Copying them here would create a second answer to
 *     "what work exists", and the day the two disagreed the wrong one would win silently.
 *   - NOT AUTHORITY. A record saying `GATE_APPROVED`, or `nextAction: 'commit'`, authorises exactly
 *     nothing. Authority comes from a live decision checked inside the transition that asked for it,
 *     and from nowhere else. The implementer can write to this checkout, so a file that granted
 *     permission by existing would hand Claude what the decision contract denies it. There is no
 *     function in this module that approves, authorises or permits anything, and
 *     `val-projectos-work-record-not-authority1a` exists to keep that true.
 *
 * WHAT IT IS: somewhere to write down what was selected, what state it reached, at which commit, why
 * it stopped, and what would be considered next — by REFERENCE to the canonical records, never by
 * copying their contents. Evidence, gate decisions, briefs and sessions each already have one home.
 *
 * Created in PROJECTOS-GOVERNED-WORK-QUEUE-CHECKPOINT1A (B2 + B3).
 */
import { join } from 'node:path';
import { projectopsDir } from '../context.js';
import type { System } from '../system.js';
import type { LoopStopCode } from './outcome.js';

/** The record's own version. A record from a future ProjectOS is refused, never guessed at. */
export const WORK_RECORD_SCHEMA_VERSION = '1.0.0';

/** `.projectops/work.v1.json` — one current work item per governed project. */
export const WORK_RECORD_REL = '.projectops/work.v1.json';

export function workRecordPath(root: string): string {
  return join(projectopsDir(root), 'work.v1.json');
}

/**
 * Programme B's work vocabulary.
 *
 * SOME OF THESE ARE NOT REACHABLE YET, AND THAT IS DELIBERATE. `WAITING_AI` and `RESUMING` need B4
 * and B8; nothing in this phase manufactures a transition into them. The type carries them so the
 * later phases extend a vocabulary rather than replace one — but a state ProjectOS has not earned is
 * never written, because a checkpoint that claims a state it never reached is worse than no
 * checkpoint at all.
 */
export const WORK_STATES = [
  'QUEUED',
  'PLANNING',
  'EXECUTING',
  'VALIDATING',
  'AWAITING_GATE',
  'GATE_APPROVED',
  'CORRECTION_REQUIRED',
  'WAITING_AI',
  'WAITING_OWNER',
  'BLOCKED',
  'RESUMING',
  'COMPLETE',
] as const;

export type WorkState = (typeof WORK_STATES)[number];

/**
 * One durable work item and its checkpoint.
 *
 * Every reference field names a record that lives elsewhere. Nothing here duplicates an evidence
 * pack, a prompt, a provider response or a gate decision's content: two copies of one fact drift,
 * and the copy that drifts is the one somebody later trusts.
 */
export interface WorkRecord {
  readonly schemaVersion: string;
  /** The registry-bound project this work belongs to. Never a root, never a path. */
  readonly projectId: string;
  /** The phase the phase records already declare. This record does not invent work. */
  readonly phaseId: string;
  readonly state: WorkState;
  /** The execution session, when one exists. A reference to `.projectops/execution/<id>.*`. */
  readonly sessionId: string | null;
  /** Which correction attempt, when the loop has taken one. */
  readonly attempt: number | null;
  /**
   * The commit the completed step was established against.
   *
   * THE FIELD B8 WILL NEED MOST. A checkpoint that cannot say which bytes it describes cannot be
   * resumed safely, because the repository may have moved underneath it.
   */
  readonly subjectCommit: string | null;
  /** The last meaningful step that finished, in the loop's own words. */
  readonly lastCompletedStep: string | null;
  /** Why execution stopped, as the loop's own closed stop vocabulary. */
  readonly lastStopCode: LoopStopCode | null;
  readonly lastStopDetail: string | null;
  /** Evidence for this work, BY REFERENCE. Session-scoped record ids, never their contents. */
  readonly evidenceSessionId: string | null;
  /** The gate decision this work last received, BY REFERENCE. Referencing it grants nothing. */
  readonly gateDecisionId: string | null;
  /**
   * What would be considered next, if anything.
   *
   * A CANDIDATE, NEVER A PERMIT. B6 will decide whether a candidate action may actually be taken,
   * from the gate decision that authorised it — not from this string.
   */
  readonly nextCandidateAction: string | null;
  readonly ownerRequired: boolean;
  readonly updatedAt: string;
}

/** Whether a value is one of the twelve states. An unknown state is refused, never coerced. */
export function isWorkState(value: unknown): value is WorkState {
  return typeof value === 'string' && (WORK_STATES as readonly string[]).includes(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Start a work item for a phase. Records only what is known at selection time.
 *
 * Not "create work" — the phase records already declare the work. This records that ProjectOS has
 * SELECTED it and is about to act on it.
 */
export function beginWork(args: {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string | null;
  readonly at: string;
}): WorkRecord {
  return {
    schemaVersion: WORK_RECORD_SCHEMA_VERSION,
    projectId: args.projectId,
    phaseId: args.phaseId,
    state: 'QUEUED',
    sessionId: null,
    attempt: null,
    subjectCommit: args.subjectCommit,
    lastCompletedStep: null,
    lastStopCode: null,
    lastStopDetail: null,
    evidenceSessionId: null,
    gateDecisionId: null,
    nextCandidateAction: null,
    ownerRequired: false,
    updatedAt: args.at,
  };
}

/** What may change as work progresses. `projectId` and `phaseId` are NOT among them. */
export type WorkProgress = Partial<
  Omit<WorkRecord, 'schemaVersion' | 'projectId' | 'phaseId' | 'updatedAt'>
>;

/**
 * Advance a work item.
 *
 * IDENTITY IS IMMUTABLE HERE. A progression cannot move a record to another project or another
 * phase: that would let one project's checkpoint quietly become another's, which is the single
 * worst thing this record could do. A different phase is a different work item.
 */
export function advanceWork(record: WorkRecord, progress: WorkProgress, at: string): WorkRecord {
  return { ...record, ...progress, updatedAt: at };
}

/** The record, `null` when absent, or the reason it cannot be used. */
export type WorkReadResult =
  | { readonly ok: true; readonly value: WorkRecord | null }
  | { readonly ok: false; readonly problem: string };

/**
 * Read the work record for a project.
 *
 * A MALFORMED RECORD IS NOT AN ABSENT ONE. The same rule `readSession` had to learn: treating
 * unreadable as absent means a corrupted checkpoint silently restarts the work it was tracking, and
 * every guarantee that depended on remembering is gone without a word.
 */
export function readWorkRecord(sys: System, root: string): WorkReadResult {
  const path = workRecordPath(root);
  const raw = sys.readText(path);
  if (raw === null) return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: `the work record at ${WORK_RECORD_REL} is not readable JSON` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problem: `the work record at ${WORK_RECORD_REL} is not an object` };
  }
  const r = parsed as Record<string, unknown>;

  if (r['schemaVersion'] !== WORK_RECORD_SCHEMA_VERSION) {
    return {
      ok: false,
      problem:
        `the work record declares schemaVersion ${JSON.stringify(r['schemaVersion'])}, and this ` +
        `runtime writes ${WORK_RECORD_SCHEMA_VERSION}`,
    };
  }
  const projectId = str(r['projectId']);
  const phaseId = str(r['phaseId']);
  if (projectId === null || phaseId === null) {
    return { ok: false, problem: 'the work record names no project or no phase' };
  }
  if (!isWorkState(r['state'])) {
    return { ok: false, problem: `the work record declares an unrecognised state ${JSON.stringify(r['state'])}` };
  }
  return { ok: true, value: parsed as WorkRecord };
}

/** Persist the work record. Writes what it is given; decides nothing. */
export function writeWorkRecord(sys: System, root: string, record: WorkRecord): void {
  sys.writeText(workRecordPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

/** What a resume must match. Established by the runtime, never read from the record. */
export interface ResumeExpectations {
  readonly projectId: string;
  readonly subjectCommit: string | null;
}

/**
 * Why this record cannot be resumed as-is, or `[]` when it can.
 *
 * FAIL CLOSED, AND STOP SHORT OF FIXING IT. Reconciling a moved repository — deciding whether the
 * commit that appeared was this work's own, and what that means — is B8's job. What this owes B8 is
 * a truthful refusal and the two facts it needs: which project, and which commit.
 *
 * Returns every reason rather than the first, so one refusal shows the whole gap.
 */
export function resumeProblems(record: WorkRecord, expect: ResumeExpectations): readonly string[] {
  const problems: string[] = [];

  if (record.projectId !== expect.projectId) {
    problems.push(
      `the work record belongs to project '${record.projectId}', not '${expect.projectId}' — one ` +
        "project's checkpoint can never continue another's work",
    );
  }

  // A checkpoint with no commit describes work whose subject was never established; it is not
  // evidence that the repository is unchanged.
  if (record.subjectCommit === null) {
    if (expect.subjectCommit !== null) {
      problems.push(
        'the work record names no subject commit, so there is nothing to compare this checkout ' +
          'against and no safe way to tell what has already been done',
      );
    }
  } else if (expect.subjectCommit === null) {
    problems.push(
      `the work record was established against ${record.subjectCommit.slice(0, 7)}, and this ` +
        'checkout reports no head to compare it with',
    );
  } else if (record.subjectCommit !== expect.subjectCommit) {
    problems.push(
      `the work record was established against ${record.subjectCommit.slice(0, 7)}, but this ` +
        `checkout is at ${expect.subjectCommit.slice(0, 7)} — the repository moved, so the ` +
        'completed steps it records may no longer describe these bytes',
    );
  }

  return problems;
}
