"use strict";
/**
 * THE APPROVAL RULES — PROJECTOS-PORT-APPROVALS1A (plan v1.31, docs/changes/delta_spec_V4_PORTS.md).
 *
 * An approval bound to one run, tool and argument hash; taint, so that once outside content enters a run an
 * action it could steer needs a fresh approval; and evidence receipts, so a phase claiming done without its
 * receipt is refused. All three are pure core, beside the kernel's gates and wired to nothing:
 *
 *   AP-1  "the run is context"                        — and an approval travels to another run
 *   AP-2  "the tool is context"                       — and approving one tool approves its neighbour
 *   AP-3  "a hash of most of the arguments"           — and one changed digit runs on the old approval
 *   AP-4  "a colon is a fine separator"               — and two runs and tools share a key
 *   AP-5  "JSON is JSON"                              — and a value with two readings is hashed as one
 *   AP-6  "key order is part of the value"            — and the same arguments need a second approval
 *   AP-7  "the worker asked nicely"                   — and something other than the owner approves
 *   AP-8  "it has every field an approval has"        — and a worker's JSON is an approval
 *   AP-9  "approvals are forever"                     — and a yes from last month still spends
 *   AP-10 "the owner said yes to this"                — and one yes runs the same effect five times
 *   AP-11 "the owner can approve anything"            — and P6 becomes grantable
 *   AP-12 "the run looked fine"                       — and injected text picks the next action
 *   AP-13 "it was approved earlier"                   — and an approval outlives the content that changes it
 *   AP-14 "keep the old state, it was clean"          — and taint comes off by holding on to a variable
 *   AP-15 "only known tools bring content in"         — and a new tool launders the run
 *   AP-16 "a run starts clean"                        — and a webhook or a resumed attempt is trusted
 *   AP-17 "reads are harmless"                        — and a read carries the secret out in its arguments
 *   AP-18 "a state is a state"                        — and a literal says the run is clean
 *   AP-19 "any clean state will do"                   — and another run's guard speaks for this one
 *   AP-20 "the phase said it was done"                — and done needs no receipt
 *   AP-21 "a receipt is a JSON file"                  — and a worker writes its own
 *   AP-22 "a receipt is a receipt"                    — and another phase's or another commit's counts
 *   AP-23 "the exit code was zero, they told me"      — and reported done reads as verified
 *   AP-24 "run it again until it is green"            — and an observed failure can be re-rolled
 *   AP-25 "nothing is missing"                        — and an empty requirement list is ready
 *   AP-26 "the blocker can wait"                      — and a phase is done with something in the way
 *   AP-27 "a smart mode would be faster"              — and a model or a flag passes what a person should
 *   AP-28 "pure enough"                               — and core reads a clock, a file or the environment
 *   AP-29 "wire it in while we are here"              — and an unreviewed rule enters the run loop
 *   AP-30 "their name is on the best code"            — and an upstream name becomes product text
 *   AP-31 "the credit validator covers this"          — and the list of what was ported drifts, or a
 *                                                       source with no approved licence is carried in
 *   AP-32 "export it later"                           — and the next phase re-implements it
 *   AP-33 "register it later"                         — and nothing ever runs this file
 *   AP-34 "the tests exist"                           — and `.skip` keeps the proof while dropping the run
 *   AP-35 "the record can say less"                   — and nobody reads what this does not do
 *
 * Added in the review round (ECC SECURITY, Agency application-security-engineer):
 *
 *   AP-36 "a new guard is a new start"                — and a spent approval replays on the next attempt
 *   AP-37 "the result was on an old handle"           — and a missed call site launders the run
 *   AP-38 "the requirements are in the claim"         — and a claimant chooses what done means
 *   AP-39 "I watched myself do it"                    — and the implementer signs its own receipt
 *   AP-40 "depth is the only limit"                   — and a small object expands for 18 seconds
 *   AP-41 "a decision can say what it likes"          — and a yes dates itself ahead, or lasts for ever
 *   AP-42 "the kernel's list is the kernel's"         — and a write on the own-state list launders taint
 *
 * A PROOF COUNTS ONLY IF REMOVING ITS RULE MAKES IT FAIL. AP-1 to AP-26 and AP-36 to AP-42 are behaviour, so
 * they are proved by behaviour. This file compiles the real source, runs each scenario, then removes one rule from the source
 * and runs them all again. A refusal scenario counts as killed only when the refused call now goes THROUGH.
 * Refused under some other name is not a kill: that would be a fail-closed default standing behind the rule,
 * and it would prove nothing. A control counts when it stops passing. Every other scenario must stay as it
 * was, unless the mutation declares it and it really moves, so a proof cannot be carried by something else.
 *
 * AP-27 to AP-35 are about the text of the tree, so they are pinned, and each mutation is applied in memory
 * and counted only when its own rule fires. Comments are stripped before those rules judge code.
 *
 * Compiles and runs the approvals source in this process. Reads files; writes nothing; starts nothing.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const credit = require("./val-projectos-port-credit1a.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-port-approvals1a";
const CORE_SRC = "projectos/core/src";
const DIR = `${CORE_SRC}/approvals`;
const EFFECT_REL = `${DIR}/effectKey.ts`;
const TAINT_REL = `${DIR}/taint.ts`;
const APPROVAL_REL = `${DIR}/toolApproval.ts`;
const RECEIPT_REL = `${DIR}/evidenceReceipt.ts`;
const INSTANT_REL = `${DIR}/instant.ts`;
const BARREL_REL = `${DIR}/index.ts`;
const CORE_BARREL_REL = `${CORE_SRC}/index.ts`;
const NOTICES_REL = "THIRD_PARTY_NOTICES";
const REGISTRY_REL = "projectos/security/action-registry.json";
const FINISH_REL = "docs/finish/PROJECTOS-PORT-APPROVALS1A.md";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const TYPESCRIPT = "projectos/core/node_modules/typescript";

const BINDING_TEST_REL = "projectos/core/test/approvals-tool-binding.test.ts";
const TAINT_TEST_REL = "projectos/core/test/approvals-taint.test.ts";
const EVIDENCE_TEST_REL = "projectos/core/test/approvals-evidence.test.ts";

/** Every file in the directory, and what it is. A file that is not listed here cannot land. */
const PORTED = {
  [EFFECT_REL]: { id: "rakazo", paths: ["packages/core/src/approval-effect-key.ts"] },
  [TAINT_REL]: { id: "rakazo", paths: ["packages/core/src/action-approval.ts", "packages/adapters/src/run-context.ts"] },
  [RECEIPT_REL]: {
    id: "oh-my-hermes",
    paths: ["src/evidence/labels.py", "src/evidence/observed_check_results.py", "src/workflows/goal_ledger.py", "benchmarks/cross-harness/live/lib/receipt.py"],
  },
};
const ORIGINAL = [APPROVAL_REL, INSTANT_REL, BARREL_REL];
const ALL_FILES = [...Object.keys(PORTED), ...ORIGINAL];

/** The core barrel may name this directory once, and nothing else in the product may at all. */
const WIRED_NAMES = /\b(?:checkToolCall|issueToolApproval|startRunGuard|recordOutsideContent|recordToolResult|markToolCalled|declarePlanChecks|claimDone|recordCheckReceipt|deriveToolEffect)\b|approvals\/(?:index|effectKey|taint|toolApproval|evidenceReceipt|instant)\b/;
const BARREL_LINE = "export * from './approvals/index.js';";
/** The barrel is what `@projectos/core` shows. It may check, and it may not mint. */
const PUBLIC_NAMES = ["canonicalArguments", "deriveToolEffect", "actionCouldBeSteered", "freshApprovalNeeded", "isRunTainted", "RunGuardRefused", "toolResultTaintsRun", "checkToolCall", "MAX_APPROVAL_LIFETIME_MS", "CHECK_SOURCES", "claimDone"];
const MINTERS = ["startRunGuard", "recordOutsideContent", "recordToolResult", "markToolCalled", "isLiveRunGuard", "issueToolApproval", "recordCheckReceipt", "declarePlanChecks"];

const REFUSED_MODES = /yolo|judge|auto[-_ ]?(?:review|approve|mode)|skip[-_ ]?approval|always[-_ ]?allow|approval[-_ ]?mode|never[-_ ]?ask|bypass|smart[-_ ]?(?:mode|approval)|dangerously/i;
/** The decision a person makes, and the check a call passes. A new field or argument is a deliberate change here. */
const DECISION_FIELDS = ["approvalId", "decidedBy", "decidedAt", "expiry"];
const CHECK_PARAMETERS = "guard: RunGuard, call: ToolCall, registry: ActionRegistry, approval: ToolApproval | null, now: string";
/** `completion_integrity.py` takes its placeholder values and test vocabulary from a Sustainable Use source. */
const UNAPPROVED_SOURCE = /completion[-_]integrity/i;
const UNAPPROVED_VOCABULARY = /\btbd\b|\bplaceholder\b|\bself[-_ ]?referential\b/i;
const UPSTREAM_NAME = /rakazo|oh-?my-?hermes|\bomh\b/i;
const CREDIT_LINE = /^\/\/ (?:Ported-From|Source-Copyright|Source-Path|Source-Commit|Modified-By|SPDX-License-Identifier|Port-Strategy|Notice):/;

