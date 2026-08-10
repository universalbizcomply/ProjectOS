"use strict";
/**
 * The supervisor — this is "ProjectOS" in the sentence "Worker A stops and ProjectOS starts Worker B".
 *
 * WHY IT IS A SEPARATE PROCESS FROM WORKER A. The case zero-relay exists for is a worker that has
 * run out of capacity: its process is GONE. If Worker A spawned its own replacement, the mechanism
 * would only work in the one situation where it is least needed — a healthy worker politely handing
 * over — and the replacement's parent would be the very process that was supposed to have stopped.
 * Here Worker A exits, and only then does the supervisor evaluate and start Worker B, so the
 * replacement's parent is ProjectOS and the recorded pids show it.
 *
 * IT DECIDES NOTHING ITSELF. Whether continuation is allowed is the planner's answer plus the
 * executor's gates; this file sequences them and records what happened. Every refusal it can hit is
 * returned, never thrown, because a refused handoff is a governed outcome that must be reportable.
 *
 * NO HUMAN IN THE MIDDLE. Between Worker A's exit and Worker B's start there is no input channel:
 * the supervisor reads durable state, asks the planner, asks the executor, and the executor hands
 * the child identifiers only. That is the whole claim, and it is exactly as strong as those three
 * steps — it is not a claim that nobody was in the room.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ledger = require("./continuity-ledger.cjs");
const executor = require("./zero-relay-executor.cjs");
const launcher = require("../launcher/session-launcher.cjs");

const MODULE = "continuation-supervisor";
const WORKER_ENTRY = path.join(__dirname, "worker-runtime.cjs");

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) {
    return null;
  }
}

/** Read the active plan the way the runtime does: from the location the project's config declares. */
function activePlan(root) {
  let planPath = path.join(root, ".projectops", "plan.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".projectops", "project-config.json"), "utf8").replace(/^﻿/, ""));
    if (cfg.planMemory && typeof cfg.planMemory.planPath === "string" && cfg.planMemory.planPath.length > 0) {
      planPath = path.join(root, cfg.planMemory.planPath);
    }
  } catch (_) { /* default location */ }
  try {
    return JSON.parse(fs.readFileSync(planPath, "utf8").replace(/^﻿/, ""));
  } catch (_) {
    return null;
  }
}

/** Run a worker process to completion. Resolves with its exit code — never rejects on a non-zero. */
function runWorker(root, argv, options) {
  const opts = options || {};
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER_ENTRY].concat(argv), {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: opts.stdio === undefined ? ["ignore", "pipe", "pipe"] : opts.stdio,
      env: { SystemRoot: process.env.SystemRoot === undefined ? "" : process.env.SystemRoot, PROJECTOS_WORKER_ROLE: opts.role || "initial" },
    });
    let out = "";
    let err = "";
    if (child.stdout) child.stdout.on("data", (d) => { out += String(d); });
    if (child.stderr) child.stderr.on("data", (d) => { err += String(d); });
    child.on("close", (code) => resolve({ code: code === null ? -1 : code, pid: child.pid, stdout: out, stderr: err }));
  });
}

/**
 * Write the durable brief Worker A will read. The brief is state, not an argument: an instruction
 * that travels in argv is an instruction a caller can forge at spawn time, and the design's whole
 * position is that instructions come from durable state the runtime wrote.
 */
function writeBrief(root, sessionId, brief) {
  const p = path.join(ledger.continuityDir(root), sessionId + ".brief.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(brief, null, 2) + "\n", "utf8");
  return p;
}

/**
 * Run one full handoff: Worker A to its boundary, then ProjectOS decides, then Worker B.
 *
 * Returns a structured result describing every stage. The caller reports it; this function does not
 * print conclusions, so a proof harness and a validator read the same facts.
 */
async function runHandoff(root, input) {
  const sessionId = String(input.sessionId);
  const projectId = String(input.projectId);
  const phaseId = String(input.phaseId);
  const plan = activePlan(root);
  if (plan === null) return { ok: false, stage: "plan", detail: "the active approved plan could not be read" };
  const planVersion = String(plan.planVersion);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head === null) return { ok: false, stage: "repository", detail: "HEAD could not be established" };

  ledger.createLedger(root, {
    sessionId: sessionId,
    projectId: projectId,
    phaseId: phaseId,
    repositoryRoot: path.resolve(root),
    branch: branch,
  });

  writeBrief(root, sessionId, {
    phaseId: phaseId,
    planVersion: planVersion,
    checkpointId: String(input.checkpointId),
    boundary: String(input.boundary),
    nextSafeAction: input.nextSafeAction,
  });

  // 1. Worker A, to its continuation boundary. Its process ENDS here.
  const a = await runWorker(root, ["--initial", "--root", root, "--project", projectId, "--session", sessionId], { role: "initial" });
  if (a.code !== 0) return { ok: false, stage: "worker-a", detail: a.stderr.trim() || ("exit " + a.code), workerA: a };

  // 2. ProjectOS decides. The planner first — the executor may only act on a permitted spec.
  const spec = launcher.buildLaunchSpec(
    {
      projectId: projectId,
      phaseId: phaseId,
      role: "implementer",
      worker: "projectos-worker",
      productionFrozen: true,
      workingDirectory: ".",
      requestedOperations: ["read-file", "write-file-local"],
    },
    { projectRoots: { [projectId]: path.resolve(root) } },
  );

  // 3. The executor: gates, then spawn. Worker B's parent is THIS process.
  const started = executor.continueSession(root, {
    sessionId: sessionId,
    projectId: projectId,
    launchSpec: spec,
    spawnOptions: { stdio: ["ignore", "pipe", "pipe"] },
    onPermitted: typeof input.onPermitted === "function" ? input.onPermitted : undefined,
  });
  if (!started.spawned) {
    return { ok: false, stage: "executor", detail: started.refusals.join("; "), workerA: a, launchSpec: spec };
  }

  // 4. Wait for Worker B so the harness can report a completed handoff rather than a started one.
  const b = await new Promise((resolve) => {
    let err = "";
    if (started.child.stderr) started.child.stderr.on("data", (d) => { err += String(d); });
    started.child.on("close", (code) => resolve({ code: code === null ? -1 : code, pid: started.child.pid, stderr: err }));
  });

  return {
    ok: b.code === 0,
    stage: b.code === 0 ? "complete" : "worker-b",
    detail: b.code === 0 ? "" : b.stderr.trim() || ("exit " + b.code),
    supervisorPid: process.pid,
    workerA: { pid: a.pid, code: a.code },
    workerB: { pid: b.pid, code: b.code },
    launchSpec: spec,
    argv: started.argv,
  };
}

module.exports = { MODULE, WORKER_ENTRY, activePlan, runWorker, writeBrief, runHandoff };
