import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry } from '../src/actionRegistry.js';
import { admitEnvelope, mintEnvelope, type TaskEnvelope } from '../src/taskEnvelope.js';
import { parseTenantRegistry, resolveTenant } from '../src/tenant.js';
import { contextRetrievalKeyOf } from '../src/context/managerKey.js';

const json = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../security/${name}`, import.meta.url)), 'utf8'));
const NOW = '2026-11-01T12:00:00.000Z';
const LATER = '2026-11-01T13:00:00.000Z';
const NEVER_PROXY = (): boolean => false;

function binding(projectId: string, repository: string, root: string) {
  const parsed = parseTenantRegistry(json('tenant-registry.json'));
  if (!parsed.ok) throw new Error('the committed tenant registry does not parse');
  const resolved = resolveTenant(parsed.registry, { projectId, repository, root, worktrees: null });
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  return resolved.binding;
}

function admittedRun(projectId = 'polygo', repository = 'github.com/polygonia-apres/polygo', root = 'C:/dev/Polygo/polygo', action = 'run-start'): TaskEnvelope {
  const registry = parseActionRegistry(json('action-registry.json'));
  if (!registry.ok) throw new Error('the committed action registry does not parse');
  const minted = mintEnvelope(
    { binding: binding(projectId, repository, root), registry: registry.registry, principal: 'implementer', actor: { agent: 'claude-code-cli', provider: 'anthropic', model: 'm' }, envelopeId: `ENV-${'1'.repeat(24)}` },
    { action, subjectHash: 'a'.repeat(40), scope: [`project:${projectId}`], budget: 0, expiry: LATER, intentScope: 'governed-run' },
  );
  const admission = admitEnvelope(minted, NOW, () => true, () => true);
  if (!admission.admitted) throw new Error('the run was not admitted');
  return admission.envelope;
}

describe('retrieval is keyed on the admitted run envelope and on nothing else', () => {
  it('turns an admitted run envelope into its tenant, domain and project', () => {
    const run = admittedRun();
    const key = contextRetrievalKeyOf(run, NEVER_PROXY, NOW);
    expect(key).toEqual({ ok: true, key: { envelopeId: run.envelopeId, tenant: run.tenant, domain: run.domain, project: run.project } });
    expect(Object.isFrozen((key as { key: object }).key)).toBe(true);
  });

  it('gives another project of the same install another key', () => {
    const a = contextRetrievalKeyOf(admittedRun(), NEVER_PROXY, NOW);
    const b = contextRetrievalKeyOf(admittedRun('projectos', 'github.com/universalbizcomply/ProjectOS', 'C:/dev/ProjectOS'), NEVER_PROXY, NOW);
    if (!a.ok || !b.ok) throw new Error('both keys should have been made');
    expect(a.key.project).not.toBe(b.key.project);
    expect(`${a.key.tenant}/${a.key.project}`).not.toBe(`${b.key.tenant}/${b.key.project}`);
  });

  it.each([null, undefined])('fails closed with no envelope (%s): nothing is retrieved', (envelope) => {
    expect(contextRetrievalKeyOf(envelope, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_NO_ENVELOPE' });
  });

  it.each([
    ['a string', 'ENV-1'],
    ['a number', 7],
    ['a list', []],
    ['an empty object', {}],
    ['a tenant and project only', { tenant: 'polygo', project: 'polygo', domain: 'develop' }],
  ])('refuses %s as not an envelope', (_name, value) => {
    expect(contextRetrievalKeyOf(value, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
  });

  it('refuses an envelope with a field changed to something that does not parse, and one with an unknown field', () => {
    const run = admittedRun();
    expect(contextRetrievalKeyOf({ ...run, tenant: 'Not A Tenant' }, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    expect(contextRetrievalKeyOf({ ...run, domain: 'everything' }, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    expect(contextRetrievalKeyOf({ ...run, tenantOverride: 'other' }, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
  });

  it('refuses an envelope that is not a run: a crossing or a read does not key retrieval', () => {
    const run = admittedRun();
    expect(contextRetrievalKeyOf({ ...run, action: 'project-selection' }, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_NOT_A_RUN' });
  });

  it('refuses a run whose scope does not name its own project', () => {
    const run = admittedRun();
    expect(contextRetrievalKeyOf({ ...run, scope: ['project:another-project'] }, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_NOT_A_RUN' });
    expect(contextRetrievalKeyOf({ ...run, scope: [] }, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_NOT_A_RUN' });
  });

  it('refuses an expired envelope, and a clock that cannot be read', () => {
    const run = admittedRun();
    expect(contextRetrievalKeyOf(run, NEVER_PROXY, '2026-11-01T14:00:00.000Z')).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_EXPIRED' });
    expect(contextRetrievalKeyOf(run, NEVER_PROXY, 'tomorrow')).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_EXPIRED' });
    expect(contextRetrievalKeyOf(run, NEVER_PROXY, undefined)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_EXPIRED' });
  });

  it('reads the envelope once: a getter is refused, not read twice', () => {
    const run = admittedRun();
    let reads = 0;
    const hostile = { ...run };
    Object.defineProperty(hostile, 'tenant', { enumerable: true, get: () => (reads++ === 0 ? run.tenant : 'someone-else') });
    expect(contextRetrievalKeyOf(hostile, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    expect(reads).toBe(0);
  });

  it('refuses a key that would reach the prototype, and an envelope that inherits a field', () => {
    const run = admittedRun();
    const proto = JSON.parse(`{"__proto__": {"tenant": "x"}, "envelopeVersion": 2}`);
    expect(contextRetrievalKeyOf(proto, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    const inheriting = Object.create({ tenant: run.tenant });
    expect(contextRetrievalKeyOf(inheriting, NEVER_PROXY, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
  });

  it('is told by an injected port whether the envelope is a Proxy, and fails closed without a clear answer', () => {
    const run = admittedRun();
    expect(contextRetrievalKeyOf(run, () => true, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    for (const answer of [undefined, null, 0, 1, 'false', {}]) {
      expect(contextRetrievalKeyOf(run, () => answer, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    }
    expect(contextRetrievalKeyOf(run, () => { throw new Error('boom'); }, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    for (const port of [undefined, null, 'no', {}]) {
      expect(contextRetrievalKeyOf(run, port, NOW)).toMatchObject({ ok: false, code: 'CONTEXT_MANAGER_ENVELOPE_INVALID' });
    }
  });

  it('a refusal never quotes the envelope', () => {
    const refusal = contextRetrievalKeyOf({ ...admittedRun(), tenant: 'SECRET TENANT TEXT' }, NEVER_PROXY, NOW);
    expect(JSON.stringify(refusal)).not.toContain('SECRET TENANT TEXT');
  });
});
