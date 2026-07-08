# ProjectOS Core Engine — Architecture (PROJECTOS-CORE-ARCHITECTURE1A)

> The kernel of ProjectOS V2. Pure TypeScript domain logic that every surface
> (Local Agent CLI, Control Center desktop, Cloud Dashboard) drives. No I/O in the
> core: filesystem, git, network and clock are injected by adapters at the edges.

## 1. Position in the system

```
Surfaces (CLI / Desktop / Cloud)  ->  Core Engine (this)  <-  Framework schemas/docs
                                          |
                                    Adapters (fs, git, clock, id) — injected
```

The core encodes the **governance model** already defined by the framework:

- Phase lifecycle: `prompt -> implement -> validate -> evidence -> review -> closure`.
- Roles: `owner` (Murad), `advisor` (ChatGPT), `implementer` (Claude).
- Safety gates (from `schemas/safety-gates.schema.json`): production deploy, prod DB
  mutation, real messaging, payment, secrets, force-push, external service, closure.
- Closure and every gated action require **owner approval**; the core enforces this,
  it never performs the gated action.

## 2. Design rules

1. **Pure & deterministic.** No `Date.now()`, no `Math.random()`, no fs/network inside
   `core/src`. Timestamps and ids are passed in. This makes every engine unit-testable.
2. **Immutable.** Engines never mutate inputs; they return new state objects.
3. **Small, single-purpose modules** with explicit interfaces (see §4).
4. **Result types over exceptions** for expected failures (illegal transition, denied
   permission, invalid config) — `{ ok: true, ... } | { ok: false, error }`.
5. **Schema-aligned.** Types mirror the existing JSON schemas so the CLI can round-trip
   manifests/configs without translation.

## 3. Module map

| Module | Purpose |
|--------|---------|
| `types.ts` | Shared domain types & enums (roles, statuses, risk, gates, events). |
| `phase/state-machine.ts` | Legal phase transitions + owner-only targets. |
| `phase/phase-engine.ts` | Create/transition phases; append transition history. |
| `task/task-engine.ts` | Task state machine (pending→in_progress→done/blocked). |
| `permissions/roles.ts` | Role→action permission matrix; `can(role, action)`. |
| `risk/risk-engine.ts` | Classify an action → gate + risk level; default gate set. |
| `approval/approval-engine.ts` | Request/decide approvals; enforces owner-only on gated. |
| `events/event-log.ts` | Immutable append-only event log + lightweight bus. |
| `config/config-loader.ts` | Pure parse+validate of project-config objects. |
| `discovery/project-discovery.ts` | Pure parsers: repo slug from remote, branch from HEAD. |
| `plugins/plugin-registry.ts` | Register/resolve plugins by capability. |
| `workflow/workflow-engine.ts` | Canonical ordered workflow steps; `nextStep`. |
| `index.ts` | Public API surface. |

## 4. Key interfaces (summary)

- **Phase**: `{ phaseId, project, objective, status, history[] }`. `transitionPhase(phase,
  to, by, at, note?)` returns a new phase or an error. Transitions to `closed` /
  `closed_as_blocked` require `by === 'owner'`.
- **Approval**: `requestApproval(...)` → `ApprovalRequest`; `decide(request, decision, by,
  at)` — only `owner` may approve a gated request.
- **Risk**: `classifyAction(action)` → `{ gate?, risk, gated }` using a keyword map onto
  the eight canonical gates.
- **EventLog**: `append(log, event)` → new log; `EventBus` (edge helper) for subscribers.

## 5. Testing

Vitest, ≥80% coverage. Every engine tested for happy path + rejection path (illegal
transition, denied permission, non-owner attempting a gated/closure action, invalid config).

## 6. Out of scope for CORE1A

Persistence (SQLite lives in the Local Agent phase), git/fs adapters (CLI phase), any
network or external service. The core only decides and transforms state.
