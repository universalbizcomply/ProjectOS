"use strict";
/**
 * Secret Operation Broker — PROJECTOS-V3-SECRET-OPERATION-BROKER1A.
 *
 * Builds on the Local Secret Broker (broker.cjs). Its job is to let ProjectOS *use* a secret to
 * perform an operation (sign, fingerprint, verify, authenticate against a synthetic endpoint stub)
 * WITHOUT ever handing the raw secret to the caller. The plaintext is materialised only inside the
 * operation closure via `secretBroker.use(...)`, the operation must return a NON-secret result, and
 * every result is leak-scanned before it is returned.
 *
 * Guarantees (all fail-closed):
 *  - Allowlist: only registered operations may run; an unknown operation name is refused.
 *  - Owner gate: operations flagged `sensitive` require an owner-confirmation capability, independent
 *    of (and in addition to) the underlying secret's own high-sensitivity gate.
 *  - Binding: the underlying secret's (projectId, environment) binding is enforced by broker.use.
 *  - No-leak: the operation's return value must be plain-JSON-safe (no functions, Buffers, Maps/Sets,
 *    Promises, getters, non-enumerable props, symbols, bigint) — anything that could smuggle the secret
 *    past a text scan is refused. The value is then scanned with the broker's redactor for the verbatim
 *    secret; on any leak the result is DISCARDED and the call throws. The caller receives the value
 *    re-derived from the exact scanned text, so what is returned is provably what was scanned.
 *  - Audit: metadata-only outcome events (operation, secretRef, project, environment, ok, reason).
 *
 * No network I/O and no disk I/O. Operations are synchronous, synthetic, in-process functions only.
 *
 * Trust-boundary assumptions (documented, not enforced here):
 *  - `capability.ownerConfirmation` is a self-asserted boolean; a trusted UI/flow above this module must
 *    be the only thing that sets it. Arbitrary automation must never plumb it through from its input.
 *  - `registerOperation` is an open API; a registered `run` is trusted, code-reviewed code. The verbatim
 *    no-leak scan does NOT catch a `run` that re-encodes the secret (base64/hex/reversed/etc.) before
 *    returning it — encoded exfiltration by a hostile `run` is out of scope. Keep operations minimal and
 *    reviewed; prefer the vetted STANDARD_OPERATIONS.
 */

const crypto = require("crypto");

/**
 * Reject any result that is not plain-JSON-safe. This is what makes the text-based no-leak scan sound:
 * a value that survives this check cannot carry the secret in a JSON-stringify-invisible channel
 * (Buffer bytes, a closure, a Map/Set, a non-enumerable property, a getter, a toJSON facade, a symbol).
 */
function assertPlainJsonSafe(v, path) {
  const t = typeof v;
  if (v === null || t === "string" || t === "number" || t === "boolean") return;
  if (t === "function" || t === "symbol" || t === "bigint" || t === "undefined") {
    throw new Error("operation-broker: result carries a non-JSON value at " + path);
  }
  if (v && typeof v.then === "function") throw new Error("operation-broker: async/thenable result not allowed");
  if (Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof Map || v instanceof Set || v instanceof Date) {
    throw new Error("operation-broker: result carries a disallowed built-in at " + path);
  }
  if (Array.isArray(v)) { v.forEach((x, i) => assertPlainJsonSafe(x, path + "[" + i + "]")); return; }
  if (Object.getPrototypeOf(v) !== Object.prototype) {
    throw new Error("operation-broker: result must be a plain object at " + path);
  }
  for (const k of Reflect.ownKeys(v)) {
    if (typeof k === "symbol") throw new Error("operation-broker: symbol keys not allowed at " + path);
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d.enumerable || typeof d.get === "function" || typeof d.set === "function") {
      throw new Error("operation-broker: non-plain property '" + k + "' at " + path);
    }
    assertPlainJsonSafe(v[k], path + "." + k);
  }
}

