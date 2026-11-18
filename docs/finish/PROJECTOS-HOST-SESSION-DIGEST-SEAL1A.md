# PROJECTOS-HOST-SESSION-DIGEST-SEAL1A — finish record

Spec: `docs/changes/delta_spec.md`, section "Plan v1.37 — PROJECTOS-HOST-SESSION-DIGEST-SEAL1A" (owner "Approved all", 2026-11-17, including the edit to a PROTECTED file).
Branch `projectos-host-session-digest-seal1a`, based on `f60dd66c`; merged on the plan branch as `58599b45`. This record was written on 2026-11-18 by the lead from the delta spec, the commit
message of `72f7fcb7`, the handoff and the full-stack run below; no `docs/finish/` file existed for this phase before.

## Existing code found

`val-cd-b4-sealed-expected-window-facts1a` (rule V2, since 2026-07-31) requires `session_digest` getters in host core to be `pub(crate)`.
`AdmittedRequest::session_digest` was added `pub` on 2026-09-07 (`693bc75d`), after the rule, and was the validator's one failure in every full run since (carried to Stage 4 by plan v1.34 onward).
A search of `projectos/host` found no caller of it outside the crate and no Rust test using it.

## What changed

`projectos/host/core/src/ipc_session.rs`: `pub fn session_digest` on `AdmittedRequest` became `pub(crate) fn session_digest` (line 693 on the merged tree). One line, commit `72f7fcb7`
(1 file changed, 1 insertion, 1 deletion). Nothing else under `projectos/host` changed. No service install, start, ACL or registry change.

## Evidence

- `cargo test` passes in `projectos/host/core` (doctests included) and in `projectos/host/windows-local-ipc` (per the commit message of `72f7fcb7`, run on the phase branch).
- Full stack at `c2eec705` on 2026-11-18, one `validate-all` run with nothing else running: **183 registered, 183 PASS, 0 FAIL, 2 retired, exit 0**.
  `val-cd-b4-sealed-expected-window-facts1a` PASS and `val-cd-b4-ipc-session-authority1a` PASS. The one known failure carried since plan v1.34 is gone.
- Suites on the same stack, first run: core 5091/5091, agent 4659/4659, control-center 952/952.

## Review

ECC `security-reviewer`: APPROVE on the one-line diff and the cargo output (handoff record, 2026-11-17).

## Carried

- The same digest is still readable through the public trait method `RequestAdmissionStore::session_digest` (`ipc_session.rs` line 500, trait declaration; implemented at line 571).
  Owner decision: whether to seal that too. Not part of this phase.
