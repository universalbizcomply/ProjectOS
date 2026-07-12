# ProjectOS — PROJECTOS-FORGE-VERIFY1A (F5) — Phase Evidence

**Programme:** ProjectOS Forge · **Phase F5:** `PROJECTOS-FORGE-VERIFY1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** (steps 2–4) — awaiting advisor/owner review + closure. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `87aa799…`

---

## 1. Objective

Prove a generated app actually **works** before it is called "done" — the **anti-Potemkin** gate (catch UIs
that render but aren't wired: mocked data, dead handlers). Runs an ordered checklist (build, unit tests,
route smoke, and a **`wired` data-round-trip** check) through a LOCAL verifier (the owner's Claude Code
worker / local test runner — **NO metered API**). Fail-closed.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/forge/verify-harness.cjs` — `runVerification({ checks, verifier, requiredKinds?, redactor? })`.
  Each step passes ONLY on an explicit `passed === true`; a fail / throw / malformed / missing result is a
  failure. An app is `verified` only when **every required kind** (`build`, `unit`, `wired` by default) is
  present AND passed — so a route that renders but whose `wired` check fails is correctly NOT verified.
  Check details are redacted. Returns `{ verified, results, failedRequired }`.
- `projectos/validators/validate-forge-verify.cjs` — **10 invariants** with synthetic verifiers, registered.

## 3. Invariants proven (all PASS)

1 all required pass → verified · 2 failed required caught + listed · 3 **anti-Potemkin**: build+unit+smoke
pass but `wired` fails → NOT verified · 4 a throwing verifier check fails closed · 5 missing required kind
→ not verified · 6 secret in a detail redacted · 7 deterministic · 8 failing OPTIONAL check doesn't block ·
9 fail-closed on malformed verifier results (`"true"`, `1`, `null`, `{}`, … never count as passed) · 10 no
network/metered-API/spawn (source-scanned).

## 4. Reviews

- **Security / ECC:** the module is pure gating + redaction — no disk, no exec, no network, no metered API
  (enforced by invariant 10). The verifier (untrusted worker) result is never trusted beyond an explicit
  boolean, and its detail is redacted. Anti-Potemkin `wired` requirement is the reliability guarantee the
  incumbents lack. Fail-closed throughout. No PLAN READY effect. Local-only.
- **Code (self-review):** minimal-surface, deterministic, functions under the size guideline, no dead code,
  explicit fail-closed predicate, deduped `failedRequired`. Given the tiny attack surface (no I/O/exec) this
  phase was self-reviewed rather than agent-reviewed; the 10 invariants (incl. malformed-input and
  no-network scans) lock the contract.

## 5. Tests / validators

- `node projectos/validators/validate-forge-verify.cjs` → **PASS** (10 invariants).
- `npm run validate` (full suite, now 55 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 6. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO ·
AI API: NO · Network: NO · Disk: NO · Spawn: NO. No external repo / PolyGo touched.

## 7. Next phase

**F6 — Env Snapshot & Rollback**: git-checkpoint + local snapshot = whole-environment time-travel (code +
deps + DB), so a bad generation can be rolled back — the reversibility primitive the incumbents charge for.

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
