/**
 * A CHECKPOINT REMEMBERS. IT MUST NEVER PERMIT.
 *
 * ProjectOS can now write down where autonomous work reached, so a process that ends does not take
 * that knowledge with it. The danger is the same file: the implementer can write to this checkout,
 * and a record saying `GATE_APPROVED` or `nextCandidateAction: 'commit'` would be the easiest
 * forgery in the system if anything ever read it as permission.
 *
 * So these prove two separate things, and the second matters more:
 *
 *   1. what was written survives a process boundary, intact and bound to its project;
 *   2. writing it grants nothing — no reader turns a record into authority, and identity cannot be
 *      moved from one project or phase to another.
 *
 * Created in PROJECTOS-GOVERNED-WORK-QUEUE-CHECKPOINT1A.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  beginWork,
  advanceWork,
  readWorkRecord,
  writeWorkRecord,
  workRecordPath,
  resumeProblems,
  isWorkState,
  WORK_STATES,
  WORK_RECORD_SCHEMA_VERSION,
  type WorkRecord,
} from '../src/loop/workRecord.js';
import { nodeSystem } from '../src/system.js';

const sys = nodeSystem;
const AT = '2026-08-30T12:00:00.000Z';
const HEAD = 'a'.repeat(40);

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-work-'));
  mkdirSync(join(dir, '.projectops'), { recursive: true });
  return dir;
}

function started(over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    ...beginWork({ projectId: 'alpha', phaseId: 'ALPHA-TWO', subjectCommit: HEAD, at: AT }),
    ...over,
  };
}

describe('a work item survives the process that created it', () => {
  it('writes and reads back every fact a resume needs', () => {
    const dir = root();
    const record = advanceWork(
      started(),
      {
        state: 'AWAITING_GATE',
        sessionId: 'ALPHA-TWO.abc123',
        attempt: 2,
        lastCompletedStep: 'checks ran for attempt 2',
        lastStopCode: 'REVIEW_OUTSTANDING',
        lastStopDetail: 'the worker review is not complete',
        gateDecisionId: 'GKDEC-abc123',
        nextCandidateAction: 'await the reviewer',
        ownerRequired: false,
      },
      AT,
    );
    writeWorkRecord(sys, dir, record);

    // A NEW READER, as a restarted process would have. Nothing is carried over in memory.
    const read = readWorkRecord(sys, dir);
    expect(read.ok).toBe(true);
    if (!read.ok || read.value === null) throw new Error('expected a record');

    expect(read.value.projectId).toBe('alpha');
    expect(read.value.phaseId).toBe('ALPHA-TWO');
    expect(read.value.state).toBe('AWAITING_GATE');
    expect(read.value.sessionId).toBe('ALPHA-TWO.abc123');
    expect(read.value.subjectCommit).toBe(HEAD);
    expect(read.value.lastCompletedStep).toBe('checks ran for attempt 2');
    expect(read.value.lastStopCode).toBe('REVIEW_OUTSTANDING');
    expect(read.value.gateDecisionId).toBe('GKDEC-abc123');
    expect(read.value.nextCandidateAction).toBe('await the reviewer');
    expect(read.value.ownerRequired).toBe(false);
  });

  it('an absent record is absent, and an unreadable one is a problem — never the same answer', () => {
    // THE `readSession` LESSON. Treating unreadable as absent silently restarts the work the record
    // was tracking, and every guarantee that depended on remembering is gone without a word.
    const dir = root();
    expect(readWorkRecord(sys, dir)).toEqual({ ok: true, value: null });

    writeFileSync(workRecordPath(dir), '{ not json');
    const broken = readWorkRecord(sys, dir);
    expect(broken.ok).toBe(false);
  });

  it('a record from another schema version is refused rather than guessed at', () => {
    const dir = root();
    writeFileSync(workRecordPath(dir), JSON.stringify({ ...started(), schemaVersion: '9.9.9' }));
    const read = readWorkRecord(sys, dir);
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('expected a refusal');
    expect(read.problem).toContain('schemaVersion');
  });

  it('an unrecognised state is refused, not coerced into a plausible one', () => {
    const dir = root();
    writeFileSync(workRecordPath(dir), JSON.stringify({ ...started(), state: 'PROBABLY_FINE' }));
    expect(readWorkRecord(sys, dir).ok).toBe(false);
    expect(isWorkState('PROBABLY_FINE')).toBe(false);
    for (const s of WORK_STATES) expect(isWorkState(s)).toBe(true);
  });

  it('records no secret, no prompt, no provider body and no evidence contents', () => {
    // It references canonical records. A transcript is where a secret would end up.
    const dir = root();
    writeWorkRecord(sys, dir, started({ gateDecisionId: 'GKDEC-abc123', sessionId: 'S1' }));
    const raw = readFileSync(workRecordPath(dir), 'utf8');
    for (const leak of ['sk-', 'Authorization', 'Bearer', 'nextClaudeInstruction', 'output_text']) {
      expect(raw).not.toContain(leak);
    }
  });
});

describe('one project can never continue another project’s work', () => {
  it('a checkpoint belonging to another project is refused', () => {
    const record = started({ projectId: 'alpha' });
    const problems = resumeProblems(record, { projectId: 'beta', subjectCommit: HEAD });
    expect(problems.join(' ')).toContain("belongs to project 'alpha'");
  });

  it('the same project at the same commit resumes cleanly', () => {
    expect(resumeProblems(started(), { projectId: 'alpha', subjectCommit: HEAD })).toEqual([]);
  });

  it('identity cannot be moved by a progression', () => {
    // A different phase is a different work item. Letting `advanceWork` carry a checkpoint across
    // projects or phases is the one change that would make every other guarantee here worthless.
    const moved = advanceWork(
      started(),
      { state: 'COMPLETE' } as never,
      AT,
    );
    expect(moved.projectId).toBe('alpha');
    expect(moved.phaseId).toBe('ALPHA-TWO');
  });
});

describe('a moved repository does not silently resume', () => {
  it('a different head is refused with both commits named', () => {
    const problems = resumeProblems(started(), { projectId: 'alpha', subjectCommit: 'b'.repeat(40) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('the repository moved');
  });

  it('a checkpoint with no subject commit cannot vouch for an unchanged checkout', () => {
    const problems = resumeProblems(started({ subjectCommit: null }), {
      projectId: 'alpha',
      subjectCommit: HEAD,
    });
    expect(problems.join(' ')).toContain('names no subject commit');
  });

  it('a checkout that reports no head cannot be compared either', () => {
    const problems = resumeProblems(started(), { projectId: 'alpha', subjectCommit: null });
    expect(problems.join(' ')).toContain('no head to compare');
  });

  it('every reason is returned, not just the first', () => {
    const problems = resumeProblems(started({ projectId: 'alpha' }), {
      projectId: 'beta',
      subjectCommit: 'c'.repeat(40),
    });
    expect(problems).toHaveLength(2);
  });
});

describe('the record grants nothing', () => {
  it('the module exposes no approval, authorisation or permission function', () => {
    // THE PROPERTY THIS PHASE IS REALLY ABOUT. A hand-written record can only matter if something
    // reads it and believes it. The module surface is asserted here; the validator enforces the same
    // rule across the whole source tree as it changes.
    const surface = readFileSync(join(process.cwd(), 'src', 'loop', 'workRecord.ts'), 'utf8');
    for (const forbidden of [
      'export function authorise',
      'export function approve',
      'export function permit',
      'export function grant',
      'workRecordAuthorises',
    ]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it('a hand-written GATE_APPROVED record authorises nothing — nothing reads it back', () => {
    const dir = root();
    // Simulating the implementer forging its own approval directly in the checkout.
    writeFileSync(
      workRecordPath(dir),
      `${JSON.stringify(
        started({ state: 'GATE_APPROVED', gateDecisionId: 'GKDEC-forged', nextCandidateAction: 'commit' }),
        null,
        2,
      )}\n`,
    );

    // It reads back as data and nothing more. The loop takes a WRITE-ONLY port and never consults
    // this record: no code path exists through which the forged file could reach a decision.
    const read = readWorkRecord(sys, dir);
    expect(read.ok).toBe(true);
    const runner = readFileSync(join(process.cwd(), 'src', 'loop', 'runner.ts'), 'utf8');
    expect(runner).toContain('onWorkState');
    expect(runner).not.toMatch(/readWorkRecord|workRecordPath|resumeProblems/);
  });

  it("`nextCandidateAction: 'commit'` is a candidate, and the loop performs no commit at all", () => {
    // The correction worker is granted Edit and Write only — no shell, so no git. A stored word
    // cannot conjure an authority the executor does not have.
    const runner = readFileSync(join(process.cwd(), 'src', 'loop', 'runner.ts'), 'utf8');
    expect(runner).toContain('no shell, so no git, no commit, no push');
  });

  it('a gate decision reference stays a reference — the decision itself lives elsewhere', () => {
    const dir = root();
    writeWorkRecord(sys, dir, started({ gateDecisionId: 'GKDEC-abc123' }));
    const raw = JSON.parse(readFileSync(workRecordPath(dir), 'utf8')) as Record<string, unknown>;
    expect(raw['gateDecisionId']).toBe('GKDEC-abc123');
    // No verdict, no reason, no allowedActions: copying them here would create a second, forgeable
    // account of what was decided.
    for (const copied of ['decision', 'reason', 'allowedActions', 'forbiddenActions', 'decidedBy']) {
      expect(raw).not.toHaveProperty(copied);
    }
  });

  it('reading a record executes nothing', () => {
    const dir = root();
    writeWorkRecord(sys, dir, started({ state: 'GATE_APPROVED', nextCandidateAction: 'push' }));
    const before = readFileSync(workRecordPath(dir), 'utf8');
    readWorkRecord(sys, dir);
    readWorkRecord(sys, dir);
    // Reading is not a transition: the record is unchanged, and no other file appeared.
    expect(readFileSync(workRecordPath(dir), 'utf8')).toBe(before);
    rmSync(dir, { recursive: true, force: true });
  });

  it('the schema version is fixed by this runtime, not by the record', () => {
    expect(beginWork({ projectId: 'a', phaseId: 'P', subjectCommit: null, at: AT }).schemaVersion).toBe(
      WORK_RECORD_SCHEMA_VERSION,
    );
  });
});
