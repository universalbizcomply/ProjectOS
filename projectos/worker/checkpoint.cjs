"use strict";
/**
 * The durable checkpoint — what a replacement worker is allowed to learn, and nothing else.
 *
 * THE INSTRUCTION IS DATA, AND THE DATA IS AN ALLOWLIST. The whole reason a resume instruction can
 * be trusted more than a pasted prompt is that it cannot say anything the runtime did not already
 * sanction. If `nextSafeAction` were free text, durable state would become an injection channel:
 * anything able to write the checkpoint could dictate a replacement worker's behaviour, and "the
 * instruction came from durable state" would be a security claim with nothing behind it. So the
 * continuation is a `{kind, params}` pair whose `kind` must be on a small allowlist of harmless,
 * governed actions, and whose params are validated per kind.
 *
 * Anything not on the allowlist is refused. When the refused kind names an operation the session
 * launcher classifies as prohibited or owner-gated, the refusal says so — a checkpoint whose next
 * action is "deploy to production" must not merely be unrecognised, it must be visibly a protected
 * action that a continuation may never perform unattended.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");
const { continuityDir, assertSafeSessionId } = require("./continuity-ledger.cjs");
const launcher = require("../launcher/session-launcher.cjs");

const SCHEMA_VERSION = "1.0.0";
const HEX40 = /^[0-9a-f]{40}$/;
const SESSION_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_NOTE = 2000;

/**
 * Continuation kinds a replacement worker may perform unattended.
 *
 * Deliberately tiny. Each is local, reversible, writes only inside `.projectops/continuity/`, and
 * touches nothing a protected-action gate governs. Growing this list is a governance decision, not a
 * convenience: every entry is something ProjectOS will do with no human in the loop.
 */
const CONTINUATION_KINDS = {
  "record-continuation-note": {
    describe: "append one bounded note to this session's continuation record",
    validate(params) {
      const p = params || {};
      if (typeof p.note !== "string" || p.note.trim().length === 0) return "params.note must be a non-empty string";
      if (p.note.length > MAX_NOTE) return "params.note exceeds " + MAX_NOTE + " characters";
      if (Object.keys(p).length !== 1) return "params carries fields other than note";
      return null;
    },
  },
};

// Every path built from a session id validates it here, not only at the write site — see
// `assertSafeSessionId` in continuity-ledger.cjs for why the read sites matter more, not less.
function checkpointPath(root, sessionId) {
  return path.join(continuityDir(root), assertSafeSessionId(sessionId) + ".checkpoint.json");
}

function continuationNotePath(root, sessionId) {
  return path.join(continuityDir(root), assertSafeSessionId(sessionId) + ".continuation.json");
}

/**
 * Why this continuation may not be performed unattended, or null when it may.
 *
 * Kept separate from the checkpoint reader so the executor can ask the question BEFORE spawning and
 * the worker can ask it again after loading — the same rule, applied at both ends, so neither has to
 * trust the other's answer.
 */
function continuationProblem(action) {
  if (action === null || typeof action !== "object" || Array.isArray(action)) {
    return "the checkpoint records no structured next action";
  }
  const kind = String(action.kind);
  if (!Object.prototype.hasOwnProperty.call(CONTINUATION_KINDS, kind)) {
    if (launcher.PROHIBITED.has(kind)) {
      return "the next action '" + kind + "' is a PROHIBITED operation and can never be performed by a continuation";
    }
    if (launcher.OWNER_GATED.has(kind)) {
      return "the next action '" + kind + "' is OWNER-GATED and requires the owner, so no unattended continuation may perform it";
    }
    return "the next action '" + kind + "' is not on the continuation allowlist";
  }
  return CONTINUATION_KINDS[kind].validate(action.params);
}

/**
 * Write the checkpoint. Worker A calls this as the last thing it does before releasing ownership.
 *
 * The repository facts are recorded by the CALLER from live git, and re-derived independently by the
 * replacement worker; storing them is what makes the comparison possible, not what makes them true.
 */
