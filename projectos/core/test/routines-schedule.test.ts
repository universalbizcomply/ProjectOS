import { describe, expect, it } from 'vitest';
import {
  ROUTINE_MINIMUM_INTERVAL_MS,
  ROUTINE_SCAN_OCCURRENCES,
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

describe('the fifteen-minute floor over the next 200 occurrences', () => {
  it('states the floor and the scan length as constants', () => {
    expect(ROUTINE_MINIMUM_INTERVAL_MS).toBe(15 * MINUTE);
    expect(ROUTINE_SCAN_OCCURRENCES).toBe(200);
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
