/**
 * THE RESERVATION FOLLOWS THE HOST'S DISPATCH FACT (PROJECTOS-HOST-REVIEW-PATH1A).
 *
 * `settleUnansweredGatekeeperSpend` is what the three compositions now hand the turns. It adds ONE case
 * to the accepted cause-based rule — a Host-stated "nothing was dispatched" — and changes nothing else.
 * These proofs run against the real ledger code on a real disposable directory.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import type { BudgetPolicy } from '@projectos/core';
import { admitGatekeeperSpend, readLedger, settleGatekeeperSpend, settleUnansweredGatekeeperSpend } from '../src/loop/gatekeeperConfig.js';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const BUDGET: BudgetPolicy = { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 };
const REQUEST = { requestId: 'GKREQ-bbbbbbbbbbbbbbbbbbbbbbbb', projectId: 'acme', phaseId: 'ACME-P1A', model: 'test-model', estimateMicroUsd: 8283, at: '2026-09-19T10:00:00.000Z' };

function world(): { root: string; sys: System } {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-host-settle-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops'), { recursive: true });
  const held = new Set<string>();
  const sys: System = {
    cwd: () => root,
    now: () => REQUEST.at,
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(pjoin(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: (p: string) => {
      if (held.has(p)) return false;
      held.add(p);
      return true;
    },
    removeFile: (p: string) => {
      held.delete(p);
      if (existsSync(p)) unlinkSync(p);
      return true;
    },
    renameFile: (from: string, to: string) => {
      renameSync(from, to);
      return true;
    },
    exec: () => ({ code: 1, stdout: '', stderr: '' }),
  };
  return { root, sys };
}

/** On the Host route the agent's broker is never invoked, so its record cannot speak to the request. */
const BROKER_KNOWS_NOTHING = (): 'unknown' => 'unknown';

function reserved(): { root: string; sys: System } {
  const w = world();
  expect(admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () => 'not-answered').allowed).toBe(true);
  expect(readLedger(w.sys, w.root)).toHaveLength(1);
  return w;
}

describe('closing out an unanswered Host review', () => {
  test('the Host says NOTHING WAS DISPATCHED: the estimate is released, whatever the cause and whatever the broker record says', () => {
    for (const cause of ['TRANSPORT_UNREACHABLE', 'TRANSPORT_NOT_APPROVED', 'CREDENTIAL_UNAVAILABLE']) {
      const w = reserved();
      settleUnansweredGatekeeperSpend(w.sys, w.root, REQUEST.requestId, cause, false, BROKER_KNOWS_NOTHING);
      expect(readLedger(w.sys, w.root), cause).toEqual([]);
    }
  });

  test('the Host says a provider MAY have been reached: the estimate is RETAINED, even under a never-dispatched cause', () => {
    for (const cause of ['PROVIDER_UNAVAILABLE', 'CREDENTIAL_UNAVAILABLE', 'TRANSPORT_NOT_CONFIGURED']) {
      const w = reserved();
      settleUnansweredGatekeeperSpend(w.sys, w.root, REQUEST.requestId, cause, true, () => 'not-answered');
      expect(readLedger(w.sys, w.root), cause).toHaveLength(1);
    }
  });

  test('NO dispatch fact was stated (every non-Host route): the accepted cause-based rule, unchanged', () => {
    const released = reserved();
    settleUnansweredGatekeeperSpend(released.sys, released.root, REQUEST.requestId, 'CREDENTIAL_UNAVAILABLE', undefined, () => 'not-answered');
    expect(readLedger(released.sys, released.root)).toEqual([]);

    const retained = reserved();
    settleUnansweredGatekeeperSpend(retained.sys, retained.root, REQUEST.requestId, 'PROVIDER_UNAVAILABLE', undefined, () => 'not-answered');
    expect(readLedger(retained.sys, retained.root)).toHaveLength(1);

    const unknown = reserved();
    settleUnansweredGatekeeperSpend(unknown.sys, unknown.root, REQUEST.requestId, 'CREDENTIAL_UNAVAILABLE', undefined, BROKER_KNOWS_NOTHING);
    expect(readLedger(unknown.sys, unknown.root)).toHaveLength(1);
  });

  test('AN ENTRY CARRYING RECORDED USAGE IS NEVER RELEASED, even when a later attempt provably dispatched nothing', () => {
    const w = reserved();
    const [reservation] = readLedger(w.sys, w.root);
    settleGatekeeperSpend(w.sys, w.root, REQUEST.requestId, {
      ...reservation!,
      usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 },
      costMicroUsd: 2250,
    });
    settleUnansweredGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'TRANSPORT_UNREACHABLE', false, BROKER_KNOWS_NOTHING);
    const [kept] = readLedger(w.sys, w.root);
    expect(kept?.usage).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
    expect(kept?.costMicroUsd).toBe(2250);
  });
});
