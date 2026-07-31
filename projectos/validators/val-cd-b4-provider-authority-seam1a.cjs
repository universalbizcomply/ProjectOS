// Validator: CD-B4-PRODUCTION-CAPABILITY-ACQUISITION-SEAM1A
//
// Fails closed. Proves the cold-start provider-authority seam:
//  - host-authority gains a ConfirmedAuthorityGuard that OWNS an AuthorityGuard, is minted only by a
//    corroboration-derived confirm() accepting ONLY the two authoritative peer states (a client
//    connection is refused), and is non-Clone/Copy/serde with a redacted Debug;
//  - core::provider_authority::open_provider_authority CONSUMES that guard by value, is the sole lease
//    issuer, and assigns attempt id / provider / epoch itself (no caller-supplied authority facts);
//  - ProviderAuthorityLease retains the guard and is consumed BY VALUE into a ProviderCapabilitySet that
//    retains it, exposing the three providers by BORROW ONLY (no extraction, so no capability can
//    outlive the authority);
//  - exactly three providers are issued and no partial issuer exists;
//  - the internal provider constructors stay pub(crate) and the fixture routes stay gated;
//  - core depends on host-authority ONE WAY and host-authority stays dependency-free;
//  - and (rustc negative compiles) a downstream crate cannot construct a guard, open a lease from a bare
//    guard/bool, clone or serialise any seam type, reuse a consumed lease, or extract a capability.
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
const CORE_PATH = CORE.replace(/\\/g, "/");
const AUTH_PATH = AUTH.replace(/\\/g, "/");

const read = (p) => fs.readFileSync(p, "utf8");
const stripTests = (src) => {
  const i = src.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? src : src.slice(0, i);
};

// Remove Rust comments (line, doc, nested block) without touching real code; string, raw-string,
// byte-string and char literals are preserved verbatim. Used so PROSE can neither satisfy nor trip a
// source invariant — every "token must be absent" check runs on executable source only.
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
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-provider-authority-seam1a");
  return __SCRATCH_DIR;
}

