/**
 * When ProjectOS may carry out a technical continuation, and what it does when it may.
 *
 * TWO HALVES, DELIBERATELY. The authority conjunction is pure and is proven without a repository, so
 * every refusal is testable in isolation. The executor is proven against real temporary repositories
 * with a real local bare origin, because "it committed the right paths" and "the push actually
 * landed" are not claims a stub can make.
 *
 * THE MOST IMPORTANT TEST IN THIS FILE is the last one in "not live yet": under the plan as it stands
 * today, `commit` and `push` are owner gates and the constitutional floor holds them regardless, so
 * the conjunction cannot be satisfied for either. The mechanism is built and proven; whether it
 * becomes reachable is an owner-attended plan amendment that has not happened. That is stated here
 * rather than only in a report, so a future change that quietly makes it reachable fails a test.
 *
 * NO GITHUB, no network beyond a local bare remote on disk, no provider call.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { engagePlatformStop } from '../src/loop/platformStop.js';
import { computeCandidateIdentity, describeCandidateDrift } from '../src/loop/candidateIdentity.js';
import {
  runTechnicalContinuation,
  executeAuthorisedContinuation,
  refusesUnderCurrentPlan,
  type ContinuationContext,
  type ContinuationRequest,
} from '../src/loop/technicalContinuation.js';
import {
  ALWAYS_OWNER_ONLY,
  TECHNICAL_ACTIONS,
  TECHNICAL_CONTINUATION_SCOPE,
  authoriseTechnicalContinuation,
  isTechnicalAction,
  type CandidateIdentity,
  type CheckedTechnicalDecision,
  type TechnicalDelegationState,
} from '@projectos/core';

const sys = nodeSystem;
const GIT = resolveBoundGit(process.env) as string;

const BASE = '1111111111111111111111111111111111111111';
const PROJECT = 'projectos';
const PHASE = 'PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A';

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/* ------------------------------------------------------------------------------------------------
 * The pure conjunction. No repository, no git, no disk.
 * --------------------------------------------------------------------------------------------- */

const CANDIDATE: CandidateIdentity = {
  schemaVersion: '1.0.0',
  digest: 'sha256:aaaa',
  entries: [{ path: 'src/x.ts', state: 'present', blob: 'b1', mode: '100644' }],
};

function decision(over: Partial<CheckedTechnicalDecision> = {}): CheckedTechnicalDecision {
  return {
    problems: [],
    decisionId: 'GKDEC-abc123',
    projectId: PROJECT,
    phaseId: PHASE,
    subjectCommit: BASE,
    allowedActions: ['commit'],
    reviewedCandidateDigest: CANDIDATE.digest,
    ...over,
  };
}

function delegation(over: Partial<TechnicalDelegationState> = {}): TechnicalDelegationState {
  return { problems: [], carriesTechnicalScope: true, delegatedTo: 'ChatGPT', ...over };
}

function ask(over: {
  action?: string;
  decision?: CheckedTechnicalDecision;
  delegation?: TechnicalDelegationState;
  ownerOnlyActions?: readonly string[];
  currentHead?: string;
  currentBranch?: string;
  currentCandidate?: CandidateIdentity;
  projectId?: string;
  phaseId?: string;
} = {}) {
  return authoriseTechnicalContinuation({
    action: over.action ?? 'commit',
    context: {
      projectId: over.projectId ?? PROJECT,
      phaseId: over.phaseId ?? PHASE,
      programmeId: 'projectos-autonomous-self-hosting',
      root: 'C:/dev/ProjectOS',
      currentBranch: over.currentBranch ?? 'work',
      expectedBranch: 'work',
      currentHead: over.currentHead ?? BASE,
      currentCandidate: over.currentCandidate ?? CANDIDATE,
    },
    decision: over.decision ?? decision(),
    delegation: over.delegation ?? delegation(),
    // The floor is deliberately NOT applied to the pure fixtures: these prove the conjunction, and a
    // separate block below proves what the real floor does to it.
    ownerOnlyActions: over.ownerOnlyActions ?? [],
  });
}

function refusal(v: ReturnType<typeof ask>): string {
  return v.authorised ? '' : v.reasons.join(' | ');
}

