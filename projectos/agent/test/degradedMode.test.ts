/**
 * Continuing unreviewed on the owner's committed risk — the runner half, proven deterministically.
 *
 * NOTHING HERE IS A REAL GRANT. The fixtures live in a temporary directory, are committed only to a
 * throwaway git repository created by the test, and are never written into this project's
 * `.projectops/`. Murad has not approved a live degraded-mode continuation and none is simulated as
 * though he had; `grantedBy` names the owner solely to exercise the contract's granter comparison.
 *
 * WHAT THESE PROVE, in the order the safety argument runs: no grant means no authority; an
 * uncommitted grant means no authority; a committed grant authorises only its exact bound; the grant
 * is spent BEFORE the work; the spend survives a restart; a protected action is refused even so; the
 * debt blocks the next major gate; and production cannot assert committed provenance for itself.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import {
  authorityWrapper,
  degradedWorkSubject,
  committedGovernanceOwner,
  runDegradedWork,
  isDegradedOperation,
  DEGRADED_OPERATIONS,
  ALWAYS_OWNER_ONLY,
  enforcedOwnerOnlyActions,
  deriveUnavailabilityId,
  deriveWorkId,
  authoriseDegradedContinuation,
  degradedOperationProblems,
  consumeDegradedGrant,
  degradedReconciliationState,
  consumedGrantIds,
  allDegradedWork,
  readDegradedStore,
  degradedStoreRelPath,
} from '../src/loop/degradedMode.js';
import { degradedGrantRelPath } from '../src/loop/degradedModeGrants.js';
import { DEGRADED_MODE_SCHEMA_VERSION, DEGRADED_MODE_CHOICE, RECONCILIATION_ASK } from '@projectos/core';

const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const PROJECT = 'projectos';
const GRANT_ID = 'DEGRADED-GRANT-FIXTURE1A';
const OWNER = 'Murad';
const OWNER_ONLY = ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'];

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A real git repository in a temp directory. Real, because "is it committed?" cannot be faked. */
function repo(): { root: string; sys: System; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-degraded-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, '.projectops', 'authority'), { recursive: true });
  mkdirSync(join(root, '.projectops', 'execution'), { recursive: true });
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture base');
  const head = git('rev-parse', 'HEAD').trim();

  const sys = {
    now: () => '2026-08-19T12:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    exec: (command: string, args: readonly string[]) => {
      try {
        return { code: 0, stdout: execFileSync(command, [...args], { encoding: 'utf8' }), stderr: '' };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  } as unknown as System;
  return { root, sys, head };
}

function grantBody(head: string, outage: string, over: Record<string, unknown> = {}) {
  return {
    schemaVersion: DEGRADED_MODE_SCHEMA_VERSION,
    grantId: GRANT_ID,
    projectId: PROJECT,
    phaseId: PHASE,
    subjectCommit: head,
    unavailabilityId: outage,
    ownerChoice: DEGRADED_MODE_CHOICE,
    grantedBy: OWNER,
    grantedAt: '2026-08-19T11:00:00.000Z',
    reason: 'FIXTURE ONLY — not a real risk acceptance; exercises the granter comparison',
    grantedScope: ['implement'],
    maxWorkItems: 1,
    ...over,
  };
}

/** Write the grant into the working tree. Committing it is a separate, deliberate act. */
function writeGrant(root: string, body: Record<string, unknown>): void {
  const rel = degradedGrantRelPath(PHASE, GRANT_ID);
  if (rel === null) throw new Error('unsafe fixture path');
  writeFileSync(join(root, ...rel.split('/')), `${JSON.stringify(body, null, 2)}\n`);
}

function commitAll(root: string, message: string): void {
  execFileSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', message], { encoding: 'utf8' });
}

/** A fresh reader over the same checkout: what a restarted process sees. Nothing carried over. */
function repoReader(root: string): System {
  return {
    now: () => '2026-08-19T13:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    exec: (command: string, args: readonly string[]) => {
      try {
        return { code: 0, stdout: execFileSync(command, [...args], { encoding: 'utf8' }), stderr: '' };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  } as unknown as System;
}

const outageFor = (head: string) =>
  deriveUnavailabilityId({
    projectId: PROJECT,
    phaseId: PHASE,
    subjectCommit: head,
    stopCode: 'REVIEW_OUTSTANDING',
    reasons: ['no gatekeeper transport is configured'],
  });

const authInput = (head: string, outage: string) => ({
  projectId: PROJECT,
  phaseId: PHASE,
  subjectCommit: head,
  unavailabilityId: outage,
  grantId: GRANT_ID,
  recordedOwner: OWNER,
  ownerOnlyActions: OWNER_ONLY,
});

describe('the outage identity', () => {
  it('is derived, so it survives the process that observed the outage', () => {
    const a = outageFor('a'.repeat(40));
    expect(a).toBe(outageFor('a'.repeat(40)));
    expect(a).toMatch(/^GKOUT-[0-9a-f]{24}$/);
  });

  it('differs for a different subject, stop or cause — risk accepted for one is not risk for another', () => {
    const base = { projectId: PROJECT, phaseId: PHASE, subjectCommit: 'a'.repeat(40), stopCode: 'X', reasons: ['r'] };
    expect(deriveUnavailabilityId({ ...base, subjectCommit: 'b'.repeat(40) })).not.toBe(deriveUnavailabilityId(base));
    expect(deriveUnavailabilityId({ ...base, stopCode: 'Y' })).not.toBe(deriveUnavailabilityId(base));
    expect(deriveUnavailabilityId({ ...base, reasons: ['other'] })).not.toBe(deriveUnavailabilityId(base));
  });

  it('does not depend on the order the reasons were collected in', () => {
    const base = { projectId: PROJECT, phaseId: PHASE, subjectCommit: 'a'.repeat(40), stopCode: 'X' };
    expect(deriveUnavailabilityId({ ...base, reasons: ['one', 'two'] })).toBe(
      deriveUnavailabilityId({ ...base, reasons: ['two', 'one'] }),
    );
  });
});

describe('PROOF A — no owner grant means no authority', () => {
  it('refuses when nothing has been granted at all', () => {
    const { root, sys, head } = repo();
    const result = authoriseDegradedContinuation(sys, root, authInput(head, outageFor(head)));

    expect(result.authorised).toBe(false);
    expect(result.grant).toBeNull();
    expect(result.reasons.join(' ')).toContain('no owner risk-acceptance exists');
    // Nothing was spent and nothing was recorded.
    expect(consumedGrantIds(sys, root)).toEqual([]);
    expect(allDegradedWork(sys, root)).toEqual([]);
  });
});

describe('PROOF B — an uncommitted grant is refused, through the loader', () => {
  it('refuses a flawless grant that exists only in the working tree, and says why', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage)); // written, deliberately NOT committed

    const result = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(result.authorised).toBe(false);
    // THE LOADER KEEPS `grant` NULL FOR UNCOMMITTED BYTES, so the contract's own refusal is the
    // general one. That is the hardened behaviour working: uncommitted bytes never reach the
    // checker at all. The actionable cause is added alongside it, which is why it was added.
    expect(result.reasons.join(' ')).toContain('no owner risk-acceptance exists');
    expect(result.reasons.join(' ')).toContain('exists in the working tree but is not committed');
    expect(consumedGrantIds(sys, root)).toEqual([]);
  });

  it('refuses a grant that was committed and has since been edited', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    // Widen it on disk only. The committed bytes still say 1.
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 99 }));

    const result = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(result.authorised).toBe(false);
    // Dirty means not committed: the widened on-disk copy is never honoured.
    expect(result.reasons.join(' ')).toContain('no owner risk-acceptance exists');
    expect(result.reasons.join(' ')).toContain('exists in the working tree but is not committed');
    expect(consumedGrantIds(sys, root)).toEqual([]);
  });
});

