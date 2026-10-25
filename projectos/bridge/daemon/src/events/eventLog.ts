/**
 * Append-only event log operations — pure. The log is the source of truth for a phase; the
 * derived state is rebuildable from it (see recoveryManager). Appends return a new array,
 * never mutate.
 */
import { INTERNAL_SEQ } from '../constants.js';
import type { BridgeEvent } from '../types.js';
import { parseJsonl } from '../utils/jsonl.js';

/**
 * Normalise a raw persisted record (schema snake_case: decision_required / related_files)
 * into the camelCase BridgeEvent shape. Accepts either casing so the daemon reads logs
 * written by the CLI, the agent, or itself.
 */
function normalizeRecord(raw: Record<string, unknown>): BridgeEvent {
  const decisionRequired =
    typeof raw['decisionRequired'] === 'boolean'
      ? raw['decisionRequired']
      : raw['decision_required'] === true;
  const relatedFiles = Array.isArray(raw['relatedFiles'])
    ? (raw['relatedFiles'] as string[])
    : Array.isArray(raw['related_files'])
      ? (raw['related_files'] as string[])
      : undefined;
  return {
    id: String(raw['id']),
    seq: raw['seq'] as number,
    type: raw['type'] as BridgeEvent['type'],
    project: String(raw['project'] ?? ''),
    phase: String(raw['phase'] ?? ''),
    at: String(raw['at'] ?? ''),
    actor: (raw['actor'] as BridgeEvent['actor']) ?? 'agent',
    source: String(raw['source'] ?? ''),
    decisionRequired,
    ...(typeof raw['worker'] === 'string' ? { worker: raw['worker'] } : {}),
    ...(typeof raw['version'] === 'string' ? { version: raw['version'] } : {}),
    ...(raw['payload'] !== undefined && typeof raw['payload'] === 'object' && raw['payload'] !== null
      ? { payload: raw['payload'] as Record<string, unknown> }
      : {}),
    ...(relatedFiles !== undefined ? { relatedFiles } : {}),
  };
}

/** Parse persisted JSONL into events, keeping only well-formed objects with a numeric seq. */
export function parseEventLog(text: string): { events: readonly BridgeEvent[]; skipped: number } {
  const { records, skipped } = parseJsonl<Record<string, unknown>>(text);
  const events: BridgeEvent[] = [];
  let dropped = skipped;
  for (const r of records) {
    if (typeof r['seq'] === 'number' && typeof r['type'] === 'string' && typeof r['id'] === 'string') {
      events.push(normalizeRecord(r));
    } else {
      dropped += 1;
    }
  }
  return { events, skipped: dropped };
}

/** The next persisted sequence number (max seq + 1, ignoring internal-only events). */
export function nextSeq(events: readonly BridgeEvent[]): number {
  let max = -1;
  for (const e of events) {
    if (e.seq !== INTERNAL_SEQ && e.seq > max) max = e.seq;
  }
  return max + 1;
}

/** Append an event, returning a new log. */
export function appendEvent(
  events: readonly BridgeEvent[],
  event: BridgeEvent,
): readonly BridgeEvent[] {
  return [...events, event];
}

/** Events for one phase, in order. */
export function eventsForPhase(
  events: readonly BridgeEvent[],
  phase: string,
): readonly BridgeEvent[] {
  return events.filter((e) => e.phase === phase);
}

/** The most recent event of a given type, or undefined. */
export function latestOfType(
  events: readonly BridgeEvent[],
  type: string,
): BridgeEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e !== undefined && e.type === type) return e;
  }
  return undefined;
}
