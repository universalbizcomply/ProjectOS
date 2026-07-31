// Validator: CD-B4-CANONICAL-INSTALLATION-IDENTITY-WIRING1A
//
// Fails closed. Proves the canonical installation identity contract:
//  - the all-zero placeholder is GONE from host-authority and can never be reconstructed;
//  - the record digest is domain-separated, schema-versioned and length-prefixed, reusing the accepted
//    sha256_hex + core-plan encoding pattern (no second hashing or serialiser vocabulary);
//  - every bound identity field (product, service, installation id, channel, relative path, manifest
//    digest, schema version) enters the digest;
//  - verification refuses unsupported version, missing field, wrong product/service/relative-path,
//    digest mismatch, placeholder digest, and absent/missing/mismatched protected evidence;
//  - the record location is SYMBOLIC through the accepted Known Folder anchor — no resolved path, no
//    env var, CWD, username or exe-parent derivation;
//  - the production provider reads nothing and reports Unavailable, and never writes/repairs;
//  - fixtures are non-default and downstream code cannot construct a verified identity;
//  - and (rustc negative compiles) downstream cannot build the record's verified identity directly.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const IDENT = path.join(HOST, "host-identity");
const AUTH = path.join(HOST, "host-authority");
const IDENT_PATH = IDENT.replace(/\\/g, "/");

const read = (p) => fs.readFileSync(p, "utf8");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod tests/);
  return i === -1 ? s : s.slice(0, i);
};
const stripLine = (s) => s.replace(/\/\/.*/g, "");

