"use strict";
/**
 * A ProjectOS worker process. Two modes, one runtime.
 *
 *   --initial  Worker A: takes ownership, does a bounded piece of work, reaches its continuation
 *              boundary, writes the durable checkpoint, releases ownership, and then PROVES the
 *              release by attempting one more write and recording the refusal.
 *   --resume   Worker B: the replacement. Started by the executor with identifiers only.
 *
 * Both modes are the same runtime deliberately: the verification, the ownership discipline and the
 * ledger are shared, so the replacement is not a special case with its own weaker rules.
 *
 * WORKER B IS TOLD WHICH SESSION, NEVER WHAT TO DO. The instruction comes from the durable
 * checkpoint, whose next action is constrained to an allowlist. If this process were handed a task
 * in its argv it would have no way to act on it, because there is no code path here that reads one.
 *
 * IT VERIFIES INDEPENDENTLY. Everything the checkpoint says about the world — repository, branch,
 * plan version, phase, head — is re-derived here from git and from disk and then COMPARED. Reading a
 * value and echoing it back would prove nothing; the comparison is the proof, and every mismatch
 * fails closed before the continuation runs.
 *
 * ORDER MATTERS: verify, then take ownership, then re-check the owner's stop, then act. Taking
 * ownership before verifying would leave a wrong-context worker holding the checkout, and acting
 * before re-reading the stop flag would ignore an owner decision made while this process started.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ledger = require("./continuity-ledger.cjs");
const lock = require("./ownership-lock.cjs");
const ownerControl = require("./owner-control.cjs");
const checkpointStore = require("./checkpoint.cjs");

const MODULE = "worker-runtime";

/** Parse the argv. Anything not recognised is IGNORED rather than interpreted. */
function parseArgs(argv) {
  const out = { resume: false, initial: false, root: null, project: null, session: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--resume") out.resume = true;
    else if (a === "--initial") out.initial = true;
    else if (a === "--root") { out.root = argv[++i]; }
    else if (a === "--project") { out.project = argv[++i]; }
    else if (a === "--session") { out.session = argv[++i]; }
    // No default branch. An unknown argument is not an instruction.
  }
  return out;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) {
    return null;
  }
}

/**
 * Re-derive the world and compare it, field by field, with what the checkpoint claims.
 *
 * Returns `{observed, mismatches}`. `observed` is what THIS process saw — recorded in the ledger so
 * a reader can check the comparison rather than take the verdict on trust.
 */
function verifyContext(root, checkpoint) {
  const observed = {
    repositoryRoot: path.resolve(root),
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(root, ["rev-parse", "HEAD"]),
    planVersion: null,
    phaseId: null,
    phaseStatus: null,
    checkpointId: String(checkpoint.checkpointId),
  };

  // The plan is read from the location the project's own config declares, exactly as the runtime
  // resolves it — not from a path this process chose.
  let planPath = path.join(root, ".projectops", "plan.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".projectops", "project-config.json"), "utf8").replace(/^﻿/, ""));
    if (cfg.planMemory && typeof cfg.planMemory.planPath === "string" && cfg.planMemory.planPath.length > 0) {
      planPath = path.join(root, cfg.planMemory.planPath);
    }
  } catch (_) { /* the default location stands, and a missing plan is caught below */ }
  let plan = null;
  try { plan = JSON.parse(fs.readFileSync(planPath, "utf8").replace(/^﻿/, "")); } catch (_) { plan = null; }
  if (plan !== null) {
    observed.planVersion = typeof plan.planVersion === "string" ? plan.planVersion : null;
    const phases = Array.isArray(plan.phases) ? plan.phases : [];
    const inPlan = phases.some((p) => p && p.phaseId === checkpoint.phaseId);
    observed.phaseId = inPlan ? String(checkpoint.phaseId) : null;
  }
  try {
    const rec = JSON.parse(
      fs.readFileSync(path.join(root, ".projectops", "phases", String(checkpoint.phaseId) + ".json"), "utf8").replace(/^﻿/, ""),
    );
    observed.phaseStatus = typeof rec.status === "string" ? rec.status : null;
  } catch (_) { observed.phaseStatus = null; }

  const mismatches = [];
  if (observed.repositoryRoot !== path.resolve(String(checkpoint.repositoryRoot))) {
    mismatches.push("repository root: observed " + observed.repositoryRoot + ", checkpoint " + String(checkpoint.repositoryRoot));
  }
  if (observed.branch !== String(checkpoint.branch)) {
    mismatches.push("branch: observed " + String(observed.branch) + ", checkpoint " + String(checkpoint.branch));
  }
  if (observed.head !== String(checkpoint.head)) {
    mismatches.push("head: observed " + String(observed.head) + ", checkpoint " + String(checkpoint.head));
  }
  if (observed.planVersion !== String(checkpoint.planVersion)) {
    mismatches.push("active plan version: observed " + String(observed.planVersion) + ", checkpoint " + String(checkpoint.planVersion));
  }
  if (observed.phaseId !== String(checkpoint.phaseId)) {
    mismatches.push("phase " + String(checkpoint.phaseId) + " is not a phase of the active approved plan");
  }
  return { observed: observed, mismatches: mismatches };
}

