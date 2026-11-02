/**
 * The connector contract: what every connector must declare, what stops one that has not qualified, and
 * what a connector hands back (owner decision D5, "Rules now, connectors later (Recommended)").
 *
 * ZERO LIVE CONNECTORS. This module is the rule; nothing calls a provider, no adapter exists, and
 * `projectos/connectors/registry.json` is empty. Stage 5 brings the first connector to these rules.
 *
 * THE WHOLE FILE, OR NOTHING, EXCEPT THE CLOCK. `parseConnectorRegistry` judges every entry before anything
 * can match, as the tenant and action registries do: a registry that contradicts itself has no trustworthy
 * line in it. Time is the one exception. A date that lapses overnight is not a contradiction, and letting it
 * refuse the file would have one tenant's overdue connector stop another tenant's working one, so
 * `connectorAcceptanceRefusal` is asked per connector at the gate. The blueprint says the same: a failed test
 * blocks the affected connector.
 *
 * A REFERENCE, NEVER A VALUE. `secretReference` names a credential in the store's five-segment format and is
 * held to the connector's own tenant. A value that looks like a credential is refused by name ahead of the
 * shape rule, and no refusal repeats it. This is a backstop and says so: a credential of no known shape,
 * short enough to pass as a segment, is not caught here. The real control is that the store holds the value.
 *
 * THE CLASS IS LOOKED UP, NEVER SAID. An action a connector names is read from the action registry. An
 * unregistered one is P5 (R5) and is refused here, at registration, and again at the gate, because the
 * registry can change after the connector was accepted.
 *
 * THE GATE TAKES ONLY WHAT WAS ADMITTED. `admitConnectorCall` wants a registry this module validated and an
 * envelope the door admitted, so a full-shape copy of either is refused. The tenant it compares comes from the
 * envelope, which only `resolveTenant`'s binding can fill: no argument here can name one. A connector of
 * another tenant, or another domain of the same tenant, is `CONNECTOR_CROSS_TENANT`. This is the one scenario
 * Stage 2 proves. The other eight need a real connector and are data until Stage 5.
 *
 * `outcome_unknown` IS STICKY. It means a write may have happened. A later failure says nothing about the
 * earlier attempt, so only an explicit reconciliation clears it, and that leaves a record naming what was
 * found, on what evidence, and by whom. The rule is keyed by the idempotency key and not by the connector,
 * so the same intent cannot be retried through a sibling connector. A reconciliation that finds the write
 * completed closes the key: it never runs again, under ADR-K1 §2's "the same effect never happens twice".
 *
 * THE RETRY RULE OF EVERY OTHER CODE:
 *
 *   rate_limited, upstream_unavailable  after backoff, same key. The provider said nothing happened.
 *   authentication_required             after the kernel says it re-authenticated, same key.
 *   approval_required                   after the kernel says an approval exists, same key.
 *   permission_denied, invalid_input    never under this key. It cannot succeed; a changed request is a
 *                                       new intent, so it gets a new key.
 *
 * `upstream_unavailable` means the provider was known not to have acted. A timeout during a write is not that:
 * it is `outcome_unknown`, and a connector that reports otherwise has broken its contract.
 *
 * WHAT THIS MODULE CANNOT PROVE. The history it judges is handed in, so an empty one looks like a first
 * attempt; the durable store and the task ledger are later work. `reauthenticated` and `approved` are the
 * kernel's word. A release record is a claim in a committed file: the gate holds it to its connector, version
 * and tenant, and cannot tell whether a listed scenario really ran. A key follows the intent the kernel states,
 * so a new `intentScope` is a new key. Backoff is timed by the caller. Refusals here reach the audit line only
 * if the caller passes them to `recordExecution`.
 *
 * NO I/O, no clock and no dependency: time, history and both registries are handed in. No input is mutated,
 * and everything returned is frozen.
 */
import { isActionName, resolveAction, type ActionRegistry } from './actionRegistry.js';
import { holdsSecretShape } from './context/redact.js';
import { envelopeExpired, recordExecution, type TaskEnvelope } from './taskEnvelope.js';
import { DOMAINS, isReservedProjectId, isTenantId, TENANT_CREDENTIAL_PREFIX, type Domain, type TenantRegistry } from './tenant.js';

export const CONNECTOR_REGISTRY_SCHEMA_VERSION = '1.0.0';
export const CONNECTOR_REGISTRY_POLICY = 'connector-registry';

/**
 * How long a passing acceptance holds, in days. Provider permissions and terms drift without telling anyone,
 * so a pass is good for a quarter. An implementer's reading, for the lead to challenge.
 */
export const CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Attempts under one key, the first included. The blueprint asks for bounded retries and names no number. */
export const CONNECTOR_MAX_ATTEMPTS = 5;

