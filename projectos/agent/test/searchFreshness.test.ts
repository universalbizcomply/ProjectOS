import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderUntrustedExcerpt, type CitedSearchHit } from '@projectos/core';
import { SEARCH_SCHEMA_VERSION, openSearchIndex, type SearchIndex, type SearchOutcome } from '../src/search/localIndex.js';
import { gitRunnerOver, searchHeadOver, type GitRunner, type SearchClock, type SearchHead } from '../src/search/ports.js';

const TENANT = 'agency-one';
const PROJECT = 'alpha-project';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const clock: SearchClock = { nowMs: () => 1000 };

let dir: string;
const opened: SearchIndex[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'projectos-fresh-'));
});
afterEach(() => {
  for (const index of opened.splice(0)) index.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A head that answers what `commit.value` holds, and counts how often it is asked. */
const headOf = (initial: string | null) => {
  const state = { value: initial, asked: 0 };
  const head: SearchHead = {
    headCommit: () => {
      state.asked += 1;
      return state.value;
    },
  };
  return { state, head };
};

const open = (head?: SearchHead, location = ':memory:'): SearchIndex => {
  const index = openSearchIndex(location, { owner: { tenant: TENANT, project: PROJECT }, clock, ...(head === undefined ? {} : { head }) });
  opened.push(index);
  return index;
};

const sources = [{ project: PROJECT, source: 'documents' as const, path: 'docs/guide.md', content: '# Guide\n\nThe walnut plan is final.\n' }];

const hitsOf = (outcome: SearchOutcome): readonly CitedSearchHit[] => {
  if (!outcome.ok) throw new Error(`search refused: ${outcome.reason}`);
  return outcome.hits;
};

const search = (index: SearchIndex) => hitsOf(index.search({ project: PROJECT, query: 'walnut' }));

/** The way a caller builds: HEAD first, then the sources, then the build with the commit it took first. */
const rebuilt = (index: SearchIndex) => index.rebuildProject(PROJECT, sources, { builtAtCommit: index.currentHead() });

describe('a citation from an index built before HEAD is marked stale', () => {
  it('records the commit the index was built at, and a citation from it is fresh while HEAD has not moved', () => {
    const { head } = headOf(A);
    const index = open(head);
    expect(rebuilt(index).ok).toBe(true);
    const hits = search(index);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.citation.freshness).toEqual({ state: 'fresh' });
  });

  it('marks the citation stale when HEAD has moved, and still returns it with its text', () => {
    const { head, state } = headOf(A);
    const index = open(head);
    rebuilt(index);
    state.value = B;
    const hits = search(index);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'head-moved' });
    expect(hits[0]?.untrustedText).toContain('walnut');
  });

  it('a rebuild at the new HEAD makes it fresh again', () => {
    const { head, state } = headOf(A);
    const index = open(head);
    rebuilt(index);
    state.value = B;
    rebuilt(index);
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'fresh' });
  });

  it('asks for HEAD at each search, so a commit made after the first search is seen by the second', () => {
    const { head, state } = headOf(A);
    const index = open(head);
    rebuilt(index);
    expect(search(index)[0]?.citation.freshness?.state).toBe('fresh');
    state.value = B;
    expect(search(index)[0]?.citation.freshness?.state).toBe('stale');
  });

  it('an index opened with no head port marks every citation stale, never fresh', () => {
    const index = open();
    rebuilt(index);
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'head-unknown' });
  });

  it.each([
    ['a null', null],
    ['text that is not a commit', 'HEAD'],
    ['an upper-case spelling', A.toUpperCase()],
    ['a name with a newline', `${A}\n`],
  ])('an index built when HEAD answered %s is stale, even when HEAD is readable later', (_name, answered) => {
    const { head, state } = headOf(answered);
    const index = open(head);
    rebuilt(index);
    state.value = A;
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'built-commit-unknown' });
  });

  it('a head that throws, or answers something that is not a commit, marks the citation stale and does not break the search', () => {
    let answer: () => string | null = () => A;
    const index = open({ headCommit: () => answer() });
    rebuilt(index);
    answer = () => {
      throw new Error('git is gone');
    };
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'head-unknown' });
    answer = () => 'not a commit' as never;
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'head-unknown' });
    answer = () => 7 as never;
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'head-unknown' });
  });

  it('a head that throws while the index is built is recorded as unknown, and the rebuild still succeeds', () => {
    const index = open({
      headCommit: () => {
        throw new Error('git is gone');
      },
    });
    expect(index.rebuildProject(PROJECT, sources).ok).toBe(true);
  });

  it('every hit of one search carries the same mark', () => {
    const { head, state } = headOf(A);
    const index = open(head);
    index.rebuildProject(PROJECT, [
      ...sources,
      { project: PROJECT, source: 'documents' as const, path: 'docs/second.md', content: 'Another walnut note.\n' },
    ]);
    state.value = B;
    const hits = search(index);
    expect(hits.length).toBeGreaterThan(1);
    expect(new Set(hits.map((hit) => hit.citation.freshness?.state))).toEqual(new Set(['stale']));
  });

  it('a stale hit is rendered with its mark, and the mark is not in the indexed text', () => {
    const { head, state } = headOf(A);
    const index = open(head);
    rebuilt(index);
    state.value = B;
    const rendered = renderUntrustedExcerpt(search(index)[0] as CitedSearchHit);
    expect(rendered).toContain('freshness=stale:head-moved');
  });
});

