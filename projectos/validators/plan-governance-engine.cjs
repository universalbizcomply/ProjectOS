"use strict";
// ProjectOS V3 plan-governance engine. Pure, deterministic decision functions shared by the
// plan-governance validators. NOT auto-discovered by validate-all.cjs (exposes no run()); it is a
// library consumed by the thin validators. Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
//
// Design rules:
//  - Deterministic: no clock, no randomness, no network, no filesystem writes.
//  - PLAN READY is COMPUTED from evidence; the planStatus string never, by itself, grants readiness.
//  - The implementer (Claude) can never satisfy owner-approval or set PLAN READY.

const path = require("path");

// Identities that may NEVER be recorded as the plan approver. Owner approval only.
// Kept for reference/back-compat; detection now uses isImplementerIdentity() (token-based, not
// exact-match) so variants like "ClaudeCode", "Claude Opus 4.8" or non-breaking-space forms are caught.
const IMPLEMENTER_IDENTITIES = ["claude", "claude code", "claude-code", "implementer", "assistant", "ai"];
// Substrings that, if present after stripping all non-letters, mark the approver as the implementer.
const IMPLEMENTER_SUBSTRINGS = ["claude", "anthropic", "implementer", "assistant", "copilot"];
// Whole words (case-insensitive) that mark the approver as the implementer.
const IMPLEMENTER_WORDS = new Set(["ai", "bot", "agent", "llm", "model"]);

// True when a recorded approver identity is (or contains) the implementer rather than a human owner.
function isImplementerIdentity(name) {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  const stripped = lower.replace(/[^a-z]/g, "");            // collapse spaces/punctuation/unicode
  for (const s of IMPLEMENTER_SUBSTRINGS) if (stripped.indexOf(s) !== -1) return true;
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) if (IMPLEMENTER_WORDS.has(w)) return true;
  return false;
}

// Core forbidden actions every approved plan must retain.
const REQUIRED_FORBIDDEN_ACTIONS = [
  "production-deploy", "production-db-mutation", "real-email-sms-whatsapp",
  "payment-or-live-charge", "force-push", "use-openai-api", "use-anthropic-api"
];

// Explicit raw-secret marker token. FAIL fixtures embed this so the plan-secret scan catches them
// while the global validate-no-secrets regexes (jwt/stripe/aws/etc.) do NOT — keeping the repo green.
const RAW_SECRET_MARKER = "RAWSECRET::";

// Credential detection is token-based on the normalized key (lowercased, non-letters stripped): a key
// is credential-shaped if it CONTAINS any CREDENTIAL_TOKEN. This catches dbPassword, authToken,
// secretKey, stripeSecretKey, sessionSecret, clientSecret, apiKey, etc. A small allowlist exempts the
// governance/policy keys that legitimately contain "secret" but never carry a secret VALUE.
const CREDENTIAL_TOKENS = ["password", "passwd", "secret", "token", "apikey", "credential", "privatekey", "bearer"];
const CREDENTIAL_KEY_ALLOWLIST = new Set([
  "secretpolicy", "rawsecretvaluesforbidden", "sensitivedataforbidden", "redactionrequired",
  "secretcapabilityused", "rawsecretstored"
]);
function isCredentialKey(key) {
  const norm = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (CREDENTIAL_KEY_ALLOWLIST.has(norm)) return false;
  return CREDENTIAL_TOKENS.some((t) => norm.indexOf(t) !== -1);
}

const PROVIDER_REF_RE = /^provider:[a-z0-9-]+$/;
const HEX40_RE = /^[0-9a-f]{40}$/;

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }

// Recursively scan an object for raw-secret-shaped values. Returns array of { path, reason }.
function scanRawSecrets(obj, basePath) {
  const findings = [];
  const start = basePath || "$";
  (function walk(node, p) {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (node.indexOf(RAW_SECRET_MARKER) !== -1) findings.push({ path: p, reason: "explicit raw-secret marker" });
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, p + "[" + i + "]")); return; }
    if (typeof node === "object") {
      for (const key of Object.keys(node)) {
        const child = node[key];
        const childPath = p + "." + key;
        if (isCredentialKey(key) && isNonEmptyString(child) && !PROVIDER_REF_RE.test(child.trim())) {
          findings.push({ path: childPath, reason: "credential-shaped field '" + key + "' carries a non-reference value" });
        }
        walk(child, childPath);
      }
    }
  })(obj, start);
  return findings;
}

