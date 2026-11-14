// Origin: original ProjectOS code
/**
 * Routine floors, pure (PROJECTOS-PORT-ROUTINES1A, C13). Ported files carry their own credit, and
 * `THIRD_PARTY_NOTICES` holds the licences. No file here runs a schedule, reads a clock, or calls out.
 */
export {
  ROUTINE_MINIMUM_INTERVAL_MS,
  checkScheduleFloor,
  isScheduledInstant,
  nextRoutineOccurrence,
  parseCron,
  type CronResult,
  type CronSchedule,
  type NextOccurrenceResult,
  type ScheduleFloorResult,
  type ScheduleRefusal,
  type ScheduleRefusalCode,
} from './cronSchedule.js';
export { MAX_ROUTINE_PROMPT_CHARS, scanRoutinePrompt, type RoutinePromptFinding } from './promptScan.js';
export {
  MAX_ROUTINE_WINDOW_BUDGET_CENTS,
  MAX_RUN_BUDGET_CENTS,
  ROUTINE_BUDGET_WINDOW_MS,
  ROUTINE_CATCH_UP_WINDOW_MS,
} from './runLimits.js';
export {
  admitRoutineRecord,
  isAdmittedRoutineRecord,
  type RoutineApproval,
  type RoutineRecord,
  type RoutineRecordResult,
  type RoutineRefusal,
  type RoutineRefusalCode,
} from './routineRecord.js';
export {
  MAX_ENABLED_ROUTINES,
  ROUTINE_FATIGUE_LIMIT,
  applyRunOutcome,
  enableRoutine,
  type EnableRefusalCode,
  type EnableResult,
  type OutcomeResult,
  type RoutineState,
  type RunOutcome,
} from './fatigue.js';
export {
  ROUTINE_RUN_ACTION,
  deriveOccurrenceKey,
  occurrenceIntentScope,
  scheduledInstant,
  type OccurrenceClaimPort,
  type OccurrenceIdentity,
} from './occurrence.js';
export {
  UNATTENDED_CEILING,
  admitUnattendedAction,
  type OwnerQueueEscalation,
  type OwnerQueuePort,
  type UnattendedRequest,
  type UnattendedResult,
} from './unattended.js';
export { admitRoutineRun, type RunAdmission, type RunPorts, type RunRefusalCode, type RunRequest } from './runAdmission.js';
