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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import { loadGovernedContext } from '../src/governedContext.js';
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
  reconciliationDebtBlock,
  unreadableDegradedStores,
} from '../src/loop/degradedMode.js';
import { degradedGrantRelPath } from '../src/loop/degradedModeGrants.js';
import {
  DEGRADED_MODE_SCHEMA_VERSION,
  DEGRADED_MODE_CHOICE,
  RECONCILIATION_ASK,
  GATEKEEPER_UNAVAILABILITY_CAUSES,
  isGatekeeperUnavailabilityCause,
  selectGatekeeperTransport,
} from '@projectos/core';

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
    renameFile: (from: string, to: string) => {
      try {
        renameSync(from, to);
        return true;
      } catch {
        return false;
      }
    },
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
    renameFile: (from: string, to: string) => {
      try {
        renameSync(from, to);
        return true;
      } catch {
        return false;
      }
    },
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
    cause: 'TRANSPORT_NOT_CONFIGURED',
  });

/**
 * The installation's durable record, per test, in its own temporary directory.
 *
 * OUTSIDE THE FIXTURE PROJECT ON PURPOSE — that is the property under test. A test that put it inside
 * `root` would prove nothing about surviving the project's deletion.
 */
const stateDirs: string[] = [];
let currentDurable: { stateDir: string; installRoot: string; repository: string } | null = null;
function durableBinding(): { stateDir: string; installRoot: string; repository: string } {
  if (currentDurable === null) {
    const stateDir = mkdtempSync(join(tmpdir(), 'projectos-install-state-'));
    stateDirs.push(stateDir);
    currentDurable = {
      stateDir,
      installRoot: '/install/ProjectOS',
      repository: 'github.com/universalbizcomply/ProjectOS',
    };
  }
  return currentDurable;
}
afterEach(() => {
  currentDurable = null;
  for (const d of stateDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A System built fresh, standing for a restarted process that carries nothing in memory. */
function nodeLikeSystemForRestart(): System {
  return {
    now: () => '2026-08-19T12:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    renameFile: (from: string, to: string) => {
      try {
        renameSync(from, to);
        return true;
      } catch {
        return false;
      }
    },
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

/**
 * Write the INSTALLATION's view directly, so a test can put the authoritative record and the project
 * mirror deliberately out of step — which is the only way to prove which one decides.
 */
function seedDurable(opts: { consumed?: readonly string[]; reconciled?: readonly string[] } = {}): void {
  const d = durableBinding();
  writeFileSync(
    join(d.stateDir, 'degraded-consumption.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      consumptions: (opts.consumed ?? []).map((workId) => ({
        schemaVersion: '1.0.0',
        installRoot: d.installRoot,
        projectId: PROJECT,
        repository: d.repository,
        phaseId: PHASE,
        grantId: GRANT_ID,
        subjectCommit: 'a'.repeat(40),
        unavailabilityId: 'GKOUT-seeded0000000000000000',
        workId,
        summary: 'seeded',
        consumedAt: '2026-08-19T12:00:00.000Z',
      })),
      reconciliations: (opts.reconciled ?? []).map((workId) => ({
        workId,
        grantId: GRANT_ID,
        projectId: PROJECT,
        repository: d.repository,
        decisionId: 'GKDEC-seeded',
        ask: RECONCILIATION_ASK,
        at: '2026-08-19T13:00:00.000Z',
      })),
    }),
  );
}

const authInput = (
  head: string,
  outage: string,
  durable = durableBinding(),
) => ({
  projectId: PROJECT,
  phaseId: PHASE,
  subjectCommit: head,
  unavailabilityId: outage,
  grantId: GRANT_ID,
  recordedOwner: OWNER,
  ownerOnlyActions: OWNER_ONLY,
  durable,
});

describe('the outage identity', () => {
  it('is derived, so it survives the process that observed the outage', () => {
    const a = outageFor('a'.repeat(40));
    expect(a).toBe(outageFor('a'.repeat(40)));
    expect(a).toMatch(/^GKOUT-[0-9a-f]{24}$/);
  });

  it('differs for a different subject, stop or cause — risk accepted for one is not risk for another', () => {
    const base = {
      projectId: PROJECT,
      phaseId: PHASE,
      subjectCommit: 'a'.repeat(40),
      stopCode: 'X',
      cause: 'CREDENTIAL_UNAVAILABLE' as const,
    };
    expect(deriveUnavailabilityId({ ...base, subjectCommit: 'b'.repeat(40) })).not.toBe(deriveUnavailabilityId(base));
    expect(deriveUnavailabilityId({ ...base, stopCode: 'Y' })).not.toBe(deriveUnavailabilityId(base));
    expect(deriveUnavailabilityId({ ...base, cause: 'PROVIDER_UNAVAILABLE' })).not.toBe(deriveUnavailabilityId(base));
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });
    expect(consumption.persisted).toBe(false);
    // The INSTALLATION record is written first now, so it is what refuses: a write that does nothing
    // leaves no temporary file, and the atomic replace has nothing to move into place.
    expect(consumption.problem).toContain('could not be replaced atomically');
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
      grant: first.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'first of two', at: '2026-08-19T12:00:00.000Z',
    });

    // Still live, with exactly one item left — not refused as a replay.
    const second = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(second.authorised).toBe(true);
    expect(second.remaining).toBe(1);
    expect(consumedGrantIds(sys, root)).toEqual([]); // used, not spent
    consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
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
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!, unavailabilityId: outage, projectId: PROJECT, phaseId: PHASE,
      summary: 'fixture work item', at: '2026-08-19T12:00:00.000Z',
    });
    // Another grant, another store file — the debt is per work item, not per grant.
    consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
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


/* ------------------------------------------------------------------------------------------------
 * IDENTITY STABILITY — the defect that killed the live degraded proof.
 *
 * The outage identity used to be hashed over the human-readable stop reasons, whose first element is
 * `STOPPED (<code>): <detail>`. That detail carries ordinary check and finding state, so the identity
 * moved whenever the repository did — and committing the owner's OWN authority wrapper was enough to
 * move it. The owner approved a grant for GKOUT-4ebaec5e437da56f87bfad61; the next run derived
 * GKOUT-64da7641b13fd1ab286518e6 and the grant refused itself. Correctly, and uselessly.
 *
 * These pin the property that failure needed: an outage identity is a function of WHAT MATERIALLY
 * HAPPENED, never of how it was described.
 * --------------------------------------------------------------------------------------------- */

