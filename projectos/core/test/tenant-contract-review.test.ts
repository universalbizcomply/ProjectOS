/**
 * The review round on PROJECTOS-TENANT-CONTRACT1A (ECC SECURITY, Agency software-architect): one proof
 * per finding. Each refusal stands next to a positive control, so the default cannot pass for the rule.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, resolveAction, type ActionRegistry } from '../src/actionRegistry.js';
import * as envelopeModule from '../src/taskEnvelope.js';
import {
  admitEnvelope,
  checkChildEnvelope,
  ENVELOPE_FIELDS,
  mintCrossing,
  mintEnvelope,
  parseEnvelope,
  readmitEnvelope,
  recordExecution,
  type EnvelopeRecord,
  type EnvelopeRequest,
  type EnvelopeResult,
  type KernelEnvelopeContext,
  type TaskEnvelope,
} from '../src/taskEnvelope.js';
import {
  linkedWorktreesFromPorcelain,
  parseTenantRegistry,
  resolveTenant,
  type CheckoutFacts,
  type TenantBinding,
  type TenantRegistry,
} from '../src/tenant.js';

const json = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../security/${name}`, import.meta.url)), 'utf8')) as Record<string, unknown>;

function actionsFrom(raw: Record<string, unknown>): ActionRegistry {
  const parsed = parseActionRegistry(raw);
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const actions = (): ActionRegistry => actionsFrom(json('action-registry.json'));

/** The committed registry plus one entry, for classes nothing is registered at today. */
function actionsWith(id: string, cls: string): ActionRegistry {
  const raw = json('action-registry.json');
  const entry = { id, governanceAction: null, ownerOnlyAction: null, class: cls, environment: 'local' };
  return actionsFrom({ ...raw, actions: [...(raw['actions'] as unknown[]), entry] });
}

