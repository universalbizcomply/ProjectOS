/**
 * The durable half of degraded mode: a risk acceptance is authority only as COMMITTED bytes.
 *
 * `checkDegradedModeGrant` has always refused a grant whose `readFromCommittedTree` is not true. The
 * flag was supplied by the caller, and nothing produced it from git — every call site hand-wrote
 * `true` on a literal. The contract was complete and the committed-read path did not exist, so the
 * one artefact that lets work proceed unreviewed was the one artefact any process could write and
 * have honoured. These tests prove the path, and prove that the pure contract still refuses
 * everything it claimed to.
 *
 * The path tests are not cosmetic: this project's `.gitignore` excludes `secret*` and `*token*`, so
 * a layout git silently ignores would let an owner commit and see nothing tracked.
 */
import { describe, it, expect } from 'vitest';
import type { System } from '../src/system.js';
import {
  degradedGrantRelPath,
  degradedGrantPath,
  isSafeGrantId,
  grantIsCommitted,
  readCommittedGrant,
  loadDegradedModeGrant,
  grantPathIsIgnored,
} from '../src/loop/degradedModeGrants.js';
import {
  checkDegradedModeGrant,
  DEGRADED_MODE_SCHEMA_VERSION,
  DEGRADED_MODE_CHOICE,
} from '@projectos/core';

const ROOT = 'C:/dev/ProjectOS';
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const GRANT_ID = 'DEGRADED-GRANT-1A';
const SUBJECT = '87f720f20cae44bf0e305584d6bd7325292b5989';
const OUTAGE = 'GKOUT-1a2b3c4d5e6f';
const OWNER = 'Murad';
const OWNER_ONLY = ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'];

/**
 * A grant whose CONTENT is beyond reproach, so that every refusal below is caused by the one thing
 * the test is about and not by a stray invalid field.
 *
 * NOT AN OWNER RECORD. `grantedBy` names the owner because the contract requires the granter to be
 * the recorded owner, and this fixture exists to exercise that comparison. It lives in a test file,
 * is never written to `.projectops/`, and is never committed. No real risk acceptance exists.
 */
function validGrantFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: DEGRADED_MODE_SCHEMA_VERSION,
    grantId: GRANT_ID,
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    unavailabilityId: OUTAGE,
    ownerChoice: DEGRADED_MODE_CHOICE,
    grantedBy: OWNER,
    grantedAt: '2026-08-19T10:00:00.000Z',
    reason: 'fixture: the reviewer is unreachable and the bounded work is worth the unreviewed risk',
    grantedScope: ['implement'],
    maxWorkItems: 3,
    ...over,
  };
}

function expectations(over: Record<string, unknown> = {}) {
  return {
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    unavailabilityId: OUTAGE,
    recordedOwner: OWNER,
    ownerOnlyActions: OWNER_ONLY,
    alreadyConsumedGrantIds: [] as string[],
    readFromCommittedTree: true,
    ...over,
  };
}

/**
 * A git and a filesystem that answer exactly what the test says, and record what they were asked.
 *
 * `show` and `readText` are deliberately allowed to return DIFFERENT bytes, because the whole
 * question this file exists to settle is which of the two the runtime honours.
 */
function fake(opts: {
  log?: { code: number; stdout: string };
  diff?: { code: number; stdout: string };
  show?: { code: number; stdout: string };
  checkIgnore?: { code: number; stdout: string };
  onDisk?: string | null;
}): { sys: System; calls: string[][] } {
  const calls: string[][] = [];
  const sys = {
    exec: (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      const verb = args.includes('check-ignore')
        ? 'checkIgnore'
        : args.includes('log')
          ? 'log'
          : args.includes('diff')
            ? 'diff'
            : 'show';
      // `check-ignore` exits 1 when the path is NOT ignored, which is the normal case.
      const answer = opts[verb] ?? (verb === 'checkIgnore' ? { code: 1, stdout: '' } : { code: 1, stdout: '' });
      return { code: answer.code, stdout: answer.stdout, stderr: '' };
    },
    readText: (_p: string) => (opts.onDisk === undefined ? null : opts.onDisk),
  } as unknown as System;
  return { sys, calls };
}

const committedBytes = (grant: Record<string, unknown>) => ({
  log: { code: 0, stdout: 'abc1234\n' },
  diff: { code: 0, stdout: '' },
  show: { code: 0, stdout: JSON.stringify(grant) },
});

