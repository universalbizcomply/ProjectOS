/**
 * THE installed-project inventory, and the rules for selecting one.
 *
 * WHERE PROJECTS COME FROM. The Rust host reads the protected registry at
 * `<ProgramData>\ProjectOS\host\installation\projects.v1.json`, validates every entry against the
 * repository it names, and passes the survivors to the daemon as `--project-root <absolute>` — one
 * flag per project, plus one `--project-registry-status <token>` saying how the read went. This
 * module turns that argv into a validated inventory and decides what selection means.
 *
 * WHAT IT REFUSES, and there is no code path for any of it: a relative root, a root with traversal,
 * a root with no `.projectops/project-config.json`, a configuration that names a different project,
 * two roots claiming the same project id, and two ids claiming the same root. One bad entry does not
 * poison the whole inventory here — the host already refused the registry wholesale if the FILE was
 * inconsistent; what this catches is a repository that changed underneath a validated registry, and
 * the safe response to that is to drop the one project that changed, not to un-govern the others.
 *
 * WHAT SELECTION IS NOT. It is not authority. Selecting a project decides which project the surface
 * reads and which project a governed command runs against; it grants nothing, approves nothing and
 * closes nothing. The WebView submits an ID and only an ID: it can name one of these projects or
 * name nothing, and there is no field anywhere in this module through which it could submit a path.
 *
 * Pure by design. Every filesystem fact arrives as an INPUT, so the same functions run in the sidecar
 * (which does the I/O) and in tests (which supply it).
 *
 * Created in PROJECTOS-PHASE6-SECTION-C.
 */

/** The argv flag carrying one validated repository root. Must match the Rust host's constant. */
export const PROJECT_ROOT_FLAG = '--project-root';
/**
 * The argv flag carrying the registry-BOUND identity of the root that follows it. Must match the
 * Rust host's constant, and is always emitted immediately before its `--project-root`.
 */
export const PROJECT_ID_FLAG = '--project-id';
/** The argv flag carrying the registry status token. Must match the Rust host's constant. */
export const REGISTRY_STATUS_FLAG = '--project-registry-status';
/** The argv flag carrying the governed SYSTEM root. Pre-existing; a project root is NOT one of these. */
export const SYSTEM_ROOT_FLAG = '--root';

/** The transport message kind that carries the inventory to the owner surface. */
export const GOVERNED_PROJECTS_MESSAGE_KIND = 'governed-projects';

/** Where the selection is remembered, beneath the governed system root. */
export const SELECTION_FILE_NAME = 'selected-project.json';
/** The only selection-record version this build writes or reads. */
export const SELECTION_SCHEMA_VERSION = 1;

/** The CLOSED status vocabulary. Must match the Rust host's `RegistryStatus::token`. */
export const REGISTRY_STATUS_TOKENS = [
  'ok',
  'anchor-unresolved',
  'missing',
  'unreadable',
  'malformed',
  'invalid',
] as const;
export type RegistryStatusToken = (typeof REGISTRY_STATUS_TOKENS)[number];

/**
 * One project the host is willing to let this daemon govern.
 *
 * `boundProjectId` is the identity the PROTECTED REGISTRY bound this root to. It is `null` only in a
 * development run, where there is no registry and the root came from the authority-bound
 * `PROJECTOS_BRIDGE_CONFIG` instead.
 */
export interface SuppliedProject {
  readonly boundProjectId: string | null;
  readonly repositoryRoot: string;
}

/**
 * What the daemon was told on the command line.
 *
 * `registryStatus` is `null` when no token was supplied at all — which is how a DEVELOPMENT run
 * looks, because the development launch authority has no registry to read.
 */
export interface ProjectArgs {
  readonly systemRoots: readonly string[];
  readonly suppliedProjects: readonly SuppliedProject[];
  readonly registryStatus: RegistryStatusToken | null;
}

