/**
 * Required checks, evidence, and the decision that follows them.
 *
 * The ordering assertions are the point. Each one encodes a way an autonomous loop kills someone's
 * afternoon: a green run that touched production being carried forward; a security finding masked by
 * a failing test that gets retried first; a missing validator counted as a skip; a review nobody did
 * counted as passed.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { requiredChecks, runChecks, collectEvidence, redact, MAX_OUTPUT_CHARS, VALIDATOR_RUNNER } from '../src/loop/verification.js';
import {
  decideContinuation,
  blockingFindings,
  protectedEffects,
  MAX_CORRECTION_ATTEMPTS,
  PROTECTED_EFFECT_FIELDS,
  type EffectsRecord,
  type ReviewFinding,
} from '../src/loop/outcome.js';
import { buildWorkerBrief, type WorkerBrief } from '../src/loop/brief.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { RepositoryObservation } from '../src/loop/observation.js';
import type { System, ExecResult } from '../src/system.js';
import type { ProjectConfig } from '@projectos/core';

const ROOT = '/proj';
const BASE = 'd'.repeat(40);
const PHASE = 'PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A';

function realConfig(): ProjectConfig {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8'),
  ) as ProjectConfig;
}

function realPlan(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8'),
  ) as Record<string, unknown>;
}

const OBSERVED: RepositoryObservation = {
  root: ROOT,
  branch: 'projectos-recovery-phase4-prep',
  head: BASE,
  remote: 'universalbizcomply/ProjectOS',
  clean: true,
  dirtyPaths: [],
};

function context(planOverride: Record<string, unknown> = {}): GovernedContext {
  const config = realConfig();
  return {
    config,
    plan: { ...realPlan(), ...planOverride },
    projectId: config.projectId,
    planPath: 'projectos/state/projectos-recovery.plan.json',
    currentStatePath: null,
  };
}

/** Record paths the loop derives; addressing only, never instruction. */
const RECORDS = {
  briefPath: `${ROOT}/.projectops/execution/s1.brief.json`,
  findingsPath: `${ROOT}/.projectops/execution/s1.findings.json`,
  effectsPath: `${ROOT}/.projectops/execution/s1.effects.json`,
  evidencePath: `${ROOT}/.projectops/execution/s1.evidence.json`,
};

function brief(phaseId = PHASE, planOverride: Record<string, unknown> = {}): WorkerBrief {
  const r = buildWorkerBrief(context(planOverride), phaseId, OBSERVED, '2026-08-11T18:00:00Z', RECORDS);
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.brief;
}

interface SysOpts {
  readonly files?: readonly string[];
  readonly exec?: (cmd: string, args: readonly string[]) => ExecResult;
}

function fakeSystem(opts: SysOpts = {}) {
  const present = new Set(opts.files ?? []);
  const calls: { cmd: string; args: readonly string[] }[] = [];
  const sys: System & { calls: typeof calls } = {
    calls,
    cwd: () => ROOT,
    now: () => '2026-08-11T18:30:00Z',
    readText: () => null,
    writeText: () => undefined,
    exists: (p) => present.has(p),
    listDir: () => [],
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (cmd, args) => {
      calls.push({ cmd, args });
      return opts.exec === undefined ? { code: 0, stdout: '', stderr: '' } : opts.exec(cmd, args);
    },
  };
  return sys;
}

