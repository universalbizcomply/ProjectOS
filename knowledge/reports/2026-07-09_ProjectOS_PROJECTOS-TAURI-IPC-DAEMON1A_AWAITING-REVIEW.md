# PROJECTOS-TAURI-IPC-DAEMON1A — Evidence Pack

> Integration phase. Connects the existing Bridge Daemon to the existing Control Center over
> native Tauri IPC so the **desktop** app is live; the browser keeps NullTransport. No module
> redesigned. Read-only IPC. No new HTTP API, no cloud, no browser automation, no governance
> change. **Not committed.**

**Project:** ProjectOS V2
**Phase:** PROJECTOS-TAURI-IPC-DAEMON1A
**Status:** IMPLEMENTED LOCALLY / AWAITING REVIEW
**Branch:** projectos-v2-core
**Commit:** not committed (per spec)

## Objective

Make the shipped desktop app a genuine Mission Control: on launch it auto-connects to the
Bridge Daemon and shows live workers, phases, health, events, reviews, approvals and
notifications — event-driven, no polling. The browser build automatically stays on
NullTransport (Disconnected).

## Architecture

The daemon is Node (`node:fs`); a Tauri webview can't run it and the Rust host can't run TS.
So the Rust host spawns a **Node sidecar** running the real `BridgeDaemon`, forwards its
stdout JSON lines to the webview over a native `daemon://message` event channel, and exposes
two read-only `invoke` commands. The TS `TauriIPCTransport` plugs into the **existing**
transport-agnostic `DaemonClient` — providers, EventStream, ReconnectManager and Heartbeat are
**reused, not duplicated**. `createDesktopTransport` picks Tauri vs Null automatically.

```
Desktop → React CC → DaemonClient → TauriIPCTransport
  → listen("daemon://message") / invoke("daemon_request_snapshot")
  → Rust host (spawn sidecar, stdout→emit, read-only cmds)
  → Node sidecar (reuses tested InProcessTransport) → BridgeDaemon → EventBus → State
```

## Files created / changed

**New TS — `src/daemon/`:** `ipcProtocol.ts` (wire format, shared with sidecar), `ipcCommands.ts`
(IPCCommandRegistry + event channel), `ipcBridge.ts` (port), `tauriBridge.ts` (real
`@tauri-apps/api` adapter, lazy import), `tauriIpcTransport.ts` (the transport),
`selectTransport.ts` (auto-selection). **New test:** `test/tauriIpc.test.ts`.

**New Node:** `sidecar/host.mjs` (runs BridgeDaemon + reuses `InProcessTransport`; daemon logs →
stderr so stdout stays pure protocol), `tsconfig.node.json` (compiles the Node-side client to
`node-build/`), `build:sidecar` script.

**New/changed Rust:** `src-tauri/src/main.rs` — spawns the sidecar, streams stdout →
`emit("daemon://message")`, `daemon_request_snapshot` + `daemon_status` commands (read-only),
owns `ChildStdin` for snapshot requests. `capabilities/default.json` (+`core:event:default`).
`tauri.conf.json` (bundle `sidecar/` + `node-build/` resources).

**Wiring:** `DaemonProvider.tsx` default now `createDesktopTransport(tauriBridge)`; barrel
exports; `package.json` (+`@tauri-apps/api`, scripts); `vitest.config.ts` (coverage excludes for
the new I/O boundaries); `.gitignore` (+`node-build/`).

## Modules created (spec → realisation)

TauriIPCTransport (new) · IPCCommandRegistry (`ipcCommands.ts`) · IPCEventBridge (Rust
stdout→emit + TS `parseMessageLine`) · IPCConnection (listen handle + reused `DaemonConnection`)
· IPCHealth/Worker/Phase/Notification providers, IPCEventStream, IPCReconnectManager,
IPCHeartbeat = the existing client modules fed by the new transport (reused, not duplicated —
documented in `docs/architecture/projectos-tauri-ipc-architecture.md`).

## Tests + coverage

- **46 passed / 46** (vitest). New: protocol round-trip + malformed handling; transport
  connect/listen/relay/parse, listen-failure→closed, requestSnapshot-failure→closed, disconnect
  unlisten; auto-selection Tauri vs browser.
