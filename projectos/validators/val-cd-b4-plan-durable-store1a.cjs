"use strict";
// CD-B4-PROTECTED-PLAN-DURABLE-STORE1A — the durable approved-plan adapter is a NON-AUTHORITATIVE
// wrapper that REUSES the accepted durable store + persistence DTO + core reload path. This validator
// proves structurally that it introduces no second storage framework, no second journal state machine,
// no second cryptographic framing, and no authority engine; that the DTO stays untrusted; that
// authority is derived only via the single public core bridge; and that EXECUTION_READY / installation
// authority are not falsely asserted.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
function exists(p) {
  return fs.existsSync(p);
}

function run() {
  const errors = [];
  const adapterDir = path.join(HOST, "plan-durable-store");
  if (!exists(adapterDir)) return ["plan-durable-store crate missing"];

  const adapter = stripComments(read(path.join(adapterDir, "src", "adapter.rs")));
  const convert = stripComments(read(path.join(adapterDir, "src", "convert.rs")));
  const libAdapter = read(path.join(adapterDir, "src", "lib.rs"));
  const cargo = read(path.join(adapterDir, "Cargo.toml"));
  const planRs = stripComments(read(path.join(HOST, "core", "src", "plan.rs")));
  const coreLib = read(path.join(HOST, "core", "src", "lib.rs"));
  const persistPlanRaw = read(path.join(HOST, "persistence", "src", "plan_record.rs"));
  const persistPlan = stripComments(persistPlanRaw);
  const durableJournal = stripComments(
    read(path.join(HOST, "windows-durable-protected-store", "src", "journal.rs"))
  );

  // ---- 1. Reuse the accepted durable store; no new storage engine -------------------------------
  if (!/projectos-host-windows-durable-protected-store\s*=/.test(cargo))
    errors.push("adapter does not depend on the accepted durable store");
  if (!/DurableProtectedStore/.test(adapter))
    errors.push("adapter does not reuse DurableProtectedStore");
  // No re-implemented framing / journal state machine / cryptographic framing inside the adapter.
  if (/fn\s+sha256\s*\(|struct\s+\w*Journal\w*Envelope|fn\s+encode\s*\(.*FrameKind|enum\s+FrameKind/.test(adapter + convert))
    errors.push("adapter reimplements framing/journal (must reuse the durable store)");
  if (/\bsha2\b|use sha2/.test(cargo)) errors.push("adapter adds its own SHA-256 (must reuse durable-store framing)");
  if (/\bserde\b\s*=/.test(cargo)) errors.push("adapter adds its own serde (DTO framing belongs to persistence)");

  // ---- 2. Authority ONLY via the single public core bridge --------------------------------------
  if (!/validate_durable_plan/.test(adapter))
    errors.push("adapter does not derive authority via core validate_durable_plan");
  if (!/pub fn validate_durable_plan/.test(planRs))
    errors.push("core validate_durable_plan is not public");
  if (!/reload_and_validate\(dto, required\)/.test(planRs))
    errors.push("validate_durable_plan does not delegate to the accepted reload_and_validate");
  if (!/pub use plan::\{[^}]*validate_durable_plan/.test(coreLib.replace(/\n/g, " ")))
    errors.push("core does not export validate_durable_plan");
  // The adapter must NOT construct a ValidatedApprovedPlan itself (no authority engine).
  if (/ValidatedApprovedPlan\s*\{/.test(adapter + convert))
    errors.push("adapter constructs a ValidatedApprovedPlan directly (authority engine duplication)");

  // ---- 3. Untrusted DTO; recompute owned by core ------------------------------------------------
  if (!/pub struct PlanRecordDto/.test(persistPlan)) errors.push("no PlanRecordDto contract");
  if (!/deny_unknown_fields/.test(persistPlan)) errors.push("PlanRecordDto is not strict (deny_unknown_fields)");
  for (const bad of ["Permit", "Authenticated", "Lease", "ValidatedApprovedPlan"]) {
    if (new RegExp("pub\\s+\\w+:\\s*" + bad).test(persistPlan))
      errors.push("PlanRecordDto carries an authority field: " + bad);
  }
  if (!/for comparison ONLY|never trusted as authority/.test(persistPlanRaw))
    errors.push("stored digest is not documented as comparison-only");
  // The durable store validates the Plan family (reuse, single validation point).
  if (!/TargetFamilyDto::Plan\s*=>\s*PlanRecordDto::parse_json/.test(durableJournal))
    errors.push("durable store does not validate the Plan family via PlanRecordDto");

  // ---- 4. Intent/Commit + committed gate --------------------------------------------------------
  if (!/fn begin_intent/.test(adapter) || !/fn commit\(/.test(adapter))
    errors.push("adapter lacks Intent/Commit operations");
  if (!/if dto\.committed/.test(adapter))
    errors.push("begin_intent does not refuse a committed payload");
  if (!/commit without a durable intent|record_revision\(&id\)\?\s*else/.test(adapter))
    errors.push("commit does not require a prior durable intent");

  // ---- 4b. Status monotonicity + terminal enforcement (revision rollback fails closed) ----------
  if (!/dto\.status != PlanStatusDto::Active/.test(adapter) || !/TerminalStatus/.test(adapter))
    errors.push("adapter does not refuse transitions from a terminal status");
  if (!/new_status_revision <= dto\.status_revision/.test(adapter) || !/StatusRevisionRollback/.test(adapter))
    errors.push("adapter does not enforce strict status-revision monotonicity");

  // ---- 4c. No second journal state machine; errors payload-free ---------------------------------
  const errorRs = read(path.join(adapterDir, "src", "error.rs"));
  if (/enum\s+\w*Journal\w*|struct\s+\w*Journal\w*Envelope|Prepared|into_committed/.test(adapter + convert))
    errors.push("adapter defines a second journal state machine");
  // Every PlanStoreError variant is payload-free except the bounded DurableStoreError kind wrapper.
  const variantWithData = /^\s*[A-Z]\w*\((?!DurableStoreError\))/m.test(stripComments(errorRs));
  if (variantWithData) errors.push("a PlanStoreError variant carries a payload (must be redacted/bounded)");

  // ---- 5. No production/authority overclaim -----------------------------------------------------
  if (/EXECUTION_READY\s*=\s*true|installation.{0,20}Authoris(ed|e)\b/i.test(adapter + libAdapter))
    errors.push("adapter overclaims execution/installation authority");
  if (!/NotAuthorised|installation authority remains/.test(libAdapter))
    errors.push("adapter docs do not state NotAuthorised posture");
  if (!/forbid\(unsafe_code\)/.test(libAdapter)) errors.push("adapter does not forbid unsafe");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-plan-durable-store1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-plan-durable-store1a: PASS");
}
