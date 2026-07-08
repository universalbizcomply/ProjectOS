/**
 * Phase store: persist core Phase objects as JSON under .projectops/phases/<id>.json.
 *
 * A Phase is plain immutable data, so persistence is just JSON round-tripping through the
 * System adapter. Kept separate from the command so it can be reused and tested directly.
 */
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import type { Phase } from '@projectos/core';

export function phasesDir(root: string): string {
  return join(projectopsDir(root), 'phases');
}

export function phasePath(root: string, id: string): string {
  return join(phasesDir(root), `${id}.json`);
}

export function loadPhase(sys: System, root: string, id: string): Phase | null {
  const text = sys.readText(phasePath(root, id));
  if (text === null) return null;
  try {
    return JSON.parse(text) as Phase;
  } catch {
    return null;
  }
}

export function savePhase(sys: System, root: string, phase: Phase): void {
  sys.writeText(phasePath(root, phase.phaseId), JSON.stringify(phase, null, 2) + '\n');
}

export function listPhaseIds(sys: System, root: string): readonly string[] {
  return sys
    .listDir(phasesDir(root))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}