describe('requiredChecks', () => {
  it('takes the validator list from the approved plan, not from the loop', () => {
    const sys = fakeSystem({ files: [`${ROOT}/projectos/validators/validate-all.cjs`] });
    const checks = requiredChecks(sys, ROOT, brief());
    expect(checks.map((c) => c.id)).toEqual(brief().phase.requiredValidators);
    expect(checks[0].args).toEqual([`${ROOT}/projectos/validators/validate-all.cjs`]);
    expect(checks[0].unrunnable).toBeNull();
  });

  it('adds the project’s own suites after the plan’s validators, and never instead of them', () => {
    const sys = fakeSystem({ files: [`${ROOT}/projectos/validators/validate-all.cjs`] });
    const checks = requiredChecks(sys, ROOT, brief(), [
      { id: 'agent-tests', kind: 'test', command: 'C:/Program Files/nodejs/npm.cmd', args: ['test'] },
    ]);
    expect(checks.map((c) => `${c.kind}:${c.id}`)).toEqual(['validator:validate-all', 'test:agent-tests']);
  });

  it('a configured check with a bare command cannot run, and so has not passed', () => {
    const sys = fakeSystem({ files: [`${ROOT}/projectos/validators/validate-all.cjs`] });
    const specs = requiredChecks(sys, ROOT, brief(), [{ id: 'agent-tests', kind: 'test', command: 'npm', args: ['test'] }]);
    const results = runChecks(sys, ROOT, specs);
    expect(results[1].passed).toBe(false);
    expect(results[1].output).toContain('not an absolute path');
    // Only the validator was executed; the unsafe command never reached a spawn.
    expect(sys.calls).toHaveLength(1);
  });

  /**
   * `requiredValidators` is a plain array of strings in a FILE the worker this loop spawns can write
   * to, and the plan schema constrains it no further. `../../../../payload` resolves out of the
   * validators directory at the syscall boundary, and its exit code would be recorded as a required
   * validator that passed. Security review, HIGH.
   */
  it('refuses to turn a traversing validator name into a path', () => {
    const phases = (realPlan()['phases'] as Record<string, unknown>[]).map((p) =>
      p['phaseId'] === PHASE ? { ...p, requiredValidators: ['../../../../tmp/payload'] } : p,
    );
    const sys = fakeSystem({ files: [] });
    const specs = requiredChecks(sys, ROOT, brief(PHASE, { phases }));
    expect(specs[0].unrunnable).toContain('not a plain validator name');
    const results = runChecks(sys, ROOT, specs);
    expect(results[0].passed).toBe(false);
    expect(sys.calls).toHaveLength(0);
  });

  it('refuses a validator name carrying a separator or a dot segment', () => {
    const sys = fakeSystem({ files: [] });
    for (const name of ['a/b', 'a\\b', '..', 'valid.name', '']) {
      const phases = (realPlan()['phases'] as Record<string, unknown>[]).map((p) =>
        p['phaseId'] === PHASE ? { ...p, requiredValidators: [name] } : p,
      );
      const specs = requiredChecks(sys, ROOT, brief(PHASE, { phases }));
      expect(specs[0].unrunnable, name).toContain('not a plain validator name');
    }
  });

  it('a validator the plan names but the repository lacks FAILS — it is never a skip', () => {
    const sys = fakeSystem({ files: [] });
    const results = runChecks(sys, ROOT, requiredChecks(sys, ROOT, brief()));
    expect(results.every((r) => !r.passed)).toBe(true);
    expect(results[0].output).toContain('does not exist');
    // Nothing was executed, so a missing validator cannot be mistaken for one that ran.
    expect(sys.calls).toHaveLength(0);
  });
});

