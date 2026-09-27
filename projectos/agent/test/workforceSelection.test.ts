/**
 * PROJECTOS-AGENT-WORKFORCE1A — dynamic minimum-team selection (criteria 13-15, 31, 32).
 */
import { describe, expect, it } from 'vitest';
import { combineFacts, deriveRecordFacts, type TaskFacts } from '../src/workforce/facts.js';
import { selectTeam, type TeamSelection } from '../src/workforce/teamSelection.js';
import type { RiskFact, RiskLevel, TaskType, WorkforceGovernance } from '../src/workforce/types.js';
import { testGovernance } from './support/workforceWorld.js';

const gov = testGovernance();

function facts(taskType: TaskType, riskLevel: RiskLevel, riskFacts: RiskFact[] = []): TaskFacts {
  return { taskType, riskLevel, riskFacts, criticality: riskLevel, provenance: { fromRecords: [], leaderSupplied: [], omitted: [], refused: [] } };
}

function team(f: TaskFacts, g: WorkforceGovernance = gov): TeamSelection {
  const out = selectTeam(f, g);
  if (!out.ok) throw new Error(`refused: ${out.reasons.join('; ')}`);
  return out.team;
}

const roster = (t: TeamSelection): string[] => t.members.map((m) => `${m.roleId}:${m.assignment}`);

describe('the four representative task types', () => {
  it('bug fix: the minimal engineer, a supporting tester, no reviewer at low risk', () => {
    const t = team(facts('bug-fix', 'low'));
    expect(roster(t)).toEqual(['minimal-change-engineer:contribute', 'test-automation-engineer:contribute']);
    expect(t.independentReviewRequired).toBe(false);
    expect(t.members[0]?.reasons).toEqual(["mandatory for task type 'bug-fix'"]);
  });

  it('security-sensitive change: the declared fact forces the security role and an independent security reviewer', () => {
    const t = team(facts('security-sensitive-change', 'high', ['security']));
    expect(roster(t)).toEqual([
      'application-security-engineer:contribute',
      'test-automation-engineer:contribute',
      'security-architect:independent-review',
    ]);
    expect(t.members[0]?.reasons).toEqual(["mandatory for task type 'security-sensitive-change'", "required by declared fact 'security'"]);
    expect(t.members[2]?.reasons[0]).toMatch(/independent reviewer \(required by risk 'high', fact 'security'\)/);
  });

  it('user-interface change: browser proof becomes the ui fact; accessibility adds its auditor', () => {
    const record = deriveRecordFacts({ phaseId: 'UI-1', riskLevel: 'medium', requiredReviews: [], requiredBrowserProof: true }, gov.selectionPolicy);
    expect(record.riskFacts).toEqual(['ui']);
    expect(record.taskType).toBe('ui-change');
    const t = team(combineFacts(record, { taskType: 'ui-change', riskFacts: ['accessibility'] }, gov.selectionPolicy));
    expect(roster(t)).toEqual(['frontend-developer:contribute', 'accessibility-auditor:contribute', 'test-automation-engineer:contribute']);
  });

  it('multi-system feature: two mandatory roles, the supporting tester and a reviewer; a ui fact adds the frontend role and drops the tester to fit, with a reason', () => {
    expect(roster(team(facts('multi-system-feature', 'high')))).toEqual([
      'software-architect:contribute',
      'backend-architect:contribute',
      'test-automation-engineer:contribute',
      'reality-checker:independent-review',
    ]);
    const t = team(facts('multi-system-feature', 'high', ['ui']));
    expect(roster(t)).toEqual(['software-architect:contribute', 'backend-architect:contribute', 'frontend-developer:contribute', 'ui-finish-gate-reviewer:independent-review']);
    expect(t.reductions).toEqual(["supporting role 'test-automation-engineer' dropped: the team would exceed its bound of 4"]);
  });

  it('multi-system feature in a security-reviewed phase fits the bound (the realistic high-risk case)', () => {
    expect(roster(team(facts('multi-system-feature', 'high', ['security'])))).toEqual([
      'software-architect:contribute',
      'backend-architect:contribute',
      'application-security-engineer:contribute',
      'security-architect:independent-review',
    ]);
  });

  it('never runs the catalogue: every team is at most the bound, from 279 registered agents', () => {
    for (const tt of ['bug-fix', 'security-sensitive-change', 'ui-change', 'multi-system-feature'] as const) {
      for (const r of ['low', 'medium', 'high'] as const) {
        const out = selectTeam(facts(tt, r), gov);
        if (out.ok) expect(out.team.members.length).toBeLessThanOrEqual(gov.config.bounds.maxTeamSize);
      }
    }
    expect(gov.registry.entries.length).toBe(279);
  });
});

describe('determinism and rationale', () => {
  it('the same inputs always produce the same team and the same digests', () => {
    const f = facts('security-sensitive-change', 'high', ['security', 'auth']);
    const a = selectTeam(f, gov);
    const b = selectTeam(f, testGovernance());
    expect(a).toEqual(b);
  });

  it('a different policy version produces a different selection digest', () => {
    const f = facts('bug-fix', 'low');
    const other = testGovernance((d) => (d.selectionPolicy.policyVersion = '2'));
    expect(team(f).digests.selection).not.toBe(team(f, other).digests.selection);
  });
});

