/**
 * Workflow engine: the canonical ProjectOS delivery workflow as ordered steps.
 *
 * This is the coarse pipeline that maps to phase statuses. It answers "what comes next"
 * and "who owns this step", giving surfaces a single source of truth for the flow shown
 * in the README and phase-lifecycle doc.
 */
import type { PhaseStatus, Role } from './types.js';

export interface WorkflowStep {
  readonly id: string;
  readonly label: string;
  /** Phase status entered when this step begins. */
  readonly status: PhaseStatus;
  /** Role responsible for advancing past this step. */
  readonly owner: Role;
}

/** Ordered canonical workflow. Closure is owner-owned and terminal. */
export const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  { id: 'prompt', label: 'Prompt / manifest', status: 'prompted', owner: 'advisor' },
  { id: 'implement', label: 'Implement', status: 'implementing', owner: 'implementer' },
  { id: 'validate', label: 'Local validate', status: 'validating', owner: 'implementer' },
  { id: 'evidence', label: 'Evidence pack', status: 'evidence', owner: 'implementer' },
  { id: 'review', label: 'Owner/advisor review', status: 'awaiting_review', owner: 'advisor' },
  { id: 'closure', label: 'Closure', status: 'awaiting_closure', owner: 'owner' },
];

export function stepForStatus(status: PhaseStatus): WorkflowStep | undefined {
  return WORKFLOW_STEPS.find((s) => s.status === status);
}

/** The next workflow step after the given status on the happy path, if any. */
export function nextStep(status: PhaseStatus): WorkflowStep | undefined {
  const idx = WORKFLOW_STEPS.findIndex((s) => s.status === status);
  if (idx === -1) return undefined;
  return WORKFLOW_STEPS[idx + 1];
}

export function stepIndex(status: PhaseStatus): number {
  return WORKFLOW_STEPS.findIndex((s) => s.status === status);
}