describe('the grant path', () => {
  it('is flat and lives with the other owner authority records', () => {
    expect(degradedGrantRelPath(PHASE, GRANT_ID)).toBe(
      `.projectops/authority/${PHASE}.degraded-grant.${GRANT_ID}.json`,
    );
  });

  it('builds an absolute path under the governed root', () => {
    expect(degradedGrantPath(ROOT, PHASE, GRANT_ID)).toContain('authority');
    expect(degradedGrantPath(ROOT, PHASE, GRANT_ID)).toContain(`${PHASE}.degraded-grant.${GRANT_ID}.json`);
  });

  it.each(['../escape', 'a/b', 'a\\b', '', 'x', 'has space', 'name.with.dots', 'a'.repeat(129)])(
    'refuses %s as a grant id rather than sanitising it',
    (grantId) => {
      expect(isSafeGrantId(grantId)).toBe(false);
      expect(degradedGrantRelPath(PHASE, grantId)).toBeNull();
      expect(degradedGrantPath(ROOT, PHASE, grantId)).toBeNull();
    },
  );

  it('refuses an unsafe phase id too, so neither half can escape the directory', () => {
    expect(degradedGrantRelPath('../../etc', GRANT_ID)).toBeNull();
  });
});

describe('PROOF A — an uncommitted grant has no authority', () => {
  it('reports a perfect working-tree grant as NOT committed, and the contract refuses it', () => {
    // Nothing in git; a flawless grant sitting on disk.
    const { sys } = fake({ onDisk: JSON.stringify(validGrantFixture()) });
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);

    expect(loaded.readFromCommittedTree).toBe(false);
    // AUTHORITY FIELD IS EMPTY. A caller that checks only `grant` still cannot proceed.
    expect(loaded.grant).toBeNull();
    // …and the real cause is still available, from a field that cannot be mistaken for authority.
    expect(loaded.uncommittedGrantOnDisk).not.toBeNull();

    const problems = checkDegradedModeGrant(
      loaded.grant,
      expectations({ readFromCommittedTree: loaded.readFromCommittedTree }),
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('refuses a grant that WAS committed and has since been edited in the working tree', () => {
    // `git log` finds it, `git diff HEAD` says it is dirty. Without the second question the
    // committed version would launder the edit.
    const { sys } = fake({
      log: { code: 0, stdout: 'abc1234\n' },
      diff: { code: 0, stdout: `.projectops/authority/${PHASE}.degraded-grant.${GRANT_ID}.json\n` },
      show: { code: 0, stdout: JSON.stringify(validGrantFixture()) },
      onDisk: JSON.stringify(validGrantFixture({ maxWorkItems: 999 })),
    });
    expect(grantIsCommitted(sys, ROOT, PHASE, GRANT_ID)).toBe(false);

    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
    expect(loaded.readFromCommittedTree).toBe(false);
    expect(loaded.grant).toBeNull();
    // The dirtied copy is diagnostic only — note it carries the WIDENED bound, and grants nothing.
    expect((loaded.uncommittedGrantOnDisk as Record<string, unknown>)['maxWorkItems']).toBe(999);
    expect(checkDegradedModeGrant(loaded.grant, expectations({ readFromCommittedTree: false })).length).toBeGreaterThan(0);
  });

  it('treats any git failure as not committed', () => {
    for (const broken of [{ log: { code: 128, stdout: '' } }, { log: { code: 0, stdout: '' } }, { log: { code: 0, stdout: 'abc\n' }, diff: { code: 128, stdout: '' } }]) {
      const { sys } = fake(broken);
      expect(grantIsCommitted(sys, ROOT, PHASE, GRANT_ID)).toBe(false);
    }
  });

  it('cannot be given authority by an unsafe path either', () => {
    const { sys } = fake(committedBytes(validGrantFixture()));
    expect(loadDegradedModeGrant(sys, ROOT, PHASE, '../../evil')).toEqual({
      grant: null,
      readFromCommittedTree: false,
      uncommittedGrantOnDisk: null,
      pathIsGitIgnored: false,
    });
  });
});

describe('PROOF B — a committed grant is read from committed truth', () => {
  it('accepts a valid committed grant, and reads the git object rather than the file', () => {
    const { sys, calls } = fake(committedBytes(validGrantFixture()));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);

    expect(loaded.readFromCommittedTree).toBe(true);
    expect(checkDegradedModeGrant(loaded.grant, expectations())).toEqual([]);

    // The bytes came from `git show HEAD:<rel>`, under `-C root`.
    const show = calls.find((c) => c.includes('show'));
    expect(show).toBeDefined();
    expect(show?.join(' ')).toContain(`HEAD:.projectops/authority/${PHASE}.degraded-grant.${GRANT_ID}.json`);
    expect(show?.slice(0, 3)).toEqual(['git', '-C', ROOT]);
  });

  it('honours the COMMITTED bytes when the working-tree copy says something else', () => {
    // The decisive test. Committed: bounded to 3 items, implement only. On disk: 999 items and
    // `push`. If the loader ever read the file, this grant would authorise a protected action.
    const { sys } = fake({
      ...committedBytes(validGrantFixture()),
      onDisk: JSON.stringify(validGrantFixture({ maxWorkItems: 999, grantedScope: ['implement', 'push'] })),
    });
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);

    expect(loaded.readFromCommittedTree).toBe(true);
    expect((loaded.grant as Record<string, unknown>)['maxWorkItems']).toBe(3);
    expect((loaded.grant as Record<string, unknown>)['grantedScope']).toEqual(['implement']);
    expect(checkDegradedModeGrant(loaded.grant, expectations())).toEqual([]);
  });

  it('does not fall back to the working tree when the committed object will not parse', () => {
    const { sys } = fake({
      log: { code: 0, stdout: 'abc1234\n' },
      diff: { code: 0, stdout: '' },
      show: { code: 0, stdout: 'not json at all' },
      onDisk: JSON.stringify(validGrantFixture()),
    });
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);

    expect(loaded.grant).toBeNull();
    expect(loaded.readFromCommittedTree).toBe(false);
    // The on-disk copy is reachable for the message, and is not the grant.
    expect(loaded.uncommittedGrantOnDisk).not.toBeNull();
  });

  it('returns null for a committed object that is an array or a scalar', () => {
    for (const body of ['[1,2,3]', '"a string"', '42']) {
      const { sys } = fake({ log: { code: 0, stdout: 'a\n' }, diff: { code: 0, stdout: '' }, show: { code: 0, stdout: body } });
      expect(readCommittedGrant(sys, ROOT, PHASE, GRANT_ID)).toBeNull();
    }
  });
});

