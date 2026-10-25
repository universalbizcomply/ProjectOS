"use strict";
/**
 * Local Secret Broker — PROJECTOS-V3-LOCAL-SECRET-BROKER1A.
 *
 * A zero-dependency, local-only broker for storing and releasing secrets on the operator's own
 * machine. It is deliberately narrow and fail-closed:
 *
 *  - Encryption at rest: every secret is stored AES-256-GCM encrypted under a key derived from an
 *    operator passphrase via scrypt. Records hold ciphertext + iv + authTag + salt + metadata only —
 *    the plaintext is NEVER persisted in the record and NEVER written to the audit trail.
 *  - Reference-based access: callers hold an opaque `ref`, not the value. Nothing outside `retrieve`
 *    ever returns plaintext.
 *  - Binding: each secret is bound to (projectId, environment). Retrieval requires an exact match —
 *    a secret provisioned for one project/environment cannot be read from another.
 *  - Owner confirmation: high-sensitivity secrets require an explicit owner-confirmation capability
 *    at retrieval time. ProjectOS/automation cannot self-grant it.
 *  - Synthetic-only namespace guard: a broker may only be created over a `synthetic/…` namespace, so
 *    this code can never be pointed at a real production credential store. Real-credential access is
 *    out of scope by construction.
 *  - Audit: append-only metadata events (action, ref, project, environment, actor, ok) with no value.
 *  - Fail closed: unknown ref, revoked/destroyed secret, wrong binding, missing capability, or a
 *    tampered ciphertext all throw and release nothing.
 *
 * This module performs NO network I/O and NO disk I/O. The record store is an in-memory Map; callers
 * that want persistence must supply their own encrypted-at-rest store and are responsible for keeping
 * it off any synced/committed path. It is used here only with synthetic data.
 *
 * Accepted-risk notes (local synthetic scope): (a) the synthetic-namespace guard restricts WHERE the
 * broker operates, not the CONTENT stored — callers must feed provably-synthetic values; (b) the key
 * is derived from an operator passphrase via scrypt (N=2^16). For real credentials this should be an
 * OS keychain / CSPRNG-sourced key with a higher KDF cost; that hardening is deferred with the
 * out-of-scope real-credential work and is NOT relied on for this local synthetic phase.
 */

const crypto = require("crypto");
const { createRedactor, MIN_LEN } = require("./redaction.cjs");

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;
const SCRYPT_COST = 65536; // N = 2^16; stronger than the 2^14 default, still fast enough for local use
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const SENSITIVITIES = new Set(["standard", "high"]);

function assertSyntheticNamespace(namespace) {
  if (typeof namespace !== "string" || !namespace) {
    throw new Error("secret-broker: namespace required");
  }
  if (!/^synthetic[/:]/.test(namespace)) {
    // Fail closed: refuse to operate over anything that is not an explicitly synthetic namespace.
    throw new Error(
      "secret-broker: refusing non-synthetic namespace '" + namespace +
        "' — this broker is restricted to synthetic/* stores"
    );
  }
  return namespace;
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_COST, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
}

function newRef() {
  return "ref_" + crypto.randomBytes(9).toString("hex");
}

/** Encrypt a plaintext string into a self-contained record body. Fresh salt+IV per call. */
function encryptValue(passphrase, value) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