// Validate that a source-document path is a safe, repo-relative reference (no traversal, no absolute).
function isSafeRepoRelativePath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.indexOf("\0") !== -1) return false;
  if (path.isAbsolute(p)) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;                 // windows drive-absolute OR drive-relative (C:\ or C:foo)
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  const segs = p.split(/[\\/]/);
  if (segs.some((s) => s === "..")) return false;         // traversal
  return true;
}

// Check phase dependency graph: refs exist, no self-dep, no cycle, deps precede dependants.
function checkPhaseDeps(phases) {
  const errors = [];
  if (!Array.isArray(phases) || phases.length === 0) { errors.push("phases must be a non-empty array"); return errors; }
  const ids = phases.map((ph) => ph.phaseId);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) errors.push("duplicate phaseId in phases");
  const indexById = {};
  phases.forEach((ph, i) => { indexById[ph.phaseId] = i; });
  phases.forEach((ph, i) => {
    const deps = Array.isArray(ph.dependsOn) ? ph.dependsOn : [];
    for (const d of deps) {
      if (d === ph.phaseId) { errors.push("phase " + ph.phaseId + " depends on itself"); continue; }
      if (!idSet.has(d)) { errors.push("phase " + ph.phaseId + " depends on unknown phase '" + d + "'"); continue; }
      if (indexById[d] > i) errors.push("phase " + ph.phaseId + " depends on later phase '" + d + "' (forward dependency)");
    }
  });
  // Cycle detection (DFS over declared deps).
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  ids.forEach((id) => { color[id] = WHITE; });
  const adj = {};
  phases.forEach((ph) => { adj[ph.phaseId] = (Array.isArray(ph.dependsOn) ? ph.dependsOn : []).filter((d) => idSet.has(d) && d !== ph.phaseId); });
  let cyclic = false;
  function dfs(u) {
    color[u] = GRAY;
    for (const v of adj[u]) {
      if (color[v] === GRAY) { cyclic = true; return; }
      if (color[v] === WHITE) dfs(v);
    }
    color[u] = BLACK;
  }
  for (const id of ids) { if (color[id] === WHITE) dfs(id); if (cyclic) break; }
  if (cyclic) errors.push("phase dependency cycle detected");
  return errors;
}

// Check source-document references for path safety and classification.
function checkSourceDocuments(docs) {
  const errors = [];
  if (!Array.isArray(docs) || docs.length === 0) { errors.push("sourceDocuments must be a non-empty array"); return errors; }
  let authoritativeCount = 0;
  docs.forEach((d, i) => {
    if (!isSafeRepoRelativePath(d.documentPath)) errors.push("sourceDocuments[" + i + "] unsafe/non-relative path: " + d.documentPath);
    if (typeof d.authoritative !== "boolean") errors.push("sourceDocuments[" + i + "] missing boolean 'authoritative'");
    if (typeof d.superseded !== "boolean") errors.push("sourceDocuments[" + i + "] missing boolean 'superseded'");
    if (!isNonEmptyString(d.sourceDocumentChecksum)) errors.push("sourceDocuments[" + i + "] missing checksum");
    if (d.authoritative === true && d.superseded === false) authoritativeCount += 1;
  });
  if (authoritativeCount < 1) errors.push("no current authoritative source document (authoritative=true, superseded=false)");
  return errors;
}

