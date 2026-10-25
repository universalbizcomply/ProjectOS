# ProjectOS Forge — Final Micro-Level Evidence (for Murad + ChatGPT review)

> **STATUS: PROJECTOS FORGE LOCALLY COMPLETE AND PROVEN — AWAITING MURAD/CHATGPT FINAL REVIEW AND PUSH
> AUTHORISATION.** Local-only. Nothing pushed. Remote `origin/projectos-v3` frozen at `4c3f076`; local
> tip after F10 is **25+ commits ahead, 0 behind**. Date: 2026-07-12.

This is the micro-level report the owner requested: every phase, every module + purpose, every
file/function, every review finding + fix, every invariant, the full anatomy of a generated app, the
safety ledger, the commit chain, and residual risks.

---

## 0. What Forge is

A chat-driven, **local-first, governance-aware** full-stack app generator: one command →
`blueprint → scaffold → provision → generate → verify → snapshot → integrate → deploy-gate`, producing a
running Next.js + Supabase + Tailwind + shadcn app you own, on your machine. Built to beat Lovable / Replit
Agent / Emergent on their documented weaknesses. **Hard rule: NO Claude/ChatGPT/metered AI API anywhere** —
generation runs via the owner's local Claude Code session over the desktop bridge (a local worker), or a
local model. Every deterministic engine (blueprint/scaffold/provisioner/verify/snapshot/deploy/integrations/
e2e) is zero-dependency, no-AI, no-network `.cjs`.

## 1. Lifecycle & governance

Each Forge phase followed the same canonical lifecycle as projectos-v2-core: advisor prompt/manifest →
**Claude implement (2) / local validate (3) / evidence pack (4)** → advisor/owner review (5) → closure (6).
Claude did steps 2–4 only; **never self-accepted, never closed, never pushed.** Every phase is one commit,
`AWAITING-REVIEW`.

## 2. Phase-by-phase (F1–F10) — module, purpose, key functions, reviews, invariants

### F1 — Blueprint Engine · `projectos/forge/blueprint-engine.cjs` (256 lines) · `ddb64a1`
- **Purpose:** chat command → deterministic structured blueprint (owner plan gate) before anything builds.
- **Functions:** `buildBlueprint(request)` (→ stack/pages/dataModel/apiContracts/integrations/refused/
  envVars/governance/planGate); `normalize`, `termMatches` (unified matcher), `detectDomain` (scored),
  `detectIntegrations`, `detectRefusedIntegrations`, `resolveDataModel`, `buildEnvVars`, `renderPlanGate`,
  `deriveName`, `deepFreeze`.
- **Guarantees:** default stack Next+Supabase+Tailwind+shadcn; integrations from a frozen allowlist;
  **metered-AI-API refused by construction** (`ai-api` in refusedIntegrations + governance.prohibited);
  env vars = NAMES + placeholders only; production frozen.
- **Reviews:** security HIGH (crash on adversarial `entities[].fields`) → crash-safe `safeStr`; MEDIUM
  (shallow-freeze let `ownerGated` be flipped) → deep-freeze; broadened AI-refusal lexicon; input-size
  bounds. code HIGH (hyphenated terms unreachable — normalize strips `-`) → unified `termMatches`
  normalizes the term; (prototype-pollution test was a no-op) → real object-literal test; dead tie-break
  removed; `buildBlueprint` split. **Validator:** `validate-forge-blueprint.cjs` — 15 invariants.

### F2 — Scaffold Engine · `projectos/forge/scaffold-engine.cjs` (325 lines) · `d079127`
- **Purpose:** blueprint → deterministic ~21-file secure-by-default monorepo manifest.
- **Functions:** `buildScaffold(blueprint)` → `{projectId, manifestHash, files[]}`; `ident` (strict,
  reserved-keyword-safe SQL identifier), `slug`, `sqlType`, `safeComment`, `assertSafePath`, and per-file
  templates (`tplPackageJson`, `tplEnvExample`, `tplSupabase{Server,Client,Request}`, `tplMigration`,
  `tplApiRoute`, `tplLayout`, `tplPage`, `tplProjectopsConfig`, `tplForgeConfig`, `tplCi`, `tplStaticFiles`).
