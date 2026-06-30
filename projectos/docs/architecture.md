# ProjectOS Architecture

ProjectOS separates a **universal framework** from **project-specific configuration**.

## Universal framework (this repo)
- `schemas/` — the shapes (project config, phase manifest, evidence pack, safety gates).
- `templates/` — placeholder-only starting points.
- `validators/` — local, dependency-free checks (Node built-ins only).
- `scripts/` — local helpers (summary, file listing, report skeleton).
- `adapters/` — inert stubs; external integrations come in later approved phases.
- `examples/` — inert demos.
- `docs/` — this documentation.

## Project-specific configuration (future, per project)
A future install phase places a `.projectops` folder inside a product repo holding that project's
`project-config.json`, `phases/`, `reports/`. The universal framework stays the source of truth for
schemas/templates/validators.

## Principles
- **Universal process, project-specific config.**
- **Local-first:** everything runs locally with no external calls in this phase.
- **Evidence over assertion:** phases end with an evidence pack, not a claim.
- **Owner-gated risk:** production, DB, real sends, payment and closure stay with the owner.
## Staging deploy guard

The deploy guard adds schemas (request/guard/result), templates, local scripts and validators for preparing safe staging deploys. It is plan/evidence only — no execution, no external calls. See [staging-deploy-guard.md](staging-deploy-guard.md).

## Proof factory

The proof factory adds schemas (request/plan/evidence/cleanup/policy), templates, local scripts and validators for preparing safe controlled proofs. It is plan/evidence only — no proof, no cleanup, no external calls. See [proof-factory.md](proof-factory.md).

## Staging drift detector

The drift detector adds schemas (snapshot/request/finding/report/policy), templates, local scripts and validators for static expected-vs-observed comparison. It is compare/evidence only — no live connection, no repair, no external calls. See [staging-drift-detector.md](staging-drift-detector.md).

## CI governance

CI governance adds schemas (policy/workflow-template/check-result/report), an inert GitHub Actions template (under projectos/templates, never .github/workflows), local scripts and validators. Template/evidence only — no live CI, no deploy, no external calls. See [ci-governance.md](ci-governance.md).

## Multi-project dashboard

The dashboard adds schemas (config/project/phase/data/report), templates (incl. an inline-only static HTML), local scripts and validators that read ProjectOS knowledge/report files and emit dashboard JSON + static HTML. Local static, evidence only, no external calls. See [multi-project-dashboard.md](multi-project-dashboard.md).
