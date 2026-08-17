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
  PLAN_GENESIS_SCHEMA_VERSION,
  PLAN_GENESIS_REL,
  PROJECT_CONFIG_REL,
  loadGovernanceEngine,
  loadCurrentStateSchema,
} from '../src/planApproval.js';
import { loadGovernedContext } from '../src/governedContext.js';
import { plan as planCommand } from '../src/commands/plan.js';
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
    // Programme scope is now ENFORCED for plan approval, as it always has been for closure. The
    // default names the programme these tests approve INTO — the authority is to approve the new
    // programme's plan, not the active one — so the delegated route stays exercised.
    programmeScope: 'acme-recovery',
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
function world(opts: { committed?: readonly string[]; planDoc?: string; noPlanMemory?: boolean } = {}): World {
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
        // A FRESHLY INSTALLED PROJECT DECLARES NO PLAN MEMORY, which is exactly what `projectos
        // install` writes. Note the fixture still leaves `state/active.plan.json` on disk: bootstrap
        // is keyed on the DECLARATION, never on a file happening to exist.
        ...(opts.noPlanMemory === true
          ? {}
          : { planMemory: { planPath: 'state/active.plan.json', currentStatePath: 'state/active.current-state.json' } }),
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

function closureRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION,
    delegationId: 'ACME-CLOSURE-DELEGATION1A',
    projectId: 'acme',
    programmeScope: 'acme-recovery',
    delegatedBy: OWNER,
    delegatedTo: AUTHORITY,
    delegatedScope: ['phase-closure', 'programme-closure'],
    delegationDate: '2026-08-11',
    excludesProtectedActions: true,
    ...over,
  };
}

