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
const SOURCES = [VA_REL, CR_REL, CODEX_REL, CLAUDE_REL, REVIEW_REL];

const TESTS = {
  "projectos/agent/test/codexCliAdapter.test.ts": [
    "runs codex exec in the read-only sandbox, in the candidate checkout, with the instruction as the prompt",
    "is bounded, scrubs credential-shaped environment variables, and passes no environment of its own",
    "refuses configured args %j that could widen the sandbox, and spawns nothing",
    "refuses a credential-shaped argument %j and passes nothing",
    "refuses when the finished command line does not carry exactly one read-only sandbox",
    "start refuses with a clear reason and spawns nothing",
    "rejoin refuses with the same reason and spawns nothing",
    "is wired into the built-in adapter registry under its own kind",
    "a clean run parses to the verdict, with the reads as turns and no denials",
    "a reviewer that read nothing reports one turn, which the loop refuses as no review",
    "an attempted write or tool call is a denial, counted once per item",
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
  argvBuild: "const argv = ['exec', ...worker.args, ...READ_ONLY_SANDBOX, ...FIXED_REVIEW_ARGS, '--cd', root, instruction];",
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
  { name: "sandbox-left-off-argv", rule: "CX-1", rel: CODEX_REL, from: PIN.argvBuild, to: "const argv = ['exec', ...worker.args, ...FIXED_REVIEW_ARGS, '--cd', root, instruction];" },
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
  if (!cx.includes(PIN.argsChecked) || !cx.includes(PIN.unknownRefused)) {
    E("CX-6", "configured Codex arguments are no longer a closed allowlist");
  }
  if (!cx.includes(PIN.bounded) || !cx.includes(PIN.boundRefused)) E("CX-7", "the Codex review is no longer bounded");
  if (!src[CLAUDE_REL].includes(PIN.wired) || !/import \{ CODEX_CLI, codexCliAdapter \} from '\.\/codexCli\.js';/.test(src[CLAUDE_REL])) {
    E("CX-8", "the codex-cli kind is not wired into BUILT_IN_ADAPTERS");
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
