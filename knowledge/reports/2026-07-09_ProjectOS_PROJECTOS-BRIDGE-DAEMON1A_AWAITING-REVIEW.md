# PROJECTOS-BRIDGE-DAEMON1A — Evidence Pack

> Implementation phase. New package `@projectos/bridge-daemon` — the always-running local
> ProjectOS runtime. Local-only; no Claude/ChatGPT API, no browser automation, no cloud
> execution, no deploy, no DB mutation, no push. **Not committed** (awaiting owner/advisor review).

**Project:** ProjectOS
**Phase:** PROJECTOS-BRIDGE-DAEMON1A
**Status:** IMPLEMENTED LOCALLY / AWAITING REVIEW
**Branch:** projectos-v2-core
**Commit:** not committed (per spec — commit only after approval)

## Objective

Implement the Bridge Daemon: the always-running local process that watches every installed
project's `.projectops` bridge folders, synchronises derived state, manages worker presence,
packages evidence signals, maintains the event log, recovers losslessly on restart, and never
edits business code or bypasses governance.

## What was built

New workspace package `@projectos/bridge-daemon` at `projectos/bridge/daemon/`.

**Architecture — purity + a single I/O port (mirrors the Agent's `system.ts`).** Every engine
is a deterministic reducer; all side effects (clock, ids, filesystem, `fs.watch`, read-only git,
log sink) sit behind one `DaemonSystem` port. Tests inject a `fakeSystem` (virtual clock +
in-memory fs) so the whole runtime is unit-testable. The daemon speaks the bridge JSON-Schema
file contract, not an in-process API — vendor-independent and deterministic.

### Modules (30 source files, ~2434 LOC)

| Spec module | File(s) |
|---|---|
| BridgeDaemon | `daemon/bridgeDaemon.ts` (orchestrator, 410 LOC) |
| FileWatcher | `watchers/fileWatcher.ts` + `utils/debounce.ts` (injected-time coalescer) |
| EventBus | `events/eventBus.ts` (throwing-subscriber isolation) |
| StateManager | `state/stateManager.ts` + `state/stateMachine.ts` + `state/stateStore.ts` |
| WorkerManager | `workers/workerManager.ts` |
| GitWatcher | `git/gitWatcher.ts` (read-only snapshot diff) |
| ValidatorWatcher | `validators/validatorWatcher.ts` |
| Report/EvidenceWatcher | `reports/reportWatcher.ts` |
| ApprovalWatcher | `reports/approvalWatcher.ts` (owner-only) |
| DashboardSync | `sync/dashboardSync.ts` (redacted projection) |
| NotificationService | `notifications/notificationService.ts` (internal only) |
| RecoveryManager | `recovery/recoveryManager.ts` (log-replay) |
| HealthMonitor | `health/healthMonitor.ts` |
| Logger | `logging/logger.ts` (redacts every line) |
| ConfigurationLoader | `config/configLoader.ts` |
| ProjectScanner | `watchers/projectScanner.ts` (`.projectops` discovery) |
| WatchRouter | `watchers/watchRouter.ts` |
| System adapter (I/O boundary) | `system.ts` (`nodeSystem`, coverage-excluded) |
| Types / constants / utils / barrel / bin | `types.ts`, `constants.ts`, `utils/*`, `index.ts`, `bin/projectos-bridge.mjs` |

### State machine

Twelve-stage lifecycle `created → ready → implementing → validating → evidence →
awaiting_review → approved → ready_to_commit → committed → ready_to_push → pushed → closed`,
plus `blocked` / `rolled_back` branches. Transitions are an explicit adjacency table; an event
implying an illegal transition is **refused** (logged as an anomaly), never applied — the
daemon never invents a transition. Each stage maps to a schema-valid persisted status.

### Events

All 22 canonical bridge event types (event.schema.json) plus 7 daemon-internal signals
(`WORKER_ONLINE/OFFLINE`, `SYNC_STARTED/COMPLETED`, `PHASE_RESUMED`, `DAEMON_STARTED/STOPPED`).
Internal events never enter a persisted phase log (they are not schema-valid there). Persisted
logs are read with snake↔camel normalisation so the daemon interoperates with logs written by
the CLI, the agent, or itself.

### Recovery

`rebuildFromEvents` replays a project's event log through the same reducers used at runtime, so
a restart is lossless: phase states + worker map are reconstructed exactly. `start()` recovers
all projects, re-persists state, and emits `DAEMON_STARTED{restart:true}` when history existed.

## Validators

- **TypeScript (strict):** `tsc -p tsconfig.json --noEmit` → EXIT 0 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- **Build:** `tsc` emits `dist/` → EXIT 0.
- **Unit tests:** `vitest run` → **104 passed / 104** across 10 test files.
- **Coverage (v8):** **99.71% lines, 96.6% branches, 100% functions** — clears the package's 95% global gate (`system.ts` + `index.ts` excluded as the I/O boundary + re-export barrel, per the Agent convention).
- **Real binary:** `node bin/projectos-bridge.mjs health` → starts, prints a health snapshot, stops cleanly; unknown command exits non-zero.
- **Framework validators:** root `npm run validate` → `validate-all: ALL PASS`.
- **No-secrets scan:** 0 real-value token matches in `src/` (`sbp_`/`sb_secret_`/`vcp_`/`ghp_` high-entropy shapes). Test files use clearly-synthetic low-entropy fixtures to exercise redaction.
- **ESLint:** NOT WIRED in-repo (no eslint config/deps present); strict `tsc` is the standing static gate — documented, not silently skipped.

## ECC review

- **Architecture:** pure engines behind one I/O port; 30 focused files, largest 410 LOC (all < 800). High cohesion, low coupling; decoupled from `@projectos/core` for vendor independence.
- **Security:** redaction applied to every log line + every dashboard field (value-shape based, catches secrets under innocent keys); `writeFile` refuses any path outside `.projectops/`; approvals honoured only when `decidedBy === owner`; no API/browser/AI-provider dependence; no secrets read/written/committed.
- **Recovery:** lossless log-replay; verified by test (`rebuildFromEvents` reconstructs stage + workers + counts refused transitions).
- **Performance:** debounced, coalesced fs events; reducers are O(events); no busy loops (tick-driven).
- **Concurrency / race:** injected time makes coalescing deterministic; reducers are pure/immutable; the bus isolates a throwing subscriber so it cannot break siblings.
- **Failure modes:** tolerant JSONL parsing (malformed lines skipped + counted); null-safe git diff; refused-transition path; config clamps/defaults on bad input.
- **Determinism:** no `Date.now()`/`Math.random()` in any engine — time/ids arrive through the port.

## Security review

No secret is read, written, logged, synced, or committed. Redaction is enforced at the logger
and the dashboard projection. The system port's write-guard structurally prevents the daemon
from writing business code. Owner-only approval gating is enforced at the daemon boundary.

## Recovery review

Restart reconstructs phase states and worker presence from the append-only event logs alone;
no separate mutable source of truth exists to lose. Git + directory-listing baselines are
re-seeded on start so the first post-restart diff is correct.

## Forbidden actions checked

| Forbidden | Done? |
|---|---|
| Generate business code / implement features | NO |
| Approve work / close phases | NO (owner-only, reflected not authored) |
| Commit automatically | NO — nothing committed |
| Push / deploy | NO |
| Mutate a database | NO |
| Email / SMS / payments | NO |
| Browser automation / UI scraping | NO |
| Claude / ChatGPT API dependence | NO |
| Expose secrets | NO |

## Production touched / external sends / payments

NO / NO / NO. No repo other than the ProjectOS working tree was touched; no `.projectops`
folder in any real project was created (the daemon acts on them at runtime, not at build time).

## Known limitations

- **Push detection:** local `.git` files can't reliably confirm a push; `ready_to_push → closed`
  is allowed and `pushed` is best-effort. Documented; carry-forward.
- **`git dirtyCount`:** the read-only snapshot reports `0` (working-tree diff needs `git`); commit
  detection relies on the head advancing. Carry-forward.
- **ESLint + JSON-Schema meta-validation** not wired in-repo (NOT AVAILABLE); strict `tsc` +
  vitest are the gates.
- The daemon is built but **not yet wired into the Control Center** or run as a background service.

## Carry-forward (future, separately-approved phases)

- Wire Control Center screens/buttons → daemon events + health.
- Robust push detection (compare local ref to a tracked remote ref).
- Add JSON-Schema + Markdown validators to `npm run validate`; add an ESLint config.
- Optional: run the daemon as a managed background service with restart supervision.

## Decision needed

Owner + ChatGPT: review this package (architecture, state machine, security posture, tests).
Approve to commit (`COMMIT_APPROVED`), then decide the next build phase (Control Center wiring).
Nothing is committed or pushed until approved.

## Final status

**PROJECTOS-BRIDGE-DAEMON1A — IMPLEMENTED LOCALLY / AWAITING REVIEW.**
30 source files, 104 tests passing, coverage 99.7% lines / 96.6% branches, strict `tsc` EXIT 0,
real binary verified, framework `validate-all` ALL PASS, no real-value secrets, nothing
committed/pushed/deployed/mutated. Awaiting owner/advisor review + approval to commit.
