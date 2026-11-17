import { describe, expect, it } from 'vitest';
import {
  MAX_ROLE_REGISTRY_BYTES,
  ROLE_CAPABILITIES,
  ROLE_IDS,
  parseRoleRegistry,
  selectForRole,
  validateRoleRegistry,
  type KnownRoleSources,
  type RoleParse,
} from '../src/modelBroker/index.js';

const CARD = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1250000, outputMicroUsdPerMillion: 10000000 };
const KNOWN: KnownRoleSources = {
  workerIds: ['claude-local', 'claude-reviewer', 'codex-local'],
  gatekeeperTransportId: 'openai-primary',
  rateCards: { 'gpt-5.6-terra': CARD },
};
const GOOD = {
  schema: 1,
  roles: {
    implementer: { workerId: 'claude-local', capabilities: ['implement'], cost: { class: 'unmetered' }, notes: 'the owner login' },
    reviewer: { workerId: 'claude-reviewer', capabilities: ['review'], cost: { class: 'unmetered' }, notes: 'read only' },
    gatekeeper: {
      transportId: 'openai-primary',
      capabilities: ['gatekeeper-review', 'plan-authoring', 'closure-question'],
      cost: { class: 'metered', model: 'gpt-5.6-terra' },
      notes: 'the committed route',
    },
  },
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const refusedCodes = (r: RoleParse): string[] => (r.ok ? [] : r.refusals.map((x) => x.code));
const withRole = (role: string, patch: Record<string, unknown>) => {
  const doc = clone(GOOD) as { roles: Record<string, Record<string, unknown>> };
  doc.roles[role] = { ...doc.roles[role], ...patch };
  return doc;
};

describe('the role registry names only what is already authorised (rule 1)', () => {
  it('accepts a registry whose workers and transport are all known: the positive control', () => {
    const r = parseRoleRegistry(JSON.stringify(GOOD), KNOWN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.registry.roles.map((e) => e.role)).toEqual([...ROLE_IDS]);
    expect(r.ok && r.registry.get('implementer')?.workerId).toBe('claude-local');
  });

  it('refuses a worker that is not in the committed execution workers, and says what to do', () => {
    const r = validateRoleRegistry(withRole('implementer', { workerId: 'ghost-worker' }), KNOWN);
    expect(refusedCodes(r)).toContain('UNKNOWN_WORKER');
    expect(!r.ok && r.refusals[0]?.next).toMatch(/execution\.workers/);
  });

  it('refuses a gatekeeper transport that is not the committed one, and any gatekeeper when none is committed', () => {
    expect(refusedCodes(validateRoleRegistry(withRole('gatekeeper', { transportId: 'other-route' }), KNOWN))).toContain('UNKNOWN_TRANSPORT');
    expect(refusedCodes(validateRoleRegistry(GOOD, { ...KNOWN, gatekeeperTransportId: null }))).toContain('UNKNOWN_TRANSPORT');
  });

  it('refuses a worker role that names a transport and a gatekeeper role that names a worker', () => {
    const asTransport = withRole('implementer', { transportId: 'openai-primary' });
    expect(refusedCodes(validateRoleRegistry(asTransport, KNOWN))).toContain('UNKNOWN_FIELD');
    const asWorker = withRole('gatekeeper', { workerId: 'claude-local' });
    expect(refusedCodes(validateRoleRegistry(asWorker, KNOWN))).toContain('UNKNOWN_FIELD');
  });

  it('refuses an unknown role, an empty registry, a wrong schema and a role that is not a record', () => {
    const extra = clone(GOOD) as { roles: Record<string, unknown> };
    extra.roles['planner'] = clone(GOOD.roles.implementer);
    expect(refusedCodes(validateRoleRegistry(extra, KNOWN))).toContain('UNKNOWN_ROLE');
    expect(refusedCodes(validateRoleRegistry({ schema: 1, roles: {} }, KNOWN))).toContain('NO_ROLES');
    expect(refusedCodes(validateRoleRegistry({ ...GOOD, schema: 2 }, KNOWN))).toContain('UNSUPPORTED_SCHEMA');
    expect(refusedCodes(validateRoleRegistry({ schema: 1, roles: { implementer: 'claude-local' } }, KNOWN))).toContain('NOT_A_RECORD');
  });

  it('a registry that parses is not thereby approved: it carries no verdict field', () => {
    const r = parseRoleRegistry(JSON.stringify(GOOD), KNOWN);
    expect(Object.keys(r)).toEqual(['ok', 'registry']);
    expect(JSON.stringify(r)).not.toMatch(/approved|granted|authoris/i);
  });
});

describe('a metered cost names a priced model in the committed rate cards (rule 2)', () => {
  it('accepts a metered model that has a rate card and an unmetered worker with no model', () => {
    expect(parseRoleRegistry(JSON.stringify(GOOD), KNOWN).ok).toBe(true);
  });

  it('refuses a metered model that has no committed rate card', () => {
    const doc = withRole('gatekeeper', { cost: { class: 'metered', model: 'gpt-unknown' } });
    expect(refusedCodes(validateRoleRegistry(doc, KNOWN))).toContain('UNKNOWN_MODEL');
  });

  it('refuses a zero, missing or negative price, whichever side it is on', () => {
    for (const card of [{ ...CARD, inputMicroUsdPerMillion: 0 }, { ...CARD, outputMicroUsdPerMillion: 0 }, { ...CARD, outputMicroUsdPerMillion: -1 }]) {
      const known = { ...KNOWN, rateCards: { 'gpt-5.6-terra': card } };
      expect(refusedCodes(validateRoleRegistry(GOOD, known)), JSON.stringify(card)).toContain('ZERO_PRICE');
    }
  });

  it('refuses a metered cost with no model, an unmetered cost with a model, and a class that is neither', () => {
    expect(refusedCodes(validateRoleRegistry(withRole('gatekeeper', { cost: { class: 'metered' } }), KNOWN))).toContain('BAD_COST');
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { cost: { class: 'unmetered', model: 'gpt-5.6-terra' } }), KNOWN))).toContain('BAD_COST');
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { cost: { class: 'free' } }), KNOWN))).toContain('BAD_COST');
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { cost: 'unmetered' }), KNOWN))).toContain('BAD_COST');
  });
});

