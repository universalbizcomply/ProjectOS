// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/mcp_tool_sampling.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript as pure decisions; the sampling handler and everything it called, which let a server have the client's model write for it, is removed, and sampling/createMessage is refused whatever it carries, with no setting that turns it on; upstream's sliding one-minute request window is kept and now limits elicitations; elicitation keeps upstream's form-mode-only rule and its fail-closed answers, and is routed to an owner-queue item where upstream routed it to the chat approval prompt; a field description, which is the server's own text, is not carried into the item; the owner's answer is checked against the fields that were asked and must cover every one, with the type and the allowed values the server named; an elicitation is answered only while a tool call is in flight, every elicitation request counts in the window, malformed or not, and a form that asks for a secret by name is refused
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * What a server may ask of the client.
 *
 * SAMPLING IS OFF. A sampling request asks the client to run its model for the server, with the server's prompt,
 * so a server would be steering a model that holds the client's tools. There is no configuration that allows it:
 * this module refuses it and the client does not declare the capability, so a well-behaved server never sends it.
 *
 * AN ELICITATION IS FOR THE OWNER. It is turned into an owner-queue item and the model has no part in the answer:
 * nothing here, and no port the connector is given, can reach a model. The message is the server's own text and
 * travels as untrusted data. A URL-mode elicitation is refused, because it would send the owner to an address the
 * server chose. A server that asks too often is refused for the rest of the window, and every request counts, a
 * malformed one or an unprompted one included, so a bad request is not a free probe. It is heard only while a tool call is
 * in flight: a server may not put a question to the owner out of the blue. A form that asks for a password, a token, a
 * key or a credential by name is refused, because an answer typed to a server's own text goes to the server. Pure: the
 * clock is an argument.
 */
import { sha256Hex } from '../execution/evidence.js';

/** What the client declares at initialise. No sampling and no roots: the client offers only what it does. */
export const MCP_CLIENT_CAPABILITIES = Object.freeze({ elicitation: Object.freeze({}) });

export const SAMPLING_METHOD = 'sampling/createMessage';
export const ELICITATION_METHOD = 'elicitation/create';

export const ELICITATION_WINDOW_MS = 60_000;
export const DEFAULT_ELICITATIONS_PER_WINDOW = 5;
export const MAX_ELICITATION_MESSAGE_CHARS = 2_000;
export const MAX_ELICITATION_FIELDS = 20;
export const MAX_ANSWER_VALUE_CHARS = 1_000;

const FIELD_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const FLAT_TYPES = ['string', 'number', 'integer', 'boolean'];
const MAX_ENUM_VALUES = 50;
/** A field a form must never ask for: what is typed in answer goes to the server whose text asked. */
const SECRET_FIELD = /pass(?:word|wd)|secret|token|api[_-]?key|credential|private[_-]?key/i;

export type AnswerValue = string | number | boolean;

/** What one asked field is, as the server named it. The owner's answer is held to it. */
export interface FieldSpec {
  readonly name: string;
  readonly type: 'string' | 'number' | 'integer' | 'boolean';
  readonly enum: readonly AnswerValue[] | null;
}

export interface OwnerQueueItem {
  readonly kind: 'mcp-elicitation';
  readonly itemId: string;
  readonly serverKey: string;
  readonly trust: 'untrusted-data';
  /** The server's own words. Shown to the owner as quoted text, and acted on by nothing. */
  readonly untrustedMessage: string;
  /** The names of the fields asked for, and nothing else the schema said. */
  readonly fields: readonly string[];
  /** Each field's type and allowed values, in the same order. */
  readonly specs: readonly FieldSpec[];
}

export type ServerRequestCode =
  | 'SAMPLING_OFF'
  | 'REQUEST_METHOD_UNSUPPORTED'
  | 'REQUEST_INVALID'
  | 'ELICITATION_MODE_UNSUPPORTED'
  | 'ELICITATION_UNSOLICITED'
  | 'ELICITATION_SECRET_FIELD'
  | 'ELICITATION_MALFORMED'
  | 'ELICITATION_RATE_LIMITED';

