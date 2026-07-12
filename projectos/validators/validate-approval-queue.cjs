"use strict";
/**
 * Proves the Owner Approval Queue invariants (PROJECTOS-V3-APPROVAL-QUEUE1A). Synthetic data only. If any
 * invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  enqueue creates a pending item with an id
 *  2  decide 'approve' WITH owner confirmation → approved and audited
 *  3  decide WITHOUT owner confirmation throws (no self-approve) and leaves the item pending
 *  4  an invalid decision throws
 *  5  deciding an unknown item throws
 *  6  deciding an already-decided item throws (no double decision)
 *  7  return / reject transitions work with owner confirmation
 *  8  an unknown item kind is refused at enqueue (allowlist)
 *  9  a secret in the summary/payload is redacted, and never appears in the audit
 * 10  the audit is metadata-only and records decisions; list()/pendingCount() reflect status
 * 11  a freshly enqueued item confers no authority — it is pending until the owner decides
 * 12  a returned item's payload is frozen — a holder cannot rewrite what the owner reviews
 */

const { createApprovalQueue } = require("../approval/approval-queue.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-approval-secret-1f2e3d";
const OWNER = { capability: { ownerConfirmation: true } };

function expectThrow(errors, label, fn) {
  try { fn(); errors.push(label + ": expected failure but call succeeded"); }
  catch (e) { if (String(e.message).includes(SECRET)) errors.push(label + ": error message leaked a secret"); }
}

function run() {
  const errors = [];
  const redactor = createRedactor();
  redactor.register(SECRET, "ref_secret");
  const q = createApprovalQueue({ redactor });

  // 1: enqueue.
  const item = q.enqueue({ kind: "launch-approval", summary: "Approve staging launch for phase P1" });
  if (!item.id || item.status !== "pending") errors.push("invariant 1: enqueue did not create a pending item");

  // 11: pending confers no authority.
  if (q.get(item.id).status !== "pending") errors.push("invariant 11: fresh item was not pending");

  // 3: decide without owner confirmation → throws, stays pending.
  expectThrow(errors, "invariant 3 (no owner confirmation)", () => q.decide({ id: item.id, decision: "approve" }));
  if (q.get(item.id).status !== "pending") errors.push("invariant 3: item changed without owner confirmation");

  // 4: invalid decision.
  expectThrow(errors, "invariant 4 (invalid decision)", () => q.decide({ id: item.id, decision: "maybe", ...OWNER }));

  // 5: unknown item.
  expectThrow(errors, "invariant 5 (unknown item)", () => q.decide({ id: "apr_999", decision: "approve", ...OWNER }));

  // 2: approve with owner confirmation.
  const approved = q.decide({ id: item.id, decision: "approve", ...OWNER });
  if (approved.status !== "approved" || approved.decision !== "approve") errors.push("invariant 2: approve did not set approved status");

  // 6: already decided.
  expectThrow(errors, "invariant 6 (already decided)", () => q.decide({ id: item.id, decision: "reject", ...OWNER }));

  // 7: return / reject transitions.
  const r1 = q.enqueue({ kind: "side-effect", summary: "Worker requested a staging deploy" });
  const returned = q.decide({ id: r1.id, decision: "return", ...OWNER });
  if (returned.status !== "returned") errors.push("invariant 7: return did not set returned status");
  const r2 = q.enqueue({ kind: "plan-decision", summary: "Resolve conflicting definition of complete" });
  const rejected = q.decide({ id: r2.id, decision: "reject", ...OWNER });
  if (rejected.status !== "rejected") errors.push("invariant 7: reject did not set rejected status");

  // 8: unknown kind refused.
  expectThrow(errors, "invariant 8 (unknown kind)", () => q.enqueue({ kind: "nonsense", summary: "x" }));

  // 9: secret redacted in summary/payload and audit.
  const leaky = q.enqueue({ kind: "generic", summary: "token is " + SECRET, payload: { note: "value " + SECRET } });
  if (JSON.stringify(leaky).includes(SECRET)) errors.push("invariant 9: secret survived into the enqueued item");
  if (JSON.stringify(q.getAudit()).includes(SECRET)) errors.push("invariant 9: secret leaked into the audit");

  // 10: audit metadata-only records decisions; list/pendingCount reflect status.
  const audit = q.getAudit();
  if (!audit.some((e) => e.action === "decide" && e.decision === "approve" && e.ok === true)) {
    errors.push("invariant 10: audit did not record the approve decision");
  }
  if (audit.some((e) => "summary" in e || "payload" in e)) errors.push("invariant 10: audit carried item content, not just metadata");
  if (q.list("approved").length !== 1) errors.push("invariant 10: list('approved') count wrong");
  if (q.pendingCount() !== 1) errors.push("invariant 10: pendingCount wrong (expected 1 — the leaky generic item)");

  // 12: payload is frozen — external mutation cannot rewrite what the owner reviews.
  const mutTest = q.enqueue({ kind: "generic", summary: "review me", payload: { note: "original" } });
  try { mutTest.payload.note = "tampered"; } catch (e) { /* frozen → throws in strict mode */ }
  if (q.get(mutTest.id).payload.note !== "original") errors.push("invariant 12: item payload was externally mutable");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-approval-queue: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-approval-queue: PASS");
}
module.exports = { run };
