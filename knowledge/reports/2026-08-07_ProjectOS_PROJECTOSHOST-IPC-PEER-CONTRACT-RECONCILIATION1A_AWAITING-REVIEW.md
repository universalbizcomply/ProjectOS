# PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A |
| **Parent** | `PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A` (`b8cca6d`) |
| **Baseline** | `projectos-v3` @ `b8cca6da0362a7310b0a82c80ad95d48452e8e59` |
| **Gate** | NARROW CONTRACT CLEANUP — no live IPC, no service start, no machine mutation |
| **Decision requested** | **ACCEPTED — DUPLICATE IPC PEER IDENTITY CONTRACT RETIRED** |

**No new runtime capability. No identity capture. No session verifier. No live IPC. No service start. No machine mutation.**

---

## 1. Headline

`windows-local-ipc` no longer contains a second peer-identity model. Raw SID storage, raw Windows session identity, bounded integrity levels, the observed-evidence input model, peer classification, peer-authentication errors and both authentication entry points are **removed, with no replacement and no successor in that crate**.

What remains is a sealed marker carrying **only the two host-issued identifiers** — connection ID and handshake generation — with **no production constructor in any graph**. Peer identity is owned end-to-end by the canonical identity-proof crate's bounded attempt, exactly as `b8cca6d` established.

Net effect on the vocabulary: one identity model, one owner, one place it can be read.

---

## 2. Evidence classification

### SOURCE-BACKED FACT

- The retired model was confined to **exactly two files** — `windows-local-ipc/src/operation_contract.rs` and `lib.rs`. A repo-wide symbol sweep found no other crate, module, test file or validator naming it.
- `TrustedPeerContext` now has fields `_seal`, `connection_id`, `handshake_generation` and nothing else.
- Its only constructor is `#[cfg(test)] fn for_admitted_connection` — private and test-gated, so it exists in **neither** the default nor the non-default `test-fixtures` graph.
- `evaluate_protected_operation` keeps its signature and its C4-first ordering; on every shipped path `peer` is `None`.
- `val-projectoshost-ipc-operation-contract1a` (O1–O11) is **unchanged and PASSES** — O7 requires the sealed type's *presence*, which the reduction preserves.
- `val-windows-local-ipc-capability-b3`, `val-cd-b4-binding-consumer-surface1a` and `val-windows-service-identity-proof-3kideb` are **byte-unchanged and PASS**.
- `windows_ffi.rs`, the canonical identity-proof crate, every `Cargo.toml` and every `Cargo.lock` are **untouched**.
- Tests: `windows-local-ipc` **90 lib default / 91 fixtures** (from 102/103), plus 11 + 4 integration, 0 failed. `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` clean on both graphs.
- **R1–R7: 7 of 7 killed for their named killers, all restored byte-identically** (SHA-256 verified).
- Suite **119 → 120**.

### GATEKEEPER DECISION

- Simplification only; no new runtime capability, no identity capture, no session verifier.
- Integrity is non-authorising: no `IntegrityMismatch`, no integrity equality requirement, no integrity-based classification.
- The canonical `#[allow(dead_code)]` stays outside this cleanup.

### INFERENCE

- Keeping the sealed marker rather than deleting the type is a judgement: O7/O8 require its presence, and layer 3 (`AuthorisedProtectedOperation`) is defined against it. Deleting it would have forced an amendment to an accepted validator outside the boundary.
- Retaining `connection_id`/`handshake_generation` is a judgement: they are host-issued, not identity, and §10 requires tests proving different connection IDs and generations are not interchangeable.

### NOT FOUND

- No production route from a canonical attempt outcome to a `TrustedPeerContext`. There was none before this phase and none was added: that wiring is **Phase 4**.
- No consumer anywhere depended on the retired exports.

---

## 3. Governing validator inventory (§4, completed before editing)

