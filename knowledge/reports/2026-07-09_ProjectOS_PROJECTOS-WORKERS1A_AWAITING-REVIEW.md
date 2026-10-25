# PROJECTOS-WORKERS1A — Worker Model (Evidence Pack)

> **Scope:** Add the provider-agnostic worker model to the core (`projectos/core/src/workers.ts`).
> Pure logic only. No orchestration executor yet — this phase delivers the model + permission
> mapping that a later orchestration phase will consume. No deploy/DB/network/secrets/push.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-WORKERS1A (WORKER_MODEL) — roadmap Phase 10 (model layer), over CORE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core (off `main`; not pushed).
5. **Objective:** Encode "workers replace hardcoded AI": a worker has a functional TYPE and a PROVIDER; any provider (Claude Code, ChatGPT, human, future model) can fill a slot without changing the operating model. Permissions reuse the existing role matrix.
6. **Module:** `workers.ts` — `WorkerType` (11 roadmap types: owner/reviewer/implementer/security/database/testing/ux/documentation/research/marketing/deployment), `Worker`, immutable `WorkerRegistry`, `registerWorker`, `getWorker`, `workersOfType`, `assignForCapability`, `roleForWorkerType`, `canWorkerPerform`.
7. **Governance:** `roleForWorkerType` maps owner→owner, reviewer/research→advisor, all doing-workers→implementer; `canWorkerPerform` defers to `permissions.can`, so worker permissions stay driven by the single role matrix (e.g. only an `owner` worker can `close_phase`).
8. **Tests:** 5 tests (`test/workers.test.ts`) — type list, role mapping, register/resolve/assign, duplicate rejection, permission enforcement via mapped role.
9. **Coverage:** `workers.ts` 100%; core overall 99.41% statements / 97.05% branches / 100% functions.
10. **Typecheck + build:** strict `tsc` EXIT 0. Added `export * from './workers.js'` to the core public API (additive; CORE_VERSION unchanged at 0.1.0).
11. **Framework validators:** unchanged; `npm run validate` ALL PASS (no framework file touched).
12. **Secrets / external / gated actions:** none.
13. **Rollback:** delete `workers.ts` + its test, revert the one-line index export.
14. **Risks / carry-forward:** the worker model has no executor — an orchestration phase (assign work → run via a provider adapter → collect evidence) is the natural follow-up and is where real multi-AI coordination lands. Provider strings are free-form; a provider registry could be added later.
15. **Decision needed:** owner/advisor review + closure. This is a foundational, unblocked slice; the remaining roadmap phases need owner input (repo path / cloud accounts) or toolchains — see the session checkpoint.

## Closure criteria
- [x] Worker model implemented, 100% covered, strict build clean.
- [x] Permissions reuse the role matrix (owner-only closure preserved for owner workers).
- [x] Core public API additive; no breakage.
- [ ] Owner/advisor review + closure (owner-gated).

## Final status
**PROJECTOS-WORKERS1A — AWAITING-REVIEW.** Provider-agnostic worker model added to the core; 100% covered; build green. No gated action, no secrets, no push.
