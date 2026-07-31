"use strict";
// CD-B4-BINDING-CONSUMER-SURFACE1A — proves the DEPENDENT-CONSUMER surface of the attempt-scoped
// service-instance binding by COMPILING disposable external consumer crates, not by reading source
// text. Text checks cannot distinguish "a caller may not" from "a caller cannot"; only the type system
// can, so every forgery claim here is backed by an expected compile failure.
//
// The governing security property is NOT a feature flag. Advancing an attempt requires an
// `ServiceInstanceObservation::Observed(ServiceInstanceToken)`, and `ServiceInstanceToken` has no
// public constructor in ANY graph. A default or live-only consumer can therefore submit closed
// refusals but can never manufacture a positive identity, and a refusal never yields Match.
//
// All fixtures are created under the OS temp directory and removed afterwards; nothing is written
// inside the repository, and no Windows API, pipe, SCM query, process open or process launch occurs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const IDP = path.join(ROOT, "projectos", "host", "windows-service-identity-proof");
const IDP_TOML = IDP.replace(/\\/g, "/");

// One shared target directory so the many small consumer crates reuse compiled dependencies.
let WORK = null;
function workdir() {
  if (!WORK) WORK = scratch.owned("cd-b4-binding-consumer-surface1a");
  return WORK;
}

