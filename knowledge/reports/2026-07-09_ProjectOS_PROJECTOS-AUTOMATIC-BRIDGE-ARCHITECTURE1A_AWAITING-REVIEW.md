# PROJECTOS-AUTOMATIC-BRIDGE-ARCHITECTURE1A — Evidence Pack

> **Design phase only.** Architecture + schemas + templates + examples. No automation that
> controls Claude, no browser automation, no Claude API, no cloud execution, no real repo
> touched, no deploy, no DB mutation, no push. **Not committed** (awaiting owner/ChatGPT review).

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-AUTOMATIC-BRIDGE-ARCHITECTURE1A
3. **Status:** IMPLEMENTED LOCALLY / AWAITING REVIEW
4. **Branch:** projectos-v2-core
5. **Commit:** not committed (per spec — commit only after approval)
6. **Scope:** architecture/design only (docs + schemas + templates + a worked example).

## Files created (26, all new, none committed)

**Architecture docs (8)** — `docs/architecture/`:
`projectos-automatic-bridge-architecture.md`, `projectos-event-bus.md`,
`projectos-agent-watch-model.md`, `projectos-chatgpt-worker-contract.md`,
`projectos-claude-code-worker-contract.md`, `projectos-control-center-flow.md`,
`projectos-cloud-sync-model.md`, `projectos-safety-gates.md`.

**Schemas (8)** — `projectos/schemas/bridge/`:
`prompt`, `report`, `event`, `state`, `evidence-pack`, `approval`, `decision`,
`worker-status` (`.schema.json`).

**Templates (4)** — `projectos/templates/bridge/`:
`prompt.template.md`, `report.template.md`, `evidence-pack.template.md`,
`decision.template.md`.

**Example (6)** — `projectos/examples/bridge/sample-phase-flow/`:
`prompt.json`, `event-log.jsonl`, `report.json`, `evidence-pack.json`, `decision.json`,
`README.md`.

**This report (1)** — this file.

## Core design captured

- ChatGPT and Claude never connect directly. Model: `ChatGPT -> ProjectOS -> Claude Code ->
  ProjectOS -> ChatGPT`. ProjectOS is the shared state / event bus / task manager / evidence
  system. The bridge is a **file contract** under `.projectops/bridge/`, not a socket.
- Append-only event bus (`event-log.jsonl`) with all 23 required event types incl.
  `SAFETY_VIOLATION_DETECTED`; every artifact carries id/project/phase/status/created_at/
  created_by/worker/source/version/related_files/decision_required.
- Roles reuse the Core model: owner approves/closes; ChatGPT = advisor (never edits/runs/
  approves-own-work); Claude = implementer (never approves/closes/gated); Agent = local
  watcher (never writes business code, never bypasses approvals).
- Safety gates reuse the 8 Core gates; a gated action without a matching owner approval emits
  `SAFETY_VIOLATION_DETECTED` and blocks. Secret placeholders only.

## Forbidden actions checked

| Forbidden | Done? |
|-----------|-------|
| Automation that controls Claude | NO |
| Browser automation / scrape Claude UI | NO |
| Claude API | NO |
| Cloud execution | NO |
| Touch a real project repo | NO |
| Push | NO |
| Deploy | NO |
| DB mutation | NO |
| Email/SMS/payment | NO |
| Expose secrets | NO |
| Commit (before approval) | NO — nothing committed |

## Validators

- **git branch:** `projectos-v2-core`; **new files:** 26 (untracked).
- **JSON validity:** all 8 schemas + 4 example JSON parse OK; `event-log.jsonl` all 16 lines parse.
- **No-secrets scan:** clean (no token/key values in any new file).
- **Framework validators (`npm run validate`):** `validate-all: ALL PASS`.
- **Markdown sanity:** manual — headings/tables well-formed. (No dedicated MD linter wired — NOT AVAILABLE.)
- **JSON-Schema meta-validation tool:** NOT AVAILABLE in-repo (schemas hand-checked against draft-07 shape); files parse as valid JSON.

## Security review

No secrets read/written/committed. Docs + schemas + examples enforce placeholder-only rules
(`TOKEN_REDACTED`, `SECRET_REDACTED`, `URL_PLACEHOLDER`, `PROJECT_REF_ALLOWED_IF_PUBLIC`) and
the never-emit list (service_role, PATs, Vercel/Stripe/Resend keys, passwords, JWTs). The
safety-gates doc + `SAFETY_VIOLATION_DETECTED` event define the block-on-violation path.

## Code review (schema/example files)

Schemas: draft-07, `additionalProperties:false`, sensible required sets, enums for status/
event-type/gate/risk. Example: internally consistent — the event log's sequence matches the
prompt/report/evidence/decision artifacts; all safety confirmations `false`; owner (not AI)
makes the binding decision.

## Database review

N/A — no database touched. (The cloud-sync doc *designs* read-only mirror tables; none created.)

## Production touched / external sends / payments

NO / NO / NO.

## Risks

- The bridge is designed but not built; the human-in-the-loop review hand-off (steps 17-18)
  remains manual by design.
- JSON-Schema meta-validation + Markdown linting are not wired in-repo (documented NOT AVAILABLE).
- Real per-project `.projectops/bridge/` folders are not created (design only).

## Carry-forward (future, separately-approved phases)

- Build the Agent watch daemon (folder watch + event append + validators + git read-only).
- Wire Control Center screens/buttons -> events.
- Add JSON-Schema + Markdown validators to `npm run validate`.
- Implement the redacted cloud-sync projection.

## Decision needed

Owner + ChatGPT: review this architecture, the schemas and the worked example. Approve to
commit (`COMMIT_APPROVED`), then decide which build phase comes next. Nothing is committed or
pushed until approved.

## Final status
**PROJECTOS-AUTOMATIC-BRIDGE-ARCHITECTURE1A — IMPLEMENTED LOCALLY / AWAITING REVIEW.**
26 design files created; JSON valid; no secrets; framework validators ALL PASS; nothing
committed, pushed, deployed, or mutated. Awaiting owner/advisor review + approval to commit.
