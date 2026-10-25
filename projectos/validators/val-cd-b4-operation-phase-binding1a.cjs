"use strict";
// CD-B4-OPERATION-PHASE-BINDING1A — boundary for the Tier-1 operation-bound phase identity in host-core.
//
// PhaseId is the one authoritative phase value: opaque, service-minted, operation-bound, with no public
// constructor. This validator proves the source structure AND compiles disposable external consumers to
// prove — by rustc — that no dependent can originate a PhaseId or phase-bound permit.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
// Cargo is resolved to ONE ABSOLUTE EXECUTABLE, never a bare command name. The governed daemon
// is launched with no PATH at all, so spawning cargo by name could not build this fixture there:
// it died on ENOENT with an empty error, and this validator then reported a failure about the
// CODE that was really a failure about the ENVIRONMENT. See lib/bound-cargo.cjs for the
// resolution order and for why nothing here reintroduces an ambient search path.
const cargo = require("./lib/bound-cargo.cjs").boundCargo(ROOT);
const CRATE = path.join(ROOT, "projectos", "host", "core");
const CRATE_TOML = CRATE.replace(/\\/g, "/");
const SRC = path.join(CRATE, "src");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
/** Extract a brace-balanced block starting at `header` (e.g. "impl PhaseId {"). */
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

