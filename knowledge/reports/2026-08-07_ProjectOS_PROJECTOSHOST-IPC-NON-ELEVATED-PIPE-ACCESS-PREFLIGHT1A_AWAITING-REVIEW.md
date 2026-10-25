# PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS-PREFLIGHT1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS-PREFLIGHT1A |
| **Parent** | `PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A` (`23413c1`) |
| **Baseline** | `projectos-v3` @ `23413c10ec5e4972cd7ce8068319a7c94869c4eb` |
| **Mode** | READ-ONLY security / architecture preflight — records only |
| **Decision requested** | **ACCEPTED ACCESS CONTRACT COLLISION — DO NOT IMPLEMENT** |

**No DACL change. No service change. No installer execution. No live pipe. Nothing built. Nothing run. Service never started.**

---

## 1. Headline

Non-elevated access cannot be implemented under the currently accepted contracts. **Three accepted contracts pin the exact opposite of what Phase 3 requires, two of them enforced by accepted validators**, and the exclusion is deliberate and documented rather than an oversight:

1. `val-windows-local-ipc-capability-b3` **forbids any endpoint name that is not the fixed test prefix** — a production, user-facing pipe name is a validator FAILURE, not a gap.
2. The same validator pins **`nMaxInstances = 1`** plus `FILE_FLAG_FIRST_PIPE_INSTANCE` — a single-instance, one-client endpoint.
3. `ProjectOsHostPipeSecurityPolicy` classifies **`CurrentInteractiveUser` as a BROAD principal**, with `allows_broad()` pinned by `val-host-authority-pipe-security-contract1a` to return **`false` unconditionally**, and the contract admits **no SID and no account-name input at all**, so a per-user ACE is not merely disallowed — it is unrepresentable.

The source comment states the reason in its own words: *"`CurrentInteractiveUser` is included because an interactive user is not a proof peer"*, and the descriptor doc says *"no `INTERACTIVE`, no `OWNER_RIGHTS`"*.

**And the collision is not hypothetical.** The Control Centre already calls this pipe as the non-elevated interactive user — `control-center/src-tauri/src/host_status.rs:152` → `WindowsInstalledHostStatusClient::for_installed_host()`. Under the accepted DACL that read cannot succeed against a running service.

---

## 2. Evidence classification

### SOURCE-BACKED FACT

- The **only** pipe name in the repository is `const ENDPOINT_PREFIX: &str = r"\\.\pipe\ProjectOS.Test.ServiceIdentityProof."` (`windows-local-ipc/src/windows_ffi.rs:71`). Its own doc says *"no caller-supplied name, alternate prefix, or production prefix is representable"*.
- **There is no production endpoint.** The installed service serves its status on that test-prefixed name, via `WindowsInstalledHostStatusServer::for_installed_host()` bound to the frozen `INSTALLED_HOST_STATUS_RUN_ID`.
- b3 asserts the test prefix is **present** and that `/\\\\pipe\\\\ProjectOS(?!\.Test)/` is **absent** — "a production/alternate endpoint prefix is present" is a failure message.
- b3 also asserts `FILE_FLAG_FIRST_PIPE_INSTANCE`, `PIPE_REJECT_REMOTE_CLIENTS`, `nMaxInstances = 1`, `PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED`, that local-ipc consumes the opaque host-authority security object, and that local-ipc contains **no ACL/SDDL builder** (`SetSecurityInfo`, `SetNamedSecurityInfo`, `InitializeAcl`, `AddAccessAllowedAce`, `ConvertStringSecurityDescriptor` all forbidden there).
- The proof-pipe DACL is `D:P` plus one ACE at `PIPE_PROOF_RIGHTS = 0x0012_019F` for exactly the service SID, `SY` and `BA`.
- `PIPE_PROOF_RIGHTS` excludes `WRITE_DAC` (`0x0004_0000`), `WRITE_OWNER` (`0x0008_0000`), `DELETE` (`0x0001_0000`) and `FILE_EXECUTE`, and includes `SYNCHRONIZE`.
- The client requests `FILE_GENERIC_READ | FILE_GENERIC_WRITE` — `0x0012_019F`, **numerically identical** to the granted mask. Client rights are already minimal; nothing to reduce.
- `SECURITY_ATTRIBUTES` are supplied explicitly through a lifetime-bound borrowed lease, with `bInheritHandle: false`. Handle inheritance is off.
- Resolution fails closed: only `Ready` yields a descriptor; every other status yields `None` and the caller **must not** fall back to a broader security. b3 additionally forbids `Everyone`, `AuthenticatedUsers`, `NullDacl` and `default_descriptor` appearing in the local-ipc security decision.
- `host-authority/src/security.rs` already builds a **different** descriptor granting `SY`, `BA`, **`IU` (INTERACTIVE)** and `OW` at `AUTHORITY_DETECTION_RIGHTS` = `SYNCHRONIZE | READ_CONTROL` — "detection rights only", for cross-user authority detection.
- The Control Centre already resolves the **current account SID** via `TokenUser` and builds a protected single-ACE DACL granting `SYNCHRONIZE` to it (`control-center/src-tauri/src/instance/security.rs`, PROJECTOS-WINDOWS-HOST-SINGLE-INSTANCE1A), and states in its own header: *"this is ACCESS CONTROL, not identity"*.
- `TrustedPeerContext` has **no production producer** (established by `23413c1`), so a permitted connection cannot become an authenticated peer today.

