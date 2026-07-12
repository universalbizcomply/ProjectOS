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

## Phase status

| Phase | ID | Status |
| --- | --- | --- |
| F1 | PROJECTOS-FORGE-BLUEPRINT1A | LOCAL IMPLEMENTATION COMPLETE (awaiting advisor/owner review) |
| F2 | PROJECTOS-FORGE-SCAFFOLD1A | **NEXT — not started** |
| F3 | PROJECTOS-FORGE-PROVISIONER1A | pending |
| F4 | PROJECTOS-FORGE-GENERATION1A | pending |
| F5 | PROJECTOS-FORGE-VERIFY1A | pending |
| F6 | PROJECTOS-FORGE-SNAPSHOT1A | pending |
| F7 | PROJECTOS-FORGE-COMMAND-UI1A | pending (user-facing → live proof) |
| F8 | PROJECTOS-FORGE-SECURE-DEPLOY1A | pending |
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

## Next exact safe action (resume here)

**Begin F2 — `PROJECTOS-FORGE-SCAFFOLD1A`.** Turn a blueprint into a running Next.js+Supabase+Tailwind+
shadcn monorepo from **versioned templates + typed slots** (no AI free-writing of structure): seed
`.projectops` governance files, tests, CI, and secure defaults (RLS on, two-client server boundary, no
secret in client bundle). Emit a replayable `forge.config.json`. Add a validator asserting a generated
project has the required files + security defaults + governance, and that generation is deterministic
(same blueprint → same tree). Zero-dep `.cjs`; templates are static files/strings; NO AI, NO network.
Reviews → validators → report → index row → one commit `feat(projectos): add forge scaffold engine (F2)`
(no push) → continue F3.

**Command to run next:** `cd C:/dev/ProjectOS && git status && npm run validate`