| Path | Governing validators | Dependent tests | Consumers | Accepted invariant | Proposed change |
|---|---|---|---|---|---|
| `windows-local-ipc/src/operation_contract.rs` | `operation-contract1a` (O1–O11), `peer-authentication1a` (P1–P10), `kernel-peer-capture1a` (C1, C2, C12) | 102 lib tests in-module | `lib.rs` re-exports only | O2 secret-free · O6 C4 first · **O7 `pub struct TrustedPeerContext` must EXIST** · O8 sealed · O9 authority-gated · C2 no raw identity APIs · C12 C4 hard stop | retire the identity model; keep the sealed type, seal, evaluation order |
| `windows-local-ipc/src/lib.rs` | `capability-b1`, `capability-b3`, `peer-authentication1a` (P1) | — | none outside the crate | b3 crate boundary | drop the retired re-export block |
| `val-projectoshost-ipc-peer-authentication1a.cjs` | registered in `validate-all` | — | — | P1–P10 describe the retired model | reduce to P9 + P10, the two that outlived it |
| `validate-all.cjs` | — | — | — | one string entry per module | register one new module |
| canonical crate, `windows_ffi.rs`, `Cargo.*` | b3, 3kideb, consumer-surface, kernel-capture | canonical 104 | — | must not change | **no change** |

**Result: NO accepted contract collision.** The one that could have been — O7 — is satisfied because it asserts presence and sealing, not the identity fields. `val-projectoshost-ipc-operation-contract1a.cjs` therefore stays unchanged, and no boundary amendment was needed.

**Two collisions I created and then removed before they could ship**, both caught by running the accepted validators rather than by reasoning:

1. My regression test first annotated a local as `String`. O2 forbids that literal anywhere in the module's stripped code — my own test would have broken an accepted invariant. The annotation is gone and the reason is recorded in a comment beside it.
2. The same test first forbade `&[u8]` outright, which fails on the codec's legitimate decode parameters. Narrowed to `-> &[u8]`, which is the actual leak shape and is what O3 also checks.

---

## 4. Obsolete phase-2 model — what was removed

| Removed | Was |
|---|---|
| `pub const SID_MAX_LEN` | 68-byte SID bound |
| `pub struct TokenUserSid` | `[u8; 68]` + length, with `classify()` |
| `pub enum IntegrityLevel` + `from_rid` | five bounded levels |
| `pub struct ObservedPeerEvidence` + `observed()` | PID, creation tick, live re-read, SID, session, integrity, connection, generation |
| `pub enum PeerAuthenticationError` | nine refusal variants incl. `IntegrityMismatch` |
| `TrustedPeerContext::mint` + 7 identity accessors | `client_pid`, `client_creation_tick`, `token_user_sid`, `client_session`, `integrity`, `peer_class` |
| `pub fn authenticate_peer` / `pub fn reauthenticate_peer` | the duplicate reconciliation |
| `use projectos_host_core::PeerUserClass` | classification import |
| the `lib.rs` re-export block | all of the above |

---

## 5. Final production identity model

```
canonical identity-proof crate            windows-local-ipc
──────────────────────────────            ─────────────────
ServiceInstanceBindingAttempt             TrustedPeerContext { _seal, connection_id,
  ├─ record_ipc_peer_identity                                  handshake_generation }
  ├─ reconcile_ipc_peer_identity            no production constructor
  └─ CanonicalPeerContribution              no identity of any kind
       (pub(crate), never leaves)
```

One owner. The consumer crate cannot read, store, compare or classify identity, and cannot mint an admitted-peer marker either.

---

## 6. Integrity rule (§7)

No `IntegrityMismatch`. No integrity equality requirement. No integrity-based classification. No high-integrity privilege assumption. C4 cannot be bypassed by integrity. **No integrity accessor was added** to consume the canonical field, and the canonical `#[allow(dead_code)]` is untouched — it was not compiler-mandated to remove it.

---

## 7. C4 hard stop (§8)

Unchanged and re-proven after the removal: gate checked **first**, unconditional, no `ACCEPTED`, no `COMPLETED`, no effect dispatch, no credential access, no provider action. Tests `an_admitted_peer_still_cannot_pass_c4` and `an_admitted_peer_cannot_reach_an_acceptance_by_any_epoch_or_sequence` exercise it with a peer **present** — strictly stronger than the previous `None` case. Pinned by N7, P9, C12 and O6.

---

## 8. Tests (§10)

