# PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A |
| **Parent** | `PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE-PREFLIGHT1A` (`e205977`) |
| **Baseline** | `projectos-v3` @ `e205977c08abaffcaf5deb9d32c175dd395dd075` |
| **Gate** | PROJECTOS — CANONICAL PEER CAPTURE ATTEMPT-SCOPE AMENDMENT |
| **Architecture** | **ATTEMPT-SCOPED CANONICAL CAPTURE** (the amendment). The earlier returned-contribution design is withdrawn. |
| **Decision requested** | **ACCEPTED — CANONICAL ATTEMPT-SCOPED PEER CAPTURED** |

**No live service execution. No live peer captured. No pipe connected. No credential, provider, DACL, installer or machine action.**

---

## 1. Headline

Kernel peer identity is captured **inside the bounded, ordered, consumable attempt that already owns the instance observations**, is stored privately there, and **never leaves**. There is no returned contribution, no independent lifetime, and no sibling-facing identity type: **this phase adds no public API to the canonical crate at all.**

A consumer learns exactly what every other attempt transition already tells it — the attempt advanced into its next opaque state, or the closed redacted verdict that refused it.

The first implementation returned a sealed `CanonicalPeerContribution` to `windows-local-ipc` for independent reconciliation. **The gatekeeper rejected that design and it is gone.** Everything it carried is now crate-private.

---

## 2. Evidence classification

### SOURCE-BACKED FACT

- Peer capture is an **attempt transition**: `ServiceInstanceBindingAttempt<ScmBeforeObserved>::observe_ipc_peer_identity` (live) → `record_ipc_peer_identity` (portable core) → `AttemptOutcome<IpcPeerObserved>`.
- Re-authentication is an attempt transition too: `reobserve_ipc_peer_identity` → `reconcile_ipc_peer_identity`, comparing the attempt's **own earlier canonical reading**.
- Every peer identity type (`PeerUserBinding`, `PeerSessionBinding`, `PeerPrincipalClass`, `PeerIntegrityEvidence`, `CanonicalPeerContribution`, `PeerContributionOutcome`, `PeerContributionRefusal`) is **`pub(crate)`** and is **named nowhere in `lib.rs`**.
- The canonical crate's **public surface is byte-identical to `e205977`** — the `lib.rs` diff is comments only.
- Bounded private SID storage: `sid: [u8; PEER_SID_MAX_LEN]`, private field, crate-private constructor, **no accessor, no slice view, no `AsRef`/`Borrow`/`Deref`/`Into`/`From`/`Hash`, no serde, no `Display`, redacted `Debug`**.
- Two different users of the same `PeerPrincipalClass` compare **unequal** — `two_different_users_of_the_same_class_remain_distinguishable`.
- Minimum rights only: `PROCESS_QUERY_LIMITED_INFORMATION` for the process, `TOKEN_QUERY` with `openasself = false` for the impersonated **client** token.
- **No manual `CloseHandle` anywhere in `instance_ffi.rs`.** The token handle is adopted into the canonical RAII `OwnedHandle` primitive the instant it exists.
- Impersonation is entered through an RAII guard whose `Drop` calls `RevertToSelf` on every path, the revert **result is recorded**, and reversion is the **first** check in the decision core.
- The impersonation window contains the three token reads and nothing else; the process observation happens **outside** it.
- `Cargo.lock` **unchanged**. Declared feature delta: **`Win32_Security` only**.
- Tests: canonical **98 lib + 5 + 1 = 104**, green on six graphs (default, `consumer-contract`, `test-fixtures`, live, live+fixtures, `--all-features`); `windows-local-ipc` **102 default / 103 fixtures**, unchanged.
- `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` clean on five graphs.
- **K1–K12 and V1–V8 — 20 of 20 killed for their named killers, all restored byte-identically.**
- `val-windows-local-ipc-capability-b3` and `val-cd-b4-binding-consumer-surface1a` **byte-unchanged and PASS**.
- Machine untouched throughout.

### GATEKEEPER DECISION

