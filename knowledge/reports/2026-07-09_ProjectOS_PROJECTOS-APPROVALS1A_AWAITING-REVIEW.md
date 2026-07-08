# PROJECTOS-APPROVALS1A — Approval Loop (Evidence Pack)

> **Scope:** Wire the core approval engine to the CLI, completing request→decide→record.
> Local-file-only (`.projectops/approvals/`). No deploy/DB/network/secrets/push.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-APPROVALS1A (LOCAL_AGENT / APPROVALS) — over CORE1A/LOCAL-AGENT1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core (local; not pushed).
5. **Files added:** `projectos/agent/src/approvalStore.ts` (persist ApprovalRequest JSON), `projectos/agent/src/commands/approve.ts`. **Changed:** `cli.ts`/`index.ts` (route + exports).
6. **Command:** `projectos approve <request|decide|show|list>`:
   - `request --id --action [--as]` — classifies via the risk engine (gate/risk/gated/prohibited) and persists a pending request.
   - `decide --id --decision approved|rejected --as <role> [--override] [--note]` — gated ⇒ owner-only (non-owner → exit 2); prohibited ⇒ requires `--override` (→ exit 2 without it); already-decided → exit 1.
   - `show`/`list`.
7. **Governance:** decisions run through `core.decide`, so the CLI cannot bypass owner-only/prohibited rules. Mirrors and complements the phase runtime's gated transitions.
8. **Tests:** agent suite now 42 tests (5 new): gated owner-only (blocked vs owned), prohibited needs override, ungated self-decide, flag/missing validation, duplicate refusal + empty list/show + unknown subcommand. `approve.ts` 100% stmts; `approvalStore.ts` 92%; agent overall 98.7%.
9. **Typecheck + build:** strict `tsc` EXIT 0.
10. **Real-binary verification (scratch dir):** `approve request A1 "deploy to prod"` → risk critical (productionDeployGate), gated true; non-owner decide → `requires role 'owner'`, **exit 2**; owner decide → approved, **exit 0**; `show` prints persisted decision + note.
11. **Framework validators:** unchanged.
12. **Secrets / external / gated actions:** none.
13. **Rollback:** delete `approvalStore.ts` + `commands/approve.ts`; revert cli/index/test edits.
14. **Carry-forward:** approvals aren't yet linked to a phase transition (a phase could require an approved gate before advancing) — natural follow-up; orchestration will consume both.
15. **Decision needed:** owner/advisor review + closure.

## Final status
**PROJECTOS-APPROVALS1A — AWAITING-REVIEW.** Approval loop wired + verified; 42 tests @ 99%. No gated action performed, no secrets, no push.
