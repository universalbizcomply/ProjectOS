# Phase Prompt — <PHASE_ID>

> Written by ChatGPT (advisor) for Claude Code (implementer). Placeholders only — no secrets.
> Pairs with `prompt.json` (schema: schemas/bridge/prompt.schema.json).

- **Project:** <PROJECT_ID>
- **Phase:** <PHASE_ID>
- **Created by:** advisor (chatgpt)
- **Status:** ready

## Objective
<one-paragraph objective>

## Scope
Allowed paths:
- <allowed/path/one>
Forbidden paths:
- <forbidden/path/one>

Allowed actions:
- <e.g. create-local-files, run-local-validation>
Forbidden actions:
- production deploy / production DB mutation
- real email/SMS/WhatsApp / payment
- using secrets, force pushing, closing this phase

## Required validators
- <validator-1>

## Required evidence
- report.json + report.md
- evidence-pack.json

## Approval gates
- <e.g. phase-closure, production-deploy>

## Rollback plan
<how to undo this phase>

## Closure criteria
- [ ] <criterion 1>

## Notes for the implementer
Do not proceed past any gate. Declare risks/blockers rather than guessing. Stop at
`awaiting_review`; the owner closes.
