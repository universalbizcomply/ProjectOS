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
  if (!Array.isArray(value) || value.length > MAX_SCOPE_ENTRIES) return null;
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
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
