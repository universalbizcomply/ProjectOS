/**
 * Transport auto-selection — no manual configuration. Inside a Tauri webview the desktop app
 * gets the live TauriIPCTransport; a plain browser build gets NullTransport (clean Disconnected).
 */
import { NullTransport } from './nullTransport.js';
import { TauriIPCTransport } from './tauriIpcTransport.js';
import type { IpcBridge } from './ipcBridge.js';
import type { DaemonTransport } from './ports.js';

export function createDesktopTransport(bridge: IpcBridge): DaemonTransport {
  return bridge.isTauri() ? new TauriIPCTransport(bridge) : new NullTransport();
}
