/**
 * REPLAY: the gatekeeper contract, tested offline, deterministically, for nothing.
 *
 * Every governed run this project has made asked a paid reviewer a question and then checked the
 * answer against `checkGatekeeperDecision`. The CHECK is the thing that protects the repository —
 * it is what refuses a decision bound to the wrong commit, a stale decision replayed, an approval
 * naming an action the owner reserved. Until now the only way to exercise it end to end was to buy
 * an answer.
 *
 * So the answers are captured instead. `deriveFixtures.mjs` reads the committed decision records,
 * SUBSTITUTES the two fields a provider writes in prose — `reason` and `nextClaudeInstruction` —
 * normalises every id and commit to a deterministic stand-in, and keeps exactly the fields the
 * contract reads. Substituted rather than dropped, because the contract REQUIRES both: an
 * unexplained verdict is not reviewable and an approval that says nothing about what happens next is
 * not actionable, so a fixture missing them would prove the checker rejects a shape no real decision
 * has. What is left is the shape of a real decision with nothing of the moment it was made.
 *
 * WHAT REPLAY DOES NOT CAPTURE. Every committed decision was taken in a run that stopped for the
 * owner, so no historical fixture continues the work. The continuing verdicts, and the malformed
 * shapes no provider produces, are therefore built in this file and marked synthetic where they
 * appear — they are constructed evidence, and saying so is the difference between a fixture and a
 * claim.
 *
 * ZERO PROVIDER SPEND, BY CONSTRUCTION. Nothing here can reach a network: the fixtures are files,
 * the checker is pure, and no transport, credential or broker is imported. That is not a promise
 * about behaviour, it is a property of what this file is able to call.
 *
 * WHAT REPLAY IS NOT. It does not decide anything, and it grants nothing. Passing replay says the
 * checker still refuses what it always refused; it says nothing about whether a real decision
 * exists. Paid dispatch remains subject to the mandatory Doctor preflight and every owner gate.
 */
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkGatekeeperDecision,
  enforcedOwnerOnlyActions,
  technicalDelegationCondition,
  ALWAYS_OWNER_ONLY,
  GATEKEEPER_VERDICTS,
  type GatekeeperDecisionRecord,
} from '@projectos/core';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function load(name: string): GatekeeperDecisionRecord {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as GatekeeperDecisionRecord;
}

const ALL = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();
const ACCEPTED = ALL.filter((f) => f.startsWith('accepted-'));
/**
 * Real committed decisions the CURRENT contract refuses.
 *
 * Every one was accepted when it was made. All three carry no `nextClaudeInstruction`, a requirement
 * the checker gained afterwards — and two of them additionally grant `commit` and `push` outright,
 * which the enforced floor refuses unless a technical delegation released those two actions. That
 * second refusal was invisible while this suite measured fixtures against a private owner-only list
 * of its own invention; it is asserted explicitly below.
 *
 * They are kept, and named for what they are, because they are the most interesting fixtures here:
 * genuine historical evidence that the contract tightened, and a standing proof that it still
 * refuses an under-specified decision.
 */
const REFUSED = ALL.filter((f) => f.startsWith('refused-'));

/** Expectations that MATCH a fixture, so any failure is the mutation under test and nothing else. */
function expectationsFor(r: GatekeeperDecisionRecord) {
  return {
    projectId: String((r as unknown as Record<string, unknown>)['projectId']),
    phaseId: String((r as unknown as Record<string, unknown>)['phaseId']),
    subjectCommit: String((r as unknown as Record<string, unknown>)['subjectCommit']),
    requestDigest: String((r as unknown as Record<string, unknown>)['requestDigest']),
    expectedDecider: 'ChatGPT',
    alreadyConsumedDecisionIds: [] as readonly string[],
    // THE REAL FLOOR, IMPORTED FROM THE CONSTITUTION — never retyped here.
    //
    // This line used to read `['merge','force-push','deploy','phase-closure']`. That list is not the
    // one the runtime enforces: it omits `commit` and `push`. So replay ran every fixture under a
    // laxer rule than production, and the single most safety-critical property of this contract —
    // that a gatekeeper decision can RECOMMEND a commit and can never GRANT one — was never
    // exercised at all. Importing it means the suite cannot drift from the rule it claims to test.
    ownerOnlyActions: ALWAYS_OWNER_ONLY as readonly string[],
  };
}

