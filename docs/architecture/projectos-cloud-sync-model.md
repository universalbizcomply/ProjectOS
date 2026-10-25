# ProjectOS Bridge — Cloud Sync Model (design)

> The cloud dashboard is **remote visibility only**. It never executes local code. The Agent
> pushes a **redacted projection** of bridge state up; nothing sensitive leaves the machine.

## 1. Direction of flow

```
Local Agent  --(redacted projection, push only)-->  Cloud (Supabase)  -->  Dashboard (read-only)
```

One-way for state: local is the source of truth; the cloud mirrors a safe summary. The
dashboard may *request* actions (e.g. an owner clicks "approve") which are written back as an
`approval-request`/`decision` that the local Agent picks up — but the cloud never runs a
local command directly.

## 2. What syncs (safe projection)

Per project/phase, only:

- project id/name, repo slug (public), install status, production-freeze
- phase id, objective, status, open/closed
- worker status (which worker, state)
- event **types + timestamps** (not raw payloads)
- report/evidence **summaries** (titles, pass/fail, counts) — not full bodies
- approval queue (what needs a decision), risk register summary
- current blockers, latest commit sha (public), deploy status if safely available

## 3. What NEVER syncs

- File contents that could contain secrets (raw reports/evidence bodies stay local unless
  explicitly redacted).
- Any secret: `service_role` keys, Supabase access tokens, GitHub PATs, Vercel tokens,
  Stripe secret keys, Resend keys, customer passwords, staff JWTs, raw temp credentials.
- Local absolute paths beyond the repo slug; machine identifiers.

Placeholders only where a value must appear: `TOKEN_REDACTED`, `SECRET_REDACTED`,
`URL_PLACEHOLDER`, `PROJECT_REF_ALLOWED_IF_PUBLIC`.

## 4. Tables (design)

Reuse the shipped cloud schema (`projects`, `phases`) and add read-only mirrors:
`bridge_events` (type, phase, at), `bridge_approvals` (phase, state, decision_required),
`bridge_risks` (phase, severity, summary). RLS: read for authenticated owner; writes only
from the Agent's authenticated session (or a scoped service path), never from anon.

## 5. Failure + offline

Sync is best-effort. If the cloud is unreachable, the local bridge keeps working (it is the
source of truth); the Agent retries the projection later. No local action ever *waits* on the
cloud.

## 6. Relationship to what exists

The shipped cloud dashboard already mirrors `projects`/`phases` from Supabase with
authenticated-only read and a login gate. The bridge sync extends that mirror with the
event/approval/risk summaries above, keeping the same "public keys only, no secrets, read-
only visibility" posture. Design only in this phase.
