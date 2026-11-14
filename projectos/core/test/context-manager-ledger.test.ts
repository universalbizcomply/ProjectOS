import { describe, expect, it } from 'vitest';
import {
  MAX_CONTEXT_LEDGER_ENTRY_CHARS,
  MAX_CONTEXT_LEDGER_ITEMS,
  contextLedgerFileName,
  contextLedgerProblem,
  contextLedgerSeqOfFileName,
  parseContextLedgerEntry,
  sealContextLedgerEntry,
  type ContextLedgerBody,
  type ContextLedgerEntry,
} from '../src/context/managerLedger.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const ITEM = {
  id: '.projectops/memory/MEMORY.md',
  kind: 'approved-memory',
  effectiveKind: 'approved-memory',
  rank: 1,
  tier: 1,
  contentHash: HASH,
  bytes: 120,
  truncated: false,
  source: 'committed',
  freshness: null,
  unverifiedClaim: false,
  overruledBy: [],
} as const;

const body = (over: Partial<ContextLedgerBody> = {}): ContextLedgerBody => ({
  event: 'retrieved',
  sessionId: 'PHASE-abcdef012345-1a2b3c4d',
  tenant: 'polygo',
  domain: 'develop',
  project: 'polygo',
  envelopeId: `ENV-${'1'.repeat(24)}`,
  headCommit: 'c'.repeat(40),
  at: '2026-11-14T10:00:00.000Z',
  attempt: null,
  shown: [ITEM],
  withheld: [{ id: '.projectops/memory/USER.md', code: 'CONTEXT_ITEM_THREAT' }],
  omitted: [],
  decisions: [{ hash: HASH, target: 'memory' }],
  compactor: 'none',
  compactionId: null,
  estimatedTokens: 900,
  taintsRun: true,
  fileHash: HASH,
  refusal: null,
  ...over,
});

function chain(count: number): readonly ContextLedgerEntry[] {
  const entries: ContextLedgerEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const sealed = sealContextLedgerEntry(body({ event: index === 0 ? 'retrieved' : 'placed', attempt: index === 0 ? null : index }), index + 1, entries.at(-1)?.entryHash ?? null);
    if (!sealed.ok) throw new Error(sealed.code);
    entries.push(sealed.entry);
  }
  return entries;
}

