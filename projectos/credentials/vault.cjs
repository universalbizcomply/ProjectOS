"use strict";
/**
 * Credential vault — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L2 policy layer).
 *
 * The single chokepoint between a backing secret store (Windows Credential Manager, or the in-process
 * store used by validators) and everything else in ProjectOS. Nothing outside this module reads a
 * credential value.
 *
 * Policy enforced here, all fail-closed:
 *  - PROJECT BINDING. Every release is authorised against a caller-declared project. A reference whose
 *    project segment differs is refused before the store is touched — this is what makes a PolyGo session
 *    structurally unable to read a JD Testing credential even if it knows the exact reference string.
 *  - RISK SEPARATION. `session`-class credentials may be authorised for projection into a session's child
 *    environment. `operation`-class credentials (database passwords, service-role keys, production deploy
 *    tokens, real-send and payment credentials) can ONLY be authorised against a valid owner-confirmed
 *    permit bound to the same project, environment and reference. Risk class is fail-closed: an unknown
 *    credential name is `operation`.
 *  - GRANTS, NOT VALUES. Authorisation returns an opaque grant, not a secret. A grant is single-use, is
 *    recognised only by the vault instance that minted it (identity membership in a private WeakSet — a
 *    hand-built look-alike object is refused), and carries no value itself.
 *  - NO ORDINARY READ PATH. `status`, `present`, `list` and the audit log return metadata and
 *    fingerprints only. There is no debug or dump entry point that yields a value.
 *  - REDACTION ON RELEASE. Every released value is registered with the shared redactor before it is
 *    handed over, so any later log/report/approval item that happens to contain it is scrubbed.
 *
 * No network I/O. Disk I/O is confined to the non-secret metadata sidecar. Store access is delegated.
 */

const crypto = require("crypto");
const { createRedactor } = require("../security/redaction.cjs");
const { parseReference, fingerprint, belongsToProject } = require("./reference.cjs");
const { createMetadataStore } = require("./credential-metadata.cjs");

const GRANT_TTL_MS = 5 * 60 * 1000;

function requireStore(store) {
  const needed = ["set", "get", "exists", "del", "list"];
  if (!store || needed.some((m) => typeof store[m] !== "function")) {
    throw new Error("credential-vault: a credential store adapter is required");
  }
  return store;
}

