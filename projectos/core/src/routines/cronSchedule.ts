// SPDX-License-Identifier: MIT
// Ported-From: copilotkit-openbot https://github.com/CopilotKit/OpenBot
// Source-Path: server/src/routines/schedule.ts
// Source-Commit: c396a5f68c817043846f1ca3c2b42061ee73ceb5
// Source-Copyright: Copyright (c) 2026 CopilotKit
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: the cron-parser dependency replaced by a five-field reader and an occurrence walk written here, so core stays dependency-free; UTC is the only zone, and another zone is refused instead of guessed; milliseconds in and out in place of Date objects and thrown errors; an expression that never fires is refused; day and month names, 7 as Sunday and the day-of-month or day-of-week rule are stated here; the describeCron wording helper, the memo caches and the second pair measure, which only a daylight-saving shift needs, were not ported
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The routine schedule: a hard five-field cron, and a floor that no record, model or caller can lower.
 *
 * THE FLOOR IS A CONSTANT. Upstream: "A model can be talked into anything; the floor cannot." A schedule
 * that would run more often than every 15 minutes in any of its next 200 occurrences is refused. There is
 * no argument that changes the number, and a record has no field for it.
 *
 * ACCEPTANCE IS A PROPERTY OF THE EXPRESSION, NOT OF THE CLOCK. The 200 occurrences are walked from a fixed
 * leap-year start, so `45,55 8 * * *` is refused when asked about at 08:50 as well as at 08:00. A check
 * sampled from "now" would accept at some hours what it refuses at others. Upstream also measures the pair
 * ahead of the asking time, as a backstop for a gap that only appears under a daylight-saving shift. UTC has
 * no shift, so that second measure is not ported.
 *
 * FIVE FIELDS OR NONE. Macros (`@daily`), seconds or year fields, `?`, `L`, `W` and `#` are unreadable here.
 *
 * WHAT THIS MODULE CANNOT PROVE. It reads only UTC. A routine that must follow a local clock waits for the
 * zone-aware parser that comes with the Stage 4 wiring. Nothing here runs a schedule: it answers what the
 * next occurrence would be and whether an expression may be approved, and holds no clock and no timer.
 */

/** Routines may run at most this often. */
export const ROUTINE_MINIMUM_INTERVAL_MS = 15 * 60 * 1000;

/** How many successive occurrences the floor scan walks. */
export const ROUTINE_SCAN_OCCURRENCES = 200;

const MINUTE_MS = 60_000;
const MAX_CRON_CHARS = 256;
/** A leap-year start, so expressions pinned to 29 February are scanned on days they actually fire. */
const FLOOR_SCAN_START = Date.UTC(2024, 0, 1);
/** A walk gives up this far on: past a full Gregorian cycle, an expression that has not fired never will. */
const WALK_HORIZON_MS = 400 * 366 * 24 * 60 * MINUTE_MS;

export type ScheduleRefusalCode = 'SCHEDULE_UNREADABLE' | 'SCHEDULE_TIMEZONE' | 'SCHEDULE_TOO_FREQUENT' | 'SCHEDULE_NEVER_FIRES';

export interface ScheduleRefusal {
  readonly ok: false;
  readonly code: ScheduleRefusalCode;
  readonly message: string;
}

export interface CronSchedule {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number>;
  /** A field that does not start with `*` restricts the day; when both day fields do, either one may match. */
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
}

export type CronResult = { readonly ok: true; readonly schedule: CronSchedule } | ScheduleRefusal;
export type ScheduleFloorResult = { readonly ok: true } | ScheduleRefusal;
export type NextOccurrenceResult = { readonly ok: true; readonly at: number } | ScheduleRefusal;

const refused = (code: ScheduleRefusalCode, message: string): ScheduleRefusal => ({ ok: false, code, message });
const UNREADABLE = refused('SCHEDULE_UNREADABLE', 'That schedule could not be read.');
const UNKNOWN_ZONE = refused('SCHEDULE_TIMEZONE', 'Routines run on UTC only, so that timezone is refused.');
const TOO_FREQUENT = refused('SCHEDULE_TOO_FREQUENT', 'Routines may run at most every 15 minutes.');
const NEVER_FIRES = refused('SCHEDULE_NEVER_FIRES', 'That schedule never fires.');

interface FieldSpec {
  readonly min: number;
  readonly max: number;
  readonly names: readonly string[];
  /** The number the first name stands for. */
  readonly nameBase: number;
}

const MINUTES: FieldSpec = { min: 0, max: 59, names: [], nameBase: 0 };
const HOURS: FieldSpec = { min: 0, max: 23, names: [], nameBase: 0 };
const DAYS_OF_MONTH: FieldSpec = { min: 1, max: 31, names: [], nameBase: 1 };
const MONTHS: FieldSpec = { min: 1, max: 12, names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], nameBase: 1 };
/** 0 to 7: both 0 and 7 are Sunday, as in crontab. */
const DAYS_OF_WEEK: FieldSpec = { min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], nameBase: 0 };

const ITEM = /^(\*|[A-Za-z0-9]{1,3}(?:-[A-Za-z0-9]{1,3})?)(?:\/(\d{1,2}))?$/;
const PLAIN_NUMBER = /^\d{1,2}$/;

function valueOf(text: string, spec: FieldSpec): number | null {
  if (PLAIN_NUMBER.test(text)) {
    const value = Number.parseInt(text, 10);
    return value >= spec.min && value <= spec.max ? value : null;
  }
  const named = spec.names.indexOf(text.toUpperCase());
  return named < 0 ? null : named + spec.nameBase;
}

