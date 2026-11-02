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
 *
 * IT ALSO HOLDS WHO IS ASKING (PROJECTOS-TENANT-CREDENTIALS1A, ADR-T1 §6 and §10). `createRequesterAuthority`
 * reads the installation's own records and is the only source of a requester, the branded value the vault
 * and the operation gate demand. It sits here because this is the module that reads what ProjectOS may know
 * from outside a repository, and the plan names this file and no new one.
 *
 *   A REQUESTER IS A KERNEL-ISSUED RUN HANDLE, NEVER A DIRECTORY. The handle is a `run-start` envelope's id,
 *   and its admission line in the installation's `envelope-records.jsonl` is what survives the process. A
 *   process that holds the id, in any directory, is that run; a process that does not is nobody. Nothing
 *   here reads a cwd, a flag naming a tenant, an environment variable naming a tenant, a JWT or an OAuth
 *   identity. Everything the requester says comes from that line and from the committed tenant registry,
 *   and the line's own words are held to the registry.
 *
 *   WHAT THE HANDLE IS NOT. It names a record and it is not a secret: any process of this Windows user can
 *   read the line, and can write one. That is ADR-T1 §10's first limit, one Windows user, and it is why no
 *   second party's credentials go on this machine. This prevents accidents on the kernel's routes.
 *
 *   A CONSOLE IS A RUN TOO. A command with no run mints one first, as the contract requires. Only the
 *   credential router's terminal check reaches `issueConsoleRun`, and the authority it gives lives in this
 *   process only: read back by id, in any process, a console line is refused. `via: console` IS A LABEL:
 *   under F7 a process can drive a console or write the line, so it shows what a tenant receipt shows, a
 *   person or a process at a console, nothing more.
 *
 *   THE CORE CANNOT BE LOADED HERE. It is TypeScript, and this is plain synchronous CommonJS that must run
 *   with no build, so the few rules below repeat core's on purpose: the record's shape, whole-file refusal,
 *   the idempotency key. A test holds them to the core's own functions.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");
const { parseReference, fingerprint, isReservedProjectId, isTenantId, asciiLower, REACHES } = require("./reference.cjs");
const { matchedShapes } = require("./credential-shapes.cjs");

const FILE_NAME = "credential-metadata.json";
const LOCK_NAME = "credential-metadata.lock";
const MAX_NOTE = 120;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCK_TIMEOUT_MS = 5000;
// Fields that could smuggle a secret into a file that is otherwise safe to read, print and back up.
const FORBIDDEN_FIELDS = ["value", "secret", "password", "token", "key", "blob", "plaintext"];

