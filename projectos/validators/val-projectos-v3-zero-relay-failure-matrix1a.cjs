"use strict";
// Validator: PROJECTOS-V3-ZERO-RELAY-FAILURE-MATRIX1A
//
// The happy path is proven once, live, by the acceptance run. THIS proves the twenty-one ways a
// handoff can go wrong, because a continuation mechanism is only as trustworthy as its refusals: the
// dangerous outcome is not "the handoff failed", it is "the handoff succeeded when it should not
// have" — two writers, a resume onto the wrong tree, a continuation that ran after the owner said
// stop.
//
// Every case runs against a REAL disposable git repository in scratch, with real processes where a
// process is what is under test. Nothing here is a mock of the thing being tested; the modules under
// test are the ones the live proof used.
//
// Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const scratch = require("./lib/scratch.cjs");
const ledgerLib = require(path.join(ROOT, "projectos", "worker", "continuity-ledger.cjs"));
const lockLib = require(path.join(ROOT, "projectos", "worker", "ownership-lock.cjs"));
const ownerLib = require(path.join(ROOT, "projectos", "worker", "owner-control.cjs"));
const cpLib = require(path.join(ROOT, "projectos", "worker", "checkpoint.cjs"));
const executor = require(path.join(ROOT, "projectos", "worker", "zero-relay-executor.cjs"));
const WORKER = path.join(ROOT, "projectos", "worker", "worker-runtime.cjs");

const PROJECT = "matrix-project";
const PHASE = "MATRIX-PHASE1A";
const SESSION = "sess_matrix";

