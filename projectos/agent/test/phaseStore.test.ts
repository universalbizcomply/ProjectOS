/**
 * A phase id becomes a filename, so the store is where that has to be safe.
 *
 * THE DEFECT. The plan schema constrains `phaseId` to a non-empty string and nothing more; `join`
 * in `context.ts` is a naive concatenation that neither normalises nor rejects a parent-directory
 * segment; and `System.writeText` creates whatever directory it is handed. An owner-approved plan
 * carrying `..` in a phase id was therefore an arbitrary local file write. The project already had
 * exactly this guard for closure waits, owner-gate receipts and degraded grants — the one place it
 * was missing was the store every phase record goes through.
 *
 * AND `JSON.parse(...) as Phase` IS AN ASSERTION, NOT A CHECK. A record with an unrecognised status
 * made `isTerminal` read a property off `undefined`; one with no `history` made a transition spread
 * a non-iterable. Both threw out of an unattended run, from inside bookkeeping that promises never
 * to fail one.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import { loadPhase, savePhase, listPhaseIds, isSafePhaseId } from '../src/phaseStore.js';
import type { System } from '../src/system.js';
import type { Phase } from '@projectos/core';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

function world(): { root: string; sys: System } {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-phasestore-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops', 'phases'), { recursive: true });
  const sys: System = {
    cwd: () => root,
    now: () => '2026-09-04T12:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => { mkdirSync(pjoin(p, '..'), { recursive: true }); writeFileSync(p, c); },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: () => ({ code: 1, stdout: '', stderr: '' }),
  };
  return { root, sys };
}

function phase(phaseId: string): Phase {
  return { phaseId, project: 'ProjectOS', objective: 'o', status: 'draft', history: [] };
}

describe('a phase id that cannot safely be a filename is refused', () => {
  test('the traversal shapes are all rejected', () => {
    for (const bad of ['../escape', '..', '../../etc/passwd', 'a/b', 'a\\b', 'has space', 'a.b', '', 'ab']) {
      expect(isSafePhaseId(bad)).toBe(false);
    }
  });

  test('the ids this project actually uses are accepted', () => {
    for (const good of ['validation-cache', 'doctor-preflight', 'PROJECTOS-SESSION-RECOVERY1A', 'a_b-C9']) {
      expect(isSafePhaseId(good)).toBe(true);
    }
  });

  test('savePhase writes NOTHING and says so, rather than escaping the phases directory', () => {
    const w = world();
    expect(savePhase(w.sys, w.root, phase('../../pwned'))).toBe(false);
    expect(readdirSync(pjoin(w.root, '.projectops', 'phases'))).toEqual([]);
    expect(existsSync(pjoin(w.root, '..', 'pwned.json'))).toBe(false);
  });

  test('loadPhase does not even read through an unsafe id', () => {
    const w = world();
    expect(loadPhase(w.sys, w.root, '../../anything')).toBeNull();
  });

  test('a safe id still round-trips', () => {
    const w = world();
    expect(savePhase(w.sys, w.root, phase('validation-cache'))).toBe(true);
    expect(loadPhase(w.sys, w.root, 'validation-cache')?.phaseId).toBe('validation-cache');
  });

  test('listPhaseIds never offers an id it would refuse to read', () => {
    const w = world();
    writeFileSync(pjoin(w.root, '.projectops', 'phases', 'ok-phase.json'), JSON.stringify(phase('ok-phase')));
    writeFileSync(pjoin(w.root, '.projectops', 'phases', 'no.json'), JSON.stringify(phase('no')));
    expect(listPhaseIds(w.sys, w.root)).toEqual(['ok-phase']);
  });
});

describe('a record that is not a phase is unreadable, not trusted', () => {
  test('an unrecognised status is rejected', () => {
    const w = world();
    writeFileSync(
      pjoin(w.root, '.projectops', 'phases', 'bad-status.json'),
      JSON.stringify({ phaseId: 'bad-status', project: 'X', objective: 'o', status: 'nonsense', history: [] }),
    );
    expect(loadPhase(w.sys, w.root, 'bad-status')).toBeNull();
  });

  test('a missing or non-array history is rejected', () => {
    const w = world();
    writeFileSync(
      pjoin(w.root, '.projectops', 'phases', 'no-history.json'),
      JSON.stringify({ phaseId: 'no-history', project: 'X', objective: 'o', status: 'draft' }),
    );
    expect(loadPhase(w.sys, w.root, 'no-history')).toBeNull();
  });

  test('a non-object, an array and unparseable bytes are all rejected', () => {
    const w = world();
    const dir = pjoin(w.root, '.projectops', 'phases');
    writeFileSync(pjoin(dir, 'scalar-one.json'), '42');
    writeFileSync(pjoin(dir, 'array-one.json'), '[]');
    writeFileSync(pjoin(dir, 'broken-one.json'), '{ not json');
    for (const id of ['scalar-one', 'array-one', 'broken-one']) {
      expect(loadPhase(w.sys, w.root, id)).toBeNull();
    }
  });

  test('a well-formed record is still read', () => {
    const w = world();
    savePhase(w.sys, w.root, phase('good-phase'));
    expect(loadPhase(w.sys, w.root, 'good-phase')?.status).toBe('draft');
  });
});
