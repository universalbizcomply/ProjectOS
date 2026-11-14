// Origin: original ProjectOS code
/**
 * Whether one occurrence of a routine may run now: the record is an admitted one for this tenant, the routine is
 * enabled under it, the instant is one the schedule fires at and is neither in the future nor past the catch-up
 * window, the last claimed occurrence is far enough back, the routine and its project have budget left for the
 * window, the run action is within the unattended ceiling, no other run of the routine is open, and this occurrence
 * has not been claimed.
 *
 * THE CLAIM COMES LAST. Everything that can refuse for a reason of its own is asked first, so a refused run does not
 * use up its occurrence. A disabled routine claims nothing, an instant the schedule never fires at claims nothing, and
 * an instant in the future or long past claims nothing, which is also why a slot cannot be invented to get round the
 * replay refusal. The one thing opened before the claim is the in-flight guard, and every path that opened it and does
 * not end in a claim releases it.
 *
 * ONE KEY PER OCCURRENCE. The instant is canonicalised, so the same occurrence spelled with another offset derives the
 * same key and is refused as a duplicate. The key is the tenant, project, routine and slot, not the record version, so
 * re-recording a routine does not give its slots a second run.
 *
 * ONE SCOPE PER TENANT, PROJECT AND ROUTINE. The in-flight guard, the last claimed occurrence and the spend are all
 * read and written under a scope key built from the tenant, the project and the routine id, never the routine id alone,
 * so two tenants that both call a routine `daily` do not share a guard, a spacing or a budget. The project has its own
 * scope for the aggregate cap, so twenty routines in one project do not each bring a full routine cap.
 *
 * THE CLOCK, THE LEDGER AND THE OWNER QUEUE ARE PORTS. `now` is injected, so a caller cannot make a future slot look
 * due by supplying the time, and this file reads no clock. A port answers a yes only with `true`: a Promise from an
 * async port, a truthy number and a thrown error are all refusals, so a port that has not decided cannot admit a run.
 *
 * THE UNATTENDED CEILING DOES NOT DEPEND ON THE CALLER. This function asks `admitUnattendedAction` about the run action
 * itself, against the registry it is given, so a registry that raises the run action above P2 stops every run here and
 * puts the request on the owner queue. The owner is told only after the spacing and the budgets have passed, so a run
 * that was going to be refused anyway does not fill the queue.
 *
 * THE IN-FLIGHT GUARD IS OPENED HERE AND RELEASED BY THE CALLER, OR IT LAPSES. A successful admission leaves the routine
 * open for at most `ROUTINE_RUN_LEASE_MS`. When the run ends the wiring calls `release`; if the run crashes, the lease
 * runs out and the next run is admitted. The port enforces the lease from the time and length it is given. A path that
 * opened the guard and did not claim releases it, including when the answer about opening was not a boolean (the port may
 * have opened it); if that release itself fails, the refusal says `releaseFailed: true` so the caller can act on it.
 *
 * Admission does not run the routine and does not start a timer. It answers yes or no, and the run's own budget is the
 * record's, never a shared pool.
 */
import type { ActionRegistry } from '../actionRegistry.js';
import { isScheduledInstant, parseCron, ROUTINE_MINIMUM_INTERVAL_MS } from './cronSchedule.js';
import type { RoutineState } from './fatigue.js';
import { deriveOccurrenceKey, occurrenceIntentScope, ROUTINE_RUN_ACTION, scheduledInstant } from './occurrence.js';
import { isAdmittedRoutineRecord, type RoutineRecord } from './routineRecord.js';
import {
  MAX_PROJECT_WINDOW_BUDGET_CENTS,
  MAX_ROUTINE_WINDOW_BUDGET_CENTS,
  ROUTINE_BUDGET_WINDOW_MS,
  ROUTINE_CATCH_UP_WINDOW_MS,
  ROUTINE_RUN_LEASE_MS,
} from './runLimits.js';
import { admitUnattendedAction, type OwnerQueuePort } from './unattended.js';

/** Who a routine belongs to. The same three fields make the occurrence key. */
export interface RoutineScope {
  readonly tenant: string;
  readonly project: string;
  readonly routineId: string;
}

/** The key the guard, the last claim and the routine's spend are held under: tenant, project and routine, as an array. */
export const routineScopeKey = (scope: RoutineScope): string => JSON.stringify(['routine', scope.tenant, scope.project, scope.routineId]);