function tenants(): TenantRegistry {
  const parsed = parseTenantRegistry(json('tenant-registry.json'));
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const FACTS: Readonly<Record<string, CheckoutFacts>> = {
  polygo: { projectId: 'polygo', repository: 'github.com/polygonia-apres/polygo', root: 'C:/dev/Polygo/polygo', worktrees: null },
  agency: { projectId: 'seo-agency', repository: '127.0.0.1:47900/SEOAgency-remote/seo-agency', root: 'C:/dev/SEOAgency', worktrees: null },
};

function binding(facts: CheckoutFacts): TenantBinding {
  const resolved = resolveTenant(tenants(), facts);
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  return resolved.binding;
}

const polygo = (): TenantBinding => binding(FACTS['polygo'] as CheckoutFacts);
const agency = (): TenantBinding => binding(FACTS['agency'] as CheckoutFacts);

const NOW = '2026-11-01T12:00:00.000Z';
const LATER = '2026-11-01T13:00:00.000Z';
const SOONER = '2026-11-01T12:30:00.000Z';
const RUN_ID = `ENV-${'1'.repeat(24)}`;
const CHILD_ID = `ENV-${'2'.repeat(24)}`;

function context(overrides: Partial<KernelEnvelopeContext> = {}): KernelEnvelopeContext {
  return {
    binding: polygo(),
    registry: actions(),
    principal: 'implementer',
    actor: { agent: 'claude-code-cli', provider: 'anthropic', model: 'claude-opus-5-5' },
    envelopeId: RUN_ID,
    ...overrides,
  };
}

const RUN: EnvelopeRequest = { action: 'run-start', subjectHash: 'a'.repeat(40), scope: ['docs/'], budget: 5000, expiry: LATER, intentScope: 'RUN-1' };

function ok(result: EnvelopeResult): TaskEnvelope {
  if (!result.ok) throw new Error(result.reasons.join('; '));
  return result.envelope;
}

const READMIT = {
  principal: 'implementer' as const,
  actor: { agent: 'claude-code-cli', provider: 'anthropic', model: 'claude-opus-5-5' },
  latestExpiry: LATER,
  maxBudget: 5000,
  now: NOW,
};

const run = (): TaskEnvelope => ok(mintEnvelope(context(), RUN));
const yes = (): boolean => true;
const no = (): boolean => false;

function recorder(): { record: (line: EnvelopeRecord) => boolean; lines: EnvelopeRecord[] } {
  const lines: EnvelopeRecord[] = [];
  return { lines, record: (line) => lines.push(line) > 0 };
}

describe('HIGH 1: envelope provenance', () => {
  it('the forged full-shape envelope the reviewer built is refused at the door, and recorded', () => {
    const { record, lines } = recorder();
    const forged = { ok: true, envelope: { ...run(), action: 'secrets-handling', actionClass: 'P1' } } as EnvelopeResult;
    expect(admitEnvelope(forged, NOW, record, yes)).toMatchObject({ admitted: false, rule: 'R2', recorded: true });
    expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'R2', envelope: null });
  });

  it('the same envelope, minted, is admitted: the positive control', () => {
    expect(admitEnvelope(mintEnvelope(context(), RUN), NOW, () => true, no)).toMatchObject({ admitted: true });
  });

  it('a perfect copy of a minted envelope is not minted', () => {
    expect(admitEnvelope({ ok: true, envelope: { ...run() } }, NOW, () => true, yes)).toMatchObject({ admitted: false, rule: 'R2' });
  });

  it('parsing is not minting: parseEnvelope output is refused at the door', () => {
    expect(admitEnvelope(parseEnvelope(run()), NOW, () => true, yes)).toMatchObject({ admitted: false, rule: 'R2' });
  });

  it('a persisted envelope is re-admitted through its derived binding and the registry', () => {
    const persisted = JSON.parse(JSON.stringify(run())) as unknown;
    const result = readmitEnvelope(persisted, polygo(), actions(), READMIT);
    expect(result).toMatchObject({ ok: true });
    expect(admitEnvelope(result, NOW, () => true, no)).toMatchObject({ admitted: true });
  });

  it.each([
    ['tenant', 'agency-business'],
    ['domain', 'business'],
    ['project', 'seo-agency'],
    ['environment', 'production'],
    ['actionClass', 'P1'],
  ])('a persisted envelope with a different %s is refused, naming it', (field, value) => {
    const tampered = { ...run(), [field]: value };
    const result = readmitEnvelope(tampered, polygo(), actions(), READMIT);
    expect(result).toMatchObject({ ok: false, rule: 'R2' });
    expect(result.ok ? [] : result.reasons).toHaveLength(1);
    expect((result.ok ? [] : result.reasons)[0]).toContain(field);
  });

  it('a persisted envelope is refused under another tenant binding', () => {
    expect(readmitEnvelope(run(), agency(), actions(), READMIT)).toMatchObject({ ok: false, rule: 'R2' });
  });

  it('re-admission needs a derived binding: a copy is a claim', () => {
    expect(readmitEnvelope(run(), { ...polygo() }, actions(), READMIT)).toMatchObject({ ok: false, rule: 'R2' });
  });

  it('a malformed persisted envelope is an R1 refusal', () => {
    expect(readmitEnvelope({ tenant: 'owner-personal' }, polygo(), actions(), READMIT)).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('the registry is asked at re-admission: an action since unregistered is refused at the door', () => {
    const raw = json('action-registry.json');
    const envelope = ok(mintEnvelope(context({ registry: actionsWith('old-action', 'P2') }), { ...RUN, action: 'old-action' }));
    const result = readmitEnvelope(envelope, polygo(), actionsFrom(raw), READMIT);
    expect(result).toMatchObject({ ok: false, rule: 'R2' });
  });

  const presented = (change: Record<string, unknown>): Record<string, unknown> => ({
    ...run(),
    envelopeId: CHILD_ID,
    parentEnvelopeId: RUN_ID,
    action: 'implement',
    actionClass: 'P2',
    ...change,
  });

  it('checkChildEnvelope accepts a child whose class is the registry value: the positive control', () => {
    expect(checkChildEnvelope(run(), presented({}), actions())).toMatchObject({ ok: true });
  });

  it('checkChildEnvelope re-derives the class: a child labelled lower than the registry is refused', () => {
    const result = checkChildEnvelope(run(), presented({ action: 'implement', actionClass: 'P1' }), actions());
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
  });

  it('a P5 action labelled P2 under a P2 parent is refused, which at-most alone would pass', () => {
    const result = checkChildEnvelope(run(), presented({ action: 'secrets-handling', actionClass: 'P2' }), actions());
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
  });

  it('checkChildEnvelope re-derives the environment: a production action labelled local is refused', () => {
    const parent = ok(mintEnvelope(context(), { ...RUN, action: 'secrets-handling' }));
    const child = { ...parent, envelopeId: CHILD_ID, parentEnvelopeId: RUN_ID, action: 'payment-or-live-charge', actionClass: 'P5', environment: 'local' };
    expect(checkChildEnvelope(parent, child, actions())).toMatchObject({ ok: false, rule: 'R3' });
  });

  it('R3 requires the principal to equal the parent: same everything else passes', () => {
    expect(checkChildEnvelope(run(), presented({ principal: 'implementer' }), actions())).toMatchObject({ ok: true });
    const result = checkChildEnvelope(run(), presented({ principal: 'owner' }), actions());
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    expect((result.ok ? [] : result.reasons).join(' ')).toContain("child's principal");
  });

  it('a minted child cannot change principal either', () => {
    const request = { ...RUN, action: 'implement', expiry: SOONER };
    expect(mintEnvelope(context({ envelopeId: CHILD_ID }), request, run())).toMatchObject({ ok: true });
    expect(mintEnvelope(context({ envelopeId: CHILD_ID, principal: 'owner' }), request, run())).toMatchObject({ ok: false, rule: 'R3' });
  });

  it('a child cannot be minted from a forged parent: its budget would be a claim', () => {
    const request = { ...RUN, action: 'implement', budget: 999999 };
    const forged = { ...run(), budget: 1000000 };
    expect(mintEnvelope(context({ envelopeId: CHILD_ID }), request, forged)).toMatchObject({ ok: false, rule: 'R2' });
  });
});

describe('HIGH 2: admission gates the class', () => {
  it('P6 is refused by name even with a grant, and the port is not asked', () => {
    const { record, lines } = recorder();
    let asked = false;
    const grant = (): boolean => {
      asked = true;
      return true;
    };
    const registry = actionsWith('read-another-tenant', 'P6');
    const result = admitEnvelope(mintEnvelope(context({ registry }), { ...RUN, action: 'read-another-tenant' }), NOW, record, grant);
    expect(result).toMatchObject({ admitted: false, rule: 'P6_PROHIBITED', recorded: true });
    expect(asked).toBe(false);
    expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'P6_PROHIBITED' });
  });

  it('an unregistered action mints at P5 (R5) and is refused at the door by name, with a grant, and recorded', () => {
    const { record, lines } = recorder();
    const envelope = mintEnvelope(context(), { ...RUN, action: 'delete-everything' });
    expect(ok(envelope).actionClass).toBe('P5');
    expect(admitEnvelope(envelope, NOW, record, yes)).toMatchObject({ admitted: false, rule: 'UNREGISTERED_ACTION', recorded: true });
    expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'UNREGISTERED_ACTION', registered: false });
  });

  it('a registered P5 is refused without a grant and admitted with one: the port decides', () => {
    const { record, lines } = recorder();
    const envelope = mintEnvelope(context(), { ...RUN, action: 'secrets-handling' });
    expect(admitEnvelope(envelope, NOW, record, no)).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT', recorded: true });
    expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'P5_NO_GRANT', registered: true });
    expect(admitEnvelope(envelope, NOW, record, yes)).toMatchObject({ admitted: true });
  });

  it('a grant port that throws or answers vaguely has not granted', () => {
    const envelope = mintEnvelope(context(), { ...RUN, action: 'secrets-handling' });
    const throwing = (): boolean => {
      throw new Error('store unreadable');
    };
    const vague = (() => 'yes') as unknown as () => boolean;
    expect(admitEnvelope(envelope, NOW, () => true, throwing)).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT' });
    expect(admitEnvelope(envelope, NOW, () => true, vague)).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT' });
  });

  it('the port is handed the envelope it is deciding', () => {
    const seen: string[] = [];
    const envelope = mintEnvelope(context(), { ...RUN, action: 'secrets-handling' });
    admitEnvelope(envelope, NOW, () => true, (asked) => seen.push(asked.action) > 0);
    expect(seen).toEqual(['secrets-handling']);
  });

  it('P4 cannot run: ADR-K1 §4 gives it no grant, and a yes from the port changes nothing', () => {
    const registry = actionsWith('send-customer-reply', 'P4');
    const envelope = mintEnvelope(context({ registry }), { ...RUN, action: 'send-customer-reply' });
    expect(admitEnvelope(envelope, NOW, () => true, yes)).toMatchObject({ admitted: false, rule: 'P4_NO_GRANT' });
  });

  it.each([
    ['P1', 'project-selection'],
    ['P2', 'run-start'],
  ])('%s is admitted without asking the port', (_cls, action) => {
    let asked = false;
    const grant = (): boolean => {
      asked = true;
      return false;
    };
    expect(admitEnvelope(mintEnvelope(context(), { ...RUN, action }), NOW, () => true, grant)).toMatchObject({ admitted: true });
    expect(asked).toBe(false);
  });

  it('the record line carries registered and via', () => {
    const { record, lines } = recorder();
    admitEnvelope(mintEnvelope(context(), RUN), NOW, record, no);
    expect(lines[0]).toMatchObject({ outcome: 'allowed', registered: true, via: 'governed-root' });
  });

  it('a linked worktree is visible in the record, and a re-admitted envelope keeps it', () => {
    const linked = 'C:/dev/Polygo-worktrees/feature';
    const worktree = binding({ ...(FACTS['polygo'] as CheckoutFacts), root: linked, worktrees: { takenAtRoot: 'C:/dev/Polygo/polygo', paths: [linked] } });
    const first = recorder();
    const envelope = mintEnvelope(context({ binding: worktree }), RUN);
    admitEnvelope(envelope, NOW, first.record, no);
    expect(first.lines[0]).toMatchObject({ via: 'linked-worktree' });
    const second = recorder();
    admitEnvelope(readmitEnvelope(ok(envelope), worktree, actions(), READMIT), NOW, second.record, no);
    expect(second.lines[0]).toMatchObject({ via: 'linked-worktree' });
  });

  it('the execution line carries them too, and an envelope nobody branded carries neither', () => {
    const { record, lines } = recorder();
    recordExecution(run(), 'allowed', null, NOW, record);
    expect(lines[0]).toMatchObject({ stage: 'execution', registered: true, via: 'governed-root' });
    recordExecution({ ...run() }, 'failed', 'R7', NOW, record);
    expect(lines[1]).toMatchObject({ stage: 'execution', registered: null, via: null });
  });

  it('neither fact became an envelope field: ADR-K1 is accepted, and action is the one addition', () => {
    expect(ENVELOPE_FIELDS).toHaveLength(16);
    expect(Object.keys(run())).not.toContain('registered');
    expect(Object.keys(run())).not.toContain('via');
  });
});

