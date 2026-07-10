# Decision — <PHASE_ID>

> ChatGPT writes a **recommendation**; the owner writes the **binding** decision.
> Pairs with `decision.json` (schema: schemas/bridge/decision.schema.json).

- **Project:** <PROJECT_ID>
- **Phase:** <PHASE_ID>
- **Decided by:** advisor (recommendation) | owner (binding)
- **Status:** recommended | final

## Decision
approved | changes_requested | rejected

## Closure recommendation
close | keep-open | block | not-applicable

## Findings
- <finding 1>

## Note
<short note; no secrets>

> Reminder: only the owner's `decidedBy: owner` decision unlocks a gate or closes a phase.
> A prohibited action (e.g. force push) also needs `override: true` from the owner.
