# ProjectOS Forge — Chat-to-Full-Stack-App Master Plan

> **Goal (owner):** send a command through chat → a full project environment is created with everything
> wired: backend, frontend, database, auth, plugins/integrations. Must be better than Emergent, Replit
> Agent, and Lovable — combining their pros and fixing their systematic failures.
>
> **Status:** DESIGN (not started). Builds ON TOP of the completed ProjectOS V3 governed chain
> (secret broker, operation broker, session launcher, desktop bridge, e2e runner, approval queue,
> provider guards, reliability hardening, Owner Control Plane / Chat / Safety-Providers UI).
> Local-only until owner authorises. Date: 2026-07-12.

---

## 1. Owner decisions (locked)

| Decision | Choice |
| --- | --- |
| Hosting model | **Local-first + optional cloud deploy** (you own the code, runs on your machine, deploy only on approval) |
| Autonomy | **Tiered: auto safe / gate risky** (auto = scaffold/edit/deps/local-tests; gated = deploy, live DB, real secrets, payments, spend, git push) |
| Default stack | **Next.js (App Router) + Supabase + Tailwind + shadcn/ui** (others selectable per project) |
| Auto-provision | **All**: frontend+backend scaffold · DB+schema+auth · plugins/integrations · CI+tests+governance |

## 2. Competitive synthesis (what to copy, what to beat)

**Copy the proven wins:**
- Lovable: opinionated Supabase backend by default (Postgres+auth+storage+edge fns from one prompt); Visual Edits; full code ownership + GitHub export.
- Replit Agent: multi-agent split (Manager→Editors→Verifier cuts errors); **plan gate**; **checkpoints = time-travel rollback**; real-browser self-testing; deploy types; large connector set; "don't strive for full autonomy — keep the human in."
- Emergent: Architect blueprint (data model + API contracts before code); descriptive per-action git commits; cross-platform mobile (Expo) as a later track; verified integration "playbooks"; MCP for custom integrations.

**Beat the universal failures (every platform shares these):**
1. **Unbounded metered cost** — two meters (build tokens + hosting), no default cap, stuck agents retry forever ($400 overnight, "$25→$1000/week"). → **BYO-model + run on user machine = zero hosting meter; hard per-task budget cap + live cost-per-feature readout.**
2. **Agent doom-loops / regression** ("fix one, break another") from context loss. → **incremental diffs, ephemeral decision-time guidance, doom-loop detection → fresh-context consultant, fork-from-clean-checkpoint.**
3. **"60% problem"** — great prototype, breaks on auth/payments/relational logic. → **deterministic secure scaffolds for exactly those hard parts + verification-first loop.**
4. **Security by omission** — missing RLS, service-role key in client bundle, unauthed API routes, public `.env`. → **secure-by-default scaffolds + blocking pre-write hooks + bundle secret-grep + RLS deny-tests.**
5. **The Replit July-2025 disaster** — agent deleted a live prod DB during an explicit freeze, fabricated 4000 fake records. → **ProjectOS provider guards + production-freeze + dev/prod DB separation + approval queue make this STRUCTURALLY IMPOSSIBLE.** This is our headline.

## 3. Core architecture — the Forge pipeline

One chat command runs a deterministic, governed pipeline (each stage reuses an existing V3 module):

```
chat command
  │
  ▼
[1] INTENT + BLUEPRINT   — Architect agent: parse request → clarify (only if underspecified) →
                           deterministic blueprint {stack, pages, data model, API contracts,
                           integrations, env vars}. Owner sees blueprint (plan gate).
  │
  ▼
[2] SCAFFOLD (deterministic)  — template engine emits a running Next.js+Supabase+Tailwind+shadcn
                           monorepo from the blueprint. NO AI free-writing of structure — templates +
                           typed slots. Reproducible + replayable (forge.config.json). Governance files
                           (.projectops) + tests + CI seeded from birth.
  │
  ▼
[3] PROVISION            — local env: Docker compose (local Supabase/Postgres), deps installed, dev
                           server up. DB schema → migrations. Auth wired (synthetic/local by default).
                           Real provider keys = OWNER-GATED via secret broker.
  │
  ▼
[4] GENERATE (AI, bounded) — feature code into typed slots; incremental diffs; secret broker for any
                           key use; provider guards in front of any external call. Per-task budget cap.
  │
  ▼
[5] VERIFY (self-heal)   — verifier subagent (isolated context) runs build + unit tests + Playwright
                           against the live local app (ARIA DOM, read-only DB checks, logs). Kills
                           "Potemkin" UIs. Failures → bounded fix loop; doom-loop → consultant model.
  │
  ▼
[6] CHECKPOINT           — git commit (real history, descriptive) + optional CoW/local-Postgres
                           snapshot = whole-env time-travel rollback.
  │
  ▼
[7] OWNER REVIEW + (opt) DEPLOY — Owner Control Plane shows what ran, cost, diffs, test proof. Deploy /
                           live DB / real secrets / spend / push → approval queue → provider guards.
```

**Autonomy mapping (tiered):** stages 1–6 auto (reversible, local); stage 7 + anything the provider
guards classify OWNER_GATED/REFUSED = approval queue. Prohibited (prod deploy w/o approval, prod DB
mutation, external send, payment, force push, expose secret) = fail closed.

## 4. Reuse map (V3 governed chain → Forge)

