# PROJECTOSHOST-CONFIGURED-OWNER-RECORD-NTFS-OWNER1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-CONFIGURED-OWNER-RECORD-NTFS-OWNER1A |
| **Parent** | `PROJECTOSHOST-CONFIGURED-OWNER-RECORD-NTFS-OWNER-PREFLIGHT1A` (`74bfe2d`) |
| **Baseline** | `projectos-v3` @ `74bfe2d9cb1b6b3a66cc645487228eddef458ca5` (PREFLIGHT_HEAD) |
| **Decision requested** | **APPROVED TO COMMIT AND PUSH** |

**No real ProgramData change. No real ACL applied. No installer elevation. No owner enrolled. No service start. No pipe work. No registry or credential activity.**

---

## 1. What changed

**Two owner expressions and one validator assertion. Nothing else.**

Implicit `WRITE_DAC` is removed from the configured-owner authority-record path by making **SYSTEM** the NTFS owner of the record and of every ProjectOS-managed ancestor, reusing the existing `AclPrincipal::LocalSystem`. No new SID type, no new ACL policy type, no new descriptor builder, no new subsystem.

---

## 2. Source-first inventory (§C)

**1. Exact record path** — `%KNOWNFOLDER:ProgramData%\ProjectOS\host\installation\identity.v1.json`, from `symbolic_record_location()`.

**2. ProjectOS-managed ancestor chain**, derived in `elevated-installer-composition/src/effect.rs` from the record path:

| Level | Path | In the substitution path? |
|---|---|---|
| `installation_dir` | `…\ProjectOS\host\installation` | **Yes** — the record's immediate parent |
| `host_dir` | `…\ProjectOS\host` | **Yes** |
| `production_root` | `…\ProjectOS` | **Yes** |
| `install_dir` | `%ProgramFiles%\ProjectOS\Host` | **No** — the binary tree, F1 custody, not an ancestor of the record. **Left alone.** |

The installer applies the ACL to `[installation_dir, host_dir, production_root]` deepest-first, using **one** composed policy.

**3. Current expected owner at each level (before this phase)** — record file: `AclPrincipal::CurrentInteractiveUser`. All three ancestors: **the service principal**.

**4. Current DACL at each level** — unchanged by this phase. Record file: service `Read`, `BuiltinAdministrators` `FullControl`, `LocalSystem` `FullControl` when retained. Ancestors: as composed by `assemble`, including the optional interactive read-only ACE. All `D:P`, no broad principal.

**5. Source that sets each owner** — `windows-acl-policy/src/windows.rs`, `SetSecurityInfo(… OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION …)`, invoked through `apply_and_verify` (directories) and `apply_and_verify_file` (record). The owner is written and then re-read and verified, refusing `OwnerMismatch`.

**6. Tests pinning each owner** — `acl_plan.rs` record-file test (updated, see §7); `acl_plan.rs:328` already asserted `LocalSystem` for the LocalSystem-strategy case and is unaffected; `tests/activation_plan.rs:165` asserts the production root's owner is **not** `CurrentInteractiveUser`, which remains true and needed no change.

**7. Validator pinning each owner** — `val-cd-b4-record-file-acl-correction1a` **V6** for the record. **No validator pinned any ancestor's owner** — that gap is now closed by the new V6b.

**Key structural fact:** all three ancestors are composed by the **single shared `assemble` helper** that `compose_with_resolved_principal` delegates to. One expression governs all three, which is why one mutation genuinely proves all three (§F allows exactly this).

---

## 3. Owner changes

| Object | Before | After |
|---|---|---|
| Authority record file | `CurrentInteractiveUser` | **`LocalSystem`** |
| `installation`, `host`, `ProjectOS` (one shared expression) | service principal | **`LocalSystem`** |
| `%ProgramFiles%\ProjectOS\Host` | untouched | untouched |

**Why the ancestors mattered more than the record.** An owner holds implicit `WRITE_DAC`. A service-owned ancestor could re-secure itself, grant itself `DELETE_CHILD`, then delete or replace the record beneath it — bypassing the record's own protected DACL entirely. Correcting only the record file would have left that route open while reading as a completed mitigation.

---

## 4. DACL non-change

`expected_owner` and `allowed` are separate arguments to `AclPolicy::strict`, so **not one ACE, principal or right changed.** Preserved exactly: `LocalSystem` machine-control rights, `BuiltinAdministrators` machine-control rights, the ProjectOSHost service SID's existing bounded access (`Read` on the record), broad principals refused, protected DACL retained. `windows-acl-policy` itself is **unmodified**.

---

## 5. V6 amendment

