# PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A |
| **Parent** | `PROJECTOSHOST-CONFIGURED-OWNER-ENROLMENT-RECORD1A` chain (`4224ccc` → `bda3fce`); preflights `646486a`, `7f5837c` |
| **Baseline** | `projectos-v3` @ `bda3fce0f9cce6ca2f3d135b5fc313a9d1dd7cd1` = `origin/projectos-v3`, 0/0, clean |
| **Gate** | Smallest working extension of the EXISTING IPC security path — no new security architecture |
| **Decision requested** | **APPROVED TO COMMIT AND PUSH** |

**No real `ProjectOS.Host` pipe was created. No service start. No ProgramData write. No ACL mutation. No owner enrolment. No elevation. No registry change. No credential/provider activity. Synthetic SIDs only.**

---

## 1. Headline

The transport now has **exactly one fixed production endpoint, `\\.\pipe\ProjectOS.Host`**, secured by a **four-principal protected DACL**: ProjectOSHost service SID, LocalSystem, Builtin Administrators, and the **EXACT enrolled configured-owner SID** read from the closed canonical installation record. A non-elevated configured owner is admitted **by SID identity, connection access only** (mask `0x0012019F` — no `WRITE_DAC`/`WRITE_OWNER`/`DELETE`). When the owner is absent, unreadable or malformed the production security **fails closed** to a new `ConfiguredOwnerUnavailable` status — there is **no fallback** to `INTERACTIVE`, `CurrentInteractiveUser`, Everyone or the three-principal proof shape.

This resolves the collision the preflight (`646486a`) recorded: B3's test-namespace-only endpoint rule and 3-principal allowlist are **narrowly evolved by owner authority**, not weakened — every broad-principal refusal, the protected-DACL rule, `nMaxInstances = 1`, first-instance, reject-remote and the single-SDDL-owner model are intact and re-proven.

---

## 2. Configured-owner consumption path (frozen reuse, no new abstraction)

`canonical installation record` → `production_canonical_identity()` (host-identity, fail-closed read-only route) → `VerifiedCanonicalInstallation::owner_enrolment()` → `OwnerEnrolment::Enrolled(hex)` → strict lower-case hex decode (bounded ≤ 136 chars) → **structural SID pre-validation** (revision 1, ≤ 15 sub-authorities, exact length — prevents any `IsValidSid` over-read) → the **EXISTING** `ConvertSidToStringSidW` + `SidString` RAII handling in `service_principal.rs`, extracted as `pub(crate) sid_string_from_binary` → defensive `S-1-…` shape check → one ACE in the internally generated production SDDL.

Not created: a `ConfiguredOwnerSid` type, a second SID abstraction, a second record, a second descriptor builder, an ACL framework, a persistence layer, or any username-based authority. `OwnedSecurityDescriptor` remains the single SDDL→descriptor owner (1 conversion call site, validator-pinned).

---

## 3. Exact changed paths (12 + this report + Index)

| Path | Change |
|---|---|
| `host-authority/Cargo.toml` | `windows-pipe-security-runtime` additionally activates the **already-declared** `dep:projectos-host-identity` — the ONLY manifest change |
| `host-authority/src/pipe_security.rs` | `ConfiguredOwner` allow-principal; `production_allowlist()` (exactly 4, DACL order); `ConfiguredOwnerUnavailable` status; `allows()` now answers membership of the closed production set; proof `allowlist()` **unchanged at 3**; tests |
| `host-authority/src/security.rs` | `resolve_production()` (no-arg; owner gate FIRST, then the canonical service resolution); `build_production` + `production_pipe_sddl` (D:P, SY, BA, service SID, owner SID — no IU/WD/BU/AU/OW); owner-enrolment→SID-string conversion; fixture ctor `build_synthetic_production_for_test`; 5 unit proofs |
| `host-authority/src/service_principal.rs` | `pub(crate) sid_string_from_binary` — the existing `ConvertSidToStringSidW`/RAII/shape-validation pattern made reusable; 2 unit proofs |
| `host-authority/tests/pipe_security_contract.rs` | production-allowlist proof, fail-closed status proof, no-arg `resolve_production` fn-pointer visibility (never invoked), synthetic production descriptor build |
| `windows-local-ipc/src/windows_ffi.rs` | `PRODUCTION_ENDPOINT` const; private `EndpointBinding`; binding derived **inside `new()`** from the frozen `INSTALLED_HOST_STATUS_RUN_ID`; production binding demands `resolve_production()`, proof namespace keeps `resolve()`; 3 endpoint proofs |
| `windows-local-ipc/src/lib.rs` | `resolve_installed_host_pipe_security()` one-line gate now reports `resolve_production().0` so `prepare_server` gates on the exact descriptor the transport builds |
| `windows-local-ipc/src/security.rs` | `ConfiguredOwnerUnavailable` added to the existing refusal test list (fail-closed via the accepted wildcard arm) |
| `windows-local-ipc/Cargo.lock`, `service-host/Cargo.lock` | see §5 |
| `validators/val-host-authority-pipe-security-contract1a.cjs` | amendment §7A below |
| `validators/val-windows-local-ipc-capability-b3.cjs` | amendment §7B below |

