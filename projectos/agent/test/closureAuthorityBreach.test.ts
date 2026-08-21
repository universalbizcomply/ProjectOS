/**
 * The exact disclosed incident, as a regression — driven through the real CLI command.
 *
 * `phase advance --id <phase> --to closed --delegated`, typed by the implementer, closed Phase 18.
 * Every G4 predicate was satisfied. The delegate's identity was resolved from the approved plan, not
 * from the caller, so nothing was spoofed — and that is what makes the defect worth a permanent test:
 * the system had no way to tell "the conditions for a decision are met" from "the delegate decided".
 *
 * These tests drive `phase(...)` itself, not the authority module, because the incident was a CLI
 * invocation and the property that matters is what happens when someone runs that command.
 */
import { describe, it, expect } from 'vitest';
import { phase } from '../src/commands/phase.js';
import { configPath } from '../src/context.js';
import type { System } from '../src/system.js';

const ROOT = '/proj';
const PLAN_REL = 'projectos/state/projectos-v3.plan.json';
const STATE_REL = 'projectos/state/projectos-v3.current-state.json';
const PHASE = 'PROJECTOS-V3-FINAL-E2E-CLOSURE1A';
const SUBJECT = 'a'.repeat(40);

function repoFile(rel: string): string {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  return fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
}

/**
 * A checkout in which EVERY G4 predicate passes and the phase is at `awaiting_closure` — the state
 * the repository was actually in when the breach happened. Anything that refuses below refuses
 * because of the authority model, never because the evidence was incomplete.
 */
