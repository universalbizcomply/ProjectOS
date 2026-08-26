// Validator: CD-B4-SEALED-EXPECTED-WINDOW-FACTS1A
//
// Fails closed. Proves the G4 option-B1 lease-gated sink:
//  - the trusted binding digests are handed to a sink as ARGUMENTS and are never returned, stored or
//    placed in a shared authority object;
//  - `instance_digest()` / `session_digest()` stay pub(crate) — no public digest getter is added
//    anywhere in core;
//  - `with_expected_window_facts` requires a borrowed ProviderCapabilitySet (the retained cold-start
//    authority) and BORROWS it, so obtaining expectations spends no authority;
//  - the caller-supplied metadata carries NO digest field, so an observation-provided digest can never
//    substitute a trusted core value;
//  - the sink mints nothing (it returns only the caller's own associated type);
//  - the adapter stays independent of core, and the renderer names none of it;
//  - and (rustc negative compiles) a downstream crate cannot read a digest off a trusted value, cannot
//    call the sink without the retained authority, and cannot obtain the digests as a returned value.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const CORE = path.join(HOST, "core");
const AUTH = path.join(HOST, "host-authority");
const ADAPTER = path.join(HOST, "windows-owner-verification");
const CORE_PATH = CORE.replace(/\\/g, "/");
const AUTH_PATH = AUTH.replace(/\\/g, "/");

const read = (p) => fs.readFileSync(p, "utf8");
const stripTests = (src) => {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
};

// Remove Rust comments without touching real code; string/raw/byte/char literals preserved verbatim, so
// prose can neither satisfy nor trip a source invariant.
function stripRustComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    const raw = /^b?r(#*)"/.exec(src.slice(i, i + 8));
    if (raw && (i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1]))) {
      const hashes = raw[1];
      const open = i + raw[0].length;
      const close = src.indexOf('"' + hashes, open);
      const end = close === -1 ? n : close + 1 + hashes.length;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (c === "'" && /^'(\\.|[^'\\])'/.test(src.slice(i, i + 4))) {
      const m = /^'(\\.|[^'\\])'/.exec(src.slice(i, i + 4))[0];
      out += m;
      i += m.length;
      continue;
    }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-sealed-expected-window-facts1a");
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
      `projectos-host-core = { path = "${CORE_PATH}" }`,
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