describe('capabilities come from a closed list (rule 3)', () => {
  it('the list is the one the roles actually use', () => {
    expect([...ROLE_CAPABILITIES]).toEqual(['implement', 'review', 'gatekeeper-review', 'plan-authoring', 'closure-question']);
  });

  it('refuses a capability outside the list, an empty list, a duplicate and a non-array', () => {
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { capabilities: ['implement', 'deploy'] }), KNOWN))).toContain('UNKNOWN_CAPABILITY');
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { capabilities: [] }), KNOWN))).toContain('BAD_CAPABILITIES');
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { capabilities: ['implement', 'implement'] }), KNOWN))).toContain('BAD_CAPABILITIES');
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { capabilities: 'implement' }), KNOWN))).toContain('BAD_CAPABILITIES');
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { capabilities: [{ toString: 'implement' }] }), KNOWN))).toContain('UNKNOWN_CAPABILITY');
  });
});

describe('a field that looks like a key, a credential or an endpoint is refused (rule 4)', () => {
  it.each(['apiKey', 'api_key', 'secret', 'accessToken', 'credentialRef', 'password', 'endpoint', 'baseUrl', 'url', 'authorization'])('refuses a field named %s with its own code', (name) => {
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { [name]: 'x' }), KNOWN))).toContain('CREDENTIAL_FIELD');
  });

  it('refuses the same name on the top level, inside a cost and inside the roles map', () => {
    expect(refusedCodes(validateRoleRegistry({ ...GOOD, baseUrl: 'x' }, KNOWN))).toContain('CREDENTIAL_FIELD');
    expect(refusedCodes(validateRoleRegistry(withRole('gatekeeper', { cost: { class: 'metered', model: 'gpt-5.6-terra', secret: 'x' } }), KNOWN))).toContain('CREDENTIAL_FIELD');
    const doc = clone(GOOD) as { roles: Record<string, unknown> };
    doc.roles['tokenRole'] = {};
    expect(refusedCodes(validateRoleRegistry(doc, KNOWN))).toContain('CREDENTIAL_FIELD');
  });

  it('refuses any other unknown field, which is not a credential but is not allowed either', () => {
    const r = validateRoleRegistry(withRole('implementer', { colour: 'blue' }), KNOWN);
    expect(refusedCodes(r)).toEqual(['UNKNOWN_FIELD']);
  });

  it('refuses a note that carries a URL, a key-shaped run or a control character', () => {
    for (const notes of ['see https://example.invalid/x', 'sk-abcdefghijklmnopqrstuvwxyz', 'A'.repeat(24), 'bad\u0007bell', 'x'.repeat(401), 7]) {
      expect(refusedCodes(validateRoleRegistry(withRole('implementer', { notes }), KNOWN)), String(notes).slice(0, 20)).toContain('BAD_NOTES');
    }
  });

  it('a name that is only a refusal reason: the report carries the name, never a value it held', () => {
    const r = validateRoleRegistry(withRole('implementer', { apiKey: 'sk-live-0123456789abcdefghijklmnop' }), KNOWN);
    expect(JSON.stringify(r)).not.toContain('sk-live');
  });
});

