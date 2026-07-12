"use strict";
/**
 * Worker trusted-policy binding, environment isolation, secret scanning, and the structured worker result
 * contract — the containment layer for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A (pure, I/O-free).
 *
 * The worker REQUEST carries only task CONTENT (prompt, project key, task id). Every SECURITY CONTROL —
 * repo root, expected remote/branch, clean-tree requirement, allowed/forbidden paths, permitted tools and
 * commands, timeout, output limits, environment allowlist, mode, and the operation/phase/approval ids —
 * comes ONLY from trusted ProjectOS configuration. A request that tries to define/widen any control is
 * refused, never merged.
 *
 * IMPORTANT (honesty): this layer + the orchestrator provide GIT- and FILESYSTEM-level containment plus a
 * minimal environment. They do NOT OS-sandbox a shell-capable worker. A worker granted shell/file tools can
 * read/write anything the owner account can. Real isolation of a fully-untrusted worker requires OS-level
 * enforcement (a container/VM or a restricted account) on the OWNER machine — see the adapter header.
 */

// --- Environment isolation ---------------------------------------------------------------------------
const ENV_ALLOW_COMMON = ["PATH", "Path"];
const ENV_ALLOW_WIN = ["SystemRoot", "windir", "ComSpec", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA"];
const ENV_ALLOW_POSIX = ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "SHELL"];

// A credential-bearing variable NAME is never forwarded, even if allowlisted.
const TOKENISH_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|SERVICE_ROLE|DATABASE_URL|DSN|SESSION|COOKIE|AUTH|BEARER|PRIVATE|ANTHROPIC|OPENAI|SUPABASE|VERCEL|GITHUB|STRIPE|RESEND|TWILIO|AWS_)/i;

// Control fields a REQUEST must never carry — they belong to trusted policy only.
const CONTROL_FIELDS = [
  "repoRoot", "expectedRemote", "expectedBranch", "requireClean", "allowedPaths", "forbiddenPaths",
  "tools", "commands", "timeoutMs", "maxOutputBytes", "maxPromptChars", "envAllowlist", "mode",
  "phaseId", "approvalId", "operationId",
];

// ONE shared secret-shape source (used for prompt rejection AND output scrubbing). Consolidated so the two
// call sites cannot drift.
const SECRET_SHAPE = new RegExp(
  [
    "-----BEGIN[\\s\\S]{0,64}?PRIVATE KEY-----",
    "sk-[A-Za-z0-9]{16,}",
    "eyJ[A-Za-z0-9_-]{20,}", // base64url JWT/JWS header blob (matches header-only or full token)
    "sb_secret_[A-Za-z0-9]{6,}",
    "service_role[\"'\\s:=]{0,4}eyJ",
    "AKIA[0-9A-Z]{12,}",
    "ghp_[A-Za-z0-9]{20,}",
    "xox[baprs]-[A-Za-z0-9-]{10,}",
    "AIza[0-9A-Za-z_-]{20,}",
  ].join("|"),
);
function secretShapeGlobal() { return new RegExp(SECRET_SHAPE.source, "g"); }

// Worker decisions that are NEVER authoritative gate outcomes.
const FORBIDDEN_WORKER_DECISIONS = ["APPROVED", "APPROVED_TO_PUSH", "CLOSED", "PLAN_READY", "PLAN READY"];
// Fields a worker result must never assert.
const FORBIDDEN_RESULT_FIELDS = ["authoritative", "planReady", "grantPlanReady", "ownerApproved", "trusted", "approved", "closed"];

// Executable shims that re-enter a shell on Windows (spawn routes .cmd/.bat/.ps1 through cmd.exe even with
// shell:false → argv re-parsing). The trusted CLI path must be a real executable, not a shim.
const UNSAFE_SHIM = /\.(cmd|bat|ps1)$/i;

const caseFold = () => (process.platform === "win32" || process.platform === "darwin");

/** Build the minimal child environment from the allowlist. Never spreads process.env. */
function buildMinimalEnv(platform, extraAllow) {
  const src = process.env;
  const allow = ENV_ALLOW_COMMON
    .concat(platform === "win32" ? ENV_ALLOW_WIN : ENV_ALLOW_POSIX)
    .concat(Array.isArray(extraAllow) ? extraAllow : []);
  const out = Object.create(null);
  for (const k of allow) {
    if (typeof src[k] !== "string") continue;
    if (TOKENISH_NAME.test(k)) continue;
    out[k] = src[k];
  }
  return out;
}

