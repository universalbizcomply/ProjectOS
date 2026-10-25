# PROJECTOSHOST-IPC-OWNER-PIPE-PRINCIPAL-SOURCE-PREFLIGHT1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-OWNER-PIPE-PRINCIPAL-SOURCE-PREFLIGHT1A |
| **Parent** | `PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS-PREFLIGHT1A` (`646486a`) |
| **Baseline** | `projectos-v3` @ `646486a0af839b6d9546372ab838b3392ff5218a` |
| **Mode** | READ-ONLY trust-source preflight — records only |
| **Decision requested** | **OWNER PRINCIPAL SOURCE NOT IMPLEMENTED — PREREQUISITE PHASE REQUIRED** |

**No DACL change. No pipe change. No service start. No installer action. No ProgramData or registry write. No owner-verification ceremony. No credentials. Nothing built, nothing run.**

---

## 1. Headline

**There is no source anywhere in the repository from which ProjectOSHost can obtain a configured ProjectOS owner SID.** The *policy* that consumes one is built and accepted; the *store* that would hold one does not exist.

Three source-backed facts settle it:

1. `windows-owner-verification` **takes the owner SID as a caller-supplied parameter** — `fn live_verify(…, configured_owner_sid: PSID, …)`. It stores nothing.
2. **`live_verify` is `pub(crate)` and has no caller anywhere in the repository.** Its own module doc says so. The live comparison path is unreachable, so nothing has ever supplied that `PSID`.
3. The accepted installation identity record (`InstallationIdentityRecordV1`) holds `schema_version`, `product`, `service_name`, `installation_id`, `channel`, `release_manifest_digest` and `record_digest` — **and no owner, user, account or SID field of any kind.**

The only SID the codebase actually resolves at runtime is the **current account's own** `TokenUser`, in the Control Centre, for its single-instance object DACL. Treating that as the configured owner is precisely the forbidden "currently active console user automatically becomes ProjectOS owner", so it cannot be used.

**Additional finding the gate did not ask for, which I consider the most important one in this report:** the ProgramData record that a future Option C would use has **no specified DACL anywhere in source**. A ProgramData JSON writable by the interactive user would make the "configured owner SID" forgeable by the very principal it is meant to authenticate — turning the whole mechanism into a self-signed claim. See §13.

---

## 2. Evidence classification

### SOURCE-BACKED FACT

- `verification_ffi.rs:222` — `configured_owner_sid: PSID` is a parameter of `live_verify`; `observe_owner_sid(configured_owner_sid: PSID)` compares it with `EqualSid` against the **current process's** token user, entirely inside the gated FFI.
- `verification_ffi.rs:4` — "`live_verify` is `pub(crate)` and has no caller"; confirmed by repository-wide search: the only occurrences are the definition and that doc line.
- `sid.rs` — the policy layer is **booleans only** (`token_query_ok`, `sid_valid`, `equals_configured_owner`); no raw SID crosses into policy or evidence. `sid_permits` is fail-closed, first failing condition wins.
- `val-cd-b4-windows-user-verification-adapter1a` V19 pins `equals_configured_owner` → `OwnerSidMismatch`, so the **policy requirement is accepted and enforced**.
- `host-identity/src/identity/canonical_record.rs` — `RECORD_SCHEMA_VERSION = 1`, digest domain `PROJECTOS:CANONICAL-INSTALLATION-IDENTITY:V1`, record at `…/installation/identity.v1.json`; the struct carries no owner/user/SID field.
- `val-cd-b4-installer-canonical-identity-writer1a` forbids "a second record schema" and "a second digest implementation", and V4 forbids the write API accepting `Path`, `product`, `service`, `schema`, `digest`. The schema is closed.
- `ResolvedProgramDataAnchor::resolve_approved()` exists and is sealed (no caller-supplied path in a production graph); `%KNOWNFOLDER:ProgramData%` is the state anchor.
- `control-center/src-tauri/src/instance/security.rs` resolves the **current account** SID via `OpenProcessToken` + `GetTokenInformation(TokenUser)` + `IsValidSid`, and builds a protected single-ACE DACL granting `SYNCHRONIZE`. Its header states: *"this is ACCESS CONTROL, not identity."*
- `windows-acl-policy/src/descriptor.rs` models an object's `owner: Option<OwnedSid>` — opaque and redacted — for *observing* descriptors, not for configuring an owner principal.
- `windows-owner-verification` is depended on only by `control-center/src-tauri` and `owner-presence-bridge`; **no `host/` service-side crate depends on it.**
- The pipe DACL allowlist remains {`ExpectedServiceSid`, `LocalSystem`, `BuiltinAdministrators`} with `allows_broad()` unconditionally `false` — unchanged by this preflight.

