# ProjectOS Forge — Programme Checkpoint

> Durable resume record for the ProjectOS Forge programme (chat command → full-stack app). Read this,
> `docs/architecture/projectos-forge-master-plan.md`, the latest Forge phase report, and `git log` on
> resume. Local-only until owner authorises a push. Same canonical lifecycle as projectos-v2-core:
> advisor prompt/manifest → Claude implement/validate/evidence → advisor/owner review → closure. Claude
> does steps 2–4 only; never accepts/closes; never pushes without owner authorisation.

**Last updated:** 2026-07-12 · **Branch:** `projectos-v3` (Forge builds on the completed V3 governed chain).

## Hard constraints (owner directives)

- **NO Claude/ChatGPT/metered AI API — ever.** Generation runs via the owner's LOCAL Claude Code session
  through `bridge/desktop-bridge.cjs` (a local worker, not an API) or a local model (Ollama/Ornith).
  ChatGPT↔Claude stays git-repo bus + owner relay (no API bridge).
- Local-first + optional cloud deploy (owner-gated). Tiered autonomy (auto safe / gate risky). Default
  stack Next.js + Supabase + Tailwind + shadcn. Auto-provision frontend+backend, DB+auth, plugins,
  CI+tests+governance.
- Local-only; one commit per phase; no push/deploy/prod/DB/sends/payments/real-secrets without owner
  authorisation; synthetic by default; live proof for user-facing phases; no fabricated evidence.
- **FINAL DELIVERABLE (owner directive):** at full Forge completion (F10), write a MICRO-LEVEL completion
  report for owner + ChatGPT review — every phase, every module + its purpose, every file/function,
  every review finding + fix, every invariant proven, the full anatomy of a generated app (all ~20 files
  explained), the safety ledger, the commit chain, and residual risks/carry-forward. Path:
  `knowledge/reports/PROJECTOS-FORGE-FINAL-MICRO-EVIDENCE.md`.

## Phase status

| Phase | ID | Status |
| --- | --- | --- |
| F1 | PROJECTOS-FORGE-BLUEPRINT1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F2 | PROJECTOS-FORGE-SCAFFOLD1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F3 | PROJECTOS-FORGE-PROVISIONER1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F4 | PROJECTOS-FORGE-GENERATION1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F5 | PROJECTOS-FORGE-VERIFY1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F6 | PROJECTOS-FORGE-SNAPSHOT1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F7 | PROJECTOS-FORGE-COMMAND-UI1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F8 | PROJECTOS-FORGE-SECURE-DEPLOY1A | **NEXT — not started** |
| F9 | PROJECTOS-FORGE-INTEGRATIONS1A | pending |
| F10 | PROJECTOS-FORGE-E2E-CLOSURE1A | pending |

## Reuse map (V3 → Forge)

launcher · desktop-bridge (local worker, no API) · secret + operation brokers · redaction · provider
guards (default REFUSED, + hard-refuse anthropic/openai/metered-llm API) · approval queue · e2e runner ·
reliability-hardening · control-center owner surfaces · plan-governance/discovery engines. New Forge
modules: blueprint engine (F1 done) · scaffold/template engine · local provisioner · generation loop ·
verify harness · env snapshot/rollback · budget meter · Forge command UI.

## F1 result (LOCAL IMPLEMENTATION COMPLETE — awaiting review, not pushed)

`projectos/forge/blueprint-engine.cjs` + `validators/validate-forge-blueprint.cjs` (15 invariants,
registered). Deterministic chat-command → blueprint (stack/pages/data model/API contracts/integrations/
env-var names/governance); metered-AI-API refused by construction; secrets as names only; production
frozen. security-reviewer (HIGH field-crash fixed; deep-freeze; broadened refusal; size bounds) +
code-reviewer (hyphen-term reachability, real pollution test, dead-code removal, helper extraction).
validate-all ALL PASS (51). Report:
`knowledge/reports/2026-07-12_ProjectOS_PROJECTOS-FORGE-BLUEPRINT1A_AWAITING-REVIEW.md`. Committed
`feat(projectos): add forge blueprint engine (F1)` (local, not pushed).

## F2 result (LOCAL IMPLEMENTATION COMPLETE — awaiting review, not pushed)

`projectos/forge/scaffold-engine.cjs` + `validators/validate-forge-scaffold.cjs` (18 checks, registered).
Blueprint → deterministic ~21-file secure-by-default Next.js+Supabase+Tailwind monorepo manifest
(service-role confined to `server-only`; RLS + owner policies + update WITH CHECK; user-scoped
RLS-enforcing CRUD routes; `.env.example` names-only; no AI dep; `.projectops` governance seeded;
reserved-keyword-safe SQL idents; engine-level path guard; replayable forge.config + hash). security
(2 HIGH: comment code-injection, path traversal — fixed) + code (2 HIGH: SQL identifiers, validator
contract — fixed) + self-caught reserved-keyword bug. validate-all ALL PASS (52). Committed
`feat(projectos): add forge scaffold engine (F2)` (local, not pushed).

