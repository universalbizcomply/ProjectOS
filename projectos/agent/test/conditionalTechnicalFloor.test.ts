/**
 * Two kinds of owner-only, and the narrow gap between them.
 *
 * WHAT CHANGED AND WHY. The floor used to say one thing about five actions: never, whatever any list
 * says. That was right while ProjectOS had no way for the owner to delegate anything technical, but it
 * made two different sentences look identical. "Production must never be deployed by a machine" is
 * about the blast radius of the act. "No machine may commit" was about there being nobody trustworthy
 * to ask. Once the owner recorded a delegation and a live reviewer answered, the second sentence had
 * an answer and the first still did not.
 *
 * Under the owner's "APPROVE B6 CONDITIONAL TECHNICAL FLOOR", `commit` and `push` — and nothing else —
 * yield to a PROVEN technical delegation. These tests are the proof that the gap is exactly that wide:
 * that the default is unchanged, that degraded mode never yields, that a phase may still be stricter
 * than the constitution, and that no absolute action can be reached by this route.
 *
 * THE MOST IMPORTANT TEST HERE is "the active plan still refuses". The constitutional obstacle is
 * gone; the plan's is not, and the plan is the owner's to amend.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { computeCandidateIdentity } from '../src/loop/candidateIdentity.js';
import { runTechnicalContinuation, refusesUnderCurrentPlan, type ContinuationRequest } from '../src/loop/technicalContinuation.js';
import {
  ABSOLUTE_OWNER_ONLY,
  ALWAYS_OWNER_ONLY,
  CONDITIONALLY_DELEGABLE_TECHNICAL,
  enforcedOwnerOnlyActions,
  isAbsolutelyOwnerOnly,
  isConditionallyDelegableTechnical,
  technicalDelegationCondition,
  type CandidateIdentity,
  type CheckedTechnicalDecision,
  type TechnicalDelegationState,
} from '@projectos/core';

const sys = nodeSystem;
const GIT = resolveBoundGit(process.env) as string;
const PROJECT = 'projectos';
const PHASE = 'PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A';

/** Exactly what the ACTIVE ProjectOS plan declares for this phase today. */
const ACTIVE_PLAN_GATES = ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'];

const VALID: TechnicalDelegationState = { problems: [], carriesTechnicalScope: true, delegatedTo: 'ChatGPT' };
const NO_SCOPE: TechnicalDelegationState = { problems: [], carriesTechnicalScope: false, delegatedTo: 'ChatGPT' };
const INVALID: TechnicalDelegationState = {
  problems: ['the delegation is not committed, so it has not passed the owner commit gate'],
  carriesTechnicalScope: true,
  delegatedTo: 'ChatGPT',
};

const proven = () => technicalDelegationCondition(VALID);

/* ------------------------------------------------------------------------------------------------
 * The split itself. Pure, no repository.
 * --------------------------------------------------------------------------------------------- */

describe('the two lists agree, and say different things', () => {
  it('the union of the two is exactly the default floor', () => {
    expect([...ABSOLUTE_OWNER_ONLY, ...CONDITIONALLY_DELEGABLE_TECHNICAL].sort()).toEqual([...ALWAYS_OWNER_ONLY].sort());
  });

  it('nothing is in both, so no action has two meanings', () => {
    for (const a of ABSOLUTE_OWNER_ONLY) expect(isConditionallyDelegableTechnical(a)).toBe(false);
    for (const c of CONDITIONALLY_DELEGABLE_TECHNICAL) expect(isAbsolutelyOwnerOnly(c)).toBe(false);
  });

  it('only commit and push are conditionally delegable', () => {
    expect([...CONDITIONALLY_DELEGABLE_TECHNICAL]).toEqual(['commit', 'push']);
  });

  // Closure IS delegable — through `closureDelegation` and the delegated phase advance. Putting it
  // here as well would create a second answer to who may close.
  it('phase-closure stays absolute here, because it is delegated somewhere else', () => {
    expect(isAbsolutelyOwnerOnly('phase-closure')).toBe(true);
    expect(isConditionallyDelegableTechnical('phase-closure')).toBe(false);
  });
});

