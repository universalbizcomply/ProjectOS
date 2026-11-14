import { describe, expect, it } from 'vitest';
import { MEMORY_DELETION_LEDGER_DIR, searchIndexFileName, sha256Hex, type MemoryDeletionClaim } from '@projectos/core';
import { deleteDerivedIndex, deleteMemoryItem, readDeletionLedger, type MemoryDeletionPorts } from '../src/memory/memoryDeletion.js';
import type { DocumentFs, EntryStat, SearchClock } from '../src/search/ports.js';

const TENANT = 'agency-one';
const PROJECT = 'alpha-project';
const ROOT = '/work/project';
const PATH = '.projectops/memory/MEMORY.md';
const TEXT = '# Memory\n\n- The build uses Node 24.\n';
const HASH = sha256Hex(TEXT);
const LEDGER = `${ROOT}/${MEMORY_DELETION_LEDGER_DIR}`;
const INDEX_DIR = '/state/indexes';

interface Disk {
  readonly files: Map<string, string>;
  readonly links: Set<string>;
  readonly removed: string[];
  readonly created: string[];
  failCreateAfter: number;
  failRemove: boolean;
}

function disk(initial: Record<string, string> = { [`${ROOT}/${PATH}`]: TEXT }): Disk {
  return { files: new Map(Object.entries(initial)), links: new Set(), removed: [], created: [], failCreateAfter: Number.POSITIVE_INFINITY, failRemove: false };
}

function portsOver(state: Disk, overrides: Partial<MemoryDeletionPorts> = {}): MemoryDeletionPorts {
  const directories = (): Set<string> => {
    const set = new Set<string>();
    for (const path of [...state.files.keys(), ...state.links]) {
      const parts = path.split('/');
      for (let length = 1; length < parts.length; length += 1) set.add(parts.slice(0, length).join('/'));
    }
    return set;
  };
  const stat = (path: string): EntryStat | null => {
    if (state.links.has(path)) return { kind: 'link', size: 0, mtimeMs: 1 };
    const held = state.files.get(path);
    if (held !== undefined) return { kind: 'file', size: held.length, mtimeMs: 1 };
    return directories().has(path) ? { kind: 'directory', size: 0, mtimeMs: 1 } : null;
  };
  const fs: DocumentFs = {
    stat,
    readText: (path) => state.files.get(path) ?? null,
    listDir: (path) => {
      const prefix = `${path}/`;
      return [...new Set([...state.files.keys(), ...state.links, ...directories()].filter((e) => e.startsWith(prefix)).map((e) => e.slice(prefix.length).split('/')[0] ?? ''))].filter((n) => n !== '');
    },
  };
  let creations = 0;
  const files = Object.freeze({
    readText: fs.readText,
    listDir: fs.listDir,
    exists: (path: string) => state.files.has(path),
    createExclusive: (path: string, content: string) => {
      creations += 1;
      if (creations > state.failCreateAfter || state.files.has(path)) return false;
      state.files.set(path, content);
      state.created.push(path);
      return true;
    },
    removeFile: (path: string) => {
      state.removed.push(path);
      if (state.failRemove) return false;
      state.files.delete(path);
      return true;
    },
  });
  const clock: SearchClock = { nowMs: () => 1_700_000_000_000 };
  return { files, fs, clock, committedDecisions: () => [], ownerVerifier: () => true, ...overrides };
}

const request = (overrides: Record<string, unknown> = {}) => ({ tenant: TENANT, project: PROJECT, path: PATH, itemHash: HASH, reason: 'the entry is wrong', ...overrides });

const entriesOf = (state: Disk): readonly Record<string, unknown>[] => {
  const names = [...state.files.keys()].filter((p) => p.startsWith(`${LEDGER}/`)).sort();
  return names.map((name) => JSON.parse(state.files.get(name) ?? '{}') as Record<string, unknown>);
};