// The PLAN READY gate. Returns { ready, reasons }. reasons is the list of failing checks.
function evaluatePlanReady(plan) {
  const reasons = [];
  if (!plan || typeof plan !== "object") return { ready: false, reasons: ["plan is not an object"] };

  // Repository identity + expected remote + commit semantics.
  // baselineCommit  = repository state the plan was created from (must exist, 40-hex).
  // planPersistenceCommit = commit that will contain the persisted plan; null before commit, 40-hex after.
  const repo = plan.repository || {};
  if (!isNonEmptyString(repo.repositoryPath)) reasons.push("repository.repositoryPath missing");
  if (!isNonEmptyString(repo.expectedRemote)) reasons.push("repository.expectedRemote missing");
  if (!HEX40_RE.test(repo.baselineCommit || "")) reasons.push("repository.baselineCommit not a 40-hex commit (plan not linked to a baseline commit)");
  if (!(repo.planPersistenceCommit === null || (typeof repo.planPersistenceCommit === "string" && HEX40_RE.test(repo.planPersistenceCommit)))) reasons.push("repository.planPersistenceCommit must be null (pre-commit) or a 40-hex commit");
  if (!Array.isArray(repo.protectedBranches) || repo.protectedBranches.length === 0) reasons.push("repository.protectedBranches missing");

  // Vision / definition of complete / scope.
  if (!isNonEmptyString(plan.businessVision)) reasons.push("businessVision missing");
  if (!isNonEmptyString(plan.definitionOfComplete)) reasons.push("definitionOfComplete missing");
  if (!Array.isArray(plan.approvedScope) || plan.approvedScope.length === 0) reasons.push("approvedScope empty");
  if (!Array.isArray(plan.excludedScope) || plan.excludedScope.length === 0) reasons.push("excludedScope empty");
  if (!isNonEmptyString(plan.successStandard)) reasons.push("successStandard missing");

  // Not in a conflicting or blocked state.
  if (plan.planStatus === "PLAN CONFLICT") reasons.push("planStatus is PLAN CONFLICT (unresolved conflict)");
  if (plan.planStatus === "PLAN BLOCKED") reasons.push("planStatus is PLAN BLOCKED (unresolved blocking condition)");

  // Source documents.
  for (const err of checkSourceDocuments(plan.sourceDocuments || [])) reasons.push(err);

  // Phases + dependencies + acceptance criteria.
  const phases = plan.phases || [];
  for (const err of checkPhaseDeps(phases)) reasons.push(err);
  phases.forEach((ph) => {
    if (!Array.isArray(ph.acceptanceCriteria) || ph.acceptanceCriteria.length === 0) reasons.push("phase " + (ph.phaseId || "?") + " has no acceptanceCriteria");
  });

  // Environments mapped.
  if (!Array.isArray(plan.environments) || plan.environments.length === 0) reasons.push("environments not mapped");

  // Providers: reference-only (no raw credentials).
  (plan.providers || []).forEach((pr, i) => {
    if (!PROVIDER_REF_RE.test(pr.providerRef || "")) reasons.push("providers[" + i + "] not a reference name: " + pr.providerRef);
  });

  // Validators mapped somewhere across phases.
  const anyValidator = phases.some((ph) => Array.isArray(ph.requiredValidators) && ph.requiredValidators.length > 0);
  if (!anyValidator) reasons.push("no phase maps any requiredValidators");

  // Governance: owner-only actions, forbidden set, no-API policy.
  const gov = plan.governance || {};
  if (!Array.isArray(gov.ownerOnlyActions) || gov.ownerOnlyActions.length === 0) reasons.push("governance.ownerOnlyActions empty");
  const forbidden = Array.isArray(gov.forbiddenActions) ? gov.forbiddenActions : [];
  for (const need of REQUIRED_FORBIDDEN_ACTIONS) if (!forbidden.includes(need)) reasons.push("governance.forbiddenActions missing: " + need);
  if (gov.noApiPolicy !== true) reasons.push("governance.noApiPolicy is not true");

  // Plan version recorded.
  if (!/^[0-9]+\.[0-9]+$/.test(plan.planVersion || "")) reasons.push("planVersion not recorded (X.Y)");

  // Owner approval — required, and the approver must NOT be the implementer.
  const appr = plan.approval || {};
  if (appr.approvalStatus !== "approved") reasons.push("approval.approvalStatus is not 'approved'");
  if (!isNonEmptyString(appr.approvedBy)) reasons.push("approval.approvedBy missing");
  else if (isImplementerIdentity(appr.approvedBy)) reasons.push("approval.approvedBy is the implementer — Claude cannot approve a plan");
  if (!isNonEmptyString(appr.approvalEvidenceReference)) reasons.push("approval.approvalEvidenceReference missing");
  // Approval-binding truth: the recorded binding must be honest and must not overclaim identity assurance.
  for (const err of checkApprovalBinding(plan)) reasons.push(err);

  // Security: raw secrets forbidden and none present.
  const sec = plan.security || {};
  if (sec.rawSecretValuesForbidden !== true) reasons.push("security.rawSecretValuesForbidden is not true");
  const secretFindings = scanRawSecrets(plan);
  for (const f of secretFindings) reasons.push("raw secret present at " + f.path + " (" + f.reason + ")");

  // Staleness: a stale plan is not ready.
  const st = plan.staleness || {};
  if (st.stalenessStatus === "stale") reasons.push("plan is PLAN STALE");

  return { ready: reasons.length === 0, reasons: reasons };
}

