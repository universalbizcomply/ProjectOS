// Origin: original ProjectOS code
/**
 * The one way this directory reads time. A clock is handed in by the caller and read once per decision; nothing here
 * reads the system clock, sets a timer or sleeps.
 *
 * A TIME THAT CANNOT BE TRUSTED IS NO TIME. The answer must be a whole, non-negative, safe number of milliseconds that a
 * `Date` can name, and it must not be earlier than `floor`, the latest time this module has already seen. A clock that
 * throws, answers NaN, Infinity, a fraction, a negative, a Promise or a time before the floor gives `null`, and every
 * caller refuses on `null`. So a clock that runs backwards can neither extend a grant nor un-expire one.
 *
 * Pure: no I/O.
 */

/** Milliseconds since the epoch, from the caller's clock. */
export type ComputerClock = () => number;

/** The last instant a `Date` can name. A time past it cannot be written as an ISO instant, so it is not a time. */
const LAST_INSTANT_MS = 8_640_000_000_000_000;

/** The injected time, or `null` when it is not a usable time at or after `floor`. */
export function readComputerClock(clock: ComputerClock, floor = 0): number | null {
  let now: unknown;
  try {
    now = clock();
  } catch {
    return null;
  }
  if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0 || now > LAST_INSTANT_MS || now < floor) return null;
  return now;
}
