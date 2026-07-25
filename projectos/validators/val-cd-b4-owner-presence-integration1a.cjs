"use strict";
// CD-B4-OWNER-PRESENCE-VALIDATED-FACT-INTEGRATION1A — owner presence is wired end-to-end as an opaque,
// operation-bound, fail-closed validated fact DISTINCT from owner approval: an operation owns an
// immutable owner-presence policy folded into its fingerprint; the reducer requires a verified proof
// bound to THIS operation (project/env/phase/plan/opref/fingerprint/repository-context + generation/
// validity consistency) BEFORE the policy; the context carries owner-presence fields the permit
// compares; and no external caller can forge the fact, Default it, deserialise it, or convert a raw
// observation/Boolean into authority. Structural checks + real compile proofs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

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
  if (!WORK) WORK = fs.mkdtempSync(path.join(os.tmpdir(), "projectos-owner-presence-"));
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

// The ONLY way to obtain a VerifiedAuthorityTime is from a TrustedClock provider (fixture, test-gated),
// and the ONLY way to mint a presence proof is verify_owner_presence with that reading. Proves the
// crate-controlled path compiles.
const POSITIVE = `
use projectos_host_core::{
    fold_owner_presence_fingerprint, verify_owner_presence, FixtureClock, OwnerPresenceObservation,
    RequiredOwnerPresence, TrustedClock, VerifiedOwnerPresence,
};
use projectos_trust_contract::OperationFingerprint;

fn main() {
    // The provider identity is NOT caller-selectable — new() takes only a reading; the crate assigns
    // a unique instance id. A handle SHARES the one authoritative state (Model A).
    let clock = FixtureClock::new(5);
    let handle = clock.handle();
    clock.advance_to(9);
    let _ = handle.read_current(); // handle observes the advance through shared state
    let obs = OwnerPresenceObservation {
        proof_id: "p".into(), verifier: "hello".into(),
        observed_at: 0, valid_until: 100, generation: 5,
    };
    let req = RequiredOwnerPresence { required_verifier: "hello".into(), min_generation: 5 };
    let _p: VerifiedOwnerPresence = verify_owner_presence(&obs, &req, &clock.read_current()).unwrap();
    let base = OperationFingerprint::new("fp").unwrap();
    assert_ne!(fold_owner_presence_fingerprint(&base, &req), base);
    println!("POSITIVE_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_forge_fact",
    why: "ValidatedOwnerPresenceFact constructed directly",
    body: `use projectos_host_core::ValidatedOwnerPresenceFact;\nfn main(){ let _f = ValidatedOwnerPresenceFact{}; }`,
  },
  {
    name: "neg_forge_verified",
    why: "VerifiedOwnerPresence constructed directly",
    body: `use projectos_host_core::VerifiedOwnerPresence;\nfn main(){ let _f = VerifiedOwnerPresence{}; }`,
  },
  {
    name: "neg_default_fact",
    why: "ValidatedOwnerPresenceFact has Default",
    body: `use projectos_host_core::ValidatedOwnerPresenceFact;\nfn main(){ let _f: ValidatedOwnerPresenceFact = Default::default(); }`,
  },
  {
    name: "neg_from_observation",
    why: "a raw observation converts into verified presence",
    body: `use projectos_host_core::{OwnerPresenceObservation, VerifiedOwnerPresence};
