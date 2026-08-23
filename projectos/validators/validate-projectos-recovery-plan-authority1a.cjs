"use strict";
// PROJECTOS-RECOVERY-PLAN-AUTHORITY1A — the plan-approval authority boundary.
//
// A plan record carrying PLAN READY is what execution authority is derived from, so the question
// "whose approval is this?" has to be answerable mechanically. Before this it was not: the readiness
// evaluator checked that `approvalAuthority` said "owner" and that `approvedBy` was not the
// implementer, and ANY other name satisfied both. A plan approved by a stranger read as an
// owner-authority approval.
//
// This validator proves the corrected rule over a synthetic matrix, and then applies it to every plan
// record actually present in this repository — including any plan-approval delegation the owner has
// recorded. It is pure decision logic plus reading committed files; it approves nothing, writes
// nothing, and grants nothing.
//
// Created in the post-V3 operational recovery programme (Stage 2).
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const gov = require("./plan-governance-engine.cjs");
const disc = require("./plan-discovery-engine.cjs");

const OWNER = "Ada";
const DELEGATE = "Grace";

function readJSON(abs) {
  try { return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^﻿/, "")); } catch (_) { return null; }
}

/** A minimal plan that evaluates READY, so each case below differs in exactly one thing. */
function readyPlan(over) {
  const plan = {
    schemaVersion: "1.0.0",
    projectId: "acme",
    projectName: "Acme",
    programmeId: "acme-p",
    planId: "acme-plan",
    planVersion: "1.0",
    planStatus: "PLAN READY",
    businessVision: "v",
    definitionOfComplete: "d",
    approvedScope: ["s"],
    excludedScope: ["x"],
    successStandard: "proven",
    repository: {
      repositoryPath: "/tmp/acme",
      expectedRemote: "acme/app",
      protectedBranches: ["main"],
      baselineCommit: "c".repeat(40),
      planPersistenceCommit: null,
      planSourceBranch: "main"
    },
    sourceDocuments: [{ documentPath: "docs/plan.md", sourceDocumentType: "human-readable-plan", sourceDocumentChecksum: "sha256:" + "d".repeat(64), authoritative: true, superseded: false }],
    phases: [{ phaseId: "ACME-P1A", description: "do it", dependsOn: [], acceptanceCriteria: ["done"], riskLevel: "low", autonomyLevel: "local-safe", requiredValidators: ["validate-all"], requiredReviews: [], requiredBrowserProof: false, requiredOwnerGates: ["phase-closure"] }],
    environments: [{ environmentId: "local", productionFreeze: true }],
    providers: [],
    governance: {
      owner: OWNER,
      gatekeeper: "Gatekeeper",
      implementer: "Claude Code",
      allowedActions: ["inspect-repository"],
      forbiddenActions: gov.REQUIRED_FORBIDDEN_ACTIONS.slice(),
      ownerOnlyActions: ["approve-plan"],
      closureAuthority: OWNER,
      noApiPolicy: true
    },
    approval: {
      approvalStatus: "approved",
      approvedBy: OWNER,
      approvalDate: "2026-08-11",
      approvalEvidenceReference: "owner approved",
      supersedesPlanVersion: null,
      approvalBinding: "MANUAL_GOVERNANCE_APPROVAL",
      tamperProof: false,
      approvalAuthority: "owner",
      secureApprovalEvidence: null
    },
    staleness: { lastVerifiedCommit: "c".repeat(40), lastVerifiedDate: "2026-08-11", stalenessStatus: "fresh", stalenessReasons: [], materialPlanInputs: [{ inputId: "docs/plan.md", fingerprint: "sha256:" + "d".repeat(64) }] },
    security: { secretPolicy: "no raw secrets", rawSecretValuesForbidden: true, sensitiveDataForbidden: true, redactionRequired: true }
  };
  if (over && over.approval) plan.approval = Object.assign({}, plan.approval, over.approval);
  if (over && over.governance) plan.governance = Object.assign({}, plan.governance, over.governance);
  return plan;
}

function delegated(over) {
  return readyPlan({
    approval: {
      approvedBy: DELEGATE,
      approvalDelegation: Object.assign(
        {
          delegatedBy: OWNER,
          delegatedTo: DELEGATE,
          delegationDate: "2026-08-11",
          delegatedScope: ["plan-approval"],
          projectScope: "acme",
          excludesProtectedActions: true
        },
        over || {}
      )
    }
  });
}

