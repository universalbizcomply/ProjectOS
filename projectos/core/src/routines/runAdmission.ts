// Origin: original ProjectOS code
/**
 * Whether one occurrence of a routine may run: the record is an admitted one, the routine is enabled under
 * it, the instant is one the schedule fires at, and this occurrence has not been claimed before.
 *
 * THE CLAIM COMES LAST. Everything that can refuse for a reason of its own is asked first, so a refused run
 * does not use up its occurrence. A disabled routine claims nothing, and an instant the schedule never fires
 * at claims nothing, which is also why a slot cannot be invented to get round the replay refusal.
 *
 * ONE KEY PER OCCURRENCE. The instant is canonicalised, so the same occurrence spelled with another offset
 * derives the same key and is refused as a duplicate.
 *
 * Admission does not run the routine and does not start a timer. It answers yes or no, and the run's own
 * budget is the record's, never a shared pool.
 */
import { parseCron, isScheduledInstant } from './cronSchedule.js';
import type { RoutineState } from './fatigue.js';
import { deriveOccurrenceKey, occurrenceIntentScope, scheduledInstant, type OccurrenceClaimPort } from './occurrence.js';
import { isAdmittedRoutineRecord, type RoutineRecord } from './routineRecord.js';

export type RunRefusalCode =
  | 'RECORD_NOT_ADMITTED'
  | 'ROUTINE_MISMATCH'
  | 'ROUTINE_DISABLED'
  | 'OCCURRENCE_NOT_SCHEDULED'
  | 'OCCURRENCE_DUPLICATE';

export interface RunRequest {
  readonly record: RoutineRecord;
  readonly state: RoutineState;
  /** The instant this run is for, as the scheduler spelled it. */
  readonly instant: unknown;
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

export function admitRoutineRun(request: RunRequest, claim: OccurrenceClaimPort): RunAdmission {
  const { record, state } = request;
  if (!isAdmittedRoutineRecord(record)) return no('RECORD_NOT_ADMITTED', 'only a record the reader admitted can run');
  if (state.routineId !== record.routineId || state.approvedRecordId !== record.recordId) {
    return no('ROUTINE_MISMATCH', 'this state belongs to another routine or another record');
  }
  if (!state.enabled) return no('ROUTINE_DISABLED', 'this routine is switched off');
  const instant = scheduledInstant(request.instant);
  const parsed = parseCron(record.cron);
  if (instant === null || !parsed.ok || !isScheduledInstant(parsed.schedule, Date.parse(instant))) {
    return no('OCCURRENCE_NOT_SCHEDULED', 'that instant is not one the schedule fires at');
  }
  const occurrenceKey = deriveOccurrenceKey({
    tenant: record.tenant,
    project: record.project,
    routineId: record.routineId,
    recordHash: record.recordHash,
    instant,
  });
  if (!claim(occurrenceKey)) return no('OCCURRENCE_DUPLICATE', 'this occurrence has already been claimed, so a replay is refused');
  return { ok: true, instant, occurrenceId: occurrenceIntentScope(record.routineId, instant), occurrenceKey, runBudgetCents: record.runBudgetCents };
}