/** A closed set: an unknown code is refused and is never mapped onto one of these. */
export const CONNECTOR_ERROR_CODES = [
  'authentication_required',
  'permission_denied',
  'rate_limited',
  'invalid_input',
  'approval_required',
  'upstream_unavailable',
  'outcome_unknown',
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

export type ConnectorRetryRule = 'after-backoff' | 'after-reauthentication' | 'after-approval' | 'after-reconciliation' | 'never';

/** One rule per code, and the compiler refuses a code without one. */
export const CONNECTOR_RETRY_RULES: Readonly<Record<ConnectorErrorCode, ConnectorRetryRule>> = Object.freeze({
  authentication_required: 'after-reauthentication',
  permission_denied: 'never',
  rate_limited: 'after-backoff',
  invalid_input: 'never',
  approval_required: 'after-approval',
  upstream_unavailable: 'after-backoff',
  outcome_unknown: 'after-reconciliation',
});

/** `unknown` is its own outcome, so a connector can say so instead of claiming failure or success. */
export const CONNECTOR_OUTCOMES = ['succeeded', 'failed', 'unknown'] as const;
export type ConnectorOutcome = (typeof CONNECTOR_OUTCOMES)[number];

export const CONNECTOR_IDEMPOTENCY = ['provider-key', 'reconcile-first', 'read-only'] as const;
export type ConnectorIdempotency = (typeof CONNECTOR_IDEMPOTENCY)[number];

export const RECONCILIATION_FINDINGS = ['completed', 'not_completed'] as const;
export type ReconciliationFinding = (typeof RECONCILIATION_FINDINGS)[number];

/** The blueprint's connector release checklist (§13), item by item. */
export const RELEASE_CHECKLIST = [
  'provider-identity',
  'actions-and-scopes-documented',
  'authentication-and-revocation',
  'tenant-and-resource-bound',
  'read-and-write-verified',
  'denied-actions-fail',
  'rate-limits-and-retries',
  'provider-receipts',
  'audit-logs',
  'operational-owner',
] as const;

export const SCENARIO_STATUSES = ['proved', 'defined'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export interface AcceptanceScenario {
  readonly id: string;
  /** What is done to the connector. */
  readonly given: string;
  /** What must hold. A failure blocks the connector or action class; it never quietly reduces protection. */
  readonly expect: string;
  /** `proved` has a proof that runs today. `defined` is a definition and is never a pass. */
  readonly status: ScenarioStatus;
  readonly firstRun: 'stage-2' | 'stage-5';
  readonly proof: string | null;
}

const defined = (id: string, given: string, expect: string): AcceptanceScenario =>
  Object.freeze({ id, given, expect, status: 'defined', firstRun: 'stage-5', proof: null });

/** The blueprint's required acceptance scenarios (§10), in its order. */
export const ACCEPTANCE_SCENARIOS: readonly AcceptanceScenario[] = Object.freeze([
  Object.freeze({
    id: 'cross-tenant-denial',
    given: 'Work bound to one tenant calls a connector of another tenant.',
    expect: 'Refused as CONNECTOR_CROSS_TENANT in both directions, and the same-tenant pair is admitted.',
    status: 'proved',
    firstRun: 'stage-2',
    proof: 'projectos/core/test/connector-contract.test.ts',
  }),
  defined('duplicate-webhook-delivery', 'The provider delivers the same event twice.', 'The second delivery causes no second effect: the same key returns the earlier outcome.'),
  defined('expired-approval', 'A call is presented under an approval that has lapsed.', 'Refused when the action would run, and nothing is sent.'),
  defined('token-revocation', 'The credential is revoked at the provider while the connector is in use.', 'The connector returns authentication_required and nothing is retried until re-authentication.'),
  defined('prompt-injection-in-retrieved-content', 'Content read through the connector carries instructions.', 'It stays data: no action, scope or tenant changes because of it.'),
  defined('process-crash-after-write', 'The process dies after the provider accepted a write and before the receipt.', 'The attempt is outcome_unknown, and no retry runs until it is reconciled.'),
  defined('cancellation', 'The owner cancels work in flight.', 'No new connector call starts, and an in-flight call reports how it ended.'),
  defined('missing-evidence', 'A call finishes with no provider receipt.', 'The work does not count as succeeded.'),
  defined('provider-outage', 'The provider is unavailable.', 'The connector returns upstream_unavailable, retries are bounded, and protection is not reduced to keep working.'),
]);

/** What is proved and what is only defined. There is no third count: a defined scenario has not passed. */
export function scenarioTally(): { readonly total: number; readonly proved: number; readonly defined: number } {
  const count = (status: ScenarioStatus): number => ACCEPTANCE_SCENARIOS.filter((scenario) => scenario.status === status).length;
  return { total: ACCEPTANCE_SCENARIOS.length, proved: count('proved'), defined: count('defined') };
}

const CONNECTOR_ID = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
/** Room for an OAuth scope such as a URL or `chat:write`, and for nothing that would need a space. */
const SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const DATA_CATEGORY = /^[a-z][a-z0-9-]{1,63}$/;
/** `ProjectOS/<project>/<environment>/<provider>/<credential>`, the format `credentials/reference.cjs` owns. */
const SECRET_REFERENCE = /^ProjectOS\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/(?:development|staging|production)\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A credential name is hyphenated words. A run this long with no separator is a value. */
const RAW_CREDENTIAL_RUN = /[A-Za-z0-9]{24,}/;
/** A pointer to evidence, never the evidence: no room for a sentence or a payload. */
const EVIDENCE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;
const RECONCILER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** As `taskEnvelope` writes it. */
const IDEMPOTENCY_KEY = /^sha256:[0-9a-f]{64}$/;
/** `*` and `?` mean "more than one thing", which a declaration may never mean. */
const WILDCARD = /[*?]/;
const READ_ONLY_CLASS = 'P1';

/** A record that cannot say who authorised it, and why it is trusted, is not one. */
const PROSE_FIELDS = ['note', 'authority', 'authorisedBy', 'provenance', 'trustBasis'];
const HEADER_FIELDS = ['schemaVersion', 'policy', ...PROSE_FIELDS, 'connectors'];
const ENTRY_FIELDS = ['connectorId', 'version', 'tenant', 'domain', 'scopes', 'secretReference', 'dataCategories', 'idempotency', 'actions', 'lastAcceptanceDate', 'releaseRecord'];
const RELEASE_FIELDS = ['connectorId', 'version', 'tenant', 'result', 'acceptedAt', 'checklist', 'scenarios', 'evidence'];
const RELEASE_BOUND_FIELDS = ['connectorId', 'version', 'tenant'] as const;
const RECEIPT_FIELDS = ['tenant', 'connector', 'action', 'idempotencyKey', 'outcome', 'errorCode'] as const;
const RECONCILIATION_FIELDS = ['tenant', 'connector', 'action', 'idempotencyKey', 'finding', 'evidence', 'reconciledBy', 'reconciledAt'];

export type ConnectorRegistryCode =
  | 'CONNECTOR_REGISTRY_INVALID'
  | 'CONNECTOR_REGISTRY_WILDCARD'
  | 'CONNECTOR_REGISTRY_DUPLICATE'
  | 'CONNECTOR_TENANT_MISSING'
  | 'CONNECTOR_TENANT_UNKNOWN'
  | 'CONNECTOR_SECRET_MISSING'
  | 'CONNECTOR_SECRET_VALUE'
  | 'CONNECTOR_SECRET_REFERENCE_INVALID'
  | 'CONNECTOR_SECRET_WRONG_TENANT'
  | 'CONNECTOR_RELEASE_MISSING'
  | 'CONNECTOR_RELEASE_NOT_PASSED'
  | 'CONNECTOR_RELEASE_MISMATCH'
  | 'CONNECTOR_ACTION_UNREGISTERED'
  | 'CONNECTOR_IDEMPOTENCY_MISMATCH';

export interface ConnectorProblem {
  readonly code: ConnectorRegistryCode;
  readonly message: string;
}

export interface ConnectorReleaseRecord {
  readonly connectorId: string;
  readonly version: string;
  readonly tenant: string;
  readonly result: 'passed';
  readonly acceptedAt: string;
  readonly checklist: readonly string[];
  readonly scenarios: readonly string[];
  readonly evidence: string;
}

export interface ConnectorEntry {
  readonly connectorId: string;
  readonly version: string;
  readonly tenant: string;
  readonly domain: Domain;
  readonly scopes: readonly string[];
  readonly secretReference: string;
  readonly dataCategories: readonly string[];
  readonly idempotency: ConnectorIdempotency;
  readonly actions: readonly string[];
  readonly lastAcceptanceDate: string;
  readonly releaseRecord: ConnectorReleaseRecord;
}

export interface ConnectorRegistry {
  readonly connectors: readonly ConnectorEntry[];
}

export type ConnectorRegistryResult =
  | { readonly ok: true; readonly registry: ConnectorRegistry }
  | { readonly ok: false; readonly problems: readonly ConnectorProblem[] };

/** The two registries a connector is judged against, both already validated by the kernel. */
export interface ConnectorContext {
  readonly actions: ActionRegistry;
  readonly tenants: TenantRegistry;
}

/** Registries that passed whole-file validation. Nothing else reaches the gate. */
const LIVE_REGISTRIES = new WeakSet<object>();
/** Calls the gate admitted. Nothing else can vouch for a receipt. */
const LIVE_CALLS = new WeakSet<object>();

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function invalid(message: string): ConnectorProblem {
  return { code: 'CONNECTOR_REGISTRY_INVALID', message };
}

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value);
}