describe('PROOF C — binding refusals', () => {
  // The GRANT is mutated and the expectations describe the real run, because that is the actual
  // scenario: a grant committed for other work, presented against this one.
  it.each([
    ['wrong project', { projectId: 'someone-elses-project' }, "not 'projectos'"],
    ['wrong phase', { phaseId: 'OTHER-PHASE1A' }, `not '${PHASE}'`],
    ['wrong subject commit', { subjectCommit: 'b'.repeat(40) }, 'risk accepted for other work'],
    ['wrong outage identity', { unavailabilityId: 'GKOUT-different' }, 'cannot carry over to a later outage'],
  ])('refuses a committed grant bound to the %s', (_label, over, fragment) => {
    const { sys } = fake(committedBytes(validGrantFixture(over)));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
    expect(loaded.readFromCommittedTree).toBe(true); // committed — the refusal is the binding, not provenance
    const problems = checkDegradedModeGrant(loaded.grant, expectations());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes(fragment))).toBe(true);
  });

  it('refuses a grant recording an owner choice that is not the risk-acceptance sentence', () => {
    const { sys } = fake(committedBytes(validGrantFixture({ ownerChoice: 'CONTINUE' })));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
    expect(checkDegradedModeGrant(loaded.grant, expectations()).some((p) => p.includes('degraded mode opens only on'))).toBe(true);
  });

  it.each([
    ['the implementer', 'Claude'],
    ['a model', 'ChatGPT'],
    ['anyone who is not the recorded owner', 'Somebody Else'],
  ])('refuses a grant made by %s', (_label, grantedBy) => {
    const { sys } = fake(committedBytes(validGrantFixture({ grantedBy })));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
    expect(checkDegradedModeGrant(loaded.grant, expectations()).length).toBeGreaterThan(0);
  });

  it('refuses an unbounded grant — no scope, or no positive work-item ceiling', () => {
    for (const over of [{ grantedScope: [] }, { grantedScope: undefined }, { maxWorkItems: 0 }, { maxWorkItems: -1 }, { maxWorkItems: undefined }, { maxWorkItems: 2.5 }]) {
      const { sys } = fake(committedBytes(validGrantFixture(over)));
      const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
      expect(checkDegradedModeGrant(loaded.grant, expectations()).length).toBeGreaterThan(0);
    }
  });
});

describe('PROOF D — a valid grant still cannot authorise a protected action', () => {
  it.each(OWNER_ONLY)('refuses a committed, otherwise-valid grant that claims %s', (action) => {
    const { sys } = fake(committedBytes(validGrantFixture({ grantedScope: ['implement', action] })));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);

    // Everything about it is right except what it asks for — so this refusal is the scope rule.
    expect(loaded.readFromCommittedTree).toBe(true);
    const problems = checkDegradedModeGrant(loaded.grant, expectations());
    expect(problems.some((p) => p.includes(`owner-only action '${action}'`))).toBe(true);
  });

  it('the same grant is accepted once the protected action is removed', () => {
    const { sys } = fake(committedBytes(validGrantFixture({ grantedScope: ['implement'] })));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
    expect(checkDegradedModeGrant(loaded.grant, expectations())).toEqual([]);
  });
});

