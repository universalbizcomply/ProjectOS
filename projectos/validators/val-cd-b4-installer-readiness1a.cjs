// Validator: CD-B4-INSTALLER-READINESS1A
//
// Fails closed. Proves the installer is technically ready for a dry run and stops at the frozen gate:
//  - Program Files and ProgramData resolve through SHGetKnownFolderPath ONLY — no environment
//    variable, working directory, repository path or hardcoded literal;
//  - resolution is read-only: the creation flag is never passed;
//  - the resolvers are two NAMED functions, not a second Known Folder abstraction, and a caller can
//    neither supply nor replace either root;
//  - containment and reparse-point checks are enforced on every resolved root;
//  - the approved installation paths are derived from frozen segments only;
//  - ProjectOSHost.exe is built from committed source, is inert, and is verified outside production;
//  - the dry run reaches InstallationEffectAuthority::NotAuthorised and executes no service step.
"use strict";
const fs = require("fs");
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
const HOST = path.join(ROOT, "projectos", "host");
const LEAF = path.join(HOST, "windows-runtime-primitives");
const W = path.join(HOST, "canonical-installation-identity-writer");
const C = path.join(HOST, "elevated-installer-composition");
const SH = path.join(HOST, "service-host");
const px = (d) => d.replace(/\\/g, "/");

const read = (f) => fs.readFileSync(f, "utf8");
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripToml = (s) => s.replace(/#.*/g, "");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\((all\(test[^\)]*\)|test)\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-installer-readiness1a");
  return __SCRATCH_DIR;
}

