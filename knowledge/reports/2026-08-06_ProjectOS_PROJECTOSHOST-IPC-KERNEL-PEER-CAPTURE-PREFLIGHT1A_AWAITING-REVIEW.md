# PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE-PREFLIGHT1A — AWAITING REVIEW

**READ-ONLY ARCHITECTURE PREFLIGHT. RECORDS-ONLY COMMIT. NO IPC OR MACHINE IMPLEMENTATION.**

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE-PREFLIGHT1A |
| **Parent** | `PROJECTOSHOST-IPC-PEER-AUTHENTICATION1A` (`772c49b`) |
| **Baseline** | `projectos-v3` @ `772c49b8f5ee79f5d4a70660f42f47488c685f35` |
| **Decision requested** | see §28 |

No Rust source, no manifest, no lockfile, no validator, no DACL, no ACL, no service action, no pipe connection, no credential, no provider.

---

## 1. Headline

The architecture is **already largely built and accepted** — but not where phase 2 put it.

Three source-backed facts decide this preflight:

1. **The canonical crate already performs the exact process capture required**, on a borrowed handle, with RAII cleanup and a before/after re-read. `GetNamedPipeClientProcessId`, `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` and `GetProcessTimes` all live in `windows-service-identity-proof/src/instance_ffi.rs` today.
2. **`ServiceInstanceToken` is already the opaque identity primitive** the design needs: PID **plus** creation time, `Clone/Copy/PartialEq/Eq`, no accessors, crate-private constructor, *"never accepted from a caller"*.
3. **`projectos-host-core/src/ipc_session.rs` already models the peer reconciliation** — `IpcPeerObservation` → sealed `IpcSessionVerifier` → `BoundIpcSession`, carrying `connection_id`, `handshake_generation`, `client_pid`, `client_creation_tick` and a **bounded `PeerUserClass`**, whose own doc says *"never a raw SID/token"*.

The gap is narrow: **no token facts are captured**, and **no route exists to contribute a peer authentication result** into `windows-local-ipc`.

**And a conflict must be reported.** Phase 2 introduced `TokenUserSid` (raw SID bytes) and a raw Windows `session_id` into `windows-local-ipc`. Two accepted contracts say those must not exist there. This preflight recommends the implementation phase reconcile that, and §14 selects an architecture that does.

---

## 2. Evidence classification

Every material statement below is tagged **[FACT]** (source-backed), **[DECISION]** (owner/gatekeeper), **[INFERENCE]**, or **[NOT FOUND]**.

---

## 3. Repository and remote baseline

**[FACT]** Local HEAD, `origin/projectos-v3` and the expected head are all `772c49b8f5ee79f5d4a70660f42f47488c685f35`. Ahead/behind **0/0**. Working tree clean (0 entries) at the start of this preflight.

---

## 4. Source review performed

Read: `windows-service-identity-proof/src/{lib,instance,instance_ffi,evidence,classify}.rs` and its `Cargo.toml`; `windows-local-ipc/src/{operation_contract,windows_ffi,adapter,protocol,lib}.rs` and its `Cargo.toml`; `core/src/ipc_session.rs`; `val-windows-local-ipc-capability-b3.cjs`; `val-cd-b4-binding-consumer-surface1a.cjs`; the accepted IPC trust-boundary preflight, operation-contract and peer-authentication reports; the Reports Index; repository history at `772c49b`.

Searched for every term the gate listed: `observe_ipc_peer`, `contribute_ipc_peer`, `GetNamedPipeClientProcessId`, `ImpersonateNamedPipeClient`, `OpenThreadToken`, `GetTokenInformation`, `RevertToSelf`, `OpenProcess`, `GetProcessTimes`, process creation time, token user SID, session ID, integrity level, handle ownership, raw identity, sealed evidence, attempt lifecycle, connection ID, handshake generation.

---

## 5. Current canonical identity ownership

**[FACT]** `instance_ffi.rs` is gated `#![cfg(all(windows, feature = "windows-live-instance-observation"))]`, is the crate's only `unsafe`, and states its own rule:

> *"Both observations are performed HERE, in the canonical owning crate, rather than in the sibling crates that own the pipe and the SCM handle. A sibling that could hand over a process ID and a creation time could forge the identity, so the sibling supplies only its live handle and this module reads Windows itself."*

