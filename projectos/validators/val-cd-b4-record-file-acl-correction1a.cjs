// Validator: CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A — record-file ACL correction.
//
// Fails closed. The canonical identity record is a FILE beneath directories whose protected DACLs
// carry NON-INHERITABLE ACEs, so nothing is inherited and a record written beneath them is governed
// by no policy at all. That is why the installed service could not read its own identity.
//
// This pins the correction:
//  - the record-file policy grants the service READ ONLY, and never write, delete or ACL-changing
//    rights;
//  - SYSTEM and Administrators keep full control;
//  - no broad principal is admitted, and the DACL is strict and protected;
//  - the service is NOT made the owner (an owner holds implicit WRITE_DAC);
//  - the installer APPLIES the file ACL after publishing and verifying the record — it never relies
//    on inheritance;
//  - an ACL failure fails the installation; activation does not continue;
//  - the repair operation never rewrites the record's contents.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const PLAN = path.join(HOST, "windows-host-activation-plan", "src", "acl_plan.rs");
const EFFECT = path.join(HOST, "elevated-installer-composition", "src", "effect.rs");
const ACL = path.join(HOST, "windows-acl-policy", "src", "lib.rs");
const CUSTODY = path.join(HOST, "windows-root-custody", "src", "root.rs");

const read = (f) => fs.readFileSync(f, "utf8");
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod \w*/);
  return i === -1 ? s : s.slice(0, i);
};

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  for (const f of [PLAN, EFFECT, ACL, CUSTODY]) {
    if (!fs.existsSync(f)) E("missing file: " + f);
  }
  if (errors.length) return errors;

  const plan = stripLine(stripTests(read(PLAN)));
  const effect = stripLine(stripTests(read(EFFECT)));
  const acl = stripLine(stripTests(read(ACL)));
  const custody = stripLine(stripTests(read(CUSTODY)));

  // ---- V1 the record-file policy exists and is composed from the resolved service principal ----
  const compose =
    /pub fn compose_record_file_with_resolved_principal\(([\s\S]*?)\n    \}/.exec(plan);
  if (!compose) {
    E("V1 the record-file policy composition is missing");
    return errors;
  }
  const body = compose[1];

  // ---- V2 MUTATION 1: the service read ACE must be present ----
  const serviceEntry =
    /let mut allowed = vec!\[AllowedPrincipal \{\s*principal: service\.principal\(\)\.clone\(\),\s*rights: (RightsClass::\w+),\s*\}\];/.exec(
      body
    );
  if (!serviceEntry) E("V2 the record-file policy does not grant the service principal an ACE");

  // ---- V3 MUTATION 2: it must be READ, never write-capable ----
  if (serviceEntry && serviceEntry[1] !== "RightsClass::Read")
    E("V3 the service holds " + serviceEntry[1] + " on the record file, not RightsClass::Read");
  for (const banned of ["RightsClass::FullControl", "RightsClass::Modify"]) {
    const re = new RegExp(
      "principal: service\\.principal\\(\\)\\.clone\\(\\),\\s*rights: " + banned.replace(/:/g, ":")
    );
    if (re.test(body)) E("V3 the service holds " + banned + " on the record file");
  }

  // ---- V4 SYSTEM and Administrators keep full control ----
  for (const p of ["AclPrincipal::BuiltinAdministrators", "AclPrincipal::LocalSystem"]) {
    const re = new RegExp("principal: " + p.replace(/:/g, ":") + ",\\s*rights: RightsClass::FullControl");
    if (!re.test(body)) E("V4 " + p + " does not keep full control on the record file");
  }

  // ---- V5 MUTATION 3: no broad principal, and the policy stays strict ----
  for (const broad of [
    "Everyone",
    "AuthenticatedUsers",
    "BuiltinUsers",
    "WorldSid",
    "S-1-1-0",
    "S-1-5-11",
    "S-1-5-32-545",
  ]) {
    if (body.includes(broad)) E("V5 the record-file policy names a broad principal: " + broad);
  }
  if (!/AclPolicy::strict\(/.test(body))
    E("V5 the record-file policy is not composed through AclPolicy::strict");
  for (const loosened of [
    "allow_broad_principals_any_access: true",
    "allow_broad_principals_write: true",
    "allow_unknown_principals: true",
    "allow_inherited_aces: true",
    "require_protected_dacl: false",
    "allow_deny_aces: true",
  ]) {
    if (body.includes(loosened)) E("V5 the record-file policy is loosened: " + loosened);
  }
  // The interactive owner is not admitted as an ACE holder by this policy.
  if (/principal: AclPrincipal::CurrentInteractiveUser,\s*rights:/.test(body))
    E("V5 the record-file policy grants the interactive account an ACE");

  // ---- V6 NOBODY but SYSTEM owns the authority record (an owner holds implicit WRITE_DAC) ----
  //
  // AMENDED by PROJECTOSHOST-CONFIGURED-OWNER-RECORD-NTFS-OWNER1A under explicit gatekeeper
  // authority, as a STRENGTHENING. The original rule kept the INSTALLING ACCOUNT as owner so the
  // service could not own the record. That was right about the service and wrong about the remedy:
  // it left the same implicit WRITE_DAC with a USER account, which could re-secure the record and
  // then rewrite the configured owner it is meant to authenticate. SYSTEM ownership removes implicit
  // WRITE_DAC from EVERY user and from the service, matching the accepted F1 precedent.
  //
  // Both original prohibitions are RETAINED below, not relaxed.
  if (!/AclPolicy::strict\(\s*AclPrincipal::LocalSystem,/.test(body))
    E("V6 the record-file policy does not make LocalSystem the owner");
  if (/AclPolicy::strict\(\s*service\.principal\(\)/.test(body))
    E("V6 the service principal is made the record file's owner, which grants implicit WRITE_DAC");
  if (/AclPolicy::strict\(\s*AclPrincipal::CurrentInteractiveUser,/.test(body))
    E("V6 an interactive/installing user is made the record file's owner, which grants implicit WRITE_DAC");

  // ---- V6b every ProjectOS-managed ANCESTOR of the record is SYSTEM-owned ----
  //
  // The record's own DACL is worthless if a substitution-capable ancestor is owned by the service or
  // a user: that owner can re-secure the directory, grant itself DELETE_CHILD and replace the record
  // beneath it. ONE expression composes the policy for every managed ancestor
  // (`ProjectOS`, `host`, `installation`), so one assertion covers all three.
  {
    // The ancestor policy is composed in the shared `assemble` helper that
    // `compose_with_resolved_principal` delegates to, so that is where the owner is decided.
    const dir = /fn assemble\(([\s\S]*?)\n    \}/.exec(plan);
    const dirBody = dir && dir[1];
    if (!dirBody) E("V6b the ancestor ACL composition is missing");
    else {
      if (!/AclPolicy::strict\(AclPrincipal::LocalSystem, allowed\)/.test(dirBody))
        E("V6b a ProjectOS-managed ancestor of the authority record is not SYSTEM-owned");
      if (/AclPolicy::strict\(service\.principal\(\)/.test(dirBody))
        E("V6b the service owns an ancestor of the authority record, enabling record substitution");
    }
  }

  // ---- V7 the file ACL surface exists and asserts the object kind on the HANDLE ----
  for (const fn of [
    "pub fn inspect_file(",
    "pub fn verify_file(",
    "pub fn apply_file_policy(",
    "pub fn apply_and_verify_file(",
  ]) {
    if (!acl.includes(fn)) E("V7 the file ACL surface is missing: " + fn);
  }
  const applyFile = /pub fn apply_file_policy\(([\s\S]*?)\n    \}/.exec(acl);
  if (!applyFile) E("V7 apply_file_policy is missing");
  else {
    if (!/Self::intended_state\(policy\)\?/.test(applyFile[1]))
      E("V7 the file apply path skips the pre-effect policy refusal");
    if (!/Self::admit_file\(path\)\?/.test(applyFile[1]))
      E("V7 the file apply path skips file custody admission");
    if (!/SecuredObjectKind::File/.test(applyFile[1]))
      E("V7 the file apply path does not assert the object kind on the handle");
    if (!/custody\.revalidate\(\)/.test(applyFile[1]))
      E("V7 the file apply path does not revalidate custody after the effect");
  }
  const applyVerify = /pub fn apply_and_verify_file\(([\s\S]*?)\n    \}/.exec(acl);
  if (!applyVerify) E("V7 apply_and_verify_file is missing");
  else if (!/self\.verify_file\(path, policy\)\?/.test(applyVerify[1]))
    E("V7 the file apply path reports success without an authoritative re-read");
  // File custody refuses a directory, on the handle.
  if (!/RootCustodyError::NotAFile/.test(custody))
    E("V7 file custody does not refuse a directory");
  if (!/ATTR_REPARSE_POINT != 0/.test(custody))
    E("V7 file custody does not refuse a reparse point");

  // ---- V8 MUTATION 4: the installer APPLIES the file ACL; it never relies on inheritance ----
  const install = /pub fn install_once\(([\s\S]*?)\n\}/.exec(effect);
  if (!install) E("V8 install_once is missing");
  else {
    const b = install[1];
    if (!/compose_record_file_with_resolved_principal\(&identity, &principal\)/.test(b))
      E("V8 the installer never composes the record-file policy");
    if (!/apply_and_verify_file\(&record_path, &p\)/.test(b))
      E("V8 the installer never applies the record-file ACL (it relies on inheritance)");
    // Ordering: the ACL is applied AFTER the record is verified and BEFORE the service is started.
    const iVerify = b.indexOf("VerifyIdentityRecord");
    const iAcl = b.indexOf("apply_and_verify_file");
    const iStart = b.indexOf("InstallStep::StartService");
    if (iVerify === -1 || iAcl === -1 || iStart === -1 || !(iVerify < iAcl && iAcl < iStart))
      E("V8 the record-file ACL is not applied after verification and before service activation");

    // ---- V9 MUTATION 5: an ACL failure fails the installation ----
    const step = /let record_acl_outcome = match AclCompositionPlan::production\(\)([\s\S]*?)\n    \};/.exec(b);
    if (!step) E("V9 the record-file ACL step is missing");
    else {
      const s = step[1];
      const returns = (s.match(/return Err\(fail\(\s*InstallStep::ApplyRecordFileAcl/g) || []).length;
      if (returns < 3)
        E(
          "V9 an ACL failure does not fail the installation from every arm (" +
            returns +
            " of 3 refusals return)"
        );
      if (!/Ok\(ApplyOutcome::Confirmed\)/.test(s))
        E("V9 a non-confirmed ACL outcome is accepted as success");
    }
  }

  // ---- V10 MUTATION 6: the repair never rewrites the record ----
  const repair = /pub fn repair_installed_record_file_acl\(([\s\S]*?)\n\}/.exec(effect);
  if (!repair) E("V10 the record-file ACL repair operation is missing");
  else {
    const b = repair[1];
    for (const banned of [
      "fs::write",
      "write_identity_record",
      "OpenOptions",
      "fs::remove_file",
      "fs::rename",
      "hard_link",
      "set_len",
    ]) {
      if (b.includes(banned)) E("V10 the ACL repair writes to the record: " + banned);
    }
    if (!/std::fs::read\(&record_path\)/.test(b))
      E("V10 the ACL repair does not read the record");
    if (!/after == before_bytes/.test(b))
      E("V10 the ACL repair does not prove the record bytes are unchanged");
    if (!/RecordAclRepairOutcome::ReconciliationRequired\(\s*"the record bytes changed during ACL repair"/.test(b))
      E("V10 a record whose bytes changed during repair is not reported");
    if (!/verify_record\(&before, RecordInstallationEvidence::Matched\)\.is_err\(\)/.test(b))
      E("V10 the ACL repair does not require the existing record to verify first");
    // Owner-gated, exact phrase.
    if (!/if approval_phrase != RECORD_ACL_REPAIR_PHRASE/.test(b))
      E("V10 the ACL repair is not gated on the exact owner phrase");
    // It performs no service or directory effect.
    for (const banned of ["CreateServiceW", "adapter.start", "adapter.stop", "create_dir_all", "apply_and_verify(&"]) {
      if (b.includes(banned)) E("V10 the ACL repair performs an unrelated effect: " + banned);
    }
  }
  if (!/pub const RECORD_ACL_REPAIR_PHRASE: &str =/.test(effect))
    E("V10 the repair approval phrase is not a frozen constant");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-record-file-acl-correction1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-record-file-acl-correction1a: PASS");
}
