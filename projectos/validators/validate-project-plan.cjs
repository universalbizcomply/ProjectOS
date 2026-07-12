"use strict";
// Schema-shape + commit-lifecycle validation for ProjectOS V3 project-plan records.
// Schema-shape: every schema-required top-level key present on the template, the valid fixture, and
// the live ProjectOS V3 plan instance.
// Commit-lifecycle (added in the metadata-binding sub-gate): the live plan's baselineCommit /
// planPersistenceCommit / lastVerifiedCommit are proven against LOCAL Git — existence + ancestry +
// required-content — so the plan can never reference a fabricated, future, self-referential or
// unrelated commit. This closes carry-forward R2. Git is invoked via execFileSync with an argument
// array (no shell, no interpolation), every hash is format-validated before use, and any Git error
// fails CLOSED. No remote, no fetch, no credentials.
// Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }

const HEX40 = /^[0-9a-fA-F]{40}$/;
const REQUIRED_PLAN_FILES = [
  "docs/architecture/projectos-v3-master-plan.md",
  "projectos/state/projectos-v3.plan.json",
  "projectos/state/projectos-v3.current-state.json",
  "projectos/state/projectos-v3.session.json"
];

// Capture git stdout (throws on non-zero). Local repo only.
function gitCapture(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
// Boolean git predicate: true iff git exits 0. Fails closed (false) on any error.
function gitCheck(args) {
  try { execFileSync("git", args, { cwd: ROOT, stdio: "ignore" }); return true; } catch (_) { return false; }
}
function commitExists(h) { return HEX40.test(h) && gitCheck(["cat-file", "-e", h + "^{commit}"]); }
function isAncestorOrEqual(a, b) { return HEX40.test(a) && HEX40.test(b) && gitCheck(["merge-base", "--is-ancestor", a, b]); }
function commitHasFile(h, rel) { return HEX40.test(h) && gitCheck(["cat-file", "-e", h + ":" + rel]); }

// Lifecycle-aware commit-semantics check over a plan object. Returns error strings ([] = valid).
function checkCommitSemantics(plan) {
  const e = [];
  // Normalize hashes to lowercase before ANY comparison or git call. HEX40 accepts mixed case, but
  // Git resolves object names case-insensitively; comparing as raw strings would let a mixed-case
  // duplicate of baselineCommit slip past the self-reference guard. Canonicalize first.
  const repo = plan.repository || {};
  const base = (repo.baselineCommit || "").toLowerCase();
  const ppcRaw = repo.planPersistenceCommit;
  const ppc = (typeof ppcRaw === "string") ? ppcRaw.toLowerCase() : ppcRaw;
  const lvc = ((plan.staleness || {}).lastVerifiedCommit || "").toLowerCase();

  let head;
  try { head = gitCapture(["rev-parse", "HEAD"]); }
  catch (_) { e.push("git unavailable — failing closed on commit-semantics"); return e; }

  // baselineCommit: format + local existence.
  if (!HEX40.test(base)) { e.push("baselineCommit is not a 40-hex commit"); }
  else if (!commitExists(base)) e.push("baselineCommit does not exist in local Git");

  // lastVerifiedCommit: format + existence + ancestor-or-equal HEAD.
  if (!HEX40.test(lvc)) e.push("lastVerifiedCommit is not a 40-hex commit");
  else if (!commitExists(lvc)) e.push("lastVerifiedCommit does not exist in local Git");
  else if (!isAncestorOrEqual(lvc, head)) e.push("lastVerifiedCommit is not an ancestor of or equal to HEAD");

  // planPersistenceCommit lifecycle.
  if (ppc === null) {
    // NULL is valid only pre-persistence: repository HEAD must still equal baselineCommit.
    if (HEX40.test(base) && head !== base) e.push("planPersistenceCommit is null but HEAD has advanced beyond baselineCommit");
  } else if (typeof ppc === "string") {
    if (!HEX40.test(ppc)) e.push("planPersistenceCommit is not a 40-hex commit");
    else {
      if (!commitExists(ppc)) e.push("planPersistenceCommit does not exist in local Git");
      if (ppc === base) e.push("planPersistenceCommit must not equal baselineCommit");
      if (HEX40.test(base) && !isAncestorOrEqual(base, ppc)) e.push("baselineCommit is not an ancestor of planPersistenceCommit");
      if (!isAncestorOrEqual(ppc, head)) e.push("planPersistenceCommit is not an ancestor of or equal to HEAD");
      for (const f of REQUIRED_PLAN_FILES) if (!commitHasFile(ppc, f)) e.push("planPersistenceCommit missing required plan file: " + f);
    }
  } else {
    e.push("planPersistenceCommit must be null or a 40-hex string");
  }

  // Authoritative source-document checksum (plan<->document link is a checksum, not a commit).
  const auth = (plan.sourceDocuments || []).find((d) => d.authoritative && !d.superseded);
  if (!auth || !/^sha256:/.test(auth.sourceDocumentChecksum || "")) e.push("missing authoritative source-document sha256 checksum");
  return e;
}

// Self-tests: prove the lifecycle rule accepts valid states and rejects invalid ones, using REAL
// local commits (no network). Returns [] when all expectations hold, else failure descriptions.
function selfTests() {
  const fails = [];
  let head, baseline, impl, bparent;
  try {
    head = gitCapture(["rev-parse", "HEAD"]);
    baseline = gitCapture(["rev-parse", "de58428^"]);        // approved baseline (parent of impl commit)
    impl = gitCapture(["rev-parse", "de58428"]);             // implementation / persistence commit
    bparent = gitCapture(["rev-parse", "de58428~2"]);        // baseline's parent — exists, base is NOT its ancestor
  } catch (e) { return ["selftest git setup failed (fail-closed): " + e.message]; }

  const synth = (base, ppc, lvc) => ({
    repository: { baselineCommit: base, planPersistenceCommit: ppc },
    sourceDocuments: [{ authoritative: true, superseded: false, sourceDocumentChecksum: "sha256:selftest" }],
    staleness: { lastVerifiedCommit: lvc }
  });
  const expectClean = (label, plan) => { const r = checkCommitSemantics(plan); if (r.length) fails.push("selftest[" + label + "] expected clean, got: " + r.join("; ")); };
  const expectReason = (label, plan, needle) => { const r = checkCommitSemantics(plan); if (!r.some((x) => x.indexOf(needle) !== -1)) fails.push("selftest[" + label + "] expected reason '" + needle + "', got: " + (r.length ? r.join("; ") : "[]")); };

  // Pre-persistence VALID: null ppc while HEAD == baselineCommit.
  expectClean("pre-persistence-valid", synth(head, null, head));
  // Pre-persistence INVALID: null ppc but HEAD advanced beyond baselineCommit.
  expectReason("pre-persistence-invalid", synth(baseline, null, baseline), "HEAD has advanced");
  // Bound VALID: ppc = real impl commit, descended from baseline, ancestor of HEAD, contains plan files.
  expectClean("bound-valid", synth(baseline, impl, impl));
  // Bound INVALID: malformed hash.
  expectReason("bound-malformed", synth(baseline, "not-a-real-hash", baseline), "not a 40-hex");
  // Bound INVALID: well-formed but nonexistent commit.
  expectReason("bound-nonexistent", synth(baseline, "f".repeat(40), baseline), "does not exist");
  // Bound INVALID: baseline used as planPersistenceCommit.
  expectReason("bound-equals-baseline", synth(baseline, baseline, baseline), "must not equal baselineCommit");
  // Bound INVALID: mixed-case duplicate of baseline must still be rejected (hashes normalized first).
  expectReason("bound-equals-baseline-uppercase", synth(baseline, baseline.toUpperCase(), baseline), "must not equal baselineCommit");
  // Bound INVALID: commit not descended from baseline (baseline's own parent) -> ancestry + missing files.
  expectReason("bound-not-descended", synth(baseline, bparent, baseline), "baselineCommit is not an ancestor");
  expectReason("bound-missing-files", synth(baseline, bparent, baseline), "missing required plan file");
  // NOTE: "planPersistenceCommit not an ancestor of HEAD" is guarded by isAncestorOrEqual(ppc, head),
  // but this repo's history is linear (every existing commit is an ancestor of HEAD), so no REAL
  // existing non-ancestor commit is available to exercise it as a live negative. Not silently skipped.
  return fails;
}

function run() {
  const errors = [];
  const schemaPath = path.join(ROOT, "projectos/schemas/project-plan.schema.json");
  if (!fs.existsSync(schemaPath)) { errors.push("missing project-plan.schema.json"); return errors; }
  let schema;
  try { schema = readJSON(schemaPath); } catch (e) { errors.push("schema not valid JSON: " + e.message); return errors; }
  const required = schema.required || [];
  if (!required.length) errors.push("project-plan schema has no required[]");
  const targets = [
    "projectos/templates/project-plan.template.json",
    "projectos/examples/v3-plan-fixtures/plan-valid-approved-ready.json",
    "projectos/state/projectos-v3.plan.json"
  ];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj;
    try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    for (const key of required) if (!(key in obj)) errors.push(rel + " missing required key: " + key);
    for (const err of engine.validateAgainstSchema(obj, schema, rel)) errors.push(err);
    const gov = obj.governance || {};
    if (Array.isArray(gov.forbiddenActions) && gov.forbiddenActions.length === 0) errors.push(rel + " governance.forbiddenActions is empty");
  }
  // Commit-lifecycle proof on the live ProjectOS V3 plan (git-verified).
  try {
    const live = readJSON(path.join(ROOT, "projectos/state/projectos-v3.plan.json"));
    for (const err of checkCommitSemantics(live)) errors.push("live plan: " + err);
  } catch (e) { errors.push("live plan not readable for commit-semantics check: " + e.message); }
  // Self-tests of the lifecycle rule (real local commits, no network).
  for (const f of selfTests()) errors.push(f);
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-project-plan: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-project-plan: PASS");
}
module.exports = { run, checkCommitSemantics };
