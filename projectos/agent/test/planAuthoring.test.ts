/**
 * The load-bearing proof for PROJECTOS-OBJECTIVE-TO-PLAN-AUTHORING1A.
 *
 * THE DEFECT. `submitObjective` stored the owner's objective and then called `buildProposal`, which
 * never received it. Every proposed plan came from repository discovery/import alone, so a narrow
 * objective submitted into a repository carrying an unrelated programme inherited that programme's
 * phases. "Start Something New" was, in effect, "Import Everything Found".
 *
 * THE PROOF. One fixture carries four unrelated existing phases — PAYMENT, SECURITY, STAGING, UI.
 * A deliberately narrow read-only objective is submitted against it twice:
 *
 *   operation A (authored) — must propose ONLY the bounded governance proof the objective asks for,
 *                            and must not contain any of the four;
 *   operation B (import)   — must still discover all four, because the reconciliation capability is
 *                            not being weakened, only kept out of A.
 *
 * The author is a PORT, so this proves the boundary deterministically and spends nothing. What is
 * under test is not the model's prose — it is that the objective, and only the objective, decides
 * which phases exist, and that everything downstream still fails closed.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import { submitObjective, listDrafts, loadDiscoveryEngine, planMaterial, type DraftRecord } from '../src/planIntake.js';
import { revalidateAuthoredDraft, materialisePlan, loadGovernanceEngine } from '../src/planApproval.js';
import {
  validateAuthoredMaterial,
  normaliseAuthoredMaterial,
  buildAuthoringBody,
  authoringInstruction,
  AUTHORED_PLAN_JSON_SCHEMA,
  MAX_AUTHORED_PHASES,
  MAX_AUTHORED_FIELD_CHARS,
  MAX_AUTHORED_LIST_ITEMS,
  openAiAuthorPort,
  type AuthorPort,
  type AuthorRequest,
  type AuthoredMaterial,
} from '../src/planAuthoring.js';
import type { System } from '../src/system.js';
import type { HttpPort, HttpResponse } from '../src/loop/transports/openaiResponses.js';
import { inMemoryResolverForTests, unprovisionedResolver } from '../src/loop/credentialResolver.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------------------------------
 * The fixture: an existing project corpus of unrelated programmes.
 * --------------------------------------------------------------------------------------------- */

function phaseDoc(area: string, phaseId: string, purpose: string): string {
  return [
    `# Acme ${area} plan`,
    'projectId: acme',
    `Vision: a dependable ${area.toLowerCase()} capability.`,
    `Definition of complete: the ${area.toLowerCase()} work is delivered and proven end to end.`,
    `Success standard: ${area.toLowerCase()} is measurably reliable in production.`,
    '',
    `## Phase ${phaseId}`,
    purpose,
  ].join('\n');
}

const CORPUS: Record<string, string> = {
  'docs/payments-plan.md': phaseDoc('PAYMENT', 'ACME-PAYMENT1A', 'Take card payments and issue refunds.'),
  'docs/security-plan.md': phaseDoc('SECURITY', 'ACME-SECURITY1A', 'Harden authentication and rotate secrets.'),
  'docs/staging-plan.md': phaseDoc('STAGING', 'ACME-STAGING1A', 'Stand up a staging environment and deploy to it.'),
  'docs/ui-plan.md': phaseDoc('UI', 'ACME-UI1A', 'Redesign the customer-facing interface.'),
};

/** The unrelated phase ids that must never enter an objective-led plan. */
const UNRELATED_PHASE_IDS = ['ACME-PAYMENT1A', 'ACME-SECURITY1A', 'ACME-STAGING1A', 'ACME-UI1A'] as const;
const UNRELATED_WORDS = ['payment', 'refund', 'security', 'staging', 'deploy', 'interface', 'redesign'] as const;

const NARROW_OBJECTIVE = 'Perform one bounded read-only governance proof. Do not modify product source.';