/** One project the owner may select. Carries no secret, no plan and no authority. */
export interface InventoryProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly repositoryRoot: string;
  /** The repository identity from the project's own configuration, for the owner to recognise. */
  readonly repository: string;
}

/** Why one supplied root did not become a selectable project. Closed vocabulary. */
export type InventoryRefusalCode =
  | 'NOT_ABSOLUTE'
  | 'TRAVERSAL'
  | 'NO_PROJECT_CONFIG'
  | 'MALFORMED_PROJECT_CONFIG'
  | 'UNSELECTABLE_PROJECT_ID'
  /**
   * The repository's own configuration no longer names the project the registry bound this root to.
   *
   * THIS IS THE ONE THAT MATTERS. Deriving identity from the repository alone means a repository can
   * rename itself — and a repository that renamed itself to a SIBLING project's id would take that
   * sibling's place in this inventory, so the owner's unchanged selection would silently start
   * resolving to the wrong tree. Comparing against the bound id makes a re-badged repository
   * disappear instead of impersonate.
   */
  | 'PROJECT_ID_MISMATCH'
  | 'DUPLICATE_PROJECT_ID'
  | 'DUPLICATE_ROOT';

export interface InventoryRefusal {
  readonly code: InventoryRefusalCode;
}

export interface ProjectInventory {
  readonly projects: readonly InventoryProject[];
  readonly refusals: readonly InventoryRefusal[];
  readonly registryStatus: RegistryStatusToken | null;
}

/**
 * Parse the daemon's own argv.
 *
 * A flag whose value is missing, or whose value is itself a flag, is DROPPED rather than allowed to
 * consume the next token: `--project-root --project-registry-status ok` must not register a project
 * called `--project-registry-status`.
 */
export function parseProjectArgs(argv: readonly string[]): ProjectArgs {
  const systemRoots: string[] = [];
  const suppliedProjects: SuppliedProject[] = [];
  let registryStatus: RegistryStatusToken | null = null;
  // The id most recently seen, consumed by the NEXT `--project-root`. It is cleared on use, so an id
  // can bind at most one root and a root can never inherit an id emitted for an earlier one.
  let pendingBoundId: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (
      flag !== SYSTEM_ROOT_FLAG &&
      flag !== PROJECT_ROOT_FLAG &&
      flag !== PROJECT_ID_FLAG &&
      flag !== REGISTRY_STATUS_FLAG
    ) {
      continue;
    }
    const value = argv[i + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      // A flag with no usable value consumes nothing — and clears any pending id, so the next root
      // cannot silently pick up an id that was meant for a root that never arrived.
      pendingBoundId = null;
      continue;
    }
    i += 1;
    if (flag === SYSTEM_ROOT_FLAG) systemRoots.push(value);
    else if (flag === PROJECT_ID_FLAG) pendingBoundId = value;
    else if (flag === PROJECT_ROOT_FLAG) {
      suppliedProjects.push({ boundProjectId: pendingBoundId, repositoryRoot: value });
      pendingBoundId = null;
    } else if ((REGISTRY_STATUS_TOKENS as readonly string[]).includes(value)) {
      registryStatus = value as RegistryStatusToken;
    }
  }
  return { systemRoots, suppliedProjects, registryStatus };
}

/**
 * The shape a project id must have to be SELECTABLE.
 *
 * Deliberately the same pattern the governed-command channel accepts (`governedCommands.ts`'s
 * `ID_PATTERN`) and the same one the Rust registry enforces. Three layers agreeing is what stops a
 * project appearing in the selector that no selection request could ever name.
 */
const SELECTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Absolute in the Windows sense the host uses, plus POSIX for the tests that run elsewhere. */
function isAbsoluteRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\') || root.startsWith('/');
}

function hasTraversal(root: string): boolean {
  return root.split(/[\\/]/).some((segment) => segment === '..');
}