**[FACT]** It already reads, for a pipe peer: client PID (before), process open, creation time, client PID (after). `decide_pipe_peer` — a portable, Windows-free core — decides every refusal.

**[FACT]** Output containment: *"No raw process ID, creation time, handle or Win32 error leaves this module: the closed `ServiceInstanceObservation` is the entire output."*

**[FACT]** Every entry point demands the sealed `LiveInstanceObservationCapability`, which *"has no constructor in any build or feature"*.

**[NOT FOUND]** No token read of any kind in the canonical crate: no `ImpersonateNamedPipeClient`, no `OpenThreadToken`, no `GetTokenInformation`, no `RevertToSelf`, no session or integrity read. **This is the entire implementation gap.**

---

## 6. Pipe-handle ownership and lending

**[FACT]** `windows-local-ipc` owns the pipe. `WindowsPipeBackend::server: RefCell<Option<OwnedHandle>>`; `contribute_ipc_peer` takes `let borrowed = self.server.borrow()`, extracts the raw `HANDLE`, and its SAFETY note records that *"the `borrowed` guard keeps the owning `OwnedHandle` alive for the whole call, and the callee only reads through it and never retains or closes it."*

**[FACT]** The canonical side matches: `observe_named_pipe_peer_instance` is `unsafe fn` whose contract is *"`pipe` must be a valid named-pipe SERVER handle that the caller keeps open for this call."*

**[INFERENCE]** Answers to §5 Q5–Q9: the **lending model already exists and needs no change**. Ownership stays with `windows-local-ipc`; the handle is borrowed for the duration of one synchronous call; use-after-close is prevented by the `RefCell` borrow outliving the call. **No duplication is required**, and duplication should be explicitly rejected — it would create a second lifetime to reason about for no gain.

**[FACT]** Process handles opened inside the canonical crate are adopted into the RAII `OwnedHandle` primitive (`adopt`), closing *"deterministically on every path including early return"*.

---

## 7. Impersonation and reversion model — the new work

**[NOT FOUND]** No impersonation exists anywhere in the repository today.

**[INFERENCE]** Answers to §5 Q10–Q13. Impersonation must occur **inside `instance_ffi.rs`**, because it is the only place permitted to read identity. The model proven in phase 2 (then deleted) is sound and should be re-established there:

- An **RAII guard** whose `Drop` calls `RevertToSelf` — covering success, ordinary error, early return, token-read failure and unwind alike. `Drop` is the only construct that covers all five.
- The revert **result recorded, not discarded**, and folded into the facts struct so `decide_pipe_peer` refuses on it. Verification must be independent of the code that performed the revert.
- **Nothing but the token reads inside the window** — no file, registry, credential, provider or effect work, and no pipe I/O. This is enforceable by a validator listing the banned calls, exactly as phase 2's P10 did.

**[INFERENCE]** The reversion outcome must be a **new fact in `PipePeerFacts`** with its refusal decided by the portable `decide_pipe_peer` core, not by the gathering code — matching the module's existing discipline that *"Anything the sequence does not reach stays unestablished, so the core's ordering — not this gathering code — decides the exact refusal."*

---

## 8. Process and token rights

**[FACT]** `PROCESS_QUERY_LIMITED_INFORMATION` is already in use and already justified in-source as *"the least-privileged right that satisfies the call; no elevation is attempted and `SeDebugPrivilege` is never requested."*

**[INFERENCE]** `TOKEN_QUERY` is the minimum for `TokenUser`, `TokenSessionId` and `TokenIntegrityLevel`. `OpenThreadToken` must pass `openasself = false` so the **client's** token is opened under the impersonated context, not the service's — phase 2 proved this distinction is mutation-detectable (its M7 flipped that flag and was caught).

**[FACT / DECISION carried forward]** Filtered and deny-only administrator tokens: F1 established that an elevated process on this machine carries a filtered token whose `Administrators` entry is `SE_GROUP_USE_FOR_DENY_ONLY`. Classification must therefore use the **token user SID alone**, never group membership, so elevation cannot promote an ordinary user.

**[INFERENCE]** Unknown SID or integrity forms must fail closed to a bounded refusal, never round to a neighbouring value.

---

## 9. PID and process-creation binding

**[FACT]** Already solved and already opaque. `ServiceInstanceToken` holds *"the observed process ID PLUS the observed process creation time; neither is readable. The only permitted operation is equality against another token"*, and its constructor *"Fails closed when either component is absent: a zero process ID is never valid, and a missing creation time must never degrade to a process-ID-only identity."*

