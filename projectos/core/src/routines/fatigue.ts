// SPDX-License-Identifier: MIT
// Ported-From: copilotkit-openbot https://github.com/CopilotKit/OpenBot
// Source-Path: server/src/routines/runner.ts
// Source-Commit: c396a5f68c817043846f1ca3c2b42061ee73ceb5
// Source-Copyright: Copyright (c) 2026 CopilotKit
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: only the fatigue rule was taken from the runner; the database store, the channel notices and the turn runner were not ported; the rule is a pure function over an immutable state; a disabled routine stays disabled until a new admitted record, where upstream re-enables on a person's request in chat; the cap of 20 enabled routines is stated here
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The two counts that keep a routine from running too often or for ever: how many routines may be enabled,
 * and how many failed runs in a row switch one off.
 *
 * TWO LEDGERS, AND THEY ARE NOT THE SAME LEDGER. Upstream keeps a queue's attempt count, which bounds retries
 * of one firing, apart from this rule, which counts consecutive firings that failed, across days. A Notion
 * token that expired in March fails every night, and no number of retries of one night's firing fixes it.
 * This module is only the second. It counts a run once, whatever happened inside it.
 *
 * WHAT COUNTS. A failed run adds one. A succeeded run resets the count. A skipped run (the routine was paused,
 * its channel gone) and a waiting run (it asked for something and is parked) change nothing, so a long pause
 * never trips the rule. The count includes the run being recorded, so the tenth failure in a row reads as the
 * tenth, not the ninth.
 *
 * SWITCHED OFF STAYS OFF. A routine disabled for fatigue is enabled again only by a new admitted record for
 * the same routine, one that names a plan decision of its own. The record it was disabled under does not
 * count, and nothing a run does re-enables it, because a disabled routine does not run.
 *
 * WHAT THIS MODULE CANNOT PROVE. A state is data the store holds, and a forged state says what it likes; the
 * store that reads states from committed records has to refuse one it did not write. Pure: no I/O.
 */
import { isAdmittedRoutineRecord, type RoutineRecord } from './routineRecord.js';

/** Consecutive failed runs after which a routine stops being run at all. */
export const ROUTINE_FATIGUE_LIMIT = 10;

/** No more than this many routines are enabled at once. */
export const MAX_ENABLED_ROUTINES = 20;

export type RunOutcome = 'succeeded' | 'failed' | 'skipped' | 'waiting';

export interface RoutineState {
  readonly routineId: string;
  /** The record this state was enabled under. */
  readonly enabledUnderRecordId: string;
  readonly enabled: boolean;
  readonly consecutiveFailures: number;
  readonly disabledReason: 'FATIGUE' | null;
}

export type EnableRefusalCode = 'RECORD_NOT_ADMITTED' | 'ROUTINE_MISMATCH' | 'NEEDS_NEW_RECORD' | 'ENABLED_CAP';

export type EnableResult =
  | { readonly ok: true; readonly state: RoutineState }
  | { readonly ok: false; readonly code: EnableRefusalCode; readonly message: string };

const no = (code: EnableRefusalCode, message: string): EnableResult => ({ ok: false, code, message });

/**
 * Enable a routine under an admitted record. `enabledRoutineIds` is every routine enabled now, and a routine
 * already in it is not counted twice.
 */
export function enableRoutine(prior: RoutineState | null, record: RoutineRecord, enabledRoutineIds: readonly string[]): EnableResult {
  if (!isAdmittedRoutineRecord(record)) return no('RECORD_NOT_ADMITTED', 'only a record the reader admitted can enable a routine');
  if (prior !== null && prior.routineId !== record.routineId) return no('ROUTINE_MISMATCH', `this record is for '${record.routineId}', not '${prior.routineId}'`);
  if (prior !== null && prior.disabledReason === 'FATIGUE' && prior.enabledUnderRecordId === record.recordId) {
    return no('NEEDS_NEW_RECORD', 'this routine was switched off after repeated failures, and only a new record that names a plan decision turns it back on');
  }
  const others = enabledRoutineIds.filter((id) => id !== record.routineId);
  if (others.length >= MAX_ENABLED_ROUTINES) return no('ENABLED_CAP', `at most ${MAX_ENABLED_ROUTINES} routines may be enabled`);
  return {
    ok: true,
    state: Object.freeze({ routineId: record.routineId, enabledUnderRecordId: record.recordId, enabled: true, consecutiveFailures: 0, disabledReason: null }),
  };
}

export interface OutcomeResult {
  readonly state: RoutineState;
  /** True once, on the run that switched the routine off. */
  readonly switchedOff: boolean;
}

/** The state after a run, and whether this run switched the routine off. The state given is not changed. */
export function applyRunOutcome(state: RoutineState, outcome: RunOutcome): OutcomeResult {
  if (!state.enabled) return { state, switchedOff: false };
  if (outcome === 'skipped' || outcome === 'waiting') return { state, switchedOff: false };
  if (outcome === 'succeeded') {
    return { state: Object.freeze({ ...state, consecutiveFailures: 0 }), switchedOff: false };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= ROUTINE_FATIGUE_LIMIT) {
    return { state: Object.freeze({ ...state, consecutiveFailures, enabled: false, disabledReason: 'FATIGUE' as const }), switchedOff: true };
  }
  return { state: Object.freeze({ ...state, consecutiveFailures }), switchedOff: false };
}
