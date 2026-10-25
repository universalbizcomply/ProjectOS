"use strict";
/**
 * Proves the Provider Context Guards invariants (PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A). Synthetic data
 * only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  an unknown provider is REFUSED
 *  2  an unknown action is REFUSED
 *  3  a prohibited action (email send) is REFUSED — never merely owner-gated
 *  4  a payment charge is REFUSED
 *  5  a production-targeting action on a frozen project is REFUSED
 *  6  a production-targeting action on an unfrozen project is OWNER_GATED and enqueues an approval item
 *  7  an owner-gated action is OWNER_GATED and enqueues an approval item
 *  8  a plan-only action is ALLOW and enqueues nothing (no provider contact)
 *  9  missing provider/action/project is REFUSED (fail closed by default)
 * 10  a secret in the intent params is redacted in the emitted approval item
 * 11  no provider endpoint/credential string is present in the guard module source (synthetic only)
 * 12  the guard NEVER returns ALLOW for any real (non-plan-only) provider action
 */

const fs = require("fs");
const path = require("path");
const guards = require("../guards/provider-context-guards.cjs");
const { evaluateProviderIntent, PROVIDERS, REFUSED, OWNER_GATED, ALLOW } = guards;
const { createApprovalQueue } = require("../approval/approval-queue.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-provider-secret-7g8h9i";

function run() {
  const errors = [];
  const mkDeps = () => { const redactor = createRedactor(); redactor.register(SECRET, "ref_secret"); return { approvalQueue: createApprovalQueue({ redactor }), redactor }; };

  // 1: unknown provider.
  if (evaluateProviderIntent({ provider: "dropbox", action: "upload", projectId: "acme" }, mkDeps()).decision !== REFUSED) {
    errors.push("invariant 1: unknown provider not REFUSED");
  }
  // 2: unknown action.
  if (evaluateProviderIntent({ provider: "github", action: "nuke", projectId: "acme" }, mkDeps()).decision !== REFUSED) {
    errors.push("invariant 2: unknown action not REFUSED");
  }
  // 3: prohibited email send.
  const emailSend = evaluateProviderIntent({ provider: "email", action: "send", projectId: "acme" }, mkDeps());
  if (emailSend.decision !== REFUSED || emailSend.reason !== "prohibited-action") errors.push("invariant 3: email send not REFUSED as prohibited");
  // 4: payment charge.
  if (evaluateProviderIntent({ provider: "payments", action: "charge", projectId: "acme" }, mkDeps()).decision !== REFUSED) {
    errors.push("invariant 4: payment charge not REFUSED");
  }
  // 5: production-targeting + frozen.
  const frozen = evaluateProviderIntent({ provider: "vercel", action: "deploy-staging", projectId: "acme", productionFrozen: true }, mkDeps());
  if (frozen.decision !== REFUSED || frozen.reason !== "production-frozen") errors.push("invariant 5: production-targeting on frozen project not REFUSED");
  // 5b: omitted productionFrozen must default to frozen (fail safe) → REFUSED.
  const omitted = evaluateProviderIntent({ provider: "vercel", action: "deploy-staging", projectId: "acme" }, mkDeps());
  if (omitted.decision !== REFUSED || omitted.reason !== "production-frozen") errors.push("invariant 5b: omitted productionFrozen did not default to frozen/REFUSED");
  // 6: production-targeting + unfrozen → OWNER_GATED + approval item.
  const d6 = mkDeps();
  const unfrozen = evaluateProviderIntent({ provider: "vercel", action: "deploy-staging", projectId: "acme", productionFrozen: false }, d6);
  if (unfrozen.decision !== OWNER_GATED || !unfrozen.approvalItemId) errors.push("invariant 6: unfrozen production-targeting not OWNER_GATED with approval item");
  if (d6.approvalQueue.pendingCount() !== 1) errors.push("invariant 6: approval item not enqueued");
  // 7: owner-gated action.
  const d7 = mkDeps();
  const gated = evaluateProviderIntent({ provider: "github", action: "create-branch", projectId: "acme" }, d7);
  if (gated.decision !== OWNER_GATED || !gated.approvalItemId || d7.approvalQueue.pendingCount() !== 1) {
    errors.push("invariant 7: owner-gated action not OWNER_GATED with approval item");
  }
  // 8: plan-only → ALLOW, no enqueue.
  const d8 = mkDeps();
  const planOnly = evaluateProviderIntent({ provider: "vercel", action: "plan-deploy", projectId: "acme" }, d8);
  if (planOnly.decision !== ALLOW || d8.approvalQueue.pendingCount() !== 0) errors.push("invariant 8: plan-only not ALLOW with zero enqueues");
  // 9: missing fields → REFUSED.
  for (const bad of [{}, { provider: "vercel" }, { provider: "vercel", action: "plan-deploy" }]) {
    if (evaluateProviderIntent(bad, mkDeps()).decision !== REFUSED) errors.push("invariant 9: missing-field intent not REFUSED: " + JSON.stringify(bad));
  }
  // 10: secret redacted in approval item.
  const d10 = mkDeps();
  evaluateProviderIntent({ provider: "supabase", action: "read-config", projectId: "acme", params: { key: SECRET } }, d10);
  if (JSON.stringify(d10.approvalQueue.list()).includes(SECRET)) errors.push("invariant 10: secret leaked into the approval item");
  // 11: no credential/endpoint in guard source.
  try {
    const src = fs.readFileSync(path.join(__dirname, "..", "guards", "provider-context-guards.cjs"), "utf8");
    if (/https?:\/\/|-----BEGIN|sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{10,}/.test(src)) {
      errors.push("invariant 11: guard source contains an endpoint/credential-shaped string");
    }
  } catch (e) { errors.push("invariant 11: could not scan guard source: " + e.message); }
  // 12: no ALLOW for any real (non-plan-only) provider action.
  for (const [provider, actions] of Object.entries(PROVIDERS)) {
    for (const [action, category] of Object.entries(actions)) {
      if (category === "plan-only") continue;
      const dec = evaluateProviderIntent({ provider, action, projectId: "acme", productionFrozen: false }, mkDeps()).decision;
      if (dec === ALLOW) errors.push("invariant 12: real provider action returned ALLOW: " + provider + "/" + action);
    }
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-provider-context-guards: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-provider-context-guards: PASS");
}
module.exports = { run };
