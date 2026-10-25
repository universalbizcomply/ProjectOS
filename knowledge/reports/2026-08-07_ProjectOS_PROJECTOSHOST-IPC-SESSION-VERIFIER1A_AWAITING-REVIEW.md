# PROJECTOSHOST-IPC-SESSION-VERIFIER1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-SESSION-VERIFIER1A |
| **Parent** | `PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A` (`80fc2f9`) |
| **Baseline** | `projectos-v3` @ `80fc2f9c9370c2e5d35b57dfdd472165b7e55d84` = origin, 0/0, clean, 0 tags |
| **Gate** | A1 LOCAL IMPLEMENTATION + SYNTHETIC PROOF |
| **Decision requested** | **APPROVED TO COMMIT AND PUSH** |

**No `ProjectOS.Host` pipe. No service start. No owner enrolment. No ProgramData/ACL/registry mutation. No production authority activation. No protected effect. Synthetic identities only (opaque selectors, no SID/token/handle anywhere in the diff).**

---

## 1. FACT — the required transition already exists in current source

The frozen objective (accepted connection + canonical kernel peer evidence + host-issued connection identity + handshake generation + current verified runtime + trusted authority time → sealed `ProductionIpcSessionVerifier` → `BoundIpcSession`) is **already implemented end-to-end** by the accepted architecture:

- **Sealed verifier + mint** — `core/src/ipc_session.rs`: sealed `IpcSessionVerifier`, crate-private `mint`, opaque `BoundIpcSession` with `is_current`/`matches_peer`/`matches_channel`/`permits_*`. Mint checks, in order: confirmed handshake (single-use, move-consumed) → bounded ids → non-zero peer → **connection correlation** (observation = verifier) → **generation equality** (evidence AND observation = verifier) → liveness → capability/family bounds → window validity → expiry → window bound → staleness → **runtime currentness**. `is_current` re-checks runtime generation+digest, provider identity, provider epoch, connection, generation, liveness, expiry.
- **Production verifier route** — `provider_authority.rs`: `ConfirmedAuthorityGuard` → `open_provider_authority` → one-shot `ProviderAuthorityLease` → `into_provider_capabilities` (re-checks provider/epoch/regression/expiry) → `ProviderCapabilitySet::ipc()` borrows `ProductionIpcSessionVerifier` (`new_internal` crate-private; ids process-unique, high-bit, never caller-selectable). Fixture route `for_local_proof()` test-gated.
- **Canonical kernel peer evidence** — `windows-service-identity-proof` attempt typestate: host-issued connection_id + handshake_generation recorded inside the sealed `CanonicalPeerContribution`; identity NEVER leaves the attempt; `finalise` yields only the closed `ServiceInstanceBinding`; reconciliation refuses substitution/restart.
- **Windows projection** — `windows-local-ipc/src/observation.rs`: `ConfirmedSameConnectionIpcPeerEvidence` (requires the unforgeable `ConfirmedIpcPeerHandshake`, move-consumed) → `into_core_evidence()` → both projections carry the SAME connection id + generation, re-checked by the sealed verifier at mint.
- **Trusted time / runtime / epoch** — `VerifiedAuthorityTime` (provider id + epoch + monotonic reading; no wall clock), `VerifiedRuntimeInstance` (generation + digest + valid_until).

**Existing generation/epoch mechanisms are SUFFICIENT (report question 2): NO new sequence number, epoch, replay ledger, counter, verifier, identity type or state primitive was needed, and none was created.** A11 satisfied by construction. The "NEW SESSION STATE PRIMITIVE" stop condition was never reached.

---

## 2. IMPLEMENTATION — exactly two changed paths (+ report + Index row)

| Path | Change |
|---|---|
| `core/tests/ipc_session_authority.rs` | +3 focused MINT-level tests: `sv1_expired_runtime_instance_refuses_mint` (`RuntimeNotCurrent` — previously asserted NOWHERE for the IPC mint), `sv2_invalid_proof_window_refuses_mint` (`ProofWindowInvalid` — previously untested), `sv3_already_expired_observation_refuses_mint` (`Expired` at mint — previously only `is_current`-level i20) |
| `windows-local-ipc/src/observation.rs` | +1 fixture test `level2_canonical_peer_capture_and_session_refuse_substituted_and_stale_peers` inside the EXISTING `#[cfg(all(test, feature = "test-fixtures"))]` module: **two independent, parallel proofs of the same threat model** — canonical attempt Match on a stable opaque instance, **peer substitution → `Mismatch`**, **incarnation restart (pid-reuse model) → `Mismatch`**; and, separately, the sealed-verifier-minted session refuses a substituted peer process, a pid-reused instance AND a reconnected verifier. The comment states explicitly that the two layers share no data here — wiring the canonical verdict INTO minting is the live-adapter phase's work |

