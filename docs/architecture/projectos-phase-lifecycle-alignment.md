# ProjectOS — Phase Lifecycle Alignment (Core/CLI ↔ Bridge Daemon)

> Stabilisation note (PROJECTOS-V2-STABILISATION1A). Documents the relationship between the
> Core/CLI phase-status model and the Bridge Daemon's finer stage machine, so the two are not
> confused. **No transition was changed** — both remain owner-gated; Claude never self-closes.

## The two models

### Core / Local Agent (CLI) — `PhaseStatus` (coarse status)

`projectos/core/src/phase.ts` · `PHASE_TRANSITIONS`:

```
draft → prompted → implementing → validating → evidence
      → awaiting_review → awaiting_closure → closed | closed_as_blocked
```

- `validating` may loop back to `implementing`; `awaiting_review` may return to `implementing`.
- Closure (`closed` / `closed_as_blocked`) is **owner-only** (`OWNER_ONLY_TARGETS`); a non-owner
  attempt fails. This is the coarse, human-facing status the CLI advances and the reports index
  records.

### Bridge Daemon — `PhaseStage` (fine, event-driven)

`projectos/bridge/daemon/src/state/stateMachine.ts` subdivides the single Core status
`awaiting_closure` into the actual delivery steps:

```
… awaiting_review → approved → ready_to_commit → committed → ready_to_push → pushed → closed
```

`stageToStatus` maps every one of `{approved, ready_to_commit, committed, ready_to_push,
pushed}` back to the persisted status **`awaiting_closure`**, so `state.json` stays inside the
Core enum. The daemon's `closed` stage is reachable **only from `ready_to_push`, `pushed`, or
`rolled_back`** — i.e. a phase must be **committed and pushed** (or rolled back) before the
daemon records `PHASE_CLOSED → closed`.

## Mapping table

| Core `PhaseStatus` | Daemon `PhaseStage`(s) | Notes |
|---|---|---|
| draft | created | |
| prompted | ready | |
| implementing | implementing | |
| validating | validating | |
| evidence | evidence | |
| awaiting_review | awaiting_review | |
| **awaiting_closure** | **approved · ready_to_commit · committed · ready_to_push · pushed** | daemon adds commit/push granularity |
| closed | closed | owner-only; daemon requires reaching `pushed`/`ready_to_push`/`rolled_back` first |
| closed_as_blocked | closed (from blocked/rolled_back → status `closed_as_blocked`) | |
| rolled_back | rolled_back | |
| (blocked) | blocked | daemon has an explicit `blocked` stage; Core expresses this via `rolled_back`/`closed_as_blocked` |

## Why the daemon is stricter (intentional)

The E2E replay surfaced this: a phase advanced (in the CLI) `awaiting_closure → closed` by the
owner, but the daemon **refused** `approved → closed` on replay because the commit/push stages
were skipped. That is not a bug and not a governance hole:

- **Governance is identical.** Both models make closure owner-only; the daemon's `PHASE_CLOSED`
  is an owner-authored event. Neither lets Claude/the implementer close its own work.
- **The daemon encodes the real delivery flow.** Every ProjectOS phase this programme has closed
  went implement → **commit → push** → close. The daemon requiring `pushed` before `closed`
  simply enforces that a phase producing artefacts is committed and pushed before it is recorded
  closed. The Core status is a coarser convenience; the daemon is the authoritative delivery
  ledger.

## Guidance

- Treat **Core `awaiting_closure`** and the **daemon stages approved…pushed** as the same
  human-facing status; the daemon's extra stages are the commit/push evidence within it.
- To close a phase in the daemon's ledger, drive it to `ready_to_push`/`pushed` (commit +
  push) then have the **owner** author `PHASE_CLOSED`. The reports index `CLOSED` row remains the
  governance record of closure.
- Do **not** add an `approved → closed` shortcut to the daemon: it would let a phase close
  without commit/push evidence. The stricter path is deliberate.

A regression test (`test/lifecycle-alignment.test.ts`) pins the daemon's `closed` adjacency so
this behaviour cannot drift silently.
