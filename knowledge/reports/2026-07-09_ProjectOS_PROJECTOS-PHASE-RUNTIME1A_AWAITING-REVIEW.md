# PROJECTOS-PHASE-RUNTIME1A — Phase Runtime (Evidence Pack)

> **Scope:** Make ProjectOS actually *run* phases. Adds phase persistence + a `projectos
> phase` command that drives the core lifecycle state machine with governance enforced.
> Local-file-only (`.projectops/phases/`). No deploy/DB/network/secrets/push.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-PHASE-RUNTIME1A (LOCAL_AGENT / PHASE_RUNTIME) — extends LOCAL-AGENT1A, over CORE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core (off `main`; not pushed).
5. **Objective:** Persist core `Phase` objects and advance them through `draft→…→closed` via the CLI, with owner-only closure enforced at the CLI just as in the core.
6. **Files added:** `projectos/agent/src/phaseStore.ts` (JSON load/save/list under `.projectops/phases/<id>.json`), `projectos/agent/src/commands/phase.ts`. **Changed:** `cli.ts` (parseArgs now captures positional subcommands; routes `phase`), `index.ts` (exports).
7. **Command:** `projectos phase <new|advance|show|list>`:
   - `new --id --project [--objective] [--force]` — creates a draft phase; refuses overwrite without `--force` (exit 2).
   - `advance --id --to <status> [--as owner|advisor|implementer] [--note]` — loads, applies `core.transitionPhase`, saves. Illegal transition → exit 1; owner-gated closure by non-owner → exit 2.
   - `show --id` — status + full transition history.
   - `list` — all phases with status.
8. **Governance:** closure (`closed`/`closed_as_blocked`) requires `--as owner`; the core rejects otherwise and the CLI surfaces exit 2. The runtime cannot bypass the kernel's rules — it *is* the kernel driven over persisted state.
9. **Tests:** agent suite now 33 tests (8 new for the runtime): create/persist, overwrite refusal, full happy-path advance + history, illegal transition (exit 1), non-owner close blocked (exit 2) vs owner close (exit 0), flag/status validation, list/show empty+missing, unknown subcommand.
10. **Coverage:** agent overall 99.08% statements / 94.52% branches / 100% functions; `phase.ts` 100% stmts, `phaseStore.ts` 92%.
11. **Typecheck + build:** strict `tsc` EXIT 0.
12. **Real-binary verification (nodeSystem, scratch dir):**
    - `phase new RT1A` → draft; `advance --to prompted --as advisor` → draft→prompted.
    - Non-owner `advance --to closed --as implementer` → `Transition to 'closed' requires role 'owner'`, **exit 2**.
    - Owner `advance --to closed --as owner --note accepted` → awaiting_closure→closed, **exit 0**.
    - `show` printed the full 7-step history incl. the owner note; `list` → `RT1A: closed`.
13. **Framework validators:** unchanged; no framework file touched.
14. **Secrets / external / gated actions:** none.
15. **Rollback:** delete `phaseStore.ts` + `commands/phase.ts`, revert the `cli.ts`/`index.ts` additions and the new tests.
16. **Risks / carry-forward:** (a) phase JSON is trusted on read (shape not re-validated — a hand-edited file could carry an unexpected status; a load-time validator is a follow-up); (b) no approval-record persistence yet (the approval engine exists in core but isn't wired to a `projectos approve` command) — natural next slice; (c) no phase↔evidence-report linkage yet.
17. **Decision needed:** owner/advisor review + closure. Next unblocked slice could wire `projectos approve` (persist approvals) or phase↔report linkage; the higher-value steps (install into a real repo, cloud dashboard) still need owner input.

## Closure criteria
- [x] Phases persist and advance through the lifecycle via the CLI.
- [x] Owner-only closure enforced at the CLI (verified exit 2 vs 0).
- [x] ≥80% coverage (99%); strict build clean; real binary verified end-to-end.
- [ ] Owner/advisor review + closure (owner-gated).

## Final status
**PROJECTOS-PHASE-RUNTIME1A — AWAITING-REVIEW.** ProjectOS now runs phases end-to-end with governance enforced; 33 tests @ 99% coverage; real binary verified. No gated action, no secrets, no push.
