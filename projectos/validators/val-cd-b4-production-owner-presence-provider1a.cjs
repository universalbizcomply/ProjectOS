// Validator: CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER1A
//
// Proves the mechanism-neutral core production owner-presence contract (Option C1):
// (1) production VerifiedOwnerPresence is minted ONLY by verify_production_owner_presence, which
//     move-consumes an opaque, no-public-ctor, non-Clone ProductionOwnerPresenceBindingGrant;
// (2) the grant is issued ONLY by the sealed, non-caller-constructible ProductionOwnerPresenceCapability
//     (new_internal crate-private; for_local_proof test-fixtures gated), which refuses fixture-sourced
//     and non-confirmed evidence;
// (3) caller-constructible observation/evidence data cannot convert into the production grant or into a
//     VerifiedOwnerPresence, and neither presence nor the grant converts into any other authority;
// (4) grant + capability + evidence Debug are redacted, the grant is thread-bound (!Send + !Sync), and
//     core stays windows-free with no production activation route in the default graph.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const CORE = path.join(HOST, "core").replace(/\\/g, "/");
const CONTRACT = path.join(HOST, "contract").replace(/\\/g, "/");

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function stripTests(src) {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
}
function workdir() {
  return path.join(os.tmpdir(), "projectos-val-prod-owner-presence");
}
function compileConsumer(name, body, features) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat = features && features.length ? `, features = [${features.map((f) => `"${f}"`).join(", ")}]` : "";
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]", "", "[package]", `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"', 'edition = "2021"', "publish = false", "", "[dependencies]",
      `projectos-host-core = { path = "${CORE}"${feat} }`,
      `projectos-trust-contract = { path = "${CONTRACT}" }`, "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = spawnSync("cargo", ["build", "--offline", "--quiet"], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

// Default-graph control: reference every public production item without constructing a grant (which is
// impossible in the default graph). MUST compile.
const CONTROL = `
use projectos_host_core::{ProductionOwnerPresenceBindingGrant, ProductionOwnerPresenceCapability, ProductionOwnerPresenceEvidence, OwnerPresenceEvidenceSource, OwnerConfirmationOutcome, OwnerPresenceObservation, RequiredOwnerPresence, VerifiedOwnerPresence, OwnerPresenceError, verify_production_owner_presence};
fn takes_grant(_g: ProductionOwnerPresenceBindingGrant){}
fn names(_c: &ProductionOwnerPresenceCapability, _e: &ProductionOwnerPresenceEvidence, _s: OwnerPresenceEvidenceSource, _o: OwnerConfirmationOutcome, _obs: &OwnerPresenceObservation, _r: &RequiredOwnerPresence, _p: &VerifiedOwnerPresence, _err: OwnerPresenceError){ let _ = verify_production_owner_presence; }
fn main(){ let _ = takes_grant; let _ = names; println!("CONTROL_OK"); }
`;

