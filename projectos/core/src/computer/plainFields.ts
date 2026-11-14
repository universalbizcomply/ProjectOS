// Origin: original ProjectOS code
/**
 * How a request is read: one object of plain fields, each copied once, none a getter, none unknown.
 *
 * EACH FIELD IS READ ONCE. The object is copied field by field before anything is judged, and a field that is a getter or a
 * setter is refused, so a value cannot be clean when it is checked and something else when it is used. A key the reader does
 * not know refuses the whole object, so a limit, a tenant or a flag cannot ride along in a request.
 *
 * Pure: no I/O.
 */

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);

/** A copy of an object's own fields, or `null` when it has a key not in `allowed`, a symbol key, or an accessor. */
export function snapshotOfFields(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}

/** A copy of an array's elements, or `null` when it is not a plain array of at most `max` entries. */
export function snapshotOfArray(value: unknown, max: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return null;
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) return null;
    copy.push(descriptor.value);
  }
  return copy;
}
