/**
 * One tool call, through every gate in order: the pinned manifest, the declared tool, the connector contract's
 * own gate, then the budget (PROJECTOS-PORT-MCP1A). The tenants, envelopes and door are the real ones.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import { CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS, parseConnectorRegistry, RELEASE_CHECKLIST, type ConnectorRegistry } from '../src/connectorContract.js';
import {
  admitMcpToolCall,
  EMPTY_TALLY,
  manifestHashOf,
  mcpReceiptOf,
  mcpStartRecordOf,
  parseManifest,
  parseServerAllowlist,
  spendOf,
  type McpToolAdmission,
  type ServerAllowlist,
} from '../src/mcpConnectors/index.js';
import { admitEnvelope, mintEnvelope, type EnvelopeRequest, type TaskEnvelope } from '../src/taskEnvelope.js';
import { parseTenantRegistry, resolveTenant, type CheckoutFacts, type TenantBinding } from '../src/tenant.js';

type Raw = Record<string, unknown>;

const record = (name: string): Raw => JSON.parse(readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8')) as Raw;

function actions(): ActionRegistry {
  const parsed = parseActionRegistry(record('security/action-registry.json'));
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const NOW = '2026-11-01T12:00:00.000Z';
const LATER = '2026-11-01T13:00:00.000Z';
const ACCEPTED = '2026-10-15T09:00:00.000Z';
const SCENARIOS = ['cross-tenant-denial', 'duplicate-webhook-delivery', 'expired-approval', 'token-revocation', 'prompt-injection-in-retrieved-content', 'process-crash-after-write', 'cancellation', 'missing-evidence', 'provider-outage'];
const MAX_AGE_DAYS = CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS;

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
  releaseRecord: { connectorId: 'fixture-mail', version: '1.0.0', tenant: 'agency-business', result: 'passed', acceptedAt: ACCEPTED, checklist: [...RELEASE_CHECKLIST], scenarios: SCENARIOS, evidence: 'docs/finish/FIXTURE-CONNECTOR.md' },
  ...over,
});

function connectors(rows: readonly unknown[] = [entry()]): ConnectorRegistry {
  const tenants = parseTenantRegistry(record('security/tenant-registry.json'));
  if (!tenants.ok) throw new Error('tenants');
  const parsed = parseConnectorRegistry(
    { schemaVersion: '1.0.0', policy: 'connector-registry', note: 'Fixture.', authority: 'owner', authorisedBy: 'Murad', provenance: 'Fixture.', trustBasis: 'Fixture.', connectors: rows },
    { actions: actions(), tenants: tenants.registry },
  );
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const AGENCY: CheckoutFacts = { projectId: 'seo-agency', repository: '127.0.0.1:47900/SEOAgency-remote/seo-agency', root: 'C:/dev/SEOAgency', worktrees: null };

const OWNER: CheckoutFacts = { projectId: 'polygo', repository: 'github.com/polygonia-apres/polygo', root: 'C:/dev/Polygo/polygo', worktrees: null };

function binding(facts: CheckoutFacts = AGENCY): TenantBinding {
  const tenants = parseTenantRegistry(record('security/tenant-registry.json'));
  if (!tenants.ok) throw new Error('tenants');
  const resolved = resolveTenant(tenants.registry, facts);
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  return resolved.binding;
}

let nextEnvelope = 1;
function envelope(request: Partial<EnvelopeRequest> = {}, facts: CheckoutFacts = AGENCY): TaskEnvelope {
  const base: EnvelopeRequest = { action: 'bridge-read', subjectHash: 'a'.repeat(40), scope: ['mail'], budget: 500, expiry: LATER, intentScope: 'RUN-1' };
  const minted = mintEnvelope(
    { binding: binding(facts), registry: actions(), principal: 'implementer', actor: { agent: 'claude-code-cli', provider: 'anthropic', model: 'claude-opus-5-5' }, envelopeId: `ENV-${String(nextEnvelope++).padStart(24, '0')}` },
    { ...base, ...request },
  );
  const admission = admitEnvelope(minted, NOW, () => true, () => true);
  if (!admission.admitted) throw new Error(admission.reasons.join('; '));
  return admission.envelope;
}

const MANIFEST = { serverId: 'mail-reader', tenant: 'agency-business', transport: 'stdio', command: 'C:/tools/mcp/mail-reader.exe', args: ['--readonly'], envNames: ['MAIL_TOKEN_REF'] };

const DESCRIPTOR = `sha256:${'d'.repeat(64)}`;

function allowlist(over: Raw = {}): ServerAllowlist {
  const manifest = parseManifest(MANIFEST);
  if (!manifest.ok) throw new Error('manifest');
  const parsed = parseServerAllowlist({
    servers: [{ tenant: 'agency-business', serverId: 'mail-reader', manifestHash: manifestHashOf(manifest.manifest), connectorId: 'fixture-mail', spendLimit: 1_000, tools: { search_mail: { action: 'bridge-read', cost: 100, descriptorHash: DESCRIPTOR }, other_tool: { action: 'bridge-read', cost: 100, descriptorHash: DESCRIPTOR } }, ...over }],
  });
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.allowlist;
}

function admit(over: Record<string, unknown> = {}): McpToolAdmission {
  return admitMcpToolCall({
    allowlist: allowlist(),
    manifest: MANIFEST,
    tool: 'search_mail',
    tally: EMPTY_TALLY,
    registry: connectors(),
    actions: actions(),
    envelope: envelope(),
    history: [],
    facts: { reauthenticated: false, approved: false },
    now: NOW,
    ...over,
  } as never);
}

describe('a tool call passes every gate: the positive control', () => {
  it('is admitted with the connector gate\'s start line and a booked charge', () => {
    const admission = admit();
    expect(admission).toMatchObject({ admitted: true });
    if (!admission.admitted) return;
    expect(admission.started).toMatchObject({ connector: 'fixture-mail', action: 'bridge-read', attempt: 1 });
    expect(spendOf(admission.tally, 'agency-business/mail-reader')).toBe(100);
  });
});

describe('the gates, in order', () => {
  it('refuses a server whose manifest hash differs from its pin, before anything else', () => {
    const admission = admit({ manifest: { ...MANIFEST, command: 'C:/tools/mcp/swapped.exe' } });
    expect(admission).toMatchObject({ admitted: false, code: 'MANIFEST_HASH_MISMATCH' });
  });

  it('refuses a tool the allowlist does not name, even on an admitted server', () => {
    expect(admit({ tool: 'drop_database' })).toMatchObject({ admitted: false, code: 'TOOL_NOT_ALLOWLISTED' });
  });

  it('refuses when the envelope\'s action is not the action the tool is pinned to', () => {
    expect(admit({ envelope: envelope({ action: 'run-start' }) })).toMatchObject({ admitted: false, code: 'TOOL_ACTION_MISMATCH' });
  });

  it('refuses when no connector is registered: the committed registry holds none, so nothing runs', () => {
    expect(admit({ registry: connectors([]) })).toMatchObject({ admitted: false, code: 'CONNECTOR_UNKNOWN' });
  });

  it('refuses another tenant\'s connector, by the contract\'s own gate', () => {
    const other = entry({ connectorId: 'fixture-mail', tenant: 'owner-personal', domain: 'develop', secretReference: 'ProjectOS/tenant.owner-personal/production/google/calendar-refresh', releaseRecord: { ...(entry()['releaseRecord'] as Raw), tenant: 'owner-personal' } });
    expect(admit({ registry: connectors([other]) })).toMatchObject({ admitted: false, code: 'CONNECTOR_CROSS_TENANT' });
  });

  it('refuses a connector whose acceptance has lapsed', () => {
    const stale = new Date(Date.parse(NOW) - (MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    const lapsed = entry({ lastAcceptanceDate: stale, releaseRecord: { ...(entry()['releaseRecord'] as Raw), acceptedAt: stale } });
    expect(admit({ registry: connectors([lapsed]) })).toMatchObject({ admitted: false, code: 'CONNECTOR_ACCEPTANCE_STALE' });
  });

  it('refuses a call past the envelope\'s own ceiling', () => {
    expect(admit({ envelope: envelope({ budget: 50 }) })).toMatchObject({ admitted: false, code: 'TOOL_OVER_ENVELOPE_BUDGET' });
  });

  it('refuses a call past the spend limit', () => {
    const tight = allowlist({ spendLimit: 100 });
    const first = admit({ allowlist: tight });
    if (!first.admitted) throw new Error('control');
    expect(admit({ allowlist: tight, tally: first.tally })).toMatchObject({ admitted: false, code: 'TOOL_OVER_SPEND_LIMIT' });
  });

  it('books nothing for a call the connector gate refused', () => {
    const admission = admit({ registry: connectors([]) });
    expect(admission.admitted).toBe(false);
    expect('tally' in admission).toBe(false);
  });

  it('refuses a malformed manifest as a manifest problem, not as a hash mismatch', () => {
    expect(admit({ manifest: { ...MANIFEST, url: 'https://example.invalid' } })).toMatchObject({ admitted: false, code: 'MANIFEST_INVALID' });
  });
});

describe('the tenant is one tenant all the way (H1)', () => {
  const calendarConnector = (): Raw =>
    entry({
      connectorId: 'fixture-calendar',
      tenant: 'owner-personal',
      domain: 'develop',
      secretReference: 'ProjectOS/tenant.owner-personal/production/google/calendar-refresh',
      releaseRecord: { ...(entry()['releaseRecord'] as Raw), connectorId: 'fixture-calendar', tenant: 'owner-personal' },
    });

  it('refuses a row for tenant A that names the connector of tenant B, even with an envelope of tenant B', () => {
    const crossed = allowlist({ connectorId: 'fixture-calendar' });
    const admission = admit({ allowlist: crossed, registry: connectors([calendarConnector()]), envelope: envelope({}, OWNER) });
    expect(admission).toMatchObject({ admitted: false, code: 'TENANT_MISMATCH' });
  });

  it('refuses an envelope of another tenant than the server, before the connector gate is asked', () => {
    expect(admit({ envelope: envelope({}, OWNER) })).toMatchObject({ admitted: false, code: 'TENANT_MISMATCH' });
  });

  it('books nothing for either refusal', () => {
    const crossed = allowlist({ connectorId: 'fixture-calendar' });
    const admission = admit({ allowlist: crossed, registry: connectors([calendarConnector()]), envelope: envelope({}, OWNER) });
    expect('tally' in admission).toBe(false);
  });

  it('admits when the server, the connector and the envelope are the same tenant: the positive control', () => {
    expect(admit()).toMatchObject({ admitted: true });
  });
});

describe('the start record, before the call (H3)', () => {
  it('holds the started line, what was booked and a digest of the arguments, and none of the arguments', () => {
    const admission = admit();
    if (!admission.admitted) throw new Error('control');
    const record = mcpStartRecordOf(admission, { query: 'private-argument-text' });
    expect(record).toMatchObject({ serverKey: 'agency-business/mail-reader', bookedMicroUsd: 100, spentAfter: 100, callsAfter: 1 });
    expect(record?.started).toMatchObject({ connector: 'fixture-mail', attempt: 1 });
    expect(record?.argumentsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record)).not.toContain('private-argument-text');
  });

  it('is null for arguments that cannot be read, so a call with none that can be digested is not sent', () => {
    const admission = admit();
    if (!admission.admitted) throw new Error('control');
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(mcpStartRecordOf(admission, loop)).toBeNull();
  });
});

describe('the receipt', () => {
  it('a success gets a receipt the connector contract accepts, naming the call', () => {
    const admission = admit();
    if (!admission.admitted) throw new Error('control');
    const receipt = mcpReceiptOf(admission, 'succeeded', null, 'a1b2c3d4e5f60718');
    expect(receipt).toMatchObject({ ok: true });
    expect(receipt.ok && receipt.receipt).toMatchObject({ tenant: 'agency-business', connector: 'fixture-mail', action: 'bridge-read', attempt: 1, outcome: 'succeeded', errorCode: null });
  });

  it('a failure names its code, and a lost reply is outcome_unknown rather than a failure', () => {
    const admission = admit();
    if (!admission.admitted) throw new Error('control');
    expect(mcpReceiptOf(admission, 'failed', 'upstream_unavailable')).toMatchObject({ ok: true });
    expect(mcpReceiptOf(admission, 'unknown', 'outcome_unknown')).toMatchObject({ ok: true });
    expect(mcpReceiptOf(admission, 'failed', 'made_up_code')).toMatchObject({ ok: false });
  });
});
