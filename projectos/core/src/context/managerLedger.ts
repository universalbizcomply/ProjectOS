// Origin: original ProjectOS code
/**
 * THE RETRIEVAL LEDGER (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * Every time stored text is gathered for a run, and every time a context file is placed for a worker, the LOOP writes an entry
 * here. The worker does not write it, and neither does `mintCrossing`: a crossing is a boundary act, and reading stored notes is
 * not one. An entry says whose run it was (tenant, domain, project, envelope, session), the commit it was read at, each item
 * SHOWN (its id or path, the hash of its whole text, its provenance rank and tier, whether the proof held, whether it is an
 * excerpt), each item WITHHELD with a closed code, what was left out for room, which approved decisions were held, whether the
 * run is tainted, and the hash of the file placed. It carries no stored text, only names and hashes.
 *
 * APPEND-ONLY BY CONSTRUCTION. Each entry names the hash of the one before it and its own number, and carries a hash of all of
 * itself. The agent writes one numbered file per entry, created exclusively, so nothing is ever rewritten. The chain finds a
 * changed, removed, reordered or foreign entry in the middle. It cannot show that the newest entries were cut off, and whoever
 * can write the whole directory can rewrite the whole chain: a head hash kept elsewhere would anchor it (named residual).
 *
 * The body is read ONCE into a frozen copy, field by field: a getter, a symbol key, a prototype key and an unlisted field are
 * refused, every string is a closed shape, every list has a bound. Pure.
 */
import { canonicalStringify, sha256Hex } from '../execution/evidence.js';
import { PROVENANCE_KINDS, PROVENANCE_TIERS, type ProvenanceKind } from '../memory/provenance.js';
import { isGitObjectId, plainListOf, plainRecordOf } from '../memory/memoryShapes.js';
import { DOMAINS, isProjectId, isTenantId, type Domain } from '../tenant.js';

export const CONTEXT_LEDGER_SCHEMA = 'projectos.context-retrieval/1';
export const CONTEXT_LEDGER_EVENTS = ['retrieved', 'placed', 'refused'] as const;
export type ContextLedgerEvent = (typeof CONTEXT_LEDGER_EVENTS)[number];
export const CONTEXT_LEDGER_SOURCES = ['committed', 'index', 'approved-decision'] as const;
export type ContextLedgerSource = (typeof CONTEXT_LEDGER_SOURCES)[number];
export const CONTEXT_LEDGER_COMPACTORS = ['none', 'deterministic-selection'] as const;
export type ContextLedgerCompactor = (typeof CONTEXT_LEDGER_COMPACTORS)[number];

export const MAX_CONTEXT_LEDGER_ITEMS = 500;
export const MAX_CONTEXT_LEDGER_ENTRY_CHARS = 200_000;
export const MAX_CONTEXT_LEDGER_ENTRIES = 100_000;
export const MAX_CONTEXT_LEDGER_SEQ = 999_999;
const MAX_ID_CHARS = 256;
const MAX_OVERRULED = 20;

export interface ContextLedgerItem {
  /** A committed path, or `index:` and the path and lines of a hit. */
  readonly id: string;
  readonly kind: ProvenanceKind;
  readonly effectiveKind: ProvenanceKind;
  readonly rank: number;
  readonly tier: number;
  /** `sha256:` and the hash of the WHOLE stored text. */
  readonly contentHash: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly source: ContextLedgerSource;
  /** `fresh`, `stale:<reason>`, or null where no index made the item. */
  readonly freshness: string | null;
  readonly unverifiedClaim: boolean;
  readonly overruledBy: readonly string[];
}

export interface ContextLedgerWithheld {
  readonly id: string;
  /** A closed code: `CONTEXT_ITEM_*` or `PROVENANCE_*` or `COMMITTED_*`. Never prose. */
  readonly code: string;
}

export interface ContextLedgerDecision {
  readonly hash: string;
  readonly target: 'memory' | 'user';
}

