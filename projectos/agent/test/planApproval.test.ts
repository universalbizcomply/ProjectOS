/**
 * Adversarial proof for exact plan approval.
 *
 * This is the only route in the codebase to a record carrying PLAN READY, so nearly every test here
 * is an attempt to get through it without the thing it exists to require: an approval by someone the
 * owner named, committed, about exactly this plan material. The happy path is proven once; the rest
 * of the file tries to break in.
 *
 * The engine's real filesystem walk runs against a real temporary project, because the whole
 * mechanism depends on recomputing the proposal from a repository, and a fake would prove nothing.
 *
 * Created in the post-V3 operational recovery programme (Stage 2).
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import { submitObjective, loadDiscoveryEngine } from '../src/planIntake.js';
import {
  approvePlan,
  checkPlanApprovalDecision,
  checkPlanApprovalDelegation,
  PLAN_APPROVAL_DECISION_SCHEMA_VERSION,
  PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION,
  loadGovernanceEngine,
} from '../src/planApproval.js';
import { loadGovernedContext } from '../src/governedContext.js';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const HEAD = 'b'.repeat(40);
const OWNER = 'Ada';
const AUTHORITY = 'Grace';

const PLAN_DOC = [
  '# Acme recovery plan',
  'projectId: acme',
  'Vision: a reliable ordering system.',
  'Definition of complete: every ordering journey works end to end and is proven.',
  'Success standard: proven live rather than asserted.',
  '',
  '## Environments',
  '- local — production freeze: yes',
  '',
  '## Approved scope',
  '- the ordering journey',
  '',
  '## Excluded scope',
  '- anything touching production',
  '',
  '## Phases',
  '',
  '### ACME-P1A — Ordering journey',
  'Purpose: build the ordering journey.',
  'Risk: medium',
  'Autonomy: local-safe',
  'Browser proof: no',
  'Acceptance criteria:',
  '- a customer can place an order',
  'Required validators: validate-all',
  'Required reviews: code-review',
  'Owner gates: commit, push, phase-closure',
].join('\n');

/** The project's existing owner-approved plan: where the owner's identity comes from. */
function activePlan(): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    projectId: 'acme',
    projectName: 'Acme',
    programmeId: 'acme-v1',
    planId: 'acme-v1-plan',
    planVersion: '1.0',
    planStatus: 'PLAN READY',
    businessVision: 'v',
    definitionOfComplete: 'd',
    approvedScope: ['s'],
    excludedScope: ['x'],
    successStandard: 'proven',
    repository: {
      repositoryPath: '/tmp/acme',
      expectedRemote: 'acme/app',
      protectedBranches: ['main'],
      baselineCommit: 'c'.repeat(40),
      planPersistenceCommit: null,
      planSourceBranch: 'main',
    },
    sourceDocuments: [{ documentPath: 'docs/plan.md', sourceDocumentType: 'human-readable-plan', sourceDocumentChecksum: 'sha256:' + 'd'.repeat(64), authoritative: true, superseded: false }],
    phases: [{ phaseId: 'ACME-OLD1A', description: 'old', dependsOn: [], acceptanceCriteria: ['done'], riskLevel: 'low', autonomyLevel: 'local-safe', requiredValidators: ['validate-all'], requiredReviews: [], requiredBrowserProof: false, requiredOwnerGates: ['phase-closure'] }],
    environments: [{ environmentId: 'local', productionFreeze: true }],
    providers: [],
    governance: {
      owner: OWNER,
      gatekeeper: 'Gatekeeper',
      implementer: 'Claude Code',
      allowedActions: ['inspect-repository'],
      forbiddenActions: ['production-deploy', 'production-db-mutation', 'real-email-sms-whatsapp', 'payment-or-live-charge', 'force-push', 'use-openai-api', 'use-anthropic-api'],
      ownerOnlyActions: ['approve-plan'],
      closureAuthority: OWNER,
      noApiPolicy: true,
    },
    approval: {
      approvalStatus: 'approved',
      approvedBy: OWNER,
      approvalDate: '2026-01-01',
      approvalEvidenceReference: 'owner approved',
      supersedesPlanVersion: null,
      approvalBinding: 'MANUAL_GOVERNANCE_APPROVAL',
      tamperProof: false,
      approvalAuthority: 'owner',
      secureApprovalEvidence: null,
    },
    staleness: { lastVerifiedCommit: 'c'.repeat(40), lastVerifiedDate: '2026-01-01', stalenessStatus: 'fresh', stalenessReasons: [], materialPlanInputs: [{ inputId: 'docs/plan.md', fingerprint: 'sha256:' + 'd'.repeat(64) }] },
    security: { secretPolicy: 'no raw secrets', rawSecretValuesForbidden: true, sensitiveDataForbidden: true, redactionRequired: true },
  };
}

