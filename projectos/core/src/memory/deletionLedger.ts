// Origin: original ProjectOS code
/**
 * THE APPEND-ONLY RECORD OF EVERY DELETION (PROJECTOS-MEMORY-PROVENANCE1A, plan 3.3).
 *
 * Every deletion, and every REFUSED attempt, becomes one entry: who it was for (tenant, project), what it was (action, class,
 * path), the hash of the bytes it named, the reason the caller gave, and what happened (`authorised`, `deleted`, `refused`,
 * `delete-failed`) with the refusal's code. The agent writes one file per entry, `<seq>.json`, with an exclusive create, so
 * two writers cannot take the same slot and nothing is ever rewritten.
 *
 * THE CHAIN. Each entry holds the hash of the entry before it (`prevHash`, the genesis for the first) and its own hash over
 * every other field in canonical form. A changed field changes its hash; a removed, reordered or foreign entry breaks the
 * link. `verifyDeletionLedger` reads the entries in the order given and names the first fault by code. It does not sort: a
 * listing that comes back out of order is a fault, not something to repair.
 *
 * WHAT THIS CANNOT PROVE. A chain shows that an entry changed or went missing from the middle. It does not stop someone who
 * can write the whole directory from rewriting the whole chain, and it cannot show that the LAST entry was cut off. A head
 * hash kept somewhere else (the closure ledger, a commit) is what would, and that is for the wiring phase to choose.
 *
 * Pure: no I/O, no clock (the time arrives in the fields).
 */
import { canonicalStringify, sha256Hex } from '../execution/evidence.js';
import { isProjectId, isTenantId } from '../tenant.js';
import { isSha256Hex, plainRecordOf } from './memoryShapes.js';
import { MEMORY_CLASS_IDS, deletionReasonProblem } from './retention.js';

/** Where the agent keeps the entries, relative to the project root. */
export const MEMORY_DELETION_LEDGER_DIR = '.projectops/memory-deletions';

export const DELETION_LEDGER_GENESIS = '0'.repeat(64);
export const DELETION_OUTCOMES = ['authorised', 'deleted', 'refused', 'delete-failed'] as const;
export type DeletionOutcome = (typeof DELETION_OUTCOMES)[number];

const MAX_ENTRY_TEXT_CHARS = 4096;
const MAX_PATH_CHARS = 512;
const MAX_SEQ = 9_999_999_999;
const ENTRY_NAME = /^(\d{10})\.json$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PRINTABLE = /^[\x20-\x7e]+$/;

export interface DeletionRecordFields {
  readonly tenant: string;
  readonly project: string;
  readonly action: 'memory-delete' | 'memory-index-rebuild';
  readonly actionClass: 'P5' | 'P2';
  /** Null for an attempt on something that is not a memory item at all. */
  readonly memoryClass: string | null;
  readonly path: string;
  readonly itemHash: string | null;
  readonly reason: string;
  readonly outcome: DeletionOutcome;
  readonly code: string | null;
  readonly citedByDecision: boolean | 'unknown' | null;
  readonly atMs: number;
}

const FIELD_KEYS = ['tenant', 'project', 'action', 'actionClass', 'memoryClass', 'path', 'itemHash', 'reason', 'outcome', 'code', 'citedByDecision', 'atMs'] as const;
const ENTRY_KEYS = [...FIELD_KEYS, 'seq', 'prevHash', 'entryHash'] as const;

/** The only two pairings: a delete is P5 and an index rebuild is P2. */
const ACTION_CLASS: Readonly<Record<string, string>> = Object.freeze({ 'memory-delete': 'P5', 'memory-index-rebuild': 'P2' });

export type DeletionLedgerCode =
  | 'DELETION_RECORD_INVALID'
  | 'DELETION_LEDGER_ENTRY_INVALID'
  | 'DELETION_LEDGER_ENTRY_ALTERED'
  | 'DELETION_LEDGER_GAP'
  | 'DELETION_LEDGER_CHAIN_BROKEN';

export const deletionEntryFileName = (seq: number): string => `${String(seq).padStart(10, '0')}.json`;

type Body = Readonly<Record<string, unknown>>;

