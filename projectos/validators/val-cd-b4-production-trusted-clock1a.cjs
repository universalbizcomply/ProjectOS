// Validator: CD-B4-PRODUCTION-TRUSTED-CLOCK1A
//
// Proves the production trusted clock is sealed and caller-inaccessible, uses ONLY monotonic time (no
// wall clock) for security currentness, keeps unsafe Windows FFI confined to one gated module with no
// service/SID/registry/network surface, and cannot be forged or converted from evidence into authority.
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
const HOST = path.join(ROOT, "projectos", "host");
const CORE = path.join(HOST, "core").replace(/\\/g, "/");
const CONTRACT = path.join(HOST, "contract").replace(/\\/g, "/");
const WINCLOCK = path.join(HOST, "windows-clock").replace(/\\/g, "/");

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function strip(src) {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
}
function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-production-trusted-clock1a");
  return __SCRATCH_DIR;
}
// dep: "core" (default) or "winclock"
function compileConsumer(name, body, features, dep) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat = features && features.length ? `, features = [${features.map((f) => `"${f}"`).join(", ")}]` : "";
  const deps =
    dep === "winclock"
      ? `projectos-host-windows-clock = { path = "${WINCLOCK}"${feat} }`
      : `projectos-host-core = { path = "${CORE}"${feat} }\nprojectos-trust-contract = { path = "${CONTRACT}" }`;
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]", "", "[package]", `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"', 'edition = "2021"', "publish = false", "", "[dependencies]", deps, "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = cargo(["build", "--offline", "--quiet"], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const CONTROL = `
use projectos_host_core::{AuthorityTimeError, TrustedClock, MonotonicTickSource, TickSourceError};
fn f<S: MonotonicTickSource>(_s: &S){}
fn g<C: TrustedClock>(c: &C){ let _ = c.read_current(); }
fn main(){ let _e: Option<AuthorityTimeError> = None; let _t: Option<TickSourceError> = None; println!("CONTROL_OK"); }
`;

const NEGATIVES = [
  { name: "neg_construct_prod_clock", dep: "core", feat: [], why: "ProductionTrustedClock::bind is callable externally",
    body: `use projectos_host_core::{ProductionTrustedClock, MonotonicTickSource, TickSourceError};\nstruct S;\nimpl MonotonicTickSource for S { fn tick(&self)->Result<u64,TickSourceError>{Ok(0)} fn epoch_seed(&self)->u64{0} fn is_live(&self)->bool{true} }\nfn main(){ let _c = ProductionTrustedClock::bind(S, 1); }` },
  { name: "neg_construct_vat", dep: "core", feat: [], why: "VerifiedAuthorityTime is caller-constructible",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn main(){ let _t = VerifiedAuthorityTime::new("x", 1, 1); }` },
  { name: "neg_vat_from_u64", dep: "core", feat: [], why: "a u64 converts into VerifiedAuthorityTime",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn main(){ let _t = VerifiedAuthorityTime::from(1u64); }` },
  { name: "neg_try_read_direct", dep: "core", feat: [], why: "try_read_current is callable externally",
    body: `use projectos_host_core::{ProductionTrustedClock, FixtureMonotonicTickSource};\nfn f(c: &ProductionTrustedClock<FixtureMonotonicTickSource>){ let _ = c.try_read_current(); }\nfn main(){ let _ = f; }` },
  { name: "neg_fixture_tick_default", dep: "core", feat: [], why: "FixtureMonotonicTickSource reachable in the default graph",
    body: `use projectos_host_core::FixtureMonotonicTickSource;\nfn main(){ let _s = FixtureMonotonicTickSource::new(1, 1); }` },
  { name: "neg_fixture_bind_default", dep: "core", feat: [], why: "fixture_bind_production_clock reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_core::fixture_bind_production_clock; }` },
  { name: "neg_win_capability_ctor", dep: "winclock", feat: [], why: "the live clock capability is caller-constructible",
    body: `fn main(){ let _c = projectos_host_windows_clock::LiveClockObservationCapability::synthetic_for_fixture(); }` },
  { name: "neg_win_capability_literal", dep: "winclock", feat: [], why: "the live clock capability is caller-constructible via a struct literal",
    body: `use projectos_host_windows_clock::LiveClockObservationCapability;\nfn f() -> LiveClockObservationCapability { LiveClockObservationCapability {} }\nfn main(){ let _ = f; }` },
  { name: "neg_win_evidence_literal", dep: "winclock", feat: [], why: "ClockTickEvidence is caller-constructible via a struct literal",
    body: `use projectos_host_windows_clock::ClockTickEvidence;\nfn f() -> ClockTickEvidence { ClockTickEvidence { tick: 1, seed: 1 } }\nfn main(){ let _ = f; }` },
];

