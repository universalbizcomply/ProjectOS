/**
 * Keep the project's declared CURRENT STATE agreeing with the phase records the runtime writes.
 *
 * THE DEFECT THIS EXISTS FOR. ProjectOS wrote `.projectops/phases/<id>.json` and never touched the
 * current-state record, so the moment a phase started, the durable memory the owner-facing surfaces
 * read said `activePhase: null` while a phase was plainly running. That is not a cosmetic
 * disagreement: it is the surface reporting "between phases" during a phase, which is exactly the
 * class of untruth this recovery programme exists to end. `val-projectos-v3-active-phase-consistency1a`
 * has caught it since Phase 12 — it caught it again the first time the recovery plan opened a phase —
 * but nothing had ever FIXED the cause, only the symptom, by hand.
 *
 * WHAT IS AUTHORITATIVE. The core phase records are the lifecycle authority, exactly as that
 * validator says. This module introduces no second authority: it RECOMPUTES the state fields from
 * those records and from the active approved plan, and never takes them from a caller. A phase counts
 * as complete only when its record shows a genuine owner-or-delegate closure — the same rule
 * `governedContext` uses for dependency evidence — so this can never manufacture a completion.
 *
 * Created in the post-V3 operational recovery programme.
 */
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import { loadPhase, listPhaseIds } from './phaseStore.js';
import {
  isGenuineClosure,
  type ClosureDecisionRecord,
  type ClosureAuthorityExpectations,
} from '@projectos/core';
import type { GovernedContext } from './governedContext.js';

/**
 * The statuses this module DERIVES, and therefore the only ones it may stand back down.
 *
 * A word this module wrote must not be left standing once the condition that produced it is gone;
 * a word it never writes is not its to reset.
 */
const DERIVED_STATUSES: readonly string[] = ['IN EXECUTION', 'PLAN BLOCKED'];

/** Statuses in which work has stopped, so the phase must not be reported as the active one. */
const NOT_IN_FLIGHT: ReadonlySet<string> = new Set(['closed', 'closed_as_blocked', 'rolled_back']);

interface PhaseRecordish {
  readonly phaseId: string;
  readonly status: string;
  readonly history?: readonly { readonly to?: unknown; readonly by?: unknown }[];
}

/**
 * A GENUINE closure — the same rule the dependency gate and the owner surface apply.
 *
 * This read the closing entry's role. That mattered more here than anywhere else: what this module
 * writes into `completedPhases` is itself accepted as dependency evidence, so a rule that believed a
 * role string would have laundered a forged phase record into the declared current-state and from
 * there into the gate. Closing the bypass in the gate while leaving it open here would have moved
 * it, not removed it.
 */
function isProperlyClosed(
  p: PhaseRecordish,
  decision: ClosureDecisionRecord | null,
  expect: ClosureAuthorityExpectations,
): boolean {
  return isGenuineClosure(p as never, decision, expect);
}


export interface SyncResult {
  readonly synced: boolean;
  readonly reason?: string;
  readonly activePhase: string | null;
  readonly completed: number;
  readonly total: number;
}

/**
 * Recompute and write the declared current-state. Returns what it did, and never throws.
 *
 * A project that declares no current-state path is left alone: there is nothing to keep in step, and
 * inventing a record the project never asked for would be worse than the disagreement.
 */
