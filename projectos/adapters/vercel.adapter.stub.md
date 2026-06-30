# Vercel Adapter — STUB (inert)

**Status:** placeholder only. No code. No API calls. No credentials.

## Intended future interface (later approved phase only)
- `getDeploymentStatus(project)` — read-only.
- `listDeployments(project)` — read-only.

## Hard rules (will apply when built)
- **No deploy** action in any adapter. Deploy stays owner-gated (`productionDeployGate`).
- No Vercel token in code or reports.
- Subject to `externalServiceGate`.