/**
 * Resume a session. Returns an exit code; every refusal is recorded before returning, so a reader of
 * the ledger can see WHY a continuation stopped rather than inferring it from an absence.
 */
function resume(root, projectId, sessionId) {
  const workerId = "worker-b-" + sessionId + "-" + process.pid;

  const checkpoint = checkpointStore.readCheckpoint(root, sessionId);
  if (checkpoint === null) {
    process.stderr.write(MODULE + ": no checkpoint for session " + sessionId + "\n");
    return 2;
  }
  const shape = checkpointStore.checkCheckpointShape(checkpoint);
  if (shape.length > 0) {
    process.stderr.write(MODULE + ": checkpoint is not usable — " + shape.join("; ") + "\n");
    return 2;
  }
  if (String(checkpoint.projectId) !== String(projectId)) {
    process.stderr.write(MODULE + ": checkpoint names project " + String(checkpoint.projectId) + "\n");
    return 2;
  }

  const verification = verifyContext(root, checkpoint);
  ledger.appendEvent(root, sessionId, {
    type: "worker-b-verify",
    author: "worker",
    module: MODULE,
    workerId: workerId,
    parentPid: process.ppid,
    detail: {
      instructionProvenance: "durable-state",
      receivedTaskText: false,
      argv: process.argv.slice(2),
      observed: verification.observed,
      expected: {
        repositoryRoot: String(checkpoint.repositoryRoot),
        branch: String(checkpoint.branch),
        head: String(checkpoint.head),
        planVersion: String(checkpoint.planVersion),
        phaseId: String(checkpoint.phaseId),
        checkpointId: String(checkpoint.checkpointId),
      },
      mismatches: verification.mismatches,
      verified: verification.mismatches.length === 0,
    },
  });
  if (verification.mismatches.length > 0) {
    process.stderr.write(MODULE + ": context mismatch — " + verification.mismatches.join("; ") + "\n");
    return 2;
  }

  const acquired = lock.acquire(root, workerId, {});
  if (!acquired.acquired) {
    process.stderr.write(MODULE + ": could not take ownership — " + acquired.reason + "\n");
    return 2;
  }

  try {
    // The owner may have stopped things while this process was starting and verifying.
    const owner = ownerControl.read(root);
    if (!owner.mayContinue) {
      ledger.appendEvent(root, sessionId, {
        type: "owner-control-honoured",
        author: "worker",
        module: MODULE,
        workerId: workerId,
        detail: { state: owner.state, reason: owner.reason, at: "after verification, before the continuation" },
      });
      process.stderr.write(MODULE + ": " + owner.reason + "\n");
      return 3;
    }

    lock.assertOwner(root, workerId);

    // PROTECTED-BOUNDARY PROBE, before doing anything else with ownership in hand.
    //
    // "The protected-action gates survive the handoff" cannot be evidenced by an absence: a
    // replacement worker that simply never attempts a protected action looks exactly like one that
    // would have been allowed to. So this process deliberately asks the continuation gate to perform
    // a PROHIBITED action, in memory, against a spec that is never written anywhere. It must refuse.
    // Nothing is deployed, nothing is sent, and the refusal is the evidence.
    let boundaryRefusal = null;
    try {
      checkpointStore.performContinuation(root, Object.assign({}, checkpoint, { nextSafeAction: { kind: "deploy-production", params: {} } }));
    } catch (err) {
      boundaryRefusal = err.message;
    }
    if (boundaryRefusal === null) {
      process.stderr.write(MODULE + ": PROTECTED-BOUNDARY DEFECT — a continuation was permitted to perform deploy-production\n");
      return 2;
    }
    ledger.appendEvent(root, sessionId, {
      type: "protected-action-refused",
      author: "worker",
      module: MODULE,
      workerId: workerId,
      parentPid: process.ppid,
      detail: { attempted: "deploy-production", refusal: boundaryRefusal, note: "in-memory probe; nothing was written or sent" },
    });

    const performed = checkpointStore.performContinuation(root, checkpoint);
    ledger.appendEvent(root, sessionId, {
      type: "worker-b-continuation",
      author: "worker",
      module: MODULE,
      workerId: workerId,
      parentPid: process.ppid,
      detail: {
        action: String(checkpoint.nextSafeAction.kind),
        fromCheckpoint: String(checkpoint.checkpointId),
        result: { performed: performed.performed, noteCount: performed.detail.noteCount },
        canonicalStateUpdated: path.relative(root, performed.detail.path).replace(/\\/g, "/"),
      },
    });
    return 0;
  } finally {
    const released = lock.release(root, workerId);
    if (released.ok) {
      ledger.appendEvent(root, sessionId, {
        type: "worker-b-release",
        author: "worker",
        module: MODULE,
        workerId: workerId,
        detail: { released: true },
      });
    }
  }
}

