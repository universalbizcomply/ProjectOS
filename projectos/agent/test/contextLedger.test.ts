import { describe, expect, it } from 'vitest';
import { contextLedgerProblem, parseContextLedgerEntry, type ContextLedgerBody, type ContextLedgerEntry } from '@projectos/core';
import { CONTEXT_LEDGER_TAIL_WINDOW, appendContextLedger, type ContextLedgerFiles } from '../src/context/contextLedger.js';

const DIR = '/work/project/.projectops/context-ledger';
const HASH = `sha256:${'a'.repeat(64)}`;

const body = (over: Partial<ContextLedgerBody> = {}): ContextLedgerBody => ({
  event: 'retrieved',
  sessionId: 'PHASE-abcdef012345-1a2b3c4d',
  tenant: 'polygonia',
  domain: 'develop',
  project: 'polygo',
  envelopeId: `ENV-${'1'.repeat(24)}`,
  headCommit: 'c'.repeat(40),
  at: '2026-11-14T10:00:00.000Z',
  attempt: null,
  shown: [],
  withheld: [],
  omitted: [],
  decisions: [],
  compactor: 'none',
  compactionId: null,
  estimatedTokens: 100,
  taintsRun: true,
  fileHash: HASH,
  refusal: null,
  ...over,
});

function memory(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial };
  const reads: string[] = [];
  const created: string[] = [];
  const port: ContextLedgerFiles = {
    listDir: (path) => (path === DIR ? Object.keys(files).filter((p) => p.startsWith(`${DIR}/`)).map((p) => p.slice(DIR.length + 1)) : []),
    readText: (path) => (reads.push(path), files[path] ?? null),
    createExclusive: (path, content) => {
      if (path in files) return false;
      files[path] = content;
      if (!path.endsWith('.tmp')) created.push(path);
      return true;
    },
    removeFile: (path) => (delete files[path], true),
  };
  return { files, reads, created, port };
}

const entriesOf = (files: Record<string, string>): readonly ContextLedgerEntry[] =>
  Object.keys(files)
    .sort()
    .map((path) => {
      const parsed = parseContextLedgerEntry(files[path]);
      if (!parsed.ok) throw new Error(path);
      return parsed.entry;
    });

