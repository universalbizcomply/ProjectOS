# ProjectOS — Tauri IPC Daemon Bridge

> Phase PROJECTOS-TAURI-IPC-DAEMON1A. How the shipped ProjectOS **desktop** app becomes a
> genuine live Mission Control by connecting the existing Bridge Daemon to the existing
> Control Center over native Tauri IPC. Integration only — no module was redesigned. Covers:
> architecture, sequence diagrams, transport guide, desktop runtime guide, recovery guide,
> developer guide. (The future-plugin guide is a sibling doc.)

## 1. Why a sidecar

The Bridge Daemon is a Node process (it uses `node:fs`, `fs.watch`). A Tauri webview cannot
run Node, and the Rust host cannot run TypeScript in-process. So the daemon runs as a **Node
sidecar** that the Rust host spawns; the host forwards the sidecar's output to the webview over
a native Tauri event channel. The daemon stays the single source of truth; nothing is
duplicated.

```
ProjectOS Desktop (Tauri)
        │
  React Control Center ── DaemonClient (existing, transport-agnostic)
        │                     providers · EventStream · Reconnect · Heartbeat  ← reused
  TauriIPCTransport (new, TS)
        │  listen("daemon://message")  +  invoke("daemon_request_snapshot")
  Rust Host Layer (src-tauri) ── spawns sidecar, forwards stdout → emit, read-only commands
        │  stdout (JSON lines)                     ▲ stdin ({"cmd":"snapshot"})
  Node sidecar (sidecar/host.mjs)
        │  reuses InProcessTransport (tested) → JSON lines
  Bridge Daemon (BridgeDaemon + nodeSystem)
        │
  Event Bus → State Engine → .projectops / Git / Reports
```

The browser build has no Rust host, so `createDesktopTransport` automatically returns
`NullTransport` (clean "Disconnected"). **Selection is automatic — no configuration.**

## 2. Components (and what is reused vs new)

| Spec module | Realisation |
|---|---|
| **TauriIPCTransport** | `src/daemon/tauriIpcTransport.ts` — new; implements the existing `DaemonTransport` port. |
| **IPCCommandRegistry** | `src/daemon/ipcCommands.ts` — the read-only command names + event channel. |
| **IPCEventBridge** | Rust `spawn_and_register` (stdout → `app.emit`) + TS `parseMessageLine` on `listen`. |
| **IPCConnection** | the transport's listen/unlisten handle + the client's `DaemonConnection` (reused). |
| **IPCHealth/Worker/Phase/Notification providers** | the existing `DaemonHealthProvider` / `WorkerStatusProvider` / `PhaseStatusProvider` / `NotificationProvider` — they slice the one snapshot. **Reused, not duplicated.** |
| **IPCEventStream** | the existing `EventStream` fed by the transport. |
| **IPCReconnectManager / IPCHeartbeat** | the existing `ReconnectManager` / `Heartbeat` in `DaemonClient`. |

New TS: `ipcProtocol.ts` (wire format, shared with the sidecar), `ipcBridge.ts` (port),
`tauriBridge.ts` (real `@tauri-apps/api` adapter), `selectTransport.ts` (auto-selection).
New Node: `sidecar/host.mjs` (+ `tsconfig.node.json` → `node-build/`). New Rust: the host in
`src-tauri/src/main.rs`.

## 3. Wire protocol

Line-delimited JSON. Each line is exactly a transport-agnostic `TransportMessage`
(`snapshot` | `event` | `notification` | `health` | `closed`) — so no new shape is invented.
`ipcProtocol.ts` (`encodeMessageLine` / `parseMessageLine`) is shared by both ends; malformed
or unknown-kind lines are dropped, never surfaced. The daemon's own log lines go to the
sidecar's **stderr**, keeping stdout a pure protocol channel.

## 4. Sequence — launch to live

```
Desktop launches
  └─ Rust setup(): spawn `node sidecar/host.mjs`
        └─ sidecar: BridgeDaemon.start() → recover state → InProcessTransport.connect()
              └─ emits {kind:snapshot} on stdout
        └─ Rust reader thread: emit("daemon://message", line) → webview
  └─ React: DaemonProvider → createDesktopTransport(tauriBridge) → TauriIPCTransport
        └─ connect(): listen("daemon://message") → invoke("daemon_request_snapshot")
        └─ receives snapshot → StatusSynchroniser → LiveStore → widgets repaint
  └─ Bridge running · Workers connected · Health green · Projects loaded · Events streaming
```

Every subsequent daemon event pushes an `event` line + a fresh `snapshot` line — the UI stays
live with no polling.

## 5. Recovery

| Failure | Behaviour |
|---|---|
| Daemon/sidecar not started (node missing) | Rust spawn fails silently; transport's initial `invoke` rejects → `closed` → client shows **Disconnected** and retries with capped backoff. |
| Sidecar dies mid-session | stdout closes; no more messages → the client heartbeat sees no liveness within the window → **Reconnecting** → backoff `invoke` retries. |
| Daemon restarts | it recovers state from the event logs (lossless) and re-emits a snapshot; the UI updates. |
| Desktop restart | the whole chain re-establishes on launch. |
| Connection loss | never freezes the UI; the connection badge shows Connecting / Connected / Reconnecting / Offline. |

Because the daemon rebuilds derived state from its append-only logs, no restart loses data.

## 6. Security

- **Read-only IPC.** Only two commands exist: `daemon_request_snapshot` (ask for a snapshot)
  and `daemon_status` (liveness). There is no write/exec/git/shell/deploy/delete command.
- **No secrets on the wire.** The daemon redacts before emitting; the sidecar forwards the
  already-redacted DTOs; the client's `StatusSynchroniser` redacts again (defence in depth);
  the UI has a component test asserting no secret reaches the DOM.
- **No arbitrary paths.** The sidecar only watches the configured `.projectops` roots; the UI
  surfaces phase/worker/project names, not filesystem paths.
- **Capability-scoped.** The webview is granted `core:event:default` to listen; nothing more.

## 7. Developer guide

Build + run the live desktop app:

```
# one-time / on daemon change:
npm --prefix projectos/bridge/daemon run build      # daemon dist
npm --prefix projectos/control-center run build:sidecar   # node-build/ for the sidecar

# run the desktop app (spawns the sidecar automatically):
npm --prefix projectos/control-center run tauri dev
```

- The sidecar reads `bridge.config.json` (cwd) for `watchRoots`; pass `--root <dir>` to add more.
- The browser dev server (`npm run dev`) shows **Disconnected** — expected (no Rust host).
- Tests: `npm --prefix projectos/control-center test` (service layer + IPC + component).

## 8. Known limitations / carry-forward

- **Node runtime + packaging.** The bundled desktop app expects `node` on PATH and the
  sidecar's `node_modules` (daemon + core). Full self-contained packaging (bundle a Node
  runtime or compile the sidecar to a single binary) is carry-forward.
- **Graceful sidecar shutdown.** The `Child` is dropped after taking its pipes (its process
  keeps running); a clean kill-on-exit is carry-forward.
- **Live GUI round-trip** is verified by the sidecar smoke test + unit/component tests +
  `cargo check` + browser build; an interactive desktop launch confirms the end-to-end visual.