describe('PROOF E — replay and consumption', () => {
  it('refuses a grant whose id has already been consumed', () => {
    const { sys } = fake(committedBytes(validGrantFixture()));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);

    expect(checkDegradedModeGrant(loaded.grant, expectations())).toEqual([]); // fresh: accepted
    const problems = checkDegradedModeGrant(
      loaded.grant,
      expectations({ alreadyConsumedGrantIds: [GRANT_ID] }),
    );
    expect(problems.some((p) => p.includes('already used and cannot be replayed'))).toBe(true);
  });

  it('refuses a grant that carries its own consumedAt stamp', () => {
    const { sys } = fake(committedBytes(validGrantFixture({ consumedAt: '2026-08-19T10:30:00.000Z' })));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
    expect(
      checkDegradedModeGrant(loaded.grant, expectations()).some((p) => p.includes('already consumed at')),
    ).toBe(true);
  });

  it('refuses on either signal alone, so neither is load-bearing by itself', () => {
    const { sys } = fake(committedBytes(validGrantFixture({ consumedAt: '2026-08-19T10:30:00.000Z' })));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);
    expect(checkDegradedModeGrant(loaded.grant, expectations({ alreadyConsumedGrantIds: [GRANT_ID] })).length).toBeGreaterThan(1);
  });
});

describe('a path git silently ignores is named as such rather than left a mystery', () => {
  // FOUND BY SECURITY REVIEW. The flat filename was verified against the real `.gitignore` — but as
  // a LITERAL, and the ids interpolated into it are not constrained to avoid the words those rules
  // match. `secret*` and `*token*` are ignored here and `secrets-handling` is a real owner gate, so
  // `SECRETS-HANDLING-…` is a plausible phase. The owner would commit, git would store nothing, and
  // the refusal would say "not committed" with no way to find out why.
  it('reports pathIsGitIgnored when git says the grant path is ignored', () => {
    const { sys } = fake({ checkIgnore: { code: 0, stdout: '' }, onDisk: JSON.stringify(validGrantFixture()) });
    const loaded = loadDegradedModeGrant(sys, ROOT, 'SECRETS-HANDLING-PHASE1A', GRANT_ID);

    expect(loaded.pathIsGitIgnored).toBe(true);
    expect(loaded.grant).toBeNull(); // still refused — this is a diagnosis, not an exception
    expect(loaded.readFromCommittedTree).toBe(false);
  });

  it('says false for an ordinary path, and does not ask git at all when the grant is committed', () => {
    const { sys, calls } = fake(committedBytes(validGrantFixture()));
    const loaded = loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID);

    expect(loaded.pathIsGitIgnored).toBe(false);
    // A healthy run pays nothing for the diagnosis.
    expect(calls.some((c) => c.includes('check-ignore'))).toBe(false);
  });

  it('treats a check-ignore error as NOT ignored — an unanswerable question is not an accusation', () => {
    const { sys } = fake({ checkIgnore: { code: 128, stdout: '' } });
    expect(grantPathIsIgnored(sys, ROOT, PHASE, GRANT_ID)).toBe(false);
  });

  it('does not ask about an unsafe path', () => {
    const { sys, calls } = fake({ checkIgnore: { code: 0, stdout: '' } });
    expect(grantPathIsIgnored(sys, ROOT, PHASE, '../../evil')).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe('the loader cannot be talked into asserting provenance it did not establish', () => {
  it('never reports readFromCommittedTree true without a successful git show', () => {
    // Every shape that is not "logged, clean, parseable object" must come back false.
    const shapes = [
      {},
      { onDisk: JSON.stringify(validGrantFixture()) },
      { log: { code: 0, stdout: 'a\n' }, diff: { code: 0, stdout: 'dirty\n' } },
      { log: { code: 0, stdout: 'a\n' }, diff: { code: 0, stdout: '' }, show: { code: 1, stdout: '' } },
      { log: { code: 0, stdout: 'a\n' }, diff: { code: 0, stdout: '' }, show: { code: 0, stdout: '   ' } },
      { log: { code: 0, stdout: 'a\n' }, diff: { code: 0, stdout: '' }, show: { code: 0, stdout: '[]' } },
    ];
    for (const shape of shapes) {
      const { sys } = fake(shape);
      expect(loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID).readFromCommittedTree).toBe(false);
    }
  });

  it('a grant absent from both git and disk is null and uncommitted', () => {
    const { sys } = fake({});
    expect(loadDegradedModeGrant(sys, ROOT, PHASE, GRANT_ID)).toEqual({
      grant: null,
      readFromCommittedTree: false,
      uncommittedGrantOnDisk: null,
      pathIsGitIgnored: false,
    });
    expect(checkDegradedModeGrant(null, expectations({ readFromCommittedTree: false })).length).toBeGreaterThan(0);
  });
});
