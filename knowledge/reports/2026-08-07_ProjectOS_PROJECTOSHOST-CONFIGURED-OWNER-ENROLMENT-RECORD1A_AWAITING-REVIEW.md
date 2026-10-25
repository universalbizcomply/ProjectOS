# PROJECTOSHOST-CONFIGURED-OWNER-ENROLMENT-RECORD1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-CONFIGURED-OWNER-ENROLMENT-RECORD1A |
| **Parent** | `PROJECTOSHOST-IPC-OWNER-PIPE-PRINCIPAL-SOURCE-PREFLIGHT1A` (`7f5837c`) |
| **Baseline** | `projectos-v3` @ `7f5837c2680e2c77aec41a3f8a9f2e4b8f7fb717` |
| **Gate** | SIMPLICITY / SOURCE-FIRST OVERRIDE — smallest governed consolidation |
| **Decision requested** | **APPROVED TO COMMIT AND PUSH** |

**No real ProgramData write. No real ACL change. No live owner enrolment. No service start. No pipe/DACL work. No production action. No re-enrolment.**

---

## 1. Headline

The one canonical installation identity record now carries an **optional, digest-bound configured-owner SID**, and the installer has **one explicit enrolment entry point** beside the existing ownerless one. That is the whole mechanism.

Five source paths, no new subsystem. Version-1 records stay valid, their digests and serialised bytes **unchanged**, and they mean exactly one thing: **owner enrolment ABSENT**.

---

## 2. The simplicity check changed the design three times

Recorded because each removal is a decision, not an omission:

1. **No `ConfiguredOwnerSid` type.** `windows_acl_policy::OwnedSid` already is the accepted opaque SID: bounded to `SECURITY_MAX_SID_SIZE`, validates revision, sub-authority count and exact encoded length, private field, `pub(crate)` byte accessor, `Debug` **and** `Display` redacted.
2. **No new ProgramData security architecture.** `val-cd-b4-record-file-acl-correction1a` **already** pins the record-file DACL — service read-only, SYSTEM and Administrators full control, no broad principal, protected, service not owner, applied by the installer after publish and verify, ACL failure fails the installation.
3. **No sibling record, no second schema family.** The digest already embeds `schema_version`, so version separation needed no new digest domain and no second struct.

**This corrects my own earlier preflight**, which reported *"no record DACL is specified anywhere in source"*. That was wrong — I searched for `ProgramData`/`state_anchor` in the ACL sources and concluded absence; the policy exists under record-file naming with its own accepted validator. The "self-signed claim" risk I raised was therefore **already mitigated** before this phase began.

---

## 3. Exact changed paths (5)

| Path | Change |
|---|---|
| `host-identity/src/identity/canonical_record.rs` | optional `configured_owner_sid`; `RECORD_SCHEMA_VERSION_OWNER_ENROLLED = 2`; digest binding; version/owner agreement; structural SID validation; `OwnerEnrolment`; 7 tests |
| `canonical-installation-identity-writer/src/lib.rs` | `EnrolledOwnerSid::parse`; `write_identity_record_with_enrolled_owner`; shared `write_record`; codec and canonical JSON accept the owner |
| `canonical-installation-identity-writer/src/tests.rs` | 4 proof tests |
| `service-host/src/status.rs` | one struct-literal field in an existing test fixture — compiler-mandated only |
| `projectos/validators/val-projectoshost-configured-owner-enrolment-record1a.cjs` + `validate-all.cjs` | new validator O1–O10, one registration |

**Nothing was added because of the earlier over-scoped prompt.** Not created: a second SID type, a second record/schema family, an enrolment subsystem, a re-enrolment workflow, a ceremony framework, a new persistence layer, `windows-durable-protected-store` usage, any ProgramData or pipe/DACL work. `OwnedSid`, `allows_broad()`, `pipe_security.rs`, `windows-local-ipc` and B3 are untouched. **Zero `Cargo.toml`, zero `Cargo.lock` change.**

---

## 4. Design decisions worth review

**Why the record carries hex, not an `OwnedSid`.** `OwnedSid::as_bytes` is deliberately `pub(crate)`, so a validated SID cannot cross a crate boundary without widening its seal. The record therefore carries the SID's **canonical binary form as lower-case hex** — not a display form, not `S-1-…`, not a name — and the ACL-owning consumer reconstructs the accepted type with `OwnedSid::from_bytes`. One SID type, seal intact, no new dependency.

**Why version-1 digests are untouched.** The digest declares its bound-field count, 7 without an owner and 8 with one, so the two shapes cannot share a pre-image and **every already-installed record verifies exactly as before**.

**Actor is not subject.** `write_identity_record` passes `None` and enrols nobody; only `write_identity_record_with_enrolled_owner` enrols, and only the SID the elevated caller explicitly resolved. The writer resolves no identity itself — no `USERNAME`, `GetUserName`, `TokenUser`, `OpenProcessToken` or `LookupAccountName` appears in it, and V7 of the accepted writer validator still forbids those entropy/name sources.

