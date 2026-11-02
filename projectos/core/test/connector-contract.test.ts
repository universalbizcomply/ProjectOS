/**
 * The connector contract: the registry, the release gate, the error vocabulary, the retry rule, the
 * execution receipt and the nine acceptance scenarios (PROJECTOS-CONNECTOR-CONTRACT1A).
 *
 * Each refusal stands next to a positive control, so a default cannot pass for the rule. The tenants, the
 * envelopes and the door are the real ones, read from the committed records. Every credential below is
 * assembled from pieces at run time and is not one: there are no real secrets in this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import {
  ACCEPTANCE_SCENARIOS,
  admitConnectorCall,
  checkConnectorReceipt,
  connectorAcceptanceRefusal,
  CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS,
  CONNECTOR_ERROR_CODES,
  CONNECTOR_MAX_ATTEMPTS,
  CONNECTOR_RETRY_RULES,
  decideConnectorRetry,
  parseConnectorError,
  parseConnectorReceipt,
  parseConnectorRegistry,
  reconcileConnectorOutcome,
  RELEASE_CHECKLIST,
  scenarioTally,
  type ConnectorAdmission,
  type ConnectorCall,
  type ConnectorRegistry,
  type ConnectorRetryFacts,
} from '../src/connectorContract.js';
import * as barrel from '../src/index.js';
import { admitEnvelope, deriveIdempotencyKey, mintEnvelope, type EnvelopeRequest, type TaskEnvelope } from '../src/taskEnvelope.js';
import { parseTenantRegistry, resolveTenant, type CheckoutFacts, type TenantBinding, type TenantRegistry } from '../src/tenant.js';

type Raw = Record<string, unknown>;

const record = (name: string): Raw =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8')) as Raw;

function actionsFrom(raw: Raw): ActionRegistry {
  const parsed = parseActionRegistry(raw);
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const actions = (): ActionRegistry => actionsFrom(record('security/action-registry.json'));

/** The committed registry plus one action: a connector's own action is not registered until Stage 5. */
function actionsWith(id: string, cls: string): ActionRegistry {
  const raw = record('security/action-registry.json');
  return actionsFrom({ ...raw, actions: [...(raw['actions'] as unknown[]), { id, governanceAction: null, ownerOnlyAction: null, class: cls, environment: 'production' }] });
}

