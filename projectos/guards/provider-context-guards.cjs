"use strict";
/**
 * Provider Context Guards — PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A.
 *
 * The safety net that makes external-provider access impossible without an explicit, owner-approved,
 * unfrozen path. Before any operation that WOULD touch an external provider (Supabase, Vercel, GitHub,
 * email/SMS/WhatsApp, payments), this guard classifies the *intent* — it NEVER contacts a provider — and
 * returns one of:
 *   - REFUSED       (default; prohibited action, unknown provider/action, production-frozen, or bad input)
 *   - OWNER_GATED   (permitted only via owner approval; the guard enqueues an approval item)
 *   - ALLOW         (only for planning-type actions that make NO network contact)
 *
 * Fail-closed: anything not explicitly classified is REFUSED. The guard config carries NO real endpoints
 * or credentials — provider intents are described abstractly and evaluated locally.
 *
 * Zero dependencies beyond ProjectOS-local modules. No network, no disk, no spawning.
 */

const { createRedactor } = require("../security/redaction.cjs");

// Per-provider action classification. Actions absent here are unknown → REFUSED.
//   "prohibited"          → always REFUSED (external send / payment / production mutation)
//   "production-targeting"→ REFUSED if the project is production-frozen, else OWNER_GATED
//   "owner-gated"         → OWNER_GATED (needs owner approval)
//   "plan-only"           → ALLOW (no network contact — planning/preview only)
const PROVIDERS = {
  supabase: { "apply-migration": "production-targeting", "read-config": "owner-gated", "mutate-production-db": "prohibited", "plan-schema": "plan-only" },
  vercel: { "deploy-staging": "production-targeting", "deploy-production": "prohibited", "read-config": "owner-gated", "plan-deploy": "plan-only" },
  github: { "create-branch": "owner-gated", "open-pr": "owner-gated", "force-push": "prohibited", "plan-changes": "plan-only" },
  email: { send: "prohibited", "plan-message": "plan-only" },
  sms: { send: "prohibited", "plan-message": "plan-only" },
  whatsapp: { send: "prohibited", "plan-message": "plan-only" },
  payments: { charge: "prohibited", refund: "prohibited", "plan-invoice": "plan-only" },
};
// Freeze the classification table so no in-process code can downgrade a decision by mutating it.
for (const actions of Object.values(PROVIDERS)) Object.freeze(actions);
Object.freeze(PROVIDERS);

const REFUSED = "REFUSED";
const OWNER_GATED = "OWNER_GATED";
const ALLOW = "ALLOW";

function classifyIntent(provider, action) {
  const actions = Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider] : null;
  if (!actions) return { category: null, reason: "unknown-provider" };
  const category = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
  if (!category) return { category: null, reason: "unknown-action" };
  return { category, reason: null };
}

/**
 * Evaluate a provider intent. Pure decision + (for OWNER_GATED) an approval-queue enqueue side effect.
 * @param intent { provider, action, projectId, productionFrozen?, environment?, params? }
 * @param deps   { approvalQueue?, redactor? }
 * @returns { decision, reason, provider, action, approvalItemId }
 */
function evaluateProviderIntent(intent, deps) {
  const i = intent || {};
  const d = deps || {};
  const redactor = d.redactor || createRedactor();
  const base = { provider: i.provider || null, action: i.action || null, approvalItemId: null };

  if (typeof i.provider !== "string" || !i.provider || typeof i.action !== "string" || !i.action) {
    return { ...base, decision: REFUSED, reason: "missing-provider-or-action" };
  }
  if (typeof i.projectId !== "string" || !i.projectId) {
    return { ...base, decision: REFUSED, reason: "missing-project" };
  }

  const { category, reason } = classifyIntent(i.provider, i.action);
  if (!category) return { ...base, decision: REFUSED, reason };

  // Explicit dispatch that DEFAULTS to REFUSED — an unrecognised category (e.g. a future config typo)
  // must never fall through to an approvable decision.
  const productionFrozen = i.productionFrozen !== false; // default true (fail safe)
  switch (category) {
    case "prohibited":
      return { ...base, decision: REFUSED, reason: "prohibited-action" };
    case "plan-only":
      return { ...base, decision: ALLOW, reason: "plan-only-no-contact" };
    case "production-targeting":
      if (productionFrozen) return { ...base, decision: REFUSED, reason: "production-frozen" };
      break; // unfrozen → owner-gated enqueue below
    case "owner-gated":
      break;
    default:
      return { ...base, decision: REFUSED, reason: "unknown-category" };
  }

  // Owner-gated: emit an approval item (secrets redacted) if a queue is provided.
  let approvalItemId = null;
  if (d.approvalQueue && typeof d.approvalQueue.enqueue === "function") {
    const item = d.approvalQueue.enqueue({
      kind: "side-effect",
      summary: redactor.redactText(`Provider action '${i.action}' on ${i.provider} for ${i.projectId} requires owner approval`),
      payload: redactor.redactObject({ provider: i.provider, action: i.action, projectId: i.projectId, environment: i.environment || null, params: i.params || {} }),
    });
    approvalItemId = item.id;
  }
  return { ...base, decision: OWNER_GATED, reason: "requires-owner-approval", approvalItemId };
}

module.exports = { evaluateProviderIntent, classifyIntent, PROVIDERS, REFUSED, OWNER_GATED, ALLOW };