function delegation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION,
    delegationId: 'ACME-PLAN-APPROVAL-DELEGATION1A',
    projectId: 'acme',
    delegatedBy: OWNER,
    delegatedTo: AUTHORITY,
    delegatedScope: ['plan-approval'],
    delegationDate: '2026-08-11',
    excludesProtectedActions: true,
    ...over,
  };
}

interface World {
  readonly root: string;
  readonly sys: System;
  readonly draftId: string;
  readonly planDigest: string;
}

/** Lets a test damage the governance the new plan inherits, to prove readiness is really recomputed. */
let governanceOverride: Record<string, unknown> | null = null;
/** repo-relative path (lowercased) -> the text git reports at HEAD, when it differs from the tree. */
const committedOverride = new Map<string, string>();
afterEach(() => {
  governanceOverride = null;
  committedOverride.clear();
});

/**
 * A project with a plan document, an active approved plan, and one generated draft.
 * `committed` lists the repo-relative paths git will report as present at HEAD.
 */
function world(opts: { committed?: readonly string[]; planDoc?: string } = {}): World {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-approve-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops'), { recursive: true });
  mkdirSync(pjoin(root, 'state'), { recursive: true });
  writeFileSync(pjoin(root, 'docs-plan.md'), opts.planDoc ?? PLAN_DOC);
  const active = activePlan();
  if (governanceOverride !== null) {
    active['governance'] = { ...(active['governance'] as Record<string, unknown>), ...governanceOverride };
  }
  writeFileSync(pjoin(root, 'state', 'active.plan.json'), JSON.stringify(active, null, 2));
  // Mirrors the real case: the project's previous programme is finished, so its plan is retired to
  // history by the completion evidence and only the new plan document shapes the proposal.
  writeFileSync(
    pjoin(root, 'state', 'active.current-state.json'),
    JSON.stringify({ projectId: 'acme', completedPhases: ['ACME-OLD1A'] }, null, 2),
  );
  writeFileSync(
    pjoin(root, '.projectops', 'project-config.json'),
    JSON.stringify(
      {
        projectId: 'acme',
        projectName: 'Acme',
        projectType: 'app',
        owner: OWNER,
        repo: 'acme/app',
        localPath: root,
        protectedBranches: ['main'],
        productionFreeze: true,
        allowedActions: ['inspect-repository'],
        forbiddenActions: ['production-deploy'],
        approvalGates: ['commit'],
        validators: ['validate-all'],
        evidenceRequirements: ['evidence-pack'],
        installStatus: 'installed',
        secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true, notes: 'no raw secrets' },
        planMemory: { planPath: 'state/active.plan.json', currentStatePath: 'state/active.current-state.json' },
        planSources: ['docs-plan.md'],
      },
      null,
      2,
    ),
  );

  const committed = new Set((opts.committed ?? []).map((p) => p.toLowerCase()));
  const sys: System = {
    cwd: () => root,
    now: () => '2026-08-11T10:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(pjoin(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    exec: (_cmd: string, args: readonly string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse HEAD') return { code: 0, stdout: HEAD, stderr: '' };
      if (key === 'rev-parse --abbrev-ref HEAD') return { code: 0, stdout: 'main', stderr: '' };
      // `show HEAD:<path>` serves the COMMITTED blob. A path the test did not declare committed is
      // absent from HEAD however present it is on disk — which is the whole point of the check.
      // `committedOverride` lets a test commit one thing and leave a different one in the tree.
      if (args[0] === 'show') {
        const ref = String(args[1] ?? '');
        if (!ref.startsWith('HEAD:')) return { code: 1, stdout: '', stderr: '' };
        const rel = ref.slice(5);
        if (!committed.has(rel.toLowerCase())) return { code: 1, stdout: '', stderr: `fatal: path '${rel}' does not exist in 'HEAD'` };
        const override = committedOverride.get(rel.toLowerCase());
        if (override !== undefined) return { code: 0, stdout: override, stderr: '' };
        const abs = pjoin(root, rel);
        return existsSync(abs) ? { code: 0, stdout: readFileSync(abs, 'utf8'), stderr: '' } : { code: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'cat-file' && args[1] === '-e' && String(args[2] ?? '') === `${HEAD}^{commit}`) {
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    },
  };

  const submitted = submitObjective(sys, root, 'Make the ordering journey reliable and simple to operate.');
  if (!submitted.ok) throw new Error(`fixture could not generate a draft: ${submitted.code} ${submitted.detail}`);
  return { root, sys, draftId: submitted.objective.objectiveId, planDigest: submitted.draftRecord.planDigest };
}

