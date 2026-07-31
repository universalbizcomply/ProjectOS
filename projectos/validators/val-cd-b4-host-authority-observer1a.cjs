// Validator: CD-B4-PRODUCTION-HOST-AUTHORITY-WIN32-OBSERVER1A
//
// Fails closed. Proves the live Windows host-authority observer:
//  - all six facts are obtained INTERNALLY (process id, session, active console, protocol, station,
//    canonical identity) and none is accepted from a caller;
//  - identity comes ONLY from the closed canonical installation identity contract — never a hardcoded
//    true, username, exe path, CWD, PackagedCandidate or PerMachineEvidenceMatched;
//  - every Windows query failure maps to a refusal, never a permissive default;
//  - the observer produces FACTS ONLY: it acquires no token and constructs no ConfirmedAuthorityGuard,
//    capability, grant or effect;
//  - it is behind ONE non-default Windows feature and is absent from the default and non-Windows graphs;
//  - the localised known-folder constants have not drifted from the upstream activation-plan contract;
//  - and (rustc negative compiles) downstream cannot reach the observer or the observation type.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const AUTH = path.join(HOST, "host-authority");
const IDENT = path.join(HOST, "host-identity");
const PLAN = path.join(HOST, "windows-host-activation-plan");
const AUTH_PATH = AUTH.replace(/\\/g, "/");