function tenants(): TenantRegistry {
  const parsed = parseTenantRegistry(record('security/tenant-registry.json'));
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const OWNER_FACTS: CheckoutFacts = { projectId: 'polygo', repository: 'github.com/polygonia-apres/polygo', root: 'C:/dev/Polygo/polygo', worktrees: null };
const AGENCY_FACTS: CheckoutFacts = { projectId: 'seo-agency', repository: '127.0.0.1:47900/SEOAgency-remote/seo-agency', root: 'C:/dev/SEOAgency', worktrees: null };

function binding(facts: CheckoutFacts): TenantBinding {
  const resolved = resolveTenant(tenants(), facts);
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  return resolved.binding;
}

const NOW = '2026-11-01T12:00:00.000Z';
const LATER = '2026-11-01T13:00:00.000Z';
const ACCEPTED = '2026-10-15T09:00:00.000Z';
const MAX_AGE_MS = CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

const SCENARIO_IDS = [
  'cross-tenant-denial',
  'duplicate-webhook-delivery',
  'expired-approval',
  'token-revocation',
  'prompt-injection-in-retrieved-content',
  'process-crash-after-write',
  'cancellation',
  'missing-evidence',
  'provider-outage',
];

const passingRelease = (over: Raw = {}): Raw => ({
  connectorId: 'fixture-mail',
  version: '1.0.0',
  tenant: 'agency-business',
  result: 'passed',
  acceptedAt: ACCEPTED,
  checklist: [...RELEASE_CHECKLIST],
  scenarios: [...SCENARIO_IDS],
  evidence: 'docs/finish/FIXTURE-CONNECTOR.md',
  ...over,
});

const entry = (over: Raw = {}): Raw => ({
  connectorId: 'fixture-mail',
  version: '1.0.0',
  tenant: 'agency-business',
  domain: 'business',
  scopes: ['mail.read'],
  secretReference: 'ProjectOS/tenant.agency-business/production/google/mail-refresh',
  dataCategories: ['enquiry-text'],
  idempotency: 'read-only',
  actions: ['bridge-read'],
  lastAcceptanceDate: ACCEPTED,
  releaseRecord: passingRelease(),
  ...over,
});

/** A second tenant's connector, complete in its own right. */
const ownerEntry = (over: Raw = {}): Raw =>
  entry({
    connectorId: 'fixture-calendar',
    tenant: 'owner-personal',
    domain: 'develop',
    secretReference: 'ProjectOS/tenant.owner-personal/production/google/calendar-refresh',
    releaseRecord: passingRelease({ connectorId: 'fixture-calendar', tenant: 'owner-personal' }),
    ...over,
  });

const file = (connectors: readonly unknown[], over: Raw = {}): Raw => ({
  schemaVersion: '1.0.0',
  policy: 'connector-registry',
  note: 'Fixture.',
  authority: 'owner',
  authorisedBy: 'Murad',
  provenance: 'Fixture.',
  trustBasis: 'Fixture.',
  connectors,
  ...over,
});

const context = (actionRegistry: ActionRegistry = actions()) => ({ actions: actionRegistry, tenants: tenants() });
const codes = (raw: unknown, actionRegistry?: ActionRegistry): readonly string[] => {
  const parsed = parseConnectorRegistry(raw, context(actionRegistry));
  return parsed.ok ? [] : parsed.problems.map((problem) => problem.code);
};

function registryOf(connectors: readonly unknown[], actionRegistry?: ActionRegistry): ConnectorRegistry {
  const parsed = parseConnectorRegistry(file(connectors), context(actionRegistry));
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const NO_FACTS: ConnectorRetryFacts = { reauthenticated: false, approved: false };
const ACTOR = { agent: 'claude-code-cli', provider: 'anthropic', model: 'claude-opus-5-5' };
const REQUEST: EnvelopeRequest = { action: 'bridge-read', subjectHash: 'a'.repeat(40), scope: ['mail'], budget: 0, expiry: LATER, intentScope: 'RUN-1' };

let nextEnvelope = 1;
function mint(boundTo: TenantBinding, request: Partial<EnvelopeRequest> = {}, registry: ActionRegistry = actions()) {
  const envelopeId = `ENV-${String(nextEnvelope++).padStart(24, '0')}`;
  return mintEnvelope({ binding: boundTo, registry, principal: 'implementer', actor: ACTOR, envelopeId }, { ...REQUEST, ...request });
}

/** An envelope through the real door. */
function admitted(boundTo: TenantBinding, request: Partial<EnvelopeRequest> = {}, registry: ActionRegistry = actions()): TaskEnvelope {
  const admission = admitEnvelope(mint(boundTo, request, registry), NOW, () => true, () => true);
  if (!admission.admitted) throw new Error(admission.reasons.join('; '));
  return admission.envelope;
}

const agencyEnvelope = (request: Partial<EnvelopeRequest> = {}, registry?: ActionRegistry): TaskEnvelope => admitted(binding(AGENCY_FACTS), request, registry);
const ownerEnvelope = (request: Partial<EnvelopeRequest> = {}, registry?: ActionRegistry): TaskEnvelope => admitted(binding(OWNER_FACTS), request, registry);

interface GateRequest {
  readonly registry: ConnectorRegistry;
  readonly actions: ActionRegistry;
  readonly connectorId: string;
  readonly envelope: TaskEnvelope;
  readonly history: unknown;
  readonly facts: ConnectorRetryFacts;
  readonly now: string;
}

function gate(over: Partial<GateRequest> = {}): ConnectorAdmission {
  return admitConnectorCall({
    registry: registryOf([entry()]),
    actions: actions(),
    connectorId: 'fixture-mail',
    envelope: agencyEnvelope(),
    history: [],
    facts: NO_FACTS,
    now: NOW,
    ...over,
  });
}

function call(over: Partial<GateRequest> = {}): ConnectorCall {
  const admission = gate(over);
  if (!admission.admitted) throw new Error(admission.reasons.join('; '));
  return admission.call;
}

const KEY = `sha256:${'b'.repeat(64)}`;
const OTHER_KEY = `sha256:${'c'.repeat(64)}`;

const receipt = (over: Raw = {}): Raw => ({
  tenant: 'agency-business',
  connector: 'fixture-mail',
  action: 'bridge-read',
  idempotencyKey: KEY,
  outcome: 'succeeded',
  errorCode: null,
  ...over,
});

const failed = (errorCode: string, over: Raw = {}): Raw => receipt({ outcome: 'failed', errorCode, ...over });
const unknown = (over: Raw = {}): Raw => receipt({ outcome: 'unknown', errorCode: 'outcome_unknown', ...over });
const reconciliation = (finding: string, over: Raw = {}): Raw => ({
  tenant: 'agency-business',
  connector: 'fixture-mail',
  action: 'bridge-read',
  idempotencyKey: KEY,
  finding,
  evidence: 'provider:message-4471',
  reconciledBy: 'owner',
  reconciledAt: NOW,
  ...over,
});

const FAKE_PREFIXED = ['sk', 'ant', 'api03', 'abcdefghij', 'klmnopqrst', 'uvwxyz0123'].join('-');
const FAKE_BARE = 'a1B2'.repeat(10);
const FAKE_JWT = ['eyJ', 'abcdefghij_klmnopqrst', '.', 'b'.repeat(12)].join('');

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('the registry file', () => {
  it('the committed registry is empty and valid: zero live connectors', () => {
    const raw = record('connectors/registry.json');
    const parsed = parseConnectorRegistry(raw, context());
    expect(parsed.ok).toBe(true);
    expect(raw['connectors']).toEqual([]);
    expect(parsed.ok && parsed.registry.connectors).toEqual([]);
  });

  it('a complete entry is accepted: the positive control for every refusal below', () => {
    const parsed = parseConnectorRegistry(file([entry(), ownerEntry()]), context());
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.registry.connectors.map((connector) => connector.connectorId)).toEqual(['fixture-mail', 'fixture-calendar']);
  });

  it('declares what the phase requires, and copies it across', () => {
    const parsed = parseConnectorRegistry(file([entry()]), context());
    const connector = parsed.ok ? parsed.registry.connectors[0] : undefined;
    expect(connector).toMatchObject({
      tenant: 'agency-business',
      domain: 'business',
      scopes: ['mail.read'],
      secretReference: 'ProjectOS/tenant.agency-business/production/google/mail-refresh',
      dataCategories: ['enquiry-text'],
      idempotency: 'read-only',
      actions: ['bridge-read'],
      lastAcceptanceDate: ACCEPTED,
    });
    expect(connector?.releaseRecord).toEqual(passingRelease());
  });

  it.each([
    ['not an object', 'text'],
    ['an array', []],
    ['null', null],
    ['no connectors list', (() => { const { connectors: _gone, ...rest } = file([]); return rest; })()],
    ['a connectors field that is not a list', file([], { connectors: {} })],
    ['the wrong schema version', file([], { schemaVersion: '2.0.0' })],
    ['the wrong policy', file([], { policy: 'tenant-registry' })],
    ['no authority', file([], { authority: ' ' })],
    ['a connector that is not an object', file(['fixture-mail'])],
  ])('malformed input fails closed: %s', (_label, raw) => {
    expect(codes(raw)).toContain('CONNECTOR_REGISTRY_INVALID');
  });

  it.each([
    ['the header', file([], { tenantOverride: 'owner-personal' })],
    ['an entry', file([entry({ tenantOverride: 'owner-personal' })])],
    ['a release record', file([entry({ releaseRecord: passingRelease({ reviewerOverride: true }) })])],
  ])('an unknown field in %s is refused', (_label, raw) => {
    expect(codes(raw)).toContain('CONNECTOR_REGISTRY_INVALID');
  });

  it('a field named __proto__ is an unknown field, not a way in', () => {
    const raw = JSON.parse(JSON.stringify(file([entry()])).replace('"connectorId":"fixture-mail"', '"__proto__":{"tenant":"owner-personal"},"connectorId":"fixture-mail"')) as Raw;
    expect(codes(raw)).toContain('CONNECTOR_REGISTRY_INVALID');
  });

  it.each([
    ['connectorId', { connectorId: 'fixture mail' }],
    ['version', { version: 'latest' }],
    ['domain', { domain: 'everything' }],
    ['scopes as no list', { scopes: 'mail.read' }],
    ['an empty scopes list', { scopes: [] }],
    ['a sparse scopes list', { scopes: new Array(2) }],
    ['a scope that is not text', { scopes: [7] }],
    ['a scope with a space', { scopes: ['mail read'] }],
    ['an empty dataCategories list', { dataCategories: [] }],
    ['a data category with a space', { dataCategories: ['enquiry text'] }],
    ['an unknown idempotency', { idempotency: 'best-effort' }],
    ['no idempotency', { idempotency: undefined }],
    ['an empty actions list', { actions: [] }],
    ['an action that is not a name', { actions: ['Bridge Read'] }],
    ['an unreadable lastAcceptanceDate', { lastAcceptanceDate: 'last week' }],
  ])('a bad %s refuses the whole file, by name', (_label, over) => {
    expect(codes(file([ownerEntry(), entry(over)]))).toContain('CONNECTOR_REGISTRY_INVALID');
  });

  it.each([
    ['connectorId', { connectorId: 'fixture-*' }],
    ['a scope', { scopes: ['mail.*'] }],
    ['a data category', { dataCategories: ['enquiry-?'] }],
    ['an action', { actions: ['bridge-*'] }],
    ['the tenant', { tenant: 'agency-*' }],
  ])('a wildcard in %s is named as a wildcard, ahead of the shape rule that would also refuse it', (_label, over) => {
    expect(codes(file([entry(over)]))).toContain('CONNECTOR_REGISTRY_WILDCARD');
  });

  it('one bad line refuses the good lines too: no registry is returned', () => {
    const parsed = parseConnectorRegistry(file([ownerEntry(), entry({ tenant: undefined })]), context());
    expect(parsed.ok).toBe(false);
  });

  it('a connector listed twice refuses the whole file', () => {
    expect(codes(file([entry(), entry()]))).toContain('CONNECTOR_REGISTRY_DUPLICATE');
  });

  it.each([
    ['scopes', { scopes: ['mail.read', 'mail.read'] }],
    ['dataCategories', { dataCategories: ['enquiry-text', 'enquiry-text'] }],
    ['actions', { actions: ['bridge-read', 'bridge-read'] }],
  ])('a repeated value in %s is refused', (_label, over) => {
    expect(codes(file([entry(over)]))).toContain('CONNECTOR_REGISTRY_DUPLICATE');
  });
});

describe('what a connector must declare', () => {
  it('a connector with no tenant is refused, by name', () => {
    expect(codes(file([entry({ tenant: undefined })]))).toContain('CONNECTOR_TENANT_MISSING');
    expect(codes(file([entry({ tenant: '' })]))).toContain('CONNECTOR_TENANT_MISSING');
  });

  it('a tenant the tenant registry does not declare is refused: it is not the owner by default', () => {
    expect(codes(file([entry({ tenant: 'someone-else', releaseRecord: passingRelease({ tenant: 'someone-else' }) })]))).toContain('CONNECTOR_TENANT_UNKNOWN');
  });

  it('a connector with no secret reference is refused, by name', () => {
    expect(codes(file([entry({ secretReference: undefined })]))).toContain('CONNECTOR_SECRET_MISSING');
    expect(codes(file([entry({ secretReference: ' ' })]))).toContain('CONNECTOR_SECRET_MISSING');
    expect(codes(file([entry({ secretReference: 7 })]))).toContain('CONNECTOR_SECRET_MISSING');
  });

  it('a connector with no release record is refused, by name', () => {
    expect(codes(file([entry({ releaseRecord: undefined })]))).toContain('CONNECTOR_RELEASE_MISSING');
    expect(codes(file([entry({ releaseRecord: null })]))).toContain('CONNECTOR_RELEASE_MISSING');
    expect(codes(file([entry({ releaseRecord: 'passed' })]))).toContain('CONNECTOR_RELEASE_MISSING');
  });

  it.each([
    ['a prefixed key alone', FAKE_PREFIXED],
    ['a prefixed key as the last segment', `ProjectOS/tenant.agency-business/production/google/${FAKE_PREFIXED}`],
    ['a bare long run as the last segment', `ProjectOS/tenant.agency-business/production/google/${FAKE_BARE}`],
    ['a signed token alone', FAKE_JWT],
  ])('%s in the reference field is refused as a raw credential, and not repeated', (_label, value) => {
    const parsed = parseConnectorRegistry(file([entry({ secretReference: value })]), context());
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.map((problem) => problem.code)).toContain('CONNECTOR_SECRET_VALUE');
    expect(JSON.stringify(parsed.problems)).not.toContain(value);
  });

  it.each([
    ['too few segments', 'ProjectOS/tenant.agency-business/google'],
    ['the wrong root', 'Vault/tenant.agency-business/production/google/mail-refresh'],
    ['an unknown environment', 'ProjectOS/tenant.agency-business/live/google/mail-refresh'],
    ['a traversal segment', 'ProjectOS/tenant.agency-business/production/../mail-refresh'],
    ['the platform key, as it is really named', 'OPENAI_GATEKEEPER_KEY'],
  ])('a reference with %s is refused: it is not a reference', (_label, value) => {
    expect(codes(file([entry({ secretReference: value })]))).toContain('CONNECTOR_SECRET_REFERENCE_INVALID');
  });

  it.each([
    ['another tenant', 'ProjectOS/tenant.owner-personal/production/google/mail-refresh'],
    ['a project of another tenant', 'ProjectOS/polygo/production/google/mail-refresh'],
    ['a project the registry does not list', 'ProjectOS/unlisted/production/google/mail-refresh'],
    ['the reserved prefix in another case', 'ProjectOS/TENANT.owner-personal/production/google/mail-refresh'],
  ])('a reference to %s is refused: a connector reads only its own tenant', (_label, value) => {
    expect(codes(file([entry({ secretReference: value })]))).toContain('CONNECTOR_SECRET_WRONG_TENANT');
  });

  it('a project-class reference inside its own tenant is accepted: the rule is the tenant, not the class', () => {
    expect(codes(file([entry({ secretReference: 'ProjectOS/seo-agency/production/google/mail-refresh' })]))).toEqual([]);
  });

  it('the reserved prefix in another case still names its own tenant', () => {
    expect(codes(file([entry({ secretReference: 'ProjectOS/Tenant.agency-business/production/google/mail-refresh' })]))).toEqual([]);
  });

  it('a read-only connector may hold only P1 actions: the class is looked up, not said', () => {
    expect(codes(file([entry({ actions: ['bridge-read', 'broker-call'] })]))).toContain('CONNECTOR_IDEMPOTENCY_MISMATCH');
    expect(codes(file([entry({ idempotency: 'provider-key', actions: ['bridge-read', 'broker-call'] })]))).toEqual([]);
  });
});