`val-cd-b4-record-file-acl-correction1a` V6 previously **required** `CurrentInteractiveUser` as the record's owner. It now requires **`LocalSystem`**, and both original prohibitions are **retained, not relaxed**:

- the service must not be the record's owner (kept verbatim);
- an interactive/installing user must not be the record's owner (**new**, the inverse of the old requirement);
- protected DACL, bounded service access and broad-principal refusal assertions untouched.

**New V6b** closes the gap the preflight found: every ProjectOS-managed ancestor must be SYSTEM-owned, asserted against the shared `assemble` helper, and the service must not own an ancestor. No second validator was created — the existing one was the natural home, as §E directed.

This is a **strengthening**: V6 existed to keep implicit `WRITE_DAC` away from the service; it now also keeps it away from every user account, matching the accepted F1 precedent where ownership moved to SYSTEM for exactly this reason.

---

## 6. Tests

`windows-host-activation-plan`: **51 + 31 + 6 = 88**, 0 failed. `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean.

One existing test was **renamed and rewritten** because its name and comment asserted the opposite of the corrected behaviour: `the_installing_owner_is_preserved_rather_than_the_service_made_owner` → **`system_owns_the_record_so_no_user_or_service_holds_implicit_write_dac`**, now asserting `LocalSystem` and additionally asserting the owner is *not* `CurrentInteractiveUser`. Leaving the old name in place would have been a lie in the test suite.

---

## 7. Mutations and killers

| # | Mutation | Killed by |
|---|---|---|
| **M1** | record expected owner `LocalSystem` → `CurrentInteractiveUser` | **V6** (both new assertions fired) **and** the focused record-policy test |
| **M2** | shared ancestor expression `LocalSystem` → service principal | **V6b** (both assertions fired) |

M2 mutates the single `assemble` expression that composes the policy for all three ancestors, so one mutation genuinely proves all three levels — they are not independent expressions.

**Restoration:** both restored byte-identically; `acl_plan.rs` back at `51D5D61AC81BDAF2A0B71481C44574037A4CFA00D5B40F462DAC189ADC1EF713` after each.

**Disclosed friction, for the record:** `cargo fmt` rewrapped my inserted comments and collapsed both `AclPolicy::strict` calls onto single identical lines, so my first two mutation anchors matched zero and two sites respectively. The harness refuses to run unless an anchor matches exactly once, which is what caught it; anchors were retargeted to each expression's unique preceding comment. No mutation was ever counted on a non-match.

---

## 8. Validation

`cargo fmt --check` 0 · `cargo clippy --all-targets -- -D warnings` 0 · activation-plan tests 88/88 · `val-cd-b4-record-file-acl-correction1a` PASS · aggregate **121/121 ALL PASS**, 0 failures · `validate:v3plan`, `validate:secrets`, `validate:reporter` all pass · `git diff --check` clean.

**Pre-existing failure, unchanged by this phase.** `elevated-installer-composition::dry_run` still fails 2 tests with `InsideProductionRoot` — identical tests, identical reason, identical 1-passed/2-failed counts as at baseline. This ownership change **does not alter its result**, so per the gate it was neither fixed nor bundled.

---

## 9. Machine non-interference

`C:\ProgramData\ProjectOS` unchanged (3 entries) · no real ACL applied · no installer elevation · no owner enrolled · service `STOPPED` / `DEMAND_START`, 0 processes · 0 ProjectOS pipes · installed binary `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` at 320,000 bytes unchanged · no registry, credential or provider activity. Source and tests only.

---

## 10. Risks and carry-forward

- **This is a composed-policy correction, not an applied one.** The corrected ownership takes effect only when an elevated installer next applies the ACL. **An already-installed machine keeps its current ownership until then** — and this machine has never had the record written, so nothing on disk is stale.
- **Verification is now stricter.** If a record ever exists whose owner is not SYSTEM, `apply_and_verify*` will refuse with `OwnerMismatch` and fail the installation. That is the intended fail-closed direction, but it means an ACL repair on a pre-existing installation would refuse rather than silently accept.
- **Real enrolment still gated.** No configured owner is enrolled and no real ProgramData authority exists. The remaining prerequisite before that is the owner-gated live enrolment phase, now unblocked on the ownership question.
- Re-enrolment remains carry-forward; the writer's non-replacement rule is untouched.

**F2–F5 OPEN. C4 OPEN. C6 OPEN. C7 OPEN/PROHIBITED. `acceptedPhaseCount` 4/19, 21.1%, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.**

---

## 11. Decision requested

**APPROVED TO COMMIT AND PUSH**
