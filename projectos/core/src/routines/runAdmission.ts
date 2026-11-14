// Origin: original ProjectOS code
/**
 * Whether one occurrence of a routine may run now: the record is an admitted one for this tenant, the routine is
 * enabled under it, the instant is one the schedule fires at and is neither in the future nor past the catch-up
 * window, the run action is within the unattended ceiling, no other run of the routine is open, the last claimed
 * occurrence is far enough back, the routine has budget left for the window, and this occurrence has not been claimed.
 *
 * THE CLAIM COMES LAST. Everything that can refuse for a reason of its own is asked first, so a refused run does not
 * use up its occurrence. A disabled routine claims nothing, an instant the schedule never fires at claims nothing, and
 * an instant in the future or long past claims nothing, which is also why a slot cannot be invented to get round the
 * replay refusal. The one thing opened before the claim is the in-flight guard, and it is released if the claim fails.
 *
 * ONE KEY PER OCCURRENCE. The instant is canonicalised, so the same occurrence spelled with another offset derives the
 * same key and is refused as a duplicate.
 *
 * THE CLOCK, THE LEDGER AND THE OWNER QUEUE ARE PORTS. `now` is injected, so a caller cannot make a future slot look
 * due by supplying the time, and this file reads no clock. A port answers a yes only with `true`: a Promise from an
 * async port, a truthy number and a thrown error are all refusals, so a port that has not decided cannot admit a run.
 *
 * THE UNATTENDED CEILING DOES NOT DEPEND ON THE CALLER. This function asks `admitUnattendedAction` about the run action
 * itself, against the registry it is given, so a registry that raises the run action above P2 stops every run here and
 * puts the request on the owner queue.
 *
 * THE IN-FLIGHT GUARD IS OPENED HERE AND RELEASED BY THE CALLER. A successful admission leaves the routine open. When
 * the run ends, the wiring calls `release`; until then a second admission of the same routine is refused.
 *
 * Admission does not run the routine and does not start a timer. It answers yes or no, and the run's own budget is the
 * record's, never a shared pool.
 */
import type { ActionRegistry } from '../actionRegistry.js';
import { isScheduledInstant, parseCron, ROUTINE_MINIMUM_INTERVAL_MS } from './cronSchedule.js';
import type { RoutineState } from './fatigue.js';
import { deriveOccurrenceKey, occurrenceIntentScope, ROUTINE_RUN_ACTION, scheduledInstant } from './occurrence.js';
import { isAdmittedRoutineRecord, type RoutineRecord } from './routineRecord.js';
import { MAX_ROUTINE_WINDOW_BUDGET_CENTS, ROUTINE_BUDGET_WINDOW_MS, ROUTINE_CATCH_UP_WINDOW_MS } from './runLimits.js';
import { admitUnattendedAction, type OwnerQueuePort } from './unattended.js';

/** What a run is admitted against. Each answer is checked: only `true` is a yes. */
export interface RunPorts {
  /** The current time in milliseconds. Injected, never read here. */
  readonly now: () => number;
  /** True the first time an occurrence key is claimed and false after, atomically. */
  readonly claim: (key: string) => boolean;
  /** True when the routine has no run open, and opens one. False while one is open. */
  readonly tryOpen: (routineId: string) => boolean;
  /** Closes the routine's open run. Called here only when a claim fails; the caller calls it when a run ends. */
  readonly release: (routineId: string) => void;
  /** The most recent occurrence claimed for the routine, in milliseconds, or null. */
  readonly lastClaimed: (routineId: string) => number | null;
  /** The cents already admitted for the routine since the given time. */
  readonly spentSince: (routineId: string, sinceMs: number) => number;
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
  | 'UNATTENDED_GATED_ACTION'
  | 'RUN_IN_FLIGHT'
  | 'RUN_TOO_SOON'
  | 'ROUTINE_WINDOW_BUDGET'
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
    }
  | { readonly ok: false; readonly code: RunRefusalCode; readonly message: string };

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
  const slot = Date.parse(instant);
  if (slot > clock.value) return no('OCCURRENCE_IN_FUTURE', 'that occurrence is not due yet');
  if (clock.value - slot > ROUTINE_CATCH_UP_WINDOW_MS) return no('OCCURRENCE_TOO_OLD', 'that occurrence is past the catch-up window, so it is dropped');

  const occurrenceId = occurrenceIntentScope(record.routineId, instant);
  const unattended = admitUnattendedAction({ routineId: record.routineId, occurrenceId, action: ROUTINE_RUN_ACTION }, request.registry, ports.escalate);
  if (!unattended.ok) return no('UNATTENDED_GATED_ACTION', unattended.message);

  const last = ask(() => ports.lastClaimed(record.routineId));
  if (!last.ok || (last.value !== null && !Number.isSafeInteger(last.value))) return INVALID;
  if (last.value !== null) {
    const gap = Math.abs(slot - last.value);
    if (gap > 0 && gap < ROUTINE_MINIMUM_INTERVAL_MS) return no('RUN_TOO_SOON', 'that occurrence is too close to the last one claimed for this routine');
  }

  const spent = ask(() => ports.spentSince(record.routineId, clock.value - ROUTINE_BUDGET_WINDOW_MS));
  if (!spent.ok || !isWholeCents(spent.value)) return INVALID;
  if (spent.value + record.runBudgetCents > MAX_ROUTINE_WINDOW_BUDGET_CENTS) {
    return no('ROUTINE_WINDOW_BUDGET', 'this run would take the routine past its budget for the window');
  }

  const opened = ask(() => ports.tryOpen(record.routineId));
  if (!opened.ok || typeof opened.value !== 'boolean') return INVALID;
  if (opened.value !== true) return no('RUN_IN_FLIGHT', 'another run of this routine is still open');

  const occurrenceKey = deriveOccurrenceKey({
    tenant: record.tenant,
    project: record.project,
    routineId: record.routineId,
    recordHash: record.recordHash,
    instant,
  });
  const claimed = ask(() => ports.claim(occurrenceKey));
  if (!claimed.ok || claimed.value !== true) {
    ask(() => ports.release(record.routineId));
    return claimed.ok && claimed.value === false
      ? no('OCCURRENCE_DUPLICATE', 'this occurrence has already been claimed, so a replay is refused')
      : INVALID;
  }
  return { ok: true, instant, occurrenceId, occurrenceKey, runBudgetCents: record.runBudgetCents };
}