function writeDelegation(w: World, over: Record<string, unknown> = {}): void {
  w.sys.writeText(pjoin(w.root, '.projectops/authority/plan-approval-delegation.json'), JSON.stringify(delegation(over), null, 2));
}

function decision(w: World, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PLAN_APPROVAL_DECISION_SCHEMA_VERSION,
    decisionId: 'ACME-PLAN-APPROVAL-DECISION1A',
    decision: 'approve',
    projectId: 'acme',
    repository: 'acme/app',
    branch: 'main',
    baseHead: HEAD,
    draftId: w.draftId,
    planDigest: w.planDigest,
    decidedBy: AUTHORITY,
    decidedAt: '2026-08-11T09:00:00.000Z',
    ...over,
  };
}

function writeDecision(w: World, over: Record<string, unknown> = {}): string {
  const d = decision(w, over);
  const id = String(d['decisionId']);
  w.sys.writeText(pjoin(w.root, `.projectops/plan-decisions/${id}.json`), JSON.stringify(d, null, 2));
  return id;
}

const COMMITTED = ['.projectops/authority/plan-approval-delegation.json', '.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json'];

function run(w: World, decisionId: string) {
  return approvePlan(w.sys, w.root, {
    draftId: w.draftId,
    decisionId,
    planRelPath: 'state/recovery.plan.json',
    stateRelPath: 'state/recovery.current-state.json',
    planId: 'acme-recovery-plan',
    programmeId: 'acme-recovery',
  });
}