/**
 * The instant, or `null`. `Date.parse` alone accepts `2026` and rolls 31 February into March, so the text must
 * be exactly what the parsed instant prints back as, the same rule `taskEnvelope` applies to `expiry`.
 */
function instantOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) || new Date(at).toISOString() !== value ? null : at;
}

function unknownFieldProblems(record: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): readonly ConnectorProblem[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => invalid(`${label} carries an unknown field '${key}'`));
}

/** Holes in an array read as `undefined` here, and a plain `every` would skip them. */
function itemsOf(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? [...(value as readonly unknown[])] : null;
}

function textsOf(value: unknown): readonly string[] {
  return (itemsOf(value) ?? []).filter((item): item is string => typeof item === 'string');
}

/** Exactly these, each once: the length rules out a repeat, and with it an invented item. */
function isExactly(value: unknown, required: readonly string[]): boolean {
  const items = itemsOf(value);
  return items !== null && items.length === required.length && required.every((item) => items.includes(item));
}

function isEvidence(value: unknown): value is string {
  return matches(EVIDENCE, value) && !holdsSecretShape(value);
}

function connectorIdProblems(value: unknown, label: string): readonly ConnectorProblem[] {
  if (typeof value === 'string' && WILDCARD.test(value)) return [{ code: 'CONNECTOR_REGISTRY_WILDCARD', message: `${label} has a wildcard connectorId` }];
  return matches(CONNECTOR_ID, value) ? [] : [invalid(`${label} has no valid connectorId`)];
}

function tenantProblems(value: unknown, tenants: TenantRegistry, label: string): readonly ConnectorProblem[] {
  if (typeof value !== 'string' || value === '') return [{ code: 'CONNECTOR_TENANT_MISSING', message: `${label} names no tenant` }];
  if (WILDCARD.test(value)) return [{ code: 'CONNECTOR_REGISTRY_WILDCARD', message: `${label} has a wildcard tenant` }];
  const declared = tenants.tenants.some((tenant) => tenant.tenantId === value);
  return declared ? [] : [{ code: 'CONNECTOR_TENANT_UNKNOWN', message: `${label} names a tenant the tenant registry does not declare` }];
}

/** Every item of a declared list, by position: a value here may be a mistake, so it is not repeated. */
function listProblems(value: unknown, field: string, isValid: (item: string) => boolean, label: string): readonly ConnectorProblem[] {
  const items = itemsOf(value);
  if (items === null || items.length === 0) return [invalid(`${label} declares no ${field}`)];
  return [
    ...items.flatMap((item, index): readonly ConnectorProblem[] => {
      if (typeof item !== 'string') return [invalid(`${label}.${field}[${index}] is not text`)];
      if (WILDCARD.test(item)) return [{ code: 'CONNECTOR_REGISTRY_WILDCARD', message: `${label}.${field}[${index}] is a wildcard` }];
      return isValid(item) ? [] : [invalid(`${label}.${field}[${index}] is not valid`)];
    }),
    ...items
      .filter((item, index) => items.indexOf(item) !== index)
      .map(() => ({ code: 'CONNECTOR_REGISTRY_DUPLICATE' as const, message: `${label}.${field} repeats a value` })),
  ];
}

/** Whose secret a reference names, or `null` when the tenant registry cannot say. */
function referenceTenant(projectSegment: string, tenants: TenantRegistry): string | null {
  if (isReservedProjectId(projectSegment)) return projectSegment.slice(TENANT_CREDENTIAL_PREFIX.length);
  return tenants.projects.find((project) => project.projectId === projectSegment)?.tenant ?? null;
}

/**
 * THE VALUE IS NEVER REPEATED. If this is a credential, a message quoting it would put it in a log.
 *
 * A connector reads only its own tenant's secrets, so a reference to another tenant, to a project of another
 * tenant, or to a project nobody registered is refused. The platform's key is named `OPENAI_GATEKEEPER_KEY`,
 * which is no reference at all, so the shape rule refuses it. No rule here knows a platform class by name.
 */
