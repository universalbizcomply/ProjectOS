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
import { join } from './context.js';
import { loadPhase, listPhaseIds } from './phaseStore.js';
import type { GovernedContext } from './governedContext.js';

/** Statuses in which work has stopped, so the phase must not be reported as the active one. */
const NOT_IN_FLIGHT: ReadonlySet<string> = new Set(['closed', 'closed_as_blocked', 'rolled_back']);

interface PhaseRecordish {
  readonly phaseId: string;
  readonly status: string;
  readonly history?: readonly { readonly to?: unknown; readonly by?: unknown }[];
}

/**
 * A genuine owner-or-delegate closure, not merely the word "closed".
 *
 * Mirrors `governedContext.isOwnerClosed`. Duplicated deliberately rather than exported and shared:
 * the two are the same rule applied for different purposes, and the copy is four lines, whereas
 * coupling dependency evidence to state bookkeeping would mean a change to one silently changing
 * what the other accepts.
 */
function isProperlyClosed(p: PhaseRecordish): boolean {
  if (p.status !== 'closed') return false;
  const history = Array.isArray(p.history) ? p.history : [];
  const last = history[history.length - 1];
  return last !== undefined && last.to === 'closed' && (last.by === 'owner' || last.by === 'advisor');
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
  const completed = planPhases.filter((id) => {
    const r = mine.find((x) => x.phaseId === id);
    return r !== undefined && isProperlyClosed(r);
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
    currentStatus: activePhase === null && completed.length === total && total > 0 ? 'COMPLETE' : existing['currentStatus'],
    acceptedPhaseCount: completed.length,
    totalPhaseCount: total,
    // One decimal place, matching the rule the projection and the programme validators already
    // derive with. A whole number here disagreed with them by 0.3 and failed a test whose whole
    // point is that the figure is derived rather than stored.
    completionPercentage: total === 0 ? 0 : Math.round((completed.length / total) * 1000) / 10,
    completedPhases: completed,
    activePhase,
    pendingPhases: pending,
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
