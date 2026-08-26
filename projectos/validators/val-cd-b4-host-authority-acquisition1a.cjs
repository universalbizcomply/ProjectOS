// Validator: CD-B4-PRODUCTION-HOST-AUTHORITY-ACQUISITION1A (post-freeze security correction, Option A)
//
// Fails closed. Proves the corrected host-authority acquisition model:
//  - corroboration confirms a FRESH self-acquirer (AcquiredToken + InteractiveFallback/ServiceRuntime),
//    which the original rule made permanently impossible;
//  - a client connection never confirms, and a fresh create with no evidence stays unconfirmed;
//  - ConfirmedAuthorityGuard::confirm REQUIRES AcquiredToken, so a guard can never own one token while
//    attesting that another process is authoritative (ExistingToken is refused outright);
//  - the acquisition policy checks interactive / local-console / session / identity BEFORE token
//    contention, and never consults permits_startup();
//  - the fixture acquisition route is gated and absent from the default graph;
//  - and (rustc negative compiles) a downstream crate cannot reach the fixture route, the policy, the
//    observation type, or construct a guard.
"use strict";
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
const AUTH = path.join(ROOT, "projectos", "host", "host-authority");
const AUTH_PATH = AUTH.replace(/\\/g, "/");

const read = (p) => fs.readFileSync(p, "utf8");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};
const stripLine = (s) => s.replace(/\/\/.*/g, "");

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-host-authority-acquisition1a");
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
      `projectos-host-authority = { path = "${AUTH_PATH}" }`,
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

const CONTROL = `
use projectos_host_authority::acquisition::HostAuthorityAcquisitionRefusal as R;
use projectos_host_authority::model as m;
fn main(){
    let _ = R::NotInteractive;
    let _ = projectos_host_authority::acquisition::LOCAL_CONSOLE_PROTOCOL;
    let _ = m::AuthorityPeerState::corroborate(m::AuthorityTokenOutcome::AcquiredToken, None);
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_fixture_acquire_default_graph",
    why: "the fixture acquisition route is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_authority::acquisition::acquire_local_console_authority_for_local_proof; }`,
  },
  {
    name: "neg_policy_downstream",
    why: "the acquisition policy is callable downstream",
    body: `fn main(){ let _ = projectos_host_authority::acquisition::local_console_authority_permits; }`,
  },
  {
    name: "neg_observation_downstream",
    why: "the observation type is nameable downstream",
    body: `use projectos_host_authority::acquisition::HostAuthorityObservation;\nfn f(_o: HostAuthorityObservation){}\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_guard_struct_literal",
    why: "ConfirmedAuthorityGuard is constructible via a struct literal",
    body: `use projectos_host_authority::model as m;\nfn f() -> m::ConfirmedAuthorityGuard { m::ConfirmedAuthorityGuard{} }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_guard_clone",
    why: "ConfirmedAuthorityGuard is Clone",
    body: `use projectos_host_authority::model as m;\nfn req<T: Clone>(){}\nfn main(){ req::<m::ConfirmedAuthorityGuard>(); }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const acqPath = path.join(AUTH, "src", "acquisition.rs");
  if (!fs.existsSync(acqPath)) {
    E("V1 missing mandatory path: " + acqPath);
    return errors;
  }
  const acq = stripLine(stripTests(read(acqPath)));
  const model = read(path.join(AUTH, "src", "model.rs"));
  const modelCode = stripLine(stripTests(model));

  // ---- V2 corroboration confirms a FRESH self-acquirer (the corrected defect) ----
  for (const [peer, state] of [
    ["InteractiveFallback", "InteractiveFallbackConfirmed"],
    ["ServiceRuntime", "ServiceRuntimeConfirmed"],
  ]) {
    const re = new RegExp(
      "\\(AuthorityTokenOutcome::AcquiredToken, Some\\(ConfirmedPeer::" +
        peer +
        "\\)\\)\\s*=>\\s*\\{?\\s*AuthorityPeerState::" +
        state
    );
    if (!re.test(modelCode)) E("V2 a fresh acquirer with " + peer + " evidence is not confirmed");
  }
  // ---- V3 a client connection and bare fresh create still refuse ----
  if (!/\(AuthorityTokenOutcome::AcquiredToken, Some\(ConfirmedPeer::ClientConnection\)\)\s*=>\s*\{?\s*AuthorityPeerState::AuthorityUncertain/.test(modelCode))
    E("V3 a fresh create corroborated as a client connection is not refused");
  if (!/\(AuthorityTokenOutcome::AcquiredToken, None\)\s*=>\s*AuthorityPeerState::Uncorroborated/.test(modelCode))
    E("V3 a fresh create without evidence is not left unconfirmed");

  // ---- V4 confirm() requires that THIS process acquired the token ----
  {
    const i = modelCode.indexOf("pub fn confirm(");
    const body = i === -1 ? "" : modelCode.slice(i, modelCode.indexOf("\n    }", i));
    if (i === -1) E("V4 confirm is missing");
    if (!/if outcome != AuthorityTokenOutcome::AcquiredToken\s*\{\s*return Err\(/.test(body))
      E("V4 confirm does not require AcquiredToken (a guard could attest another process)");
    const gate = body.indexOf("outcome != AuthorityTokenOutcome::AcquiredToken");
    const corr = body.indexOf("AuthorityPeerState::corroborate");
    if (gate === -1 || corr === -1 || gate > corr)
      E("V4 the token-ownership gate does not precede corroboration");
    if (/permits_startup\(\)/.test(body)) E("V4 confirm consults permits_startup");
  }

  // ---- V5 acquisition policy: context checks precede token contention ----
  {
    const i = acq.indexOf("fn local_console_authority_permits");
    const body = i === -1 ? "" : acq.slice(i);
    if (i === -1) E("V5 the acquisition policy is missing");
    const order = [
      "obs.interactive",
      "obs.client_protocol_type != LOCAL_CONSOLE_PROTOCOL",
      "obs.process_session != obs.active_console_session",
      "obs.identity_matches",
    ].map((n) => body.indexOf(n));
    if (order.some((x) => x === -1)) E("V5 a required context check is missing");
    const tokenAt = body.indexOf("AuthorityTokenOutcome::ExistingToken");
    for (const x of order)
      if (x > tokenAt) E("V5 a context check runs after token contention");
    if (/permits_startup\(\)/.test(body)) E("V5 the policy consults permits_startup");
    if (!/AuthorityPeerState::corroborate\(/.test(body))
      E("V5 the policy does not derive the state via the frozen corroborate rule");
  }

  // ---- V6 the fixture acquisition route is gated ----
  if (!/#\[cfg\(all\(\s*any\(test, feature = "effect-witness-fixtures"\)/.test(read(acqPath)))
    E("V6 the fixture acquisition route is not gated on the pure contract-fixture feature");
  // ---- V7 no new dependency, no unsafe, no Windows API in the policy ----
  if (/\bunsafe\b/.test(acq)) E("V7 the acquisition policy contains unsafe");
  for (const t of ["windows::", "GetCurrentProcess", "WTSGetActiveConsoleSessionId"])
    if (acq.includes(t)) E("V7 the pure policy references a live Windows surface: " + t);
  {
    const deps = /\n\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(read(path.join(AUTH, "Cargo.toml")));
    if (deps && /^\s*[a-z0-9_-]+\s*=/m.test(deps[1]))
      E("V7 host-authority gained an unconditional dependency");
  }

  // ---- compile proofs ----
  const control = compileConsumer("haa_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1500));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) E("HOST-AUTHORITY ACQUISITION LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-host-authority-acquisition1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-host-authority-acquisition1a: PASS");
}