### GATEKEEPER DECISION

- R1 exact configured owner SID only; R2 different standard user denied at the DACL; R3 `BUILTIN\Administrators` retained as machine-admin only; R4 production endpoint required but the name not yet chosen; R5 single instance, first-instance and remote rejection retained.

### INFERENCE

- Because `live_verify` has no caller and no store supplies its `PSID`, the accepted owner-verification chain (configured owner ⇄ owner SID ⇄ session ⇄ Control Centre ⇄ runtime ⇄ IPC ⇄ ceremony) is **broken at its first link**, not merely unwired at the end.
- The installer is the only point in the current architecture that runs elevated and could capture an enrolment decision, which is why Option C is the only surviving candidate.

### NOT FOUND

- Any configured-owner SID store, file, registry value, manifest field or constant.
- Any caller of `live_verify`; any supplier of a `configured_owner_sid`.
- Any owner/user/account/SID field in the installation identity record.
- Any specified DACL for the ProgramData identity record.
- Any service-side (`host/`) dependency on `windows-owner-verification`.
- Any SID migration, re-enrolment or owner-change path.

---

## 3. Governing validator inventory (§4, completed before any option analysis)

| Path | Governing validators | Dependent tests | Public consumers | Accepted invariant | Possible collision |
|---|---|---|---|---|---|
| `windows-owner-verification/src/sid.rs` | `val-cd-b4-windows-user-verification-adapter1a` (V19) | `tests/inert_surface.rs`, unit tests | policy is `pub(crate)` — none | policy is boolean-only; `equals_configured_owner` must yield `OwnerSidMismatch` | none — the requirement is already what we want |
| `windows-owner-verification/src/verification_ffi.rs` | same adapter validator | none (never invoked by tests) | none — `pub(crate)` | live FFI gated, no public entrypoint, no raw SID escape | **none for reading**; a future supplier must not make it public |
| `windows-owner-verification/src/window.rs` | `val-cd-b4-control-centre-window-observation-bridge1a`, `val-cd-b4-sealed-expected-window-facts1a`, adapter validator | window tests | `VerifiedWindowsOwnerEvidence`, `TrustedControlCentreWindowBinding` | neither is caller-constructible by struct literal | none |
| `host-identity/.../canonical_record.rs` | `val-cd-b4-installer-canonical-identity-writer1a`, `-installer-id-source-closeout1b`, `-elevated-installer-composition1a`, `-release-currentness1a`, `-repository-authority-integration1a`, `-operation-phase-binding1a` | writer + composition tests | installer chain, runtime read/verify | **one closed schema, one digest, `RECORD_SCHEMA_VERSION = 1`, no second schema, write API takes no forbidden input** | **BLOCKING for Option C** — adding an owner field is a schema change the validator currently forbids |
| `canonical-installation-identity-writer/src/lib.rs` | same | `src/tests.rs` | `elevated-installer-composition` | installer-only; sealed target; exclusive create-new; no caller path/digest | **CONSTRAINING** — a new field must come through this writer, not a side channel |
| `ResolvedProgramDataAnchor` | `-elevated-installer-composition1a`, `-installer-readiness1a` | dry-run tests | installer | sealed anchor, `%KNOWNFOLDER:ProgramData%` | none — but **no record DACL is specified** (§13) |
| `owner-presence-bridge/src/lib.rs` | `val-cd-b4-owner-presence-capability-bridge1a` | `tests/chain_proof.rs` | `verify_owner_presence_at_control_centre` | grant move-consumed; no capability leaves | none |
| `core/src/owner_presence.rs` | bridge + seam validators | core tests | `verify_owner_presence` | the public verifier is the FIXTURE/CONTRACT verifier, **not production authority** | none — owner **presence**, deliberately separate from owner **identity** |
| `host-authority/src/pipe_security.rs`, `security.rs` | `val-host-authority-pipe-security-contract1a`, `val-windows-local-ipc-capability-b3`, `validate-host-authority-windows-boundary` | `tests/pipe_security_contract.rs`, `windows_security.rs` | local-ipc | fixed 3-principal allowlist; `allows_broad()` unconditionally false; no SID/account input | **BLOCKING for the future amendment** — a 4th principal and a SID input are both currently forbidden |
| `windows-local-ipc/src/windows_ffi.rs` | b3, b1, P10, C2 | 90/91 lib | service-host, Control Centre | test prefix present, non-`.Test` absent, `nMaxInstances = 1` | **BLOCKING for R4** — as already recorded in the parent preflight |
| F1 custody (`windows-root-custody`, exe/parent ACLs) | F1 records | — | — | `D:P`, owner SYSTEM, no user ACE | none — must not be touched |

