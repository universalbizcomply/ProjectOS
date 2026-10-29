/**
 * D11 rules, pure — PROJECTOS-KERNEL-ROLE-REVIEW1A. The loop wiring is proven in `loopRunner.test.ts`
 * ("D11: role-separated independent review inside the loop") and certification in `loopOutcome.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  creditedReviews,
  independentReviews,
  isSelfReview,
  parseReviewerVerdict,
  planReviewProblems,
  reviewInstruction,
  reviewPassed,
  reviewerConfigPaths,
  reviewerRecordProblems,
  roleBindingProblems,
  verdictMarker,
  workerReviewable,
  type ReviewerRecord,
} from '../src/loop/reviewRoles.js';
import { materialisePlan } from '../src/planApproval.js';
import { argvGrants, toolGrantProblems, type AuthorisedWorker } from '../src/loop/workers.js';

const worker = (workerId: string, args: string[] = []): AuthorisedWorker => ({ workerId, kind: 'k', command: '/bin/w', args, timeoutMs: 1000 });
const NONCE = 'ab'.repeat(16);
const record = (over: Partial<ReviewerRecord> = {}): ReviewerRecord => ({
  schemaVersion: '1', sessionId: 's', phaseId: 'P', implementerWorkerId: 'impl', implementerKind: 'k', reviewerWorkerId: 'rev',
  reviewerKind: 'k', providerDistinct: false, baseHead: 'h', candidateDigest: 'd', nonce: NONCE,
  reviewsRequested: ['ECC CODE review'], reviewsPerformed: ['ECC CODE review'], verdict: 'APPROVE', findings: [], recordedAt: 't',
  ...over,
});
const SUBJECT = { sessionId: 's', phaseId: 'P', baseHead: 'h', candidateDigest: 'd', implementerWorkerId: 'impl' };

describe('R1 — what counts as a self-review', () => {
  it('recognises the names plans actually use', () => {
    expect(isSelfReview('Claude self-review')).toBe(true);
    expect(isSelfReview('worker self review')).toBe(true);
    expect(isSelfReview('ECC CODE review')).toBe(false);
    expect(isSelfReview('Owner review of readiness evidence')).toBe(false);
    expect(independentReviews(['Claude self-review', 'ECC SECURITY review'])).toEqual(['ECC SECURITY review']);
  });
});

describe('R1 + R2 — credit', () => {
  it("never credits an independent review from the implementer's own claim", () => {
    expect(creditedReviews(['Claude self-review', 'ECC CODE review'], ['Claude self-review', 'ECC CODE review'], null)).toEqual(['Claude self-review']);
  });
  it('credits an independent review only from the reviewer record', () => {
    expect(creditedReviews(['ECC CODE review'], [], record())).toEqual(['ECC CODE review']);
  });
  it('does not credit a review the reviewer claims but was never asked for', () => {
    expect(creditedReviews(['ECC SECURITY review'], [], record({ reviewsPerformed: ['ECC SECURITY review'] }))).toEqual([]);
  });
  it("does not let the reviewer satisfy the implementer's self-review", () => {
    const r = record({ reviewsRequested: ['Claude self-review'], reviewsPerformed: ['Claude self-review'] });
    expect(creditedReviews(['Claude self-review'], [], r)).toEqual([]);
  });
  it('credits nothing from a REJECT or from a review that found something CRITICAL or HIGH (ECC SECURITY H1)', () => {
    expect(reviewPassed(record({ verdict: 'REJECT' }))).toBe(false);
    expect(creditedReviews(['ECC CODE review'], [], record({ verdict: 'REJECT' }))).toEqual([]);
    const high = { id: 'reviewer:H', severity: 'HIGH' as const, category: 'c', summary: 's', resolved: false };
    expect(creditedReviews(['ECC CODE review'], [], record({ verdict: 'CONCERNS', findings: [high] }))).toEqual([]);
  });
  it('never credits a reviewer worker with an owner, gatekeeper or maintainer review (ECC SECURITY M4)', () => {
    const owner = 'Owner review of readiness evidence';
    expect(workerReviewable([owner, 'Gatekeeper contract review', 'maintainer sign-off', 'ECC CODE review'])).toEqual(['ECC CODE review']);
    expect(creditedReviews([owner], [], record({ reviewsRequested: [owner], reviewsPerformed: [owner] }))).toEqual([]);
  });
});

describe('R3 — role binding', () => {
  it('refuses a missing reviewer, the implementer as reviewer, and a reviewer with write grants', () => {
    expect(roleBindingProblems(worker('impl'), null).join()).toContain('no reviewer worker is configured');
    expect(roleBindingProblems(worker('impl'), worker('impl')).join()).toContain('is the implementer');
    const writer = worker('rev', ['--allowedTools', 'Write(.projectops/execution/*.findings.json)']);
    expect(roleBindingProblems(worker('impl'), writer).join()).toContain('holds non-read grants');
    expect(roleBindingProblems(worker('impl'), worker('rev', ['--allowedTools', 'Read']))).toEqual([]);
  });
  it('sees every grant form the CLI accepts: variadic, space-separated, repeated and bare (ECC M5, IAM F1)', () => {
    expect(argvGrants(['--allowedTools', 'Read', 'Bash', '--model', 'x', '--allowed-tools', 'Grep Edit'])).toEqual(['Read', 'Bash', 'Grep', 'Edit']);
    expect(roleBindingProblems(worker('impl'), worker('rev', ['--allowedTools', 'Read', 'Bash'])).join()).toContain('Bash');
    expect(toolGrantProblems(['--allowedTools', 'Read', 'Bash']).join()).toContain("tool grant 'Bash'");
    expect(toolGrantProblems(['--allowedTools', 'Write']).join()).toContain("tool grant 'Write'");
  });
  it('refuses the flags that remove permission checks, and the --flag=value grant form', () => {
    expect(toolGrantProblems(['--dangerously-skip-permissions']).join()).toContain('removes the permission checks');
    expect(toolGrantProblems(['--permission-mode', 'bypassPermissions']).join()).toContain('beyond its grants');
    expect(toolGrantProblems(['--allowedTools=Bash']).length).toBeGreaterThan(0);
    expect(toolGrantProblems(['--allowedTools', 'Write(.projectops/execution/*.findings.json)', '--setting-sources', 'project'])).toEqual([]);
  });
});

describe('H2 / F2 — what the reviewer is told and what it may be steered by', () => {
  it('frames the repository as untrusted and caps the path list', () => {
    const paths = Array.from({ length: 150 }, (_, i) => `f${i}.ts`);
    const text = reviewInstruction('b.json', SUBJECT, paths, ['ECC CODE review'], NONCE);
    expect(text).toContain('UNTRUSTED DATA WRITTEN BY THE IMPLEMENTER');
    expect(text).toContain('and 50 more');
    expect(text).not.toContain('f120.ts');
  });
  it('names a candidate that changes files the reviewer CLI loads as its own configuration', () => {
    expect(reviewerConfigPaths(['src/a.ts', '.claude/settings.json', 'docs/CLAUDE.md', '.mcp.json', 'AGENTS.md'])).toEqual([
      '.claude/settings.json', 'docs/CLAUDE.md', '.mcp.json', 'AGENTS.md',
    ]);
  });
});

describe('R4 — the verdict and the record are bound', () => {
  const line = (n: string, body: object) => `${verdictMarker(n)}${JSON.stringify(body)}`;
  it('reads the LAST marked line for this nonce and nothing else', () => {
    const text = [line(NONCE, { verdict: 'REJECT' }), 'thinking', line(NONCE, { verdict: 'APPROVE', reviews: ['ECC CODE review'] })].join('\n');
    const v = parseReviewerVerdict(text, NONCE);
    expect(v.ok && v.verdict).toBe('APPROVE');
    expect(parseReviewerVerdict(line('ff'.repeat(16), { verdict: 'APPROVE' }), NONCE).ok).toBe(false);
  });
  it('refuses an unknown verdict and severity, and never lets a reviewer mark its own finding resolved', () => {
    expect(parseReviewerVerdict(line(NONCE, { verdict: 'LGTM' }), NONCE).ok).toBe(false);
    expect(parseReviewerVerdict(line(NONCE, { verdict: 'APPROVE', findings: [{ severity: 'BLOCKER' }] }), NONCE).ok).toBe(false);
    const v = parseReviewerVerdict(line(NONCE, { verdict: 'CONCERNS', findings: [{ id: 'X', severity: 'LOW', resolved: true }] }), NONCE);
    expect(v.ok && v.findings[0]).toMatchObject({ id: 'reviewer:X', resolved: false });
  });
  it('refuses a record about other bytes, another nonce, or by the implementer', () => {
    expect(reviewerRecordProblems(record(), SUBJECT, NONCE)).toEqual([]);
    expect(reviewerRecordProblems(record({ candidateDigest: 'other' }), SUBJECT, NONCE).join()).toContain('different candidate bytes');
    expect(reviewerRecordProblems(record(), SUBJECT, 'cd'.repeat(16)).join()).toContain('nonce');
    expect(reviewerRecordProblems(record({ reviewerWorkerId: 'impl' }), SUBJECT, NONCE).join()).toContain('produced by the implementer');
  });
});

describe('R5 — at approval', () => {
  it('names a phase with only a self-review, or none', () => {
    expect(planReviewProblems('P1', ['Claude self-review']).join()).toContain('declares only Claude self-review');
    expect(planReviewProblems('P1', []).join()).toContain('declares no required review');
    expect(planReviewProblems('P1', ['Claude self-review', 'ECC CODE review'])).toEqual([]);
  });
  it('materialisePlan refuses a draft whose phase has only a worker self-review', () => {
    const r = materialisePlan({
      proposal: {
        imported: {
          draft: {
            phaseCandidates: [
              { phaseId: 'AGENCY1A', purpose: 'p', acceptanceCriteria: ['a'], riskLevel: 'low', autonomyLevel: 'x', requiredBrowserProof: false, requiredReviews: ['Claude self-review'] },
            ],
          },
        },
      },
      config: {},
      activePlan: { planVersion: '1.0', governance: {} },
      decision: { decidedAt: '2026-10-29T00:00:00Z' },
      delegation: null,
      planId: 'p',
      programmeId: 'g',
      now: '2026-10-29T00:00:00Z',
    } as unknown as Parameters<typeof materialisePlan>[0]);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.problems.join('\n')).toContain('phase AGENCY1A declares only Claude self-review');
  });
});
