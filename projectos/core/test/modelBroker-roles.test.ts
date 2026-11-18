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
  workers: [
    { workerId: 'claude-local', grants: ['Write(.projectops/execution/*.findings.json)', 'Edit(.projectops/execution/*.findings.json)'] },
    { workerId: 'claude-reviewer', grants: ['Read', 'Grep', 'Glob'] },
    { workerId: 'codex-local', grants: [] },
  ],
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
    expect(refusedCodes(validateRoleRegistry(GOOD, { ...KNOWN, workers: [] }))).toContain('UNKNOWN_WORKER');
    expect(refusedCodes(validateRoleRegistry(GOOD, { workers: 'claude-local' } as unknown as KnownRoleSources))).toContain('BAD_SOURCES');
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

describe('a role fits its worker and its capabilities (review round, MEDIUM 1)', () => {
  it('refuses the swap: the reviewer may not be the worker that holds write grants', () => {
    const swapped = withRole('implementer', { workerId: 'claude-reviewer' });
    swapped.roles.reviewer = { ...swapped.roles.reviewer, workerId: 'claude-local' };
    const r = validateRoleRegistry(swapped, KNOWN);
    expect(refusedCodes(r)).toContain('REVIEWER_NOT_READ_ONLY');
    expect(!r.ok && r.refusals.find((x) => x.code === 'REVIEWER_NOT_READ_ONLY')?.reason).toContain('claude-local');
  });

  it('refuses a reviewer with any non-read grant, an ambiguous grant, or an unbalanced one, and accepts reads and no grants', () => {
    const asReviewer = (grants: string[]) => ({ ...KNOWN, workers: [...KNOWN.workers, { workerId: 'rev-x', grants }] });
    const doc = withRole('reviewer', { workerId: 'rev-x' });
    for (const grants of [['Read', 'Bash'], ['Write(a)'], ['PowerShell'], ['Read((x) Bash(*)'], ['Read(a))']]) {
      expect(refusedCodes(validateRoleRegistry(doc, asReviewer(grants))), grants.join()).toContain('REVIEWER_NOT_READ_ONLY');
    }
    for (const grants of [[], ['Read'], ['Read', 'Grep(src/**)', 'Glob', 'LS']]) {
      expect(validateRoleRegistry(doc, asReviewer(grants)).ok, grants.join()).toBe(true);
    }
  });

  it('judges the implementer by nothing it holds: write grants are what an implementer has', () => {
    expect(validateRoleRegistry(GOOD, KNOWN).ok).toBe(true);
  });

  it('binds capabilities to roles: each role must carry its own, and none that belongs to another', () => {
    const cases: [string, string[]][] = [
      ['gatekeeper', ['implement']],
      ['gatekeeper', ['gatekeeper-review', 'implement']],
      ['implementer', ['gatekeeper-review', 'plan-authoring']],
      ['implementer', ['implement', 'review']],
      ['implementer', ['review']],
      ['reviewer', ['implement', 'review']],
      ['reviewer', ['plan-authoring']],
    ];
    for (const [role, capabilities] of cases) {
      expect(refusedCodes(validateRoleRegistry(withRole(role, { capabilities }), KNOWN)), `${role} ${capabilities.join()}`).toContain('CAPABILITY_MISMATCH');
    }
    expect(refusedCodes(validateRoleRegistry(withRole('gatekeeper', { capabilities: ['plan-authoring'] }), KNOWN))).toContain('CAPABILITY_MISMATCH');
  });

  it('a gatekeeper may carry any mix of the gatekeeper capabilities so long as it carries gatekeeper-review', () => {
    for (const capabilities of [['gatekeeper-review'], ['gatekeeper-review', 'closure-question'], ['closure-question', 'gatekeeper-review', 'plan-authoring']]) {
      expect(validateRoleRegistry(withRole('gatekeeper', { capabilities }), KNOWN).ok, capabilities.join()).toBe(true);
    }
  });

  it('requires an implementer: a registry with only a reviewer or only the gatekeeper is refused', () => {
    const onlyReviewer = { schema: 1, roles: { reviewer: GOOD.roles.reviewer } };
    const onlyGatekeeper = { schema: 1, roles: { gatekeeper: GOOD.roles.gatekeeper } };
    for (const doc of [onlyReviewer, onlyGatekeeper]) {
      const r = validateRoleRegistry(doc, KNOWN);
      expect(refusedCodes(r)).toContain('NO_IMPLEMENTER');
      expect(!r.ok && r.refusals.find((x) => x.code === 'NO_IMPLEMENTER')?.next).toMatch(/implementer/);
    }
    expect(refusedCodes(validateRoleRegistry({ schema: 1, roles: {} }, KNOWN))).not.toContain('NO_IMPLEMENTER');
  });
});

