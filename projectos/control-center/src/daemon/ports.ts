/**
 * Ports — the seams that keep the client layer testable and event-driven.
 *
 * Scheduler abstracts timers (reconnect backoff, heartbeat) so tests drive them with a
 * virtual clock instead of real setTimeout. DaemonTransport is the "Local IPC/Event Bus"
 * boundary: an InProcess adapter (co-located Node/Tauri host) or a Null adapter (browser).
 */
import type { TransportMessage } from './types.js';

export interface Scheduler {
  /** Schedule fn after ms; returns a cancel handle. */
  setTimer(fn: () => void, ms: number): number;
  clearTimer(handle: number): void;
  now(): number;
}

export type TransportListener = (message: TransportMessage) => void;

export interface DaemonTransport {
  /** Human-readable kind, e.g. "in-process" | "null". */
  readonly kind: string;
  /** Begin relaying; should push an initial snapshot (or 'closed' if unavailable). */
  connect(): void;
  disconnect(): void;
  /** Subscribe to relayed messages; returns unsubscribe. */
  onMessage(listener: TransportListener): () => void;
  /** Ask the daemon to re-emit a full snapshot (used by the heartbeat). */
  requestSnapshot(): void;
}
