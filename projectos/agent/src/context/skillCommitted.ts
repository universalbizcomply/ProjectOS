// Origin: original ProjectOS code
/**
 * THE AGENT SIDE OF LOADING A SKILL: COMMITTED BYTES, GATHERED THROUGH PORTS (PROJECTOS-SKILLS-ADOPT1A, plan 3.2).
 *
 * Core judges (`judgeCommittedSkillRead`); this gathers the FACTS it judges, through two injected ports and nothing else:
 *
 *   `GitRunner`   asks git, in the project's checkout, through the runtime's one bound `git` (`gitRunnerOver`). Nothing here spawns
 *                 a process or imports a process module.
 *   `DocumentFs`  looks at the working tree with an `lstat` and reads text. It writes nothing.
 *
 * EXISTING CODE FIRST, AND WHY THIS IS NOT IT. `memory/committedBytes.ts` already does this for decisions and memory files, and its
 * judge refuses any path that is not one of those. A promoted skill's record is a different kind of file (one JSON package per
 * name), so it needs its own judge, and the helpers that read a tree entry and a blob are private to that file, which is outside
 * this phase's write paths. They are repeated here, small, with the same rules; folding the two is a later clean-up.
 *
 * ONE COMMIT, ONE BLOB. HEAD is resolved once; the tree entry is read at that commit and the bytes by the blob name it gave, and
 * bytes that do not hash to that name are not those bytes (`blobNameOf` is git's own object hash). Any git failure is a refusal: a
 * repository with no HEAD, a git that could not run and a command that failed all come back as `COMMITTED_NO_HEAD`, and nothing is
 * read from the working tree in their place.
 *
 * THE LISTING. `listCommittedSkillRecords` asks git which names HEAD holds under the promoted-skill directory. Only `<name>.json` blobs
 * are candidates; anything else there (a directory, a link, a submodule, a stray file) is reported by name and code and never read.
 *
 * Stored text is data: nothing here reads meaning from it.
 */
import {
  MAX_COMMITTED_SKILL_RECORD_BYTES,
  SKILL_RECORD_DIR,
  committedSkillPathProblem,
  isGitObjectId,
  isSkillRecordName,
  judgeCommittedSkillRead,
  skillRecordPathOf,
  type CommittedSkillJudgement,
  type SkillWorkingTreeFacts,
} from '@projectos/core';
import { blobNameOf } from '../installation/projectAllowlist.js';
import type { DocumentFs, GitRunner } from '../search/ports.js';

export interface CommittedSkillPorts {
  readonly git: GitRunner;
  readonly fs: DocumentFs;
}

/** `<mode> SP <type> SP <object> TAB <path>`, as `ls-tree -z` prints it. A path outside printable ASCII is not an entry here. */
const TREE_LINE = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([\x20-\x7e]+)$/;
/** How many names one run looks at. A project that holds more has the rest named, not read. */
export const MAX_LISTED_SKILL_RECORDS = 64;

type Entry = { readonly mode: string; readonly type: string; readonly object: string; readonly path: string };

function run(git: GitRunner, args: readonly string[]): string | null {
  try {
    const result = git(args);
    return result.code === 0 && typeof result.stdout === 'string' ? result.stdout : null;
  } catch {
    return null;
  }
}