export interface ContextLedgerBody {
  readonly event: ContextLedgerEvent;
  readonly sessionId: string;
  readonly tenant: string;
  readonly domain: Domain;
  readonly project: string;
  readonly envelopeId: string;
  readonly headCommit: string | null;
  readonly at: string;
  /** The dispatch this placement was for, from 1. Null for a retrieval. */
  readonly attempt: number | null;
  readonly shown: readonly ContextLedgerItem[];
  readonly withheld: readonly ContextLedgerWithheld[];
  /** Items left out for room, by id. */
  readonly omitted: readonly string[];
  readonly decisions: readonly ContextLedgerDecision[];
  readonly compactor: ContextLedgerCompactor;
  readonly compactionId: string | null;
  readonly estimatedTokens: number;
  /** Stored text is outside content: the run it reached is tainted. */
  readonly taintsRun: boolean;
  /** The hash of the context file as placed, or null for a retrieval that placed none. */
  readonly fileHash: string | null;
  readonly refusal: string | null;
}

export interface ContextLedgerEntry extends ContextLedgerBody {
  readonly schema: typeof CONTEXT_LEDGER_SCHEMA;
  readonly seq: number;
  readonly prevHash: string | null;
  readonly entryHash: string;
}

export type ContextLedgerSealRefusal = 'CONTEXT_LEDGER_BODY_INVALID' | 'CONTEXT_LEDGER_SEQ_INVALID' | 'CONTEXT_LEDGER_PREV_INVALID';
export type ContextLedgerSeal = { readonly ok: true; readonly entry: ContextLedgerEntry } | { readonly ok: false; readonly code: ContextLedgerSealRefusal };

export type ContextLedgerProblemCode = 'CONTEXT_LEDGER_ENTRY_INVALID' | 'CONTEXT_LEDGER_TOO_LONG' | 'CONTEXT_LEDGER_HASH' | 'CONTEXT_LEDGER_CHAIN';

const SESSION_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const ENVELOPE_ID = /^ENV-[0-9a-f]{24}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const WITHHELD_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const COMPACTION_ID = /^ctx-[0-9a-f]{24}$/;
const FRESHNESS = /^(?:fresh|stale:[a-z-]{1,40})$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const BODY_KEYS = [
  'event', 'sessionId', 'tenant', 'domain', 'project', 'envelopeId', 'headCommit', 'at', 'attempt', 'shown', 'withheld',
  'omitted', 'decisions', 'compactor', 'compactionId', 'estimatedTokens', 'taintsRun', 'fileHash', 'refusal',
] as const;
const ENTRY_KEYS = [...BODY_KEYS, 'schema', 'seq', 'prevHash', 'entryHash'] as const;
const ITEM_KEYS = ['id', 'kind', 'effectiveKind', 'rank', 'tier', 'contentHash', 'bytes', 'truncated', 'source', 'freshness', 'unverifiedClaim', 'overruledBy'] as const;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
const isCount = (value: unknown, min: number): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS && value === value.trim() && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value);

function itemOf(value: unknown): ContextLedgerItem | null {
  const read = plainRecordOf(value, ITEM_KEYS);
  if (!read.ok) return null;
  const { id, kind, effectiveKind, rank, tier, contentHash, bytes, truncated, source, freshness, unverifiedClaim, overruledBy } = read.value;
  const overruled = plainListOf(overruledBy, MAX_OVERRULED);
  if (!isId(id) || !isOneOf(PROVENANCE_KINDS, kind) || !isOneOf(PROVENANCE_KINDS, effectiveKind)) return null;
  if (!isCount(rank, 1) || !isCount(tier, 0) || tier > 3 || tier !== PROVENANCE_TIERS[effectiveKind]) return null;
  if (typeof contentHash !== 'string' || !CONTENT_HASH.test(contentHash) || !isCount(bytes, 0)) return null;
  if (typeof truncated !== 'boolean' || typeof unverifiedClaim !== 'boolean' || !isOneOf(CONTEXT_LEDGER_SOURCES, source)) return null;
  if (freshness !== null && (typeof freshness !== 'string' || !FRESHNESS.test(freshness))) return null;
  if (overruled === null || !overruled.every(isId)) return null;
  return Object.freeze({ id, kind, effectiveKind, rank, tier, contentHash, bytes, truncated, source, freshness: freshness ?? null, unverifiedClaim, overruledBy: Object.freeze([...overruled] as string[]) });
}

