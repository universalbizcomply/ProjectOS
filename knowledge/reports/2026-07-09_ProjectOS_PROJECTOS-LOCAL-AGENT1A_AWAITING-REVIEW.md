# PROJECTOS-LOCAL-AGENT1A — Local Agent CLI (Evidence Pack)

> **Scope:** The `projectos` CLI (`projectos/agent/`) — the local execution surface over
> the CORE1A kernel. Read-only or local-file-only actions. No deploy, no DB, no network,
> no real send, no secrets, no push. Closure command deliberately refuses (owner-gated).

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-LOCAL-AGENT1A (LOCAL_AGENT / CLI) — roadmap Phase 3, over PROJECTOS-CORE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated; Claude does not self-close.
4. **Branch:** projectos-v2-core (off `main`; not pushed).
5. **Objective:** Provide `projectos status/init/validate/prompt/report/close` driven by the core, with the only impurity isolated in a `System` adapter so all command logic is unit-tested.
6. **Package:** `projectos/agent` — `@projectos/agent` v0.1.0, ESM, bin `projectos`. Depends on `@projectos/core` via `file:../core`.
7. **Architecture:** `System` interface (fs/git/clock/exec) with a `nodeSystem` implementation = the sole impure edge. Every command is a pure function `(ctx, flags) -> { code, lines }`, tested with an in-memory `FakeSystem`.
8. **Commands:**
   - `status` — git branch/remote (via core `parseRemoteUrl`), validated `.projectops/project-config.json` (core `parseProjectConfig`), protected-branch flag, report counts. Read-only.
   - `init --id …` — scaffolds `.projectops/project-config.json` (+ phases/ reports/), validated by the core before write; refuses overwrite without `--force`.
   - `validate [--framework]` — validates the project-config; `--framework` shells to `npm run validate` and surfaces its exit code.
   - `prompt --phase …` — renders a Claude phase prompt (mirrors `claude-phase-prompt.template.txt`); `--out` writes to a file.
   - `report [--phase …]` — lists reports, or writes an evidence-pack skeleton with the canonical name; refuses overwrite without `--force`.
   - `close --phase …` — **refuses**: closure is owner-gated (exit 2). `--as owner --confirm` only prints how the owner records closure; mutates nothing.
   - `version`, `help`.
9. **Governance encoded:** `close` cannot close (closureAuthorityGate); `init`/`report` never overwrite silently; generated configs carry `productionFreeze=on`, canonical forbiddenActions/gates, `secretsPolicy` redaction.
10. **Tests:** 25 tests (`test/commands.test.ts`) with FakeSystem — happy + failure paths (missing/invalid config, missing flags, overwrite refusal, git-unavailable, framework pass/fail, owner-gated close).
11. **Coverage:** 99.36% statements / 96.62% branches / 100% functions. `system.ts` (impure adapter) + `index.ts` excluded from coverage; adapter exercised by the real-binary smoke test below.
12. **Typecheck:** strict `tsc --noEmit` — clean. **Build:** `tsc` → `dist/` EXIT 0.
13. **Real-binary smoke test (nodeSystem, in this repo):**
    - `projectos version` → `projectos 0.1.0 (core 0.1.0)`.
    - `projectos status` → branch `projectos-v2-core`, repo `universalbizcomply/ProjectOS`, 18 reports (18 awaiting), no config yet.
    - `projectos prompt --phase DEMO1A` → renders prompt.
    - `projectos close --phase DEMO1A` → refuses, **exit 2**.
14. **Framework validators:** `npm run validate` → `validate-all: ALL PASS` (no framework file changed).
15. **Secrets / external / gated actions:** none.
16. **Files outside scope touched:** none. Pre-existing uncommitted `dashboard-hosting/public→assets` change left untouched, excluded from this commit.
17. **Rollback:** delete `projectos/agent/`; drop branch. No shared state altered.
18. **Risks / carry-forward:** (a) fresh clone must run `npm run build` in `projectos/core` before `projectos/agent` (core `dist/` is git-ignored) — candidate for a root workspace/build script in a later phase; (b) `validate --framework` and `status` shell to `git`/`npm`, so they assume those are on PATH; (c) `report`/`prompt` generators are trimmed vs the full framework templates — deeper wiring to the `.cjs` reporter is a follow-up.
19. **Decision needed:** Owner/advisor review of the CLI surface + governance behaviour, and closure decision. Next phase on approval: PROJECTOS-PROJECT-INSTALL1A (install `.projectops` into PolyGo — needs the PolyGo repo path) or PROJECTOS-CLOUD-DASHBOARD.

## Closure criteria
- [x] `projectos/agent/` builds and typechecks clean.
- [x] ≥80% coverage (achieved 99%+).
- [x] Core-driven commands work; real binary verified end-to-end.
- [x] `close` refuses (owner-gated) — verified exit 2.
- [x] Framework validators still PASS.
- [ ] Owner/advisor review + closure (owner-gated).

## Final status
**PROJECTOS-LOCAL-AGENT1A — AWAITING-REVIEW.** CLI implemented over the core; 25 tests @ 99% coverage; strict tsc + build green; real binary verified; framework validators ALL PASS. No gated action, no secrets, no push.