function isTokenishName(name) { return TOKENISH_NAME.test(String(name)); }
function promptHasRawSecret(text) { return SECRET_SHAPE.test(String(text || "")); }
function scrubSecrets(text) { return String(text == null ? "" : text).replace(secretShapeGlobal(), "«redacted»"); }
function isUnsafeShim(bin) { return UNSAFE_SHIM.test(String(bin || "")); }

/** Resolve the effective, trusted policy for a run. Returns { policy, violations }. */
function resolvePolicy(req, config) {
  const r = req || {};
  const c = config || {};
  const violations = CONTROL_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(r, k));

  const roots = c.projectRoots || {};
  const projectId = typeof r.projectId === "string" ? r.projectId : "";
  const repoRoot = Object.prototype.hasOwnProperty.call(roots, projectId) ? roots[projectId] : null;

  const p = c.policy || {};
  const op = c.operation || {};
  const policy = {
    repoRoot: repoRoot,
    expectedRemote: typeof p.expectedRemote === "string" ? p.expectedRemote : null,
    expectedBranch: typeof p.expectedBranch === "string" ? p.expectedBranch : null,
    requireClean: p.requireClean !== false,
    allowedPaths: Array.isArray(p.allowedPaths) ? p.allowedPaths.slice() : [],
    forbiddenPaths: Array.isArray(p.forbiddenPaths) ? p.forbiddenPaths.slice() : [],
    tools: Array.isArray(p.tools) ? p.tools.slice() : [],
    commands: Array.isArray(p.commands) ? p.commands.slice() : [],
    timeoutMs: Number.isFinite(p.timeoutMs) ? p.timeoutMs : 120000,
    maxOutputBytes: Number.isFinite(p.maxOutputBytes) ? p.maxOutputBytes : 2 * 1024 * 1024,
    maxPromptChars: Number.isFinite(p.maxPromptChars) ? p.maxPromptChars : 8000,
    envAllowlist: Array.isArray(p.envAllowlist) ? p.envAllowlist.slice() : [],
    mode: typeof p.mode === "string" ? p.mode : "propose",
    phaseId: typeof op.phaseId === "string" ? op.phaseId : null,
    approvalId: typeof op.approvalId === "string" ? op.approvalId : null,
    operationId: typeof op.operationId === "string" ? op.operationId : null,
  };
  return { policy, violations };
}

/** Normalise a repo-relative path for comparison (slash + optional case fold). */
function normPath(p) {
  const s = String(p).replace(/\\/g, "/");
  return caseFold() ? s.toLowerCase() : s;
}

/**
 * A change path is allowed only when relative, escape-free (no `..`, absolute, drive, UNC, NUL), matches
 * the allowlist, is not forbidden, is not ProjectOS source, and is not git metadata. Case-insensitive on
 * Windows/macOS so a re-cased new directory cannot slip a forbidden prefix.
 */
function isAllowedPath(p, policy) {
  if (typeof p !== "string" || !p) return false;
  if (p.includes("\0") || p.includes("..")) return false;
  if (p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:/.test(p) || /^\\\\/.test(p)) return false; // abs/UNC
  const norm = normPath(p);
  if (norm === ".git" || norm.startsWith(".git/")) return false;
  if (norm === "projectos" || norm.startsWith("projectos/")) return false;
  const pref = (list) => (list || []).some((a) => {
    const an = normPath(a);
    return norm === an || norm.startsWith(an.endsWith("/") ? an : an + "/");
  });
  return pref(policy.allowedPaths) && !pref(policy.forbiddenPaths);
}

/** Reject an allowlist that itself reaches ProjectOS source / the whole repo. */
function allowlistTouchesProjectos(policy) {
  return (policy.allowedPaths || []).some((a) => {
    const an = normPath(a);
    return an === "projectos" || an.startsWith("projectos/") || an === "." || an === "" || an === "/";
  });
}

/**
 * Build a frozen, schema-shaped worker result. THROWS on a forbidden gate decision or forbidden field —
 * a forbidden authority claim must be a hard error, never silently coerced.
 */