/**
 * Worker A: do a bounded piece of work, checkpoint at the continuation boundary, release, and PROVE
 * the release.
 *
 * The proof is the last step and is the reason this mode exists rather than the supervisor simply
 * writing a checkpoint. After releasing, this process deliberately attempts one more governed write.
 * It must be refused. A worker that merely stopped is indistinguishable from a worker that was
 * prevented, and only one of those is an ownership guarantee.
 */
function runInitial(root, projectId, sessionId, input) {
  const workerId = "worker-a-" + sessionId + "-" + process.pid;
  const facts = {
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(root, ["rev-parse", "HEAD"]),
  };
  if (facts.head === null) {
    process.stderr.write(MODULE + ": HEAD could not be established\n");
    return 2;
  }

  const acquired = lock.acquire(root, workerId, {});
  if (!acquired.acquired) {
    process.stderr.write(MODULE + ": could not take ownership — " + acquired.reason + "\n");
    return 2;
  }

  // The bounded piece of work, done while genuinely holding the checkout.
  lock.assertOwner(root, workerId);
  const checkpoint = checkpointStore.writeCheckpoint(root, {
    sessionId: sessionId,
    projectId: projectId,
    phaseId: input.phaseId,
    planVersion: input.planVersion,
    repositoryRoot: path.resolve(root),
    branch: facts.branch,
    head: facts.head,
    checkpointId: input.checkpointId,
    writtenBy: workerId,
    nextSafeAction: input.nextSafeAction,
  });
  ledger.appendEvent(root, sessionId, {
    type: "worker-a-checkpoint",
    author: "worker",
    module: MODULE,
    workerId: workerId,
    detail: {
      checkpointId: checkpoint.checkpointId,
      head: checkpoint.head,
      branch: checkpoint.branch,
      planVersion: checkpoint.planVersion,
      phaseId: checkpoint.phaseId,
      nextActionKind: checkpoint.nextSafeAction.kind,
      boundary: String(input.boundary),
    },
  });

  const released = lock.release(root, workerId);
  if (!released.ok) {
    process.stderr.write(MODULE + ": could not release ownership — " + released.reason + "\n");
    return 2;
  }
  ledger.appendEvent(root, sessionId, {
    type: "worker-a-release",
    author: "worker",
    module: MODULE,
    workerId: workerId,
    detail: { released: true, reason: String(input.boundary) },
  });

  // The ownership proof. This MUST throw.
  let refusal = null;
  try {
    lock.assertOwner(root, workerId);
  } catch (err) {
    refusal = err.message;
  }
  if (refusal === null) {
    process.stderr.write(MODULE + ": OWNERSHIP DEFECT — a released worker was still permitted to write\n");
    return 2;
  }
  ledger.appendEvent(root, sessionId, {
    type: "worker-a-post-release-write-refused",
    author: "worker",
    module: MODULE,
    workerId: workerId,
    detail: { attempted: "governed write after release", refusal: refusal },
  });
  return 0;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.resume === args.initial) {
    process.stderr.write(MODULE + ": exactly one of --resume or --initial is required; this worker takes no task\n");
    return 1;
  }
  if (typeof args.root !== "string" || typeof args.project !== "string" || typeof args.session !== "string") {
    process.stderr.write(MODULE + ": --root, --project and --session are required\n");
    return 1;
  }
  const root = path.resolve(args.root);
  if (args.initial) {
    // Worker A's bounded task description comes from durable state the supervisor wrote, for exactly
    // the same reason Worker B's does: an argv is not an instruction channel in this design.
    const briefPath = path.join(ledger.continuityDir(root), args.session + ".brief.json");
    let brief;
    try {
      brief = JSON.parse(fs.readFileSync(briefPath, "utf8").replace(/^﻿/, ""));
    } catch (err) {
      process.stderr.write(MODULE + ": no durable brief for session " + args.session + "\n");
      return 2;
    }
    return runInitial(root, args.project, args.session, brief);
  }
  return resume(root, args.project, args.session);
}

module.exports = { MODULE, parseArgs, verifyContext, resume, runInitial, main };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
