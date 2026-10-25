# PROJECTOSHOST-IPC-OPERATION-CONTRACT1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-OPERATION-CONTRACT1A (F2/F3 phase 1 of 5) |
| **Parent** | `PROJECTOSHOST-IPC-TRUST-BOUNDARY-PREFLIGHT1A` (accepted, `c5eeb65`) |
| **Baseline** | `projectos-v3` @ `c5eeb65b3f06eb8332a8178898867e3ddcbbf69b` |
| **Decision requested** | **ACCEPTED — IPC OPERATION CONTRACT CAPTURED** |

Types and validation only. **No transport, no channel, no DACL change, no peer-token capture, no service action, no credential, no provider, no effect.** The service was not started.

---

## 1. Headline

The protected-operation contract exists, and **no path to an effect exists with it**. Three properties carry that claim, each proven by a killed mutation:

1. **A secret is not representable on this wire.** The contract module contains no `String`, no `Vec<u8>`, no map, no `serde` and no `&str`. A credential, token, cookie, key, command line or filesystem path cannot be *spelled*, let alone sent — this is stronger than rejecting one.
2. **`TrustedPeerContext` has no constructor at all.** Not public, not `pub(crate)`, not a fixture. Nothing in the crate can produce one, so every call site passes `None`.
3. **`OwnerPresenceGate` has one variant and `is_closed()` returns `false` unconditionally**, checked *first* in evaluation. While C4 is open the only reachable answer is `Rejected(OwnerPresenceGateOpen)`.

---

## 2. Frozen Phase-1 contract, as extracted

| Field | Frozen value |
|---|---|
| Objective | Closed message family + authority contract, no transport |
| Likely modules | `windows-local-ipc/protocol.rs`, new contract module, validators |
| Mandatory tests | encode/decode round trip; every malformed frame refused; no generic accessor |
| Security mutations | add a `String` field; add a payload accessor; overload `InstalledHostStatus`; omit a length |
| Blocks custody | **Yes** |
| Commit subject | **not frozen** → the gate's fallback is used |
| Report boundary | **not frozen per-phase** → report + Index |

No material conflict with the prompt, so no `FROZEN OPERATION-CONTRACT CONFLICT` was raised. The gate's M1–M7 are a superset of the four frozen mutations; all seven were run (§9).

---

## 3. Exact implementation boundary — 5 source/validator paths + 2 records

| Path | Change |
|---|---|
| `windows-local-ipc/src/operation_contract.rs` | **new** — the contract, 15 unit tests |
| `windows-local-ipc/src/protocol.rs` | 2 kinds, 2 length constants, 2 compile-time ceiling asserts, shared `write_frame_header`, `HEADER_LEN` → `pub(crate)`, kind-set test rebaselined |
| `windows-local-ipc/src/lib.rs` | `mod` declaration + re-export |
| `validators/val-projectoshost-ipc-operation-contract1a.cjs` | **new** — 11 assertions O1–O11 |
| `validators/validate-all.cjs` | +1 registration line |
| report + Reports Index | records |

**Disclosed:** `lib.rs` is not named in the frozen module list. Rust cannot see an undeclared module, so it is the compiler-mandated cost of the frozen "new contract module" rather than an extra module. **No new package, no new dependency, no `Cargo.toml` change, no `Cargo.lock` change**, no current-state or crosswalk change, no existing report modified.

---

## 4. Wire DTO and versioned message family

Two new kinds on the existing versioned protocol, discriminants **9** and **10**, each with one fixed payload length:

**`ProtectedOperationRequest` — 145 bytes**
`correlation(16) | sequence(8) | claimed_service_epoch(8) | binding_digest(32) | operation(1) | approval_ref(32) | client_session_ref(16) | parameter_digest(32)`

**`ProtectedOperationResponse` — 44 bytes**
`correlation(16) | state(1) | reason(1) | result_class(1) | service_epoch(8) | evidence_ref(16) | terminal(1)`

Every field is a fixed-width identifier, a closed enum byte, a counter or a digest. `approval_ref` and `client_session_ref` are **references**, never material.

---

## 5. Trusted authority types and sealing

| Layer | Type | Constructibility |
|---|---|---|
| 1 — untrusted | `ProtectedOperationRequest` | public — deliberately. Building one confers nothing |
| 2 — trusted peer | `TrustedPeerContext` | **none. No constructor exists in this phase** |
| 3 — trusted authority | `AuthorisedProtectedOperation` | only from layer 2 + verified approval + closed C4 — unreachable |

Both trusted types carry a `_seal: Seal` from a **private** `mod sealed`, so no downstream crate can fabricate one with a struct literal. `ProtectedOperationResponse::accepted()` and `::completed()` both **require `&AuthorisedProtectedOperation`**, so a caller cannot assert that an operation ran.

---

## 6. Secret-free payload result

