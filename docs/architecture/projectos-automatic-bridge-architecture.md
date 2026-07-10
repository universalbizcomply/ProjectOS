# ProjectOS Automatic Bridge — Architecture (PROJECTOS-AUTOMATIC-BRIDGE-ARCHITECTURE1A)

> **Design phase only.** No automation that controls Claude, no browser automation, no
> Claude API, no cloud execution, no production actions. This document defines the target
> architecture; nothing here is wired to a live model.

## 1. Purpose

Let ChatGPT and Claude Code collaborate **without talking to each other directly**.
ProjectOS is the communication layer, shared state, event bus, task manager and evidence
system. Neither AI depends on the other; both depend on ProjectOS.

```
Wrong:   ChatGPT -> Claude -> ChatGPT -> Claude
Right:   ChatGPT -> ProjectOS -> Claude Code -> ProjectOS -> ChatGPT
```

ChatGPT **writes** structured instructions into ProjectOS. Claude Code **reads** them,
implements, and **writes back** structured reports + evidence. ChatGPT **reviews** those.
The owner (Murad) approves and closes. All exchange is files + events on disk (per project,
under `.projectops/bridge/`), never a direct socket between models.

## 2. Layered view

```
Owner (Murad)
  -> Control Center (desktop + cloud dashboard)
    -> ProjectOS Core (state . event bus . approval . risk . workers)
      -> Bridge Layer (inbox/outbox file contract + event log)
        -> Workers:  ChatGPT (reviewer/advisor)   Claude Code (implementer)   [future: Gemini/Codex]
          -> Local Agent (watch . validate . git . evidence . alert)
            -> VS Code . Claude Code . Local CLI
              -> Local repo -> GitHub -> Cloud Dashboard (read-only)
```

The **Bridge Layer** is new. It sits on top of the existing Core (already built:
`projectos/core/` — state machine, roles, gates, workers, orchestration) and reuses it:
the bridge does not re-implement governance, it *transports* governed artifacts.

## 3. The bridge is a file contract, not a connection

Per governed project, `.projectops/bridge/` holds append-only + request/response folders:

| Folder | Written by | Read by | Contents |
|--------|-----------|---------|----------|
| `prompts/` | ChatGPT (via owner) | Claude, Agent | `prompt.json` + `prompt.md` — the phase brief |
| `inbox/` | Agent | Claude | prompts promoted to "ready" for the implementer |
| `outbox/` | Claude | Agent, ChatGPT | drafts of reports/evidence awaiting agent packaging |
| `reports/` | Claude | ChatGPT (via owner), Agent | `report.json` + `report.md` |
| `evidence/` | Claude/Agent | ChatGPT, owner | `evidence-pack.json` + assets refs |
| `approvals/` | ChatGPT/owner | Agent, Core | `approval-request.json`, `decision.json` |
| `events/` | everyone (append) | everyone | `event-log.jsonl` — append-only truth |
| `state/` | Agent/Core | everyone | `state.json` — current phase/worker snapshot |
| `locks/` | Agent | Agent | advisory locks to prevent concurrent writers |
| `archive/` | Agent | — | closed-phase artifacts, moved out of the hot path |

Rationale: files are durable, auditable, git-syncable across machines, and inspectable by a
human. No AI needs the other online. The **event log** is the source of truth for "what
happened"; the JSON documents are the source of truth for "current content".

## 4. Roles (reuse Core role model)

- **Owner (Murad)** — approves, closes, decides gated actions. The only human bridge for
  review hand-off today (copy report -> ChatGPT, copy decision back). See §6.
- **ChatGPT — advisor/reviewer worker.** Produces `prompt.json`; reviews reports/evidence;
  recommends closure. Never edits files, runs commands, deploys, mutates DB, or approves its
  own generated implementation.
- **Claude Code — implementer worker.** Reads prompts; implements scoped changes; runs
  validators; writes reports/evidence; declares risks; stops at gates. Never approves own
  work, closes phases, or performs gated actions.
- **ProjectOS Agent** — local automation: watches bridge folders, detects new prompts/
  reports, runs validators, inspects git, classifies risk, packages evidence, appends
  events, updates worker/state, alerts Control Center, blocks forbidden actions. Never
  writes business code or makes owner decisions.

## 5. The automatic flow (target)

Numbered exactly as the spec; each step emits an event (see event-bus doc):

1. Owner requests work.
2. ChatGPT creates the phase specification.
3. ProjectOS stores `prompt.json` (+ `prompt.md`).
4. Agent detects the new prompt.
5. Agent appends `PROMPT_READY`.
6. Agent alerts / opens VS Code.
7. Claude Code reads `prompt.json`.
8. Claude sets state `IMPLEMENTING` (`IMPLEMENTATION_STARTED`).
9. Claude edits files locally.
10. Agent watches `git diff`/`status` (`FILES_CHANGED`).
11. Claude runs validators (`VALIDATION_STARTED`).
12. Agent verifies validator output (`VALIDATION_COMPLETED`).
13. Claude writes `report.json` (`REPORT_CREATED`).
14. Claude writes `evidence-pack.json` (`EVIDENCE_CREATED`).
15. Agent appends `REVIEW_READY`.
16. Control Center shows "review pending".
17. Owner shares report/evidence with ChatGPT.
18. ChatGPT reviews and returns a decision.
19. Decision saved as `decision.json` (`CHATGPT_REVIEW_COMPLETED`).
20. Agent updates phase status.
21. Only after approval may commit/push proceed (`COMMIT_APPROVED` / `PUSH_APPROVED`).
22. Closure requires owner/ChatGPT approval (`PHASE_CLOSED`).

The loop never lets one AI trigger the other's *action* — only produce the *artifact* the
other later consumes. The owner (and, later, an approved automation) is the only thing that
moves an artifact from "produced" to "acted on" across a gate.

## 6. Human-in-the-loop today, automatable later

Today step 17-18 is manual: the owner copies the report to ChatGPT (or uses the browser
"Ask ChatGPT" hand-off already shipped in the Control Center) and pastes the decision back.
That is deliberate — this phase designs the contract; it does **not** build automation that
controls Claude or scrapes any model UI. A future, separately-approved phase could add a
sanctioned connector, but the file contract stays identical, so nothing downstream changes.

## 7. What this reuses vs adds

- **Reuses:** `projectos/core/` (phase state machine, roles, risk/gates, workers,
  orchestration), the CLI (`projectos/agent`), the Control Center, the cloud dashboard.
- **Adds (design only here):** the `bridge/` file contract, the append-only event bus, the
  Agent watch-model, worker contracts, and the schemas/templates/examples that make the
  contract concrete.

## 8. Companion documents

- `projectos-event-bus.md` — event types + append-only log format.
- `projectos-agent-watch-model.md` — how the Agent watches + reacts.
- `projectos-chatgpt-worker-contract.md` — ChatGPT's inputs/outputs/prohibitions.
- `projectos-claude-code-worker-contract.md` — Claude's inputs/outputs/prohibitions.
- `projectos-control-center-flow.md` — screens, buttons, review flow.
- `projectos-cloud-sync-model.md` — safe metadata sync to the dashboard.
- `projectos-safety-gates.md` — gates + `SAFETY_VIOLATION_DETECTED`.

Schemas: `projectos/schemas/bridge/*.schema.json`. Templates: `projectos/templates/bridge/`.
Worked example: `projectos/examples/bridge/sample-phase-flow/`.