### OWNER / GATEKEEPER DECISION

- B3 remains load-bearing; the two closed IPC phases must not be reopened.
- Integrity is non-authorising; C4 is unconditional and first.
- Phase 4 owns session authority; Phase 3 would own connection access only.

### INFERENCE

- **A non-elevated interactive user's `CreateFileW` on the status pipe is denied by the accepted DACL.** This follows directly from the allowlist (service SID, `SY`, `BA`) and the client's requested `0x0012_019F`, but it has **never been observed live**: no phase has started the service while the Control Centre read the pipe. The desktop phase (`4d36eea`) proved only the `STOPPED` → `UNAVAILABLE` correspondence, which is indistinguishable from an access denial at the view layer.
- The `INTERACTIVE` precedent in `security.rs` shows the shape is available, but it was granted **detection rights only**, so it is precedent for the principal, not for read/write data access.

### NOT FOUND

- Any production pipe endpoint name.
- Any installer-recorded owner **user** SID. `canonical-installation-identity-writer` records no user SID, so **Option D has no source authority.**
- Any `S-1-5-4` / `IU` ACE on the proof or status pipe.
- Any multi-instance or per-connection endpoint model.
- Any existing test that proves a non-elevated open succeeds or fails.

---

## 3. Governing validator inventory (§3)

| Path | Governing validators | Historical assertions | Dependent tests | Callers | Accepted invariant | Potential conflict |
|---|---|---|---|---|---|---|
| `host-authority/src/pipe_security.rs` | `val-host-authority-pipe-security-contract1a`, `validate-host-authority-windows-boundary` | B3-SECURITY-PRINCIPAL-CONTRACT1A | `tests/pipe_security_contract.rs`, 4 unit tests | `security.rs`, local-ipc | fixed 3-principal allowlist · `allows_broad()` **unconditionally false** · `is_protected()` true · no SID/SDDL/mask input | **BLOCKING** — interactive user is a *broad* principal; a per-user ACE is unrepresentable |
| `host-authority/src/security.rs` | same | same | `tests/windows_security.rs` | local-ipc via lease | single SDDL→descriptor owner · opaque · fail-closed · "no `INTERACTIVE`, no `OWNER_RIGHTS`" | **BLOCKING** — adding `IU` or a user SID contradicts the pinned descriptor doc and the allowlist |
| `windows-local-ipc/src/windows_ffi.rs` | `val-windows-local-ipc-capability-b3`, b1, `val-projectoshost-ipc-peer-authentication1a` (P10), `val-projectoshost-ipc-kernel-peer-capture1a` (C2) | B3-CAPABILITY | 90/91 lib + 4 integration | `service-host/serve.rs`, Control Centre | fixed **test** prefix present · non-`.Test` prefix **absent** · `nMaxInstances = 1` · first-instance · reject-remote · no ACL builder here | **BLOCKING** — a production user-facing endpoint is an explicit failure |
| `windows-local-ipc/src/security.rs` | b3 §4 | — | — | transport | unresolved fails closed; no weaker fallback; `Everyone`/`AuthenticatedUsers`/`NullDacl`/`default_descriptor` forbidden | compatible — fail-closed is what Phase 3 wants |
| `service-host/src/serve.rs` | `val-cd-b4-projectoshost-service-runtime1a` | CD-B4 | service-host tests | SCM | one pipe, no second pipe, read-only status scope | **CONSTRAINING** — "adds no second pipe" |
| `windows-acl-policy`, `windows-host-activation-plan/acl_plan.rs` | `validate-*-boundary`, `val-cd-b4-installer-readiness1a` | F1 / ACL policy | activation-plan tests | installer chain | never permits Everyone / Authenticated Users / Builtin Users / inherited authority | compatible, and the same prohibition Phase 3 must honour |
| F1 binary custody (`windows-root-custody`, exe/parent ACLs) | F1 records | F1 closure `fc0f45d` | — | — | `D:P`, owner SYSTEM, no user ACE | **must not be touched** — Phase 3 needs no binary ACL change |
| `windows-service-identity-proof` | `3kideb`, `consumer-surface`, `kernel-peer-capture1a` | attempt-scoped capture | canonical 104 | local-ipc | raw identity canonical-side only | compatible — Phase 3 changes access, not identity |
| `operation_contract.rs` | `operation-contract1a` (O6), `peer-authentication1a` (P9), `reconciliation1a` (N7), `kernel-peer-capture1a` (C12) | C4 | reconciliation tests | — | C4 first, unconditional, no effect route | compatible — connection permission is not authorisation |