describe('PROOF C — a valid committed grant authorises exactly its bound', () => {
  it('accepts a committed grant and reports one work item of headroom', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    const result = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(result.authorised).toBe(true);
    expect(result.remaining).toBe(1);
    expect(String((result.grant as Record<string, unknown>)['grantId'])).toBe(GRANT_ID);
  });

  it('refuses a grant committed for a DIFFERENT outage', () => {
    const { root, sys, head } = repo();
    writeGrant(root, grantBody(head, 'GKOUT-somethingelse'));
    commitAll(root, 'fixture grant');

    const result = authoriseDegradedContinuation(sys, root, authInput(head, outageFor(head)));
    expect(result.authorised).toBe(false);
    expect(result.reasons.join(' ')).toContain('cannot carry over to a later outage');
  });

  it('refuses an operation outside the granted scope, and spends nothing', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const result = authoriseDegradedContinuation(sys, root, authInput(head, outage));

    const problems = degradedOperationProblems(result.grant!, 'deploy', OWNER_ONLY);
    expect(problems.join(' ')).toContain('outside the granted scope');
    expect(degradedOperationProblems(result.grant!, 'implement', OWNER_ONLY)).toEqual([]);
    expect(consumedGrantIds(sys, root)).toEqual([]);
  });
});

describe('PROOF D — the grant is spent BEFORE the work', () => {
  it('records consumption and the debt, and only then would work run', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));

    // Ordering, asserted rather than assumed: at the moment consumption returns, the debt is on
    // disk. A caller that runs work after this cannot leave the grant looking unused.
    const consumption = consumeDegradedGrant(sys, root, {
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });
    expect(consumption.persisted).toBe(true);
    expect(consumption.workId).toBe(deriveWorkId(GRANT_ID, outage, 1));

    const store = readDegradedStore(sys, root, GRANT_ID);
    expect(store?.consumedAt).toBe('2026-08-19T12:00:00.000Z');
    expect(store?.workItems).toHaveLength(1);
    expect(consumedGrantIds(sys, root)).toEqual([GRANT_ID]);
  });

  it('refuses when the record cannot be written — no persistence, no work', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));

    const failing = { ...sys, writeText: () => { throw new Error('disk full'); } } as unknown as System;
    const consumption = consumeDegradedGrant(failing, root, {
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });
    expect(consumption.persisted).toBe(false);
    expect(consumption.workId).toBeNull();
    expect(consumption.problem).toContain('disk full');
    expect(consumedGrantIds(sys, root)).toEqual([]);
  });

  it('refuses when the write SILENTLY does nothing, because the record is read back', () => {
    // `writeText` returns void, so a no-op write is indistinguishable from a successful one unless
    // the result is verified. This is the failure mode the read-back exists for.
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));

    const silent = { ...sys, writeText: () => undefined } as unknown as System;
    const consumption = consumeDegradedGrant(silent, root, {
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });
    expect(consumption.persisted).toBe(false);
    expect(consumption.problem).toContain('not recorded as spent');
  });
});

describe('PROOF E — restart and replay', () => {
  it('a consumed grant stays consumed across a fresh read of the checkout', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    consumeDegradedGrant(sys, root, {
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'fixture work item', at: '2026-08-19T12:00:00.000Z',
    });

    // A RESTART: nothing is carried in memory. The same root, read again from scratch.
    const restarted = repoReader(root);
    expect(consumedGrantIds(restarted, root)).toEqual([GRANT_ID]);

    const again = authoriseDegradedContinuation(restarted, root, authInput(head, outage));
    expect(again.authorised).toBe(false);
    expect(again.reasons.join(' ')).toMatch(/already used and cannot be replayed|no work items left/);
  });

  it('a MULTI-item grant is not spent by its first use — the two guards are independent', () => {
    // FOUND BY MUTATION TESTING. Emptying `alreadyConsumedGrantIds` failed nothing, because the
    // work-item bound was refusing the second use by itself. That hid a real defect: treating any
    // used grant as spent capped every ceiling at one, so an owner writing maxWorkItems 2 got 1.
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 2 }));
    commitAll(root, 'fixture grant');

    const first = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(first.remaining).toBe(2);
    consumeDegradedGrant(sys, root, {
      grant: first.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'first of two', at: '2026-08-19T12:00:00.000Z',
    });

    // Still live, with exactly one item left — not refused as a replay.
    const second = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(second.authorised).toBe(true);
    expect(second.remaining).toBe(1);
    expect(consumedGrantIds(sys, root)).toEqual([]); // used, not spent
    consumeDegradedGrant(sys, root, {
      grant: second.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'second of two', at: '2026-08-19T12:01:00.000Z',
    });

    // NOW it is spent, and the replay guard is what says so.
    expect(consumedGrantIds(sys, root)).toEqual([GRANT_ID]);
    const third = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(third.authorised).toBe(false);
    expect(third.reasons.join(' ')).toContain('already used and cannot be replayed');
    expect(allDegradedWork(sys, root)).toHaveLength(2);
  });

  it('a one-item grant permits one item and refuses the second', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 1 }));
    commitAll(root, 'fixture grant');

    const first = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(first.authorised).toBe(true);
    expect(first.remaining).toBe(1);
    consumeDegradedGrant(sys, root, {
      grant: first.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'the one permitted item', at: '2026-08-19T12:00:00.000Z',
    });

    const second = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(second.authorised).toBe(false);
    expect(allDegradedWork(sys, root)).toHaveLength(1);
  });
});