function secretProblems(value: unknown, tenant: unknown, tenants: TenantRegistry, label: string): readonly ConnectorProblem[] {
  if (typeof value !== 'string' || value.trim() === '') return [{ code: 'CONNECTOR_SECRET_MISSING', message: `${label} has no secretReference` }];
  if (holdsSecretShape(value) || RAW_CREDENTIAL_RUN.test(value)) {
    return [{ code: 'CONNECTOR_SECRET_VALUE', message: `${label}.secretReference looks like a credential, not a reference to one` }];
  }
  const reference = SECRET_REFERENCE.exec(value);
  if (reference === null) return [{ code: 'CONNECTOR_SECRET_REFERENCE_INVALID', message: `${label}.secretReference is not a five-segment credential reference` }];
  return referenceTenant(reference[1] as string, tenants) === tenant
    ? []
    : [{ code: 'CONNECTOR_SECRET_WRONG_TENANT', message: `${label}.secretReference does not belong to this connector's tenant` }];
}

/** A pass is a claim about one connector, at one version, for one tenant, on one date. */
function releaseProblems(entry: Readonly<Record<string, unknown>>, label: string): readonly ConnectorProblem[] {
  const record = asRecord(entry['releaseRecord']);
  if (record === null) return [{ code: 'CONNECTOR_RELEASE_MISSING', message: `${label} has no release record` }];
  const notPassed = (message: string): ConnectorProblem => ({ code: 'CONNECTOR_RELEASE_NOT_PASSED', message: `${label}.releaseRecord ${message}` });
  const mismatch = (message: string): ConnectorProblem => ({ code: 'CONNECTOR_RELEASE_MISMATCH', message: `${label}.releaseRecord ${message}` });
  const scenarioIds = ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id);
  return [
    ...unknownFieldProblems(record, RELEASE_FIELDS, `${label}.releaseRecord`),
    ...(record['result'] === 'passed' ? [] : [notPassed('does not say passed')]),
    ...(isExactly(record['checklist'], RELEASE_CHECKLIST) ? [] : [notPassed('does not confirm exactly the release checklist')]),
    ...(isExactly(record['scenarios'], scenarioIds) ? [] : [notPassed('does not list exactly the nine acceptance scenarios')]),
    ...(isEvidence(record['evidence']) ? [] : [notPassed('points at no evidence')]),
    ...RELEASE_BOUND_FIELDS.filter((field) => record[field] !== entry[field]).map((field) => mismatch(`is for another ${field}`)),
    ...(record['acceptedAt'] === entry['lastAcceptanceDate'] ? [] : [mismatch('is not dated the entry\'s lastAcceptanceDate')]),
  ];
}

/**
 * Every action must be in the registry. Each name goes through `resolveAction`, which folds nothing, so a near
 * miss is unregistered. `read-only` is a claim the registry can check: only P1 reads.
 */
function actionProblems(entry: Readonly<Record<string, unknown>>, actions: ActionRegistry, label: string): readonly ConnectorProblem[] {
  const resolved = textsOf(entry['actions']).filter(isActionName).map((action) => resolveAction(actions, action));
  return [
    ...listProblems(entry['actions'], 'actions', isActionName, label),
    ...resolved
      .filter((action) => !action.registered)
      .map((action) => ({ code: 'CONNECTOR_ACTION_UNREGISTERED' as const, message: `${label} names '${action.action}', which is not in the action registry, so it is ${action.actionClass} and refused` })),
    ...(entry['idempotency'] === 'read-only'
      ? resolved
          .filter((action) => action.registered && action.actionClass !== READ_ONLY_CLASS)
          .map((action) => ({ code: 'CONNECTOR_IDEMPOTENCY_MISMATCH' as const, message: `${label} says read-only, and '${action.action}' is ${action.actionClass}` }))
      : []),
  ];
}

function entryProblems(raw: unknown, index: number, context: ConnectorContext): readonly ConnectorProblem[] {
  const label = `connectors[${index}]`;
  const entry = asRecord(raw);
  if (entry === null) return [invalid(`${label} is not an object`)];
  return [
    ...unknownFieldProblems(entry, ENTRY_FIELDS, label),
    ...connectorIdProblems(entry['connectorId'], label),
    ...(matches(VERSION, entry['version']) ? [] : [invalid(`${label} has no valid version`)]),
    ...tenantProblems(entry['tenant'], context.tenants, label),
    ...((DOMAINS as readonly unknown[]).includes(entry['domain']) ? [] : [invalid(`${label} names an unknown domain`)]),
    ...listProblems(entry['scopes'], 'scopes', (item) => SCOPE.test(item), label),
    ...secretProblems(entry['secretReference'], entry['tenant'], context.tenants, label),
    ...listProblems(entry['dataCategories'], 'dataCategories', (item) => DATA_CATEGORY.test(item), label),
    ...((CONNECTOR_IDEMPOTENCY as readonly unknown[]).includes(entry['idempotency']) ? [] : [invalid(`${label} declares no known idempotency`)]),
    ...actionProblems(entry, context.actions, label),
    ...(instantOf(entry['lastAcceptanceDate']) !== null ? [] : [invalid(`${label} has no readable lastAcceptanceDate`)]),
    ...releaseProblems(entry, label),
  ];
}

function headerProblems(root: Readonly<Record<string, unknown>>): readonly ConnectorProblem[] {
  return [
    ...unknownFieldProblems(root, HEADER_FIELDS, 'the connector registry'),
    ...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map((field) => invalid(`the connector registry has no ${field}`)),
    ...(root['schemaVersion'] === CONNECTOR_REGISTRY_SCHEMA_VERSION ? [] : [invalid(`the connector registry has schemaVersion ${JSON.stringify(root['schemaVersion'])}`)]),
    ...(root['policy'] === CONNECTOR_REGISTRY_POLICY ? [] : [invalid(`the connector registry has policy ${JSON.stringify(root['policy'])}`)]),
  ];
}