// A downstream consumer crate. It depends on core with NO fixture feature, i.e. exactly the default
// graph a shipping dependent would see.
function compileConsumer(name, body, extraDeps) {
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
      ...(extraDeps || []),
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

// The seam's public names ARE reachable downstream (they must be, for a real host to use them) — what a
// dependent cannot do is obtain the authority that drives them. This control proves the surface exists.
const CONTROL = `
use projectos_host_core as core_;
fn names(_l: &core_::ProviderAuthorityLease, _s: &core_::ProviderCapabilitySet, _e: core_::ProviderAuthorityError) {}
fn main(){
    let _ = core_::MAX_LEASE_WINDOW;
    let _ = names;
    // A dependent may NAME the confirmation type but cannot construct one.
    fn _n(_g: &projectos_host_authority::model::ConfirmedAuthorityGuard) {}
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_guard_struct_literal",
    why: "ConfirmedAuthorityGuard is constructible via a struct literal",
    body: `use projectos_host_authority::model as m;\nfn f() -> m::ConfirmedAuthorityGuard { m::ConfirmedAuthorityGuard{} }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_guard_for_local_proof",
    why: "the fixture confirmation route is reachable in the default graph",
    body: `use projectos_host_authority::model as m;\nfn main(){ let _ = m::ConfirmedAuthorityGuard::for_local_proof(m::AuthorityPeerState::ServiceRuntimeConfirmed); }`,
  },
  {
    name: "neg_open_from_bare_guard",
    why: "a bare AuthorityGuard can open provider authority",
    body: `use projectos_host_core as c;\nfn f(g: projectos_host_authority::model::AuthorityGuard, t: &c::VerifiedAuthorityTime) { let _ = c::open_provider_authority(g, t, 10); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_open_from_bool",
    why: "a bool can open provider authority",
    body: `use projectos_host_core as c;\nfn f(t: &c::VerifiedAuthorityTime) { let _ = c::open_provider_authority(true, t, 10); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_open_from_peer_state",
    why: "a caller-constructed peer state can open provider authority",
    body: `use projectos_host_core as c;\nuse projectos_host_authority::model as m;\nfn f(t: &c::VerifiedAuthorityTime) { let _ = c::open_provider_authority(m::AuthorityPeerState::ServiceRuntimeConfirmed, t, 10); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_lease_clone",
    why: "the provider-authority lease is Clone",
    body: `use projectos_host_core as c;\nfn req<T: Clone>(){}\nfn main(){ req::<c::ProviderAuthorityLease>(); }`,
  },
  {
    name: "neg_set_clone",
    why: "the provider capability set is Clone",
    body: `use projectos_host_core as c;\nfn req<T: Clone>(){}\nfn main(){ req::<c::ProviderCapabilitySet>(); }`,
  },
  {
    name: "neg_guard_clone",
    why: "the confirmed authority guard is Clone",
    body: `use projectos_host_authority::model as m;\nfn req<T: Clone>(){}\nfn main(){ req::<m::ConfirmedAuthorityGuard>(); }`,
  },
  {
    name: "neg_lease_serialize",
    why: "the provider-authority lease is serialisable",
    // serde must be a REAL dependency here. Without it the control fails with "cannot find crate
    // serde" and would prove nothing about serialisability — a false-confidence control.
    deps: ['serde = { version = "1", features = ["derive"] }'],
    body: `use projectos_host_core as c;\nfn req<T: serde::Serialize>(){}\nfn main(){ req::<c::ProviderAuthorityLease>(); }`,
  },
  {
    // Harness check for the control above: a genuinely serialisable type MUST compile here. If this
    // fails, the serde negative is passing for the wrong reason and proves nothing.
    name: "neg_serde_harness",
    why: "the serde control harness is broken",
    deps: ['serde = { version = "1", features = ["derive"] }'],
    expectCompiles: true,
    body: `fn req<T: serde::Serialize>(){}\nfn main(){ req::<u64>(); println!("SERDE_HARNESS_OK"); }`,
  },
  {
    name: "neg_lease_reuse",
    why: "a consumed lease can be consumed again (replay)",
    body: `use projectos_host_core as c;\nfn f(l: c::ProviderAuthorityLease, t: &c::VerifiedAuthorityTime) { let _ = l.into_provider_capabilities(t); let _ = l.into_provider_capabilities(t); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_capability_extraction",
    why: "a capability can be moved out of the set, outliving the retained authority",
    body: `use projectos_host_core as c;\nfn f(s: c::ProviderCapabilitySet) -> c::runtime_instance::ProductionRuntimeInstanceVerifier { s.runtime }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_capability_into",
    why: "an into_*/take_* extractor exists on the set",
    body: `use projectos_host_core as c;\nfn f(s: c::ProviderCapabilitySet) { let _ = s.into_runtime(); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_provider_new_internal",
    why: "a production provider constructor is public",
    body: `fn main(){ let _ = projectos_host_core::runtime_instance::ProductionRuntimeInstanceVerifier::new_internal(); }`,
  },
  {
    name: "neg_owner_capability_new_internal",
    why: "the production owner-presence capability constructor is public",
    body: `fn main(){ let _ = projectos_host_core::owner_presence::ProductionOwnerPresenceCapability::new_internal(); }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const seamPath = path.join(CORE, "src", "provider_authority.rs");
  const modelPath = path.join(AUTH, "src", "model.rs");
  for (const p of [seamPath, modelPath, path.join(CORE, "Cargo.toml"), path.join(AUTH, "Cargo.toml")])
    if (!fs.existsSync(p)) E("V1 missing mandatory path: " + p);
  if (errors.length) return errors;

  const seam = read(seamPath);
  const seamCode = stripRustComments(stripTests(seam));
  const model = read(modelPath);
  const modelCode = stripRustComments(stripTests(model));
  const coreToml = read(path.join(CORE, "Cargo.toml"));
  const authToml = read(path.join(AUTH, "Cargo.toml"));

  // ---- V2 dependency direction is ONE WAY ----
  if (!/projectos-host-authority\s*=\s*\{\s*path\s*=\s*"\.\.\/host-authority"/.test(coreToml))
    E("V2 core does not depend on host-authority via the pinned local path");
  if (/projectos-host-core|projectos-core/.test(authToml))
    E("V2 host-authority depends on core (dependency inversion / cycle)");
  {
    // host-authority must remain dependency-free in its DEFAULT graph.
    const deps = /\n\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(authToml);
    if (deps && /^\s*[a-z0-9_-]+\s*=/m.test(deps[1]))
      E("V2 host-authority gained an unconditional dependency");
  }
  // core must stay windows-free: no windows crate may be pulled in by the new edge.
  if (/^\s*windows\s*=/m.test(coreToml)) E("V2 core gained a windows dependency");
  if (!/unsafe_code\s*=\s*"forbid"/.test(coreToml)) E("V2 core no longer forbids unsafe");

  // ---- V3 ConfirmedAuthorityGuard OWNS the guard and is opaque ----
  if (!/pub struct ConfirmedAuthorityGuard\s*\{/.test(modelCode))
    E("V3 ConfirmedAuthorityGuard is missing");
  {
    const m = /pub struct ConfirmedAuthorityGuard\s*\{([\s\S]*?)\n\}/.exec(modelCode);
    const body = m ? m[1] : "";
    if (!/_guard:\s*AuthorityGuard/.test(body)) E("V3 ConfirmedAuthorityGuard does not own an AuthorityGuard");
    if (/\bpub\s+\w+\s*:/.test(body)) E("V3 ConfirmedAuthorityGuard has a public field");
  }
  if (/#\[derive\([^)]*\b(Clone|Copy|Serialize|Deserialize)\b[^)]*\)\]\s*pub struct ConfirmedAuthorityGuard/.test(modelCode))
    E("V3 ConfirmedAuthorityGuard derives Clone/Copy/serde");
  if (!/ConfirmedAuthorityGuard\(\[REDACTED\]\)/.test(model)) E("V3 ConfirmedAuthorityGuard Debug is not redacted");
  // No accessor may hand the owned guard back out.
  if (/fn\s+\w+\s*\([^)]*\)\s*->\s*(&\s*)?AuthorityGuard\b/.test(modelCode.slice(modelCode.indexOf("impl ConfirmedAuthorityGuard"))))
    E("V3 ConfirmedAuthorityGuard exposes the owned AuthorityGuard");

  // ---- V4 confirm() consumes the guard, derives the state, and refuses non-authoritative states ----
  if (!/pub fn confirm\(\s*guard: AuthorityGuard,/.test(modelCode))
    E("V4 confirm does not take AuthorityGuard by value");
  if (!/AuthorityPeerState::corroborate\(outcome, confirmed\)/.test(modelCode))
    E("V4 confirm does not derive the peer state via the frozen corroborate rule");
  if (/permits_startup\(\)/.test(modelCode.slice(modelCode.indexOf("impl ConfirmedAuthorityGuard"))))
    E("V4 confirm gates on permits_startup (would admit ClientConnectionConfirmed)");
  {
    const impl = modelCode.slice(modelCode.indexOf("impl ConfirmedAuthorityGuard"));
    // A client CONNECTS to an authority and is never one. `ClientConnectionConfirmed` must not appear
    // anywhere in this impl — not in an accept arm, not in a widened match. Asserting absence outright
    // is stronger than pattern-matching an accept arm, which a reordered or multi-arm match can evade.
    if (/ClientConnectionConfirmed/.test(impl))
      E("V4 a client-connection state is named in the confirmation impl (it can never be authority)");
    // Scope the two-state assertion to EACH constructor body separately: a matching pair elsewhere in
    // the impl must not be able to satisfy the check on another function's behalf.
    for (const fnName of ["confirm", "for_local_proof"]) {
      const at = impl.indexOf("fn " + fnName + "(");
      if (at === -1) {
        E("V4 cannot locate " + fnName);
        continue;
      }
      // Body of this fn only: up to the next `    pub fn ` / `    fn ` at impl-item indentation.
      const rest = impl.slice(at);
      const nextFn = rest.slice(1).search(/\n    (?:pub )?fn /);
      const body = nextFn === -1 ? rest : rest.slice(0, nextFn + 1);
      if (!/AuthorityPeerState::InteractiveFallbackConfirmed\s*\|\s*AuthorityPeerState::ServiceRuntimeConfirmed/.test(body))
        E("V4 " + fnName + " does not restrict to exactly the two authoritative states");
    }
  }
  // ---- V5 fixture confirmation is gated and absent from the default graph ----
  if (!/#\[cfg\(all\(\s*any\(test, feature = "effect-witness-fixtures"\)/.test(modelCode))
    E("V5 for_local_proof is not gated on the pure contract-fixture feature");

  // ---- V6 the lease: sole issuer, by-value consumption, retained guard ----
  if (!/pub fn open_provider_authority\(\s*guard: ConfirmedAuthorityGuard,/.test(seamCode))
    E("V6 open_provider_authority does not consume a ConfirmedAuthorityGuard by value");
  {
    const lease = /pub struct ProviderAuthorityLease\s*\{([\s\S]*?)\n\}/.exec(seamCode);
    const body = lease ? lease[1] : "";
    if (!/guard:\s*ConfirmedAuthorityGuard/.test(body)) E("V6 the lease does not retain the confirmed authority");
    if (/\bpub\s+\w+\s*:/.test(body)) E("V6 the lease has a public field");
  }
  if (!/pub fn into_provider_capabilities\(\s*self,/.test(seamCode))
    E("V6 into_provider_capabilities does not consume the lease by value");
  // No second issuer of a lease.
  {
    const re = /fn\s+([a-z0-9_]+)\s*\([^{}]*?\)\s*->\s*(?:Result<\s*)?ProviderAuthorityLease/g;
    for (let m; (m = re.exec(seamCode)); )
      if (m[1] !== "open_provider_authority") E("V6 second lease issuer: fn " + m[1]);
  }

  // ---- V7 the set retains authority and exposes capabilities BY BORROW ONLY ----
  {
    const set = /pub struct ProviderCapabilitySet\s*\{([\s\S]*?)\n\}/.exec(seamCode);
    const body = set ? set[1] : "";
    if (!/_guard:\s*ConfirmedAuthorityGuard/.test(body))
      E("V7 the capability set does not retain the confirmed authority");
    if (/\bpub\s+\w+\s*:/.test(body)) E("V7 the capability set has a public field");
    for (const f of ["runtime", "ipc", "owner_presence"])
      if (!new RegExp("\\n\\s*" + f + ":").test(body)) E("V7 the set is missing the " + f + " provider");
  }
  {
    const impl = seamCode.slice(seamCode.indexOf("impl ProviderCapabilitySet"));
    for (const [f, t] of [
      ["runtime", "ProductionRuntimeInstanceVerifier"],
      ["ipc", "ProductionIpcSessionVerifier"],
      ["owner_presence", "ProductionOwnerPresenceCapability"],
    ])
      if (!new RegExp("pub fn " + f + "\\(&self\\) -> &" + t).test(impl))
        E("V7 " + f + " is not exposed as a borrow-only accessor");
    // No extraction route of any shape.
    if (/pub fn\s+(into_|take_)/.test(impl)) E("V7 the set exposes an extraction accessor");
    if (/pub fn\s+\w+\(\s*self\b/.test(impl)) E("V7 the set exposes a by-value consuming accessor");
    if (/impl\s+(Deref|DerefMut)\s+for\s+ProviderCapabilitySet/.test(seamCode))
      E("V7 the set derefs to a capability");
  }

  // ---- V8 exactly three providers; no partial issuer ----
  {
    const conv = seamCode.slice(seamCode.indexOf("fn into_provider_capabilities"));
    for (const t of [
      "ProductionRuntimeInstanceVerifier::new_internal()",
      "ProductionIpcSessionVerifier::new_internal()",
      "ProductionOwnerPresenceCapability::new_internal()",
    ])
      if (!conv.includes(t)) E("V8 conversion does not issue " + t);
    if (/ProductionClockBindingGrant/.test(seamCode))
      E("V8 the seam issues a clock binding grant (out of scope for this phase)");
  }

  // ---- V9 no caller-supplied authority facts ----
  if (/fn open_provider_authority\([^)]*\b(attempt_id|authority_epoch|provider_id|generation)\s*:/.test(seamCode))
    E("V9 open_provider_authority accepts a caller-supplied authority fact");
  if (!/fn next_attempt_id\(\) -> u64/.test(seamCode)) E("V9 the attempt id is not issuer-assigned");
  if (!/AtomicU64/.test(seamCode)) E("V9 the attempt id does not come from a process-unique counter");

  // ---- V10 expiry reuses the verified authority-time contract; authority_time.rs untouched ----
  if (!/now: &VerifiedAuthorityTime/.test(seamCode)) E("V10 the seam does not use VerifiedAuthorityTime");
  for (const e of ["Expired", "EpochMismatch", "ProviderMismatch"])
    if (!new RegExp("ProviderAuthorityError::" + e).test(seamCode)) E("V10 missing refusal: " + e);

  // ---- V11 internal provider constructors stay crate-private ----
  for (const [file, sym] of [
    ["runtime_instance.rs", "ProductionRuntimeInstanceVerifier"],
    ["ipc_session.rs", "ProductionIpcSessionVerifier"],
    ["owner_presence.rs", "ProductionOwnerPresenceCapability"],
  ]) {
    const body = stripRustComments(read(path.join(CORE, "src", file)));
    if (!/pub\(crate\) fn new_internal\(/.test(body)) E("V11 " + sym + "::new_internal is not pub(crate)");
    if (/\bpub fn new_internal\(/.test(body)) E("V11 " + sym + "::new_internal is public");
  }

  // ---- V13 the fixture confirmation route can never be unified into a shipping graph ----
  // `for_local_proof` is gated on host-authority's `effect-witness-fixtures`. Cargo unifies features
  // across a build graph, so if ANY crate enabled that feature as a NORMAL dependency, the fixture
  // confirmation would become reachable for every consumer in that graph. Dev-dependencies do not leak
  // into dependents, so only a non-dev enablement is a leak.
  {
    const walk = (dir) => {
      let hits = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === "target" || ent.name === "dist") continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) hits = hits.concat(walk(p));
        else if (ent.name === "Cargo.toml") hits.push(p);
      }
      return hits;
    };
    for (const manifest of walk(path.join(ROOT, "projectos"))) {
      const body = read(manifest);
      // Split into top-level TOML sections and inspect only those that ship to dependents.
      const sections = body.split(/\n(?=\[)/);
      for (const s of sections) {
        const header = (/^\[([^\]]+)\]/.exec(s) || [])[1] || "";
        if (/^dev-dependencies/.test(header)) continue; // dev-only: never unified into dependents
        if (/^(features|package|lints|profile|workspace|bin|lib|test|bench)/.test(header)) continue;
        if (/effect-witness-fixtures/.test(s.replace(/#[^\n]*/g, "")))
          E(
            "V13 fixture confirmation feature enabled outside dev-dependencies in " +
              path.relative(ROOT, manifest) +
              " [" + header + "] (feature unification would expose for_local_proof)"
          );
      }
    }
  }

  // ---- V12 the seam introduces no serde and no unsafe ----
  if (/\bserde\b|\bSerialize\b|\bDeserialize\b/.test(seamCode)) E("V12 the seam references serde in executable source");
  if (/\bunsafe\b/.test(seamCode)) E("V12 the seam contains unsafe");

  // ---- compile proofs ----
  const control = compileConsumer("pas_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1800));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.deps);
    if (neg.expectCompiles) {
      // A positive harness check: if THIS fails, the sibling serde negative proves nothing.
      if (!r.ok)
        E("serde control harness is broken: " + neg.name + " must compile:\n" + r.out.slice(0, 900));
    } else if (r.ok) {
      E("PROVIDER-AUTHORITY FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
    }
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-provider-authority-seam1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-provider-authority-seam1a: PASS");
}
