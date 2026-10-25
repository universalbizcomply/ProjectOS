/**
 * PROJECTOS COMMITS ITS OWN RECORDS, AND NOTHING ELSE — PROJECTOS-FINISH-MULTIPROJECT1A.
 *
 * Against a REAL repository with a real (bare) remote: the run's records, or the three closure records,
 * are committed and pushed by ProjectOS only when the phase leaves commit and push delegated, only when
 * every uncommitted path is one of them, and only on a head the remote already has. Every refusal below
 * leaves HEAD, the index and the remote exactly as they were.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeSystem } from '../src/system.js';
import { commitOwnRecords, ownerGatesOfPlanPhase, type OwnRecordsCommitRequest } from '../src/loop/technicalContinuation.js';
import { isFoldableRunRecord } from '../src/commands/run.js';

const BRANCH = 'work';
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function repo(): string {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-own-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-own-'));
  made.push(origin, root);
  execFileSync('git', ['init', '--quiet', '--bare', origin]);
  git(root, 'init', '--quiet', '-b', BRANCH);
  git(root, 'config', 'user.email', 'fixture@projectos.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(root, '.projectops', 'phases'), { recursive: true });
  writeFileSync(join(root, '.projectops', 'phases', 'P1A.json'), '{"status":"implementing"}\n');
  writeFileSync(join(root, 'work.txt'), 'the work\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', '-u', 'origin', `${BRANCH}:${BRANCH}`);
  return root;
}

const DELEGATED = { problems: [], carriesTechnicalScope: true, delegatedTo: 'Gatekeeper' };
const RECORDS = new Set(['.projectops/phases/P1A.json', '.projectops/execution/s.evidence.json']);

function request(root: string, over: Partial<OwnRecordsCommitRequest> = {}): OwnRecordsCommitRequest {
  return {
    root,
    phaseId: 'P1A',
    kind: 'run-records',
    expectedBranch: BRANCH,
    expectedRemote: 'origin',
    isOwnRecord: (p) => RECORDS.has(p),
    delegation: DELEGATED,
    phaseOwnerGates: ownerGatesOfPlanPhase(['secrets-handling', 'payment-or-live-charge']),
    ...over,
  };
}

function touchRecords(root: string): void {
  writeFileSync(join(root, '.projectops', 'phases', 'P1A.json'), '{"status":"awaiting_closure"}\n');
  mkdirSync(join(root, '.projectops', 'execution'), { recursive: true });
  writeFileSync(join(root, '.projectops', 'execution', 's.evidence.json'), '{}\n');
}

/** HEAD, the remote and the porcelain — what every refusal must leave untouched. */
function picture(root: string): string {
  return [git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', `origin/${BRANCH}`), git(root, 'status', '--porcelain', '--untracked-files=all')].join('|');
}

describe('commitOwnRecords', () => {
  it('commits and pushes EXACTLY the records, as one commit the remote then holds', () => {
    const root = repo();
    const base = git(root, 'rev-parse', 'HEAD').trim();
    touchRecords(root);
    const r = commitOwnRecords(nodeSystem, request(root));
    expect(r.kind).toBe('DONE');
    if (r.kind !== 'DONE') return;
    expect([...r.paths].sort()).toEqual([...RECORDS].sort());
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/).sort()).toEqual([...RECORDS].sort());
    expect(git(root, 'rev-parse', 'HEAD~1').trim()).toBe(base);
    expect(git(root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(r.head);
    expect(git(root, 'status', '--porcelain', '--untracked-files=all').trim()).toBe('');
    expect(git(root, 'log', '-1', '--format=%B')).toContain("the run's own records");
    // ECC SECURITY M1: authored by ProjectOS, never the checkout's (owner's) identity.
    expect(git(root, 'log', '-1', '--format=%an <%ae>').trim()).toBe('ProjectOS implementer <projectos-implementer@projectos.invalid>');
  });

  it('a push rejected after the commit is reported as committed locally and NOT pushed, never as done', () => {
    const root = repo();
    const origin = git(root, 'remote', 'get-url', 'origin').trim();
    mkdirSync(join(origin, 'hooks'), { recursive: true });
    writeFileSync(join(origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho rejected by test hook >&2\nexit 1\n', { mode: 0o755 });
    touchRecords(root);
    const remoteBefore = git(root, 'rev-parse', `origin/${BRANCH}`).trim();
    const r = commitOwnRecords(nodeSystem, request(root));
    expect(r.kind).toBe('REFUSED');
    if (r.kind !== 'REFUSED') return;
    expect(r.nothingAttempted).toBe(false);
    expect(r.reasons.join(' ')).toContain('NOT pushed');
    expect(git(root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(remoteBefore);
    expect(git(root, 'rev-list', '--count', `origin/${BRANCH}..HEAD`).trim()).toBe('1');
  });

  it('REFUSES a nested repository (a directory entry) even beneath a record folder', () => {
    const root = repo();
    mkdirSync(join(root, '.projectops', 'execution', 'evil'), { recursive: true });
    git(join(root, '.projectops', 'execution', 'evil'), 'init', '--quiet');
    writeFileSync(join(root, '.projectops', 'execution', 'evil', 'x.txt'), 'hidden\n');
    const before = picture(root);
    const r = commitOwnRecords(nodeSystem, request(root, { isOwnRecord: () => true }));
    expect(r.kind).toBe('REFUSED');
    if (r.kind === 'REFUSED') expect(r.nothingAttempted).toBe(true);
    expect(picture(root)).toBe(before);
  });

  it('REFUSES, attempting nothing, when any uncommitted path is not one of the records', () => {
    const root = repo();
    touchRecords(root);
    writeFileSync(join(root, 'work.txt'), 'unreviewed change\n');
    const before = picture(root);
    const r = commitOwnRecords(nodeSystem, request(root));
    expect(r.kind).toBe('REFUSED');
    if (r.kind === 'REFUSED') {
      expect(r.nothingAttempted).toBe(true);
      expect(r.reasons.join(' ')).toContain('work.txt');
    }
    expect(picture(root)).toBe(before);
  });

  it('does nothing when the phase reserves commit or push, or when no technical delegation is proven', () => {
    for (const over of [
      { phaseOwnerGates: ownerGatesOfPlanPhase(['commit']) },
      { phaseOwnerGates: ownerGatesOfPlanPhase(['push']) },
      { phaseOwnerGates: ownerGatesOfPlanPhase(['the owner lands this on main']) },
      { phaseOwnerGates: ownerGatesOfPlanPhase('commit') },
      { delegation: { problems: ['expired'], carriesTechnicalScope: true, delegatedTo: '' } },
      { delegation: { problems: [], carriesTechnicalScope: false, delegatedTo: 'Gatekeeper' } },
    ] as Partial<OwnRecordsCommitRequest>[]) {
      const root = repo();
      touchRecords(root);
      const before = picture(root);
      const r = commitOwnRecords(nodeSystem, request(root, over));
      expect(r.kind, JSON.stringify(over)).toBe('RESERVED');
      expect(picture(root), JSON.stringify(over)).toBe(before);
    }
  });

  it('REFUSES on a head the remote does not already hold, ahead or behind', () => {
    const ahead = repo();
    writeFileSync(join(ahead, 'work.txt'), 'committed, never pushed\n');
    git(ahead, 'commit', '--quiet', '-am', 'local only');
    touchRecords(ahead);
    const beforeAhead = picture(ahead);
    const a = commitOwnRecords(nodeSystem, request(ahead));
    expect(a.kind).toBe('REFUSED');
    if (a.kind === 'REFUSED') expect(a.reasons.join(' ')).toContain('1 ahead');
    expect(picture(ahead)).toBe(beforeAhead);

    const behind = repo();
    const other = mkdtempSync(join(tmpdir(), 'projectos-own-other-'));
    made.push(other);
    execFileSync('git', ['clone', '--quiet', '-b', BRANCH, git(behind, 'remote', 'get-url', 'origin').trim(), other]);
    git(other, 'config', 'user.email', 'fixture@projectos.invalid');
    git(other, 'config', 'user.name', 'fixture');
    writeFileSync(join(other, 'work.txt'), 'someone else moved the remote\n');
    git(other, 'commit', '--quiet', '-am', 'remote moved');
    git(other, 'push', '--quiet', 'origin', `${BRANCH}:${BRANCH}`);
    touchRecords(behind);
    const b = commitOwnRecords(nodeSystem, request(behind));
    expect(b.kind).toBe('REFUSED');
    if (b.kind === 'REFUSED') expect(b.reasons.join(' ')).toContain('1 behind');
    expect(git(behind, 'status', '--porcelain', '--untracked-files=all')).toContain('P1A.json');
  });

  it('REFUSES a rename, and a branch other than the one the plan names', () => {
    const renamed = repo();
    git(renamed, 'mv', '.projectops/phases/P1A.json', '.projectops/phases/P1A.moved.json');
    const r = commitOwnRecords(nodeSystem, request(renamed, { isOwnRecord: () => true }));
    expect(r.kind).toBe('REFUSED');
    if (r.kind === 'REFUSED') {
      expect(r.nothingAttempted).toBe(true);
      expect(r.reasons.join(' ')).toContain('rename');
    }

    const wrong = repo();
    touchRecords(wrong);
    const w = commitOwnRecords(nodeSystem, request(wrong, { expectedBranch: 'main' }));
    expect(w.kind).toBe('REFUSED');
    if (w.kind === 'REFUSED') expect(w.reasons.join(' ')).toContain("not 'main'");
  });

  it('the fold may commit only the runtime writers\' own record shapes (ECC SECURITY H1)', () => {
    const tail = ['.projectops/current-state.json'];
    for (const p of [
      '.projectops/execution/P1A-abc-123.brief.json',
      '.projectops/execution/P1A-abc-123.session.json',
      '.projectops/execution/P1A-abc-123.evidence.json',
      '.projectops/execution/P1A-abc-123.invocation.json',
      '.projectops/gatekeeper-decisions/GKDEC-GKREQ-0061b2e4c969136ec84852d3.json',
      '.projectops/gatekeeper-interactive/GKREQ-0061b2e4c969136ec84852d3.decision.json',
      '.projectops/work.v1.json',
      '.projectops/gatekeeper-ledger.json',
      '.projectops/phases/P1A.json',
      '.projectops/current-state.json',
    ]) expect(isFoldableRunRecord(p, 'P1A', tail), p).toBe(true);
    for (const p of [
      '.projectops/execution/P1A-abc-123.findings.json',
      '.projectops/execution/P1A-abc-123.effects.json',
      '.projectops/execution/degraded-use.G1.json',
      '.projectops/execution/anything-i-want.json',
      '.projectops/execution/evil/',
      '.projectops/execution/sub/x.evidence.json',
      '.projectops/gatekeeper-interactive/anything.json',
      '.projectops/phases/OTHER1A.json',
      '.projectops/closure/decisions/P1A.json',
      '.projectops/closure/P1A.json',
      '.projectops/gates/P1A.commit.json',
      '.projectops/authority/closure-delegation.json',
      '.projectops/project-config.json',
      'src/work.ts',
    ]) expect(isFoldableRunRecord(p, 'P1A', tail), p).toBe(false);
  });

  it('says there is nothing to commit when nothing is dirty', () => {
    expect(commitOwnRecords(nodeSystem, request(repo())).kind).toBe('NOTHING');
  });

  it('an unreadable owner-gate list reserves every technical action, never none', () => {
    for (const raw of ['commit', [1, 2], [null], 'anything']) {
      const gates = ownerGatesOfPlanPhase(raw);
      expect(gates, JSON.stringify(raw)).toContain('commit');
      expect(gates, JSON.stringify(raw)).toContain('push');
    }
    expect(ownerGatesOfPlanPhase(undefined)).not.toContain('commit');
  });
});

