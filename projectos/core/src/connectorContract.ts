/**
 * The connector contract: what every connector must declare, what stops one that has not qualified, and what it
 * hands back (owner decision D5). Zero live connectors: nothing here calls a provider.
 *
 * THE WHOLE FILE, OR NOTHING, EXCEPT THE CLOCK. A date that lapses overnight is not a contradiction, and one tenant's
 * overdue connector must not stop another's, so acceptance is asked per connector at the gate.
 *
 * THE DOOR DECIDES WHAT A CONNECTOR MAY HOLD. Registration asks the real door, with no grant, because a connector has
 * no grant source yet. There is no second list here to drift. Today that leaves P1 and P2.
 *
 * THE HISTORY MAKES A RETRY SAFE. Admission hands back `started`, which the caller must persist before acting. A
 * start with no valid receipt counts as `outcome_unknown`, so a refused receipt, a crash after the write and a second
 * admit that sees the start are all stopped. Only a reconciliation clears an unknown. It answers one attempt of one
 * connector, so a copy answers nothing. The rule is keyed by the idempotency key, so a sibling connector is no way round.
 *
 * PURE, AND THAT IS ITS LIMIT. No I/O, no clock, no dependency. The durable write before acting is the Stage 4 and 5
 * ledger's duty, and it must append a start only if `attempt == count + 1`, or two concurrent admits both run. Until
 * then, a caller passing an empty history defeats the retry rule. See `docs/finish/PROJECTOS-CONNECTOR-CONTRACT1A.md`.
 */
import { classAtMost, isActionName, resolveAction, type ActionRegistry } from './actionRegistry.js';
import { holdsSecretShape } from './context/redact.js';
import { admitEnvelope, envelopeExpired, mintEnvelope, recordExecution, type TaskEnvelope } from './taskEnvelope.js';
import { DOMAINS, isReservedProjectId, isTenantId, resolveTenant, TENANT_CREDENTIAL_PREFIX, type Domain, type TenantBinding, type TenantRegistry } from './tenant.js';

export const CONNECTOR_REGISTRY_SCHEMA_VERSION = '1.0.0';
export const CONNECTOR_REGISTRY_POLICY = 'connector-registry';

/** A ceiling, not a target: how long a passing acceptance can hold, in days. */
export const CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A ceiling, not a target: attempts under one key, the first included. */
export const CONNECTOR_MAX_ATTEMPTS = 5;

/** Unregistered in `action-registry.json`, so reconciliation fails closed until the first connector phase adds it. */
export const CONNECTOR_RECONCILE_ACTION = 'connector-reconcile';
/** Clearing an unknown opens a retry, so it needs a grant: at P2 an implementer could answer its own attempt. */
const RECONCILE_CLASS_FLOOR = 'P3';

/** A closed set: an unknown code is refused and is never mapped onto one of these. */
export const CONNECTOR_ERROR_CODES = ['authentication_required', 'permission_denied', 'rate_limited', 'invalid_input', 'approval_required', 'upstream_unavailable', 'outcome_unknown'] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

export type ConnectorRetryRule = 'after-backoff' | 'after-reauthentication' | 'after-approval' | 'after-reconciliation' | 'never';

/**
 * One rule per code, and the compiler refuses a code without one. `upstream_unavailable` means the provider was
 * known not to have acted: a timeout during a write is `outcome_unknown`. `never` means never under this key: a
 * changed request is a new intent, so a new key.
 */
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
export type ConnectorOutcome = 'succeeded' | 'failed' | 'unknown';
const OUTCOMES: readonly unknown[] = ['succeeded', 'failed', 'unknown'];

export const CONNECTOR_IDEMPOTENCY = ['provider-key', 'reconcile-first', 'read-only'] as const;
export type ConnectorIdempotency = (typeof CONNECTOR_IDEMPOTENCY)[number];

export const RECONCILIATION_FINDINGS = ['completed', 'not_completed'] as const;
export type ReconciliationFinding = (typeof RECONCILIATION_FINDINGS)[number];

/** The blueprint's connector release checklist (§13), item by item. */
export const RELEASE_CHECKLIST = [
  'provider-identity', 'actions-and-scopes-documented', 'authentication-and-revocation', 'tenant-and-resource-bound', 'read-and-write-verified',
  'denied-actions-fail', 'rate-limits-and-retries', 'provider-receipts', 'audit-logs', 'operational-owner',
] as const;

export type ScenarioStatus = 'proved' | 'defined';

export interface AcceptanceScenario {
  readonly id: string;
  readonly given: string;
  /** A failure blocks the connector or action class; it never quietly reduces protection. */
  readonly expect: string;
  /** `proved` has a proof that runs today. `defined` is a definition and is never a pass. */
  readonly status: ScenarioStatus;
  readonly firstRun: 'stage-2' | 'stage-5';
  readonly proof: string | null;
}

