"use strict";
// CD-B4-PROTECTED-PLAN-REDUCER-PERMIT-INTEGRATION1A — boundary for the Tier-2 reducer/facts/context/
// permit wiring in host-core. Structural proof that a plan-governed operation cannot obtain or retain an
// ExecutionPermit without one exact active approved-plan binding, and that plan failures are classified
// honestly (never mapped onto project/phase/generic authority).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "projectos", "host", "core", "src");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
function block(src, header) {
  const start = src.indexOf(header);
  if (start < 0) return "";
  let depth = 0;
  let i = src.indexOf("{", start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(from, i + 1);
  }
  return "";
}

function run() {
  const errors = [];
  const facts = stripComments(read(path.join(SRC, "facts.rs")));
  const operation = stripComments(read(path.join(SRC, "operation.rs")));
  const reducer = stripComments(read(path.join(SRC, "reducer.rs")));
  const capability = stripComments(read(path.join(SRC, "capability.rs")));
  const errorRs = stripComments(read(path.join(SRC, "error.rs")));

  // ---- 1. Operation owns an immutable OPTIONAL plan requirement, set via a plan-validated route ----
  if (!/pub struct InternalOperationRecord \{[\s\S]*?required_plan: Option<crate::plan::ApprovedPlanBinding>,?[\s\S]*?\}/.test(operation))
    errors.push("InternalOperationRecord has no required_plan (Option<ApprovedPlanBinding>)");
  if (!/pub struct InternalOperationRecord \{[\s\S]*?requested_policy: Option<crate::plan::RequestedOperationPolicy>,?[\s\S]*?\}/.test(operation))
    errors.push("InternalOperationRecord has no requested_policy");
  const bind = block(operation, "pub fn bind_approved_plan(");
  if (!/validated: &crate::plan::ValidatedApprovedPlan/.test(operation))
    errors.push("bind_approved_plan does not take a service-validated plan (a caller cannot originate one)");
  if (!/fold_operation_fingerprint\(/.test(bind))
    errors.push("bind_approved_plan does not fold the plan/policy into the fingerprint");
  if (!/self\.required_plan = Some\(/.test(bind))
    errors.push("bind_approved_plan does not set the required plan binding");
  // new() must default the plan requirement to None (non-plan-governed operations are not caller-forgeable).
  if (!/required_plan: None,/.test(operation))
    errors.push("new() does not default required_plan to None");

  // ---- 2. ServiceValidatedFacts carries the validated plan fact, absent by default -----------------
  if (!/pub struct ServiceValidatedFacts \{[\s\S]*?approved_plan: Option<crate::plan::ValidatedApprovedPlan>,?[\s\S]*?\}/.test(facts))
    errors.push("ServiceValidatedFacts has no approved_plan fact");
  if (!/#\[derive\([^)]*\bDefault\b[^)]*\)\]\s*pub struct ServiceValidatedFacts/.test(facts))
    errors.push("ServiceValidatedFacts lost Default (approved_plan must default to None)");

  // ---- 3. Reducer enforces the plan for a plan-governed operation, honestly -----------------------
  if (!/if let Some\(required\) = req\.required_plan/.test(reducer))
    errors.push("reducer does not enforce the plan for plan-governed operations");
  const planBlock = /if let Some\(required\) = req\.required_plan[\s\S]*?\n    \};/.exec(reducer);
  const pb = planBlock ? planBlock[0] : "";
  if (!/is_active_for\(required\)/.test(pb))
    errors.push("reducer does not require an ACTIVE fact bound to the required plan");
  if (!/MissingFact::ApprovedPlan/.test(pb))
    errors.push("a missing plan fact is not routed to MissingFact::ApprovedPlan");
  if (!/BindingKind::ApprovedPlan/.test(pb))
    errors.push("a wrong plan fact is not routed to BindingKind::ApprovedPlan");
  if (!/fact\.authorises\(policy\)/.test(pb))
    errors.push("reducer does not evaluate the requested policy against the approved definition");
  if (!/PlanPolicyRefused/.test(pb))
    errors.push("policy refusals are not routed to a precise PlanPolicyRefused classification");
  // Dishonest mapping guard.
  if (/BindingKind::(Project|Phase|Fingerprint)|MissingFact::(Project|Phase)/.test(pb))
    errors.push("a plan failure is dishonestly mapped onto project/phase/fingerprint");

  // ---- 4. Context carries plan binding/status/revision; compare checks them -----------------------
  if (!/pub struct VerifiedExecutionContext \{[\s\S]*?approved_plan: Option<crate::plan::ApprovedPlanBinding>,?[\s\S]*?\}/.test(capability))
    errors.push("VerifiedExecutionContext does not carry the approved-plan binding");
  for (const f of ["approved_plan_status", "approved_plan_status_revision"])
    if (!new RegExp(f + ":\\s*Option").test(capability))
      errors.push("context missing field: " + f);
  for (const cf of ["ApprovedPlan", "ApprovedPlanStatus", "ApprovedPlanStatusRevision"])
    if (!new RegExp("ContextField \\{[\\s\\S]*?\\b" + cf + ",").test(capability))
      errors.push("ContextField::" + cf + " missing");
  const compare = block(capability, "pub fn compare(");
  for (const chk of [
    "self.approved_plan == other.approved_plan",
    "self.approved_plan_status == other.approved_plan_status",
    "self.approved_plan_status_revision == other.approved_plan_status_revision",
  ])
    if (!compare.includes(chk))
      errors.push("permit context comparison does not check: " + chk);

  // ---- 5. Honest error taxonomy -----------------------------------------------------------------
  if (!/MissingFact \{[\s\S]*?\bApprovedPlan,/.test(errorRs)) errors.push("MissingFact::ApprovedPlan not defined");
  if (!/BindingKind \{[\s\S]*?\bApprovedPlan,/.test(errorRs)) errors.push("BindingKind::ApprovedPlan not defined");
  if (!/PlanPolicyRefused\(crate::plan::PlanPolicyRefusal\)/.test(errorRs))
    errors.push("DenialReason::PlanPolicyRefused not defined");

  // ---- 6. No second engine / truthful phase state -----------------------------------------------
  if ((operation.match(/pub enum OperationState/g) || []).length > 1)
    errors.push("a second operation state machine was introduced");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-protected-plan-reducer-permit1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-protected-plan-reducer-permit1a: PASS");
}
