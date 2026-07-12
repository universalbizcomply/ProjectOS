"use strict";
/**
 * Owner Approval Queue — PROJECTOS-V3-APPROVAL-QUEUE1A.
 *
 * A deterministic, local store of owner-decision items produced by the governed chain — a
 * BLOCKED_AWAITING_OWNER launch spec, a bridge request marked requiresOwnerApproval, or a worker's
 * refused side effects. Each item starts `pending`. ONLY the owner can decide, and only with an explicit
 * owner-confirmation capability — ProjectOS/Claude cannot self-approve (fail closed). Deciding never
 * auto-grants PLAN READY; it merely records the owner's decision. Secrets are redacted; decisions are
 * recorded in an append-only, metadata-only audit.
 *
 * Zero dependencies beyond ProjectOS-local modules. No network, no disk, no spawning.
 */

const { createRedactor } = require("../security/redaction.cjs");

const ITEM_KINDS = new Set(["launch-approval", "side-effect", "plan-decision", "generic"]);
const DECISIONS = { approve: "approved", return: "returned", reject: "rejected" };

/** Recursively freeze so a caller holding a returned payload cannot rewrite the content under review. */
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

function createApprovalQueue(opts) {
  const options = opts || {};
  const redactor = options.redactor || createRedactor();
  const actor = typeof options.actor === "string" && options.actor ? options.actor : "owner";

  const items = new Map(); // id -> item
  const audit = [];
  let counter = 0;

  function logEvent(action, id, kind, decision, ok, reason) {
    audit.push({ action, id: id || null, kind: kind || null, decision: decision || null, actor, ok: !!ok, reason: reason || null });
  }

  function enqueue(input) {
    const { kind, summary } = input || {};
    if (!ITEM_KINDS.has(kind)) { logEvent("enqueue", null, kind, null, false, "unknown-kind"); throw new Error("approval-queue.enqueue: unknown item kind"); }
    if (typeof summary !== "string" || !summary) { logEvent("enqueue", null, kind, null, false, "missing-summary"); throw new Error("approval-queue.enqueue: summary required"); }
    counter += 1;
    const id = "apr_" + counter;
    const item = {
      id,
      kind,
      summary: redactor.redactText(summary),
      // Freeze once — the payload is fully redacted and internal-only at this point, so freezing it
      // prevents any holder of a returned reference from silently rewriting what the owner reviews.
      payload: deepFreeze(redactor.redactObject((input && input.payload) || {})),
      status: "pending",
      decision: null,
    };
    items.set(id, item);
    logEvent("enqueue", id, kind, null, true);
    return { ...item };
  }

  function decide(input) {
    const { id, decision } = input || {};
    const capability = (input && input.capability) || {};
    const item = items.get(id);
    if (!item) { logEvent("decide", id, null, decision, false, "unknown-item"); throw new Error("approval-queue: unknown item"); }
    if (!Object.prototype.hasOwnProperty.call(DECISIONS, decision)) {
      logEvent("decide", id, item.kind, decision, false, "invalid-decision");
      throw new Error("approval-queue: invalid decision");
    }
    // Authorization first (defense in depth): an unauthorised caller gets a uniform response regardless
    // of item state. Fail closed — only an explicit owner confirmation can move an item; automation
    // cannot self-approve.
    if (capability.ownerConfirmation !== true) {
      logEvent("decide", id, item.kind, decision, false, "owner-confirmation-required");
      throw new Error("approval-queue: owner confirmation required — ProjectOS cannot self-approve");
    }
    if (item.status !== "pending") {
      logEvent("decide", id, item.kind, decision, false, "already-decided");
      throw new Error("approval-queue: item already decided");
    }
    const next = { ...item, status: DECISIONS[decision], decision };
    items.set(id, next);
    logEvent("decide", id, item.kind, decision, true);
    return { ...next };
  }

  function get(id) {
    const item = items.get(id);
    return item ? { ...item } : null;
  }

  function list(status) {
    return [...items.values()]
      .filter((i) => (status ? i.status === status : true))
      .map((i) => ({ ...i }));
  }

  function pendingCount() {
    return [...items.values()].filter((i) => i.status === "pending").length;
  }

  function getAudit() {
    return audit.map((e) => ({ ...e }));
  }

  return { enqueue, decide, get, list, pendingCount, getAudit };
}

module.exports = { createApprovalQueue, ITEM_KINDS, DECISIONS };