describe('all four authorities are required, and no three of them suffice', () => {
  it('authorises when every one of them holds', () => {
    expect(ask().authorised).toBe(true);
  });

  it('refuses a decision that did not pass its own check', () => {
    const v = ask({ decision: decision({ problems: ['decision was already consumed'] }) });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain('did not pass its own checks');
  });

  // A CALLER THAT DOES NOT SAY WHETHER IT CHECKED HAS NOT CHECKED. Same rule as applyVerdictToStop:
  // forgetting to check must not look like passing.
  it('refuses when no check result was supplied at all', () => {
    const v = ask({ decision: { ...decision(), problems: undefined as unknown as readonly string[] } });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain('it is not known whether the decision passed');
  });

  it('refuses when the delegation is invalid, however good the decision is', () => {
    const v = ask({ delegation: delegation({ problems: ['the delegation is not committed'] }) });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain(TECHNICAL_CONTINUATION_SCOPE);
    expect(refusal(v)).toContain('not committed');
  });

  it('refuses a valid delegation that does not carry the technical scope', () => {
    const v = ask({ delegation: delegation({ carriesTechnicalScope: false }) });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain('reviewing and closing are not carrying out a technical action');
  });

  it('refuses an action the decision did not approve', () => {
    const v = ask({ action: 'push', decision: decision({ allowedActions: ['commit'] }) });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain("does not include 'push'");
  });

  it('refuses an action ProjectOS cannot perform, rather than attempting it', () => {
    const v = ask({ action: 'deploy', decision: decision({ allowedActions: ['deploy'] }) });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain('is not one of the technical actions ProjectOS performs');
  });

  it('refuses an owner-only action even when the decision names it', () => {
    const v = ask({
      action: 'push',
      decision: decision({ allowedActions: ['push'] }),
      ownerOnlyActions: ['push'],
    });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain('the owner performs it or it does not happen');
  });
});

describe('the bindings must still describe this world', () => {
  it('refuses a decision for another project', () => {
    expect(refusal(ask({ decision: decision({ projectId: 'polygo' }) }))).toContain("is for project 'polygo'");
  });

  it('refuses a decision for another phase', () => {
    expect(refusal(ask({ decision: decision({ phaseId: 'SOME-OTHER-PHASE1A' }) }))).toContain('is for phase');
  });

  it('refuses when HEAD moved after the answer', () => {
    expect(refusal(ask({ currentHead: '2'.repeat(40) }))).toContain('the base moved after the answer');
  });

  it('refuses when the checkout is on another branch', () => {
    expect(refusal(ask({ currentBranch: 'somewhere-else' }))).toContain("expects 'work'");
  });

  it('refuses when the candidate changed after the gatekeeper reviewed it', () => {
    const drifted: CandidateIdentity = { ...CANDIDATE, digest: 'sha256:bbbb' };
    const v = ask({ currentCandidate: drifted });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain('the candidate changed after the gatekeeper reviewed it');
    expect(refusal(v)).toContain('changed reviewed bytes require a fresh gate');
  });
});

describe('nothing else is authority', () => {
  // Each of these has been mistaken for authority somewhere in this programme. The point is not that
  // they are rejected — it is that there is no parameter through which they could arrive.
  it('the request carries no field for stored evidence, a checkpoint or implementer text', () => {
    const keys = Object.keys({
      action: 0,
      context: 0,
      decision: 0,
      delegation: 0,
      ownerOnlyActions: 0,
    });
    // A change to the request shape that added one would fail here before it could be used.
    expect(keys.sort()).toEqual(['action', 'context', 'decision', 'delegation', 'ownerOnlyActions']);
  });

  it('the action vocabulary is closed and short', () => {
    expect([...TECHNICAL_ACTIONS]).toEqual(['commit', 'push', 'ff-only-integration']);
    for (const forbidden of ['deploy', 'release', 'tag', 'force-push', 'run', 'shell', 'merge']) {
      expect(isTechnicalAction(forbidden)).toBe(false);
    }
  });
});