**No collision is created by this preflight** — it changes nothing. Two blocking rows are pre-existing and already recorded; one new blocking row (the closed record schema) is what makes the prerequisite a *phase* rather than an edit.

---

## 4. Existing owner-identity sources, and what each actually is

| Thing that exists | What it actually holds | Usable as the configured owner SID? |
|---|---|---|
| `OwnerSidObservation` + `sid_permits` | three booleans | No — it *consumes* the answer |
| `observe_owner_sid(PSID)` + `EqualSid` | the comparison mechanism | **The mechanism, yes; the operand, no** |
| `VerifiedWindowsOwnerEvidence`, `TrustedControlCentreWindowBinding` | sealed window/consent evidence | No — evidence of a ceremony, not an enrolled principal |
| `verify_owner_presence` (core) | owner **presence** verdict, fixture-grade | No — presence is not identity |
| Control Centre `CurrentAccountSid` (`TokenUser`) | whoever is running right now | **No — forbidden by §7** |
| `InstallationIdentityRecordV1` | installation id, channel, digests | No — has no owner field |
| `ResolvedProgramDataAnchor` | a sealed protected location | **The location, yes; the content, no** |
| `ProjectOsHostPipeAllowPrincipal` | 3 fixed principals | No — no owner variant, no SID input |

**Configured-owner SID reality: the comparison is built, the location is built, the enrolment and the stored value do not exist.**

---

## 5. Options (§6)

| | Option | Authenticity | Forgeable by an ordinary user? | Persistence | Service-start availability | Verdict |
|---|---|---|---|---|---|---|
| A | An existing protected configured-owner source, consumable read-only | — | — | — | — | **Does not exist. NOT FOUND.** |
| B | Existing owner-verification config holds an exact owner SID; add a sealed adapter | The adapter shape is right and already accepted (boolean policy + FFI-contained `EqualSid`) | n/a | n/a | n/a | **Half-true and therefore rejected as a source**: the adapter exists, the *stored SID* does not. B is a consumer design, not a source |
| C | Installation-time owner SID recorded in protected service configuration | Highest available — captured once, elevated, by the installer | **Only if the record's DACL forbids non-elevated writes — not specified today** | Survives reboot and sign-out; independent of the active session | Available before the pipe is created, from a sealed anchor | **SELECTED as the prerequisite**, conditional on §13 |
| D | Runtime active-console / session discovery | None — "whoever logged in" is not an enrolment | Trivially: log in | n/a | yes | **Rejected — forbidden by §7** |
| E | Client supplies its own SID | None — circular | By definition | n/a | yes | **Rejected — forbidden by §7**; also circular, since the pipe would have to admit the caller first |
| F | Other source-backed design considered: derive the owner from the F1 binary/parent ACL owner | Owner is **SYSTEM** after F1 closure, deliberately | n/a | yes | yes | **Rejected — F1 set the owner to SYSTEM precisely so no user holds implicit `WRITE_DAC`; it encodes custody, not enrolment** |

**Selected source: Option C, as a frozen prerequisite phase — not implementable now.**

---

## 6. Forgery / trust analysis (§13) — the load-bearing requirement

A configured owner SID is only worth anything if the principal it names **cannot write it**. Today:

- The record lives under `%ProgramData%`, whose default ACL grants `CREATOR OWNER` and often `Users` write access to created content on Windows.
- **No source specifies a DACL for the record, its `installation` subdirectory, or the host-state subtree.** `windows-acl-policy` has the machinery (`OwnedSid`, owner + DACL observation, fail-closed refusals) but nothing binds it to this path.
- F1 hardened the **binary and its parents**, not the ProgramData state subtree.

Therefore the prerequisite phase must deliver, and prove, all of:

1. The record subtree is `D:P` (protected, no inherited ACEs).
2. Write access: elevated installer / `SYSTEM` / `Administrators` only. **Not `CREATOR OWNER`, not `Users`, not the owner user.**
3. Read access: sufficient for `NT SERVICE\ProjectOSHost` to read it at pipe-creation time.
4. The record is integrity-bound — the existing `record_digest` over a version-pinned digest domain already gives this shape, provided the owner SID is inside the digested content.
5. Tamper fails **closed**: an unreadable, malformed or digest-mismatched record yields **no descriptor and no pipe**, exactly as `RequiresInstalledServiceProof` does today.

**If the owner user can write that file, the mechanism is a self-signed claim and is strictly worse than admitting `INTERACTIVE`, because it would look authenticated.** That is the single most important thing for the implementation gate to get right.

---

## 7. Account change / re-enrolment (§14)

Windows SIDs are stable for the life of an account, so ordinary renames are safe — a rename does not change the SID, which is exactly why a SID and not a username must be stored. The cases that do need a decision, none of which has any source today (**NOT FOUND**):

- **Account deleted and recreated** — same name, new SID. The stored SID stops matching; the owner is locked out and the DACL denies them. Must fail closed and require re-enrolment, never fall back to name matching.
- **Machine re-imaged / new local account** — same outcome.
- **Domain join or account migration** — SID history exists in AD but must **not** be honoured for enrolment.
- **Deliberate owner transfer** — needs an explicit elevated re-enrolment ceremony; it must never be reachable from the non-elevated side.
- **Multi-session** — the SID is per-account and identical across sessions, so a second session of the *same* account is admitted by the DACL. Distinguishing sessions is canonical capture's job, not the DACL's.

Recommendation: re-enrolment is an **elevated installer/maintenance operation only**, and the frozen sequence should carry it as its own item rather than smuggling it into the pipe work.

---

## 8. Future pipe-security contract (§9) — conceptual only, NOT implemented

Allowlist becomes exactly:

```
ExpectedServiceSid · LocalSystem · BuiltinAdministrators · ConfiguredOwnerSid
```

`ConfiguredOwnerSid` representation: exact; opaque outside the owning authority module; not caller-constructible; no `Display`; redacted `Debug`; no serde; no username conversion; no arbitrary SID setter; and — added here because the parent preflight showed how such rules get tested — **no accessor returning SID bytes or a string, and no `AsRef`/`Borrow`/`Deref`/`From` escape hatch.**

Broad refusals unchanged: `Everyone`, `BuiltinUsers`, `AuthenticatedUsers`, `Guests`, `AnonymousLogon`, `CurrentInteractiveUser`/`INTERACTIVE`. **`allows_broad()` is not changed by this preflight.**

Note for the implementing gate: `CurrentInteractiveUser` must remain in the broad-refusal set even after `ConfiguredOwnerSid` is added. They are different propositions — "the person at the console" versus "the enrolled owner" — and conflating them would re-open exactly what R1 forbids.

---

## 9. Future B3 amendment (§10) — conceptual only, NOT implemented

Test/fixture graph keeps `ProjectOS.Test…`; the live production route gains one fixed `ProjectOS.Host…` endpoint. Requirements carried forward verbatim: test prefix stays test/fixture-only; the production prefix exists only in the live route; no caller-provided name; **no username, SID, project or credential in the pipe name**; `nMaxInstances = 1`; `FILE_FLAG_FIRST_PIPE_INSTANCE`; `PIPE_REJECT_REMOTE_CLIENTS`; fixed frame/nonce/redaction rules.

**Per R4 the exact suffix is deliberately not chosen here.** The consumer inventory that must precede it: `windows-local-ipc/src/windows_ffi.rs` (`ENDPOINT_PREFIX`, `INSTALLED_HOST_STATUS_RUN_ID`), `service-host/src/serve.rs`, `control-center/src-tauri/src/host_status.rs`, `windows-local-ipc/tests/live_installed_host_proof.rs`, and the b3 assertions at both the "prefix present" and "non-`.Test` absent" checks.

---

## 10. Administrator and standard-user policy (§11) — frozen

Configured owner ALLOW · SYSTEM ALLOW · ProjectOSHost service SID ALLOW where self-access requires it · `BUILTIN\Administrators` ALLOW at the machine-admin boundary · different standard user **DENY at the DACL** · anonymous DENY · remote DENY · low integrity DENY / fail closed per Windows token semantics.

**Administrator access is never owner identity.** It proves machine administration only — not ProjectOS owner identity, owner presence, IPC-session authority or C4 approval.