const PURITY = {
  [EFFECT_REL]: ["node:crypto"],
  [TAINT_REL]: ["../actionRegistry.js"],
  [APPROVAL_REL]: ["../actionRegistry.js", "../types.js", "./effectKey.js", "./instant.js", "./taint.js"],
  [RECEIPT_REL]: ["./instant.js"],
  [INSTANT_REL]: [],
  [BARREL_REL]: ["./effectKey.js", "./taint.js", "./toolApproval.js", "./evidenceReceipt.js"],
};
const SPECIFIERS = [/^\s*import\s*['"]([^'"]+)['"]/gm, /^\s*import\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, /^\s*export\b[^'"=]*?\bfrom\s*['"]([^'"]+)['"]/gm];
const IMPURE = /\bprocess\s*[.[]|\bperformance\s*[.[]|\bglobalThis\b|\bglobal\s*[.[]|\bimport\s*\(|\bimport\.meta\b|\brequire\(|\beval\(|\bnew Function\b|Date\.now|new Date\(\)|Math\.random|\bfetch\(|\bconsole\.|\breadFile|\bwriteFile|\bexecSync|\bspawn\(/;

const TESTS = {
  [BINDING_TEST_REL]: [
    "the exact call clears, and hands back the bytes that were approved: the positive control",
    "every one-character change to the run is refused",
    "every one-character change to the tool is refused",
    "every one-character change to the arguments is refused",
    "a run and tool cannot trade characters: the upstream colon-joined key collided here",
    "a perfect copy of an approval is not an approval",
    "the second use of one approval is refused, even from the guard the first use returned",
    "P6 is refused with an approval from the owner, and without one",
    "there is no approval mode to pass: the decision names a person, and nothing else",
    "a clean P5 clears here and is still refused by the door, with an approval in hand",
    "a new lineage at the same generation: only the token refuses it, and its spent list is empty",
    "spent state belongs to the lineage: a reissued id stays spent on the next attempt",
    "the shared-reference bomb a reviewer timed at 18 s is refused quickly",
    "a decision from the future is refused, and the same decision at its own time is not",
    "a lifetime past the cap is refused, and a lifetime at the cap is not",
  ],
  [TAINT_TEST_REL]: [
    "%s: refused once tainted, clears on the same run untainted",
    "an approval given before the content is not fresh, and the same approval clears untainted",
    "more content after a fresh approval makes it stale again",
    "a clean state kept from before the content is dead: nobody can go back to it",
    "no write turns a forged state into a live one",
    "and its taint is counted on the lineage all the same",
    "after a cleared call, the next check refuses until the result is recorded",
    "does not start clean, with the same lineage token or a new one",
    "%s is P1 local in the registry and can carry content off the machine, so it needs a fresh approval",
    "a local write on the own-state list still taints",
    "a tool result taints by default, and a new tool taints",
    "a read that leaves the machine carries arguments the content could choose",
  ],
  [EVIDENCE_TEST_REL]: [
    "with its receipt is ready: the positive control for everything below",
    "without its receipt is refused",
    "with nothing required proves nothing, so it is refused rather than ready",
    "a perfect copy of a receipt is not a receipt: a worker can write the JSON, and only the kernel records one",
    "an operator report of a pass is reported done, and it cannot close a claim",
    "an observed failure outranks a pass on the same commit: green cannot be re-rolled",
    "a plan nobody declared is refused, and the declared plan is ready on the same receipts",
    "a narrower command is refused",
    "a narrower scope is refused",
    "an observer equal to the implementer is refused, and another observer is ready",
  ],
};
const NOT_RUN = /\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|fails|skipIf|runIf)\b|\.(?:skip|only)\(|\b(?:xit|fit|xdescribe|fdescribe)\(/;

const SOURCE_PINS = {
  [APPROVAL_REL]: ["A CLEAR RESULT GRANTS NOTHING.", "WHAT THIS MODULE CANNOT PROVE.", "ONLY A PERSON DECIDES.", "AN APPROVAL CAN NEVER ANSWER THE ENVELOPE GRANT PORT."],
  [TAINT_REL]: ["WHAT THIS MODULE CANNOT PROVE.", "TAINT NEVER COMES OFF", "taint is sound only under complete mediation"],
  [RECEIPT_REL]: ["WHAT THIS MODULE CANNOT PROVE", "REPORTED DONE IS NOT VERIFIED."],
};
const FINISH_PINS = {
  "that nothing is wired": "Nothing is wired into the run loop.",
  "that no gate changed": "No gate was loosened or replaced.",
  "what was refused": "No model-judged approval and no no-approval mode was ported.",
  "the licence catch": "`src/quality/completion_integrity.py` was not ported",
  "the unsafe default replaced": "The upstream key was `run:tool:digest`",
  "the credit validator defect": "`selfTest` appends its fixture entries to the real notices",
  "the first binding term": "`decidedBy` must become a Host-authenticated owner proof, not a role string",
  "the second binding term": "An approval names its envelope, with action = tool and subjectHash = argumentHash",
  "the third binding term": "Unmediated CLI workers start tainted, with taint recorded before the model reads, because taint is sound only under complete mediation",
  "the fourth binding term": "The kernel runs receipt checks itself and pins definition hashes",
  "the fifth binding term": "The owner sees canonical bytes and taint sources, never model summaries",
  "the first review": "ECC SECURITY: APPROVE WITH CHANGES",
  "the second review": "Agency application-security-engineer: APPROVE WITH CHANGES",
  "what the P1 review found": "`bridge-read` answers a conversation on the far side of the tunnel",
};

const RULE_NAMES = {
  "AP-1": "run not bound", "AP-2": "tool not bound", "AP-3": "arguments not bound", "AP-4": "key fields can trade characters",
  "AP-5": "arguments with two readings", "AP-6": "key order changes the effect", "AP-7": "approved by someone other than the owner",
  "AP-8": "forged approval", "AP-9": "expired approval", "AP-10": "approval reused", "AP-11": "P6 approvable", "AP-12": "taint does not gate",
  "AP-13": "stale approval", "AP-14": "taint comes off", "AP-15": "tool results do not taint", "AP-16": "a run starts clean regardless",
  "AP-17": "wrong reading of what can be steered", "AP-18": "forged guard", "AP-19": "another run's guard", "AP-20": "done without a receipt",
  "AP-21": "forged receipt", "AP-22": "receipt for something else", "AP-23": "reported done reads as verified", "AP-24": "failure can be re-rolled",
  "AP-25": "empty requirement passes", "AP-26": "done with a blocker", "AP-27": "refused mode", "AP-28": "not pure", "AP-29": "wired in",
  "AP-30": "upstream name in product text", "AP-31": "credit or source drift", "AP-32": "not exported", "AP-33": "not registered",
  "AP-34": "tests missing or not run", "AP-35": "record incomplete", "AP-36": "replay across guards", "AP-37": "a result can be lost",
  "AP-38": "requirements not from the plan", "AP-39": "observer is the implementer", "AP-40": "no budget on arguments", "AP-41": "decision out of bounds",
  "AP-42": "own-state list believed",
};

const read = (rel) => {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
};
/** A commented-out proof or field is not a proof or a field. Trailing comments stay, which only ever refuses more. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
const prose = (text) => text.replace(/<!--[\s\S]*?-->/g, " ").replace(/\*\*/g, "").replace(/\s+/g, " ");

// ---------------------------------------------------------------------------------------------------------
// Compile the real source in memory, with any one file replaced
// ---------------------------------------------------------------------------------------------------------

const compiled = new Map();
let typescript = null;

function compile(text) {
  if (!compiled.has(text)) {
    typescript ??= require(path.join(ROOT, TYPESCRIPT));
    const { CommonJS } = typescript.ModuleKind;
    const options = { module: CommonJS, target: typescript.ScriptTarget.ES2022, isolatedModules: true };
    compiled.set(text, typescript.transpileModule(text, { compilerOptions: options }).outputText);
  }
  return compiled.get(text);
}

/** Load a module from `projectos/core/src` by its relative path. `sources` wins over the file on disk. */
function loadCore(sources) {
  const modules = new Map();
  const load = (rel) => {
    if (modules.has(rel)) return modules.get(rel).exports;
    const text = sources[rel] ?? read(rel);
    if (text === null) throw new Error(`${rel} does not exist`);
    const module = { exports: {} };
    modules.set(rel, module);
    const local = (specifier) =>
      specifier.startsWith(".")
        ? load(path.posix.join(path.posix.dirname(rel), specifier).replace(/\.js$/, ".ts"))
        : require(specifier);
    vm.compileFunction(compile(text), ["exports", "require", "module"], { filename: rel })(module.exports, local, module);
    return module.exports;
  };
  return { ...load(EFFECT_REL), ...load(TAINT_REL), ...load(APPROVAL_REL), ...load(RECEIPT_REL), ...load(`${CORE_SRC}/actionRegistry.ts`) };
}

// ---------------------------------------------------------------------------------------------------------
// The behaviour: every refusal, and the control beside it
// ---------------------------------------------------------------------------------------------------------

const NOW = "2026-11-01T12:00:00.000Z";
const EXPIRY = "2026-11-01T13:00:00.000Z";
const LATER = "2026-11-01T12:30:00.000Z";
const TOO_LONG = "2026-11-01T13:00:00.001Z";
const TOKEN = "lineage-1";
const CONFINED = "project-selection";
const ARGS = { to: "client@example.invalid", amount: 1200 };
const SUBJECT = "a".repeat(40);
const PHASE = "PROJECTOS-PORT-APPROVALS1A";
const CORE_SUITE = { checkId: "core-suite", command: "npm test", scope: "the whole core suite" };
const CREDIT = { checkId: "credit-validator", command: "node val-credit.cjs", scope: "the port directories" };
const OBSERVED = { phaseId: PHASE, checkId: CORE_SUITE.checkId, subject: SUBJECT, command: CORE_SUITE.command, source: "this-checkout", exitStatus: 0, summary: "42 passed", scope: CORE_SUITE.scope, observedBy: "kernel-runner", observedAt: NOW };
const CLAIM = { phaseId: PHASE, subject: SUBJECT, implementer: "claude-implementer", openBlockers: [] };
const EXTRA_ACTIONS = [
  { id: "connector-read", governanceAction: null, ownerOnlyAction: null, class: "P1", environment: "production" },
  { id: "read-other-tenant", governanceAction: null, ownerOnlyAction: null, class: "P6", environment: "local" },
];

function registryOf(core, registryJson, actions) {
  const parsed = core.parseActionRegistry({ ...registryJson, actions });
  if (!parsed.ok) throw new Error("the action registry does not parse");
  return parsed.registry;
}

/** One compiled core, and the moves every scenario is written in. A run's guard lasts as long as the module, so `next` gives each scenario its own. */
function worldOf(core, registryJson) {
  const registry = registryOf(core, registryJson, [...registryJson.actions, ...EXTRA_ACTIONS]);
  const raised = registryOf(core, registryJson, registryJson.actions.map((action) => (action.id === CONFINED ? { ...action, environment: "production" } : action)));
  let serial = 0;
  const world = {
    core,
    registry,
    raised,
    run: "",
    next() {
      serial += 1;
      world.run = `run-${serial}-7f3a`;
    },
    guard: (runId = world.run, lineageToken = TOKEN, change = {}) => core.startRunGuard({ runId, lineageToken, ownerStarted: true, attempt: 1, ...change }),
    tainted: () => core.recordOutsideContent(world.guard(), "a web page"),
    call: (toolName = "commit", args = ARGS, runId = world.run) => ({ runId, toolName, args }),
    free: () => world.call(CONFINED, {}),
    approve(guard, call, approvalId = "approval-1") {
      const issued = core.issueToolApproval({ approvalId, decidedBy: "owner", decidedAt: NOW, expiry: EXPIRY }, call, guard, NOW);
      if (!issued.ok) throw new Error(`the control approval was refused: ${issued.rule}`);
      return issued.approval;
    },
    check(guard, call, approval = null, now = NOW, against = registry) {
      const result = core.checkToolCall(guard, call, against, approval, now);
      return result.taintClear ? null : result.rule;
    },
    /** Clear a call and hand back the guard that came of it. */
    clear(guard, call, approval = null) {
      const result = core.checkToolCall(guard, call, registry, approval, NOW);
      if (!result.taintClear) throw new Error(`the control call was refused: ${result.rule}`);
      return result.guard;
    },
    settle: (guard) => core.recordToolResult(guard, CONFINED, registry, [CONFINED]),
    issue(decision, call, guard, now = NOW) {
      const issued = core.issueToolApproval({ approvalId: "approval-1", decidedBy: "owner", decidedAt: NOW, expiry: EXPIRY, ...decision }, call, guard, now);
      return issued.ok ? null : issued.rule;
    },
    /** What a write that must not be ignored answered: the rule it threw, or `null` if it went through. */
    thrown(write) {
      try {
        write();
        return null;
      } catch (error) {
        if (error instanceof core.RunGuardRefused) return error.rule;
        throw error;
      }
    },
    receipt(change = {}) {
      const recorded = core.recordCheckReceipt({ ...OBSERVED, ...change });
      if (!recorded.ok) throw new Error(`the control receipt was refused: ${recorded.reasons.join("; ")}`);
      return recorded.receipt;
    },
    plan(checks = [CORE_SUITE], phaseId = PHASE) {
      const declared = core.declarePlanChecks({ phaseId, checks });
      if (!declared.ok) throw new Error("the control plan was refused");
      return declared.plan;
    },
    claim(receipts, change = {}, plan = world.plan()) {
      const verdict = core.claimDone({ ...CLAIM, ...change }, plan, receipts);
      return verdict.ready ? null : verdict.gaps[0].rule;
    },
    /** An approval used on a tainted first attempt, so a later guard's generation can line up with it. */
    spentOnTaintedRun() {
      const guard = world.tainted();
      const approval = world.approve(guard, world.free());
      world.clear(guard, world.free(), approval);
      return approval;
    },
  };
  return world;
}

const S = (rule, name, want, run, heavy = false) => ({ rule, name, want, run, heavy });
const MISMATCH = "APPROVAL_EFFECT_MISMATCH";
const FRESH = "FRESH_APPROVAL_REQUIRED";
const DEAD = "RUN_STATE_NOT_LIVE";
const PENDING = "RESULT_PENDING";
const BAD_ARGS = "BAD_ARGUMENTS";
const hidden = () => Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false });
const withGetter = () => Object.defineProperty({}, "a", { get: () => 1, enumerable: true });
const doubling = (depth) => Array.from({ length: depth }).reduce((inner) => [inner, inner], "a");
const effect = (w, call) => (w.core.deriveToolEffect(call).ok ? null : "NO_EFFECT");

const SCENARIOS = [
  S("AP-1", "the-exact-call-clears", null, (w) => { const g = w.guard(); return w.check(g, w.call(), w.approve(g, w.call())); }),
  S("AP-1", "a-one-byte-change-to-the-run-is-refused", MISMATCH, (w) => {
    const approval = w.approve(w.guard(), w.call());
    const other = `${w.run.slice(0, -1)}b`;
    return w.check(w.guard(other), w.call("commit", ARGS, other), approval);
  }),
  S("AP-1", "a-blank-run-has-no-effect", "NO_EFFECT", (w) => effect(w, { runId: " ", toolName: "commit", args: {} })),
  S("AP-2", "a-one-byte-change-to-the-tool-is-refused", MISMATCH, (w) => { const g = w.guard(); return w.check(g, w.call("commiT"), w.approve(g, w.call())); }),
  S("AP-2", "a-blank-tool-has-no-effect", "NO_EFFECT", (w) => effect(w, { runId: w.run, toolName: "", args: {} })),
  S("AP-3", "a-one-byte-change-to-the-arguments-is-refused", MISMATCH, (w) => {
    const g = w.guard();
    return w.check(g, w.call("commit", { ...ARGS, amount: 1201 }), w.approve(g, w.call()));
  }),
  S("AP-4", "run-and-tool-cannot-trade-characters", MISMATCH, (w) => {
    const approval = w.approve(w.guard(`${w.run}:b`), w.call("c", {}, `${w.run}:b`));
    return w.check(w.guard(w.run), w.call("b:c", {}, w.run), approval);
  }),
  S("AP-5", "negative-zero-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", { n: -0 }))),
  S("AP-5", "not-a-number-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", { n: Number.NaN }))),
  S("AP-5", "an-integer-past-the-safe-range-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", { n: 2 ** 53 }))),
  S("AP-5", "a-getter-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", withGetter()))),
  S("AP-5", "a-symbol-key-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", { [Symbol("s")]: 1 }))),
  S("AP-5", "a-non-enumerable-property-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", hidden()))),
  S("AP-5", "a-labelled-array-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", Object.assign([1], { extra: 2 })))),
  S("AP-5", "a-class-instance-is-refused", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", new (class Thing {})()))),
  S("AP-6", "the-same-arguments-in-another-order-clear", null, (w) => {
    const g = w.guard();
    return w.check(g, w.call("commit", { b: 2, a: 1 }), w.approve(g, w.call("commit", { a: 1, b: 2 })));
  }),
  S("AP-7", "the-implementer-cannot-approve", "NOT_THE_OWNER", (w) => w.issue({ decidedBy: "implementer" }, w.call(), w.guard())),
  S("AP-7", "the-owner-can-approve", null, (w) => w.issue({}, w.call(), w.guard())),
  S("AP-8", "a-copy-of-an-approval-is-refused", "APPROVAL_FORGED", (w) => { const g = w.guard(); return w.check(g, w.call(), { ...w.approve(g, w.call()) }); }),
  S("AP-9", "an-expired-approval-is-refused", "APPROVAL_EXPIRED", (w) => { const g = w.guard(); return w.check(g, w.call(), w.approve(g, w.call()), EXPIRY); }),
  S("AP-10", "a-second-use-is-refused", "APPROVAL_SPENT", (w) => {
    const g = w.guard();
    const approval = w.approve(g, w.free());
    return w.check(w.settle(w.clear(g, w.free(), approval)), w.free(), approval);
  }),
  S("AP-11", "p6-is-refused-with-the-owners-approval", "P6_PROHIBITED", (w) => {
    const g = w.guard();
    const call = w.call("read-other-tenant", {});
    return w.check(g, call, w.approve(g, call));
  }),
  S("AP-11", "a-registered-p5-clears-with-the-owners-approval", null, (w) => {
    const g = w.tainted();
    const call = w.call("approve", {});
    return w.check(g, call, w.approve(g, call));
  }),
  S("AP-12", "a-steerable-action-on-a-tainted-run-is-refused", FRESH, (w) => w.check(w.tainted(), w.call())),
  S("AP-12", "the-same-action-untainted-clears", null, (w) => w.check(w.guard(), w.call())),
  S("AP-12", "a-fresh-approval-clears-a-tainted-run", null, (w) => { const g = w.tainted(); return w.check(g, w.call(), w.approve(g, w.call())); }),
  S("AP-13", "an-approval-from-before-the-content-is-refused", "APPROVAL_NOT_FRESH", (w) => {
    const before = w.guard();
    const approval = w.approve(before, w.call());
    return w.check(w.core.recordOutsideContent(before, "a web page"), w.call(), approval);
  }),
  S("AP-14", "a-clean-state-kept-from-before-the-content-is-refused", DEAD, (w) => {
    const before = w.guard();
    w.core.recordOutsideContent(before, "a web page");
    return w.check(before, w.call());
  }),
  S("AP-14", "a-retired-state-reads-as-tainted", "TAINTED", (w) => {
    const before = w.guard();
    w.core.recordOutsideContent(before, "a web page");
    return w.core.isRunTainted(before) ? "TAINTED" : null;
  }),
  S("AP-15", "a-new-tools-result-taints", FRESH, (w) => w.check(w.core.recordToolResult(w.guard(), "some_future_tool", w.registry, []), w.call())),
  S("AP-15", "a-named-own-state-result-does-not", null, (w) => w.check(w.settle(w.guard()), w.call())),
  S("AP-16", "a-run-the-owner-did-not-start-begins-tainted", FRESH, (w) => w.check(w.guard(w.run, TOKEN, { ownerStarted: false }), w.call())),
  S("AP-16", "a-later-attempt-begins-tainted", FRESH, (w) => w.check(w.guard(w.run, TOKEN, { attempt: 2 }), w.call())),
  S("AP-17", "a-read-that-leaves-the-machine-can-be-steered", FRESH, (w) => w.check(w.tainted(), w.call("connector-read"))),
  S("AP-17", "a-local-write-can-be-steered", FRESH, (w) => w.check(w.tainted(), w.call("implement"))),
  S("AP-17", "a-bridge-read-can-be-steered", FRESH, (w) => w.check(w.tainted(), w.call("bridge-read"))),
  S("AP-17", "running-validators-can-be-steered", FRESH, (w) => w.check(w.tainted(), w.call("run_validators"))),
  S("AP-17", "a-confined-read-cannot", null, (w) => w.check(w.tainted(), w.free())),
  S("AP-17", "a-confined-read-the-registry-moves-off-the-machine-can", FRESH, (w) => w.check(w.tainted(), w.free(), null, NOW, w.raised)),
  S("AP-18", "a-forged-clean-state-is-refused", DEAD, (w) => w.check({ ...w.guard() }, w.free())),
  S("AP-18", "an-approval-cannot-be-issued-on-a-forged-state", DEAD, (w) => w.issue({}, w.call(), { ...w.guard() })),
  S("AP-19", "another-runs-clean-state-is-refused-at-the-check", "RUN_MISMATCH", (w) => w.check(w.guard(`${w.run}x`), w.call())),
  S("AP-19", "another-runs-state-is-refused-at-the-approval", "RUN_MISMATCH", (w) => w.issue({}, w.call(), w.guard(`${w.run}x`))),
  S("AP-20", "a-claim-with-its-receipt-is-ready", null, (w) => w.claim([w.receipt()])),
  S("AP-20", "a-claim-without-its-receipt-is-refused", "NO_RECEIPT", (w) => w.claim([])),
  S("AP-20", "one-receipt-does-not-cover-two-checks", "NO_RECEIPT", (w) => w.claim([w.receipt()], {}, w.plan([CORE_SUITE, CREDIT]))),
  S("AP-21", "a-copy-of-a-receipt-is-refused", "RECEIPT_FORGED", (w) => w.claim([{ ...w.receipt() }])),
  S("AP-22", "another-phases-receipt-is-refused", "RECEIPT_OTHER_PHASE", (w) => w.claim([w.receipt({ phaseId: "PROJECTOS-OTHER1A" })])),
  S("AP-22", "another-commits-receipt-is-refused", "RECEIPT_STALE", (w) => w.claim([w.receipt({ subject: "b".repeat(40) })])),
  S("AP-23", "reported-done-is-refused", "NOT_VERIFIED", (w) => w.claim([w.receipt({ source: "operator-report" })])),
  S("AP-23", "an-unknown-source-is-not-recorded", "BAD_OBSERVATION", (w) => (w.core.recordCheckReceipt({ ...OBSERVED, source: "trust-me" }).ok ? null : "BAD_OBSERVATION")),
  S("AP-24", "a-failure-outranks-a-pass-on-the-same-commit", "CHECK_FAILED", (w) => w.claim([w.receipt({ exitStatus: 1 }), w.receipt()])),
  S("AP-24", "a-failure-alone-is-refused", "CHECK_FAILED", (w) => w.claim([w.receipt({ exitStatus: 1 })])),
  S("AP-25", "nothing-required-is-refused", "NO_REQUIRED_CHECKS", (w) => w.claim([w.receipt()], {}, w.plan([]))),
  S("AP-26", "an-open-blocker-is-refused", "OPEN_BLOCKER", (w) => w.claim([w.receipt()], { openBlockers: ["the host is down"] })),
  S("AP-36", "a-new-lineage-cannot-replay-an-approval", "APPROVAL_LINEAGE_MISMATCH", (w) => {
    const approval = w.spentOnTaintedRun();
    return w.check(w.guard(w.run, "lineage-2"), w.free(), approval);
  }),
  S("AP-36", "the-same-lineage-cannot-replay-an-approval", "APPROVAL_NOT_FRESH", (w) => {
    const approval = w.spentOnTaintedRun();
    return w.check(w.guard(), w.free(), approval);
  }),
  S("AP-36", "a-reissued-id-stays-spent-on-the-lineage", "APPROVAL_SPENT", (w) => {
    w.spentOnTaintedRun();
    const second = w.guard(w.run, TOKEN, { attempt: 2 });
    return w.check(second, w.free(), w.approve(second, w.free()));
  }),
  S("AP-36", "a-second-guard-does-not-start-clean", FRESH, (w) => { w.guard(); return w.check(w.guard(w.run, "lineage-2"), w.call()); }),
  S("AP-36", "a-run-needs-a-lineage-token", "BAD_RUN_START", (w) => w.thrown(() => w.guard(w.run, " "))),
  S("AP-37", "a-result-on-a-retired-guard-refuses-loudly", "DEAD_GUARD", (w) => {
    const first = w.guard();
    w.core.recordOutsideContent(first, "a web page");
    return w.thrown(() => w.core.recordToolResult(first, "web_fetch", w.registry, []));
  }),
  S("AP-37", "a-late-write-still-counts-on-the-lineage", "COUNTED", (w) => {
    const first = w.guard();
    w.core.recordOutsideContent(first, "a web page");
    w.thrown(() => w.core.recordOutsideContent(first, "a late result"));
    return w.guard().taintGeneration === 3 ? "COUNTED" : null;
  }),
  S("AP-37", "the-next-check-refuses-until-the-result-is-recorded", PENDING, (w) => { const g = w.guard(); return w.check(w.clear(g, w.free()), w.free()); }),
  S("AP-37", "a-recorded-result-lets-the-run-go-on", null, (w) => { const g = w.guard(); return w.check(w.settle(w.clear(g, w.free())), w.free()); }),
  S("AP-37", "no-approval-while-a-result-is-pending", PENDING, (w) => { const g = w.guard(); return w.issue({}, w.call(), w.clear(g, w.free())); }),
  S("AP-37", "another-tools-result-refuses-loudly", "WRONG_RESULT", (w) => {
    const g = w.clear(w.guard(), w.free());
    return w.thrown(() => w.core.recordToolResult(g, "web_fetch", w.registry, []));
  }),
  S("AP-38", "a-narrower-command-is-refused", "RECEIPT_WRONG_COMMAND", (w) => w.claim([w.receipt({ command: "npm test -- one.test.ts" })])),
  S("AP-38", "a-narrower-scope-is-refused", "RECEIPT_WRONG_SCOPE", (w) => w.claim([w.receipt({ scope: "one file" })])),
  S("AP-38", "a-plan-nobody-declared-is-refused", "PLAN_NOT_DECLARED", (w) => w.claim([w.receipt()], {}, { phaseId: PHASE, checks: [CORE_SUITE] })),
  S("AP-38", "another-phases-plan-is-refused", "PLAN_OTHER_PHASE", (w) => w.claim([w.receipt()], {}, w.plan([CORE_SUITE], "PROJECTOS-OTHER1A"))),
  S("AP-39", "an-observer-equal-to-the-implementer-is-refused", "OBSERVER_IS_IMPLEMENTER", (w) => w.claim([w.receipt({ observedBy: CLAIM.implementer })])),
  S("AP-39", "a-claim-naming-no-implementer-is-refused", "NO_IMPLEMENTER", (w) => w.claim([w.receipt()], { implementer: " " })),
  S("AP-40", "the-node-budget-refuses-a-shared-reference-bomb", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", doubling(17))), true),
  S("AP-40", "the-byte-budget-refuses-a-huge-string", BAD_ARGS, (w) => w.check(w.guard(), w.call("commit", { body: "a".repeat(5 * 1024 * 1024) })), true),
  S("AP-41", "a-decision-from-the-future-is-refused", "DECIDED_IN_FUTURE", (w) => w.issue({ decidedAt: LATER }, w.call(), w.guard())),
  S("AP-41", "a-lifetime-past-the-cap-is-refused", "LIFETIME_TOO_LONG", (w) => w.issue({ expiry: TOO_LONG }, w.call(), w.guard())),
  S("AP-42", "a-write-on-the-own-state-list-still-taints", FRESH, (w) => w.check(w.core.recordToolResult(w.guard(), "commit", w.registry, ["commit"]), w.call())),
  S("AP-42", "an-outbound-read-on-the-own-state-list-still-taints", FRESH, (w) => w.check(w.core.recordToolResult(w.guard(), "connector-read", w.registry, ["connector-read"]), w.call())),
];

/**
 * Each removes or weakens exactly one rule in the source. `kills` is the scenario that must change, and
 * `also` any other that the same change really does move: a declared one that does not move is an error.
 */
const M = (name, kills, rel, from, to, also = []) => ({ name, kills, rel, from, to, also });
const EFFECT_ARRAY = "JSON.stringify([runId, toolName, argumentHash])";
const COMPARE_KEYS = "if (approval.effectKey !== effectKey) return { rule: 'APPROVAL_EFFECT_MISMATCH', reason: 'this approval is for a different run, tool or arguments' };";
const LIVE_LINE = "if (!isLiveRunGuard(guard)) return refuse('RUN_STATE_NOT_LIVE', ['this guard was not issued, or a later one replaced it']);";
const ISSUE_LIVE_LINE = "if (!isLiveRunGuard(guard)) return { ok: false, rule: 'RUN_STATE_NOT_LIVE', reasons: ['this guard was not issued, or a later one replaced it'] };";
const FAILED_LINE = "if (inScope.some((receipt) => receipt.confidence === 'failed')) return gap('CHECK_FAILED', `'${checkId}' failed on ${claim.subject}`);";
const KEY_ORDER = "const keys = Reflect.ownKeys(value)\n    .map((key) => plainKey(value, key))\n    .sort();";
const NEEDED = "return isRunTainted(guard) && actionCouldBeSteered(registry, action);";
const CONFINED_LINE = "return !(CONFINED_READS.includes(action) && isLocalRead(registry, action));";
const OWN_STATE_LINE = "return !(ownStateTools.includes(toolName) && isLocalRead(registry, toolName));";
const LOCAL_READ_LINE = "return actionClass === 'P1' && environment === 'local';";

/** Every scenario that needs an approval to reach its answer, so 'nobody-can-approve' moves all of them. */
const APPROVE_DEPENDENTS = [
  "the-exact-call-clears", "a-one-byte-change-to-the-run-is-refused", "a-one-byte-change-to-the-tool-is-refused", "a-one-byte-change-to-the-arguments-is-refused",
  "run-and-tool-cannot-trade-characters", "the-same-arguments-in-another-order-clear", "a-copy-of-an-approval-is-refused", "an-expired-approval-is-refused",
  "a-second-use-is-refused", "p6-is-refused-with-the-owners-approval", "a-registered-p5-clears-with-the-owners-approval", "a-fresh-approval-clears-a-tainted-run",
  "an-approval-from-before-the-content-is-refused", "a-new-lineage-cannot-replay-an-approval", "the-same-lineage-cannot-replay-an-approval", "a-reissued-id-stays-spent-on-the-lineage",
  "a-decision-from-the-future-is-refused", "a-lifetime-past-the-cap-is-refused",
];

const BEHAVIOUR_MUTATIONS = [
  M("the-key-omits-the-run", "a-one-byte-change-to-the-run-is-refused", EFFECT_REL, EFFECT_ARRAY, "JSON.stringify([toolName, argumentHash])"),
  M("a-blank-run-is-accepted", "a-blank-run-has-no-effect", EFFECT_REL, "...(nonBlank(runId) ? [] : ['the call names no run']),", ""),
  M("the-key-omits-the-tool", "a-one-byte-change-to-the-tool-is-refused", EFFECT_REL, EFFECT_ARRAY, "JSON.stringify([runId, argumentHash])"),
  M("a-blank-tool-is-accepted", "a-blank-tool-has-no-effect", EFFECT_REL, "...(nonBlank(toolName) ? [] : ['the call names no tool']),", ""),
  M("the-key-omits-the-arguments", "a-one-byte-change-to-the-arguments-is-refused", EFFECT_REL, EFFECT_ARRAY, "JSON.stringify([runId, toolName])"),
  M("the-check-stops-comparing-keys", "a-one-byte-change-to-the-arguments-is-refused", APPROVAL_REL, COMPARE_KEYS, "", ["a-one-byte-change-to-the-run-is-refused", "a-one-byte-change-to-the-tool-is-refused", "run-and-tool-cannot-trade-characters"]),
  M("the-key-is-joined-with-a-colon", "run-and-tool-cannot-trade-characters", EFFECT_REL, EFFECT_ARRAY, "`${runId}:${toolName}:${argumentHash}`"),
  M("negative-zero-reads-as-zero", "negative-zero-is-refused", EFFECT_REL, "if (Object.is(value, -0)) refuse('negative zero has no JSON form of its own, so it would read as zero');", ""),
  M("not-a-number-reads-as-null", "not-a-number-is-refused", EFFECT_REL, "if (!Number.isFinite(value)) refuse(`${value} is not a JSON value`);", ""),
  M("unsafe-integers-are-hashed", "an-integer-past-the-safe-range-is-refused", EFFECT_REL, "if (Number.isInteger(value) && !Number.isSafeInteger(value)) refuse(`${value} is past the safe integer range, so its digits are not exact`);", ""),
  M("a-getter-is-called", "a-getter-is-refused", EFFECT_REL, "if (descriptor === undefined || !('value' in descriptor)) refuse(`'${key}' is not plain data, so it could answer differently when the tool runs`);\n  return descriptor.value;", "return Reflect.get(holder, key);"),
  M("symbol-keys-are-dropped", "a-symbol-key-is-refused", EFFECT_REL, KEY_ORDER, "const keys = Object.getOwnPropertyNames(value)\n    .map((key) => plainKey(value, key))\n    .sort();"),
  M("hidden-properties-are-dropped", "a-non-enumerable-property-is-refused", EFFECT_REL, KEY_ORDER, "const keys = Reflect.ownKeys(value).filter((key) => Object.getOwnPropertyDescriptor(value, key).enumerable)\n    .map((key) => plainKey(value, key))\n    .sort();"),
  M("array-labels-are-dropped", "a-labelled-array-is-refused", EFFECT_REL, "if (Reflect.ownKeys(items).length !== items.length + 1) refuse('an array with holes or labels has no one reading as JSON');", ""),
  M("class-instances-are-hashed", "a-class-instance-is-refused", EFFECT_REL, "if (prototype !== Object.prototype && prototype !== null) refuse('only plain objects are JSON values');", ""),
  M("keys-are-not-sorted", "the-same-arguments-in-another-order-clear", EFFECT_REL, ".map((key) => plainKey(value, key))\n    .sort();", ".map((key) => plainKey(value, key));"),
  M("anyone-can-approve", "the-implementer-cannot-approve", APPROVAL_REL, "if (decidedBy !== 'owner') return { ok: false, rule: 'NOT_THE_OWNER', reasons: [`only the owner approves, not the ${String(decidedBy)}`] };", ""),
  M("nobody-can-approve", "the-owner-can-approve", APPROVAL_REL, "if (decidedBy !== 'owner') return", "if (decidedBy !== 'nobody') return", APPROVE_DEPENDENTS),
  M("a-copy-counts-as-an-approval", "a-copy-of-an-approval-is-refused", APPROVAL_REL, "if (!LIVE_APPROVALS.has(approval)) return { rule: 'APPROVAL_FORGED', reason: 'this approval was not issued by the kernel' };", ""),
  M("approvals-never-expire", "an-expired-approval-is-refused", APPROVAL_REL, "if (at === null || at >= (instantOf(approval.expiry) as number)) return { rule: 'APPROVAL_EXPIRED', reason: `this approval lapsed at ${approval.expiry}` };", ""),
  M("an-approval-can-be-reused", "a-second-use-is-refused", APPROVAL_REL, "if (guard.spentApprovals.includes(approval.approvalId)) return { rule: 'APPROVAL_SPENT', reason: 'this approval has already been used' };", "", ["a-reissued-id-stays-spent-on-the-lineage"]),
  M("spending-records-nothing", "a-second-use-is-refused", TAINT_REL, "spentApprovals: approvalId === null ? guard.spentApprovals : [...guard.spentApprovals, approvalId],", "spentApprovals: guard.spentApprovals,", ["a-reissued-id-stays-spent-on-the-lineage"]),
  M("p6-can-be-approved", "p6-is-refused-with-the-owners-approval", APPROVAL_REL, "if (resolveAction(registry, toolName).actionClass === 'P6') return refuse('P6_PROHIBITED', [`'${toolName}' is P6: nobody may authorise it, ever`]);", ""),
  M("taint-gates-nothing", "a-steerable-action-on-a-tainted-run-is-refused", TAINT_REL, NEEDED, "return false;", [
    "a-new-tools-result-taints", "a-run-the-owner-did-not-start-begins-tainted", "a-later-attempt-begins-tainted", "a-read-that-leaves-the-machine-can-be-steered", "a-local-write-can-be-steered",
    "a-bridge-read-can-be-steered", "running-validators-can-be-steered", "a-confined-read-the-registry-moves-off-the-machine-can", "a-second-guard-does-not-start-clean",
    "a-write-on-the-own-state-list-still-taints", "an-outbound-read-on-the-own-state-list-still-taints",
  ]),
  M("every-run-needs-an-approval", "the-same-action-untainted-clears", TAINT_REL, NEEDED, "return actionCouldBeSteered(registry, action);", ["a-named-own-state-result-does-not"]),
  M("no-approval-clears-a-tainted-run", "a-fresh-approval-clears-a-tainted-run", APPROVAL_REL, "if (approval === null) {\n    return freshApprovalNeeded(guard, registry, toolName)", "if (approval === null || guard.taintGeneration > 0) {\n    return freshApprovalNeeded(guard, registry, toolName)", [
    "a-registered-p5-clears-with-the-owners-approval", "an-approval-from-before-the-content-is-refused", "a-new-lineage-cannot-replay-an-approval",
    "the-same-lineage-cannot-replay-an-approval", "a-reissued-id-stays-spent-on-the-lineage",
  ]),
  M("an-old-approval-stays-fresh", "an-approval-from-before-the-content-is-refused", APPROVAL_REL, "if (approval.taintGeneration !== guard.taintGeneration) return { rule: 'APPROVAL_NOT_FRESH', reason: 'outside content entered this run after the approval was given' };", "", ["the-same-lineage-cannot-replay-an-approval"]),
  M("any-guard-of-the-run-is-live", "a-clean-state-kept-from-before-the-content-is-refused", TAINT_REL, "return CURRENT_GUARDS.get(guard.runId) === guard;", "return CURRENT_GUARDS.has(guard.runId);", [
    "a-retired-state-reads-as-tainted", "a-forged-clean-state-is-refused", "an-approval-cannot-be-issued-on-a-forged-state", "a-result-on-a-retired-guard-refuses-loudly", "a-late-write-still-counts-on-the-lineage",
  ]),
  M("a-retired-guard-reads-as-clean", "a-retired-state-reads-as-tainted", TAINT_REL, "return !isLiveRunGuard(guard) || guard.taintGeneration > 0;", "return guard.taintGeneration > 0;"),
  M("no-tool-result-taints", "a-new-tools-result-taints", TAINT_REL, OWN_STATE_LINE, "return false;", ["a-write-on-the-own-state-list-still-taints", "an-outbound-read-on-the-own-state-list-still-taints"]),
  M("every-tool-result-taints", "a-named-own-state-result-does-not", TAINT_REL, OWN_STATE_LINE, "return true;", ["a-second-use-is-refused"]),
  M("a-run-from-anywhere-starts-clean", "a-run-the-owner-did-not-start-begins-tainted", TAINT_REL, "...(ownerStarted === true ? [] : ['a run the owner did not start']),", ""),
  M("a-later-attempt-starts-clean", "a-later-attempt-begins-tainted", TAINT_REL, "...(attempt === 1 ? [] : ['a later attempt, which can restore outside content']),", ""),
  M("every-local-read-is-free", "a-bridge-read-can-be-steered", TAINT_REL, CONFINED_LINE, "return !isLocalRead(registry, action);", ["running-validators-can-be-steered"]),
  M("a-confined-name-is-enough", "a-confined-read-the-registry-moves-off-the-machine-can", TAINT_REL, CONFINED_LINE, "return !CONFINED_READS.includes(action);"),
  M("nothing-is-out-of-reach", "a-confined-read-cannot", TAINT_REL, CONFINED_LINE, "return true;"),
  M("the-check-reads-a-forged-guard", "a-forged-clean-state-is-refused", APPROVAL_REL, LIVE_LINE, "", ["a-clean-state-kept-from-before-the-content-is-refused"]),
  M("an-approval-reads-a-forged-guard", "an-approval-cannot-be-issued-on-a-forged-state", APPROVAL_REL, ISSUE_LIVE_LINE, ""),
  M("the-check-reads-another-runs-guard", "another-runs-clean-state-is-refused-at-the-check", APPROVAL_REL, "if (guard.runId !== call.runId) return refuse('RUN_MISMATCH', [`this guard is for ${guard.runId}, not ${call.runId}`]);", ""),
  M("an-approval-reads-another-runs-guard", "another-runs-state-is-refused-at-the-approval", APPROVAL_REL, "if (guard.runId !== call.runId) return { ok: false, rule: 'RUN_MISMATCH', reasons: [`this guard is for ${guard.runId}, not ${call.runId}`] };", ""),
  M("a-claim-needs-no-receipt", "a-claim-without-its-receipt-is-refused", RECEIPT_REL, "if (named.length === 0) return gap('NO_RECEIPT', `there is no receipt for '${checkId}'`);", "if (named.length === 0) return null;", ["one-receipt-does-not-cover-two-checks"]),
  M("every-claim-is-refused", "a-claim-with-its-receipt-is-ready", RECEIPT_REL, "return gaps.length === 0 ? { ready: true } : { ready: false, gaps };", "return { ready: false, gaps: [...gaps, { rule: 'NO_RECEIPT', checkId: null, reason: 'never' }] };"),
  M("a-copy-counts-as-a-receipt", "a-copy-of-a-receipt-is-refused", RECEIPT_REL, "const genuine = named.filter((receipt) => LIVE_RECEIPTS.has(receipt));", "const genuine = named;"),
  M("any-phases-receipt-counts", "another-phases-receipt-is-refused", RECEIPT_REL, "const inPhase = genuine.filter((receipt) => receipt.phaseId === claim.phaseId);", "const inPhase = genuine;"),
  M("any-commits-receipt-counts", "another-commits-receipt-is-refused", RECEIPT_REL, "const current = inPhase.filter((receipt) => receipt.subject === claim.subject);", "const current = inPhase;"),
  M("reported-done-closes-a-claim", "reported-done-is-refused", RECEIPT_REL, "if (!independent.some((receipt) => receipt.confidence === 'verified')) return gap('NOT_VERIFIED', `'${checkId}' is reported done, and nobody saw it pass`);", ""),
  M("a-report-is-recorded-as-verified", "reported-done-is-refused", RECEIPT_REL, "return source === 'operator-report' ? 'reported done' : 'verified';", "return 'verified';"),
  M("any-source-is-recorded", "an-unknown-source-is-not-recorded", RECEIPT_REL, "...((CHECK_SOURCES as readonly unknown[]).includes(source) ? [] : ['the source is unknown']),", ""),
  M("a-pass-clears-a-failure", "a-failure-outranks-a-pass-on-the-same-commit", RECEIPT_REL, FAILED_LINE, "", ["a-failure-alone-is-refused"]),
  M("a-failure-is-recorded-as-verified", "a-failure-alone-is-refused", RECEIPT_REL, "if (exitStatus !== 0) return 'failed';", "", ["a-failure-outranks-a-pass-on-the-same-commit"]),
  M("nothing-required-is-ready", "nothing-required-is-refused", RECEIPT_REL, "...(plan.checks.length === 0 ? [{ rule: 'NO_REQUIRED_CHECKS' as const, checkId: null, reason: 'nothing is required, so nothing would be proved' }] : []),", ""),
  M("blockers-are-ignored", "an-open-blocker-is-refused", RECEIPT_REL, "...claim.openBlockers.map((blocker) => ({ rule: 'OPEN_BLOCKER' as const, checkId: null, reason: blocker })),", ""),
  M("the-lineage-is-not-compared", "a-new-lineage-cannot-replay-an-approval", APPROVAL_REL, "if (approval.lineageToken !== guard.lineageToken) return { rule: 'APPROVAL_LINEAGE_MISMATCH', reason: 'this approval was given in another lineage of this run' };", ""),
  M("a-new-guard-forgets-the-lineage", "the-same-lineage-cannot-replay-an-approval", TAINT_REL, "const continued = earlier?.lineageToken === lineageToken ? earlier : undefined;", "const continued = undefined;", ["a-late-write-still-counts-on-the-lineage", "a-reissued-id-stays-spent-on-the-lineage"]),
  M("spent-state-stays-on-the-old-guard", "a-reissued-id-stays-spent-on-the-lineage", TAINT_REL, "spentApprovals: continued?.spentApprovals ?? [],", "spentApprovals: [],"),
  M("a-second-guard-starts-clean", "a-second-guard-does-not-start-clean", TAINT_REL, "...(earlier === undefined ? [] : ['a second guard for a run already started']),", "", ["the-same-lineage-cannot-replay-an-approval", "a-late-write-still-counts-on-the-lineage"]),
  M("a-run-needs-no-token", "a-run-needs-a-lineage-token", TAINT_REL, "if (!nonBlank(runId) || !nonBlank(lineageToken)) throw new RunGuardRefused('BAD_RUN_START', 'a run needs an id and a lineage token');", ""),
  M("a-dead-write-goes-quietly", "a-result-on-a-retired-guard-refuses-loudly", TAINT_REL, "throw new RunGuardRefused('DEAD_GUARD', `this guard for ${guard.runId} is not live, so this run has to start a new one`);", "", ["a-late-write-still-counts-on-the-lineage"]),
  M("a-dead-write-drops-its-taint", "a-late-write-still-counts-on-the-lineage", TAINT_REL, "if (current !== undefined) issued(withTaint(current, source));", ""),
  M("the-check-ignores-a-pending-result", "the-next-check-refuses-until-the-result-is-recorded", APPROVAL_REL, "if (guard.pendingResult !== null) return refuse('RESULT_PENDING', [`the result of '${guard.pendingResult}' has not been recorded`]);", ""),
  M("a-cleared-call-leaves-nothing-pending", "the-next-check-refuses-until-the-result-is-recorded", TAINT_REL, "pendingResult: toolName,", "pendingResult: null,", ["no-approval-while-a-result-is-pending", "another-tools-result-refuses-loudly"]),
  M("a-result-settles-nothing", "a-recorded-result-lets-the-run-go-on", TAINT_REL, "const settled: RunGuard = { ...guard, pendingResult: null };", "const settled: RunGuard = { ...guard };", ["a-second-use-is-refused"]),
  M("an-approval-ignores-a-pending-result", "no-approval-while-a-result-is-pending", APPROVAL_REL, "if (guard.pendingResult !== null) return { ok: false, rule: 'RESULT_PENDING', reasons: [`the result of '${guard.pendingResult}' has not been recorded, so the owner has not seen what the run has`] };", ""),
  M("any-tools-result-settles-it", "another-tools-result-refuses-loudly", TAINT_REL, "if (guard.pendingResult !== null && guard.pendingResult !== toolName) {\n    issued(withTaint(guard, source));\n    throw new RunGuardRefused('WRONG_RESULT', `this run is waiting for the result of '${guard.pendingResult}'`);\n  }\n", ""),
  M("any-command-counts", "a-narrower-command-is-refused", RECEIPT_REL, "const asCommanded = current.filter((receipt) => receipt.command === command);", "const asCommanded = current;"),
  M("any-scope-counts", "a-narrower-scope-is-refused", RECEIPT_REL, "const inScope = asCommanded.filter((receipt) => receipt.scope === scope);", "const inScope = asCommanded;"),
  M("any-list-is-a-plan", "a-plan-nobody-declared-is-refused", RECEIPT_REL, "if (!LIVE_PLANS.has(plan)) return { ready: false, gaps: [{ rule: 'PLAN_NOT_DECLARED', checkId: null, reason: 'these requirements did not come from a declared plan' }] };", ""),
  M("any-phases-plan-counts", "another-phases-plan-is-refused", RECEIPT_REL, "...(plan.phaseId === claim.phaseId ? [] : [{ rule: 'PLAN_OTHER_PHASE' as const, checkId: null, reason: `this plan is for ${plan.phaseId}` }]),", ""),
  M("the-implementer-can-observe", "an-observer-equal-to-the-implementer-is-refused", RECEIPT_REL, "const independent = inScope.filter((receipt) => receipt.observedBy !== claim.implementer);", "const independent = inScope;"),
  M("a-claim-need-not-name-anyone", "a-claim-naming-no-implementer-is-refused", RECEIPT_REL, "...(nonBlank(claim.implementer) ? [] : [{ rule: 'NO_IMPLEMENTER' as const, checkId: null, reason: 'a claim must name who did the work' }]),", ""),
  M("no-node-budget", "the-node-budget-refuses-a-shared-reference-bomb", EFFECT_REL, "if (budget.nodes > MAX_ARGUMENT_NODES) refuse(`the arguments are over the budget of ${MAX_ARGUMENT_NODES} values`);", ""),
  M("no-byte-budget", "the-byte-budget-refuses-a-huge-string", EFFECT_REL, "if (budget.bytes > MAX_ARGUMENT_BYTES) refuse(`the arguments are over the budget of ${MAX_ARGUMENT_BYTES} bytes`);", ""),
  M("a-decision-can-date-itself-ahead", "a-decision-from-the-future-is-refused", APPROVAL_REL, "if (from > at) return { rule: 'DECIDED_IN_FUTURE', reason: `this decision is dated ${decision.decidedAt}, after ${now}` };", ""),
  M("an-approval-can-last-forever", "a-lifetime-past-the-cap-is-refused", APPROVAL_REL, "if (until - from > MAX_APPROVAL_LIFETIME_MS) return { rule: 'LIFETIME_TOO_LONG', reason: `an approval lasts at most ${MAX_APPROVAL_LIFETIME_MS} ms` };", ""),
  M("the-own-state-list-is-believed", "a-write-on-the-own-state-list-still-taints", TAINT_REL, OWN_STATE_LINE, "return !ownStateTools.includes(toolName);", ["an-outbound-read-on-the-own-state-list-still-taints"]),
  M("a-write-counts-as-a-local-read", "a-write-on-the-own-state-list-still-taints", TAINT_REL, LOCAL_READ_LINE, "return environment === 'local';"),
  M("an-outbound-read-counts-as-local", "an-outbound-read-on-the-own-state-list-still-taints", TAINT_REL, LOCAL_READ_LINE, "return actionClass === 'P1';", ["a-confined-read-the-registry-moves-off-the-machine-can"]),
];

/** Run every scenario against one compiled core. A scenario that throws has an outcome too: it threw. */
function outcomes(sources, registryJson, includeHeavy = true) {
  const world = worldOf(loadCore(sources), registryJson);
  return new Map(
    SCENARIOS.map(({ name, run, heavy, want }) => {
      if (heavy && !includeHeavy) return [name, want];
      world.next();
      try {
        return [name, run(world)];
      } catch (error) {
        return [name, `threw: ${error.message}`];
      }
    }),
  );
}

function behaviourProblems(sources, registryJson) {
  const seen = outcomes(sources, registryJson);
  return SCENARIOS.filter(({ name, want }) => seen.get(name) !== want).map(
    ({ rule, name, want }) => [rule, `${rule} ${RULE_NAMES[rule]}: '${name}' answered ${seen.get(name) ?? "passed"}, not ${want ?? "passed"}`],
  );
}

/** Killed only when the named scenario moved the right way, and nothing undeclared moved at all. */
function behaviourKill(m, sources, registryJson) {
  if ((sources[m.rel] ?? "").split(m.from).length !== 2) return `AP-M: mutation '${m.name}' no longer applies exactly once to ${m.rel}; update it with the rule`;
  let seen;
  try {
    // The budget scenarios walk only the serializer, so only a mutation of that file can move them.
    seen = outcomes({ ...sources, [m.rel]: sources[m.rel].replace(m.from, () => m.to) }, registryJson, m.rel === EFFECT_REL);
  } catch (error) {
    return `AP-M: mutation '${m.name}' broke the module rather than the rule: ${error.message}`;
  }
  const target = SCENARIOS.find(({ name }) => name === m.kills);
  if (target === undefined) return `AP-M: mutation '${m.name}' names no scenario '${m.kills}'`;
  const after = seen.get(m.kills);
  const moved = target.want === null ? after !== null : after === null;
  if (!moved) {
    return `AP-M: mutation '${m.name}' did not free '${m.kills}': it answered ${after ?? "cleared"}. A rule is proved only if removing it lets the call through`;
  }
  const declared = new Set([m.kills, ...m.also]);
  const movedNames = SCENARIOS.filter(({ name, want }) => seen.get(name) !== want).map(({ name }) => name);
  const strays = movedNames.filter((name) => !declared.has(name));
  const idle = m.also.filter((name) => !movedNames.includes(name));
  if (strays.length > 0) return `AP-M: mutation '${m.name}' also moved ${strays.join(", ")}`;
  return idle.length > 0 ? `AP-M: mutation '${m.name}' declares ${idle.join(", ")}, and they did not move` : null;
}

// ---------------------------------------------------------------------------------------------------------
// The text: what the tree says, as opposed to what the code does
// ---------------------------------------------------------------------------------------------------------

/** Every product source that could call these rules. A later phase that wires them in moves AP-29 with it. */
function productSources() {
  const found = [];
  const visit = (rel) => {
    for (const entry of fs.readdirSync(path.join(ROOT, ...rel.split("/")), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory() && !["node_modules", "dist", "target", ".next"].includes(entry.name)) visit(child);
      else if (entry.isFile() && /\.(?:ts|tsx|cjs|mjs|js)$/.test(entry.name)) found.push({ rel: child, text: read(child) });
    }
  };
  for (const entry of fs.readdirSync(path.join(ROOT, "projectos"), { withFileTypes: true })) {
    const src = `projectos/${entry.name}/src`;
    if (entry.isDirectory() && fs.existsSync(path.join(ROOT, ...src.split("/")))) visit(src);
  }
  return found.filter(({ rel }) => !rel.startsWith(`${DIR}/`) && rel !== CORE_BARREL_REL);
}

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  const end = text.indexOf("\n];", start);
  return start < 0 || end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function textProblems(raw, wired) {
  const errors = [];
  const E = (rule, message) => errors.push([rule, `${rule} ${RULE_NAMES[rule]}: ${message}`]);
  const directory = Object.keys(raw).filter((rel) => rel.startsWith(`${DIR}/`));
  const files = directory.filter((rel) => raw[rel] !== null);

  // AP-27: nothing here can pass a call for a person. The fields and parameters are pinned too, so a
  // harmless-looking `mode?: string` is as deliberate as a change to the rule itself.
  for (const rel of files) {
    const found = REFUSED_MODES.exec(code(raw[rel]));
    if (found !== null) E("AP-27", `${rel} has '${found[0]}'`);
  }
  const decision = /export interface ToolApprovalDecision \{([\s\S]*?)\n\}/.exec(code(raw[APPROVAL_REL]));
  const fields = decision === null ? [] : [...decision[1].matchAll(/^\s*readonly (\w+)/gm)].map((m) => m[1]);
  if (JSON.stringify(fields) !== JSON.stringify(DECISION_FIELDS)) E("AP-27", `a decision says ${fields.join(", ")}, not only ${DECISION_FIELDS.join(", ")}`);
  if (!code(raw[APPROVAL_REL]).includes(`export function checkToolCall(${CHECK_PARAMETERS}): ToolCheckResult {`)) E("AP-27", "checkToolCall takes something other than the call, its approval and the time");

  // AP-28: pure, and it can only name what it is allowed to name.
  for (const [rel, allowed] of Object.entries(PURITY)) {
    const text = code(raw[rel]);
    const foreign = SPECIFIERS.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[1])).filter((name) => !allowed.includes(name));
    if (foreign.length > 0) E("AP-28", `${rel} imports ${foreign.join(", ")}`);
    if (IMPURE.test(text)) E("AP-28", `${rel} reaches outside itself: ${IMPURE.exec(text)[0]}`);
  }

  // AP-29: wired to nothing. The core barrel names the directory once, and no product file names a rule.
  const barrelUses = code(raw[CORE_BARREL_REL]).split("\n").filter((line) => line.includes("approvals/"));
  if (JSON.stringify(barrelUses) !== JSON.stringify([BARREL_LINE])) E("AP-29", `${CORE_BARREL_REL} should name the directory once, as ${BARREL_LINE}`);
  for (const { rel, text } of wired) {
    const found = WIRED_NAMES.exec(code(text));
    if (found !== null) E("AP-29", `${rel} reaches ${found[0]}, and this phase wires in nothing`);
  }

  // AP-30: the credit header and the notices may name a source. Code, tests and identifiers may not.
  for (const rel of [...files, ...Object.keys(TESTS)]) {
    const uncredited = raw[rel].split("\n").filter((line) => !CREDIT_LINE.test(line)).join("\n");
    const found = UPSTREAM_NAME.exec(uncredited);
    if (found !== null) E("AP-30", `${rel} uses the upstream name '${found[0]}' outside its credit`);
  }

  // AP-31: the list of what is here, each file judged by the credit rules themselves, and nothing from a
  // source whose licence was never approved.
  for (const rel of directory.filter((name) => !ALL_FILES.includes(name))) E("AP-31", `${rel} is not on this phase's list`);
  for (const rel of ALL_FILES.filter((name) => raw[name] === null)) E("AP-31", `${rel} is missing`);
  if (errors.some(([rule, message]) => rule === "AP-31" && message.endsWith("is missing"))) return errors;
  const records = credit.parseNotices(raw[NOTICES_REL]);
  for (const rel of ALL_FILES) {
    for (const refusal of credit.judgeFile(rel, raw[rel], records)) E("AP-31", refusal.message);
  }
  for (const rel of ORIGINAL) {
    if (!raw[rel].startsWith("// Origin: original ProjectOS code\n")) E("AP-31", `${rel} is not marked original`);
  }
  for (const [rel, { id, paths }] of Object.entries(PORTED)) {
    const header = /^\/\/ Source-Path: (.*)$/m.exec(raw[rel]);
    if (header === null || header[1] !== paths.join("; ")) E("AP-31", `${rel} no longer credits exactly ${paths.join("; ")}`);
    for (const sourcePath of paths) {
      if (!records.some((r) => r.kind === "ENTRY" && r.id === rel && r.fields["Source"] === id && r.fields["Source-Path"] === sourcePath)) {
        E("AP-31", `${NOTICES_REL} has no entry for ${rel} from ${sourcePath}`);
      }
    }
  }
  for (const rel of ALL_FILES) {
    if (UNAPPROVED_SOURCE.test(raw[rel])) E("AP-31", `${rel} names a file that carries a source with no approved licence`);
    const found = UNAPPROVED_VOCABULARY.exec(code(raw[rel]));
    if (found !== null) E("AP-31", `${rel} carries '${found[0]}', from a vocabulary whose source is not approved`);
  }

  // AP-32: exported, so the next phase uses these rather than writing its own.
  const barrel = code(raw[BARREL_REL]);
  for (const name of PUBLIC_NAMES) if (!new RegExp(String.raw`\b${name}\b`).test(barrel)) E("AP-32", `${BARREL_REL} does not export ${name}`);
  for (const name of MINTERS) if (new RegExp(String.raw`\b${name}\b`).test(barrel)) E("AP-32", `${BARREL_REL} exports ${name}, and nothing outside the kernel mints`);
  if (/export \*/.test(barrel)) E("AP-32", `${BARREL_REL} exports everything from a module, so a new minter would be public by default`);

  // AP-33: registered in both runners.
  for (const [rel, name] of [[VA_REL, "validate-all"], [CR_REL, "cached-runner"]]) {
    const modules = modulesOf(code(raw[rel]));
    if (modules === null || !modules.includes(THIS_VALIDATOR)) E("AP-33", `${THIS_VALIDATOR} is not registered in ${name}`);
  }

  // AP-34: every proof exists, and every proof runs.
  for (const [rel, needles] of Object.entries(TESTS)) {
    const text = code(raw[rel]);
    for (const needle of needles) if (!text.includes(needle)) E("AP-34", `${rel} no longer proves "${needle}"`);
    if (NOT_RUN.test(text)) E("AP-34", `${rel} skips or isolates a test: ${NOT_RUN.exec(text)[0]}`);
  }

  // AP-35: the limits are stated where a reader will find them.
  for (const [rel, pins] of Object.entries(SOURCE_PINS)) {
    for (const pin of pins) if (!raw[rel].includes(pin)) E("AP-35", `${rel} no longer says "${pin}"`);
  }
  if (raw[FINISH_REL] === null) {
    E("AP-35", `${FINISH_REL} is missing`);
  } else {
    const finish = prose(raw[FINISH_REL]);
    for (const [what, pin] of Object.entries(FINISH_PINS)) if (!finish.includes(pin)) E("AP-35", `${FINISH_REL} no longer records ${what}`);
  }
  return errors;
}

