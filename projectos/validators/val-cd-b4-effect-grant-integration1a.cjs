"use strict";
// CD-B4-PERMIT-TO-EFFECT-GRANT-INTEGRATION1A — eligibility is NOT effect authority. An ExecutionPermit is
// transformed into a narrowly-scoped, opaque, single-use BoundedEffectGrant only by the crate-controlled
// mint_effect_grant, for the EXACT effect policy the operation was fingerprinted with, with a validity
// bounded by the narrowest upstream lease; the grant is CONSUMED (moved) by a synthetic adapter that
// performs no OS mutation and emits an EffectWitness (evidence, never authority). No caller can construct,
// Default, deserialise, clone, mutate, or From<permit/approval/fact/bool>-convert a grant, reset a consumed
// grant, fabricate a witness, or pass an ExecutionPermit to the adapter. Structural checks + compile proofs.
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
  if (!WORK) WORK = fs.mkdtempSync(path.join(os.tmpdir(), "projectos-effect-grant-"));
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

// The public surface compiles; the effect policy folds distinctly. (Minting a grant needs a permit, which
// is pub(crate); the behavioural proof is the integration suite. Here we prove the API + fold.)
const POSITIVE = `
use projectos_host_core::{
    fold_effect_fingerprint, mint_effect_grant, EffectFamily, EffectTarget, RequiredEffect,
    RollbackRequirement, RollbackStrategyId, SyntheticEffectAdapter, EffectGrantLedger,
};
use projectos_trust_contract::OperationFingerprint;

fn main() {
    let a = RequiredEffect { family: EffectFamily::RecordMarker, target: EffectTarget::new("m"), argument: "x".into(), rollback: RollbackRequirement::NotRequired };
    let base = OperationFingerprint::new("fp").unwrap();
    let f1 = fold_effect_fingerprint(&base, &a);
    assert_ne!(f1, base);
    // Rollback policy is part of the fingerprint.
    let b = RequiredEffect { rollback: RollbackRequirement::Required { strategy: RollbackStrategyId::Restore }, ..a.clone() };
    assert_ne!(f1, fold_effect_fingerprint(&base, &b));
    let _mint = mint_effect_grant;
    let _adapter = SyntheticEffectAdapter::new();
    let _ledger = EffectGrantLedger::new();
    println!("POSITIVE_OK");
}
`;

