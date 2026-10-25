# ProjectOS — Tauri IPC Future-Plugin Guide

> Sibling to `projectos-tauri-ipc-architecture.md`. How to extend the read-only IPC bridge
> without breaking governance or the "daemon is the single source of truth" rule.

## Principles for any IPC extension

1. **Read-only only.** New commands may read daemon-derived state; they must never write files,
   run git/shell, deploy, mutate a database, or approve/close a phase. Governance stays in the
   daemon/CLI/core.
2. **Reuse the transport-agnostic client.** New live views bind to the existing `LiveStore` +
   providers. Do not add a parallel state store.
3. **Extend the wire protocol additively.** New information rides the existing `snapshot` DTO or
   a new `TransportMessage` kind added to `ipcProtocol.ts` (update `MESSAGE_KINDS` + the union).
   Both ends share `ipcProtocol.ts`, so they stay in agreement.
4. **Redact at the boundary.** Any new free-text field must pass through `redact` in the
   `StatusSynchroniser` before it reaches the store.

## Adding a new read-only IPC command

1. Add the command name to `IPC_COMMANDS` in `ipcCommands.ts`.
2. Implement a `#[tauri::command]` in `src-tauri/src/main.rs` that returns cached/derived data
   (no side effects) and register it in `generate_handler!`.
3. Call it from the transport (or a provider) via the injected `IpcBridge.invoke`.
4. Unit-test with the fake `IpcBridge`; the real `tauriBridge` needs no test (I/O boundary).

## Adding a new live widget

1. Add a selector/provider over `LiveStore` (pure).
2. Add a hook in `DaemonProvider.tsx` (`useSyncExternalStore` slice).
3. Render a read-only component in `LiveMissionControl.tsx`.
4. Cover the selector in tests; the component gets a jsdom render test.

## Adding a new transport (e.g. remote monitoring)

Implement the `DaemonTransport` port (like `TauriIPCTransport` / `NullTransport`) and register
it in `createDesktopTransport` (or a new selector). The client, providers, reconnect and
heartbeat all work unchanged — that is the whole point of the port seam.

## What NOT to do

- Do not move the daemon into the browser or the Rust host.
- Do not expose a write/exec command "just for convenience".
- Do not duplicate workers/phase/event state on the client.
- Do not bypass redaction or the owner-gated governance in the daemon.
