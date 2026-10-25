# PROJECTOSHOST-CONFIGURED-OWNER-RECORD-NTFS-OWNER-PREFLIGHT1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-CONFIGURED-OWNER-RECORD-NTFS-OWNER-PREFLIGHT1A |
| **Parent** | `PROJECTOSHOST-CONFIGURED-OWNER-ENROLMENT-RECORD1A` (`4224ccc`) |
| **Baseline** | `projectos-v3` @ `4224ccc61496ef7a2c27d6ed2cdcdd9ee506e3ec` |
| **Mode** | READ-ONLY — records only |
| **Decision requested** | **MINIMAL LOCAL-SYSTEM OWNER CORRECTION CONFIRMED — IMPLEMENTATION GATE REQUIRED** |

**No ACL change. No ProgramData write. No service start. No elevation. No pipe security. No schema change. No re-enrolment. Nothing built, nothing run.**

---

## 1. Answer

**Yes — the existing `windows-acl-policy` implementation can do it, and the change is one enum variant.**

`AclPrincipal::LocalSystem` already exists, the expected owner is already both **applied and verified** through the existing code path, and the DACL is a separate argument that need not change at all.

One accepted validator assertion must be narrowly amended — **V6 of `val-cd-b4-record-file-acl-correction1a` currently *requires* `CurrentInteractiveUser`** — and the amendment strengthens the property V6 exists to protect rather than weakening it.

---

## 2. Evidence

### SOURCE-BACKED FACT

- **Record file** — `acl_plan.rs::compose_record_file_with_resolved_principal` ends:
  `AclPolicy::strict(AclPrincipal::CurrentInteractiveUser, allowed)`.
- **State root** — `acl_plan.rs::compose_with_resolved_principal` ends:
  `AclPolicy::strict(service.principal().clone(), allowed)`.
- `AclPrincipal` variants are `LocalSystem`, `BuiltinAdministrators`, `CurrentInteractiveUser`, `ExplicitSid(OwnedSid)`. **`LocalSystem` = `S-1-5-18` is already representable.**
- `CurrentInteractiveUser`'s own doc: *"The account SID of the calling process. Intended for SYNTHETIC TEST FIXTURES; no production service principal is authorised in this phase."*
- The owner is **set, not merely expected**: `windows-acl-policy/src/windows.rs` calls `SetSecurityInfo(… OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION …)`, and `GetNamedSecurityInfoW` reads both back. `verify.rs` then refuses `OwnerMismatch` if the observed owner differs from `policy.expected_owner`.
- The installer applies both policies via `apply_and_verify` (state root) and `apply_and_verify_file` (record file) in `elevated-installer-composition/src/effect.rs`.
- **`val-cd-b4-record-file-acl-correction1a` V6** asserts, on the record-file composition body:
  `if (!/AclPolicy::strict\(\s*AclPrincipal::CurrentInteractiveUser,/.test(body)) E("V6 the record-file policy does not preserve the installing account as owner")`.
- No validator pins the state-root composition's owner argument.
- The record-file DACL is `service = Read`, `BuiltinAdministrators = FullControl`, `LocalSystem = FullControl` when retained, `D:P`, no broad principal.

### INFERENCE

- Because `SetSecurityInfo` is the same call for owner and DACL, changing only the first argument of `AclPolicy::strict` changes only which SID is written as owner. Nothing else in the composition, application or verification path is touched.
- On a real elevated install the "calling process" is the **elevated installer**, so today's owner is the installing administrator's account SID — not necessarily the interactive ProjectOS owner, and not SYSTEM.

### NOT FOUND

- Any place that sets an owner outside `windows-acl-policy`.
- Any validator or test asserting the state root's expected owner.
- Any F1 code path setting SYSTEM ownership — F1's SYSTEM ownership was applied operationally, not through this composition.

---

## 3. The eight questions

