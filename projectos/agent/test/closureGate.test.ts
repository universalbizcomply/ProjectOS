/**
 * Deriving the required-validator facts — the layer where "a plan requires X" becomes a fact the
 * gate can refuse on.
 *
 * The pure predicate is proven in core (`closure-eligibility.test.ts`, V1–V12). What is proven HERE
 * is that the facts fed to it are DERIVED and not accepted:
 *
 *   - the required names come off the ACTIVE APPROVED PLAN's phase entry, never off the closure
 *     evidence record, which is written by whoever wants the closure;
 *   - the validator-run record is located BY the evidence subject commit, so aiming the gate at
 *     another subject reads a different file rather than reinterpreting this one;
 *   - the record's own `subjectHead` is compared with the filename instead of trusted;
 *   - every unreadable, malformed or mis-bound record yields a PROBLEM, so "no record" and "a record
 *     showing nothing" can never be mistaken for each other, and neither reads as satisfaction.
 */
import { describe, it, expect } from 'vitest';
import { evaluateG4, validationRecordPath } from '../src/closureGate.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { System } from '../src/system.js';

const ROOT = '/proj';
const SUBJECT = 'a'.repeat(40);
const OTHER = 'c'.repeat(40);
const PHASE = 'PROJECTOS-V3-RELIABILITY-HARDENING1A';

function planWith(requiredValidators: readonly string[]): Record<string, unknown> {
  return {
    projectId: 'projectos',
    planVersion: '1.3',
    phases: [{ phaseId: PHASE, requiredBrowserProof: false, requiredValidators }],
  };
}

function context(requiredValidators: readonly string[]): GovernedContext {
  return {
    config: {} as GovernedContext['config'],
    plan: planWith(requiredValidators),
    projectId: 'projectos',
    planPath: `${ROOT}/plan.json`,
    currentStatePath: null,
  };
}