- **Attempt-scoped capture selected**; the returned-contribution design rejected.
- Bounded private SID storage **authorised** inside canonical opaque equality types only.
- `TOKEN_QUERY` + `OpenAsSelf = false` **authorised** as the exact minimum client-token read.
- `Win32_Security` **authorised** in the canonical manifest.
- Integrity is **non-authorising evidence**; it can neither establish nor invalidate identity.
- `ProductionIpcSessionVerifier` **deferred to Phase 4**.

### INFERENCE

- The impersonation window is argued safe **by structure** — RAII `Drop`, a recorded revert result, and validator assertions forbidding other calls inside it. It is **not** proven by executing an unwind against a live token.
- Minimum-rights claims rest on the Windows documentation for each read, pinned by validator assertion rather than by runtime denial testing.

### NOT PROVEN

- Live service execution; a real live peer capture; non-elevated pipe access.
- Full `ProductionIpcSessionVerifier` integration.
- Replay, sequence or service-epoch currentness.
- Closure of F2 or F3.

---

## 3. What the amendment changed, precisely

| Gate clause | Before (rejected) | Now |
|---|---|---|
| §4 returned contribution | `CanonicalPeerContribution` returned to `windows-local-ipc`, which reconciled it independently | Removed. The type is `pub(crate)`, stored only as a field of `AttemptInner`, and has no lifetime of its own |
| §4 raw entry-point re-export | `pub use instance_ffi::contribute_peer_identity;` in `lib.rs` | Removed. The raw window helper `capture_peer_identity_facts` is a **private** `unsafe fn`; the only public route is an attempt transition |
| §5 owned transition | free function taking a capability and returning an outcome | consumes the owned attempt in `ScmBeforeObserved`, returns `AttemptOutcome<IpcPeerObserved>` |
| §6 private storage | types were `pub` and crossed the crate boundary | all `pub(crate)`, gated to `any(test, all(windows, live))` — a default, consumer-contract or fixture build carries **no identity type, constructor or storage slot at all** |
| §7 RAII | `CloseHandle(token)` | `adopt(token)` → `win32(&owned)` → drop |
| §7 impersonation window | process observation inside the capture function | process observation performed by the transition, **before** the guard is entered |

### The disclosed reduction — please rule on it

`windows-local-ipc/src/lib.rs`, `windows-local-ipc/src/operation_contract.rs` and `val-projectoshost-ipc-peer-authentication1a.cjs` are **restored to their `e205977` blobs byte-identically** (`c3501ef`, `d22e38b`, `cc72f19`).

Reasoning, stated plainly rather than smoothed over: §4 required removing the returned-contribution design from that crate. The alternative to restoring phase 2 was to invent a replacement crossing — but §4 forbids a production caller receiving *an identity observation, an opaque user binding, an opaque session binding, a peer contribution or a reusable identity value*, which leaves nothing meaningful to cross. So phase 2's accepted contract is left exactly as accepted.

**Two consequences I am not entitled to decide alone:**

1. The preflight's finding that phase 2 stores raw SID bytes (`[u8; 68]`) inside `windows-local-ipc` **is not fixed by this phase**. That narrowing needed an explicit owner ruling; this amendment authorised only the 3kideb edit, so I did not take it. It remains open and is carried forward.
2. Phase 2's `PeerAuthenticationError::IntegrityMismatch` — which the preflight argued should be withdrawn — **is still present in `windows-local-ipc`**, because restoring that file restores it. The non-authorising integrity ruling is honoured **canonical-side**, where this phase's code lives: no branch of `decide_peer_contribution` reads integrity, and `identity_matches` deliberately excludes it.

Both are consequences of leaving accepted work untouched, and both are visible rather than buried.

---

## 4. Attempt-scoped architecture

```
ServiceInstanceBindingAttempt<Prepared>
  └─ observe_scm_before(service)                → AttemptOutcome<ScmBeforeObserved>
ServiceInstanceBindingAttempt<ScmBeforeObserved>
  ├─ observe_ipc_peer(pipe, …)                  → AttemptOutcome<IpcPeerObserved>   (accepted, unchanged)
  └─ observe_ipc_peer_identity(cap, pipe, …,    → AttemptOutcome<IpcPeerObserved>   (NEW)
       connection_id, handshake_generation)
ServiceInstanceBindingAttempt<IpcPeerObserved>
  ├─ reobserve_ipc_peer_identity(cap, pipe, …)  → AttemptOutcome<IpcPeerObserved>   (NEW, reconciliation)
  └─ observe_scm_after(service)                 → AttemptOutcome<ScmAfterObserved>
ServiceInstanceBindingAttempt<ScmAfterObserved>
  └─ finalise()                                 → ServiceInstanceBinding
```

