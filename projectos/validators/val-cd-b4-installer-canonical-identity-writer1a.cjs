// Validator: CD-B4-INSTALLER-CANONICAL-IDENTITY-RECORD-WRITER1A
//
// Fails closed. Proves the installer-only canonical identity record writer:
//  - it lives in its own crate and NO runtime crate depends on it;
//  - it reuses the closed record/digest contract — no second schema, digest, service constant or mint;
//  - the writer never takes a path, product, service name, executable path, schema version or record
//    digest from a caller; the target abstraction is sealed and fixture construction is gated;
//  - it never writes the final path directly, never overwrites, truncates, repairs or deletes an
//    existing record, and uses exclusive create-new + sync_all + a non-replacing publish;
//  - installation ids are 32 lower-case hex, all-zero refused, production source gated and never called;
//  - the default graph exposes no write or fixture route;
//  - and (rustc negative compiles) downstream cannot reach any of it.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const W = path.join(HOST, "canonical-installation-identity-writer");
const W_PATH = W.replace(/\\/g, "/");

const read = (p) => fs.readFileSync(p, "utf8");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripToml = (s) => s.replace(/#.*/g, "");

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-installer-canonical-identity-writer1a");
  return __SCRATCH_DIR;
}
const HI_PATH = path.join(HOST, "host-identity").replace(/\\/g, "/");

