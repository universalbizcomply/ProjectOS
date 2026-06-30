# ProjectOS Safety Gates

Defined canonically in `projectos/schemas/safety-gates.schema.json`.

| Gate | Status | Requires owner approval |
|------|--------|-------------------------|
| Production deploy | gated | yes |
| Production DB mutation | gated | yes |
| Real email / SMS / WhatsApp | gated | yes |
| Payment / live charge / refund | gated | yes |
| Secrets handling | gated | yes |
| Force push | prohibited | n/a (do not perform) |
| External service / API call | gated | yes |
| Closure authority | gated | yes (Murad/ChatGPT only) |

## Enforcement in this phase
- Validators scan framework files for secret-shaped values and fail loudly.
- Templates/configs must declare the forbidden actions explicitly.
- Adapters are inert; no code path can reach an external service yet.
- No secrets are stored; placeholders only (`TOKEN_REDACTED`, `URL_PLACEHOLDER`, `PROJECT_REF_PLACEHOLDER`).
## ECC review layer and the gates

ECC/named reviewers operate **local-read-only by default**. External tools and MCP/live tools are **disabled by default** and require explicit owner approval in a later phase (subject to the External service / API gate). ECC can never trigger a gated action and can never close a phase. Review findings are evidence that informs — but does not replace — the owner gate decision. See [ecc-review-wiring.md](ecc-review-wiring.md).

## Staging deploy guard

The staging deploy guard (projectos/scripts/*deploy*.cjs) prepares and validates staging-deploy plans without ever deploying. Production targets are refused by default; approval is never inferred; no hosting CLI or external API is called. Deploy execution stays a separate, owner-approved action. See [staging-deploy-guard.md](staging-deploy-guard.md).

## Proof factory

The proof factory (projectos/scripts/*proof*.cjs, create-cleanup-plan.cjs) prepares and validates proof plans, evidence skeletons and cleanup plans without ever running a proof, seeding data, mutating/cleaning a database, or calling external services. Production is refused by default; approval is never inferred. See [proof-factory.md](proof-factory.md).
