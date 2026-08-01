// Validator: CD-B4-ELEVATED-INSTALLER-IDENTITY-COMPOSITION1A
//
// Fails closed. Proves the elevated-installer composition boundary:
//  - it composes the FROZEN contracts and defines no parallel path, ACL, service-name, schema, random
//    or installation-state vocabulary;
//  - the production target is derived internally from the frozen segments and no public API takes an
//    arbitrary output path;
//  - InstallerTarget is sealed, non-Clone, non-Copy and non-serialisable;
//  - no runtime, Tauri or renderer crate depends on the writer or the composition crate;
//  - every listed precondition has a refusal and none is a caller boolean in a production API;
//  - the ordering places the identity record before any service step, and the rollback contract is
//    explicit;
//  - the production entry point refuses before any write capability exists;
//  - and (rustc negative compiles) downstream cannot reach the target, the anchor, the fixture route,
//    the plan constructor or the operation guard.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const C = path.join(HOST, "elevated-installer-composition");
const W = path.join(HOST, "canonical-installation-identity-writer");
const px = (d) => d.replace(/\\/g, "/");

const read = (f) => fs.readFileSync(f, "utf8");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(all\(test, feature[^\)]*\)\)\]\s*\nmod tests|#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripToml = (s) => s.replace(/#.*/g, "");

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-elevated-installer-composition1a");
  return __SCRATCH_DIR;
}

const DEPS = {
  comp: `projectos-host-elevated-installer-composition = { path = "${px(C)}" }`,
  "comp-fixture": `projectos-host-elevated-installer-composition = { path = "${px(
    C
  )}", features = ["fixture-composition"] }`,
  writer: `projectos-host-canonical-installation-identity-writer = { path = "${px(W)}" }`,
  // Writer AND the DEFAULT composition together. Cargo unifies features across a graph, so this is
  // where a leak would appear: depending on the composition must not, by itself, hand a dependent the
  // writer's fixture route.
  "writer+comp": [
    `projectos-host-canonical-installation-identity-writer = { path = "${px(W)}" }`,
    `projectos-host-elevated-installer-composition = { path = "${px(C)}" }`,
  ].join("\n"),
  // Writer AND fixture-enabled composition. Opting into a fixture feature is expected to expose the
  // fixture route — it is used to obtain the sealed types the seal negatives assert bounds on.
  "writer+comp-fixture": [
    `projectos-host-canonical-installation-identity-writer = { path = "${px(W)}" }`,
    `projectos-host-elevated-installer-composition = { path = "${px(
      C
    )}", features = ["fixture-composition"] }`,
  ].join("\n"),
};

function compileConsumer(name, body, dep) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]",
      "",
      "[package]",
      `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"',
      'edition = "2021"',
      "publish = false",
      "",
      "[dependencies]",
      DEPS[dep || "comp"],
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = spawnSync("cargo", ["build", "--offline", "--quiet"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const CONTROLS = [
  [
    "eic_default_control",
    "comp",
    `use projectos_host_elevated_installer_composition as c;
