/**
 * THE FILES TAB'S ONE ROUTE TO THE HOST.
 *
 * Adding a file is TWO host calls and no governed command: `pick_file` returns a path the owner
 * chose, and `import_project_file` copies it into the selected project's governed inbox. The second
 * call takes the project's IDENTITY — never a folder — because the destination is resolved on the
 * trusted side from the protected registry. There is nothing here that could name a location to
 * write into, and adding one would be a visible change to this file and to the Rust command.
 *
 * IMPORTED FILES ARE INERT. They are stored and listed. They do not enter the planning corpus and
 * they do not reach authoring; `val-projectos-file-inbox-inert1a` proves it against the real
 * discovery engine.
 *
 * Created in PROJECTOS-GOVERNED-UPLOAD-SEAM-IMPLEMENT1A.
 */
import type { IpcBridge } from '../daemon/ipcBridge';

/**
 * What the owner picks, in their words. The token is what the host stores.
 *
 * Deliberately NOT the plan schema's `sourceDocumentType`. That vocabulary describes documents a
 * plan was approved against; an inert import is not one, and mapping onto it would record a binding
 * that does not exist.
 */
export const FILE_PURPOSES = [
  { token: 'SPECIFICATION', label: 'Specification or brief' },
  { token: 'REFERENCE', label: 'Reference material' },
  { token: 'EVIDENCE', label: 'Evidence' },
  { token: 'OTHER', label: 'Something else' },
] as const;

export type FilePurposeToken = (typeof FILE_PURPOSES)[number]['token'];

/** One file in the governed inbox, as the host reports it. */
export interface ProjectFile {
  readonly file_name: string;
  readonly purpose: string | null;
  readonly size_bytes: number;
  readonly imported_at_epoch_ms: number | null;
}

interface FilesListing {
  readonly ok: boolean;
  readonly files: readonly ProjectFile[];
  readonly message: string;
}

interface ImportOutcome {
  readonly ok: boolean;
  readonly file_name: string | null;
  readonly refusal: string | null;
  readonly message: string;
}

/** What `addProjectFile` did. `CANCELLED` is an ordinary outcome, not a failure. */
export type AddOutcome =
  | { readonly kind: 'ADDED'; readonly fileName: string; readonly message: string }
  | { readonly kind: 'CANCELLED' }
  | { readonly kind: 'REFUSED'; readonly message: string };

/** The owner-facing label for a stored purpose token, or null when the record did not say. */
export function purposeLabel(token: string | null): string | null {
  if (token === null) return null;
  return FILE_PURPOSES.find((p) => p.token === token)?.label ?? null;
}

/** Sizes an owner reads, not sizes a machine reports. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The date it was added. Absent rather than invented when the record is missing. */
export function formatImported(epochMs: number | null): string | null {
  if (epochMs === null) return null;
  const when = new Date(epochMs);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Read the project's governed inbox. An unreadable listing is empty, never a guess. */
export async function loadProjectFiles(
  bridge: IpcBridge,
  projectId: string,
): Promise<readonly ProjectFile[]> {
  const listing = (await bridge.invoke('list_project_files', { projectId })) as FilesListing | null;
  if (listing === null || listing.ok !== true || !Array.isArray(listing.files)) return [];
  return listing.files;
}

/**
 * Ask for a file and add it. NOTHING happens until the owner has chosen one: cancelling the picker
 * returns before any import call is made, so a cancel cannot mutate anything.
 */
export async function addProjectFile(
  bridge: IpcBridge,
  projectId: string,
  purpose: FilePurposeToken,
): Promise<AddOutcome> {
  const picked = (await bridge.invoke('pick_file', {
    title: 'Choose a file to add to this project',
  })) as string | null;
  if (picked === null || picked === undefined || picked === '') return { kind: 'CANCELLED' };

  const outcome = (await bridge.invoke('import_project_file', {
    projectId,
    sourcePath: picked,
    purpose,
  })) as ImportOutcome | null;

  if (outcome === null || outcome === undefined) {
    return { kind: 'REFUSED', message: 'The file could not be added. Nothing was changed.' };
  }
  if (outcome.ok && outcome.file_name !== null) {
    return { kind: 'ADDED', fileName: outcome.file_name, message: outcome.message };
  }
  return {
    kind: 'REFUSED',
    message: outcome.message || 'The file could not be added. Nothing was changed.',
  };
}
