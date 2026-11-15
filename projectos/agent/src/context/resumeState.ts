// Origin: original ProjectOS code
/**
 * WHAT A NEW WORKER IS HANDED WHEN THE ATTEMPT BEFORE IT WAS CUT OFF (PROJECTOS-RESUME1A, plan 3.x).
 *
 * A worker that runs out of time, or is killed, leaves a work record, a session and some changed files. The next worker starts
 * with no session to rejoin (`--session` is not needed, and selection and `run.ts` are untouched), so what it gets is RETRIEVED STATE,
 * through the context manager's one file, fenced and untrusted like everything else in it:
 *
 *   resume:cut-off-attempt   the work record's CLOSED-VOCABULARY fields only (state, last stop code, subject commit, session). Every
 *                            free-text field of the record is never read (`contextResumeFieldsOf`), so a planted instruction in
 *                            any of them has no path to the worker.
 *   the attempt's findings   its own `<session>.findings.json`, worker-written, labelled as such, ranked as a finding (tier 2):
 *                            below a committed decision and below approved and plan memory, never above one.
 *   the attempt's evidence   its own `<session>.evidence.json`, check ids and outcomes only.
 *   resume:dirty-paths       the changed paths and a hash of each, which THIS LOOP read from git and from the files through its own
 *                            ports at the start of the run. No path or hash is taken from a worker's words.
 *
 * Each item is a `ContextRead` the manager gates, ranks, fences and records like any other, so it is named in the retrieval
 * ledger and in the run evidence by id and hash. Ranking, the gate and the ledger are the manager's: nothing here ranks, writes or
 * calls a model.
 *
 * A DIRTY PATH THE PHASE DOES NOT GRANT REFUSES THE RUN, and the refusal says who must do what. Inside the phase's write paths (or a
 * record the loop wrote) a path is listed with its hash. A path that is odd in form, climbs out, differs only by case, or is a link
 * (or sits under one) is refused too. Listing a path grants nothing: the write grant is the approved plan's, built before this runs.
 *
 * WHEN EARLIER STATE IS STALE. Each earlier item is marked fresh or `stale:<reason>` by the same rule the search index uses
 * (`citationFreshnessOf`), against the commit it was established at. A moved HEAD marks it stale. It is still shown, with the mark, so
 * the worker can judge it.
 *
 * THE WORK RECORD STAYS NON-AUTHORITY. It never selects, advances or closes a phase and never widens a grant: this file reads it for
 * four closed values, compares its project and phase with the run's, and decides nothing from it except what to SHOW. A record for
 * another project or phase is not this run's, and shows nothing.
 *
 * The files are read with the manager's ports only (`git`, `fs`), so a test supplies its own, and every read is bounded before it is
 * parsed.
 */
import {
  CONTEXT_RESUME_OBSERVED_NOTE,
  CONTEXT_RESUME_RECORD_NOTE,
  CONTEXT_RESUME_SEVERITIES,
  CONTEXT_RESUME_WORKER_NOTE,
  citationFreshnessMarkOf,
  citationFreshnessOf,
  classifyContextResumePath,
  contextResumeDisplayName,
  contextResumeFieldsOf,
  isCommitName,
  provenanceKindOfPath,
  renderContextResumeDirty,
  renderContextResumeEvidence,
  renderContextResumeFields,
  renderContextResumeFindings,
  sha256Hex,
  type ContextResumeCheck,
  type ContextResumeEvidence,
  type ContextResumeDirtyEntry,
  type ContextResumeFields,
  type ContextResumeFinding,
  type ContextResumeLoopRecords,
  type ContextResumePathReason,
  type ContextResumeSeverity,
} from '@projectos/core';
import { WORK_RECORD_REL, WORK_STATES, type WorkReadResult } from '../loop/workRecord.js';
import type { LoopStopCode } from '../loop/outcome.js';
import type { ContextManagerPorts } from './contextPorts.js';
import type { ContextFailure, ContextRead } from './contextRetrieval.js';
import { porcelainZPaths } from './contextStoreGuard.js';
import { MAX_GIT_OUTPUT_BYTES } from '../search/ports.js';

