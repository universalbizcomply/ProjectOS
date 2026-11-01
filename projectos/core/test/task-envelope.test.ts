import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import {
  admitEnvelope,
  checkChildEnvelope,
  deriveIdempotencyKey,
  ENVELOPE_FIELDS,
  envelopeExpired,
  mintEnvelope,
  parseEnvelope,
  recordExecution,
  type EnvelopeRecord,
  type EnvelopeRequest,
  type EnvelopeResult,
  type KernelEnvelopeContext,
  type TaskEnvelope,
} from '../src/taskEnvelope.js';
import { parseTenantRegistry, resolveTenant, type TenantBinding } from '../src/tenant.js';

const json = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../security/${name}`, import.meta.url)), 'utf8'));

function actions(): ActionRegistry {
  const parsed = parseActionRegistry(json('action-registry.json'));
  if (!parsed.ok) throw new Error('the committed action registry does not parse');
  return parsed.registry;
}

function binding(projectId: string, repository: string, root: string): TenantBinding {
  const parsed = parseTenantRegistry(json('tenant-registry.json'));
  if (!parsed.ok) throw new Error('the committed tenant registry does not parse');
  const resolved = resolveTenant(parsed.registry, { projectId, repository, root, linkedWorktreesOfRegisteredRoot: [] });
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  return resolved.binding;
}

const polygo = (): TenantBinding => binding('polygo', 'github.com/polygonia-apres/polygo', 'C:/dev/Polygo/polygo');
const projectos = (): TenantBinding => binding('projectos', 'github.com/universalbizcomply/ProjectOS', 'C:/dev/ProjectOS');
const agency = (): TenantBinding => binding('seo-agency', '127.0.0.1:47900/SEOAgency-remote/seo-agency', 'C:/dev/SEOAgency');

const NOW = '2026-11-01T12:00:00.000Z';
const LATER = '2026-11-01T13:00:00.000Z';
const SOONER = '2026-11-01T12:30:00.000Z';
const SUBJECT = 'a'.repeat(40);

function context(overrides: Partial<KernelEnvelopeContext> = {}): KernelEnvelopeContext {
  return {
    binding: polygo(),
    registry: actions(),
    principal: 'implementer',
    actor: { agent: 'claude-code-cli', provider: 'anthropic', model: 'claude-opus-5-5' },
    envelopeId: `ENV-${'1'.repeat(24)}`,
    ...overrides,
  };
}

const REQUEST: EnvelopeRequest = {
  action: 'run-start',
  subjectHash: SUBJECT,
  scope: ['projectos/core/src/', 'docs/'],
  budget: 5000,
  expiry: LATER,
  intentScope: 'RUN-1',
};

function minted(result: EnvelopeResult): TaskEnvelope {
  if (!result.ok) throw new Error(result.reasons.join('; '));
  return result.envelope;
}

const root = (): TaskEnvelope => minted(mintEnvelope(context(), REQUEST));
const CHILD_ID = `ENV-${'2'.repeat(24)}`;
const child = (): TaskEnvelope => ({ ...root(), envelopeId: CHILD_ID, parentEnvelopeId: root().envelopeId });

/** The literal field list, so that dropping a field from the code cannot drop it from this proof. */
const ALL_FIELDS = [
  'envelopeVersion',
  'envelopeId',
  'parentEnvelopeId',
  'principal',
  'actor',
  'tenant',
  'domain',
  'project',
  'environment',
  'action',
  'actionClass',
  'subjectHash',
  'scope',
  'budget',
  'expiry',
  'idempotencyKey',
] as const;

describe('R1: a missing or unparseable field is a refusal', () => {
  it('a complete envelope parses: the positive control', () => {
    expect(parseEnvelope(root())).toMatchObject({ ok: true });
  });

  it('the code requires exactly the fields of the contract', () => {
    expect([...ENVELOPE_FIELDS].sort()).toEqual([...ALL_FIELDS].sort());
  });

  it.each(ALL_FIELDS)('a missing %s is refused, by name', (field) => {
    const { [field]: _removed, ...rest } = root();
    const result = parseEnvelope(rest);
    expect(result).toMatchObject({ ok: false, rule: 'R1', reasons: [`the envelope has no ${field}`] });
  });

  it.each([
    ['envelopeVersion', 1],
    ['envelopeId', 'ENV-short'],
    ['parentEnvelopeId', 'nobody'],
    ['principal', 'root'],
    ['actor', 'claude'],
    ['actor', { agent: 'a', provider: 'b' }],
    ['actor', { agent: 'a', provider: 'b', model: 'c', tenant: 'd' }],
    ['tenant', 'Owner Personal'],
    ['domain', 'marketing'],
    ['project', '../other'],
    ['environment', 'prod'],
    ['action', ''],
    ['action', 'two\nlines'],
    ['action', 'Commit'],
    ['actionClass', 'P9'],
    ['subjectHash', 'xyz'],
    ['scope', 'docs/'],
    ['scope', [1]],
    ['budget', -1],
    ['budget', 1.5],
    ['budget', '5000'],
    ['expiry', 'tomorrow'],
    ['expiry', '2026'],
    ['expiry', '2026-02-31T00:00:00.000Z'],
    ['expiry', '2026-11-01T12:00:00Z'],
    ['idempotencyKey', 'abc'],
  ])('an unparseable %s (%j) is refused, by name', (field, value) => {
    const result = parseEnvelope({ ...root(), [field]: value });
    expect(result).toMatchObject({ ok: false, rule: 'R1', reasons: [`the envelope's ${field} is unparseable`] });
  });

  it('a parent id of null is a root, and is present rather than absent', () => {
    expect(root().parentEnvelopeId).toBeNull();
  });

  it('there is no v1: nothing defaults tenant or domain', () => {
    const { tenant: _tenant, domain: _domain, ...rest } = root();
    expect(parseEnvelope({ ...rest, envelopeVersion: 1 })).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('an unknown field is refused: there is no tolerated tenantOverride', () => {
    expect(parseEnvelope({ ...root(), tenantOverride: 'agency-business' })).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('a parsed envelope shares nothing with what it was parsed from', () => {
    const source = { ...root(), actor: { ...root().actor }, scope: [...root().scope] };
    const result = minted(parseEnvelope(source));
    source.actor.agent = 'someone-else';
    source.scope.push('projectos/security/');
    expect(result.actor.agent).toBe('claude-code-cli');
    expect(result.scope).not.toContain('projectos/security/');
  });

  it.each([null, 'x', 7, []])('%j is not an envelope', (value) => {
    expect(parseEnvelope(value)).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('a parsed envelope cannot be edited', () => {
    const result = minted(parseEnvelope(root()));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scope)).toBe(true);
    expect(Object.isFrozen(result.actor)).toBe(true);
  });
});

describe('R2: the kernel derives, and the caller cannot say', () => {
  it('tenant, domain and project come from the binding: two tenants, two envelopes', () => {
    const own = root();
    const theirs = minted(mintEnvelope(context({ binding: agency() }), REQUEST));
    expect([own.tenant, own.domain, own.project]).toEqual(['owner-personal', 'develop', 'polygo']);
    expect([theirs.tenant, theirs.domain, theirs.project]).toEqual(['agency-business', 'business', 'seo-agency']);
  });

  it('environment and class come from the registry entry', () => {
    const envelope = minted(mintEnvelope(context(), { ...REQUEST, action: 'commit' }));
    expect([envelope.actionClass, envelope.environment]).toEqual(['P3', 'local']);
  });

  it('labels on the request change nothing: this request names another tenant and a lower class', () => {
    const smuggled = {
      ...REQUEST,
      action: 'commit',
      tenant: 'agency-business',
      domain: 'business',
      project: 'seo-agency',
      environment: 'production',
      actionClass: 'P1',
      idempotencyKey: `sha256:${'f'.repeat(64)}`,
      parentEnvelopeId: `ENV-${'9'.repeat(24)}`,
    };
    const honest = minted(mintEnvelope(context(), { ...REQUEST, action: 'commit' }));
    expect(minted(mintEnvelope(context(), smuggled))).toEqual(honest);
  });

  it('labels on the context change nothing either', () => {
    const smuggled = { ...context(), tenant: 'agency-business', domain: 'business', project: 'seo-agency', environment: 'production', actionClass: 'P1' };
    expect(minted(mintEnvelope(smuggled, REQUEST))).toEqual(root());
  });

  it('a binding resolveTenant did not produce is refused: the real one is the positive control', () => {
    const copy = { ...agency() };
    expect(mintEnvelope(context({ binding: agency() }), REQUEST)).toMatchObject({ ok: true });
    expect(mintEnvelope(context({ binding: copy }), REQUEST)).toMatchObject({ ok: false, rule: 'R2' });
  });

  it('the idempotency key is derived from the intent', () => {
    const first = minted(mintEnvelope(context(), REQUEST));
    const retry = minted(mintEnvelope(context({ envelopeId: `ENV-${'3'.repeat(24)}` }), REQUEST));
    const nextWeek = minted(mintEnvelope(context(), { ...REQUEST, intentScope: 'RUN-2' }));
    const otherTenant = minted(mintEnvelope(context({ binding: agency() }), REQUEST));
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(nextWeek.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(otherTenant.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(first.idempotencyKey).toBe(
      deriveIdempotencyKey({ tenant: 'owner-personal', project: 'polygo', action: 'run-start', subjectHash: SUBJECT, intentScope: 'RUN-1' }),
    );
  });

  it.each([
    ['tenant', { tenant: 'agency-business' }],
    ['project', { project: 'other' }],
    ['action', { action: 'commit' }],
    ['subjectHash', { subjectHash: 'b'.repeat(40) }],
    ['intentScope', { intentScope: 'RUN-2' }],
  ])('the key changes when %s alone changes', (_part, change) => {
    const intent = { tenant: 'owner-personal', project: 'polygo', action: 'run-start', subjectHash: SUBJECT, intentScope: 'RUN-1' };
    expect(deriveIdempotencyKey({ ...intent, ...change })).not.toBe(deriveIdempotencyKey(intent));
  });

  it('the key cannot be collided by moving text between its parts', () => {
    const a = deriveIdempotencyKey({ tenant: 't', project: 'ab', action: 'c', subjectHash: 's', intentScope: 'i' });
    const b = deriveIdempotencyKey({ tenant: 't', project: 'a', action: 'bc', subjectHash: 's', intentScope: 'i' });
    expect(a).not.toBe(b);
  });

  it('a request with no intent scope is refused', () => {
    expect(mintEnvelope(context(), { ...REQUEST, intentScope: ' ' })).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('what the request does carry is still checked (R1)', () => {
    expect(mintEnvelope(context(), { ...REQUEST, budget: -1 })).toMatchObject({ ok: false, rule: 'R1' });
    expect(mintEnvelope(context(), { ...REQUEST, subjectHash: 'nope' })).toMatchObject({ ok: false, rule: 'R1' });
  });
});

describe('R3: no widening downstream', () => {
  it('an unchanged child passes: the positive control for every refusal below', () => {
    expect(checkChildEnvelope(root(), child())).toMatchObject({ ok: true });
  });

  it.each([
    ['tenant', 'agency-business'],
    ['domain', 'business'],
    ['project', 'seo-agency'],
    ['environment', 'production'],
  ])('a child that changes %s and nothing else is refused, naming it', (field, value) => {
    const result = checkChildEnvelope(root(), { ...child(), [field]: value });
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    expect(result.ok ? [] : result.reasons).toHaveLength(1);
    expect((result.ok ? [] : result.reasons)[0]).toContain(`child's ${field}`);
  });

  it('a child naming the same project and another tenant is refused', () => {
    const result = checkChildEnvelope(root(), { ...child(), project: root().project, tenant: 'agency-business' });
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
  });

  it('a child of a different parent is refused', () => {
    expect(checkChildEnvelope(root(), { ...child(), parentEnvelopeId: `ENV-${'8'.repeat(24)}` })).toMatchObject({ ok: false, rule: 'R3' });
    expect(checkChildEnvelope(root(), { ...child(), parentEnvelopeId: null })).toMatchObject({ ok: false, rule: 'R3' });
  });

  it('a child may narrow everything that may narrow', () => {
    const narrow = { ...child(), scope: ['docs/'], budget: 10, expiry: SOONER, actionClass: 'P1' };
    expect(checkChildEnvelope(root(), narrow)).toMatchObject({ ok: true });
  });

  it.each([
    ['scope', { scope: ['docs/', 'projectos/security/'] }, "scope 'projectos/security/'"],
    ['budget', { budget: 5001 }, 'budget'],
    ['expiry', { expiry: '2026-11-01T13:00:00.001Z' }, 'expiry'],
    ['class', { actionClass: 'P3' }, 'class'],
  ])('a child that widens %s is refused, naming it', (_name, change, mention) => {
    const result = checkChildEnvelope(root(), { ...child(), ...change });
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    expect(result.ok ? [] : result.reasons).toHaveLength(1);
    expect((result.ok ? [] : result.reasons)[0]).toContain(mention);
  });

  it('a malformed child is an R1 refusal, not a pass by omission', () => {
    const { tenant: _tenant, ...rest } = child();
    expect(checkChildEnvelope(root(), rest)).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('a malformed parent is refused', () => {
    const { tenant: _tenant, ...rest } = root();
    expect(checkChildEnvelope(rest, child())).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('a minted child inherits the lineage when it has the same tenant', () => {
    const parent = root();
    const result = mintEnvelope(context({ envelopeId: CHILD_ID }), { ...REQUEST, action: 'implement', budget: 100, expiry: SOONER }, parent);
    expect(result.ok && result.envelope.parentEnvelopeId).toBe(parent.envelopeId);
  });

  it('a second project in the SAME tenant is a different project: refused for project alone', () => {
    const result = mintEnvelope(context({ binding: projectos(), envelopeId: CHILD_ID }), REQUEST, root());
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    expect(result.ok ? [] : result.reasons).toEqual(["the child's project 'projectos' is not its parent's 'polygo'"]);
  });

  it('a child minted under another tenant binding is refused: cross-tenant work is a new root', () => {
    const result = mintEnvelope(context({ binding: agency(), envelopeId: CHILD_ID }), REQUEST, root());
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
  });

  it('a child action in another environment is refused: a live charge is not a step of a local run', () => {
    const parent = minted(mintEnvelope(context(), { ...REQUEST, action: 'secrets-handling' }));
    const result = mintEnvelope(context({ envelopeId: CHILD_ID }), { ...REQUEST, action: 'payment-or-live-charge' }, parent);
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    expect((result.ok ? [] : result.reasons).join(' ')).toContain("child's environment");
  });

  it('a child action of a higher class is refused', () => {
    const parent = minted(mintEnvelope(context(), { ...REQUEST, action: 'implement' }));
    expect(mintEnvelope(context({ envelopeId: CHILD_ID }), { ...REQUEST, action: 'commit' }, parent)).toMatchObject({ ok: false, rule: 'R3' });
  });
});

describe('R4: recorded at admission, or it does not run', () => {
  const recorder = (): { record: (line: EnvelopeRecord) => boolean; lines: EnvelopeRecord[] } => {
    const lines: EnvelopeRecord[] = [];
    return { lines, record: (line) => lines.push(line) > 0 };
  };

  it('an admitted envelope is recorded as allowed before the answer returns', () => {
    const { record, lines } = recorder();
    const result = admitEnvelope(mintEnvelope(context(), REQUEST), NOW, record);
    expect(result).toMatchObject({ admitted: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ stage: 'admission', outcome: 'allowed', at: NOW });
  });

  it('nothing is admitted when the line could not be written: the same envelope, a failing port', () => {
    const envelope = mintEnvelope(context(), REQUEST);
    expect(admitEnvelope(envelope, NOW, () => true)).toMatchObject({ admitted: true });
    expect(admitEnvelope(envelope, NOW, () => false)).toMatchObject({ admitted: false, rule: 'R4', recorded: false });
  });

  it('a recorder that throws is a recorder that failed, and the throw goes no further', () => {
    const failing = (): boolean => {
      throw new Error('disk full');
    };
    expect(admitEnvelope(mintEnvelope(context(), REQUEST), NOW, failing)).toMatchObject({ admitted: false, rule: 'R4', recorded: false });
  });

  it('a recorder that answers something other than true did not record', () => {
    const vague = (() => undefined) as unknown as (line: EnvelopeRecord) => boolean;
    expect(admitEnvelope(mintEnvelope(context(), REQUEST), NOW, vague)).toMatchObject({ admitted: false, rule: 'R4' });
  });

  it('a refusal is recorded too, naming its rule', () => {
    const { record, lines } = recorder();
    const result = admitEnvelope(mintEnvelope(context({ binding: { ...agency() } }), REQUEST), NOW, record);
    expect(result).toMatchObject({ admitted: false, rule: 'R2', recorded: true });
    expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'R2' });
  });

  it('a refusal that cannot be recorded stays a refusal and says so', () => {
    const result = admitEnvelope(mintEnvelope(context({ binding: { ...agency() } }), REQUEST), NOW, () => false);
    expect(result).toMatchObject({ admitted: false, rule: 'R2', recorded: false });
  });

  it('a forged { ok: true } is parsed again at the door', () => {
    const { record, lines } = recorder();
    const forged = { ok: true, envelope: { tenant: 'agency-business' } } as unknown as EnvelopeResult;
    expect(admitEnvelope(forged, NOW, record)).toMatchObject({ admitted: false, rule: 'R1' });
    expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'R1' });
  });

  it('an expired envelope is refused at admission and recorded; one a millisecond earlier is not', () => {
    const { record, lines } = recorder();
    const envelope = mintEnvelope(context(), REQUEST);
    expect(admitEnvelope(envelope, LATER, record)).toMatchObject({ admitted: false, rule: 'EXPIRED', recorded: true });
    expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'EXPIRED' });
    expect(admitEnvelope(envelope, '2026-11-01T12:59:59.999Z', record)).toMatchObject({ admitted: true });
  });

  it('an unreadable clock has expired everything', () => {
    expect(envelopeExpired(root(), 'whenever')).toBe(true);
    expect(envelopeExpired(root(), NOW)).toBe(false);
  });

  it('an unregistered action is admitted at P5, recorded at the class it deserves', () => {
    const { record, lines } = recorder();
    const result = admitEnvelope(mintEnvelope(context(), { ...REQUEST, action: 'delete-everything' }), NOW, record);
    expect(result).toMatchObject({ admitted: true });
    expect(lines[0]?.envelope).toMatchObject({ actionClass: 'P5', environment: 'production' });
  });

  it('execution is recorded with its outcome and rule, and reports a failed write', () => {
    const { record, lines } = recorder();
    expect(recordExecution(root(), 'refused', 'R7', NOW, record)).toBe(true);
    expect(lines[0]).toMatchObject({ stage: 'execution', outcome: 'refused', rule: 'R7' });
    expect(recordExecution(root(), 'allowed', null, NOW, () => false)).toBe(false);
  });
});