/** One id must mean one connector, or a release record could speak for either line. */
function duplicateProblems(entries: readonly unknown[]): readonly ConnectorProblem[] {
  const ids = entries.flatMap((entry) => textsOf([asRecord(entry)?.['connectorId']]));
  return ids
    .filter((id, index) => ids.indexOf(id) !== index)
    .map((id) => ({ code: 'CONNECTOR_REGISTRY_DUPLICATE' as const, message: `more than one connector has the id '${id}'` }));
}

function freezeList(value: unknown): readonly string[] {
  return Object.freeze(textsOf(value));
}

/** Field by field, never spread: what comes back shares nothing with what went in. */
function releaseRecordOf(record: Readonly<Record<string, unknown>>): ConnectorReleaseRecord {
  return Object.freeze({
    connectorId: record['connectorId'] as string,
    version: record['version'] as string,
    tenant: record['tenant'] as string,
    result: 'passed' as const,
    acceptedAt: record['acceptedAt'] as string,
    checklist: freezeList(record['checklist']),
    scenarios: freezeList(record['scenarios']),
    evidence: record['evidence'] as string,
  });
}

function connectorOf(raw: unknown): ConnectorEntry {
  const entry = asRecord(raw) as Readonly<Record<string, unknown>>;
  return Object.freeze({
    connectorId: entry['connectorId'] as string,
    version: entry['version'] as string,
    tenant: entry['tenant'] as string,
    domain: entry['domain'] as Domain,
    scopes: freezeList(entry['scopes']),
    secretReference: entry['secretReference'] as string,
    dataCategories: freezeList(entry['dataCategories']),
    idempotency: entry['idempotency'] as ConnectorIdempotency,
    actions: freezeList(entry['actions']),
    lastAcceptanceDate: entry['lastAcceptanceDate'] as string,
    releaseRecord: releaseRecordOf(asRecord(entry['releaseRecord']) as Readonly<Record<string, unknown>>),
  });
}

/**
 * Judge the whole file. Every problem in it is reported, and any problem refuses all of it.
 *
 * The caller hands over parsed JSON from committed bytes; nothing here reads a file. An empty `connectors` list
 * is valid: that is today's file. The registry returned is the only value the gate will accept.
 */
export function parseConnectorRegistry(raw: unknown, context: ConnectorContext): ConnectorRegistryResult {
  const root = asRecord(raw);
  if (root === null) return { ok: false, problems: [invalid('the connector registry is not an object')] };
  const connectors = itemsOf(root['connectors']);
  const problems: readonly ConnectorProblem[] = [
    ...headerProblems(root),
    ...(connectors === null ? [invalid('the connector registry declares no connectors list')] : []),
    ...(connectors ?? []).flatMap((entry, index) => entryProblems(entry, index, context)),
    ...duplicateProblems(connectors ?? []),
  ];
  if (problems.length > 0) return { ok: false, problems };

  const registry: ConnectorRegistry = Object.freeze({ connectors: Object.freeze((connectors as readonly unknown[]).map(connectorOf)) });
  LIVE_REGISTRIES.add(registry);
  return { ok: true, registry };
}

/**
 * Why this connector's acceptance does not hold at `now`, or `null` when it does.
 *
 * A date after `now` is refused, because a future date would hide staleness for as long as it stayed ahead. A
 * `now` that cannot be read refuses: no time is not a fresh time.
 */
export function connectorAcceptanceRefusal(connector: ConnectorEntry, now: string): string | null {
  const accepted = instantOf(connector.lastAcceptanceDate);
  const at = instantOf(now);
  if (accepted === null || at === null) return `the acceptance of '${connector.connectorId}' cannot be judged: a date is unreadable`;
  if (accepted > at) return `the acceptance of '${connector.connectorId}' is dated after now`;
  return at - accepted > CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS * DAY_MS
    ? `the acceptance of '${connector.connectorId}' is stale: older than ${CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS} days`
    : null;
}

/** The standard execution receipt. Six fields, each with a closed shape, so no content has anywhere to sit. */
export interface ConnectorReceipt {
  readonly tenant: string;
  readonly connector: string;
  readonly action: string;
  readonly idempotencyKey: string;
  readonly outcome: ConnectorOutcome;
  /** `null` exactly when the outcome is `succeeded`. */
  readonly errorCode: ConnectorErrorCode | null;
}

export type ConnectorReceiptCode =
  | 'RECEIPT_INVALID'
  | 'RECEIPT_ERROR_CODE_UNKNOWN'
  | 'RECEIPT_TENANT_MISMATCH'
  | 'RECEIPT_CALL_MISMATCH'
  | 'RECEIPT_CALL_UNADMITTED';

export type ConnectorReceiptResult =
  | { readonly ok: true; readonly receipt: ConnectorReceipt }
  | { readonly ok: false; readonly code: ConnectorReceiptCode; readonly reasons: readonly string[] };

export type ConnectorErrorResult =
  | { readonly ok: true; readonly code: ConnectorErrorCode }
  | { readonly ok: false; readonly code: 'CONNECTOR_ERROR_UNKNOWN'; readonly reasons: readonly string[] };

/**
 * Is this a code of the contract? Exact text only. What a provider calls an error is not ours to translate:
 * guessing `rate_limited` for `timeout` is how a write that happened gets retried.
 */
export function parseConnectorError(value: unknown): ConnectorErrorResult {
  return (CONNECTOR_ERROR_CODES as readonly unknown[]).includes(value)
    ? { ok: true, code: value as ConnectorErrorCode }
    : { ok: false, code: 'CONNECTOR_ERROR_UNKNOWN', reasons: ['the error is not a code of the connector contract'] };
}

const RECEIPT_CHECKS: Readonly<Record<keyof ConnectorReceipt, (value: unknown) => boolean>> = {
  tenant: isTenantId,
  connector: (value) => matches(CONNECTOR_ID, value),
  action: isActionName,
  idempotencyKey: (value) => matches(IDEMPOTENCY_KEY, value),
  outcome: (value) => (CONNECTOR_OUTCOMES as readonly unknown[]).includes(value),
  errorCode: (value) => value === null || typeof value === 'string',
};

function receiptRefused(code: ConnectorReceiptCode, reasons: readonly string[]): Extract<ConnectorReceiptResult, { ok: false }> {
  return { ok: false, code, reasons };
}

