/**
 * The one canonical action registry: how dangerous an action is, and where it runs (ADR-K1 §1).
 *
 * THE CLASS IS LOOKED UP, NEVER SAID. A caller names an action and gets back the class and the
 * environment the committed registry records for it. There is no parameter through which a caller
 * could state either, so a label cannot under-declare (ADR-K1 F1, R2, R6).
 *
 * TWO VOCABULARIES, ONE REGISTRY, NEITHER CHANGED. `GovernanceAction` (`permissions.ts`) and the
 * owner-only names (`ownerOnlyActions.ts`) both stay exactly as they are. This module READS them, so
 * a spelling added to either one without a registry entry refuses the whole file instead of quietly
 * defaulting.
 *
 * R5, AN UNREGISTERED ACTION IS P5. Near misses count: `resolveAction` trims nothing and folds no
 * case, so `Commit` is unregistered and protected rather than a synonym for the P3 action. It also
 * reports the strictest environment, so nothing downstream can read an unknown action as local.
 *
 * A CLASS CANNOT BE LOWERED BY EDITING THE FILE EITHER. The floors below are in code: an owner-only
 * spelling written down as P1 refuses the file, so R6 does not rest on a reviewer reading the diff.
 *
 * NO I/O. The kernel reads the committed bytes; this module judges what it is handed.
 */
import { ALWAYS_OWNER_ONLY, isAbsolutelyOwnerOnly } from './ownerOnlyActions.js';
import { actionsFor, isOwnerOnly, type GovernanceAction } from './permissions.js';

export const ACTION_REGISTRY_SCHEMA_VERSION = '1.0.0';
export const ACTION_REGISTRY_POLICY = 'action-registry';

/** Lowest to highest. The order is what `classAtMost` compares. */
export const ACTION_CLASSES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const KERNEL_ENVIRONMENTS = ['local', 'staging', 'production'] as const;
export type KernelEnvironment = (typeof KERNEL_ENVIRONMENTS)[number];

/** R5. */
export const UNREGISTERED_ACTION_CLASS: ActionClass = 'P5';
export const UNREGISTERED_ACTION_ENVIRONMENT: KernelEnvironment = 'production';

/** The boundary's own actions. A registry that lost one would hide what it is. */
export const RESERVED_P5_ACTIONS = ['cross-tenant-access', 'tenant-registry-change', 'action-registry-change'] as const;

/**
 * The Stage 2 boundary crossings, each with the floor ADR-K1 gives it. Each is a ROOT envelope, never a
 * child (ADR-T1 §8). Those that act on a run's behalf are in `RUN_LINKED_ACTIONS`.
 */
const BOUNDARY_FLOORS: readonly (readonly [string, ActionClass])[] = [
  ['run-start', 'P2'],
  ['credential-release', 'P5'],
  ['broker-call', 'P3'],
  ['project-selection', 'P1'],
  ['bridge-read', 'P1'],
];
export const BOUNDARY_ACTIONS: readonly string[] = BOUNDARY_FLOORS.map(([action]) => action);

/**
 * Actions that must be tied to a run: the door admits them only from `mintCrossing`, which derives the
 * link itself. `run-start`, `project-selection` and `bridge-read` are plain roots.
 */
export const RUN_LINKED_ACTIONS = ['credential-release', 'broker-call', 'commit', 'push'] as const;

/** Actions that spend. ADR-K1 §2: a missing budget on one of these is a refusal, and zero is missing. */
export const PAID_ACTIONS = ['broker-call'] as const;

/** The conditionally delegable owner-only actions are P3; the ADR's §4 gives them a technical grant. */
const OWNER_ONLY_FLOOR: ActionClass = 'P3';

const ACTION_ID = /^[a-z][a-z0-9_-]{1,63}$/;
const WILDCARD = /[*?]/;

const PROSE_FIELDS = ['note', 'authority', 'authorisedBy', 'provenance', 'trustBasis'];
const HEADER_FIELDS = ['schemaVersion', 'policy', ...PROSE_FIELDS, 'actions'];
const ENTRY_FIELDS = ['id', 'governanceAction', 'ownerOnlyAction', 'class', 'environment', 'note'];

export type ActionRegistryCode =
  | 'ACTION_REGISTRY_INVALID'
  | 'ACTION_REGISTRY_WILDCARD'
  | 'ACTION_REGISTRY_DUPLICATE'
  | 'ACTION_REGISTRY_VOCABULARY'
  | 'ACTION_REGISTRY_CLASS_LOWERED';

export interface ActionRegistryProblem {
  readonly code: ActionRegistryCode;
  readonly message: string;
}

export interface ActionEntry {
  readonly id: string;
  readonly governanceAction: string | null;
  readonly ownerOnlyAction: string | null;
  readonly actionClass: ActionClass;
  readonly environment: KernelEnvironment;
}

export interface ActionRegistry {
  readonly actions: readonly ActionEntry[];
}

