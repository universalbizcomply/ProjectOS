// SPDX-License-Identifier: Apache-2.0
// Ported-From: rakazo https://github.com/elie222/rakazo
// Source-Path: packages/core/src/approval-effect-key.ts
// Source-Commit: bf78ebd7961a28a8b437c605319c47b59edadc1c
// Source-Copyright: Copyright 2026 Rakazo contributors
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the colon-joined key replaced by a hash over a JSON array, so fields cannot trade characters; the serializer now refuses negative zero, integers past the safe range, accessors, symbol keys, non-enumerable properties, labelled arrays and depth over a limit, and answers with a result instead of throwing; occurrence and legacy keys removed, because an approval is spent by id in taint.ts.
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: node and byte budgets added to the serializer, because a shared reference expands far past its own size.
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The effect an approval is bound to: one run, one tool, one exact set of arguments.
 *
 * THE KEY IS A HASH OVER A JSON ARRAY, NOT A JOIN. The upstream key was `run:tool:digest`, so the run
 * `a:b` with the tool `c` had the same key as the run `a` with the tool `b:c`, and an approval for one
 * was an approval for the other. Tools and runs are text, and a colon is ordinary text.
 *
 * THE ARGUMENTS HAVE ONE READING OR NONE. A value that two different sets of bytes could stand for, or
 * that can answer differently when read twice, cannot be approved: the owner would be approving one
 * thing and the tool would run another. So `-0` is refused, because JSON prints it as `0`; an integer
 * past the safe range is refused, because the digits that were lost are the difference between two
 * accounts; and a getter is refused, because it could answer the hash with one value and the tool with
 * another. `Object.keys` alone would drop symbol keys, non-enumerable properties and array labels from
 * the hash and leave them in the object.
 *
 * `argumentHash` has the shape of an envelope `subjectHash` (ADR-K1 §2): a SHA-256 of the exact bytes
 * acted on. Those bytes are `canonicalArguments`, and the tool must run them rather than the object it
 * was handed, or the binding proves nothing about what ran.
 *
 * A NUMBER IS BOUND AS THE VALUE IT PARSED TO. Two decimals that parse to the same double are the same
 * value here, and the owner sees that one value. Only integers past the safe range are refused, because
 * those are the ones a reader takes for an exact identifier.
 *
 * THE BUDGETS ARE ON WHAT WOULD BE EMITTED, NOT WHAT IS HELD. An object that holds the one below it twice,
 * 22 levels deep, is small in memory and took 18 seconds to serialize. A depth limit does not see that,
 * so the walk counts nodes and UTF-8 bytes as it goes and stops at the first one over.
 *
 * No I/O. Nothing here decides anything: it says what an approval would be for.
 */
import { createHash } from 'node:crypto';

const EFFECT_KEY_DOMAIN = 'projectos-tool-effect-v1:';

/** Well past any real tool call, and short of the stack. A cycle stops here too. */
const MAX_ARGUMENT_DEPTH = 64;

/** Bounds the walk. Each shared reference counts every time it is reached, as it would be emitted. */
const MAX_ARGUMENT_NODES = 100_000;

/** Bounds the bytes hashed and carried to the tool. Strings and keys, as UTF-8. */
const MAX_ARGUMENT_BYTES = 4 * 1024 * 1024;

/** What one walk has used so far. Local to `canonicalArguments`. */
interface WalkBudget {
  nodes: number;
  bytes: number;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function refuse(reason: string): never {
  throw new TypeError(reason);
}

function spendBytes(text: string, budget: WalkBudget): string {
  budget.bytes += Buffer.byteLength(text, 'utf8');
  if (budget.bytes > MAX_ARGUMENT_BYTES) refuse(`the arguments are over the budget of ${MAX_ARGUMENT_BYTES} bytes`);
  return text;
}

/** Read a property without running anything: a getter is refused, never called. */
function dataValue(holder: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(holder, key);
  if (descriptor === undefined || !('value' in descriptor)) refuse(`'${key}' is not plain data, so it could answer differently when the tool runs`);
  return descriptor.value;
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) refuse(`${value} is not a JSON value`);
  if (Object.is(value, -0)) refuse('negative zero has no JSON form of its own, so it would read as zero');
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) refuse(`${value} is past the safe integer range, so its digits are not exact`);
  return JSON.stringify(value);
}