/** `outcome_unknown` is its own outcome: never a failure with a code, never a success. */
function outcomeProblem(outcome: unknown, errorCode: unknown): string | null {
  if (outcome === 'succeeded') return errorCode === null ? null : 'a success carries no error code';
  if (outcome === 'unknown') return errorCode === 'outcome_unknown' ? null : 'an unknown outcome carries outcome_unknown';
  return errorCode === null || errorCode === 'outcome_unknown' ? 'a failure names its code, and outcome_unknown is not a failure' : null;
}

/** A receipt as a connector presented it. An unknown field is refused: that is where content would go. */
export function parseConnectorReceipt(raw: unknown): ConnectorReceiptResult {
  const record = asRecord(raw);
  if (record === null) return receiptRefused('RECEIPT_INVALID', ['the receipt is not an object']);
  const reasons = [
    ...RECEIPT_FIELDS.flatMap((field) => {
      if (!Object.hasOwn(record, field)) return [`the receipt has no ${field}`];
      return RECEIPT_CHECKS[field](record[field]) ? [] : [`the receipt's ${field} is unparseable`];
    }),
    ...Object.keys(record)
      .filter((key) => !(RECEIPT_FIELDS as readonly string[]).includes(key))
      .map((key) => `the receipt carries an unknown field '${key}'`),
    // A lowercase, hyphenated key fits every name shape above, so the shapes alone do not keep one out.
    ...RECEIPT_FIELDS.filter((field) => typeof record[field] === 'string' && holdsSecretShape(record[field])).map((field) => `the receipt's ${field} looks like a credential`),
  ];
  if (reasons.length > 0) return receiptRefused('RECEIPT_INVALID', reasons);
  const { tenant, connector, action, idempotencyKey, outcome, errorCode } = record as unknown as ConnectorReceipt;
  if (errorCode !== null && !parseConnectorError(errorCode).ok) return receiptRefused('RECEIPT_ERROR_CODE_UNKNOWN', ['the receipt names an error that is not a code of the contract']);
  const problem = outcomeProblem(outcome, errorCode);
  if (problem !== null) return receiptRefused('RECEIPT_INVALID', [problem]);
  return { ok: true, receipt: Object.freeze({ tenant, connector, action, idempotencyKey, outcome, errorCode }) };
}

/** The record an explicit reconciliation leaves. Appended to the history; nothing is rewritten. */
export interface ConnectorReconciliation {
  readonly tenant: string;
  readonly connector: string;
  readonly action: string;
  readonly idempotencyKey: string;
  readonly finding: ReconciliationFinding;
  readonly evidence: string;
  readonly reconciledBy: string;
  readonly reconciledAt: string;
}

type HistoryLine = ConnectorReceipt | ConnectorReconciliation;

function isReconcilerName(value: unknown): value is string {
  return matches(RECONCILER, value);
}

function parseReconciliation(record: Readonly<Record<string, unknown>>): ConnectorReconciliation | null {
  const sound =
    unknownFieldProblems(record, RECONCILIATION_FIELDS, 'a reconciliation').length === 0 &&
    isTenantId(record['tenant']) &&
    matches(CONNECTOR_ID, record['connector']) &&
    isActionName(record['action']) &&
    matches(IDEMPOTENCY_KEY, record['idempotencyKey']) &&
    (RECONCILIATION_FINDINGS as readonly unknown[]).includes(record['finding']) &&
    isEvidence(record['evidence']) &&
    isReconcilerName(record['reconciledBy']) &&
    instantOf(record['reconciledAt']) !== null;
  return sound ? (record as unknown as ConnectorReconciliation) : null;
}

/** One line, or `null`. A receipt is what it is whatever key it is for. */
function parseHistoryLine(raw: unknown): HistoryLine | null {
  const record = asRecord(raw);
  if (record === null) return null;
  if (Object.hasOwn(record, 'finding')) return parseReconciliation(record);
  const parsed = parseConnectorReceipt(record);
  return parsed.ok ? parsed.receipt : null;
}

/** All of it, or nothing. A line that cannot be read might be the line that says a write happened. */
function parseHistory(history: unknown): readonly HistoryLine[] | null {
  const lines = itemsOf(history)?.map(parseHistoryLine) ?? null;
  return lines === null || lines.some((line) => line === null) ? null : (lines as readonly HistoryLine[]);
}

interface KeyState {
  readonly attempts: number;
  /** An `outcome_unknown` no reconciliation has answered. */
  readonly unreconciled: boolean;
  readonly completed: boolean;
  /** The last failure's code, cleared by a reconciliation. */
  readonly lastFailure: ConnectorErrorCode | null;
  /** A reconciliation with nothing to answer. */
  readonly broken: boolean;
}

const NEW_KEY: KeyState = Object.freeze({ attempts: 0, unreconciled: false, completed: false, lastFailure: null, broken: false });

function afterLine(state: KeyState, line: HistoryLine): KeyState {
  if ('finding' in line) {
    if (!state.unreconciled) return { ...state, broken: true };
    return { ...state, unreconciled: false, lastFailure: null, completed: state.completed || line.finding === 'completed' };
  }
  const attempts = state.attempts + 1;
  if (line.outcome === 'succeeded') return { ...state, attempts, completed: true };
  if (line.outcome === 'unknown') return { ...state, attempts, unreconciled: true };
  return { ...state, attempts, lastFailure: line.errorCode };
}

/** What the history says about one key, or `null` if it contradicts itself. A key is one intent, so one tenant. */
function stateOfKey(lines: readonly HistoryLine[], idempotencyKey: string): KeyState | null {
  const own = lines.filter((line) => line.idempotencyKey === idempotencyKey);
  const contradicts = new Set(own.map((line) => line.tenant)).size > 1 || new Set(own.map((line) => line.action)).size > 1;
  const state = own.reduce(afterLine, NEW_KEY);
  return contradicts || state.broken ? null : state;
}

/** What only the kernel can say. `true` counts; anything else has not happened. */
export interface ConnectorRetryFacts {
  readonly reauthenticated: boolean;
  readonly approved: boolean;
}

