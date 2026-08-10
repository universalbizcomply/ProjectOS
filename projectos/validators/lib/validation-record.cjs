"use strict";
/**
 * The durable, subject-bound record of WHICH validators actually ran and WHICH of them passed.
 *
 * WHY THIS EXISTS. Until now the only closure evidence that validators had passed was a boolean —
 * `validatorsPass: true` — typed by hand into `.projectops/closure/<phaseId>.json`. No code wrote
 * that file, nothing named a single validator, and the G4 gate could not tell a suite that ran from
 * a suite that was claimed. Meanwhile the approved plan declares `requiredValidators` per phase and
 * NOTHING read them. A plan requirement that no mechanism checks is documentation.
 *
 * The producer lives here, beside the runner, because the runner is the ONLY place that knows the
 * true per-module outcome. Parsing it back out of stdout, or letting a caller hand in a list, would
 * reintroduce exactly the assertion this record exists to replace.
 *
 * TRUST SHAPE. The record is named after the 40-hex commit it was produced at and repeats that
 * commit inside itself, so a record cannot be silently reused for a different subject. It is written
 * only from a CLEAN working tree: a record named after a commit but produced from a modified tree
 * would be a claim about bytes that were never validated. Every unknown fails closed.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SCHEMA_VERSION = "1.0.0";
const HEX40 = /^[0-9a-f]{40}$/;

/** Where a record for `head` lives, relative to the project root. Forward slashes: it is compared
 *  against git path output and against the closure-tail allowlist, both of which use them. */
function recordRelPath(head) {
  return ".projectops/validation/" + head + ".json";
}

function recordPath(root, head) {
  return path.join(root, ".projectops", "validation", head + ".json");
}