The caller supplies: the owned attempt, its borrowed connected pipe handle, the sealed `LiveInstanceObservationCapability`, and the two **host-issued** identifiers. It receives the next opaque state or a closed verdict.

**Ordering is not weakened.** The reconciliation transition is legal only *after* an identity was recorded, cannot skip a step, cannot return to an earlier state, and is strictly stricter than doing nothing because a divergent identity ends the attempt. It is a self-transition, disclosed here for review rather than presented as unremarkable.

**Refusal disclosure is deliberately flat.** `peer_refusal_verdict` collapses all six `PeerContributionRefusal` reasons onto `ServiceInstanceBinding::MissingIpcObservation` through an **exhaustive** match, so a caller cannot probe which token fact was missing, and a future reason cannot join the collapse without someone deciding it should. The platform answer (`Unsupported`) is preserved separately because it is not an identity fact.

---

## 5. Private opaque identity

| Property | Where enforced |
|---|---|
| private field, no `pub` | 3kideb 8j, C7 |
| crate-private constructor, no public one | 3kideb 8j, V2 |
| construction only inside its own constructor | 3kideb 8j (struct-literal count) |
| no accessor / slice / `-> &[u8]` | 3kideb 8j, C7, V1 |
| no `AsRef`/`Borrow`/`Deref`/`Into`/`From`/`Hash`/`Display` | 3kideb 8j |
| no serde | 3kideb 8c/8j, C7 |
| redacted hand-written `Debug` | 3kideb 8j, C7, test `a_recorded_peer_identity_is_never_rendered` |
| never re-exported | 3kideb 8j, C10 |
| never reachable from the fixture graph | 3kideb 8j, C10 |
| two same-class users compare unequal | test + C8 + V8 |

`PeerPrincipalClass` is a **fail-closed gate**, not stored: an unclassifiable principal refuses the capture, and the class never stands in for exact identity.

`PeerIntegrityEvidence` **is** recorded and is consulted by nothing. The field carries a single `#[allow(dead_code)]` with a comment saying exactly that — outside this crate's own tests it is a value the code writes and never acts on, which is what "can neither establish nor invalidate identity" means in practice. **The lint allowance is the compiler-checked proof, and removing it would only be possible by giving integrity authority over some decision.** This is disclosed rather than hidden because a lint allowance normally deserves suspicion.

---

## 6. Handles and impersonation

```
1. impersonate (ImpersonateNamedPipeClient, RAII guard entered)
2. OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, false, …)
3. adopt(token) → OwnedHandle
4. three read-only GetTokenInformation queries (TokenUser, TokenSessionId, TokenIntegrityLevel)
5. OwnedHandle drops → token closed
6. guard drops → RevertToSelf, result recorded
7. reversion checked FIRST, then classify / store / advance
```

Reversion occurs on success, ordinary error, early return, token-read failure and unwind, because it is a `Drop`. **Prohibited and absent:** `PROCESS_ALL_ACCESS`, `PROCESS_VM_READ`, `TOKEN_ALL_ACCESS`, `TOKEN_DUPLICATE`, `TOKEN_IMPERSONATE`, `TOKEN_ASSIGN_PRIMARY`, `TOKEN_ADJUST_PRIVILEGES`, `SeDebugPrivilege`, `AdjustTokenPrivileges`, `DuplicateToken(Ex)`, `SetThreadToken`, `CreateProcessAsUser`, `OpenProcessToken`, `ImpersonateLoggedOnUser`, and any manual `CloseHandle`.

---

## 7. 3KIDEB amendment accounting

Two amendments, both narrow, both authorised by §8.

**A — byte storage.** The blanket byte-array-field ban now excises *exactly one* declaration — `sid: [u8; PEER_SID_MAX_LEN]` — and then runs the **original rule unchanged** over everything else. A second byte-array field, or the same field under a different type, still fails. The excised type's opacity is proven separately in a new section 8j (11 distinct assertions).

