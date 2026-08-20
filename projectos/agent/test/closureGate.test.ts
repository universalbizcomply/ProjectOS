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
import { evaluateG4, programmeStateTailPaths, validationRecordPath } from '../src/closureGate.js';
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
    renameFile: () => true,
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
    schemaVersion: '1.1.0',
    subjectHead: SUBJECT,
    generatedAt: '2026-08-10T00:00:00.000Z',
    workingTreeCleanAtRunStart: true,
    aggregatePassed: true,
    aggregate: { name: 'validate-all', passed: true },
    registeredModuleCount: 2,
    // Module names only. `validate-all` is the AGGREGATE — it is nameable as a requirement but is
    // never one of the modules, and a record listing it as one is refused.
    results: [
      { name: 'validate-project-plan', passed: true, errorCount: 0 },
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
    // Modules first, then the aggregate command — both are names a plan may require.
    expect(facts.passingValidatorNames).toEqual([
      'validate-project-plan',
      'validate-zero-relay-continuity',
      'validate-all',
    ]);
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
        aggregate: { name: 'validate-all', passed: false },
        results: [
          { name: 'validate-project-plan', passed: true, errorCount: 0 },
          { name: 'validate-zero-relay-continuity', passed: false, errorCount: 4 },
        ],
      }),
    });
    expect(facts.passingValidatorNames).toEqual(['validate-project-plan']);
    expect(verdict.unmet.find((u) => u.code === 'G4-17')?.detail).toContain('validate-zero-relay-continuity');
  });

  it('a phase whose plan entry requires nothing is unaffected by the record being absent', () => {
    const { facts, verdict } = run([]);
    expect(facts.requiredValidators).toEqual([]);
    expect(verdict.unmet.map((u) => u.code)).not.toContain('G4-17');
  });

  it('the AGGREGATE command is a nameable requirement, and only when the whole suite passed', () => {
    // Plans require `validate-all`, which is the command that runs the modules and is deliberately
    // not one of them. The G4 gate found this by refusing a real closure whose plan required
    // `validate-all` and whose record could not name it.
    const { facts, verdict } = run(['validate-all'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record(),
    });
    expect(facts.passingValidatorNames).toContain('validate-all');
    expect(verdict.satisfied).toContain('G4-17');

    // A failing suite must not lend its name to a requirement.
    const failing = run(['validate-all'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record({
        aggregatePassed: false,
        aggregate: { name: 'validate-all', passed: false },
        results: [
          { name: 'validate-x', passed: true, errorCount: 0 },
          { name: 'validate-y', passed: false, errorCount: 2 },
        ],
      }),
    });
    expect(failing.facts.passingValidatorNames).not.toContain('validate-all');
    expect(failing.verdict.unmet.map((u) => u.code)).toContain('G4-17');

    // And a record whose aggregate contradicts its own summary is refused rather than believed.
    const lying = run(['validate-all'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record({ aggregate: { name: 'validate-all', passed: false } }),
    });
    expect(lying.facts.validationRecordProblems.join(' ')).toContain('contradicts aggregatePassed');
    expect(lying.verdict.unmet.map((u) => u.code)).toContain('G4-17');

    // A missing aggregate is a problem, not an absence to be shrugged at.
    const absent = run(['validate-all'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record({ aggregate: undefined }),
    });
    expect(absent.facts.validationRecordProblems.join(' ')).toContain('no aggregate command result');
  });

  it('with everything in place the gate is satisfied on G4-17', () => {
    const { verdict } = run(['validate-all', 'validate-zero-relay-continuity'], {
      [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: record(),
    });
    expect(verdict.satisfied).toContain('G4-17');
  });
});

/**
 * WHICH PROGRAMME'S STATE RECORD MAY MOVE IN A CLOSURE TAIL.
 *
 * The static list in core names V3's state record by filename, and the intent was always "the
 * programme's state record". The post-V3 recovery programme keeps its own, so its ordinary lifecycle
 * sync — the runtime writing down where it is — was classified SUBSTANTIVE and G4-12 refused a phase
 * that had done nothing wrong. The governed config declares the path; it is the only authority, and
 * nothing is inferred from the filename.
 *
 * Added after G4-12 blocked PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A at subject 4bb7c9c.
 */
