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
const LOOP_DIR = "projectos/agent/src/loop";
const FIXED = [ADAPTER_REL, SCOPE_REL, CLAUDE_REL, CODEX_REL];

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
  startPointed: ": instructions.pointerInstruction(briefPath, contextPointer);",
  correctionPointed: "? instructions.correctionInstruction(briefPath, contextPointer)",
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
  scrub: "scrubCredentials: true, ensureSystemPath: true, cwd: root,",
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
  agentSegments: String.raw`const AGENT_CONTROL_SEGMENT = /^(?:\.git.*|\.claude|\.codex|\.agents|\.husky|\.vscode)$/i;`,
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
  { name: "start-sentence-without-the-pointer", rule: "WI-3", rel: ADAPTER_REL, from: PIN.startPointed, to: ": instructions.pointerInstruction(briefPath);" },
  { name: "correction-sentence-without-the-pointer", rule: "WI-3", rel: ADAPTER_REL, from: PIN.correctionPointed, to: "? instructions.correctionInstruction(briefPath)" },
  { name: "stored-context-refused-again", rule: "WI-3", rel: ADAPTER_REL, from: PIN.contextPointer, to: "if (brief.records.contextPath !== undefined) return { kind: 'refused', detail: `a '${CODEX_IMPLEMENTER}' worker is not told where it is` }; " + PIN.contextPointer },
  { name: "no-snapshot-before", rule: "WI-4", rel: ADAPTER_REL, from: PIN.beforeRefused, to: "if (false) return { kind: 'refused'" },
  { name: "no-snapshot-after", rule: "WI-4", rel: ADAPTER_REL, from: PIN.afterRefused, to: "if (false) return { kind: 'refused'" },
  { name: "breach-not-refused", rule: "WI-4", rel: ADAPTER_REL, from: PIN.breachRefused, to: "if (false) {" },
  { name: "scope-ignores-the-grants", rule: "WI-4", rel: ADAPTER_REL, from: PIN.scopesFromArgv, to: "return { scopes: ['.'], problems: [] };" },
  { name: "scope-judged-before-the-run", rule: "WI-4", rel: ADAPTER_REL, from: PIN.after, to: "const after = before;" },
  { name: "scope-skipped-when-it-ran", rule: "WI-4", rel: ADAPTER_REL, from: PIN.notStartedSkips, to: "if (false) {" },
  { name: "grant-problems-dropped", rule: "WI-4", rel: ADAPTER_REL, from: PIN.grantProblemsInArgs, to: "return out;" },
  { name: "credentials-inherited", rule: "WI-5", rel: ADAPTER_REL, from: PIN.scrub, to: "scrubCredentials: false, ensureSystemPath: true, cwd: root," },
  { name: "key-in-env", rule: "WI-5", rel: ADAPTER_REL, from: PIN.scrub, to: "scrubCredentials: true, ensureSystemPath: true, cwd: root, env: { OPENAI_API_KEY: worker.workerId }," },
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