describe('the commit recorded is the one taken BEFORE the sources were collected', () => {
  it('a commit made while the sources were being collected leaves the index stale, not fresh', () => {
    const { head, state } = headOf(A);
    const index = open(head);
    const before = index.currentHead();
    expect(before).toBe(A);
    state.value = B;
    index.rebuildProject(PROJECT, sources, { builtAtCommit: before });
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'head-moved' });
  });

  it('does not ask HEAD again at build time: the value it is given is the one recorded', () => {
    const { head, state } = headOf(A);
    const index = open(head);
    const before = index.currentHead();
    const asked = state.asked;
    index.rebuildProject(PROJECT, sources, { builtAtCommit: before });
    expect(state.asked).toBe(asked);
  });

  it('a build given no commit records none, so every citation reads built-commit-unknown, never fresh', () => {
    const { head } = headOf(A);
    const index = open(head);
    index.rebuildProject(PROJECT, sources);
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'built-commit-unknown' });
  });

  it.each([['HEAD'], [A.toUpperCase()], [`${A}\n`], [7], [{}]])('a commit that is %j is recorded as none', (given) => {
    const { head } = headOf(A);
    const index = open(head);
    index.rebuildProject(PROJECT, sources, { builtAtCommit: given as never });
    expect(search(index)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'built-commit-unknown' });
  });

  it('currentHead says what the head port says, and null when it has none, throws or answers something else', () => {
    expect(open(headOf(A).head).currentHead()).toBe(A);
    expect(open().currentHead()).toBeNull();
    expect(open({ headCommit: () => { throw new Error('gone'); } }).currentHead()).toBeNull();
    expect(open(headOf('HEAD').head).currentHead()).toBeNull();
  });
});