const R = (name, rule, rel, from, to) => ({ name, rule, rel, from, to });
const SHIPPED_DECISION = "export interface ToolApprovalDecision {\n  readonly approvalId: string;";
const WIRED_FILE = { rel: "projectos/agent/src/loop/wired.ts", text: "import { checkToolCall } from '@projectos/core';\n" };
const RAW_WIRED_FILE = { rel: "projectos/core/src/workers.ts", text: "export * from './approvals/taint.js';\n" };
const TAINT_PATHS = PORTED[TAINT_REL].paths.join("; ");
const TAINT_ENTRY = `ENTRY: ${TAINT_REL}\nSource: rakazo\nUpstream: https://github.com/elie222/rakazo\nSource-Path: ${PORTED[TAINT_REL].paths[1]}\n`;

const TEXT_MUTATIONS = [
  // AP-27
  R("a-judge-result-appears", "AP-27", APPROVAL_REL, "export type ApprovalIssueRule =", "export type JudgeVerdict = 'pass' | 'ask';\nexport type ApprovalIssueRule ="),
  R("a-yolo-flag-appears", "AP-27", TAINT_REL, "export interface RunStart {", "const yolo = false;\nexport interface RunStart {"),
  R("skip-approvals-appears", "AP-27", TAINT_REL, "export interface RunStart {", "export interface RunStart {\n  readonly skipApprovals?: boolean;"),
  R("an-approval-mode-appears", "AP-27", APPROVAL_REL, "export type ApprovalIssueRule =", "export type ApprovalMode = 'ask';\nexport type ApprovalIssueRule ="),
  R("an-always-allow-rule-appears", "AP-27", APPROVAL_REL, "export type ApprovalIssueRule =", "const ALWAYS_ALLOW = 'always_allow';\nexport type ApprovalIssueRule ="),
  R("auto-review-appears", "AP-27", RECEIPT_REL, "export type DoneRule =", "export type AutoReview = boolean;\nexport type DoneRule ="),
  R("a-decision-gains-a-field", "AP-27", APPROVAL_REL, SHIPPED_DECISION, `${SHIPPED_DECISION}\n  readonly scope: string;`),
  R("the-check-gains-a-parameter", "AP-27", APPROVAL_REL, CHECK_PARAMETERS, `${CHECK_PARAMETERS}, relaxed: boolean`),
  // AP-28
  R("core-reads-the-clock", "AP-28", APPROVAL_REL, "const at = instantOf(now);\n  if (at === null || at >=", "const at = Date.now();\n  if (at === null || at >="),
  R("core-reads-the-environment", "AP-28", TAINT_REL, "export function startRunGuard(start: RunStart): RunGuard {", "export function startRunGuard(start: RunStart): RunGuard {\n  if (process.env.X) throw new Error('x');"),
  R("core-imports-the-filesystem", "AP-28", RECEIPT_REL, "import { instantOf } from './instant.js';", "import { instantOf } from './instant.js';\nimport { readFileSync } from 'node:fs';"),
  R("core-imports-the-agent", "AP-28", APPROVAL_REL, "import type { Role } from '../types.js';", "import type { Role } from '../types.js';\nimport { run } from '../../../agent/src/loop.js';"),
  // AP-29: the two wiring mutations add a file to the scan.
  { name: "the-run-loop-calls-the-check", rule: "AP-29", wire: WIRED_FILE },
  { name: "a-core-file-reaches-into-the-directory", rule: "AP-29", wire: RAW_WIRED_FILE },
  R("the-core-barrel-names-a-file-directly", "AP-29", CORE_BARREL_REL, BARREL_LINE, `${BARREL_LINE}\nexport * from './approvals/taint.js';`),
  // AP-30
  R("the-upstream-name-reaches-an-identifier", "AP-30", APPROVAL_REL, "const LIVE_APPROVALS =", "const RAKAZO_APPROVALS =", ),
  R("the-upstream-name-reaches-a-doc-comment", "AP-30", TAINT_REL, " * Taint: has outside content entered this run?", " * Rakazo taint: has outside content entered this run?"),
  R("the-second-upstream-name-reaches-text", "AP-30", RECEIPT_REL, " * Evidence before done.", " * oh-my-hermes evidence before done."),
  R("the-upstream-name-reaches-a-test", "AP-30", TAINT_TEST_REL, "describe('what taints a run'", "describe('rakazo taint'"),
  // AP-31
  { ...R("the-apache-change-statement-is-removed", "AP-31", EFFECT_REL, " CHANGED:", " Changed"), all: true },
  R("the-credit-header-is-removed", "AP-31", EFFECT_REL, "// Ported-From: rakazo https://github.com/elie222/rakazo\n", ""),
  R("a-ported-file-is-marked-original", "AP-31", TAINT_REL, "// SPDX-License-Identifier: Apache-2.0\n", "// Origin: original ProjectOS code\n"),
  R("an-original-file-loses-its-mark", "AP-31", APPROVAL_REL, "// Origin: original ProjectOS code\n", ""),
  R("a-source-path-is-dropped", "AP-31", TAINT_REL, `// Source-Path: ${TAINT_PATHS}`, `// Source-Path: ${PORTED[TAINT_REL].paths[0]}`),
  R("a-notices-entry-is-dropped", "AP-31", NOTICES_REL, TAINT_ENTRY, `ENTRY: ${TAINT_REL}\nSource: rakazo\nUpstream: https://github.com/elie222/rakazo\nSource-Path: packages/other.ts\n`),
  R("the-unapproved-file-becomes-a-source", "AP-31", RECEIPT_REL, "// Source-Path: src/evidence/labels.py;", "// Source-Path: src/quality/completion_integrity.py;"),
  R("the-unapproved-vocabulary-is-carried-in", "AP-31", RECEIPT_REL, "export type DoneRule =", "const EVIDENCE_WORDS = ['tbd', 'n/a'];\nexport type DoneRule ="),
  { name: "an-unlisted-file-lands-in-the-directory", rule: "AP-31", rel: `${DIR}/extra.ts`, from: null, to: "// Origin: original ProjectOS code\nexport const extra = 1;\n" },
  // AP-32
  R("the-barrel-drops-the-check", "AP-32", BARREL_REL, "  checkToolCall,\n", ""),
  R("the-barrel-drops-the-claim", "AP-32", BARREL_REL, "  claimDone,\n", ""),
  R("the-barrel-drops-the-effect", "AP-32", BARREL_REL, "export { canonicalArguments, deriveToolEffect,", "export { canonicalArguments,"),
  R("the-barrel-exports-a-minter", "AP-32", BARREL_REL, "  checkToolCall,\n", "  checkToolCall,\n  issueToolApproval,\n"),
  R("the-barrel-exports-the-guard-start", "AP-32", BARREL_REL, "export { actionCouldBeSteered,", "export { startRunGuard, actionCouldBeSteered,"),
  R("the-barrel-exports-a-whole-module", "AP-32", BARREL_REL, "export {\n  CHECK_SOURCES,", "export * from './taint.js';\nexport {\n  CHECK_SOURCES,"),
  // AP-33
  R("validate-all-omits-this-validator", "AP-33", VA_REL, `"${THIS_VALIDATOR}"`, `"${THIS_VALIDATOR}-disabled"`),
  R("cached-runner-omits-this-validator", "AP-33", CR_REL, `"${THIS_VALIDATOR}"`, `"${THIS_VALIDATOR}-disabled"`),
  R("validate-all-comments-this-validator-out", "AP-33", VA_REL, `  "${THIS_VALIDATOR}"`, `  // "${THIS_VALIDATOR}"`),
  // AP-34
  R("a-binding-proof-is-skipped", "AP-34", BINDING_TEST_REL, "it('every one-character change to the arguments is refused'", "it.skip('every one-character change to the arguments is refused'"),
  R("a-taint-proof-is-renamed-away", "AP-34", TAINT_TEST_REL, "more content after a fresh approval makes it stale again", "it is stale"),
  R("an-evidence-proof-is-commented-out", "AP-34", EVIDENCE_TEST_REL, "  it('without its receipt is refused'", "  // it('without its receipt is refused'"),
  R("a-suite-is-isolated", "AP-34", EVIDENCE_TEST_REL, "describe('what counts as a receipt'", "describe.only('what counts as a receipt'"),
  // AP-35
  R("the-approval-header-loses-its-limit", "AP-35", APPROVAL_REL, "A CLEAR RESULT GRANTS NOTHING.", "A clear result is a clear result."),
  R("the-approval-type-loses-the-grant-port-rule", "AP-35", APPROVAL_REL, "AN APPROVAL CAN NEVER ANSWER THE ENVELOPE GRANT PORT.", "An approval is an approval."),
  R("the-taint-header-loses-complete-mediation", "AP-35", TAINT_REL, "taint is sound only under complete mediation", "taint is sound"),
  R("the-finish-record-loses-the-owner-proof-term", "AP-35", FINISH_REL, "`decidedBy` must become a Host-authenticated owner proof, not a role string", "`decidedBy` stays"),
  R("the-finish-record-loses-the-envelope-term", "AP-35", FINISH_REL, "An approval names its envelope, with action = tool and subjectHash = argumentHash", "An approval stands alone"),
  R("the-finish-record-loses-the-mediation-term", "AP-35", FINISH_REL, "Unmediated CLI workers start tainted", "Workers start clean"),
  R("the-finish-record-loses-the-receipt-term", "AP-35", FINISH_REL, "The kernel runs receipt checks itself and pins definition hashes", "Receipts are trusted"),
  R("the-finish-record-loses-the-owner-view-term", "AP-35", FINISH_REL, "The owner sees canonical bytes and taint sources, never model summaries", "The owner sees a summary"),
  R("the-finish-record-loses-the-first-review", "AP-35", FINISH_REL, "ECC SECURITY: APPROVE WITH CHANGES", "ECC: fine"),
  R("the-finish-record-loses-the-second-review", "AP-35", FINISH_REL, "Agency application-security-engineer: APPROVE WITH CHANGES", "Agency: fine"),
  R("the-finish-record-loses-the-p1-finding", "AP-35", FINISH_REL, "`bridge-read` answers a conversation on the far side of the tunnel", "`bridge-read` is local"),
  R("the-taint-header-loses-its-limit", "AP-35", TAINT_REL, "WHAT THIS MODULE CANNOT PROVE.", "What it does."),
  R("the-receipt-header-loses-its-limit", "AP-35", RECEIPT_REL, "REPORTED DONE IS NOT VERIFIED.", "Reported."),
  R("the-finish-record-loses-the-wiring", "AP-35", FINISH_REL, "Nothing is wired into the run loop.", "Wiring is done."),
  R("the-finish-record-loses-the-licence-catch", "AP-35", FINISH_REL, "`src/quality/completion_integrity.py` was not ported", "one file was left"),
  R("the-finish-record-loses-the-defect", "AP-35", FINISH_REL, "`selfTest` appends its fixture entries to the real notices", "the credit validator passes"),
];

