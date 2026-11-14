// Origin: original ProjectOS code
/**
 * RECORDED DELETION, WITH THE OWNER WHERE THE REGISTRY SAYS SO (PROJECTOS-MEMORY-PROVENANCE1A, plan 3.3).
 *
 * Core judges (`retention.ts`) and builds the ledger entries (`deletionLedger.ts`); this reads the facts through ports and does
 * the one removal. Nothing here is called by the loop yet: wiring is Stage 4.1.
 *
 * WHICH ACTION COVERS WHICH DELETION (core's `retention.ts` has the reasoning):
 *   - an item in classes 1 to 4 (a decision, plan memory, approved memory, a proposal, an execution record, a promoted skill):
 *     `memory-delete`, P5, the owner, every time. The registry has no lighter deletion entry, so this over-covers on purpose.
 *   - a derived search index (`deleteDerivedIndex`): `memory-index-rebuild`, P2, local, no owner. It removes the one file named
 *     by the owner's hash, so it cannot be aimed at anything else.
 *
 * RECORD FIRST, THEN DELETE. The ledger is a directory of numbered files made with an exclusive create, so two writers cannot
 * take one slot and nothing is rewritten. A deletion appends `authorised`, re-reads the item, removes it, and appends
 * `deleted` (or `delete-failed`). If `authorised` cannot be written, nothing is removed. If only the closing entry cannot be
 * written the deletion stands and the outcome says `recorded: false`. Every REFUSED attempt appends `refused` with its code.
 * A request that cannot be read has no tenant and project to key an entry under, so it is refused and not recorded.
 *
 * THE OWNER IS A PORT THAT ANSWERS EXACTLY `true` (lesson 6). It is asked once, with a frozen claim bound to the item hash,
 * tenant, project and path. The item's hash is read again after the answer and before the removal: an approval is for the
 * bytes the owner was shown, and a file that changed in between is not removed.
 *
 * NO WRITE PORT. The files port has `createExclusive` and `removeFile` and no way to rewrite: the ledger is created into and
 * never removed from. This file imports no process module, no `node:` module and no authority module.
 *
 * The item's hash is `sha256` over its decoded text, as the store digest does. A link, a directory, a file over the cap and a
 * path behind a link are refused (`DELETE_ITEM_NOT_REGULAR`), never removed.
 */
import {
  MEMORY_DELETION_LEDGER_DIR,
  deletionRootProblem,
  isProjectId,
  isTenantId,
  decisionCitesItem,
  deletionEntryFileName,
  deletionEntryOf,
  judgeIndexDeletion,
  judgeMemoryDeletion,
  memoryClassOfPath,
  memoryDeletionRequestOf,
  searchIndexFileName,
  sha256Hex,
  verifyDeletionLedger,
  type DeletionOutcome,
  type DeletionRecordFields,
  type MemoryDeletionCode,
  type OwnerDeletionVerifier,
} from '@projectos/core';
import type { DocumentFs, SearchClock } from '../search/ports.js';

/** The files a ledger is read and extended through. There is no way to rewrite or remove an entry. */
export interface LedgerFiles {
  readText(path: string): string | null;
  listDir(path: string): readonly string[];
  /** Create a file only if it does not exist; `true` when this call created it. */
  createExclusive(path: string, content: string): boolean;
}

export interface DeletionFiles extends LedgerFiles {
  exists(path: string): boolean;
  /** `true` when the file is gone afterwards. */
  removeFile(path: string): boolean;
}

/** The tenant and project this checkout belongs to. A request for another is refused before anyone is asked. */
export interface CheckoutOwner {
  readonly tenant: string;
  readonly project: string;
}

