"use strict";
/**
 * Project Session Launcher — PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A.
 *
 * Given a project + phase/task + a set of requested operations, this builds a deterministic LAUNCH SPEC
 * describing exactly what a work session WOULD do — assigned worker/role, working directory, which
 * operations are auto-allowed vs owner-gated vs refused, which secrets it would use (by reference only),
 * and the resulting launch decision. It NEVER spawns a process, contacts a provider, touches the
 * network, or performs any operation — it only plans, so the owner can see and approve before anything
 * runs. Execution is deliberately out of scope and is an owner-gated later phase.
 *
 * Trust model: the untrusted REQUEST supplies intent (projectId, phase, requested operations, a desired
 * working sub-path). The TRUSTED CONFIG (second argument, supplied by the server-side caller) supplies
 * the project→root registry. The allowed root is looked up from that registry by projectId; the request
 * can NEVER choose its own root. A project with no registered root cannot launch.
 *
 * Fail-closed rules:
 *  - Prohibited operations (deploy to production, mutate production DB, external sends, payments, force
 *    push, exposing a secret) → the whole spec is REFUSED and not launchable.
 *  - Owner-gated operations (staging deploy, install, closing a phase, granting PLAN READY, provider
 *    calls, running E2E) → the spec is BLOCKED_AWAITING_OWNER; it is never auto-launched.
 *  - Unknown operations are treated as refused (allowlist, not denylist).
 *  - The working directory must resolve inside the registered root (lexical AND case-sensitive prefix
 *    check); path traversal/escape/absolute paths are refused.
 *  - A production-frozen project refuses any production-targeting operation regardless of category.
 *  - Secrets appear in the plan only as references; no value is ever read or included.
 *  - Over-long operation/secret lists are refused (bounded input).
 *
 * NOTE: working-directory containment here is LEXICAL only (no symlink/junction resolution). Any future
 * execution phase MUST re-verify the resolved directory with fs.realpathSync immediately before use.
 *
 * Zero dependencies (Node built-ins only). No network, no disk writes, no process spawning.
 */

const crypto = require("crypto");
const path = require("path");

const MAX_OPERATIONS = 200;
const MAX_SECRET_REFS = 200;

// Operation classification. Allowlist: anything not listed is refused.
const PROHIBITED = new Set([
  "deploy-production", "mutate-production-db", "send-external", "process-payment", "force-push", "expose-secret",
]);
const OWNER_GATED = new Set([
  "deploy-staging", "install-projectops", "close-phase", "grant-plan-ready", "provider-call", "run-e2e",
]);
const AUTO_ALLOWED = new Set([
  "read-file", "write-file-local", "run-local-test", "build", "lint", "generate-report", "plan", "discover-plan",
]);
// Operations that target production even if requested; refused when the project is production-frozen.
const PRODUCTION_TARGETING = new Set(["deploy-production", "mutate-production-db", "deploy-staging"]);

function classify(op) {
  if (typeof op !== "string") return "unknown";
  if (PROHIBITED.has(op)) return "prohibited";
  if (OWNER_GATED.has(op)) return "gated";
  if (AUTO_ALLOWED.has(op)) return "allowed";
  return "unknown";
}

/** Look up a project's allowed root from the trusted registry — own-property only (no prototype pollution). */
function trustedRootFor(projectId, projectRoots) {
  if (!projectRoots || typeof projectRoots !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(projectRoots, projectId)) return null;
  const root = projectRoots[projectId];
  return typeof root === "string" && root ? root : null;
}

/**
 * Resolve a requested sub-path against the trusted root. Returns the absolute path only if it is
 * contained by the root under BOTH a lexical relative check and a case-sensitive prefix check; else null.
 */
function resolveWorkingDir(workingDirectory, allowedRoot) {
  if (typeof workingDirectory !== "string" || !workingDirectory) return null;
  if (typeof allowedRoot !== "string" || !allowedRoot) return null;
  const root = path.resolve(allowedRoot);
  const target = path.resolve(root, workingDirectory);
  const rel = path.relative(root, target);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  // Case-sensitive containment: path.relative can collapse case differences on Windows, which would
  // wrongly treat a differently-cased sibling as contained on case-sensitive volumes.
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) return null;
  return target;
}

