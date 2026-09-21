"use strict";
// ProjectOS Watchdog — shared control-plane helpers (Node built-ins only).
// Used by watchdog-sync, watchdog-sentinel-registry and the val-watchdog-*
// validators. Nothing here runs inside a product: products never load
// ProjectOS code at build time or runtime.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CANONICAL_SOURCE = "universalbizcomply/ProjectOS";
const TAG_RE = /^watchdog-core\/v(\d+\.\d+\.\d+)$/;
const SHA40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;
const DEFAULT_INSTALL_PATH = "supabase/functions/_shared/watchdog-core";

// Files a release ships, relative to the ProjectOS repo, and where they land
// inside the product's install path.
const RELEASE_ROOTS = [
  { from: "projectos/watchdog/core/src/", to: "src/", test: (p) => p.endsWith(".ts") },
  { from: "projectos/watchdog/sql/migrations/", to: "sql/migrations/", test: (p) => p.endsWith(".sql") },
  { from: "projectos/watchdog/sql/privilege-gate.sql", to: "sql/privilege-gate.sql", test: () => true },
];

const ONBOARDING_STATES = ["NOT_INTEGRATED", "DISCOVERED", "PARTIAL", "WATCHDOG_INSTALLED", "CONFORMANT", "OUTER_SENTINEL_ACTIVE"];
const SENTINEL_MODES = ["none", "public", "authenticated"];
const CHECK_CLASSES = ["reachability", "https", "health", "release_identity"];
// Owned by project-config / the machine registry, never duplicated here.
const FORBIDDEN_PROFILE_KEYS = ["repo", "repository", "url", "public_url", "supabase_ref", "supabaseref", "project_ref",
  "hosting", "host", "project_id", "projectid", "environments"];
const SECRETISH_KEY = /(token|secret|password|passwd|api_?key|credential|private_?key|service_?role)/i;

function canonicalText(buf) {
  return Buffer.from(buf).toString("utf8").replace(/\r\n/g, "\n");
}

// Hash of the canonical (LF) text, so a Windows checkout with autocrlf still
// verifies against the release.
function sha256Canonical(buf) {
  return crypto.createHash("sha256").update(canonicalText(buf), "utf8").digest("hex");
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function canonicalJson(obj) {
  return JSON.stringify(sortKeys(obj), null, 2) + "\n";
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

function git(repo, args, opts = {}) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: opts.binary ? "buffer" : "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = opts.binary ? String(r.stderr) : r.stderr;
    throw new Error("git " + args.join(" ") + " failed: " + (err || "").trim());
  }
  return r.stdout;
}