export interface MemoryDeletionPorts {
  /** The pair `root` belongs to: the binding that stops an approval for one project being spent on another's checkout. */
  readonly owner: CheckoutOwner;
  readonly files: DeletionFiles;
  /** An `lstat` and a read, to see what an item is without following a link. */
  readonly fs: DocumentFs;
  readonly clock: SearchClock;
  /** The text of every committed decision, or null when it could not be read (unknown, not none). */
  readonly committedDecisions: () => readonly string[] | null;
  /** The owner. Absent, every deletion in classes 1 to 4 is refused. */
  readonly ownerVerifier?: OwnerDeletionVerifier;
}

export interface IndexDeletionPorts {
  readonly owner: CheckoutOwner;
  readonly files: DeletionFiles;
  readonly clock: SearchClock;
}

export type MemoryDeletionRefusal =
  | MemoryDeletionCode
  | 'DELETE_ITEM_NOT_REGULAR'
  | 'DELETE_NOT_THIS_PROJECT'
  | 'DELETE_REMOVE_FAILED'
  | 'DELETION_LEDGER_UNAVAILABLE'
  | 'DELETION_CLOCK_UNAVAILABLE';

export type MemoryDeletionOutcome =
  | { readonly ok: true; readonly action: 'memory-delete' | 'memory-index-rebuild'; readonly path: string; readonly itemHash: string | null; readonly recorded: boolean }
  | { readonly ok: false; readonly code: MemoryDeletionRefusal; readonly recorded: boolean };

/** Larger than any memory item; over it, an item is not hashed or removed here. */
export const MAX_DELETABLE_ITEM_BYTES = 1_048_576;

const MAX_RECORDED_PATH_CHARS = 512;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

interface Chain {
  readonly count: number;
  readonly lastHash: string;
}

export type DeletionLedgerRead =
  | { readonly ok: true; readonly entries: readonly Record<string, unknown>[]; readonly count: number; readonly lastHash: string }
  | { readonly ok: false; readonly code: string };

const ledgerDirectoryOf = (root: string): string => `${root}/${MEMORY_DELETION_LEDGER_DIR}`;

/** Read the ledger whole, in name order, and verify its chain. A name that is not an entry, or a broken link, refuses it. */
export function readDeletionLedger(files: Pick<LedgerFiles, 'readText' | 'listDir'>, root: string): DeletionLedgerRead {
  const directory = ledgerDirectoryOf(root);
  const names = [...files.listDir(directory)].sort();
  const read: { name: string; text: string }[] = [];
  for (const name of names) {
    const text = files.readText(`${directory}/${name}`);
    if (text === null) return { ok: false, code: 'DELETION_LEDGER_ENTRY_INVALID' };
    read.push({ name, text });
  }
  const verified = verifyDeletionLedger(read);
  if (!verified.ok) return { ok: false, code: verified.code };
  return { ok: true, entries: read.map((entry) => JSON.parse(entry.text) as Record<string, unknown>), count: verified.count, lastHash: verified.lastHash };
}

/** The checkout's owner, copied once, or null when it is not a tenant id and a project id. */
function ownerOf(owner: unknown): CheckoutOwner | null {
  try {
    const { tenant, project } = (owner ?? {}) as { tenant?: unknown; project?: unknown };
    return isTenantId(tenant) && isProjectId(project) ? { tenant, project } : null;
  } catch {
    return null;
  }
}

/** The time as a whole number of milliseconds, or null: an entry without a real time is not made. */
function timeOf(clock: SearchClock): number | null {
  try {
    const now = clock.nowMs();
    return typeof now === 'number' && Number.isSafeInteger(now) && now >= 0 ? now : null;
  } catch {
    return null;
  }
}

/** A path a ledger can hold: printable ASCII within the cap, or a hash of the path when it is not. */
function recordablePath(path: string): string {
  return path.length > 0 && path.length <= MAX_RECORDED_PATH_CHARS && PRINTABLE_ASCII.test(path) ? path : `unrecordable-path:${sha256Hex(path)}`;
}

