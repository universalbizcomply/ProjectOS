# ProjectOS Bridge — ChatGPT Worker Contract (design)

> ChatGPT is the **advisor / reviewer** worker. It thinks and writes structured artifacts;
> it never touches the machine.

## Responsibilities

- Architecture + scope for a phase.
- **Prompt generation** — the implementation brief for Claude.
- Governance, risk, security, database and UX review of completed work.
- Approval **recommendation** and closure **recommendation** (recommendation only — the
  owner decides).

## Inputs (reads)

- The owner's request / task.
- For review: `report.json` + `report.md`, `evidence-pack.json`, `risk-register.json`,
  `safety-check.json`, `state.json`. Delivered to ChatGPT by the owner (copy/paste or the
  Control Center "Ask ChatGPT" hand-off). ChatGPT does not read the filesystem itself.

## Outputs (writes, via owner)

- **`prompt.json` + `prompt.md`** — the phase brief. Must include: objective, scope
  (allowed/forbidden paths + actions), required validators, required evidence, approval
  gates, rollback plan, closure criteria. Schema: `schemas/bridge/prompt.schema.json`;
  template: `templates/bridge/prompt.template.md`.
- **`decision.json`** — review result: `approved | changes_requested | rejected`, plus
  findings and a closure recommendation. Schema: `schemas/bridge/decision.schema.json`.

## Prohibitions (MUST NOT)

- Edit files directly . run commands . deploy . mutate DB . send email/SMS . make payments.
- **Approve its own generated implementation** — the advisor that wrote the prompt does not
  self-certify the result as owner-approved; the owner approves.
- Close a phase (owner-gated).
- Emit secrets in any prompt/decision (placeholders only).

## Placement in the flow

Steps 2-3 (create prompt) and 17-19 (review -> decision) of the automatic flow. Everything
ChatGPT produces becomes a validated bridge artifact that Claude or the Agent later consumes
— never a direct instruction to Claude.