function textKill(m, raw, wired) {
  if (m.wire !== undefined) {
    return textProblems(raw, [...wired, m.wire]).some(([rule]) => rule === m.rule) ? null : `AP-M: mutation '${m.name}' survived; ${m.rule} did not fire`;
  }
  const text = raw[m.rel];
  if (m.from !== null && (typeof text !== "string" || !text.includes(m.from))) return `AP-M: mutation '${m.name}' no longer applies to ${m.rel}; update it with the rule`;
  const changed = m.from === null ? m.to : m.all === true ? text.split(m.from).join(m.to) : text.replace(m.from, () => m.to);
  const fired = textProblems({ ...raw, [m.rel]: changed }, wired).map(([rule]) => rule);
  return fired.includes(m.rule) ? null : `AP-M: mutation '${m.name}' survived; ${m.rule} did not fire`;
}

function readAll() {
  const raw = {};
  const directory = fs.readdirSync(path.join(ROOT, ...DIR.split("/")), { withFileTypes: true }).map((entry) => `${DIR}/${entry.name}`);
  for (const rel of [...new Set([...ALL_FILES, ...directory, CORE_BARREL_REL, NOTICES_REL, FINISH_REL, VA_REL, CR_REL, ...Object.keys(TESTS)])]) raw[rel] = read(rel);
  return raw;
}

