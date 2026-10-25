# PROJECTOSHOST-IPC-INTEGRATED-SYNTHETIC-PROOF1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-INTEGRATED-SYNTHETIC-PROOF1A |
| **Parent** | `PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A` (`2eec7aa`) |
| **Baseline** | `projectos-v3` @ `2eec7aaa9b01a29afbe6ae96fae3dcf758d60d15` = origin, 0/0, clean, 0 tags |
| **Mode** | LOCAL / SYNTHETIC INTEGRATION PROOF |
| **Decision requested** | **APPROVED TO COMMIT AND PUSH** |

**No ProjectOSHost start/stop. No `\\.\pipe\ProjectOS.Host`. No owner enrolment. No configured-owner SID. No ProgramData/ACL/registry mutation. No installer, no elevation. No credential, provider, deploy or protected effect. C4 untouched.**

---

## 1. Headline — PROOF ONLY, one changed file

The chain closed in the parent phase is now **proven end to end in one test that traverses the real components**. `git diff --name-only` is exactly:

`projectos/host/windows-local-ipc/src/observation.rs`

plus this report and one Reports Index row. **Zero production source change. Zero `Cargo.toml`. Zero `Cargo.lock`. Zero validator change (2 amended, 0 added stays at the parent's total — this phase amends none). Validator total 121.**

---

## 2. Source inventory (the five points, before editing)

1. **Existing proof-runner entry point** — `windows-service-identity-proof-runner::run_compile_only_proof(request, fixture, observation)`: SCM-before → real fixture handshake → peer contribution → SCM-after → `finalise` → shutdown → disconnect → exact-zero residue, with `CompileOnlyServiceFixture` owning the shutdown/disconnect/residue behaviours.
2. **Fixture route available** — `LiveInstanceObservationCapability::synthetic_for_fixture`, `synthetic_observation(SyntheticInstanceSelector)`, `assemble_same_connection_ipc_peer_fixture` (drives the REAL handshake order), `ProductionIpcSessionVerifier::for_local_proof`, `FixtureRuntimeInstanceVerifier`, `bind_production_clock` + `FixtureMonotonicTickSource`.
3. **Canonical→bundle→verifier route** — `record_ipc_peer_on_connection` (tags the attempt) → `finalise_for_connection` → `bind_canonical_peer_to_session_evidence` → `(IpcPeerObservation, ConfirmedHandshakeEvidence)` → `ProductionIpcSessionVerifier::verify` → `BoundIpcSession` → `is_current`.
4. **What was genuinely missing** — nothing in production. Only a proof that runs the WHOLE chain in one place, including the shutdown/zero-residue tail.
5. **Smallest boundary** — proof-only, in the existing fixture test module where every real component is already in scope.

**Disclosed hosting decision.** §4 prefers the existing proof-runner. It **cannot host this today**: the runner has no `projectos-host-core` dependency, so it cannot see `ProductionIpcSessionVerifier`, the runtime verifier or the trusted clock. Hosting there would need either a manifest change (§9 forbids) or a new core re-export from `windows-local-ipc`'s public surface (a production change to a just-closed file, §7 says prefer zero). The proof therefore lives in `windows-local-ipc`'s existing fixture test module — the one place where the canonical attempt, the guarded crossing, the sealed core verifier AND the crate's own accepted shutdown/residue contract all already meet. **Runner-hosted variant recorded as carry-forward; no claim is made that the runner orchestrates the session chain.**

---

## 3. The integrated positive route (S1–S10)

`integrated_synthetic_authority_chain_mints_is_current_and_leaves_zero_residue`:

| Step | How it is obtained — never reconstructed in the test |
|---|---|
| S1/S2 | connection id + handshake generation read from the **sealed verifier's own** crate-assigned counter (`ProductionIpcSessionVerifier::for_local_proof`); both asserted non-zero. The test cannot choose them |
| S3 | canonical attempt driven in order and TAGGED with that exact pair via `record_ipc_peer_on_connection` |
| S4 | `Match` produced by the **canonical crate** at finalisation |
| S5 | `bind_canonical_peer_to_session_evidence` — the production crossing — proves attempt pair == bundle pair == verifier pair and consumes the attempt |
| S6/S7 | `iv.verify(...)` — the **only** constructor for a `BoundIpcSession` |
| S8 | `session.is_current(&iv, &runtime, &now)` succeeds |
| S9 | a NEW verifier (reconnection) → `ConnectionMismatch`; `iv.disconnect()` → `Disconnected` |
| S10 | `LocalIpcAdapter::confirm_shutdown` + `close_and_classify_residue` → `IpcResidue::Zero` |

Trusted time and the runtime instance come from `bind_production_clock` and `FixtureRuntimeInstanceVerifier::verify` — their own sealed routes.

**Zero residue is judged, not assumed.** The companion `integrated_zero_residue_is_judged_not_assumed` shows the adapter overrides a backend that *claims* `Zero`: a quarantined operation and a transferred handle each force `NonZero` and refuse clean shutdown. So S10 cannot pass because the fake always says `Zero`.

`ShutdownTailBackend` is a small test-local `IpcBackend` impl. `adapter.rs`'s own fake is private to its `#[cfg(test)] mod tests` and not importable cross-file; the reviewer confirmed the duplication is necessary and immaterial, and that **`LocalIpcAdapter` — not the backend — decides the residue answer**.

---

## 4. Negative proofs (N1–N8) — reused, not duplicated

| Row | Proof |
|---|---|
| N1 wrong connection | `integration_wrong_connection_prevents_session_evidence` + `integration_attempt_from_another_connection_prevents_session_evidence` (existing) |
| N2 stale handshake | `integration_stale_handshake_generation_…` + `integration_attempt_from_a_prior_handshake_generation_…` (existing) |
| N3 canonical refusal | `integration_canonical_refusal_prevents_session_evidence` (existing) |
| N4 peer replacement | canonical incarnation-substitution proofs (existing, unchanged) |
| N5 service-instance mismatch | `integration_unstable_service_instance_…` (`Stale`) + the Mismatch cases (existing) |
| N6 stale session | S9 in the integrated test, plus core `i5/i6/i7/i8/i10/i20/i4b` (existing) |
| N7 fixture/live separation | gate unchanged; `windows-live-ipc` does not imply `test-fixtures` — validator-pinned and mutation-proven (M4) |
| N8 C4 | untouched; only `synthetic_for_fixture` capability used; `OwnerPresenceGate` still cannot report closed |

Tests all 0 failed: **windows-local-ipc fixtures 102 lib** (+11+4), default 90+11+4, live 93+11+4; core session 25 + provider 13; proof-runner 28+12+1. `cargo fmt --check` and `clippy --all-targets -D warnings` clean on default, fixture and live graphs.

---

## 5. Mutations — 4 run, 4 killed, restoration hash-proven

| # | Mutation | Killer |
|---|---|---|
| M1 | crossing continues after a non-`Match` canonical verdict | **5** integration tests **and** `val-cd-b4-production-ipc-provider1a` |
| M2 | attempt↔bundle pairing bypass | **NOT re-run — referenced.** The accepted parent phase proved M7/M8 against these exact bytes (`instance.rs` `fab72a1…`, unchanged this phase), each killed by AT2/AT3 **and** kernel-peer C13 |
| M3 | old session stays current after reconnect | **the integrated proof itself** (S9) |
| M4 | fixture escapes into the live graph (`windows-live-ipc` ⇒ `test-fixtures`) | `val-windows-local-ipc-capability-b3` **and** `val-cd-b4-production-ipc-provider1a` compile probe |

Restored: `observation.rs` `7beb479…`, `ipc_session.rs` `52240bf…`, `Cargo.toml` unmodified — all verified after the cycle; final `git diff --name-only` is one file.

---

## 6. Honest finding — a STALE committed lockfile, restored not carried

Running the runner's tests refreshed `windows-service-identity-proof-runner/Cargo.lock`: its committed copy predates two **already-accepted** dependency edges (`windows-local-ipc → projectos-host-core`, `core → projectos-host-authority`). The staleness is pre-existing and not caused by this phase, so the file was **restored via `git checkout`** and is NOT part of this candidate. Any `cargo` invocation in that crate will re-dirty it. **Carry-forward: refresh that lockfile in its own governed change.**

---

## 7. Reviews, aggregate, machine

- **ECC code review on the exact diff: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW — APPROVE.** All ten questions traced against production code: genuine traversal; no fabricated authority object; canonical refusal not bypassable; reconnect/disconnect assertions structurally non-vacuous (new verifier draws from a monotonic counter; `disconnect()` really flips liveness); the adapter decides residue; zero residue proven by the differential companion test; no new orchestrator/DTO; gates unchanged; no C4 implication; **no comment stronger than what the code proves**.
- Self-review additionally: no production module touched; no duplicate check added; the runner-hosting limitation disclosed rather than papered over.
- Tools: code-reviewer **USED**; security-reviewer **AVAILABLE BUT NOT APPLICABLE** (test-only diff, no new surface, no identity/crypto path); UI UX Pro Max / Flow Motion / Figma / browser **NOT APPLICABLE**; Provider MCP **PROHIBITED / NOT USED**.
- `validate-all` **121/121 ALL PASS**; `validate:v3plan` 8, `validate:secrets` PASS, `validate:reporter` 4; `git diff --check` clean.
- Machine: service STOPPED before and after; 0 ProjectOS processes; 0 ProjectOS pipes; ProgramData newest write 2026-08-01 (unchanged); no ACL/registry/credential/provider/installer/elevation activity. Formal counters unchanged: 4/19, 21.1 %, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.

## 8. Carry-forward

**LIVE ORCHESTRATOR = CARRY-FORWARD** — no live process invokes the proven route; this phase proves integration, not live wiring, and makes no claim otherwise. Also carried: hosting the integrated proof in the proof-runner (needs a governed dependency decision); the stale runner lockfile; live pipe/session proof; client-side server/Authenticode/SCM auth; **C4 owner presence/approval**; re-enrolment; durable F5 ledger; the kernel-peer validator's missing CLI main-guard.

## 9. Decision requested

**APPROVED TO COMMIT AND PUSH**
