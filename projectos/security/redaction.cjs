"use strict";
/**
 * Secret redaction — scrubs known secret values out of any text/object before it can reach a log,
 * report, prompt, or the audit trail. Reference-based: callers register (value -> label) and every
 * subsequent serialization replaces the raw value with an opaque placeholder «secret:LABEL».
 *
 * Design constraints (PROJECTOS-V3-LOCAL-SECRET-BROKER1A):
 *  - Never persists secret values; the registry lives only in the closure of one redactor instance.
 *  - Fail-safe over-inclusion: redact every occurrence; never partially reveal.
 *  - Ignores trivially short values (< MIN_LEN) so common words are not blanket-redacted.
 *  - Zero dependencies (Node built-ins only).
 *
 * Limitation (documented, accepted for local synthetic use): redaction is exact-string on the
 * registered UTF-8 value. A transformed/re-encoded copy (e.g. base64, URL-encoded) of the same secret
 * is NOT recognised. Buffers are redacted via their UTF-8 form only. Consumers must redact before
 * transforming, not after.
 */

const MIN_LEN = 4;
const PLACEHOLDER = (label) => "«secret:" + label + "»";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createRedactor() {
  // label -> { value, re }. Longer values first at redaction time so overlapping secrets fully scrub.
  const registry = new Map();

  function register(value, label) {
    if (typeof value !== "string") throw new Error("redactor.register: value must be a string");
    if (typeof label !== "string" || !label) throw new Error("redactor.register: label required");
    if (value.length < MIN_LEN) return false; // too short to safely target
    registry.set(label, { value, re: new RegExp(escapeRegExp(value), "g") });
    return true;
  }

  function ordered() {
    // Sort by value length desc so a secret that is a substring of another is handled after the longer one.
    return [...registry.entries()].sort((a, b) => b[1].value.length - a[1].value.length);
  }

  function redactText(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const [label, { re }] of ordered()) out = out.replace(re, PLACEHOLDER(label));
    return out;
  }

  function redactObject(obj, seen) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") return redactText(obj);
    if (typeof obj !== "object") return obj;
    if (Buffer.isBuffer(obj)) return redactText(obj.toString("utf8"));
    const visited = seen || new WeakSet();
    if (visited.has(obj)) return "[Circular]"; // cycle guard — never recurse forever
    visited.add(obj);
    if (Array.isArray(obj)) return obj.map((v) => redactObject(v, visited));
    // Object.create(null) so a literal own "__proto__" key becomes a normal data property instead of
    // invoking the prototype accessor (which would drop the redacted value or repoint the prototype).
    const out = Object.create(null);
    for (const k of Object.keys(obj)) {
      out[k] = redactObject(obj[k], visited);
    }
    return out;
  }

  /** True if `text` still contains any registered raw secret value (used as a leak assertion). */
  function containsSecret(text) {
    const hay = typeof text === "string" ? text : JSON.stringify(text);
    for (const [, { value }] of registry) if (hay.includes(value)) return true;
    return false;
  }

  function size() { return registry.size; }

  return { register, redactText, redactObject, containsSecret, size };
}

module.exports = { createRedactor, MIN_LEN };