describe('what is read is a plain snapshot, taken once (rule 4, shape)', () => {
  it('refuses a field that is an accessor, and never calls it', () => {
    let calls = 0;
    const doc = clone(GOOD) as { roles: { implementer: Record<string, unknown> } };
    Object.defineProperty(doc.roles.implementer, 'workerId', {
      enumerable: true,
      get() {
        calls += 1;
        return 'claude-local';
      },
    });
    expect(refusedCodes(validateRoleRegistry(doc, KNOWN))).toContain('ACCESSOR');
    expect(calls).toBe(0);
  });

  it('refuses an object that is not plain: a class instance, a Map or an array where a record belongs', () => {
    class Box {
      workerId = 'claude-local';
    }
    expect(refusedCodes(validateRoleRegistry({ schema: 1, roles: { implementer: new Box() } }, KNOWN))).toContain('NOT_A_RECORD');
    expect(refusedCodes(validateRoleRegistry({ schema: 1, roles: new Map() }, KNOWN))).toContain('NOT_A_RECORD');
    expect(refusedCodes(validateRoleRegistry({ schema: 1, roles: [] }, KNOWN))).toContain('NOT_A_RECORD');
  });

  it('the result does not move when the input is changed after it was read', () => {
    const doc = clone(GOOD);
    const r = validateRoleRegistry(doc, KNOWN);
    doc.roles.implementer.workerId = 'changed-after';
    expect(r.ok && r.registry.get('implementer')?.workerId).toBe('claude-local');
  });

  it('what comes back is frozen all the way down', () => {
    const r = parseRoleRegistry(JSON.stringify(GOOD), KNOWN);
    if (!r.ok) throw new Error('expected a registry');
    const entry = r.registry.get('gatekeeper');
    expect(Object.isFrozen(r.registry)).toBe(true);
    expect(Object.isFrozen(r.registry.roles)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry?.capabilities)).toBe(true);
    expect(Object.isFrozen(entry?.cost)).toBe(true);
  });

  it('refuses a text over the size cap before it parses it, and text that is not JSON', () => {
    const big = JSON.stringify({ ...GOOD, padding: 'x'.repeat(MAX_ROLE_REGISTRY_BYTES) });
    const r = parseRoleRegistry(big, KNOWN);
    expect(refusedCodes(r)).toEqual(['TOO_LARGE']);
    expect(refusedCodes(parseRoleRegistry('{broken', KNOWN))).toEqual(['NOT_JSON']);
    expect(refusedCodes(parseRoleRegistry(42 as unknown as string, KNOWN))).toEqual(['NOT_JSON']);
  });

  it('caps the refusals it returns, so a hostile file cannot make a report of any size', () => {
    const doc = clone(GOOD) as { roles: Record<string, unknown> };
    for (let i = 0; i < 200; i += 1) doc.roles[`bad${i}`] = {};
    const r = validateRoleRegistry(doc, KNOWN);
    expect(!r.ok && r.refusals.length).toBeLessThanOrEqual(20);
  });

  it('every refusal is a value with a machine code, a plain reason and a next step', () => {
    const r = validateRoleRegistry(withRole('implementer', { workerId: 'ghost' }), KNOWN);
    if (r.ok) throw new Error('expected a refusal');
    for (const refusal of r.refusals) {
      expect(refusal.code).toMatch(/^[A-Z_]+$/);
      expect(refusal.reason.length).toBeGreaterThan(10);
      expect(refusal.next.length).toBeGreaterThan(10);
    }
  });

  it('refuses a malformed set of known sources instead of accepting everything', () => {
    expect(refusedCodes(validateRoleRegistry(GOOD, { ...KNOWN, workerIds: [] }))).toContain('UNKNOWN_WORKER');
    expect(refusedCodes(validateRoleRegistry(GOOD, { workerIds: 'claude-local' } as unknown as KnownRoleSources))).toContain('BAD_SOURCES');
  });
});

