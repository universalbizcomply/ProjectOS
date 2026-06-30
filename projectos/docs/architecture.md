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