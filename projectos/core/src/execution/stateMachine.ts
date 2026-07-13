/**
 * The authoritative execution transition table. Every allowed transition is enumerated explicitly;
 * there is no `any -> state` edge. Terminal states have no outgoing edges. Pure/deterministic.
 * Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A.
 */
import type { ExecutionState } from './types.js';
import { TERMINAL_STATES } from './types.js';

/** Allowed next-states per state (exactly the DESIGN1B / CORE1A transition model). */
export const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionState, ReadonlySet<ExecutionState>>> = {
  IDLE: new Set(['READY']),
  READY: new Set(['STARTING', 'BLOCKED', 'UNAVAILABLE']),
  // In-flight states can additionally enter RECOVERING (controller-initiated reconciliation only).
  STARTING: new Set(['RUNNING', 'FAILED', 'STOP_REQUESTED', 'EMERGENCY_STOP_REQUESTED', 'RECOVERING']),
  RUNNING: new Set(['PAUSE_REQUESTED', 'STOP_REQUESTED', 'EMERGENCY_STOP_REQUESTED', 'FAILED', 'RECOVERING']),
  PAUSE_REQUESTED: new Set(['PAUSED', 'RUNNING', 'STOP_REQUESTED', 'EMERGENCY_STOP_REQUESTED', 'FAILED', 'RECOVERING']),
  PAUSED: new Set(['RESUME_REQUESTED', 'STOP_REQUESTED', 'EMERGENCY_STOP_REQUESTED', 'FAILED']),
  RESUME_REQUESTED: new Set(['RUNNING', 'PAUSED', 'STOP_REQUESTED', 'EMERGENCY_STOP_REQUESTED', 'FAILED', 'RECOVERING']),
  STOP_REQUESTED: new Set(['STOPPED', 'EMERGENCY_STOP_REQUESTED', 'FAILED', 'RECOVERING']),
  EMERGENCY_STOP_REQUESTED: new Set(['CANCELLING', 'CANCELLED', 'FAILED', 'RECOVERING']),
  CANCELLING: new Set(['CANCELLED', 'FAILED', 'RECOVERING']),
  // Recovery may only resolve to these; RECOVERING is entered by the controller during recover().
  RECOVERING: new Set(['READY', 'PAUSED', 'STOPPED', 'FAILED', 'BLOCKED', 'UNAVAILABLE']),
  // Terminal — immutable.
  STOPPED: new Set(),
  CANCELLED: new Set(),
  FAILED: new Set(),
  // Held (non-terminal) states: the only exit is owner-initiated recovery.
  BLOCKED: new Set(['RECOVERING']),
  UNAVAILABLE: new Set(['RECOVERING']),
};

export function isExecutionTerminal(state: ExecutionState): boolean {
  return TERMINAL_STATES.has(state);
}

/** True iff `from -> to` is an explicitly allowed transition. */
export function canExecutionTransition(from: ExecutionState, to: ExecutionState): boolean {
  return EXECUTION_TRANSITIONS[from].has(to);
}

export function allowedNext(from: ExecutionState): readonly ExecutionState[] {
  return [...EXECUTION_TRANSITIONS[from]];
}