export interface RpcError {
  readonly code: number;
  readonly message: string;
}

export type ServerRequestDecision =
  | { readonly kind: 'refused'; readonly code: ServerRequestCode; readonly error: RpcError }
  | { readonly kind: 'owner-queue'; readonly item: OwnerQueueItem };

const REFUSAL_ERRORS: Readonly<Record<ServerRequestCode, RpcError>> = Object.freeze({
  SAMPLING_OFF: { code: -32601, message: 'sampling is not available on this client' },
  REQUEST_METHOD_UNSUPPORTED: { code: -32601, message: 'this client does not handle that request' },
  REQUEST_INVALID: { code: -32600, message: 'invalid request' },
  ELICITATION_MODE_UNSUPPORTED: { code: -32602, message: 'only form elicitation is supported' },
  ELICITATION_UNSOLICITED: { code: -32600, message: 'no tool call is waiting for this' },
  ELICITATION_SECRET_FIELD: { code: -32602, message: 'a form may not ask for a secret' },
  ELICITATION_MALFORMED: { code: -32602, message: 'the elicitation is not a flat form of plain fields' },
  ELICITATION_RATE_LIMITED: { code: -32000, message: 'too many requests' },
});

function refusal(code: ServerRequestCode): ServerRequestDecision {
  return { kind: 'refused', code, error: REFUSAL_ERRORS[code] };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

/** One field's allowed values, or `null` for any, or `undefined` when the list is not a short list of plain values. */
function enumOf(value: unknown): readonly AnswerValue[] | null | undefined {
  if (value === undefined) return null;
  const plain = (item: unknown): item is AnswerValue => typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item));
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_ENUM_VALUES && value.every(plain) ? (value as readonly AnswerValue[]) : undefined;
}

/** The fields of a flat form, or `null` when the schema is not one. */
function specsOf(schema: unknown): readonly FieldSpec[] | null {
  const record = asRecord(schema);
  const properties = asRecord(record?.['properties']);
  if (record === null || record['type'] !== 'object' || properties === null) return null;
  const names = Object.keys(properties);
  if (names.length > MAX_ELICITATION_FIELDS || !names.every((name) => FIELD_NAME.test(name))) return null;
  const specs: FieldSpec[] = [];
  for (const name of names) {
    const property = asRecord(properties[name]);
    const type = String(property?.['type']);
    const allowed = enumOf(property?.['enum']);
    if (!FLAT_TYPES.includes(type) || allowed === undefined) return null;
    specs.push(Object.freeze({ name, type: type as FieldSpec['type'], enum: allowed }));
  }
  return specs;
}

function requestIdOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value.length <= 128 ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null;
}

function elicitationItem(serverKey: string, id: string, params: unknown): ServerRequestDecision {
  const record = asRecord(params);
  if (record === null) return refusal('ELICITATION_MALFORMED');
  if (record['mode'] !== undefined && record['mode'] !== 'form') return refusal('ELICITATION_MODE_UNSUPPORTED');
  const message = record['message'];
  const specs = specsOf(record['requestedSchema']);
  if (typeof message !== 'string' || message.trim() === '' || message.length > MAX_ELICITATION_MESSAGE_CHARS || specs === null) return refusal('ELICITATION_MALFORMED');
  if (specs.some((spec) => SECRET_FIELD.test(spec.name))) return refusal('ELICITATION_SECRET_FIELD');
  const fields = specs.map((spec) => spec.name);
  const itemId = `mcpq-${sha256Hex(`${serverKey}\n${id}\n${message}\n${fields.join(',')}`).slice(0, 24)}`;
  return { kind: 'owner-queue', item: Object.freeze({ kind: 'mcp-elicitation' as const, itemId, serverKey, trust: 'untrusted-data' as const, untrustedMessage: message, fields: Object.freeze([...fields]), specs: Object.freeze([...specs]) }) };
}