function parseCoreVersions(versionTs) {
  const core = /export const WATCHDOG_CORE_VERSION = "(\d+\.\d+\.\d+)";/.exec(versionTs);
  const schema = /export const REQUIRED_SCHEMA_VERSION = (\d+);/.exec(versionTs);
  const contracts = /export const CORE_CONTRACTS = \[([\s\S]*?)\] as const;/.exec(versionTs);
  return {
    core: core ? core[1] : null,
    schema: schema ? Number(schema[1]) : null,
    contracts: contracts ? [...contracts[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [],
  };
}

function migrationNumber(file) {
  const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(path.basename(file));
  return m ? Number(m[1]) : null;
}

function isSafeRelative(p) {
  return typeof p === "string" && p.length > 0 && !path.isAbsolute(p) && !/^[A-Za-z]:/.test(p) &&
    !p.split(/[\\/]/).includes("..") && !p.includes("\\") && !p.startsWith("/");
}

// ---- lock ------------------------------------------------------------------

function lockErrors(lock) {
  const e = [];
  if (!lock || typeof lock !== "object") return ["lock is not an object"];
  const allowed = ["lock_version", "watchdog_core_version", "schema_version", "source_repository", "tag", "commit", "install_path", "files"];
  for (const k of Object.keys(lock)) if (!allowed.includes(k)) e.push("unexpected lock key: " + k);
  if (lock.lock_version !== 1) e.push("lock_version must be 1");
  if (!/^\d+\.\d+\.\d+$/.test(lock.watchdog_core_version || "")) e.push("invalid watchdog_core_version");
  if (!Number.isInteger(lock.schema_version) || lock.schema_version < 1) e.push("invalid schema_version");
  if (lock.source_repository !== CANONICAL_SOURCE) e.push("source_repository must be " + CANONICAL_SOURCE);
  const tag = TAG_RE.exec(lock.tag || "");
  if (!tag) e.push("tag must be watchdog-core/vX.Y.Z");
  else if (tag[1] !== lock.watchdog_core_version) e.push("tag does not match watchdog_core_version");
  if (!SHA40.test(lock.commit || "")) e.push("commit must be a full 40-hex sha");
  if (!isSafeRelative(lock.install_path)) e.push("install_path must be a safe relative path");
  if (!lock.files || typeof lock.files !== "object" || Object.keys(lock.files).length === 0) e.push("files missing");
  else for (const [f, h] of Object.entries(lock.files)) {
    if (!isSafeRelative(f)) e.push("unsafe file path in lock: " + f);
    if (!HEX64.test(h)) e.push("invalid hash for " + f);
  }
  const text = JSON.stringify(lock);
  if (/[A-Za-z]:\\\\|\/Users\/|\/home\/|C:\/dev/i.test(text)) e.push("lock contains a local filesystem path");
  return e;
}

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(dir);
  return out;
}

// Verify the vendored copy against its lock. Returns errors.
function verifyInstall(targetDir, lock) {
  const e = [];
  const base = path.join(targetDir, lock.install_path);
  const expected = new Set(Object.keys(lock.files));
  for (const [rel, hash] of Object.entries(lock.files)) {
    const p = path.join(base, rel);
    if (!fs.existsSync(p)) { e.push("missing vendored file " + rel); continue; }
    if (sha256Canonical(fs.readFileSync(p)) !== hash) e.push("hash mismatch (modified vendored file) " + rel);
  }
  for (const p of listFilesRecursive(base)) {
    const rel = path.relative(base, p).split(path.sep).join("/");
    if (!expected.has(rel)) e.push("unexpected file in vendored core (not in lock) " + rel);
  }
  return e;
}

// ---- profile ---------------------------------------------------------------

function findForbiddenKeys(obj, trail = "") {
  const out = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push(...findForbiddenKeys(v, trail + "[" + i + "]")));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase();
      if (FORBIDDEN_PROFILE_KEYS.includes(kl)) out.push("profile must not duplicate project config key: " + trail + k);
      if (SECRETISH_KEY.test(k)) out.push("profile must not contain credential-like key: " + trail + k);
      out.push(...findForbiddenKeys(v, trail + k + "."));
    }
  } else if (typeof obj === "string" && obj.includes("@")) {
    out.push("profile must not contain addresses (use a setting reference): " + trail.replace(/\.$/, ""));
  }
  return out;
}

function stateRank(s) { return ONBOARDING_STATES.indexOf(s); }