describe('deleting approved memory without the owner is refused, and recorded', () => {
  it('refuses with no verifier at all, keeps the item, and records the refusal with the item hash and the reason', () => {
    const state = disk();
    const { ownerVerifier: _unused, ...rest } = portsOver(state);
    const outcome = deleteMemoryItem(rest, ROOT, request());
    expect(outcome).toEqual({ ok: false, code: 'DELETE_OWNER_VERIFIER_MISSING', recorded: true });
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(true);
    expect(state.removed).toEqual([]);
    expect(entriesOf(state)).toMatchObject([
      { seq: 1, outcome: 'refused', code: 'DELETE_OWNER_VERIFIER_MISSING', action: 'memory-delete', actionClass: 'P5', memoryClass: 'curated-memory', path: PATH, itemHash: HASH, reason: 'the entry is wrong', tenant: TENANT, project: PROJECT },
    ]);
  });

  it.each([
    ['false', () => false],
    ['the string true', () => 'true'],
    ['a Promise', () => Promise.resolve(true)],
    ['a throw', () => {
      throw new Error('console closed');
    }],
  ])('refuses when the verifier answers %s, and records it', (_name, answer) => {
    const state = disk();
    const outcome = deleteMemoryItem(portsOver(state, { ownerVerifier: answer as never }), ROOT, request());
    expect(outcome).toEqual({ ok: false, code: 'DELETE_OWNER_NOT_VERIFIED', recorded: true });
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(true);
    expect(entriesOf(state)).toMatchObject([{ outcome: 'refused', code: 'DELETE_OWNER_NOT_VERIFIED', itemHash: HASH }]);
  });

  it('asks the owner once, about this item, this hash, this tenant and this project', () => {
    const state = disk();
    const asked: MemoryDeletionClaim[] = [];
    deleteMemoryItem(
      portsOver(state, {
        ownerVerifier: (claim) => {
          asked.push(claim);
          return true;
        },
      }),
      ROOT,
      request(),
    );
    expect(asked).toEqual([{ action: 'memory-delete', actionClass: 'P5', tenant: TENANT, project: PROJECT, memoryClass: 'curated-memory', path: PATH, itemHash: HASH, reason: 'the entry is wrong' }]);
  });

  it('with the owner, deletes the item and records an authorisation and then the deletion, in one chain', () => {
    const state = disk();
    const outcome = deleteMemoryItem(portsOver(state), ROOT, request());
    expect(outcome).toEqual({ ok: true, action: 'memory-delete', path: PATH, itemHash: HASH, recorded: true });
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(false);
    expect(entriesOf(state)).toMatchObject([
      { seq: 1, outcome: 'authorised', itemHash: HASH },
      { seq: 2, outcome: 'deleted', itemHash: HASH },
    ]);
    const ledger = readDeletionLedger(portsOver(state).files, ROOT);
    expect(ledger).toMatchObject({ ok: true, count: 2 });
  });

  it.each([
    ['a decision', '.projectops/closure/decisions/PROJECTOS-X.json', 'programme-project-memory'],
    ['plan memory', '.projectops/plan-main.json', 'programme-project-memory'],
    ['an execution record', '.projectops/execution/s1.evidence.json', 'execution-memory'],
    ['a pending proposal', '.projectops/memory/proposals/p1.json', 'curated-memory'],
    ['a promoted skill', '.projectops/skills/promoted/review.json', 'skills'],
  ])('%s is memory-delete too: refused with no owner, allowed with one, and recorded in its class', (_name, path, memoryClass) => {
    const refusedState = disk({ [`${ROOT}/${path}`]: TEXT });
    expect(deleteMemoryItem(portsOver(refusedState, { ownerVerifier: () => false }), ROOT, request({ path }))).toMatchObject({ ok: false, code: 'DELETE_OWNER_NOT_VERIFIED' });
    expect(refusedState.files.has(`${ROOT}/${path}`)).toBe(true);
    const allowed = disk({ [`${ROOT}/${path}`]: TEXT });
    expect(deleteMemoryItem(portsOver(allowed), ROOT, request({ path }))).toMatchObject({ ok: true, action: 'memory-delete' });
    expect(entriesOf(allowed)[0]).toMatchObject({ memoryClass, action: 'memory-delete', actionClass: 'P5' });
  });

  it('records whether a committed decision cites the item, and treats a decision it could not read as unknown, not as none', () => {
    const cited = disk();
    deleteMemoryItem(portsOver(cited, { committedDecisions: () => [`{"relies_on":"${PATH}"}`] }), ROOT, request());
    expect(entriesOf(cited)[0]).toMatchObject({ citedByDecision: true });
    const byHash = disk();
    deleteMemoryItem(portsOver(byHash, { committedDecisions: () => [`{"sha":"${HASH}"}`] }), ROOT, request());
    expect(entriesOf(byHash)[0]).toMatchObject({ citedByDecision: true });
    const unread = disk();
    deleteMemoryItem(portsOver(unread, { committedDecisions: () => null }), ROOT, request());
    expect(entriesOf(unread)[0]).toMatchObject({ citedByDecision: 'unknown' });
    const none = disk();
    deleteMemoryItem(portsOver(none), ROOT, request());
    expect(entriesOf(none)[0]).toMatchObject({ citedByDecision: false });
  });
});

