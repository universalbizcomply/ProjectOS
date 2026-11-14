import { describe, expect, it } from 'vitest';
import {
  DELETION_LEDGER_GENESIS,
  deletionEntryOf,
  deletionEntryFileName,
  verifyDeletionLedger,
  type DeletionRecordFields,
} from '../src/memory/deletionLedger.js';

const fields = (overrides: Partial<DeletionRecordFields> = {}): DeletionRecordFields => ({
  tenant: 'agency-one',
  project: 'alpha-project',
  action: 'memory-delete',
  actionClass: 'P5',
  memoryClass: 'curated-memory',
  path: '.projectops/memory/MEMORY.md',
  itemHash: 'a'.repeat(64),
  reason: 'the entry is wrong',
  outcome: 'refused',
  code: 'DELETE_OWNER_NOT_VERIFIED',
  citedByDecision: false,
  atMs: 1_700_000_000_000,
  ...overrides,
});

const chain = (items: readonly Partial<DeletionRecordFields>[]) => {
  let prev: string = DELETION_LEDGER_GENESIS;
  return items.map((overrides, index) => {
    const entry = deletionEntryOf(fields(overrides), index + 1, prev);
    if (!entry.ok) throw new Error(entry.code);
    prev = entry.entryHash;
    return { name: deletionEntryFileName(index + 1), text: entry.text };
  });
};

describe('every deletion and every refused attempt is recorded, with the item hash and the reason', () => {
  it('writes an entry that carries the item hash, the reason, the action and the outcome, and hashes itself', () => {
    const entry = deletionEntryOf(fields(), 1, DELETION_LEDGER_GENESIS);
    if (!entry.ok) throw new Error(entry.code);
    const parsed = JSON.parse(entry.text) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      seq: 1,
      prevHash: DELETION_LEDGER_GENESIS,
      tenant: 'agency-one',
      project: 'alpha-project',
      action: 'memory-delete',
      actionClass: 'P5',
      path: '.projectops/memory/MEMORY.md',
      itemHash: 'a'.repeat(64),
      reason: 'the entry is wrong',
      outcome: 'refused',
      code: 'DELETE_OWNER_NOT_VERIFIED',
      entryHash: entry.entryHash,
    });
    expect(entry.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(deletionEntryFileName(1)).toBe('0000000001.json');
  });

  it('a refused attempt with no item hash yet (the item was absent) is still recorded, with a null hash', () => {
    const entry = deletionEntryOf(fields({ itemHash: null, code: 'DELETE_ITEM_ABSENT' }), 1, DELETION_LEDGER_GENESIS);
    expect(entry.ok).toBe(true);
  });

  it('an attempt on something that is no memory item is recorded with no class', () => {
    const entry = deletionEntryOf(fields({ memoryClass: null, itemHash: null, code: 'DELETE_NOT_A_MEMORY_ITEM' }), 1, DELETION_LEDGER_GENESIS);
    expect(entry.ok).toBe(true);
    expect(deletionEntryOf(fields({ memoryClass: 'not-a-class' }), 1, DELETION_LEDGER_GENESIS)).toMatchObject({ ok: false });
  });

  it('refuses a record it could not trust: an unknown outcome, a bad hash, a reason with a control character, a time that is not a time', () => {
    for (const bad of [
      fields({ outcome: 'maybe' as never }),
      fields({ itemHash: 'abc' }),
      fields({ reason: 'a\nb' }),
      fields({ reason: '' }),
      fields({ reason: 'x'.repeat(501) }),
      fields({ atMs: Number.NaN }),
      fields({ atMs: -1 }),
      fields({ path: 'a'.repeat(513) }),
      fields({ action: 'memory-wipe' as never }),
      fields({ actionClass: 'P1' as never }),
      { ...fields(), extra: 1 } as never,
      JSON.parse('{"__proto__":{"x":1}}'),
    ]) {
      expect(deletionEntryOf(bad, 1, DELETION_LEDGER_GENESIS)).toMatchObject({ ok: false, code: 'DELETION_RECORD_INVALID' });
    }
    expect(deletionEntryOf(fields(), 0, DELETION_LEDGER_GENESIS)).toMatchObject({ ok: false, code: 'DELETION_RECORD_INVALID' });
    expect(deletionEntryOf(fields(), 1, 'not-a-hash')).toMatchObject({ ok: false, code: 'DELETION_RECORD_INVALID' });
  });
});

