"use strict";
/**
 * Forge E2E — PROJECTOS-FORGE-E2E-CLOSURE1A (F10).
 *
 * Drives the whole chat-to-app chain OFFLINE, composing every Forge module (F1–F9) with a synthetic
 * in-process worker/verifier — no network, no AI/metered API, no real deploy:
 *
 *   command → buildBlueprint → buildScaffold → planProvision → runGenerationLoop → runVerification →
 *   snapshot → buildPlaybooks → auditManifest → planDeploy
 *
 * It runs the happy path plus each fail-closed path and reports a pass/detail for each. Pure composition
 * of already-validated modules; it adds no new trust.
 */

const { createRedactor } = require("../security/redaction.cjs");
const { buildBlueprint } = require("./blueprint-engine.cjs");
const { buildScaffold } = require("./scaffold-engine.cjs");
const { planProvision } = require("./provisioner.cjs");
const { runGenerationLoop } = require("./generation-loop.cjs");
const { runVerification } = require("./verify-harness.cjs");
const { snapshot } = require("./env-snapshot.cjs");
const { buildPlaybooks } = require("./integration-playbooks.cjs");
const { auditManifest, planDeploy, canDeploy } = require("./secure-deploy-gate.cjs");
const { createApprovalQueue } = require("../approval/approval-queue.cjs");

const COMMAND = "a booking app for a salon with stripe payments, email reminders and customer accounts";

function ok(name, detail) { return { name, ok: true, detail: detail || "" }; }
function fail(name, detail) { return { name, ok: false, detail }; }

/** Happy path: a command becomes a generated, verified, secure app with an owner-gated deploy. */
function scenarioHappyPath() {
  const redactor = createRedactor();
  const blueprint = buildBlueprint({ description: COMMAND });
  const scaffold = buildScaffold(blueprint);
  const filesMap = {};
  for (const f of scaffold.files) filesMap[f.path] = f.content;

  const queue = createApprovalQueue({ redactor });
  const provision = planProvision(scaffold, { approvalQueue: queue });
  if (provision.gatedSteps.some((s) => s.gate !== "owner-approval")) return fail("happy-path", "provision steps not owner-gated");

  // Generation: a synthetic worker fills the home page slot within budget.
  const worker = (env) => ({ correlationId: env.correlationId, status: "completed", costTokens: 1200, requestedSideEffects: ["read-file"], diff: [{ path: env.targetPath, content: "export default function Page(){return null;}" }] });
  const gen = runGenerationLoop({ tasks: [{ id: "home", targetPath: "app/page.tsx" }], worker, files: filesMap, redactor });
  if (!gen.withinBudget || gen.results[0].status !== "completed") return fail("happy-path", "generation did not complete within budget");

  // Verification: all required checks pass → verified.
  const verify = runVerification({ checks: [{ id: "b", kind: "build" }, { id: "u", kind: "unit" }, { id: "w", kind: "wired" }], verifier: () => ({ passed: true }) });
  if (!verify.verified) return fail("happy-path", "app not verified");

  // Snapshot the state (restorable).
  const snap = snapshot(gen.files, "generated");
  if (!snap.id || !snap.hash) return fail("happy-path", "snapshot failed");

  // Integrations wired + merged; the whole manifest passes the fail-closed deploy audit.
  const wiring = buildPlaybooks(blueprint.integrations.map((i) => i.id));
  const merged = { files: scaffold.files.filter((f) => !wiring.files.some((w) => w.path === f.path)).concat(wiring.files) };
  const audit = auditManifest(merged);
  if (!audit.passed) return fail("happy-path", "final manifest failed the security audit: " + audit.blockers.join("; "));

  // Deploy: production refused, staging owner-gated; canDeploy true only for the approved staging plan.
  if (planDeploy({ target: "production" }).decision !== "REFUSED") return fail("happy-path", "production deploy not refused");
  const staging = planDeploy({ target: "staging", projectId: scaffold.projectId }, { approvalQueue: queue });
  if (!canDeploy(merged, staging).allowed) return fail("happy-path", "canDeploy blocked a clean+staging deploy");

  // No secret leak anywhere in the aggregate; no metered API by construction.
  const agg = JSON.stringify({ blueprint, gen: gen.results, verify, snap: snap.id, audit, staging });
  if (/eyJ[A-Za-z0-9_-]{12,}|sb_secret_/.test(agg)) return fail("happy-path", "secret-shaped value in the e2e aggregate");
  return ok("happy-path", "generated → verified → secure → deploy owner-gated");
}

/** A scaffold with a secret smuggled into a client file must fail the deploy audit (fail closed). */
function scenarioInsecureBlocked() {
  const scaffold = buildScaffold(buildBlueprint({ description: COMMAND }));
  const dirty = { files: scaffold.files.map((f) => (f.path === "app/page.tsx" ? { path: f.path, content: "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;" } : f)) };
  const audit = auditManifest(dirty);
  if (audit.passed) return fail("insecure-blocked", "a client-side secret leak passed the audit");
  const staging = planDeploy({ target: "staging" });
  if (canDeploy(dirty, staging).allowed) return fail("insecure-blocked", "deploy allowed despite a failing audit");
  return ok("insecure-blocked", "secret leak blocked the deploy");
}

/** An unwired ("Potemkin") app must not verify, even though it builds/renders. */
function scenarioPotemkinNotVerified() {
  const verify = runVerification({ checks: [{ id: "b", kind: "build" }, { id: "u", kind: "unit" }, { id: "w", kind: "wired" }], verifier: (c) => ({ passed: c.kind !== "wired" }) });
  if (verify.verified) return fail("potemkin-not-verified", "an unwired app was verified");
  return ok("potemkin-not-verified", "unwired app correctly not verified");
}

/** Generation cannot exceed its budget cap. */
function scenarioBudgetCap() {
  const worker = (env) => ({ correlationId: env.correlationId, status: "completed", costTokens: 1000, diff: [{ path: env.targetPath, content: "x" }] });
  const r = runGenerationLoop({ tasks: [{ id: "a", targetPath: "a.ts" }, { id: "b", targetPath: "b.ts" }, { id: "c", targetPath: "c.ts" }], worker, budgetCap: 1500, perCallMax: 1000 });
  if (r.spent > r.budgetCap || !r.results.some((x) => x.status === "blocked")) return fail("budget-cap", "budget cap not enforced");
  return ok("budget-cap", "budget cap enforced; over-budget tasks blocked");
}

const SCENARIOS = [scenarioHappyPath, scenarioInsecureBlocked, scenarioPotemkinNotVerified, scenarioBudgetCap];

function runForgeE2E() {
  return SCENARIOS.map((fn) => { try { return fn(); } catch (e) { return { name: fn.name, ok: false, detail: "threw: " + e.message }; } });
}

module.exports = { runForgeE2E };