describe('the retrieval ledger is appended by the loop, one exclusive file per entry', () => {
  it('writes entry 1 with no predecessor, and entry 2 chained to it', () => {
    const world = memory();
    const first = appendContextLedger(world.port, DIR, body());
    const second = appendContextLedger(world.port, DIR, body({ event: 'placed', attempt: 1 }));
    if (!first.ok || !second.ok) throw new Error('both should append');
    expect(first.path).toBe(`${DIR}/000001.json`);
    expect(second.path).toBe(`${DIR}/000002.json`);
    expect(first.entry).toMatchObject({ seq: 1, prevHash: null });
    expect(second.entry).toMatchObject({ seq: 2, prevHash: first.entry.entryHash });
    expect(contextLedgerProblem(entriesOf(world.files))).toBeNull();
  });

  it('writes through a temporary name that is created exclusively and then created under its number, so an entry is never overwritten and no rename exists', () => {
    const world = memory();
    appendContextLedger(world.port, DIR, body());
    expect(Object.keys(world.port)).toEqual(['listDir', 'readText', 'createExclusive', 'removeFile']);
    expect(world.created).toEqual([`${DIR}/000001.json`]);
    expect(Object.keys(world.files)).toEqual([`${DIR}/000001.json`]);
  });

  it('loses a race once and takes the next place, never overwriting the winner', () => {
    const world = memory();
    appendContextLedger(world.port, DIR, body());
    let raced = false;
    const racing: ContextLedgerFiles = {
      ...world.port,
      createExclusive: (path, content) => {
        if (!raced) {
          raced = true;
          const winner = appendContextLedger(world.port, DIR, body({ event: 'placed', attempt: 1 }));
          if (!winner.ok) throw new Error('the winner should append');
        }
        return world.port.createExclusive(path, content);
      },
    };
    const result = appendContextLedger(racing, DIR, body({ event: 'placed', attempt: 2 }));
    if (!result.ok) throw new Error(result.code);
    expect(result.entry.seq).toBe(3);
    expect(contextLedgerProblem(entriesOf(world.files))).toBeNull();
  });

  it('refuses when the create keeps failing, and says nothing was recorded', () => {
    const world = memory();
    const failing: ContextLedgerFiles = { ...world.port, createExclusive: () => false };
    expect(appendContextLedger(failing, DIR, body())).toEqual({ ok: false, code: 'CONTEXT_LEDGER_WRITE_FAILED' });
    expect(world.created).toEqual([]);
  });

  it('refuses a body that is not a ledger body, and writes nothing', () => {
    const world = memory();
    expect(appendContextLedger(world.port, DIR, { ...body(), extra: 1 } as never)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' });
    expect(world.created).toEqual([]);
  });

  it('refuses a directory holding a file it did not write, whatever its name', () => {
    for (const name of ['notes.txt', '1.json', '000001.JSON', '000000.json', '000001.json.bak']) {
      const world = memory({ [`${DIR}/${name}`]: 'x' });
      expect(appendContextLedger(world.port, DIR, body())).toEqual({ ok: false, code: 'CONTEXT_LEDGER_FOREIGN_FILE' });
      expect(world.created).toEqual([]);
    }
  });

  it('refuses a ledger whose tail was changed, and one with a gap, and one it cannot read', () => {
    const good = memory();
    appendContextLedger(good.port, DIR, body());
    appendContextLedger(good.port, DIR, body({ event: 'placed', attempt: 1 }));

    const changed = memory({ ...good.files, [`${DIR}/000002.json`]: (good.files[`${DIR}/000002.json`] as string).replace('polygo', 'someone') });
    expect(appendContextLedger(changed.port, DIR, body())).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BROKEN' });

    const gap = memory({ [`${DIR}/000001.json`]: good.files[`${DIR}/000001.json`] as string, [`${DIR}/000003.json`]: good.files[`${DIR}/000002.json`] as string });
    expect(appendContextLedger(gap.port, DIR, body())).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BROKEN' });

    const unreadable = memory({ ...good.files });
    expect(appendContextLedger({ ...unreadable.port, readText: () => null }, DIR, body())).toEqual({ ok: false, code: 'CONTEXT_LEDGER_UNREADABLE' });
    expect([changed, gap, unreadable].every((world) => world.created.length === 0)).toBe(true);
  });

  it('refuses a file that is over the size of an entry without parsing it', () => {
    const world = memory({ [`${DIR}/000001.json`]: '{'.repeat(250_000) });
    expect(appendContextLedger(world.port, DIR, body())).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BROKEN' });
  });

  it('verifies the tail and not the whole history, so a long ledger does not slow a run', () => {
    const world = memory();
    for (let index = 0; index < CONTEXT_LEDGER_TAIL_WINDOW + 40; index += 1) appendContextLedger(world.port, DIR, body({ event: index === 0 ? 'retrieved' : 'placed', attempt: index === 0 ? null : index }));
    world.reads.length = 0;
    expect(appendContextLedger(world.port, DIR, body({ event: 'placed', attempt: 999 })).ok).toBe(true);
    // The tail window, and the two reads that check the temporary entry and the entry under its number.
    expect(world.reads.length).toBeLessThanOrEqual(CONTEXT_LEDGER_TAIL_WINDOW + 2);
  });

  it('refuses when the ledger is full, and on a time too hostile to list', () => {
    const names = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`${DIR}/${String(999_999 - index).padStart(6, '0')}.json`, 'x']));
    expect(appendContextLedger(memory(names).port, DIR, body())).toMatchObject({ ok: false });
    const crowded: ContextLedgerFiles = { listDir: () => Array.from({ length: 300_000 }, (_, index) => `${String(index + 1).padStart(6, '0')}.json`), readText: () => null, createExclusive: () => true, removeFile: () => true };
    const started = Date.now();
    expect(appendContextLedger(crowded, DIR, body())).toMatchObject({ ok: false });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