**Verdict: ACCEPTED ACCESS CONTRACT COLLISION.** Three blocking rows, two of them enforced by accepted validators whose assertions are the literal negation of the requirement.

---

## 4. Current pipe security baseline (§5, from source and API semantics — not defaults)

| Question | Answer |
|---|---|
| Pipe name | `\\.\pipe\ProjectOS.Test.ServiceIdentityProof.` + frozen run id; complete name never leaves the module |
| Who creates it | `windows-local-ipc` `WindowsPipeBackend` via `CreateNamedPipeW`; the installed service drives it from `serve.rs`, one fresh endpoint per iteration |
| Service identity when live | `NT SERVICE\ProjectOSHost` (virtual service account) |
| Default descriptor behaviour | **Not relied on.** Explicit `SECURITY_ATTRIBUTES` are always supplied; when the descriptor cannot be built the endpoint is **not created** |
| Explicit `SECURITY_ATTRIBUTES` | Yes — borrowed, lifetime-bound lease; `nLength` set; `lpSecurityDescriptor` from the opaque owner |
| Inheritance | `bInheritHandle: false`; DACL is `D:P` (protected, no inherited ACEs) |
| Remote clients rejected | **Yes** — `PIPE_REJECT_REMOTE_CLIENTS`, pinned by b3 |
| Server open mode | `PIPE_ACCESS_DUPLEX \| FILE_FLAG_FIRST_PIPE_INSTANCE \| FILE_FLAG_OVERLAPPED` |
| Server pipe mode | `PIPE_TYPE_MESSAGE \| PIPE_READMODE_MESSAGE \| PIPE_WAIT \| PIPE_REJECT_REMOTE_CLIENTS` |
| Client requested rights | `FILE_GENERIC_READ \| FILE_GENERIC_WRITE` = `0x0012_019F` |
| Granted mask | `PIPE_PROOF_RIGHTS` = `0x0012_019F` — identical; neither side is broader than necessary |
| Instances | `nMaxInstances = 1` |
| First-instance protection | **Yes** — `FILE_FLAG_FIRST_PIPE_INSTANCE` |
| Pre-creation / squatting race | **Closed on the server side** by first-instance. Client-side server authentication is **absent** — see §8 |

---

## 5. Intended client population (§6)