const NEGATIVES = [
  { name: "neg_grant_struct_literal", why: "ProductionOwnerPresenceBindingGrant is caller-constructible via a struct literal",
    body: `use projectos_host_core::ProductionOwnerPresenceBindingGrant;\nfn f() -> ProductionOwnerPresenceBindingGrant { ProductionOwnerPresenceBindingGrant { generation: 0 } }\nfn main(){ let _ = f; }` },
  { name: "neg_grant_no_pub_ctor", why: "ProductionOwnerPresenceBindingGrant has a public constructor",
    body: `fn main(){ let _ = projectos_host_core::ProductionOwnerPresenceBindingGrant::new(); }` },
  { name: "neg_capability_struct_literal", why: "ProductionOwnerPresenceCapability is caller-constructible via a struct literal",
    body: `use projectos_host_core::ProductionOwnerPresenceCapability;\nfn f() -> ProductionOwnerPresenceCapability { ProductionOwnerPresenceCapability {} }\nfn main(){ let _ = f; }` },
  { name: "neg_capability_new_internal", why: "ProductionOwnerPresenceCapability::new_internal is callable externally",
    body: `fn main(){ let _ = projectos_host_core::ProductionOwnerPresenceCapability::new_internal(); }` },
  { name: "neg_capability_for_local_proof_default", why: "ProductionOwnerPresenceCapability::for_local_proof reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_core::ProductionOwnerPresenceCapability::for_local_proof(); }` },
  { name: "neg_grant_clone", why: "ProductionOwnerPresenceBindingGrant is Clone (single-use defeated)",
    body: `use projectos_host_core::ProductionOwnerPresenceBindingGrant;\nfn f(g: ProductionOwnerPresenceBindingGrant){ let _ = g.clone(); }\nfn main(){ let _ = f; }` },
  { name: "neg_grant_double_move", why: "ProductionOwnerPresenceBindingGrant can be consumed twice (replay / not single-use)",
    body: `use projectos_host_core::ProductionOwnerPresenceBindingGrant;\nfn consume(_g: ProductionOwnerPresenceBindingGrant){}\nfn f(g: ProductionOwnerPresenceBindingGrant){ consume(g); consume(g); }\nfn main(){ let _ = f; }` },
  { name: "neg_observation_into_grant", why: "an OwnerPresenceObservation converts into a production grant",
    body: `use projectos_host_core::{OwnerPresenceObservation, ProductionOwnerPresenceBindingGrant};\nfn f(o: OwnerPresenceObservation) -> ProductionOwnerPresenceBindingGrant { o.into() }\nfn main(){ let _ = f; }` },
  { name: "neg_evidence_into_grant", why: "a ProductionOwnerPresenceEvidence converts directly into a production grant",
    body: `use projectos_host_core::{ProductionOwnerPresenceEvidence, ProductionOwnerPresenceBindingGrant};\nfn f(e: ProductionOwnerPresenceEvidence) -> ProductionOwnerPresenceBindingGrant { e.into() }\nfn main(){ let _ = f; }` },
  { name: "neg_verified_presence_struct_literal", why: "VerifiedOwnerPresence is caller-constructible via a struct literal",
    body: `use projectos_host_core::VerifiedOwnerPresence;\nfn f() -> VerifiedOwnerPresence { VerifiedOwnerPresence { proof_digest: [0u8;32] } }\nfn main(){ let _ = f; }` },
  // CF1 — legacy-mint isolation: the observation-based mint must be ABSENT from the default graph
  //       (checked via the public module path so ungating the fn itself is caught, not only the re-export).
  { name: "cf1_legacy_mint_default", why: "the legacy observation-based verify_owner_presence mint is reachable in the default (production) graph",
    body: `fn main(){ let _ = projectos_host_core::owner_presence::verify_owner_presence; }` },
  // CF8 — no observation-based production mint may exist in the default graph.
  { name: "cf8_observation_production_mint_default", why: "an observation-based production mint is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_core::owner_presence::verify_production_owner_presence_from_observation; }` },
];

function run() {
  const errors = [];
  const opRaw = read(path.join(HOST, "core", "src", "owner_presence.rs"));
  const op = stripTests(opRaw);
  const coreToml = read(path.join(HOST, "core", "Cargo.toml"));
  const libRaw = read(path.join(HOST, "core", "src", "lib.rs"));

  // 0. LEGACY-MINT ISOLATION: the observation-based verify_owner_presence mint and its re-export must be
  //    test/fixtures-gated so a default build exposes only the grant-gated production mint.
  if (!/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\]\s*\npub fn verify_owner_presence\(/.test(opRaw))
    errors.push("verify_owner_presence is NOT test/fixtures-gated (legacy observation mint reachable in production)");
  if (!/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\]\s*\npub use owner_presence::verify_owner_presence;/.test(libRaw))
    errors.push("the verify_owner_presence re-export in lib.rs is NOT test/fixtures-gated");

  // 1. Grant: opaque, redacted, no derive/impl Clone/Copy/Default, thread-bound, no public ctor.
  if (!/pub struct ProductionOwnerPresenceBindingGrant/.test(op)) errors.push("missing ProductionOwnerPresenceBindingGrant");
  if (!/ProductionOwnerPresenceBindingGrant\(gen=\{\}, \[REDACTED\]\)/.test(op)) errors.push("grant Debug is not redacted");
  {
    const s = op.indexOf("pub struct ProductionOwnerPresenceBindingGrant");
    const head = s === -1 ? "" : op.slice(Math.max(0, s - 160), s);
    if (/#\[derive\([^)]*(Clone|Copy|Default)/.test(head)) errors.push("grant derives Clone/Copy/Default");
  }
  if (/impl (Clone|Copy|Default) for ProductionOwnerPresenceBindingGrant/.test(op)) errors.push("grant implements Clone/Copy/Default");
  if (/impl[^\n]*From<[^>]*> for ProductionOwnerPresenceBindingGrant/.test(op)) errors.push("core provides a From into the production grant (evidence could become authority)");

  // 2. Capability: sealed-by-construction (no public ctor), redacted, crate-private new_internal,
  //    test-gated for_local_proof, issue refuses fixture source.
  if (!/pub struct ProductionOwnerPresenceCapability/.test(op)) errors.push("missing ProductionOwnerPresenceCapability");
  if (!/ProductionOwnerPresenceCapability\(\[REDACTED\]\)/.test(op)) errors.push("capability Debug is not redacted");
  if (!/pub\(crate\) fn new_internal\(\) -> Self/.test(op)) errors.push("capability new_internal is not crate-private");
  {
    const m = op.indexOf("pub fn for_local_proof");
    const head = m === -1 ? "" : op.slice(Math.max(0, m - 160), m);
    if (m === -1) errors.push("missing ProductionOwnerPresenceCapability::for_local_proof");
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(head)) errors.push("for_local_proof is not test-fixtures gated");
  }
  if (!/if evidence\.source != OwnerPresenceEvidenceSource::Production/.test(op)) errors.push("issue does not refuse non-Production evidence");
  if (!/OwnerPresenceError::FixtureSource/.test(op)) errors.push("issue does not fail closed with FixtureSource");
  if (!/OwnerConfirmationOutcome::Refused => return Err\(OwnerPresenceError::Refused\)/.test(op)) errors.push("issue does not refuse a refused confirmation");
  if (!/OwnerConfirmationOutcome::Cancelled => return Err\(OwnerPresenceError::Cancelled\)/.test(op)) errors.push("issue does not refuse a cancelled confirmation");

  // 3. Production mint consumes the grant BY VALUE (single-use) and re-checks all live bindings.
  if (!/pub fn verify_production_owner_presence\(\s*grant: ProductionOwnerPresenceBindingGrant/.test(op))
    errors.push("verify_production_owner_presence does not move-consume the grant");
  for (const bind of [
    "OwnerPresenceError::OperationMismatch", "OwnerPresenceError::DisplaySummaryMismatch",
    "OwnerPresenceError::RuntimeMismatch", "OwnerPresenceError::IpcSessionMismatch",
    "OwnerPresenceError::ProviderMismatch", "OwnerPresenceError::EpochMismatch", "OwnerPresenceError::Expired",
  ]) if (!op.includes(bind)) errors.push("production mint does not enforce binding: " + bind);

  // 4. Thread-bound (!Send + !Sync) on grant + capability.
  const tb = (op.match(/_thread_bound: PhantomData<\*const \(\)>/g) || []).length;
  if (tb < 2) errors.push("grant and/or capability are not thread-bound (PhantomData<*const ()>)");

  // 5. Evidence Debug redacted (raw nonce / proof id never rendered).
  if (!/impl fmt::Debug for ProductionOwnerPresenceEvidence/.test(op)) errors.push("ProductionOwnerPresenceEvidence has no manual redacted Debug");
  if (!/ProductionOwnerPresenceEvidence\(source=\{:\?\}, outcome=\{:\?\}, gen=\{\}, \[REDACTED\]\)/.test(op)) errors.push("evidence Debug is not redacted");

  // 6. No evidence/presence -> other-authority conversions authored here.
  if (/impl[^\n]*From<[^>]*> for VerifiedOwnerPresence/.test(op)) errors.push("core provides a From into VerifiedOwnerPresence (observation could become authority)");
  if (/impl[^\n]*From<(VerifiedOwnerPresence|ProductionOwnerPresenceBindingGrant)>/.test(op)) errors.push("core converts owner presence / the grant into another type (must not imply elevation or effect)");

  // 7. core stays windows-free; no unexpected dependency.
  if (/windows(-sys)?\s*=|"windows"/.test(coreToml)) errors.push("host/core depends on windows/windows-sys (must remain windows-free)");
  for (const dep of ["projectos-trust-contract", "thiserror", "sha2"])
    if (!coreToml.includes(dep)) errors.push("host/core missing expected dependency: " + dep);

  // 8. Compile proofs.
  const control = compileConsumer("prodop_control", CONTROL);
  if (!control.ok) errors.push("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1600));
  // LP5 / PT3 — the fixture mint MUST remain available under the test-fixtures gate.
  const fixturePos = compileConsumer(
    "prodop_fixture_positive",
    `use projectos_host_core::verify_owner_presence;\nfn main(){ let _ = verify_owner_presence; }`,
    ["test-fixtures"]
  );
  if (!fixturePos.ok) errors.push("LP5 BROKEN — verify_owner_presence unavailable even with test-fixtures:\n" + fixturePos.out.slice(0, 1200));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) errors.push("OWNER-PRESENCE FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-production-owner-presence-provider1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-production-owner-presence-provider1a: PASS");
}
