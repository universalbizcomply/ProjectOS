/**
 * Reading a gate receipt from git, and the four ways a file on disk is not one.
 *
 * The path tests are not cosmetic. This project's `.gitignore` excludes `secret*` and `*token*`, and
 * `secrets-handling` is a real owner gate in the active plan — so a per-phase directory layout would
 * produce a receipt git silently ignores, and the owner would commit and see nothing.
 */
import { describe, it, expect } from 'vitest';
import type { System } from '../src/system.js';
import {
  ownerGateReceiptRelPath,
  ownerGateReceiptPath,
  isSafeGateName,
  receiptIsCommitted,
  readCommittedReceipt,
  readCommittedReceipts,
} from '../src/loop/ownerGateReceipts.js';

const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const ROOT = 'C:/dev/ProjectOS';

/** A git that answers exactly what the test says and records what it was asked. */
function fakeGit(responses: Record<string, { code: number; stdout: string }>): {
  sys: System;
  calls: string[][];
} {
  const calls: string[][] = [];
  const sys = {
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      const verb = args.includes('log') ? 'log' : args.includes('diff') ? 'diff' : 'show';
      const answer = responses[verb] ?? { code: 1, stdout: '' };
      return { code: answer.code, stdout: answer.stdout, stderr: '' };
    },
  } as unknown as System;
  return { sys, calls };
}

const COMMITTED = {
  log: { code: 0, stdout: 'abc1234\n' },
  diff: { code: 0, stdout: '' },
  show: { code: 0, stdout: JSON.stringify({ schemaVersion: '1.0.0', gateName: 'commit' }) },
};

describe('the receipt path', () => {
  it('is flat, so git does not silently ignore a secrets gate', () => {
    expect(ownerGateReceiptRelPath(PHASE, 'secrets-handling')).toBe(
      `.projectops/gates/${PHASE}.secrets-handling.json`,
    );
    expect(ownerGateReceiptRelPath(PHASE, 'secrets-handling')).not.toContain('/secrets-handling.json');
  });

  it('builds an absolute path under the governed root', () => {
    expect(ownerGateReceiptPath(ROOT, PHASE, 'commit')).toContain('gates');
    expect(ownerGateReceiptPath(ROOT, PHASE, 'commit')).toContain(`${PHASE}.commit.json`);
  });

  it.each(['../escape', 'a/b', 'a\\b', '', 'x', 'has space', 'name.with.dots', 'a'.repeat(65)])(
    'refuses %s as a gate name rather than sanitising it',
    (gateName) => {
      expect(isSafeGateName(gateName)).toBe(false);
      expect(ownerGateReceiptRelPath(PHASE, gateName)).toBeNull();
      expect(ownerGateReceiptPath(ROOT, PHASE, gateName)).toBeNull();
    },
  );

  it.each(['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'])(
    'accepts the real gate name %s',
    (gateName) => {
      expect(isSafeGateName(gateName)).toBe(true);
      expect(ownerGateReceiptRelPath(PHASE, gateName)).not.toBeNull();
    },
  );

  it('refuses a phase id that could not safely become a filename', () => {
    expect(ownerGateReceiptRelPath('../../etc', 'commit')).toBeNull();
  });
});

describe('is the receipt committed', () => {
  it('accepts a committed, unmodified receipt', () => {
    const { sys } = fakeGit(COMMITTED);
    expect(receiptIsCommitted(sys, ROOT, PHASE, 'commit')).toBe(true);
  });

  it('refuses a receipt git has never seen', () => {
    const { sys } = fakeGit({ ...COMMITTED, log: { code: 0, stdout: '' } });
    expect(receiptIsCommitted(sys, ROOT, PHASE, 'commit')).toBe(false);
  });

  // A COMMITTED RECEIPT EDITED SINCE would otherwise let the committed version launder the change.
  it('refuses a committed receipt that has been edited in the working tree', () => {
    const { sys } = fakeGit({ ...COMMITTED, diff: { code: 0, stdout: '.projectops/gates/x.json\n' } });
    expect(receiptIsCommitted(sys, ROOT, PHASE, 'commit')).toBe(false);
  });

  it('refuses when git itself fails, rather than assuming', () => {
    expect(receiptIsCommitted(fakeGit({ ...COMMITTED, log: { code: 128, stdout: '' } }).sys, ROOT, PHASE, 'commit')).toBe(false);
    expect(receiptIsCommitted(fakeGit({ ...COMMITTED, diff: { code: 128, stdout: '' } }).sys, ROOT, PHASE, 'commit')).toBe(false);
  });

  it('refuses an unsafe gate name without invoking git at all', () => {
    const { sys, calls } = fakeGit(COMMITTED);
    expect(receiptIsCommitted(sys, ROOT, PHASE, '../escape')).toBe(false);
    expect(calls).toEqual([]);
  });

  // THE PACKAGED DAEMON HAS NO USEFUL WORKING DIRECTORY. Ambient-cwd git has failed closed here before.
  it('binds git to the governed root on every invocation', () => {
    const { sys, calls } = fakeGit(COMMITTED);
    receiptIsCommitted(sys, ROOT, PHASE, 'commit');
    readCommittedReceipt(sys, ROOT, PHASE, 'commit');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.slice(0, 3)).toEqual(['git', '-C', ROOT]);
    }
  });
});

describe('reading the committed bytes', () => {
  it('reads from the git object, not the working tree', () => {
    const { sys, calls } = fakeGit(COMMITTED);
    expect(readCommittedReceipt(sys, ROOT, PHASE, 'commit')).toEqual({ schemaVersion: '1.0.0', gateName: 'commit' });
    expect(calls.some((c) => c.includes('show') && c.some((a) => a.startsWith('HEAD:')))).toBe(true);
  });

  it('returns null on unparseable content rather than guessing', () => {
    const { sys } = fakeGit({ ...COMMITTED, show: { code: 0, stdout: 'not json' } });
    expect(readCommittedReceipt(sys, ROOT, PHASE, 'commit')).toBeNull();
  });

  it('returns null when the object is an array or a scalar', () => {
    for (const stdout of ['[]', '"a string"', '42', 'null']) {
      const { sys } = fakeGit({ ...COMMITTED, show: { code: 0, stdout } });
      expect(readCommittedReceipt(sys, ROOT, PHASE, 'commit')).toBeNull();
    }
  });

  it('returns null when git cannot show the path', () => {
    const { sys } = fakeGit({ ...COMMITTED, show: { code: 128, stdout: '' } });
    expect(readCommittedReceipt(sys, ROOT, PHASE, 'commit')).toBeNull();
  });
});

describe('reading every gate at once', () => {
  it('returns one entry per required gate', () => {
    const { sys } = fakeGit(COMMITTED);
    const map = readCommittedReceipts(sys, ROOT, PHASE, ['commit', 'push']);
    expect([...map.keys()]).toEqual(['commit', 'push']);
    expect(map.get('commit')).not.toBeNull();
  });

  it('maps an uncommitted gate to null rather than omitting it', () => {
    const { sys } = fakeGit({ ...COMMITTED, log: { code: 0, stdout: '' } });
    const map = readCommittedReceipts(sys, ROOT, PHASE, ['commit']);
    expect(map.has('commit')).toBe(true);
    expect(map.get('commit')).toBeNull();
  });

  it('returns an empty map when the plan requires no owner gate', () => {
    const { sys } = fakeGit(COMMITTED);
    expect(readCommittedReceipts(sys, ROOT, PHASE, []).size).toBe(0);
  });
});
