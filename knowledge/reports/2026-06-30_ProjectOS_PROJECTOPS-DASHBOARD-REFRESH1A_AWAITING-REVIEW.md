# PROJECTOPS-DASHBOARD-REFRESH1A — Owner Dashboard Redesign Refresh

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOPS-DASHBOARD-REFRESH1A (REPORTING / DASHBOARD_REFRESH / UX_POLISH / OWNER_COMMAND_CENTRE)
3. **Status:** PROJECTOPS-DASHBOARD-REFRESH1A — AWAITING-REVIEW (IMPLEMENTED LOCALLY)
4. **Branch:** main
5. **HEAD (before this commit):** 06bfbfa
6. **Remote:** origin = github.com/universalbizcomply/ProjectOS (private); main tracks origin/main; local ahead (unpushed)
7. **Files read (read-only):** projectos/dashboard/{index.html,dashboard-data.json,dashboard-generation-report.md}; knowledge/ProjectOS Reports Index.md; knowledge/*Current State.md (x7); README.md.
8. **Files changed:**
   - NEW `projectos/dashboard/dashboard-overrides.json` (curated static verified facts + risk + readiness + matrix + meta)
   - REWRITE `projectos/scripts/collect-dashboard-data.cjs` (overrides merge, sanitise markdown, risk model, matrix, summary, readiness, boards, fresh ledger)
   - REWRITE `projectos/scripts/build-static-dashboard.cjs` (command-centre renderer; inline CSS; no JS/external/actions)
   - REGEN `projectos/dashboard/dashboard-data.json`, `index.html`, `dashboard-generation-report.md`
   - NEW 7 screenshots under `projectos/dashboard/screenshots/refresh-*.png`
   - NEW this report + `knowledge/ProjectOS Reports Index.md` row
9. **Design method used:** Claude product/design reasoning + UI/UX-Pro-Max-style hierarchy critique + Magic-style "what decision does this enable" critique + 21st-Dev-style modern executive-dashboard layout — applied as **design lenses only** (no external tools/MCP/CDN/packages; fully local static).
10. **Design self-review (10/10 PASS):**
    1. Status understood in 30s? YES — KPI strip + colour-coded badges.
    2. Next action immediate? YES — Next action queue (STEP 1/2/3) + "Next owner decision" KPI.
    3. High-risk gates obvious? YES — red CRITICAL/HIGH badges + full gate matrix.
    4. JD/BizComply install positions obvious? YES — dedicated Install Readiness cards with READY/QUEUED + NOT APPROVED tags.
    5. NOT-VERIFIED obvious? YES — red NOT-VERIFIED badges on repo/live fields + needs-source board.
    6. Cleaner than previous? YES — executive command centre vs flat list.
    7. Avoids raw markdown/cosmetic leakage? YES — prose sanitised (``**``/backticks stripped).
    8. Avoids false certainty? YES — VERIFIED only where knowledge supports; else NOT-VERIFIED/NEEDS-SOURCE.
    9. Avoids approval authority? YES — header + footer + evidence panel state it cannot approve/close; no action controls.
    10. Safe/local-only? YES — inline CSS only, 0 external refs, no scripts, no network, no forms/buttons.
11. **Dashboard issues addressed:** stale ledger (now live from Reports Index — MULTI-PROJECT-DASHBOARD1A CLOSED, REMOTE-PUBLISH CLOSED, REVIEW + REFRESH AWAITING-REVIEW); heuristic mis-extractions fixed via overrides; raw markdown stripped; conservative risk levels assigned; install positions surfaced.
12. **Dashboard outputs regenerated:** dashboard-data.json (8 projects, 13 phases), index.html (command centre, 26.6 KB, inline CSS), dashboard-generation-report.md.
13. **Browser proof performed?** YES — Playwright (scratch-installed, outside repo) rendered the local file and the implementer viewed `refresh-dashboard-top.png`.
14. **Screenshots created?** YES (7): refresh-dashboard-top / -summary / -install-readiness / -projects / -risk-matrix / -ledger / -needs-source `.png`.
15. **Projects parsed:** 8.
16. **Phases parsed:** 13 (11 CLOSED + 2 AWAITING-REVIEW).
17. **Current phase ledger status:** fresh — all 10 framework phases CLOSED, PROJECTOS-REMOTE-PUBLISH1A CLOSED, PROJECTOS-DASHBOARD-REVIEW1A AWAITING-REVIEW, PROJECTOPS-DASHBOARD-REFRESH1A AWAITING-REVIEW. No stale MULTI-PROJECT-DASHBOARD1A AWAITING-REVIEW row.
18. **Fixes to repo/liveUrl extraction:** stopped showing config filenames/branches/repo-URLs as repos/live. Now overrides-driven and badge-marked VERIFIED/NOT-VERIFIED. Corrected: JD ``jdonlinetesting/JDtesting`` + ``jdtesting.uk`` (VERIFIED); BizComply ``universalbizcomply/opsoft-ios-lab`` + ``bizcomply-admin-app.vercel.app`` (VERIFIED); CricLocal ``muraddevbuild-maker/criclocal`` (VERIFIED) + live NOT-VERIFIED; Coverdrive ``coverdrivemanchester-art/Coverdrive`` (VERIFIED) + live NOT-VERIFIED; TKN repo+live NOT-VERIFIED (no git) and status downgraded LIVE→NEEDS-SOURCE; ERP NOT-VERIFIED.
19. **Overrides added:** YES — `projectos/dashboard/dashboard-overrides.json` (no secrets; VERIFIED only where knowledge supports; else NOT-VERIFIED/NEEDS-SOURCE).
20. **Risk levels assigned (conservative, static):** ProjectOS LOW; PolyGo HIGH; JD Testing CRITICAL; BizComply/OPSoft CRITICAL; CricLocal HIGH; Coverdrive HIGH; TKN HIGH; ERP System MEDIUM.
21. **UNKNOWN / NEEDS-SOURCE / NOT-VERIFIED remaining:** JD host/deploy hash; BizComply marketing/public domain; CricLocal live URL + risk register; Coverdrive live URL + risk register; TKN git remote/history (no VCS); ERP repo/build progress.
22. **JD Testing install readiness:** READY FOR GOVERNANCE INSTALL AFTER DASHBOARD REFRESH CLOSURE — `.projectops`-only; prohibited: product code/Supabase migrations/Edge Functions/payments/emails/bookings/deploy config; gates: payments, customer/health-adjacent data, customer email, booking mutation, production deploy; install approval: NOT APPROVED BY DASHBOARD.
23. **BizComply/OPSoft install readiness:** QUEUED AFTER JD TESTING — `.projectops`-only; prohibited: product code/tenant data/RLS/migrations/payments-POS/compliance evidence/deploy config/live tenant data; gates: tenant/RLS/role, compliance evidence, payments/POS, production deploy, owner access, live tenant/customer data; install approval: NOT APPROVED BY DASHBOARD.
24. **Safety warnings present:** header warn bar + next-action warn + evidence panel + footer all state "evidence only / cannot approve closure, production deploy, DB mutation, real sends, payments or installs".
25. **Dashboard approval authority?** NONE.
26. **Product repos scanned?** No.
27. **External APIs used?** No.
28. **Production touched?** No.
29. **Deploy/database/email/SMS/payment action?** None.
30. **Validators:** `npm run validate` → ALL PASS (31/31); `validate:dashboard` → PASS (config/data/output/safety/dashboard); `dashboard:check` PASS; `dashboard:safety` PASS; `report:check` PASS. index.html external-asset grep = 0.
31. **Risks:** overrides are static and owner-knowledge-derived — keep them current as projects change; risk levels are conservative judgements, not live-measured.
32. **Residue:** NONE in repo beyond intended outputs. Playwright + Chromium remain installed in the session scratch dir (outside the repo; ProjectOS package.json/node_modules unchanged).
33. **Carry-forward:** keep dashboard refreshed as the index grows; optional later phase to improve the collector's automatic extraction; per-project dashboards remain separate owner-approved work.
34. **Decision needed:** (a) review the refreshed command centre (open the file / screenshots), (b) accept the redesign, (c) decide closure of PROJECTOS-DASHBOARD-REVIEW1A and PROJECTOPS-DASHBOARD-REFRESH1A and whether to push the local review/refresh commits, (d) confirm JD then BizComply `.projectops`-only install sequencing.

## Expected status
PROJECTOPS-DASHBOARD-REFRESH1A — IMPLEMENTED LOCALLY / AWAITING OWNER-ADVISOR REVIEW.
Do not close PROJECTOS-DASHBOARD-REVIEW1A. Do not close PROJECTOPS-DASHBOARD-REFRESH1A. Do not start JD/BizComply install.