const read = (p) => fs.readFileSync(p, "utf8");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};
const stripLine = (s) => s.replace(/\/\/.*/g, "");

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-host-authority-observer1a");
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
  const r = spawnSync("cargo", ["build", "--offline", "--quiet"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const CONTROL = `
use projectos_host_authority::acquisition::HostAuthorityAcquisitionRefusal as R;
fn main(){ let _ = R::RemoteSession; println!("CONTROL_OK"); }
`;

const NEGATIVES = [
  {
    name: "neg_observer_module_downstream",
    why: "the observer module is reachable downstream",
    body: `fn main(){ let _ = projectos_host_authority::acquisition_win32::observe_host_context; }`,
  },
  {
    name: "neg_observation_type_downstream",
    why: "the observation type is nameable downstream",
    body: `use projectos_host_authority::acquisition::HostAuthorityObservation;\nfn f(_o: HostAuthorityObservation){}\nfn main(){ let _ = f; }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const obsPath = path.join(AUTH, "src", "acquisition_win32.rs");
  if (!fs.existsSync(obsPath)) {
    E("V1 missing mandatory path: " + obsPath);
    return errors;
  }
  const obs = read(obsPath);
  const obsCode = stripLine(stripTests(obs));
  const toml = read(path.join(AUTH, "Cargo.toml")).replace(/#.*/g, "");

  // ---- V2 one non-default Windows feature; module gated ----
  if (!/windows-host-authority-observer = \[/.test(toml))
    E("V2 the observer feature is missing");
  if (!/default = \[\]/.test(toml)) E("V2 the crate default feature set is not empty");
  if (!/#!\[cfg\(all\(windows, feature = "windows-host-authority-observer"\)\)\]/.test(obs))
    E("V2 the observer module is not gated on windows + its feature");
  if (!/#\[cfg\(all\(windows, feature = "windows-host-authority-observer"\)\)\]\s*\nmod acquisition_win32;/.test(read(path.join(AUTH, "src", "lib.rs"))))
    E("V2 the observer module declaration is not gated, or is public");

  // ---- V3 all six facts obtained internally ----
  for (const [api, what] of [
    ["GetCurrentProcessId", "process id"],
    ["ProcessIdToSessionId", "process session"],
    ["WTSGetActiveConsoleSessionId", "active console session"],
    ["WTSQuerySessionInformationW", "session protocol"],
    ["GetProcessWindowStation", "window station"],
    ["GetUserObjectInformationW", "station flags"],
    ["production_canonical_identity", "canonical identity"],
  ])
    if (!obsCode.includes(api)) E("V3 fact not obtained internally: " + what + " (" + api + ")");

  // ---- V4 no caller-supplied trusted facts ----
  {
    const i = obsCode.indexOf("fn observe_host_context(");
    const sig = i === -1 ? "" : obsCode.slice(i, obsCode.indexOf(")", i));
    if (i === -1) E("V4 observe_host_context is missing");
    for (const bad of ["session", "protocol", "interactive", "identity", "pid", "process"])
      if (new RegExp("\\b" + bad + "\\w*\\s*:", "i").test(sig))
        E("V4 a trusted fact is accepted as a parameter: " + bad);
  }

  // ---- V5 identity binding: closed contract only, never a permissive default ----
  if (!/projectos_host_identity::canonical_record::production_canonical_identity\(\)/.test(obsCode))
    E("V5 identity does not come from the closed canonical contract");
  if (/identity_matches:\s*true/.test(obsCode)) E("V5 identity_matches is hardcoded true");
  // The observation's identity field must be assigned FROM the identity route, not from a literal or
  // any other expression. `let identity = true;` evaded an earlier field-only check.
  if (!/let identity = identity_matches\(\)\?;/.test(obsCode))
    E("V5 the observation's identity is not taken from the canonical identity route");
  if (!/identity_matches: identity,/.test(obsCode))
    E("V5 the observation does not bind the verified identity value");
  for (const bad of ["PackagedCandidate", "PerMachineEvidenceMatched", "USERNAME", "current_dir", "env::var"])
    if (obsCode.includes(bad)) E("V5 a forbidden identity source is used: " + bad);
  {
    const i = obsCode.indexOf("fn identity_matches(");
    const body = i === -1 ? "" : obsCode.slice(i, obsCode.indexOf("\n}", i));
    if (!/Err\(_\) => Err\(ObserverError::IdentityUnavailable\)/.test(body))
      E("V5 an identity failure does not refuse");
  }

  // ---- V6 every Windows failure refuses ----
  for (const e of ["SessionQueryFailed", "ProtocolQueryFailed", "StationQueryFailed", "IdentityUnavailable"])
    if (!obsCode.includes("ObserverError::" + e)) E("V6 missing refusal: " + e);
  for (const permissive of ["unwrap_or(true)", "unwrap_or_default()", "unwrap_or(0)"])
    if (obsCode.includes(permissive)) E("V6 a Windows failure falls back permissively: " + permissive);

  // ---- V7 facts only: no authority is created ----
  for (const t of [
    "ConfirmedAuthorityGuard",
    "acquire_existence_token",
    "ProviderCapabilitySet",
    "open_provider_authority",
    "OwnerPresence",
  ])
    if (obsCode.includes(t)) E("V7 the observer reaches an authority-creating surface: " + t);

  // ---- V8 localised known-folder constants have not drifted from the upstream contract ----
  {
    const rec = read(path.join(IDENT, "src", "identity", "canonical_record.rs"));
    const plan = read(path.join(PLAN, "src", "root_plan.rs"));
    const anchor = /PROGRAMDATA_ANCHOR_SYMBOL: &str = "([^"]+)"/.exec(rec);
    const segment = /HOST_STATE_SEGMENT: &str = "([^"]+)"/.exec(rec);
    if (!anchor || !segment) E("V8 the localised known-folder constants are missing");
    else {
      if (!plan.includes('"' + anchor[1] + '"'))
        E("V8 the anchor symbol has drifted from the activation-plan contract: " + anchor[1]);
      if (!new RegExp('Self::HostState => "' + segment[1] + '"').test(plan))
        E("V8 the host-state segment has drifted from the activation-plan contract: " + segment[1]);
    }
    // The cycle must stay broken.
    if (/projectos-host-windows-activation-plan/.test(read(path.join(IDENT, "Cargo.toml"))))
      E("V8 host-identity depends on the activation plan again (dependency cycle returns)");
  }

  // ---- compile proofs ----
  const control = compileConsumer("hao_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1500));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) E("HOST-AUTHORITY OBSERVER LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-host-authority-observer1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-host-authority-observer1a: PASS");
}