describe('PROOF E2 — an unreadable use record refuses; it never reads as "never used"', () => {
  // THE CRITICAL FOUND BY ADVERSARIAL REVIEW. `parseStore` returned null for both "absent" and
  // "corrupt", and every count dropped nulls — so truncating the store made a spent grant look
  // fresh, funding unbounded further unreviewed work and erasing the debt for work that happened.
  // A torn write produced the same state with no adversary at all.
  const corrupt = (root: string, body: string) => {
    const rel = degradedStoreRelPath(GRANT_ID)!;
    writeFileSync(join(root, ...rel.split('/')), body);
  };

  it.each([
    ['truncated to nothing', ''],
    ['a partial write', '{"schemaVersion":"1.0.0","grantId":"DEGRADED-GRANT-FIX'],
    ['valid JSON of the wrong shape', '[]'],
    ['an object missing its identity', '{"workItems":[]}'],
  ])('refuses further authorisation when the record is %s', (_label, body) => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 1 }));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    consumeDegradedGrant(sys, root, {
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'the one permitted item', at: '2026-08-19T12:00:00.000Z',
    });

    corrupt(root, body); // the attack, and the torn write, are the same state

    const again = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(again.authorised).toBe(false);
    expect(again.reasons.join(' ')).toContain('cannot be read');
    expect(again.reasons.join(' ')).toContain('no further unreviewed work may be authorised');
  });

  it(`refuses while ANY store is unreadable, not only this grant's`, () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    // A different grant's record is damaged. Total spend can no longer be established, so nothing
    // is authorised — a partial view of the debt is not a licence to add to it.
    writeFileSync(join(root, '.projectops', 'execution', 'degraded-use.SOME-OTHER-GRANT.json'), 'not json');

    const result = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(result.authorised).toBe(false);
    expect(result.reasons.join(' ')).toContain('cannot be read');
  });

  it('a COMMITTED use record cannot be reset by deleting or editing it locally', () => {
    // Once the owner has committed the use record as reconciliation evidence, the committed bytes
    // are what count, and a local deletion is a refusal rather than a fresh bound. This is the
    // durable answer to "the store is not committed, so the implementer can just remove it".
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 1 }));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    consumeDegradedGrant(sys, root, {
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'the one permitted item', at: '2026-08-19T12:00:00.000Z',
    });
    commitAll(root, 'owner commits the degraded-use evidence');

    // The debt is committed and outstanding.
    expect(degradedReconciliationState(sys, root).required).toBe(true);

    // Delete it locally — the classic reset attempt.
    const rel = degradedStoreRelPath(GRANT_ID)!;
    rmSync(join(root, ...rel.split('/')));

    const again = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(again.authorised).toBe(false);
    // TWO INDEPENDENT REASONS NOW REFUSE THIS, and either is sufficient: committing the use record
    // moved HEAD past the authority commit, and deleting the committed record is itself a refusal.
    expect(again.reasons.join(' ')).toMatch(/history has moved past the authority commit|modified or removed in the working tree/);
  });

  it('an absent record is still the ordinary first-use case, and authorises', () => {
    // The fix must not turn "nothing has happened yet" into a refusal.
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    expect(authoriseDegradedContinuation(sys, root, authInput(head, outage)).authorised).toBe(true);
  });
});

describe('PROOF F — a protected action is refused even under a valid grant', () => {
  it.each(OWNER_ONLY)('refuses %s', (action) => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    // The grant is valid and committed; the OPERATION is the protected one.
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(auth.authorised).toBe(true);

    const problems = degradedOperationProblems(auth.grant!, action, OWNER_ONLY);
    expect(problems.some((p) => p.includes('owner-only action'))).toBe(true);
    expect(consumedGrantIds(sys, root)).toEqual([]); // refused before anything was spent
  });

  it('refuses the grant outright when it NAMES a protected action in its scope', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { grantedScope: ['implement', 'push'] }));
    commitAll(root, 'fixture grant');

    const result = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(result.authorised).toBe(false);
    expect(result.reasons.join(' ')).toContain("owner-only action 'push'");
  });
});

describe('PROOF F2 — the protected-action floor holds when the declared list does not', () => {
  // MEDIUM from adversarial review: the owner-only set is plan-derived or caller-supplied, and both
  // can be empty — an authoring omission, or an explicit `[]`, which `??` does not treat as absent.
  // Either would have made "never authorise a protected action" vacuously true for that phase.
  it.each(ALWAYS_OWNER_ONLY)('refuses %s even when the declared owner-only list is EMPTY', (action) => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, { ...authInput(head, outage), ownerOnlyActions: [] });
    expect(auth.authorised).toBe(true); // the grant itself is fine; the OPERATION is the protected one

    const problems = degradedOperationProblems(auth.grant!, action, []);
    expect(problems.some((p) => p.includes('owner-only action'))).toBe(true);
  });

  it('refuses a grant that NAMES a protected action even with an empty declared list', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { grantedScope: ['implement', 'commit'] }));
    commitAll(root, 'fixture grant');

    const result = authoriseDegradedContinuation(sys, root, { ...authInput(head, outage), ownerOnlyActions: [] });
    expect(result.authorised).toBe(false);
    expect(result.reasons.join(' ')).toContain("owner-only action 'commit'");
  });

  it('keeps every declared action too — the floor adds, it does not replace', () => {
    const enforced = enforcedOwnerOnlyActions(['deploy-to-staging']);
    expect(enforced).toContain('deploy-to-staging');
    for (const a of ALWAYS_OWNER_ONLY) expect(enforced).toContain(a);
    // and does not duplicate what is already there
    expect(enforcedOwnerOnlyActions(['commit']).filter((a) => a === 'commit')).toHaveLength(1);
  });
});

