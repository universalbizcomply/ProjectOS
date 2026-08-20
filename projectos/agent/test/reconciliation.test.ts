/**
 * Discharging degraded-mode debt, proven against a real git repository and a fake provider.
 *
 * NOTHING HERE IS A REAL GRANT OR A REAL CALL. The fixtures live in a temporary directory committed
 * to a throwaway repository, the credential is a literal test string, and the HTTP port is injected —
 * no network is opened and no key on this machine is read. `grantedBy` names the owner only to
 * exercise the contract's comparisons.
 *
 * WHAT THESE PROVE, in the order the safety argument runs: a debt can only be cleared by a real
 * decision, bound to this exact work, over the exact bytes the owner approved; every other path
 * leaves the debt standing; nothing is paid for that could not be recorded; and once cleared, the
 * same review cannot be spent twice.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import {
  reconcileDegradedWork,
  RECONCILIATION_ACCEPTED_VERDICT,
  type ReconciliationDeps,
} from '../src/loop/reconciliation.js';
import { degradedStoreRelPath, readDegradedStore } from '../src/loop/degradedMode.js';
import { degradedGrantRelPath } from '../src/loop/degradedModeGrants.js';
import { inMemoryResolverForTests, unprovisionedResolver } from '../src/loop/credentialResolver.js';
import type { HttpPort, HttpResponse } from '../src/loop/transports/openaiResponses.js';
import {
  DEGRADED_MODE_CHOICE,
  DEGRADED_MODE_SCHEMA_VERSION,
  RECONCILIATION_ASK,
  gateBlockedByReconciliation,
  reconciliationState,
  type BudgetPolicy,
  type GovernanceThreadBinding,
  type LedgerEntry,
  type RateCard,
} from '@projectos/core';

const PROJECT = 'projectos';
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const GRANT = 'DEGRADED-RECONCILE-FIXTURE1A';
const WORK = 'GKWORK-000000000000fixture'.replace('fixture', 'aaaa');
const OUTAGE = 'GKOUT-c1869b6abf8e873aa88abb8c';
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
const SECRET = 'sk-test-not-a-real-key-000000000000';
const OWNER_ONLY = ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'];
const OWNER = 'Murad';
const THREAD: GovernanceThreadBinding = {
  schemaVersion: '1.0.0',
  projectId: PROJECT,
  repositoryRoot: '',
  providerThreadId: 'resp_7f3a9c2e5b81d40a',
  transportId: 'openai-primary',
  createdAt: '2026-08-18T02:41:00+01:00',
};

const BUDGET: BudgetPolicy = { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 };

const RATE: RateCard = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

interface World {
  readonly root: string;
  readonly sys: System;
  /** The reviewed baseline: the parent of the authority commit. */
  readonly subject: string;
  readonly grantCommit: string;
  readonly git: (...args: string[]) => string;
}

function nodeLikeSystem(root: string): System {
  return {
    now: () => '2026-08-20T16:00:00.000Z',
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
    env: () => undefined,
  } as unknown as System;
}

/**
 * A repository shaped exactly like a real degraded-mode aftermath: a reviewed baseline, a grant-only
 * authority commit on top of it, and an uncommitted use record naming one unreconciled work item.
 */
function world(
  over: { commitGrant?: boolean; store?: unknown | null; grant?: Record<string, unknown> } = {},
): World {
  const root = mkdtempSync(join(tmpdir(), 'projectos-reconcile-'));
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
  git('commit', '-q', '-m', 'reviewed baseline');
  const subject = git('rev-parse', 'HEAD').trim();

  const grantRel = degradedGrantRelPath(PHASE, GRANT) as string;
  writeFileSync(
    join(root, ...grantRel.split('/')),
    `${JSON.stringify(
      {
        schemaVersion: DEGRADED_MODE_SCHEMA_VERSION,
        grantId: GRANT,
        projectId: PROJECT,
        phaseId: PHASE,
        unavailabilityId: OUTAGE,
        ownerChoice: DEGRADED_MODE_CHOICE,
        grantedBy: OWNER,
        grantedAt: '2026-08-20T15:00:00.000Z',
        reason: 'fixture',
        grantedScope: ['implement'],
        maxWorkItems: 1,
        ...(over.grant ?? {}),
      },
      null,
      2,
    )}\n`,
  );
  let grantCommit = '';
  if (over.commitGrant !== false) {
    git('add', '--', grantRel);
    git('commit', '-q', '-m', 'authority: degraded grant');
    grantCommit = git('rev-parse', 'HEAD').trim();
  }

  const store =
    over.store === undefined
      ? {
          schemaVersion: '1.0.0',
          grantId: GRANT,
          unavailabilityId: OUTAGE,
          projectId: PROJECT,
          phaseId: PHASE,
          consumedAt: '2026-08-20T15:18:56.178Z',
          maxWorkItems: 1,
          workItems: [
            { workId: WORK, grantId: GRANT, phaseId: PHASE, summary: 'implement', at: '2026-08-20T15:18:56.178Z' },
          ],
          reconciliations: [],
        }
      : over.store;
  if (store !== null) {
    writeFileSync(
      join(root, ...(degradedStoreRelPath(GRANT) as string).split('/')),
      typeof store === 'string' ? store : `${JSON.stringify(store, null, 2)}\n`,
    );
  }

  return { root, sys: nodeLikeSystem(root), subject, grantCommit, git };
}