/** A record file is a few kilobytes: past this it is not read, and the run goes on without it. */
export const MAX_RESUME_FILE_BYTES = 65_536;
/** One changed file is hashed only up to this size, and all of them together only up to the budget. */
export const MAX_RESUME_HASH_BYTES = 1_048_576;
export const MAX_RESUME_HASH_BUDGET_BYTES = 33_554_432;
/** More changed paths than this is not a half-done phase; the owner commits or stashes first. */
export const MAX_RESUME_DIRTY_PATHS = 2_000;
const MAX_FINDINGS_READ = 200;
const MAX_CHECKS_READ = 200;
const MAX_REFUSAL_PATHS_NAMED = 8;
const OUTPUT_BOUND_SLACK = 4096;
const CHECK_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const STATUS_ARGS: readonly string[] = ['status', '--porcelain', '-z', '--untracked-files=all'];

/** Every stop code the loop writes, as a record keyed by the type, so the type checker finds a code this list lacks. */
const STOP_CODES: Readonly<Record<LoopStopCode, true>> = {
  UNRESOLVED_CRITICAL_OR_HIGH: true,
  PROTECTED_EFFECT: true,
  EFFECTS_NOT_ATTESTED: true,
  OWNER_GATE: true,
  SCOPE_DECISION: true,
  CORRECTION_EXHAUSTED: true,
  WORKER_REFUSED: true,
  WORKER_TIMED_OUT: true,
  DOCTOR_PREFLIGHT_FAILED: true,
  REVIEW_OUTSTANDING: true,
  CONTINUATION_READY: true,
};

/** The loop's own vocabularies, handed to core, which keeps no copy. */
const vocabularyOf = (phaseId: string) => ({
  states: WORK_STATES as readonly string[],
  stopCodes: Object.keys(STOP_CODES),
  // Nothing was dispatched, the work finished, or the run is waiting on a gate or the owner: none of these is an attempt that was cut off,
  // and the owner-wait and gate routes keep exactly the behaviour they have.
  inactiveStates: ['QUEUED', 'COMPLETE', 'AWAITING_GATE', 'GATE_APPROVED', 'WAITING_OWNER'] as readonly string[],
  phaseId,
});

export interface ContextResumeRequest {
  /** The phase this run selected, from the governed plan. */
  readonly phaseId: string;
  /** The governed project's own id, from its committed configuration. */
  readonly projectId: string;
  /** The write grant the loop built from the approved plan: `dir/**`, `./file` or `dir/file`. */
  readonly writePaths: readonly string[];
  /** The other records the loop's own lifecycle writes: the plan's state file and the gatekeeper's files. Built by the loop from its own constants. */
  readonly loopRecords: ContextResumeLoopRecords;
  /** Reads the work record. A port, so this file spells no location and a test supplies its own. */
  readonly workRecord: () => WorkReadResult;
}

export interface ContextResumeInput {
  readonly resume: ContextResumeRequest | undefined;
  readonly root: string;
  readonly head: string;
  /** This run's own session: an earlier record that names it is not an earlier attempt. */
  readonly sessionId: string;
}

export type ContextResumeOutcome =
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  | { readonly kind: 'ok'; readonly reads: readonly ContextRead[]; readonly failures: readonly ContextFailure[] };

const NOTHING: ContextResumeOutcome = Object.freeze({ kind: 'ok', reads: Object.freeze([]), failures: Object.freeze([]) });
const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });

/** A dirty-path problem: a core reason, or one only the file system can see. */
type DirtyReason = ContextResumePathReason | 'link' | 'link-count-unobserved' | 'not-regular';
interface DirtyProblem {
  readonly path: string;
  readonly reason: DirtyReason;
}

