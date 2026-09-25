/**
 * THE BOUNDED LOCAL CANDIDATE COMMIT — PROJECTOS-HOST-REVIEW-PATH1B, UNIT L (criteria 12 and 13).
 *
 * REAL REPOSITORIES, because every claim here is about what git actually did: which commit, which
 * parent, which bytes, which hook or program ran. Each "does not run" proof first runs a LIVE CONTROL in
 * the same repository - an ordinary porcelain command that DOES run the planted program - so a proof can
 * never pass merely because the plant was inert on this machine.
 *
 * No network, no GitHub, no provider. Origins are local bare repositories on disk.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_CANDIDATE_GIT_IDENTITY, nodeSystem, resolveBoundGit, type System } from '../src/system.js';
import {
  LOCAL_CANDIDATE_GIT_VERBS,
  LOCAL_CANDIDATE_TRAILER,
  commitLocalCandidate,
} from '../src/loop/localCandidateCommit.js';
import { GATEKEEPER_LEDGER_REL } from '../src/loop/gatekeeperConfig.js';
import { computeCandidateIdentity } from '../src/loop/candidateIdentity.js';
import {
  authoriseTechnicalContinuation,
  type CheckedTechnicalDecision,
  type TechnicalDelegationState,
} from '@projectos/core';

const GIT = resolveBoundGit(process.env) as string;
const PHASE = 'PROJECTOS-HOST-REVIEW-PATH1B';
const BACKSLASH = String.fromCharCode(92);

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** A porcelain git command that is ALLOWED to fail - used only for the live controls. */
function gitMayFail(root: string, ...args: string[]): void {
  try {
    execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    // The control is judged by its marker, not by its exit code.
  }
}

interface World {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
}

/** A work repository on `work` with two tracked files, pushed to a local bare origin. */
function world(): World {
  const origin = temp('projectos-lc-origin-');
  execFileSync(GIT, ['init', '--quiet', '--bare', '--initial-branch=work', origin], { stdio: 'pipe' });
  const root = temp('projectos-lc-work-');
  git(root, 'init', '--quiet', '--initial-branch=work');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS Test');
  git(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  writeFileSync(join(root, 'other.txt'), 'other\n');
  git(root, 'add', '--', 'base.txt', 'other.txt');
  git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', '-u', 'origin', 'work:work');
  return { root, origin, head: git(root, 'rev-parse', 'HEAD').trim() };
}

/** The worker's output: one modified, one added (nested), one deleted. */
function doWork(w: World): void {
  writeFileSync(join(w.root, 'base.txt'), 'base, changed by the worker\n');
  mkdirSync(join(w.root, 'new', 'deep'), { recursive: true });
  writeFileSync(join(w.root, 'new', 'deep', 'file.txt'), 'added\n');
  rmSync(join(w.root, 'other.txt'));
}

const posix = (p: string): string => p.split(BACKSLASH).join('/');

/** Each plant writes its OWN name, so a failure says which program ran rather than merely that one did. */
function shHook(path: string, marker: string, name: string): void {
  writeFileSync(path, `#!/bin/sh\necho ${name} >> "${posix(marker)}"\nexit 0\n`);
  writeFileSync(`${path}.bat`, `@echo ${name}.bat >> "${marker}"\r\n`);
}

const HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-index-change', 'reference-transaction'];

function plantHooks(dir: string, marker: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of HOOKS) shHook(join(dir, name), marker, name);
}

/** What ran since the marker was cleared: '' when nothing did. */
const ran = (marker: string): string => (existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '');

function committedOk(w: World, sys: System = nodeSystem) {
  const r = commitLocalCandidate(sys, w.root, PHASE);
  if (r.kind !== 'COMMITTED') throw new Error(`expected COMMITTED, got ${JSON.stringify(r)}`);
  return r;
}

/* ------------------------------------------------------------------------------------------------ */