function fakeHttp(reply: HttpResponse): { http: HttpPort; sent: Array<{ headers: Record<string, string>; body: string }> } {
  const sent: Array<{ headers: Record<string, string>; body: string }> = [];
  return { sent, http: { post: (req) => (sent.push({ headers: { ...req.headers }, body: req.body }), reply) } };
}

/**
 * A reply that is internally consistent for the verdict it carries.
 *
 * `checkGatekeeperDecision` refuses a continuation verdict with no instruction and an owner-gated
 * verdict that claims no owner approval is needed, so a fixture that ignored either would prove the
 * wrong refusal — DECISION_REFUSED where the test means to exercise the verdict itself.
 */
const CONTINUES = ['APPROVED_TO_PROCEED', 'AMENDMENT_REQUIRED'];
const OWNER_GATED = ['APPROVED_TO_COMMIT', 'APPROVED_TO_PUSH', 'APPROVED_FOR_CLOSURE'];

function verdict(decision: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision,
    reason: 'the degraded work matches what the grant authorised',
    nextClaudeInstruction: CONTINUES.includes(decision)
      ? 'The debt is discharged; resume normal service at the next gate.'
      : null,
    allowedActions: ['implement'],
    forbiddenActions: [...OWNER_ONLY],
    ownerApprovalRequired: OWNER_GATED.includes(decision),
    risks: [],
    carryForward: [],
    ...over,
  };
}

function okReply(decision: Record<string, unknown>): HttpResponse {
  return {
    kind: 'response',
    status: 200,
    body: JSON.stringify({
      id: 'resp_reconcile_0001',
      created_at: '2026-08-20T16:00:05+01:00',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(decision) }] }],
      usage: { input_tokens: 4_000, input_tokens_details: { cached_tokens: 1_000 }, output_tokens: 300 },
    }),
  };
}

/** Deps bound to one world, because the thread binding names that world's checkout. */
function deps(root: string, over: Partial<ReconciliationDeps> = {}): ReconciliationDeps {
  return {
    transport: { model: 'gpt-5.6-terra', credentialRef: REF, transportId: 'openai-primary' },
    resolver: inMemoryResolverForTests(REF, SECRET),
    http: fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT))).http,
    rate: RATE,
    budget: BUDGET,
    ledger: [],
    threadBinding: { ...THREAD, repositoryRoot: root },
    repositoryRoot: root,
    decidedBy: 'ChatGPT',
    consumedDecisionIds: [],
    recordSpend: () => undefined,
    ...over,
  };
}

/** Deps that remember what was charged, for the tests that care that the call was paid for. */
function spendingDeps(root: string, over: Partial<ReconciliationDeps> = {}): {
  deps: ReconciliationDeps;
  charged: LedgerEntry[];
} {
  const charged: LedgerEntry[] = [];
  return { charged, deps: deps(root, { recordSpend: (e) => charged.push(e), ...over }) };
}

function input(over: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT,
    phaseId: PHASE,
    grantId: GRANT,
    workId: WORK,
    expectedDecider: 'ChatGPT',
    ownerOnlyActions: OWNER_ONLY,
    recordedOwner: OWNER,
    at: '2026-08-20T16:00:00.000Z',
    ...over,
  } as Parameters<typeof reconcileDegradedWork>[2];
}