describe('IDENTITY STABILITY — material cause in, prose out', () => {
  const BASE = {
    projectId: PROJECT,
    phaseId: PHASE,
    subjectCommit: 'a'.repeat(40),
    stopCode: 'CORRECTION_EXHAUSTED',
    cause: 'CREDENTIAL_UNAVAILABLE' as const,
  };

  it('A — the identity survives everything volatile that used to move it', () => {
    // Every input below CHANGED between the discovery run and the proof run that failed. None of
    // them can reach the identity now, because none of them is an argument to it any more: the
    // signature admits a closed cause and nothing else. That is the structural form of the fix —
    // there is no longer a parameter through which prose could arrive.
    const id = deriveUnavailabilityId(BASE);
    expect(id).toBe(deriveUnavailabilityId({ ...BASE }));
    expect(id).toMatch(/^GKOUT-[0-9a-f]{24}$/);

    // The real pairing from the failure: 5 findings and a green suite, versus a failing check and
    // 10 findings. Same project, phase, subject, stop and cause — therefore the same outage.
    const asDiscovered = deriveUnavailabilityId({ ...BASE });
    const asProved = deriveUnavailabilityId({ ...BASE });
    expect(asProved).toBe(asDiscovered);
  });

  it('A2 — the signature admits no prose: reasons/detail are not accepted at all', () => {
    // A caller that still tries to pass the old shape gets the SAME id, because the extra property
    // is not read. The volatile input cannot influence the identity even by accident.
    const withJunk = deriveUnavailabilityId({
      ...BASE,
      ...({ reasons: ['STOPPED (CORRECTION_EXHAUSTED): 5 unresolved findings'], detail: 'anything' } as Record<string, unknown>),
    } as Parameters<typeof deriveUnavailabilityId>[0]);
    expect(withJunk).toBe(deriveUnavailabilityId(BASE));
  });

  it('B — a different project is a different outage', () => {
    expect(deriveUnavailabilityId({ ...BASE, projectId: 'other-project' })).not.toBe(
      deriveUnavailabilityId(BASE),
    );
  });

  it('C — a different phase is a different outage', () => {
    expect(deriveUnavailabilityId({ ...BASE, phaseId: 'OTHER-PHASE1A' })).not.toBe(
      deriveUnavailabilityId(BASE),
    );
  });

  it('D — a different work subject is a different outage', () => {
    expect(deriveUnavailabilityId({ ...BASE, subjectCommit: 'b'.repeat(40) })).not.toBe(
      deriveUnavailabilityId(BASE),
    );
  });

  it('E — a different stop is a different outage', () => {
    // Risk accepted for a defect that resisted correction is not risk accepted for a protected
    // effect, and the identity keeps them apart.
    expect(deriveUnavailabilityId({ ...BASE, stopCode: 'PROTECTED_EFFECT' })).not.toBe(
      deriveUnavailabilityId(BASE),
    );
  });

  it('F — every MATERIAL cause is a distinct outage', () => {
    const ids = GATEKEEPER_UNAVAILABILITY_CAUSES.map((cause) =>
      deriveUnavailabilityId({ ...BASE, cause }),
    );
    expect(new Set(ids).size).toBe(GATEKEEPER_UNAVAILABILITY_CAUSES.length);
    // Named explicitly, because this is the distinction the old design was reaching for: accepting
    // the risk of no credential is not accepting the risk of the provider refusing on spend.
    expect(deriveUnavailabilityId({ ...BASE, cause: 'CREDENTIAL_UNAVAILABLE' })).not.toBe(
      deriveUnavailabilityId({ ...BASE, cause: 'PROVIDER_SPEND_LIMITED' }),
    );
  });

  it('G — rewording a cause cannot move the identity, because wording is not an input', () => {
    // The turn still renders prose for a person to read; it just no longer decides anything. Two
    // turns whose reasons differ entirely, on the same material cause, are the same outage.
    const a = deriveUnavailabilityId({ ...BASE, cause: 'TRANSPORT_NOT_CONFIGURED' });
    const b = deriveUnavailabilityId({ ...BASE, cause: 'TRANSPORT_NOT_CONFIGURED' });
    expect(a).toBe(b);
  });

  it('H — the cause vocabulary is closed, so no free text can become an identity', () => {
    expect(isGatekeeperUnavailabilityCause('CREDENTIAL_UNAVAILABLE')).toBe(true);
    for (const junk of ['', 'credential_unavailable', 'anything at all', 'STOPPED (X): y']) {
      expect(isGatekeeperUnavailabilityCause(junk)).toBe(false);
    }
    expect(GATEKEEPER_UNAVAILABILITY_CAUSES).toHaveLength(7);
  });
});


/* ------------------------------------------------------------------------------------------------
 * CAUSE GRANULARITY — one route cause was four different facts wearing one name.
 *
 * `TRANSPORT_UNAVAILABLE` covered a missing descriptor, an invalid one, one the OWNER had not
 * commercially approved, and one the environment could not reach. Those involve different parties:
 * the third is a governance refusal by the owner, the fourth is the network. Collapsed, a grant
 * accepted for one would answer another with project, phase, subject and stop all unchanged — the
 * over-broad reuse this splits apart.
 * --------------------------------------------------------------------------------------------- */

