"use strict";
/**
 * The zero-relay executor — the ONLY component in ProjectOS that may start a worker process.
 *
 * WHY IT IS SEPARATE FROM THE PLANNER. `launcher/session-launcher.cjs` decides whether a session
 * WOULD be allowed to run, and by construction cannot spawn anything: a bug in it can produce a
 * wrong answer but not a running process. Adding execution there would destroy that property for
 * the sake of one fewer file. So the executor CONSUMES a planner decision and refuses on anything
 * short of `permitted === true`. The answer to "could this mechanism deploy to production?" stays
 * "the planner refuses the spec, so there is nothing to execute".
 *
 * WHAT IT MAY HAND A NEW WORKER. Identifiers, and nothing else. The argv it builds carries a project
 * id, a session id and a repository root — no task, no description, no prompt. Everything about what
 * to do next comes from the durable checkpoint, whose next action is itself constrained to an
 * allowlist. That is what makes "the instruction came from durable state" a property rather than a
 * slogan: there is no channel through which free text could arrive.
 *
 * S15 IS THE LAST THING CHECKED. Owner pause/stop is read immediately before the spawn, after every
 * other gate has passed. A stop read early and acted on late is a window in which the owner's
 * decision is real, recorded, and ignored.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ledger = require("./continuity-ledger.cjs");
const lock = require("./ownership-lock.cjs");
const ownerControl = require("./owner-control.cjs");
const checkpointStore = require("./checkpoint.cjs");

const MODULE = "zero-relay-executor";
const WORKER_ENTRY = path.join(__dirname, "worker-runtime.cjs");

/**
 * Paths the handoff itself writes. A change here is the mechanism's own bookkeeping, not an
 * unexplained modification, and demanding a globally clean tree would mean the first thing a handoff
 * does makes the next handoff impossible. Everything else stays substantive — this is a narrow,
 * named exception, not a relaxation of the cleanliness requirement.
 */
const CONTINUITY_PREFIX = ".projectops/continuity/";

/** The porcelain paths that are NOT the handoff's own bookkeeping. Empty means clean enough to resume. */
function substantiveDirtyPaths(porcelain) {
  return porcelain
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // Porcelain lines are `XY path` (and `XY old -> new` for renames); take the last path.
    .map((l) => {
      const body = l.slice(2).trim();
      const arrow = body.indexOf(" -> ");
      return (arrow === -1 ? body : body.slice(arrow + 4)).replace(/^"|"$/g, "").replace(/\\/g, "/");
    })
    .filter((p) => !p.startsWith(CONTINUITY_PREFIX));
}

