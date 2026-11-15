// Origin: original ProjectOS code
/**
 * THE LOADER: A PROMOTED SKILL IS READ FROM COMMITTED BYTES, AND ONLY IF IT IS WHOLE (PROJECTOS-SKILLS-ADOPT1A, plan 3.2).
 *
 * The registry's `skill-load` (P1) puts a promoted, hash-pinned skill into a run's context file. Two judgements, both pure:
 *
 *   `judgeCommittedSkillRead`  from facts the agent gathered through ports, the discipline of `memory/committedBytes.ts`: the path is
 *       one spelling, in the promoted-skill directory, one record per name. HEAD is a commit name and the path is in it as a REGULAR
 *       blob (a symlink, a submodule, a tree and any other mode are each refused by their own code). The bytes are within the cap, counted
 *       in UTF-8 bytes. The working tree holds a regular file, not a link, and its bytes equal HEAD's (line endings compared as LF,
 *       nothing else forgiven): a file somebody changed and nothing committed is REFUSED, never read from HEAD in its place. What it
 *       returns is the COMMITTED text and a read it minted, registered where only this file reaches.
 *   `loadCommittedSkill`       takes only such a read, and refuses an UNPINNED skill (no whole pin) and a CHANGED one (the package hashed
 *       again is not the pin's hash: one byte, a CRLF, a BOM). Then the same independent-review question as at promotion is put to the
 *       verifier (`purpose: 'load'`), over the facts the pin records, and only then is the block rendered (fenced, authority none).
 *
 * WHAT THIS DOES NOT DO. It does not read a skill's other files into a prompt (`prompt.ts` only names them), and it never runs
 * anything: there is no spawn, no exec and no import path in core, and a package's `scripts/` directory is data like the rest.
 *
 * A refusal is a value with a code and quotes none of the bytes. Pure: no I/O.
 */
import { isGitObjectId, memoryPathShapeProblem, plainRecordOf, type MemoryPathShapeProblem } from '../memory/memoryShapes.js';
import { checkPromotedSkill, isSkillPin, type PromotedSkill } from './promotion.js';
import { SKILL_MD } from './linter.js';
import { renderSkillBlock, type SkillPromptBlock } from './prompt.js';
import { skillOk, skillRefused, type SkillResult } from './refusal.js';
import { askSkillReviewVerifier, skillReviewClaimOf, type SkillReviewClaim } from './skillReview.js';

export const SKILL_RECORD_DIR = '.projectops/skills/promoted';
/** A record is one package's JSON. Over this it cannot be shown in a context file anyway, so it is refused unread. */
export const MAX_COMMITTED_SKILL_RECORD_BYTES = 262_144;

const REGULAR_MODES: readonly string[] = ['100644', '100755'];
const SYMLINK_MODE = '120000';
/** The name is the linter's closed shape, so one record is one name and a path has one spelling. */
const RECORD_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RECORD_PATH = /^\.projectops\/skills\/promoted\/([a-z0-9][a-z0-9_-]{0,63})\.json$/;

export const skillRecordPathOf = (name: string): string => `${SKILL_RECORD_DIR}/${name}.json`;
export const isSkillRecordName = (name: unknown): name is string => typeof name === 'string' && RECORD_NAME.test(name);

export type CommittedSkillCode =
  | MemoryPathShapeProblem
  | 'COMMITTED_PATH_NOT_A_SKILL_RECORD'
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

/** Why this path is not a promoted-skill record, or null. Shape first, then whether it is one name's record. */
export function committedSkillPathProblem(path: unknown): CommittedSkillCode | null {
  const shape = memoryPathShapeProblem(path);
  if (shape !== null) return shape;
  return RECORD_PATH.test(path as string) ? null : 'COMMITTED_PATH_NOT_A_SKILL_RECORD';
}

export type SkillWorkingTreeFacts =
  | { readonly state: 'file'; readonly text: string }
  | { readonly state: 'absent' | 'link' | 'other' | 'unreadable' | 'too-large' };

