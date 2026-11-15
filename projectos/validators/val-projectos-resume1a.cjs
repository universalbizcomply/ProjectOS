#!/usr/bin/env node
/**
 * PROJECTOS-RESUME1A (plan v1.36, item 3.5) - a new worker continues a half-done phase from retrieved state.
 *
 * WHAT THIS PINS. A worker that was cut off leaves a work record, a session and changed files. The next worker is started with no
 * session to rejoin, so what it learns comes from stored text, and stored text is where an instruction can hide, where a worker's
 * words can be mistaken for a decision, and where a dirty path can widen what a worker may write. Each rule below is one way that
 * goes wrong, and each has named mutations: a change to the real source that makes the wrong thing true, applied to a copy, which
 * the rule must refuse. A mutation counts only when its OWN rule fires. Mutations are named after the BODY of the rule they break.
 *
 *   RS-1  "the record is only a note"                 the work record is read for four closed-vocabulary fields and nothing else: no free text reaches the file
 *   RS-2  "the finding sounds sure"                   earlier findings and evidence are worker-authored, labelled so, and rank as findings, never as a decision
 *   RS-3  "the path is inside, near enough"           a dirty path outside the write paths, in an odd form, a case variant or a link refuses the run; one inside is listed with its hash
 *   RS-4  "the worker says what it changed"           the dirty paths and hashes are what the LOOP read from git and the files, never a worker's words
 *   RS-5  "it is still the same code"                 after HEAD moves, earlier evidence is marked stale by the search index's own freshness rule
 *   RS-6  "a timeout is a failure"                    an attempt that ran out of time is a cut-off attempt: the retry is admitted and the loop's own records are not refused as dirty
 *   RS-7  "the checkpoint says it may"                the work record stays non-authority: no selection, closure, grant or run.ts routing is touched, and the record is read through a port
 *   RS-8  "it is only our own file"                   every resumed item is stored text: gated, ranked, fenced and capped by the manager, with no model and no write
 *   RS-9  "the ledger need not say"                   every resumed item is named in the retrieval ledger with its own source, never as committed
 *   RS-10 "read it first"                             the record and the changed paths are read only after the envelope is bound to the checkout
 *   RS-11 "no bound needed"                           every read is bounded before it is parsed, and every list is capped
 *   RS-12 "no origin"                                 every file states its origin, holds only ASCII, is tracked, and core imports no node: module
 *   RS-13 "register it later"                         both runners run this file, once, in the one place
 *   RS-14 "the tests are optional"                    the proofs are there, and they run
 *
 * Reads files; runs nothing else.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-resume1a";
const CONTEXT_MANAGER_VALIDATOR = "val-projectos-context-manager1a";
const SKILLS_ADOPT_VALIDATOR = "val-projectos-skills-adopt1a";
const CONNECTOR_VALIDATOR = "val-projectos-connector-contract1a";

const CORE = "projectos/core/src/context";
const AGENT = "projectos/agent/src/context";
const PATHS = `${CORE}/resumePaths.ts`;
const RECORD = `${CORE}/resumeRecord.ts`;
const RENDER = `${CORE}/resumeRender.ts`;
const LEDGER = `${CORE}/managerLedger.ts`;
const CORE_INDEX = "projectos/core/src/index.ts";
const STATE = `${AGENT}/resumeState.ts`;
const MANAGER = `${AGENT}/contextManager.ts`;
const RETRIEVAL = `${AGENT}/contextRetrieval.ts`;
const RUN_CONTEXT = `${AGENT}/contextRun.ts`;
const RUNNER = "projectos/agent/src/loop/runner.ts";
const RUN_TS = "projectos/agent/src/commands/run.ts";
const SELECTION = "projectos/agent/src/loop/selection.ts";
const WORK_RECORD = "projectos/agent/src/loop/workRecord.ts";
const VA = "projectos/validators/validate-all.cjs";
const CR = "projectos/speed/cached-runner.cjs";
const FINISH = "docs/finish/PROJECTOS-RESUME1A.md";

const LOOP_RECORDS = `${AGENT}/resumeLoopRecords.ts`;
const NODE_PORT = `${AGENT}/resumeNode.ts`;
const PORTS = `${AGENT}/contextPorts.ts`;
const CORE_FILES = [PATHS, RECORD, RENDER];
const AGENT_FILES = [STATE];
// Files with their own rules: the loop-record set imports the loop's constants (and so cannot be held to the no-authority-module rule), and the
// link-count port is the one place this phase reaches node:fs.
const OWN_RULE_FILES = [LOOP_RECORDS, NODE_PORT];
const NEW_FILES = [...CORE_FILES, ...AGENT_FILES, ...OWN_RULE_FILES];
const TESTS = {
  "projectos/core/test/context-resume.test.ts": [
    "a dirty path is granted by the phase, a record the loop wrote, or refused with a reason",
    "never carries a free-text field: a planted instruction in every one of them appears nowhere in the result or its rendering",
    "refuses a path that differs from a granted one only by case or width, and calls it that",
    "answers a hostile path in linear time",
    "a session id that is not exactly the shape the loop mints for this phase is dropped, whatever its characters",
    "knows the loop lifecycle records it is handed: the plan state file, the gatekeeper files, and only in the shapes given",
    "holds the context file to the stem the sweep takes, 64 characters, and not one more",
    "names the two records a worker owns as that, not as the loop",
  ],
  "projectos/agent/test/resumeState.test.ts": [
    "a planted instruction in every free-text field of the record is in no part of the file, the ledger body or the withheld list",
    "ranks them as a finding and an execution record, below a committed decision and approved memory, whatever they say",
    "lists a path inside the write paths with the hash of its content, read through the ports",
    "refuses with a code and a fix that names the owner, names the path, and writes nothing",
    "refuses a granted path that is a link, or sits under one, and names it as one",
    "marks them stale once HEAD is another commit, shows the mark to the worker and keeps the items",
    "lists a context file a killed earlier run left as a record the loop wrote, because the next run sweeps it by that name",
    "does not read an attempt record through a link in the execution folder, and names the file by code",
    "a forged envelope for another project reads no work record, asks git nothing and refuses",
    "shows a large but valid findings file (200 findings) bounded, and a hostile 262 KB one in linear time",
    "so a worker cannot switch the check off by damaging the record, and names who restores it",
    "a session id that is a phrase, or another phase, is not a channel: it is shown nowhere and no file is read for it",
    "hashes at most 32 MiB in all: the budget is spent, and the files past it are listed with no hash",
    "refuses a file with a second name (a hard link), which could be the bytes of a file outside the project, and never hashes it",
    "lists the loop lifecycle records it is handed (the plan state file, the gatekeeper files) as such, and refuses a tracked file that is not one",
    "says commit, stash or ignore (not \"check git runs\") when git failed because its list was past the bound",
    "does not show an evidence record that names another phase",
    "refuses a changed file whose number of names cannot be read, and never hashes it",
    "a hard-linked findings record is not read either",
    "the manager refuses a run whose ports carry no link count at all",
    "says to replace or delete the record AND commit that change, because the record is a committed file",
    "is the same refusal as a reader that says no, not a TypeError",
  ],
  "projectos/agent/test/resumeRun.test.ts": [
    "runs a second worker, started fresh with no session, and hands it what the timed-out attempt left",
    "stops with a named code and a fix, starts no worker, places no file and writes no brief",
    "a context file a killed earlier run left does not refuse the next run, and the run sweeps it",
    "a record that says the gate is approved and a commit may be made changes no stop, no attempt and no call",
    "lists the changed file with the hash of its real bytes, and a whole run of the handle leaves `git status` as it found it",
    "refuses a directory junction or link under the write paths",
    "marks the earlier state stale once HEAD has moved, and still admits the run",
    "a retry after a cut-off run that ran the REAL lifecycle recorder is admitted",
    "a tracked file the worker changed that is not in the loop record set still refuses, state file or not",
    "refuses a hard link to a file outside the project, never hashing or reading it",
    "the runner hands the resume the loop own lifecycle records",
  ],
  "projectos/agent/test/support/resumeLoopWorld.ts": ["export function resumeWorld("],
};

const RULE_NAMES = {
  "RS-1": "free text from the work record can reach a worker",
  "RS-2": "a worker's earlier words rank like a decision, or are not labelled",
  "RS-3": "a dirty path the phase does not grant does not refuse the run",
  "RS-4": "the dirty paths or hashes are not the loop's own observation",
  "RS-5": "earlier evidence is not marked stale after HEAD moves",
  "RS-6": "a retry after a timeout is refused, or a record the loop wrote is refused as dirty",
  "RS-7": "the work record is read as authority, or selection and run.ts changed",
  "RS-8": "a resumed item skips the gate, the ranking or the fence, or a write or a model call exists",
  "RS-9": "a resumed item is not named in the ledger, or is named as committed",
  "RS-10": "the record or the changed paths are read before the checkout is bound",
  "RS-11": "a read is not bounded before it is parsed, or a list is not capped",
  "RS-12": "a file has no origin, is not ASCII, is not tracked, or core imports node:",
  "RS-13": "not registered",
  "RS-14": "proof weakened",
};

const normalise = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, "\n");
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
const code = (text) => withoutComments(text);
const NOT_ASCII = /[^\x00-\x7f]/;
const GONE = "";
const count = (text, re) => (text.match(re) ?? []).length;

function readFile(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? normalise(fs.readFileSync(abs, "utf8")) : null;
}

function after(text, needle, from = 0) {
  const at = text.indexOf(needle, from);
  return at < 0 ? -1 : at;
}

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  const end = text.indexOf("\n];", start);
  return start < 0 || end < 0 ? null : text.slice(start, end);
}

const FREE_TEXT_FIELDS = /\b(?:lastStopDetail|lastCompletedStep|nextCandidateAction|gateDecisionId|evidenceSessionId|updatedAt|ownerRequired)\b/;
const AUTHORITY_MODULE = /from\s+['"][^'"]*(?:closure|ownerOnly|ownerGate|gatekeeper|technicalContinuation|permissions|\/approval|approvalStore|selection)[^'"]*['"]/;
const PHASE_AUTHORITY = /\b(?:selectNextPhase|checkClosure|closurePrepare|closureRequest|decideContinuation|writePathGrants|grantedPaths|approvePhase|advancePhase|commitOwnRecords|resumeProblems|advanceWork|beginWork|writeWorkRecord)\b/;
const OUTWARD = /\b(?:fetch|XMLHttpRequest|WebSocket|anthropic|openai)\b|child_process|\b(?:execSync|spawnSync|spawn)\b|process\.env|\bDate\.now\b|\bMath\.random\b|new Date\(\)|\b(?:setInterval|setTimeout|setImmediate|queueMicrotask)\b/i;
const WRITES = /\b(?:writeText|writeFileSync|appendFile|createExclusive|removeFile|renameFile|rmSync|unlinkSync|mkdirSync|proposeMemoryWrite|approveMemoryProposal|writeMemoryEntries|promoteSkill|mintEnvelope)\b/;

function textProblems(raw, tracked) {
  const errors = [];
  const E = (rule, message) => errors.push([rule, `${rule} ${RULE_NAMES[rule]}: ${message}`]);
  const paths = code(raw[PATHS]);
  const record = code(raw[RECORD]);
  const render = code(raw[RENDER]);
  const ledger = code(raw[LEDGER]);
  const state = code(raw[STATE]);
  const manager = code(raw[MANAGER]);
  const retrieval = code(raw[RETRIEVAL]);
  const runContext = code(raw[RUN_CONTEXT]);
  const runner = code(raw[RUNNER]);
  const runTs = code(raw[RUN_TS]);
  const selection = code(raw[SELECTION]);

  // RS-1: four closed fields, and nothing else of the record.
  const fieldsRead = [...record.matchAll(/dataField\(raw, '([A-Za-z]+)'\)/g)].map((match) => match[1]).sort().join(",");
  if (fieldsRead !== "lastStopCode,phaseId,projectId,sessionId,state,subjectCommit") E("RS-1", `the record is read for ${fieldsRead}: exactly state, lastStopCode, subjectCommit, sessionId, and the project and phase to compare, are read`);
  if (FREE_TEXT_FIELDS.test(record) || FREE_TEXT_FIELDS.test(state) || FREE_TEXT_FIELDS.test(render)) E("RS-1", `a free-text field of the work record is named in code: ${(FREE_TEXT_FIELDS.exec(record) ?? FREE_TEXT_FIELDS.exec(state) ?? FREE_TEXT_FIELDS.exec(render))[0]}`);
  if (!record.includes("if (!isPlainData(raw)) return { ok: false, code: 'RESUME_RECORD_NOT_PLAIN' };")) E("RS-1", "a record that is not plain data is read");
  if (!record.includes("if (typeof state !== 'string' || !vocabulary.states.includes(state)) return { ok: false, code: 'RESUME_RECORD_STATE_UNKNOWN' };")) E("RS-1", "a state outside the closed list is accepted");
  if (!record.includes("if (typeof stop === 'string' && vocabulary.stopCodes.includes(stop)) lastStopCode = stop;")) E("RS-1", "a stop code outside the closed list is accepted");
  if (!record.includes("if (isCommitName(commit)) subjectCommit = commit;")) E("RS-1", "a subject commit that is not exactly a commit name is accepted");
  if (!record.includes("if (typeof session === 'string' && isMintedSession(session, vocabulary.phaseId)) sessionId = session;") || !record.includes("const SESSION_NAME = /^[A-Za-z0-9_.-]{1,64}$/;")) E("RS-1", "a session that is not a safe name is accepted");
  if (!record.includes("const SESSION_TAIL = /^[0-9a-f]{12}(?:-[0-9a-f]{1,16})?$/;") || !record.includes("session.startsWith(`${phaseId}-`) && SESSION_TAIL.test(session.slice(phaseId.length + 1))") || !record.includes("readonly phaseId: string;")) E("RS-1", "a session id is accepted in a shape the loop does not mint for this phase: a 64-character phrase passes the threat scan and is free text");
  if (!state.includes("if (fields.sessionId !== input.sessionId) attemptRecords(ports, root, request.phaseId, fields, input.head, reads, failures);")) E("RS-1", "the session the record names is read even when it is this run's own, or is read for another phase");
  if (!state.includes("else if (object['phaseId'] !== undefined && object['phaseId'] !== phaseId) failures.push(failure(evidenceId, 'RESUME_SESSION_NOT_THIS_PHASE'));")) E("RS-1", "an evidence record that names another phase is shown");
  if (!record.includes("if (prototype !== Object.prototype && prototype !== null) return false;") || !record.includes("if (descriptor === undefined || !('value' in descriptor)) return false;")) E("RS-1", "a record that holds an accessor or inherits is read");
  if (!state.includes("states: WORK_STATES as readonly string[],") || !state.includes("stopCodes: Object.keys(STOP_CODES),") || !state.includes("const STOP_CODES: Readonly<Record<LoopStopCode, true>> = {")) E("RS-1", "the closed vocabularies are not the loop's own");
  if (!state.includes("const read = contextResumeFieldsOf(record.value, vocabularyOf(request.phaseId));")) E("RS-1", "the record is not read through the closed-vocabulary reader");
  if (!render.includes("`- state: ${fields.state}`,") || !render.includes("'Nothing the record said in words is repeated here.',")) E("RS-1", "the attempt's text is not made of its closed fields alone");
  if (/\brecord\.value\.\w/.test(state)) E("RS-1", "the loop reads a field of the work record directly");

  // RS-2: worker-authored, labelled, and ranked as a finding or an execution record.
  if (!render.includes("export const CONTEXT_RESUME_WORKER_NOTE = 'worker-authored, from a cut-off attempt';")) E("RS-2", "the label is not 'worker-authored, from a cut-off attempt'");
  if (!state.includes("return { id, kind, text, proof: null, source: 'working-tree', freshness, note: CONTEXT_RESUME_WORKER_NOTE };")) E("RS-2", "an earlier attempt's item is not labelled as a worker's, with no proof and the working-tree source");
  if (!state.includes("workerRead(findingsId, 'finding',") || !state.includes("workerRead(evidenceId, 'execution-record',")) E("RS-2", "the findings are not a finding, or the evidence is not an execution record");
  if (/'(?:committed-decision|approved-memory|plan-memory)'/.test(state)) E("RS-2", "a resumed item names a kind above a finding");
  if (count(state, /proof: null/g) !== 3 || /\bproof:\s*(?!null)/.test(state.replace(/proof: null/g, ""))) E("RS-2", "a resumed item carries a proof, which only a committed read mints");
  if (count(state, /kind: 'execution-record'/g) !== 2) E("RS-2", "the attempt's own fields or the dirty list are not execution records");
  if (/(?=[^\n]*\bresumed\.)[^\n]*(?:ecision|withApproved)/.test(manager)) E("RS-2", "a resumed item is handed to the decisions");
  if (!manager.includes("const metas = rankedMetas(ports, [...retrieval.reads, ...resumed.reads], head, nowMs, withheld, committedPlaceholders);")) E("RS-2", "a resumed item is not ranked by provenance with the rest");
  if (!manager.includes("...(read.note === undefined ? [] : [read.note]),")) E("RS-2", "the label is not in the item's header");

  // RS-3: refuse what the phase does not grant; list what it does, with its hash.
  if (!state.includes("const verdict = classifyContextResumePath(path, rules);\n    if (verdict.kind === 'refused') {\n      problems.push({ path: verdict.path, reason: verdict.reason });\n      continue;\n    }")) E("RS-3", "a refused path is not a problem");
  if (!state.includes("const rules = { writePaths: request.writePaths, phaseId: request.phaseId, workRecordPath: WORK_RECORD_REL, loopRecords: request.loopRecords };")) E("RS-3", "the rules are not the phase's own write grant");
  if (!state.includes("return problems.length > 0 ? { ok: false, outcome: refusalOf(problems) } : { ok: true, entries };")) E("RS-3", "a problem does not refuse");
  if (!manager.includes("if (resumed.kind === 'refused') return refuse(resumed.code, resumed.message, key);")) E("RS-3", "the manager does not stop the run for a refusal");
  if (!state.includes("return { hash: `sha256:${sha256Hex(text)}`, note: 'hashed', spent: own.size };")) E("RS-3", "a listed path carries no hash of its content");
  if (!state.includes("Nothing was sent and no worker was started. Fix: ${reasons.map((reason) => REASON_FIX[reason]).join('; ')}; then runs again.")) E("RS-3", "a refusal names no fix");
  if (count(state, /the owner /g) < 9) E("RS-3", "a fix does not say who must act");
  if (!state.includes("code: 'RESUME_DIRTY_PATHS_UNOBSERVED',") || !state.includes("if (dirty === 'unreadable') return { ok: false, outcome: refusedUnobservable('git could not list the changed paths') };")) E("RS-3", "a run whose changes cannot be listed goes on");
  if (!state.includes("if (isLink) return 'link';") || !state.includes("if (own.kind === 'link') return 'link';") || !state.includes("if (own.kind !== 'file') return 'not-regular';")) E("RS-3", "a link, or a path that is not an ordinary file, is accepted");
  if (!state.includes("const names = linkCountOf(ports, `${root}/${path}`);\n  if (names === null) return 'link-count-unobserved';\n  return names > 1 ? 'link' : null;")) E("RS-3", "a file with a second name (a hard link to a file outside the project) is accepted, hashed and read, or one whose number of names cannot be read is not refused");
  if (!state.includes("const count: unknown = ports.linkCount(path);") || !state.includes("return typeof count === 'number' && Number.isSafeInteger(count) && count >= 1 ? count : null;") || !state.includes("} catch {\n    return null;\n  }\n}\n\ninterface Hashed")) E("RS-3", "a link count that is missing, null, thrown or not a count is taken for one name (it fails OPEN): the bytes of a file outside the project are hashed");
  if (!state.includes("'link-count-unobserved': 'RESUME_LINK_COUNT_UNOBSERVED',") || !state.includes("the owner checks each path with the operating system tools (fsutil hardlink list on Windows, stat on Unix) and commits or removes it")) E("RS-3", "a path whose number of names cannot be read is refused with no code of its own, or names no fix");
  if (!state.includes("${contextResumeDisplayName(problem.path)} (${REASON_WORDS[problem.reason]})")) E("RS-3", "a refusal does not name each path, as a safe name, with why");
  if (!state.includes("const named = problems.slice(0, MAX_REFUSAL_PATHS_NAMED).map(")) E("RS-3", "a refusal names no paths");
  if (!state.includes("isLink = ports.fs.stat(`${root}/${prefix}`)?.kind === 'link';")) E("RS-3", "a directory above a path is not asked whether it is a link");
  if (!state.includes("const onDisk = onDiskProblem(ports, root, rel, new Map());\n    if (onDisk === 'link' || onDisk === 'link-count-unobserved') return { kind: 'problem', code: 'RESUME_FILE_NOT_REGULAR' };")) E("RS-3", "an earlier attempt's record is read through a link, a second name, or a path whose names cannot be counted");
  if (!state.includes("const onDisk = onDiskProblem(ports, root, verdict.path, parents);\n    if (onDisk !== null) {")) E("RS-3", "the file system is not asked what a path is");
  if (!paths.includes("return { kind: 'refused', path, reason: 'outside-write-paths' };")) E("RS-3", "a path outside the grant is not refused");
  if (!paths.includes("if (grants.some((pattern) => grantCovers(path, pattern, true))) return { kind: 'refused', path, reason: 'case-variant' };")) E("RS-3", "a case or width variant of a granted path is not refused as one");
  if (!paths.includes("if (grants.some((pattern) => grantCovers(path, pattern, false))) return { kind: 'granted', path };")) E("RS-3", "a granted path is not judged by its exact spelling");
  if (!paths.includes("if (/^[\\\\/]/.test(path) || /^[A-Za-z]:/.test(path)) return 'absolute';") || !paths.includes("if (segments.includes('..')) return 'traversal';")) E("RS-3", "an absolute path or a climb is not refused");
  if (!paths.includes("if (path.includes('\\\\') || path.includes(':') || path.includes('~') || INVISIBLE.test(path.replace(/ /g, ''))) return 'odd-form';")) E("RS-3", "a backslash, a stream, a short name or an invisible character is accepted");
  if (!paths.includes("if (/[. ]$/.test(segment)) return 'odd-form';") || !paths.includes("if (segment === '' || segment === '.') return 'odd-form';")) E("RS-3", "a segment Windows rewrites, an empty one or a dot is accepted");
  if (!paths.includes("const canonical = (text: string): string => text.normalize('NFKC').toLowerCase();")) E("RS-3", "a case variant is judged by something other than width and case folding");
  if (!paths.includes("if (pattern.endsWith(BENEATH)) return target.startsWith(`${same(pattern.slice(0, -BENEATH.length))}/`);") || !paths.includes("const BENEATH = '/'.concat('*', '*');")) E("RS-3", "a directory grant covers more than what is under it");
  if (!paths.includes("const shape = shapeReason(path);\n  if (shape !== null) return { kind: 'refused', path, reason: shape };\n  const grants")) E("RS-3", "the shape of a path is not judged before the grant");

  // RS-4: the loop's own observation.
  if (!state.includes("const STATUS_ARGS: readonly string[] = ['status', '--porcelain', '-z', '--untracked-files=all'];")) E("RS-4", "git is not asked for every path, one by one, in the null-separated form");
  if (!state.includes("const result = ports.git(STATUS_ARGS);\n    if (typeof result.stdout !== 'string') return 'unreadable';") || !state.includes("const paths = porcelainZPaths(result.stdout);")) E("RS-4", "the list of changed paths does not come from git");
  if (!render.includes("export const CONTEXT_RESUME_OBSERVED_NOTE = 'the path list and the hashes were read by the loop itself (git, then a hash of each file) at the start of this run; the names are whatever whoever made the files chose';")) E("RS-4", "the note claims more than the loop observed: it read the list and the hashes, and the names are a worker's choice");
  if (!state.includes("const dirty = dirtyPathsOf(ports);") || !state.includes("for (const path of dirty) {")) E("RS-4", "the entries are not made from the paths git listed");
  if (!state.includes("text = ports.fs.readText(`${root}/${path}`);")) E("RS-4", "a hash is not of the file the loop read");
  if (!state.includes("changedCount: Array.isArray(object['changedFiles']) ? (object['changedFiles'] as unknown[]).length : 0,")) E("RS-4", "the evidence's own list of changed files is not only counted");
  if (!state.includes("source: 'loop-observed', freshness: null, note: CONTEXT_RESUME_OBSERVED_NOTE")) E("RS-4", "the dirty list is not recorded as the loop's own observation");
  if (count(state, /\bchangedFiles\b/g) !== 2 || count(state, /\bobserved\.entries\b/g) !== 1) E("RS-4", "the dirty list is built from something other than git");

  // RS-5: stale after HEAD moves.
  if (!state.includes("const freshnessOf = (builtAt: string | null, head: string): string => citationFreshnessMarkOf(citationFreshnessOf(builtAt, head));")) E("RS-5", "freshness is not the search index's own rule, against the head");
  if (count(state, /freshnessOf\(/g) !== 4) E("RS-5", `freshness is judged in ${count(state, /freshnessOf\(/g)} places, not the four items that come from an earlier attempt`);
  if (!state.includes("freshnessOf(summary.currentHead ?? summary.baseHead ?? fields.subjectCommit, head)")) E("RS-5", "the evidence is not judged at the commit it was collected at");
  if (!state.includes("freshnessOf(fields.subjectCommit, head)")) E("RS-5", "the findings are not judged at the commit the attempt was established at");
  if (!manager.includes("const resumed = resumeReadsOf(ports, { resume: request.resume, root: request.root, head, sessionId: request.sessionId });")) E("RS-5", "the head is not the one the manager read now");
  if (!state.includes("renderContextResumeFields(fields, freshnessOf(fields.subjectCommit, input.head))")) E("RS-5", "the attempt's own fields are not marked fresh or stale against the head now");

  // RS-6: a timeout is a cut-off attempt.
  if (!state.includes("inactiveStates: ['QUEUED', 'COMPLETE', 'AWAITING_GATE', 'GATE_APPROVED', 'WAITING_OWNER'] as readonly string[],")) E("RS-6", "the states that are not a cut-off attempt are not exactly the five that never started or finished or wait on a gate");
  if (!state.includes("|| !read.cutOff) return NOTHING;") || !record.includes("cutOff: !vocabulary.inactiveStates.includes(state),")) E("RS-6", "an attempt that was cut off is not told apart from one that was not");
  if (!state.includes("WORKER_TIMED_OUT: true,")) E("RS-6", "the timeout stop is not in the closed list, so a recorded timeout is dropped");
  if (!paths.includes("const EXECUTION_LOOP_RECORD = /^\\.projectops\\/execution\\/[A-Za-z0-9_.-]{1,200}\\.(?:brief|session|evidence|invocation|reviewer)\\.json$/;")) E("RS-6", "the records a run leaves in the execution folder are not all ones the loop wrote");
  if (!paths.includes("const EXECUTION_CONTEXT_FILE = /^\\.projectops\\/execution\\/[A-Za-z0-9_.-]{1,64}\\.context\\.md$/;") || !paths.includes("const EXECUTION_WORKER_RECORD = /^\\.projectops\\/execution\\/[A-Za-z0-9_.-]{1,200}\\.(?:findings|effects)\\.json$/;") || !paths.includes("if (EXECUTION_WORKER_RECORD.test(path)) return { kind: 'worker-record', path };")) E("RS-6", "a killed run's context file (the sweep's own name shape, 64 characters) or the worker's own findings and effects records are refused as dirty, or the worker's records are called the loop's");
  if (!paths.includes("if (rules.loopRecords.paths.some((exact) => typeof exact === 'string' && exact !== '' && path === exact)) return true;") || !paths.includes("return rest.length <= MAX_LOOP_RECORD_NAME_CHARS && !rest.includes('/') && name.test(rest);")) E("RS-6", "the loop's own lifecycle records (the plan's state file, the gatekeeper's files) are refused as dirty: every real governed project would refuse its own retry with a fix nobody can apply");
  if (!paths.includes("if (EXECUTION_LOOP_RECORD.test(path) || EXECUTION_CONTEXT_FILE.test(path)) return true;")) E("RS-6", "an execution record or a context file the loop wrote is refused as dirty");
  if (!paths.includes("if (path === rules.workRecordPath) return true;") || !paths.includes("if (SAFE_NAME.test(rules.phaseId) && path === `.projectops/phases/${rules.phaseId}.json`) return true;")) E("RS-6", "the work record or this phase's own record is refused as a dirty path");
  if (!paths.includes("if (grants.some((pattern) => grantCovers(path, pattern, false))) return { kind: 'granted', path };\n  if (isLoopRunRecord(path, rules)) return { kind: 'run-record', path };")) E("RS-6", "a record the loop wrote is judged after the grant is refused");
  if (count(runner, /WORKER_TIMED_OUT/g) !== 2) E("RS-6", "the runner names the timeout stop where this phase did not: a refusal keyed on it would refuse the retry");
  if (/\brefused\(\[[^\]]*(?:WORKER_TIMED_OUT|lastStopCode)/.test(runner)) E("RS-6", "the runner refuses on a recorded stop");

  // RS-6, continued: the loop-record set is the entrypoint's own record fold, and its shapes are compared with the protected run.ts text, which is read and never imported.
  const loopRecs = code(raw[LOOP_RECORDS]);
  const altsOf = (text, re) => (re.exec(text) ?? [null, ""])[1].split("|").filter(Boolean).sort();
  const originalAlts = altsOf(runTs, /inFlat\('\.projectops\/execution', \/\^\[A-Za-z0-9_\.-\]\{1,200\}\\\.\(\?:([a-z|]+)\)\\\.json\$\/\)/);
  const mineAlts = altsOf(paths, /EXECUTION_LOOP_RECORD = \/\^\\\.projectops\\\/execution\\\/\[A-Za-z0-9_\.-\]\{1,200\}\\\.\(\?:([a-z|]+)\)\\\.json\$\//);
  if (originalAlts.length === 0) E("RS-6", "run.ts no longer spells its execution record shapes the way this phase mirrors them: update the mirror with it");
  else if (JSON.stringify(mineAlts.filter((name) => name !== "reviewer")) !== JSON.stringify(originalAlts) || !mineAlts.includes("reviewer")) E("RS-6", `the loop's execution record names (${mineAlts.join("|")}) are not the ones run.ts folds (${originalAlts.join("|")}) plus the loop's own reviewer record: the worker's findings and effects are NOT the loop's`);
  if (!runTs.includes("inFlat(GATEKEEPER_DECISIONS_REL, /^[A-Za-z0-9_-]{4,128}\\.json$/)") || !loopRecs.includes("export const RESUME_DECISION_RECORD_NAME = /^[A-Za-z0-9_-]{4,128}\\.json$/;")) E("RS-6", "the gatekeeper decision name shape is not the one run.ts folds");
  if (!runTs.includes("inFlat(GATEKEEPER_INTERACTIVE_REL, INTERACTIVE_RECORD_FILENAME)") || !loopRecs.includes("{ dir: GATEKEEPER_INTERACTIVE_REL, name: INTERACTIVE_RECORD_FILENAME },") || !loopRecs.includes("{ dir: GATEKEEPER_DECISIONS_REL, name: RESUME_DECISION_RECORD_NAME },")) E("RS-6", "the gatekeeper folders are not the ones run.ts folds, by the same constants");
  if (!runTs.includes("[WORK_RECORD_REL, GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL, `.projectops/phases/${phaseId}.json`, ...stateTail].includes(p)") || !loopRecs.includes("paths: [GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL, ...programmeStateTailPaths(context)],")) E("RS-6", "the exact loop record paths (thread, ledger, the plan's state tail) are not the ones run.ts folds");
  if (!loopRecs.includes("import { programmeStateTailPaths } from '../closureGate.js';") || !loopRecs.includes("import { GATEKEEPER_DECISIONS_REL, GATEKEEPER_LEDGER_REL, GATEKEEPER_THREAD_REL } from '../loop/gatekeeperConfig.js';") || !loopRecs.includes("import { GATEKEEPER_INTERACTIVE_REL, INTERACTIVE_RECORD_FILENAME } from '../loop/gatekeeperHandoff.js';")) E("RS-6", "the loop record constants are not imported from where run.ts imports them");
  if (/\.projectops\/(?!\*)/.test(loopRecs) || /["'`]\.projectops/.test(loopRecs)) E("RS-6", "the loop record set spells a path itself instead of taking it from the loop's constants");
  if (!runner.includes("import { resumeLoopRecordsOf } from '../context/resumeLoopRecords.js';")) E("RS-6", "the runner does not build the loop record set from the loop's own constants");

  // The link-count port: lstat only, never a write, the one node:fs of this phase, and handed to the manager as an optional port.
  const nodePort = code(raw[NODE_PORT]);
  if (!nodePort.includes("import { lstatSync } from 'node:fs';") || !nodePort.includes("return lstatSync(path).nlink;") || count(nodePort, /from 'node:/g) !== 1 || WRITES.test(nodePort)) E("RS-3", `${NODE_PORT} is not one lstat of a path`);
  if (!code(raw[PORTS]).includes("linkCount: resumeNodeLinkCount,") || !code(raw[PORTS]).includes("readonly linkCount: (path: string) => number | null;") || !code(raw[PORTS]).includes("if (!isFunction(ports.linkCount)) return 'linkCount';")) E("RS-3", "the link count is not a REQUIRED port, or the real ports do not give it");

  // RS-7: non-authority, and selection and run.ts routing unchanged.
  for (const rel of [...CORE_FILES, ...AGENT_FILES]) {
    const text = code(raw[rel]);
    if (AUTHORITY_MODULE.test(text)) E("RS-7", `${rel} imports an authority module`);
    const found = PHASE_AUTHORITY.exec(text);
    if (found !== null) E("RS-7", `${rel} names ${found[0]}: the work record never selects, advances, closes or widens`);
    if (text.includes(".projectops/work.v1.json")) E("RS-7", `${rel} spells the work record's location, which only workRecord.ts may`);
    if (/\.projectops\/closure|\.projectops\/gate|gate-decisions|\.projectops\/owner/.test(text)) E("RS-7", `${rel} names a closure, gate or owner record`);
  }
  if (!state.includes("workRecord: () => WorkReadResult;") || !state.includes("record = request.workRecord();")) E("RS-7", "the record is not read through the port the loop supplies");
  if (/writePaths\s*:\s*\[|\.\.\.request\.writePaths|request\.writePaths\.(?:push|concat|splice|unshift)|\bgrants\.(?:push|concat)/.test(state)) E("RS-7", "the grant is widened from what the record or a listing said");
  if (!runner.includes("resume: { phaseId, projectId: context.projectId, writePaths: writeGrant.paths, loopRecords: resumeLoopRecordsOf(context), workRecord: () => readWorkRecord(sys, root) },")) E("RS-7", "the runner hands the manager something other than the phase, the project, the grant and a reader");
  if (count(runner, /\bresume:\s*\{/g) !== 1) E("RS-7", "the runner builds the resume request in more than one place");
  if (/\bresumeReadsOf\b|\bcontextResume|ContextResumeRequest/.test(runTs) || /\bresumeReadsOf\b|\bcontextResume|ContextResumeRequest|resumeState/.test(selection)) E("RS-7", "run.ts or selection.ts knows about resume: selection and routing are unchanged");
  if (/\bwriteWorkRecord\b/.test(runner)) E("RS-7", "the loop writes the work record itself");
  for (const rel of [RUNNER, MANAGER, RUN_CONTEXT]) {
    for (const line of code(raw[rel]).split("\n")) {
      if (/\bresum/i.test(line) && /\b(?:selectNextPhase|decideContinuation|ownerOnlyActions|acceptedDecision|degradedMode|correctionGrants|closureRoute)\b/.test(line)) E("RS-7", `a line of ${rel} joins resume to a selection, a decision or a grant: ${line.trim().slice(0, 70)}`);
    }
  }
  const onlyManager = ["projectos/agent/src/context/contextRun.ts", "projectos/agent/src/context/contextRetrieval.ts", RUNNER];
  for (const rel of onlyManager) if (/\bresumeReadsOf\(/.test(code(raw[rel]))) E("RS-7", `${rel} calls resumeReadsOf, which only the manager may`);
  if (count(manager, /\bresumeReadsOf\(/g) !== 1) E("RS-7", "the manager does not call resumeReadsOf exactly once");
  if (!(raw[WORK_RECORD] ?? "").includes("export function readWorkRecord(sys: System, root: string): WorkReadResult {")) E("RS-7", "workRecord.ts no longer reads the record the one way this phase reads it");

  // RS-8: every resumed item is stored text the manager gates, ranks, fences and caps; nothing is written or called out.
  for (const rel of [...CORE_FILES, ...AGENT_FILES]) {
    const text = code(raw[rel]);
    if (OUTWARD.test(text)) E("RS-8", `${rel} reaches outside its ports: ${OUTWARD.exec(text)[0]}`);
    if (WRITES.test(text)) E("RS-8", `${rel} reaches a write path: ${WRITES.exec(text)[0]}`);
  }
  if (!manager.includes("const gate = gateContextItemText(read.text, ports.secretScreen);")) E("RS-8", "a read is not passed through the gate");
  if (!state.includes("export function resumeReadsOf(ports: ContextManagerPorts, input: ContextResumeInput): ContextResumeOutcome {")) E("RS-8", "the resume reads are not the manager's ports and a read result");
  if (!manager.includes("role: 'tool',\n      origin: 'memory',") || !manager.includes("text: renderedTurnText(turn)")) E("RS-8", "a resumed item is not a fenced tool turn of origin memory");
  if (/\brenderContextPrompt\b|\bappendContextTurn\b|\bopenContextThread\b|\bwithApprovedDecision\b|\bapplyCompaction\b/.test(state)) E("RS-8", "resume builds the thread or the prompt itself instead of handing reads to the manager");
  if (!render.includes("const shown = contextResumeDisplayName(entry.path);") || !render.includes("` [name simplified; path hash ${sha256Hex(entry.path).slice(0, 12)}]`")) E("RS-8", "a changed path's name is shown raw in the listing, or the hash that finds the real path is gone");
  if (count(render, /const raw = \(typeof text === 'string' \? text : ''\)\.slice\(0, max \* 4\);/g) !== 2) E("RS-8", "a name is not bounded before it is read");
  if (!render.includes("export function contextResumeDisplayName(text: unknown, max = 160): string {") || !render.includes("return `name-${sha256Hex(raw).slice(0, 12)}`;")) E("RS-8", "a name that reads as an instruction is shown as a sentence");
  if (!render.includes("return raw.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+/gu, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);")) E("RS-8", "a worker's words are not put on one line without control or invisible characters");
  if (!state.includes("const failures: ContextFailure[] = read.dropped.map((code) => failure('resume:work-record', code));")) E("RS-8", "a dropped field is silent");

  // RS-9: named in the ledger, never as committed.
  if (!/export const CONTEXT_LEDGER_SOURCES = \['committed', 'index', 'approved-decision', 'working-tree', 'loop-observed'\] as const;/.test(ledger)) E("RS-9", "the ledger has no source for a worker's file or for the loop's own observation");
  if (!retrieval.includes("readonly source: 'committed' | 'index' | 'working-tree' | 'loop-observed';")) E("RS-9", "a read cannot say it came from the working tree or from the loop");
  if (/source:\s*'(?:committed|index|approved-decision)'/.test(state)) E("RS-9", "a resumed item says it is committed, indexed or an approved decision");
  if (count(state, /source: 'working-tree'/g) !== 2 || count(state, /source: 'loop-observed'/g) !== 1) E("RS-9", "a resumed item does not carry the source of where it was read");
  if (!state.includes("id: 'resume:cut-off-attempt',") || !state.includes("id: 'resume:dirty-paths',")) E("RS-9", "the attempt's fields or the dirty list has no id of its own");
  if (!state.includes("const findingsId = `.projectops/execution/${fields.sessionId}.findings.json`;") || !state.includes("const evidenceId = `.projectops/execution/${fields.sessionId}.evidence.json`;")) E("RS-9", "the findings and evidence are not named by the path they were read from");
  if (!manager.includes("source: read.source,")) E("RS-9", "the ledger item does not carry the read's own source");
  if (!manager.includes("const shown = shownMetas.map(ledgerItemOf).sort((a, b) => a.rank - b.rank);")) E("RS-9", "what was shown is not what the ledger names");
  if (!runContext.includes("...(input.resume === undefined ? {} : { resume: input.resume }) };")) E("RS-9", "the run handle does not pass the resume request on to the manager");

  // RS-10: after the checkout is bound.
  const identityAt = after(manager, "const identity = checkoutIdentityOf(ports);");
  const bindAt = after(manager, "identity.tenant !== key.tenant");
  const headAt = after(manager, "const head = headOf(ports);");
  const retrieveAt = after(manager, "const retrieval = sourcesOf(ports, key, request);");
  const unreadableAt = after(manager, "const unreadable = blockingFailure(retrieval.failures);");
  const resumeAt = after(manager, "resumeReadsOf(ports");
  if (!(identityAt >= 0 && bindAt > identityAt && headAt > bindAt && retrieveAt > headAt && unreadableAt > retrieveAt && resumeAt > unreadableAt)) E("RS-10", "the resume reads do not come after the checkout binding, the head and the decisions");
  if (!state.includes("const root = normalisedRoot(input.root);\n  const observed = observeDirty(ports, request, root);")) E("RS-10", "the changed paths are read before the record has been found to be this run's");
  const recordAt = after(state, "record = request.workRecord();");
  const belongsAt = after(state, "read.belongsTo.projectId !== request.projectId");
  const observeAt = after(state, "observeDirty(ports, request");
  if (!(recordAt >= 0 && belongsAt > recordAt && observeAt > belongsAt)) E("RS-10", "git is asked what changed before the record is known to be this project's and this phase's");
  if (!state.includes("if (read.belongsTo.projectId !== request.projectId) return refusedRecord('RESUME_WORK_RECORD_NOT_THIS_PROJECT', 'it names another project');") || !state.includes("if (read.belongsTo.phaseId !== request.phaseId || !read.cutOff) return NOTHING;")) E("RS-10", "another project's record is used or is taken for no record, or another phase's is used");
  if (!state.includes("if (!record.ok) return refusedRecord('RESUME_WORK_RECORD_UNREADABLE',") || !state.includes("    return refusedRecord('RESUME_WORK_RECORD_UNREADABLE', 'it could not be read');") || !state.includes("if (!read.ok) return refusedRecord(read.code === 'RESUME_RECORD_NOT_PLAIN' ? 'RESUME_WORK_RECORD_NOT_PLAIN' : 'RESUME_WORK_RECORD_STATE_UNKNOWN',")) E("RS-10", "a work record that is corrupt, unreadable, not plain or of an unknown state is taken for an absent one, which is how a cut-off attempt is hidden by editing a file a worker can write");
  if (!state.includes("Fix: the owner replaces ${WORK_RECORD_REL} with a good copy, or deletes it, and COMMITS that change (the record is a committed file here, so restoring it from git brings the same bytes back), then runs again.") || state.includes("git checkout")) E("RS-10", "a refusal for a record that cannot be used names no fix, or sends the owner to restore the same bad committed bytes");
  if (!state.includes("if (record === null || typeof record !== 'object' || typeof (record as { ok?: unknown }).ok !== 'boolean') return refusedRecord('RESUME_WORK_RECORD_UNREADABLE', 'the reader gave no answer');")) E("RS-10", "a work record reader that gives no usable answer is a TypeError, or an absent record, instead of a refusal");
  if (!state.includes("if (record.value === null) return NOTHING;")) E("RS-10", "an absent record is not the one case that is let through");

  // RS-11: bounded before parsed, and capped.
  for (const pin of [
    "export const MAX_RESUME_FILE_BYTES = 65_536;",
    "export const MAX_RESUME_HASH_BYTES = 1_048_576;",
    "export const MAX_RESUME_HASH_BUDGET_BYTES = 33_554_432;",
    "export const MAX_RESUME_DIRTY_PATHS = 2_000;",
    "const MAX_FINDINGS_READ = 200;",
    "const MAX_CHECKS_READ = 200;",
    "const MAX_REFUSAL_PATHS_NAMED = 8;",
  ]) if (!state.includes(pin)) E("RS-11", `a bound moved or is gone: ${pin}`);
  if (!state.includes("if (stat.size > MAX_RESUME_FILE_BYTES) return { kind: 'problem', code: 'RESUME_FILE_TOO_LARGE' };")) E("RS-11", "a record file is read before its size is asked");
  const sizeAt = after(state, "if (stat.size > MAX_RESUME_FILE_BYTES)");
  const readAt = after(state, "const text = ports.fs.readText(`${root}/${rel}`);");
  if (!(sizeAt >= 0 && readAt > sizeAt)) E("RS-11", "a record file is read before its size is asked");
  if (!state.includes("if (stat.kind !== 'file') return { kind: 'problem', code: 'RESUME_FILE_NOT_REGULAR' };")) E("RS-11", "a record file that is not an ordinary file is read");
  if (!state.includes("if (own.size > MAX_RESUME_HASH_BYTES || own.size > budgetLeft) return { hash: null, note: 'too-large', spent: 0 };")) E("RS-11", "a changed file is hashed without a size bound or a budget");
  if (!state.includes("if (dirty.length > MAX_RESUME_DIRTY_PATHS) {")) E("RS-11", "a changed-path list is not capped");
  if (!state.includes("const hashed = hashOf(ports, root, verdict.path, budget);\n    budget -= hashed.spent;")) E("RS-11", "the hash budget is not spent by what was hashed, so every file may be read up to its own cap");
  if (!state.includes("let budget = MAX_RESUME_HASH_BUDGET_BYTES;")) E("RS-11", "the hash budget does not start at its bound");
  if (!state.includes("return result.stdout.length >= MAX_GIT_OUTPUT_BYTES - OUTPUT_BOUND_SLACK ? 'too-much-output' : 'unreadable';") || !state.includes("const OUTPUT_BOUND_SLACK = 4096;") || !state.includes("if (dirty === 'too-much-output') return { ok: false, outcome: refusedTooMany(")) E("RS-11", "a list past the reader's bound is reported as a git that does not run");
  if (!state.includes("and adds an ignore rule for generated trees (for example an un-ignored node_modules)")) E("RS-11", "a too-long list names no fix that can be applied");
  if (!state.includes("(object['findings'] as unknown[]).slice(0, MAX_FINDINGS_READ)") || !state.includes("(object['checks'] as unknown[]).slice(0, MAX_CHECKS_READ)")) E("RS-11", "a findings or checks list is read without a cap");
  for (const pin of ["export const MAX_CONTEXT_RESUME_DIRTY_LISTED = 40;", "export const MAX_CONTEXT_RESUME_FINDINGS_LISTED = 30;", "export const MAX_CONTEXT_RESUME_CHECKS_LISTED = 40;", "export const MAX_CONTEXT_RESUME_FINDING_CHARS = 300;"]) {
    if (!render.includes(pin)) E("RS-11", `a render bound moved or is gone: ${pin}`);
  }
  if (!paths.includes("export const MAX_CONTEXT_RESUME_PATH_CHARS = 512;") || !paths.includes("if (path === '' || path.length > MAX_CONTEXT_RESUME_PATH_CHARS) return 'odd-form';")) E("RS-11", "a path is judged before its length is held");
  if (!record.includes("const MAX_IDENTITY_CHARS = 200;")) E("RS-11", "a project or phase name is not bounded");
  for (const rel of [...CORE_FILES, ...AGENT_FILES]) {
    const text = code(raw[rel]);
    // The one open-ended repeat allowed is a run of spaces collapsing to one: a single class, so it cannot backtrack.
    if (count(text, /\{\d+,\}/g) > count(text, /\/ \{2,\}\/g/g)) E("RS-11", `${rel} has an unbounded repeat`);
  }

  // RS-12: origin, ASCII, tracked, and core is browser-safe.
  for (const rel of NEW_FILES) {
    if (!raw[rel].startsWith("// Origin: original ProjectOS code\n")) E("RS-12", `${rel} does not open with its statement of origin`);
    const hidden = NOT_ASCII.exec(raw[rel]);
    if (hidden !== null) E("RS-12", `${rel} holds a raw U+${hidden[0].codePointAt(0).toString(16).toUpperCase()}; write it as an escape`);
    if (raw[rel].split("\n").length > 800) E("RS-12", `${rel} is over 800 lines`);
  }
  const CORE_IMPORTS = {
    [PATHS]: [],
    [RECORD]: ["../search/citation.js"],
    [RENDER]: ["../execution/evidence.js", "../memory/threatScan.js", "./resumeRecord.js"],
  };
  for (const rel of CORE_FILES) {
    const text = code(raw[rel]);
    for (const [, specifier] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) if (!CORE_IMPORTS[rel].includes(specifier)) E("RS-12", `${rel} imports ${specifier}`);
    if (/from\s+['"]node:/.test(text) || /\b(?:process\.|Date\.now|new Date|Math\.random|require\()|\bBuffer\b/.test(text)) E("RS-12", `${rel} reaches outside itself, and core loads in a webview`);
  }
  const indexLines = raw[CORE_INDEX].split("\n");
  for (const rel of CORE_FILES) {
    const name = path.posix.basename(rel).replace(/\.ts$/, ".js");
    if (!indexLines.includes(`export * from './context/${name}';`)) E("RS-12", `the core barrel does not export ${name}`);
  }
  for (const rel of [...CORE_FILES, ...AGENT_FILES, ...OWN_RULE_FILES]) {
    for (const [, name] of code(raw[rel]).matchAll(/export (?:const|function|interface|type) ([A-Za-z0-9_]+)/g)) {
      if (!/^(?:contextResume|ContextResume|CONTEXT_RESUME|MAX_CONTEXT_RESUME|renderContextResume|classifyContextResume|resumeReadsOf$|resumeLoopRecordsOf$|resumeNodeLinkCount$|ResumeLoopRecords$|RESUME_DECISION_RECORD_NAME$|MAX_RESUME_)/.test(name)) E("RS-12", `${rel} exports ${name}, which is not prefixed with this module's name`);
    }
  }
  if (tracked !== null) for (const rel of [...NEW_FILES, ...Object.keys(TESTS), FINISH, "projectos/validators/val-projectos-resume1a.cjs"]) {
    if (!tracked.has(rel)) E("RS-12", `${rel} is not tracked by git`);
  }

  // RS-13: registered once, immediately before the connector contract and after the context manager, in both lists, alike.
  const lists = [[VA, "validate-all"], [CR, "cached-runner"]].map(([rel, name]) => [name, modulesOf(raw[rel])]);
  for (const [name, list] of lists) {
    if (list === null) E("RS-13", `${name} has no MODULES list`);
    else {
      const live = list.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
      const names = [...live.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      const at = names.indexOf(THIS_VALIDATOR);
      if (names.filter((entry) => entry === THIS_VALIDATOR).length !== 1) E("RS-13", `${THIS_VALIDATOR} is not in ${name} exactly once`);
      else {
        if (names[at + 1] !== CONNECTOR_VALIDATOR) E("RS-13", `${THIS_VALIDATOR} is not immediately before ${CONNECTOR_VALIDATOR} in ${name}`);
        // The final order is context-manager1a, skills-adopt1a, this, connector-contract1a; until the sibling is merged the branch has only the first.
        if (names[at - 1] !== CONTEXT_MANAGER_VALIDATOR && names[at - 1] !== SKILLS_ADOPT_VALIDATOR) E("RS-13", `${THIS_VALIDATOR} does not come immediately after ${CONTEXT_MANAGER_VALIDATOR} or ${SKILLS_ADOPT_VALIDATOR} in ${name}`);
      }
    }
  }
  const [va, cr] = lists.map(([, list]) => (list === null ? null : [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]).join("\n")));
  if (va !== null && cr !== null && va !== cr) E("RS-13", "validate-all and the cached runner do not list the same validators in the same order");

  // RS-14: the proofs are there, and they run.
  for (const [rel, titles] of Object.entries(TESTS)) {
    const text = raw[rel];
    if (typeof text !== "string") {
      E("RS-14", `${rel} is missing`);
      continue;
    }
    if (/\b(?:it|test|describe)\.(?:skip|only|todo)\b|\bxit\(|\bxdescribe\(/.test(text)) E("RS-14", `${rel} skips or isolates a proof`);
    const live = withoutComments(text);
    for (const title of titles) {
      const at = live.indexOf(title);
      if (at < 0) {
        E("RS-14", `${rel} no longer proves: ${title}`);
        continue;
      }
      // A proof with no assertion proves nothing: the test body that follows the title, up to the next test, holds an expect.
      if (rel.endsWith(".test.ts") && !/describe\(['"`]$/.test(live.slice(Math.max(0, at - 12), at))) {
        const rest = live.slice(at + title.length);
        const next = rest.search(/\n  it(?:\.each\(|\()/);
        if (!/\bexpect\(/.test(next < 0 ? rest : rest.slice(0, next))) E("RS-14", `${rel} has the title but no assertion in its body: ${title}`);
      }
    }
  }
  if (typeof raw[FINISH] !== "string") E("RS-14", `${FINISH} is missing`);
  else for (const phrase of ["Existing code found", "Converge", "**PROTECTED files.**", "git diff --stat", "Residuals"]) if (!raw[FINISH].includes(phrase)) E("RS-14", `${FINISH} lacks the section or statement: ${phrase}`);
  return errors;
}

// ---------------------------------------------------------------------------------------------------------
// Mutations: each is a change to the real source that makes the wrong thing true, killed by its own rule.
// ---------------------------------------------------------------------------------------------------------

const M = (name, rule, rel, from, to, also = []) => ({ name, rule, rel, from, to, also });
const U = (name, rule, untracked) => ({ name, rule, untracked, also: [] });

const MUTATIONS = [
  // RS-1
  M("a-free-text-field-is-read-for-the-worker", "RS-1", RECORD, "const session = dataField(raw, 'sessionId');", "const session = dataField(raw, 'sessionId');\n  const detail = dataField(raw, 'lastStopDetail');\n  void detail;"),
  M("the-next-action-is-read-for-the-worker", "RS-1", RENDER, "    'Nothing the record said in words is repeated here.',", "    'Nothing the record said in words is repeated here.',\n    `- next: ${(fields as unknown as { nextCandidateAction: string }).nextCandidateAction}`,"),
  M("a-stop-code-outside-the-list-is-shown", "RS-1", RECORD, "if (typeof stop === 'string' && vocabulary.stopCodes.includes(stop)) lastStopCode = stop;", "if (typeof stop === 'string') lastStopCode = stop;"),
  M("a-state-outside-the-list-is-accepted", "RS-1", RECORD, "if (typeof state !== 'string' || !vocabulary.states.includes(state)) return { ok: false, code: 'RESUME_RECORD_STATE_UNKNOWN' };", "if (typeof state !== 'string') return { ok: false, code: 'RESUME_RECORD_STATE_UNKNOWN' };"),
  M("a-subject-commit-that-is-not-a-commit-is-shown", "RS-1", RECORD, "if (isCommitName(commit)) subjectCommit = commit;", "if (typeof commit === 'string') subjectCommit = commit;"),
  M("a-session-that-is-not-a-safe-name-is-used", "RS-1", RECORD, "if (typeof session === 'string' && isMintedSession(session, vocabulary.phaseId)) sessionId = session;","if (typeof session === 'string') sessionId = session;"),
  M("a-session-of-another-phase-is-used", "RS-1", RECORD, "session.startsWith(`${phaseId}-`) && ", ""),
  M("a-session-tail-is-free-text", "RS-1", RECORD, "const SESSION_TAIL = /^[0-9a-f]{12}(?:-[0-9a-f]{1,16})?$/;", "const SESSION_TAIL = /^[0-9a-z-]{12,40}$/;"),
  M("a-session-tail-is-unbounded", "RS-1", RECORD, "const SESSION_TAIL = /^[0-9a-f]{12}(?:-[0-9a-f]{1,16})?$/;", "const SESSION_TAIL = /^[0-9a-f]{12}(?:-[0-9a-f]{1,16})?.*$/;"),
  M("a-cut-off-attempt-session-that-is-this-runs-own-is-read", "RS-1", STATE, "if (fields.sessionId !== input.sessionId) attemptRecords(", "if (fields.sessionId !== null) attemptRecords("),
  M("an-evidence-record-of-another-phase-is-shown", "RS-1", STATE, "else if (object['phaseId'] !== undefined && object['phaseId'] !== phaseId) failures.push(failure(evidenceId, 'RESUME_SESSION_NOT_THIS_PHASE'));\n", ""),
  M("a-session-name-may-climb", "RS-1", RECORD, "const SESSION_NAME = /^[A-Za-z0-9_.-]{1,64}$/;", "const SESSION_NAME = /^[A-Za-z0-9_./-]{1,64}$/;"),
  M("a-record-with-a-getter-is-read", "RS-1", RECORD, "if (descriptor === undefined || !('value' in descriptor)) return false;", "if (descriptor === undefined) return false;"),
  M("a-record-that-inherits-is-read", "RS-1", RECORD, "if (prototype !== Object.prototype && prototype !== null) return false;", ""),
  M("a-record-that-is-not-plain-is-read", "RS-1", RECORD, "if (!isPlainData(raw)) return { ok: false, code: 'RESUME_RECORD_NOT_PLAIN' };", GONE),
  M("the-vocabulary-is-a-copy", "RS-1", STATE, "stopCodes: Object.keys(STOP_CODES),", "stopCodes: ['WORKER_TIMED_OUT', 'OWNER_GATE'],"),
  M("the-record-is-read-without-the-closed-reader", "RS-1", STATE, "const read = contextResumeFieldsOf(record.value, vocabularyOf(request.phaseId));", "const read = { ok: true as const, fields: record.value as never, belongsTo: { projectId: request.projectId, phaseId: request.phaseId }, cutOff: true, dropped: [] as never[] };"),
  M("the-state-line-is-the-records-own-words", "RS-1", RENDER, "`- state: ${fields.state}`,", "`- state: ${fields.state} ${(fields as unknown as { lastStopDetail: string }).lastStopDetail}`,"),
  // RS-2
  M("the-worker-label-is-gone", "RS-2", RENDER, "export const CONTEXT_RESUME_WORKER_NOTE = 'worker-authored, from a cut-off attempt';", "export const CONTEXT_RESUME_WORKER_NOTE = 'from an earlier attempt';"),
  M("the-label-is-not-put-in-the-header", "RS-2", MANAGER, "    ...(read.note === undefined ? [] : [read.note]),\n", GONE),
  M("findings-claim-to-be-a-committed-decision", "RS-2", STATE, "workerRead(findingsId, 'finding',", "workerRead(findingsId, 'committed-decision',"),
  M("evidence-claims-to-be-approved-memory", "RS-2", STATE, "workerRead(evidenceId, 'execution-record',", "workerRead(evidenceId, 'approved-memory',"),
  M("a-resumed-item-carries-a-proof", "RS-2", STATE, "return { id, kind, text, proof: null, source: 'working-tree', freshness, note: CONTEXT_RESUME_WORKER_NOTE };", "return { id, kind, text, proof: {} as never, source: 'working-tree', freshness, note: CONTEXT_RESUME_WORKER_NOTE };"),
  M("the-label-is-not-on-the-worker-read", "RS-2", STATE, "source: 'working-tree', freshness, note: CONTEXT_RESUME_WORKER_NOTE };", "source: 'working-tree', freshness };"),
  M("the-attempt-fields-claim-a-plan-memory-kind", "RS-2", STATE, "      id: 'resume:cut-off-attempt',\n      kind: 'execution-record',", "      id: 'resume:cut-off-attempt',\n      kind: 'plan-memory',"),
  M("resumed-items-skip-the-ranking", "RS-2", MANAGER, "rankedMetas(ports, [...retrieval.reads, ...resumed.reads], head,", "rankedMetas(ports, retrieval.reads, head,"),
  M("a-resumed-item-is-handed-to-the-decisions", "RS-2", MANAGER, "const decisions = decisionsOf(ports, retrieval.decisions);", "const decisions = decisionsOf(ports, [...retrieval.decisions, ...(resumed.reads as never[])]);"),
  // RS-3
  M("a-path-outside-the-grant-is-granted", "RS-3", PATHS, "return { kind: 'refused', path, reason: 'outside-write-paths' };", "return { kind: 'granted', path };"),
  M("a-case-variant-is-granted", "RS-3", PATHS, "if (grants.some((pattern) => grantCovers(path, pattern, true))) return { kind: 'refused', path, reason: 'case-variant' };", "if (grants.some((pattern) => grantCovers(path, pattern, true))) return { kind: 'granted', path };"),
  M("a-granted-path-is-judged-case-folded", "RS-3", PATHS, "if (grants.some((pattern) => grantCovers(path, pattern, false))) return { kind: 'granted', path };", "if (grants.some((pattern) => grantCovers(path, pattern, true))) return { kind: 'granted', path };", ["RS-6"]),
  M("a-climb-is-not-refused", "RS-3", PATHS, "  if (segments.includes('..')) return 'traversal';\n", GONE),
  M("an-absolute-path-is-not-refused", "RS-3", PATHS, "if (/^[\\\\/]/.test(path) || /^[A-Za-z]:/.test(path)) return 'absolute';", "if (/^[\\\\/]/.test(path)) return 'absolute';"),
  M("a-stream-or-short-name-is-accepted", "RS-3", PATHS, "if (path.includes('\\\\') || path.includes(':') || path.includes('~') || INVISIBLE.test(path.replace(/ /g, ''))) return 'odd-form';", "if (path.includes('\\\\')) return 'odd-form';"),
  M("a-trailing-dot-is-accepted", "RS-3", PATHS, "    if (/[. ]$/.test(segment)) return 'odd-form';\n", GONE),
  M("a-dot-segment-is-accepted", "RS-3", PATHS, "if (segment === '' || segment === '.') return 'odd-form';", "if (segment === '') return 'odd-form';"),
  M("width-is-not-folded", "RS-3", PATHS, "const canonical = (text: string): string => text.normalize('NFKC').toLowerCase();", "const canonical = (text: string): string => text.toLowerCase();"),
  M("a-directory-grant-covers-its-siblings", "RS-3", PATHS, "return target.startsWith(`${same(pattern.slice(0, -BENEATH.length))}/`);", "return target.startsWith(same(pattern.slice(0, -BENEATH.length)));"),
  M("the-shape-is-judged-after-the-grant", "RS-3", PATHS, "const shape = shapeReason(path);\n  if (shape !== null) return { kind: 'refused', path, reason: shape };\n  const grants", "const grants"),
  M("a-refused-path-is-not-a-problem", "RS-3", STATE, "    if (verdict.kind === 'refused') {\n      problems.push({ path: verdict.path, reason: verdict.reason });\n      continue;\n    }", "    if (verdict.kind === 'refused') {\n      continue;\n    }"),
  M("the-rules-take-another-grant", "RS-3", STATE, "const rules = { writePaths: request.writePaths, phaseId: request.phaseId, workRecordPath: WORK_RECORD_REL, loopRecords: request.loopRecords };", "const rules = { writePaths: ['./'], phaseId: request.phaseId, workRecordPath: WORK_RECORD_REL };", ["RS-7"]),
  M("a-problem-does-not-refuse", "RS-3", STATE, "return problems.length > 0 ? { ok: false, outcome: refusalOf(problems) } : { ok: true, entries };", "return { ok: true, entries };"),
  M("the-manager-goes-on-after-a-refusal", "RS-3", MANAGER, "  if (resumed.kind === 'refused') return refuse(resumed.code, resumed.message, key);\n", GONE),
  M("a-listed-path-carries-no-hash", "RS-3", STATE, "return { hash: `sha256:${sha256Hex(text)}`, note: 'hashed', spent: own.size };", "return { hash: null, note: 'hashed', spent: own.size };"),
  M("a-refusal-names-no-fix", "RS-3", STATE, "Nothing was sent and no worker was started. Fix: ${reasons.map((reason) => REASON_FIX[reason]).join('; ')}; then runs again.", "Nothing was sent and no worker was started. ${reasons.join('; ')}."),
  M("a-run-whose-changes-cannot-be-listed-goes-on", "RS-3", STATE, "if (dirty === 'unreadable') return { ok: false, outcome: refusedUnobservable('git could not list the changed paths') };", "if (dirty === null) return { ok: true, entries: [] };"),
  M("a-link-is-accepted", "RS-3", STATE, "  if (own.kind === 'link') return 'link';\n", GONE),
  M("a-link-above-a-path-is-accepted", "RS-3", STATE, "    if (isLink) return 'link';\n", GONE),
  M("an-attempt-record-is-read-through-a-link", "RS-3", STATE, "    if (onDisk === 'link' || onDisk === 'link-count-unobserved') return { kind: 'problem', code: 'RESUME_FILE_NOT_REGULAR' };\n", GONE),
  M("an-attempt-record-with-no-countable-names-is-read", "RS-3", STATE, "if (onDisk === 'link' || onDisk === 'link-count-unobserved') return", "if (onDisk === 'link') return"),
  M("a-directory-above-a-path-is-not-asked", "RS-3", STATE, "isLink = ports.fs.stat(`${root}/${prefix}`)?.kind === 'link';", "isLink = false;"),
  M("a-directory-entry-is-listed-as-a-file", "RS-3", STATE, "  if (own.kind !== 'file') return 'not-regular';\n", GONE),
  M("a-file-with-a-second-name-is-accepted", "RS-3", STATE, "return names > 1 ? 'link' : null;", "return null;"),
  M("a-link-count-that-cannot-be-read-is-accepted", "RS-3", STATE, "  if (names === null) return 'link-count-unobserved';\n", GONE),
  M("a-link-count-that-cannot-be-read-is-one", "RS-3", STATE, "return typeof count === 'number' && Number.isSafeInteger(count) && count >= 1 ? count : null;", "return typeof count === 'number' && Number.isSafeInteger(count) && count >= 1 ? count : 1;"),
  M("a-throwing-link-count-port-is-one", "RS-3", STATE, "  } catch {\n    return null;\n  }\n}\n\ninterface Hashed", "  } catch {\n    return 1;\n  }\n}\n\ninterface Hashed"),
  M("a-missing-link-count-port-is-not-a-missing-port", "RS-3", PORTS, "  if (!isFunction(ports.linkCount)) return 'linkCount';\n", GONE),
  M("the-link-count-port-is-optional-again", "RS-3", PORTS, "readonly linkCount: (path: string) => number | null;", "readonly linkCount?: (path: string) => number | null;"),
  M("an-unobserved-link-count-has-no-code-of-its-own", "RS-3", STATE, "'link-count-unobserved': 'RESUME_LINK_COUNT_UNOBSERVED',", "'link-count-unobserved': 'RESUME_DIRTY_PATH_LINK',"),
  M("a-refusal-names-no-path", "RS-3", STATE, "${contextResumeDisplayName(problem.path)} (${REASON_WORDS[problem.reason]})", "${REASON_WORDS[problem.reason]}"),
  M("a-refusal-names-the-path-raw", "RS-3", STATE, "${contextResumeDisplayName(problem.path)} (${REASON_WORDS[problem.reason]})", "${problem.path} (${REASON_WORDS[problem.reason]})"),
  M("the-real-ports-give-no-link-count", "RS-3", PORTS, "    linkCount: resumeNodeLinkCount,\n", GONE),
  M("the-link-count-port-writes", "RS-3", NODE_PORT, "return lstatSync(path).nlink;", "writeFileSync(path, ''); return lstatSync(path).nlink;"),
  M("the-file-system-is-not-asked-what-a-path-is", "RS-3", STATE, "const onDisk = onDiskProblem(ports, root, verdict.path, parents);\n    if (onDisk !== null) {", "const onDisk = null as DirtyReason | null;\n    if (onDisk !== null) {"),
  // RS-4
  M("git-is-not-asked-for-every-file", "RS-4", STATE, "['status', '--porcelain', '-z', '--untracked-files=all']", "['status', '--porcelain', '-z']"),
  M("the-status-is-not-null-separated", "RS-4", STATE, "['status', '--porcelain', '-z', '--untracked-files=all']", "['status', '--porcelain', '--untracked-files=all']"),
  M("the-paths-come-from-the-evidence", "RS-4", STATE, "const dirty = dirtyPathsOf(ports);", "const dirty = dirtyPathsOf(ports) ?? [];\n  const claimed = ((request as unknown as { evidence?: { changedFiles: string[] } }).evidence?.changedFiles ?? []);\n  dirty.push(...claimed);"),
  M("the-evidence-lists-its-own-changed-files", "RS-4", STATE, "changedCount: Array.isArray(object['changedFiles']) ? (object['changedFiles'] as unknown[]).length : 0,", "changedCount: 0, changedFiles: object['changedFiles'] as never,"),
  M("the-dirty-list-claims-it-was-not-observed-by-the-loop", "RS-4", STATE, "source: 'loop-observed', freshness: null, note: CONTEXT_RESUME_OBSERVED_NOTE", "source: 'working-tree', freshness: null, note: CONTEXT_RESUME_WORKER_NOTE", ["RS-9"]),
  M("the-hash-is-not-of-the-file-read", "RS-4", STATE, "text = ports.fs.readText(`${root}/${path}`);", "text = path;"),
  // RS-5
  M("freshness-is-always-fresh", "RS-5", STATE, "const freshnessOf = (builtAt: string | null, head: string): string => citationFreshnessMarkOf(citationFreshnessOf(builtAt, head));", "const freshnessOf = (_builtAt: string | null, _head: string): string => 'fresh';"),
  M("freshness-is-judged-against-the-record-commit", "RS-5", STATE, "freshnessOf(fields.subjectCommit, head)", "freshnessOf(fields.subjectCommit, fields.subjectCommit ?? head)"),
  M("the-evidence-is-judged-at-the-wrong-commit", "RS-5", STATE, "freshnessOf(summary.currentHead ?? summary.baseHead ?? fields.subjectCommit, head)", "freshnessOf(head, head)"),
  M("the-fields-are-not-judged-against-the-head-now", "RS-5", STATE, "renderContextResumeFields(fields, freshnessOf(fields.subjectCommit, input.head))", "renderContextResumeFields(fields, 'fresh')"),
  M("the-head-is-not-the-one-read-now", "RS-5", MANAGER, "const resumed = resumeReadsOf(ports, { resume: request.resume, root: request.root, head, sessionId: request.sessionId });", "const resumed = resumeReadsOf(ports, { resume: request.resume, root: request.root, head: request.nowIso, sessionId: request.sessionId });"),
  // RS-6
  M("a-timed-out-attempt-is-not-cut-off", "RS-6", STATE, "inactiveStates: ['QUEUED', 'COMPLETE', 'AWAITING_GATE', 'GATE_APPROVED', 'WAITING_OWNER'] as readonly string[],", "inactiveStates: ['QUEUED', 'COMPLETE', 'AWAITING_GATE', 'GATE_APPROVED', 'WAITING_OWNER', 'BLOCKED'] as readonly string[],"),
  M("a-gate-wait-is-a-cut-off-attempt", "RS-6", STATE, "inactiveStates: ['QUEUED', 'COMPLETE', 'AWAITING_GATE', 'GATE_APPROVED', 'WAITING_OWNER'] as readonly string[],", "inactiveStates: ['QUEUED', 'COMPLETE'] as readonly string[],"),
  M("a-never-started-attempt-is-resumed", "RS-6", STATE, "|| !read.cutOff) return NOTHING;", ") return NOTHING;", ["RS-10"]),
  M("the-timeout-stop-is-not-in-the-closed-list", "RS-6", STATE, "  WORKER_TIMED_OUT: true,\n", GONE),
  M("a-context-file-a-killed-run-left-is-refused", "RS-6", PATHS, "{1,64}\\.context\\.md$/;", "{1,64}\\.contextual\\.md$/;"),
  M("a-context-stem-longer-than-the-sweep-takes-is-a-record", "RS-6", PATHS, "{1,64}\\.context\\.md$/;", "{1,200}\\.context\\.md$/;"),
  M("an-evidence-record-the-loop-wrote-is-refused", "RS-6", PATHS, "(?:brief|session|evidence|invocation|reviewer)", "(?:brief|session|invocation|reviewer)"),
  M("a-session-record-the-loop-wrote-is-refused", "RS-6", PATHS, "(?:brief|session|evidence|invocation|reviewer)", "(?:brief|evidence|invocation|reviewer)"),
  M("the-workers-effects-record-is-called-the-loops", "RS-6", PATHS, "(?:brief|session|evidence|invocation|reviewer)", "(?:brief|session|evidence|invocation|reviewer|effects)"),
  M("the-workers-findings-record-is-called-the-loops", "RS-6", PATHS, "(?:brief|session|evidence|invocation|reviewer)", "(?:brief|session|evidence|invocation|reviewer|findings)"),
  M("the-workers-records-are-refused-as-dirty", "RS-6", PATHS, "  if (EXECUTION_WORKER_RECORD.test(path)) return { kind: 'worker-record', path };\n", GONE),
  M("any-projectops-path-is-a-loop-record", "RS-6", PATHS, "const EXECUTION_LOOP_RECORD = /^\\.projectops\\/execution\\/[A-Za-z0-9_.-]{1,200}\\.(?:brief", "const EXECUTION_LOOP_RECORD = /^\\.projectops\\/[A-Za-z0-9_./-]{1,200}\\.(?:brief"),
  M("the-plan-state-file-is-refused-as-a-dirty-path", "RS-6", PATHS, "  if (rules.loopRecords.paths.some((exact) => typeof exact === 'string' && exact !== '' && path === exact)) return true;\n", GONE),
  M("a-nested-gatekeeper-path-is-a-record", "RS-6", PATHS, "rest.length <= MAX_LOOP_RECORD_NAME_CHARS && !rest.includes('/') && name.test(rest)", "rest.length <= MAX_LOOP_RECORD_NAME_CHARS && name.test(rest)"),
  M("a-gatekeeper-folder-file-is-refused", "RS-6", PATHS, "rest.length <= MAX_LOOP_RECORD_NAME_CHARS && !rest.includes('/') && name.test(rest)", "false"),
  M("the-state-tail-is-not-handed-over", "RS-6", LOOP_RECORDS, "paths: [GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL, ...programmeStateTailPaths(context)],", "paths: [GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL],"),
  M("the-gatekeeper-ledger-is-not-handed-over", "RS-6", LOOP_RECORDS, "paths: [GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL, ...programmeStateTailPaths(context)],", "paths: [GATEKEEPER_THREAD_REL, ...programmeStateTailPaths(context)],"),
  M("the-decision-name-shape-drifts", "RS-6", LOOP_RECORDS, "{4,128}\\.json$/;", "{4,256}\\.json$/;"),
  M("a-loop-record-path-is-spelled-in-the-set", "RS-6", LOOP_RECORDS, "export interface ResumeLoopRecords {", "const SPELLED = '.projectops/gatekeeper-ledger.json';\nexport interface ResumeLoopRecords {"),
  M("run-ts-folds-another-execution-record", "RS-6", RUN_TS, "(?:brief|session|evidence|invocation)", "(?:brief|session|evidence|invocation|effects)"),
  M("run-ts-folds-another-decision-shape", "RS-6", RUN_TS, "inFlat(GATEKEEPER_DECISIONS_REL, /^[A-Za-z0-9_-]{4,128}\\.json$/)", "inFlat(GATEKEEPER_DECISIONS_REL, /^[A-Za-z0-9_-]{4,256}\\.json$/)"),
  M("run-ts-folds-another-fixed-path", "RS-6", RUN_TS, "[WORK_RECORD_REL, GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL,", "[WORK_RECORD_REL, GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL, '.projectops/extra.json',"),
  M("the-runner-builds-no-loop-record-set", "RS-6", RUNNER, "import { resumeLoopRecordsOf } from '../context/resumeLoopRecords.js';\n", GONE),
  M("the-work-record-is-refused-as-a-dirty-path", "RS-6", PATHS, "  if (path === rules.workRecordPath) return true;\n", GONE),
  M("this-phases-own-record-is-refused-as-a-dirty-path", "RS-6", PATHS, "  if (SAFE_NAME.test(rules.phaseId) && path === `.projectops/phases/${rules.phaseId}.json`) return true;\n", GONE),
  M("a-run-record-is-judged-after-the-grant-refuses", "RS-6", PATHS, "  if (isLoopRunRecord(path, rules)) return { kind: 'run-record', path };\n", GONE),
  M("the-runner-refuses-a-recorded-timeout", "RS-6", RUNNER, "  const contextEnvelope = options.runEnvelope ?? null;", "  const contextEnvelope = options.runEnvelope ?? null;\n  if (readWorkRecord(sys, root).ok) return refused(['REFUSED (WORKER_TIMED_OUT): a recorded timeout is not retried']);"),
  // RS-7
  M("the-record-location-is-spelled-here", "RS-7", STATE, "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });", "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });\nconst RECORD_AT = '.projectops/work.v1.json';\nvoid RECORD_AT;"),
  M("resume-imports-the-closure-authority", "RS-7", STATE, "import { porcelainZPaths } from './contextStoreGuard.js';", "import { porcelainZPaths } from './contextStoreGuard.js';\nimport { checkClosureThing } from '../commands/closure.js';\nvoid checkClosureThing;"),
  M("resume-selects-a-phase", "RS-7", STATE, "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });", "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });\nconst pick = (): void => { selectNextPhase(); };\nvoid pick;\ndeclare function selectNextPhase(): void;"),
  M("resume-advances-the-record", "RS-7", STATE, "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });", "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });\ndeclare function advanceWork(): void;\nvoid advanceWork;"),
  M("the-record-reads-its-own-gate-decision-here", "RS-7", STATE, "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });", "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });\nconst gateAt = '.projectops/closure/decisions';\nvoid gateAt;"),
  M("the-record-widens-the-grant", "RS-7", STATE, "const rules = { writePaths: request.writePaths, phaseId: request.phaseId, workRecordPath: WORK_RECORD_REL, loopRecords: request.loopRecords };", "const rules = { writePaths: [...request.writePaths, 'src/'], phaseId: request.phaseId, workRecordPath: WORK_RECORD_REL };", ["RS-3"]),
  M("the-record-is-read-without-the-port", "RS-7", STATE, "record = request.workRecord();", "record = { ok: true, value: null };", ["RS-10"]),
  M("the-runner-hands-another-grant", "RS-7", RUNNER, "resume: { phaseId, projectId: context.projectId, writePaths: writeGrant.paths, loopRecords: resumeLoopRecordsOf(context), workRecord: () => readWorkRecord(sys, root) },", "resume: { phaseId, projectId: context.projectId, writePaths: ['./'], workRecord: () => readWorkRecord(sys, root) },"),
  M("the-runner-writes-the-record", "RS-7", RUNNER, "  const contextEnvelope = options.runEnvelope ?? null;", "  const contextEnvelope = options.runEnvelope ?? null;\n  writeWorkRecord(sys, root, {} as never);"),
  M("run-ts-gains-a-resume-call", "RS-7", RUN_TS, "export function isFoldableRunRecord(", "export const resumeNow = (): string => contextResumeFieldsOf.name;\nexport function isFoldableRunRecord("),
  M("selection-knows-about-resume", "RS-7", SELECTION, "export function selectNextPhase(", "const resumeAware = 'resumeState';\nvoid resumeAware;\nexport function selectNextPhase("),
  M("the-runner-joins-resume-to-a-selection", "RS-7", RUNNER, "  const contextEnvelope = options.runEnvelope ?? null;", "  const contextEnvelope = options.runEnvelope ?? null;\n  const resumeSelection = selectNextPhase(sys, root, context);\n  void resumeSelection;"),
  M("the-runner-calls-the-resume-reader", "RS-7", RUNNER, "  const contextEnvelope = options.runEnvelope ?? null;", "  const contextEnvelope = options.runEnvelope ?? null;\n  resumeReadsOf({} as never, {} as never);"),
  // RS-8
  M("resume-calls-a-model", "RS-8", STATE, "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });", "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });\ndeclare function fetch(url: string): void;\nconst ask = (): void => fetch('https://x');\nvoid ask;"),
  M("resume-writes-a-file", "RS-8", STATE, "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });", "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });\ndeclare const sys: { writeText(p: string, t: string): void };\nconst leave = (): void => sys.writeText('x', 'y');\nvoid leave;"),
  M("a-read-skips-the-gate", "RS-8", MANAGER, "const gate = gateContextItemText(read.text, ports.secretScreen);", "const gate = { ok: true as const, text: read.text, contentHash: 'sha256:' + '0'.repeat(64), bytes: read.text.length, truncated: false };"),
  M("a-resumed-item-is-not-a-fenced-turn", "RS-8", MANAGER, "text: renderedTurnText(turn)", "text: turn.text"),
  M("a-resumed-item-is-a-trusted-turn", "RS-8", MANAGER, "role: 'tool',\n      origin: 'memory',", "role: 'tool',\n      origin: 'tool',"),
  M("resume-builds-the-thread-itself", "RS-8", STATE, "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });", "const failure = (id: string, code: string): ContextFailure => ({ id, code, blocking: false });\ndeclare function appendContextTurn(): void;\nvoid appendContextTurn;"),
  M("a-changed-path-name-is-shown-raw-in-the-listing", "RS-8", RENDER, "const shown = contextResumeDisplayName(entry.path);", "const shown = entry.path;"),
  M("the-path-hash-note-is-gone", "RS-8", RENDER, "` [name simplified; path hash ${sha256Hex(entry.path).slice(0, 12)}]`", "''"),
  M("a-name-is-not-bounded-before-it-is-read", "RS-8", RENDER, "const raw = (typeof text === 'string' ? text : '').slice(0, max * 4);\n  const cleaned", "const raw = (typeof text === 'string' ? text : '');\n  const cleaned"),
  M("a-name-that-reads-as-an-instruction-is-shown", "RS-8", RENDER, "return `name-${sha256Hex(raw).slice(0, 12)}`;", "return raw;"),
  M("a-workers-words-keep-their-control-characters", "RS-8", RENDER, "return raw.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+/gu, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);", "return raw.trim().slice(0, max);"),
  M("a-dropped-field-is-silent", "RS-8", STATE, "const failures: ContextFailure[] = read.dropped.map((code) => failure('resume:work-record', code));", "const failures: ContextFailure[] = [];"),
  // RS-9
  M("the-ledger-has-no-source-for-a-workers-file", "RS-9", LEDGER, "['committed', 'index', 'approved-decision', 'working-tree', 'loop-observed']", "['committed', 'index', 'approved-decision']"),
  M("a-read-cannot-say-it-is-from-the-working-tree", "RS-9", RETRIEVAL, "readonly source: 'committed' | 'index' | 'working-tree' | 'loop-observed';", "readonly source: 'committed' | 'index';"),
  M("a-workers-file-says-it-is-committed", "RS-9", STATE, "return { id, kind, text, proof: null, source: 'working-tree', freshness, note: CONTEXT_RESUME_WORKER_NOTE };", "return { id, kind, text, proof: null, source: 'committed', freshness, note: CONTEXT_RESUME_WORKER_NOTE };", ["RS-2"]),
  M("the-findings-are-not-named-by-their-path", "RS-9", STATE, "const findingsId = `.projectops/execution/${fields.sessionId}.findings.json`;", "const findingsId = 'resume:findings';"),
  M("the-ledger-item-drops-the-source", "RS-9", MANAGER, "    source: read.source,\n", "    source: 'committed' as const,\n"),
  M("the-handle-does-not-pass-the-request-on", "RS-9", RUN_CONTEXT, "...(input.resume === undefined ? {} : { resume: input.resume }) };", "};"),
  // RS-10
  M("resume-is-read-before-the-checkout-is-judged", "RS-10", MANAGER, "  const head = headOf(ports);", "  const early = resumeReadsOf(ports, { resume: request.resume, root: request.root, head: '', sessionId: request.sessionId });\n  void early;\n  const head = headOf(ports);", ["RS-7"]),
  M("resume-is-read-before-the-decisions-are-judged", "RS-10", MANAGER, "  const retrieval = sourcesOf(ports, key, request);", "  const early = resumeReadsOf(ports, { resume: request.resume, root: request.root, head, sessionId: request.sessionId });\n  void early;\n  const retrieval = sourcesOf(ports, key, request);", ["RS-7"]),
  M("git-is-asked-before-the-record-is-known-to-be-this-runs", "RS-10", STATE, "  const read = contextResumeFieldsOf(record.value, vocabularyOf(request.phaseId));", "  const early = observeDirty(ports, request, normalisedRoot(input.root));\n  void early;\n  const read = contextResumeFieldsOf(record.value, vocabularyOf(request.phaseId));"),
  M("another-projects-record-is-used", "RS-10", STATE, "  if (read.belongsTo.projectId !== request.projectId) return refusedRecord('RESUME_WORK_RECORD_NOT_THIS_PROJECT', 'it names another project');\n", GONE),
  M("another-projects-record-is-taken-for-no-record", "RS-10", STATE, "return refusedRecord('RESUME_WORK_RECORD_NOT_THIS_PROJECT', 'it names another project');", "return NOTHING;"),
  M("another-phases-record-is-used", "RS-10", STATE, "read.belongsTo.phaseId !== request.phaseId || !read.cutOff", "!read.cutOff", ["RS-6"]),
  M("an-unreadable-record-is-an-absent-one", "RS-10", STATE, "if (!record.ok) return refusedRecord('RESUME_WORK_RECORD_UNREADABLE',", "if (!record.ok) return NOTHING; const ignored = refusedRecord('RESUME_WORK_RECORD_UNREADABLE',"),
  M("a-throwing-record-reader-is-an-absent-record", "RS-10", STATE, "    return refusedRecord('RESUME_WORK_RECORD_UNREADABLE', 'it could not be read');", "    return NOTHING;"),
  M("a-record-of-a-state-the-loop-does-not-have-is-an-absent-one", "RS-10", STATE, "if (!read.ok) return refusedRecord(read.code === 'RESUME_RECORD_NOT_PLAIN'", "if (!read.ok) return NOTHING; const ignoredRead = refusedRecord(read.code === 'RESUME_RECORD_NOT_PLAIN'"),
  M("a-record-refusal-names-no-fix", "RS-10", STATE, "Fix: the owner replaces ${WORK_RECORD_REL} with a good copy", "the owner replaces ${WORK_RECORD_REL} with a good copy"),
  M("a-record-refusal-sends-the-owner-to-git-checkout", "RS-10", STATE, "and COMMITS that change (the record is a committed file here, so restoring it from git brings the same bytes back)", "(git checkout -- ${WORK_RECORD_REL})"),
  M("a-reader-with-no-answer-is-a-type-error", "RS-10", STATE, "if (record === null || typeof record !== 'object' || typeof (record as { ok?: unknown }).ok !== 'boolean') return refusedRecord(", "if (false) return refusedRecord("),
  M("an-absent-record-is-refused-too", "RS-10", STATE, "  if (record.value === null) return NOTHING;\n", GONE),
  // RS-11
  M("a-record-file-is-read-without-its-size", "RS-11", STATE, "    if (stat.size > MAX_RESUME_FILE_BYTES) return { kind: 'problem', code: 'RESUME_FILE_TOO_LARGE' };\n", GONE),
  M("a-record-file-that-is-a-link-is-read", "RS-11", STATE, "    if (stat.kind !== 'file') return { kind: 'problem', code: 'RESUME_FILE_NOT_REGULAR' };\n", GONE),
  M("the-file-cap-grows", "RS-11", STATE, "export const MAX_RESUME_FILE_BYTES = 65_536;", "export const MAX_RESUME_FILE_BYTES = 65_536_000;"),
  M("a-changed-file-is-hashed-whatever-its-size", "RS-11", STATE, "if (own.size > MAX_RESUME_HASH_BYTES || own.size > budgetLeft) return { hash: null, note: 'too-large', spent: 0 };", ""),
  M("the-dirty-list-is-not-capped", "RS-11", STATE, "  if (dirty.length > MAX_RESUME_DIRTY_PATHS) {", "  if (dirty.length > MAX_RESUME_DIRTY_PATHS * 1000) {"),
  M("the-findings-list-is-not-capped", "RS-11", STATE, "(object['findings'] as unknown[]).slice(0, MAX_FINDINGS_READ)", "(object['findings'] as unknown[])"),
  M("the-render-cap-grows", "RS-11", RENDER, "export const MAX_CONTEXT_RESUME_FINDING_CHARS = 300;", "export const MAX_CONTEXT_RESUME_FINDING_CHARS = 300000;"),
  M("a-path-is-judged-before-its-length", "RS-11", PATHS, "if (path === '' || path.length > MAX_CONTEXT_RESUME_PATH_CHARS) return 'odd-form';", "if (path === '') return 'odd-form';"),
  M("a-pattern-is-unbounded", "RS-11", PATHS, "[A-Za-z0-9_.-]{1,200}\\.(?:brief", "[A-Za-z0-9_.-]{1,}\\.(?:brief", ["RS-6"]),
  M("the-hash-budget-is-not-spent", "RS-11", STATE, "    budget -= hashed.spent;\n", GONE),
  M("a-list-past-the-bound-says-git-does-not-run", "RS-11", STATE, "return result.stdout.length >= MAX_GIT_OUTPUT_BYTES - OUTPUT_BOUND_SLACK ? 'too-much-output' : 'unreadable';", "return 'unreadable';"),
  M("a-too-long-list-names-no-fix", "RS-11", STATE, "and adds an ignore rule for generated trees (for example an un-ignored node_modules)", "and checks that git runs"),
  M("the-output-bound-slack-grows", "RS-11", STATE, "const OUTPUT_BOUND_SLACK = 4096;", "const OUTPUT_BOUND_SLACK = 4096000;"),
  // RS-12
  M("a-file-has-no-origin", "RS-12", STATE, "// Origin: original ProjectOS code\n", GONE),
  M("a-file-holds-a-raw-non-ascii-character", "RS-12", RENDER, "export const MAX_CONTEXT_RESUME_DIRTY_LISTED = 40;", "export const MAX_CONTEXT_RESUME_DIRTY_LISTED = 40; // é"),
  M("core-imports-a-node-module", "RS-12", PATHS, "export const CONTEXT_RESUME_PATH_REASONS", "import { createHash } from 'node:crypto';\nexport const CONTEXT_RESUME_PATH_REASONS"),
  M("core-reads-a-clock", "RS-12", RECORD, "const SESSION_NAME", "const startedAt = Date.now();\nconst SESSION_NAME", ["RS-8"]),
  M("core-imports-something-new", "RS-12", RENDER, "import type { ContextResumeFields } from './resumeRecord.js';", "import type { ContextResumeFields } from './resumeRecord.js';\nimport { DOMAINS } from '../tenant.js';\nvoid DOMAINS;"),
  M("the-barrel-forgets-a-file", "RS-12", CORE_INDEX, "export * from './context/resumePaths.js';\n", GONE),
  M("an-export-is-not-prefixed", "RS-12", PATHS, "export function classifyContextResumePath(", "export function classifyPath("),
  U("a-new-file-is-not-tracked", "RS-12", PATHS),
  // RS-13
  M("it-is-registered-late", "RS-13", VA, '  "val-projectos-resume1a",\n', GONE),
  M("the-cached-runner-lists-it-twice", "RS-13", CR, '  "val-projectos-resume1a",\n', '  "val-projectos-resume1a",\n  "val-projectos-resume1a",\n'),
  // RS-14
  M("a-proof-is-skipped", "RS-14", "projectos/agent/test/resumeRun.test.ts", "  it('marks the earlier state stale once HEAD has moved, and still admits the run', () => {", "  it.skip('marks the earlier state stale once HEAD has moved, and still admits the run', () => {"),
  M("a-proof-has-no-assertion", "RS-14", "projectos/agent/test/resumeRun.test.ts", "    expect(r.ok).toBe(true);\n    expect(wk.calls[0]).toBe('start');\n    expect(stale in w.files).toBe(false);\n", ""),
  M("a-proof-is-gone", "RS-14", "projectos/core/test/context-resume.test.ts", "answers a hostile path in linear time", "answers a path"),
];

// ---------------------------------------------------------------------------------------------------------

const edit = (text, from, to) => text.replace(from, () => to);

function selfTest(raw, tracked) {
  const errors = [];
  for (const m of MUTATIONS) {
    if (m.untracked !== undefined) {
      if (tracked === null || !tracked.has(m.untracked)) errors.push(`RS-M: mutation '${m.name}' no longer applies: ${m.untracked} is not a tracked file`);
      else if (!textProblems(raw, new Set([...tracked].filter((rel) => rel !== m.untracked))).some(([rule]) => rule === m.rule)) errors.push(`RS-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
      continue;
    }
    const text = raw[m.rel];
    if (typeof text !== "string" || !text.includes(m.from)) {
      errors.push(`RS-M: mutation '${m.name}' no longer applies to ${m.rel}; update it with the rule`);
      continue;
    }
    const fired = [...new Set(textProblems({ ...raw, [m.rel]: edit(text, m.from, m.to) }, tracked).map(([rule]) => rule))].sort();
    const wanted = [...new Set([m.rule, ...m.also])].sort();
    if (!fired.includes(m.rule)) errors.push(`RS-M: mutation '${m.name}' survived; ${m.rule} did not fire (${fired.join(", ") || "nothing"})`);
    else if (JSON.stringify(fired) !== JSON.stringify(wanted)) errors.push(`RS-M: mutation '${m.name}' wanted ${wanted.join(", ")} and fired ${fired.join(", ")}`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("RS-M: two mutations share a name");
  const proved = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of Object.keys(RULE_NAMES)) if (!proved.has(rule)) errors.push(`RS-M: rule ${rule} has no named mutation`);
  return errors;
}

function trackedFiles() {
  const listed = spawnSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return listed.status === 0 && typeof listed.stdout === "string" ? new Set(listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) : null;
}

function readAll() {
  const raw = {};
  const wanted = [...NEW_FILES, PORTS, MANAGER, RETRIEVAL, RUN_CONTEXT, LEDGER, RUNNER, RUN_TS, SELECTION, WORK_RECORD, CORE_INDEX, VA, CR, FINISH, ...Object.keys(TESTS)];
  for (const rel of new Set(wanted)) raw[rel] = readFile(rel);
  return raw;
}

function run() {
  const raw = readAll();
  const missing = Object.keys(raw).filter((rel) => raw[rel] === null && rel !== FINISH);
  if (missing.length > 0) return missing.map((rel) => `RS-14 ${RULE_NAMES["RS-14"]}: ${rel} is missing`);
  const tracked = trackedFiles();
  const problems = textProblems(raw, tracked).map(([, message]) => message);
  return problems.length > 0 ? problems : selfTest(raw, tracked);
}

if (require.main === module) {
  const errors = run();
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`FAIL: ${error}`));
    console.error(`${THIS_VALIDATOR}: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${Object.keys(RULE_NAMES).length} rules; ${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, selfTest, textProblems, readAll, MUTATIONS, RULE_NAMES };