function serializeArray(items: readonly unknown[], depth: number, budget: WalkBudget): string {
  if (Reflect.ownKeys(items).length !== items.length + 1) refuse('an array with holes or labels has no one reading as JSON');
  const parts = Array.from({ length: items.length }, (_, index) => serialize(dataValue(items, String(index)), depth + 1, budget));
  return `[${parts.join(',')}]`;
}

function plainKey(holder: object, key: string | symbol): string {
  if (typeof key !== 'string') return refuse('a symbol key has no JSON form');
  if (Object.getOwnPropertyDescriptor(holder, key)?.enumerable !== true) refuse(`'${key}' is hidden from JSON`);
  return key;
}

function serializeObject(value: object, depth: number, budget: WalkBudget): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) refuse('only plain objects are JSON values');
  const keys = Reflect.ownKeys(value)
    .map((key) => plainKey(value, key))
    .sort();
  const entries = keys.map((key) => `${spendBytes(JSON.stringify(key), budget)}:${serialize(dataValue(value, key), depth + 1, budget)}`);
  return `{${entries.join(',')}}`;
}

function serialize(current: unknown, depth: number, budget: WalkBudget): string {
  budget.nodes += 1;
  if (budget.nodes > MAX_ARGUMENT_NODES) refuse(`the arguments are over the budget of ${MAX_ARGUMENT_NODES} values`);
  if (depth > MAX_ARGUMENT_DEPTH) refuse('the arguments are nested too deeply, or they contain a cycle');
  if (current === null) return 'null';
  if (typeof current === 'string' || typeof current === 'boolean') return spendBytes(JSON.stringify(current), budget);
  if (typeof current === 'number') return serializeNumber(current);
  if (typeof current !== 'object') return refuse(`a ${typeof current} is not a JSON value`);
  return Array.isArray(current) ? serializeArray(current as readonly unknown[], depth, budget) : serializeObject(current, depth, budget);
}

export type CanonicalArguments = { readonly ok: true; readonly canonical: string } | { readonly ok: false; readonly reason: string };

/** The one reading of these arguments, keys sorted, or why there is none. */
export function canonicalArguments(args: unknown): CanonicalArguments {
  try {
    return { ok: true, canonical: serialize(args, 0, { nodes: 0, bytes: 0 }) };
  } catch (error) {
    return { ok: false, reason: error instanceof TypeError ? error.message : 'the arguments could not be read' };
  }
}

export interface ToolCall {
  readonly runId: string;
  readonly toolName: string;
  readonly args: unknown;
}

export interface ToolEffect {
  readonly runId: string;
  readonly toolName: string;
  /** SHA-256 of `canonicalArguments`, in hex. */
  readonly argumentHash: string;
  /** The exact bytes the hash covers. The tool runs these. */
  readonly canonicalArguments: string;
  /** Opaque, so it can go in a record without the arguments. */
  readonly effectKey: string;
}

export type ToolEffectResult = { readonly ok: true; readonly effect: ToolEffect } | { readonly ok: false; readonly reasons: readonly string[] };

/** What this call would do, as an approval can name it. */
export function deriveToolEffect(call: ToolCall): ToolEffectResult {
  const { runId, toolName, args } = call;
  const canonical = canonicalArguments(args);
  const reasons = [
    ...(nonBlank(runId) ? [] : ['the call names no run']),
    ...(nonBlank(toolName) ? [] : ['the call names no tool']),
    ...(canonical.ok ? [] : [canonical.reason]),
  ];
  if (!canonical.ok || reasons.length > 0) return { ok: false, reasons };
  const argumentHash = sha256(canonical.canonical);
  const effectKey = `sha256:${sha256(`${EFFECT_KEY_DOMAIN}${JSON.stringify([runId, toolName, argumentHash])}`)}`;
  return { ok: true, effect: Object.freeze({ runId, toolName, argumentHash, canonicalArguments: canonical.canonical, effectKey }) };
}
