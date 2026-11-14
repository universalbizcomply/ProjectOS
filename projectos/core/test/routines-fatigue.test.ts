import { describe, expect, it } from 'vitest';
import {
  MAX_ENABLED_ROUTINES,
  ROUTINE_FATIGUE_LIMIT,
  applyRunOutcome,
  enableRoutine,
  type RoutineState,
} from '../src/routines/index.js';
import { admitted } from './routines-support.js';

const enabled = (): RoutineState => {
  const result = enableRoutine(null, admitted(), []);
  if (!result.ok) throw new Error(`the control routine was refused: ${result.code}`);
  return result.state;
};

const failTimes = (start: RoutineState, times: number): RoutineState =>
  Array.from({ length: times }).reduce<RoutineState>((state) => applyRunOutcome(state, 'failed').state, start);

describe('at most 20 enabled routines', () => {
  const ids = (count: number): readonly string[] => Array.from({ length: count }, (_unused, index) => `routine-${index}`);

  it('states the cap and the failure limit as constants', () => {
    expect(MAX_ENABLED_ROUTINES).toBe(20);
    expect(ROUTINE_FATIGUE_LIMIT).toBe(10);
  });

  it('enables the 20th routine: the control at the cap', () => {
    expect(enableRoutine(null, admitted(), ids(19)).ok).toBe(true);
  });

  it('refuses the 21st enabled routine', () => {
    const result = enableRoutine(null, admitted(), ids(20));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ENABLED_CAP');
  });

  it('does not count a routine against the cap twice', () => {
    expect(enableRoutine(null, admitted(), [...ids(19), 'weekday-summary']).ok).toBe(true);
  });

  it('enables nothing from a record the reader did not admit', () => {
    const forged = { ...admitted() };
    const result = enableRoutine(null, forged, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RECORD_NOT_ADMITTED');
  });
});

describe('a routine that fails ten times in a row is switched off', () => {
  it('stays enabled after nine failures in a row: the control', () => {
    const state = failTimes(enabled(), ROUTINE_FATIGUE_LIMIT - 1);
    expect(state.enabled).toBe(true);
    expect(state.consecutiveFailures).toBe(9);
  });

  it('is disabled by the tenth consecutive failure, and says so once', () => {
    const ninth = failTimes(enabled(), 9);
    const tenth = applyRunOutcome(ninth, 'failed');
    expect(tenth.state.enabled).toBe(false);
    expect(tenth.state.disabledReason).toBe('FATIGUE');
    expect(tenth.switchedOff).toBe(true);
    expect(applyRunOutcome(tenth.state, 'failed').switchedOff).toBe(false);
  });

  it('counts only failures that follow one another: a success resets the count', () => {
    const state = applyRunOutcome(failTimes(enabled(), 9), 'succeeded').state;
    expect(state.consecutiveFailures).toBe(0);
    expect(failTimes(state, 9).enabled).toBe(true);
  });

  it('does not count a skipped or waiting run, and does not reset the count either', () => {
    const state = failTimes(enabled(), 3);
    expect(applyRunOutcome(state, 'skipped').state.consecutiveFailures).toBe(3);
    expect(applyRunOutcome(state, 'waiting').state.consecutiveFailures).toBe(3);
  });

  it('changes nothing in the state it was given', () => {
    const state = enabled();
    applyRunOutcome(state, 'failed');
    expect(state.consecutiveFailures).toBe(0);
    expect(Object.isFrozen(state)).toBe(true);
  });
});

describe('a disabled routine stays disabled until a new approved record', () => {
  const disabled = (): RoutineState => failTimes(enabled(), ROUTINE_FATIGUE_LIMIT);

  it('is not re-enabled by the record it was disabled under', () => {
    const result = enableRoutine(disabled(), admitted(), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NEEDS_NEW_RECORD');
  });

  it('is not re-enabled by a success, because a disabled routine does not run', () => {
    expect(applyRunOutcome(disabled(), 'succeeded').state.enabled).toBe(false);
  });

  it('is re-enabled by a new approved record for the same routine, with the count at zero', () => {
    const result = enableRoutine(disabled(), admitted({ recordId: 'RTN-weekday-summary-v2' }), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.enabled).toBe(true);
      expect(result.state.consecutiveFailures).toBe(0);
      expect(result.state.enabledUnderRecordId).toBe('RTN-weekday-summary-v2');
    }
  });

  it('is not re-enabled by a record for another routine', () => {
    const result = enableRoutine(disabled(), admitted({ recordId: 'RTN-other-v1', routineId: 'other' }), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROUTINE_MISMATCH');
  });

  it('is still held to the cap when it is re-enabled', () => {
    const full = Array.from({ length: 20 }, (_unused, index) => `routine-${index}`);
    const result = enableRoutine(disabled(), admitted({ recordId: 'RTN-weekday-summary-v2' }), full);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ENABLED_CAP');
  });
});