const REASON_ORDER: readonly DirtyReason[] = ['link', 'link-count-unobserved', 'not-regular', 'absolute', 'traversal', 'odd-form', 'case-variant', 'outside-write-paths'];
const REASON_CODE: Readonly<Record<DirtyReason, string>> = {
  link: 'RESUME_DIRTY_PATH_LINK',
  'link-count-unobserved': 'RESUME_LINK_COUNT_UNOBSERVED',
  'not-regular': 'RESUME_DIRTY_PATH_NOT_REGULAR',
  absolute: 'RESUME_DIRTY_PATH_ODD_FORM',
  traversal: 'RESUME_DIRTY_PATH_ODD_FORM',
  'odd-form': 'RESUME_DIRTY_PATH_ODD_FORM',
  'case-variant': 'RESUME_DIRTY_PATH_CASE_VARIANT',
  'outside-write-paths': 'RESUME_DIRTY_PATH_OUTSIDE_WRITE_PATHS',
};
const REASON_WORDS: Readonly<Record<DirtyReason, string>> = {
  link: 'a link, a file with more than one name, or under a link',
  'link-count-unobserved': 'a file whose number of names could not be read',
  'not-regular': 'not an ordinary file',
  absolute: 'an absolute path',
  traversal: 'a path that climbs out of the project',
  'odd-form': 'a path written in an unusual form',
  'case-variant': 'a spelling that differs from a granted path only by case or width',
  'outside-write-paths': 'outside this phase write paths',
};
const REASON_FIX: Readonly<Record<DirtyReason, string>> = {
  link: 'the owner replaces each link, or each file with a second name (a hard link), with an ordinary file, or removes it',
  'link-count-unobserved': 'the owner checks each path with the operating system tools (fsutil hardlink list on Windows, stat on Unix) and commits or removes it',
  'not-regular': 'the owner removes each, or replaces it with an ordinary file',
  absolute: 'the owner removes each, or renames it to an ordinary path inside the project',
  traversal: 'the owner removes each, or renames it to an ordinary path inside the project',
  'odd-form': 'the owner removes each, or renames it to an ordinary path inside the project',
  'case-variant': 'the owner renames each to the exact spelling the phase write paths use, or removes it',
  'outside-write-paths':
    "the owner commits, stashes or removes each (git status lists them), or, when one is this phase's own work, adds it to the phase writePaths through the plan amendment route",
};

function refusalOf(problems: readonly DirtyProblem[]): ContextResumeOutcome {
  const reasons = REASON_ORDER.filter((reason) => problems.some((problem) => problem.reason === reason));
  const first = reasons[0] as DirtyReason;
  const named = problems.slice(0, MAX_REFUSAL_PATHS_NAMED).map((problem) => `${contextResumeDisplayName(problem.path)} (${REASON_WORDS[problem.reason]})`);
  const more = problems.length > named.length ? `, and ${problems.length - named.length} more` : '';
  return {
    kind: 'refused',
    code: REASON_CODE[first],
    message:
      `the attempt before this one was cut off and left ${problems.length} changed path(s) this run cannot continue from: ${named.join(', ')}${more}. ` +
      `Nothing was sent and no worker was started. Fix: ${reasons.map((reason) => REASON_FIX[reason]).join('; ')}; then runs again.`,
  };
}

function refusedUnobservable(why: string): ContextResumeOutcome {
  return {
    kind: 'refused',
    code: 'RESUME_DIRTY_PATHS_UNOBSERVED',
    message: `the attempt before this one was cut off, and ${why}, so the changes it left cannot be judged. Nothing was sent and no worker was started. Fix: the owner checks that git runs in this checkout (git status) and that the files can be read, then runs again.`,
  };
}

function refusedTooMany(what: string): ContextResumeOutcome {
  return {
    kind: 'refused',
    code: 'RESUME_TOO_MANY_DIRTY_PATHS',
    message: `the attempt before this one was cut off, and ${what}. Nothing was sent and no worker was started. Fix: the owner commits or stashes the work that is finished, and adds an ignore rule for generated trees (for example an un-ignored node_modules), then runs again.`,
  };
}

function refusedRecord(code: string, why: string): ContextResumeOutcome {
  return {
    kind: 'refused',
    code,
    message: `the work record could not be used (${why}), so whether an attempt before this one was cut off cannot be judged. Nothing was sent and no worker was started. Fix: the owner replaces ${WORK_RECORD_REL} with a good copy, or deletes it, and COMMITS that change (the record is a committed file here, so restoring it from git brings the same bytes back), then runs again.`,
  };
}

