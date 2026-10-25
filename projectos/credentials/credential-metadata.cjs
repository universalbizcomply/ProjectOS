"use strict";
/**
 * Credential metadata store — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L2 sidecar).
 *
 * Records what ProjectOS is allowed to KNOW about a credential without holding it: when it was first
 * provisioned, when it was last rotated, an optional expiry, a free-text non-secret note and the
 * non-reversible fingerprint. This is what `credentials status` and `credentials doctor` read.
 *
 * The file lives OUTSIDE any repository (default `%LOCALAPPDATA%\ProjectOS\credential-metadata.json`,
 * `~/.projectos/` elsewhere) so it can never be committed. Every field is non-secret by construction:
 * the writer refuses any record carrying a `value`-shaped field, and refuses a note long enough to hide
 * a token.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseReference, fingerprint } = require("./reference.cjs");
const { matchedShapes } = require("./credential-shapes.cjs");

const FILE_NAME = "credential-metadata.json";
const LOCK_NAME = "credential-metadata.lock";
const MAX_NOTE = 120;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCK_TIMEOUT_MS = 5000;
// Fields that could smuggle a secret into a file that is otherwise safe to read, print and back up.
const FORBIDDEN_FIELDS = ["value", "secret", "password", "token", "key", "blob", "plaintext"];

function defaultStateDir() {
  if (process.platform === "win32" && typeof process.env.LOCALAPPDATA === "string" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "ProjectOS");
  }
  return path.join(os.homedir(), ".projectos");
}

function createMetadataStore(opts) {
  const options = opts || {};
  const stateDir = typeof options.stateDir === "string" && options.stateDir ? options.stateDir : defaultStateDir();
  const filePath = path.join(stateDir, FILE_NAME);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  function readAll() {
    if (!fs.existsSync(filePath)) return {};
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      throw new Error("credential-metadata: metadata file is not valid JSON — refusing to guess");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = Object.create(null);
    for (const key of Object.keys(parsed)) {
      if (parseReference(key).ok) out[key] = parsed[key];
    }
    return out;
  }

  function writeAll(records) {
    fs.mkdirSync(stateDir, { recursive: true });
    // Sorted keys so the file is stable and reviewable; write then rename for atomicity.
    const ordered = {};
    for (const key of Object.keys(records).sort()) ordered[key] = records[key];
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(ordered, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  function assertNonSecret(record) {
    for (const field of FORBIDDEN_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(record, field)) {
        throw new Error("credential-metadata: refusing to persist a '" + field + "' field");
      }
    }
    if (typeof record.note === "string" && record.note.length > MAX_NOTE) {
      throw new Error("credential-metadata: note exceeds the non-secret length limit");
    }
    // A length cap alone is cosmetic — a GitHub PAT is well under 120 characters. Inspect the CONTENT so
    // an operator who pastes a token into --note is refused rather than silently persisting it here,
    // outside the redactor's registry and inside a file `status` prints verbatim.
    if (typeof record.note === "string" && matchedShapes(record.note).length) {
      throw new Error("credential-metadata: refusing a note that contains credential-shaped text");
    }
    // `expiresAt` is free text on the CLI too, so it is a second door into this file. Require a real
    // ISO-8601 instant rather than scanning it — a structural format check cannot be talked past.
    if (record.expiresAt !== undefined && record.expiresAt !== null) {
      if (typeof record.expiresAt !== "string" || !ISO_INSTANT_RE.test(record.expiresAt) || !Number.isFinite(Date.parse(record.expiresAt))) {
        throw new Error("credential-metadata: expiresAt must be an ISO-8601 instant, e.g. 2026-12-31T00:00:00Z");
      }
    }
  }

  /**
   * Serialise the read-modify-write cycle. Without this, two concurrent `credentials set` runs both read
   * the same snapshot and the later write silently drops the earlier one.
   *
   * The lock is an exclusive create — the same primitive the writer lease uses — and it RECORDS ITS PID.
   * A lock is reclaimed only when it is both old AND its holder is gone. A time-only check would let a
   * second writer steal the lock from a still-running first writer whose critical section happened to
   * exceed the timeout (a slow roaming profile, an antivirus scan, a GC pause), reintroducing exactly the
   * lost-update race this exists to prevent.
   */
  function withLock(fn) {
    const lockPath = path.join(stateDir, LOCK_NAME);
    fs.mkdirSync(stateDir, { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS * 4;
    for (;;) {
      try {
        const fd = fs.openSync(lockPath, "wx");
        try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, takenAtMs: Date.now() }), "utf8"); } finally { fs.closeSync(fd); }
        break;
      } catch (e) {
        if (!e || e.code !== "EEXIST") throw e;
        if (isLockAbandoned(lockPath)) {
          try { fs.rmSync(lockPath, { force: true }); } catch (rmError) { /* another writer won the cleanup */ }
          continue;
        }
        if (Date.now() > deadline) throw new Error("credential-metadata: could not acquire the metadata lock");
        // Synchronous back-off: this module's API is synchronous, so a spin without a wait would burn a
        // core while the other writer finishes.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try { return fn(); } finally { try { fs.rmSync(lockPath, { force: true }); } catch (e) { /* best effort */ } }
  }

  /** Old AND ownerless. A live holder keeps the lock however long its critical section takes. */
  function isLockAbandoned(lockPath) {
    let holder = null;
    try { holder = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch (e) { holder = null; }
    if (!holder || !Number.isInteger(holder.pid) || !Number.isFinite(holder.takenAtMs)) return true; // unreadable = not a valid holder
    if (Date.now() - holder.takenAtMs <= LOCK_TIMEOUT_MS) return false;
    if (holder.pid === process.pid) return false; // our own lock; never steal from ourselves
    try { process.kill(holder.pid, 0); return false; } catch (e) { return !(e && e.code === "EPERM"); }
  }

  /** Record a provisioning or replacement. `value` is used ONLY to derive a fingerprint; never stored. */
  function recordProvision(reference, value, extra) {
    const parsed = parseReference(reference);
    if (!parsed.ok) throw new Error("credential-metadata: " + parsed.reason);
    const record = { ...(extra || {}) };
    assertNonSecret(record);
    return withLock(() => recordProvisionLocked(parsed, value, record, reference));
  }

  function recordProvisionLocked(parsed, value, record, reference) {
    const all = readAll();
    const previous = all[reference];
    const stamp = now();
    all[reference] = {
      project: parsed.ref.project,
      environment: parsed.ref.environment,
      provider: parsed.ref.provider,
      credential: parsed.ref.credential,
      risk: parsed.ref.risk,
      fingerprint: fingerprint(value),
      createdAt: previous && previous.createdAt ? previous.createdAt : stamp,
      rotatedAt: stamp,
      expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : (previous ? previous.expiresAt : null) || null,
      note: typeof record.note === "string" ? record.note : null,
    };
    writeAll(all);
    return { ...all[reference], reference };
  }

  /** Update rotation-tracking fields only. Cannot introduce or change a fingerprint. */
  function recordRotationMetadata(reference, extra) {
    const parsed = parseReference(reference);
    if (!parsed.ok) throw new Error("credential-metadata: " + parsed.reason);
    const record = { ...(extra || {}) };
    assertNonSecret(record);
    return withLock(() => {
      const all = readAll();
      const existing = all[reference];
      if (!existing) throw new Error("credential-metadata: no metadata for this reference");
      all[reference] = {
        ...existing,
        expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : existing.expiresAt || null,
        note: typeof record.note === "string" ? record.note : existing.note || null,
      };
      writeAll(all);
      return { ...all[reference], reference };
    });
  }

  function remove(reference) {
    return withLock(() => removeLocked(reference));
  }

  function removeLocked(reference) {
    const all = readAll();
    if (!Object.prototype.hasOwnProperty.call(all, reference)) return false;
    delete all[reference];
    writeAll(all);
    return true;
  }

  function get(reference) {
    const all = readAll();
    return Object.prototype.hasOwnProperty.call(all, reference) ? { ...all[reference], reference } : null;
  }

  function list(filter) {
    const f = filter || {};
    const all = readAll();
    return Object.keys(all)
      .map((reference) => ({ ...all[reference], reference }))
      .filter((r) => (!f.project || r.project === f.project) && (!f.environment || r.environment === f.environment) && (!f.provider || r.provider === f.provider))
      .sort((a, b) => a.reference.localeCompare(b.reference));
  }

  /** True when the recorded expiry is in the past. Missing expiry is never treated as expired. */
  function isExpired(record, nowIso) {
    if (!record || typeof record.expiresAt !== "string" || !record.expiresAt) return false;
    const expiry = Date.parse(record.expiresAt);
    const at = Date.parse(nowIso || now());
    return Number.isFinite(expiry) && Number.isFinite(at) && expiry <= at;
  }

  return { filePath, stateDir, recordProvision, recordRotationMetadata, remove, get, list, isExpired };
}

module.exports = { createMetadataStore, defaultStateDir, FILE_NAME, MAX_NOTE };
