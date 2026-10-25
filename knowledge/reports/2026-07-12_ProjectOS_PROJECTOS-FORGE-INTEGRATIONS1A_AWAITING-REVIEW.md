# ProjectOS — PROJECTOS-FORGE-INTEGRATIONS1A (F9) — Phase Evidence

**Programme:** ProjectOS Forge · **Phase F9:** `PROJECTOS-FORGE-INTEGRATIONS1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** (steps 2–4) — awaiting advisor/owner review + closure. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `ede6294…`

---

## 1. Objective

Verified, pre-tested wiring "playbooks" for the allowlisted integrations (stripe / email / storage): given
a blueprint integration, emit the wiring files with **placeholders only** (env NAMES, never values), keyed
clients `server-only`, and the stripe webhook signature-verified. Real keys stay owner-gated (secret broker
+ provider guards). No provider contact, no metered API.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/forge/integration-playbooks.cjs` — `buildPlaybook(id)` / `buildPlaybooks(ids)`. Stripe →
  `app/api/stripe/{webhook,checkout}/route.ts` (both `server-only`; webhook verifies STRIPE_WEBHOOK_SECRET;
  checkout uses STRIPE_SECRET_KEY server-side); email → `lib/email.ts` (`server-only`, EMAIL_API_KEY);
  storage → `lib/storage.ts` (public client + RLS, no secret). `auth`/`realtime`/`search` have no wiring
  playbook (handled by the base scaffold) and are skipped. Deterministic, path-sorted, collision-guarded.
- `projectos/validators/validate-forge-integrations.cjs` — **10 invariants**, registered.

## 3. Invariants proven (all PASS)

1 stripe emits webhook+checkout, owner-gated, correct env names · 2 webhook verifies its signature · 3
keyed clients (stripe/email) are `server-only` · 4 no secret values; env names only · 5 unknown integration
refused · 6 storage needs no secret + uses the public client · 7 merge/dedup; auth skipped; collision
throws · 8 **the emitted wiring PASSES the F8 deploy-gate audit** (no client-reachable secret) · 9 base
scaffold + playbooks merged PASSES the deploy-gate audit · 10 no network/metered-API/spawn; deterministic.

## 4. Reviews

- **Security / ECC:** the strongest guarantee is **automated cross-checking** — invariants 8/9 run the
  emitted wiring (and a full base-scaffold + playbooks manifest) through the F8 **fail-closed** deploy-gate
  audit, so any client-reachable secret or RLS gap in a playbook is caught by the already-reviewed gate.
  Keyed clients are `server-only`; the stripe webhook is signature-verified; secrets are env NAMES only;
  real keys remain owner-gated. No metered AI API (self-contained module). No PLAN READY effect. Local-only.
- **Code (self-review):** small, deterministic, frozen playbook table, collision-guarded merge; consistent
  with the F2 manifest shape. Given the tiny surface (static templates) this phase was self-reviewed; the
  10 invariants — especially the deploy-gate cross-audit — lock the contract.

## 5. Tests / validators

- `node projectos/validators/validate-forge-integrations.cjs` → **PASS** (10 invariants).
- `npm run validate` (full suite, now 58 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 6. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO (wiring only, real keys
owner-gated) · Real secrets: NO · AI API: NO · Network: NO · Disk: NO · Spawn: NO. No external repo / PolyGo.

## 7. Next phase

**F10 — Forge E2E + MICRO-LEVEL final evidence report** (owner directive): drive the whole chat-to-app
chain end to end offline (blueprint → scaffold → provision-plan → generate → verify → snapshot → integrate
→ deploy-gate), then write `knowledge/reports/PROJECTOS-FORGE-FINAL-MICRO-EVIDENCE.md` for owner + ChatGPT
review. Then STOP and await review + push authorisation.

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