function eligibleCheckout(files: Record<string, string> = {}): System & { writes: string[] } {
  const plan = JSON.parse(repoFile(PLAN_REL)) as Record<string, unknown>;
  const state = JSON.parse(repoFile(STATE_REL)) as Record<string, unknown>;
  const store: Record<string, string> = {
    [configPath(ROOT)]: JSON.stringify({
      projectId: 'projectos',
      projectName: 'ProjectOS',
      projectType: 'delivery-os',
      owner: 'Murad',
      repo: 'universalbizcomply/ProjectOS',
      localPath: 'C:/dev/ProjectOS',
      protectedBranches: ['main'],
      productionFreeze: true,
      allowedActions: ['create-local-files'],
      forbiddenActions: ['production-deploy'],
      approvalGates: ['phase-closure'],
      secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
      validators: ['projectos/validators/validate-all.cjs'],
      evidenceRequirements: ['evidence-pack'],
      installStatus: 'installed',
      planMemory: { planPath: PLAN_REL, currentStatePath: STATE_REL },
    }),
    [`${ROOT}/${PLAN_REL}`]: JSON.stringify(plan),
    [`${ROOT}/${STATE_REL}`]: JSON.stringify(state),
    [`${ROOT}/.projectops/phases/${PHASE}.json`]: JSON.stringify({
      phaseId: PHASE,
      project: 'ProjectOS',
      objective: 'final closure',
      status: 'awaiting_closure',
      history: [{ from: 'awaiting_review', to: 'awaiting_closure', by: 'implementer', at: '2026-08-10T20:00:00Z' }],
    }),
    [`${ROOT}/.projectops/closure/${PHASE}.json`]: JSON.stringify({
      phaseId: PHASE,
      evidenceSubjectHead: SUBJECT,
      validatorsPass: true,
      checksPass: true,
      reviewsComplete: true,
      unresolvedCriticalOrHigh: 0,
      headedProofPass: true,
    }),
    [`${ROOT}/.projectops/validation/${SUBJECT}.json`]: JSON.stringify({
      schemaVersion: '1.1.0',
      subjectHead: SUBJECT,
      generatedAt: '2026-08-10T20:00:00.000Z',
      workingTreeCleanAtRunStart: true,
      aggregatePassed: true,
      aggregate: { name: 'validate-all', passed: true },
      registeredModuleCount: 1,
      results: [{ name: 'validate-reliability-hardening', passed: true, errorCount: 0 }],
    }),
    [`${ROOT}/knowledge/reports/2026-08-10_${PHASE}_AWAITING-CLOSURE.md`]: '# evidence',
    [`${ROOT}/projectos/state/projectos-v3.session.json`]: JSON.stringify({ productionTouched: false }),
    ...files,
  };
  const writes: string[] = [];
  return {
    writes,
    cwd: () => ROOT,
    now: () => '2026-08-10T21:00:00Z',
    readText: (p: string) => store[p] ?? null,
    writeText: (p: string, c: string) => {
      writes.push(p);
      store[p] = c;
    },
    exists: (p: string) => p in store,
    listDir: (p: string) =>
      Object.keys(store)
        .filter((f) => f.startsWith(p + '/'))
        .map((f) => f.slice(p.length + 1))
        .filter((f) => !f.includes('/')),
    // Healthy git: HEAD is the subject, the tree is clean, the remote is reconciled, and the decision
    // file — when one exists — reads as committed. So nothing below can refuse for a git reason.
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (_cmd: string, args: readonly string[]) => {
      if (args.includes('rev-parse')) return { code: 0, stdout: SUBJECT, stderr: '' };
      // The installation asks which repository this checkout IS before consulting its durable record.
      if (args.includes('remote')) {
        return { code: 0, stdout: 'https://github.com/universalbizcomply/ProjectOS.git', stderr: '' };
      }
      if (args.includes('status')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('rev-list')) return { code: 0, stdout: '0\t0', stderr: '' };
      if (args.includes('log')) return { code: 0, stdout: 'b'.repeat(40), stderr: '' };
      if (args.includes('diff')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('merge-base')) return { code: 0, stdout: '', stderr: '' };
      // `git show HEAD:<path>` — the decision is read from the COMMITTED OBJECT, never from the
      // working tree, so a symlinked path cannot serve bytes git never saw. The fixture models that
      // by serving the object from the same store, which is what a committed file would produce.
      if (args.includes('show')) {
        const spec = args[args.length - 1] ?? '';
        // `HEAD:./<rel>` is the bound form: the pathspec that proves committedness resolves against
        // `-C root`, so the read must too, or a nested checkout proves one file and reads another.
        const rel = spec.startsWith('HEAD:./')
          ? spec.slice('HEAD:./'.length)
          : spec.startsWith('HEAD:')
            ? spec.slice('HEAD:'.length)
            : '';
        const body = store[`${ROOT}/${rel}`];
        return body === undefined ? { code: 128, stdout: '', stderr: 'path does not exist' } : { code: 0, stdout: body, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

const DECISION = {
  schemaVersion: '1.0.0',
  decisionId: 'GK-CLOSE-PHASE18-0001',
  phaseId: PHASE,
  projectId: 'projectos',
  scope: 'phase-closure',
  decidedBy: 'ChatGPT',
  decidedAt: '2026-08-10T21:00:00Z',
  evidenceSubjectHead: SUBJECT,
  decision: 'close',
};

function statusOf(sys: System): string {
  return (JSON.parse(sys.readText(`${ROOT}/.projectops/phases/${PHASE}.json`) ?? '{}') as { status?: string }).status ?? '';
}
function historyLength(sys: System): number {
  return ((JSON.parse(sys.readText(`${ROOT}/.projectops/phases/${PHASE}.json`) ?? '{}') as { history?: unknown[] }).history ?? []).length;
}

describe('the disclosed breach cannot happen again', () => {
  it('R1 THE EXACT INCIDENT: `--to closed --delegated` from the CLI is REFUSED and writes nothing', () => {
    const sys = eligibleCheckout();
    const before = historyLength(sys);
    const r = phase({ sys, root: ROOT }, { id: PHASE, to: 'closed', delegated: true }, ['advance']);

    expect(r.code).toBe(2);
    const said = r.lines.join(' ');
    expect(said).toContain('ELIGIBLE_AWAITING_GATEKEEPER');
    expect(said).toContain('eligibility is not a decision');
    // The phase is untouched: same status, same history, and NOTHING was written at all.
    expect(statusOf(sys)).toBe('awaiting_closure');
    expect(historyLength(sys)).toBe(before);
    expect(sys.writes).toEqual([]);
  });

  it('R2 it refuses for the RIGHT reason — the evidence really is complete', () => {
    // If this fixture were not fully eligible, R1 would pass for an uninteresting reason. The
    // read-only eligibility command reports the gate honestly, so the premise is checked, not assumed.
    const sys = eligibleCheckout();
    const r = phase({ sys, root: ROOT }, { id: PHASE }, ['closure-eligibility']);
    expect(r.code).toBe(0);
    const said = r.lines.join('\n');
    expect(said).toContain('G4_ELIGIBLE');
    expect(said).toContain('GATEKEEPER DECISION: NOT USABLE');
    expect(said).toContain('MUST NOT be closed');
    // Asking the question must never perform the act — the whole reason the command exists.
    expect(sys.writes).toEqual([]);
    expect(statusOf(sys)).toBe('awaiting_closure');
  });

  it('R3 no caller-controlled flag combination grants closure', () => {
    const attempts: Record<string, unknown>[] = [
      { delegated: true },
      { delegated: 'true' },
      { as: 'advisor' },
      { as: 'advisor', identity: 'ChatGPT' },
      { delegated: true, as: 'advisor' },
      { delegated: true, as: 'advisor', identity: 'ChatGPT' },
      { delegated: true, identity: 'ChatGPT' },
      { as: 'owner' },
      { as: 'owner', identity: 'Murad' },
      { as: 'implementer', identity: 'ChatGPT' },
      { delegated: true, identity: 'Claude Code' },
    ];
    for (const flags of attempts) {
      const sys = eligibleCheckout();
      const r = phase({ sys, root: ROOT }, { id: PHASE, to: 'closed', ...flags }, ['advance']);
      expect(r.code, JSON.stringify(flags)).toBe(2);
      expect(statusOf(sys), JSON.stringify(flags)).toBe('awaiting_closure');
      expect(sys.writes, JSON.stringify(flags)).toEqual([]);
    }
  });

  it('R4 an UNCOMMITTED decision on disk does not close it — that is the boundary', () => {
    const sys = eligibleCheckout({
      [`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]: JSON.stringify(DECISION),
    });
    // Same fixture, but git has no committed object for the decision path and no log entry for it —
    // exactly what an on-disk-only decision looks like.
    const uncommitted: System & { writes: string[] } = {
      ...sys,
      exec: (cmd: string, args: readonly string[]) =>
        args.includes('log') || args.includes('show') ? { code: 1, stdout: '', stderr: '' } : sys.exec(cmd, args),
    };
    const r = phase({ sys: uncommitted, root: ROOT }, { id: PHASE, to: 'closed', delegated: true }, ['advance']);
    expect(r.code).toBe(2);
    expect(r.lines.join(' ')).toContain('is NOT committed');
    expect(statusOf(uncommitted)).toBe('awaiting_closure');
    expect(uncommitted.writes).toEqual([]);
  });

  it('R5 a decision bound to other bytes, another phase or another actor does not close it', () => {
    const variants: [string, Record<string, unknown>, string][] = [
      ['stale subject', { evidenceSubjectHead: 'c'.repeat(40) }, 'stale'],
      ['another phase', { phaseId: 'SOME-OTHER-PHASE1A' }, 'is for phase'],
      ['another project', { projectId: 'polygo' }, 'is for project'],
      ['not the delegate', { decidedBy: 'Murad' }, 'not the recorded authority'],
      ['implementer as delegate', { decidedBy: 'Claude Code' }, 'not the recorded authority'],
      ['not a close', { decision: 'defer' }, 'does not decide to close'],
    ];
    for (const [label, over, needle] of variants) {
      const sys = eligibleCheckout({
        [`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]: JSON.stringify({ ...DECISION, ...over }),
      });
      const r = phase({ sys, root: ROOT }, { id: PHASE, to: 'closed', delegated: true }, ['advance']);
      expect(r.code, label).toBe(2);
      expect(r.lines.join(' '), label).toContain(needle);
      expect(statusOf(sys), label).toBe('awaiting_closure');
      expect(sys.writes, label).toEqual([]);
    }
  });

  it('R6 the plan sentence is now enforced: the implementer can neither approve nor close', () => {
    // Straight from plan v1.3's closureDelegation notes. It was true of `approve` and untrue of
    // `close`; both are asserted here so the sentence has a test rather than a promise.
    const withDecision = {
      [`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]: JSON.stringify(DECISION),
    };
    for (const flags of [
      { as: 'implementer' },
      { as: 'implementer', identity: 'ChatGPT' },
      { delegated: true, as: 'implementer' },
    ]) {
      const sys = eligibleCheckout(withDecision);
      const r = phase({ sys, root: ROOT }, { id: PHASE, to: 'closed', ...flags }, ['advance']);
      expect(r.code, JSON.stringify(flags)).toBe(2);
      expect(statusOf(sys), JSON.stringify(flags)).toBe('awaiting_closure');
    }
  });

  it('R7 THE LEGITIMATE PATH: a committed, bound decision closes it — and only then', () => {
    const sys = eligibleCheckout({
      [`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]: JSON.stringify(DECISION),
    });
    const r = phase({ sys, root: ROOT }, { id: PHASE, to: 'closed', delegated: true }, ['advance']);
    expect(r.code).toBe(0);
    expect(statusOf(sys)).toBe('closed');
    // The consumed decision is written into the history, which is what makes a replay detectable.
    const record = JSON.parse(sys.readText(`${ROOT}/.projectops/phases/${PHASE}.json`) ?? '{}') as {
      history: { to: string; by: string; note?: string }[];
    };
    const last = record.history[record.history.length - 1];
    expect(last.to).toBe('closed');
    expect(last.by).toBe('advisor');
    expect(last.note ?? '').toContain('decision GK-CLOSE-PHASE18-0001');
  });

  it('R8 the same decision cannot be replayed against a phase it has already closed', () => {
    const sys = eligibleCheckout({
      [`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]: JSON.stringify(DECISION),
      [`${ROOT}/.projectops/phases/${PHASE}.json`]: JSON.stringify({
        phaseId: PHASE,
        project: 'ProjectOS',
        objective: 'final closure',
        status: 'awaiting_closure',
        history: [
          {
            from: 'awaiting_closure',
            to: 'closed',
            by: 'advisor',
            at: '2026-08-10T20:30:00Z',
            note: 'closed by ChatGPT under the projectos-scoped phase-closure delegation, decision GK-CLOSE-PHASE18-0001',
          },
          { from: 'closed', to: 'awaiting_closure', by: 'implementer', at: '2026-08-10T20:45:00Z' },
        ],
      }),
    });
    const r = phase({ sys, root: ROOT }, { id: PHASE, to: 'closed', delegated: true }, ['advance']);
    expect(r.code).toBe(2);
    expect(r.lines.join(' ')).toContain('already consumed');
    expect(statusOf(sys)).toBe('awaiting_closure');
  });
});
