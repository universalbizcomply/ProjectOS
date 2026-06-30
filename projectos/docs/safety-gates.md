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