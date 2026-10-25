# PROJECTOS-CONTROL-CENTER1A — Control Center (Evidence Pack)

> **Scope:** Mission Control desktop UI — a Vite + React frontend (driven by
> `@projectos/core`) + a Tauri v2 desktop shell. Read-only viewer; never edits code or runs
> anything gated. Web frontend fully verified; native binary is toolchain-blocked here.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-CONTROL-CENTER1A — roadmap Phase 4, over CORE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core (local; not pushed).
5. **Package:** `projectos/control-center` — Vite + React + TS (`@projectos/control-center`), depends on `@projectos/core`. Tauri v2 shell under `src-tauri/`.
6. **UI (4 views, all driven by the core):**
   - **Projects** — the 12 governed projects, install status, production-freeze, open phases; KPI row.
   - **Workflow** — `planWorkflow(DEFAULT_WORKERS)`: 6 lifecycle steps with the owning worker; closure flagged owner-gated (Murad).
   - **Safety Gates** — the 8 `DEFAULT_SAFETY_GATES` with status (force-push = prohibited).
   - **Integrations** — `defaultCatalog()`: 12 inert plugins, external vs local.
   - Design: disciplined dark "mission-control" (intentional palette/tokens, hierarchy, hover/active states) — not a template default.
7. **Typecheck:** strict `tsc --noEmit` EXIT 0.
8. **Runtime verification (Vite dev server on :5178, via preview tools):**
   - Vite ready in ~0.8s; **zero console errors**.
   - Projects view: 12 cards + KPIs (12 governed / 12 installed / 11 frozen / 12 open phases).
   - Nav interactive (React mounted): Workflow → 6 steps incl. `Closure … Murad · owner · owner-gated`; Gates → 8 gates, 1 prohibited; Integrations → 12 plugins.
   - Active nav computed style `#1b2540` (design tokens applied).
9. **Tauri shell (`src-tauri/`):** correct v2 scaffolding — `Cargo.toml`, `tauri.conf.json` (frontendDist `../dist`, devUrl :5178), `src/main.rs`, `build.rs`.
10. **Verification limits (honest):** the **native desktop binary was not compiled** — this machine has **no Rust toolchain and no C++ linker** (link.exe/cl.exe/gcc all MISSING). Tauri needs Rust + MSVC Build Tools (Desktop C++). A Rust install was attempted (winget, background); the MSVC linker remains required. The web frontend — the entire UI — is fully built and verified; only the desktop wrapper compile is pending the toolchain.
11. **Framework validators:** unchanged. `node_modules/`, `dist/`, and `src-tauri/target/` are git-ignored.
12. **Secrets / external / gated actions:** none. (A temporary control-center entry was added to `C:\Brik\.claude\launch.json` only to drive the preview, then reverted.)
13. **Rollback:** delete `projectos/control-center/` + `.claude/launch.json`.
14. **Carry-forward:** compile the desktop binary once Rust + MSVC Build Tools are installed (`cargo tauri build`); wire live data (read each repo's `.projectops` via the CLI + Tauri shell/exec) to replace the seed; add Approvals/Reports action views (Generate Prompt, Run Validators, Approve/Reject).
15. **Decision needed:** owner/advisor review + closure; install Rust + MSVC to produce the native app.

## Final status
**PROJECTOS-CONTROL-CENTER1A — AWAITING-REVIEW.** Mission Control UI built + fully verified in the browser (4 views from the core, 0 console errors); Tauri v2 shell scaffolded; native compile blocked on the Rust/MSVC toolchain (documented). No gated action, no secrets, no push.
