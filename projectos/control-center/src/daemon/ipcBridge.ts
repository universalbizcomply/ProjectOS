/**
 * IpcBridge — the seam over Tauri's native IPC. Abstracting `invoke`/`listen` behind a port
 * keeps the transport unit-testable (tests inject a fake bridge) and lets the browser build
 * avoid loading @tauri-apps/api at all.
 */
export interface IpcBridge {
  /** True inside a Tauri webview. Drives automatic transport selection. */
  isTauri(): boolean;
  /** Invoke a read-only Tauri command. */
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Subscribe to a Tauri event; resolves to an unlisten function. */
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}
