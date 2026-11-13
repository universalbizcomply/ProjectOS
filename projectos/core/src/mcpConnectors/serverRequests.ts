// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/mcp_tool_sampling.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript as pure decisions; the sampling handler and everything it called, which let a server have the client's model write for it, is removed, and sampling/createMessage is refused whatever it carries, with no setting that turns it on; upstream's sliding one-minute request window is kept and now limits elicitations; elicitation keeps upstream's form-mode-only rule and its fail-closed answers, and is routed to an owner-queue item where upstream routed it to the chat approval prompt; a field description, which is the server's own text, is not carried into the item; the owner's answer is checked against the fields that were asked
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
 * server chose. A server that asks too often is refused for the rest of the window. Pure: the clock is an argument.
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

export interface OwnerQueueItem {
  readonly kind: 'mcp-elicitation';
  readonly itemId: string;
  readonly serverKey: string;
  readonly trust: 'untrusted-data';
  /** The server's own words. Shown to the owner as quoted text, and acted on by nothing. */
  readonly untrustedMessage: string;
  /** The names of the fields asked for, and nothing else the schema said. */
  readonly fields: readonly string[];
}

export type ServerRequestCode =
  | 'SAMPLING_OFF'
  | 'REQUEST_METHOD_UNSUPPORTED'
  | 'REQUEST_INVALID'
  | 'ELICITATION_MODE_UNSUPPORTED'
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
  ELICITATION_MALFORMED: { code: -32602, message: 'the elicitation is not a flat form of plain fields' },
  ELICITATION_RATE_LIMITED: { code: -32000, message: 'too many requests' },
});

function refusal(code: ServerRequestCode): ServerRequestDecision {
  return { kind: 'refused', code, error: REFUSAL_ERRORS[code] };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

/** The names of the requested fields, or `null` when the schema is not a flat form of plain fields. */
function fieldsOf(schema: unknown): readonly string[] | null {
  const record = asRecord(schema);
  const properties = asRecord(record?.['properties']);
  if (record === null || record['type'] !== 'object' || properties === null) return null;
  const names = Object.keys(properties);
  const flat = names.every((name) => FIELD_NAME.test(name) && FLAT_TYPES.includes(String(asRecord(properties[name])?.['type'])));
  return flat && names.length <= MAX_ELICITATION_FIELDS ? names : null;
}

function requestIdOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value.length <= 128 ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null;
}

function elicitationItem(serverKey: string, id: string, params: unknown): ServerRequestDecision {
  const record = asRecord(params);
  if (record === null) return refusal('ELICITATION_MALFORMED');
  if (record['mode'] !== undefined && record['mode'] !== 'form') return refusal('ELICITATION_MODE_UNSUPPORTED');
  const message = record['message'];
  const fields = fieldsOf(record['requestedSchema']);
  if (typeof message !== 'string' || message.trim() === '' || message.length > MAX_ELICITATION_MESSAGE_CHARS || fields === null) return refusal('ELICITATION_MALFORMED');
  const itemId = `mcpq-${sha256Hex(`${serverKey}\n${id}\n${message}\n${fields.join(',')}`).slice(0, 24)}`;
  return { kind: 'owner-queue', item: Object.freeze({ kind: 'mcp-elicitation' as const, itemId, serverKey, trust: 'untrusted-data' as const, untrustedMessage: message, fields: Object.freeze([...fields]) }) };
}

export interface ServerRequestInput {
  readonly serverKey: string;
  readonly request: unknown;
  /** Times, in ms, that this server's elicitations were put to the owner. */
  readonly window: readonly number[];
  readonly nowMs: number;
  readonly maxPerWindow?: number;
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
  const item = elicitationItem(serverKey, id, record['params']);
  if (item.kind === 'refused') return { decision: item, window };
  const limit = Number.isSafeInteger(input.maxPerWindow) && (input.maxPerWindow as number) > 0 ? (input.maxPerWindow as number) : DEFAULT_ELICITATIONS_PER_WINDOW;
  const recent = window.filter((at) => at > nowMs - ELICITATION_WINDOW_MS);
  if (recent.length >= limit) return { decision: refusal('ELICITATION_RATE_LIMITED'), window: recent };
  return { decision: item, window: [...recent, nowMs] };
}

export type OwnerAnswer =
  | { readonly action: 'accept'; readonly content: Readonly<Record<string, string | number | boolean>> }
  | { readonly action: 'decline' }
  | { readonly action: 'cancel' };

export type OwnerAnswerResult = { readonly ok: true; readonly answer: OwnerAnswer } | { readonly ok: false; readonly reason: string };

function plainValue(value: unknown): value is string | number | boolean {
  return (typeof value === 'string' && value.length <= MAX_ANSWER_VALUE_CHARS) || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** The owner's answer, as a server may be told it: only the fields that were asked, only plain values. */
export function parseOwnerAnswer(raw: unknown, item: OwnerQueueItem): OwnerAnswerResult {
  const record = asRecord(raw);
  if (record?.['action'] === 'decline') return { ok: true, answer: { action: 'decline' } };
  if (record?.['action'] === 'cancel') return { ok: true, answer: { action: 'cancel' } };
  if (record?.['action'] !== 'accept') return { ok: false, reason: 'the answer is not accept, decline or cancel' };
  const content = asRecord(record['content']);
  if (content === null) return { ok: false, reason: 'an accept carries the fields that were asked' };
  const entries = Object.entries(content);
  if (!entries.every(([name, value]) => item.fields.includes(name) && plainValue(value))) return { ok: false, reason: 'an accept holds only the asked fields, with plain values' };
  return { ok: true, answer: { action: 'accept', content: Object.freeze(Object.fromEntries(entries) as Record<string, string | number | boolean>) } };
}