function normalisedRoot(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** The changed paths git lists, in order and without repeats; or why not: git cannot say, or it said more than a bounded reader takes. */
function dirtyPathsOf(ports: ContextManagerPorts): readonly string[] | 'unreadable' | 'too-much-output' {
  try {
    const result = ports.git(STATUS_ARGS);
    if (typeof result.stdout !== 'string') return 'unreadable';
    // A run that failed with its output at the reader's bound is a list that was too long, not a git that does not run.
    if (result.code !== 0) return result.stdout.length >= MAX_GIT_OUTPUT_BYTES - OUTPUT_BOUND_SLACK ? 'too-much-output' : 'unreadable';
    const paths = porcelainZPaths(result.stdout);
    return paths === null ? 'unreadable' : [...new Set(paths)];
  } catch {
    return 'unreadable';
  }
}

/** What a path really is on disk, judged by an lstat that follows nothing, including every directory above it inside the project. */
function onDiskProblem(ports: ContextManagerPorts, root: string, path: string, parents: Map<string, boolean>): DirtyReason | null {
  const segments = path.split('/');
  let prefix = '';
  for (const segment of segments.slice(0, -1)) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    let isLink = parents.get(prefix);
    if (isLink === undefined) {
      isLink = ports.fs.stat(`${root}/${prefix}`)?.kind === 'link';
      parents.set(prefix, isLink);
    }
    if (isLink) return 'link';
  }
  const own = ports.fs.stat(`${root}/${path}`);
  if (own === null) return null;
  if (own.kind === 'link') return 'link';
  if (own.kind !== 'file') return 'not-regular';
  // A file with a second name can be another file's bytes under this path (a hard link to something outside the project): never hashed or read.
  const names = linkCountOf(ports, `${root}/${path}`);
  if (names === null) return 'link-count-unobserved';
  return names > 1 ? 'link' : null;
}

/** How many names a file has, or null when the port cannot say (it throws, answers null, or answers something that is not a count): that FAILS CLOSED, because a hard link to a file outside the project is hashed as that file. */
function linkCountOf(ports: ContextManagerPorts, path: string): number | null {
  try {
    const count: unknown = ports.linkCount(path);
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 1 ? count : null;
  } catch {
    return null;
  }
}

interface Hashed {
  readonly hash: string | null;
  readonly note: ContextResumeDirtyEntry['note'];
  readonly spent: number;
}

function hashOf(ports: ContextManagerPorts, root: string, path: string, budgetLeft: number): Hashed {
  const own = ports.fs.stat(`${root}/${path}`);
  if (own === null) return { hash: null, note: 'deleted', spent: 0 };
  if (own.size > MAX_RESUME_HASH_BYTES || own.size > budgetLeft) return { hash: null, note: 'too-large', spent: 0 };
  let text: string | null = null;
  try {
    text = ports.fs.readText(`${root}/${path}`);
  } catch {
    text = null;
  }
  if (text === null) return { hash: null, note: 'unreadable', spent: 0 };
  return { hash: `sha256:${sha256Hex(text)}`, note: 'hashed', spent: own.size };
}

type Observed = { readonly ok: true; readonly entries: readonly ContextResumeDirtyEntry[] } | { readonly ok: false; readonly outcome: ContextResumeOutcome };

/** Every changed path, judged, then hashed: the loop's own observation. */
function observeDirty(ports: ContextManagerPorts, request: ContextResumeRequest, root: string): Observed {
  const dirty = dirtyPathsOf(ports);
  if (dirty === 'too-much-output') return { ok: false, outcome: refusedTooMany('git listed more changed paths than a bounded reader takes') };
  if (dirty === 'unreadable') return { ok: false, outcome: refusedUnobservable('git could not list the changed paths') };
  if (dirty.length > MAX_RESUME_DIRTY_PATHS) {
    return { ok: false, outcome: refusedTooMany(`left ${dirty.length} changed paths, more than the ${MAX_RESUME_DIRTY_PATHS} a half-done phase is read from`) };
  }
  const rules = { writePaths: request.writePaths, phaseId: request.phaseId, workRecordPath: WORK_RECORD_REL, loopRecords: request.loopRecords };
  const problems: DirtyProblem[] = [];
  const entries: ContextResumeDirtyEntry[] = [];
  const parents = new Map<string, boolean>();
  let budget = MAX_RESUME_HASH_BUDGET_BYTES;
  for (const path of dirty) {
    const verdict = classifyContextResumePath(path, rules);
    if (verdict.kind === 'refused') {
      problems.push({ path: verdict.path, reason: verdict.reason });
      continue;
    }
    const onDisk = onDiskProblem(ports, root, verdict.path, parents);
    if (onDisk !== null) {
      problems.push({ path: verdict.path, reason: onDisk });
      continue;
    }
    const hashed = hashOf(ports, root, verdict.path, budget);
    budget -= hashed.spent;
    entries.push({ path: verdict.path, kind: verdict.kind, hash: hashed.hash, note: hashed.note });
  }
  return problems.length > 0 ? { ok: false, outcome: refusalOf(problems) } : { ok: true, entries };
}