/** An appender that extends one verified chain: each entry names the one before it, and a taken slot fails the append. */
function appenderOver(files: LedgerFiles, root: string, clock: SearchClock, start: Chain) {
  const directory = ledgerDirectoryOf(root);
  let { count, lastHash } = start;
  return (fields: Omit<DeletionRecordFields, 'atMs'>): boolean => {
    const atMs = timeOf(clock);
    if (atMs === null) return false;
    const entry = deletionEntryOf({ ...fields, atMs }, count + 1, lastHash);
    if (!entry.ok) return false;
    if (!files.createExclusive(`${directory}/${deletionEntryFileName(entry.seq)}`, entry.text)) return false;
    count = entry.seq;
    lastHash = entry.entryHash;
    return true;
  };
}

type Item = { readonly state: 'file'; readonly hash: string } | { readonly state: 'absent' } | { readonly state: 'not-regular' };

/** What is at the item's path: every directory on the way is asked and a link is never followed. */
function itemAt(fs: DocumentFs, root: string, path: string): Item {
  const segments = path.split('/');
  for (let length = 1; length < segments.length; length += 1) {
    const stat = fs.stat(`${root}/${segments.slice(0, length).join('/')}`);
    if (stat === null) return { state: 'absent' };
    if (stat.kind !== 'directory') return { state: 'not-regular' };
  }
  const stat = fs.stat(`${root}/${path}`);
  if (stat === null) return { state: 'absent' };
  if (stat.kind !== 'file' || stat.size > MAX_DELETABLE_ITEM_BYTES) return { state: 'not-regular' };
  const text = fs.readText(`${root}/${path}`);
  return text === null ? { state: 'absent' } : { state: 'file', hash: sha256Hex(text) };
}

function citedByDecisionOf(source: () => readonly string[] | null, item: { readonly path: string; readonly hash: string }): boolean | 'unknown' {
  try {
    const texts = source();
    return texts === null ? 'unknown' : texts.some((text) => decisionCitesItem(text, item));
  } catch {
    return 'unknown';
  }
}

/** Delete one memory item, with the owner, and record it. See the file header for the order. */
export function deleteMemoryItem(ports: MemoryDeletionPorts, root: string, rawRequest: unknown): MemoryDeletionOutcome {
  const request = memoryDeletionRequestOf(rawRequest);
  if (request === null) return { ok: false, code: 'DELETE_REQUEST_INVALID', recorded: false };
  const owner = ownerOf(ports.owner);
  // The root is judged BEFORE the clock or the ledger is touched: a root that cannot be named in the owner's claim writes nothing.
  if (owner === null || deletionRootProblem(root)) return { ok: false, code: 'DELETE_BINDING_INVALID', recorded: false };
  if (timeOf(ports.clock) === null) return { ok: false, code: 'DELETION_CLOCK_UNAVAILABLE', recorded: false };
  const ledger = readDeletionLedger(ports.files, root);
  if (!ledger.ok) return { ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false };
  const append = appenderOver(ports.files, root, ports.clock, ledger);

  const memoryClass = memoryClassOfPath(request.path);
  // Recorded under the checkout's own owner: an attempt for another project is an attempt made HERE, not a deletion for them.
  const fixed = {
    tenant: owner.tenant,
    project: owner.project,
    action: 'memory-delete' as const,
    actionClass: 'P5' as const,
    memoryClass,
    path: recordablePath(request.path),
    itemHash: request.itemHash,
    reason: request.reason,
  };
  const refused = (code: MemoryDeletionRefusal, citedByDecision: boolean | 'unknown' | null): MemoryDeletionOutcome => ({
    ok: false,
    code,
    recorded: append({ ...fixed, outcome: 'refused', code, citedByDecision }),
  });

  if (request.tenant !== owner.tenant || request.project !== owner.project) return refused('DELETE_NOT_THIS_PROJECT', null);

  const found: Item = memoryClass === null ? { state: 'absent' } : itemAt(ports.fs, root, request.path);
  if (found.state === 'not-regular') return refused('DELETE_ITEM_NOT_REGULAR', null);
  const citedByDecision = found.state === 'file' ? citedByDecisionOf(ports.committedDecisions, { path: request.path, hash: found.hash }) : null;
  const judged = judgeMemoryDeletion(request, {
    root,
    ledger: { count: ledger.count, lastHash: ledger.lastHash },
    currentItemHash: found.state === 'file' ? found.hash : null,
    citedByDecision: citedByDecision ?? false,
    ...(ports.ownerVerifier === undefined ? {} : { ownerVerifier: ports.ownerVerifier }),
  });
  if (!judged.ok) return refused(judged.code, citedByDecision);

  const step = (outcome: DeletionOutcome, code: string | null): boolean => append({ ...fixed, outcome, code, citedByDecision: judged.citedByDecision });
  if (!step('authorised', null)) return { ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false };
  const again = itemAt(ports.fs, root, request.path);
  if (again.state !== 'file' || again.hash !== request.itemHash) return { ok: false, code: 'DELETE_HASH_MISMATCH', recorded: step('refused', 'DELETE_HASH_MISMATCH') };
  if (!ports.files.removeFile(`${root}/${request.path}`)) return { ok: false, code: 'DELETE_REMOVE_FAILED', recorded: step('delete-failed', 'DELETE_REMOVE_FAILED') };
  return { ok: true, action: 'memory-delete', path: request.path, itemHash: request.itemHash, recorded: step('deleted', null) };
}

