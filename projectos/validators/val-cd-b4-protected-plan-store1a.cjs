"use strict";
// CD-B4-PROTECTED-PLAN-STORE1A — boundary for the Tier-2 approved-plan authority contract in host-core.
//
// A plan candidate is UNTRUSTED; only a normalized+digested definition, owner-approved, becomes a
// protected record. This validator proves the authority contract structurally AND compiles disposable
// external consumers to prove — by rustc — that a candidate/digest/binding/record cannot be forged and
// that the approval mint is unreachable to dependents.
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
  if (!WORK) WORK = scratch.owned("cd-b4-protected-plan-store1a");
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

const NEGATIVES = [
  ["neg_digest_new", "PhaseDefinitionDigest public constructor",
   "use projectos_host_core::PhaseDefinitionDigest;\nfn main() { let _ = PhaseDefinitionDigest::new(\"x\"); }",
   ["E0599", "E0433"]],
  ["neg_digest_literal", "PhaseDefinitionDigest struct literal (private field)",
   "use projectos_host_core::PhaseDefinitionDigest;\nfn main() { let _ = PhaseDefinitionDigest { digest: String::new() }; }",
   ["E0451", "E0560", "E0422"]],
  ["neg_binding_literal", "ApprovedPlanBinding struct literal (private fields)",
   "use projectos_host_core::ApprovedPlanBinding;\nfn f(b: ApprovedPlanBinding) { let _ = &b; }\nfn main() {}\nfn g() -> ApprovedPlanBinding { ApprovedPlanBinding { } }",
   ["E0063", "E0422", "E0451", "due to private fields"]],
  ["neg_record_literal", "ApprovedPlanRecord struct literal (private fields)",
   "use projectos_host_core::ApprovedPlanRecord;\nfn g() -> ApprovedPlanRecord { ApprovedPlanRecord { } }\nfn main() {}",
   ["E0063", "E0422", "E0451", "due to private fields"]],
  ["neg_normalized_literal", "NormalizedPhaseDefinition struct literal (private fields)",
   "use projectos_host_core::NormalizedPhaseDefinition;\nfn g() -> NormalizedPhaseDefinition { NormalizedPhaseDefinition { } }\nfn main() {}",
   ["E0063", "E0422", "E0451", "due to private fields"]],
  ["neg_approve_mint", "crate-private approval mint",
   "fn main() { let _ = projectos_host_core::plan::approve_normalized_definition; }",
   ["E0603", "E0425", "E0433"]],
  ["neg_validated_from_record", "crate-private ValidatedApprovedPlan::from_record",
   "use projectos_host_core::ValidatedApprovedPlan;\nfn main() { let _ = ValidatedApprovedPlan::from_record; }",
   ["E0624", "E0599"]],
  ["neg_candidate_as_authority", "a candidate cannot be passed where a validated plan is required",
   "use projectos_host_core::{PhaseDefinitionCandidate, ValidatedApprovedPlan};\nfn takes(_v: ValidatedApprovedPlan) {}\nfn main() { let c: PhaseDefinitionCandidate = todo!(); takes(c); }",
   ["E0308"]],
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["host-core crate missing: " + CRATE];
  const plan = stripComments(read(path.join(SRC, "plan.rs")));
  const lib = stripComments(read(path.join(SRC, "lib.rs")));

  // ---- 1. Opaque authority types ----------------------------------------------------------------
  for (const t of ["PhaseDefinitionDigest", "NormalizedPhaseDefinition", "ApprovedPlanBinding", "ApprovedPlanRecord", "ValidatedApprovedPlan"]) {
    if (!new RegExp("pub struct " + t + "\\b").test(plan)) errors.push("missing type: " + t);
    // No derive may grant serde/Default on these authority types.
    for (const bad of ["Serialize", "Deserialize", "Default"]) {
      if (new RegExp("derive\\([^)]*\\b" + bad + "\\b[^)]*\\)\\]\\s*pub struct " + t + "\\b").test(plan))
        errors.push(t + " derives " + bad);
    }
  }
  if (/Serialize|Deserialize|serde/.test(plan)) errors.push("plan.rs references serialisation");
  // Redacted Debug on the opaque digest/binding/record/definition.
  for (const t of ["PhaseDefinitionDigest", "NormalizedPhaseDefinition", "ApprovedPlanBinding", "ApprovedPlanRecord", "ValidatedApprovedPlan"]) {
    if (!new RegExp("impl fmt::Debug for " + t + "\\b").test(plan))
      errors.push(t + " has no hand-written redacted Debug");
  }

  // ---- 2. Candidate is untrusted; approval + fact are crate-private ------------------------------
  if (!/UNTRUSTED INPUT/.test(read(path.join(SRC, "plan.rs"))))
    errors.push("PhaseDefinitionCandidate is not documented as untrusted");
  if (!/pub\(crate\) fn approve_normalized_definition/.test(plan))
    errors.push("approve_normalized_definition is not crate-private");
  if (/pub fn approve_normalized_definition/.test(plan))
    errors.push("approve_normalized_definition is public (a caller could mint authority)");
  if (!/pub\(crate\) fn from_record/.test(plan))
    errors.push("ValidatedApprovedPlan::from_record is not crate-private");

  // ---- 3. Digest is the only origin; no public digest constructor -------------------------------
  const digestImpl = block(plan, "impl PhaseDefinitionDigest {");
  if (/\bpub fn /.test(digestImpl))
    errors.push("PhaseDefinitionDigest exposes a public inherent method");
  if (!/pub fn phase_definition_digest\(/.test(plan))
    errors.push("no phase_definition_digest producer");

  // ---- 3b. Collision-resistant SHA-256 digest; FNV forbidden ------------------------------------
  const digestFn = block(plan, "pub fn phase_definition_digest(");
  if (!/use sha2::\{[^}]*Sha256/.test(plan)) errors.push("plan.rs does not use sha2::Sha256");
  if (!/Sha256::(digest|new)/.test(digestFn)) errors.push("the digest is not computed with SHA-256");
  if (/fnv1a|fnv_/i.test(plan)) errors.push("FNV is used in the plan-authority digest (forbidden)");
  // The opaque digest is a fixed 32-byte SHA-256, not a caller hex string.
  if (!/bytes:\s*\[u8;\s*32\]/.test(plan))
    errors.push("PhaseDefinitionDigest is not a fixed 32-byte SHA-256 value");
  // Domain separation + schema version present and folded into the encoding.
  if (!/PROJECTOS:PHASE-DEFINITION:V1/.test(plan)) errors.push("missing digest domain separator");
  if (!/PHASE-DEFINITION-CANONICAL-V1/.test(plan)) errors.push("missing digest schema version");
  if (!/DIGEST_DOMAIN/.test(digestFn) || !/DIGEST_SCHEMA/.test(digestFn))
    errors.push("the digest encoding does not include the domain separator and schema version");
  // Unambiguous, length-prefixed encoding (u32 length prefixes), not delimiter-only concatenation.
  if (!/to_be_bytes\(\)/.test(plan) || !/fn put\(/.test(plan))
    errors.push("the canonical encoding is not length-prefixed");
  // Every authority-relevant field must enter the digest encoding.
  for (const field of [
    '"plan"', '"version"', '"project"', '"environment"', '"phase"', '"type"', '"scope"',
    '"path_boundary"', '"allowed"', '"prohibited"', '"dependencies"', '"predecessors"',
    '"repository_policy"', '"provider_policy"', '"effect_policy"', '"rollback"', '"shutdown"',
    '"disconnect"', '"residue"',
  ]) {
    if (!digestFn.includes(field))
      errors.push("digest encoding omits an authority field: " + field);
  }
  // The full digest is never rendered: Debug is the redacted marker, no hex-format of the bytes.
  if (!/PhaseDefinitionDigest\(\[REDACTED\]\)/.test(plan))
    errors.push("PhaseDefinitionDigest Debug is not redacted");

  // ---- 4. Normalization rejects the required defects (honest fail-closed) ------------------------
  const normBody = block(plan, "pub fn normalize_candidate(");
  for (const need of [
    "ContradictoryActions",
    "AmbiguousPathBoundary",
    "DependencyCycle",
    "PredecessorCycle",
    "EnvironmentAmbiguous",
  ]) {
    if (!new RegExp("NormalizeError::" + need).test(normBody))
      errors.push("normalize_candidate does not reject " + need);
  }

  // ---- 4b. Reload recomputes the digest (a stored digest is never trusted) ----------------------
  if (!/pub\(crate\) fn revalidate_stored_record/.test(plan))
    errors.push("no crate-private reload/recompute path");
  const reload = block(plan, "pub(crate) fn revalidate_stored_record(");
  if (!/phase_definition_digest\(/.test(reload))
    errors.push("the reload path does not RECOMPUTE the digest");
  if (!/eq_ignore_ascii_case\(stored_digest_hex\)|recomputed_hex/.test(reload))
    errors.push("the reload path does not compare the recomputed digest to the stored one");
  if (!/return None|\.is_none|None ;|None\n/.test(reload) && !/None/.test(reload))
    errors.push("the reload path does not fail closed on a digest mismatch");
  // The active-binding check requires BOTH active status and the exact binding.
  const active = block(plan, "pub fn is_active_for(");
  if (!/ApprovedPlanStatus::Active/.test(active) || !/self\.binding == \*required/.test(active))
    errors.push("is_active_for does not require active status AND the exact binding");
  // The validated fact carries the normalized definition (for scope/action enforcement).
  if (!/pub struct ValidatedApprovedPlan \{[\s\S]*?definition: NormalizedPhaseDefinition,?[\s\S]*?\}/.test(plan))
    errors.push("ValidatedApprovedPlan does not carry the normalized definition");
  if (!/pub fn allows_action\(/.test(plan) || !/pub fn prohibits_action\(/.test(plan))
    errors.push("no allowed/prohibited action enforcement accessors");

  // ---- 4c. Journaled Intent/Commit store: incomplete intent is never authority ------------------
  if (!/pub struct ApprovedPlanJournal/.test(plan)) errors.push("no ApprovedPlanJournal");
  if (!/fn begin_write_intent/.test(plan) || !/fn commit\(/.test(plan) || !/fn recover\(/.test(plan))
    errors.push("journal lacks Intent/Commit/recover mechanics");
  const reloadFn = block(plan, "pub(crate) fn reload_and_validate(");
  if (!/if !dto\.committed/.test(reloadFn))
    errors.push("reload does not refuse an uncommitted (Intent-only) entry");
  if (!/schema_version != PLAN_SCHEMA_VERSION/.test(reloadFn))
    errors.push("reload does not validate the schema version");
  if (!/normalize_candidate\(&dto\.candidate\)/.test(reloadFn))
    errors.push("reload does not re-normalize the untrusted candidate");
  if (!/revalidate_stored_record\(/.test(reloadFn))
    errors.push("reload does not recompute + revalidate the stored record");
  if (!/is_active_for\(required\)/.test(reloadFn))
    errors.push("reload does not bind the fact to the required active binding");
  // recover drops uncommitted entries (fail-closed after interruption).
  const recover = block(plan, "pub(crate) fn recover(");
  if (!/retain\(\|e\| e\.committed\)/.test(recover))
    errors.push("recover does not drop uncommitted entries");
  // The DTO is untrusted; it must not be an authority type (plain public fields, no opaque binding).
  if (!/pub struct PlanDurableDto/.test(plan)) errors.push("no durable plan DTO");
  if (/impl\s+\w+\s+for\s+PlanDurableDto[\s\S]*?ValidatedApprovedPlan/.test(plan))
    errors.push("a public DTO->authority conversion exists");

  // ---- 5. Exports present -----------------------------------------------------------------------
  if (!/pub mod plan;/.test(lib)) errors.push("plan module not exported");
  for (const t of ["ApprovedPlanBinding", "ApprovedPlanReader", "PhaseDefinitionDigest", "normalize_candidate"]) {
    if (!new RegExp("\\b" + t + "\\b").test(lib)) errors.push("lib does not export " + t);
  }

  // ---- 6. Compile proofs ------------------------------------------------------------------------
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
      /* locked temp artefact is not a validation failure */
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
    errs.forEach((e) => console.error("[val-cd-b4-protected-plan-store1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-protected-plan-store1a: PASS");
}