function writeCheckpoint(root, input) {
  const sessionId = String(input.sessionId);
  if (!SESSION_ID.test(sessionId)) throw new Error("checkpoint: invalid sessionId");
  if (!HEX40.test(String(input.head))) throw new Error("checkpoint: head must be a 40-hex commit");
  const problem = continuationProblem(input.nextSafeAction);
  if (problem !== null) throw new Error("checkpoint: refusing to store an unperformable next action — " + problem);

  const checkpoint = {
    schemaVersion: SCHEMA_VERSION,
    sessionId: sessionId,
    projectId: String(input.projectId),
    phaseId: String(input.phaseId),
    planVersion: String(input.planVersion),
    repositoryRoot: String(input.repositoryRoot),
    branch: String(input.branch),
    head: String(input.head),
    checkpointId: String(input.checkpointId),
    writtenBy: String(input.writtenBy),
    writtenAt: new Date().toISOString(),
    nextSafeAction: { kind: String(input.nextSafeAction.kind), params: input.nextSafeAction.params },
  };
  const p = checkpointPath(root, sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
  return checkpoint;
}

/** Null on ANY failure, including an unsafe session id — an unreadable checkpoint is not a usable one. */
function readCheckpoint(root, sessionId) {
  try {
    return JSON.parse(fs.readFileSync(checkpointPath(root, sessionId), "utf8").replace(/^﻿/, ""));
  } catch (_) {
    return null;
  }
}

/** Structural check of a checkpoint read from disk. Shape only; repository agreement is the caller's. */
function checkCheckpointShape(checkpoint) {
  const e = [];
  if (checkpoint === null || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return ["checkpoint is not an object"];
  if (checkpoint.schemaVersion !== SCHEMA_VERSION) e.push("schemaVersion is not " + SCHEMA_VERSION);
  if (!SESSION_ID.test(String(checkpoint.sessionId))) e.push("sessionId is missing or unsafe");
  for (const k of ["projectId", "phaseId", "planVersion", "repositoryRoot", "branch", "checkpointId", "writtenBy", "writtenAt"]) {
    if (typeof checkpoint[k] !== "string" || checkpoint[k].length === 0) e.push(k + " is missing");
  }
  if (!HEX40.test(String(checkpoint.head))) e.push("head is not a 40-hex commit");
  const problem = continuationProblem(checkpoint.nextSafeAction);
  if (problem !== null) e.push(problem);
  return e;
}

/**
 * Perform a continuation. Returns `{performed, detail}`; throws only on a refused action, because a
 * refusal here means the checkpoint asked for something outside the allowlist and that is a fault,
 * not an outcome.
 *
 * The action is re-validated immediately before it runs. The executor already checked it, but a
 * check performed by another process at another time is a claim, and the point of this design is
 * that the worker does not have to rely on one.
 */
function performContinuation(root, checkpoint) {
  const problem = continuationProblem(checkpoint.nextSafeAction);
  if (problem !== null) throw new Error("checkpoint: refusing to perform — " + problem);
  const kind = String(checkpoint.nextSafeAction.kind);
  if (kind === "record-continuation-note") {
    const p = continuationNotePath(root, checkpoint.sessionId);
    let existing = { sessionId: checkpoint.sessionId, notes: [] };
    if (fs.existsSync(p)) {
      try { existing = JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); } catch (_) { /* rewritten below */ }
    }
    const notes = Array.isArray(existing.notes) ? existing.notes : [];
    const entry = {
      at: new Date().toISOString(),
      by: String(checkpoint.checkpointId),
      note: String(checkpoint.nextSafeAction.params.note),
    };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify({ sessionId: checkpoint.sessionId, notes: notes.concat([entry]) }, null, 2) + "\n",
      "utf8",
    );
    return { performed: kind, detail: { path: p, noteCount: notes.length + 1 } };
  }
  // Unreachable while the allowlist has one entry; present so adding a kind without a branch fails
  // loudly instead of silently doing nothing and reporting success.
  throw new Error("checkpoint: allowlisted kind '" + kind + "' has no implementation");
}

module.exports = {
  SCHEMA_VERSION,
  CONTINUATION_KINDS,
  MAX_NOTE,
  checkpointPath,
  continuationNotePath,
  continuationProblem,
  writeCheckpoint,
  readCheckpoint,
  checkCheckpointShape,
  performContinuation,
};
