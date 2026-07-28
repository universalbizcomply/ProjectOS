// Validator: CD-B4-PRODUCTION-RUNTIME-PROVIDER1A
//
// Proves: (1) the production-clock binding is gated by an opaque, move-consumed, no-public-ctor,
// non-Clone ProductionClockBindingGrant so an arbitrary MonotonicTickSource cannot forge trusted time;
// (2) the sealed ProductionRuntimeInstanceVerifier refuses Fixture and is not caller-constructible in the
// default graph; (3) the windows-runtime-observation crate reads only host-SELF identity with unsafe
// confined to observation_ffi and the approved minimum Win32 surface (Foundation + Threading only, no
// RemoteDesktop/SCM/pipe), mints no authority, and is excluded from the default graph.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const CORE = path.join(HOST, "core").replace(/\\/g, "/");
const CONTRACT = path.join(HOST, "contract").replace(/\\/g, "/");
const OBS = path.join(HOST, "windows-runtime-observation").replace(/\\/g, "/");

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function stripTests(src) {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
}
function workdir() {
  return path.join(os.tmpdir(), "projectos-val-prod-runtime");
}
// dep: "core" (default) or "obs"
function compileConsumer(name, body, dep) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const deps =
    dep === "obs"
      ? `projectos-host-windows-runtime-observation = { path = "${OBS}" }`
      : `projectos-host-core = { path = "${CORE}" }\nprojectos-trust-contract = { path = "${CONTRACT}" }`;
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]", "", "[package]", `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"', 'edition = "2021"', "publish = false", "", "[dependencies]", deps, "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = spawnSync("cargo", ["build", "--offline", "--quiet"], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const CORE_CONTROL = `
use projectos_host_core::{RuntimeInstanceObservation, RuntimeInstanceError, HostRole, RuntimeSource, ProductionClockBindingGrant, bind_production_clock, MonotonicTickSource, TickSourceError};
struct S;
impl MonotonicTickSource for S { fn tick(&self)->Result<u64,TickSourceError>{Ok(0)} fn epoch_seed(&self)->u64{0} fn is_live(&self)->bool{true} }
fn takes_grant(_g: ProductionClockBindingGrant){}
fn names(_o: &RuntimeInstanceObservation, _e: RuntimeInstanceError, _r: HostRole, _s: RuntimeSource){ let _ = bind_production_clock::<S>; }
fn main(){ let _ = takes_grant; let _ = names; println!("CONTROL_OK"); }
`;

const OBS_CONTROL = `
use projectos_host_windows_runtime_observation::{HostProcessObservation, interactive_fallback_observation, LiveRuntimeObservationCapability, WINDOWS_RUNTIME_OBSERVATION_IS_CONTRACT_ONLY};
fn names(_o: &HostProcessObservation, _c: &LiveRuntimeObservationCapability){ let _ = interactive_fallback_observation; }
fn main(){ assert!(WINDOWS_RUNTIME_OBSERVATION_IS_CONTRACT_ONLY); let _ = names; println!("CONTROL_OK"); }
`;

const IMPL_SRC = `struct S;\nimpl projectos_host_core::MonotonicTickSource for S { fn tick(&self)->Result<u64,projectos_host_core::TickSourceError>{Ok(0)} fn epoch_seed(&self)->u64{0} fn is_live(&self)->bool{true} }\n`;

const NEGATIVES = [
  // --- clock-binding grant gate (B1, B2, B3, B5, B10) ---
  { name: "neg_bind_without_grant", dep: "core", why: "bind_production_clock is callable without a grant",
    body: `${IMPL_SRC}fn main(){ let _c = projectos_host_core::bind_production_clock(S, 1u64); }` },
  { name: "neg_construct_grant_literal", dep: "core", why: "ProductionClockBindingGrant is caller-constructible via a struct literal",
    body: `use projectos_host_core::ProductionClockBindingGrant;\nfn f() -> ProductionClockBindingGrant { ProductionClockBindingGrant {} }\nfn main(){ let _ = f; }` },
  { name: "neg_grant_mint_pub", dep: "core", why: "ProductionClockBindingGrant::mint is callable externally",
    body: `fn main(){ let _g = projectos_host_core::ProductionClockBindingGrant::mint(); }` },
  { name: "neg_fixture_grant_default", dep: "core", why: "fixture_production_clock_binding_grant reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_core::fixture_production_clock_binding_grant; }` },
  { name: "neg_grant_clone", dep: "core", why: "ProductionClockBindingGrant is Clone (single-use defeated)",
    body: `use projectos_host_core::ProductionClockBindingGrant;\nfn f(g: ProductionClockBindingGrant){ let _ = g.clone(); }\nfn main(){ let _ = f; }` },
  { name: "neg_bind_pub", dep: "core", why: "ProductionTrustedClock::bind is callable externally",
    body: `${IMPL_SRC}fn main(){ let _c = projectos_host_core::ProductionTrustedClock::bind(S, 1); }` },
  // --- production runtime verifier (R12/R13-adjacent, construction gate) ---
  { name: "neg_verifier_for_local_proof_default", dep: "core", why: "ProductionRuntimeInstanceVerifier::for_local_proof reachable in the default graph",
    body: `fn main(){ let _v = projectos_host_core::ProductionRuntimeInstanceVerifier::for_local_proof(); }` },
  { name: "neg_verifier_new_internal", dep: "core", why: "ProductionRuntimeInstanceVerifier::new_internal is callable externally",
    body: `fn main(){ let _v = projectos_host_core::ProductionRuntimeInstanceVerifier::new_internal(); }` },
  // --- observation crate: capability + observation not caller-constructible; live provider excluded ---
  { name: "neg_obs_capability_literal", dep: "obs", why: "LiveRuntimeObservationCapability is caller-constructible via a struct literal",
    body: `use projectos_host_windows_runtime_observation::LiveRuntimeObservationCapability;\nfn f() -> LiveRuntimeObservationCapability { LiveRuntimeObservationCapability {} }\nfn main(){ let _ = f; }` },
  { name: "neg_obs_capability_synth_default", dep: "obs", why: "the live observation capability synthetic ctor reachable in the default graph",
    body: `fn main(){ let _c = projectos_host_windows_runtime_observation::LiveRuntimeObservationCapability::synthetic_for_fixture(); }` },
  { name: "neg_hostobs_literal", dep: "obs", why: "HostProcessObservation is caller-constructible via a struct literal",
    body: `use projectos_host_windows_runtime_observation::HostProcessObservation;\nfn f() -> HostProcessObservation { HostProcessObservation { pid: 1, creation_time: 1 } }\nfn main(){ let _ = f; }` },
  { name: "neg_live_source_default", dep: "obs", why: "WindowsRuntimeObservationSource reachable in the default graph",
    body: `fn main(){ let _ = core::any::type_name::<projectos_host_windows_runtime_observation::WindowsRuntimeObservationSource>(); }` },
];

