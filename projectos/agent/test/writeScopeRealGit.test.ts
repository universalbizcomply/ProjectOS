/**
 * The scope snapshot against REAL git, in a throwaway repository. PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.
 *
 * The adapter's own tests use a fake git, which proves the logic and nothing about git. The independent review
 * reproduced, with real git, changes the first build could not see (ignored paths, a non-ASCII name, a commit, a
 * skip-worktree flag, an exclude pattern, the origin of a rename) and a filter driver that ran inside the check.
 * Each is replayed here. No worker, no provider, no network: git only, in a temporary directory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeSystem } from '../src/system.js';
import {
  INDEX_FLAG_PREFIX,
  REPOSITORY_CONFIGURATION,
  REPOSITORY_EXCLUDES,
  REPOSITORY_HEAD,
  candidateSnapshot,
  scopeBreaches,
} from '../src/loop/writeScope.js';

let root = '';
let outside = '';
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (rel: string, content: string) => {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
};
const SCOPES = ['src/feature.ts', 'docs'];

/** Snapshot, let "the worker" act, snapshot again, and return what lies outside the scopes. */
function breachesAfter(act: () => void): readonly string[] {
  const before = candidateSnapshot(nodeSystem, root);
  expect(before).not.toBeNull();
  act();
  const after = candidateSnapshot(nodeSystem, root);
  expect(after).not.toBeNull();
  return scopeBreaches(before as never, after as never, SCOPES);
}

beforeEach(() => {
  outside = mkdtempSync(join(tmpdir(), 'projectos-scope-'));
  root = join(outside, 'repo');
  mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  git('config', 'user.email', 'test@projectos.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  write('.gitignore', 'node_modules/\n.env\n*token*\n.projectops/continuity/\n');
  write('src/feature.ts', 'one\n');
  write('src/other.ts', 'one\n');
  write('docs/plain.md', 'one\n');
  write('.env', 'SECRET=1\n');
  write('.projectops/continuity/owner-control.json', '{"stop":false}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});

afterEach(() => {
  rmSync(outside, { recursive: true, force: true });
});

describe('the scope snapshot with real git', () => {
  it('reports nothing when nothing changed, and nothing for a write inside the scopes', () => {
    expect(breachesAfter(() => undefined)).toEqual([]);
    expect(breachesAfter(() => { write('src/feature.ts', 'two\n'); write('docs/new.md', 'x\n'); })).toEqual([]);
  });

  it('sees a tracked change, a new file and a deletion outside the scopes', () => {
    const out = breachesAfter(() => {
      write('src/other.ts', 'two\n');
      write('validators/x.cjs', 'x\n');
      rmSync(join(root, 'docs/plain.md'));
      write('docs/plain.md', 'changed inside scope\n');
    });
    expect(out).toEqual(['src/other.ts', 'validators/x.cjs']);
  });

  it('sees new git-ignored paths, and an edit to an existing ignored file', () => {
    const out = breachesAfter(() => {
      write('node_modules/x/i.js', 'planted\n');
      write('src/my-token.ts', 'x\n');
      write('.env', 'SECRET=2\n');
      write('.projectops/continuity/owner-control.json', '{"stop":true}\n');
    });
    expect(out).toContain('node_modules/');
    expect(out).toContain('src/my-token.ts');
    expect(out).toContain('.env');
    expect(out).toContain('.projectops/continuity/owner-control.json');
  });

  it('reads a non-ASCII name as it is, and sees a second edit to an already dirty file of that name', () => {
    write('src/café ü.md', 'one\n');
    const out = breachesAfter(() => write('src/café ü.md', 'two\n'));
    expect(out).toEqual(['src/café ü.md']);
  });

  it('sees a commit, a skip-worktree flag and an exclude pattern, each of which empties status', () => {
    expect(breachesAfter(() => { write('src/other.ts', 'committed\n'); git('commit', '-q', '-am', 'hidden'); })).toContain(REPOSITORY_HEAD);
    expect(breachesAfter(() => { git('update-index', '--skip-worktree', 'src/other.ts'); write('src/other.ts', 'flagged\n'); })).toContain(`${INDEX_FLAG_PREFIX}src/other.ts`);
    expect(breachesAfter(() => { writeFileSync(join(root, '.git/info/exclude'), 'hidden-*\n'); write('hidden-x.txt', 'x\n'); })).toContain(REPOSITORY_EXCLUDES);
  });

  it('counts the origin of a staged rename as a removal, even when the new path is in scope', () => {
    const out = breachesAfter(() => git('mv', 'src/other.ts', 'docs/moved.ts'));
    expect(out).toContain('src/other.ts');
    expect(out).not.toContain('docs/moved.ts');
  });

  it('does not run a filter driver the worker configured, and reports the configuration and the attributes', () => {
    const marker = join(outside, 'marker.txt');
    const out = breachesAfter(() => {
      // Node, not a shell: the driver must be something this machine can certainly run, so a missing marker means "not run".
      const driver = `"${process.execPath.replace(/\\/g, '/')}" -e "require('fs').appendFileSync(process.argv[1],'x');process.stdin.pipe(process.stdout)" "${marker.replace(/\\/g, '/')}"`;
      git('config', 'filter.evil.clean', driver);
      write('.gitattributes', '* filter=evil\n');
      write('src/other.ts', 'two\n');
    });
    expect(existsSync(marker)).toBe(false);
    expect(out).toContain(REPOSITORY_CONFIGURATION);
    expect(out).toContain('.gitattributes');
    expect(out).toContain('src/other.ts');
  });

  it('treats agent control paths as out of scope beneath a directory grant', () => {
    const out = breachesAfter(() => { write('docs/.codex/config.toml', 'x\n'); write('docs/AGENTS.override.md', 'x\n'); write('docs/ok.md', 'x\n'); });
    expect(out).toEqual(['docs/.codex/config.toml', 'docs/AGENTS.override.md']);
  });

  it('refuses to answer for a directory that is not a repository', () => {
    expect(candidateSnapshot(nodeSystem, outside)).toBeNull();
  });
});