describe('PROOF G — the debt blocks the next major gate', () => {
  it('requires reconciliation after one degraded item, and survives a restart', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));

    expect(degradedReconciliationState(sys, root).required).toBe(false); // nothing owed yet
    const consumption = consumeDegradedGrant(sys, root, {
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'fixture work item', at: '2026-08-19T12:00:00.000Z',
    });

    const state = degradedReconciliationState(sys, root);
    expect(state.required).toBe(true);
    expect(state.outstandingWorkIds).toEqual([consumption.workId]);

    // A RESTART does not clear it.
    expect(degradedReconciliationState(repoReader(root), root).required).toBe(true);
  });

  it('is not cleared by an assertion — only by an accepted reconciliation decision', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const consumption = consumeDegradedGrant(sys, root, {
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'fixture work item', at: '2026-08-19T12:00:00.000Z',
    });
    const rel = degradedStoreRelPath(GRANT_ID)!;
    const path = join(root, ...rel.split('/'));
    const store = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

    // A reconciliation the loop wrote for itself, with no accepted decision behind it.
    writeFileSync(path, JSON.stringify({
      ...store,
      reconciliations: [{ workId: consumption.workId, decisionId: 'GKDEC-made-up', ask: RECONCILIATION_ASK, decisionAccepted: false }],
    }, null, 2));
    expect(degradedReconciliationState(sys, root).required).toBe(true);

    // The wrong ask does not clear it either.
    writeFileSync(path, JSON.stringify({
      ...store,
      reconciliations: [{ workId: consumption.workId, decisionId: 'GKDEC-real', ask: 'ordinary-review', decisionAccepted: true }],
    }, null, 2));
    expect(degradedReconciliationState(sys, root).required).toBe(true);

    // An accepted decision under the reconciliation ask does.
    writeFileSync(path, JSON.stringify({
      ...store,
      reconciliations: [{ workId: consumption.workId, decisionId: 'GKDEC-real', ask: RECONCILIATION_ASK, decisionAccepted: true }],
    }, null, 2));
    expect(degradedReconciliationState(sys, root).required).toBe(false);
  });

  it('a second grant does not silently clear the first grant\'s debt', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    consumeDegradedGrant(sys, root, {
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'fixture work item', at: '2026-08-19T12:00:00.000Z',
    });
    // Another grant, another store file — the debt is per work item, not per grant.
    consumeDegradedGrant(sys, root, {
      grant: { ...grantBody(head, outage), grantId: 'DEGRADED-GRANT-FIXTURE2B' } as never,
      unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'second grant item', at: '2026-08-19T12:05:00.000Z',
    });
    const state = degradedReconciliationState(sys, root);
    expect(state.required).toBe(true);
    expect(state.outstandingWorkIds).toHaveLength(2);
  });
});

describe('PROOF H — production cannot assert committed provenance for itself', () => {
  it('the runner never mentions readFromCommittedTree', () => {
    // THE FROZEN RULE, ENFORCED RATHER THAN DOCUMENTED. Production authority must come through
    // `loadDegradedModeGrant`, which derives provenance from the read. If the runner ever supplies
    // that flag itself, it is asserting something it did not establish, and this fails.
    const runner = readFileSync(new URL('../src/loop/runner.ts', import.meta.url), 'utf8');
    expect(runner).not.toContain('readFromCommittedTree');
    // The runner now reaches authorisation only through the end-to-end sequence — see PROOF 7.
    expect(runner).toContain('runDegradedWork');
  });

  it('the authorisation input has no channel through which provenance could be supplied', () => {
    const source = readFileSync(new URL('../src/loop/degradedMode.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export interface DegradedAuthorisationInput');
    // The interface body only: the doc comment BELOW it legitimately explains the flag.
    const inputBlock = source.slice(start, source.indexOf('}', start));
    expect(inputBlock).not.toContain('readFromCommittedTree');
    // The only occurrence is the one the loader established, passed straight through.
    expect(source).toContain('readFromCommittedTree: loaded.readFromCommittedTree');
  });
});

/* ------------------------------------------------------------------------------------------------
 * CONSUME BEFORE WORK, END TO END. The previously open MEDIUM: the ordering was enforced inside the
 * helper, and nothing structural carried it into the real execution path. `runDegradedWork` takes
 * the work as an argument, so there is no route to it that skips a verified spend.
 * --------------------------------------------------------------------------------------------- */

/** Records what happened in what order, so ordering is asserted rather than assumed. */
function tracer() {
  const events: string[] = [];
  return {
    events,
    /** A System that logs every store write and read, so they share one trace with the work. */
    wrap(sys: System): System {
      return {
        ...sys,
        writeText: (path: string, content: string) => {
          if (path.includes('degraded-use.')) events.push('persist');
          (sys as unknown as { writeText: (p: string, c: string) => void }).writeText(path, content);
        },
        readText: (path: string) => {
          if (path.includes('degraded-use.')) events.push('read-back');
          return (sys as unknown as { readText: (p: string) => string | null }).readText(path);
        },
      } as unknown as System;
    },
  };
}

const runInput = (head: string, outage: string, over: Record<string, unknown> = {}) => ({
  ...authInput(head, outage),
  operation: 'implement',
  at: '2026-08-19T13:00:00.000Z',
  ...over,
});

describe('PROOF 1 — work cannot run before consumption', () => {
  it('persists, verifies by read-back, and only then invokes the work', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    const t = tracer();
    const outcome = runDegradedWork(t.wrap(sys), root, runInput(head, outage), () => {
      t.events.push('WORK');
    });

    expect(outcome.kind).toBe('WORK_DONE');
    // The exact ordering, not merely "work happened".
    const persistAt = t.events.indexOf('persist');
    const workAt = t.events.indexOf('WORK');
    const readBackAfterPersist = t.events.indexOf('read-back', persistAt);
    expect(persistAt).toBeGreaterThanOrEqual(0);
    expect(readBackAfterPersist).toBeGreaterThan(persistAt);
    expect(workAt).toBeGreaterThan(readBackAfterPersist);
  });

  it('hands the work a ConsumedAuthority naming the item it was spent on', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    let seen: unknown = null;
    const outcome = runDegradedWork(sys, root, runInput(head, outage), (a) => { seen = a; });
    expect(outcome.kind).toBe('WORK_DONE');
    const authority = seen as { workId: string; grantId: string; remainingAfter: number };
    expect(authority.grantId).toBe(GRANT_ID);
    expect(authority.remainingAfter).toBe(0);
    if (outcome.kind === 'WORK_DONE') expect(authority.workId).toBe(outcome.workId);
  });
});

describe('PROOF 2 — a write failure means no work', () => {
  it('never invokes the callback when the record cannot be written', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    let calls = 0;
    const failing = {
      ...sys,
      writeText: (path: string, content: string) => {
        if (path.includes('degraded-use.')) throw new Error('disk full');
        (sys as unknown as { writeText: (p: string, c: string) => void }).writeText(path, content);
      },
    } as unknown as System;

    const outcome = runDegradedWork(failing, root, runInput(head, outage), () => { calls += 1; });
    expect(calls).toBe(0);
    expect(outcome.kind).toBe('CONSUMPTION_FAILED');
    if (outcome.kind === 'CONSUMPTION_FAILED') expect(outcome.problem).toContain('disk full');
  });
});

