/**
 * Worker registry — pure reducer over a worker map. Worker presence/status is derived from
 * the same event stream as phase state, so it is fully rebuildable on restart (no separate
 * source of truth to lose). Keyed by project:phase:worker.
 */
import type { BridgeEvent, WorkerState, WorkerStatus } from '../types.js';

export type WorkerMap = ReadonlyMap<string, WorkerState>;

export function workerKey(project: string, phase: string, worker: string): string {
  return `${project}:${phase}:${worker}`;
}

/** Infer a provider label from a worker id (best-effort, cosmetic only). */
function providerFor(worker: string): string {
  const w = worker.toLowerCase();
  if (w.includes('claude')) return 'claude-code';
  if (w.includes('chatgpt') || w.includes('gpt')) return 'chatgpt';
  if (w.includes('owner') || w.includes('murad')) return 'human';
  return worker || 'unknown';
}

/** The worker status implied by an event type, or null if it does not change worker status. */
function statusForEvent(type: BridgeEvent['type']): WorkerStatus | null {
  switch (type) {
    case 'WORKER_ONLINE':
      return 'idle';
    case 'WORKER_OFFLINE':
      return 'offline';
    case 'PROMPT_READ':
      return 'reading';
    case 'IMPLEMENTATION_STARTED':
    case 'FILES_CHANGED':
      return 'implementing';
    case 'VALIDATION_STARTED':
      return 'validating';
    case 'EVIDENCE_CREATED':
    case 'REPORT_CREATED':
      return 'reporting';
    case 'REVIEW_READY':
      return 'waiting-approval';
    case 'CHATGPT_REVIEW_STARTED':
      return 'reviewing';
    case 'OWNER_REJECTED':
    case 'CHANGES_REQUESTED':
    case 'PHASE_BLOCKED':
    case 'SAFETY_VIOLATION_DETECTED':
      return 'blocked';
    case 'PHASE_CLOSED':
      return 'done';
    default:
      return null;
  }
}

/** Fold an event into the worker map. Events without a worker id are ignored. */
export function applyWorkerEvent(map: WorkerMap, event: BridgeEvent): WorkerMap {
  const worker = event.worker;
  if (!worker) return map;
  const status = statusForEvent(event.type);
  if (status === null) return map;

  const key = workerKey(event.project, event.phase, worker);
  const prev = map.get(key);
  const online = status !== 'offline';
  const next: WorkerState = {
    id: `wst_${worker}`,
    project: event.project,
    phase: event.phase,
    worker,
    provider: prev?.provider ?? providerFor(worker),
    status,
    online,
    updatedAt: event.at,
    ...(typeof event.payload?.['action'] === 'string'
      ? { currentAction: event.payload['action'] as string }
      : prev?.currentAction !== undefined
        ? { currentAction: prev.currentAction }
        : {}),
  };
  const out = new Map(map);
  out.set(key, next);
  return out;
}

/** Workers currently marked online. */
export function onlineWorkers(map: WorkerMap): readonly WorkerState[] {
  return [...map.values()].filter((w) => w.online);
}

/** Workers for a given phase. */
export function workersForPhase(
  map: WorkerMap,
  project: string,
  phase: string,
): readonly WorkerState[] {
  return [...map.values()].filter((w) => w.project === project && w.phase === phase);
}
