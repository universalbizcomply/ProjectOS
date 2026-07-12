"use strict";
/**
 * Proves the Forge Secure Deploy Gate invariants (PROJECTOS-FORGE-SECURE-DEPLOY1A / F8). Synthetic
 * manifests only. If any invariant regresses, `run()` returns a non-empty error list and validate-all
 * fails.
 *
 * Invariants:
 *  1  a clean generated scaffold passes the audit
 *  2  the service-role key in a client-reachable file BLOCKS (fail closed)
 *  3  a secret-shaped value in a client-reachable file BLOCKS
 *  4  a table missing RLS BLOCKS
 *  5  a table missing update WITH CHECK BLOCKS
 *  6  a production deploy is REFUSED
 *  7  a staging deploy is OWNER_GATED and enqueues an approval item; never executed
 *  8  an unknown deploy target is REFUSED
 *  9  canDeploy is false when the audit fails even for an OWNER_GATED staging plan
 * 10  no network / metered API / spawn (only local modules required)
 * 11  fail-closed reachability: a secret in components/ or lib/ (not just app/) BLOCKS
 * 12  tolerant table parsing: an uppercase / unparseable CREATE TABLE BLOCKS (RLS can't be skipped)
 * 13  policy correctness: `using (true)` / `with check (true)` / missing auth.uid() BLOCKS
 * 14  new-format secret (sb_secret_) BLOCKS; canDeploy rejects a forged/production plan
 */

const fs = require("fs");
const path = require("path");
const gate = require("../forge/secure-deploy-gate.cjs");
const { auditManifest, planDeploy, canDeploy } = gate;
const { buildBlueprint } = require("../forge/blueprint-engine.cjs");
const { buildScaffold } = require("../forge/scaffold-engine.cjs");
const { createApprovalQueue } = require("../approval/approval-queue.cjs");

function scaffoldFor(desc) { return buildScaffold(buildBlueprint({ description: desc })); }
function withFile(scaffold, p, content) {
  const files = scaffold.files.filter((f) => f.path !== p).concat([{ path: p, content }]);
  return { ...scaffold, files };
}