function git(dir, args) {
  return execFileSync("git", ["-C", dir].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** A real, disposable, committed git repository with a governed ProjectOS shape. */
function makeRepo(dir) {
  git(dir, ["init", "--initial-branch=matrix-main"]);
  git(dir, ["config", "user.email", "matrix@example.invalid"]);
  git(dir, ["config", "user.name", "Matrix"]);
  fs.mkdirSync(path.join(dir, ".projectops", "phases"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".projectops", "project-config.json"),
    JSON.stringify({ projectId: PROJECT, planMemory: { planPath: ".projectops/plan.json" } }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, ".projectops", "plan.json"),
    JSON.stringify({ projectId: PROJECT, planVersion: "9.9", phases: [{ phaseId: PHASE, description: "matrix", requiredValidators: [] }] }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, ".projectops", "phases", PHASE + ".json"),
    JSON.stringify({ phaseId: PHASE, project: PROJECT, objective: "matrix", status: "implementing", history: [] }, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(dir, "README.md"), "matrix\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "matrix baseline"]);
  return { head: git(dir, ["rev-parse", "HEAD"]), branch: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]) };
}

function freshLedger(dir, sessionId, facts) {
  const p = ledgerLib.ledgerPath(dir, sessionId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  ledgerLib.createLedger(dir, {
    sessionId: sessionId, projectId: PROJECT, phaseId: PHASE,
    repositoryRoot: path.resolve(dir), branch: facts.branch,
  });
}

/**
 * Advance a ledger to a given point in the chain, the way the real components would.
 *
 * The chain refuses events that are not legal successors, so a case that starts a worker must first
 * put the ledger where the real flow would have put it. This is what makes case 21 meaningful: a
 * hand-started worker is one whose ledger has NO spawn, and that is not a detail of the fixture — it
 * is the situation itself.
 */
function advanceTo(dir, sessionId, stage, facts) {
  const ev = (type, author, module_, detail) =>
    ledgerLib.appendEvent(dir, sessionId, { type: type, author: author, module: module_, workerId: "matrix", detail: detail || {} });
  ev("worker-a-checkpoint", "worker", "matrix-worker-a", { checkpointId: "cp-matrix", head: facts.head, nextActionKind: "record-continuation-note" });
  if (stage === "checkpoint") return;
  ev("worker-a-release", "worker", "matrix-worker-a", { released: true });
  if (stage === "release") return;
  ev("continuation-permit", "executor", "matrix-executor", { decision: "permitted" });
  if (stage === "permit") return;
  ev("executor-spawn", "executor", "matrix-executor", {
    childPid: 1, executorPid: process.pid, argv: ["--resume"], instructionProvenance: "durable-state", carriesTaskText: false,
  });
}

function writeCheckpoint(dir, facts, over) {
  return cpLib.writeCheckpoint(dir, Object.assign({
    sessionId: SESSION, projectId: PROJECT, phaseId: PHASE, planVersion: "9.9",
    repositoryRoot: path.resolve(dir), branch: facts.branch, head: facts.head,
    checkpointId: "cp-matrix", writtenBy: "worker-a-matrix",
    nextSafeAction: { kind: "record-continuation-note", params: { note: "continue" } },
  }, over || {}));
}

/** A permitted planner spec, so the executor's own gates are what each case actually exercises. */
function spec(over) {
  return Object.assign({
    projectId: PROJECT, phaseId: PHASE, decision: "READY_TO_LAUNCH", permitted: true, executed: false,
  }, over || {});
}

function evaluate(dir, over) {
  return executor.evaluateContinuation(dir, Object.assign({ sessionId: SESSION, projectId: PROJECT, launchSpec: spec() }, over || {}));
}

/** Assert a refusal happened AND that it names the right thing. */
function refuses(e, label, verdict, needle) {
  if (verdict.permitted) { e.push(label + ": PERMITTED and must not have been"); return; }
  if (!verdict.refusals.some((r) => r.indexOf(needle) !== -1)) {
    e.push(label + ": refused for the wrong reason (wanted '" + needle + "'): " + verdict.refusals.join("; "));
  }
}

function runMatrix(dir, e) {
  const facts = makeRepo(dir);

  // 1 NORMAL — the baseline. Without this every refusal below could be a false positive.
  freshLedger(dir, SESSION, facts);
  writeCheckpoint(dir, facts);
  if (!evaluate(dir).permitted) e.push("1 normal: a clean, released, permitted continuation was refused: " + evaluate(dir).refusals.join("; "));

  // 2 CRASH AFTER CHECKPOINT — the checkpoint exists and the lock is stale with a dead pid. The
  //   continuation is still refused until ownership is actually released: a crashed worker's lock is
  //   not an invitation, it is a stuck checkout that a human or a takeover must resolve.
  lockLib.acquire(dir, "worker-a-crashed", {});
  const stuck = JSON.parse(fs.readFileSync(lockLib.lockPath(dir), "utf8"));
  stuck.holder.pid = 999999; // a pid that is not running
  stuck.heartbeatAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  fs.writeFileSync(lockLib.lockPath(dir), JSON.stringify(stuck, null, 2));
  refuses(e, "2 crash after checkpoint", evaluate(dir), "still owned by");
  //   …and takeover is explicit, never implicit.
  const noTakeover = lockLib.acquire(dir, "worker-b-matrix", {});
  if (noTakeover.acquired) e.push("2 crash after checkpoint: a stale lock was taken over WITHOUT an explicit takeover");
  const withTakeover = lockLib.acquire(dir, "worker-b-matrix", { takeover: true });
  if (!withTakeover.acquired) e.push("2 crash after checkpoint: an explicit takeover of a dead holder was refused: " + withTakeover.reason);
  if (withTakeover.acquired && (withTakeover.lock.tookOverFrom === null)) e.push("2 crash after checkpoint: the takeover did not record who it displaced");
  lockLib.release(dir, "worker-b-matrix");

  // 3 CRASH BEFORE CHECKPOINT — nothing to resume from.
  const cpPath = cpLib.checkpointPath(dir, SESSION);
  const savedCp = fs.readFileSync(cpPath, "utf8");
  fs.unlinkSync(cpPath);
  refuses(e, "3 crash before checkpoint", evaluate(dir), "no durable checkpoint");
  fs.writeFileSync(cpPath, savedCp);

  // 4 STALE CHECKPOINT / 5 WRONG HEAD — the tree moved on after the checkpoint was written.
  writeCheckpoint(dir, facts, { head: "0".repeat(40) });
  refuses(e, "4/5 stale checkpoint and head mismatch", evaluate(dir), "stale checkpoint");
  writeCheckpoint(dir, facts);

  // 6 DIRTY CHECKOUT — a continuation must not resume onto unexplained changes.
  fs.writeFileSync(path.join(dir, "unexplained.txt"), "someone was here\n");
  refuses(e, "6 dirty checkout", evaluate(dir), "outside the handoff's own records");
  fs.unlinkSync(path.join(dir, "unexplained.txt"));
  //   …but the handoff's OWN records do not count as dirt, or the mechanism could never run twice.
  if (!evaluate(dir).permitted) e.push("6 dirty checkout: the handoff's own continuity records were treated as unexplained changes");

  // 7 WRONG BRANCH
  writeCheckpoint(dir, facts, { branch: "some-other-branch" });
  refuses(e, "7 wrong branch", evaluate(dir), "checkpoint expects");
  writeCheckpoint(dir, facts);

  // 8 WRONG REPO — a checkpoint written for another checkout.
  writeCheckpoint(dir, facts, { repositoryRoot: path.join(dir, "..", "elsewhere") });
  refuses(e, "8 wrong repo", evaluate(dir), "different checkout");
  writeCheckpoint(dir, facts);

  // 9 WRONG PROJECT
  writeCheckpoint(dir, facts, { projectId: "some-other-project" });
  refuses(e, "9 wrong project", evaluate(dir), "checkpoint names project");
  writeCheckpoint(dir, facts);

  // 10 WRONG SESSION — a spec for a different phase cannot drive this session's checkpoint.
  refuses(e, "10 wrong session/phase", evaluate(dir, { launchSpec: spec({ phaseId: "SOME-OTHER-PHASE1A" }) }), "does not match the launch spec phase");
  //    …and a spec for another project is refused before anything else is considered.
  refuses(e, "10 wrong project spec", evaluate(dir, { launchSpec: spec({ projectId: "elsewhere" }) }), "launch spec is for project");

  // 11 DUPLICATE WORKER — a live holder is never displaced.
  const held = lockLib.acquire(dir, "worker-live", {});
  if (!held.acquired) e.push("11 duplicate worker: could not acquire a free lock");
  const second = lockLib.acquire(dir, "worker-second", {});
  if (second.acquired) e.push("11 duplicate worker: a SECOND writer acquired a lock held by a live process");
  if (!second.acquired && second.reason.indexOf("still running") === -1) e.push("11 duplicate worker: refusal does not say the holder is alive: " + second.reason);
  refuses(e, "11 duplicate worker (executor)", evaluate(dir), "still owned by");
  lockLib.release(dir, "worker-live");

  // 12 DUPLICATE HANDOFF REQUEST — the ledger's chain cannot record two handoffs.
  ledgerLib.appendEvent(dir, SESSION, { type: "worker-a-checkpoint", author: "worker", module: "matrix", workerId: "a", detail: {} });
  let duplicated = null;
  try { ledgerLib.appendEvent(dir, SESSION, { type: "worker-a-checkpoint", author: "worker", module: "matrix", workerId: "a", detail: {} }); }
  catch (err) { duplicated = err.message; }
  if (duplicated === null) e.push("12 duplicate handoff: a second checkpoint event was accepted into the same chain");
  else if (duplicated.indexOf("out of order") === -1) e.push("12 duplicate handoff: refused for the wrong reason: " + duplicated);

  // 13 REPLACEMENT LAUNCH FAILURE — a worker started with no resumable state exits non-zero and
  //    does not proceed. Real process, real exit code.
  const noState = spawnSync(process.execPath, [WORKER, "--resume", "--root", dir, "--project", PROJECT, "--session", "no-such-session"], { encoding: "utf8" });
  if (noState.status === 0) e.push("13 replacement launch failure: a worker with no checkpoint exited 0");
  if (String(noState.stderr).indexOf("no checkpoint") === -1) e.push("13 replacement launch failure: stderr does not say why: " + String(noState.stderr).trim());

  // 14 REPLACEMENT CANNOT LOAD STATE — the checkpoint exists but describes another world. The worker
  //    must refuse AFTER verifying, not proceed on the strength of having found a file.
  freshLedger(dir, "sess_matrix_ctx", facts);
  advanceTo(dir, "sess_matrix_ctx", "spawn", facts);
  cpLib.writeCheckpoint(dir, {
    sessionId: "sess_matrix_ctx", projectId: PROJECT, phaseId: PHASE, planVersion: "0.0",
    repositoryRoot: path.resolve(dir), branch: facts.branch, head: facts.head,
    checkpointId: "cp-ctx", writtenBy: "worker-a-matrix",
    nextSafeAction: { kind: "record-continuation-note", params: { note: "n" } },
  });
  const wrongCtx = spawnSync(process.execPath, [WORKER, "--resume", "--root", dir, "--project", PROJECT, "--session", "sess_matrix_ctx"], { encoding: "utf8" });
  if (wrongCtx.status === 0) e.push("14 replacement cannot load state: a worker resumed against a mismatched plan version");
  if (String(wrongCtx.stderr).indexOf("context mismatch") === -1) e.push("14 replacement cannot load state: stderr does not name the mismatch: " + String(wrongCtx.stderr).trim());
  const ctxLedger = ledgerLib.readLedger(dir, "sess_matrix_ctx");
  const verifyEv = ledgerLib.chainEvent(ctxLedger, "worker-b-verify");
  if (verifyEv === null || verifyEv.detail.verified !== false) e.push("14 replacement cannot load state: the failed verification was not recorded");

  // 15 OLD WORKER WRITES AFTER RELEASE — the ownership guarantee itself.
  lockLib.acquire(dir, "worker-old", {});
  lockLib.release(dir, "worker-old");
  let afterRelease = null;
  try { lockLib.assertOwner(dir, "worker-old"); } catch (err) { afterRelease = err.message; }
  if (afterRelease === null) e.push("15 old worker writes after release: a released worker was still permitted to write");
  else if (afterRelease.indexOf("may no longer write") === -1) e.push("15 old worker writes after release: refusal is not the ownership refusal: " + afterRelease);
  //    A displaced worker is refused too, not just a released one.
  lockLib.acquire(dir, "worker-new", {});
  let displaced = null;
  try { lockLib.assertOwner(dir, "worker-old"); } catch (err) { displaced = err.message; }
  if (displaced === null) e.push("15 old worker writes after release: a DISPLACED worker was still permitted to write");
  lockLib.release(dir, "worker-new");

  // 16 OWNER PAUSE BEFORE PERMIT
  ownerLib.set(dir, "paused", "owner");
  refuses(e, "16 owner pause before permit", evaluate(dir), "owner has paused");
  //    A malformed control file is a STOP, not a shrug.
  fs.writeFileSync(ownerLib.controlPath(dir), "{ not json");
  refuses(e, "16 malformed owner control", evaluate(dir), "unreadable");
  fs.unlinkSync(ownerLib.controlPath(dir));

  // 17 OWNER STOP IMMEDIATELY BEFORE SPAWN — the S15 window. The stop lands after every gate has
  //    passed; nothing may be spawned, and the honoured stop must be recorded.
  freshLedger(dir, SESSION, facts);
  advanceTo(dir, SESSION, "release", facts);
  writeCheckpoint(dir, facts);
  const stopped = executor.continueSession(dir, {
    sessionId: SESSION, projectId: PROJECT, launchSpec: spec(),
    onPermitted: () => { ownerLib.set(dir, "stopped", "owner"); },
  });
  if (stopped.spawned) e.push("17 owner stop before spawn: a worker was STARTED after the owner stopped the project");
  const stopLedger = ledgerLib.readLedger(dir, SESSION);
  if (ledgerLib.eventsOfType(stopLedger, "executor-spawn").length > 0) e.push("17 owner stop before spawn: a spawn was recorded despite the stop");
  const honoured = ledgerLib.eventsOfType(stopLedger, "owner-control-honoured");
  if (honoured.length === 0) e.push("17 owner stop before spawn: the honoured stop was not recorded");
  else if (String(honoured[0].detail.at) !== "immediately before spawn") e.push("17 owner stop before spawn: recorded at the wrong point: " + String(honoured[0].detail.at));
  fs.unlinkSync(ownerLib.controlPath(dir));

  // 18 PROTECTED ACTION NEXT — a checkpoint may not even STORE one, and the gate names what it is.
  for (const [kind, needle] of [["deploy-production", "PROHIBITED"], ["close-phase", "OWNER-GATED"], ["rm -rf /", "not on the continuation allowlist"]]) {
    const problem = cpLib.continuationProblem({ kind: kind, params: {} });
    if (problem === null) e.push("18 protected action next: '" + kind + "' was accepted as a continuation");
    else if (problem.indexOf(needle) === -1) e.push("18 protected action next: '" + kind + "' refused without naming it as " + needle + ": " + problem);
    let stored = null;
    try { writeCheckpoint(dir, facts, { nextSafeAction: { kind: kind, params: {} } }); } catch (err) { stored = err.message; }
    if (stored === null) e.push("18 protected action next: a checkpoint STORED an unperformable action '" + kind + "'");
  }
  writeCheckpoint(dir, facts);

  // 19 NO nextSafeAction
  for (const bad of [undefined, null, {}, { kind: "record-continuation-note" }, { kind: "record-continuation-note", params: { note: "" } }]) {
    if (cpLib.continuationProblem(bad) === null) e.push("19 no next action: " + JSON.stringify(bad) + " was accepted as a continuation");
  }

  // 20 MALFORMED LEDGER — every structural corruption is caught by the shared shape check.
  const good = ledgerLib.readLedger(dir, SESSION);
  const mutations = [
    ["schemaVersion", (l) => { l.schemaVersion = "0.1"; }],
    ["sessionId", (l) => { l.sessionId = "../escape"; }],
    ["events not an array", (l) => { l.events = {}; }],
    ["seq renumbered", (l) => { if (l.events[0]) l.events[0].seq = 7; }],
    ["time goes backwards", (l) => { if (l.events[1]) l.events[1].at = "2000-01-01T00:00:00.000Z"; }],
    ["unknown author", (l) => { if (l.events[0]) l.events[0].author = "stranger"; }],
    ["no actor", (l) => { if (l.events[0]) delete l.events[0].actor; }],
    ["reordered chain", (l) => { l.events = l.events.slice().reverse().map((x, i) => Object.assign({}, x, { seq: i + 1 })); }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = JSON.parse(JSON.stringify(good));
    mutate(copy);
    if (ledgerLib.checkLedgerShape(copy).length === 0) e.push("20 malformed ledger: mutation survived unchecked — " + label);
  }

  // 21 MANUAL / OWNER-STARTED WORKER B — the strongest form of this case. A hand-started worker has
  //    no `executor-spawn` before it, so the ledger's chain will not accept its first event at all:
  //    it cannot enter the record, let alone finish. It must say so and stop, and NOTHING may be
  //    written. This is stronger than "the judge rejects the ledger afterwards".
  freshLedger(dir, "sess_matrix_manual", facts);
  advanceTo(dir, "sess_matrix_manual", "permit", facts); // permitted, but nothing spawned
  cpLib.writeCheckpoint(dir, {
    sessionId: "sess_matrix_manual", projectId: PROJECT, phaseId: PHASE, planVersion: "9.9",
    repositoryRoot: path.resolve(dir), branch: facts.branch, head: facts.head,
    checkpointId: "cp-manual", writtenBy: "worker-a-matrix",
    nextSafeAction: { kind: "record-continuation-note", params: { note: "started by hand" } },
  });
  const manual = spawnSync(process.execPath, [WORKER, "--resume", "--root", dir, "--project", PROJECT, "--session", "sess_matrix_manual"], { encoding: "utf8" });
  if (manual.status === 0) e.push("21 manual worker: a hand-started replacement ran to completion");
  if (String(manual.stderr).indexOf("cannot enter the handoff record") === -1) {
    e.push("21 manual worker: the refusal does not say the worker could not enter the record: " + String(manual.stderr).trim().split("\n")[0]);
  }
  const manualLedger = ledgerLib.readLedger(dir, "sess_matrix_manual");
  if (ledgerLib.eventsOfType(manualLedger, "worker-b-verify").length > 0) {
    e.push("21 manual worker: a hand-started worker wrote itself into the handoff record");
  }
  if (ledgerLib.eventsOfType(manualLedger, "worker-b-continuation").length > 0) {
    e.push("21 manual worker: a hand-started worker performed the continuation");
  }
  // And the judge rejects the ledger it leaves behind, so neither control depends on the other.
  const judge = require("./validate-zero-relay-continuity.cjs");
  const verdict = judge.judgeLedger(manualLedger, { live: false });
  if (verdict.length === 0) e.push("21 manual worker: the judge ACCEPTED a ledger with no spawn and no verification");

  // A worker takes no task, in either mode — the instruction channel does not exist.
  const withTask = spawnSync(process.execPath, [WORKER, "--root", dir, "--project", PROJECT, "--session", SESSION, "--task", "do something else"], { encoding: "utf8" });
  if (withTask.status === 0) e.push("worker accepted an invocation carrying a --task argument");

  /* ---------------------------------------------------------------------------------------------
   * Cases added after the Phase-17 security and code review. Each is a defect the review FOUND, so
   * each gets a case: a fix without a test that would have caught it is a fix that can regress.
   * ------------------------------------------------------------------------------------------- */

  // 22 OWNER STOP BETWEEN VERIFICATION AND THE CONTINUATION. The review reproduced an uncaught
  //    throw here: the ledger correctly refuses `worker-b-release` when the continuation never
  //    happened, and that refusal escaped a `finally`, discarding the pending return. A governed
  //    refusal must come back as an exit code, never as a stack trace.
  freshLedger(dir, "sess_matrix_stopmid", facts);
  advanceTo(dir, "sess_matrix_stopmid", "spawn", facts);
  cpLib.writeCheckpoint(dir, {
    sessionId: "sess_matrix_stopmid", projectId: PROJECT, phaseId: PHASE, planVersion: "9.9",
    repositoryRoot: path.resolve(dir), branch: facts.branch, head: facts.head,
    checkpointId: "cp-stopmid", writtenBy: "worker-a-matrix",
    nextSafeAction: { kind: "record-continuation-note", params: { note: "must not run" } },
  });
  ownerLib.set(dir, "stopped", "owner");
  const stopMid = spawnSync(process.execPath, [WORKER, "--resume", "--root", dir, "--project", PROJECT, "--session", "sess_matrix_stopmid"], { encoding: "utf8" });
  fs.unlinkSync(ownerLib.controlPath(dir));
  if (stopMid.status !== 3) e.push("22 owner stop mid-resume: expected the governed exit code 3, got " + String(stopMid.status));
  if (String(stopMid.stderr).indexOf("Error:") !== -1 || String(stopMid.stderr).indexOf("    at ") !== -1) {
    e.push("22 owner stop mid-resume: the refusal surfaced as a stack trace: " + String(stopMid.stderr).trim().split("\n")[0]);
  }
  const midLedger = ledgerLib.readLedger(dir, "sess_matrix_stopmid");
  if (ledgerLib.eventsOfType(midLedger, "worker-b-continuation").length > 0) e.push("22 owner stop mid-resume: the continuation ran anyway");
  if (ledgerLib.eventsOfType(midLedger, "owner-control-honoured").length === 0) e.push("22 owner stop mid-resume: the honoured stop was not recorded");
  if (lockLib.currentHolder(dir) !== null) e.push("22 owner stop mid-resume: ownership was not released");

  // 23 THE TREE IS DIRTIED AFTER THE PERMIT. The executor's clean check happens before the spawn;
  //    nothing the worker verifies is working-tree-level, so without a re-check it would resume onto
  //    changes nobody explained.
  freshLedger(dir, "sess_matrix_dirtymid", facts);
  advanceTo(dir, "sess_matrix_dirtymid", "spawn", facts);
  cpLib.writeCheckpoint(dir, {
    sessionId: "sess_matrix_dirtymid", projectId: PROJECT, phaseId: PHASE, planVersion: "9.9",
    repositoryRoot: path.resolve(dir), branch: facts.branch, head: facts.head,
    checkpointId: "cp-dirtymid", writtenBy: "worker-a-matrix",
    nextSafeAction: { kind: "record-continuation-note", params: { note: "must not run" } },
  });
  fs.writeFileSync(path.join(dir, "appeared-after-the-permit.txt"), "x\n");
  const dirtyMid = spawnSync(process.execPath, [WORKER, "--resume", "--root", dir, "--project", PROJECT, "--session", "sess_matrix_dirtymid"], { encoding: "utf8" });
  fs.unlinkSync(path.join(dir, "appeared-after-the-permit.txt"));
  if (dirtyMid.status === 0) e.push("23 tree dirtied after the permit: the worker continued anyway");
  if (String(dirtyMid.stderr).indexOf("outside the handoff's own records") === -1) {
    e.push("23 tree dirtied after the permit: the refusal does not name the unexplained changes: " + String(dirtyMid.stderr).trim().split("\n")[0]);
  }

  // 24 AN UNSAFE SESSION ID IS A PATH. Validated at the process boundary and at every path builder,
  //    not only where a ledger is created.
  const traversal = spawnSync(process.execPath, [WORKER, "--resume", "--root", dir, "--project", PROJECT, "--session", "../../elsewhere"], { encoding: "utf8" });
  if (traversal.status === 0) e.push("24 unsafe session id: a traversing --session was accepted");
  if (String(traversal.stderr).indexOf("safe session identifier") === -1) {
    e.push("24 unsafe session id: refused without naming the reason: " + String(traversal.stderr).trim().split("\n")[0]);
  }
  for (const bad of ["../escape", "a/b", "with space", ""]) {
    let threw = null;
    try { ledgerLib.ledgerPath(dir, bad); } catch (err) { threw = err.message; }
    if (threw === null) e.push("24 unsafe session id: ledgerPath built a path from " + JSON.stringify(bad));
    let threwCp = null;
    try { cpLib.checkpointPath(dir, bad); } catch (err) { threwCp = err.message; }
    if (threwCp === null) e.push("24 unsafe session id: checkpointPath built a path from " + JSON.stringify(bad));
  }

  // 25 GIT IS BOUND TO AN ABSOLUTE EXECUTABLE. A bare command name resolves against the current
  //    directory first on Windows, and the current directory here is the governed checkout — so a
  //    planted `git.exe` could answer "clean" and decide whether a continuation proceeds.
  const boundGitLib = require(path.join(ROOT, "projectos", "worker", "bound-git.cjs"));
  const resolved = boundGitLib.resolveGit(dir, process.env);
  if (resolved !== null && !path.isAbsolute(resolved)) e.push("25 bound git: resolved to a relative path " + resolved);
  if (boundGitLib.resolveGit(dir, { PATH: dir }) !== null) e.push("25 bound git: resolved a git found INSIDE the governed checkout");
  if (boundGitLib.resolveGit(dir, { PATH: "." }) !== null) e.push("25 bound git: resolved a git from a relative PATH entry");
  if (boundGitLib.resolveGit(dir, { PROJECTOS_GIT_EXE: "git.exe" }) !== null) e.push("25 bound git: accepted a non-absolute PROJECTOS_GIT_EXE");
  if (boundGitLib.resolveGit(dir, { PROJECTOS_GIT_EXE: path.join(dir, "git.exe") }) !== null) e.push("25 bound git: accepted a PROJECTOS_GIT_EXE that does not exist");
  const unbound = boundGitLib.boundGit(dir, { PATH: "" });
  if (unbound(["rev-parse", "HEAD"]) !== null) e.push("25 bound git: an unbindable git returned a fact instead of null");

  // 26 GENUINELY CONCURRENT ACQUISITION. Sequential acquisition proves nothing about a race, so this
  //    starts the contenders in PARALLEL — one harness process that spawns N children at once and
  //    waits for all of them. Exactly one may win. Before the exclusive-create fix, read-then-write
  //    let several of them believe they had the checkout.
  const racer = path.join(dir, "race-child.cjs");
  fs.writeFileSync(
    racer,
    'const l=require(' + JSON.stringify(path.join(ROOT, "projectos", "worker", "ownership-lock.cjs")) + ');\n' +
      'const r=l.acquire(process.argv[2], process.argv[3], {});\n' +
      'process.stdout.write(r.acquired ? "ACQUIRED" : "REFUSED");\n',
  );
  const harness = path.join(dir, "race-harness.cjs");
  fs.writeFileSync(
    harness,
    'const { spawn } = require("child_process");\n' +
      'const N = 6;\n' +
      'let done = 0, acquired = 0;\n' +
      'for (let i = 0; i < N; i++) {\n' +
      '  const c = spawn(process.execPath, [' + JSON.stringify(racer) + ', process.argv[2], "racer-" + i], { stdio: ["ignore", "pipe", "ignore"] });\n' +
      '  let out = "";\n' +
      '  c.stdout.on("data", (d) => { out += String(d); });\n' +
      '  c.on("close", () => { if (out.indexOf("ACQUIRED") !== -1) acquired++; if (++done === N) process.stdout.write(String(acquired)); });\n' +
      '}\n',
  );
  try { fs.unlinkSync(lockLib.lockPath(dir)); } catch (_) { /* already gone */ }
  const race = spawnSync(process.execPath, [harness, dir], { encoding: "utf8" });
  const winners = Number(String(race.stdout).trim());
  if (winners !== 1) {
    e.push("26 concurrent acquisition: " + String(race.stdout).trim() + " of 6 CONCURRENT processes acquired the same free lock (expected exactly 1)");
  }
  try { fs.unlinkSync(lockLib.lockPath(dir)); } catch (_) { /* already gone */ }
}

function run() {
  const e = [];
  try {
    scratch.withScratch("zero-relay-matrix", (dir) => runMatrix(dir, e));
  } catch (err) {
    e.push("failure matrix crashed: " + (err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : String(err)));
  }
  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[val-projectos-v3-zero-relay-failure-matrix1a] FAIL: " + x));
    process.exit(1);
  }
  console.log("val-projectos-v3-zero-relay-failure-matrix1a: PASS");
}