Forbidden shapes checked and **absent**: `String`, `Vec<u8>`, `HashMap`, `BTreeMap`, `serde`, `&str`. No generic payload accessor (`payload`, `payload_bytes`, `body`, `as_bytes`, `-> &[u8]`).

The validator strips comments before these checks, so prose describing a forbidden construct cannot fail the build — and, more importantly, a forbidden construct cannot hide inside a comment.

**No encryption was added.** Its absence is valid precisely because the payload is secret-free and the protected value never leaves the host under Model C — not because IPC is assumed safe.

---

## 7. Framing and size

Header unchanged at 41 bytes; frame ceiling 512; payload ceiling 471. Largest new frame: **41 + 145 = 186 bytes**. Two `const _: () = assert!(… <= MAX_PAYLOAD_LEN)` checks make a future field that breaches the ceiling a **compile error**, not a runtime surprise.

Parsing refuses, all proven by test: bad magic, unknown version, unknown kind, oversize, truncation, trailing bytes, payload-length mismatch, wrong kind for the decoder, and any unknown closed-enum byte.

---

## 8. Authority-binding matrix

| Field | Classification |
|---|---|
| `binding_digest` (project/env/repo/phase/provider/operation) | **independent authority binding** — compared host-side in phase 4 |
| `operation` | **constructor-enforced invariant** — closed enum, no `Other`, no caller command |
| `claimed_service_epoch` | **live-currentness value** — compared, never trusted |
| `correlation`, `sequence` | live-currentness values — enforcement is phase 4 |
| `approval_ref` | **evidence only** — a reference; approval is verified independently |
| `client_session_ref` | **evidence only** |
| `parameter_digest` | policy fingerprint component |
| executable identity | **absent by design — evidence only, TOCTOU-sensitive**, so it is not in the contract at all |

Fields are not forced into one digest for uniformity: the binding digest is one comparison, the epoch is a currentness check, and references stay references.

---

## 9. Response-state model and the C4 hard stop

`Rejected` · `Accepted` (**admitted, nothing ran** — carries `ResultClass::NotRun`) · `Completed` (**only** from host-held authority).

`answers(correlation, epoch)` requires **both** to match, so a response from another correlation or another service instance satisfies nothing.

**C4 is checked first** in `evaluate_protected_operation`, before the peer check and before the epoch check, so no later failure can be used to slip past it. Proven by `c4_is_checked_before_anything_else`: a request with a wrong epoch *and* no peer still refuses on **`OwnerPresenceGateOpen`**. `no_evaluation_path_returns_accepted_or_completed` sweeps epochs and sequences and finds only `Rejected`. The validator additionally refuses any `accepted(`/`completed(` call inside the evaluator.

---

## 10. Tests — 15 new, 83 lib total

**Positive:** request round-trips canonically (identical input → identical bytes); rejected response round-trips; encoded frames match their declared lengths and stay under the ceiling; distinct bindings and distinct operation classes encode distinctly; a response answers only its own correlation *and* epoch; `Accepted` ≠ `Completed` and reports `NotRun`.

**Negative:** wrong kind; truncation; trailing bytes; bad magic; bad version; declared-length disagreement (**both** the trailing-data and the length-mismatch paths); unknown closed-enum byte in request *and* response; C4-open acceptance attempt.

`cargo test`: **83 passed, 0 failed**, plus 11 + 4 doc-tests. `cargo clippy --all-targets -- -D warnings`: **clean**. `cargo fmt` applied.

**Disclosed — two of my own test defects, found and fixed:**
- I first asserted `PayloadLengthMismatch` for an under-declared length; the parser correctly reports `TrailingData` first. **My expectation was wrong, not the parser.** The test now asserts both paths explicitly.
- Clippy rejected my ceiling test as constant-valued — it compared consts, a tautology. Replaced with one measuring **actual encoded frame lengths**; the constants are pinned at compile time instead.

---

## 11. Mutations — 7, all killed, all restored byte-identically

| # | Mutation | Named failure |
|---|---|---|
| M1 | break protocol-version validation | test `bad_magic_and_bad_version_are_refused` FAILED |
| M2 | give `TrustedPeerContext` a public constructor | validator **O7** |
| M3 | drop the binding digest from encoding | test `distinct_bindings_encode_distinctly` FAILED |
| M4 | remove correlation enforcement from `answers()` | test `a_response_answers_only_its_own_correlation_and_epoch` FAILED |
| M5 | remove service-epoch separation from `answers()` | same test FAILED |
| M6 | add a free-form `String` field | validator **O2** |
| M7 | make `is_closed()` return `true` | validator **O5** |

**Disclosed:** my first attempt at M1 removed a compile-time ceiling assert and was caught by **O4** — a real kill, but **not the mutation its label claimed**. I re-ran M1 properly against version validation. A mutation that fails for the wrong reason is not the test.

