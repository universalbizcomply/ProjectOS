// Origin: original ProjectOS code
/**
 * A DIGEST OF THE MEMORY AND SKILL STORES, TAKEN WITHOUT GIT (PROJECTOS-MEMORY-STORES1A, fix round 1, M7).
 *
 * Detecting a worker's direct write by the paths `git status` lists works only while the stores are tracked and not ignored.
 * The moment `.projectops/memory/` is git-ignored (the proposed fix for a clone-borne store), `git status` stops listing a write
 * to it and the path check sees nothing. So the check that does not depend on git is a digest: the wiring takes one before
 * the worker runs and one after, and `checkStoreUnchanged` refuses on any difference.
 *
 * WHAT IS DIGESTED. Every file and directory under `.projectops/memory` and `.projectops/skills`, by relative path, with a hash of
 * the file's size and text. Nothing else: a change to `.projectops/execution/`, to a document, or to anything outside the two
 * roots is not a change to a store. A root that is absent has no entries, so a store that appears is an addition.
 *
 * THE WALK IS A PORT AND REFUSES LINKS. It reads through a `DocumentFs` (stat, list, read), and `.projectops`, each root and every
 * entry below them are asked first. A link anywhere is refused, never followed, because a junction would let a digest cover files
 * outside the project and miss the ones inside. An entry that is neither file nor directory, a file that cannot be read, and a tree
 * over the bound (entries, depth, bytes) are refused too. A digest that could not look is not a digest, so a refused snapshot on
 * either side refuses the comparison.
 *
 * WHAT THIS CANNOT SEE. `readText` decodes UTF-8, so two files that differ only in bytes that decode to the same replacement
 * characters, at the same size, hash alike. And it sees the stores as they are at two moments, not a write that was undone
 * between them. Neither is a path that a worker's text tools take to a store, but both are named here.
 */
import { createHash } from 'node:crypto';
import type { DocumentFs } from '../search/ports.js';

const STORE_ROOTS: readonly string[] = ['.projectops/memory', '.projectops/skills'];
const PROJECTOPS = '.projectops';
export const MAX_STORE_DIGEST_FILES = 2_000;
export const MAX_STORE_DIGEST_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_STORE_DIGEST_DEPTH = 8;
const MAX_REPORTED = 50;

export interface MemoryStoreEntry {
  /** Project-relative, with `/` separators. */
  readonly path: string;
  /** `directory`, or the hash of a file's size and text. */
  readonly hash: string;
}

export interface MemoryStoreSnapshot {
  readonly digest: string;
  readonly files: readonly MemoryStoreEntry[];
}

export type MemoryStoreSnapshotRefusalCode = 'MEMORY_STORE_LINK' | 'MEMORY_STORE_UNREADABLE' | 'MEMORY_STORE_TOO_LARGE';

export type MemoryStoreSnapshotResult =
  | { readonly ok: true; readonly snapshot: MemoryStoreSnapshot }
  | { readonly ok: false; readonly code: MemoryStoreSnapshotRefusalCode; readonly path: string; readonly message: string };

export type StoreChange =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'MEMORY_STORE_CHANGED';
      readonly message: string;
      readonly added: readonly string[];
      readonly removed: readonly string[];
      readonly changed: readonly string[];
    }
  | { readonly ok: false; readonly code: 'MEMORY_STORE_UNCHECKED'; readonly message: string };

const sha256 = (text: string): string => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const refusal = (code: MemoryStoreSnapshotRefusalCode, path: string, message: string): MemoryStoreSnapshotResult => ({ ok: false, code, path, message });

interface Walk {
  readonly entries: MemoryStoreEntry[];
  bytes: number;
}

type Stopped = Extract<MemoryStoreSnapshotResult, { ok: false }>;