describe('the default is unchanged, which is what makes this opt-in', () => {
  it('with no condition, the enforced set is exactly what it always was', () => {
    expect([...enforcedOwnerOnlyActions([])].sort()).toEqual([...ALWAYS_OWNER_ONLY].sort());
    expect([...enforcedOwnerOnlyActions(['deploy-approval'])].sort()).toEqual(
      [...ALWAYS_OWNER_ONLY, 'deploy-approval'].sort(),
    );
  });

  it.each([undefined, null])('an absent or null condition protects commit and push (%s)', (condition) => {
    const enforced = enforcedOwnerOnlyActions([], condition);
    expect(enforced).toContain('commit');
    expect(enforced).toContain('push');
  });

  // A DELEGATION THAT WAS NOT PROVEN IS NOT A DELEGATION. Each of these mints no condition.
  it.each([
    ['an invalid delegation', INVALID],
    ['a valid delegation without the technical scope', NO_SCOPE],
    ['a delegation that never said whether it was checked', { carriesTechnicalScope: true } as TechnicalDelegationState],
  ])('%s mints no condition, so the full floor applies', (_name, state) => {
    expect(technicalDelegationCondition(state)).toBeNull();
    const enforced = enforcedOwnerOnlyActions([], technicalDelegationCondition(state));
    expect(enforced).toContain('commit');
    expect(enforced).toContain('push');
  });
});

