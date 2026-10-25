# ProjectOS — PROJECTOS-FORGE-BLUEPRINT1A (F1) — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS Forge (chat → full-stack app) · **Phase F1:** `PROJECTOS-FORGE-BLUEPRINT1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — steps 2–4 (implement / validate / evidence) done by
Claude Code; **awaiting advisor/owner review (step 5) + closure (step 6)**. **Not pushed.**
**Branch:** `projectos-v3` · **Lifecycle:** same canonical phase lifecycle as projectos-v2-core.

---

## 1. Objective

The first Forge stage: turn a plain-language chat command into a **deterministic, structured blueprint** —
the owner-visible plan of exactly what would be built (stack, pages, data model, API contracts,
integrations, env-var names, governance) — before anything is scaffolded. Pure, zero-dependency,
**NO AI, NO network, NO metered API** (owner directive). This is the plan gate that fronts the whole
Forge pipeline.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/forge/blueprint-engine.cjs` — `buildBlueprint(request)` → blueprint. Deterministic:
  normalizes the request, scores domain heuristics (booking/crm/blog/todo/dashboard/shop), detects
  allowlisted integrations (auth/payments/email/storage/realtime/search), **refuses metered-AI-API asks
  by construction**, derives a starter data model + CRUD API contracts, and emits an env-var manifest of
  **names + placeholders only (no values)**. Governance block: production frozen; auto-allowed vs
  owner-gated vs prohibited (incl. anthropic-api/openai-api/metered-llm-api). `renderPlanGate` produces a
  plain-language owner summary.
- `projectos/validators/validate-forge-blueprint.cjs` — **15 executable invariants**, registered in
  `validate-all.cjs`. Synthetic requests only.
- `docs/architecture/projectos-forge-master-plan.md` — the F1–F10 programme plan (level-1 design).

## 3. Invariants proven (all PASS)

1 basic build · 2 empty description throws · 3 default stack (Next+Supabase+Tailwind+shadcn) · 4 domain
seeding (todo→Task, shop→Product/Order) · 5 integration detection + owner-gating + secret NAMES
(stripe→payments) · 6 metered-AI-API refused, never in integrations · 7 env vars are names/placeholders
only, no secret-shaped values · 8 production frozen + prohibits anthropic/openai/metered-llm API · 9
auth-required API contract per entity · 10 plan gate string (stack + production-frozen, no secret) · 11
deterministic · 12 caller entities merged + prototype-pollution safe + **crash-safe on null/junk fields**
· 13 domain disambiguation ("barber shop" booking not shop) · 14 stack override (vite spa) · 15
hyphenated + possessive lexicon reachability ("e-commerce"→shop, "OpenAI's API"→refused).

## 4. Live demo (deterministic, offline)

Command *"a booking app for a barber shop with stripe payments, email reminders and customer accounts"* →
plan gate:
```
Project: A Booking App
Stack: next + supabase + tailwind + shadcn
Pages: Book (/), Schedule (/admin)
Data: Booking
Integrations: auth, payments [owner-approval], email [owner-approval]
Secrets needed (names only, owner provides later): SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, EMAIL_API_KEY
Production: FROZEN. Deploy / live DB / real keys / payments / push require your approval.
```

## 5. Review — security (security-reviewer agent)

Verified holds: no secret VALUE can enter the blueprint (env vars built from a fixed template, `request`
never merged into env vars); a refused AI-API can NEVER enter `integrations[]` (separate lexicon);
governance prohibits the metered-AI APIs; production frozen; owner-gated integrations flagged; no ReDoS
(regexes from a fixed normalized lexicon); no prototype-pollution vector (only named keys read).
**HIGH fixed**: crash on adversarial `entities[].fields` (null / hostile `toString`) → crash-safe
`safeStr` + object-filter (invariant 12). **MEDIUM fixed**: config maps **deep-frozen** (shallow freeze
let `payments.ownerGated` be flipped process-wide); AI-refusal lexicon broadened to single-token
providers so possessives ("OpenAI's API") still trigger the refusal notice; input-size bounds
(description ≤ 20k, entities ≤ 200). Documented: `name`/`description`/`planGate` are untrusted display
strings — downstream UI must HTML-escape. No open HIGH/CRITICAL.

## 6. Review — code (code-reviewer agent)

**HIGH fixed**: hyphenated lexicon terms ("e-commerce", "real-time", "full-text") were permanently
unreachable (normalize strips hyphens) → unified `termMatches` normalizes the term too (invariant 15);
invariant-12 prototype test was a no-op (JSON.parse `__proto__` semantics) → now a real object-literal
test asserting `Object.prototype` intact. **MEDIUM fixed**: removed the dead tie-break branch in
`detectDomain`; deduped the match predicate into one `termMatches`; extracted `resolveDataModel` +
`buildEnvVars` to bring `buildBlueprint` under the size guideline; added the vite-override test
(invariant 14). No open HIGH/CRITICAL.

## 7. Review — ECC

The blueprint hard-codes the governance model into every future project: production frozen, metered AI
API prohibited by construction, provider/secret/deploy/push owner-gated, secrets as names only. No PLAN
READY effect. Local-only; no provider/secret/API/network. This is F1 of the Forge programme; it does not
change V3 completion accounting.

## 8. Tests / validators

- `node projectos/validators/validate-forge-blueprint.cjs` → **PASS** (15 invariants).
- `npm run validate` (full suite, now 51 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 9. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO ·
AI API: **NO (forbidden by design)** · Network: NO · Disk: NO. No external repo / PolyGo touched.

## 10. Next phase

**F2 — Scaffold/Template Engine**: blueprint → running Next.js+Supabase+Tailwind+shadcn monorepo from
versioned templates + typed slots; seeds `.projectops`, tests, CI, secure defaults; replayable
`forge.config.json`.

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
