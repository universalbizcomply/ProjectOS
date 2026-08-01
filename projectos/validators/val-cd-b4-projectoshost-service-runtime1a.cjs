// Validator: CD-B4-PROJECTOSHOST-SERVICE-RUNTIME1A
//
// Fails closed. Proves ProjectOSHost.exe is a genuine, minimal, inert Windows service:
//  - dispatcher, control handler and status reporting exist, and unsafe is confined to scm.rs;
//  - the four required SCM states map to the correct Win32 constants;
//  - the lifecycle permits only legal transitions and Stopped is terminal;
//  - console mode holds no status handle and can never claim SCM authority;
//  - the runtime performs no protected or external effect;
//  - the release executable is named exactly ProjectOSHost.exe and is built from committed source;
//  - the release-manifest digest is deterministic and reuses the existing hash contract;
//  - the installer dry run carries the artefact and digest and STILL stops at NotAuthorised.
//
// NOTE: service-host is a binary crate, so downstream compile controls cannot depend on it. Its
// boundary is proven structurally and by its own tests; the compile controls below target the
// composition surface that the dry run exposes.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const SH = path.join(HOST, "service-host");
const C = path.join(HOST, "elevated-installer-composition");
const px = (d) => d.replace(/\\/g, "/");

const read = (f) => fs.readFileSync(f, "utf8");
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripToml = (s) => s.replace(/#.*/g, "");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-projectoshost-service-runtime1a");
  return __SCRATCH_DIR;
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
      `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"',
      'edition = "2021"',
      "publish = false",
      "",
      "[dependencies]",
      `projectos-host-elevated-installer-composition = { path = "${px(
        C
      )}", features = ["installer-dry-run"] }`,
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