describe('a proven delegation opens exactly two actions and no others', () => {
  it('omits commit and push', () => {
    const enforced = enforcedOwnerOnlyActions([], proven());
    expect(enforced).not.toContain('commit');
    expect(enforced).not.toContain('push');
  });

  it('keeps every absolute action, and there is no argument that could remove one', () => {
    for (const absolute of ABSOLUTE_OWNER_ONLY) {
      expect(enforcedOwnerOnlyActions([], proven())).toContain(absolute);
      expect(enforcedOwnerOnlyActions(['anything'], proven())).toContain(absolute);
    }
  });

  // A PHASE MAY BE STRICTER THAN THE CONSTITUTION, NEVER LAXER.
  it('still refuses commit when the phase declares it as its own owner gate', () => {
    expect(enforcedOwnerOnlyActions(['commit'], proven())).toContain('commit');
    // ...and push is still open, so the phase gate is doing the work and not the floor.
    expect(enforcedOwnerOnlyActions(['commit'], proven())).not.toContain('push');
  });

  it('THE ACTIVE PLAN STILL REFUSES BOTH — the plan is the owner\'s to amend, not this phase\'s', () => {
    const enforced = enforcedOwnerOnlyActions(ACTIVE_PLAN_GATES, proven());
    expect(enforced).toContain('commit');
    expect(enforced).toContain('push');
    expect(refusesUnderCurrentPlan('commit', ACTIVE_PLAN_GATES, VALID)).toBe(true);
    expect(refusesUnderCurrentPlan('push', ACTIVE_PLAN_GATES, VALID)).toBe(true);
    // Without the plan's gates the constitution alone would allow them. Both halves, stated.
    expect(refusesUnderCurrentPlan('commit', [], VALID)).toBe(false);
    expect(refusesUnderCurrentPlan('commit', [])).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The production executor, against real repositories.
 * --------------------------------------------------------------------------------------------- */

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

interface World {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
}

function world(): World {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-cf-origin-'));
  execFileSync(GIT, ['init', '--quiet', '--bare', '--initial-branch=work', origin], { stdio: 'pipe' });
  const root = mkdtempSync(join(tmpdir(), 'projectos-cf-work-'));
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

/** A request bound to the candidate as it stands now, through the PRODUCTION entry point. */
function request(w: World, action: string, over: Partial<ContinuationRequest> = {}): ContinuationRequest {
  const c = computeCandidateIdentity(sys, w.root);
  if (!c.ok) throw new Error(`candidate refused: ${c.problems.join('; ')}`);
  const decision: CheckedTechnicalDecision = {
    problems: [],
    decisionId: 'GKDEC-conditional',
    projectId: PROJECT,
    phaseId: PHASE,
    subjectCommit: git(w.root, 'rev-parse', 'HEAD').trim(),
    allowedActions: [action],
    reviewedCandidateDigest: c.identity.digest,
    reviewedEntries: c.identity.entries,
  };
  return {
    action,
    context: {
      root: w.root,
      projectId: PROJECT,
      phaseId: PHASE,
      programmeId: 'projectos-autonomous-self-hosting',
      expectedBranch: 'work',
      expectedRemote: 'origin',
      integrationTargetBranch: null,
    },
    decision,
    delegation: VALID,
    phaseOwnerGates: [],
    at: '2026-09-01T19:00:00+01:00',
    ...over,
  };
}

function reasons(o: ReturnType<typeof runTechnicalContinuation>): string {
  return o.kind === 'REFUSED' ? o.reasons.join(' | ') : `expected REFUSED, got ${o.kind}: ${o.result}`;
}

describe('the complete conjunction, through the production entry point', () => {
  it('a complete valid conjunction commits, and pushes', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');

    const committed = runTechnicalContinuation(sys, request(w, 'commit'));
    expect(committed.kind).toBe('DONE');
    if (committed.kind !== 'DONE') throw new Error(reasons(committed));
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');

    const pushed = runTechnicalContinuation(sys, request(w, 'push'));
    expect(pushed.kind).toBe('DONE');
    expect(git(w.root, 'rev-parse', 'origin/work').trim()).toBe(committed.head);
    cleanup(w);
  });

  it.each([
    ['no delegation at all', { problems: ['no delegation record exists'], carriesTechnicalScope: false, delegatedTo: '' }],
    ['a delegation that is not committed', INVALID],
    ['a delegation without the technical scope', NO_SCOPE],
  ])('refuses commit with %s', (_name, delegation) => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const out = runTechnicalContinuation(sys, { ...request(w, 'commit'), delegation });
    expect(out.kind).toBe('REFUSED');
    expect(reasons(out)).toContain('the owner performs it or it does not happen');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    cleanup(w);
  });

  it('refuses commit when the delegation is valid but there is no live checked decision', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const base = request(w, 'commit');
    const out = runTechnicalContinuation(sys, {
      ...base,
      decision: { ...base.decision, problems: ['decision was already consumed at 2026-08-30'] },
    });
    expect(out.kind).toBe('REFUSED');
    expect(reasons(out)).toContain('did not pass its own checks');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    cleanup(w);
  });

  it('refuses commit when the phase declares it, even with a proven delegation', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const out = runTechnicalContinuation(sys, { ...request(w, 'commit'), phaseOwnerGates: ACTIVE_PLAN_GATES });
    expect(out.kind).toBe('REFUSED');
    expect(reasons(out)).toContain("'commit' is owner-only for this phase");
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    cleanup(w);
  });

  // NOTHING ABSOLUTE IS REACHABLE BY THIS ROUTE. Two barriers, both proven: the action is not in the
  // closed technical vocabulary, and it is on the absolute floor.
  it.each(['force-push', 'production-deploy', 'payment-or-live-charge', 'secrets-handling', 'phase-closure', 'real-email-send'])(
    'refuses %s under an otherwise complete conjunction',
    (action) => {
      const w = world();
      writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
      const base = request(w, 'commit');
      const out = runTechnicalContinuation(sys, {
        ...base,
        action,
        decision: { ...base.decision, allowedActions: [action] },
      });
      expect(out.kind).toBe('REFUSED');
      expect(reasons(out)).toContain('is not one of the technical actions ProjectOS performs');
      expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
      cleanup(w);
    },
  );

  it('refuses an unknown action', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const base = request(w, 'commit');
    const out = runTechnicalContinuation(sys, {
      ...base,
      action: 'do-the-thing',
      decision: { ...base.decision, allowedActions: ['do-the-thing'] },
    });
    expect(out.kind).toBe('REFUSED');
    expect(reasons(out)).toContain('is not one of the technical actions ProjectOS performs');
    cleanup(w);
  });

  // THE CANDIDATE BINDING IS STILL LOAD-BEARING. The relaxation is about WHO may authorise, never
  // about WHAT was reviewed.
  it('refuses commit when the candidate changed after the decision, delegation notwithstanding', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const req = request(w, 'commit');
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewee\n');
    const out = runTechnicalContinuation(sys, req);
    expect(out.kind).toBe('REFUSED');
    expect(reasons(out)).toContain('the candidate changed after the gatekeeper reviewed it');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    cleanup(w);
  });

  it('refuses a decision bound to another project or another phase', () => {
    const w = world();
    writeFileSync(join(w.root, 'base.txt'), 'base\nreviewed\n');
    const base = request(w, 'commit');
    for (const wrong of [{ projectId: 'polygo' }, { phaseId: 'SOMETHING-ELSE1A' }]) {
      const out = runTechnicalContinuation(sys, { ...base, decision: { ...base.decision, ...wrong } });
      expect(out.kind).toBe('REFUSED');
      expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    }
    cleanup(w);
  });
});