describe('HIGH 3: boundary crossings are roots, linked to their run', () => {

  it.each(['run-start', 'broker-call', 'credential-release', 'project-selection', 'bridge-read'])('%s mints as a root', (action) => {
    expect(mintEnvelope(context(), { ...RUN, action })).toMatchObject({ ok: true });
  });

  it.each(['run-start', 'broker-call', 'credential-release', 'project-selection', 'bridge-read'])('%s cannot be a child', (action) => {
    const parent = ok(mintEnvelope(context(), { ...RUN, action: 'secrets-handling' }));
    const result = mintEnvelope(context({ envelopeId: CHILD_ID }), { ...RUN, action }, parent);
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    expect((result.ok ? [] : result.reasons).join(' ')).toContain('root');
  });

  it('the link does not need R3: a crossing may be in another environment than its run', () => {
    const link = ok(mintCrossing(context({ envelopeId: CHILD_ID }), { subjectHash: 'b'.repeat(40), action: 'broker-call', budget: 100, expiry: SOONER, intentScope: 'RUN-1/1' }, run(), NOW));
    expect([run().environment, link.environment]).toEqual(['local', 'production']);
  });

  it('broker-call and push leave the machine, so neither is local', () => {
    expect(resolveAction(actions(), 'broker-call')).toMatchObject({ actionClass: 'P3', environment: 'production' });
    expect(resolveAction(actions(), 'push')).toMatchObject({ actionClass: 'P3', environment: 'production' });
    expect(resolveAction(actions(), 'commit')).toMatchObject({ actionClass: 'P3', environment: 'local' });
  });

  it('a push is therefore a root too: R3 stays strict and refuses it as a child of a local run', () => {
    const parent = ok(mintEnvelope(context(), { ...RUN, action: 'secrets-handling' }));
    const result = mintEnvelope(context({ envelopeId: CHILD_ID }), { ...RUN, action: 'push' }, parent);
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    const push = { subjectHash: 'b'.repeat(40), action: 'push', budget: 100, expiry: SOONER, intentScope: 'RUN-1/1' };
    expect(mintCrossing(context({ envelopeId: CHILD_ID }), push, run(), NOW)).toMatchObject({ ok: true });
  });
});

