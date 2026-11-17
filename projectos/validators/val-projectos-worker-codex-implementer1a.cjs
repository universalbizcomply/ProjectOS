"use strict";
/**
 * CODEX IMPLEMENTER — PROJECTOS-WORKER-CODEX-IMPLEMENTER1A (plan 4.1a).
 *
 * The Stage 4 exit proof needs the implementer and the reviewer to be swappable by configuration. Only Claude
 * could implement; this phase adds a Codex implementer kind. Each rule below is pinned because every way of
 * undoing it reads reasonably in a diff:
 *
 *   WI-1  "Codex's default sandbox is fine"              — and the worker runs with whatever the owner's config says
 *   WI-2  "let the config widen it when a phase needs to" — and `danger-full-access` or a bypass flag reaches the line
 *   WI-3  "an implementer may also review"               — and "a different provider reviewed it" depends on config;
 *         "resume the Codex session"                      — and a cut-off run is continued from text nobody checked
 *   WI-4  "the sandbox is the write boundary"           — it covers the whole checkout, `.projectops/authority/` included;
 *         the loop's grants are judged on the candidate before and after, and a breach refuses the run
 *   WI-5  "the worker may be handed what it needs"      — no key, token or login material; a credential-shaped reply is
 *         withheld; the raw event stream (command output) never reaches a record
 *   WI-6  "a tool call or an unknown item is fine"      — a steered or failed run is refused, not certified
 *   WI-7  "an attempt need not be bounded"              — and a hung worker holds the run forever
 *   WI-8  "the loop can lean on the editor"             — nothing in the loop may depend on VS Code
 *   WI-9  "the adapter exists, so it is wired"          — and the kind is configurable but never runs; and a cycle with the
 *         Claude adapter would make the registry depend on load order
 *   WI-10 "the scope check can be approximate"          — a prefix of a name is not a parent directory, a glob is one path
 *         segment, and `.git*`, `.claude`, `.codex`, `.agents`, CLAUDE.md and AGENTS(.override).md are out of scope under
 *         any grant
 *   WI-12 "git is only reading"                         — a filter driver the worker wrote would run inside the check
 *         itself; git runs isolated, every driver is switched off, content is hashed raw, a partial read refuses
 *   WI-13 "status shows what changed"                   — not an ignored path, not a committed change, not a file under a
 *         skip-worktree flag or a new exclude pattern, not the origin of a rename; each is compared too
 *         (ECC SECURITY 1-5 and Agency application-security-engineer F1, F2, F4, F5, F7, on the first build)
 *
 * PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (plan 4.3a) makes the scope PREVENTATIVE: the worker runs in a scratch copy of the checkout and
 * only granted changes are copied back. Each way of undoing that reads reasonably in a diff:
 *
 *   WI-14 "run it in the real checkout, the snapshot will catch it" — detective again; the worker's cwd, --cd, sentence, brief
 *         root and record paths are the scratch's, the records are placed there, and commands are judged against the scratch
 *   WI-15 "copy everything"                              — `.env`, `node_modules`, `.git` and agent control paths come across; the file
 *         list is git's (isolated, `-z`, tracked or untracked-not-ignored), never `.git`, a link or a control path
 *   WI-16 "a worktree or a clone is cheaper"             — it shares the real `.git` (config, hooks, refs) or keeps a remote; the scratch
 *         is a standalone `git init` with no template
 *   WI-17 "write what is acceptable, report the rest"    — the judgement is by content hash, covers EVERY difference and writes nothing
 *         unless all are allowed; nothing is copied before it, and a never-inspected scratch copies nothing
 *   WI-18 "a link or a delete is probably fine"          — a link or reparse point, a file/directory swap, a deletion, an agent control path
 *         and a path outside the grants are each refused; links are recorded and never entered
 *   WI-19 "the path came from our own scratch"           — a name with `..`, a drive, a colon, a backslash or a trailing dot is never trusted
 *   WI-20 "the real destination is just a path"          — a link or a file in the way, or a directory where a file belongs, refuses
 *   WI-21 "the copy worked if no error was thrown"       — every copied file is hashed at its destination and any failure undoes the copy
 *   WI-22 "cleanup can wait"                             — the scratch is removed in a finally on every path, and a failed removal is reported
 *   WI-23 "copy back even a refused run"                 — a refused run (steered, failed) leaves the real tree byte-identical; the
 *         judgement precedes the copy and the real-root snapshot stays as the backstop
 *   WI-24 "the adapter may touch the disk or run git"    — it spawns once; the file system and git live in the scratch module and writeScope
 *   WI-25 "build the git read again here"                — one isolated git runner, shared with the snapshot, never copied
 *
 * Each rule has a NAMED MUTATION; `selfTest` applies it in memory and counts it killed only when THAT rule fires.
 * Comments are stripped first. Reads files; runs nothing, calls no provider, runs no Codex.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ADAPTER_REL = "projectos/agent/src/loop/adapters/codexImplementer.ts";
const SCOPE_REL = "projectos/agent/src/loop/writeScope.ts";
const CLAUDE_REL = "projectos/agent/src/loop/adapters/claudeCodeCli.ts";
const CODEX_REL = "projectos/agent/src/loop/adapters/codexCli.ts";
const SCRATCH_REL = "projectos/agent/src/loop/scratchCheckout.ts";
const LOOP_DIR = "projectos/agent/src/loop";
const FIXED = [ADAPTER_REL, SCOPE_REL, CLAUDE_REL, CODEX_REL, SCRATCH_REL];

const TESTS = {
  "projectos/agent/test/codexImplementerAdapter.test.ts": [
    "runs codex exec in the workspace-write sandbox, in the checkout, with the pointer sentence as the prompt",
    "never forwards the grants to Codex",
    "refuses a write outside the grants and names the path",
    "refuses a path that only shares a prefix with a granted directory or file",
    "a glob grant matches one path segment only",
    "refuses when the candidate cannot be read after the run: a blind check is not a check",
    "reads git under the isolated environment with the config-driven programs switched off",
    "a credential-shaped reply",
    "refuses a new git-ignored entry outside the grants",
    "compares an ignored file by content, so an edit to an existing .env or owner control is seen",
    "own gatekeeper asking records, which the candidate leaves out",
    "refuses a commit, an index flag and an exclude pattern, each of which would hide a change from status",
    "counts the origin of a rename as a removal, even when the new path is granted",
    "switches off every filter driver the configuration defines at that moment, including one the worker added",
    "reads a path with a space or non-ASCII characters as it is, and names it",
    "withholds credential-shaped text from a failed turn, an error item and the stderr of an exit",
    "refuses a command that %s",
    "has no review, and rejoin refuses without spawning, even with a handle",
    // PROJECTOS-WORKER-SCRATCH-CHECKOUT1A
    "runs Codex in the scratch, never in the real checkout",
    "writes a copy of the brief whose root and record paths point into the scratch",
    "places the evidence, findings, effects and stored-context files that exist in the real checkout, and only those",
    "runs in order: open, place, record the baseline, run, judge, copy back, remove",
    "rule 3: a judgement that refuses the copy-back refuses the run, names the paths, copies nothing and still removes the scratch",
    "rule 10: a steered or failed run copies nothing back, even when its changes were all inside the grants",
    "rule 12: the scratch is removed when the spawn throws, and the error is not swallowed",
    "rule 12: a failed cleanup is reported with the outcome, never swallowed",
    "keeps the real-root snapshot as the backstop: a write that reaches the real checkout is refused even when the scratch is clean",
    "the adapter file imports no file system and runs no git of its own",
    "review F1(c): the real-root snapshot is taken after the copy-back, so a write that lands with the copy outside the grants is refused and named",
    "treats %s as out of scope even beneath a directory grant",
    "recheck N3: a refusal after the copy-back says what the copy-back did",
    "a real-root breach after %s names it in the refusal",
    "an unreadable real root after %s names it in the refusal",
    "recheck N4: a path with a bidirectional override is shown escaped in a refusal",
  ],
  "projectos/agent/test/scratchCheckout.test.ts": [
    "rule 1: holds the tracked and untracked files byte for byte, and never .git, an ignored file or an agent control path",
    "rule 2: is a standalone repository with no remote and no link to the real .git",
    "rule 3: a changed file outside the grants refuses the whole copy-back, and nothing is written to the real tree",
    "rule 3: a change is found by content, not size or time",
    "is refused even though the directory docs is granted",
    "rule 5: a new junction anywhere in the scratch refuses, and is never followed",
    "rule 6: a file that became a directory, and a directory that became a file, refuse",
    "rule 7: a real destination that passes through a link refuses, and nothing is written through it",
    "rule 8: deleting a granted file refuses, even when the file is granted by name or by directory",
    "rule 9: a write made and undone leaves no trace, and nothing is copied",
    "rule 10: a refused run leaves the real tree byte-identical, however much of it was acceptable",
    "rule 11: the worker-owned records are copied back like any granted path",
    "never trusts a path from the scratch",
    "restores the real tree when a copy fails part-way, and says it did",
    "restores the real tree when the bytes written are not the bytes that were judged",
    "dispose removes the whole scratch, including a link the worker made",
    "a failed cleanup is reported, never swallowed, and does not throw",
    // the independent review: REAL-DIRECTORY tests, so deleting them fails the validator
    "F1: a short-name alias of a real control file is refused, whatever the grants, and the real control files are not overwritten",
    "F1: a destination that exists under another spelling",
    "F1: the control-path set also covers the other agents",
    "F2: every reserved name is refused as a path segment",
    "F2: real files with reserved names made in a scratch are refused, never copied, and never opened by the walk",
    "F3: files that git lists beneath an untracked junction are not exported, and are reported as skipped",
    "F4: a junction planted where the backup used to be is never written through",
    "F4: the backup directory is made at copy time, outside the scratch holder, and removed with the scratch",
    "F4: a staging directory that is a link, or is not empty, is refused before any real file is touched",
    "a file with more than one hard link is refused when it would be copied back",
    "what is judged in the scratch after the run is bounded by the same limits as the export",
    "refusal text escapes control, bidirectional-override and other format characters, and is bounded",
    "rule 9 as a scenario",
    // the recheck (N1, N4, N5, N6): real directories again
    "N1: an honest edit is accepted when git",
    "N4: a bidi override, zero-width, line-separator, byte-order-mark or tag character is not a plain path segment",
    "N4: a real file named with a right-to-left override in a scratch is refused, never copied, and shown escaped",
    "N5: each is a control path under a directory grant",
  ],
  "projectos/agent/test/codexImplementerScratch.test.ts": [
    "rule 3 and 10: one change outside the grants refuses the run, names it, and leaves the real tree byte-identical",
    "rule 3 and 11: copies back exactly the granted changes and the worker-owned records, and removes the scratch",
    "keeps the real-root snapshot as the backstop: a worker that writes the real tree through a junction is refused and named",
    "removes the scratch when the worker throws",
    "review F1(c): a write that lands in the real tree with the copy-back is seen by the backstop, which is taken after the copy",
  ],
  "projectos/agent/test/workerRoleSwap.test.ts": [
    "Codex implements and Claude reviews, through the same loop functions and no source change",
    "the two projects differ only in the committed worker config",
    "a Codex implementer cannot be configured as the reviewer, and the Codex reviewer cannot be the implementer",
  ],
};

const PIN = {
  sandboxConst: "const WORKSPACE_WRITE_SANDBOX: readonly string[] = ['--sandbox', 'workspace-write'];",
  argvBuild: "...splitArgs(worker.args).forwarded, ...WORKSPACE_WRITE_SANDBOX, ...WINDOWS_SANDBOX, ...FIXED_ARGS, '--cd', root, instruction];",
  sandboxGate: "return sandbox === null ? { ok: true, argv } : { ok: false, problem: sandbox };",
  sandboxExactlyOne: "flags[(sandboxAt[0] as number) + 1] !== 'workspace-write'",
  widenedUsed: "(FORBIDDEN_TOKENS.has(a.split('=')[0] as string) || attached(a))",
  attachedForms: "const attached = (a: string) => /^-[csp]./.test(a) || /^--(config|sandbox|profile)=/.test(a);",
  pairOnce: "if (pairAt.length > 1) return 'the Codex command line carries the Windows sandbox mode more than once';",
  unknownRefused: "`'${flag}' is not an argument a Codex implementer may be configured with; permitted: ` +",
  grantsNotForwarded: "if (!GRANT_FLAGS.includes(arg)) {\n      forwarded.push(arg);",
  forbidden: [
    "['--dangerously-bypass-approvals-and-sandbox',",
    "['--full-auto',",
    "['danger-full-access',",
    "['--add-dir',",
    "['-s',",
    "['--sandbox',",
    "['-c',",
    "['--config',",
    "['-p',",
    "['--profile',",
    "['--enable',",
  ],
  rejoinRefuses: "rejoin(): WorkerOutcome {\n      return { kind: 'refused', detail: CODEX_IMPLEMENTER_NOT_RESUMABLE };",
  // PROJECTOS-CONTEXT-CODEX1A: the refusal is gone; the context path is turned into the project-relative pointer by an INJECTED function (this file
  // imports nothing from the Claude adapter) and both sentences are given it.
  contextRefused: "a '${CODEX_IMPLEMENTER}' worker is not told where it is",
  contextPointer: "const contextPointer = instructions.contextPointerPathOf(brief.records.contextPath, root) ?? undefined;",
  unpointableRefused: "if (brief.records.contextPath !== undefined && contextPointer === undefined) {",
  // PROJECTOS-WORKER-SCRATCH-CHECKOUT1A: both sentences are built by ONE closure over the path, so the real run's sentence names the
  // scratch brief and the probe that validates the arguments names the real one; the pointer is on both.
  startPointed: ": instructions.pointerInstruction(path, contextPointer);",
  correctionPointed: "? instructions.correctionInstruction(path, contextPointer)",
  pointerInjected: "readonly contextPointerPathOf: (contextPath: unknown, root: unknown) => string | null;",
  before: "const before = candidateSnapshot(sys, root);",
  beforeRefused: "if (before === null) return { kind: 'refused'",
  after: "const after = candidateSnapshot(sys, root);",
  afterRefused: "if (after === null) return { kind: 'refused'",
  breaches: "const breaches = scopeBreaches(before, after, scopes);",
  breachRefused: "if (breaches.length > 0) {",
  notStartedSkips: "if (result.failure !== 'not-started') {",
  scopesFromArgv: "return grantScopes(argvGrants(worker.args));",
  grantProblemsInArgs: "return [...out, ...grantScopes(argvGrants(args)).problems];",
  scrub: "scrubCredentials: true, ensureSystemPath: true,",
  credentialArg: "if (CREDENTIAL_SHAPED.test(arg)) {\n      problems.push(CREDENTIAL_ARGUMENT);",
  replyWithheld: "credentialShaped(it['text'], context.instruction)",
  translated: "stdout: JSON.stringify({ type: 'result', is_error: false, session_id: null })",
  commandChecked: "const problem = commandProblem(it, context.root) ?? (SECRET_READ.test(reported) ? 'command_execution: reads a secret file or the environment' : null);",
  secretFiles: String.raw`(?:\.env(?!\.(?:example|sample|template)\b)(?:\.[\w.-]+)?|\.npmrc|\.netrc|\.pgpass|\.pypirc|id_rsa|id_ed25519|credentials(?:\.json)?|\.aws|\.ssh|\.kube|`,
  environmentReads: String.raw`homedir\s*\(|process\.env|\bprintenv\b|`,
  safeText: "return credentialShaped(text, instruction) ? '<withheld: credential-shaped text>' : inert(text);",
  safeFailure: "failure = safeText(String((e['error'] as Record<string, unknown> | undefined)?.['message'] ?? ''), context.instruction) || 'the turn failed';",
  safeStderr: "stderr: safeText(r.stderr.trim().split(/\\r?\\n/).slice(-1)[0] ?? '', instruction), providerRef: null };",
  safeNotStarted: "`: ${safeText(r.stderr.trim(), instruction)}`",
  unknownItemDenied: "} else if (!NEUTRAL_ITEMS.has(itemType)) {",
  neutralItems: "new Set(['agent_message', 'reasoning', 'todo_list', 'file_change'])",
  failureRefused: "if (run.failure !== null) return { kind: 'refused'",
  denialsRefused: "if (run.denials.length > 0) {",
  turnRequired: "if (!run.turnCompleted) return { kind: 'refused'",
  boundTimeout: "timeoutMs: worker.timeoutMs, maxOutputBytes: WORKER_MAX_OUTPUT_BYTES,",
  boundRefused: "const unbounded = boundProblem(worker);\n      if (unbounded !== null) return { kind: 'refused', detail: unbounded };",
  wiredImport: "import { CODEX_IMPLEMENTER, codexImplementerAdapterWith } from './codexImplementer.js';",
  wired: "[CODEX_IMPLEMENTER]: codexImplementerAdapterWith({ pointerInstruction, correctionInstruction, contextPointerPathOf }),",
  reviewerWired: "[CODEX_CLI]: codexCliAdapter,",
  dirBoundary: "(s.includes('*') ? globRegex(s).test(p) : p === s || p.startsWith(`${s}/`))",
  globOneSegment: ".replace(/\\*/g, '[^/]*')",
  isolated: "const options = { isolatedGit: {}, maxOutputBytes: MAX_GIT_OUTPUT_BYTES };",
  fsmonitorOff: "'core.fsmonitor=false'",
  scopeInside: "scope === '' || scope === '.' || scope.startsWith('/') || /^[A-Za-z]:/.test(scope) || scope.split('/').includes('..')",
  unsupportedSyntax: "const UNSUPPORTED_SYNTAX = /[?[\\]{}]|\\*\\*/;",
  changedByDigest: "if (before.get(path) === after.get(path)) continue;",
  breachRule: "if (isAgentControlPath(path) || !pathInGrants(path, scopes)) changed.push(path);",
  agentSegments: String.raw`const AGENT_CONTROL_SEGMENT = /^(?:\.git.*|\.claude|\.codex|\.agents|\.husky|\.vscode|\.cursor(?:rules)?|\.windsurf(?:rules)?|\.mcp\.json|\.gemini|\.opencode|\.kiro|\.roo(?:rules)?|\.clinerules|\.continue|\.aider\.conf\.yml|\.aiderignore|\.codeium)$/i;`,
  agentFiles: String.raw`const AGENT_INSTRUCTION_FILE = /^(?:CLAUDE|AGENTS|GEMINI)(?:\.local|\.override)?\.md$/i;`,
  neutralised: "const run: GitRun = (args) => sys.exec('git', [...base, ...neutralisers, ...args], options);",
  neutraliserNull: "if (neutralisers === null) return null;",
  noFilters: "run(['hash-object', '--no-filters', '-t', 'blob', '--', ...chunk]);",
  partialHash: "if (failed(hashed) || lines.length !== chunk.length) return false;",
  configDigest: "snapshot.set(REPOSITORY_CONFIGURATION, digest(config.stdout));",
  headRecorded: "snapshot.set(REPOSITORY_HEAD, head.stdout.trim());",
  excludesRecorded: "snapshot.set(REPOSITORY_EXCLUDES, digest(",
  flagsRecorded: "if (token.length > 2 && token[0] !== 'H') snapshot.set(`${INDEX_FLAG_PREFIX}${token.slice(2)}`, token[0] as string);",
  zStatus: "run(['status', '--porcelain=v1', '-z', '--ignore-submodules=dirty', '--untracked-files=all']);",
  renameOrigin: "if (origin !== null) snapshot.set(origin, `${code}|renamed-from`);",
  ignoredListed: "snapshot.set(path, 'ignored');",
  ignoredHashed: "snapshot.set(path, `ignored|${blob}`)",
  recordsExpanded: "run(['status', '--porcelain=v1', '-z', '--ignore-submodules=dirty', '--ignored', '--untracked-files=all', '--', '.projectops']);",
  statusFailed: "if (failed(status)) return null;",
  codexExports: ["export const WINDOWS_SANDBOX:", "export function commandProblem(", "export function inert("],

  // ---- PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (adapter) ----
  scratchOpened: "const opened = scratchHost.open(sys, root);",
  scratchOpenRefused: "if (!opened.ok) return { kind: 'refused'",
  scratchCwd: "cwd: scratch.root,",
  scratchArgv: "const built = codexImplementerArgv(worker, scratch.root, instruction);",
  scratchSentence: "const instruction = sentenceFor(prepared.briefPath);",
  scratchJudgedAgainst: "outcomeFrom(result, worker.timeoutMs, instruction, scratch.root)",
  briefRoot: "repository: { ...brief.repository, root: scratch.root },",
  briefRecords: "records: { ...r, briefPath, findingsPath, effectsPath, evidencePath, ...(r.contextPath === undefined ? {} : { contextPath }) },",
  briefPlaced: "const wrote = scratch.placeText(briefPath, `${JSON.stringify(inside, null, 2)}\\n`);",
  recordsPlaced: "const placed = sys.exists(record) ? scratch.placeFile(record) : null;",
  recordsOutside: "if (inside === null || where === null) return { ok: false, problem:",
  baselineRefused: "if (baselined !== null) return { kind: 'refused'",
  inspected: "const inspected = scratch.inspect(scopes);",
  unreadableRefused: "if (inspected.kind === 'unreadable') {",
  judgementRefused: "if (inspected.kind === 'refused') return { outcome: refusedCopyBack(inspected.refusals), copyNote: NOTHING_COPIED };",
  refusedRunKept: "if (outcome.kind === 'refused') return { outcome, copyNote: NOTHING_COPIED };",
  copyCall: "const copied = scratch.copyBack();",
  copiedOnly: "if (copied.kind === 'copied') return { outcome, copyNote: `the copy-back landed ${copied.paths.length} path(s)` };",
  copyPartial: "THE CHECKOUT MAY HOLD PART OF THE COPY",
  settleCalled: "const settled = settleScratch(scratch, scopes, outcomeFrom(",
  finallyDispose: "} finally {\n        cleanup = scratch.dispose();\n      }",
  cleanupNoted: "return withCleanupNote(outcome, cleanup);",
  cleanupNote: "if (outcome.kind === 'refused') return { ...outcome, detail: `${outcome.detail}; ${note}` };",

  // ---- scratchCheckout.ts ----
  scListing: "const listed = run(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);",
  scSharedRunner: "const run = isolatedGitRunner(sys, realRoot);",
  scSharedImport: "import { isAgentControlPath, isolatedGitRunner, pathInGrants } from './writeScope.js';",
  scControlSkipped: "if (isAgentControlPath(listed)) continue;",
  scOnlyFiles: "if (st === null || st.kind !== 'file') {",
  scListedUnsafe: "if (!safeRelativePath(listed)) return { ok: false, reason:",
  scGitSkipped: "if (next.rel === '' && name === '.git') continue;",
  scInit: "const init = sys.exec('git', ['init', '-q', '--template=', root], { isolatedGit: {}, timeoutMs: 60_000 });",
  scInitRefused: "if (init.code !== 0 || init.failure !== undefined) return fail(",
  scOverlap: "if (isBelow(realBase, holderBase) || isBelow(holderBase, realBase) || resolve(realBase) === resolve(holderBase)) return fail(",
  scLstat: "const s = lstatSync(path);",
  scLinkKind: "const kind: EntryKind = s.isSymbolicLink() ? 'link' :",
  scLinkNotEntered: "if (st.kind === 'dir') {\n          manifest.set(rel, { kind: 'dir' });\n          pending.push(",
  scLinkRecorded: "else manifest.set(rel, { kind: st.kind });",
  scHashed: "const hash = createHash('sha256');",
  scStreamed: "const n = readSync(fd, chunk, 0, chunk.length, null);",
  scSame: "a === undefined || b === undefined ? a === b : a.kind === b.kind && (a.kind !== 'file' || a.hash === (b as { hash: string }).hash);",
  scUnsafe: "if (!safeRelativePath(path)) return WHY.unsafe;",
  scLink: "if (was?.kind === 'link' || now?.kind === 'link') return WHY.link;",
  scOther: "if (was?.kind === 'other' || now?.kind === 'other') return WHY.other;",
  scKindChange: "if (was !== undefined && now !== undefined && was.kind !== now.kind) return WHY.kindChange;",
  scDeleted: "if (now === undefined) return WHY.deleted;",
  scControl: "if (isAgentControlPath(path)) return WHY.control;",
  scOutside: "if (!pathInGrants(path, scopes)) return WHY.outside;",
  scAllRefusals: "if (why !== null) refusals.push({ path, why });",
  scForbidden: String.raw`const FORBIDDEN_IN_NAME = /[\u0000-\u001f<>:"|?*\\]/;`,
  scSafeHead: "if (path === '' || path.length > MAX_PATH_CHARS || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;",
  scSafeSegments: "seg !== '' && seg !== '.' && seg !== '..' && !FORBIDDEN_IN_NAME.test(seg) && !/[. ]$/.test(seg)",
  scDestinationUnsafe: "if (!safeRelativePath(rel) || relativeInside(realRoot, underRoot(realRoot, rel)) !== rel) return WHY.unsafe;",
  scThroughLink: "if (st.kind !== 'dir') return WHY.throughLink;",
  scLastLink: "st.kind === 'link' ? WHY.throughLink : WHY.inTheWay",
  scDestinationJudged: "const why = destinationProblem(fs, realRoot, w.path);\n          if (why !== null) refusals.push({ path: w.path, why });",
  scDestinationRechecked: "const why = destinationProblem(fs, realRoot, w.path);\n      if (why !== null) refusals.push({ path: w.path, why });\n    }\n  } catch (e) {\n    return { kind: 'failed', reason: described('checking the destinations', e), rolledBack: true };\n  }\n  if (refusals.length > 0) return { kind: 'refused', refusals };",
  scRefusedHeld: "if (refusals.length > 0) return (verdict = { kind: 'refused', refusals:",
  scRefusedNotCopied: "if (verdict?.kind === 'refused') return { kind: 'refused', refusals: verdict.refusals };",
  scUninspectedNotCopied: "if (verdict?.kind !== 'clean') return { kind: 'failed',",
  scVerified: "if (fs.hashFile(dest) !== w.hash) throw new CopyProblem(",
  scRolledBack: "const stuck = rollBack(fs, undo);",
  scRolledBackSaid: "rolledBack: stuck === null",
  scBackedUp: "undo.push({ step: 'restore', dest, backup });",
  scNewNoted: "if (fs.stat(dest) === null) undo.push({ step: 'remove-file', dest });",
  scDispose: "fs.removeTree(dir);\n          owned.splice(owned.indexOf(dir), 1);\n        } catch (e) {\n          stuck.push(described('removing the scratch', e));",
  scExportCleanup: "try {\n        fs.removeTree(holder);\n      } catch (e) {\n        cleanup = `; and the scratch could not be removed (${errorCode(e)})`;",
  scRemoveRetries: "rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })",

  // ---- the independent review of 001822c4 (F1 to F4 and the LOW items) ----
  scShortShape: "const SHORT_NAME_SHAPE = /~[0-9]/;",
  scShortRefused: "&& !SHORT_NAME_SHAPE.test(seg)",
  scShortNotExported: "if (hasShortNameShape(listed)) {\n      skip(listed);\n      continue;\n    }",
  scCanonicalExpected: "const expected = join(fs.realPath(realRoot), ...segments.slice(0, depth));",
  scCanonicalCompared: "return sameSpelling(fs.realPath(join(realRoot, ...segments.slice(0, depth))), expected) ? null : WHY.alias;",
  scSameSpelling: "const sameSpelling = (canonical: string, expected: string): boolean => canonical === expected || (process.platform === 'win32' && canonical.toLowerCase() === expected.toLowerCase());",
  scFormatInName: String.raw`const FORMAT_IN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;`,
  scFormatRefused: "&& !FORMAT_IN_NAME.test(seg)",
  scStepEscaped: "step = `copying ${plainName(w.path)}`;",
  scBytesEscaped: "CopyProblem(`the bytes of ${plainName(w.path)} are not the bytes that were judged`)",
  scStagingOwned: "owned.push(staging);",
  adapterFailureNote: "const failure = `the copy-back failed: ${copied.reason}; ${copied.rolledBack ? 'the checkout was restored' : 'THE CHECKOUT MAY HOLD PART OF THE COPY'}`;",
  adapterFailureNoteKept: "copyNote: failure };",
  adapterBreachNote: "Copy-back: ${settled.copyNote}`,",
  adapterAfterNullNote: "; ${settled.copyNote}` };",
  adapterNothingCopied: "const NOTHING_COPIED = 'nothing was copied back';",
  scDeviceNames: String.raw`const RESERVED_DEVICE = /^(?:CON|PRN|AUX|NUL|COM[0-9\xb2\xb3\xb9]|LPT[0-9\xb2\xb3\xb9]|CONIN\$|CONOUT\$|CLOCK\$)$/i;`,
  scDeviceStrip: "RESERVED_DEVICE.test((segment.split('.')[0] ?? '').replace(/ +$/, ''))",
  scDeviceRefused: "&& !isReservedDevice(seg)",
  scParentsDefined: "const parentsPlain = (listed: string): boolean => {",
  scParentPlain: "if (dir === null || dir.kind !== 'dir') return false;",
  scParentsUsed: "if (!parentsPlain(listed)) {\n      skip(listed);\n      continue;\n    }",
  scSkippedRecorded: "if (skipped.length < MAX_SKIPPED_NAMED) skipped.push(path);",
  scStagingMade: "staging = fs.makeTempDir('projectos-backup-');",
  scStagingChecked: "if (writes.length > 0) requireEmptyPlainDirectory(fs, stagingDir);",
  scStagingPlain: "if (st === null || st.kind !== 'dir') throw new CopyProblem('the backup location is not a plain directory');",
  scStagingEmpty: "if (fs.list(dir).length > 0) throw new CopyProblem('the backup location is not empty');",
  scHardlink: "return now.kind === 'file' && (now.links ?? 1) > 1 ? WHY.hardlink : null;",
  scLinksRecorded: "manifest.set(rel, { kind: 'file', hash: fs.hashFile(abs), links: st.links });",
  scPostRunBound: "if (files > limits.maxFiles + PLACED_FILES_SLACK || bytes > limits.maxBytes + PLACED_RECORDS_MAX * limits.maxPlacedBytes) {",
  scFormatEscaped: String.raw`value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,`,
  adapterPlainNames: "map((r) => `${plainName(r.path)} (${r.why})`);",
  adapterPlainBreaches: "const shown = breaches.slice(0, 20).map(plainName);",
};

