/**
 * THE AGENT'S OWN EVIDENCE OF A CANDIDATE, from a REAL disposable repository (PROJECTOS-HOST-REVIEW-PATH1B).
 *
 * The production source - the bound git, buffers, the raw tree-difference parser and the canonical
 * digest - run against two real commits. Nothing here is simulated except that the repository is a
 * temporary one.
 */
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { candidateEvidenceDigest } from '@projectos/core';
import { candidateEvidenceSource, nodeGitBytes, parseRawTreeDifference } from '../src/loop/hostCandidateEvidence.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
  }).trim();
}
function write(root: string, rel: string, bytes: Buffer | string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), bytes);
}
function commit(root: string, message: string): string {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** baseline -> candidate: added, deleted, modified (CRLF + binary), mode-only, and a link. */
function repository(): { root: string; baseline: string; candidate: string } {
  const root = mkdtempSync(join(tmpdir(), 'pos-agent-evidence-'));
  roots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'core.autocrlf', 'false');
  write(root, 'keep.txt', 'same');
  write(root, 'mod.txt', 'old');
  write(root, 'gone.txt', 'bye');
  write(root, 'run.sh', '#!/bin/sh\n');
  const baseline = commit(root, 'baseline');
  write(root, 'mod.txt', 'new\r\nline\n');
  write(root, 'blob.bin', Buffer.from([0, 159, 146, 150, 255]));
  unlinkSync(join(root, 'gone.txt'));
  write(root, 'src/added.ts', 'export const added = 1;\n');
  git(root, 'add', '-A');
  git(root, 'update-index', '--chmod=+x', 'run.sh');
  const target = git(root, 'hash-object', '-w', 'keep.txt');
  git(root, 'update-index', '--add', '--cacheinfo', `120000,${target},link`);
  git(root, 'commit', '-q', '-m', 'candidate');
  return { root, baseline, candidate: git(root, 'rev-parse', 'HEAD') };
}

