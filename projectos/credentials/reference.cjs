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
 * WHOSE A CREDENTIAL IS (PROJECTOS-TENANT-CREDENTIALS1A, ADR-T1 §6). Risk says how dangerous it is; class
 * says who it belongs to, and the five-segment format does not change, so no stored secret is re-entered:
 *   - "project"  → `ProjectOS/<project>/…`, which inherits its project's tenant;
 *   - "tenant"   → `ProjectOS/tenant.<tenantId>/…`, the reserved segment, matched case-insensitively
 *                  because Windows target names may be. No real project id may start with it, in any case;
 *   - "platform" → the gatekeeper key. It serves every tenant through the broker and is released to none.
 *                  It keeps its stored name, so it is named here exactly, in any case.
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
  "vercel-token",
]);

/**
 * Credential names explicitly known to be high risk. Listed for documentation and for `doctor`
 * reporting; classification does NOT depend on this list being complete (the default is `operation`).
 */
const OPERATION_CREDENTIALS = Object.freeze([
  "supabase-access-token",
  "db-password",
  "service-role-key",
  "production-deploy-token",
  "real-send-credential",
  "payment-credential",
]);

/**
 * Tokens that reach a whole provider account whatever they declare. A Supabase personal access token has
 * no project scope to declare: it can act on every project on the account and it bypasses RLS. So it is
 * never a session credential, and the vault reads its reach as `account` even if a record says otherwise.
 */
const ACCOUNT_WIDE_CREDENTIALS = Object.freeze(["supabase-access-token"]);
/** Names that say the same thing another way: a personal access token, by whichever spelling. */
const ACCOUNT_WIDE_NAME_RE = /(?:^|[-_.])(?:pat|personal[-_.]?access[-_.]?token|access[-_.]?token)(?:$|[-_.])/i;

const SESSION_SET = new Set(SESSION_CREDENTIALS);

/** The reserved project segment. The same prefix `core/src/tenant.ts` refuses as a project id. */
const TENANT_PREFIX = "tenant.";
/** The same shape `core/src/tenant.ts` gives a tenant id. */
const TENANT_ID_RE = /^[a-z][a-z0-9-]{1,56}$/;

/**
 * The credentials that serve every tenant through the broker and are released to none. Named exactly,
 * because the stored name stays: the gatekeeper key's project segment is `projectos`, so nothing about
 * its shape says what it is.
 */
const PLATFORM_REFERENCES = Object.freeze(["ProjectOS/projectos/development/openai/gatekeeper-api-key"]);

/**
 * What a credential can reach, as declared per credential rather than assumed (ADR-T1 §6): one project,
 * one tenant, or a whole provider account, which then names every tenant that account holds.
 */
const REACHES = Object.freeze(["project", "tenant", "account"]);

/**
 * Lower-cases A to Z and nothing else. `toLowerCase` folds U+212A KELVIN SIGN to `k`, so a non-ASCII
 * spelling could equal a reserved name.
 */
function asciiLower(text) {
  return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

const PLATFORM_SET = new Set(PLATFORM_REFERENCES.map(asciiLower));

/**
 * Does this NAME say the credential reaches a whole account? A name can lie: a classic GitHub token stored
 * as `gh-token` is account-wide and reads as nothing here. This catches what says so, and nothing more.
 */
function isAccountWide(credentialName) {
  return typeof credentialName === "string" && (ACCOUNT_WIDE_CREDENTIALS.includes(credentialName) || ACCOUNT_WIDE_NAME_RE.test(credentialName));
}

/** Would a credential reference read this project id as a tenant-class segment? */
function isReservedProjectId(projectId) {
  return typeof projectId === "string" && asciiLower(projectId).startsWith(TENANT_PREFIX);
}

function isTenantId(value) {
  return typeof value === "string" && TENANT_ID_RE.test(value);
}

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
  const tenantId = isReservedProjectId(project) ? asciiLower(project).slice(TENANT_PREFIX.length) : null;
  if (tenantId !== null && !isTenantId(tenantId)) return { ok: false, reason: "reference-invalid-tenant-segment" };
  return {
    ok: true,
    ref: Object.freeze({
      reference: text,
      project,
      environment,
      provider,
      credential,
      risk: classifyRisk(credential),
      credentialClass: PLATFORM_SET.has(asciiLower(text)) ? "platform" : tenantId !== null ? "tenant" : "project",
      tenantId,
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
  ACCOUNT_WIDE_CREDENTIALS,
  PLATFORM_REFERENCES,
  REACHES,
  parseReference,
  formatReference,
  classifyRisk,
  fingerprint,
  belongsToProject,
  isReservedProjectId,
  isTenantId,
  isAccountWide,
  asciiLower,
};
