// Origin: original ProjectOS code
/**
 * The record of a compaction: what went in, who summarised it, and what stayed.
 *
 * A summary is the one place outside text can stop looking like outside text, so its record carries the
 * marks forward. It lists each turn it covered with that turn's origin and trust, and the untrusted origins
 * and sources it inherited from the summary before it, so three compactions later a reader can still see a
 * web page went in. Upstream records none of this.
 *
 * The hash detects a change, and it is not a signature: anyone who can rewrite a record can reseal it.
 * Signing belongs with owner proof, as it does for memory. Pure.
 */
import { createHash } from 'node:crypto';
import { isContextLabel } from './refusal.js';
import { CONTEXT_ORIGINS, textKey, trustOfOrigin, type ContextOrigin, type ContextRole, type ContextSourceRef, type ContextTrust, type ContextTurn } from './turn.js';

const COMPACTION_SCHEMA = 'projectos.context-compaction/1';
const COMPACTION_ID = /^ctx-[0-9a-f]{24}$/;
const ISO_INSTANT = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;
const DAY_MS = 86_400_000;
/** A model writes a summary. These names say something else did. */
const NOT_A_SUMMARISER = ['owner', 'kernel', 'system'];

/** A turn as the record remembers it: enough to say what it was, without keeping its text. */
export interface TurnMark {
  readonly turnId: string;
  readonly role: ContextRole;
  readonly origin: ContextOrigin;
  readonly trust: ContextTrust;
  readonly textKey: string;
  readonly source: ContextSourceRef | null;
}

interface CompactionRecordBody {
  readonly agentId: string;
  readonly summarisedBy: string;
  readonly session: string;
  readonly compactedAt: string;
  /** The turns this summary replaced. */
  readonly covered: readonly TurnMark[];
  /** The turns that stayed, so what stayed untrusted is on the record too. */
  readonly kept: readonly TurnMark[];
  readonly priorCompactionId: string | null;
  readonly summaryHash: string;
  /** Every untrusted origin in this summary's history, sorted. */
  readonly carriedOrigins: readonly ContextOrigin[];
  /** Every source in this summary's history. */
  readonly carriedSources: readonly ContextSourceRef[];
  /** Every approved decision held when this ran. Each stays, by `thread.ts`. */
  readonly decisionHashes: readonly string[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

export interface CompactionRecord extends CompactionRecordBody {
  readonly schema: typeof COMPACTION_SCHEMA;
  readonly id: string;
  readonly recordHash: string;
}

export function turnMark(turn: ContextTurn): TurnMark {
  return { turnId: turn.id, role: turn.role, origin: turn.origin, trust: trustOfOrigin(turn.origin), textKey: textKey(turn.text), source: turn.source };
}

function hashBody(body: CompactionRecordBody): string {
  const fields = [
    COMPACTION_SCHEMA,
    body.agentId,
    body.summarisedBy,
    body.session,
    body.compactedAt,
    body.covered,
    body.kept,
    body.priorCompactionId,
    body.summaryHash,
    body.carriedOrigins,
    body.carriedSources,
    body.decisionHashes,
    body.tokensBefore,
    body.tokensAfter,
  ];
  return `sha256:${createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex')}`;
}

const idOf = (recordHash: string): string => `ctx-${recordHash.slice('sha256:'.length, 'sha256:'.length + 24)}`;

export function sealCompactionRecord(body: CompactionRecordBody): CompactionRecord {
  const recordHash = hashBody(body);
  return { ...body, schema: COMPACTION_SCHEMA, id: idOf(recordHash), recordHash };
}

/** A time of the right shape, on a day that exists. */
function isRealInstant(value: unknown): boolean {
  const parts = typeof value === 'string' ? ISO_INSTANT.exec(value) : null;
  if (parts === null) return false;
  const [year, month, day] = parts.slice(1, 4).map(Number) as [number, number, number];
  return day <= (Date.UTC(year, month, 1) - Date.UTC(year, month - 1, 1)) / DAY_MS;
}

/** A draft's provenance has this shape before it can be sealed. */
export function compactionProvenanceProblem(fields: { readonly summarisedBy: unknown; readonly session: unknown; readonly at: unknown }): string | null {
  if (!isContextLabel(fields.summarisedBy) || NOT_A_SUMMARISER.includes(fields.summarisedBy.toLowerCase())) return 'which model summarised it';
  if (!isContextLabel(fields.session)) return 'a session';
  if (!isRealInstant(fields.at)) return 'a real time';
  return null;
}

/** Null when this record is what it says it is. */
export function compactionRecordProblem(record: CompactionRecord): string | null {
  if (record.schema !== COMPACTION_SCHEMA) return 'its schema is not one this version reads';
  if (record.recordHash !== hashBody(record)) return 'its hash does not match what it says';
  if (record.id !== idOf(record.recordHash) || !COMPACTION_ID.test(record.id)) return 'its id does not match its hash';
  return null;
}

/** What a summary inherits: every untrusted origin and every source that went into it, at any distance. */
export function carriedMarks(covered: readonly TurnMark[], prior: CompactionRecord | null): Pick<CompactionRecordBody, 'carriedOrigins' | 'carriedSources'> {
  const origins = new Set([...(prior?.carriedOrigins ?? []), ...covered.filter((mark) => mark.trust === 'untrusted').map((mark) => mark.origin)]);
  const sources = [...(prior?.carriedSources ?? []), ...covered.flatMap((mark) => (mark.source === null ? [] : [mark.source]))];
  const seen = new Map(sources.map((source) => [`${source.sourceId}\n${source.contentHash}`, source]));
  return { carriedOrigins: CONTEXT_ORIGINS.filter((origin) => origins.has(origin)), carriedSources: [...seen.values()] };
}