describe('MEDIUM 7: alias closure', () => {
  const NEW = { projectId: 'another', repository: 'github.com/example/another', governedRoot: 'C:/dev/Another', tenant: 'owner-personal', domain: 'develop' };
  const parseWith = (change: Record<string, unknown>): ReturnType<typeof parseTenantRegistry> => {
    const raw = json('tenant-registry.json');
    return parseTenantRegistry({ ...raw, projects: [...(raw['projects'] as unknown[]), { ...NEW, ...change }] });
  };

  it('the plain entry is accepted, as is a path with a space: the positive controls', () => {
    expect(parseWith({}).ok).toBe(true);
    expect(parseWith({ governedRoot: 'C:/dev/BizComply V2' }).ok).toBe(true);
  });

  it.each([
    ['a doubled separator', 'C://dev/Another'],
    ['a doubled separator inside', 'C:/dev//Another'],
    ['a second colon', 'C:/dev/Another:stream'],
    ['a short name', 'C:/dev/ANOTHE~1'],
    ['a percent escape', 'C:/dev/%41nother'],
    ['a NUL', 'C:/dev/Another\u0000'],
    ['a zero-width joiner', 'C:/dev/Ano\u200Dther'],
    ['a zero-width space', 'C:/dev/\u200BAnother'],
    ['a non-ASCII letter', 'C:/dev/Anothér'],
    ['a Kelvin sign', 'C:/dev/\u212Aakoli'],
    ['a trailing slash', 'C:/dev/Another/'],
    ['a bare drive', 'C:/'],
  ])('a governed root with %s is refused', (_name, governedRoot) => {
    expect(parseWith({ governedRoot }).ok).toBe(false);
  });

  it.each([
    ['a .git suffix', 'github.com/example/another.git'],
    ['a .GIT suffix', 'github.com/example/another.GIT'],
    ['a trailing slash', 'github.com/example/another/'],
    ['an extra segment', 'gitlab.com/group/subgroup/another'],
    ['a port on a public host', 'github.com:443/example/another'],
    ['a doubled separator', 'github.com//example/another'],
    ['a percent escape', 'github.com/example/an%6Fther'],
    ['a tilde', 'github.com/~example/another'],
    ['a NUL', 'github.com/example/another\u0000'],
    ['a zero-width joiner', 'github.com/exa\u200Dmple/another'],
    ['a Kelvin sign', 'github.com/example/\u212Aakoli'],
    ['credentials in the host', 'user@github.com/example/another'],
    ['a dotless host', 'localhost/example/another'],
  ])('a repository with %s is refused', (_name, repository) => {
    expect(parseWith({ repository }).ok).toBe(false);
  });

  it('the one registered port stays valid: loopback, as the seo-agency entry needs', () => {
    expect(parseWith({ repository: '127.0.0.1:47901/example/another' }).ok).toBe(true);
    expect(parseTenantRegistry(json('tenant-registry.json')).ok).toBe(true);
  });

  it('case folding is ASCII only: a Kelvin sign does not match a registered k', () => {
    const raw = json('tenant-registry.json');
    const entry = { ...NEW, projectId: 'kakoli', repository: 'github.com/example/kakoli', governedRoot: 'C:/dev/Kakoli' };
    const parsed = parseTenantRegistry({ ...raw, projects: [...(raw['projects'] as unknown[]), entry] });
    if (!parsed.ok) throw new Error('control');
    const facts = { projectId: 'kakoli', repository: 'github.com/example/kakoli', root: 'C:/dev/Kakoli', worktrees: null };
    expect(resolveTenant(parsed.registry, facts)).toMatchObject({ ok: true });
    expect(resolveTenant(parsed.registry, { ...facts, root: 'c:/dev/kakoli' })).toMatchObject({ ok: true });
    expect(resolveTenant(parsed.registry, { ...facts, root: 'C:/dev/\u212Aakoli' })).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
    expect(resolveTenant(parsed.registry, { ...facts, repository: 'github.com/example/\u212Aakoli' })).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });
});

