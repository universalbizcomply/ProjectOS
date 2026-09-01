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

describe('the ACTIVE ProjectOS plan, resolved canonically rather than assumed', () => {
  /**
   * THE FIXTURE ABOVE IS A CLAIM; THIS IS THE PROOF — AND IT RESOLVES THE PLAN THE WAY THE RUNTIME
   * DOES.
   *
   * An earlier version of this test read `.projectops/plan.json` directly. That file exists, parses,
   * and is NOT the active plan: the active one is named by `planMemory.planPath` and is versioned, so
   * the test went on passing against a stale record after the plan it claimed to describe had been
   * amended. A proof that reads the wrong file is worse than no proof, because it reports success.
   *
   * What is asserted is the RELATIONSHIP, not a fixed expectation: whatever the active plan declares
   * as an owner gate is still refused even under the strongest delegation this project can produce,
   * and every absolute action is refused whether the plan mentions it or not. That stays true across
   * an amendment, which a hardcoded list of gates does not.
   */
  it('honours whatever owner gates the active plan declares, and the absolute floor regardless', () => {
    const cfg = JSON.parse(
      readFileSync(new URL('../../../.projectops/project-config.json', import.meta.url), 'utf8'),
    ) as { planMemory?: { planPath?: string } };
    const planRel = cfg.planMemory?.planPath;
    const stateRel = cfg.planMemory?.currentStatePath;
    expect(typeof planRel).toBe('string');
    expect(typeof stateRel).toBe('string');
    const plan = JSON.parse(
      readFileSync(new URL(`../../../${planRel as string}`, import.meta.url), 'utf8'),
    ) as { phases?: unknown; planId?: unknown };
    // THE PLAN READ IS THE PLAN IN FORCE, not merely a valid one. Without this the test asserts a
    // relationship that holds for every plan record in the repository — including the stale
    // pre-amendment one it used to read by accident — so it could never notice reading the wrong file.
    const state = JSON.parse(
      readFileSync(new URL(`../../../${stateRel as string}`, import.meta.url), 'utf8'),
    ) as { activePlanId?: unknown };
    expect(plan.planId).toBe(state.activePlanId);
    expect(Array.isArray(plan.phases)).toBe(true);
    const phases = plan.phases as Array<Record<string, unknown>>;
    expect(phases.length).toBeGreaterThan(0);

    for (const phase of phases) {
      const gates = Array.isArray(phase['requiredOwnerGates'])
        ? (phase['requiredOwnerGates'] as string[]).map(String)
        : [];
      // A DECLARED GATE STILL WINS over the strongest delegation. The plan may be stricter.
      for (const gate of gates) {
        expect(enforcedOwnerOnlyActions(gates, proven())).toContain(gate);
      }
      // AND THE ABSOLUTE FLOOR HOLDS whether this phase remembered to declare it or not — which is
      // the half a plan amendment must never be able to weaken.
      for (const absolute of ABSOLUTE_OWNER_ONLY) {
        expect(enforcedOwnerOnlyActions(gates, proven())).toContain(absolute);
        expect(refusesUnderCurrentPlan(absolute, gates, VALID)).toBe(true);
      }
      // Commit and push follow the plan: gated where declared, delegable where not.
      for (const technical of ['commit', 'push']) {
        expect(refusesUnderCurrentPlan(technical, gates, VALID)).toBe(gates.includes(technical));
        // With no delegation at all they are refused either way.
        expect(refusesUnderCurrentPlan(technical, gates)).toBe(true);
      }
    }
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