/** Compare two roots the way Windows does: separators unified, trailing separator dropped, case-fold. */
export function normaliseRoot(root: string): string {
  return root.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * The project's own configuration, as the caller managed to read it. `null` means "no readable
 * configuration", which is a refusal rather than an empty project.
 */
export type ProjectConfigReader = (repositoryRoot: string) => Record<string, unknown> | null;

function readString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Build the inventory from the roots the host supplied.
 *
 * The project ID is taken from the repository's OWN configuration, never from argv. That is what
 * makes "project ID resolves only to its registered root" hold end to end: the host validated that
 * the registry's id matches the repository's, and this re-derives the id from the repository, so a
 * registry entry that was correct at launch and a repository that has since been re-badged produce a
 * DIFFERENT id — and the stale id then selects nothing.
 */
export function buildProjectInventory(
  supplied: readonly SuppliedProject[],
  readConfig: ProjectConfigReader,
  registryStatus: RegistryStatusToken | null = null,
): ProjectInventory {
  const projects: InventoryProject[] = [];
  const refusals: InventoryRefusal[] = [];
  const seenIds = new Set<string>();
  const seenRoots = new Set<string>();

  for (const { boundProjectId, repositoryRoot: root } of supplied) {
    if (!isAbsoluteRoot(root)) {
      refusals.push({ code: 'NOT_ABSOLUTE' });
      continue;
    }
    if (hasTraversal(root)) {
      refusals.push({ code: 'TRAVERSAL' });
      continue;
    }
    const key = normaliseRoot(root);
    if (seenRoots.has(key)) {
      refusals.push({ code: 'DUPLICATE_ROOT' });
      continue;
    }
    // Claimed as soon as the duplicate check passes, not after the rest of validation. Otherwise a
    // second occurrence of the same root would be evaluated afresh, and the "one root, one project"
    // invariant would quietly depend on the config reader returning the same answer twice.
    seenRoots.add(key);

    const config = readConfig(root);
    if (config === null) {
      refusals.push({ code: 'NO_PROJECT_CONFIG' });
      continue;
    }
    const projectId = readString(config, 'projectId');
    if (projectId === null) {
      refusals.push({ code: 'MALFORMED_PROJECT_CONFIG' });
      continue;
    }
    if (!SELECTABLE_ID.test(projectId)) {
      // Listing a project the selection channel would refuse to name is worse than not listing it:
      // it offers the owner a choice that can only ever fail.
      refusals.push({ code: 'UNSELECTABLE_PROJECT_ID' });
      continue;
    }
    // THE BINDING CHECK, mirroring the registry's own. A repository may not rename itself into a
    // different project — least of all into a sibling's.
    if (boundProjectId !== null && projectId !== boundProjectId) {
      refusals.push({ code: 'PROJECT_ID_MISMATCH' });
      continue;
    }
    if (seenIds.has(projectId)) {
      refusals.push({ code: 'DUPLICATE_PROJECT_ID' });
      continue;
    }
    seenIds.add(projectId);
    projects.push({
      projectId,
      projectName: readString(config, 'projectName') ?? projectId,
      repositoryRoot: root,
      repository: readString(config, 'repo') ?? 'none',
    });
  }
  return { projects, refusals, registryStatus };
}

/**
 * The inventory as the owner surface receives it.
 *
 * Built HERE rather than assembled by hand in the daemon, so the wire shape and the type the
 * renderer consumes come from one declaration. Two hand-written copies of a shape drift, and the day
 * they do, the surface renders a field nothing sends.
 */
export interface InventoryMessage {
  readonly projects: readonly InventoryProject[];
  readonly registryStatus: RegistryStatusToken | null;
  readonly refusedCount: number;
  readonly selectedProjectId: string | null;
}

export function toInventoryMessage(
  inventory: ProjectInventory,
  selectedProjectId: string | null,
): InventoryMessage {
  return {
    projects: inventory.projects,
    registryStatus: inventory.registryStatus,
    // A COUNT, never the reasons. The reasons name repositories, and the owner surface has no use
    // for a per-repository fault report it cannot act on.
    refusedCount: inventory.refusals.length,
    selectedProjectId,
  };
}

/**
 * Resolve a project id to its repository root, or `null`.
 *
 * The ONLY lookup in the system. Exact match, no normalisation of the id, no prefix match, no
 * nearest neighbour — an id that is not in the inventory resolves to nothing, which is what makes a
 * WebView-supplied string harmless.
 */
export function resolveProjectRoot(
  inventory: ProjectInventory,
  projectId: string,
): string | null {
  const found = inventory.projects.find((p) => p.projectId === projectId);
  return found === undefined ? null : found.repositoryRoot;
}

/** Why a selection was refused. Closed vocabulary; each maps to one owner-facing sentence. */
export type SelectionRefusalCode = 'UNKNOWN_PROJECT' | 'GOVERNED_WORK_ACTIVE';

export type SelectionOutcome =
  | { readonly ok: true; readonly projectId: string; readonly repositoryRoot: string }
  | { readonly ok: false; readonly code: SelectionRefusalCode; readonly detail: string };

/**
 * Decide a selection.
 *
 * REFUSES A SWITCH WHILE GOVERNED WORK IS ACTIVE. Re-selecting the project already selected is
 * always allowed — it changes nothing — but moving away from a project with a phase in flight is
 * refused, because the surface's plan, state, worker context and evidence would all change
 * underneath work that is still open.
 */
export function decideSelection(
  inventory: ProjectInventory,
  requestedProjectId: string,
  currentProjectId: string | null,
  governedWorkActive: boolean,
): SelectionOutcome {
  const root = resolveProjectRoot(inventory, requestedProjectId);
  if (root === null) {
    return {
      ok: false,
      code: 'UNKNOWN_PROJECT',
      detail:
        'That project is not one of the installed projects this ProjectOS may govern, so nothing was selected.',
    };
  }
  if (currentProjectId === requestedProjectId) {
    return { ok: true, projectId: requestedProjectId, repositoryRoot: root };
  }
  if (governedWorkActive) {
    return {
      ok: false,
      code: 'GOVERNED_WORK_ACTIVE',
      detail:
        'A phase is open in the current project. Finish or stop it before switching, so no governed work is left behind a changed view.',
    };
  }
  return { ok: true, projectId: requestedProjectId, repositoryRoot: root };
}

/**
 * The project the surface should show when nothing has been chosen yet.
 *
 * SINGLE-PROJECT BEHAVIOUR IS PRESERVED: with exactly one installed project there is nothing to
 * choose, so it is selected and the owner never sees a selector asking a question with one answer.
 * With two or more, nothing is auto-selected — picking one for the owner would be the surface
 * deciding which project their next action lands in.
 */
export function defaultSelection(inventory: ProjectInventory): string | null {
  const only = inventory.projects.length === 1 ? inventory.projects[0] : undefined;
  return only === undefined ? null : only.projectId;
}

/** The persisted selection record. Deliberately one field: an id, and the version that names it. */
export interface SelectionRecord {
  readonly schemaVersion: number;
  readonly projectId: string;
}

/** Serialise the selection. */
export function serialiseSelection(projectId: string): string {
  const record: SelectionRecord = {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    projectId,
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * Parse a persisted selection and CHECK IT AGAINST THE INVENTORY.
 *
 * A remembered id is not authority: it is re-resolved against the projects this run was actually
 * given, so a project that has been unregistered, renamed or broken since the last run restores to
 * nothing rather than to a stale root.
 */
export function restoreSelection(
  text: string | null,
  inventory: ProjectInventory,
): string | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record['schemaVersion'] !== SELECTION_SCHEMA_VERSION) return null;
  const projectId = record['projectId'];
  if (typeof projectId !== 'string' || projectId.length === 0) return null;
  return resolveProjectRoot(inventory, projectId) === null ? null : projectId;
}