/** Capture git stdout, or null on any failure. Never throws — a git problem must not look clean. */
function git(root, args) {
  try {
    return execFileSync("git", ["-C", root].concat(args), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) {
    return null;
  }
}

/** The repository facts the record binds itself to. Any failure yields nulls, which refuse to write. */
function repoFacts(root) {
  const head = git(root, ["rev-parse", "HEAD"]);
  const status = git(root, ["status", "--porcelain"]);
  return {
    head: head !== null && HEX40.test(head) ? head : null,
    // `null` (git failed) is NOT clean. Only an empty porcelain output is.
    workingTreeClean: status === null ? false : status === "",
  };
}

/**
 * Build the record from real outcomes.
 *
 * `results` is the runner's own per-module truth: one entry per REGISTERED module, in registry order.
 * `registeredModuleCount` is the length of that registry — deliberately a separate field from the
 * aggregate verdict, so "123 modules ran" can never be reported as 124 by counting the wrapper.
 */
function buildRecord(input) {
  const results = input.results.map((r) => ({
    name: String(r.name),
    passed: r.passed === true,
    errorCount: Number.isFinite(r.errorCount) ? r.errorCount : -1,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    subjectHead: input.subjectHead,
    generatedAt: input.generatedAt,
    workingTreeCleanAtRunStart: input.workingTreeCleanAtRunStart === true,
    aggregatePassed: results.every((r) => r.passed),
    registeredModuleCount: input.registeredModuleCount,
    results,
  };
}

/**
 * Should a record be written, and what would it say? PURE — no git, no filesystem — so the refusal
 * rules can be proven exhaustively instead of depending on whatever state the machine happens to be
 * in when a validator runs.
 *
 * Refuses, rather than writing something untrue, when HEAD cannot be established, when the working
 * tree is dirty, or when the runner's result count disagrees with the registry it claims to have run.
 */
function planRecordWrite(facts, results, registeredModuleCount, nowIso) {
  if (facts === null || typeof facts !== "object") {
    return { write: false, reason: "repository facts were not established" };
  }
  if (typeof facts.head !== "string" || !HEX40.test(facts.head)) {
    return { write: false, reason: "HEAD could not be established from git" };
  }
  if (facts.workingTreeClean !== true) {
    return {
      write: false,
      reason:
        "the working tree is not clean, so a record named after " +
        facts.head.slice(0, 7) +
        " would describe bytes that commit does not contain",
    };
  }
  if (!Array.isArray(results)) return { write: false, reason: "the runner produced no result list" };
  if (!Number.isInteger(registeredModuleCount) || registeredModuleCount < 1) {
    return { write: false, reason: "the registered module count is not a positive integer" };
  }
  if (results.length !== registeredModuleCount) {
    return {
      write: false,
      reason:
        "the runner produced " + results.length + " result(s) for " + registeredModuleCount + " registered module(s)",
    };
  }
  return {
    write: true,
    reason: "",
    record: buildRecord({
      subjectHead: facts.head,
      generatedAt: nowIso,
      workingTreeCleanAtRunStart: true,
      registeredModuleCount: registeredModuleCount,
      results: results,
    }),
  };
}

/** Write the record for the current HEAD. The only impure edge; the decision above is pure. */
function writeRecord(root, results, registeredModuleCount, nowIso) {
  const decision = planRecordWrite(repoFacts(root), results, registeredModuleCount, nowIso);
  if (!decision.write) return { written: false, path: null, reason: decision.reason };
  const p = recordPath(root, decision.record.subjectHead);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(decision.record, null, 2) + "\n", "utf8");
  return { written: true, path: p, reason: "" };
}

/**
 * Structural check of a record read from disk. Returns error strings; [] means the record is
 * well-formed AND self-consistent with the filename it was found under.
 *
 * `expectedHead` is the head the caller believes the record is for. It is checked here rather than
 * trusted, because the whole point of naming the file after a commit is defeated if the contents may
 * disagree with the name.
 */
function checkRecordShape(record, expectedHead) {
  const e = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) return ["record is not an object"];
  if (record.schemaVersion !== SCHEMA_VERSION) e.push("schemaVersion is not " + SCHEMA_VERSION);
  if (typeof record.subjectHead !== "string" || !HEX40.test(record.subjectHead)) e.push("subjectHead is not a 40-hex commit");
  else if (typeof expectedHead === "string" && record.subjectHead !== expectedHead) {
    e.push("subjectHead " + record.subjectHead + " does not match the expected subject " + expectedHead);
  }
  if (typeof record.generatedAt !== "string" || record.generatedAt.length === 0) e.push("generatedAt missing");
  if (record.workingTreeCleanAtRunStart !== true) e.push("the run was not made from a clean working tree");
  if (typeof record.aggregatePassed !== "boolean") e.push("aggregatePassed is not a boolean");
  if (!Number.isInteger(record.registeredModuleCount) || record.registeredModuleCount < 1) e.push("registeredModuleCount is not a positive integer");
  if (!Array.isArray(record.results)) { e.push("results is not an array"); return e; }
  if (Number.isInteger(record.registeredModuleCount) && record.results.length !== record.registeredModuleCount) {
    e.push("results length " + record.results.length + " != registeredModuleCount " + record.registeredModuleCount);
  }
  const seen = new Set();
  record.results.forEach((r, i) => {
    if (r === null || typeof r !== "object") { e.push("results[" + i + "] is not an object"); return; }
    if (typeof r.name !== "string" || r.name.length === 0) e.push("results[" + i + "].name missing");
    else if (seen.has(r.name)) e.push("duplicate validator result: " + r.name);
    else seen.add(r.name);
    if (typeof r.passed !== "boolean") e.push("results[" + i + "].passed is not a boolean");
    if (!Number.isInteger(r.errorCount)) e.push("results[" + i + "].errorCount is not an integer");
  });
  // A record that says it passed while carrying a failing module contradicts itself.
  if (record.aggregatePassed === true && record.results.some((r) => r && r.passed !== true)) {
    e.push("aggregatePassed is true but at least one module result is not passing");
  }
  return e;
}

/** The names recorded as PASSING. The only list a gate may treat as evidence. */
function passingNames(record) {
  if (record === null || typeof record !== "object" || !Array.isArray(record.results)) return [];
  return record.results.filter((r) => r && r.passed === true && typeof r.name === "string").map((r) => r.name);
}

module.exports = {
  SCHEMA_VERSION,
  HEX40,
  recordRelPath,
  recordPath,
  repoFacts,
  buildRecord,
  planRecordWrite,
  writeRecord,
  checkRecordShape,
  passingNames,
};