/** Build a disposable external consumer crate and return its compile result. */
function compileConsumer(name, features, body, run) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat = features.length ? `, features = [${features.map((f) => `"${f}"`).join(", ")}]` : "";
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
      `projectos-host-windows-service-identity-proof = { path = "${IDP_TOML}"${feat} }`,
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const args = run ? ["run", "--offline", "--quiet"] : ["build", "--offline", "--quiet"];
  const r = spawnSync("cargo", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

/** The happy path an orchestrator will follow: begin -> SCM-before -> IPC peer -> SCM-after -> Match. */
const POSITIVE_BODY = `
use projectos_host_windows_service_identity_proof::{
    synthetic_observation, AttemptOutcome, LiveInstanceObservationCapability, ServiceInstanceBinding,
    ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
};

fn main() {
    // The ONLY capability an external consumer can obtain is the fixture-gated synthetic one.
    let capability = LiveInstanceObservationCapability::synthetic_for_fixture();
    let instance = SyntheticInstanceSelector::new(7, 1);

    let attempt = ServiceInstanceBindingAttempt::begin(&capability);
    let attempt = match attempt.record_scm_before(synthetic_observation(instance)) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => panic!("scm-before refused: {v:?}"),
    };
    let attempt = match attempt.record_ipc_peer(synthetic_observation(instance)) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => panic!("ipc peer refused: {v:?}"),
    };
    let attempt = match attempt.record_scm_after(synthetic_observation(instance)) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => panic!("scm-after refused: {v:?}"),
    };
    assert_eq!(attempt.finalise(), ServiceInstanceBinding::Match, "ordered attempt must bind");
    println!("POSITIVE_MATCH_OK");
}
`;

/** Deterministic negative outcomes reachable WITH fixtures: these must compile and refuse Match. */
const REFUSAL_BODY = `
use projectos_host_windows_service_identity_proof::{
    synthetic_observation, synthetic_refusal, AttemptOutcome, LiveInstanceObservationCapability,
    ServiceInstanceBinding, ServiceInstanceBindingAttempt, ServiceInstanceRefusal,
    SyntheticInstanceSelector,
};

type Obs = projectos_host_windows_service_identity_proof::ServiceInstanceObservation;

fn drive(before: Obs, peer: Obs, after: Obs) -> ServiceInstanceBinding {
    let capability = LiveInstanceObservationCapability::synthetic_for_fixture();
    let a = ServiceInstanceBindingAttempt::begin(&capability);
    let a = match a.record_scm_before(before) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => return v,
    };
    let a = match a.record_ipc_peer(peer) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => return v,
    };
    let a = match a.record_scm_after(after) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => return v,
    };
    a.finalise()
}

fn main() {
    let one = SyntheticInstanceSelector::new(7, 1);
    let other = SyntheticInstanceSelector::new(9, 1);
    // Same logical process, DIFFERENT incarnation: the process-ID-reuse case.
    let restarted = SyntheticInstanceSelector::new(7, 2);

    // A different running process never binds.
    assert_eq!(
        drive(synthetic_observation(one), synthetic_observation(other), synthetic_observation(one)),
        ServiceInstanceBinding::Mismatch
    );
    // Process-ID reuse never binds.
    assert_eq!(
        drive(synthetic_observation(one), synthetic_observation(restarted), synthetic_observation(one)),
        ServiceInstanceBinding::Mismatch
    );
    // The service changed under the peer: stale, not matched.
    assert_eq!(
        drive(synthetic_observation(one), synthetic_observation(one), synthetic_observation(other)),
        ServiceInstanceBinding::Stale
    );
    // Unavailable SCM evidence.
    assert_eq!(
        drive(
            synthetic_refusal(ServiceInstanceRefusal::ServiceStatusUnavailable),
            synthetic_observation(one),
            synthetic_observation(one)
        ),
        ServiceInstanceBinding::MissingScmObservation
    );
    // Unavailable IPC evidence.
    assert_eq!(
        drive(
            synthetic_observation(one),
            synthetic_refusal(ServiceInstanceRefusal::PipeNotConnected),
            synthetic_observation(one)
        ),
        ServiceInstanceBinding::MissingIpcObservation
    );
    // Ambiguous (shared-process) service.
    assert_eq!(
        drive(
            synthetic_refusal(ServiceInstanceRefusal::ServiceTypeAmbiguous),
            synthetic_observation(one),
            synthetic_observation(one)
        ),
        ServiceInstanceBinding::Ambiguous
    );
    // A refusal can never become Match.
    println!("REFUSALS_OK");
}
`;

/** Stale finalisation via the fixture clock: everything matches, yet the window has elapsed. */
const STALE_BODY = `
use projectos_host_windows_service_identity_proof::{
    synthetic_observation, AttemptOutcome, LiveInstanceObservationCapability, ServiceInstanceBinding,
    ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
};
use std::cell::Cell;
use std::rc::Rc;

fn main() {
    let capability = LiveInstanceObservationCapability::synthetic_for_fixture();
    let instance = SyntheticInstanceSelector::new(3, 1);
    let clock = Rc::new(Cell::new(1_000u64));
    let window = ServiceInstanceBindingAttempt::synthetic_window_millis();

    let a = ServiceInstanceBindingAttempt::begin_with_synthetic_clock(&capability, Rc::clone(&clock));
    let a = match a.record_scm_before(synthetic_observation(instance)) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => panic!("unexpected: {v:?}"),
    };
    let a = match a.record_ipc_peer(synthetic_observation(instance)) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => panic!("unexpected: {v:?}"),
    };
    let a = match a.record_scm_after(synthetic_observation(instance)) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(v) => panic!("unexpected: {v:?}"),
    };
    // All three identities are equal; only the window has elapsed.
    clock.set(clock.get() + window + 1);
    assert_eq!(a.finalise(), ServiceInstanceBinding::ObservationWindowExpired);
    println!("STALE_OK");
}
`;

/** Negative consumers. Each MUST fail to compile. */
const NEGATIVES = [
  {
    name: "neg_default_synthetic",
    features: [],
    why: "default graph reaches the synthetic constructor",
    body: `
fn main() {
    let _ = projectos_host_windows_service_identity_proof::synthetic_observation;
}
`,
  },
  {
    name: "neg_default_attempt",
    features: [],
    why: "default graph reaches the attempt surface",
    body: `
use projectos_host_windows_service_identity_proof::ServiceInstanceBindingAttempt;
fn main() { let _: Option<ServiceInstanceBindingAttempt<()>> = None; }
`,
  },
  {
    name: "neg_live_only_synthetic",
    features: ["windows-live-instance-observation"],
    why: "live-only graph reaches the synthetic constructor",
    body: `
fn main() {
    let _ = projectos_host_windows_service_identity_proof::synthetic_observation;
}
`,
  },
  {
    name: "neg_live_only_capability",
    features: ["windows-live-instance-observation"],
    why: "live-only graph obtains a capability",
    body: `
use projectos_host_windows_service_identity_proof::LiveInstanceObservationCapability;
fn main() { let _ = LiveInstanceObservationCapability::synthetic_for_fixture(); }
`,
  },
  {
    name: "neg_token_construct",
    features: ["test-fixtures"],
    why: "a consumer constructs a token directly",
    body: `
use projectos_host_windows_service_identity_proof::ServiceInstanceToken;
fn main() { let _ = ServiceInstanceToken::from_observed_parts(4242, 99); }
`,
  },
  {
    name: "neg_observed_construct",
    features: ["test-fixtures"],
    why: "a consumer constructs a positive observation from raw identity",
    body: `
use projectos_host_windows_service_identity_proof::ServiceInstanceObservation;
fn main() { let _ = ServiceInstanceObservation::Observed(4242u32); }
`,
  },
  {
    name: "neg_raw_selector_parts",
    features: ["test-fixtures"],
    why: "a consumer reads raw identity out of a synthetic selector",
    body: `
use projectos_host_windows_service_identity_proof::SyntheticInstanceSelector;
fn main() { let s = SyntheticInstanceSelector::new(1, 1); let _ = s.to_internal_parts(); }
`,
  },
  {
    name: "neg_skip_scm_before",
    features: ["test-fixtures"],
    why: "a consumer finalises without SCM-before",
    body: `
use projectos_host_windows_service_identity_proof::{
    LiveInstanceObservationCapability, ServiceInstanceBindingAttempt,
};
fn main() {
    let c = LiveInstanceObservationCapability::synthetic_for_fixture();
    let _ = ServiceInstanceBindingAttempt::begin(&c).finalise();
}
`,
  },
  {
    name: "neg_peer_first",
    features: ["test-fixtures"],
    why: "a consumer observes the IPC peer before SCM-before",
    body: `
use projectos_host_windows_service_identity_proof::{
    synthetic_observation, LiveInstanceObservationCapability, ServiceInstanceBindingAttempt,
    SyntheticInstanceSelector,
};
fn main() {
    let c = LiveInstanceObservationCapability::synthetic_for_fixture();
    let i = SyntheticInstanceSelector::new(1, 1);
    let _ = ServiceInstanceBindingAttempt::begin(&c).record_ipc_peer(synthetic_observation(i));
}
`,
  },
  {
    name: "neg_duplicate_scm_before",
    features: ["test-fixtures"],
    why: "a consumer contributes SCM-before twice",
    body: `
use projectos_host_windows_service_identity_proof::{
    synthetic_observation, AttemptOutcome, LiveInstanceObservationCapability,
    ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
};
fn main() {
    let c = LiveInstanceObservationCapability::synthetic_for_fixture();
    let i = SyntheticInstanceSelector::new(1, 1);
    let a = match ServiceInstanceBindingAttempt::begin(&c).record_scm_before(synthetic_observation(i)) {
        AttemptOutcome::Continue(a) => a,
        AttemptOutcome::Refused(_) => return,
    };
    let _ = a.record_scm_before(synthetic_observation(i));
}
`,
  },
  {
    name: "neg_reuse_completed",
    features: ["test-fixtures"],
    why: "a consumer reuses a completed attempt",
    body: `
use projectos_host_windows_service_identity_proof::{
    synthetic_observation, AttemptOutcome, LiveInstanceObservationCapability,
    ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
};
fn main() {
    let c = LiveInstanceObservationCapability::synthetic_for_fixture();
    let i = SyntheticInstanceSelector::new(1, 1);
    let a = ServiceInstanceBindingAttempt::begin(&c);
    let a = match a.record_scm_before(synthetic_observation(i)) {
        AttemptOutcome::Continue(a) => a, AttemptOutcome::Refused(_) => return };
    let a = match a.record_ipc_peer(synthetic_observation(i)) {
        AttemptOutcome::Continue(a) => a, AttemptOutcome::Refused(_) => return };
    let a = match a.record_scm_after(synthetic_observation(i)) {
        AttemptOutcome::Continue(a) => a, AttemptOutcome::Refused(_) => return };
    let _first = a.finalise();
    let _second = a.finalise();
}
`,
  },
  {
    name: "neg_cross_attempt",
    features: ["test-fixtures"],
    why: "a consumer extracts an observation to move it between attempts",
    body: `
use projectos_host_windows_service_identity_proof::{
    LiveInstanceObservationCapability, ServiceInstanceBindingAttempt,
};
fn main() {
    let c = LiveInstanceObservationCapability::synthetic_for_fixture();
    let a = ServiceInstanceBindingAttempt::begin(&c);
    let _stolen = a.inner;
}
`,
  },
  {
    name: "neg_clone_attempt",
    features: ["test-fixtures"],
    why: "a consumer clones an attempt",
    body: `
use projectos_host_windows_service_identity_proof::{
    LiveInstanceObservationCapability, ServiceInstanceBindingAttempt,
};
fn main() {
    let c = LiveInstanceObservationCapability::synthetic_for_fixture();
    let a = ServiceInstanceBindingAttempt::begin(&c);
    let _b = a.clone();
}
`,
  },
  {
    name: "neg_serialise_selector",
    features: ["test-fixtures"],
    why: "a synthetic selector is Display-able",
    body: `
use projectos_host_windows_service_identity_proof::SyntheticInstanceSelector;
fn main() { println!("{}", SyntheticInstanceSelector::new(1, 1)); }
`,
  },
];

// ---------------------------------------------------------------------------------------------
// CROSS-CRATE ACQUISITION AND FACADE PROOF (Amendment1B).
//
// A dependent orchestrator will not call identity-proof transitions directly; it will call the
// SIBLING facades. These consumers therefore depend on all three crates and use only those facades,
// proving the real dependent API shape compiles and binds.
// ---------------------------------------------------------------------------------------------

const SC = path.join(ROOT, "projectos", "host", "windows-service-control").replace(/\\/g, "/");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc").replace(/\\/g, "/");

/** Build a consumer depending on all three crates, each with the given feature list. */
function compileCrossConsumer(name, feats, body, run) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const dep = (crate, p, f) =>
    crate +
    ' = { path = "' +
    p +
    '"' +
    (f.length ? ", features = [" + f.map((x) => '"' + x + '"').join(", ") + "]" : "") +
    ", default-features = false }";
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]",
      "",
      "[package]",
      'name = "' + name.replace(/[^a-z0-9_]/g, "_") + '"',
      'version = "0.0.0"',
      'edition = "2021"',
      "publish = false",
      "",
      "[dependencies]",
      dep("projectos-host-windows-service-identity-proof", IDP_TOML, feats.idp),
      dep("projectos-host-windows-service-control", SC, feats.sc),
      dep("projectos-host-windows-local-ipc", IPC, feats.ipc),
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const args = run ? ["run", "--offline", "--quiet"] : ["build", "--offline", "--quiet"];
  const r = spawnSync("cargo", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const FIXTURE_FEATS = { idp: ["test-fixtures"], sc: ["test-fixtures"], ipc: ["test-fixtures"] };
const DEFAULT_FEATS = { idp: [], sc: [], ipc: [] };
const LIVE_FEATS = {
  idp: ["windows-live-instance-observation"],
  sc: ["windows-live-scm"],
  ipc: ["windows-live-ipc"],
};

/** The exact orchestration a future proof runner performs, through sibling facades only. */
const CROSS_POSITIVE = [
  "use projectos_host_windows_local_ipc as ipc;",
  "use projectos_host_windows_service_control as sc;",
  "use projectos_host_windows_service_identity_proof as idp;",
  "",
  "fn main() {",
  "    // 1-2. Fixture-only capabilities. No live authority is created.",
  "    let scm_cap = sc::LiveOperationCapability::synthetic_for_fixture();",
  "    let ipc_cap = ipc::LiveIpcOperationCapability::synthetic_for_fixture();",
  "    let obs_cap = idp::LiveInstanceObservationCapability::synthetic_for_fixture();",
  "",
  "    // 3. Run the REAL handshake verification order over a synthetic observation.",
  "    let transition = ipc::run_fixture_handshake(&ipc_cap, ipc::synthetic_controller_hello());",
  "    assert!(ipc::outcome_is_confirmed(transition.outcome()), \"handshake must confirm\");",
  "",
  "    // 4. The contributor exists only because the handshake confirmed.",
  "    let confirmed = transition.into_confirmed().expect(\"confirmation\");",
  "    let contributor = ipc::FixtureIpcPeerContributor::from_confirmed(confirmed);",
  "",
  "    // 5. One attempt.",
  "    let attempt = idp::ServiceInstanceBindingAttempt::begin(&obs_cap);",
  "",
  "    // 6. SCM-before through the service-control facade.",
  "    let attempt = match sc::contribute_scm_before(&scm_cap, attempt) {",
  "        idp::AttemptOutcome::Continue(a) => a,",
  "        idp::AttemptOutcome::Refused(v) => panic!(\"scm-before refused: {v:?}\"),",
  "    };",
  "    // 7. Confirmed peer through the local-ipc facade.",
  "    let attempt = match contributor.contribute_ipc_peer(&ipc_cap, attempt) {",
  "        idp::AttemptOutcome::Continue(a) => a,",
  "        idp::AttemptOutcome::Refused(v) => panic!(\"peer refused: {v:?}\"),",
  "    };",
  "    // 8. SCM-after through the service-control facade.",
  "    let attempt = match sc::contribute_scm_after(&scm_cap, attempt) {",
  "        idp::AttemptOutcome::Continue(a) => a,",
  "        idp::AttemptOutcome::Refused(v) => panic!(\"scm-after refused: {v:?}\"),",
  "    };",
  "    // 9-11. Finalise and map the closed verdict without touching lower-level identity.",
  "    match attempt.finalise() {",
  "        idp::ServiceInstanceBinding::Match => println!(\"CROSS_CRATE_FIXTURE_MATCH_OK\"),",
  "        other => panic!(\"expected Match, got {other:?}\"),",
  "    }",
  "}",
].join("\n");

/** Cross-crate acquisition negatives. Each MUST fail to compile. */
const CROSS_NEGATIVES = [
  [
    "xneg_default_scm_cap",
    DEFAULT_FEATS,
    "default graph acquires the SCM fixture capability",
    "fn main() { let _ = projectos_host_windows_service_control::LiveOperationCapability::synthetic_for_fixture(); }",
  ],
  [
    "xneg_default_ipc_cap",
    DEFAULT_FEATS,
    "default graph acquires the IPC fixture capability",
    "fn main() { let _ = projectos_host_windows_local_ipc::LiveIpcOperationCapability::synthetic_for_fixture(); }",
  ],
  [
    "xneg_default_handshake",
    DEFAULT_FEATS,
    "default graph runs the fixture handshake",
    "fn main() { let _ = projectos_host_windows_local_ipc::run_fixture_handshake; }",
  ],
  [
    "xneg_default_contributor",
    DEFAULT_FEATS,
    "default graph names the fixture contributor",
    "fn main() { let _ = projectos_host_windows_local_ipc::FixtureIpcPeerContributor::from_confirmed; }",
  ],
  [
    "xneg_live_scm_cap",
    LIVE_FEATS,
    "live-only graph acquires the SCM fixture capability",
    "fn main() { let _ = projectos_host_windows_service_control::LiveOperationCapability::synthetic_for_fixture(); }",
  ],
  [
    "xneg_live_ipc_cap",
    LIVE_FEATS,
    "live-only graph acquires the IPC fixture capability",
    "fn main() { let _ = projectos_host_windows_local_ipc::LiveIpcOperationCapability::synthetic_for_fixture(); }",
  ],
  [
    "xneg_live_handshake",
    LIVE_FEATS,
    "live-only graph runs the fixture handshake",
    "fn main() { let _ = projectos_host_windows_local_ipc::run_fixture_handshake; }",
  ],
  [
    "xneg_live_contributor",
    LIVE_FEATS,
    "live-only graph creates a synthetic contributor",
    "fn main() { let _ = projectos_host_windows_local_ipc::FixtureIpcPeerContributor::from_confirmed; }",
  ],
  [
    "xneg_construct_scm_cap",
    FIXTURE_FEATS,
    "a consumer constructs the SCM capability directly",
    "fn main() { let _ = projectos_host_windows_service_control::LiveOperationCapability { _sealed: () }; }",
  ],
  [
    "xneg_construct_ipc_cap",
    FIXTURE_FEATS,
    "a consumer constructs the IPC capability directly",
    "fn main() { let _ = projectos_host_windows_local_ipc::LiveIpcOperationCapability { _sealed: () }; }",
  ],
  [
    "xneg_construct_confirmation",
    FIXTURE_FEATS,
    "a consumer constructs the confirmation directly",
    "fn main() { let _ = projectos_host_windows_local_ipc::ConfirmedIpcPeerHandshake { _sealed: () }; }",
  ],
  [
    "xneg_bool_to_confirmation",
    FIXTURE_FEATS,
    "a bool becomes a confirmation",
    "use projectos_host_windows_local_ipc::ConfirmedIpcPeerHandshake;\nfn main() { let _: ConfirmedIpcPeerHandshake = true.into(); }",
  ],
  [
    "xneg_role_to_confirmation",
    FIXTURE_FEATS,
    "a bare role becomes a confirmation",
    "use projectos_host_windows_local_ipc::{ConfirmedIpcPeerHandshake, PeerRole};\nfn main() { let _: ConfirmedIpcPeerHandshake = PeerRole::ServiceFixture.into(); }",
  ],
  [
    "xneg_outcome_to_confirmation",
    FIXTURE_FEATS,
    "the public success variant becomes a confirmation",
    "use projectos_host_windows_local_ipc::{ConfirmedIpcPeerHandshake, HandshakeOutcome};\nfn main() {\n    let o = HandshakeOutcome::ExpectedServiceFixturePeerConfirmed;\n    let _: ConfirmedIpcPeerHandshake = o.into();\n}",
  ],
  [
    "xneg_contributor_from_role",
    FIXTURE_FEATS,
    "a bare role produces the contributor",
    "use projectos_host_windows_local_ipc::{FixtureIpcPeerContributor, PeerRole};\nfn main() { let _ = FixtureIpcPeerContributor::from_confirmed(PeerRole::ServiceFixture); }",
  ],
  [
    "xneg_scm_after_first",
    FIXTURE_FEATS,
    "SCM-after runs before the peer contribution",
    "use projectos_host_windows_service_control as sc;\nuse projectos_host_windows_service_identity_proof as idp;\nfn main() {\n    let cap = sc::LiveOperationCapability::synthetic_for_fixture();\n    let obs = idp::LiveInstanceObservationCapability::synthetic_for_fixture();\n    let a = idp::ServiceInstanceBindingAttempt::begin(&obs);\n    let _ = sc::contribute_scm_after(&cap, a);\n}",
  ],
  [
    "xneg_peer_before_scm_before",
    FIXTURE_FEATS,
    "the peer contribution runs before SCM-before",
    "use projectos_host_windows_local_ipc as ipc;\nuse projectos_host_windows_service_identity_proof as idp;\nfn main() {\n    let ipc_cap = ipc::LiveIpcOperationCapability::synthetic_for_fixture();\n    let obs = idp::LiveInstanceObservationCapability::synthetic_for_fixture();\n    let t = ipc::run_fixture_handshake(&ipc_cap, ipc::synthetic_controller_hello());\n    let c = ipc::FixtureIpcPeerContributor::from_confirmed(t.into_confirmed().unwrap());\n    let a = idp::ServiceInstanceBindingAttempt::begin(&obs);\n    let _ = c.contribute_ipc_peer(&ipc_cap, a);\n}",
  ],
  [
    "xneg_windows_ffi",
    FIXTURE_FEATS,
    "a consumer reaches windows_ffi",
    "fn main() { let _ = projectos_host_windows_service_control::windows_ffi::contribute_scm_before; }",
  ],
];

function run() {
  const errors = [];

  // ---- 1. Source-level containment (cheap checks that complement the compile proofs) -------------
  const idpToml = fs.readFileSync(path.join(IDP, "Cargo.toml"), "utf8");
  if (!/consumer-contract\s*=\s*\[\]/.test(idpToml))
    errors.push("consumer-contract is not a standalone dependency-free feature");
  if (!/windows-live-instance-observation\s*=\s*\[\s*"consumer-contract",/.test(idpToml))
    errors.push("live observation does not imply the consumer contract");
  if (!/test-fixtures\s*=\s*\["consumer-contract"\]/.test(idpToml))
    errors.push("test-fixtures is not an explicit contract-only feature");
  if (/default\s*=\s*\[[^\]]*(test-fixtures|windows-live)/.test(idpToml))
    errors.push("a default feature enables fixtures or live observation");

  const instance = fs.readFileSync(path.join(IDP, "src", "instance.rs"), "utf8");
  // The synthetic selector must be opaque: no raw process identity in its public surface.
  if (!/pub fn new\(instance: u8, incarnation: u8\)/.test(instance))
    errors.push("the synthetic selector does not use opaque instance/incarnation selectors");
  if (/pub fn (process_id|creation_time|pid|filetime)/.test(instance))
    errors.push("a raw identity accessor is public");
  if (!/fn to_internal_parts\(self\)/.test(instance) || /pub fn to_internal_parts/.test(instance))
    errors.push("the selector-to-identity mapping is not private");
  if (!/SyntheticInstanceSelector\(\[REDACTED\]\)/.test(instance))
    errors.push("the synthetic selector Debug is not redacted");
  if (/impl fmt::Display for SyntheticInstanceSelector/.test(instance))
    errors.push("the synthetic selector implements Display");
  if (/Serialize|Deserialize|serde/.test(instance)) errors.push("instance.rs references serialisation");
  // The fixture must perform no Windows activity of its own. Comments are stripped first: the module
  // legitimately DESCRIBES the Win32 calls the separate FFI module makes.
  const instanceCode = instance
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
  for (const bad of [/OpenProcess/, /QueryServiceStatusEx/, /GetNamedPipeClientProcessId/, /CreateNamedPipe/, /use\s+windows::/]) {
    const m = instanceCode.match(bad);
    if (m) errors.push("the portable contract module calls a Windows API: " + m[0]);
  }

  // Backends and FFI modules stay private in both sibling crates; only narrow façades are exported.
  const scLib = fs.readFileSync(
    path.join(ROOT, "projectos", "host", "windows-service-control", "src", "lib.rs"),
    "utf8"
  );
  const ipcLib = fs.readFileSync(
    path.join(ROOT, "projectos", "host", "windows-local-ipc", "src", "lib.rs"),
    "utf8"
  );
  for (const [name, src] of [["service-control", scLib], ["local-ipc", ipcLib]]) {
    if (/pub\s+mod\s+windows_ffi/.test(src)) errors.push(name + ": windows_ffi module is public");
    if (!/^mod windows_ffi;/m.test(src)) errors.push(name + ": windows_ffi module declaration missing");
    if (/pub\s+use\s+windows_ffi::\*/.test(src)) errors.push(name + ": windows_ffi is glob re-exported");
  }
  if (!/pub use windows_ffi::\{contribute_scm_after, contribute_scm_before\};/.test(scLib))
    errors.push("service-control does not export exactly the two SCM contribution façades");
  if (!/pub use windows_ffi::LiveIpcPeerContributor;/.test(ipcLib))
    errors.push("local-ipc does not export exactly the IPC contribution façade");
  // No direct Win32 function may become visible through either façade.
  for (const [name, src] of [["service-control", scLib], ["local-ipc", ipcLib]]) {
    if (/pub\s+use\s+windows::/.test(src)) errors.push(name + ": re-exports a Win32 item");
  }

  // ---- 2. Compile proofs: positive consumer -----------------------------------------------------
  const pos = compileConsumer("pos_match", ["test-fixtures"], POSITIVE_BODY, true);
  if (!pos.ok || !/POSITIVE_MATCH_OK/.test(pos.out))
    errors.push("an external fixture consumer cannot reach Match: " + pos.out.slice(-400));

  const refusals = compileConsumer("pos_refusals", ["test-fixtures"], REFUSAL_BODY, true);
  if (!refusals.ok || !/REFUSALS_OK/.test(refusals.out))
    errors.push("refusal mapping is wrong for an external consumer: " + refusals.out.slice(-400));

  const stale = compileConsumer("pos_stale", ["test-fixtures"], STALE_BODY, true);
  if (!stale.ok || !/STALE_OK/.test(stale.out))
    errors.push("an expired attempt still finalised positively: " + stale.out.slice(-400));

  // ---- 3. Compile proofs: every negative must FAIL to compile -----------------------------------
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.features, neg.body, false);
    if (r.ok) errors.push("FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }

  // ---- 4. Cross-crate facade proof: the real dependent orchestration shape ----------------------
  const cross = compileCrossConsumer("xpos_cross_crate", FIXTURE_FEATS, CROSS_POSITIVE, true);
  if (!cross.ok || !/CROSS_CRATE_FIXTURE_MATCH_OK/.test(cross.out))
    errors.push("the all-three-crate facade flow cannot reach Match: " + cross.out.slice(-600));

  // ---- 5. Cross-crate acquisition negatives: each MUST fail to compile --------------------------
  for (const [name, feats, why, body] of CROSS_NEGATIVES) {
    const r = compileCrossConsumer(name, feats, body, false);
    if (r.ok) errors.push("ACQUISITION FORGERY POSSIBLE - " + why + " (" + name + " compiled)");
  }

  return errors;
}

function cleanup() {
  if (WORK && fs.existsSync(WORK)) {
    try {
      fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      /* a locked build artefact is not a validation failure; the OS temp dir is disposable */
    }
  }
}

module.exports = {
  run: () => {
    try {
      return run();
    } finally {
      cleanup();
    }
  },
};

if (require.main === module) {
  const errs = module.exports.run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-binding-consumer-surface1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-binding-consumer-surface1a: PASS");
}