describe('runChecks', () => {
  const script = `${ROOT}/projectos/validators/validate-all.cjs`;

  it('passes on exit code 0 and runs the resolved script through an ABSOLUTE node', () => {
    const sys = fakeSystem({ files: [script], exec: () => ({ code: 0, stdout: '127 PASS', stderr: '' }) });
    const results = runChecks(sys, ROOT, requiredChecks(sys, ROOT, brief()));
    expect(results[0].passed).toBe(true);
    expect(sys.calls[0]).toEqual({ cmd: VALIDATOR_RUNNER, args: [script] });
  });

  /**
   * A bare `node` would resolve against the governed checkout before PATH on Windows, letting a
   * `node.exe` committed to a repository decide whether that repository's validators passed.
   */
  it('never spawns a bare command name to run a validator', () => {
    const sys = fakeSystem({ files: [script], exec: () => ({ code: 0, stdout: '', stderr: '' }) });
    runChecks(sys, ROOT, requiredChecks(sys, ROOT, brief()));
    expect(sys.calls[0].cmd).not.toBe('node');
    expect(/^([A-Za-z]:[\\/]|\/)/.test(sys.calls[0].cmd)).toBe(true);
  });

  it('fails on any non-zero exit and keeps the output', () => {
    const sys = fakeSystem({ files: [script], exec: () => ({ code: 1, stdout: 'FAIL x', stderr: 'boom' }) });
    const results = runChecks(sys, ROOT, requiredChecks(sys, ROOT, brief()));
    expect(results[0].passed).toBe(false);
    expect(results[0].output).toContain('FAIL x');
    expect(results[0].output).toContain('boom');
  });

  it('redacts credential-shaped output before it reaches the durable evidence record', () => {
    const sys = fakeSystem({
      files: [script],
      exec: () => ({ code: 1, stdout: 'ANTHROPIC_API_KEY=sk-ant-live-abc123\nplain line', stderr: 'token: hunter2' }),
    });
    const results = runChecks(sys, ROOT, requiredChecks(sys, ROOT, brief()));
    expect(results[0].output).not.toContain('sk-ant-live-abc123');
    expect(results[0].output).not.toContain('hunter2');
    expect(results[0].output).toContain('<redacted>');
    expect(results[0].output).toContain('plain line');
  });

  it('redact leaves ordinary output alone', () => {
    expect(redact('42 modules, 42 PASS, 0 FAIL')).toBe('42 modules, 42 PASS, 0 FAIL');
  });

  it('bounds the output it keeps rather than swallowing a huge log', () => {
    const sys = fakeSystem({
      files: [script],
      exec: () => ({ code: 1, stdout: 'y'.repeat(MAX_OUTPUT_CHARS * 2), stderr: '' }),
    });
    const results = runChecks(sys, ROOT, requiredChecks(sys, ROOT, brief()));
    expect(results[0].output.length).toBeLessThan(MAX_OUTPUT_CHARS + 200);
    expect(results[0].output).toContain('truncated');
  });
});