| | Principal | Verdict | Why |
|---|---|---|---|
| A | Current interactive owner user | **ALLOW (required, currently DENIED)** | The Control Centre runs as this user, non-elevated, and already calls the pipe. This is the whole purpose of Phase 3 |
| B | Another process, same Windows user | **ALLOW** | Indistinguishable from A at the DACL; a per-user ACE cannot separate processes. Process identity is canonical capture's job, not the DACL's |
| C | Elevated process, same user | **ALLOW** | Already reachable via `BA`. F1 established that an elevated process carries a *filtered* token whose `Administrators` entry is deny-only, so elevation must not be the qualifying condition |
| D | Different local standard user | **DENY** | Multi-user host isolation. This is the decisive argument against `INTERACTIVE` and against `BUILTIN\Users` |
| E | Local administrator, different account | **ALLOW (already, via `BA`)** — **UNRESOLVED whether it should be** | Present in the accepted allowlist. A different admin account is already a machine-level authority, but it is not the owner. Flagged, not silently accepted |
| F | SYSTEM | **ALLOW** | Already `SY`; needed for service-side operation |
| G | `NT SERVICE\ProjectOSHost` | **ALLOW** | Already the service SID; it owns the server end |
| H | Anonymous | **DENY** | No `S-1-5-7` ACE; `D:P` and a protected DACL exclude it. Must remain a validator assertion |
| I | Network / remote caller | **DENY** | `PIPE_REJECT_REMOTE_CLIENTS`, unconditional, regardless of credentials |
| J | AppContainer / low integrity | **DENY** | No low-IL ACE and no `SACL`/mandatory-label grant. Integrity is non-authorising for *identity*, but the OS still gates object access by IL — recorded as out of scope until a source-backed need appears |

**`Authenticated Users` is not treated as equivalent to the intended owner.** It admits every local account including D, and it is on the accepted broad-refusal list.

---

## 6. Access vs identity vs authorisation (§8)

Three separate layers, deliberately not conflated:

- **ACCESS CONTROL** — who may `CreateFileW` the endpoint. The pipe DACL. Coarse, and the only thing Phase 3 would change.
- **IDENTITY AUTHENTICATION** — who actually connected. The canonical attempt's kernel capture. Already accepted and unchanged.
- **AUTHORISATION** — what that peer may do. C4 owner presence plus Phase 4 session authority. Unchanged and still closed.

**Does the DACL need to identify the owner user?** No — and it cannot, under the accepted contract, which admits no SID input. The defensible position is **defence in depth with the coarse gate kept as narrow as the contract permits**: a different local user (D) should be denied at the DACL *if* the model can name the owner, and otherwise refused later by canonical identity and policy. Because there is **no installer-recorded owner SID** (NOT FOUND), naming the owner requires either new installer state or a runtime rule — which is precisely the owner decision this preflight cannot make alone.

---

## 7. Security options (§7)

| | Option | Least privilege | Multi-user isolation | UAC / filtered token | Different-user surface | Squatting | Restart | Installer complexity | User SID availability | Compatible with capture / Phase 4 | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | Service SID + **current interactive user SID** | Best — one exact principal | Strong | Same SID for both token variants, so elevation is irrelevant | Denied at the DACL | unchanged | Descriptor rebuilt per iteration; user SID must be re-resolved | none, if resolved at runtime | Yes | **RECOMMENDED, but requires amending two accepted contracts** |
| B | Service SID + `INTERACTIVE` (`S-1-5-4`) | Weaker — a group, not a principal | **Weak** — every interactive session on the host, including user D | Fine | **Open to D** | unchanged | Simple, stateless | n/a | Yes | Rejected — fails multi-user isolation, and precedent grants `IU` only *detection* rights |
| C | Service SID + `BUILTIN\Users` | Worst | Worst | Fine | Wide open | unchanged | Simple | n/a | Yes | Rejected — on the accepted broad-refusal list |
| D | Installer writes a user-specific ACL or config the service consumes | Good | Strong | Fine | Denied | unchanged | Persistent state to maintain and migrate | **NOT FOUND — no installer-recorded user SID exists** | Yes | Rejected for now — **no source authority**; gate forbids inventing installer-owned identity state |
| E | Keep the DACL as accepted; give the *owner-facing* client a **separate, second endpoint** with its own narrower policy | Good — isolates the proof pipe entirely | Depends on that endpoint's own DACL | Fine | Depends | needs its own first-instance | New endpoint lifecycle | as A | Yes, and it leaves B3 untouched | **Strong alternative** — but `serve.rs` states "no second pipe", and b3 forbids a non-`.Test` name |

**Selected (recommended, contingent on an owner ruling): OPTION A**, restricted to a *runtime-resolved* current-account SID, with the DACL as the coarse gate and canonical capture unchanged as the identity layer.

Even Option A cannot be implemented without amending:
1. `ProjectOsHostPipeSecurityPolicy` — move `CurrentInteractiveUser` out of the broad enum and admit an owner-user principal, which breaks `allows_broad() -> { false }` as pinned.
2. `val-host-authority-pipe-security-contract1a` — the pinned unconditional-false assertion and the "no SID input" property.
3. `val-windows-local-ipc-capability-b3` and/or the endpoint model, if a production-named or multi-instance endpoint is required.