// Compute staleness from recorded material-input fingerprints vs a current fingerprint map.
// Only inputs listed in plan.staleness.materialPlanInputs can stale the plan; ordinary progress
// (HEAD advance, phase completion, reports) is not among them, so it never stales.
function computeStaleness(plan, currentFingerprints) {
  const reasons = [];
  const recorded = (plan.staleness && Array.isArray(plan.staleness.materialPlanInputs)) ? plan.staleness.materialPlanInputs : [];
  const cur = currentFingerprints || {};
  for (const input of recorded) {
    if (!(input.inputId in cur)) {
      // Fail-safe: a recorded material input with no current reading cannot be verified fresh.
      reasons.push("material input unverifiable (no current fingerprint): " + input.inputId);
      continue;
    }
    if (cur[input.inputId] !== input.fingerprint) reasons.push("material input changed: " + input.inputId);
  }
  return { stale: reasons.length > 0, reasons: reasons };
}

// Minimal, dependency-free JSON-Schema checker supporting exactly the draft-07 keywords used by the
// V3 schemas: type, required, properties, additionalProperties:false, items, enum, const, pattern,
// minItems, minLength, minimum, maximum, and nullable via type arrays. Returns error strings with
// JSON paths. Not a general validator — deliberately scoped to the keywords in use.
function validateAgainstSchema(obj, schema, basePath) {
  const errors = [];
  function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (Number.isInteger(v)) return "integer";
    return typeof v; // string | number | boolean | object
  }
  function typeMatches(v, t) {
    if (t === "number") return typeof v === "number";
    if (t === "integer") return Number.isInteger(v);
    return typeOf(v) === t;
  }
  function check(node, sch, p) {
    if (!sch || typeof sch !== "object") return;
    if (sch.type) {
      const types = Array.isArray(sch.type) ? sch.type : [sch.type];
      if (!types.some((t) => typeMatches(node, t))) { errors.push(p + ": expected type " + types.join("|") + ", got " + typeOf(node)); return; }
    }
    if (sch.const !== undefined && node !== sch.const) errors.push(p + ": must equal " + JSON.stringify(sch.const));
    if (sch.enum && sch.enum.indexOf(node) === -1) errors.push(p + ": '" + node + "' not in enum");
    if (typeof node === "string") {
      if (sch.minLength !== undefined && node.length < sch.minLength) errors.push(p + ": shorter than minLength " + sch.minLength);
      if (sch.pattern && !(new RegExp(sch.pattern)).test(node)) errors.push(p + ": does not match pattern " + sch.pattern);
    }
    if (typeof node === "number") {
      if (sch.minimum !== undefined && node < sch.minimum) errors.push(p + ": below minimum " + sch.minimum);
      if (sch.maximum !== undefined && node > sch.maximum) errors.push(p + ": above maximum " + sch.maximum);
    }
    if (Array.isArray(node)) {
      if (sch.minItems !== undefined && node.length < sch.minItems) errors.push(p + ": fewer than minItems " + sch.minItems);
      if (sch.items) node.forEach((v, i) => check(v, sch.items, p + "[" + i + "]"));
    }
    if (node && typeof node === "object" && !Array.isArray(node)) {
      const props = sch.properties || {};
      for (const req of (sch.required || [])) if (!(req in node)) errors.push(p + ": missing required '" + req + "'");
      if (sch.additionalProperties === false) {
        for (const k of Object.keys(node)) if (!(k in props)) errors.push(p + ": unexpected property '" + k + "'");
      }
      for (const k of Object.keys(props)) if (k in node) check(node[k], props[k], p + "." + k);
    }
  }
  check(obj, schema, basePath || "$");
  return errors;
}

