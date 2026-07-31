// Validator: CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER1A
//
// Fails closed. Proves the INERT Windows owner-verification adapter crate:
//  - is bounded to its exact crate boundary, pins windows 0.61.3 with exactly the nine required features,
//    depends on no Tauri / core / windows-sys / getrandom / rand / zeroize / async runtime;
//  - exposes NO public live-verification entrypoint, NO public evidence constructor, NO public
//    raw-HWND/binding constructor, and NO Cargo-feature-enableable synthetic constructor (synthetic is
//    #[cfg(test)]-only);
//  - maps every non-success availability/result value fail-closed (incl. unknown future values);
//  - enforces local-console-only session policy and a mandatory owner-SID comparison;
//  - uses an MTA worker whose late/superseded results are non-authoritative and whose panic fails closed;
//  - generates a 32-byte BCryptGenRandom nonce, retains no raw nonce in evidence, and builds a
//    domain/version-tagged SHA-256 (no XOR) proof digest;
//  - redacts Debug on evidence/binding/nonce, stubs non-Windows fail-closed, and keeps EXECUTION_READY
//    false / installation NotAuthorised;
//  - and (rustc negative compiles) cannot, from a downstream crate, construct evidence or a binding, call
//    the live path, supply a numeric HWND, clone/copy evidence, enable a synthetic constructor, or reach a
//    ProductionOwnerPresence capability/grant.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const CRATE = path.join(HOST, "windows-owner-verification");
const CRATE_PATH = CRATE.replace(/\\/g, "/");
const SRC = path.join(CRATE, "src");

const REQUIRED_FEATURES = [
  "Security_Credentials_UI",
  "Foundation",
  "Win32_Foundation",
  "Win32_System_WinRT",
  "Win32_UI_WindowsAndMessaging",
  "Win32_System_RemoteDesktop",
  "Win32_System_Threading",
  "Win32_Security",
  "Win32_Security_Cryptography",
];
const FORBIDDEN_CRATES = [
  "tauri",
  "windows-sys",
  "getrandom",
  "rand",
  "rand_core",
  "zeroize",
  "tokio",
  "async-std",
  "projectos-host-core",
];

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function stripTests(src) {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
}
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  let depth = 0;
  let i = src.indexOf("{", start);
  if (i === -1) return "";
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-windows-user-verification-adapter1a");
  return __SCRATCH_DIR;
}
function compileConsumer(name, body, features) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat =
    features && features.length
      ? `, features = [${features.map((f) => `"${f}"`).join(", ")}]`
      : "";
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
      `projectos-host-windows-owner-verification = { path = "${CRATE_PATH}"${feat} }`,
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