let WORK = null;
function workdir() {
  if (!WORK) WORK = scratch.owned("cd-b4-operation-phase-binding1a");
  return WORK;
}
function compileConsumer(name, body) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]",
      "",
      "[package]",
      'name = "' + name.replace(/[^a-z0-9_]/g, "_") + '"',
      'version = "0.0.0"',
      'edition = "2021"',
      "publish = false",
      "",
      "[dependencies]",
      'projectos-host-core = { path = "' + CRATE_TOML + '" }',
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = cargo(["build", "--offline", "--quiet"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

/** Every one MUST fail to compile, for one of the listed reasons. */
const NEGATIVES = [
  ["neg_phase_new", "PhaseId public constructor",
   "use projectos_host_core::PhaseId;\nfn main() { let _ = PhaseId::new(\"x\"); }",
   ["E0599", "E0433"]],
  ["neg_phase_from_string", "PhaseId from String",
   "use projectos_host_core::PhaseId;\nfn main() { let _: PhaseId = String::from(\"x\").into(); }",
   ["E0277", "E0599"]],
  ["neg_phase_from_str", "PhaseId from &str",
   "use projectos_host_core::PhaseId;\nfn main() { let _: PhaseId = \"x\".into(); }",
   ["E0277"]],
  ["neg_phase_from_num", "PhaseId from a number",
   "use projectos_host_core::PhaseId;\nfn main() { let _: PhaseId = 7u64.into(); }",
   ["E0277"]],
  ["neg_phase_parse", "PhaseId parse",
   "use projectos_host_core::PhaseId;\nfn main() { let _: PhaseId = \"x\".parse().unwrap(); }",
   ["E0277", "E0599"]],
  ["neg_phase_default", "PhaseId Default",
   "use projectos_host_core::PhaseId;\nfn main() { let _: PhaseId = Default::default(); }",
   ["E0277", "E0599"]],
  ["neg_phase_mint", "PhaseId::mint (crate-private)",
   "use projectos_host_core::PhaseId;\nuse projectos_host_core::{EnvironmentId, ProjectId, OperationRef};\nfn main() {\n    let _ = PhaseId::mint(&ProjectId::new(\"p\").unwrap(), &EnvironmentId::new(\"e\").unwrap(), todo!(), &OperationRef::new(\"o\").unwrap());\n}",
   ["E0624", "E0599"]],
  ["neg_phase_literal", "PhaseId struct literal (private field)",
   "use projectos_host_core::PhaseId;\nfn main() { let _ = PhaseId { digest: String::new() }; }",
   ["E0451", "E0560", "E0422"]],
  ["neg_binding_literal_needs_phase", "OperationBinding literal cannot supply a phase",
   "use projectos_host_core::{OperationBinding, EnvironmentId, OperationFingerprint, OperationName, ProjectId, ProviderId, ReleaseId};\nfn main() {\n    let _ = OperationBinding {\n        project: ProjectId::new(\"p\").unwrap(),\n        environment: EnvironmentId::new(\"e\").unwrap(),\n        provider: ProviderId::new(\"v\").unwrap(),\n        operation: OperationName::new(\"o\").unwrap(),\n        fingerprint: OperationFingerprint::new(\"f\").unwrap(),\n        release: ReleaseId::new(\"r\"),\n    };\n}",
   ["E0063"]],
  ["neg_context_phase_read", "reading the private context phase field",
   "use projectos_host_core::VerifiedExecutionContext;\nfn f(c: &VerifiedExecutionContext) { let _ = &c.phase; }\nfn main() {}",
   ["E0616"]],
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["host-core crate missing: " + CRATE];

  const phase = stripComments(read(path.join(SRC, "phase.rs")));
  const operation = stripComments(read(path.join(SRC, "operation.rs")));
  const approval = stripComments(read(path.join(SRC, "approval.rs")));
  const facts = stripComments(read(path.join(SRC, "facts.rs")));
  const capability = stripComments(read(path.join(SRC, "capability.rs")));
  const reducer = stripComments(read(path.join(SRC, "reducer.rs")));
  const errorRs = stripComments(read(path.join(SRC, "error.rs")));
  const lib = stripComments(read(path.join(SRC, "lib.rs")));

  // ---- 1. Exactly one canonical PhaseId, opaque, no public/foreign constructor -----------------
  if ((lib.match(/pub use phase::\{[^}]*PhaseId/g) || []).length !== 1)
    errors.push("PhaseId is not exported exactly once from phase");
  if (!/pub struct PhaseId \{\s*digest: String,?\s*\}/.test(phase))
    errors.push("PhaseId is not an opaque single-private-field struct");
  if (/#\[derive\([^)]*\bDefault\b[^)]*\)\]\s*pub struct PhaseId/.test(phase))
    errors.push("PhaseId derives Default");
  // Foreign-impl construction paths are checked against the whole file (they name PhaseId).
  for (const bad of [
    /impl\s+Default\s+for\s+PhaseId/,
    /impl\s+From<[^>]*>\s+for\s+PhaseId/,
    /impl\s+FromStr\s+for\s+PhaseId/,
    /impl\s+std::str::FromStr\s+for\s+PhaseId/,
    /Serialize|Deserialize|serde/,
  ]) {
    if (bad.test(phase)) errors.push("PhaseId exposes a forbidden construction path: " + bad);
  }
  // Inherent-method checks are scoped to PhaseId's own impl block, so PhaseReference::new does not
  // false-trigger.
  const phaseImpl = block(phase, "impl PhaseId {");
  // No PUBLIC inherent method at all may originate or expose a PhaseId — the only originator is the
  // crate-private `mint`. This rejects `pub fn new`, `pub fn synthetic`, a fixture minter, etc.
  if (/\bpub fn /.test(phaseImpl))
    errors.push("PhaseId's inherent impl exposes a public method (only pub(crate) mint is allowed)");
  // Mint is crate-private and the only originator.
  if (!/pub\(crate\) fn mint\(/.test(phase))
    errors.push("PhaseId::mint is not crate-private");
  if (/pub fn mint\(/.test(phase)) errors.push("PhaseId::mint is public");
  // Redacted Debug; no Display leaking the digest.
  if (!/PhaseId\(\[REDACTED\]\)/.test(phase)) errors.push("PhaseId Debug is not redacted");
  if (/impl\s+fmt::Display\s+for\s+PhaseId/.test(phase))
    errors.push("PhaseId implements Display");

  // ---- 2. PhaseReference is explicitly non-authoritative ---------------------------------------
  if (!/NON-AUTHORITATIVE/.test(read(path.join(SRC, "phase.rs"))))
    errors.push("PhaseReference is not documented as non-authoritative");
  if (!/pub struct PhaseReference/.test(phase))
    errors.push("PhaseReference type missing");

  // ---- 3. Operation-bound issuance (Option A): mint folds the OperationRef ----------------------
  const mintBody = /pub\(crate\) fn mint\([\s\S]*?\n    \}/.exec(phase);
  if (!mintBody || !/operation_ref/.test(mintBody[0]))
    errors.push("PhaseId::mint is not operation-bound (no operation_ref)");
  if (!/PhaseId::mint\([\s\S]*?&operation_ref/.test(operation))
    errors.push("InternalOperationRecord::new does not mint an operation-bound phase");

  // ---- 4. Fingerprint folds the phase ----------------------------------------------------------
  if (!/fn derive_operation_fingerprint\(/.test(phase))
    errors.push("no phase-bound fingerprint derivation");
  if (!/derive_operation_fingerprint\(&inputs\.fingerprint, &phase\)/.test(operation))
    errors.push("new() does not fold the phase into the fingerprint");

  // ---- 5. Ownership + integration --------------------------------------------------------------
  if (!/pub struct OperationBinding \{[\s\S]*?pub phase: PhaseId,?[\s\S]*?\}/.test(operation))
    errors.push("OperationBinding does not include phase");
  if (!/pub struct VerifiedApproval \{[\s\S]*?pub phase: PhaseId,?[\s\S]*?\}/.test(approval))
    errors.push("VerifiedApproval is not phase-bound");
  if (!/pub struct ServiceValidatedFacts \{[\s\S]*?pub phase: Option<crate::phase::PhaseId>,?[\s\S]*?\}/.test(facts))
    errors.push("ServiceValidatedFacts carries no phase-binding proof");
  if (!/pub struct VerifiedExecutionContext \{[\s\S]*?phase: crate::phase::PhaseId,?[\s\S]*?\}/.test(capability))
    errors.push("VerifiedExecutionContext does not include phase");
  if (!/pub enum ContextField \{[\s\S]*?\bPhase,[\s\S]*?\}/.test(capability))
    errors.push("ContextField::Phase missing");
  if (!/self\.phase == other\.phase, F::Phase/.test(capability))
    errors.push("context comparison does not check phase");

  // ---- 6. Reducer honest fail-closed routing ---------------------------------------------------
  if (!/MissingFact::Phase/.test(reducer))
    errors.push("reducer does not route a missing phase proof to MissingFact::Phase");
  if (!/BindingKind::Phase/.test(reducer))
    errors.push("reducer does not route a wrong phase proof to BindingKind::Phase");
  if (!/BindingKind \{[\s\S]*?\bPhase,[\s\S]*?\}/.test(errorRs))
    errors.push("BindingKind::Phase not defined");
  if (!/MissingFact \{[\s\S]*?\bPhase,[\s\S]*?\}/.test(errorRs))
    errors.push("MissingFact::Phase not defined");
  // Honest: the phase check must NOT be mapped onto Project/Fingerprint/Environment.
  const phaseCheck = /match &facts\.phase \{[\s\S]*?\n    \}/.exec(reducer);
  if (!phaseCheck)
    errors.push("no explicit facts.phase match in the reducer");
  else if (/BindingKind::(Project|Fingerprint|Environment)|MissingFact::(Project|Authority)/.test(phaseCheck[0]))
    errors.push("phase failure dishonestly mapped to a non-phase classification");
  // Approval phase check present.
  if (!/a\.phase != req\.binding\.phase/.test(reducer))
    errors.push("reducer does not check the approval phase");
  // Permit context carries the phase.
  if (!/phase: req\.binding\.phase\.clone\(\)/.test(reducer))
    errors.push("assembled permit context does not carry the phase");

  // ---- 7. Tier boundary / no plan authority ----------------------------------------------------
  for (const bad of [
    /plan.?version/i,
    /PhaseDefinitionDigest/,
    /predecessor/i,
    /\.projectops/,
    /master-plan|execution-plan/,
  ]) {
    if (bad.test(phase)) errors.push("phase.rs leaks a Tier-2 plan-authority concept: " + bad);
  }
  // No second operation state machine, no plan file trust anywhere in the touched surface.
  if ((operation.match(/pub enum OperationState/g) || []).length > 1)
    errors.push("a second operation state machine was introduced");

  // ---- 8. Compile proofs -----------------------------------------------------------------------
  const pos = compileConsumer(
    "pos_phase_positive",
    "use projectos_host_core::{InternalOperationRecord, OperationInputs, PhaseReference, RecordPolicy, ResumePolicy, ExpiryBoundary, InstallationId, RepositoryRef, ReleaseId};\nuse projectos_host_core::{EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId};\nfn main() {\n    let r = InternalOperationRecord::new(\n        OperationRef::new(\"op-1\").unwrap(),\n        OperationInputs { project: ProjectId::new(\"p\").unwrap(), environment: EnvironmentId::new(\"e\").unwrap(), provider: ProviderId::new(\"v\").unwrap(), operation: OperationName::new(\"o\").unwrap(), fingerprint: OperationFingerprint::new(\"f\").unwrap(), release: ReleaseId::new(\"r\") },\n        &PhaseReference::new(\"phase-1\").unwrap(),\n        RepositoryRef::new(\"repo\"), InstallationId::new(\"inst\"),\n        RecordPolicy { approval_required: false, credential_required: false, resume_policy: ResumePolicy::NoResume, operation_expiry: ExpiryBoundary(1) },\n    );\n    // A dependent may READ the minted phase but can never originate one.\n    let _ = r.binding.phase();\n}"
  );
  if (!pos.ok)
    errors.push("the positive consumer cannot mint a phase through the service path: " + pos.out.slice(-400));

  for (const [name, why, body, codes] of NEGATIVES) {
    const r = compileConsumer(name, body);
    if (r.ok) {
      errors.push("FORGERY POSSIBLE — " + why + " (" + name + " compiled)");
      continue;
    }
    if (!codes.some((c) => r.out.includes(c))) {
      const seen = (r.out.match(/error\[E\d+\]/g) || ["<no code>"]).slice(0, 3).join(",");
      errors.push(name + " failed for the WRONG reason: expected " + codes.join("/") + ", saw " + seen);
    }
  }

  return errors;
}

function cleanup() {
  if (WORK && fs.existsSync(WORK)) {
    try {
      fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a locked build artefact in the OS temp dir is not a validation failure */
    }
  }
}

module.exports = {
  run: () => {
    try {
      return run();
    } finally {
      cleanup();
    }
  },
};

if (require.main === module) {
  const errs = module.exports.run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-operation-phase-binding1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-operation-phase-binding1a: PASS");
}