function workdir() {
  return path.join(os.tmpdir(), "projectos-val-canonical-installation-identity");
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
      `projectos-host-identity = { path = "${IDENT_PATH}" }`,
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
use projectos_host_identity::canonical_record as cr;
fn main(){
    let _ = cr::RECORD_SCHEMA_VERSION;
    let _ = cr::EXPECTED_SERVICE_NAME;
    let loc = cr::symbolic_record_location();
    assert!(loc.starts_with("%KNOWNFOLDER:ProgramData%"));
    println!("CONTROL_OK");
}
`;

const NEGATIVES = [
  {
    name: "neg_verified_struct_literal",
    why: "VerifiedCanonicalInstallation is constructible via a struct literal",
    body: `use projectos_host_identity::canonical_record as cr;\nfn f() -> cr::VerifiedCanonicalInstallation { cr::VerifiedCanonicalInstallation{ digest: String::new() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_fixture_record_default_graph",
    why: "the fixture record is reachable in the default graph",
    body: `fn main(){ let _ = projectos_host_identity::canonical_record::fixtures::valid_record; }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const recPath = path.join(IDENT, "src", "identity", "canonical_record.rs");
  if (!fs.existsSync(recPath)) {
    E("V1 missing mandatory path: " + recPath);
    return errors;
  }
  const rec = read(recPath);
  const recCode = stripLine(stripTests(rec));
  const model = stripLine(stripTests(read(path.join(AUTH, "src", "model.rs"))));

  // ---- V2 the placeholder is gone and cannot be reconstructed ----
  if (/digest16:\s*"0{16}"/.test(model)) E("V2 the all-zero placeholder digest is still present");
  if (/from_canonical_boundary/.test(model)) E("V2 the placeholder constructor still exists");
  {
    const i = model.indexOf("fn from_verified_digest");
    const body = i === -1 ? "" : model.slice(i, model.indexOf("\n    }", i));
    if (i === -1) E("V2 no verified-digest constructor replaces the placeholder");
    if (!/all\(\|b\| b == b'0'\)/.test(body)) E("V2 the verified ctor does not reject an all-zero digest");
    if (!/len\(\) != 16/.test(body)) E("V2 the verified ctor does not pin the digest length");
    if (!/pub\(crate\) fn from_verified_digest/.test(model))
      E("V2 the verified ctor is not crate-private");
  }

  // ---- V3 digest contract: domain-separated, schema-versioned, length-prefixed, reused hashing ----
  if (!/const DIGEST_DOMAIN: &str = "PROJECTOS:CANONICAL-INSTALLATION-IDENTITY:V1"/.test(recCode))
    E("V3 the record digest is not domain-separated with a version-pinned tag");
  if (!/sha256_hex\(&b\)/.test(recCode)) E("V3 the digest does not reuse the accepted sha256_hex");
  if (/use sha2::|Sha256::new\(\)/.test(recCode)) E("V3 a second hashing vocabulary was introduced");
  if (!/fn put\(buf: &mut Vec<u8>, bytes: &\[u8\]\)[\s\S]{0,200}?len\(\) as u32\)\.to_be_bytes\(\)/.test(recCode))
    E("V3 the encoding is not length-prefixed");
  if (!/put\(&mut b, &record\.schema_version\.to_be_bytes\(\)\)/.test(recCode))
    E("V3 the digest is not schema-versioned");
  // Every bound field must enter the digest.
  for (const f of [
    "product",
    "service_name",
    "installation_id",
    "channel",
    "service_relative_path",
    "release_manifest_digest",
  ])
    if (!new RegExp('put_field\\(\\s*&mut b,\\s*"' + f + '"').test(recCode.replace(/\s+/g, " ")))
      E("V3 bound field not in the digest: " + f);

  // ---- V4 fail-closed verification ----
  {
    const i = recCode.indexOf("pub fn verify_record(");
    const body = i === -1 ? "" : recCode.slice(i);
    if (i === -1) E("V4 verify_record is missing");
    for (const [needle, what] of [
      ["RecordError::UnsupportedVersion", "unsupported version"],
      ["RecordError::MissingField", "missing field"],
      ["RecordError::WrongProduct", "wrong product"],
      ["RecordError::WrongServiceName", "wrong service name"],
      ["RecordError::WrongServiceRelativePath", "wrong relative path"],
      ["RecordError::PlaceholderDigest", "placeholder digest"],
      ["RecordError::DigestMismatch", "digest mismatch"],
      ["RecordError::ProtectedEvidenceUnavailable", "absent protected evidence"],
      ["RecordError::EvidenceMismatch", "evidence mismatch"],
    ])
      if (!body.includes(needle)) E("V4 missing refusal: " + what);
    // Only Matched may pass.
    if (!/InstallationEvidence::Matched\s*=>\s*\{\}/.test(body))
      E("V4 protected evidence other than Matched can pass");
    // The placeholder guard must precede the digest comparison.
    const ph = body.indexOf("RecordError::PlaceholderDigest");
    const dm = body.indexOf("let recomputed");
    if (ph === -1 || dm === -1 || ph > dm)
      E("V4 the placeholder guard does not precede the digest comparison");
  }

  // ---- V5 symbolic Known Folder resolution only ----
  if (!/KnownFolderAnchor::ProgramData\.symbol\(\)/.test(recCode))
    E("V5 the record location does not use the accepted Known Folder anchor");
  for (const bad of ["std::env", "env::var", "current_dir", "USERPROFILE", "PROGRAMDATA", "parent()"])
    if (recCode.includes(bad)) E("V5 a forbidden path source is used: " + bad);

  // ---- V6 the production provider reads nothing and never writes ----
  {
    const i = recCode.indexOf("impl InstallationEvidenceProvider for ProgramDataIdentityRecord");
    const body = i === -1 ? "" : recCode.slice(i, recCode.indexOf("\n}", i));
    if (i === -1) E("V6 the production provider is missing");
    if (!/InstallationEvidence::Unavailable/.test(body))
      E("V6 the production provider does not fail closed as Unavailable");
  }
  for (const bad of [
    "fs::write",
    "fs::create_dir",
    "create_dir_all",
    "OpenOptions",
    "File::create",
    "remove_file",
    "fs::read",
  ])
    if (recCode.includes(bad)) E("V6 the record module performs filesystem mutation or access: " + bad);

  // ---- V7 fixtures are non-default ----
  if (!/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\]\s*\npub mod fixtures/.test(rec))
    E("V7 the fixture module is not gated behind test-fixtures");

  // ---- compile proofs ----
  const control = compileConsumer("cii_control", CONTROL);
  if (!control.ok) E("DEFAULT-graph control failed to compile (setup broken):\n" + control.out.slice(0, 1500));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body);
    if (r.ok) E("CANONICAL IDENTITY LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-canonical-installation-identity1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-canonical-installation-identity1a: PASS");
}