describe('a debt that is not this one is never discharged', () => {
  it('refuses when the grant has no use record at all', () => {
    const w = world({ store: null });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(fake.sent).toEqual([]);
  });

  it('refuses an unreadable use record rather than reading it as "never used"', () => {
    const w = world({ store: '{ this is not json' });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(fake.sent).toEqual([]);
  });

  it('refuses a record belonging to another project', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input({ projectId: 'polygo' }), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain("not 'polygo'");
    expect(fake.sent).toEqual([]);
  });

  it('refuses a record belonging to another phase', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input({ phaseId: 'SOME-OTHER-PHASE1A' }), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(fake.sent).toEqual([]);
  });

  it('refuses a work id this grant never recorded', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input({ workId: 'GKWORK-deadbeefdeadbeef' }), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NOT_OUTSTANDING');
    expect(r.reasons.join(' ')).toContain('records no work item');
    expect(fake.sent).toEqual([]);
  });

  it('refuses work that is already reconciled, without asking again', () => {
    const w = world({
      store: {
        schemaVersion: '1.0.0',
        grantId: GRANT,
        unavailabilityId: OUTAGE,
        projectId: PROJECT,
        phaseId: PHASE,
        consumedAt: '2026-08-20T15:18:56.178Z',
        maxWorkItems: 1,
        workItems: [{ workId: WORK, grantId: GRANT, phaseId: PHASE, summary: 'implement', at: '2026-08-20T15:18:56.178Z' }],
        reconciliations: [
          { workId: WORK, decisionId: 'GKDEC-GKREQ-earlier', ask: RECONCILIATION_ASK, decisionAccepted: true },
        ],
      },
    });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NOT_OUTSTANDING');
    expect(r.reasons.join(' ')).toContain('already reconciled');
    expect(fake.sent).toEqual([]);
  });
});

describe('the question is bound to the bytes the owner approved', () => {
  it('asks about the authority commit\'s parent, not the outage id and not HEAD', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    const body = fake.sent[0]?.body ?? '';
    expect(body).toContain(w.subject);
    expect(body).not.toContain(`subject: ${OUTAGE}`);
    expect(w.subject).not.toBe(w.grantCommit);
  });

  it('refuses when the grant is not committed, so nothing bounds what may be reconciled', () => {
    const w = world({ commitGrant: false });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain('uncommitted grant is not an owner decision');
    expect(fake.sent).toEqual([]);
  });

  it('refuses when the authority commit carried anything besides the grant', () => {
    const w = world({ commitGrant: false });
    // The grant AND a source file in one commit: approving the baseline would also approve what rode
    // in with it, which is the smuggling case `authorityWrapper` exists to catch.
    writeFileSync(join(w.root, 'smuggled.ts'), 'export const x = 1;' + String.fromCharCode(10));
    // Scoped, so the untracked use record is not swept in too — that would refuse for a different reason.
    w.git('add', '--', degradedGrantRelPath(PHASE, GRANT) as string, 'smuggled.ts');
    w.git('commit', '-q', '-m', 'authority: grant (and a passenger)');
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUBJECT');
    expect(r.reasons.join(' ')).toContain('and nothing else');
    expect(fake.sent).toEqual([]);
  });

  it('still reviews the same baseline after history has moved on, because a review comes later', () => {
    const w = world();
    writeFileSync(join(w.root, 'unrelated.txt'), 'later work\n');
    // Only the unrelated file: `-A` would sweep the untracked use record into the commit too, and the
    // refusal under test would then be the committed-record one rather than the moved-history one.
    w.git('add', '--', 'unrelated.txt');
    w.git('commit', '-q', '-m', 'later');
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('RECONCILED');
    // The question is still about the grant's parent, not about the new HEAD.
    expect(fake.sent[0]?.body ?? '').toContain(w.subject);
    expect(w.git('rev-parse', 'HEAD').trim()).not.toBe(w.subject);
  });

  it('shows the reviewer the recorded work item and nothing the caller composed', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    const body = fake.sent[0]?.body ?? '';
    expect(body).toContain(WORK);
    expect(body).toContain(GRANT);
    expect(body).toContain(OUTAGE);
    expect(body).toContain(RECONCILIATION_ASK);
  });

  it('derives the same request after a restart, so the answer still fits the question', () => {
    const w = world();
    const a = fakeHttp(okReply(verdict('AWAITING_OWNER')));
    const b = fakeHttp(okReply(verdict('AWAITING_OWNER')));
    const first = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: a.http }));
    const second = reconcileDegradedWork(nodeLikeSystem(w.root), w.root, input(), deps(w.root, { http: b.http }));
    expect(first.requestId).toBe(second.requestId);
    expect(first.requestId).not.toBeNull();
  });
});

