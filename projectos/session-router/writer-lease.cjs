"use strict";
/**
 * Writer leases — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L3 concurrency control).
 *
 * The rule: ONE WRITER PER CHECKOUT. Any number of readers may work against a checkout at once; at most
 * one modifying session may hold it. Two modifying sessions on the same project are legal only when they
 * occupy separate git worktrees — which is exactly what keying the lease on the CHECKOUT gives us.
 *
 * The lease key is the SHA-256 of the CANONICAL checkout path (`fs.realpathSync.native`, case-folded on
 * Windows). Canonicalisation is the security-relevant part: a junction, a symlink, a `..` detour, a
 * short (8.3) name or a differently-cased spelling of the same directory all resolve to one key, so a
 * second writer cannot slip past the lease by describing the same checkout differently.
 *
 * Leases live outside every repository (`%LOCALAPPDATA%\ProjectOS\leases`, `~/.projectos/leases`
 * elsewhere) and are acquired by atomic exclusive create (`wx`) — the filesystem, not a read-then-write
 * race, decides the winner.
 *
 * A lease is reclaimable only when it is provably dead: its heartbeat has expired AND its recorded PID is
 * no longer alive. Reclaiming NEVER signals or kills the other process.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const LEASE_SUFFIX = ".lease.json";

function defaultLeaseDir() {
  if (process.platform === "win32" && typeof process.env.LOCALAPPDATA === "string" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "ProjectOS", "leases");
  }
  return path.join(os.homedir(), ".projectos", "leases");
}

/**
 * Resolve a checkout path to its canonical form. Throws when the path does not exist — a lease may never
 * be taken against a directory we cannot canonicalise, because we could not then prove two requests mean
 * the same checkout.
 */
function canonicalRoot(checkoutPath, realpath) {
  if (typeof checkoutPath !== "string" || !checkoutPath) throw new Error("writer-lease: checkout path required");
  const resolver = realpath || (fs.realpathSync.native ? fs.realpathSync.native : fs.realpathSync);
  let real;
  try {
    real = resolver(path.resolve(checkoutPath));
  } catch (e) {
    throw new Error("writer-lease: checkout path does not resolve to a real directory");
  }
  // Windows paths are case-insensitive; fold so two spellings cannot take two leases on one checkout.
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function leaseKey(canonical) {
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs the permission/existence check without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM"; // exists but owned by another user — treat as alive
  }
}

