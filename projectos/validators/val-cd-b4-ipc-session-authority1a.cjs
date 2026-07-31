// Validator: CD-B4-IPC-SESSION-AUTHORITY1A
//
// Proves the IPC-session authority is opaque and sealed-verifier-minted: an external caller cannot
// construct/forge/clone/copy/serialise a BoundIpcSession, cannot convert a handshake/observation/bool
// into authority, cannot reach the fixture verifier in the default graph, and cannot mutate the bound
// identity. Structural checks + default-graph compile proofs + a positive control.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const CORE = path.join(HOST, "core").replace(/\\/g, "/");
const CONTRACT = path.join(HOST, "contract").replace(/\\/g, "/");

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function strip(src) {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
}
function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-ipc-session-authority1a");
  return __SCRATCH_DIR;
}
function compileConsumer(name, body, features) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat = features && features.length ? `, features = [${features.map((f) => `"${f}"`).join(", ")}]` : "";
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
      `projectos-host-core = { path = "${CORE}"${feat} }`,
      `projectos-trust-contract = { path = "${CONTRACT}" }`,
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

// Default-graph control: production-visible IPC-session API compiles without any fixture feature.
const CONTROL = `
use projectos_host_core::{ChannelCapability, OperationFamily, PeerUserClass, IpcPeerObservation, IpcSessionError, ConfirmedHandshakeEvidence, ExpectedPeer};
use projectos_host_core::SessionId;
use projectos_trust_contract::{ProjectId, EnvironmentId};
fn main(){
    let _o = IpcPeerObservation {
        connection_id: 1, handshake_generation: 1, client_pid: 1, client_creation_tick: 1,
        user: PeerUserClass::Owner, session: Some(SessionId::new("s")),
        project: ProjectId::new("p").unwrap(), environment: EnvironmentId::new("e").unwrap(),
        phase_digest: [0u8;32], repository_identity: [0u8;32], repository_baseline: [0u8;32],
        observed_at: 1, valid_until: 2,
        capabilities: vec![ChannelCapability::RecordMarker], operation_families: vec![OperationFamily::RecordMarker],
    };
    let _h = ConfirmedHandshakeEvidence::confirmed(1);
    let _p = ExpectedPeer { pid: 1, creation_tick: 1, user: PeerUserClass::Owner, session: None };
    let _e: Option<IpcSessionError> = None;
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  { name: "neg_construct", feat: [], why: "BoundIpcSession constructed directly",
    body: `use projectos_host_core::BoundIpcSession;\nfn main(){ let _s = BoundIpcSession{}; }` },
  { name: "neg_default", feat: [], why: "BoundIpcSession has Default",
    body: `use projectos_host_core::BoundIpcSession;\nfn main(){ let _s: BoundIpcSession = Default::default(); }` },
  { name: "neg_clone", feat: [], why: "BoundIpcSession is Clone",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(s: BoundIpcSession){ let _c: BoundIpcSession = s.clone(); }\nfn main(){ let _ = f; }` },
  { name: "neg_copy", feat: [], why: "BoundIpcSession is Copy",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(s: BoundIpcSession){ let _a = s; let _b = s; }\nfn main(){ let _ = f; }` },
  { name: "neg_from_bool", feat: [], why: "a Boolean converts into IPC-session authority",
    body: `use projectos_host_core::BoundIpcSession;\nfn main(){ let _s = BoundIpcSession::from(true); }` },
  { name: "neg_from_handshake", feat: [], why: "a confirmed handshake converts into IPC-session authority",
    body: `use projectos_host_core::{BoundIpcSession, ConfirmedHandshakeEvidence};\nfn f(h: ConfirmedHandshakeEvidence){ let _s = BoundIpcSession::from(h); }\nfn main(){ let _ = f; }` },
  { name: "neg_from_observation", feat: [], why: "an observation converts into IPC-session authority",
    body: `use projectos_host_core::{BoundIpcSession, IpcPeerObservation};\nfn f(o: IpcPeerObservation){ let _s = BoundIpcSession::from(o); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_connection", feat: [], why: "the bound connection id is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.connection_id = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_handshake_gen", feat: [], why: "the bound handshake generation is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.handshake_generation = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_runtime_gen", feat: [], why: "the bound runtime generation is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.runtime_generation = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_pid", feat: [], why: "the bound peer pid is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.client_pid = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_creation_tick", feat: [], why: "the bound peer creation tick is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.client_creation_tick = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_project", feat: [], why: "the bound project is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nuse projectos_trust_contract::ProjectId;\nfn f(mut s: BoundIpcSession){ s.project = ProjectId::new("x").unwrap(); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_repo_baseline", feat: [], why: "the bound repository baseline is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.repository_baseline = [0u8;32]; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_provider", feat: [], why: "the bound provider identity is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.provider_id = String::new(); }\nfn main(){ let _ = f; }` },
  { name: "neg_extend_valid_until", feat: [], why: "the bound validity boundary is caller-mutable",
    body: `use projectos_host_core::BoundIpcSession;\nfn f(mut s: BoundIpcSession){ s.valid_until = 999_999; }\nfn main(){ let _ = f; }` },
  { name: "neg_expand_capabilities", feat: [], why: "the bound capabilities are caller-mutable",
    body: `use projectos_host_core::{BoundIpcSession, ChannelCapability};\nfn f(mut s: BoundIpcSession){ s.capabilities.push(ChannelCapability::ObserveOnly); }\nfn main(){ let _ = f; }` },
  { name: "neg_expand_families", feat: [], why: "the bound operation families are caller-mutable",
    body: `use projectos_host_core::{BoundIpcSession, OperationFamily};\nfn f(mut s: BoundIpcSession){ s.operation_families.push(OperationFamily::ReservedNoAdapter); }\nfn main(){ let _ = f; }` },
  { name: "neg_fixture_verifier_default_graph", feat: [], why: "FixtureIpcSessionVerifier is reachable in the default graph",
    body: `fn main(){ let _v = projectos_host_core::FixtureIpcSessionVerifier::new(); }` },
  { name: "neg_call_mint", feat: [], why: "the crate-internal mint is reachable externally",
    body: `use projectos_host_core::ipc_session;\nfn main(){ let _ = ipc_session::mint; }` },
];

function run() {
  const errors = [];
  const src = strip(read(path.join(HOST, "core", "src", "ipc_session.rs")));
  const raw = read(path.join(HOST, "core", "src", "ipc_session.rs"));
  const lib = read(path.join(HOST, "core", "src", "lib.rs"));

  // 1. Opaque authority type.
  if (!/pub struct BoundIpcSession\b/.test(src)) errors.push("missing type: BoundIpcSession");
  const decl = src.slice(src.indexOf("pub struct BoundIpcSession"));
  const body = decl.slice(0, decl.indexOf("}"));
  if (/\bpub\s+\w+:/.test(body)) errors.push("BoundIpcSession has a public field (must be opaque)");
  if (/#\[derive\([^)]*\b(Clone|Copy|Default|Serialize|Deserialize)\b[^)]*\)\]\s*pub struct BoundIpcSession/.test(src))
    errors.push("BoundIpcSession derives a forbidden trait");
  if (!/impl fmt::Debug for BoundIpcSession\b/.test(src)) errors.push("BoundIpcSession has no hand-written Debug");
  if (!/BoundIpcSession\(conn=\[REDACTED\]/.test(raw)) errors.push("BoundIpcSession Debug is not redacted");
  if (!/PhantomData<\*const \(\)>/.test(src)) errors.push("BoundIpcSession is not thread-bound (!Send + !Sync)");
  if (/impl From<[^>]*> for BoundIpcSession/.test(src))
    errors.push("BoundIpcSession has a From (handshake/observation/bool could become authority)");
  if (/derive\([^)]*\b(Serialize|Deserialize)\b|use serde|serde::|#\[serde\b/.test(src))
    errors.push("ipc_session references serialisation");

  // Handshake evidence is single-use (not Clone/Copy) and redacted.
  if (/#\[derive\([^)]*\b(Clone|Copy)\b[^)]*\)\]\s*pub struct ConfirmedHandshakeEvidence/.test(src))
    errors.push("ConfirmedHandshakeEvidence is Clone/Copy (must be single-use)");
  if (!/ConfirmedHandshakeEvidence\(\[REDACTED\]\)/.test(raw)) errors.push("ConfirmedHandshakeEvidence Debug is not redacted");

  // 2. Sealed verifier + private mint.
  if (!/mod sealed \{\s*pub trait Sealed \{\}/.test(src.replace(/\s+/g, " ")))
    errors.push("verifier is not sealed via a private Sealed trait");
  if (!/pub trait IpcSessionVerifier: sealed::Sealed/.test(src)) errors.push("IpcSessionVerifier is not sealed");
  if (!/\nfn mint<V: IpcSessionVerifier/.test(src)) errors.push("mint is not crate-private");
  if (/pub fn mint\b/.test(src)) errors.push("mint is public");

  // 3. Structured refusal taxonomy.
  for (const e of ["HandshakeNotConfirmed", "RuntimeInstanceMismatch", "ProviderMismatch", "ProviderEpochMismatch", "ConnectionMismatch", "HandshakeGenerationMismatch", "Disconnected", "Revoked", "PeerProcessMismatch", "PeerUserMismatch", "PeerSessionMismatch", "ProjectMismatch", "EnvironmentMismatch", "PhaseMismatch", "RepositoryIdentityMismatch", "RepositoryBaselineMismatch", "CapabilityNotPermitted", "OperationFamilyNotPermitted", "Expired", "ExpiryBeyondBound", "StaleObservation"])
    if (!new RegExp("\\b" + e + "\\b").test(src)) errors.push("missing refusal variant: " + e);

  // 4. is_current folds the load-bearing comparisons + handshake evidence is consumed (moved) by mint.
  const cur = src.slice(src.indexOf("fn is_current"));
  const curBody = cur.slice(0, cur.indexOf("fn matches_peer"));
  for (const needle of ["runtime.generation()", "runtime.instance_digest()", "now.provider_id()", "now.epoch()", "verifier.connection_id()", "verifier.handshake_generation()", "verifier.liveness()", "self.valid_until"])
    if (!curBody.includes(needle)) errors.push("is_current does not compare: " + needle);
  if (!/handshake: ConfirmedHandshakeEvidence/.test(src)) errors.push("mint does not consume ConfirmedHandshakeEvidence by move");
  if (!/handshake\.is_confirmed\(\)/.test(src)) errors.push("mint does not require a confirmed handshake");

  // 5. Fixture verifier feature-gated in both the module and the lib re-export.
  if (!/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\]\s*\npub use fixture::FixtureIpcSessionVerifier;/.test(src))
    errors.push("FixtureIpcSessionVerifier is not test-gated in the module");
  {
    const lines = lib.split("\n");
    const idx = lines.findIndex((l) => l.includes("FixtureIpcSessionVerifier") && l.trim().startsWith("pub use"));
    if (idx === -1) errors.push("FixtureIpcSessionVerifier not re-exported");
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(lines[idx - 1]))
      errors.push("FixtureIpcSessionVerifier re-export is not test-gated");
  }

  // 6. Compile proofs.
  const ctl = compileConsumer("ipc_control", CONTROL, []);
  if (!ctl.ok) errors.push("DEFAULT-graph control failed to compile (setup broken):\n" + ctl.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.feat);
    if (r.ok) errors.push("IPC-SESSION AUTHORITY FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-ipc-session-authority1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-ipc-session-authority1a: PASS");
}
