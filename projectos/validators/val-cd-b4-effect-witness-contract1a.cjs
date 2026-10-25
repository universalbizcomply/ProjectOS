"use strict";
// CD-B4-EFFECT-WITNESS-CONTRACT1A — boundary for the opaque effect-witness and typed-grant contract.
//
// The legacy OperationGate is a caller-writable POLICY DECLARATION: public fields, unit enums, Copy.
// These witnesses are the opposite, and this validator proves it by COMPILING disposable external
// consumers — text alone cannot distinguish "a caller may not" from "a caller cannot".
//
// It also proves the negative space: no production producer, no live capability, no Windows API, no
// machine-effect route, and no path from the legacy gate into a grant.
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
const CRATE = path.join(ROOT, "projectos", "host", "host-authority");
const SRC = path.join(CRATE, "src");
const CRATE_TOML = CRATE.replace(/\\/g, "/");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
// A forbidden NAME inside a string literal is an assertion of absence, not a use.
function stripStrings(src) {
  return src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

let WORK = null;
function workdir() {
  if (!WORK) WORK = scratch.owned("cd-b4-effect-witness-contract1a");
  return WORK;
}

/** Compile a disposable external consumer of host-authority. */
function compileConsumer(name, features, body, run) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat = features.length
    ? ", features = [" + features.map((f) => '"' + f + '"').join(", ") + "]"
    : "";
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
      'projectos-host-authority = { path = "' + CRATE_TOML + '"' + feat + " }",
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const args = run ? ["run", "--offline", "--quiet"] : ["build", "--offline", "--quiet"];
  const r = cargo(args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const FIX = ["effect-witness-fixtures"];

const MACRO_GENERATED = new Set([
  "VerifiedOwnerApprovalWitness",
  "VerifiedElevationWitness",
  "VerifiedRepositoryBaselineWitness",
  "VerifiedExecutableIdentityWitness",
  "ScmEffectGrant",
  "IpcEffectGrant",
  "InstanceObservationEffectGrant",
]);
function isMacroGenerated(t) {
  return MACRO_GENERATED.has(t);
}

/** The full contract path, from an external consumer, under the fixture graph only. */
const POSITIVE = [
  "use projectos_host_authority::effect_witness::{",
  "    compose_verified_authorisation, synthetic_witnesses, EffectAuthorisationClassification,",
  "    SyntheticEffectContext,",
  "};",
  "",
  "fn redacted(rendered: String) {",
  "    assert!(rendered.contains(\"[REDACTED]\"), \"not redacted: {rendered}\");",
  "    // No raw identity may survive into the rendered form.",
  "    assert!(!rendered.chars().any(|c| c.is_ascii_digit()), \"identity leaked: {rendered}\");",
  "}",
  "",
  "fn main() {",
  "    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());",
  "    // Redaction proved by BEHAVIOUR, on the real values, from outside the crate.",
  "    redacted(format!(\"{o:?}\"));",
  "    redacted(format!(\"{e:?}\"));",
  "    redacted(format!(\"{r:?}\"));",
  "    redacted(format!(\"{x:?}\"));",
  "    let t = compose_verified_authorisation(o, e, r, x);",
  "    assert_eq!(t.classification(), EffectAuthorisationClassification::Composed);",
  "    redacted(format!(\"{t:?}\"));",
  "    let attempt = t.into_authorised_attempt_grant().expect(\"composes\");",
  "    redacted(format!(\"{attempt:?}\"));",
  "    let (scm, ipc, obs) = attempt.into_typed_grants();",
  "    redacted(format!(\"{scm:?}\"));",
  "    redacted(format!(\"{ipc:?}\"));",
  "    redacted(format!(\"{obs:?}\"));",
  "    assert!(ipc.shares_context_with_scm(&scm));",
  "    assert!(obs.shares_context_with_scm(&scm));",
  '    println!("EFFECT_WITNESS_CONTRACT_OK");',
  "}",
].join("\n");

/** A struct literal whose fields all come from `..`, so the ONLY thing under test is field privacy. */
function ctorBody(module, type) {
  return (
    "use projectos_host_authority::" + module + "::" + type + ";\n" +
    "fn main() { let _ = " + type + " { ..todo!() }; }\n"
  );
}

/** Every one MUST fail to compile, and MUST fail with one of the listed error codes. */
const NEGATIVES = [
  ["neg_owner_witness_ctor", FIX, "direct owner-witness construction",
   ctorBody("effect_witness", "VerifiedOwnerApprovalWitness"), ["E0451"]],
  ["neg_elevation_witness_ctor", FIX, "direct elevation-witness construction",
   ctorBody("effect_witness", "VerifiedElevationWitness"), ["E0451"]],
  ["neg_repo_witness_ctor", FIX, "direct repository-witness construction",
   ctorBody("effect_witness", "VerifiedRepositoryBaselineWitness"), ["E0451"]],
  ["neg_exe_witness_ctor", FIX, "direct executable-witness construction",
   ctorBody("effect_witness", "VerifiedExecutableIdentityWitness"), ["E0451"]],
  ["neg_transition_ctor", FIX, "direct transition construction",
   ctorBody("effect_witness", "VerifiedEffectAuthorisationTransition"), ["E0451"]],
  ["neg_attempt_grant_ctor", FIX, "direct attempt-grant construction",
   ctorBody("effect_grant", "AuthorisedProofAttemptGrant"), ["E0451"]],
  ["neg_typed_grant_ctor", FIX, "direct typed-grant construction",
   ctorBody("effect_grant", "ScmEffectGrant"), ["E0451"]],
  ["neg_witness_clone", FIX, "witness Clone",
   "use projectos_host_authority::effect_witness::{synthetic_witnesses, SyntheticEffectContext};\nfn main() { let (o, _, _, _) = synthetic_witnesses(SyntheticEffectContext::valid()); let _ = o.clone(); }",
   ["E0599"]],
  ["neg_witness_copy", FIX, "witness Copy (use after move)",
   "use projectos_host_authority::effect_witness::{compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext};\nfn main() {\n    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let (o2, e2, r2, x2) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let _ = compose_verified_authorisation(o, e, r, x);\n    let _ = compose_verified_authorisation(o, e2, r2, x2);\n}",
   ["E0382"]],
  ["neg_grant_clone", FIX, "grant Clone",
   "use projectos_host_authority::effect_witness::{compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext};\nfn main() {\n    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let g = compose_verified_authorisation(o, e, r, x).into_authorised_attempt_grant().unwrap();\n    let _ = g.clone();\n}",
   ["E0599"]],
  ["neg_attempt_default", FIX, "attempt-grant Default",
   "use projectos_host_authority::effect_grant::AuthorisedProofAttemptGrant;\nfn main() { let _: AuthorisedProofAttemptGrant = Default::default(); }",
   ["E0277","E0599"]],
  ["neg_split_twice", FIX, "splitting an attempt grant twice",
   "use projectos_host_authority::effect_witness::{compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext};\nfn main() {\n    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let g = compose_verified_authorisation(o, e, r, x).into_authorised_attempt_grant().unwrap();\n    let _first = g.into_typed_grants();\n    let _second = g.into_typed_grants();\n}",
   ["E0382"]],
  ["neg_transition_twice", FIX, "using a consumed transition twice",
   "use projectos_host_authority::effect_witness::{compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext};\nfn main() {\n    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let t = compose_verified_authorisation(o, e, r, x);\n    let _a = t.into_authorised_attempt_grant();\n    let _b = t.into_authorised_attempt_grant();\n}",
   ["E0382"]],
  ["neg_grant_substitution", FIX, "one typed grant passed as another type",
   "use projectos_host_authority::effect_grant::{IpcEffectGrant, ScmEffectGrant};\nfn takes_scm(_g: ScmEffectGrant) {}\nfn main() { let g: IpcEffectGrant = todo!(); takes_scm(g); }",
   ["E0308"]],
  ["neg_thread_transfer", FIX, "grant crossing a thread",
   "use projectos_host_authority::effect_witness::{compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext};\nfn main() {\n    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let g = compose_verified_authorisation(o, e, r, x).into_authorised_attempt_grant().unwrap();\n    std::thread::spawn(move || { let _ = g.into_typed_grants(); });\n}",
   ["E0277"]],
  ["neg_default_graph_fixtures", [], "fixture witnesses in the DEFAULT graph",
   "fn main() { let _ = projectos_host_authority::effect_witness::synthetic_witnesses; }",
   ["E0425","E0433"]],
  ["neg_default_graph_context", [], "fixture context in the DEFAULT graph",
   "use projectos_host_authority::effect_witness::SyntheticEffectContext;\nfn main() { let _ = SyntheticEffectContext::valid(); }",
   ["E0432","E0433"]],
  // A per-FIELD proof. `{ ..todo!() }` alone is not enough: one remaining private field keeps
  // emitting E0451 even after another field is made public, so each field is also read directly.
  ["neg_witness_field_read", FIX, "reading a witness's binding FIELD",
   "use projectos_host_authority::effect_witness::{synthetic_witnesses, SyntheticEffectContext};\nfn main() { let (o, _, _, _) = synthetic_witnesses(SyntheticEffectContext::valid()); let _ = &o.binding; }",
   ["E0616"]],
  ["neg_grant_field_read", FIX, "reading a typed grant's binding FIELD",
   "use projectos_host_authority::effect_witness::{compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext};\nfn main() {\n    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let (scm, _, _) = compose_verified_authorisation(o, e, r, x).into_authorised_attempt_grant().unwrap().into_typed_grants();\n    let _ = &scm.binding;\n}",
   ["E0616"]],
  ["neg_attempt_field_read", FIX, "reading the attempt grant's binding FIELD",
   "use projectos_host_authority::effect_witness::{compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext};\nfn main() {\n    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());\n    let g = compose_verified_authorisation(o, e, r, x).into_authorised_attempt_grant().unwrap();\n    let _ = &g.binding;\n}",
   ["E0616"]],
  ["neg_binding_read", FIX, "reading the private binding",
   "use projectos_host_authority::effect_witness::{synthetic_witnesses, SyntheticEffectContext};\nfn main() { let (o, _, _, _) = synthetic_witnesses(SyntheticEffectContext::valid()); let _ = o.binding(); }",
   ["E0624","E0599"]],
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["host-authority crate missing: " + CRATE];

  // ---- 1. Feature containment -----------------------------------------------------------------
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/effect-witness-fixtures\s*=\s*\[\]/.test(toml))
    errors.push("effect-witness-fixtures is not a standalone dependency-free feature");
  if (/^\s*default\s*=\s*\[[^\]]*effect-witness-fixtures/m.test(toml))
    errors.push("a default feature enables the witness fixtures");
  const liveFeat = (toml.match(/windows-pipe-security-runtime\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  const tfFeat = (toml.match(/^test-fixtures\s*=\s*\[[\s\S]*?\]/m) || [""])[0];
  if (/effect-witness-fixtures/.test(liveFeat) || /effect-witness-fixtures/.test(tfFeat))
    errors.push("an existing feature implies the witness fixtures");

  // ---- 2. Opacity, traits, redaction ----------------------------------------------------------
  const witness = stripComments(read(path.join(SRC, "effect_witness.rs")));
  const grant = stripComments(read(path.join(SRC, "effect_grant.rs")));
  const both = witness + "\n" + grant;

  const TYPES = [
    "VerifiedOwnerApprovalWitness",
    "VerifiedElevationWitness",
    "VerifiedRepositoryBaselineWitness",
    "VerifiedExecutableIdentityWitness",
    "VerifiedEffectAuthorisationTransition",
    "AuthorisedProofAttemptGrant",
    "ScmEffectGrant",
    "IpcEffectGrant",
    "InstanceObservationEffectGrant",
  ];
  for (const t of TYPES) {
    if (!both.includes(t)) errors.push("missing contract type: " + t);
    // No derive may grant Clone/Copy/Default/serde on these types.
    const derived = new RegExp("#\\[derive\\(([^)]*)\\)\\]\\s*pub struct " + t + "\\b").exec(both);
    if (derived) errors.push(t + " derives traits (must be opaque): " + derived[1]);
    for (const bad of ["Clone", "Copy", "Default", "Serialize", "Deserialize", "fmt::Display"]) {
      if (new RegExp("impl\\s+" + bad + "\\s+for\\s+" + t + "\\b").test(both))
        errors.push(t + " implements " + bad);
    }
    // A DERIVED Debug would print the private binding. Only a hand-written impl is acceptable; the
    // redacted CONTENT of that impl is proved at runtime by the positive consumer below, because a
    // matching string in a test assertion would satisfy any text search.
    if (!new RegExp("impl fmt::Debug for " + t + "\\b").test(both) && !isMacroGenerated(t))
      errors.push(t + " has no hand-written Debug impl");
  }
  // No FIELD of any contract type may be public, in the macros or the plain structs.
  for (const src of [witness, grant]) {
    const structs = src.matchAll(/pub struct (\$name|\w+) \{([\s\S]*?)\n\s*\}/g);
    for (const [, sname, fields] of structs) {
      const pubField = /\n\s*pub(?:\(crate\))?\s+\w+\s*:/.exec(fields);
      if (pubField)
        errors.push(
          "a field of " + sname + " is publicly readable: " + pubField[0].trim()
        );
    }
  }
  // The two generators must redact, since they define six of the nine types.
  for (const [macroName, src] of [
    ["opaque_witness", witness],
    ["typed_effect_grant", grant],
  ]) {
    const body = new RegExp("macro_rules! " + macroName + "\\s*\\{[\\s\\S]*?\\n\\}").exec(src);
    if (!body) errors.push("the " + macroName + " generator is missing");
    else {
      if (!/impl fmt::Debug for \$name/.test(body[0]))
        errors.push(macroName + " does not define a Debug impl");
      if (!/concat!\(stringify!\(\$name\), "\(\[REDACTED\]\)"\)/.test(body[0]))
        errors.push(macroName + " does not redact its Debug output");
      if (/#\[derive/.test(body[0])) errors.push(macroName + " derives traits");
    }
  }
  for (const t of ["VerifiedEffectAuthorisationTransition", "AuthorisedProofAttemptGrant"]) {
    const impl = new RegExp(
      "impl fmt::Debug for " + t + "\\b[\\s\\S]*?\\n\\s*\\}\\r?\\n\\}"
    ).exec(both);
    if (!impl || !/\[REDACTED\]/.test(impl[0]))
      errors.push(t + " does not redact its Debug output");
  }
  if (/Serialize|Deserialize|serde/.test(both)) errors.push("the contract references serialisation");
  // Thread binding via a stable mechanism.
  if (!/type ThreadBound = PhantomData<\*const \(\)>;/.test(witness))
    errors.push("witnesses are not thread-bound by a raw-pointer PhantomData");
  if (!/type ThreadBound = PhantomData<\*const \(\)>;/.test(grant))
    errors.push("grants are not thread-bound by a raw-pointer PhantomData");
  if (/unsafe\s+impl\s+(Send|Sync)/.test(both))
    errors.push("the contract re-enables Send/Sync with an unsafe impl");

  // ---- 3. No legacy-gate route, no forgeable input ---------------------------------------------
  const bypass = stripStrings(both);
  for (const bad of [
    { re: /OperationGate/, why: "accepts or references the legacy OperationGate" },
    { re: /GateOutcome/, why: "references GateOutcome" },
    { re: /\bOwnerApproval\b/, why: "accepts the legacy OwnerApproval enum" },
    { re: /\bElevation\b(?!Witness)/, why: "accepts the legacy Elevation enum" },
    { re: /fn\s+\w*\s*\([^)]*:\s*bool[^)]*\)\s*->\s*Verified/, why: "takes a bool as evidence" },
    { re: /fn\s+mint\s*\(/, why: "exposes a mint() function" },
    { re: /fn\s+from_owner_approval|fn\s+from_elevation|fn\s+authorise\s*\(/, why: "exposes a legacy conversion" },
  ]) {
    if (bad.re.test(bypass)) errors.push("effect contract " + bad.why);
  }
  // The composition function must consume opaque witnesses only — no scalar arguments.
  const compose = /pub fn compose_verified_authorisation\(([\s\S]*?)\)\s*->/.exec(witness);
  if (!compose) errors.push("the composition function is missing");
  else {
    if (/bool|u\d+|&str|String/.test(compose[1]))
      errors.push("the composition function accepts a caller-supplied scalar");
    for (const w of TYPES.slice(0, 4)) {
      if (!compose[1].includes(w)) errors.push("composition does not consume " + w);
    }
    if (/&\s*Verified/.test(compose[1]))
      errors.push("composition borrows a witness instead of consuming it");
  }
  // The attempt grant is minted only from a composed transition, crate-privately.
  if (!/pub\(crate\) fn from_composed_witnesses/.test(grant))
    errors.push("the attempt-grant constructor is not crate-private");
  if (/pub fn from_composed_witnesses/.test(grant))
    errors.push("the attempt-grant constructor is public");
  // Atomic one-time split returning exactly three typed grants.
  if (!/pub fn into_typed_grants\(\s*self,?\s*\)/.test(grant))
    errors.push("the split does not consume the attempt grant");
  if (!/ScmEffectGrant,\s*IpcEffectGrant,\s*InstanceObservationEffectGrant,?\s*\)/.test(grant))
    errors.push("the split does not return exactly the three typed grants");
  if (/fn\s+into_scm_grant|fn\s+issue_one|fn\s+reissue/.test(grant))
    errors.push("a partial or repeat issuance method exists");
  if (!/pub fn into_authorised_attempt_grant\(\s*self,?\s*\)/.test(witness))
    errors.push("the transition does not consume itself to release the grant");

  // ---- 4. No machine-effect route, no live producer ---------------------------------------------
  for (const bad of [
    /use\s+windows(::|\s|;)|windows::Win32|windows_sys/,
    /TokenElevation|GetTokenInformation|CheckTokenMembership|IsUserAnAdmin/,
    /OpenSCManager|QueryServiceStatusEx|CreateServiceW/,
    /CreateNamedPipe|ConnectNamedPipe/,
    /OpenProcess\b|GetProcessTimes/,
    /Command::new|std::process/,
    /unsafe\s*(fn|\{)/,
  ]) {
    const m = bypass.match(bad);
    if (m) errors.push("the effect contract contains a machine-effect route: " + m[0]);
  }
  for (const cap of [
    "LiveOperationCapability",
    "LiveIpcOperationCapability",
    "LiveInstanceObservationCapability",
  ]) {
    if (bypass.includes(cap)) errors.push("the contract references a live capability: " + cap);
  }
  // Fixture bindings must be marked synthetic so a future live producer can refuse them.
  if (!/synthetic:\s*true/.test(witness))
    errors.push("fixture bindings are not marked synthetic");

  // ---- 5. Truthful phase state ------------------------------------------------------------------
  const lib = stripComments(read(path.join(SRC, "lib.rs")));
  if (!/pub mod effect_witness;/.test(lib) || !/pub mod effect_grant;/.test(lib))
    errors.push("the effect contract modules are not exported");
  if (/EXECUTION_READY\s*:\s*bool\s*=\s*true/.test(lib))
    errors.push("execution readiness became true");

  // ---- 6. Compile proofs ------------------------------------------------------------------------
  const pos = compileConsumer("pos_witness_contract", FIX, POSITIVE, true);
  if (!pos.ok || !/EFFECT_WITNESS_CONTRACT_OK/.test(pos.out))
    errors.push("the external contract consumer cannot compose: " + pos.out.slice(-500));

  for (const [name, feats, why, body, codes] of NEGATIVES) {
    const r = compileConsumer(name, feats, body, false);
    if (r.ok) {
      errors.push("FORGERY POSSIBLE — " + why + " (" + name + " compiled)");
      continue;
    }
    // A rejection is only evidence if it is the EXPECTED rejection. A typo, a bad import or a
    // renamed item would also fail to compile and would otherwise be read as a passing proof.
    if (!codes.some((c) => r.out.includes(c))) {
      const seen = (r.out.match(/error\[E\d+\]/g) || ["<no error code>"]).slice(0, 3).join(",");
      errors.push(
        name + " was rejected for the WRONG reason: expected " + codes.join("/") + ", saw " + seen
      );
    }
  }

  return errors;
}

function cleanup() {
  if (WORK && fs.existsSync(WORK)) {
    try {
      fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
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
    errs.forEach((e) => console.error("[val-cd-b4-effect-witness-contract1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-effect-witness-contract1a: PASS");
}