**[FACT]** `process_creation_time` is documented as *"what defeats process-ID reuse; a wall-clock reading, a service start checkpoint or an elapsed proof duration would not."*

**[INFERENCE]** No new PID/creation design is required. The implementation phase reuses this primitive unchanged.

---

## 10. Raw identity containment — the constraint that decides the architecture

**[FACT]** The canonical crate's own accepted contract:

> *"Raw identity is unrepresentable. No public field can carry a username, service-account name, machine name, SID (string or bytes), token/session/logon identifier, credential, ACL or arbitrary diagnostic string. All evidence is tri-state or a closed enum."*

**[FACT]** `val-cd-b4-binding-consumer-surface1a` enforces it, failing on *"a raw identity accessor is public"*, on `Serialize|Deserialize|serde` in `instance.rs`, and on a public `windows_ffi` module or a glob re-export of one.

**[FACT]** `core::PeerUserClass` is documented as *"A bounded classification of the connected peer's user identity (**never a raw SID/token**)."*

**[FACT]** The canonical crate's contract also states: *"**Integrity is non-authorising.** `NonAuthorisingIntegrity` is structurally excluded from every confirmation path: it can neither establish nor invalidate identity, SID, readiness or authority."*

**Conclusion [INFERENCE]:** the canonical crate **may not return** a raw SID, a raw Windows session identifier, or an authorising integrity value. Whatever crosses into `windows-local-ipc` must be **opaque, bounded, or both**.

---

## 11. CONFLICT FOUND — phase 2's identity representation

**[FACT]** Phase 2 (`772c49b`, this repository, accepted) added to `windows-local-ipc/src/operation_contract.rs`: `TokenUserSid` carrying **raw SID bytes** (`[u8; 68]`), a raw Windows `session_id: u32`, and an `IntegrityLevel` whose mismatch **refuses** re-authentication (`IntegrityMismatch`).

**[FACT]** Three accepted statements are in tension with that:

| Source | Statement |
|---|---|
| `windows-local-ipc/Cargo.toml` | the crate *"cannot represent any raw username, SID, machine name, session or credential"* |
| `windows-service-identity-proof/src/lib.rs` | raw identity is unrepresentable; no SID string **or bytes**, no *"token/session/logon identifier"* |
| same | integrity *"can neither establish **nor invalidate** identity"* |

**[FACT, stated so this is not overclaimed]** The `windows-local-ipc` description is stamped `…CAPABILITY-B1` and is **demonstrably stale in other respects** — it also says the crate *"performs NO Windows call… no windows dependency"* and `#![forbid(unsafe_code)]`, all of which B3 superseded when it added the live backend. So that clause is **evidence of intent, not a live enforced rule**.

**[FACT]** The canonical crate's clause is **not** stale — it references the B4 cross-source binding work and is enforced by a passing validator.

**[INFERENCE]** Phase 2's representation was **wider than necessary**. Reconciliation needs **equality**, not readability: `reauthenticate_peer` only ever compares SID/session/integrity for equality; only classification interprets a SID, and classification already has a bounded home (`PeerUserClass`). An opaque comparable value satisfies every accepted test while carrying no raw identity.

**Disclosed against my own earlier work.** Phase 2's frozen module list named `core/ipc_session.rs`, and I took a **disclosed reduction** not to use it, reasoning that minting `TrustedPeerContext` from another crate would force its constructor `pub` and destroy the seal. That reasoning was sound *for the trusted context*, but I did not check whether `core` already solved the **evidence-carrying** problem. It did — `IpcPeerObservation` → sealed verifier → `BoundIpcSession` — and my reduction produced a duplicate, wider identity model. The frozen list was pointing at the right file.

---

## 12. Sealed contribution options

| Option | Shape | Verdict |
|---|---|---|
| **A** | canonical returns one opaque sealed peer contribution | **Insufficient alone.** If truly opaque, `windows-local-ipc` cannot classify or compare per the accepted rules; if readable enough to do so, it breaches §10. |
| **B** | canonical captures, then invokes a restricted verifier callback | **Rejected.** Raw identity is *lent* into a closure owned by the other crate — reversing the "sibling never sees identity" rule, and creating a re-entrancy surface inside an impersonation window. |
| **C** | canonical attempt owns capture **and** authentication, returning only a sealed `TrustedPeerContext`-equivalent | **Rejected as stated.** It would move the accepted `authenticate_peer` semantics into the canonical crate — a redesign of a contract §1 forbids reopening. |
| **D** | **canonical captures and classifies; bounded values cross; core's existing sealed verifier reconciles** | **SELECTED** — see §13. |