Every file restored byte-identically (`cmp`); clean rerun afterwards: **83/83 tests, validator PASS**.

---

## 12. InstalledHostStatus compatibility

**Not overloaded.** Discriminant still **8**, payload still `INSTALLED_HOST_STATUS_LEN`, encoder/decoder untouched, and `val-cd-b4-installed-host-status-contract1a` **PASS**. `val-windows-local-ipc-capability-b3` also **PASS**.

**One existing test was deliberately rebaselined**: `message_kinds_round_trip_and_unknown_fails_closed` asserted that discriminant 9 was unknown. It now round-trips all ten kinds and pins **11** as the first unassigned. The set stays *closed* — that assertion is exactly what makes a silently added kind fail — it now closes one discriminant later, by design.

---

## 13. Feature and default-graph impact

The contract is **unconditional** — no new feature, no `cfg` gate, no fixture surface. It compiles into the default graph as inert types, which is safe precisely because nothing in it can reach an effect. No dependency, package or lockfile change; `test-fixtures` remains outside the production graph.

---

## 14. Adversarial review

1. **Can wire data create trusted authority?** No — layer 1 is public and inert; layers 2 and 3 are sealed and unconstructible.
2. **Can public fields or constructors forge approval?** No — `approval_ref` is a reference; there is no approval type here to forge.
3. **Can one project's request satisfy another?** Not by construction: the binding digest differs and encodes distinctly (M3). Enforcement of the comparison is phase 4.
4. **One environment for another?** Same answer — both are inside the binding digest.
5. **Provider or operation substitution?** `operation` is a closed enum; substitution changes the bytes (M3).
6. **Can an old response satisfy a new instance?** No — `answers()` requires the epoch to match (M5).
7. **`Accepted` confused with `Completed`?** No — distinct states, and `Accepted` carries `NotRun`.
8. **Can C4-open requests reach accepted?** No — checked first, single-variant gate, validator refuses acceptance inside the evaluator (M7).
9. **Can a secret or reusable authority cross the wire?** Not representable (M6).
10. **Did `InstalledHostStatus` behaviour change?** No.

**Review stack — USED:** protocol-contract, confused-deputy, authority-forgery, untrusted-DTO, replay-contract, secret-flow, framing/parser, project/environment/provider isolation, C4 hard-stop, fixture/default-graph, repository-boundary, adversarial self-review, plus `cargo clippy -D warnings`. **AVAILABLE BUT NOT APPLICABLE:** ECC review agents (not invoked), Obsidian. **NOT APPLICABLE:** UI UX Pro Max, Flow Motion, Figma. **PROHIBITED:** Provider MCP — not invoked.

---

## 15. Machine non-interference

Before and after: service `Stopped` / `Manual` / `DEMAND_START`; installed executable path, SHA-256 `512820C7…72BB9C56`, size and timestamps unchanged; F1 descriptors unchanged; ProgramData unchanged; no ProjectOSHost process; no ProjectOS pipe; no credential or provider activity. The service was never started, and all builds went to isolated target roots outside the repository.

---

## 16. Remaining work

**Phase 2** kernel-attested peer identity (mints `TrustedPeerContext`) · **Phase 3** non-elevated transport, second pipe, DACL, installer · **Phase 4** live correlation, sequence and epoch enforcement · **Phase 5** integrated synthetic proof. **F4** DPAPI restart survival and **F5** durable single-use consumption remain separate and untouched.

Carried forward from the preflight and **not** addressed here: the unsealed `VerifiedApproval` and `ConfirmedHandshakeEvidence` in `core`. This phase introduced **new sealed types instead of changing them**, exactly as §6 of the gate permits; their migration belongs to phase 2, where they first become load-bearing.

---

## 17. Programme position

`acceptedPhaseCount` **4 / 19**, **21.1**, `EXECUTION_READY` **false**, `installationAuthority` **NotAuthorised**. **F2, F3, F4, F5 remain OPEN. C4, C6 OPEN; C7 OPEN / PROHIBITED.** This phase closes neither F2 nor F3 by itself, and **no protected operation is authorised**. The installed binary was not replaced and custody is not shipped.

---

## 18. Decision requested

**ACCEPTED — IPC OPERATION CONTRACT CAPTURED**

The contract is defined and the path to an effect is provably absent: a secret cannot be spelled on this wire, the trusted peer type has no constructor, and the C4 gate is checked first and cannot report closed. Seven mutations confirm each of those, and two of my own test defects were found, disclosed and corrected rather than smoothed over.

The judgement worth your attention is §13: the contract compiles **unconditionally** into the default graph rather than behind a feature. I chose that because inert types with no reachable effect are safer visible than hidden behind a flag someone later flips — but if you would rather phase 1 sat behind a non-default feature until phase 2 lands, that is a one-line change and your call.
