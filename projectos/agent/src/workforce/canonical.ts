/**
 * Canonical JSON and digests for the governed workforce (PROJECTOS-AGENT-WORKFORCE1A).
 *
 * Every workforce record that is referenced by digest — a task, a result, a registry, a policy, an
 * event — is hashed over ONE canonical form: object keys sorted recursively, no whitespace. Two equal
 * values therefore always produce the same digest, whichever order a writer happened to build them
 * in, and a digest recorded in an event can be recomputed by anyone holding the value.
 */
import { createHash } from 'node:crypto';

/** Stable canonical JSON: object keys sorted recursively; `undefined` members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v === undefined ? null : v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/** SHA-256 of bytes or of a UTF-8 string, as 64 lowercase hex characters. */
export function sha256Hex(input: string | Uint8Array): string {
  const hash = createHash('sha256');
  if (typeof input === 'string') hash.update(input, 'utf8');
  else hash.update(input);
  return hash.digest('hex');
}

/** `sha256:<hex>` of a value's canonical JSON. */
export function digestOf(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const PREFIXED_DIGEST = /^sha256:[0-9a-f]{64}$/;