describe('the implementer and the reviewer are never one worker (rule 6)', () => {
  it('refuses both roles naming the same worker, and names the worker', () => {
    const doc = withRole('reviewer', { workerId: 'claude-local' });
    const r = validateRoleRegistry(doc, KNOWN);
    expect(refusedCodes(r)).toContain('SAME_WORKER');
    expect(!r.ok && r.refusals.find((x) => x.code === 'SAME_WORKER')?.reason).toContain('claude-local');
  });

  it('accepts two different workers, and a registry with only one of the two roles', () => {
    expect(parseRoleRegistry(JSON.stringify(withRole('reviewer', { workerId: 'codex-local' })), KNOWN).ok).toBe(true);
    const only = { schema: 1, roles: { implementer: GOOD.roles.implementer } };
    expect(validateRoleRegistry(only, KNOWN).ok).toBe(true);
  });

  it('an unknown worker does not hide the same-worker refusal, and both are reported', () => {
    const doc = withRole('reviewer', { workerId: 'ghost' });
    doc.roles.implementer.workerId = 'ghost';
    expect(refusedCodes(validateRoleRegistry(doc, KNOWN))).toEqual(expect.arrayContaining(['UNKNOWN_WORKER', 'SAME_WORKER']));
  });
});

describe('selection returns an entry or nothing, never a verdict (rule 7)', () => {
  const registry = (() => {
    const r = parseRoleRegistry(JSON.stringify(GOOD), KNOWN);
    if (!r.ok) throw new Error('expected a registry');
    return r.registry;
  })();

  it('returns the entry for an assigned worker role', () => {
    const picked = selectForRole(registry, 'implementer');
    expect(picked?.entry.workerId).toBe('claude-local');
    expect(picked?.standing).toBe('assigned');
  });

  it('returns nothing for a role the registry does not carry, and for a name that is not a role', () => {
    const only = parseRoleRegistry(JSON.stringify({ schema: 1, roles: { implementer: GOOD.roles.implementer } }), KNOWN);
    if (!only.ok) throw new Error('expected a registry');
    expect(selectForRole(only.registry, 'reviewer')).toBeNull();
    expect(selectForRole(registry, 'planner')).toBeNull();
    expect(selectForRole(registry, '__proto__')).toBeNull();
    expect(selectForRole(registry, 7 as unknown as string)).toBeNull();
  });

  it('a gatekeeper role reports awaiting: it is a route to a decision, and no decision is held here', () => {
    const picked = selectForRole(registry, 'gatekeeper');
    expect(picked?.standing).toBe('awaiting');
    expect(picked?.entry.transportId).toBe('openai-primary');
  });

  it('no selection carries a verdict, an approval or a decision', () => {
    for (const role of ROLE_IDS) {
      const picked = selectForRole(registry, role);
      expect(Object.keys(picked ?? {}).sort()).toEqual(['entry', 'role', 'standing']);
      expect(JSON.stringify(picked)).not.toMatch(/verdict|approved|accepted|decision/i);
    }
  });

  it('selecting does not change the registry', () => {
    const before = JSON.stringify(registry);
    selectForRole(registry, 'gatekeeper');
    expect(JSON.stringify(registry)).toBe(before);
  });
});
