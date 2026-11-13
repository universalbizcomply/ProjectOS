import { describe, expect, it } from 'vitest';
import { deriveIdempotencyKey } from '../src/taskEnvelope.js';
import {
  admitRoutineRun,
  applyRunOutcome,
  deriveOccurrenceKey,
  enableRoutine,
  occurrenceIntentScope,
  scheduledInstant,
  type RoutineState,
} from '../src/routines/index.js';
import { admitted } from './routines-support.js';

const SLOT = '2026-11-13T09:00:00.000Z';

const stateOf = (): RoutineState => {
  const result = enableRoutine(null, admitted(), []);
  if (!result.ok) throw new Error('the control routine was refused');
  return result.state;
};

/** A claim port with a memory, the way the ledger will be: true the first time, false after. */
const ledger = (): { claim: (key: string) => boolean; seen: string[] } => {
  const seen: string[] = [];
  return {
    seen,
    claim: (key) => {
      if (seen.includes(key)) return false;
      seen.push(key);
      return true;
    },
  };
};

describe('a scheduled instant has one spelling', () => {
  it('reads an aware instant as UTC', () => {
    expect(scheduledInstant('2026-11-13T09:00:00Z')).toBe(SLOT);
    expect(scheduledInstant('2026-11-13T10:00:00+01:00')).toBe(SLOT);
  });

  it.each([
    ['one with no zone', '2026-11-13T09:00:00'],
    ['a date', '2026-11-13'],
    ['text', 'tomorrow at nine'],
    ['a number', 1_700_000_000_000],
    ['nothing', undefined],
  ])('gives %s no identity', (_name, value) => {
    expect(scheduledInstant(value)).toBeNull();
  });
});

describe('each occurrence derives one idempotency key', () => {
  const record = admitted();
  const base = { tenant: 'tenant-a', project: 'project-a', routineId: record.routineId, recordHash: record.recordHash, instant: SLOT };

  it('is the key the envelope would derive for the same intent', () => {
    const expected = deriveIdempotencyKey({
      tenant: 'tenant-a',
      project: 'project-a',
      action: 'run-start',
      subjectHash: record.recordHash,
      intentScope: occurrenceIntentScope(record.routineId, SLOT),
    });
    expect(deriveOccurrenceKey(base)).toBe(expected);
  });

  it('is the same for the same occurrence and different for the next one', () => {
    expect(deriveOccurrenceKey(base)).toBe(deriveOccurrenceKey({ ...base }));
    expect(deriveOccurrenceKey({ ...base, instant: '2026-11-16T09:00:00.000Z' })).not.toBe(deriveOccurrenceKey(base));
  });

  it('differs for another tenant, project, routine or record', () => {
    for (const change of [{ tenant: 'tenant-b' }, { project: 'project-b' }, { routineId: 'other' }, { recordHash: `sha256:${'b'.repeat(64)}` }]) {
      expect(deriveOccurrenceKey({ ...base, ...change })).not.toBe(deriveOccurrenceKey(base));
    }
  });
});

describe('a run is admitted once per occurrence', () => {
  const run = (claim: (key: string) => boolean, instant: unknown = SLOT, state: RoutineState = stateOf()) =>
    admitRoutineRun({ record: admitted(), state, instant }, claim);

  it('admits the first run of an occurrence, with its key and its own budget: the control', () => {
    const { claim, seen } = ledger();
    const result = run(claim);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.occurrenceKey).toBe(seen[0]);
      expect(result.runBudgetCents).toBe(25);
      expect(result.instant).toBe(SLOT);
    }
  });

  it('refuses a replayed occurrence as a duplicate', () => {
    const { claim } = ledger();
    run(claim);
    const replay = run(claim);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('OCCURRENCE_DUPLICATE');
  });

  it('refuses the same occurrence spelled with another offset', () => {
    const { claim } = ledger();
    run(claim);
    const replay = run(claim, '2026-11-13T10:00:00+01:00');
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('OCCURRENCE_DUPLICATE');
  });

  it('admits the next occurrence', () => {
    const { claim } = ledger();
    run(claim);
    expect(run(claim, '2026-11-16T09:00:00Z').ok).toBe(true);
  });

  it('refuses an instant the schedule never fires at, so a slot cannot be invented', () => {
    const { claim, seen } = ledger();
    const result = run(claim, '2026-11-13T09:01:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OCCURRENCE_NOT_SCHEDULED');
    expect(seen).toEqual([]);
  });

  it('refuses an instant with no identity', () => {
    const result = run(ledger().claim, '2026-11-13T09:00:00');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OCCURRENCE_NOT_SCHEDULED');
  });

  it('never runs a disabled routine, and claims nothing for it', () => {
    const { claim, seen } = ledger();
    const disabled = Array.from({ length: 10 }).reduce<RoutineState>((state) => applyRunOutcome(state, 'failed').state, stateOf());
    const result = run(claim, SLOT, disabled);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROUTINE_DISABLED');
    expect(seen).toEqual([]);
  });

  it('refuses a state that belongs to another routine or record', () => {
    const other = enableRoutine(null, admitted({ recordId: 'RTN-other-v1', routineId: 'other' }), []);
    if (!other.ok) throw new Error('control');
    const result = run(ledger().claim, SLOT, other.state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROUTINE_MISMATCH');
  });

  it('refuses a record the reader did not admit', () => {
    const result = admitRoutineRun({ record: { ...admitted() }, state: stateOf(), instant: SLOT }, ledger().claim);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RECORD_NOT_ADMITTED');
  });
});
