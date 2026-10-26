/**
 * ZERO-TOUCH CLOSURE, PIECE BY PIECE — PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A.
 *
 * The owner's `closure-decision-commit` grant lets ProjectOS commit its closure delegate's decision. Two
 * rules carry it, proven here directly; `hybridClosureReconcile.test.ts` proves the whole chain:
 *   - the own-records committer takes the closure kinds ONLY with the grant, on top of commit and push;
 *   - the owner-commit check accepts exactly the ProjectOS commit identity ONLY when the grant is passed,
 *     and still refuses every other implementer-shaped identity.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeSystem } from '../src/system.js';
import {
  commitOwnRecords,
  ownerGatesOfPlanPhase,
  PROJECTOS_COMMIT_EMAIL,
  PROJECTOS_COMMIT_NAME,
  type OwnRecordsCommitRequest,
} from '../src/loop/technicalContinuation.js';
import { ownerCommitIdentityProblems } from '../src/closureWait.js';

const BRANCH = 'work';
const DECISION = '.projectops/closure/decisions/P1A.json';
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function repo(): string {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-zt-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-zt-'));
  made.push(origin, root);
  execFileSync('git', ['init', '--quiet', '--bare', origin]);
  git(root, 'init', '--quiet', '-b', BRANCH);
  git(root, 'config', 'user.email', 'owner@example.invalid');
  git(root, 'config', 'user.name', 'Murad');
  git(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'work.txt'), 'the work\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', '-u', 'origin', `${BRANCH}:${BRANCH}`);
  mkdirSync(join(root, '.projectops', 'closure', 'decisions'), { recursive: true });
  writeFileSync(join(root, DECISION), '{"decision":"close"}\n');
  return root;
}

const GRANTED = { granted: true, problems: [] };

function request(root: string, over: Partial<OwnRecordsCommitRequest> = {}): OwnRecordsCommitRequest {
  return {
    root,
    phaseId: 'P1A',
    kind: 'closure-decision',
    expectedBranch: BRANCH,
    expectedRemote: 'origin',
    isOwnRecord: (p) => p === DECISION,
    delegation: { problems: [], carriesTechnicalScope: true, delegatedTo: 'ChatGPT' },
    phaseOwnerGates: ownerGatesOfPlanPhase(['secrets-handling', 'payment-or-live-charge']),
    closureCommit: GRANTED,
    ...over,
  };
}

/** The same request with no grant judged at all — the field absent, as a caller that never asked passes it. */
function withoutGrant(r: OwnRecordsCommitRequest): OwnRecordsCommitRequest {
  const { closureCommit: _absent, ...rest } = r;
  return rest;
}

function picture(root: string): string {
  return [git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', `origin/${BRANCH}`), git(root, 'status', '--porcelain', '--untracked-files=all')].join('|');
}

describe('the own-records committer and the closure kinds', () => {
  it('with the grant, commits and pushes exactly the closure decision, as the ProjectOS implementer', () => {
    const root = repo();
    const r = commitOwnRecords(nodeSystem, request(root));
    expect(r.kind).toBe('DONE');
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(DECISION);
    expect(git(root, 'log', '-1', '--format=%an <%ae>').trim()).toBe(`${PROJECTOS_COMMIT_NAME} <${PROJECTOS_COMMIT_EMAIL}>`);
    expect(git(root, 'log', '-1', '--format=%B')).toContain("owner's closure-decision-commit grant");
    expect(git(root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(git(root, 'rev-parse', 'HEAD').trim());
  });

  it('without the grant — absent, refused or judged invalid — commits nothing, for both closure kinds', () => {
    for (const kind of ['closure-decision', 'post-close'] as const) {
      for (const closureCommit of [undefined, { granted: false, problems: ['no valid committed delegation grants it'] }]) {
        const root = repo();
        const before = picture(root);
        const r = commitOwnRecords(nodeSystem, closureCommit === undefined ? withoutGrant(request(root, { kind })) : request(root, { kind, closureCommit }));
        expect(r.kind, `${kind} ${JSON.stringify(closureCommit)}`).toBe('RESERVED');
        if (r.kind === 'RESERVED') expect(r.reasons.join(' ')).toContain("does not grant 'closure-decision-commit'");
        expect(picture(root)).toBe(before);
      }
    }
  });

  it('the grant never lifts a reserved commit or push, or a missing technical delegation', () => {
    for (const over of [
      { phaseOwnerGates: ownerGatesOfPlanPhase(['commit']) },
      { phaseOwnerGates: ownerGatesOfPlanPhase(['push']) },
      { delegation: { problems: ['expired'], carriesTechnicalScope: true, delegatedTo: '' } },
    ] as Partial<OwnRecordsCommitRequest>[]) {
      const root = repo();
      const before = picture(root);
      const r = commitOwnRecords(nodeSystem, request(root, over));
      expect(r.kind, JSON.stringify(over)).toBe('RESERVED');
      expect(picture(root)).toBe(before);
    }
  });

  it('with the grant, still refuses anything dirty beyond the closure bundle', () => {
    const root = repo();
    writeFileSync(join(root, 'work.txt'), 'changed by someone\n');
    const before = picture(root);
    const r = commitOwnRecords(nodeSystem, request(root));
    expect(r.kind).toBe('REFUSED');
    expect(picture(root)).toBe(before);
  });

  it('the grant leaves the ordinary kinds exactly as they were', () => {
    const root = repo();
    const r = commitOwnRecords(nodeSystem, withoutGrant(request(root, { kind: 'closure-tail' })));
    expect(r.kind).toBe('DONE');
  });
});

describe('the owner-commit identity, with and without the grant', () => {
  const PROJECTOS = { name: PROJECTOS_COMMIT_NAME, email: PROJECTOS_COMMIT_EMAIL };

  it('without the grant the ProjectOS identity is the implementer and is refused, as before', () => {
    expect(ownerCommitIdentityProblems(PROJECTOS, 'Murad').join(' ')).toContain('which is the implementer');
    expect(ownerCommitIdentityProblems(PROJECTOS, 'Murad', null).join(' ')).toContain('which is the implementer');
  });

  it('with the grant exactly the ProjectOS identity is accepted, and the owner still is', () => {
    expect(ownerCommitIdentityProblems(PROJECTOS, 'Murad', PROJECTOS)).toEqual([]);
    expect(ownerCommitIdentityProblems({ name: 'Murad', email: 'owner@example.invalid' }, 'Murad', PROJECTOS)).toEqual([]);
  });

  it('with the grant, every other implementer-shaped or foreign identity is still refused', () => {
    for (const identity of [
      { name: PROJECTOS_COMMIT_NAME, email: 'someone@example.invalid' },
      { name: 'Claude', email: PROJECTOS_COMMIT_EMAIL },
      { name: 'Claude', email: 'noreply@anthropic.com' },
      { name: 'ProjectOS Implementer', email: PROJECTOS_COMMIT_EMAIL },
      { name: 'Somebody Else', email: 'else@example.invalid' },
    ]) {
      expect(ownerCommitIdentityProblems(identity, 'Murad', PROJECTOS).length, JSON.stringify(identity)).toBeGreaterThan(0);
    }
  });
});
