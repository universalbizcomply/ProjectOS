"use strict";
/**
 * In-process credential store — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L2, test/dry-run only).
 *
 * Implements the same contract as the Windows Credential Manager adapter so validators can prove the
 * vault's policy behaviour deterministically, with no machine state and no PowerShell dependency.
 *
 * It is NOT a second credential system: it holds values in a closure Map for the life of one process,
 * has no persistence, and refuses to be used unless the caller opts in explicitly with
 * `{ acknowledgedNonPersistent: true }` — so it can never be selected by accident where a real
 * protected store was intended.
 */

const { parseReference, ROOT } = require("./reference.cjs");

function createMemoryCredentialStore(opts) {
  const options = opts || {};
  if (options.acknowledgedNonPersistent !== true) {
    throw new Error(
      "memory-credential-store: refusing to create a non-persistent, unprotected store without an explicit acknowledgement"
    );
  }
  const values = new Map();

  function assertReference(reference) {
    const parsed = parseReference(reference);
    if (!parsed.ok) throw new Error("memory-credential-store: " + parsed.reason);
    return parsed.ref;
  }

  function set(reference, value) {
    assertReference(reference);
    if (typeof value !== "string" || !value) throw new Error("memory-credential-store: value required");
    values.set(reference, value);
    return true;
  }

  function get(reference) {
    assertReference(reference);
    return values.has(reference) ? values.get(reference) : null;
  }

  function exists(reference) {
    assertReference(reference);
    return values.has(reference);
  }

  function del(reference) {
    assertReference(reference);
    return values.delete(reference);
  }

  function list(prefix) {
    const p = typeof prefix === "string" && prefix ? prefix : ROOT;
    // Prefix must end on a segment boundary so `.../proj` cannot match `.../project-two`.
    const boundary = p.endsWith("/") ? p : p + "/";
    return [...values.keys()].filter((ref) => ref === p || ref.startsWith(boundary)).sort();
  }

  return { name: "memory (non-persistent)", set, get, exists, del, list };
}

module.exports = { createMemoryCredentialStore };