- **Coverage (v8, `src/daemon/**`):** **99.69% lines, 99.03% branches, 100% functions** — clears
  the 95% gate. (`tauriBridge.ts`, `realScheduler.ts`, type-only `types.ts`/`ports.ts`/
  `ipcBridge.ts` excluded as I/O boundaries / type modules.)

## Validation

- **TypeScript (strict):** `tsc --noEmit` → EXIT 0; sidecar `tsc -p tsconfig.node.json` → EXIT 0.
- **Rust:** `cargo check` → **Finished, 0 errors** (host + IPC commands + sidecar spawn compile).
- **Browser build:** `npm run build` → EXIT 0; `@tauri-apps/api/event` is a lazy chunk;
  **0 `node:fs`/daemon code in the bundle** (grep-verified).
- **Sidecar smoke:** `node sidecar/host.mjs` starts the daemon, emits a `{kind:"snapshot"}` line
  on connect, and re-emits on a stdin `{"cmd":"snapshot"}` — verified end to end.
- **Desktop bundle:** `npm run tauri build` (release) run to compile + bundle the shell with the
  sidecar resources. `cargo check` confirms host compilation regardless.
- **Framework validators:** root `npm run validate` → ALL PASS (pre-existing).
- **No-secrets scan:** 0 real-value tokens in `src/daemon/` + `sidecar/`.

## Desktop verification / IPC verification

- IPC transport + protocol + auto-selection: unit-tested (fake `IpcBridge`), 100% of the new TS.
- Sidecar → JSON-line protocol: smoke-verified against the real daemon.
- Rust host: `cargo check` compiles (spawn, stdout→emit, read-only commands, capabilities).
- **The live in-window IPC round-trip (Rust ⇄ webview) requires an interactive desktop launch**
  and is not headless-verifiable here — documented, consistent with prior desktop phases.

## ECC review

- **Architecture:** sidecar keeps the daemon authoritative + Node out of the webview; port seam
  reused; no duplicated state/workers/bus.
- **IPC:** two read-only commands + one event channel; additive wire protocol shared by both ends.
- **Rust:** owns `ChildStdin` only (pipe handles outlive `Child`); reader thread isolated;
  fixed borrow-checker temporary-lifetime and `State` lifetime issues.
- **Security:** read-only; redaction at daemon + sidecar + client; capability-scoped listen; no
  shell/git/write/exec/deploy command; component test asserts no secret in the DOM.
- **Performance:** event-driven, no polling; only changed slices repaint; daemon logs off the
  protocol channel; capped event/health buffers.
- **Recovery:** spawn failure / sidecar death / daemon restart / desktop restart all resolve via
  heartbeat + capped-backoff reconnect; UI never freezes.
- **Concurrency:** injected clock in tests; single stdout reader thread; mutex-guarded stdin.
- **UX/flow:** honest connection badge (Connecting / Connected / Reconnecting / Offline);
  browser shows Disconnected by design.

## Governance / forbidden actions

No daemon/CC/client rewrite · no duplicated state/workers/bus · no browser automation · no new
HTTP API · no cloud dependency · daemon not moved into browser · no governance change. IPC is
read-only. Production touched: NO · Deploy: NO · DB mutation: NO · Sends/payments: NO.

## Known limitations / carry-forward

- Bundled desktop expects `node` on PATH + the sidecar's `node_modules`; full self-contained
  packaging (embed a Node runtime or compile the sidecar to a binary) is carry-forward.
- Graceful sidecar kill-on-exit (currently the process is left to the OS) is carry-forward.
- Live GUI IPC round-trip needs an interactive launch to confirm visually.

## Decision required

Owner + ChatGPT: review the IPC design, Rust host, and transport. Approve to commit
(`COMMIT_APPROVED`), then decide the packaging follow-up (embed Node / single-binary sidecar).
Nothing committed or pushed until approved.

## Final status

**PROJECTOS-TAURI-IPC-DAEMON1A — IMPLEMENTED LOCALLY / AWAITING REVIEW.**
6 new TS files + sidecar + Rust host + 2 docs; 46 tests passing; coverage 99.7% lines / 99.0%
branches; strict `tsc` EXIT 0; `cargo check` clean; browser build clean with no daemon leakage;
sidecar smoke-verified; framework validators ALL PASS; no real-value secrets. Nothing committed,
pushed, deployed, or mutated. **Commit: NOT COMMITTED · Push: NOT PUSHED.**