---

## 13. SELECTED ARCHITECTURE — Option D

**The canonical crate captures and classifies. Only bounded, non-raw values cross. Reconciliation uses the sealed machinery that already exists in `core`.**

1. **Capture stays canonical.** `instance_ffi.rs` extends its existing pipe-peer observation to also, under an RAII impersonation guard, read `TokenUser`, `TokenSessionId` and `TokenIntegrityLevel` from the client token. The pipe handle continues to be *lent*, never transferred or duplicated.
2. **Classification happens where the SID lives.** The SID is reduced **inside the canonical crate** to the existing bounded `core::PeerUserClass`. Raw SID bytes never leave that module — satisfying §10 and b3 simultaneously.
3. **The process pair stays opaque.** `ServiceInstanceToken` is reused unchanged: equality-only, no accessors, crate-private constructor.
4. **What crosses is minimal:** the opaque instance token, the bounded `PeerUserClass`, the host's own `connection_id` and `handshake_generation`, and a **bounded, non-authorising** integrity classification. No SID bytes. No raw Windows session. No token or process handle.
5. **Reconciliation reuses `core`.** `windows-local-ipc` assembles a `core::IpcPeerObservation` and mints a `BoundIpcSession` through the sealed `ProductionIpcSessionVerifier`, which **already** enforces handshake-confirmed, `pid != 0`, `creation_tick != 0`, connection match, generation match and liveness.
6. **Windows session ≠ ProjectOS session.** `core::IpcPeerObservation.session` is a bounded `SessionId` string validated by `validate_bounded_id`, not a Windows logon session. The Windows session must **not** be smuggled into it.

**Why this satisfies every invariant of §7 of the gate:** `windows-local-ipc` calls no banned API (1); the canonical crate remains the only raw reader (2); caller payload never reaches capture because the canonical module reads Windows itself (3); handle ownership is unchanged and unambiguous (4); reversion is guarded and verified in the portable core (5–7); PID is bound to creation time by the existing token (8); nothing raw escapes (9); executable identity is still absent (10); fixtures stay behind non-default features (11); C4 is untouched and still first (12–13); no secret crosses (14).

**Required adjustment, answering §5 Q21–Q22.** Phase 2's `TokenUserSid`, raw `session_id` and refusing `IntegrityLevel` must be **narrowed to bounded forms**. This is a *narrowing* of an accepted contract, not a redesign of its semantics: every accepted refusal — process-creation mismatch, user mismatch, session mismatch, connection mismatch, generation mismatch, unknown class, C4-open — survives, because each is an equality or classification test. **The production-inert constructor is preserved**: the evidence type keeps private fields, the module seal, and a constructor gated to `cfg(test)` or the non-default fixture graph. The `IntegrityMismatch` refusal should be **withdrawn** rather than narrowed, because the canonical contract holds that integrity can neither establish nor invalidate identity; integrity is retained as recorded, non-authorising evidence only.

**[NOT FOUND]** No source supports keeping raw SID bytes in `windows-local-ipc`. **[INFERENCE]** Retaining them would leave two identity models and one unenforced prose rule — the precise condition that produced the b3 breach in phase 2.

---

## 14. Failure and lifetime model

Answering §5 Q23–Q27.

- **Process exits during token capture** — the existing before/after PID re-read already refuses via `PeerChangedDuringObservation` / `ConnectionClosedDuringObservation`. The token read sits **between** the two reads, so an exit during it is caught.
- **PID, creation identity or token evidence changes between reads** — refused. `ServiceInstanceToken` cannot be built from a mismatched pair.
- **Handle escape** — structurally prevented: the token handle is opened, read and closed inside one function whose return type is a bounded value; process handles are RAII-adopted. Both are validator-assertable.
- **Stale evidence surviving a connection or handshake change** — refused by `core::mint`, which requires the observation, the confirmed handshake **and** the verifier to name the same connection and generation.
- **Which currentness belongs where** — capture-time coherence (process stability, reversion, classification) belongs to **this** phase. Sequence numbers, replay windows and service-epoch currentness belong to **Phase 4** and must not be pulled forward.