describe('the release record', () => {
  it.each([
    ['a failed result', { result: 'failed' }],
    ['no result', { result: undefined }],
    ['a truthy result', { result: true }],
    ['a checklist item missing', { checklist: RELEASE_CHECKLIST.slice(1) }],
    ['a repeated checklist item', { checklist: [...RELEASE_CHECKLIST.slice(1), RELEASE_CHECKLIST[1]] }],
    ['an extra checklist item', { checklist: [...RELEASE_CHECKLIST, 'looked-fine'] }],
    ['an invented checklist item', { checklist: [...RELEASE_CHECKLIST.slice(1), 'looked-fine'] }],
    ['a scenario missing', { scenarios: SCENARIO_IDS.slice(1) }],
    ['an invented scenario', { scenarios: [...SCENARIO_IDS.slice(1), 'looked-fine'] }],
    ['an extra scenario', { scenarios: [...SCENARIO_IDS, 'looked-fine'] }],
    ['no evidence', { evidence: '' }],
    ['evidence that is prose', { evidence: 'it worked on my machine' }],
    ['evidence holding a credential', { evidence: `provider:${FAKE_PREFIXED}` }],
  ])('%s is not a passing record', (_label, over) => {
    expect(codes(file([entry({ releaseRecord: passingRelease(over) })]))).toContain('CONNECTOR_RELEASE_NOT_PASSED');
  });

  it.each([
    ['another connector', { connectorId: 'fixture-other' }],
    ['another version', { version: '0.9.0' }],
    ['another tenant', { tenant: 'owner-personal' }],
    ['another acceptance date', { acceptedAt: '2026-10-14T09:00:00.000Z' }],
  ])('a release record for %s is refused', (_label, over) => {
    expect(codes(file([entry({ releaseRecord: passingRelease(over) })]))).toContain('CONNECTOR_RELEASE_MISMATCH');
  });

  it('a new version needs a new record: the old pass does not carry over', () => {
    expect(codes(file([entry({ version: '1.1.0' })]))).toContain('CONNECTOR_RELEASE_MISMATCH');
  });

  it('names exactly the blueprint checklist', () => {
    expect(RELEASE_CHECKLIST).toEqual([
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
    ]);
  });
});