**That is three accepted contracts, two with accepted validators. It is exactly the collision the gate defined, so I am not proceeding.**

---

## 8. Rights, remote access, squatting (§9–§11)

**Rights.** Nothing to reduce: granted `PIPE_PROOF_RIGHTS = 0x0012_019F` and requested `FILE_GENERIC_READ | FILE_GENERIC_WRITE = 0x0012_019F` are identical, exclude `WRITE_DAC`/`WRITE_OWNER`/`DELETE`/`FILE_EXECUTE`, and include `SYNCHRONIZE`. A non-elevated client would need the same mask, not a wider one. `GENERIC_ALL` and `FILE_ALL_ACCESS` (`0x001F_01FF`) are already asserted absent. Server/owner control rights stay with the service SID and `SY`.

**Remote access.** `PIPE_REJECT_REMOTE_CLIENTS` is already set and pinned; it must stay unconditional. It is available on Windows Vista and later, so there is no compatibility concern on this host (Windows 11). No SMB or network pipe use is authorised.

**Squatting / first instance.** `FILE_FLAG_FIRST_PIPE_INSTANCE` with `nMaxInstances = 1` closes the *server-side* race: a second `CreateNamedPipeW` on the same name fails, so the service cannot be shadowed once it holds the instance. Two residual exposures, both recorded rather than fixed here:
- **Client-side server authentication is absent.** If an untrusted process wins the name *before* the service starts, a client would connect to it. The fixed, low-entropy name plus a predictable frozen run id makes that reachable. Mitigations for the implementation gate: `SECURITY_QOS_PRESENT` with `SECURITY_IDENTIFICATION` is not sufficient by itself — the client must verify the *server's* identity (e.g. `GetNamedPipeServerProcessId` plus canonical instance comparison, which the canonical crate can already do), or the endpoint must live under a per-boot high-entropy suffix.
- **Startup ordering and retry.** `serve.rs` recreates the endpoint every iteration with a `200 ms` backoff, so there is a repeated window between `DisconnectNamedPipe`/close and the next `CreateNamedPipeW` in which the name is unowned.

Neither is a Phase 3 *access* decision, and neither pulls Phase 4 authority in — they are endpoint-integrity items for the implementation gate.

---

## 9. Installer requirement (§12)

**No installer change is required, and none is proposed.** The descriptor is built dynamically by the service at pipe creation (Option A above is runtime-resolvable), so machine-persistent security mutation is unnecessary. Explicitly excluded from any implementation: service executable ACL, ProgramData ACL, registry, service DACL, F1 binary custody descriptors. Option D would have required installer state and is rejected for lack of source authority.

---

## 10. Proposed implementation boundary — **NOT AUTHORISED BY THIS PREFLIGHT**

Recorded so a future gate can scope it, contingent on the owner ruling:

- `host-authority/src/pipe_security.rs` — principal model amendment
- `host-authority/src/security.rs` — descriptor/SDDL amendment
- `val-host-authority-pipe-security-contract1a.cjs` — **accepted validator amendment (owner ruling required)**
- possibly `windows-local-ipc/src/windows_ffi.rs` + `val-windows-local-ipc-capability-b3.cjs` — **accepted validator amendment (owner ruling required)** if a production-named or multi-instance endpoint is needed
- one new reconciliation/descriptor validator + `validate-all` registration
- tests/fixtures, one report, one Index row

No canonical identity source change. No `Cargo.toml`/`Cargo.lock`. No installer. No service DACL. No current-state. No crosswalk.

---

## 11. Test plan (§14)

Synthetic descriptor inspection plus disposable local fixture pipes; **never the installed service**.

1. Intended non-elevated user allowed — open a fixture pipe built with the candidate descriptor from a non-elevated context.
2. Service identity allowed where required.
3. Anonymous denied (`S-1-5-7` absent; `D:P`).
4. `Everyone` never granted.
5. Different local user denied — descriptor-level assertion; a live second account is a separate owner-gated proof.
6. Remote client denied — `PIPE_REJECT_REMOTE_CLIENTS` asserted structurally.
7. Insufficient rights fail — request less than the mask and confirm the operation fails.
8. Excess rights absent — `WRITE_DAC`/`WRITE_OWNER`/`DELETE`/`GENERIC_ALL`/`FILE_ALL_ACCESS` bit-tested.
9. Squatting refused — second `CreateNamedPipeW` on the same fixture name fails under first-instance.
10. First-instance semantics asserted on the fixture.
11. Malformed descriptor → fail closed, no endpoint.
12. Descriptor construction failure → **no fallback** to `NULL`/default security.
13. Raw identity still canonical-side (b3 + C2 + P10 restated).
14. C4 remains first hard stop (N7 + P9 + C12).