/** Live repository facts. Any git failure yields nulls, which every gate below treats as a refusal. */
function repoFacts(root) {
  const git = (args) => {
    try {
      return execFileSync("git", ["-C", root].concat(args), {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch (_) {
      return null;
    }
  };
  const head = git(["rev-parse", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  const dirty = status === null ? null : substantiveDirtyPaths(status);
  return {
    head: head !== null && /^[0-9a-f]{40}$/.test(head) ? head : null,
    branch: branch,
    // A git failure is NOT a clean tree.
    clean: dirty === null ? false : dirty.length === 0,
    dirtyPaths: dirty === null ? ["<git status could not be read>"] : dirty,
  };
}

/**
 * Everything that must hold before a replacement worker may be started, in the order it must hold.
 *
 * Returns `{permitted, refusals}`. It never spawns and never writes, so a caller can ask "would
 * this be allowed?" without side effects — which is also how the failure matrix exercises every
 * refusal without starting processes.
 */
function evaluateContinuation(root, input) {
  const refusals = [];
  const spec = input.launchSpec;
  const sessionId = String(input.sessionId);

  // 1. The planner's decision. Anything short of permitted is the end of it.
  if (spec === null || typeof spec !== "object") refusals.push("no launch spec was supplied");
  else {
    if (spec.permitted !== true) {
      refusals.push("the session launcher did not permit this spec (decision " + String(spec.decision) + ")");
    }
    if (spec.executed === true) refusals.push("the launch spec is already marked executed");
    if (String(spec.projectId) !== String(input.projectId)) {
      refusals.push("the launch spec is for project '" + String(spec.projectId) + "', not '" + String(input.projectId) + "'");
    }
  }

  // 2. The checkpoint, and whether what it asks for may be done unattended.
  const checkpoint = checkpointStore.readCheckpoint(root, sessionId);
  if (checkpoint === null) refusals.push("no durable checkpoint for session " + sessionId);
  else {
    for (const problem of checkpointStore.checkCheckpointShape(checkpoint)) refusals.push("checkpoint: " + problem);
    if (String(checkpoint.projectId) !== String(input.projectId)) {
      refusals.push("checkpoint names project '" + String(checkpoint.projectId) + "'");
    }
    if (spec !== null && typeof spec === "object" && String(checkpoint.phaseId) !== String(spec.phaseId)) {
      refusals.push("checkpoint phase '" + String(checkpoint.phaseId) + "' does not match the launch spec phase '" + String(spec.phaseId) + "'");
    }
  }

  // 3. The repository the continuation would run in.
  const facts = repoFacts(root);
  if (facts.head === null) refusals.push("HEAD could not be established from git");
  if (checkpoint !== null && facts.head !== null && facts.head !== String(checkpoint.head)) {
    refusals.push(
      "stale checkpoint: it was written at " + String(checkpoint.head).slice(0, 7) + " but HEAD is now " + facts.head.slice(0, 7),
    );
  }
  if (checkpoint !== null && facts.branch !== null && facts.branch !== String(checkpoint.branch)) {
    refusals.push("branch is '" + String(facts.branch) + "', checkpoint expects '" + String(checkpoint.branch) + "'");
  }
  if (checkpoint !== null && path.resolve(String(checkpoint.repositoryRoot)) !== path.resolve(root)) {
    refusals.push("checkpoint was written for a different checkout: " + String(checkpoint.repositoryRoot));
  }
  if (input.requireCleanTree !== false && !facts.clean) {
    refusals.push(
      "the working tree carries " + facts.dirtyPaths.length + " change(s) outside the handoff's own records, so a " +
        "continuation would resume onto unexplained modifications: " + facts.dirtyPaths.slice(0, 3).join(", "),
    );
  }

  // 4. Ownership must genuinely have been released. A worker that merely went quiet still holds it.
  const holder = lock.currentHolder(root);
  if (holder !== null) {
    refusals.push("the checkout is still owned by " + String(holder.workerId) + " (pid " + String(holder.pid) + ")");
  }

  // 5. S15 — the owner, read last and read fresh.
  const owner = ownerControl.read(root);
  if (!owner.mayContinue) refusals.push("owner control: " + owner.reason);

  return { permitted: refusals.length === 0, refusals: refusals, checkpoint: checkpoint, repo: facts, owner: owner };
}

/**
 * The argv handed to a replacement worker. Identifiers only — this function exists so that claim is
 * enforced in one readable place and can be asserted by a test.
 */
function buildResumeArgv(root, sessionId, projectId) {
  return ["--resume", "--root", root, "--project", String(projectId), "--session", String(sessionId)];
}

/** Does an argv carry anything other than identifiers and the flags above? */
function argvCarriesFreeText(argv) {
  const FLAGS = new Set(["--resume", "--root", "--project", "--session"]);
  const SAFE_VALUE = /^[A-Za-z0-9_.:\\/-]+$/;
  for (const a of argv) {
    if (FLAGS.has(a)) continue;
    if (!SAFE_VALUE.test(a)) return true;
    // A value containing whitespace is prose, whatever else it looks like.
    if (/\s/.test(a)) return true;
  }
  return false;
}

/**
 * Start the replacement worker.
 *
 * `spawn` is used rather than a shell: the argv is passed as an array with `shell: false`, so no
 * value it contains can be reinterpreted as a command. The child is given a MINIMAL environment —
 * only what Node needs to run — because inherited environment is the other channel through which
 * something could reach a worker without passing the checkpoint.
 */
function startWorker(root, sessionId, projectId, options) {
  const opts = options || {};
  const argv = buildResumeArgv(root, sessionId, projectId);
  if (argvCarriesFreeText(argv)) throw new Error(MODULE + ": refusing to spawn — the resume argv carries free text");
  const child = spawn(process.execPath, [WORKER_ENTRY].concat(argv), {
    cwd: root,
    shell: false,
    windowsHide: true,
    stdio: opts.stdio === undefined ? "ignore" : opts.stdio,
    detached: false,
    env: {
      // Deliberately minimal. No inherited task context, no provider credentials, no PATH-driven
      // tool discovery — the worker runs Node and reads durable state.
      SystemRoot: process.env.SystemRoot === undefined ? "" : process.env.SystemRoot,
      PROJECTOS_WORKER_ROLE: "replacement",
    },
  });
  return { child: child, argv: argv };
}

/**
 * The whole handoff, from the executor's side: evaluate, record the permit, spawn, record the spawn.
 *
 * Refusals are RECORDED as refusals and returned; they never throw, because a refused continuation
 * is an ordinary governed outcome and the caller must be able to report it rather than crash on it.
 */
function continueSession(root, input) {
  const sessionId = String(input.sessionId);
  const verdict = evaluateContinuation(root, input);
  if (!verdict.permitted) {
    return { spawned: false, refusals: verdict.refusals, child: null, argv: null };
  }

  ledger.appendEvent(root, sessionId, {
    type: "continuation-permit",
    author: "executor",
    module: MODULE,
    detail: {
      decision: "permitted",
      launchSpecDecision: String(input.launchSpec.decision),
      head: verdict.repo.head,
      branch: verdict.repo.branch,
      workingTreeClean: verdict.repo.clean,
      ownerControlState: verdict.owner.state,
      ownerControlSource: verdict.owner.source,
      nextActionKind: String(verdict.checkpoint.nextSafeAction.kind),
    },
  });

  // A seam for proofs that need to act in the window between the permit and the spawn — the only
  // window in which S15 can be exercised deterministically. It confers NO authority: the caller is
  // already calling this function, the final owner read and every gate still run after it, and the
  // spawn is still the executor's. Without it, proving "the stop is honoured immediately before the
  // spawn" would depend on winning a race, which is not a proof.
  if (typeof input.onPermitted === "function") input.onPermitted();

  // S15, again and last: everything above took time, and the owner may have acted during it.
  const ownerNow = ownerControl.read(root);
  if (!ownerNow.mayContinue) {
    ledger.appendEvent(root, sessionId, {
      type: "owner-control-honoured",
      author: "executor",
      module: MODULE,
      detail: { state: ownerNow.state, reason: ownerNow.reason, at: "immediately before spawn" },
    });
    return { spawned: false, refusals: ["owner control: " + ownerNow.reason], child: null, argv: null };
  }

  const started = startWorker(root, sessionId, input.projectId, input.spawnOptions);
  ledger.appendEvent(root, sessionId, {
    type: "executor-spawn",
    author: "executor",
    module: MODULE,
    detail: {
      childPid: started.child.pid,
      executorPid: process.pid,
      entry: path.relative(root, WORKER_ENTRY).replace(/\\/g, "/"),
      argv: started.argv,
      instructionProvenance: "durable-state",
      carriesTaskText: false,
    },
  });
  return { spawned: true, refusals: [], child: started.child, argv: started.argv };
}

module.exports = {
  MODULE,
  WORKER_ENTRY,
  CONTINUITY_PREFIX,
  substantiveDirtyPaths,
  repoFacts,
  evaluateContinuation,
  buildResumeArgv,
  argvCarriesFreeText,
  startWorker,
  continueSession,
};
