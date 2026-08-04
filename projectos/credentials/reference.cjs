"use strict";
/**
 * Credential references — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L2 naming layer).
 *
 * A credential reference is the ONLY thing that ever appears in a repository, a `.projectops` file,
 * a `.mcp.json`, a log line, a report or a prompt. It names a secret; it is not a secret.
 *
 *     ProjectOS/<project>/<environment>/<provider>/<credential>
 *
 * Every segment is drawn from a strict charset so a reference can be used verbatim as an OS
 * credential-store target name without escaping, and so no segment can smuggle a path separator, a
 * traversal component, a null byte or a shell metacharacter into a downstream store adapter.
 *
 * This module also owns RISK CLASSIFICATION. A credential is either:
 *   - "session"   → may be projected into a session's child environment (L3 session router), or
 *   - "operation" → high-risk; may only be released for ONE owner-gated command (L4 operation broker).
 * Classification is fail-closed: a credential name that is not on the session allowlist is treated as
 * `operation`, so a new or misspelled credential name can never be silently auto-loaded into a session.
 *
 * Fingerprints are non-reversible (salted-domain SHA-256, truncated) and are the ONLY value-derived
 * data this capability is permitted to display or log.
 *
 * Zero dependencies (Node built-ins only). No network, no disk, no spawning.
 */

const crypto = require("crypto");

const ROOT = "ProjectOS";
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SEGMENT_COUNT = 5; // ProjectOS / project / environment / provider / credential
const FINGERPRINT_DOMAIN = "projectos.credential.fingerprint.v1:";
const FINGERPRINT_LEN = 12;

/** Environments a reference may name. Anything else is refused (fail closed). */
const ENVIRONMENTS = Object.freeze(["development", "staging", "production"]);

/**
 * Credential names that MAY be projected into a session environment. Everything else — including any
 * unknown name — is classified `operation` and can only be released for a single owner-gated command.
 */
const SESSION_CREDENTIALS = Object.freeze([
  "gh-token",
  "supabase-access-token",
  "vercel-token",
]);

/**
 * Credential names explicitly known to be high risk. Listed for documentation and for `doctor`
 * reporting; classification does NOT depend on this list being complete (the default is `operation`).
 */
const OPERATION_CREDENTIALS = Object.freeze([
  "db-password",
  "service-role-key",
  "production-deploy-token",
  "real-send-credential",
  "payment-credential",
]);

const SESSION_SET = new Set(SESSION_CREDENTIALS);

function isSegment(s) {
  return typeof s === "string" && SEGMENT_RE.test(s);
}

/**
 * Parse and validate a reference string. Returns `{ ok:true, ref }` or `{ ok:false, reason }`.
 * Never throws on caller input — callers decide whether a bad reference is fatal.
 */
function parseReference(text) {
  if (typeof text !== "string" || !text) return { ok: false, reason: "reference-required" };
  if (text.length > 400) return { ok: false, reason: "reference-too-long" };
  if (text.includes("\0")) return { ok: false, reason: "reference-null-byte" };
  const parts = text.split("/");
  if (parts.length !== SEGMENT_COUNT) return { ok: false, reason: "reference-segment-count" };
  if (parts[0] !== ROOT) return { ok: false, reason: "reference-root-mismatch" };
  const [, project, environment, provider, credential] = parts;
  for (const [name, value] of [["project", project], ["environment", environment], ["provider", provider], ["credential", credential]]) {
    if (!isSegment(value)) return { ok: false, reason: "reference-invalid-segment:" + name };
  }
  if (!ENVIRONMENTS.includes(environment)) return { ok: false, reason: "reference-unknown-environment" };
  return {
    ok: true,
    ref: Object.freeze({
      reference: text,
      project,
      environment,
      provider,
      credential,
      risk: classifyRisk(credential),
    }),
  };
}

/** Build a reference from parts. Throws on invalid input — this is a trusted-construction path. */
function formatReference(parts) {
  const p = parts || {};
  const text = [ROOT, p.project, p.environment, p.provider, p.credential].join("/");
  const parsed = parseReference(text);
  if (!parsed.ok) throw new Error("credential-reference: cannot format reference — " + parsed.reason);
  return parsed.ref.reference;
}

/**
 * Risk class for a credential name. Fail-closed: unknown → "operation".
 * A credential is session-projectable only if its exact name is on the allowlist.
 */
function classifyRisk(credentialName) {
  return SESSION_SET.has(credentialName) ? "session" : "operation";
}

/**
 * Non-reversible short fingerprint of a secret value, safe to display and log. Domain-separated so a
 * fingerprint from this capability cannot be replayed as a fingerprint of anything else.
 */
function fingerprint(value) {
  if (typeof value !== "string" || !value) throw new Error("credential-reference: fingerprint requires a value");
  return crypto.createHash("sha256").update(FINGERPRINT_DOMAIN).update(value, "utf8").digest("hex").slice(0, FINGERPRINT_LEN);
}

/** True when `ref` belongs to `projectId` — the cross-project isolation predicate. */
function belongsToProject(ref, projectId) {
  return !!ref && typeof projectId === "string" && ref.project === projectId;
}

module.exports = {
  ROOT,
  ENVIRONMENTS,
  SESSION_CREDENTIALS,
  OPERATION_CREDENTIALS,
  parseReference,
  formatReference,
  classifyRisk,
  fingerprint,
  belongsToProject,
};
