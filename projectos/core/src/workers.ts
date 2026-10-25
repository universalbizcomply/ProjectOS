/**
 * Worker model: provider-agnostic functional workers that carry out phase work.
 *
 * The roadmap's key idea — "workers replace hardcoded AI" — means any provider (Claude
 * Code today, another model or a human tomorrow) can fill a worker slot without changing
 * the operating model. A worker has a functional TYPE (what job it does) and a PROVIDER
 * (who fills it). Permissions are decided by mapping the worker type onto a governance
 * Role, so the existing permission matrix stays the single source of truth.
 */
import type { Role, Result } from './types.js';
import { ok, err } from './types.js';
import { can, type GovernanceAction } from './permissions.js';

/** Functional worker types from the roadmap's worker system. */
export type WorkerType =
  | 'owner'
  | 'reviewer'
  | 'implementer'
  | 'security'
  | 'database'
  | 'testing'
  | 'ux'
  | 'documentation'
  | 'research'
  | 'marketing'
  | 'deployment';

export const WORKER_TYPES: readonly WorkerType[] = [
  'owner',
  'reviewer',
  'implementer',
  'security',
  'database',
  'testing',
  'ux',
  'documentation',
  'research',
  'marketing',
  'deployment',
];

/**
 * Map a worker type onto the governance role that decides its permissions.
 * Owner is owner; reviewer/research are advisory; every "doing" worker is an implementer.
 */
export function roleForWorkerType(type: WorkerType): Role {
  switch (type) {
    case 'owner':
      return 'owner';
    case 'reviewer':
    case 'research':
      return 'advisor';
    default:
      return 'implementer';
  }
}

export interface Worker {
  readonly id: string;
  readonly type: WorkerType;
  readonly displayName: string;
  /** Who fills the slot: 'claude-code', 'chatgpt', 'human', 'none', ... */
  readonly provider: string;
  readonly capabilities: readonly string[];
}

export type WorkerRegistry = Readonly<Record<string, Worker>>;

export const EMPTY_WORKERS: WorkerRegistry = {};

/** Register a worker, returning a new registry. Fails on duplicate id. */
export function registerWorker(
  registry: WorkerRegistry,
  worker: Worker,
): Result<WorkerRegistry> {
  if (worker.id in registry) {
    return err(`Worker already registered: ${worker.id}`);
  }
  return ok({ ...registry, [worker.id]: worker });
}

export function getWorker(registry: WorkerRegistry, id: string): Worker | undefined {
  return registry[id];
}

/** All workers of a given type. */
export function workersOfType(
  registry: WorkerRegistry,
  type: WorkerType,
): readonly Worker[] {
  return Object.values(registry).filter((w) => w.type === type);
}

/** Whether a worker is permitted to perform a governance action (via its mapped role). */
export function canWorkerPerform(worker: Worker, action: GovernanceAction): boolean {
  return can(roleForWorkerType(worker.type), action);
}

/** Pick the first registered worker that has the capability, if any. */
export function assignForCapability(
  registry: WorkerRegistry,
  capability: string,
): Worker | undefined {
  return Object.values(registry).find((w) => w.capabilities.includes(capability));
}