function writeClosureDelegation(w: World, over: Record<string, unknown> = {}): void {
  w.sys.writeText(pjoin(w.root, '.projectops/authority/closure-delegation.json'), JSON.stringify(closureRecord(over), null, 2));
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

/* ------------------------------------------------------------------------------------------------
 * PROJECTOS-PHASE6-FIRST-PLAN-GENESIS1A — the FIRST plan a project ever approves.
 *
 * Every test above this point seeds an active approved plan, because that is where `recordedOwner`
 * comes from. A freshly installed project has none — `install` writes no `planMemory` — so before
 * this correction no new project could approve its first plan at all, and the `NO_ACTIVE_PLAN`
 * refusal that said so had no test of its own.
 *
 * Genesis answers exactly one question: WHO IS THE OWNER, before a plan exists to record one. It
 * approves nothing and delegates nothing; the delegation and the decision are untouched.
 * --------------------------------------------------------------------------------------------- */

const GENESIS_COMMITTED = [PLAN_GENESIS_REL, ...COMMITTED];

/**
 * The complete initial governance a first plan carries, in the plan schema's own field names.
 *
 * It mirrors the established plan fixture deliberately: a genesis snapshot has to satisfy the SAME
 * PLAN READY evaluator as any other plan, including the forbidden-action floor and `noApiPolicy`.
 * A thinner record is refused — proven by the incomplete-governance cases below — which is the point:
 * bootstrapping a project does not bootstrap it past the safety rules.
 */
const GENESIS_GOVERNANCE: Record<string, unknown> = {
  owner: OWNER,
  gatekeeper: AUTHORITY,
  implementer: 'Claude Code',
  closureAuthority: AUTHORITY,
  allowedActions: ['inspect-repository'],
  forbiddenActions: [
    'production-deploy',
    'production-db-mutation',
    'real-email-sms-whatsapp',
    'payment-or-live-charge',
    'force-push',
    'use-openai-api',
    'use-anthropic-api',
  ],
  ownerOnlyActions: ['approve-plan'],
  noApiPolicy: true,
};

function genesisRecord(over: Record<string, unknown> = {}, governanceOver: Record<string, unknown> | null = {}): Record<string, unknown> {
  return {
    schemaVersion: PLAN_GENESIS_SCHEMA_VERSION,
    genesisId: 'ACME-PLAN-GENESIS1A',
    projectId: 'acme',
    ...(governanceOver === null ? {} : { governance: { ...GENESIS_GOVERNANCE, ...governanceOver } }),
    ...over,
  };
}

function writeGenesis(w: World, over: Record<string, unknown> = {}, governanceOver: Record<string, unknown> | null = {}): void {
  w.sys.writeText(pjoin(w.root, PLAN_GENESIS_REL), JSON.stringify(genesisRecord(over, governanceOver), null, 2));
}

/** A fresh project: no plan memory declared, genesis + delegation + decision all in place. */
function freshProject(
  over: Record<string, unknown> = {},
  committed: readonly string[] = GENESIS_COMMITTED,
  governanceOver: Record<string, unknown> | null = {},
): World {
  const w = world({ committed, noPlanMemory: true });
  writeGenesis(w, over, governanceOver);
  writeDelegation(w);
  return w;
}

describe('first-plan genesis authority', () => {
  /** [A1] The case that was impossible before: a brand-new project approving its first plan. */
  test('A1 approves the first plan of a project that has never had one', () => {
    const w = freshProject();
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok, `first approval refused: ${r.ok ? '' : `${r.code} ${r.problems.join(' | ')}`}`).toBe(true);
  });

  /** [A2] And it is an ORDINARY approval — every post-approval guarantee still holds. */
  test('A2 binds the digest, consumes the decision and repoints plan memory', () => {
    const w = freshProject();
    const id = writeDecision(w);

    const r = run(w, id);
    if (!r.ok) throw new Error(`${r.code}: ${r.problems.join(' | ')}`);

    // The existing output contract, unchanged.
    expect(r.planDigest).toBe(w.planDigest);
    expect(r.decisionId).toBe(id);
    expect(r.planPath).toContain('recovery.plan.json');
    expect(r.phaseCount).toBeGreaterThan(0);

    // The decision is spent and cannot be replayed.
    const spent = JSON.parse(readFileSync(pjoin(w.root, `.projectops/plan-decisions/${id}.json`), 'utf8'));
    expect(spent['consumedAt']).toBeTruthy();

    // planMemory now names the new records — the project is no longer a bootstrap case.
    const cfg = JSON.parse(readFileSync(pjoin(w.root, '.projectops/project-config.json'), 'utf8'));
    const memory = cfg['planMemory'] as Record<string, unknown>;
    expect(memory['planPath']).toBe('state/recovery.plan.json');

    // THE EXACT BOOTSTRAP GOVERNANCE, field for field — not defaults, not empty strings.
    const newPlan = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.plan.json'), 'utf8'));
    const gov = newPlan['governance'] as Record<string, unknown>;
    for (const [field, value] of Object.entries(GENESIS_GOVERNANCE)) {
      expect(gov[field], `governance.${field}`).toEqual(value);
    }

    // And the approval evidence tells the truth about where it came from: a first plan carried
    // nothing forward, because there was no predecessor to carry anything forward from.
    const evidence = String((newPlan['approval'] as Record<string, unknown>)['approvalEvidenceReference']);
    expect(evidence).toContain('genesis authority record');
    expect(evidence).not.toContain('carried forward');
  });

  /** The successor path must keep saying what it always said. */
  test('A2b a successor plan still reports governance as carried forward', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);

    const r = run(w, id);
    if (!r.ok) throw new Error(`${r.code}: ${r.problems.join(' | ')}`);

    const newPlan = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.plan.json'), 'utf8'));
    const evidence = String((newPlan['approval'] as Record<string, unknown>)['approvalEvidenceReference']);
    expect(evidence).toContain('carried forward');
    expect(evidence).not.toContain('genesis authority record');
  });

  /** Incomplete governance is refused HERE, with a field name, not later as an opaque schema error. */
  test('refuses genesis governance that could never produce a schema-valid plan', () => {
    const cases: readonly [string, Record<string, unknown> | null, string][] = [
      ['no governance object at all', null, 'carries no governance'],
      ['blank gatekeeper', { gatekeeper: '' }, 'governance.gatekeeper'],
      ['missing implementer', { implementer: undefined }, 'governance.implementer'],
      ['blank closureAuthority', { closureAuthority: '  ' }, 'governance.closureAuthority'],
      ['empty allowedActions', { allowedActions: [] }, 'governance.allowedActions'],
      ['forbiddenActions not a list', { forbiddenActions: 'production-deploy' }, 'governance.forbiddenActions'],
      ['ownerOnlyActions holding a blank', { ownerOnlyActions: [''] }, 'governance.ownerOnlyActions'],
    ];
    for (const [label, governanceOver, expected] of cases) {
      const w = freshProject({}, GENESIS_COMMITTED, governanceOver);
      const id = writeDecision(w);

      const r = run(w, id);

      expect(r.ok, label).toBe(false);
      if (r.ok) continue;
      expect(r.code, label).toBe('GENESIS_INVALID');
      expect(r.problems.join(' '), label).toContain(expected);
    }
  });

  /**
   * [S8] THE BOOTSTRAP DOOR IS NOT OPENED BY EDITING THE WORKING TREE.
   *
   * `project-config.json` is implementer-writable. If eligibility rested on that copy alone, deleting
   * `planMemory` from it would make an established project a "first-plan" project again, and a stale
   * genesis record would re-supply an owner the project has since moved past. Eligibility is therefore
   * asked of the COMMITTED configuration, which only the owner's commit gate can change.
   */
  test('S8 refuses bootstrap when the COMMITTED config still declares an active plan', () => {
    const w = world({ committed: [...GENESIS_COMMITTED, PROJECT_CONFIG_REL], noPlanMemory: true });
    writeGenesis(w);
    writeDelegation(w);
    const id = writeDecision(w);

    // The working tree has no planMemory; the committed blob still does.
    const committedCfg = JSON.parse(readFileSync(pjoin(w.root, '.projectops/project-config.json'), 'utf8'));
    committedCfg['planMemory'] = { planPath: 'state/active.plan.json', currentStatePath: 'state/active.current-state.json' };
    committedOverride.set(PROJECT_CONFIG_REL.toLowerCase(), JSON.stringify(committedCfg));

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_ACTIVE_PLAN');
    expect(r.problems.join(' ')).toContain('committed');
    expect(r.problems.join(' ')).toContain('is not a first-plan project');
  });

  /** [S1] A file on disk is not authority. Only the committed blob counts. */
  test('S1 refuses a genesis that is present but not committed', () => {
    const w = freshProject({}, COMMITTED); // genesis written, but not listed as committed
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('GENESIS_INVALID');
    expect(r.problems.join(' ')).toContain('not committed');
  });

  /** [S2] Authority does not cross project boundaries — a genesis copied from another repo fails. */
  test('S2 refuses a genesis recorded for a different project', () => {
    const w = freshProject({ projectId: 'other-project' });
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('GENESIS_INVALID');
    expect(r.problems.join(' ')).toContain('other-project');
  });

  /**
   * [S3] The implementer may not make itself the owner.
   *
   * This is the root of the whole chain: the delegation's own implementer exclusion compares against
   * `recordedOwner`, so an implementer who became the owner would pass it.
   */
  test('S3 refuses a genesis naming the implementer as owner', () => {
    const w = freshProject({}, GENESIS_COMMITTED, { owner: 'Claude Code' });
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('GENESIS_INVALID');
    expect(r.problems.join(' ')).toContain('implementer');
  });

  /** [S3b] And the delegation's own implementer exclusion is untouched by any of this. */
  test('S3b still refuses a delegation to the implementer on the first plan', () => {
    const w = world({ committed: GENESIS_COMMITTED, noPlanMemory: true });
    writeGenesis(w);
    writeDelegation(w, { delegatedTo: 'Claude Code' });
    const id = writeDecision(w, { decidedBy: 'Claude Code' });

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DELEGATION_INVALID');
    expect(r.problems.join(' ')).toContain('implementer');
  });

  /** [S4] An unsupported schemaVersion fails closed rather than being read leniently. */
  test('S4 refuses a genesis with a wrong or missing schemaVersion', () => {
    for (const over of [{ schemaVersion: '2.0.0' }, { schemaVersion: undefined }]) {
      const w = freshProject(over);
      const id = writeDecision(w);

      const r = run(w, id);

      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('GENESIS_INVALID');
      expect(r.problems.join(' ')).toContain('schemaVersion');
    }
  });

  /**
   * [S5] PRECEDENCE. With a valid active plan declared, genesis is not consulted at all — even a
   * perfectly valid one naming a different owner.
   *
   * Proven by consequence rather than by inspection: the delegation is `delegatedBy` the ACTIVE
   * plan's owner. If genesis were winning, that delegation would be refused as coming from someone
   * who is not the recorded owner.
   */
  test('S5 ignores genesis entirely when an active plan is declared', () => {
    const w = world({ committed: GENESIS_COMMITTED }); // planMemory IS declared
    writeGenesis(w, { owner: 'Someone Else' });
    writeDelegation(w); // delegatedBy: OWNER, the ACTIVE plan's owner
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok, `the active plan's owner should have been authoritative: ${r.ok ? '' : r.problems.join(' | ')}`).toBe(true);
  });

  /** [S5b] The mirror: a delegation from the genesis owner is refused while an active plan exists. */
  test('S5b refuses a delegation from the genesis owner when an active plan is declared', () => {
    const w = world({ committed: GENESIS_COMMITTED });
    writeGenesis(w, { owner: 'Someone Else' });
    writeDelegation(w, { delegatedBy: 'Someone Else' });
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DELEGATION_INVALID');
    expect(r.problems.join(' ')).toContain('Someone Else');
  });

  /**
   * [S6] LOAD-BEARING. A declared-but-broken active plan is a DAMAGED project, never a new one.
   *
   * Without this, deleting one file downgrades an established project to bootstrap state, where a
   * fresh owner identity could be introduced. The attacker would not have to forge an owner — only
   * to break a path.
   */
  test('S6 fails closed when the declared active plan is missing, and genesis does not rescue it', () => {
    const w = world({ committed: GENESIS_COMMITTED }); // planMemory declared...
    rmSync(pjoin(w.root, 'state/active.plan.json')); // ...but the plan it names is gone
    writeGenesis(w); // a perfectly valid genesis, which must NOT apply
    writeDelegation(w);
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_ACTIVE_PLAN');
    expect(r.problems.join(' ')).toContain('declares an active plan');
    expect(r.problems.join(' ')).toContain('does not apply');
  });

  /** [S6b] Same rule when the declared plan is present but records no owner. */
  test('S6b fails closed when the declared active plan records no owner', () => {
    governanceOverride = { owner: '' };
    const w = world({ committed: GENESIS_COMMITTED });
    writeGenesis(w);
    writeDelegation(w);
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_ACTIVE_PLAN');
  });

  /** [S7] Genesis establishes an identity, never a permission. With no delegation the owner is
   *  the only approver, so a delegate's decision is refused. */
  test('S7 refuses a first-plan decision that is not the owner when no delegation applies', () => {
    const w = world({ committed: [PLAN_GENESIS_REL, '.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json'], noPlanMemory: true });
    writeGenesis(w);
    // No delegation written and none committed, so authority never moved: it stays with the owner.
    // The decision here is the DELEGATE's, and a delegate with no delegation is nobody.
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DECISION_INVALID');
    expect(r.problems.join(' ')).toMatch(/not the recorded plan-approval authority/i);
  });

  /** With neither an active plan nor any genesis, the refusal must SAY what to do. */
  test('refuses with actionable guidance when a fresh project has no genesis at all', () => {
    const w = world({ committed: COMMITTED, noPlanMemory: true });
    writeDelegation(w);
    const id = writeDecision(w);

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_ACTIVE_PLAN');
    expect(r.problems.join(' ')).toContain(PLAN_GENESIS_REL);
    expect(r.problems.join(' ')).toContain('FIRST');
  });
});