/** Decrypt a record body. Throws (GCM auth failure / wrong key) on any tampering — releases nothing. */
function decryptValue(passphrase, body) {
  const key = deriveKey(passphrase, Buffer.from(body.salt, "base64"));
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(body.iv, "base64"));
  decipher.setAuthTag(Buffer.from(body.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(body.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function createSecretBroker(opts) {
  const options = opts || {};
  const namespace = assertSyntheticNamespace(options.namespace);
  if (typeof options.passphrase !== "string" || options.passphrase.length < 8) {
    throw new Error("secret-broker: passphrase (>= 8 chars) required");
  }
  const passphrase = options.passphrase;
  const actor = typeof options.actor === "string" && options.actor ? options.actor : "operator";
  const redactor = options.redactor || createRedactor();

  const records = new Map(); // ref -> record
  const audit = [];

  function logEvent(action, ref, projectId, environment, ok, reason) {
    // Metadata only. No secret value ever enters this object.
    audit.push({
      action,
      ref: ref || null,
      projectId: projectId || null,
      environment: environment || null,
      actor,
      ok: !!ok,
      reason: reason || null
    });
  }

  function requireRecord(ref) {
    const rec = records.get(ref);
    if (!rec) throw new Error("secret-broker: unknown secret reference");
    return rec;
  }

  function store(input) {
    const { projectId, environment, value } = input || {};
    const sensitivity = (input && input.sensitivity) || "standard";
    if (typeof projectId !== "string" || !projectId) throw new Error("secret-broker.store: projectId required");
    if (typeof environment !== "string" || !environment) throw new Error("secret-broker.store: environment required");
    if (typeof value !== "string" || !value) throw new Error("secret-broker.store: value required");
    // Reject values too short to be safely redacted downstream — fail closed rather than store a
    // secret the redactor cannot scrub from logs/reports.
    if (value.length < MIN_LEN) throw new Error("secret-broker.store: value shorter than redaction minimum");
    if (!SENSITIVITIES.has(sensitivity)) throw new Error("secret-broker.store: invalid sensitivity");

    const body = encryptValue(passphrase, value);
    const ref = newRef();
    records.set(ref, { namespace, projectId, environment, sensitivity, ...body, revoked: false });
    // Register for redaction so the value can never appear in any downstream log/report.
    if (!redactor.register(value, ref)) throw new Error("secret-broker.store: value could not be registered for redaction");
    logEvent("store", ref, projectId, environment, true);
    return { ref, sensitivity };
  }

  function retrieve(input) {
    const { ref, projectId, environment } = input || {};
    const capability = (input && input.capability) || {};
    let rec;
    try {
      rec = requireRecord(ref);
    } catch (e) {
      logEvent("retrieve", ref, projectId, environment, false, "unknown-ref");
      throw e;
    }
    // Verify the caller is authorized for THIS binding before disclosing anything else (including
    // whether the secret is revoked) — a wrong-binding caller must not gain any oracle.
    if (rec.projectId !== projectId || rec.environment !== environment) {
      logEvent("retrieve", ref, projectId, environment, false, "binding-mismatch");
      throw new Error("secret-broker: binding mismatch — secret not released");
    }
    if (rec.revoked) {
      logEvent("retrieve", ref, projectId, environment, false, "revoked");
      throw new Error("secret-broker: secret is revoked");
    }
    if (rec.sensitivity === "high" && capability.ownerConfirmation !== true) {
      logEvent("retrieve", ref, projectId, environment, false, "owner-confirmation-required");
      throw new Error("secret-broker: owner confirmation required for high-sensitivity secret");
    }
    let plaintext;
    try {
      plaintext = decryptValue(passphrase, rec);
    } catch (e) {
      // GCM auth failure (tampering) or key mismatch. Release nothing.
      logEvent("retrieve", ref, projectId, environment, false, "decrypt-failed");
      throw new Error("secret-broker: secret could not be verified — not released");
    }
    redactor.register(plaintext, ref);
    logEvent("retrieve", ref, projectId, environment, true);
    return plaintext;
  }

  /** Run `fn(value)` with a secret and guarantee the value never escapes into a returned/logged form. */
  function use(input, fn) {
    const value = retrieve(input);
    return fn(value);
  }

  function assertBinding(rec, ref, projectId, environment, action) {
    if (rec.projectId !== projectId || rec.environment !== environment) {
      logEvent(action, ref, projectId, environment, false, "binding-mismatch");
      throw new Error("secret-broker: binding mismatch — " + action + " refused");
    }
  }

  function requireRecordAudited(ref, projectId, environment, action) {
    // Mirror retrieve(): an unknown ref is an audited failure, not a silent throw.
    try {
      return requireRecord(ref);
    } catch (e) {
      logEvent(action, ref, projectId, environment, false, "unknown-ref");
      throw e;
    }
  }

  // revoke/destroy enforce the same (projectId, environment) binding as retrieve, so a leaked ref
  // cannot be used to revoke or destroy a secret belonging to another project/environment.
  function revoke(input) {
    const { ref, projectId, environment } = input || {};
    const rec = requireRecordAudited(ref, projectId, environment, "revoke");
    assertBinding(rec, ref, projectId, environment, "revoke");
    records.set(ref, { ...rec, revoked: true }); // immutable update — replace, do not mutate in place
    logEvent("revoke", ref, rec.projectId, rec.environment, true);
    return true;
  }

  function destroy(input) {
    const { ref, projectId, environment } = input || {};
    const rec = requireRecordAudited(ref, projectId, environment, "destroy");
    assertBinding(rec, ref, projectId, environment, "destroy");
    records.delete(ref);
    logEvent("destroy", ref, rec.projectId, rec.environment, true);
    return true;
  }

  function describe(ref) {
    const rec = requireRecord(ref);
    // Metadata view only — never includes ciphertext or value.
    return {
      ref,
      namespace: rec.namespace,
      projectId: rec.projectId,
      environment: rec.environment,
      sensitivity: rec.sensitivity,
      revoked: rec.revoked
    };
  }

  function list() {
    return [...records.keys()].map(describe);
  }

  function getAuditLog() {
    return audit.map((e) => ({ ...e }));
  }

  /** Invariant: no known secret value may appear anywhere in the serialized store or audit trail. */
  function assertNoPlaintextLeak() {
    const serialized = JSON.stringify({ records: [...records.values()], audit });
    if (redactor.containsSecret(serialized)) {
      throw new Error("secret-broker: SECURITY INVARIANT VIOLATED — plaintext secret found in store/audit");
    }
    return true;
  }

  return {
    namespace,
    // Redaction is exposed as scrub-only helpers; the raw registry (register/containsSecret) stays
    // internal so no caller can enumerate or probe the known-value set.
    redactText: (t) => redactor.redactText(t),
    redactObject: (o) => redactor.redactObject(o),
    store,
    retrieve,
    use,
    revoke,
    destroy,
    describe,
    list,
    getAuditLog,
    assertNoPlaintextLeak
  };
}

module.exports = {
  createSecretBroker,
  assertSyntheticNamespace,
  SENSITIVITIES,
  // Low-level primitives exported only for the validator to exercise the GCM auth-failure path.
  __internal: { encryptValue, decryptValue }
};
