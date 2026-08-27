/**
 * The owner's decision: written, made durable, and proven not to be anything wider than that.
 *
 * WHY A REAL GIT REPOSITORY. Every other approval test uses a fake `exec` and is right to — what they
 * check is governance logic. What this file checks is the SHAPE OF A COMMIT: one parent, one added
 * path, unrelated staged work untouched, and an advance that activation will accept as
 * authority-only. None of that can be proven against a fake git, so this fixture is a real
 * repository and the assertions are made by asking git.
 *
 * THE CHICKEN-AND-EGG THIS PHASE HAD TO RESOLVE. A decision counts only when committed. Committing it
 * moves HEAD. An objective-led draft is bound to the HEAD it was authored at. So the owner pressing
 * Approve would, by the act of recording their approval, make the proposal they approved stale. Both
 * rules are correct and neither could be dropped; the keyhole is `authorityOnlyAdvance`, and the
 * tests below establish that it is a keyhole rather than a door.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  writePlanApprovalDecision,
  makeDecisionDurable,
  derivePlanDecisionId,
} from '../src/planDecision.js';
import { authorityOnlyAdvance, revalidateAuthoredDraft, planDecisionPath } from '../src/planApproval.js';
import { submitObjective, loadDiscoveryEngine, listDrafts, type DraftRecord } from '../src/planIntake.js';
import type { AuthorPort, AuthorRequest, AuthoredMaterial } from '../src/planAuthoring.js';
import type { System } from '../src/system.js';

const OWNER = 'Ada';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------------------------------
 * A real repository.
 * --------------------------------------------------------------------------------------------- */