---

## 15. B3 non-regression

**[FACT]** `val-windows-local-ipc-capability-b3.cjs` bans `GetTokenInformation` crate-wide and `GetNamedPipeClientProcessId` / `GetNamedPipeServerProcessId` / `GetProcessTimes` / `OpenProcess` / `ServiceInstanceToken {` / `from_observed_parts` in `windows_ffi.rs`, and positively requires `attempt.observe_ipc_peer(` — *"this crate does not delegate peer observation to the canonical owner"*.

**[INFERENCE]** Option D **strengthens** compliance: all new Windows calls land in the canonical crate, `windows-local-ipc` continues to delegate through `observe_ipc_peer`, and the phase-2 validator's P10 (which restates the ban locally) continues to hold. The implementation phase must leave `val-windows-local-ipc-capability-b3.cjs` unmodified and passing.

---

## 16. FROZEN IMPLEMENTATION PHASE — `PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A`

**Objective.** Capture the client token's user, session and integrity inside the canonical identity-proof crate under a guaranteed-reverting impersonation guard; classify the user SID to a bounded `PeerUserClass` without the SID leaving that crate; contribute the result to `windows-local-ipc` as bounded values only; narrow phase 2's identity representation accordingly.

**Exact source modules.**

| Path | Change |
|---|---|
| `windows-service-identity-proof/src/instance_ffi.rs` | impersonation guard; token user/session/integrity reads; SID → bounded class |
| `windows-service-identity-proof/src/instance.rs` | new `PipePeerFacts` fields; refusal variants; ordering in `decide_pipe_peer` |
| `windows-service-identity-proof/src/lib.rs` | compiler-mandated re-export only |
| `windows-local-ipc/src/operation_contract.rs` | narrow to bounded forms; withdraw `IntegrityMismatch` |
| `windows-local-ipc/src/windows_ffi.rs` | contribution plumbing only — **no Windows identity call** |
| `windows-local-ipc/src/lib.rs` | compiler-mandated re-export only |

**Compiler-mandated wiring** is limited to `mod`/`pub use` lines and must be disclosed in the report, as in phases 1 and 2.

**MANIFEST CHANGE IS REQUIRED — [FACT], confirmed, not deferred.** The canonical crate's `windows` dependency enables only `Win32_Foundation`, `Win32_System_Pipes`, `Win32_System_Services` and `Win32_System_Threading`. **`Win32_Security` is absent**, and it supplies `GetTokenInformation`, `RevertToSelf`, `TOKEN_QUERY`, `TOKEN_USER`, `TOKEN_MANDATORY_LABEL` and the SID sub-authority helpers. (`ImpersonateNamedPipeClient` is in `Win32_System_Pipes` and `OpenThreadToken` in `Win32_System_Threading`, both already enabled.)

This is not a formality. The manifest carries a deliberate accepted statement beside that list:

> *"No token, SID-lookup, registry, ACL or network feature — the process is opened for query rights alone."*

So the implementation phase **must** add one `windows` feature **and** amend that comment. Every phase to date has been able to promise "no `Cargo.toml` change"; this one cannot. **It needs explicit authorisation in the implementation gate**, and the amended comment must state precisely what the crate now reads and under which capability gate.

**Validators.** Amend the phase-2 validator to follow the narrowed types; add a new validator asserting canonical-side capture, reversion guarantee, no-work-in-window, minimum rights, no handle escape and no raw identity accessor. Do **not** modify `val-windows-local-ipc-capability-b3.cjs` or `val-cd-b4-binding-consumer-surface1a.cjs`. Expected aggregate: **118 → 119**.

**Report boundary:** one report + one Index row. **Commit subject:** `feat(host): capture kernel peer identity in the canonical crate`.

**Prohibited:** DACL change; installer change; non-elevated access; sequence/replay/epoch enforcement; F4/F5; C4/C6/C7 change; credential; provider; production, database, deployment, send or payment activity.

**Machine proof:** none required. **[INFERENCE]** Live service execution is **not** needed — the capability gating `LiveInstanceObservationCapability` has no constructor in any build, so the live path cannot be reached even deliberately. A live proof belongs to Phase 5.

---

## 17. Test matrix (defined before implementation)