## F3 result (LOCAL IMPLEMENTATION COMPLETE — awaiting review, not pushed)

`projectos/forge/provisioner.cjs` + `validators/validate-forge-provisioner.cjs` (10 invariants,
registered). `materializeManifest` writes the manifest to a local dir path-guarded (inside a trusted
allowedRoot; per-file containment; **symlink-component refusal** + null-byte reject after review);
`planProvision` gates install/migrate/run for owner approval and never runs them. security-reviewer
(MEDIUM symlink TOCTOU + LOW null-byte — fixed). validate-all ALL PASS (53). Committed
`feat(projectos): add forge local provisioner (F3)` (local, not pushed).

## F4 result (LOCAL IMPLEMENTATION COMPLETE — awaiting review, not pushed)

`projectos/forge/generation-loop.cjs` + `validators/validate-forge-generation.cjs` (13 invariants,
registered). Bounded worker loop via the bridge (untrusted-response validated); HARD budget cap (spent
can never exceed; over-budget tasks blocked); doom-loop halt at threshold; secret redaction; relative-
path-safe diff apply; deterministic; NO metered API. security (MEDIUM path allowlist) + code (HIGH
duplicate-id, MEDIUM taxonomy/coverage/extraction) — fixed. validate-all ALL PASS (54). Committed
`feat(projectos): add forge generation loop (F4)` (local, not pushed).

## F5 result (LOCAL IMPLEMENTATION COMPLETE — awaiting review, not pushed)

`projectos/forge/verify-harness.cjs` + `validators/validate-forge-verify.cjs` (10 invariants, registered).
Anti-Potemkin verification gate: an app is "verified" only when required kinds (build+unit+**wired**
round-trip) all pass; fail-closed on fail/throw/malformed/missing; details redacted; deterministic; no
metered API/network/exec. Self-reviewed (minimal surface). validate-all ALL PASS (55). Committed
`feat(projectos): add forge verification harness (F5)` (local, not pushed).

## F6 result (LOCAL IMPLEMENTATION COMPLETE — awaiting review, not pushed)

`projectos/forge/env-snapshot.cjs` + `validators/validate-forge-snapshot.cjs` (10 invariants, registered).
Deterministic content-addressed snapshot/restore: exact rollback, tamper detection (hash), parent-linked
chain + cycle guard, deep-frozen records, no metered API. Self-reviewed (pure crypto/freeze, mirrors
reviewed patterns). validate-all ALL PASS (56). Committed `feat(projectos): add forge env snapshot +
rollback (F6)` (local, not pushed).

## F7 result (LOCAL IMPLEMENTATION COMPLETE — awaiting review, not pushed)

`control-center/src/forge/{forgeModel.ts, ForgeConsole.tsx}` + App nav + styles + `test/forgeModel.test.ts`
(6 tests). Forge Console: command → 6-stage pipeline (blueprint/scaffold/budget/verify/snapshots/safety),
inert owner-only chips; deterministic command routing; surfaces the budget hard-cap + anti-Potemkin verdict
+ metered-AI refusal. typecheck PASS; vitest 89 passed; build PASS; validate-all ALL PASS (56). Live browser
proof (localhost:5178): renders, command booking↔shop routing, "ai-api (no metered AI API)" refused +
NOT-verified verdict on the unwired run, no console errors, no external network, no overflow at
1440/1280/1024/768/390 (DOM-verified; the screenshot capture tool timed out — recorded honestly, no image
fabricated). Committed `feat(projectos): add forge command UI (F7)` (local, not pushed).

## Next exact safe action (resume here)

**Begin F8 — `PROJECTOS-FORGE-SECURE-DEPLOY1A`.** A deterministic pre-deploy security gate over a generated
project's file manifest + a deploy plan: (a) **bundle secret-grep** — refuse if any client-reachable file
would ship a secret-shaped value or the service-role key; (b) **RLS deny-tests** — assert every table has
RLS + owner policies + update WITH CHECK; (c) CORS-not-`*` / rate-limit / webhook-signature defaults
present; (d) a deploy PLAN that is REFUSED for production and OWNER_GATED for staging (reuse provider guards
+ approval queue) — deploy is never auto-run. Zero-dep `.cjs` (operate on the F2 manifest shape) + validator:
secret in a client file blocks deploy, missing RLS blocks, prod deploy refused, staging owner-gated, no
metered API. Reviews → validators → report → index row → one commit `feat(projectos): add forge secure
deploy gate (F8)` (no push) → F9 (integrations) → F10 (E2E + MICRO-LEVEL final evidence report).

### OLD F7 note (superseded):