describe('the acceptance date', () => {
  const connector = () => registryOf([entry()]).connectors[0] as NonNullable<ConnectorRegistry['connectors'][number]>;
  const after = (ms: number): string => new Date(Date.parse(ACCEPTED) + ms).toISOString();

  it('is judged against the time handed in, with no clock of its own', () => {
    expect(connectorAcceptanceRefusal(connector(), NOW)).toBeNull();
    expect(connectorAcceptanceRefusal(connector(), after(MAX_AGE_MS + 1))).not.toBeNull();
  });

  it('holds on the last day and lapses one millisecond later', () => {
    expect(CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS).toBe(90);
    expect(connectorAcceptanceRefusal(connector(), after(MAX_AGE_MS))).toBeNull();
    expect(connectorAcceptanceRefusal(connector(), after(MAX_AGE_MS + 1))).toMatch(/stale/);
  });

  it('an acceptance dated after now is refused: a future date must not hide staleness', () => {
    expect(connectorAcceptanceRefusal(connector(), after(-1))).toMatch(/after/);
  });

  it.each([['text', 'soon'], ['a non-canonical date', '2026-11-01'], ['nothing', '']])('a time that is %s refuses: no time is not a fresh time', (_label, now) => {
    expect(connectorAcceptanceRefusal(connector(), now)).not.toBeNull();
  });

  it('a stale connector is refused at the gate by name', () => {
    const admission = gate({ envelope: agencyEnvelope({ expiry: '2027-12-01T00:00:00.000Z' }), now: after(MAX_AGE_MS + 1) });
    expect(admission).toMatchObject({ admitted: false, code: 'CONNECTOR_ACCEPTANCE_STALE' });
  });

  it('a lapsed acceptance blocks that connector and leaves the other tenant working', () => {
    const lapsed = '2026-07-01T00:00:00.000Z';
    const registry = registryOf([entry({ lastAcceptanceDate: lapsed, releaseRecord: passingRelease({ acceptedAt: lapsed }) }), ownerEntry()]);
    expect(gate({ registry })).toMatchObject({ admitted: false, code: 'CONNECTOR_ACCEPTANCE_STALE' });
    expect(gate({ registry, connectorId: 'fixture-calendar', envelope: ownerEnvelope() })).toMatchObject({ admitted: true });
  });
});

describe('the action registry', () => {
  it('a registered action passes: the positive control', () => {
    expect(codes(file([entry({ actions: ['bridge-read'] })]))).toEqual([]);
  });

  it('an unregistered action is P5 and refuses the entry', () => {
    const parsed = parseConnectorRegistry(file([entry({ idempotency: 'provider-key', actions: ['send-the-email'] })]), context());
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const problem = parsed.problems.find((candidate) => candidate.code === 'CONNECTOR_ACTION_UNREGISTERED');
    expect(problem?.message).toContain('P5');
  });

  it.each(['Bridge-read', 'bridge-read ', 'constructor', '__proto__'])('the near miss %j is not a synonym', (action) => {
    const raw = file([entry({ idempotency: 'provider-key', actions: [action] })]);
    expect(codes(raw).some((code) => code === 'CONNECTOR_ACTION_UNREGISTERED' || code === 'CONNECTOR_REGISTRY_INVALID')).toBe(true);
    expect(parseConnectorRegistry(raw, context()).ok).toBe(false);
  });

  it('an action registry that did not pass parseActionRegistry registers nothing', () => {
    const forged = { actions: [{ id: 'bridge-read', governanceAction: null, ownerOnlyAction: null, actionClass: 'P1', environment: 'local' }] } as unknown as ActionRegistry;
    expect(codes(file([entry()]), forged)).toContain('CONNECTOR_ACTION_UNREGISTERED');
  });

  it('an action dropped from the registry after registration is P5 and refused at the gate', () => {
    const wider = actionsWith('fixture-read', 'P1');
    const registry = registryOf([entry({ actions: ['fixture-read'] })], wider);
    const admission = gate({ registry, actions: actions(), envelope: agencyEnvelope({ action: 'fixture-read' }, wider) });
    expect(admission).toMatchObject({ admitted: false, code: 'CONNECTOR_ACTION_UNREGISTERED' });
    expect(!admission.admitted && admission.reasons.join(' ')).toContain('P5');
  });
});