const TENANT_REGISTRY_REL = "projectos/security/tenant-registry.json";
const ACTION_REGISTRY_REL = "projectos/security/action-registry.json";
const ENVELOPE_RECORDS_FILENAME = "envelope-records.jsonl";
const TENANT_RECEIPT_FILENAME = "tenant-registry-receipt.json";
const TENANT_CHANGE_RECORDS_FILENAME = "tenant-registry-changes.jsonl";
/** A run-start envelope's id, which is all a handle is. A JWT is not this shape, and nothing else is read. */
const RUN_HANDLE_RE = /^ENV-[0-9a-f]{24}$/;
const PHASE_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;
/** Where a credential-release grant lives: the installation, because a project's own work can write its own repository (F8). */
const CREDENTIAL_GRANTS_REL = "projectos/security/credential-grants/";
const CREDENTIAL_GRANT_KIND = "credential-release-grant";
const CREDENTIAL_GRANT_FIELDS = Object.freeze(["schemaVersion", "kind", "phaseId", "projectId", "references", "action", "expiresAt", "grantedBy"]);
const GIT_OBJECT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const WILDCARD_RE = /[*?]/;
const DOMAINS = Object.freeze(["develop", "business", "personal", "phone"]);
/** How a requester came to exist. A linked worktree is named so that it can be refused. */
const REQUESTER_ROUTES = Object.freeze(["governed-root", "linked-worktree", "console"]);
const KERNEL_ACTOR = Object.freeze({ agent: "projectos-kernel", provider: "projectos", model: "none" });
/** The moment around one command at a console. A governed run's window is the kernel's, on its line. */
const CONSOLE_RUN_WINDOW_MS = 5 * 60 * 1000;
const IDEMPOTENCY_DOMAIN = "projectos-envelope-idempotency-v2:";
/** The same rotation size, lock and bounded wait as `appendDurableLine`, because they share a file. */
const RECORD_ROTATE_BYTES = 1048576;
const RECORD_LOCK_WAIT_STEP_MS = 50;
const RECORD_LOCK_WAIT_STEPS = 40;
/** A record's lock left by a process that died holds every later line, and only a person may clear it. */
const RECORD_LOCK_HINT = "If no other ProjectOS process is running, a .jsonl.lock file in the installation state was left by one that died and must be removed.";

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
    // A DECLARED REACH MUST BE ONE OF THREE WORDS, and an account says whose it reaches. "account" alone
    // cannot be judged, so it is refused rather than read as narrower than it is.
    if (record.reach !== undefined && record.reach !== null) {
      if (!REACHES.includes(record.reach)) throw new Error("credential-metadata: reach must be one of " + REACHES.join(", "));
      const tenants = record.reachTenants;
      if (record.reach === "account" ? !Array.isArray(tenants) || tenants.length === 0 || !tenants.every(isTenantId) : tenants !== undefined && tenants !== null) {
        throw new Error("credential-metadata: an account reach names the tenants it reaches, and only an account reach does");
      }
    }
  }

  /** Only what this call states. A new value says nothing about what it reaches, so nothing is inherited. */
  function statedReach(record) {
    const stated = typeof record.reach === "string";
    return { reach: stated ? record.reach : null, reachTenants: stated ? record.reachTenants || null : null };
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
      ...statedReach(record),
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
        ...(typeof record.reach === "string" ? statedReach(record) : {}),
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

/** A refusal a caller can match on. It never carries a value, because nothing here reads one. */
function refusal(code, message) {
  return Object.assign(new Error(code + ": " + message), { code });
}

/** Every requester the kernel minted, with what its authority read when it did. Nothing else passes. */
const LIVE_REQUESTERS = new WeakMap();

/** What the authority knows of this requester, or `null`. A structurally perfect copy is not in the map. */
function requesterState(value) {
  return (typeof value === "object" && value !== null && LIVE_REQUESTERS.get(value)) || null;
}

/** The object name of these bytes as a blob, so a lie between git's names and git's objects shows. */
function blobNameOf(text, blob) {
  const bytes = Buffer.from(text, "utf8");
  return crypto.createHash(blob.length === 64 ? "sha256" : "sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The git that answers, absolute, or `null`.
 *
 * A BARE NAME RESOLVES AGAINST THE CURRENT DIRECTORY ON WINDOWS, and git decides every question here, so
 * a planted `git.exe` would choose the tenant. Never from inside the installation or the directory this
 * process stands in, and a relative or UNC `PATH` entry is skipped, as `resolveBoundGit` does.
 */
function boundGit(installRoot) {
  const name = process.platform === "win32" ? "git.exe" : "git";
  const usable = (candidate) => {
    if (!path.isAbsolute(candidate) || candidate.startsWith("\\\\") || candidate.startsWith("//")) return false;
    const here = process.cwd();
    if (isInsidePath(installRoot, candidate) || (path.parse(here).root !== here && isInsidePath(here, candidate))) return false;
    try { return fs.statSync(candidate).isFile(); } catch (e) { return false; }
  };
  const named = process.env.PROJECTOS_GIT_EXE;
  if (typeof named === "string" && path.basename(named).toLowerCase() === name && usable(named)) return named;
  for (const dir of String(process.env.PATH || process.env.Path || "").split(path.delimiter)) {
    if (dir && usable(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

/**
 * Whole-file judgement of the committed registry: the first problem, or `null`. Core's
 * `parseTenantRegistry` is the rule, and this refuses by the same names what decides a match.
 */
function registryProblem(raw) {
  const problem = (code, message) => ({ code, message });
  if (typeof raw !== "object" || raw === null || raw.schemaVersion !== "1.0.0" || raw.policy !== "tenant-registry" || !Array.isArray(raw.tenants) || !Array.isArray(raw.projects) || raw.projects.length === 0) {
    return problem("TENANT_REGISTRY_INVALID", "the committed tenant registry is not a registry this code recognises");
  }
  const tenantIds = raw.tenants.map((entry) => entry && entry.tenantId);
  if (!tenantIds.every(isTenantId)) return problem("TENANT_REGISTRY_INVALID", "a tenant line has no valid tenantId");
  const seen = new Set();
  const once = (kind, key) => { const fresh = !seen.has(kind + key); seen.add(kind + key); return fresh; };
  if (!tenantIds.every((id) => once("tenant:", id))) return problem("TENANT_REGISTRY_DUPLICATE", "two tenant lines share a tenantId");
  const roots = [];
  for (const entry of raw.projects) {
    const fields = entry ? [entry.projectId, entry.repository, entry.governedRoot, entry.tenant, entry.domain] : [];
    if (fields.length === 0 || !fields.every((field) => typeof field === "string" && field !== "")) return problem("TENANT_REGISTRY_INVALID", "a project line is missing a binding field");
    if (fields.some((field) => WILDCARD_RE.test(field))) return problem("TENANT_REGISTRY_WILDCARD", "a project line has a wildcard");
    if (isReservedProjectId(entry.projectId)) return problem("TENANT_REGISTRY_RESERVED_ID", "a project id starts with the reserved tenant prefix");
    if (!tenantIds.includes(entry.tenant) || !DOMAINS.includes(entry.domain)) return problem("TENANT_REGISTRY_INVALID", "a project line names an undeclared tenant or an unknown domain");
    const root = asciiLower(entry.governedRoot.replace(/\/+$/, ""));
    if (!once("project:", asciiLower(entry.projectId)) || !once("repository:", asciiLower(entry.repository)) || !once("root:", root)) {
      return problem("TENANT_REGISTRY_DUPLICATE", "two project lines share a project, a repository or a root");
    }
    roots.push(root);
  }
  if (roots.some((root) => roots.some((other) => root !== other && root.startsWith(other + "/")))) {
    return problem("TENANT_REGISTRY_NESTED_ROOT", "one project's root is inside another's");
  }
  return null;
}

/** The kernel's key for one intent: `deriveIdempotencyKey`, the same bytes. */
function idempotencyKeyOf(intent) {
  const canonical = JSON.stringify([intent.tenant, intent.project, intent.action, intent.subjectHash, intent.intentScope]);
  return "sha256:" + crypto.createHash("sha256").update(IDEMPOTENCY_DOMAIN + canonical, "utf8").digest("hex");
}

/**
 * The state directory as the operating system places it, and only while the environment agrees with it:
 * `defaultPlatformStopStateDir`, so one variable cannot point authority at a forged record. `null` refuses.
 */
function installationStateDir() {
  let home;
  try { home = os.userInfo().homedir; } catch (e) { return null; }
  const configured = process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || process.env.HOME;
  if (typeof home !== "string" || !path.isAbsolute(home) || typeof configured !== "string" || !path.isAbsolute(configured)) return null;
  const derived = path.resolve(process.platform === "win32" ? path.resolve(home, "AppData", "Local") : home, "ProjectOS", "installation-state");
  const stated = path.resolve(configured, "ProjectOS", "installation-state");
  const key = (p) => (process.platform === "win32" ? asciiLower(p) : p);
  return key(derived) === key(stated) ? derived.split(String.fromCharCode(92)).join("/") : null;
}

/**
 * The only source of a requester.
 *
 * @param opts { installRoot, stateDir, nowMs? } The caller is kernel code: the credential router passes the
 *        installation it runs from and `installationStateDir()`, and exposes neither to a flag.
 */
function createRequesterAuthority(opts) {
  const options = opts || {};
  const installRoot = options.installRoot;
  const stateDir = options.stateDir;
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : () => Date.now();
  let actionEntries = null;

  function requireSources() {
    if (typeof installRoot !== "string" || !path.isAbsolute(installRoot) || typeof stateDir !== "string" || !path.isAbsolute(stateDir)) {
      throw refusal("TENANT_REGISTRY_UNREADABLE", "no installation and no state directory can be established, so no requester can be derived");
    }
  }

  /** Git, with replacement objects off and nothing inherited that could change what it answers. */
  function git(root, args) {
    const exe = boundGit(installRoot);
    if (exe === null) return { code: 127, stdout: "" };
    const env = {};
    for (const name of ["SystemRoot", "windir", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME"]) {
      if (typeof process.env[name] === "string") env[name] = process.env[name];
    }
    const r = childProcess.spawnSync(exe, ["--no-replace-objects", "-C", root, ...args], { encoding: "utf8", windowsHide: true, cwd: installRoot, env });
    return { code: r.status === null ? 1 : r.status, stdout: r.stdout || "" };
  }

  /** One record's bytes at one commit, committed and unmodified, hashed to their blob. `null` on any doubt. */
  function readCommitted(root, rel) {
    const logged = git(root, ["log", "-1", "--format=%H", "--", rel]);
    if (logged.code !== 0 || !logged.stdout.trim()) return null;
    const dirty = git(root, ["diff", "--name-only", "HEAD", "--", rel]);
    if (dirty.code !== 0 || dirty.stdout.trim()) return null;
    const commit = git(root, ["rev-parse", "--verify", "HEAD"]).stdout.trim();
    if (!GIT_OBJECT_RE.test(commit)) return null;
    const blob = git(root, ["rev-parse", commit + ":./" + rel]).stdout.trim();
    const shown = git(root, ["show", commit + ":./" + rel]);
    if (!GIT_OBJECT_RE.test(blob) || shown.code !== 0 || !shown.stdout.trim() || blobNameOf(shown.stdout, blob) !== blob) return null;
    return { text: shown.stdout, blob, commit };
  }

  function readJsonLines(file) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch (e) { return []; }
    return text.split("\n").flatMap((line) => {
      try { return line.trim() ? [JSON.parse(line)] : []; } catch (e) { return []; }
    });
  }

  /** The committed registry, judged whole, and confirmed. A commit alone moves no tenant here either. */
  function readRegistry() {
    requireSources();
    const bytes = readCommitted(installRoot, TENANT_REGISTRY_REL);
    if (bytes === null) throw refusal("TENANT_REGISTRY_UNREADABLE", "the installation commits no unmodified " + TENANT_REGISTRY_REL);
    let raw;
    try { raw = JSON.parse(bytes.text); } catch (e) { throw refusal("TENANT_REGISTRY_UNREADABLE", "the committed tenant registry is not readable JSON"); }
    const problem = registryProblem(raw);
    if (problem !== null) throw refusal(problem.code, problem.message);
    if (!receiptConfirms(bytes.blob)) {
      throw refusal("TENANT_REGISTRY_NO_RECEIPT", "the committed tenant registry (blob " + bytes.blob + ") has no receipt with its admission line, so no tenant can be derived. A receipt is a precondition of reading the registry, and it grants nothing");
    }
    return { entries: new Map(raw.projects.map((entry) => [entry.projectId, entry])), commit: bytes.commit };
  }

  function receiptConfirms(blob) {
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(path.join(stateDir, TENANT_RECEIPT_FILENAME), "utf8")); } catch (e) { return false; }
    if (!receipt || receipt.kind !== "tenant-registry-receipt" || receipt.confirmation !== "typed-terminal" || receipt.registryBlob !== blob) return false;
    return readJsonLines(path.join(stateDir, TENANT_CHANGE_RECORDS_FILENAME)).some((line) => {
      const envelope = line && line.envelope;
      return line && line.stage === "admission" && line.outcome === "allowed" && envelope && envelope.action === "tenant-registry-change" && envelope.envelopeId === receipt.envelopeId && envelope.subjectHash === blob;
    });
  }

  /** Each action's class and environment come from the committed action registry, never from this file. */
  function actionEntry(id) {
    if (actionEntries === null) {
      const bytes = readCommitted(installRoot, ACTION_REGISTRY_REL);
      let parsed = null;
      try { parsed = bytes === null ? null : JSON.parse(bytes.text); } catch (e) { parsed = null; }
      if (parsed === null || !Array.isArray(parsed.actions)) throw refusal("ACTION_REGISTRY_UNREADABLE", "the installation commits no readable " + ACTION_REGISTRY_REL);
      actionEntries = parsed.actions;
    }
    const entry = actionEntries.find((candidate) => candidate && candidate.id === id);
    if (!entry) throw refusal("ACTION_REGISTRY_UNREADABLE", "the action registry does not list '" + id + "'");
    return entry;
  }

  /** Every line of the record, the rotated files too: a long run outlives a busy bridge's rotation. */
  function recordLines() {
    let names;
    try { names = fs.readdirSync(stateDir); } catch (e) { return []; }
    return names
      .filter((name) => name === ENVELOPE_RECORDS_FILENAME || (name.startsWith(ENVELOPE_RECORDS_FILENAME + ".") && !name.endsWith(".lock") && !name.endsWith(".tmp")))
      .flatMap((name) => readJsonLines(path.join(stateDir, name)));
  }

  function takeRecordLock(lock) {
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (let step = 0; step < RECORD_LOCK_WAIT_STEPS; step += 1) {
      try { fs.writeFileSync(lock, "{}\n", { flag: "wx" }); return true; } catch (e) { if (!e || e.code !== "EEXIST") return false; }
      Atomics.wait(pause, 0, 0, RECORD_LOCK_WAIT_STEP_MS);
    }
    return false;
  }

  /**
   * One line, or `false`. It takes `appendDurableLine`'s lock and rewrites as it does, because the kernel
   * replaces this file under that lock, and a plain append between its read and its rename would be lost.
   */
  function appendRecord(entry) {
    const file = path.join(stateDir, ENVELOPE_RECORDS_FILENAME);
    const lock = file + ".lock";
    try { fs.mkdirSync(stateDir, { recursive: true }); } catch (e) { return false; }
    if (!takeRecordLock(lock)) return false;
    const tmp = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    try {
      let existing = "";
      if (fs.existsSync(file)) {
        existing = fs.readFileSync(file, "utf8");
        if (Buffer.byteLength(existing, "utf8") >= RECORD_ROTATE_BYTES) {
          fs.renameSync(file, file + "." + new Date(nowMs()).toISOString().replace(/[^0-9TZ]/g, "") + "-" + crypto.randomBytes(4).toString("hex"));
          existing = "";
        }
      }
      const line = JSON.stringify(entry) + "\n";
      fs.writeFileSync(tmp, existing + line, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmp, file);
      return fs.readFileSync(file, "utf8").endsWith(line);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (cleanup) { /* nothing better is available */ }
      return false;
    } finally {
      try { fs.rmSync(lock, { force: true }); } catch (e) { /* the next writer refuses and names the file */ }
    }
  }

  function newEnvelopeId() {
    return "ENV-" + crypto.randomBytes(12).toString("hex");
  }

  /**
   * The requester for a kernel run's handle. A console line is refused here: its authority is the
   * terminal of the process that minted it, and a handle carried anywhere else has no terminal behind it.
   */
  function fromRun(handle) {
    const requester = bindRun(handle, false);
    if (requester.via === "console") {
      LIVE_REQUESTERS.delete(requester);
      throw refusal("RUN_HANDLE_CONSOLE_ONLY", "a console run's authority ends with the process that minted it, so its handle is nobody's elsewhere");
    }
    return requester;
  }

  /** The requester this run's line and the committed registry agree on. Nothing else is asked. */
  function bindRun(handle, atConsole) {
    if (typeof handle !== "string" || !RUN_HANDLE_RE.test(handle)) {
      throw refusal("REQUESTER_REQUIRED", "a requester is a kernel-issued run handle, and this is not one");
    }
    const registry = readRegistry();
    const lines = recordLines().filter((line) => line && line.envelope && line.envelope.envelopeId === handle);
    const admissions = lines.filter((line) => {
      const envelope = line.envelope;
      return line.stage === "admission" && line.outcome === "allowed" && envelope.envelopeVersion === 2 && envelope.action === "run-start" && envelope.parentEnvelopeId === null;
    });
    if (admissions.length !== 1) throw refusal("RUN_HANDLE_UNKNOWN", "no one admitted run-start has this handle in the installation's record");
    if (lines.some((line) => line.stage === "execution")) throw refusal("RUN_HANDLE_ENDED", "this run has recorded its end, so it asks for nothing more");
    const { envelope, via } = admissions[0];
    const expiresAtMs = Date.parse(envelope.expiry);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs()) throw refusal("RUN_HANDLE_EXPIRED", "this run's window has closed");
    if (!REQUESTER_ROUTES.includes(via)) throw refusal("RUN_HANDLE_UNKNOWN", "this run's line names no route the kernel uses");
    const entry = registry.entries.get(envelope.project);
    if (entry === undefined) throw refusal("TENANT_UNKNOWN", "project '" + envelope.project + "' is not in the tenant registry");
    // THE LINE'S OWN WORDS COUNT FOR NOTHING. A tenant moved since, or written in by hand, stops here.
    if (entry.tenant !== envelope.tenant || entry.domain !== envelope.domain) {
      throw refusal("TENANT_MISMATCH", "this run names tenant '" + envelope.tenant + "', and the committed registry binds project '" + entry.projectId + "' to '" + entry.tenant + "'");
    }
    const requester = Object.freeze({
      kind: "run-handle",
      runHandle: handle,
      tenant: entry.tenant,
      domain: entry.domain,
      project: entry.projectId,
      via,
      principal: envelope.principal,
      expiry: envelope.expiry,
    });
    LIVE_REQUESTERS.set(requester, { authority, expiresAtMs, entries: registry.entries, atConsole });
    return requester;
  }

  /**
   * A command with no run mints one, so that one route reads every requester. Reached only from the
   * credential router after its terminal check. It names a project, which the registry must list: the
   * tenant is still read, never stated.
   */
  function issueConsoleRun(input) {
    const projectId = (input || {}).projectId;
    const registry = readRegistry();
    const entry = registry.entries.get(projectId);
    if (entry === undefined) throw refusal("TENANT_UNKNOWN", "project '" + String(projectId) + "' is not in the tenant registry");
    const action = actionEntry("run-start");
    const envelopeId = newEnvelopeId();
    const at = new Date(nowMs());
    const intent = { tenant: entry.tenant, project: entry.projectId, action: "run-start", subjectHash: registry.commit, intentScope: "console-run:" + envelopeId };
    const envelope = {
      envelopeVersion: 2,
      envelopeId,
      parentEnvelopeId: null,
      principal: "implementer",
      actor: KERNEL_ACTOR,
      tenant: entry.tenant,
      domain: entry.domain,
      project: entry.projectId,
      environment: action.environment,
      action: "run-start",
      actionClass: action.class,
      subjectHash: registry.commit,
      scope: ["project:" + entry.projectId, "confirmation:console"],
      budget: 0,
      expiry: new Date(at.getTime() + CONSOLE_RUN_WINDOW_MS).toISOString(),
      idempotencyKey: idempotencyKeyOf(intent),
    };
    const written = appendRecord({ stage: "admission", at: at.toISOString(), outcome: "allowed", rule: null, envelope, registered: true, via: "console", runLinked: false, reasons: [] });
    if (!written) throw refusal("ENVELOPE_NOT_RECORDED", "the console run could not be recorded, so it did not happen. " + RECORD_LOCK_HINT);
    return bindRun(envelopeId, true);
  }

  /**
   * The P5 grant for one release: a committed `credential-release` record, and nothing else.
   *
   * IT NAMES WHAT IT RELEASES. An owner's record for a phase says the phase may proceed, and the gatekeeper's
   * `secrets-handling` gates are scoped to the gatekeeper key, so reading one here let any caller who named a
   * phase holding one release a production credential. That decision was withdrawn at review. This record
   * names the project, the exact references, the action and an expiry, and any difference releases nothing.
   *
   * IT LIVES IN THE INSTALLATION, read from committed bytes at HEAD: a project's work can write its own
   * repository (F8), and a linked worktree can commit there. A tenant receipt and a `secrets-handling` gate
   * are not this and answer nothing. `null` when the record grants this release; otherwise why not.
   */
  function operationGrantRefusal(requester, ref, permit) {
    const phaseId = permit.phaseId;
    if (typeof phaseId !== "string" || !PHASE_ID_RE.test(phaseId)) return "the permit names no phase, so no grant can answer for it";
    const bytes = readCommitted(installRoot, CREDENTIAL_GRANTS_REL + phaseId + ".credential-release.json");
    if (bytes === null) return "no committed credential-release grant exists for this phase in the installation";
    let grant;
    try { grant = JSON.parse(bytes.text); } catch (e) { return "the committed credential-release grant is not readable JSON"; }
    if (grant === null || typeof grant !== "object" || Array.isArray(grant)) return "the committed credential-release grant is not a record";
    const keys = Object.keys(grant);
    if (keys.length !== CREDENTIAL_GRANT_FIELDS.length || !CREDENTIAL_GRANT_FIELDS.every((field) => keys.includes(field))) {
      return "the committed credential-release grant does not have exactly the fields a grant has";
    }
    if (grant.schemaVersion !== "1.0.0" || grant.kind !== CREDENTIAL_GRANT_KIND) return "the committed record is not a credential-release grant";
    if (typeof grant.grantedBy !== "string" || grant.grantedBy.trim() === "") return "the committed credential-release grant names nobody who granted it";
    if (grant.phaseId !== phaseId) return "the committed credential-release grant is for another phase";
    if (grant.projectId !== requester.project) return "the committed credential-release grant is for another project";
    if (!Array.isArray(grant.references) || !grant.references.includes(ref.reference)) return "the committed credential-release grant does not name this exact reference";
    if (typeof permit.action !== "string" || grant.action !== permit.action) return "the committed credential-release grant is for another action";
    const expiresAtMs = typeof grant.expiresAt === "string" ? Date.parse(grant.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== grant.expiresAt) return "the committed credential-release grant has no readable expiry";
    if (expiresAtMs <= nowMs()) return "the committed credential-release grant has expired";
    return null;
  }

  /**
   * One `credential-release` line through an envelope, tied to its run: `mintCrossing`'s shape, written
   * with the kernel's lock. `false` means it was not recorded, and the release does not happen.
   */
  function recordRelease(requester, ref, input) {
    const { outcome, rule, reasons, intent, grantSource } = input;
    const action = actionEntry("credential-release");
    const at = new Date(nowMs());
    const subjectHash = crypto.createHash("sha256").update(ref.reference, "utf8").digest("hex");
    const envelope = {
      envelopeVersion: 2,
      envelopeId: newEnvelopeId(),
      parentEnvelopeId: null,
      principal: requester.principal,
      actor: KERNEL_ACTOR,
      tenant: requester.tenant,
      domain: requester.domain,
      project: requester.project,
      environment: action.environment,
      action: "credential-release",
      actionClass: action.class,
      subjectHash,
      scope: ["run:" + requester.runHandle],
      budget: 0,
      expiry: requester.expiry,
      idempotencyKey: idempotencyKeyOf({ tenant: requester.tenant, project: requester.project, action: "credential-release", subjectHash, intentScope: intent }),
    };
    return appendRecord({ stage: "admission", at: at.toISOString(), outcome, rule, envelope, registered: true, via: requester.via, runLinked: true, reasons, grantSource });
  }

  const authority = Object.freeze({ fromRun, issueConsoleRun, operationGrantRefusal, recordRelease });
  return authority;
}

module.exports = { createMetadataStore, defaultStateDir, FILE_NAME, MAX_NOTE, CREDENTIAL_GRANTS_REL, createRequesterAuthority, requesterState, installationStateDir, refusal, RUN_HANDLE_RE, ENVELOPE_RECORDS_FILENAME, RECORD_LOCK_HINT };