describe('the ACTIVE ProjectOS plan, read from disk rather than asserted', () => {
  /**
   * THE FIXTURE ABOVE IS A CLAIM; THIS IS THE PROOF.
   *
   * Every other test here uses `ACTIVE_PLAN_GATES`, a constant that says what the plan declares. A
   * constant cannot notice the plan changing. This reads the real record and asserts the same
   * refusal, so "ProjectOS still cannot autonomously commit or push against its own approved plan"
   * is a fact about this repository and not a fact about a fixture.
   *
   * It is deliberately tolerant of the plan being absent or unreadable — a checkout without one is
   * not this project — but when it IS readable, the refusal must hold.
   */
  it('declares commit and push as owner gates, and they are still refused with a proven delegation', () => {
    // NO TOLERANT EARLY RETURN. An unreadable plan would make this test pass by doing nothing, which
    // is precisely the shape of a proof that stops proving anything the day the file moves. This test
    // ships in the repository that holds the plan, so it reads it and fails if it cannot.
    const planPath = new URL('../../../.projectops/plan.json', import.meta.url);
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as { phases?: unknown };
    expect(Array.isArray(plan.phases)).toBe(true);
    const phases = plan.phases as Array<Record<string, unknown>>;

    for (const phase of phases) {
      const gates = Array.isArray(phase['requiredOwnerGates']) ? (phase['requiredOwnerGates'] as string[]).map(String) : [];
      for (const action of gates.filter((g) => g === 'commit' || g === 'push')) {
        // With the strongest delegation this project can produce, the plan's own gate still wins.
        expect(refusesUnderCurrentPlan(action, gates, VALID)).toBe(true);
        expect(enforcedOwnerOnlyActions(gates, proven())).toContain(action);
      }
    }

    // And the plan really does declare them, so the loop above was not vacuous.
    const allGates = phases.flatMap((p) =>
      Array.isArray(p['requiredOwnerGates']) ? (p['requiredOwnerGates'] as string[]).map(String) : [],
    );
    expect(allGates).toContain('commit');
    expect(allGates).toContain('push');
  });
});

describe('nothing stored grants any of this', () => {
  // The request has no field for either, so a fabricated file has nowhere to enter. Asserted on the
  // shape rather than by writing one, because the point is that there is no parameter at all.
  it('the continuation request carries no evidence path and no checkpoint field', () => {
    const w = world();
    const req = request(w, 'commit');
    expect(Object.keys(req).sort()).toEqual(['action', 'at', 'context', 'decision', 'delegation', 'phaseOwnerGates']);
    expect(JSON.stringify(req)).not.toContain('work.v1.json');
    expect(JSON.stringify(req)).not.toContain('gatekeeper-decisions');
    cleanup(w);
  });
});

describe('degraded mode never yields', () => {
  /**
   * THE CONSTITUTIONAL PURPOSE OF THE OLD FLOOR, INTACT. Degraded mode is continuing WITHOUT a
   * reviewer, on the owner's committed risk. A delegation is not a reviewer and cannot stand in for
   * one, so the relaxation must not reach that path — and it cannot, because the relaxation is opt-in
   * by argument and degraded mode passes one argument.
   */
  it('degraded mode calls the enforcer with no condition, so commit and push stay owner-only', () => {
    const degradedSource = readFileSync(new URL('../src/loop/degradedMode.ts', import.meta.url), 'utf8');
    const calls = [...degradedSource.matchAll(/enforcedOwnerOnlyActions\(([^)]*)\)/g)].map((m) => m[1] as string);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).not.toContain(',');
    // And the behaviour those call sites get:
    for (const action of ['commit', 'push']) {
      expect(enforcedOwnerOnlyActions([]).includes(action)).toBe(true);
    }
  });
});

