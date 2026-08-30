/**
 * IPC wire protocol — the line format shared by the Node sidecar (which emits) and the
 * TauriIPCTransport (which parses). Pure + tested, so both ends agree by construction. The
 * payload is exactly the transport-agnostic TransportMessage, so no new shapes are invented.
 */
import type { TransportMessage } from './types.js';

// `governed-projects` carries the installed-project INVENTORY: which projects this installation may
// govern and which one is selected. It is a separate kind from `governed` because it answers a
// different question — WHICH project, not what state that project is in — and collapsing the two
// would let a surface paint one project's plan under another project's name.
const MESSAGE_KINDS = new Set([
  'snapshot',
  'event',
  'notification',
  'health',
  'governed',
  'governed-projects',
  'governed-portfolio',
  'closed',
  // The governed run's own lifecycle — see governedRun types. Distinct from `event`/`notification`
  // because those describe the DAEMON's file-watcher inferences; these are reported directly by
  // the sidecar about the process it is itself tracking, so they are never inferred or guessed.
  'run-started',
  'run-output',
  'run-finished',
]);

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
  // A STRUCTURAL check for the inventory, not merely a kind check.
  //
  // Every other kind here is cast on the strength of its discriminant alone, which is a pre-existing
  // weakness of this parser. The inventory is not given the same treatment: it decides WHICH project
  // the surface believes it is looking at, so a malformed one — from version skew between a sidecar
  // and a browser bundle, or from a defect upstream — must be dropped at the boundary rather than
  // rendered as though it satisfied the type it is cast to.
  if (kind === 'governed-projects' && !isGovernedProjectsPayload(obj)) return null;
  return obj as TransportMessage;
}

/** Whether a parsed line really carries a `GovernedProjectsInventory`. */
function isGovernedProjectsPayload(value: object): boolean {
  const inventory = (value as { inventory?: unknown }).inventory;
  if (inventory === null || typeof inventory !== 'object' || Array.isArray(inventory)) return false;
  const rec = inventory as Record<string, unknown>;
  if (!Array.isArray(rec['projects'])) return false;
  if (typeof rec['refusedCount'] !== 'number' || !Number.isFinite(rec['refusedCount'])) return false;
  if (rec['registryStatus'] !== null && typeof rec['registryStatus'] !== 'string') return false;
  if (rec['selectedProjectId'] !== null && typeof rec['selectedProjectId'] !== 'string') return false;
  return rec['projects'].every(
    (project) =>
      project !== null &&
      typeof project === 'object' &&
      typeof (project as Record<string, unknown>)['projectId'] === 'string' &&
      typeof (project as Record<string, unknown>)['projectName'] === 'string' &&
      typeof (project as Record<string, unknown>)['repositoryRoot'] === 'string' &&
      typeof (project as Record<string, unknown>)['repository'] === 'string',
  );
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
