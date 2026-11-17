import { describe, expect, it } from 'vitest';
import type { KnownRoleSources } from '@projectos/core';
import { loadCommittedRoleRegistry } from '../src/modelBroker/index.js';
import { ROLE_REGISTRY_REL, roles, type RoleSourcesPort } from '../src/commands/roles.js';
import { parseArgs, run as cli } from '../src/cli.js';
import type { ExecResult, System } from '../src/system.js';

const COMMIT = '3'.repeat(40);
const PATH = '.projectops/provider-roles.json';
const CARD = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1250000, outputMicroUsdPerMillion: 10000000 };
const KNOWN: KnownRoleSources = { workerIds: ['claude-local', 'claude-reviewer'], gatekeeperTransportId: 'openai-primary', rateCards: { 'gpt-5.6-terra': CARD } };
const GOOD = {
  schema: 1,
  roles: {
    implementer: { workerId: 'claude-local', capabilities: ['implement'], cost: { class: 'unmetered' }, notes: 'owner login' },
    reviewer: { workerId: 'claude-reviewer', capabilities: ['review'], cost: { class: 'unmetered' }, notes: 'read only' },
    gatekeeper: { transportId: 'openai-primary', capabilities: ['gatekeeper-review'], cost: { class: 'metered', model: 'gpt-5.6-terra' }, notes: 'committed route' },
  },
};
const GOOD_TEXT = JSON.stringify(GOOD, null, 2);

const reader = (files: Record<string, string>, commit = COMMIT) => {
  const asked: string[] = [];
  return { asked, read: (path: string) => (asked.push(path), path in files ? { text: files[path] as string, commit } : null) };
};

describe('the role registry is read from committed bytes only (rule 5)', () => {
  it('loads a registry through the committed reader and asks for that one path: the positive control', () => {
    const { read, asked } = reader({ [PATH]: GOOD_TEXT });
    const loaded = loadCommittedRoleRegistry({ read, path: PATH, known: KNOWN });
    expect(loaded.ok).toBe(true);
    expect(asked).toEqual([PATH]);
    expect(loaded.ok && loaded.commit).toBe(COMMIT);
    expect(loaded.ok && loaded.registry.get('reviewer')?.workerId).toBe('claude-reviewer');
  });

  it('a working-tree-only registry is refused: the reader has no committed copy to give', () => {
    const { read } = reader({});
    const loaded = loadCommittedRoleRegistry({ read, path: PATH, known: KNOWN });
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.refusals[0]?.code).toBe('NOT_COMMITTED');
    expect(!loaded.ok && loaded.refusals[0]?.next).toMatch(/commit/i);
  });

  it('refuses text that was not read at a commit, such as a working-tree read', () => {
    const read = () => ({ text: GOOD_TEXT, commit: 'working-tree' });
    expect(loadCommittedRoleRegistry({ read, path: PATH, known: KNOWN }).ok).toBe(false);
  });

  it('refuses a path that leaves the repository or names another file kind, so a path cannot pick other bytes', () => {
    const { read, asked } = reader({ '../x.json': GOOD_TEXT });
    for (const path of ['../x.json', '/etc/passwd', 'C:/x.json', 'a/../b.json', 'roles.txt', '']) {
      expect(loadCommittedRoleRegistry({ read, path, known: KNOWN }).ok, path).toBe(false);
    }
    expect(asked).toEqual([]);
  });

  it('judges committed text against what is authorised: an unknown worker or a credential field is refused', () => {
    const ghost = JSON.stringify({ ...GOOD, roles: { ...GOOD.roles, implementer: { ...GOOD.roles.implementer, workerId: 'ghost' } } });
    const keyed = JSON.stringify({ ...GOOD, roles: { ...GOOD.roles, implementer: { ...GOOD.roles.implementer, apiKey: 'x' } } });
    for (const text of [ghost, keyed, '{broken', JSON.stringify({ schema: 9, roles: {} })]) {
      const { read } = reader({ [PATH]: text });
      expect(loadCommittedRoleRegistry({ read, path: PATH, known: KNOWN }).ok).toBe(false);
    }
  });

  it('a reader that returns the wrong kind of answer is a refusal, not a crash', () => {
    for (const answer of [undefined, { text: 5, commit: COMMIT }, { text: GOOD_TEXT }, 'text']) {
      const read = () => answer as unknown as { text: string; commit: string };
      expect(loadCommittedRoleRegistry({ read, path: PATH, known: KNOWN }).ok).toBe(false);
    }
  });
});

