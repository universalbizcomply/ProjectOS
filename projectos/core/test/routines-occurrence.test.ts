import { describe, expect, it } from 'vitest';
import { deriveIdempotencyKey } from '../src/taskEnvelope.js';
import {
  MAX_ROUTINE_WINDOW_BUDGET_CENTS,
  ROUTINE_CATCH_UP_WINDOW_MS,
  ROUTINE_MINIMUM_INTERVAL_MS,
  admitRoutineRun,
  applyRunOutcome,
  deriveOccurrenceKey,
  enableRoutine,
  occurrenceIntentScope,
  scheduledInstant,
  type RoutineState,
  type RunPorts,
} from '../src/routines/index.js';
import { admitted, at, committedRegistry, fakePorts, registryWith } from './routines-support.js';

const SLOT = '2026-11-13T09:00:00.000Z';
/** Five minutes after the slot: the dispatcher is on time. */
const NOW = at('2026-11-13T09:05:00Z');
const MINUTE = 60_000;

const stateOf = (): RoutineState => {
  const result = enableRoutine(null, admitted(), []);
  if (!result.ok) throw new Error('the control routine was refused');
  return result.state;
};

const registry = committedRegistry();
const run = (
  ports: RunPorts,
  instant: unknown = SLOT,
  over: { tenant?: string; state?: RoutineState; reg?: typeof registry; record?: ReturnType<typeof admitted> } = {},
) => {
  const record = over.record ?? admitted();
  const state = over.state ?? (enableRoutine(null, record, []) as { state: RoutineState }).state;
  return admitRoutineRun({ record, state, instant, tenant: over.tenant ?? 'tenant-a', registry: over.reg ?? registry }, ports);
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
  it('admits the first run of an occurrence, with its key and its own budget: the control', () => {
    const { ports, claimed } = fakePorts(NOW);
    const result = run(ports);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...claimed][0]).toBe(result.occurrenceKey);
      expect(result.runBudgetCents).toBe(25);
      expect(result.instant).toBe(SLOT);
    }
  });

  it('refuses a replayed occurrence as a duplicate', () => {
    const { ports, open } = fakePorts(NOW);
    run(ports);
    open.clear();
    const replay = run(ports);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('OCCURRENCE_DUPLICATE');
  });

  it('refuses the same occurrence spelled with another offset', () => {
    const { ports, open } = fakePorts(NOW);
    run(ports);
    open.clear();
    const replay = run(ports, '2026-11-13T10:00:00+01:00');
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('OCCURRENCE_DUPLICATE');
  });

  it('admits the next occurrence', () => {
    let now = NOW;
    const { ports, open } = fakePorts(NOW, { now: () => now });
    run(ports);
    open.clear();
    now = at('2026-11-16T09:05:00Z');
    expect(run(ports, '2026-11-16T09:00:00Z').ok).toBe(true);
  });

  it('refuses an instant the schedule never fires at, so a slot cannot be invented', () => {
    const { ports, claimed } = fakePorts(NOW);
    const result = run(ports, '2026-11-13T09:01:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OCCURRENCE_NOT_SCHEDULED');
    expect(claimed.size).toBe(0);
  });

  it('refuses an instant with no identity', () => {
    const result = run(fakePorts(NOW).ports, '2026-11-13T09:00:00');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OCCURRENCE_NOT_SCHEDULED');
  });

  it('never runs a disabled routine, and claims nothing for it', () => {
    const { ports, claimed } = fakePorts(NOW);
    const disabled = Array.from({ length: 10 }).reduce<RoutineState>((state) => applyRunOutcome(state, 'failed').state, stateOf());
    const result = run(ports, SLOT, { state: disabled });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROUTINE_DISABLED');
    expect(claimed.size).toBe(0);
  });

  it('refuses a state that belongs to another routine or record', () => {
    const other = enableRoutine(null, admitted({ recordId: 'RTN-other-v1', routineId: 'other' }), []);
    if (!other.ok) throw new Error('control');
    const result = run(fakePorts(NOW).ports, SLOT, { state: other.state });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROUTINE_MISMATCH');
  });

  it('refuses a record the reader did not admit', () => {
    const result = admitRoutineRun({ record: { ...admitted() }, state: stateOf(), instant: SLOT, tenant: 'tenant-a', registry }, fakePorts(NOW).ports);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RECORD_NOT_ADMITTED');
  });
});

