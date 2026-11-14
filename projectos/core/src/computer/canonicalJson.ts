// Origin: original ProjectOS code
/**
 * Canonical JSON and its hash: the one encoding every binding in this directory is hashed from.
 *
 * AN ENCODING THAT CANNOT COLLIDE. Values are written as JSON, object keys sorted, with no whitespace, so two different
 * records never write the same text and a boundary between two fields cannot be moved. Only plain JSON is encoded: a
 * string, a finite number, a boolean, `null`, an array or a plain object. Anything else (undefined, a function, a symbol,
 * a bigint, NaN, Infinity, a class instance, a getter) makes the whole value unencodable, and the caller refuses it. A
 * hash of something that could not be encoded would be a hash of less than what runs.
 *
 * Pure: no I/O.
 */
import { createHash } from 'node:crypto';

const MAX_DEPTH = 8;

function encode(value: unknown, depth: number): string | null {
  if (depth > MAX_DEPTH) return null;
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : null;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => encode(entry, depth + 1));
    return parts.some((part) => part === null) ? null : `[${parts.join(',')}]`;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(record).sort()) {
    if (typeof key !== 'string') return null;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !('value' in descriptor)) return null;
    const written = encode(descriptor.value, depth + 1);
    if (written === null) return null;
    parts.push(`${JSON.stringify(key)}:${written}`);
  }
  return `{${parts.join(',')}}`;
}

/** The canonical text of `value`, or `null` when it is not plain JSON. */
export function computerCanonicalJsonOf(value: unknown): string | null {
  return encode(value, 0);
}

/** `sha256:` and the hex digest of the canonical text, or `null` when the value cannot be encoded. */
export function digestOfCanonical(value: unknown): string | null {
  const text = computerCanonicalJsonOf(value);
  return text === null ? null : `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** `sha256:` and the hex digest of some text. */
export function digestOfText(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
