# PROJECTOSHOST-IPC-PEER-AUTHENTICATION1A — AWAITING REVIEW

**PEER-AUTHENTICATION CONTRACT COMPLETE; LIVE KERNEL PEER CAPTURE DEFERRED TO CANONICAL IDENTITY CRATE.**

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-PEER-AUTHENTICATION1A (F2/F3 phase 2 of 5) |
| **Amendment** | OPTION A — CONTRACT NOW, CANONICAL LIVE CAPTURE LATER, + CRLF-TOLERANT BASELINE VALIDATOR CORRECTION |
| **Parent** | `PROJECTOSHOST-IPC-OPERATION-CONTRACT1A` (`d7a2fc0`) |
| **Baseline** | `projectos-v3` @ `d7a2fc0f75bf3c336d215483185a3a9d2b4b9982` |
| **Decision requested** | **ACCEPTED — IPC PEER AUTHENTICATION CONTRACT CAPTURED** |

Contract and decision logic only. **No live capture, no impersonation, no token acquisition, no transport change, no DACL change, no service action, no credential, no provider, no effect.** The service was not started; the installed binary was not touched.

---

## 1. Headline

Phase 1 left `TrustedPeerContext` with no constructor at all. This phase gives it exactly one route into existence — `authenticate_peer`, from reconciled peer evidence — and then makes sure **no production code can supply that evidence**.

The original implementation attempted the live Win32 capture in `windows_ffi.rs`. That broke `val-windows-local-ipc-capability-b3`, an accepted invariant which assigns raw process and token identity to the canonical identity-proof crate. Under Option A the live capture has been **removed entirely**, `windows_ffi.rs` restored byte-identically, and the b3 invariant left untouched and passing.

What remains is an **inert contract**: complete reconciliation and refusal logic, fully tested against synthetic evidence, with no production path that can construct that evidence and no path to an effect while C4 is open.

---

## 2. Source-backed facts