describe('programmeStateTailPaths — the active programme, from the config alone', () => {
  const RECOVERY = 'projectos/state/projectos-recovery.current-state.json';

  function ctx(planMemory: unknown): GovernedContext {
    return {
      config: { planMemory } as GovernedContext['config'],
      plan: planWith(['validate-all']),
      projectId: 'projectos',
      planPath: `${ROOT}/plan.json`,
      currentStatePath: null,
    };
  }

  it('offers the configured current-state path', () => {
    expect(programmeStateTailPaths(ctx({ planPath: 'projectos/state/x.plan.json', currentStatePath: RECOVERY }))).toEqual([
      RECOVERY,
    ]);
  });

  it('offers nothing when no plan memory or no current-state is declared', () => {
    expect(programmeStateTailPaths(ctx(undefined))).toEqual([]);
    expect(programmeStateTailPaths(ctx({ planPath: 'projectos/state/x.plan.json' }))).toEqual([]);
    expect(programmeStateTailPaths(ctx({ currentStatePath: '   ' }))).toEqual([]);
  });

  /**
   * A config that could nominate the plan or itself would be a config that could launder its own
   * substantive changes. Both stay substantive however the config describes them.
   */
  it('REFUSES to nominate the active plan as tail', () => {
    expect(programmeStateTailPaths(ctx({ planPath: RECOVERY, currentStatePath: RECOVERY }))).toEqual([]);
    expect(programmeStateTailPaths(ctx({ currentStatePath: '.projectops/plan.json' }))).toEqual([]);
  });

  it('REFUSES to nominate the project config as tail', () => {
    expect(programmeStateTailPaths(ctx({ currentStatePath: '.projectops/project-config.json' }))).toEqual([]);
  });

  /**
   * The config decides WHICH state record, not what counts as one. Found in self-review of this fix:
   * the plan and config collisions were guarded, but a config naming a SOURCE file would have made
   * that file closure-tail — and source must stay substantive whatever the config says.
   */
  it('REFUSES to nominate anything outside the state directory', () => {
    for (const bad of [
      'projectos/agent/src/loop/runner.ts',
      'projectos/core/src/closureEligibility.ts',
      'projectos/validators/validate-all.cjs',
      'projectos/schemas/project-config.schema.json',
      '.projectops/closure/PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.json',
      'package.json',
      'projectos/state',
      'projectos/state/',
      'projectos/state/versions/projectos-v3.plan.v1.2-candidate.json',
      'projectos/statex/projectos-recovery.current-state.json',
      '../elsewhere/projectos-recovery.current-state.json',
    ]) {
      expect(programmeStateTailPaths(ctx({ currentStatePath: bad })), bad).toEqual([]);
    }
  });

  it('accepts a differently-named state record — the config is the authority, not the filename', () => {
    const other = 'projectos/state/some-future-programme.state.json';
    expect(programmeStateTailPaths(ctx({ currentStatePath: other }))).toEqual([other]);
  });

  /**
   * WHERE `plan activate` ACTUALLY WRITES. An activation puts the new programme's state record beside
   * the plan it activates, inside `.projectops/`, and repoints planMemory at it. Recognising only
   * `projectos/state/` meant a governed activation silently emptied this list, and an empty list makes
   * the programme's own lifecycle sync read as substantive. Every other bound still applies here:
   * nesting, the active plan and the config are refused inside `.projectops/` exactly as they are
   * inside `projectos/state/`.
   */
  it('accepts the state record a governed activation writes into .projectops/', () => {
    const activated = '.projectops/current-state-35316a7a7ad3acd6.json';
    expect(
      programmeStateTailPaths(ctx({ planPath: '.projectops/plan-35316a7a7ad3acd6.json', currentStatePath: activated })),
    ).toEqual([activated]);
  });

  it('applies every existing bound inside .projectops/ too', () => {
    const plan = '.projectops/plan-35316a7a7ad3acd6.json';
    for (const bad of [
      // the active plan, named as its own state record
      plan,
      // the config, which must never launder its own changes
      '.projectops/project-config.json',
      // nested: a governance record that is not the programme's state record
      '.projectops/closure/decisions/PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.json',
      '.projectops/plan-decisions/PROJECTOS-AUTONOMOUS-SELF-HOSTING-PLAN-APPROVAL-DECISION1D.json',
      // the directory itself, and a sibling directory that merely shares a prefix
      '.projectops/',
      '.projectopsx/current-state.json',
    ]) {
      expect(programmeStateTailPaths(ctx({ planPath: plan, currentStatePath: bad })), bad).toEqual([]);
    }
  });

  /**
   * DERIVED, NEVER NAMED. This used to assert the literal recovery state record, which made it a
   * claim about which programme happens to be active rather than about the function: the day a new
   * owner-approved programme became authoritative it failed, though nothing was wrong. What the
   * function promises is that the tail path comes from the CONFIG and from nowhere else, so the
   * expectation is read from the same config the runtime reads. It now survives any legitimate
   * programme change, and it still fails if the function invents, hardcodes or drops the path.
   */
  it('this repository’s own config decides its programme state record, whichever programme is active', () => {
    const real = JSON.parse(
      (require('node:fs') as typeof import('node:fs')).readFileSync(
        (require('node:path') as typeof import('node:path')).resolve(__dirname, '../../../.projectops/project-config.json'),
        'utf8',
      ),
    ) as { planMemory?: { currentStatePath?: unknown } };
    const declared = real.planMemory?.currentStatePath;
    // A repository that declares no current-state path would make the assertion vacuous.
    expect(typeof declared).toBe('string');
    expect(programmeStateTailPaths(ctx(real.planMemory))).toEqual([declared]);
  });
});
