import { describe, expect, it } from 'vitest';
import {
  ROUTINE_MINIMUM_INTERVAL_MS,
  checkScheduleFloor,
  isScheduledInstant,
  nextRoutineOccurrence,
  parseCron,
} from '../src/routines/index.js';
import { at } from './routines-support.js';

const MINUTE = 60_000;

describe('the five-field cron reader', () => {
  it('reads a plain five-field expression', () => {
    expect(parseCron('0 9 * * 1-5').ok).toBe(true);
  });

  it.each([
    ['four fields', '0 9 * *'],
    ['six fields', '0 0 9 * * *'],
    ['a macro', '@daily'],
    ['a minute past 59', '60 * * * *'],
    ['an hour past 23', '0 24 * * *'],
    ['a day of month of 0', '0 0 0 * *'],
    ['a month past 12', '0 0 1 13 *'],
    ['a step of 0', '*/0 * * * *'],
    ['a backwards range', '30-10 * * * *'],
    ['a last-day marker', '0 0 L * *'],
    ['a question mark', '0 0 ? * *'],
    ['an empty list item', '1,,2 * * * *'],
    ['a signed number', '-5 * * * *'],
    ['an expression over the length cap', `${'1,'.repeat(200)}1 * * * *`],
  ])('refuses %s as unreadable', (_name, cron) => {
    const result = parseCron(cron);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SCHEDULE_UNREADABLE');
  });

  it('treats a value that is not a string as unreadable', () => {
    expect(parseCron(undefined as unknown as string).ok).toBe(false);
  });
});

describe('the fifteen-minute floor', () => {
  it('states the floor as a constant', () => {
    expect(ROUTINE_MINIMUM_INTERVAL_MS).toBe(15 * MINUTE);
  });

  it('refuses a schedule whose closest pair is 14 minutes apart', () => {
    const verdict = checkScheduleFloor('0,14 * * * *', 'UTC');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('SCHEDULE_TOO_FREQUENT');
  });

  it('admits a schedule whose closest pair is 15 minutes apart: the control at the floor', () => {
    expect(checkScheduleFloor('0,15 * * * *', 'UTC').ok).toBe(true);
    expect(checkScheduleFloor('*/15 * * * *', 'UTC').ok).toBe(true);
  });

  it('refuses a step that wraps into a short gap', () => {
    expect(checkScheduleFloor('*/14 * * * *', 'UTC').ok).toBe(false);
    expect(checkScheduleFloor('*/50 * * * *', 'UTC').ok).toBe(false);
  });

  it('refuses every-minute and every-five-minute schedules', () => {
    expect(checkScheduleFloor('* * * * *', 'UTC').ok).toBe(false);
    expect(checkScheduleFloor('*/5 * * * *', 'UTC').ok).toBe(false);
  });

  it('refuses a pair that is close on the day it fires, whatever the hour', () => {
    expect(checkScheduleFloor('45,55 8 * * *', 'UTC').ok).toBe(false);
  });

  it('does not depend on when the question is asked', () => {
    const early = nextRoutineOccurrence('45,55 8 * * *', 'UTC', at('2026-11-13T08:00:00Z'));
    const between = nextRoutineOccurrence('45,55 8 * * *', 'UTC', at('2026-11-13T08:50:00Z'));
    expect(early.ok).toBe(false);
    expect(between.ok).toBe(false);
  });

  it('reads past the first pair: a gap that only shows on the third occurrence is refused', () => {
    expect(checkScheduleFloor('15,30,44 * * * *', 'UTC').ok).toBe(false);
  });

  it('refuses a wrap across midnight that the first 200 occurrences from 2024 never meet', () => {
    // Fires Monday 23:59 and Tuesday 00:00 on the odd days of the month: 2025-03-31 then 2025-04-01, one minute apart.
    const verdict = checkScheduleFloor('0,59 0,23 */2 * 1,2', 'UTC');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('SCHEDULE_TOO_FREQUENT');
  });

  it('refuses a wrap across a month end and a year end', () => {
    expect(checkScheduleFloor('59,0 23,0 31,1 * *', 'UTC').ok).toBe(false);
  });

  it('refuses a wrap across midnight on two weekdays in a row', () => {
    expect(checkScheduleFloor('0,59 23,0 * * 1,2', 'UTC').ok).toBe(false);
  });

  it('admits a near-midnight pair when the days it needs never follow one another: the controls for the wrap', () => {
    expect(checkScheduleFloor('0,59 0,23 * * 1', 'UTC').ok).toBe(true);
    expect(checkScheduleFloor('0,59 23,0 * * 1,3', 'UTC').ok).toBe(true);
    expect(checkScheduleFloor('59 23 * * *', 'UTC').ok).toBe(true);
  });

  it('refuses an expression that never fires', () => {
    const verdict = checkScheduleFloor('0 0 31 2 *', 'UTC');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('SCHEDULE_NEVER_FIRES');
  });

  it('admits a sparse schedule that fires on a leap day', () => {
    expect(checkScheduleFloor('0 0 29 2 *', 'UTC').ok).toBe(true);
  });

  it('knows only UTC, and refuses another zone rather than guess', () => {
    const verdict = checkScheduleFloor('0 9 * * *', 'Europe/London');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('SCHEDULE_TIMEZONE');
  });
});