type FileRead = { readonly kind: 'absent' } | { readonly kind: 'text'; readonly text: string } | { readonly kind: 'problem'; readonly code: string };

/** One record file, read only if it is an ordinary file of a bounded size. Absent is not a problem. */
function recordText(ports: ContextManagerPorts, root: string, rel: string): FileRead {
  try {
    // A link at the file or above it (the execution folder itself) is never followed.
    const onDisk = onDiskProblem(ports, root, rel, new Map());
    if (onDisk === 'link' || onDisk === 'link-count-unobserved') return { kind: 'problem', code: 'RESUME_FILE_NOT_REGULAR' };
    const stat = ports.fs.stat(`${root}/${rel}`);
    if (stat === null) return { kind: 'absent' };
    if (stat.kind !== 'file') return { kind: 'problem', code: 'RESUME_FILE_NOT_REGULAR' };
    if (stat.size > MAX_RESUME_FILE_BYTES) return { kind: 'problem', code: 'RESUME_FILE_TOO_LARGE' };
    const text = ports.fs.readText(`${root}/${rel}`);
    return text === null ? { kind: 'problem', code: 'RESUME_FILE_UNREADABLE' } : { kind: 'text', text };
  } catch {
    return { kind: 'problem', code: 'RESUME_FILE_UNREADABLE' };
  }
}

function jsonObjectOf(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isSeverity = (value: unknown): value is ContextResumeSeverity => typeof value === 'string' && (CONTEXT_RESUME_SEVERITIES as readonly string[]).includes(value);
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

function findingsOf(object: Record<string, unknown>): readonly ContextResumeFinding[] {
  const list: unknown[] = Array.isArray(object['findings']) ? (object['findings'] as unknown[]).slice(0, MAX_FINDINGS_READ) : [];
  return list.flatMap((entry): ContextResumeFinding[] => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (!isSeverity(record['severity'])) return [];
    return [{ id: textOf(record['id']), severity: record['severity'], category: textOf(record['category']), summary: textOf(record['summary']), resolved: record['resolved'] === true }];
  });
}

function evidenceOf(object: Record<string, unknown>): ContextResumeEvidence {
  const checksRaw: unknown[] = Array.isArray(object['checks']) ? (object['checks'] as unknown[]).slice(0, MAX_CHECKS_READ) : [];
  const checks = checksRaw.flatMap((entry): ContextResumeCheck[] => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    return typeof id === 'string' && CHECK_ID.test(id) ? [{ id, passed: record['passed'] === true }] : [];
  });
  const base = object['baseHead'];
  const current = object['currentHead'];
  return {
    baseHead: isCommitName(base) ? base : null,
    currentHead: isCommitName(current) ? current : null,
    checks,
    changedCount: Array.isArray(object['changedFiles']) ? (object['changedFiles'] as unknown[]).length : 0,
  };
}

const freshnessOf = (builtAt: string | null, head: string): string => citationFreshnessMarkOf(citationFreshnessOf(builtAt, head));

function workerRead(id: string, kind: ContextRead['kind'], text: string, freshness: string): ContextRead {
  return { id, kind, text, proof: null, source: 'working-tree', freshness, note: CONTEXT_RESUME_WORKER_NOTE };
}

/** The earlier attempt's own findings and evidence, by the session the record names. A file that is absent or unusable is skipped and named. */
function attemptRecords(ports: ContextManagerPorts, root: string, phaseId: string, fields: ContextResumeFields, head: string, reads: ContextRead[], failures: ContextFailure[]): void {
  if (fields.sessionId === null) return;
  const findingsId = `.projectops/execution/${fields.sessionId}.findings.json`;
  const evidenceId = `.projectops/execution/${fields.sessionId}.evidence.json`;
  // A name the provenance rule cannot place as a record of the execution folder is not one to read.
  if (provenanceKindOfPath(findingsId) !== 'finding' || provenanceKindOfPath(evidenceId) !== 'execution-record') {
    failures.push(failure('resume:session', 'RESUME_SESSION_NOT_A_SAFE_NAME'));
    return;
  }
  const findings = recordText(ports, root, findingsId);
  if (findings.kind === 'problem') failures.push(failure(findingsId, findings.code));
  else if (findings.kind === 'text') {
    const object = jsonObjectOf(findings.text);
    if (object === null) failures.push(failure(findingsId, 'RESUME_FILE_NOT_JSON'));
    else reads.push(workerRead(findingsId, 'finding', renderContextResumeFindings(findingsOf(object)), freshnessOf(fields.subjectCommit, head)));
  }
  const evidence = recordText(ports, root, evidenceId);
  if (evidence.kind === 'problem') failures.push(failure(evidenceId, evidence.code));
  else if (evidence.kind === 'text') {
    const object = jsonObjectOf(evidence.text);
    if (object === null) failures.push(failure(evidenceId, 'RESUME_FILE_NOT_JSON'));
    // The session id already carries this phase's name; the evidence also names its phase, and a record that names another is not shown.
    else if (object['phaseId'] !== undefined && object['phaseId'] !== phaseId) failures.push(failure(evidenceId, 'RESUME_SESSION_NOT_THIS_PHASE'));
    else {
      const summary = evidenceOf(object);
      reads.push(workerRead(evidenceId, 'execution-record', renderContextResumeEvidence(summary), freshnessOf(summary.currentHead ?? summary.baseHead ?? fields.subjectCommit, head)));
    }
  }
}

