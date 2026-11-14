// Origin: original ProjectOS code
/**
 * Every wait is bounded (PROJECTOS-PORT-RESEARCH1A, fix round).
 *
 * The core opens no timer, so a call to a planner, a provider, a resolver or a port is made through the injected
 * `TimerPort`. `callWithin` gives the call a wall-clock budget and a signal, and answers one of three things: a value, a
 * timeout, or an error. A missing timer, a timer that throws, and a timer that answers with anything that is not a result
 * are all an error, so a broken timer ends the call and never lets it through.
 *
 * A budget is only ever LOWERED by the caller: `timeoutOf` takes the smaller of the default and what was asked.
 */

import type { TimerPort } from './ports.js';

export interface ResearchTimeouts {
  readonly dnsMs: number;
  /** Per fetch hop, on top of the timeout the port is given. */
  readonly fetchMs: number;
  readonly searchMs: number;
  readonly plannerMs: number;
}

export const DEFAULT_TIMEOUTS: ResearchTimeouts = { dnsMs: 5_000, fetchMs: 32_000, searchMs: 20_000, plannerMs: 60_000 };

const isBudget = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** The default, or something shorter. A value that is not a whole positive number is ignored. */
export function timeoutOf(asked: Partial<ResearchTimeouts> | undefined, which: keyof ResearchTimeouts): number {
  const wanted = asked?.[which];
  return isBudget(wanted) ? Math.min(wanted, DEFAULT_TIMEOUTS[which]) : DEFAULT_TIMEOUTS[which];
}

export type Timed<T> = { readonly kind: 'value'; readonly value: T } | { readonly kind: 'timeout' } | { readonly kind: 'error' };

export async function callWithin<T>(timer: TimerPort | undefined, ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<Timed<T>> {
  if (typeof timer?.within !== 'function' || !isBudget(ms)) return { kind: 'error' };
  let result: unknown;
  try {
    result = await timer.within(ms, work);
  } catch {
    return { kind: 'error' };
  }
  const row = result as { done?: unknown; value?: unknown } | null;
  if (typeof row !== 'object' || row === null) return { kind: 'error' };
  if (row.done === false) return { kind: 'timeout' };
  return row.done === true ? { kind: 'value', value: row.value as T } : { kind: 'error' };
}
