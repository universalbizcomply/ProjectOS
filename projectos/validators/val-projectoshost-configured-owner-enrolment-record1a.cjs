// Validator: PROJECTOSHOST-CONFIGURED-OWNER-ENROLMENT-RECORD1A
//
// Fails closed. Pins the MINIMAL configured-owner enrolment extension.
//
// The whole phase is four source paths. It adds an optional, digest-bound configured-owner SID to the
// ONE canonical installation identity record, and one explicit enrolment entry point beside the
// existing ownerless one. It creates no second record family, no second SID type, no enrolment
// subsystem and no new ProgramData security: the record file is already protected by the accepted
// record-file ACL (val-cd-b4-record-file-acl-correction1a), and this validator asserts that protection
// still holds rather than duplicating it.
//
// The threat each assertion answers (and the mutation it kills):
//   O1  the four committed paths exist and the record family is still SINGLE
//   O2  version-1 records stay valid and are never auto-upgraded; owner absent is a real answer
//   O3  the owner SID is DIGEST-BOUND                                              (M1)
//   O4  version and owner presence must agree, and the SID is structurally validated
//   O5  the installing/elevated actor never becomes the owner by side effect       (M2)
//   O6  the authority record stays protected: service read-only, no broad principal (M3)
//   O7  an existing record can never be replaced                                    (M4)
//   O8  no second SID abstraction and no second record schema family
//   O9  no username, display name or UPN is ever persisted as authority
//   O10 the proof tests exist
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const RECORD = path.join(HOST, "host-identity", "src", "identity", "canonical_record.rs");
const WRITER = path.join(HOST, "canonical-installation-identity-writer", "src", "lib.rs");
const WRITER_TESTS = path.join(HOST, "canonical-installation-identity-writer", "src", "tests.rs");
const ACL_PLAN = path.join(HOST, "windows-host-activation-plan", "src", "acl_plan.rs");

