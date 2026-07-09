/**
 * NullTransport — the browser fallback. With no co-located daemon (a plain web build has no
 * Node runtime), it reports "closed" so the client shows a clean Disconnected state and keeps
 * attempting reconnect, without ever crashing. A real browser deployment swaps this for a
 * Tauri-IPC transport (carry-forward).
 */
import type { DaemonTransport, TransportListener } from './ports.js';

export class NullTransport implements DaemonTransport {
  readonly kind = 'null';
  readonly #listeners = new Set<TransportListener>();

  connect(): void {
    for (const l of this.#listeners) l({ kind: 'closed' });
  }
  disconnect(): void {
    /* nothing to tear down */
  }
  onMessage(listener: TransportListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  requestSnapshot(): void {
    /* no daemon to ask */
  }
}