describe('nothing is paid for that could not be recorded', () => {
  it('refuses before calling when the use record is already committed', () => {
    const w = world();
    w.git('add', '--', degradedStoreRelPath(GRANT) as string);
    w.git('commit', '-q', '-m', 'evidence: degraded use record');
    const before = readFileSync(join(w.root, ...(degradedStoreRelPath(GRANT) as string).split('/')), 'utf8');
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));

    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));

    expect(r.kind).toBe('NOT_RECORDABLE');
    expect(fake.sent).toEqual([]);
    expect(r.ledgerEntry).toBeNull();
    expect(readFileSync(join(w.root, ...(degradedStoreRelPath(GRANT) as string).split('/')), 'utf8')).toBe(before);
    expect(w.git('status', '--porcelain').trim()).toBe('');
  });

  it('leaves the debt standing when the record cannot actually be written', () => {
    const w = world();
    const blind: System = { ...w.sys, writeText: () => undefined };
    const r = reconcileDegradedWork(blind, w.root, input(), deps(w.root));
    expect(r.kind).toBe('PERSIST_FAILED');
    expect(r.ledgerEntry).not.toBeNull();
    expect(r.outstandingAfter).toEqual([WORK]);
    expect(readDegradedStore(w.sys, w.root, GRANT)?.reconciliations).toEqual([]);
  });
});

describe('an unusable answer never clears anything', () => {
  it('reports the reviewer unreachable and spends nothing when the network fails', () => {
    const w = world();
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { http: fakeHttp({ kind: 'transport-error', detail: 'ECONNRESET' }).http }),
    );
    expect(r.kind).toBe('UNAVAILABLE');
    expect(r.ledgerEntry).toBeNull();
    expect(r.outstandingAfter).toEqual([WORK]);
  });

  it('refuses a reply that is not a structured decision', () => {
    const w = world();
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { http: fakeHttp({ kind: 'response', status: 200, body: 'not json at all' }).http }),
    );
    expect(r.kind).toBe('UNAVAILABLE');
    expect(readDegradedStore(w.sys, w.root, GRANT)?.reconciliations).toEqual([]);
  });

  it('never reaches the provider without a credential, and does not fall back', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { resolver: unprovisionedResolver('not provisioned in this fixture'), http: fake.http }));
    expect(r.kind).toBe('UNAVAILABLE');
    expect(fake.sent).toEqual([]);
  });

  it.each(['AMENDMENT_REQUIRED', 'AWAITING_OWNER', 'DO_NOT_PROCEED', 'APPROVED_TO_COMMIT'])(
    'leaves the debt standing on %s, having paid for the answer',
    (v) => {
      const w = world();
      const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fakeHttp(okReply(verdict(v))).http }));
      expect(r.kind).toBe('NOT_ACCEPTED');
      expect(r.verdict).toBe(v);
      expect(r.ledgerEntry?.costMicroUsd).toBeGreaterThan(0);
      expect(r.outstandingAfter).toEqual([WORK]);
      expect(readDegradedStore(w.sys, w.root, GRANT)?.reconciliations).toEqual([]);
    },
  );

  it('refuses a decision taken by someone other than the recorded gatekeeper', () => {
    const w = world();
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { decidedBy: 'Claude', http: fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT))).http }),
    );
    expect(r.kind).toBe('DECISION_REFUSED');
    expect(r.reasons.join(' ')).toContain("not the recorded gatekeeper 'ChatGPT'");
    expect(readDegradedStore(w.sys, w.root, GRANT)?.reconciliations).toEqual([]);
  });

  it('refuses a decision that grants itself an owner-only action', () => {
    const w = world();
    const reply = okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT, { allowedActions: ['implement', 'push'] }));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fakeHttp(reply).http }));
    expect(r.kind).toBe('DECISION_REFUSED');
    expect(r.ledgerEntry).not.toBeNull();
    expect(readDegradedStore(w.sys, w.root, GRANT)?.reconciliations).toEqual([]);
  });

  it('refuses a decision id that has already been acted on', () => {
    const w = world();
    const probe = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { http: fakeHttp(okReply(verdict('AWAITING_OWNER'))).http }),
    );
    const already = String(probe.decisionId);
    // The SAME repository: a different one would derive a different request, and so a different
    // decision id, and the replay guard would never be the thing under test.
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const { deps: d, charged } = spendingDeps(w.root, { consumedDecisionIds: [already], http: fake.http });
    const r = reconcileDegradedWork(w.sys, w.root, input(), d);

    expect(r.kind).toBe('ALREADY_ASKED');
    // The point of asking first: the old order paid for the call and THEN refused the answer as a
    // replay, so an operator could burn budget indefinitely on a question already answered.
    expect(fake.sent).toEqual([]);
    expect(charged).toEqual([]);
    expect(r.reasons.join(' ')).toContain('already been put to the gatekeeper');
  });
});