**Reader validation strengthened mid-phase.** The reader first checked hex shape only, while the writer checked structure; one of my own test cases was shape-valid but structurally impossible. The reader now applies the same rule `OwnedSid::from_bytes` applies — revision 1, sub-authority count ≤ 15, exact length — so it refuses anything the accepted SID type would refuse.

---

## 5. Tests

`host-identity` **77** (70 → 77), `canonical-installation-identity-writer` **20** (16 → 20), `service-host` **21**, all 0 failed. `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean on both changed crates.

Proofs, one per required item: legacy record ⇒ owner absent · enrolled record retains the exact SID · owner SID is digest-bound · adding enrolment does not change an existing V1 digest · malformed SID fails closed · version/owner disagreement never reinterpreted · owner never inferred for a legacy record · installing actor is never automatically the owner · enrolment persists only the resolved SID and no name-shaped field · unresolvable SID fails closed · an existing record is never replaced.

**A deliberate rebaseline, disclosed:** two accepted tests asserted `schema_version = 2 → UnsupportedVersion`. Version 2 is now a supported version of the same family, so those cases were retargeted to versions 3 and 0 and the two new refusals were added. The fail-closed property is unchanged; only the assertion moved.

---

## 6. Mutations — 4 of 4 killed, all restored byte-identically

| # | Mutation | Killed by |
|---|---|---|
| M1 | owner SID removed from the digest | phase validator O3 **and** `the_owner_sid_is_digest_bound` |
| M2 | ordinary installation enrols the elevated actor automatically | phase validator O5 **and** `the_installing_actor_is_never_automatically_the_owner` |
| M3 | ordinary user granted write to the authority record | phase validator O6 **and** the accepted `val-cd-b4-record-file-acl-correction1a` V5 |
| M4 | replacement of an existing record made possible | phase validator O7 **and** the accepted writer validator V5 |

SHA-256 after each: `canonical_record.rs` `C1037232…`, `lib.rs` `AA9F41CB…`, `acl_plan.rs` `D028EB8A…`.

**M2 first failed for the wrong reason and was re-run.** My fake SID hex was 40 characters while its header declared five sub-authorities (56 required), so `EnrolledOwnerSid::parse` refused it and the mutation was **inert** — the validator killed it structurally but the test could not. Corrected to a structurally valid synthetic SID and re-run; both killers then fired. A mutation that fails for the wrong reason is not the test.

---

## 7. Findings carried forward, not fixed here

**A. The authority record's expected NTFS owner is `CurrentInteractiveUser`.** `compose_record_file_with_resolved_principal` ends `AclPolicy::strict(AclPrincipal::CurrentInteractiveUser, allowed)`, and `expected_owner` is enforced as *the observed owner must equal this*. **An NTFS owner holds implicit `WRITE_DAC`**, so on the current accepted policy the interactive user could re-DACL the record and then write it — which would defeat exactly the guarantee an enrolled owner SID depends on.

I did **not** change it: altering the record's ownership model is machine-security work beyond this phase's boundary and belongs to its own gated decision. It also does not block this phase, because nothing enrols a real owner yet. It is stated here rather than buried because it is the single most important thing to settle before a real enrolment is ever written. My earlier preflight's §12 recommendation — that ProjectOS ownership and NTFS discretionary-control ownership must not be conflated — applies directly.

**B. Pre-existing, reproduced at baseline.** `elevated-installer-composition::dry_run` fails 2 tests with `InsideProductionRoot`. Proved pre-existing by stashing all changed files, re-running at `7f5837c` and observing the identical failure, then restoring with an empty stash list and both crates re-verified green. **Not caused by this phase and not fixed in it.**

**C. Re-enrolment remains carry-forward.** The accepted writer cannot replace a record — no `fs::rename`, no `truncate`, no `remove_file` of the final path, exclusive create-new, existing records compared and left intact. Changing an already-enrolled owner therefore needs its own gated decision, and the non-replacement rule was preserved, not weakened.

---

## 8. Machine non-interference

`STOPPED` / `DEMAND_START`, installed binary `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` at 320,000 bytes, 0 processes, 0 ProjectOS pipes, no ACL/DACL, ProgramData or registry change, no credential or provider activity, no owner enrolled, service never started. Every filesystem effect in tests happens inside a disposable directory removed on drop. **Synthetic SIDs only — no real machine account appears in source, tests, report or Index.**

---

## 9. Programme position

**F2–F5 OPEN. C4 OPEN. C6 OPEN. C7 OPEN/PROHIBITED. `acceptedPhaseCount` 4/19, 21.1%, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.** This phase provides a prerequisite mechanism only: it enrols no real owner and authorises no production pipe.

---

## 10. Decision requested

**APPROVED TO COMMIT AND PUSH**