export interface ServerRequestInput {
  readonly serverKey: string;
  readonly request: unknown;
  /** Times, in ms, that this server's elicitations were put to the owner. */
  readonly window: readonly number[];
  readonly nowMs: number;
  readonly maxPerWindow?: number;
  /** Whether a tool call is waiting on this server. An elicitation is heard only then. */
  readonly callInFlight: boolean;
}

/** The decision and the window to keep. A refused request leaves the window as it was. */
export function decideServerRequest(input: ServerRequestInput): { readonly decision: ServerRequestDecision; readonly window: readonly number[] } {
  const { serverKey, request, window, nowMs } = input;
  const record = asRecord(request);
  const method = record?.['method'];
  const refused = (code: ServerRequestCode) => ({ decision: refusal(code), window });
  if (method === SAMPLING_METHOD) return refused('SAMPLING_OFF');
  if (record === null || typeof method !== 'string') return refused('REQUEST_INVALID');
  if (method !== ELICITATION_METHOD) return refused('REQUEST_METHOD_UNSUPPORTED');
  const id = requestIdOf(record['id']);
  if (id === null) return refused('REQUEST_INVALID');
  const limit = Number.isSafeInteger(input.maxPerWindow) && (input.maxPerWindow as number) > 0 ? (input.maxPerWindow as number) : DEFAULT_ELICITATIONS_PER_WINDOW;
  const recent = window.filter((at) => at > nowMs - ELICITATION_WINDOW_MS);
  if (recent.length >= limit) return { decision: refusal('ELICITATION_RATE_LIMITED'), window: recent };
  // Every elicitation request takes a place in the window before it is judged, so a bad one is not a free probe.
  const counted = [...recent, nowMs];
  if (!input.callInFlight) return { decision: refusal('ELICITATION_UNSOLICITED'), window: counted };
  return { decision: elicitationItem(serverKey, id, record['params']), window: counted };
}

export type OwnerAnswer =
  | { readonly action: 'accept'; readonly content: Readonly<Record<string, AnswerValue>> }
  | { readonly action: 'decline' }
  | { readonly action: 'cancel' };

export type OwnerAnswerResult = { readonly ok: true; readonly answer: OwnerAnswer } | { readonly ok: false; readonly reason: string };

function plainValue(value: unknown): value is AnswerValue {
  return (typeof value === 'string' && value.length <= MAX_ANSWER_VALUE_CHARS) || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** Whether a value is what the server asked for in this field: its type, and one of the allowed values when it named some. */
function satisfies(spec: FieldSpec, value: AnswerValue): boolean {
  const typed = spec.type === 'integer' ? typeof value === 'number' && Number.isInteger(value) : typeof value === spec.type;
  return typed && (spec.enum === null || spec.enum.includes(value));
}

/** The owner's answer, as a server may be told it: every asked field, nothing else, each as typed, and each an allowed value. */
export function parseOwnerAnswer(raw: unknown, item: OwnerQueueItem): OwnerAnswerResult {
  const record = asRecord(raw);
  if (record?.['action'] === 'decline') return { ok: true, answer: { action: 'decline' } };
  if (record?.['action'] === 'cancel') return { ok: true, answer: { action: 'cancel' } };
  if (record?.['action'] !== 'accept') return { ok: false, reason: 'the answer is not accept, decline or cancel' };
  const content = asRecord(record['content']);
  if (content === null) return { ok: false, reason: 'an accept carries the fields that were asked' };
  const entries = Object.entries(content);
  const covers = item.specs.every((spec) => Object.hasOwn(content, spec.name));
  if (!covers || !entries.every(([name, value]) => plainValue(value) && item.specs.some((spec) => spec.name === name && satisfies(spec, value)))) {
    return { ok: false, reason: 'an accept holds every asked field and no other, each as typed and an allowed value' };
  }
  return { ok: true, answer: { action: 'accept', content: Object.freeze(Object.fromEntries(entries) as Record<string, AnswerValue>) } };
}