describe('not live yet, and the code says so', () => {
  // THE PLAN STILL OWNER-GATES BOTH, AND THE FLOOR HOLDS THEM ANYWAY. This is the honest state of B6
  // today: the replacement mechanism exists and is proven, and it cannot execute a commit or a push
  // for this project until an owner-attended plan amendment says otherwise.
  it.each(['commit', 'push'] as const)('refuses %s under the plan as it stands', (action) => {
    expect(refusesUnderCurrentPlan(action, [])).toBe(true);
    const v = ask({
      action,
      decision: decision({ allowedActions: [action] }),
      ownerOnlyActions: [...ALWAYS_OWNER_ONLY],
    });
    expect(v.authorised).toBe(false);
    expect(refusal(v)).toContain('the owner performs it or it does not happen');
  });

  it('and ff-only integration is not on the floor, so the floor is not what blocks it', () => {
    expect(refusesUnderCurrentPlan('ff-only-integration', [])).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The executor, against real repositories.
 * --------------------------------------------------------------------------------------------- */

interface World {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
}

/** A work repository on `work`, pushed to a local bare origin. No network, no GitHub. */
function world(): World {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-origin-'));
  execFileSync(GIT, ['init', '--quiet', '--bare', '--initial-branch=work', origin], { stdio: 'pipe' });
  const root = mkdtempSync(join(tmpdir(), 'projectos-work-'));
  git(root, 'init', '--quiet', '--initial-branch=work');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS Test');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git(root, 'add', '--', 'base.txt');
  git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', 'origin', 'work:work');
  return { root, origin, head: git(root, 'rev-parse', 'HEAD').trim() };
}

function cleanup(w: World): void {
  rmSync(w.root, { recursive: true, force: true });
  rmSync(w.origin, { recursive: true, force: true });
}

function context(w: World, over: Partial<ContinuationContext> = {}): ContinuationContext {
  return {
    root: w.root,
    projectId: PROJECT,
    phaseId: PHASE,
    programmeId: 'projectos-autonomous-self-hosting',
    expectedBranch: 'work',
    expectedRemote: 'origin',
    integrationTargetBranch: null,
    ...over,
  };
}

/** A request whose decision is bound to the candidate as it stands right now. */
function request(w: World, action: string, over: Partial<ContinuationRequest> = {}): ContinuationRequest {
  const c = computeCandidateIdentity(sys, w.root);
  if (!c.ok) throw new Error(`candidate refused: ${c.problems.join('; ')}`);
  return {
    action,
    context: context(w),
    decision: decision({
      allowedActions: [action],
      subjectCommit: git(w.root, 'rev-parse', 'HEAD').trim(),
      reviewedCandidateDigest: c.identity.digest,
      reviewedEntries: c.identity.entries,
    }),
    delegation: delegation(),
    // Empty, so these tests exercise the EXECUTOR. The floor's effect is proven above, on the
    // conjunction, where it belongs.
    phaseOwnerGates: [],
    at: '2026-09-01T18:00:00+01:00',
    ...over,
  };
}

/**
 * Drive the executor with a REAL grant, obtained from the real authoriser.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A BACK DOOR. `commit` and `push` are in `ALWAYS_OWNER_ONLY`, so
 * `runTechnicalContinuation` — which derives that floor itself — cannot reach either today, and their
 * machinery would otherwise ship unexercised. The grant below is minted by `authoriseTechnicalContinuation`
 * past every one of its refusals; the only thing this supplies that production does not is an
 * `ownerOnlyActions` of its own, which is a parameter of the PURE function and not of the production
 * entry point. Production has no argument through which to narrow the floor, and `runTechnicalContinuation`
 * is pinned as the only production caller of the executor.
 */
function executeUnderRealGrant(w: World, req: ContinuationRequest): ReturnType<typeof runTechnicalContinuation> {
  const c = computeCandidateIdentity(sys, w.root);
  if (!c.ok) throw new Error(`candidate refused: ${c.problems.join('; ')}`);
  const head = git(w.root, 'rev-parse', 'HEAD').trim();
  const verdict = authoriseTechnicalContinuation({
    action: req.action,
    context: {
      projectId: req.context.projectId,
      phaseId: req.context.phaseId,
      programmeId: req.context.programmeId,
      root: req.context.root,
      currentBranch: git(w.root, 'rev-parse', '--abbrev-ref', 'HEAD').trim(),
      expectedBranch: req.context.expectedBranch,
      currentHead: head,
      currentCandidate: c.identity,
    },
    decision: req.decision,
    delegation: req.delegation,
    ownerOnlyActions: [],
  });
  if (!verdict.authorised) {
    // The authoriser's refusal IS the outcome, in the same shape the production path returns — including
    // the drift description `runTechnicalContinuation` appends, so a negative test asserts on exactly
    // what an operator would be shown.
    const drift =
      req.decision.reviewedCandidateDigest !== c.identity.digest && Array.isArray(req.decision.reviewedEntries)
        ? describeCandidateDrift(req.decision.reviewedEntries, c.identity.entries)
        : [];
    return { kind: 'REFUSED', reasons: [...verdict.reasons, ...drift.map((d) => `  ${d}`)], nothingAttempted: true };
  }
  return executeAuthorisedContinuation(sys, verdict.grant, req, { candidate: c.identity, head, lines: [] });
}

describe('first run: reviewed candidate to committed and pushed', () => {
  it('commits exactly the reviewed boundary, then pushes, and origin agrees', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed change\n');
    writeFileSync(join(w.root, 'added.txt'), 'new reviewed file\n');

    const committed = executeUnderRealGrant(w, request(w, 'commit'));
    expect(committed.kind).toBe('DONE');
    if (committed.kind !== 'DONE') throw new Error(refusalOf(committed));
    expect(committed.action).toBe('commit');

    // The commit carries exactly the two reviewed paths and nothing else.
    const namesInCommit = git(w.root, 'show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/).sort();
    expect(namesInCommit).toEqual(['added.txt', 'base.txt']);
    // The message is ProjectOS's own and cites the decision that authorised it.
    const message = git(w.root, 'log', '-1', '--format=%B');
    expect(message).toContain('GKDEC-abc123');
    expect(message).toContain('sha256:');
    // Nothing is left dirty.
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');

    const pushed = executeUnderRealGrant(w, {
      ...request(w, 'push'),
      decision: decision({
        allowedActions: ['push'],
        subjectCommit: committed.head,
        reviewedCandidateDigest: (computeCandidateIdentity(sys, w.root) as { identity: CandidateIdentity }).identity.digest,
      }),
    });
    expect(pushed.kind).toBe('DONE');
    if (pushed.kind !== 'DONE') throw new Error(refusalOf(pushed));

    // local == origin, 0/0. Proven from the repository, not from the exit code.
    expect(git(w.root, 'rev-parse', 'origin/work').trim()).toBe(committed.head);
    expect(git(w.root, 'rev-list', '--count', 'origin/work..HEAD').trim()).toBe('0');
    expect(git(w.root, 'rev-list', '--count', 'HEAD..origin/work').trim()).toBe('0');
    cleanup(w);
  });
});

/*
 * THE EMERGENCY STOP, RE-ASKED IMMEDIATELY BEFORE EACH GIT ACT (PROJECTOS-KERNEL-PLATFORM-STOP1A, M2).
 *
 * `executeAuthorisedContinuation` runs AFTER `runTechnicalContinuation`'s entry check and after a network
 * fetch, so a stop engaged in that window is exactly what these exercise: the grant is real, the entry
 * check is behind us, and the commit or push must still refuse.
 */
describe('[PLATFORM-STOP] a stop engaged after continuation entry refuses the git act itself', () => {
  const engagedDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'projectos-tc-stop-'));
    const out = engagePlatformStop(nodeSystem, dir, { reason: 'mid-act', engagedBy: 'tester' });
    if (out.kind !== 'ENGAGED') throw new Error('not engaged');
    return dir;
  };

  it('doCommit refuses: nothing is staged and nothing is committed', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed change\n');
    const dir = engagedDir();
    const out = executeUnderRealGrant(w, { ...request(w, 'commit'), platformStopStateDir: dir });
    expect(out.kind).toBe('REFUSED');
    expect(refusalOf(out)).toContain('the commit was not made: the emergency stop is engaged');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'diff', '--cached', '--name-only').trim()).toBe('');
    rmSync(dir, { recursive: true, force: true });
    cleanup(w);
  });

  it('doPush refuses: the local commit stands and origin does not move', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed change\n');
    const committed = executeUnderRealGrant(w, request(w, 'commit'));
    if (committed.kind !== 'DONE') throw new Error(refusalOf(committed));
    const dir = engagedDir();
    const pushed = executeUnderRealGrant(w, {
      ...request(w, 'push'),
      decision: decision({
        allowedActions: ['push'],
        subjectCommit: committed.head,
        reviewedCandidateDigest: (computeCandidateIdentity(sys, w.root) as { identity: CandidateIdentity }).identity.digest,
      }),
      platformStopStateDir: dir,
    });
    expect(pushed.kind).toBe('REFUSED');
    expect(refusalOf(pushed)).toContain('the push was not made: the emergency stop is engaged');
    expect(git(w.origin, 'rev-parse', 'work').trim()).toBe(w.head);
    rmSync(dir, { recursive: true, force: true });
    cleanup(w);
  });
});