/** The key the project's aggregate spend is held under: tenant and project, as an array. */
export const projectScopeKey = (scope: Pick<RoutineScope, 'tenant' | 'project'>): string => JSON.stringify(['project', scope.tenant, scope.project]);

/** What a run is admitted against. Each answer is checked: only `true` is a yes. */
export interface RunPorts {
  /** The current time in milliseconds. Injected, never read here. */
  readonly now: () => number;
  /** True the first time an occurrence key is claimed and false after, atomically. */
  readonly claim: (key: string) => boolean;
  /**
   * Atomically: true, and opens a run under the scope, when no run is open under it whose `openedAt + leaseMs` is still
   * ahead of `nowMs`; false otherwise. The lease is what lets a crashed run stop blocking.
   */
  readonly tryOpen: (scope: string, nowMs: number, leaseMs: number) => boolean;
  /** Closes the scope's open run. Called here only when no claim followed the open; the caller calls it when a run ends. */
  readonly release: (scope: string) => void;
  /** The most recent occurrence claimed under the routine scope, in milliseconds, or null. */
  readonly lastClaimed: (scope: string) => number | null;
  /** The cents already admitted under the scope (a routine scope or a project scope) since the given time. */
  readonly spentSince: (scope: string, sinceMs: number) => number;
  /** Puts one item on the owner queue. */
  readonly escalate: OwnerQueuePort;
}

export type RunRefusalCode =
  | 'RECORD_NOT_ADMITTED'
  | 'TENANT_MISMATCH'
  | 'ROUTINE_MISMATCH'
  | 'ROUTINE_DISABLED'
  | 'OCCURRENCE_NOT_SCHEDULED'
  | 'OCCURRENCE_IN_FUTURE'
  | 'OCCURRENCE_TOO_OLD'
  | 'RUN_TOO_SOON'
  | 'ROUTINE_WINDOW_BUDGET'
  | 'PROJECT_WINDOW_BUDGET'
  | 'UNATTENDED_GATED_ACTION'
  | 'RUN_IN_FLIGHT'
  | 'OCCURRENCE_DUPLICATE'
  | 'PORT_ANSWER_INVALID';

export interface RunRequest {
  readonly record: RoutineRecord;
  readonly state: RoutineState;
  /** The instant this run is for, as the scheduler spelled it. */
  readonly instant: unknown;
  /** The tenant this run would execute for. A record for another tenant does not run. */
  readonly tenant: string;
  /** The registry the run action is classed against. */
  readonly registry: ActionRegistry;
}

export type RunAdmission =
  | {
      readonly ok: true;
      readonly instant: string;
      readonly occurrenceId: string;
      readonly occurrenceKey: string;
      readonly runBudgetCents: number;
      /** For the ledger entry: which version of the record this run is under. */
      readonly recordHash: string;
      /** What to release when the run ends, and to record spend under. */
      readonly routineScope: string;
      readonly projectScope: string;
    }
  | {
      readonly ok: false;
      readonly code: RunRefusalCode;
      readonly message: string;
      /** True when the guard had to be released and the release itself failed, so the caller can act on it. */
      readonly releaseFailed?: true;
    };

const no = (code: RunRefusalCode, message: string): RunAdmission => ({ ok: false, code, message });
const INVALID = no('PORT_ANSWER_INVALID', 'a port did not answer with what it was asked for, so the run is refused');

type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** Call a port. A throw is no answer. */
function ask<T>(call: () => T): Answer<T> {
  try {
    return { ok: true, value: call() };
  } catch {
    return { ok: false };
  }
}

const isWholeCents = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** What admission needs once the guard is open. Anything but a claim leaves the guard to be released. */
function claimOccurrence(record: RoutineRecord, instant: string, occurrenceId: string, ports: RunPorts): RunAdmission {
  const occurrenceKey = deriveOccurrenceKey({ tenant: record.tenant, project: record.project, routineId: record.routineId, instant });
  const claimed = ask(() => ports.claim(occurrenceKey));
  if (!claimed.ok || claimed.value !== true) {
    return claimed.ok && claimed.value === false ? no('OCCURRENCE_DUPLICATE', 'this occurrence has already been claimed, so a replay is refused') : INVALID;
  }
  return {
    ok: true,
    instant,
    occurrenceId,
    occurrenceKey,
    runBudgetCents: record.runBudgetCents,
    recordHash: record.recordHash,
    routineScope: routineScopeKey(record),
    projectScope: projectScopeKey(record),
  };
}

