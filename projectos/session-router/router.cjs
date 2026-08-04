"use strict";
/**
 * Project session router — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L3).
 *
 * Turns "work on PolyGo staging in slot polygo-1" into a child process that can see exactly that project's
 * credentials and nothing else. The order is fixed and every step can only narrow what follows:
 *
 *   1. read the checkout's real facts (root, branch, origin)                — read-only, no credential
 *   2. resolve the session profile and the credentials it is allowed to hold — allowlist, never a class
 *   3. ask the vault which of those are present / expired                    — metadata only
 *   4. acquire the checkout's writer lease if the profile is a writer        — one writer per checkout
 *   5. run the identity preflight                                           — READY or ONE blocker
 *   6. mint session grants and build a fresh child environment              — provider vars scrubbed first
 *   7. spawn the child                                                      — values live only in its env
 *
 * If any step fails, the lease acquired in step 4 is released before returning, so a failed preflight
 * never leaves a checkout blocked.
 *
 * `process.env` is never modified. The projected environment is built fresh, handed to `spawn`, and the
 * router's own reference to it is dropped as soon as the child exists. Session records on disk hold
 * references and fingerprints only — never a value.
 *
 * `stop` releases the lease and removes the record. It does NOT signal any process: another session's
 * work is never killed, and an interrupted session is reclaimed only through lease expiry plus a dead PID.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");

const { createRegistry } = require("../providers/registry.cjs");
const { createProjectRegistry } = require("./project-registry.cjs");
const { createLeaseStore } = require("./writer-lease.cjs");
const { createRepositoryReader } = require("./repository-facts.cjs");
const { evaluatePreflight, READY } = require("./identity-preflight.cjs");
const { getProfile, permitsCredential } = require("./session-profiles.cjs");
const { buildChildEnvironment } = require("./env-projection.cjs");
const { formatReference, parseReference } = require("../credentials/reference.cjs");

const SLOT_RE = /^[a-z][a-z0-9-]{1,40}$/;

function defaultStateDir() {
  if (process.platform === "win32" && typeof process.env.LOCALAPPDATA === "string" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "ProjectOS");
  }
  return path.join(os.homedir(), ".projectos");
}

/** Read a project's non-secret connection profile. Never contains a credential value. */
function loadConnection(checkoutPath) {
  const file = path.join(checkoutPath, ".projectops", "connections.json");
  if (!fs.existsSync(file)) return { ok: false, reason: "no .projectops/connections.json in this checkout" };
  try {
    return { ok: true, connection: JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) };
  } catch (e) {
    return { ok: false, reason: "connections.json is not valid JSON" };
  }
}

