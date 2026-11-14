// Origin: original ProjectOS code
/**
 * COMMITTED BYTES ONLY (PROJECTOS-MEMORY-PROVENANCE1A, plan 3.3).
 *
 * Decisions, plan memory and approved memory are authority, so they are read from the bytes git holds at HEAD, never from
 * the working tree. A working-tree file can be edited, swapped for a link or left half-written without leaving a commit; a
 * blob at a commit cannot. And a file whose working-tree bytes differ from HEAD is REFUSED, not read from HEAD
 * silently: a person or a process changed something that nothing has committed, and the caller must know.
 *
 * THIS FILE JUDGES; THE AGENT ASKS. Core cannot spawn git or read a file, so the agent gathers the FACTS through injected
 * ports (the HEAD commit, the tree entry for the path, the blob's bytes, the working tree's state and bytes) and hands
 * them here. `judgeCommittedRead` decides, once, from a frozen copy:
 *
 *   - the path is one spelling, inside the project, and names a decision, plan-memory or approved-memory file;
 *   - HEAD is a commit name and the path is in it, as a regular blob (mode 100644 or 100755). A symlink (120000), a
 *     submodule (160000), a tree and any other mode are refused, each by its own code;
 *   - the committed bytes were read, and are within the cap counted in UTF-8 bytes (a character cap lets 4-byte characters
 *     through at four times the size);
 *   - the working tree holds a regular file, not a link, and its bytes are the committed bytes. Line endings are compared
 *     as LF, because a Windows checkout turns the committed LF into CRLF; nothing else is forgiven.
 *
 * What it returns is the COMMITTED text, with the proof (`commit`, `blob`) that makes an item rank as a decision or as
 * approved memory. Stored text is data: nothing here reads meaning from it.
 *
 * Pure: no I/O. Imports only the shared shapes and the kind-of-path table.
 */
import { isGitObjectId, memoryPathShapeProblem, plainRecordOf, type MemoryPathShapeProblem } from './memoryShapes.js';
import { provenanceKindOfPath, type ProvenanceKind } from './provenance.js';

/** Decisions and curated files are a few kilobytes. A file over this is not one of them, and is refused unread. */
export const MAX_COMMITTED_FILE_BYTES = 262_144;

/** Regular files only. 120000 is a symlink and 160000 a submodule: each is refused by its own rule below. */
const REGULAR_MODES: readonly string[] = ['100644', '100755'];
const SYMLINK_MODE = '120000';

const READ_KINDS: readonly ProvenanceKind[] = ['committed-decision', 'approved-memory', 'plan-memory'];

export type CommittedReadCode =
  | MemoryPathShapeProblem
  | 'COMMITTED_PATH_NOT_A_MEMORY_FILE'
  | 'COMMITTED_FACTS_INVALID'
  | 'COMMITTED_NO_HEAD'
  | 'COMMITTED_NOT_IN_HEAD'
  | 'COMMITTED_SYMLINK'
  | 'COMMITTED_NOT_REGULAR'
  | 'COMMITTED_BYTES_UNREADABLE'
  | 'COMMITTED_TOO_LARGE'
  | 'COMMITTED_WORKING_TREE_ABSENT'
  | 'COMMITTED_WORKING_TREE_LINK'
  | 'COMMITTED_WORKING_TREE_NOT_FILE'
  | 'COMMITTED_WORKING_TREE_UNREADABLE'
  | 'COMMITTED_WORKING_TREE_DIFFERS';

/** Why this path may not be read as committed memory, or null. Shape first, then whether it names a kind that is authority. */
export function committedPathProblem(path: unknown): CommittedReadCode | null {
  const shape = memoryPathShapeProblem(path);
  if (shape !== null) return shape;
  const kind = provenanceKindOfPath(path);
  return kind !== null && READ_KINDS.includes(kind) ? null : 'COMMITTED_PATH_NOT_A_MEMORY_FILE';
}

export type WorkingTreeFacts =
  | { readonly state: 'file'; readonly text: string }
  | { readonly state: 'absent' | 'link' | 'other' | 'unreadable' | 'too-large' };

/** What the agent saw: gathered through ports, handed over as data. */
export interface CommittedReadFacts {
  readonly path: string;
  /** `git rev-parse --verify HEAD`, or null. */
  readonly head: string | null;
  /** The tree entry for exactly this path at that commit, or null when HEAD has none. */
  readonly entry: { readonly mode: string; readonly type: string; readonly object: string } | null;
  /** The blob's bytes as text, already checked by the agent to hash to `entry.object`, or null when they could not be read. */
  readonly committedText: string | null;
  /** The blob's size in bytes as git reports it (`cat-file -s`). Optional; when given, a size over the cap refuses before any bytes are read. */
  readonly committedSize?: number;
  readonly workingTree: WorkingTreeFacts;
}

