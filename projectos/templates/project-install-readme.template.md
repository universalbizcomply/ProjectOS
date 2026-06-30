# .projectops — <PROJECT_NAME>

> Per-project ProjectOS installation. Created only in a separately-approved install phase
> (e.g. PROJECTOPS-<PROJECT>-INSTALL1A). This template is a placeholder — it is NOT installed
> into any product repo during PROJECTOPS-UNIVERSAL1A.

## Contents (once installed)
- `project-config.json`     — this project's config (from the universal template)
- `phases/`                 — phase manifests for this project
- `reports/`                — evidence + closure reports for this project
- `validators/`             — project-specific validator wiring (reuses universal validators)

## Rules
- The universal ProjectOS framework remains the source of truth for schemas/templates/validators.
- This folder holds project-specific configuration and evidence only.
- Production / DB / real-send / payment / closure remain owner-gated.
- No secrets in this folder. Use placeholders: TOKEN_REDACTED, URL_PLACEHOLDER, PROJECT_REF_PLACEHOLDER.

## Install status
installStatus: not-installed