function createSessionRouter(opts) {
  const options = opts || {};
  const vault = options.vault;
  if (!vault || typeof vault.authoriseSessionRelease !== "function") throw new Error("session-router: a credential vault is required");
  const registry = options.registry || createRegistry();
  const stateDir = typeof options.stateDir === "string" && options.stateDir ? options.stateDir : defaultStateDir();
  const sessionDir = path.join(stateDir, "sessions");
  const projectRegistry = options.projectRegistry || createProjectRegistry({ stateDir });
  const leases = options.leaseStore || createLeaseStore({ leaseDir: path.join(stateDir, "leases") });
  const repositories = options.repositoryReader || createRepositoryReader();
  const spawn = typeof options.spawn === "function" ? options.spawn : childProcess.spawn;
  const nowIso = typeof options.nowIso === "function" ? options.nowIso : () => new Date().toISOString();

  function assertSlot(slot) {
    if (typeof slot !== "string" || !SLOT_RE.test(slot)) throw new Error("session-router: invalid session slot name");
    return slot;
  }

  function recordPath(slot) {
    return path.join(sessionDir, slot + ".session.json");
  }

  function writeRecord(record) {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(recordPath(record.slot), JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  }

  function readRecord(slot) {
    const file = recordPath(slot);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
  }

  /** Which credential references this session needs, per provider adapter AND per profile allowlist. */
  function requiredCredentials(connection, profile, environment) {
    const wanted = [];
    for (const providerName of Array.isArray(connection.providers) ? connection.providers : []) {
      const adapter = registry.get(providerName);
      if (!adapter || !Array.isArray(adapter.sessionCredentials)) continue;
      for (const entry of adapter.sessionCredentials) {
        // The profile is the final authority: a provider offering a credential does not make it loadable.
        if (!permitsCredential(profile.name, entry.credential)) continue;
        // A provider may additionally veto its own credential (Supabase does this for operation-scoped ones).
        if (typeof adapter.assertCredentialProjectable === "function" && adapter.assertCredentialProjectable(entry.credential).allowed !== true) continue;
        wanted.push({
          provider: providerName,
          key: entry.key,
          credential: entry.credential,
          reference: formatReference({ project: connection.projectId, environment, provider: providerName, credential: entry.credential }),
        });
      }
    }
    return wanted;
  }

  /** Metadata-only presence/expiry view of the references this session needs. */
  function credentialStatus(wanted) {
    const rows = vault.status({});
    const byReference = new Map(rows.map((r) => [r.reference, r]));
    return wanted.map((w) => {
      const row = byReference.get(w.reference) || null;
      return { ...w, present: !!(row && row.present), expired: !!(row && row.expired) };
    });
  }

  /**
   * Everything up to and including the preflight. Returns the decision plus, when READY, the material the
   * caller needs to start a child. Acquires the writer lease when the profile requires one, and releases
   * it again if the preflight then fails.
   */
  function prepare(input) {
    const req = input || {};
    const slot = assertSlot(req.slot);
    const environment = req.environment;
    const profile = getProfile(req.profileName);
    if (!profile) return { status: "PRODUCTION PROFILE REFUSED", ready: false, blocker: "PRODUCTION PROFILE REFUSED", detail: "unknown session profile", slot };

    const loaded = req.connection ? { ok: true, connection: req.connection } : loadConnection(req.checkoutPath);
    if (!loaded.ok) return { status: "REPOSITORY MISMATCH", ready: false, blocker: "REPOSITORY MISMATCH", detail: loaded.reason, slot };
    const connection = loaded.connection;

    const configErrors = registry.validateConnection(connection);
    if (configErrors.length) {
      return { status: "REPOSITORY MISMATCH", ready: false, blocker: "REPOSITORY MISMATCH", detail: "connection profile is invalid: " + configErrors[0], slot };
    }

    const observed = req.repository ? { ok: true, facts: req.repository } : repositories.read(req.checkoutPath);
    if (!observed.ok) return { status: "REPOSITORY MISMATCH", ready: false, blocker: "REPOSITORY MISMATCH", detail: observed.reason, slot };
    const repository = observed.facts;

    const wanted = requiredCredentials(connection, profile, environment);
    const credentials = credentialStatus(wanted);

    // Acquire the lease only for a writer profile, and only once the profile/environment pair is sane.
    let lease = null;
    const sessionId = "sess_" + crypto.randomBytes(9).toString("hex");
    if (profile.requiresWriteLease === true) {
      lease = leases.acquire({
        projectId: connection.projectId,
        checkoutPath: repository.checkoutPath,
        branch: repository.branch,
        sessionId,
        pid: process.pid,
        phaseId: typeof req.phaseId === "string" ? req.phaseId : null,
      });
    }

    // The lease is already on disk. If the preflight THROWS (an unreadable owner registry, say) the
    // `!decision.ready` cleanup below never runs, so release here too rather than stranding the checkout.
    let decision;
    try {
      decision = evaluatePreflight({
        connection,
        environment,
        profileName: profile.name,
        repository,
        observations: req.observations || {},
        credentials,
        permit: req.permit || null,
        lease,
        registry,
        projectRegistry,
      });
    } catch (e) {
      if (lease && lease.ok) leases.release({ checkoutPath: repository.checkoutPath, sessionId });
      throw e;
    }

    if (!decision.ready) {
      // Never leave a checkout blocked by a session that did not start.
      if (lease && lease.ok) leases.release({ checkoutPath: repository.checkoutPath, sessionId });
      return { ...decision, slot, projectId: connection.projectId, environment, profile: profile.name };
    }

    return {
      ...decision,
      slot,
      sessionId,
      projectId: connection.projectId,
      environment,
      profile: profile.name,
      connection,
      repository,
      credentials,
      leaseHeld: !!(lease && lease.ok),
    };
  }

  /**
   * Build the child environment for a prepared session. Grants are redeemed here and the values are placed
   * straight into the returned object; the caller must pass it to `spawn` and keep no other copy.
   */
  function projectEnvironment(prepared, baseEnv) {
    const perProvider = new Map();
    for (const credential of prepared.credentials) {
      const grant = vault.authoriseSessionRelease({ reference: credential.reference, projectId: prepared.projectId, sessionId: prepared.sessionId });
      const value = vault.releaseIntoChildEnvironment(grant);
      const bucket = perProvider.get(credential.provider) || {};
      bucket[credential.key] = value;
      perProvider.set(credential.provider, bucket);
    }
    const contributions = {};
    for (const providerName of Array.isArray(prepared.connection.providers) ? prepared.connection.providers : []) {
      const adapter = registry.get(providerName);
      if (!adapter) continue;
      const values = perProvider.get(providerName) || {};
      Object.assign(contributions, adapter.projectEnvironment(prepared.connection, prepared.environment, values));
    }
    return buildChildEnvironment({ baseEnv, providerEnvVars: registry.allEnvVars(), contributions });
  }

  /** Non-secret record of a running session. References and fingerprints only — never a value. */
  function buildRecord(prepared, pid) {
    return {
      slot: prepared.slot,
      sessionId: prepared.sessionId,
      projectId: prepared.projectId,
      profile: prepared.profile,
      environment: prepared.environment,
      checkoutPath: prepared.repository.checkoutPath,
      canonicalRepositoryRoot: prepared.repository.canonicalRoot,
      branch: prepared.repository.branch,
      pid: pid || null,
      startedAt: nowIso(),
      leaseHeld: prepared.leaseHeld === true,
      credentialReferences: prepared.credentials.map((c) => c.reference),
    };
  }

  /**
   * Start a session: prepare, project the environment, spawn one child. Returns the decision and the
   * non-secret session record. The projected environment is never returned to the caller.
   */
  function start(input) {
    const prepared = prepare(input);
    if (!prepared.ready) return prepared;

    const command = (input || {}).command;
    const args = Array.isArray((input || {}).args) ? (input || {}).args : [];

    // The lease is already on disk by this point. EVERY failure from here on must release it, or a
    // session that never started would block the checkout until its TTL expired.
    const releaseLease = () => {
      if (prepared.leaseHeld) {
        try { leases.release({ checkoutPath: prepared.repository.checkoutPath, sessionId: prepared.sessionId }); }
        catch (e) { /* the lease will still expire; nothing better is available here */ }
      }
    };

    // Provider vetoes apply to the command itself, not only to credentials. `gh auth switch` is refused
    // here — before any credential is redeemed — because flipping the machine-global GitHub account would
    // break every other running session; a guard that is merely refusable in principle enforces nothing.
    const vetoed = vetoCommand(command, args);
    if (vetoed) {
      releaseLease();
      return { status: "PRODUCTION PROFILE REFUSED", ready: false, blocker: "PRODUCTION PROFILE REFUSED", detail: vetoed, slot: prepared.slot, projectId: prepared.projectId, environment: prepared.environment, profile: prepared.profile };
    }

    let projected;
    let child = null;
    try {
      projected = projectEnvironment(prepared, (input || {}).baseEnv);
      if (typeof command === "string" && command) {
        child = spawn(command, args, {
          cwd: prepared.repository.checkoutPath,
          env: projected.env,
          stdio: (input || {}).stdio || "inherit",
          windowsHide: true,
        });
        // Without an 'error' listener a failed spawn (a missing executable, a .cmd shim) is emitted as an
        // uncaught exception on the child's EventEmitter and takes the whole process down.
        if (typeof child.on === "function") child.on("error", () => { try { stop({ slot: prepared.slot, sessionId: prepared.sessionId }); } catch (e) { /* best effort */ } });
      }
    } catch (e) {
      releaseLease();
      throw e;
    }

    const record = buildRecord(prepared, child ? child.pid : null);
    writeRecord(record);

    // When the child exits the injected environment dies with it; drop our own record of the lease too.
    // NOTE: this only fires if the host process outlives the child — a caller that spawns and immediately
    // exits must call `stop` itself. The CLI does exactly that by awaiting the child.
    if (child && typeof child.on === "function") {
      child.on("exit", () => {
        try { stop({ slot: record.slot, sessionId: record.sessionId }); } catch (e) { /* stop is best-effort on exit */ }
      });
    }
    return { ...prepared, connection: undefined, credentials: undefined, record, envSummary: { scrubbed: projected.scrubbed, added: projected.added }, child };
  }

  /** Ask every registered provider whether this command line is permissible. Returns a reason, or null. */
  function vetoCommand(command, args) {
    if (typeof command !== "string" || !command) return null;
    const line = [command, ...args].join(" ");
    for (const name of registry.names()) {
      const adapter = registry.get(name);
      if (typeof adapter.assertCommandAllowed === "function") {
        const verdict = adapter.assertCommandAllowed(line);
        if (verdict && verdict.allowed !== true) return verdict.reason;
      }
      if (typeof adapter.assertCommandArgumentsClean === "function") {
        const verdict = adapter.assertCommandArgumentsClean(args);
        if (verdict && verdict.allowed !== true) return verdict.reason;
      }
    }
    return null;
  }

  function status(input) {
    const req = input || {};
    if (req.slot) {
      const record = readRecord(assertSlot(req.slot));
      return record ? [record] : [];
    }
    if (!fs.existsSync(sessionDir)) return [];
    return fs
      .readdirSync(sessionDir)
      .filter((f) => f.endsWith(".session.json"))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(sessionDir, f), "utf8")); } catch (e) { return null; } })
      .filter(Boolean)
      .sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
  }

  /** Release the lease and forget the session. Signals nothing; another process is never killed. */
  function stop(input) {
    const req = input || {};
    const slot = assertSlot(req.slot);
    const record = readRecord(slot);
    if (!record) return { ok: true, reason: "no-session" };
    if (typeof req.sessionId === "string" && req.sessionId !== record.sessionId) {
      return { ok: false, reason: "not-session-owner" };
    }
    let released = null;
    if (record.leaseHeld === true) {
      try { released = leases.release({ checkoutPath: record.checkoutPath, sessionId: record.sessionId }); }
      catch (e) { released = { ok: false, reason: "lease-release-failed" }; }
    }
    // If the lease could NOT be released, keep the session record: it is the only thing that still names
    // the lease, and deleting it would strand the checkout until the lease's TTL expired with no way to
    // retry. Report the failure honestly instead of claiming a clean stop.
    if (released && released.ok === false) return { ok: false, slot, reason: released.reason || "lease-release-failed", released };
    fs.rmSync(recordPath(slot), { force: true });
    return { ok: true, slot, released };
  }

  return { stateDir, sessionDir, leases, registry, projectRegistry, prepare, projectEnvironment, start, status, stop, loadConnection, requiredCredentials, vetoCommand, READY, parseReference };
}

module.exports = { createSessionRouter, loadConnection, defaultStateDir, SLOT_RE };