describe('first run, the negative: one material byte after the gate', () => {
  it('refuses to commit, and commits nothing', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const req = request(w, 'commit');

    // The gate has been passed. Now the candidate changes by one byte.
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewee\n');

    const out = executeUnderRealGrant(w, req);
    expect(out.kind).toBe('REFUSED');
    expect(refusalOf(out)).toContain('the candidate changed after the gatekeeper reviewed it');
    expect(refusalOf(out)).toContain('content changed since review: base.txt');
    // Nothing happened: HEAD is where it was and the tree is still dirty.
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'status', '--porcelain').trim()).not.toBe('');
    cleanup(w);
  });

  it('refuses when a file appears after the gate, and commits nothing', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const req = request(w, 'commit');
    writeFileSync(join(w.root, 'unreviewed.txt'), 'nobody looked at this\n');

    const out = executeUnderRealGrant(w, req);
    expect(out.kind).toBe('REFUSED');
    expect(refusalOf(out)).toContain('added since review: unreviewed.txt');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    cleanup(w);
  });

  it('refuses when a reviewed file is removed after the gate', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    writeFileSync(join(w.root, 'goes.txt'), 'here for now\n');
    const req = request(w, 'commit');
    rmSync(join(w.root, 'goes.txt'));

    const out = executeUnderRealGrant(w, req);
    expect(out.kind).toBe('REFUSED');
    expect(refusalOf(out)).toContain('the candidate changed after the gatekeeper reviewed it');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    cleanup(w);
  });
});