describe('the record is append-only: a change is found', () => {
  it('verifies an unbroken chain and names its last hash', () => {
    const files = chain([{ outcome: 'refused' }, { outcome: 'authorised', code: null }, { outcome: 'deleted', code: null }]);
    const verified = verifyDeletionLedger(files);
    expect(verified).toMatchObject({ ok: true, count: 3 });
    expect(verifyDeletionLedger([])).toEqual({ ok: true, count: 0, lastHash: DELETION_LEDGER_GENESIS });
  });

  it('finds an entry whose field was changed after it was written', () => {
    const files = chain([{ outcome: 'refused' }, { outcome: 'deleted', code: null }]);
    const edited = files.map((file, index) => (index === 0 ? { ...file, text: file.text.replace('"refused"', '"deleted"') } : file));
    expect(verifyDeletionLedger(edited)).toMatchObject({ ok: false, code: 'DELETION_LEDGER_ENTRY_ALTERED', seq: 1 });
  });

  it('finds an entry removed from the middle, an entry out of order, and an entry from another chain', () => {
    const files = chain([{ outcome: 'refused' }, { outcome: 'refused' }, { outcome: 'refused' }]);
    expect(verifyDeletionLedger([files[0]!, files[2]!])).toMatchObject({ ok: false, code: 'DELETION_LEDGER_GAP' });
    expect(verifyDeletionLedger([files[1]!, files[0]!, files[2]!])).toMatchObject({ ok: false });
    const other = chain([{ reason: 'another chain entirely' }, { reason: 'and a second' }]);
    expect(verifyDeletionLedger([files[0]!, other[1]!])).toMatchObject({ ok: false, code: 'DELETION_LEDGER_CHAIN_BROKEN' });
  });

  it('finds the first entry deleted, because the second no longer follows the genesis', () => {
    const files = chain([{ outcome: 'refused' }, { outcome: 'refused' }]);
    expect(verifyDeletionLedger([{ name: deletionEntryFileName(1), text: files[1]!.text }])).toMatchObject({ ok: false });
  });

  it('finds an entry whose name and sequence disagree, a name that is not an entry, and text that is not JSON', () => {
    const files = chain([{ outcome: 'refused' }]);
    expect(verifyDeletionLedger([{ name: '0000000002.json', text: files[0]!.text }])).toMatchObject({ ok: false, code: 'DELETION_LEDGER_GAP' });
    expect(verifyDeletionLedger([{ name: 'notes.txt', text: files[0]!.text }])).toMatchObject({ ok: false, code: 'DELETION_LEDGER_ENTRY_INVALID' });
    expect(verifyDeletionLedger([{ name: files[0]!.name, text: '{not json' }])).toMatchObject({ ok: false, code: 'DELETION_LEDGER_ENTRY_INVALID' });
    expect(verifyDeletionLedger([{ name: files[0]!.name, text: JSON.stringify({ ...JSON.parse(files[0]!.text), extra: 1 }) }])).toMatchObject({ ok: false });
  });

  it('a chain of 60,000 characters of text in one entry is refused by size and not parsed', () => {
    const started = Date.now();
    expect(verifyDeletionLedger([{ name: deletionEntryFileName(1), text: 'x'.repeat(60_000) }])).toMatchObject({ ok: false, code: 'DELETION_LEDGER_ENTRY_INVALID' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
