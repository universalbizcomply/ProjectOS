"use strict";
// CD-B4-ELEVATION-VALIDATED-FACT-INTEGRATION1A — elevation is wired end-to-end as an opaque,
// operation-bound, PROCESS-bound, fail-closed validated fact DISTINCT from owner presence, approval and
// effect authority: an operation owns an immutable elevation policy folded into its fingerprint; the
// reducer requires a verified elevation proof bound to THIS operation and process (project/env/phase/
// plan/op-ref/fingerprint/repository-baseline/owner-presence/process + generation/validity) BEFORE the
// level/generation policy; the permit context carries elevation fields; and no external caller can forge
// the fact, Default it, deserialise it, convert a bool/observation into authority, mutate a binding, or
// turn the fact into an effect grant. Structural checks + real compile proofs.
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
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function strip(src) {
  const i = src.search(/#\[cfg\(test\)\]/);
  const body = i === -1 ? src : src.slice(0, i);
  return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

let WORK = null;
function workdir() {
  if (!WORK) WORK = scratch.owned("cd-b4-elevation-integration1a");
  return WORK;
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

// The ONLY authority path: verify_elevation from an untrusted observation + a sealed-clock reading.
const POSITIVE = `
use projectos_host_core::{
    fold_elevation_fingerprint, ElevationLevel, ElevationObservation, ElevationVerifier,
    FixtureClock, FixtureElevationVerifier, RequiredElevation, SessionId, TrustedClock,
    ValidatedSession, VerifiedElevation,
};
use projectos_trust_contract::OperationFingerprint;

fn main() {
    // The ONLY authority path: a SEALED elevation verifier attests an untrusted observation, stamping the
    // trusted-clock reading + the session. There is no free public mint.
    let clock = FixtureClock::new(100);
    let verifier = FixtureElevationVerifier::new();
    let obs = ElevationObservation {
        proof_id: "p".into(), source: "s".into(), level: ElevationLevel::Elevated,
        observed_at: 0, valid_until: 200, generation: 5, pid: 42, creation_tick: 7,
    };
    let req = RequiredElevation {
        minimum_level: ElevationLevel::Elevated, min_generation: 5, expected_pid: 42, expected_creation_tick: 7,
    };
    let session = ValidatedSession { session: SessionId::new("sess-1") };
    let _e: VerifiedElevation = verifier.verify(&obs, &req, &clock.read_current(), &session).unwrap();
    // The verifier identity is DISTINCT from the clock provider.
    assert!(verifier.verifier_id().starts_with("fixture-elev-verifier-"));
    let base = OperationFingerprint::new("fp").unwrap();
    assert_ne!(fold_elevation_fingerprint(&base, &req), base);
    println!("POSITIVE_OK");
}
`;

// 17 compile-fail authority consumers (§13). Each MUST fail to compile.
const NEGATIVES = [
  { name: "neg_forge_verified", why: "VerifiedElevation constructed directly",
    body: `use projectos_host_core::VerifiedElevation;\nfn main(){ let _f = VerifiedElevation{}; }` },
  { name: "neg_forge_fact", why: "ValidatedElevationFact constructed directly",
    body: `use projectos_host_core::ValidatedElevationFact;\nfn main(){ let _f = ValidatedElevationFact{}; }` },
  { name: "neg_default_fact", why: "ValidatedElevationFact has Default",
    body: `use projectos_host_core::ValidatedElevationFact;\nfn main(){ let _f: ValidatedElevationFact = Default::default(); }` },
  { name: "neg_default_verified", why: "VerifiedElevation has Default",
    body: `use projectos_host_core::VerifiedElevation;\nfn main(){ let _f: VerifiedElevation = Default::default(); }` },
  { name: "neg_from_bool", why: "a Boolean converts into verified elevation",
    body: `use projectos_host_core::VerifiedElevation;\nfn main(){ let _f = VerifiedElevation::from(true); }` },
  { name: "neg_from_observation", why: "a raw observation converts into verified elevation",
    body: `use projectos_host_core::{ElevationObservation, ElevationLevel, VerifiedElevation};
fn main(){
    let o = ElevationObservation{ proof_id:"p".into(), source:"s".into(), level:ElevationLevel::Elevated, observed_at:0, valid_until:2, generation:1, pid:1, creation_tick:1 };
    let _f: VerifiedElevation = o.into();
}` },
  { name: "neg_mutate_process_pid", why: "the proof's process pid is caller-mutable",
    body: `use projectos_host_core::VerifiedElevation;\nfn f(mut e: VerifiedElevation){ e.pid = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_process_tick", why: "the proof's process creation tick is caller-mutable",
    body: `use projectos_host_core::VerifiedElevation;\nfn f(mut e: VerifiedElevation){ e.creation_tick = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_repo_binding", why: "the fact's repository binding is caller-mutable",
    body: `use projectos_host_core::ValidatedElevationFact;\nfn f(mut e: ValidatedElevationFact){ e.repository_binding = None; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_owner_presence_binding", why: "the fact's owner-presence binding is caller-mutable",
    body: `use projectos_host_core::ValidatedElevationFact;\nfn f(mut e: ValidatedElevationFact){ e.owner_presence_binding = None; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_provider_identity", why: "the proof's clock provider identity is caller-mutable",
    body: `use projectos_host_core::VerifiedElevation;\nfn f(mut e: VerifiedElevation){ e.provider_id = String::new(); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_provider_epoch", why: "the proof's clock provider epoch is caller-mutable",
    body: `use projectos_host_core::VerifiedElevation;\nfn f(mut e: VerifiedElevation){ e.epoch = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_generation", why: "the fact's cached generation is caller-mutable",
    body: `use projectos_host_core::ValidatedElevationFact;\nfn f(mut e: ValidatedElevationFact){ e.generation = 9; }\nfn main(){ let _ = f; }` },
  { name: "neg_extend_validity", why: "the fact's cached validity boundary is caller-mutable",
    body: `use projectos_host_core::ValidatedElevationFact;\nfn f(mut e: ValidatedElevationFact){ e.valid_until = 999; }\nfn main(){ let _ = f; }` },
  { name: "neg_forge_clock_reading", why: "an external clock impl fabricates the reading a proof is minted from",
    body: `use projectos_host_core::{TrustedClock, VerifiedAuthorityTime};
struct Evil;
impl TrustedClock for Evil { fn read_current(&self) -> VerifiedAuthorityTime { VerifiedAuthorityTime{} } }
fn main(){ let _ = Evil; }` },
  { name: "neg_convert_fact_to_effect_grant", why: "an elevation fact converts into effect authority",
    body: `use projectos_host_core::ValidatedElevationFact;\nfn f(e: &ValidatedElevationFact){ let _ = e.into_effect_grant(); }\nfn main(){ let _ = f; }` },
];

// FixtureClock (the sole minting clock) must be unreachable without the test-fixtures feature.
const FIXTURE_NEGATIVE = {
  name: "neg_fixture_without_feature",
  why: "the fixture clock is reachable without test-fixtures",
  body: `use projectos_host_core::FixtureClock;\nfn main(){ let _ = FixtureClock::new(1); }`,
};

// §9 SESSION + SEALED-VERIFIER compile-fail additions. Each MUST fail to compile.
const SESSION_VERIFIER_NEGATIVES = [
  { name: "neg_mutate_session", feat: [], why: "the proof's bound session is caller-mutable",
    body: `use projectos_host_core::{VerifiedElevation, SessionId};\nfn f(mut e: VerifiedElevation){ e.session = SessionId::new("x"); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_verifier_id", feat: [], why: "the proof's elevation-verifier identity is caller-mutable",
    body: `use projectos_host_core::VerifiedElevation;\nfn f(mut e: VerifiedElevation){ e.verifier_id = String::new(); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_verifier_epoch", feat: [], why: "the proof's elevation-verifier epoch is caller-mutable",
    body: `use projectos_host_core::VerifiedElevation;\nfn f(mut e: VerifiedElevation){ e.verifier_epoch = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_direct_mint_removed", feat: ["test-fixtures"], why: "the free public verify_elevation mint still exists",
    body: `use projectos_host_core::{verify_elevation};\nfn main(){ let _ = verify_elevation; }` },
  { name: "neg_impl_verifier", feat: ["test-fixtures"], why: "an external type implements the sealed ElevationVerifier",
    body: `use projectos_host_core::{ElevationVerifier, ElevationObservation, RequiredElevation, VerifiedAuthorityTime, ValidatedSession, VerifiedElevation, ElevationError};
struct Fake;
impl ElevationVerifier for Fake {
    fn verifier_id(&self) -> &str { "fake" }
    fn verifier_epoch(&self) -> u64 { 1 }
}
fn main(){ let _ = Fake; }` },
  { name: "neg_forwarding_verifier", feat: ["test-fixtures"], why: "an external forwarding verifier wraps a real one",
    body: `use projectos_host_core::{ElevationVerifier, FixtureElevationVerifier};
struct Fwd<'a>(&'a FixtureElevationVerifier);
impl<'a> ElevationVerifier for Fwd<'a> {
    fn verifier_id(&self) -> &str { self.0.verifier_id() }
    fn verifier_epoch(&self) -> u64 { self.0.verifier_epoch() }
}
fn main(){ let c = FixtureElevationVerifier::new(); let _ = Fwd(&c); }` },
  { name: "neg_select_verifier_id", feat: ["test-fixtures"], why: "a caller selects the verifier identity",
    body: `use projectos_host_core::FixtureElevationVerifier;\nfn main(){ let _ = FixtureElevationVerifier::new("chosen-id"); }` },
  { name: "neg_set_verifier_state_epoch", feat: ["test-fixtures"], why: "a caller sets the verifier epoch directly",
    body: `use projectos_host_core::FixtureElevationVerifier;\nfn main(){ let v = FixtureElevationVerifier::new(); v.epoch = 7; }` },
  { name: "neg_from_source_str", feat: [], why: "a raw source string converts into elevation authority",
    body: `use projectos_host_core::VerifiedElevation;\nfn main(){ let _ = VerifiedElevation::from("admin"); }` },
  { name: "neg_clock_as_verifier", feat: ["test-fixtures"], why: "a trusted-clock reading is used as an elevation verifier",
    body: `use projectos_host_core::{ElevationVerifier, FixtureClock, TrustedClock};\nfn f(v: &dyn ElevationVerifier) -> u64 { v.verifier_epoch() }\nfn main(){ let c = FixtureClock::new(1); let _ = f(&c.read_current()); }` },
];

function run() {
  const errors = [];
  const ev = strip(read(path.join(HOST, "core", "src", "elevation.rs")));
  const evRaw = read(path.join(HOST, "core", "src", "elevation.rs"));
  const operation = strip(read(path.join(HOST, "core", "src", "operation.rs")));
  const reducer = strip(read(path.join(HOST, "core", "src", "reducer.rs")));
  const cap = strip(read(path.join(HOST, "core", "src", "capability.rs")));
  const facts = strip(read(path.join(HOST, "core", "src", "facts.rs")));

  // ---- 1. Distinct opaque elevation types ------------------------------------------------------
  for (const t of ["VerifiedElevation", "ValidatedElevationFact"]) {
    if (!new RegExp("pub struct " + t + "\\b").test(ev)) errors.push("missing type: " + t);
    const body = ev.slice(ev.indexOf("pub struct " + t));
    const decl = body.slice(0, body.indexOf("}"));
    if (/\bpub\s+\w+:/.test(decl)) errors.push(t + " has a public field (must be opaque)");
    if (new RegExp("derive\\([^)]*\\bDefault\\b[^)]*\\)\\]\\s*(pub struct )?" + t).test(ev))
      errors.push(t + " derives Default");
    if (!new RegExp("impl fmt::Debug for " + t + "\\b").test(ev))
      errors.push(t + " has no hand-written redacted Debug");
    if (!new RegExp(t + "\\(gen=\\{\\}, \\[REDACTED\\]\\)").test(evRaw))
      errors.push(t + " Debug is not redacted");
  }
  if (/Serialize|Deserialize|serde/.test(ev)) errors.push("elevation references serialisation");
  if (/impl From<[^>]*> for VerifiedElevation/.test(ev))
    errors.push("VerifiedElevation has a broad From (bool/observation could become authority)");
  if (!/pub fn bind\(\s*elevation: VerifiedElevation/.test(ev))
    errors.push("ValidatedElevationFact::bind does not CONSUME a verified elevation");
  // ---- 1b. SEALED elevation verifier (distinct from the trusted clock) --------------------------
  if (/pub fn verify_elevation\(/.test(ev))
    errors.push("verify_elevation is a free public mint (must be attested only by a sealed verifier)");
  if (!/pub trait ElevationVerifier:\s*sealed::Sealed\b/.test(ev))
    errors.push("ElevationVerifier is not sealed (an external fake verifier could mint authority)");
  if (!/\bmod sealed\s*\{/.test(ev) || /pub\s+mod sealed\b/.test(ev))
    errors.push("the elevation-verifier sealing module is not crate-private");
  if (!/impl sealed::Sealed for FixtureElevationVerifier\b/.test(evRaw))
    errors.push("the fixture verifier does not carry the sealing marker");
  // The proof binds the verifier identity + epoch (distinct from the clock provider) and the session.
  if (!/verifier_id:\s*String/.test(ev) || !/verifier_epoch:\s*u64/.test(ev))
    errors.push("VerifiedElevation does not bind the elevation-verifier identity + epoch");
  if (!/session:\s*SessionId/.test(ev))
    errors.push("VerifiedElevation does not bind the authenticated session");
  // Elevation LEVEL is a closed enum, never a bare bool.
  if (!/pub enum ElevationLevel\b/.test(ev)) errors.push("no ElevationLevel enum (bool is not a level)");
  // Process identity is bound (pid + creation tick).
  if (!/pid:\s*u32/.test(ev) || !/creation_tick:\s*u64/.test(ev))
    errors.push("VerifiedElevation does not bind the process identity (pid + creation tick)");

  // ---- 2. Operation owns an immutable policy folded into the fingerprint ------------------------
  if (!/required_elevation:\s*Option<[^>]*RequiredElevation>/.test(operation))
    errors.push("operation has no required_elevation policy field");
  if (!/pub fn bind_elevation\(/.test(operation)) errors.push("no consuming bind_elevation");
  if (!/fold_elevation_fingerprint\(/.test(operation))
    errors.push("bind_elevation does not fold the policy into the fingerprint");

  // ---- 3. Reducer: operation+process-bound fact BEFORE policy -----------------------------------
  if (!/elevation:\s*Option<[^>]*ValidatedElevationFact>/.test(facts))
    errors.push("ServiceValidatedFacts.elevation is not the operation-bound fact");
  if (!/MissingFact::Elevation/.test(reducer))
    errors.push("reducer does not fail closed when an elevation-governed op has no fact");
  for (const dim of ["Project", "Environment", "Phase", "Plan", "Operation", "Fingerprint",
    "RepositoryBaseline", "OwnerPresence", "Session", "Process", "Generation", "ValidUntil"])
    if (!new RegExp("ElevationBinding::" + dim + "\\b").test(reducer))
      errors.push("reducer does not check elevation binding dimension: " + dim);
  // Verifier identity + epoch enforcement (E9B), distinct from the clock (E9A).
  if (!/ElevationError::VerifierMismatch/.test(reducer) || !/ElevationError::VerifierEpochMismatch/.test(reducer))
    errors.push("reducer does not bind the proof to the current elevation-verifier identity + epoch");
  if (!/req\.elevation_verifier/.test(reducer))
    errors.push("reducer does not read the injected elevation verifier");
  if (!/ElevationFactMismatch/.test(reducer))
    errors.push("reducer has no distinct elevation fact-binding refusal");
  if (!/\.elevation\(\)\.satisfies\(required\)/.test(reducer))
    errors.push("reducer does not re-check the proof against the policy via satisfies()");
  if (reducer.indexOf("ElevationFactMismatch") > reducer.indexOf("elevation().satisfies"))
    errors.push("reducer evaluates the elevation policy BEFORE the fact-binding checks");
  // Process binding + temporal currentness.
  if (!/expected_pid/.test(reducer) || !/expected_creation_tick/.test(reducer))
    errors.push("reducer does not bind the fact to the operation's expected process identity");
  if (!/ElevationError::ProviderMismatch/.test(reducer) || !/ElevationError::EpochMismatch/.test(reducer))
    errors.push("reducer does not bind the current reading to the proof's provider identity + epoch");
  if (!/ElevationError::Expired/.test(reducer))
    errors.push("reducer does not enforce current-time expiry against the elevation lease");

  // ---- 4. Permit context fields ----------------------------------------------------------------
  for (const f of ["ElevationProof", "ElevationGeneration", "ElevationValidUntil", "ElevationProvider",
    "ElevationEpoch", "ElevationProcess", "ElevationVerifier", "ElevationVerifierEpoch", "ElevationSession"])
    if (!new RegExp("F::" + f + "\\b|ContextField::" + f + "\\b").test(cap))
      errors.push("context comparison missing field: " + f);
  if (!/elevation_process:\s*Option<\(u32, u64\)>/.test(cap))
    errors.push("context has no elevation-bound process identity field");

  // ---- 4b. No deserialisation surface (host/core has no serde dependency) -----------------------
  const coreToml = read(path.join(HOST, "core", "Cargo.toml"));
  if (/^\s*serde\b/m.test(coreToml) || /\bserde\s*=/.test(coreToml))
    errors.push("host/core depends on serde (elevation authority could gain a Deserialize surface)");

  // ---- 5. Compile proofs -----------------------------------------------------------------------
  const pos = compileConsumer("elev_positive", POSITIVE, ["test-fixtures"]);
  if (!pos.ok) errors.push("POSITIVE consumer failed to compile:\n" + pos.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const feat = neg.name === "neg_forge_clock_reading" ? ["test-fixtures"] : [];
    const r = compileConsumer(neg.name, neg.body, feat);
    if (r.ok) errors.push("ELEVATION FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  const fx = compileConsumer(FIXTURE_NEGATIVE.name, FIXTURE_NEGATIVE.body, []);
  if (fx.ok) errors.push("ELEVATION FORGERY POSSIBLE — " + FIXTURE_NEGATIVE.why + " (compiled)");
  for (const neg of SESSION_VERIFIER_NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.feat);
    if (r.ok) errors.push("SESSION/VERIFIER BREACH — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-elevation-integration1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-elevation-integration1a: PASS");
}