describe('the next occurrence', () => {
  it('is strictly after the time asked, even when that time is an occurrence', () => {
    const first = nextRoutineOccurrence('*/15 * * * *', 'UTC', at('2026-11-13T12:00:00Z'));
    expect(first.ok && first.at).toBe(at('2026-11-13T12:15:00Z'));
  });

  it('finds the next leap day', () => {
    const next = nextRoutineOccurrence('0 0 29 2 *', 'UTC', at('2025-01-01T00:00:00Z'));
    expect(next.ok && next.at).toBe(at('2028-02-29T00:00:00Z'));
  });

  it('fires on the day of the month or the day of the week when both are given', () => {
    const next = nextRoutineOccurrence('0 0 1 * 1', 'UTC', at('2026-11-13T12:00:00Z'));
    expect(next.ok && new Date(next.at).getUTCDay()).toBe(1);
  });

  it('reads day and month names, and Sunday as 0 or 7', () => {
    const weekdays = nextRoutineOccurrence('0 9 * * MON-FRI', 'UTC', at('2026-11-13T12:00:00Z'));
    expect(weekdays.ok && new Date(weekdays.at).getUTCDay()).toBe(1);
    const sunday = nextRoutineOccurrence('0 9 * * 7', 'UTC', at('2026-11-13T12:00:00Z'));
    expect(sunday.ok && new Date(sunday.at).getUTCDay()).toBe(0);
    expect(parseCron('0 9 1 JAN-MAR *').ok).toBe(true);
  });

  it('counts years 0 to 99 as the years they are, not as 1900 to 1999', () => {
    const early = new Date(0);
    early.setUTCFullYear(50, 0, 1);
    const expected = new Date(0);
    expected.setUTCFullYear(50, 1, 1);
    const next = nextRoutineOccurrence('0 0 1 * *', 'UTC', early.getTime());
    expect(next.ok && next.at).toBe(expected.getTime());
  });

  it('refuses a too-frequent schedule when asked for its next occurrence', () => {
    expect(nextRoutineOccurrence('*/5 * * * *', 'UTC', at('2026-11-13T12:00:00Z')).ok).toBe(false);
  });

  it("says whether an instant is one of the schedule's occurrences", () => {
    const parsed = parseCron('0 9 * * 1-5');
    if (!parsed.ok) throw new Error('control cron did not parse');
    expect(isScheduledInstant(parsed.schedule, at('2026-11-13T09:00:00Z'))).toBe(true);
    expect(isScheduledInstant(parsed.schedule, at('2026-11-13T09:01:00Z'))).toBe(false);
    expect(isScheduledInstant(parsed.schedule, at('2026-11-13T09:00:30Z'))).toBe(false);
    expect(isScheduledInstant(parsed.schedule, at('2026-11-14T09:00:00Z'))).toBe(false);
  });
});