describe('PROOF 3 — a read-back failure means no work', () => {
  it('never invokes the callback when the write silently does nothing', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    let calls = 0;
    const silent = {
      ...sys,
      writeText: (path: string, content: string) => {
        if (path.includes('degraded-use.')) return; // appears to succeed, writes nothing
        (sys as unknown as { writeText: (p: string, c: string) => void }).writeText(path, content);
      },
    } as unknown as System;

    const outcome = runDegradedWork(silent, root, runInput(head, outage), () => { calls += 1; });
    expect(calls).toBe(0);
    expect(outcome.kind).toBe('CONSUMPTION_FAILED');
    if (outcome.kind === 'CONSUMPTION_FAILED') expect(outcome.problem).toContain('not recorded as spent');
  });
});

describe('PROOF 4 — a replayed or exhausted grant means no work', () => {
  it('never invokes the callback for an exhausted grant', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 1 }));
    commitAll(root, 'fixture grant');

    let calls = 0;
    expect(runDegradedWork(sys, root, runInput(head, outage), () => { calls += 1; }).kind).toBe('WORK_DONE');
    expect(calls).toBe(1);

    const second = runDegradedWork(sys, root, runInput(head, outage), () => { calls += 1; });
    expect(second.kind).toBe('REFUSED');
    expect(calls).toBe(1); // unchanged
  });

  it('never invokes the callback when a use record is unreadable', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    writeFileSync(join(root, '.projectops', 'execution', 'degraded-use.OTHERGRANT.json'), 'not json');

    let calls = 0;
    const outcome = runDegradedWork(sys, root, runInput(head, outage), () => { calls += 1; });
    expect(calls).toBe(0);
    expect(outcome.kind).toBe('REFUSED');
  });

  it('never invokes the callback for an out-of-scope or protected operation, and spends nothing', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    let calls = 0;
    for (const operation of ['deploy', 'commit', 'push']) {
      const outcome = runDegradedWork(sys, root, runInput(head, outage, { operation }), () => { calls += 1; });
      expect(outcome.kind).toBe('REFUSED');
    }
    expect(calls).toBe(0);
    expect(consumedGrantIds(sys, root)).toEqual([]); // scope is checked BEFORE the spend
  });
});

describe('PROOF 5 — the one-item live shape', () => {
  it('runs exactly once and refuses the second attempt', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 1 }));
    commitAll(root, 'fixture grant');

    const ran: string[] = [];
    const first = runDegradedWork(sys, root, runInput(head, outage), (a) => {
      ran.push((a as unknown as { workId: string }).workId);
    });
    expect(first.kind).toBe('WORK_DONE');
    if (first.kind === 'WORK_DONE') expect(first.remainingAfter).toBe(0);

    const second = runDegradedWork(sys, root, runInput(head, outage), (a) => {
      ran.push((a as unknown as { workId: string }).workId);
    });
    expect(second.kind).toBe('REFUSED');
    expect(ran).toHaveLength(1);
    expect(allDegradedWork(sys, root)).toHaveLength(1);
  });
});

describe('PROOF 6 — reconciliation follows real degraded work', () => {
  it('reports the debt in the structured result, and the gate stays blocked', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    expect(degradedReconciliationState(sys, root).required).toBe(false);
    const outcome = runDegradedWork(sys, root, runInput(head, outage), () => undefined);

    expect(outcome.kind).toBe('WORK_DONE');
    if (outcome.kind === 'WORK_DONE') {
      expect(outcome.reconciliationRequired).toBe(true);
      expect(outcome.outstandingWorkIds).toEqual([outcome.workId]);
    }
    expect(degradedReconciliationState(sys, root).required).toBe(true);
  });

  it('keeps the debt when the work itself throws — the grant is still spent', () => {
    // Half-done unreviewed work needs review more than finished work, not less.
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');

    const outcome = runDegradedWork(sys, root, runInput(head, outage), () => {
      throw new Error('the bounded work blew up');
    });
    expect(outcome.kind).toBe('WORK_DONE');
    if (outcome.kind === 'WORK_DONE') {
      expect(outcome.workError).toContain('blew up');
      expect(outcome.reconciliationRequired).toBe(true);
    }
    expect(consumedGrantIds(sys, root)).toEqual([GRANT_ID]); // spent, not refunded
  });
});

describe('PROOF 7 — the runner cannot bypass the mechanism', () => {
  it('reaches degraded work only through runDegradedWork', () => {
    const runner = readFileSync(new URL('../src/loop/runner.ts', import.meta.url), 'utf8');
    // The runner never spends a grant itself, and never builds the proof that one was spent.
    expect(runner).not.toContain('consumeDegradedGrant');
    expect(runner).not.toContain('authoriseDegradedContinuation');
    expect(runner).not.toContain('readFromCommittedTree');
    expect(runner).toContain('runDegradedWork');
    // STRONGER THAN BEFORE: the work is no longer supplied by a caller at all. The runner builds
    // it from the closed vocabulary, so there is no callback to hand in and none to invoke early.
    expect(runner).not.toContain('cfg.work');
  });

  it('the authority proving a spend cannot be built outside the module', () => {
    const source = readFileSync(new URL('../src/loop/degradedMode.ts', import.meta.url), 'utf8');
    // A `unique symbol` that is never exported: no caller can name the key, so no caller can
    // construct a ConsumedAuthority — which is why a boolean was not good enough here.
    expect(source).toContain('declare const consumedAuthorityBrand: unique symbol');
    expect(source).not.toContain('export const consumedAuthorityBrand');
  });
});

/* ------------------------------------------------------------------------------------------------
 * THE LIVE ENTRY. Making the reviewed path reachable without making it reachable by accident, and
 * without giving a caller any way to assert authority it has not got.
 * --------------------------------------------------------------------------------------------- */

const runnerSource = () => readFileSync(new URL('../src/loop/runner.ts', import.meta.url), 'utf8');
const runCommandSource = () => readFileSync(new URL('../src/commands/run.ts', import.meta.url), 'utf8');

describe('ENTRY PROOF A — default OFF', () => {
  it('does not configure degraded mode unless a grant is named', () => {
    const cmd = runCommandSource();
    // The option is spread in only when a grant id was supplied AND the operation is known.
    expect(cmd).toContain("degradedGrant === '' || !isDegradedOperation(degradedOperation)");
    // Nothing enables it from an outage, a config file, or an environment variable.
    expect(cmd).not.toContain('process.env');
  });

  it('the runner treats an unset option as NOT_CONFIGURED and changes nothing else', () => {
    expect(runnerSource()).toContain("if (cfg === undefined) return { kind: 'NOT_CONFIGURED' }");
  });
});

