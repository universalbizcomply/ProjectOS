"use strict";
// Validator: PROJECTOS-V3-ACTIVE-PHASE-CONSISTENCY1A
//
// Fails closed. The durable execution memory must not contradict the canonical phase lifecycle.
//
// WHY THIS EXISTS. At the PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A checkpoint the repository held
// two statements that could not both be true: `.projectops/phases/<id>.json` recorded Phase 12 as
// `implementing`, while `projectos/state/projectos-v3.current-state.json` recorded
// `activePhase: null`. Nothing detected it, because nothing had ever compared them. A surface or a
// reader that trusted current-state would have reported "between phases" while a phase was running.
//
// WHAT IS AUTHORITATIVE. The `.projectops/phases/<id>.json` records written by `@projectos/core` are
// the phase-lifecycle authority. This validator does NOT introduce a second one: it only asserts
// that current-state AGREES with them, and it always reads the core record as the truth.
//
// Registered in validate-all by PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PHASES_DIR = path.join(ROOT, ".projectops", "phases");
const DEFAULT_STATE = path.join(ROOT, "projectos", "state", "projectos-v3.current-state.json");
const DEFAULT_SESSION = path.join(ROOT, "projectos", "state", "projectos-v3.session.json");
const CONFIG = path.join(ROOT, ".projectops", "project-config.json");

// Terminal: the phase is finished. `rolled_back` is not terminal but is not in flight either — work
// on it has stopped, so it must not be reported as the active phase.
const TERMINAL = new Set(["closed", "closed_as_blocked"]);
const NOT_IN_FLIGHT = new Set(["closed", "closed_as_blocked", "rolled_back"]);
const HEX40 = /^[0-9a-f]{40}$/;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function gitCheck(args) {
  try { execFileSync("git", args, { cwd: ROOT, stdio: "ignore" }); return true; } catch (_) { return false; }
}

/**
 * The current-state record this project DECLARES, falling back to the historical V3 location.
 *
 * The path used to be hard-coded. That was true for as long as ProjectOS had exactly one plan, and
 * stopped being true the moment a second programme was approved: the validator went on checking the
 * finished programme's record while the live one drifted unwatched. The config's `planMemory` is
 * where a project says which record is current, and it is the same declaration `governedContext`
 * already governs from — so this reads it rather than assuming.
 */
function statePath() {
  try {
    const cfg = readJson(CONFIG);
    const rel = cfg && cfg.planMemory && cfg.planMemory.currentStatePath;
    if (typeof rel === "string" && rel.trim() !== "" && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes("..")) {
      const abs = path.join(ROOT, rel);
      if (fs.existsSync(abs)) return abs;
    }
  } catch (_) { /* fall through to the default below; a malformed config is reported elsewhere */ }
  return DEFAULT_STATE;
}

/** The active plan record, or null. Used to resolve which programme's session belongs to today. */
function activePlan() {
  let planPath = path.join(ROOT, ".projectops", "plan.json");
  try {
    const cfg = readJson(CONFIG);
    const rel = cfg.planMemory && cfg.planMemory.planPath;
    if (typeof rel === "string" && rel.length > 0) planPath = path.join(ROOT, rel);
  } catch (_) { /* default */ }
  try { return readJson(planPath); } catch (_) { return null; }
}

/**
 * The ACTIVE programme's session record, named after its plan.
 *
 * A session belongs to the programme that ran it. The path was hard-coded to the V3 session, so once
 * a second programme was approved the validator compared a FINISHED session's phase against the LIVE
 * plan's active phase and reported a disagreement that was not one. The finished record is history
 * and is left exactly as it is; when the active programme has not yet written a session, there is
 * simply nothing to compare, which is the truthful answer rather than a manufactured one.
 */
function sessionPath() {
  const plan = activePlan();
  const planId = plan && typeof plan.planId === "string" ? plan.planId : null;
  if (planId !== null) {
    const named = path.join(ROOT, "projectos", "state", planId + ".session.json");
    if (fs.existsSync(named)) return named;
    // A different programme is active and has no session yet: do NOT fall back to another
    // programme's record. Returning a path that does not exist skips the comparison, by design.
    if (planId !== "projectos-v3-master-plan") return named;
  }
  return DEFAULT_SESSION;
}

