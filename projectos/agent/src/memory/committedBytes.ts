// Origin: original ProjectOS code
/**
 * THE AGENT SIDE OF COMMITTED BYTES (PROJECTOS-MEMORY-PROVENANCE1A, plan 3.3).
 *
 * Core judges (`judgeCommittedRead`); this gathers the FACTS it judges, through two injected ports and nothing else:
 *
 *   `GitRunner`   asks git. In production it is `gitRunnerOver(system, root)`, which runs the one `git` the runtime has
 *                 bound, with replacement objects off. This file never spawns anything and never imports a process module.
 *   `DocumentFs`  looks at the working tree with an `lstat` and reads text. It writes nothing.
 *
 * EXISTING CODE FIRST. The host already reads authority records from git objects and not from the working tree
 * (`readCommittedDecision`, `readCommittedTenantRegistry`, `installationAllowsProject`): `git show HEAD:./<path>` after a
 * `diff` check, with the bytes hashed back to the blob name. This is the same discipline for memory files, extended with
 * what those do not need: the tree entry (so a symlink, a submodule and a tree are refused by their mode, not read), and a
 * working-tree comparison that REFUSES instead of choosing a side.
 *
 * ONE COMMIT, ONE BLOB. HEAD is resolved once. The tree entry is read at that commit, and the bytes by the blob name that
 * entry gave, so what is judged cannot come from two HEADs. Bytes that do not hash to the blob name are not those bytes:
 * `blobNameOf` is git's own object hash, computed again here.
 *
 * ANY GIT FAILURE IS A REFUSAL. A repository with no HEAD, a git that could not run and a command that failed all come back
 * as `COMMITTED_NO_HEAD`, and nothing is read from the working tree in their place.
 *
 * The path is judged by core BEFORE git is asked anything, so a path that escapes the project, names a different case or
 * carries a trailing dot reaches no command. Stored text is data: nothing here reads meaning from it.
 */
import {
  MAX_COMMITTED_FILE_BYTES,
  committedPathProblem,
  isGitObjectId,
  judgeCommittedRead,
  provenanceKindOfPath,
  type CommittedRead,
  type CommittedReadJudgement,
  type ProvenanceItem,
  type WorkingTreeFacts,
} from '@projectos/core';
import { blobNameOf } from '../installation/projectAllowlist.js';
import type { DocumentFs, GitRunner } from '../search/ports.js';

export interface CommittedReadPorts {
  readonly git: GitRunner;
  readonly fs: DocumentFs;
}

/** `<mode> SP <type> SP <object> TAB <path>`, as `ls-tree -z` prints it. Paths here are printable ASCII (core refused the rest). */
const TREE_LINE = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([\x20-\x7e]+)$/;
const DECISIONS_DIRECTORY = '.projectops/closure/decisions';
/** A project's decisions are a few dozen. More than this is not read, and the answer is unknown. */
export const MAX_COMMITTED_DECISIONS = 500;
export const MAX_COMMITTED_DECISION_BYTES = 8_388_608;

type Entry = { readonly mode: string; readonly type: string; readonly object: string; readonly path: string };

function run(git: GitRunner, args: readonly string[]): string | null {
  try {
    const result = git(args);
    return result.code === 0 && typeof result.stdout === 'string' ? result.stdout : null;
  } catch {
    return null;
  }
}

function headOf(git: GitRunner): string | null {
  const out = run(git, ['rev-parse', '--verify', 'HEAD']);
  const name = out === null ? '' : out.replace(/\r?\n$/, '');
  return isGitObjectId(name) ? name : null;
}

function entryOfLine(line: string): Entry | null {
  const parsed = TREE_LINE.exec(line);
  return parsed === null ? null : { mode: parsed[1] as string, type: parsed[2] as string, object: parsed[3] as string, path: parsed[4] as string };
}

/** The blob's bytes, only when they hash to the blob name git gave: what git showed must be those bytes. */
function verifiedBlob(git: GitRunner, object: string): string | null {
  const shown = run(git, ['cat-file', 'blob', object]);
  return shown !== null && blobNameOf(shown, object) === object ? shown : null;
}

function sizeOfBlob(git: GitRunner, object: string): number | null {
  const out = run(git, ['cat-file', '-s', object]);
  const text = out === null ? '' : out.replace(/\r?\n$/, '');
  return /^\d{1,12}$/.test(text) ? Number(text) : null;
}

