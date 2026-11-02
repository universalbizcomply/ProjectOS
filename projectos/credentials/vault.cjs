"use strict";
/**
 * Credential vault — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L2 policy layer).
 *
 * The chokepoint on ProjectOS's own routes between a backing secret store (Windows Credential Manager, or
 * the in-process store used by validators) and the rest of ProjectOS. The broker reads the platform key by
 * its own committed adapter, and any process of this Windows user can read the store directly (F7), so this
 * prevents accidents on the kernel's routes. It is not a boundary against a process that goes round them.
 *
 * Policy enforced here, all fail-closed:
 *  - A KERNEL REQUESTER. Every release and every mutation takes a requester the kernel minted from a run
 *    handle (see `createRequesterAuthority`), branded like a grant. A plain string or a copy is refused, so
 *    no caller can state a project or a tenant and be believed.
 *  - PROJECT BINDING. A project-class reference whose project segment differs from the requester's is
 *    refused before the store is touched — this is what makes a PolyGo session structurally unable to read
 *    a JD Testing credential even if it knows the exact reference string.
 *  - TENANT BINDING. A second question, not the first one restated: the reference's tenant must equal the
 *    requester's, whatever the project check said, and a tenant-class credential has only this rule.
 *  - CLASS. A platform credential is released to nobody. A tenant-class credential is never auto-loaded
 *    into a session. Session auto-load has no owner step, so it stays for a project's own credential, in
 *    its own tenant, recorded through an envelope, from a run that is more than a linked worktree.
 *  - REACH AND EXPIRY, ON BOTH PATHS. Each credential declares what it can reach, and a new value clears
 *    the declaration. Undeclared or expired is refused. Auto-load takes project reach only, so a wider token
 *    cannot sidestep the class rule. An operation refuses a reach into another tenant.
 *  - RISK SEPARATION. `session`-class credentials may be authorised for projection into a session's child
 *    environment. `operation`-class credentials (database passwords, service-role keys, production deploy
 *    tokens, real-send and payment credentials) can ONLY be authorised against a permit bound to the same
 *    project, environment, reference and run, and a committed, receipted `credential-release` grant naming the
 *    project, the exact reference, the action, the exact command and an expiry. Risk class is fail-closed: an
 *    unknown name is `operation`.
 *  - GRANTS, NOT VALUES. Authorisation returns an opaque grant, not a secret. A grant is single-use, is
 *    recognised only by the vault instance that minted it (identity membership in a private WeakSet — a
 *    hand-built look-alike object is refused), and carries no value itself.
 *  - NO ORDINARY READ PATH. `status`, `present`, `list` and the audit log return metadata and
 *    fingerprints only. There is no debug or dump entry point that yields a value.
 *  - REDACTION ON RELEASE. Every released value is registered with the shared redactor before it is
 *    handed over, so any later log/report/approval item that happens to contain it is scrubbed.
 *  - A DURABLE AUDIT. Every decision is a line on disk before its effect. A line that cannot be written
 *    stops the operation, the refusal path included, and nothing here catches that.
 *
 * WHAT THIS DOES NOT STOP. Everything runs as one Windows user, so a process can read the store directly
 * (ADR-T1 §10). This binds the kernel's routes. `status` stays unbound: it holds no value and the sidecar
 * calls it with no run, so it still lists every tenant's reference names.
 *
 * No network I/O. Disk I/O is confined to the non-secret metadata sidecar and the audit beside it. Store
 * access is delegated.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createRedactor } = require("../security/redaction.cjs");
const { parseReference, fingerprint, belongsToProject, REACHES, isAccountWide } = require("./reference.cjs");
const { createMetadataStore, requesterState, refusal, RECORD_LOCK_HINT } = require("./credential-metadata.cjs");

const GRANT_TTL_MS = 5 * 60 * 1000;
/** Beside the metadata sidecar, outside every repository. */
const AUDIT_FILE_NAME = "credential-audit.jsonl";
const AUDIT_ROTATE_BYTES = 1048576;

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
  const auditPath = path.join(String(metadata.stateDir), AUDIT_FILE_NAME);

  /**
   * One line, durably, or the operation stops. Appended rather than rewritten, so a line cannot take its
   * neighbours with it, and redacted first, so a value that somehow reached an event never reaches disk.
   */
  function writeAuditLine(entry) {
    try {
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      if (fs.existsSync(auditPath) && fs.statSync(auditPath).size >= AUDIT_ROTATE_BYTES) {
        fs.renameSync(auditPath, auditPath + "." + nowMs() + "-" + crypto.randomBytes(4).toString("hex"));
      }
      fs.appendFileSync(auditPath, redactor.redactText(JSON.stringify(entry)) + "\n", { encoding: "utf8", mode: 0o600 });
    } catch (e) {
      throw refusal("AUDIT_NOT_RECORDED", "the vault audit line could not be written, so this operation did not happen");
    }
  }

  function log(event) {
    const entry = {
      action: event.action,
      reference: event.reference || null,
      project: event.project || null,
      environment: event.environment || null,
      provider: event.provider || null,
      risk: event.risk || null,
      fingerprint: event.fingerprint || null,
      grantId: event.grantId || null,
      requester: event.requester || null,
      tenant: event.tenant || null,
      sessionId: event.sessionId || null,
      command: event.command || null,
      args: event.args || null,
      exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,
      reachBefore: event.reachBefore || null,
      reachAfter: event.reachAfter || null,
      actor,
      ok: !!event.ok,
      reason: event.reason || null,
    };
    audit.push(entry);
    writeAuditLine({ ...entry, at: new Date(nowMs()).toISOString() });
  }

  function requireRef(reference, action) {
    const parsed = parseReference(reference);
    if (!parsed.ok) {
      // THE TEXT STAYS OUT OF THE LINE. This audit is on disk now, and what failed to parse as a reference
      // may be a value pasted into the wrong place.
      log({ action, ok: false, reason: parsed.reason });
      throw new Error("credential-vault: " + parsed.reason);
    }
    return parsed.ref;
  }

  function refFields(ref) {
    return { reference: ref.reference, project: ref.project, environment: ref.environment, provider: ref.provider, risk: ref.risk };
  }

  function declaredReach(ref) {
    const record = metadata.get(ref.reference);
    return record ? record.reach || null : null;
  }

  /** Who is asking, by the brand and nothing else: a string, a copy and a stale run are all no one. */
  function liveRequester(requester) {
    const state = requesterState(requester);
    return state !== null && state.expiresAtMs > nowMs() ? state : null;
  }

  function requireRequester(requester, ref, action) {
    const state = liveRequester(requester);
    if (state === null) {
      log({ action, ...refFields(ref), ok: false, reason: "requester-not-kernel-minted" });
      throw refusal("REQUESTER_REQUIRED", "credential-vault: REQUESTER REQUIRED — only a live kernel-issued run handle may ask");
    }
    return state;
  }

  /** The terminal in front of this process, and nothing a line says: `via` is a label, and a handle travels. */
  function atConsole(requester) {
    const state = liveRequester(requester);
    return state !== null && state.atConsole === true;
  }

  function requesterFields(requester) {
    return { requester: requester.runHandle, tenant: requester.tenant };
  }

  /**
   * Is this reference the requester's? Two questions, each able to refuse alone.
   *
   * A TENANT-CLASS CREDENTIAL HAS NO PROJECT, so a second project in the same tenant is exactly who it is
   * for, and the tenant rule is the only thing deciding. A project-class credential answers both: the
   * tenant is read from the committed registry the requester was minted against, so it still holds with
   * the project check gone. Returns `null`, or a code and a reason.
   */
  function boundaryRefusal(ref, requester, state) {
    if (ref.credentialClass === "tenant") {
      return ref.tenantId === requester.tenant ? null : { code: "TENANT_MISMATCH", reason: "cross-tenant-refused" };
    }
    if (!belongsToProject(ref, requester.project)) return { code: "CROSS_PROJECT_REFUSED", reason: "cross-project-refused" };
    const entry = state.entries.get(ref.project);
    if (entry === undefined) return { code: "TENANT_UNKNOWN", reason: "tenant-unknown" };
    return entry.tenant === requester.tenant ? null : { code: "TENANT_MISMATCH", reason: "cross-tenant-refused" };
  }

  const BOUNDARY_MESSAGE = {
    CROSS_PROJECT_REFUSED: "credential-vault: reference belongs to another project — refused",
    TENANT_MISMATCH: "credential-vault: reference belongs to another tenant — refused",
    TENANT_UNKNOWN: "credential-vault: reference names a project no tenant holds — refused",
  };

  /** A platform credential is touched from a console, or not at all: a run names no owner of it. */
  function requireMutator(input, action) {
    const { requester } = input || {};
    const ref = requireRef((input || {}).reference, action);
    const state = requireRequester(requester, ref, action);
    if (ref.credentialClass === "platform") {
      if (!atConsole(requester)) {
        log({ action, ...refFields(ref), ...requesterFields(requester), ok: false, reason: "platform-credential-console-only" });
        throw refusal("PLATFORM_CONSOLE_ONLY", "credential-vault: a platform credential is changed only from a console");
      }
      return ref;
    }
    const refused = boundaryRefusal(ref, requester, state);
    if (refused !== null) {
      log({ action, ...refFields(ref), ...requesterFields(requester), ok: false, reason: refused.reason });
      throw refusal(refused.code, BOUNDARY_MESSAGE[refused.code]);
    }
    return ref;
  }

  /** A run must not lower what its own credential says it reaches, or the reach rule is its own to lift. */
  function requireConsoleForReach(input, ref, action) {
    if (input.reach === undefined && input.reachTenants === undefined) return;
    if (!atConsole(input.requester)) {
      log({ action, ...refFields(ref), ...requesterFields(input.requester), ok: false, reason: "reach-declared-from-a-run" });
      throw refusal("REACH_CONSOLE_ONLY", "credential-vault: a credential's reach is declared only from a console");
    }
  }

  /**
   * Provision or replace a credential. `readValue` is a zero-argument callback supplied by the caller
   * (the CLI's hidden-input reader) — the value is never a parameter of this function's caller chain,
   * so it cannot be captured from a command line, a history file or a stack trace of the request.
   */
  function provision(input) {
    const { readValue } = input || {};
    const replace = (input || {}).replace === true;
    const ref = requireMutator(input, "provision");
    requireConsoleForReach(input, ref, "provision");
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
    // THE INTENT IS ON DISK BEFORE THE STORE CHANGES. An effect with no line is the one thing R4 forbids.
    log({ action: "provision-intent", ...refFields(ref), ...requesterFields(input.requester), ok: true });
    const reachBefore = declaredReach(ref);
    store.set(ref.reference, value);
    const record = metadata.recordProvision(ref.reference, value, { note: input.note, expiresAt: input.expiresAt, reach: input.reach, reachTenants: input.reachTenants });
    log({ action: replace ? "replace" : "provision", ...refFields(ref), ...requesterFields(input.requester), fingerprint: record.fingerprint, reachBefore, reachAfter: record.reach, ok: true });
    return { reference: ref.reference, fingerprint: record.fingerprint, risk: ref.risk, replaced: already };
  }

  function remove(input) {
    const ref = requireMutator(input, "delete");
    log({ action: "delete-intent", ...refFields(ref), ...requesterFields(input.requester), ok: true });
    const deleted = store.del(ref.reference);
    metadata.remove(ref.reference);
    log({ action: "delete", ...refFields(ref), ...requesterFields(input.requester), ok: deleted, reason: deleted ? null : "not-found" });
    return deleted;
  }

  /** Presence test. Returns a boolean and nothing else — never an oracle on the value. */
  function present(input) {
    const ref = requireMutator(input, "present");
    const exists = store.exists(ref.reference);
    log({ action: "present", ...refFields(ref), ...requesterFields(input.requester), ok: true });
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
        reach: record.reach || null,
        reachTenants: record.reachTenants || null,
        expired: metadata.isExpired(record),
        managed: true,
      });
    }
    return [...byReference.values()].sort((a, b) => a.reference.localeCompare(b.reference));
  }

  function rotateMetadata(input) {
    const ref = requireMutator(input, "rotate-metadata");
    requireConsoleForReach(input, ref, "rotate-metadata");
    const reachBefore = declaredReach(ref);
    const record = metadata.recordRotationMetadata(ref.reference, { expiresAt: input.expiresAt, note: input.note, reach: input.reach, reachTenants: input.reachTenants });
    log({ action: "rotate-metadata", ...refFields(ref), ...requesterFields(input.requester), fingerprint: record.fingerprint, reachBefore, reachAfter: record.reach, ok: true });
    return record;
  }

  /**
   * Is this requester who this project's work may be? For the session router, ahead of any lease, so a
   * profile with no credentials is held to it too. `null`, or the code to refuse with.
   */
  function requesterRefusalFor(requester, projectId) {
    const state = liveRequester(requester);
    if (state === null) return "REQUESTER_REQUIRED";
    if (requester.project !== projectId) return "CROSS_PROJECT_REFUSED";
    const entry = state.entries.get(projectId);
    if (entry === undefined) return "TENANT_UNKNOWN";
    return entry.tenant === requester.tenant ? null : "TENANT_MISMATCH";
  }

  /**
   * Why this credential may not be auto-loaded for this requester, or `null`. The one judgement, asked by
   * the router before it takes a lease and again here at the chokepoint. It touches no store.
   */
  function sessionRefusal(ref, requester, state) {
    if (ref.credentialClass === "platform") return { code: "PLATFORM_RELEASED_TO_NONE", reason: "platform-credential-released-to-none", message: "credential-vault: a platform credential is released to nobody; it serves every tenant through the broker" };
    if (ref.credentialClass === "tenant") return { code: "TENANT_CLASS_NOT_SESSION", reason: "tenant-class-not-session-released", message: "credential-vault: a tenant-class credential is never loaded into a session" };
    const refused = boundaryRefusal(ref, requester, state);
    if (refused !== null) return { ...refused, message: BOUNDARY_MESSAGE[refused.code] };
    if (ref.risk !== "session") return { code: "OPERATION_CLASS", reason: "operation-class-credential", message: "credential-vault: this credential is operation-class and cannot be loaded into a session" };
    if (requester.via === "linked-worktree") return { code: "LINKED_WORKTREE_ALONE", reason: "linked-worktree-alone-releases-nothing", message: "credential-vault: a linked worktree's binding alone releases nothing, and session auto-load has no owner step" };
    return null;
  }

  /**
   * Is this credential fit to go out at all, on either path? Asked of a credential that exists: a missing
   * one is CREDENTIAL MISSING, not an undeclared one.
   *
   * EXPIRED OR UNDECLARED IS REFUSED. Supabase token scope was never confirmed live, and "probably one
   * project" is how a wide token reaches another tenant's data. A name known to be account-wide is account
   * reach whatever its record says. AUTO-LOAD TAKES PROJECT REACH ONLY, because it has no owner step: a
   * tenant-reach token under a project's name would be a tenant credential sidestepping the class rule. An
   * operation has a grant, and may take a wider reach while it stays inside the requester's tenant.
   */
  function fitnessRefusal(ref, requester, path) {
    const record = metadata.get(ref.reference);
    if (record && metadata.isExpired(record, new Date(nowMs()).toISOString())) return { code: "CREDENTIAL_EXPIRED", reason: "credential-expired", message: "credential-vault: this credential has passed its recorded expiry" };
    const declared = record ? record.reach : null;
    if (!REACHES.includes(declared)) return { code: "REACH_UNDECLARED", reason: "reach-undeclared", message: "credential-vault: this credential declares no reach, so it is not released" };
    const accountWide = isAccountWide(ref.credential) || declared === "account";
    if (path === "session") {
      return declared === "project" && !accountWide ? null : { code: "REACH_WIDER_THAN_PROJECT", reason: "reach-wider-than-project", message: "credential-vault: this credential reaches beyond its project, so it is not projected into a session" };
    }
    const tenants = declared === "account" ? record.reachTenants : null;
    if (accountWide && (!Array.isArray(tenants) || tenants.length === 0 || tenants.some((tenant) => tenant !== requester.tenant))) {
      return { code: "REACH_CROSSES_TENANTS", reason: "account-wide-reach-crosses-tenants", message: "credential-vault: this credential reaches another tenant, so it is not released" };
    }
    return null;
  }

  /** The router's question, recorded when refused. Metadata only: no store is read and no grant minted. */
  function sessionReleaseRefusal(input) {
    const { requester } = input || {};
    const ref = requireRef((input || {}).reference, "authorise-session");
    const state = requireRequester(requester, ref, "authorise-session");
    const refused = sessionRefusal(ref, requester, state) || fitnessRefusal(ref, requester, "session");
    if (refused === null) return null;
    refuseRelease(ref, requester, "authorise-session", refused.reason, refused.code);
    return refused.code;
  }

  /** A refused release, on both records. A refusal that cannot be recorded stops by name, in `log` or here. */
  function refuseRelease(ref, requester, action, reason, code) {
    log({ action, ...refFields(ref), ...requesterFields(requester), ok: false, reason });
    const line = { outcome: "refused", rule: code, reasons: [reason], intent: action + ":" + reason, grantSource: null };
    if (!requesterState(requester).authority.recordRelease(requester, ref, line)) {
      throw refusal("REFUSAL_NOT_RECORDED", "credential-vault: this refusal has no envelope line, and the operation is stopped. " + RECORD_LOCK_HINT);
    }
  }

  /** The line a release needs before it may exist. R4: an unrecorded admission did not happen. */
  function recordReleaseAdmission(ref, requester, state, intent, grantSource) {
    if (!state.authority.recordRelease(requester, ref, { outcome: "allowed", rule: null, reasons: [], intent, grantSource })) {
      log({ action: "credential-release", ...refFields(ref), ...requesterFields(requester), ok: false, reason: "envelope-not-recorded" });
      throw refusal("ENVELOPE_NOT_RECORDED", "credential-vault: the release could not be recorded, so it did not happen. " + RECORD_LOCK_HINT);
    }
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
   *
   * SESSION AUTO-LOAD HAS NO OWNER STEP (the lead's decision, for the owner to overrule). So it is kept for
   * a PROJECT-class credential, for its own project in its own tenant, and each one is recorded through an
   * envelope. It never releases a tenant-class or platform-class credential.
   */
  function authoriseSessionRelease(input) {
    const { requester, sessionId } = input || {};
    const ref = requireRef((input || {}).reference, "authorise-session");
    const state = requireRequester(requester, ref, "authorise-session");
    const refused = sessionRefusal(ref, requester, state);
    if (refused !== null) {
      refuseRelease(ref, requester, "authorise-session", refused.reason, refused.code);
      throw refusal(refused.code, refused.message);
    }
    if (!store.exists(ref.reference)) {
      log({ action: "authorise-session", ...refFields(ref), ...requesterFields(requester), ok: false, reason: "credential-missing" });
      throw refusal("CREDENTIAL MISSING", "CREDENTIAL MISSING");
    }
    const unfit = fitnessRefusal(ref, requester, "session");
    if (unfit !== null) {
      refuseRelease(ref, requester, "authorise-session", unfit.reason, unfit.code);
      throw refusal(unfit.code, unfit.message);
    }
    const id = typeof sessionId === "string" ? sessionId : null;
    recordReleaseAdmission(ref, requester, state, "session:" + String(id), "session-auto-load");
    const grant = mintGrant(ref, "session", { sessionId: id });
    log({ action: "authorise-session", ...refFields(ref), ...requesterFields(requester), grantId: grant.grantId, sessionId: id, ok: true });
    return grant;
  }

  /**
   * Authorise a credential for ONE command. Requires a permit whose project, environment, reference and run
   * all match, and a committed, receipted `credential-release` grant naming this exact command. `ownerConfirmation` is a flag the flow above sets
   * after its terminal check. Any in-process caller could set it, so it prevents accidents and proves no one.
   *
   * THE REQUESTER IS NOT THE REFERENCE. This route used to be handed `projectId: ref.project`, so the check
   * below compared a reference with itself and anything holding a permit passed it. It asks who is asking
   * now, and a platform credential is released to nobody, whoever that is.
   */
  function authoriseOperationRelease(input) {
    const { requester, permit, command } = input || {};
    const capability = (input || {}).capability || {};
    const ref = requireRef((input || {}).reference, "authorise-operation");
    const state = requireRequester(requester, ref, "authorise-operation");
    if (ref.credentialClass === "platform") {
      refuseRelease(ref, requester, "authorise-operation", "platform-credential-released-to-none", "PLATFORM_RELEASED_TO_NONE");
      throw refusal("PLATFORM_RELEASED_TO_NONE", "credential-vault: a platform credential is released to nobody; it serves every tenant through the broker");
    }
    const outside = boundaryRefusal(ref, requester, state);
    if (outside !== null) {
      refuseRelease(ref, requester, "authorise-operation", outside.reason, outside.code);
      throw refusal(outside.code, BOUNDARY_MESSAGE[outside.code]);
    }
    if (capability.ownerConfirmation !== true) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "owner-confirmation-required" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    if (!permit || typeof permit !== "object") {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "permit-required" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    if (permit.reference !== ref.reference || permit.projectId !== ref.project || permit.environment !== ref.environment || permit.runHandle !== requester.runHandle) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "permit-binding-mismatch" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    if (typeof permit.expiresAtMs === "number" && permit.expiresAtMs <= nowMs()) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "permit-expired" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    // THE P5 GRANT, whichever route the requester came by. A linked worktree's binding, a tenant receipt and
    // a gatekeeper `secrets-handling` gate are not this and cannot stand in for it.
    const ungranted = state.authority.operationGrantRefusal(requester, ref, permit, command);
    if (ungranted !== null) {
      refuseRelease(ref, requester, "authorise-operation", ungranted, "CREDENTIAL_GRANT_REQUIRED");
      throw refusal("CREDENTIAL_GRANT_REQUIRED", "credential-vault: " + ungranted);
    }
    if (!store.exists(ref.reference)) {
      log({ action: "authorise-operation", ...refFields(ref), ok: false, reason: "credential-missing" });
      throw refusal("CREDENTIAL MISSING", "CREDENTIAL MISSING");
    }
    const unfit = fitnessRefusal(ref, requester, "operation");
    if (unfit !== null) {
      refuseRelease(ref, requester, "authorise-operation", unfit.reason, unfit.code);
      throw refusal(unfit.code, unfit.message);
    }
    const permitId = typeof permit.permitId === "string" ? permit.permitId : null;
    recordReleaseAdmission(ref, requester, state, "operation:" + String(permitId), "credential-release:" + permit.phaseId);
    const grant = mintGrant(ref, "operation", { permitId });
    log({ action: "authorise-operation", ...refFields(ref), ...requesterFields(requester), grantId: grant.grantId, ok: true });
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
    log({ action, reference: grant.reference, project: grant.project, environment: grant.environment, provider: grant.provider, risk: grant.risk, grantId: grant.grantId, sessionId: grant.sessionId, fingerprint: fingerprint(value), ok: true });
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

  /** A command's start and end, on the same durable line. A start that cannot be written stops it. */
  function auditOperation(event) {
    log(event);
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
    auditPath,
    redactText: (t) => redactor.redactText(t),
    redactObject: (o) => redactor.redactObject(o),
    provision,
    remove,
    present,
    status,
    rotateMetadata,
    requesterRefusalFor,
    sessionReleaseRefusal,
    authoriseSessionRelease,
    authoriseOperationRelease,
    useValue,
    releaseIntoChildEnvironment,
    auditOperation,
    getAuditLog,
    assertNoValueInAudit,
  };
}

module.exports = { createCredentialVault, GRANT_TTL_MS, AUDIT_FILE_NAME };
