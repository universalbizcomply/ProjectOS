"use strict";
/**
 * The durable handoff ledger — the only place a zero-relay continuity claim can come from.
 *
 * WHAT IT IS FOR. "Worker A stopped and ProjectOS started Worker B without anyone pasting a prompt"
 * is a claim about CAUSALITY, and a pile of files is not causality. This ledger records the ordered
 * events of a handoff, each stamped with the process that wrote it, so a reader can check that the
 * chain actually happened in the only order it could legitimately happen in — rather than checking
 * that some artefacts exist, which a person with a text editor can also arrange.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. This module cannot prove a human was absent from the room. It
 * proves narrower, checkable things: that the replacement process was a CHILD of the executor
 * process (a hand-started worker has a different parent), that the instruction it received contained
 * identifiers and no task text, and that its stated instruction provenance is durable state. Those
 * are the mechanical facts; the validator states their limits rather than overclaiming from them.
 *
 * APPEND-ONLY AND ORDER-ENFORCING. Appending is the only mutation. Each event must be a legal
 * successor of the one before it, and its timestamp must not go backwards — so a ledger that reads
 * as a clean handoff could not have been assembled out of order by the runtime itself. It is not
 * tamper-proof against someone editing the JSON, and is not claimed to be: ProjectOS is
 * MANUAL_GOVERNANCE_APPROVAL / tamperProof false throughout, and the backstop is the owner commit
 * gate where a forged ledger is a visible diff.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "1.0.0";
const HEX40 = /^[0-9a-f]{40}$/;
const SESSION_ID = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * The event vocabulary, and the legal successors of each.
 *
 * The chain is linear on purpose. A handoff has exactly one shape, and every branch someone might
 * want ("skip the release", "spawn before the permit") is a hole. Side events that may occur at any
 * point during the handoff — a refused protected action, an honoured owner stop, an input event —
 * are listed separately and never advance the chain.
 */
const CHAIN = [
  "worker-a-checkpoint",
  "worker-a-release",
  "continuation-permit",
  "executor-spawn",
  "worker-b-verify",
  "worker-b-continuation",
  "worker-b-release",
];
const SIDE_EVENTS = new Set([
  // Worker A tried to write after releasing and was refused. This is the ownership PROOF: silence
  // proves nothing, because a worker that simply stopped looks identical to one that was blocked.
  "worker-a-post-release-write-refused",
  "protected-action-refused",
  "owner-control-honoured",
  // An instruction that entered the handoff from outside durable state. The runtime never writes one;
  // it exists so that "no owner or user prompt relay" is a checkable absence rather than an
  // unrepresentable one.
  "input-event",
]);

const AUTHOR_ROLES = new Set(["runtime", "executor", "worker", "owner", "user"]);

function continuityDir(root) {
  return path.join(root, ".projectops", "continuity");
}

function ledgerPath(root, sessionId) {
  return path.join(continuityDir(root), sessionId + ".json");
}

function ledgerRelPath(sessionId) {
  return ".projectops/continuity/" + sessionId + ".json";
}

function readLedger(root, sessionId) {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(root, sessionId), "utf8").replace(/^﻿/, ""));
  } catch (_) {
    return null;
  }
}

/** The last chain event recorded, or null when the ledger has only side events. */
function lastChainEvent(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (CHAIN.indexOf(events[i].type) !== -1) return events[i];
  }
  return null;
}

/**
 * May `type` follow what has been recorded so far? Returns null when legal, else the reason.
 *
 * Side events are legal once the chain has started and before it has ended — they describe things
 * that happen DURING a handoff, so one recorded against an empty or finished ledger is a lie about
 * when it happened.
 */
function successorProblem(events, type) {
  if (SIDE_EVENTS.has(type)) {
    const last = lastChainEvent(events);
    if (last === null) return "a side event cannot precede the start of the handoff chain";
    if (last.type === "worker-b-release") return "a side event cannot follow the end of the handoff chain";
    return null;
  }
  const idx = CHAIN.indexOf(type);
  if (idx === -1) return "unknown event type: " + type;
  const last = lastChainEvent(events);
  const expected = last === null ? 0 : CHAIN.indexOf(last.type) + 1;
  if (idx !== expected) {
    return (
      "out of order: expected " + (expected < CHAIN.length ? CHAIN[expected] : "(chain complete)") + ", got " + type
    );
  }
  return null;
}