describe('the one path that does discharge a debt', () => {
  it('records the accepted decision, clears the item, and unblocks the gate', () => {
    const w = world();
    const before = readDegradedStore(w.sys, w.root, GRANT);
    expect(gateBlockedByReconciliation(reconciliationState(before?.workItems ?? [], []))).not.toEqual([]);

    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root));

    expect(r.kind).toBe('RECONCILED');
    expect(r.verdict).toBe(RECONCILIATION_ACCEPTED_VERDICT);
    expect(r.outstandingAfter).toEqual([]);
    expect(r.ledgerEntry?.costMicroUsd).toBeGreaterThan(0);

    const after = readDegradedStore(w.sys, w.root, GRANT);
    expect(after?.reconciliations).toEqual([
      { workId: WORK, decisionId: r.decisionId, ask: RECONCILIATION_ASK, decisionAccepted: true },
    ]);
    expect(after?.workItems).toEqual(before?.workItems);
    expect(after?.consumedAt).toBe(before?.consumedAt);
    expect(
      gateBlockedByReconciliation(reconciliationState(after?.workItems ?? [], after?.reconciliations ?? [])),
    ).toEqual([]);
  });

  it('cannot be spent twice: the second attempt asks nothing and changes nothing', () => {
    const w = world();
    reconcileDegradedWork(w.sys, w.root, input(), deps(w.root));
    const afterFirst = readFileSync(join(w.root, ...(degradedStoreRelPath(GRANT) as string).split('/')), 'utf8');

    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const second = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));

    expect(second.kind).toBe('NOT_OUTSTANDING');
    expect(fake.sent).toEqual([]);
    expect(second.ledgerEntry).toBeNull();
    expect(readFileSync(join(w.root, ...(degradedStoreRelPath(GRANT) as string).split('/')), 'utf8')).toBe(afterFirst);
  });

  it('does not grant the work any authority it did not already have', () => {
    const w = world();
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root));
    const stored = readDegradedStore(w.sys, w.root, GRANT);
    expect(r.kind).toBe('RECONCILED');
    // A reconciliation reviews history; it never extends the grant or adds work to it.
    expect(stored?.maxWorkItems).toBe(1);
    expect(stored?.workItems).toHaveLength(1);
  });
});

describe('the credential boundary', () => {
  it('sends the key in a header and never puts it in an outcome', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(fake.sent[0]?.headers['Authorization']).toContain(SECRET);
    expect(fake.sent[0]?.body).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain('sk-test');
    expect(readFileSync(join(w.root, ...(degradedStoreRelPath(GRANT) as string).split('/')), 'utf8')).not.toContain('sk-test');
  });
});