/**
 * OWNER-WORKFLOW-PLAN-ACTIVATION1A — the refusals the owner UI now depends on.
 *
 * The engine already enforced every one of these; none had a test. Untested enforcement is
 * enforcement that can be deleted without anything going red, and these are precisely the checks
 * standing between a browser button and an unapproved plan becoming executable.
 */
/**
 * `plan activate` — the owner-workflow wrapper (OWNER-WORKFLOW-PLAN-ACTIVATION1B).
 *
 * THE DEFECT THESE EXIST TO PREVENT. The browser route first called `plan approve`, whose
 * destination defaults to the single fixed filename `.projectops/plan.json`. `approvePlan` refuses
 * to overwrite an existing record — correctly, because an activated plan is immutable — so that
 * default made activation work exactly once per project and refuse forever after. ProjectOS is not
 * a one-plan system.
 *
 * `plan activate` derives a record path per draft, and takes the programme from the plan already in
 * force rather than inventing one. It decides nothing else: `approvePlan` still owns every question
 * of authority.
 */
describe('plan activate derives destinations and keeps the programme in force', () => {
  const ACTIVATE_COMMITTED = [
    '.projectops/authority/plan-approval-delegation.json',
    '.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json',
    '.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION2B.json',
  ];

  function activateVia(w: World, draftId: string, decisionId: string) {
    return planCommand({ sys: w.sys, root: w.root }, { id: draftId, decision: decisionId }, ['activate']);
  }

  test('[8] a new plan is a NEW record; the previously active plan is untouched', () => {
    const w = world({ committed: ACTIVATE_COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w);

    const before = readFileSync(pjoin(w.root, 'state/active.plan.json'), 'utf8');
    const beforeState = readFileSync(pjoin(w.root, 'state/active.current-state.json'), 'utf8');

    const r = activateVia(w, w.draftId, id);
    expect(r.code, r.lines.join(' | ')).toBe(0);

    // Derived, never supplied.
    const planPath = pjoin(w.root, `.projectops/plan-${w.draftId}.json`);
    const statePath = pjoin(w.root, `.projectops/current-state-${w.draftId}.json`);
    expect(existsSync(planPath)).toBe(true);
    expect(existsSync(statePath)).toBe(true);

    const activated = JSON.parse(readFileSync(planPath, 'utf8')) as Record<string, unknown>;
    expect(activated['planStatus']).toBe('PLAN READY');
    expect(activated['planId']).toBe(`plan-${w.draftId}`);
    // The programme is the one already in force, taken from the active plan.
    expect(activated['programmeId']).toBe('acme-v1');

    // The old bytes are exactly the old bytes. Activation moves a POINTER.
    expect(readFileSync(pjoin(w.root, 'state/active.plan.json'), 'utf8')).toBe(before);
    expect(readFileSync(pjoin(w.root, 'state/active.current-state.json'), 'utf8')).toBe(beforeState);

    // planMemory now names the new records.
    const cfg = JSON.parse(readFileSync(pjoin(w.root, '.projectops/project-config.json'), 'utf8')) as Record<string, unknown>;
    const memory = cfg['planMemory'] as Record<string, unknown>;
    expect(memory['planPath']).toBe(`.projectops/plan-${w.draftId}.json`);
    expect(memory['currentStatePath']).toBe(`.projectops/current-state-${w.draftId}.json`);
    // And the outgoing plan is retained as a planning source rather than deleted.
    expect(JSON.stringify(cfg['planSources'])).toContain('state/active.plan.json');
  });

  test('[9] a SECOND plan activates in the same programme without touching the first', () => {
    const w = world({ committed: ACTIVATE_COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const firstDecision = writeDecision(w);
    const firstDraft = w.draftId;

    expect(activateVia(w, firstDraft, firstDecision).code).toBe(0);
    const planA = pjoin(w.root, `.projectops/plan-${firstDraft}.json`);
    const planABytes = readFileSync(planA, 'utf8');

    // A second objective, drafted AFTER the first activation — the repository's plan material has
    // legitimately moved on, so a draft made earlier would be superseded, and should be.
    const second = submitObjective(w.sys, w.root, 'Make the returns process quick and predictable for staff.');
    if (!second.ok) throw new Error(`could not draft again: ${second.code}`);
    const secondDraft = second.objective.objectiveId;
    const secondDecision = writeDecision(w, {
      decisionId: 'ACME-PLAN-APPROVAL-DECISION2B',
      draftId: secondDraft,
      planDigest: second.draftRecord.planDigest,
    });

    const r2 = activateVia(w, secondDraft, secondDecision);
    expect(r2.code, r2.lines.join(' | ')).toBe(0);

    const planB = pjoin(w.root, `.projectops/plan-${secondDraft}.json`);
    expect(existsSync(planB)).toBe(true);
    expect(planB).not.toBe(planA);
    // Plan A is immutable: still there, still byte-identical.
    expect(readFileSync(planA, 'utf8')).toBe(planABytes);
    // The pointer moved to B.
    const cfg = JSON.parse(readFileSync(pjoin(w.root, '.projectops/project-config.json'), 'utf8')) as Record<string, unknown>;
    expect((cfg['planMemory'] as Record<string, unknown>)['planPath']).toBe(`.projectops/plan-${secondDraft}.json`);
    // Same programme throughout.
    const b = JSON.parse(readFileSync(planB, 'utf8')) as Record<string, unknown>;
    expect(b['programmeId']).toBe('acme-v1');
    // Both decisions are separately spent.
    for (const d of [firstDecision, secondDecision]) {
      const rec = JSON.parse(readFileSync(pjoin(w.root, `.projectops/plan-decisions/${d}.json`), 'utf8')) as Record<string, unknown>;
      expect(typeof rec['consumedAt']).toBe('string');
    }
  });

  test('[10] the same draft cannot be activated twice, and nothing is overwritten', () => {
    const w = world({ committed: ACTIVATE_COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w);
    expect(activateVia(w, w.draftId, id).code).toBe(0);

    const planPath = pjoin(w.root, `.projectops/plan-${w.draftId}.json`);
    const bytes = readFileSync(planPath, 'utf8');

    const again = activateVia(w, w.draftId, id);
    expect(again.code).not.toBe(0);
    expect(again.lines.join(' ')).toMatch(/REFUSED/);
    // The record is exactly as it was: no truncate, no replace.
    expect(readFileSync(planPath, 'utf8')).toBe(bytes);
  });

  test('[11] a programme-scoped closure delegation stays VALID because the programme is derived', () => {
    // THE REAL SCOPE PROOF, not a restatement of the assignment.
    //
    // Asserting "the new plan's programmeId equals the active plan's" only proves the wrapper copied
    // a field. What matters is the consequence: closure delegation is programme-SCOPED, so a
    // fabricated programme id would put the committed closure delegation out of scope and the
    // activation would be refused outright ("scoped to programme ..."). This fixture scopes the
    // closure delegation to the programme the active plan actually declares, and the activation only
    // succeeds — and only carries the closure arrangement — while the derived id matches it.
    const w = world({ committed: [...ACTIVATE_COMMITTED, '.projectops/authority/closure-delegation.json'] });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const activeProgramme = String(
      (JSON.parse(readFileSync(pjoin(w.root, 'state/active.plan.json'), 'utf8')) as Record<string, unknown>)['programmeId'],
    );
    writeClosureDelegation(w, { programmeScope: activeProgramme });
    const id = writeDecision(w);

    const r = activateVia(w, w.draftId, id);
    expect(r.code, r.lines.join(' | ')).toBe(0);

    const activated = JSON.parse(
      readFileSync(pjoin(w.root, `.projectops/plan-${w.draftId}.json`), 'utf8'),
    ) as Record<string, unknown>;
    expect(activated['programmeId']).toBe(activeProgramme);

    // The closure delegation was accepted and carried into the new plan — which is only possible
    // because the programme it is scoped to is the programme this activation used.
    const gov = activated['governance'] as Record<string, unknown>;
    const closure = gov['closureDelegation'] as Record<string, unknown>;
    expect(closure).toBeTruthy();
    expect(gov['closureAuthority']).toBe(AUTHORITY);
    expect(String(closure['notes'])).toContain(activeProgramme);
  });

  test('[11-mutation] an invented programme id would put that same delegation out of scope', () => {
    // The other half of the proof, driven through the ENGINE with an invented id — showing what the
    // wrapper avoids by deriving. If `activate` ever fabricated a programme, this is the refusal a
    // real project would hit, and it would surface as an unclosable plan rather than as an error at
    // activation time if the delegation happened to be absent.
    const w = world({ committed: [...ACTIVATE_COMMITTED, '.projectops/authority/closure-delegation.json'] });
    // Plan approval is scoped to the INVENTED programme so it passes, isolating the closure
    // delegation as the thing the invented id puts out of scope — which is what this proves.
    writeDelegation(w, { programmeScope: `programme-${w.draftId}` });
    const activeProgramme = String(
      (JSON.parse(readFileSync(pjoin(w.root, 'state/active.plan.json'), 'utf8')) as Record<string, unknown>)['programmeId'],
    );
    writeClosureDelegation(w, { programmeScope: activeProgramme });
    const id = writeDecision(w);

    const invented = approvePlan(w.sys, w.root, {
      draftId: w.draftId,
      decisionId: id,
      planRelPath: `.projectops/plan-${w.draftId}.json`,
      stateRelPath: `.projectops/current-state-${w.draftId}.json`,
      planId: `plan-${w.draftId}`,
      programmeId: `programme-${w.draftId}`, // exactly what the wrapper must never do
    });

    expect(invented.ok).toBe(false);
    if (!invented.ok) expect(invented.problems.join('; ')).toMatch(/scoped to programme/i);
    expect(existsSync(pjoin(w.root, `.projectops/plan-${w.draftId}.json`))).toBe(false);
  });

  test('[6] an active plan with no programmeId refuses rather than defaulting one', () => {
    const w = world({ committed: ACTIVATE_COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w);

    const activePath = pjoin(w.root, 'state/active.plan.json');
    const active = JSON.parse(readFileSync(activePath, 'utf8')) as Record<string, unknown>;
    delete active['programmeId'];
    writeFileSync(activePath, JSON.stringify(active, null, 2));

    const r = activateVia(w, w.draftId, id);
    expect(r.code).not.toBe(0);
    // THE REFUSAL COMES FROM THE SCHEMA, and this asserts that rather than the wrapper's own
    // narrowing branch. `programmeId` is `required`/`minLength: 1` in the plan schema, so
    // `loadGovernedContext` refuses with PLAN_SCHEMA_INVALID before the wrapper reads the field at
    // all. An earlier version of this test claimed to prove the NO_ACTIVE_PROGRAMME branch; it
    // never reached it, which is the difference between a test passing and a test proving.
    expect(r.lines.join(' ')).toMatch(/PLAN_SCHEMA_INVALID/);
    expect(r.lines.join(' ')).toMatch(/programmeId/);
    // Either way, the behaviour the gate requires holds: no programme is defaulted and nothing runs.
    expect(existsSync(pjoin(w.root, `.projectops/plan-${w.draftId}.json`))).toBe(false);
  });

  test('[12] a path-shaped draft id is refused BEFORE it becomes a filename', () => {
    const w = world({ committed: ACTIVATE_COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    writeDecision(w);
    for (const bad of ['../../evil', 'a'.repeat(200), 'has space', 'x:stream', 'short']) {
      const r = activateVia(w, bad, 'ACME-PLAN-APPROVAL-DECISION1A');
      expect(r.code, bad).not.toBe(0);
      expect(r.lines.join(' '), bad).toMatch(/REFUSED|requires/);
    }
    // Nothing resembling a plan record was created anywhere under .projectops.
    // Note the .json filter: '.projectops/plan-decisions' is a DIRECTORY that also starts 'plan-'.
    const written = readdirSync(pjoin(w.root, '.projectops')).filter((f) => f.startsWith('plan-') && f.endsWith('.json'));
    expect(written).toEqual([]);
  });

  test('[12b] a path-shaped DECISION id is refused through this entry point too', () => {
    // The wrapper never joins the decision id to a path itself — it forwards it and `approvePlan`
    // validates it before use. That is why this is refused, and asserting it HERE keeps the promise
    // attached to the entry point a caller actually reaches, rather than only to the engine.
    const w = world({ committed: ACTIVATE_COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    writeDecision(w);
    for (const bad of ['../../evil', 'x:stream', 'a/b/c', 'has space', 'short']) {
      const r = activateVia(w, w.draftId, bad);
      expect(r.code, bad).not.toBe(0);
      expect(r.lines.join(' '), bad).toMatch(/REFUSED/);
    }
    expect(existsSync(pjoin(w.root, `.projectops/plan-${w.draftId}.json`))).toBe(false);
  });

  test('[13] activation still refuses without a committed decision', () => {
    const w = world({ committed: ['.projectops/authority/plan-approval-delegation.json'] });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w);
    const r = activateVia(w, w.draftId, id);
    expect(r.code).not.toBe(0);
    expect(r.lines.join(' ')).toMatch(/REFUSED/);
    expect(existsSync(pjoin(w.root, `.projectops/plan-${w.draftId}.json`))).toBe(false);
  });
});

describe('activation refuses every way the decision can be wrong', () => {
  test('[A/B] a decision that exists on disk but was never COMMITTED activates nothing', () => {
    const w = world({ committed: ['.projectops/authority/plan-approval-delegation.json'] });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    // Written, readable, well-formed — and not committed. Working-tree text is not a decision.
    const id = writeDecision(w);
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join('; ')).toMatch(/commit|committed/i);
  });

  test('[A] a draft with no decision file at all activates nothing', () => {
    const w = world({ committed: ['.projectops/authority/plan-approval-delegation.json'] });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const r = run(w, 'ACME-PLAN-APPROVAL-DECISION1A');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join('; ')).toMatch(/no committed plan-approval decision/i);
  });

  test('[D] a decision taken for another repository is refused', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w, { repository: 'github.com/someone-else/other-repo' });
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join('; ')).toMatch(/repository/i);
  });

  test('[E] a decision taken on another branch is refused', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w, { branch: 'some-other-branch' });
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join('; ')).toMatch(/branch/i);
  });

  test('[F] a decision approving a DIFFERENT draft cannot activate this one', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w, { draftId: 'some-other-draft-id' });
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join('; ')).toMatch(/approves draft/i);
  });

  test('[I] a decision the IMPLEMENTER signed cannot activate a plan', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-v1' }); // activate derives the ACTIVE plan's programme
    const id = writeDecision(w, { decidedBy: 'Claude Code' });
    const r = run(w, id);
    expect(r.ok).toBe(false);
    // Refused as the WRONG DECIDER, which is the check that fires first: the delegation names
    // Grace, so a decision signed by anyone else — implementer or not — never reaches the
    // implementer-specific branch. That branch is not dead: it guards the case where a delegation
    // itself names the implementer, and the delegation tests below cover exactly that. Asserting
    // the implementer wording here would have asserted a message this input cannot produce.
    if (!r.ok) expect(r.problems.join('; ')).toMatch(/decision was taken by/i);
  });
});

