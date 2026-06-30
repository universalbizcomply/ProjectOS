# ProjectOS Per-Project Installation Model

> Not performed in PROJECTOPS-UNIVERSAL1A. Documented here for later approved phases.

## Goal
Install a `.projectops` folder inside a product repo, carrying that project's configuration and
evidence, while the universal framework remains the source of truth.

## Planned `.projectops` layout
```
<product-repo>/.projectops/
  project-config.json     # from project-config.template.json
  phases/                 # phase manifests
  reports/                # evidence + closure reports
  validators/             # wiring to universal validators (no duplication of logic)
```

## Rules
- Created only by an explicitly-approved install phase (e.g. `PROJECTOPS-POLYGO-INSTALL1A`).
- No secrets committed; placeholders only.
- Production / DB / real-send / payment / closure remain owner-gated.
- The universal repo is never replaced by per-project copies of schemas/validators.

## First planned install
- `PROJECTOPS-POLYGO-INSTALL1A` (PolyGo) — separate phase, separate approval.