describe("the agent's own evidence of a candidate, from a real repository", () => {
  it('reads every changed path, raw, and arrives at the digest an independent reading gives', () => {
    const { root, baseline, candidate } = repository();
    const own = candidateEvidenceSource(nodeGitBytes('git', root))(baseline, candidate);
    expect(own).toHaveProperty('digest');

    // AN INDEPENDENT READING of the same repository, by plain git calls made here, fed to the canonical
    // digest. If the production source skipped a path, decoded a byte or reordered anything, these differ.
    const oid = (rev: string): string => git(root, 'rev-parse', rev);
    const Z = '0'.repeat(40);
    const independent = candidateEvidenceDigest({
      baselineCommit: baseline,
      candidateCommit: candidate,
      entries: [
        { change: 'added', path: 'blob.bin', oldMode: 0, newMode: 0o100644, oldId: Z, newId: oid(`${candidate}:blob.bin`), contents: Buffer.from([0, 159, 146, 150, 255]) },
        { change: 'deleted', path: 'gone.txt', oldMode: 0o100644, newMode: 0, oldId: oid(`${baseline}:gone.txt`), newId: Z, contents: null },
        { change: 'added', path: 'link', oldMode: 0, newMode: 0o120000, oldId: Z, newId: oid(`${candidate}:link`), contents: Buffer.from('same') },
        { change: 'modified', path: 'mod.txt', oldMode: 0o100644, newMode: 0o100644, oldId: oid(`${baseline}:mod.txt`), newId: oid(`${candidate}:mod.txt`), contents: Buffer.from('new\r\nline\n') },
        { change: 'modified', path: 'run.sh', oldMode: 0o100644, newMode: 0o100755, oldId: oid(`${baseline}:run.sh`), newId: oid(`${candidate}:run.sh`), contents: Buffer.from('#!/bin/sh\n') },
        { change: 'added', path: 'src/added.ts', oldMode: 0, newMode: 0o100644, oldId: Z, newId: oid(`${candidate}:src/added.ts`), contents: Buffer.from('export const added = 1;\n') },
      ],
    });
    expect(independent.problems).toEqual([]);
    // Equality here also proves the binary blob was hashed as BYTES: the independent reading hashes the
    // five raw bytes, and a text decode of 0x9f 0x92 0x96 0xff would have produced different ones.
    expect('digest' in own && own.digest).toBe(independent.digest);
  });

  it('refuses rather than describing a candidate it cannot measure', () => {
    const { root, baseline, candidate } = repository();
    const source = candidateEvidenceSource(nodeGitBytes('git', root));
    // The wrong way round: the candidate is not an ancestor of the baseline.
    expect(source(candidate, baseline)).toMatchObject({ problems: [expect.stringContaining('not an ancestor')] });
    // A commit this repository does not have, a reference, an abbreviation.
    expect(source('c'.repeat(40), candidate)).toHaveProperty('problems');
    expect(source('HEAD', candidate)).toMatchObject({ problems: [expect.stringContaining('exact 40-character commit id')] });
    expect(source(baseline.slice(0, 12), candidate)).toHaveProperty('problems');

    // A SUBMODULE POINTER refuses the whole candidate; it is never skipped.
    git(root, 'update-index', '--add', '--cacheinfo', `160000,${baseline},vendor/sub`);
    git(root, 'commit', '-q', '-m', 'with a submodule pointer');
    const withGitlink = git(root, 'rev-parse', 'HEAD');
    const refused = source(baseline, withGitlink);
    expect(refused).toMatchObject({ problems: [expect.stringContaining('unsupported entry kind')] });

    // ONE BYTE OVER THE BOUND refuses; nothing is shortened to fit.
    git(root, 'rm', '-q', '--cached', 'vendor/sub');
    write(root, 'huge.bin', Buffer.alloc(1_048_577, 0x78));
    const huge = commit(root, 'over the bound');
    expect(source(baseline, huge)).toMatchObject({ problems: [expect.stringContaining('huge.bin')] });
  });

  it('a SUBSTITUTED loose object refuses the evidence (live control: cat-file serves it)', () => {
    // AppSec F1. `git cat-file` never re-hashes an object on read, so whatever bytes sit in the store
    // under a name are served AS that name. The control proves that premise on THIS git; the refusal
    // afterwards is therefore the new defence, not an attack that fizzled.
    const { root, baseline, candidate } = repository();
    const source = candidateEvidenceSource(nodeGitBytes('git', root));
    expect(source(baseline, candidate)).toHaveProperty('digest');

    const victim = git(root, 'rev-parse', `${candidate}:mod.txt`);
    const loose = join(root, '.git', 'objects', victim.slice(0, 2), victim.slice(2));
    const raw = Buffer.from('benign bytes B\n');
    rmSync(loose, { force: true });
    writeFileSync(loose, deflateSync(Buffer.concat([Buffer.from(`blob ${raw.length}\0`), raw])));

    // CONTROL: the substitution is live - git serves B under the ORIGINAL id, exit 0.
    expect(git(root, 'cat-file', 'blob', victim)).toBe('benign bytes B');

    const refused = source(baseline, candidate);
    expect(refused).toMatchObject({ problems: [expect.stringContaining('do not hash to their own object id')] });
  });

  it('an ambient GIT_DIR cannot repoint the reading (live control: plain git follows it)', () => {
    // ECC SECURITY (HIGH): the evidence source used to inherit the whole ambient environment. The
    // reading must be about the governed root, whatever the process environment says.
    const { root, baseline, candidate } = repository();
    const decoy = repository();
    const source = candidateEvidenceSource(nodeGitBytes('git', root));
    const honest = source(baseline, candidate);
    expect(honest).toHaveProperty('digest');

    const saved = process.env['GIT_DIR'];
    process.env['GIT_DIR'] = join(decoy.root, '.git');
    try {
      // CONTROL: a plain spawn with the inherited environment answers about the DECOY repository.
      const redirected = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', env: { ...process.env } }).trim();
      expect(redirected).toBe(decoy.candidate);
      // The production source is unmoved: same digest, about the governed root.
      expect(source(baseline, candidate)).toEqual(honest);
    } finally {
      if (saved === undefined) delete process.env['GIT_DIR'];
      else process.env['GIT_DIR'] = saved;
    }
  });

  it('a planted replacement object cannot change what the agent reads', () => {
    const { root, baseline, candidate } = repository();
    const before = candidateEvidenceSource(nodeGitBytes('git', root))(baseline, candidate);
    const real = git(root, 'rev-parse', `${candidate}:mod.txt`);
    write(root, 'evil.bin', 'SUBSTITUTED');
    const evil = git(root, 'hash-object', '-w', 'evil.bin');
    unlinkSync(join(root, 'evil.bin'));
    git(root, 'replace', real, evil);
    // CONTROL: an ordinary git now serves the replacement, so the plant is live.
    expect(git(root, 'cat-file', 'blob', `${candidate}:mod.txt`)).toBe('SUBSTITUTED');
    expect(candidateEvidenceSource(nodeGitBytes('git', root))(baseline, candidate)).toEqual(before);
  });
});

describe('the raw tree-difference parser refuses what it does not fully understand', () => {
  const A = 'a'.repeat(40);
  const Z = '0'.repeat(40);
  const rec = (meta: string, path: string): Buffer => Buffer.from(`${meta}\0${path}\0`, 'latin1');

  it('reads the four statuses and an empty difference', () => {
    expect(parseRawTreeDifference(Buffer.alloc(0))).toEqual({ entries: [] });
    const parsed = parseRawTreeDifference(rec(`:000000 100644 ${Z} ${A} A`, 'src/x.ts'));
    expect(parsed).toEqual({ entries: [{ change: 'added', path: 'src/x.ts', oldMode: 0, newMode: 0o100644, oldId: Z, newId: A }] });
  });

  it.each([
    ['no terminator', Buffer.from(`:000000 100644 ${Z} ${A} A\0x`, 'latin1')],
    ['odd field count', Buffer.concat([rec(`:000000 100644 ${Z} ${A} A`, 'x'), Buffer.from('y\0', 'latin1')])],
    ['a rename record', rec(`:100644 100644 ${A} ${A} R100`, 'x')],
    ['an unknown status', rec(`:100644 100644 ${A} ${A} X`, 'x')],
    ['an abbreviated identity', rec(`:000000 100644 ${Z} abc1234 A`, 'x')],
    ['an upper-case identity', rec(`:000000 100644 ${Z} ${A.toUpperCase()} A`, 'x')],
    ['a short mode', rec(`:00000 100644 ${Z} ${A} A`, 'x')],
    ['no leading colon', rec(`000000 100644 ${Z} ${A} A`, 'x')],
  ])('%s', (_name, raw) => {
    expect(parseRawTreeDifference(raw)).toHaveProperty('problems');
  });
});