/** What the agent saw: gathered through ports, handed over as data. */
export interface CommittedSkillFacts {
  readonly path: string;
  /** `git rev-parse --verify HEAD`, or null. */
  readonly head: string | null;
  /** The tree entry for exactly this path at that commit, or null when HEAD has none. */
  readonly entry: { readonly mode: string; readonly type: string; readonly object: string } | null;
  /** The blob's bytes as text, already checked by the agent to hash to `entry.object`, or null. */
  readonly committedText: string | null;
  /** The blob's size as git reports it. When given, a size over the cap refuses before any bytes are read. */
  readonly committedSize?: number;
  readonly workingTree: SkillWorkingTreeFacts;
}

/** A committed read of one skill's record. Minted by `judgeCommittedSkillRead`, and nothing else is one. */
export interface CommittedSkillRead {
  readonly path: string;
  readonly name: string;
  readonly commit: string;
  readonly blob: string;
  /** The committed text, never the working tree's. */
  readonly text: string;
}

export type CommittedSkillJudgement =
  | { readonly ok: true; readonly read: CommittedSkillRead }
  | { readonly ok: false; readonly code: CommittedSkillCode; readonly path: string | null };

const MINTED: WeakSet<object> = new WeakSet();
/** Is this exactly a read `judgeCommittedSkillRead` made? A look-alike, a copy and a JSON round-trip are not. */
export const isCommittedSkillRead = (value: unknown): value is CommittedSkillRead => typeof value === 'object' && value !== null && MINTED.has(value);

const FACT_KEYS = ['path', 'head', 'entry', 'committedText', 'committedSize', 'workingTree'] as const;
const WORKING_STATES = ['file', 'absent', 'link', 'other', 'unreadable', 'too-large'] as const;

/** A Windows checkout turns the committed LF into CRLF. Both sides are compared as LF; a lone CR is not forgiven. */
const lineEndingsOf = (text: string): string => text.replace(/\r\n/g, '\n');

const refuse = (code: CommittedSkillCode, path: string | null): CommittedSkillJudgement => ({ ok: false, code, path });

function utf8BytesOf(text: string): number {
  // Every UTF-16 unit is at least one byte, so a text longer than the cap is over it without encoding a megabyte first.
  return text.length > MAX_COMMITTED_SKILL_RECORD_BYTES ? MAX_COMMITTED_SKILL_RECORD_BYTES + 1 : new TextEncoder().encode(text).length;
}

