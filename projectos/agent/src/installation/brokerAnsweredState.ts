/**
 * Did the provider already answer this question?
 *
 * WHY THIS EXISTS (C11-W2-F7). The project's cost ledger cannot answer it. A reservation is marked
 * unresolved when it is written, and settlement clears the mark by replacing the entry — but
 * settlement can silently fail to take the ledger lock, which this codebase's own notes call an
 * everyday Windows occurrence. The mark then still says "unresolved" for a call that was answered,
 * and the retry gate would ask a paid reviewer the same question a second time: a real double charge
 * the ledger never shows, and a second verdict that may contradict the first one the loop already
 * acted on.
 *
 * THE FACT IS ALREADY DURABLE, IN THE RIGHT PLACE. The transport broker reserves a row in the
 * INSTALLATION's own spend record before it dispatches, and marks that row `answered` before it hands
 * the reply back. That record lives outside every governed project, is written by the broker rather
 * than by anything a project controls, and survives the loss of any project-side lock. So the
 * question is not re-derived here; it is read from the party that actually knows.
 *
 * IT IS READ ONLY. Nothing in this file writes to the broker's record or reserves anything. Adding a
 * second writer to a file whose whole value is that one trusted process owns it would be its own
 * defect.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A for C11-W2-F7.
 */
import { join } from 'node:path';
import type { System } from '../system.js';

/** Where the broker keeps the installation's own record of what it has spent and answered. */
export const BROKER_SPEND_FILE = 'gatekeeper-spend.json';

/**
 * What the installation's record says about one request.
 *
 * `unknown` is not a failure to be smoothed over — it is the answer whenever the record cannot be
 * read or parsed, and it must fail safe. Not knowing whether a reviewer already answered is exactly
 * the state in which asking again is unsafe.
 */
export type BrokerAnsweredState = 'answered' | 'not-answered' | 'unknown';

export function readBrokerAnsweredState(
  sys: System,
  stateDir: string | null,
  request: { readonly requestId: string; readonly projectId: string; readonly phaseId: string },
): BrokerAnsweredState {
  if (stateDir === null || stateDir.trim() === '') return 'unknown';
  const raw = sys.readText(join(stateDir, BROKER_SPEND_FILE));
  // ABSENT IS NOT "NOT ANSWERED". A missing record is a record that cannot be consulted, and this
  // installation may simply be one whose broker has never run — or one whose state directory moved.
  // Either way nothing here knows, and `unknown` is the honest answer.
  if (raw === null) return 'unknown';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'unknown';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'unknown';
  const calls = (parsed as Record<string, unknown>)['calls'];
  if (!Array.isArray(calls)) return 'unknown';

  const row = calls.find(
    (c): c is Record<string, unknown> =>
      typeof c === 'object' &&
      c !== null &&
      !Array.isArray(c) &&
      (c as Record<string, unknown>)['requestId'] === request.requestId &&
      (c as Record<string, unknown>)['projectId'] === request.projectId &&
      (c as Record<string, unknown>)['phaseId'] === request.phaseId,
  );
  // A ROW THAT IS NOT THERE IS A CALL THE BROKER NEVER RESERVED, and it reserves before it dispatches
  // — so no provider ever saw this question. The record itself was readable, which is what separates
  // this from the `unknown` cases above.
  if (row === undefined) return 'not-answered';
  return row['outcome'] === 'answered' ? 'answered' : 'not-answered';
}
