import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classAtMost,
  parseActionRegistry,
  resolveAction,
  type ActionRegistry,
  type ActionRegistryResult,
} from '../src/actionRegistry.js';
import { ALWAYS_OWNER_ONLY } from '../src/ownerOnlyActions.js';
import { actionsFor } from '../src/permissions.js';

const committedPath = fileURLToPath(new URL('../../security/action-registry.json', import.meta.url));
const committed = (): Record<string, unknown> => JSON.parse(readFileSync(committedPath, 'utf8')) as Record<string, unknown>;

type Entry = Record<string, unknown>;
const entriesOf = (raw: Record<string, unknown>): Entry[] => raw['actions'] as Entry[];

function withEntry(id: string, change: Entry): Record<string, unknown> {
  const raw = committed();
  return { ...raw, actions: entriesOf(raw).map((entry) => (entry['id'] === id ? { ...entry, ...change } : entry)) };
}

function withExtra(entry: Entry): Record<string, unknown> {
  const raw = committed();
  return { ...raw, actions: [...entriesOf(raw), entry] };
}

function without(id: string): Record<string, unknown> {
  const raw = committed();
  return { ...raw, actions: entriesOf(raw).filter((entry) => entry['id'] !== id) };
}

const NEW_ACTION: Entry = { id: 'reindex', governanceAction: null, ownerOnlyAction: null, class: 'P2', environment: 'local' };