/** Core phase records, keyed by id. The lifecycle authority — read, never second-guessed. */
function coreRecords() {
  if (!fs.existsSync(PHASES_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(PHASES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try { out.push(readJson(path.join(PHASES_DIR, f))); } catch (e) { out.push({ __unreadable: f, __error: e.message }); }
  }
  return out;
}

function run() {
  const e = [];
  const STATE = statePath();
  if (!fs.existsSync(STATE)) { e.push("missing current-state record"); return e; }
  let state;
  try { state = readJson(STATE); } catch (x) { e.push("current-state is not valid JSON: " + x.message); return e; }

  const records = coreRecords();
  for (const r of records) {
    if (r.__unreadable) e.push("unreadable core phase record: " + r.__unreadable + " (" + r.__error + ")");
  }
  const usable = records.filter((r) => !r.__unreadable && typeof r.phaseId === "string" && typeof r.status === "string");

  const inFlight = usable.filter((r) => !NOT_IN_FLIGHT.has(r.status));
  const declared = state.activePhase === undefined ? null : state.activePhase;

  // 1. At most ONE phase may be in flight. Two simultaneously running governed phases is itself the
  //    defect — current-state has a single `activePhase` field and could not represent it honestly.
  if (inFlight.length > 1) {
    e.push("more than one core phase record is in flight (" + inFlight.map((r) => r.phaseId + "=" + r.status).join(", ") + "); current-state.activePhase cannot represent that truthfully");
  }

  // 2. current-state must AGREE with the core records, in both directions.
  if (inFlight.length === 1) {
    const live = inFlight[0];
    if (declared !== live.phaseId) {
      e.push("current-state.activePhase is " + JSON.stringify(declared) + " but the canonical core record shows " + live.phaseId + " = " + live.status);
    }
  } else if (inFlight.length === 0 && declared !== null) {
    e.push("current-state.activePhase is " + JSON.stringify(declared) + " but no core phase record is in flight");
  }

  // 3. A phase cannot be active and complete at once.
  const completed = Array.isArray(state.completedPhases) ? state.completedPhases : [];
  if (declared !== null && completed.indexOf(declared) !== -1) {
    e.push("current-state.activePhase " + declared + " is also listed in completedPhases");
  }

  // 4. The active phase must be a phase the owner approved. The plan location is config-declared, so
  //    resolve it the way the runtime does rather than assuming the default.
  if (declared !== null) {
    let planPath = path.join(ROOT, ".projectops", "plan.json");
    try {
      const cfg = readJson(CONFIG);
      const rel = cfg.planMemory && cfg.planMemory.planPath;
      if (typeof rel === "string" && rel.length > 0) planPath = path.join(ROOT, rel);
    } catch (_) { /* fall through to the default location */ }
    try {
      const plan = readJson(planPath);
      const ids = Array.isArray(plan.phases) ? plan.phases.map((p) => p.phaseId) : [];
      if (ids.indexOf(declared) === -1) {
        e.push("current-state.activePhase " + declared + " is not a phase of the active approved plan");
      }
    } catch (x) {
      e.push("approved plan not readable for active-phase membership check: " + x.message);
    }
  }

  // 5. The session record's head must be a REAL commit reachable from HEAD. It is deliberately NOT
  //    required to equal HEAD — a session legitimately records the last accepted/pushed head while
  //    work continues — but a fabricated, future or unrelated hash must fail closed.
  const SESSION = sessionPath();
  if (fs.existsSync(SESSION)) {
    let session;
    try { session = readJson(SESSION); } catch (x) { e.push("session record is not valid JSON: " + x.message); session = null; }
    if (session) {
      const head = session.currentHead;
      if (typeof head !== "string" || !HEX40.test(head)) {
        e.push("session.currentHead is not a 40-hex commit: " + String(head));
      } else if (!gitCheck(["cat-file", "-e", head + "^{commit}"])) {
        e.push("session.currentHead does not exist in local Git: " + head);
      } else if (!gitCheck(["merge-base", "--is-ancestor", head, "HEAD"])) {
        e.push("session.currentHead is not an ancestor of or equal to HEAD: " + head);
      }
      if (typeof session.phaseId === "string" && declared !== null && session.phaseId !== declared) {
        e.push("session.phaseId " + session.phaseId + " disagrees with current-state.activePhase " + declared);
      }
    }
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[val-projectos-v3-active-phase-consistency1a] FAIL: " + x));
    process.exit(1);
  }
  console.log("val-projectos-v3-active-phase-consistency1a: PASS");
}