export type ConnectorRetryCode =
  | 'RETRY_KEY_INVALID'
  | 'RETRY_HISTORY_INVALID'
  | 'RETRY_UNRECONCILED'
  | 'RETRY_ALREADY_COMPLETED'
  | 'RETRY_NEVER'
  | 'RETRY_NEEDS_REAUTHENTICATION'
  | 'RETRY_NEEDS_APPROVAL'
  | 'RETRY_ATTEMPTS_EXHAUSTED';

export type ConnectorRetryDecision =
  | { readonly allowed: true; readonly attempt: number; readonly rule: 'first-attempt' | ConnectorRetryRule }
  | { readonly allowed: false; readonly code: ConnectorRetryCode; readonly reasons: readonly string[] };

function retryRefused(code: ConnectorRetryCode, reason: string): Extract<ConnectorRetryDecision, { allowed: false }> {
  return { allowed: false, code, reasons: [reason] };
}

/** Does this rule's own condition stand in the way? Reconciliation is settled before this is asked. */
function retryBlock(rule: ConnectorRetryRule, facts: ConnectorRetryFacts): Extract<ConnectorRetryDecision, { allowed: false }> | null {
  if (rule === 'never') return retryRefused('RETRY_NEVER', 'this cannot succeed under this key: a changed request is a new intent');
  if (rule === 'after-reauthentication' && facts.reauthenticated !== true) return retryRefused('RETRY_NEEDS_REAUTHENTICATION', 'the connector needs re-authenticating first');
  if (rule === 'after-approval' && facts.approved !== true) return retryRefused('RETRY_NEEDS_APPROVAL', 'this needs an approval first');
  return null;
}

/**
 * IN THIS ORDER, AND THE ORDER IS THE RULE. An unanswered unknown refuses ahead of everything, because no other
 * line can say whether that write happened. Only then does a completed key refuse, and only then may the last
 * failure's own rule speak.
 */
function judgeRetry(state: KeyState, facts: ConnectorRetryFacts): ConnectorRetryDecision {
  if (state.unreconciled) return retryRefused('RETRY_UNRECONCILED', 'an earlier attempt is outcome_unknown and has not been reconciled');
  if (state.completed) return retryRefused('RETRY_ALREADY_COMPLETED', 'this key already completed, so it does not run again');
  if (state.attempts === 0) return { allowed: true, attempt: 1, rule: 'first-attempt' };
  const rule = state.lastFailure === null ? 'after-reconciliation' : CONNECTOR_RETRY_RULES[state.lastFailure];
  const block = retryBlock(rule, facts);
  if (block !== null) return block;
  if (state.attempts >= CONNECTOR_MAX_ATTEMPTS) return retryRefused('RETRY_ATTEMPTS_EXHAUSTED', `this key has used its ${CONNECTOR_MAX_ATTEMPTS} attempts`);
  return { allowed: true, attempt: state.attempts + 1, rule };
}

/**
 * May this key run again? Keyed by the idempotency key, so a new envelope for the same intent gets the same
 * answer, and so does another connector.
 *
 * The whole history is read first: a line that cannot be parsed refuses, even a line for another key, because
 * a store with one bad line cannot be trusted about the rest.
 */
export function decideConnectorRetry(history: unknown, idempotencyKey: string, facts: ConnectorRetryFacts): ConnectorRetryDecision {
  if (!matches(IDEMPOTENCY_KEY, idempotencyKey)) return retryRefused('RETRY_KEY_INVALID', 'that is not an idempotency key');
  const lines = parseHistory(history);
  const state = lines === null ? null : stateOfKey(lines, idempotencyKey);
  return state === null ? retryRefused('RETRY_HISTORY_INVALID', 'the attempt history cannot be trusted') : judgeRetry(state, facts);
}

/** What the reconciler says. Whose it is comes from the open receipt, so nothing here can move a tenant. */
export interface ConnectorReconciliationRequest {
  readonly idempotencyKey: string;
  readonly finding: ReconciliationFinding;
  readonly evidence: string;
  readonly reconciledBy: string;
  readonly reconciledAt: string;
}

export type ConnectorReconciliationCode = 'RETRY_HISTORY_INVALID' | 'RECONCILE_NOTHING_OPEN' | 'RECONCILE_EVIDENCE_REQUIRED' | 'RECONCILE_INVALID';

export type ConnectorReconciliationResult =
  | { readonly ok: true; readonly record: ConnectorReconciliation; readonly history: readonly unknown[] }
  | { readonly ok: false; readonly code: ConnectorReconciliationCode; readonly reasons: readonly string[] };

function reconciliationRefused(code: ConnectorReconciliationCode, reason: string): Extract<ConnectorReconciliationResult, { ok: false }> {
  return { ok: false, code, reasons: [reason] };
}

/**
 * Answer an `outcome_unknown`. Explicit, and it leaves evidence.
 *
 * The result is a new history with the record appended; the one handed in is untouched, and the unknown stays
 * in it, because what happened happened. The caller stores the record. Until it does, nothing has been
 * reconciled, since `decideConnectorRetry` reads only the history.
 */
export function reconcileConnectorOutcome(history: unknown, request: ConnectorReconciliationRequest): ConnectorReconciliationResult {
  const lines = parseHistory(history);
  const { idempotencyKey, finding, evidence, reconciledBy, reconciledAt } = request;
  const state = lines === null ? null : stateOfKey(lines, idempotencyKey);
  if (lines === null || state === null) return reconciliationRefused('RETRY_HISTORY_INVALID', 'the attempt history cannot be trusted');
  if (!state.unreconciled) return reconciliationRefused('RECONCILE_NOTHING_OPEN', 'no outcome_unknown is open under this key');
  if (!isEvidence(evidence)) return reconciliationRefused('RECONCILE_EVIDENCE_REQUIRED', 'a reconciliation points at its evidence, and this does not');
  const known = (RECONCILIATION_FINDINGS as readonly unknown[]).includes(finding) && isReconcilerName(reconciledBy) && instantOf(reconciledAt) !== null;
  if (!known) return reconciliationRefused('RECONCILE_INVALID', 'a reconciliation states a known finding, who found it, and when');
  const open = lines.filter((line): line is ConnectorReceipt => line.idempotencyKey === idempotencyKey && 'outcome' in line && line.outcome === 'unknown').at(-1) as ConnectorReceipt;
  const { tenant, connector, action } = open;
  const record: ConnectorReconciliation = Object.freeze({ tenant, connector, action, idempotencyKey, finding, evidence, reconciledBy, reconciledAt });
  return { ok: true, record, history: Object.freeze([...(history as readonly unknown[]), record]) };
}

