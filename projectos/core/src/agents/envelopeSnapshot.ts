// Origin: original ProjectOS code
/**
 * An envelope presented by a caller, copied once into plain frozen data before anything is judged.
 *
 * AN ENVELOPE FROM A CALLER IS READ ONCE. `parseEnvelope` checks a field through the object and then builds the stored value
 * by spreading the same object, so an object with an accessor answers one thing to the check and another to the copy. Here
 * every own field is copied by descriptor, an accessor anywhere in it (the envelope, its actor, a scope entry) refuses the
 * whole envelope, and only the plain copy is handed on. What `parseEnvelope`, `checkChildEnvelope` and the stored node then
 * read is data that cannot change.
 *
 * Pure: no I/O.
 */
import { ENVELOPE_FIELDS } from '../taskEnvelope.js';
import { snapshotOf } from './plainRecords.js';

const ACTOR_FIELDS = ['agent', 'provider', 'model'] as const;
const MAX_SCOPE_ENTRIES = 256;

/** Copy an array's own entries by descriptor. `null` when it has an accessor, a hole or too many entries. */
function plainList(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  // `length` is read once: a hostile object that answers a different length each time cannot make the loop run on
  const length: unknown = value.length;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > MAX_SCOPE_ENTRIES) return null;
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) return null;
    copy.push(descriptor.value);
  }
  return copy;
}

/**
 * A deep plain copy of an envelope's fields, or `null` when the value is not a plain object of known fields or holds an
 * accessor anywhere. It judges nothing else: the result still goes to `parseEnvelope`.
 */
export function snapshotEnvelope(raw: unknown): Record<string, unknown> | null {
  const fields = snapshotOf(raw, ENVELOPE_FIELDS as readonly string[]);
  if (fields === null) return null;
  const copy: Record<string, unknown> = { ...fields };
  if ('scope' in fields) {
    const scope = plainList(fields['scope']);
    if (scope === null) return null;
    copy['scope'] = scope;
  }
  if ('actor' in fields) {
    const actor = snapshotOf(fields['actor'], ACTOR_FIELDS);
    if (actor === null) return null;
    copy['actor'] = actor;
  }
  return copy;
}

const MAX_DEEP_NODES = 20_000;
const MAX_DEEP_DEPTH = 8;
const MAX_DEEP_LIST = 5_000;

interface Budget {
  left: number;
}

const REFUSED = Symbol('refused');

function copyDeep(value: unknown, depth: number, budget: Budget): unknown {
  budget.left -= 1;
  if (budget.left < 0 || depth > MAX_DEEP_DEPTH) return REFUSED;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : REFUSED;
  if (typeof value !== 'object') return REFUSED;
  if (Array.isArray(value)) {
    const length: unknown = value.length;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > MAX_DEEP_LIST) return REFUSED;
    const list: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) return REFUSED;
      const item = copyDeep(descriptor.value, depth + 1, budget);
      if (item === REFUSED) return REFUSED;
      list.push(item);
    }
    return Object.freeze(list);
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return REFUSED;
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return REFUSED;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return REFUSED;
    const item = copyDeep(descriptor.value, depth + 1, budget);
    if (item === REFUSED) return REFUSED;
    record[key] = item;
  }
  return Object.freeze(record);
}

/**
 * Everything under `value` copied once, deeply, into frozen plain data: objects of plain prototype, arrays, strings, finite
 * numbers, booleans and null, and nothing else. An accessor, a symbol key, an odd prototype, a hole or too much data refuses the
 * whole value (`undefined`). Whatever is judged afterwards, verifier included, is judged on this copy, and whatever is built is
 * built from it, so a value that answers differently on a second read changes nothing.
 */
export function deepSnapshot(value: unknown): unknown {
  const copy = copyDeep(value, 0, { left: MAX_DEEP_NODES });
  return copy === REFUSED ? undefined : copy;
}
