# Sample Phase Flow — LOGIN1A (bridge example)

A worked, **inert** example of one phase moving through the ProjectOS Bridge. All values are
synthetic; there are no secrets. Nothing here runs — it illustrates the file contract.

## The scenario

Owner asks for a login screen on `acme-shop`. ChatGPT (advisor) writes the brief; Claude
Code (implementer) builds it; ChatGPT reviews; the owner approves + closes.

## The files (read in this order)

1. **`prompt.json`** — ChatGPT's brief for Claude. Objective, scope, allowed/forbidden
   paths + actions, validators, gates, rollback, closure criteria. Conforms to
   `schemas/bridge/prompt.schema.json`.
2. **`event-log.jsonl`** — the append-only history of the whole phase (16 events), from
   `PHASE_CREATED` to `PHASE_CLOSED`. Read top to bottom to see the flow.
3. **`report.json`** — Claude's report after implementing: files changed, validator results,
   safety confirmations, risks, carry-forward.
4. **`evidence-pack.json`** — packaged evidence (validators + confirmations + asset refs),
   redacted.
5. **`decision.json`** — the outcome: ChatGPT recommended `close`; the **owner** made the
   binding `approved` decision. Only the owner's decision unlocks commit + closure.

## What the flow demonstrates

- ChatGPT and Claude never talk directly. ChatGPT writes `prompt.json`; Claude reads it from
  `inbox/`; Claude writes `report.json` + `evidence-pack.json`; ChatGPT reviews those.
- The Agent (not shown as a file) drives the middle: it emitted `PROMPT_READY`,
  `FILES_CHANGED`, `VALIDATION_COMPLETED`, `REVIEW_READY` in the event log.
- Every gate is owner-gated: `OWNER_APPROVED` -> `COMMIT_APPROVED` -> `PHASE_CLOSED`. Neither
  AI closed the phase.
- No secrets anywhere; all confirmations are `false` for production/sends/payments/force-push.

## Mapping to the automatic flow

| Steps | Events here |
|-------|-------------|
| 2-3 (ChatGPT prompt) | `PROMPT_GENERATED`, `PROMPT_READY` |
| 7-9 (Claude implements) | `PROMPT_READ`, `IMPLEMENTATION_STARTED`, `FILES_CHANGED` |
| 11-14 (validate + report) | `VALIDATION_*`, `REPORT_CREATED`, `EVIDENCE_CREATED` |
| 15-19 (review) | `REVIEW_READY`, `CHATGPT_REVIEW_*` |
| 20-22 (approve + close) | `OWNER_APPROVED`, `COMMIT_APPROVED`, `PHASE_CLOSED` |

In a live project these files would live under `.projectops/bridge/` (prompts/, inbox/,
reports/, evidence/, approvals/, events/). This folder is a static illustration only.
