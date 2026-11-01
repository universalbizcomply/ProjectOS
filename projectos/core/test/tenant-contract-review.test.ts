/**
 * The review round on PROJECTOS-TENANT-CONTRACT1A (ECC SECURITY, Agency software-architect): one proof
 * per finding. Each refusal stands next to a positive control, so the default cannot pass for the rule.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, resolveAction, type ActionRegistry } from '../src/actionRegistry.js';
import {
  admitEnvelope,
  checkChildEnvelope,
  checkRunLink,
  ENVELOPE_FIELDS,
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
    const result = readmitEnvelope(persisted, polygo(), actions());
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
    const result = readmitEnvelope(tampered, polygo(), actions());
    expect(result).toMatchObject({ ok: false, rule: 'R2' });
    expect(result.ok ? [] : result.reasons).toHaveLength(1);
    expect((result.ok ? [] : result.reasons)[0]).toContain(field);
  });

  it('a persisted envelope is refused under another tenant binding', () => {
    expect(readmitEnvelope(run(), agency(), actions())).toMatchObject({ ok: false, rule: 'R2' });
  });

  it('re-admission needs a derived binding: a copy is a claim', () => {
    expect(readmitEnvelope(run(), { ...polygo() }, actions())).toMatchObject({ ok: false, rule: 'R2' });
  });

  it('a malformed persisted envelope is an R1 refusal', () => {
    expect(readmitEnvelope({ tenant: 'owner-personal' }, polygo(), actions())).toMatchObject({ ok: false, rule: 'R1' });
  });

  it('the registry is asked at re-admission: an action since unregistered is refused at the door', () => {
    const raw = json('action-registry.json');
    const envelope = ok(mintEnvelope(context({ registry: actionsWith('old-action', 'P2') }), { ...RUN, action: 'old-action' }));
    const result = readmitEnvelope(envelope, polygo(), actionsFrom(raw));
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
    ['P3', 'commit'],
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
    admitEnvelope(readmitEnvelope(ok(envelope), worktree, actions()), NOW, second.record, no);
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
  const crossing = (action: string, scope: readonly string[], overrides: Partial<KernelEnvelopeContext> = {}): TaskEnvelope =>
    ok(mintEnvelope(context({ envelopeId: CHILD_ID, ...overrides }), { ...RUN, action, scope, intentScope: 'RUN-1/1' }));

  it.each(['run-start', 'broker-call', 'credential-release', 'project-selection', 'bridge-read'])('%s mints as a root', (action) => {
    expect(mintEnvelope(context(), { ...RUN, action })).toMatchObject({ ok: true });
  });

  it.each(['run-start', 'broker-call', 'credential-release', 'project-selection', 'bridge-read'])('%s cannot be a child', (action) => {
    const parent = ok(mintEnvelope(context(), { ...RUN, action: 'secrets-handling' }));
    const result = mintEnvelope(context({ envelopeId: CHILD_ID }), { ...RUN, action }, parent);
    expect(result).toMatchObject({ ok: false, rule: 'R3' });
    expect((result.ok ? [] : result.reasons).join(' ')).toContain('root');
  });

  it('a crossing linked to its run passes: the positive control', () => {
    expect(checkRunLink(run(), crossing('broker-call', [`run:${RUN_ID}`]))).toEqual({ ok: true });
  });

  it('the link does not need R3: the crossing may be in another environment than the run', () => {
    const link = crossing('broker-call', [`run:${RUN_ID}`]);
    expect([run().environment, link.environment]).toEqual(['local', 'production']);
    expect(checkRunLink(run(), link)).toEqual({ ok: true });
  });

  it('a crossing that does not name the run is refused, so a release cannot lose its run', () => {
    const result = checkRunLink(run(), crossing('credential-release', ['docs/']));
    expect(result).toMatchObject({ ok: false, rule: 'RUN_LINK' });
  });

  it('a crossing naming another run is refused', () => {
    expect(checkRunLink(run(), crossing('broker-call', [`run:ENV-${'9'.repeat(24)}`]))).toMatchObject({ ok: false, rule: 'RUN_LINK' });
  });

  it.each([
    ['tenant', 'agency-business'],
    ['domain', 'business'],
    ['project', 'seo-agency'],
    ['principal', 'owner'],
  ])('a crossing that differs from its run in %s alone is refused, naming it', (field, value) => {
    const link = { ...crossing('broker-call', [`run:${RUN_ID}`]), [field]: value };
    const result = checkRunLink(run(), link);
    expect(result).toMatchObject({ ok: false, rule: 'RUN_LINK' });
    expect(result.ok ? [] : result.reasons).toHaveLength(1);
    expect((result.ok ? [] : result.reasons)[0]).toContain(field);
  });

  it('a crossing that is a child is refused: crossings are roots', () => {
    const link = { ...crossing('broker-call', [`run:${RUN_ID}`]), parentEnvelopeId: RUN_ID };
    expect(checkRunLink(run(), link)).toMatchObject({ ok: false, rule: 'RUN_LINK' });
  });

  it('only a run can be linked to', () => {
    const notARun = ok(mintEnvelope(context(), { ...RUN, action: 'implement' }));
    expect(checkRunLink(notARun, crossing('broker-call', [`run:${RUN_ID}`]))).toMatchObject({ ok: false, rule: 'RUN_LINK' });
  });

  it('malformed input is refused rather than compared', () => {
    expect(checkRunLink({}, crossing('broker-call', [`run:${RUN_ID}`]))).toMatchObject({ ok: false, rule: 'R1' });
    expect(checkRunLink(run(), {})).toMatchObject({ ok: false, rule: 'R1' });
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
    expect(checkRunLink(run(), crossing('push', [`run:${RUN_ID}`]))).toEqual({ ok: true });
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
