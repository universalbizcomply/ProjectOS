/**
 * Recovery manager — pure. Rebuilds all derived state (phase states + worker map) by replaying
 * persisted event logs through the same reducers used at runtime. Because the event log is the
 * source of truth, a restart loses nothing: the daemon reconstructs exactly where it left off.
 */
import type { BridgeEvent, PhaseState } from '../types.js';
import { initialState, applyEvent } from '../state/stateManager.js';
import { applyWorkerEvent } from '../workers/workerManager.js';
import type { WorkerMap } from '../workers/workerManager.js';

export interface RecoveredState {
  readonly phases: ReadonlyMap<string, PhaseState>;
  readonly workers: WorkerMap;
  readonly refusedTransitions: number;
}

function phaseKey(project: string, phase: string): string {
  return `${project}:${phase}`;
}

/**
 * Replay an ordered event stream into per-phase states and a worker map. Events are assumed
 * to be in append order; out-of-order or unknown-phase events still fold safely because each
 * phase starts from a well-defined initial state.
 */
export function rebuildFromEvents(events: readonly BridgeEvent[]): RecoveredState {
  const phases = new Map<string, PhaseState>();
  let workers: WorkerMap = new Map();
  let refused = 0;

  for (const event of events) {
    const key = phaseKey(event.project, event.phase);
    const current =
      phases.get(key) ?? initialState(event.project, event.phase, event.at, event.source);
    const { state, refusedTransition } = applyEvent(current, event);
    if (refusedTransition !== null) refused += 1;
    phases.set(key, state);
    workers = applyWorkerEvent(workers, event);
  }

  return { phases, workers, refusedTransitions: refused };
}

/** Phases still awaiting an owner decision (used for pending counts + notifications). */
export function pendingDecisions(phases: ReadonlyMap<string, PhaseState>): readonly PhaseState[] {
  return [...phases.values()].filter((p) => p.decisionRequired && p.stage !== 'closed');
}

/** Phases parked in the review stage (a report/evidence awaiting review). */
export function pendingReviews(phases: ReadonlyMap<string, PhaseState>): readonly PhaseState[] {
  return [...phases.values()].filter((p) => p.stage === 'awaiting_review');
}
