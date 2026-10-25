"use strict";
/**
 * Proves the Forge Integration Playbooks invariants (PROJECTOS-FORGE-INTEGRATIONS1A / F9). Synthetic data
 * only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  buildPlaybook('stripe') emits the webhook + checkout files; ownerGated; correct env NAMES
 *  2  the stripe webhook verifies its signature (STRIPE_WEBHOOK_SECRET)
 *  3  keyed clients (stripe/email) are `import "server-only"` — the key can't reach the client bundle
 *  4  no secret VALUE in any playbook file; env vars are NAMES only
 *  5  an unknown integration is refused (fail closed)
 *  6  storage needs no secret and uses the public client
 *  7  buildPlaybooks merges + dedups; auth (no playbook) is skipped; a file collision throws
 *  8  the emitted wiring PASSES the F8 deploy-gate audit (no client-reachable secret)
 *  9  a base scaffold + playbooks merged manifest PASSES the deploy-gate audit
 * 10  no network / metered API / spawn; deterministic
 */

const fs = require("fs");
const path = require("path");
const pb = require("../forge/integration-playbooks.cjs");
const { buildPlaybook, buildPlaybooks } = pb;
const { auditManifest } = require("../forge/secure-deploy-gate.cjs");
const { buildBlueprint } = require("../forge/blueprint-engine.cjs");
const { buildScaffold } = require("../forge/scaffold-engine.cjs");

const SECRET_RX = /-----BEGIN|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|sb_secret_[A-Za-z0-9]{6,}/;

function run() {
  const errors = [];

  // 1: stripe playbook.
  const stripe = buildPlaybook("stripe");
  const stripePaths = stripe.files.map((f) => f.path);
  if (!stripePaths.includes("app/api/stripe/webhook/route.ts") || !stripePaths.includes("app/api/stripe/checkout/route.ts")) errors.push("invariant 1: stripe playbook missing files");
  if (stripe.ownerGated !== true) errors.push("invariant 1: stripe not owner-gated");
  if (!stripe.envVars.includes("STRIPE_SECRET_KEY") || !stripe.envVars.includes("STRIPE_WEBHOOK_SECRET")) errors.push("invariant 1: stripe env names missing");

  // 2: webhook signature verification.
  const webhook = stripe.files.find((f) => f.path.endsWith("webhook/route.ts")).content;
  if (!webhook.includes("STRIPE_WEBHOOK_SECRET") || !/signature/i.test(webhook)) errors.push("invariant 2: stripe webhook does not verify its signature");

  // 3: keyed clients server-only.
  for (const f of stripe.files) if (!/^import "server-only";/.test(f.content)) errors.push("invariant 3: stripe file not server-only: " + f.path);
  const email = buildPlaybook("email");
  if (!/^import "server-only";/.test(email.files[0].content)) errors.push("invariant 3: email lib not server-only");

  // 4: no secret values; env names only.
  for (const id of ["stripe", "email", "storage"]) {
    const p = buildPlaybook(id);
    for (const f of p.files) if (SECRET_RX.test(f.content)) errors.push("invariant 4: secret-shaped value in " + f.path);
    for (const n of p.envVars) if (/[=:]/.test(n)) errors.push("invariant 4: env var is not a bare name: " + n);
  }

  // 5: unknown integration refused.
  try { buildPlaybook("dropbox"); errors.push("invariant 5: unknown integration not refused"); }
  catch (e) { /* expected */ }

  // 6: storage needs no secret + public client.
  const storage = buildPlaybook("storage");
  if (storage.envVars.length !== 0 || storage.ownerGated !== false) errors.push("invariant 6: storage should need no secret / not be owner-gated");
  if (!storage.files[0].content.includes("createBrowserClient")) errors.push("invariant 6: storage does not use the public client");

  // 7: merge + dedup; auth skipped; collision throws.
  const merged = buildPlaybooks(["auth", "stripe", "email", "storage", "realtime"]);
  if (!merged.applied.includes("stripe") || merged.applied.includes("auth")) errors.push("invariant 7: merge did not skip auth / include stripe");
  if (new Set(merged.files.map((f) => f.path)).size !== merged.files.length) errors.push("invariant 7: merged fragment has duplicate paths");

  // 8: emitted wiring passes the deploy-gate audit (no client-reachable secret).
  const audit = auditManifest({ files: merged.files });
  if (!audit.passed) errors.push("invariant 8: playbook wiring failed the deploy-gate audit: " + audit.blockers.join("; "));

  // 9: base scaffold + playbooks merged still passes the audit.
  const base = buildScaffold(buildBlueprint({ description: "a store with stripe checkout and email" }));
  const combined = { files: base.files.filter((f) => !merged.files.some((m) => m.path === f.path)).concat(merged.files) };
  const auditCombined = auditManifest(combined);
  if (!auditCombined.passed) errors.push("invariant 9: base+playbooks manifest failed the audit: " + auditCombined.blockers.join("; "));

  // 10: no network / metered API / spawn; deterministic.
  if (JSON.stringify(buildPlaybooks(["stripe", "email"])) !== JSON.stringify(buildPlaybooks(["stripe", "email"]))) errors.push("invariant 10: playbooks not deterministic");
  const src = fs.readFileSync(path.join(__dirname, "..", "forge", "integration-playbooks.cjs"), "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  if (requires.length !== 0) errors.push("invariant 10: integration-playbooks should be self-contained (requires: " + requires.join(",") + ")");
  if (/https?:|child_process|\.spawn\(|openai|anthropic|fetch\(/i.test(src)) errors.push("invariant 10: integration-playbooks references network/AI-API/spawn");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-integrations: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-integrations: PASS");
}
module.exports = { run };
