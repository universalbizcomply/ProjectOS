/**
 * State persistence — serialises the derived PhaseState to the schema-valid `state.json`
 * shape (state.schema.json) and reads it back. The daemon writes only inside `.projectops/`;
 * the system port enforces that at the boundary.
 */
import type { DaemonSystem } from '../system.js';
import type { PhaseState } from '../types.js';
import { statePath } from '../utils/paths.js';

/** Map the in-memory state to the persisted, schema-shaped object (snake_case keys). */
export function toStateJson(state: PhaseState): Record<string, unknown> {
  const out: Record<string, unknown> = {
    project: state.project,
    phase: state.phase,
    status: state.status,
    updated_at: state.updatedAt,
    worker: state.worker,
    source: state.source,
    version: state.version,
    lastSeq: state.lastSeq,
    decision_required: state.decisionRequired,
    validators: state.validators,
  };
  if (state.branch !== undefined) out['branch'] = state.branch;
  if (state.head !== undefined) out['head'] = state.head;
  if (state.changedFiles !== undefined) out['changedFiles'] = state.changedFiles;
  if (state.blockers !== undefined) out['blockers'] = state.blockers;
  return out;
}

/** Persist a phase state to disk (inside .projectops). */
export function writeState(system: DaemonSystem, root: string, state: PhaseState): void {
  system.writeFile(statePath(root), JSON.stringify(toStateJson(state), null, 2));
}