**Added:** `legacy_peer_identity_model_is_not_present_in_production_graph` (source scan via `include_str!`, comment-stripped, identifiers assembled with `concat!` so it cannot match itself), `a_trusted_peer_context_carries_no_identity_only_the_host_issued_connection`, `different_connection_ids_are_not_interchangeable`, `different_handshake_generations_are_not_interchangeable`, `wire_values_cannot_establish_or_alter_a_peer_context`, `an_admitted_peer_still_cannot_pass_c4`, `an_admitted_peer_cannot_reach_an_acceptance_by_any_epoch_or_sequence`.

**Removed:** the fifteen tests whose production contract no longer exists (SID classification, integrity RIDs, evidence construction, PID reuse, dead process, re-authentication mismatches). Those properties are not lost — they are proven canonical-side by `two_different_users_of_the_same_class_remain_distinguishable`, `a_reused_pid_with_a_different_creation_identity_is_refused`, `a_peer_that_moved_session_is_refused`, `integrity_never_refuses_and_never_alters_identity` and `a_capture_from_another_connection_or_generation_cannot_reconcile`.

**Retained unchanged:** wire round-trips, frame ceiling, discriminant closure, correlation/epoch separation, and the four original C4 tests.

---

## 9. R1–R7 mutations

| # | Mutation | Killed by |
|---|---|---|
| R1 | raw SID field back into production local-ipc | N1 (field beyond host binding), N2 (retired name **and** `[u8; 68]` shape) |
| R2 | raw session identity back | N1, N2 (`session_id:`) |
| R3 | `IntegrityMismatch` reinstated as authority | N2 |
| R4 | test-only constructor made production-visible | N4 (not `cfg(test)`, and publicly reachable) |
| R5 | production `mint` outside the canonical attempt | N4 (`fn mint(`) |
| R6 | wire values allowed to establish a context | N4 (`impl From<…> for TrustedPeerContext`), N6 |
| R7 | C4 bypassed after retiring the old layer | N7, P9, C12 **and** the test suite |

**Restoration:** all seven restored byte-identically; `operation_contract.rs` back at `3F638524698F5A6B6240B37EF00799E2864513431922B551FCE610870371A98C` after each.

**Disclosed:** R7 was **not** killed by `val-projectoshost-ipc-operation-contract1a`. Its O6 checks that the gate is consulted and ordered first, but not that the condition is unconditional — that gap was already covered by P9 when phase 2 found it, and it is now covered by N7 and C12 as well. I am reporting the non-kill rather than quietly counting four killers as five.

---

## 10. Machine non-interference (§14)

Identical before and after: `STOPPED` / `DEMAND_START`, installed binary `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` at 320,000 bytes, 0 `ProjectOSHost` processes, 0 ProjectOS pipes, no ACL/DACL change, no ProgramData or registry change, no credential or provider activity. Service never started; no live pipe connected. All builds into an isolated target root outside the repository.

---

## 11. Exact path boundary (§12)

1. `projectos/host/windows-local-ipc/src/operation_contract.rs`
2. `projectos/host/windows-local-ipc/src/lib.rs`
3. `projectos/validators/val-projectoshost-ipc-peer-authentication1a.cjs`
4. `projectos/validators/val-projectoshost-ipc-peer-contract-reconciliation1a.cjs` *(new)*
5. `projectos/validators/validate-all.cjs`
6. this report
7. `knowledge/ProjectOS Reports Index.md`

No canonical capture source change — none was compiler-mandated. No `Cargo.toml`, no `Cargo.lock`, no `windows_ffi.rs`, no installer, no service DACL, no current-state, no crosswalk, no existing report amended.

---

## 12. Carry-forward

- **Phase 4:** wire a canonical attempt outcome to a `TrustedPeerContext`, plus correlation, sequence, epoch and the session verifier. The seam is now unambiguous — one identity owner and one sealed marker to mint.
- **Phase 3:** non-elevated pipe access and DACL. Source shows no dependency on anything retired here, so this does not block it.
- `PROJECTOS-VALIDATOR-LINE-ENDINGS-HARDENING1A` — still unstarted, still blocking nothing.

**F2/F3/F4/F5 OPEN. C4 OPEN. C6 OPEN. C7 OPEN/PROHIBITED. `acceptedPhaseCount` 4/19, `completionPercentage` 21.1, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.**

---

## 13. Decision requested

**ACCEPTED — DUPLICATE IPC PEER IDENTITY CONTRACT RETIRED**
