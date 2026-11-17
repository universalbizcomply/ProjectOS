// Origin: original ProjectOS code
/**
 * The role registry (PROJECTOS-PROVIDER-ROLES1A, plan 4.2 first slice): which already-authorised worker, or the
 * committed gatekeeper route, fills each role, with its capabilities from a closed list and its cost class.
 *
 * SELECTION AND RECORDING ONLY. Nothing here chooses a worker for a run, opens a connection, reads a credential or
 * decides a price. The registry NAMES what the project has already authorised; it authorises nothing. A registry
 * that parses is not thereby approved, and the result carries no field that could say so.
 *
 * PURE. It takes the known worker ids, the known gatekeeper transport id and the known rate cards as plain
 * arguments, does no I/O, and reads each field of its input once into a frozen plain snapshot. An accessor, a class
 * instance, a symbol key or an unknown key is refused, so a hostile object cannot answer differently the second
 * time it is asked.
 *
 * A refusal is a value: a machine code, a plain reason and a plain next step. The reason names a field, never a
 * value the field held, so a refused credential is not copied into a report.
 */

import { rateCardProblems, type RateCard } from '../gatekeeperCostLedger.js';

export const ROLE_IDS = ['implementer', 'reviewer', 'gatekeeper'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** What the roles actually do, and nothing else. A new capability is a deliberate change here and in the validator. */
export const ROLE_CAPABILITIES = ['implement', 'review', 'gatekeeper-review', 'plan-authoring', 'closure-question'] as const;
export type RoleCapability = (typeof ROLE_CAPABILITIES)[number];

export const COST_CLASSES = ['unmetered', 'metered'] as const;
export type CostClass = (typeof COST_CLASSES)[number];

export const ROLE_REGISTRY_SCHEMA = 1;
export const MAX_ROLE_REGISTRY_BYTES = 16384;
export const MAX_ROLE_NOTES = 400;
export const MAX_ROLE_REFUSALS = 20;

export type RoleRefusalCode =
  | 'TOO_LARGE'
  | 'NOT_JSON'
  | 'NOT_A_RECORD'
  | 'ACCESSOR'
  | 'UNSUPPORTED_SCHEMA'
  | 'NO_ROLES'
  | 'UNKNOWN_ROLE'
  | 'UNKNOWN_FIELD'
  | 'CREDENTIAL_FIELD'
  | 'UNKNOWN_WORKER'
  | 'UNKNOWN_TRANSPORT'
  | 'UNKNOWN_CAPABILITY'
  | 'BAD_CAPABILITIES'
  | 'BAD_COST'
  | 'UNKNOWN_MODEL'
  | 'ZERO_PRICE'
  | 'BAD_NOTES'
  | 'SAME_WORKER'
  | 'BAD_SOURCES'
  | 'NOT_COMMITTED';

export interface RoleRefusal {
  readonly code: RoleRefusalCode;
  readonly field: string;
  readonly reason: string;
  readonly next: string;
}

export type RoleCost = { readonly class: 'unmetered' } | { readonly class: 'metered'; readonly model: string };

export interface RoleEntry {
  readonly role: RoleId;
  /** Set for the implementer and the reviewer: a worker id from the committed `execution.workers`. */
  readonly workerId?: string;
  /** Set for the gatekeeper: the committed gatekeeper transport id. */
  readonly transportId?: string;
  readonly capabilities: readonly RoleCapability[];
  readonly cost: RoleCost;
  readonly notes: string;
}

export interface RoleRegistry {
  readonly schema: 1;
  /** In `ROLE_IDS` order. */
  readonly roles: readonly RoleEntry[];
  get(role: string): RoleEntry | undefined;
}

export type RoleParse = { readonly ok: true; readonly registry: RoleRegistry } | { readonly ok: false; readonly refusals: readonly RoleRefusal[] };

/** What is already authorised, as plain values the caller read from the committed records. */
export interface KnownRoleSources {
  readonly workerIds: readonly string[];
  readonly gatekeeperTransportId: string | null;
  readonly rateCards: Readonly<Record<string, RateCard>>;
}

export type RoleStanding = 'assigned' | 'awaiting';

/** An entry and how it stands, never a verdict. A gatekeeper route is `awaiting`: a decision is not held in this registry. */
export interface RoleSelection {
  readonly role: RoleId;
  readonly entry: RoleEntry;
  readonly standing: RoleStanding;
}

/** A field whose name says it carries a secret or an address. Refused by name, whatever it holds. */
const CREDENTIAL_NAME = /key|secret|token|cred|passw|endpoint|url|uri|auth|header/i;
const LONG_ALNUM_RUN = /[A-Za-z0-9]{24}/;
const KEY_PREFIX = /(?:^|[^A-Za-z0-9])(?:sk-|ghp_|gho_|xox[abp]-|AKIA)/;
const URL_SHAPED = /:\/\/|www\./i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 64;

const WORKER_ROLE_KEYS = ['workerId', 'capabilities', 'cost', 'notes'];
const GATEKEEPER_ROLE_KEYS = ['transportId', 'capabilities', 'cost', 'notes'];
const TOP_KEYS = ['schema', 'roles'];
const COST_KEYS = ['class', 'model'];

const refusal = (code: RoleRefusalCode, field: string, reason: string, next: string): RoleRefusal => Object.freeze({ code, field, reason, next });

interface Snapshot {
  readonly value: unknown;
  readonly refusals: readonly RoleRefusal[];
}

const isCredentialName = (name: string): boolean => CREDENTIAL_NAME.test(name);
const safeName = (name: string): string => (/^[A-Za-z0-9_.-]{1,40}$/.test(name) ? name : '<unprintable name>');

/** Copy one value into a frozen plain structure, reading each property once. Returns the refusal when it is not plain. */
function snapshotOf(value: unknown, at: string, depth: number): Snapshot {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return { value, refusals: [] };
  if (typeof value !== 'object' || depth > MAX_DEPTH) {
    return { value: undefined, refusals: [refusal('NOT_A_RECORD', at, `${at} is not a plain value`, 'Write it as plain JSON text, numbers, lists and records only.')] };
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  const isArray = Array.isArray(value);
  if (proto !== null && proto !== Object.prototype && !(isArray && proto === Array.prototype)) {
    return { value: undefined, refusals: [refusal('NOT_A_RECORD', at, `${at} is not a plain record`, 'Write it as plain JSON, not as an object of another kind.')] };
  }
  const descriptors = Object.getOwnPropertyDescriptors(value as object);
  const names = Reflect.ownKeys(descriptors);
  if (names.length > MAX_ENTRIES) return { value: undefined, refusals: [refusal('TOO_LARGE', at, `${at} has more than ${MAX_ENTRIES} entries`, 'Remove entries the registry does not use.')] };
  const refusals: RoleRefusal[] = [];
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    const descriptor = descriptors[name as string] as PropertyDescriptor;
    if (typeof name === 'symbol') {
      refusals.push(refusal('NOT_A_RECORD', at, `${at} carries a symbol key`, 'Remove it: only plain text keys are read.'));
    } else if (descriptor.get !== undefined || descriptor.set !== undefined) {
      refusals.push(refusal('ACCESSOR', `${at}.${safeName(name)}`, `${at}.${safeName(name)} is computed, not stored`, 'Store the value itself; a computed field is never read.'));
    } else if (!(isArray && name === 'length')) {
      const inner = snapshotOf(descriptor.value, `${at}.${safeName(name)}`, depth + 1);
      refusals.push(...inner.refusals);
      copy[name] = inner.value;
    }
  }
  if (refusals.length > 0) return { value: undefined, refusals };
  if (isArray) return { value: Object.freeze((names.filter((n) => n !== 'length') as string[]).map((n) => copy[n])), refusals };
  return { value: Object.freeze(copy), refusals };
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;

/** Unknown and credential-shaped names are different refusals: the second one says what the name looks like. */
function nameProblems(record: Readonly<Record<string, unknown>>, allowed: readonly string[], at: string): RoleRefusal[] {
  return Object.keys(record)
    .filter((name) => !allowed.includes(name))
    .map((name) =>
      isCredentialName(name)
        ? refusal('CREDENTIAL_FIELD', `${at}.${safeName(name)}`, `${at} has a field named like a key, a credential or an address`, 'Remove it. A role names who does the work, never how to reach or sign in to them; those live in the credential and gatekeeper records.')
        : refusal('UNKNOWN_FIELD', `${at}.${safeName(name)}`, `${at} has a field this registry does not hold`, `Remove it; the registry holds only ${allowed.join(', ')} here.`),
    );
}

function capabilityProblems(raw: unknown, at: string): RoleRefusal[] {
  const list = Array.isArray(raw) ? (raw as readonly unknown[]) : null;
  if (list === null || list.length === 0 || list.length > ROLE_CAPABILITIES.length) {
    return [refusal('BAD_CAPABILITIES', `${at}.capabilities`, `${at}.capabilities is not a short non-empty list`, `List one or more of ${ROLE_CAPABILITIES.join(', ')}.`)];
  }
  const out: RoleRefusal[] = [];
  const outside = list.filter((item) => !(typeof item === 'string' && (ROLE_CAPABILITIES as readonly string[]).includes(item)));
  if (outside.length > 0) out.push(refusal('UNKNOWN_CAPABILITY', `${at}.capabilities`, `${at}.capabilities names ${outside.length} capability(ies) outside the closed list`, `Use only ${ROLE_CAPABILITIES.join(', ')}; a new one is a reviewed change to the registry code.`));
  if (new Set(list).size !== list.length) out.push(refusal('BAD_CAPABILITIES', `${at}.capabilities`, `${at}.capabilities repeats a capability`, 'List each capability once.'));
  return out;
}

function costProblems(raw: unknown, known: KnownRoleSources, at: string): RoleRefusal[] {
  const cost = asRecord(raw);
  const next = `Write cost as { "class": "unmetered" } or { "class": "metered", "model": "<a model in the committed gatekeeper rate cards>" }.`;
  if (cost === null) return [refusal('BAD_COST', `${at}.cost`, `${at}.cost is not a record`, next)];
  const problems = nameProblems(cost, COST_KEYS, `${at}.cost`);
  if (cost['class'] === 'unmetered') {
    return cost['model'] === undefined ? problems : [...problems, refusal('BAD_COST', `${at}.cost`, `${at}.cost is unmetered and names a model`, next)];
  }
  if (cost['class'] !== 'metered') return [...problems, refusal('BAD_COST', `${at}.cost.class`, `${at}.cost.class is not one of ${COST_CLASSES.join(', ')}`, next)];
  const model = cost['model'];
  if (typeof model !== 'string' || model === '') return [...problems, refusal('BAD_COST', `${at}.cost.model`, `${at}.cost is metered and names no model`, next)];
  const card = Object.prototype.hasOwnProperty.call(known.rateCards, model) ? known.rateCards[model] : undefined;
  if (card === undefined) return [...problems, refusal('UNKNOWN_MODEL', `${at}.cost.model`, `${at}.cost.model is not in the committed rate cards`, 'Name a model that .projectops/gatekeeper.json prices; this registry adds no price of its own.')];
  if (rateCardProblems(card).length > 0) return [...problems, refusal('ZERO_PRICE', `${at}.cost.model`, `${at}.cost.model has a rate card with a zero or unusable price`, 'Fix the committed rate card first; a model with no price is not metered, it is unknown.')];
  return problems;
}

function notesProblems(raw: unknown, at: string): RoleRefusal[] {
  const bad = (reason: string) => [refusal('BAD_NOTES', `${at}.notes`, `${at}.notes ${reason}`, 'Write a short plain sentence: no address, no key-shaped text, no control characters.')];
  if (typeof raw !== 'string') return bad('is not text');
  if (raw.length > MAX_ROLE_NOTES) return bad(`is longer than ${MAX_ROLE_NOTES} characters`);
  if (CONTROL_CHARS.test(raw)) return bad('carries a control character');
  if (URL_SHAPED.test(raw) || LONG_ALNUM_RUN.test(raw) || KEY_PREFIX.test(raw)) return bad('carries an address or key-shaped text');
  return [];
}

function routeProblems(role: RoleId, row: Readonly<Record<string, unknown>>, known: KnownRoleSources, at: string): RoleRefusal[] {
  if (role === 'gatekeeper') {
    const id = row['transportId'];
    const ok = typeof id === 'string' && known.gatekeeperTransportId !== null && id === known.gatekeeperTransportId;
    return ok ? [] : [refusal('UNKNOWN_TRANSPORT', `${at}.transportId`, `${at}.transportId is not the committed gatekeeper transport`, 'Name the transportId in .projectops/gatekeeper.json, or remove the gatekeeper role when no gatekeeper is committed.')];
  }
  const id = row['workerId'];
  const ok = typeof id === 'string' && known.workerIds.includes(id);
  return ok ? [] : [refusal('UNKNOWN_WORKER', `${at}.workerId`, `${at}.workerId is not a worker the project authorises`, 'Name a workerId in the committed execution.workers of .projectops/project-config.json.')];
}

interface RoleRead {
  readonly entry: RoleEntry | null;
  readonly refusals: readonly RoleRefusal[];
}

function readRole(role: RoleId, raw: unknown, known: KnownRoleSources): RoleRead {
  const at = `roles.${role}`;
  const row = asRecord(raw);
  if (row === null) return { entry: null, refusals: [refusal('NOT_A_RECORD', at, `${at} is not a record`, 'Write the role as a record with its route, capabilities, cost and notes.')] };
  const refusals = [
    ...nameProblems(row, role === 'gatekeeper' ? GATEKEEPER_ROLE_KEYS : WORKER_ROLE_KEYS, at),
    ...routeProblems(role, row, known, at),
    ...capabilityProblems(row['capabilities'], at),
    ...costProblems(row['cost'], known, at),
    ...notesProblems(row['notes'], at),
  ];
  if (refusals.length > 0) return { entry: null, refusals };
  const cost = row['cost'] as { class: CostClass; model?: string };
  const entry: RoleEntry = Object.freeze({
    role,
    ...(role === 'gatekeeper' ? { transportId: row['transportId'] as string } : { workerId: row['workerId'] as string }),
    capabilities: Object.freeze([...(row['capabilities'] as readonly RoleCapability[])]),
    cost: Object.freeze(cost.class === 'metered' ? { class: 'metered' as const, model: cost.model as string } : { class: 'unmetered' as const }),
    notes: row['notes'] as string,
  });
  return { entry, refusals };
}

function sourceProblems(known: KnownRoleSources): RoleRefusal[] {
  const ok =
    typeof known === 'object' &&
    known !== null &&
    Array.isArray(known.workerIds) &&
    known.workerIds.every((id) => typeof id === 'string') &&
    (known.gatekeeperTransportId === null || typeof known.gatekeeperTransportId === 'string') &&
    typeof known.rateCards === 'object' &&
    known.rateCards !== null;
  return ok ? [] : [refusal('BAD_SOURCES', 'known', 'what the project authorises could not be read', 'Fix the committed project-config and gatekeeper records first.')];
}

/** The worker both roles name, as written, so an unknown worker cannot hide the collision. */
function sharedWorker(roles: Readonly<Record<string, unknown>>): string | null {
  const idOf = (role: RoleId): unknown => asRecord(roles[role])?.['workerId'];
  const implementer = idOf('implementer');
  return typeof implementer === 'string' && implementer === idOf('reviewer') ? implementer : null;
}

function buildRegistry(entries: readonly RoleEntry[]): RoleRegistry {
  const roles = Object.freeze([...entries].sort((a, b) => ROLE_IDS.indexOf(a.role) - ROLE_IDS.indexOf(b.role)));
  return Object.freeze({
    schema: ROLE_REGISTRY_SCHEMA,
    roles,
    get: (role: string): RoleEntry | undefined => (typeof role === 'string' ? roles.find((entry) => entry.role === role) : undefined),
  });
}

/** Judge an already-parsed value against what the project authorises. Reads each field once; never throws. */
export function validateRoleRegistry(raw: unknown, known: KnownRoleSources): RoleParse {
  const bad = sourceProblems(known);
  if (bad.length > 0) return { ok: false, refusals: bad };
  const snap = snapshotOf(raw, 'registry', 0);
  if (snap.refusals.length > 0) return { ok: false, refusals: snap.refusals.slice(0, MAX_ROLE_REFUSALS) };
  const top = asRecord(snap.value);
  if (top === null) return { ok: false, refusals: [refusal('NOT_A_RECORD', 'registry', 'the registry is not a record', 'Write it as { "schema": 1, "roles": { ... } }.')] };
  const refusals: RoleRefusal[] = nameProblems(top, TOP_KEYS, 'registry');
  if (top['schema'] !== ROLE_REGISTRY_SCHEMA) refusals.push(refusal('UNSUPPORTED_SCHEMA', 'registry.schema', `registry.schema is not ${ROLE_REGISTRY_SCHEMA}`, `Set schema to ${ROLE_REGISTRY_SCHEMA}.`));
  const roles = asRecord(top['roles']);
  if (roles === null) return { ok: false, refusals: [...refusals, refusal('NOT_A_RECORD', 'registry.roles', 'registry.roles is not a record', 'Write roles as a record keyed by role.')].slice(0, MAX_ROLE_REFUSALS) };
  const names = Object.keys(roles);
  refusals.push(...names.filter((n) => !(ROLE_IDS as readonly string[]).includes(n)).map((n) =>
    isCredentialName(n)
      ? refusal('CREDENTIAL_FIELD', `roles.${safeName(n)}`, 'a role is named like a key, a credential or an address', 'Remove it; roles are implementer, reviewer and gatekeeper.')
      : refusal('UNKNOWN_ROLE', `roles.${safeName(n)}`, 'this role is not one the registry holds', `Roles are ${ROLE_IDS.join(', ')}.`)));
  if (names.length === 0) refusals.push(refusal('NO_ROLES', 'registry.roles', 'the registry names no role', 'Name at least the implementer.'));
  const read = ROLE_IDS.filter((role) => names.includes(role)).map((role) => readRole(role, roles[role], known));
  for (const one of read) refusals.push(...one.refusals);
  const entries = read.flatMap((one) => (one.entry === null ? [] : [one.entry]));
  const clash = sharedWorker(roles);
  if (clash !== null) refusals.push(refusal('SAME_WORKER', 'roles', `the implementer and the reviewer are both ${safeName(clash)}; a worker never reviews its own work`, 'Name a different worker for the reviewer.'));
  return refusals.length > 0 ? { ok: false, refusals: Object.freeze(refusals.slice(0, MAX_ROLE_REFUSALS)) } : { ok: true, registry: buildRegistry(entries) };
}

/** Judge registry text. The size is judged before anything is parsed. */
export function parseRoleRegistry(text: string, known: KnownRoleSources): RoleParse {
  if (typeof text !== 'string') return { ok: false, refusals: [refusal('NOT_JSON', 'registry', 'the registry is not text', 'Commit .projectops/provider-roles.json as JSON text.')] };
  if (text.length > MAX_ROLE_REGISTRY_BYTES || new TextEncoder().encode(text).length > MAX_ROLE_REGISTRY_BYTES) {
    return { ok: false, refusals: [refusal('TOO_LARGE', 'registry', `the registry is larger than ${MAX_ROLE_REGISTRY_BYTES} bytes`, 'Shorten it; three roles need far less.')] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, refusals: [refusal('NOT_JSON', 'registry', 'the registry text is not JSON', 'Fix the JSON in .projectops/provider-roles.json and commit it.')] };
  }
  return validateRoleRegistry(parsed, known);
}

/** An entry and how it stands, or nothing. Never a verdict: a gatekeeper role is `awaiting` because it is a route to a decision. */
export function selectForRole(registry: RoleRegistry, role: string): RoleSelection | null {
  if (typeof role !== 'string' || !(ROLE_IDS as readonly string[]).includes(role)) return null;
  const entry = registry.get(role);
  return entry === undefined ? null : Object.freeze({ role: entry.role, entry, standing: entry.role === 'gatekeeper' ? ('awaiting' as const) : ('assigned' as const) });
}
