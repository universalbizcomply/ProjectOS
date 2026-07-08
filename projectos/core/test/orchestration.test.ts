import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WORKERS,
  planWorkflow,
  unassignedSteps,
} from '../src/orchestration.js';
import { EMPTY_WORKERS } from '../src/workers.js';
import { WORKFLOW_STEPS } from '../src/workflow.js';

describe('orchestration', () => {
  it('assigns every workflow step under the default workers', () => {
    const plan = planWorkflow(DEFAULT_WORKERS);
    expect(plan).toHaveLength(WORKFLOW_STEPS.length);
    expect(plan.every((p) => p.worker !== undefined)).toBe(true);
    expect(unassignedSteps(DEFAULT_WORKERS)).toHaveLength(0);
  });

  it('routes steps to the right worker by role', () => {
    const plan = planWorkflow(DEFAULT_WORKERS);
    const impl = plan.find((p) => p.step.id === 'implement');
    const review = plan.find((p) => p.step.id === 'review');
    const closure = plan.find((p) => p.step.id === 'closure');
    expect(impl?.worker?.id).toBe('claude');
    expect(review?.worker?.id).toBe('chatgpt');
    expect(closure?.worker?.id).toBe('murad');
    expect(closure?.gated).toBe(true);
    expect(impl?.gated).toBe(false);
  });

  it('reports unassigned steps when no workers are registered', () => {
    const plan = planWorkflow(EMPTY_WORKERS);
    expect(plan.every((p) => p.worker === undefined)).toBe(true);
    expect(unassignedSteps(EMPTY_WORKERS)).toHaveLength(WORKFLOW_STEPS.length);
  });
});
