/**
 * IPC wire protocol — the line format shared by the Node sidecar (which emits) and the
 * TauriIPCTransport (which parses). Pure + tested, so both ends agree by construction. The
 * payload is exactly the transport-agnostic TransportMessage, so no new shapes are invented.
 */
import type { TransportMessage } from './types.js';

const MESSAGE_KINDS = new Set(['snapshot', 'event', 'notification', 'health', 'closed']);

/** Encode a message as one newline-terminated JSON line (sidecar → stdout). */
export function encodeMessageLine(message: TransportMessage): string {
  return JSON.stringify(message) + '\n';
}

/** Parse a wire line/payload into a TransportMessage, or null if malformed/unknown. */
export function parseMessageLine(line: string): TransportMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object') return null;
  const kind = (obj as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !MESSAGE_KINDS.has(kind)) return null;
  return obj as TransportMessage;
}

export interface SidecarCommand {
  readonly cmd: 'snapshot';
}

/** Encode a stdin command (transport → sidecar). */
export function encodeCommand(cmd: SidecarCommand): string {
  return JSON.stringify(cmd) + '\n';
}

/** Parse a stdin command line, or null if unrecognised. */
export function parseCommandLine(line: string): SidecarCommand | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (obj !== null && typeof obj === 'object' && (obj as { cmd?: unknown }).cmd === 'snapshot') {
      return { cmd: 'snapshot' };
    }
  } catch {
    return null;
  }
  return null;
}