describe('a hostile object cannot make validation throw (review round, LOW 3)', () => {
  it('refuses a Proxy whose ownKeys throws, and a revoked Proxy, as NOT_A_RECORD', () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    for (const roles of [hostile, proxy]) {
      let r: RoleParse | undefined;
      expect(() => { r = validateRoleRegistry({ schema: 1, roles }, KNOWN); }).not.toThrow();
      expect(r && refusedCodes(r)).toContain('NOT_A_RECORD');
    }
    expect(refusedCodes(validateRoleRegistry(hostile, KNOWN))).toContain('NOT_A_RECORD');
  });

  it('a getPrototypeOf trap that throws is refused the same way', () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('boom'); } });
    expect(refusedCodes(validateRoleRegistry({ schema: 1, roles: hostile }, KNOWN))).toContain('NOT_A_RECORD');
  });

  it('a throwing getter is refused as ACCESSOR without being called, and a throwing toJSON is never called', () => {
    let called = 0;
    const getter = { schema: 1, get roles(): unknown { called += 1; throw new Error('boom'); } };
    const withToJson = { schema: 1, roles: {}, toJSON(): unknown { called += 1; throw new Error('boom'); } };
    let a: RoleParse | undefined;
    let b: RoleParse | undefined;
    expect(() => { a = validateRoleRegistry(getter, KNOWN); }).not.toThrow();
    expect(() => { b = validateRoleRegistry(withToJson, KNOWN); }).not.toThrow();
    expect(a && refusedCodes(a)).toContain('ACCESSOR');
    expect(b && refusedCodes(b)).not.toContain('NOT_JSON');
    expect(called).toBe(0);
  });

  it('a Proxy whose descriptor or get trap throws is refused the same way', () => {
    const traps = [new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('boom'); }, ownKeys: () => ['a'] }), new Proxy([], { get() { throw new Error('boom'); } })];
    for (const roles of traps) {
      let r: RoleParse | undefined;
      expect(() => { r = validateRoleRegistry({ schema: 1, roles }, KNOWN); }).not.toThrow();
      expect(r && refusedCodes(r)).toContain('NOT_A_RECORD');
    }
  });

  it('text that is not a string, and sources that throw when read, are typed refusals and never a throw', () => {
    const hostileText = { toString() { throw new Error('boom'); } } as unknown as string;
    const hostileSources = new Proxy({}, { get() { throw new Error('boom'); } }) as unknown as KnownRoleSources;
    let a: RoleParse | undefined;
    let b: RoleParse | undefined;
    let c: RoleParse | undefined;
    expect(() => { a = parseRoleRegistry(hostileText, KNOWN); }).not.toThrow();
    expect(() => { b = validateRoleRegistry(GOOD, hostileSources); }).not.toThrow();
    expect(() => { c = parseRoleRegistry(JSON.stringify(GOOD), hostileSources); }).not.toThrow();
    expect(a && refusedCodes(a)).toEqual(['NOT_JSON']);
    expect(b && refusedCodes(b)).toEqual(['BAD_SOURCES']);
    expect(c && refusedCodes(c)).toEqual(['BAD_SOURCES']);
  });

  it('selecting with a hostile role name returns nothing instead of throwing', () => {
    const registry = parseRoleRegistry(JSON.stringify(GOOD), KNOWN);
    const hostile = { toString() { throw new Error('boom'); } } as unknown as string;
    expect(registry.ok && (() => selectForRole(registry.registry, hostile))).not.toThrow();
    expect(registry.ok && selectForRole(registry.registry, hostile)).toBeNull();
  });
});

describe('notes carry no invisible or reordering characters (review round, LOW 4)', () => {
  it.each([
    ['a C1 control', 'a\u0085b'],
    ['a zero-width space', 'a\u200bb'],
    ['a left-to-right mark', 'a\u200eb'],
    ['a line separator', 'a\u2028b'],
    ['a paragraph separator', 'a\u2029b'],
    ['a bidi override', 'a\u202eb'],
    ['a bidi isolate', 'a\u2066b'],
    ['a byte-order mark', 'a\uFEFFb'],
    ['a tag character', 'a\u{E0041}b'],
    ['a DEL', 'a\u007fb'],
  ])('refuses %s', (_name, notes) => {
    expect(refusedCodes(validateRoleRegistry(withRole('implementer', { notes }), KNOWN))).toContain('BAD_NOTES');
  });

  it('still accepts ordinary text with accents and punctuation', () => {
    expect(validateRoleRegistry(withRole('implementer', { notes: 'The owner login: caf\u00e9, no price (none recorded).' }), KNOWN).ok).toBe(true);
  });
});

describe('a key written twice is refused, not resolved to the last (review round, LOW 5)', () => {
  const text = JSON.stringify(GOOD, null, 2);
  it('refuses a duplicate implementer role, a duplicate field inside a role and a duplicate top-level key', () => {
    const dupRole = text.replace('"implementer": {', '"implementer": { "workerId": "claude-reviewer", "capabilities": ["implement"], "cost": {"class":"unmetered"}, "notes": "x" },\n    "implementer": {');
    const dupField = text.replace('"workerId": "claude-local",', '"workerId": "claude-local", "workerId": "claude-reviewer",');
    const dupTop = text.replace('"schema": 1,', '"schema": 1, "schema": 1,');
    for (const t of [dupRole, dupField, dupTop]) {
      const r = parseRoleRegistry(t, KNOWN);
      expect(refusedCodes(r)).toContain('DUPLICATE_KEY');
    }
  });

  it('sees through an escaped spelling of the same key', () => {
    const t = text.replace('"workerId": "claude-local",', '"workerId": "claude-local", "worker\\u0049d": "claude-reviewer",');
    expect(refusedCodes(parseRoleRegistry(t, KNOWN))).toContain('DUPLICATE_KEY');
  });

  it('does not mistake the same key in two different records, or a repeated string value, for a duplicate', () => {
    expect(parseRoleRegistry(text, KNOWN).ok).toBe(true);
    const t = text.replace('"notes": "the owner login"', '"notes": "notes"');
    expect(parseRoleRegistry(t, KNOWN).ok).toBe(true);
  });

  it('names the key, never a value', () => {
    const t = text.replace('"schema": 1,', '"schema": 1, "schema": 1,');
    const r = parseRoleRegistry(t, KNOWN);
    expect(!r.ok && r.refusals.find((x) => x.code === 'DUPLICATE_KEY')?.reason).toContain('schema');
  });
});
