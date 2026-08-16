/**
 * The loop end to end, with a fake worker.
 *
 * ORDER IS THE SAFETY ARGUMENT, so most of these tests assert what did NOT happen: no worker started
 * when the checkout is wrong, none started when no worker is authorised, none started on a dry run.
 * A check that runs after a spawn is a check that ran too late, and only "the adapter was never
 * called" can prove it did not.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runLoop } from '../src/loop/runner.js';
import { MAX_CORRECTION_ATTEMPTS } from '../src/loop/outcome.js';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/workers.js';
import type { System, ExecResult } from '../src/system.js';

const ROOT = '/proj';
const HEAD = 'f'.repeat(40);
const PHASE = 'PROJECTOS-RECOVERY-PLANNING-BRAIN1A';
const WORKER_KIND = 'test-worker';
const VALIDATOR = 'validate-plan-discovery-import';

function realPlan(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function realConfig(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8'),
  ) as Record<string, unknown>;
}

interface WorldOpts {
  readonly execution?: unknown;
  readonly files?: Readonly<Record<string, string>>;
  readonly branch?: string;
  readonly remote?: string;
  readonly validatorExit?: number;
  /** What `git show HEAD:.projectops/project-config.json` returns. Defaults to the working tree. */
  readonly committedConfig?: unknown;
}

/**
 * A whole world: this repository's real config and approved plan, a checkout that matches them, and
 * the validator the plan's first phase requires.
 */