describe('MEDIUM 8: the worktree listing', () => {
  const LINKED = 'C:/dev/Polygo-worktrees/feature';
  const POLYGO = FACTS['polygo'] as CheckoutFacts;

  it('a listing taken at the registered root attaches the worktree: the positive control', () => {
    const result = resolveTenant(tenants(), { ...POLYGO, root: LINKED, worktrees: { takenAtRoot: 'C:/dev/Polygo/polygo', paths: [LINKED] } });
    expect(result.ok && result.binding.via).toBe('linked-worktree');
  });

  it('the same listing taken anywhere else attaches nothing', () => {
    const result = resolveTenant(tenants(), { ...POLYGO, root: LINKED, worktrees: { takenAtRoot: LINKED, paths: [LINKED] } });
    expect(result).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });

  it('a checkout under another entry root is refused, even when listed', () => {
    const inside = 'C:/dev/SEOAgency/borrowed';
    const result = resolveTenant(tenants(), { ...POLYGO, root: inside, worktrees: { takenAtRoot: 'C:/dev/Polygo/polygo', paths: [inside] } });
    expect(result).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
    expect((result.ok ? [] : result.reasons).join(' ')).toContain('seo-agency');
  });

  it('a checkout equal to another entry root is refused, even when listed', () => {
    const result = resolveTenant(tenants(), { ...POLYGO, root: 'C:/dev/SEOAgency', worktrees: { takenAtRoot: 'C:/dev/Polygo/polygo', paths: ['C:/dev/SEOAgency'] } });
    expect(result).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });

  it('a sibling that only shares a prefix with another root is not under it', () => {
    const sibling = 'C:/dev/SEOAgency-worktrees/polygo-branch';
    const result = resolveTenant(tenants(), { ...POLYGO, root: sibling, worktrees: { takenAtRoot: 'C:/dev/Polygo/polygo', paths: [sibling] } });
    expect(result.ok && result.binding.via).toBe('linked-worktree');
  });

  it('the listing drops the record equal to the root, wherever it sits, and not the first record', () => {
    const porcelain = [`worktree ${LINKED}`, 'HEAD a', '', 'worktree C:/dev/Polygo/polygo', 'HEAD b', ''].join('\n');
    expect(linkedWorktreesFromPorcelain(porcelain, 'C:/dev/Polygo/polygo')).toEqual({ takenAtRoot: 'C:/dev/Polygo/polygo', paths: [LINKED] });
  });

  it('a registry root under another entry root refuses the whole file; a shared prefix does not', () => {
    const raw = json('tenant-registry.json');
    const extra = { projectId: 'nested', repository: 'github.com/example/nested', tenant: 'agency-business', domain: 'business' };
    const under = parseTenantRegistry({ ...raw, projects: [...(raw['projects'] as unknown[]), { ...extra, governedRoot: 'C:/dev/Polygo/polygo/nested' }] });
    expect(under.ok ? [] : under.problems.map((problem) => problem.code)).toEqual(['TENANT_REGISTRY_NESTED_ROOT']);
    const beside = parseTenantRegistry({ ...raw, projects: [...(raw['projects'] as unknown[]), { ...extra, governedRoot: 'C:/dev/Polygo/polygo-two' }] });
    expect(beside.ok).toBe(true);
  });
});

