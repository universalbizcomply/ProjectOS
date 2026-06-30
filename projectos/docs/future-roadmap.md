# ProjectOS Future Roadmap

PROJECTOPS-UNIVERSAL1A delivers the universal framework skeleton. Later phases (each separately
approved, none started here):

1. **PROJECTOPS-POLYGO-INSTALL1A** — first per-project `.projectops` install (PolyGo).
2. **PROJECTOPS-PHASE-REPORTER1A** — automated evidence/report generation from phase manifests.
3. **PROJECTOPS-STAGING-DEPLOY-GUARD1A** — guardrails around staging deploys (still owner-gated).
4. **PROJECTOPS-PROOF-FACTORY1A** — reusable proof/evidence harness (e.g. no-send proofs).
5. **PROJECTOPS-STAGING-DRIFT-DETECTOR1A** — detect schema/config drift on staging.
6. **PROJECTOPS-CI-GOVERNANCE1A** — CI governance gates (GitHub Actions introduced here, not before).
7. **PROJECTOPS-MULTI-PROJECT-DASHBOARD1A** — cross-project status dashboard.

## Not included yet
- External adapters with real API calls.
- GitHub Actions / CI.
- Deploy wrappers, DB tooling, send/payment tooling.
- Any production, security-risk, payment, real-send or closure automation (owner-gated).
## Review wiring (delivered in PROJECTOPS-ECC-REVIEW-WIRING1A)

Controlled ECC review wiring is now part of the universal framework: project-config declares review agents; phase manifests declare required reviews; the evidence pack captures review output. External tools, MCP and autonomous behaviour remain disabled by default — enabling any of them is a separate, owner-approved future phase. See [ecc-review-wiring.md](ecc-review-wiring.md).

## Phase reporter (delivered in PROJECTOPS-PHASE-REPORTER1A)

A reusable local-only phase reporter now generates/validates evidence packs, pre-push review packs and closure skeletons, and manages the Reports Index. It approves/closes nothing and calls no external service. See [phase-reporter.md](phase-reporter.md).

## Staging deploy guard (delivered in PROJECTOPS-STAGING-DEPLOY-GUARD1A)

A local-only staging deploy guard now prepares/validates/evidences staging deploy plans and result skeletons. It never deploys, refuses production by default, and calls no external service. Real deploy execution and production handling remain separate owner-approved phases. See [staging-deploy-guard.md](staging-deploy-guard.md).

## Proof factory (delivered in PROJECTOPS-PROOF-FACTORY1A)

A local-only proof factory now prepares/validates/evidences proof plans, evidence skeletons and cleanup plans. It never runs proof or cleanup, refuses production by default, and calls no external service. Real proof execution remains a separate owner-approved phase. See [proof-factory.md](proof-factory.md).