const CONTROL = `
use projectos_host_windows_owner_verification as owner;
fn names(_e: &owner::VerifiedWindowsOwnerEvidence, _b: &owner::TrustedControlCentreWindowBinding, _s: owner::PlatformOwnerVerificationStatus, _err: owner::OwnerVerificationError){}
fn getters(e: &owner::VerifiedWindowsOwnerEvidence) -> ([u8;32], u64) { (e.proof_digest(), e.generation()) }
fn main(){
    assert!(owner::WINDOWS_OWNER_VERIFICATION_IS_INERT);
    assert!(!owner::LIVE_OWNER_VERIFICATION_RUN);
    let _ = owner::platform_owner_verification_status();
    let _e = owner::OwnerVerificationError::ConsentNotVerified;
    let _ = (names, getters);
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_evidence_struct_literal",
    why: "VerifiedWindowsOwnerEvidence is caller-constructible via a struct literal",
    body: `use projectos_host_windows_owner_verification as owner;\nfn f() -> owner::VerifiedWindowsOwnerEvidence { owner::VerifiedWindowsOwnerEvidence { proof_digest: [0u8;32], generation: 0 } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_binding_struct_literal",
    why: "TrustedControlCentreWindowBinding is caller-constructible via a struct literal",
    body: `use projectos_host_windows_owner_verification as owner;\nfn f() -> owner::TrustedControlCentreWindowBinding { owner::TrustedControlCentreWindowBinding { } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_binding_from_observed",
    why: "TrustedControlCentreWindowBinding::from_observed (crate-internal) is reachable downstream",
    body: `use projectos_host_windows_owner_verification as owner;\nfn main(){ let _ = owner::TrustedControlCentreWindowBinding::from_observed; }`,
  },
  {
    name: "neg_binding_synthetic",
    why: "the #[cfg(test)] synthetic binding constructor is reachable downstream",
    body: `use projectos_host_windows_owner_verification as owner;\nfn main(){ let _ = owner::TrustedControlCentreWindowBinding::synthetic; }`,
  },
  {
    name: "neg_run_inert_verification",
    why: "the pub(crate) orchestration run_inert_verification is reachable downstream",
    body: `fn main(){ let _ = projectos_host_windows_owner_verification::run_inert_verification; }`,
  },
  {
    name: "neg_live_verify_module",
    why: "the private verification_ffi::live_verify entrypoint is reachable downstream",
    body: `fn main(){ let _ = projectos_host_windows_owner_verification::verification_ffi::live_verify; }`,
  },
  {
    name: "neg_worker_ctor",
    why: "the pub(crate) MtaWorkerRequest is constructible downstream",
    body: `fn main(){ let _ = projectos_host_windows_owner_verification::MtaWorkerRequest::new(1); }`,
  },
  {
    name: "neg_evidence_clone",
    why: "VerifiedWindowsOwnerEvidence implements Clone",
    body: `use projectos_host_windows_owner_verification as owner;\nfn req<T: Clone>(){}\nfn main(){ req::<owner::VerifiedWindowsOwnerEvidence>(); }`,
  },
  {
    name: "neg_evidence_copy",
    why: "VerifiedWindowsOwnerEvidence implements Copy",
    body: `use projectos_host_windows_owner_verification as owner;\nfn req<T: Copy>(){}\nfn main(){ req::<owner::VerifiedWindowsOwnerEvidence>(); }`,
  },
  {
    name: "neg_binding_clone",
    why: "TrustedControlCentreWindowBinding implements Clone",
    body: `use projectos_host_windows_owner_verification as owner;\nfn req<T: Clone>(){}\nfn main(){ req::<owner::TrustedControlCentreWindowBinding>(); }`,
  },
  {
    name: "neg_enable_test_fixtures_feature",
    why: "a downstream crate can enable a test-fixtures feature to reach synthetic construction",
    features: ["test-fixtures"],
    body: `fn main(){}`,
  },
  {
    name: "neg_production_capability",
    why: "a ProductionOwnerPresenceCapability is reachable from this adapter",
    body: `fn main(){ let _ = projectos_host_windows_owner_verification::ProductionOwnerPresenceCapability::new_internal(); }`,
  },
  {
    name: "neg_production_grant",
    why: "a ProductionOwnerPresenceBindingGrant is reachable from this adapter",
    body: `use projectos_host_windows_owner_verification as owner;\nfn f(_g: owner::ProductionOwnerPresenceBindingGrant){}\nfn main(){ let _ = f; }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  // ---- boundary: exact files present ----
  for (const rel of [
    "Cargo.toml",
    "Cargo.lock",
    "src/lib.rs",
    "src/verification_ffi.rs",
    "src/window.rs",
    "src/sid.rs",
    "src/session.rs",
    "src/nonce.rs",
    "tests/inert_surface.rs",
  ]) {
    if (!fs.existsSync(path.join(CRATE, rel))) E("V1 missing mandatory path: " + rel);
  }
  if (errors.length) return errors;

  const toml = read(path.join(CRATE, "Cargo.toml"));
  const lib = read(path.join(SRC, "lib.rs"));
  const libNoTests = stripTests(lib);
  const ffi = read(path.join(SRC, "verification_ffi.rs"));
  const win = read(path.join(SRC, "window.rs"));
  const winNoTests = stripTests(win);
  const ses = read(path.join(SRC, "session.rs"));
  const sidSrc = read(path.join(SRC, "sid.rs"));
  const non = read(path.join(SRC, "nonce.rs"));
  const nonNoTests = stripTests(non);

  // ---- V2 pinned windows version ----
  if (!/windows\s*=\s*\{\s*version\s*=\s*"0\.61\.3"/.test(toml))
    E("V2 windows is not pinned to 0.61.3");
  if (!/windows-future\s*=\s*\{\s*version\s*=\s*"0\.2\.1"/.test(toml))
    E("V2 windows-future is not pinned to 0.2.1");

  // ---- V3 exact Windows feature set (all present; no SCM/pipe/registry feature) ----
  for (const f of REQUIRED_FEATURES)
    if (!toml.includes(`"${f}"`)) E("V3 missing required windows feature: " + f);
  for (const bad of [
    "Win32_System_Services",
    "Win32_System_Registry",
    "Win32_System_Pipes",
    "Win32_Networking",
  ])
    if (toml.includes(`"${bad}"`)) E("V3 unexpected out-of-scope windows feature: " + bad);

  // ---- V4 / dependency hygiene ----
  for (const c of FORBIDDEN_CRATES) {
    const re = new RegExp("(^|\\n)\\s*" + c.replace(/[-]/g, "\\-") + "\\s*=", "m");
    if (re.test(toml)) E("V4 forbidden dependency present: " + c);
  }
  if (!/sha2\s*=\s*"0\.10"/.test(toml)) E("V4 sha2 0.10 dependency missing");
  if (!/windows-live-owner-verification\s*=\s*\[\s*"dep:windows"\s*,\s*"dep:windows-future"\s*\]/.test(toml))
    E("V4 live feature does not gate exactly windows + windows-future");

  // ---- V29 EXECUTION_READY stays false / V30 no install authority in the crate ----
  if (/EXECUTION_READY\s*=\s*true/i.test(lib + ffi)) E("V29 EXECUTION_READY set true");
  if (!/LIVE_OWNER_VERIFICATION_RUN: bool = false/.test(lib)) E("V29 LIVE run flag not false");
  for (const inst of ["InstallationAuthority", "install_service", "CreateServiceW", "StartServiceW"])
    if ((lib + ffi).includes(inst)) E("V30 crate references installation/service authority: " + inst);

  // ---- V6 no public live verification fn ----
  if (!/pub\(crate\) fn run_inert_verification\(/.test(libNoTests))
    E("V6 run_inert_verification is not pub(crate)");
  if (/\bpub fn run_inert_verification\(/.test(lib)) E("V6 run_inert_verification is public");
  if (!/pub\(crate\) fn live_verify\(/.test(ffi)) E("V6 live_verify is not pub(crate)");
  if (/\bpub fn live_verify\(/.test(ffi)) E("V6 live_verify is public");
  // the FFI module is private (declared without `pub`) and feature+windows gated.
  if (!/#\[cfg\(all\(windows, feature = "windows-live-owner-verification"\)\)\]\s*\nmod verification_ffi;/.test(lib))
    E("V6 verification_ffi module is not private + gated");

  // ---- V7 no public raw-HWND constructor / accessor ----
  if (/pub fn [a-z_]+\([^)]*HWND/.test(winNoTests) || /pub fn [a-z_]+\([^)]*HWND/.test(libNoTests))
    E("V7 a public fn accepts a raw HWND");
  if (/pub fn [a-z_]+\([^)]*\)\s*->\s*HWND/.test(win + lib)) E("V7 a public fn returns a raw HWND");
  // The bare binding mint is MODULE-PRIVATE (post-freeze Option 2 amendment, superseding the original
  // `pub(crate)` expectation): confining it to `window.rs` makes the sealed ControlCentreWindowVerifier the
  // only thing that can reach it, so no other adapter module — including the gated live FFI — can mint.
  // Anchored on the full signature so neither prose nor a doc comment can satisfy or trip either check.
  if (!/(^|\n)\s*fn from_observed\(observation: WindowObservation, binding_digest: \[u8; 32\]\) -> Self/.test(winNoTests))
    E("V7 binding from_observed is not module-private");
  if (/\bpub(\(crate\))?\s+fn from_observed\(observation: WindowObservation/.test(winNoTests))
    E("V7 binding from_observed is pub or pub(crate) (must be module-private)");

  // ---- V8 synthetic constructor is #[cfg(test)]-only ----
  if (!/#\[cfg\(test\)\]\s*\n\s*pub\(crate\) fn synthetic\(/.test(win))
    E("V8 synthetic binding constructor is not #[cfg(test)] gated");
  // ---- V9 no `test-fixtures` feature (so no downstream-enableable synthetic ctor) ----
  // BOUNDED POST-FREEZE AMENDMENT (CD-B4-PRODUCTION-OWNER-PRESENCE-CAPABILITY-BRIDGE1A, Option B):
  // the original blanket "no fixture feature of any kind" is stale. Exactly ONE narrowly named,
  // non-default test-evidence feature is now permitted — `fixture-owner-evidence` — so the owner-presence
  // bridge can prove the observation -> evidence -> presence chain. The `test-fixtures` prohibition below
  // is UNCHANGED, and V9b/V9c bound the new feature so it cannot become a general fixture surface.
  // Strip TOML comments first (validator-comment-scanning lesson): manifest PROSE explaining that the
  // feature is deliberately NOT named `test-fixtures` must not satisfy or trip this absence check.
  const tomlCode = toml.replace(/#.*/g, "");
  if (/test-fixtures/.test(tomlCode)) E("V9 a test-fixtures feature exists (downstream-enableable)");
  if (/feature = "test-fixtures"/.test(lib + win + ffi + non + ses + sidSrc))
    E("V9 a constructor is gated on a test-fixtures feature");
  {
    // V9b: the permitted feature is non-default and pulls NO dependency (so it can link no Windows API).
    const featureBlock = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(tomlCode) || [])[1] || "";
    const declared = [...featureBlock.matchAll(/^\s*([a-z0-9-]+)\s*=\s*\[([^\]]*)\]/gm)];
    const ALLOWED = new Set(["default", "windows-live-owner-verification", "fixture-owner-evidence"]);
    for (const [, name, body] of declared) {
      if (!ALLOWED.has(name)) E("V9b unexpected adapter feature: " + name);
      if (name === "fixture-owner-evidence" && body.trim() !== "")
        E("V9b the fixture-evidence feature pulls a dependency (it must pull none)");
      if (name === "default" && body.trim() !== "")
        E("V9b the adapter default feature set is not empty");
    }
    // V9c: the fixture producer must never reach a live Windows/consent surface.
    // Scope to the fixture producer's OWN body, on comment-stripped source. Scanning to end-of-file
    // swept in unrelated prose and error strings elsewhere in lib.rs and produced a false positive.
    const libCode = lib.replace(/\/\/.*/g, "");
    const fixtureGated = fnBody(libCode, "pub fn fixture_owner_evidence(");
    if (!fixtureGated && /fixture-owner-evidence/.test(tomlCode))
      E("V9c the fixture-evidence feature is declared but its producer is missing");
    for (const sym of [
      "UserConsentVerifier",
      "RequestVerificationForWindow",
      "RoInitialize",
      "BCryptGenRandom",
      "windows::",
    ])
      if (fixtureGated.includes(sym))
        E("V9c the fixture-evidence producer references a live Windows surface: " + sym);
    // V9d: evidence from the fixture route must be permanently identifiable as fixture evidence.
    if (!/pub fn is_fixture\(&self\) -> bool/.test(lib))
      E("V9d evidence carries no fixture marker");
    if (!/fixture: true/.test(lib)) E("V9d the fixture producer does not mark its evidence");
    if (!/fixture: false/.test(lib)) E("V9d the live mint does not clear the fixture marker");
  }

  // ---- V10 evidence has no public constructor ----
  {
    const dbg = /impl core::fmt::Debug for VerifiedWindowsOwnerEvidence/.test(lib);
    if (!dbg) E("V10/V26 evidence lacks a manual Debug impl");
    if (/pub fn (new|mint|from_[a-z_]+)\([^)]*\)\s*->\s*Self/.test(fnBlockAround(lib, "impl VerifiedWindowsOwnerEvidence")))
      E("V10 evidence exposes a public constructor");
    if (!/\n    fn mint\(proof_digest: \[u8; 32\], generation: u64\) -> Self/.test(lib))
      E("V10 evidence mint is not private");
  }

  // ---- V11 evidence not Clone/Copy/serde ----
  {
    const s = lib.indexOf("pub struct VerifiedWindowsOwnerEvidence");
    const head = s === -1 ? "" : lib.slice(Math.max(0, s - 200), s);
    if (/#\[derive\([^)]*(Clone|Copy|Serialize|Deserialize)/.test(head))
      E("V11 evidence derives Clone/Copy/serde");
  }
  if (/impl (Clone|Copy) for VerifiedWindowsOwnerEvidence/.test(lib))
    E("V11 evidence implements Clone/Copy");
  if (/Serialize|Deserialize|serde/.test(lib + win + ffi + non + ses + sidSrc))
    E("V11 crate references serde");

  // ---- V12 no capability.issue / no ProductionOwnerPresence*; no core dep ----
  if (/\.issue\(/.test(lib + ffi)) E("V12 crate calls .issue(");
  if (/ProductionOwnerPresenceCapability/.test(lib + ffi)) E("V12 crate references a production capability");
  // ---- V13 no production binding grant output ----
  if (/ProductionOwnerPresenceBindingGrant/.test(lib + ffi)) E("V13 crate references a production grant");

  // ---- V14 no renderer / src-tauri / tauri references (code, not prose) ----
  if (/^\s*tauri\s*=/m.test(toml) || /\buse\s+tauri\b|\btauri::/.test(lib + ffi + win + ses + sidSrc + non))
    E("V14 crate has a Tauri dependency or import");

  // ---- V15 no real ceremony in tests + live feature is not default-enabled ----
  {
    const testMod = fnBody(lib, "mod tests");
    const integ = read(path.join(CRATE, "tests", "inert_surface.rs"));
    for (const sym of ["live_verify", "RequestVerificationForWindowAsync", "RoInitialize", "BCryptGenRandom"])
      if ((testMod + integ).includes(sym)) E("V15 a test invokes the live ceremony: " + sym);
    if (/default\s*=\s*\[[^\]]*windows-live-owner-verification/.test(toml))
      E("V15 the live feature is enabled by default");
  }

  // ---- V16 exhaustive fail-closed availability mapping ----
  {
    const body = fnBody(libNoTests, "pub(crate) fn availability_permits");
    if (!/ConsentAvailability::Available => Ok\(\(\)\)/.test(body))
      E("V16 availability mapping does not permit only Available");
    if (!/Unknown\(_\)\s*=>\s*Err/.test(body) && !/Unknown\(_\) =>/.test(body) && !/\| ConsentAvailability::Unknown\(_\)/.test(body))
      E("V16 availability mapping does not fail closed on Unknown");
    if ((body.match(/Ok\(\(\)\)/g) || []).length !== 1) E("V16 availability mapping has more than one success arm");
    if (/_\s*=>\s*Ok\(\(\)\)/.test(body)) E("V16 availability mapping has a wildcard success arm");
  }
  // ---- V17 exhaustive fail-closed result mapping ----
  {
    const body = fnBody(libNoTests, "pub(crate) fn result_permits");
    if (!/ConsentResult::Verified => Ok\(\(\)\)/.test(body))
      E("V17 result mapping does not permit only Verified");
    if (!/\| ConsentResult::Unknown\(_\)/.test(body) && !/Unknown\(_\)\s*=>\s*Err/.test(body))
      E("V17 result mapping does not fail closed on Unknown");
    if ((body.match(/Ok\(\(\)\)/g) || []).length !== 1) E("V17 result mapping has more than one success arm");
    if (/_\s*=>\s*Ok\(\(\)\)/.test(body)) E("V17 result mapping has a wildcard success arm");
  }

  // ---- V18 local-console-only session policy ----
  if (!/pub\(crate\) const WTS_PROTOCOL_CONSOLE: u32 = 0;/.test(ses))
    E("V18 WTS console constant is not 0");
  if (!/client_protocol_type != WTS_PROTOCOL_CONSOLE\s*\{[\s\S]*?RemoteSession/.test(ses))
    E("V18 session policy does not fail closed on a remote protocol");
  if (!/active_console_session != obs.window_session[\s\S]*?NotActiveConsole/.test(ses))
    E("V18 session policy does not require the active console session");

  // ---- V19 mandatory owner-SID comparison ----
  if (!/equals_configured_owner\s*\{[\s\S]*?OwnerSidMismatch/.test(sidSrc))
    E("V19 SID policy does not require the configured owner match");
  if (!/sid_permits\(&input.sid\)\?/.test(lib)) E("V19 orchestration does not enforce the SID policy");

  // ---- V20 MTA worker; no event-loop block; single-request completion ----
  if (!/RoInitialize\(RO_INIT_MULTITHREADED\)/.test(ffi)) E("V20 FFI does not initialise an MTA apartment");
  if (!/pub\(crate\) struct MtaWorkerRequest/.test(lib)) E("V20 MTA worker contract missing");

  // ---- V21 late-result invalidation ----
  {
    const body = fnBody(lib, "pub(crate) fn complete(");
    if (
      !(
        /delivered_generation == self\.generation/.test(body) &&
        /WorkerState::Pending/.test(body) &&
        /matches!/.test(body)
      )
    )
      E("V21 completion does not require matching generation + pending state");
  }
  if (!/LateResultDiscarded/.test(lib)) E("V21 no LateResultDiscarded reason");

  // ---- V22 BCryptGenRandom 32-byte nonce ----
  if (!/BCryptGenRandom\(None, &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG\)/.test(ffi))
    E("V22 FFI does not use BCryptGenRandom with the system-preferred RNG");
  if (!/pub\(crate\) const NONCE_LEN: usize = 32;/.test(non)) E("V22 nonce length is not 32");
  if (!/assert!\(NONCE_LEN == 32\)/.test(lib)) E("V22 nonce length invariant not asserted");

  // ---- V23 no XOR digest / SHA-256 domain-separated ----
  {
    const body = fnBody(libNoTests, "pub(crate) fn compute_evidence_digest");
    if (body.includes("^")) E("V23 digest construction contains an XOR");
    if (!/Sha256::new\(\)/.test(body)) E("V23 digest is not SHA-256");
    if (!/feed_var\(&mut h, DOMAIN_TAG\)/.test(body)) E("V24 digest does not feed the domain tag first");
  }
  // ---- V24 canonical domain/version tag ----
  if (!/DOMAIN_TAG: &\[u8\] = b"PROJECTOS:WINDOWS-OWNER-PRESENCE-EVIDENCE:V1";/.test(lib))
    E("V24 domain/version tag is not the frozen constant");

  // ---- V25 nonce not retained in evidence ----
  {
    const body = fnBody(lib, "pub struct VerifiedWindowsOwnerEvidence");
    if (/nonce|sid|hwnd|token|Sid|Hwnd/i.test(body)) E("V25 evidence retains a raw nonce/sid/hwnd/token field");
    if (!/proof_digest: \[u8; 32\]/.test(body) || !/generation: u64/.test(body))
      E("V25 evidence does not carry only the digest + generation");
  }

  // ---- V26 redacted Debug on evidence / binding / nonce ----
  if (!/VerifiedWindowsOwnerEvidence\(gen=\{\}, \[REDACTED\]\)/.test(lib)) E("V26 evidence Debug not redacted");
  if (!/TrustedControlCentreWindowBinding\(\[REDACTED\]\)/.test(win)) E("V26 binding Debug not redacted");
  if (!/TrustedNonce\(\[REDACTED\]\)/.test(non)) E("V26 nonce Debug not redacted");
  // nonce is move-only (no Clone/Copy) and zeroised on drop with a fence.
  if (/#\[derive\([^)]*(Clone|Copy)/.test(nonNoTests.slice(0, nonNoTests.indexOf("pub(crate) struct TrustedNonce") + 1) + "")) {
    // fallthrough — checked below by explicit head slice
  }
  {
    const s = non.indexOf("pub(crate) struct TrustedNonce");
    const head = s === -1 ? "" : non.slice(Math.max(0, s - 160), s);
    if (/#\[derive\([^)]*(Clone|Copy)/.test(head)) E("V26 nonce derives Clone/Copy");
  }
  if (!/impl Drop for TrustedNonce/.test(non) || !/compiler_fence\(Ordering::SeqCst\)/.test(non))
    E("V26 nonce is not zeroised on drop with a compiler fence");

  // ---- V27 non-Windows stub ----
  if (!/#\[cfg\(not\(windows\)\)\][\s\S]*?PlatformOwnerVerificationStatus::Unsupported/.test(lib))
    E("V27 non-Windows path does not return Unsupported");

  // ---- V28 crate-local lockfile present ----
  if (!fs.existsSync(path.join(CRATE, "Cargo.lock"))) E("V28 crate-local Cargo.lock missing");

  // ---- compile proofs ----
  const control = compileConsumer("adapter_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1800));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.features);
    if (r.ok) E("ADAPTER FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

// Return the text block of an `impl <name> { ... }` (best-effort brace match) so member-visibility checks
// are scoped to that impl.
function fnBlockAround(src, header) {
  return fnBody(src, header);
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-windows-user-verification-adapter1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-windows-user-verification-adapter1a: PASS");
}