describe('MEDIUM 9: floors for the whole table', () => {
  const withClass = (id: string, cls: string): ReturnType<typeof parseActionRegistry> => {
    const raw = json('action-registry.json');
    const entries = (raw['actions'] as Record<string, unknown>[]).map((entry) => (entry['id'] === id ? { ...entry, class: cls } : entry));
    return parseActionRegistry({ ...raw, actions: entries });
  };
  const without = (id: string): ReturnType<typeof parseActionRegistry> => {
    const raw = json('action-registry.json');
    return parseActionRegistry({ ...raw, actions: (raw['actions'] as Record<string, unknown>[]).filter((entry) => entry['id'] !== id) });
  };
  const codes = (result: ReturnType<typeof parseActionRegistry>): readonly string[] => (result.ok ? [] : result.problems.map((problem) => problem.code));

  it('action-registry-change is registered as P5: ADR-T1 §3 "same terms" rests on this', () => {
    expect(resolveAction(actions(), 'action-registry-change')).toMatchObject({ registered: true, actionClass: 'P5' });
    expect(codes(withClass('action-registry-change', 'P4'))).toEqual(['ACTION_REGISTRY_CLASS_LOWERED']);
    expect(codes(without('action-registry-change'))).toEqual(['ACTION_REGISTRY_VOCABULARY']);
  });

  it.each([
    ['credential-release', 'P4'],
    ['broker-call', 'P2'],
    ['run-start', 'P1'],
  ])('%s at %s is below its floor', (id, cls) => {
    expect(codes(withClass(id, cls))).toEqual(['ACTION_REGISTRY_CLASS_LOWERED']);
  });

  it.each(['run-start', 'credential-release', 'broker-call', 'project-selection', 'bridge-read'])('losing the boundary action %s refuses the whole file', (id) => {
    expect(codes(without(id))).toEqual(['ACTION_REGISTRY_VOCABULARY']);
  });
});