function run() {
  const errors = [];
  const at = stripTests(read(path.join(HOST, "core", "src", "authority_time.rs")));
  const ri = stripTests(read(path.join(HOST, "core", "src", "runtime_instance.rs")));
  const lib = stripTests(read(path.join(OBS, "src", "lib.rs")));
  const ffi = read(path.join(OBS, "src", "observation_ffi.rs"));
  const obsToml = read(path.join(OBS, "Cargo.toml"));
  const coreToml = read(path.join(HOST, "core", "Cargo.toml"));

  // 1. ProductionClockBindingGrant: opaque, redacted, crate-private mint, not Clone/Copy/Default, gates binder.
  if (!/pub struct ProductionClockBindingGrant/.test(at)) errors.push("missing ProductionClockBindingGrant");
  if (!/ProductionClockBindingGrant\(\[REDACTED\]\)/.test(at)) errors.push("ProductionClockBindingGrant Debug is not redacted");
  {
    const s = at.indexOf("pub struct ProductionClockBindingGrant");
    const head = s === -1 ? "" : at.slice(Math.max(0, s - 120), s);
    if (/#\[derive\([^)]*(Clone|Copy|Default)/.test(head)) errors.push("ProductionClockBindingGrant derives Clone/Copy/Default");
  }
  if (/impl (Clone|Copy|Default) for ProductionClockBindingGrant/.test(at)) errors.push("ProductionClockBindingGrant implements Clone/Copy/Default");
  if (!/pub\(crate\) fn mint\(\) -> Self/.test(at)) errors.push("ProductionClockBindingGrant::mint is not crate-private");
  if (!/pub fn bind_production_clock<S: MonotonicTickSource>\(\s*grant: ProductionClockBindingGrant/.test(at))
    errors.push("bind_production_clock does not consume a ProductionClockBindingGrant by value");
  if (!/pub\(crate\) fn bind\(/.test(at) || /pub fn bind\(/.test(at)) errors.push("ProductionTrustedClock::bind is not crate-private");
  {
    // fixture grant mint must be test-fixtures gated.
    const m = at.indexOf("pub fn fixture_production_clock_binding_grant");
    const head = m === -1 ? "" : at.slice(Math.max(0, m - 160), m);
    if (m === -1) errors.push("missing fixture_production_clock_binding_grant");
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(head)) errors.push("fixture grant mint is not test-fixtures gated");
  }

  // 2. ProductionRuntimeInstanceVerifier: sealed, refuses Fixture, gen not caller-selectable, redacted, gated ctor.
  if (!/pub struct ProductionRuntimeInstanceVerifier/.test(ri)) errors.push("missing ProductionRuntimeInstanceVerifier");
  if (!/impl sealed::Sealed for ProductionRuntimeInstanceVerifier/.test(ri)) errors.push("ProductionRuntimeInstanceVerifier is not sealed");
  if (!/impl RuntimeInstanceVerifier for ProductionRuntimeInstanceVerifier/.test(ri)) errors.push("ProductionRuntimeInstanceVerifier does not implement the sealed verifier");
  if (!/ProductionRuntimeInstanceVerifier\(gen=\{\}, \[REDACTED\]\)/.test(ri)) errors.push("ProductionRuntimeInstanceVerifier Debug is not redacted");
  {
    // the production accepts_source must allow only the two closed modes and never Fixture.
    const i = ri.indexOf("impl RuntimeInstanceVerifier for ProductionRuntimeInstanceVerifier");
    const b = i === -1 ? "" : ri.slice(i, i + 900);
    const as = b.indexOf("fn accepts_source");
    const body = as === -1 ? "" : b.slice(as, b.indexOf("}", b.indexOf("matches!", as)) + 1);
    if (!/WindowsService \| RuntimeSource::InteractiveFallback/.test(body)) errors.push("production verifier does not accept exactly the two closed modes");
    if (/Fixture/.test(body)) errors.push("production verifier accepts the Fixture source");
  }
  {
    const m = ri.indexOf("pub fn for_local_proof");
    const head = m === -1 ? "" : ri.slice(Math.max(0, m - 160), m);
    if (m === -1) errors.push("missing ProductionRuntimeInstanceVerifier::for_local_proof");
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(head)) errors.push("for_local_proof is not test-fixtures gated");
  }
  if (!/pub\(crate\) fn new_internal\(\)/.test(ri)) errors.push("new_internal is not crate-private");
  // No evidence-to-authority conversion: a runtime instance is minted ONLY by the sealed verifier.
  if (/impl[^\n]*From<[^>]*> for VerifiedRuntimeInstance/.test(ri)) errors.push("core provides a From into VerifiedRuntimeInstance (evidence could become authority)");

  // 3. core stays windows-free.
  if (/^\s*windows\b|windows =/.test(coreToml)) errors.push("host/core depends on windows (must remain windows-free)");

  // 4. observation crate: self-only FFI, unsafe confined, minimum surface, no authority mint, redacted, contract-only.
  if (/\bunsafe\b/.test(lib.replace(/\[REDACTED\]/g, ""))) errors.push("unsafe appears outside observation_ffi (lib.rs)");
  if (!/#!\[cfg\(all\(windows, feature = "windows-live-runtime-observation"\)\)\]/.test(ffi)) errors.push("observation_ffi is not gated all(windows, windows-live-runtime-observation)");
  for (const need of ["GetCurrentProcessId", "GetCurrentProcess", "GetProcessTimes"])
    if (!ffi.includes(need)) errors.push("observation_ffi does not use the required self API: " + need);
  for (const banned of ["ProcessIdToSessionId", "OpenProcess", "QueryServiceStatusEx", "GetNamedPipeClientProcessId", "OpenSCManager", "LookupAccountName", "RegOpenKey", "SetSystemTime", "socket", "CreateService"])
    if (ffi.includes(banned)) errors.push("observation_ffi references a prohibited API: " + banned);
  if (/->\s*VerifiedRuntimeInstance|VerifiedRuntimeInstance\s*\{|impl[^\n]*for VerifiedRuntimeInstance/.test(lib)) errors.push("observation crate constructs VerifiedRuntimeInstance (must not mint runtime authority)");
  if (/impl .*From.* for (VerifiedRuntimeInstance|VerifiedAuthorityTime)/.test(lib)) errors.push("observation crate authors runtime/temporal authority");
  if (!/LIVE_RUNTIME_OBSERVATION_RUN: bool = false/.test(lib)) errors.push("LIVE_RUNTIME_OBSERVATION_RUN is not false");
  if (!/HostProcessObservation\(\[REDACTED\]\)/.test(lib) || !/LiveRuntimeObservationCapability\(\[REDACTED\]\)/.test(lib)) errors.push("observation crate evidence/capability Debug not redacted");
  {
    const m = lib.indexOf("pub fn synthetic_for_fixture");
    const head = m === -1 ? "" : lib.slice(Math.max(0, m - 120), m);
    if (m === -1) errors.push("missing LiveRuntimeObservationCapability::synthetic_for_fixture");
    else if (!/cfg\(feature = "test-fixtures"\)/.test(head)) errors.push("live observation capability ctor is not test-fixtures gated");
  }

  // 5. observation manifest: windows dep gated + optional + target-specific + EXACTLY Foundation + Threading.
  if (!/windows-live-runtime-observation = \[/.test(obsToml) || !/"dep:windows"/.test(obsToml)) errors.push("windows-live-runtime-observation feature does not gate the windows dep");
  if (!/\[target\.'cfg\(windows\)'\.dependencies\]/.test(obsToml)) errors.push("windows dep is not target-specific");
  if (!/windows = \{ version = "0\.61\.3", optional = true/.test(obsToml)) errors.push("windows dep is not the pinned optional 0.61.3");
  for (const f of ["Win32_Foundation", "Win32_System_Threading"])
    if (!obsToml.includes(f)) errors.push("windows dep missing required feature: " + f);
  if (/Win32_System_RemoteDesktop|Win32_System_Services|Win32_System_Pipes|Win32_Security|Win32_Networking|Registry/.test(obsToml)) errors.push("windows dep enables a prohibited feature (RemoteDesktop/SCM/pipe/security/etc)");

  // 6. Compile proofs.
  const ctlCore = compileConsumer("prodrt_control_core", CORE_CONTROL, "core");
  if (!ctlCore.ok) errors.push("DEFAULT-graph core control failed to compile (setup broken):\n" + ctlCore.out.slice(0, 1400));
  const ctlObs = compileConsumer("prodrt_control_obs", OBS_CONTROL, "obs");
  if (!ctlObs.ok) errors.push("DEFAULT-graph obs control failed to compile (setup broken):\n" + ctlObs.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.dep);
    if (r.ok) errors.push("RUNTIME-PROVIDER FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-production-runtime-provider1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-production-runtime-provider1a: PASS");
}