const NEGATIVES = [
  { name: "neg_construct_grant", feat: [], why: "BoundedEffectGrant constructed directly",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn main(){ let _g = BoundedEffectGrant{}; }` },
  { name: "neg_default_grant", feat: [], why: "BoundedEffectGrant has Default",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn main(){ let _g: BoundedEffectGrant = Default::default(); }` },
  { name: "neg_clone_grant", feat: [], why: "BoundedEffectGrant is Clone",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(g: BoundedEffectGrant){ let _g2: BoundedEffectGrant = g.clone(); }\nfn main(){ let _ = f; }` },
  { name: "neg_from_bool", feat: [], why: "a Boolean converts into a grant",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn main(){ let _g = BoundedEffectGrant::from(true); }` },
  { name: "neg_from_permit", feat: [], why: "an ExecutionPermit converts into a grant",
    body: `use projectos_host_core::{BoundedEffectGrant, ExecutionPermit};\nfn f(p: ExecutionPermit){ let _g = BoundedEffectGrant::from(p); }\nfn main(){ let _ = f; }` },
  { name: "neg_from_elevation_fact", feat: [], why: "an elevation fact converts into a grant",
    body: `use projectos_host_core::{BoundedEffectGrant, ValidatedElevationFact};\nfn f(x: ValidatedElevationFact){ let _g = BoundedEffectGrant::from(x); }\nfn main(){ let _ = f; }` },
  { name: "neg_from_presence_fact", feat: [], why: "an owner-presence fact converts into a grant",
    body: `use projectos_host_core::{BoundedEffectGrant, ValidatedOwnerPresenceFact};\nfn f(x: ValidatedOwnerPresenceFact){ let _g = BoundedEffectGrant::from(x); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_grant_id", feat: [], why: "the grant's single-use identity is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(mut g: BoundedEffectGrant){ g.grant_id = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_permit_digest", feat: [], why: "the grant's permit-context digest is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(mut g: BoundedEffectGrant){ g.permit_context_digest = [0u8;32]; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_family", feat: [], why: "the grant's effect family is caller-mutable",
    body: `use projectos_host_core::{BoundedEffectGrant, EffectFamily};\nfn f(mut g: BoundedEffectGrant){ g.family = EffectFamily::RecordMarker; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_target", feat: [], why: "the grant's effect target is caller-mutable",
    body: `use projectos_host_core::{BoundedEffectGrant, EffectTarget};\nfn f(mut g: BoundedEffectGrant){ g.target = EffectTarget::new("x"); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_argument", feat: [], why: "the grant's effect argument is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(mut g: BoundedEffectGrant){ g.argument = String::new(); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_operation", feat: [], why: "the grant's operation is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nuse projectos_trust_contract::OperationRef;\nfn f(mut g: BoundedEffectGrant){ g.operation = OperationRef::new("x").unwrap(); }\nfn main(){ let _ = f; }` },
  { name: "neg_extend_validity", feat: [], why: "the grant's validity boundary is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(mut g: BoundedEffectGrant){ g.valid_until = 999_999; }\nfn main(){ let _ = f; }` },
  { name: "neg_forge_witness", feat: [], why: "EffectWitness constructed directly",
    body: `use projectos_host_core::EffectWitness;\nfn main(){ let _w = EffectWitness{}; }` },
  { name: "neg_witness_to_grant", feat: [], why: "an EffectWitness converts into a grant",
    body: `use projectos_host_core::{BoundedEffectGrant, EffectWitness};\nfn f(w: EffectWitness){ let _g = BoundedEffectGrant::from(w); }\nfn main(){ let _ = f; }` },
  { name: "neg_adapter_takes_permit", feat: ["test-fixtures"], why: "the synthetic adapter accepts an ExecutionPermit",
    body: `use projectos_host_core::{SyntheticEffectAdapter, ExecutionPermit, EffectTarget, EffectGrantLedger, TrustedClock, SyntheticEffectScript};
fn f(a: &SyntheticEffectAdapter, p: ExecutionPermit, t: &EffectTarget, l: &EffectGrantLedger, c: &dyn TrustedClock){ let _ = a.perform(p, t, l, c, SyntheticEffectScript::Succeed); }
fn main(){ let _ = f; }` },
  { name: "neg_reset_issuance", feat: [], why: "the issuance/consumption ledger can be reset",
    body: `use projectos_host_core::EffectGrantLedger;\nfn f(l: &EffectGrantLedger){ l.reset(1); }\nfn main(){ let _ = f; }` },
  { name: "neg_construct_lease_bound", feat: [], why: "AuthorityLeaseBound constructed directly",
    body: `use projectos_host_core::AuthorityLeaseBound;\nfn main(){ let _b = AuthorityLeaseBound{}; }` },
  { name: "neg_mutate_clock_provider", feat: [], why: "the grant's minting clock provider is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(mut g: BoundedEffectGrant){ g.clock_provider = String::new(); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_rollback", feat: [], why: "the grant's rollback policy is caller-mutable",
    body: `use projectos_host_core::{BoundedEffectGrant, RollbackRequirement};\nfn f(mut g: BoundedEffectGrant){ g.rollback = RollbackRequirement::NotRequired; }\nfn main(){ let _ = f; }` },
  { name: "neg_mint_without_ledger", feat: ["test-fixtures"], why: "mint_effect_grant can issue without a ledger (no issuance control)",
    body: `use projectos_host_core::{mint_effect_grant, ExecutionPermit, VerifiedExecutionContext, TrustedClock, RequiredEffect};
fn f(p: &ExecutionPermit, c: &VerifiedExecutionContext, k: &dyn TrustedClock, r: &RequiredEffect){ let _ = mint_effect_grant(p, c, k, r, 0); }
fn main(){ let _ = f; }` },

  // ---- §8 operation-reference: the AUTHORITY object (ExecutionPermit) is private; op_ref cannot be
  // set or replaced independently of the context it was reduced from. ----------------------------
  { name: "neg_permit_construct", feat: [], why: "ExecutionPermit constructed directly (would let op_ref be paired with any context)",
    body: `use projectos_host_core::{ExecutionPermit, VerifiedExecutionContext};\nuse projectos_trust_contract::OperationRef;\nfn f(o: OperationRef, c: VerifiedExecutionContext) -> ExecutionPermit { ExecutionPermit { operation_ref: o, context: c } }\nfn main(){ let _ = f; }` },
  { name: "neg_permit_mutate_opref", feat: [], why: "a permit's operation reference is caller-mutable",
    body: `use projectos_host_core::ExecutionPermit;\nuse projectos_trust_contract::OperationRef;\nfn f(p: &mut ExecutionPermit, o: OperationRef){ p.operation_ref = o; }\nfn main(){ let _ = f; }` },
  { name: "neg_context_replace_operation", feat: [], why: "a verified execution context's operation binding is caller-mutable",
    body: `use projectos_host_core::VerifiedExecutionContext;\nuse projectos_trust_contract::OperationName;\nfn f(c: &mut VerifiedExecutionContext, o: OperationName){ c.operation = o; }\nfn main(){ let _ = f; }` },

  // ---- §9 fixture-production exclusion: the default (production) graph cannot name or use any
  // fixture-only authority or synthetic-effect surface. -------------------------------------------
  { name: "neg_fixture_dimension", feat: [], why: "FixtureDimension is reachable in the default graph",
    body: `use projectos_host_core::FixtureDimension;\nfn f(_x: FixtureDimension){}\nfn main(){ let _ = f; }` },
  { name: "neg_fixture_take", feat: [], why: "VerifiedExecutionContext::fixture_take is reachable in the default graph",
    body: `use projectos_host_core::VerifiedExecutionContext;\nfn f(a: &VerifiedExecutionContext, b: &VerifiedExecutionContext){ let _ = a.fixture_take(b, unimplemented!()); }\nfn main(){ let _ = f; }` },
  { name: "neg_fixture_context_digest", feat: [], why: "ExecutionPermit::fixture_context_digest is reachable in the default graph",
    body: `use projectos_host_core::ExecutionPermit;\nfn f(p: &ExecutionPermit){ let _ = p.fixture_context_digest(); }\nfn main(){ let _ = f; }` },
  { name: "neg_fixture_context_digest_with", feat: [], why: "ExecutionPermit::fixture_context_digest_with is reachable in the default graph",
    body: `use projectos_host_core::{ExecutionPermit, VerifiedExecutionContext};\nfn f(p: &ExecutionPermit, c: &VerifiedExecutionContext){ let _ = p.fixture_context_digest_with(c); }\nfn main(){ let _ = f; }` },
  { name: "neg_fixture_verifier", feat: [], why: "FixtureElevationVerifier is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_core::FixtureElevationVerifier::new(); }` },
  { name: "neg_fixture_clock", feat: [], why: "FixtureClock is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_core::FixtureClock::new(1); }` },
  { name: "neg_fixture_issuance_key", feat: [], why: "fixture_issuance_key is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_core::fixture_issuance_key([0u8;32],[0u8;32]); }` },
  { name: "neg_synthetic_adapter_default", feat: [], why: "SyntheticEffectAdapter is reachable in the default graph",
    body: `use projectos_host_core::SyntheticEffectAdapter;\nfn main(){ let _ = SyntheticEffectAdapter::new(); }` },
  { name: "neg_synthetic_script_default", feat: [], why: "SyntheticEffectScript is reachable in the default graph",
    body: `use projectos_host_core::SyntheticEffectScript;\nfn f(_x: SyntheticEffectScript){}\nfn main(){ let _ = f; }` },
];

// A DEFAULT-graph control: every fixture failure above must be due to feature-gating, not a broken
// setup. This consumer uses only PRODUCTION APIs and MUST compile in the default graph.
const DEFAULT_CONTROL = `
use projectos_host_core::{EffectFamily, EffectTarget, RequiredEffect, RollbackRequirement, EffectGrantLedger, mint_effect_grant};
fn main(){
    let _r = RequiredEffect { family: EffectFamily::RecordMarker, target: EffectTarget::new("m"), argument: "x".into(), rollback: RollbackRequirement::NotRequired };
    let _l = EffectGrantLedger::new();
    let _m = mint_effect_grant;
    println!("CONTROL_OK");
}
`;

function run() {
  const errors = [];
  const eff = strip(read(path.join(HOST, "core", "src", "effect.rs")));
  const effRaw = read(path.join(HOST, "core", "src", "effect.rs"));
  const operation = strip(read(path.join(HOST, "core", "src", "operation.rs")));
  const reducer = strip(read(path.join(HOST, "core", "src", "reducer.rs")));
  const cap = strip(read(path.join(HOST, "core", "src", "capability.rs")));

  // ---- 1. Opaque single-use grant + witness ----------------------------------------------------
  for (const t of ["BoundedEffectGrant", "EffectWitness"]) {
    if (!new RegExp("pub struct " + t + "\\b").test(eff)) errors.push("missing type: " + t);
    const body = eff.slice(eff.indexOf("pub struct " + t));
    const decl = body.slice(0, body.indexOf("}"));
    if (/\bpub\s+\w+:/.test(decl)) errors.push(t + " has a public field (must be opaque)");
    if (new RegExp("derive\\([^)]*\\bDefault\\b[^)]*\\)\\]\\s*(pub struct )?" + t).test(eff))
      errors.push(t + " derives Default");
    if (new RegExp("derive\\([^)]*\\bClone\\b[^)]*\\)\\]\\s*(pub struct )?" + t).test(eff))
      errors.push(t + " derives Clone (a grant/witness must not be duplicable)");
    if (!new RegExp("impl fmt::Debug for " + t + "\\b").test(eff))
      errors.push(t + " has no hand-written redacted Debug");
    if (!new RegExp(t + "\\([^)]*\\[REDACTED\\]").test(effRaw))
      errors.push(t + " Debug is not redacted");
  }
  if (/Serialize|Deserialize|serde/.test(eff)) errors.push("effect references serialisation");
  if (/impl From<[^>]*> for BoundedEffectGrant/.test(eff))
    errors.push("BoundedEffectGrant has a From (permit/fact/bool could become a grant)");
  // Thread-bound (!Send + !Sync) via a raw pointer marker.
  if (!/PhantomData<\*const \(\)>/.test(eff))
    errors.push("grant/witness is not thread-bound (!Send + !Sync)");
  // Single-use identity is crate-assigned, not caller-selectable.
  if (!/static NEXT_GRANT_ID:\s*core::sync::atomic::AtomicU64/.test(eff) || !/fetch_add/.test(eff))
    errors.push("grant identity is not a crate-assigned single-use nonce");

  // ---- 2. Sole mint from a permit --------------------------------------------------------------
  if (!/pub fn mint_effect_grant\(\s*permit: &ExecutionPermit/.test(eff))
    errors.push("mint_effect_grant is not the sole permit-consuming mint");
  for (const guard of ["compare_context", "is_current", "effect_policy", "authority_lease_bound"])
    if (!new RegExp(guard).test(eff))
      errors.push("mint_effect_grant does not enforce: " + guard);
  for (const e of ["PermitContextMismatch", "PermitNotCurrent", "EffectPolicyMismatch", "ExpiryBeyondUpstream"])
    if (!new RegExp("EffectGrantError::" + e + "\\b").test(eff))
      errors.push("mint has no structured refusal: " + e);
  // ---- 2b. BLOCKER A: single-issuance per (permit-context, effect-policy) -----------------------
  if (!/pub fn mint_effect_grant\([\s\S]*?ledger: &EffectGrantLedger/.test(eff))
    errors.push("mint_effect_grant does not take a single-issuance ledger");
  if (!/fn try_issue\(/.test(eff) || !/EffectGrantError::AlreadyIssued/.test(eff))
    errors.push("no single-issuance enforcement (a permit could mint unlimited grants)");
  if (!/fn issuance_key\(/.test(eff))
    errors.push("issuance is not keyed by permit-context + effect-policy");
  // ---- 2c. BLOCKER B: canonical upstream lease bound (opaque, reducer-derived) ------------------
  if (!/pub struct AuthorityLeaseBound\b/.test(eff)) errors.push("no AuthorityLeaseBound type");
  else {
    const b = eff.slice(eff.indexOf("pub struct AuthorityLeaseBound"));
    if (/\bpub\s+\w+:/.test(b.slice(0, b.indexOf("}")))) errors.push("AuthorityLeaseBound has a public field");
  }
  if (!/pub\(crate\) fn derive\(/.test(eff)) errors.push("AuthorityLeaseBound has no reducer-only derive");
  if (!/authority_lease_bound:\s*req\.required_effect/.test(reducer))
    errors.push("reducer does not derive the canonical authority lease bound");
  if (!/EffectGrantError::MissingLeaseBound/.test(eff))
    errors.push("mint does not fail closed when no lease bound is present");
  // ---- 2d. BLOCKER C: execution-time currentness in the adapter --------------------------------
  if (!/clock_provider:\s*String/.test(eff) || !/clock_epoch:\s*u64/.test(eff))
    errors.push("grant does not bind the minting clock provider + epoch");
  for (const e of ["GrantExpired", "ClockProviderMismatch", "ClockEpochMismatch"])
    if (!new RegExp("EffectGrantError::" + e + "\\b").test(eff))
      errors.push("adapter has no execution-time currentness refusal: " + e);
  if (!/clock: &dyn crate::authority_time::TrustedClock/.test(eff))
    errors.push("adapter does not read the sealed clock at execution time");
  // ---- 2e. BLOCKER D: rollback policy ----------------------------------------------------------
  if (!/pub enum RollbackRequirement\b/.test(eff)) errors.push("no RollbackRequirement policy");
  if (!/rollback:\s*RollbackRequirement/.test(eff)) errors.push("RequiredEffect has no rollback policy");
  if (!/self\.rollback\.digest_into/.test(eff))
    errors.push("rollback policy is not folded into the effect-policy digest");
  if (!/rollback:\s*RollbackRequirement,/.test(eff)) errors.push("grant does not bind the rollback policy");
  if (!/EffectGrantError::RollbackUnavailable/.test(eff))
    errors.push("mint does not refuse a rollback-required effect without a strategy");
  if (!/pub enum RollbackOutcome\b/.test(eff) || !/rollback_outcome\(/.test(eff))
    errors.push("EffectWitness does not record the rollback outcome");

  // ---- 3. Effect policy folded into the operation fingerprint ----------------------------------
  if (!/required_effect:\s*Option<[^>]*RequiredEffect>/.test(operation))
    errors.push("operation has no required_effect policy field");
  if (!/pub fn bind_effect\(/.test(operation)) errors.push("no consuming bind_effect");
  if (!/fold_effect_fingerprint\(/.test(operation))
    errors.push("bind_effect does not fold the policy into the fingerprint");
  // Reducer stamps the effect policy digest into the permit context; permit compares it.
  if (!/effect_policy:\s*req/.test(reducer))
    errors.push("reducer does not stamp the effect policy digest into the context");
  if (!/F::EffectPolicy\b|ContextField::EffectPolicy\b/.test(cap))
    errors.push("context comparison missing field: EffectPolicy");
  if (!/pub\(crate\) fn context_digest\(/.test(cap))
    errors.push("permit exposes no context_digest for the grant binding");

  // ---- 4. Effect policy never an arbitrary command / path --------------------------------------
  if (!/pub enum EffectFamily\b/.test(eff)) errors.push("EffectFamily is not a closed enum");
  if (/pub argument:\s*serde_json|Vec<String>|PathBuf/.test(eff))
    errors.push("effect arguments are not bounded (arbitrary payload/path)");

  // ---- 5. No serde dependency (no deserialise authority surface) -------------------------------
  const coreToml = read(path.join(HOST, "core", "Cargo.toml"));
  if (/^\s*serde\b/m.test(coreToml) || /\bserde\s*=/.test(coreToml))
    errors.push("host/core depends on serde (grant could gain a Deserialize surface)");

  // ---- 6. Fixture symbols are feature-gated in lib.rs; no fixture builder is a default export -----
  const lib = read(path.join(HOST, "core", "src", "lib.rs"));
  for (const sym of ["FixtureDimension", "FixtureClock", "FixtureElevationVerifier", "fixture_issuance_key", "SyntheticEffectAdapter", "SyntheticEffectScript"]) {
    const line = lib.split("\n").find((l) => l.includes(sym) && l.trim().startsWith("pub use"));
    const idx = lib.split("\n").findIndex((l) => l.includes(sym) && l.trim().startsWith("pub use"));
    const prev = idx > 0 ? lib.split("\n")[idx - 1] : "";
    if (!line) errors.push("fixture symbol not exported at all (unexpected): " + sym);
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(prev))
      errors.push("fixture symbol " + sym + " is exported WITHOUT a test-fixtures cfg gate");
  }
  // The maximally-governed fixture builders are test-local and MUST NOT be part of the public API.
  for (const sym of ["gov_record", "gov_permit_ctx", "GovTune", "fixture_context_digest"]) {
    if (new RegExp("pub use[^\\n]*\\b" + sym + "\\b").test(lib))
      errors.push("test-only builder leaked into the public API: " + sym);
  }
  // fixture_context_digest / fixture_take methods must be cfg-gated in capability.rs.
  for (const m of ["fn fixture_context_digest", "fn fixture_context_digest_with", "fn fixture_take"]) {
    const at = cap.indexOf(m);
    if (at === -1) errors.push("missing fixture method: " + m);
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(cap.slice(Math.max(0, at - 200), at)))
      errors.push("fixture method not test-gated: " + m);
  }

  // ---- 7. Permit-context digest: canonical V2 encoding binds the identity dimensions -------------
  for (const needle of [
    "PROJECTOS:PERMIT-CONTEXT-DIGEST:V3",
    "c.phase.digest()", // B5 op-ref rides transitively in the canonical phase; no direct op-ref fold.
    "c.fingerprint.as_str()",
    "digest_bytes()",
    "fingerprint_material()",
    "proof_digest()",
    "elevation_process",
    "elevation_verifier",
  ])
    if (!cap.includes(needle)) errors.push("permit-context digest does not fold: " + needle);
  // Path A: there must be NO direct operation_ref fold in the digest (redundant with the phase fold).
  {
    const di = cap.indexOf("fn digest_of");
    const body = di === -1 ? "" : cap.slice(di, cap.indexOf("finalize", di));
    if (/operation_ref/.test(body))
      errors.push("permit-context digest folds operation_ref directly (must be transitive via phase only)");
  }

  // ---- 8. Compile proofs -----------------------------------------------------------------------
  const pos = compileConsumer("effect_positive", POSITIVE, ["test-fixtures"]);
  if (!pos.ok) errors.push("POSITIVE consumer failed to compile:\n" + pos.out.slice(0, 1400));
  const ctl = compileConsumer("effect_default_control", DEFAULT_CONTROL, []);
  if (!ctl.ok) errors.push("DEFAULT-graph control failed to compile (setup broken):\n" + ctl.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.feat);
    if (r.ok) errors.push("EFFECT-GRANT FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-effect-grant-integration1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-effect-grant-integration1a: PASS");
}
