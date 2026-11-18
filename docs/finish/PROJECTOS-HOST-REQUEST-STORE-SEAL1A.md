# PROJECTOS-HOST-REQUEST-STORE-SEAL1A - finish record

Spec: `docs/changes/delta_spec.md`, section "PROJECTOS-HOST-REQUEST-STORE-SEAL1A" (plan v1.44; owner 2026-11-18: seal it, separate phase, edit of a PROTECTED security-boundary file approved).
Branch `projectos-host-request-store-seal1a`, base `a2f97ba3`. Option (c) of the spec: replace the value-returning trait method by a predicate.
Builder record. The independent ECC `security-reviewer` / `rust-reviewer` pass is arranged by the lead and is NOT part of this record.

## Existing code found

The spec's line numbers were re-checked against the file before editing and matched: trait `RequestAdmissionStore` declared at line 498 with `fn session_digest(&self) -> [u8; 32];` at 500, impl at 571, one caller at 749 (`admit_request`), the seal compile-fail doctest at 478-488, `BoundIpcSession::session_digest` `pub(crate)` at 312, `AdmittedRequest::session_digest` `pub(crate)` at 693, `mod sealed { pub trait Sealed {} }` empty at 774.
No caller of a store's `session_digest` exists outside `ipc_session.rs`. Other users of the trait: `windows-local-ipc` (`&mut dyn RequestAdmissionStore`), `gatekeeper-review-composition/src/review_dispatch.rs` (`&'a mut dyn RequestAdmissionStore`, line 234) and `service-host` (`InMemoryRequestAdmissionStore::for_session`). None needed an edit.
Validator `val-cd-b4-sealed-expected-window-facts1a` V2 pins `pub(crate) fn session_digest(` and the absence of `pub fn session_digest(`; a trait method is invisible to that regex, which is why the leak survived.

## What changed

Only the files on the phase write list. Nothing under `projectos/host` other than `core/src/ipc_session.rs` and `core/tests/ipc_session_authority.rs`. No service install/start, ACL or registry change. `docs/06_Plan.md` and `docs/changes/delta_spec.md` untouched.

`projectos/host/core/src/ipc_session.rs` (final line numbers):
- trait declaration (531): `fn session_digest(&self) -> [u8; 32];` became `fn is_bound_to(&self, session: &BoundIpcSession) -> bool;` with a doc comment saying it is a predicate, not a getter.
- impl for `InMemoryRequestAdmissionStore` (602-604): `self.session_digest == session.session_digest()` (the crate-private getter).
- `admit_request` (780): `if !store.is_bound_to(self) { return Err(StoreNotBoundToSession) }`.
- seal compile-fail doctest (482): implements `is_bound_to` instead of `session_digest`, so it still fails because of the seal (the supertrait `Sealed` is not nameable) and not because a method is missing.
- new doctests on the trait: two `compile_fail` blocks (generic `s.session_digest()` and concrete `store.session_digest()`), one positive block (generic, concrete and `dyn RequestAdmissionStore` call of `is_bound_to`, plus `last_sequence` on the concrete store).
- `mod sealed { pub trait Sealed {} }` is still empty; `BoundIpcSession::session_digest` and `AdmittedRequest::session_digest` are still `pub(crate)`.

`projectos/host/core/tests/ipc_session_authority.rs`: new test `a_store_answers_only_whether_it_is_bound_to_a_session` (own session true, another session false, also through `&dyn RequestAdmissionStore`). The existing `a_store_from_another_session_is_refused` is unchanged and still asserts `StoreNotBoundToSession`.

`projectos/validators/val-cd-b4-sealed-expected-window-facts1a.cjs`: `STORE_CONTROL` (compiles `last_sequence` and `is_bound_to` through a generic bound and the concrete store, trait imported with `use ... as _`), two negatives `neg_store_session_digest_generic` and `neg_store_session_digest_concrete` beside `neg_ipc_session_digest`, each importing the trait (so "trait not in scope" cannot be the reason) and each required to fail with ``no method named `session_digest` found`` (a new optional `expect` regex), and a failure if the store control does not compile.

## Rule -> test

| Rule (spec) | Test |
| --- | --- |
| 1 No public item of host core returns a store's session digest | doctests `RequestAdmissionStore` (line 504, generic) and (line 509, concrete) `compile_fail`; validator `neg_store_session_digest_generic` / `_concrete` (must fail with "no method named `session_digest`"); validator V2 (`pub(crate)` getters, no public alias) |
| 2 A store answers only whether it is bound; another session's store is still refused | integration `a_store_answers_only_whether_it_is_bound_to_a_session`; existing `a_store_from_another_session_is_refused` (`StoreNotBoundToSession`) unchanged and green; positive doctest (line 518) |
| 3 Still sealed and object-safe | seal doctest (line 478) `compile_fail`; positive doctest uses `&dyn RequestAdmissionStore`; the integration test calls it through `&dyn`; `windows-local-ipc`, `gatekeeper-review-composition` and `service-host` still compile |
| 4 `session_digest` stays `pub(crate)` on `BoundIpcSession` and `AdmittedRequest` | validator V2 in `val-cd-b4-sealed-expected-window-facts1a`; `neg_ipc_session_digest`; existing `AdmittedRequest` compile-fail doctests |

## Evidence (toolchain 1.96.1, `--offline`, `CARGO_TARGET_DIR` outside the tree)

RED, before the production change (tests written first):
- `cargo test --offline --doc` in `projectos/host/core`: 8 passed, 3 failed. The two new `compile_fail` blocks failed with "Test compiled successfully, but it's marked `compile_fail`" (the leak was real) and the positive block failed with E0599 `no method named is_bound_to`.
- `cargo test --offline --features test-fixtures --test ipc_session_authority`: did not compile, E0599 `is_bound_to` (4 errors).
- `node projectos/validators/val-cd-b4-sealed-expected-window-facts1a.cjs`: FAIL, the store control did not compile (no `is_bound_to`) and both `neg_store_session_digest_*` compiled ("EXPECTED-FACTS LEAK POSSIBLE").

GREEN, after the change:
- `projectos/host/core`: `cargo test --offline --features test-fixtures` exit 0. lib 111, api_boundary 12, effect_grant_integration 75, elevation_integration 41, ipc_session_authority 38, operation_phase_binding_contract 9, operation_transitions 11, owner_presence_fact_binding 4, owner_presence_integration 30, owner_presence_repository_binding 5, production_ipc_provider 13, production_owner_presence_provider 16, production_runtime_provider 14, production_trusted_clock 3, protected_plan_authority_integration 10, reducer_fail_closed 15, repository_authority_integration 15, repository_fact_binding 4, runtime_instance_authority 17, runtime_ipc_permit_integration 20, doc-tests 11; 0 failed.
- `projectos/host/core`: `cargo test --offline --doc` exit 0, 11 passed (the three RED doctests now pass).
- `projectos/host/windows-local-ipc`: `cargo test --offline` exit 0, 228 + 11 + 0 + 0 + 6 + 39 = 284 passed, 0 failed.
- `projectos/host/gatekeeper-review-composition`: `cargo build --offline --tests` exit 0 (not asked for; it is the other dependent of the trait).
- `projectos/host/service-host`: `cargo build --offline --tests` exit 0 (it builds on this machine; it was built only after the change, no before-run was made).
- Validators, each printed PASS: `val-cd-b4-sealed-expected-window-facts1a`, `val-cd-b4-ipc-session-authority1a`, `val-cd-b4-production-ipc-provider1a`, `val-cd-b4-runtime-ipc-permit-integration1a`, `val-cd-b4-owner-presence-integration1a`, `val-cd-b4-provider-authority-seam1a`, `val-cd-b4-control-centre-window-observation-bridge1a` (its source names `ipc_session`), `validate-no-secrets`. Each was run as `node projectos/validators/<name>.cjs`; the PASS line is the evidence (the first five listed had their own exit status read, exit 0; for the last three only the PASS line was read).

## What is NOT proved

- `validate-all` and the TypeScript agent suite were not run (the lead runs `validate-all` once).
- `compile_fail` doctests on stable do not pin the error code; the "fails because of absence" claim for the doctests rests on the positive control that differs only in the method name. The validator negatives DO pin the reason (the compiler message must say the method does not exist).
- No mutation run was made on the production code other than the RED state (pre-change). `is_bound_to` is a predicate over the same digest comparison the old getter fed, a downstream holder of a `BoundIpcSession` can still ask a store whether it is bound to it; that is the intended oracle (one bit, only for a session the caller already holds).
- The durable store the trait exists for does not exist yet; nothing here constrains how its `is_bound_to` will be implemented (a future implementation must compare in constant time if it ever compares attacker-influenced bytes; the in-memory one compares two host-held digests).
## Review (2026-11-18)

- ECC `security-reviewer` (independent, mandatory): **APPROVE**. No CRITICAL, HIGH or MEDIUM. No public path to a store's or session's digest remains (no derives, Deref, serde or public fields; hand-written redacted Debug; field-less error enum; no default trait method; `lib.rs` re-exports types and traits only). `is_bound_to` is not a useful oracle: a `BoundIpcSession` can only be minted through the sealed verifier and a runtime instance and authority time, and each query returns one bit about equality with a SHA-256 output the old `admit_request` already exposed through `StoreNotBoundToSession`. Comparison correct and not inverted; trait still sealed (`mod sealed` empty) and object-safe; the doctests and validator negatives are not vacuous (the expected compiler message is pinned by the validator); no PROTECTED file touched; the other validators that read `ipc_session.rs` still match by reading.
- ECC `rust-reviewer`: **APPROVE**. No CRITICAL, HIGH or MEDIUM. Trait design, impl, caller mapping, visibility, doctests, the new integration test (kills constant-true, constant-false and inverted comparisons) and idioms checked by reading.
- Neither reviewer ran cargo or a validator; the cargo and validator results above are the builder's, and the lead runs `validate-all` once on the merged stack.

## Carry-forwards (LOW and INFO, not fixed)

- The doc text at `ipc_session.rs` lines 499 to 502 says the two `compile_fail` blocks are "identical to the positive control ... except for the one method they call"; they differ in signature (the control takes `&BoundIpcSession` and returns `bool`). Reword to "the same receiver shapes and trait imports" at the next edit of that file.
- The plain `compile_fail` seal doctest (lines 478 to 488) cannot name its own failure on stable rustdoc; if its `is_bound_to` signature drifted it would still fail, for E0053. A second validator negative could pin "Sealed" or "private". The weakness predates this phase.
- A future durable store's `is_bound_to` is not forced to be constant-time or `#[must_use]`; the in-memory one compares two host-held digests, so nothing is exploitable today.
- By design and unchanged: `with_expected_window_facts` passes both digests to a downstream-implementable `ExpectedWindowFactsSink` that requires a borrowed `ProviderCapabilitySet` (pinned by V3 and V4 of the sealed-facts validator).
- The validator guards the NAME `session_digest`, not the shape: a differently named trait getter returning `[u8; 32]` would not be caught. Optional hardening: a source pin that the `RequestAdmissionStore` trait body contains no `[u8; 32]`.