function profileErrors(p, opts = {}) {
  const e = [];
  if (!p || typeof p !== "object") return ["profile is not an object"];
  e.push(...findForbiddenKeys(p));
  if (p.profile_version !== 1) e.push("profile_version must be 1");
  if (!ONBOARDING_STATES.includes(p.onboarding_status)) e.push("invalid onboarding_status");
  const rank = stateRank(p.onboarding_status);
  const rt = p.runtime || {};
  if (rank >= stateRank("WATCHDOG_INSTALLED")) {
    if (!isSafeRelative(rt.install_path)) e.push("runtime.install_path required (safe relative path)");
    if (!isSafeRelative(rt.adapter_path)) e.push("runtime.adapter_path required (safe relative path)");
    if (isSafeRelative(rt.install_path) && isSafeRelative(rt.adapter_path) && (rt.adapter_path + "/").startsWith(rt.install_path + "/")) {
      e.push("adapter_path must live outside the vendored core install_path");
    }
  }
  const h = p.health || {};
  for (const k of ["health_endpoint_path", "release_endpoint_path"]) {
    if (h[k] !== null && h[k] !== undefined && !/^\/[A-Za-z0-9_.\/-]{0,127}$/.test(h[k])) e.push("invalid health." + k);
  }
  const m = p.monitor || {};
  if (m.cadence_seconds !== undefined && (!Number.isInteger(m.cadence_seconds) || m.cadence_seconds < 60)) e.push("monitor.cadence_seconds must be an integer >= 60");
  const jobs = Array.isArray(p.critical_jobs) ? p.critical_jobs : null;
  if (!jobs) e.push("critical_jobs must be an array");
  else {
    const seen = new Set();
    for (const j of jobs) {
      if (!TOKEN.test(j.job_id || "")) { e.push("invalid critical job id"); continue; }
      if (seen.has(j.job_id)) e.push("duplicate critical job " + j.job_id);
      seen.add(j.job_id);
      if (j.scheduler_name !== null && j.scheduler_name !== undefined && !TOKEN.test(j.scheduler_name)) e.push(j.job_id + ": invalid scheduler_name");
      const pos = (n) => Number.isInteger(n) && n > 0;
      if (!pos(j.expected_interval_s) || !pos(j.stale_after_s) || j.stale_after_s < j.expected_interval_s) e.push(j.job_id + ": interval/stale thresholds invalid");
      if (j.max_run_s !== null && j.max_run_s !== undefined && !pos(j.max_run_s)) e.push(j.job_id + ": invalid max_run_s");
      if (!pos(j.failure_threshold)) e.push(j.job_id + ": invalid failure_threshold");
    }
  }
  const n = p.notifications || {};
  if (n.recipients_setting_ref !== null && n.recipients_setting_ref !== undefined && !/^[a-z][a-z0-9_.]{0,79}$/.test(n.recipients_setting_ref)) {
    e.push("notifications.recipients_setting_ref must be a setting name");
  }
  const s = p.sentinel || {};
  if (!SENTINEL_MODES.includes(s.mode)) e.push("sentinel.mode must be none|public|authenticated");
  if (!Array.isArray(s.check_classes)) e.push("sentinel.check_classes must be an array");
  else for (const c of s.check_classes) if (!CHECK_CLASSES.includes(c)) e.push("unknown sentinel check class " + c);
  const comps = Array.isArray(p.components) ? p.components : null;
  if (!comps) e.push("components must be an array");
  else {
    const seen = new Set();
    for (const c of comps) {
      if (!TOKEN.test(c.component_id || "")) { e.push("invalid component_id"); continue; }
      if (seen.has(c.component_id)) e.push("duplicate component " + c.component_id);
      seen.add(c.component_id);
      if (!isSafeRelative(c.repo_path)) e.push(c.component_id + ": repo_path must be a safe relative path");
      else if (opts.targetDir && !fs.existsSync(path.join(opts.targetDir, c.repo_path))) e.push(c.component_id + ": repo_path does not exist in the product");
      if (!TOKEN.test(c.deploy_target || "")) e.push(c.component_id + ": invalid deploy_target");
    }
  }
  // Definition-of-done fields become mandatory from CONFORMANT upward.
  if (rank >= stateRank("CONFORMANT")) {
    if (!h.release_endpoint_path) e.push("CONFORMANT requires health.release_endpoint_path");
    if (!h.health_endpoint_path && !/^[A-Z0-9_]{1,64}$/.test(h.health_not_applicable_reason || "")) {
      e.push("CONFORMANT requires health.health_endpoint_path or health.health_not_applicable_reason");
    }
    if (!jobs || jobs.length === 0) e.push("CONFORMANT requires at least one critical job");
    if (!n.recipients_setting_ref) e.push("CONFORMANT requires notifications.recipients_setting_ref");
    if (!m.cadence_seconds) e.push("CONFORMANT requires monitor.cadence_seconds");
    if (!comps || comps.length === 0) e.push("CONFORMANT requires at least one component");
  }
  if (rank >= stateRank("OUTER_SENTINEL_ACTIVE")) {
    if (s.mode === "none") e.push("OUTER_SENTINEL_ACTIVE requires sentinel.mode public or authenticated");
    if (!Array.isArray(s.check_classes) || s.check_classes.length === 0) e.push("OUTER_SENTINEL_ACTIVE requires sentinel check classes");
  }
  return e;
}