describe('the error vocabulary', () => {
  it('is exactly the seven codes of the contract', () => {
    expect([...CONNECTOR_ERROR_CODES]).toEqual([
      'authentication_required',
      'permission_denied',
      'rate_limited',
      'invalid_input',
      'approval_required',
      'upstream_unavailable',
      'outcome_unknown',
    ]);
  });

  it.each(CONNECTOR_ERROR_CODES.map((code) => [code]))('%s parses as itself', (code) => {
    expect(parseConnectorError(code)).toEqual({ ok: true, code });
  });

  it.each([['timeout'], ['Rate_Limited'], ['rate_limited '], ['unknown'], ['constructor'], ['__proto__'], [''], [7], [null], [undefined], [{ code: 'rate_limited' }]])(
    'the unknown code %j is refused, never mapped to a friendly one',
    (code) => {
      const parsed = parseConnectorError(code);
      expect(parsed).toMatchObject({ ok: false, code: 'CONNECTOR_ERROR_UNKNOWN' });
    },
  );

  it('states a retry rule for every code, and names each one', () => {
    expect(CONNECTOR_RETRY_RULES).toEqual({
      authentication_required: 'after-reauthentication',
      permission_denied: 'never',
      rate_limited: 'after-backoff',
      invalid_input: 'never',
      approval_required: 'after-approval',
      upstream_unavailable: 'after-backoff',
      outcome_unknown: 'after-reconciliation',
    });
  });
});

describe('the retry rule', () => {
  const decide = (history: unknown, facts: ConnectorRetryFacts = NO_FACTS, key: string = KEY) => decideConnectorRetry(history, key, facts);

  it('a key with no history is a first attempt', () => {
    expect(decide([])).toEqual({ allowed: true, attempt: 1, rule: 'first-attempt' });
  });

  it('another key\'s history says nothing about this one', () => {
    expect(decide([unknown()], NO_FACTS, OTHER_KEY)).toMatchObject({ allowed: true, attempt: 1 });
  });

  it('a retry after outcome_unknown is refused until reconciled', () => {
    expect(decide([unknown()])).toMatchObject({ allowed: false, code: 'RETRY_UNRECONCILED' });
  });

  it('no fact stands in for reconciliation', () => {
    expect(decide([unknown()], { reauthenticated: true, approved: true })).toMatchObject({ allowed: false, code: 'RETRY_UNRECONCILED' });
  });

  it('a later failure does not clear an unreconciled unknown: it stays until reconciled', () => {
    expect(decide([unknown(), failed('rate_limited')])).toMatchObject({ allowed: false, code: 'RETRY_UNRECONCILED' });
  });

  it('a reconciliation finding it did not complete opens the retry, as the next attempt', () => {
    expect(decide([unknown(), reconciliation('not_completed')])).toEqual({ allowed: true, attempt: 2, rule: 'after-reconciliation' });
  });

  it('a reconciliation finding it completed closes the key: the write happened, so it never runs again', () => {
    expect(decide([unknown(), reconciliation('completed')])).toMatchObject({ allowed: false, code: 'RETRY_ALREADY_COMPLETED' });
  });

  it('a success after an unknown does not clear it: no later line says what the first write did', () => {
    expect(decide([unknown(), receipt()])).toMatchObject({ allowed: false, code: 'RETRY_UNRECONCILED' });
  });

  it('a second unknown needs a second reconciliation', () => {
    expect(decide([unknown(), reconciliation('not_completed'), unknown()])).toMatchObject({ allowed: false, code: 'RETRY_UNRECONCILED' });
  });

  it('a success is never repeated', () => {
    expect(decide([receipt()])).toMatchObject({ allowed: false, code: 'RETRY_ALREADY_COMPLETED' });
  });

  it.each(['permission_denied', 'invalid_input'])('%s is never retried under the same key', (code) => {
    expect(decide([failed(code)], { reauthenticated: true, approved: true })).toMatchObject({ allowed: false, code: 'RETRY_NEVER' });
  });

  it.each(['rate_limited', 'upstream_unavailable'])('%s is retried after backoff, under the same key', (code) => {
    expect(decide([failed(code)])).toEqual({ allowed: true, attempt: 2, rule: 'after-backoff' });
  });

  it('authentication_required waits for re-authentication, and the kernel says when', () => {
    expect(decide([failed('authentication_required')])).toMatchObject({ allowed: false, code: 'RETRY_NEEDS_REAUTHENTICATION' });
    expect(decide([failed('authentication_required')], { reauthenticated: false, approved: true })).toMatchObject({ allowed: false });
    expect(decide([failed('authentication_required')], { reauthenticated: true, approved: false })).toEqual({ allowed: true, attempt: 2, rule: 'after-reauthentication' });
  });

  it('approval_required waits for an approval, and the kernel says when', () => {
    expect(decide([failed('approval_required')])).toMatchObject({ allowed: false, code: 'RETRY_NEEDS_APPROVAL' });
    expect(decide([failed('approval_required')], { reauthenticated: true, approved: false })).toMatchObject({ allowed: false });
    expect(decide([failed('approval_required')], { reauthenticated: false, approved: true })).toEqual({ allowed: true, attempt: 2, rule: 'after-approval' });
  });

  it.each([[1], ['yes'], [null]])('the fact %j is not true', (fact) => {
    expect(decide([failed('approval_required')], { reauthenticated: false, approved: fact as unknown as boolean })).toMatchObject({ allowed: false });
    expect(decide([failed('authentication_required')], { reauthenticated: fact as unknown as boolean, approved: false })).toMatchObject({ allowed: false });
  });

  it('attempts are bounded: a key cannot be retried without end', () => {
    expect(CONNECTOR_MAX_ATTEMPTS).toBe(5);
    const atTheEdge = Array.from({ length: CONNECTOR_MAX_ATTEMPTS - 1 }, () => failed('rate_limited'));
    expect(decide(atTheEdge)).toMatchObject({ allowed: true, attempt: CONNECTOR_MAX_ATTEMPTS });
    expect(decide([...atTheEdge, failed('rate_limited')])).toMatchObject({ allowed: false, code: 'RETRY_ATTEMPTS_EXHAUSTED' });
  });

  it.each([
    ['not a list', { lines: [] }],
    ['a sparse list', new Array(1)],
    ['a line that is not a record', ['ok']],
    ['a receipt with an unknown code, for any key', [failed('timeout', { idempotencyKey: OTHER_KEY })]],
    ['a reconciliation with nothing open', [reconciliation('not_completed')]],
    ['a reconciliation after a plain failure', [failed('rate_limited'), reconciliation('not_completed')]],
    ['a reconciliation with no evidence', [unknown(), reconciliation('not_completed', { evidence: '' })]],
    ['a reconciliation with an unknown field', [unknown(), reconciliation('not_completed', { note: 'x' })]],
    ['a key crossing tenants', [failed('rate_limited'), failed('rate_limited', { tenant: 'owner-personal' })]],
    ['a key crossing actions', [failed('rate_limited'), failed('rate_limited', { action: 'broker-call' })]],
  ])('history that is %s fails closed', (_label, history) => {
    expect(decide(history)).toMatchObject({ allowed: false, code: 'RETRY_HISTORY_INVALID' });
  });

  it('a malformed key fails closed', () => {
    expect(decide([], NO_FACTS, 'RUN-1')).toMatchObject({ allowed: false, code: 'RETRY_KEY_INVALID' });
  });

  it('the gate asks the retry rule, by the envelope\'s own key', () => {
    const envelope = agencyEnvelope();
    expect(gate({ envelope, history: [unknown({ idempotencyKey: envelope.idempotencyKey })] })).toMatchObject({ admitted: false, code: 'RETRY_UNRECONCILED' });
  });

  it('a new envelope for the same intent carries the same key, and is refused the same way', () => {
    const first = agencyEnvelope();
    const second = agencyEnvelope();
    expect(second.envelopeId).not.toBe(first.envelopeId);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(gate({ envelope: second, history: [unknown({ idempotencyKey: first.idempotencyKey })] })).toMatchObject({ admitted: false, code: 'RETRY_UNRECONCILED' });
  });

  it('the same key through another connector of the tenant is still refused', () => {
    const envelope = agencyEnvelope();
    const registry = registryOf([entry(), entry({ connectorId: 'fixture-mail-two', releaseRecord: passingRelease({ connectorId: 'fixture-mail-two' }) })]);
    const history = [unknown({ idempotencyKey: envelope.idempotencyKey })];
    expect(gate({ registry, connectorId: 'fixture-mail-two', envelope, history })).toMatchObject({ admitted: false, code: 'RETRY_UNRECONCILED' });
  });

  it('a call admitted on retry reports its attempt', () => {
    const envelope = agencyEnvelope();
    const history = [failed('rate_limited', { idempotencyKey: envelope.idempotencyKey })];
    expect(gate({ envelope, history })).toMatchObject({ admitted: true, call: { attempt: 2 } });
  });
});

