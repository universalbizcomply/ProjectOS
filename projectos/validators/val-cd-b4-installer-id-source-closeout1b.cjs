// Validator: CD-B4-INSTALLER-CANONICAL-IDENTITY-RECORD-WRITER1A-CLOSEOUT1B
//
// Fails closed. Proves the relocated system-preferred CSPRNG primitive and the completed installer
// production installation-ID source:
//  - windows-runtime-primitives holds the ONLY BCryptGenRandom implementation on this dependency
//    route, and that leaf owns no authority (it depends on no ProjectOS crate at all);
//  - windows-master-key-source delegates to it and retains no duplicate local RNG;
//  - the writer delegates to it ONLY under installer-windows, keeps forbid(unsafe_code), and its
//    dependency graph gains no host-core, host-authority, owner-presence, provider-authority,
//    persistence or master-key capability;
//  - the production source is a unit struct: no caller bytes, ids, callbacks or alternative entropy;
//  - exactly 16 bytes become exactly 32 lower-case hex characters, and RNG failure refuses;
//  - no production RNG call is reachable from any test or validation path;
//  - and (rustc negative compiles) downstream cannot reach the FFI, the production source in the
//    default graph, or any capability through the RNG leaf.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const LEAF = path.join(HOST, "windows-runtime-primitives");
const MKS = path.join(HOST, "windows-master-key-source");
const W = path.join(HOST, "canonical-installation-identity-writer");
const p = (d) => d.replace(/\\/g, "/");

const read = (f) => fs.readFileSync(f, "utf8");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripToml = (s) => s.replace(/#.*/g, "");

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-installer-id-source-closeout1b");
  return __SCRATCH_DIR;
}

/// `dep` picks the consumer's visible crate: the writer's DEFAULT graph, the writer WITH
/// installer-windows, or the RNG leaf alone.
const DEPS = {
  writer: `projectos-host-canonical-installation-identity-writer = { path = "${p(W)}" }`,
  "writer-installer": `projectos-host-canonical-installation-identity-writer = { path = "${p(
    W
  )}", features = ["installer-windows"] }`,
  leaf: `projectos-windows-runtime-primitives = { path = "${p(LEAF)}" }`,
};

