// Origin: original ProjectOS code
/**
 * THE CANONICAL READING OF JSON, AND TWO HASHES MADE FROM IT (PROJECTOS-PORT-MCP1A, review round 1: H3 and H4).
 *
 * `toolDescriptorHashOf` is the pin that stops a rug pull: a server that approved as one thing and later describes a tool
 * differently, in its description, its input schema or its annotations, no longer hashes to the owner's value, and
 * the tool is not called. `argumentsDigestOf` is what a start record holds in place of the arguments, which may carry
 * anything. Both read the value once, with keys sorted, to a fixed depth and size, so a hostile schema cannot make
 * this do unbounded work. A value that cannot be written as plain JSON (a cycle, a function, a bigint) is `null`.
 *
 * This is not `approvals/effectKey.canonicalArguments`: that rule set is wired to nothing, and its validator forbids any
 * other product file from naming it. Pure.
 */
import { sha256Hex } from '../execution/evidence.js';

export const MAX_CANONICAL_DEPTH = 32;
export const MAX_CANONICAL_NODES = 20_000;
const DESCRIPTOR_DOMAIN = 'projectos-mcp-tool-descriptor-v1';

function write(value: unknown, depth: number, budget: { nodes: number }): string {
  budget.nodes += 1;
  if (depth > MAX_CANONICAL_DEPTH || budget.nodes > MAX_CANONICAL_NODES) throw new RangeError('too large');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    // A number that is not finite is not JSON, and an integer past 2^53 is not kept exactly: JSON.parse has already
    // rounded it, so two different texts would hash alike. Refuse both, rather than collapse them.
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new TypeError('not JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${(value as readonly unknown[]).map((item) => write(item, depth + 1, budget)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${write(record[key], depth + 1, budget)}`).join(',')}}`;
  }
  throw new TypeError('not JSON');
}

/** The one writing of this value, keys sorted, or `null` when it is not plain JSON or is too large. */
export function canonicalJsonOf(value: unknown): string | null {
  try {
    return write(value, 0, { nodes: 0 });
  } catch {
    return null;
  }
}

/**
 * The hash of what a tool says it is: EVERYTHING the server sent for it except the name, which the owner's row already
 * pins. That is the description, the input and output schemas, the annotations, a title, `_meta`, an execution block, and
 * any field this code has never heard of, because a field nobody listed is the one a rug pull would use.
 */
export function toolDescriptorHashOf(tool: unknown): string | null {
  if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) return null;
  const rest = Object.fromEntries(Object.entries(tool as Readonly<Record<string, unknown>>).filter(([key]) => key !== 'name'));
  const canonical = canonicalJsonOf(rest);
  return canonical === null ? null : `sha256:${sha256Hex(`${DESCRIPTOR_DOMAIN}\n${canonical}`)}`;
}

/** A SHA-256 of the arguments as written canonically, for a record that must not hold them. */
export function argumentsDigestOf(args: unknown): string | null {
  const canonical = canonicalJsonOf(args);
  return canonical === null ? null : sha256Hex(canonical);
}