describe('every retrieval is recorded in an append-only, hash-chained ledger', () => {
  it('seals an entry with its place in the chain and a hash of everything in it', () => {
    const sealed = sealContextLedgerEntry(body(), 1, null);
    if (!sealed.ok) throw new Error(sealed.code);
    expect(sealed.entry).toMatchObject({ schema: 'projectos.context-retrieval/1', seq: 1, prevHash: null, event: 'retrieved', tenant: 'polygo', project: 'polygo' });
    expect(sealed.entry.entryHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(sealed.entry)).toBe(true);
    expect(sealContextLedgerEntry(body(), 1, null)).toEqual(sealed);
  });

  it('names each item shown with its hash and rank, and each item withheld with its code', () => {
    const sealed = sealContextLedgerEntry(body(), 1, null);
    if (!sealed.ok) throw new Error(sealed.code);
    expect(sealed.entry.shown[0]).toMatchObject({ id: ITEM.id, contentHash: HASH, rank: 1, tier: 1, kind: 'approved-memory' });
    expect(sealed.entry.withheld).toEqual([{ id: '.projectops/memory/USER.md', code: 'CONTEXT_ITEM_THREAT' }]);
  });

  it('a different body is a different hash, and so is a different place in the chain', () => {
    const a = sealContextLedgerEntry(body(), 1, null);
    const b = sealContextLedgerEntry(body({ project: 'another' }), 1, null);
    const c = sealContextLedgerEntry(body(), 2, HASH);
    if (!a.ok || !b.ok || !c.ok) throw new Error('all three should seal');
    expect(new Set([a.entry.entryHash, b.entry.entryHash, c.entry.entryHash]).size).toBe(3);
  });

  it('verifies an unbroken chain, and finds a changed entry, a removed one and a reordered pair', () => {
    const entries = chain(4);
    expect(contextLedgerProblem(entries)).toBeNull();
    expect(contextLedgerProblem([])).toBeNull();
    const changed = entries.map((entry, index) => (index === 1 ? { ...entry, project: 'another' } : entry));
    expect(contextLedgerProblem(changed)).toEqual({ index: 1, code: 'CONTEXT_LEDGER_HASH' });
    expect(contextLedgerProblem([entries[0], entries[2], entries[3]])).toMatchObject({ index: 1, code: 'CONTEXT_LEDGER_CHAIN' });
    expect(contextLedgerProblem([entries[1], entries[0]])).toMatchObject({ code: 'CONTEXT_LEDGER_CHAIN' });
  });

  it('finds the first entry deleted, because the second no longer follows the start of the chain', () => {
    expect(contextLedgerProblem(chain(3).slice(1))).toMatchObject({ index: 0, code: 'CONTEXT_LEDGER_CHAIN' });
  });

  it('finds an entry whose number does not match its place', () => {
    const entries = chain(2);
    const second = sealContextLedgerEntry(body({ event: 'placed', attempt: 1 }), 5, entries[0]?.entryHash ?? null);
    if (!second.ok) throw new Error(second.code);
    expect(contextLedgerProblem([entries[0], second.entry])).toMatchObject({ index: 1, code: 'CONTEXT_LEDGER_CHAIN' });
  });

  it('refuses a list that is not a list of entries, and a list too long to walk', () => {
    expect(contextLedgerProblem('x')).toMatchObject({ code: 'CONTEXT_LEDGER_ENTRY_INVALID' });
    expect(contextLedgerProblem([null])).toMatchObject({ index: 0, code: 'CONTEXT_LEDGER_ENTRY_INVALID' });
    expect(contextLedgerProblem(new Array(200_000).fill(0))).toMatchObject({ code: 'CONTEXT_LEDGER_TOO_LONG' });
  });

  it('reads the body once: a getter, a prototype key, an unlisted field and a symbol key are refused', () => {
    const hostile = body();
    Object.defineProperty(hostile, 'project', { enumerable: true, get: () => 'x' });
    expect(sealContextLedgerEntry(hostile, 1, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' });
    expect(sealContextLedgerEntry({ ...body(), extra: 1 }, 1, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' });
    expect(sealContextLedgerEntry(JSON.parse('{"__proto__": {"event": "retrieved"}}'), 1, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' });
    expect(sealContextLedgerEntry({ ...body(), [Symbol('k')]: 1 }, 1, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' });
  });

  it.each([
    ['an unknown event', { event: 'seen' }],
    ['a session id that is a path', { sessionId: '../x' }],
    ['a tenant that does not parse', { tenant: 'Not A Tenant' }],
    ['an unknown domain', { domain: 'everything' }],
    ['a head that is not a commit', { headCommit: 'main' }],
    ['a time that is not an instant', { at: 'tomorrow' }],
    ['an attempt that is not a count', { attempt: 0 }],
    ['a compactor nobody knows', { compactor: 'model' }],
    ['a file hash that is not a hash', { fileHash: 'abc' }],
    ['a token count that is not whole', { estimatedTokens: 1.5 }],
    ['a taint flag that is not a boolean', { taintsRun: 'yes' }],
    ['an item with a bad hash', { shown: [{ ...ITEM, contentHash: 'abc' }] }],
    ['an item with a negative size', { shown: [{ ...ITEM, bytes: -1 }] }],
    ['an item with an id of 60,000 characters', { shown: [{ ...ITEM, id: 'x'.repeat(60_000) }] }],
    ['an item with an unknown source', { shown: [{ ...ITEM, source: 'worker' }] }],
    ['an item that carries text', { shown: [{ ...ITEM, text: 'the note' }] }],
    ['a withheld item with a free-text code', { withheld: [{ id: 'a', code: 'because I said so' }] }],
  ])('refuses %s', (_name, over) => {
    expect(sealContextLedgerEntry(body(over as Partial<ContextLedgerBody>), 1, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' });
  });

  it('holds a bound on the items an entry names', () => {
    expect(MAX_CONTEXT_LEDGER_ITEMS).toBe(500);
    const many = Array.from({ length: MAX_CONTEXT_LEDGER_ITEMS + 1 }, (_, index) => ({ ...ITEM, id: `.projectops/execution/x${index}.json`, rank: index + 1 }));
    expect(sealContextLedgerEntry(body({ shown: many }), 1, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_BODY_INVALID' });
  });

  it('refuses a place in the chain that is not one', () => {
    expect(sealContextLedgerEntry(body(), 0, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_SEQ_INVALID' });
    expect(sealContextLedgerEntry(body(), 1.5, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_SEQ_INVALID' });
    expect(sealContextLedgerEntry(body(), 1_000_000, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_SEQ_INVALID' });
    expect(sealContextLedgerEntry(body(), 2, 'abc')).toEqual({ ok: false, code: 'CONTEXT_LEDGER_PREV_INVALID' });
    expect(sealContextLedgerEntry(body(), 1, HASH)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_PREV_INVALID' });
    expect(sealContextLedgerEntry(body(), 2, null)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_PREV_INVALID' });
  });

  it('writes and reads an entry back as the same entry, and refuses text over its size before parsing it', () => {
    const entry = chain(1)[0] as ContextLedgerEntry;
    const text = `${JSON.stringify(entry)}\n`;
    expect(parseContextLedgerEntry(text)).toEqual({ ok: true, entry });
    const started = Date.now();
    expect(parseContextLedgerEntry('{'.repeat(MAX_CONTEXT_LEDGER_ENTRY_CHARS + 1))).toEqual({ ok: false, code: 'CONTEXT_LEDGER_ENTRY_INVALID' });
    expect(parseContextLedgerEntry(`${'['.repeat(60_000)}`)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_ENTRY_INVALID' });
    expect(Date.now() - started).toBeLessThan(2000);
    for (const bad of [null, 5, '', 'not json', '[]', '{}', JSON.stringify({ ...entry, entryHash: 'abc' }), JSON.stringify({ ...entry, extra: 1 })]) {
      expect(parseContextLedgerEntry(bad)).toEqual({ ok: false, code: 'CONTEXT_LEDGER_ENTRY_INVALID' });
    }
  });

  it('names its files by number, in one spelling', () => {
    expect(contextLedgerFileName(1)).toBe('000001.json');
    expect(contextLedgerFileName(999_999)).toBe('999999.json');
    for (const bad of [0, -1, 1.5, 1_000_000, Number.NaN, '1', null]) expect(contextLedgerFileName(bad)).toBeNull();
    expect(contextLedgerSeqOfFileName('000042.json')).toBe(42);
    for (const bad of ['42.json', '000042.JSON', '000042.json ', '000000.json', '0000042.json', '../000001.json', '000001.json.tmp', 'a']) {
      expect(contextLedgerSeqOfFileName(bad)).toBeNull();
    }
  });
});
