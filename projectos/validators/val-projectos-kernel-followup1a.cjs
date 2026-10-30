"use strict";
/**
 * REGISTRY PIN + CODEX REVIEWER — PROJECTOS-KERNEL-FOLLOWUP1A.
 *
 * Two things carried out of PROJECTOS-KERNEL-HYGIENE1A and PROJECTOS-KERNEL-ROLE-REVIEW1A, each pinned
 * because every way of undoing it reads reasonably in a diff:
 *
 *   FU-1 "an unregistered validator is fine"           — and a new validator silently never runs
 *   FU-2 "a retirement needs no reason"                 — and RETIRED becomes a place to hide failures
 *   FU-3 "registered and retired is harmless"           — and the record says both things at once
 *   FU-4 "a non-array run() result is a pass"           — and an async validator reads as a vacuous PASS
 *   FU-5 "a registry problem is a warning"              — and the run passes, or records evidence, anyway
 *   FU-6 "cached-runner can lag validate-all"           — and the fast runner validates a different suite
 *
 *   CX-1 "the sandbox is whatever Codex defaults to"    — and the reviewer runs with write access
 *   CX-2 "a bypass flag is fine for a reviewer"         — and the sandbox the review rests on is gone
 *   CX-3 "a Codex worker can implement too"             — and providerDistinct depends on configuration
 *   CX-4 "the Codex reply needs its own parser"         — and two parsers judge reviews by two rules
 *   CX-5 "the reviewer needs a key"                     — and the loop becomes an API client
 *   CX-6 "any configured argument may pass through"     — and config widens the sandbox the code set
 *   CX-7 "a review need not be bounded"                 — and a hung reviewer holds the run forever
 *   CX-8 "the adapter exists, so it is wired"           — and the kind is configurable but never runs
 *
 * The ECC SECURITY review of this phase (APPROVE WITH CHANGES) added five more:
 *
 *   CX-9  "a read-only sandbox keeps the reviewer in the checkout" — it blocks writes, not reads, so the
 *         reviewer could read the owner's Codex login; a command naming a path outside the checkout is a
 *         denial (HIGH 1b). A UNC path is a host FOLLOWED BY A SEPARATOR, so `\\?\UNC\…` and `\\.\pipe\…`
 *         still deny and a quoted escape in a probe script does not; doubled separators after a host of
 *         two or more characters, and a `$(…)` host, deny too (PROJECTOS-KERNEL-CODEX-UNC1A)
 *   CX-10 "the reply is the reviewer's to say"          — and a credential it read rides into a record; a
 *         credential-shaped reply is withheld whole and reported as a denial (HIGH 1c)
 *   CX-11 "a completed command is a read"               — and a sandbox refusal counts as reading; only exit
 *         0 is a read, a declined or sandbox-stopped command is a denial, an error item a failure (MEDIUM 2)
 *   RV-1  "AGENTS.md is the agent file"                 — and Codex also loads AGENTS.override.md and
 *         .agents/, which a candidate could use to steer it (MEDIUM 4)
 *   CW-1  "a provider id is just an id"                 — and provider text reaches a console and a record
 *         unchecked; it is kept only as a plain bounded identifier (LOW 7)
 *   CX-12 "Codex picks its own Windows sandbox"         — and with no mode it runs no command at all, so a
 *         review can never happen; the adapter sets one fixed mode, and it is the ONLY `-c` the command line
 *         may carry (PROJECTOS-KERNEL-CODEX-LIVE1A, live probe)
 *   CX-13 "a command is judged as reported"             — and every command arrives wrapped in an absolute
 *         powershell.exe path, so every review is refused; the inner command of a KNOWN wrapper is judged,
 *         one layer only, and an unknown wrapper is not unwrapped (PROJECTOS-KERNEL-CODEX-LIVE1A)
 *   CX-14 "a sandbox stops what matters"               — and the live probe showed loopback is reachable from
 *         it; a network fetch or decode-and-run command, or a "blocked by policy" failure, is a denial
 *
 * Each rule has a NAMED MUTATION; `selfTest` applies it in memory and counts it killed only when THAT
 * rule fires. Comments are stripped first. Reads files; runs nothing, calls no provider, runs no Codex.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const CODEX_REL = "projectos/agent/src/loop/adapters/codexCli.ts";
const CLAUDE_REL = "projectos/agent/src/loop/adapters/claudeCodeCli.ts";
const REVIEW_REL = "projectos/agent/src/loop/independentReview.ts";
const ROLES_REL = "projectos/agent/src/loop/reviewRoles.ts";
const CLOSURE_REL = "projectos/agent/src/commands/closure.ts";
const WAIT_REL = "projectos/agent/src/closureWait.ts";
const SOURCES = [VA_REL, CR_REL, CODEX_REL, CLAUDE_REL, REVIEW_REL, ROLES_REL, CLOSURE_REL, WAIT_REL];

const TESTS = {
  "projectos/agent/test/codexCliAdapter.test.ts": [
    "runs codex exec in the read-only sandbox, in the candidate checkout, with the instruction as the prompt",
    "admits the adapter's own Windows sandbox mode as the one configuration override, once",
    "judges the command inside a known shell wrapper, exactly as the live probe reported it",
    "is bounded, scrubs credential-shaped environment variables, and passes no environment of its own",
    "refuses configured args %j that could widen the sandbox, and spawns nothing",
    "refuses a credential-shaped argument %j and passes nothing",
    "refuses when the finished command line does not carry exactly one read-only sandbox",
    "start refuses with a clear reason and spawns nothing",
    "rejoin refuses with the same reason and spawns nothing",
    "is wired into the built-in adapter registry under its own kind",
    "a clean run parses to the verdict, with the reads as turns and no denials",
    "a reviewer that read nothing reports one turn (the loop refuses fewer than two)",
    "an attempted write or tool call is a denial, counted once per item",
    "refuses a sandbox token %j given as the value of a permitted flag, and spawns nothing",
    "a command inside the checkout is not a denial: %s",
    "does not read a quoted escape in a probe script as a UNC path: %s",
    "['a long-path UNC prefix', 'type \\\\\\\\?\\\\UNC\\\\server\\\\share\\\\x'],",
    "['a named pipe', 'type \\\\\\\\.\\\\pipe\\\\x'],",
    "['a UNC path with a doubled separator', 'Get-Content \\\\\\\\localhost\\\\\\\\c$\\\\x'],",
    "['a UNC host given as a PowerShell sub-expression', 'Get-ChildItem \"\\\\\\\\$(hostname)\\\\c$\\\\x\"'],",
    "an outside path seen when the command STARTS is a denial too, counted once per item",
    "a command whose text was not reported cannot be checked, so it is a denial",
    "%s, in the reply text and in a finding summary",
    "a digest the loop itself put in the instruction is not a credential, nor is a commit, a path or a hyphenated name",
    "a declined command is a denial, not a read",
    "a failed command the sandbox or an approval stopped is a denial, not a read: %s",
    "a failed command that merely failed (grep with no match) is neither a read nor a denial",
    "a completed command with a non-zero or missing exit code is not a read",
    "an error ITEM is a failure (the conservative choice), so the review is refused before any reply is read",
  ],
  "projectos/agent/test/loopRunner.test.ts": [
    "[CX] a Codex reviewer that read nothing reports one turn, which the loop refuses as no review",
    "[CX] a Codex reviewer whose command reached outside the checkout is refused as possibly steered",
    "[CX] a Codex reply carrying credential-shaped content is withheld and the review refused",
    "[CX] the same Codex envelope with a clean read and reply is credited",
  ],
  "projectos/agent/test/kernelRoleReview.test.ts": [
    "names the files Codex loads too: AGENTS.override.md and anything under .agents/ (ECC SECURITY M4)",
    "tells the reviewer it may only read, in words true of both adapters (no shell grant for Claude, a read-only shell for Codex)",
  ],
  "projectos/agent/test/hybridClosureReconcile.test.ts": [
    "a provider response id with %s is printed as not returned and stored as null",
    "drops anything else to null: %j",
  ],
};

const PIN = {
  // validate-all registry
  scan: "fs.readdirSync(__dirname)\n    .filter((f) => /^(val|validate)-.+\\.cjs$/.test(f) && f !== \"validate-all.cjs\")",
  unregistered: "if (!MODULES.includes(f) && !retiredNames.includes(f)) problems.push(f + \" is neither registered nor retired\");",
  phantomRetired: "if (!files.includes(r.name)) problems.push(r.name + \" is retired but no such validator file exists\");",
  realReason: "if (typeof r.reason !== \"string\" || r.reason.trim().length < 20) problems.push(r.name + \" is retired without a real reason\");",
  bothRegistered: "if (MODULES.includes(r.name)) problems.push(r.name + \" is both registered and retired\");",
  nonArrayCrash: "if (!Array.isArray(errs)) throw new Error(",
  registryFails: "total += REGISTRY_PROBLEMS.length;",
  evidenceWithheld: "if (REGISTRY_PROBLEMS.length) {\n    console.error(\"validate-all: evidence NOT recorded",
  // codex adapter
  readOnly: "const READ_ONLY_SANDBOX: readonly string[] = ['--sandbox', 'read-only'];",
  argvBuild: "const argv = ['exec', ...worker.args, ...READ_ONLY_SANDBOX, ...WINDOWS_SANDBOX, ...FIXED_REVIEW_ARGS, '--cd', root, instruction];",
  // CX-12 / CX-13 (CODEX-LIVE1A)
  winSandbox: "const WINDOWS_SANDBOX: readonly string[] = ['-c', 'windows.sandbox=\"elevated\"'];",
  winPairOnly: "const pairAt = all.flatMap((a, i) => (a === WINDOWS_SANDBOX[0] && all[i + 1] === WINDOWS_SANDBOX[1] ? [i] : []));",
  winPairOnce: "if (pairAt.length > 1) return 'the Codex command line carries the Windows sandbox mode more than once';",
  winPairStripped: "const flags = pairAt.length === 1 ? [...all.slice(0, pairAt[0]), ...all.slice((pairAt[0] as number) + 2)] : all;",
  innerUsed: "const command = innerCommand(reported);",
  innerKnownOnly: "if (m === null) continue;",
  innerFallback: "  return trimmed;\n}",
  pwshWrapper: String.raw`/^"?[A-Za-z]:[\\/]+Program Files[\\/]+PowerShell[\\/]+7[\\/]+pwsh\.exe"?\s+(?:-NoProfile\s+)?-Command\s+([\s\S]+)$/i,`,
  cmdWrapper: String.raw`/^"?[A-Za-z]:[\\/]+Windows[\\/]+System32[\\/]+cmd\.exe"?\s+\/c\s+([\s\S]+)$/i,`,
  bashWrapper: String.raw`/^(?:\/usr)?(?:\/bin\/)?(?:ba)?sh\s+-l?c\s+([\s\S]+)$/,`,
  forbidC: "['-c', 'overrides configuration, including the sandbox and approval policy'],",
  attachedForms: String.raw`const attached = (a: string) => /^-[csp]./.test(a) || /^--(config|sandbox|profile)=/.test(a);`,
  attachedUsed: "(FORBIDDEN_TOKENS.has(a.split('=')[0] as string) || attached(a))",
  fetchDenied: "if (FETCH_OR_DECODE.test(innerCommand(command))) return 'command_execution: a network fetch or decode-and-run command';",
  fetchNames: String.raw`Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|Net\.WebClient|System\.Net\.|certutil`,
  policyWording: "/sandbox|blocked by policy|permission denied|",
  psWrapper: String.raw`/^"?[A-Za-z]:[\\/]+Windows[\\/]+System32[\\/]+WindowsPowerShell[\\/]+v1\.0[\\/]+powershell\.exe"?\s+(?:-NoProfile\s+)?-Command\s+([\s\S]+)$/i,`,
  sandboxGate: "return sandbox === null ? { ok: true, argv } : { ok: false, problem: sandbox };",
  sandboxCount: "if (sandboxAt.length !== 1 || flags[sandboxAt[0] as number] !== '--sandbox' || flags[(sandboxAt[0] as number) + 1] !== 'read-only') {",
  argsChecked: "const problems = codexArgProblems(worker.args);\n  if (problems.length > 0) return { ok: false,",
  unknownRefused: "`'${flag}' is not an argument a Codex reviewer may be configured with; permitted: ` +",
  startRefuses: "start(): WorkerOutcome {\n    return { kind: 'refused', detail: CODEX_NOT_AN_IMPLEMENTER };\n  },",
  rejoinRefuses: "rejoin(): WorkerOutcome {\n    return { kind: 'refused', detail: CODEX_NOT_AN_IMPLEMENTER };\n  },",
  envelopeResult: "result: run.lastMessage ?? '',",
  envelopeTurns: "num_turns: 1 + run.reads,",
  envelopeDenials: "permission_denials: run.beyondReading.map((t) => ({ tool_name: t })),",
  sharedParse: "const parsed = parseReviewerVerdict(reviewerText(outcome.stdout), nonce);",
  sharedDispatch: "const outcome = adapter.review(sys, worker, input.brief, reviewInstruction(",
  scrub: "scrubCredentials: true, ensureSystemPath: true, cwd: brief.repository.root,",
  credentialRefused: "if (CREDENTIAL_SHAPED.test(arg)) {",
  bounded: "timeoutMs: worker.timeoutMs, maxOutputBytes: WORKER_MAX_OUTPUT_BYTES,",
  boundRefused: "const unbounded = boundProblem(worker);\n    if (unbounded !== null) return { kind: 'refused', detail: unbounded };",
  wired: "[CODEX_CLI]: codexCliAdapter,",
  valueChecked: "else problems.push(...valueProblems(arg, value));",
  // CX-9 (HIGH 1b)
  leavesHome: "if (HOME_REFERENCE.test(command) || CODEX_HOME_NAME.test(command) || PARENT_ESCAPE.test(command)) return true;",
  leavesUnc: "if (UNC_PATH.test(command) || POSIX_HOME.test(command)) return true;",
  uncShape: "const UNC_PATH = new RegExp(\n  String.raw`" + String.raw`(^|[\s'"=(])(\\\\|//)(?:[^\s\\/'"|;&<>()]+[\\/][^\s\\/]|[^\s\\/'"|;&<>()]{2,}[\\/]{2,}[^\s\\/]|\$\()` + "`,\n);",
  leavesAbsolute: "return absolutePaths(command).some((p) => inside === null || (p !== inside && !p.startsWith(`${inside}/`)));",
  codexHome: "const CODEX_HOME_NAME = /\\.codex/i;",
  outsideDenied: "if (commandLeavesCheckout(command, root)) return 'command_execution: names a path outside the repository';",
  commandChecked: "const problem = commandProblem(it, context?.root ?? null);",
  contextPassed: "{ root: brief.repository.root, instruction },",
  eventsWithContext: "const run = readCodexEvents(r.stdout, context);",
  // CX-10 (HIGH 1c)
  withheld: "if (lastMessage !== null && credentialShaped(lastMessage, context?.instruction ?? '')) {\n    lastMessage = null;\n    beyond.set(`${CODEX_REPLY_WITHHELD}#reply`, CODEX_REPLY_WITHHELD);",
  jwtShape: "/\\beyJ[A-Za-z0-9_-]{16,}/,",
  skShape: "/\\bsk-[A-Za-z0-9_-]{16,}/,",
  tokenNames: "/(access|refresh|id)_token|api[_-]?key/i,",
  bearerShape: "/\\bbearer\\s+[A-Za-z0-9._~+/=-]{8,}/i,",
  longRun: "const LONG_RUN = /[A-Za-z0-9+=_-]{30,}/g;",
  longRunCounts: "if (hex || mixed) return true;",
  // CX-11 (MEDIUM 2)
  readIsExitZero: "return item['status'] === 'completed' && item['exit_code'] === 0;",
  readCounted: "} else if (type === 'item.completed' && isRead(it)) {",
  declinedDenied: "if (item['status'] === 'declined') return 'command_execution: declined';",
  sandboxDenied: "if (item['status'] === 'failed' && SANDBOX_REFUSAL.test(",
  neutralNoError: "const NEUTRAL_ITEMS: ReadonlySet<string> = new Set(['agent_message', 'reasoning', 'todo_list']);",
  errorItemFails: "} else if (itemType === 'error') {",
  errorItemFailure: "if (failure === null) failure = inert(it['message']) || 'the run reported an error item';",
  // RV-1 (MEDIUM 4)
  agentsOverride: "AGENTS(\\.override)?\\.md$|\\.agents(\\/|$)|",
  readOnlyWords: "'You may only read: you hold no write grant, and any shell you are given is read-only; change nothing. ' +",
  // CW-1 (LOW 7)
  idShape: "const PROVIDER_RESPONSE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;",
  idGate: "return typeof value === 'string' && PROVIDER_RESPONSE_ID.test(value) ? value : null;",
  traceGated: "(provider response ${safeProviderResponseId(turn.providerResponseId) ?? 'not returned'})",
  waitGated: "...(obtained.provenance === INSTALLATION_BROKER_PROVENANCE ? { providerResponseId: safeProviderResponseId(obtained.providerResponseId) } : {}),",
};

/** Sandbox-widening tokens. Each must be in the refusal map, and nowhere else in the adapter's code. */
const WIDENING = ["--dangerously-bypass-approvals-and-sandbox", "workspace-write", "danger-full-access", "--full-auto", "--add-dir", "--approve-for-me"];
/** Credential spellings that may never appear in the adapter's code at all. */
const CREDENTIAL_LITERALS = /OPENAI_API_KEY|CODEX_API_KEY|--api-key|Bearer |Authorization/;

