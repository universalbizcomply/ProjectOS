// Validator: CD-B4-RUNTIME-IPC-PERMIT-INTEGRATION1A
//
// Proves runtime-instance + IPC-session authority are folded into the permit-context digest, the compare
// taxonomy, the bounded effect grant, execution-time currentness and witness EVIDENCE — and that an
// external caller cannot mutate those bindings or convert a witness/evidence back into authority.
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
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-runtime-ipc-permit-integration1a");
  return __SCRATCH_DIR;
}
function compileConsumer(name, body, features) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat = features && features.length ? `, features = [${features.map((f) => `"${f}"`).join(", ")}]` : "";
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]", "", "[package]", `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"', 'edition = "2021"', "publish = false", "",
      "[dependencies]",
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

// Default-graph control: the new public ContextField variants + effect API compile without fixtures.
const CONTROL = `
use projectos_host_core::{ContextField, mint_effect_grant};
fn main(){ let _a = ContextField::RuntimeInstance; let _b = ContextField::IpcSession; let _m = mint_effect_grant; println!("CONTROL_OK"); }
`;

const NEGATIVES = [
  { name: "neg_grant_mutate_runtime", feat: [], why: "the grant's runtime binding is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(mut g: BoundedEffectGrant){ g.runtime_instance_digest = None; }\nfn main(){ let _ = f; }` },
  { name: "neg_grant_mutate_ipc", feat: [], why: "the grant's IPC binding is caller-mutable",
    body: `use projectos_host_core::BoundedEffectGrant;\nfn f(mut g: BoundedEffectGrant){ g.ipc_session_digest = None; }\nfn main(){ let _ = f; }` },
  { name: "neg_context_mutate_runtime", feat: [], why: "the context runtime binding is caller-mutable",
    body: `use projectos_host_core::VerifiedExecutionContext;\nfn f(mut c: VerifiedExecutionContext){ c.runtime_instance_digest = None; }\nfn main(){ let _ = f; }` },
  { name: "neg_context_mutate_ipc", feat: [], why: "the context IPC binding is caller-mutable",
    body: `use projectos_host_core::VerifiedExecutionContext;\nfn f(mut c: VerifiedExecutionContext){ c.ipc_session_digest = None; }\nfn main(){ let _ = f; }` },
  { name: "neg_witness_to_runtime", feat: [], why: "an EffectWitness converts into runtime authority",
    body: `use projectos_host_core::{VerifiedRuntimeInstance, EffectWitness};\nfn f(w: EffectWitness){ let _r = VerifiedRuntimeInstance::from(w); }\nfn main(){ let _ = f; }` },
  { name: "neg_witness_to_ipc", feat: [], why: "an EffectWitness converts into IPC authority",
    body: `use projectos_host_core::{BoundIpcSession, EffectWitness};\nfn f(w: EffectWitness){ let _s = BoundIpcSession::from(w); }\nfn main(){ let _ = f; }` },
  { name: "neg_witness_to_permit", feat: [], why: "an EffectWitness converts into a permit",
    body: `use projectos_host_core::{ExecutionPermit, EffectWitness};\nfn f(w: EffectWitness){ let _p = ExecutionPermit::from(w); }\nfn main(){ let _ = f; }` },
  { name: "neg_witness_to_grant", feat: [], why: "an EffectWitness converts into a grant",
    body: `use projectos_host_core::{BoundedEffectGrant, EffectWitness};\nfn f(w: EffectWitness){ let _g = BoundedEffectGrant::from(w); }\nfn main(){ let _ = f; }` },
  { name: "neg_permit_from_runtime", feat: [], why: "a runtime instance converts into a permit",
    body: `use projectos_host_core::{ExecutionPermit, VerifiedRuntimeInstance};\nfn f(r: VerifiedRuntimeInstance){ let _p = ExecutionPermit::from(r); }\nfn main(){ let _ = f; }` },
  { name: "neg_grant_from_ipc", feat: [], why: "an IPC session converts into a grant",
    body: `use projectos_host_core::{BoundedEffectGrant, BoundIpcSession};\nfn f(s: BoundIpcSession){ let _g = BoundedEffectGrant::from(s); }\nfn main(){ let _ = f; }` },
  { name: "neg_witness_runtime_evidence_default", feat: [], why: "witness runtime-evidence accessor is reachable in the default graph",
    body: `use projectos_host_core::EffectWitness;\nfn f(w: &EffectWitness){ let _ = w.fixture_runtime_evidence(); }\nfn main(){ let _ = f; }` },
];

function run() {
  const errors = [];
  const cap = strip(read(path.join(HOST, "core", "src", "capability.rs")));
  const eff = strip(read(path.join(HOST, "core", "src", "effect.rs")));
  const red = strip(read(path.join(HOST, "core", "src", "reducer.rs")));

  // 1. Context binds both authorities (private fields).
  for (const fld of ["runtime_instance_digest: Option<[u8; 32]>", "runtime_generation: Option<u64>", "ipc_session_digest: Option<[u8; 32]>", "ipc_connection_id: Option<u64>", "ipc_handshake_generation: Option<u64>"])
    if (!cap.includes("pub(crate) " + fld)) errors.push("context missing runtime/ipc field: " + fld);

  // 2. Context digest (V3) folds runtime + IPC identity.
  if (!cap.includes("PROJECTOS:PERMIT-CONTEXT-DIGEST:V3")) errors.push("context digest domain not bumped to V3");
  {
    const di = cap.indexOf("fn digest_of");
    const body = di === -1 ? "" : cap.slice(di, cap.indexOf("finalize", di));
    for (const n of ["c.runtime_instance_digest", "c.runtime_generation", "c.ipc_session_digest", "c.ipc_connection_id", "c.ipc_handshake_generation"])
      if (!body.includes(n)) errors.push("digest_of does not fold: " + n);
  }

  // 3. compare taxonomy: new ContextField variants + compare rows.
  for (const v of ["RuntimeInstance", "IpcSession"])
    if (!new RegExp("ContextField \\{[\\s\\S]*\\b" + v + ",").test(cap) && !new RegExp("\\n    " + v + ",").test(cap))
      errors.push("ContextField missing variant: " + v);
  if (!/let checks: \[\(bool, F\); 42\]/.test(cap)) errors.push("compare array not extended to 42 (runtime+ipc rows)");
  if (!/F::RuntimeInstance/.test(cap)) errors.push("compare has no RuntimeInstance row");
  if (!/F::IpcSession/.test(cap)) errors.push("compare has no IpcSession row");

  // 4. Grant records both bindings (private) + mint sets them from current + execution-time refusals.
  for (const fld of ["runtime_instance_digest: Option<[u8; 32]>", "ipc_session_digest: Option<[u8; 32]>"])
    if (!eff.includes(fld)) errors.push("grant/witness missing binding field: " + fld);
  if (!/runtime_instance_digest: current\.runtime_instance_digest\(\)/.test(eff)) errors.push("grant mint does not record runtime binding from context");
  if (!/ipc_session_digest: current\.ipc_session_digest\(\)/.test(eff)) errors.push("grant mint does not record ipc binding from context");
  for (const e of ["RuntimeInstanceMismatch", "RuntimeNotCurrent", "IpcSessionMismatch", "IpcNotCurrent"])
    if (!new RegExp("EffectGrantError::" + e + "\\b|\\b" + e + ",").test(eff)) errors.push("missing integration refusal: " + e);
  {
    const pb = eff.indexOf("fn perform_bound");
    const body = pb === -1 ? "" : eff.slice(pb, eff.indexOf("fn witness", pb));
    for (const n of ["runtime.is_current(", "ipc.is_current(", "grant.runtime_instance_digest()", "grant.ipc_session_digest()"])
      if (!body.includes(n)) errors.push("perform_bound does not check: " + n);
  }
  // Witness records runtime/ipc EVIDENCE from the grant; no From into authority.
  if (!/runtime_instance_digest: grant\.runtime_instance_digest\(\)/.test(eff)) errors.push("witness does not record runtime evidence");
  if (/impl From<EffectWitness>/.test(eff)) errors.push("EffectWitness has a From (evidence could become authority)");

  // 5. Reducer threads both authorities into the request + context literal.
  for (const n of ["runtime_instance: Option<&'a crate::runtime_instance::VerifiedRuntimeInstance>", "ipc_session: Option<&'a crate::ipc_session::BoundIpcSession>"])
    if (!red.includes(n)) errors.push("ReductionRequest missing field: " + n);
  if (!/runtime_instance_digest: req\.runtime_instance\.map/.test(red)) errors.push("reducer does not stamp runtime identity into context");
  if (!/ipc_session_digest: req\.ipc_session\.map/.test(red)) errors.push("reducer does not stamp ipc identity into context");
  if (!/pub fn to_request_with_authorities/.test(red)) errors.push("reducer missing to_request_with_authorities overlay");

  // 6. Compile proofs.
  const ctl = compileConsumer("integ_control", CONTROL, []);
  if (!ctl.ok) errors.push("DEFAULT-graph control failed to compile (setup broken):\n" + ctl.out.slice(0, 1400));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.feat);
    if (r.ok) errors.push("INTEGRATION FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }
  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-runtime-ipc-permit-integration1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-runtime-ipc-permit-integration1a: PASS");
}