describe('what the owner granted is what may be reconciled', () => {
  it('refuses a use record listing more work than the owner authorised', () => {
    const w = world({
      store: {
        schemaVersion: '1.0.0',
        grantId: GRANT,
        unavailabilityId: OUTAGE,
        projectId: PROJECT,
        phaseId: PHASE,
        consumedAt: '2026-08-20T15:18:56.178Z',
        maxWorkItems: 2,
        workItems: [
          { workId: WORK, grantId: GRANT, phaseId: PHASE, summary: 'implement', at: '2026-08-20T15:18:56.178Z' },
          {
            workId: 'GKWORK-invented00000001',
            grantId: GRANT,
            phaseId: PHASE,
            summary: 'invented',
            at: '2026-08-20T15:19:00.000Z',
          },
        ],
        reconciliations: [],
      },
    });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain('bounded at 1');
    expect(fake.sent).toEqual([]);
  });

  it('refuses a use record answering a different outage than the grant was given for', () => {
    const w = world({ grant: { unavailabilityId: 'GKOUT-000000000000000000000000' } });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain('risk accepted for one outage is not risk accepted for another');
    expect(fake.sent).toEqual([]);
  });

  it('refuses a grant granted by someone other than the recorded owner', () => {
    const w = world({ grant: { grantedBy: 'Claude' } });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain('not the recorded owner');
    expect(fake.sent).toEqual([]);
  });

  it('refuses a use record whose inner grant id disagrees with the file it lives in', () => {
    const w = world({
      store: {
        schemaVersion: '1.0.0',
        grantId: 'SOME-OTHER-GRANT1A',
        unavailabilityId: OUTAGE,
        projectId: PROJECT,
        phaseId: PHASE,
        consumedAt: '2026-08-20T15:18:56.178Z',
        maxWorkItems: 1,
        workItems: [
          { workId: WORK, grantId: GRANT, phaseId: PHASE, summary: 'implement', at: '2026-08-20T15:18:56.178Z' },
        ],
        reconciliations: [],
      },
    });
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain("names grant 'SOME-OTHER-GRANT1A'");
    expect(fake.sent).toEqual([]);
  });

  it('refuses an unsafe grant id without touching the network', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input({ grantId: '../../escape' }),
      deps(w.root, { http: fake.http }),
    );
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(fake.sent).toEqual([]);
  });

  it('refuses a record that was committed and then edited in the working tree', () => {
    const w = world();
    const rel = degradedStoreRelPath(GRANT) as string;
    w.git('add', '--', rel);
    w.git('commit', '-q', '-m', 'evidence: use record');
    writeFileSync(join(w.root, ...rel.split('/')), JSON.stringify({ grantId: GRANT, consumedAt: 'edited' }));
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http }));
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain('that is not evidence there is none');
    expect(fake.sent).toEqual([]);
  });
});

describe('one item of several', () => {
  const TWO = {
    schemaVersion: '1.0.0',
    grantId: GRANT,
    unavailabilityId: OUTAGE,
    projectId: PROJECT,
    phaseId: PHASE,
    consumedAt: '2026-08-20T15:18:56.178Z',
    maxWorkItems: 2,
    workItems: [
      { workId: WORK, grantId: GRANT, phaseId: PHASE, summary: 'first', at: '2026-08-20T15:18:56.178Z' },
      {
        workId: 'GKWORK-secondsecond0002',
        grantId: GRANT,
        phaseId: PHASE,
        summary: 'second',
        at: '2026-08-20T15:19:00.000Z',
      },
    ],
    reconciliations: [],
  };

  it('clears the named item and leaves the other one owing', () => {
    const w = world({ store: TWO, grant: { maxWorkItems: 2 } });
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root));

    expect(r.kind).toBe('RECONCILED');
    expect(r.outstandingAfter).toEqual(['GKWORK-secondsecond0002']);
    const after = readDegradedStore(w.sys, w.root, GRANT);
    expect(after?.workItems).toHaveLength(2);
    expect(after?.reconciliations.map((x) => x.workId)).toEqual([WORK]);
    expect(
      gateBlockedByReconciliation(reconciliationState(after?.workItems ?? [], after?.reconciliations ?? [])),
    ).not.toEqual([]);
  });

  it('keeps the earlier reconciliation when the second is recorded', () => {
    const w = world({ store: TWO, grant: { maxWorkItems: 2 } });
    reconcileDegradedWork(w.sys, w.root, input(), deps(w.root));
    const second = reconcileDegradedWork(
      w.sys,
      w.root,
      input({ workId: 'GKWORK-secondsecond0002' }),
      deps(w.root),
    );

    expect(second.kind).toBe('RECONCILED');
    expect(second.outstandingAfter).toEqual([]);
    const after = readDegradedStore(w.sys, w.root, GRANT);
    expect(after?.reconciliations.map((x) => x.workId)).toEqual([WORK, 'GKWORK-secondsecond0002']);
  });

  it('does not lose a work item that appeared while the reviewer was thinking', () => {
    const w = world();
    const rel = degradedStoreRelPath(GRANT) as string;
    const storePath = join(w.root, ...rel.split('/'));
    // The provider "takes a while", and a degraded run appends a second item in that window.
    const racingHttp: HttpPort = {
      post: () => {
        const now = JSON.parse(readFileSync(storePath, 'utf8')) as Record<string, unknown>;
        (now['workItems'] as unknown[]).push({
          workId: 'GKWORK-appearedlater01',
          grantId: GRANT,
          phaseId: PHASE,
          summary: 'later',
          at: '2026-08-20T16:00:01.000Z',
        });
        writeFileSync(storePath, JSON.stringify({ ...now, maxWorkItems: 2 }, null, 2));
        return okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT));
      },
    };

    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: racingHttp }));

    expect(r.kind).toBe('RECONCILED');
    const after = readDegradedStore(w.sys, w.root, GRANT);
    // The pre-call snapshot knew one item. Writing it back would have deleted the second — and with it
    // the record that unreviewed work had happened.
    expect(after?.workItems.map((x) => x.workId)).toEqual([WORK, 'GKWORK-appearedlater01']);
    expect(after?.reconciliations.map((x) => x.workId)).toEqual([WORK]);
  });
});

