# PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A |
| **Parent** | `PROJECTOSHOST-IPC-SESSION-VERIFIER1A` (`55375c5`) |
| **Baseline** | `projectos-v3` @ `55375c5df2fb10405247877e3092abec02872b57` = origin, 0/0, clean, 0 tags |
| **Mode** | LOCAL IMPLEMENTATION + SYNTHETIC INTEGRATION PROOF |
| **Amendment** | **Option A APPROVED and IMPLEMENTED** — the attempt↔connection/handshake pairing gap is CLOSED (§1a) |
| **Decision requested** | **APPROVED TO COMMIT AND PUSH** |

**No `ProjectOS.Host` pipe. No service start/stop. No owner enrolment. No ProgramData/ACL/registry mutation. No installer, no elevation. No protected effect. Synthetic opaque selectors only.**

---

## 1a. RESOLUTION — the ruling and what closed the blocker

The gatekeeper accepted §1 and ruled **Option A: amend the boundary**; Option B (carry-forward) was explicitly refused because same-connection/same-handshake pairing was part of the frozen objective. The gap is now closed, reusing the values that already existed.

**Existing state reused, nothing invented.** The live capture already received the host-issued `(connection_id, handshake_generation)` and stored them inside the crate-private `CanonicalPeerContribution`. The amendment carries the SAME pair in a new private `AttemptInner.host_connection: Option<(u64, u64)>` — needed because the consumer-contract graph has no token-side identity and therefore no contribution to hold it, so one pairing rule now serves both routes. No new id, counter, epoch, nonce, ledger, DTO, identity type or verifier was created.