function itemValues(item: string, spec: FieldSpec): readonly number[] | null {
  const parts = ITEM.exec(item);
  if (parts === null) return null;
  const [, base, stepText] = parts;
  if (base === undefined) return null;
  const step = stepText === undefined ? 1 : Number.parseInt(stepText, 10);
  if (step < 1) return null;
  let from = spec.min;
  let to = spec.max;
  if (base !== '*') {
    const [startText, endText] = base.split('-');
    const start = valueOf(startText ?? '', spec);
    if (start === null) return null;
    from = start;
    to = start;
    if (endText !== undefined) {
      const end = valueOf(endText, spec);
      if (end === null || end < start) return null;
      to = end;
    } else if (stepText !== undefined) {
      to = spec.max;
    }
  }
  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

function parseField(text: string, spec: FieldSpec): ReadonlySet<number> | null {
  const found = new Set<number>();
  for (const item of text.split(',')) {
    const values = itemValues(item, spec);
    if (values === null) return null;
    values.forEach((value) => found.add(value));
  }
  return found;
}

/** Read a five-field cron expression. Anything else, including a macro or a sixth field, is unreadable. */
export function parseCron(cron: string): CronResult {
  if (typeof cron !== 'string' || cron.length > MAX_CRON_CHARS) return UNREADABLE;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return UNREADABLE;
  const [minuteText, hourText, dayText, monthText, weekText] = fields as [string, string, string, string, string];
  const minutes = parseField(minuteText, MINUTES);
  const hours = parseField(hourText, HOURS);
  const daysOfMonth = parseField(dayText, DAYS_OF_MONTH);
  const months = parseField(monthText, MONTHS);
  const week = parseField(weekText, DAYS_OF_WEEK);
  if (minutes === null || hours === null || daysOfMonth === null || months === null || week === null) return UNREADABLE;
  const daysOfWeek = new Set([...week].map((day) => day % 7));
  return {
    ok: true,
    schedule: {
      minutes,
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      dayOfMonthRestricted: !dayText.startsWith('*'),
      dayOfWeekRestricted: !weekText.startsWith('*'),
    },
  };
}

function dayMatches(schedule: CronSchedule, date: Date): boolean {
  const ofMonth = schedule.daysOfMonth.has(date.getUTCDate());
  const ofWeek = schedule.daysOfWeek.has(date.getUTCDay());
  return schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted ? ofMonth || ofWeek : ofMonth && ofWeek;
}

/** Is this instant one the schedule fires at? An instant off the minute never is. */
export function isScheduledInstant(schedule: CronSchedule, instant: number): boolean {
  if (!Number.isSafeInteger(instant) || instant % MINUTE_MS !== 0) return false;
  const date = new Date(instant);
  return (
    schedule.months.has(date.getUTCMonth() + 1) &&
    dayMatches(schedule, date) &&
    schedule.hours.has(date.getUTCHours()) &&
    schedule.minutes.has(date.getUTCMinutes())
  );
}

/** The first occurrence strictly after `after`, or null when none comes before `limit`. */
function nextAfter(schedule: CronSchedule, after: number, limit: number): number | null {
  let at = Math.floor(after / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  while (at <= limit) {
    const date = new Date(at);
    const [year, month, day, hour] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()];
    if (!schedule.months.has(month + 1)) {
      at = Date.UTC(year, month + 1, 1);
    } else if (!dayMatches(schedule, date)) {
      at = Date.UTC(year, month, day + 1);
    } else if (!schedule.hours.has(hour)) {
      at = Date.UTC(year, month, day, hour + 1);
    } else if (!schedule.minutes.has(date.getUTCMinutes())) {
      at += MINUTE_MS;
    } else {
      return at;
    }
  }
  return null;
}

/** Walk up to `count` occurrences after `start`, and say whether two of them sit under the floor. */
function floorOver(schedule: CronSchedule, start: number): ScheduleFloorResult {
  const limit = start + WALK_HORIZON_MS;
  let previous = nextAfter(schedule, start, limit);
  if (previous === null) return NEVER_FIRES;
  for (let seen = 1; seen < ROUTINE_SCAN_OCCURRENCES; seen += 1) {
    const current = nextAfter(schedule, previous, limit);
    if (current === null) return { ok: true };
    if (current - previous < ROUTINE_MINIMUM_INTERVAL_MS) return TOO_FREQUENT;
    previous = current;
  }
  return { ok: true };
}

/** May this schedule be approved? The same answer at any time of day. */
export function checkScheduleFloor(cron: string, timezone: string): ScheduleFloorResult {
  if (timezone !== 'UTC') return UNKNOWN_ZONE;
  const parsed = parseCron(cron);
  if (!parsed.ok) return parsed;
  return floorOver(parsed.schedule, FLOOR_SCAN_START);
}

/**
 * Parse, hold to the floor, and return the next occurrence after `after`. One function owns both acceptance
 * and scheduling, so what was accepted is always schedulable.
 */
export function nextRoutineOccurrence(cron: string, timezone: string, after: number): NextOccurrenceResult {
  const floor = checkScheduleFloor(cron, timezone);
  if (!floor.ok) return floor;
  const parsed = parseCron(cron);
  if (!parsed.ok) return parsed;
  if (!Number.isSafeInteger(after)) return UNREADABLE;
  const first = nextAfter(parsed.schedule, after, after + WALK_HORIZON_MS);
  return first === null ? NEVER_FIRES : { ok: true, at: first };
}