describe('what it costs and what it never does', () => {
  it('refuses before calling when the month is already at the hard stop', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const spent = [
      {
        schemaVersion: '1.0.0',
        requestId: 'GKREQ-earlier',
        projectId: PROJECT,
        phaseId: PHASE,
        at: '2026-08-02T10:00:00.000Z',
        model: RATE.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
        costMicroUsd: 5_000_000,
      },
    ] as unknown as readonly LedgerEntry[];
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fake.http, ledger: spent }));
    expect(r.kind).toBe('SPEND_REFUSED');
    expect(fake.sent).toEqual([]);
  });

  it('refuses before calling when the thread belongs to another checkout', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { http: fake.http, threadBinding: { ...THREAD, repositoryRoot: 'C:/somewhere/else' } }),
    );
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain('different checkout is a different world');
    expect(fake.sent).toEqual([]);
  });

  it('checks everything and asks nothing when only preparing', () => {
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const { deps: d, charged } = spendingDeps(w.root, { http: fake.http });
    const r = reconcileDegradedWork(w.sys, w.root, input({ prepareOnly: true }), d);

    expect(r.kind).toBe('PREPARED');
    expect(r.requestId).not.toBeNull();
    expect(fake.sent).toEqual([]);
    expect(charged).toEqual([]);
    expect(readDegradedStore(w.sys, w.root, GRANT)?.reconciliations).toEqual([]);
  });

  it('records the spend the moment the call returns, before anything durable is written', () => {
    const w = world();
    const { deps: d, charged } = spendingDeps(w.root, {
      http: fakeHttp(okReply(verdict('DO_NOT_PROCEED'))).http,
    });
    const r = reconcileDegradedWork(w.sys, w.root, input(), d);

    expect(r.kind).toBe('NOT_ACCEPTED');
    expect(charged).toHaveLength(1);
    expect(charged[0]?.costMicroUsd).toBeGreaterThan(0);
  });

  it('says a call may have been billed when the provider answered unusably', () => {
    const w = world();
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { http: fakeHttp({ kind: 'response', status: 200, body: 'not json at all' }).http }),
    );
    expect(r.kind).toBe('UNAVAILABLE');
    // A 200 was delivered. Claiming "nothing was spent" here would be a comfortable untruth.
    expect(r.definitelyNotSent).toBe(false);
  });

  it('knows nothing was sent when the credential never resolved', () => {
    const w = world();
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { resolver: unprovisionedResolver('not provisioned in this fixture') }),
    );
    expect(r.kind).toBe('UNAVAILABLE');
    expect(r.definitelyNotSent).toBe(true);
  });

  it('commits nothing, and touches only the use record', () => {
    const w = world();
    const head = w.git('rev-parse', 'HEAD').trim();
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root));

    expect(r.kind).toBe('RECONCILED');
    expect(w.git('rev-parse', 'HEAD').trim()).toBe(head);
    const dirty = w
      .git('status', '--porcelain', '--untracked-files=all')
      .trim()
      .split(String.fromCharCode(10))
      .filter((l) => l !== '');
    expect(dirty).toEqual([`?? ${degradedStoreRelPath(GRANT) as string}`]);
  });

  it('leaves no temporary file behind', () => {
    const w = world();
    reconcileDegradedWork(w.sys, w.root, input(), deps(w.root));
    const tmp = `${degradedStoreRelPath(GRANT) as string}.tmp`;
    expect(existsSync(join(w.root, ...tmp.split('/')))).toBe(false);
  });
});