describe('collectEvidence', () => {
  function gitSystem(map: Readonly<Record<string, ExecResult>>) {
    return fakeSystem({
      exec: (_cmd, args) => {
        const key = args.join(' ');
        for (const [k, v] of Object.entries(map)) if (key.includes(k)) return v;
        return { code: 1, stdout: '', stderr: `unexpected: ${key}` };
      },
    });
  }

  it('measures change from the commit the brief was bound to, not from HEAD', () => {
    const sys = gitSystem({
      'rev-parse HEAD': { code: 0, stdout: `${'e'.repeat(40)}\n`, stderr: '' },
      [`diff --name-only ${BASE}..HEAD`]: { code: 0, stdout: 'src/a.ts\nsrc/b.ts\n', stderr: '' },
      'status --porcelain': { code: 0, stdout: ' M src/c.ts\n', stderr: '' },
      'diff --stat': { code: 0, stdout: ' 3 files changed\n', stderr: '' },
    });
    const ev = collectEvidence(sys, ROOT, { sessionId: 's1', brief: brief(), checks: [] });
    expect(ev.baseHead).toBe(BASE);
    expect(ev.currentHead).toBe('e'.repeat(40));
    expect(ev.changedFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(ev.diffStat).toContain('3 files changed');
  });

  it('says so when the diff cannot be read instead of reporting no change', () => {
    const sys = gitSystem({ 'rev-parse HEAD': { code: 0, stdout: `${'e'.repeat(40)}\n`, stderr: '' } });
    const ev = collectEvidence(sys, ROOT, { sessionId: 's1', brief: brief(), checks: [] });
    expect(ev.diffStat).toContain('could not be read');
  });

  it('records the reviews the plan requires without claiming they ran', () => {
    const sys = gitSystem({ 'rev-parse HEAD': { code: 0, stdout: `${BASE}\n`, stderr: '' } });
    const ev = collectEvidence(sys, ROOT, { sessionId: 's1', brief: brief(), checks: [] });
    expect(ev.requiredReviews).toEqual(brief().phase.requiredReviews);
  });
});

/* ------------------------------------------------------------------------------------------- */

const PASS = { id: 'validate-all', kind: 'validator' as const, passed: true, exitCode: 0, output: '', at: 'now' };
const FAIL = { ...PASS, passed: false, exitCode: 1, output: 'FAIL' };

function finding(severity: ReviewFinding['severity'], resolved = false): ReviewFinding {
  return { id: `F-${severity}`, severity, category: 'correctness', summary: 'a thing', resolved };
}

/** A complete attestation: all six effects stated, all false. Nothing less is an attestation. */
function attested(over: Partial<EffectsRecord> = {}): EffectsRecord {
  return {
    productionTouched: false,
    deploymentOccurred: false,
    databaseMutationOccurred: false,
    externalSendOccurred: false,
    paymentOccurred: false,
    rawSecretStored: false,
    ...over,
  };
}

/**
 * Everything green: checks pass, both required reviews recorded, and an effects attestation that
 * says nothing protected happened. `effects: {}` is an ATTESTATION; `effects: null` is silence, and
 * the two are deliberately not the same thing.
 */
function greenInput(over: Partial<Parameters<typeof decideContinuation>[0]> = {}) {
  const b = brief();
  return {
    brief: b,
    checks: [PASS],
    findings: [] as ReviewFinding[],
    effects: attested() as EffectsRecord | null,
    reviewsRecorded: [...b.phase.requiredReviews],
    attemptsSpent: 0,
    ...over,
  };
}

describe('decideContinuation', () => {
  /**
   * The first cut of this module read an ABSENT attestation as "no protected effect occurred", which
   * made the PROTECTED_EFFECT branch below unreachable on every real run — nothing had written the
   * record yet. Found by security review as CRITICAL.
   */
  it('stops when the run attested nothing — absence is not innocence', () => {
    const d = decideContinuation(greenInput({ effects: null }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('EFFECTS_NOT_ATTESTED');
  });

  it('an unattested run cannot reach the owner gate however green it is', () => {
    const d = decideContinuation(greenInput({ effects: null, checks: [PASS] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).not.toBe('OWNER_GATE');
  });

  it('but an unattested run with a failing check is still ORDINARY WORK, and is sent back', () => {
    // Attestation is a condition of certification, not of correction. Demanding it before a retry
    // would make every ordinary defect look like a governance stop.
    const d = decideContinuation(greenInput({ effects: null, checks: [FAIL] }));
    expect(d.kind).toBe('retry');
  });

  it('a concrete HIGH finding is reported ahead of a missing attestation', () => {
    const d = decideContinuation(greenInput({ effects: null, findings: [finding('HIGH')] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('UNRESOLVED_CRITICAL_OR_HIGH');
  });

  it('retries an ordinary failing check rather than stopping', () => {
    const d = decideContinuation(greenInput({ checks: [FAIL] }));
    expect(d.kind).toBe('retry');
    if (d.kind === 'retry') expect(d.attempt).toBe(1);
  });

  it('sends unresolved LOW and MEDIUM findings back as work, not on to the owner', () => {
    const d = decideContinuation(greenInput({ findings: [finding('LOW'), finding('MEDIUM')] }));
    expect(d.kind).toBe('retry');
    if (d.kind === 'retry') {
      expect(d.attempt).toBe(1);
      expect(d.detail).toContain('MEDIUM');
      expect(d.detail).toContain('LOW');
    }
  });

  it('corrects a MEDIUM finding even when every check passed', () => {
    const d = decideContinuation(greenInput({ checks: [PASS], findings: [finding('MEDIUM')] }));
    expect(d.kind).toBe('retry');
  });

  it('stops once LOW/MEDIUM findings resist correction to the bound', () => {
    const d = decideContinuation(greenInput({ findings: [finding('LOW')], attemptsSpent: MAX_CORRECTION_ATTEMPTS }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') {
      expect(d.reason.code).toBe('CORRECTION_EXHAUSTED');
      expect(d.reason.detail).toContain('LOW');
    }
  });

  it('reports a failing check and an unresolved finding together when both are outstanding', () => {
    const d = decideContinuation(greenInput({ checks: [FAIL], findings: [finding('MEDIUM')] }));
    expect(d.kind).toBe('retry');
    if (d.kind === 'retry') {
      expect(d.detail).toContain('validate-all');
      expect(d.detail).toContain('MEDIUM');
    }
  });

  it('a RESOLVED LOW or MEDIUM is done, and does not restart correction', () => {
    const d = decideContinuation(greenInput({ findings: [finding('LOW', true), finding('MEDIUM', true)] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('OWNER_GATE');
  });

  it('stops on an unresolved CRITICAL', () => {
    const d = decideContinuation(greenInput({ findings: [finding('CRITICAL')] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('UNRESOLVED_CRITICAL_OR_HIGH');
  });

  it('does not stop on a CRITICAL that is recorded resolved', () => {
    const d = decideContinuation(greenInput({ findings: [finding('CRITICAL', true)] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('OWNER_GATE');
  });

  it('a HIGH finding outranks a failing check — a defect can never mask a security finding', () => {
    const d = decideContinuation(greenInput({ checks: [FAIL], findings: [finding('HIGH')] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('UNRESOLVED_CRITICAL_OR_HIGH');
  });

  it('a protected effect stops a run whose checks all passed', () => {
    const d = decideContinuation(greenInput({ effects: attested({ productionTouched: true }) }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') {
      expect(d.reason.code).toBe('PROTECTED_EFFECT');
      expect(d.reason.detail).toContain('productionTouched');
    }
  });

  it('a protected effect outranks even a CRITICAL finding', () => {
    const d = decideContinuation(greenInput({ effects: attested({ paymentOccurred: true }), findings: [finding('CRITICAL')] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('PROTECTED_EFFECT');
  });

  it('a worker refusal is never read as a pass', () => {
    const d = decideContinuation(greenInput({ workerRefusal: 'the worker could not take ownership' }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('WORKER_REFUSED');
  });

  it('a scope question is the owner’s, not a defect to correct', () => {
    const d = decideContinuation(greenInput({ checks: [FAIL], scopeQuestion: 'should this also cover X?' }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') expect(d.reason.code).toBe('SCOPE_DECISION');
  });

  it('stops once correction attempts are exhausted instead of retrying forever', () => {
    const d = decideContinuation(greenInput({ checks: [FAIL], attemptsSpent: MAX_CORRECTION_ATTEMPTS }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') {
      expect(d.reason.code).toBe('CORRECTION_EXHAUSTED');
      expect(d.reason.detail).toContain('validate-all');
    }
  });

  it('a required review with no record is outstanding, not passed', () => {
    const d = decideContinuation(greenInput({ reviewsRecorded: ['code-review'] }));
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') {
      expect(d.reason.code).toBe('REVIEW_OUTSTANDING');
      expect(d.reason.detail).toContain('security-review');
    }
  });

  it('a fully green run stops at the owner gate the plan declares', () => {
    const d = decideContinuation(greenInput());
    expect(d.kind).toBe('stop');
    if (d.kind === 'stop') {
      expect(d.reason.code).toBe('OWNER_GATE');
      expect(d.reason.detail).toContain('commit');
    }
  });

  it('proceeds only when the plan declares no owner gate for the phase', () => {
    const phases = (realPlan()['phases'] as Record<string, unknown>[]).map((p) =>
      p['phaseId'] === PHASE ? { ...p, requiredOwnerGates: [], requiredReviews: [] } : p,
    );
    const b = brief(PHASE, { phases });
    const d = decideContinuation({
      brief: b,
      checks: [PASS],
      findings: [],
      effects: attested(),
      reviewsRecorded: [],
      attemptsSpent: 0,
    });
    expect(d.kind).toBe('proceed');
  });
});

describe('the classification helpers', () => {
  it('blockingFindings takes unresolved CRITICAL and HIGH only', () => {
    const all = [finding('CRITICAL'), finding('HIGH'), finding('MEDIUM'), finding('LOW'), finding('HIGH', true)];
    expect(blockingFindings(all).map((f) => f.severity)).toEqual(['CRITICAL', 'HIGH']);
  });

  it('protectedEffects names every effect a run admits to and nothing else', () => {
    expect(protectedEffects(attested({ externalSendOccurred: true }))).toEqual(['externalSendOccurred']);
    expect(protectedEffects(attested())).toEqual([]);
    // An absent attestation admits nothing; the not-attested stop, not this function, judges that.
    expect(protectedEffects(null)).toEqual([]);
  });

  it('the fields it judges are exactly the fields an attestation must state', () => {
    const allTrue = attested({
      productionTouched: true,
      deploymentOccurred: true,
      databaseMutationOccurred: true,
      externalSendOccurred: true,
      paymentOccurred: true,
      rawSecretStored: true,
    });
    expect(protectedEffects(allTrue)).toEqual([...PROTECTED_EFFECT_FIELDS]);
  });
});
