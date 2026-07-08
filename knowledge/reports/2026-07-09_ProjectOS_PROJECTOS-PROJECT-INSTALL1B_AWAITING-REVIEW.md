# PROJECTOS-PROJECT-INSTALL1B — Fleet Rollout (Evidence Pack)

> **Scope:** Roll the `projectos install` command out across the owner-nominated project
> folders under `C:\dev` (plus `C:\Brik`). Config-only `.projectops/` per repo. ProjectOS
> touched no product code and committed/pushed nothing in any product repo. No
> deploy/DB/network/secrets.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-PROJECT-INSTALL1B (PRODUCT_INSTALL / FLEET_ROLLOUT) — follows INSTALL1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch (ProjectOS):** projectos-v2-core (local; not pushed).
5. **Method:** each owner-listed folder resolved to its actual git repo root (top-level repo, else the single nested repo, else the folder itself when no repo). Installed via the real `projectos install` binary; each generated config validated by the core before write.
6. **Installed (12 total, incl. BizComply V2 from INSTALL1A):**

| # | Target (where .projectops lives) | id | repo detected |
|---|---|---|---|
| 1 | `C:\Brik` | brik | universalbizcomply/brik |
| 2 | `C:\dev\Boithok Khana` | boithok-khana | none (static site, no git) |
| 3 | `C:\dev\Coverdrive\coverdrive` | coverdrive | coverdrivemanchester-art/Coverdrive |
| 4 | `C:\dev\CricLocal\criclocal-repo` | criclocal | muraddevbuild-maker/criclocal |
| 5 | `C:\dev\ERP system` | erp-system | none (only a zip present) |
| 6 | `C:\dev\Firm Flow\firmflow-project` | firm-flow | none (no git) |
| 7 | `C:\dev\JD Project` | jd-testing | jdonlinetesting/JDtesting |
| 8 | `C:\dev\Polygo\polygo` | polygo | polygonia-apres/polygo |
| 9 | `C:\dev\TKN\streetwear` | tkn | none (no git) |
| 10 | `C:\dev\Trading Bot` | trading-bot | none (plan-only) |
| 11 | `C:\dev\BizComply V2\Source` | bizcomply-v2 | universalbizcomply/opsoft-ios-lab (INSTALL1A) |

7. **Each install wrote only:** `.projectops/project-config.json` (installStatus=installed, productionFreeze=on, canonical forbiddenActions/gates, secretsPolicy redaction), `.projectops/README.md`, `.projectops/phases/.gitkeep`, `.projectops/reports/.gitkeep`. Nothing else in any target changed.
8. **Verification:** every target's `project-config.json` re-read and confirmed valid (id + installStatus=installed + repo). For the five git repos (Brik, Coverdrive, CricLocal, JD, Polygo) `git status` shows the install as `.projectops/` entries only — **no product file modified by ProjectOS**. No `git add/commit/push` performed in any product repo.
9. **Decisions made during rollout (flagged for owner):**
   - **CricLocal** had two clones of the same remote (`criclocal-repo` last commit 2026-06-09 vs `CricLocal-Cowork` 2026-04-05 initial). Installed into the active one, `criclocal-repo`. Confirm this is your working copy.
   - **Polygo** already had a `.projectops` from the earlier PROJECTOPS-POLYGO-INSTALL1A. Re-installed with `--force` to write the V2 config. If the old folder was committed in the polygo repo, git will show `.projectops/*` as modified (still no product code).
   - **Non-git targets** (Boithok Khana, ERP system, Firm Flow, TKN, Trading Bot) got a `.projectops` with `repo: none`. Governance config is present but won't be version-controlled until those become git repos. ERP system is only a zip and Trading Bot is plan-only — flagged.
10. **Framework validators:** unchanged (no framework file touched). No new ProjectOS code this phase — only the report + index row (installer shipped in INSTALL1A).
11. **Secrets / external / gated actions:** none.
12. **Rollback:** in any target, `rm -rf .projectops` fully reverts (untracked, except Polygo where it may be tracked — `git checkout -- .projectops` / delete as appropriate).
13. **Risks / carry-forward:** (a) whether each product repo should commit `.projectops` is the owner's call; (b) confirm CricLocal working copy + the BizComply V2 remote name (`opsoft-ios-lab`); (c) non-git targets aren't version-tracked; (d) `Opsoft` / `opsoft-*` labs and `everything-claude-code` were NOT in the owner list, so left untouched.
14. **Decision needed:** owner/advisor review + closure; and whether to commit `.projectops` inside each product repo.

## Closure criteria
- [x] All owner-listed folders resolved to a target and installed (config-only).
- [x] Every config validated; git repos show only `.projectops` (product code untouched).
- [x] No commit/push in any product repo.
- [ ] Owner/advisor review + closure (owner-gated).

## Final status
**PROJECTOS-PROJECT-INSTALL1B — AWAITING-REVIEW.** 11 targets installed (12 projects governed incl. BizComply V2); config-only; product code untouched; nothing pushed. Awaiting owner review + closure.