describe('reconciliation', () => {
  const asking = (over: Raw = {}) => ({ idempotencyKey: KEY, finding: 'not_completed', evidence: 'provider:message-4471', reconciledBy: 'owner', reconciledAt: NOW, ...over });

  it('leaves evidence: a record naming what was found, who found it and on what', () => {
    const result = reconcileConnectorOutcome([unknown()], asking() as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toEqual(reconciliation('not_completed'));
    expect(result.history).toHaveLength(2);
    expect(decideConnectorRetry(result.history, KEY, NO_FACTS)).toEqual({ allowed: true, attempt: 2, rule: 'after-reconciliation' });
  });

  it('takes tenant, connector and action from the open receipt: nothing the caller says can move them', () => {
    const result = reconcileConnectorOutcome([unknown()], asking({ tenant: 'owner-personal', connector: 'other', action: 'broker-call' }) as never);
    expect(result.ok && result.record.tenant).toBe('agency-business');
    expect(result.ok && result.record.connector).toBe('fixture-mail');
    expect(result.ok && result.record.action).toBe('bridge-read');
  });

  it('appends: the history it was given is untouched', () => {
    const history = deepFreeze([unknown()]);
    const result = reconcileConnectorOutcome(history, asking() as never);
    expect(result.ok).toBe(true);
    expect(history).toHaveLength(1);
  });

  it.each([
    ['nothing at all', []],
    ['a plain failure', [failed('rate_limited')]],
    ['a success', [receipt()]],
    ['an unknown already reconciled', [unknown(), reconciliation('not_completed')]],
  ])('there is nothing to reconcile after %s', (_label, history) => {
    expect(reconcileConnectorOutcome(history, asking() as never)).toMatchObject({ ok: false, code: 'RECONCILE_NOTHING_OPEN' });
  });

  it.each([
    ['no evidence', { evidence: '' }],
    ['prose evidence', { evidence: 'looked fine to me' }],
    ['evidence holding a credential', { evidence: `provider:${FAKE_PREFIXED}` }],
    ['evidence that is not text', { evidence: 7 }],
  ])('%s is refused: reconciliation is explicit or it did not happen', (_label, over) => {
    expect(reconcileConnectorOutcome([unknown()], asking(over) as never)).toMatchObject({ ok: false, code: 'RECONCILE_EVIDENCE_REQUIRED' });
  });

  it.each([
    ['an unknown finding', { finding: 'probably' }],
    ['no reconciler', { reconciledBy: ' ' }],
    ['an unreadable time', { reconciledAt: 'today' }],
  ])('%s is refused', (_label, over) => {
    expect(reconcileConnectorOutcome([unknown()], asking(over) as never)).toMatchObject({ ok: false, code: 'RECONCILE_INVALID' });
  });

  it('malformed history is refused, not reconciled', () => {
    expect(reconcileConnectorOutcome(['ok'], asking() as never)).toMatchObject({ ok: false, code: 'RETRY_HISTORY_INVALID' });
  });
});

describe('the execution receipt', () => {
  it('carries exactly the standard fields, and a success has no error code', () => {
    expect(parseConnectorReceipt(receipt())).toEqual({ ok: true, receipt: receipt() });
  });

  it('a failure names its code', () => {
    expect(parseConnectorReceipt(failed('rate_limited')).ok).toBe(true);
  });

  it.each(['payload', 'body', 'secret', 'providerResponse', 'credential'])('the field %s is refused: a receipt has no room for content', (field) => {
    expect(parseConnectorReceipt(receipt({ [field]: 'x' }))).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
  });

  it.each(['tenant', 'connector', 'action', 'idempotencyKey', 'outcome', 'errorCode'])('a receipt with no %s is refused', (field) => {
    expect(parseConnectorReceipt(receipt({ [field]: undefined }))).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
    const { [field]: _gone, ...rest } = receipt();
    expect(parseConnectorReceipt(rest)).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
  });

  it.each([
    ['tenant', 'Dear customer, your invoice is attached'],
    ['connector', FAKE_PREFIXED],
    ['action', 'send the email to murad'],
    ['idempotencyKey', 'RUN-1'],
    ['outcome', 'done'],
  ])('a %s that is not its shape cannot smuggle text', (field, value) => {
    expect(parseConnectorReceipt(receipt({ [field]: value }))).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
  });

  it.each(['tenant', 'connector', 'action'])('a credential fits the name shape of %s, and is still refused', (field) => {
    const parsed = parseConnectorReceipt(receipt({ [field]: FAKE_PREFIXED }));
    expect(parsed).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
    expect(JSON.stringify(parsed)).not.toContain(FAKE_PREFIXED);
  });

  it.each([['not an object', 'ok'], ['an array', []], ['null', null]])('a receipt that is %s fails closed', (_label, raw) => {
    expect(parseConnectorReceipt(raw)).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
  });

  it('an unknown error code on a receipt is refused by name', () => {
    expect(parseConnectorReceipt(failed('timeout'))).toMatchObject({ ok: false, code: 'RECEIPT_ERROR_CODE_UNKNOWN' });
  });

  it.each([
    ['a success carrying an error code', receipt({ errorCode: 'rate_limited' })],
    ['a failure with no code', receipt({ outcome: 'failed', errorCode: null })],
    ['outcome_unknown claimed as a failure', receipt({ outcome: 'failed', errorCode: 'outcome_unknown' })],
    ['outcome_unknown claimed as a success', receipt({ outcome: 'succeeded', errorCode: 'outcome_unknown' })],
    ['an unknown outcome with another code', receipt({ outcome: 'unknown', errorCode: 'rate_limited' })],
    ['an unknown outcome with no code', receipt({ outcome: 'unknown', errorCode: null })],
  ])('%s is refused', (_label, raw) => {
    expect(parseConnectorReceipt(raw)).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
  });

  const presented = (envelope: TaskEnvelope, over: Raw = {}): Raw => receipt({ idempotencyKey: envelope.idempotencyKey, ...over });

  it('a receipt matching its call passes: the positive control', () => {
    const envelope = agencyEnvelope();
    expect(checkConnectorReceipt(presented(envelope), call({ envelope }))).toMatchObject({ ok: true, receipt: { tenant: 'agency-business' } });
  });

  it('a receipt whose tenant differs from the envelope is refused', () => {
    const envelope = agencyEnvelope();
    expect(checkConnectorReceipt(presented(envelope, { tenant: 'owner-personal' }), call({ envelope }))).toMatchObject({ ok: false, code: 'RECEIPT_TENANT_MISMATCH' });
  });

  it.each([
    ['connector', { connector: 'fixture-other' }],
    ['action', { action: 'broker-call' }],
    ['idempotencyKey', { idempotencyKey: OTHER_KEY }],
  ])('a receipt for another %s is refused', (_label, over) => {
    const envelope = agencyEnvelope();
    expect(checkConnectorReceipt(presented(envelope, over), call({ envelope }))).toMatchObject({ ok: false, code: 'RECEIPT_CALL_MISMATCH' });
  });

  it('a call the gate did not admit proves nothing: a perfect copy is refused', () => {
    const envelope = agencyEnvelope();
    const real = call({ envelope });
    expect(checkConnectorReceipt(presented(envelope), { ...real })).toMatchObject({ ok: false, code: 'RECEIPT_CALL_UNADMITTED' });
  });

  it('a malformed receipt is refused before any comparison', () => {
    const envelope = agencyEnvelope();
    expect(checkConnectorReceipt(presented(envelope, { payload: 'x' }), call({ envelope }))).toMatchObject({ ok: false, code: 'RECEIPT_INVALID' });
  });
});

describe('cross-tenant denial', () => {
  const both = () => registryOf([entry(), ownerEntry()]);

  it('the same tenant is admitted: the pair that lets this proof fail', () => {
    expect(gate({ registry: both(), envelope: agencyEnvelope() })).toMatchObject({ admitted: true });
    expect(gate({ registry: both(), connectorId: 'fixture-calendar', envelope: ownerEnvelope() })).toMatchObject({ admitted: true });
  });

  it('an envelope of one tenant cannot use a connector of the other, in either direction', () => {
    expect(gate({ registry: both(), envelope: ownerEnvelope() })).toMatchObject({ admitted: false, code: 'CONNECTOR_CROSS_TENANT' });
    expect(gate({ registry: both(), connectorId: 'fixture-calendar', envelope: agencyEnvelope() })).toMatchObject({ admitted: false, code: 'CONNECTOR_CROSS_TENANT' });
  });

  it('two tenants in the same domain are refused on the tenant alone', () => {
    const registry = registryOf([ownerEntry({ domain: 'business' })]);
    const admission = gate({ registry, connectorId: 'fixture-calendar', envelope: agencyEnvelope() });
    expect(admission).toMatchObject({ admitted: false, code: 'CONNECTOR_CROSS_TENANT' });
    expect(agencyEnvelope().domain).toBe('business');
  });

  it('holds for the owner too: refusal applies to work bound to a project, whoever started it', () => {
    const owner = mintEnvelope({ binding: binding(OWNER_FACTS), registry: actions(), principal: 'owner', actor: ACTOR, envelopeId: `ENV-${'9'.repeat(24)}` }, REQUEST);
    const admission = admitEnvelope(owner, NOW, () => true, () => true);
    if (!admission.admitted) throw new Error(admission.reasons.join('; '));
    expect(gate({ registry: both(), envelope: admission.envelope })).toMatchObject({ admitted: false, code: 'CONNECTOR_CROSS_TENANT' });
  });

  it('a connector in another domain of the same tenant is refused', () => {
    const registry = registryOf([ownerEntry({ domain: 'personal' })]);
    expect(gate({ registry, connectorId: 'fixture-calendar', envelope: ownerEnvelope() })).toMatchObject({ admitted: false, code: 'CONNECTOR_CROSS_TENANT' });
  });

  it('a registered P5 grant does not open it: cross-tenant-access is not a connector route', () => {
    const entryWithAccess = entry({ idempotency: 'provider-key', actions: ['bridge-read', 'cross-tenant-access'] });
    const registry = registryOf([entryWithAccess]);
    const envelope = ownerEnvelope({ action: 'cross-tenant-access' });
    expect(gate({ registry, envelope })).toMatchObject({ admitted: false, code: 'CONNECTOR_CROSS_TENANT' });
  });

  it('the idempotency key of one tenant is not another tenant\'s: the key is derived with the tenant', () => {
    const shared = { project: 'p', action: 'bridge-read', subjectHash: 'a'.repeat(40), intentScope: 'RUN-1' };
    expect(deriveIdempotencyKey({ ...shared, tenant: 'owner-personal' })).not.toBe(deriveIdempotencyKey({ ...shared, tenant: 'agency-business' }));
  });
});

describe('the gate', () => {
  it('a registry that did not pass parseConnectorRegistry admits nothing', () => {
    const real = registryOf([entry()]);
    expect(gate({ registry: { ...real } })).toMatchObject({ admitted: false, code: 'CONNECTOR_REGISTRY_INVALID' });
  });

  it('an unlisted connector is refused by name', () => {
    expect(gate({ connectorId: 'fixture-unknown' })).toMatchObject({ admitted: false, code: 'CONNECTOR_UNKNOWN' });
  });

  it('a forged envelope is refused: shape is not admission', () => {
    expect(gate({ envelope: { ...agencyEnvelope() } })).toMatchObject({ admitted: false, code: 'CONNECTOR_ENVELOPE_NOT_ADMITTED' });
  });

  it('an envelope minted but refused at the door is refused here too', () => {
    const minted = mint(binding(AGENCY_FACTS));
    if (!minted.ok) throw new Error(minted.reasons.join('; '));
    expect(gate({ envelope: minted.envelope })).toMatchObject({ admitted: false, code: 'CONNECTOR_ENVELOPE_NOT_ADMITTED' });
  });

  it('an envelope past its expiry is refused when the action would run, not only at admission', () => {
    expect(gate({ now: '2026-11-01T13:00:00.000Z' })).toMatchObject({ admitted: false, code: 'CONNECTOR_ENVELOPE_EXPIRED' });
  });

  it('an action the connector did not declare is refused, though the registry knows it', () => {
    const envelope = agencyEnvelope({ action: 'project-selection' });
    expect(gate({ envelope })).toMatchObject({ admitted: false, code: 'CONNECTOR_ACTION_UNDECLARED' });
  });

  it('the admitted call carries the connector, the envelope and the attempt', () => {
    const envelope = agencyEnvelope();
    const admitted = call({ envelope });
    expect(admitted.envelope).toBe(envelope);
    expect(admitted.connector.connectorId).toBe('fixture-mail');
    expect(admitted.attempt).toBe(1);
  });
});

describe('the nine acceptance scenarios', () => {
  it('are defined as data, exactly the nine the blueprint requires', () => {
    expect(ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id)).toEqual(SCENARIO_IDS);
  });

  it('each says what is done and what must hold', () => {
    for (const scenario of ACCEPTANCE_SCENARIOS) {
      expect(scenario.given.trim()).not.toBe('');
      expect(scenario.expect.trim()).not.toBe('');
    }
  });

  it('cross-tenant denial is proved here, and names its proof', () => {
    expect(ACCEPTANCE_SCENARIOS[0]).toMatchObject({ id: 'cross-tenant-denial', status: 'proved', firstRun: 'stage-2', proof: 'projectos/core/test/connector-contract.test.ts' });
  });

  it('the other eight are defined, first run in Stage 5, and carry no proof', () => {
    const others = ACCEPTANCE_SCENARIOS.slice(1);
    expect(others).toHaveLength(8);
    for (const scenario of others) expect(scenario).toMatchObject({ status: 'defined', firstRun: 'stage-5', proof: null });
  });

  it('the tally never counts a defined scenario as passed', () => {
    expect(scenarioTally()).toEqual({ total: 9, proved: 1, defined: 8 });
    expect(Object.keys(scenarioTally())).not.toContain('passed');
  });

  it('a release record that lists a scenario changes nothing in the tally', () => {
    expect(parseConnectorRegistry(file([entry()]), context()).ok).toBe(true);
    expect(scenarioTally()).toEqual({ total: 9, proved: 1, defined: 8 });
  });

  it('the table cannot be edited in place', () => {
    expect(Object.isFrozen(ACCEPTANCE_SCENARIOS)).toBe(true);
    expect(ACCEPTANCE_SCENARIOS.every((scenario) => Object.isFrozen(scenario))).toBe(true);
  });
});