function run() {
  const errors = [];
  const at = strip(read(path.join(HOST, "core", "src", "authority_time.rs")));
  const win = read(path.join(HOST, "windows-clock", "src", "lib.rs"));
  const ffi = read(path.join(HOST, "windows-clock", "src", "clock_ffi.rs"));
  const winToml = read(path.join(HOST, "windows-clock", "Cargo.toml"));
  const coreToml = read(path.join(HOST, "core", "Cargo.toml"));

  // 1. Core clock: sealed TrustedClock, no wall clock, opaque, no public ctor, redacted, epoch derived.
  if (!/pub struct ProductionTrustedClock<S: MonotonicTickSource>/.test(at)) errors.push("missing ProductionTrustedClock");
  if (!/impl<S: MonotonicTickSource> TrustedClock for ProductionTrustedClock<S>/.test(at)) errors.push("ProductionTrustedClock is not a sealed TrustedClock");
  if (!/pub\(crate\) fn bind\(/.test(at) || /pub fn bind\(/.test(at)) errors.push("ProductionTrustedClock::bind is not crate-private");
  if (/SystemTime|GetSystemTime|UNIX_EPOCH|chrono|std::time::SystemTime/.test(at)) errors.push("core clock references wall-clock time (must be monotonic only)");
  if (!/ProductionTrustedClock\(\[REDACTED\]\)/.test(at)) errors.push("ProductionTrustedClock Debug is not redacted");
  if (!/fn derive_epoch\(seed: u64\)/.test(at) || !/PROJECTOS:CLOCK-EPOCH:V1/.test(at)) errors.push("epoch is not derived opaquely");
  if (/impl From<[^>]*> for VerifiedAuthorityTime/.test(at)) errors.push("VerifiedAuthorityTime has a From (evidence could become authority)");
  if (!/pub trait MonotonicTickSource/.test(at)) errors.push("missing MonotonicTickSource trait");
  for (const e of ["ClockUnavailable", "ShutdownObserved", "ReadingRegressed", "ClockDiscontinuity", "ConversionFailed"])
    if (!new RegExp("AuthorityTimeError::" + e + "|\\b" + e + ",").test(at)) errors.push("missing clock refusal variant: " + e);
  // The checked read enforces the load-bearing comparisons.
  {
    const t = at.indexOf("fn try_read_current");
    const b = t === -1 ? "" : at.slice(t, at.indexOf("impl<S: MonotonicTickSource> sealed", t));
    for (const n of ["self.poisoned.get()", "self.source.is_live()", "tick < last", "self.max_forward_jump"])
      if (!b.includes(n)) errors.push("try_read_current does not check: " + n);
  }

  // 2. core stays windows-free.
  if (/^\s*windows\b|windows =/.test(coreToml)) errors.push("host/core depends on windows (must remain windows-free)");

  // 3. windows-clock: unsafe confined to clock_ffi, no service/SID/registry/network, biased monotonic.
  if (/\bunsafe\b/.test(win.replace(/\[REDACTED\]/g, ""))) errors.push("unsafe appears outside clock_ffi (lib.rs)");
  if (!/#!\[cfg\(all\(windows, feature = "windows-live-clock"\)\)\]/.test(ffi)) errors.push("clock_ffi is not gated all(windows, windows-live-clock)");
  if (!/GetTickCount64/.test(ffi)) errors.push("clock_ffi does not use the biased monotonic GetTickCount64");
  // Scan the FFI module (actual Win32 calls) for prohibited APIs — not lib.rs doc prose.
  for (const banned of ["QueryServiceStatusEx", "OpenSCManager", "LookupAccountName", "RegOpenKey", "RegCreateKey", "SetSystemTime", "socket", "WSAStartup", "CreateService", "SetSecurityInfo"])
    if (new RegExp(banned).test(ffi)) errors.push("windows-clock FFI references a prohibited API: " + banned);
  for (const t of ["ProductionTrustedClock", "VerifiedAuthorityTime", "ExecutionPermit", "BoundedEffectGrant"])
    if (new RegExp("impl (TrustedClock|.*From).* for " + t).test(win)) errors.push("windows-clock mints/authors " + t);
  if (!/impl MonotonicTickSource for WindowsMonotonicTickSource/.test(win)) errors.push("windows-clock does not implement the core evidence trait");
  if (!/LIVE_CLOCK_RUN: bool = false/.test(win)) errors.push("LIVE_CLOCK_RUN is not false");
  if (!/LiveClockObservationCapability\(\[REDACTED\]\)/.test(win) || !/ClockTickEvidence\(\[REDACTED\]\)/.test(win)) errors.push("windows-clock evidence/capability Debug not redacted");

  // 4. windows-clock manifest: windows dep gated + optional + target-specific + minimum features.
  if (!/windows-live-clock = \["dep:windows"\]/.test(winToml)) errors.push("windows-live-clock feature does not gate the windows dep");
  if (!/\[target\.'cfg\(windows\)'\.dependencies\]/.test(winToml)) errors.push("windows dep is not target-specific");
  if (!/windows = \{ version = "0\.61\.3", optional = true/.test(winToml)) errors.push("windows dep is not the pinned optional 0.61.3");
  for (const f of ["Win32_Foundation", "Win32_System_SystemInformation", "Win32_System_Threading"])
    if (!winToml.includes(f)) errors.push("windows dep missing required feature: " + f);
  if (/Win32_Security|Win32_System_Services|Win32_Networking|Registry/.test(winToml)) errors.push("windows dep enables a prohibited feature");

  // 5. Compile proofs.
  const ctl = compileConsumer("prodclock_control", CONTROL, [], "core");
  if (!ctl.ok) errors.push("DEFAULT-graph control failed to compile (setup broken):\n" + ctl.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.feat, neg.dep);
    if (r.ok) errors.push("TRUSTED-CLOCK FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-production-trusted-clock1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-production-trusted-clock1a: PASS");
}
