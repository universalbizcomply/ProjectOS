// Validator: CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A — release-currentness correction.
//
// Fails closed. The installed service reported Ready while running an executable the immutable
// identity record was never written for, because nothing compared the two. This pins the fix:
//
//  - ONE release-manifest algorithm exists, in the record contract, reachable by both sides;
//  - the installer delegates to it and keeps no copy;
//  - the installed service recomputes the manifest for its RUNNING image and compares it with the
//    record's stored digest;
//  - Ready requires a verified record AND a running service AND a proven manifest match;
//  - a mismatch is Degraded, never Ready, and the identity stays Verified;
//  - an executable that cannot be read or hashed can never produce Ready;
//  - the status route never writes to the identity record.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const RECORD = path.join(HOST, "host-identity", "src", "identity", "canonical_record.rs");
const HI_TOML = path.join(HOST, "host-identity", "Cargo.toml");
const DRY = path.join(HOST, "elevated-installer-composition", "src", "dry_run.rs");
const STATUS = path.join(HOST, "service-host", "src", "status.rs");

const read = (f) => fs.readFileSync(f, "utf8");
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod \w*/);
  return i === -1 ? s : s.slice(0, i);
};

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  for (const f of [RECORD, HI_TOML, DRY, STATUS]) {
    if (!fs.existsSync(f)) E("missing file: " + f);
  }
  if (errors.length) return errors;

  const record = stripLine(stripTests(read(RECORD)));
  const hiToml = read(HI_TOML).replace(/#.*/g, "");
  const dry = stripLine(stripTests(read(DRY)));
  const status = stripLine(stripTests(read(STATUS)));

  // ---- V1 the shared function exists, in a location BOTH sides can reach ----
  if (!/pub fn release_manifest_digest_for_artefact_digest\(artefact_digest: &str\) -> String \{/.test(record))
    E("V1 the shared release-manifest digest function is missing from the record contract");
  if (!/pub fn release_manifest_canonical_bytes\(artefact_digest: &str\) -> Vec<u8> \{/.test(record))
    E("V1 the shared canonical-bytes construction is missing");
  // No dependency cycle: the record contract must not reach for the writer or the installer.
  for (const banned of [
    "canonical-installation-identity-writer",
    "elevated-installer-composition",
  ]) {
    if (hiToml.includes(banned))
      E("V1 host-identity depends on " + banned + ", which would be a dependency cycle");
  }

  // ---- V2 the shared function is PURE ----
  const shared = /pub fn release_manifest_canonical_bytes\(([\s\S]*?)\n\}/.exec(record);
  const digestFn = /pub fn release_manifest_digest_for_artefact_digest\(([\s\S]*?)\n\}/.exec(record);
  for (const [name, m] of [["canonical bytes", shared], ["digest", digestFn]]) {
    if (!m) continue;
    for (const banned of [
      "std::fs",
      "fs::read",
      "current_exe",
      "std::env",
      "SystemTime",
      "Instant",
    ]) {
      if (m[1].includes(banned))
        E("V2 the shared " + name + " function is not pure: it uses " + banned);
    }
  }
  if (digestFn && !/sha256_hex\(&release_manifest_canonical_bytes\(artefact_digest\)\)/.test(digestFn[1]))
    E("V2 the digest is not the hash of the canonical bytes");

  // ---- V3 MUTATION 4: exactly ONE manifest algorithm exists ----
  // The domain separator is the algorithm's fingerprint. It may appear in exactly one production file.
  const DOMAIN = "PROJECTOS:RELEASE-MANIFEST:V1";
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "target" || ent.name === "node_modules" || ent.name === "tests") continue;
        walk(p);
      } else if (ent.name.endsWith(".rs")) {
        if (stripLine(stripTests(read(p))).includes(DOMAIN)) offenders.push(p);
      }
    }
  };
  walk(HOST);
  if (offenders.length !== 1)
    E(
      "V3 the release-manifest domain appears in " +
        offenders.length +
        " production files, not 1: " +
        offenders.map((p) => path.basename(p)).join(", ")
    );
  else if (path.resolve(offenders[0]) !== path.resolve(RECORD))
    E("V3 the release-manifest algorithm is not in the record contract: " + offenders[0]);
  // The installer must keep no private field writer of its own.
  if (/fn put_field\(out: &mut Vec<u8>, value: &str\)/.test(dry))
    E("V3 the installer still holds a private copy of the manifest field encoder");

  // ---- V4 the installer DELEGATES ----
  const forArtefact = /pub fn for_artefact\(artefact: &ArtefactEvidence\) -> Result<Self, DryRunError> \{([\s\S]*?)\n    \}/.exec(dry);
  if (!forArtefact) E("V4 the installer manifest constructor is missing");
  else {
    const b = forArtefact[1];
    if (!/release_manifest_canonical_bytes\(&artefact_digest\)/.test(b))
      E("V4 the installer does not delegate the canonical bytes to the shared function");
    if (!/release_manifest_digest_for_artefact_digest\(&artefact_digest\)/.test(b))
      E("V4 the installer does not delegate the digest to the shared function");
    if (!/sha256_hex\(&bytes\)/.test(b))
      E("V4 the installer no longer hashes the artefact it is installing");
  }

  // ---- V5 MUTATION 1: the service COMPARES ----
  const isCurrent = /fn release_is_current\(([\s\S]*?)\n\}/.exec(status);
  if (!isCurrent) E("V5 the service performs no release-currentness comparison");
  else {
    const b = isCurrent[1];
    if (!/release_manifest_digest_for_artefact_digest\(digest\) == record\.release_manifest_digest/.test(b))
      E("V5 the service does not compare the running image's manifest with the record's");
    if (!/let digest = executable_digest\?;/.test(b) || !/let record = record\?;/.test(b))
      E("V5 an absent executable digest or record does not short-circuit the comparison");
    if (/Some\(true\)/.test(b))
      E("V5 the currentness comparison can return a hardcoded match");
  }
  const observe = /pub fn observe\(service_state: ServiceStateReport\) -> InstalledHostStatus \{([\s\S]*?)\n\}/.exec(status);
  if (!observe) E("V5 the observer is missing");
  else {
    const b = observe[1];
    if (!/let current = release_is_current\(executable_digest\.as_deref\(\), record\.as_ref\(\)\);/.test(b))
      E("V5 the observer never establishes release currentness");

    // ---- V6 MUTATIONS 2 and 3: Ready requires the match ----
    if (!/if service_state == ServiceStateReport::Running && current == Some\(true\) \{\s*ReadinessReport::Ready/.test(b))
      E("V6 Ready is reported without a proven manifest match and a running service");
    // Ready must appear exactly once, in that one guarded arm.
    const readyCount = (b.match(/ReadinessReport::Ready/g) || []).length;
    if (readyCount !== 1)
      E("V6 ReadinessReport::Ready is reachable from " + readyCount + " places, not 1");
    if (!/\} else \{[\s\S]{0,300}ReadinessReport::Degraded/.test(b))
      E("V6 a failed currentness check is not reported as Degraded");
    // The identity report must not be downgraded by a currentness failure.
    if (/current[\s\S]{0,80}IdentityVerificationReport::(Refused|Unavailable)/.test(b))
      E("V6 a currentness failure downgrades the identity report");
    if (!/IdentityVerificationReport::Refused \| IdentityVerificationReport::Unavailable => \{\s*ReadinessReport::NotReady/.test(b))
      E("V6 an unverified record is not NotReady");

    // The build prefix still describes the RUNNING image; the manifest prefix still comes from the
    // immutable record. Neither reporting rule changed.
    if (!/executable_digest\s*\.as_deref\(\)\s*\.map_or\(UNAVAILABLE_PREFIX, prefix_of\)/.test(b))
      E("V6 the build prefix no longer describes the running executable");
    if (!/prefix_of\(&r\.release_manifest_digest\)/.test(b))
      E("V6 the manifest prefix no longer comes from the immutable record");
    if (!/ProtectedOperationsReport::Refused/.test(b))
      E("V6 protected operations are no longer Refused");
  }

  // ---- V7 MUTATION 3: an unreadable executable yields no digest, so never Ready ----
  const digestOf = /fn current_executable_digest\(\) -> Option<String> \{([\s\S]*?)\n\}/.exec(status);
  if (!digestOf) E("V7 the running-image digest is not an Option");
  else {
    const b = digestOf[1];
    if (!/std::env::current_exe\(\)\.ok\(\)\?/.test(b))
      E("V7 the digest is not taken from the running image");
    if (!/std::fs::read\(path\)\.ok\(\)\?/.test(b))
      E("V7 an unreadable executable does not short-circuit to None");
    if (/UNAVAILABLE|unwrap_or/.test(b))
      E("V7 an unreadable executable is substituted with a placeholder digest");
  }

  // ---- V8 MUTATION 5: the status route never rewrites the record ----
  for (const banned of [
    "fs::write",
    "write_identity_record",
    "OpenOptions",
    "fs::remove_file",
    "fs::rename",
    "hard_link",
    "set_len",
    "create_dir",
  ]) {
    if (status.includes(banned))
      E("V8 the status route mutates the identity record: " + banned);
  }
  if (!/fn read_and_verify\(\)/.test(status) || !/verify_record\(&record, RecordInstallationEvidence::Matched\)/.test(status))
    E("V8 the identity report no longer comes solely from the frozen reader");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-release-currentness1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-release-currentness1a: PASS");
}