---

## 12. Mutation plan (§15)

| # | Mutation | Expected killer |
|---|---|---|
| D1 | add `Everyone` access | descriptor validator — broad-principal assertion |
| D2 | add `BUILTIN\Users` when not authorised | principal allowlist assertion |
| D3 | remove remote-client rejection | remote-access assertion (b3 + new validator) |
| D4 | grant `GENERIC_ALL` | least-rights assertion (mask bit test) |
| D5 | fall back to `NULL`/default `SECURITY_ATTRIBUTES` after descriptor failure | fail-closed test + b3 §4 no-weaker-fallback |
| D6 | remove first-instance / squatting protection | squatting assertion (b3 `FILE_FLAG_FIRST_PIPE_INSTANCE`) |
| D7 | move peer identity authentication back into local-ipc | **b3** (plus C2, P10) |
| D8 | allow a successful connection to bypass C4 | N7 + P9 + C12 + behavioural tests |

Each names its killer before implementation, as required.

---

## 13. Live-proof requirement (§16)

Implementation can be accepted on **source + unit tests + security-descriptor inspection + a disposable fixture pipe**, with **no installed-service activity**. A genuine Windows access-token proof — a real non-elevated client opening the real service endpoint, and a real second local user being denied — is a **separate, owner-gated live-proof phase**, because it requires starting the service and creating a second local account. The service was not started in this preflight.

---

## 14. Phase 4 separation (§17) and O6 carry-forward (§18)

Not implemented and not designed here: `ProductionIpcSessionVerifier` wiring, sequence, replay, service epoch, trusted clock, repository authority, phase authority, currentness, protected-operation acceptance. **Connection permission is not identity; identity is not session authority; session authority is not owner approval.**

**O6 carry-forward, recorded only:** `val-projectoshost-ipc-operation-contract1a` O6 checks C4 consultation and ordering rather than unconditionality. No correction is required, because P9 + N7 + C12 + behavioural tests already pin unconditional C4. **O6 is not amended here** and should be amended only if a future validator-coherence phase independently justifies it.

---

## 15. Records boundary and machine state

Exactly two records paths: this report and `knowledge/ProjectOS Reports Index.md`. No source, validator, manifest, lockfile, installer, current-state, crosswalk or existing report touched.

Machine unchanged: `STOPPED` / `DEMAND_START`, installed binary `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` at 320,000 bytes, 0 `ProjectOSHost` processes, 0 ProjectOS pipes, no ACL/DACL, ProgramData or registry change, no credential or provider activity. No SDDL containing user secrets appears in these records.

**F2–F5 OPEN. C4 OPEN. C6 OPEN. C7 OPEN/PROHIBITED. `acceptedPhaseCount` 4/19, 21.1%, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.** This preflight creates no machine or installation authority.

---

## 16. Decision requested

**ACCEPTED ACCESS CONTRACT COLLISION — DO NOT IMPLEMENT**

The owner ruling needed before any Phase 3 implementation gate:

1. **May the accepted pipe-security principal contract be amended** to admit the owner user — moving `CurrentInteractiveUser` out of the broad-refusal set and breaking the pinned `allows_broad() -> false`, and admitting a runtime-resolved SID where the contract currently admits none?
2. **May `val-windows-local-ipc-capability-b3` be amended** to permit a non-`.Test` endpoint name and/or more than one instance — or should Phase 3 instead reuse the existing single-instance test-named endpoint as-is?
3. **Is a different local administrator account (case E) intended to retain access** through the existing `BA` ACE?
4. **Should a different local standard user (case D) be denied at the DACL**, or admitted and refused later by canonical identity and policy?

Also worth an explicit answer, because a shipped feature depends on it: the Control Centre's installed-host status read is, by source, denied by the current DACL against a running service. That has never been observed live — only the `STOPPED` → `UNAVAILABLE` correspondence was proven — so it is reported as a strongly source-backed inference, not as a demonstrated failure.