function codes(result: ActionRegistryResult): readonly string[] {
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

function registry(): ActionRegistry {
  const parsed = parseActionRegistry(committed());
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

describe('the committed action registry', () => {
  it('passes whole-file validation', () => {
    expect(codes(parseActionRegistry(committed()))).toEqual([]);
  });

  it('names every spelling of both existing vocabularies', () => {
    for (const action of [...actionsFor('owner'), ...ALWAYS_OWNER_ONLY]) {
      expect(resolveAction(registry(), action).registered, action).toBe(true);
    }
  });

  it('gives the two spellings of closing a phase one answer', () => {
    expect(resolveAction(registry(), 'close_phase')).toMatchObject({ registered: true, actionClass: 'P5' });
    expect(resolveAction(registry(), 'phase-closure')).toMatchObject({ registered: true, actionClass: 'P5' });
    const entry = registry().actions.find((action) => action.id === 'phase-closure');
    expect([entry?.governanceAction, entry?.ownerOnlyAction]).toEqual(['close_phase', 'phase-closure']);
  });

  it.each(['cross-tenant-access', 'tenant-registry-change', 'action-registry-change'])('%s is registered as P5', (action) => {
    expect(resolveAction(registry(), action)).toMatchObject({ registered: true, actionClass: 'P5' });
  });

  it.each([
    ['approve', 'P5'],
    ['reject', 'P5'],
    ['override_gate', 'P5'],
    ['secrets-handling', 'P5'],
    ['payment-or-live-charge', 'P5'],
    ['credential-release', 'P5'],
    ['commit', 'P3'],
    ['push', 'P3'],
    ['broker-call', 'P3'],
    ['action-registry-change', 'P5'],
    ['implement', 'P2'],
    ['run-start', 'P2'],
    ['run_validators', 'P1'],
    ['project-selection', 'P1'],
    ['bridge-read', 'P1'],
  ])('%s is %s, as ADR-K1 §3 and §4 say', (action, actionClass) => {
    expect(resolveAction(registry(), action).actionClass).toBe(actionClass);
  });

  it('declares the target environment on the entry, and the only live charge is production', () => {
    expect(resolveAction(registry(), 'payment-or-live-charge').environment).toBe('production');
    expect(resolveAction(registry(), 'commit').environment).toBe('local');
  });
});

describe('R5: an unregistered action is P5', () => {
  it('a registered action keeps its own class: the positive control', () => {
    expect(resolveAction(registry(), 'implement')).toMatchObject({ registered: true, actionClass: 'P2', environment: 'local' });
  });

  it('an unknown action is P5 in the strictest environment', () => {
    expect(resolveAction(registry(), 'delete-everything')).toEqual({
      action: 'delete-everything',
      registered: false,
      actionClass: 'P5',
      environment: 'production',
    });
  });

  it.each(['Commit', 'commit ', ' commit', 'COMMIT', 'close-phase', 'phase_closure'])('the near miss %j is not a synonym', (action) => {
    expect(resolveAction(registry(), action)).toMatchObject({ registered: false, actionClass: 'P5' });
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('the object-prototype name %s is unregistered', (action) => {
    expect(resolveAction(registry(), action)).toMatchObject({ registered: false, actionClass: 'P5' });
  });

  it('a registry that did not pass parseActionRegistry registers nothing, whatever it says', () => {
    const forged = { actions: [{ id: 'commit', governanceAction: null, ownerOnlyAction: 'commit', actionClass: 'P1', environment: 'local' }] } as ActionRegistry;
    expect(resolveAction(forged, 'commit')).toMatchObject({ registered: false, actionClass: 'P5' });
    expect(resolveAction({ ...registry() }, 'implement')).toMatchObject({ registered: false, actionClass: 'P5' });
  });
});

describe('whole-file validation', () => {
  it('a valid addition is accepted: the positive control for every refusal below', () => {
    expect(codes(parseActionRegistry(withExtra(NEW_ACTION)))).toEqual([]);
  });

  it.each([
    ['id', { id: 're*' }],
    ['id with ?', { id: 're?' }],
    ['governance spelling', { governanceAction: 'close*' }],
    ['owner-only spelling', { ownerOnlyAction: '*' }],
  ])('a wildcard %s refuses the whole file, by name', (_name, change) => {
    const result = parseActionRegistry(withExtra({ ...NEW_ACTION, ...change }));
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('ACTION_REGISTRY_WILDCARD');
  });

  it.each([
    ['an id used twice', { id: 'commit' }],
    ['a spelling claimed by a second entry', { governanceAction: 'approve' }],
    ['an owner-only spelling claimed by a second entry', { ownerOnlyAction: 'commit' }],
  ])('%s refuses the whole file, by name', (_name, change) => {
    const result = parseActionRegistry(withExtra({ ...NEW_ACTION, ...change }));
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('ACTION_REGISTRY_DUPLICATE');
  });

  it('one entry may repeat its own spelling across its columns', () => {
    expect(codes(parseActionRegistry(withExtra({ ...NEW_ACTION, governanceAction: null, id: 'reindex' })))).toEqual([]);
    expect(codes(parseActionRegistry(committed()))).toEqual([]);
  });

  it.each(['approve', 'implement', 'commit', 'payment-or-live-charge'])('losing %s from a vocabulary refuses the whole file', (id) => {
    expect(codes(parseActionRegistry(without(id)))).toContain('ACTION_REGISTRY_VOCABULARY');
  });

  it('inventing a spelling under a vocabulary column refuses the whole file', () => {
    expect(codes(parseActionRegistry(withExtra({ ...NEW_ACTION, governanceAction: 'make_it_so' })))).toEqual(['ACTION_REGISTRY_VOCABULARY']);
    expect(codes(parseActionRegistry(withExtra({ ...NEW_ACTION, ownerOnlyAction: 'deploy' })))).toEqual(['ACTION_REGISTRY_VOCABULARY']);
  });

  it.each(['cross-tenant-access', 'tenant-registry-change', 'action-registry-change'])('losing the reserved action %s refuses the whole file', (id) => {
    expect(codes(parseActionRegistry(without(id)))).toEqual(['ACTION_REGISTRY_VOCABULARY']);
  });

  it.each([
    ['phase-closure', 'P4'],
    ['secrets-handling', 'P1'],
    ['payment-or-live-charge', 'P4'],
    ['approve', 'P4'],
    ['reject', 'P1'],
    ['override_gate', 'P2'],
    ['commit', 'P2'],
    ['push', 'P1'],
    ['cross-tenant-access', 'P4'],
    ['tenant-registry-change', 'P1'],
  ])('%s written down as %s is refused: a class is never lowered (R6)', (id, cls) => {
    expect([...new Set(codes(parseActionRegistry(withEntry(id, { class: cls }))))]).toEqual(['ACTION_REGISTRY_CLASS_LOWERED']);
  });

  it.each([
    ['the absolute owner-only floor', 'secrets-handling', 'P4'],
    ['the owner-only governance floor', 'approve', 'P4'],
    ['the owner floor', 'push', 'P2'],
    ['the reserved floor', 'tenant-registry-change', 'P4'],
  ])('%s is the ONLY rule refusing %s at %s, so removing it fails this test', (_floor, id, cls) => {
    expect(codes(parseActionRegistry(withEntry(id, { class: cls })))).toHaveLength(1);
  });

  it('cross-tenant access is exactly P5, not P6: ADR-K1 §4 keeps it grantable by the data owner', () => {
    expect(codes(parseActionRegistry(withEntry('cross-tenant-access', { class: 'P6' })))).toEqual(['ACTION_REGISTRY_CLASS_LOWERED']);
  });

  it('a class may be RAISED above its floor', () => {
    expect(codes(parseActionRegistry(withEntry('commit', { class: 'P5' })))).toEqual([]);
  });

  it.each([
    ['a missing spelling column', () => withExtra({ id: 'reindex', governanceAction: null, class: 'P2', environment: 'local' })],
    ['an unknown class', () => withExtra({ ...NEW_ACTION, class: 'P7' })],
    ['an unknown environment', () => withExtra({ ...NEW_ACTION, environment: 'prod' })],
    ['an unknown field', () => withExtra({ ...NEW_ACTION, grant: 'anyone' })],
    ['an invalid spelling', () => withExtra({ ...NEW_ACTION, id: 'Re Index' })],
    ['an entry that is not an object', () => withExtra('reindex' as unknown as Entry)],
    ['a wrong schema version', () => ({ ...committed(), schemaVersion: '9' })],
    ['a wrong policy', () => ({ ...committed(), policy: 'nope' })],
    ['an unknown top-level field', () => ({ ...committed(), defaultClass: 'P1' })],
  ])('refuses %s', (_name, make) => {
    expect(parseActionRegistry(make()).ok).toBe(false);
  });

  it.each(['note', 'authority', 'authorisedBy', 'provenance', 'trustBasis'])('a record with no %s is refused', (field) => {
    const { [field]: _removed, ...rest } = committed();
    expect(codes(parseActionRegistry(rest))).toEqual(['ACTION_REGISTRY_INVALID']);
  });

  it('refuses something that is not an object', () => {
    expect(parseActionRegistry('x').ok).toBe(false);
    expect(parseActionRegistry([]).ok).toBe(false);
  });
});

describe('classAtMost', () => {
  it('orders the classes, and an equal class is at most itself', () => {
    expect(classAtMost('P1', 'P5')).toBe(true);
    expect(classAtMost('P5', 'P5')).toBe(true);
    expect(classAtMost('P5', 'P1')).toBe(false);
  });

  it('an unknown class is at most nothing', () => {
    expect(classAtMost('P0', 'P5')).toBe(false);
    expect(classAtMost('P1', 'P9')).toBe(false);
  });
});