Coherent canonical capture · PID and creation-time coherence · process exit during capture · token user/session/integrity capture · filtered-token behaviour (elevation does not change class) · unknown SID form refused · unknown integrity form refused · guaranteed reversion on success, error, early return and unwind · reversion failure refuses · no work during impersonation · token handle closed · process handle RAII-closed · no raw identity accessor · sealed contribution construction · connection and handshake binding · stale evidence refused across a generation change · C4-open rejection unchanged · b3 validator compatibility.

---

## 18. Mutation matrix (each with its named killer)

| # | Mutation | Named killer |
|---|---|---|
| K1 | move raw identity reading back into `windows-local-ipc` | `val-windows-local-ipc-capability-b3` + phase-2 P10 |
| K2 | omit the process creation-time check | PID-reuse test + `ServiceInstanceToken` fail-closed test |
| K3 | widen token rights beyond `TOKEN_QUERY` | new validator minimum-rights assertion |
| K4 | widen process rights beyond `PROCESS_QUERY_LIMITED_INFORMATION` | same |
| K5 | allow a token or process handle to escape | handle-escape assertion + return-type assertion |
| K6 | remove the guaranteed reversion (drop the `Drop` impl) | reversion assertion + unwind test |
| K7 | expose a raw SID or token accessor | `val-cd-b4-binding-consumer-surface1a` (*"a raw identity accessor is public"*) |
| K8 | make the sealed contribution publicly constructible | constructor-sealing assertion |
| K9 | allow fixture construction in the default graph | feature-separation assertion |
| K10 | permit authenticated capture to bypass C4 | `an_authenticated_peer_still_cannot_pass_c4` + phase-2 P9 |
| K11 | perform file/registry work inside the impersonation window | no-work-in-window assertion |
| K12 | classify by group membership instead of user SID | filtered-token test |

Every mutation must fail **for its named reason**, and be restored byte-identically against a pre-taken baseline.

---

## 19. Phase 3–5 and F4/F5 separation

Phase 3 (non-elevated DACL and installer access), Phase 4 (live correlation, sequence, service epoch), Phase 5 (integrated synthetic proof), F4 (service-owned DPAPI) and F5 (durable consumed-grant ledger) remain **separate and untouched**. None is started, designed or implied here.

---

## 20. CRLF tooling carry-forward

**`PROJECTOS-VALIDATOR-LINE-ENDINGS-HARDENING1A`** — recorded only, **not implemented**. May later assess bare-newline assumptions across validators, LF/CRLF fixture testing, and a repository `.gitattributes`. It does **not** block this preflight or the kernel-capture implementation.

Context: phase 2 corrected one such defect under explicit authority; `core.autocrlf=true` with no `.gitattributes` means a committed blob materialises as CRLF after checkout and LF after a formatter pass, and both hash identically — so any `\n`-anchored validator can flip on a difference Git does not track. **Others may be latent.**

---

## 21. Machine non-interference

`ProjectOSHost`: `STOPPED` / `DEMAND_START`. Installed binary SHA-256 `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` — unchanged. **0** processes, **0** ProjectOS pipes. No service or file ACL change, no ProgramData or registry mutation, no credential, no provider activity. Service not started; no live pipe connected. Nothing was built or run.

---

## 22. F2–F5 and C4–C7 status

F2 **OPEN** · F3 **OPEN** · F4 **OPEN** · F5 **OPEN**. C4 **OPEN** · C6 **OPEN** · C7 **OPEN / PROHIBITED**. `acceptedPhaseCount` **4/19** · `EXECUTION_READY` **false** · `installationAuthority` **NotAuthorised**. This preflight closes nothing and authorises no implementation.

---

## 23. Decision requested

**PREFLIGHT ACCEPTED — CANONICAL KERNEL CAPTURE IMPLEMENTATION GATE REQUIRED**

Two items need an explicit owner ruling in that gate, because both touch previously accepted work:

1. **Narrowing phase 2's identity representation** — replacing raw SID bytes and the raw Windows session with bounded forms, and withdrawing `IntegrityMismatch`. §13 argues this is a narrowing that preserves every accepted refusal, but it edits an accepted contract and should not proceed on my judgement alone.
2. **A `Cargo.toml` feature addition** in the canonical crate — confirmed necessary, not conditional. `Win32_Security` is absent and must be added, and the manifest's accepted *"No token, SID-lookup… feature"* comment must be amended to match. No prior phase has needed a manifest change.
