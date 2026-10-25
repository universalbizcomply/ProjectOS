# ProjectOS Bridge — Safety Gates (design)

> The bridge inherits the Core's eight canonical gates and adds the enforcement path:
> any attempt at a gated action without an existing owner approval emits
> `SAFETY_VIOLATION_DETECTED` and blocks execution.

## 1. Always-gated actions

- production deploy
- production database mutation
- real email
- real SMS / WhatsApp
- payment / live charge
- refund
- force push
- production cutover
- secret handling
- phase closure

Each maps to a Core gate (`schemas/safety-gates.schema.json`): productionDeployGate,
productionDbMutationGate, realMessagingGate, paymentGate, secretsHandlingGate,
forcePushProhibition, externalServiceGate, closureAuthorityGate. `forcePushProhibition` is
`prohibited` (needs an explicit override even for the owner); the rest are `gated`.

## 2. Enforcement path

```
worker/agent about to perform action X
  -> classifyAction(X)                 (Core risk engine)
  -> if gated/prohibited:
       does an approval exist? (decision.json approved, matching gate, OR *_APPROVED event)
         yes -> proceed, log the action + the approving decision id
         no  -> append SAFETY_VIOLATION_DETECTED{gate, action}  -> BLOCK, do not execute
```

A `SAFETY_VIOLATION_DETECTED` event carries the gate key and the attempted action, sets the
phase to `PHASE_BLOCKED`, and surfaces on the Control Center Risks/Approvals screens. It is
never auto-cleared; the owner resolves it.

## 3. Who can clear a gate

Only the **owner** (via `OWNER_APPROVED` / `COMMIT_APPROVED` / `PUSH_APPROVED` /
closure decision). Neither ChatGPT nor Claude nor the Agent can approve a gate. ChatGPT may
*recommend*; the owner *decides*. This reuses the Core `approval` engine (gated => owner-
only; prohibited => explicit override).

## 4. Secret rules (never emitted)

Never write to prompts, reports, logs, dashboard or evidence: `service_role` keys, Supabase
access tokens, GitHub PATs, Vercel tokens, Stripe secret keys, Resend API keys, customer
passwords, staff JWTs, raw temporary credentials. Use placeholders only: `TOKEN_REDACTED`,
`SECRET_REDACTED`, `URL_PLACEHOLDER`, `PROJECT_REF_ALLOWED_IF_PUBLIC`. The Agent's artifact
scan flags any match of these patterns and raises `SAFETY_VIOLATION_DETECTED` before the
artifact is promoted or synced.

## 5. Relationship to what exists

The Core already encodes these gates and owner-only approval, and the CLI already refuses
non-owner closure/gated actions (exit 2). The bridge layer adds the *detection at the file
boundary* (scan prompts/reports/diffs) and the `SAFETY_VIOLATION_DETECTED` event so
violations are recorded and blocked automatically, not just refused on request.