const MUTATIONS = [
  { name: "unregistered-validator-accepted", rule: "FU-1", rel: VA_REL, from: PIN.unregistered, to: "" },
  { name: "registry-scans-nothing", rule: "FU-1", rel: VA_REL, from: "/^(val|validate)-.+\\.cjs$/.test(f)", to: "/^never-/.test(f)" },
  { name: "retired-without-reason-accepted", rule: "FU-2", rel: VA_REL, from: PIN.realReason, to: "" },
  { name: "phantom-retirement-accepted", rule: "FU-2", rel: VA_REL, from: PIN.phantomRetired, to: "" },
  { name: "registered-and-retired-accepted", rule: "FU-3", rel: VA_REL, from: PIN.bothRegistered, to: "" },
  { name: "non-array-result-is-pass", rule: "FU-4", rel: VA_REL, from: PIN.nonArrayCrash, to: "if (false) throw new Error(" },
  { name: "cached-runner-non-array-is-pass", rule: "FU-4", rel: CR_REL, from: PIN.nonArrayCrash, to: "if (false) throw new Error(" },
  { name: "registry-problems-do-not-fail", rule: "FU-5", rel: VA_REL, from: PIN.registryFails, to: "" },
  { name: "evidence-recorded-despite-registry", rule: "FU-5", rel: VA_REL, from: "if (REGISTRY_PROBLEMS.length) {\n    console.error(\"validate-all: evidence NOT recorded", to: "if (false) {\n    console.error(\"validate-all: evidence NOT recorded" },
  { name: "cached-runner-drops-a-module", rule: "FU-6", rel: CR_REL, from: "  \"val-projectos-kernel-followup1a\",\n", to: "" },
  { name: "sandbox-not-read-only", rule: "CX-1", rel: CODEX_REL, from: PIN.readOnly, to: "const READ_ONLY_SANDBOX: readonly string[] = [];" },
  { name: "sandbox-left-off-argv", rule: "CX-1", rel: CODEX_REL, from: PIN.argvBuild, to: "const argv = ['exec', ...worker.args, ...WINDOWS_SANDBOX, ...FIXED_REVIEW_ARGS, '--cd', root, instruction];" },
  { name: "windows-sandbox-left-off-argv", rule: "CX-12", rel: CODEX_REL, from: "...READ_ONLY_SANDBOX, ...WINDOWS_SANDBOX, ...FIXED_REVIEW_ARGS", to: "...READ_ONLY_SANDBOX, ...FIXED_REVIEW_ARGS" },
  { name: "windows-sandbox-mode-dropped", rule: "CX-12", rel: CODEX_REL, from: PIN.winSandbox, to: "const WINDOWS_SANDBOX: readonly string[] = [];" },
  { name: "any-config-override-admitted", rule: "CX-12", rel: CODEX_REL, from: PIN.winPairStripped, to: "const flags = all.filter((a) => a !== '-c');" },
  { name: "windows-sandbox-repeat-admitted", rule: "CX-12", rel: CODEX_REL, from: PIN.winPairOnce, to: "" },
  { name: "unknown-wrapper-unwrapped", rule: "CX-13", rel: CODEX_REL, from: PIN.innerFallback, to: String.raw`  return trimmed.replace(/^\S+\s+/, '');` + "\n}" },
  { name: "pwsh-wrapper-any-path", rule: "CX-13", rel: CODEX_REL, from: PIN.pwshWrapper, to: String.raw`/^\S*pwsh\.exe"?\s+-Command\s+([\s\S]+)$/i,` },
  { name: "cmd-wrapper-any-path", rule: "CX-13", rel: CODEX_REL, from: PIN.cmdWrapper, to: String.raw`/^\S*cmd\.exe"?\s+\/c\s+([\s\S]+)$/i,` },
  { name: "bash-wrapper-any-shell", rule: "CX-13", rel: CODEX_REL, from: PIN.bashWrapper, to: String.raw`/^\S+\s+-\w*c\s+([\s\S]+)$/,` },
  { name: "config-override-not-forbidden", rule: "CX-12", rel: CODEX_REL, from: PIN.forbidC, to: "" },
  { name: "attached-override-forms-admitted", rule: "CX-12", rel: CODEX_REL, from: PIN.attachedUsed, to: "FORBIDDEN_TOKENS.has(a.split('=')[0] as string)" },
  { name: "network-fetch-not-a-denial", rule: "CX-14", rel: CODEX_REL, from: PIN.fetchDenied, to: "" },
  { name: "fetch-names-dropped", rule: "CX-14", rel: CODEX_REL, from: PIN.fetchNames, to: "ZZZ" },
  { name: "blocked-by-policy-not-a-denial", rule: "CX-14", rel: CODEX_REL, from: PIN.policyWording, to: "/sandbox|permission denied|" },
  { name: "wrapper-not-unwrapped-before-check", rule: "CX-13", rel: CODEX_REL, from: PIN.innerUsed, to: "const command = reported;" },
  { name: "powershell-wrapper-any-path", rule: "CX-13", rel: CODEX_REL, from: PIN.psWrapper, to: String.raw`/^\S*powershell\.exe"?\s+-Command\s+([\s\S]+)$/i,` },
  { name: "sandbox-gate-ignored", rule: "CX-1", rel: CODEX_REL, from: PIN.sandboxGate, to: "return { ok: true, argv };" },
  { name: "bypass-flag-added", rule: "CX-2", rel: CODEX_REL, from: "const FIXED_REVIEW_ARGS: readonly string[] = ['--json',", to: "const FIXED_REVIEW_ARGS: readonly string[] = ['--dangerously-bypass-approvals-and-sandbox', '--json'," },
  { name: "workspace-write-sandbox", rule: "CX-2", rel: CODEX_REL, from: "['--sandbox', 'read-only'];", to: "['--sandbox', 'workspace-write'];" },
  { name: "bypass-no-longer-refused", rule: "CX-2", rel: CODEX_REL, from: "  ['--dangerously-bypass-approvals-and-sandbox', 'skips every approval and the sandbox'],\n", to: "" },
  { name: "codex-implements", rule: "CX-3", rel: CODEX_REL, from: PIN.startRefuses, to: "start(sys: System, worker: AuthorisedWorker): WorkerOutcome {\n    return reviewOutcomeFrom(sys.exec(worker.command, ['exec'], {}), 0);\n  }," },
  { name: "codex-rejoins", rule: "CX-3", rel: CODEX_REL, from: PIN.rejoinRefuses, to: "rejoin(): WorkerOutcome {\n    return { kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: null };\n  }," },
  { name: "forked-verdict-parser", rule: "CX-4", rel: CODEX_REL, from: "export function codexReviewEnvelope(", to: "export function parseReviewerVerdict(text: string) { return text.includes('PROJECTOS-REVIEW '); }\nexport function codexReviewEnvelope(" },
  { name: "turns-inflated", rule: "CX-4", rel: CODEX_REL, from: PIN.envelopeTurns, to: "num_turns: 2 + run.reads," },
  { name: "denials-dropped", rule: "CX-4", rel: CODEX_REL, from: PIN.envelopeDenials, to: "permission_denials: []," },
  { name: "loop-bypasses-shared-parser", rule: "CX-4", rel: REVIEW_REL, from: PIN.sharedParse, to: "const parsed = { ok: true, verdict: 'APPROVE', reviews: requested, findings: [] } as const;" },
  { name: "credentials-inherited", rule: "CX-5", rel: CODEX_REL, from: PIN.scrub, to: "scrubCredentials: false, ensureSystemPath: true, cwd: brief.repository.root," },
  { name: "key-in-env", rule: "CX-5", rel: CODEX_REL, from: PIN.scrub, to: "scrubCredentials: true, ensureSystemPath: true, cwd: brief.repository.root, env: { OPENAI_API_KEY: worker.workerId }," },
  { name: "credential-arg-accepted", rule: "CX-5", rel: CODEX_REL, from: PIN.credentialRefused, to: "if (false) {" },
  { name: "configured-args-unchecked", rule: "CX-6", rel: CODEX_REL, from: PIN.argsChecked, to: "const problems: string[] = [];\n  if (problems.length > 0) return { ok: false," },
  { name: "unknown-arg-passes", rule: "CX-6", rel: CODEX_REL, from: PIN.unknownRefused, to: "`ignored ${flag}` +" },
  { name: "review-unbounded", rule: "CX-7", rel: CODEX_REL, from: PIN.bounded, to: "maxOutputBytes: WORKER_MAX_OUTPUT_BYTES," },
  { name: "unbounded-worker-started", rule: "CX-7", rel: CODEX_REL, from: PIN.boundRefused, to: "const unbounded = boundProblem(worker);\n    if (false) return { kind: 'refused', detail: unbounded };" },
  { name: "kind-not-wired", rule: "CX-8", rel: CLAUDE_REL, from: PIN.wired, to: "" },
  // ECC SECURITY review of this phase
  { name: "valued-flag-value-unchecked", rule: "CX-6", rel: CODEX_REL, from: PIN.valueChecked, to: "else problems.push();" },
  { name: "outside-path-not-a-denial", rule: "CX-9", rel: CODEX_REL, from: PIN.outsideDenied, to: "if (false) return 'command_execution: names a path outside the repository';" },
  { name: "codex-home-not-caught", rule: "CX-9", rel: CODEX_REL, from: PIN.leavesHome, to: "if (HOME_REFERENCE.test(command) || PARENT_ESCAPE.test(command)) return true;" },
  { name: "absolute-path-elsewhere-allowed", rule: "CX-9", rel: CODEX_REL, from: PIN.leavesAbsolute, to: "return false;" },
  { name: "unc-path-allowed", rule: "CX-9", rel: CODEX_REL, from: PIN.leavesUnc, to: "if (POSIX_HOME.test(command)) return true;" },
  { name: "unc-long-path-and-pipe-escape", rule: "CX-9", rel: CODEX_REL, from: PIN.uncShape, to: PIN.uncShape.replace(String.raw`(?:[^\s\\/'"|;&<>()]+[\\/]`, String.raw`(?:[A-Za-z0-9-]+[\\/]`) },
  { name: "unc-doubled-separator-escape", rule: "CX-9", rel: CODEX_REL, from: PIN.uncShape, to: PIN.uncShape.replace(String.raw`|[^\s\\/'"|;&<>()]{2,}[\\/]{2,}[^\s\\/]`, "") },
  { name: "unc-subexpression-host-escape", rule: "CX-9", rel: CODEX_REL, from: PIN.uncShape, to: PIN.uncShape.replace(String.raw`|\$\()`, ")") },
  { name: "checkout-root-not-passed", rule: "CX-9", rel: CODEX_REL, from: PIN.eventsWithContext, to: "const run = readCodexEvents(r.stdout);" },
  { name: "credential-reply-passed-through", rule: "CX-10", rel: CODEX_REL, from: "credentialShaped(lastMessage, context?.instruction ?? '')", to: "false" },
  { name: "withheld-reply-not-a-denial", rule: "CX-10", rel: CODEX_REL, from: "    beyond.set(`${CODEX_REPLY_WITHHELD}#reply`, CODEX_REPLY_WITHHELD);\n", to: "" },
  { name: "jwt-shape-dropped", rule: "CX-10", rel: CODEX_REL, from: PIN.jwtShape, to: "" },
  { name: "token-names-dropped", rule: "CX-10", rel: CODEX_REL, from: PIN.tokenNames, to: "" },
  { name: "long-run-ignored", rule: "CX-10", rel: CODEX_REL, from: PIN.longRunCounts, to: "if (false) return true;" },
  { name: "any-completed-command-is-a-read", rule: "CX-11", rel: CODEX_REL, from: PIN.readIsExitZero, to: "return item['status'] === 'completed';" },
  { name: "declined-not-a-denial", rule: "CX-11", rel: CODEX_REL, from: PIN.declinedDenied, to: "" },
  { name: "sandbox-failure-not-a-denial", rule: "CX-11", rel: CODEX_REL, from: PIN.sandboxDenied, to: "if (false && SANDBOX_REFUSAL.test(" },
  { name: "error-item-ignored", rule: "CX-11", rel: CODEX_REL, from: PIN.neutralNoError, to: "const NEUTRAL_ITEMS: ReadonlySet<string> = new Set(['agent_message', 'reasoning', 'todo_list', 'error']);" },
  { name: "agents-override-unguarded", rule: "RV-1", rel: ROLES_REL, from: "AGENTS(\\.override)?\\.md$", to: "AGENTS\\.md$" },
  { name: "dot-agents-unguarded", rule: "RV-1", rel: ROLES_REL, from: "|\\.agents(\\/|$)", to: "" },
  { name: "shell-grant-claim-back", rule: "RV-1", rel: ROLES_REL, from: "You may only read: you hold no write grant, and any shell you are given is read-only; change nothing. ", to: "You hold no write or shell grant; change nothing. " },
  { name: "response-id-unbounded", rule: "CW-1", rel: WAIT_REL, from: PIN.idShape, to: "const PROVIDER_RESPONSE_ID = /^.*$/;" },
  { name: "trace-prints-raw-response-id", rule: "CW-1", rel: CLOSURE_REL, from: "safeProviderResponseId(turn.providerResponseId)", to: "turn.providerResponseId" },
  { name: "wait-stores-raw-response-id", rule: "CW-1", rel: CLOSURE_REL, from: "providerResponseId: safeProviderResponseId(obtained.providerResponseId)", to: "providerResponseId: obtained.providerResponseId" },
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments outside strings — the same walk `val-projectos-kernel-cost-cap1a` uses. CRLF is folded to LF first. */
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

/** The MODULES list as names, from comment-stripped code, or null when it cannot be found. */
function modulesOf(src) {
  const m = src.match(/const MODULES\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter((s) => s.length > 0);
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  const src = {};
  for (const rel of SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("FU-0", `${rel} is missing`);
      return errors;
    }
    src[rel] = code(raw[rel]);
  }
  const va = src[VA_REL];
  const cr = src[CR_REL];
  const cx = src[CODEX_REL];

  if (!va.includes(PIN.scan) || !va.includes(PIN.unregistered)) {
    E("FU-1", "validate-all no longer refuses a validator file that is neither registered nor retired");
  }
  if (!va.includes(PIN.realReason) || !va.includes(PIN.phantomRetired)) {
    E("FU-2", "validate-all no longer refuses a retirement without a real reason, or one with no file behind it");
  }
  if (!va.includes(PIN.bothRegistered)) E("FU-3", "validate-all no longer refuses a validator that is both registered and retired");
  if (!va.includes(PIN.nonArrayCrash) || !cr.includes(PIN.nonArrayCrash)) {
    E("FU-4", "validate-all or cached-runner would read a non-array run() result (an async validator) as a PASS");
  }
  if (!va.includes(PIN.registryFails) || !va.includes(PIN.evidenceWithheld)) {
    E("FU-5", "a registry problem no longer fails the run and withholds the evidence record");
  }
  const vaModules = modulesOf(va);
  const crModules = modulesOf(cr);
  if (vaModules === null || crModules === null || JSON.stringify(vaModules) !== JSON.stringify(crModules)) {
    E("FU-6", "cached-runner's MODULES is not exactly validate-all's MODULES");
  } else if (!vaModules.includes("val-projectos-kernel-followup1a")) {
    E("FU-6", "this validator is not registered in validate-all");
  }

  if (![PIN.readOnly, PIN.argvBuild, PIN.sandboxGate, PIN.sandboxCount].every((p) => cx.includes(p))) {
    E("CX-1", "the Codex review no longer always runs, and only runs, in the read-only sandbox");
  }
  const mapStart = cx.indexOf("const FORBIDDEN_TOKENS");
  const mapEnd = mapStart < 0 ? -1 : cx.indexOf("]);", mapStart);
  const refusalMap = mapStart < 0 || mapEnd < 0 ? "" : cx.slice(mapStart, mapEnd);
  const outsideMap = mapStart < 0 || mapEnd < 0 ? cx : cx.slice(0, mapStart) + cx.slice(mapEnd);
  const leaked = WIDENING.filter((t) => outsideMap.includes(`'${t}'`) || outsideMap.includes(`"${t}"`));
  const unrefused = WIDENING.filter((t) => !refusalMap.includes(`['${t}',`));
  if (leaked.length > 0 || unrefused.length > 0) {
    E("CX-2", `a sandbox-widening flag is used (${leaked.join(", ") || "none"}) or no longer refused (${unrefused.join(", ") || "none"})`);
  }
  const execCalls = cx.split("sys.exec(").length - 1;
  if (!cx.includes(PIN.startRefuses) || !cx.includes(PIN.rejoinRefuses) || execCalls !== 1) {
    E("CX-3", "the Codex adapter's start or rejoin no longer refuses before spawning, or it spawns from more than review");
  }
  const forked = /parseReviewerVerdict|verdictMarker|reviewerText|PROJECTOS-REVIEW/.test(cx);
  if (forked || ![PIN.envelopeResult, PIN.envelopeTurns, PIN.envelopeDenials].every((p) => cx.includes(p)) ||
      !src[REVIEW_REL].includes(PIN.sharedParse) || !src[REVIEW_REL].includes(PIN.sharedDispatch)) {
    E("CX-4", "the Codex reply is not read by the loop's one shared reviewer parser, or its envelope misreports reads or denials");
  }
  if (!cx.includes(PIN.scrub) || !cx.includes(PIN.credentialRefused) || /\benv\s*:/.test(cx) || CREDENTIAL_LITERALS.test(cx)) {
    E("CX-5", "the Codex reviewer can be handed a credential argument or environment variable");
  }
  if (!cx.includes(PIN.argsChecked) || !cx.includes(PIN.unknownRefused) || !cx.includes(PIN.valueChecked)) {
    E("CX-6", "configured Codex arguments are no longer a closed allowlist");
  }
  if (!cx.includes(PIN.bounded) || !cx.includes(PIN.boundRefused)) E("CX-7", "the Codex review is no longer bounded");
  if (!src[CLAUDE_REL].includes(PIN.wired) || !/import \{ CODEX_CLI, codexCliAdapter \} from '\.\/codexCli\.js';/.test(src[CLAUDE_REL])) {
    E("CX-8", "the codex-cli kind is not wired into BUILT_IN_ADAPTERS");
  }
  if (![PIN.leavesHome, PIN.leavesUnc, PIN.uncShape, PIN.leavesAbsolute, PIN.codexHome, PIN.outsideDenied, PIN.commandChecked, PIN.contextPassed, PIN.eventsWithContext].every((p) => cx.includes(p))) {
    E("CX-9", "a Codex command that names a path outside the checkout (home, .codex, .., UNC, an absolute path elsewhere) is no longer reported as a denial");
  }
  if (![PIN.withheld, PIN.jwtShape, PIN.skShape, PIN.tokenNames, PIN.bearerShape, PIN.longRun, PIN.longRunCounts].every((p) => cx.includes(p))) {
    E("CX-10", "a Codex reply carrying credential-shaped content is no longer withheld whole and reported as a denial");
  }
  if (![PIN.readIsExitZero, PIN.readCounted, PIN.declinedDenied, PIN.sandboxDenied, PIN.neutralNoError, PIN.errorItemFails, PIN.errorItemFailure].every((p) => cx.includes(p))) {
    E("CX-11", "a Codex read is no longer only a command that completed with exit 0, or a declined, sandbox-stopped or error item is no longer refused");
  }
  const roles = src[ROLES_REL];
  if (!roles.includes(PIN.agentsOverride) || !roles.includes(PIN.readOnlyWords) || roles.includes("no write or shell grant")) {
    E("RV-1", "the steering guard no longer covers AGENTS.override.md and .agents/, or the reviewer is told something untrue of a Codex reviewer");
  }
  const closureSrc = src[CLOSURE_REL];
  if (!src[WAIT_REL].includes(PIN.idShape) || !src[WAIT_REL].includes(PIN.idGate) || !closureSrc.includes(PIN.traceGated) ||
      !closureSrc.includes(PIN.waitGated) || /turn\.providerResponseId \?\?|providerResponseId: obtained\.providerResponseId/.test(closureSrc)) {
    E("CW-1", "a provider response id reaches the closure trace or wait without passing the one bounded-identifier gate");
  }
  if (![PIN.fetchDenied, PIN.fetchNames, PIN.policyWording].every((p) => cx.includes(p))) {
    E("CX-14", "a Codex network fetch, decode-and-run command or policy-blocked command is no longer a denial");
  }
  if (![PIN.winSandbox, PIN.winPairOnly, PIN.winPairOnce, PIN.winPairStripped, PIN.forbidC, PIN.attachedForms, PIN.attachedUsed].every((p) => cx.includes(p)) ||
      !cx.includes("...READ_ONLY_SANDBOX, ...WINDOWS_SANDBOX, ...FIXED_REVIEW_ARGS")) {
    E("CX-12", "the Codex reviewer no longer always carries the fixed Windows sandbox mode as the only configuration override");
  }
  if (![PIN.innerUsed, PIN.innerKnownOnly, PIN.innerFallback, PIN.psWrapper, PIN.pwshWrapper, PIN.cmdWrapper, PIN.bashWrapper].every((p) => cx.includes(p))) {
    E("CX-13", "a Codex command is no longer judged by the inner command of a known shell wrapper only, one layer, with unknown wrappers left whole");
  }
  return errors;
}

/** Every named mutation must be killed by its own rule. Applied to CRLF-folded text, as `check` reads it. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel] === null || raw[m.rel] === undefined ? null : raw[m.rel].replace(/\r\n/g, "\n");
    if (text === null || !text.includes(m.from)) {
      errors.push(`FU-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`FU-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

function run() {
  const raw = {};
  for (const rel of SOURCES) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      errors.push(`FU-T: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`FU-T: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-kernel-followup1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log(`val-projectos-kernel-followup1a: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
