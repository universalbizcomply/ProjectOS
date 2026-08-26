// Validator: CD-B4-PRODUCTION-IPC-PROVIDER1A
//
// Proves: (1) the sealed core ProductionIpcSessionVerifier is not externally implementable or
// constructible in the default graph and mints BoundIpcSession only crate-internally; (2) the
// windows-local-ipc same-connection evidence bundle is opaque, gated (needs a ConfirmedIpcPeerHandshake),
// move-consuming into core evidence, and never constructs BoundIpcSession; (3) NO evidence type converts
// to authority; (4) the added projectos-host-core path dependency does NOT leak core fixture authority
// into the default or windows-live-ipc graphs (test-fixtures is not propagated by windows-live-ipc); and
// (5) the dependency/manifest boundary is exact (windows 0.61.3 unchanged, no Win32 feature change).
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
const WLI = path.join(HOST, "windows-local-ipc").replace(/\\/g, "/");

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function stripTests(src) {
  const i = src.search(/#\[cfg\((?:all\(test|test)[^\]]*\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
}
function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-production-ipc-provider1a");
  return __SCRATCH_DIR;
}
// depsToml: full [dependencies] body string.
function compileConsumer(name, body, depsToml) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    ["[workspace]", "", "[package]", `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"', 'edition = "2021"', "publish = false", "", "[dependencies]", depsToml, ""].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = cargo(["build", "--offline", "--quiet"], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const CORE_DEP = `projectos-host-core = { path = "${CORE}" }\nprojectos-trust-contract = { path = "${CONTRACT}" }`;
const WLI_DEP = `projectos-host-windows-local-ipc = { path = "${WLI}" }`;
const WLI_LIVE_AND_CORE = `projectos-host-windows-local-ipc = { path = "${WLI}", features = ["windows-live-ipc"] }\nprojectos-host-core = { path = "${CORE}" }`;

const CORE_CONTROL = `
use projectos_host_core::{IpcPeerObservation, ConfirmedHandshakeEvidence, IpcSessionError, BoundIpcSession, ProductionIpcSessionVerifier, IpcSessionVerifier};
fn names(_o: &IpcPeerObservation, _h: &ConfirmedHandshakeEvidence, _e: IpcSessionError, _b: &BoundIpcSession, _v: &ProductionIpcSessionVerifier){}
fn uses_trait<V: IpcSessionVerifier>(_v: &V){}
fn main(){ let _ = names; let _ = uses_trait::<ProductionIpcSessionVerifier>; println!("CONTROL_OK"); }
`;
const WLI_CONTROL = `use projectos_host_windows_local_ipc as _;\nfn main(){ println!("CONTROL_OK"); }`;

const NEGATIVES = [
  // --- core: production verifier + evidence→authority gates ---
  { name: "neg_impl_ipc_verifier", dep: CORE_DEP, why: "IpcSessionVerifier is externally implementable",
    body: `use projectos_host_core::{IpcSessionVerifier, ConnectionLiveness, ChannelCapability, OperationFamily};\nstruct S;\nimpl IpcSessionVerifier for S { fn connection_id(&self)->u64{0} fn handshake_generation(&self)->u64{0} fn liveness(&self)->ConnectionLiveness{ConnectionLiveness::Live} fn max_window(&self)->u64{0} fn max_staleness(&self)->u64{0} fn permitted_capabilities(&self)->&[ChannelCapability]{&[]} fn permitted_families(&self)->&[OperationFamily]{&[]} }\nfn main(){ let _ = S; }` },
  { name: "neg_construct_ipc_verifier_literal", dep: CORE_DEP, why: "ProductionIpcSessionVerifier is caller-constructible via a struct literal",
    body: `use projectos_host_core::ProductionIpcSessionVerifier;\nfn f() -> ProductionIpcSessionVerifier { ProductionIpcSessionVerifier {} }\nfn main(){ let _ = f; }` },
  { name: "neg_ipc_for_local_proof_default", dep: CORE_DEP, why: "ProductionIpcSessionVerifier::for_local_proof reachable in the default graph",
    body: `fn main(){ let _v = projectos_host_core::ProductionIpcSessionVerifier::for_local_proof(); }` },
  { name: "neg_ipc_new_internal", dep: CORE_DEP, why: "ProductionIpcSessionVerifier::new_internal is callable externally",
    body: `fn main(){ let _v = projectos_host_core::ProductionIpcSessionVerifier::new_internal(); }` },
  { name: "neg_obs_into_session", dep: CORE_DEP, why: "IpcPeerObservation converts into BoundIpcSession",
    body: `use projectos_host_core::{IpcPeerObservation, BoundIpcSession};\nfn f(o: IpcPeerObservation) -> BoundIpcSession { o.into() }\nfn main(){ let _ = f; }` },
  { name: "neg_handshake_into_session", dep: CORE_DEP, why: "ConfirmedHandshakeEvidence converts into BoundIpcSession",
    body: `use projectos_host_core::{ConfirmedHandshakeEvidence, BoundIpcSession};\nfn f(h: ConfirmedHandshakeEvidence) -> BoundIpcSession { h.into() }\nfn main(){ let _ = f; }` },
  // --- windows-local-ipc: bundle + fixture surface excluded from the default graph ---
  { name: "neg_bundle_named_default", dep: WLI_DEP, why: "ConfirmedSameConnectionIpcPeerEvidence reachable in the default graph",
    body: `fn f() -> Option<projectos_host_windows_local_ipc::ConfirmedSameConnectionIpcPeerEvidence> { None }\nfn main(){ let _ = f; }` },
  { name: "neg_assemble_default", dep: WLI_DEP, why: "assemble_same_connection_ipc_peer_fixture reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_windows_local_ipc::assemble_same_connection_ipc_peer_fixture; }` },
  { name: "neg_fixture_handshake_default", dep: WLI_DEP, why: "run_fixture_handshake reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_windows_local_ipc::run_fixture_handshake; }` },
  // --- feature isolation: windows-live-ipc must NOT leak core fixture authority ---
  { name: "neg_core_fixture_leak_via_live", dep: WLI_LIVE_AND_CORE, why: "core fixture verifier ctor reachable when windows-live-ipc is enabled (test-fixtures leaked)",
    body: `fn main(){ let _v = projectos_host_core::ProductionIpcSessionVerifier::for_local_proof(); }` },
  { name: "neg_core_grant_leak_via_live", dep: WLI_LIVE_AND_CORE, why: "core fixture clock grant reachable when windows-live-ipc is enabled (test-fixtures leaked)",
    body: `fn main(){ let _ = projectos_host_core::fixture_production_clock_binding_grant; }` },
];