const DEPS = {
  leaf: `projectos-windows-runtime-primitives = { path = "${px(LEAF)}" }`,
  "writer-installer": `projectos-host-canonical-installation-identity-writer = { path = "${px(
    W
  )}", features = ["installer-windows"] }`,
  "comp-dry": `projectos-host-elevated-installer-composition = { path = "${px(
    C
  )}", features = ["installer-dry-run"] }`,
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
      DEPS[dep],
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

const CONTROLS = [
  [
    "readiness_leaf_control",
    "leaf",
    `use projectos_windows_runtime_primitives::known_folder::{resolve_program_data, resolve_program_files};
fn main(){
    let a = resolve_program_data().expect("ProgramData");
    let b = resolve_program_files().expect("ProgramFiles");
    assert!(a.is_absolute() && b.is_absolute() && a != b);
}`,
  ],
];

const NEGATIVES = [
  {
    name: "neg_arbitrary_known_folder_resolved",
    dep: "leaf",
    why: "a caller can resolve an arbitrary Known Folder by GUID",
    body: `fn main(){ let g = windows_core_guid(); let _ = projectos_windows_runtime_primitives::known_folder::resolve(&g); }\nfn windows_core_guid() -> u128 { 0 }`,
  },
  {
    name: "neg_program_data_root_supplied",
    dep: "writer-installer",
    why: "a caller can supply the resolved ProgramData root",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f(p: &std::path::Path) { let _ = w::ResolvedProgramDataAnchor::from_resolved_root(p); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_install_root_supplied",
    dep: "writer-installer",
    why: "a caller can supply the resolved Program Files install root",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f(p: &std::path::Path) { let _ = w::ResolvedInstallRoot::under(p); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_install_root_struct_literal",
    dep: "writer-installer",
    why: "the install root is constructible by struct literal",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f() -> w::ResolvedInstallRoot { w::ResolvedInstallRoot { install_dir: std::path::PathBuf::new() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_artefact_evidence_forged",
    dep: "comp-dry",
    why: "artefact evidence is constructible by struct literal, bypassing every check",
    body: `use projectos_host_elevated_installer_composition::dry_run::ArtefactEvidence;\nfn f() -> ArtefactEvidence { ArtefactEvidence { path: std::path::PathBuf::new() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_dry_run_report_forged",
    dep: "comp-dry",
    why: "a dry-run report can be forged to claim the gate was passed",
    body: `use projectos_host_elevated_installer_composition::dry_run::DryRunReport;\nfn f() -> DryRunReport { DryRunReport { stopped_at: unimplemented!() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_service_binary_name_chosen",
    dep: "writer-installer",
    why: "a caller can choose the installed service binary name",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f(r: &w::ResolvedInstallRoot) { let _ = r.service_binary_path("other.exe"); }\nfn main(){ let _ = f; }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  // Snapshot the production roots BEFORE anything else, so the check at the end compares like for like.
  const __ROOTS_BEFORE = {};
  for (const env of ["ProgramData", "ProgramFiles"]) {
    const root = process.env[env];
    if (!root) continue;
    const p = path.join(root, "ProjectOS");
    __ROOTS_BEFORE[p] = fs.existsSync(p);
  }

  const kfP = path.join(LEAF, "src", "known_folder.rs");
  const drP = path.join(C, "src", "dry_run.rs");
  const shP = path.join(SH, "src", "main.rs");
  for (const f of [kfP, drP, shP, path.join(SH, "Cargo.toml")])
    if (!fs.existsSync(f)) E("V1 missing mandatory path: " + f);
  if (errors.length) return errors;

  const kfRaw = read(kfP);
  const kf = stripLine(stripTests(kfRaw));
  const dr = stripLine(read(drP));
  const w = stripLine(read(path.join(W, "src", "lib.rs")));
  const shRaw = read(shP);
  const sh = stripLine(shRaw);
  const shToml = stripToml(read(path.join(SH, "Cargo.toml")));

  // ---- V2 resolution is trusted and read-only ----
  for (const [needle, what] of [
    ["SHGetKnownFolderPath", "the trusted Windows resolver"],
    ["FOLDERID_ProgramData", "the ProgramData folder id"],
    ["FOLDERID_ProgramFiles", "the Program Files folder id"],
    ["KF_FLAG_DONT_VERIFY", "the read-only resolution flag"],
    ["CoTaskMemFree", "the required free of the OS allocation"],
  ])
    if (!kf.includes(needle)) E("V2 the resolver is missing " + what);
  if (/KF_FLAG_CREATE/.test(kf)) E("V2 CRITICAL: the resolver passes the folder CREATION flag");
  for (const bad of [
    "env::var",
    "std::env",
    "current_dir",
    "ProgramData\\\\",
    "C:\\\\",
    "Program Files\\\\",
  ])
    if (kf.includes(bad)) E("V2 the resolver consults an untrusted source: " + bad);
  // Two NAMED functions, not a folder vocabulary — the second abstraction the brief forbids.
  // An ERROR enum is not a folder vocabulary; a set of selectable FOLDERS would be.
  for (const m of kf.matchAll(/pub enum (\w+)\s*\{([\s\S]*?)\n\}/g)) {
    if (/Error$/.test(m[1])) continue;
    if (/ProgramData|ProgramFiles|Folder/.test(m[2]))
      E("V2 the resolver defines a second Known Folder abstraction: " + m[1]);
  }
  if (!/^fn resolve\(/m.test(kf)) E("V2 the single resolution call is not private");
  if (!/pub fn resolve_program_data\(\)/.test(kf) || !/pub fn resolve_program_files\(\)/.test(kf))
    E("V2 both named resolvers must exist");

  // ---- V3 the single anchor vocabulary was EXTENDED, not duplicated ----
  {
    const rp = stripLine(read(path.join(HOST, "windows-host-activation-plan", "src", "root_plan.rs")));
    if (!/ProgramFiles,/.test(rp)) E("V3 KnownFolderAnchor was not extended with ProgramFiles");
    if (!/"%KNOWNFOLDER:ProgramFiles%"/.test(rp)) E("V3 the ProgramFiles anchor has no symbolic label");
    if (!/StateAnchorNotProgramData/.test(rp))
      E("V3 Program Files is not refused as a production STATE root");
  }

  // ---- V4 boundary checks on every resolved root ----
  {
    const i = w.indexOf("fn from_resolved_root(");
    const body = i === -1 ? "" : w.slice(i, w.indexOf("\n    }", i));
    if (i === -1) E("V4 the shared anchor boundary check is missing");
    if (!/canonicalize\(\)/.test(body)) E("V4 a resolved root is not canonicalised");
    if (!/is_symlink\(\)/.test(body)) E("V4 a resolved root is not checked for a reparse point");
    if (!/ReparsePointRefused/.test(body)) E("V4 a reparse point is not refused");
    const j = w.indexOf("fn under(root: &Path)");
    const ubody = j === -1 ? "" : w.slice(j, w.indexOf("\n    }", j));
    if (j === -1) E("V4 the install-root derivation is missing");
    if (!/is_symlink\(\)/.test(ubody)) E("V4 the install root is not checked for a reparse point");
    if (!/starts_with\(&root\)/.test(ubody)) E("V4 install-root containment is not re-checked");
    for (const seg of ["EXPECTED_PRODUCT", "HOST_STATE_DIRECTORY_SEGMENT"])
      if (!ubody.includes(seg)) E("V4 the install root does not use the frozen segment " + seg);
    if (/join\("/.test(ubody)) E("V4 the install root joins a string literal instead of a frozen segment");
  }
  if (!/EXPECTED_SERVICE_RELATIVE_PATH/.test(w) || /join\("ProjectOSHost\.exe"\)/.test(w))
    E("V4 the service binary name is not taken from the frozen contract");

  // ---- V5 artefact verification ----
  for (const [needle, what] of [
    ["EXPECTED_SERVICE_RELATIVE_PATH", "the frozen artefact name"],
    ["ArtefactRefusal::WrongName", "the wrong-name refusal"],
    ["ArtefactRefusal::Missing", "the missing refusal"],
    ["ArtefactRefusal::NotRegularFile", "the not-a-regular-file refusal"],
    ["ArtefactRefusal::InsideProductionRoot", "the production-root refusal"],
    ["ArtefactRefusal::NotBuildOutput", "the build-output requirement"],
    ["is_inside_a_production_root", "the production-root check"],
  ])
    if (!dr.includes(needle)) E("V5 artefact verification is missing " + what);
  {
    // Without the dry-run feature the roots cannot be resolved, so the check must FAIL CLOSED.
    const m = /#\[cfg\(not\(all\(windows, feature = "installer-dry-run"\)\)\)\]\s*\nfn is_inside_a_production_root\([^)]*\) -> bool \{([\s\S]*?)\n\}/.exec(
      dr
    );
    if (!m) E("V5 there is no fail-closed production-root check for the non-dry-run graph");
    else if (!/true/.test(m[1])) E("V5 CRITICAL: the production-root check fails OPEN without the feature");
  }

  // ---- V6 the dry run stops at the frozen gate and executes no service step ----
  {
    const i = dr.indexOf("pub fn production_dry_run(");
    const body = i === -1 ? "" : dr.slice(i);
    if (i === -1) E("V6 the production dry run is missing");
    if (!/InstallationEffectAuthority::current\(\)/.test(body))
      E("V6 the dry run does not consult the frozen effect authority");
    for (const bad of [
      "create_dir",
      "fs::write",
      "File::create",
      "copy(",
      "remove_",
      "OpenSCManager",
      "CreateService",
      "StartService",
      "RegCreate",
      "RegSetValue",
      "apply_directory_policy",
      "write_identity_record",
    ])
      if (body.includes(bad)) E("V6 the dry run performs an effect: " + bad);
    if (!/#\[cfg\(all\(windows, feature = "installer-dry-run"\)\)\]/.test(dr))
      E("V6 the dry run is not gated behind a non-default feature");
  }
  {
    const feats = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(stripToml(read(path.join(C, "Cargo.toml")))) || [])[1] || "";
    if (!/default\s*=\s*\[\s*\]/.test(feats)) E("V6 the composition default feature set is not empty");
    if (!/installer-dry-run\s*=/.test(feats)) E("V6 the dry-run feature is missing");
    if (/default\s*=\s*\[[^\]]*installer-dry-run/.test(feats)) E("V6 the dry run is enabled by default");
  }

  // ---- V7 the packaged artefact is inert ----
  // The artefact is now a real SCM service, so the crate cannot forbid unsafe outright: the three
  // Windows service calls require it. It must instead be CONFINED to scm.rs, with main.rs unsafe-free
  // and implicit unsafe inside unsafe fns denied.
  // Actual unsafe CODE, not the lint attribute that denies implicit unsafe.
  if (/unsafe\s*(fn|\{|extern)/.test(sh)) E("V7 unsafe leaked into the artefact entry point");
  if (!/unsafe_op_in_unsafe_fn\s*=\s*"deny"/.test(shToml))
    E("V7 the artefact crate does not deny implicit unsafe inside unsafe fns");
  if (!fs.existsSync(path.join(SH, "src", "scm.rs")))
    E("V7 the SCM boundary module is missing, so unsafe is not confined");
  if (!/name = "ProjectOSHost"/.test(shToml)) E("V7 the binary is not named ProjectOSHost");
  for (const bad of [
    "OpenSCManager",
    "CreateService",
    "StartService",
    "RegCreate",
    "RegSetValue",
    "CreateNamedPipe",
    "TcpListener",
    "TcpStream",
    "ProgramData",
    "Program Files",
    "SetNamedSecurityInfo",
  ])
    if (sh.includes(bad)) E("V7 the artefact performs or names an effect route: " + bad);
  if (!/InstallationEffectAuthority::current\(\)/.test(sh))
    E("V7 the artefact does not report the frozen effect authority");
  if (!/"ProjectOSHost"/.test(sh)) E("V7 the artefact does not pin the frozen service name");

  // ---- V8 the artefact exists, is outside production, and came from a build directory ----
  {
    const exe = path.join(SH, "target", "release", "ProjectOSHost.exe");
    if (!fs.existsSync(exe)) {
      const r = cargo(
        ["build", "--release", "--offline", "--quiet", "--manifest-path", path.join(SH, "Cargo.toml")],
        { encoding: "utf8", cwd: ROOT }
      );
      if (r.status !== 0) E("V8 the artefact could not be built from committed source");
    }
    if (!fs.existsSync(exe)) E("V8 ProjectOSHost.exe was not produced");
    else {
      const resolved = fs.realpathSync(exe);
      if (path.basename(resolved) !== "ProjectOSHost.exe") E("V8 the artefact is misnamed");
      if (!resolved.split(path.sep).includes("target")) E("V8 the artefact is not a build output");
      const low = resolved.toLowerCase();
      if (low.includes("program files") || low.includes("programdata"))
        E("V8 CRITICAL: the artefact was written into a production root");
      if (!resolved.toLowerCase().startsWith(ROOT.toLowerCase()))
        E("V8 the artefact is outside the repository build tree");
    }
  }

  // ---- production roots: this VALIDATION RUN must create or modify nothing ----
  //
  // The roots may now legitimately exist: CD-B4-LOCAL-INSTALL-AND-LIVE-PROOF1A performed one
  // owner-approved installation. Asserting they are absent would therefore be asserting that the
  // owner's machine is un-installed, which is not this validator's business. What IS its business is
  // that VALIDATING changes nothing — so the roots are snapshotted before the checks above and
  // compared afterwards.
  for (const env of ["ProgramData", "ProgramFiles"]) {
    const root = process.env[env];
    if (!root) continue;
    const p = path.join(root, "ProjectOS");
    const after = fs.existsSync(p);
    const before = __ROOTS_BEFORE[p];
    if (after !== before)
      E(`V9 CRITICAL: validation changed a production root at ${p} (existed=${before} -> ${after})`);
  }

  // ---- compile proofs ----
  for (const [name, dep, body] of CONTROLS) {
    const r = compileConsumer(name, body, dep);
    if (!r.ok) E("CONTROL " + name + " failed to compile (setup broken):\n" + r.out.slice(0, 1200));
  }
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.dep);
    if (r.ok) E("INSTALLER READINESS LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-installer-readiness1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-installer-readiness1a: PASS");
}
