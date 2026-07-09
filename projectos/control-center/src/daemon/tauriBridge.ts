/**
 * The real Tauri IpcBridge (I/O boundary; excluded from coverage like realScheduler).
 *
 * @tauri-apps/api is imported dynamically and ONLY when a call actually runs, so a plain
 * browser build (where isTauri() is false) never pulls it in at runtime.
 */
import type { IpcBridge } from './ipcBridge.js';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const tauriBridge: IpcBridge = {
  isTauri: inTauri,
  invoke: async (command, args) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
  },
  listen: async (event, handler) => {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen(event, (e) => handler(e.payload));
    return unlisten;
  },
};
