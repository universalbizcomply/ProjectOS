"use strict";
/**
 * Forge Secure Deploy Gate — PROJECTOS-FORGE-SECURE-DEPLOY1A (F8).
 *
 * The pre-deploy security gate that attacks the incumbents' top real-world failures (a service-role key
 * shipped in the client bundle; missing/permissive RLS leaking every user's data). It FAILS CLOSED — a
 * manifest is only clean if it provably avoids every checked issue.
 *  1. `auditManifest(scaffold)` — scans EVERY code file that is not provably server-only for secrets /
 *     the service-role key, and requires every migration table to have RLS + owner-scoped policies (that
 *     actually reference `auth.uid()`, not `using (true)`) + an update `WITH CHECK`. Returns
 *     { passed, blockers[], warnings[] }.
 *  2. `planDeploy({ target, productionFrozen })` — production REFUSED, staging OWNER_GATED (enqueue
 *     approval); never auto-runs a deploy.
 * `canDeploy(scaffold, plan)` is true only when the audit passed AND the plan is a non-executed,
 * owner-gated STAGING plan (the plan object is validated, not trusted).
 *
 * Zero dependencies beyond ProjectOS-local modules. No network, no disk, no spawning, no metered API.
 */

const SERVICE_KEY = "SUPABASE_SERVICE_ROLE_KEY";
// Secret shapes incl. the new Supabase key format (sb_secret_/sb_publishable_) and legacy JWT / keys.
const SECRET_RX = /-----BEGIN|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|sb_secret_[A-Za-z0-9]{6,}|sb_publishable_[A-Za-z0-9]{6,}/;
// A secret-NAMED public env var (inlined into the client bundle). Excludes legit public names (URL/ANON).
const PUBLIC_SECRET_RX = /NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE)/;

function isCodeFile(p) { return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p); }

/** Provably server-only files never reach the browser bundle. Everything else that is code is scanned. */
function isServerOnly(p, content) {
  if (typeof content === "string" && content.includes('import "server-only"')) return true;
  if (/(^|\/)route\.(ts|tsx|js|jsx)$/.test(p)) return true;        // route handlers run server-side
  if (/\.server\.(ts|tsx|js|jsx)$/.test(p)) return true;
  if (/^middleware\.(ts|js)$/.test(p)) return true;
  if (/^next\.config\./.test(p)) return true;
  return false;
}

function auditManifest(scaffold) {
  if (!scaffold || !Array.isArray(scaffold.files)) throw new Error("secure-deploy-gate: a scaffold with files[] is required");
  const files = {};
  for (const f of scaffold.files) files[f.path] = f.content;
  const blockers = [];
  const warnings = [];

  // (a) Fail-closed secret scan: every CODE file that is not provably server-only is client-reachable.
  for (const [p, content] of Object.entries(files)) {
    if (!isCodeFile(p) || isServerOnly(p, content)) continue;
    if (typeof content !== "string") { blockers.push("non-string content for " + p); continue; }
    if (content.includes(SERVICE_KEY)) blockers.push("service-role key in client-reachable file: " + p);
    if (SECRET_RX.test(content)) blockers.push("secret-shaped value in client-reachable file: " + p);
    if (PUBLIC_SECRET_RX.test(content)) blockers.push("secret-named NEXT_PUBLIC var (bundled to client): " + p);
  }

  // (b) RLS + owner-scoped policies (referencing auth.uid(), not `true`) + update WITH CHECK per table.
  const migration = files["supabase/migrations/0001_init.sql"] || "";
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
  const tables = [...migration.matchAll(tableRe)].map((m) => m[1].toLowerCase());
  const rawCreates = (migration.match(/create\s+table/gi) || []).length;
  if (rawCreates !== tables.length) blockers.push("unparseable CREATE TABLE statement in migration (" + rawCreates + " creates, " + tables.length + " parsed)");

  const policyLines = migration.split("\n").filter((l) => /create\s+policy/i.test(l));
  for (const t of tables) {
    if (!new RegExp("alter\\s+table\\s+(?:public\\.)?\"?" + t + "\"?\\s+enable row level security", "i").test(migration)) {
      blockers.push("RLS not enabled for table " + t);
    }
    const tPolicies = policyLines.filter((l) => l.includes('"' + t + "_"));
    if (!tPolicies.some((l) => l.includes(t + "_select_own"))) blockers.push("no owner-scoped select policy for table " + t);
    const upd = tPolicies.find((l) => l.includes(t + "_update_own"));
    if (!upd || !/with check/i.test(upd)) blockers.push("update policy missing WITH CHECK for table " + t);
    for (const l of tPolicies) {
      if (/\(\s*true\s*\)/i.test(l)) blockers.push("permissive policy ((true)) for table " + t);
      else if (!l.includes("auth.uid()")) blockers.push("policy not scoped to auth.uid() for table " + t);
    }
  }

  // (c) .env must be gitignored.
  if (!/\.env/.test(files[".gitignore"] || "")) warnings.push(".gitignore does not exclude .env");

  return { passed: blockers.length === 0, blockers, warnings };
}

const DEPLOY_TARGETS = new Set(["staging", "production"]);

function planDeploy(input, deps) {
  const i = input || {};
  const d = deps || {};
  const target = i.target;
  if (!DEPLOY_TARGETS.has(target)) return { decision: "REFUSED", reason: "unknown-target", target: target || null, executed: false };
  const productionFrozen = i.productionFrozen !== false;
  if (target === "production") {
    return { decision: "REFUSED", reason: productionFrozen ? "production-frozen" : "production-deploy-prohibited", target, executed: false };
  }
  let approvalItemId = null;
  if (d.approvalQueue && typeof d.approvalQueue.enqueue === "function") {
    approvalItemId = d.approvalQueue.enqueue({ kind: "launch-approval", summary: "Deploy '" + (i.projectId || "app") + "' to staging (owner approval required)", payload: { target } }).id;
  }
  return { decision: "OWNER_GATED", reason: "requires-owner-approval", target, executed: false, approvalItemId };
}

/** Deploy is permissible only when the audit passes AND the plan is a non-executed OWNER_GATED STAGING
 *  plan. The plan object is VALIDATED (target + executed), never trusted on `decision` alone. */
function canDeploy(scaffold, plan) {
  const audit = auditManifest(scaffold);
  const planOk = !!plan && plan.decision === "OWNER_GATED" && plan.target === "staging" && plan.executed === false;
  return { allowed: audit.passed && planOk, auditPassed: audit.passed, planDecision: plan && plan.decision, blockers: audit.blockers };
}

module.exports = { auditManifest, planDeploy, canDeploy, isServerOnly, isCodeFile };