function createOperationBroker(opts) {
  const options = opts || {};
  const secretBroker = options.secretBroker;
  if (!secretBroker || typeof secretBroker.use !== "function" || typeof secretBroker.redactText !== "function") {
    throw new Error("operation-broker: a secret broker instance is required");
  }
  const actor = typeof options.actor === "string" && options.actor ? options.actor : "operator";

  const operations = new Map(); // name -> { name, sensitive, run }
  const audit = [];

  // Single options object so same-typed fields (secretRef/projectId/environment) can't be transposed.
  function logOp(e) {
    audit.push({
      operation: e.operation || null,
      secretRef: e.secretRef || null,
      projectId: e.projectId || null,
      environment: e.environment || null,
      actor,
      ok: !!e.ok,
      reason: e.reason || null
    });
  }

  function registerOperation(op) {
    if (!op || typeof op.name !== "string" || !op.name) throw new Error("operation-broker.register: name required");
    if (typeof op.run !== "function") throw new Error("operation-broker.register: run(value, params) required");
    if (op.run.constructor && op.run.constructor.name === "AsyncFunction") {
      throw new Error("operation-broker.register: run must be synchronous (async operations not allowed)");
    }
    if (operations.has(op.name)) throw new Error("operation-broker.register: operation already registered: " + op.name);
    operations.set(op.name, { name: op.name, sensitive: op.sensitive === true, run: op.run });
    return true;
  }

  /**
   * Validate a result is plain-JSON-safe, scan its exact text for the verbatim secret, and return a
   * value re-derived from that scanned text (so the caller cannot receive anything the scan did not
   * see). Throws on a disallowed shape or a detected leak. `undefined` means "no value".
   */
  function sanitizeResult(result) {
    if (result === undefined) return undefined;
    assertPlainJsonSafe(result, "result");
    const serialized = JSON.stringify(result);
    if (secretBroker.redactText(serialized) !== serialized) {
      throw new Error("operation-broker: result contained the secret");
    }
    return JSON.parse(serialized);
  }

  function execute(input) {
    const { operationName, secretRef, projectId, environment } = input || {};
    const params = (input && input.params) || {};
    const capability = (input && input.capability) || {};

    const base = { operation: operationName, secretRef, projectId, environment };
    const op = operations.get(operationName);
    if (!op) {
      logOp({ ...base, ok: false, reason: "unknown-operation" });
      throw new Error("operation-broker: operation not allowed");
    }
    if (op.sensitive && capability.ownerConfirmation !== true) {
      logOp({ ...base, ok: false, reason: "owner-confirmation-required" });
      throw new Error("operation-broker: owner confirmation required for this operation");
    }

    let rawResult;
    try {
      // Secret is materialised ONLY inside this closure; it is never returned or logged.
      rawResult = secretBroker.use({ ref: secretRef, projectId, environment, capability }, (value) => op.run(value, params));
    } catch (e) {
      logOp({ ...base, ok: false, reason: "secret-unavailable-or-op-error" });
      throw new Error("operation-broker: operation could not run — nothing released");
    }

    let safeResult;
    try {
      // Reject unscannable shapes and any verbatim secret; return only what was actually scanned.
      safeResult = sanitizeResult(rawResult);
    } catch (e) {
      logOp({ ...base, ok: false, reason: "result-leak-blocked" });
      throw new Error("operation-broker: operation result withheld — it was unsafe or contained the secret");
    }

    logOp({ ...base, ok: true });
    return { ok: true, operation: operationName, result: safeResult };
  }

  function listOperations() {
    return [...operations.values()].map((o) => ({ name: o.name, sensitive: o.sensitive }));
  }

  function getAuditLog() {
    return audit.map((e) => ({ ...e }));
  }

  return { registerOperation, execute, listOperations, getAuditLog };
}

/**
 * Synthetic, in-process reference operations. Each takes the secret plus non-secret params and returns
 * a NON-secret result (a digest, a fingerprint, or a boolean). None reveal or return the secret.
 */
const STANDARD_OPERATIONS = [
  {
    name: "hmac-sign",
    sensitive: false,
    // Sign a caller-supplied message with the secret as an HMAC key. Returns a hex digest.
    run(secret, params) {
      const message = typeof params.message === "string" ? params.message : "";
      return crypto.createHmac("sha256", secret).update(message).digest("hex");
    }
  },
  {
    name: "fingerprint",
    sensitive: false,
    // A non-reversible short fingerprint of the secret, safe to display for identification.
    run(secret) {
      return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16);
    }
  },
  {
    name: "verify-candidate",
    sensitive: true,
    // Constant-time comparison of a caller-supplied candidate against the secret. Comparing fixed-length
    // HMACs (keyed by a per-call random nonce) avoids leaking the secret's byte length via timing while
    // still yielding a correct equality result. Returns a boolean.
    run(secret, params) {
      const candidate = typeof params.candidate === "string" ? params.candidate : "";
      const nonce = crypto.randomBytes(32);
      const a = crypto.createHmac("sha256", nonce).update(secret, "utf8").digest();
      const b = crypto.createHmac("sha256", nonce).update(candidate, "utf8").digest();
      return crypto.timingSafeEqual(a, b);
    }
  }
];

module.exports = { createOperationBroker, STANDARD_OPERATIONS };