function listOf<T>(value: unknown, max: number, each: (item: unknown) => T | null): readonly T[] | null {
  const list = plainListOf(value, max);
  if (list === null) return null;
  const out: T[] = [];
  for (const raw of list) {
    const item = each(raw);
    if (item === null) return null;
    out.push(item);
  }
  return Object.freeze(out);
}

const withheldOf = (value: unknown): ContextLedgerWithheld | null => {
  const read = plainRecordOf(value, ['id', 'code']);
  if (!read.ok || !isId(read.value['id']) || typeof read.value['code'] !== 'string' || !WITHHELD_CODE.test(read.value['code'])) return null;
  return Object.freeze({ id: read.value['id'], code: read.value['code'] });
};

const decisionOf = (value: unknown): ContextLedgerDecision | null => {
  const read = plainRecordOf(value, ['hash', 'target']);
  const { hash, target } = read.ok ? read.value : { hash: undefined, target: undefined };
  if (typeof hash !== 'string' || !CONTENT_HASH.test(hash) || (target !== 'memory' && target !== 'user')) return null;
  return Object.freeze({ hash, target });
};

const idOf = (value: unknown): string | null => (isId(value) ? value : null);

/** The body, read once into a frozen copy of closed shapes, or null. */
function bodyOf(value: unknown, keys: readonly string[]): ContextLedgerBody | null {
  const read = plainRecordOf(value, keys);
  if (!read.ok) return null;
  const b = read.value;
  const { event, sessionId, tenant, domain, project, envelopeId, headCommit, at, attempt, estimatedTokens, taintsRun, fileHash, refusal, compactor, compactionId } = b;
  if (!isOneOf(CONTEXT_LEDGER_EVENTS, event) || typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
  if (!isTenantId(tenant) || !isOneOf(DOMAINS, domain) || !isProjectId(project)) return null;
  if (typeof envelopeId !== 'string' || !ENVELOPE_ID.test(envelopeId)) return null;
  if (headCommit !== null && !isGitObjectId(headCommit)) return null;
  if (typeof at !== 'string' || !ISO_INSTANT.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (attempt !== null && !isCount(attempt, 1)) return null;
  if (!isOneOf(CONTEXT_LEDGER_COMPACTORS, compactor) || (compactionId !== null && (typeof compactionId !== 'string' || !COMPACTION_ID.test(compactionId)))) return null;
  if (!isCount(estimatedTokens, 0) || typeof taintsRun !== 'boolean') return null;
  if (fileHash !== null && (typeof fileHash !== 'string' || !CONTENT_HASH.test(fileHash))) return null;
  if (refusal !== null && (typeof refusal !== 'string' || !WITHHELD_CODE.test(refusal))) return null;
  const shown = listOf(b['shown'], MAX_CONTEXT_LEDGER_ITEMS, itemOf);
  const withheld = listOf(b['withheld'], MAX_CONTEXT_LEDGER_ITEMS, withheldOf);
  const omitted = listOf(b['omitted'], MAX_CONTEXT_LEDGER_ITEMS, idOf);
  const decisions = listOf(b['decisions'], MAX_CONTEXT_LEDGER_ITEMS, decisionOf);
  if (shown === null || withheld === null || omitted === null || decisions === null) return null;
  return Object.freeze({
    event, sessionId, tenant, domain, project, envelopeId, headCommit: headCommit ?? null, at, attempt: attempt ?? null,
    shown, withheld, omitted, decisions, compactor, compactionId: compactionId ?? null, estimatedTokens, taintsRun, fileHash: fileHash ?? null, refusal: refusal ?? null,
  });
}

const hashOf = (fields: unknown): string => `sha256:${sha256Hex(canonicalStringify(fields))}`;

/** Seal one entry: its number, the hash of the entry before it, and a hash of everything in it. */
export function sealContextLedgerEntry(body: unknown, seq: unknown, prevHash: unknown): ContextLedgerSeal {
  const checked = bodyOf(body, BODY_KEYS);
  if (checked === null) return { ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' };
  if (!isCount(seq, 1) || seq > MAX_CONTEXT_LEDGER_SEQ) return { ok: false, code: 'CONTEXT_LEDGER_SEQ_INVALID' };
  const chained = seq === 1 ? prevHash === null : typeof prevHash === 'string' && CONTENT_HASH.test(prevHash);
  if (!chained) return { ok: false, code: 'CONTEXT_LEDGER_PREV_INVALID' };
  const fields = { ...checked, schema: CONTEXT_LEDGER_SCHEMA, seq, prevHash: prevHash as string | null };
  return { ok: true, entry: Object.freeze({ ...fields, entryHash: hashOf(fields) }) as ContextLedgerEntry };
}

function entryOf(value: unknown): ContextLedgerEntry | null {
  const read = plainRecordOf(value, ENTRY_KEYS);
  if (!read.ok) return null;
  const { schema, seq, prevHash, entryHash } = read.value;
  const body = bodyOf(Object.fromEntries(BODY_KEYS.map((key) => [key, read.value[key]])), BODY_KEYS);
  if (body === null || schema !== CONTEXT_LEDGER_SCHEMA || !isCount(seq, 1) || seq > MAX_CONTEXT_LEDGER_SEQ) return null;
  if (prevHash !== null && (typeof prevHash !== 'string' || !CONTENT_HASH.test(prevHash))) return null;
  if (typeof entryHash !== 'string' || !CONTENT_HASH.test(entryHash)) return null;
  return Object.freeze({ ...body, schema: CONTEXT_LEDGER_SCHEMA, seq, prevHash: prevHash ?? null, entryHash }) as ContextLedgerEntry;
}

/** The first thing wrong with this chain, or null. Each entry is read once; the walk is bounded. */
export function contextLedgerProblem(entries: unknown): { readonly index: number; readonly code: ContextLedgerProblemCode } | null {
  if (!Array.isArray(entries)) return { index: 0, code: 'CONTEXT_LEDGER_ENTRY_INVALID' };
  if (entries.length > MAX_CONTEXT_LEDGER_ENTRIES) return { index: 0, code: 'CONTEXT_LEDGER_TOO_LONG' };
  const list = plainListOf(entries, MAX_CONTEXT_LEDGER_ENTRIES);
  if (list === null) return { index: 0, code: 'CONTEXT_LEDGER_ENTRY_INVALID' };
  let previous: ContextLedgerEntry | null = null;
  for (const [index, raw] of list.entries()) {
    const entry = entryOf(raw);
    if (entry === null) return { index, code: 'CONTEXT_LEDGER_ENTRY_INVALID' };
    const { entryHash, ...fields } = entry;
    if (hashOf(fields) !== entryHash) return { index, code: 'CONTEXT_LEDGER_HASH' };
    if (entry.seq !== index + 1 || entry.prevHash !== (previous?.entryHash ?? null)) return { index, code: 'CONTEXT_LEDGER_CHAIN' };
    previous = entry;
  }
  return null;
}

/** One entry from its file text. Text over the size is refused before it is parsed. */
export function parseContextLedgerEntry(text: unknown): { readonly ok: true; readonly entry: ContextLedgerEntry } | { readonly ok: false; readonly code: 'CONTEXT_LEDGER_ENTRY_INVALID' } {
  const bad = { ok: false, code: 'CONTEXT_LEDGER_ENTRY_INVALID' } as const;
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CONTEXT_LEDGER_ENTRY_CHARS) return bad;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return bad;
  }
  const entry = entryOf(parsed);
  if (entry === null) return bad;
  const { entryHash, ...fields } = entry;
  return hashOf(fields) === entryHash ? { ok: true, entry } : bad;
}

const FILE_NAME = /^(\d{6})\.json$/;

/** `000001.json`: one spelling for each number, so two names cannot be one entry. */
export function contextLedgerFileName(seq: unknown): string | null {
  return isCount(seq, 1) && seq <= MAX_CONTEXT_LEDGER_SEQ ? `${String(seq).padStart(6, '0')}.json` : null;
}

/** The number a file name carries, or null when it is not exactly a name `contextLedgerFileName` would give. */
export function contextLedgerSeqOfFileName(name: unknown): number | null {
  if (typeof name !== 'string') return null;
  const found = FILE_NAME.exec(name);
  const seq = found === null ? 0 : Number(found[1]);
  return seq >= 1 ? seq : null;
}