export function syncCurrentState(
  sys: System,
  root: string,
  context: GovernedContext,
  role: 'owner' | 'advisor' | 'implementer',
): SyncResult {
  const statePath = context.currentStatePath;
  const planPhases = Array.isArray(context.plan['phases'])
    ? (context.plan['phases'] as { phaseId?: unknown }[])
        .map((p) => (typeof p.phaseId === 'string' ? p.phaseId : ''))
        .filter((id) => id !== '')
    : [];

  const records: PhaseRecordish[] = [];
  for (const id of listPhaseIds(sys, root)) {
    const p = loadPhase(sys, root, id) as PhaseRecordish | null;
    if (p !== null && typeof p.phaseId === 'string' && typeof p.status === 'string') records.push(p);
  }
  // Only phases of THIS plan may shape this plan's state. A closed phase of a previous programme is
  // history and belongs to the record that programme wrote, not to this one.
  const mine = records.filter((r) => planPhases.includes(r.phaseId));
  const inFlight = mine.filter((r) => !NOT_IN_FLIGHT.has(r.status));
  // The authority the ACTIVE PLAN records, and the decision each closure consumed. Both read here
  // rather than assumed, for the reason in `isProperlyClosed`.
  const gov = (context.plan['governance'] as Record<string, unknown> | undefined) ?? {};
  const del = gov['closureDelegation'] as Record<string, unknown> | undefined;
  const expectBase = {
    projectId: context.projectId,
    owner: typeof gov['owner'] === 'string' ? gov['owner'] : '',
    delegate: del !== undefined && typeof del['delegatedTo'] === 'string' ? del['delegatedTo'] : null,
  };
  const completed = planPhases.filter((id) => {
    const r = mine.find((x) => x.phaseId === id);
    if (r === undefined) return false;
    const raw = sys.readText(join(projectopsDir(root), 'closure', 'decisions', `${id}.json`));
    let decision: ClosureDecisionRecord | null = null;
    if (raw !== null) {
      try {
        decision = JSON.parse(raw) as ClosureDecisionRecord;
      } catch {
        decision = null;
      }
    }
    return isProperlyClosed(r, decision, { ...expectBase, phaseId: id });
  });
  const blocked = mine.filter((r) => r.status === 'closed_as_blocked').map((r) => r.phaseId);
  const activePhase = inFlight.length === 1 ? inFlight[0]!.phaseId : null;
  const pending = planPhases.filter(
    (id) => !completed.includes(id) && !blocked.includes(id) && id !== activePhase,
  );

  if (statePath === null) {
    return { synced: false, reason: 'this project declares no currentStatePath', activePhase, completed: completed.length, total: planPhases.length };
  }

  const existingText = sys.readText(statePath);
  if (existingText === null) {
    return { synced: false, reason: `no readable current-state at ${statePath}`, activePhase, completed: completed.length, total: planPhases.length };
  }
  let existing: Record<string, unknown>;
  try {
    const parsed = JSON.parse(existingText) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    existing = parsed as Record<string, unknown>;
  } catch {
    return { synced: false, reason: `current-state at ${statePath} is not valid JSON`, activePhase, completed: completed.length, total: planPhases.length };
  }

  const porcelain = sys.exec('git', ['status', '--porcelain']);
  const head = sys.exec('git', ['rev-parse', 'HEAD']);
  const branch = sys.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const total = planPhases.length;

  // Only the fields that are derivable from the lifecycle are rewritten. Everything else the record
  // carries is left exactly as it was: this keeps one concern in one place and means a field this
  // module has no business deciding cannot be silently reset by it.
  const next: Record<string, unknown> = {
    ...existing,
    // THE HEADLINE WORD, DERIVED LIKE EVERY OTHER LIFECYCLE FIELD HERE.
    //
    // `IN EXECUTION` and `PLAN BLOCKED` are both in the schema's vocabulary and in the owner
    // surface's type, and nothing had ever derived either — so a project with a phase plainly
    // running still announced `PLAN READY` across the top of the screen while a worker was mid-run.
    //
    // ASKED OF `inFlight`, NOT OF `activePhase`. `activePhase` is deliberately null when more than
    // one phase is in flight, because no single one of them is THE active phase. Deriving the
    // headline from it would have re-created the very untruth this exists to end, in a new place:
    // two phases running and a screen saying `PLAN READY`. Whether work is happening and which
    // phase is the active one are different questions, and only the first one decides this word.
    //
    // A BLOCKED PHASE IS NOT A READY PLAN. Standing `IN EXECUTION` down to `PLAN READY` while
    // `blockedPhases` was non-empty produced a record that contradicted itself — a ready plan
    // beside a phase closed as blocked — and understated that the owner is needed.
    //
    // BOTH ARE REVERSIBLE, which is the part that needs care: a stale `IN EXECUTION` or `PLAN
    // BLOCKED` is just as untrue in the other direction, so the two words this module derives are
    // the two it will also stand back down. Every other status the record may carry — the
    // plan-authoring words, `PAUSED`, `COMPLETE` — is left exactly as it was, because none of them
    // is decidable from the phase records read here.
    currentStatus:
      inFlight.length > 0
        ? 'IN EXECUTION'
        : completed.length === total && total > 0
          ? 'COMPLETE'
          : blocked.length > 0
            ? 'PLAN BLOCKED'
            : DERIVED_STATUSES.includes(String(existing['currentStatus']))
              ? 'PLAN READY'
              : existing['currentStatus'],
    acceptedPhaseCount: completed.length,
    totalPhaseCount: total,
    // One decimal place, matching the rule the projection and the programme validators already
    // derive with. A whole number here disagreed with them by 0.3 and failed a test whose whole
    // point is that the figure is derived rather than stored.
    completionPercentage: total === 0 ? 0 : Math.round((completed.length / total) * 1000) / 10,
    completedPhases: completed,
    activePhase,
    pendingPhases: pending,
    // THE PLAN THIS STATE IS ABOUT, AS THAT PLAN NAMES ITSELF.
    //
    // Derivable from the active plan and therefore this module's business, unlike the fields left
    // untouched above. It is rewritten because activation wrote it once and nothing ever refreshed
    // it: the first amended plan produced a record saying 1.0 beside a plan saying 1.1, and no
    // governed command could repair it. Reading it from `context.plan` makes the state record's claim
    // about which plan is in force a derived fact rather than a remembered one.
    activePlanVersion:
      typeof context.plan['planVersion'] === 'string' ? context.plan['planVersion'] : existing['activePlanVersion'],
    activePlanId: typeof context.plan['planId'] === 'string' ? context.plan['planId'] : existing['activePlanId'],
    blockedPhases: blocked,
    nextRecommendedPhase: activePhase ?? (pending.length > 0 ? pending[0]! : null),
    lastUpdated: sys.now(),
    updatedByRole: role,
  };
  if (branch.code === 0 && branch.stdout.trim() !== '') next['currentBranch'] = branch.stdout.trim();
  if (head.code === 0 && /^[0-9a-f]{40}$/.test(head.stdout.trim())) next['currentHead'] = head.stdout.trim();
  if (porcelain.code === 0) next['workingTreeStatus'] = porcelain.stdout.trim() === '' ? 'clean' : 'dirty';

  sys.writeText(statePath, `${JSON.stringify(next, null, 2)}\n`);
  return { synced: true, activePhase, completed: completed.length, total };
}

/** Where the declared current-state lives, for a message that has to name it. */
export function declaredStateRelPath(root: string, context: GovernedContext): string {
  return context.currentStatePath === null ? '(none declared)' : context.currentStatePath.slice(join(root, '').length);
}