**Boundary note (disclosed):** `windows-local-ipc/src/lib.rs` and `src/security.rs` are not named in the authorised-areas list but are the same subsystem: the one-line security gate for this exact pipe and one refusal-list test. Without the gate change the service would gate `prepare_server` on the three-principal status while the transport builds the four-principal descriptor. No other subsystem was touched; `serve.rs`, the record schema, enrolment, re-enrolment, Phase-4, owner-presence/C4 and service installation are all untouched.

---

## 4. Why the binding is derived from the frozen run identifier

`val-cd-b4-installed-host-status-contract1a` (an accepted validator NOT in this phase's amendment authority) pins both façades to the literal `WindowsPipeBackend::new(crate::protocol::INSTALLED_HOST_STATUS_RUN_ID)`. A new production constructor would have required amending a third validator — outside authority. So the smallest compliant mechanism is: **inside `new()`**, exactly the frozen installed-host run identifier binds `EndpointBinding::Production`; every other run identifier stays in the retained `ProjectOS.Test.ServiceIdentityProof.<runid>` namespace. No caller supplies a name; no second production endpoint is representable; the nonce derivation is unchanged.

Consequence, disclosed: **the installed-host status exchange IS the production exchange.** The already-installed service binary (built before this change) still serves on the old test-derived name until it is rebuilt and reinstalled under a separately authorised phase — until then the Control Centre client (which will target `ProjectOS.Host` once rebuilt) and the installed binary do not correspond. Nothing in this phase touches the installed machine, so this is a known, stated succession step, not a silent break.

---

## 5. Cargo.lock result (exact cause, disclosed)

Both per-crate lockfiles changed **only** as the direct consequence of the authorised feature activation: the `projectos-host-authority` package entry now lists `projectos-host-identity` as a dependency, and `windows-local-ipc/Cargo.lock` adds the (already-workspace-known) `projectos-host-identity` package block. No version changed, no new external crate entered, `Cargo.lock` was never hand-edited. `host-authority` has no own lockfile (library).

---

## 6. Proportionate proof P1–P12

| # | Behaviour | Proof |
|---|---|---|
| P1 | configured owner exact SID enters production DACL | `production_sddl_grants_exactly_the_four_principals_and_nothing_broad` (exact SDDL equality, synthetic SIDs) |
| P2 | different ordinary user gets no generic access | same test: exactly 4 ACEs, no `WD`/`BU`/`AU`/`IU` token; policy `allows_broad()` still unconditionally false |
| P3 | LocalSystem retained | SDDL `;;;SY` ACE asserted |
| P4 | BuiltinAdministrators retained | SDDL `;;;BA` ACE asserted (machine administrators only — doc states it is NOT owner/presence/session/C4) |
| P5 | service principal retained | SDDL service-SID ACE asserted; canonical resolver reused |
| P6 | broad principals absent | SDDL negative assertions + `every_broad_principal_is_refused` (unchanged) |
| P7 | production endpoint exactly `\\.\pipe\ProjectOS.Host` | `the_production_endpoint_is_exactly_the_fixed_name` (also proves run-id independence of the name) |
| P8 | fixture endpoint remains `ProjectOS.Test…` | `the_test_namespace_is_retained_and_run_scoped` + `only_the_frozen_run_identifier_binds_the_production_endpoint` |
| P9–P11 | `nMaxInstances = 1`, first-instance, reject-remote | unchanged single `CreateNamedPipeW` path; b3 assertions incl. the NEW pipe-mode composition check |
| P12 | missing/invalid owner fails closed | `an_unenrolled_machine_yields_no_configured_owner_and_fails_closed`, `absent_or_malformed_owner_enrolment_fails_closed`, `malformed_binary_sids_fail_closed`, `a_missing_or_invalid_configured_owner_fails_closed`, refusal-list test in local-ipc |

Tests (all 0 failed): host-authority default **45+11+7+9 doc**, runtime-lib **53**, fixtures integration **10+6+6**; windows-local-ipc default **90+11+4**, fixtures **91+11+4**, live features **93+11+4**; service-host **21**. `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` clean on default, runtime and live feature graphs. Live `#[ignore]` proofs were NOT run (machine boundary).

---

## 7. Validator amendments (2 amended, 0 added — settled total stays 121)

**A. `val-host-authority-pipe-security-contract1a`** — evolved narrowly: proof allowlist still exactly the 3 machine principals (ConfiguredOwner explicitly forbidden there); `production_allowlist()` must be exactly the 4 in order; `resolve_production()` must be no-arg (no caller SID); owner must come via `production_canonical_identity()`/`owner_enrolment()`/`OwnerEnrolment::Enrolled`, with `Absent => None`; `ConfiguredOwnerUnavailable` must exist in policy and be the runtime fail-closed status; conversion must reuse `sid_string_from_binary`/`ConvertSidToStringSidW` in `service_principal.rs`; production SDDL must be `D:P` + exactly `SY, BA, service_sid, owner_sid` at `PIPE_PROOF_RIGHTS` with `IU/WD/BU/AU/OW` forbidden; `CurrentInteractiveUser` forbidden anywhere in the runtime layer; runtime feature must activate `dep:projectos-host-identity`; tests must not invoke `resolve()`/`resolve_production()`. All prior assertions retained (broad refusal, protected DACL, single SDDL owner, opaque descriptor, lease lifetime, rights mask, feature split).

**B. `val-windows-local-ipc-capability-b3`** — endpoint rule evolved: the retained test prefix PLUS exactly one `PRODUCTION_ENDPOINT` constant `\\.\pipe\ProjectOS.Host`; every pipe-name token in the transport must be one of the two families; the production binding must be derived from the frozen run identifier; production must demand `resolve_production()`, the proof namespace must keep `resolve()`; **strengthened** `PIPE_REJECT_REMOTE_CLIENTS` from token presence to pipe-mode composition membership (a gap M4b exposed — see §8). Everything else (unsafe confinement, quarantine, admission, handshake order, historical B3 frozen-commit checks) untouched.

---

## 8. Mutations — 6 run, 6 killed, every restore proven byte-identical (SHA-256)

| # | Mutation | Killer(s) |
|---|---|---|
| M1a | owner ACE replaced with generic `IU` (interactive) | unit SDDL test **and** validator A ("forbidden principal token IU") |
| M1b | owner-absent falls back to the 3-principal `resolve()` instead of failing closed | validator A ("runtime layer never fails closed to ConfiguredOwnerUnavailable") |
| M2 | `WD` (Everyone) admitted as a fifth ACE | unit SDDL test **and** validator A |
| M3 | production endpoint silently replaced with the test-derived name | `the_production_endpoint_is_exactly_the_fixed_name` |
| M4a | `FILE_FLAG_FIRST_PIPE_INSTANCE` removed from open mode | validator B (open-mode composition) |
| M4b | `PIPE_REJECT_REMOTE_CLIENTS` removed from pipe mode | **initially SURVIVED** — the accepted check only tested token presence, satisfied by the import line. Validator B was strengthened to composition membership; mutation re-run and killed. Honest note: this closes a real detection gap that predates this phase. |

Restores verified by hash: `security.rs` `0a025ef5…`, `windows_ffi.rs` `226b2207…` identical before and after the mutation cycle; both amended validators PASS on the restored tree.

---

## 9. Honest findings and risks

1. **Pre-existing, baseline-proved:** `cargo test --features test-fixtures` on host-authority fails to COMPILE the lib-test target (`acquire_local_console_authority_for_local_proof` cfg-gated away under windows+test-fixtures; `AuthorityGuard` `_seal`). Proven identical at `bda3fce` via stash. Consequence: the pre-existing `security.rs` fixture-gated unit-test module is compile-dead. This phase's new unit proofs were therefore placed in a `#[cfg(test)]` module that runs under `--features windows-pipe-security-runtime --lib` (53 green) — not in the dead module. Not fixed here (outside boundary); worth its own cleanup phase.
2. **Correspondence gap until reinstall:** §4 — the installed service binary predates the production endpoint; live owner connection cannot succeed until a separately authorised rebuild/reinstall + (still-open) real owner enrolment. This phase makes access *representable and governed*, not *live*.
3. **Admission ≠ authority:** connection access only. Builtin Administrators on the DACL remains machine-administrators-only; no session authority, owner approval, C4 or protected effect was created. `ProductionIpcSessionVerifier`, sequence/replay, service epoch, trusted time, client-side server authentication, Authenticode/SCM mutual auth, re-enrolment: **all carried forward, none implemented.**
4. **`validate-host-authority-windows-boundary`** (not amendable, not amended) already allowlists `projectos-host-identity` as a permitted dependency name; its inline comment says "observer feature only" — now also the runtime feature per this owner authorisation. Comment drift only; the validator passes; noted for the owner rather than silently re-worded.
5. **Windows Home limitation** unchanged: no cross-session/multi-user live proof possible on this machine; P2 is proven at DACL-content level, not by a live second-user connection attempt (which the machine boundary forbids anyway).

---

## 10. Reviews

- **Claude adversarial self-review:** performed (validator-pin sweep across all 15 validators referencing these files; caller inventory of `WindowsPipeBackend::new`; `IsValidSid` OOB analysis leading to structural pre-validation; M4b gap discovery).
- **security-reviewer agent (ECC):** USED — findings §11.
- **code-reviewer agent (ECC):** USED — findings §11.
- rust-reviewer dimensions folded into the two above; build-error-resolver NOT NEEDED (no build failure); tdd-guide AVAILABLE BUT NOT APPLICABLE (proof set fixed by the phase directive); UI UX Pro Max / Flow Motion / Figma NOT APPLICABLE; Provider MCP PROHIBITED and not used; e2e-runner NOT APPLICABLE (no runnable E2E inside the machine boundary).

## 11. Review findings and disposition

**security-reviewer: 0 CRITICAL, 0 HIGH.** Confirmed: no SDDL injection surface (byte-allowlisted SID strings cannot carry SDDL metacharacters, validated twice); `sid_string_from_binary` bounds/alignment/RAII sound, `IsValidSid` cannot over-read (structural pre-validation); no route builds the production endpoint with fewer than 4 principals or the proof endpoint with `resolve_production()`; all SAFETY comments truthful; binding not abusable (no public constructor takes a run id; `EndpointBinding` private, never mutated); Debug/Display redaction intact. Two LOW notes accepted as-is: (a) `decode_owner_sid_hex`'s 136 bound duplicates host-identity's private `OWNER_SID_HEX_MAX` literal — drift would still fail closed either way; (b) no `OWNER_RIGHTS`-suppression ACE on pipe SDDLs — pre-existing accepted design, unchanged, and the pipe's object owner is the trusted service/SYSTEM creating token.

**code-reviewer: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 3 LOW — verdict APPROVE.** Dispositions:
- MEDIUM (validator allowlist-extraction regex matched the return-type bracket and relied on backtracking): **FIXED** — both extractions now anchor on the array literal `&[`. Both validators re-run PASS.
- LOW (stale `create_first_instance` doc line): **FIXED** — doc now names both endpoint families.
- LOW ("in DACL order" claim on `production_allowlist` did not match the builder's ACE order): **FIXED** — doc reworded; all ACEs are allow-only so relative order never changed effective access.
- LOW (SID shape check duplicated at boundaries): **ACCEPTED** — deliberate boundary re-validation, consistent with the crate's existing pattern.

**Mid-validation defect found and fixed (disclosed):** the first full-suite run failed `val-cd-b4-installed-host-status-contract1a` V9 ×3 — its `stripTests` truncates `windows_ffi.rs` at the FIRST `#[cfg(test)] mod *tests`, and the new endpoint-binding test module initially sat mid-file, hiding the status façades from V9. The module was moved to the end of the file with a comment stating why; that validator (unamended) passes again, all tests re-run green, and the definitive full suite was re-run AFTER the fix.

---

## 12. Aggregate validation

- `cargo fmt --check`: clean (both crates).
- `cargo clippy --all-targets -- -D warnings`: clean (default + `windows-pipe-security-runtime` + `windows-live-ipc,owner-approved-status-read`).
- `npm run validate:v3plan`: PASS. `npm run validate:secrets`: PASS. `npm run validate:reporter`: PASS.
- `npm run validate`: **121/121 PASS** (settled total unchanged; 2 amended, 0 added).
- `git diff --check`: clean.

---

## 13. Machine non-interference

`ProjectOSHost` service: `STOPPED` before and after; never started. Live pipe count matching `ProjectOS`: **0** before and after. No `\\.\pipe\ProjectOS.Host` was ever created (the only pipe-creating code paths are feature-gated and, on the production binding, fail closed at `ConfiguredOwnerUnavailable` on this unenrolled machine — proven by unit test, not by running them). No ProgramData, registry, ACL, credential, provider, installer, UAC or enrolment activity. All test SIDs synthetic (`S-1-5-80-0`, `S-1-5-21-2222-3333-4444-1001`).

---

## 14. Programme position

F2/F3 chain advances: the owner-principal source (`4224ccc`) now has its first governed consumer. Still OPEN: real owner enrolment (no caller writes an enrolled record), record NTFS-owner correction follow-through, service rebuild/reinstall, session authority, C4. `acceptedPhaseCount` 4/19, `EXECUTION_READY` false — unchanged by this phase.

---

## 15. Decision requested

**APPROVED TO COMMIT AND PUSH**

(Stop honoured: nothing committed, nothing pushed.)