const NEGATIVES = [
  {
    name: "neg_release_manifest_forged",
    why: "a release manifest can be forged with a chosen digest",
    body: `use projectos_host_elevated_installer_composition::dry_run::ReleaseManifest;\nfn f() -> ReleaseManifest { ReleaseManifest { canonical: Vec::new(), digest: String::new() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_manifest_domain_chosen",
    why: "a caller can choose the manifest domain",
    body: `fn main(){ let _ = projectos_host_elevated_installer_composition::dry_run::MANIFEST_DOMAIN; }`,
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

  const mainP = path.join(SH, "src", "main.rs");
  const scmP = path.join(SH, "src", "scm.rs");
  const lifeP = path.join(SH, "src", "lifecycle.rs");
  const drP = path.join(C, "src", "dry_run.rs");
  for (const f of [mainP, scmP, lifeP, drP, path.join(SH, "Cargo.toml")])
    if (!fs.existsSync(f)) E("V1 missing mandatory path: " + f);
  if (errors.length) return errors;

  const mainRaw = read(mainP);
  const main = stripLine(mainRaw);
  const scmRaw = read(scmP);
  const scm = stripLine(stripTests(scmRaw));
  const life = stripLine(stripTests(read(lifeP)));
  const dr = stripLine(read(drP));
  const toml = stripToml(read(path.join(SH, "Cargo.toml")));

  // ---- V2 the three SCM calls exist, and unsafe is confined to scm.rs ----
  for (const [needle, what] of [
    ["StartServiceCtrlDispatcherW", "dispatcher registration"],
    ["RegisterServiceCtrlHandlerExW", "control handler registration"],
    ["SetServiceStatus", "status reporting"],
    ["SERVICE_TABLE_ENTRYW", "the service table"],
    ["SERVICE_WIN32_OWN_PROCESS", "the own-process service type"],
  ])
    if (!scm.includes(needle)) E("V2 the SCM boundary is missing " + what);
  {
    const unsafeIn = (src) => (stripLine(src).match(/unsafe\s*(fn|\{|extern)/g) || []).length;
    if (unsafeIn(scmRaw) === 0) E("V2 scm.rs contains no unsafe — the boundary is not real");
    if (unsafeIn(mainRaw) > 0) E("V2 unsafe leaked into main.rs");
    if (unsafeIn(read(lifeP)) > 0) E("V2 unsafe leaked into lifecycle.rs");
    const safety = (scmRaw.match(/SAFETY:/g) || []).length;
    const blocks = (scm.match(/unsafe\s*\{/g) || []).length;
    if (safety < blocks) E(`V2 undocumented unsafe in scm.rs (SAFETY ${safety} < blocks ${blocks})`);
    if (!/unsafe_op_in_unsafe_fn\s*=\s*"deny"/.test(toml))
      E("V2 the crate does not deny implicit unsafe inside unsafe fns");
  }

  // ---- V3 the four states map to the correct Win32 constants ----
  for (const [state, konst] of [
    ["ServiceRunState::StartPending", "SERVICE_START_PENDING"],
    ["ServiceRunState::Running", "SERVICE_RUNNING"],
    ["ServiceRunState::StopPending", "SERVICE_STOP_PENDING"],
    ["ServiceRunState::Stopped", "SERVICE_STOPPED"],
  ]) {
    const re = new RegExp(state.replace(/[:]/g, ":") + "\\s*=>\\s*\\(?\\s*" + konst);
    if (!re.test(scm)) E("V3 " + state + " is not published as " + konst);
  }
  // Scoped to the arm / body that must USE each constant. Checking the file as a whole would pass on
  // the `use` import alone, which is exactly how a removed behaviour hides.
  {
    const running = /ServiceRunState::Running => \(([\s\S]*?)\),\n/.exec(scm);
    if (!running) E("V3 the Running arm is missing");
    else if (!/SERVICE_ACCEPT_STOP\s*\|\s*SERVICE_ACCEPT_SHUTDOWN/.test(running[1]))
      E("V3 the running state does not accept stop and shutdown");

    const handler = /extern "system" fn control_handler\(([\s\S]*?)\n\}/.exec(scm);
    if (!handler) E("V3 the control handler is missing");
    else {
      const body = handler[1];
      if (!/control == SERVICE_CONTROL_STOP/.test(body) || !/control == SERVICE_CONTROL_SHUTDOWN/.test(body))
        E("V3 the control handler does not compare against stop and shutdown");
      if (!/STOP_SIGNALLED\.store\(true/.test(body))
        E("V3 the control handler does not signal a stop");
    }

    const dispatcher = /pub fn run_under_scm\(\)([\s\S]*?)\n\}/.exec(scm);
    if (!dispatcher) E("V3 run_under_scm is missing");
    else if (!/StartServiceCtrlDispatcherW\(table\.as_ptr\(\)\)/.test(dispatcher[1]))
      E("V3 run_under_scm does not actually register the dispatcher");

    const svcMain = /extern "system" fn service_main\(([\s\S]*?)\nfn |extern "system" fn service_main\(([\s\S]*?)\npub fn /.exec(scm);
    const svcBody = svcMain ? svcMain[1] || svcMain[2] : "";
    if (!svcBody) E("V3 service_main is missing");
    else {
      if (!/RegisterServiceCtrlHandlerExW\(/.test(svcBody))
        E("V3 service_main does not actually register the control handler");
      if (!/Some\(control_handler\)/.test(svcBody))
        E("V3 service_main registers something other than the control handler");
      if (!/ServiceLifecycle::begin\(ScmStatusReporter/.test(svcBody))
        E("V3 service_main does not drive the lifecycle through the SCM reporter");
    }
  }

  // ---- V4 the lifecycle permits only legal transitions ----
  for (const [needle, what] of [
    ["enum ServiceRunState", "the published state type"],
    ["StartPending", "StartPending"],
    ["Running", "Running"],
    ["StopPending", "StopPending"],
    ["Stopped", "Stopped"],
    ["TransitionRefusal::IllegalTransition", "the illegal-transition refusal"],
    ["TransitionRefusal::AlreadyStopped", "the terminal-stopped refusal"],
    ["fn is_scm_authoritative", "the authority distinction"],
  ])
    if (!life.includes(needle)) E("V4 the lifecycle is missing " + what);
  {
    const m = /fn move_to\(([\s\S]*?)\n    \}/.exec(life);
    if (!m) E("V4 the guarded transition is missing");
    else {
      if (!/state == ServiceRunState::Stopped/.test(m[1]))
        E("V4 Stopped is not terminal in the guarded transition");
      if (!/from\.contains\(&self\.state\)/.test(m[1]))
        E("V4 transitions are not restricted to a legal predecessor set");
    }
    if (!/pub fn running\(/.test(life) || !/\[ServiceRunState::StartPending\]/.test(life))
      E("V4 Running is not restricted to a StartPending predecessor");
  }

  // ---- V5 console mode cannot impersonate SCM authority ----
  {
    const m = /pub struct ScmStatusReporter \{([\s\S]*?)\n\}/.exec(scm);
    if (!m) E("V5 the authoritative reporter is missing");
    else if (/\bpub\s+\w+\s*:/.test(m[1])) E("V5 the SCM reporter has a public field");
    // The ONLY construction site must be inside the SCM entry point. A type DECLARATION and a trait
    // impl both mention the name followed by a brace; neither constructs a value.
    const sites = (scm.match(/(?<!struct\s)(?<!for\s)ScmStatusReporter\s*\{/g) || []).length;
    const inMain = /fn service_main[\s\S]*?ScmStatusReporter \{ handle \}/.test(scm);
    if (sites !== 1 || !inMain)
      E("V5 the SCM reporter is constructible outside the SCM entry point (" + sites + " sites)");
    if (!/fn is_scm_authoritative\(&self\) -> bool \{\s*true\s*\}/.test(scm))
      E("V5 the SCM reporter does not declare itself authoritative");
    if (/is_scm_authoritative\(&self\) -> bool \{\s*true\s*\}/.test(life))
      E("V5 a non-SCM sink in the lifecycle claims SCM authority");
  }

  // ---- V6 the runtime performs no protected or external effect ----
  for (const bad of [
    "OpenSCManager",
    "CreateServiceW",
    "DeleteService",
    "ChangeServiceConfig",
    "RegCreate",
    "RegSetValue",
    "RegOpenKey",
    "SetNamedSecurityInfo",
    "LookupAccountName",
    "ConvertSidToStringSid",
    "CryptProtectData",
    "CreateNamedPipe",
    "TcpStream",
    "TcpListener",
    "reqwest",
    "Command::new",
    "fs::write",
    "fs::read",
    "create_dir",
    "ProgramData",
    "Program Files",
  ]) {
    for (const [label, src] of [["main.rs", main], ["scm.rs", scm], ["lifecycle.rs", life]])
      if (src.includes(bad)) E(`V6 ${label} performs or names an effect route: ${bad}`);
  }
  if (!/fn run_inert_loop/.test(scm)) E("V6 there is no inert runtime loop");
  {
    const m = /pub fn run_inert_loop[\s\S]*?\n\}/.exec(scm);
    if (m && !/thread::sleep/.test(m[0])) E("V6 the inert loop spins instead of waiting");
    if (m && /fs::|Command|Registry|connect\(/.test(m[0])) E("V6 the inert loop performs work");
  }

  // ---- V7 the binary contract ----
  if (!/name = "ProjectOSHost"/.test(toml)) E("V7 the binary is not named ProjectOSHost");
  if (!/pub const SERVICE_NAME: &str = "ProjectOSHost";/.test(main))
    E("V7 the frozen service name is not pinned");
  if (!/Win32_System_Services/.test(toml)) E("V7 the service feature slice is missing");
  for (const bad of ["Win32_Security_Authorization", "Win32_Networking", "Win32_System_Registry"])
    if (toml.includes(bad)) E("V7 the crate gained an unrelated privileged feature: " + bad);

  // ---- V8 the RELEASE artefact ----
  {
    const exe = path.join(SH, "target", "release", "ProjectOSHost.exe");
    if (!fs.existsSync(exe)) {
      const r = spawnSync(
        "cargo",
        ["build", "--release", "--offline", "--quiet", "--manifest-path", path.join(SH, "Cargo.toml")],
        { encoding: "utf8", cwd: ROOT }
      );
      if (r.status !== 0) E("V8 the release artefact could not be built from committed source");
    }
    if (!fs.existsSync(exe)) E("V8 the release ProjectOSHost.exe was not produced");
    else {
      const resolved = fs.realpathSync(exe);
      if (path.basename(resolved) !== "ProjectOSHost.exe") E("V8 the release artefact is misnamed");
      const low = resolved.toLowerCase();
      if (low.includes("program files") || low.includes("programdata"))
        E("V8 CRITICAL: the release artefact is inside a production root");
      if (!low.startsWith(ROOT.toLowerCase())) E("V8 the artefact is outside the repository build tree");
      if (!resolved.split(path.sep).includes("release")) E("V8 the artefact is not a release build");
    }
  }

  // ---- V9 the release manifest is deterministic and reuses the existing hash contract ----
  for (const [needle, what] of [
    ["PROJECTOS:RELEASE-MANIFEST:V1", "the manifest domain"],
    ["projectos_host_identity::sha256_hex", "the EXISTING hash contract"],
    ["fn put_field", "length-prefixed encoding"],
    ["release_manifest_digest", "the digest carried in the report"],
  ])
    if (!dr.includes(needle)) E("V9 the release manifest is missing " + what);
  if (/sha2::|Sha256::/.test(dr)) E("V9 the composition introduced a second hashing vocabulary");
  {
    // The digest must be COMPUTED over the canonical bytes, not assigned from a literal or copied.
    const m = /pub fn for_artefact\(([\s\S]*?)\n    \}/.exec(dr);
    if (!m) E("V9 the manifest constructor is missing");
    else {
      if (!/let digest = projectos_host_identity::sha256_hex\(&canonical\);/.test(m[1]))
        E("V9 the manifest digest is not computed by sha256_hex over the canonical bytes");
      if (!/sha256_hex\(&bytes\)/.test(m[1]))
        E("V9 the artefact bytes are not hashed");
      if (/"[0-9a-f]{16,}"|repeat\(64\)/.test(m[1]))
        E("V9 the manifest digest contains a literal value");
    }
  }
  {
    const m = /pub struct ReleaseManifest \{([\s\S]*?)\n\}/.exec(dr);
    if (!m) E("V9 the release manifest type is missing");
    else if (/\bpub\s+\w+\s*:/.test(m[1])) E("V9 the release manifest has a public field");
    if (!/const MANIFEST_DOMAIN/.test(dr) || /pub const MANIFEST_DOMAIN/.test(dr))
      E("V9 the manifest domain is caller-visible");
  }

  // ---- V10 the dry run still stops at the frozen gate ----
  {
    const i = dr.indexOf("pub fn production_dry_run(");
    const body = i === -1 ? "" : dr.slice(i);
    if (i === -1) E("V10 the production dry run is missing");
    if (!/ReleaseManifest::for_artefact\(artefact\)/.test(body))
      E("V10 the dry run does not build the release manifest");
    if (!/InstallationEffectAuthority::current\(\)/.test(body))
      E("V10 the dry run no longer consults the frozen effect authority");
    if (!/stopped_at: PlanRefusal::ElevationAbsent/.test(body))
      E("V10 the dry run no longer stops at the refusal");
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
      E(`V11 CRITICAL: validation changed a production root at ${p} (existed=${before} -> ${after})`);
  }

  // ---- compile proofs ----
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) E("SERVICE RUNTIME LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-projectoshost-service-runtime1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-projectoshost-service-runtime1a: PASS");
}