fn main(){
    let o = OwnerPresenceObservation{ proof_id:"p".into(), verifier:"v".into(), observed_at:1, valid_until:2, generation:1 };
    let _f: VerifiedOwnerPresence = o.into();
}`,
  },
  {
    name: "neg_from_bool",
    why: "a Boolean converts into verified presence",
    body: `use projectos_host_core::VerifiedOwnerPresence;\nfn main(){ let _f = VerifiedOwnerPresence::from(true); }`,
  },
  {
    name: "neg_forge_repo_binding",
    why: "RepositoryAuthorityBinding constructed directly (caller-created repository baseline token)",
    body: `use projectos_host_core::RepositoryAuthorityBinding;\nfn main(){ let _b = RepositoryAuthorityBinding{}; }`,
  },
  {
    name: "neg_construct_authority_time",
    why: "VerifiedAuthorityTime constructed directly (caller-supplied trusted time)",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn main(){ let _t = VerifiedAuthorityTime{}; }`,
  },
  {
    name: "neg_authority_time_from_u64",
    why: "a raw u64 becomes trusted authority time",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn main(){ let _t = VerifiedAuthorityTime::from(100u64); }`,
  },
  // ---- Default on the remaining authority tokens ----
  {
    name: "neg_default_proof",
    why: "VerifiedOwnerPresence has Default",
    body: `use projectos_host_core::VerifiedOwnerPresence;\nfn main(){ let _p: VerifiedOwnerPresence = Default::default(); }`,
  },
  {
    name: "neg_default_time",
    why: "VerifiedAuthorityTime has Default",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn main(){ let _t: VerifiedAuthorityTime = Default::default(); }`,
  },
  {
    name: "neg_default_repo_binding",
    why: "RepositoryAuthorityBinding has Default",
    body: `use projectos_host_core::RepositoryAuthorityBinding;\nfn main(){ let _b: RepositoryAuthorityBinding = Default::default(); }`,
  },
  // ---- Mutate / read private authority fields (opacity) ----
  {
    name: "neg_mutate_fact_generation",
    why: "the fact's cached generation is caller-readable/mutable",
    body: `use projectos_host_core::ValidatedOwnerPresenceFact;\nfn f(x: &ValidatedOwnerPresenceFact) -> u64 { x.generation }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_extend_fact_lease",
    why: "the fact's cached valid_until (lease bound) is caller-mutable",
    body: `use projectos_host_core::ValidatedOwnerPresenceFact;\nfn f(x: &mut ValidatedOwnerPresenceFact) { x.valid_until = 999_999; }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_extend_proof_lease",
    why: "the proof's valid_until (lease bound) is caller-mutable",
    body: `use projectos_host_core::VerifiedOwnerPresence;\nfn f(x: &mut VerifiedOwnerPresence) { x.valid_until = 999_999; }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_mutate_repo_binding_field",
    why: "the fact's repository_binding is caller-mutable (repo-state rebind)",
    body: `use projectos_host_core::ValidatedOwnerPresenceFact;\nfn f(x: &mut ValidatedOwnerPresenceFact) { x.repository_binding = None; }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_mutate_provider_identity",
    why: "a reading's provider identity is caller-mutable (identity substitution)",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn f(mut t: VerifiedAuthorityTime) { t.provider_id = String::from("other"); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_mutate_provider_epoch",
    why: "a reading's provider epoch is caller-mutable (epoch rollback)",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn f(mut t: VerifiedAuthorityTime) { t.epoch = 1; }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_mark_expired_current",
    why: "a caller fabricates a reading past a lease to mark an expired proof current",
    body: `use projectos_host_core::VerifiedAuthorityTime;\nfn main(){ let _t = VerifiedAuthorityTime { provider_id: "x".into(), epoch: 1, reading: 0 }; }`,
  },
];

// Provider-currentness negatives that need the test-fixtures surface (FixtureClock is feature-gated).
// A caller must NOT be able to select a provider identity or epoch — the only knob is the reading.
const FIXTURE_NEGATIVES = [
  {
    name: "neg_select_provider_id",
    why: "a caller selects the provider identity (duplicate-provider construction)",
    body: `use projectos_host_core::FixtureClock;\nfn main(){ let _c = FixtureClock::new("prov", 5); }`,
  },
  {
    name: "neg_set_provider_epoch",
    why: "a caller sets the provider epoch directly (duplicate epoch)",
    body: `use projectos_host_core::FixtureClock;\nfn main(){ let c = FixtureClock::new(5); c.epoch = 7; }`,
  },
];

