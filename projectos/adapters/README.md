# ProjectOS Adapters (INERT — UNIVERSAL1A)

Adapters are **placeholders only** in PROJECTOPS-UNIVERSAL1A.

- No API calls exist yet.
- No credentials are required or used.
- These stubs document the intended interface only.

External adapters (GitHub, Vercel, Supabase, and any others) will be built in **later, separately
approved phases**. Until then, nothing here connects to any external service.

| Stub | Future purpose | Status |
|------|----------------|--------|
| `github.adapter.stub.md` | Read-only repo metadata / PR helpers | inert stub |
| `vercel.adapter.stub.md` | Deployment status reads (no deploy) | inert stub |
| `supabase.adapter.stub.md` | Migration/advisor reads (no mutation) | inert stub |

All future adapters must respect the safety gates in `projectos/schemas/safety-gates.schema.json`.