export type ActionRegistryResult =
  | { readonly ok: true; readonly registry: ActionRegistry }
  | { readonly ok: false; readonly problems: readonly ActionRegistryProblem[] };

export interface ResolvedAction {
  readonly action: string;
  readonly registered: boolean;
  readonly actionClass: ActionClass;
  readonly environment: KernelEnvironment;
}

/**
 * Every spelling of every entry of a validated registry, in a `Map`. A plain object would answer
 * `constructor` and `__proto__` with something truthy; a `Map` answers only what was put in it. Held
 * here rather than on the registry value, so being validated cannot be copied by copying fields.
 */
const LIVE_REGISTRIES = new WeakMap<ActionRegistry, ReadonlyMap<string, ActionEntry>>();

/** Is `child` no more dangerous than `parent`? An unknown class is not. */
export function classAtMost(child: string, parent: string): boolean {
  const childAt = (ACTION_CLASSES as readonly string[]).indexOf(child);
  const parentAt = (ACTION_CLASSES as readonly string[]).indexOf(parent);
  return childAt >= 0 && parentAt >= 0 && childAt <= parentAt;
}

/** Is this a boundary crossing, and so a root envelope? */
export function isBoundaryAction(action: string): boolean {
  return BOUNDARY_ACTIONS.includes(action);
}

/** Must this action come from `mintCrossing`? */
export function isRunLinkedAction(action: string): boolean {
  return (RUN_LINKED_ACTIONS as readonly string[]).includes(action);
}