/**
 * The retrieved state of a cut-off attempt, or the refusal that stops the run. `ok` with no reads is a run that has nothing to resume
 * (no request, no record, a record of other work, or an attempt that never started), and it reads nothing else.
 */
export function resumeReadsOf(ports: ContextManagerPorts, input: ContextResumeInput): ContextResumeOutcome {
  const request = input.resume;
  if (request === undefined) return NOTHING;
  let record: WorkReadResult;
  try {
    record = request.workRecord();
  } catch {
    return refusedRecord('RESUME_WORK_RECORD_UNREADABLE', 'it could not be read');
  }
  // A record that is there and cannot be used is NOT an absent one: it is how a cut-off attempt would be hidden. Its own words are never quoted.
  if (record === null || typeof record !== 'object' || typeof (record as { ok?: unknown }).ok !== 'boolean') return refusedRecord('RESUME_WORK_RECORD_UNREADABLE', 'the reader gave no answer');
  if (!record.ok) return refusedRecord('RESUME_WORK_RECORD_UNREADABLE', 'it is not readable JSON, or is a version this runtime does not read, or names a state this runtime does not know');
  if (record.value === null) return NOTHING;
  const read = contextResumeFieldsOf(record.value, vocabularyOf(request.phaseId));
  if (!read.ok) return refusedRecord(read.code === 'RESUME_RECORD_NOT_PLAIN' ? 'RESUME_WORK_RECORD_NOT_PLAIN' : 'RESUME_WORK_RECORD_STATE_UNKNOWN', read.code === 'RESUME_RECORD_NOT_PLAIN' ? 'it is not plain data' : 'its state is not one of the loop states');
  // Another project's checkpoint cannot be this project's: it is refused. Another PHASE's is what every new phase finds (the entrypoint starts
  // a fresh record when the phase changes), so it is not a cut-off attempt of this one; a work item that never started or finished is not either.
  if (read.belongsTo.projectId !== request.projectId) return refusedRecord('RESUME_WORK_RECORD_NOT_THIS_PROJECT', 'it names another project');
  if (read.belongsTo.phaseId !== request.phaseId || !read.cutOff) return NOTHING;

  const root = normalisedRoot(input.root);
  const observed = observeDirty(ports, request, root);
  if (!observed.ok) return observed.outcome;

  const fields = read.fields;
  const failures: ContextFailure[] = read.dropped.map((code) => failure('resume:work-record', code));
  const reads: ContextRead[] = [
    {
      id: 'resume:cut-off-attempt',
      kind: 'execution-record',
      text: renderContextResumeFields(fields, freshnessOf(fields.subjectCommit, input.head)),
      proof: null,
      source: 'working-tree',
      freshness: freshnessOf(fields.subjectCommit, input.head),
      note: CONTEXT_RESUME_RECORD_NOTE,
    },
  ];
  if (fields.sessionId !== input.sessionId) attemptRecords(ports, root, request.phaseId, fields, input.head, reads, failures);
  reads.push({ id: 'resume:dirty-paths', kind: 'execution-record', text: renderContextResumeDirty(observed.entries), proof: null, source: 'loop-observed', freshness: null, note: CONTEXT_RESUME_OBSERVED_NOTE });
  return { kind: 'ok', reads, failures };
}
