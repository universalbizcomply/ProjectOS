# PROJECTOS-CORE1A — Core Engine Kernel (Evidence Pack)

> **Scope:** Introduce the ProjectOS V2 kernel — a pure, deterministic TypeScript
> engine (`projectos/core/`) that every future surface (Local Agent CLI, Control
> Center, Cloud Dashboard) will drive. Pure logic only: no deploy, no DB, no network,
> no real send, no secrets, no push. Framework `.cjs` validators untouched and still PASS.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-CORE1A (CORE_ENGINE / GOVERNANCE_KERNEL) — implements roadmap Phase 1, on the design from PROJECTOS-CORE-ARCHITECTURE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated (Murad/ChatGPT); Claude does not self-close.
4. **Branch:** projectos-v2-core (off `main`; not pushed — remote publish is owner-gated).
5. **Objective:** Encode the governance model (phase lifecycle, roles, safety gates, approvals, risk, events, config, discovery, plugins, workflow) as isolated, unit-tested modules.
6. **Design doc:** `projectos/docs/core-architecture.md` (Phase 0 deliverable).
7. **Package:** `projectos/core` — `@projectos/core` v0.1.0, ESM, self-contained (own package.json/tsconfig/vitest). Root remains CommonJS; existing validators are `.cjs` and unaffected.
8. **Modules created (src/):**
   - `types.ts` — roles, phase/task statuses, risk levels, 8 canonical gate keys, `Result<T>`.
   - `phase.ts` — phase lifecycle state machine + `transitionPhase` (owner-only closure).
   - `task.ts` — task state machine (blocked requires reason).
   - `permissions.ts` — role→action matrix; owner-only = approve/reject/close/override.
   - `risk.ts` — `classifyAction` → gate + risk; default gate set mirrors `safety-gates.schema.json`.
   - `approval.ts` — request/decide; gated ⇒ owner-only; prohibited ⇒ explicit override.
   - `events.ts` — immutable append-only log + minimal `EventBus`.
   - `config.ts` — pure validate of project-config (mirrors `project-config.schema.json`).
   - `discovery.ts` — pure parsers: remote URL → repo slug, `.git/HEAD` → branch.
   - `plugins.ts` — immutable plugin registry, resolve by capability.
   - `workflow.ts` — canonical ordered workflow steps + `nextStep`.
   - `index.ts` — public API surface + `CORE_VERSION`.
9. **Design rules enforced:** pure & deterministic (no `Date.now`/`Math.random`/IO in core — timestamps/ids injected); immutable (engines return new objects); `Result<T>` for expected failures; schema-aligned types.
10. **Tests:** 42 tests across 3 files (`state-machines`, `governance`, `support`); happy + rejection paths (illegal transition, denied permission, non-owner closure/approval, prohibited-without-override, invalid config).
11. **Coverage:** 99.34% statements / 96.72% branches / 100% functions — exceeds the 80% minimum. `src/index.ts` (re-exports) excluded.
12. **Typecheck:** `tsc --noEmit` strict (incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) — EXIT 0.
13. **Build:** `tsc` emits `dist/` (JS + d.ts + maps) — EXIT 0. `dist/` and `node_modules/` git-ignored.
14. **Framework validators:** `npm run validate` → `validate-all: ALL PASS` (no framework file changed).
15. **Secrets:** none. No env, no keys, no tokens read/printed/committed.
16. **External services / MCP:** none. No network calls; no external tools used.
17. **Gated actions performed:** none (no deploy/DB/send/payment/force-push/secrets).
18. **Security review:** kernel is inert domain logic. It *encodes* gates (owner-only closure/approval, prohibited-override) rather than performing anything. `EventBus` is the only stateful piece and is edge-only. No `eval`, no dynamic import, no IO.
19. **Files outside scope touched:** none. (Pre-existing uncommitted `dashboard-hosting/public→assets` change left untouched and NOT included in this commit.)
20. **Rollback plan:** delete `projectos/core/` and `projectos/docs/core-architecture.md`; drop branch `projectos-v2-core`. No shared/framework state altered.
21. **Risks / carry-forward:** (a) core has no persistence yet — SQLite lands in the Local Agent phase; (b) fs/git adapters deferred to the CLI phase; (c) `risk.ts` keyword map is deliberately conservative and should be extended per-project as real actions are catalogued.
22. **Decision needed:** Owner/advisor review of the kernel API + governance encoding, and closure decision for PROJECTOS-CORE1A. Next phase on approval: PROJECTOS-LOCAL-AGENT1A (CLI over this core).

## Closure criteria
- [x] `projectos/core/` builds and typechecks clean.
- [x] ≥80% test coverage (achieved 99%+).
- [x] Governance rules encoded: owner-only closure, gated-approval owner-only, prohibited-override.
- [x] Existing framework validators still PASS.
- [ ] Owner/advisor review + closure (owner-gated — not done by Claude).

## Final status
**PROJECTOS-CORE1A — AWAITING-REVIEW.** Kernel implemented, typechecked, built, 42 tests green at 99% coverage; framework validators ALL PASS. No gated action, no secrets, no push. Awaiting owner/advisor review and closure.
