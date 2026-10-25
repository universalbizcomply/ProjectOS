"use strict";
/**
 * Owner pause / stop — S15.
 *
 * The subtle failure this exists to prevent is not "the owner cannot stop it". It is "the owner
 * stopped it and the runtime had already decided". A stop read once, early, and then acted on later
 * leaves a window in which the owner's decision is real, recorded, and ignored. So the check is a
 * function of the file AT THE MOMENT OF ASKING, and the executor calls it immediately before the
 * spawn — after every other gate has passed, with nothing left to do but start the process.
 *
 * ABSENT means running. That is not a fail-open lapse: the file records an owner INTERVENTION, and
 * no intervention is the normal state of a system nobody has paused. MALFORMED, by contrast, is
 * treated as STOPPED — an unreadable control file is a control whose state is unknown, and the only
 * safe reading of an unknown stop signal is that it might be a stop.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");
const { continuityDir } = require("./continuity-ledger.cjs");

const STATES = new Set(["running", "paused", "stopped"]);

function controlPath(root) {
  return path.join(continuityDir(root), "owner-control.json");
}

/**
 * The owner's current instruction, read fresh. Returns
 * `{state, mayContinue, reason, source}` where `source` says where the answer came from, so a caller
 * can tell "the owner has not intervened" from "the control file could not be read".
 */
function read(root) {
  const p = controlPath(root);
  if (!fs.existsSync(p)) {
    return { state: "running", mayContinue: true, reason: "", source: "absent (no owner intervention recorded)" };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    return {
      state: "stopped",
      mayContinue: false,
      reason: "the owner control file is unreadable, and an unknown stop signal is treated as a stop: " + err.message,
      source: "malformed",
    };
  }
  const state = raw === null || typeof raw !== "object" ? "" : String(raw.state);
  if (!STATES.has(state)) {
    return {
      state: "stopped",
      mayContinue: false,
      reason: "the owner control file records no recognised state (" + JSON.stringify(state) + ")",
      source: "malformed",
    };
  }
  return {
    state: state,
    mayContinue: state === "running",
    reason: state === "running" ? "" : "the owner has " + state + " this project",
    source: "owner-control.json",
  };
}

/**
 * Record an owner instruction. Owner-only by contract — the caller must have established that the
 * actor is the owner; this module records, it does not authenticate. `by` is written so the record
 * says who claimed the authority rather than leaving it anonymous.
 */
function set(root, state, by) {
  if (!STATES.has(String(state))) throw new Error("owner-control: unknown state " + state);
  const p = controlPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ state: String(state), by: String(by), updatedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
  return read(root);
}

module.exports = { STATES, controlPath, read, set };