const defined = (id: string, given: string, expect: string): AcceptanceScenario => Object.freeze({ id, given, expect, status: 'defined', firstRun: 'stage-5', proof: null });

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
/** The same run split by separators, as a UUID is, in the provider or credential segment: neither is a closed name. */
const SPLIT_CREDENTIAL_RUN = /\/(?:[A-Za-z0-9][._-]*){24,}(?:\/[^/]*)?$/;
/** A pointer to evidence, never the evidence: a known kind, and no room for a sentence or a payload. */
const EVIDENCE = /^(?:provider:|commit:|docs\/)[A-Za-z0-9][A-Za-z0-9._:/#-]{2,240}$/;
const PROVIDER_RECEIPT = /^provider:/;
const RECONCILER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENVELOPE_ID = /^ENV-[0-9a-f]{24}$/;
const IDEMPOTENCY_KEY = /^sha256:[0-9a-f]{64}$/;
/** `toISOString` prints a sixth year digit past 9999, and the schema's instant has four. */
const FOUR_DIGIT_YEAR = /^[0-9]{4}-/;
/** `*` and `?` mean "more than one thing", which a declaration may never mean. */
const WILDCARD = /[*?]/;
const READ_ONLY_CLASS = 'P1';

/** A record that cannot say who authorised it, and why it is trusted, is not one. */
const PROSE_FIELDS = ['note', 'authority', 'authorisedBy', 'provenance', 'trustBasis'];
const HEADER_FIELDS = ['schemaVersion', 'policy', ...PROSE_FIELDS, 'connectors'];
const ENTRY_FIELDS = ['connectorId', 'version', 'tenant', 'domain', 'scopes', 'secretReference', 'dataCategories', 'idempotency', 'actions', 'lastAcceptanceDate', 'releaseRecord'];
const RELEASE_FIELDS = ['connectorId', 'version', 'tenant', 'result', 'acceptedAt', 'checklist', 'scenarios', 'evidence'];
const RELEASE_BOUND_FIELDS = ['connectorId', 'version', 'tenant'] as const;
const CALL_FIELDS = ['tenant', 'connector', 'action', 'idempotencyKey', 'attempt'] as const;
const START_FIELDS = [...CALL_FIELDS, 'envelopeId'];
const RECEIPT_FIELDS = [...CALL_FIELDS, 'outcome', 'errorCode', 'providerReceipt'] as const;
const RECONCILIATION_FIELDS = [...CALL_FIELDS, 'finding', 'evidence', 'reconciledBy', 'reconcilerEnvelope', 'reconciledAt'];

/** The door's question needs a well-formed envelope. None of these leave this module. */
const DOOR_PROBE_ID = `ENV-${'0'.repeat(24)}`;
const DOOR_PROBE_ACTOR = Object.freeze({ agent: 'connector-registration', provider: 'none', model: 'none' });
const DOOR_PROBE_SUBJECT = '0'.repeat(40);
const DOOR_PROBE_NOW = '2000-01-01T00:00:00.000Z';
const DOOR_PROBE_EXPIRY = '2000-01-01T00:00:01.000Z';

export type ConnectorRegistryCode =
  | 'CONNECTOR_REGISTRY_INVALID' | 'CONNECTOR_REGISTRY_WILDCARD' | 'CONNECTOR_REGISTRY_DUPLICATE' | 'CONNECTOR_TENANT_MISSING' | 'CONNECTOR_TENANT_UNKNOWN' | 'CONNECTOR_TENANT_REGISTRY_INVALID'
  | 'CONNECTOR_SECRET_MISSING' | 'CONNECTOR_SECRET_VALUE' | 'CONNECTOR_SECRET_REFERENCE_INVALID' | 'CONNECTOR_SECRET_WRONG_TENANT'
  | 'CONNECTOR_RELEASE_MISSING' | 'CONNECTOR_RELEASE_NOT_PASSED' | 'CONNECTOR_RELEASE_MISMATCH'
  | 'CONNECTOR_ACTION_UNREGISTERED' | 'CONNECTOR_ACTION_DOOR_REFUSED' | 'CONNECTOR_IDEMPOTENCY_MISMATCH';

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

export type ConnectorRegistryResult = { readonly ok: true; readonly registry: ConnectorRegistry } | { readonly ok: false; readonly problems: readonly ConnectorProblem[] };

export interface ConnectorContext {
  readonly actions: ActionRegistry;
  readonly tenants: TenantRegistry;
}

/** Registries that passed whole-file validation, and calls the gate admitted. Nothing else reaches past them. */
const LIVE_REGISTRIES = new WeakSet<object>();
const LIVE_CALLS = new WeakSet<object>();

/** Everything is judged on this copy and only this comes back, so a getter gets one read and a throw is malformed. */
function plainCopy(raw: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(raw) ?? 'null');
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

function invalid(message: string): ConnectorProblem {
  return { code: 'CONNECTOR_REGISTRY_INVALID', message };
}

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value);
}

/** The text must be what the instant prints back as, so 31 February is not March. AP-29 bars `approvals/instant` from here. */
function readInstant(value: unknown): number | null {
  if (!matches(FOUR_DIGIT_YEAR, value)) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) || new Date(at).toISOString() !== value ? null : at;
}

function unknownFieldProblems(record: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): readonly ConnectorProblem[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => invalid(`${label} carries an unknown field '${key}'`));
}