Zero production source changes. Zero `Cargo.toml`. Zero `Cargo.lock`. Zero Windows API. Zero new crate/dependency. Zero validator changes (no existing validator amended, no new validator — every invariant this phase proves is owned by `val-cd-b4-ipc-session-authority1a` / `val-cd-b4-production-ipc-provider1a` / `val-cd-b4-provider-authority-seam1a`, all untouched and PASS). Registered validator total **unchanged: 121**.

Closed phases untouched: pipe_security, production DACL, endpoint naming, configured-owner record, enrolment, windows-acl-policy, installer, ProgramData policy, Control Centre, reducer, permit, effect-grant, ledger, protected-effect adapter, kernel peer capture source.

---

## 3. PROOF — acceptance matrix mapped (reuse first, additions only where missing)

| Row | Proof (existing reused unless marked NEW) |
|---|---|
| A1 same connection | core i1/i4; production provider i1; Level-2 end-to-end |
| A2 wrong connection refused | mint: production i11; currentness: i5 (different verifier), i6 (reconnect); Level-2 reconnect refusal |
| A3 stale handshake generation refused | mint: production i11 (wrong evidence generation); currentness: i7 (`advance_handshake`) |
| A4 runtime restart invalidates | i8 (`rv.restart()` → `RuntimeInstanceMismatch`); **NEW sv1** (expired runtime refuses mint) |
| A5 provider epoch change invalidates | i10, production i4b (`ProviderEpochMismatch`); provider-substitution i9/i3 |
| A6 expired/stale time refused | i20 (currentness), production i9 (staleness at mint), i23/i10 (window bound); **NEW sv2, sv3** (mint-level window/expiry) |
| A7 peer substitution / stale instance refused | **NEW parallel-layers test**: canonical attempt `Mismatch` on substitution AND on incarnation restart; session `matches_peer` refuses substituted pid and pid-reuse, `is_current` refuses a reconnected verifier; existing production i7/i8 + core i11_i12 retained |
| A8 evidence cannot self-mint | `val-cd-b4-production-ipc-provider1a` compile probes + `val-cd-b4-ipc-session-authority1a` (mint crate-private, sealed trait, no From/serde/Default) — unchanged, PASS |
| A9 fixture not in default live graph | same validators (feature-propagation checks) + default-graph builds green |
| A10 C4 unchanged | owner-presence sources/tests/validators untouched; `val-cd-b4-*owner-presence*` PASS; no change anywhere near the gate |
| A11 no second sequence/epoch model | zero source diff — nothing added to duplicate |
| A12 pipe access/DACL/endpoint unchanged | zero diff in those files; `val-windows-local-ipc-capability-b3` + `val-host-authority-pipe-security-contract1a` PASS unchanged |

Tests all 0 failed: core fixtures **full graph green** (ipc_session_authority 22→**25**, production_ipc_provider 13, runtime_ipc_permit_integration 30, plus all other suites), core default 21 suites, windows-local-ipc fixtures **92** lib (+11+4; both Level-2 tests), windows-local-ipc default 90+11+4, windows-service-identity-proof 98+5+1. `cargo fmt --check` and `clippy --all-targets -D warnings` clean (core + local-ipc, default and fixture graphs).

---

## 4. Mutations — 10 runs across M1–M5, 10 killed, restoration hash-proven

All mutations in `core/src/ipc_session.rs`; independent checks mutated independently as required.

| # | Mutation (check disabled) | Killer |
|---|---|---|
| M1a | mint connection correlation | production i11 |
| M1b | `is_current` connection equality | i5 + i6 |
| M2a | mint generation equality (evidence + observation) | production i11 |
| M2b | `is_current` generation equality | i7 |
| M3a | `is_current` runtime generation/digest | i8 |
| M3b | `is_current` provider epoch | i10 **and** production i4b |
| M3c | mint runtime currentness (`valid_until`) | **NEW sv1** |
| M4a | `is_current` expiry | i20 |
| M4b | mint expiry | **NEW sv3** |
| M5 | mint made `pub` (widened minting route) | `val-cd-b4-ipc-session-authority1a` ("mint is not crate-private" + "mint is public") |

