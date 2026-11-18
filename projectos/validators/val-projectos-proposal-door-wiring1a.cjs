"use strict";
/**
 * THE PROPOSAL DOOR IS CALLED BY THE LOOP - PROJECTOS-PROPOSAL-DOOR-WIRING1A (plan v1.38, Stage 3 carry-forward C).
 *
 * `openProposalDoor` had no caller, so a worker's `proposals` entry was ignored. This wires it into the loop. Each rule is pinned because every
 * way of undoing it reads reasonably in a diff:
 *
 *   DW-1  "the door can propose a skill"                 - the door hands `SkillStatePorts` to the one `proposeSkill` call, and the loop builds them
 *         from the checkout identity and the installation state directory, so the proposal is minted and can be reviewed
 *   DW-2  "any point in the attempt will do"             - ONE call, inside the attempt loop, after the post-checks store judgement and before the
 *         evidence is written
 *   DW-3  "an entry may be queued every attempt"         - one entry is one pending proposal pinned by hash; the same entry again is a duplicate, and what an entry acts on
 *         (the entry a replace names, the ledger record it cites) is part of what makes it the same
 *   DW-4  "the record can name its author"               - the caller is `{worker id, implementer, session}` from the kernel; nothing of it is read from the record
 *   DW-5  "git ignores the directory, so skip the guard" - nothing in the guard exempts `proposals/`; a worker write there is still refused
 *   DW-6  "exempt proposals from the guard"              - the baseline is re-taken after the door for exactly the files it made (a shaped
 *         `mem-` or `skl-` file under a proposals directory, and the directories above it); anything else keeps the old baseline
 *   DW-7  "ignore the stores"                            - `.gitignore` names the two proposals directories exactly, and nothing that holds an
 *         approved memory or a promoted skill
 *   DW-8  "the door is harmless anywhere"                - not on a refused worker, not on a dry run, not on a findings record the loop cannot read
 *   DW-9  "an honest compaction is a model summary"      - the deterministic kind exists, and is what a compaction with no drafter port is recorded under
 *   DW-10 "a second caller is the same door"             - `runner.ts` is the only caller, and imports no propose, approve or write entry point
 *   DW-11 "print what was asked"                         - the output lines carry codes, indexes, ids and hashes, never worker text or a door message
 *   DW-12 "the queue the owner reads is the worker's"    - the loop gives the door a budget: the stores are measured the way the digest measures them and an entry that
 *         would take them past 6 MiB (under the 8 MiB the digest refuses above), or would reach the digest's entry-count bound (the roots, every directory and every file, counting the
 *         file and the directories the entry creates), is refused with a code before anything is written, so a worker cannot lock every later run out
 *   DW-R  "it is built, so it runs"                      - registered in both runners, identical, immediately before the provider roles validator (which is itself immediately before the memory stores validator)
 *
 * Each rule has a NAMED MUTATION; `selfTest` applies it in memory and counts it killed only when THAT rule fires. Comments are stripped first
 * (a mutation that only changes a comment is not a mutation). Reads files; runs nothing and calls no provider.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = "projectos/agent/src/loop/runner.ts";
const DOOR = "projectos/agent/src/memory/proposalDoor.ts";
const GUARD = "projectos/agent/src/context/contextStoreGuard.ts";
const STEP = "projectos/agent/src/context/proposalDoorStep.ts";
const BUDGET = "projectos/agent/src/context/proposalBudget.ts";
const DIGEST = "projectos/agent/src/memory/storeDigest.ts";
const MANAGER = "projectos/agent/src/context/contextManager.ts";
const PROVENANCE = "projectos/core/src/context/provenance.ts";
const GITIGNORE = ".gitignore";
const VA = "projectos/validators/validate-all.cjs";
const CR = "projectos/speed/cached-runner.cjs";
const SRC = "projectos/agent/src";
const THIS = "val-projectos-proposal-door-wiring1a";
const NEXT = "val-projectos-provider-roles1a";
const FIXED = [RUNNER, DOOR, GUARD, STEP, BUDGET, DIGEST, MANAGER, PROVENANCE, GITIGNORE, VA, CR];

const TESTS = {
  "projectos/agent/test/proposalDoorWiring.test.ts": [
    "records the mint when it is given state, and the proposal then reads as minted for this checkout",
    "records no mint without state, which is how the door behaved before it was wired",
    "a run mints the proposal in the installation state, outside the project tree",
    "writes the proposal after the checks ran and before the evidence record",
    "is not reached when check code wrote a store: nothing is proposed for a run the judgement stopped",
    "turns a memory entry and a skill entry of one record into one pending proposal each",
    "across correction attempts the same record stays one proposal and every attempt reaches the end of the loop",
    "says so on the second attempt: a duplicate, with the id and hash of the first",
    "records the worker the loop ran, the implementer role and this session, whatever the entry claims",
    "refuses a %s proposal the worker wrote itself, by the digest",
    "refuses it when git does show it, by the path rule",
    "the next attempt is not refused for the kernel\\'s own proposal (%s)",
    "a worker file placed beside the door\\'s file in the next attempt is still refused (%s)",
    "a worker file in a skills directory beside the door\\'s is refused too",
    "absorbs the file and its new parent directories, and then judges the next worker against that",
    "keeps the old baseline when something else changed beside the door\\'s file, so the next judgement refuses it",
    "refuses to absorb a change to a file that was already there, and a removal",
    "is never told to absorb %s",
    "keeps the old baseline when the baseline could not be taken, or git cannot say",
    "with nothing made, there is nothing to absorb and the baseline is the one it was",
    "holds exactly the two lines",
    "git status is clean after a real door on a real repository, and MEMORY.md and promoted skills still show",
    "the digest guard watches the ignored directories: a worker file there is refused on a real repository",
    "a worker that %s ends the run at WORKER_REFUSED and makes no proposal",
    "a dry run makes no proposal and writes nothing",
    "an unreadable findings record (%s) makes no proposal",
    "an absent findings record makes no proposal and no directory",
    "two replaces with the same new content but different targets are two proposals",
    "the same replace of the same target twice is still one proposal and a duplicate",
    "two adds with the same content and different ledger references are two proposals",
    "the lock-out this prevents: ten large proposals through the door with no budget leave a store the digest refuses, so every later run would be",
    "with the budget the first are accepted and the rest refused with a code, nothing is written for a refused one, and the guard still clears",
    "a refused entry does not stop an accepted one beside it from being absorbed, and the next attempt of the run is not refused by the guard",
    "applies to a memory entry too, and refuses when the stores cannot be measured",
    "measures what the digest measures: the size of every file under both store roots, and nothing outside them",
    "an entry that is already pending is a duplicate and costs the budget nothing",
    "counts the way the digest counts: both roots, every directory and every file, and the digest reads exactly that many",
    "refuses a memory entry with the stores %s",
    "counts the directories the entry would create: a proposals directory that is not there yet is one more entry",
    "with the proposals directory already there only the file is new, and a skill counts its own store roots",
    "what the door accepts at the edge still digests, and the guard clears it",
    "a run with the stores one entry under the bound refuses the entry, writes nothing, and the next attempt is not stopped by the guard",
    "is the deterministic kind when no drafter port exists, and the agent-model kind when one does",
    "the context manager applies the compaction it made itself under deterministic-selection, and the kernel accepts it",
    "records the agent-model kind for the same compaction when a drafter port wrote it",
    "makes no draft at all when everything fits, so no kind is recorded for a compaction that did not happen",
    "calls openProposalDoor from one file in src, and that file is the runner",
    "the runner imports the door and nothing that proposes, approves or promotes",
    "quotes none of the entry, accepted or refused, in the run output",
    "the line builder says nothing but a code, an index, a class, an id and a hash",
    "is bounded: a record with many refused entries prints a few lines and says how many more",
    "names the files the door made, and only for an accepted, new proposal",
  ],
  "projectos/core/test/context-hardening.test.ts": [
    "names a deterministic kind, so a compaction nothing generated is not recorded as a model summary",
    "knows exactly these kinds",
  ],
};

const PIN = {
  // DW-1
  doorStateParam: "export function openProposalDoor(sys: System, root: string, caller: ProposalDoorCaller, findingsText: string | null, state?: SkillStatePorts,",
  skillStateParam: "function skillEntry(sys: System, root: string, caller: ProposalDoorCaller, one: FindingsSkillRequest, state?: SkillStatePorts,",
  skillStatePassed: "{ files: one.files }, state);",
  skillEntryState: "skillEntry(sys, root, caller, one, state",
  runnerState: "doorFindings.ok ? sys.readText(store.findingsPath(root, sessionId)) : null, doorState",
  checkoutPort: "checkout: contextPorts?.checkout ?? (() => checkoutIdentityOf(sys, root)),",
  stateDirPort: "stateDir: options.contextStateDir === undefined ? nodeInstallationStateDir() : options.contextStateDir,",
  doorStateConst: "const doorState = {",
  // DW-2 / DW-8
  afterChecks: "const storeAfterChecks = storeGuardNow();",
  validating: "state: 'VALIDATING',",
  evidenceWritten: "const evidence = withStoredContext(",
  loopStart: "let writeGrantSpent = false;\n  for (;;) {",
  checksStart: "const checks: readonly CheckResult[] = withPinnedValidators(",
  refusedBranch: "const refused: LoopStop = described.stop;",
  dryRun: "if (dryRun) {",
  doorSequence: "const door = afterProposalDoor(\n      sys,\n      root,\n      storeGuardFs,\n      storeGuardCurrent,\n      openProposalDoor(",
  readFindingsGate: "const doorFindings = store.readFindings(sys, root, sessionId);",
  // DW-3
  memoryDuplicate: "if (same !== undefined) return { ok: true, index: one.index, class: 'memory', id: same.id, proposalHash: same.proposalHash, state: 'pending', duplicate: true };",
  skillDuplicate: "if (same !== undefined) return { ok: true, index: one.index, class: 'skill', id: same.id, proposalHash: same.proposalHash, state: 'pending', duplicate: true };",
  skillWanted: "const wanted = filesKey(one.files);",
  sameTargetCall: "        sameTarget(held, request) &&\n",
  sameLedger: "if (held.ledgerRef !== (request.ledgerRef ?? null)) return false;",
  sameOldText: "return held.targetEntry !== null && normalizedEntryKey(held.targetEntry).includes(wantedOld);",
  sameNoOldText: "if (wantedOld === '') return held.targetEntry === null;",
  // DW-4
  caller: "{ author: resolution.worker.workerId, role: 'implementer', session: sessionId }",
  // DW-5
  changedPaths: "const changed = after.filter((path) => !already.has(path));",
  directRule: "const direct = checkNoDirectStoreWrites(changed);",
  digestRule: "const digest = checkStoreUnchanged(before.snapshot, snapshotMemoryStores(root, fs));",
  // DW-6
  current: "let storeGuardCurrent = storeGuardBaseline;",
  judgedAgainstCurrent: "storeGuardNow = () => endStoreGuard(sys, root, storeGuardFs, storeGuardCurrent);",
  retaken: "storeGuardCurrent = door.baseline;",
  doorFileShape: "const DOOR_FILE = /^\\.projectops\\/(?:memory|skills)\\/proposals\\/(?:mem|skl)-[0-9a-f]{24}\\.json$/;",
  rebaseEveryShaped: "if (!made.every((path) => DOOR_FILE.test(path))) return kept;",
  rebaseAllowed: "const allowed = new Set(made.flatMap((path) => [...withParents(path), path]));",
  rebaseAddedOnly: "if (was.has(path) || !allowed.has(path)) return kept;",
  rebaseRemoved: "for (const path of was.keys()) if (!is.has(path)) return kept;",
  rebaseDirty: "const dirty = [...before.dirty, ...now.dirty.filter((path) => allowed.has(path) && !known.has(path))];",
  rebaseBlind: "if (!before.snapshot.ok || !now.snapshot.ok || before.dirty === null || now.dirty === null) return kept;",
  stepMade: "entry.ok && !entry.duplicate ?",
  stepRebase: "const rebased = rebaseStoreGuard(sys, root, fs, baseline, made);",
  stepBaseline: "return { lines: [...lines, ...note], baseline: rebased.baseline };",
  // DW-7
  memoryLine: ".projectops/memory/proposals/",
  skillLine: ".projectops/skills/proposals/",
  // DW-9
  kinds: "export const SUMMARISER_KINDS = ['summary-model', 'agent-model', 'deterministic-selection'] as const;",
  kindOf: "return drafter === undefined ? DETERMINISTIC_SUMMARISER : DRAFTED_SUMMARISER;",
  kindUsed: "summarisedBy: summariserKindOf(ports.drafter)",
  deterministicConst: "const DETERMINISTIC_SUMMARISER = 'deterministic-selection';",
  // DW-12
  doorBudgetType: "export type ProposalBudget = (entry: FindingsMemoryRequest | FindingsSkillRequest) => boolean;",
  doorBudgetCode: "code: 'PROPOSAL_DOOR_BUDGET',",
  doorMemoryCall: "memoryEntry(sys, root, caller, one, budget)",
  doorSkillCall: "skillEntry(sys, root, caller, one, state, budget))",
  askMemory: "  if (budget !== undefined && !budget(one)) return overBudget(one.index, 'memory');\n",
  askSkill: "  if (budget !== undefined && !budget(one)) return overBudget(one.index, 'skill');\n",
  runnerBudget: ", doorState, proposalBudgetOf(storeGuardFs, root)),",
  runnerBudgetImport: "import { proposalBudgetOf } from '../context/proposalBudget.js';",
  budgetFits: "return used.bytes + entryBytesBound(entry) <= PROPOSALS_BUDGET_BYTES;",
  budgetNullRefusal: "if (used === null) return false;",
  budgetOverhead: "+ PROPOSAL_FILE_OVERHEAD_BYTES;",
  budgetEstimate: "Buffer.byteLength(JSON.stringify(own, null, 2), 'utf8')",
  budgetRoots: "const STORE_ROOTS: readonly string[] = ['.projectops/memory', '.projectops/skills'];",
  budgetLink: "if (stat === null || stat.kind === 'link') return false;",
  budgetAgain: "return (entry) => {\n    const used = storeUsageNow(fs, root);",
  budgetUnmeasurable: "if (parent.kind !== 'directory') return null;",
  budgetCountCheck: "if (used.entries + newEntriesFor(fs, root, entry) >= MAX_STORE_DIGEST_FILES) return false;",
  budgetRootsCounted: "tally.entries += 1;\n    if (!addBytesUnder(fs, root, store, 1, tally)) return null;",
  budgetWalkCount: "tally.entries += 1;\n    if (tally.entries > MAX_STORE_DIGEST_FILES) return false;",
  budgetDepth: "if (depth > MAX_STORE_DIGEST_DEPTH) return false;",
  budgetNewStore: "const store = entry.class === 'skill' ? '.projectops/skills' : '.projectops/memory';",
  budgetNewDirs: "const missing = [store, `${store}/proposals`].filter((directory) => fs.stat(`${root}/${directory}`) === null).length;",
  budgetNewFile: "return 1 + missing;",
  budgetImport: "import { MAX_STORE_DIGEST_DEPTH, MAX_STORE_DIGEST_FILES } from '../memory/storeDigest.js';",
  doorBudgetText: "Proposals that were already decided stay on disk and still count, and nothing removes them, so room comes back only when files are deleted by hand.",
  // DW-10
  runnerImport: "import { openProposalDoor } from '../memory/proposalDoor.js';",
  // DW-11
  refusedLine: "REFUSED (${entry.code})`;",
  boundedLines: "const shown = outcome.entries.slice(0, MAX_DOOR_LINES).map(lineOf);",
  runnerLines: "lines.push(...door.lines);",
};

const PROPOSE_NAMES = /\b(?:proposeMemoryWrite|proposeSkill|importSkill|approveMemoryProposal|rejectMemoryProposal|reviewAndPromoteSkill|rejectSkillProposal|writeMemoryEntries|writeMemoryProvenance|applyMemoryProposal)\b/;
const DOOR_CALL = /(?<![.\w])openProposalDoor\(/g;

const MUTATIONS = [
  // DW-1
  { name: "the-door-drops-the-state", rule: "DW-1", rel: DOOR, from: PIN.skillStatePassed, to: "{ files: one.files });" },
  { name: "the-door-forgets-to-pass-state-on", rule: "DW-1", rel: DOOR, from: PIN.skillEntryState, to: "skillEntry(sys, root, caller, one))" },
  { name: "the-runner-passes-no-state", rule: "DW-1", rel: RUNNER, from: PIN.runnerState, to: "doorFindings.ok ? sys.readText(store.findingsPath(root, sessionId)) : null)," },
  { name: "the-state-names-no-checkout", rule: "DW-1", rel: RUNNER, from: PIN.checkoutPort, to: "checkout: () => null," },
  { name: "the-state-names-no-state-directory", rule: "DW-1", rel: RUNNER, from: PIN.stateDirPort, to: "stateDir: null," },
  // DW-2
  { name: "the-door-runs-before-the-checks", rule: "DW-2", rel: RUNNER, from: PIN.checksStart, to: "const doorEarly = openProposalDoor(sys, root, { author: resolution.worker.workerId, role: 'implementer', session: sessionId }, null);\n    " + PIN.checksStart },
  { name: "the-door-runs-after-the-evidence", rule: "DW-2", rel: RUNNER, from: "const findings = store.readFindings(sys, root, sessionId);\n    if (!findings.ok) {", to: "const doorLate = openProposalDoor(sys, root, { author: resolution.worker.workerId, role: 'implementer', session: sessionId }, null);\n    const findings = store.readFindings(sys, root, sessionId);\n    if (!findings.ok) {" },
  { name: "the-door-is-called-twice-an-attempt", rule: "DW-2", rel: RUNNER, from: "    storeGuardCurrent = door.baseline;\n", to: "    storeGuardCurrent = door.baseline;\n    void openProposalDoor(sys, root, { author: resolution.worker.workerId, role: 'implementer', session: sessionId }, null);\n" },
  // DW-3
  { name: "the-memory-duplicate-is-queued-again", rule: "DW-3", rel: DOOR, from: PIN.memoryDuplicate, to: "if (false) return { ok: true, index: one.index, class: 'memory', id: 'x', proposalHash: 'x', state: 'pending', duplicate: true };" },
  { name: "the-skill-duplicate-is-queued-again", rule: "DW-3", rel: DOOR, from: PIN.skillDuplicate, to: "if (false) return { ok: true, index: one.index, class: 'skill', id: 'x', proposalHash: 'x', state: 'pending', duplicate: true };" },
  { name: "the-skill-entry-is-not-compared-by-its-files", rule: "DW-3", rel: DOOR, from: PIN.skillWanted, to: "const wanted = '';" },
  { name: "the-memory-duplicate-ignores-the-target", rule: "DW-3", rel: DOOR, from: PIN.sameTargetCall, to: "" },
  { name: "the-duplicate-ignores-the-ledger-reference", rule: "DW-3", rel: DOOR, from: PIN.sameLedger, to: "" },
  { name: "the-duplicate-ignores-which-entry-is-replaced", rule: "DW-3", rel: DOOR, from: PIN.sameOldText, to: "return true;" },
  { name: "an-add-is-a-duplicate-of-a-replace", rule: "DW-3", rel: DOOR, from: PIN.sameNoOldText, to: "if (wantedOld === '') return true;" },
  // DW-4
  { name: "the-caller-is-the-owner", rule: "DW-4", rel: RUNNER, from: PIN.caller, to: "{ author: resolution.worker.workerId, role: 'owner', session: sessionId }" },
  { name: "the-author-comes-from-the-record", rule: "DW-4", rel: RUNNER, from: PIN.caller, to: "{ author: doorFindings.ok ? String((doorFindings.value as unknown as { author?: string }).author) : 'x', role: 'implementer', session: sessionId }" },
  { name: "the-session-is-not-this-one", rule: "DW-4", rel: RUNNER, from: PIN.caller, to: "{ author: resolution.worker.workerId, role: 'implementer', session: 'anything' }" },
  // DW-5
  { name: "proposals-are-exempt-from-the-path-rule", rule: "DW-5", rel: GUARD, from: PIN.changedPaths, to: "const changed = after.filter((path) => !already.has(path) && !path.includes('/proposals/'));" },
  { name: "the-digest-skips-proposals", rule: "DW-5", rel: GUARD, from: PIN.digestRule, to: "const digest = checkStoreUnchanged(before.snapshot, snapshotMemoryStores(root, fs));\n  if (digest.ok === false && digest.code === 'MEMORY_STORE_CHANGED' && (digest.added ?? []).every((p) => p.includes('/proposals/'))) return { ok: true };" },
  { name: "the-direct-write-rule-is-dropped", rule: "DW-5", rel: GUARD, from: PIN.directRule, to: "const direct = { ok: true } as ReturnType<typeof checkNoDirectStoreWrites>;" },
  // DW-6
  { name: "the-baseline-is-not-retaken", rule: "DW-6", rel: RUNNER, from: PIN.retaken, to: "storeGuardCurrent = storeGuardCurrent;" },
  { name: "the-judgement-uses-the-first-baseline", rule: "DW-6", rel: RUNNER, from: PIN.judgedAgainstCurrent, to: "storeGuardNow = () => endStoreGuard(sys, root, storeGuardFs, storeGuardBaseline);" },
  { name: "the-rebase-absorbs-a-worker-file-beside-the-door", rule: "DW-6", rel: GUARD, from: PIN.rebaseAddedOnly, to: "if (was.has(path)) return kept;" },
  { name: "the-rebase-absorbs-a-changed-file", rule: "DW-6", rel: GUARD, from: PIN.rebaseAddedOnly, to: "if (!allowed.has(path)) return kept;" },
  { name: "the-rebase-ignores-a-removal", rule: "DW-6", rel: GUARD, from: PIN.rebaseRemoved, to: "" },
  { name: "the-rebase-takes-any-path-it-is-told", rule: "DW-6", rel: GUARD, from: PIN.rebaseEveryShaped, to: "" },
  { name: "the-door-file-is-any-store-path", rule: "DW-6", rel: GUARD, from: PIN.doorFileShape, to: "const DOOR_FILE = /^\\.projectops\\/(?:memory|skills)\\/.+$/;" },
  { name: "the-dirty-list-takes-everything", rule: "DW-6", rel: GUARD, from: PIN.rebaseDirty, to: "const dirty = now.dirty;" },
  { name: "the-rebase-allows-every-new-path", rule: "DW-6", rel: GUARD, from: PIN.rebaseAllowed, to: "const allowed = { has: () => true };" },
  { name: "the-rebase-takes-a-baseline-it-could-not-take", rule: "DW-6", rel: GUARD, from: PIN.rebaseBlind, to: "if (before.dirty === null || now.dirty === null) return kept;" },
  { name: "a-duplicate-counts-as-made", rule: "DW-6", rel: STEP, from: PIN.stepMade, to: "entry.ok ?" },
  { name: "the-step-keeps-the-old-baseline", rule: "DW-6", rel: STEP, from: PIN.stepBaseline, to: "return { lines: [...lines, ...note], baseline };" },
  { name: "the-step-does-not-rebase", rule: "DW-6", rel: STEP, from: PIN.stepRebase, to: "const rebased = { baseline, absorbed: true };" },
  // DW-7
  { name: "the-memory-proposals-are-not-ignored", rule: "DW-7", rel: GITIGNORE, from: PIN.memoryLine + "\n", to: "" },
  { name: "the-skill-proposals-are-not-ignored", rule: "DW-7", rel: GITIGNORE, from: PIN.skillLine + "\n", to: "" },
  { name: "the-whole-memory-store-is-ignored", rule: "DW-7", rel: GITIGNORE, from: PIN.memoryLine + "\n", to: ".projectops/memory/\n" },
  { name: "promoted-skills-are-ignored", rule: "DW-7", rel: GITIGNORE, from: PIN.skillLine + "\n", to: PIN.skillLine + "\n.projectops/skills/promoted/\n" },
  { name: "the-skill-line-names-the-wrong-directory", rule: "DW-7", rel: GITIGNORE, from: PIN.skillLine + "\n", to: ".projectops/skills/proposal/\n" },
  { name: "the-approved-memory-file-is-ignored", rule: "DW-7", rel: GITIGNORE, from: PIN.memoryLine + "\n", to: PIN.memoryLine + "\n.projectops/memory/MEMORY.md\n" },
  // DW-8
  { name: "the-door-reads-an-unreadable-record", rule: "DW-8", rel: RUNNER, from: PIN.runnerState, to: "sys.readText(store.findingsPath(root, sessionId)), doorState)," },
  { name: "the-door-runs-for-a-refused-worker", rule: "DW-8", rel: RUNNER, from: PIN.refusedBranch, to: PIN.refusedBranch + "\n      void openProposalDoor(sys, root, { author: resolution.worker.workerId, role: 'implementer', session: sessionId }, null);" },
  { name: "the-door-runs-in-a-dry-run", rule: "DW-8", rel: RUNNER, from: PIN.dryRun, to: "void openProposalDoor(sys, root, { author: 'dry', role: 'implementer', session: sessionId }, null);\n  " + PIN.dryRun },
  { name: "the-findings-are-not-read-before-the-door", rule: "DW-8", rel: RUNNER, from: PIN.readFindingsGate, to: "const doorFindings = { ok: true } as ReturnType<typeof store.readFindings>;" },
  // DW-9
  { name: "the-deterministic-kind-is-not-known", rule: "DW-9", rel: PROVENANCE, from: PIN.kinds, to: "export const SUMMARISER_KINDS = ['summary-model', 'agent-model'] as const;" },
  { name: "a-deterministic-run-is-recorded-as-a-model", rule: "DW-9", rel: MANAGER, from: PIN.kindOf, to: "return DRAFTED_SUMMARISER;" },
  { name: "the-kind-is-not-asked-of-the-ports", rule: "DW-9", rel: MANAGER, from: PIN.kindUsed, to: "summarisedBy: 'agent-model'" },
  { name: "the-deterministic-name-is-another", rule: "DW-9", rel: MANAGER, from: PIN.deterministicConst, to: "const DETERMINISTIC_SUMMARISER = 'deterministic';" },
  // DW-10
  { name: "a-second-caller-of-the-door", rule: "DW-10", rel: STEP, from: "const lines = doorOutcomeLines(outcome);", to: "const lines = doorOutcomeLines(outcome);\n  void openProposalDoor(null as never, root, null as never, null);" },
  { name: "the-runner-imports-a-propose-entry", rule: "DW-10", rel: RUNNER, from: PIN.runnerImport, to: PIN.runnerImport + "\nimport { proposeMemoryWrite } from '../memory/proposalQueue.js';" },
  { name: "the-runner-imports-an-approve-entry", rule: "DW-10", rel: RUNNER, from: PIN.runnerImport, to: "import { openProposalDoor, approveMemoryProposal } from '../memory/proposalDoor.js';" },
  // DW-11
  { name: "the-line-quotes-the-door-message", rule: "DW-11", rel: STEP, from: PIN.refusedLine, to: "REFUSED (${entry.code}): ${entry.message}`;" },
  { name: "the-lines-are-unbounded", rule: "DW-11", rel: STEP, from: PIN.boundedLines, to: "const shown = outcome.entries.map(lineOf);" },
  { name: "the-runner-prints-more-than-the-lines", rule: "DW-11", rel: RUNNER, from: PIN.runnerLines, to: "lines.push(...door.lines, JSON.stringify(door));" },
  // DW-12
  { name: "the-door-takes-no-budget", rule: "DW-12", rel: DOOR, from: PIN.doorBudgetType, to: "export type ProposalBudget = never;" },
  { name: "the-budget-code-is-another", rule: "DW-12", rel: DOOR, from: PIN.doorBudgetCode, to: "code: 'PROPOSAL_DOOR_FULL'," },
  { name: "a-memory-entry-is-not-asked-of-the-budget", rule: "DW-12", rel: DOOR, from: PIN.askMemory, to: "" },
  { name: "a-skill-entry-is-not-asked-of-the-budget", rule: "DW-12", rel: DOOR, from: PIN.askSkill, to: "" },
  { name: "the-skill-is-proposed-before-the-budget-is-asked", rule: "DW-12", rel: DOOR, from: PIN.askSkill, to: "", also: [["  if (!made.ok) return { ok: false, index: one.index, class: 'skill'", "  if (budget !== undefined && !budget(one)) return overBudget(one.index, 'skill');\n  if (!made.ok) return { ok: false, index: one.index, class: 'skill'"]] },
  { name: "the-door-does-not-hand-the-budget-to-the-memory-entry", rule: "DW-12", rel: DOOR, from: PIN.doorMemoryCall, to: "memoryEntry(sys, root, caller, one)" },
  { name: "the-door-does-not-hand-the-budget-to-the-skill-entry", rule: "DW-12", rel: DOOR, from: PIN.doorSkillCall, to: "skillEntry(sys, root, caller, one, state))" },
  { name: "the-runner-gives-the-door-no-budget", rule: "DW-12", rel: RUNNER, from: PIN.runnerBudget, to: ", doorState)," },
  { name: "the-runner-does-not-import-the-budget", rule: "DW-12", rel: RUNNER, from: PIN.runnerBudgetImport, to: "const proposalBudgetOf = (..._args: unknown[]) => (): boolean => true;" },
  { name: "the-budget-is-at-the-digest-bound", rule: "DW-12", rel: BUDGET, from: "PROPOSALS_BUDGET_BYTES = 6 * 1024 * 1024;", to: "PROPOSALS_BUDGET_BYTES = 8 * 1024 * 1024;" },
  { name: "the-budget-leaves-no-room-for-the-file-overhead", rel: BUDGET, rule: "DW-12", from: "PROPOSAL_FILE_OVERHEAD_BYTES = 64 * 1024;", to: "PROPOSAL_FILE_OVERHEAD_BYTES = 3 * 1024 * 1024;" },
  { name: "the-entry-size-is-not-counted", rule: "DW-12", rel: BUDGET, from: PIN.budgetFits, to: "return used.bytes <= PROPOSALS_BUDGET_BYTES;" },
  { name: "an-unmeasurable-store-counts-as-empty", rule: "DW-12", rel: BUDGET, from: PIN.budgetNullRefusal, to: "" },
  { name: "the-estimate-leaves-out-the-fixed-overhead", rule: "DW-12", rel: BUDGET, from: PIN.budgetOverhead, to: "+ 0;" },
  { name: "the-estimate-ignores-the-text", rule: "DW-12", rel: BUDGET, from: PIN.budgetEstimate, to: "0" },
  { name: "the-skills-store-is-not-measured", rule: "DW-12", rel: BUDGET, from: PIN.budgetRoots, to: "const STORE_ROOTS: readonly string[] = ['.projectops/memory'];" },
  { name: "a-link-in-a-store-is-measured-as-a-file", rule: "DW-12", rel: BUDGET, from: PIN.budgetLink, to: "if (stat === null) return false;" },
  { name: "the-stores-are-measured-once", rule: "DW-12", rel: BUDGET, from: PIN.budgetAgain, to: "const used = storeUsageNow(fs, root);\n  return (entry) => {" },
  { name: "a-store-that-is-not-a-directory-is-skipped", rule: "DW-12", rel: BUDGET, from: PIN.budgetUnmeasurable, to: "if (parent.kind !== 'directory') return 0;" },
  { name: "the-entry-count-is-not-checked", rule: "DW-12", rel: BUDGET, from: PIN.budgetCountCheck, to: "" },
  { name: "the-entry-bound-is-passed-and-not-reached", rule: "DW-12", rel: BUDGET, from: "newEntriesFor(fs, root, entry) >= MAX_STORE_DIGEST_FILES) return false;", to: "newEntriesFor(fs, root, entry) > MAX_STORE_DIGEST_FILES) return false;" },
  { name: "the-directories-an-entry-creates-are-not-counted", rule: "DW-12", rel: BUDGET, from: "newEntriesFor(fs, root, entry) >= MAX_STORE_DIGEST_FILES", to: "1 >= MAX_STORE_DIGEST_FILES" },
  { name: "the-store-roots-are-not-counted", rule: "DW-12", rel: BUDGET, from: PIN.budgetRootsCounted, to: "if (!addBytesUnder(fs, root, store, 1, tally)) return null;" },
  { name: "the-entry-bound-is-a-copy-of-the-digests", rule: "DW-12", rel: BUDGET, from: PIN.budgetCountCheck, to: "if (used.entries + newEntriesFor(fs, root, entry) >= 2000) return false;" },
  { name: "the-walk-does-not-stop-at-the-digests-entry-bound", rule: "DW-12", rel: BUDGET, from: PIN.budgetWalkCount, to: "tally.entries += 1;" },
  { name: "the-walk-does-not-stop-at-the-digests-depth", rule: "DW-12", rel: BUDGET, from: PIN.budgetDepth, to: "if (depth > 100) return false;" },
  { name: "the-new-entries-ignore-the-skill-store", rule: "DW-12", rel: BUDGET, from: PIN.budgetNewStore, to: "const store = '.projectops/memory';" },
  { name: "the-new-entries-ignore-the-missing-directories", rule: "DW-12", rel: BUDGET, from: PIN.budgetNewDirs, to: "const missing = 0;" },
  { name: "the-new-file-is-not-counted", rule: "DW-12", rel: BUDGET, from: PIN.budgetNewFile, to: "return missing;" },
  { name: "the-refusal-message-promises-room-the-owner-cannot-make", rule: "DW-12", rel: DOOR, from: PIN.doorBudgetText, to: "The owner decides what is waiting, and then it can be asked again." },
  // DW-R
  { name: "validate-all-omits-this-validator", rule: "DW-R", rel: VA, from: `  "${THIS}",\n`, to: "" },
  { name: "the-cached-runner-omits-this-validator", rule: "DW-R", rel: CR, from: `  "${THIS}",\n`, to: "" },
  { name: "the-validator-is-commented-out", rule: "DW-R", rel: VA, from: `  "${THIS}",`, to: `  // "${THIS}",` },
  { name: "the-validator-runs-after-the-roles-validator", rule: "DW-R", rel: CR, from: `  "${THIS}",\n`, to: "" , also: [[`  "${NEXT}",`, `  "${NEXT}",\n  "${THIS}",`]] },
  { name: "another-validator-is-put-between-this-one-and-the-roles-one", rule: "DW-R", rel: VA, from: `  "${THIS}",
`, to: `  "${THIS}",
  "val-projectos-memory-stores1a",
` },
  { name: "the-roles-comment-line-is-not-directly-after-this-entry", rule: "DW-R", rel: CR, from: "// PROJECTOS-PROVIDER-ROLES1A", to: "// PROJECTOS-PROVIDER-ROLES-1A" },
  { name: "the-runners-list-different-validators-from-this-one-on", rule: "DW-R", rel: CR, from: `  "${NEXT}",
`, to: `  "${NEXT}",
  "val-projectos-not-in-the-other-runner",
` },
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments outside strings. CRLF is folded to LF first. */
function code(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const count = (text, needle) => text.split(needle).length - 1;
const has = (text, ...needles) => needles.every((n) => text.includes(n));
const positions = (text, re) => [...text.matchAll(re)].map((m) => m.index);

/** The body of a function or block that starts at `start`: up to the next top-level `\n}\n`. */
function bodyFrom(text, start) {
  const at = text.indexOf(start);
  if (at < 0) return "";
  const end = text.indexOf("\n}\n", at);
  return text.slice(at, end < 0 ? text.length : end + 3);
}

/** The `[modules]` array of a runner, in order, or null. */
function modulesOf(text) {
  if (text === null) return null;
  const at = text.search(/const MODULES\s*=\s*\[/);
  if (at < 0) return null;
  const end = text.indexOf("];", at);
  return [...text.slice(at, end).matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  for (const rel of FIXED) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("DW-0", `${rel} is missing`);
      return errors;
    }
  }
  const runner = code(raw[RUNNER]);
  const door = code(raw[DOOR]);
  const guard = code(raw[GUARD]);
  const step = code(raw[STEP]);
  const manager = code(raw[MANAGER]);
  const provenance = code(raw[PROVENANCE]);

  // DW-1
  if (!has(door, PIN.doorStateParam, PIN.skillStateParam, PIN.skillEntryState)) E("DW-1", "the door does not take the skill state ports and hand them to the skill entry");
  if (!door.includes(PIN.skillStatePassed) || count(door, "proposeSkill(") !== 1) E("DW-1", "the one proposeSkill call does not receive the state, so a skill proposal can never be reviewed");
  if (!has(runner, PIN.runnerState, PIN.doorStateConst, PIN.checkoutPort, PIN.stateDirPort)) E("DW-1", "the loop does not build the state ports from the checkout identity and the installation state directory, or does not pass them");

  // DW-2: exactly one call, inside the attempt loop, after the post-checks judgement and before the evidence
  const calls = positions(runner, DOOR_CALL);
  const judged = runner.indexOf(PIN.afterChecks);
  const validating = runner.indexOf(PIN.validating);
  const evidenceAt = runner.indexOf(PIN.evidenceWritten);
  const loopAt = runner.indexOf(PIN.loopStart);
  if (calls.length !== 1) E("DW-2", `the loop calls the door ${calls.length} times, not once`);
  if (judged < 0 || validating < 0 || evidenceAt < 0 || loopAt < 0) E("DW-2", "an anchor of the attempt (the post-checks judgement, the VALIDATING state, the evidence record or the loop) moved");
  else if (calls.some((at) => !(at > judged && at < validating && at < evidenceAt))) E("DW-2", "the door is not called after the post-checks store judgement and before the evidence is written");
  if (!runner.includes(PIN.doorSequence) || !runner.includes(PIN.retaken) || !runner.includes(PIN.runnerLines)) E("DW-2", "the door is not followed by the re-baseline and the outcome lines, in one step");

  // DW-3
  if (!has(door, PIN.memoryDuplicate, PIN.skillDuplicate, PIN.skillWanted)) E("DW-3", "an entry that is already pending is not answered as a duplicate");

  if (!has(door, PIN.sameTargetCall, PIN.sameLedger, PIN.sameOldText, PIN.sameNoOldText)) E("DW-3", "the duplicate test ignores what an entry acts on: two requests for different targets collapse into one proposal");

  // DW-4
  if (!runner.includes(PIN.caller)) E("DW-4", "the caller is not the worker the loop ran, in the implementer role, in this session");
  if (/doorFindings\.value/.test(runner)) E("DW-4", "something of the caller is read from the findings record");

  // DW-5: nothing in the guard exempts a proposals path, and its refusal rules are the ones that were
  const endBody = bodyFrom(guard, "export function endStoreGuard(");
  if (/proposals/.test(endBody)) E("DW-5", "endStoreGuard names a proposals path: the guard exempts it");
  if (!has(guard, PIN.changedPaths, PIN.directRule, PIN.digestRule)) E("DW-5", "the guard's direct-write rule or digest comparison is not the one that refused a worker write");

  // DW-6
  if (!has(runner, PIN.current, PIN.judgedAgainstCurrent, PIN.retaken, "storeGuardCurrent,\n      openProposalDoor(")) E("DW-6", "the loop does not keep a current baseline and re-take it after the door");
  if (!has(guard, PIN.doorFileShape, PIN.rebaseEveryShaped, PIN.rebaseAllowed, PIN.rebaseAddedOnly, PIN.rebaseRemoved, PIN.rebaseDirty, PIN.rebaseBlind)) E("DW-6", "the re-baseline absorbs more than the files the door made, or does not keep the old baseline when it cannot");
  if (!has(step, PIN.stepMade, PIN.stepRebase, PIN.stepBaseline)) E("DW-6", "the step does not re-baseline for exactly the files the door reported making");

  // DW-7
  const ignore = raw[GITIGNORE].replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#")).map((line) => line.trim());
  if (ignore.filter((line) => line === PIN.memoryLine).length !== 1 || ignore.filter((line) => line === PIN.skillLine).length !== 1) E("DW-7", ".gitignore does not name each proposals directory exactly once");
  const tooMuch = ignore.filter((line) => /MEMORY\.md|USER\.md|promoted|^\/?\.projectops\/?\*?$|^\/?\.projectops\/(?:memory|skills)\/?\*{0,2}$|^\/?\.projectops\/(?:memory|skills)\/\*/.test(line));
  if (tooMuch.length > 0) E("DW-7", `.gitignore also ignores a store: ${tooMuch.join(", ")}`);

  // DW-8
  if (!runner.includes(PIN.runnerState) || !runner.includes(PIN.readFindingsGate)) E("DW-8", "the door is not given a null record when the loop cannot read the findings record");
  const checksAt = runner.indexOf(PIN.checksStart);
  const refusedAt = runner.indexOf(PIN.refusedBranch);
  const dryAt = runner.indexOf(PIN.dryRun);
  if (refusedAt < 0 || checksAt < 0 || dryAt < 0 || loopAt < 0) E("DW-8", "an anchor (the refused-worker branch, the checks, the dry run or the loop) moved");
  else {
    if (calls.some((at) => at >= refusedAt && at < checksAt)) E("DW-8", "the door is called on a worker that refused");
    if (calls.some((at) => at < loopAt || at < dryAt)) E("DW-8", "the door is called before the loop starts, where a dry run has already ended");
  }

  // DW-9
  if (!provenance.includes(PIN.kinds)) E("DW-9", "the kernel's list of summarisers has no deterministic kind");
  if (!has(manager, PIN.kindOf, PIN.kindUsed, PIN.deterministicConst, "const DRAFTED_SUMMARISER = 'agent-model';") || /\bSUMMARISED_BY\b/.test(manager)) E("DW-9", "a compaction with no drafter port is not recorded under the deterministic kind");

  // DW-10: runner.ts is the only caller, and imports no propose entry point
  const callers = Object.keys(raw)
    .filter((rel) => rel.startsWith(`${SRC}/`) && rel.endsWith(".ts") && rel !== DOOR)
    .filter((rel) => raw[rel] !== null && raw[rel].includes("openProposalDoor(") && positions(code(raw[rel]), DOOR_CALL).length > 0)
    .sort();
  if (callers.length !== 1 || callers[0] !== RUNNER) E("DW-10", `the door is called from ${callers.length === 0 ? "nowhere" : callers.join(", ")}, not from the runner alone`);
  const importLines = runner.split("\n").filter((line) => /^import\b/.test(line)).join("\n");
  if (!importLines.includes(PIN.runnerImport) || PROPOSE_NAMES.test(importLines) || PROPOSE_NAMES.test(runner)) E("DW-10", "the runner does not import the door alone, or names a propose, approve or write entry point");

  // DW-11: the step names a code, an index, a class, an id and a hash, and nothing the worker wrote
  if (/\.(?:message|content|text|files|oldText|targetEntry)\b/.test(step)) E("DW-11", "the step reads a message or the worker's text");
  if (!has(step, PIN.refusedLine, PIN.boundedLines)) E("DW-11", "a refused entry line is not a code alone, or the lines are not bounded");
  if (count(runner, "lines.push(...door") !== 1 || (runner.match(/\bdoor\b/g) || []).length !== 3) E("DW-11", "the runner uses the door's answer for anything but its lines and its baseline");

  // DW-12: the door asks a budget before it writes, the loop gives it one measured as the digest measures, and the budget is a line under the digest bound
  const budgetSrc = code(raw[BUDGET]);
  const askedBeforeWrite = (ask, write) => door.indexOf(ask) >= 0 && door.indexOf(write) > door.indexOf(ask);
  if (!has(door, PIN.doorBudgetType, PIN.doorBudgetCode, PIN.doorMemoryCall, PIN.doorSkillCall)) E("DW-12", "the door does not take a budget, hand it to each entry, or refuse with its own closed code");
  if (!askedBeforeWrite(PIN.askMemory, "proposeMemoryWrite(sys, root, caller, request)") || !askedBeforeWrite(PIN.askSkill, "proposeSkill(sys, root,")) E("DW-12", "an entry is proposed without the budget having been asked first");
  if (!has(runner, PIN.runnerBudget, PIN.runnerBudgetImport)) E("DW-12", "the loop does not give the door a budget measured on the file system the guard reads");
  const budgetBytes = /export const PROPOSALS_BUDGET_BYTES = (\d+) \* 1024 \* 1024;/.exec(budgetSrc);
  const overheadBytes = /export const PROPOSAL_FILE_OVERHEAD_BYTES = (\d+) \* 1024;/.exec(budgetSrc);
  const digestBytes = /export const MAX_STORE_DIGEST_TOTAL_BYTES = (\d+) \* 1024 \* 1024;/.exec(code(raw[DIGEST]));
  if (!budgetBytes || !overheadBytes || !digestBytes) E("DW-12", "the budget, the file overhead or the digest bound is not a plain number of mebibytes or kibibytes");
  else {
    const room = Number(digestBytes[1]) * 1048576 - Number(budgetBytes[1]) * 1048576 - Number(overheadBytes[1]) * 1024;
    if (Number(budgetBytes[1]) < 1 || room < 1048576) E("DW-12", "the budget plus one file's overhead is not at least 1 MiB under the bound the store digest refuses above");
  }
  if (!has(budgetSrc, PIN.budgetCountCheck, PIN.budgetRootsCounted, PIN.budgetWalkCount, PIN.budgetDepth, PIN.budgetNewStore, PIN.budgetNewDirs, PIN.budgetNewFile, PIN.budgetImport) || /\b2000\b|\b2_000\b/.test(budgetSrc)) E("DW-12", "the budget does not count entries the way the digest counts them (the roots, every directory, every file, the new file and the directories it creates) against the digest's own bound");
  if (!door.includes(PIN.doorBudgetText)) E("DW-12", "the budget refusal message does not say that decided proposals stay on disk and still count");
  if (!has(budgetSrc, PIN.budgetNullRefusal, PIN.budgetFits, PIN.budgetOverhead, PIN.budgetEstimate, PIN.budgetRoots, PIN.budgetLink, PIN.budgetAgain, PIN.budgetUnmeasurable)) E("DW-12", "the budget does not measure both store roots as the digest does, count the entry, or refuse a store it cannot measure");

  // DW-R: registered in both runners, identical, immediately before the provider roles validator
  const a = modulesOf(raw[VA]);
  const c = modulesOf(raw[CR]);
  for (const [name, list] of [["validate-all.cjs", a], ["cached-runner.cjs", c]]) {
    if (list === null || !list.includes(THIS)) E("DW-R", `${THIS} is not registered in ${name}`);
    else if (list.indexOf(THIS) + 1 !== list.indexOf(NEXT)) E("DW-R", `${THIS} is not immediately before ${NEXT} in ${name}`);
  }
  if (a !== null && c !== null && JSON.stringify(a.slice(a.indexOf(THIS) - 1)) !== JSON.stringify(c.slice(c.indexOf(THIS) - 1))) E("DW-R", "the two runners do not list the same validators from this one on");
  for (const rel of [VA, CR]) {
    const text = raw[rel].replace(/\r\n/g, "\n");
    if (!new RegExp(`\\n  // PROJECTOS-PROPOSAL-DOOR-WIRING1A[^\\n]*\\n  "${THIS}",\\n  // PROJECTOS-PROVIDER-ROLES1A`).test(text)) E("DW-R", `${rel} has not got this validator's comment line and entry directly above the provider roles validator's`);
  }
  return errors;
}

function applyMutation(text, m) {
  let out = text.replace(m.from, () => m.to);
  for (const [from, to] of m.also || []) {
    if (!out.includes(from)) return null;
    out = out.replace(from, () => to);
  }
  return out;
}

/** Every named mutation must be killed by its own rule. Applied to CRLF-folded text, as `check` reads it. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel] === null || raw[m.rel] === undefined ? null : raw[m.rel].replace(/\r\n/g, "\n");
    if (text === null || !text.includes(m.from)) {
      errors.push(`DW-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const mutated = applyMutation(text, m);
    if (mutated === null) {
      errors.push(`DW-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: mutated }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`DW-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

/** Every agent source file, so DW-10 can see a second caller wherever it is. */
function agentSources() {
  const found = {};
  const walk = (rel) => {
    const abs = path.join(ROOT, ...rel.split("/"));
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".ts")) found[child] = fs.readFileSync(path.join(ROOT, ...child.split("/")), "utf8");
    }
  };
  walk(SRC);
  return found;
}

function run() {
  const raw = agentSources();
  for (const rel of FIXED) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      errors.push(`DW-T: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`DW-T: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-proposal-door-wiring1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log(`val-projectos-proposal-door-wiring1a: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