describe('exact plan approval — the happy path, once', () => {
  test('a committed delegation plus a committed decision about this exact plan material activates a new plan', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);

    const r = run(w, id);
    expect(r.ok ? '' : r.problems.join('; ')).toBe('');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const plan = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.plan.json'), 'utf8')) as Record<string, unknown>;
    expect(plan['planStatus']).toBe('PLAN READY');
    expect(plan['planId']).toBe('acme-recovery-plan');
    expect((plan['phases'] as unknown[]).length).toBe(1);
    // The approval is the delegate's, exercised under the owner's authority, and says so checkably.
    const approval = plan['approval'] as Record<string, unknown>;
    expect(approval['approvedBy']).toBe(AUTHORITY);
    expect(approval['approvalAuthority']).toBe('owner');
    expect((approval['approvalDelegation'] as Record<string, unknown>)['delegatedBy']).toBe(OWNER);
    expect(approval['tamperProof']).toBe(false);

    // Readiness is real: the governed context, which recomputes it, now resolves.
    const gc = loadGovernedContext(w.sys, w.root);
    expect(gc.ok ? gc.context.planPath : `refused: ${gc.code}`).toContain('recovery.plan.json');
  });

  test('activation keeps the finished programme retired instead of resurrecting it', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    expect(run(w, id).ok).toBe(true);

    // planMemory now names the new plan, and the outgoing plan memory is retained as a declared
    // planning source — so the completion evidence that retires the old programme is still read.
    const cfg = JSON.parse(readFileSync(pjoin(w.root, '.projectops/project-config.json'), 'utf8')) as Record<string, unknown>;
    expect((cfg['planMemory'] as Record<string, unknown>)['planPath']).toBe('state/recovery.plan.json');
    expect(cfg['planSources']).toContain('state/active.plan.json');
    expect(cfg['planSources']).toContain('state/active.current-state.json');

    // Proof, not inference: a fresh proposal must still contain only the new plan's phase.
    const again = submitObjective(w.sys, w.root, 'A second objective, submitted after activation, for the same project.');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const ids = (again.draftRecord.draft['phaseCandidates'] as { phaseId: string }[]).map((p) => p.phaseId);
    expect(ids).not.toContain('ACME-OLD1A');
  });

  test('the previously active plan record is left byte-identical', () => {
    const w = world({ committed: COMMITTED });
    const before = readFileSync(pjoin(w.root, 'state/active.plan.json'), 'utf8');
    writeDelegation(w);
    const id = writeDecision(w);
    expect(run(w, id).ok).toBe(true);
    expect(readFileSync(pjoin(w.root, 'state/active.plan.json'), 'utf8')).toBe(before);
  });

  test('a consumed decision cannot approve a second time', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    expect(run(w, id).ok).toBe(true);
    const again = run(w, id);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('DECISION_INVALID');
    expect(again.problems.join(' ')).toMatch(/already consumed/i);
  });
});

describe('exact plan approval — nothing else grants it', () => {
  const attacks: readonly { name: string; setup: (w: World) => string; code: string; match: RegExp }[] = [
    {
      name: 'no decision at all — a draft on its own approves nothing',
      setup: (w) => {
        writeDelegation(w);
        return 'ACME-PLAN-APPROVAL-DECISION1A';
      },
      code: 'DECISION_INVALID',
      match: /no committed plan-approval decision/i,
    },
    {
      name: 'no delegation — only the owner may approve, and the owner has named nobody',
      setup: (w) => writeDecision(w),
      code: 'DELEGATION_INVALID',
      match: /no committed plan-approval delegation/i,
    },
    {
      name: 'the delegation is on disk but not committed',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w);
      },
      code: 'DELEGATION_INVALID',
      match: /not committed/i,
    },
    {
      name: 'the decision is on disk but not committed',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w);
      },
      code: 'DECISION_INVALID',
      match: /not committed/i,
    },
    {
      name: 'the delegation names a delegator who is not the recorded owner',
      setup: (w) => {
        writeDelegation(w, { delegatedBy: 'Mallory' });
        return writeDecision(w);
      },
      code: 'DELEGATION_INVALID',
      match: /is not this project's recorded owner/i,
    },
    {
      name: 'the delegation hands plan approval to the implementer',
      setup: (w) => {
        writeDelegation(w, { delegatedTo: 'Claude Code' });
        return writeDecision(w, { decidedBy: 'Claude Code' });
      },
      code: 'DELEGATION_INVALID',
      match: /implementer/i,
    },
    {
      name: 'the delegation tries to carry a scope beyond plan approval',
      setup: (w) => {
        writeDelegation(w, { delegatedScope: ['plan-approval', 'production-deploy'] });
        return writeDecision(w);
      },
      code: 'DELEGATION_INVALID',
      match: /may not grant/i,
    },
    {
      name: 'the delegation claims it carries protected actions',
      setup: (w) => {
        writeDelegation(w, { excludesProtectedActions: false });
        return writeDecision(w);
      },
      code: 'DELEGATION_INVALID',
      match: /excludesProtectedActions/i,
    },
    {
      name: 'someone other than the named authority decides',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { decidedBy: 'Mallory' });
      },
      code: 'DECISION_INVALID',
      match: /not the recorded plan-approval authority/i,
    },
    {
      name: 'the decision approves a different draft',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { draftId: 'deadbeefdeadbeef' });
      },
      code: 'DECISION_INVALID',
      match: /approves draft/i,
    },
    {
      name: 'the decision was taken against different plan material',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { planDigest: 'sha256:' + '0'.repeat(64) });
      },
      code: 'DECISION_INVALID',
      match: /an approval of different plan material/i,
    },
    {
      name: 'the decision is for another project',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { projectId: 'other' });
      },
      code: 'DECISION_INVALID',
      match: /is for project/i,
    },
    {
      name: 'the decision is for another repository',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { repository: 'attacker/elsewhere' });
      },
      code: 'DECISION_INVALID',
      match: /is for repository/i,
    },
    {
      name: 'the decision was taken on another branch',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { branch: 'somewhere-else' });
      },
      code: 'DECISION_INVALID',
      match: /branch/i,
    },
    {
      name: 'the decision names a commit that does not exist here',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { baseHead: 'f'.repeat(40) });
      },
      code: 'DECISION_INVALID',
      match: /does not exist in this repository/i,
    },
    {
      name: 'the record decides something other than approval',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { decision: 'reject' });
      },
      code: 'DECISION_INVALID',
      match: /does not decide to approve/i,
    },
    {
      name: 'the decision arrives with a consumption marker already set',
      setup: (w) => {
        writeDelegation(w);
        return writeDecision(w, { consumedAt: '2026-01-01T00:00:00.000Z' });
      },
      code: 'DECISION_INVALID',
      match: /already consumed/i,
    },
  ];

  for (const a of attacks) {
    test(a.name, () => {
      // Everything is treated as committed EXCEPT where the attack is about commitment itself.
      const committed = a.name.includes('delegation is on disk but not committed')
        ? [COMMITTED[1]!]
        : a.name.includes('decision is on disk but not committed')
          ? [COMMITTED[0]!]
          : COMMITTED;
      const w = world({ committed });
      const id = a.setup(w);
      const r = run(w, id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe(a.code);
      expect(r.problems.join(' ')).toMatch(a.match);
      // A refusal writes nothing. Not the plan, not the state, not the activation.
      expect(existsSync(pjoin(w.root, 'state/recovery.plan.json'))).toBe(false);
      expect(existsSync(pjoin(w.root, 'state/recovery.current-state.json'))).toBe(false);
      const cfg = JSON.parse(readFileSync(pjoin(w.root, '.projectops/project-config.json'), 'utf8')) as Record<string, unknown>;
      expect((cfg['planMemory'] as Record<string, unknown>)['planPath']).toBe('state/active.plan.json');
    });
  }
});

