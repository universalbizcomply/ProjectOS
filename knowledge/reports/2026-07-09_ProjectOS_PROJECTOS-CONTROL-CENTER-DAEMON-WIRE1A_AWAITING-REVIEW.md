# PROJECTOS-CONTROL-CENTER-DAEMON-WIRE1A — Evidence Pack

> Integration phase. Wires the existing Bridge Daemon into the existing Control Center as a
> live, read-only visualisation layer. No daemon redesign, no Control Center redesign, no new
> API, no cloud, no browser automation, no governance change. **Not committed.**

**Project:** ProjectOS V2
**Phase:** PROJECTOS-CONTROL-CENTER-DAEMON-WIRE1A
**Status:** IMPLEMENTED LOCALLY / AWAITING REVIEW
**Branch:** projectos-v2-core
**Commit:** not committed (per spec)

## Objective

Create a real-time, event-driven connection between the Control Center and the Bridge Daemon
so Mission Control shows live workers, phases, health, events, pending reviews, approvals and
notifications — with no refresh button and no polling. The daemon stays the single source of
truth; the UI is read-only.

## Architecture (the crux)

The daemon is a Node process (`node:fs`); the Control Center is a browser/Tauri webview that
**cannot** import it. So the wiring is a **framework-agnostic client service layer** behind a
`DaemonTransport` port (the spec's "Local IPC/Event Bus" seam) plus a thin React binding:

```
Control Center UI (React, read-only)
        │  useSyncExternalStore
   DaemonProvider + hooks
        │
   DaemonClient ── LiveStore (mirror) ── StatusSynchroniser (redacts)
        │
   DaemonTransport (port)
     ├─ InProcessTransport  → wraps a real BridgeDaemon (Node/Tauri host + tests)
     └─ NullTransport       → browser fallback (clean Disconnected + reconnect)
```

- **Event-driven, no polling:** `InProcessTransport` subscribes to the daemon's `EventBus`; each
  daemon event relays an `event` + a fresh `snapshot`. A heartbeat only *requests* a snapshot to
  detect a silent drop — it is not a data poll.
- **UI never owns state:** components read slices from `LiveStore`; the store replaces only
  changed slices so React repaints just the moved components.
- **Browser bundle stays clean:** only `inProcessTransport.ts` references `@projectos/bridge-daemon`,
  and it does so with a **type-only import**; it is never imported by browser code. Verified: the
  production bundle contains **0** occurrences of `node:fs`/`BridgeDaemon`.
- **Testable:** timers are injected via a `Scheduler` port, so reconnect/heartbeat are driven by a
  virtual clock. This mirrors the daemon's own port pattern.

## Files created / changed

**New — `src/daemon/` (15 files, ~1332 LOC):** `types.ts`, `ports.ts`, `redact.ts`, `store.ts`,
`eventStream.ts`, `synchroniser.ts`, `providers.ts`, `connection.ts` (ConnectionManager /
ReconnectManager / Heartbeat / DaemonConnection), `daemonClient.ts`, `inProcessTransport.ts`,
`nullTransport.ts`, `realScheduler.ts`, `index.ts`, `DaemonProvider.tsx` (+ hooks),
`LiveMissionControl.tsx` (live widgets).

**New — `test/` (8 files, ~815 LOC):** helpers (virtual-clock scheduler + fake transport) +
store/redact/streams, providers/sync, connection, daemonClient, inProcessTransport,
coverage-extra, and a jsdom component test (`liveView.test.tsx`).

**Changed (integration only):** `src/App.tsx` (new `Mission Control` nav item + `DaemonProvider`
wrap + `<LiveMissionControl />`), `src/styles.css` (live-widget styles), `package.json` (test
deps + `@projectos/bridge-daemon` link + test scripts), new `vitest.config.ts`.

## Spec modules → implementation

DaemonClient · DaemonConnection · DaemonHealthProvider · WorkerStatusProvider ·
PhaseStatusProvider · NotificationProvider · EventStream · HealthStream · StatusSynchroniser ·
ConnectionManager · ReconnectManager · Heartbeat — all implemented (some grouped by file per
coding-style). Live widgets: Bridge status, Health panel, Worker panel, Owner queue (pending
reviews + approvals), Projects-live grid, Event viewer (search + pause + auto-scroll list),
Notifications.

## Tests + coverage

- **Unit + integration (vitest, node):** connection lifecycle, reconnect backoff, heartbeat
  liveness → auto-reconnect, disconnect, pause/resume stream, redaction, provider selectors,
  transport mapping against real daemon types.
- **Component (vitest, jsdom + @testing-library/react):** `LiveMissionControl` renders Connecting
  → Bridge running on snapshot, shows the worker + owner queue, and never renders a secret
  (`[REDACTED]` asserted).
- **Result:** **37 passed / 37**.
- **Coverage (v8, `src/daemon/**`):** **99.63% lines, 98.22% branches, 100% functions** — clears
  the 95% gate. (React `*.tsx`, the browser scheduler, and type-only `types.ts`/`ports.ts` are
  excluded, consistent with the daemon's I/O-boundary convention.)

## Validators

- **TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`):** `tsc --noEmit` → EXIT 0.
- **Production build:** `npm run build` (tsc + `vite build`) → EXIT 0, 111 modules, bundle
  395 kB / 112 kB gzip. **No `node:fs` in the bundle** (grep-verified) → daemon did not leak.
- **Framework validators:** root `npm run validate` → `validate-all: ALL PASS`.
- **No-secrets scan:** 0 real-value token matches in `src/daemon/`.

## ECC review

- **Architecture:** clean port seam; browser stays Node-free; daemon remains source of truth; no
  duplicated state/workers/event-bus.
- **UI/UX:** one new read-only view; connection banner is always honest (Connected / Connecting /
  Disconnected + retry #); no refresh button; empty states everywhere.
- **Performance:** event-driven; slice-level change detection repaints only moved components; no
  interval polling; event buffer capped (200), health history capped (30).
- **Memory:** bounded buffers; subscriptions cleaned up on stop()/unmount.
- **Recovery:** silent-drop detection via heartbeat + capped exponential backoff reconnect; UI
  never crashes on disconnect.
- **Concurrency:** injected clock makes timer logic deterministic; store notify is synchronous.
- **Security:** client-side redaction (defence in depth) on every worker/phase/notification/event
  field; component test asserts no secret reaches the DOM; no filesystem paths surfaced in widgets.
- **Failure:** malformed/absent daemon → NullTransport → clean Disconnected; missing provider →
  clear thrown error (dev-only).

## Governance / forbidden actions

No daemon rewrite · no Control Center redesign · no duplicated state/workers/bus · no browser
automation · no AI API · no cloud dependency · no business logic · no governance change. The UI
is strictly read-only; execution stays owner-gated in the daemon/CLI. Production touched: NO ·
Deploy: NO · DB mutation: NO · Sends/payments: NO · Commit: NO · Push: NO.

## Known limitations / carry-forward

- **Live data needs a co-located host.** `InProcessTransport` runs where the Control Center shares
  a JS runtime with the daemon (a Node host / Tauri Node sidecar) and in tests. A plain web build
  uses `NullTransport` → shows Disconnected. **Carry-forward:** a Tauri-IPC transport (daemon in a
  sidecar, events forwarded to the webview via Tauri emit/listen) for the shipped desktop app.
- Browser verification of the live view is covered by the jsdom component tests; the deployed web
  app is login-walled, and the daemon isn't co-located in that browser context.
- No ESLint wired in the Control Center (strict `tsc` is the static gate) — carry-forward.

## Decision required

Owner + ChatGPT: review the client service layer + live view. Approve to commit
(`COMMIT_APPROVED`), then decide whether to build the Tauri-IPC transport (ship live data to the
desktop app). Nothing committed or pushed until approved.

## Final status

**PROJECTOS-CONTROL-CENTER-DAEMON-WIRE1A — IMPLEMENTED LOCALLY / AWAITING REVIEW.**
15 service/UI files + 8 test files; 37 tests passing; coverage 99.6% lines / 98.2% branches;
strict `tsc` EXIT 0; production build clean with no daemon leakage; framework `validate-all` ALL
PASS; no real-value secrets. Nothing committed, pushed, deployed, or mutated.
