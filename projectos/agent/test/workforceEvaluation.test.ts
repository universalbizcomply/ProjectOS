/**
 * PROJECTOS-AGENT-WORKFORCE1A — the eligibility pipeline (criteria 27-31) and the committed registry's
 * fixture eligibility, reproduced by re-running the pipeline.
 */
import { describe, expect, it } from 'vitest';
import { fixtureSpecialist, type FixtureBehaviour } from '../src/workforce/engines.js';
import { EVALUATION_CHECKS, evaluateRole } from '../src/workforce/evaluation.js';
import { effectiveRole, findEntry } from '../src/workforce/registry.js';
import { fixtureText, PRIMARY, testGovernance } from './support/workforceWorld.js';

const gov = testGovernance();
const role = (id: string) => effectiveRole(findEntry(gov.registry, id)!, gov.config);

describe('the six checks run in order and a fixture engine built to fail each is rejected there', () => {
  const cases: [FixtureBehaviour, (typeof EVALUATION_CHECKS)[number]][] = [
    ['exceeds-grant', 'authority-restriction'],
    ['free-prose', 'structured-output'],
    ['hidden-reasoning', 'structured-output'],
    ['wrong-provenance', 'structured-output'],
    ['timeout', 'structured-output'],
    ['incompetent', 'task-competency'],
    ['injection-compliant', 'prompt-injection-resilience'],
    ['claims-approval', 'prompt-injection-resilience'],
    ['never-refuses', 'refusal-and-failure'],
  ];
  it.each(cases)('a %s engine is rejected at %s', (behaviour, check) => {
    const report = evaluateRole(role('minimal-change-engineer'), fixtureSpecialist(PRIMARY, behaviour), fixtureText('minimal-change-engineer'), gov.config);
    expect(report.status).toBe('ineligible');
    expect(report.failedAt).toBe(check);
    const idx = EVALUATION_CHECKS.indexOf(check);
    expect(report.checks.map((c) => c.name)).toEqual(EVALUATION_CHECKS.slice(0, idx + 1));
    expect(report.checks.slice(0, idx).every((c) => c.passed)).toBe(true);
  });

  it('fails schema first for a role with no ProjectOS configuration, before any engine runs', () => {
    const unconfigured = effectiveRole(findEntry(gov.registry, 'anthropologist')!, gov.config);
    const report = evaluateRole(unconfigured, fixtureSpecialist(PRIMARY), 'x', gov.config);
    expect(report.failedAt).toBe('schema');
    expect(report.checks).toHaveLength(1);
  });

  it('a competent engine passes all six — as FIXTURE eligibility only', () => {
    const report = evaluateRole(role('minimal-change-engineer'), fixtureSpecialist(PRIMARY), fixtureText('minimal-change-engineer'), gov.config);
    expect(report.status).toBe('fixture-eligible');
    expect(report.checks.map((c) => c.name)).toEqual([...EVALUATION_CHECKS]);
    expect(report.fixtureOnly).toBe(true);
  });

  it('higher-risk roles carry stronger checks', () => {
    const standard = evaluateRole(role('minimal-change-engineer'), fixtureSpecialist(PRIMARY), 'x', gov.config);
    const high = evaluateRole(role('application-security-engineer'), fixtureSpecialist(PRIMARY), 'x', gov.config);
    expect(high.riskTier).toBe('high');
    for (const name of ['authority-restriction', 'structured-output', 'task-competency', 'prompt-injection-resilience', 'refusal-and-failure'] as const) {
      const p = (r: typeof high) => r.checks.find((c) => c.name === name)!.probes;
      expect(p(high)).toBeGreaterThan(p(standard));
    }
  });
});

describe('the committed registry eligibility is what the pipeline produces', () => {
  it('every fixture-eligible entry passes the pipeline on every model it names; everything else is ineligible or restricted', () => {
    let eligible = 0;
    for (const entry of gov.registry.entries) {
      if (entry.eligibility.status !== 'fixture-eligible') {
        expect(gov.config.roles[entry.id]).toBeUndefined();
        continue;
      }
      eligible += 1;
      expect(gov.config.roles[entry.id]).toBeDefined();
      for (const model of entry.eligibility.models) {
        const report = evaluateRole(effectiveRole(entry, gov.config), fixtureSpecialist(model), fixtureText(entry.id), gov.config);
        expect(`${entry.id}@${model}:${report.status}`).toBe(`${entry.id}@${model}:fixture-eligible`);
      }
    }
    expect(eligible).toBe(Object.keys(gov.config.roles).length);
  });
});