function walkDirectory(fs: DocumentFs, root: string, relative: string, depth: number, walk: Walk): Stopped | null {
  if (depth > MAX_STORE_DIGEST_DEPTH) return refusal('MEMORY_STORE_TOO_LARGE', relative, 'A store is nested deeper than the digest reads.') as Stopped;
  for (const name of [...fs.listDir(`${root}/${relative}`)].sort()) {
    const path = `${relative}/${name}`;
    if (walk.entries.length >= MAX_STORE_DIGEST_FILES) return refusal('MEMORY_STORE_TOO_LARGE', path, `A store holds more than ${MAX_STORE_DIGEST_FILES} entries, so none was digested.`) as Stopped;
    const stat = fs.stat(`${root}/${path}`);
    if (stat === null) return refusal('MEMORY_STORE_UNREADABLE', path, 'An entry in a store could not be read.') as Stopped;
    if (stat.kind === 'link') return refusal('MEMORY_STORE_LINK', path, 'A link in a store is not followed, so the store was not digested.') as Stopped;
    if (stat.kind === 'directory') {
      walk.entries.push({ path, hash: 'directory' });
      const inner = walkDirectory(fs, root, path, depth + 1, walk);
      if (inner !== null) return inner;
      continue;
    }
    if (stat.kind !== 'file') return refusal('MEMORY_STORE_UNREADABLE', path, 'An entry in a store is neither a file nor a directory.') as Stopped;
    walk.bytes += stat.size;
    if (walk.bytes > MAX_STORE_DIGEST_TOTAL_BYTES) return refusal('MEMORY_STORE_TOO_LARGE', path, `A store holds more than ${MAX_STORE_DIGEST_TOTAL_BYTES} bytes, so none was digested.`) as Stopped;
    const text = fs.readText(`${root}/${path}`);
    if (text === null) return refusal('MEMORY_STORE_UNREADABLE', path, 'A file in a store could not be read.') as Stopped;
    walk.entries.push({ path, hash: sha256(`${stat.size}\0${text}`) });
  }
  return null;
}

/** Whether `.projectops` and a store root are there to walk: absent is fine, a link is refused, a non-directory is unreadable. */
function rootProblem(fs: DocumentFs, root: string, directory: string): Stopped | 'absent' | null {
  const stat = fs.stat(`${root}/${directory}`);
  if (stat === null) return 'absent';
  if (stat.kind === 'link') return refusal('MEMORY_STORE_LINK', directory, 'A link at a store or its parent is not followed, so the store was not digested.') as Stopped;
  return stat.kind === 'directory' ? null : (refusal('MEMORY_STORE_UNREADABLE', directory, 'A store is not a directory.') as Stopped);
}

/** The digest of both stores under `root`, read through `fs`, or the reason there is none. Writes nothing and runs nothing. */
export function snapshotMemoryStores(root: string, fs: DocumentFs): MemoryStoreSnapshotResult {
  const walk: Walk = { entries: [], bytes: 0 };
  const parent = rootProblem(fs, root, PROJECTOPS);
  if (parent !== null && parent !== 'absent') return parent;
  for (const store of parent === 'absent' ? [] : STORE_ROOTS) {
    const problem = rootProblem(fs, root, store);
    if (problem === 'absent') continue;
    if (problem !== null) return problem;
    walk.entries.push({ path: store, hash: 'directory' });
    const stopped = walkDirectory(fs, root, store, 1, walk);
    if (stopped !== null) return stopped;
  }
  const files = [...walk.entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: true, snapshot: { digest: sha256(JSON.stringify(files.map((file) => [file.path, file.hash]))), files } };
}

const capped = (paths: readonly string[]): readonly string[] => [...paths].sort().slice(0, MAX_REPORTED);

/**
 * Whether the stores are as they were. A refused snapshot on either side is `MEMORY_STORE_UNCHECKED`: nothing was compared, so
 * nothing is cleared. Any difference in what was digested is `MEMORY_STORE_CHANGED`, with the paths and never the text.
 */
export function checkStoreUnchanged(before: MemoryStoreSnapshotResult, after: MemoryStoreSnapshotResult): StoreChange {
  if (!before.ok || !after.ok) {
    return { ok: false, code: 'MEMORY_STORE_UNCHECKED', message: 'The memory and skill stores could not be digested on both sides of the run, so none was cleared.' };
  }
  if (before.snapshot.digest === after.snapshot.digest) return { ok: true };
  const was = new Map(before.snapshot.files.map((file) => [file.path, file.hash]));
  const now = new Map(after.snapshot.files.map((file) => [file.path, file.hash]));
  return {
    ok: false,
    code: 'MEMORY_STORE_CHANGED',
    message: 'A worker changed the memory or skill store directly. Memory and skills are proposed through a `proposals` entry in the findings record, and the owner decides. Nothing was approved.',
    added: capped([...now.keys()].filter((path) => !was.has(path))),
    removed: capped([...was.keys()].filter((path) => !now.has(path))),
    changed: capped([...now.keys()].filter((path) => was.has(path) && was.get(path) !== now.get(path))),
  };
}