function fieldsOf(raw: unknown): Body | null {
  const read = plainRecordOf(raw, FIELD_KEYS);
  if (!read.ok) return null;
  const v = read.value;
  const known =
    isTenantId(v['tenant']) &&
    isProjectId(v['project']) &&
    typeof v['action'] === 'string' &&
    ACTION_CLASS[v['action']] === v['actionClass'] &&
    (v['memoryClass'] === null || (typeof v['memoryClass'] === 'string' && (MEMORY_CLASS_IDS as readonly string[]).includes(v['memoryClass']))) &&
    typeof v['path'] === 'string' &&
    v['path'].length > 0 &&
    v['path'].length <= MAX_PATH_CHARS &&
    PRINTABLE.test(v['path']) &&
    (v['itemHash'] === null || isSha256Hex(v['itemHash'])) &&
    !deletionReasonProblem(v['reason']) &&
    typeof v['outcome'] === 'string' &&
    (DELETION_OUTCOMES as readonly string[]).includes(v['outcome']) &&
    (v['code'] === null || (typeof v['code'] === 'string' && CODE.test(v['code']))) &&
    (v['citedByDecision'] === null || typeof v['citedByDecision'] === 'boolean' || v['citedByDecision'] === 'unknown') &&
    typeof v['atMs'] === 'number' &&
    Number.isSafeInteger(v['atMs']) &&
    v['atMs'] >= 0;
  return known && FIELD_KEYS.every((key) => key in v) ? v : null;
}

const hashOf = (body: Body): string => sha256Hex(canonicalStringify(body));

export type DeletionEntry =
  | { readonly ok: true; readonly seq: number; readonly entryHash: string; readonly text: string }
  | { readonly ok: false; readonly code: 'DELETION_RECORD_INVALID' };

/** Make entry number `seq`, chained to `prevHash`. A record it could not trust is refused whole. */
export function deletionEntryOf(rawFields: unknown, seq: number, prevHash: string): DeletionEntry {
  const fields = fieldsOf(rawFields);
  if (fields === null || !Number.isSafeInteger(seq) || seq < 1 || seq > MAX_SEQ || !isSha256Hex(prevHash)) return { ok: false, code: 'DELETION_RECORD_INVALID' };
  const body: Body = { ...fields, seq, prevHash };
  const entryHash = hashOf(body);
  return { ok: true, seq, entryHash, text: JSON.stringify({ ...body, entryHash }) };
}

export type DeletionLedgerVerification =
  | { readonly ok: true; readonly count: number; readonly lastHash: string }
  | { readonly ok: false; readonly code: DeletionLedgerCode; readonly seq: number | null };

const broken = (code: DeletionLedgerCode, seq: number | null): DeletionLedgerVerification => ({ ok: false, code, seq });

/** Read the entries in the order given. The first fault is named; nothing is sorted or repaired. */
export function verifyDeletionLedger(files: readonly { readonly name: string; readonly text: string }[]): DeletionLedgerVerification {
  let previous = DELETION_LEDGER_GENESIS;
  let expected = 1;
  for (const file of files) {
    const named = typeof file.name === 'string' ? ENTRY_NAME.exec(file.name) : null;
    if (named === null || typeof file.text !== 'string' || file.text.length > MAX_ENTRY_TEXT_CHARS) return broken('DELETION_LEDGER_ENTRY_INVALID', null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text);
    } catch {
      return broken('DELETION_LEDGER_ENTRY_INVALID', null);
    }
    const read = plainRecordOf(parsed, ENTRY_KEYS);
    if (!read.ok) return broken('DELETION_LEDGER_ENTRY_INVALID', null);
    const { seq, prevHash, entryHash, ...rest } = read.value;
    if (fieldsOf(rest) === null || typeof seq !== 'number' || !Number.isSafeInteger(seq) || !isSha256Hex(prevHash) || !isSha256Hex(entryHash)) {
      return broken('DELETION_LEDGER_ENTRY_INVALID', null);
    }
    if (hashOf({ ...rest, seq, prevHash }) !== entryHash) return broken('DELETION_LEDGER_ENTRY_ALTERED', seq);
    if (Number(named[1]) !== expected || seq !== expected) return broken('DELETION_LEDGER_GAP', seq);
    if (prevHash !== previous) return broken('DELETION_LEDGER_CHAIN_BROKEN', seq);
    previous = entryHash;
    expected += 1;
  }
  return { ok: true, count: files.length, lastHash: previous };
}