/** A VS Code dependency in the loop: an import of the editor API, or a spawn of its launcher. */
const VSCODE_DEPENDENCY = /(?:from\s+|require\(\s*)['"]vscode['"]|['"`](?:[^'"`]*[\\/])?code(?:\.cmd|\.exe)?['"`]\s*,\s*\[|vscode:\/\//i;

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

function loopFiles() {
  const dir = path.join(ROOT, ...LOOP_DIR.split("/"));
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/${e.name}`);
      else if (e.name.endsWith(".ts")) found.push(`${rel}/${e.name}`);
    }
  };
  walk(dir, LOOP_DIR);
  return found;
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  for (const rel of FIXED) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("WI-0", `${rel} is missing`);
      return errors;
    }
  }
  const a = code(raw[ADAPTER_REL]);
  const w = code(raw[SCOPE_REL]);
  const cl = code(raw[CLAUDE_REL]);
  const cx = code(raw[CODEX_REL]);

  // WI-1 — the sandbox is the adapter's, and exactly workspace-write.
  if (![PIN.sandboxConst, PIN.argvBuild, PIN.sandboxGate, PIN.sandboxExactlyOne].every((p) => a.includes(p))) {
    E("WI-1", "the Codex implementer no longer always runs in the one workspace-write sandbox the adapter sets, or the final gate no longer insists on it");
  }
  // WI-2 — nothing configured widens it.
  const unrefused = PIN.forbidden.filter((t) => !a.includes(t));
  if (unrefused.length > 0 || ![PIN.widenedUsed, PIN.attachedForms, PIN.pairOnce, PIN.unknownRefused, PIN.grantsNotForwarded].every((p) => a.includes(p))) {
    E("WI-2", `a sandbox-widening or approval-skipping argument can reach the Codex command line (${unrefused.join(", ") || "closed allowlist or final gate loosened"})`);
  }
  // WI-3 — the roles. This kind never reviews and never resumes; the reviewer kind never implements (its own validator).
  if (/^\s*review\s*\(|\breview\s*:/m.test(a) || !a.includes(PIN.rejoinRefuses)) {
    E("WI-3", "the Codex implementer can review or resume");
  }
  // PROJECTOS-CONTEXT-CODEX1A: a brief that names stored context is no longer refused here (the kind is context-pointable); the worker is TOLD
  // instead, by both sentences, from the injected pointer-path function. A refusal left in, or a sentence that drops the pointer, is the old defect
  // (a run recorded as shown to a worker that was not pointed at the file) or its mirror (a refusal that blocks every project that has memory).
  if (a.includes(PIN.contextRefused) || !a.includes(PIN.contextPointer) || !a.includes(PIN.unpointableRefused) || !a.includes(PIN.startPointed) || !a.includes(PIN.correctionPointed) || !a.includes(PIN.pointerInjected)) {
    E("WI-3", "the Codex implementer refuses a brief that names stored context, or does not give both of its sentences the pointer the injected function derives");
  }
  // WI-4 — scope is judged on the candidate before and after the run; a breach or a blind check refuses.
  const iBefore = a.indexOf(PIN.before);
  const iExec = a.indexOf("sys.exec(worker.command");
  const iAfter = a.indexOf(PIN.after);
  if (![PIN.beforeRefused, PIN.afterRefused, PIN.breaches, PIN.breachRefused, PIN.notStartedSkips, PIN.scopesFromArgv, PIN.grantProblemsInArgs].every((p) => a.includes(p)) ||
      iBefore < 0 || iExec < 0 || iAfter < 0 || !(iBefore < iExec && iExec < iAfter)) {
    E("WI-4", "the write scope is no longer judged on the candidate before and after the run, or an unreadable candidate or a breach no longer refuses it");
  }
  // WI-5 — no credential in, none out, and never the raw stream.
  if (![PIN.scrub, PIN.credentialArg, PIN.replyWithheld, PIN.translated].every((p) => a.includes(p)) || ![PIN.safeText, PIN.safeFailure, PIN.safeStderr, PIN.safeNotStarted].every((p) => a.includes(p)) || /[,{]\s*env\s*:/.test(a) || /stdout:\s*r\.stdout/.test(a)) {
    E("WI-5", "the Codex implementer can be handed a credential, a credential-shaped reply is no longer withheld, or the raw event stream reaches the outcome");
  }
  // WI-6 — a steered or failed run is refused.
  if (![PIN.commandChecked, PIN.secretFiles, PIN.environmentReads, PIN.unknownItemDenied, PIN.neutralItems, PIN.failureRefused, PIN.denialsRefused, PIN.turnRequired].every((p) => a.includes(p))) {
    E("WI-6", "a command outside the checkout, a tool call, an unknown item, a failed turn or an unfinished run is no longer refused");
  }
  // WI-7 — bounded: one spawn, and it carries the bound.
  const spawns = a.split("sys.exec(").length - 1;
  if (spawns !== 1 || !a.includes(PIN.boundTimeout) || !a.includes(PIN.boundRefused)) {
    E("WI-7", "the Codex implementer spawns more than once, or its spawn is no longer bounded, or an unbounded worker is no longer refused");
  }
  // WI-8 — nothing in the loop depends on the editor.
  const offenders = Object.keys(raw)
    .filter((rel) => rel.startsWith(`${LOOP_DIR}/`) && raw[rel] !== null && raw[rel] !== undefined)
    .filter((rel) => VSCODE_DEPENDENCY.test(code(raw[rel])));
  if (offenders.length > 0) E("WI-8", `the loop depends on VS Code (${offenders.join(", ")})`);
  // WI-9 — wired, with the reviewer kind beside it, and no import cycle with the Claude adapter.
  if (!cl.includes(PIN.wiredImport) || !cl.includes(PIN.wired) || !cl.includes(PIN.reviewerWired) || /from\s+['"]\.\/claudeCodeCli\.js['"]/.test(a)) {
    E("WI-9", "the codex-implementer-cli kind is not wired into BUILT_IN_ADAPTERS beside codex-cli, or its file imports the Claude adapter (a cycle)");
  }
  // WI-10 — the scope check is exact, isolated and fail-closed.
  if (![PIN.dirBoundary, PIN.globOneSegment, PIN.scopeInside, PIN.unsupportedSyntax, PIN.changedByDigest, PIN.breachRule, PIN.agentSegments, PIN.agentFiles].every((p) => w.includes(p))) {
    E("WI-10", "the scope rule is no longer exact: directory boundary, one-segment glob, contents compared, agent and git control paths out of scope under any grant");
  }
  // WI-12 — git runs isolated and cannot be made to run the worker's program; an unreadable checkout refuses.
  if (![PIN.isolated, PIN.fsmonitorOff, PIN.neutralised, PIN.neutraliserNull, PIN.noFilters, PIN.partialHash, PIN.statusFailed].every((p) => w.includes(p))) {
    E("WI-12", "the scope snapshot no longer runs git isolated with every filter driver switched off, or a partial or failed read no longer refuses");
  }
  // WI-13 — what status cannot show is compared too.
  if (![PIN.configDigest, PIN.headRecorded, PIN.excludesRecorded, PIN.flagsRecorded, PIN.zStatus, PIN.renameOrigin, PIN.ignoredListed, PIN.ignoredHashed, PIN.recordsExpanded].every((p) => w.includes(p))) {
    E("WI-13", "the scope snapshot no longer covers ignored paths, the records under .projectops, both paths of a rename, non-ASCII names, or the git state that hides a change (configuration, HEAD, index flags, info/exclude)");
  }
  // ---- PROJECTOS-WORKER-SCRATCH-CHECKOUT1A ----
  const sc = code(raw[SCRATCH_REL]);
  const has = (text, pins) => pins.every((p) => text.includes(p));
  const count = (text, pin) => text.split(pin).length - 1;
  // WI-14 — the worker runs in the scratch: cwd, --cd, sentence, brief copy, placed records, commands judged against the scratch.
  const iOpen = a.indexOf(PIN.scratchOpened);
  if (!has(a, [PIN.scratchOpened, PIN.scratchOpenRefused, PIN.scratchCwd, PIN.scratchArgv, PIN.scratchSentence, PIN.briefRoot, PIN.briefRecords, PIN.briefPlaced, PIN.recordsPlaced, PIN.recordsOutside, PIN.baselineRefused]) ||
      count(a, PIN.scratchJudgedAgainst) !== 2 || iOpen < 0 || !(iOpen < iExec)) {
    E("WI-14", "the Codex worker no longer runs in a scratch copy: its cwd, --cd, sentence, brief root and record paths, the placed records, or the root its commands are judged against is the real checkout's");
  }
  // WI-15 — what the scratch holds: git's isolated list, never `.git`, a link, a control path or an ignored file.
  if (!has(sc, [PIN.scListing, PIN.scSharedRunner, PIN.scControlSkipped, PIN.scOnlyFiles, PIN.scListedUnsafe, PIN.scGitSkipped]) || /'--ignored'|\bcheckout-index\b|'add'\s*,\s*'-f'/.test(sc)) {
    E("WI-15", "the scratch no longer holds exactly git's tracked or untracked-not-ignored files, without .git, links or agent control paths");
  }
  // WI-16 — a standalone repository: no worktree, no clone, no remote, no shared object store.
  if (!has(sc, [PIN.scInit, PIN.scInitRefused, PIN.scOverlap]) || /'(?:worktree|clone|remote|submodule)'|--reference|--shared|--separate-git-dir|alternates/.test(sc)) {
    E("WI-16", "the scratch is no longer a standalone `git init` with no template, remote or link to the real .git, or it may overlap the checkout");
  }
  // WI-17 — judged by content, every difference, before any write; a refused or never-inspected scratch copies nothing.
  if (!has(sc, [PIN.scHashed, PIN.scStreamed, PIN.scSame, PIN.scAllRefusals, PIN.scRefusedHeld, PIN.scRefusedNotCopied, PIN.scUninspectedNotCopied, PIN.scDestinationRechecked]) || /statSync\(|\.size\s*===|mtime/.test(sc.replace(/lstatSync\(/g, ""))) {
    E("WI-17", "the scratch is no longer judged by content hash over every difference before anything is written, or a refused or uninspected scratch can be copied");
  }
  // WI-18 — what is refused, and links are recorded, never entered.
  if (!has(sc, [PIN.scLink, PIN.scOther, PIN.scKindChange, PIN.scDeleted, PIN.scControl, PIN.scOutside, PIN.scLstat, PIN.scLinkKind, PIN.scLinkNotEntered, PIN.scLinkRecorded]) || /(?<![A-Za-z])statSync\(|withFileTypes|followSymlinks|dereference/.test(sc)) {
    E("WI-18", "a link, a file/directory swap, a deletion, an agent control path or a path outside the grants is no longer refused, or a link is followed");
  }
  // WI-19 — a path from the scratch or from git is never trusted.
  if (!has(sc, [PIN.scForbidden, PIN.scSafeHead, PIN.scSafeSegments, PIN.scUnsafe, PIN.scDestinationUnsafe])) {
    E("WI-19", "a path with `..`, a drive, a colon, a backslash, a control character or a trailing dot is no longer refused before it is used");
  }
  // WI-20 — the real destination.
  if (!has(sc, [PIN.scThroughLink, PIN.scLastLink, PIN.scDestinationJudged])) {
    E("WI-20", "a real destination that passes through a link, or has a directory where a file belongs, is no longer refused at judgement");
  }
  // WI-21 — a copy is verified at its destination and undone on any failure.
  if (!has(sc, [PIN.scVerified, PIN.scRolledBack, PIN.scRolledBackSaid, PIN.scBackedUp, PIN.scNewNoted])) {
    E("WI-21", "a copied file is no longer hashed at its destination, or a failed copy is no longer undone and reported as restored or not");
  }
  // WI-22 — removed on every path, and a failed removal is said.
  if (!has(a, [PIN.finallyDispose, PIN.cleanupNoted, PIN.cleanupNote]) || !has(sc, [PIN.scDispose, PIN.scExportCleanup, PIN.scRemoveRetries, PIN.scStagingOwned])) {
    E("WI-22", "the scratch is no longer removed in a finally on every path, or a failed removal is swallowed");
  }
  // WI-23 — judge, then copy; a refused run copies nothing; the real-root snapshot stays the backstop and comes first.
  const iInspect = a.indexOf(PIN.inspected);
  const iKept = a.indexOf(PIN.refusedRunKept);
  const iCopy = a.indexOf(PIN.copyCall);
  const iBreach = a.indexOf(PIN.breaches);
  const iSettle = a.indexOf(PIN.settleCalled);
  if (!has(a, [PIN.inspected, PIN.unreadableRefused, PIN.judgementRefused, PIN.refusedRunKept, PIN.copyCall, PIN.copiedOnly, PIN.copyPartial, PIN.settleCalled]) ||
      iInspect < 0 || iKept < 0 || iCopy < 0 || !(iInspect < iKept && iKept < iCopy) || iBreach < 0 || iSettle < 0 || !(iSettle < iBreach) || count(a, "scratch.copyBack()") !== 1) {
    E("WI-23", "the judgement no longer precedes the copy, a refused run can be copied back, an unreadable scratch is accepted, or the real-root snapshot is no longer taken AFTER the copy-back (review F1(c): the backstop must judge what landed)");
  }
  // WI-24 — the adapter has no file system and no git of its own; its single spawn is the worker's (WI-7).
  if (/from\s+['"]node:(?:fs|child_process|os)['"]|require\(\s*['"](?:node:)?(?:fs|child_process)['"]/.test(a) || /sys\.exec\(\s*['"]git['"]/.test(a)) {
    E("WI-24", "the Codex adapter touches the file system or runs git itself (the scratch module and writeScope do, and the adapter spawns only the worker)");
  }
  // WI-25 — one isolated git runner, shared.
  const wScope = w;
  if (!wScope.includes("export function isolatedGitRunner(sys: System, root: string): GitRun | null {") || !wScope.includes("const run = isolatedGitRunner(sys, root);") || !sc.includes(PIN.scSharedImport) || /core\.fsmonitor/.test(sc)) {
    E("WI-25", "the scratch export no longer reads git through the shared isolated runner that the snapshot uses, or the runner is no longer shared");
  }
  // ---- the independent review of 001822c4. The text pins below pin the CODE; the real-directory tests named in TESTS are what prove it, and
  // deleting those tests fails WI-T. (The review reproduced F1 to F3 with real directories after text pins and logic tests had passed.) ----
  // WI-26 (F1) — an alias of a control file: 8.3 short-name shapes are refused, the destination must be its own canonical path, the backstop is
  // taken after the copy (WI-23), and the other agents' control files are control paths (WI-10).
  if (!has(sc, [PIN.scShortShape, PIN.scShortRefused, PIN.scShortNotExported, PIN.scCanonicalExpected, PIN.scCanonicalCompared, PIN.scSameSpelling])) {
    E("WI-26", "a path shaped like an 8.3 short name, or a destination that is not its own canonical path (a short name, another case), is no longer refused");
  }
  // WI-27 (F2) — Windows device names, in any case, with or without an extension, including the superscript digits.
  if (!has(sc, [PIN.scDeviceNames, PIN.scDeviceStrip, PIN.scDeviceRefused])) {
    E("WI-27", "a Windows device name (NUL, CON.txt, aux, COM1, LPT1.log, CONIN$ and the superscript forms) is no longer refused as a path segment");
  }
  // WI-28 (F3) — the export lstats every parent component and copies only below plain directories; what it did not copy is recorded.
  if (!has(sc, [PIN.scParentsDefined, PIN.scParentPlain, PIN.scParentsUsed, PIN.scSkippedRecorded])) {
    E("WI-28", "the export no longer checks every parent component of a listed path (a junction beneath the root is followed out of it), or skipped paths are not recorded");
  }
  // WI-29 (F4) — the backup location is made at copy time with mkdtemp, outside the holder, and used only while an empty plain directory.
  if (!has(sc, [PIN.scStagingMade, PIN.scStagingChecked, PIN.scStagingPlain, PIN.scStagingEmpty]) || /join\(holder,\s*'(?:backup|staging|tmp)/.test(sc)) {
    E("WI-29", "the backup location is predictable, sits inside the directory the worker runs in, or is used without being checked to be an empty plain directory");
  }
  // WI-30 (LOW) — a hard-linked file is not copied back; the scratch is bounded after the run; refusal text escapes format characters.
  if (!has(sc, [PIN.scHardlink, PIN.scLinksRecorded, PIN.scPostRunBound, PIN.scFormatEscaped]) || !has(a, [PIN.adapterPlainNames, PIN.adapterPlainBreaches]) || /inert\(r\.path\)/.test(a)) {
    E("WI-30", "a hard-linked file can be copied back, what is judged after the run is unbounded, or a refusal shows control or bidirectional-format characters unescaped");
  }
  // WI-31 (recheck N4) — a format or bidirectional character is not a plain path segment, and no message prints a path unescaped.
  if (!has(sc, [PIN.scFormatInName, PIN.scFormatRefused, PIN.scStepEscaped, PIN.scBytesEscaped])) {
    E("WI-31", "a bidirectional override, zero-width, separator or other format character is allowed in a copied-back path, or a message prints a path without escaping it");
  }
  // WI-32 (recheck N3) — a refusal after the copy-back (a real-root breach, an unreadable real root) says what the copy-back did, including a partial one.
  if (!has(a, [PIN.adapterFailureNote, PIN.adapterFailureNoteKept, PIN.adapterBreachNote, PIN.adapterAfterNullNote, PIN.adapterNothingCopied]) || count(a, "settled.copyNote") !== 2) {
    E("WI-32", "a refusal after the copy-back no longer says plainly what the copy-back did (copied N paths, rolled back, or MAY HOLD PART OF THE COPY)");
  }
  // The reviewer file only gained exports, so the exit-proof reviewer is unchanged in behaviour.
  if (!PIN.codexExports.every((p) => cx.includes(p))) {
    E("WI-11", "codexCli.ts no longer exports what the implementer reuses (WINDOWS_SANDBOX, commandProblem, inert), so it would be copied instead of shared");
  }
  return errors;
}

const MUTATIONS = [
  { name: "sandbox-not-workspace-write", rule: "WI-1", rel: ADAPTER_REL, from: PIN.sandboxConst, to: "const WORKSPACE_WRITE_SANDBOX: readonly string[] = ['--sandbox', 'danger-full-access'];" },
  { name: "sandbox-left-off-argv", rule: "WI-1", rel: ADAPTER_REL, from: "...WORKSPACE_WRITE_SANDBOX, ...WINDOWS_SANDBOX, ...FIXED_ARGS,", to: "...WINDOWS_SANDBOX, ...FIXED_ARGS," },
  { name: "sandbox-gate-ignored", rule: "WI-1", rel: ADAPTER_REL, from: PIN.sandboxGate, to: "return { ok: true, argv };" },
  { name: "sandbox-value-not-checked", rule: "WI-1", rel: ADAPTER_REL, from: PIN.sandboxExactlyOne, to: "flags[(sandboxAt[0] as number) + 1] !== 'read-only'" },
  { name: "bypass-no-longer-refused", rule: "WI-2", rel: ADAPTER_REL, from: "  ['--dangerously-bypass-approvals-and-sandbox', 'skips every approval and the sandbox'],\n", to: "" },
  { name: "full-auto-no-longer-refused", rule: "WI-2", rel: ADAPTER_REL, from: "  ['--full-auto', 'turns on a writable sandbox with its own approval policy'],\n", to: "" },
  { name: "full-access-no-longer-refused", rule: "WI-2", rel: ADAPTER_REL, from: "  ['danger-full-access', 'removes the sandbox'],\n", to: "" },
  { name: "add-dir-no-longer-refused", rule: "WI-2", rel: ADAPTER_REL, from: "  ['--add-dir', 'makes another directory writable'],\n", to: "" },
  { name: "config-override-no-longer-refused", rule: "WI-2", rel: ADAPTER_REL, from: "  ['-c', 'overrides configuration, including the sandbox and approval policy'],\n", to: "" },
  { name: "profile-no-longer-refused", rule: "WI-2", rel: ADAPTER_REL, from: "  ['--profile', 'loads a profile, which can set the sandbox'],\n", to: "" },
  { name: "attached-override-forms-admitted", rule: "WI-2", rel: ADAPTER_REL, from: PIN.widenedUsed, to: "FORBIDDEN_TOKENS.has(a.split('=')[0] as string)" },
  { name: "windows-sandbox-repeat-admitted", rule: "WI-2", rel: ADAPTER_REL, from: PIN.pairOnce, to: "" },
  { name: "unknown-argument-passes", rule: "WI-2", rel: ADAPTER_REL, from: PIN.unknownRefused, to: "`ignored ${flag}` +" },
  { name: "grants-forwarded-to-codex", rule: "WI-2", rel: ADAPTER_REL, from: PIN.grantsNotForwarded, to: "if (true) {\n      forwarded.push(arg);" },
  { name: "implementer-can-review", rule: "WI-3", rel: ADAPTER_REL, from: "    rejoin(): WorkerOutcome {", to: "    review(): WorkerOutcome {\n      return { kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: null };\n    },\n\n    rejoin(): WorkerOutcome {" },
  { name: "implementer-rejoins", rule: "WI-3", rel: ADAPTER_REL, from: PIN.rejoinRefuses, to: "rejoin(): WorkerOutcome {\n      return { kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: null };" },
  { name: "unpointable-context-starts-a-worker", rule: "WI-3", rel: ADAPTER_REL, from: PIN.unpointableRefused, to: "if (false) {" },
  { name: "stored-context-ignored", rule: "WI-3", rel: ADAPTER_REL, from: PIN.contextPointer, to: "const contextPointer = undefined;" },
  { name: "start-sentence-without-the-pointer", rule: "WI-3", rel: ADAPTER_REL, from: PIN.startPointed, to: ": instructions.pointerInstruction(path);" },
  { name: "correction-sentence-without-the-pointer", rule: "WI-3", rel: ADAPTER_REL, from: PIN.correctionPointed, to: "? instructions.correctionInstruction(path)" },
  { name: "stored-context-refused-again", rule: "WI-3", rel: ADAPTER_REL, from: PIN.contextPointer, to: "if (brief.records.contextPath !== undefined) return { kind: 'refused', detail: `a '${CODEX_IMPLEMENTER}' worker is not told where it is` }; " + PIN.contextPointer },
  { name: "no-snapshot-before", rule: "WI-4", rel: ADAPTER_REL, from: PIN.beforeRefused, to: "if (false) return { kind: 'refused'" },
  { name: "no-snapshot-after", rule: "WI-4", rel: ADAPTER_REL, from: PIN.afterRefused, to: "if (false) return { kind: 'refused'" },
  { name: "breach-not-refused", rule: "WI-4", rel: ADAPTER_REL, from: PIN.breachRefused, to: "if (false) {" },
  { name: "scope-ignores-the-grants", rule: "WI-4", rel: ADAPTER_REL, from: PIN.scopesFromArgv, to: "return { scopes: ['.'], problems: [] };" },
  { name: "scope-judged-before-the-run", rule: "WI-4", rel: ADAPTER_REL, from: PIN.after, to: "const after = before;" },
  { name: "scope-skipped-when-it-ran", rule: "WI-4", rel: ADAPTER_REL, from: PIN.notStartedSkips, to: "if (false) {" },
  { name: "grant-problems-dropped", rule: "WI-4", rel: ADAPTER_REL, from: PIN.grantProblemsInArgs, to: "return out;" },
  { name: "credentials-inherited", rule: "WI-5", rel: ADAPTER_REL, from: PIN.scrub, to: "scrubCredentials: false, ensureSystemPath: true," },
  { name: "key-in-env", rule: "WI-5", rel: ADAPTER_REL, from: PIN.scrub, to: "scrubCredentials: true, ensureSystemPath: true, env: { OPENAI_API_KEY: worker.workerId }," },
  { name: "credential-argument-accepted", rule: "WI-5", rel: ADAPTER_REL, from: PIN.credentialArg, to: "if (false) {\n      problems.push(CREDENTIAL_ARGUMENT);" },
  { name: "credential-reply-passes", rule: "WI-5", rel: ADAPTER_REL, from: PIN.replyWithheld, to: "false" },
  { name: "raw-stream-returned", rule: "WI-5", rel: ADAPTER_REL, from: PIN.translated, to: "stdout: r.stdout" },
  { name: "outside-command-passes", rule: "WI-6", rel: ADAPTER_REL, from: PIN.commandChecked, to: "const problem: string | null = null;" },
  { name: "secret-read-passes", rule: "WI-6", rel: ADAPTER_REL, from: " ?? (SECRET_READ.test(reported) ? 'command_execution: reads a secret file or the environment' : null);", to: ";" },
  { name: "dotenv-read-passes", rule: "WI-6", rel: ADAPTER_REL, from: String.raw`(?:\.env(?!\.(?:example|sample|template)\b)(?:\.[\w.-]+)?|\.npmrc|`, to: String.raw`(?:\.npmrc|` },
  { name: "environment-dump-passes", rule: "WI-6", rel: ADAPTER_REL, from: String.raw`homedir\s*\(|process\.env|\bprintenv\b|`, to: "" },
  { name: "failure-text-unfiltered", rule: "WI-5", rel: ADAPTER_REL, from: PIN.safeText, to: "return inert(text);" },
  { name: "turn-failure-unfiltered", rule: "WI-5", rel: ADAPTER_REL, from: PIN.safeFailure, to: "failure = inert((e['error'] as Record<string, unknown> | undefined)?.['message']) || 'the turn failed';" },
  { name: "exit-stderr-unfiltered", rule: "WI-5", rel: ADAPTER_REL, from: "stderr: safeText(r.stderr.trim()", to: "stderr: inert(r.stderr.trim()" },
  { name: "not-started-stderr-unfiltered", rule: "WI-5", rel: ADAPTER_REL, from: PIN.safeNotStarted, to: "`: ${inert(r.stderr.trim())}`" },
  { name: "unknown-item-passes", rule: "WI-6", rel: ADAPTER_REL, from: PIN.unknownItemDenied, to: "} else if (false) {" },
  { name: "tool-call-is-neutral", rule: "WI-6", rel: ADAPTER_REL, from: PIN.neutralItems, to: "new Set(['agent_message', 'reasoning', 'todo_list', 'file_change', 'mcp_tool_call'])" },
  { name: "failed-turn-passes", rule: "WI-6", rel: ADAPTER_REL, from: PIN.failureRefused, to: "if (false) return { kind: 'refused'" },
  { name: "denials-ignored", rule: "WI-6", rel: ADAPTER_REL, from: PIN.denialsRefused, to: "if (false) {" },
  { name: "unfinished-turn-passes", rule: "WI-6", rel: ADAPTER_REL, from: PIN.turnRequired, to: "if (false) return { kind: 'refused'" },
  { name: "spawn-unbounded", rule: "WI-7", rel: ADAPTER_REL, from: PIN.boundTimeout, to: "maxOutputBytes: WORKER_MAX_OUTPUT_BYTES," },
  { name: "unbounded-worker-started", rule: "WI-7", rel: ADAPTER_REL, from: PIN.boundRefused, to: "const unbounded = boundProblem(worker);\n      if (false) return { kind: 'refused', detail: unbounded };" },
  { name: "second-spawn-added", rule: "WI-7", rel: ADAPTER_REL, from: "    rejoin(): WorkerOutcome {", to: "    rejoin(sys: System, worker: AuthorisedWorker): WorkerOutcome {\n      sys.exec(worker.command, [], {});" },
  { name: "loop-imports-the-editor", rule: "WI-8", rel: `${LOOP_DIR}/runner.ts`, from: "export function runLoop(", to: "import * as vscode from 'vscode';\nexport function runLoop(" },
  { name: "loop-launches-the-editor", rule: "WI-8", rel: `${LOOP_DIR}/runner.ts`, from: "export function runLoop(", to: "const OPEN = (sys: any) => sys.exec('code.cmd', ['.']);\nexport function runLoop(" },
  { name: "kind-not-wired", rule: "WI-9", rel: CLAUDE_REL, from: PIN.wired, to: "" },
  { name: "reviewer-kind-unwired", rule: "WI-9", rel: CLAUDE_REL, from: PIN.reviewerWired, to: "" },
  { name: "adapter-imports-the-claude-adapter", rule: "WI-9", rel: ADAPTER_REL, from: "import { ambiguousGrants, argvGrants } from '../workers.js';", to: "import { ambiguousGrants, argvGrants } from '../workers.js';\nimport { pointerInstruction } from './claudeCodeCli.js';" },
  { name: "prefix-is-a-parent", rule: "WI-10", rel: SCOPE_REL, from: PIN.dirBoundary, to: "(s.includes('*') ? globRegex(s).test(p) : p === s || p.startsWith(s))" },
  { name: "glob-spans-directories", rule: "WI-10", rel: SCOPE_REL, from: PIN.globOneSegment, to: ".replace(/\\*/g, '.*')" },
  { name: "git-runs-with-user-config", rule: "WI-12", rel: SCOPE_REL, from: PIN.isolated, to: "const options = { maxOutputBytes: MAX_GIT_OUTPUT_BYTES };" },
  { name: "fsmonitor-left-on", rule: "WI-12", rel: SCOPE_REL, from: PIN.fsmonitorOff, to: "'core.fsmonitor=true'" },
  { name: "filter-drivers-left-on", rule: "WI-12", rel: SCOPE_REL, from: PIN.neutralised, to: "const run: GitRun = (args) => sys.exec('git', [...base, ...args], options);" },
  { name: "unlisted-drivers-accepted", rule: "WI-12", rel: SCOPE_REL, from: PIN.neutraliserNull, to: "" },
  { name: "hash-runs-clean-filters", rule: "WI-12", rel: SCOPE_REL, from: PIN.noFilters, to: "run(['hash-object', '-t', 'blob', '--', ...chunk]);" },
  { name: "partial-hash-accepted", rule: "WI-12", rel: SCOPE_REL, from: PIN.partialHash, to: "if (false) return false;" },
  { name: "failed-status-accepted", rule: "WI-12", rel: SCOPE_REL, from: PIN.statusFailed, to: "" },
  { name: "configuration-not-compared", rule: "WI-13", rel: SCOPE_REL, from: PIN.configDigest, to: "" },
  { name: "head-not-compared", rule: "WI-13", rel: SCOPE_REL, from: PIN.headRecorded, to: "" },
  { name: "excludes-not-compared", rule: "WI-13", rel: SCOPE_REL, from: PIN.excludesRecorded, to: "void (" },
  { name: "index-flags-not-compared", rule: "WI-13", rel: SCOPE_REL, from: PIN.flagsRecorded, to: "" },
  { name: "status-read-quoted", rule: "WI-13", rel: SCOPE_REL, from: PIN.zStatus, to: "run(['status', '--porcelain=v1', '--ignore-submodules=dirty', '--untracked-files=all']);" },
  { name: "rename-origin-dropped", rule: "WI-13", rel: SCOPE_REL, from: PIN.renameOrigin, to: "" },
  { name: "ignored-paths-not-listed", rule: "WI-13", rel: SCOPE_REL, from: PIN.ignoredListed, to: "" },
  { name: "ignored-files-not-hashed", rule: "WI-13", rel: SCOPE_REL, from: PIN.ignoredHashed, to: "void blob" },
  { name: "projectops-records-not-expanded", rule: "WI-13", rel: SCOPE_REL, from: PIN.recordsExpanded, to: "run(['status', '--porcelain=v1', '-z', '--ignore-submodules=dirty', '--ignored', '--', 'none']);" },
  { name: "agent-control-path-in-scope", rule: "WI-10", rel: SCOPE_REL, from: PIN.breachRule, to: "if (!pathInGrants(path, scopes)) changed.push(path);" },
  { name: "codex-home-in-scope", rule: "WI-10", rel: SCOPE_REL, from: String.raw`|\.codex|\.agents|`, to: "|" },
  { name: "agents-override-in-scope", rule: "WI-10", rel: SCOPE_REL, from: String.raw`(?:\.local|\.override)?`, to: String.raw`(?:\.local)?` },
  { name: "whole-checkout-grant-accepted", rule: "WI-10", rel: SCOPE_REL, from: "scope === '' || scope === '.' ||", to: "scope === '' ||" },
  { name: "parent-escape-grant-accepted", rule: "WI-10", rel: SCOPE_REL, from: " || scope.split('/').includes('..')", to: "" },
  { name: "glob-syntax-accepted", rule: "WI-10", rel: SCOPE_REL, from: PIN.unsupportedSyntax, to: "const UNSUPPORTED_SYNTAX = /^$/;" },
  { name: "changed-content-not-compared", rule: "WI-10", rel: SCOPE_REL, from: PIN.changedByDigest, to: "if (before.has(path) === after.has(path)) continue;" },
  { name: "shared-helper-copied", rule: "WI-11", rel: CODEX_REL, from: "export function commandProblem(", to: "function commandProblem(" },

  // ---- PROJECTOS-WORKER-SCRATCH-CHECKOUT1A ----
  { name: "worker-runs-in-the-real-checkout", rule: "WI-14", rel: ADAPTER_REL, from: PIN.scratchCwd, to: "cwd: root," },
  { name: "worker-argv-names-the-real-root", rule: "WI-14", rel: ADAPTER_REL, from: PIN.scratchArgv, to: "const built = codexImplementerArgv(worker, root, instruction);" },
  { name: "sentence-names-the-real-brief", rule: "WI-14", rel: ADAPTER_REL, from: PIN.scratchSentence, to: "const instruction = sentenceFor(briefPath);" },
  { name: "brief-copy-keeps-the-real-root", rule: "WI-14", rel: ADAPTER_REL, from: PIN.briefRoot, to: "repository: { ...brief.repository }," },
  { name: "brief-copy-keeps-the-real-record-paths", rule: "WI-14", rel: ADAPTER_REL, from: PIN.briefRecords, to: "records: { ...r }," },
  { name: "brief-not-placed-where-the-worker-reads", rule: "WI-14", rel: ADAPTER_REL, from: PIN.briefPlaced, to: "const wrote = null;" },
  { name: "records-not-placed", rule: "WI-14", rel: ADAPTER_REL, from: PIN.recordsPlaced, to: "const placed = null;" },
  { name: "record-outside-the-checkout-accepted", rule: "WI-14", rel: ADAPTER_REL, from: PIN.recordsOutside, to: "if (false) return { ok: false, problem:" },
  { name: "scratch-refusal-to-open-ignored", rule: "WI-14", rel: ADAPTER_REL, from: PIN.scratchOpenRefused, to: "if (false) return { kind: 'refused'" },
  { name: "unreadable-baseline-accepted", rule: "WI-14", rel: ADAPTER_REL, from: PIN.baselineRefused, to: "if (false) return { kind: 'refused'" },
  { name: "commands-judged-against-the-real-root", rule: "WI-14", rel: ADAPTER_REL, from: PIN.scratchJudgedAgainst, to: "outcomeFrom(result, worker.timeoutMs, instruction, root)" },
  { name: "ignored-files-listed-too", rule: "WI-15", rel: SCRATCH_REL, from: PIN.scListing, to: "const listed = run(['ls-files', '-z', '--cached', '--others', '--ignored']);" },
  { name: "list-read-without-the-shared-runner", rule: "WI-15", rel: SCRATCH_REL, from: PIN.scSharedRunner, to: "const run = ((args: readonly string[]) => sys.exec('git', ['-C', realRoot, ...args]));" },
  { name: "agent-control-paths-copied", rule: "WI-15", rel: SCRATCH_REL, from: PIN.scControlSkipped, to: "" },
  { name: "links-and-directories-copied-as-files", rule: "WI-15", rel: SCRATCH_REL, from: PIN.scOnlyFiles, to: "if (st === null) continue;" },
  { name: "unsafe-listed-path-copied", rule: "WI-15", rel: SCRATCH_REL, from: PIN.scListedUnsafe, to: "if (false) return { ok: false, reason:" },
  { name: "the-scratch-git-dir-walked", rule: "WI-15", rel: SCRATCH_REL, from: PIN.scGitSkipped, to: "" },
  { name: "scratch-is-a-worktree", rule: "WI-16", rel: SCRATCH_REL, from: PIN.scInit, to: "const init = sys.exec('git', ['-C', realRoot, 'worktree', 'add', root], { isolatedGit: {}, timeoutMs: 60_000 });" },
  { name: "scratch-is-a-clone-with-a-remote", rule: "WI-16", rel: SCRATCH_REL, from: PIN.scInit, to: "const init = sys.exec('git', ['clone', '--local', realRoot, root], { isolatedGit: {}, timeoutMs: 60_000 });" },
  { name: "scratch-keeps-the-default-template", rule: "WI-16", rel: SCRATCH_REL, from: PIN.scInit, to: "const init = sys.exec('git', ['init', '-q', root], { isolatedGit: {}, timeoutMs: 60_000 });" },
  { name: "init-failure-ignored", rule: "WI-16", rel: SCRATCH_REL, from: PIN.scInitRefused, to: "if (false) return fail(" },
  { name: "scratch-may-overlap-the-checkout", rule: "WI-16", rel: SCRATCH_REL, from: PIN.scOverlap, to: "if (false) return fail(" },
  { name: "changes-compared-by-kind-only", rule: "WI-17", rel: SCRATCH_REL, from: "a.hash === (b as { hash: string }).hash);", to: "true);" },
  { name: "files-not-hashed", rule: "WI-17", rel: SCRATCH_REL, from: PIN.scHashed, to: "const hash = createHash('md5');" },
  { name: "hash-reads-a-bounded-prefix-only", rule: "WI-17", rel: SCRATCH_REL, from: PIN.scStreamed, to: "const n = readSync(fd, chunk, 0, 64, 0);" },
  { name: "refusals-dropped-from-the-judgement", rule: "WI-17", rel: SCRATCH_REL, from: PIN.scAllRefusals, to: "if (false) refusals.push({ path, why });" },
  { name: "refused-judgement-forgotten", rule: "WI-17", rel: SCRATCH_REL, from: PIN.scRefusedHeld, to: "if (false) return (verdict = { kind: 'refused', refusals:" },
  { name: "refused-scratch-copied-anyway", rule: "WI-17", rel: SCRATCH_REL, from: PIN.scRefusedNotCopied, to: "" },
  { name: "uninspected-scratch-copied", rule: "WI-17", rel: SCRATCH_REL, from: PIN.scUninspectedNotCopied, to: "if (false) return { kind: 'failed'," },
  { name: "destinations-not-rechecked-before-writing", rule: "WI-17", rel: SCRATCH_REL, from: PIN.scDestinationRechecked, to: "const why = null as string | null;\n    if (why !== null) refusals.push({ path: w.path, why });\n  }\n  if (refusals.length > 0) return { kind: 'refused', refusals };" },
  { name: "link-allowed", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scLink, to: "" },
  { name: "oddity-allowed", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scOther, to: "" },
  { name: "file-directory-swap-allowed", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scKindChange, to: "" },
  { name: "deletion-allowed", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scDeleted, to: "if (now === undefined) return null;" },
  { name: "agent-control-path-allowed-under-a-directory-grant", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scControl, to: "" },
  { name: "path-outside-the-grants-allowed", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scOutside, to: "return null;" },
  { name: "links-followed", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scLstat, to: "const s = statSync(path);" },
  { name: "links-entered-by-the-walk", rule: "WI-18", rel: SCRATCH_REL, from: PIN.scLinkNotEntered, to: "if (st.kind === 'dir' || st.kind === 'link') {\n          manifest.set(rel, { kind: 'dir' });\n          pending.push(" },
  { name: "unsafe-name-allowed", rule: "WI-19", rel: SCRATCH_REL, from: PIN.scUnsafe, to: "" },
  { name: "parent-segment-allowed", rule: "WI-19", rel: SCRATCH_REL, from: "seg !== '..' && ", to: "" },
  { name: "colon-allowed-in-a-name", rule: "WI-19", rel: SCRATCH_REL, from: String.raw`<>:"|?*`, to: String.raw`<>"|?*` },
  { name: "drive-letter-allowed", rule: "WI-19", rel: SCRATCH_REL, from: " || /^[A-Za-z]:/.test(path)) return false;", to: ") return false;" },
  { name: "absolute-path-allowed", rule: "WI-19", rel: SCRATCH_REL, from: " || path.startsWith('/') ||", to: " ||" },
  { name: "escaping-destination-allowed", rule: "WI-19", rel: SCRATCH_REL, from: PIN.scDestinationUnsafe, to: "if (!safeRelativePath(rel)) return WHY.unsafe;" },
  { name: "link-in-the-destination-path-ignored", rule: "WI-20", rel: SCRATCH_REL, from: PIN.scThroughLink, to: "if (false) return WHY.throughLink;" },
  { name: "link-at-the-destination-allowed", rule: "WI-20", rel: SCRATCH_REL, from: PIN.scLastLink, to: "st.kind === 'link' ? null : WHY.inTheWay" },
  { name: "destinations-not-judged", rule: "WI-20", rel: SCRATCH_REL, from: PIN.scDestinationJudged, to: "const why = null as string | null;\n          if (why !== null) refusals.push({ path: w.path, why });" },
  { name: "copy-not-verified-at-the-destination", rule: "WI-21", rel: SCRATCH_REL, from: PIN.scVerified, to: "if (false) throw new CopyProblem(" },
  { name: "failed-copy-not-undone", rule: "WI-21", rel: SCRATCH_REL, from: PIN.scRolledBack, to: "const stuck = null as string | null;" },
  { name: "restoration-always-claimed", rule: "WI-21", rel: SCRATCH_REL, from: PIN.scRolledBackSaid, to: "rolledBack: true" },
  { name: "existing-files-not-backed-up", rule: "WI-21", rel: SCRATCH_REL, from: PIN.scBackedUp, to: "" },
  { name: "new-files-not-noted-for-undo", rule: "WI-21", rel: SCRATCH_REL, from: PIN.scNewNoted, to: "" },
  { name: "scratch-left-behind", rule: "WI-22", rel: ADAPTER_REL, from: "cleanup = scratch.dispose();", to: "cleanup = null;" },
  { name: "cleanup-failure-swallowed", rule: "WI-22", rel: ADAPTER_REL, from: PIN.cleanupNoted, to: "return outcome;" },
  { name: "cleanup-failure-lost-on-a-refusal", rule: "WI-22", rel: ADAPTER_REL, from: PIN.cleanupNote, to: "if (outcome.kind === 'refused') return outcome;" },
  { name: "dispose-failure-swallowed", rule: "WI-22", rel: SCRATCH_REL, from: "stuck.push(described('removing the scratch', e));", to: "void e;" },
  { name: "refused-export-leaves-a-directory", rule: "WI-22", rel: SCRATCH_REL, from: PIN.scExportCleanup, to: "try {\n        void holder;\n      } catch (e) {\n        cleanup = `; and the scratch could not be removed (${errorCode(e)})`;" },
  { name: "removal-gives-up-at-the-first-lock", rule: "WI-22", rel: SCRATCH_REL, from: "maxRetries: 3, retryDelay: 100", to: "maxRetries: 0" },
  { name: "refused-run-copied-back", rule: "WI-23", rel: ADAPTER_REL, from: PIN.refusedRunKept, to: "" },
  { name: "scratch-never-judged", rule: "WI-23", rel: ADAPTER_REL, from: PIN.inspected, to: "const inspected = { kind: 'clean', writes: 0 } as const;" },
  { name: "unreadable-scratch-accepted", rule: "WI-23", rel: ADAPTER_REL, from: PIN.unreadableRefused, to: "if (false) {" },
  { name: "refused-judgement-copied-anyway", rule: "WI-23", rel: ADAPTER_REL, from: PIN.judgementRefused, to: "" },
  { name: "failed-copy-treated-as-success", rule: "WI-23", rel: ADAPTER_REL, from: PIN.copiedOnly, to: "if (copied.kind === 'copied' || copied.kind === 'failed') return outcome;" },
  { name: "partial-copy-not-said", rule: "WI-23", rel: ADAPTER_REL, from: PIN.copyPartial, to: "THE CHECKOUT IS FINE" },
  { name: "backstop-taken-before-the-copy-back", rule: "WI-23", rel: ADAPTER_REL, from: PIN.settleCalled, to: PIN.breaches + "\n          " + PIN.settleCalled },
  { name: "second-copy-back-added", rule: "WI-23", rel: ADAPTER_REL, from: PIN.settleCalled, to: "scratch.copyBack(); " + PIN.settleCalled },
  { name: "adapter-reads-the-disk", rule: "WI-24", rel: ADAPTER_REL, from: "import type { System } from '../../system.js';", to: "import type { System } from '../../system.js';\nimport { rmSync } from 'node:fs';" },
  { name: "adapter-runs-git", rule: "WI-24", rel: ADAPTER_REL, from: "    rejoin(): WorkerOutcome {", to: "    rejoin(sys: System): WorkerOutcome {\n      sys.exec('git', ['status']);" },
  { name: "snapshot-builds-its-own-runner", rule: "WI-25", rel: SCOPE_REL, from: "const run = isolatedGitRunner(sys, root);", to: "const run = ((args: readonly string[]) => sys.exec('git', ['-C', root, ...args])) as GitRun;" },
  { name: "scratch-uses-its-own-isolation", rule: "WI-25", rel: SCRATCH_REL, from: PIN.scSharedImport, to: "import { isAgentControlPath, pathInGrants } from './writeScope.js';" },

  // ---- the independent review of 001822c4 ----
  { name: "short-name-shape-allowed", rule: "WI-26", rel: SCRATCH_REL, from: PIN.scShortShape, to: "const SHORT_NAME_SHAPE = /^$/;" },
  { name: "short-name-not-part-of-a-plain-path", rule: "WI-26", rel: SCRATCH_REL, from: PIN.scShortRefused, to: "" },
  { name: "short-name-files-exported", rule: "WI-26", rel: SCRATCH_REL, from: PIN.scShortNotExported, to: "" },
  { name: "destination-alias-allowed", rule: "WI-26", rel: SCRATCH_REL, from: PIN.scCanonicalCompared, to: "return fs.realPath(join(realRoot, ...segments.slice(0, depth))) === expected ? null : null;" },
  { name: "canonical-root-not-used", rule: "WI-26", rel: SCRATCH_REL, from: PIN.scCanonicalExpected, to: "const expected = join(realRoot, ...segments.slice(0, depth));" },
  { name: "cursor-and-windsurf-files-in-scope", rule: "WI-10", rel: SCOPE_REL, from: String.raw`|\.cursor(?:rules)?|\.windsurf(?:rules)?|\.mcp\.json`, to: "" },
  { name: "more-agent-control-files-in-scope", rule: "WI-10", rel: SCOPE_REL, from: String.raw`|\.gemini|\.opencode|\.kiro|\.roo(?:rules)?|\.clinerules|\.continue|\.aider\.conf\.yml|\.aiderignore|\.codeium`, to: "" },
  { name: "case-difference-refused-again", rule: "WI-26", rel: SCRATCH_REL, from: PIN.scSameSpelling, to: "const sameSpelling = (canonical: string, expected: string): boolean => canonical === expected;" },
  { name: "any-difference-accepted", rule: "WI-26", rel: SCRATCH_REL, from: PIN.scSameSpelling, to: "const sameSpelling = (canonical: string, expected: string): boolean => true;" },
  { name: "format-characters-allowed-in-a-path", rule: "WI-31", rel: SCRATCH_REL, from: PIN.scFormatRefused, to: "" },
  { name: "format-class-narrowed", rule: "WI-31", rel: SCRATCH_REL, from: PIN.scFormatInName, to: String.raw`const FORMAT_IN_NAME = /[\p{Cc}]/u;` },
  { name: "copy-step-shows-the-raw-path", rule: "WI-31", rel: SCRATCH_REL, from: PIN.scStepEscaped, to: "step = `copying ${w.path}`;" },
  { name: "bytes-message-shows-the-raw-path", rule: "WI-31", rel: SCRATCH_REL, from: PIN.scBytesEscaped, to: "CopyProblem(`the bytes of ${w.path} are not the bytes that were judged`)" },
  { name: "backup-location-not-owned", rule: "WI-22", rel: SCRATCH_REL, from: PIN.scStagingOwned, to: "" },
  { name: "breach-refusal-hides-the-copy-back", rule: "WI-32", rel: ADAPTER_REL, from: PIN.adapterBreachNote, to: "`," },
  { name: "unreadable-root-refusal-hides-the-copy-back", rule: "WI-32", rel: ADAPTER_REL, from: PIN.adapterAfterNullNote, to: "` };" },
  { name: "failed-copy-note-lost", rule: "WI-32", rel: ADAPTER_REL, from: PIN.adapterFailureNoteKept, to: "copyNote: NOTHING_COPIED };" },
  { name: "partial-copy-reported-as-restored", rule: "WI-32", rel: ADAPTER_REL, from: "copied.rolledBack ? 'the checkout was restored' : 'THE CHECKOUT MAY HOLD PART OF THE COPY'", to: "'the checkout was restored'" },
  { name: "device-names-allowed", rule: "WI-27", rel: SCRATCH_REL, from: PIN.scDeviceRefused, to: "" },
  { name: "nul-not-reserved", rule: "WI-27", rel: SCRATCH_REL, from: "|AUX|NUL|COM[0-9", to: "|AUX|COM[0-9" },
  { name: "superscript-ports-not-reserved", rule: "WI-27", rel: SCRATCH_REL, from: String.raw`COM[0-9\xb2\xb3\xb9]|LPT[0-9\xb2\xb3\xb9]`, to: "COM[0-9]|LPT[0-9]" },
  { name: "device-extension-not-stripped", rule: "WI-27", rel: SCRATCH_REL, from: "(segment.split('.')[0] ?? '')", to: "segment" },
  { name: "parents-not-checked", rule: "WI-28", rel: SCRATCH_REL, from: "if (!parentsPlain(listed)) {", to: "if (false) {" },
  { name: "junction-parent-treated-as-plain", rule: "WI-28", rel: SCRATCH_REL, from: PIN.scParentPlain, to: "if (dir === null) return false;" },
  { name: "skipped-paths-not-recorded", rule: "WI-28", rel: SCRATCH_REL, from: PIN.scSkippedRecorded, to: "void path;" },
  { name: "backup-beside-the-worker", rule: "WI-29", rel: SCRATCH_REL, from: PIN.scStagingMade, to: "staging = join(holder, 'backup'); fs.makeDir(staging);" },
  { name: "backup-used-unchecked", rule: "WI-29", rel: SCRATCH_REL, from: PIN.scStagingChecked, to: "if (writes.length > 0) fs.makeDir(stagingDir);" },
  { name: "linked-backup-accepted", rule: "WI-29", rel: SCRATCH_REL, from: PIN.scStagingPlain, to: "if (st === null) throw new CopyProblem('the backup location is not a plain directory');" },
  { name: "non-empty-backup-accepted", rule: "WI-29", rel: SCRATCH_REL, from: PIN.scStagingEmpty, to: "" },
  { name: "hard-linked-file-copied-back", rule: "WI-30", rel: SCRATCH_REL, from: PIN.scHardlink, to: "return null;" },
  { name: "link-count-not-recorded", rule: "WI-30", rel: SCRATCH_REL, from: PIN.scLinksRecorded, to: "manifest.set(rel, { kind: 'file', hash: fs.hashFile(abs) });" },
  { name: "scratch-unbounded-after-the-run", rule: "WI-30", rel: SCRATCH_REL, from: PIN.scPostRunBound, to: "if (false) {" },
  { name: "format-characters-shown-raw", rule: "WI-30", rel: SCRATCH_REL, from: PIN.scFormatEscaped, to: String.raw`value.replace(/[\p{Cc}]/gu,` },
  { name: "refusal-paths-shown-raw", rule: "WI-30", rel: ADAPTER_REL, from: PIN.adapterPlainNames, to: "map((r) => `${inert(r.path)} (${r.why})`);" },
  { name: "breach-paths-shown-raw", rule: "WI-30", rel: ADAPTER_REL, from: PIN.adapterPlainBreaches, to: "const shown = breaches.slice(0, 20).map(inert);" },
];

/** Every named mutation must be killed by its own rule. Applied to CRLF-folded text, as `check` reads it. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel] === null || raw[m.rel] === undefined ? null : raw[m.rel].replace(/\r\n/g, "\n");
    if (text === null || !text.includes(m.from)) {
      errors.push(`WI-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`WI-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

function run() {
  const raw = {};
  for (const rel of [...FIXED, ...loopFiles()]) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      errors.push(`WI-T: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`WI-T: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-worker-codex-implementer1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log(`val-projectos-worker-codex-implementer1a: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
