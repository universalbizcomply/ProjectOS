/**
 * THE HUD MAY LOOK LIKE THE REFERENCE. IT MAY NOT INVENT WHAT THE REFERENCE SHOWS.
 *
 * The owner's command-centre reference carries CPU 23%, MEMORY 41%, NETWORK 68%, DISK 37%, a
 * "100% OPERATIONAL" gauge, "DATABASE SYNCED", and six AI agents marked ACTIVE. ProjectOS measures
 * none of that and has no agent registry. A gauge is the most dangerous thing in a design like this,
 * because it looks exactly the same whether it is measured or made up — and once it is on screen an
 * owner will believe it.
 *
 * So the rule for this HUD is simple and testable: every operational value comes from a source that
 * already exists, and where the reference shows a number ProjectOS cannot know, the absence is
 * stated instead of filled.
 *
 * These tests do not check that it looks futuristic — the live browser proves that. They check that
 * nothing on it is a lie.
 *
 * Created in PROJECTOS-JARVIS-VISUAL-RESTORATION1A.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCommandHud } from '../src/ux/commandHudModel';
import type { GovernedProjectsInventory, GovernedProjection } from '../src/governed/types';

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.2', declaredStatus: 'APPROVED', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 3, totalPhaseCount: 7, completionPercentage: 43, completedPhases: [], pendingPhases: [] },
    phases: [], activePhase: null, nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [], planDrafts: [], sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: ['production.deploy'], approvalGates: ['send', 'production'] },
    blockers: [], risks: [], nextSafeAction: 'Continue.',
    observedAt: '2026-08-26T18:40:00.000Z',
    ...over,
  } as GovernedProjection;
}

const inventory = (n: number, selected: string | null): GovernedProjectsInventory =>
  ({
    projects: Array.from({ length: n }, (_, i) => ({ projectId: i === 0 ? 'polygo' : `p${i}`, projectName: i === 0 ? 'PolyGo' : `Project ${i}` })),
    selectedProjectId: selected,
  }) as GovernedProjectsInventory;

/** Everything the HUD can print, flattened, so a claim cannot hide in a panel nobody checked. */
function allText(hud: ReturnType<typeof buildCommandHud>): string {
  return JSON.stringify(hud);
}

describe('nothing the reference invented is reproduced', () => {
  const hud = buildCommandHud(projection(), inventory(6, 'polygo'));
  const text = allText(hud);

  test.each([
    ['CPU telemetry', /\bCPU\b\s*[:=]?\s*\d/i],
    ['memory telemetry', /\bMEMORY\b\s*[:=]?\s*\d/i],
    ['network telemetry', /\bNETWORK\b\s*[:=]?\s*\d/i],
    ['disk telemetry', /\bDISK\b\s*[:=]?\s*\d/i],
    ['a 100% operational gauge', /100%\s*OPERATIONAL/i],
    ['a database sync claim', /DATABASE\s+SYNCED/i],
    ['named AI agents', /(PLANNER|BUILDER|TESTER|REVIEWER|REPORTER)\s*AI/i],
  ])('the HUD never shows %s', (_label, pattern) => {
    expect(text).not.toMatch(pattern);
  });

  test('the absence of telemetry is stated, not quietly omitted', () => {
    expect(hud.telemetryNote).toMatch(/NOT INSTRUMENTED/);
    expect(hud.telemetryNote).toMatch(/CPU, memory, disk and network/i);
  });
});

describe('a progress bar is only drawn where progress is actually known', () => {
  test('only the project ProjectOS is reporting on gets a percentage', () => {
    const hud = buildCommandHud(projection(), inventory(6, 'polygo'));
    const withPercent = hud.projects.filter((p) => p.percent !== null);
    expect(withPercent.length).toBe(1);
    expect(withPercent[0]!.name).toBe('PolyGo');
    expect(withPercent[0]!.percent).toBe(43);
  });

  test('every other project says what IS known instead of showing an invented bar', () => {
    const hud = buildCommandHud(projection(), inventory(6, 'polygo'));
    for (const p of hud.projects.filter((x) => !x.selected)) {
      expect(p.percent).toBe(null);
      expect(p.note).toBe('not reporting');
    }
  });

  test('with a project selected but NOT reporting, no percentage is claimed for it either', () => {
    const hud = buildCommandHud(null, inventory(3, 'polygo'));
    expect(hud.projects.every((p) => p.percent === null)).toBe(true);
  });
});

describe('with no runtime the HUD says so rather than showing a healthy system', () => {
  const hud = buildCommandHud(null, null);

  test('capabilities are not reporting', () => {
    expect(hud.capabilities.map((c) => c.value)).toEqual(['Not reporting']);
  });

  test('the feed is empty and says why', () => {
    expect(hud.feed).toEqual([]);
    expect(hud.feedNote).not.toBe(null);
  });

  test('the project list is empty and says why', () => {
    expect(hud.projects).toEqual([]);
    expect(hud.projectsNote).not.toBe(null);
  });

  test('no panel claims a good state', () => {
    const text = allText(hud);
    expect(text).not.toMatch(/\bONLINE\b/i);
    expect(text).not.toMatch(/\bOPERATIONAL\b/i);
    expect(text).not.toMatch(/\bSYNCED\b/i);
  });
});

describe('the safety panel prints the real record', () => {
  test('it reports the freeze, the gates and the forbidden actions from the projection', () => {
    const hud = buildCommandHud(projection(), inventory(1, 'polygo'));
    const values = hud.capabilities.map((c) => `${c.label}=${c.value}`).join(' | ');
    expect(values).toContain('Live site=Frozen');
    expect(values).toContain('send · production');
    expect(values).toContain('production.deploy');
  });

  test('an UNFROZEN live site is reported as a problem, not smoothed over', () => {
    const hud = buildCommandHud(projection({ safety: { productionFreeze: false, forbiddenActions: [], approvalGates: [] } } as Partial<GovernedProjection>), inventory(1, 'polygo'));
    const site = hud.capabilities.find((c) => c.label === 'Live site')!;
    expect(site.value).toBe('NOT frozen');
    expect(site.tone).toBe('problem');
  });
});

describe('the HUD is a projection, never a source or a second console', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'ux', 'CommandHud.tsx'), 'utf8');

  test('it dispatches no governed command and reaches no network', () => {
    for (const forbidden of [/requestGovernedCommand/, /tauriBridge/, /\bfetch\s*\(/, /XMLHttpRequest/]) {
      expect(src).not.toMatch(forbidden);
    }
  });

  test('it renders no control at all — the composer stays the only command surface', () => {
    expect(src).not.toMatch(/<button/);
    expect(src).not.toMatch(/onClick/);
    expect(src).not.toMatch(/<input/);
  });
});
