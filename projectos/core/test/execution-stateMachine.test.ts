import { describe, it, expect } from 'vitest';
import {
  EXECUTION_TRANSITIONS,
  EXECUTION_STATES,
  TERMINAL_STATES,
  canExecutionTransition,
  isExecutionTerminal,
  allowedNext,
  type ExecutionState,
} from '../src/execution/index.js';

describe('execution state machine', () => {
  it('enumerates all 16 states', () => {
    expect(EXECUTION_STATES).toHaveLength(16);
  });

  it('terminal states are STOPPED, CANCELLED, FAILED and have no outgoing edges', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['CANCELLED', 'FAILED', 'STOPPED']);
    for (const t of TERMINAL_STATES) {
      expect(isExecutionTerminal(t)).toBe(true);
      expect(allowedNext(t)).toHaveLength(0);
    }
  });

  it('every declared transition is individually valid and its reverse is not implied', () => {
    for (const from of EXECUTION_STATES) {
      for (const to of EXECUTION_TRANSITIONS[from]) {
        expect(canExecutionTransition(from, to)).toBe(true);
      }
    }
  });

  it('rejects representative invalid transitions (no ambiguous any->state)', () => {
    const invalid: ReadonlyArray<[ExecutionState, ExecutionState]> = [
      ['IDLE', 'RUNNING'],
      ['READY', 'PAUSED'],
      ['RUNNING', 'STOPPED'],
      ['PAUSED', 'RUNNING'],
      ['STOPPED', 'READY'],
      ['CANCELLED', 'RUNNING'],
      ['FAILED', 'READY'],
      ['BLOCKED', 'RUNNING'],
      ['UNAVAILABLE', 'READY'],
    ];
    for (const [from, to] of invalid) expect(canExecutionTransition(from, to)).toBe(false);
  });

  it('RECOVERING resolves only to READY/PAUSED/STOPPED/FAILED/BLOCKED/UNAVAILABLE', () => {
    expect([...EXECUTION_TRANSITIONS.RECOVERING].sort()).toEqual(['BLOCKED', 'FAILED', 'PAUSED', 'READY', 'STOPPED', 'UNAVAILABLE']);
  });

  it('BLOCKED and UNAVAILABLE are held (non-terminal) and recover only via RECOVERING', () => {
    expect(TERMINAL_STATES.has('BLOCKED')).toBe(false);
    expect(TERMINAL_STATES.has('UNAVAILABLE')).toBe(false);
    expect(canExecutionTransition('BLOCKED', 'RECOVERING')).toBe(true);
    expect(canExecutionTransition('UNAVAILABLE', 'RECOVERING')).toBe(true);
    expect(canExecutionTransition('BLOCKED', 'RUNNING')).toBe(false);
    expect(canExecutionTransition('UNAVAILABLE', 'RUNNING')).toBe(false);
    expect(canExecutionTransition('RECOVERING', 'UNAVAILABLE')).toBe(true);
  });

  it('emergency path is EMERGENCY_STOP_REQUESTED -> CANCELLING -> CANCELLED (not STOPPED)', () => {
    expect(canExecutionTransition('EMERGENCY_STOP_REQUESTED', 'CANCELLING')).toBe(true);
    expect(canExecutionTransition('CANCELLING', 'CANCELLED')).toBe(true);
    expect(canExecutionTransition('EMERGENCY_STOP_REQUESTED', 'STOPPED')).toBe(false);
  });
});