function run() {
  const errors = [];
  const ipc = stripTests(read(path.join(HOST, "core", "src", "ipc_session.rs")));
  const obs = stripTests(read(path.join(WLI, "src", "observation.rs")));
  const adapter = read(path.join(WLI, "src", "adapter.rs"));
  const wliToml = read(path.join(WLI, "Cargo.toml"));
  const coreToml = read(path.join(HOST, "core", "Cargo.toml"));

  // 1. Core ProductionIpcSessionVerifier: sealed, gated construction, redacted, no evidence→authority From.
  if (!/pub struct ProductionIpcSessionVerifier/.test(ipc)) errors.push("missing ProductionIpcSessionVerifier");
  if (!/impl sealed::Sealed for ProductionIpcSessionVerifier/.test(ipc)) errors.push("ProductionIpcSessionVerifier is not sealed");
  if (!/impl IpcSessionVerifier for ProductionIpcSessionVerifier/.test(ipc)) errors.push("ProductionIpcSessionVerifier does not implement the sealed verifier");
  if (!/ProductionIpcSessionVerifier\(\[REDACTED\]\)/.test(ipc)) errors.push("ProductionIpcSessionVerifier Debug is not redacted");
  if (!/pub\(crate\) fn new_internal\(\)/.test(ipc)) errors.push("ProductionIpcSessionVerifier::new_internal is not crate-private");
  {
    const m = ipc.indexOf("pub fn for_local_proof");
    const head = m === -1 ? "" : ipc.slice(Math.max(0, m - 160), m);
    if (m === -1) errors.push("missing ProductionIpcSessionVerifier::for_local_proof");
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(head)) errors.push("for_local_proof is not test-fixtures gated");
  }
  if (/impl[^\n]*From<[^>]*> for BoundIpcSession/.test(ipc)) errors.push("core provides a From into BoundIpcSession (evidence could become authority)");
  if (!/fn mint<V: IpcSessionVerifier/.test(ipc) || /pub fn mint<V/.test(ipc)) errors.push("BoundIpcSession mint is not crate-internal");

  // 2. Same-connection bundle: opaque, redacted, gated, move-consuming projection, no BoundIpcSession construction.
  if (!/#!\[cfg\(any\(feature = "test-fixtures", feature = "windows-live-ipc"\)\)\]/.test(obs)) errors.push("observation module is not gated (test-fixtures|windows-live-ipc)");
  if (!/pub struct ConfirmedSameConnectionIpcPeerEvidence/.test(obs)) errors.push("missing ConfirmedSameConnectionIpcPeerEvidence");
  if (!/ConfirmedSameConnectionIpcPeerEvidence\(\[REDACTED\]\)/.test(obs)) errors.push("bundle Debug is not redacted");
  if (!/handshake: ConfirmedIpcPeerHandshake/.test(obs)) errors.push("bundle does not hold the confirmed handshake (same-connection proof)");
  // AMENDED by PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A: the projection must still be the
  // move-consuming into_core_evidence returning both core evidence values, and it is now STRICTLY
  // NARROWER — crate-private, so `bind_canonical_peer_to_session_evidence` is the only route out of
  // the crate and no caller can reach core evidence without a canonical Match verdict.
  if (!/pub\(crate\) fn into_core_evidence\(self\) -> \(IpcPeerObservation, ConfirmedHandshakeEvidence\)/.test(obs))
    errors.push("projection is not the move-consuming, crate-private into_core_evidence returning both core evidence values");
  if (/\bpub fn into_core_evidence\b/.test(obs))
    errors.push("into_core_evidence is public again (unguarded route to core evidence)");
  // The guarded crossing must exist, consume the attempt, and demand exactly ServiceInstanceBinding::Match.
  if (!/pub fn bind_canonical_peer_to_session_evidence</.test(obs))
    errors.push("the guarded canonical->session crossing is missing");
  // The verdict must be derived by CONSUMING the attempt through the PAIRED finalisation, so the
  // attempt's own captured connection/generation are proven to be the bundle's
  // (PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A). The unpaired `finalise()` would prove
  // peer/service agreement without proving which connection produced it.
  if (!/attempt\.finalise_for_connection\(\s*bundle\.connection_id\(\),\s*bundle\.handshake_generation\(\),?\s*\)/.test(obs))
    errors.push("the crossing does not derive the verdict by consuming the attempt through the paired finalisation");
  if (/attempt\.finalise\(\)/.test(obs))
    errors.push("the crossing uses the UNPAIRED finalise (the attempt-to-bundle pairing would go unproven)");
  if (!/ServiceInstanceBinding::Match => Ok\(bundle\.into_core_evidence\(\)\)/.test(obs))
    errors.push("the crossing does not require exactly ServiceInstanceBinding::Match");
  if (!/bundle\.connection_id\(\) != verifier\.connection_id\(\)/.test(obs))
    errors.push("the crossing does not correlate the bundle connection against the sealed verifier");
  if (!/bundle\.handshake_generation\(\) != verifier\.handshake_generation\(\)/.test(obs))
    errors.push("the crossing does not correlate the handshake generation against the sealed verifier");
  if (/->[^\n]*BoundIpcSession|BoundIpcSession\s*\{|::mint\b/.test(obs)) errors.push("observation bundle constructs/returns BoundIpcSession (must not mint authority)");
  if (/#\[derive\([^)]*(Default|serde)/.test(obs)) errors.push("bundle derives Default/serde");

  // 3. Adapter co-observation is fixture-gated and reuses the real handshake order.
  if (!/pub fn assemble_same_connection_ipc_peer_fixture/.test(adapter)) errors.push("missing adapter same-connection co-observation");
  {
    const m = adapter.indexOf("pub fn assemble_same_connection_ipc_peer_fixture");
    const seg = m === -1 ? "" : adapter.slice(m, m + 2200);
    if (!/run_fixture_handshake\(/.test(seg) || !/into_confirmed\(\)\?/.test(seg)) errors.push("co-observation does not drive the real handshake order + consume the confirmation");
  }
  // The co-observation lives inside the test-fixtures-gated fixture module.
  if (!/#\[cfg\(feature = "test-fixtures"\)\]\nmod fixture_handshake/.test(adapter)) errors.push("fixture_handshake module is not test-fixtures gated");

  // 4. Manifest: core path dep present; windows unchanged 0.61.3; test-fixtures propagates core fixtures; windows-live-ipc does NOT.
  if (!/projectos-host-core = \{ path = "\.\.\/core" \}/.test(wliToml)) errors.push("windows-local-ipc is missing the approved projectos-host-core path dependency");
  if (!/windows = \{ version = "0\.61\.3", optional = true/.test(wliToml)) errors.push("windows dep drifted from the pinned optional 0.61.3");
  for (const f of ["Win32_Foundation", "Win32_Security", "Win32_System_Pipes", "Win32_System_IO", "Win32_Storage_FileSystem", "Win32_System_Threading"])
    if (!wliToml.includes(f)) errors.push("windows dep lost a pre-existing Win32 feature: " + f);
  if (/Win32_System_RemoteDesktop|Win32_System_Services\b/.test(wliToml)) errors.push("windows dep enables a prohibited/new feature");
  {
    const tf = wliToml.indexOf("test-fixtures = [");
    const tfSeg = tf === -1 ? "" : wliToml.slice(tf, wliToml.indexOf("]", tf) + 1);
    if (!/projectos-host-core\/test-fixtures/.test(tfSeg)) errors.push("test-fixtures does not propagate core fixtures for the Level-2 proof");
    const wl = wliToml.indexOf("windows-live-ipc = [");
    const wlSeg = wl === -1 ? "" : wliToml.slice(wl, wliToml.indexOf("]", wl) + 1);
    if (/projectos-host-core\/test-fixtures/.test(wlSeg)) errors.push("windows-live-ipc leaks core/test-fixtures (fixture authority into the live graph)");
  }
  // 5. core stays windows-free.
  if (/^\s*windows\b|windows =/.test(coreToml)) errors.push("host/core depends on windows (must remain windows-free)");

  // 6. Compile proofs.
  const ctlCore = compileConsumer("prodipc_control_core", CORE_CONTROL, CORE_DEP);
  if (!ctlCore.ok) errors.push("DEFAULT-graph core control failed to compile (setup broken):\n" + ctlCore.out.slice(0, 1400));
  const ctlWli = compileConsumer("prodipc_control_wli", WLI_CONTROL, WLI_DEP);
  if (!ctlWli.ok) errors.push("DEFAULT-graph wli control failed to compile (setup broken):\n" + ctlWli.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.dep);
    if (r.ok) errors.push("PRODUCTION-IPC FORGERY / FIXTURE LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }
  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-production-ipc-provider1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-production-ipc-provider1a: PASS");
}