// A dependent MAY implement the sink and name the contract — that is the point. What it cannot do is
// obtain the authority to drive it, or read a digest any other way.
const CONTROL = `
use projectos_host_core as c;
struct S;
impl c::ExpectedWindowFactsSink for S {
    type Out = ();
    fn build(self, _l: &str, _p: u32, _s: u32, _r: [u8;32], _i: [u8;32], _e: u64, _v: u64) {}
}
fn names(_m: &c::ExpectedWindowMetadata<'_>) {}
fn main(){
    let _ = names;
    let _s = S;
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_runtime_instance_digest",
    why: "the runtime instance digest is publicly readable",
    body: `use projectos_host_core as c;\nfn f(r: &c::VerifiedRuntimeInstance) -> [u8;32] { r.instance_digest() }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_ipc_session_digest",
    why: "the IPC session digest is publicly readable",
    body: `use projectos_host_core as c;\nfn f(s: &c::BoundIpcSession) -> [u8;32] { s.session_digest() }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_sink_without_authority",
    why: "the sink can be driven without the retained provider authority",
    body: `use projectos_host_core as c;\nstruct S;\nimpl c::ExpectedWindowFactsSink for S { type Out = (); fn build(self,_l:&str,_p:u32,_s:u32,_r:[u8;32],_i:[u8;32],_e:u64,_v:u64){} }\nfn f(r: &c::VerifiedRuntimeInstance, i: &c::BoundIpcSession, m: c::ExpectedWindowMetadata<'_>) { c::with_expected_window_facts(r, i, m, S); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_metadata_digest_field",
    why: "caller metadata carries a digest field an observation could substitute",
    body: `use projectos_host_core as c;\nfn f() -> c::ExpectedWindowMetadata<'static> { c::ExpectedWindowMetadata{ expected_label:"main", expected_process_id:1, expected_session:1, current_lifecycle_epoch:1, valid_until:2, expected_runtime_instance_digest:[0u8;32] } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_digest_returned",
    why: "a core function returns the trusted binding digests directly",
    body: `use projectos_host_core as c;\nfn f(a: &c::ProviderCapabilitySet, r: &c::VerifiedRuntimeInstance, i: &c::BoundIpcSession) -> ([u8;32],[u8;32]) { c::expected_window_facts::trusted_binding_digests(a, r, i) }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_set_consumed_by_sink",
    why: "driving the sink consumes the provider capability set (spends authority)",
    body: `use projectos_host_core as c;\nstruct S;\nimpl c::ExpectedWindowFactsSink for S { type Out = (); fn build(self,_l:&str,_p:u32,_s:u32,_r:[u8;32],_i:[u8;32],_e:u64,_v:u64){} }\nfn f(a: c::ProviderCapabilitySet, r: &c::VerifiedRuntimeInstance, i: &c::BoundIpcSession, m: c::ExpectedWindowMetadata<'_>) { c::with_expected_window_facts(a, r, i, m, S); }\nfn main(){ let _ = f; }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const sinkPath = path.join(CORE, "src", "expected_window_facts.rs");
  if (!fs.existsSync(sinkPath)) {
    E("V1 missing mandatory path: " + sinkPath);
    return errors;
  }
  const sink = read(sinkPath);
  const sinkCode = stripRustComments(stripTests(sink));

  // ---- V2 no public digest getter anywhere in core ----
  for (const [file, fn] of [
    ["runtime_instance.rs", "instance_digest"],
    ["ipc_session.rs", "session_digest"],
  ]) {
    const body = stripRustComments(read(path.join(CORE, "src", file)));
    if (!new RegExp("pub\\(crate\\) fn " + fn + "\\(").test(body))
      E("V2 " + fn + " is not pub(crate)");
    if (new RegExp("\\bpub fn " + fn + "\\(").test(body)) E("V2 " + fn + " is public");
  }
  // No core module may add a public alias for EITHER sealed value. Scoped to these two names only:
  // core has other, unrelated public digest surfaces (policy/context/proof digests) that this phase
  // neither adds nor governs, and flagging them would be a false positive.
  for (const f of fs.readdirSync(path.join(CORE, "src"))) {
    if (!f.endsWith(".rs")) continue;
    const body = stripRustComments(stripTests(read(path.join(CORE, "src", f))));
    const re = /pub fn\s+([a-z0-9_]*(?:instance_digest|session_digest)[a-z0-9_]*)\s*\(/g;
    for (let m; (m = re.exec(body)); )
      E("V2 public getter for a sealed binding digest in " + f + ": fn " + m[1]);
  }

  // ---- V3 the sink receives digests as ARGUMENTS, never in a container, never returned ----
  if (!/fn build\(\s*self,[\s\S]*?expected_runtime_instance_digest: \[u8; 32\],\s*expected_ipc_session_digest: \[u8; 32\],/.test(sinkCode))
    E("V3 the sink does not receive both binding digests as arguments");
  {
    // No type in this module may STORE a digest.
    const re = /pub struct\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g;
    for (let m; (m = re.exec(sinkCode)); )
      if (/\[u8;\s*32\]/.test(m[2])) E("V3 " + m[1] + " stores a binding digest");
  }
  // No fn in this module may RETURN a digest.
  if (/fn\s+\w+\s*(?:<[^>{}]*>)?\s*\([^{}]*?\)\s*->\s*(?:\[u8;\s*32\]|\(\s*\[u8;\s*32\])/.test(sinkCode))
    E("V3 a function in the sink module returns a binding digest");

  // ---- V4 the entry point requires the RETAINED authority, by borrow ----
  if (!/pub fn with_expected_window_facts<S: ExpectedWindowFactsSink>\(\s*_authority: &ProviderCapabilitySet,/.test(sinkCode))
    E("V4 the entry point does not take a borrowed ProviderCapabilitySet first");
  if (/_authority: ProviderCapabilitySet/.test(sinkCode))
    E("V4 the entry point consumes the provider authority (must borrow)");
  if (!/runtime\.instance_digest\(\)/.test(sinkCode) || !/ipc\.session_digest\(\)/.test(sinkCode))
    E("V4 the digests are not read from the trusted values");

  // ---- V5 metadata carries no digest a caller could substitute ----
  {
    const m = /pub struct ExpectedWindowMetadata<'a>\s*\{([\s\S]*?)\n\}/.exec(sinkCode);
    if (!m) E("V5 ExpectedWindowMetadata is missing");
    else if (/\[u8;\s*32\]|digest/i.test(m[1]))
      E("V5 ExpectedWindowMetadata carries a digest field (observation could substitute a trusted value)");
  }

  // ---- V6 the sink mints nothing ----
  for (const t of [
    "ProductionOwnerPresenceCapability",
    "ProductionOwnerPresenceBindingGrant",
    "BoundedEffectGrant",
    "ExecutionPermit",
    "ValidatedOwnerPresenceFact",
    "open_provider_authority",
  ])
    if (sinkCode.includes(t)) E("V6 the sink module references an authority-minting surface: " + t);
  if (/\bunsafe\b/.test(sinkCode)) E("V6 the sink module contains unsafe");
  if (/\bserde\b|\bSerialize\b|\bDeserialize\b/.test(sinkCode))
    E("V6 the sink module references serde in executable source");

  // ---- V7 the adapter stays independent of core ----
  {
    const adapterToml = read(path.join(ADAPTER, "Cargo.toml"));
    if (/projectos-host-core/.test(adapterToml))
      E("V7 the adapter gained a dependency on core (it must stay independent)");
  }

  // ---- V8 the renderer names none of this ----
  {
    const rendererRoot = path.join(ROOT, "projectos", "control-center", "src");
    const HOST_ONLY = [
      "ExpectedWindowFactsSink",
      "ExpectedWindowMetadata",
      "with_expected_window_facts",
      "instance_digest",
      "session_digest",
    ];
    const walk = (dir) => {
      let hits = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "src-tauri") continue;
          hits = hits.concat(walk(p));
        } else if (/\.(ts|tsx|js|jsx|svelte|vue|html)$/.test(ent.name)) {
          const body = fs.readFileSync(p, "utf8");
          for (const t of HOST_ONLY) if (body.includes(t)) hits.push(ent.name + " -> " + t);
        }
      }
      return hits;
    };
    if (fs.existsSync(rendererRoot)) {
      const hits = walk(rendererRoot);
      if (hits.length) E("V8 renderer names a host-only expected-facts surface: " + hits.join(", "));
    }
  }

  // ---- V9 no Tauri command / runtime trigger was added by this phase ----
  //
  // AMENDED by CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A: the pinned set gains ONE read-only command,
  // `installed_host_status`. It stays an EXACT-set pin, so no window-fact command — or any other —
  // can be smuggled in, and this phase still registers no runtime trigger.
  //
  // AMENDED AGAIN by PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A, for the same reason and on the same
  // terms as the identical pin in val-cd-b4-control-centre-window-observation-bridge1a: the set
  // gains ONE command, `daemon_governed_command`, which forwards a single validated line to the
  // sidecar's stdin so the owner surface can drive the canonical ProjectOS runtime. The control
  // MOVES, it does not weaken — it stays an EXACT-set pin (re-proven by mutation: a smuggled extra
  // command is still refused), this phase still adds no runtime trigger and no window fact, and the
  // new command carries no authority: it refuses unless the daemon is RUNNING_READ_ONLY, bounds the
  // payload, rejects embedded newlines, and leaves every governance decision to the runtime.
  //
  // AMENDED A THIRD TIME by PROJECTOS-PRODUCT-COMPLETION1A: the set gains TWO commands,
  // `register_project` and `set_credential`, so the owner can register a project and store a secret
  // without a terminal. Both are stated plainly, including what they DO carry:
  //
  //   * NEITHER REPORTS A WINDOW FACT, which is the property this pin exists to protect. Neither
  //     enumerates windows, reads a native handle, or observes a title, size or position -- so the
  //     assertion above (no `#[tauri::command]` in the owner-window bridge) is again UNTOUCHED.
  //   * BUT THEY ARE NOT AUTHORITY-FREE, and saying otherwise would be the kind of claim this
  //     codebase refuses to make. `register_project` launches an elevated helper; the authority is
  //     the OWNER'S OWN UAC CONSENT, which the host cannot forge or suppress, and the renderer may
  //     not name the helper, `runas` or `ShellExecute` at all -- a separate invariant test asserts
  //     that, and is what would notice if a future change tried. `set_credential` carries a secret
  //     from the owner's masked input to the credential router through a CHILD-PROCESS ENVIRONMENT
  //     VARIABLE, deliberately off the governed line protocol, precisely so no secret value can ever
  //     enter a governed record, a log or an evidence pack.
  //   * IT STAYS AN EXACT-SET PIN. Nothing further can be smuggled in beside them, and a window-fact
  //     command remains exactly as refused as it was before this amendment.
  {
    const st = path.join(ROOT, "projectos", "control-center", "src-tauri", "src");
    if (fs.existsSync(st)) {
      const app = read(path.join(st, "app.rs"));
      if (!/generate_handler!\[\s*daemon_request_snapshot,\s*daemon_governed_command,\s*daemon_status,\s*identity_status,\s*crate::host_status::installed_host_status,\s*crate::register_project::register_project,\s*crate::set_credential::set_credential\s*\]/.test(app.replace(/\s+/g, " ")))
        E("V9 the registered Tauri command set changed");
    }
  }

  // ---- compile proofs ----
  const control = compileConsumer("sewf_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1800));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) E("EXPECTED-FACTS LEAK POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-sealed-expected-window-facts1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-sealed-expected-window-facts1a: PASS");
}