describe('the guards the first mutation run found unpinned', () => {
  it('names the RECORD as the thing bound to the wrong phase, not the grant', () => {
    // The wrong-phase test used to assert only the outcome kind, and the grant check produces the
    // same kind — so deleting the record's own phase binding changed nothing any test could see.
    const w = world();
    const fake = fakeHttp(okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT)));
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input({ phaseId: 'SOME-OTHER-PHASE1A' }),
      deps(w.root, { http: fake.http }),
    );
    expect(r.kind).toBe('NO_SUCH_GRANT');
    expect(r.reasons.join(' ')).toContain(`the use record is for phase '${PHASE}', not 'SOME-OTHER-PHASE1A'`);
    expect(fake.sent).toEqual([]);
  });

  it('does not write over a record the owner committed WHILE the reviewer was thinking', () => {
    const w = world();
    const rel = degradedStoreRelPath(GRANT) as string;
    // The owner commits the use record during the call — the window the pre-call check cannot cover.
    const committingHttp: HttpPort = {
      post: () => {
        w.git('add', '--', rel);
        w.git('commit', '-q', '-m', 'evidence: use record, committed mid-call');
        return okReply(verdict(RECONCILIATION_ACCEPTED_VERDICT));
      },
    };
    const { deps: d, charged } = spendingDeps(w.root, { http: committingHttp });

    const r = reconcileDegradedWork(w.sys, w.root, input(), d);

    expect(r.kind).toBe('PERSIST_FAILED');
    // The call happened, so it is paid for; the debt stands.
    expect(charged).toHaveLength(1);
    expect(r.outstandingAfter).toEqual([WORK]);
    // AND THE RECORD IS INTACT. Writing anyway would leave the tree at odds with the committed
    // evidence, which every later read treats as tampering — taking the debt with it.
    expect(w.git('status', '--porcelain', '--untracked-files=all', '--', rel).trim()).toBe('');
    const after = readDegradedStore(w.sys, w.root, GRANT);
    expect(after).not.toBeNull();
    expect(after?.reconciliations).toEqual([]);
  });

  it('catches a write that lands but loses what it was supposed to record', () => {
    // The blind-write test no longer reaches the read-back: a missing temporary file fails the rename
    // first. This one writes successfully and drops the reconciliation, which only the read-back sees.
    const w = world();
    const lossy: System = {
      ...w.sys,
      writeText: (p: string, c: string) => {
        const parsed = JSON.parse(c) as Record<string, unknown>;
        w.sys.writeText(p, JSON.stringify({ ...parsed, reconciliations: [] }, null, 2));
      },
    };

    const r = reconcileDegradedWork(lossy, w.root, input(), deps(w.root));

    expect(r.kind).toBe('PERSIST_FAILED');
    expect(r.reasons.join(' ')).toContain('absent from the record after writing');
    expect(readDegradedStore(w.sys, w.root, GRANT)?.reconciliations).toEqual([]);
  });
});

describe("the reviewer's own words reach the owner", () => {
  it('reports the reason and the instruction when the verdict leaves the debt standing', () => {
    // THE FIRST REAL CALL RETURNED AMENDMENT_REQUIRED AND SAID WHY, and the owner saw only the verdict.
    // A refusal the owner cannot read is a refusal the owner cannot answer.
    const w = world();
    const reply = okReply(
      verdict('AMENDMENT_REQUIRED', {
        reason: 'the work item summary does not say which validator was failing',
        nextClaudeInstruction: 'Record the failing check in the work item, then ask again.',
      }),
    );
    const r = reconcileDegradedWork(w.sys, w.root, input(), deps(w.root, { http: fakeHttp(reply).http }));

    expect(r.kind).toBe('NOT_ACCEPTED');
    expect(r.reviewerReason).toBe('the work item summary does not say which validator was failing');
    expect(r.reviewerInstruction).toBe('Record the failing check in the work item, then ask again.');
  });

  it('carries no reviewer words when there was no reviewer', () => {
    const w = world();
    const r = reconcileDegradedWork(
      w.sys,
      w.root,
      input(),
      deps(w.root, { http: fakeHttp({ kind: 'transport-error', detail: 'ECONNRESET' }).http }),
    );
    expect(r.kind).toBe('UNAVAILABLE');
    expect(r.reviewerReason).toBeNull();
    expect(r.reviewerInstruction).toBeNull();
  });
});
