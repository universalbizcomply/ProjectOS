/**
 * Phase store: persist core Phase objects as JSON under .projectops/phases/<id>.json.
 *
 * A Phase is plain immutable data, so persistence is just JSON round-tripping through the
 * System adapter. Kept separate from the command so it can be reused and tested directly.
 */
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import { PHASE_TRANSITIONS, type Phase, type PhaseStatus } from '@projectos/core';

/**
 * A phase id narrow enough to become a filename without traversing, hiding or colliding.
 *
 * THE SAME PATTERN THIS PROJECT ALREADY USES for closure waits, owner-gate receipts and degraded
 * grants -- and the one place it was missing was the store every phase record goes through. The
 * plan schema constrains `phaseId` to a non-empty string and nothing more, `join` in `context.ts`
 * is a naive concatenation that neither normalises nor rejects a parent-directory segment, and
 * `System.writeText` creates whatever directory it is handed. An owner-approved plan carrying one
 * in a phase id was therefore an arbitrary local file write, and the incidental session-id check
 * that screened it on a fresh run is skipped entirely on `--resume`.
 *
 * Enforced HERE rather than at each caller, so every reader and writer of a record inherits it.
 */
const SAFE_PHASE_ID = /^[A-Za-z0-9_-]{4,128}$/;

export function isSafePhaseId(phaseId: string): boolean {
  return SAFE_PHASE_ID.test(phaseId);
}

/**
 * Is this parsed JSON actually a phase?
 *
 * `JSON.parse(...) as Phase` is an assertion, not a check. A record with an unrecognised `status`
 * made `isTerminal` read `PHASE_TRANSITIONS[status].length` off `undefined`, and a missing
 * `history` made a transition spread a non-iterable -- both uncaught, both crashing an unattended
 * run from inside the bookkeeping that promises never to fail one. A record that is not a phase is
 * treated as unreadable, which every caller already handles.
 */
function isPhase(value: unknown): value is Phase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['phaseId'] !== 'string' || typeof v['project'] !== 'string') return false;
  if (typeof v['objective'] !== 'string') return false;
  if (typeof v['status'] !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(PHASE_TRANSITIONS, v['status'] as PhaseStatus)) return false;
  return Array.isArray(v['history']);
}

export function phasesDir(root: string): string {
  return join(projectopsDir(root), 'phases');
}

export function phasePath(root: string, id: string): string {
  return join(phasesDir(root), `${id}.json`);
}

export function loadPhase(sys: System, root: string, id: string): Phase | null {
  if (!isSafePhaseId(id)) return null;
  const text = sys.readText(phasePath(root, id));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isPhase(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist a phase record. Returns false, writing nothing, when the id cannot safely be a filename. */
export function savePhase(sys: System, root: string, phase: Phase): boolean {
  if (!isSafePhaseId(phase.phaseId)) return false;
  sys.writeText(phasePath(root, phase.phaseId), JSON.stringify(phase, null, 2) + '\n');
  return true;
}

export function listPhaseIds(sys: System, root: string): readonly string[] {
  return sys
    .listDir(phasesDir(root))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter(isSafePhaseId)
    .sort();
}