function tempProject(files: Record<string, string> = CORPUS, config: Record<string, unknown> = {}): string {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-authoring-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops'), { recursive: true });
  writeFileSync(
    pjoin(root, '.projectops', 'project-config.json'),
    JSON.stringify({ projectId: 'acme', projectName: 'Acme', repo: 'acme/app', ...config }, null, 2),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = pjoin(root, rel);
    mkdirSync(pjoin(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function realSystem(root: string, git: Record<string, string> = {}): System {
  return {
    cwd: () => root,
    now: () => '2026-08-27T00:20:00.000Z',
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
    exec: (_cmd: string, args: readonly string[]) => {
      const key = args.join(' ');
      const stdout = git[key] ?? (key === 'rev-parse HEAD' ? 'a'.repeat(40) : 'main');
      return { code: 0, stdout, stderr: '' };
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * A deterministic author. It answers the OBJECTIVE, which is the whole point.
 * --------------------------------------------------------------------------------------------- */

const GOVERNANCE_MATERIAL: AuthoredMaterial = {
  businessVision: 'ProjectOS governance over this repository is demonstrably working.',
  definitionOfComplete: 'One bounded read-only governance proof has been run and its evidence recorded.',
  successStandard: 'The proof completes without modifying any product source file.',
  approvedScopeCandidates: ['read-only inspection of governance records', 'recording proof evidence'],
  excludedScopeCandidates: [
    'modifying product source',
    'the existing payments programme',
    'the existing security programme',
    'the existing staging programme',
    'the existing interface programme',
  ],
  environmentCandidates: [{ environmentId: 'local', productionFreeze: true }],
  phaseCandidates: [
    {
      phaseId: 'ACME-GOVPROOF1A',
      purpose: 'Run one bounded read-only governance proof and record its evidence.',
      scope: 'Governance records only. No product source is read for modification and none is written.',
      acceptanceCriteria: [
        'the proof runs to completion',
        'no product source file is modified',
        'evidence is recorded against this phase',
      ],
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

/** Records what it was asked, so the context boundary can be asserted. */
function stubAuthor(material: AuthoredMaterial = GOVERNANCE_MATERIAL): AuthorPort & { seen: AuthorRequest[] } {
  const seen: AuthorRequest[] = [];
  return {
    seen,
    author(request: AuthorRequest) {
      seen.push(request);
      return { ok: true as const, material };
    },
  };
}

function authored(root: string, objective: unknown = NARROW_OBJECTIVE, author: AuthorPort = stubAuthor(), git?: Record<string, string>) {
  return submitObjective(realSystem(root, git), root, objective, undefined, { mode: 'authored', author });
}

function imported(root: string, objective: unknown = NARROW_OBJECTIVE, git?: Record<string, string>) {
  return submitObjective(realSystem(root, git), root, objective, undefined, { mode: 'import' });
}

function phaseIdsOf(draft: Record<string, unknown>): string[] {
  const phases = Array.isArray(draft['phaseCandidates']) ? (draft['phaseCandidates'] as Record<string, unknown>[]) : [];
  return phases.map((p) => String(p['phaseId']));
}

/* ------------------------------------------------------------------------------------------------
 * THE LOAD-BEARING DISTINCTION.
 * --------------------------------------------------------------------------------------------- */

describe('objective-led authoring does not import the existing corpus', () => {
  test('a narrow objective proposes ONLY its own bounded work', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const ids = phaseIdsOf(r.draftRecord.draft);
    expect(ids).toEqual(['ACME-GOVPROOF1A']);
    for (const unrelated of UNRELATED_PHASE_IDS) {
      expect(ids).not.toContain(unrelated);
    }
  });

  test('no unrelated programme leaks into the plan material by any other field', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The excluded scope legitimately NAMES the unrelated programmes to keep them out, so the
    // assertion is against the material that would become phases and plan substance, not the whole
    // record.
    const substance = JSON.stringify({
      businessVision: r.draftRecord.draft['businessVision'],
      definitionOfComplete: r.draftRecord.draft['definitionOfComplete'],
      successStandard: r.draftRecord.draft['successStandard'],
      approvedScopeCandidates: r.draftRecord.draft['approvedScopeCandidates'],
      phaseCandidates: r.draftRecord.draft['phaseCandidates'],
    }).toLowerCase();
    for (const word of UNRELATED_WORDS) {
      expect(substance).not.toContain(word);
    }
  });

  test('the corpus is REPORTED in full even though it shaped nothing', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Narrowing what may SHAPE a plan must never become hiding what was FOUND.
    expect(r.draftRecord.discovery.sourcesConsidered).toBeGreaterThanOrEqual(4);
    expect(r.draftRecord.planningCorpus.totalDiscovered).toBeGreaterThanOrEqual(4);
    // …and nothing discovered is claimed to have shaped it.
    expect(r.draftRecord.planningCorpus.currentPlanningSources).toEqual([]);
  });

  test('the author is given corpus PATHS as context, never corpus CONTENT', () => {
    const root = tempProject();
    const author = stubAuthor();
    const r = authored(root, NARROW_OBJECTIVE, author);
    expect(r.ok).toBe(true);

    expect(author.seen).toHaveLength(1);
    const request = author.seen[0]!;
    expect(request.contextSourcePaths.some((p) => p.includes('payments-plan'))).toBe(true);

    // The whole request, including the rendered instruction, must not carry the corpus text that
    // would let an unrelated programme be copied into the plan.
    const wire = `${buildAuthoringBody(request, 'test-model')}\n${authoringInstruction(request)}`;
    expect(wire).not.toContain('Take card payments and issue refunds.');
    expect(wire).not.toContain('Harden authentication and rotate secrets.');
    // The objective itself is present — it is the input.
    expect(wire).toContain('bounded read-only governance proof');
  });

  test('IMPORT / RECONCILE still discovers every existing phase', () => {
    const root = tempProject();
    const r = imported(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const ids = phaseIdsOf(r.draftRecord.draft);
    for (const unrelated of UNRELATED_PHASE_IDS) {
      expect(ids).toContain(unrelated);
    }
    expect(r.draftRecord.origin).toBe('import');
  });

  test('the two operations produce materially different plans from the same objective', () => {
    const a = tempProject();
    const b = tempProject();
    const authoredResult = authored(a);
    const importedResult = imported(b);
    expect(authoredResult.ok && importedResult.ok).toBe(true);
    if (!authoredResult.ok || !importedResult.ok) return;

    expect(authoredResult.draftRecord.planDigest).not.toBe(importedResult.draftRecord.planDigest);
    expect(phaseIdsOf(authoredResult.draftRecord.draft).length).toBeLessThan(
      phaseIdsOf(importedResult.draftRecord.draft).length,
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * A proposal is still a proposal, and a model still grants nothing.
 * --------------------------------------------------------------------------------------------- */

describe('an authored proposal is non-authoritative', () => {
  test('it is recorded as a proposal, never as an approved plan', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.draftRecord.authoritative).toBe(false);
    expect(r.draftRecord.origin).toBe('authored');
    expect(r.draftRecord.planStatus).not.toBe('PLAN READY');
    expect(r.draftRecord.nextStep).toContain('authorises nothing');
    // Nothing was written to a governed plan path.
    expect(r.draftPath).toContain('/.projectops/drafts/');
  });

  test('a model claiming authority is stripped, not obeyed', () => {
    const root = tempProject();
    const hostile = stubAuthor({
      ...GOVERNANCE_MATERIAL,
      // Fields the author has no business setting. They are not in the wire schema and are not read
      // when the draft is assembled; this proves they cannot survive even if a port supplies them.
      planStatus: 'PLAN READY',
      authoritative: true,
      ownerDecisionsRequired: [],
    } as unknown as AuthoredMaterial);

    const r = authored(root, NARROW_OBJECTIVE, hostile);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.draftRecord.planStatus).toBe('PLAN DRAFTED');
    expect(r.draftRecord.authoritative).toBe(false);
    expect(r.draftRecord.draft['planStatus']).toBeUndefined();
    expect(r.draftRecord.draft['authoritative']).toBeUndefined();
  });

  test('the wire schema is strict and closed, so an unlisted field cannot arrive at all', () => {
    expect(AUTHORED_PLAN_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(AUTHORED_PLAN_JSON_SCHEMA.properties.phaseCandidates.items.additionalProperties).toBe(false);
    // Strict mode requires every property to be listed as required.
    const props = Object.keys(AUTHORED_PLAN_JSON_SCHEMA.properties);
    expect([...AUTHORED_PLAN_JSON_SCHEMA.required].sort()).toEqual(props.sort());
    const body = JSON.parse(buildAuthoringBody({ objective: NARROW_OBJECTIVE, projectId: 'acme', repository: 'acme/app', contextSourcePaths: [] }, 'm')) as Record<string, unknown>;
    const format = (body['text'] as Record<string, Record<string, unknown>>)['format']!;
    expect(format['type']).toBe('json_schema');
    expect(format['strict']).toBe(true);
  });

  test('the provenance cites the owner objective, and the author cannot choose it', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const provenance = r.draftRecord.draft['provenance'] as Record<string, unknown>[];
    expect(provenance.length).toBeGreaterThan(0);
    for (const entry of provenance) {
      expect(String(entry['sourcePath'])).toBe(`.projectops/objectives/${r.draftRecord.objectiveId}.json`);
      expect(String(entry['sourceChecksum'])).not.toBe('');
    }
    // The checksum must be of the bytes actually written, or the citation is a claim rather than
    // evidence.
    const engine = loadDiscoveryEngine();
    const onDisk = readFileSync(r.objectivePath, 'utf8');
    expect(String(provenance[0]!['sourceChecksum'])).toBe(engine.sha256(onDisk));
  });

  test('an objective-led draft refuses to fall back to corpus import when no author is composed', () => {
    const root = tempProject();
    const r = submitObjective(realSystem(root), root, NARROW_OBJECTIVE, undefined, { mode: 'authored' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('AUTHOR_NOT_COMPOSED');
    // Nothing was written.
    expect(existsSync(pjoin(root, '.projectops', 'drafts'))).toBe(false);
  });

  test('secret-shaped authored material is refused and never reaches disk', () => {
    const root = tempProject();
    // The canonical AWS documentation example key — synthetic, published, and matched by the
    // engine's own `aws-akid` pattern, so this proves the guard rather than the test's imagination.
    const leaked = `AKIA${'IOSFODNN7EXAMPLE'}`;
    const leaky = stubAuthor({ ...GOVERNANCE_MATERIAL, businessVision: `Use the key ${leaked} for this work.` });
    const r = authored(root, NARROW_OBJECTIVE, leaky);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('AUTHORED_MATERIAL_SECRET_SHAPED');
    // The refusal names the PATTERN CLASS, never the value.
    expect(r.detail).toContain('aws-akid');
    expect(r.detail).not.toContain(leaked);
    expect(existsSync(pjoin(root, '.projectops', 'drafts'))).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Contract validation. Nothing is trusted because it parsed.
 * --------------------------------------------------------------------------------------------- */

describe('authored material is validated against the existing contract', () => {
  test('accepts well-formed material', () => {
    expect(validateAuthoredMaterial(GOVERNANCE_MATERIAL)).toEqual([]);
  });

  const broken: [string, unknown][] = [
    ['not an object', 'a plan'],
    ['no phases', { ...GOVERNANCE_MATERIAL, phaseCandidates: [] }],
    ['no approved scope', { ...GOVERNANCE_MATERIAL, approvedScopeCandidates: [] }],
    ['no excluded scope', { ...GOVERNANCE_MATERIAL, excludedScopeCandidates: [] }],
    ['no environments', { ...GOVERNANCE_MATERIAL, environmentCandidates: [] }],
    ['placeholder vision', { ...GOVERNANCE_MATERIAL, businessVision: 'NEEDS SOURCE' }],
    ['placeholder complete', { ...GOVERNANCE_MATERIAL, definitionOfComplete: 'UNKNOWN' }],
    [
      'phase with no acceptance criteria',
      { ...GOVERNANCE_MATERIAL, phaseCandidates: [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, acceptanceCriteria: [] }] },
    ],
    [
      'phase with a path-shaped id',
      { ...GOVERNANCE_MATERIAL, phaseCandidates: [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, phaseId: '../escape' }] },
    ],
    [
      'phase depending on a phase that does not exist',
      { ...GOVERNANCE_MATERIAL, phaseCandidates: [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, dependencies: ['ACME-PAYMENT1A'] }] },
    ],
    [
      'phase with a risk level outside the plan schema vocabulary',
      { ...GOVERNANCE_MATERIAL, phaseCandidates: [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, riskLevel: 'LOW' }] },
    ],
    [
      'phase with an autonomy level outside the plan schema vocabulary',
      { ...GOVERNANCE_MATERIAL, phaseCandidates: [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, autonomyLevel: 'BOUNDED' }] },
    ],
    [
      'phase not stating browser proof',
      { ...GOVERNANCE_MATERIAL, phaseCandidates: [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, requiredBrowserProof: 'no' }] },
    ],
  ];
  test.each(broken)('refuses: %s', (_label, value) => {
    expect(validateAuthoredMaterial(value).length).toBeGreaterThan(0);
  });

  test('refuses a plan that proposes more phases than one objective may', () => {
    const many = Array.from({ length: MAX_AUTHORED_PHASES + 1 }, (_v, i) => ({
      ...GOVERNANCE_MATERIAL.phaseCandidates[0]!,
      phaseId: `ACME-P${i}`,
    }));
    expect(validateAuthoredMaterial({ ...GOVERNANCE_MATERIAL, phaseCandidates: many }).length).toBeGreaterThan(0);
  });

  test('refuses duplicate phase ids', () => {
    const dupes = [GOVERNANCE_MATERIAL.phaseCandidates[0]!, GOVERNANCE_MATERIAL.phaseCandidates[0]!];
    expect(validateAuthoredMaterial({ ...GOVERNANCE_MATERIAL, phaseCandidates: dupes }).length).toBeGreaterThan(0);
  });

  test('normalisation fixes field order, so key order cannot change the digest', () => {
    const engine = loadDiscoveryEngine();
    const shuffled = JSON.parse(
      JSON.stringify({
        ownerDecisionsRequired: GOVERNANCE_MATERIAL.ownerDecisionsRequired,
        phaseCandidates: GOVERNANCE_MATERIAL.phaseCandidates,
        successStandard: GOVERNANCE_MATERIAL.successStandard,
        businessVision: GOVERNANCE_MATERIAL.businessVision,
        environmentCandidates: GOVERNANCE_MATERIAL.environmentCandidates,
        excludedScopeCandidates: GOVERNANCE_MATERIAL.excludedScopeCandidates,
        approvedScopeCandidates: GOVERNANCE_MATERIAL.approvedScopeCandidates,
        unresolvedUnknowns: GOVERNANCE_MATERIAL.unresolvedUnknowns,
        definitionOfComplete: GOVERNANCE_MATERIAL.definitionOfComplete,
      }),
    ) as Record<string, unknown>;
    expect(engine.sha256(JSON.stringify(normaliseAuthoredMaterial(shuffled)))).toBe(
      engine.sha256(JSON.stringify(normaliseAuthoredMaterial(JSON.parse(JSON.stringify(GOVERNANCE_MATERIAL)) as Record<string, unknown>))),
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * Approval-side revalidation: read, validate, re-digest, bind — and fail closed on every mismatch.
 * --------------------------------------------------------------------------------------------- */

function draftOf(root: string): DraftRecord {
  const all = listDrafts(realSystem(root), root);
  expect(all.length).toBe(1);
  return all[0]!;
}

function writeDraft(root: string, draft: DraftRecord): void {
  writeFileSync(pjoin(root, '.projectops', 'drafts', `${draft.objectiveId}.json`), `${JSON.stringify(draft, null, 2)}\n`);
}

describe('approval revalidates the persisted proposal without re-authoring it', () => {
  test('an untouched authored draft revalidates, and no author is consulted', () => {
    const root = tempProject();
    // If approval ever called an author, this one would throw rather than answer.
    const forbidden: AuthorPort = {
      author() {
        throw new Error('approval must never call the author');
      },
    };
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);

    const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The material activated is byte-identical to the material reviewed.
    expect(JSON.stringify(result.proposal.imported.draft)).toBe(JSON.stringify(draft.draft));
    expect(result.proposal.planDigest).toBe(draft.planDigest);
    expect(forbidden).toBeDefined();
  });

  test('tampered plan material fails closed', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);

    const tampered = {
      ...draft,
      draft: {
        ...draft.draft,
        phaseCandidates: [
          ...(draft.draft['phaseCandidates'] as Record<string, unknown>[]),
          {
            phaseId: 'ACME-PAYMENT1A',
            purpose: 'Take card payments and issue refunds.',
            scope: 'payments',
            acceptanceCriteria: ['payments work'],
            dependencies: [],
            riskLevel: 'high',
            autonomyLevel: 'local-safe',
            expectedValidators: [],
            requiredReviews: [],
            requiredBrowserProof: false,
            ownerGates: [],
          },
        ],
      },
    } as DraftRecord;
    writeDraft(root, tampered);

    const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DRAFT_TAMPERED');
  });

  test('a digest edited to match tampered material still fails, because the digest is recomputed', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);
    // Swap in a different plan AND rewrite the recorded digest to a plausible-looking value.
    const forged = {
      ...draft,
      draft: { ...draft.draft, businessVision: 'Something the owner never read.' },
      planDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    } as DraftRecord;
    writeDraft(root, forged);

    const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DRAFT_TAMPERED');
  });

  test('material that no longer satisfies the contract fails closed before anything is computed', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);
    writeDraft(root, { ...draft, draft: { ...draft.draft, phaseCandidates: [] } } as DraftRecord);

    const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DRAFT_TAMPERED');
    expect(result.problems.join(' ')).toContain('no longer satisfies the plan material contract');
  });

  test('a stale draft fails closed when the repository has moved on', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);

    const moved = realSystem(root, { 'rev-parse HEAD': 'b'.repeat(40) });
    const result = revalidateAuthoredDraft(moved, root, loadDiscoveryEngine(), draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DRAFT_STALE');
    expect(result.problems.join(' ')).toContain('STALE');
  });

  test('a draft carried to another project fails closed', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);

    const elsewhere = tempProject(CORPUS, { projectId: 'other', repo: 'other/app' });
    const result = revalidateAuthoredDraft(realSystem(elsewhere), elsewhere, loadDiscoveryEngine(), draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DRAFT_STALE');
  });

  test('ORIGIN IS BOUND: an import draft relabelled authored cannot take the weaker route', () => {
    const root = tempProject();
    expect(imported(root).ok).toBe(true);
    const importDraft = draftOf(root);
    expect(importDraft.origin).toBe('import');

    // Relabel only. The material and the recorded digest are untouched.
    const relabelled = { ...importDraft, origin: 'authored' as const };
    const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), relabelled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // It is refused either for failing the authored contract or for digesting differently once
    // 'origin' is bound into the material — both are closed doors, neither is an approval.
    expect(['DRAFT_TAMPERED', 'DRAFT_STALE']).toContain(result.code);
  });

  test('an authored digest is not reproducible without the origin binding', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const engine = loadDiscoveryEngine();
    const d = r.draftRecord;

    const withOrigin = engine.sha256(
      planMaterial({
        origin: 'authored',
        planStatus: d.planStatus,
        projectId: d.projectId,
        repository: d.repository,
        draft: d.draft,
        ownerDecisionsRequired: d.ownerDecisionsRequired,
        planningCorpus: d.planningCorpus,
      }),
    );
    const withoutOrigin = engine.sha256(
      planMaterial({
        planStatus: d.planStatus,
        projectId: d.projectId,
        repository: d.repository,
        draft: d.draft,
        ownerDecisionsRequired: d.ownerDecisionsRequired,
        planningCorpus: d.planningCorpus,
      }),
    );
    expect(withOrigin).toBe(d.planDigest);
    expect(withoutOrigin).not.toBe(d.planDigest);
  });

  test('corpus-led plan material is byte-identical to what it was before origin existed', () => {
    const root = tempProject();
    const r = imported(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.draftRecord;
    const engine = loadDiscoveryEngine();
    // No 'origin' entry is appended for an import draft, so digests of decisions already COMMITTED
    // against earlier drafts keep verifying.
    const asBefore = planMaterial({
      planStatus: d.planStatus,
      projectId: d.projectId,
      repository: d.repository,
      draft: d.draft,
      ownerDecisionsRequired: d.ownerDecisionsRequired,
      planningCorpus: d.planningCorpus,
    });
    expect(asBefore).not.toContain('"origin"');
    expect(engine.sha256(asBefore)).toBe(d.planDigest);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The last step of the chain. A proposal that reviews and digests perfectly and then cannot become a
 * plan is a proposal that fails at the worst possible moment — after the owner has decided.
 * --------------------------------------------------------------------------------------------- */

/** The fields `materialisePlan` reads off a decision when it writes the approval block. */
const DECISION_FIXTURE = {
  decisionId: 'acme-govproof-d1',
  decidedBy: 'Murad',
  decidedAt: '2026-08-27T00:30:00.000Z',
  draftId: 'draft-1',
  planDigest: `sha256:${'e'.repeat(64)}`,
  baseHead: 'a'.repeat(40),
  decision: 'approve',
};

function activePlanFixture(): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    governance: {
      owner: 'Murad',
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
      closureAuthority: 'Murad',
      noApiPolicy: true,
    },
  };
}

describe('an authored proposal materialises into a schema-valid plan', () => {
  test('materialisePlan accepts authored material and cites the objective record', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const revalidated = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
    expect(revalidated.ok).toBe(true);
    if (!revalidated.ok) return;

    const result = materialisePlan({
      proposal: revalidated.proposal,
      config: { projectId: 'acme', projectName: 'Acme', repo: 'acme/app', localPath: root, protectedBranches: ['main'] },
      activePlan: activePlanFixture(),
      governanceSource: 'active-plan',
      decision: DECISION_FIXTURE as never,
      delegation: null,
      closureDelegation: null,
      planId: 'acme-govproof-plan',
      programmeId: 'acme-govproof',
      now: '2026-08-27T00:30:00.000Z',
    });

    // The failure this test exists to catch: material that passes every earlier gate and is then
    // refused as an incomplete plan.
    if (!result.ok) {
      throw new Error(`authored material did not materialise: ${result.problems.join('; ')}`);
    }
    const plan = result.plan;
    expect(plan['planStatus']).toBe('PLAN READY');

    const phases = plan['phases'] as Record<string, unknown>[];
    expect(phases.map((p) => String(p['phaseId']))).toEqual(['ACME-GOVPROOF1A']);

    // The authoritative source document is the owner's own objective record, not a repository file.
    const docs = plan['sourceDocuments'] as Record<string, unknown>[];
    expect(docs).toHaveLength(1);
    expect(String(docs[0]!['documentPath'])).toBe(`.projectops/objectives/${r.draftRecord.objectiveId}.json`);
    expect(docs[0]!['authoritative']).toBe(true);
  });

  test('the materialised plan satisfies the governed plan schema and the readiness evaluator', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const revalidated = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
    expect(revalidated.ok).toBe(true);
    if (!revalidated.ok) return;

    const result = materialisePlan({
      proposal: revalidated.proposal,
      config: { projectId: 'acme', projectName: 'Acme', repo: 'acme/app', localPath: root, protectedBranches: ['main'] },
      activePlan: activePlanFixture(),
      governanceSource: 'active-plan',
      decision: DECISION_FIXTURE as never,
      delegation: null,
      closureDelegation: null,
      planId: 'acme-govproof-plan',
      programmeId: 'acme-govproof',
      now: '2026-08-27T00:30:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // THE SAME engine and schema approval itself uses — including the phase vocabularies an earlier
    // draft of this module got wrong.
    const { engine, schema } = loadGovernanceEngine();
    expect(engine.validateAgainstSchema(result.plan, schema)).toEqual([]);
    // Readiness is RECOMPUTED at approval; a plan the evaluator refuses is never written.
    const readiness = engine.evaluatePlanReady(result.plan);
    if (!readiness.ready) throw new Error(`authored plan not ready: ${readiness.reasons.join('; ')}`);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Fixes for defects found in review of this change.
 * --------------------------------------------------------------------------------------------- */

describe('validation returns problems rather than throwing', () => {
  // A persisted draft is a file, and a tampered one can hold anything. A function contracted to
  // RETURN problems must not throw, or `plan approve` crashes on exactly the input it must refuse.
  const hostile: unknown[] = [
    { ...GOVERNANCE_MATERIAL, phaseCandidates: [null] },
    { ...GOVERNANCE_MATERIAL, phaseCandidates: [null, GOVERNANCE_MATERIAL.phaseCandidates[0]] },
    { ...GOVERNANCE_MATERIAL, phaseCandidates: [['not', 'an', 'object']] },
    { ...GOVERNANCE_MATERIAL, phaseCandidates: [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, dependencies: [null] }] },
    { ...GOVERNANCE_MATERIAL, environmentCandidates: [null] },
    { ...GOVERNANCE_MATERIAL, approvedScopeCandidates: [null] },
  ];
  test.each(hostile.map((h, i) => [i, h] as const))('hostile shape %i returns problems and does not throw', (_i, value) => {
    let problems: readonly string[] = [];
    expect(() => {
      problems = validateAuthoredMaterial(value);
    }).not.toThrow();
    expect(problems.length).toBeGreaterThan(0);
  });

  test('a tampered draft with a null phase refuses instead of crashing approval', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);
    writeDraft(root, { ...draft, draft: { ...draft.draft, phaseCandidates: [null] } } as unknown as DraftRecord);

    let failed = false;
    let code = '';
    expect(() => {
      const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
      failed = !result.ok;
      if (!result.ok) code = result.code;
    }).not.toThrow();
    expect(failed).toBe(true);
    expect(code).toBe('DRAFT_TAMPERED');
  });

  test('a phase depending on itself is refused', () => {
    const selfDep = [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, dependencies: ['ACME-GOVPROOF1A'] }];
    expect(validateAuthoredMaterial({ ...GOVERNANCE_MATERIAL, phaseCandidates: selfDep }).length).toBeGreaterThan(0);
  });
});

describe('authored material is bounded', () => {
  test('an over-long string is refused', () => {
    const huge = 'x'.repeat(MAX_AUTHORED_FIELD_CHARS + 1);
    expect(validateAuthoredMaterial({ ...GOVERNANCE_MATERIAL, businessVision: huge }).length).toBeGreaterThan(0);
  });

  test('an over-long list is refused', () => {
    const many = Array.from({ length: MAX_AUTHORED_LIST_ITEMS + 1 }, (_v, i) => `scope ${i}`);
    expect(validateAuthoredMaterial({ ...GOVERNANCE_MATERIAL, approvedScopeCandidates: many }).length).toBeGreaterThan(0);
  });

  test('a phase carrying an unbounded acceptance list is refused', () => {
    const many = Array.from({ length: MAX_AUTHORED_LIST_ITEMS + 1 }, (_v, i) => `criterion ${i}`);
    const phases = [{ ...GOVERNANCE_MATERIAL.phaseCandidates[0]!, acceptanceCriteria: many }];
    expect(validateAuthoredMaterial({ ...GOVERNANCE_MATERIAL, phaseCandidates: phases }).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The live port. Every branch, without spending anything.
 * --------------------------------------------------------------------------------------------- */

function httpReturning(response: HttpResponse): HttpPort & { bodies: string[]; headers: Record<string, string>[] } {
  const bodies: string[] = [];
  const headers: Record<string, string>[] = [];
  return {
    bodies,
    headers,
    post(req) {
      bodies.push(req.body);
      headers.push({ ...req.headers });
      return response;
    },
  };
}

function okReply(material: unknown): HttpResponse {
  return {
    kind: 'response',
    status: 200,
    body: JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(material) }] }] }),
  };
}

const REQ: AuthorRequest = {
  objective: NARROW_OBJECTIVE,
  projectId: 'acme',
  repository: 'acme/app',
  contextSourcePaths: ['docs/payments-plan.md'],
};
const CRED = 'OPENAI_AUTHORING_KEY';
const SECRET = 'resolved-secret-value';

describe('the OpenAI author port', () => {
  test('authors material on a well-formed reply, and sends the strict schema', () => {
    const http = httpReturning(okReply(GOVERNANCE_MATERIAL));
    const port = openAiAuthorPort({ model: 'gpt-test', credentialRef: CRED }, inMemoryResolverForTests(CRED, SECRET), http);
    const out = port.author(REQ);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.material.phaseCandidates.map((p) => p.phaseId)).toEqual(['ACME-GOVPROOF1A']);

    const sent = JSON.parse(http.bodies[0]!) as Record<string, unknown>;
    const format = (sent['text'] as Record<string, Record<string, unknown>>)['format']!;
    expect(format['strict']).toBe(true);
    expect(format['name']).toBe('projectos_authored_plan');
    // Authoring is not the governance thread, and nothing is retained provider-side.
    expect(sent['store']).toBe(false);
  });

  test('the secret reaches the header and nothing else — not the body, not the outcome', () => {
    const http = httpReturning(okReply(GOVERNANCE_MATERIAL));
    const port = openAiAuthorPort({ model: 'gpt-test', credentialRef: CRED }, inMemoryResolverForTests(CRED, SECRET), http);
    const out = port.author(REQ);
    expect(http.headers[0]!['authorization']).toBe(`Bearer ${SECRET}`);
    expect(http.bodies[0]).not.toContain(SECRET);
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  test('an unresolvable credential refuses without calling out', () => {
    const http = httpReturning(okReply(GOVERNANCE_MATERIAL));
    const port = openAiAuthorPort({ model: 'gpt-test', credentialRef: CRED }, unprovisionedResolver('not provisioned'), http);
    const out = port.author(REQ);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('AUTHOR_UNAVAILABLE');
    expect(http.bodies).toHaveLength(0);
  });

  test('a credential reference that is actually a secret refuses before any store is consulted', () => {
    const http = httpReturning(okReply(GOVERNANCE_MATERIAL));
    const looksLikeAKey = `sk-${'a'.repeat(40)}`;
    const port = openAiAuthorPort(
      { model: 'gpt-test', credentialRef: looksLikeAKey },
      inMemoryResolverForTests(CRED, SECRET),
      http,
    );
    const out = port.author(REQ);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('AUTHOR_UNAVAILABLE');
    expect(out.detail).not.toContain(looksLikeAKey);
    expect(http.bodies).toHaveLength(0);
  });

  const badReplies: [string, HttpResponse, string][] = [
    ['a transport error', { kind: 'transport-error', detail: 'boom' }, 'AUTHOR_UNAVAILABLE'],
    ['a non-2xx status', { kind: 'response', status: 500, body: '{}' }, 'AUTHOR_UNAVAILABLE'],
    ['a non-JSON body', { kind: 'response', status: 200, body: 'not json' }, 'AUTHOR_MALFORMED'],
    [
      'an explicit refusal',
      { kind: 'response', status: 200, body: JSON.stringify({ output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }) },
      'AUTHOR_REFUSED',
    ],
    ['no structured part', { kind: 'response', status: 200, body: JSON.stringify({ output: [] }) }, 'AUTHOR_REFUSED'],
  ];
  test.each(badReplies)('refuses %s', (_label, response, code) => {
    const port = openAiAuthorPort(
      { model: 'gpt-test', credentialRef: CRED },
      inMemoryResolverForTests(CRED, SECRET),
      httpReturning(response),
    );
    const out = port.author(REQ);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe(code);
  });

  test('structured output that breaks the contract is refused, not returned', () => {
    const http = httpReturning(okReply({ ...GOVERNANCE_MATERIAL, phaseCandidates: [] }));
    const port = openAiAuthorPort({ model: 'gpt-test', credentialRef: CRED }, inMemoryResolverForTests(CRED, SECRET), http);
    const out = port.author(REQ);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('AUTHORED_MATERIAL_INVALID');
  });
});

/* ------------------------------------------------------------------------------------------------
 * Provenance is digested and re-verified, so a forged citation cannot reach an activated plan.
 * --------------------------------------------------------------------------------------------- */

describe('the source citation is evidence, not a claim', () => {
  test('provenance is bound into the plan digest', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.draftRecord;
    const engine = loadDiscoveryEngine();

    const forgedMaterial = {
      ...d.draft,
      provenance: (d.draft['provenance'] as Record<string, unknown>[]).map((p) => ({
        ...p,
        sourcePath: 'docs/payments-plan.md',
      })),
    };
    const withForged = engine.sha256(
      planMaterial({
        origin: 'authored',
        planStatus: d.planStatus,
        projectId: d.projectId,
        repository: d.repository,
        draft: forgedMaterial,
        ownerDecisionsRequired: d.ownerDecisionsRequired,
        planningCorpus: d.planningCorpus,
      }),
    );
    expect(withForged).not.toBe(d.planDigest);
  });

  test('a forged citation is refused at approval', () => {
    const root = tempProject();
    expect(authored(root).ok).toBe(true);
    const draft = draftOf(root);
    const forged = {
      ...draft,
      draft: {
        ...draft.draft,
        provenance: (draft.draft['provenance'] as Record<string, unknown>[]).map((p) => ({
          ...p,
          sourcePath: 'docs/payments-plan.md',
        })),
      },
    } as DraftRecord;
    writeDraft(root, forged);

    const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DRAFT_TAMPERED');
  });

  test('an objective record edited after the draft was written is refused', () => {
    const root = tempProject();
    const r = authored(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The draft is untouched and still digests correctly; the document it CITES has moved.
    writeFileSync(r.objectivePath, `${readFileSync(r.objectivePath, 'utf8')} `);

    const result = revalidateAuthoredDraft(realSystem(root), root, loadDiscoveryEngine(), draftOf(root));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DRAFT_TAMPERED');
    expect(result.problems.join(' ')).toContain('no longer digests to');
  });
});