describe('the index file records the commit, and a file from before this phase gains the column', () => {
  it('keeps schema version 2, with the build commit beside the build time', () => {
    expect(SEARCH_SCHEMA_VERSION).toBe(2);
    const location = join(dir, 'idx.sqlite');
    const { head } = headOf(A);
    const index = open(head, location);
    rebuilt(index);
    index.close();
    const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
    const db: DatabaseSync = new Database(location);
    try {
      expect(db.prepare('SELECT built_at_commit AS built FROM search_projects').get()).toEqual({ built: A });
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
    } finally {
      db.close();
    }
  });

  it('a file made before the column existed gets it on open, keeps its rows, and reads stale until it is rebuilt', () => {
    const location = join(dir, 'old.sqlite');
    const { head } = headOf(A);
    const first = open(head, location);
    rebuilt(first);
    first.close();
    const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
    const old: DatabaseSync = new Database(location);
    old.exec('ALTER TABLE search_projects DROP COLUMN built_at_commit');
    old.close();
    const reopened = open(head, location);
    expect(reopened.statusOf(PROJECT)).toBe('current');
    expect(search(reopened)).toHaveLength(1);
    expect(search(reopened)[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'built-commit-unknown' });
    rebuilt(reopened);
    expect(search(reopened)[0]?.citation.freshness).toEqual({ state: 'fresh' });
  });

  it('a rebuild that stops before the commit is recorded reads as unknown, which is stale', () => {
    const location = join(dir, 'half.sqlite');
    const { head } = headOf(A);
    const index = open(head, location);
    rebuilt(index);
    index.close();
    const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
    const db: DatabaseSync = new Database(location);
    db.exec('UPDATE search_projects SET built_at_commit = NULL');
    db.close();
    expect(search(open(head, location))[0]?.citation.freshness).toEqual({ state: 'stale', reason: 'built-commit-unknown' });
  });
});

describe('the head port reads HEAD through git, and nothing else', () => {
  const runner = (answers: Record<string, { code: number | null; stdout: string }>) => {
    const calls: (readonly string[])[] = [];
    const git: GitRunner = (args) => {
      calls.push(args);
      return answers[args.join(' ')] ?? { code: 1, stdout: '' };
    };
    return { calls, git };
  };

  it('asks `rev-parse --verify HEAD` and answers the trimmed commit', () => {
    const { git, calls } = runner({ 'rev-parse --verify HEAD': { code: 0, stdout: `${A}\n` } });
    expect(searchHeadOver(git).headCommit()).toBe(A);
    expect(calls).toEqual([['rev-parse', '--verify', 'HEAD']]);
  });

  it.each([
    ['git failed', { code: 128, stdout: '' }],
    ['no status', { code: null, stdout: A }],
    ['empty output', { code: 0, stdout: '' }],
    ['output that is not a commit', { code: 0, stdout: 'HEAD\n' }],
    ['two lines', { code: 0, stdout: `${A}\n${B}\n` }],
  ])('answers null when %s', (_name, result) => {
    const { git } = runner({ 'rev-parse --verify HEAD': result });
    expect(searchHeadOver(git).headCommit()).toBeNull();
  });

  it('answers null, and does not throw, when git cannot be run at all', () => {
    const head = searchHeadOver(() => {
      throw new Error('spawn failed');
    });
    expect(head.headCommit()).toBeNull();
  });

  it('runs git with replacement objects off and the root named, with no shell, through the system port only', () => {
    const seen: { cmd: string; args: readonly string[]; options: unknown }[] = [];
    const system = {
      exec: (cmd: string, args: readonly string[], options?: unknown) => {
        seen.push({ cmd, args, options });
        return { code: 0, stdout: `${A}\n` };
      },
    };
    const git = gitRunnerOver(system, '/work/project');
    expect(git(['rev-parse', '--verify', 'HEAD'])).toEqual({ code: 0, stdout: `${A}\n` });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.cmd).toBe('git');
    expect(seen[0]?.args).toEqual(['--no-replace-objects', '-C', '/work/project', 'rev-parse', '--verify', 'HEAD']);
    expect(seen[0]?.options).toMatchObject({ maxOutputBytes: expect.any(Number) });
  });

  it('turns a throw from the system into a failed result', () => {
    const git = gitRunnerOver(
      {
        exec: () => {
          throw new Error('x');
        },
      },
      '/work/project',
    );
    expect(git(['status'])).toEqual({ code: null, stdout: '' });
  });
});
