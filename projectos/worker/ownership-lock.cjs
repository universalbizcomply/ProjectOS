"use strict";
/**
 * One writer per checkout — S1, S2, S11, S12.
 *
 * The property: at most one worker may mutate a given checkout at a time, and a worker that has
 * released ownership must FAIL its next write rather than quietly succeed. The second half is the
 * one that is easy to skip and is the whole point: after a handoff, Worker A stopping is not proof
 * that Worker A was prevented. `assertOwner` is what turns "A stopped" into "A could not have
 * written", and the refusal it throws is recorded in the ledger as evidence.
 *
 * S11 — TAKEOVER IS EXPLICIT AND SLOW ON PURPOSE. A crashed holder must not deadlock the checkout
 * forever, but a heartbeat that expires too eagerly turns a slow worker into a duplicated one, which
 * is worse: two writers, no error. So takeover requires the heartbeat to be stale by a wide margin
 * AND the holder's process to be genuinely gone, and it records who took over from whom. A holder
 * whose process is still alive is never displaced, however quiet it has been.
 *
 * S12 — acquisition is idempotent-by-refusal: a second acquire against a live holder refuses rather
 * than queueing, so a duplicate replacement attempt cannot become a second writer.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");
const { continuityDir } = require("./continuity-ledger.cjs");

/** Wide on purpose — see S11. A live worker renews every few seconds; this is minutes of slack. */
const HEARTBEAT_STALE_MS = 120000;

function lockPath(root) {
  return path.join(continuityDir(root), "ownership.lock.json");
}

function readLock(root) {
  try {
    return JSON.parse(fs.readFileSync(lockPath(root), "utf8").replace(/^﻿/, ""));
  } catch (_) {
    return null;
  }
}

function writeLock(root, lock) {
  const p = lockPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n", "utf8");
}

/**
 * Create the lock file only if it does not exist. Returns false when someone else created it first.
 *
 * `wx` is the whole point: the existence check and the creation are one operation in the filesystem,
 * so two racing acquirers cannot both succeed. Any error other than EEXIST is also a refusal — a
 * lock we could not create is a lock we do not hold.
 */
function createExclusive(root, lock) {
  const p = lockPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Is the process holding this lock still running?
 *
 * `kill(pid, 0)` asks the OS without signalling. EPERM means the process exists and belongs to
 * someone else — still ALIVE, and treating it as dead would be the eager-takeover bug. Only ESRCH
 * ("no such process") is death, and any other error is treated as alive, because failing towards
 * "the holder is still there" refuses a takeover while failing the other way permits two writers.
 */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "ESRCH" ? false : true;
  }
}

function isStale(lock, nowMs) {
  if (lock === null) return true;
  const beat = Date.parse(String(lock.heartbeatAt));
  if (!Number.isFinite(beat)) return true;
  return nowMs - beat > HEARTBEAT_STALE_MS;
}

/**
 * Acquire ownership for `workerId`. Returns `{acquired, lock, reason}` — never throws for a normal
 * refusal, because "someone else holds it" is an ordinary answer and must be handled, not caught.
 *
 * `takeover` is opt-in. Without it, a stale lock still refuses: silently stealing a checkout because
 * a heartbeat lapsed is exactly the race S11 warns about.
 */
