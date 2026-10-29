"use strict";
/**
 * D11 — ROLE-SEPARATED INDEPENDENT REVIEW — PROJECTOS-KERNEL-ROLE-REVIEW1A.
 *
 * The tests prove today's behaviour; this pins the SHAPE of each rule, because every way of undoing
 * one reads reasonably in a diff:
 *
 *   RR-1 "a review is a review, whoever names it"     — and the implementer certifies itself again
 *   RR-2 "pass the worker's list straight through"    — and RR-1 is bypassed at its only call site
 *   RR-3 "any configured worker may review"           — and the implementer reviews its own work
 *   RR-4 "the reviewer's word is enough"              — and a stale, forged or tree-moving review counts
 *   RR-5 "no review declared, nothing outstanding"    — and a self-review-only plan closes again
 *   RR-6 "approval need not look at reviews"          — and such a plan is approved in the first place
 *   RR-7 "the gatekeeper can be asked first"          — and the reviewer's record is not in what it reads
 *   RR-8 "the reviewer can double as the default"     — and the same worker implements and reviews
 *
 * Added after the independent reviews (ECC SECURITY H1/H2/M4/M5, Agency IAM F1/F2):
 *
 *   RR-10 "a rejection is just a HIGH finding"        — and the gatekeeper approves past the reviewer
 *   RR-11 "no stop means done"                         — and a decoy finding skips the review entirely
 *   RR-12 "any review name is the reviewer's"          — and a worker satisfies an owner review
 *   RR-13 "the grant is the next argument"             — and `--allowedTools Read Bash` grants a shell
 *   RR-14 "the reviewer reads what it is given"        — and the candidate arms or steers the reviewer
 *
 * Each rule has a NAMED MUTATION below; `selfTest` applies it in memory and counts it killed only when
 * THAT rule fires. Comments are stripped first. Reads files; runs nothing, calls no provider.
 *
 * KNOWN GAP, REPORTED NOT PINNED (D11-C1): `closure prepare` (commands/closure.ts, protected in plan
 * v1.17) still derives G4-9 from the worker-attested findings list. The loop no longer credits that
 * list, so the gap cannot let a run REACH closure on a self-claim; it can only refuse an honest one.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ROLES_REL = "projectos/agent/src/loop/reviewRoles.ts";
const REVIEW_REL = "projectos/agent/src/loop/independentReview.ts";
const RUNNER_REL = "projectos/agent/src/loop/runner.ts";
const OUTCOME_REL = "projectos/agent/src/loop/outcome.ts";
const APPROVAL_REL = "projectos/agent/src/planApproval.ts";
const WORKERS_REL = "projectos/agent/src/loop/workers.ts";
const ADAPTER_REL = "projectos/agent/src/loop/adapters/claudeCodeCli.ts";
const CLOSURE_REL = "projectos/agent/src/commands/closure.ts";
const SOURCES = [ROLES_REL, REVIEW_REL, RUNNER_REL, OUTCOME_REL, APPROVAL_REL, WORKERS_REL, ADAPTER_REL];

const TESTS = {
  "projectos/agent/test/kernelRoleReview.test.ts": [
    "never credits an independent review from the implementer's own claim",
    "refuses a missing reviewer, the implementer as reviewer, and a reviewer with write grants",
    "refuses a record about other bytes, another nonce, or by the implementer",
    "materialisePlan refuses a draft whose phase has only a worker self-review",
    "credits nothing from a REJECT or from a review that found something CRITICAL or HIGH (ECC SECURITY H1)",
    "never credits a reviewer worker with an owner, gatekeeper or maintainer review (ECC SECURITY M4)",
    "sees every grant form the CLI accepts: variadic, space-separated, repeated and bare (ECC M5, IAM F1)",
    "names a candidate that changes files the reviewer CLI loads as its own configuration",
  ],
  "projectos/agent/test/loopRunner.test.ts": [
    "[R2] a worker that NAMES the independent reviews itself does not get past REVIEW_OUTSTANDING without a reviewer",
    "[R4] a reviewer record PLANTED by the worker credits nothing",
    "[R2+R4] an approving reviewer satisfies the reviews, and the loop writes a record bound to the candidate and its nonce",
    "[R2] a REJECT from the reviewer leaves the review outstanding, a stop no verdict can approve past",
    "[H2] a reviewer that answered without reading anything has not reviewed",
  ],
  "projectos/agent/test/loopOutcome.test.ts": [
    "stops a phase whose only review is a self-review, even with that review recorded",
  ],
};

/** Named mutations: each must make its own rule fire. */
const MUTATIONS = [
  { name: "credit-any-claim", rule: "RR-1", rel: ROLES_REL,
    from: "isSelfReview(r) ? implementerClaims.includes(r) : reviewable.includes(r) && performed.includes(r)",
    to: "implementerClaims.includes(r) || performed.includes(r)" },
  { name: "raw-worker-list", rule: "RR-2", rel: RUNNER_REL,
    from: "reviewsRecorded: creditedReviews(required, findings.value.reviews, null),",
    to: "reviewsRecorded: findings.value.reviews," },
  { name: "implementer-may-review", rule: "RR-3", rel: ROLES_REL,
    from: "if (reviewer.workerId === implementer.workerId) {", to: "if (false) {" },
  { name: "reviewer-may-write", rule: "RR-3", rel: ROLES_REL,
    from: "const grants = argvGrants(reviewer.args).filter((g) => !READ_ONLY_GRANT.test(g));", to: "const grants: string[] = [];" },
  { name: "ignore-tree-drift", rule: "RR-4", rel: REVIEW_REL,
    from: "after.identity.digest !== before.identity.digest", to: "after.identity.digest !== after.identity.digest" },
  { name: "fixed-nonce", rule: "RR-4", rel: REVIEW_REL,
    from: "randomBytes(16).toString('hex')", to: "'0'" },
  { name: "no-independent-required", rule: "RR-5", rel: OUTCOME_REL,
    from: "if (independentReviews(input.brief.phase.requiredReviews).length === 0) {", to: "if (false) {" },
  { name: "approval-skips-reviews", rule: "RR-6", rel: APPROVAL_REL,
    from: "problems.push(...planReviewProblems(id, arrOfStrings(c['requiredReviews'])));", to: "" },
  { name: "gatekeeper-not-shown-record", rule: "RR-7", rel: RUNNER_REL,
    from: "independentReview: reviewerRecord !== null", to: "unrelated: reviewerRecord !== null" },
  { name: "reviewer-is-default", rule: "RR-8", rel: WORKERS_REL,
    from: "if (declaredReviewer !== null && declaredReviewer === declaredDefault) {", to: "if (false) {" },
  { name: "credit-a-rejection", rule: "RR-10", rel: ROLES_REL,
    from: "record === null || !reviewPassed(record)", to: "record === null" },
  { name: "complete-without-review", rule: "RR-11", rel: RUNNER_REL,
    from: "if (stop === null && (unreviewed.length > 0 || independentReviews(brief.phase.requiredReviews).length === 0)) {",
    to: "if (false) {" },
  { name: "worker-gives-owner-review", rule: "RR-12", rel: ROLES_REL,
    from: ": reviewable.includes(r) && performed.includes(r)", to: ": performed.includes(r)" },
  { name: "next-argument-only", rule: "RR-13", rel: WORKERS_REL,
    from: "for (let j = i + 1; j < args.length && !(args[j] as string).startsWith('-'); j += 1) add(args[j] as string);",
    to: "if (args[i + 1] !== undefined) add(args[i + 1] as string);" },
  { name: "bare-grant-invisible", rule: "RR-13", rel: WORKERS_REL,
    from: "/^(Write|Edit|MultiEdit|NotebookEdit|Bash|Task|Agent)\\s*(\\(|$)/i", to: "/^(Write|Edit|MultiEdit|NotebookEdit|Bash|Task|Agent)\\s*\\(/i" },
  { name: "reviewer-loads-candidate-config", rule: "RR-14", rel: REVIEW_REL,
    from: "const armed = reviewerConfigPaths(paths);", to: "const armed: string[] = [];" },
  { name: "reviewer-not-denied", rule: "RR-14", rel: ADAPTER_REL,
    from: "[...worker.args, ...REVIEWER_DENIED, ...OUTPUT_ARGS, '-p', instruction]", to: "[...worker.args, ...OUTPUT_ARGS, '-p', instruction]" },
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments outside strings — the same walk `val-projectos-boot-continue1a` uses. */
function code(text) {
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

/** The rules, over a map of rel → raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  const src = {};
  for (const rel of SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("RR-0", `${rel} is missing`);
      return errors;
    }
    src[rel] = code(raw[rel]);
  }
  const roles = src[ROLES_REL];
  const review = src[REVIEW_REL];
  const runner = src[RUNNER_REL];

  if (!/isSelfReview\(r\) \? implementerClaims\.includes\(r\) : [^;]*performed\.includes\(r\)/.test(roles)) {
    E("RR-1", "creditedReviews no longer limits the implementer's claims to self-reviews");
  }
  if (!runner.includes("reviewsRecorded: creditedReviews(required, findings.value.reviews, null),") ||
      /reviewsRecorded:\s*findings\.value\.reviews\b/.test(runner)) {
    E("RR-2", "the runner passes the worker's own review list to the decision instead of creditedReviews");
  }
  if (!roles.includes("if (reviewer.workerId === implementer.workerId) {") ||
      !roles.includes("const grants = argvGrants(reviewer.args).filter((g) => !READ_ONLY_GRANT.test(g));")) {
    E("RR-3", "roleBindingProblems no longer refuses the implementer as reviewer, or a reviewer with write grants");
  }
  if (!review.includes("after.identity.digest !== before.identity.digest") ||
      !review.includes("randomBytes(16).toString('hex')") ||
      !review.includes("parseReviewerVerdict(reviewerText(outcome.stdout), nonce)") ||
      !review.includes("reviewerRecordProblems(record, subject, nonce)")) {
    E("RR-4", "the review is no longer bound to a fresh nonce, the unchanged candidate and a checked record");
  }
  const outcome = src[OUTCOME_REL];
  const r5 = outcome.indexOf("if (independentReviews(input.brief.phase.requiredReviews).length === 0) {");
  if (r5 < 0 || r5 > outcome.indexOf("const outstanding = outstandingReviews(")) {
    E("RR-5", "decideContinuation no longer stops a phase with no independent review before certification");
  }
  if (!src[APPROVAL_REL].includes("problems.push(...planReviewProblems(id, arrOfStrings(c['requiredReviews'])));")) {
    E("RR-6", "materialisePlan no longer refuses a phase with no independent review");
  }
  const dispatched = runner.indexOf("runIndependentReview(sys, root, {");
  const asked = runner.indexOf("const answered = applyReviewerAnswer(decision.reason, evidenceFor(decision.reason, {");
  if (dispatched < 0 || asked < 0 || dispatched > asked ||
      !runner.includes("independentReview: reviewerRecord !== null") ||
      !runner.includes("{ independentReview: parts.independentReview }")) {
    E("RR-7", "the reviewer is not dispatched before the gatekeeper is asked, or its record is not in the evidence");
  }
  if (!src[WORKERS_REL].includes("if (declaredReviewer !== null && declaredReviewer === declaredDefault) {")) {
    E("RR-8", "the configured reviewer may also be the default implementer");
  }
  if (!roles.includes("record === null || !reviewPassed(record)")) {
    E("RR-10", "creditedReviews credits a rejected review, so the stop becomes one the gatekeeper may approve past");
  }
  if (!runner.includes("if (stop === null && (unreviewed.length > 0 || independentReviews(brief.phase.requiredReviews).length === 0)) {")) {
    E("RR-11", "the run may end COMPLETE with an independent review outstanding");
  }
  if (!roles.includes(": reviewable.includes(r) && performed.includes(r)")) {
    E("RR-12", "a reviewer worker may be credited with an owner, gatekeeper or maintainer review");
  }
  const workers = src[WORKERS_REL];
  if (!workers.includes("for (let j = i + 1; j < args.length && !(args[j] as string).startsWith('-'); j += 1) add(args[j] as string);") ||
      !workers.includes("/^(Write|Edit|MultiEdit|NotebookEdit|Bash|Task|Agent)\\s*(\\(|$)/i")) {
    E("RR-13", "argvGrants reads only the next argument, or a bare write-capable tool name is not seen");
  }
  if (!review.includes("const armed = reviewerConfigPaths(paths);") ||
      !src[ADAPTER_REL].includes("[...worker.args, ...REVIEWER_DENIED, ...OUTPUT_ARGS, '-p', instruction]") ||
      !roles.includes("UNTRUSTED DATA WRITTEN BY THE IMPLEMENTER")) {
    E("RR-14", "the reviewer may load candidate-written configuration, is not deny-listed, or is not told the repository is untrusted");
  }
  return errors;
}

/** Every named mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || !text.includes(m.from)) {
      errors.push(`RR-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`RR-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
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
      errors.push(`RR-9: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`RR-9: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

/** D11-C1, reported each run so it is not forgotten. */
function knownGapNote() {
  const closure = read(CLOSURE_REL);
  if (closure !== null && closure.includes("reviewsComplete: required.every((r) => recorded.reviews.includes(r)),")) {
    return "NOTE D11-C1: closure prepare still derives G4-9 from the worker-attested findings list (commands/closure.ts)";
  }
  return null;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-kernel-role-review1a: " + e.length + " error(s)");
    process.exit(1);
  }
  const note = knownGapNote();
  if (note !== null) console.log(note);
  console.log(`val-projectos-kernel-role-review1a: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