describe('a run is bounded in time', () => {
  it('refuses a scheduled instant in the future, a slot of the schedule that is years away', () => {
    const result = run(fakePorts(NOW).ports, '2050-01-03T09:00:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OCCURRENCE_IN_FUTURE');
  });

  it('refuses the first instant of 2050 for a routine that fires every day at midnight', () => {
    const midnight = admitted({ cron: '0 0 * * *' });
    const result = run(fakePorts(NOW).ports, '2050-01-01T00:00:00Z', { record: midnight });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OCCURRENCE_IN_FUTURE');
  });

  it('refuses the next slot before its time has come', () => {
    const result = run(fakePorts(at('2026-11-13T08:59:59Z')).ports);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OCCURRENCE_IN_FUTURE');
  });

  it('admits a slot exactly at the catch-up window, and refuses one a minute older', () => {
    expect(run(fakePorts(at('2026-11-13T09:00:00Z') + ROUTINE_CATCH_UP_WINDOW_MS).ports).ok).toBe(true);
    const late = run(fakePorts(at('2026-11-13T09:00:00Z') + ROUTINE_CATCH_UP_WINDOW_MS + MINUTE).ports);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.code).toBe('OCCURRENCE_TOO_OLD');
  });

  it('refuses a clock that does not answer a time', () => {
    for (const bad of [Number.NaN, 'now', undefined]) {
      const result = run(fakePorts(NOW, { now: () => bad as unknown as number }).ports);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PORT_ANSWER_INVALID');
    }
  });
});

describe('a routine has one run in flight, a spacing and a budget for the window', () => {
  it('refuses a second run of the routine while the first is open, and admits it once released', () => {
    const frequent = admitted({ cron: '*/15 * * * *' });
    const { ports } = fakePorts(at('2026-11-13T09:20:00Z'));
    expect(run(ports, '2026-11-13T09:15:00Z', { record: frequent }).ok).toBe(true);
    const second = run(ports, '2026-11-13T09:00:00Z', { record: frequent });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('RUN_IN_FLIGHT');
    ports.release('weekday-summary');
    expect(run(ports, '2026-11-13T09:00:00Z', { record: frequent }).ok).toBe(true);
  });

  it('does not leave the routine open when the occurrence turns out to be a duplicate', () => {
    const { ports, open } = fakePorts(NOW);
    run(ports);
    ports.release('weekday-summary');
    const replay = run(ports);
    expect(replay.ok).toBe(false);
    expect(open.size).toBe(0);
  });

  it('refuses a run too close to the last claimed occurrence, and admits one at the spacing floor', () => {
    const slot = at(SLOT);
    const soon = run(fakePorts(NOW, { lastClaimed: () => slot - 5 * MINUTE }).ports);
    expect(soon.ok).toBe(false);
    if (!soon.ok) expect(soon.code).toBe('RUN_TOO_SOON');
    expect(run(fakePorts(NOW, { lastClaimed: () => slot - ROUTINE_MINIMUM_INTERVAL_MS }).ports).ok).toBe(true);
  });

  it('refuses a run that takes the routine past its budget for the window, and admits one that reaches it', () => {
    const over = run(fakePorts(NOW, { spentSince: () => MAX_ROUTINE_WINDOW_BUDGET_CENTS - 24 }).ports);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('ROUTINE_WINDOW_BUDGET');
    expect(run(fakePorts(NOW, { spentSince: () => MAX_ROUTINE_WINDOW_BUDGET_CENTS - 25 }).ports).ok).toBe(true);
  });

  it('refuses spend the ledger cannot state', () => {
    for (const bad of [-1, Number.NaN, 'lots']) {
      const result = run(fakePorts(NOW, { spentSince: () => bad as unknown as number }).ports);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PORT_ANSWER_INVALID');
    }
  });
});

describe('a port answer is true or it is not a yes', () => {
  it('does not count a Promise from an async port as a claim', () => {
    const asyncClaim = (async () => true) as unknown as RunPorts['claim'];
    const result = run(fakePorts(NOW, { claim: asyncClaim }).ports);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PORT_ANSWER_INVALID');
  });

  it('does not count a truthy non-boolean as a claim or an open run', () => {
    expect(run(fakePorts(NOW, { claim: (() => 1) as unknown as RunPorts['claim'] }).ports).ok).toBe(false);
    expect(run(fakePorts(NOW, { tryOpen: (() => 'yes') as unknown as RunPorts['tryOpen'] }).ports).ok).toBe(false);
  });

  it('refuses a port that throws', () => {
    const result = run(fakePorts(NOW, { claim: () => { throw new Error('ledger down'); } }).ports);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PORT_ANSWER_INVALID');
  });
});

describe('the run is held to the tenant and the unattended ceiling by this function', () => {
  it('refuses a run for another tenant than the record names', () => {
    const { ports, claimed } = fakePorts(NOW);
    const result = run(ports, SLOT, { tenant: 'tenant-b' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TENANT_MISMATCH');
    expect(claimed.size).toBe(0);
  });

  it('refuses the run, and tells the owner, when the registry makes the run action more than P2', () => {
    const raised = registryWith({ 'run-start': { class: 'P3' } });
    const { ports, sent, claimed } = fakePorts(NOW);
    const result = run(ports, SLOT, { reg: raised });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNATTENDED_GATED_ACTION');
    expect(sent).toHaveLength(1);
    expect(claimed.size).toBe(0);
  });
});