function compileConsumer(name, body, dep) {
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
      DEPS[dep || "writer"],
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

// Controls. The installer control NAMES the production source as a trait object but never calls
// `fill` — invoking it would execute the real OS CSPRNG, which this phase forbids.
const CONTROLS = [
  [
    "clo_leaf_control",
    "leaf",
    `use projectos_windows_runtime_primitives::system_random::{system_preferred_fill, SystemRandomError};
fn main(){ let mut e: [u8;0] = []; assert_eq!(system_preferred_fill(&mut e), Err(SystemRandomError::UnsupportedLength)); }`,
  ],
  [
    "clo_installer_control",
    "writer-installer",
    `use projectos_host_canonical_installation_identity_writer as w;
fn main(){ let s: &dyn w::InstallationIdSource = &w::SystemPreferredInstallationIdSource; let _ = s; }`,
  ],
];

const NEGATIVES = [
  {
    name: "neg_production_rng_bytes_supplied",
    dep: "writer-installer",
    why: "a caller can hand the production source its bytes",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f() { let _ = w::SystemPreferredInstallationIdSource([7u8;16]); }\nfn main(){ f(); }`,
  },
  {
    name: "neg_production_source_caller_entropy_field",
    dep: "writer-installer",
    why: "the production source can be built with caller entropy in a field",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f() { let _ = w::SystemPreferredInstallationIdSource { seed: [7u8;16] }; }\nfn main(){ f(); }`,
  },
  {
    name: "neg_production_source_in_default_graph",
    dep: "writer",
    why: "the production source is reachable in the DEFAULT writer graph",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f() { let _ = w::SystemPreferredInstallationIdSource; }\nfn main(){ f(); }`,
  },
  {
    name: "neg_raw_ffi_through_leaf",
    dep: "leaf",
    why: "the unsafe BCrypt FFI is re-exported through the RNG leaf",
    body: `fn main(){ let _ = projectos_windows_runtime_primitives::system_random::BCryptGenRandom; }`,
  },
  {
    name: "neg_master_key_capability_through_leaf",
    dep: "leaf",
    why: "a master-key capability is reachable through the RNG leaf",
    body: `fn f() -> impl projectos_host_windows_crypto_adapter::MasterKeyMaterialSource { unimplemented!() }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_host_authority_through_leaf",
    dep: "leaf",
    why: "host-authority is reachable through the RNG leaf",
    body: `fn f() -> projectos_host_authority::HostAuthority { unimplemented!() }\nfn main(){ let _ = f; }`,
  },
];

/// Package names in a crate's own lockfile — the authoritative record of its dependency graph.
function lockPackages(crateDir) {
  const lock = path.join(crateDir, "Cargo.lock");
  if (!fs.existsSync(lock)) return null;
  return [...read(lock).matchAll(/^name = "([^"]+)"$/gm)].map((m) => m[1]);
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const leafSrc = path.join(LEAF, "src", "system_random.rs");
  for (const f of [leafSrc, path.join(LEAF, "src", "lib.rs"), path.join(MKS, "src", "lib.rs"), path.join(W, "src", "lib.rs")])
    if (!fs.existsSync(f)) E("V1 missing mandatory path: " + f);
  if (errors.length) return errors;

  const leafRaw = read(leafSrc);
  const leaf = stripLine(stripTests(leafRaw));
  const leafToml = stripToml(read(path.join(LEAF, "Cargo.toml")));
  const mks = stripLine(stripTests(read(path.join(MKS, "src", "lib.rs"))));
  const mksToml = stripToml(read(path.join(MKS, "Cargo.toml")));
  const wRaw = read(path.join(W, "src", "lib.rs"));
  const w = stripLine(stripTests(wRaw));
  const wToml = stripToml(read(path.join(W, "Cargo.toml")));

  // ---- V2 the leaf API contract ----
  for (const [needle, what] of [
    ["pub fn system_preferred_fill(destination: &mut [u8]) -> Result<(), SystemRandomError>", "the safe API signature"],
    ["BCryptGenRandom", "the accepted primitive"],
    ["BCRYPT_USE_SYSTEM_PREFERRED_RNG", "the system-preferred flag"],
    ["destination.is_empty()", "the empty-destination refusal"],
    ["u32::try_from(destination.len()).is_err()", "the unrepresentable-length refusal"],
    ["status.is_ok()", "the OS status check"],
  ])
    if (!leaf.includes(needle)) E("V2 the RNG leaf is missing " + what);
  // The safety justification lives in a comment, so it must be checked against the RAW source.
  if (!/\/\/ SAFETY:/.test(leafRaw)) E("V2 the RNG leaf's unsafe block has no documented SAFETY justification");
  if (!/pub enum SystemRandomError\s*\{[^}]*GenerationFailed[^}]*UnsupportedLength[^}]*\}/.test(leaf))
    E("V2 SystemRandomError is not the fieldless two-variant type");
  if (/\(\s*(u32|i32|NTSTATUS|String)\s*\)/.test((/pub enum SystemRandomError\s*\{([\s\S]*?)\n\}/.exec(leaf) || ["", ""])[1]))
    E("V2 SystemRandomError carries an OS detail payload");
  if (/as u32/.test(leaf)) E("V2 the leaf casts a length with `as u32` instead of checking it");
  for (const bad of ["SystemTime", "process::id", "rand::", "getrandom", "uuid", "RtlGenRandom"])
    if (leaf.includes(bad)) E("V2 the leaf references a second entropy source: " + bad);

  // ---- V3 the leaf owns NO authority: it depends on no ProjectOS crate ----
  {
    // Only DEPENDENCY sections count — the crate's own `name =` line is not a dependency.
    const depSections = [...leafToml.matchAll(/\n\[[^\]]*dependencies[^\]]*\]([\s\S]*?)(?=\n\[|$)/g)]
      .map((m) => m[1])
      .join("\n");
    if (/projectos-/.test(depSections))
      E("V3 the RNG leaf gained a ProjectOS dependency — it is no longer a leaf");
  }
  if (!/Win32_Security_Cryptography/.test(leafToml)) E("V3 the leaf lacks the cryptography feature it needs");
  for (const bad of ["Win32_System_Services", "Win32_Security_Authorization", "Win32_Networking", "Win32_System_Registry"])
    if (leafToml.includes(bad)) E("V3 the leaf gained an unrelated privileged Windows feature: " + bad);
  if (!/pub mod system_random;/.test(read(path.join(LEAF, "src", "lib.rs"))))
    E("V3 the leaf does not publish the system_random module");

  // ---- V4 master-key-source migrated, duplicate removed ----
  if (fs.existsSync(path.join(MKS, "src", "windows_rng.rs")))
    E("V4 windows-master-key-source still contains its duplicate RNG module");
  for (const bad of ["BCryptGenRandom", "BCRYPT_USE_SYSTEM_PREFERRED_RNG", "windows_sys", "unsafe"])
    if (mks.includes(bad)) E("V4 windows-master-key-source still names the FFI directly: " + bad);
  if (!/projectos_windows_runtime_primitives::system_random::system_preferred_fill/.test(mks))
    E("V4 windows-master-key-source does not delegate to the leaf primitive");
  if (!/projectos-windows-runtime-primitives\s*=\s*\{/.test(mksToml))
    E("V4 windows-master-key-source does not depend on the leaf");
  if (/windows-sys\s*=/.test(mksToml)) E("V4 windows-master-key-source retains its direct windows-sys dependency");
  if (!/unsafe_code\s*=\s*"forbid"/.test(mksToml)) E("V4 windows-master-key-source no longer forbids unsafe");

  // ---- V5 the writer delegates, only under installer-windows ----
  if (!/#!\[forbid\(unsafe_code\)\]/.test(wRaw)) E("V5 the writer no longer forbids unsafe");
  if (/unsafe |extern "system"|windows_sys/.test(w)) E("V5 the writer gained direct FFI");
  if (!/#\[cfg\(all\(windows, feature = "installer-windows"\)\)\]\s*\nimpl InstallationIdSource for SystemPreferredInstallationIdSource/.test(wRaw))
    E("V5 the production source impl is not gated on installer-windows");
  {
    const i = w.indexOf("impl InstallationIdSource for SystemPreferredInstallationIdSource");
    const body = i === -1 ? "" : w.slice(i, w.indexOf("\n}", i));
    if (!/projectos_windows_runtime_primitives::system_random::system_preferred_fill/.test(body))
      E("V5 the production source does not delegate to the leaf primitive");
    if (!/map_err\(\|_\| InstallationIdSourceError\)/.test(body))
      E("V5 an RNG failure is not mapped to InstallationIdSourceError");
    if (/Ok\(\(\)\)/.test(body)) E("V5 the production source can return success without the OS");
    if (/let _ = buf/.test(body)) E("V5 the production source is still an unconditional stub");
  }
  if (!/#\[cfg\(all\(windows, feature = "installer-windows"\)\)\]\s*\npub struct SystemPreferredInstallationIdSource;/.test(wRaw))
    E("V5 the production source is not a gated UNIT struct (a field could carry caller entropy)");

  // ---- V6 feature separation ----
  {
    const feats = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(wToml) || [])[1] || "";
    if (!/default\s*=\s*\[\s*\]/.test(feats)) E("V6 the writer default feature set is not empty");
    if (!/installer-windows\s*=\s*\["dep:projectos-windows-runtime-primitives"\]/.test(feats))
      E("V6 installer-windows does not map exactly to the optional leaf dependency");
    if (/default\s*=\s*\[[^\]]*installer-windows/.test(feats)) E("V6 installer-windows is enabled by default");
  }
  if (!/projectos-windows-runtime-primitives\s*=\s*\{[^}]*optional\s*=\s*true/.test(wToml))
    E("V6 the leaf dependency is not optional in the writer");

  // ---- V7 exactly 16 bytes -> 32 lower-case hex, and no live RNG in any test path ----
  if (!/let mut buf = \[0u8; 16\];/.test(w)) E("V7 the id draw is not exactly 16 bytes");
  if (!/String::with_capacity\(32\)/.test(w) || !/\{b:02x\}/.test(w))
    E("V7 the 16 bytes are not encoded as 32 lower-case hex characters");
  {
    const tests = read(path.join(W, "src", "tests.rs"));
    if (/generate\(&\s*SystemPreferredInstallationIdSource\s*\)/.test(tests) || /\.fill\(/.test(tests))
      E("V7 a test invokes the PRODUCTION RNG — no live CSPRNG call is permitted");
    if (!/InstallationIdSourceFailed/.test(tests)) E("V7 no test proves the RNG-failure refusal");
  }

  // ---- V8 the writer's graph carries no authority ----
  {
    // The MANIFEST is checked as well as the lockfile: a freshly added dependency edge would not
    // appear in the lockfile until the next resolve, so a lock-only check could be evaded.
    const BANNED = [
      "projectos-host-core",
      "projectos-host-authority",
      "projectos-host-persistence",
      "projectos-host-crypto",
      "projectos-host-windows-crypto-adapter",
      "projectos-host-windows-master-key-source",
      "projectos-trust-contract",
      "projectos-host-owner-presence-bridge",
    ];
    for (const banned of BANNED)
      if (wToml.includes(banned)) E("V8 the writer MANIFEST declares an authority dependency: " + banned);
    const pkgs = lockPackages(W);
    if (!pkgs) E("V8 the writer has no lockfile to reconcile");
    else {
      for (const banned of [
        "projectos-host-core",
        "projectos-host-authority",
        "projectos-host-persistence",
        "projectos-host-crypto",
        "projectos-host-windows-crypto-adapter",
        "projectos-host-windows-master-key-source",
        "projectos-trust-contract",
      ])
        if (pkgs.includes(banned)) E("V8 the writer dependency graph gained authority: " + banned);
      if (!pkgs.includes("projectos-windows-runtime-primitives"))
        E("V8 the writer lockfile does not record the RNG leaf");
    }
  }

  // ---- V9 exactly one BCrypt fill implementation on this route ----
  {
    const holders = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "target", ".git"].includes(ent.name)) continue;
        const f = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(f);
        else if (ent.name.endsWith(".rs") && /BCryptGenRandom/.test(stripLine(read(f))))
          holders.push(path.relative(HOST, f).replace(/\\/g, "/"));
      }
    };
    walk(HOST);
    // windows-owner-verification keeps its own PRIVATE sealed nonce route, explicitly out of scope for
    // this closeout. Anything else holding an FFI fill is a duplicate.
    const unexpected = holders.filter(
      (h) => !h.startsWith("windows-runtime-primitives/") && !h.startsWith("windows-owner-verification/")
    );
    if (unexpected.length) E("V9 a duplicate BCryptGenRandom implementation exists: " + unexpected.join(", "));
    if (!holders.some((h) => h.startsWith("windows-runtime-primitives/")))
      E("V9 the leaf does not hold the canonical implementation");
    const ov = stripLine(read(path.join(HOST, "windows-owner-verification", "src", "lib.rs")));
    if (/^\s*pub mod verification_ffi;/m.test(ov))
      E("V9 the owner-verification FFI module became public");
  }

  // ---- compile proofs ----
  for (const [name, dep, body] of CONTROLS) {
    const r = compileConsumer(name, body, dep);
    if (!r.ok) E("CONTROL " + name + " failed to compile (setup broken):\n" + r.out.slice(0, 1200));
  }
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.dep);
    if (r.ok) E("ID-SOURCE LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-installer-id-source-closeout1b] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-installer-id-source-closeout1b: PASS");
}
