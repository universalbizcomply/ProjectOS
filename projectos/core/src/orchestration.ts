/**
 * Orchestration: turn the canonical workflow + a worker registry into an execution PLAN.
 *
 * ProjectOS does not itself run external AIs — orchestration produces the plan (which
 * worker owns each workflow step, and whether the step is owner-gated), which a surface or
 * a human then acts on. Pure and deterministic.
 */
import type { WorkflowStep } from './workflow.js';
import { WORKFLOW_STEPS } from './workflow.js';
import type { Worker, WorkerRegistry } from './workers.js';
import { roleForWorkerType } from './workers.js';
import type { Role } from './types.js';

export interface PlannedStep {
  readonly step: WorkflowStep;
  /** Governance role that owns this step. */
  readonly role: Role;
  /** The worker assigned (first registry match for the role), if any. */
  readonly worker?: Worker;
  /** True when the step is the owner-gated closure step. */
  readonly gated: boolean;
}

/** The default three-worker setup: Murad (owner), ChatGPT (advisor), Claude (implementer). */
export const DEFAULT_WORKERS: WorkerRegistry = {
  murad: {
    id: 'murad',
    type: 'owner',
    displayName: 'Murad',
    provider: 'human',
    capabilities: ['approve', 'close'],
  },
  chatgpt: {
    id: 'chatgpt',
    type: 'reviewer',
    displayName: 'ChatGPT',
    provider: 'chatgpt',
    capabilities: ['review', 'architect', 'recommend_closure'],
  },
  claude: {
    id: 'claude',
    type: 'implementer',
    displayName: 'Claude Code',
    provider: 'claude-code',
    capabilities: ['implement', 'test', 'report'],
  },
};

/** Assign each workflow step to the first worker whose mapped role owns it. */
export function planWorkflow(registry: WorkerRegistry): readonly PlannedStep[] {
  const workers = Object.values(registry);
  return WORKFLOW_STEPS.map((step): PlannedStep => {
    const worker = workers.find((w) => roleForWorkerType(w.type) === step.owner);
    const gated = step.owner === 'owner';
    return worker ? { step, role: step.owner, worker, gated } : { step, role: step.owner, gated };
  });
}

/** Steps that have no worker to own them under the given registry. */
export function unassignedSteps(registry: WorkerRegistry): readonly WorkflowStep[] {
  return planWorkflow(registry)
    .filter((p) => p.worker === undefined)
    .map((p) => p.step);
}