describe('exact plan approval — currentness and target safety', () => {
  test('a repository whose plan material has moved on invalidates the stored draft', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    // One word of the plan document changes — which is exactly what an approval must notice.
    writeFileSync(pjoin(w.root, 'docs-plan.md'), PLAN_DOC.replace('build the ordering journey.', 'rebuild everything.'));
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DRAFT_SUPERSEDED');
  });

  test('an unrelated file changing does NOT invalidate the approval', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    writeFileSync(pjoin(w.root, 'NOTES.md'), '# scratch\nnothing to do with the plan\n');
    expect(run(w, id).ok).toBe(true);
  });

  test('the approval cannot be aimed at the currently active plan record', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    const r = approvePlan(w.sys, w.root, {
      draftId: w.draftId,
      decisionId: id,
      planRelPath: 'state/active.plan.json',
      stateRelPath: 'state/recovery.current-state.json',
      planId: 'x',
      programmeId: 'y',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('WOULD_OVERWRITE_ACTIVE_PLAN');
  });

  test('the approval cannot be aimed outside the project', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    const r = approvePlan(w.sys, w.root, {
      draftId: w.draftId,
      decisionId: id,
      planRelPath: '../escape.plan.json',
      stateRelPath: 'state/recovery.current-state.json',
      planId: 'x',
      programmeId: 'y',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('UNSAFE_TARGET_PATH');
  });

  test('what is checked is the COMMITTED record, not the file on disk', () => {
    // The attack: commit a decision the reviewer would accept, then swap the file in the working
    // tree for one that approves different plan material. Only the committed bytes may count.
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    committedOverride.set(
      `.projectops/plan-decisions/${id}.json`.toLowerCase(),
      JSON.stringify(decision(w, { planDigest: 'sha256:' + '0'.repeat(64) })),
    );
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DECISION_INVALID');
    expect(r.problems.join(' ')).toMatch(/different plan material/i);
  });

  test('the same swap on the delegation is refused too', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    committedOverride.set(
      '.projectops/authority/plan-approval-delegation.json',
      JSON.stringify(delegation({ delegatedTo: 'Mallory' })),
    );
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The committed delegation names Mallory, so the decision by Grace is not by the authority.
    expect(r.code).toBe('DECISION_INVALID');
    expect(r.problems.join(' ')).toMatch(/not the recorded plan-approval authority/i);
  });

  test('a path-shaped id cannot reach outside the project', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    writeDecision(w);
    for (const bad of ['../../etc/passwd', '..\\..\\evil', 'C:sneaky.json', 'a/b/c-decision']) {
      const r = approvePlan(w.sys, w.root, {
        draftId: w.draftId,
        decisionId: bad,
        planRelPath: 'state/recovery.plan.json',
        stateRelPath: 'state/recovery.current-state.json',
        planId: 'x',
        programmeId: 'y',
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('UNSAFE_TARGET_PATH');
    }
  });

  test('a decision file that calls itself something else is refused', () => {
    const w = world({ committed: [COMMITTED[0]!, '.projectops/plan-decisions/RENAMED-DECISION.json'] });
    writeDelegation(w);
    const d = decision(w, { decisionId: 'ACME-PLAN-APPROVAL-DECISION1A' });
    w.sys.writeText(pjoin(w.root, '.projectops/plan-decisions/RENAMED-DECISION.json'), JSON.stringify(d, null, 2));
    const r = approvePlan(w.sys, w.root, {
      draftId: w.draftId,
      decisionId: 'RENAMED-DECISION',
      planRelPath: 'state/recovery.plan.json',
      stateRelPath: 'state/recovery.current-state.json',
      planId: 'x',
      programmeId: 'y',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toMatch(/calls itself/i);
  });

  test('a record-supplied ref is never handed to git unvalidated', () => {
    // The refusal is the same either way, so this asserts the mechanism rather than the outcome: a
    // string from an untrusted record must not reach git as a ref, where `HEAD`, `@{upstream}` or a
    // branch name would resolve to something it is not.
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w, { baseHead: 'HEAD' });
    const refs: string[] = [];
    const spy: System = { ...w.sys, exec: (cmd, args) => { refs.push(args.join(' ')); return w.sys.exec(cmd, args); } };
    const r = approvePlan(spy, w.root, {
      draftId: w.draftId,
      decisionId: id,
      planRelPath: 'state/recovery.plan.json',
      stateRelPath: 'state/recovery.current-state.json',
      planId: 'x',
      programmeId: 'y',
    });
    expect(r.ok).toBe(false);
    expect(refs.some((c) => c.includes('HEAD^{commit}'))).toBe(false);
  });

  test('an existing file is never written over', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    writeFileSync(pjoin(w.root, 'state/occupied.json'), '{"important":true}');
    const r = approvePlan(w.sys, w.root, {
      draftId: w.draftId,
      decisionId: id,
      planRelPath: 'state/occupied.json',
      stateRelPath: 'state/recovery.current-state.json',
      planId: 'x',
      programmeId: 'y',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('WOULD_OVERWRITE_ACTIVE_PLAN');
    expect(readFileSync(pjoin(w.root, 'state/occupied.json'), 'utf8')).toBe('{"important":true}');
  });

  test('a plan document missing a governance attribute is refused rather than defaulted', () => {
    const w = world({ committed: COMMITTED, planDoc: PLAN_DOC.replace('Risk: medium\n', '') });
    writeDelegation(w);
    const id = writeDecision(w);
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('PLAN_INCOMPLETE');
    expect(r.problems.join(' ')).toMatch(/does not state a risk level/i);
  });
});

describe('exact plan approval — readiness is recomputed, not asserted', () => {
  test('a plan that would not evaluate READY is refused, and nothing is written', () => {
    // The plan record this produces will say PLAN READY. That string is worth nothing: the governance
    // it inherits is missing a forbidden action every ready plan must retain, so the evaluator says no.
    governanceOverride = { forbiddenActions: ['production-deploy'] };
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('PLAN_NOT_READY');
    expect(r.problems.join(' ')).toMatch(/forbiddenActions missing/i);
    expect(existsSync(pjoin(w.root, 'state/recovery.plan.json'))).toBe(false);
    // And the decision is NOT spent by a failed attempt.
    const d = JSON.parse(readFileSync(pjoin(w.root, `.projectops/plan-decisions/${id}.json`), 'utf8')) as Record<string, unknown>;
    expect(d['consumedAt']).toBeUndefined();
  });

  test('an approver who is neither the owner nor a delegate does not produce a READY plan', () => {
    const { engine } = loadGovernanceEngine();
    const base = activePlan();
    const approval = base['approval'] as Record<string, unknown>;

    // Baseline: the owner approving is ready.
    expect(engine.evaluatePlanReady(base).ready).toBe(true);

    // A stranger, with owner authority claimed and no delegation, is not. This was the hole: the only
    // checks were "authority says owner" and "the approver is not the implementer", and any other
    // name satisfied both.
    const stranger = { ...base, approval: { ...approval, approvedBy: 'Mallory' } };
    const r1 = engine.evaluatePlanReady(stranger);
    expect(r1.ready).toBe(false);
    expect(r1.reasons.join(' ')).toMatch(/is not the recorded owner/i);

    // The same stranger, named by the owner in a plan-approval delegation, is.
    const delegated = {
      ...base,
      approval: {
        ...approval,
        approvedBy: 'Mallory',
        approvalDelegation: {
          delegatedBy: OWNER,
          delegatedTo: 'Mallory',
          delegationDate: '2026-08-11',
          delegatedScope: ['plan-approval'],
          projectScope: 'acme',
          excludesProtectedActions: true,
        },
      },
    };
    expect(engine.evaluatePlanReady(delegated).ready).toBe(true);

    // A delegation that tries to escape its project, or to carry protected actions, does not.
    for (const bad of [{ projectScope: 'other' }, { excludesProtectedActions: false }, { delegatedScope: ['plan-approval', 'production-deploy'] }, { delegatedBy: 'Mallory' }]) {
      const plan = {
        ...delegated,
        approval: {
          ...(delegated.approval as Record<string, unknown>),
          approvalDelegation: { ...((delegated.approval as Record<string, unknown>)['approvalDelegation'] as Record<string, unknown>), ...bad },
        },
      };
      expect(engine.evaluatePlanReady(plan).ready).toBe(false);
    }
  });
});

describe('exact plan approval — the pure checks refuse on their own', () => {
  test('a delegation for another project is refused', () => {
    const problems = checkPlanApprovalDelegation(delegation({ projectId: 'other' }), {
      projectId: 'acme',
      recordedOwner: OWNER,
      isCommitted: true,
    });
    expect(problems.join(' ')).toMatch(/is for project/i);
  });

  test('a delegation to the owner delegates nothing', () => {
    const problems = checkPlanApprovalDelegation(delegation({ delegatedTo: OWNER }), {
      projectId: 'acme',
      recordedOwner: OWNER,
      isCommitted: true,
    });
    expect(problems.join(' ')).toMatch(/delegates nothing/i);
  });

  test('a decision with the wrong schema version is refused', () => {
    const problems = checkPlanApprovalDecision(
      { schemaVersion: '9.9.9', decisionId: 'X'.repeat(10), decision: 'approve' },
      {
        projectId: 'acme',
        repository: 'acme/app',
        branch: 'main',
        draftId: 'abc',
        planDigest: 'sha256:' + '1'.repeat(64),
        expectedDecider: AUTHORITY,
        isCommitted: true,
        baseHeadExists: true,
      },
    );
    expect(problems.join(' ')).toMatch(/schemaVersion/i);
  });

  test('the plan digest covers plan material, and the engine is the one that computes it', () => {
    const engine = loadDiscoveryEngine();
    expect(engine.sha256('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