**B — access rights.** The blanket `GetTokenInformation` ban is replaced by exact least-rights checks: `TOKEN_QUERY` must be the only access mask, `OpenAsSelf` must be `false`, impersonation must be entered through the pipe under an RAII guard whose `Drop` reverts, and the raw capture helper must remain private. `OpenProcessToken` stays banned.

**Kept hard, unchanged:** manual `CloseHandle`, public re-export of raw observation entry points, a caller receiving stored identity, an attempt returning a reusable contribution, handle escape, observation bypassing the attempt, typestate ordering, PID/creation-time equality, fixture/live separation.

**History preserved:** section 8h-bis (the frozen Contract1B commit `fb284a6`) is **untouched**. No historical source is rewritten as though it contained token capture.

---

## 8. Mutation matrices — 20 of 20 killed and restored

Each mutation is an exact single-anchor replacement; the harness refuses to run if the anchor is not found exactly once, and restores the original bytes in a `finally` block, then verifies restoration by SHA-256.

### K1–K12 (re-run in full against the new architecture)

| # | Mutation | Killed by |
|---|---|---|
| K1 | raw identity capture moved into `windows-local-ipc` | b3 (`windows FFI outside windows_ffi.rs`, `token/SID-lookup API`) + C2 |
| K2 | process-creation binding removed from exact-identity comparison | C8, 3kideb 8j, test `a_reused_pid_with_a_different_creation_identity_is_refused` |
| K3 | token rights widened to `TOKEN_ALL_ACCESS` | C3, 3kideb 8B |
| K4 | process rights widened to `PROCESS_ALL_ACCESS` | C3, 3kideb |
| K5 | token handle escapes RAII, closed manually | C6, 3kideb (`closes a handle manually instead of via RAII`) |
| K6 | guaranteed reversion `Drop` removed | C4a, 3kideb 8B |
| K7 | raw SID accessor exposed | C7, 3kideb 8j |
| K8 | recorded identity made publicly constructible | C10, 3kideb 8j |
| K9 | fixture feature enabled in the default graph | C10 |
| K10 | authenticated peer allowed to bypass C4 | C12 **and** phase 2's P9 |
| K11 | non-token work inside the impersonation window | C5 |
| K12 | classification consults something other than the user SID | C8 |

### V1–V8 (targeted proofs of the amended 3kideb branches)

| # | Mutation | Killed by (3kideb) |
|---|---|---|
| V1 | opaque SID exposed through an accessor | `an opaque identity value has a readable accessor` |
| V2 | opaque identity constructor made public | `an opaque binding has a public constructor` |
| V3 | `TOKEN_QUERY` widened to `TOKEN_DUPLICATE` | `the token is opened with more than TOKEN_QUERY` |
| V4 | `OpenAsSelf` set to `true` | `not opened with TOKEN_QUERY and OpenAsSelf=false` |
| V5 | RAII token adoption replaced by manual `CloseHandle` | `closes a handle manually instead of via RAII` |
| V6 | raw capture entry point publicly re-exported | `raw observation entry points are re-exported` |
| V7 | attempt returns its stored identity | `a public function returns a stored peer identity or a reusable contribution` |
| V8 | same-class different users allowed to compare equal | `exact-identity comparison no longer compares user` + test failure |

**Restoration proof.** After all 20 mutations the working files are back at their pre-mutation SHA-256:

```
25F8F80CFFFDA414CB655455DE3B0DAC7FBFB6666B203C0724DEAA1AC70012A3  src/instance.rs
209EFA85FC6001BA629474866EFFD62EAE892F7118A2440A7F2F51D69CE4DE35  src/instance_ffi.rs
C9A722D693D79338FD7AE9F5AD4349477A31E24B370A76A1DCE272355DD95280  src/lib.rs
1177F9CE27301F0182EE5469404C51D23229DAD1F52756ABA906B60AEC09B32C  Cargo.toml
4A760CCBAB04B4333B427F842D2DE83E6235399CAAB9E2A69DA2B991F2FF9362  windows-local-ipc/src/operation_contract.rs
```