describe('CAUSE GRANULARITY — the selector reports which fact failed', () => {
  const APPROVED = {
    transportId: 'openai-primary',
    kind: 'openai-responses' as const,
    model: 'gpt-5.6-terra',
    capabilities: ['submit-request', 'receive-decision'],
    credentialRef: 'PROJECTOS_GATEKEEPER_OPENAI_KEY',
    commercialApproval: true,
  };
  const reachable = { reachable: true };

  const causeOf = (descriptor: unknown, availability: { reachable: boolean }) => {
    const sel = selectGatekeeperTransport(
      descriptor as Parameters<typeof selectGatekeeperTransport>[0],
      availability,
    );
    if (sel.outcome !== 'UNAVAILABLE') throw new Error('fixture selected a transport');
    return sel.cause;
  };

  it('a missing descriptor is NOT_CONFIGURED', () => {
    expect(causeOf(null, reachable)).toBe('TRANSPORT_NOT_CONFIGURED');
  });

  it('a descriptor that fails the transport contract is UNUSABLE', () => {
    // No capabilities: it cannot be shown to be read-only, so it cannot carry a review.
    expect(causeOf({ ...APPROVED, capabilities: [] }, reachable)).toBe('TRANSPORT_UNUSABLE');
  });

  it('a valid route the owner has not commercially approved is NOT_APPROVED', () => {
    expect(causeOf({ ...APPROVED, commercialApproval: false }, reachable)).toBe('TRANSPORT_NOT_APPROVED');
  });

  it('an approved route the environment cannot reach is UNREACHABLE', () => {
    expect(causeOf(APPROVED, { reachable: false })).toBe('TRANSPORT_UNREACHABLE');
  });

  it('a route wrong in several ways still yields ONE deterministic cause, outermost first', () => {
    // Unapproved AND unreachable. The owner's gate is answered first: a route the owner never
    // approved must not be reported as a connectivity problem, and the answer must not depend on
    // which check happened to run first.
    const both = causeOf({ ...APPROVED, commercialApproval: false }, { reachable: false });
    expect(both).toBe('TRANSPORT_NOT_APPROVED');
    expect(causeOf({ ...APPROVED, commercialApproval: false }, { reachable: false })).toBe(both);
    // An unusable descriptor outranks both, because nothing about it can be trusted.
    expect(causeOf({ ...APPROVED, capabilities: [], commercialApproval: false }, { reachable: false })).toBe(
      'TRANSPORT_UNUSABLE',
    );
  });
});

describe('CAUSE GRANULARITY — no two material causes share an outage identity', () => {
  const at = (cause: (typeof GATEKEEPER_UNAVAILABILITY_CAUSES)[number]) =>
    deriveUnavailabilityId({
      projectId: PROJECT,
      phaseId: PHASE,
      subjectCommit: 'a'.repeat(40),
      stopCode: 'CORRECTION_EXHAUSTED',
      cause,
    });

  it('every cause is a distinct outage — the full pairwise matrix', () => {
    const seen = new Map<string, string>();
    for (const cause of GATEKEEPER_UNAVAILABILITY_CAUSES) {
      const id = at(cause);
      const clash = seen.get(id);
      expect(clash, `${cause} collides with ${String(clash)}`).toBeUndefined();
      seen.set(id, cause);
    }
    expect(seen.size).toBe(GATEKEEPER_UNAVAILABILITY_CAUSES.length);
  });

  it.each([
    ['TRANSPORT_NOT_CONFIGURED', 'TRANSPORT_UNUSABLE'],
    ['TRANSPORT_NOT_CONFIGURED', 'TRANSPORT_NOT_APPROVED'],
    ['TRANSPORT_NOT_CONFIGURED', 'TRANSPORT_UNREACHABLE'],
    ['TRANSPORT_UNUSABLE', 'TRANSPORT_NOT_APPROVED'],
    ['TRANSPORT_UNUSABLE', 'TRANSPORT_UNREACHABLE'],
    ['TRANSPORT_NOT_APPROVED', 'TRANSPORT_UNREACHABLE'],
  ] as const)('%s and %s cannot share an outage', (a, b) => {
    expect(at(a)).not.toBe(at(b));
  });

  it.each([
    'TRANSPORT_NOT_CONFIGURED',
    'TRANSPORT_UNUSABLE',
    'TRANSPORT_NOT_APPROVED',
    'TRANSPORT_UNREACHABLE',
  ] as const)('%s differs from every non-route cause', (route) => {
    for (const other of ['CREDENTIAL_UNAVAILABLE', 'PROVIDER_SPEND_LIMITED', 'PROVIDER_UNAVAILABLE'] as const) {
      expect(at(route)).not.toBe(at(other));
    }
  });

  it('the owner gate and the network are not the same outage — the point of the split', () => {
    // A grant accepted because the owner has not approved commercial use must never answer an
    // outage that was merely a network failure, and vice versa.
    expect(at('TRANSPORT_NOT_APPROVED')).not.toBe(at('TRANSPORT_UNREACHABLE'));
  });
});

describe('IDENTITY STABILITY — the authority wrapper does not move the outage', () => {
  // THE EXACT REGRESSION THE LIVE PROOF EXPOSED, in a real temp repository. Discover an outage at
  // Hwork, commit a grant-only wrapper naming it, and derive again: the grant commit must not
  // change the answer, or an owner can never approve a grant that the next run accepts.
  it('derives the same outage before and after the grant-only commit', () => {
    const { root, sys, head: work } = repo();

    const cause = 'CREDENTIAL_UNAVAILABLE' as const;
    const discovered = deriveUnavailabilityId({
      projectId: PROJECT,
      phaseId: PHASE,
      subjectCommit: work,
      stopCode: 'CORRECTION_EXHAUSTED',
      cause,
    });

    // The owner commits a grant naming that outage, and NOTHING else — the wrapper shape.
    writeGrant(root, grantBody(work, discovered));
    commitAll(root, 'record one-use degraded owner grant');
    const grantCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(grantCommit).not.toBe(work);

    // The wrapper resolves back to the work it wraps...
    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('wrapper');
    const subject = degradedWorkSubject(sys, root, wrapper);
    expect(subject.subjectCommit).toBe(work);

    // ...and the outage derived against that subject is the SAME one the owner approved.
    const rederived = deriveUnavailabilityId({
      projectId: PROJECT,
      phaseId: PHASE,
      subjectCommit: subject.subjectCommit as string,
      stopCode: 'CORRECTION_EXHAUSTED',
      cause,
    });
    expect(rederived).toBe(discovered);

    // And the committed grant is therefore accepted rather than refusing itself.
    const decision = authoriseDegradedContinuation(sys, root, {
      ...authInput(work, discovered),
      unavailabilityId: rederived,
    });
    expect(decision.reasons).toEqual([]);
    expect(decision.authorised).toBe(true);
  });

  it('hashing the grant commit instead of the work subject would break it — and does not happen', () => {
    const { root, sys, head: work } = repo();
    const cause = 'CREDENTIAL_UNAVAILABLE' as const;
    const at = (subjectCommit: string) =>
      deriveUnavailabilityId({ projectId: PROJECT, phaseId: PHASE, subjectCommit, stopCode: 'CORRECTION_EXHAUSTED', cause });

    const discovered = at(work);
    writeGrant(root, grantBody(work, discovered));
    commitAll(root, 'record one-use degraded owner grant');
    const grantCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    // The wrapper commit is a DIFFERENT subject, and binding to it would produce a different
    // outage — which is precisely the self-invalidation the wrapper model exists to avoid.
    expect(at(grantCommit)).not.toBe(discovered);
    const subject = degradedWorkSubject(sys, root, authorityWrapper(sys, root, PHASE, GRANT_ID));
    expect(subject.subjectCommit).toBe(work);
    expect(subject.subjectCommit).not.toBe(grantCommit);
  });
});

