/**
 * Validator watcher — pure. Interprets a validator result marker (JSON written by whatever
 * validation runner the project uses) into a validator state. The daemon only *observes*
 * validation; it never runs project validators as production commands.
 */
import type { ValidatorState } from '../types.js';

export interface ValidatorReading {
  readonly state: ValidatorState;
  /** True when a run just completed (pass or fail) — a trigger for VALIDATION_COMPLETED. */
  readonly completed: boolean;
}

/**
 * Parse a validator marker. Recognised shapes:
 *   { "status": "running" | "pass" | "fail" }
 *   { "result": "pass" | "fail", "running": false }
 * Anything unrecognised → unknown/not-completed.
 */
export function readValidatorMarker(rawJson: string | null): ValidatorReading {
  if (rawJson === null || rawJson.trim().length === 0) {
    return { state: 'unknown', completed: false };
  }
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (parsed === null || typeof parsed !== 'object') return { state: 'unknown', completed: false };
    obj = parsed as Record<string, unknown>;
  } catch {
    return { state: 'unknown', completed: false };
  }

  const status = obj['status'];
  if (status === 'running') return { state: 'running', completed: false };
  if (status === 'pass' || obj['result'] === 'pass') return { state: 'pass', completed: true };
  if (status === 'fail' || obj['result'] === 'fail') return { state: 'fail', completed: true };
  return { state: 'unknown', completed: false };
}