function acquire(root, workerId, options) {
  const opts = options || {};
  const now = new Date();
  const nowMs = now.getTime();
  const existing = readLock(root);

  if (existing !== null && existing.released !== true) {
    const alive = processAlive(existing.holder && existing.holder.pid);
    if (alive) {
      return {
        acquired: false,
        lock: existing,
        reason:
          "checkout is owned by " + String(existing.holder && existing.holder.workerId) +
          " (pid " + String(existing.holder && existing.holder.pid) + "), which is still running",
      };
    }
    if (!isStale(existing, nowMs)) {
      return {
        acquired: false,
        lock: existing,
        reason:
          "the previous holder's process is gone but its heartbeat is still fresh; refusing to take over " +
          "until it has been stale for " + HEARTBEAT_STALE_MS + "ms",
      };
    }
    if (opts.takeover !== true) {
      return {
        acquired: false,
        lock: existing,
        reason: "a stale lock is present; takeover must be explicit",
      };
    }
  }

  const lock = {
    holder: { workerId: String(workerId), pid: process.pid, startedAt: now.toISOString() },
    heartbeatAt: now.toISOString(),
    released: false,
    checkoutRoot: root,
    tookOverFrom:
      existing !== null && existing.released !== true
        ? { workerId: String(existing.holder && existing.holder.workerId), pid: existing.holder && existing.holder.pid }
        : null,
  };

  // ATOMICITY. Read-then-write is a race: two processes can both find the lock free, both build one,
  // and both write — last write wins, silently, and there are two writers. Every acquisition path
  // therefore ends in an EXCLUSIVE create (`wx`), where the filesystem arbitrates. Clearing a
  // released or taken-over lock first is safe because the create still decides the winner: whoever
  // loses gets EEXIST and REFUSES rather than retrying, which is the correct answer to "someone else
  // got there first".
  if (existing !== null) {
    try { fs.unlinkSync(lockPath(root)); } catch (_) { /* gone already, or the create below refuses */ }
  }
  if (!createExclusive(root, lock)) {
    return { acquired: false, lock: readLock(root), reason: "another process took ownership of this checkout first" };
  }
  return { acquired: true, lock: lock, reason: "" };
}

/** Renew the heartbeat. Refuses when this process is not the recorded holder. */
function heartbeat(root, workerId) {
  const lock = readLock(root);
  if (lock === null || lock.released === true) return { ok: false, reason: "no lock is held" };
  if (lock.holder.workerId !== String(workerId) || lock.holder.pid !== process.pid) {
    return { ok: false, reason: "this process is not the recorded holder" };
  }
  writeLock(root, Object.assign({}, lock, { heartbeatAt: new Date().toISOString() }));
  return { ok: true, reason: "" };
}

/** Release ownership. Only the recorded holder may release; releasing twice is a refusal, not a no-op. */
function release(root, workerId) {
  const lock = readLock(root);
  if (lock === null) return { ok: false, reason: "no lock exists" };
  if (lock.released === true) return { ok: false, reason: "the lock is already released" };
  if (lock.holder.workerId !== String(workerId)) {
    return { ok: false, reason: "only the holder may release: held by " + lock.holder.workerId };
  }
  writeLock(root, Object.assign({}, lock, { released: true, releasedAt: new Date().toISOString() }));
  return { ok: true, reason: "" };
}

/** Who owns the checkout right now, if anyone. */
function currentHolder(root) {
  const lock = readLock(root);
  if (lock === null || lock.released === true) return null;
  return lock.holder;
}

/**
 * S2. Throw unless this process still owns the checkout.
 *
 * Every mutation a worker performs goes through here, so a released or displaced worker's next write
 * fails loudly instead of racing the new owner. The thrown message is the text recorded in the
 * ledger as the ownership proof, which is why it names the actual holder.
 */
function assertOwner(root, workerId) {
  const lock = readLock(root);
  if (lock === null) throw new Error("ownership-lock: refused — no ownership lock is held for this checkout");
  if (lock.released === true) {
    throw new Error(
      "ownership-lock: refused — " + String(workerId) + " released ownership of this checkout and may no longer write",
    );
  }
  if (lock.holder.workerId !== String(workerId)) {
    throw new Error(
      "ownership-lock: refused — this checkout is owned by " + String(lock.holder.workerId) +
        ", not " + String(workerId),
    );
  }
  if (lock.holder.pid !== process.pid) {
    throw new Error(
      "ownership-lock: refused — ownership is recorded for pid " + String(lock.holder.pid) +
        ", not this process (" + process.pid + ")",
    );
  }
  return true;
}

module.exports = {
  HEARTBEAT_STALE_MS,
  lockPath,
  readLock,
  processAlive,
  isStale,
  acquire,
  heartbeat,
  release,
  currentHolder,
  assertOwner,
};
