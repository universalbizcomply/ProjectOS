# PROJECTOS-ORCHESTRATION1A — Orchestration + Plan (Evidence Pack)

> **Scope:** Turn the workflow + worker model into an execution plan (who owns each step).
> Pure core module + a read-only `projectos plan` view. No deploy/DB/network/secrets/push.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-ORCHESTRATION1A — roadmap Phase 10 (executor/plan layer), over WORKERS1A/CORE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core (local; not pushed).
5. **Core module:** `projectos/core/src/orchestration.ts` — `planWorkflow(registry)` maps each `WORKFLOW_STEP` to the first worker whose mapped role owns it, flags the owner-gated closure step; `unassignedSteps(registry)`; `DEFAULT_WORKERS` (Murad=owner, ChatGPT=reviewer, Claude=implementer). Additive core export.
6. **CLI:** `projectos plan` renders the plan over `DEFAULT_WORKERS` (read-only).
7. **Design note:** ProjectOS produces the plan; it does not itself run external AIs. "Executor" = plan a human/surface acts on. Deterministic.
8. **Tests:** core +1 file (3 tests: full assignment, role routing, empty-registry unassigned) — orchestration.ts 100%; core suite 50 tests @ 99.45%. Agent +1 test (plan output) — agent suite 43 tests.
9. **Typecheck + build:** strict `tsc` EXIT 0 (both packages).
10. **Real-binary verification:** `projectos plan` →
    ```
    prompt     advisor     ChatGPT
    implement  implementer Claude Code
    validate   implementer Claude Code
    evidence   implementer Claude Code
    review     advisor     ChatGPT
    closure    owner       Murad  [owner-gated]
    ```
11. **Framework validators:** unchanged.
12. **Secrets / external / gated actions:** none.
13. **Rollback:** delete `orchestration.ts` + its test + `commands/plan.ts`; revert index/cli/test edits.
14. **Carry-forward:** workers are the DEFAULT set (not yet persisted/configurable per project); a `.projectops/workers.json` + `plan --phase` linkage is the follow-up. No execution of external providers (by design).
15. **Decision needed:** owner/advisor review + closure.

## Final status
**PROJECTOS-ORCHESTRATION1A — AWAITING-REVIEW.** Workflow→worker execution plan implemented + verified; core 50 tests @ 99%, agent 43. No gated action, no secrets, no push.