describe('IDENTITY STABILITY — a stale grant still cannot authorise', () => {
  it('a grant naming a superseded outage is refused, however well-formed', () => {
    // The historical DEGRADED-LIVE-PROOF1A is exactly this shape: legitimate, owner-signed, and
    // answering an outage that no longer occurs. Stabilising the identity must not make such a
    // grant usable — it names a different outage and stays refused.
    const { root, sys, head } = repo();
    const cause = 'CREDENTIAL_UNAVAILABLE' as const;
    const current = deriveUnavailabilityId({ projectId: PROJECT, phaseId: PHASE, subjectCommit: head, stopCode: 'CORRECTION_EXHAUSTED', cause });
    const superseded = deriveUnavailabilityId({ projectId: PROJECT, phaseId: PHASE, subjectCommit: head, stopCode: 'CORRECTION_EXHAUSTED', cause: 'PROVIDER_UNAVAILABLE' });
    expect(superseded).not.toBe(current);

    writeGrant(root, grantBody(head, superseded));
    commitAll(root, 'grant answering a superseded outage');

    const decision = authoriseDegradedContinuation(sys, root, { ...authInput(head, current) });
    expect(decision.authorised).toBe(false);
    expect(decision.reasons.join(' ')).toContain('not');
  });
});

describe('ENTRY PROOF G — running the suite creates no authority', () => {
  // WHAT THIS USED TO ASSERT, AND WHY THAT WAS WRONG. It read the REAL ProjectOS checkout and
  // required `.projectops/authority/` to contain no degraded grant and no use record. That was
  // honest while no grant had ever existed — but it is an assertion about the state of a working
  // repository, not about this code, and it becomes FALSE exactly when the system is used as
  // designed. It did: the owner committed a real one-use grant, this test failed, `agent-tests`
  // went red, the stop detail changed, and the outage identity moved out from under the grant the
  // owner had just approved. A test that breaks on correct operation is worse than no test, and
  // this one took a live proof down with it.
  //
  // The useful half is kept and made hermetic: running the suite must not create authority
  // ANYWHERE, which is a property of the tests and is true regardless of what the repository holds.
  it('leaves no grant or use record in any temp repository it built', () => {
    const { root } = repo();
    const authority = readdirSync(join(root, '.projectops', 'authority'));
    expect(authority.filter((f) => f.includes('degraded-grant'))).toEqual([]);
    const execution = readdirSync(join(root, '.projectops', 'execution'));
    expect(execution.filter((f) => f.startsWith('degraded-use.'))).toEqual([]);
  });

  it('writes nothing into the real checkout: every fixture path is under the temp root', () => {
    // The structural version of the same guarantee. `degradedGrantRelPath` and
    // `degradedStoreRelPath` are the only two places authority and its use are addressed, and both
    // are repo-RELATIVE — so a fixture can only ever write beneath the root it was handed.
    const grantRel = degradedGrantRelPath(PHASE, GRANT_ID);
    const storeRel = degradedStoreRelPath(GRANT_ID);
    expect(grantRel).not.toBeNull();
    expect(storeRel).not.toBeNull();
    for (const rel of [grantRel, storeRel]) {
      expect(isAbsolute(String(rel))).toBe(false);
      expect(String(rel).startsWith('.projectops/')).toBe(true);
      expect(String(rel).includes('..')).toBe(false);
    }
    const { root } = repo();
    expect(join(root, ...String(grantRel).split('/')).startsWith(root)).toBe(true);
    expect(join(root, ...String(storeRel).split('/')).startsWith(root)).toBe(true);
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
 * PATH PROOF — the caller shape the runner ACTUALLY passes, and the outage route it unblocks.
 *
 * WHY THESE EXIST. ENTRY PROOF D2 above proved `committedGovernanceOwner` against paths the TEST
 * chose, and every one of them was repo-relative. The real caller is `runner.ts`, which passes
 * `context.planPath` — and `loadGovernedContext` builds that with `join(root, rel)`, so it is
 * ABSOLUTE. The function treated it as relative, every git call failed, the owner resolved to null,
 * and the first live degraded-mode attempt refused with "no committed approved plan records an
 * owner" while a committed plan recorded one. It failed closed, so nothing unsafe happened; it also
 * meant the degraded route was unreachable for the owner, and no outage identity could be derived.
 *
 * So these do not construct a path by hand. They go through the real `loadGovernedContext` and use
 * what it hands the runner, which is the only thing that would have caught this.
 * --------------------------------------------------------------------------------------------- */

describe('PATH PROOF — the real caller shape, and the outage route it unblocks', () => {
  const CONFIG = {
    projectId: PROJECT,
    projectName: 'ProjectOS',
    projectType: 'saas',
    owner: OWNER,
    repo: 'universalbizcomply/ProjectOS',
    localPath: 'C:/dev/ProjectOS',
    protectedBranches: ['main'],
    productionFreeze: true,
    allowedActions: ['create-local-files'],
    forbiddenActions: ['production-deploy'],
    approvalGates: ['phase-closure'],
    secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
    validators: ['validators/val-*.cjs'],
    evidenceRequirements: ['evidence-pack'],
    installStatus: 'installed',
  };

  /** ProjectOS's own approved plan, so the fixture cannot drift from the shipped schema or rules. */
  const readyPlan = () =>
    JSON.parse(
      readFileSync(new URL('../../state/projectos-v3.plan.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;

  /** A temp repo governed exactly the way `loadGovernedContext` governs a real checkout. */
  function governedRepo(declaredPlanRel?: string): {
    root: string;
    sys: System;
    head: string;
    planRel: string;
  } {
    const { root, sys } = repo();
    const planRel = declaredPlanRel ?? '.projectops/plan.json';
    const config =
      declaredPlanRel === undefined ? CONFIG : { ...CONFIG, planMemory: { planPath: declaredPlanRel } };
    writeFileSync(join(root, '.projectops', 'project-config.json'), `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(join(root, ...planRel.split('/')), `${JSON.stringify(readyPlan(), null, 2)}\n`);
    commitAll(root, 'governed fixture: config + approved plan');
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return { root, sys, head, planRel };
  }

  /** The governed context or a thrown fixture error — never a silently skipped assertion. */
  function planPathOf(sys: System, root: string): string {
    const governed = loadGovernedContext(sys, root);
    if (!governed.ok) throw new Error(`fixture is not governed: ${governed.code} ${governed.detail}`);
    return governed.context.planPath;
  }

  /** Same System, but every git invocation is recorded, so the path git SAW can be asserted. */
  function recordingSys(base: System): { sys: System; calls: string[][] } {
    const calls: string[][] = [];
    const inner = base as unknown as {
      exec(c: string, a: readonly string[]): { code: number; stdout: string; stderr: string };
    };
    const sys = {
      ...(base as unknown as object),
      renameFile: (from: string, to: string) => {
      try {
        renameSync(from, to);
        return true;
      } catch {
        return false;
      }
    },
      exec: (command: string, args: readonly string[]) => {
        calls.push([command, ...args]);
        return inner.exec(command, args);
      },
    } as unknown as System;
    return { sys, calls };
  }

  it('A — the absolute path the governed context produces resolves the committed owner', () => {
    const { root, sys } = governedRepo();
    const planPath = planPathOf(sys, root);
    // The shape that broke it. Asserted, not assumed: if this ever stops being absolute the reason
    // these tests exist has changed and someone must look.
    expect(isAbsolute(planPath)).toBe(true);
    expect(committedGovernanceOwner(sys, root, planPath)).toBe(OWNER);
  });

  it('A2 — and for a config-declared plan record, which is how ProjectOS governs itself', () => {
    const rel = '.projectops/plan-35316a7a7ad3acd6-36e79927c769.json';
    const { root, sys } = governedRepo(rel);
    const planPath = planPathOf(sys, root);
    expect(isAbsolute(planPath)).toBe(true);
    expect(committedGovernanceOwner(sys, root, planPath)).toBe(OWNER);
  });

  it('B — the git object it reads is the repo-relative plan path, never the absolute one', () => {
    const rel = '.projectops/plan-fixture-record.json';
    const { root, sys: base } = governedRepo(rel);
    const planPath = planPathOf(base, root);
    const { sys, calls } = recordingSys(base);

    expect(committedGovernanceOwner(sys, root, planPath)).toBe(OWNER);

    const shows = calls.filter((c) => c[3] === 'show');
    expect(shows).toHaveLength(1);
    // `./` is load-bearing, not decoration — without it this addresses the repository top rather
    // than the root, which is what B2 demonstrates going wrong.
    expect(shows[0]?.[4]).toBe(`HEAD:./${rel}`);
    // `-C <root>` is the only argument allowed to carry the root; nothing else may.
    const carriedRoot = calls.flatMap((c) => c.filter((a, i) => i !== 2 && a.includes(root)));
    expect(carriedRoot).toEqual([]);
  });

  it('B2 — a root INSIDE a larger repository reads its own plan, not the one at the top', () => {
    // FOUND BY ADVERSARIAL REVIEW, AND IT WAS THE FIX ITSELF THAT MADE IT REACHABLE. A pathspec
    // after `--` resolves against `-C root`; `<rev>:<path>` resolves against the TOP of the working
    // tree unless it starts with `./`. So "committed and unmodified" was being established about
    // one file while the owner was read from another — and the outer plan here records an owner
    // while the inner one does not, which turns a refusal into an acceptance.
    const { root: outer, sys } = repo();
    writeFileSync(join(outer, '.projectops', 'project-config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`);
    writeFileSync(join(outer, '.projectops', 'plan.json'), `${JSON.stringify(readyPlan(), null, 2)}\n`);

    // A second governed project checked out INSIDE that repository, with no owner of its own.
    const inner = join(outer, 'nested');
    mkdirSync(join(inner, '.projectops'), { recursive: true });
    const innerPlan = readyPlan();
    delete (innerPlan['governance'] as Record<string, unknown>)['owner'];
    writeFileSync(join(inner, '.projectops', 'project-config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`);
    writeFileSync(join(inner, '.projectops', 'plan.json'), `${JSON.stringify(innerPlan, null, 2)}\n`);
    commitAll(outer, 'outer plan with an owner, nested plan without one');

    // Same repository, same commit, same relative path — only the root differs.
    expect(committedGovernanceOwner(sys, outer, join(outer, '.projectops', 'plan.json'))).toBe(OWNER);
    expect(committedGovernanceOwner(sys, inner, join(inner, '.projectops', 'plan.json'))).toBeNull();
  });

  it('C — the owner is the committed one, checked against git independently', () => {
    const { root, sys } = governedRepo();
    const committed = JSON.parse(
      execFileSync('git', ['-C', root, 'show', 'HEAD:.projectops/plan.json'], { encoding: 'utf8' }),
    ) as { governance: { owner: string } };
    expect(committedGovernanceOwner(sys, root, planPathOf(sys, root))).toBe(committed.governance.owner);
  });

  it('D — a plan modified since HEAD still refuses, absolute path or not', () => {
    const { root, sys } = governedRepo();
    const planPath = planPathOf(sys, root);
    expect(committedGovernanceOwner(sys, root, planPath)).toBe(OWNER);

    const plan = readyPlan();
    (plan['governance'] as Record<string, unknown>)['owner'] = 'Somebody Else';
    writeFileSync(join(root, '.projectops', 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);

    // Neither copy is trusted: modified since commit is a refusal, not a choice between them.
    expect(committedGovernanceOwner(sys, root, planPath)).toBeNull();
  });

  it.each([
    ['an absolute path outside the root', (root: string) => join(root, '..', 'outside-plan.json')],
    ['the root directory itself', (root: string) => root],
    ['a different drive', () => 'D:/elsewhere/plan.json'],
    ['a UNC share', () => '//server/share/plan.json'],
    ['a rooted posix path', () => '/etc/plan.json'],
    ['a relative traversal', () => '../outside/plan.json'],
    ['a traversal buried mid-path', () => '.projectops/../../outside/plan.json'],
    ['git pathspec magic', () => ':(glob).projectops/**'],
    ['an empty path', () => ''],
    ['the current directory', () => '.'],
    ['a path of nothing but dot segments', () => './././'],
    ['a path carrying a NUL', () => `.projectops/pl${String.fromCharCode(0)}an.json`],
  ])('E — refuses %s before any git call', (_label, make) => {
    const { root, sys: base } = governedRepo();
    // The fixture itself is sound, so a null below is the path being refused and nothing else.
    expect(committedGovernanceOwner(base, root, planPathOf(base, root))).toBe(OWNER);

    const { sys, calls } = recordingSys(base);
    expect(committedGovernanceOwner(sys, root, make(root))).toBeNull();
    // AND THE REFUSAL IS THE REDUCTION'S, NOT GIT'S. Asserting only the null would pass with every
    // one of these guards removed, because git refuses most of them by itself — which is how a
    // guard survives mutation while its test still goes green. A path that reaches git has already
    // been accepted as a name for something inside this repository.
    expect(calls).toEqual([]);
  });

  it('E2 — a non-string path refuses rather than throwing out of the authority check', () => {
    // The types say this cannot happen; a crash inside the degraded gate would be worse than a
    // refusal if it ever did, and an untested guard is the same as no guard.
    const { root, sys: base } = governedRepo();
    const { sys, calls } = recordingSys(base);
    expect(committedGovernanceOwner(sys, root, undefined as unknown as string)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('F — a repo-relative path still resolves, so the earlier caller shape is not broken', () => {
    const { root, sys } = governedRepo();
    expect(committedGovernanceOwner(sys, root, '.projectops/plan.json')).toBe(OWNER);
    expect(committedGovernanceOwner(sys, root, './.projectops/plan.json')).toBe(OWNER);
    expect(
      committedGovernanceOwner(sys, root, ['.projectops', 'plan.json'].join(String.fromCharCode(92))),
    ).toBe(OWNER);
  });

  it('G — an absolute path against a non-absolute root refuses rather than guessing a cwd', () => {
    const { root, sys } = governedRepo();
    const planPath = planPathOf(sys, root);
    expect(committedGovernanceOwner(sys, '.', planPath)).toBeNull();
    expect(committedGovernanceOwner(sys, '', planPath)).toBeNull();
  });

  it('G2 — and refuses even when a cwd WOULD resolve that relative root onto the right repo', () => {
    // THE CASE THAT MAKES G MORE THAN A FORMALITY. With the process cwd an ancestor of the root,
    // `relative(leaf, planPath)` yields a clean in-repo path and `git -C leaf` finds the repository
    // — so without the guard this succeeds, and the plan whose owner grants degraded authority was
    // chosen by an ambient cwd nobody stated. Refusing costs the real caller nothing: it passes
    // `process.cwd()`, which is always absolute.
    const { root, sys } = governedRepo();
    const planPath = planPathOf(sys, root);
    const parent = join(root, '..');
    const leaf = basename(root);
    const before = process.cwd();
    try {
      process.chdir(parent);
      expect(committedGovernanceOwner(sys, leaf, planPath)).toBeNull();
    } finally {
      process.chdir(before);
    }
  });

  it('G3 — a drive-RELATIVE path is refused even when the cwd would make it resolve correctly', () => {
    // THE SAME AMBIGUITY, ARRIVING THROUGH THE OTHER PARAMETER. `C:x` is resolved against drive C's
    // own current directory, so with the cwd inside the root this names the real plan and would be
    // accepted — the argument would have meant a different file from anywhere else. Raised by
    // review; the first test written for it proved nothing, because from an unrelated cwd the path
    // reduces to a `..` traversal and is refused a step later for the wrong reason.
    const { root, sys: base } = governedRepo();
    expect(isAbsolute(root) && root.slice(0, 2).toUpperCase() === 'C:').toBe(true);
    const before = process.cwd();
    try {
      process.chdir(root);
      const { sys, calls } = recordingSys(base);
      expect(committedGovernanceOwner(sys, root, 'C:.projectops/plan.json')).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      process.chdir(before);
    }
  });

  it('H — the runner still passes the governed context path, which is the shape proven above', () => {
    const runner = readFileSync(new URL('../src/loop/runner.ts', import.meta.url), 'utf8');
    expect(runner).toContain('committedGovernanceOwner(sys, root, context.planPath)');
    const governed = readFileSync(new URL('../src/governedContext.ts', import.meta.url), 'utf8');
    // The absolute path is deliberate — `resolveWithinRoot` joins it onto the root.
    expect(governed).toContain('return { ok: true, path: join(root, rel) };');
  });

  it('I — with the owner resolved, the route reaches the outage identity instead of refusing', () => {
    // FIXTURE ONLY. No real grant, no real outage, no discovery run — this proves the ROUTE, which
    // is exactly the step the live attempt could never reach.
    const { root, sys, head } = governedRepo();

    // 1. the gate that refused the live attempt.
    const owner = committedGovernanceOwner(sys, root, planPathOf(sys, root));
    expect(owner).toBe(OWNER);

    // 2. no grant is committed, so there is no wrapper and the subject is the run's own head.
    const wrapper = authorityWrapper(sys, root, PHASE, GRANT_ID);
    expect(wrapper.kind).toBe('none');
    const subject = degradedWorkSubject(sys, root, wrapper);
    expect(subject.subjectCommit).toBe(head);

    // 3. the identity the live run could never produce.
    const outage = deriveUnavailabilityId({
      projectId: PROJECT,
      phaseId: PHASE,
      subjectCommit: head,
      stopCode: 'CORRECTION_EXHAUSTED',
      cause: 'CREDENTIAL_UNAVAILABLE',
    });
    expect(outage).toMatch(/^GKOUT-[0-9a-f]{24}$/);

    // 4. and the route still stops there. Reaching the outage is not authority to continue: with no
    //    committed grant there is nothing to authorise, which is the discovery run's correct end.
    const decision = authoriseDegradedContinuation(sys, root, {
      ...authInput(head, outage),
      recordedOwner: owner as string,
    });
    expect(decision.authorised).toBe(false);
    expect(decision.grant).toBeNull();
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
      subjectCommit: h0,
      durable: durableBinding(),
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

describe('a committed use record is evidence, not a scratchpad', () => {
  it('refuses to append a second spend to a record the owner has committed', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: 2 }));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const first = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'first item',
      at: '2026-08-19T12:00:00.000Z',
    });
    expect(first.persisted).toBe(true);

    // The owner commits the record as reconciliation evidence — the flow the design invites.
    commitAll(root, 'evidence: degraded use record');
    const committedBytes = readFileSync(join(root, ...(degradedStoreRelPath(GRANT_ID) as string).split('/')), 'utf8');

    const second = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'second item',
      at: '2026-08-19T13:00:00.000Z',
    });

    // Without this guard the write went ahead, failed its own read-back, and left the committed record
    // permanently unreadable — which erased the FIRST item's outstanding debt along with it.
    expect(second.persisted).toBe(false);
    expect(second.workId).toBeNull();
    expect(second.problem).toContain('committed');
    expect(readFileSync(join(root, ...(degradedStoreRelPath(GRANT_ID) as string).split('/')), 'utf8')).toBe(
      committedBytes,
    );
    expect(readDegradedStore(sys, root, GRANT_ID)?.workItems).toHaveLength(1);
    expect(degradedReconciliationState(sys, root).outstandingWorkIds).toHaveLength(1);
  });
});

describe('the debt block a governed gate must obey', () => {
  it('is empty when nothing was ever run degraded', () => {
    const { root, sys } = repo();
    expect(reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() })).toEqual([]);
  });

  it('refuses and names the work, the reason and the next action', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const consumed = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });

    const block = reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10));
    expect(block).toContain('DEGRADED_DEBT_OUTSTANDING');
    expect(block).toContain(consumed.workId as string);
    expect(block).toContain('projectos reconcile --grant');
  });

  it('refuses a COMMITTED record that has since been edited — the case a disk-only check cannot see', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const consumed = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });
    commitAll(root, 'evidence: use record');

    // Perfectly parseable on disk, and no longer what was committed. `unreadableDegradedStores` sees
    // nothing wrong here, and `degradedReconciliationState` DROPS the record — which is how editing a
    // file erased the debt it recorded.
    const rel = degradedStoreRelPath(GRANT_ID) as string;
    writeFileSync(
      join(root, ...rel.split('/')),
      JSON.stringify({ grantId: GRANT_ID, consumedAt: 'edited', workItems: [], reconciliations: [] }),
    );

    expect(unreadableDegradedStores(sys, root)).toEqual([]);
    expect(degradedReconciliationState(sys, root).required).toBe(false);
    // The installation says this work is done AND discharged, so the block reaches the project
    // evidence — where the edited record is the thing it refuses on.
    seedDurable({ consumed: [consumed.workId as string], reconciled: [consumed.workId as string] });
    const block = reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10));
    expect(block).toContain('DEGRADED_DEBT_UNREADABLE');
    expect(block).toContain('never read as "no debt"');
  });

  it('clears once the work carries an accepted reconciliation', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const consumed = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });
    const rel = degradedStoreRelPath(GRANT_ID) as string;
    const path = join(root, ...rel.split('/'));
    const store = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      path,
      JSON.stringify({
        ...store,
        reconciliations: [
          {
            workId: consumed.workId,
            decisionId: 'GKDEC-GKREQ-fixture',
            ask: RECONCILIATION_ASK,
            decisionAccepted: true,
          },
        ],
      }),
    );

    // A DISCHARGE MUST NAME A CALL THAT HAPPENED. Without a ledger entry the same record is an
    // assertion, and the gate says so — see the case below.
    // The installation still holds the debt, so that is what the block reports first.
    expect(reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10))).toContain(
      'DEGRADED_DEBT_OUTSTANDING',
    );
    // Once the installation records the discharge too, the project evidence is checked — and an
    // uncorroborated decision id there is still refused.
    seedDurable({ consumed: [consumed.workId as string], reconciled: [consumed.workId as string] });
    expect(reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10))).toContain(
      'DEGRADED_DEBT_UNCORROBORATED',
    );

    writeFileSync(
      join(root, '.projectops', 'gatekeeper-ledger.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        entries: [
          {
            requestId: 'GKREQ-fixture',
            projectId: PROJECT,
            phaseId: PHASE,
            model: 'gpt-5.6-terra',
            usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
            costMicroUsd: 10,
            at: '2026-08-19T12:30:00.000Z',
          },
        ],
      }),
    );

    expect(reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() })).toEqual([]);
  });

  it('refuses a discharge no gatekeeper call corroborates, even in its own record', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const consumed = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });
    const path = join(root, ...(degradedStoreRelPath(GRANT_ID) as string).split('/'));
    const store = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      path,
      JSON.stringify({
        ...store,
        reconciliations: [
          {
            workId: consumed.workId,
            decisionId: 'GKDEC-GKREQ-never-happened',
            ask: RECONCILIATION_ASK,
            decisionAccepted: true,
          },
        ],
      }),
    );

    // The installation agrees the work is discharged; the project evidence names a decision that never
    // happened, and that is what the block refuses on.
    seedDurable({ consumed: [consumed.workId as string], reconciled: [consumed.workId as string] });
    const block = reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10));
    expect(block).toContain('DEGRADED_DEBT_UNCORROBORATED');
    expect(block).toContain('never happened'.replace(' ', '-'));
  });

  it('does not let a reconciliation in one record clear work in another', () => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const consumed = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'fixture work item',
      at: '2026-08-19T12:00:00.000Z',
    });

    // A second record, carrying no work of its own, claiming to discharge the first record's item —
    // and a ledger entry so the corroboration check cannot be what refuses it.
    writeFileSync(
      join(root, '.projectops', 'gatekeeper-ledger.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        entries: [
          {
            requestId: 'fixture',
            projectId: PROJECT,
            phaseId: PHASE,
            model: 'gpt-5.6-terra',
            usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
            costMicroUsd: 10,
            at: '2026-08-19T12:30:00.000Z',
          },
        ],
      }),
    );
    writeFileSync(
      join(root, '.projectops', 'execution', 'degraded-use.OTHER-GRANT1A.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        grantId: 'OTHER-GRANT1A',
        unavailabilityId: outage,
        projectId: PROJECT,
        phaseId: PHASE,
        consumedAt: '2026-08-19T13:00:00.000Z',
        maxWorkItems: 1,
        workItems: [],
        reconciliations: [
          {
            workId: consumed.workId,
            decisionId: 'GKDEC-fixture',
            ask: RECONCILIATION_ASK,
            decisionAccepted: true,
          },
        ],
      }),
    );

    const block = reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10));
    expect(block).toContain('DEGRADED_DEBT_OUTSTANDING');
    expect(block).toContain(consumed.workId as string);
  });
});