**The canonical amendment (4 pieces, all in `instance.rs`):**
1. `record_ipc_peer_on_connection(observation, connection_id, handshake_generation)` — a consumer-contract capture that stores the pair and refuses a zero (non-identity) identifier. The accepted `record_ipc_peer(observation)` signature is **unchanged** (it is pinned by `val-cd-b4-binding-consumer-surface1a`, outside this amendment's scope).
2. `record_ipc_peer_identity` (live route) now mirrors the same pair it already passes to the contribution, and refuses zeros symmetrically.
3. `finalise_for_connection(self, connection_id, handshake_generation)` — consuming; compares the STORED pair against the expected values, `MissingIpcObservation` when nothing was stored, `CrossAttemptObservation` on any difference, and only then defers to the shared verdict.
4. `finalise()` (the unpaired route) now **refuses a connection-tagged attempt** with `CrossAttemptObservation`, and both finalisers answer from one private `bind_observations()` so they cannot drift. This closes the review's MEDIUM: the two verdicts are indistinguishable once returned, so the choice of finaliser is no longer left to caller discipline.

**The crossing** now calls `finalise_for_connection(bundle.connection_id(), bundle.handshake_generation())`, giving the full chain **attempt-stored pair == bundle pair == sealed verifier pair**, with the first comparison made INSIDE the canonical crate (which still has no accessor, so neither value is ever read out).

`CrossAttemptObservation` was reused rather than adding a variant to the closed `ServiceInstanceBinding` enum — semantically it already means "evidence presented outside the context that produced it"; its doc records the extension.

---

## 1. FACT — the blocker as originally reported (retained for the record)

The guarded crossing is **implemented, proven and fully green**. One requirement of the frozen objective is **not satisfiable inside the authorised boundary**, and the security review found it independently.

§7 steps 4–5 require the **contribution** to be associated with the same `connection_id` and `handshake_generation`. My crossing associates the **bundle** with the sealed verifier's connection/generation and requires the attempt's verdict to be `Match`. It does **not** verify that the *attempt itself* was captured on that connection — because in current source **an attempt carries no readable connection identity at all**:

- the consumer-contract transition `ServiceInstanceBindingAttempt::record_ipc_peer(observation)` takes **no** `connection_id`/`handshake_generation` (`instance.rs`);
- the identity-aware `record_ipc_peer_identity(..., connection_id, handshake_generation)` **does** record them — but into the crate-private `CanonicalPeerContribution`, gated `all(windows, feature = "windows-live-instance-observation")`, and read **only** by `identity_matches` during in-attempt reconciliation;
- `finalise()` → `bind_service_instance()` derives its verdict **purely from `ServiceInstanceToken` equality** and never consults either identifier.

So the attempt↔bundle link is currently **caller-side pairing**, unenforceable by types. Closing it means changing the canonical attempt surface (host-issued connection tagging visible to the consumer-contract graph, and `finalise`/an accessor honouring it). §9(A) contemplates exactly this ("ONLY if a minimum already-authorised bounded contribution is not currently exportable") and §13's exception ("unless the bounded contribution itself is compiler-blocked") is met — but it is a **material change to a CLOSED subsystem** whose surface is pinned by ~30 rules in `val-projectoshost-ipc-kernel-peer-capture1a`. Per §9 I stopped before editing it.

**Nothing is exploitable today**: `bind_canonical_peer_to_session_evidence` has zero non-test callers, no production orchestrator exists, and the transport is single-connection (`nMaxInstances = 1`).

---

## 2. IMPLEMENTATION — what IS done (in-boundary, complete, green)

| Path | Change |
|---|---|
| `windows-local-ipc/src/observation.rs` | **New guarded crossing** `bind_canonical_peer_to_session_evidence(attempt, bundle, verifier)`: (a) bundle connection == sealed verifier's live connection, (b) bundle generation == verifier's current generation, (c) **verdict derived by CONSUMING the attempt** (`attempt.finalise()`) and required to be exactly `ServiceInstanceBinding::Match`. Yields the two core evidence values only then; fail-closed on first violation. New closed refusal enum `CanonicalSessionCrossingRefusal` (fieldless except the canonical crate's own fieldless verdict). **`into_core_evidence` narrowed `pub` → `pub(crate)`** so the guard is the ONLY route out of the crate. +5 integration tests |
| `windows-local-ipc/src/lib.rs` | 2 re-exports under the **same** `cfg(any(test-fixtures, windows-live-ipc))` gate as the bundle they serve |
| `validators/val-cd-b4-production-ipc-provider1a.cjs` | **Amended:** requires `into_core_evidence` to be crate-private and fails if it becomes public again; requires the crossing to exist, to demand exactly `Match`, to correlate both connection and generation against the sealed verifier, and (post-amendment) to derive the verdict through **`finalise_for_connection`** — using the unpaired `finalise()` is now itself a failure |
| `windows-service-identity-proof/src/instance.rs` | **Amendment (§1a):** private `host_connection` pair; `record_ipc_peer_on_connection`; live capture mirrors the pair + refuses zeros; consuming `finalise_for_connection`; unpaired `finalise()` refuses a connection-tagged attempt; shared private `bind_observations()`; 2 new tests + 1 accepted test retargeted |
| `validators/val-projectoshost-ipc-kernel-peer-capture1a.cjs` | **Amended:** new **C13** block only — stored pair exists and is private, no accessor exposes either value, both capture routes store it and refuse zeros, the paired finalisation consumes/compares/fails closed, and the unpaired finalise refuses a tagged attempt. All ~30 existing C1–C12 assertions untouched (reviewer-confirmed pure insertion) |

**Validators: 2 amended, 0 added — total stays 121.** Zero core change. Zero `Cargo.toml`. Zero `Cargo.lock`. Zero new dependency/crate/Win32 feature. Pipe DACL, endpoint, owner record, enrolment, installer, ProgramData, ledger, permit/effect chain, Control Centre, core session verifier/`BoundIpcSession`/epochs/clock: untouched.

---

## 3. PROOF

**Crossing route.** `ServiceInstanceBindingAttempt<ScmAfterObserved>` + `ConfirmedSameConnectionIpcPeerEvidence` + `&impl IpcSessionVerifier` → `(IpcPeerObservation, ConfirmedHandshakeEvidence)` → existing sealed `ProductionIpcSessionVerifier::verify` → `BoundIpcSession`. The crossing constructs no authority: minting still needs the sealed verifier, a real `VerifiedRuntimeInstance` and a real `VerifiedAuthorityTime`.

| Row | Proof |
|---|---|
| T1 + T9 | `integration_match_and_correlation_mint_a_current_session` — Match + correlation mints through the REAL sealed verifier and is current; a reconnected verifier then refuses it |
| T2 + T5 + T11 | `integration_canonical_refusal_prevents_session_evidence` — substituted peer and restarted incarnation (pid-reuse model) both refuse; refusal `Debug` asserted to contain **no digits** |
| T6 | `integration_unstable_service_instance_prevents_session_evidence` — `Stale` (scm-before ≠ scm-after) refuses: the guard demands exactly `Match`, not merely "not Mismatch" |
| T3 | `integration_wrong_connection_prevents_session_evidence` |
| T4 | `integration_stale_handshake_generation_prevents_session_evidence` |
| T7, T8, T12 | **Reused, not duplicated** — existing core `i8/i10/i4b/i20/sv1–sv3`, `production_ipc_provider`, and the C4 gate's own tests/validators |
| **AT2** (amendment) | `integration_attempt_from_another_connection_prevents_session_evidence` — attempt captured on connection A, bundle AND verifier both on B (so the first two checks pass) → `CrossAttemptObservation`. Only the new rule can catch this |
| **AT3** (amendment) | `integration_attempt_from_a_prior_handshake_generation_prevents_session_evidence` — attempt from generation G1 against the current generation → `CrossAttemptObservation` |
| **AT5** (amendment) | `integration_attempt_without_a_captured_connection_prevents_session_evidence` — an attempt from the identity-free route stored no pair → `MissingIpcObservation`; refusal asserted digit-free |
| **Canonical** (amendment) | `a_connection_bound_attempt_cannot_be_finalised_through_the_unpaired_route` (unpaired `finalise()` refuses; wrong connection and wrong generation both refuse) and `a_zero_host_identifier_is_refused_by_both_capture_routes`. The accepted `a_captured_peer_identity_still_completes_the_ordinary_binding` was **retargeted** to `finalise_for_connection(77, 5)` — the ids its own helper captures on — so its intent (identity capture does not change the binding answer) is preserved exactly |
| T10 | Export gate byte-identical to the existing bundle's; `windows-live-ipc` does not imply `test-fixtures` (validator-pinned, and mutation M6b proved it) |

Tests all 0 failed: windows-local-ipc fixtures **97** lib (+11+4), default 90+11+4, live-features 93+11+4; core session 25 + provider 13; identity-proof 98+5+1. `cargo fmt --check` and `clippy --all-targets -D warnings` clean on default, fixture and live graphs.

**Mutations — 7 runs, 7 killed, restoration hash-proven** (`observation.rs`, `lib.rs`, `instance.rs`, `adapter.rs`, `Cargo.toml` all back to their pre-mutation bytes):

| # | Mutation | Killer |
|---|---|---|
| M1 | refused canonical verdict allowed through | T2 + T6 **and** the amended provider validator ("does not require exactly Match") |
| M2 | connection correlation removed | T3 |
| M3 | handshake-generation correlation removed | T4 |
| M4 | `Stale` additionally permitted alongside `Match` | T6 |
| M5 | raw accessor (`fn raw(&self)`) added to the opaque `PeerUserBinding` | `val-projectoshost-ipc-kernel-peer-capture1a` C7 |
| M6a | fixture assembler re-exported unconditionally | rustc — it does not exist in the default graph (compile-time kill, the strongest control) |
| M6b | `windows-live-ipc` made to imply `test-fixtures` | `val-windows-local-ipc-capability-b3` ("live must not reach fixtures") |
| **M7** | attempt↔bundle **connection** equality dropped | AT2 **and** kernel-peer C13 |
| **M8** | attempt↔bundle **generation** equality dropped | AT3 **and** kernel-peer C13 |
| **M9** | unpaired `finalise()` allowed to answer for a connection-tagged attempt | `a_connection_bound_attempt_cannot_be_finalised_through_the_unpaired_route` **and** kernel-peer C13 |

M7/M8 were run twice — once when first written and again after the MEDIUM/LOW fixes changed their target — and killed both times. **Disclosed:** on the first M7 run the C13 regex matched the mutated line (`if false && …`), so the validator did NOT kill it; the rule was anchored on the whole condition and the mutation re-run and killed. A validator that a mutation survives is not yet a control.

**Disclosed tooling defect (pre-existing, not mine):** `val-projectoshost-ipc-kernel-peer-capture1a.cjs` has **no CLI `main` guard**, so running it directly prints nothing and exits 0. Its `run()` is what `validate-all` calls, and that correctly reported the M5 kill. Recorded as carry-forward; not fixed here (validator hygiene is outside this phase's boundary).

---

## 4. Security / ECC review — findings and disposition

ECC security + authority-boundary review, ten explicit questions:

- **Q1 raw identity across the canonical boundary — NONE.** Only the opaque sealed attempt and the fieldless `ServiceInstanceBinding` cross. No accessor, `From`, or raw-parts path added.
- **Q2 refused evidence reaching mint — MEDIUM, FIXED.** The reviewer found the pre-existing public `into_core_evidence()` was an unguarded route to core evidence that no canonical verdict gated. **Narrowed to `pub(crate)`**, provider validator amended to pin it and to fail if it ever becomes public again. The "one guarded crossing" claim is now true, not merely available.
- **Q3 connection-A contribution minting for connection B — HIGH, now FIXED by the §1a amendment.** Re-reviewed after the amendment (second focused review): the attempt now proves both its connection and its generation; a caller cannot mix attempt A with bundle B through any route; a stale attempt cannot survive a re-handshake; the comparison is genuinely against prior stored state, not self-referential; neither value is exposed by accessor, `Debug`, return type or re-export; no new id/counter/epoch/DTO; no unrelated C1–C12 rule weakened (pure insertion); no new fixture reachability.
- **Q4 stale generation replay — NONE** (guard + independent re-check at mint; attempt consumed by value).
- **Q5 non-`Match` minting — NONE.** All 14 `ServiceInstanceBinding` variants enumerated; exhaustive binary split, only `Match` reaches `Ok`.
- **Q6 duplicated currentness checks — NONE.** Runtime/provider/epoch/expiry/staleness/liveness remain solely the sealed verifier's. Connection/generation are re-checked at mint anyway — documented as defence in depth, not a substitute.
- **Q7 unnecessary second DTO/state machine — NONE.**
- **Q8 fixtures into default/live graph — NONE.** Gate identical to the existing bundle's; feature wiring verified in both manifests.
- **Q9 refusal `Debug` leakage — NONE** (derived `Debug` over fieldless variants; asserted digit-free).
- **Q10 session implying C4 — NONE.** `OwnerPresenceGate` untouched and still unable to report closed.

The **post-amendment review** raised two further findings, both **FIXED in this phase**:
- **MEDIUM** — the still-public unpaired `finalise()` ignored `host_connection`, so a future caller could finalise a connection-tagged attempt through it and treat the `Match` as proof of connection binding (the reviewer named the existing `windows-service-identity-proof-runner` call site as the pattern that would be copied). **Fixed structurally**: `finalise()` now refuses a connection-tagged attempt; both finalisers share one private verdict implementation; validator C13 pins it; mutation M9 proves it load-bearing.
- **LOW** — the live capture had no zero-identifier check while the consumer-contract capture did. **Fixed**: symmetric refusal, with a test covering both routes.

Self-review answers (§11): (1) yes — stored at capture, compared at finalisation; (2) yes — same tuple, same comparison, AT3; (3) no — every route checked, including the identity-free one (fails closed) and the unpaired finaliser (now refuses); (4) no — a prior generation refuses, and the session layer independently refuses a reconnected verifier; (5) no — neither value is exposed anywhere; (6) no new id/counter/epoch — the existing pair is reused; (7) no unrelated canonical invariant weakened (pure C13 insertion; the one accepted test that conflicted was retargeted, not deleted, and its assertion is unchanged).

Tools: security-reviewer **USED** (twice); UI UX Pro Max / Flow Motion / Figma / browser **NOT APPLICABLE**; Provider MCP **PROHIBITED / NOT USED**.

---

## 5. Aggregate, machine, carry-forward

- `validate-all` **121/121 ALL PASS**; `validate:v3plan` 8, `validate:secrets` PASS, `validate:reporter` 4; `git diff --check` clean.
- Machine: service STOPPED before and after; 0 ProjectOS processes; 0 ProjectOS pipes; ProgramData newest write 2026-08-01 (unchanged); no ACL/registry/credential/provider/enrolment/deploy activity.
- Formal programme counters unchanged: 4/19, 21.1 %, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.
- **Carry-forward (the §1 blocker is CLOSED and no longer carried):** (i) live pipe/session proof; (ii) client-side server/Authenticode/SCM auth; (iii) owner presence/C4; (iv) re-enrolment; (v) durable F5 ledger; (vi) the missing CLI main-guard on the kernel-peer-capture validator (pre-existing tooling defect, disclosed in §3); (vii) the live production adapter that would drive `record_ipc_peer_on_connection`/the live capture from a real connection — the wiring now exists and is enforced, but no orchestrator calls it yet.

---

## 6. Decision requested

**APPROVED TO COMMIT AND PUSH.**

The §1 blocker is closed by the §1a amendment under the gatekeeper's Option-A ruling: the canonical attempt now proves which host-issued connection and handshake generation its own capture belongs to, the crossing demands that proof, both mutations (M7/M8) and the follow-up M9 die, the kernel-peer validator pins the rule without weakening any of its ~30 existing assertions, and the aggregate stays 121/121 with 2 validators amended and 0 added.
