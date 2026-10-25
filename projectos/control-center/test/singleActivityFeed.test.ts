/**
 * STAGE 6's CONTRACT, HELD BY A TEST RATHER THAN BY A MEMO.
 *
 * The rule is one generic activity/execution feed family, consumed by every surface that needs one.
 * That was true by reconciliation rather than by new code — the duplicate feed inside the old
 * Command Centre dashboard was deleted when the dashboard was — and a rule proven once by reading
 * the source is a rule that quietly breaks later. So it is asserted against the source itself.
 *
 * WHAT IS DELIBERATELY NOT COVERED BY THE RULE. Two things render events and are not feeds:
 *
 *   - Plan Detail shows a PHASE's own recorded transitions and the sessions run against it. That is
 *     per-step evidence, keyed to one phase, and folding it into a project-wide feed would lose the
 *     very association that makes it evidence.
 *   - The retained governed-actions surface streams a live worker's stdout/stderr. That is a
 *     console watching a process, not a record of what happened.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const rel = (p: string): string => p.slice(SRC.length + 1).replace(/\\/g, '/');

describe('exactly one generic activity feed exists', () => {
  test('only one file declares an ActivityFeed', () => {
    const declaring = FILES.filter((f) => /export function ActivityFeed\b/.test(f.text)).map((f) => rel(f.path));
    expect(declaring).toEqual(['ux/ProjectHome.tsx']);
  });

  test('every recorded-item reader goes through the ONE shared source', () => {
    /*
     * `recordedItems` IS the feed's model, and the rule is one SOURCE — not one reader.
     *
     * This asserted a single caller, which held while `ActivityFeed` was the only surface needing
     * recorded work. The JARVIS command-centre HUD needs a compact projection of the same history
     * beside the operator, and the honest way to build it was to read this function rather than
     * derive a second list from `phases` — which is exactly what a second feed engine looks like.
     *
     * RETARGETED, NOT RELAXED. The list stays closed and every member is named, so a THIRD caller
     * still fails. `commandHudModel` is a projection, not a source: it owns no history of its own
     * and cannot disagree with the feed, because both read the same function.
     */
    const derivers = FILES.filter(
      (f) => /\brecordedItems\s*\(/.test(f.text) && !rel(f.path).startsWith('owner/workspaceModel'),
    ).map((f) => rel(f.path)).sort();
    expect(derivers).toEqual(['ux/ProjectHome.tsx', 'ux/commandHudModel.ts']);
  });

  test('the HUD projects that source and does not invent a second history', () => {
    const hud = FILES.find((f) => rel(f.path) === 'ux/commandHudModel.ts')!;
    // It reads the shared function...
    expect(/\brecordedItems\s*\(/.test(hud.text)).toBe(true);
    // ...and never walks the phase records itself, which is how a second feed would begin.
    expect(/state\.phases\b/.test(hud.text)).toBe(false);
    expect(/phase\.history/.test(hud.text)).toBe(false);
  });

  test('the feed is consumed by the surfaces that need one, from that single source', () => {
    const consumers = FILES.filter((f) => /<ActivityFeed\b/.test(f.text)).map((f) => rel(f.path)).sort();
    expect(consumers).toEqual(['ux/ControlCenter.tsx', 'ux/ProjectHome.tsx']);
  });

  test('Health reports execution from the projection, and does not add a second feed', () => {
    const health = FILES.find((f) => rel(f.path) === 'ux/healthModel.ts')!;
    expect(/\brecordedItems\s*\(/.test(health.text)).toBe(false);
    const screen = FILES.find((f) => rel(f.path) === 'ux/HealthScreen.tsx')!;
    expect(/<ActivityFeed\b/.test(screen.text)).toBe(false);
  });
});

describe('step-local evidence is a different thing, and stays different', () => {
  test('Plan Detail reads a phase’s own history and sessions, not the project-wide feed', () => {
    const detail = FILES.find((f) => rel(f.path) === 'ux/PlanDetail.tsx')!;
    expect(detail.text).toContain('phase.history');
    expect(/<ActivityFeed\b/.test(detail.text)).toBe(false);
    expect(/\brecordedItems\s*\(/.test(detail.text)).toBe(false);
  });
});

describe('owner-word mappings are single-sourced', () => {
  test('every surface maps state to words through workspaceModel, never with its own copy', () => {
    // A local re-implementation is how two screens start disagreeing about the same phase.
    for (const f of FILES) {
      const name = rel(f.path);
      if (name === 'owner/workspaceModel.ts') continue;
      for (const fn of ['planStateOf', 'stateFromStatus', 'connectionStatus', 'coreLabel']) {
        if (new RegExp(`function ${fn}\\b`).test(f.text)) {
          throw new Error(`${name} re-implements ${fn}; it must import it from workspaceModel`);
        }
      }
    }
    expect(true).toBe(true);
  });
});