describe('ENTRY PROOF B — unavailable but no committed grant', () => {
  it('refuses and does no work when the named grant is not committed', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage)); // present on disk, never committed

    let calls = 0;
    const outcome = runDegradedWork(sys, root, runInput(head, outage), () => { calls += 1; });
    expect(calls).toBe(0);
    expect(outcome.kind).toBe('REFUSED');
    expect(consumedGrantIds(sys, root)).toEqual([]);
  });

  it('refuses when no grant exists at all', () => {
    const { root, sys, head } = repo();
    let calls = 0;
    const outcome = runDegradedWork(sys, root, runInput(head, outageFor(head)), () => { calls += 1; });
    expect(calls).toBe(0);
    expect(outcome.kind).toBe('REFUSED');
  });
});

describe('ENTRY PROOF C — authority cannot be asserted by CLI or config', () => {
  it('exposes no flag for owner, provenance, or grant validity', () => {
    const cmd = runCommandSource();
    // Assert on the flags actually READ, not on prose: the comment above the entry deliberately
    // NAMES the flags that must never exist, and a substring match trips over its own warning.
    const flagReads = [...cmd.matchAll(/(?:str|bool)\(flags, '([^']+)'\)/g)].map((m) => m[1]);
    expect(flagReads).toContain('degraded-grant');
    expect(flagReads).toContain('degraded-operation');
    for (const forbidden of ['owner', 'recorded-owner', 'committed', 'grant-valid', 'provenance']) {
      expect(flagReads).not.toContain(forbidden);
    }
    // And no flag value is ever passed into the loop options as authority.
    expect(cmd).not.toContain('recordedOwner:');
    expect(cmd).not.toContain('readFromCommittedTree');
  });

  it('the runner option carries only a grant pointer and a closed operation', () => {
    const runner = runnerSource();
    const block = runner.slice(
      runner.indexOf('readonly degradedMode?: {'),
      runner.indexOf('readonly correctionMaximumPaths'),
    );
    expect(block).toContain('readonly grantId: string;');
    expect(block).toContain('readonly operation: DegradedOperation;');
    // No owner, no provenance, no caller-supplied work.
    expect(block).not.toContain('recordedOwner');
    expect(block).not.toContain('readFromCommittedTree');
    expect(block).not.toContain('work:');
  });

  it('refuses an operation outside the closed vocabulary', () => {
    expect(isDegradedOperation('implement')).toBe(true);
    for (const bad of ['commit', 'push', 'deploy', 'bash', '']) {
      expect(isDegradedOperation(bad)).toBe(false);
    }
    expect(DEGRADED_OPERATIONS).toEqual(['implement']);
    expect(runCommandSource()).toContain('DEGRADED_OPERATION_UNKNOWN');
  });
});

describe('ENTRY PROOF D — governed bindings are derived, not supplied', () => {
  it('takes the recorded owner from the approved plan governance block', () => {
    const runner = runnerSource();
    // From the plan AS COMMITTED — see ENTRY PROOF D2 for why the working-tree read was wrong.
    expect(runner).toContain('committedGovernanceOwner(sys, root, context.planPath)');
    expect(runner).toContain('recordedOwner: governedOwner');
    // And refuses rather than guessing when no committed plan states an owner.
    expect(runner).toContain('records no governance owner');
  });

  it('takes project, phase, subject and outage from the run itself', () => {
    const runner = runnerSource();
    const call = runner.slice(runner.indexOf('const outcome = runDegradedWork('));
    const head = call.slice(0, call.indexOf('    );'));
    expect(head).toContain('projectId: context.projectId');
    // The subject is the DERIVED work baseline, not HEAD — see SUBJECT PROOF A.
    expect(head).toContain('subjectCommit: workSubject');
    expect(runner).toContain('authorityWrapper(sys, root, phaseId, cfg.grantId)');
    expect(head).toContain('unavailabilityId,');
    // The outage id is derived from the real unavailability, not accepted from anywhere.
    expect(runner).toContain('deriveUnavailabilityId({');
  });
});

describe('ENTRY PROOF E — the live entry reaches only the reviewed gateway', () => {
  it('routes through runDegradedWork and cannot bypass its guarantees', () => {
    const runner = runnerSource();
    expect(runner).toContain('runDegradedWork');
    expect(runner).not.toContain('consumeDegradedGrant');
    expect(runner).not.toContain('authoriseDegradedContinuation');
    expect(runner).not.toContain('loadDegradedModeGrant');
  });

  it('runs a further attempt only via a flag the verified spend sets', () => {
    const runner = runnerSource();
    // Set inside the callback runDegradedWork invokes, and nowhere else.
    expect(runner.match(/degradedAttemptAuthorised = true/g) ?? []).toHaveLength(1);
    // Cleared on use, so one grant buys one attempt.
    expect(runner).toContain('degradedAttemptAuthorised = false;');
  });
});

describe('ENTRY PROOF F — protected actions are refused before execution', () => {
  it.each(['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'])(
    'cannot even be named as the operation: %s',
    (action) => {
      expect(isDegradedOperation(action)).toBe(false);
    },
  );

  it('and is refused by the grant check too, if one somehow reached it', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    let calls = 0;
    const outcome = runDegradedWork(sys, root, runInput(head, outage, { operation: 'commit' }), () => { calls += 1; });
    expect(outcome.kind).toBe('REFUSED');
    expect(calls).toBe(0);
  });
});

describe('ENTRY PROOF G — no real work in this step', () => {
  it('this repository holds no degraded grant and no use record', () => {
    // Asserted against the REAL checkout, not a fixture: nothing in this step created authority.
    const authority = readdirSync(new URL('../../../.projectops/authority/', import.meta.url));
    expect(authority.filter((f) => f.includes('degraded-grant'))).toEqual([]);
    const execution = readdirSync(new URL('../../../.projectops/execution/', import.meta.url));
    expect(execution.filter((f) => f.startsWith('degraded-use.'))).toEqual([]);
  });
});