/// `dep` selects which crate the consumer may see: the writer (default) or the RUNTIME read boundary.
function compileConsumer(name, body, dep) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const dependency =
    dep === "runtime"
      ? `projectos-host-identity = { path = "${HI_PATH}" }`
      : `projectos-host-canonical-installation-identity-writer = { path = "${W_PATH}" }`;
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
      dependency,
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
use projectos_host_canonical_installation_identity_writer as w;
fn main(){
    let _ = w::InstallationChannel::parse("stable");
    let _ = w::ReleaseManifestDigest::parse("aa");
    let _ = w::InstallationId::parse("00");
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_target_from_path",
    why: "an installer target is constructible from a caller-supplied path",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f(p: &std::path::Path) { let _ = w::InstallerTarget::fixture_under(p); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_target_struct_literal",
    why: "InstallerTarget is constructible via a struct literal",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f() -> w::InstallerTarget { w::InstallerTarget{ installation_dir: std::path::PathBuf::new() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_fixture_id_source_default_graph",
    why: "the fixture installation-id source is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_canonical_installation_identity_writer::FixtureInstallationIdSource([0u8;16]); }`,
  },
  {
    name: "neg_caller_record_digest",
    why: "a caller can supply the record digest or override frozen fields",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f(t: &w::InstallerTarget, i: &w::InstallationId, r: &w::ReleaseManifestDigest) { let _ = w::write_identity_record(t, i, w::InstallationChannel::Stable, r, "deadbeef"); }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_verified_identity_from_writer",
    why: "the writer exposes a verified canonical identity mint",
    body: `use projectos_host_canonical_installation_identity_writer as w;\nfn f() -> w::VerifiedCanonicalInstallation { unimplemented!() }\nfn main(){ let _ = f; }`,
  },
  // A crate that sees only the RUNTIME read/verify boundary must have no write route at all: the
  // installer writer is not re-exported, wrapped or otherwise reachable through host-identity.
  {
    name: "neg_write_through_runtime_boundary",
    dep: "runtime",
    why: "the runtime read/verify boundary exposes a record-write route",
    body: `use projectos_host_identity::canonical_record as r;\nfn f() { let _ = r::write_identity_record; }\nfn main(){ f(); }`,
  },
];

/// A crate depending only on the runtime boundary must still compile — otherwise the negative above
/// would "pass" for an unrelated setup reason.
const RUNTIME_CONTROL = `
use projectos_host_identity::canonical_record as r;
fn main(){ println!("{} {}", r::EXPECTED_PRODUCT, r::RECORD_FILE_NAME); }
`;

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const libPath = path.join(W, "src", "lib.rs");
  for (const p of [libPath, path.join(W, "Cargo.toml")])
    if (!fs.existsSync(p)) E("V1 missing mandatory path: " + p);
  if (errors.length) return errors;

  const lib = read(libPath);
  const code = stripLine(stripTests(lib));
  const toml = stripToml(read(path.join(W, "Cargo.toml")));

  // ---- V2 dependency boundary: no runtime crate depends on the writer ----
  {
    const offenders = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "target", "dist", ".git"].includes(ent.name)) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name === "Cargo.toml") {
          const rel = path.relative(ROOT, p).replace(/\\/g, "/");
          if (rel.includes("canonical-installation-identity-writer")) continue;
          // EXACTLY ONE dependent is permitted: the elevated-installer composition crate, which IS the
          // installer boundary rather than a runtime crate. Its own validator proves that no runtime,
          // Tauri or renderer crate depends on IT, so the writer stays unreachable from the runtime.
          if (rel === "projectos/host/elevated-installer-composition/Cargo.toml") continue;
          if (/canonical-installation-identity-writer/.test(stripToml(read(p)))) offenders.push(rel);
        }
      }
    };
    walk(path.join(ROOT, "projectos"));
    if (offenders.length) E("V2 a runtime crate depends on the writer: " + offenders.join(", "));
    if (/projectos-host-core|host-authority|owner-presence-bridge/.test(toml))
      E("V2 the writer depends on a runtime authority crate");
    if (!/projectos-host-identity\s*=\s*\{/.test(toml))
      E("V2 the writer does not reuse the closed identity contract");
  }

  // ---- V3 no duplicated contract ----
  for (const [re, what] of [
    [/const DIGEST_DOMAIN/, "a second digest domain"],
    [/PROJECTOS:CANONICAL-INSTALLATION-IDENTITY/, "a second digest domain string"],
    [/fn compute_record_digest\s*\(/, "a second digest implementation"],
    [/struct InstallationIdentityRecordV1/, "a second record schema"],
    [/"ProjectOSHost"/, "a second service-name constant"],
    [/"ProjectOSHost\.exe"/, "a second executable constant"],
    [/sha2::|Sha256/, "a second hashing vocabulary"],
  ])
    if (re.test(code)) E("V3 the writer defines " + what);
  for (const n of ["EXPECTED_PRODUCT", "EXPECTED_SERVICE_NAME", "EXPECTED_SERVICE_RELATIVE_PATH", "compute_record_digest", "RECORD_SCHEMA_VERSION"])
    if (!code.includes(n)) E("V3 the writer does not reuse " + n);

  // ---- V4 the writer API accepts no forbidden input ----
  {
    const i = code.indexOf("pub fn write_identity_record(");
    const sig = i === -1 ? "" : code.slice(i, code.indexOf(")", i));
    if (i === -1) E("V4 write_identity_record is missing");
    for (const bad of ["Path", "PathBuf", "product", "service", "schema", "digest: &str", "record_digest"])
      if (sig.includes(bad)) E("V4 the write API accepts a forbidden input: " + bad);
  }
  if (!/fn fixture_under/.test(code)) E("V4 no fixture target constructor exists");
  if (!/#\[cfg\(any\(test, feature = "fixture-writer"\)\)\]\s*\n\s*pub fn fixture_under/.test(lib))
    E("V4 fixture target construction is not gated on fixture-writer");
  {
    // The struct's field must stay private so no struct-literal target is possible.
    const m = /pub struct InstallerTarget\s*\{([\s\S]*?)\n\}/.exec(code);
    if (!m) E("V4 InstallerTarget is missing");
    else if (/\bpub\s+\w+\s*:/.test(m[1])) E("V4 InstallerTarget has a public field");
  }

  // ---- V5 atomic write contract ----
  for (const [needle, what] of [
    [".create_new(true)", "exclusive create-new"],
    ["sync_all()", "sync_all durability"],
    ["f.flush()", "flush before sync"],
    ["fs::hard_link(&temp_path, &final_path)", "non-replacing publish"],
    ["compare_existing(", "idempotency / conflict comparison"],
  ])
    if (!code.includes(needle)) E("V5 missing " + what);
  // Never write the final path directly, and never truncate/replace it.
  if (/OpenOptions[\s\S]{0,200}?open\(&final_path\)/.test(code))
    E("V5 the writer opens the FINAL path directly");
  if (/fs::write\(&?final_path/.test(code)) E("V5 the writer writes the final path directly");
  if (/truncate\(true\)/.test(code)) E("V5 the writer truncates");
  if (/fs::rename\(/.test(code)) E("V5 the writer uses rename, which would replace an existing record");
  if (/fs::remove_file\(&?final_path/.test(code)) E("V5 the writer deletes the final record");

  // ---- V6 idempotency / conflict never mutate an existing record ----
  {
    const i = code.indexOf("fn compare_existing(");
    const body = i === -1 ? "" : code.slice(i);
    if (i === -1) E("V6 compare_existing is missing");
    for (const bad of ["fs::write", "remove_file", "OpenOptions", "create_dir"])
      if (body.includes(bad)) E("V6 the existing-record path mutates the filesystem: " + bad);
    if (!/WriteOutcome::AlreadyInstalledSameIdentity/.test(body)) E("V6 no idempotent outcome");
    if (!/WriteError::ConflictingIdentityExists/.test(body)) E("V6 no conflict refusal");
    if (!/WriteError::ExistingRecordUnreadable/.test(body)) E("V6 no malformed-record refusal");
  }

  // ---- V7 installation-id and release-digest contracts ----
  if (!/is_lower_hex\(s, 32\)/.test(code)) E("V7 installation id is not pinned to 32 lower-case hex");
  if (!/is_lower_hex\(s, 64\)/.test(code)) E("V7 release digest is not pinned to 64 lower-case hex");
  if (!/fn all_zero/.test(code)) E("V7 no all-zero refusal");
  for (const bad of ["SystemTime", "process::id", "USERNAME", "COMPUTERNAME", "rand::", "uuid"])
    if (code.includes(bad)) E("V7 a forbidden entropy source is referenced: " + bad);
  if (!/#\[cfg\(all\(windows, feature = "installer-windows"\)\)\]\s*\npub struct SystemPreferredInstallationIdSource/.test(lib))
    E("V7 the production id source is not gated on installer-windows");

  // ---- V8 canonical JSON encoding ----
  {
    const i = code.indexOf("pub fn to_canonical_json(");
    const body = i === -1 ? "" : code.slice(i, code.indexOf("\n}", i));
    if (i === -1) E("V8 to_canonical_json is missing");
    const order = [
      "schema_version", "product", "service_name", "installation_id",
      "channel", "service_relative_path", "release_manifest_digest", "record_digest",
    ];
    let at = -1;
    for (const f of order) {
      const j = body.indexOf('\\"' + f + '\\"');
      if (j === -1) E("V8 canonical JSON omits field: " + f);
      else if (j < at) E("V8 canonical JSON field order is wrong at: " + f);
      else at = j;
    }
    if (/serde_json::to_(string|vec)/.test(body))
      E("V8 canonical bytes are produced by serde (map order is not guaranteed)");
  }
  if (!/if to_canonical_json\(&record\) != bytes\s*\{\s*return Err\(CodecError::NonCanonical\)/.test(code))
    E("V8 the parser does not re-serialise and compare, so non-canonical input could pass");

  // ---- V9 default graph exposes no write or fixture route ----
  {
    const feats = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(toml) || [])[1] || "";
    if (!/default\s*=\s*\[\s*\]/.test(feats)) E("V9 the writer default feature set is not empty");
    if (!/fixture-writer\s*=\s*\[\s*\]/.test(feats)) E("V9 fixture-writer is missing or pulls a dependency");
  }
  if (!/#!\[forbid\(unsafe_code\)\]/.test(lib)) E("V9 the writer does not forbid unsafe");

  // ---- V10 the reader side stays read-only ----
  {
    const rec = stripLine(stripTests(read(path.join(HOST, "host-identity", "src", "identity", "canonical_record.rs"))));
    for (const bad of ["fs::write", "create_dir", "OpenOptions", "File::create", "remove_file"])
      if (rec.includes(bad)) E("V10 the reader gained a filesystem-mutating route: " + bad);
    if (!/fn production_canonical_identity/.test(rec)) E("V10 the production read route is missing");
  }

  // ---- V11 no real ProgramData / Program Files path is referenced ----
  for (const bad of ["C:\\\\ProgramData", "C:\\\\Program Files", "ProgramData\\\\ProjectOS"])
    if (lib.includes(bad)) E("V11 a real production path is referenced: " + bad);

  // ---- compile proofs ----
  const control = compileConsumer("icw_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1500));
  const rtControl = compileConsumer("icw_runtime_control", RUNTIME_CONTROL, "runtime");
  if (!rtControl.ok)
    E("RUNTIME-boundary control failed to compile (setup broken):\n" + rtControl.out.slice(0, 1500));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.dep);
    if (r.ok) E("INSTALLER WRITER LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-installer-canonical-identity-writer1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-installer-canonical-identity-writer1a: PASS");
}