// ---- sentinel registry -----------------------------------------------------

function registryEntryErrors(x) {
  const e = [];
  const allowed = ["project", "environment", "public_url", "health_path", "expected_service", "expected_release", "timeout_ms", "check_classes"];
  for (const k of Object.keys(x || {})) if (!allowed.includes(k)) e.push("unexpected registry key " + k);
  if (!TOKEN.test(x.project || "")) e.push("invalid project");
  if (!TOKEN.test(x.environment || "")) e.push("invalid environment");
  let u = null;
  try { u = new URL(x.public_url); } catch (_e) { e.push(x.project + ": public_url is not a URL"); }
  if (u) {
    if (u.protocol !== "https:") e.push(x.project + ": public_url must be https");
    if (u.username || u.password || u.search || u.hash) e.push(x.project + ": public_url must not carry credentials, query or fragment");
  }
  if (x.health_path !== null && !/^\/[A-Za-z0-9_.\/-]{0,127}$/.test(x.health_path || "")) e.push(x.project + ": invalid health_path");
  if (x.expected_service !== null && !TOKEN.test(x.expected_service || "")) e.push(x.project + ": invalid expected_service");
  if (x.expected_release !== null && !/^[0-9a-f]{7,40}$/.test(x.expected_release || "")) e.push(x.project + ": invalid expected_release");
  if (!Number.isInteger(x.timeout_ms) || x.timeout_ms < 1000 || x.timeout_ms > 10000) e.push(x.project + ": timeout_ms must be 1000-10000");
  if (!Array.isArray(x.check_classes) || x.check_classes.length === 0) e.push(x.project + ": no check classes");
  else for (const c of x.check_classes) if (!CHECK_CLASSES.includes(c)) e.push(x.project + ": unknown check class " + c);
  if (Array.isArray(x.check_classes) && x.check_classes.includes("health") && x.health_path === null) e.push(x.project + ": health class needs health_path");
  return e;
}

function registryContentHash(entries) {
  return crypto.createHash("sha256").update(canonicalJson(entries), "utf8").digest("hex");
}

function registryErrors(reg) {
  const e = [];
  if (!reg || typeof reg !== "object") return ["registry is not an object"];
  const allowed = ["registry_version", "generated_by", "source_commit", "entries", "content_sha256"];
  for (const k of Object.keys(reg)) if (!allowed.includes(k)) e.push("unexpected registry key " + k);
  if (reg.registry_version !== 1) e.push("registry_version must be 1");
  if (!SHA40.test(reg.source_commit || "")) e.push("source_commit must be a 40-hex sha");
  if (!Array.isArray(reg.entries)) return e.concat(["entries must be an array"]);
  const seen = new Set();
  for (const x of reg.entries) {
    e.push(...registryEntryErrors(x));
    const k = x.project + "/" + x.environment;
    if (seen.has(k)) e.push("duplicate registry entry " + k);
    seen.add(k);
  }
  const text = JSON.stringify(reg);
  for (const k of findSecretKeys(reg)) e.push("registry must not contain credential-like key " + k);
  if (/@/.test(text)) e.push("registry must not contain addresses or credentials");
  if (reg.content_sha256 !== registryContentHash(reg.entries)) e.push("content_sha256 does not match entries (registry drift or tampering)");
  return e;
}

function findSecretKeys(obj, out = []) {
  if (Array.isArray(obj)) obj.forEach((v) => findSecretKeys(v, out));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) { if (SECRETISH_KEY.test(k)) out.push(k); findSecretKeys(v, out); }
  return out;
}

module.exports = {
  CANONICAL_SOURCE, TAG_RE, DEFAULT_INSTALL_PATH, RELEASE_ROOTS, ONBOARDING_STATES, SENTINEL_MODES, CHECK_CLASSES,
  canonicalText, sha256Canonical, canonicalJson, readJson, git, parseCoreVersions, migrationNumber, isSafeRelative,
  lockErrors, verifyInstall, listFilesRecursive, profileErrors, stateRank,
  registryEntryErrors, registryContentHash, registryErrors,
};
