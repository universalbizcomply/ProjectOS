// Validator: CD-B4-RUNTIME-INSTANCE-AUTHORITY1A
//
// Proves the runtime-instance authority is opaque and sealed-verifier-minted: an external caller cannot
// construct/forge/clone/copy/serialise a VerifiedRuntimeInstance, cannot convert an observation or
// service-instance evidence into authority, cannot reach the fixture verifier in the default graph, and
// cannot mutate the bound identity. Structural checks + default-graph compile proofs + a positive control.
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
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-runtime-instance-authority1a");
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

// Default-graph control: production-visible runtime-instance API compiles without any fixture feature.
const CONTROL = `
use projectos_host_core::{HostRole, RuntimeSource, RuntimeInstanceObservation, RuntimeInstanceError, ServiceInstanceEvidence};
use projectos_host_core::SessionId;
fn main(){
    let _o = RuntimeInstanceObservation {
        role: HostRole::InteractiveFallback,
        source: RuntimeSource::InteractiveFallback,
        pid: 1, creation_tick: 1, session: Some(SessionId::new("s")),
        observed_at: 1, valid_until: 2, service_evidence: ServiceInstanceEvidence::new(1,1),
    };
    let _e: Option<RuntimeInstanceError> = None;
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  { name: "neg_construct", feat: [], why: "VerifiedRuntimeInstance constructed directly",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn main(){ let _r = VerifiedRuntimeInstance{}; }` },
  { name: "neg_default", feat: [], why: "VerifiedRuntimeInstance has Default",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn main(){ let _r: VerifiedRuntimeInstance = Default::default(); }` },
  { name: "neg_clone", feat: [], why: "VerifiedRuntimeInstance is Clone",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(r: VerifiedRuntimeInstance){ let _c: VerifiedRuntimeInstance = r.clone(); }\nfn main(){ let _ = f; }` },
  { name: "neg_copy", feat: [], why: "VerifiedRuntimeInstance is Copy",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(r: VerifiedRuntimeInstance){ let _a = r; let _b = r; }\nfn main(){ let _ = f; }` },
  { name: "neg_from_bool", feat: [], why: "a Boolean converts into runtime authority",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn main(){ let _r = VerifiedRuntimeInstance::from(true); }` },
  { name: "neg_from_observation", feat: [], why: "an observation converts into runtime authority",
    body: `use projectos_host_core::{VerifiedRuntimeInstance, RuntimeInstanceObservation};\nfn f(o: RuntimeInstanceObservation){ let _r = VerifiedRuntimeInstance::from(o); }\nfn main(){ let _ = f; }` },
  { name: "neg_from_evidence", feat: [], why: "service-instance evidence converts into runtime authority",
    body: `use projectos_host_core::{VerifiedRuntimeInstance, ServiceInstanceEvidence};\nfn f(e: ServiceInstanceEvidence){ let _r = VerifiedRuntimeInstance::from(e); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_generation", feat: [], why: "the runtime generation is caller-mutable",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(mut r: VerifiedRuntimeInstance){ r.generation = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_provider", feat: [], why: "the runtime provider identity is caller-mutable",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(mut r: VerifiedRuntimeInstance){ r.provider_id = String::new(); }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_epoch", feat: [], why: "the runtime provider epoch is caller-mutable",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(mut r: VerifiedRuntimeInstance){ r.provider_epoch = 0; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_pid", feat: [], why: "the runtime pid is caller-mutable",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(mut r: VerifiedRuntimeInstance){ r.pid = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_creation_tick", feat: [], why: "the runtime creation tick is caller-mutable",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(mut r: VerifiedRuntimeInstance){ r.creation_tick = 1; }\nfn main(){ let _ = f; }` },
  { name: "neg_mutate_session", feat: [], why: "the runtime session is caller-mutable",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(mut r: VerifiedRuntimeInstance){ r.session = None; }\nfn main(){ let _ = f; }` },
  { name: "neg_extend_valid_until", feat: [], why: "the runtime validity boundary is caller-mutable",
    body: `use projectos_host_core::VerifiedRuntimeInstance;\nfn f(mut r: VerifiedRuntimeInstance){ r.valid_until = 999_999; }\nfn main(){ let _ = f; }` },
  { name: "neg_fixture_verifier_default_graph", feat: [], why: "FixtureRuntimeInstanceVerifier is reachable in the default graph",
    body: `fn main(){ let _v = projectos_host_core::FixtureRuntimeInstanceVerifier::new(); }` },
  { name: "neg_call_mint", feat: [], why: "the crate-internal mint is reachable externally",
    body: `use projectos_host_core::runtime_instance;\nfn main(){ let _ = runtime_instance::mint; }` },
];

function run() {
  const errors = [];
  const src = strip(read(path.join(HOST, "core", "src", "runtime_instance.rs")));
  const raw = read(path.join(HOST, "core", "src", "runtime_instance.rs"));
  const lib = read(path.join(HOST, "core", "src", "lib.rs"));

  // 1. Opaque authority type.
  if (!/pub struct VerifiedRuntimeInstance\b/.test(src)) errors.push("missing type: VerifiedRuntimeInstance");
  const decl = src.slice(src.indexOf("pub struct VerifiedRuntimeInstance"));
  const body = decl.slice(0, decl.indexOf("}"));
  if (/\bpub\s+\w+:/.test(body)) errors.push("VerifiedRuntimeInstance has a public field (must be opaque)");
  if (/#\[derive\([^)]*\b(Clone|Copy|Default|Serialize|Deserialize)\b[^)]*\)\]\s*pub struct VerifiedRuntimeInstance/.test(src))
    errors.push("VerifiedRuntimeInstance derives a forbidden trait (Clone/Copy/Default/serde)");
  if (!/impl fmt::Debug for VerifiedRuntimeInstance\b/.test(src)) errors.push("VerifiedRuntimeInstance has no hand-written Debug");
  if (!/VerifiedRuntimeInstance\(gen=\{\}, \[REDACTED\]\)/.test(raw)) errors.push("VerifiedRuntimeInstance Debug is not redacted");
  if (!/PhantomData<\*const \(\)>/.test(src)) errors.push("VerifiedRuntimeInstance is not thread-bound (!Send + !Sync)");
  if (/impl From<[^>]*> for VerifiedRuntimeInstance/.test(src))
    errors.push("VerifiedRuntimeInstance has a From (observation/evidence/bool could become authority)");
  // Real serde usage only (derive/impl/import) — not doc-comment prose like "no serde-as-authority".
  if (/derive\([^)]*\b(Serialize|Deserialize)\b|use serde|serde::|#\[serde\b/.test(src))
    errors.push("runtime_instance references serialisation");

  // 2. Sealed verifier + private mint.
  if (!/mod sealed \{\s*pub trait Sealed \{\}/.test(src.replace(/\s+/g, " ")))
    errors.push("verifier is not sealed via a private Sealed trait");
  if (!/pub trait RuntimeInstanceVerifier: sealed::Sealed/.test(src))
    errors.push("RuntimeInstanceVerifier is not sealed");
  if (!/\nfn mint<V: RuntimeInstanceVerifier/.test(src)) errors.push("mint is not crate-private (must not be pub)");
  if (/pub fn mint\b/.test(src)) errors.push("mint is public (must be crate-internal)");

  // 3. Structured refusal taxonomy (no bare bool failure).
  for (const e of ["GenerationMismatch", "ProviderMismatch", "ProviderEpochMismatch", "Expired", "ExpiryBeyondBound", "StaleObservation", "RoleNotAccepted", "SourceNotAccepted", "ServiceEvidenceMissing", "ServiceEvidenceInconsistent", "SessionMismatch", "InvalidProcessIdentity"])
    if (!new RegExp("RuntimeInstanceError::" + e + "\\b|\\b" + e + ",").test(src)) errors.push("missing refusal variant: " + e);

  // 4. Currentness folds the load-bearing comparisons.
  const cur = src.slice(src.indexOf("fn is_current"));
  for (const needle of ["now.provider_id()", "now.epoch()", "verifier.generation()", "self.valid_until"])
    if (!cur.slice(0, cur.indexOf("matches_session")).includes(needle)) errors.push("is_current does not compare: " + needle);

  // 5. Verifier-assigned generation (not caller-assigned): mint stamps verifier.generation().
  if (!/let generation = verifier\.generation\(\);/.test(src)) errors.push("generation is not verifier-assigned in mint");

  // 6. Fixture verifier is feature-gated in both the module and the lib re-export.
  if (!/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\]\s*\npub use fixture::FixtureRuntimeInstanceVerifier;/.test(src))
    errors.push("FixtureRuntimeInstanceVerifier is not test-gated in the module");
  {
    const lines = lib.split("\n");
    const idx = lines.findIndex((l) => l.includes("FixtureRuntimeInstanceVerifier") && l.trim().startsWith("pub use"));
    if (idx === -1) errors.push("FixtureRuntimeInstanceVerifier not re-exported");
    else if (!/cfg\(any\(test, feature = "test-fixtures"\)\)/.test(lines[idx - 1]))
      errors.push("FixtureRuntimeInstanceVerifier re-export is not test-gated");
  }

  // 7. Compile proofs.
  const ctl = compileConsumer("runtime_control", CONTROL, []);
  if (!ctl.ok) errors.push("DEFAULT-graph control failed to compile (setup broken):\n" + ctl.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.feat);
    if (r.ok) errors.push("RUNTIME AUTHORITY FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-runtime-instance-authority1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-runtime-instance-authority1a: PASS");
}
