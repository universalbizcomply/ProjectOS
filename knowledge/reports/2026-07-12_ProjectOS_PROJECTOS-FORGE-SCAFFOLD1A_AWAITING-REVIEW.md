# ProjectOS — PROJECTOS-FORGE-SCAFFOLD1A (F2) — Phase Evidence

**Programme:** ProjectOS Forge · **Phase F2:** `PROJECTOS-FORGE-SCAFFOLD1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** (steps 2–4) — awaiting advisor/owner review + closure. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `ddb64a1…`

---

## 1. Objective

Turn a blueprint (F1) into a **deterministic file manifest** for a running, **secure-by-default**
Next.js (App Router) + Supabase + Tailwind + shadcn monorepo. Templates are static strings with typed
slots — **no AI free-writing of structure, no network, no metered API**. Same blueprint → same manifest
(replayable). F2 emits the manifest only; materialising to disk + installing + running is F3.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/forge/scaffold-engine.cjs` — `buildScaffold(blueprint)` → `{ projectId, manifestHash, files:
  [{path,content}] }`. Emits ~21 files: package.json (fixed deps, **no AI packages**), Next config,
  `app/layout` + a `page.tsx` per blueprint page, `lib/supabase/{server,client,request}.ts`, a SQL
  migration (RLS + owner policies per entity), an auth-guarded `app/api/<entity>/route.ts` per entity,
  `.env.example` (names only), `.projectops/config.json` (governance), `.github/workflows/ci.yml`, tests,
  tsconfig/tailwind/postcss/globals/gitignore/README, and `forge.config.json` (replay record + hash).
- `projectos/validators/validate-forge-scaffold.cjs` — **12 core + 6 adversarial invariants**, registered.

## 3. Secure-by-default guarantees (baked into every generated app)

- **Service-role key confined**: `lib/supabase/server.ts` is `import "server-only"`; the service-role key
  never appears in a client-reachable file. Generated CRUD routes use a **user-scoped client** (anon key +
  caller JWT) so **RLS is the enforcing boundary** — the RLS-bypassing admin client is not used in CRUD.
- **RLS ON for every table** with owner-scoped select/insert/update/delete policies; **update carries
  `WITH CHECK`** (prevents re-parenting a row to another owner).
- **`.env.example` is names-only** (no values); **no metered-AI dependency** ever added.
- Strict, **reserved-keyword-safe SQL identifiers** (`when`→`when_`, `order`→`order_`), reserved-column
  collision handling, and a `.projectops` governance file (production frozen, metered AI API prohibited)
  seeded from birth.

## 4. Invariants proven (all PASS)

1 deterministic (identical manifest + hash) · 2 required files present · 3 service-role key only in
server-only files · 4 server module is `server-only`, client never references the key · 5 RLS + owner
policies per table incl. update `WITH CHECK` · 6 no secret values; env names-only · 7 governance seeded
(production frozen, prohibits metered AI API) · 8 no metered-AI dependency · 9 per-entity auth-guarded
route using the **RLS-enforcing** user client (not service-role) · 10 all manifest paths safe · 11
replayable (forge.config hash + deep blueprint round-trip) · 12 valid JSON configs · 13 hostile inputs
fail closed: (a) newline entity name injects no top-level code, (b) multi-word → valid SQL identifier,
(c) reserved-column field no duplicate, (d) page-path traversal can't escape, (e) colliding entity slugs
rejected, (f) reserved SQL keywords made safe.

## 5. Review — security (security-reviewer agent)

Guarantees 1–5 confirmed hold. **HIGH fixed**: code injection via `entity.name` embedded raw in a route
comment (a newline escaped the comment) → newlines stripped (`safeComment`) + injection invariant 13a.
**HIGH fixed**: no engine-level path guard — a hostile `page.path` could traverse → per-segment
sanitisation + `assertSafePath` throws on any absolute/`..`/backslash/drive path (invariant 13d).
**MEDIUM fixed**: update policy now has `WITH CHECK`; generated CRUD switched from the RLS-**bypassing**
service-role client to a **user-scoped RLS-enforcing** client. No open HIGH/CRITICAL.

## 6. Review — code (code-reviewer agent)

**HIGH fixed**: multi-word entity names produced invalid unquoted SQL identifiers (hyphens) → strict
`ident()` (underscored, reserved-safe) used for all table/column/policy names; validator now imports and
uses the engine's real `slug`/`ident` (was an approximation). **MEDIUM fixed**: `localeCompare`→ordinal
(cross-machine determinism); silent path collisions → `put()` throws on duplicate; reserved-column
collision handling; replay invariant now deep-compares the embedded blueprint. **Additional bug caught
in self-review**: `when`/`order` are reserved Postgres keywords → `ident()` made reserved-safe
(invariant 13f). No open HIGH/CRITICAL.

## 7. Review — ECC

Every generated project inherits the governance model (production frozen, metered AI API prohibited,
provider/secret/deploy/push owner-gated, secrets as names) and secure defaults from birth. No PLAN READY
effect. Local-only; no provider/secret/API/network/disk (manifest only). Does not change V3 accounting.

## 8. Tests / validators

- `node projectos/validators/validate-forge-scaffold.cjs` → **PASS** (18 checks: 12 core + 6 adversarial).
- `npm run validate` (full suite, now 52 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 9. Live demo (deterministic, offline)

A booking-app blueprint → a **20-file** monorepo (package.json, app/layout+pages, lib/supabase/
{server,client,request}, migration with RLS, app/api/booking/route.ts using the user-scoped client,
.projectops governance, CI, tests, README, forge.config with hash). Same blueprint reproduces the same
manifest hash.

## 10. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO ·
AI API: NO · Network: NO · Disk: NO (manifest only). No external repo / PolyGo touched.

## 11. Next phase

**F3 — Local Provisioner**: materialise the manifest to a local project dir + install deps + run
migrations against **local** Supabase + boot the dev server — owner-gated where it touches anything real;
synthetic/local by default. Live proof (generated app boots locally).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