/** An in-memory System: git answers from the committed map, the working tree from the other, and it counts what it is asked. */
function fake(committed: Record<string, string>, working: Record<string, string>, head = COMMIT) {
  const execs: string[] = [];
  const writes: string[] = [];
  const sys: System = {
    cwd: () => '/proj',
    now: () => '2026-11-17T10:00:00Z',
    readText: (p) => working[p.replace(/^\/proj\//, '')] ?? null,
    writeText: (p) => void writes.push(p),
    exists: () => false,
    listDir: () => [],
    renameFile: (a, b) => (writes.push(`${a}->${b}`), false),
    createExclusive: (p) => (writes.push(p), false),
    removeFile: (p) => (writes.push(`rm ${p}`), false),
    exec: (cmd, args): ExecResult => {
      execs.push(`${cmd} ${args.join(' ')}`);
      if (cmd !== 'git') return { code: 1, stdout: '', stderr: 'no' };
      if (args.includes('rev-parse')) return head === '' ? { code: 128, stdout: '', stderr: 'no head' } : { code: 0, stdout: `${head}\n`, stderr: '' };
      const spec = args.find((a) => a.startsWith('HEAD:'));
      const text = spec === undefined ? undefined : committed[spec.replace(/^HEAD:\.\//, '')];
      return text === undefined ? { code: 128, stdout: '', stderr: 'no such path' } : { code: 0, stdout: text, stderr: '' };
    },
  };
  return { sys, execs, writes };
}

const sourcesOf = (known: KnownRoleSources): RoleSourcesPort => () => ({ ok: true, known, lines: [] });

describe('`projectos roles` is a read-only report from committed bytes', () => {
  it('prints each role, its worker, capabilities, cost and standing, and where it was read: the positive control', () => {
    const { sys, writes } = fake({ [PATH]: GOOD_TEXT }, { [PATH]: GOOD_TEXT });
    const r = roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN));
    const text = r.lines.join('\n');
    expect(r.code).toBe(0);
    expect(text).toContain(COMMIT.slice(0, 12));
    expect(text).toContain('implementer');
    expect(text).toContain('claude-local');
    expect(text).toContain('claude-reviewer');
    expect(text).toContain('openai-primary');
    expect(text).toContain('metered');
    expect(text).toContain('gpt-5.6-terra');
    expect(text).toMatch(/gatekeeper.*awaiting/);
    expect(text).toMatch(/nothing consults/i);
    expect(writes).toEqual([]);
  });

  it('writes nothing, and runs only git reads', () => {
    const { sys, execs, writes } = fake({ [PATH]: GOOD_TEXT }, { [PATH]: GOOD_TEXT });
    roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN));
    expect(writes).toEqual([]);
    expect(execs.length).toBeGreaterThan(0);
    for (const call of execs) expect(call).toMatch(/^git .*(?:rev-parse|show) /);
  });

  it('flags a working copy that differs from the committed one, and still shows the committed bytes', () => {
    const edited = GOOD_TEXT.replace('claude-local', 'claude-reviewer');
    const { sys } = fake({ [PATH]: GOOD_TEXT }, { [PATH]: edited });
    const r = roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN));
    const text = r.lines.join('\n');
    expect(r.code).toBe(2);
    expect(text).toContain('WORKING_COPY_DIFFERS');
    expect(text).toContain('claude-local');
  });

  it('flags a working copy that is gone, and treats line endings and a byte-order mark as the same bytes', () => {
    expect(roles({ sys: fake({ [PATH]: GOOD_TEXT }, {}).sys, root: '/proj' }, {}, [], sourcesOf(KNOWN)).code).toBe(2);
    const crlf = `\uFEFF${GOOD_TEXT.replace(/\n/g, '\r\n')}`;
    expect(roles({ sys: fake({ [PATH]: GOOD_TEXT }, { [PATH]: crlf }).sys, root: '/proj' }, {}, [], sourcesOf(KNOWN)).code).toBe(0);
  });

  it('refuses a registry that exists only in the working tree, and prints the next step', () => {
    const { sys } = fake({}, { [PATH]: GOOD_TEXT });
    const r = roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('NOT_COMMITTED');
    expect(r.lines.join('\n')).toMatch(/commit/i);
  });

  it('refuses when there is no commit to read at, rather than reading the working tree', () => {
    const { sys } = fake({ [PATH]: GOOD_TEXT }, { [PATH]: GOOD_TEXT }, '');
    expect(roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN)).code).toBe(2);
  });

  it('refuses a committed registry that names a worker the project does not authorise', () => {
    const { sys } = fake({ [PATH]: GOOD_TEXT }, { [PATH]: GOOD_TEXT });
    const r = roles({ sys, root: '/proj' }, {}, [], sourcesOf({ ...KNOWN, workerIds: ['claude-local'] }));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('UNKNOWN_WORKER');
  });

  it('stops with the sources refusal when what the project authorises cannot be read', () => {
    const { sys, execs } = fake({ [PATH]: GOOD_TEXT }, { [PATH]: GOOD_TEXT });
    const sources: RoleSourcesPort = () => ({ ok: false, lines: ['REFUSED (NO_CONFIG): no config'] });
    const r = roles({ sys, root: '/proj' }, {}, [], sources);
    expect(r.code).toBe(2);
    expect(r.lines).toEqual(['REFUSED (NO_CONFIG): no config']);
    expect(execs).toEqual([]);
  });

  it('prints registry text inert and capped: a control character or escape cannot reach the terminal', () => {
    const noisy = { ...GOOD, roles: { ...GOOD.roles, implementer: { ...GOOD.roles.implementer, notes: 'n'.repeat(23) + ' \u001b[2J' } } };
    const { sys } = fake({ [PATH]: JSON.stringify(noisy) }, { [PATH]: JSON.stringify(noisy) });
    const r = roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN));
    expect(r.lines.join('\n')).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
  });

  it('caps what it prints when the registry is refused with many problems', () => {
    const many = { schema: 1, roles: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`r${i}`, {}])) };
    const { sys } = fake({ [PATH]: JSON.stringify(many) }, { [PATH]: JSON.stringify(many) });
    expect(roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN)).lines.length).toBeLessThan(40);
  });

  it('reads the registry from the one committed path, and never the working tree for its content', () => {
    const edited = GOOD_TEXT.replace('claude-local', 'claude-reviewer');
    const { sys } = fake({ [PATH]: GOOD_TEXT }, { [PATH]: edited });
    const text = roles({ sys, root: '/proj' }, {}, [], sourcesOf(KNOWN)).lines.join('\n');
    expect(text).not.toMatch(/implementer[^\n]*claude-reviewer/);
    expect(ROLE_REGISTRY_REL).toBe(PATH);
  });
});

describe('`projectos roles` through the command line', () => {
  it('is dispatched, appears in help and stays available while the platform stop is engaged', () => {
    const { sys } = fake({}, {});
    const r = cli({ sys, root: '/proj', platformStopStateDir: null } as Parameters<typeof cli>[0], ['help']);
    expect(r.lines.join('\n')).toMatch(/^\s*roles\b/m);
    expect(parseArgs(['roles']).command).toBe('roles');
  });
});