function world(opts: WorldOpts = {}) {
  const config = {
    ...realConfig(),
    localPath: ROOT,
    planMemory: { planPath: 'state/plan.json', currentStatePath: 'state/current.json' },
    ...(opts.execution === undefined
      ? { execution: { workers: [{ workerId: 'test', kind: WORKER_KIND, command: '/usr/local/bin/test-worker' }] } }
      : { execution: opts.execution }),
  };
  const files: Record<string, string> = {
    [`${ROOT}/.projectops/project-config.json`]: JSON.stringify(config),
    [`${ROOT}/state/plan.json`]: JSON.stringify(realPlan()),
    [`${ROOT}/state/current.json`]: JSON.stringify({ completedPhases: [] }),
    [`${ROOT}/projectos/validators/${VALIDATOR}.cjs`]: '// present',
    ...(opts.files ?? {}),
  };
  const writes: string[] = [];
  const branch = opts.branch ?? 'projectos-recovery-phase4-prep';
  const remote = opts.remote ?? `https://github.com/${String(realConfig()['repo'])}.git`;
  const sys: System & { writes: string[]; read: (p: string) => string | null } = {
    writes,
    read: (p) => files[p] ?? null,
    cwd: () => ROOT,
    now: () => '2026-08-11T19:00:00Z',
    readText: (p) => files[p] ?? null,
    writeText: (p, c) => {
      writes.push(p);
      files[p] = c;
    },
    exists: (p) => p in files,
    listDir: () => [],
    exec: (cmd, args): ExecResult => {
      if (cmd !== 'git') return { code: opts.validatorExit ?? 0, stdout: 'validator ran', stderr: '' };
      const key = args.join(' ');
      if (key.includes('rev-parse --abbrev-ref HEAD')) return { code: 0, stdout: `${branch}\n`, stderr: '' };
      if (key.includes('rev-parse HEAD')) return { code: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (key.includes('remote get-url origin')) return { code: 0, stdout: `${remote}\n`, stderr: '' };
      if (key.includes('status --porcelain')) return { code: 0, stdout: '', stderr: '' };
      if (key.includes('diff --name-only')) return { code: 0, stdout: 'src/x.ts\n', stderr: '' };
      if (key.includes('diff --stat')) return { code: 0, stdout: ' 1 file changed\n', stderr: '' };
      // The loop spawns only what the owner COMMITTED, so it compares the working-tree `execution`
      // block with this. By default the two agree; a test can make them disagree.
      if (key.includes('show HEAD:.projectops/project-config.json')) {
        return {
          code: 0,
          stdout: JSON.stringify(opts.committedConfig === undefined ? config : opts.committedConfig),
          stderr: '',
        };
      }
      return { code: 1, stdout: '', stderr: `unexpected: ${key}` };
    },
  };
  return sys;
}

/** A worker that records every call and never runs a process. */
function fakeAdapter(over: { exitCode?: number; providerRef?: string | null } = {}) {
  const calls: string[] = [];
  const adapter: WorkerAdapter = {
    kind: WORKER_KIND,
    start: () => {
      calls.push('start');
      return {
        kind: 'completed',
        exitCode: over.exitCode ?? 0,
        stdout: '',
        stderr: '',
        providerRef: over.providerRef ?? 'ref-1',
      };
    },
    rejoin: () => {
      calls.push('rejoin');
      return {
        kind: 'completed',
        exitCode: over.exitCode ?? 0,
        stdout: '',
        stderr: '',
        providerRef: over.providerRef ?? 'ref-1',
      };
    },
  };
  const registry: AdapterRegistry = { [WORKER_KIND]: adapter };
  return { calls, registry };
}

/**
 * A run that reported on itself: both required reviews recorded with nothing blocking, and an
 * effects attestation saying nothing protected happened. Both are needed — the loop refuses to
 * certify a run that never said what it did.
 */
function cleanFindings(sessionId: string): Record<string, string> {
  return {
    [`${ROOT}/.projectops/execution/${sessionId}.findings.json`]: JSON.stringify({
      reviews: ['code-review', 'security-review'],
      // RESOLVED: an unresolved LOW is ordinary work and would be sent back for correction.
      findings: [{ id: 'F1', severity: 'LOW', category: 'style', summary: 'nit', resolved: true }],
    }),
    [`${ROOT}/.projectops/execution/${sessionId}.effects.json`]: JSON.stringify(attestation()),
  };
}

/** A COMPLETE attestation. All six stated; anything less is not an attestation at all. */
function attestation(over: Record<string, boolean> = {}): Record<string, boolean> {
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

const SESSION = `${PHASE}-${HEAD.slice(0, 12)}`;

describe('runLoop', () => {
  it('a dry run writes the brief and starts nothing', () => {
    const sys = world();
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { dryRun: true, adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls).toEqual([]);
    expect(r.phaseId).toBe(PHASE);
    expect(sys.writes).toContain(`${ROOT}/.projectops/execution/${SESSION}.brief.json`);
    expect(r.lines.join('\n')).toContain('DRY RUN');
  });

  it('the brief it writes is the approved plan phase, not something the loop composed', () => {
    const sys = world();
    const { registry } = fakeAdapter();
    runLoop(sys, ROOT, { dryRun: true, adapters: registry });
    const written = JSON.parse(String(sys.read(`${ROOT}/.projectops/execution/${SESSION}.brief.json`))) as {
      phase: { phaseId: string; acceptanceCriteria: string[] };
    };
    const planPhase = (realPlan()['phases'] as Record<string, unknown>[]).find((p) => p['phaseId'] === PHASE)!;
    expect(written.phase.phaseId).toBe(PHASE);
    expect(written.phase.acceptanceCriteria).toEqual(planPhase['acceptanceCriteria']);
  });

  it('runs the phase’s required validator and stops at the owner gate when everything passes', () => {
    const sys = world({ files: cleanFindings(SESSION) });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls).toEqual(['start']);
    expect(r.stop?.code).toBe('OWNER_GATE');
    expect(r.lines.join('\n')).toContain(`PASS validator ${VALIDATOR}`);
    expect(sys.writes).toContain(`${ROOT}/.projectops/execution/${SESSION}.evidence.json`);
  });

  it('corrects an ordinary failure up to the bound, then stops rather than retrying forever', () => {
    const sys = world({ validatorExit: 1, files: cleanFindings(SESSION) });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('CORRECTION_EXHAUSTED');
    expect(calls).toHaveLength(MAX_CORRECTION_ATTEMPTS + 1);
    // The first run starts the worker; every correction rejoins the same one.
    expect(calls[0]).toBe('start');
    expect(calls.slice(1).every((c) => c === 'rejoin')).toBe(true);
  });

  it('stops on an unresolved HIGH finding without correcting anything', () => {
    const sys = world({
      files: {
        [`${ROOT}/.projectops/execution/${SESSION}.findings.json`]: JSON.stringify({
          reviews: ['code-review', 'security-review'],
          findings: [{ id: 'S1', severity: 'HIGH', category: 'security', summary: 'unsafe path', resolved: false }],
        }),
      },
    });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('UNRESOLVED_CRITICAL_OR_HIGH');
    expect(calls).toEqual(['start']);
  });

  it('stops on a recorded protected effect even though every check passed', () => {
    const sys = world({
      files: {
        ...cleanFindings(SESSION),
        [`${ROOT}/.projectops/execution/${SESSION}.effects.json`]: JSON.stringify(attestation({ deploymentOccurred: true })),
      },
    });
    const { registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('PROTECTED_EFFECT');
  });

  it('treats an unreadable findings record as a problem, never as no findings', () => {
    const sys = world({
      files: { [`${ROOT}/.projectops/execution/${SESSION}.findings.json`]: '{ not json' },
    });
    const { registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('REVIEW_OUTSTANDING');
    expect(r.stop?.detail).toContain('not valid JSON');
  });

  /**
   * The worker this loop spawns can write to the config that names its own successor. Reading the
   * committed blob instead means changing what the loop trusts requires a commit, which is where the
   * owner's review actually happens. Security review, HIGH.
   */
  it('refuses when the working-tree execution block differs from the committed one', () => {
    const sys = world({
      files: cleanFindings(SESSION),
      committedConfig: { execution: { workers: [{ workerId: 'test', kind: WORKER_KIND, command: '/usr/local/bin/something-else' }] } },
    });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('EXECUTION_CONFIG_UNCOMMITTED');
  });

  it('refuses when the committed config cannot be read at all', () => {
    const sys = world({ files: cleanFindings(SESSION) });
    const noGitShow: System = {
      ...sys,
      exec: (cmd, args, options) =>
        args.join(' ').includes('show HEAD:') ? { code: 128, stdout: '', stderr: 'fatal' } : sys.exec(cmd, args, options),
    };
    const { calls, registry } = fakeAdapter();
    const r = runLoop(noGitShow, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses to certify a run that attested nothing about what it did', () => {
    // Reviews recorded, checks green — but no effects.json. The first cut read that as innocence.
    const sys = world({
      files: {
        [`${ROOT}/.projectops/execution/${SESSION}.findings.json`]: JSON.stringify({
          reviews: ['code-review', 'security-review'],
          findings: [],
        }),
      },
    });
    const { registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('EFFECTS_NOT_ATTESTED');
  });

  it('tells the worker where to write the records the loop will demand', () => {
    const sys = world();
    const { registry } = fakeAdapter();
    runLoop(sys, ROOT, { dryRun: true, adapters: registry });
    const written = JSON.parse(String(sys.read(`${ROOT}/.projectops/execution/${SESSION}.brief.json`))) as {
      records: { findingsPath: string; effectsPath: string };
    };
    expect(written.records.findingsPath).toBe(`${ROOT}/.projectops/execution/${SESSION}.findings.json`);
    expect(written.records.effectsPath).toBe(`${ROOT}/.projectops/execution/${SESSION}.effects.json`);
  });

  it('refuses to run a phase under a worker that does not own its session', () => {
    const sys = world({
      files: {
        ...cleanFindings(SESSION),
        [`${ROOT}/.projectops/execution/${SESSION}.session.json`]: JSON.stringify({
          sessionId: SESSION,
          workerId: 'someone-else',
          kind: WORKER_KIND,
          phaseId: PHASE,
          briefId: `${PHASE}@${HEAD}`,
          briefPath: `${ROOT}/.projectops/execution/${SESSION}.brief.json`,
          startedAt: '2026-08-11T18:00:00Z',
          providerRef: 'ref-from-someone-else',
          state: 'started',
          exitCode: 0,
          corrections: 0,
        }),
      },
    });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('SESSION_WORKER_MISMATCH');
  });

  it('treats an INCOMPLETE attestation as no attestation at all', () => {
    const sys = world({
      files: {
        [`${ROOT}/.projectops/execution/${SESSION}.findings.json`]: JSON.stringify({
          reviews: ['code-review', 'security-review'],
          findings: [],
        }),
        // Answers one of the six questions. Answering nothing was never innocence; nor is this.
        [`${ROOT}/.projectops/execution/${SESSION}.effects.json`]: JSON.stringify({ productionTouched: false }),
      },
    });
    const { registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('EFFECTS_NOT_ATTESTED');
    expect(r.stop?.detail).toContain('deploymentOccurred');
  });

  it('sends an unresolved MEDIUM finding back to the worker, bounded like any other defect', () => {
    const sys = world({
      files: {
        [`${ROOT}/.projectops/execution/${SESSION}.findings.json`]: JSON.stringify({
          reviews: ['code-review', 'security-review'],
          findings: [{ id: 'M1', severity: 'MEDIUM', category: 'maintainability', summary: 'duplication', resolved: false }],
        }),
        [`${ROOT}/.projectops/execution/${SESSION}.effects.json`]: JSON.stringify(attestation()),
      },
    });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('CORRECTION_EXHAUSTED');
    expect(r.stop?.detail).toContain('MEDIUM');
    // One start, then a rejoin per correction attempt — the same worker, told to correct.
    expect(calls).toHaveLength(MAX_CORRECTION_ATTEMPTS + 1);
    expect(calls[0]).toBe('start');
    expect(calls.slice(1).every((c) => c === 'rejoin')).toBe(true);
  });

  /**
   * The session record is a file the spawned worker can write to, and the rejoin instruction puts
   * `briefPath` on the worker's command line. Only the HANDLE is trusted from that record; the brief
   * path is recomputed. Found in the delta self-review of the correction instruction.
   */
  it('recomputes the brief path on rejoin instead of trusting the session record', () => {
    const sys = world({
      files: {
        ...cleanFindings(SESSION),
        [`${ROOT}/.projectops/execution/${SESSION}.session.json`]: JSON.stringify({
          sessionId: SESSION,
          workerId: 'test',
          kind: WORKER_KIND,
          phaseId: PHASE,
          briefId: 'SOMETHING-ELSE',
          briefPath: '/tmp/attacker-chosen.json',
          startedAt: '2026-08-11T18:00:00Z',
          providerRef: 'earlier-run',
          state: 'started',
          exitCode: 0,
          corrections: 0,
        }),
      },
    });
    const { registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    const written = JSON.parse(String(sys.read(`${ROOT}/.projectops/execution/${SESSION}.session.json`))) as {
      briefPath: string;
      briefId: string;
      providerRef: string;
    };
    expect(written.briefPath).toBe(`${ROOT}/.projectops/execution/${SESSION}.brief.json`);
    expect(written.briefId).toContain(PHASE);
    // The handle itself is still honoured — that is what makes it a rejoin.
    expect(written.providerRef).toBeTruthy();
  });

  /**
   * A malformed session record used to read as an ABSENT one, so a worker could corrupt its own
   * record and the loop would start fresh: the worker-identity refusal could never fire, and a
   * resumable handle would be silently discarded. Raised as CR-3 by the security review the governed
   * worker performed on its own phase, during the live proof.
   */
  it('refuses an unreadable session record instead of treating it as absent', () => {
    const sys = world({
      files: {
        ...cleanFindings(SESSION),
        [`${ROOT}/.projectops/execution/${SESSION}.session.json`]: '{ not json',
      },
    });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('SESSION_UNREADABLE');
  });

  it('refuses a session record that cannot say which worker owns it', () => {
    const sys = world({
      files: {
        ...cleanFindings(SESSION),
        [`${ROOT}/.projectops/execution/${SESSION}.session.json`]: JSON.stringify({ sessionId: SESSION, providerRef: 'ref-1' }),
      },
    });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('workerId');
  });

  it('refuses a checkout of another repository, and starts nothing', () => {
    const sys = world({ remote: 'https://github.com/acme/somewhere-else.git' });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('CONTEXT_MISMATCH');
    expect(sys.writes).toEqual([]);
  });

  it('refuses to run on a protected branch, and starts nothing', () => {
    const sys = world({ branch: String((realConfig()['protectedBranches'] as string[])[0]) });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('protected');
  });

  it('refuses when the project authorises no worker, and writes nothing', () => {
    const sys = world({ execution: null });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('NO_AUTHORISED_WORKER');
    expect(sys.writes).toEqual([]);
  });

  it('refuses a worker whose command is a bare name', () => {
    const sys = world({ execution: { workers: [{ workerId: 'test', kind: WORKER_KIND, command: 'test-worker' }] } });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(r.lines.join('\n')).toContain('absolute path');
  });

  it('fails the required validator when the repository does not have it', () => {
    const sys = world({ files: cleanFindings(SESSION) });
    // Remove the validator by pointing the plan's phase at a name nothing provides.
    const plan = realPlan();
    const phases = (plan['phases'] as Record<string, unknown>[]).map((p) =>
      p['phaseId'] === PHASE ? { ...p, requiredValidators: ['validate-nothing-at-all'] } : p,
    );
    sys.writeText(`${ROOT}/state/plan.json`, JSON.stringify({ ...plan, phases }));
    const { registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.join('\n')).toContain('FAIL validator validate-nothing-at-all');
    expect(r.stop?.code).toBe('CORRECTION_EXHAUSTED');
  });

  /**
   * The required validator for this project is `validate-all`, which takes tens of minutes. Running
   * it after a worker that already refused would burn the whole suite to learn what the exit code
   * said — and would leave a green suite over unchanged code sitting in the evidence beside a failed
   * run, reading as reassurance.
   */
  it('does not run the phase’s validators after a worker refusal', () => {
    const sys = world({ files: cleanFindings(SESSION) });
    const adapter: WorkerAdapter = {
      kind: WORKER_KIND,
      start: () => ({ kind: 'refused', detail: 'the worker could not take ownership of the checkout' }),
      rejoin: () => ({ kind: 'refused', detail: 'unreachable in this test' }),
    };
    const r = runLoop(sys, ROOT, { adapters: { [WORKER_KIND]: adapter } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stop?.code).toBe('WORKER_REFUSED');
    expect(r.lines.join('\n')).not.toContain(`PASS validator ${VALIDATOR}`);
    expect(r.lines.join('\n')).not.toContain(`FAIL validator ${VALIDATOR}`);
    // The refusal is still evidenced — a run that refused is a run that happened.
    expect(sys.writes).toContain(`${ROOT}/.projectops/execution/${SESSION}.evidence.json`);
  });

  it('rejoins the worker a previous invocation recorded instead of starting a new one', () => {
    const sys = world({
      files: {
        ...cleanFindings(SESSION),
        [`${ROOT}/.projectops/execution/${SESSION}.session.json`]: JSON.stringify({
          sessionId: SESSION,
          workerId: 'test',
          kind: WORKER_KIND,
          phaseId: PHASE,
          briefId: `${PHASE}@${HEAD}`,
          briefPath: `${ROOT}/.projectops/execution/${SESSION}.brief.json`,
          startedAt: '2026-08-11T18:00:00Z',
          providerRef: 'earlier-run',
          state: 'started',
          exitCode: 0,
        }),
      },
    });
    const { calls, registry } = fakeAdapter();
    const r = runLoop(sys, ROOT, { adapters: registry });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(['rejoin']);
  });

  /* ----------------------------------------------------------------------------------------------
   * PROJECTOS-PHASE6-WORKER-PROVENANCE1A — what started this worker.
   *
   * A real worker ran against Dead Aisle on 2026-08-16 at 18:02:11Z and could not be attributed
   * afterwards, because nothing recorded the invocation. These pin the two controls that close it:
   * live execution now takes a positive act, and a live run writes down what invoked it BEFORE it
   * spawns anything.
   * ------------------------------------------------------------------------------------------- */

  const FACTS = { pid: 4242, ppid: 1717, argv: ['C:/node.exe', 'projectos.js', 'run', '--execute'], cwd: 'C:/dev/x' };
  const invocationFile = `${ROOT}/.projectops/execution/${SESSION}.invocation.json`;

  it('[E] writes the invocation record BEFORE the worker is spawned', () => {
    const sys = world({ files: cleanFindings(SESSION) });
    // Proven from INSIDE the spawn: the adapter looks for the record at the moment it is started.
    // Stronger than observing write order, because it asserts the state the worker itself sees.
    let recordExistedAtSpawn: string | null = null;
    let spawned = false;
    const registry = {
      [WORKER_KIND]: {
        kind: WORKER_KIND,
        start: () => {
          spawned = true;
          recordExistedAtSpawn = sys.read(invocationFile);
          return { kind: 'completed' as const, exitCode: 0, stdout: '', stderr: '', providerRef: 'p-1' };
        },
        rejoin: () => ({ kind: 'completed' as const, exitCode: 0, stdout: '', stderr: '', providerRef: 'p-1' }),
      },
    } as unknown as AdapterRegistry;

    runLoop(sys, ROOT, { adapters: registry, invocation: FACTS });

    expect(spawned).toBe(true);
    expect(recordExistedAtSpawn).not.toBeNull();
    expect(String(recordExistedAtSpawn)).toContain('"executionMode": "live"');
  });

  it('[F] the record carries pid, parent pid, cwd, project, worker and brief identity', () => {
    const sys = world({ files: cleanFindings(SESSION) });
    const { registry } = fakeAdapter();
    runLoop(sys, ROOT, { adapters: registry, invocation: FACTS });

    const rec = JSON.parse(String(sys.read(invocationFile))) as Record<string, any>;
    expect(rec['executionMode']).toBe('live');
    expect(rec['process']['pid']).toBe(4242);
    expect(rec['process']['ppid']).toBe(1717);
    expect(rec['process']['cwd']).toBe('C:/dev/x');
    expect(rec['phaseId']).toBe(PHASE);
    expect(rec['sessionId']).toBe(SESSION);
    expect(rec['workerId']).toBeTruthy();
    expect(rec['workerKind']).toBeTruthy();
    expect(String(rec['brief']['path'])).toContain('.brief.json');
    expect(String(rec['brief']['digest'])).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rec['invocationId']).toMatch(/^[0-9a-f]{16}$/);
    // The environment is where credentials live. It is never recorded.
    expect(Object.keys(rec)).not.toContain('env');
    expect(JSON.stringify(rec)).not.toContain('processEnv');
  });

  it('[G] the session and the evidence both name the invocation', () => {
    const sys = world({ files: cleanFindings(SESSION) });
    const { registry } = fakeAdapter();
    runLoop(sys, ROOT, { adapters: registry, invocation: FACTS });

    const id = (JSON.parse(String(sys.read(invocationFile))) as Record<string, any>)['invocationId'];
    const session = JSON.parse(String(sys.read(`${ROOT}/.projectops/execution/${SESSION}.session.json`))) as Record<string, any>;
    const evidence = JSON.parse(String(sys.read(`${ROOT}/.projectops/execution/${SESSION}.evidence.json`))) as Record<string, any>;
    expect(session['invocationId']).toBe(id);
    expect(evidence['invocationId']).toBe(id);
  });

  it('[A] a dry run writes no invocation record, because it starts nothing', () => {
    const sys = world();
    const { calls, registry } = fakeAdapter();
    runLoop(sys, ROOT, { dryRun: true, adapters: registry, invocation: FACTS });
    expect(calls).toEqual([]);
    expect(sys.read(invocationFile)).toBeNull();
  });
});