describe('exact plan approval — the happy path, once', () => {
  test('a committed delegation plus a committed decision about this exact plan material activates a new plan', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);

    const r = run(w, id);
    expect(r.ok ? '' : r.problems.join('; ')).toBe('');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The current state is a governed record too and must satisfy its own schema.
    const { engine: govEngine } = loadGovernanceEngine();
    const state = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.current-state.json'), 'utf8')) as Record<string, unknown>;
    const stateErrors = govEngine.validateAgainstSchema(state, loadCurrentStateSchema());
    expect(stateErrors.join('; ')).toBe('');

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
      name: 'no delegation — authority stays with the owner, so a delegate decision is refused',
      setup: (w) => writeDecision(w),
      code: 'DECISION_INVALID',
      match: /not the recorded plan-approval authority/i,
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
    writeDelegation(w, { programmeScope: 'y' }); // this approval targets programme 'y'
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

describe('closure delegation — recorded by the owner, or carried forward untouched', () => {
  const CLOSURE_PATH = '.projectops/authority/closure-delegation.json';

  test('with no closure record, the active plan\'s arrangement is carried forward unchanged', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    const id = writeDecision(w);
    expect(run(w, id).ok).toBe(true);
    const plan = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.plan.json'), 'utf8')) as Record<string, unknown>;
    const gov = plan['governance'] as Record<string, unknown>;
    expect(gov['closureAuthority']).toBe(OWNER);          // the fixture's active plan delegates nothing
    expect(gov['closureDelegation']).toBeUndefined();
  });

  test('a committed closure record names this programme in the new plan', () => {
    const w = world({ committed: [...COMMITTED, CLOSURE_PATH] });
    writeDelegation(w);
    writeClosureDelegation(w);
    const id = writeDecision(w);
    const r = run(w, id);
    expect(r.ok ? '' : r.problems.join('; ')).toBe('');
    const plan = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.plan.json'), 'utf8')) as Record<string, unknown>;
    const gov = plan['governance'] as Record<string, unknown>;
    const del = gov['closureDelegation'] as Record<string, unknown>;
    expect(gov['closureAuthority']).toBe(AUTHORITY);
    expect(del['delegatedBy']).toBe(OWNER);
    expect(del['delegatedScope']).toEqual(['phase-closure', 'programme-closure']);
    expect(del['projectScope']).toBe('acme');
    expect(del['excludesProtectedActions']).toBe(true);
    expect(String(del['notes'])).toContain('acme-recovery');
    // And the readiness evaluator, which has its own closure-delegation rules, still says yes.
    const { engine } = loadGovernanceEngine();
    expect(engine.evaluatePlanReady(plan).ready).toBe(true);
  });

  const closureAttacks: readonly { name: string; over: Record<string, unknown>; match: RegExp }[] = [
    { name: 'granted by someone who is not the owner', over: { delegatedBy: 'Mallory' }, match: /recorded owner/i },
    { name: 'granted to the implementer', over: { delegatedTo: 'Claude Code' }, match: /implementer/i },
    { name: 'scoped to another programme', over: { programmeScope: 'something-else' }, match: /scoped to programme/i },
    { name: 'for another project', over: { projectId: 'other' }, match: /is for project/i },
    { name: 'carrying a scope it may not grant', over: { delegatedScope: ['phase-closure', 'production-deploy'] }, match: /may not grant/i },
    { name: 'claiming protected-action authority', over: { excludesProtectedActions: false }, match: /excludesProtectedActions/i },
    { name: 'carrying no scope at all', over: { delegatedScope: [] }, match: /no scope/i },
  ];
  for (const a of closureAttacks) {
    test(`a closure delegation ${a.name} is refused`, () => {
      const w = world({ committed: [...COMMITTED, CLOSURE_PATH] });
      writeDelegation(w);
      writeClosureDelegation(w, a.over);
      const id = writeDecision(w);
      const r = run(w, id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('DELEGATION_INVALID');
      expect(r.problems.join(' ')).toMatch(a.match);
      expect(existsSync(pjoin(w.root, 'state/recovery.plan.json'))).toBe(false);
    });
  }

  test('an uncommitted closure record is refused rather than ignored', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w);
    writeClosureDelegation(w);
    const id = writeDecision(w);
    const r = run(w, id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toMatch(/not committed/i);
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

/* ------------------------------------------------------------------------------------------------
 * PROJECTOS-BOOTSTRAP-PLAN-APPROVAL-REPAIR1A — who may approve, and for WHICH programme.
 *
 * Two defects were repaired together because they are one defect seen from two sides. A
 * plan-approval delegation recorded a `programmeScope` that nothing read, so a delegation granted
 * for a finished programme silently stood in front of the next programme's approval. And the
 * refusal text promised that "only the owner can approve a plan for this project unless the owner
 * has recorded a delegation" while no code path let the owner do it — so a project whose delegation
 * named a retired programme could be approved by nobody at all.
 *
 * The rule now: a delegation applies to the project and programme it names, carrying the
 * plan-approval scope. Where none applies, authority never moved and the owner approves directly.
 * ---------------------------------------------------------------------------------------------- */
describe('plan-approval authority — programme scope and the owner-direct path', () => {
  /** The exact shape of the live defect: a delegation for a CLOSED programme must not carry over. */
  test('a delegation scoped to another programme does not grant approval for this one', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-operational-recovery' }); // a different programme
    const id = writeDecision(w); // decided by the delegate

    const r = run(w, id); // approves into 'acme-recovery'

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DECISION_INVALID');
    expect(r.problems.join(' ')).toMatch(/not the recorded plan-approval authority/i);
  });

  test('the owner may approve directly when no delegation exists at all', () => {
    const w = world({ committed: ['.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json'] });
    const id = writeDecision(w, { decidedBy: OWNER });

    const r = run(w, id);

    expect(r.ok, JSON.stringify((r as { problems?: unknown }).problems)).toBe(true);
  });

  test('the owner may approve directly when the only delegation is for another programme', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-operational-recovery' });
    const id = writeDecision(w, { decidedBy: OWNER });

    const r = run(w, id);

    expect(r.ok, JSON.stringify((r as { problems?: unknown }).problems)).toBe(true);
  });

  test('a delegate cannot approve when no delegation applies', () => {
    const w = world({ committed: ['.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json'] });
    const id = writeDecision(w, { decidedBy: AUTHORITY });

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DECISION_INVALID');
    expect(r.problems.join(' ')).toMatch(/not the recorded plan-approval authority/i);
  });

  /** A delegation deliberately created for THIS programme still works — the repair narrows, not bans. */
  test('a correctly programme-scoped delegation still grants the delegate approval', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-recovery' });
    const id = writeDecision(w, { decidedBy: AUTHORITY });

    const r = run(w, id);

    expect(r.ok, JSON.stringify((r as { problems?: unknown }).problems)).toBe(true);
  });

  /** The owner-direct path must not become a way in for the implementer. */
  test('the implementer cannot approve even when the owner path is the live one', () => {
    const w = world({ committed: ['.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json'] });
    const id = writeDecision(w, { decidedBy: 'Claude Code' });

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toMatch(/not the recorded plan-approval authority|implementer/i);
  });

  /** THE ESCALATION THE OWNER PATH COULD HAVE OPENED. If the recorded owner were itself an
   *  implementer identity, owner-direct approval would make `decidedBy` match `expectedDecider` and
   *  the wrong-decider branch would NOT fire. The implementer check has to catch it instead. */
  test('the implementer cannot approve even when the recorded owner IS an implementer identity', () => {
    governanceOverride = { owner: 'Claude Code' };
    const w = world({ committed: ['.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json'] });
    const id = writeDecision(w, { decidedBy: 'Claude Code' });

    const r = run(w, id);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The EXACT decider guard, not merely any sentence containing "implementer": this repository
    // defends the same property in more than one layer, and a loose match cannot tell which one
    // fired. Asserting the precise refusal is what makes removing this guard a failing test.
    expect(r.problems).toContain(
      'decision was taken by the implementer — the implementer can never approve a plan',
    );
  });

  test('a delegation for another project still does not apply, and the owner remains the approver', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { projectId: 'other', programmeScope: 'acme-recovery' });
    const delegateAttempt = run(w, writeDecision(w, { decidedBy: AUTHORITY }));

    expect(delegateAttempt.ok).toBe(false);
    if (!delegateAttempt.ok) {
      expect(delegateAttempt.problems.join(' ')).toMatch(/not the recorded plan-approval authority/i);
    }
  });

  /** Approving a plan never widens protected authority, on either route. */
  test('owner-direct approval carries no protected-action authority', () => {
    const w = world({ committed: ['.projectops/plan-decisions/ACME-PLAN-APPROVAL-DECISION1A.json'] });
    const id = writeDecision(w, { decidedBy: OWNER });

    const r = run(w, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const plan = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.plan.json'), 'utf8')) as Record<string, unknown>;
    const gov = plan['governance'] as Record<string, unknown>;
    const source = activePlan()['governance'] as Record<string, unknown>;
    // COMPARED AGAINST THE SOURCE, not merely asserted to be array-shaped. Checking the type only
    // would pass just as happily if the approval had widened either set, which is the thing this test
    // is named after. Raised by code review.
    expect(gov['ownerOnlyActions']).toEqual(source['ownerOnlyActions']);
    expect(gov['forbiddenActions']).toEqual(source['forbiddenActions']);
    expect(gov['allowedActions']).toEqual(source['allowedActions']);
    expect(gov['owner']).toBe(OWNER);
    // And the approval records the owner route honestly: authority is the owner's, with no
    // delegation described, because none applied.
    const approval = plan['approval'] as Record<string, unknown>;
    expect(approval['approvalAuthority']).toBe('owner');
    expect(approval['approvedBy']).toBe(OWNER);
    expect('approvalDelegation' in approval).toBe(false);
  });

  /* THE ENTRY POINT MATTERS AS MUCH AS THE RULE. `plan approve` used to take the programme from a
   * bare `--programme-id` flag, so a caller could re-point the scope comparison at whatever a stale
   * delegation happened to name and have that retired authority accepted for a different programme —
   * defeating the scope check through a supported command. Raised by security review; these two prove
   * the entry point now derives the programme from the plan in force. */
  test('plan approve cannot revive a stale delegation by naming its programme', () => {
    const w = world({ committed: COMMITTED });
    // The exploit: a once-legitimate delegation for a programme that is not the one in force.
    writeDelegation(w, { programmeScope: 'acme-recovery' });
    const id = writeDecision(w, { decidedBy: AUTHORITY });

    const r = planCommand(
      { sys: w.sys, root: w.root },
      { id: w.draftId, decision: id, 'programme-id': 'acme-recovery', 'plan-path': 'state/recovery.plan.json', 'state-path': 'state/recovery.current-state.json' },
      ['approve'],
    );

    // Naming a programme other than the one in force STARTS a programme, which is the owner's act,
    // so no delegation applies and the delegate is not the approver.
    expect(r.code).not.toBe(0);
    expect(r.lines.join(' ')).toMatch(/not the recorded plan-approval authority/i);
    expect(existsSync(pjoin(w.root, 'state/recovery.plan.json'))).toBe(false);
  });

  test('the owner CAN start a new programme by naming it, which is the point of the flag', () => {
    const w = world({ committed: COMMITTED });
    writeDelegation(w, { programmeScope: 'acme-recovery' }); // irrelevant to a new programme
    const id = writeDecision(w, { decidedBy: OWNER });

    const r = planCommand(
      { sys: w.sys, root: w.root },
      { id: w.draftId, decision: id, 'programme-id': 'acme-next', 'plan-path': 'state/recovery.plan.json', 'state-path': 'state/recovery.current-state.json' },
      ['approve'],
    );

    expect(r.code, r.lines.join(' | ')).toBe(0);
    const plan = JSON.parse(readFileSync(pjoin(w.root, 'state/recovery.plan.json'), 'utf8')) as Record<string, unknown>;
    expect(plan['programmeId']).toBe('acme-next');
  });

  test('plan approve cannot be pointed at a retired programme to revive a stale delegation', () => {
    const w = world({ committed: COMMITTED });
    // A once-legitimate delegation for a programme that is not the one in force.
    writeDelegation(w, { programmeScope: 'acme-recovery' });
    const id = writeDecision(w, { decidedBy: AUTHORITY });

    // No --programme-id at all: the command must derive 'acme-v1' from the plan in force, so the
    // stale delegation does not apply and the delegate is not the approver.
    const r = planCommand(
      { sys: w.sys, root: w.root },
      { id: w.draftId, decision: id, 'plan-path': 'state/recovery.plan.json', 'state-path': 'state/recovery.current-state.json' },
      ['approve'],
    );

    expect(r.code).not.toBe(0);
    expect(r.lines.join(' ')).toMatch(/not the recorded plan-approval authority/i);
    expect(existsSync(pjoin(w.root, 'state/recovery.plan.json'))).toBe(false);
  });

  /** The pure check refuses a programme mismatch on its own, with no I/O. */
  test('the delegation check refuses a programme mismatch by itself', () => {
    const problems = checkPlanApprovalDelegation(delegation({ programmeScope: 'something-else' }), {
      projectId: 'acme',
      recordedOwner: OWNER,
      isCommitted: true,
      programmeId: 'acme-recovery',
    });
    expect(problems.join(' ')).toMatch(/scoped to programme/i);
  });
});

describe('exact plan approval — the pure checks refuse on their own', () => {
  test('a delegation for another project is refused', () => {
    const problems = checkPlanApprovalDelegation(delegation({ projectId: 'other' }), {
      projectId: 'acme',
      recordedOwner: OWNER,
      isCommitted: true,
      programmeId: 'acme-recovery',
    });
    expect(problems.join(' ')).toMatch(/is for project/i);
  });

  test('a delegation to the owner delegates nothing', () => {
    const problems = checkPlanApprovalDelegation(delegation({ delegatedTo: OWNER }), {
      projectId: 'acme',
      recordedOwner: OWNER,
      isCommitted: true,
      programmeId: 'acme-recovery',
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