**1. Exact current expected owner.** Record file → `CurrentInteractiveUser` (the calling process's account SID). State root and install dir → **the service principal**.

**2. Why `CurrentInteractiveUser` was originally selected.** From V6's own text: to stop the **service** becoming the owner, *"an owner holds implicit `WRITE_DAC`"*. The goal was correct; the chosen means — "preserve the installing account as owner" — kept implicit `WRITE_DAC` with a **user account** instead of removing it from user accounts altogether. The variant it used is additionally documented as intended for synthetic fixtures.

**3. Is `LocalSystem` already representable?** **Yes.** `AclPrincipal::LocalSystem` exists, resolves to `S-1-5-18` as a documented binary well-known SID with no name lookup, and is already used as an allowed principal in this very composition.

**4. Does changing only the expected owner remove the implicit `WRITE_DAC` concern?** **For the record file, yes.** The owner is written by `SetSecurityInfo` and then verified, so SYSTEM becomes the owner and no user account — installer, administrator or configured owner — retains implicit `WRITE_DAC` on the record. It matches the F1 precedent, where ownership was moved to SYSTEM precisely because an owner holds implicit `WRITE_DAC`.

**5. Do service read and SYSTEM/Admin control remain unchanged?** **Yes.** `expected_owner` and `allowed` are separate arguments to `AclPolicy::strict`. The `allowed` vector is untouched: service `Read`, Administrators `FullControl`, LocalSystem `FullControl` when retained, `D:P`, no broad principal.

**6. Does the immediate parent need the same correction?** **Yes, and this is the more serious half of the finding.** The state-root/installation-directory policy makes the **service principal** the owner. An owner holds implicit `WRITE_DAC`, so the service could re-secure its own state directory and grant itself `DELETE_CHILD`, then delete or replace the record file — bypassing the record's own protected DACL entirely. That is exactly the parent-substitution route, and it contradicts V6's stated rationale one level up. It is a **larger blast radius** than the record file: the state-root composition is applied to more objects, and although no validator pins its owner argument, its behaviour is exercised by installer-readiness and composition tests.

**7. Validators and tests requiring amendment.**
- **`val-cd-b4-record-file-acl-correction1a` V6** — the one hard blocker. Its two assertions must be inverted: require `AclPrincipal::LocalSystem` and continue to refuse the service principal as owner. Its header sentence *"the service is NOT made the owner"* should become *"no user or service account is made the owner"*.
- `acl_plan.rs` `record_file_policy_tests` — any test asserting the composed `expected_owner`.
- For the parent correction: `elevated-installer-composition` composition/dry-run tests, and `val-cd-b4-installer-readiness1a` behaviour if it observes the composed policy.
- **Not affected:** `windows-acl-policy` itself (no change needed), the canonical writer, the enrolment record schema, `pipe_security.rs`, B3, F1 custody.

**8. Smallest exact changed-path boundary** for the record-file correction alone:

1. `projectos/host/windows-host-activation-plan/src/acl_plan.rs` — one enum variant in one expression, plus its test expectation
2. `projectos/validators/val-cd-b4-record-file-acl-correction1a.cjs` — V6 amendment
3. one phase report
4. `knowledge/ProjectOS Reports Index.md`

If the parent correction is taken in the same gate, add the state-root expression in the same file and the affected `elevated-installer-composition` tests. **No new crate, no new module, no new SID type, no new ACL subsystem, no manifest and no lockfile change.**

---

## 4. Recommendation

Take the record-file correction and the parent correction **in one implementation gate**, because fixing only the record file leaves the substitution route open through the directory and would read as a completed mitigation when it is not.

Sequenced smallest-first: (a) record file `CurrentInteractiveUser` → `LocalSystem`; (b) state root/installation directory service principal → `LocalSystem`; (c) V6 amended to require SYSTEM ownership and to keep refusing both service and user ownership; (d) mutations proving each direction fails.

**Why this is a strengthening, not a weakening:** V6 exists to keep implicit `WRITE_DAC` away from the service. The amendment keeps that and additionally removes it from every user account, which is strictly stronger and matches the accepted F1 precedent.

---

## 5. Scope, machine state and programme position

Records only: this report and `knowledge/ProjectOS Reports Index.md`. No source, validator, manifest, lockfile, schema, installer, ACL, ProgramData, registry, pipe or service change; no elevation; no re-enrolment; no new ACL subsystem and no new SID type.

Machine unchanged: `STOPPED` / `DEMAND_START`, installed binary `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` at 320,000 bytes, 0 processes, 0 ProjectOS pipes, `C:\ProgramData\ProjectOS` 3 entries unchanged, no credential or provider activity.

**F2–F5 OPEN. C4 OPEN. C6 OPEN. C7 OPEN/PROHIBITED. `acceptedPhaseCount` 4/19, 21.1%, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.** This preflight grants no installation or live-access authority, and the NTFS-owner correction remains a hard prerequisite before any real configured-owner enrolment or real ProgramData authority.

---

## 6. Decision requested

**MINIMAL LOCAL-SYSTEM OWNER CORRECTION CONFIRMED — IMPLEMENTATION GATE REQUIRED**

Two rulings needed with it:

1. **May V6 of `val-cd-b4-record-file-acl-correction1a` be amended** to require `LocalSystem` ownership instead of preserving the installing account?
2. **Does the same gate also correct the parent** (state root / installation directory, currently owned by the service principal), or is that a separate phase? My recommendation is the same gate, for the reason in §4.