describe('the record that outlives the project', () => {
  /** Drive a real consumption, then hand back everything a durability proof needs. */
  const spend = (max = 1) => {
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage, { maxWorkItems: max }));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    const consumed = consumeDegradedGrant(sys, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'the bounded item',
      at: '2026-08-19T12:00:00.000Z',
    });
    expect(consumed.persisted).toBe(true);
    return { root, sys, head, outage, workId: consumed.workId as string };
  };

  const deleteProjectMirror = (root: string) => {
    const abs = join(root, ...(degradedStoreRelPath(GRANT_ID) as string).split('/'));
    rmSync(abs, { force: true });
    expect(existsSync(abs)).toBe(false);
  };

  it('refuses a durable write that lands but loses what it was told to record', () => {
    // FOUND BY MUTATION TESTING: deleting the read-back failed nothing, because every fixture wrote
    // faithfully. A write that succeeds and drops the entry is the exact shape the read-back exists
    // for — without it, a grant would be believed spent while the record said otherwise.
    const { root, sys, head } = repo();
    const outage = outageFor(head);
    writeGrant(root, grantBody(head, outage));
    commitAll(root, 'fixture grant');
    const auth = authoriseDegradedContinuation(sys, root, authInput(head, outage));

    const lossy: System = {
      ...sys,
      writeText: (p: string, c: string) => {
        if (p.includes('degraded-consumption')) {
          const parsed = JSON.parse(c) as Record<string, unknown>;
          sys.writeText(p, JSON.stringify({ ...parsed, consumptions: [] }));
          return;
        }
        sys.writeText(p, c);
      },
    };

    const consumed = consumeDegradedGrant(lossy, root, {
      subjectCommit: head,
      durable: durableBinding(),
      grant: auth.grant!,
      unavailabilityId: outage,
      projectId: PROJECT,
      phaseId: PHASE,
      summary: 'the bounded item',
      at: '2026-08-19T12:00:00.000Z',
    });

    expect(consumed.persisted).toBe(false);
    expect(consumed.workId).toBeNull();
    expect(consumed.problem).toContain('could not be read back');
    // And nothing started: the project mirror was never written either.
    expect(existsSync(join(root, ...(degradedStoreRelPath(GRANT_ID) as string).split('/')))).toBe(false);
  });

  it('a spent grant stays spent when the project evidence is deleted', () => {
    const { root, sys, head, outage } = spend();
    deleteProjectMirror(root);

    // The project now looks as though degraded mode never ran. The installation knows better.
    expect(consumedGrantIds(sys, root)).toEqual([]);
    const again = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(again.authorised).toBe(false);
    expect(again.reasons.join(' ')).toContain('already spent');
  });

  it('the debt stays outstanding when the project evidence is deleted', () => {
    const { root, sys, workId } = spend();
    deleteProjectMirror(root);

    const block = reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() });
    expect(block.join(String.fromCharCode(10))).toContain('DEGRADED_DEBT_OUTSTANDING');
    expect(block.join(String.fromCharCode(10))).toContain(workId);
  });

  it('survives a restart: a fresh System reads the same installation record', () => {
    const { root, head, outage } = spend();
    deleteProjectMirror(root);

    // A new process, nothing carried in memory.
    const restarted = nodeLikeSystemForRestart();
    const again = authoriseDegradedContinuation(restarted, root, authInput(head, outage));
    expect(again.authorised).toBe(false);
    expect(
      reconciliationDebtBlock(restarted, root, { projectId: PROJECT, durable: durableBinding() }).join(
        String.fromCharCode(10),
      ),
    ).toContain('DEGRADED_DEBT_OUTSTANDING');
  });

  it('a project mirror that CLAIMS reconciliation does not clear the installation debt', () => {
    const { root, sys, workId } = spend();
    const abs = join(root, ...(degradedStoreRelPath(GRANT_ID) as string).split('/'));
    const store = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      abs,
      JSON.stringify({
        ...store,
        reconciliations: [
          { workId, decisionId: 'GKDEC-invented', ask: RECONCILIATION_ASK, decisionAccepted: true },
        ],
      }),
    );

    // The mirror says discharged. The installation has no such discharge, and the installation decides.
    expect(degradedReconciliationState(sys, root).required).toBe(false);
    expect(
      reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10)),
    ).toContain('DEGRADED_DEBT_OUTSTANDING');
  });

  it('an accepted reconciliation in the installation record clears the debt', () => {
    const { root, sys, workId } = spend();
    seedDurable({ consumed: [workId], reconciled: [workId] });
    // And the project evidence is gone entirely — the discharge does not depend on it.
    deleteProjectMirror(root);

    expect(reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() })).toEqual([]);
  });

  it('a corrupt installation record fails closed, for both the gate and the grant', () => {
    const { root, sys, head, outage } = spend();
    writeFileSync(join(durableBinding().stateDir, 'degraded-consumption.json'), '{ truncated');

    const block = reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() });
    expect(block.join(String.fromCharCode(10))).toContain('DEGRADED_DEBT_UNREADABLE');

    const again = authoriseDegradedContinuation(sys, root, authInput(head, outage));
    expect(again.authorised).toBe(false);
    expect(again.reasons.join(' ')).toContain('degraded ledger');
  });

  it('does not read another project\'s spends as its own', () => {
    const { root, sys, workId } = spend();
    // Same work id, another project and another repository: not this project's debt.
    const d = durableBinding();
    const ledger = JSON.parse(readFileSync(join(d.stateDir, 'degraded-consumption.json'), 'utf8')) as Record<string, unknown>;
    const mine = (ledger['consumptions'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    writeFileSync(
      join(d.stateDir, 'degraded-consumption.json'),
      JSON.stringify({
        ...ledger,
        consumptions: [{ ...mine, projectId: 'someone-else', repository: 'github.com/someone/else' }],
      }),
    );

    // The project mirror still records the work, and still owes for it — that is its own evidence.
    // What is being proven here is narrower: the INSTALLATION record no longer attributes that spend
    // to this project, so with the mirror gone there is nothing of ours outstanding.
    deleteProjectMirror(root);
    expect(
      reconciliationDebtBlock(sys, root, { projectId: PROJECT, durable: durableBinding() }).join(String.fromCharCode(10)),
    ).not.toContain(workId);
  });
});
