# PROJECTOS-PLUGINS1A — Integration Catalog (Evidence Pack)

> **Scope:** Add the built-in, INERT integration plugin catalog + a `projectos plugins`
> view. No plugin executes anything; catalog is declarations only. No deploy/DB/network/
> secrets/push.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-PLUGINS1A — roadmap Phase 11 (catalog layer), over CORE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core (local; not pushed).
5. **Core module:** `projectos/core/src/plugin-catalog.ts` — `CATALOG_PLUGINS` (12: github, github-actions, vercel, supabase, docker, playwright, ecc, figma, slack, teams, jira, azure-devops) + `defaultCatalog()`. Each manifest declares capabilities + `external` (owner-gated by policy). Additive core export.
6. **CLI:** `projectos plugins` lists the catalog (id, external/local, capabilities). Read-only.
7. **Inert by design:** the catalog only *declares* integrations; nothing is invoked. External integrations remain owner-gated per the safety model.
8. **Tests:** core +1 file (3 tests: registration/no-dupes, capability resolution, external flags) — core suite 53 @ ~99%. Agent +1 test (plugins output) — agent suite 44.
9. **Typecheck + build:** strict `tsc` EXIT 0 (both packages).
10. **Real-binary verification:** `projectos plugins` → `Integration catalog (12, inert)` with external/local flags + capabilities.
11. **Framework validators:** unchanged.
12. **Secrets / external / gated actions:** none.
13. **Rollback:** delete `plugin-catalog.ts` + its test + `commands/plugins.ts`; revert index/cli/test edits.
14. **Carry-forward:** no plugin executor/adapters (by design at this stage); wiring a real integration (e.g. GitHub PR creation) would be its own owner-approved phase with the external gate.
15. **Decision needed:** owner/advisor review + closure.

## Final status
**PROJECTOS-PLUGINS1A — AWAITING-REVIEW.** Inert integration catalog + `plugins` view; core 53 tests, agent 44; builds green; verified. No gated action, no secrets, no push.
