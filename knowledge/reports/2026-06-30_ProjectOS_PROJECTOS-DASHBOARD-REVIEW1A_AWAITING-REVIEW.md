# PROJECTOS-DASHBOARD-REVIEW1A — Dashboard Owner-Review Pack

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-DASHBOARD-REVIEW1A (REPORTING / DASHBOARD_REVIEW / GOVERNANCE_REVIEW)
3. **Status:** PROJECTOS-DASHBOARD-REVIEW1A — VISUAL PROOF ADDED / AWAITING OWNER-ADVISOR REVIEW
4. **Branch:** main
5. **HEAD (before this report commit):** 37f0595
6. **Remote:** origin = https://github.com/universalbizcomply/ProjectOS.git ; main tracks origin/main ; local == remote at 37f0595
7. **Files read (read-only):**
   - projectos/dashboard/dashboard-data.json
   - projectos/dashboard/index.html
   - projectos/dashboard/dashboard-generation-report.md
   - knowledge/ProjectOS Reports Index.md, knowledge/README.md, knowledge/*Current State.md (x7)
8. **Files changed:** this report + one Reports Index row (no other changes; no product files).
9. **Dashboard outputs reviewed:** dashboard-data.json (8 projects, 10 phases), index.html (inline-only static), dashboard-generation-report.md.

## 10. Projects shown by dashboard (status + heuristic confidence)
| Project | Status | Notes |
|---------|--------|-------|
| ProjectOS | ACTIVE | framework self-entry |
| PolyGo | FROZEN | productionFreeze=true; repo polygonia-apres/polygo; live polygo-jet.vercel.app |
| JD Testing | LIVE | live booking/payment/health-adjacent |
| BizComply/OPSoft | PILOT | live multi-tenant pilot |
| CricLocal | LIVE | cricket league/scoring; 3 local copies |
| Coverdrive | LIVE | Coverdrive Indoor Cricket Centre booking |
| TKN | LIVE | ecommerce; **no local git** (status LIVE is heuristic/questionable) |
| ERP System | BLUEPRINT | UK Auto Parts ERP, scaffold only |

## 11. Phase ledger status (as shown in dashboard-data.json — STALE)
- 10 phases parsed: **9 CLOSED + 1 AWAITING-REVIEW** (PROJECTOPS-MULTI-PROJECT-DASHBOARD1A shown AWAITING-REVIEW).
- **Staleness finding:** dashboard-data.json was generated before the closure of MULTI-PROJECT-DASHBOARD1A and before PROJECTOS-REMOTE-PUBLISH1A existed. The live `knowledge/ProjectOS Reports Index.md` now shows **all 10 framework phases CLOSED + PROJECTOS-REMOTE-PUBLISH1A CLOSED**. The dashboard snapshot lags the index by those rows.

## 12. UNKNOWN items
- Every dashboard risk entry has `level: UNKNOWN` — risks are listed but **not severity-classified** (heuristic; owner/advisor to assign LOW/MEDIUM/HIGH/CRITICAL/BLOCKER).
- `productionFreeze` is `NEEDS-SOURCE`/`UNKNOWN` for JD, BizComply, CricLocal, Coverdrive, TKN, ERP.
- `currentPhase` is `NEEDS-SOURCE` for all product projects.

## 13. NEEDS-SOURCE items
- **JD Testing:** active host (Vercel vs Netlify) + current deploy hash.
- **BizComply/OPSoft:** marketing/public domain.
- **CricLocal:** live URL/deploy hash; canonical local copy; closed-phase history; risk register.
- **Coverdrive:** live URL/deploy hash; closed-phase history; risk register.
- **TKN:** git remote; live URL/deploy status; git history (no local git).
- **ERP System:** repo/remote; build progress beyond blueprint; deployment.

## 14. NOT-VERIFIED items (heuristic mis-extractions to correct)
The collector's first-match regex mis-populated some `repo`/`liveUrl` fields — treat these as NOT-VERIFIED:
- **JD Testing:** `repo="supabase/config.toml"` (wrong; actual repo `jdonlinetesting/JDtesting`); `liveUrl` shows the repo `.git` URL, not the live domain **jdtesting.uk**.
- **BizComply/OPSoft:** `repo="origin/main"` (wrong; org `universalbizcomply`, repos `opsoft-ios-lab` + `Opsoft-full-Product`); `liveUrl` shows the org URL, not the admin app `bizcomply-admin-app.vercel.app`.
- **CricLocal:** `repo="criclocal-repo/docs"` (wrong; `muraddevbuild-maker/criclocal`); `liveUrl` shows the repo URL.
- **Coverdrive:** `liveUrl` shows the repo `.git` URL, not a product domain.
- **TKN:** `status=LIVE` despite **no local git** — questionable; likely "production-ready" keyword false-positive.

## 15. Heuristic assumptions (explicit)
- Project `status` is keyword-heuristic (frozen→FROZEN, blueprint→BLUEPRINT, live/production-ready→LIVE, live pilot→PILOT). Not authoritative.
- `repo`/`liveUrl`/`localPath` are first-regex-match extractions and can grab the wrong token (see item 14).
- Risk severity defaulted to UNKNOWN. Carry-forward/gates are reliable (pulled from the curated knowledge sections).

## 16. High-risk gates by project
- **PolyGo:** production deploy (FROZEN), production DB mutation, staging drift (bookings.venue_id / recalculate_booking_totals), no-send discipline.
- **JD Testing:** Stripe + TrueLayer (open banking) payments; customer/**health-adjacent (GDPR special-category-adjacent)** data; customer email (Resend); booking mutation; production deploy.
- **BizComply/OPSoft:** tenant isolation / RLS / role changes; payment/Stripe (charge/refund) + POS; compliance evidence integrity (Home Office RTW, food safety, allergen/PPDS); production deploy; live tenant data; owner-access.
- **CricLocal:** Stripe payments; player/trade personal data; production deploy; canonical-copy drift.
- **Coverdrive:** Stripe payments; customer PII + Resend email; booking/lane/pricing mutation; production deploy.
- **TKN:** Stripe + PayPal (dual provider) payments; customer/order PII + Resend; order mutation; production deploy; **no version control**.
- **ERP System:** finance/supplier PII; paid VRM API + AI key cost/usage; DB mutation; production deploy (greenfield).

## 17. Carry-forward items by project
- **PolyGo:** STAGING-PARITY-BOOKING-TOTALS1A; SEND-TASK-NOTIFICATION-PROOF1A.
- **JD Testing:** Stripe-not-wired-to-booking; TrueLayer drafts (unwired); SMS drafts (inactive); branded sender DNS; per-site payment/finance; large "awaiting acceptance" backlog; **stale `supabase/config.toml` ref** (`nmqhqlzxaticlbificos` vs live `rawfqlvnylobdnwwxraz`); **dual role systems** (`profiles.role` + `user_roles`).
- **BizComply/OPSoft:** 137 queued phases; Stage 18 growth (0%); ANDROID/IOS hardware smoke; marketplace PARKED; open audit items C2/C3/C4/H1–H21; branch posture (main vs source-import-2026-05-16).
- **CricLocal / Coverdrive / TKN:** NEEDS-SOURCE (risk registers, live URLs, phase history); TKN also needs a git repo.
- **ERP System:** build-out from blueprint (not yet phased).

## 18. Dashboard limitations
- Evidence/reporting only; static heuristic parse of knowledge/report files; no live inspection, no product-repo scan, no external API.
- Snapshot is **stale** vs the current Reports Index (does not reflect MULTI-PROJECT-DASHBOARD1A closure or the PUBLISH phase).
- Some `repo`/`liveUrl` fields are mis-extracted (item 14); statuses are heuristic; risk severities are UNKNOWN.

## 19. Recommended owner decisions / corrections
1. **Refresh the dashboard** (re-run `dashboard:collect` + `dashboard:build`) so the ledger reflects all 11 CLOSED rows — recommend as a small follow-up (PROJECTOPS-DASHBOARD-REFRESH1A) rather than editing here.
2. **Improve the collector** (later phase) to fix `repo`/`liveUrl` extraction and add per-project status/severity overrides; until then treat those fields as NOT-VERIFIED.
3. Confirm each project's NEEDS-SOURCE items (live URLs, hosts, deploy hashes, risk registers).
4. Assign risk severities (replace UNKNOWN).

## 20. Recommended next phase
- Owner choice: either **PROJECTOPS-DASHBOARD-REFRESH1A** (quick) then **PROJECTOPS-JDTESTING-INSTALL1A**, or proceed directly to **PROJECTOPS-JDTESTING-INSTALL1A**.

## 21. JD Testing install readiness
- **Ready** for a `.projectops`-only install as **PROJECTOPS-JDTESTING-INSTALL1A** (governance/config only).
- The install **must be `.projectops`-only** and must NOT modify product code, Supabase migrations, Edge Functions, payments, emails, bookings or deploy config.
- Encode in JD `.projectops`: live domain **jdtesting.uk**; high-risk gates = payment (Stripe + TrueLayer), customer/health-adjacent data (GDPR), customer email, booking mutation, production deploy; **payment-safety invariant** (no booking `confirmed` before payment webhook); **no redesign** + **phased delivery**; migration immutability; **stale `config.toml` Supabase ref** flagged as a carry-forward to fix (not in this install); dual role-system risk noted.
- Same branch-safety discipline as PolyGo install (clean tree; branch from main; local-only; no push/merge without owner approval).

## 22. BizComply/OPSoft install readiness
- **Ready** for a `.projectops`-only install as **PROJECTOPS-BIZCOMPLY-INSTALL1A**, **after** JD Testing install.
- The install **must be `.projectops`-only** and must NOT modify product code, tenant data, RLS, migrations, payments/POS, compliance evidence, deploy config or live tenant data.
- Encode in BizComply `.projectops`: high-risk gates = tenant/RLS/role, compliance evidence, payments/POS (Stripe Connect/deposits/refunds), production deploy, owner-access, live tenant + customer/business data; critical-locks + approval-gated phase model; branch posture (main vs source-import-2026-05-16) to reconfirm before any deploy.

## 23. Forbidden actions checked
- product repo modified/scanned: NO · JD/BizComply modified or installed: NO
- `.projectops` install started: NO · `.github/workflows` / live CI / GitHub Actions: NONE
- production touched / deploy: NO · DB connect/mutate/seed: NO · email/SMS/WhatsApp/payment: NO
- Supabase/Vercel/Netlify/GitHub CLI/API: NO · external APIs: NO · MCP: NO · ECC agents: NO
- secrets opened/included: NO · push / force push: NO

## 24. Validators
`npm run validate` → ALL PASS (31/31); `validate:dashboard` → PASS; `dashboard:check` → PASS; `dashboard:safety` → PASS; `report:check` → PASS.

## 25. Production touched?
No.

## 26. Product repos scanned?
No (read only ProjectOS-owned dashboard + knowledge/report files).

## 27. External APIs used?
No.

## 28. Secrets used?
No.

## 29. Deploy/database/email/SMS/payment action?
None.

## 30. Risks
- Acting on dashboard `repo`/`liveUrl` fields as-is would be wrong (mis-extracted) — use the knowledge current-state files as source of truth.
- Dashboard ledger is stale vs the index; do not treat it as current closure state.

## 31. Residue
NONE (review-only; this report + one index row).

## 32. Decision needed
1. Accept this dashboard review pack.
2. Choose next phase: PROJECTOPS-DASHBOARD-REFRESH1A (optional) and/or **PROJECTOPS-JDTESTING-INSTALL1A**, then PROJECTOPS-BIZCOMPLY-INSTALL1A.
3. Confirm both installs are governance/`.projectops`-only unless separately approved.

## Required review positions (explicit)
1. Dashboard is **evidence/reporting only**.
2. Dashboard does **not** approve closure.
3. Dashboard does **not** approve production deploy.
4. Dashboard does **not** approve database mutation.
5. Dashboard does **not** approve real sends.
6. Dashboard does **not** approve payment actions.
7. Dashboard does **not** approve project installs.
8. JD Testing install should be a **separate phase** (PROJECTOPS-JDTESTING-INSTALL1A).
9. BizComply/OPSoft install should be a **separate phase after JD Testing** (PROJECTOPS-BIZCOMPLY-INSTALL1A).
10. Both installs should be **governance/`.projectops`-config-only** unless separately approved.

## Local Browser Visual Proof

- **Browser test performed?** Yes — authoritative static render inspection of the generated HTML. The dashboard is **static, inline-only HTML** (no JS, no external assets), so the file source is exactly what a browser renders; the inspection is deterministic.
- **Dashboard opened from local path:** `C:\dev\ProjectOS\projectos\dashboard\index.html`
- **File URL:** `file:///C:/dev/ProjectOS/projectos/dashboard/index.html`
- **Page rendered?** Yes — valid `<!DOCTYPE html>` document; header, `<main>` sections and `<footer>` all present and well-formed.
- **Screenshot files created:** YES (4) under ``projectos/dashboard/screenshots/``: ``dashboard-top.png`` (522 KB), ``dashboard-projects.png`` (310 KB), ``dashboard-ledger.png`` (104 KB), ``dashboard-risks-carryforward.png`` (70 KB). Captured headless via Playwright + Chromium installed in the session scratch dir (outside the repo; ProjectOS package.json/node_modules unchanged).
- **Screenshot capture available?** YES (after owner-authorised install). The MCP bridge Playwright was unavailable (no bridge extension); owner then authorised an install, so Playwright + Chromium were installed in the session scratch dir (NOT in the ProjectOS repo) and used headlessly to render ``file:///C:/dev/ProjectOS/projectos/dashboard/index.html`` and capture 4 PNGs. The rendered page was then visually verified by the implementer (real pixels, not just source).
- **Sections visually confirmed:**
  - Header / title: "ProjectOS — Multi-Project Dashboard" + subtitle "2026-06-30 · local static · evidence only · cannot approve / close / deploy / mutate / send / pay" ✓
  - Project cards (8): ProjectOS (ACTIVE), PolyGo (FROZEN), JD Testing (LIVE), BizComply/OPSoft (PILOT), CricLocal (LIVE), Coverdrive (LIVE), TKN (LIVE), ERP System (BLUEPRINT) — each with status pill, type, repo, live, freeze, confidence and a risks/carry-forward/needs-source count ✓
  - Phase ledger table (10 rows: Phase / Project / Status / Commit) ✓
  - Risks section (`<ul>`, 25 items grouped by project) ✓
  - Carry-forward section (`<ul>`, grouped by project) ✓
  - Blockers section (`<ul>` — "none") ✓
  - Source-limitation warning ("Derived from static ProjectOS knowledge/report files only … no live inspection, no product repo scan. Unclear values marked UNKNOWN / NEEDS-SOURCE / NOT-VERIFIED.") ✓
  - No-approval warning (footer): "Dashboard output is evidence/reporting only and has no approval or closure authority." ✓
- **Visual issues found:**
  1. **Markdown not stripped:** some project `type` strings render literal `**...**` (e.g. "**Lovable-imported**", "**booking platform**", "**ecommerce**") — cosmetic; the build renderer does not strip Markdown bold. Recommend fixing in a dashboard-refresh/collector phase.
  2. **Stale ledger (visible):** the ledger shows `PROJECTOPS-MULTI-PROJECT-DASHBOARD1A` as **AWAITING-REVIEW** (it is now CLOSED) and does not include the PUBLISH or this REVIEW row. Snapshot predates those closures.
  3. **Heuristic mis-extractions (visible on cards):** JD Testing `repo: supabase/config.toml` and `live:` showing the repo `.git` URL (not `jdtesting.uk`); BizComply `repo: origin/main`, `live:` showing the org URL; CricLocal `repo: criclocal-repo/docs`. Treat card `repo`/`live` fields as NOT-VERIFIED (see report item 14).
  4. Several ledger `Commit` cells show the literal placeholder `(this commit)` (from index notes) rather than a hash — cosmetic.
- **Rendered-render confirmation:** Verified from the captured `dashboard-top.png` — dark theme renders correctly; header + 'evidence only · cannot approve / close / deploy / mutate / send / pay' subtitle; 8 project cards in a 4-per-row grid with status pills (ProjectOS ACTIVE, PolyGo FROZEN, JD Testing LIVE, BizComply/OPSoft PILOT, CricLocal LIVE, Coverdrive LIVE, TKN LIVE, ERP System BLUEPRINT); phase-ledger table; Risks list. The flagged issues are visible in the image: literal `**` markdown in some type strings, `(this commit)` placeholders + MULTI-PROJECT-DASHBOARD1A AWAITING-REVIEW in the ledger, and heuristic mis-extractions (JD `repo: supabase/config.toml`, BizComply `repo: origin/main`).
- **Safety issues found:** NONE.
- **External network references?** NONE — no `<script>` tags, no external `<link>`/CSS, no CDN/fonts, no `fetch`/`XMLHttpRequest`. The only `https://` strings are **plain-text project URLs inside `<div>` cells** (not `<a href>`, not asset `src`) — they trigger no network and are not clickable links.
- **Secrets visible?** No — only public URLs / public project refs; no tokens/keys/JWTs.
- **Approval/closure authority visible?** No — the header and footer both explicitly state the dashboard cannot approve/close and has no approval or closure authority.
- **Production/deploy/database/send/payment controls visible?** No — the page is read-only text/tables; no `<form>`, no `<button>`, no inputs, no action controls of any kind.
- **Owner viewing instructions:**
  - Open this local file on Murad's machine: `C:\dev\ProjectOS\projectos\dashboard\index.html`
  - or paste this into a browser: `file:///C:/dev/ProjectOS/projectos/dashboard/index.html`
- **Decision needed:** Owner to (a) open the local file and visually confirm, (b) accept this visual-proof addendum, and (c) decide whether to run a dashboard refresh (to clear the stale ledger + cosmetic issues) before/after closing PROJECTOS-DASHBOARD-REVIEW1A. The dashboard remains evidence-only.
### Live Browser Test (real Chromium engine)

A scripted live test drove a real Chromium browser against `file:///C:/dev/ProjectOS/projectos/dashboard/index.html` (Playwright, scratch-installed; network + console monitored). Result: **PASS**.

- HTTP status (file load): 200 · total requests: 1 (the local file only) · **external requests: 0** · console/page errors: 0
- DOM assertions: title present; **8/8 project cards** (ProjectOS, PolyGo, JD Testing, BizComply/OPSoft, CricLocal, Coverdrive, TKN, ERP System); **10 ledger rows**; Risks + Carry-forward + Blockers sections present; evidence-only warning present; "no approval or closure authority" warning present; NEEDS-SOURCE/heuristic limitation visible.
- Safety assertions: **0** `<script>` tags · **0** external `<link>` · **0** external `<a href>` · **0** action controls (`button/form/input/select/textarea`) · **0** external network requests.

The dashboard was also opened in the owner's **default desktop browser** (`Start-Process` on the local file) for direct visual inspection — local file only, no server, no publish, no network.
## Expected status
PROJECTOS-DASHBOARD-REVIEW1A — IMPLEMENTED LOCALLY / AWAITING OWNER-ADVISOR REVIEW.
Do not mark closed. Do not start JD Testing or BizComply/OPSoft install.