/** Could this be an action at all? It goes into a record, so it is one plain word, registered or not. */
export function isActionName(value: unknown): value is string {
  return typeof value === 'string' && ACTION_ID.test(value);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function invalid(message: string): ActionRegistryProblem {
  return { code: 'ACTION_REGISTRY_INVALID', message };
}

function isSpelling(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function spellingsOf(record: Readonly<Record<string, unknown>>): readonly string[] {
  return [record['id'], record['governanceAction'], record['ownerOnlyAction']].filter((value): value is string => typeof value === 'string');
}

function entryProblems(entry: unknown, index: number): readonly ActionRegistryProblem[] {
  const label = `actions[${index}]`;
  const record = asRecord(entry);
  if (record === null) return [invalid(`${label} is not an object`)];
  const problems: ActionRegistryProblem[] = Object.keys(record)
    .filter((key) => !ENTRY_FIELDS.includes(key))
    .map((key) => invalid(`${label} carries an unknown field '${key}'`));
  if (!isSpelling(record['governanceAction']) || !isSpelling(record['ownerOnlyAction'])) {
    problems.push(invalid(`${label} must name governanceAction and ownerOnlyAction, each a spelling or null`));
  }
  if (typeof record['id'] !== 'string') problems.push(invalid(`${label} has no id`));
  for (const spelling of spellingsOf(record)) {
    if (WILDCARD.test(spelling)) {
      problems.push({ code: 'ACTION_REGISTRY_WILDCARD', message: `${label} has the wildcard spelling '${spelling}'` });
    } else if (!ACTION_ID.test(spelling)) {
      problems.push(invalid(`${label} has the invalid spelling '${spelling}'`));
    }
  }
  if (!(ACTION_CLASSES as readonly unknown[]).includes(record['class'])) problems.push(invalid(`${label} has no valid class`));
  if (!(KERNEL_ENVIRONMENTS as readonly unknown[]).includes(record['environment'])) problems.push(invalid(`${label} has no valid environment`));
  return problems;
}

/** One spelling must mean one action. A second entry for it would be a second answer to its class. */
function duplicateProblems(records: readonly Readonly<Record<string, unknown>>[]): readonly ActionRegistryProblem[] {
  const spellings = records.flatMap((record) => [...new Set(spellingsOf(record))]);
  return spellings
    .filter((spelling, index) => spellings.indexOf(spelling) !== index)
    .map((spelling) => ({ code: 'ACTION_REGISTRY_DUPLICATE' as const, message: `the spelling '${spelling}' appears in more than one entry` }));
}

/** Both vocabularies, complete, with nothing invented under either column. */
function vocabularyProblems(records: readonly Readonly<Record<string, unknown>>[]): readonly ActionRegistryProblem[] {
  const vocabulary = (column: string, known: readonly string[], source: string): readonly ActionRegistryProblem[] => {
    const named = records.flatMap((record) => {
      const value = record[column];
      return typeof value === 'string' ? [value] : [];
    });
    return [
      ...known.filter((spelling) => !named.includes(spelling)),
      ...named.filter((spelling) => !known.includes(spelling)),
    ].map((spelling) => ({
      code: 'ACTION_REGISTRY_VOCABULARY' as const,
      message: `${column} and ${source} disagree about '${spelling}'; the registry must name that vocabulary exactly`,
    }));
  };
  const ids = records.flatMap((record) => spellingsOf(record));
  return [
    ...vocabulary('governanceAction', actionsFor('owner'), 'permissions.ts'),
    ...vocabulary('ownerOnlyAction', ALWAYS_OWNER_ONLY, 'ownerOnlyActions.ts'),
    ...[...RESERVED_P5_ACTIONS, ...BOUNDARY_ACTIONS].filter((action) => !ids.includes(action)).map((action) => ({
      code: 'ACTION_REGISTRY_VOCABULARY' as const,
      message: `the reserved action '${action}' is missing`,
    })),
  ];
}

/** The lowest class this entry's spellings allow. R6: only ever a floor, and only ever in code. */
function floorProblems(record: Readonly<Record<string, unknown>>): readonly ActionRegistryProblem[] {
  const spellings = spellingsOf(record);
  const declared = String(record['class']);
  const lowered = (floor: ActionClass, why: string): readonly ActionRegistryProblem[] =>
    classAtMost(floor, declared) ? [] : [{ code: 'ACTION_REGISTRY_CLASS_LOWERED', message: `'${String(record['id'])}' is ${declared}, below ${floor}: ${why}` }];
  return [
    ...(spellings.some(isAbsolutelyOwnerOnly) ? lowered('P5', 'it is absolutely owner-only') : []),
    ...(spellings.some((spelling) => isOwnerOnly(spelling as GovernanceAction)) ? lowered('P5', 'it is an owner-only governance action') : []),
    ...(spellings.some((spelling) => (ALWAYS_OWNER_ONLY as readonly string[]).includes(spelling)) ? lowered(OWNER_ONLY_FLOOR, 'it is on the owner floor') : []),
    ...(spellings.some((spelling) => (RESERVED_P5_ACTIONS as readonly string[]).includes(spelling)) && declared !== 'P5'
      ? [{ code: 'ACTION_REGISTRY_CLASS_LOWERED' as const, message: `'${String(record['id'])}' is ${declared}; the tenant boundary's actions are exactly P5` }]
      : []),
    ...BOUNDARY_FLOORS.filter(([action]) => spellings.includes(action)).flatMap(([, floor]) => lowered(floor, 'it is a boundary action')),
  ];
}

/** Judge the whole file. Any problem refuses all of it, so a bad line never leaves good lines live. */
export function parseActionRegistry(raw: unknown): ActionRegistryResult {
  const root = asRecord(raw);
  if (root === null) return { ok: false, problems: [invalid('the action registry is not an object')] };
  const actions = Array.isArray(root['actions']) ? (root['actions'] as readonly unknown[]) : [];
  const records = actions.flatMap((entry) => {
    const record = asRecord(entry);
    return record === null ? [] : [record];
  });
  const problems: readonly ActionRegistryProblem[] = [
    ...Object.keys(root)
      .filter((key) => !HEADER_FIELDS.includes(key))
      .map((key) => invalid(`the action registry carries an unknown field '${key}'`)),
    ...(root['schemaVersion'] === ACTION_REGISTRY_SCHEMA_VERSION ? [] : [invalid(`the action registry has schemaVersion ${JSON.stringify(root['schemaVersion'])}`)]),
    ...(root['policy'] === ACTION_REGISTRY_POLICY ? [] : [invalid(`the action registry has policy ${JSON.stringify(root['policy'])}`)]),
    ...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map((field) => invalid(`the action registry has no ${field}`)),
    ...actions.flatMap((entry, index) => entryProblems(entry, index)),
    ...duplicateProblems(records),
    ...vocabularyProblems(records),
    ...records.flatMap(floorProblems),
  ];
  if (problems.length > 0) return { ok: false, problems };

  const entries: readonly ActionEntry[] = Object.freeze(
    records.map((record) =>
      Object.freeze({
        id: record['id'] as string,
        governanceAction: record['governanceAction'] as string | null,
        ownerOnlyAction: record['ownerOnlyAction'] as string | null,
        actionClass: record['class'] as ActionClass,
        environment: record['environment'] as KernelEnvironment,
      }),
    ),
  );
  const registry: ActionRegistry = Object.freeze({ actions: entries });
  LIVE_REGISTRIES.set(registry, new Map(entries.flatMap((entry) => spellingsOf({ ...entry }).map((spelling) => [spelling, entry] as const))));
  return { ok: true, registry };
}

/**
 * The class and environment of an action, by any of its spellings.
 *
 * R5: anything else, including a registry that did not pass `parseActionRegistry`, is P5.
 */
export function resolveAction(registry: ActionRegistry, action: string): ResolvedAction {
  const entry = LIVE_REGISTRIES.get(registry)?.get(action);
  return entry === undefined
    ? { action, registered: false, actionClass: UNREGISTERED_ACTION_CLASS, environment: UNREGISTERED_ACTION_ENVIRONMENT }
    : { action, registered: true, actionClass: entry.actionClass, environment: entry.environment };
}