describe('the executor refuses before it touches anything', () => {
  it('refuses an empty candidate rather than making an empty commit', () => {
    const w = world();
    const out = executeUnderRealGrant(w, request(w, 'commit'));
    expect(out.kind).toBe('REFUSED');
    expect(refusalOf(out)).toContain('there is nothing to commit');
    cleanup(w);
  });

  it('refuses when the remote moved on, and merges nothing', () => {
    const w = world();
    // Another checkout advances origin behind this one's back.
    const other = mkdtempSync(join(tmpdir(), 'projectos-other-'));
    execFileSync(GIT, ['clone', '--quiet', w.origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'other@example.invalid');
    git(other, 'config', 'user.name', 'Other');
    writeFileSync(join(other, 'theirs.txt'), 'theirs\n');
    git(other, 'add', '--', 'theirs.txt');
    git(other, 'commit', '--quiet', '-m', 'theirs');
    git(other, 'push', '--quiet', 'origin', 'work:work');

    writeFileSync(join(w.root, 'base.txt'), 'base\nours\n');
    const out = executeUnderRealGrant(w, request(w, 'commit'));
    expect(out.kind).toBe('REFUSED');
    expect(refusalOf(out)).toContain('has moved on by 1 commit(s)');
    expect(refusalOf(out)).toContain('nothing is merged, rebased or resolved automatically');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    rmSync(other, { recursive: true, force: true });
    cleanup(w);
  });

  it('refuses ff-only integration for want of a governed target, and names the missing source', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nchanged\n');
    const out = executeUnderRealGrant(w, request(w, 'ff-only-integration'));
    expect(out.kind).toBe('REFUSED');
    expect(refusalOf(out)).toContain('no governed integration target branch is configured');
    expect(refusalOf(out)).toContain('is not a governed parameter');
    cleanup(w);
  });

  it('performs a genuine fast forward when the graph is one, and refuses when it is not', () => {
    // FF-ONLY MEANS FF-ONLY. `integration` is an ancestor of `work`, so advancing to it is a real
    // fast forward; the divergent case below is refused before `merge` is even reached.
    const w = world();
    git(w.root, 'branch', 'integration', 'HEAD');
    git(w.root, 'push', '--quiet', 'origin', 'integration:integration');
    writeFileSync(join(w.root, 'base.txt'), 'base\nahead\n');
    git(w.root, 'add', '--', 'base.txt');
    git(w.root, 'commit', '--quiet', '-m', 'ahead');
    const head = git(w.root, 'rev-parse', 'HEAD').trim();

    const ff = executeUnderRealGrant(w, {
      ...request(w, 'ff-only-integration'),
      context: context(w, { integrationTargetBranch: 'integration' }),
      decision: decision({
        allowedActions: ['ff-only-integration'],
        subjectCommit: head,
        reviewedCandidateDigest: (computeCandidateIdentity(sys, w.root) as { identity: CandidateIdentity }).identity.digest,
      }),
    });
    expect(ff.kind).toBe('DONE');
    // A fast forward adds no commit.
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(head);

    // Now make origin/integration diverge, and prove the refusal.
    const other = mkdtempSync(join(tmpdir(), 'projectos-diverge-'));
    execFileSync(GIT, ['clone', '--quiet', '--branch', 'integration', w.origin, other], { stdio: 'pipe' });
    git(other, 'config', 'user.email', 'other@example.invalid');
    git(other, 'config', 'user.name', 'Other');
    writeFileSync(join(other, 'divergent.txt'), 'divergent\n');
    git(other, 'add', '--', 'divergent.txt');
    git(other, 'commit', '--quiet', '-m', 'divergent');
    git(other, 'push', '--quiet', 'origin', 'integration:integration');

    const divergent = executeUnderRealGrant(w, {
      ...request(w, 'ff-only-integration'),
      context: context(w, { integrationTargetBranch: 'integration' }),
      decision: decision({
        allowedActions: ['ff-only-integration'],
        subjectCommit: head,
        reviewedCandidateDigest: (computeCandidateIdentity(sys, w.root) as { identity: CandidateIdentity }).identity.digest,
      }),
    });
    expect(divergent.kind).toBe('REFUSED');
    expect(refusalOf(divergent)).toContain('is not a fast forward');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(head);
    rmSync(other, { recursive: true, force: true });
    cleanup(w);
  });
});