function workingTreeOf(value: unknown): SkillWorkingTreeFacts | null {
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
export function judgeCommittedSkillRead(facts: unknown): CommittedSkillJudgement {
  const read = plainRecordOf(facts, FACT_KEYS);
  if (!read.ok) return refuse('COMMITTED_FACTS_INVALID', null);
  const { path, head, entry, committedText, committedSize, workingTree } = read.value;
  const pathProblem = committedSkillPathProblem(path);
  if (pathProblem !== null) return refuse(pathProblem, null);
  const where = path as string;
  if (!isGitObjectId(head)) return refuse('COMMITTED_NO_HEAD', where);
  if (entry === null) return refuse('COMMITTED_NOT_IN_HEAD', where);
  const held = entryOf(entry);
  if (held === null) return refuse('COMMITTED_FACTS_INVALID', where);
  if (held.mode === SYMLINK_MODE) return refuse('COMMITTED_SYMLINK', where);
  if (held.type !== 'blob' || !REGULAR_MODES.includes(held.mode)) return refuse('COMMITTED_NOT_REGULAR', where);
  if (committedSize !== undefined && (typeof committedSize !== 'number' || !Number.isSafeInteger(committedSize) || committedSize < 0)) return refuse('COMMITTED_FACTS_INVALID', where);
  if (committedSize !== undefined && committedSize > MAX_COMMITTED_SKILL_RECORD_BYTES) return refuse('COMMITTED_TOO_LARGE', where);
  if (typeof committedText !== 'string') return refuse('COMMITTED_BYTES_UNREADABLE', where);
  if (utf8BytesOf(committedText) > MAX_COMMITTED_SKILL_RECORD_BYTES) return refuse('COMMITTED_TOO_LARGE', where);
  const tree = workingTreeOf(workingTree);
  if (tree === null) return refuse('COMMITTED_FACTS_INVALID', where);
  if (tree.state === 'absent') return refuse('COMMITTED_WORKING_TREE_ABSENT', where);
  if (tree.state === 'link') return refuse('COMMITTED_WORKING_TREE_LINK', where);
  if (tree.state === 'other') return refuse('COMMITTED_WORKING_TREE_NOT_FILE', where);
  if (tree.state !== 'file') return refuse('COMMITTED_WORKING_TREE_UNREADABLE', where);
  if (lineEndingsOf(tree.text) !== lineEndingsOf(committedText)) return refuse('COMMITTED_WORKING_TREE_DIFFERS', where);
  const name = RECORD_PATH.exec(where)?.[1];
  if (name === undefined) return refuse('COMMITTED_PATH_NOT_A_SKILL_RECORD', where);
  const minted: CommittedSkillRead = Object.freeze({ path: where, name, commit: head, blob: held.object, text: committedText });
  MINTED.add(minted);
  return { ok: true, read: minted };
}

/** A promoted skill the loader accepted: the block to show, and what the ledger records about it. */
export interface LoadedSkill {
  readonly name: string;
  readonly packageHash: string;
  readonly commit: string;
  readonly blob: string;
  readonly block: SkillPromptBlock;
  /** The paths in the package other than `SKILL.md`, which are named and never read or run. */
  readonly otherFiles: readonly string[];
  /** What the verifier vouched for. */
  readonly claim: SkillReviewClaim;
}

function parsedRecord(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * One committed record, loaded or refused by code. Asked in this order, so a cheap refusal never reaches a verifier:
 * minted read, the head it was minted at, JSON, a whole independent pin, the package hashed again, the same name as the path,
 * the verifier, then the block.
 */
export function loadCommittedSkill(read: unknown, binding: unknown, verifier: unknown, headCommit: unknown): SkillResult<LoadedSkill> {
  if (!isCommittedSkillRead(read)) return skillRefused('SKILL_NOT_COMMITTED', 'That text did not come from a committed read of a skill record, so it is not read as a skill.');
  if (!isGitObjectId(headCommit) || read.commit !== headCommit) {
    return skillRefused('SKILL_STALE', `The record for ${read.name} was read at another commit than HEAD, so it is not used. Read it again.`);
  }
  const raw = parsedRecord(read.text);
  if (!isObject(raw)) return skillRefused('SKILL_UNREADABLE', `The record for ${read.name} is not a JSON record, so it is not read.`);
  if (!isSkillPin(raw['pin'])) {
    return skillRefused('SKILL_NOT_PINNED', `The record for ${read.name} has no whole, independent hash pin, so it is not loaded. The owner promotes it through the review, then commits the record.`);
  }
  const checked = checkPromotedSkill(raw);
  if (!checked.ok) return checked;
  const skill: PromotedSkill = checked.value;
  if (skill.pin.name !== read.name) return skillRefused('SKILL_TAMPERED', `The file named ${read.name} holds another skill.`);
  const { pin } = skill;
  const claim = skillReviewClaimOf('load', binding, {
    name: pin.name,
    packageHash: pin.packageHash,
    proposalHash: pin.proposalHash,
    author: pin.author,
    authorSession: pin.authorSession,
    reviewer: pin.reviewedBy,
    reviewerRole: pin.reviewerRole,
    reviewerSession: pin.reviewerSession,
  });
  if (!claim.ok) return claim;
  const vouched = askSkillReviewVerifier(verifier, claim.value);
  if (!vouched.ok) return vouched;
  const block = renderSkillBlock(skill);
  if (!block.ok) return block;
  return skillOk({
    name: pin.name,
    packageHash: pin.packageHash,
    commit: read.commit,
    blob: read.blob,
    block: block.value,
    otherFiles: skill.files.map((file) => file.path).filter((path) => path !== SKILL_MD).sort(),
    claim: vouched.value,
  });
}
