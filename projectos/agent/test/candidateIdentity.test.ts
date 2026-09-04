/**
 * Naming the exact bytes a commit would record — against a real repository, not a fixture.
 *
 * WHAT THESE PROVE. A gatekeeper decision binds project, phase, `subjectCommit` and `requestDigest`,
 * and `subjectCommit` is HEAD: the BASE the work sits on. The work is uncommitted, so HEAD names none
 * of it, and until the candidate identity existed an approval to commit was an approval of bytes the
 * reviewer had never seen. These tests are the difference between "the reviewer read a summary of the
 * run" and "the decision is about these bytes".
 *
 * REAL GIT, REAL TEMPORARY REPOSITORIES. A stub would prove the encoding agrees with itself. What has
 * to be true is that git and this module agree about what changed, including the cases that are easy
 * to miss — a file that appears, a file that disappears, a rename that is really a delete and an add.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { computeCandidateIdentity, candidateDigest, describeCandidateDrift } from '../src/loop/candidateIdentity.js';

const sys = nodeSystem;
const GIT = resolveBoundGit(process.env);

function git(root: string, ...args: string[]): void {
  execFileSync(GIT as string, ['-C', root, ...args], { stdio: 'pipe' });
}

/** A repository with one commit, so there is a base for a candidate to sit on. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'projectos-candidate-'));
  git(root, 'init', '--quiet', '--initial-branch=work');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS Test');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git(root, 'add', '--', 'base.txt');
  git(root, 'commit', '--quiet', '-m', 'base');
  return root;
}

function digestOf(root: string): string {
  const r = computeCandidateIdentity(sys, root);
  if (!r.ok) throw new Error(`identity refused: ${r.problems.join('; ')}`);
  return r.identity.digest;
}

describe('the candidate is named at all', () => {
  it('gives a clean tree a real, stable identity rather than an unknown one', () => {
    const root = repo();
    const first = computeCandidateIdentity(sys, root);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.identity.entries).toEqual([]);
    expect(first.identity.digest).toBe(candidateDigest([]));
    // "Nothing to commit" and "the candidate is unknown" must stay different answers.
    expect(digestOf(root)).toBe(first.identity.digest);
    rmSync(root, { recursive: true, force: true });
  });

  it('is deterministic: naming the same unchanged candidate twice gives the same digest', () => {
    const root = repo();
    writeFileSync(join(root, 'base.txt'), 'base\nchanged\n');
    expect(digestOf(root)).toBe(digestOf(root));
    rmSync(root, { recursive: true, force: true });
  });

  it('records the git blob id of the working-tree content, not a hash of its own invention', () => {
    const root = repo();
    writeFileSync(join(root, 'base.txt'), 'base\nchanged\n');
    const r = computeCandidateIdentity(sys, root);
    if (!r.ok) throw new Error('unreachable');
    const entry = r.identity.entries.find((e) => e.path === 'base.txt');
    const fromGit = execFileSync(GIT as string, ['-C', root, 'hash-object', '--', 'base.txt'], { encoding: 'utf8' }).trim();
    expect(entry?.blob).toBe(fromGit);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('every material change to the candidate changes its identity', () => {
  it('ONE BYTE of a modified file', () => {
    const root = repo();
    writeFileSync(join(root, 'base.txt'), 'base\nreviewed\n');
    const reviewed = digestOf(root);
    writeFileSync(join(root, 'base.txt'), 'base\nreviewee\n'); // one byte, same length
    expect(digestOf(root)).not.toBe(reviewed);
    rmSync(root, { recursive: true, force: true });
  });

  it('a file ADDED after review', () => {
    const root = repo();
    writeFileSync(join(root, 'base.txt'), 'base\nreviewed\n');
    const reviewed = digestOf(root);
    writeFileSync(join(root, 'extra.txt'), 'snuck in\n');
    expect(digestOf(root)).not.toBe(reviewed);
    rmSync(root, { recursive: true, force: true });
  });

  it('a file DELETED after review', () => {
    const root = repo();
    writeFileSync(join(root, 'base.txt'), 'base\nreviewed\n');
    writeFileSync(join(root, 'second.txt'), 'second\n');
    const reviewed = digestOf(root);
    rmSync(join(root, 'second.txt'));
    expect(digestOf(root)).not.toBe(reviewed);
    rmSync(root, { recursive: true, force: true });
  });

  it('a TRACKED file deleted from the working tree', () => {
    const root = repo();
    const before = digestOf(root);
    rmSync(join(root, 'base.txt'));
    const r = computeCandidateIdentity(sys, root);
    if (!r.ok) throw new Error('unreachable');
    expect(r.identity.digest).not.toBe(before);
    const entry = r.identity.entries.find((e) => e.path === 'base.txt');
    expect(entry?.state).toBe('deleted');
    expect(entry?.blob).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it('a RENAME, which is a delete and an add', () => {
    const root = repo();
    writeFileSync(join(root, 'a.txt'), 'content\n');
    git(root, 'add', '--', 'a.txt');
    git(root, 'commit', '--quiet', '-m', 'add a');
    const reviewed = digestOf(root);
    renameSync(join(root, 'a.txt'), join(root, 'b.txt'));
    const r = computeCandidateIdentity(sys, root);
    if (!r.ok) throw new Error('unreachable');
    expect(r.identity.digest).not.toBe(reviewed);
    expect(r.identity.entries.map((e) => e.path).sort()).toEqual(['a.txt', 'b.txt']);
    rmSync(root, { recursive: true, force: true });
  });

  // THE CASE THAT FOUND A REAL DEFECT. Plain `git status --porcelain` collapses a wholly-untracked
  // directory to `deep/`, so the candidate named a directory it could not hash and every file beneath
  // it was invisible. `-uall` is what makes the entries below individual paths.
  it('a file in a NESTED untracked directory, so the boundary is not only the top level', () => {
    const root = repo();
    mkdirSync(join(root, 'deep', 'deeper'), { recursive: true });
    writeFileSync(join(root, 'deep', 'deeper', 'x.txt'), 'one\n');
    const first = computeCandidateIdentity(sys, root);
    if (!first.ok) throw new Error(`identity refused: ${first.problems.join('; ')}`);
    expect(first.identity.entries.map((e) => e.path)).toEqual(['deep/deeper/x.txt']);

    writeFileSync(join(root, 'deep', 'deeper', 'x.txt'), 'two\n');
    expect(digestOf(root)).not.toBe(first.identity.digest);

    // A SECOND file in the same untracked directory must also be its own entry — the collapsed form
    // would have reported one unchanged path for two different worlds.
    const two = digestOf(root);
    writeFileSync(join(root, 'deep', 'deeper', 'y.txt'), 'sibling\n');
    expect(digestOf(root)).not.toBe(two);
    rmSync(root, { recursive: true, force: true });
  });

  // THE BOUNDARY IS PART OF THE IDENTITY, which is why unrelated drift needs no separate check: a
  // path joining or leaving the changed set moves the sorted list and therefore the digest.
  it('content moved between two candidate files, leaving both sets the same size', () => {
    const root = repo();
    writeFileSync(join(root, 'one.txt'), 'alpha\n');
    writeFileSync(join(root, 'two.txt'), 'beta\n');
    const reviewed = digestOf(root);
    writeFileSync(join(root, 'one.txt'), 'beta\n');
    writeFileSync(join(root, 'two.txt'), 'alpha\n');
    expect(digestOf(root)).not.toBe(reviewed);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('a refusal can say what drifted', () => {
  it('names the added, changed and removed paths rather than printing two hex strings', () => {
    const root = repo();
    writeFileSync(join(root, 'kept.txt'), 'kept\n');
    writeFileSync(join(root, 'goes.txt'), 'goes\n');
    const before = computeCandidateIdentity(sys, root);
    if (!before.ok) throw new Error('unreachable');
    writeFileSync(join(root, 'kept.txt'), 'kept differently\n');
    rmSync(join(root, 'goes.txt'));
    writeFileSync(join(root, 'arrives.txt'), 'arrives\n');
    const after = computeCandidateIdentity(sys, root);
    if (!after.ok) throw new Error('unreachable');

    const drift = describeCandidateDrift(before.identity.entries, after.identity.entries).join(' | ');
    expect(drift).toContain('content changed since review: kept.txt');
    expect(drift).toContain('added since review: arrives.txt');
    // `goes.txt` is still a candidate path — it is now a DELETION, which is itself a change.
    expect(drift).toContain('goes.txt');
    rmSync(root, { recursive: true, force: true });
  });
});

describe('naming fails closed', () => {
  it('refuses rather than returning a partial identity when the checkout cannot be read', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'projectos-candidate-none-'));
    const r = computeCandidateIdentity(sys, notARepo);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.problems.join(' ')).toContain('the working tree could not be read');
    rmSync(notARepo, { recursive: true, force: true });
  });
});

/**
 * D: the records the ordering fix moved writes AHEAD of must still be INSIDE the candidate.
 *
 * The fix for candidate drift was to make the lifecycle write happen before the freeze -- NOT to
 * exclude the records from the reviewed subject. If they ever leave the candidate, a phase record
 * or a declared current-state could change between review and commit without refusal, which is the
 * failure the drift check exists to prevent. This pins the membership the fix relies on.
 */
const NL = String.fromCharCode(10);

describe('phase and current-state records remain part of the reviewed candidate', () => {
  it('a phase record change moves the digest', () => {
    const root = repo();
    mkdirSync(join(root, '.projectops', 'phases'), { recursive: true });
    writeFileSync(join(root, '.projectops', 'phases', 'validation-cache.json'), '{"status":"validating"}' + NL);
    const before = digestOf(root);
    writeFileSync(join(root, '.projectops', 'phases', 'validation-cache.json'), '{"status":"awaiting_review"}' + NL);
    expect(digestOf(root)).not.toBe(before);
    rmSync(root, { recursive: true, force: true });
  });

  it('a declared current-state change moves the digest', () => {
    const root = repo();
    mkdirSync(join(root, '.projectops'), { recursive: true });
    writeFileSync(join(root, '.projectops', 'current-state-abc123.json'), '{"activePhase":null}' + NL);
    const before = digestOf(root);
    writeFileSync(join(root, '.projectops', 'current-state-abc123.json'), '{"activePhase":"validation-cache"}' + NL);
    expect(digestOf(root)).not.toBe(before);
    rmSync(root, { recursive: true, force: true });
  });
});