/** Create the ledger for a session. Refuses to overwrite one that already exists. */
function createLedger(root, input) {
  const { sessionId, projectId, phaseId, repositoryRoot, branch } = input;
  if (!SESSION_ID.test(String(sessionId))) throw new Error("continuity-ledger: invalid sessionId");
  const p = ledgerPath(root, sessionId);
  if (fs.existsSync(p)) throw new Error("continuity-ledger: ledger already exists for " + sessionId);
  const ledger = {
    schemaVersion: SCHEMA_VERSION,
    sessionId: sessionId,
    projectId: projectId,
    phaseId: phaseId,
    repositoryRoot: repositoryRoot,
    branch: branch,
    createdAt: new Date().toISOString(),
    events: [],
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return ledger;
}

/**
 * Append one event. Returns the written event.
 *
 * `actor` is WHO the writing process is, recorded from the process itself — `pid` is read here rather
 * than accepted, so an event cannot claim to have been written by a process that did not write it.
 * `author` is the ROLE the event is attributed to, and `owner`/`user` are representable precisely so
 * that their absence during a handoff is something a validator can check.
 */
function appendEvent(root, sessionId, event) {
  const ledger = readLedger(root, sessionId);
  if (ledger === null) throw new Error("continuity-ledger: no ledger for " + sessionId);
  if (!Array.isArray(ledger.events)) throw new Error("continuity-ledger: ledger has no events array");

  const type = String(event.type);
  const problem = successorProblem(ledger.events, type);
  if (problem !== null) throw new Error("continuity-ledger: " + problem);

  const author = String(event.author);
  if (!AUTHOR_ROLES.has(author)) throw new Error("continuity-ledger: unknown author role " + author);

  const at = new Date().toISOString();
  const previous = ledger.events[ledger.events.length - 1];
  // Monotonic. Two events inside the same millisecond are fine; going backwards is not.
  if (previous !== undefined && at < String(previous.at)) {
    throw new Error("continuity-ledger: time went backwards (" + at + " < " + previous.at + ")");
  }

  const written = {
    seq: ledger.events.length + 1,
    type: type,
    at: at,
    author: author,
    actor: {
      module: String(event.module),
      workerId: event.workerId === undefined ? null : String(event.workerId),
      pid: process.pid,
      parentPid: typeof event.parentPid === "number" ? event.parentPid : null,
    },
    detail: event.detail === undefined ? {} : event.detail,
  };
  const next = Object.assign({}, ledger, { events: ledger.events.concat([written]) });
  fs.writeFileSync(ledgerPath(root, sessionId), JSON.stringify(next, null, 2) + "\n", "utf8");
  return written;
}

/** Events of a given type, in order. */
function eventsOfType(ledger, type) {
  if (ledger === null || !Array.isArray(ledger.events)) return [];
  return ledger.events.filter((e) => e && e.type === type);
}

/** The single event of a chain type, or null when it is absent (or, wrongly, duplicated). */
function chainEvent(ledger, type) {
  const found = eventsOfType(ledger, type);
  return found.length === 1 ? found[0] : null;
}

/**
 * Structural + ordering check of a ledger read from disk. Returns error strings.
 *
 * This is the shared truth used by both the validator and any runtime reader, so "what a valid
 * ledger is" is defined once. It checks SHAPE and ORDER only — whether the facts inside it are
 * consistent with the repository is the validator's job, because only the validator knows the repo.
 */
function checkLedgerShape(ledger) {
  const e = [];
  if (ledger === null || typeof ledger !== "object" || Array.isArray(ledger)) return ["ledger is not an object"];
  if (ledger.schemaVersion !== SCHEMA_VERSION) e.push("schemaVersion is not " + SCHEMA_VERSION);
  if (!SESSION_ID.test(String(ledger.sessionId))) e.push("sessionId is missing or not a safe identifier");
  for (const k of ["projectId", "phaseId", "repositoryRoot", "branch", "createdAt"]) {
    if (typeof ledger[k] !== "string" || ledger[k].length === 0) e.push(k + " is missing");
  }
  if (!Array.isArray(ledger.events)) return e.concat(["events is not an array"]);

  let previousAt = null;
  const seen = [];
  ledger.events.forEach((ev, i) => {
    const at = "events[" + i + "]";
    if (ev === null || typeof ev !== "object") { e.push(at + " is not an object"); return; }
    if (ev.seq !== i + 1) e.push(at + ".seq is " + ev.seq + ", expected " + (i + 1));
    if (typeof ev.at !== "string" || ev.at.length === 0) e.push(at + ".at is missing");
    else {
      if (previousAt !== null && ev.at < previousAt) e.push(at + ".at goes backwards");
      previousAt = ev.at;
    }
    if (!AUTHOR_ROLES.has(String(ev.author))) e.push(at + ".author is not a known role: " + ev.author);
    if (ev.actor === null || typeof ev.actor !== "object") e.push(at + ".actor is missing");
    else {
      if (typeof ev.actor.module !== "string" || ev.actor.module.length === 0) e.push(at + ".actor.module is missing");
      if (!Number.isInteger(ev.actor.pid)) e.push(at + ".actor.pid is not an integer");
    }
    const problem = successorProblem(seen, String(ev.type));
    if (problem !== null) e.push(at + " " + problem);
    seen.push(ev);
  });

  // Each chain event happens exactly once. A duplicate means two handoffs share one ledger.
  for (const type of CHAIN) {
    const n = eventsOfType(ledger, type).length;
    if (n > 1) e.push("chain event " + type + " occurs " + n + " times");
  }
  return e;
}

module.exports = {
  SCHEMA_VERSION,
  CHAIN,
  SIDE_EVENTS,
  AUTHOR_ROLES,
  HEX40,
  continuityDir,
  ledgerPath,
  ledgerRelPath,
  readLedger,
  createLedger,
  appendEvent,
  eventsOfType,
  chainEvent,
  checkLedgerShape,
  successorProblem,
};
