import { describe, expect, it } from 'vitest';
import {
  MAX_DELETION_REASON_CHARS,
  MEMORY_CLASS_IDS,
  MEMORY_DELETE_ACTION,
  MEMORY_INDEX_REBUILD_ACTION,
  MEMORY_RETENTION,
  decisionCitesItem,
  deletionOwnerClaimOf,
  judgeIndexDeletion,
  judgeMemoryDeletion,
  memoryClassOfPath,
  memoryDeletionRequestOf,
  type MemoryDeletionFacts,
} from '../src/memory/retention.js';

const TENANT = 'agency-one';
const PROJECT = 'alpha-project';
const HASH = 'e'.repeat(64);
const PATH = '.projectops/memory/MEMORY.md';

const request = (overrides: Record<string, unknown> = {}) => ({ tenant: TENANT, project: PROJECT, path: PATH, itemHash: HASH, reason: 'the entry is wrong', ...overrides });
const ROOT = '/work/project';
const facts = (overrides: Partial<MemoryDeletionFacts> = {}): MemoryDeletionFacts => ({
  root: ROOT,
  currentItemHash: HASH,
  citedByDecision: false,
  ownerVerifier: () => true,
  ...overrides,
});

describe('retention is written down per class, from the six classes of memory-classes.md', () => {
  it('has the six classes, in order, under the names the classes file gives them', () => {
    expect(MEMORY_RETENTION.map((entry) => entry.name)).toEqual([
      'Programme and project memory',
      'Execution memory',
      'Curated memory',
      'Skills',
      'Retrieval index',
      'Code-intelligence memory',
    ]);
    expect(MEMORY_RETENTION.map((entry) => entry.id)).toEqual([...MEMORY_CLASS_IDS]);
    expect(MEMORY_CLASS_IDS).toHaveLength(6);
  });

  it('no class deletes by itself, and every class says how long it keeps what it holds', () => {
    for (const entry of MEMORY_RETENTION) {
      expect(entry.autoDelete).toBe(false);
      expect(entry.retention.trim().length).toBeGreaterThan(10);
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(Object.isFrozen(MEMORY_RETENTION)).toBe(true);
  });

  it('deleting in the four stores of record is memory-delete, P5, owner only; the derived index is memory-index-rebuild, P2, no owner', () => {
    const byId = Object.fromEntries(MEMORY_RETENTION.map((entry) => [entry.id, entry]));
    for (const id of ['programme-project-memory', 'execution-memory', 'curated-memory', 'skills']) {
      expect(byId[id]).toMatchObject({ deleteAction: 'memory-delete', deleteActionClass: 'P5', ownerRequired: true });
    }
    expect(byId['retrieval-index']).toMatchObject({ deleteAction: 'memory-index-rebuild', deleteActionClass: 'P2', ownerRequired: false });
    expect(byId['code-intelligence-memory']).toMatchObject({ deleteAction: null, deleteActionClass: null });
    expect(MEMORY_DELETE_ACTION).toEqual({ id: 'memory-delete', class: 'P5' });
    expect(MEMORY_INDEX_REBUILD_ACTION).toEqual({ id: 'memory-index-rebuild', class: 'P2' });
  });

  it.each([
    ['.projectops/plan-main.json', 'programme-project-memory'],
    ['.projectops/current-state-main.json', 'programme-project-memory'],
    ['.projectops/project-config.json', 'programme-project-memory'],
    ['.projectops/closure/decisions/PROJECTOS-X.json', 'programme-project-memory'],
    ['.projectops/execution/s1.findings.json', 'execution-memory'],
    ['.projectops/continuity/state.json', 'execution-memory'],
    [PATH, 'curated-memory'],
    ['.projectops/memory/proposals/p1.json', 'curated-memory'],
    ['.projectops/skills/promoted/review.json', 'skills'],
  ])('puts %s in %s', (path, id) => {
    expect(memoryClassOfPath(path)).toBe(id);
  });

  it.each(['docs/guide.md', 'src/index.ts', '.projectops/memory-deletions/0000000001.json', '.projectops/unknown/x.json', '.projectops/memory/../plan-x.json', '.projectops//memory/x', '.projectops/memory/x.md.', '.projectops', '', null, 7])(
    'does not put %j in a class',
    (path) => {
      expect(memoryClassOfPath(path)).toBeNull();
    },
  );
});

describe('deleting approved memory, or what a decision cites, needs the owner', () => {
  it('is refused with no verifier, and with a verifier that does not answer exactly true', () => {
    expect(judgeMemoryDeletion(request(), facts({ ownerVerifier: undefined }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_VERIFIER_MISSING' });
    for (const answer of [false, 'true', 1, {}, null, undefined, Promise.resolve(true), { then: () => true }]) {
      expect(judgeMemoryDeletion(request(), facts({ ownerVerifier: (() => answer) as never }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_NOT_VERIFIED' });
    }
    expect(judgeMemoryDeletion(request(), facts({ ownerVerifier: () => { throw new Error('no'); } }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_NOT_VERIFIED' });
    expect(judgeMemoryDeletion(request(), facts({ ownerVerifier: 'yes' as never }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_VERIFIER_MISSING' });
  });

  it('is allowed as memory-delete, P5, when the verifier answers exactly true', () => {
    expect(judgeMemoryDeletion(request(), facts())).toEqual({
      ok: true,
      action: 'memory-delete',
      actionClass: 'P5',
      memoryClass: 'curated-memory',
      citedByDecision: false,
      path: PATH,
      itemHash: HASH,
    });
  });

  it('asks the owner about this item, this hash, this tenant and this project, in a frozen claim', () => {
    const seen: unknown[] = [];
    const verifier = (claim: Record<string, unknown>) => {
      seen.push(claim, Object.isFrozen(claim));
      try {
        (claim as Record<string, unknown>)['itemHash'] = 'f'.repeat(64);
      } catch {
        /* frozen */
      }
      return true;
    };
    expect(judgeMemoryDeletion(request(), facts({ ownerVerifier: verifier as never })).ok).toBe(true);
    const claim = seen[0] as Record<string, unknown>;
    expect(claim).toMatchObject({ action: 'memory-delete', actionClass: 'P5', tenant: TENANT, project: PROJECT, root: ROOT, memoryClass: 'curated-memory', path: PATH, itemHash: HASH, citedByDecision: false, reason: 'the entry is wrong' });
    expect(seen[1]).toBe(true);
    expect(deletionOwnerClaimOf(request(), 'curated-memory', 'memory-delete', 'P5', { root: ROOT, citedByDecision: false })).toEqual(claim);
  });

  it('shows the owner what a decision cites, and binds it in the hash of the claim', () => {
    const claims: Record<string, unknown>[] = [];
    const verifier = (claim: Record<string, unknown>) => (claims.push(claim), true);
    for (const citedByDecision of [false, true, 'unknown'] as const) judgeMemoryDeletion(request(), facts({ citedByDecision, ownerVerifier: verifier as never }));
    expect(claims.map((claim) => claim['citedByDecision'])).toEqual([false, true, 'unknown']);
    const hashes = claims.map((claim) => claim['claimHash']);
    expect(new Set(hashes).size).toBe(3);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds the root, the tenant, the project and the item hash in the hash of the claim', () => {
    const hashOf = (rawRequest: Record<string, unknown>, root = ROOT) => {
      let hash: unknown;
      judgeMemoryDeletion(rawRequest, facts({ root, currentItemHash: String(rawRequest['itemHash']), ownerVerifier: ((claim: Record<string, unknown>) => ((hash = claim['claimHash']), true)) as never }));
      return hash;
    };
    const base = hashOf(request());
    expect(hashOf(request())).toBe(base);
    expect(hashOf(request(), '/other/project')).not.toBe(base);
    expect(hashOf(request({ tenant: 'agency-two' }))).not.toBe(base);
    expect(hashOf(request({ project: 'beta-project' }))).not.toBe(base);
    expect(hashOf(request({ itemHash: 'f'.repeat(64) }))).not.toBe(base);
  });

  it('refuses a binding it cannot use, before the owner is asked', () => {
    let asked = 0;
    const verifier = () => (asked++, true);
    for (const root of ['', 'a'.repeat(513), 'a\nb', 7 as never, undefined as never]) {
      expect(judgeMemoryDeletion(request(), facts({ root, ownerVerifier: verifier }))).toMatchObject({ ok: false, code: 'DELETE_BINDING_INVALID' });
    }
    expect(asked).toBe(0);
  });

  it('asks once, and a verifier that answers true the first time and false the second changes nothing', () => {
    let asked = 0;
    const verifier = () => (asked++ === 0);
    expect(judgeMemoryDeletion(request(), facts({ ownerVerifier: verifier })).ok).toBe(true);
    expect(asked).toBe(1);
  });

  it.each([
    ['approved memory', PATH],
    ['plan memory', '.projectops/plan-main.json'],
    ['a decision', '.projectops/closure/decisions/PROJECTOS-X.json'],
    ['an execution record', '.projectops/execution/s1.evidence.json'],
    ['a proposal', '.projectops/memory/proposals/p1.json'],
    ['a promoted skill', '.projectops/skills/promoted/review.json'],
  ])('%s is memory-delete, P5, with no owner and with one', (_name, path) => {
    expect(judgeMemoryDeletion(request({ path }), facts({ ownerVerifier: undefined }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_VERIFIER_MISSING' });
    expect(judgeMemoryDeletion(request({ path }), facts({ ownerVerifier: () => false }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_NOT_VERIFIED' });
    expect(judgeMemoryDeletion(request({ path }), facts())).toMatchObject({ ok: true, action: 'memory-delete', actionClass: 'P5' });
  });

  it('an item a decision cites is owner-only whether or not the decision source could be read, and says which', () => {
    for (const citedByDecision of [true, 'unknown'] as const) {
      expect(judgeMemoryDeletion(request(), facts({ citedByDecision, ownerVerifier: undefined }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_VERIFIER_MISSING' });
      expect(judgeMemoryDeletion(request(), facts({ citedByDecision }))).toMatchObject({ ok: true, citedByDecision });
    }
  });

  it('refuses what is not a memory item, an item that is not there, and a hash that is not the item', () => {
    expect(judgeMemoryDeletion(request({ path: 'docs/guide.md' }), facts())).toMatchObject({ ok: false, code: 'DELETE_NOT_A_MEMORY_ITEM' });
    expect(judgeMemoryDeletion(request(), facts({ currentItemHash: null }))).toMatchObject({ ok: false, code: 'DELETE_ITEM_ABSENT' });
    expect(judgeMemoryDeletion(request({ itemHash: 'f'.repeat(64) }), facts())).toMatchObject({ ok: false, code: 'DELETE_HASH_MISMATCH' });
  });

  it('asks the owner nothing when the request itself is refused', () => {
    let asked = 0;
    const verifier = () => (asked++, true);
    for (const bad of [
      request({ tenant: 'Not A Tenant' }),
      request({ project: '../x' }),
      request({ itemHash: 'abc' }),
      request({ itemHash: HASH.toUpperCase() }),
      request({ reason: '' }),
      request({ reason: '   ' }),
      request({ reason: 'a\nb' }),
      request({ reason: 'x'.repeat(MAX_DELETION_REASON_CHARS + 1) }),
      request({ reason: 'x‮y' }),
      { ...request(), extra: 1 },
      request({ path: 7 }),
    ]) {
      expect(judgeMemoryDeletion(bad, facts({ ownerVerifier: verifier }))).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
    }
    expect(judgeMemoryDeletion(request({ path: 'docs/guide.md' }), facts({ ownerVerifier: verifier })).ok).toBe(false);
    expect(asked).toBe(0);
  });

  it('refuses a request with a getter or a prototype key, so a second read cannot differ', () => {
    let reads = 0;
    const getter = { ...request() } as Record<string, unknown>;
    Object.defineProperty(getter, 'path', { enumerable: true, get: () => (reads++ === 0 ? PATH : '.projectops/plan-main.json') });
    expect(judgeMemoryDeletion(getter, facts())).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
    expect(judgeMemoryDeletion(JSON.parse(`{"__proto__":{"a":1},"tenant":"${TENANT}"}`), facts())).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
    expect(reads).toBe(0);
  });

  it('a reason of 60,000 characters is refused at once', () => {
    const started = Date.now();
    expect(judgeMemoryDeletion(request({ reason: 'x'.repeat(60_000) }), facts())).toMatchObject({ code: 'DELETE_REQUEST_INVALID' });
    expect(judgeMemoryDeletion(request({ reason: ' '.repeat(60_000) }), facts())).toMatchObject({ code: 'DELETE_REQUEST_INVALID' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('deleting a derived index is memory-index-rebuild, and needs no owner', () => {
  it('names the action and the class, and asks nobody', () => {
    expect(judgeIndexDeletion({ tenant: TENANT, project: PROJECT, reason: 'rebuild it' })).toEqual({
      ok: true,
      action: 'memory-index-rebuild',
      actionClass: 'P2',
      memoryClass: 'retrieval-index',
      tenant: TENANT,
      project: PROJECT,
      reason: 'rebuild it',
    });
  });

  it('refuses an owner that is not a tenant and a project, and a reason it cannot record', () => {
    expect(judgeIndexDeletion({ tenant: 'Bad Tenant', project: PROJECT, reason: 'x' })).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
    expect(judgeIndexDeletion({ tenant: TENANT, project: '../x', reason: 'x' })).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
    expect(judgeIndexDeletion({ tenant: TENANT, project: PROJECT, reason: '' })).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
    expect(judgeIndexDeletion({ tenant: TENANT, project: PROJECT, reason: 'x', path: PATH })).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
  });
});

describe('an item a committed decision cites is found by its path or its hash', () => {
  it('finds the path, the hash, and neither', () => {
    expect(decisionCitesItem(`the owner relied on ${PATH} here`, { path: PATH, hash: HASH })).toBe(true);
    expect(decisionCitesItem(`sha256:${HASH}`, { path: PATH, hash: HASH })).toBe(true);
    expect(decisionCitesItem('nothing relevant', { path: PATH, hash: HASH })).toBe(false);
  });

  it('only ever adds protection: it reads no meaning, and a long text is searched in linear time', () => {
    const started = Date.now();
    expect(decisionCitesItem(`${'a'.repeat(1_000_000)}${PATH}`, { path: PATH, hash: HASH })).toBe(true);
    expect(decisionCitesItem('a'.repeat(1_000_000), { path: PATH, hash: HASH })).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('an empty path or hash cites nothing rather than everything', () => {
    expect(decisionCitesItem('anything', { path: '', hash: '' })).toBe(false);
  });
});

describe('the request is read once, into a frozen copy the record is made from', () => {
  it('returns the five fields frozen, and nothing for a request it would refuse', () => {
    const read = memoryDeletionRequestOf(request());
    expect(read).toEqual(request());
    expect(Object.isFrozen(read)).toBe(true);
    expect(memoryDeletionRequestOf({ ...request(), extra: 1 })).toBeNull();
    expect(memoryDeletionRequestOf(request({ project: 'Not A Project' }))).toBeNull();
    expect(memoryDeletionRequestOf(null)).toBeNull();
  });
});
