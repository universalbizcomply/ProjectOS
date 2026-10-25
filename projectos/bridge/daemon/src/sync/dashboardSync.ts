/**
 * Dashboard sync projection — pure. Builds the secret-free snapshot the daemon writes to the
 * dashboard cache. Every free-text field is passed through redaction; git heads and any
 * token-shaped value never make it into the projection. Never syncs secrets.
 */
import { DAEMON_VERSION } from '../constants.js';
import type {
  DashboardProjectSummary,
  DashboardSnapshot,
  PhaseState,
} from '../types.js';
import { redact } from '../utils/redact.js';
import type { WorkerMap } from '../workers/workerManager.js';
import { workersForPhase } from '../workers/workerManager.js';

function summariseProject(state: PhaseState, workers: WorkerMap): DashboardProjectSummary {
  const phaseWorkers = workersForPhase(workers, state.project, state.phase).map((w) => ({
    worker: redact(w.worker),
    status: w.status,
    online: w.online,
  }));
  return {
    project: redact(state.project),
    phase: redact(state.phase),
    stage: state.stage,
    status: state.status,
    validators: state.validators,
    decisionRequired: state.decisionRequired,
    workers: phaseWorkers,
    blockers: (state.blockers ?? []).map((b) => redact(b)),
  };
}

/** Project current phase states + workers into a redacted dashboard snapshot. */
export function buildDashboardSnapshot(
  phaseStates: readonly PhaseState[],
  workers: WorkerMap,
  at: string,
): DashboardSnapshot {
  return {
    generatedAt: at,
    version: DAEMON_VERSION,
    projects: phaseStates.map((s) => summariseProject(s, workers)),
  };
}
