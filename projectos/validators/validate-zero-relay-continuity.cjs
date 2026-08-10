"use strict";
// validate-zero-relay-continuity — the Phase-17 acceptance validator named by the approved plan.
//
// WHAT IT REFUSES TO ACCEPT. A document saying a handoff happened. A checkpoint file someone wrote.
// A replacement worker a person started. Each of those is exactly what the phase exists to remove, so
// each is a case this validator must fail, and each has a negative fixture below proving it does.
//
// WHAT IT CHECKS INSTEAD. Causality, from a ledger the runtime wrote: that the events occurred in the
// only order a real handoff can occur in, that Worker A's ownership was proven released BY A RECORDED
// REFUSAL rather than by silence, that Worker B independently OBSERVED the repository/branch/plan/
// phase/head/checkpoint and its observations MATCH both the checkpoint and the repository as it
// stands, that the instruction it received carried identifiers and no task text, and that its process
// was a child of the executor process.
//
// WHAT IT CANNOT CHECK, stated rather than implied: it cannot prove no human was present. It proves
// the replacement was started by ProjectOS code as a child of the executor, that no owner- or
// user-authored event appears in the handoff window, and that the instruction channel carried no
// prose. A person who edits the ledger JSON defeats it — as they defeat every record in this
// programme, which is MANUAL_GOVERNANCE_APPROVAL / tamperProof false throughout, with the owner
// commit gate as the backstop.
//
// SELF-TARGETING, NOT PHASE-SPECIFIC. It asks the ACTIVE APPROVED PLAN which phases require this
// validator by name and demands a passing ledger for each. No phase id appears in this file.
//
// Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ledgerLib = require("../worker/continuity-ledger.cjs");
const checkpointLib = require("../worker/checkpoint.cjs");
const CONTINUITY = path.join(ROOT, ".projectops", "continuity");
const FIXTURES = path.join(ROOT, "projectos", "examples", "zero-relay-fixtures");
const SELF = "validate-zero-relay-continuity";

const HEX40 = /^[0-9a-f]{40}$/;
const NO_PROSE = /^[A-Za-z0-9_.:\\/-]+$/;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); } catch (_) { return null; }
}

function git(args) {
  try { return execFileSync("git", ["-C", ROOT].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch (_) { return null; }
}

/** The active approved plan, resolved the way the runtime resolves it. */
function activePlan() {
  let planPath = path.join(ROOT, ".projectops", "plan.json");
  const cfg = readJson(path.join(ROOT, ".projectops", "project-config.json"));
  if (cfg && cfg.planMemory && typeof cfg.planMemory.planPath === "string" && cfg.planMemory.planPath) {
    planPath = path.join(ROOT, cfg.planMemory.planPath);
  }
  return readJson(planPath);
}

/** Ledger files: `<sessionId>.json`, excluding the sidecar records that share the directory. */
function ledgerFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !/\.(checkpoint|brief|continuation)\.json$/.test(f))
    .filter((f) => f !== "ownership.lock.json" && f !== "owner-control.json")
    .map((f) => path.join(dir, f));
}

/**
 * Judge ONE ledger. Returns error strings; [] means this ledger is a complete zero-relay proof.
 *
 * `opts.live` says whether the repository may be consulted. Fixtures are judged on their own
 * contents alone, so a negative fixture fails for the reason it was written to fail rather than
 * because it does not describe this checkout.
 */
