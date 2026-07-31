// Validator: CD-B4-CONTROL-CENTRE-WINDOW-OBSERVATION-BRIDGE1A
//
// Fails closed. Proves the untrusted owner-window observation bridge:
//  - the adapter amendment adds an explicitly UNTRUSTED handle + observation (redacted, no serde, public
//    construction) and a SEALED ControlCentreWindowVerifier with no public/production constructor
//    (new_internal crate-private, synthetic #[cfg(test)]-only, no fixture feature), and the bare binding
//    mint is now module-private (only the verifier mints);
//  - the verifier re-checks label/handle/window/visibility/minimised/process/thread/session/local-console/
//    runtime/ipc/lifecycle/expiry and only then mints the opaque binding;
//  - the observation digest is domain-separated and distinct from the binding digest (evidence, not
//    authority);
//  - the src-tauri producer resolves exactly the single "main" window (webview_windows ambiguity check),
//    marshals capture through run_on_main_thread over a bounded sync_channel with a timeout, invalidates
//    late results by lifecycle epoch, and is never a Tauri command; the run loop advances the epoch on
//    create/close-request/destroy and begins shutdown on exit;
//  - and (rustc negative compiles) a downstream crate cannot construct the verifier, mint a binding, or
//    turn an observation into a binding, though it MAY build an untrusted observation.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const ADAPTER = path.join(HOST, "windows-owner-verification");
const ADAPTER_PATH = ADAPTER.replace(/\\/g, "/");
const ST = path.join(ROOT, "projectos", "control-center", "src-tauri");

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function stripTests(src) {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
}

// Remove Rust comments (line, doc, nested block) WITHOUT touching real code. String, raw-string, byte-
// string and char literals are preserved verbatim so a `//` or `/*` inside a literal never truncates code.
// Used so prose ("no serde") cannot satisfy or trip a source invariant — the invariant is checked against
// executable source only, never weakened.
function stripRustComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    // raw string: r"..." / r#"..."# / br#"..."#
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