- **Guarantees (secure by default):** service-role key confined to `server-only`; RLS + owner policies +
  update `WITH CHECK` per table; CRUD routes use a **user-scoped RLS-enforcing** client (not service-role);
  `.env.example` names-only; no metered-AI dependency; `.projectops` governance seeded; reserved-keyword-
  safe identifiers (`when`→`when_`, `order`→`order_`); engine-level path guard; replayable `forge.config`.
- **Reviews:** security 2 HIGH (code injection via `entity.name` in a route comment → newline strip;
  unguarded `page.path` traversal → per-segment sanitise + `assertSafePath`) + MEDIUM (update policy
  `WITH CHECK`; RLS-bypassing service-role client → user-scoped). code 2 HIGH (invalid SQL identifiers for
  multi-word names → `ident`; validator used an approximation not the real `slug`) + MEDIUM (localeCompare→
  ordinal; path-collision throw; deep replay compare). **Self-caught:** `when`/`order` reserved-keyword DDL
  bug → reserved-safe `ident`. **Validator:** `validate-forge-scaffold.cjs` — 12 core + 6 adversarial.

### F3 — Local Provisioner · `projectos/forge/provisioner.cjs` (119 lines) · `ebcbd4b`
- **Purpose:** materialise the manifest to a local dir (path-guarded); plan the run steps (owner-gated).
- **Functions:** `materializeManifest(scaffold, targetRoot, {allowedRoot})` (→ writes files);
  `resolveInside`, `assertSafeRelPath`, `assertNoSymlinkEscape`; `planProvision(scaffold, {approvalQueue})`
  (→ gated run plan, enqueues approval).
- **Guarantees:** target must resolve inside a trusted root; every file inside the target; **no write
  through a pre-existing symlink component** (lstat walk); null-byte paths refused; install/migrate/run are
  **owner-approval, never auto-run** (`executed:false`); no execution capability (fs/os/path only).
- **Reviews:** security MEDIUM (symlink TOCTOU) → `assertNoSymlinkEscape`; LOW (null byte) → explicit
  reject. **Validator:** `validate-forge-provisioner.cjs` — 10 invariants (temp-dir write + cleanup).

### F4 — Generation Loop · `projectos/forge/generation-loop.cjs` (160 lines) · `87aa799`
- **Purpose:** bounded worker loop that fills slots — hard budget cap + doom-loop halt.
- **Functions:** `runGenerationLoop({tasks, worker, files?, budgetCap?, perCallMax?, maxAttempts?,
  doomThreshold?, redactor?})`; `attemptTask` (per-task state machine), `clampCost`, `isSafeRelKey`,
  `applyDiff`.
- **Guarantees:** **spent can never exceed the budget cap** (per-call clamp + two gates); doom-loop halts a
  task at the threshold (no unbounded retry); worker response is **untrusted** (validated via the bridge —
  allowlisted side effects, forbidden-field strip, secret redaction); redacted diff applied with a strict
  relative-path allowlist; distinct outcomes (completed / doom-loop-halted / blocked / failed); no metered
  API.
- **Reviews:** security MEDIUM (Windows-absolute/UNC path in `applyDiff`) → `isSafeRelKey`. code HIGH
  (duplicate fallback id for id-less blocked tasks → per-task index) + MEDIUM (failure taxonomy dropped the
  reason → distinct reasons threaded; untested mid-budget/attempts-exhausted branches → new invariants;
  `attemptTask` extracted). **Validator:** `validate-forge-generation.cjs` — 13 invariants.

### F5 — Verification Harness · `projectos/forge/verify-harness.cjs` (60 lines) · `332aa66`
- **Purpose:** anti-Potemkin gate — prove the app actually works before "done".
- **Functions:** `runVerification({checks, verifier, requiredKinds?, redactor?})` → `{verified, results,
  failedRequired}`.