function judgeLedger(ledger, opts) {
  const e = [];
  const live = opts && opts.live === true;
  const root = opts && opts.root ? opts.root : ROOT;

  // Z1 — shape, ordering and phase binding.
  for (const problem of ledgerLib.checkLedgerShape(ledger)) e.push("Z1 " + problem);
  if (e.length > 0) return e; // Nothing below can be trusted on a malformed ledger.
  if (opts && typeof opts.expectPhaseId === "string" && String(ledger.phaseId) !== opts.expectPhaseId) {
    e.push("Z1 ledger is bound to phase " + String(ledger.phaseId) + ", not " + opts.expectPhaseId);
  }

  const ev = (t) => ledgerLib.chainEvent(ledger, t);
  const checkpointEv = ev("worker-a-checkpoint");
  const releaseEv = ev("worker-a-release");
  const permitEv = ev("continuation-permit");
  const spawnEv = ev("executor-spawn");
  const verifyEv = ev("worker-b-verify");
  const continuationEv = ev("worker-b-continuation");

  // Z10 / Z13 — the chain must be COMPLETE. A missing spawn record, or an A that never released, is
  // the difference between a handoff and a story about one.
  const REQUIRED = [
    ["worker-a-checkpoint", checkpointEv, "Z13"],
    ["worker-a-release", releaseEv, "Z13"],
    ["continuation-permit", permitEv, "Z10"],
    ["executor-spawn", spawnEv, "Z10"],
    ["worker-b-verify", verifyEv, "Z4"],
    ["worker-b-continuation", continuationEv, "Z7"],
  ];
  for (const [name, found, code] of REQUIRED) if (found === null) e.push(code + " the ledger records no single " + name + " event");
  if (e.length > 0) return e;

  // Z2 — strict ordering. checkLedgerShape already enforces successor legality; this asserts the
  // sequence numbers really do ascend through the chain, so a reordered file cannot read as valid.
  const order = [checkpointEv, releaseEv, permitEv, spawnEv, verifyEv, continuationEv];
  for (let i = 1; i < order.length; i++) {
    if (!(order[i].seq > order[i - 1].seq)) e.push("Z2 " + order[i].type + " does not follow " + order[i - 1].type);
    if (order[i].at < order[i - 1].at) e.push("Z2 " + order[i].type + " is timestamped before " + order[i - 1].type);
  }

  // Z3 — ownership proven by a RECORDED REFUSAL. Silence is not ownership.
  const refusals = ledgerLib.eventsOfType(ledger, "worker-a-post-release-write-refused");
  if (refusals.length === 0) {
    e.push("Z3 no post-release write attempt by Worker A was refused; a worker that merely stopped is not a worker that was prevented");
  } else {
    const r = refusals[0];
    if (r.seq < releaseEv.seq) e.push("Z3 the refused write attempt precedes the release it is supposed to prove");
    if (typeof r.detail.refusal !== "string" || r.detail.refusal.indexOf("refused") === -1) {
      e.push("Z3 the recorded refusal does not carry the refusal message");
    }
  }

  // Two DISTINCT workers, and Worker B is a child of the executor.
  const aId = String(checkpointEv.actor.workerId);
  const bId = String(verifyEv.actor.workerId);
  if (aId === bId || aId === "null" || bId === "null") e.push("Z2 Worker A and Worker B are not two distinct identified workers");
  if (checkpointEv.actor.pid === verifyEv.actor.pid) e.push("Z2 Worker A and Worker B ran in the same process");
  if (spawnEv.detail.childPid !== verifyEv.actor.pid) {
    e.push("Z11 the process that verified is not the process the executor spawned (" + String(spawnEv.detail.childPid) + " vs " + String(verifyEv.actor.pid) + ")");
  }
  if (verifyEv.actor.parentPid !== spawnEv.detail.executorPid) {
    e.push("Z11 Worker B's parent is " + String(verifyEv.actor.parentPid) + ", not the executor process " + String(spawnEv.detail.executorPid) + " — a manually started worker has a different parent");
  }
  if (spawnEv.author !== "executor") e.push("Z11 the spawn was not authored by the executor but by " + String(spawnEv.author));

  // Z5 — the instruction channel carries identifiers only.
  const argv = Array.isArray(spawnEv.detail.argv) ? spawnEv.detail.argv : null;
  if (argv === null) e.push("Z5 the spawn record does not carry the argv the worker was given");
  else {
    for (const a of argv) {
      if (typeof a !== "string") { e.push("Z5 the spawn argv contains a non-string"); continue; }
      if (a.startsWith("--")) continue;
      if (!NO_PROSE.test(a) || /\s/.test(a)) e.push("Z5 the spawn argv carries free text: " + JSON.stringify(a));
    }
  }
  if (spawnEv.detail.instructionProvenance !== "durable-state") {
    e.push("Z6 the spawn does not record durable-state instruction provenance");
  }
  if (verifyEv.detail.instructionProvenance !== "durable-state" || verifyEv.detail.receivedTaskText !== false) {
    e.push("Z6 Worker B does not record that its instruction came from durable state and carried no task text");
  }

  // Z6 / Z14 — no owner- or user-authored event inside the handoff window.
  const from = checkpointEv.seq;
  const to = continuationEv.seq;
  for (const x of ledger.events) {
    if (x.seq < from || x.seq > to) continue;
    if (x.author === "owner" || x.author === "user") {
      e.push("Z14 an " + x.author + "-authored event appears inside the handoff window at seq " + x.seq + " (" + x.type + ")");
    }
    if (x.type === "input-event") {
      e.push("Z14 an external input event appears inside the handoff window at seq " + x.seq);
    }
  }

  // Z4 / Z12 — Worker B's OWN observations must match the checkpoint, field by field.
  const observed = verifyEv.detail.observed || {};
  const expected = verifyEv.detail.expected || {};
  if (verifyEv.detail.verified !== true) e.push("Z4 Worker B did not record a successful verification");
  if (Array.isArray(verifyEv.detail.mismatches) && verifyEv.detail.mismatches.length > 0) {
    e.push("Z12 Worker B recorded context mismatches: " + verifyEv.detail.mismatches.join("; "));
  }
  for (const field of ["repositoryRoot", "branch", "head", "planVersion", "phaseId", "checkpointId"]) {
    if (observed[field] === undefined || expected[field] === undefined) {
      e.push("Z4 Worker B recorded no " + field + " observation");
    } else if (String(observed[field]) !== String(expected[field])) {
      e.push("Z12 Worker B observed " + field + " " + JSON.stringify(observed[field]) + " but the checkpoint says " + JSON.stringify(expected[field]));
    }
  }
  if (!HEX40.test(String(expected.head))) e.push("Z4 the checkpoint head is not a 40-hex commit");
  if (String(expected.checkpointId) !== String(checkpointEv.detail.checkpointId)) {
    e.push("Z4 Worker B resumed checkpoint " + String(expected.checkpointId) + ", not the one Worker A wrote (" + String(checkpointEv.detail.checkpointId) + ")");
  }

  // Z7 — one bounded continuation, actually performed, canonical state updated.
  if (String(continuationEv.detail.action) !== String(checkpointEv.detail.nextActionKind)) {
    e.push("Z7 Worker B performed '" + String(continuationEv.detail.action) + "', not the stored next action '" + String(checkpointEv.detail.nextActionKind) + "'");
  }
  if (checkpointLib.continuationProblem({ kind: String(continuationEv.detail.action), params: { note: "x" } }) !== null &&
      !Object.prototype.hasOwnProperty.call(checkpointLib.CONTINUATION_KINDS, String(continuationEv.detail.action))) {
    e.push("Z7 the continuation performed is not on the allowlist: " + String(continuationEv.detail.action));
  }
  if (typeof continuationEv.detail.canonicalStateUpdated !== "string" || continuationEv.detail.canonicalStateUpdated.length === 0) {
    e.push("Z7 the continuation records no canonical state update");
  }

  // Z8 / Z9 — the boundaries survived the handoff, PROVEN by refusals rather than assumed.
  const protectedRefusals = ledgerLib.eventsOfType(ledger, "protected-action-refused");
  if (protectedRefusals.length === 0) {
    e.push("Z8 no protected action was attempted after the handoff, so the protected-action boundary is untested — the criterion requires it to be PROVEN to survive");
  } else if (protectedRefusals.every((x) => x.seq < spawnEv.seq)) {
    e.push("Z8 every protected-action refusal predates the spawn, so none of them tests the post-handoff boundary");
  }
  // Live consistency: the repository as it stands must still agree with what Worker B observed.
  if (live) {
    const head = git(["rev-parse", "HEAD"]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (head === null) e.push("Z4 HEAD could not be established to cross-check the ledger");
    else if (String(observed.head) !== head) {
      e.push("Z4 the proof was made at " + String(observed.head).slice(0, 7) + " but HEAD is now " + head.slice(0, 7) + "; re-run the proof at the evidence subject");
    }
    if (branch !== null && String(observed.branch) !== branch) e.push("Z4 the proof was made on branch " + String(observed.branch) + ", not " + branch);

    // The checkpoint Worker B claims to have resumed must still exist and still say the same thing.
    const cp = checkpointLib.readCheckpoint(root, String(ledger.sessionId));
    if (cp === null) e.push("Z4 the durable checkpoint for this session is absent");
    else {
      for (const problem of checkpointLib.checkCheckpointShape(cp)) e.push("Z4 checkpoint: " + problem);
      if (String(cp.checkpointId) !== String(expected.checkpointId)) e.push("Z4 the stored checkpoint id no longer matches the one that was resumed");
      if (String(cp.head) !== String(expected.head)) e.push("Z4 the stored checkpoint head no longer matches the one that was resumed");
    }
    // And the continuation must have left the durable artefact it claims.
    const produced = path.join(root, String(continuationEv.detail.canonicalStateUpdated));
    if (!fs.existsSync(produced)) e.push("Z7 the canonical artefact the continuation claims to have written does not exist: " + String(continuationEv.detail.canonicalStateUpdated));
  }

  return e;
}

/**
 * Z9 — owner pause/stop authority survives the handoff, proven in its own ledger.
 *
 * It cannot be proven inside a completed handoff, and pretending otherwise would be the dishonest
 * option: if the owner's stop is genuinely honoured then the continuation does NOT happen, so a
 * ledger cannot both show a stop being obeyed and show the work continuing. A worker that wrote the
 * owner's control file to stage a "stop" would be forging owner authority to prove owner authority.
 *
 * So the proof is a second, separate run: the owner stops the project after the permit is recorded,
 * and the executor's LAST check — the one taken immediately before the spawn — refuses. The absence
 * of an `executor-spawn` event in that ledger is the point: nothing was started.
 */
function judgeOwnerStop(ledger) {
  const e = [];
  for (const problem of ledgerLib.checkLedgerShape(ledger)) e.push("Z9 " + problem);
  if (e.length > 0) return e;

  const permit = ledgerLib.chainEvent(ledger, "continuation-permit");
  if (permit === null) e.push("Z9 the owner-stop ledger records no continuation-permit, so nothing was ever close to starting");
  if (ledgerLib.eventsOfType(ledger, "executor-spawn").length > 0) {
    e.push("Z9 a worker WAS spawned despite the owner stop; this ledger does not prove the stop was honoured");
  }
  const honoured = ledgerLib.eventsOfType(ledger, "owner-control-honoured");
  if (honoured.length === 0) {
    e.push("Z9 no owner-control-honoured event: the stop is not recorded as having been obeyed");
    return e;
  }
  const last = honoured[honoured.length - 1];
  if (last.author !== "executor") e.push("Z9 the stop was honoured by " + String(last.author) + ", not the executor that would have spawned");
  if (String(last.detail.at) !== "immediately before spawn") {
    e.push("Z9 the stop was honoured at '" + String(last.detail.at) + "', not immediately before the spawn — a stop read early and acted on late leaves a window");
  }
  if (permit !== null && last.seq < permit.seq) {
    e.push("Z9 the stop was honoured before the continuation was ever permitted, so it did not stop anything");
  }
  if (["paused", "stopped"].indexOf(String(last.detail.state)) === -1) {
    e.push("Z9 the honoured owner state is " + JSON.stringify(last.detail.state) + ", which is not a pause or a stop");
  }
  return e;
}

/**
 * Negative fixtures: each MUST be caught, and caught FOR ITS OWN REASON.
 *
 * The needle matters more than the count. A fixture that fails for an unrelated reason — a typo, a
 * missing field — would still "be caught", and the check would pass while proving nothing about the
 * property the fixture was written to attack.
 */
function fixtures(e) {
  const expected = [
    ["no-spawn-record.json", "expected executor-spawn", "Z10 a ledger with no executor-spawn event"],
    ["owner-started-worker.json", "not the executor process", "Z11 a replacement whose parent is not the executor"],
    ["worker-b-facts-diverge.json", "but the checkpoint says", "Z12 Worker B observing a different world from the checkpoint"],
    ["a-never-released.json", "expected worker-a-release", "Z13 Worker A never releasing ownership"],
    ["owner-prompt-in-window.json", "inside the handoff window", "Z14 an owner-authored event inside the handoff window"],
    ["spawn-carries-task-text.json", "carries free text", "Z5 a spawn argv carrying a task description"],
    ["silence-instead-of-refusal.json", "not a worker that was prevented", "Z3 ownership claimed by silence"],
    ["protected-boundary-untested.json", "boundary is untested", "Z8 no protected action attempted after the handoff"],
  ];
  if (!fs.existsSync(FIXTURES)) { e.push("missing zero-relay negative fixtures directory"); return; }
  for (const [file, needle, why] of expected) {
    const p = path.join(FIXTURES, file);
    const led = readJson(p);
    if (led === null) { e.push("negative fixture missing or unreadable: " + file); continue; }
    const errs = judgeLedger(led, { live: false });
    if (errs.length === 0) { e.push("negative fixture PASSED and must not have (" + why + "): " + file); continue; }
    if (!errs.some((x) => x.indexOf(needle) !== -1)) {
      e.push("negative fixture " + file + " was caught for the wrong reason (wanted '" + needle + "'): " + errs.join("; "));
    }
  }
  // The positive fixtures prove the judges can pass at all, so the negatives are not passing vacuously.
  const good = readJson(path.join(FIXTURES, "complete-handoff.json"));
  if (good === null) e.push("missing the positive zero-relay fixture");
  else {
    const errs = judgeLedger(good, { live: false });
    if (errs.length > 0) e.push("the positive fixture does not satisfy the judge: " + errs.join("; "));
  }
  const stop = readJson(path.join(FIXTURES, "owner-stop-honoured.json"));
  if (stop === null) e.push("missing the positive owner-stop fixture");
  else {
    const errs = judgeOwnerStop(stop);
    if (errs.length > 0) e.push("the positive owner-stop fixture does not satisfy the judge: " + errs.join("; "));
  }
  // And an owner-stop ledger that DID spawn must be caught — otherwise Z9 would accept a stop that
  // was recorded and then ignored, which is the exact failure it exists to detect.
  const ignored = readJson(path.join(FIXTURES, "owner-stop-ignored.json"));
  if (ignored === null) e.push("missing the owner-stop-ignored negative fixture");
  else {
    const errs = judgeOwnerStop(ignored);
    if (!errs.some((x) => x.indexOf("a worker WAS spawned despite the owner stop") !== -1)) {
      e.push("an owner stop that was recorded and then ignored was not caught: " + errs.join("; "));
    }
  }
}

function run() {
  const e = [];
  fixtures(e);

  // Which phases require this validator by name? Ask the plan; never assume a phase id.
  const plan = activePlan();
  if (plan === null) { e.push("the active approved plan could not be read"); return e; }
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  const requiring = phases
    .filter((p) => p && Array.isArray(p.requiredValidators) && p.requiredValidators.indexOf(SELF) !== -1)
    .map((p) => String(p.phaseId));
  if (requiring.length === 0) {
    // Nothing in the active plan demands a zero-relay proof, so there is nothing to prove. The
    // fixtures above still ran, so the judge itself stays under test.
    return e;
  }

  const files = ledgerFiles(CONTINUITY);
  for (const phaseId of requiring) {
    const forPhase = files
      .map((f) => ({ file: f, ledger: readJson(f) }))
      .filter((x) => x.ledger !== null && String(x.ledger.phaseId) === phaseId);
    if (forPhase.length === 0) {
      e.push("phase " + phaseId + " requires " + SELF + " but no continuity ledger for it exists under .projectops/continuity/");
      continue;
    }
    // TWO proofs are required, and neither substitutes for the other: one complete handoff, and one
    // owner stop that was honoured at the last possible moment.
    const handoffs = forPhase.map((x) => ({ file: path.basename(x.file), errors: judgeLedger(x.ledger, { live: true, root: ROOT, expectPhaseId: phaseId }) }));
    if (!handoffs.some((x) => x.errors.length === 0)) {
      const closest = handoffs.slice().sort((a, b) => a.errors.length - b.errors.length)[0];
      e.push("phase " + phaseId + " has no COMPLETE zero-relay handoff proof; closest ledger " + closest.file + " fails: " + closest.errors.join("; "));
    }
    const stops = forPhase.map((x) => ({ file: path.basename(x.file), errors: judgeOwnerStop(x.ledger) }));
    if (!stops.some((x) => x.errors.length === 0)) {
      const closest = stops.slice().sort((a, b) => a.errors.length - b.errors.length)[0];
      e.push("phase " + phaseId + " has no proof that an owner stop is honoured across the handoff; closest ledger " + closest.file + " fails: " + closest.errors.join("; "));
    }
  }
  return e;
}

module.exports = { run, judgeLedger, judgeOwnerStop, ledgerFiles };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[" + SELF + "] FAIL: " + x));
    process.exit(1);
  }
  console.log(SELF + ": PASS");
}