// New-project start constraint: a project is eligible for autonomous E2E only when its plan is
// PLAN READY (computed from evidence). No approved, ready plan in memory -> no autonomous start.
function isEligibleForE2E(plan) {
  const verdict = evaluatePlanReady(plan);
  return { eligible: verdict.ready, reasons: verdict.reasons };
}

// Approval-binding legality. Enforces honest representation of how owner approval is bound:
//  - authority must be the owner (never the implementer);
//  - binding must be declared (MANUAL_GOVERNANCE_APPROVAL or SECURE_OWNER_APPROVAL);
//  - tamperProof cannot be true yet (no cryptographic/secure infra exists) — no overclaim;
//  - SECURE_OWNER_APPROVAL cannot be claimed without secure evidence fields.
// Manual, human-gated approval remains valid for the present workflow. Returns [] when legal.
const APPROVAL_BINDINGS = ["MANUAL_GOVERNANCE_APPROVAL", "SECURE_OWNER_APPROVAL"];
function checkApprovalBinding(plan) {
  const errors = [];
  const appr = (plan && plan.approval) || {};
  const binding = appr.approvalBinding;
  const authority = appr.approvalAuthority;
  if (APPROVAL_BINDINGS.indexOf(binding) === -1) { errors.push("approval.approvalBinding not declared (MANUAL_GOVERNANCE_APPROVAL | SECURE_OWNER_APPROVAL)"); }
  if (authority !== "owner") errors.push("approval.approvalAuthority must be 'owner' (implementer/gatekeeper cannot own approval)");
  if (appr.tamperProof === true) errors.push("approval.tamperProof cannot be true — cryptographic/secure binding is not yet implemented (no overclaim)");
  if (binding === "SECURE_OWNER_APPROVAL") {
    const ev = appr.secureApprovalEvidence;
    if (!ev || typeof ev !== "object" || !isNonEmptyString(ev.signatureRef) || !isNonEmptyString(ev.identityRef)) {
      errors.push("SECURE_OWNER_APPROVAL requires secureApprovalEvidence.signatureRef and identityRef");
    }
  }
  return errors;
}

// Version-record legality for an approved plan version. Returns [] when legal, else reasons.
function checkVersionRecord(plan) {
  const errors = [];
  const v = plan.planVersion || "";
  if (!/^[0-9]+\.[0-9]+$/.test(v)) errors.push("planVersion not X.Y");
  const appr = plan.approval || {};
  const sup = appr.supersedesPlanVersion;
  if (sup !== null && sup !== undefined) {
    if (typeof sup !== "string" || !/^[0-9]+\.[0-9]+$/.test(sup)) errors.push("supersedesPlanVersion not X.Y or null");
    else if (sup === v) errors.push("plan version supersedes itself (" + v + ")");
  }
  if (appr.approvalStatus === "approved") {
    if (!isNonEmptyString(appr.approvedBy)) errors.push("approved version missing approvedBy");
    else if (isImplementerIdentity(appr.approvedBy)) errors.push("approved version approver is the implementer");
  }
  return errors;
}

module.exports = {
  IMPLEMENTER_IDENTITIES,
  REQUIRED_FORBIDDEN_ACTIONS,
  RAW_SECRET_MARKER,
  scanRawSecrets,
  isSafeRepoRelativePath,
  checkPhaseDeps,
  checkSourceDocuments,
  evaluatePlanReady,
  computeStaleness,
  isEligibleForE2E,
  checkVersionRecord,
  checkApprovalBinding,
  isImplementerIdentity,
  isCredentialKey,
  validateAgainstSchema
};