function sessionIdFor(projectId, phaseId, taskId, role) {
  // JSON basis so field values containing the delimiter cannot collide across different inputs.
  const basis = JSON.stringify([projectId, phaseId, taskId || "", role || ""]);
  return "sess_" + crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

/** Partition requested operations into allowed / owner-gated / refused. Fresh arrays; pure. */
function classifyOperations(requested, productionFrozen) {
  const allowed = [];
  const gated = [];
  const refused = [];
  if (requested.length > MAX_OPERATIONS) {
    refused.push({ operation: "(list)", reason: "too-many-operations" });
    return { allowed, gated, refused };
  }
  for (const op of requested) {
    const kind = classify(op);
    if (kind === "prohibited") refused.push({ operation: op, reason: "prohibited" });
    else if (kind === "unknown") refused.push({ operation: String(op), reason: "not-on-allowlist" });
    else if (productionFrozen && PRODUCTION_TARGETING.has(op)) refused.push({ operation: op, reason: "production-frozen" });
    else if (kind === "gated") gated.push({ operation: op, requiresOwnerApproval: true });
    else allowed.push(op);
  }
  return { allowed, gated, refused };
}

/** Secrets are referenced, never materialised — only intent to use them via broker.use is recorded. */
function buildSecretPlan(secretRefs) {
  return secretRefs
    .filter((r) => typeof r === "string" && r)
    .map((ref) => ({ ref, usage: "via-broker-use", valueExposed: false }));
}

/**
 * Build a launch spec. Pure and deterministic.
 * @param input   untrusted request: { projectId, phaseId, taskId?, role?, worker?, productionFrozen?,
 *                 workingDirectory?, requestedOperations?, secretRefs? }
 * @param config  TRUSTED config: { projectRoots: { [projectId]: absoluteRoot } }
 * Throws only on structurally invalid input; policy failures are represented in the returned spec.
 */
function buildLaunchSpec(input, config) {
  const req = input || {};
  const trusted = config || {};
  const projectId = req.projectId;
  const phaseId = req.phaseId;
  if (typeof projectId !== "string" || !projectId) throw new Error("session-launcher: projectId required");
  if (typeof phaseId !== "string" || !phaseId) throw new Error("session-launcher: phaseId required");
  const taskId = typeof req.taskId === "string" ? req.taskId : null;
  const role = typeof req.role === "string" && req.role ? req.role : "implementer";
  const worker = typeof req.worker === "string" && req.worker ? req.worker : "(unassigned)";
  const productionFrozen = req.productionFrozen !== false; // default: frozen (fail safe)
  const requested = Array.isArray(req.requestedOperations) ? req.requestedOperations : [];
  const secretRefs = Array.isArray(req.secretRefs) ? req.secretRefs : [];

  // Root comes ONLY from the trusted registry, never from the request.
  const allowedRoot = trustedRootFor(projectId, trusted.projectRoots);
  const workingDir = allowedRoot ? resolveWorkingDir(req.workingDirectory, allowedRoot) : null;
  const workingDirError = workingDir === null;

  const { allowed: allowedOperations, gated: gatedOperations, refused: refusedOperations } =
    classifyOperations(requested, productionFrozen);

  // Fail closed (matching the operations path) rather than silently truncating an over-long secret list.
  if (secretRefs.length > MAX_SECRET_REFS) {
    refusedOperations.push({ operation: "(secret-list)", reason: "too-many-secret-refs" });
  }
  const secretPlan = buildSecretPlan(secretRefs);

  let decision;
  if (workingDirError || refusedOperations.length > 0) decision = "REFUSED";
  else if (gatedOperations.length > 0) decision = "BLOCKED_AWAITING_OWNER";
  else decision = "READY_TO_LAUNCH";

  return {
    sessionId: sessionIdFor(projectId, phaseId, taskId, role),
    projectId,
    phaseId,
    taskId,
    role,
    worker,
    productionFrozen,
    workingDirectory: workingDir, // null if no trusted root or the requested directory escaped it
    workingDirectoryError: workingDirError
      ? (allowedRoot ? "requested working directory is missing or escapes the allowed root"
                     : "no trusted root registered for this project")
      : null,
    allowedOperations,
    gatedOperations,
    refusedOperations,
    secretPlan,
    decision,
    // A launch is permitted ONLY when nothing is refused and nothing needs owner approval.
    permitted: decision === "READY_TO_LAUNCH",
    // This module never executes. Any actual run is a separate, owner-gated step.
    executed: false,
    note: "Plan only — the launcher does not spawn, deploy, or contact any provider.",
  };
}

module.exports = { buildLaunchSpec, PROHIBITED, OWNER_GATED, AUTO_ALLOWED };