describe('facts: derived from records; the leader may only raise risk', () => {
  const record = deriveRecordFacts({ phaseId: 'P', riskLevel: 'high', requiredReviews: ['ECC SECURITY review'], requiredBrowserProof: false }, gov.selectionPolicy);

  it('derives the risk level and the security fact from the phase record', () => {
    expect(record.riskLevel).toBe('high');
    expect(record.riskFacts).toEqual(['security']);
    expect(deriveRecordFacts({ phaseId: 'P', riskLevel: 'unknown', requiredReviews: [], requiredBrowserProof: false }, gov.selectionPolicy).riskLevel).toBe('high');
    expect(record.taskType).toBe('security-sensitive-change');
  });

  it('refuses a lower risk level, records it, and keeps the record’s', () => {
    const f = combineFacts(record, { riskLevel: 'low' }, gov.selectionPolicy);
    expect(f.riskLevel).toBe('high');
    expect(f.provenance.refused.join()).toMatch(/may only raise risk/);
  });

  it('records omitted leader facts; the records set the task type, and the policy default applies only when no record does', () => {
    const f = combineFacts(record, {}, gov.selectionPolicy);
    expect(f.taskType).toBe('security-sensitive-change');
    expect(f.provenance.fromRecords).toContain('taskType=security-sensitive-change');
    expect(f.provenance.omitted).toEqual(['riskLevel', 'riskFacts']);
    const plain = deriveRecordFacts({ phaseId: 'P', riskLevel: 'low', requiredReviews: [], requiredBrowserProof: false }, gov.selectionPolicy);
    expect(combineFacts(plain, {}, gov.selectionPolicy).provenance.omitted).toContain("taskType (policy default 'bug-fix' applied)");
  });

  it('derives protected facts and the task type from the paths the records name; the leader cannot override a record-derived type', () => {
    const r = deriveRecordFacts({ phaseId: 'P', riskLevel: 'medium', requiredReviews: [], requiredBrowserProof: false, paths: ['src/payments/refund.ts', 'db/migrations/0042_add.sql', '.github/workflows/deploy.yml'] }, gov.selectionPolicy);
    expect(r.riskFacts).toEqual(['data', 'payment', 'production']);
    expect(r.taskType).toBe('security-sensitive-change');
    const f = combineFacts(r, { taskType: 'bug-fix' }, gov.selectionPolicy);
    expect(f.taskType).toBe('security-sensitive-change');
    expect(f.provenance.refused.join()).toMatch(/the records establish 'security-sensitive-change'/);
  });

  it('a leader-supplied fact can raise the team: payment forces its specialist and an independent reviewer', () => {
    const f = combineFacts(record, { taskType: 'security-sensitive-change', riskFacts: ['payment'] }, gov.selectionPolicy);
    expect(f.provenance.leaderSupplied).toEqual(['fact=payment']);
    const t = team(f);
    expect(roster(t)).toContain('payments-billing-engineer:contribute');
    expect(roster(t)).toContain('security-architect:independent-review');
  });

  it('refuses an unknown fact or task type rather than guessing', () => {
    const f = combineFacts(record, { taskType: 'deploy-everything', riskFacts: ['nothing-to-see'] }, gov.selectionPolicy);
    expect(f.provenance.refused).toHaveLength(2); // the record-derived type stands; the unknown fact is refused
  });
});

describe('eligibility and bounds are enforced by the function, not by the leader', () => {
  it('never selects an ineligible role: a mandatory one refuses the whole selection', () => {
    const g = testGovernance((d) => {
      const e = d.registry.entries.find((x: any) => x.id === 'minimal-change-engineer');
      e.eligibility = { status: 'ineligible', models: [], basis: 'failed evaluation' };
    });
    const out = selectTeam(facts('bug-fix', 'low'), g);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reasons.join()).toMatch(/mandatory role 'minimal-change-engineer' cannot serve: NOT_ELIGIBLE_FOR_MODEL/);
  });

  it('excludes an ineligible supporting role with a recorded reason — including a restricted agent', () => {
    const g = testGovernance((d) => {
      d.config.roles['chief-of-staff'] = { ...d.config.roles['minimal-change-engineer'] };
      d.selectionPolicy.taskTypes['bug-fix'].supportingRoles = ['chief-of-staff', 'test-automation-engineer'];
    });
    const t = team(facts('bug-fix', 'low'), g);
    expect(roster(t)).not.toContain('chief-of-staff:contribute');
    expect(t.excluded[0]?.roleId).toBe('chief-of-staff');
    expect(t.excluded[0]?.reason).toMatch(/NOT_ELIGIBLE_FOR_MODEL/);
  });

  it('excludes a role whose cost class exceeds the bound', () => {
    const g = testGovernance((d) => (d.config.roles['test-automation-engineer'].costClass = 'high'));
    const t = team(facts('bug-fix', 'low'), g);
    expect(t.excluded).toEqual([{ roleId: 'test-automation-engineer', reason: "cost class 'high' exceeds the bound 'standard'" }]);
  });

  it('escalates a task above the criticality bound instead of staffing it', () => {
    const out = selectTeam(facts('bug-fix', 'critical'), gov);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('CRITICALITY_ABOVE_BOUND');
  });

  it('refuses when the mandatory team alone exceeds the bound', () => {
    const g = testGovernance((d) => (d.selectionPolicy.taskTypes['bug-fix'].maxTeam = 1));
    const out = selectTeam(facts('bug-fix', 'high'), g);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reasons.join()).toMatch(/exceeds its bound of 1/);
  });

  it('never assigns a contributor as the independent reviewer', () => {
    const g = testGovernance((d) => (d.selectionPolicy.independentReview.reviewers.security = ['application-security-engineer', 'security-architect']));
    const t = team(facts('security-sensitive-change', 'high', ['security']), g);
    const reviewer = t.members.find((m) => m.assignment === 'independent-review');
    expect(reviewer?.roleId).toBe('security-architect');
  });
});