fn main(){
    // The production entry point is reachable and REFUSES; nothing else in the default graph writes.
    let r = c::InstallationRequest::parse("stable", "${"a".repeat(63)}b").expect("request");
    assert_eq!(c::plan_production_installation(&r).unwrap_err(), c::PlanRefusal::ElevationAbsent);
    assert!(c::PlannedStep::WriteAndVerifyIdentityRecord.order() < c::PlannedStep::InstallOrConfigureService.order());
}`,
  ],
];

const NEGATIVES = [
  {
    name: "neg_target_from_path_via_composition",
    dep: "writer+comp",
    why: "depending on the composition leaks the writer's fixture target route through Cargo feature unification",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f(p: &std::path::Path) { let _ = w::InstallerTarget::fixture_under(p); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_target_struct_literal",
    dep: "writer",
    why: "InstallerTarget is constructible via a struct literal",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f() -> w::InstallerTarget { w::InstallerTarget { installation_dir: std::path::PathBuf::new() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_anchor_from_path_default_graph",
    dep: "writer",
    why: "the ProgramData anchor is replaceable from the default graph",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f(p: &std::path::Path) { let _ = w::ResolvedProgramDataAnchor::fixture(p); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_production_anchor_resolves_in_default_graph",
    dep: "writer+comp",
    why: "the production anchor resolver is reachable without the installer-windows gate",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn main(){ let _ = w::ResolvedProgramDataAnchor::resolve_approved(); }`,
  },
  {
    name: "neg_composition_fixture_route_in_default_graph",
    dep: "comp",
    why: "the fixture composition route is reachable in the DEFAULT graph",
    body: `use projectos_host_elevated_installer_composition as c;\nfn main(){ let _ = c::fixture::compose_fixture_installation; }`,
  },
  {
    name: "neg_plan_constructed_directly",
    dep: "comp",
    why: "a caller can construct a plan and choose the service name",
    body: `use projectos_host_elevated_installer_composition as c;\nfn main(){ let _ = c::InstallationPlan::new("stable", "Other", "other.exe", String::new()); }`,
  },
  {
    name: "neg_operation_guard_forged",
    dep: "comp",
    why: "the exclusive installation operation can be forged by struct literal",
    body: `use projectos_host_elevated_installer_composition as c;\nfn f() -> c::ExclusiveInstallationOperation { c::ExclusiveInstallationOperation { _private: () } }\nfn main(){ let _ = f; }`,
  },
];