describe('every refused attempt is recorded, whatever the refusal', () => {
  it('a hash that is not the item: refused, the owner is not asked, the item stays', () => {
    const state = disk();
    let asked = 0;
    const outcome = deleteMemoryItem(portsOver(state, { ownerVerifier: () => (asked++, true) }), ROOT, request({ itemHash: 'f'.repeat(64) }));
    expect(outcome).toEqual({ ok: false, code: 'DELETE_HASH_MISMATCH', recorded: true });
    expect(asked).toBe(0);
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(true);
    expect(entriesOf(state)).toMatchObject([{ outcome: 'refused', code: 'DELETE_HASH_MISMATCH', itemHash: 'f'.repeat(64) }]);
  });

  it('an item that is not there: refused and recorded, with no hash', () => {
    const state = disk({});
    expect(deleteMemoryItem(portsOver(state), ROOT, request())).toEqual({ ok: false, code: 'DELETE_ITEM_ABSENT', recorded: true });
    expect(entriesOf(state)).toMatchObject([{ outcome: 'refused', code: 'DELETE_ITEM_ABSENT' }]);
  });

  it('something that is not a memory item (a document): refused and recorded with no class', () => {
    const state = disk({ [`${ROOT}/docs/guide.md`]: TEXT });
    expect(deleteMemoryItem(portsOver(state), ROOT, request({ path: 'docs/guide.md' }))).toEqual({ ok: false, code: 'DELETE_NOT_A_MEMORY_ITEM', recorded: true });
    expect(state.files.has(`${ROOT}/docs/guide.md`)).toBe(true);
    expect(entriesOf(state)).toMatchObject([{ outcome: 'refused', code: 'DELETE_NOT_A_MEMORY_ITEM', memoryClass: null, path: 'docs/guide.md' }]);
  });

  it('a path that is a link, a directory, or lies behind a link: refused and recorded, never removed', () => {
    const link = disk({});
    link.links.add(`${ROOT}/${PATH}`);
    expect(deleteMemoryItem(portsOver(link), ROOT, request())).toMatchObject({ ok: false, code: 'DELETE_ITEM_NOT_REGULAR', recorded: true });
    const dir = disk({ [`${ROOT}/${PATH}/inner.md`]: TEXT });
    expect(deleteMemoryItem(portsOver(dir), ROOT, request())).toMatchObject({ ok: false, code: 'DELETE_ITEM_NOT_REGULAR' });
    const behind = disk();
    behind.links.add(`${ROOT}/.projectops/memory`);
    expect(deleteMemoryItem(portsOver(behind), ROOT, request())).toMatchObject({ ok: false, code: 'DELETE_ITEM_NOT_REGULAR' });
    for (const state of [link, dir, behind]) expect(state.removed).toEqual([]);
  });

  it('the ledger is not a memory item: it cannot be deleted through this door, with the owner or without', () => {
    const state = disk();
    deleteMemoryItem(portsOver(state), ROOT, request({ itemHash: 'f'.repeat(64) }));
    const [name] = [...state.files.keys()].filter((p) => p.startsWith(`${LEDGER}/`));
    const rel = (name as string).slice(ROOT.length + 1);
    const before = state.files.get(name as string);
    expect(deleteMemoryItem(portsOver(state), ROOT, request({ path: rel, itemHash: sha256Hex(before ?? '') }))).toMatchObject({ ok: false, code: 'DELETE_NOT_A_MEMORY_ITEM' });
    expect(state.files.get(name as string)).toBe(before);
  });

  it('a request that cannot be read has no tenant and project to record it under: refused, and says it was not recorded', () => {
    const state = disk();
    for (const bad of [null, { ...request(), extra: 1 }, request({ tenant: 'Not A Tenant' }), request({ reason: '' }), request({ itemHash: 'abc' })]) {
      expect(deleteMemoryItem(portsOver(state), ROOT, bad)).toEqual({ ok: false, code: 'DELETE_REQUEST_INVALID', recorded: false });
    }
    expect(entriesOf(state)).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it('a clock that gives no time refuses the deletion, because an entry cannot be made without one', () => {
    const state = disk();
    const outcome = deleteMemoryItem(
      portsOver(state, {
        clock: {
          nowMs: () => {
            throw new Error('no time');
          },
        },
      }),
      ROOT,
      request(),
    );
    expect(outcome).toEqual({ ok: false, code: 'DELETION_CLOCK_UNAVAILABLE', recorded: false });
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(true);
    for (const bad of [Number.NaN, -5, 1.5, Number.POSITIVE_INFINITY]) {
      expect(deleteMemoryItem(portsOver(state, { clock: { nowMs: () => bad } }), ROOT, request())).toMatchObject({ ok: false, code: 'DELETION_CLOCK_UNAVAILABLE' });
    }
  });
});

describe('nothing is deleted that is not recorded first', () => {
  it('a ledger that cannot take an entry stops the deletion before it starts', () => {
    const state = disk();
    state.failCreateAfter = 0;
    expect(deleteMemoryItem(portsOver(state), ROOT, request())).toEqual({ ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false });
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(true);
    expect(state.removed).toEqual([]);
  });

  it('a ledger whose chain is broken, or that holds a foreign file, is not extended and nothing is deleted', () => {
    const first = disk();
    deleteMemoryItem(portsOver(first, { ownerVerifier: () => false }), ROOT, request());
    const [name] = [...first.files.keys()].filter((p) => p.startsWith(`${LEDGER}/`));
    first.files.set(name as string, (first.files.get(name as string) ?? '').replace('"refused"', '"deleted"'));
    expect(deleteMemoryItem(portsOver(first), ROOT, request())).toEqual({ ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false });
    expect(first.files.has(`${ROOT}/${PATH}`)).toBe(true);

    const foreign = disk();
    foreign.files.set(`${LEDGER}/notes.txt`, 'hello');
    expect(deleteMemoryItem(portsOver(foreign), ROOT, request())).toEqual({ ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false });
    expect(foreign.files.has(`${ROOT}/${PATH}`)).toBe(true);
  });

  it('a second attempt extends the same chain, and the first entries are never rewritten or removed', () => {
    const state = disk();
    deleteMemoryItem(portsOver(state, { ownerVerifier: () => false }), ROOT, request());
    const before = [...state.files.entries()].filter(([p]) => p.startsWith(`${LEDGER}/`));
    deleteMemoryItem(portsOver(state, { ownerVerifier: () => false }), ROOT, request({ reason: 'second try' }));
    const after = [...state.files.entries()].filter(([p]) => p.startsWith(`${LEDGER}/`));
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(2);
    expect(readDeletionLedger(portsOver(state).files, ROOT)).toMatchObject({ ok: true, count: 2 });
    expect(state.removed).toEqual([]);
  });

  it('removes only the item: the ledger is created into and never removed from, and no write port exists', () => {
    const state = disk();
    deleteMemoryItem(portsOver(state), ROOT, request());
    expect(state.removed).toEqual([`${ROOT}/${PATH}`]);
    expect(Object.keys(portsOver(state).files).sort()).toEqual(['createExclusive', 'exists', 'listDir', 'readText', 'removeFile']);
  });

  it('when the removal itself fails, the failure is recorded and the outcome says so', () => {
    const state = disk();
    state.failRemove = true;
    expect(deleteMemoryItem(portsOver(state), ROOT, request())).toEqual({ ok: false, code: 'DELETE_REMOVE_FAILED', recorded: true });
    expect(entriesOf(state)).toMatchObject([{ outcome: 'authorised' }, { outcome: 'delete-failed', code: 'DELETE_REMOVE_FAILED' }]);
  });

  it('when only the closing entry cannot be written, the deletion stands and says it is not fully recorded', () => {
    const state = disk();
    state.failCreateAfter = 1;
    expect(deleteMemoryItem(portsOver(state), ROOT, request())).toEqual({ ok: true, action: 'memory-delete', path: PATH, itemHash: HASH, recorded: false });
    expect(entriesOf(state)).toMatchObject([{ outcome: 'authorised' }]);
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(false);
  });

  it('an item that changes between the owner saying yes and the removal is not removed: the approval was for other bytes', () => {
    const state = disk();
    const outcome = deleteMemoryItem(
      portsOver(state, {
        ownerVerifier: () => {
          state.files.set(`${ROOT}/${PATH}`, `${TEXT}- a line added after the owner looked\n`);
          return true;
        },
      }),
      ROOT,
      request(),
    );
    expect(outcome).toEqual({ ok: false, code: 'DELETE_HASH_MISMATCH', recorded: true });
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(true);
    expect(state.removed).toEqual([]);
    expect(entriesOf(state)).toMatchObject([{ outcome: 'authorised' }, { outcome: 'refused', code: 'DELETE_HASH_MISMATCH' }]);
  });
});

describe('deleting a derived index is memory-index-rebuild, needs no owner, and is recorded', () => {
  const owner = { tenant: TENANT, project: PROJECT };
  const named = (o = owner) => {
    const result = searchIndexFileName(o);
    if (!result.ok) throw new Error(result.reason);
    return result.fileName;
  };
  const withIndex = (o = owner) => disk({ [`${INDEX_DIR}/${named(o)}`]: 'sqlite bytes' });
  const call = (state: Disk, raw: unknown = { ...owner, reason: 'rebuild it' }, extra: Partial<MemoryDeletionPorts> = {}) => {
    const { files, clock } = portsOver(state, extra);
    return deleteDerivedIndex({ files, clock }, ROOT, INDEX_DIR, raw);
  };

  it('removes that owner\'s file and nothing else, asks nobody, and records the action', () => {
    const state = withIndex();
    state.files.set(`${INDEX_DIR}/${named({ tenant: TENANT, project: 'beta-project' })}`, 'other project');
    expect(call(state)).toEqual({ ok: true, action: 'memory-index-rebuild', path: named(), itemHash: null, recorded: true });
    expect(state.removed).toEqual([`${INDEX_DIR}/${named()}`]);
    expect(state.files.has(`${INDEX_DIR}/${named({ tenant: TENANT, project: 'beta-project' })}`)).toBe(true);
    expect(entriesOf(state)).toMatchObject([
      { outcome: 'authorised', action: 'memory-index-rebuild', actionClass: 'P2', memoryClass: 'retrieval-index', path: named(), itemHash: null, citedByDecision: null, reason: 'rebuild it' },
      { outcome: 'deleted' },
    ]);
  });

  it('cannot be aimed at anything else: the file name comes from the owner by hash, so a path in a request is refused', () => {
    const state = withIndex();
    state.files.set(`${ROOT}/${PATH}`, TEXT);
    expect(call(state, { ...owner, reason: 'x', path: `../${PATH}` })).toEqual({ ok: false, code: 'DELETE_REQUEST_INVALID', recorded: false });
    expect(call(state, { tenant: TENANT, project: '../x', reason: 'x' })).toMatchObject({ ok: false, code: 'DELETE_REQUEST_INVALID' });
    expect(state.removed).toEqual([]);
    expect(state.files.has(`${ROOT}/${PATH}`)).toBe(true);
  });

  it('an index that is not there is refused and recorded, not reported as deleted', () => {
    const state = disk({});
    expect(call(state)).toEqual({ ok: false, code: 'DELETE_ITEM_ABSENT', recorded: true });
    expect(entriesOf(state)).toMatchObject([{ outcome: 'refused', code: 'DELETE_ITEM_ABSENT', action: 'memory-index-rebuild' }]);
  });

  it('a failed removal is recorded, and a ledger that cannot take an entry stops it first', () => {
    const failing = withIndex();
    failing.failRemove = true;
    expect(call(failing)).toEqual({ ok: false, code: 'DELETE_REMOVE_FAILED', recorded: true });
    const blocked = withIndex();
    blocked.failCreateAfter = 0;
    expect(call(blocked)).toEqual({ ok: false, code: 'DELETION_LEDGER_UNAVAILABLE', recorded: false });
    expect(blocked.removed).toEqual([]);
  });
});

describe('the deletion ledger is read back whole', () => {
  it('lists its entries in order with the chain verified, and refuses a ledger that was changed', () => {
    const state = disk();
    deleteMemoryItem(portsOver(state), ROOT, request());
    const ledger = readDeletionLedger(portsOver(state).files, ROOT);
    if (!ledger.ok) throw new Error(ledger.code);
    expect(ledger.entries.map((entry) => entry.outcome)).toEqual(['authorised', 'deleted']);
    const [first] = [...state.files.keys()].filter((p) => p.startsWith(`${LEDGER}/`)).sort();
    state.files.set(first as string, (state.files.get(first as string) ?? '').replace(HASH, 'a'.repeat(64)));
    expect(readDeletionLedger(portsOver(state).files, ROOT)).toMatchObject({ ok: false, code: 'DELETION_LEDGER_ENTRY_ALTERED' });
  });

  it('an empty ledger is a valid ledger of no entries', () => {
    expect(readDeletionLedger(portsOver(disk({})).files, ROOT)).toMatchObject({ ok: true, count: 0, entries: [] });
  });
});