describe('ENTRY PROOF D2 — the recorded owner is read from the plan AS COMMITTED', () => {
  // FOUND BY ADVERSARIAL REVIEW. The owner came from `context.plan`, which `loadGovernedContext`
  // reads from the working tree — while the comment claimed it was digest-bound and unauthorable.
  // Every other owner-authority input on this path is read from git; this now matches them.
  const planRel = '.projectops/plan.json';
  const writePlan = (root: string, owner: unknown) => {
    const body = owner === undefined ? { governance: {} } : { governance: { owner } };
    writeFileSync(join(root, ...planRel.split('/')), `${JSON.stringify(body, null, 2)}\n`);
  };

  it('reads the committed owner, not the working-tree one', () => {
    const { root, sys } = repo();
    writePlan(root, 'Murad');
    commitAll(root, 'plan with owner');
    // Rewrite it on disk only — the classic working-tree substitution.
    writePlan(root, 'Somebody Else');

    // Modified since commit → refuses outright rather than trusting either copy.
    expect(committedGovernanceOwner(sys, root, planRel)).toBeNull();
  });

  it('returns the committed owner when the tree is clean', () => {
    const { root, sys } = repo();
    writePlan(root, 'Murad');
    commitAll(root, 'plan with owner');
    expect(committedGovernanceOwner(sys, root, planRel)).toBe('Murad');
  });

  it('refuses an uncommitted plan, however well-formed', () => {
    const { root, sys } = repo();
    writePlan(root, 'Murad'); // written, never committed
    expect(committedGovernanceOwner(sys, root, planRel)).toBeNull();
  });

  it.each([[undefined], [''], ['   '], [42], [null]])(
    'refuses when the committed plan states no usable owner (%s)',
    (owner) => {
      const { root, sys } = repo();
      writePlan(root, owner);
      commitAll(root, 'plan without a usable owner');
      expect(committedGovernanceOwner(sys, root, planRel)).toBeNull();
    },
  );

  it('the runner refuses rather than falling back to the working-tree plan', () => {
    const runner = readFileSync(new URL('../src/loop/runner.ts', import.meta.url), 'utf8');
    expect(runner).toContain('committedGovernanceOwner(sys, root, context.planPath)');
    // The old working-tree read is gone.
    expect(runner).not.toContain("context.plan['governance']");
    expect(runner).toContain('absent, uncommitted, or modified since');
  });
});

/* ------------------------------------------------------------------------------------------------
 * THE AUTHORITY WRAPPER. A grant has authority only once committed, and committing it moves HEAD —
 * so a grant bound to the reviewed baseline would invalidate itself the moment it became real. The
 * grant commit is read as a wrapper: it changes the grant and nothing else, so its parent is still
 * the work the owner approved. Nothing about the subject binding is weakened to achieve that.
 * --------------------------------------------------------------------------------------------- */

/** H0 → commit only the grant → H1. Returns both, so a test can assert the relationship. */
function withAuthorityCommit(
  root: string,
  body: Record<string, unknown>,
  alsoChange?: { readonly path: string; readonly content: string },
): { h0: string; h1: string } {
  const sha = () => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const h0 = sha();
  writeGrant(root, body);
  if (alsoChange !== undefined) {
    writeFileSync(join(root, ...alsoChange.path.split('/')), alsoChange.content);
  }
  commitAll(root, 'owner commits the degraded grant');
  return { h0, h1: sha() };
}

describe('SUBJECT PROOF A — the grant commit no longer invalidates its own binding', () => {
  it('accepts a grant bound to H0 when HEAD is the authority commit H1', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    const { h1 } = withAuthorityCommit(root, grantBody(h0, outage));

    expect(h1).not.toBe(h0); // committing the grant DID move HEAD — that is the paradox
    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('wrapper');
    if (wrapper.kind === 'wrapper') {
      expect(wrapper.grantCommit).toBe(h1);
      expect(wrapper.subjectCommit).toBe(h0); // the work is still H0
    }

    // And the grant, which names H0, is accepted against that derived subject.
    const result = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(result.authorised).toBe(true);
  });

  it('does not treat the authority commit as code drift', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    withAuthorityCommit(root, grantBody(h0, outage));

    const result = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(result.reasons.join(' ')).not.toContain('risk accepted for other work');
  });
});

describe('SUBJECT PROOF B — a bundled code change is refused', () => {
  it('refuses when the authority commit carries anything besides the grant', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    // The grant AND a source change in the same commit — approval of H0 must not carry this.
    withAuthorityCommit(root, grantBody(h0, outage), { path: 'README.md', content: 'smuggled change\n' });

    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('invalid');
    if (wrapper.kind === 'invalid') {
      expect(wrapper.problems.join(' ')).toContain('changes 2 path(s)');
      expect(wrapper.problems.join(' ')).toContain('nothing else');
    }

    const result = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(result.authorised).toBe(false);
    expect(consumedGrantIds(sys, root)).toEqual([]);
  });
});

describe('SUBJECT PROOF C — HEAD moved past the authority commit', () => {
  it('refuses when anything was committed after the grant', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    withAuthorityCommit(root, grantBody(h0, outage));
    // H2: ordinary work after the approval. The approved baseline is no longer what is here.
    writeFileSync(join(root, 'README.md'), 'later work\n');
    commitAll(root, 'work after the grant');

    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('invalid');
    if (wrapper.kind === 'invalid') {
      expect(wrapper.problems.join(' ')).toContain('history has moved past the authority commit');
    }
    expect(authoriseDegradedContinuation(sys, root, authInput(h0, outage)).authorised).toBe(false);
  });
});

describe('SUBJECT PROOF D — a grant naming the wrong subject is refused', () => {
  it('refuses when the grant names something other than the derived baseline', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    // A well-formed authority commit, but the grant inside names a different subject.
    withAuthorityCommit(root, grantBody('b'.repeat(40), outage));

    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('wrapper'); // the WRAPPER is clean…
    const result = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(result.authorised).toBe(false); // …and the grant's own binding still refuses
    expect(result.reasons.join(' ')).toContain('risk accepted for other work');
  });

  it('an invalid wrapper never falls back to HEAD', () => {
    // Falling back is how a bundled change or a moved HEAD would be waved through.
    const { root, sys, head } = repo();
    const invalid = degradedWorkSubject(sys, root, { kind: 'invalid', problems: ['nope'] });
    expect(invalid.subjectCommit).toBeNull();
    // Whereas no wrapper at all is the ordinary discovery case — and the subject is read from git
    // here, not taken from a caller, so the guarantee holds before a grant exists too.
    const none = degradedWorkSubject(sys, root, { kind: 'none', reason: 'no committed grant' });
    expect(none.subjectCommit).toBe(head);
  });
});