function run() {
  const errors = [];

  // 1. BASELINE. The fixture must be READY when the owner approves, or every negative below proves
  //    nothing — a case that fails for an unrelated reason looks like a passing control.
  {
    const r = gov.evaluatePlanReady(readyPlan());
    if (!r.ready) errors.push("baseline owner-approved plan is not READY: " + r.reasons.join("; "));
  }

  // 2. THE HOLE THAT WAS THERE. A stranger, claiming owner authority, with no delegation.
  {
    const r = gov.evaluatePlanReady(readyPlan({ approval: { approvedBy: "Mallory" } }));
    if (r.ready) errors.push("a plan approved by someone who is neither the owner nor a delegate evaluated READY");
    if (!r.reasons.some((x) => /is not the recorded owner/i.test(x))) {
      errors.push("the refusal does not say the approver is not the recorded owner: " + r.reasons.join("; "));
    }
  }

  // 3. THE LEGITIMATE CASE. The owner named that person, in this plan, for this project.
  {
    const r = gov.evaluatePlanReady(delegated());
    if (!r.ready) errors.push("an owner-delegated plan approval was refused: " + r.reasons.join("; "));
  }

  // 4. THE DELEGATION MUST NOT BE ABLE TO ESCALATE ITSELF. Each of these differs from case 3 in one
  //    field, and each must fail — a delegation that can rewrite its own limits is not a limit.
  const escalations = [
    ["a delegation granted by someone other than the owner", { delegatedBy: "Mallory" }],
    ["a delegation naming a different person than the approver", { delegatedTo: "Someone Else" }],
    ["a delegation to the implementer", { delegatedTo: "Claude Code" }],
    ["a delegation scoped to another project", { projectScope: "other" }],
    ["a delegation claiming protected-action authority", { excludesProtectedActions: false }],
    ["a delegation carrying a scope beyond plan approval", { delegatedScope: ["plan-approval", "production-deploy"] }],
    ["a delegation carrying no plan-approval scope", { delegatedScope: [] }],
    ["a delegation with no date", { delegationDate: "" }]
  ];
  for (const [label, over] of escalations) {
    if (gov.evaluatePlanReady(delegated(over)).ready) errors.push("READY was granted despite " + label);
  }

  // 5. THE IMPLEMENTER CAN NEVER BE THE APPROVER, delegation or not. Belt and braces: this is the
  //    single most important thing the whole authority model exists to prevent.
  for (const name of ["Claude", "Claude Code", "claude-code", "Anthropic assistant", "the AI", "implementer"]) {
    if (!gov.isImplementerIdentity(name)) errors.push("implementer identity not recognised: " + name);
    const r = gov.evaluatePlanReady(readyPlan({ approval: { approvedBy: name } }));
    if (r.ready) errors.push("a plan approved by '" + name + "' evaluated READY");
  }

  // 6. AN APPROVAL IS NEVER SELF-DESCRIBING AS TAMPER-PROOF. No overclaim; the binding is the commit
  //    gate, and a record that says otherwise is refused rather than believed.
  if (gov.evaluatePlanReady(readyPlan({ approval: { tamperProof: true } })).ready) {
    errors.push("a plan claiming tamperProof: true evaluated READY");
  }

  // 7. THIS REPOSITORY. Every plan record present must satisfy the same rule — including the one this
  //    programme will eventually write. Records are found, not listed, so a new one cannot slip past.
  const planFiles = [];
  (function walk(dir, depth) {
    if (depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "versions") walk(abs, depth + 1); continue; }
      if (/\.plan\.json$/i.test(e.name)) planFiles.push(abs);
    }
  })(path.join(ROOT, "projectos", "state"), 0);
  const projectopsPlan = path.join(ROOT, ".projectops", "plan.json");
  if (fs.existsSync(projectopsPlan)) planFiles.push(projectopsPlan);

  for (const abs of planFiles) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    const plan = readJSON(abs);
    if (plan === null) { errors.push(rel + " is not readable JSON"); continue; }
    const errs = gov.checkApprovalBinding(plan);
    for (const e of errs) errors.push(rel + ": " + e);
  }

  // 8. THE OWNER'S DELEGATION RECORD, when one exists. It is the artefact that lets someone other
  //    than the owner approve, so its own shape is checked here rather than only at approval time.
  const delegationRel = ".projectops/authority/plan-approval-delegation.json";
  const delegationAbs = path.join(ROOT, delegationRel);
  if (fs.existsSync(delegationAbs)) {
    const rec = readJSON(delegationAbs);
    if (rec === null) errors.push(delegationRel + " is not readable JSON");
    else {
      const cfg = readJSON(path.join(ROOT, ".projectops", "project-config.json")) || {};
      const declared = cfg.planMemory && cfg.planMemory.planPath;
      const active = typeof declared === "string" ? readJSON(path.join(ROOT, declared)) : null;
      const recordedOwner = active && active.governance ? active.governance.owner : null;
      if (rec.schemaVersion !== "1.0.0") errors.push(delegationRel + ": unexpected schemaVersion " + JSON.stringify(rec.schemaVersion));
      if (rec.projectId !== cfg.projectId) errors.push(delegationRel + ": projectId " + JSON.stringify(rec.projectId) + " is not this project's " + JSON.stringify(cfg.projectId));
      if (!recordedOwner) errors.push(delegationRel + ": no active plan records an owner to check the delegator against");
      else if (rec.delegatedBy !== recordedOwner) errors.push(delegationRel + ": delegatedBy " + JSON.stringify(rec.delegatedBy) + " is not the recorded owner " + JSON.stringify(recordedOwner));
      if (gov.isImplementerIdentity(rec.delegatedTo)) errors.push(delegationRel + ": delegates plan approval to the implementer");
      const scope = Array.isArray(rec.delegatedScope) ? rec.delegatedScope : [];
      if (!scope.includes("plan-approval")) errors.push(delegationRel + ": does not carry the plan-approval scope");
      for (const s of scope) if (s !== "plan-approval") errors.push(delegationRel + ": carries a scope it may not grant: " + String(s));
      if (rec.excludesProtectedActions !== true) errors.push(delegationRel + ": must state excludesProtectedActions: true");
      // A delegation is an authority artefact. It must not be able to smuggle a credential.
      const secrets = disc.scanSecrets(JSON.stringify(rec));
      if (secrets.length) errors.push(delegationRel + ": secret-shaped content (" + secrets.join(", ") + ")");
    }
  }

  // 8b. THE OWNER'S CLOSURE DELEGATION, when one exists. Closure and plan approval are different
  // authorities and are recorded separately, so neither can be widened by editing the other.
  const closureRel = ".projectops/authority/closure-delegation.json";
  const closureAbs = path.join(ROOT, closureRel);
  if (fs.existsSync(closureAbs)) {
    const rec = readJSON(closureAbs);
    if (rec === null) errors.push(closureRel + " is not readable JSON");
    else {
      const cfg = readJSON(path.join(ROOT, ".projectops", "project-config.json")) || {};
      const declared = cfg.planMemory && cfg.planMemory.planPath;
      const active = typeof declared === "string" ? readJSON(path.join(ROOT, declared)) : null;
      const recordedOwner = active && active.governance ? active.governance.owner : null;
      if (rec.schemaVersion !== "1.0.0") errors.push(closureRel + ": unexpected schemaVersion " + JSON.stringify(rec.schemaVersion));
      if (rec.projectId !== cfg.projectId) errors.push(closureRel + ": projectId " + JSON.stringify(rec.projectId) + " is not this project's " + JSON.stringify(cfg.projectId));
      if (!recordedOwner) errors.push(closureRel + ": no active plan records an owner to check the delegator against");
      else if (rec.delegatedBy !== recordedOwner) errors.push(closureRel + ": delegatedBy " + JSON.stringify(rec.delegatedBy) + " is not the recorded owner " + JSON.stringify(recordedOwner));
      if (gov.isImplementerIdentity(rec.delegatedTo)) errors.push(closureRel + ": delegates closure to the implementer");
      const scope = Array.isArray(rec.delegatedScope) ? rec.delegatedScope : [];
      if (scope.length === 0) errors.push(closureRel + ": carries no scope");
      for (const s of scope) if (s !== "phase-closure" && s !== "programme-closure" && s !== "gatekeeper-review-decisions") errors.push(closureRel + ": carries a scope it may not grant: " + String(s));
      if (rec.excludesProtectedActions !== true) errors.push(closureRel + ": must state excludesProtectedActions: true");
      if (typeof rec.programmeScope !== "string" || rec.programmeScope.trim() === "") errors.push(closureRel + ": names no programmeScope, so it is not bound to a programme");
      const secrets = disc.scanSecrets(JSON.stringify(rec));
      if (secrets.length) errors.push(closureRel + ": secret-shaped content (" + secrets.join(", ") + ")");
      // The two delegations must not collapse into one. Plan approval is not closure.
      const approvalRec = fs.existsSync(delegationAbs) ? readJSON(delegationAbs) : null;
      if (approvalRec && Array.isArray(approvalRec.delegatedScope) && approvalRec.delegatedScope.some((s) => scope.includes(s))) {
        errors.push("the plan-approval and closure delegations share a scope — they must grant different authorities");
      }
    }
  }

  // 9. NO DECISION RECORD MAY CARRY A SECRET, and none may claim to be its own authority.
  const decisionsDir = path.join(ROOT, ".projectops", "plan-decisions");
  if (fs.existsSync(decisionsDir)) {
    for (const name of fs.readdirSync(decisionsDir)) {
      if (!name.endsWith(".json")) continue;
      const rel = ".projectops/plan-decisions/" + name;
      const rec = readJSON(path.join(decisionsDir, name));
      if (rec === null) { errors.push(rel + " is not readable JSON"); continue; }
      if (gov.isImplementerIdentity(rec.decidedBy)) errors.push(rel + ": decided by the implementer");
      if (typeof rec.planDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(rec.planDigest)) {
        errors.push(rel + ": names no valid plan digest, so it is not bound to any plan material");
      }
      const secrets = disc.scanSecrets(JSON.stringify(rec));
      if (secrets.length) errors.push(rel + ": secret-shaped content (" + secrets.join(", ") + ")");
    }
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-projectos-recovery-plan-authority1a: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-projectos-recovery-plan-authority1a: PASS");
}
module.exports = { run };
