# ProjectOS Bridge — Event Bus (design)

> Append-only event model for the bridge. No overwrites, no deletes. The event log is the
> single ordered history of what happened in a phase.

## 1. Storage

One append-only file per project: `.projectops/bridge/events/event-log.jsonl`
(JSON Lines — one event object per line). Optionally rotated per-phase into
`events/<phase-id>.jsonl` and merged for the project view. Closed-phase logs move to
`archive/` unchanged.

- **Append-only.** Writers only append a line; they never rewrite or truncate.
- **Ordered.** Line order = arrival order. Each event also carries a monotonic `seq` and an
  ISO `at` timestamp so consumers can re-order/dedupe.
- **Idempotent consumers.** Each event has a unique `id`; the Agent/Control Center track the
  last-seen `seq` and ignore replays.
- **Advisory lock.** A single writer at a time via `locks/events.lock` (the Agent owns
  appends triggered by watches; workers request an append through the Agent or write to
  their own `outbox/` which the Agent drains).

## 2. Event shape

See `projectos/schemas/bridge/event.schema.json`. Minimum fields:

```json
{
  "id": "evt_01J...",
  "seq": 42,
  "type": "REVIEW_READY",
  "project": "acme-shop",
  "phase": "LOGIN1A",
  "at": "2026-07-09T12:00:00.000Z",
  "actor": "agent",
  "worker": "claude-code",
  "source": "agent-watch",
  "payload": { "report": "reports/LOGIN1A.report.json" },
  "related_files": ["reports/LOGIN1A.report.json"],
  "decision_required": false
}
```

`actor` is one of `owner|advisor|implementer|agent|core`. `worker` names the concrete
provider (e.g. `chatgpt`, `claude-code`) when relevant.

## 3. Event types

Lifecycle (in rough order):

`TASK_CREATED` . `PHASE_CREATED` . `PROMPT_GENERATED` . `PROMPT_READY` . `PROMPT_READ` .
`IMPLEMENTATION_STARTED` . `FILES_CHANGED` . `VALIDATION_STARTED` . `VALIDATION_COMPLETED` .
`EVIDENCE_CREATED` . `REPORT_CREATED` . `REVIEW_READY` . `CHATGPT_REVIEW_STARTED` .
`CHATGPT_REVIEW_COMPLETED` . `OWNER_APPROVED` . `OWNER_REJECTED` . `CHANGES_REQUESTED` .
`COMMIT_APPROVED` . `PUSH_APPROVED` . `PHASE_CLOSED` . `PHASE_BLOCKED`

Safety (out-of-band, highest priority):

`SAFETY_VIOLATION_DETECTED` — emitted whenever a gated action is attempted without a
matching approval. Carries the gate key + attempted action. Blocks execution (see
`projectos-safety-gates.md`).

## 4. Who emits what

| Emitter | Emits |
|---------|-------|
| Owner/Control Center | `TASK_CREATED`, `OWNER_APPROVED`, `OWNER_REJECTED`, `COMMIT_APPROVED`, `PUSH_APPROVED` |
| ChatGPT (via owner) | `PROMPT_GENERATED`, `CHATGPT_REVIEW_STARTED`, `CHATGPT_REVIEW_COMPLETED`, `CHANGES_REQUESTED` |
| Claude Code | `PROMPT_READ`, `IMPLEMENTATION_STARTED`, `REPORT_CREATED`, `EVIDENCE_CREATED`, `PHASE_BLOCKED` (declare) |
| Agent | `PHASE_CREATED`, `PROMPT_READY`, `FILES_CHANGED`, `VALIDATION_STARTED`, `VALIDATION_COMPLETED`, `REVIEW_READY`, `SAFETY_VIOLATION_DETECTED` |
| Core | `PHASE_CLOSED` (only after owner decision) |

## 5. Relationship to Core

The Core already has an in-memory event model (`projectos/core/src/events.ts`:
`DomainEvent`, append-only log, `EventBus`). The bridge event log is the **persisted**
counterpart: the Agent maps core `DomainEvent`s to JSONL lines and back. Types here are a
superset (they add bridge/review/safety events) but reuse the same `{id, type, at, actor,
payload}` core shape, extended with `seq`, `project`, `phase`, `worker`, `source`,
`related_files`, `decision_required`.

## 6. Consumers

- **Agent** — reacts to events to drive the flow (watch model doc).
- **Control Center** — renders the Event Log screen + derives "review pending", blockers.
- **Cloud sync** — pushes a *redacted* projection of events (type/phase/status/time only) to
  the dashboard (cloud-sync doc). Never syncs payloads that could contain secrets.