/**
 * Delete one owner's derived search index: `memory-index-rebuild`, P2, local, no owner. The file is the one the owner's hash
 * names in `directory`, so a request cannot name another path; the index rebuilds from the stores, so nothing is lost.
 */
export function deleteDerivedIndex(ports: IndexDeletionPorts, root: string, directory: string, rawRequest: unknown): MemoryDeletionOutcome {
  const judged = judgeIndexDeletion(rawRequest);
  if (!judged.ok) return { ok: false, code: 'DELETE_REQUEST_INVALID', recorded: false };
  const owner = ownerOf(ports.owner);
  if (owner === null || deletionRootProblem(root)) return { ok: false, code: 'DELETE_BINDING_INVALID', recorded: false };
  const named = searchIndexFileName({ tenant: owner.tenant, project: owner.project });
  if (!named.ok) return { ok: false, code: 'DELETE_BINDING_INVALID', recorded: false };
  if (timeOf(ports.clock) === null) return { ok: false, code: 'DELETION_CLOCK_UNAVAILABLE', recorded: false };
  const ledger = readDeletionLedger(ports.files, root);
  if (!ledger.ok) return { ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false };
  const append = appenderOver(ports.files, root, ports.clock, ledger);

  const fixed = {
    tenant: owner.tenant,
    project: owner.project,
    action: judged.action,
    actionClass: judged.actionClass,
    memoryClass: judged.memoryClass,
    path: named.fileName,
    itemHash: null,
    reason: judged.reason,
    citedByDecision: null,
  };
  const target = `${directory.replace(/\/+$/, '')}/${named.fileName}`;
  const step = (outcome: DeletionOutcome, code: string | null): boolean => append({ ...fixed, outcome, code });
  if (judged.tenant !== owner.tenant || judged.project !== owner.project) return { ok: false, code: 'DELETE_NOT_THIS_PROJECT', recorded: step('refused', 'DELETE_NOT_THIS_PROJECT') };
  if (!ports.files.exists(target)) return { ok: false, code: 'DELETE_ITEM_ABSENT', recorded: step('refused', 'DELETE_ITEM_ABSENT') };
  if (!step('authorised', null)) return { ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false };
  if (!ports.files.removeFile(target)) return { ok: false, code: 'DELETE_REMOVE_FAILED', recorded: step('delete-failed', 'DELETE_REMOVE_FAILED') };
  return { ok: true, action: judged.action, path: named.fileName, itemHash: null, recorded: step('deleted', null) };
}