- **Guarantees:** a step passes only on explicit `passed===true` (fail/throw/malformed/missing = fail);
  verified only when every required kind (build/unit/**wired** round-trip) is present AND passed — a route
  that renders but fails the wired check is NOT verified; details redacted; no metered API.
- **Reviews:** self-reviewed (minimal surface: no I/O/exec/network). **Validator:**
  `validate-forge-verify.cjs` — 10 invariants (incl. malformed-input fail-closed).

### F6 — Env Snapshot & Rollback · `projectos/forge/env-snapshot.cjs` (94 lines) · `a9db468`
- **Purpose:** the reversibility primitive — exact restore + tamper detection + time-travel chain.
- **Functions:** `snapshot(files, label, parentId?)`, `restore(records, id)`, `history(records, id)`,
  `verifyChain(records)`, `hashState`, `freezeFiles`.
- **Guarantees:** deterministic content-addressed hash; **restore fails closed on a hash mismatch**
  (tamper); parent-linked chain with cycle guard; deep-frozen immutable records; no metered API.
- **Reviews:** self-reviewed (pure crypto/freeze; mirrors reviewed hash + freeze patterns). **Validator:**
  `validate-forge-snapshot.cjs` — 10 invariants (tamper, chain, cycle, immutability).

### F7 — Forge Command UI · `control-center/src/forge/{forgeModel.ts, ForgeConsole.tsx}` · `9f87425`
- **Purpose:** owner types a command → watches the 6-stage governed pipeline (user-facing).
- **Model:** `forgeModel.ts` — `FORGE_RUNS`, `forgeRunForCommand`, `budgetPercent`, `verifyTone`,
  `isVerified` (mirrors the F5 anti-Potemkin gate). **Component:** `ForgeConsole.tsx` — Blueprint / Scaffold
  (file list) / Budget (meter, "hard cap — never exceeded") / Verification (badges + verdict) / Snapshots /
  Safety + inert owner-only chips. Nav view added in `App.tsx`; styles + 6 unit tests.
- **Guarantees:** snapshot-driven, inert (no real gen/exec in the UI), no network/AI/secret; surfaces the
  budget hard-cap, the anti-Potemkin verdict, and the metered-AI refusal.
- **Reviews:** self-reviewed (pure tested model + presentational component). typecheck PASS; vitest 89
  passed; build PASS. **Live browser proof** localhost:5178: renders; command booking↔shop routing;
  "ai-api (no metered AI API)" refused + NOT-verified verdict on the unwired run; no console errors; no
  external network; no overflow at 1440/1280/1024/768/390 (DOM-verified). **Honesty note:** the browser
  pane's screenshot capture timed out (renderer/capture hang; page stayed responsive) — no image attached,
  nothing fabricated.

### F8 — Secure Deploy Gate · `projectos/forge/secure-deploy-gate.cjs` (108 lines) · `ede6294`
- **Purpose:** fail-closed pre-deploy security gate + deploy plan.
- **Functions:** `auditManifest(scaffold)` (→ blockers/warnings), `isServerOnly`, `isCodeFile`,
  `planDeploy({target, productionFrozen})`, `canDeploy(scaffold, plan)`.
- **Guarantees:** scans **every non-server-only code file** for the service-role key / secret shapes (incl.
  `sb_secret_`) / secret-named `NEXT_PUBLIC_` vars; requires RLS + owner policies **referencing
  `auth.uid()`** (rejects `using (true)`/`with check (true)`) + update `WITH CHECK`; tolerant table parsing
  (uppercase/unparseable = blocker); production REFUSED, staging OWNER_GATED, never executed; `canDeploy`
  validates the plan (target + executed) — non-forgeable.
- **Reviews:** security found the first cut **failed OPEN** — 3 CRITICAL (narrow client-reachability,
  case-brittle table regex, substring-only policy checks) + HIGH (missed `sb_secret_`/`NEXT_PUBLIC_` secret)
  + MEDIUM (trusted the plan object). **All fixed by inverting to fail-closed**, each locked by a negative
  fixture. **Validator:** `validate-forge-deploy.cjs` — 14 checks (incl. 4 CRITICAL-surfacing).

### F9 — Integration Playbooks · `projectos/forge/integration-playbooks.cjs` (119 lines) · `46e69d9`
- **Purpose:** verified wiring for stripe/email/storage (placeholders; real keys owner-gated).
- **Functions:** `buildPlaybook(id)`, `buildPlaybooks(ids)`; frozen `PLAYBOOKS` table.
- **Guarantees:** placeholders only (env NAMES, no values); keyed clients `server-only`; stripe webhook
  signature-verified; real keys owner-gated; auth/realtime/search have no playbook (base scaffold);
  deterministic, collision-guarded.
- **Reviews:** self-reviewed + **cross-checked**: the emitted wiring and a base+playbooks manifest both PASS
  the F8 fail-closed audit. **Validator:** `validate-forge-integrations.cjs` — 10 invariants.

### F10 — Forge E2E + this report · `projectos/forge/forge-e2e.cjs` (105 lines) · this commit
- **Purpose:** drive the whole chain offline; produce this micro report.
- **Functions:** `runForgeE2E()` composes buildBlueprint → buildScaffold → planProvision →
  runGenerationLoop → runVerification → snapshot → buildPlaybooks → auditManifest → planDeploy across 4
  scenarios (happy-path, insecure-blocked, potemkin-not-verified, budget-cap).
- **Result:** all 4 scenarios PASS — happy path = generated → verified → secure → deploy owner-gated; a
  client-side secret leak blocks the deploy; an unwired app is not verified; the budget cap is enforced.
- **Validator:** `validate-forge-e2e.cjs` — 4 invariants (all pass / all present / no leak / deterministic).

## 3. Anatomy of a generated app (~21 files, from a booking-app blueprint)

```
package.json                         next/react/@supabase; NO openai/anthropic
next.config.mjs · tsconfig.json      strict TS (noUncheckedIndexedAccess)
tailwind.config.ts · postcss.config.mjs · app/globals.css
.gitignore                           excludes .env (never commit secrets)
.env.example                         env var NAMES only, no values
.projectops/config.json              production frozen; metered AI API prohibited; owner-gated actions
forge.config.json                    replay record: the blueprint + manifestHash
README.md
app/layout.tsx · app/page.tsx · app/admin/page.tsx        route pages
app/api/booking/route.ts             auth-guarded CRUD via the USER-SCOPED (RLS-enforcing) client
lib/supabase/server.ts               import "server-only"; service-role key — NEVER in the client bundle
lib/supabase/client.ts               public anon key only
lib/supabase/request.ts              per-request client bound to the caller's JWT → RLS enforces
supabase/migrations/0001_init.sql    RLS ON + owner-scoped policies (auth.uid()) + update WITH CHECK
__tests__/smoke.test.ts · .github/workflows/ci.yml
```
With integrations (F9) merged: `app/api/stripe/{webhook,checkout}/route.ts` (server-only, webhook
signature-verified), `lib/email.ts` (server-only), `lib/storage.ts` (public client). The whole manifest
passes the F8 fail-closed audit.

## 4. How Forge beats the incumbents (evidence)

| Incumbent failure (researched) | Forge fix (phase · proof) |
| --- | --- |
| Cost blowups — two meters, no cap | BYO local worker (no token meter) + **hard budget cap** — spent can never exceed (F4, invariant 2/7) |
| Agent doom-loops ("fix one break another") | doom-loop halt at threshold (F4, invariant 3) |
| "60% problem" — breaks on auth/payments/relational | deterministic secure scaffolds for exactly those (F2) + verify-first (F5) |
| Security by omission (RLS missing, service-key in bundle) | secure-by-default scaffold (F2) + **fail-closed deploy gate** (F8) |
| Replit July-2025: agent nuked a prod DB | production frozen + dev/prod split + provider guards + approval queue — **structurally impossible** |
| Potemkin UIs (render but not wired) | anti-Potemkin `wired` verification gate (F5) |
| Lock-in, no reversibility | local-first ownership + exact snapshot/rollback (F6) |

## 5. Test / validator inventory

`npm run validate` → **ALL PASS, 59 validators** — 9 Forge validators
(`validate-forge-{blueprint,scaffold,provisioner,generation,verify,snapshot,deploy,integrations,e2e}`) with
**~110 Forge invariants total**, plus the 50 pre-existing ProjectOS/V3 validators. Control-center:
`typecheck` PASS · `vitest` **89 passed** · `build` PASS. `git diff --check` clean.

## 6. Safety ledger (whole Forge programme)

Production touched: **NO** · Deploy: **NO** (planned/gated only) · DB mutation: **NO** · External sends:
**NO** · Payments: **NO** · Provider access: **NO** · Real secrets used: **NO** (synthetic/placeholders) ·
**Claude/ChatGPT/metered AI API: NO — by construction, source-scanned in every module** · Network beyond
localhost preview: **NO** · Process spawn: **NO** · Disk writes: only the provisioner, inside a trusted
root, tested against a temp dir · Force push / any push: **NO** · Claude approved/closed a phase or granted
PLAN READY: **NO**.

## 7. Commit chain (Forge, local, not pushed)

```
ddb64a1 F1 blueprint engine     d079127 F2 scaffold engine     ebcbd4b F3 local provisioner
87aa799 F4 generation loop      332aa66 F5 verification harness a9db468 F6 env snapshot + rollback
9f87425 F7 command UI           ede6294 F8 secure deploy gate   46e69d9 F9 integration playbooks
(this)  F10 e2e + micro evidence
```
(Preceded by the ProjectOS V3 chain — Phases 3–13 + 17 local-complete, 14–16 PolyGo blocked — also
unpushed. Remote `origin/projectos-v3` remains `4c3f076`.)

## 8. Residual risks / carry-forward

- **The real build is worker-driven and owner-gated by design.** F1–F10 model + prove the deterministic
  pipeline and the untrusted-worker contract; wiring the loop to the actual local Claude Code session
  (real generation), a real local Supabase, and a real dev-server boot are owner-approved integration steps
  (the provisioner's gated run plan). No metered API is ever introduced.
- The generated-app security is enforced statically (F8 audit) + at runtime (RLS). Real deploy stays behind
  the provider guards + approval queue.
- Verification `wired` check is a contract the local verifier must implement (build/test/Playwright); F5
  gates on its honest boolean.
- F5/F6/F7/F9 were self-reviewed (minimal/pure surfaces); F1/F2/F3/F4/F8 had full security + code agent
  reviews. An owner may request agent review of the self-reviewed phases.
- Redaction is exact-string (documented); PolyGo pilot remains blocked (V3 14–16).

## 9. Requested of owner / gatekeeper (ChatGPT)

1. Review this report + the 10 per-phase Forge reports (linked in `knowledge/ProjectOS Reports Index.md`).
2. Accept Forge F1–F10 (Claude does not self-accept/close).
3. **Authorise the push** of the local `projectos-v3` chain (V3 + Forge, ~25 commits) to
   `origin/projectos-v3` — Claude will not push without explicit, separate authorisation.
4. To move to real generation: approve wiring the F4 loop to the local Claude Code worker + a local Supabase
   (still no metered API), via the provisioner's owner-gated run plan.

---

**STATUS: PROJECTOS FORGE LOCALLY COMPLETE AND PROVEN — AWAITING MURAD/CHATGPT FINAL REVIEW AND PUSH
AUTHORISATION.** Local-only. Nothing pushed. Remote remains `4c3f076`.