function createLeaseStore(opts) {
  const options = opts || {};
  const leaseDir = typeof options.leaseDir === "string" && options.leaseDir ? options.leaseDir : defaultLeaseDir();
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : () => Date.now();
  const isAlive = typeof options.isProcessAlive === "function" ? options.isProcessAlive : processAlive;
  const realpath = typeof options.realpath === "function" ? options.realpath : null;

  function leasePath(key) {
    return path.join(leaseDir, key + LEASE_SUFFIX);
  }

  function readLease(key) {
    const file = leasePath(key);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      // A corrupt lease file is not a valid holder; treat it as reclaimable rather than blocking forever.
      return null;
    }
  }

  /** Expired heartbeat AND a dead PID. Either alone keeps the lease held. */
  function isStale(lease) {
    if (!lease) return true;
    const expired = !Number.isFinite(lease.expiresAtMs) || lease.expiresAtMs <= nowMs();
    return expired && !isAlive(lease.pid);
  }

  function write(key, lease) {
    fs.mkdirSync(leaseDir, { recursive: true });
    fs.writeFileSync(leasePath(key), JSON.stringify(lease, null, 2) + "\n", { encoding: "utf8", flag: "w", mode: 0o600 });
  }

  /**
   * Acquire the writer lease for a checkout.
   * @returns { ok:true, lease } or { ok:false, reason:"WRITE LEASE CONFLICT", heldBy }
   */
  function acquire(input) {
    const req = input || {};
    const canonical = canonicalRoot(req.checkoutPath, realpath);
    const key = leaseKey(canonical);
    const lease = {
      projectId: req.projectId,
      canonicalRepositoryRoot: canonical,
      worktreePath: path.resolve(req.checkoutPath),
      branch: typeof req.branch === "string" ? req.branch : null,
      sessionId: req.sessionId,
      pid: Number.isInteger(req.pid) ? req.pid : process.pid,
      phaseId: typeof req.phaseId === "string" ? req.phaseId : null,
      startedAtMs: nowMs(),
      heartbeatAtMs: nowMs(),
      expiresAtMs: nowMs() + ttlMs,
    };
    if (typeof lease.projectId !== "string" || !lease.projectId) throw new Error("writer-lease: projectId required");
    if (typeof lease.sessionId !== "string" || !lease.sessionId) throw new Error("writer-lease: sessionId required");

    fs.mkdirSync(leaseDir, { recursive: true });
    const file = leasePath(key);

    // Every acquisition — first take AND reclaim — goes through the same exclusive create, so the
    // filesystem picks exactly one winner. A reclaim that merely overwrote the stale file would let two
    // racing acquirers both believe they hold the lease.
    const tryCreate = (extra) => {
      try {
        const fd = fs.openSync(file, "wx", 0o600);
        const record = { ...lease, ...(extra || {}) };
        try { fs.writeFileSync(fd, JSON.stringify(record, null, 2) + "\n", "utf8"); } finally { fs.closeSync(fd); }
        return { ok: true, lease: record };
      } catch (e) {
        if (!e || e.code !== "EEXIST") throw e;
        return null;
      }
    };

    const conflict = (held) => ({
      ok: false,
      reason: "WRITE LEASE CONFLICT",
      // Identity of the holder only — no credential, no environment, no command line.
      heldBy: held ? { projectId: held.projectId, sessionId: held.sessionId, pid: held.pid, worktreePath: held.worktreePath, branch: held.branch, phaseId: held.phaseId } : null,
    });

    // Two attempts: the initial take, and one reclaim after removing a provably dead holder. Bounded on
    // purpose — if someone else won the reclaim in between, they hold it and we report the conflict.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const created = tryCreate(attempt === 0 ? null : { reclaimedFromSessionId: lease.reclaimedFromSessionId || null });
      if (created) return created;
      const held = readLease(key);
      if (!isStale(held)) return conflict(held);
      if (attempt === 1) return conflict(held);
      // Provably dead holder: remove the stale file, then race for the exclusive create like anyone else.
      // The dead process is never signalled.
      lease.reclaimedFromSessionId = held ? held.sessionId : null;
      try { fs.rmSync(file, { force: true }); } catch (e) { /* another acquirer may have removed it first */ }
    }
    return conflict(readLease(key));
  }

  /** Extend a lease we still hold. Refuses to extend another session's lease. */
  function heartbeat(input) {
    const req = input || {};
    const key = leaseKey(canonicalRoot(req.checkoutPath, realpath));
    const held = readLease(key);
    if (!held || held.sessionId !== req.sessionId) return { ok: false, reason: "not-lease-holder" };
    const updated = { ...held, heartbeatAtMs: nowMs(), expiresAtMs: nowMs() + ttlMs };
    write(key, updated);
    return { ok: true, lease: updated };
  }

  /** Release a lease we hold. Refuses to release another session's lease. */
  function release(input) {
    const req = input || {};
    const key = leaseKey(canonicalRoot(req.checkoutPath, realpath));
    const held = readLease(key);
    if (!held) return { ok: true, reason: "no-lease" };
    if (held.sessionId !== req.sessionId) return { ok: false, reason: "not-lease-holder" };
    fs.rmSync(leasePath(key), { force: true });
    return { ok: true };
  }

  function inspect(checkoutPath) {
    const canonical = canonicalRoot(checkoutPath, realpath);
    const held = readLease(leaseKey(canonical));
    return { canonicalRepositoryRoot: canonical, held: held || null, stale: isStale(held) };
  }

  function list() {
    if (!fs.existsSync(leaseDir)) return [];
    return fs
      .readdirSync(leaseDir)
      .filter((f) => f.endsWith(LEASE_SUFFIX))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(leaseDir, f), "utf8")); } catch (e) { return null; }
      })
      .filter(Boolean)
      .map((l) => ({ ...l, stale: isStale(l) }));
  }

  return { leaseDir, acquire, heartbeat, release, inspect, list, canonicalRoot: (p) => canonicalRoot(p, realpath) };
}

module.exports = { createLeaseStore, canonicalRoot, leaseKey, defaultLeaseDir, DEFAULT_TTL_MS };