describe('SUBJECT PROOF E — the outage identity is stable across the authority commit', () => {
  it('derives the same id at discovery H0 and at proof H1', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    // DISCOVERY, at H0: no grant committed, so the subject is the run's own head.
    const atDiscovery = degradedWorkSubject(sys, root, authorityWrapper(sys, root, PHASE, GRANT_ID));
    expect(atDiscovery.subjectCommit).toBe(h0);
    const discoveryOutage = outageFor(atDiscovery.subjectCommit!);

    // The owner commits the grant naming that outage. HEAD becomes H1.
    const { h1 } = withAuthorityCommit(root, grantBody(h0, discoveryOutage));

    // PROOF, at H1: the subject resolves back to H0, so the id is unchanged.
    const atProof = degradedWorkSubject(sys, root, authorityWrapper(sys, root, PHASE, GRANT_ID));
    expect(atProof.subjectCommit).toBe(h0);
    expect(outageFor(atProof.subjectCommit!)).toBe(discoveryOutage);

    // And the grant, bound to that id, is accepted.
    expect(authoriseDegradedContinuation(sys, root, authInput(h0, discoveryOutage)).authorised).toBe(true);
  });

  it('a different work subject is a different outage — stability is not blindness', () => {
    const a = outageFor('a'.repeat(40));
    const b = outageFor('b'.repeat(40));
    expect(a).not.toBe(b);
  });
});

describe('SUBJECT PROOF F — no regression in the committed-truth guarantees', () => {
  it('an uncommitted grant is still refused, wrapper or not', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage)); // written, never committed
    expect(authorityWrapper(sys, root, PHASE, GRANT_ID).kind).toBe('none');
    expect(authoriseDegradedContinuation(sys, root, authInput(head, outage)).authorised).toBe(false);
  });

  it('a dirty committed grant is still refused', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    withAuthorityCommit(root, grantBody(h0, outage));
    writeGrant(root, grantBody(h0, outage, { maxWorkItems: 99 })); // widened on disk only

    const result = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(result.authorised).toBe(false);
  });

  it('protected scope, bounds and replay are unchanged under a valid wrapper', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    withAuthorityCommit(root, grantBody(h0, outage, { maxWorkItems: 1 }));

    const auth = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(auth.authorised).toBe(true);
    // protected action still refused
    expect(degradedOperationProblems(auth.grant!, 'commit', []).length).toBeGreaterThan(0);
    // bound still enforced
    consumeDegradedGrant(sys, root, {
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'the one item', at: '2026-08-19T15:00:00.000Z',
    });
    expect(authoriseDegradedContinuation(sys, root, authInput(h0, outage)).authorised).toBe(false);
  });

  it('a grant naming a protected action is still refused outright', () => {
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    withAuthorityCommit(root, grantBody(h0, outage, { grantedScope: ['implement', 'push'] }));
    const result = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(result.authorised).toBe(false);
    expect(result.reasons.join(' ')).toContain("owner-only action 'push'");
  });
});

describe('SUBJECT PROOF G — a merge can never be an authority wrapper', () => {
  // FOUND BY ADVERSARIAL REVIEW, AND IT IS THE ATTACK THE ONE-PATH CHECK WAS SUPPOSED TO STOP.
  // `git show --name-only` on a MERGE prints the dense combined diff, which suppresses any path
  // whose merged content matches one parent. So a merge whose only conflicted path is the grant
  // reports exactly one changed path — the grant — while code merged in cleanly from the second
  // parent is invisible to this check AND to an owner running `git show` on the same commit.
  // `^` would then take parent 1 as a clean baseline while the worker runs against a HEAD that
  // carries the smuggled files.
  it('refuses a merge commit even when it reports exactly one changed path', () => {
    const { root, sys } = repo();
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    const h0 = git('rev-parse', 'HEAD').trim();
    const outage = outageFor(h0);

    // BRANCH 1: the grant, with placeholder content so the merge conflicts on exactly this path.
    git('checkout', '-q', '-b', 'authority');
    writeGrant(root, grantBody(h0, outage, { reason: 'placeholder A' }));
    commitAll(root, 'grant, draft A');

    // BRANCH 2 from H0: arbitrary code, and no touch to the grant path.
    git('checkout', '-q', h0);
    git('checkout', '-q', '-b', 'smuggled');
    writeFileSync(join(root, 'evil.ts'), 'export const smuggled = true;\n');
    commitAll(root, 'unrelated code the owner never approved');

    // MERGE: evil.ts arrives cleanly (hidden by the combined diff); the grant conflicts and is
    // resolved to the real, legitimate-looking record — the only path the combined diff reports.
    git('checkout', '-q', 'authority');
    try {
      git('merge', '--no-commit', '--no-ff', 'smuggled');
    } catch {
      // a conflict here is expected; the resolution follows
    }
    writeGrant(root, grantBody(h0, outage));
    git('add', '-A');
    git('commit', '-q', '--no-edit', '-m', 'merge, resolving only the grant');

    const mergeSha = git('rev-parse', 'HEAD').trim();
    // The premise of the attack, asserted rather than assumed: two parents, and the combined diff
    // really does report only the grant path.
    const parentCount = git('rev-list', '--parents', '-n', '1', mergeSha).trim().split(/\s+/).length - 1;
    expect(parentCount).toBe(2);
    expect(existsSync(join(root, 'evil.ts'))).toBe(true); // the smuggled file IS in the tree
    const combined = git('show', '--name-only', '--format=', mergeSha).trim();
    expect(combined).not.toContain('evil.ts'); // …and invisible to the check the fix had to survive

    // THE FIX: refused on the parent count, before the path check can be fooled.
    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('invalid');
    if (wrapper.kind === 'invalid') {
      expect(wrapper.problems.join(' ')).toContain('2 parent(s)');
      expect(wrapper.problems.join(' ')).toContain('single-parent commit');
    }

    // And nothing is authorised or spent.
    const result = authoriseDegradedContinuation(sys, root, authInput(h0, outage));
    expect(result.authorised).toBe(false);
    expect(consumedGrantIds(sys, root)).toEqual([]);
  });

  it('an ordinary single-parent authority commit is still accepted', () => {
    // The fix must refuse merges without refusing the real thing.
    const { root, sys } = repo();
    const h0 = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const outage = outageFor(h0);
    withAuthorityCommit(root, grantBody(h0, outage));

    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('wrapper');
    expect(authoriseDegradedContinuation(sys, root, authInput(h0, outage)).authorised).toBe(true);
  });

  it('asks git for the parent count rather than inferring it', () => {
    const source = readFileSync(new URL('../src/loop/degradedMode.ts', import.meta.url), 'utf8');
    expect(source).toContain("'rev-list', '--parents', '-n', '1'");
    // And renames cannot collapse two paths into one under an ambient diff.renames setting.
    expect(source).toContain("'--name-only', '--no-renames'");
  });
});
