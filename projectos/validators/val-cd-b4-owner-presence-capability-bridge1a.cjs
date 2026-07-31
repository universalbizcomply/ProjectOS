// Validator: CD-B4-PRODUCTION-OWNER-PRESENCE-CAPABILITY-BRIDGE1A
//
// Fails closed. Proves the owner-presence capability bridge:
//  - the bridge returns ONLY VerifiedOwnerPresence: no binding, evidence, grant or capability escapes;
//  - the production entry point REFUSES fixture-marked evidence before anything else;
//  - currentness (runtime, IPC, lifecycle epoch) is enforced before issuance;
//  - the bridge mints nothing and adds no second capability system;
//  - the fixture chain-proof entry point is feature-gated and absent from the default graph;
//  - the adapter's fixture-evidence feature is non-default, dependency-free, never reaches a live
//    Windows/consent surface, and marks its evidence permanently;
//  - no crate enables the fixture features outside dev-dependencies (Cargo unifies features);
//  - renderer and src-tauri gain nothing;
//  - and (rustc negative compiles) a downstream default-graph crate cannot produce fixture evidence,
//    cannot reach the fixture entry point, and cannot construct evidence or a binding.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const BRIDGE = path.join(HOST, "owner-presence-bridge");
const ADAPTER = path.join(HOST, "windows-owner-verification");
const CORE = path.join(HOST, "core");
const BRIDGE_PATH = BRIDGE.replace(/\\/g, "/");
const ADAPTER_PATH = ADAPTER.replace(/\\/g, "/");

const read = (p) => fs.readFileSync(p, "utf8");
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripToml = (s) => s.replace(/#.*/g, "");

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-owner-presence-capability-bridge1a");
  return __SCRATCH_DIR;
}