export interface CommittedRead {
  readonly path: string;
  readonly kind: ProvenanceKind;
  readonly commit: string;
  readonly blob: string;
  /** The committed text, never the working tree's. */
  readonly text: string;
}

export type CommittedReadJudgement =
  | { readonly ok: true; readonly read: CommittedRead }
  | { readonly ok: false; readonly code: CommittedReadCode; readonly path: string | null };

const FACT_KEYS = ['path', 'head', 'entry', 'committedText', 'committedSize', 'workingTree'] as const;
const WORKING_STATES = ['file', 'absent', 'link', 'other', 'unreadable', 'too-large'] as const;

/** A Windows checkout turns the committed LF into CRLF. Both sides are compared as LF; a lone CR is not forgiven. */
export const committedLineEndingsOf = (text: string): string => text.replace(/\r\n/g, '\n');

const refuse = (code: CommittedReadCode, path: string | null): CommittedReadJudgement => ({ ok: false, code, path });

function utf8BytesOf(text: string): number {
  // Every UTF-16 unit is at least one byte, so a text longer than the cap is over it without encoding a megabyte first.
  return text.length > MAX_COMMITTED_FILE_BYTES ? MAX_COMMITTED_FILE_BYTES + 1 : new TextEncoder().encode(text).length;
}

function workingTreeOf(value: unknown): WorkingTreeFacts | null {
  const read = plainRecordOf(value, ['state', 'text']);
  if (!read.ok) return null;
  const { state, text } = read.value;
  if (typeof state !== 'string' || !(WORKING_STATES as readonly string[]).includes(state)) return null;
  if (state === 'file') return typeof text === 'string' ? { state, text } : null;
  return text === undefined ? { state: state as 'absent' } : null;
}

function entryOf(value: unknown): { readonly mode: string; readonly type: string; readonly object: string } | null {
  const read = plainRecordOf(value, ['mode', 'type', 'object']);
  if (!read.ok) return null;
  const { mode, type, object } = read.value;
  return typeof mode === 'string' && typeof type === 'string' && isGitObjectId(object) ? { mode, type, object } : null;
}

/** Judge one committed read, from facts read once into a frozen copy. A refusal is a value with a code and quotes no bytes. */
export function judgeCommittedRead(facts: unknown): CommittedReadJudgement {
  const read = plainRecordOf(facts, FACT_KEYS);
  if (!read.ok) return refuse('COMMITTED_FACTS_INVALID', null);
  const { path, head, entry, committedText, committedSize, workingTree } = read.value;
  const pathProblem = committedPathProblem(path);
  if (pathProblem !== null) return refuse(pathProblem, null);
  const where = path as string;
  if (!isGitObjectId(head)) return refuse('COMMITTED_NO_HEAD', where);
  if (entry === null) return refuse('COMMITTED_NOT_IN_HEAD', where);
  const held = entryOf(entry);
  if (held === null) return refuse('COMMITTED_FACTS_INVALID', where);
  if (held.mode === SYMLINK_MODE) return refuse('COMMITTED_SYMLINK', where);
  if (held.type !== 'blob' || !REGULAR_MODES.includes(held.mode)) return refuse('COMMITTED_NOT_REGULAR', where);
  if (committedSize !== undefined && (typeof committedSize !== 'number' || !Number.isSafeInteger(committedSize) || committedSize < 0)) return refuse('COMMITTED_FACTS_INVALID', where);
  if (committedSize !== undefined && committedSize > MAX_COMMITTED_FILE_BYTES) return refuse('COMMITTED_TOO_LARGE', where);
  if (typeof committedText !== 'string') return refuse('COMMITTED_BYTES_UNREADABLE', where);
  if (utf8BytesOf(committedText) > MAX_COMMITTED_FILE_BYTES) return refuse('COMMITTED_TOO_LARGE', where);
  const tree = workingTreeOf(workingTree);
  if (tree === null) return refuse('COMMITTED_FACTS_INVALID', where);
  if (tree.state === 'absent') return refuse('COMMITTED_WORKING_TREE_ABSENT', where);
  if (tree.state === 'link') return refuse('COMMITTED_WORKING_TREE_LINK', where);
  if (tree.state === 'other') return refuse('COMMITTED_WORKING_TREE_NOT_FILE', where);
  if (tree.state !== 'file') return refuse('COMMITTED_WORKING_TREE_UNREADABLE', where);
  if (committedLineEndingsOf(tree.text) !== committedLineEndingsOf(committedText)) return refuse('COMMITTED_WORKING_TREE_DIFFERS', where);
  const kind = provenanceKindOfPath(where);
  if (kind === null) return refuse('COMMITTED_PATH_NOT_A_MEMORY_FILE', where);
  return { ok: true, read: Object.freeze({ path: where, kind, commit: head, blob: held.object, text: committedText }) };
}
