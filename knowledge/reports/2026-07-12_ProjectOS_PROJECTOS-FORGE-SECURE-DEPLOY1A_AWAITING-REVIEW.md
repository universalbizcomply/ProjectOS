# ProjectOS — PROJECTOS-FORGE-SECURE-DEPLOY1A (F8) — Phase Evidence

**Programme:** ProjectOS Forge · **Phase F8:** `PROJECTOS-FORGE-SECURE-DEPLOY1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** (steps 2–4) — awaiting advisor/owner review + closure. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `9f87425…`

---

## 1. Objective

The pre-deploy security gate that blocks the incumbents' top real-world failures — a service-role key
shipped in the client bundle, and missing/permissive RLS leaking every user's data — and gates deploy
itself: production REFUSED, staging OWNER_GATED, never auto-run. **Fails closed.**

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/forge/secure-deploy-gate.cjs`:
  - `auditManifest(scaffold)` — scans **every code file that is not provably server-only** (server-only =
    imports `"server-only"`, a `route.*` handler, `*.server.*`, `middleware`, `next.config`) for the
    service-role key / secret shapes (incl. `sb_secret_`/`sb_publishable_`) / secret-named `NEXT_PUBLIC_`
    vars; and requires every migration table to have RLS + owner-scoped policies that **actually reference
    `auth.uid()`** (rejecting `using (true)`/`with check (true)`) + an update `WITH CHECK`. Tolerant table
    parsing (case-insensitive, optional `if not exists`/quotes); an unparseable `CREATE TABLE` is a blocker.
  - `planDeploy({ target, productionFrozen })` — production REFUSED, staging OWNER_GATED (enqueue approval),
    `executed:false` always.
  - `canDeploy(scaffold, plan)` — true only when the audit passed AND the plan is a **validated**
    non-executed OWNER_GATED **staging** plan (target + executed checked, not trusted).
- `projectos/validators/validate-forge-deploy.cjs` — **14 checks**, registered.

## 3. Invariants proven (all PASS)

1 clean scaffold passes · 2 service-role key in a client file blocks · 3 secret in a client file blocks ·
4 missing RLS blocks · 5 missing update WITH CHECK blocks · 6 production REFUSED · 7 staging OWNER_GATED +
approval, never executed · 8 unknown target REFUSED · 9 canDeploy false when audit fails · 10 no
network/metered-API/spawn · 11 **fail-closed reachability** (secret in `components/`/`lib/` blocks, not
just `app/`) · 12 **tolerant table parsing** (uppercase/unparseable `CREATE TABLE` blocks — RLS can't be
skipped) · 13 **policy correctness** (`using (true)` / `with check (true)` / missing `auth.uid()` blocks) ·
14 new-format `sb_secret_` blocks; `canDeploy` rejects a forged production / already-executed plan.

## 4. Review — security (security-reviewer agent)

The first implementation **failed OPEN** — 3 CRITICALs: (C1) `isClientReachable` only scanned two paths, so
a service-role key in `components/`/`lib/` passed; (C2) case-sensitive table regex let an uppercase/quoted
`CREATE TABLE` skip RLS entirely; (C3) policy checks were substring-only, so `using (true)`/`with check
(true)` passed. Plus HIGH (missed `sb_secret_` and secret-named `NEXT_PUBLIC_`) and MEDIUM (`canDeploy`
trusted a caller `plan`). **All fixed by inverting to fail-closed**: scan every non-server-only code file;
tolerant+complete table parsing with an unparseable-table blocker; real policy correctness requiring
`auth.uid()` and rejecting `(true)`; extended secret patterns; and `canDeploy` now validates the plan's
target + executed flag. Each fix is locked by a new negative fixture (invariants 11–14). `planDeploy`
control flow was already sound (production always refused, nothing executed). No open HIGH/CRITICAL.

## 5. Review — ECC

Deploy is impossible without a passing security audit AND an owner-approved staging plan; production is
never deployable through this gate. No PLAN READY effect. Local-only; no provider/secret/API/network. Does
not change V3 accounting.

## 6. Tests / validators

- `node projectos/validators/validate-forge-deploy.cjs` → **PASS** (14 checks incl. 4 CRITICAL-surfacing).
- `npm run validate` (full suite, now 57 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 7. Safety / boundaries

Production: NO · Deploy: NO (planned/gated only) · DB: NO · Sends: NO · Payments: NO · Provider: NO ·
Real secrets: NO · AI API: NO · Network: NO · Disk: NO · Spawn: NO. No external repo / PolyGo touched.

## 8. Next phase

**F9 — Integrations/Playbooks**: verified wiring for Stripe/email/storage (placeholders; real keys
owner-gated via the secret broker); MCP for custom. Then **F10 — Forge E2E + the MICRO-LEVEL final
evidence report** for owner + ChatGPT.

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