function itemsOf(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
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
  return matches(EVIDENCE, value) && !holdsSecretShape(value) && !RAW_CREDENTIAL_RUN.test(value);
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

/** A tenant-class reference names its tenant. A project-class one must be a project of this tenant and domain. */
function referenceBelongs(segment: string, entry: Readonly<Record<string, unknown>>, tenants: TenantRegistry): boolean {
  if (isReservedProjectId(segment)) return segment.slice(TENANT_CREDENTIAL_PREFIX.length) === entry['tenant'];
  const project = tenants.projects.find((candidate) => candidate.projectId === segment);
  return project !== undefined && project.tenant === entry['tenant'] && project.domain === entry['domain'];
}

/**
 * THE VALUE IS NEVER REPEATED: a message quoting a credential would put it in a log. The platform's key is named
 * `OPENAI_GATEKEEPER_KEY`, no reference at all, so the shape rule refuses it; no rule here knows a platform class.
 */
function secretProblems(entry: Readonly<Record<string, unknown>>, tenants: TenantRegistry, label: string): readonly ConnectorProblem[] {
  const value = entry['secretReference'];
  if (typeof value !== 'string' || value.trim() === '') return [{ code: 'CONNECTOR_SECRET_MISSING', message: `${label} has no secretReference` }];
  if (holdsSecretShape(value) || RAW_CREDENTIAL_RUN.test(value) || SPLIT_CREDENTIAL_RUN.test(value)) {
    return [{ code: 'CONNECTOR_SECRET_VALUE', message: `${label}.secretReference looks like a credential, not a reference to one` }];
  }
  const reference = SECRET_REFERENCE.exec(value);
  if (reference === null) return [{ code: 'CONNECTOR_SECRET_REFERENCE_INVALID', message: `${label}.secretReference is not a five-segment credential reference` }];
  return referenceBelongs(reference[1] as string, entry, tenants)
    ? []
    : [{ code: 'CONNECTOR_SECRET_WRONG_TENANT', message: `${label}.secretReference does not belong to this connector's tenant and domain` }];
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

/** Only `resolveTenant` can bind, and only a registry that passed whole-file validation lets it. A forgery yields `null`. */
function probeBinding(tenants: TenantRegistry): TenantBinding | null {
  const project = tenants.projects?.[0];
  if (project === undefined) return null;
  const { projectId, repository, governedRoot: root } = project;
  const resolved = resolveTenant(tenants, { projectId, repository, root, worktrees: null });
  return resolved.ok ? resolved.binding : null;
}

/** What the door would answer a connector, or `null`. `taskEnvelope` keeps the rule private, so this asks the door itself, with a port that grants nothing. */
function doorRefusal(action: string, binding: TenantBinding, actions: ActionRegistry): string | null {
  const minted = mintEnvelope(
    { binding, registry: actions, principal: 'implementer', actor: DOOR_PROBE_ACTOR, envelopeId: DOOR_PROBE_ID },
    { action, subjectHash: DOOR_PROBE_SUBJECT, scope: [], budget: 1, expiry: DOOR_PROBE_EXPIRY, intentScope: 'connector-registration' },
  );
  const admission = admitEnvelope(minted, DOOR_PROBE_NOW, () => true, () => false);
  return admission.admitted ? null : admission.rule;
}

/** Registered, then what the door allows, then `read-only` checked against the class. Refusals name a position: an action name is free text until it has passed. */
function actionProblems(entry: Readonly<Record<string, unknown>>, actions: ActionRegistry, binding: TenantBinding, label: string): readonly ConnectorProblem[] {
  const named = textsOf(entry['actions']).filter(isActionName);
  return [
    ...listProblems(entry['actions'], 'actions', isActionName, label),
    ...named.flatMap((action, index): readonly ConnectorProblem[] => {
      const resolved = resolveAction(actions, action);
      const at = `${label}.actions[${index}]`;
      if (!resolved.registered) return [{ code: 'CONNECTOR_ACTION_UNREGISTERED', message: `${at} is not in the action registry, so it is ${resolved.actionClass} and refused` }];
      const refusal = doorRefusal(action, binding, actions);
      if (refusal !== null) return [{ code: 'CONNECTOR_ACTION_DOOR_REFUSED', message: `the door refuses ${at} to a connector: ${refusal}` }];
      return entry['idempotency'] === 'read-only' && resolved.actionClass !== READ_ONLY_CLASS
        ? [{ code: 'CONNECTOR_IDEMPOTENCY_MISMATCH', message: `${label} says read-only, and ${at} is ${resolved.actionClass}` }]
        : [];
    }),
  ];
}

function entryProblems(raw: unknown, index: number, context: ConnectorContext, binding: TenantBinding): readonly ConnectorProblem[] {
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
    ...secretProblems(entry, context.tenants, label),
    ...listProblems(entry['dataCategories'], 'dataCategories', (item) => DATA_CATEGORY.test(item), label),
    ...((CONNECTOR_IDEMPOTENCY as readonly unknown[]).includes(entry['idempotency']) ? [] : [invalid(`${label} declares no known idempotency`)]),
    ...actionProblems(entry, context.actions, binding, label),
    ...(readInstant(entry['lastAcceptanceDate']) !== null ? [] : [invalid(`${label} has no readable lastAcceptanceDate`)]),
    ...releaseProblems(entry, label),
  ];
}

function headerProblems(root: Readonly<Record<string, unknown>>): readonly ConnectorProblem[] {
  return [
    ...unknownFieldProblems(root, HEADER_FIELDS, 'the connector registry'),
    ...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map((field) => invalid(`the connector registry has no ${field}`)),
    ...(root['schemaVersion'] === CONNECTOR_REGISTRY_SCHEMA_VERSION ? [] : [invalid('the connector registry has the wrong schemaVersion')]),
    ...(root['policy'] === CONNECTOR_REGISTRY_POLICY ? [] : [invalid('the connector registry has the wrong policy')]),
  ];
}

function duplicateProblems(entries: readonly unknown[]): readonly ConnectorProblem[] {
  const ids = entries.flatMap((entry) => textsOf([asRecord(entry)?.['connectorId']]));
  return ids.flatMap((id, index) => (ids.indexOf(id) === index ? [] : [{ code: 'CONNECTOR_REGISTRY_DUPLICATE' as const, message: `connectors[${index}] repeats an earlier connector's id` }]));
}

function freezeList(value: unknown): readonly string[] {
  return Object.freeze([...textsOf(value)]);
}

/** Everything here is on the plain copy and already judged, so only the lists need freezing. */
function connectorOf(raw: unknown): ConnectorEntry {
  const entry = asRecord(raw) as Readonly<Record<string, unknown>>;
  const release = asRecord(entry['releaseRecord']) as Readonly<Record<string, unknown>>;
  const releaseRecord = Object.freeze({ ...release, checklist: freezeList(release['checklist']), scenarios: freezeList(release['scenarios']) });
  const lists = { scopes: freezeList(entry['scopes']), dataCategories: freezeList(entry['dataCategories']), actions: freezeList(entry['actions']) };
  return Object.freeze({ ...entry, ...lists, releaseRecord }) as unknown as ConnectorEntry;
}

/** Every problem is reported, and any problem refuses all of it. An empty list is valid: that is today's file. */
export function parseConnectorRegistry(raw: unknown, context: ConnectorContext): ConnectorRegistryResult {
  const binding = probeBinding(context.tenants);
  if (binding === null) return { ok: false, problems: [{ code: 'CONNECTOR_TENANT_REGISTRY_INVALID', message: 'the tenant registry did not pass whole-file validation' }] };
  const root = asRecord(plainCopy(raw));
  if (root === null) return { ok: false, problems: [invalid('the connector registry is not an object')] };
  const connectors = itemsOf(root['connectors']);
  const problems: readonly ConnectorProblem[] = [
    ...headerProblems(root),
    ...(connectors === null ? [invalid('the connector registry declares no connectors list')] : []),
    ...(connectors ?? []).flatMap((entry, index) => entryProblems(entry, index, context, binding)),
    ...duplicateProblems(connectors ?? []),
  ];
  if (problems.length > 0) return { ok: false, problems };

  const registry: ConnectorRegistry = Object.freeze({ connectors: Object.freeze((connectors as readonly unknown[]).map(connectorOf)) });
  LIVE_REGISTRIES.add(registry);
  return { ok: true, registry };
}

/**
 * Why this connector's acceptance does not hold at `now`, or `null` when it does. A date after `now` is refused,
 * because it would hide staleness for as long as it stayed ahead, and no readable time is not a fresh time.
 */
export function connectorAcceptanceRefusal(connector: ConnectorEntry, now: string): string | null {
  const accepted = readInstant(connector.lastAcceptanceDate);
  const at = readInstant(now);
  if (accepted === null || at === null) return `the acceptance of '${connector.connectorId}' cannot be judged: a date is unreadable`;
  if (accepted > at) return `the acceptance of '${connector.connectorId}' is dated after now`;
  return at - accepted > CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS * DAY_MS
    ? `the acceptance of '${connector.connectorId}' is stale: older than ${CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS} days`
    : null;
}

/** What names one attempt of one call. */
interface ConnectorCallLine {
  readonly tenant: string;
  readonly connector: string;
  readonly action: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
}

/** Written before acting. With no valid receipt after it, this attempt is `outcome_unknown`. */
export interface ConnectorStart extends ConnectorCallLine {
  readonly envelopeId: string;
}

/** The standard execution receipt. Each field has a closed shape, so no content has anywhere to sit. */
export interface ConnectorReceipt extends ConnectorCallLine {
  readonly outcome: ConnectorOutcome;
  /** `null` exactly when the outcome is `succeeded`. */
  readonly errorCode: ConnectorErrorCode | null;
  /** A pointer to what the provider returned. A success without one has no evidence, and is refused. */
  readonly providerReceipt: string | null;
}

/** What an explicit reconciliation leaves: one attempt answered, on what evidence, by which admitted envelope. */
export interface ConnectorReconciliation extends ConnectorCallLine {
  readonly finding: ReconciliationFinding;
  readonly evidence: string;
  readonly reconciledBy: string;
  readonly reconcilerEnvelope: string;
  readonly reconciledAt: string;
}

export type ConnectorReceiptCode = 'RECEIPT_INVALID' | 'RECEIPT_ERROR_CODE_UNKNOWN' | 'RECEIPT_TENANT_MISMATCH' | 'RECEIPT_CALL_MISMATCH' | 'RECEIPT_CALL_UNADMITTED';

export type ConnectorReceiptResult = { readonly ok: true; readonly receipt: ConnectorReceipt } | { readonly ok: false; readonly code: ConnectorReceiptCode; readonly reasons: readonly string[] };

export type ConnectorErrorResult = { readonly ok: true; readonly code: ConnectorErrorCode } | { readonly ok: false; readonly code: 'CONNECTOR_ERROR_UNKNOWN'; readonly reasons: readonly string[] };

/** Exact text only: guessing `rate_limited` for a provider's `timeout` is how a write that happened gets retried. */
export function parseConnectorError(value: unknown): ConnectorErrorResult {
  return (CONNECTOR_ERROR_CODES as readonly unknown[]).includes(value)
    ? { ok: true, code: value as ConnectorErrorCode }
    : { ok: false, code: 'CONNECTOR_ERROR_UNKNOWN', reasons: ['the error is not a code of the connector contract'] };
}

function isAttempt(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

const RECEIPT_CHECKS: Readonly<Record<keyof ConnectorReceipt, (value: unknown) => boolean>> = {
  tenant: isTenantId,
  connector: (value) => matches(CONNECTOR_ID, value),
  action: isActionName,
  idempotencyKey: (value) => matches(IDEMPOTENCY_KEY, value),
  attempt: isAttempt,
  outcome: (value) => OUTCOMES.includes(value),
  errorCode: (value) => value === null || typeof value === 'string',
  providerReceipt: (value) => value === null || (matches(PROVIDER_RECEIPT, value) && isEvidence(value)),
};

function receiptRefused(code: ConnectorReceiptCode, reasons: readonly string[]): Extract<ConnectorReceiptResult, { ok: false }> {
  return { ok: false, code, reasons };
}

/** `outcome_unknown` is its own outcome: never a failure with a code, never a success. */
function outcomeProblem({ outcome, errorCode, providerReceipt }: ConnectorReceipt): string | null {
  if (outcome === 'succeeded') {
    if (errorCode !== null) return 'a success carries no error code';
    return providerReceipt === null ? 'a success points at its provider receipt' : null;
  }
  if (outcome === 'unknown') return errorCode === 'outcome_unknown' ? null : 'an unknown outcome carries outcome_unknown';
  return errorCode === null || errorCode === 'outcome_unknown' ? 'a failure names its code, and outcome_unknown is not a failure' : null;
}

/** A receipt as a connector presented it. An unknown field is refused: that is where content would go. */
export function parseConnectorReceipt(raw: unknown): ConnectorReceiptResult {
  const record = asRecord(plainCopy(raw));
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
  const receipt = Object.freeze(record) as unknown as ConnectorReceipt;
  if (receipt.errorCode !== null && !parseConnectorError(receipt.errorCode).ok) return receiptRefused('RECEIPT_ERROR_CODE_UNKNOWN', ['the receipt names an error that is not a code of the contract']);
  const problem = outcomeProblem(receipt);
  return problem === null ? { ok: true, receipt } : receiptRefused('RECEIPT_INVALID', [problem]);
}

type HistoryLine = ConnectorStart | ConnectorReceipt | ConnectorReconciliation;

function namesItsCall(record: Readonly<Record<string, unknown>>): boolean {
  return isTenantId(record['tenant']) && matches(CONNECTOR_ID, record['connector']) && isActionName(record['action']) && matches(IDEMPOTENCY_KEY, record['idempotencyKey']) && isAttempt(record['attempt']);
}

function parseStart(record: Readonly<Record<string, unknown>>): ConnectorStart | null {
  const sound = unknownFieldProblems(record, START_FIELDS, 'a start').length === 0 && namesItsCall(record) && matches(ENVELOPE_ID, record['envelopeId']);
  return sound ? (Object.freeze(record) as unknown as ConnectorStart) : null;
}

function parseReconciliation(record: Readonly<Record<string, unknown>>): ConnectorReconciliation | null {
  const known = (RECONCILIATION_FINDINGS as readonly unknown[]).includes(record['finding']) && isEvidence(record['evidence']);
  const signed = matches(RECONCILER, record['reconciledBy']) && matches(ENVELOPE_ID, record['reconcilerEnvelope']) && readInstant(record['reconciledAt']) !== null;
  const sound = unknownFieldProblems(record, RECONCILIATION_FIELDS, 'a reconciliation').length === 0 && namesItsCall(record) && known && signed;
  return sound ? (Object.freeze(record) as unknown as ConnectorReconciliation) : null;
}

function parseHistoryLine(raw: unknown): HistoryLine | null {
  const record = asRecord(raw);
  if (record === null) return null;
  if (Object.hasOwn(record, 'finding')) return parseReconciliation(record);
  if (Object.hasOwn(record, 'envelopeId')) return parseStart(record);
  const parsed = parseConnectorReceipt(record);
  return parsed.ok ? parsed.receipt : null;
}

/** All of it, or nothing. A line that cannot be read might be the line that says a write happened. */
function parseHistory(history: unknown): readonly HistoryLine[] | null {
  const lines = itemsOf(plainCopy(history))?.map(parseHistoryLine) ?? null;
  return lines === null || lines.some((line) => line === null) ? null : (lines as readonly HistoryLine[]);
}

interface KeyState {
  /** By attempt: the start of attempt `n` is at `n - 1`. */
  readonly starts: readonly ConnectorStart[];
  /** The attempt with a start and no receipt yet. */
  readonly awaiting: number | null;
  /** Attempts that are `outcome_unknown` with no answer, and attempts answered, so a copy can be told from a forgery. */
  readonly unanswered: readonly number[];
  readonly answered: readonly number[];
  readonly earlier: ConnectorReceipt | ConnectorReconciliation | null;
  readonly failures: readonly ConnectorErrorCode[];
  readonly lastRule: ConnectorRetryRule | null;
  readonly broken: boolean;
}

const NEW_KEY: KeyState = Object.freeze({ starts: [], awaiting: null, unanswered: [], answered: [], earlier: null, failures: [], lastRule: null, broken: false });

function afterStart(state: KeyState, line: ConnectorStart): KeyState {
  if (line.attempt !== state.starts.length + 1) return { ...state, broken: true };
  const unanswered = state.awaiting === null ? state.unanswered : [...state.unanswered, state.awaiting];
  return { ...state, starts: [...state.starts, line], awaiting: line.attempt, unanswered };
}

/** A receipt closes its own start and nothing else. With no start to close, a line has been lost or invented. */
function afterReceipt(state: KeyState, line: ConnectorReceipt): KeyState {
  if (state.awaiting !== line.attempt || state.starts[line.attempt - 1]?.connector !== line.connector) return { ...state, broken: true };
  const closed = { ...state, awaiting: null };
  if (line.outcome === 'succeeded') return { ...closed, earlier: state.earlier ?? line };
  if (line.outcome === 'unknown') return { ...closed, unanswered: [...state.unanswered, line.attempt] };
  const code = line.errorCode as ConnectorErrorCode;
  return { ...closed, failures: [...state.failures, code], lastRule: CONNECTOR_RETRY_RULES[code] };
}

/** A copy of an earlier answer, or one for another connector, answers nothing. One for an attempt never open is a contradiction. */
function afterReconciliation(state: KeyState, line: ConnectorReconciliation): KeyState {
  const open = state.awaiting === line.attempt || state.unanswered.includes(line.attempt);
  if (!open) return state.answered.includes(line.attempt) ? state : { ...state, broken: true };
  if (state.starts[line.attempt - 1]?.connector !== line.connector) return state;
  return {
    ...state,
    awaiting: state.awaiting === line.attempt ? null : state.awaiting,
    unanswered: state.unanswered.filter((attempt) => attempt !== line.attempt),
    answered: [...state.answered, line.attempt],
    lastRule: 'after-reconciliation',
    earlier: state.earlier ?? (line.finding === 'completed' ? line : null),
  };
}

function afterLine(state: KeyState, line: HistoryLine): KeyState {
  if ('finding' in line) return afterReconciliation(state, line);
  return 'outcome' in line ? afterReceipt(state, line) : afterStart(state, line);
}

/** `null` if the history contradicts itself. A key is one intent, so one tenant. */
function stateOfKey(lines: readonly HistoryLine[], idempotencyKey: string, tenant: string): KeyState | null {
  const own = lines.filter((line) => line.idempotencyKey === idempotencyKey);
  const contradicts = own.some((line) => line.tenant !== tenant) || new Set(own.map((line) => line.action)).size > 1;
  const state = own.reduce(afterLine, NEW_KEY);
  return contradicts || state.broken ? null : state;
}

function openAttempts(state: KeyState): readonly number[] {
  return state.awaiting === null ? state.unanswered : [...state.unanswered, state.awaiting];
}

/** What only the kernel can say. `true` counts; anything else has not happened. */
export interface ConnectorRetryFacts {
  readonly reauthenticated: boolean;
  readonly approved: boolean;
}

export type ConnectorRetryCode =
  | 'RETRY_KEY_INVALID' | 'RETRY_HISTORY_INVALID' | 'RETRY_UNRECONCILED' | 'RETRY_ALREADY_COMPLETED' | 'RETRY_NEVER'
  | 'RETRY_NEEDS_REAUTHENTICATION' | 'RETRY_NEEDS_APPROVAL' | 'RETRY_ATTEMPTS_EXHAUSTED';

/** ADR-K1 §2: a duplicate returns the earlier outcome. */
export type ConnectorRetryRefusal = { readonly allowed: false; readonly code: ConnectorRetryCode; readonly reasons: readonly string[]; readonly earlier?: ConnectorReceipt | ConnectorReconciliation };

export type ConnectorRetryDecision = { readonly allowed: true; readonly attempt: number; readonly rule: 'first-attempt' | ConnectorRetryRule } | ConnectorRetryRefusal;

function retryRefused(code: ConnectorRetryCode, reason: string): ConnectorRetryRefusal {
  return { allowed: false, code, reasons: [reason] };
}

/** A stop reads the whole history: a later rate limit says nothing about an earlier refusal. */
function retryStop(state: KeyState, facts: ConnectorRetryFacts): ConnectorRetryRefusal | null {
  const rules = state.failures.map((code) => CONNECTOR_RETRY_RULES[code]);
  if (rules.includes('never')) return retryRefused('RETRY_NEVER', 'this cannot succeed under this key: a changed request is a new intent');
  if (rules.includes('after-reauthentication') && facts.reauthenticated !== true) return retryRefused('RETRY_NEEDS_REAUTHENTICATION', 'the connector needs re-authenticating first');
  if (rules.includes('after-approval') && facts.approved !== true) return retryRefused('RETRY_NEEDS_APPROVAL', 'this needs an approval first');
  return null;
}

/** IN THIS ORDER, AND THE ORDER IS THE RULE: no other line can say whether an unanswered write happened. */
function judgeRetry(state: KeyState, facts: ConnectorRetryFacts): ConnectorRetryDecision {
  if (openAttempts(state).length > 0) return retryRefused('RETRY_UNRECONCILED', 'an earlier attempt is outcome_unknown and has not been reconciled');
  if (state.earlier !== null) return { ...retryRefused('RETRY_ALREADY_COMPLETED', 'this key already completed, so it does not run again'), earlier: state.earlier };
  if (state.starts.length === 0) return { allowed: true, attempt: 1, rule: 'first-attempt' };
  const stop = retryStop(state, facts);
  if (stop !== null) return stop;
  if (state.starts.length >= CONNECTOR_MAX_ATTEMPTS) return retryRefused('RETRY_ATTEMPTS_EXHAUSTED', `this key has used its ${CONNECTOR_MAX_ATTEMPTS} attempts`);
  return { allowed: true, attempt: state.starts.length + 1, rule: state.lastRule as ConnectorRetryRule };
}

/** The whole history is read first: one unreadable line refuses, even for another key, because the store is suspect. */
export function decideConnectorRetry(history: unknown, idempotencyKey: string, tenant: string, facts: ConnectorRetryFacts): ConnectorRetryDecision {
  if (!matches(IDEMPOTENCY_KEY, idempotencyKey)) return retryRefused('RETRY_KEY_INVALID', 'that is not an idempotency key');
  const lines = parseHistory(history);
  const state = lines === null ? null : stateOfKey(lines, idempotencyKey, tenant);
  return state === null ? retryRefused('RETRY_HISTORY_INVALID', 'the attempt history cannot be trusted') : judgeRetry(state, facts);
}

/** `recordExecution` is the one public question that reveals admission. This recorder writes nothing, so asking leaves no line. */
function admittedAtTheDoor(envelope: TaskEnvelope, now: string): boolean {
  return recordExecution(envelope, 'allowed', null, now, () => true);
}

export interface ConnectorReconciliationRequest {
  readonly idempotencyKey: string;
  readonly finding: ReconciliationFinding;
  readonly evidence: string;
  /** Admitted at the door for `CONNECTOR_RECONCILE_ACTION`, in the tenant of the attempt. */
  readonly envelope: TaskEnvelope;
  readonly actions: ActionRegistry;
  readonly now: string;
}

export type ConnectorReconciliationCode = 'RETRY_HISTORY_INVALID' | 'RECONCILE_ACTION_UNREGISTERED' | 'RECONCILE_CLASS_TOO_LOW' | 'RECONCILE_UNAUTHORISED' | 'RECONCILE_NOTHING_OPEN' | 'RECONCILE_EVIDENCE_REQUIRED' | 'RECONCILE_INVALID';

export type ConnectorReconciliationResult = { readonly ok: true; readonly record: ConnectorReconciliation; readonly history: readonly unknown[] } | { readonly ok: false; readonly code: ConnectorReconciliationCode; readonly reasons: readonly string[] };

function reconciliationRefused(code: ConnectorReconciliationCode, reason: string): Extract<ConnectorReconciliationResult, { ok: false }> {
  return { ok: false, code, reasons: [reason] };
}

/** Answers the oldest open attempt, in a new history. Until the caller stores it, nothing has been reconciled. */
export function reconcileConnectorOutcome(history: unknown, request: ConnectorReconciliationRequest): ConnectorReconciliationResult {
  const { idempotencyKey, finding, evidence, envelope, actions, now } = request;
  const resolved = resolveAction(actions, CONNECTOR_RECONCILE_ACTION);
  if (!resolved.registered) return reconciliationRefused('RECONCILE_ACTION_UNREGISTERED', `'${CONNECTOR_RECONCILE_ACTION}' is not in the action registry yet`);
  if (!classAtMost(RECONCILE_CLASS_FLOOR, resolved.actionClass)) return reconciliationRefused('RECONCILE_CLASS_TOO_LOW', `'${CONNECTOR_RECONCILE_ACTION}' must be ${RECONCILE_CLASS_FLOOR} or higher, and is ${resolved.actionClass}`);
  const lines = parseHistory(history);
  if (lines === null) return reconciliationRefused('RETRY_HISTORY_INVALID', 'the attempt history cannot be trusted');
  const foreign = lines.some((line) => line.idempotencyKey === idempotencyKey && line.tenant !== envelope.tenant);
  if (!admittedAtTheDoor(envelope, now) || envelopeExpired(envelope, now) || envelope.action !== CONNECTOR_RECONCILE_ACTION || envelope.actionClass !== resolved.actionClass || foreign) {
    return reconciliationRefused('RECONCILE_UNAUTHORISED', 'a reconciliation comes through an admitted, unexpired reconcile envelope of the same tenant');
  }
  const state = stateOfKey(lines, idempotencyKey, envelope.tenant);
  if (state === null) return reconciliationRefused('RETRY_HISTORY_INVALID', 'the attempt history cannot be trusted');
  const attempt = openAttempts(state)[0];
  if (attempt === undefined) return reconciliationRefused('RECONCILE_NOTHING_OPEN', 'no outcome_unknown is open under this key');
  if (!isEvidence(evidence)) return reconciliationRefused('RECONCILE_EVIDENCE_REQUIRED', 'a reconciliation points at its evidence, and this does not');
  if (!(RECONCILIATION_FINDINGS as readonly unknown[]).includes(finding)) return reconciliationRefused('RECONCILE_INVALID', 'a reconciliation states a known finding');
  const { tenant, connector, action } = state.starts[attempt - 1] as ConnectorStart;
  const record: ConnectorReconciliation = Object.freeze({ tenant, connector, action, idempotencyKey, attempt, finding, evidence, reconciledBy: envelope.principal, reconcilerEnvelope: envelope.envelopeId, reconciledAt: now });
  return { ok: true, record, history: Object.freeze([...lines, record]) };
}

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
  | 'CONNECTOR_REGISTRY_INVALID' | 'CONNECTOR_ENVELOPE_NOT_ADMITTED' | 'CONNECTOR_ENVELOPE_EXPIRED' | 'CONNECTOR_UNKNOWN' | 'CONNECTOR_CROSS_TENANT'
  | 'CONNECTOR_ACTION_UNDECLARED' | 'CONNECTOR_ACTION_UNREGISTERED' | 'CONNECTOR_IDEMPOTENCY_MISMATCH' | 'CONNECTOR_ACCEPTANCE_STALE' | ConnectorRetryCode;

export type ConnectorAdmission =
  /** `started` must be stored before anything acts: it is what stops a retry after a crash. */
  | { readonly admitted: true; readonly call: ConnectorCall; readonly started: ConnectorStart }
  | { readonly admitted: false; readonly code: ConnectorGateCode; readonly reasons: readonly string[]; readonly earlier?: ConnectorReceipt | ConnectorReconciliation };

function callRefused(code: ConnectorGateCode, reasons: readonly string[]): Extract<ConnectorAdmission, { admitted: false }> {
  return { admitted: false, code, reasons };
}

/** THE GATE. Expiry and class are asked again here because R7 checks at execution and a registry can move after acceptance. */
export function admitConnectorCall(request: ConnectorCallRequest): ConnectorAdmission {
  const { registry, actions, connectorId, envelope, history, facts, now } = request;
  if (!LIVE_REGISTRIES.has(registry)) return callRefused('CONNECTOR_REGISTRY_INVALID', ['this registry did not pass whole-file validation']);
  if (!admittedAtTheDoor(envelope, now)) return callRefused('CONNECTOR_ENVELOPE_NOT_ADMITTED', ['this envelope was not admitted at the door']);
  if (envelopeExpired(envelope, now)) return callRefused('CONNECTOR_ENVELOPE_EXPIRED', [`the envelope expired at ${envelope.expiry}`]);
  const connector = registry.connectors.find((candidate) => candidate.connectorId === connectorId);
  if (connector === undefined) return callRefused('CONNECTOR_UNKNOWN', ['no connector by that id is registered']);
  if (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain) return callRefused('CONNECTOR_CROSS_TENANT', [`'${connector.connectorId}' belongs to ${connector.tenant}/${connector.domain}, and this work is ${envelope.tenant}/${envelope.domain}`]);
  if (!connector.actions.includes(envelope.action)) return callRefused('CONNECTOR_ACTION_UNDECLARED', [`'${connector.connectorId}' does not declare '${envelope.action}'`]);
  const resolved = resolveAction(actions, envelope.action);
  if (!resolved.registered) return callRefused('CONNECTOR_ACTION_UNREGISTERED', [`'${envelope.action}' is not in the action registry, so it is ${resolved.actionClass} and refused`]);
  if (connector.idempotency === 'read-only' && resolved.actionClass !== READ_ONLY_CLASS) return callRefused('CONNECTOR_IDEMPOTENCY_MISMATCH', [`'${connector.connectorId}' says read-only, and '${envelope.action}' is now ${resolved.actionClass}`]);
  const lapsed = connectorAcceptanceRefusal(connector, now);
  if (lapsed !== null) return callRefused('CONNECTOR_ACCEPTANCE_STALE', [lapsed]);
  const retry = decideConnectorRetry(history, envelope.idempotencyKey, envelope.tenant, facts);
  if (!retry.allowed) return { ...callRefused(retry.code, retry.reasons), ...(retry.earlier === undefined ? {} : { earlier: retry.earlier }) };
  const call: ConnectorCall = Object.freeze({ connector, envelope, attempt: retry.attempt });
  LIVE_CALLS.add(call);
  const { tenant, action, idempotencyKey, envelopeId } = envelope;
  return { admitted: true, call, started: Object.freeze({ tenant, connector: connector.connectorId, action, idempotencyKey, attempt: retry.attempt, envelopeId }) };
}

/** The tenant is compared on its own: a receipt in another tenant is a boundary failure, not a bookkeeping one. */
export function checkConnectorReceipt(raw: unknown, call: ConnectorCall): ConnectorReceiptResult {
  if (!LIVE_CALLS.has(call)) return receiptRefused('RECEIPT_CALL_UNADMITTED', ['the gate did not admit this call']);
  const parsed = parseConnectorReceipt(raw);
  if (!parsed.ok) return parsed;
  const { receipt } = parsed;
  const { connector, envelope, attempt } = call;
  if (receipt.tenant !== envelope.tenant) return receiptRefused('RECEIPT_TENANT_MISMATCH', [`the receipt is for ${receipt.tenant}, and the envelope is ${envelope.tenant}`]);
  const expected = { connector: connector.connectorId, action: envelope.action, idempotencyKey: envelope.idempotencyKey, attempt } as const;
  const differs = (Object.keys(expected) as readonly (keyof typeof expected)[]).filter((field) => receipt[field] !== expected[field]);
  return differs.length > 0 ? receiptRefused('RECEIPT_CALL_MISMATCH', differs.map((field) => `the receipt's ${field} is not the call's`)) : parsed;
}