/** One call the gate admitted. Only `admitConnectorCall` produces one that a receipt can be checked against. */
export interface ConnectorCall {
  readonly connector: ConnectorEntry;
  readonly envelope: TaskEnvelope;
  readonly attempt: number;
}

export interface ConnectorCallRequest {
  readonly registry: ConnectorRegistry;
  readonly actions: ActionRegistry;
  readonly connectorId: string;
  /** The tenant, domain, action and idempotency key are read from this and from nowhere else. */
  readonly envelope: TaskEnvelope;
  readonly history: unknown;
  readonly facts: ConnectorRetryFacts;
  readonly now: string;
}

export type ConnectorGateCode =
  | 'CONNECTOR_REGISTRY_INVALID'
  | 'CONNECTOR_ENVELOPE_NOT_ADMITTED'
  | 'CONNECTOR_ENVELOPE_EXPIRED'
  | 'CONNECTOR_UNKNOWN'
  | 'CONNECTOR_CROSS_TENANT'
  | 'CONNECTOR_ACTION_UNDECLARED'
  | 'CONNECTOR_ACTION_UNREGISTERED'
  | 'CONNECTOR_ACCEPTANCE_STALE'
  | ConnectorRetryCode;

export type ConnectorAdmission =
  | { readonly admitted: true; readonly call: ConnectorCall }
  | { readonly admitted: false; readonly code: ConnectorGateCode; readonly reasons: readonly string[] };

function callRefused(code: ConnectorGateCode, reasons: readonly string[]): Extract<ConnectorAdmission, { admitted: false }> {
  return { admitted: false, code, reasons };
}

/**
 * Did the door admit this envelope? `taskEnvelope` keeps that private, and `recordExecution` is the one public
 * question that asks it. This recorder writes nothing, so asking leaves no line and no side effect.
 */
function admittedAtTheDoor(envelope: TaskEnvelope, now: string): boolean {
  return recordExecution(envelope, 'allowed', null, now, () => true);
}

/**
 * THE GATE. Every call a connector would make comes through here, and each refusal is by name.
 *
 * Expiry is asked here as well as at the door, because ADR-K1 R7 checks it when the action executes. The
 * retry rule is asked last and by the envelope's own key, so a caller has no way to name a different one.
 */
export function admitConnectorCall(request: ConnectorCallRequest): ConnectorAdmission {
  const { registry, actions, connectorId, envelope, history, facts, now } = request;
  if (!LIVE_REGISTRIES.has(registry)) return callRefused('CONNECTOR_REGISTRY_INVALID', ['this registry did not pass whole-file validation']);
  if (!admittedAtTheDoor(envelope, now)) return callRefused('CONNECTOR_ENVELOPE_NOT_ADMITTED', ['this envelope was not admitted at the door']);
  if (envelopeExpired(envelope, now)) return callRefused('CONNECTOR_ENVELOPE_EXPIRED', [`the envelope expired at ${envelope.expiry}`]);
  const connector = registry.connectors.find((candidate) => candidate.connectorId === connectorId);
  if (connector === undefined) return callRefused('CONNECTOR_UNKNOWN', ['no connector by that id is registered']);
  if (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain) {
    return callRefused('CONNECTOR_CROSS_TENANT', [`'${connector.connectorId}' belongs to ${connector.tenant}/${connector.domain}, and this work is ${envelope.tenant}/${envelope.domain}`]);
  }
  if (!connector.actions.includes(envelope.action)) return callRefused('CONNECTOR_ACTION_UNDECLARED', [`'${connector.connectorId}' does not declare '${envelope.action}'`]);
  const resolved = resolveAction(actions, envelope.action);
  if (!resolved.registered) return callRefused('CONNECTOR_ACTION_UNREGISTERED', [`'${envelope.action}' is not in the action registry, so it is ${resolved.actionClass} and refused`]);
  const lapsed = connectorAcceptanceRefusal(connector, now);
  if (lapsed !== null) return callRefused('CONNECTOR_ACCEPTANCE_STALE', [lapsed]);
  const retry = decideConnectorRetry(history, envelope.idempotencyKey, facts);
  if (!retry.allowed) return callRefused(retry.code, retry.reasons);
  const call: ConnectorCall = Object.freeze({ connector, envelope, attempt: retry.attempt });
  LIVE_CALLS.add(call);
  return { admitted: true, call };
}

/**
 * A receipt against the call it answers. The tenant is compared on its own, by its own name, because a receipt
 * in another tenant is a boundary failure and not a bookkeeping one.
 */
export function checkConnectorReceipt(raw: unknown, call: ConnectorCall): ConnectorReceiptResult {
  if (!LIVE_CALLS.has(call)) return receiptRefused('RECEIPT_CALL_UNADMITTED', ['the gate did not admit this call']);
  const parsed = parseConnectorReceipt(raw);
  if (!parsed.ok) return parsed;
  const { receipt } = parsed;
  const { connector, envelope } = call;
  if (receipt.tenant !== envelope.tenant) return receiptRefused('RECEIPT_TENANT_MISMATCH', [`the receipt is for ${receipt.tenant}, and the envelope is ${envelope.tenant}`]);
  const expected = { connector: connector.connectorId, action: envelope.action, idempotencyKey: envelope.idempotencyKey } as const;
  const differs = (Object.keys(expected) as readonly (keyof typeof expected)[]).filter((field) => receipt[field] !== expected[field]);
  return differs.length > 0 ? receiptRefused('RECEIPT_CALL_MISMATCH', differs.map((field) => `the receipt's ${field} is not the call's`)) : parsed;
}