function run() {
  const errors = [];
  const clean = scaffoldFor("a booking app for a salon with stripe payments and accounts");

  // 1: clean passes.
  const a1 = auditManifest(clean);
  if (!a1.passed) errors.push("invariant 1: clean scaffold failed the audit: " + a1.blockers.join("; "));

  // 2: service-role key in a client file blocks.
  const a2 = auditManifest(withFile(clean, "app/page.tsx", "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;"));
  if (a2.passed || !a2.blockers.some((b) => b.includes("service-role"))) errors.push("invariant 2: service-role key in client file not blocked");

  // 3: secret-shaped value in a client file blocks.
  const a3 = auditManifest(withFile(clean, "app/page.tsx", "const jwt = 'eyJhbGciOiJIUzI1Niincluding';"));
  if (a3.passed || !a3.blockers.some((b) => b.includes("secret-shaped"))) errors.push("invariant 3: secret in client file not blocked");

  // 4: missing RLS blocks.
  const noRls = withFile(clean, "supabase/migrations/0001_init.sql", "create table if not exists public.booking (id uuid);\n");
  const a4 = auditManifest(noRls);
  if (a4.passed || !a4.blockers.some((b) => b.includes("RLS not enabled"))) errors.push("invariant 4: missing RLS not blocked");

  // 5: missing update WITH CHECK blocks.
  const noCheck = withFile(clean, "supabase/migrations/0001_init.sql",
    'create table if not exists public.booking (id uuid);\nalter table public.booking enable row level security;\ncreate policy "booking_select_own" on public.booking for select using (auth.uid() = owner_id);\ncreate policy "booking_update_own" on public.booking for update using (auth.uid() = owner_id);\n');
  const a5 = auditManifest(noCheck);
  if (a5.passed || !a5.blockers.some((b) => b.includes("WITH CHECK"))) errors.push("invariant 5: missing update WITH CHECK not blocked");

  // 6: production refused.
  const p6 = planDeploy({ target: "production", projectId: "x" });
  if (p6.decision !== "REFUSED" || p6.executed !== false) errors.push("invariant 6: production deploy not REFUSED");

  // 7: staging owner-gated + approval item.
  const q = createApprovalQueue();
  const p7 = planDeploy({ target: "staging", projectId: "x" }, { approvalQueue: q });
  if (p7.decision !== "OWNER_GATED" || !p7.approvalItemId || q.pendingCount() !== 1 || p7.executed !== false) errors.push("invariant 7: staging deploy not owner-gated with approval item");

  // 8: unknown target refused.
  if (planDeploy({ target: "beta" }).decision !== "REFUSED") errors.push("invariant 8: unknown deploy target not REFUSED");

  // 9: canDeploy false when audit fails.
  const dirty = withFile(clean, "app/page.tsx", "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;");
  const cd = canDeploy(dirty, p7);
  if (cd.allowed !== false) errors.push("invariant 9: canDeploy allowed a deploy despite a failing audit");
  const cdClean = canDeploy(clean, p7);
  if (cdClean.allowed !== true) errors.push("invariant 9: canDeploy blocked a clean scaffold + staging plan");

  // 11: fail-closed reachability — a secret outside app/ (components/, lib/) still blocks.
  const compLeak = auditManifest(withFile(clean, "components/Dashboard.tsx", "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;"));
  if (compLeak.passed) errors.push("invariant 11: service-role key in components/ not blocked");
  const libLeak = auditManifest(withFile(clean, "lib/supabase/admin.ts", "const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6';"));
  if (libLeak.passed) errors.push("invariant 11: secret in lib/ not blocked");

  // 12: tolerant table parsing — uppercase / unparseable CREATE TABLE must not silently skip RLS.
  const upper = auditManifest(withFile(clean, "supabase/migrations/0001_init.sql", "CREATE TABLE public.booking (id uuid);\n"));
  if (upper.passed) errors.push("invariant 12: uppercase CREATE TABLE bypassed the RLS audit");

  // 13: policy correctness — permissive / non-owner policies block.
  const permissive = auditManifest(withFile(clean, "supabase/migrations/0001_init.sql",
    'create table if not exists public.booking (id uuid);\nalter table public.booking enable row level security;\ncreate policy "booking_select_own" on public.booking for select using (true);\ncreate policy "booking_update_own" on public.booking for update using (auth.uid() = owner_id) with check (true);\n'));
  if (permissive.passed) errors.push("invariant 13: permissive (true) policies were not blocked");

  // 14: new-format secret + forged plan.
  const sbSecret = auditManifest(withFile(clean, "app/page.tsx", "const k = 'sb_secret_abcdef123456';"));
  if (sbSecret.passed) errors.push("invariant 14: sb_secret_ key not blocked");
  const forged = canDeploy(clean, { decision: "OWNER_GATED", target: "production", executed: false });
  if (forged.allowed !== false) errors.push("invariant 14: canDeploy accepted a forged production plan");
  const executedPlan = canDeploy(clean, { decision: "OWNER_GATED", target: "staging", executed: true });
  if (executedPlan.allowed !== false) errors.push("invariant 14: canDeploy accepted an already-executed plan");

  // 10: no network / metered API / spawn.
  const src = fs.readFileSync(path.join(__dirname, "..", "forge", "secure-deploy-gate.cjs"), "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const rq of requires) if (!/^\.\.\//.test(rq)) errors.push("invariant 10: secure-deploy-gate requires a non-local module: " + rq);
  if (/https?:|child_process|\.spawn\(|openai|anthropic|fetch\(/i.test(src)) errors.push("invariant 10: secure-deploy-gate references network/AI-API/spawn");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-deploy: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-deploy: PASS");
}
module.exports = { run };