/** The commit HEAD names, or null. */
export function skillHeadOf(git: GitRunner): string | null {
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
function workingTreeFactsOf(fs: DocumentFs, root: string, path: string): SkillWorkingTreeFacts {
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
  if (stat.size > MAX_COMMITTED_SKILL_RECORD_BYTES) return { state: 'too-large' };
  // The exact name must be in the listing: a case-insensitive file system opens `Notes.json` for `notes.json`.
  const parent = `${root}/${segments.slice(0, -1).join('/')}`;
  if (!fs.listDir(parent).includes(segments[segments.length - 1] as string)) return { state: 'absent' };
  const text = fs.readText(`${root}/${path}`);
  return text === null ? { state: 'unreadable' } : { state: 'file', text };
}

/**
 * Read one skill's record as committed. Core's refusal comes back as it is, by code; no text of a refused file is returned, and a
 * working copy that differs is refused, never replaced by HEAD's text.
 */
export function readCommittedSkillRecord(ports: CommittedSkillPorts, root: string, name: string): CommittedSkillJudgement {
  const path = isSkillRecordName(name) ? skillRecordPathOf(name) : '';
  const problem = committedSkillPathProblem(path);
  if (problem !== null) return { ok: false, code: problem, path: null };
  const head = skillHeadOf(ports.git);
  const listed = head === null ? null : run(ports.git, ['ls-tree', '-z', head, '--', path]);
  if (head === null || listed === null) return judgeCommittedSkillRead({ path, head: null, entry: null, committedText: null, workingTree: { state: 'unreadable' } });

  const lines = listed.split('\0').filter((line) => line !== '');
  const parsed = lines.length === 1 ? entryOfLine(lines[0] as string) : null;
  // No line: HEAD has no such path. A line for another path is not this path. Anything that is not one clean line is not an entry.
  if (lines.length === 0 || (parsed !== null && parsed.path !== path)) return judgeCommittedSkillRead({ path, head, entry: null, committedText: null, workingTree: { state: 'unreadable' } });
  if (parsed === null) return judgeCommittedSkillRead({ path, head, entry: {}, committedText: null, workingTree: { state: 'unreadable' } });
  const held = { mode: parsed.mode, type: parsed.type, object: parsed.object };
  // Only a blob has bytes to read; a tree, a submodule or a symlink is judged by its mode, and core refuses it.
  if (parsed.type !== 'blob') return judgeCommittedSkillRead({ path, head, entry: held, committedText: null, workingTree: { state: 'unreadable' } });

  const size = sizeOfBlob(ports.git, parsed.object);
  const committedText = size !== null && size <= MAX_COMMITTED_SKILL_RECORD_BYTES ? verifiedBlob(ports.git, parsed.object) : null;
  const workingTree: SkillWorkingTreeFacts = typeof committedText === 'string' ? workingTreeFactsOf(ports.fs, root, path) : { state: 'unreadable' };
  return judgeCommittedSkillRead({ path, head, entry: held, committedText, ...(size === null ? {} : { committedSize: size }), workingTree });
}

export interface CommittedSkillListing {
  readonly head: string;
  /** The names to read, sorted, at most `MAX_LISTED_SKILL_RECORDS`. */
  readonly names: readonly string[];
  /** What is in the directory and is not a record to read: a closed code each, and never the file's text. */
  readonly foreign: readonly { readonly id: string; readonly code: string }[];
}

const RECORD_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.json$/;
const printableIdOf = (path: string): string => path.replace(/[^\x21-\x7e]/g, '_').slice(0, 200);

/**
 * Which names HEAD holds under the promoted-skill directory. Null when git could not say, which is UNKNOWN and not none: the caller
 * names it, and does not read the working tree instead.
 */
export function listCommittedSkillRecords(git: GitRunner): CommittedSkillListing | null {
  const head = skillHeadOf(git);
  const listed = head === null ? null : run(git, ['ls-tree', '-z', head, '--', `${SKILL_RECORD_DIR}/`]);
  if (head === null || listed === null) return null;
  const names: string[] = [];
  const foreign: { id: string; code: string }[] = [];
  for (const line of listed.split('\0').filter((one) => one !== '')) {
    const entry = entryOfLine(line);
    if (entry === null) {
      foreign.push({ id: `${SKILL_RECORD_DIR}/(unlistable entry)`, code: 'SKILL_RECORD_UNLISTABLE' });
      continue;
    }
    const file = entry.path.startsWith(`${SKILL_RECORD_DIR}/`) ? entry.path.slice(SKILL_RECORD_DIR.length + 1) : '';
    const name = RECORD_FILE.exec(file)?.[1];
    if (name === undefined) foreign.push({ id: printableIdOf(entry.path), code: 'SKILL_RECORD_NOT_A_RECORD' });
    else names.push(name);
  }
  const sorted = [...new Set(names)].sort();
  for (const extra of sorted.slice(MAX_LISTED_SKILL_RECORDS)) foreign.push({ id: skillRecordPathOf(extra), code: 'SKILL_RECORD_OVER_LIMIT' });
  return { head, names: sorted.slice(0, MAX_LISTED_SKILL_RECORDS), foreign };
}
