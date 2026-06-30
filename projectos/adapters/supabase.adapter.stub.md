# Supabase Adapter — STUB (inert)

**Status:** placeholder only. No code. No API calls. No credentials.

## Intended future interface (later approved phase only)
- `listMigrations(ref)` — read-only.
- `getAdvisors(ref)` — read-only.

## Hard rules (will apply when built)
- **No database mutation**, no `apply_migration`, no service-role usage without an
  explicitly approved phase (`productionDbMutationGate`).
- No service_role key / access token in code or reports.
- Subject to `externalServiceGate`.