**Disclosed:** K8's mutation also trips C1's exact-string presence check, not only C10's intended assertion. That is a second guard firing, not a substitute for the first — C10's own message (`CanonicalPeerContribution is publicly declared`) is present. K1 and K10 mutate files that are otherwise at their `e205977` blobs; both killers are textual validators, so no compile was required, and both files were restored byte-identically.

---

## 9. Phase-4 session verifier, C4 and the effect boundary

`ProductionIpcSessionVerifier` remains **deferred to Phase 4** by the prior ruling. This phase mints no `ProductionIpcSessionAuthority`, fabricates no project/environment/repository/phase authority, claims no sequence, replay, epoch or trusted-time currentness, and returns no competing verifier result. Attempt-scoped peer identity is **capture evidence, not IPC-session authority**.

**C4 remains the unconditional first hard stop.** `evaluate_protected_operation` checks the owner-presence gate first and unconditionally; no accepted, completed or effect route exists. Pinned by C12 and by phase 2's P9, and K10 is killed by both.

The whole capture chain is still **unreachable in any build**: every entry point demands `LiveInstanceObservationCapability`, which has no constructor in any graph or feature. Compiling the capture is not authority to run it.

---

## 10. Machine non-interference

| Fact | Value |
|---|---|
| Service state | `STOPPED` |
| Start type | `DEMAND_START` |
| Start name | `NT SERVICE\ProjectOSHost` |
| Installed binary | `C:\Program Files\ProjectOS\host\ProjectOSHost.exe` |
| SHA-256 | `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` |
| Size | 320,000 bytes |
| `ProjectOSHost` processes | 0 |
| ProjectOS pipes | 0 |
| Service DACL / F1 descriptors | unchanged |
| ProgramData | unchanged |
| Credential / provider activity | none |

Service never started. No live pipe connected. Installed binary not replaced. All builds went to an isolated target root outside the repository.

---

## 11. Path boundary

Committed paths (content changes):

1. `projectos/host/windows-service-identity-proof/Cargo.toml`
2. `projectos/host/windows-service-identity-proof/src/instance.rs`
3. `projectos/host/windows-service-identity-proof/src/instance_ffi.rs`
4. `projectos/host/windows-service-identity-proof/src/lib.rs` *(comments only)*
5. `projectos/validators/val-windows-service-identity-proof-3kideb.cjs` *(authorised amendment)*
6. `projectos/validators/val-projectoshost-ipc-kernel-peer-capture1a.cjs` *(new)*
7. `projectos/validators/validate-all.cjs` *(one registration)*
8. `knowledge/reports/2026-08-06_…_KERNEL-PEER-CAPTURE1A_AWAITING-REVIEW.md` *(this file)*
9. `knowledge/ProjectOS Reports Index.md` *(one row)*

Within the authorised boundary and **narrower than it**: three of the eleven reconciled paths were restored to HEAD and therefore carry no change.

Not modified: `val-windows-local-ipc-capability-b3.cjs`, `val-cd-b4-binding-consumer-surface1a.cjs`, `windows-local-ipc/src/windows_ffi.rs`, installer, service DACL, current-state, crosswalk, existing reports, `Cargo.lock`.

---

## 12. Carried forward, not implemented

- **Narrowing phase 2's `windows-local-ipc` identity representation** (raw SID bytes, `IntegrityMismatch`) — needs its own owner ruling.
- `ProductionIpcSessionVerifier` integration — **Phase 4**.
- Live proof of a real peer capture — **Phase 5**.
- `PROJECTOS-VALIDATOR-LINE-ENDINGS-HARDENING1A` — repository `.gitattributes` and LF/CRLF fixture testing. It blocks nothing, but it cost time again this session: with `core.autocrlf=true` and no `.gitattributes`, a file restored to its exact HEAD **blob** still reports as modified in `git status` because the working bytes are LF where a checkout would write CRLF.
- Phase 3 non-elevated DACL/installer; F4 DPAPI; F5 durable ledger.

**F2 and F3 remain OPEN. C4 OPEN. C6 OPEN. C7 OPEN/PROHIBITED. `acceptedPhaseCount` unchanged at 4/19.**

---

## 13. Decision requested

**ACCEPTED — CANONICAL ATTEMPT-SCOPED PEER CAPTURED**