**Begin F7 — `PROJECTOS-FORGE-COMMAND-UI1A` (USER-FACING → needs LIVE browser proof).** A control-center
surface (extend `projectos/control-center/`, no second app): an owner types a build command → sees the
deterministic blueprint (F1), the planned scaffold file list (F2), estimated cost + budget (F4), a
verification checklist (F5), and snapshot/rollback points (F6), with owner-only actions (provision/deploy)
as inert chips routed to the approval queue. SNAPSHOT-DRIVEN + inert (no real generation/exec in the UI;
the actual build runs via the local worker, owner-approved). Build a pure TS view model wrapping the F1–F6
shapes with a synthetic snapshot + a component + nav view + unit tests. Reviews (security/code/ECC/UI-UX)
→ typecheck/vitest/build + validate-all → **live browser proof** (localhost + browser at
1440/1280/1024/768/390, screenshots + console/network) → report → index row → one commit
`feat(projectos): add forge command UI (F7)` (no push) → F8.

### OLD F6 note (superseded):

**Begin F6 — `PROJECTOS-FORGE-SNAPSHOT1A`.** Whole-environment snapshot + rollback = the reversibility
primitive (code + deps + DB), so a bad generation is undoable — what the incumbents charge for. Model a
deterministic snapshot/restore over the in-memory project file-state (Map path→content) + a metadata
manifest (hash, parent, label): `snapshot(state,label)` → immutable record; `restore(records,id)` → prior
state; a chain with parent links; rollback returns an EXACT prior state (hash matches). Reuse the
scaffold's manifest-hash idea; note real git-commit + local-DB snapshot wiring is the F3/provisioner +
later integration (owner-gated). Zero-dep `.cjs` + validator: snapshot deterministic, restore is exact,
tamper detected (hash), no secret leak, chain integrity, no metered API. Reviews → validators → report →
index row → one commit `feat(projectos): add forge env snapshot + rollback (F6)` (no push) → F7 (Forge
command UI — user-facing, live browser proof).

### OLD F5 note (superseded):

**Begin F5 — `PROJECTOS-FORGE-VERIFY1A`.** A verification harness that proves a generated app actually
works before "done" (anti-Potemkin). Model a verifier that runs, against a generated project: build check,
unit tests, and a browser/route smoke — as a checklist of verification STEPS with pass/fail, driven by a
synthetic verifier in tests (the real build/browser run is owner-approved and uses the local worker/
preview, NO metered API). Fail-closed: a task is "done" only when its verification passes; a Potemkin UI
(renders but not wired) must be caught. Reuse the bridge (untrusted verifier response), redaction,
approval queue for the owner-approved real run. Zero-dep `.cjs` + validator: verification gates
completion, Potemkin detected, no secret leak, deterministic, no metered API. Reviews → validators →
report → index row → one commit `feat(projectos): add forge verification harness (F5)` (no push) → F6.

### OLD F4 note (superseded):

**Begin F4 — `PROJECTOS-FORGE-GENERATION1A`.** Bounded feature-generation loop: hand a scoped task
(fill a typed slot / add a feature) to the LOCAL Claude Code worker via `bridge/desktop-bridge.cjs`
(a local worker — **NO Claude/ChatGPT/metered API**), applying INCREMENTAL diffs (not full-context
resend), with a per-task token/spend BUDGET CAP + a live cost-per-feature readout, and DOOM-LOOP
detection (K repeated failures → stop / switch to a fresh-context consultant, don't retry unboundedly).
Deterministic orchestration in a zero-dep `.cjs` (the generation itself is the worker's job; F4 models
the loop, budget, diff-application, and stop conditions with a synthetic worker for tests). Reuse the
bridge (untrusted-response validation), redaction, approval queue. Validator invariants: budget cap
enforced (never exceeds), doom-loop halts, diffs applied deterministically, no secret leak, worker
response untrusted (side effects gated), no metered-API. Reviews → validators → report → index row →
one commit `feat(projectos): add forge generation loop (F4)` (no push) → continue F5.

### OLD F3 note (superseded — kept for context):

**Begin F3 — `PROJECTOS-FORGE-PROVISIONER1A`.** Materialise the F2 manifest to a local project directory
(inside a synthetic/scratch root, path-guarded), then plan the local run: install deps + run migrations
against a LOCAL Supabase + boot the dev server. Anything touching a real provider/live DB/deploy is
owner-gated (route through provider guards + approval queue); synthetic/local by default. In F3 the
"write manifest to disk" is a safe local action; actual `npm install` / DB / server start should be a
launch SPEC (reuse `launcher/session-launcher.cjs`) that the owner approves — do NOT auto-run network
installs. Add a validator: manifest → files written to a scratch dir deterministically, path-safe, no
secret values on disk, and a launch spec that is BLOCKED_AWAITING_OWNER for the install/run steps.
Reviews → validators (+ live proof if a real local boot is owner-approved) → report → index row → one
commit `feat(projectos): add forge local provisioner (F3)` (no push) → continue F4.

**Command to run next:** `cd C:/dev/ProjectOS && git status && npm run validate`