/// The sealed values must not be duplicable. Expressed as TRAIT BOUNDS rather than a `.clone()` call:
/// `(&T).clone()` succeeds for any `T` and would prove nothing, so the bound is asserted directly and
/// fails with an unsatisfied-trait error naming the exact type.
const BOUND = `fn assert_clone<T: Clone>() {}\nfn assert_copy<T: Copy>() {}\n`;
const SEAL_NEGATIVES = [
  {
    name: "neg_target_cloned",
    why: "the sealed target is Clone",
    body: `${BOUND}fn main(){ assert_clone::<projectos_host_canonical_installation_identity_writer::InstallerTarget>(); }`,
  },
  {
    name: "neg_target_copied",
    why: "the sealed target is Copy",
    body: `${BOUND}fn main(){ assert_copy::<projectos_host_canonical_installation_identity_writer::InstallerTarget>(); }`,
  },
  {
    name: "neg_anchor_cloned",
    why: "the resolved anchor is Clone",
    body: `${BOUND}fn main(){ assert_clone::<projectos_host_canonical_installation_identity_writer::ResolvedProgramDataAnchor>(); }`,
  },
  {
    name: "neg_plan_cloned",
    why: "the installation plan is Clone",
    body: `${BOUND}fn main(){ assert_clone::<projectos_host_elevated_installer_composition::InstallationPlan>(); }`,
  },
  {
    name: "neg_operation_cloned",
    why: "the exclusive installation operation is Clone",
    body: `${BOUND}fn main(){ assert_clone::<projectos_host_elevated_installer_composition::ExclusiveInstallationOperation>(); }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const libP = path.join(C, "src", "lib.rs");
  const planP = path.join(C, "src", "plan.rs");
  for (const f of [libP, planP, path.join(C, "Cargo.toml")])
    if (!fs.existsSync(f)) E("V1 missing mandatory path: " + f);
  if (errors.length) return errors;

  const libRaw = read(libP);
  const lib = stripLine(stripTests(libRaw));
  const plan = stripLine(read(planP));
  const toml = stripToml(read(path.join(C, "Cargo.toml")));
  const wRaw = read(path.join(W, "src", "lib.rs"));
  const w = stripLine(stripTests(wRaw));

  // ---- V2 crate shape ----
  if (!/#!\[forbid\(unsafe_code\)\]/.test(libRaw)) E("V2 the composition crate does not forbid unsafe");
  {
    const feats = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(toml) || [])[1] || "";
    if (!/default\s*=\s*\[\s*\]/.test(feats)) E("V2 the composition default feature set is not empty");
    if (!/fixture-composition\s*=/.test(feats)) E("V2 the fixture feature is missing");
  }
  if (!/#\[cfg\(feature = "fixture-composition"\)\]\s*\npub mod fixture/.test(libRaw))
    E("V2 the fixture module is not gated on the fixture feature alone");

  // ---- V3 no parallel vocabulary ----
  for (const [re, what] of [
    [/ProgramData\\\\|C:\\\\|Program Files/, "a literal production path"],
    [/"ProjectOSHost"/, "a second service-name constant"],
    [/"ProjectOSHost\.exe"/, "a second executable constant"],
    [/"installation"|"identity\.v1\.json"/, "a second record-location constant"],
    [/struct InstallerTarget|struct ResolvedProgramDataAnchor/, "a second target/anchor abstraction"],
    [/struct AclPolicy|enum RightsClass|enum AclPrincipal/, "a second ACL vocabulary"],
    [/struct InstallationIdentityRecordV1|fn compute_record_digest|Sha256|sha2::/, "a second record schema or digest"],
    [/BCryptGenRandom|rand::|getrandom|SystemTime|process::id/, "a second random source"],
  ]) {
    if (re.test(lib)) E("V3 the composition defines " + what + " (lib.rs)");
    if (re.test(plan)) E("V3 the composition defines " + what + " (plan.rs)");
  }

  // ---- V4 the frozen contracts are actually depended on and used ----
  for (const dep of [
    "projectos-host-canonical-installation-identity-writer",
    "projectos-host-identity",
    "projectos-host-windows-activation-plan",
    "projectos-host-windows-acl-policy",
    "projectos-host-windows-service-installation-contract",
    "projectos-host-windows-root-custody",
  ])
    if (!toml.includes(dep)) E("V4 the composition does not reuse " + dep);
  for (const [needle, what] of [
    ["EXPECTED_SERVICE_NAME", "the frozen service name"],
    ["EXPECTED_SERVICE_RELATIVE_PATH", "the frozen executable path"],
    ["symbolic_record_location", "the frozen symbolic record location"],
    ["InstallationEffectAuthority", "the frozen effect authority"],
    ["AclCompositionOutcome", "the frozen ACL composition outcome"],
    ["WindowsRootCustody", "the frozen root-custody contract"],
  ])
    if (!lib.includes(needle)) E("V4 the composition does not use " + what);
  for (const [needle, what] of [
    ["ActivationStep::all()", "the frozen activation ordering"],
    ["PreEffectCheck::sequence()", "the frozen pre-effect ordering"],
  ])
    if (!plan.includes(needle)) E("V4 the plan does not carry " + what);

  // ---- V5 ordering: identity before any service step ----
  {
    const m = /pub fn all\(\) -> &'static \[PlannedStep\] \{([\s\S]*?)\n    \}/.exec(plan);
    if (!m) E("V5 the step ordering is missing");
    else {
      const order = [...m[1].matchAll(/Self::(\w+)/g)].map((x) => x[1]);
      const idx = (n) => order.indexOf(n);
      for (const s of [
        "ConfirmElevationAndExclusivity",
        "WriteAndVerifyIdentityRecord",
        "InstallOrConfigureService",
        "AwaitSeparateOwnerActivationGate",
      ])
        if (idx(s) === -1) E("V5 the ordering omits " + s);
      if (!(idx("WriteAndVerifyIdentityRecord") < idx("InstallOrConfigureService")))
        E("V5 ORDERING DEFECT: the service step is not after the identity write");
      if (idx("ConfirmElevationAndExclusivity") !== 0)
        E("V5 elevation/exclusivity is not the first step");
      if (idx("AwaitSeparateOwnerActivationGate") !== order.length - 1)
        E("V5 activation is not gated last");
      if (!(idx("DeriveInstallerTarget") < idx("GenerateInstallationId")))
        E("V5 the id is generated before the target is derived");
    }
  }

  // ---- V6 rollback contract ----
  for (const [needle, what] of [
    ["fn failure_halts_all_later_steps", "the halt-on-failure rule"],
    ["fn cleanup_scope_on_failure", "the cleanup scope rule"],
    ["InstallerOwnedTemporaryOnly", "installer-owned-only cleanup"],
    ["fn carry_forward_on_failure", "the carry-forward rule"],
    ["fn automatic_retry_permitted", "the retry rule"],
    ["fn permits_acl_weakening", "the ACL-weakening rule"],
  ])
    if (!plan.includes(needle)) E("V6 the rollback contract is missing " + what);
  {
    const m = /fn permits_acl_weakening\(self\) -> bool \{([\s\S]*?)\n    \}/.exec(plan);
    if (!m || !/false/.test(m[1])) E("V6 ACL weakening is not unconditionally refused");
    const r = /fn automatic_retry_permitted\(self\) -> bool \{([\s\S]*?)\n    \}/.exec(plan);
    if (!r || !/WriteAndVerifyIdentityRecord/.test(r[1]))
      E("V6 an automatic retry after an identity write is not refused");
  }

  // ---- V7 the production entry point and its refusals ----
  {
    const i = lib.indexOf("pub fn plan_production_installation(");
    const body = i === -1 ? "" : lib.slice(i, lib.indexOf("\n}", i));
    if (i === -1) E("V7 the production entry point is missing");
    if (!/InstallationEffectAuthority::current\(\)\.is_authorised\(\)/.test(body))
      E("V7 elevation is not taken from the frozen effect-authority contract");
    if (/bool/.test(body)) E("V7 the production entry point reasons about a caller boolean");
    if (!/PlanRefusal::ElevationAbsent/.test(body)) E("V7 the production entry point does not refuse");
  }
  // No production API accepts a precondition flag.
  for (const m of lib.matchAll(/pub fn (\w+)\(([^)]*)\)/g)) {
    if (/bool/.test(m[2])) E("V7 a production API accepts a caller boolean precondition: " + m[1]);
  }
  for (const v of [
    "ElevationAbsent",
    "InstallationAlreadyInProgress",
    "AnchorUnresolved",
    "PathEscapesApprovedRoot",
    "ReparsePointBoundary",
    "CustodyPlanUnavailable",
    "AclPlanUnavailable",
    "AclPlanInconsistent",
    "ServiceNameMismatch",
    "ServiceBinaryPathMismatch",
    "ReleaseDigestMissingOrMalformed",
    "UnsupportedChannel",
    "ConflictingIdentityExists",
  ])
    if (!lib.includes(v)) E("V7 no refusal exists for precondition: " + v);

  // ---- V8 the sealed target and anchor ----
  if (/#\[derive\([^)]*Clone[^)]*\)\]\s*\npub struct InstallerTarget/.test(wRaw))
    E("V8 InstallerTarget is Clone");
  if (/#\[derive\([^)]*Copy[^)]*\)\]\s*\npub struct InstallerTarget/.test(wRaw))
    E("V8 InstallerTarget is Copy");
  // serde_json is the strict PARSER the codec already uses; a serialisation DERIVE is the thing that
  // would make a sealed value transportable.
  if (/#\[derive\([^)]*(Serialize|Deserialize)/.test(w) || /serde::(Serialize|Deserialize)/.test(w))
    E("V8 the writer gained a serialisation route");
  {
    const m = /pub struct InstallerTarget \{([\s\S]*?)\n\}/.exec(w);
    if (!m) E("V8 InstallerTarget is missing");
    else if (/\bpub\s+\w+\s*:/.test(m[1])) E("V8 InstallerTarget has a public field");
    const a = /pub struct ResolvedProgramDataAnchor \{([\s\S]*?)\n\}/.exec(w);
    if (!a) E("V8 ResolvedProgramDataAnchor is missing");
    else if (/\bpub\s+\w+\s*:/.test(a[1])) E("V8 the anchor has a public field");
  }
  if (!/pub fn under_resolved_anchor\(anchor: &ResolvedProgramDataAnchor\)/.test(w))
    E("V8 the production derivation does not take a resolved anchor");
  {
    // The derivation must build the path from FROZEN segments only.
    const i = w.indexOf("pub fn under_resolved_anchor(");
    const body = i === -1 ? "" : w.slice(i, w.indexOf("\n    }", i));
    for (const seg of ["EXPECTED_PRODUCT", "HOST_STATE_DIRECTORY_SEGMENT", "RECORD_SUBDIRECTORY"])
      if (!body.includes(seg)) E("V8 the derivation does not use the frozen segment " + seg);
    if (/join\("/.test(body)) E("V8 the derivation joins a string literal instead of a frozen segment");
    if (!/starts_with\(&anchor\.root\)/.test(body)) E("V8 containment is not re-checked after derivation");
  }
  if (!/#\[cfg\(all\(windows, feature = "installer-windows"\)\)\]\s*\n    pub fn resolve_approved/.test(wRaw))
    E("V8 the production anchor route is not gated on installer-windows");
  {
    // The anchor is the boundary where a reparse point must be refused.
    const i = w.indexOf("pub fn fixture(owned_root: &Path)");
    const body = i === -1 ? "" : w.slice(i, w.indexOf("\n    }", i));
    if (i === -1) E("V8 the fixture anchor constructor is missing");
    if (!/is_symlink\(\)/.test(body)) E("V8 the anchor does not check for a reparse point");
    if (!/WriteError::ReparsePointRefused/.test(body)) E("V8 the anchor does not refuse a reparse point");
    if (!/canonicalize\(\)/.test(body)) E("V8 the anchor is not canonicalised before use");
  }
  // The composition must never reach the production RNG: its only id route is the deterministic
  // fixture source, so validation cannot execute a CSPRNG.
  if (/SystemPreferredInstallationIdSource/.test(lib))
    E("V3 the composition references the PRODUCTION installation-id source");

  // ---- V9 no runtime / Tauri / renderer dependency on the installer crates ----
  {
    const offenders = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "target", "dist", ".git"].includes(ent.name)) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name === "Cargo.toml") {
          const rel = path.relative(ROOT, p).replace(/\\/g, "/");
          if (
            rel.includes("canonical-installation-identity-writer") ||
            rel.includes("elevated-installer-composition")
          )
            continue;
          const t = stripToml(read(p));
          if (/canonical-installation-identity-writer|elevated-installer-composition/.test(t))
            offenders.push(rel);
        }
      }
    };
    walk(path.join(ROOT, "projectos"));
    if (offenders.length)
      E("V9 a runtime/Tauri/renderer crate depends on an installer crate: " + offenders.join(", "));
    // And the composition must not reach back into a Tauri or renderer surface.
    // Dependency sections only: the manifest DESCRIPTION legitimately states that no Tauri composition
    // happens, and prose must never trip a structural check.
    const depSections = [...toml.matchAll(/\n\[[^\]]*dependencies[^\]]*\]([\s\S]*?)(?=\n\[|$)/g)]
      .map((m) => m[1])
      .join("\n");
    if (/tauri/i.test(depSections)) E("V9 the composition depends on tauri");
  }

  // ---- compile proofs ----
  for (const [name, dep, body] of CONTROLS) {
    const r = compileConsumer(name, body, dep);
    if (!r.ok) E("CONTROL " + name + " failed to compile (setup broken):\n" + r.out.slice(0, 1200));
  }
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.dep);
    if (r.ok) E("INSTALLER COMPOSITION LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }
  for (const neg of SEAL_NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, "writer+comp-fixture");
    if (r.ok) E("SEAL LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-elevated-installer-composition1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-elevated-installer-composition1a: PASS");
}