export function admitRoutineRun(request: RunRequest, ports: RunPorts): RunAdmission {
  const { record, state } = request;
  if (!isAdmittedRoutineRecord(record)) return no('RECORD_NOT_ADMITTED', 'only a record the reader admitted can run');
  if (request.tenant !== record.tenant) return no('TENANT_MISMATCH', 'this record is for another tenant than the one the run is for');
  if (state.routineId !== record.routineId || state.enabledUnderRecordId !== record.recordId) {
    return no('ROUTINE_MISMATCH', 'this state belongs to another routine or another record');
  }
  if (!state.enabled) return no('ROUTINE_DISABLED', 'this routine is switched off');
  const instant = scheduledInstant(request.instant);
  const parsed = parseCron(record.cron);
  if (instant === null || !parsed.ok || !isScheduledInstant(parsed.schedule, Date.parse(instant))) {
    return no('OCCURRENCE_NOT_SCHEDULED', 'that instant is not one the schedule fires at');
  }

  const clock = ask(ports.now);
  if (!clock.ok || typeof clock.value !== 'number' || !Number.isSafeInteger(clock.value)) return INVALID;
  const now = clock.value;
  const slot = Date.parse(instant);
  if (slot > now) return no('OCCURRENCE_IN_FUTURE', 'that occurrence is not due yet');
  if (now - slot > ROUTINE_CATCH_UP_WINDOW_MS) return no('OCCURRENCE_TOO_OLD', 'that occurrence is past the catch-up window, so it is dropped');

  const routineScope = routineScopeKey(record);
  const projectScope = projectScopeKey(record);
  const last = ask(() => ports.lastClaimed(routineScope));
  if (!last.ok || (last.value !== null && !Number.isSafeInteger(last.value))) return INVALID;
  if (last.value !== null) {
    const gap = Math.abs(slot - last.value);
    if (gap > 0 && gap < ROUTINE_MINIMUM_INTERVAL_MS) return no('RUN_TOO_SOON', 'that occurrence is too close to the last one claimed for this routine');
  }

  const since = now - ROUTINE_BUDGET_WINDOW_MS;
  const routineSpent = ask(() => ports.spentSince(routineScope, since));
  if (!routineSpent.ok || !isWholeCents(routineSpent.value)) return INVALID;
  if (routineSpent.value + record.runBudgetCents > MAX_ROUTINE_WINDOW_BUDGET_CENTS) {
    return no('ROUTINE_WINDOW_BUDGET', 'this run would take the routine past its budget for the window');
  }
  const projectSpent = ask(() => ports.spentSince(projectScope, since));
  if (!projectSpent.ok || !isWholeCents(projectSpent.value)) return INVALID;
  if (projectSpent.value + record.runBudgetCents > MAX_PROJECT_WINDOW_BUDGET_CENTS) {
    return no('PROJECT_WINDOW_BUDGET', 'this run would take the project past its budget for the window');
  }

  const occurrenceId = occurrenceIntentScope(record.routineId, instant);
  const unattended = admitUnattendedAction({ routineId: record.routineId, occurrenceId, action: ROUTINE_RUN_ACTION }, request.registry, ports.escalate);
  if (!unattended.ok) return no('UNATTENDED_GATED_ACTION', unattended.message);

  const opened = ask(() => ports.tryOpen(routineScope, now, ROUTINE_RUN_LEASE_MS));
  if (opened.ok && opened.value === false) return no('RUN_IN_FLIGHT', 'another run of this routine is still open');
  // From here the guard may be open: it was, or the port did not say. Anything but a claim releases it.
  let outcome: RunAdmission = INVALID;
  if (opened.ok && opened.value === true) {
    const claimed = ask(() => claimOccurrence(record, instant, occurrenceId, ports));
    if (claimed.ok) outcome = claimed.value;
  }
  if (outcome.ok) return outcome;
  const released = ask(() => ports.release(routineScope));
  return released.ok ? outcome : { ...outcome, releaseFailed: true };
}