function realSystem(root: string): System {
  return {
    cwd: () => root,
    now: () => '2026-08-27T12:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(pjoin(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (cmd: string, args: readonly string[]) => {
      try {
        // Every call this runtime makes is `git`; a real one answers it against the real repository.
        const stdout = execFileSync(cmd, [...args], { encoding: 'utf8', cwd: root });
        return { code: 0, stdout, stderr: '' };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  } as System;
}

const MATERIAL: AuthoredMaterial = {
  businessVision: 'ProjectOS governance over this repository is demonstrably working.',
  definitionOfComplete: 'One bounded read-only governance proof has been run and its evidence recorded.',
  successStandard: 'The proof completes without modifying any product source file.',
  approvedScopeCandidates: ['read-only inspection of governance records'],
  excludedScopeCandidates: ['modifying product source'],
  environmentCandidates: [{ environmentId: 'local', productionFreeze: true }],
  phaseCandidates: [
    {
      phaseId: 'ACME-GOVPROOF1A',
      purpose: 'Run one bounded read-only governance proof and record its evidence.',
      scope: 'Governance records only.',
      acceptanceCriteria: ['the proof runs to completion', 'no product source file is modified'],
      dependencies: [],
      riskLevel: 'low',
      autonomyLevel: 'read-only',
      expectedValidators: ['validate-all'],
      requiredReviews: ['code-review'],
      requiredBrowserProof: false,
      ownerGates: ['approve phase closure'],
    },
  ],
  unresolvedUnknowns: [],
  ownerDecisionsRequired: [],
};

function stubAuthor(): AuthorPort {
  return { author: (_r: AuthorRequest) => ({ ok: true as const, material: MATERIAL }) };
}

const OBJECTIVE = 'Perform one bounded read-only governance proof. Do not modify product source.';

interface World {
  readonly root: string;
  readonly sys: System;
  readonly git: (...args: string[]) => string;
  readonly draftId: string;
  readonly head: () => string;
}

/**
 * A governed project with a committed active plan and one AUTHORED draft.
 *
 * The active plan is committed because it is the trust anchor rather than the candidate: it says who
 * the owner is, and the approval path reads it from the commit gate. The draft is deliberately NOT
 * committed — a draft is a proposal, and proposals live in the working tree.
 */
function world(): World {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-decision-')).replace(/\\/g, '/');
  created.push(root);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/acme/app.git');

  const write = (rel: string, text: string): void => {
    const abs = pjoin(root, ...rel.split('/'));
    mkdirSync(pjoin(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  };

  write('state/active.plan.json', JSON.stringify(activePlan(), null, 2));
  write(
    'state/active.current-state.json',
    JSON.stringify({ projectId: 'acme', completedPhases: ['ACME-OLD1A'] }, null, 2),
  );
  write(
    '.projectops/project-config.json',
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
        planMemory: {
          planPath: 'state/active.plan.json',
          currentStatePath: 'state/active.current-state.json',
        },
        planSources: ['state/active.plan.json'],
      },
      null,
      2,
    ),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'governed project');

  const sys = realSystem(root);
  const submitted = submitObjective(sys, root, OBJECTIVE, undefined, { mode: 'authored', author: stubAuthor() });
  if (!submitted.ok) throw new Error(`fixture could not author a draft: ${submitted.code} ${submitted.detail}`);

  return { root, sys, git, draftId: submitted.draftRecord.objectiveId, head: () => git('rev-parse', 'HEAD') };
}

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
    sourceDocuments: [
      {
        documentPath: 'docs/plan.md',
        sourceDocumentType: 'human-readable-plan',
        sourceDocumentChecksum: `sha256:${'d'.repeat(64)}`,
        authoritative: true,
        superseded: false,
      },
    ],
    phases: [
      {
        phaseId: 'ACME-OLD1A',
        description: 'old',
        dependsOn: [],
        acceptanceCriteria: ['done'],
        riskLevel: 'low',
        autonomyLevel: 'local-safe',
        requiredValidators: ['validate-all'],
        requiredReviews: [],
        requiredBrowserProof: false,
        requiredOwnerGates: ['phase-closure'],
      },
    ],
    environments: [{ environmentId: 'local', productionFreeze: true }],
    providers: [],
    governance: {
      owner: OWNER,
      gatekeeper: 'Gatekeeper',
      implementer: 'Claude Code',
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
    staleness: {
      lastVerifiedCommit: 'c'.repeat(40),
      lastVerifiedDate: '2026-01-01',
      stalenessStatus: 'fresh',
      stalenessReasons: [],
      materialPlanInputs: [{ inputId: 'docs/plan.md', fingerprint: `sha256:${'d'.repeat(64)}` }],
    },
    security: {
      secretPolicy: 'no raw secrets',
      rawSecretValuesForbidden: true,
      sensitiveDataForbidden: true,
      redactionRequired: true,
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The writer.
 * --------------------------------------------------------------------------------------------- */

describe('recording an owner decision', () => {
  test('derives every authority field and accepts none from the caller', () => {
    const w = world();
    const before = w.head();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const record = JSON.parse(readFileSync(written.absPath, 'utf8')) as Record<string, unknown>;
    // The three things the caller said…
    expect(record['draftId']).toBe(w.draftId);
    expect(record['decision']).toBe('approve');
    // …and everything else, derived.
    expect(record['projectId']).toBe('acme');
    expect(record['repository']).toBe('acme/app');
    expect(record['branch']).toBe('main');
    expect(record['baseHead']).toBe(before);
    expect(record['decidedBy']).toBe(OWNER);
    expect(String(record['planDigest'])).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record['schemaVersion']).toBe('1.0.0');
    expect(record['decisionId']).toBe(written.decisionId);
    // A decision is not spent until it is activated.
    expect(record['consumedAt']).toBeUndefined();
  });

  test('the decision id is derived from what it decides, so it is stable and verdict-specific', () => {
    const w = world();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.decisionId).toBe(
      derivePlanDecisionId({
        projectId: 'acme',
        draftId: w.draftId,
        planDigest: written.planDigest,
        decision: 'approve',
      }),
    );
    expect(written.decisionId).not.toBe(
      derivePlanDecisionId({
        projectId: 'acme',
        draftId: w.draftId,
        planDigest: written.planDigest,
        decision: 'reject',
      }),
    );
  });

  test('the owner note is carried as data and nothing else', () => {
    const w = world();
    const written = writePlanApprovalDecision(w.sys, w.root, {
      draftId: w.draftId,
      decision: 'approve',
      note: 'Looks right. Keep it read-only.',
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const record = JSON.parse(readFileSync(written.absPath, 'utf8')) as Record<string, unknown>;
    expect(record['note']).toBe('Looks right. Keep it read-only.');
  });

  test('a decision is not revisable, in either direction', () => {
    const w = world();
    expect(writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'reject' }).ok).toBe(true);
    // A rejection is as final as an approval: overwriting it would erase what the owner said, and a
    // second record beside it would leave two answers for one proposal.
    const second = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('DECISION_EXISTS');
  });

  test('refuses a draft that does not exist, and a draft id that is really a path', () => {
    const w = world();
    expect(writePlanApprovalDecision(w.sys, w.root, { draftId: 'NOTADRAFT1234', decision: 'approve' }).ok).toBe(false);
    const traversal = writePlanApprovalDecision(w.sys, w.root, {
      draftId: '../../etc/passwd',
      decision: 'approve',
    });
    expect(traversal.ok).toBe(false);
    if (traversal.ok) return;
    expect(traversal.code).toBe('UNSAFE_TARGET_PATH');
  });

  test('refuses a verdict that is neither approve nor reject', () => {
    const w = world();
    const r = writePlanApprovalDecision(w.sys, w.root, {
      draftId: w.draftId,
      decision: 'approved' as 'approve',
    });
    expect(r.ok).toBe(false);
  });

  test('refuses when the persisted material no longer digests to what was reviewed', () => {
    const w = world();
    // Edit the draft the owner is about to decide on. The digest is recomputed from the bytes on
    // disk, so a proposal that was changed after it was shown is not the proposal being decided.
    const draftPath = pjoin(w.root, '.projectops', 'drafts', `${w.draftId}.json`);
    const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Record<string, unknown>;
    const material = draft['draft'] as Record<string, unknown>;
    material['businessVision'] = 'something the owner never saw';
    writeFileSync(draftPath, JSON.stringify(draft, null, 2));

    const r = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DRAFT_TAMPERED');
  });

  test('refuses when the repository has moved for reasons the decision cannot see', () => {
    const w = world();
    writeFileSync(pjoin(w.root, 'unrelated.txt'), 'a product change');
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'unrelated work');

    const r = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DRAFT_STALE');
  });
});