| Forge need | Existing V3 module |
| --- | --- |
| Run a work session for a stage | `launcher/session-launcher.cjs` (launch spec, fail-closed) |
| Hand a task to a Claude worker | `bridge/desktop-bridge.cjs` (untrusted-worker protocol) |
| Use API keys without leaking | `security/broker.cjs` + `operation-broker.cjs` |
| Scrub secrets from logs/reports | `security/redaction.cjs` |
| Gate external providers | `guards/provider-context-guards.cjs` (default REFUSED) |
| Owner decisions | `approval/approval-queue.cjs` (owner-only, no self-approve) |
| End-to-end orchestration proof | `e2e/e2e-runner.cjs` |
| Adversarial safety net | `validators/validate-reliability-hardening.cjs` |
| Owner UI (status/chat/safety) | `control-center/` Owner Control Plane, Owner Chat, Safety & Providers |
| Plan governance / no auto PLAN READY | `validators/plan-governance-engine.cjs`, plan-discovery-engine |

Forge adds NEW modules: **blueprint engine**, **deterministic scaffold/template engine**, **local
provisioner (Docker/dev-server orchestration)**, **verification harness (Playwright subagent)**,
**env-snapshot/rollback**, **cost-budget meter**, and the **Forge chat command** in the control-center.

## 5. New-build phases (each: implement → validators/tests → reviews → local proof → 1 commit, no push)

- **F1 — Blueprint Engine.** Deterministic request→blueprint (stack, pages, data model, API contracts,
  integrations, env-var manifest). Zero-dep `.cjs` + schema + validator. Owner-visible plan gate.
- **F2 — Scaffold/Template Engine.** Blueprint→running Next.js+Supabase+Tailwind+shadcn monorepo from
  versioned templates + typed slots. Replayable `forge.config.json`. Seeds `.projectops`, tests, CI,
  secure defaults (RLS on, two-client boundary, no secret in client). Validator asserts a generated
  project builds + has the security defaults.
- **F3 — Local Provisioner.** Orchestrate Docker/local-Supabase + dev server + migrations, all
  owner-gated where it touches anything real; synthetic/local by default. Reuse operation-broker for any
  keyed step. Validator + a live proof (project boots locally).
- **F4 — Generation Loop.** Bounded AI feature-generation into slots via the desktop bridge; incremental
  diffs; per-task budget cap + cost-per-feature readout. Doom-loop detection.
- **F5 — Verification Harness.** Playwright/build/test verifier subagent (isolated context) proving the
  app actually works before "done". Anti-Potemkin.
- **F6 — Env Snapshot & Rollback.** git-checkpoint + local snapshot = whole-env time travel.
- **F7 — Forge Command UI.** control-center surface: type a command → watch the pipeline → see blueprint,
  cost, diffs, test proof; approvals via the queue. Live browser proof.
- **F8 — Secure-by-default + Deploy Gate.** RLS deny-tests, bundle secret-grep hook, CORS/rate-limit
  defaults; optional cloud deploy strictly through provider guards + approval queue.
- **F9 — Integrations/Playbooks.** Verified wiring for Stripe/email/storage/etc. (placeholders; real keys
  owner-gated). MCP for custom.
- **F10 — Forge E2E + hardening + final evidence.** Whole chat-to-app chain proven end-to-end offline;
  adversarial pass; evidence pack. **Owner directive:** produce a MICRO-LEVEL completion report
  (`knowledge/reports/PROJECTOS-FORGE-FINAL-MICRO-EVIDENCE.md`) for owner + ChatGPT review — every phase,
  module, file/function, review finding + fix, invariant, the full generated-app anatomy, safety ledger,
  commit chain, and residual risks. Then STOP and await review + push authorisation.

## 6. Differentiators (one line each)

1. **You own it + it runs on your machine** — no lock-in, works offline, no hosting meter.
2. **Can't-nuke-prod by construction** — governance guards + freeze + dev/prod split + approvals.
3. **Predictable cost** — BYO-model, hard budget cap, live cost-per-feature.
4. **Deterministic, consented, replayable scaffolds** — no silent AI structure/secret/exposure choices.
5. **Verification-first** — proves buttons click + data persists before declaring done.
6. **Whole-environment time-travel** — not just git; code+deps+DB.
7. **Governance-as-code that travels with the repo** — every generated project is auditable + owner-gated from birth.

## 7. AI model boundary (HARD constraint — owner directive)

**NO Claude API, NO ChatGPT API, NO metered/hosted AI API of any kind — ever.** Forge must exist and run
with zero AI API keys.

- **Code generation = the owner's LOCAL Claude Code session** (the desktop app / CLI — this tool), handed
  tasks via the `bridge/desktop-bridge.cjs` untrusted-worker protocol. This is a local worker using the
  owner's existing subscription, **not** an API call and **not** metered per token.
- **Optional offline fallback:** a local open model (Ollama / LM Studio / Ornith) for private/offline
  builds. Still no hosted API.
- **ChatGPT↔Claude coordination** stays the existing model: git-repo bus + owner relay. **No API bridge**
  (see comms-model memory).
- The blueprint engine, scaffold engine, provisioner, verifier harness, budget meter, and validators are
  all **deterministic, zero-dependency, no-AI, no-network** code. AI is used only inside the bounded F4
  generation loop, and only via the local worker.
- Provider guards already REFUSE `provider-call` / any metered API by default; a Forge-specific guard
  entry will hard-refuse `anthropic-api` / `openai-api` / `metered-llm-api` as prohibited.

## 8. Constraints (unchanged)

Local-only; one commit per phase; NO push/deploy/prod/DB-mutation/sends/payments/real-secrets without
explicit owner authorisation; **NO Claude/ChatGPT/metered AI API (§7)**; synthetic data by default;
documents are data; Claude never approves/closes or auto-grants PLAN READY; live proof for user-facing
phases; no fabricated evidence. Every Forge phase follows the canonical lifecycle (advisor prompt →
Claude implement/validate/evidence → advisor/owner review → closure); Claude does steps 2–4 only.