const read = (p) => fs.readFileSync(p, "utf8");
/** Strip line comments so prose cannot satisfy or fail a structural check. */
const strip = (s) =>
  s
    .split(/\r?\n/)
    .map((l) => {
      const i = l.indexOf("//");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");
/** The body of an item, from its signature to the next top-level `}`. */
function body(src, sig) {
  const at = src.indexOf(sig);
  if (at === -1) return null;
  const rest = src.slice(at);
  const end = rest.indexOf("\n}");
  return end === -1 ? rest : rest.slice(0, end);
}

function run() {
  const e = [];
  const E = (m) => e.push(m);

  // ---- O1 the committed paths, and ONE record family ----
  for (const [f, label] of [
    [RECORD, "host-identity canonical_record.rs"],
    [WRITER, "canonical-installation-identity-writer lib.rs"],
    [WRITER_TESTS, "canonical-installation-identity-writer tests.rs"],
    [ACL_PLAN, "windows-host-activation-plan acl_plan.rs"],
  ]) {
    if (!fs.existsSync(f)) {
      E("O1 a required file is missing: " + label);
      return e;
    }
  }
  const rec = strip(read(RECORD));
  const wr = strip(read(WRITER));
  const wrTests = read(WRITER_TESTS);
  const acl = strip(read(ACL_PLAN));

  // The digest domain is UNCHANGED: version separation rides on schema_version, already inside the
  // digest. A second domain would fork the record family.
  if (!/const DIGEST_DOMAIN: &str = "PROJECTOS:CANONICAL-INSTALLATION-IDENTITY:V1"/.test(rec)) {
    E("O1 the canonical digest domain changed; the record family must stay single");
  }
  if (!/pub const RECORD_SCHEMA_VERSION: u32 = 1;/.test(rec)) {
    E("O1 the legacy schema version constant changed");
  }
  if (!/pub const RECORD_SCHEMA_VERSION_OWNER_ENROLLED: u32 = 2;/.test(rec)) {
    E("O1 the owner-enrolled schema version is missing");
  }

  // ---- O2 version-1 stays valid, owner absent is a real answer, no auto-upgrade ----
  if (!/pub enum OwnerEnrolment/.test(rec) || !/\n\s*Absent,/.test(rec)) {
    E("O2 OwnerEnrolment::Absent is missing; a legacy record must have a real 'no owner' answer");
  }
  if (!/#\[serde\(default\)\]\s*\n\s*pub configured_owner_sid: Option<String>,/.test(rec)) {
    E("O2 the owner field is not an optional, defaulted field; existing records would stop parsing");
  }
  const verify = body(rec, "pub fn verify_record(");
  if (!verify) {
    E("O2 verify_record is missing");
  } else {
    if (/configured_owner_sid\s*=\s*Some\(/.test(verify)) {
      E("O2 verification ASSIGNS an owner; a legacy record must never be upgraded automatically");
    }
    for (const bad of ["current_user", "GetUserName", "TokenUser", "console", "INTERACTIVE"]) {
      if (verify.includes(bad)) E("O2 verification infers an owner from the environment: " + bad);
    }
  }

  // ---- O3 the owner SID is DIGEST-BOUND (M1) ----
  const digest = body(rec, "pub fn compute_record_digest(");
  if (!digest) {
    E("O3 compute_record_digest is missing");
  } else {
    if (!/put_field\(&mut b, "configured_owner_sid", owner\)/.test(digest.replace(/\s+/g, " "))) {
      E("O3 the owner SID does not enter the record digest; it could be rewritten undetected");
    }
    // The declared field count must distinguish the two shapes, so an enrolled and an ownerless
    // record can never produce the same pre-image.
    if (!/bound_fields/.test(digest)) {
      E("O3 the digest does not declare a field count that distinguishes an enrolled record");
    }
  }

  // ---- O4 version/owner agreement and structural SID validation ----
  if (!verify || !/OwnerEnrolmentVersionMismatch/.test(verify)) {
    E("O4 a version/owner disagreement is not refused; one shape could be read as the other");
  }
  if (!verify || !/OwnerSidMalformed/.test(verify)) {
    E("O4 a malformed owner SID is not refused");
  }
  const shape = body(rec, "fn is_owner_sid_hex(");
  if (!shape) {
    E("O4 the owner SID validator is missing");
  } else {
    for (const [re, what] of [
      [/revision == 1/, "revision"],
      [/sub_authorities <= 15/, "sub-authority bound"],
      [/s\.len\(\) == OWNER_SID_HEX_MIN \+ 8 \* usize::from\(sub_authorities\)/, "exact length"],
    ]) {
      if (!re.test(shape)) E("O4 the owner SID validation does not check the " + what);
    }
  }

  // ---- O5 the installing actor never becomes the owner (M2) ----
  const ownerless = body(wr, "pub fn write_identity_record(");
  if (!ownerless) {
    E("O5 the ownerless write entry point is missing");
  } else if (!/write_record\(target, id, channel, release, None\)/.test(ownerless)) {
    E("O5 an ordinary installation does not enrol NOBODY; the actor could become the owner");
  }
  if (!/pub fn write_identity_record_with_enrolled_owner\(/.test(wr)) {
    E("O5 the explicit enrolment entry point is missing");
  }
  const build = body(wr, "fn build_record(");
  if (!build) {
    E("O5 build_record is missing");
  } else if (!/owner: Option<&EnrolledOwnerSid>/.test(wr)) {
    E("O5 the owner is not an explicit parameter; it could be derived rather than supplied");
  }
  // The enrolment boundary must not resolve an identity itself.
  for (const bad of ["USERNAME", "GetUserName", "TokenUser", "OpenProcessToken", "LookupAccountName", "whoami"]) {
    if (wr.includes(bad)) E("O5 the writer resolves an identity itself: " + bad);
  }

  // ---- O6 the authority record stays protected (M3) ----
  const recordPolicy = body(acl, "pub fn compose_record_file_with_resolved_principal(");
  if (!recordPolicy) {
    E("O6 the accepted record-file ACL composition is missing");
  } else {
    if (!/rights: RightsClass::Read/.test(recordPolicy)) {
      E("O6 the service no longer has READ-ONLY access to the authority record");
    }
    // Scope the broad-principal scan to the ALLOWED vector only. The trailing
    // `AclPolicy::strict(<expected_owner>, allowed)` argument is the expected NTFS owner, not a grant,
    // and matching it here would be a false positive.
    const allowedRegion = recordPolicy.slice(
      recordPolicy.indexOf("let mut allowed"),
      recordPolicy.indexOf("AclPolicy::strict(")
    );
    for (const bad of [
      "Everyone",
      "BuiltinUsers",
      "AuthenticatedUsers",
      "CurrentInteractiveUser",
      "CreatorOwner",
    ]) {
      if (allowedRegion.includes(bad)) {
        E("O6 a broad principal was granted access to the authority record: " + bad);
      }
    }
    // The service is granted READ and nothing wider; write-like rights belong to SYSTEM and
    // Administrators only.
    const serviceGrant = allowedRegion.slice(
      allowedRegion.indexOf("service.principal()"),
      allowedRegion.indexOf("BuiltinAdministrators")
    );
    for (const bad of ["RightsClass::Modify", "RightsClass::FullControl", "RightsClass::Write"]) {
      if (serviceGrant.includes(bad)) {
        E("O6 the service was granted more than read on the authority record: " + bad);
      }
    }
  }

  // ---- O7 an existing record can never be replaced (M4) ----
  for (const [re, what] of [
    [/fs::rename\(/, "rename over an existing record"],
    [/truncate\(true\)/, "truncate"],
    [/fs::remove_file\(&?final_path/, "delete the final record"],
  ]) {
    if (re.test(wr)) E("O7 the writer can now " + what + "; replacement must stay impossible");
  }
  if (!/\.create_new\(true\)/.test(wr)) {
    E("O7 the exclusive create-new publish was removed");
  }
  const shared = body(wr, "fn write_record(");
  if (!shared) {
    E("O7 the shared write path is missing");
  } else if (!/if final_path\.exists\(\)\s*\{\s*return compare_existing/.test(shared.replace(/\s+/g, " "))) {
    E("O7 an existing record is no longer compared and left intact before any write");
  }

  // ---- O8 no second SID abstraction, no second record family ----
  for (const [re, what] of [
    [/struct ConfiguredOwnerSid/, "a second SID abstraction"],
    [/struct OwnedSid/, "a redefined OwnedSid"],
    [/struct InstallationIdentityRecordV2/, "a second record schema"],
    [/const DIGEST_DOMAIN[^\n]*V2/, "a second digest domain"],
  ]) {
    if (re.test(rec) || re.test(wr)) E("O8 the phase introduced " + what);
  }

  // ---- O9 no name-shaped authority is persisted ----
  const json = body(wr, "pub fn to_canonical_json(");
  if (!json) {
    E("O9 the canonical serialiser is missing");
  } else {
    for (const bad of ["username", "user_name", "display_name", "upn", "account_name"]) {
      if (json.includes(bad)) E("O9 a name-shaped field is persisted as authority: " + bad);
    }
  }

  // ---- O10 the proof tests ----
  for (const t of [
    "a_legacy_record_means_owner_enrolment_is_absent",
    "an_enrolled_record_retains_the_exact_owner_sid",
    "the_owner_sid_is_digest_bound",
    "adding_owner_enrolment_does_not_change_an_existing_v1_digest",
    "a_malformed_owner_sid_fails_closed",
    "a_version_and_owner_disagreement_is_never_reinterpreted",
    "an_owner_is_never_inferred_for_a_legacy_record",
  ]) {
    if (!rec.includes(t)) E("O10 a record proof test is missing: " + t);
  }
  for (const t of [
    "the_installing_actor_is_never_automatically_the_owner",
    "an_explicit_enrolment_persists_only_the_resolved_sid",
    "an_unresolvable_or_malformed_owner_sid_fails_closed",
    "an_existing_record_is_never_replaced_by_an_enrolment",
  ]) {
    if (!wrTests.includes(t)) E("O10 a writer proof test is missing: " + t);
  }

  return e;
}

module.exports = { run };