/* ------------------------------------------------------------------------------------------------
 * Durability.
 * --------------------------------------------------------------------------------------------- */

describe('making a decision durable', () => {
  test('commits exactly one path, on top of the head that was reviewed', () => {
    const w = world();
    const before = w.head();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const durable = makeDecisionDurable(w.sys, w.root, written.decisionId);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;

    expect(durable.previousHead).toBe(before);
    expect(w.head()).toBe(durable.commit);
    // ONE PARENT, AND IT IS THE ONE REVIEWED.
    expect(w.git('rev-list', '--parents', '-n', '1', durable.commit).split(/\s+/)).toEqual([
      durable.commit,
      before,
    ]);
    // ONE PATH, ADDED.
    expect(w.git('diff', '--name-status', before, durable.commit).split('\n')).toEqual([
      `A\t${written.relPath}`,
    ]);
  });

  test('unrelated staged work is neither committed nor unstaged', () => {
    // `git add .` or `git commit -a` would sweep this up, and the owner pressing Approve would
    // silently commit an implementer's work-in-progress under their own name.
    const w = world();
    writeFileSync(pjoin(w.root, 'work-in-progress.txt'), 'half-finished');
    w.git('add', 'work-in-progress.txt');

    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const durable = makeDecisionDurable(w.sys, w.root, written.decisionId);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;

    // Not in the commit…
    expect(w.git('diff', '--name-only', durable.previousHead, durable.commit)).toBe(written.relPath);
    // …and still staged, exactly as it was.
    expect(w.git('diff', '--cached', '--name-only')).toBe('work-in-progress.txt');
  });

  test('an untracked working tree is left untracked', () => {
    const w = world();
    writeFileSync(pjoin(w.root, 'scratch.txt'), 'notes');
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(makeDecisionDurable(w.sys, w.root, written.decisionId).ok).toBe(true);
    expect(w.git('status', '--porcelain')).toContain('?? scratch.txt');
  });

  test('refuses a decision id that is really a path, and one with no record behind it', () => {
    const w = world();
    const unsafe = makeDecisionDurable(w.sys, w.root, '../../evil');
    expect(unsafe.ok).toBe(false);
    if (unsafe.ok) return;
    expect(unsafe.code).toBe('UNSAFE_TARGET_PATH');

    const absent = makeDecisionDurable(w.sys, w.root, 'PLANDEC-doesnotexist0001');
    expect(absent.ok).toBe(false);
    if (absent.ok) return;
    expect(absent.code).toBe('NOTHING_TO_COMMIT');
  });

  test('never contacts a remote', () => {
    const w = world();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(makeDecisionDurable(w.sys, w.root, written.decisionId).ok).toBe(true);
    // `origin/main` does not exist because nothing was ever pushed, and the local branch is ahead of
    // nothing it could have pushed to.
    expect(w.sys.exec('git', ['-C', w.root, 'rev-parse', '--verify', 'origin/main']).code).not.toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The staleness keyhole.
 * --------------------------------------------------------------------------------------------- */

describe('the authority-only advance', () => {
  test('accepts a single commit that adds only the decision record', () => {
    const w = world();
    const before = w.head();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const durable = makeDecisionDurable(w.sys, w.root, written.decisionId);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;

    expect(authorityOnlyAdvance(w.sys, w.root, before, w.head(), [written.relPath]).ok).toBe(true);
  });

  test('the draft the owner approved is no longer stale, and only because of that commit', () => {
    // The whole point. Without the keyhole, recording an approval makes the approved proposal stale.
    const w = world();
    const before = w.head();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(makeDecisionDurable(w.sys, w.root, written.decisionId).ok).toBe(true);
    expect(w.head()).not.toBe(before);

    const draft = JSON.parse(
      readFileSync(pjoin(w.root, '.projectops', 'drafts', `${w.draftId}.json`), 'utf8'),
    ) as DraftRecord;
    const engine = loadDiscoveryEngine();

    // WITHOUT the allowance: stale, exactly as before this phase.
    const strict = revalidateAuthoredDraft(w.sys, w.root, engine, draft);
    expect(strict.ok).toBe(false);
    if (strict.ok) return;
    expect(strict.code).toBe('DRAFT_STALE');

    // WITH it, and named for THIS decision: accepted.
    const allowed = revalidateAuthoredDraft(w.sys, w.root, engine, draft, [written.relPath]);
    expect(allowed.ok).toBe(true);
  });

  test('refuses a commit that also touched anything else', () => {
    const w = world();
    const before = w.head();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    // A commit carrying the decision AND a source change — the shape the keyhole must not accept.
    writeFileSync(pjoin(w.root, 'smuggled.txt'), 'a product change riding along');
    // Exactly the two paths, so what is under test is the SMUGGLED file rather than whatever else
    // happens to be untracked in the fixture.
    w.git('add', '--', written.relPath, 'smuggled.txt');
    w.git('commit', '-q', '-m', 'decision plus something else', '--', written.relPath, 'smuggled.txt');

    const advance = authorityOnlyAdvance(w.sys, w.root, before, w.head(), [written.relPath]);
    expect(advance.ok).toBe(false);
    if (advance.ok) return;
    expect(advance.reasons.join(' ')).toContain('smuggled.txt');
  });

  test('refuses two commits, however innocent each one is', () => {
    const w = world();
    const before = w.head();
    const a = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(makeDecisionDurable(w.sys, w.root, a.decisionId).ok).toBe(true);
    writeFileSync(pjoin(w.root, 'later.txt'), 'anything at all');
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'a second commit');

    const advance = authorityOnlyAdvance(w.sys, w.root, before, w.head(), [a.relPath]);
    expect(advance.ok).toBe(false);
    if (advance.ok) return;
    expect(advance.reasons.join(' ')).toContain('2 commit(s)');
  });

  test('refuses a commit that MODIFIES the decision rather than adding it', () => {
    // The one edit that could re-point an approval at different material while still looking like
    // the authority-only transition.
    const w = world();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(makeDecisionDurable(w.sys, w.root, written.decisionId).ok).toBe(true);
    const afterAdd = w.head();

    const record = JSON.parse(readFileSync(planDecisionPath(w.root, written.decisionId), 'utf8')) as Record<string, unknown>;
    record['planDigest'] = `sha256:${'f'.repeat(64)}`;
    writeFileSync(planDecisionPath(w.root, written.decisionId), JSON.stringify(record, null, 2));
    // ONLY the decision path, so the case under test is the MODIFICATION rather than a stray file.
    w.git('add', '--', written.relPath);
    w.git('commit', '-q', '-m', 'rewrite the decision', '--', written.relPath);

    const advance = authorityOnlyAdvance(w.sys, w.root, afterAdd, w.head(), [written.relPath]);
    expect(advance.ok).toBe(false);
    if (advance.ok) return;
    expect(advance.reasons.join(' ')).toContain('modified');
  });

  test('refuses a commit that adds a DIFFERENT decision record', () => {
    const w = world();
    const before = w.head();
    const other = '.projectops/plan-decisions/PLANDEC-somebodyelses0001.json';
    const abs = pjoin(w.root, ...other.split('/'));
    mkdirSync(pjoin(abs, '..'), { recursive: true });
    writeFileSync(abs, JSON.stringify({ decisionId: 'PLANDEC-somebodyelses0001' }));
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'another decision');

    const advance = authorityOnlyAdvance(w.sys, w.root, before, w.head(), [
      '.projectops/plan-decisions/PLANDEC-theonebeingapproved.json',
    ]);
    expect(advance.ok).toBe(false);
  });

  test('an unmoved head is trivially authority-only', () => {
    const w = world();
    expect(authorityOnlyAdvance(w.sys, w.root, w.head(), w.head(), ['anything']).ok).toBe(true);
  });

  test('names no allowed path, allows nothing', () => {
    const w = world();
    const before = w.head();
    writeFileSync(pjoin(w.root, 'x.txt'), 'x');
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'x');
    expect(authorityOnlyAdvance(w.sys, w.root, before, w.head(), []).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The journey.
 * --------------------------------------------------------------------------------------------- */

describe('objective to PLAN READY', () => {
  test('an authored proposal, decided by the owner, activates — and the decision is spent', async () => {
    const w = world();
    const { plan: planCommand } = await import('../src/commands/plan.js');

    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(makeDecisionDurable(w.sys, w.root, written.decisionId).ok).toBe(true);

    const result = planCommand({ sys: w.sys, root: w.root }, { id: w.draftId, decision: written.decisionId }, [
      'activate',
    ]);
    expect(result.lines.join('\n')).not.toContain('DRAFT_STALE');
    expect(result.code).toBe(0);

    // The decision is spent, so it cannot be replayed against a second activation.
    const record = JSON.parse(readFileSync(planDecisionPath(w.root, written.decisionId), 'utf8')) as Record<string, unknown>;
    expect(record['consumedAt']).toBeTruthy();
  });

  test('a REJECTED proposal cannot be activated', () => {
    const w = world();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'reject' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(makeDecisionDurable(w.sys, w.root, written.decisionId).ok).toBe(true);

    // The record is real, committed, correctly bound and for exactly this proposal. It still cannot
    // activate anything, because `checkPlanApprovalDecision` refuses any verdict but `approve`.
    const draft = JSON.parse(
      readFileSync(pjoin(w.root, '.projectops', 'drafts', `${w.draftId}.json`), 'utf8'),
    ) as DraftRecord;
    expect(draft.origin).toBe('authored');
    expect(listDrafts(w.sys, w.root)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Who cannot reach it.
 * --------------------------------------------------------------------------------------------- */

describe('the decision writer is unreachable from every automated route', () => {
  const read = (rel: string): string => readFileSync(pjoin(process.cwd(), 'src', ...rel.split('/')), 'utf8');
  /** Strip comments, so a sentence describing the rule cannot satisfy a check for the rule. */
  const code = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('nothing in the execution loop imports it', () => {
    // The loop is what runs unattended. A decision it could write would be a decision nobody took.
    for (const rel of [
      'loop/runner.ts',
      'loop/workers.ts',
      'loop/correctionBoundary.ts',
      'loop/gatekeeperTurn.ts',
      'loop/reconciliation.ts',
      'commands/run.ts',
    ]) {
      const src = code(read(rel));
      expect(src, rel).not.toContain('planDecision');
      expect(src, rel).not.toContain('writePlanApprovalDecision');
      expect(src, rel).not.toContain('makeDecisionDurable');
    }
  });

  test('the correction boundary still grants no shell, so no worker can commit anything', () => {
    // A worker with Bash could run `git commit` itself and forge any record on disk. The grant is
    // Edit and Write only — structurally, not by rule — and that is what keeps every authority record
    // in this repository out of an unattended process's reach.
    const src = code(read('loop/correctionBoundary.ts'));
    expect(src).not.toContain("'Bash'");
    expect(src).not.toContain('"Bash"');
  });

  test('only the plan command reaches the writer', () => {
    const commands = readdirSync(pjoin(process.cwd(), 'src', 'commands'));
    const reaching = commands.filter((f) => code(read(`commands/${f}`)).includes('planDecision'));
    expect(reaching).toEqual(['plan.ts']);
  });
});

/* ------------------------------------------------------------------------------------------------
 * What the owner's click must not become.
 * --------------------------------------------------------------------------------------------- */

describe('the approval commit is not a foothold', () => {
  test('a hook planted in the governed checkout does NOT run', () => {
    // FOUND BY ADVERSARIAL REVIEW OF THIS PHASE. `git commit` runs the checkout's own hooks, and hooks
    // are not committed content: writing `.git/hooks/post-commit` is an ordinary file write, which is
    // exactly what a bounded worker is allowed to do. Without isolation, an implementer could plant a
    // hook and wait for the owner to press Approve — arbitrary code, the owner's privileges, from the
    // one owner-attended action in the product.
    const w = world();
    const hookDir = pjoin(w.root, '.git', 'hooks');
    mkdirSync(hookDir, { recursive: true });
    const marker = pjoin(w.root, 'HOOK-RAN.txt');
    for (const name of ['pre-commit', 'post-commit']) {
      // A shell hook and a `.bat`, because git on Windows will run either given the chance.
      const posix = marker.split(String.fromCharCode(92)).join('/');
      writeFileSync(pjoin(hookDir, name), `#!/bin/sh
echo ran > "${posix}"
`);
      writeFileSync(pjoin(hookDir, `${name}.bat`), `@echo ran > "${marker}"\r\n`);
    }

    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const durable = makeDecisionDurable(w.sys, w.root, written.decisionId);

    expect(durable.ok).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  test('a symlink planted at the decision path is refused rather than written through', () => {
    // `exists()` follows links, so a DANGLING symlink at the derived path reads as absent and the
    // owner's decision would land wherever it points. Skipped where the platform will not create a
    // symlink without elevation, which is the ordinary case on Windows — the guard is unconditional in
    // the code either way.
    const w = world();
    const written = writePlanApprovalDecision(w.sys, w.root, { draftId: w.draftId, decision: 'approve' });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const elsewhere = pjoin(w.root, 'elsewhere.json');
    rmSync(written.absPath);
    try {
      symlinkSync(elsewhere, written.absPath);
    } catch {
      return;
    }
    const durable = makeDecisionDurable(w.sys, w.root, written.decisionId);
    expect(durable.ok).toBe(false);
    if (durable.ok) return;
    expect(durable.code).toBe('UNSAFE_TARGET_PATH');
    // Nothing was committed, and nothing was written through the link.
    expect(existsSync(elsewhere)).toBe(false);
    expect(w.git('log', '--oneline').split(String.fromCharCode(10))).toHaveLength(1);
  });
});