// Return the literal capacity argument of every `sync_channel` call site, skipping any turbofish.
// A site whose capacity is not a bare integer literal yields the raw text, so it fails the ==1 check.
function syncChannelCapacities(src) {
  const caps = [];
  let idx = src.indexOf("sync_channel");
  while (idx !== -1) {
    let i = idx + "sync_channel".length;
    if (src.startsWith("::<", i)) {
      i += 3;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "<") depth++;
        else if (src[i] === ">") depth--;
        i++;
      }
    }
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === "(") {
      let depth = 1;
      const start = ++i;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        if (depth > 0) i++;
      }
      caps.push(src.slice(start, i).trim());
    }
    idx = src.indexOf("sync_channel", idx + 1);
  }
  return caps;
}
function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-control-centre-window-observation-bridge1a");
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
      `projectos-host-windows-owner-verification = { path = "${ADAPTER_PATH}" }`,
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
use projectos_host_windows_owner_verification as owner;
fn names(_h: &owner::UntrustedOwnerWindowHandle, _o: &owner::UntrustedControlCentreWindowObservation, _v: &owner::ControlCentreWindowVerifier, _e: &owner::ExpectedWindowFacts){}
fn main(){
    let h = owner::UntrustedOwnerWindowHandle::from_raw(7);
    let obs = owner::UntrustedControlCentreWindowObservation::new(owner::OwnerWindowObservationInput{
        label: owner::DESIGNATED_WINDOW_LABEL.to_string(), handle: h,
        is_window:true, is_visible:true, is_minimized:false, is_focused:false, eligible:true,
        process_id:1, thread_id:1, session:1, client_protocol_type:0, active_console_session:1,
        runtime_instance_digest:[0u8;32], ipc_session_digest:[0u8;32], project_digest:[0u8;32],
        repository_digest:[0u8;32], environment_digest:[0u8;32], phase_digest:[0u8;32],
        lifecycle_epoch:1, capture_generation:1, observed_at:1,
    });
    let _d = obs.observation_digest();
    let _ = names;
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_verifier_new_internal",
    why: "ControlCentreWindowVerifier::new_internal is callable downstream",
    body: `fn main(){ let _ = projectos_host_windows_owner_verification::ControlCentreWindowVerifier::new_internal(); }`,
  },
  {
    name: "neg_verifier_synthetic",
    why: "ControlCentreWindowVerifier::synthetic (test-only) is reachable downstream",
    body: `fn main(){ let _ = projectos_host_windows_owner_verification::ControlCentreWindowVerifier::synthetic(); }`,
  },
  {
    name: "neg_verifier_struct_literal",
    why: "ControlCentreWindowVerifier is constructible via a struct literal",
    body: `use projectos_host_windows_owner_verification as owner;\nfn f() -> owner::ControlCentreWindowVerifier { owner::ControlCentreWindowVerifier{} }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_binding_from_observed",
    why: "the bare binding mint from_observed is reachable downstream",
    body: `use projectos_host_windows_owner_verification as owner;\nfn main(){ let _ = owner::TrustedControlCentreWindowBinding::from_observed; }`,
  },
  {
    name: "neg_binding_struct_literal",
    why: "TrustedControlCentreWindowBinding is constructible via a struct literal",
    body: `use projectos_host_windows_owner_verification as owner;\nfn f() -> owner::TrustedControlCentreWindowBinding { owner::TrustedControlCentreWindowBinding{} }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_observation_into_binding",
    why: "an untrusted observation converts into a trusted binding",
    body: `use projectos_host_windows_owner_verification as owner;\nfn f(o: owner::UntrustedControlCentreWindowObservation) -> owner::TrustedControlCentreWindowBinding { o.into() }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_observation_into_evidence",
    why: "an untrusted observation converts into owner evidence",
    body: `use projectos_host_windows_owner_verification as owner;\nfn f(o: owner::UntrustedControlCentreWindowObservation) -> owner::VerifiedWindowsOwnerEvidence { o.into() }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_handle_serialize",
    why: "the untrusted handle is serialisable",
    body: `use projectos_host_windows_owner_verification as owner;\nfn req<T: serde::Serialize>(){}\nfn main(){ req::<owner::UntrustedOwnerWindowHandle>(); }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const win = read(path.join(ADAPTER, "src", "window.rs"));
  const winNoTests = stripTests(win);
  const adapterToml = read(path.join(ADAPTER, "Cargo.toml"));
  const stToml = read(path.join(ST, "Cargo.toml"));
  const life = read(path.join(ST, "src", "owner_window", "lifecycle.rs"));
  const obs = read(path.join(ST, "src", "owner_window", "observation.rs"));
  const modrs = read(path.join(ST, "src", "owner_window", "mod.rs"));
  const app = read(path.join(ST, "src", "app.rs"));
  const librs = read(path.join(ST, "src", "lib.rs"));
  const winCode = stripRustComments(win);
  const obsCode = stripRustComments(obs);

  // ---- boundary presence ----
  for (const p of [
    path.join(ST, "src", "owner_window", "mod.rs"),
    path.join(ST, "src", "owner_window", "observation.rs"),
    path.join(ST, "src", "owner_window", "lifecycle.rs"),
    path.join(ST, "tests", "owner_window_observation.rs"),
    path.join(ST, "Cargo.lock"),
  ])
    if (!fs.existsSync(p)) E("V1 missing mandatory path: " + p);
  if (errors.length) return errors;

  // ---- V2 src-tauri depends on the pinned local adapter path ----
  if (!/projectos-host-windows-owner-verification\s*=\s*\{\s*path\s*=\s*"\.\.\/\.\.\/host\/windows-owner-verification"/.test(stToml))
    E("V2 src-tauri does not depend on the adapter via the pinned local path");

  // ---- V3 no new provider/async dependency in src-tauri ----
  for (const bad of ["tokio", "async-std", "windows-sys", "getrandom", "rand ", "zeroize"])
    if (new RegExp("(^|\\n)\\s*" + bad.trim() + "\\s*=", "m").test(stToml)) E("V3 forbidden dependency added to src-tauri: " + bad);
  if (/windows\s*=\s*\{\s*version\s*=\s*"(?!0\.61\.3)/.test(stToml)) E("V3 src-tauri windows version drift");

  // ---- V4 the renderer cannot see or name any host-only window-authority surface ----
  {
    const rendererRoot = path.join(ROOT, "projectos", "control-center", "src");
    const HOST_ONLY = [
      "UntrustedControlCentreWindowObservation",
      "UntrustedOwnerWindowHandle",
      "TrustedControlCentreWindowBinding",
      "ControlCentreWindowVerifier",
      "observation_digest",
      "binding_digest",
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
      if (hits.length) E("V4 renderer source names a host-only window-authority surface: " + hits.join(", "));
    }
  }

  // ---- V5 no window-fact Tauri command ----
  if (/#\[tauri::command\]/.test(obs + life + modrs)) E("V5 a Tauri command is registered in the owner-window bridge");
  if (!/generate_handler!\[\s*daemon_request_snapshot,\s*daemon_status,\s*identity_status\s*\]/.test(app.replace(/\s+/g, " ")))
    E("V5 the registered command set changed (window-fact command may have been added)");

  // ---- V6 designated label is "main" ----
  if (!/pub const DESIGNATED_WINDOW_LABEL: &str = "main";/.test(win)) E('V6 designated label is not "main"');
  if (!/DESIGNATED_WINDOW_LABEL/.test(obs) || !/DESIGNATED_WINDOW_LABEL/.test(app))
    E("V6 producer/run-loop do not use the designated label constant");

  // ---- V7 title is not used as an authority gate ----
  if (/ProjectOS · Control Center/.test(obs + life)) E("V7 owner-window bridge references the window title (must not gate on it)");

  // ---- V8 webview_windows ambiguity check ----
  if (!/webview_windows\(\)/.test(obs)) E("V8 producer does not enumerate webview_windows()");
  if (!/pub fn resolve_designated_label/.test(obs) || !/SecondOwnerWindow/.test(obs))
    E("V8 no single-owner-window ambiguity rule");

  // ---- V9 run_on_main_thread ----
  if (!/run_on_main_thread\(/.test(obs)) E("V9 native-handle capture does not use run_on_main_thread");

  // ---- V10 bounded channel + timeout (capacity parsed, not pattern-guessed) ----
  {
    // Unbounded mpsc::channel() is never acceptable for the capture hand-back.
    if (/(^|[^A-Za-z0-9_])(mpsc::)?channel\s*\(\s*\)/m.test(obsCode)) E("V10 capture uses an unbounded channel()");
    const caps = syncChannelCapacities(obsCode);
    if (caps.length === 0) E("V10 capture does not use a bounded sync_channel");
    for (const cap of caps) if (cap !== "1") E("V10 sync_channel capacity is not exactly 1 (found: " + cap + ")");
    if (!/recv_timeout\(/.test(obsCode) || !/const CAPTURE_TIMEOUT: Duration/.test(obsCode))
      E("V10 capture has no bounded timeout");
  }

  // ---- V11 late-result invalidation ----
  if (!/current_epoch\(\) != epoch_before/.test(obs) || !/LifecycleChanged/.test(obs))
    E("V11 late result is not invalidated by a lifecycle epoch recheck");

  // ---- V12/V13/V14 lifecycle transitions in the run loop + epoch advance ----
  if (!/WindowEvent::CloseRequested\s*\{[^}]*\}\s*=>\s*owner_lifecycle\.on_close_requested\(\)/.test(app))
    E("V12 run loop does not invalidate on CloseRequested");
  if (!/WindowEvent::Destroyed\s*=>\s*owner_lifecycle\.on_destroyed\(\)/.test(app))
    E("V13 run loop does not handle Destroyed");
  if (!/fn on_destroyed\(&self\)\s*\{[\s\S]*?self\.epoch\.fetch_add\(1/.test(life)) E("V13 destroy does not advance the epoch");
  if (!/fn on_window_created\(&self\)\s*\{[\s\S]*?self\.epoch\.fetch_add\(1/.test(life)) E("V14 (re)creation does not advance the epoch");
  if (!/RunEvent::Ready\s*=>\s*owner_lifecycle\.on_window_created\(\)/.test(app)) E("V14 run loop does not create the window epoch on Ready");

  // ---- V15/V16 runtime + IPC digest mismatch enforced by the verifier ----
  if (!/RuntimeInstanceMismatch/.test(win)) E("V15 verifier does not enforce the runtime-instance digest");
  if (!/IpcSessionMismatch/.test(win)) E("V16 verifier does not enforce the IPC-session digest");

  // ---- V17 explicitly Untrusted names ----
  for (const t of ["UntrustedOwnerWindowHandle", "UntrustedControlCentreWindowObservation"])
    if (!win.includes("pub struct " + t)) E("V17 missing untrusted type: " + t);

  // ---- V18 raw handle redacted Debug ----
  if (!/UntrustedOwnerWindowHandle\(\[REDACTED\]\)/.test(win)) E("V18 untrusted handle Debug is not redacted");
  if (!/UntrustedControlCentreWindowObservation\(label=\{:\?\}, gen=\{\}, \[REDACTED\]\)/.test(win))
    E("V18 untrusted observation Debug is not redacted");

  // ---- V19 no serde on the observation surface (executable source only; prose cannot satisfy or trip it) ----
  if (/\bserde\b|\bSerialize\b|\bDeserialize\b/.test(winCode)) E("V19 window.rs references serde in executable source");
  if (/\bserde\b/.test(stripRustComments(obs) + stripRustComments(modrs) + stripRustComments(life)))
    E("V19 the owner-window bridge references serde in executable source");

  // ---- V20 verifier has no public constructor; V21 synthetic is cfg(test)-only ----
  if (!/pub\(crate\) fn new_internal\(\) -> Self/.test(winNoTests)) E("V20 verifier new_internal is not crate-private");
  if (/\bpub fn new_internal\b/.test(winNoTests)) E("V20 verifier has a public constructor");
  {
    const m = win.indexOf("pub(crate) fn synthetic()");
    const head = m === -1 ? "" : win.slice(Math.max(0, m - 80), m);
    if (m === -1) E("V21 verifier has no synthetic constructor");
    else if (!/#\[cfg\(test\)\]/.test(head)) E("V21 verifier synthetic is not #[cfg(test)] gated");
  }
  // ---- V22 no test-fixtures feature in the adapter ----
  // BOUNDED POST-FREEZE AMENDMENT (CD-B4-PRODUCTION-OWNER-PRESENCE-CAPABILITY-BRIDGE1A, Option B): the
  // blanket "no fixture feature at all" is stale. `test-fixtures` remains forbidden (unchanged below);
  // the single narrowly named `fixture-owner-evidence` test-evidence feature is permitted, and is bounded
  // by V9b/V9c/V9d in val-cd-b4-windows-user-verification-adapter1a. This crate's own concern — that the
  // OBSERVATION BRIDGE never gains fixture access — is asserted directly below.
  if (/test-fixtures/.test(adapterToml.replace(/#.*/g, "")))
    E("V22 adapter defines a test-fixtures feature (downstream-enableable)");
  for (const t of ["fixture-owner-evidence", "fixture_owner_evidence", "is_fixture"])
    if ((stripRustComments(obs) + stripRustComments(life) + stripRustComments(modrs)).includes(t))
      E("V22 the src-tauri observation bridge reaches the adapter fixture-evidence surface: " + t);
  if (/fixture-owner-evidence/.test(stToml))
    E("V22 src-tauri enables the adapter fixture-evidence feature");

  // ---- V23 trusted binding bare mint is MODULE-PRIVATE and the sealed verifier is its sole caller ----
  // Post-freeze Option 2 amendment. The mint carries no `pub` and no `pub(crate)`, so Rust privacy confines
  // it to window.rs and the sealed ControlCentreWindowVerifier becomes the ONLY thing that can reach it.
  // This SUPERSEDES the original frozen expectation of `pub(crate)` (val-cd-b4-windows-user-verification-
  // adapter1a V7, amended in the same step) — that expectation is stale, not weakened.
  // Module privacy is INTRA-crate, so a cross-crate rustc negative compile cannot prove it (neg_binding_
  // from_observed below proves only downstream unreachability, which `pub(crate)` also gave). The
  // module-private property is therefore proved statically here, against comment-stripped executable
  // source, together with the sole-caller, no-second-mint and no-fixture-leak checks.
  {
    const winCodeNoTests = stripRustComments(winNoTests);
    if (!/(^|\n)\s*fn from_observed\(observation: WindowObservation, binding_digest: \[u8; 32\]\) -> Self/.test(winCodeNoTests))
      E("V23 from_observed is not module-private");
    if (/\bpub\s+fn\s+from_observed\b/.test(winCodeNoTests)) E("V23 from_observed is fully public");
    if (/\bpub\(crate\)\s+fn\s+from_observed\b/.test(winCodeNoTests))
      E("V23 from_observed is pub(crate) (must be module-private)");

    // Sole caller: every call site is in window.rs, at or after `impl ControlCentreWindowVerifier`.
    const implIdx = winCodeNoTests.indexOf("impl ControlCentreWindowVerifier {");
    if (implIdx === -1) E("V23 cannot locate impl ControlCentreWindowVerifier");
    let sites = 0;
    for (let k = winCodeNoTests.indexOf("from_observed("); k !== -1; k = winCodeNoTests.indexOf("from_observed(", k + 1)) {
      if (/^\s*fn\s+$/.test(winCodeNoTests.slice(Math.max(0, k - 6), k))) continue; // the declaration itself
      sites++;
      if (implIdx === -1 || k < implIdx) E("V23 a from_observed call site is outside impl ControlCentreWindowVerifier");
    }
    if (sites === 0) E("V23 no from_observed call site found (mint renamed or bypassed)");

    // Executable, non-test source of an adapter module: what the DEFAULT graph can actually reach.
    const modCode = (f) => stripRustComments(stripTests(read(path.join(ADAPTER, "src", f))));

    // No other adapter module may name the mint, and none may construct the sealed verifier.
    for (const f of fs.readdirSync(path.join(ADAPTER, "src"))) {
      if (!f.endsWith(".rs") || f === "window.rs") continue;
      const body = modCode(f);
      if (/\bfrom_observed\b/.test(body)) E("V23 adapter module " + f + " reaches the binding mint directly");
      if (/ControlCentreWindowVerifier\s*::\s*(new_internal|synthetic)\s*\(/.test(body))
        E("V23 adapter module " + f + " constructs the sealed verifier");
    }

    // The gated FFI receives an EXISTING verifier and mints only through it.
    const ffiCode = stripRustComments(read(path.join(ADAPTER, "src", "verification_ffi.rs")));
    if (!/fn live_verify\(\s*verifier: &ControlCentreWindowVerifier,/.test(ffiCode))
      E("V23 the gated FFI does not receive an existing sealed verifier");
    if (!/\bverifier\.mint_from_window_observation\(/.test(ffiCode))
      E("V23 the gated FFI does not route its mint through the supplied verifier");

    // The src-tauri bridge is UNTRUSTED observation only: its executable source may not name the trusted
    // binding, the sealed verifier or either mint. Comments are stripped first, so the prose in
    // observation.rs that explains it mints nothing cannot itself trip (or satisfy) the check.
    for (const t of [
      "TrustedControlCentreWindowBinding",
      "ControlCentreWindowVerifier",
      "from_observed",
      "mint_from_window_observation",
      "binding_digest",
    ])
      if ((stripRustComments(obs) + stripRustComments(life) + stripRustComments(modrs)).includes(t))
        E("V23 the src-tauri bridge names a trusted window-authority surface: " + t);

    // No second mint route: across the adapter's DEFAULT (non-test) graph, the only fns yielding a trusted
    // binding are the module-private mint and the two sealed-verifier methods. `synthetic` is allowed only
    // because it is #[cfg(test)]-gated inside the impl (asserted separately below), not stripped by
    // stripTests, which cuts the trailing `mod tests` block.
    // `fixture_verify_binding` is permitted ONLY as a feature-gated delegate: it never touches the
    // module-private mint itself, it constructs the sealed verifier in this module (where V23 requires
    // construction to live) and returns whatever `verify()` mints. The gate is asserted below, so it
    // cannot quietly become an ungated second mint.
    const ALLOWED = [
      "from_observed",
      "synthetic",
      "verify",
      "mint_from_window_observation",
      "fixture_verify_binding",
    ];
    if (winCodeNoTests.includes("fn fixture_verify_binding")) {
      if (!/#\[cfg\(feature = "fixture-owner-evidence"\)\]\s*\n\s*pub\(crate\) fn fixture_verify_binding/.test(winNoTests))
        E("V23 fixture_verify_binding is not gated on the fixture-evidence feature");
      const body = winCodeNoTests.slice(winCodeNoTests.indexOf("fn fixture_verify_binding"));
      if (/from_observed/.test(body.slice(0, body.indexOf("\n}"))))
        E("V23 fixture_verify_binding reaches the module-private mint directly");
    }
    for (const f of fs.readdirSync(path.join(ADAPTER, "src"))) {
      if (!f.endsWith(".rs")) continue;
      const body = modCode(f);
      // Params may not contain braces, so the scan cannot run past a fn body into a later signature.
      const re = /fn\s+([a-z0-9_]+)\s*(?:<[^>{}]*>)?\s*\([^{}]*?\)\s*->\s*(?:Result<\s*)?TrustedControlCentreWindowBinding/g;
      for (let m; (m = re.exec(body)); )
        if (!ALLOWED.includes(m[1])) E("V23 second binding mint route in " + f + ": fn " + m[1]);
    }
    // Inside the binding impl, only the two known constructors may build the struct.
    const bIdx = winCodeNoTests.indexOf("impl TrustedControlCentreWindowBinding {");
    const bBlock = bIdx === -1 ? "" : winCodeNoTests.slice(bIdx, winCodeNoTests.indexOf("\n}", bIdx));
    // Struct literals start a line; `-> Self {` return types are mid-line and must not be counted.
    if (bIdx === -1) E("V23 cannot locate impl TrustedControlCentreWindowBinding");
    else if ((bBlock.match(/\n\s*Self\s*\{/g) || []).length !== 2)
      E("V23 impl TrustedControlCentreWindowBinding has an unexpected number of struct constructions");

    // No fixture-only mint leaks into the default graph: synthetic stays #[cfg(test)]-gated.
    if (!/#\[cfg\(test\)\]\s*\n\s*pub\(crate\) fn synthetic\(observation: WindowObservation/.test(winNoTests))
      E("V23 the synthetic binding constructor is not #[cfg(test)] gated");
  }

  // ---- V24 observation digest is domain-separated and distinct from the binding digest ----
  if (!/OBSERVATION_DOMAIN_TAG: &\[u8\] = b"PROJECTOS:CONTROL-CENTRE-WINDOW-OBSERVATION:V1";/.test(win))
    E("V24 observation domain tag missing/incorrect");
  if (!/BINDING_DOMAIN_TAG: &\[u8\] = b"PROJECTOS:CONTROL-CENTRE-WINDOW-BINDING:V1";/.test(win))
    E("V24 binding domain tag missing/incorrect");

  // ---- V25 no UserConsentVerifier ceremony in the bridge ----
  if (/UserConsentVerifier|RequestVerification/.test(obs + life + modrs + app)) E("V25 bridge references a Windows verification ceremony");

  // ---- V26/V27/V28 no capability / grant / production authority in the bridge ----
  if (/\.issue\(|ProductionOwnerPresenceCapability/.test(obs + life + modrs)) E("V26 bridge references a production capability");
  if (/ProductionOwnerPresenceBindingGrant/.test(obs + life + modrs)) E("V27 bridge references a production grant");
  // V28: the untrusted bridge must not touch any core execution-authority mint surface.
  for (const t of ["ValidatedOwnerPresenceFact", "VerifiedExecutionContext", "verify_production_owner_presence", "BoundedEffectGrant"])
    if ((obs + life + modrs).includes(t)) E("V28 bridge references a core execution-authority surface: " + t);
  if (/EXECUTION_READY\s*=\s*true/i.test(obs + life + modrs + app + librs)) E("V30 EXECUTION_READY set true");

  // ---- V29 only src-tauri Cargo.lock changes (adapter deps unchanged: sha2 + windows + windows-future) ----
  for (const dep of ["sha2", "windows", "windows-future"])
    if (!adapterToml.includes(dep)) E("V29 adapter dependency unexpectedly missing: " + dep);
  if (/tokio|serde|reqwest/.test(adapterToml)) E("V29 adapter manifest gained an unexpected dependency");

  // ---- V31 the binding digest is re-derived by the verifier; the observation digest is never authority ----
  if (!/let binding_digest = compute_binding_digest\(obs, expected\);/.test(winCode))
    E("V31 the verify path does not re-derive the binding digest via compute_binding_digest");
  if (/from_observed\(\s*[^)]*observation_digest/.test(winCode))
    E("V31 an observation digest is passed into a binding mint (evidence used as authority)");
  {
    // compute_binding_digest must feed the BINDING tag, and the observation digest fn the OBSERVATION tag.
    const bindFn = winCode.slice(winCode.indexOf("fn compute_binding_digest"));
    if (!/feed_var\(&mut h, BINDING_DOMAIN_TAG\);/.test(bindFn.slice(0, 1200)))
      E("V31 compute_binding_digest does not feed BINDING_DOMAIN_TAG");
    if (/OBSERVATION_DOMAIN_TAG/.test(bindFn.slice(0, 1200)))
      E("V31 compute_binding_digest feeds the observation domain tag");
  }

  // ---- compile proofs ----
  const control = compileConsumer("wob_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1800));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) E("WINDOW-BRIDGE FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-control-centre-window-observation-bridge1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-control-centre-window-observation-bridge1a: PASS");
}