/** A fixture with one field changed. Returns a NEW record; fixtures are never mutated. */
function mutated(r: GatekeeperDecisionRecord, over: Record<string, unknown>): GatekeeperDecisionRecord {
  return { ...(r as unknown as Record<string, unknown>), ...over } as unknown as GatekeeperDecisionRecord;
}

/**
 * A SYNTHETIC continuing decision, built from a real accepted shape.
 *
 * No captured decision continues — every one stopped for the owner — so the continuation branch has
 * no historical evidence to derive from and this is constructed instead. It changes exactly the
 * three fields that make a verdict continuable, so a failure is the rule under test and not the
 * fixture's own history.
 */
function continuation(r: GatekeeperDecisionRecord, over: Record<string, unknown> = {}): GatekeeperDecisionRecord {
  return mutated(r, {
    decision: 'APPROVED_TO_PROCEED',
    ownerApprovalRequired: false,
    nextClaudeInstruction: 'Replay fixture: synthetic continuation instruction.',
    ...over,
  });
}

describe('replay: accepted shapes still pass the contract', () => {
  test('there are fixtures, derived from real committed decisions', () => {
    // A suite that silently found no fixtures would pass every test below by iterating nothing.
    expect(ACCEPTED.length).toBeGreaterThan(0);
  });

  test.each(ACCEPTED)('%s is accepted against its own expectations', (name) => {
    const r = load(name);
    expect(checkGatekeeperDecision(r, expectationsFor(r))).toEqual([]);
  });

  // EVERY fixture, not only the accepted ones. A refused fixture is committed to this repository
  // exactly like an accepted one, and the scan used to skip all three of them for no reason beyond
  // which describe block it happened to live in.
  test('no fixture carries provider prose, a credential, or a raw prompt', () => {
    expect(ALL.length).toBe(ACCEPTED.length + REFUSED.length);
    for (const name of ALL) {
      const raw = readFileSync(join(FIXTURES, name), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const keys = Object.keys(parsed);
      // The contract REQUIRES `reason`, so it is present -- but it is a fixed stand-in, never the
      // provider's own words. Asserting the exact substitute is what proves no prose leaked in.
      if ('reason' in parsed) expect(String(parsed['reason'])).toContain('Replay fixture');
      if ('nextClaudeInstruction' in parsed) expect(String(parsed['nextClaudeInstruction'])).toContain('Replay fixture');
      expect(keys).not.toContain('prompt');
      expect(keys).not.toContain('response');
      expect(keys).not.toContain('messages');
      // NOTHING KEY-SHAPED — WRITTEN WITHOUT A SINGLE BACKSLASH ESCAPE, DELIBERATELY.
      //
      // This assertion was dead. The previous version read `/\bsk-[A-Za-z0-9]{20,}/` in intent, but
      // the backslash-b did not survive being written through a shell heredoc: the file held a
      // literal BACKSPACE byte (0x08), so the pattern only matched a control character followed by
      // `sk-` and could never fire on anything. A secret scan that cannot match is worse than none,
      // because it reports a clean result. This is the third time a mis-escaped regex has produced a
      // silently vacuous check in this codebase; the standing lesson is to write patterns that have
      // no escape to lose.
      //
      // So the word boundary is spelled out as a character class instead. `(^|[^A-Za-z0-9])` is
      // exactly the guard that keeps `risk-acceptance` — a phrase this project's governance
      // vocabulary uses constantly — from firing, and it cannot be mangled by any quoting layer.
      //
      // The body allows internal hyphens because every modern key shape carries a hyphenated prefix
      // (`sk-proj-`, `sk-ant-`, `sk-svcacct-`, `sk-admin-`) that breaks a run of straight
      // alphanumerics long before twenty characters. The earlier pattern would have missed all four.
      expect(raw).not.toMatch(/(^|[^A-Za-z0-9])sk-[A-Za-z0-9][A-Za-z0-9-]{19,}/);
      expect(raw).not.toMatch(/(^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{20,}/);
      expect(raw).not.toMatch(/(^|[^A-Za-z0-9])(github_pat|sbp|sk_live|pk_live|xox[baprs])[_-][A-Za-z0-9_-]{16,}/);
      expect(raw.length).toBeLessThan(4000);
    }
  });
});

describe('replay: decisions the contract has since outgrown', () => {
  test('there are historical shapes the current contract refuses', () => {
    expect(REFUSED.length).toBeGreaterThan(0);
  });

  test.each(REFUSED)('%s is refused, and says why', (name) => {
    const r = load(name);
    const problems = checkGatekeeperDecision(r, expectationsFor(r));
    expect(problems.length).toBeGreaterThan(0);
    // Each of these was accepted when it was made. What refuses them now is a requirement the
    // checker gained later, and the refusal names it rather than failing vaguely.
    expect(problems.join(' ')).toContain('nextClaudeInstruction');
  });
});

describe('replay: the contract refuses what it must refuse', () => {
  const base = () => load(ACCEPTED[0] as string);

  test('an absent decision is not an approval', () => {
    const problems = checkGatekeeperDecision(null, expectationsFor(base()));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('not an approval');
  });

  test('a decision bound to another commit is refused', () => {
    const r = base();
    const problems = checkGatekeeperDecision(mutated(r, { subjectCommit: 'b'.repeat(40) }), expectationsFor(r));
    expect(problems.length).toBeGreaterThan(0);
  });

  test('a decision for another phase is refused', () => {
    const r = base();
    expect(checkGatekeeperDecision(mutated(r, { phaseId: 'some-other-phase' }), expectationsFor(r)).length).toBeGreaterThan(0);
  });

  test('a decision for another project is refused', () => {
    const r = base();
    expect(checkGatekeeperDecision(mutated(r, { projectId: 'polygo' }), expectationsFor(r)).length).toBeGreaterThan(0);
  });

  test('a decision over different request bytes is refused', () => {
    const r = base();
    const other = 'sha256:' + 'c'.repeat(64);
    expect(checkGatekeeperDecision(mutated(r, { requestDigest: other }), expectationsFor(r)).length).toBeGreaterThan(0);
  });

  test('a decision already spent cannot be replayed', () => {
    const r = base();
    const id = String((r as unknown as Record<string, unknown>)['decisionId']);
    const problems = checkGatekeeperDecision(r, { ...expectationsFor(r), alreadyConsumedDecisionIds: [id] });
    expect(problems.join(' ')).toContain('already acted on');
  });

  test('a decider who is not the one the plan names is refused', () => {
    const r = base();
    expect(checkGatekeeperDecision(r, { ...expectationsFor(r), expectedDecider: 'SomeoneElse' }).length).toBeGreaterThan(0);
  });

  test('the implementer can never be the decider, however the record names itself', () => {
    const r = base();
    for (const name of ['Claude', 'claude-local', 'the implementer', 'worker']) {
      const problems = checkGatekeeperDecision(mutated(r, { decidedBy: name }), {
        ...expectationsFor(r),
        expectedDecider: name,
      });
      expect(problems.length).toBeGreaterThan(0);
    }
  });

  test('an approval naming an owner-reserved action is refused', () => {
    const r = base();
    const problems = checkGatekeeperDecision(mutated(r, { allowedActions: ['commit', 'deploy'] }), expectationsFor(r));
    expect(problems.length).toBeGreaterThan(0);
  });

  test('a malformed allowedActions is refused rather than coerced', () => {
    const r = base();
    for (const bad of [null, 'commit', 42, [1, 2], [{}], undefined]) {
      expect(checkGatekeeperDecision(mutated(r, { allowedActions: bad }), expectationsFor(r)).length).toBeGreaterThan(0);
    }
  });

  test('an unrecognised schemaVersion is refused', () => {
    const r = base();
    expect(checkGatekeeperDecision(mutated(r, { schemaVersion: '9.9.9' }), expectationsFor(r)).length).toBeGreaterThan(0);
  });

  test('a decision with no usable id is refused', () => {
    const r = base();
    for (const bad of ['', '   ', null, 42]) {
      expect(checkGatekeeperDecision(mutated(r, { decisionId: bad }), expectationsFor(r)).length).toBeGreaterThan(0);
    }
  });

  test('every refusal names every reason, not merely the first', () => {
    // An operator who fixes one field and hits the next learns to distrust the message.
    const r = base();
    const problems = checkGatekeeperDecision(
      mutated(r, { phaseId: 'wrong', projectId: 'wrong', subjectCommit: 'd'.repeat(40) }),
      expectationsFor(r),
    );
    expect(problems.length).toBeGreaterThan(1);
  });
});

/**
 * THE ONE PROPERTY THIS CONTRACT EXISTS FOR.
 *
 * A gatekeeper may say "I would commit this now". It may never commit. Everything else the checker
 * does — the bindings, the replay guard, the decider check — protects a decision's PROVENANCE; this
 * protects its AUTHORITY, and it is the rule an approving reviewer is most likely to try to talk its
 * way past. Until this block existed, replay tested it under a private list that omitted `commit`
 * and `push` entirely, so the suite was green and the property was untested.
 */
describe('replay: the gatekeeper may recommend a protected action and may never grant one', () => {
  const base = () => load(ACCEPTED[0] as string);

  test('the floor under test is the constitution, not a list this file invented', () => {
    // Pinned so REMOVING an action from the floor fails here rather than silently widening what a
    // decision may authorise. Additions are fine; this asserts containment, not equality.
    for (const action of ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge']) {
      expect(ALWAYS_OWNER_ONLY as readonly string[]).toContain(action);
    }
  });

  test.each(ALWAYS_OWNER_ONLY as readonly string[])(
    'a decision granting the owner-only action %s is refused, and names it',
    (action) => {
      const r = base();
      const problems = checkGatekeeperDecision(mutated(r, { allowedActions: [action] }), expectationsFor(r));
      expect(problems.join(' ')).toContain(`grants '${action}'`);
      expect(problems.join(' ')).toContain('can never authorise it');
    },
  );

  test('every real REFUSED fixture that grants commit or push is refused FOR that, not only for its shape', () => {
    // The three historical fixtures were captured because they lack `nextClaudeInstruction`. Two of
    // them also grant `commit` and `push` outright. Under the old private list that second, far more
    // serious defect was invisible; asserting it here is what keeps it visible.
    const granting = REFUSED.map(load).filter((r) => {
      const allowed = (r as unknown as Record<string, unknown>)['allowedActions'];
      return Array.isArray(allowed) && allowed.some((a) => (ALWAYS_OWNER_ONLY as readonly string[]).includes(String(a)));
    });
    expect(granting.length).toBeGreaterThan(0);
    for (const r of granting) {
      expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain('can never authorise it');
    }
  });

  test('WITHOUT a proven delegation the computed floor keeps commit and push', () => {
    // THE STRICT DIRECTION, WHICH IS THE ONE THAT MATTERS. Every test below asserts what a
    // delegation is allowed to RELEASE; a mutation harness showed that if the conditional half were
    // dropped from the computation entirely — so that commit and push fell out of the floor even
    // when no delegation existed — not one test failed. The default path is the one degraded mode
    // and reconciliation take, and it must be the strictest, not merely different.
    for (const action of ALWAYS_OWNER_ONLY as readonly string[]) {
      expect(enforcedOwnerOnlyActions([], undefined)).toContain(action);
      expect(enforcedOwnerOnlyActions([], null)).toContain(action);
    }

    // ...and a decision granting commit is refused under that computed floor, not merely under the
    // constant — the runtime measures decisions against the computed one.
    const r = continuation(base(), { allowedActions: ['commit'] });
    expect(
      checkGatekeeperDecision(r, { ...expectationsFor(r), ownerOnlyActions: enforcedOwnerOnlyActions([], undefined) })
        .join(' '),
    ).toContain("grants 'commit'");
  });

  test('a proven technical delegation releases commit and push — and nothing else', () => {
    // This is the live path the two historical fixtures were written for, and the reason the floor is
    // computed rather than constant. A delegation the owner proved may lower the two conditionally
    // delegable actions; the absolute three do not move, however good the delegation is.
    const condition = technicalDelegationCondition({ problems: [], carriesTechnicalScope: true });
    expect(condition).not.toBeNull();
    const relaxed = enforcedOwnerOnlyActions([], condition);

    expect(relaxed).not.toContain('commit');
    expect(relaxed).not.toContain('push');
    for (const absolute of ['phase-closure', 'secrets-handling', 'payment-or-live-charge']) {
      expect(relaxed).toContain(absolute);
    }

    // ...and the checker actually honours the relaxed floor, rather than the relaxation being a fact
    // about one helper that no decision is ever measured against.
    const r = continuation(base(), { allowedActions: ['commit', 'push'] });
    expect(checkGatekeeperDecision(r, { ...expectationsFor(r), ownerOnlyActions: relaxed })).toEqual([]);
    expect(
      checkGatekeeperDecision(continuation(base(), { allowedActions: ['phase-closure'] }), {
        ...expectationsFor(r),
        ownerOnlyActions: relaxed,
      }).join(' '),
    ).toContain("grants 'phase-closure'");
  });
});

/**
 * THE CONTINUATION BRANCH, WHICH NO REAL FIXTURE REACHES.
 *
 * Every captured decision is `AWAITING_OWNER`, because every one was taken in a run that stopped for
 * the owner. So the branch that matters when the loop is allowed to KEEP GOING had no coverage at
 * all: a suite of nine fixtures proved only what happens when nothing continues. These records are
 * built in the test, from an accepted fixture, changing one field at a time — synthetic by
 * construction, and marked as such, because no historical evidence of this shape exists to capture.
 */
describe('replay: verdicts that let the work continue', () => {
  const base = () => load(ACCEPTED[0] as string);

  test.each(['APPROVED_TO_PROCEED', 'AMENDMENT_REQUIRED'])(
    '%s with an instruction is accepted, and the same verdict without one is refused',
    (verdict) => {
      const ok = continuation(base(), { decision: verdict });
      expect(checkGatekeeperDecision(ok, expectationsFor(ok))).toEqual([]);

      const silent = mutated(ok, { nextClaudeInstruction: undefined });
      expect(checkGatekeeperDecision(silent, expectationsFor(silent)).join(' ')).toContain(
        `verdict ${verdict} continues the work but records no nextClaudeInstruction`,
      );
    },
  );

  test.each(['APPROVED_TO_COMMIT', 'APPROVED_TO_PUSH', 'APPROVED_FOR_CLOSURE'])(
    '%s is owner-gated, so a record claiming no owner approval is needed is refused',
    (verdict) => {
      // The dangerous half of the inconsistency is not the verdict, it is the flag: the runtime reads
      // `ownerApprovalRequired` and would skip the gate.
      const r = mutated(base(), { decision: verdict, ownerApprovalRequired: false });
      expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain('is owner-gated');
    },
  );

  test('an owner-gated verdict that does say so is accepted', () => {
    const r = mutated(base(), { decision: 'APPROVED_TO_COMMIT', ownerApprovalRequired: true });
    expect(checkGatekeeperDecision(r, expectationsFor(r))).toEqual([]);
  });

  test('every verdict in the vocabulary is either continuing or owner-gated or neither, and none crashes the checker', () => {
    // A verdict added to the vocabulary without a matching rule would otherwise reach production
    // untested. This does not assert which class it lands in — only that the checker classifies it
    // rather than throwing.
    for (const verdict of GATEKEEPER_VERDICTS) {
      const r = mutated(base(), { decision: verdict });
      expect(() => checkGatekeeperDecision(r, expectationsFor(r))).not.toThrow();
    }
  });
});

/**
 * RULES NO FIXTURE EXERCISES, BECAUSE NO REAL DECISION IS MALFORMED IN THESE WAYS.
 *
 * Six checks had no test able to fail: each could have been deleted with the suite green. They are
 * the checks that catch a truncated, hand-edited or half-written record — exactly the states a real
 * provider never produces and a mistake very much does.
 */
describe('replay: the malformed shapes no provider produces', () => {
  const base = () => load(ACCEPTED[0] as string);

  test('a decision already marked consumed cannot be replayed, whatever the runtime remembers', () => {
    // The marker lives in the RECORD, so wiping runtime state cannot un-spend it. That is the point
    // of the field, and nothing tested it.
    const r = mutated(base(), { consumedAt: '2026-01-01T00:00:02.000Z' });
    expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain('already consumed at');
  });

  test('a decision with no decidedAt is refused', () => {
    for (const bad of [undefined, null, '', '   ', 42]) {
      const r = mutated(base(), { decidedAt: bad });
      expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain('records no decidedAt');
    }
  });

  test('an unexplained verdict is not reviewable, so a missing reason is refused', () => {
    for (const bad of [undefined, null, '', '   ']) {
      const r = mutated(base(), { reason: bad });
      expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain('records no reason');
    }
  });

  test('a non-array forbiddenActions is refused rather than read as empty', () => {
    for (const bad of [undefined, null, 'commit', 42, {}]) {
      const r = mutated(base(), { forbiddenActions: bad });
      expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain('declares no forbiddenActions list');
    }
  });

  test('ownerApprovalRequired must be a boolean, not a truthy string', () => {
    // 'false' and 0 are the interesting ones: a JSON round-trip through a form or a shell would
    // produce exactly these, and either would be read the wrong way round by a truthiness check.
    for (const bad of [undefined, null, 'true', 'false', 0, 1]) {
      const r = mutated(base(), { ownerApprovalRequired: bad });
      expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain(
        'does not state ownerApprovalRequired as a boolean',
      );
    }
  });

  test('a verdict outside the closed vocabulary is refused, however encouraging it reads', () => {
    // AN UNKNOWN VERDICT IS NOT A PERMISSIVE ONE. A model that invents 'LOOKS_GOOD' must not have it
    // read as approval.
    for (const bad of ['LOOKS_GOOD', 'approved_to_proceed', 'OK', '', null, 42, undefined]) {
      const r = mutated(base(), { decision: bad });
      expect(checkGatekeeperDecision(r, expectationsFor(r)).join(' ')).toContain('is not one of the recognised verdicts');
    }
  });
});

describe('replay costs nothing and reaches nothing', () => {
  test('this suite imports nothing that could reach a provider', () => {
    // A property of what this file can CALL, not a promise about how it behaves.
    //
    // ONLY THE IMPORT LINES ARE READ. An earlier version scanned the whole file for forbidden
    // module names and failed on the very list it was checking for -- the names were in its own
    // source. Reading the imports and asserting the WHOLE SET is also stricter: a forbidden-name
    // list only catches what someone thought of, while an exact allowlist catches anything new.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    // MATCHED AS STATEMENTS, NOT AS LINES. The line-based version broke the moment an import needed
    // more than one line: it read `import {` (no module) and never saw the `} from '...'` that
    // closes it, so a real dependency would have vanished from the allowlist and the check would
    // still have passed. Anchoring on a line-initial `import` keeps prose in comments out, since no
    // comment line here begins in column zero with that word.
    const modules = [...self.matchAll(/^import [\s\S]*?from '([^']+)';/gm)].map((m) => m[1] as string).sort();
    expect(modules.length).toBeGreaterThan(0);
    expect(modules).toEqual(['@projectos/core', 'node:fs', 'node:path', 'node:url', 'vitest']);
  });
});
