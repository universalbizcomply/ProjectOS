/**
 * Event type guards, validation and construction — pure.
 *
 * Canonical events are the only ones allowed into a persisted `event-log.jsonl`; the daemon
 * validates them against the required-field set from event.schema.json before appending.
 */
import { CANONICAL_EVENT_TYPES, INTERNAL_EVENT_TYPES } from '../types.js';
import type { Actor, BridgeEvent, BridgeEventType, CanonicalEventType } from '../types.js';
import { containsSecret } from '../utils/redact.js';

const CANONICAL_SET = new Set<string>(CANONICAL_EVENT_TYPES);
const INTERNAL_SET = new Set<string>(INTERNAL_EVENT_TYPES);
const ACTORS = new Set<Actor>(['owner', 'advisor', 'implementer', 'agent', 'core']);

export function isCanonicalType(type: string): type is CanonicalEventType {
  return CANONICAL_SET.has(type);
}

export function isInternalType(type: string): boolean {
  return INTERNAL_SET.has(type);
}

export function isKnownType(type: string): type is BridgeEventType {
  return isCanonicalType(type) || isInternalType(type);
}

export interface EventValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate an event intended for persistence. Enforces the schema's required fields, a known
 * canonical type, a valid actor, and — critically — that no field carries a secret.
 */
export function validateEvent(event: BridgeEvent): EventValidation {
  const errors: string[] = [];
  if (!isCanonicalType(event.type)) errors.push(`non-canonical type "${event.type}"`);
  if (!event.id) errors.push('missing id');
  if (typeof event.seq !== 'number' || event.seq < 0) errors.push('invalid seq');
  if (!event.project) errors.push('missing project');
  if (!event.phase) errors.push('missing phase');
  if (!event.at) errors.push('missing at');
  if (!ACTORS.has(event.actor)) errors.push(`invalid actor "${event.actor}"`);
  if (!event.source) errors.push('missing source');
  if (typeof event.decisionRequired !== 'boolean') errors.push('missing decisionRequired');
  if (event.payload && containsSecret(JSON.stringify(event.payload))) {
    errors.push('payload contains a secret-shaped value');
  }
  return { ok: errors.length === 0, errors };
}

export interface MakeEventInput {
  readonly id: string;
  readonly seq: number;
  readonly type: BridgeEventType;
  readonly project: string;
  readonly phase: string;
  readonly at: string;
  readonly actor: Actor;
  readonly source: string;
  readonly worker?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly relatedFiles?: readonly string[];
  readonly decisionRequired?: boolean;
}

/** Construct an immutable event. id/seq/at are supplied by the caller (determinism). */
export function makeEvent(input: MakeEventInput): BridgeEvent {
  const base = {
    id: input.id,
    seq: input.seq,
    type: input.type,
    project: input.project,
    phase: input.phase,
    at: input.at,
    actor: input.actor,
    source: input.source,
    decisionRequired: input.decisionRequired ?? false,
  };
  return {
    ...base,
    ...(input.worker !== undefined ? { worker: input.worker } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    ...(input.relatedFiles !== undefined ? { relatedFiles: input.relatedFiles } : {}),
  };
}