function run() {
  const errors = [];
  const op = strip(read(path.join(HOST, "core", "src", "owner_presence.rs")));
  const opRaw = read(path.join(HOST, "core", "src", "owner_presence.rs"));
  const operation = strip(read(path.join(HOST, "core", "src", "operation.rs")));
  const reducer = strip(read(path.join(HOST, "core", "src", "reducer.rs")));
  const cap = strip(read(path.join(HOST, "core", "src", "capability.rs")));
  const facts = strip(read(path.join(HOST, "core", "src", "facts.rs")));

  // ---- 1. Distinct opaque owner-presence types --------------------------------------------------
  for (const t of ["VerifiedOwnerPresence", "ValidatedOwnerPresenceFact"]) {
    if (!new RegExp("pub struct " + t + "\\b").test(op)) errors.push("missing type: " + t);
    const body = op.slice(op.indexOf("pub struct " + t));
    const decl = body.slice(0, body.indexOf("}"));
    if (/\bpub\s+\w+:/.test(decl)) errors.push(t + " has a public field (must be opaque)");
    if (new RegExp("derive\\([^)]*\\bDefault\\b[^)]*\\)\\]\\s*(pub struct )?" + t).test(op))
      errors.push(t + " derives Default");
    if (!new RegExp("impl fmt::Debug for " + t + "\\b").test(op))
      errors.push(t + " has no hand-written redacted Debug");
  }
  if (/Serialize|Deserialize|serde/.test(op)) errors.push("owner_presence references serialisation");
  if (/impl From<[^>]*> for VerifiedOwnerPresence/.test(op))
    errors.push("VerifiedOwnerPresence has a broad From (observation/bool could become authority)");
  if (!/ValidatedOwnerPresenceFact\([^)]*\[REDACTED\]/.test(opRaw))
    errors.push("ValidatedOwnerPresenceFact Debug is not redacted");
  if (!/VerifiedOwnerPresence\([^)]*\[REDACTED\]/.test(opRaw))
    errors.push("VerifiedOwnerPresence Debug is not redacted");
  if (!/pub fn verify_owner_presence\(/.test(op)) errors.push("no verify_owner_presence mint");
  if (!/pub fn bind\(\s*presence: VerifiedOwnerPresence/.test(op))
    errors.push("ValidatedOwnerPresenceFact::bind does not CONSUME a verified presence");

  // ---- 2. Operation owns an immutable policy folded into the fingerprint ------------------------
  if (!/required_owner_presence:\s*Option<[^>]*RequiredOwnerPresence>/.test(operation))
    errors.push("operation has no required_owner_presence policy field");
  if (!/pub fn bind_owner_presence\(/.test(operation))
    errors.push("no consuming bind_owner_presence");
  if (!/fold_owner_presence_fingerprint\(/.test(operation))
    errors.push("bind_owner_presence does not fold the policy into the fingerprint");

  // ---- 3. Reducer: operation-bound fact BEFORE policy -------------------------------------------
  if (!/owner_presence:\s*Option<[^>]*ValidatedOwnerPresenceFact>/.test(facts))
    errors.push("ServiceValidatedFacts.owner_presence is not the operation-bound fact");
  if (!/MissingFact::OwnerPresence/.test(reducer))
    errors.push("reducer does not fail closed when an owner-presence-governed op has no fact");
  for (const dim of ["Project", "Environment", "Phase", "Plan", "Operation", "Fingerprint", "RepositoryBaseline", "Generation", "ValidUntil"])
    if (!new RegExp("OwnerPresenceBinding::" + dim + "\\b").test(reducer))
      errors.push("reducer does not check owner-presence binding dimension: " + dim);
  if (!/OwnerPresenceFactMismatch/.test(reducer))
    errors.push("reducer has no distinct owner-presence fact-binding refusal");
  if (!/\.presence\(\)\.satisfies\(required\)/.test(reducer))
    errors.push("reducer does not re-check the proof against the policy via satisfies()");
  if (reducer.indexOf("OwnerPresenceFactMismatch") > reducer.indexOf("presence().satisfies"))
    errors.push("reducer evaluates the owner-presence policy BEFORE the fact-binding checks");

  // ---- 4. Permit context fields ----------------------------------------------------------------
  for (const f of ["OwnerPresenceProof", "OwnerPresenceGeneration", "OwnerPresenceValidUntil"])
    if (!new RegExp("F::" + f + "\\b").test(cap)) errors.push("context comparison missing field: " + f);
  if (!/owner_presence_proof:\s*Option</.test(cap))
    errors.push("context has no owner_presence_proof field");

  // ---- 4b. Trusted TEMPORAL revalidation (Blocker A) -------------------------------------------
  const at = strip(read(path.join(HOST, "core", "src", "authority_time.rs")));
  const atRaw = read(path.join(HOST, "core", "src", "authority_time.rs"));
  if (!/pub struct VerifiedAuthorityTime\b/.test(at)) errors.push("no VerifiedAuthorityTime type");
  else {
    const body = at.slice(at.indexOf("pub struct VerifiedAuthorityTime"));
    const decl = body.slice(0, body.indexOf("}"));
    if (/\bpub\s+\w+:/.test(decl)) errors.push("VerifiedAuthorityTime has a public field");
  }
  if (/impl From<[^>]*> for VerifiedAuthorityTime/.test(at))
    errors.push("VerifiedAuthorityTime has a From (raw time could become authority)");
  if (/Serialize|Deserialize/.test(at)) errors.push("authority_time references serialisation");
  if (!/VerifiedAuthorityTime\(\[REDACTED\]\)/.test(atRaw))
    errors.push("VerifiedAuthorityTime Debug is not redacted");
  if (!/must be monotonic/.test(atRaw) && !/AuthorityTimeError::Regressed/.test(at))
    errors.push("no monotonic guard on the trusted clock provider");
  // PROVIDER-CONTROLLED currentness: evaluation reads a clock provider (never a caller value), binds the
  // provider identity + epoch, and enforces the lease against the CURRENT reading.
  if (!/pub trait TrustedClock\b/.test(at) || !/fn read_current\(&self\)/.test(at))
    errors.push("no TrustedClock provider contract (read current time)");
  if (!/MissingFact::AuthorityTime/.test(reducer))
    errors.push("reducer does not require a trusted clock when owner presence is required");
  if (!/req\.authority_clock/.test(reducer) || !/\.read_current\(\)/.test(reducer))
    errors.push("reducer reads a caller-supplied time value instead of the injected clock provider");
  if (!/OwnerPresenceError::ProviderMismatch/.test(reducer) || !/OwnerPresenceError::EpochMismatch/.test(reducer))
    errors.push("reducer does not bind the current reading to the proof's provider identity + epoch");
  if (!/now\.reading\(\)\s*>=\s*fact\.valid_until\(\)/.test(reducer))
    errors.push("reducer does not enforce current-time expiry against the presence lease");
  if (/pub fn is_valid_at\(/.test(cap))
    errors.push("permit still exposes is_valid_at(&token) — a caller can replay a historical token");
  if (!/pub fn is_current\(/.test(cap) || !/dyn crate::authority_time::TrustedClock/.test(cap))
    errors.push("permit has no provider-clock temporal revalidation (is_current)");
  // ---- 4b-ii. MODEL A: canonical SHARED provider, non-caller-selectable identity ---------------
  // The fixture provider must hold ONE authoritative state shared by every handle/clone (so a retained
  // handle cannot lag), and its identity must be assigned by the crate (so no caller can mint a twin).
  const fixtureIdx = atRaw.indexOf("mod fixture");
  const fixtureSrc = fixtureIdx === -1 ? "" : atRaw.slice(fixtureIdx);
  if (!/Rc<ClockState>/.test(fixtureSrc))
    errors.push("fixture provider is not a shared Rc<ClockState> (handles could hold independent state)");
  if (!/pub fn new\(reading: u64\)/.test(fixtureSrc))
    errors.push("fixture provider new() takes a caller-selectable provider identity (must be reading-only)");
  if (!/static NEXT_ID:\s*AtomicU64/.test(fixtureSrc) || !/fetch_add/.test(fixtureSrc))
    errors.push("fixture provider identity is not crate-assigned (caller could duplicate it)");
  if (!/pub fn handle\(&self\)/.test(fixtureSrc) || !/Rc::clone\(&self\.state\)/.test(fixtureSrc))
    errors.push("fixture provider has no shared-state handle() (Model A)");
  // Trusted time carries a provider identity + epoch alongside the reading.
  if (!/provider_id:\s*String/.test(at) || !/epoch:\s*u64/.test(at) || !/reading:\s*u64/.test(at))
    errors.push("VerifiedAuthorityTime does not carry provider identity + epoch + reading");
  // The reading constructor is crate-internal, so no external TrustedClock impl can fabricate one.
  if (!/pub\(crate\)\s+fn new\(/.test(at))
    errors.push("VerifiedAuthorityTime::new is not pub(crate) (an external clock impl could mint a reading)");
  // ---- 4b-iv. SEALED provider trait (no external impl can launder a retained reading) ----------
  // TrustedClock must have a crate-private sealing supertrait so no external crate can implement it
  // (even by returning a RETAINED genuine reading). The sealing module must be private (not `pub mod`).
  if (!/pub trait TrustedClock:\s*sealed::Sealed\b/.test(at))
    errors.push("TrustedClock is not sealed (an external clock impl can launder a retained reading)");
  if (!/\bmod sealed\s*\{/.test(at) || /pub\s+mod sealed\b/.test(at))
    errors.push("the sealing module is not crate-private (external crates could name Sealed)");
  if (!/impl super::sealed::Sealed for FixtureClock\b/.test(atRaw))
    errors.push("FixtureClock does not carry the sealing marker");
  if (/impl(<[^>]*>)?\s+sealed::Sealed for\s+\w+\s*\{[^}]*\}\s*\n/.test(at) && !/impl super::sealed::Sealed for FixtureClock/.test(at))
    errors.push("a blanket/unexpected Sealed impl exists (arbitrary providers become trusted)");
  // ---- 4b-iii. No deserialisation surface (host/core has no serde dependency) ------------------
  const coreToml = read(path.join(HOST, "core", "Cargo.toml"));
  if (/^\s*serde\b/m.test(coreToml) || /\bserde\s*=/.test(coreToml))
    errors.push("host/core depends on serde (authority tokens could gain a Deserialize surface)");
  // ---- 4c. Repository-STATE binding (Blocker B) ------------------------------------------------
  const repo = strip(read(path.join(HOST, "core", "src", "repository.rs")));
  if (!/pub struct RepositoryAuthorityBinding\b/.test(repo))
    errors.push("no RepositoryAuthorityBinding (baseline-state) type");
  if (!/pub fn authority_binding\(&self\)/.test(repo))
    errors.push("ValidatedRepositoryFact exposes no authority_binding()");
  if (!/repository_binding:\s*Option<RepositoryAuthorityBinding>/.test(op))
    errors.push("owner-presence fact binds repository identity, not the authority-state binding");
  if (!/OwnerPresenceBinding::RepositoryBaseline/.test(reducer))
    errors.push("reducer does not check the repository baseline-state binding");

  // ---- 5. Compile proofs -----------------------------------------------------------------------
  // Positive uses the test-gated fixture clock (the only obtainable trusted reading).
  const pos = compileConsumer("op_positive", POSITIVE, ["test-fixtures"]);
  if (!pos.ok) errors.push("POSITIVE consumer failed to compile:\n" + pos.out.slice(0, 1200));
  // A caller's own TrustedClock impl cannot forge a reading — VerifiedAuthorityTime has no public ctor.
  const forgeClock = compileConsumer(
    "neg_forge_clock_reading",
    `use projectos_host_core::{TrustedClock, VerifiedAuthorityTime};
struct Evil;
impl TrustedClock for Evil {
    fn read_current(&self) -> VerifiedAuthorityTime { VerifiedAuthorityTime { } }
}
fn main() { let _ = Evil.read_current(); }`
  );
  if (forgeClock.ok)
    errors.push("OWNER-PRESENCE FORGERY POSSIBLE — a TrustedClock impl fabricates a reading (neg_forge_clock_reading compiled)");
  // ---- SEALING compile-fail additions (S1, S9, §7 items 1-5) -----------------------------------
  const SEAL_NEGATIVES = [
    {
      name: "neg_external_impl_trusted_clock",
      why: "an external type implements the sealed TrustedClock trait (S1)",
      feat: ["test-fixtures"],
      body: `use projectos_host_core::{FixtureClock, TrustedClock, VerifiedAuthorityTime};
struct Ext;
impl TrustedClock for Ext { fn read_current(&self) -> VerifiedAuthorityTime { FixtureClock::new(1).read_current() } }
fn main(){ let _ = Ext; }`,
    },
    {
      name: "neg_external_replay_clock",
      why: "an external replay clock returns a RETAINED genuine reading (S9)",
      feat: ["test-fixtures"],
      body: `use std::cell::RefCell;
use projectos_host_core::{TrustedClock, VerifiedAuthorityTime};
struct Replay { r: RefCell<Option<VerifiedAuthorityTime>> }
impl TrustedClock for Replay { fn read_current(&self) -> VerifiedAuthorityTime { self.r.borrow_mut().take().unwrap() } }
fn main(){ let _ = Replay { r: RefCell::new(None) }; }`,
    },
    {
      name: "neg_external_forwarding_wrapper",
      why: "an external forwarding wrapper implements TrustedClock (§7.3)",
      feat: ["test-fixtures"],
      body: `use projectos_host_core::{FixtureClock, TrustedClock, VerifiedAuthorityTime};
struct Fwd<'a>(&'a FixtureClock);
impl<'a> TrustedClock for Fwd<'a> { fn read_current(&self) -> VerifiedAuthorityTime { self.0.read_current() } }
fn main(){ let c = FixtureClock::new(1); let _ = Fwd(&c); }`,
    },
    {
      name: "neg_name_sealed_trait",
      why: "the private sealing trait is nameable externally (§7.4)",
      feat: [],
      body: `use projectos_host_core::authority_time::sealed::Sealed;\nfn main(){ let _: Option<&dyn Sealed> = None; }`,
    },
    {
      name: "neg_blanket_impl",
      why: "an external blanket impl makes arbitrary types trusted (§7.5)",
      feat: ["test-fixtures"],
      body: `use projectos_host_core::{FixtureClock, TrustedClock, VerifiedAuthorityTime};
struct Any;
impl TrustedClock for Any { fn read_current(&self) -> VerifiedAuthorityTime { FixtureClock::new(1).read_current() } }
fn main(){ let _ = Any; }`,
    },
    {
      name: "neg_fixture_without_feature",
      why: "FixtureClock is reachable without the test-fixtures feature (§7.6)",
      feat: [],
      body: `use projectos_host_core::FixtureClock;\nfn main(){ let _ = FixtureClock::new(1); }`,
    },
  ];
  for (const neg of SEAL_NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.feat);
    if (r.ok) errors.push("SEALING BREACH — " + neg.why + " (" + neg.name + " compiled)");
  }
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) errors.push("OWNER-PRESENCE FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  // Provider-selection negatives compile against the test-fixtures surface (FixtureClock is gated).
  for (const neg of FIXTURE_NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, ["test-fixtures"]);
    if (r.ok) errors.push("OWNER-PRESENCE FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-owner-presence-integration1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-owner-presence-integration1a: PASS");
}
