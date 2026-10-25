# ProjectOS Bridge — Control Center Flow (design)

> The Control Center is local mission control (desktop + cloud). It **orchestrates** the
> bridge; it never edits product code. It surfaces state and drives the owner's actions.

## Screens

Projects . Current Phase . Worker Status . Claude Code Status . VS Code Status . Git Status .
Validator Status . Evidence . Reports . Approvals . Risks . Event Log . Knowledge . Settings.

Each screen is a read/derive over the bridge artifacts:

| Screen | Source |
|--------|--------|
| Current Phase | `state.json` + latest events |
| Worker Status | `worker-status.json` |
| Git / Validator Status | Agent-produced fields in `state.json` |
| Evidence / Reports | `evidence/`, `reports/` |
| Approvals | `approvals/*.json` (queue of `decision_required`) |
| Risks | `risk-register.json` |
| Event Log | `events/event-log.jsonl` |

## Buttons -> events (never direct execution of product code)

| Button | Emits / does |
|--------|--------------|
| Generate Prompt | opens the prompt template; on save -> `prompt.json` + `PROMPT_GENERATED` |
| Open VS Code | launches VS Code at the repo (opener) |
| Run Validators | asks the Agent to run local validators -> `VALIDATION_*` |
| Build Evidence Pack | asks the Agent to package `evidence-pack.json` -> `EVIDENCE_CREATED` |
| Review Report | opens `report.md` for the owner |
| Request ChatGPT Review | hands the report/evidence to ChatGPT (browser hand-off) -> `CHATGPT_REVIEW_STARTED` |
| Approve Commit | `COMMIT_APPROVED` (owner) — unlocks the commit step |
| Reject | `OWNER_REJECTED` / `CHANGES_REQUESTED` |
| Sync Dashboard | pushes the redacted projection to the cloud |

## Review flow (owner's happy path)

1. New prompt arrives -> **Current Phase** shows "PROMPT_READY".
2. Owner clicks **Open VS Code**; Claude implements; **Git/Validator Status** update live.
3. On `REVIEW_READY`, **Approvals** shows the phase as review-pending.
4. Owner clicks **Request ChatGPT Review** -> reads ChatGPT's `decision.json`.
5. Owner clicks **Approve Commit** (or **Reject**). Only then does commit/push unlock.
6. Closure is a separate explicit owner action (still owner-gated).

## Relationship to the shipped Control Center

The current interactive Control Center already renders Projects/Workflow/Gates/Integrations
and can create + run phases (Supabase-backed) with owner-gated closure, plus the "Ask
ChatGPT" browser hand-off. The bridge extends it with the Worker/Event-Log/Approvals screens
and the button->event wiring above. Design only in this phase.