describe('criterion 12 - the candidate is committed locally, before review, and nothing else is', () => {
  it('records EXACTLY the candidate as ONE fast-forward commit on top of HEAD, and publishes nothing', () => {
    const w = world();
    doWork(w);
    // A record the asking itself creates - never part of the candidate, so never in the commit.
    mkdirSync(join(w.root, '.projectops'), { recursive: true });
    writeFileSync(join(w.root, ...GATEKEEPER_LEDGER_REL.split('/')), '{"entries":[]}\n');

    const r = committedOk(w);

    expect(r.parent).toBe(w.head);
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(r.commit);
    expect(git(w.root, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/work');
    // ONE parent, and it is the previous HEAD: a fast-forward, not a rewrite.
    expect(git(w.root, 'rev-list', '--parents', '-n', '1', 'HEAD').trim()).toBe(`${r.commit} ${w.head}`);
    const changed = git(w.root, 'diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD').trim().split(/\r?\n/).sort();
    expect(changed).toEqual(['A\tnew/deep/file.txt', 'D\tother.txt', 'M\tbase.txt']);
    expect(r.paths).toEqual(['base.txt', 'new/deep/file.txt', 'other.txt']);
    // The asking record stays out of the commit, and stays in the checkout.
    expect(changed.some((l) => l.includes('gatekeeper-ledger'))).toBe(false);
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all').trim()).toBe(`?? ${GATEKEEPER_LEDGER_REL}`);
    // Nothing was published.
    expect(git(w.root, 'rev-parse', 'origin/work').trim()).toBe(w.head);
    expect(git(w.origin, 'rev-parse', 'work').trim()).toBe(w.head);
    // Marked, and recorded under the fixed ProjectOS identity - no configuration was asked who to be.
    const message = git(w.root, 'log', '-1', '--format=%B', 'HEAD');
    expect(message).toContain(`${LOCAL_CANDIDATE_TRAILER}: ${PHASE}`);
    expect(message).toContain(`ProjectOS-Candidate-Parent: ${w.head}`);
    expect(git(w.root, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', 'HEAD').trim()).toBe(
      `${LOCAL_CANDIDATE_GIT_IDENTITY.name} <${LOCAL_CANDIDATE_GIT_IDENTITY.email}>|` +
        `${LOCAL_CANDIDATE_GIT_IDENTITY.name} <${LOCAL_CANDIDATE_GIT_IDENTITY.email}>`,
    );
  });

  it('commits the WORKING-TREE candidate, not whatever the checkout index had staged', () => {
    const w = world();
    // Version A staged, version B in the working tree. The candidate is the working tree.
    writeFileSync(join(w.root, 'base.txt'), 'staged version A\n');
    git(w.root, 'add', '--', 'base.txt');
    writeFileSync(join(w.root, 'base.txt'), 'working-tree version B\n');
    const r = committedOk(w);
    expect(git(w.root, 'cat-file', 'blob', `${r.commit}:base.txt`)).toBe('working-tree version B\n');
    // The real index now agrees with what was recorded, so nothing reads as changed.
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all').trim()).toBe('');
  });

  it('a correction is an ADDITIVE commit on top: the earlier candidate is never rewritten', () => {
    const w = world();
    doWork(w);
    const first = committedOk(w);
    writeFileSync(join(w.root, 'base.txt'), 'corrected after review\n');
    const second = committedOk(w);
    expect(second.parent).toBe(first.commit);
    expect(git(w.root, 'rev-list', '--parents', '-n', '1', 'HEAD').trim()).toBe(`${second.commit} ${first.commit}`);
    // The cumulative change from the baseline is what a review of the newest candidate sees.
    expect(git(w.root, 'diff', '--name-only', `${w.head}..${second.commit}`).trim().split(/\r?\n/).sort()).toEqual([
      'base.txt',
      'new/deep/file.txt',
      'other.txt',
    ]);
    execFileSync(GIT, ['-C', w.root, 'merge-base', '--is-ancestor', first.commit, second.commit], { stdio: 'pipe' });
  });

  it('with nothing to record, nothing is committed and HEAD stays the subject', () => {
    const w = world();
    expect(commitLocalCandidate(nodeSystem, w.root, PHASE)).toEqual({ kind: 'NOTHING_TO_COMMIT', head: w.head });
    // Only an asking record changed: still nothing of the phase's own to record.
    mkdirSync(join(w.root, '.projectops'), { recursive: true });
    writeFileSync(join(w.root, ...GATEKEEPER_LEDGER_REL.split('/')), '{}\n');
    expect(commitLocalCandidate(nodeSystem, w.root, PHASE)).toEqual({ kind: 'NOTHING_TO_COMMIT', head: w.head });
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
  });

  it('records the bytes an ordinary commit would record: git built-in line-ending handling applies, binary intact', () => {
    const w = world();
    // The repository asks for text normalisation. That is git's own built-in handling - not a program - so
    // the candidate records exactly what `git commit` of the same paths would record.
    git(w.root, 'config', 'core.autocrlf', 'true');
    writeFileSync(join(w.root, '.gitattributes'), '*.txt text=auto\n*.bin binary\n');
    writeFileSync(join(w.root, 'crlf.txt'), 'line one\r\nline two\r\n');
    const binary = Buffer.from([0, 1, 2, 255, 13, 10, 0]);
    writeFileSync(join(w.root, 'blob.bin'), binary);
    const r = committedOk(w);
    const read = (p: string) => execFileSync(GIT, ['-C', w.root, 'cat-file', 'blob', `${r.commit}:${p}`], { stdio: 'pipe' });
    const expectedText = execFileSync(GIT, ['-C', w.root, 'hash-object', '--', 'crlf.txt'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    expect(git(w.root, 'rev-parse', `${r.commit}:crlf.txt`).trim()).toBe(expectedText);
    expect(read('crlf.txt').toString('latin1')).toBe('line one\nline two\n');
    expect(Buffer.compare(read('blob.bin'), binary)).toBe(0);
  });

  it('refuses on a detached HEAD, and leaves everything where it was', () => {
    const w = world();
    git(w.root, 'switch', '--quiet', '--detach', 'HEAD');
    doWork(w);
    const r = commitLocalCandidate(nodeSystem, w.root, PHASE);
    expect(r.kind).toBe('REFUSED');
    expect(r.kind === 'REFUSED' && r.reasons.join(' ')).toContain('detached');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'rev-parse', 'refs/heads/work').trim()).toBe(w.head);
  });

  it('a branch that moved while the candidate was being recorded is REFUSED, never overwritten', () => {
    const w = world();
    doWork(w);
    let intruder = '';
    // The compare-and-swap is the guarantee, so the race is staged exactly at the ref write.
    const racing: System = {
      ...nodeSystem,
      exec(cmd, args, options) {
        if (args.includes('update-ref') && intruder === '') {
          const tree = git(w.root, 'rev-parse', `${w.head}^{tree}`).trim();
          intruder = execFileSync(GIT, ['-C', w.root, 'commit-tree', '-p', w.head, '-m', 'someone else', tree], {
            encoding: 'utf8',
            stdio: 'pipe',
          }).trim();
          git(w.root, 'update-ref', 'refs/heads/work', intruder, w.head);
        }
        return nodeSystem.exec(cmd, args, options);
      },
    };
    const r = commitLocalCandidate(racing, w.root, PHASE);
    expect(r.kind).toBe('REFUSED');
    expect(r.kind === 'REFUSED' && r.reasons.join(' ')).toContain('the branch moved');
    // The other writer's commit stands; ours never replaced it.
    expect(git(w.root, 'rev-parse', 'refs/heads/work').trim()).toBe(intruder);
  });

  it('a symbolic link is never followed into a candidate', () => {
    const w = world();
    const target = join(temp('projectos-lc-outside-'), 'secret.txt');
    writeFileSync(target, 'outside the repository\n');
    try {
      execFileSync('cmd', ['/c', 'mklink', join(w.root, 'link.txt'), target], { stdio: 'pipe' });
    } catch {
      return; // Creating a symlink needs Developer Mode or elevation here; the lstat guard is unconditional.
    }
    const r = commitLocalCandidate(nodeSystem, w.root, PHASE);
    expect(r.kind).toBe('REFUSED');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
  });
});

/* ------------------------------------------------------------------------------------------------ */

describe('criterion 13 - no hook and no configuration-driven program runs', () => {
  it('hooks planted in .git/hooks do NOT run (live control: an ordinary commit runs them)', () => {
    const w = world();
    const marker = join(temp('projectos-lc-marker-'), 'HOOK-RAN.txt');
    plantHooks(join(w.root, '.git', 'hooks'), marker);

    // CONTROL: the plant is live in THIS repository.
    writeFileSync(join(w.root, 'control.txt'), 'control\n');
    git(w.root, 'add', '--', 'control.txt');
    gitMayFail(w.root, 'commit', '--quiet', '-m', 'control');
    expect(existsSync(marker), 'control: an ordinary commit must run the planted hooks').toBe(true);
    rmSync(marker);

    doWork(w);
    committedOk(w);
    expect(ran(marker)).toBe('');
  });

  it('hooks named by the repository core.hooksPath do NOT run (live control)', () => {
    const w = world();
    const marker = join(temp('projectos-lc-marker-'), 'HOOKSPATH-RAN.txt');
    const planted = temp('projectos-lc-hooks-');
    plantHooks(planted, marker);
    git(w.root, 'config', 'core.hooksPath', posix(planted));

    writeFileSync(join(w.root, 'control.txt'), 'control\n');
    git(w.root, 'add', '--', 'control.txt');
    gitMayFail(w.root, 'commit', '--quiet', '-m', 'control');
    expect(existsSync(marker), 'control: core.hooksPath must be live').toBe(true);
    rmSync(marker);

    doWork(w);
    committedOk(w);
    expect(ran(marker)).toBe('');
  });

  it('a repository clean filter does NOT run (live control: an ordinary add runs it)', () => {
    const w = world();
    const marker = join(temp('projectos-lc-marker-'), 'FILTER-RAN.txt');
    git(w.root, 'config', 'filter.evil.clean', `echo clean-filter >> "${posix(marker)}"; cat`);
    writeFileSync(join(w.root, '.gitattributes'), '* filter=evil\n');

    writeFileSync(join(w.root, 'control.txt'), 'control\n');
    gitMayFail(w.root, 'add', '--', 'control.txt');
    expect(existsSync(marker), 'control: the clean filter must be live').toBe(true);
    rmSync(marker);
    gitMayFail(w.root, 'rm', '--cached', '--quiet', '--', 'control.txt');

    doWork(w);
    const r = committedOk(w);
    expect(ran(marker)).toBe('');
    // And the bytes were recorded as written, not as a filter would have rendered them.
    expect(git(w.root, 'cat-file', 'blob', `${r.commit}:base.txt`)).toBe('base, changed by the worker\n');
  });

  it('a signing program named by the repository does NOT run (live control)', () => {
    const w = world();
    const marker = join(temp('projectos-lc-marker-'), 'GPG-RAN.txt');
    const program = join(temp('projectos-lc-gpg-'), 'fake-gpg.sh');
    writeFileSync(program, `#!/bin/sh\necho ran >> "${posix(marker)}"\nexit 1\n`);
    git(w.root, 'config', 'commit.gpgSign', 'true');
    git(w.root, 'config', 'gpg.program', posix(program));

    writeFileSync(join(w.root, 'control.txt'), 'control\n');
    git(w.root, 'add', '--', 'control.txt');
    gitMayFail(w.root, 'commit', '--quiet', '-m', 'control');
    expect(existsSync(marker), 'control: the signing program must be live').toBe(true);
    rmSync(marker);

    doWork(w);
    const r = committedOk(w);
    expect(ran(marker)).toBe('');
    expect(git(w.root, 'cat-file', 'commit', r.commit)).not.toContain('gpgsig');
  });

  it('USER-LEVEL configuration is not consulted (live control through the ordinary oracle environment)', () => {
    const w = world();
    const marker = join(temp('projectos-lc-marker-'), 'USERCONFIG-RAN.txt');
    const planted = temp('projectos-lc-userhooks-');
    plantHooks(planted, marker);
    const home = temp('projectos-lc-home-');
    writeFileSync(join(home, '.gitconfig'), `[core]\n\thooksPath = ${posix(planted)}\n`);

    const saved = { USERPROFILE: process.env['USERPROFILE'], HOMEDRIVE: process.env['HOMEDRIVE'], HOMEPATH: process.env['HOMEPATH'], HOME: process.env['HOME'] };
    process.env['USERPROFILE'] = home;
    process.env['HOMEDRIVE'] = home.slice(0, 2);
    process.env['HOMEPATH'] = home.slice(2);
    delete process.env['HOME'];
    try {
      // CONTROL through a plain git carrying this process's environment: the planted user configuration
      // is read. (Every git call ProjectOS itself makes resolves hooks beneath the null device, so the
      // control deliberately goes around `System`.)
      writeFileSync(join(w.root, 'control.txt'), 'control\n');
      gitMayFail(w.root, 'add', '--', 'control.txt');
      gitMayFail(w.root, 'commit', '--quiet', '-m', 'control');
      expect(existsSync(marker), 'control: user-level configuration must be live').toBe(true);
      rmSync(marker);

      doWork(w);
      committedOk(w);
      expect(ran(marker)).toBe('');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('criterion 13 - the governed worktree hook directory is never invoked by any ProjectOS git call', () => {
  it.each([
    ['.git/hooks', (w: World, planted: string) => plantHooks(join(w.root, '.git', 'hooks'), planted)],
    [
      'a repository core.hooksPath',
      (w: World, planted: string) => {
        const dir = temp('projectos-lc-hooks-');
        plantHooks(dir, planted);
        git(w.root, 'config', 'core.hooksPath', posix(dir));
      },
    ],
  ] as const)('an ordinary System git call that writes the index runs no hook from %s (live control)', (_where, plant) => {
    const w = world();
    const marker = join(temp('projectos-lc-marker-'), 'ORACLE-HOOK-RAN.txt');
    plant(w, marker);
    // CONTROL: plain git runs `post-index-change` when `add` writes the index.
    writeFileSync(join(w.root, 'control.txt'), 'control\n');
    gitMayFail(w.root, 'add', '--', 'control.txt');
    expect(ran(marker), 'control: the planted hook must be live').toContain('post-index-change');
    rmSync(marker);
    // The same write through the runtime's own git.
    writeFileSync(join(w.root, 'second.txt'), 'second\n');
    const r = nodeSystem.exec('git', ['-C', w.root, 'add', '--', 'second.txt']);
    expect(r.code).toBe(0);
    expect(ran(marker)).toBe('');
  });
});

/* ------------------------------------------------------------------------------------------------ */

describe('an unreviewed local candidate is consumable by no other governed action', () => {
  const delegation = (): TechnicalDelegationState => ({ problems: [], carriesTechnicalScope: true, delegatedTo: 'ChatGPT' });

  it('a push is refused unless a decision names the local candidate itself as its subject', () => {
    const w = world();
    doWork(w);
    const r = committedOk(w);
    const c = computeCandidateIdentity(nodeSystem, w.root);
    if (!c.ok) throw new Error(c.problems.join('; '));
    const decision = (subjectCommit: string): CheckedTechnicalDecision => ({
      problems: [],
      decisionId: 'GKDEC-test',
      projectId: 'projectos',
      phaseId: PHASE,
      subjectCommit,
      allowedActions: ['push'],
      reviewedCandidateDigest: c.identity.digest,
      reviewedEntries: c.identity.entries,
    });
    const ask = (subjectCommit: string) =>
      authoriseTechnicalContinuation({
        action: 'push',
        context: {
          projectId: 'projectos',
          phaseId: PHASE,
          programmeId: 'projectos-autonomous-self-hosting',
          root: w.root,
          currentBranch: 'work',
          expectedBranch: 'work',
          currentHead: git(w.root, 'rev-parse', 'HEAD').trim(),
          currentCandidate: c.identity,
        },
        decision: decision(subjectCommit),
        delegation: delegation(),
        ownerOnlyActions: [],
      });
    // A decision about the BASE - the only kind that existed before this commit - cannot publish it.
    const stale = ask(w.head);
    expect(stale.authorised).toBe(false);
    // The same conjunction is satisfiable only by a decision about the candidate commit itself, which is
    // exactly what the unattended review produces.
    expect(ask(r.commit).authorised).toBe(true);
  });

  it('closure cannot consume it: the reconciled predicate the closure gate uses is false', () => {
    const w = world();
    doWork(w);
    committedOk(w);
    // `closureGate.ts` gitFacts: reconciled iff `rev-list --left-right --count HEAD...@{upstream}` is 0 0.
    expect(git(w.root, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}').trim()).not.toMatch(/^0\s+0$/);
  });
});

describe('the authority stays bounded in source', () => {
  it('issues only its closed verb set, and nothing that publishes, rewrites or deletes', () => {
    const src = readFileSync(new URL('../src/loop/localCandidateCommit.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...LOCAL_CANDIDATE_GIT_VERBS]).toEqual([
      'config',
      'status',
      'ls-files',
      'rev-parse',
      'symbolic-ref',
      'read-tree',
      'hash-object',
      'update-index',
      'write-tree',
      'commit-tree',
      'update-ref',
    ]);
    for (const forbidden of [
      "'push'",
      "'merge'",
      "'tag'",
      "'reset'",
      "'rebase'",
      "'--amend'",
      "'--force'",
      "'-f'",
      "'checkout'",
      "'switch'",
      "'fetch'",
      "'branch'",
      "'commit'",
      "'-d'",
      "'--delete'",
      "'--no-verify'",
      'child_process',
      'spawnSync',
    ]) {
      expect(code.includes(forbidden), forbidden).toBe(false);
    }
    // Every call carries the hook-free directory and the isolated environment.
    expect(code).toContain('`core.hooksPath=${hooks}`');
    expect(code).toContain("'core.fsmonitor=false'");
    expect(code).toContain("'commit.gpgSign=false'");
    // Every configured filter driver is emptied and made optional, so git reads it as "no filter".
    for (const key of ['clean=', 'smudge=', 'process=', 'required=false']) {
      expect(code).toContain(`\`filter.\${n}.${key}\``);
    }
    // The candidate itself is computed through the same isolated runner.
    expect(code).toContain('computeCandidateIdentity(sys, root, (args) => git(args))');
    expect(code).toContain("'--no-gpg-sign'");
    expect(code).toContain('isolatedGit:');
    // The one ref write is a compare-and-swap from the parent.
    expect(code).toMatch(/'update-ref', '-m', [^\]]*, branchRef, commit, parent\]/);
  });
});