/** What the working tree holds at `path`: every directory on the way is asked, a link is never followed, nothing is written. */
function workingTreeFactsOf(fs: DocumentFs, root: string, path: string): WorkingTreeFacts {
  const segments = path.split('/');
  for (let length = 1; length < segments.length; length += 1) {
    const stat = fs.stat(`${root}/${segments.slice(0, length).join('/')}`);
    if (stat === null) return { state: 'absent' };
    if (stat.kind === 'link') return { state: 'link' };
    if (stat.kind !== 'directory') return { state: 'other' };
  }
  const stat = fs.stat(`${root}/${path}`);
  if (stat === null) return { state: 'absent' };
  if (stat.kind === 'link') return { state: 'link' };
  if (stat.kind !== 'file') return { state: 'other' };
  if (stat.size > MAX_COMMITTED_FILE_BYTES) return { state: 'too-large' };
  // The exact name must be in the listing: a case-insensitive file system opens `memory.md` for `MEMORY.md`.
  const parent = `${root}/${segments.slice(0, -1).join('/')}`;
  if (!fs.listDir(parent).includes(segments[segments.length - 1] as string)) return { state: 'absent' };
  const text = fs.readText(`${root}/${path}`);
  return text === null ? { state: 'unreadable' } : { state: 'file', text };
}

/**
 * Read one memory file as committed. Core's refusal comes back as it is, by code; no text of a refused file is returned, and a
 * working copy that differs is refused, never replaced by HEAD's text.
 */
export function readCommittedMemoryFile(ports: CommittedReadPorts, root: string, path: string): CommittedReadJudgement {
  const problem = committedPathProblem(path);
  if (problem !== null) return { ok: false, code: problem, path: null };
  const head = headOf(ports.git);
  const listed = head === null ? null : run(ports.git, ['ls-tree', '-z', head, '--', path]);
  if (head === null || listed === null) return judgeCommittedRead({ path, head: null, entry: null, committedText: null, workingTree: { state: 'unreadable' } });

  const lines = listed.split('\0').filter((line) => line !== '');
  const parsed = lines.length === 1 ? entryOfLine(lines[0] as string) : null;
  // No line: HEAD has no such path. A line for another path is not this path. Anything that is not one clean line is not an entry.
  if (lines.length === 0 || (parsed !== null && parsed.path !== path)) return judgeCommittedRead({ path, head, entry: null, committedText: null, workingTree: { state: 'unreadable' } });
  if (parsed === null) return judgeCommittedRead({ path, head, entry: {}, committedText: null, workingTree: { state: 'unreadable' } });
  const held = { mode: parsed.mode, type: parsed.type, object: parsed.object };
  // Only a blob has bytes to read; a tree, a submodule or a symlink is judged by its mode, and core refuses it.
  if (parsed.type !== 'blob') return judgeCommittedRead({ path, head, entry: held, committedText: null, workingTree: { state: 'unreadable' } });

  const size = sizeOfBlob(ports.git, parsed.object);
  const committedText = size !== null && size <= MAX_COMMITTED_FILE_BYTES ? verifiedBlob(ports.git, parsed.object) : null;
  const workingTree: WorkingTreeFacts = typeof committedText === 'string' ? workingTreeFactsOf(ports.fs, root, path) : { state: 'unreadable' };
  return judgeCommittedRead({
    path,
    head,
    entry: held,
    committedText,
    ...(size === null ? {} : { committedSize: size }),
    workingTree,
  });
}

/**
 * The text of every committed decision at HEAD, or null when they cannot all be read (git failed, a decision is a link, bytes do
 * not hash to their blob, a file is over the cap, there are more than `MAX_COMMITTED_DECISIONS`). Null means UNKNOWN, never none:
 * the deletion rule treats an item it cannot check as possibly cited. Decisions are read from HEAD whatever the working tree says.
 */
export function readCommittedDecisionTexts(git: GitRunner): readonly string[] | null {
  const head = headOf(git);
  const listed = head === null ? null : run(git, ['ls-tree', '-z', '-r', head, '--', DECISIONS_DIRECTORY]);
  if (head === null || listed === null) return null;
  const lines = listed.split('\0').filter((line) => line !== '');
  if (lines.length > MAX_COMMITTED_DECISIONS) return null;
  const texts: string[] = [];
  let total = 0;
  for (const line of lines) {
    const entry = entryOfLine(line);
    if (entry === null) return null;
    if (provenanceKindOfPath(entry.path) !== 'committed-decision') continue;
    if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) return null;
    const size = sizeOfBlob(git, entry.object);
    if (size === null || size > MAX_COMMITTED_FILE_BYTES || total + size > MAX_COMMITTED_DECISION_BYTES) return null;
    const text = verifiedBlob(git, entry.object);
    if (text === null) return null;
    total += size;
    texts.push(text);
  }
  return Object.freeze(texts);
}

/** The ranking item for a committed read: its path as the id, its kind, and the proof the read minted (a copy of it is not a proof). */
export function committedItemOf(read: CommittedRead, timeMs: number, contradicts?: readonly string[]): ProvenanceItem {
  return {
    id: read.path,
    kind: read.kind,
    timeMs,
    committed: read.proof,
    ...(contradicts === undefined ? {} : { contradicts }),
  };
}