/** A System whose git answers are all healthy, so only the record under test moves the verdict. */
function sys(files: Record<string, string>): System {
  return {
    cwd: () => ROOT,
    now: () => '2026-08-10T00:00:00Z',
    readText: (p: string) => files[p] ?? null,
    writeText: () => undefined,
    exists: (p: string) => p in files,
    listDir: (p: string) =>
      Object.keys(files)
        .filter((f) => f.startsWith(p + '/'))
        .map((f) => f.slice(p.length + 1))
        .filter((f) => !f.includes('/')),
    exec: (_cmd: string, args: readonly string[]) => {
      if (args.includes('rev-parse')) return { code: 0, stdout: SUBJECT, stderr: '' };
      if (args.includes('status')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('rev-list')) return { code: 0, stdout: '0\t0', stderr: '' };
      if (args.includes('merge-base')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('diff')) return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

const CLOSURE_EVIDENCE = JSON.stringify({
  phaseId: PHASE,
  evidenceSubjectHead: SUBJECT,
  validatorsPass: true,
  checksPass: true,
  reviewsComplete: true,
  unresolvedCriticalOrHigh: 0,
  headedProofPass: true,
});

function record(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    subjectHead: SUBJECT,
    generatedAt: '2026-08-10T00:00:00.000Z',
    workingTreeCleanAtRunStart: true,
    aggregatePassed: true,
    registeredModuleCount: 2,
    results: [
      { name: 'validate-all', passed: true, errorCount: 0 },
      { name: 'validate-zero-relay-continuity', passed: true, errorCount: 0 },
    ],
    ...over,
  });
}

function run(
  requiredValidators: readonly string[],
  extraFiles: Record<string, string> = {},
): ReturnType<typeof evaluateG4> {
  const files: Record<string, string> = {
    [`${ROOT}/.projectops/closure/${PHASE}.json`]: CLOSURE_EVIDENCE,
    ...extraFiles,
  };
  return evaluateG4(sys(files), ROOT, context(requiredValidators), PHASE, 'awaiting_closure', { ready: true, reasons: [] }, true, false);
}

describe('required-validator facts are derived, never accepted', () => {
  it('the record is located by the evidence subject commit', () => {
    expect(validationRecordPath(ROOT, SUBJECT)).toBe(`${ROOT}/.projectops/validation/${SUBJECT}.json`);
    expect(validationRecordPath(ROOT, OTHER)).not.toBe(validationRecordPath(ROOT, SUBJECT));
  });

  it('the required names come from the plan phase', () => {
    const { facts } = run(['validate-all', 'validate-zero-relay-continuity'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record(),
    });
    expect(facts.requiredValidators).toEqual(['validate-all', 'validate-zero-relay-continuity']);
    expect(facts.passingValidatorNames).toEqual(['validate-all', 'validate-zero-relay-continuity']);
    expect(facts.validationRecordProblems).toEqual([]);
  });

  it('a required list smuggled into the CLOSURE EVIDENCE is ignored', () => {
    // The closure evidence is authored by whoever wants the closure. If it could name the required
    // validators, the subject of the test could set its own exam.
    const evidence = JSON.stringify({
      phaseId: PHASE,
      evidenceSubjectHead: SUBJECT,
      validatorsPass: true,
      checksPass: true,
      reviewsComplete: true,
      unresolvedCriticalOrHigh: 0,
      headedProofPass: true,
      requiredValidators: [],
    });
    const { facts, verdict } = run(['validate-zero-relay-continuity'], {
      [`${ROOT}/.projectops/closure/${PHASE}.json`]: evidence,
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record({
        registeredModuleCount: 1,
        results: [{ name: 'validate-all', passed: true, errorCount: 0 }],
      }),
    });
    expect(facts.requiredValidators).toEqual(['validate-zero-relay-continuity']);
    expect(verdict.unmet.map((u) => u.code)).toContain('G4-17');
  });

  it('a missing record is a PROBLEM, not an empty pass list', () => {
    const { facts } = run(['validate-all']);
    expect(facts.passingValidatorNames).toEqual([]);
    expect(facts.validationRecordProblems.join(' ')).toContain('no validator-run record');
    expect(facts.validationRecordProblems.join(' ')).toContain('--record-evidence');
  });

  it('a record whose internal subject disagrees with its filename is refused', () => {
    const { facts, verdict } = run(['validate-all'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record({ subjectHead: OTHER }),
    });
    expect(facts.validationRecordProblems.join(' ')).toContain('not the evidence subject');
    expect(verdict.unmet.map((u) => u.code)).toContain('G4-17');
  });

  it('a dirty-tree record is refused even when every required name passed', () => {
    const { verdict } = run(['validate-all'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record({ workingTreeCleanAtRunStart: false }),
    });
    expect(verdict.unmet.find((u) => u.code === 'G4-17')?.detail).toContain('clean working tree');
  });

  it('malformed records are refused: bad JSON, wrong schema, no results, count mismatch, duplicates', () => {
    const cases: readonly [string, string, string][] = [
      ['not json', '{ not json', 'no validator-run record'],
      ['wrong schema', record({ schemaVersion: '2.0.0' }), 'schemaVersion'],
      ['no results array', record({ results: undefined }), 'no results array'],
      ['count mismatch', record({ registeredModuleCount: 5 }), '2 result(s) for 5'],
      [
        'duplicate name',
        record({
          results: [
            { name: 'validate-all', passed: true, errorCount: 0 },
            { name: 'validate-all', passed: true, errorCount: 0 },
          ],
        }),
        'more than once',
      ],
      [
        'passed is not boolean',
        record({
          registeredModuleCount: 1,
          results: [{ name: 'validate-all', passed: 'yes', errorCount: 0 }],
        }),
        "no boolean 'passed'",
      ],
    ];
    for (const [label, body, needle] of cases) {
      const { facts, verdict } = run(['validate-all'], {
        [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: body,
      });
      expect(facts.validationRecordProblems.join(' '), label).toContain(needle);
      expect(verdict.unmet.map((u) => u.code), label).toContain('G4-17');
    }
  });

  it('a validator recorded as FAILING never reaches the passing list', () => {
    const { facts, verdict } = run(['validate-zero-relay-continuity'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record({
        aggregatePassed: false,
        results: [
          { name: 'validate-all', passed: true, errorCount: 0 },
          { name: 'validate-zero-relay-continuity', passed: false, errorCount: 4 },
        ],
      }),
    });
    expect(facts.passingValidatorNames).toEqual(['validate-all']);
    expect(verdict.unmet.find((u) => u.code === 'G4-17')?.detail).toContain('validate-zero-relay-continuity');
  });

  it('a phase whose plan entry requires nothing is unaffected by the record being absent', () => {
    const { facts, verdict } = run([]);
    expect(facts.requiredValidators).toEqual([]);
    expect(verdict.unmet.map((u) => u.code)).not.toContain('G4-17');
  });

  it('with everything in place the gate is satisfied on G4-17', () => {
    const { verdict } = run(['validate-all', 'validate-zero-relay-continuity'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record(),
    });
    expect(verdict.satisfied).toContain('G4-17');
  });
});