function createCredentialVault(opts) {
  const options = opts || {};
  const store = requireStore(options.store);
  const redactor = options.redactor || createRedactor();
  const metadata = options.metadata || createMetadataStore({ stateDir: options.stateDir });
  const actor = typeof options.actor === "string" && options.actor ? options.actor : "operator";
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : () => Date.now();

  // Identity membership: only objects this instance minted are accepted. A structurally identical
  // object built by a caller is NOT in the set and cannot be redeemed.
  const liveGrants = new WeakSet();
  const consumed = new Set(); // grantId of every grant already redeemed — enforces single use
  const audit = [];

  function log(event) {
    audit.push({
      action: event.action,
      reference: event.reference || null,
      project: event.project || null,
      environment: event.environment || null,
      provider: event.provider || null,
      risk: event.risk || null,
      fingerprint: event.fingerprint || null,
      grantId: event.grantId || null,
      actor,
      ok: !!event.ok,
      reason: event.reason || null,
    });
  }

  function requireRef(reference, action) {
    const parsed = parseReference(reference);
    if (!parsed.ok) {
      log({ action, reference: typeof reference === "string" ? reference : null, ok: false, reason: parsed.reason });
      throw new Error("credential-vault: " + parsed.reason);
    }
    return parsed.ref;
  }

  function refFields(ref) {
    return { reference: ref.reference, project: ref.project, environment: ref.environment, provider: ref.provider, risk: ref.risk };
  }

  /**
   * Provision or replace a credential. `readValue` is a zero-argument callback supplied by the caller
   * (the CLI's hidden-input reader) — the value is never a parameter of this function's caller chain,
   * so it cannot be captured from a command line, a history file or a stack trace of the request.
   */
  function provision(input) {
    const { reference, readValue } = input || {};
    const replace = (input || {}).replace === true;
    const ref = requireRef(reference, "provision");
    if (typeof readValue !== "function") throw new Error("credential-vault: readValue callback required");

    const already = store.exists(ref.reference);
    if (already && !replace) {
      log({ action: "provision", ...refFields(ref), ok: false, reason: "already-exists" });
      throw new Error("credential-vault: a credential already exists at this reference — pass replace to overwrite");
    }

    const value = readValue();
    if (typeof value !== "string" || !value) {
      log({ action: "provision", ...refFields(ref), ok: false, reason: "empty-value" });
      throw new Error("credential-vault: no value supplied");
    }
    // Register before the value can travel anywhere, so even an error path is scrubbed.
    redactor.register(value, "cred_" + fingerprint(value));
    store.set(ref.reference, value);
    const record = metadata.recordProvision(ref.reference, value, { note: (input || {}).note, expiresAt: (input || {}).expiresAt });
    log({ action: replace ? "replace" : "provision", ...refFields(ref), fingerprint: record.fingerprint, ok: true });
    return { reference: ref.reference, fingerprint: record.fingerprint, risk: ref.risk, replaced: already };
  }

  function remove(input) {
    const ref = requireRef((input || {}).reference, "delete");
    const deleted = store.del(ref.reference);
    metadata.remove(ref.reference);
    log({ action: "delete", ...refFields(ref), ok: deleted, reason: deleted ? null : "not-found" });
    return deleted;
  }

  /** Presence test. Returns a boolean and nothing else — never an oracle on the value. */
  function present(input) {
    const ref = requireRef((input || {}).reference, "present");
    const exists = store.exists(ref.reference);
    log({ action: "present", ...refFields(ref), ok: true });
    return exists;
  }

  /**
   * Metadata-only listing. Merges what the store knows exists with what the metadata sidecar recorded,
   * so a credential provisioned outside ProjectOS still shows up (as `unmanaged`) rather than hiding.
   */
  function status(filter) {
    const f = filter || {};
    const prefix = f.project ? "ProjectOS/" + f.project : "ProjectOS";
    const inStore = store.list(prefix).filter((reference) => {
      const parsed = parseReference(reference);
      // Re-check the PROJECT segment here rather than trusting the store's prefix semantics. A Win32
      // credential filter is a plain wildcard match with no notion of a '/' boundary, so `ProjectOS/poly`
      // would otherwise sweep in `ProjectOS/polygo2/...` and leak a sibling project's credential inventory.
      return parsed.ok
        && (!f.project || parsed.ref.project === f.project)
        && (!f.environment || parsed.ref.environment === f.environment)
        && (!f.provider || parsed.ref.provider === f.provider);
    });
    const recorded = metadata.list(f);
    const byReference = new Map();
    for (const reference of inStore) {
      const ref = parseReference(reference).ref;
      byReference.set(reference, { reference, project: ref.project, environment: ref.environment, provider: ref.provider, credential: ref.credential, risk: ref.risk, present: true, fingerprint: null, createdAt: null, rotatedAt: null, expiresAt: null, note: null, managed: false });
    }
    for (const record of recorded) {
      const base = byReference.get(record.reference) || { reference: record.reference, project: record.project, environment: record.environment, provider: record.provider, credential: record.credential, risk: record.risk, present: false };
      byReference.set(record.reference, {
        ...base,
        present: base.present === true,
        fingerprint: record.fingerprint || null,
        createdAt: record.createdAt || null,
        rotatedAt: record.rotatedAt || null,
        expiresAt: record.expiresAt || null,
        note: record.note || null,
        expired: metadata.isExpired(record),
        managed: true,
      });
    }
    return [...byReference.values()].sort((a, b) => a.reference.localeCompare(b.reference));
  }

  function rotateMetadata(input) {
    const ref = requireRef((input || {}).reference, "rotate-metadata");
    const record = metadata.recordRotationMetadata(ref.reference, { expiresAt: (input || {}).expiresAt, note: (input || {}).note });
    log({ action: "rotate-metadata", ...refFields(ref), fingerprint: record.fingerprint, ok: true });
    return record;
  }

  function mintGrant(ref, purpose, extra) {
    const grant = Object.freeze({
      grantId: "grant_" + crypto.randomBytes(9).toString("hex"),
      reference: ref.reference,
      project: ref.project,
      environment: ref.environment,
      provider: ref.provider,
      credential: ref.credential,
      risk: ref.risk,
      purpose,
      expiresAtMs: nowMs() + GRANT_TTL_MS,
      ...(extra || {}),
    });
    liveGrants.add(grant);
    return grant;
  }

  /**
   * Authorise a `session`-class credential for projection into one session's child environment.
   * Refuses cross-project references and refuses every `operation`-class credential outright.
   */
  function authoriseSessionRelease(input) {
    const { projectId, sessionId } = input || {};
    const ref = requireRef((input || {}).reference, "authorise-session");
    if (!belongsToProject(ref, projectId)) {
      log({ action: "authorise-session", ...refFields(ref), ok: false, reason: "cross-project-refused" });
      throw new Error("credential-vault: reference belongs to another project — refused");
    }
    if (ref.risk !== "session") {
      log({ action: "authorise-session", ...refFields(ref), ok: false, reason: "operation-class-credential" });
      throw new Error("credential-vault: this credential is operation-class and cannot be loaded into a session");
    }
    if (!store.exists(ref.reference)) {
      log({ action: "authorise-session", ...refFields(ref), ok: false, reason: "credential-missing" });
      throw new Error("CREDENTIAL MISSING");
    }
    const grant = mintGrant(ref, "session", { sessionId: typeof sessionId === "string" ? sessionId : null });
    log({ action: "authorise-session", ...refFields(ref), grantId: grant.grantId, ok: true });
    return grant;
  }

  /**
   * Authorise an `operation`-class credential for ONE owner-gated command. Requires an owner-confirmed
   * permit whose project, environment and reference all match. ProjectOS cannot self-confirm: the
   * capability flag must be set by the owner-facing flow above this module.
   */
  function authoriseOperationRelease(input) {
    const { projectId, permit } = input || {};
    const capability = (input || {}).capability || {};
    const ref = requireRef((input || {}).reference, "authorise-operation");
    if (!belongsToProject(ref, projectId)) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "cross-project-refused" });
      throw new Error("credential-vault: reference belongs to another project — refused");
    }
    if (capability.ownerConfirmation !== true) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "owner-confirmation-required" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    if (!permit || typeof permit !== "object") {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "permit-required" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    if (permit.reference !== ref.reference || permit.projectId !== ref.project || permit.environment !== ref.environment) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "permit-binding-mismatch" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    if (typeof permit.expiresAtMs === "number" && permit.expiresAtMs <= nowMs()) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "permit-expired" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    if (!store.exists(ref.reference)) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "credential-missing" });
      throw new Error("CREDENTIAL MISSING");
    }
    const grant = mintGrant(ref, "operation", { permitId: typeof permit.permitId === "string" ? permit.permitId : null });
    log({ action: "authorise-operation", ...refFields(ref), grantId: grant.grantId, ok: true });
    return grant;
  }

  function redeem(grant, action) {
    if (!grant || typeof grant !== "object" || !liveGrants.has(grant)) {
      log({ action, ok: false, reason: "unrecognised-grant" });
      throw new Error("credential-vault: grant not recognised — nothing released");
    }
    if (consumed.has(grant.grantId)) {
      log({ action, reference: grant.reference, project: grant.project, environment: grant.environment, grantId: grant.grantId, ok: false, reason: "grant-already-used" });
      throw new Error("credential-vault: grant already used — nothing released");
    }
    if (grant.expiresAtMs <= nowMs()) {
      consumed.add(grant.grantId);
      log({ action, reference: grant.reference, project: grant.project, environment: grant.environment, grantId: grant.grantId, ok: false, reason: "grant-expired" });
      throw new Error("credential-vault: grant expired — nothing released");
    }
    consumed.add(grant.grantId);
    const value = store.get(grant.reference);
    if (typeof value !== "string" || !value) {
      log({ action, reference: grant.reference, project: grant.project, environment: grant.environment, grantId: grant.grantId, ok: false, reason: "credential-missing" });
      throw new Error("CREDENTIAL MISSING");
    }
    redactor.register(value, "cred_" + fingerprint(value));
    log({ action, reference: grant.reference, project: grant.project, environment: grant.environment, provider: grant.provider, risk: grant.risk, grantId: grant.grantId, fingerprint: fingerprint(value), ok: true });
    return value;
  }

  /**
   * Redeem a grant inside a closure. The value is handed to `fn` and never returned to the caller —
   * this is the only path an operation-class credential ever takes.
   */
  function useValue(grant, fn) {
    if (typeof fn !== "function") throw new Error("credential-vault: useValue requires a function");
    const value = redeem(grant, "use");
    return fn(value);
  }

  /**
   * Redeem a grant and return the value. Reserved for the session router, which immediately places the
   * value into a CHILD process environment and drops its own reference. Never call this to display,
   * return, log or serialise a credential.
   */
  function releaseIntoChildEnvironment(grant) {
    return redeem(grant, "release-into-child-environment");
  }

  function getAuditLog() {
    return audit.map((e) => ({ ...e }));
  }

  /** Invariant used by validators: no released value may appear anywhere in the audit trail. */
  function assertNoValueInAudit() {
    const serialized = JSON.stringify(audit);
    if (redactor.redactText(serialized) !== serialized) {
      throw new Error("credential-vault: SECURITY INVARIANT VIOLATED — a credential value appears in the audit trail");
    }
    return true;
  }

  return {
    storeName: store.name,
    metadataPath: metadata.filePath,
    redactText: (t) => redactor.redactText(t),
    redactObject: (o) => redactor.redactObject(o),
    provision,
    remove,
    present,
    status,
    rotateMetadata,
    authoriseSessionRelease,
    authoriseOperationRelease,
    useValue,
    releaseIntoChildEnvironment,
    getAuditLog,
    assertNoValueInAudit,
  };
}

module.exports = { createCredentialVault, GRANT_TTL_MS };
