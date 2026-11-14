// Origin: original ProjectOS code
/**
 * THE SHAPES THE PROVENANCE, COMMITTED-READ AND RETENTION RULES SHARE (PROJECTOS-MEMORY-PROVENANCE1A).
 *
 * Three small checks every one of them needs, kept in one place so a rule cannot drift from its sibling:
 *
 *   `plainRecordOf`           a record is read ONCE, into a frozen copy with no prototype. An accessor, a symbol key, a key
 *                             that reaches the prototype and an unlisted field refuse the whole record, because a getter
 *                             answers differently the second time it is read.
 *   `isGitObjectId`           a git object name: 40 or 64 lower-case hex characters. `HEAD`, a branch and an upper-case
 *                             spelling are not object names, so two spellings of one commit cannot be two commits.
 *   `memoryPathShapeProblem`  a project-relative path with `/` separators, in ONE spelling: no escape from the project, no
 *                             alternate stream, no trailing dot or space (Windows drops them), nothing but printable ASCII.
 *
 * Pure: no I/O, no clock, no import. Every pattern is linear (a bounded length is checked first, then single-class tests).
 */

/** Keys that reach a prototype. A record that holds one is refused, whatever its other fields say. */
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export type PlainRecordRefusal = 'not-plain' | 'unknown-field';

export type PlainRecordRead = { readonly ok: true; readonly value: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly reason: PlainRecordRefusal };

/** Read a record once. A Proxy that throws is refused; a transparent Proxy needs a port core does not have (named residual). */
export function plainRecordOf(value: unknown, allowed: readonly string[]): PlainRecordRead {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'not-plain' };
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { ok: false, reason: 'not-plain' };
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let unlisted = false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || PROTOTYPE_KEYS.has(key)) return { ok: false, reason: 'not-plain' };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return { ok: false, reason: 'not-plain' };
      if (!allowed.includes(key)) {
        unlisted = true;
        continue;
      }
      copy[key] = descriptor.value;
    }
    if (unlisted) return { ok: false, reason: 'unknown-field' };
    return { ok: true, value: Object.freeze(copy) };
  } catch {
    return { ok: false, reason: 'not-plain' };
  }
}

/**
 * A list read ONCE into a frozen copy, from its own data properties. An element that is an accessor, a hole, an own key that is not an
 * index, a length over `max` and anything that is not an array yield null, so a second read cannot differ and no method the list
 * carries (an own `some`, say) is ever called. A Proxy that throws is null; a transparent one needs a port core does not have.
 */
export function plainListOf(value: unknown, max: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const length: number = value.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > max) return null;
    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      copy.push(descriptor.value);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return null;
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const isGitObjectId = (value: unknown): value is string => typeof value === 'string' && GIT_OBJECT_ID.test(value);

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const isSha256Hex = (value: unknown): value is string => typeof value === 'string' && SHA256_HEX.test(value);

/** Control, format and separator characters: nothing a person can see, and nothing a path or a recorded reason may hold. */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
];

/** True when the text holds one of them. Callers bound the length first, so this loop is short. */
export function hasInvisibleCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (INVISIBLE_RANGES.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

export const MAX_MEMORY_PATH_CHARS = 512;

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export type MemoryPathShapeProblem = 'COMMITTED_PATH_INVALID' | 'COMMITTED_PATH_ESCAPES' | 'COMMITTED_PATH_NOT_NORMAL';

/** Why this is not a project-relative path in one spelling, or null. The length is bounded first, so no later test is hostile. */
export function memoryPathShapeProblem(path: unknown): MemoryPathShapeProblem | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_MEMORY_PATH_CHARS) return 'COMMITTED_PATH_INVALID';
  if (path.startsWith('/') || path.includes('\\') || path.includes(':')) return 'COMMITTED_PATH_ESCAPES';
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return 'COMMITTED_PATH_ESCAPES';
  if (!PRINTABLE_ASCII.test(path)) return 'COMMITTED_PATH_NOT_NORMAL';
  if (segments.some((segment) => segment.endsWith('.') || segment.endsWith(' ') || segment.startsWith(' '))) return 'COMMITTED_PATH_NOT_NORMAL';
  return null;
}