function buildResult(fields) {
  const f = fields || {};
  const decision = String(f.workerDecision || "PROPOSED").toUpperCase();
  if (FORBIDDEN_WORKER_DECISIONS.includes(decision)) throw new Error("buildResult: forbidden workerDecision '" + decision + "'");
  for (const k of FORBIDDEN_RESULT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(f, k)) throw new Error("buildResult: forbidden field '" + k + "'");
  }
  const result = {
    schemaVersion: "1.0",
    operationId: f.operationId || null,
    projectId: f.projectId || null,
    phaseId: f.phaseId || null,
    approvalStatus: f.approvalStatus || "none",
    repository: { toplevel: f.toplevel || null, origin: f.origin || null },
    baselineBranch: f.baselineBranch || null,
    baselineHead: f.baselineHead || null,
    finalBranch: f.finalBranch || null,
    finalHead: f.finalHead || null,
    outcome: f.outcome || "unknown",
    reason: f.reason || null,
    filesInspected: Array.isArray(f.filesInspected) ? f.filesInspected : [],
    filesProposed: Array.isArray(f.filesProposed) ? f.filesProposed : [],
    filesChanged: Array.isArray(f.filesChanged) ? f.filesChanged : [],
    refusedPaths: Array.isArray(f.refusedPaths) ? f.refusedPaths : [],
    patchHash: f.patchHash || null,
    changeManifest: Array.isArray(f.changeManifest) ? f.changeManifest : [],
    commandsRequested: Array.isArray(f.commandsRequested) ? f.commandsRequested : [],
    commandsExecuted: Array.isArray(f.commandsExecuted) ? f.commandsExecuted : [],
    controlsEnforced: Array.isArray(f.controlsEnforced) ? f.controlsEnforced : [],
    outOfScopeDelegated: Array.isArray(f.outOfScopeDelegated) ? f.outOfScopeDelegated : [],
    validatorResults: Array.isArray(f.validatorResults) ? f.validatorResults : [],
    timeoutStatus: f.timeoutStatus || "none",
    cancellationStatus: f.cancellationStatus || "none",
    killConfirmed: f.killConfirmed === undefined ? null : !!f.killConfirmed,
    outputRedactionStatus: f.outputRedactionStatus || "applied",
    envRedactionStatus: f.envRedactionStatus || "minimal-allowlist",
    outputExcerpt: typeof f.outputExcerpt === "string" ? f.outputExcerpt : "",
    residue: Array.isArray(f.residue) ? f.residue : [],
    risks: Array.isArray(f.risks) ? f.risks : [],
    workerDecision: decision,
    projectOsDecisionRequired: true,
  };
  return Object.freeze(result);
}

/** Validate a result against the contract. Returns an error array (empty = valid). */
function validateResult(result) {
  const errors = [];
  const r = result || {};
  const required = [
    "schemaVersion", "operationId", "projectId", "phaseId", "approvalStatus", "repository", "baselineBranch",
    "baselineHead", "finalBranch", "finalHead", "outcome", "filesInspected", "filesProposed", "filesChanged",
    "refusedPaths", "patchHash", "changeManifest", "commandsRequested", "commandsExecuted", "controlsEnforced",
    "validatorResults", "timeoutStatus", "cancellationStatus", "killConfirmed", "outputRedactionStatus",
    "envRedactionStatus", "outputExcerpt", "residue", "risks", "workerDecision", "projectOsDecisionRequired",
  ];
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: missing field '" + k + "'");
  if (r.schemaVersion !== "1.0") errors.push("result: bad schemaVersion");
  if (FORBIDDEN_WORKER_DECISIONS.includes(String(r.workerDecision).toUpperCase())) errors.push("result: workerDecision is an authoritative gate outcome (forbidden)");
  for (const k of FORBIDDEN_RESULT_FIELDS) if (Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: forbidden field '" + k + "'");
  if (r.projectOsDecisionRequired !== true) errors.push("result: projectOsDecisionRequired must be true");
  return errors;
}

module.exports = {
  buildMinimalEnv, isTokenishName, promptHasRawSecret, scrubSecrets, isUnsafeShim, resolvePolicy,
  isAllowedPath, allowlistTouchesProjectos, buildResult, validateResult, normPath,
  CONTROL_FIELDS, FORBIDDEN_WORKER_DECISIONS, FORBIDDEN_RESULT_FIELDS, SECRET_SHAPE, ENV_ALLOW_COMMON,
};
