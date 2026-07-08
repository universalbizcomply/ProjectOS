/**
 * Task engine: a small pure state machine for work items inside a phase.
 *
 * pending -> in_progress -> done, with blocked/cancelled side paths.
 * Returns new state; never mutates inputs.
 */
import type { TaskStatus, Result } from './types.js';
import { ok, err } from './types.js';

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['blocked', 'done', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly blockedReason?: string;
}

export function createTask(id: string, title: string): Task {
  return { id, title, status: 'pending' };
}

/**
 * Move a task to a new status. When moving to 'blocked' a reason is required;
 * leaving 'blocked' clears the reason.
 */
export function setTaskStatus(
  task: Task,
  to: TaskStatus,
  blockedReason?: string,
): Result<Task> {
  if (!canTransitionTask(task.status, to)) {
    return err(`Illegal task transition: ${task.status} -> ${to}`);
  }
  if (to === 'blocked') {
    if (blockedReason === undefined || blockedReason.trim() === '') {
      return err(`Transition to 'blocked' requires a blockedReason`);
    }
    return ok({ id: task.id, title: task.title, status: to, blockedReason });
  }
  return ok({ id: task.id, title: task.title, status: to });
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return TASK_TRANSITIONS[status].length === 0;
}