describe('immutability', () => {
  it('parsing a frozen file works and leaves it as it was', () => {
    const raw = deepFreeze(file([entry()]));
    const before = JSON.stringify(raw);
    expect(parseConnectorRegistry(raw, context()).ok).toBe(true);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('what comes back is frozen all the way down, and shares nothing with the input', () => {
    const raw = file([entry()]);
    const parsed = parseConnectorRegistry(raw, context());
    if (!parsed.ok) throw new Error('expected a registry');
    const connector = parsed.registry.connectors[0] as NonNullable<ConnectorRegistry['connectors'][number]>;
    expect(Object.isFrozen(parsed.registry)).toBe(true);
    expect(Object.isFrozen(parsed.registry.connectors)).toBe(true);
    expect(Object.isFrozen(connector)).toBe(true);
    expect(Object.isFrozen(connector.scopes)).toBe(true);
    expect(Object.isFrozen(connector.actions)).toBe(true);
    expect(Object.isFrozen(connector.dataCategories)).toBe(true);
    expect(Object.isFrozen(connector.releaseRecord)).toBe(true);
    expect(Object.isFrozen(connector.releaseRecord.checklist)).toBe(true);
    expect(Object.isFrozen(connector.releaseRecord.scenarios)).toBe(true);
    ((raw['connectors'] as Raw[])[0] as Raw)['scopes'] = ['everything'];
    expect(connector.scopes).toEqual(['mail.read']);
  });

  it('a receipt and a retry decision leave their input frozen and whole', () => {
    const raw = deepFreeze(receipt());
    const parsed = parseConnectorReceipt(raw);
    expect(parsed.ok && Object.isFrozen(parsed.receipt)).toBe(true);
    expect(decideConnectorRetry(deepFreeze([failed('rate_limited')]), KEY, NO_FACTS)).toMatchObject({ allowed: true });
  });

  it('the admitted call is frozen', () => {
    expect(Object.isFrozen(call())).toBe(true);
  });

  it('a reconciliation and the history it returns are frozen', () => {
    const result = reconcileConnectorOutcome([unknown()], { idempotencyKey: KEY, finding: 'not_completed', evidence: 'provider:message-4471', reconciledBy: 'owner', reconciledAt: NOW });
    expect(result.ok && Object.isFrozen(result.record)).toBe(true);
    expect(result.ok && Object.isFrozen(result.history)).toBe(true);
  });

  it('the retry table cannot be edited in place', () => {
    expect(Object.isFrozen(CONNECTOR_RETRY_RULES)).toBe(true);
  });
});

describe('the barrel', () => {
  it('exports the contract', () => {
    expect(barrel.parseConnectorRegistry).toBe(parseConnectorRegistry);
    expect(barrel.admitConnectorCall).toBe(admitConnectorCall);
    expect(barrel.ACCEPTANCE_SCENARIOS).toBe(ACCEPTANCE_SCENARIOS);
  });
});