function compileConsumer(name, body, deps) {
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
      `projectos-host-owner-presence-bridge = { path = "${BRIDGE_PATH}" }`,
      `projectos-host-windows-owner-verification = { path = "${ADAPTER_PATH}" }`,
      ...(deps || []),
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

// The production surface IS nameable downstream — a real host must call it. What a dependent cannot do
// is obtain the authority or produce the evidence it requires.
const CONTROL = `
use projectos_host_owner_presence_bridge as b;
fn names(_e: b::BridgeError, _l: b::LifecycleContext, _r: &b::PresenceRequest<'_>) {}
fn main(){
    let _ = names;
    let _ = b::verify_owner_presence_at_control_centre;
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_fixture_evidence_default_graph",
    why: "the default graph can produce fixture owner evidence",
    body: `fn main(){ let _ = projectos_host_windows_owner_verification::fixture_owner_evidence; }`,
  },
  {
    name: "neg_fixture_entry_default_graph",
    why: "the fixture chain-proof entry point is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_owner_presence_bridge::verify_owner_presence_for_local_proof; }`,
  },
  {
    name: "neg_evidence_struct_literal",
    why: "VerifiedWindowsOwnerEvidence is caller-constructible",
    body: `use projectos_host_windows_owner_verification as o;\nfn f() -> o::VerifiedWindowsOwnerEvidence { o::VerifiedWindowsOwnerEvidence{ proof_digest:[0u8;32], generation:0, fixture:false } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_set_fixture_marker",
    why: "a caller can clear or set the fixture marker",
    body: `use projectos_host_windows_owner_verification as o;\nfn f(e: &mut o::VerifiedWindowsOwnerEvidence) { e.fixture = false; }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_bridge_returns_grant",
    why: "the bridge exposes a grant type",
    body: `use projectos_host_owner_presence_bridge as b;\nfn f() -> b::ProductionOwnerPresenceBindingGrant { unimplemented!() }\nfn main(){ let _ = f; }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const libPath = path.join(BRIDGE, "src", "lib.rs");
  const tomlPath = path.join(BRIDGE, "Cargo.toml");
  for (const p of [libPath, tomlPath, path.join(BRIDGE, "tests", "chain_proof.rs")])
    if (!fs.existsSync(p)) E("V1 missing mandatory path: " + p);
  if (errors.length) return errors;

  const lib = read(libPath);
  const libCode = stripLine(lib);
  const bridgeToml = stripToml(read(tomlPath));
  const adapterToml = stripToml(read(path.join(ADAPTER, "Cargo.toml")));

  // ---- V2 the bridge returns ONLY VerifiedOwnerPresence ----
  {
    const re = /pub fn\s+([a-z0-9_]+)\s*\([^{}]*?\)\s*->\s*Result<\s*([A-Za-z0-9_]+)/g;
    for (let m; (m = re.exec(libCode)); )
      if (m[2] !== "VerifiedOwnerPresence")
        E("V2 public fn " + m[1] + " returns " + m[2] + " (only VerifiedOwnerPresence may leave)");
  }
  for (const t of [
    "TrustedControlCentreWindowBinding",
    "ProductionOwnerPresenceBindingGrant",
    "ProviderAuthorityLease",
  ])
    if (new RegExp("->\\s*(Result<\\s*)?" + t).test(libCode))
      E("V2 the bridge returns a " + t);

  // ---- V3 fixture evidence is refused FIRST on the production path ----
  {
    const prod = libCode.slice(libCode.indexOf("pub fn verify_owner_presence_at_control_centre"));
    const body = prod.slice(0, prod.indexOf("\n}"));
    if (!/if evidence\.is_fixture\(\)\s*\{\s*return Err\(BridgeError::FixtureEvidence\);/.test(body))
      E("V3 the production entry point does not refuse fixture evidence");
    const guardAt = body.indexOf("is_fixture()");
    const workAt = body.indexOf("complete_presence(");
    if (guardAt === -1 || workAt === -1 || guardAt > workAt)
      E("V3 the fixture-evidence guard does not precede the work");
  }

  // ---- V3b the marker the guard depends on is actually set by the fixture producer ----
  // The production guard is only as good as the marker. Asserted HERE as well as in the adapter's own
  // V9d: a producer that cleared its marker would silently defeat V3 without failing this validator.
  {
    const adapterLib = stripLine(read(path.join(ADAPTER, "src", "lib.rs")));
    const fx = adapterLib.indexOf("pub fn fixture_owner_evidence(");
    const body = fx === -1 ? "" : adapterLib.slice(fx);
    if (fx === -1) E("V3b the adapter fixture producer is missing");
    else if (!/fixture:\s*true/.test(body.slice(0, body.indexOf("\n}") + 2)))
      E("V3b the fixture producer does not mark its evidence as fixture");
    if (!/fn mint\([^)]*\)[\s\S]{0,200}?fixture:\s*false/.test(adapterLib))
      E("V3b the live mint does not clear the fixture marker");
  }

  // ---- V4 currentness is enforced before issuance ----
  {
    const done = libCode.slice(libCode.indexOf("fn complete_presence"));
    const body = done.slice(0, done.indexOf("\n}"));
    for (const [needle, what] of [
      ["is_current(authority.runtime(), now)", "runtime currentness"],
      ["is_current(authority.ipc(), runtime, now)", "IPC currentness"],
      ["lifecycle.captured_epoch != lifecycle.current_epoch", "lifecycle epoch"],
    ])
      if (!body.includes(needle)) E("V4 missing " + what + " check");
    const issueAt = body.indexOf(".issue(");
    for (const needle of [
      "is_current(authority.runtime(), now)",
      "is_current(authority.ipc(), runtime, now)",
      "lifecycle.captured_epoch != lifecycle.current_epoch",
    ])
      if (body.indexOf(needle) > issueAt) E("V4 a currentness check runs after issuance");
    if (!/verify_production_owner_presence\(\s*grant,/.test(body))
      E("V4 the grant is not consumed by the final verification");
  }

  // ---- V5 the bridge mints nothing and adds no second capability system ----
  // Anchored on CALLS/definitions, not bare substrings: the fixture entry point is legitimately named
  // `verify_owner_presence_for_local_proof`, which must not trip a "for_local_proof" search.
  for (const t of [
    "::new_internal\\s*\\(",
    "::for_local_proof\\s*\\(",
    "struct\\s+\\w*Capability",
    "fn\\s+issue\\s*\\(",
  ])
    if (new RegExp(t).test(libCode))
      E("V5 the bridge defines or reaches a capability constructor: " + t);
  if (/\bunsafe\b/.test(libCode)) E("V5 the bridge contains unsafe");
  if (!/#!\[forbid\(unsafe_code\)\]/.test(lib)) E("V5 the bridge does not forbid unsafe");

  // ---- V6 the fixture chain-proof entry point is gated ----
  if (!/#\[cfg\(feature = "fixture-chain-proof"\)\]\s*\n(\s*#\[[^\]]*\]\s*\n)*\s*pub fn verify_owner_presence_for_local_proof/.test(lib))
    E("V6 the fixture chain-proof entry point is not feature-gated");
  {
    const feats = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(bridgeToml) || [])[1] || "";
    if (!/default\s*=\s*\[\s*\]/.test(feats)) E("V6 the bridge default feature set is not empty");
  }

  // ---- V7 the adapter fixture feature is bounded ----
  {
    const feats = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(adapterToml) || [])[1] || "";
    const m = /fixture-owner-evidence\s*=\s*\[([^\]]*)\]/.exec(feats);
    if (!m) E("V7 the adapter fixture-evidence feature is missing");
    else if (m[1].trim() !== "") E("V7 the adapter fixture-evidence feature pulls a dependency");
  }

  // ---- V8 no crate enables the fixture features outside dev-dependencies ----
  {
    const walk = (dir) => {
      let hits = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "target", "dist"].includes(ent.name)) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) hits = hits.concat(walk(p));
        else if (ent.name === "Cargo.toml") hits.push(p);
      }
      return hits;
    };
    for (const manifest of walk(path.join(ROOT, "projectos"))) {
      for (const section of stripToml(read(manifest)).split(/\n(?=\[)/)) {
        const header = (/^\[([^\]]+)\]/.exec(section) || [])[1] || "";
        if (/^dev-dependencies/.test(header) || /^features/.test(header)) continue;
        if (/fixture-owner-evidence|fixture-chain-proof/.test(section))
          E(
            "V8 a fixture feature is enabled outside dev-dependencies in " +
              path.relative(ROOT, manifest) + " [" + header + "]"
          );
      }
    }
  }

  // ---- V9 renderer and src-tauri gain nothing ----
  {
    const st = path.join(ROOT, "projectos", "control-center", "src-tauri");
    if (fs.existsSync(st)) {
      const stToml = read(path.join(st, "Cargo.toml"));
      for (const t of ["owner-presence-bridge", "fixture-owner-evidence", "fixture-chain-proof"])
        if (stToml.includes(t)) E("V9 src-tauri references " + t);
    }
    const renderer = path.join(ROOT, "projectos", "control-center", "src");
    const walk = (dir) => {
      let hits = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (["node_modules", "dist", "src-tauri"].includes(ent.name)) continue;
          hits = hits.concat(walk(p));
        } else if (/\.(ts|tsx|js|jsx|svelte|vue|html)$/.test(ent.name)) {
          const body = read(p);
          for (const t of ["VerifiedOwnerPresence", "verify_owner_presence", "is_fixture"])
            if (body.includes(t)) hits.push(ent.name + " -> " + t);
        }
      }
      return hits;
    };
    if (fs.existsSync(renderer)) {
      const hits = walk(renderer);
      if (hits.length) E("V9 renderer names a host-only owner-presence surface: " + hits.join(", "));
    }
  }

  // ---- V10 core is untouched by this phase's authority surface ----
  {
    const op = read(path.join(CORE, "src", "owner_presence.rs"));
    if (/\bpub fn new_internal\(/.test(op)) E("V10 the core owner-presence capability ctor became public");
  }

  // ---- compile proofs ----
  const control = compileConsumer("opb_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1800));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.deps);
    if (r.ok) E("OWNER-PRESENCE BRIDGE LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-owner-presence-capability-bridge1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-owner-presence-capability-bridge1a: PASS");
}