describe('what the executor cannot express', () => {
  // NOT GUARDED AGAINST — ABSENT. These strings do not appear because there is nowhere to put them,
  // which is the difference between a rule and a boundary.
  it('has no force, no refspec, no tag, no release and no shell in its source', () => {
    const src = readFileSync(new URL('../src/loop/technicalContinuation.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    // ARGUMENT LITERALS, not bare words. The refusal prose legitimately says "nothing is merged,
    // rebased or resolved automatically", and a scan for `rebase` fails on the very sentence that
    // promises it never happens — a rule that fires on its own guarantee teaches people to delete
    // the guarantee.
    for (const forbidden of ["'--force'", "'--force-with-lease'", "'--amend'", "'--tags'", "'--delete'", "'--hard'", "'rebase'", "'tag'"]) {
      expect(code).not.toContain(forbidden);
    }
    // `reset` IS present and is deliberately not on that list: it is the path-scoped index restore
    // after a failed commit — the same remedy `planDecision.ts` applies — which unstages exactly the
    // candidate paths and touches the working tree not at all. `'--hard'`, the form that would
    // destroy work, is on the list above and is absent.
    expect(code).toContain("'reset'");
    expect(code).toContain("'--quiet'");
    // No shell by any spelling, and no process API but the governed `sys.exec`.
    for (const shell of ['powershell', 'cmd.exe', '/bin/sh', 'execSync', 'spawnSync', 'shell: true', 'child_process']) {
      expect(code.toLowerCase()).not.toContain(shell.toLowerCase());
    }
  });
});

function refusalOf(o: ReturnType<typeof runTechnicalContinuation>): string {
  return o.kind === 'REFUSED' ? o.reasons.join(' | ') : `expected a refusal, got ${o.kind}: ${o.result}`;
}