- The **b3 invariant owns live identity capture** in the canonical identity-proof crate. [val-windows-local-ipc-capability-b3.cjs:671](../../projectos/validators/val-windows-local-ipc-capability-b3.cjs#L671) states it in its own words: *"The identity must come from the canonical crate, never be assembled here."*
- **This phase does not alter that invariant.** `val-windows-local-ipc-capability-b3.cjs` is byte-unchanged and PASSES.
- **`windows_ffi.rs` was restored byte-identically** to `d7a2fc0`. Git blob hash `baf9d367eb889f84414f37c78f52eda0b246c1b3` on both sides; the file is absent from the final diff.
- The retained contract **authenticates and reauthenticates only supplied observed evidence**. It performs no capture of any kind.
- **No production path currently constructs that evidence.** `ObservedPeerEvidence::observed` and `TokenUserSid::from_kernel_bytes` are both gated `#[cfg(any(test, feature = "test-fixtures"))]`; `test-fixtures` is non-default.
- **No live peer was captured.** No pipe was opened, no token read, no process opened.
- **C4 remains open.** `OwnerPresenceGate::is_closed()` still returns `false` unconditionally.
- **No request can be accepted or executed.** Nothing in the crate can produce an `AuthorisedProtectedOperation`.

---

## 3. Gatekeeper decision

- **Option A selected** — contract now, canonical live capture later.
- Live capture **split into a later phase**: `PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A` (§14).
- **Option C rejected** — the b3 validator is not weakened or amended.
- **Option B deferred** to a separately frozen gate.

---

## 3a. Post-freeze gatekeeper correction — the pre-existing V9 defect

Final validation of the Option-A result surfaced a **second, unrelated** failure:
`[val-cd-b4-installed-host-status-contract1a] FAIL: V9 the served status exchange is missing`.

**Proven pre-existing, not caused by this phase.** With all six phase paths stashed (including untracked) and the tree pristine at `d7a2fc0`, it still failed. All six paths were then restored and verified byte-identical; the stash list was left empty.

**Root cause — a line-ending portability defect.** V9 anchored on `/…\n    \}\n\}/`, which cannot match CRLF text. `windows_ffi.rs` in the worktree is **1,590 CRLF, 0 bare LF** → no match. LF-normalised → match. `core.autocrlf=true` with no `.gitattributes` means the same committed blob materialises as CRLF after a checkout and as LF after a formatter pass, and both hash identically — so `git status` reports clean either way and the validator's verdict turned on a difference **Git does not track**.

**It had been masked.** The earlier phase-2 `windows_ffi.rs` copy was **0 CRLF, 1,870 LF** because `cargo fmt` had rewritten it, which made V9 match. Removing that code unmasked the latent defect. Exactly two validators changed verdict between the two runs: b3 FAIL→PASS (fixed by the amendment) and this one PASS→FAIL (unmasked by it). Nothing else moved.

**The correction, authorised as one additional path.** Only the V9 structural expression changed, `\n` → `\r?\n` at its two brace anchors:

```js
/fn serve_one_status_exchange\(([\s\S]*?)\r?\n    \}\r?\n\}/
```

Function-name matching, body capture and both closing-brace anchors are retained. V9 was not skipped, not downgraded to a warning, not broadened to an unrestricted match, and no other assertion or validator was edited. It remains structurally fail-closed.

**Regression proof.** The shipped expression was extracted from the validator source at runtime — so the proof exercises the literal actually in the file, not a copy — and applied to controlled in-memory variants of the real source. `windows_ffi.rs` was never modified, and no formatter or line-ending conversion of the real worktree was used to manufacture a result.

| Case | Input | V9 verdict | Expected |
|---|---|---|---|
| A | valid served-status source, LF | **PASS** | PASS |
| B | same source, CRLF | **PASS** | PASS |
| C | exchange removed, CRLF | **FAIL** — the served status exchange is missing | FAIL |
| C′ | exchange removed, LF | **FAIL** — the served status exchange is missing | FAIL |

Each case also re-checked V9's four ordered steps inside the captured body, so the proof covers the semantics rather than merely whether the regex found something. End-to-end, the real validator now returns PASS against the real CRLF worktree.

---

## 4. Exact final boundary — 7 paths

| Path | Change |
|---|---|
| `windows-local-ipc/src/operation_contract.rs` | peer evidence + identity types, `authenticate_peer`, `reauthenticate_peer`, 19 tests |
| `windows-local-ipc/src/lib.rs` | re-export + scope note stating live capture is not implemented |
| `validators/val-projectoshost-ipc-peer-authentication1a.cjs` | **new** — 10 assertions P1–P10 |
| `validators/validate-all.cjs` | +1 registration line, 117 → 118 |
| `validators/val-cd-b4-installed-host-status-contract1a.cjs` | V9 line-ending tolerance only (§3a) |
| this report | record |
| `knowledge/ProjectOS Reports Index.md` | +1 row |

**`windows_ffi.rs` is clean and absent from the diff.** No new package, no new dependency, no `Cargo.toml` change, no `Cargo.lock` change, no current-state or crosswalk change, no existing report modified. One earlier validator was modified — `val-cd-b4-installed-host-status-contract1a.cjs`, under explicit gatekeeper authority, for line-ending tolerance only (§3a). `val-windows-local-ipc-capability-b3.cjs` was **not** modified.

---

## 5. What was removed under the amendment

Deleted from `windows_ffi.rs` and restored to committed bytes: `GetNamedPipeClientProcessId`, `ImpersonateNamedPipeClient`, `OpenThreadToken`, `GetTokenInformation`, `OpenProcess`, `GetProcessTimes`, `RevertToSelf`, the RAII impersonation guard, the token/process capture helpers, the three backend capture fields, the `contribute_ipc_peer` live wiring, and all related imports.

Deleted from the contract because its only purpose was the removed capture: the `impersonation_reverted` evidence field and the `ImpersonationNotReverted` refusal variant, together with the test and validator assertion that covered them.

**Nothing about impersonation, token reversion or live capture is retained or claimed anywhere in this phase.**

---

## 6. Observed-evidence sealing — the production-inert contract

Because live capture is deferred, `ObservedPeerEvidence` must not become a forgery route. Every mandatory property of §5 of the amendment is met:

| Requirement | How |
|---|---|
| no public production constructor | `observed()` is `#[cfg(any(test, feature = "test-fixtures"))]` |
| no public fields | every field is private; validator P3 fails on any `pub` field |
| no serde / wire deserialisation | forbidden by P3 and by the module-wide `serde` ban |
| no conversion from the wire DTO | P3 forbids `impl From<ProtectedOperationRequest>`; P6 forbids the DTO inside `authenticate_peer` |
| synthetic construction only | tests and the non-default fixture graph |
| `authenticate_peer` not usable with fabricated evidence | it takes `&ObservedPeerEvidence`, which production cannot build |
| minting remains private and single-site | `fn mint` is private; P2 counts call sites and requires exactly one |
| no default-graph fixture creates authority | `test-fixtures` is non-default and creates no capability |

`ObservedPeerEvidence` additionally carries the module `_seal`, so no other module can fabricate one by struct literal even inside this crate. `TokenUserSid::from_kernel_bytes` — the only route from arbitrary bytes to an identity value — is gated the same way, so in a production build `TokenUserSid` has **no constructor at all**.

---

## 7. Trusted-context construction

```rust
fn mint(...) -> Self          // PRIVATE. Not pub, not pub(crate). One call site.
pub fn authenticate_peer(evidence, expected_connection_id, expected_handshake_generation)
    -> Result<TrustedPeerContext, PeerAuthenticationError>
```

`authenticate_peer` is the sole caller of `mint`. It never reads the wire DTO. Its two expectations are explicit parameters supplied by the host, so a peer cannot nominate the connection or generation it belongs to. `TrustedPeerContext` carries the `_seal` and has no `pub fn new`, no `pub(crate) fn new` and no `From` conversion.

---

## 8. PID/creation, SID, session and integrity rules

**First observation** (`authenticate_peer`) — checked in this order, each fail-closed:

| Condition | Refusal |
|---|---|
| client PID zero | `ClientProcessUnavailable` |
| re-read pair absent — process gone | `ClientProcessExited` |
| PID matches but creation tick does not | `ProcessCreationMismatch` |
| connection identity ≠ host expectation | `ConnectionMismatch` |
| handshake generation ≠ host expectation | `HandshakeGenerationMismatch` |
| SID not classifiable | `UnknownPeerClass` |

PID alone is never an identity: both the PID **and** its creation tick must match, which is what stops a later process that reuses an earlier PID from inheriting the earlier peer's context.

**Later observations** (`reauthenticate_peer`) re-run the whole first-observation check against the same connection and generation — so a stale observation cannot skip them by arriving second — then require exact equality of SID, session, integrity, PID and creation tick:

| Divergence | Refusal |
|---|---|
| token user SID | `UserSidMismatch` |
| Windows session | `SessionMismatch` |
| integrity level | `IntegrityMismatch` |
| process identity | `ProcessCreationMismatch` |

All nine variants are fieldless on a `#[non_exhaustive]` enum: a refusal names the check that fired, never the value that failed it.

**Classification uses the user SID alone** — NT Authority 5, sub-authority 18 → `System`, 80 → `Service`, 21 → `Owner`, else `Other`. Groups and integrity are deliberately ignored, because F1 established that an elevated process on this machine carries a **filtered** token whose `Administrators` entry is `SE_GROUP_USE_FOR_DENY_ONLY`. Classifying by group would make the answer depend on which token variant was in play; classifying by user SID means elevating cannot promote an ordinary user to `System` or `Service`. Integrity is recorded as its own field, and an unrecognised RID fails closed rather than rounding to a neighbour.

**A SID is bytes, never text** — a bounded zero-padded `[u8; 68]` (`SECURITY_MAX_SID_SIZE`) with **no byte-slice accessor**, so phase 1's "a secret is not representable" property survives rather than being re-opened by a `&[u8]` return.

---

## 9. C4 hard stop

An authenticated peer reaches exactly one answer: `Rejected(OwnerPresenceGateOpen)`, `ResultClass::NotRun`, `TerminalStatus::Terminal`.

The gate is checked **first** and its condition is now pinned as **unconditional** — P9 fails if the gate condition gains any extra term, which is precisely how a peer test could be smuggled in to skip it. Nothing in evaluation can return an accepted or completed state; both constructors require an `AuthorisedProtectedOperation` that nothing can produce.

---

## 10. Tests — 19, 102 lib total

Synthetic evidence throughout; no test claims a real peer was observed.

Coherent evidence retains every field · class derived per SID family · high integrity does not change the class · unclassifiable SID refused · dead process refused · reused PID with different creation identity refused · missing PID refused · connection mismatch · handshake-generation mismatch · structurally impossible SID refused at construction (too short, too long) · distinct SIDs and sessions stay distinct · unknown integrity RIDs fail closed · **an authenticated peer still cannot pass C4** · **wire request fields never influence the trusted context** · re-bound peer refused on different SID / session / integrity / process · re-binding still enforces connection and generation · identical later observation re-binds.

Green on the default graph (102) and with `test-fixtures` (103). `cargo clippy --all-targets -- -D warnings` clean on default, `windows-live-ipc`, `test-fixtures` and `--all-features`. `cargo fmt --check` clean.

---

## 11. Mutations — 7, all killed for their named reasons, all restored byte-identically

| # | Mutation | Named killer |
|---|---|---|
| M1 | make `TrustedPeerContext` minting externally available | constructor-sealing assertion **P2** |
| M2 | remove process-creation matching | `a_reused_pid_with_a_different_creation_identity_is_refused` + **P5** |
| M3 | accept a different SID | `a_rebound_peer_with_a_different_sid_is_refused` + **P8** |
| M4 | accept a different session | `a_rebound_peer_from_a_different_session_is_refused` + **P8** |
| M5 | accept a different integrity | `a_rebound_peer_at_a_different_integrity_is_refused` + **P8** |
| M6 | permit production construction of `ObservedPeerEvidence` | evidence-sealing assertion **P3** |
| M7 | permit an authenticated peer to bypass C4 | `an_authenticated_peer_still_cannot_pass_c4` + **P9** |

This is the truthful final matrix. The pre-amendment matrix had eight mutations, three of which tested the now-deleted live capture; they are gone, and the numbering was not preserved to protect the old narrative.

**Disclosed:** M7 was initially killed by its test **only** — the validator did not fire, because the mutation appended `&& peer.is_none()` to the gate condition rather than reordering it. P9 was strengthened to require the gate condition be unconditional, and M7 was re-run and is now killed by both. A mutation that only one guard catches is a gap, not a pass.

Every mutation was applied to a byte baseline taken beforehand, restored from it, and the restore verified by byte comparison — all seven report `restored byte-identical: True`.

---

## 12. B3 validator non-regression

`projectos/validators/val-windows-local-ipc-capability-b3.cjs` — **not modified**, absent from `git status`, and **PASS**.

Validator P10 of the new phase-2 validator restates the b3 boundary locally: `GetNamedPipeClientProcessId`, `GetNamedPipeClientSessionId`, `GetProcessTimes`, `OpenProcess`, `OpenThreadToken`, `GetTokenInformation`, `ImpersonateNamedPipeClient` and `RevertToSelf` are forbidden in **both** the contract module and `windows_ffi.rs`. A future edit to this phase's own code therefore cannot quietly re-cross the boundary that caused this amendment.

---

## 13. Adversarial review — what this does NOT prove

- **No live peer was ever captured, and none is claimed.** Nothing here proves impersonation, token reversion, token acquisition or real Windows peer authentication. Those are `PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A`.
- **The contract is currently unreachable in production**, by design: no production code can build `ObservedPeerEvidence`. It is proven logic waiting for a proven source.
- **Identity is not authorisation.** Nothing decides who may connect; that stays a phase-3 DACL and C4 question.
- **`core`'s unsealed `VerifiedApproval` and `ConfirmedHandshakeEvidence` were again not migrated.** Phase 1 deferred that to "phase 2, where they first become load-bearing"; they did not become load-bearing, because the seal stayed inside one crate. The deferral moves to phase 4.
- **My own process error, disclosed.** I started the first validation aggregate and then edited the Reports Index while it was still running — the torn-read mistake from the deterministic-build phase. I caught it, discarded that run, and re-ran cleanly. Every result quoted here is from a run against final, settled files.

---

## 14. Follow-up, carry-forward only — NOT implemented

**`PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A`**

Implement live named-pipe peer capture inside the canonical `projectos-host-windows-service-identity-proof` ownership boundary, and expose only the minimum sealed evidence contribution `windows-local-ipc` requires.

Must be decided **before** implementation: canonical crate API; handle lending and ownership; impersonation and guaranteed reversion; token rights; process creation identity; evidence return without raw identity leakage; validator and mutation boundaries; whether any installer or live proof is needed.

**Blocks:** the complete F2/F3 trust-boundary proof, protected-operation acceptance, custody shipping.
**Does not block:** committing this inert contract.

---

## 15. Machine non-interference

`ProjectOSHost`: `STOPPED`, `DEMAND_START`, binary path unchanged. Installed binary SHA-256 `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` — unchanged. **0** `ProjectOSHost` processes, **0** ProjectOS named pipes. No ACL or service-DACL change, no ProgramData or registry mutation, no credential or provider activity. The service was not started and no live pipe was connected. All builds went to an isolated target root outside the repository.

---

## 16. Programme position

F2, F3, F4, F5 OPEN. C4 OPEN, C6 OPEN, C7 OPEN and PROHIBITED. No protected operation authorised; the installed binary is not replaced; custody is not shipped. `acceptedPhaseCount` unchanged at **4/19**; `EXECUTION_READY` false.

Remaining in F2/F3: the new kernel-capture phase (§14), phase 3 (non-elevated channel, DACL, installer), phase 4 (live correlation, sequence, epoch), phase 5 (synthetic proof).

---

## 17. Final validation

| Check | Result |
|---|---|
| `cargo fmt --check` | CLEAN |
| `cargo clippy --all-targets -- -D warnings` | clean on default, `windows-live-ipc`, `test-fixtures`, `--all-features` |
| `npm run validate:v3plan` | PASS ×4 |
| `npm run validate:secrets` | PASS |
| `npm run validate:reporter` | PASS ×4 |
| **`npm run validate`** | **118 PASS, 0 FAIL — `validate-all: ALL PASS`** |
| `git diff --check` | clean |
| `val-windows-local-ipc-capability-b3` | PASS, unmodified |
| `val-cd-b4-installed-host-status-contract1a` | PASS |
| `val-projectoshost-ipc-peer-authentication1a` | PASS |

118 is the repository's actual registered total after this phase's `+1` registration (117 → 118).

---

## 18. Decision requested

**ACCEPTED — IPC PEER AUTHENTICATION CONTRACT CAPTURED**