describe('LOW', () => {
  it('a sparse scope is refused: every() skips holes', () => {
    const sparse = ['docs/'];
    sparse[2] = 'projectos/';
    expect(parseEnvelope({ ...run(), scope: sparse })).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('a paid action with no budget is refused (ADR-K1 §2); with one it mints', () => {
    const paid = { ...RUN, action: 'broker-call' };
    expect(mintEnvelope(context(), paid)).toMatchObject({ ok: true });
    const result = mintEnvelope(context(), { ...paid, budget: 0 });
    expect(result).toMatchObject({ ok: false, rule: 'R1' });
    expect((result.ok ? [] : result.reasons).join(' ')).toContain('budget');
  });

  it('an unpaid action may have a zero budget', () => {
    expect(mintEnvelope(context(), { ...RUN, budget: 0 })).toMatchObject({ ok: true });
  });
});

describe('final round', () => {
  const ACTOR = READMIT.actor;
  const LIMITS = READMIT;
  const CROSSING = { subjectHash: 'b'.repeat(40), budget: 100, expiry: SOONER, intentScope: 'RUN-1/1' };
  const crossingContext = (overrides: Partial<KernelEnvelopeContext> = {}): KernelEnvelopeContext => context({ envelopeId: CHILD_ID, ...overrides });

  describe('M1: readmission re-derives or bounds everything that caps a child', () => {
    it('a faithful record is readmitted: the positive control', () => {
      expect(readmitEnvelope(JSON.parse(JSON.stringify(run())), polygo(), actions(), LIMITS)).toMatchObject({ ok: true });
    });

    it.each([
      ['principal', { principal: 'owner' }],
      ['actor', { actor: { ...ACTOR, model: 'another-model' } }],
      ['budget', { budget: 9999999 }],
      ['expiry', { expiry: '2999-01-01T00:00:00.000Z' }],
    ])('a record whose %s differs or exceeds the limit is refused, naming it', (field, change) => {
      const result = readmitEnvelope({ ...run(), ...change }, polygo(), actions(), LIMITS);
      expect(result).toMatchObject({ ok: false, rule: 'R2' });
      expect(result.ok ? [] : result.reasons).toHaveLength(1);
      expect((result.ok ? [] : result.reasons)[0]).toContain(field);
    });

    it('a record at the limits is readmitted: over means over', () => {
      expect(readmitEnvelope(run(), polygo(), actions(), { ...LIMITS, maxBudget: run().budget, latestExpiry: run().expiry })).toMatchObject({ ok: true });
    });

    it('an unreadable limit refuses rather than waves through', () => {
      expect(readmitEnvelope(run(), polygo(), actions(), { ...LIMITS, latestExpiry: 'whenever' })).toMatchObject({ ok: false, rule: 'R2' });
      expect(readmitEnvelope(run(), polygo(), actions(), { ...LIMITS, maxBudget: Number.NaN })).toMatchObject({ ok: false, rule: 'R2' });
    });

    it('a record already expired is refused', () => {
      expect(readmitEnvelope(run(), polygo(), actions(), { ...LIMITS, now: LATER })).toMatchObject({ ok: false, rule: 'EXPIRED' });
    });

    it('a readmitted record cannot lift a child above the kernel limits', () => {
      const forged = { ...run(), budget: 9999999, expiry: '2999-01-01T00:00:00.000Z', principal: 'owner' };
      const parent = readmitEnvelope(forged, polygo(), actions(), LIMITS);
      expect(parent.ok).toBe(false);
    });

    it('an unregistered action stays unregistered through readmission, and the door refuses it', () => {
      const envelope = ok(mintEnvelope(context(), { ...RUN, action: 'delete-everything' }));
      const readmitted = readmitEnvelope(JSON.parse(JSON.stringify(envelope)), polygo(), actions(), LIMITS);
      expect(admitEnvelope(readmitted, NOW, () => true, yes)).toMatchObject({ admitted: false, rule: 'UNREGISTERED_ACTION' });
    });
  });

  describe('M2: mintCrossing is the only way to a run-linked action', () => {
    it.each(['credential-release', 'broker-call', 'commit', 'push'])('%s minted through mintCrossing passes the door', (action) => {
      const result = mintCrossing(crossingContext(), { ...CROSSING, action }, run(), NOW);
      expect(result.ok && result.envelope.parentEnvelopeId).toBeNull();
      expect(admitEnvelope(result, NOW, () => true, yes)).toMatchObject({ admitted: true });
    });

    it.each(['credential-release', 'broker-call', 'commit', 'push'])('%s minted plainly is refused by name, with a grant, and the port is not asked', (action) => {
      let asked = false;
      const grant = (): boolean => {
        asked = true;
        return true;
      };
      expect(admitEnvelope(mintEnvelope(context(), { ...RUN, action }), NOW, () => true, grant)).toMatchObject({ admitted: false, rule: 'RUN_LINK_REQUIRED' });
      expect(asked).toBe(false);
    });

    it.each(['run-start', 'project-selection', 'bridge-read'])('%s stays a plain root', (action) => {
      expect(admitEnvelope(mintEnvelope(context(), { ...RUN, action }), NOW, () => true, no)).toMatchObject({ admitted: true });
    });

    it('the scope is derived: exactly the run, whatever the request says', () => {
      const smuggled = { ...CROSSING, action: 'broker-call', scope: ['projectos/security/', 'run:ENV-999999999999999999999999'] };
      const result = mintCrossing(crossingContext(), smuggled, run(), NOW);
      expect(result.ok && result.envelope.scope).toEqual([`run:${RUN_ID}`]);
    });

    it('a crossing is never built from an unbranded run', () => {
      const result = mintCrossing(crossingContext(), { ...CROSSING, action: 'push' }, { ...run() }, NOW);
      expect(result).toMatchObject({ ok: false, rule: 'RUN_LINK' });
    });

    it('a crossing is never built from an expired run', () => {
      expect(mintCrossing(crossingContext(), { ...CROSSING, action: 'push', expiry: SOONER }, run(), LATER)).toMatchObject({ ok: false, rule: 'RUN_LINK' });
    });

    it('only a run can be crossed from', () => {
      const notARun = ok(mintEnvelope(context(), { ...RUN, action: 'implement' }));
      expect(mintCrossing(crossingContext(), { ...CROSSING, action: 'push' }, notARun, NOW)).toMatchObject({ ok: false, rule: 'RUN_LINK' });
    });

    it('an action that needs no run link cannot take this route', () => {
      expect(mintCrossing(crossingContext(), { ...CROSSING, action: 'implement' }, run(), NOW)).toMatchObject({ ok: false, rule: 'RUN_LINK' });
    });

    it.each([
      ['expiry', { expiry: '2026-11-01T13:00:00.001Z' }],
      ['budget', { budget: 5001 }],
    ])('a crossing above the run in %s is refused, and at the run it passes', (field, change) => {
      const over = mintCrossing(crossingContext(), { ...CROSSING, action: 'broker-call', ...change }, run(), NOW);
      expect(over).toMatchObject({ ok: false, rule: 'RUN_LINK' });
      expect((over.ok ? [] : over.reasons).join(' ')).toContain(field);
      expect(mintCrossing(crossingContext(), { ...CROSSING, action: 'broker-call', expiry: LATER, budget: 5000 }, run(), NOW)).toMatchObject({ ok: true });
    });

    it('a crossing under another tenant binding is refused, naming the tenant and domain and project', () => {
      const result = mintCrossing(crossingContext({ binding: agency() }), { ...CROSSING, action: 'push' }, run(), NOW);
      expect(result).toMatchObject({ ok: false, rule: 'RUN_LINK' });
      expect(result.ok ? [] : result.reasons).toHaveLength(3);
    });

    it('a crossing for another project in the SAME tenant is refused for project alone', () => {
      const other = binding({ projectId: 'projectos', repository: 'github.com/universalbizcomply/ProjectOS', root: 'C:/dev/ProjectOS', worktrees: null });
      const result = mintCrossing(crossingContext({ binding: other }), { ...CROSSING, action: 'push' }, run(), NOW);
      expect(result.ok ? [] : result.reasons).toHaveLength(1);
      expect((result.ok ? [] : result.reasons)[0]).toContain('project');
    });

    it('a crossing by another principal is refused', () => {
      const result = mintCrossing(crossingContext({ principal: 'owner' }), { ...CROSSING, action: 'push' }, run(), NOW);
      expect(result).toMatchObject({ ok: false, rule: 'RUN_LINK' });
      expect((result.ok ? [] : result.reasons).join(' ')).toContain('principal');
    });

    it('a copied binding is still a claim', () => {
      expect(mintCrossing(crossingContext({ binding: { ...polygo() } }), { ...CROSSING, action: 'push' }, run(), NOW)).toMatchObject({ ok: false, rule: 'R2' });
    });

    it('a persisted crossing loses its run link: it is minted again, not trusted', () => {
      const crossing = mintCrossing(crossingContext(), { ...CROSSING, action: 'commit' }, run(), NOW);
      const readmitted = readmitEnvelope(JSON.parse(JSON.stringify(crossing.ok ? crossing.envelope : null)), polygo(), actions(), LIMITS);
      expect(admitEnvelope(readmitted, NOW, () => true, yes)).toMatchObject({ admitted: false, rule: 'RUN_LINK_REQUIRED' });
    });

    it('there is no weaker public path: checkRunLink is gone', () => {
      expect(Object.keys(envelopeModule)).not.toContain('checkRunLink');
    });

    it('the allowed line shows the run link', () => {
      const { record, lines } = recorder();
      admitEnvelope(mintCrossing(crossingContext(), { ...CROSSING, action: 'commit' }, run(), NOW), NOW, record, yes);
      expect(lines[0]).toMatchObject({ outcome: 'allowed', runLinked: true });
    });
  });

  describe('M3: P3 asks the port too', () => {
    const commit = (): EnvelopeResult => mintCrossing(crossingContext(), { ...CROSSING, action: 'commit' }, run(), NOW);

    it('no grant is a named refusal, recorded; a grant admits', () => {
      const { record, lines } = recorder();
      expect(admitEnvelope(commit(), NOW, record, no)).toMatchObject({ admitted: false, rule: 'P3_NO_GRANT', recorded: true });
      expect(lines[0]).toMatchObject({ outcome: 'refused', rule: 'P3_NO_GRANT' });
      expect(admitEnvelope(commit(), NOW, () => true, yes)).toMatchObject({ admitted: true });
    });

    it('a port that throws has not granted', () => {
      const throwing = (): boolean => {
        throw new Error('no record');
      };
      expect(admitEnvelope(commit(), NOW, () => true, throwing)).toMatchObject({ admitted: false, rule: 'P3_NO_GRANT' });
    });

    it.each([
      ['P1', 'project-selection'],
      ['P2', 'run-start'],
    ])('%s still needs no grant', (_cls, action) => {
      expect(admitEnvelope(mintEnvelope(context(), { ...RUN, action }), NOW, () => true, no)).toMatchObject({ admitted: true });
    });
  });
});