function selfTest(raw, wired, registryJson) {
  const sources = Object.fromEntries(ALL_FILES.map((rel) => [rel, raw[rel]]));
  const errors = [
    ...BEHAVIOUR_MUTATIONS.map((m) => behaviourKill(m, sources, registryJson)),
    ...TEXT_MUTATIONS.map((m) => textKill(m, raw, wired)),
  ].filter((error) => error !== null);
  const names = [...BEHAVIOUR_MUTATIONS, ...TEXT_MUTATIONS].map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("AP-M: two mutations share a name");
  const scenarioNames = SCENARIOS.map(({ name }) => name);
  if (new Set(scenarioNames).size !== scenarioNames.length) errors.push("AP-M: two scenarios share a name");
  const rulesOf = new Map(SCENARIOS.map(({ name, rule }) => [name, rule]));
  const proved = new Set([...BEHAVIOUR_MUTATIONS.map((m) => rulesOf.get(m.kills)), ...TEXT_MUTATIONS.map((m) => m.rule)]);
  for (const rule of Object.keys(RULE_NAMES)) if (!proved.has(rule)) errors.push(`AP-M: rule ${rule} has no named mutation`);
  const killed = new Set(BEHAVIOUR_MUTATIONS.flatMap((m) => [m.kills, ...m.also]));
  for (const name of scenarioNames) if (!killed.has(name)) errors.push(`AP-M: no mutation moves the scenario '${name}'`);
  return errors;
}

function run() {
  const raw = readAll();
  const wired = productSources();
  const errors = textProblems(raw, wired).map(([, message]) => message);
  if (errors.length > 0) return errors;
  const registryJson = JSON.parse(read(REGISTRY_REL));
  const sources = Object.fromEntries(ALL_FILES.map((rel) => [rel, raw[rel]]));
  const behaviour = behaviourProblems(sources, registryJson).map(([, message]) => message);
  return behaviour.length > 0 ? behaviour : selfTest(raw, wired, registryJson);
}

if (require.main === module) {
  const errors = run();
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`FAIL: ${error}`));
    console.error(`${THIS_VALIDATOR}: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${SCENARIOS.length} scenarios; ${BEHAVIOUR_MUTATIONS.length} behaviour and ${TEXT_MUTATIONS.length} text mutations killed)`);
}

module.exports = { run, textProblems, selfTest, SCENARIOS, BEHAVIOUR_MUTATIONS, TEXT_MUTATIONS, RULE_NAMES };
