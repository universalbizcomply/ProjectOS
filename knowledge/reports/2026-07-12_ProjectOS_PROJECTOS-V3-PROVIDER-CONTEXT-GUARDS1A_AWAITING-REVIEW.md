# ProjectOS — PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 11:** `PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `06670c8…`

---

## 1. Objective

The safety net that makes external-provider access impossible without an explicit, owner-approved,
unfrozen path. Before any operation that WOULD touch a provider (Supabase, Vercel, GitHub,
email/SMS/WhatsApp, payments), a deterministic guard classifies the **intent** — never contacting a
provider — and returns `ALLOW` (plan-only, no contact) / `OWNER_GATED` (needs owner approval) / `REFUSED`
(default).

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/guards/provider-context-guards.cjs` — `evaluateProviderIntent(intent, { approvalQueue,
  redactor })`. Per-provider action allowlist (frozen); explicit dispatch that **defaults to REFUSED**:
  prohibited → REFUSED; plan-only → ALLOW; production-targeting → REFUSED if frozen (default true, fail
  safe) else OWNER_GATED; owner-gated → OWNER_GATED. On any gated decision it enqueues a redacted
  approval item (Phase 10). No real endpoints/credentials in config (synthetic).
- `projectos/validators/validate-provider-context-guards.cjs` — 13 executable invariants (incl. the
  default-frozen case), registered in `validate-all.cjs`. Synthetic data only.

## 3. Invariants proven (all PASS)

1 unknown provider REFUSED · 2 unknown action REFUSED · 3 prohibited (email send) REFUSED — never gated ·
4 payment charge REFUSED · 5 production-targeting + frozen REFUSED · 5b **omitted productionFrozen
defaults to frozen** → REFUSED · 6 production-targeting + unfrozen → OWNER_GATED + approval item ·
7 owner-gated → OWNER_GATED + approval item · 8 plan-only → ALLOW, zero enqueues · 9 missing fields
REFUSED · 10 secret in params redacted in the approval item · 11 no endpoint/credential in guard source ·
12 no ALLOW for any real (non-plan-only) provider action.

## 4. Review — security (security-reviewer agent)

Confirmed sound: dunder-key provider/action strings (`__proto__`, `constructor`) resolve to REFUSED
(`hasOwnProperty` lookups); prohibited always REFUSED (first branch); ALLOW single-sourced to plan-only;
`productionFrozen` fail-safe for any non-`false` value; missing input REFUSED; secrets redacted before
enqueue; no I/O. **HIGH fixed**: the category dispatch fell through to OWNER_GATED for an unrecognised
category (a future config typo could downgrade a prohibited action) — replaced with an explicit `switch`
that **defaults to REFUSED** (`unknown-category`). **MEDIUM fixed**: `PROVIDERS` table is now deep-frozen
so no in-process code can downgrade a decision by mutating it. **MEDIUM fixed**: added invariant 5b for
the omitted-`productionFrozen` default. No open HIGH/CRITICAL.

## 5. Review — ECC

This phase *is* an ECC guarantee: provider access defaults to REFUSED and is only ever OWNER_GATED via an
owner-approval item — never auto-allowed. No PLAN READY effect. Local-only; no provider/secret/API/
network/disk. Completion accounting unchanged (Phase 11 local-implementation-complete → programme stays
**15.8%**).

## 6. Tests / validators

- `node projectos/validators/validate-provider-context-guards.cjs` → **PASS** (13 invariants).
- `npm run validate` (full suite, now 48 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 7. Live proof

No user-facing surface (backend guard) → no browser proof applies. Proof is the validator executing the
real guard and asserting all 13 invariants, including the fail-closed default, prohibited-always-refused,
and production-frozen cases — run above, all PASS.

## 8. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO (intent classified, never
contacted) · Real secrets: NO · AI API: NO · Network: NO · Disk: NO. No external repo / PolyGo touched.

## 9. Residue / carry-forward

- Carry-forward: Phase 12 (Control-Centre integration) surfaces guard decisions + the resulting approval
  items in the Owner Control Plane; the guard sits in front of any future real provider adapter so that
  adapter can never run without an owner-approved, unfrozen decision.

## 10. Next phase

`PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A` (Phase 12).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