---

## 11. Endpoint-integrity carry-forward (§12)

| Item | Analysis | Belongs to |
|---|---|---|
| A. Client-side authentication of the server | The client must verify it is talking to the real service. Not solvable by a DACL: an ACL controls who may *open*, not who may *listen*. The canonical crate already has the primitive — `GetNamedPipeClientProcessId` plus opaque instance comparison — but it is the *server* observing the client, and the mirror does not exist | **Separate endpoint-integrity phase.** It is not a dependency of the owner-principal source, and it is not Phase 4 session authority either — it is transport trust |
| B. Repeated name-unowned windows during endpoint recreation | `serve.rs` recreates a first-instance endpoint every iteration with a 200 ms backoff, so the fixed name is repeatedly unowned. Mitigation is a lifecycle change (hold the instance, or accept-then-recreate), not an access change | **Phase 3 implementation** — it is created by the same code that would gain the production endpoint, so fixing it later would mean touching that code twice |

Neither is pulled into the owner-principal prerequisite; neither is a direct dependency of it.

---

## 12. Frozen implementation sequence (§13)

| Step | Phase | Why here |
|---|---|---|
| **A** | **OWNER PRINCIPAL SOURCE prerequisite** — record schema V2 (or a sibling record) carrying the enrolled owner SID, written only by the elevated installer, **plus the record subtree DACL and its fail-closed read path** | Nothing downstream can be honest without it. §13's DACL requirement makes this a security phase, not a serialisation change |
| **B** | Pipe-security contract amendment — `ConfiguredOwnerSid` | Depends on A for an operand |
| **C** | B3 endpoint amendment — test endpoint + one fixed production endpoint | Independent of A and B; may run in parallel, but needs the consumer inventory in §9 first |
| **D** | Non-elevated pipe access implementation | Needs A + B, and C if the production name is adopted |
| **E** | Disposable local fixture proof | Proves D without the installed service |
| **F** | Phase 4 — session verifier, correlation, sequence, epoch | Unchanged |

Source did **not** prove a simpler sequence. One deviation from the gate's likely ordering, offered as a recommendation: the **record DACL belongs inside step A**, not deferred, because a record without it is not a trust source at all.

---

## 13. Records boundary, validation, machine state

Exactly two records paths: this report and `knowledge/ProjectOS Reports Index.md`. No source, validator, manifest, lockfile, current-state, crosswalk or existing report touched; no validator registered.

`validate:v3plan`, `validate:secrets`, `validate:reporter` and `npm run validate` all pass — **120/120 ALL PASS, 0 failures** — and `git diff --check` is clean.

Machine unchanged: `STOPPED` / `DEMAND_START`, installed binary `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` at 320,000 bytes, 0 `ProjectOSHost` processes, 0 ProjectOS pipes, no ACL/DACL, ProgramData or registry change, no credential or provider activity, no owner-verification ceremony invoked. Service never started; no pipe created.

**F2–F5 OPEN. C4 OPEN. C6 OPEN. C7 OPEN/PROHIBITED. `acceptedPhaseCount` 4/19, 21.1%, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.** No installation or live-access authority is granted.

---

## 14. Decision requested

**OWNER PRINCIPAL SOURCE NOT IMPLEMENTED — PREREQUISITE PHASE REQUIRED**

Frozen prerequisite: **`PROJECTOSHOST-CONFIGURED-OWNER-ENROLMENT-RECORD1A`** — record the enrolled owner SID in protected service configuration at installation time, with a protected record DACL that the owner user cannot write, and a fail-closed read path for the service. Not started, not authorised by this preflight.

Rulings needed before that phase is gated:

1. **May the closed installation-identity record schema be extended** (V2, or a sibling record under the same sealed anchor) to carry the enrolled owner SID — accepting that `val-cd-b4-installer-canonical-identity-writer1a` currently forbids a second schema?
2. **Is enrolment an installer-time decision** — "the user running the elevated install is the owner" — or must it be a separate explicit ceremony?
3. **Is re-enrolment authorised**, and is it elevated-only? What is the behaviour when the account is deleted and recreated with a new SID: fail closed and lock out until re-enrolment, as I recommend?
4. **Does the prerequisite phase own the ProgramData record DACL**, as I recommend, or is that a separate hardening phase? I record my view plainly: without it the stored owner SID is a self-signed claim and would be worse than the status quo, because it would look authenticated.