Every mutation restored; final `ipc_session.rs` SHA-256 `52240bfc…` **identical to baseline**; `git diff --name-only` shows only the two authorised test files; session-authority validator PASS on restored tree. M3c/M4b prove the NEW tests are load-bearing, not decorative.

---

## 5. CARRY-FORWARD (none implemented)

C1 live pipe/session proof; C2 client-side server/Authenticode/SCM auth; C3 owner presence/C4; C4 re-enrolment; C5 durable F5 ledger. Also carried: a real (owner-gated) production adapter that assembles `ConfirmedSameConnectionIpcPeerEvidence` from LIVE canonical capture — the live-graph bundle assembler deliberately does not exist yet, and building it will require an owner decision on how bounded peer facts cross the canonical seal (identity currently never leaves the attempt — correct, and preserved).

## 6. RISK

1. **Session ↔ canonical-verdict coupling is orchestration-level, not type-level.** Nothing yet FORCES a future orchestrator to require `ServiceInstanceBinding::Match` before minting; the composition test proves the mechanisms compose and refuse independently, not that composition is mandatory. Type-level coupling belongs to the future live-adapter phase (C1/C2). Recorded as OPTIONAL HARDENING / CARRY-FORWARD.
2. `IpcPeerObservation` peer fields remain untrusted-by-design caller data at core level (compared, never trusted); the canonical evidence is the kernel truth and stays sealed. Unchanged accepted design.

## 7. DECISION NEEDED

**APPROVED TO COMMIT AND PUSH** — or one precise blocker.

---

## 8. Reviews, aggregate validation, machine state

- Claude adversarial self-review: mint-order shadow analysis for sv1–sv3 (checked each asserted error is reachable given mint's check order); duplication review (no existing test re-proved under a new name — sv1/sv2/sv3 assert previously-unasserted errors; composition test is the only test tying canonical verdict and session in one proof); boundary review (2 files, both authorised areas D); secret review (synthetic opaque selectors only).
- ECC code-review agent (combined code+security lens): run on the exact diff — findings and dispositions appended below.
- UI UX Pro Max / Flow Motion / Figma / live browser: NOT APPLICABLE. Provider MCP: PROHIBITED / NOT USED. tdd-guide: AVAILABLE BUT NOT APPLICABLE (proof set frozen by acceptance matrix). build-error-resolver: NOT NEEDED.
- `npm run validate:v3plan` PASS (8), `validate:secrets` PASS, `validate:reporter` PASS, **`validate-all` 121/121 ALL PASS**, `git diff --check` clean.
- Machine: `ProjectOSHost` STOPPED before and after; ProjectOS pipes 0; ProgramData newest write 2026-08-01 (untouched); no elevation, credential, provider, registry or SCM activity. Formal programme counters unchanged (4/19, 21.1 %, `EXECUTION_READY` false, `installationAuthority` NotAuthorised).

### Review findings and disposition

**ECC code+security review: 0 CRITICAL, 0 HIGH, 2 MEDIUM, 1 LOW.** The reviewer independently verified sv1–sv3 are boundary-precise against `mint`'s exact check order, unshadowed, and would fail under off-by-one or branch-removal mutations; no raw identity material anywhere; no duplication of existing i-suite rows. Dispositions:

- MEDIUM 1 (test comment claimed a "reconnected verifier" refusal it did not exercise): **FIXED** — the reconnect assertion was ADDED (`is_current` with a fresh `ProductionIpcSessionVerifier` → `ConnectionMismatch`), so the claim is now proven, not removed.
- MEDIUM 2 ("composition" framing overclaimed — the canonical-attempt part and the session part share no data): **FIXED** — test renamed to `level2_canonical_peer_capture_and_session_refuse_substituted_and_stale_peers`, comment rewritten to state explicitly these are two INDEPENDENT parallel proofs of the same threat model and that wiring the canonical verdict into minting is deliberately NOT claimed (it is the live-adapter phase's work — matches §6 Risk 1). Claim now no stronger than the evidence.
- LOW (setup boilerplate shared with the pre-existing Level-2 test): **ACCEPTED** — the duplication keeps each Level-2 proof self-contained and readable; consolidation noted as optional test hygiene only.

All suites re-run green after the fixes; fmt + clippy clean; both tests pass.
