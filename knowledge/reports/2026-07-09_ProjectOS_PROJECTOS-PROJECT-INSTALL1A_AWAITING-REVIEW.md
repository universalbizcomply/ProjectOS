# PROJECTOS-PROJECT-INSTALL1A — Installer + BizComply V2 Install (Evidence Pack)

> **Scope:** Build the `projectos install` command (installer capability) and use it to
> install a **config-only** `.projectops/` into the BizComply V2 product repo. ProjectOS
> did not touch product code. No commit/push in the product repo (owner reviews). No
> deploy/DB/network/secrets.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-PROJECT-INSTALL1A (PRODUCT_INSTALL) — roadmap Phase 6, over LOCAL-AGENT1A/CORE1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch (ProjectOS):** projectos-v2-core (off `main`; not pushed).
5. **Objective:** Provide a repeatable installer and pilot it on the owner-nominated project (BizComply V2).
6. **Installer added:** `projectos/agent/src/commands/install.ts` + `renderInstallReadme` in `templates.ts`; wired into `cli.ts`/`index.ts`. Flags: `--target --id [--name --type --owner --repo --force]`. Validates the generated config via the core before writing; refuses overwrite without `--force`; auto-detects the git remote of the target.
7. **What install writes into `<target>/.projectops/`:** `project-config.json` (installStatus=installed, productionFreeze=on, canonical forbiddenActions/gates, secretsPolicy redaction), `README.md`, `phases/.gitkeep`, `reports/.gitkeep`. Nothing else in the target is touched.
8. **Target installed:** `C:\dev\BizComply V2\Source` (git repo, branch `main`, remote `universalbizcomply/opsoft-ios-lab`). Chosen by owner ("Use Bizcomply V2 project not Bizcomply"). The repo `Source/` under the `BizComply V2` workspace is the actual git root.
9. **Install result (real binary):** EXIT 0. Created 4 files under `.projectops/`. `projectos status` from the repo reads: project `BizComply V2 (bizcomply-v2)`, install `installed`, branch `main` → protected `YES`, production freeze `ON`.
10. **Product-repo safety:** `git status` in BizComply V2 shows the install as a single untracked entry `?? .projectops/` — **no product file modified by ProjectOS**. Pre-existing uncommitted changes in that repo (gradle caches, lockfiles) are the owner's and were left untouched. **No git add/commit/push performed in the product repo.**
11. **Tests:** agent suite now 37 tests (4 new for install): remote detection, repo=none fallback, required flags, overwrite refusal. `install.ts` 95.9%; agent overall 98.78% statements / 93.78% branches / 100% functions.
12. **Typecheck + build:** strict `tsc` EXIT 0.
13. **Framework validators:** unchanged (no framework file touched).
14. **Secrets / external / gated actions:** none. Config carries placeholders only; no secrets read/written.
15. **Rollback:** in BizComply V2, `rm -rf .projectops` (it is untracked, so this fully reverts the install). In ProjectOS, delete `install.ts` + revert the template/cli/index/test additions.
16. **Risks / carry-forward:** (a) install does not decide whether the product repo commits `.projectops` — owner decides; (b) other projects (PolyGo, CricLocal, Coverdrive, TKN, Opsoft) are **not** git repos at their top level (only nested/some), so installs there need the owner to confirm the correct repo root before rollout; (c) BizComply V2's remote is named `opsoft-ios-lab` — worth the owner confirming that's intended.
17. **Decision needed:** owner/advisor review + closure; and a decision on whether to commit `.projectops` inside BizComply V2 and roll the installer out to the other projects (with confirmed repo roots).

## Closure criteria
- [x] Installer built, validated-before-write, tested (37 tests, 99%).
- [x] `.projectops` installed into BizComply V2; `projectos status` reads it.
- [x] Product code untouched (only `?? .projectops/`); no commit/push in product repo.
- [ ] Owner/advisor review + closure (owner-gated).

## Final status
**PROJECTOS-PROJECT-INSTALL1A — AWAITING-REVIEW.** Installer shipped; config-only `.projectops` installed into BizComply V2 and verified; product code untouched; no push. Awaiting owner review + closure.
