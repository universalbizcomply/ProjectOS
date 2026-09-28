// @vitest-environment jsdom
/**
 * A PROJECT THAT IS NOT SELECTED STILL HAS A STATE, AND THE OWNER MAY SEE IT — PROJECTOS-FOUNDATION-GAPS1A.
 *
 * The daemon already takes a read-only summary of every registered project and the model already
 * binds it to the right row. The screen threw it away, so during a governed run — when selection is
 * refused — the owner could see nothing about any other project. These tests pin what the row now
 * says, and what it must never say: an unknown stays unknown, an unreadable project says why, a row
 * with no summary keeps its honest line, and drawing the list starts nothing.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProjectsScreen } from '../src/ux/ProjectsScreen';
import type { ProjectSummary } from '../src/governed/projectInventory';
import type { DormantProjectRow, LiveProjectRow, ProjectRow, ProjectsModel } from '../src/ux/projectsModel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function summary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    projectId: 'polygo',
    projectName: 'PolyGo',
    available: true,
    unavailableDetail: null,
    planStatus: 'PLAN READY',
    acceptedPhaseCount: 2,
    totalPhaseCount: 5,
    activePhaseId: 'POLYGO-BOOKING-PANEL1A',
    blockerCount: 0,
    firstBlocker: null,
    ownerActionRequired: false,
    nextSafeAction: 'Continue the booking panel phase',
    liveness: 'UNKNOWN',
    observedAt: '2026-09-28T12:00:00.000Z',
    ...over,
  };
}

function dormant(s: ProjectSummary | null, projectId = 'polygo', projectName = 'PolyGo'): DormantProjectRow {
  return { live: false, projectId, projectName, repository: 'owner/polygo', selected: false, summary: s };
}

function live(): LiveProjectRow {
  return {
    live: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: 'owner/projectos',
    selected: true,
    status: 'Working',
    planLabel: 'Plan 1.7',
    stepLabel: 'Step 1 of 1',
    ownerActionRequired: false,
    ownerActionSummary: null,
    hasProblem: false,
    problemSummary: null,
  };
}

function model(rows: readonly ProjectRow[]): ProjectsModel {
  return { rows, empty: rows.length === 0, unknown: false, registryProblem: null, refusedCount: 0 };
}

function renderRows(rows: readonly ProjectRow[], onOpen: (id: string) => void = () => {}) {
  return render(<ProjectsScreen model={model(rows)} onOpen={onOpen} onAddProject={() => {}} />);
}

function text(): string {
  return document.body.textContent ?? '';
}

describe('a project that is not selected shows its summary', () => {
  test('every recorded fact is shown: plan, phases, active phase, blockers, owner action, next step, worker', () => {
    renderRows([dormant(summary())]);
    const said = text();
    expect(said).toContain('Plan: PLAN READY');
    expect(said).toContain('2 of 5 phases accepted');
    expect(said).toContain('Active phase: POLYGO-BOOKING-PANEL1A');
    expect(said).toContain('No blockers');
    expect(said).toContain('Nothing waiting on you');
    expect(said).toContain('Next: Continue the booking panel phase');
    expect(said).toContain('Worker status not known');
    expect(said).not.toContain('Open to see what is happening here');
  });

  test('a recorded blocker is named, and further ones are counted rather than hidden', () => {
    renderRows([dormant(summary({ blockerCount: 3, firstBlocker: 'Waiting for the booking API key' }))]);
    expect(text()).toContain('Blocked: Waiting for the booking API key (and 2 more)');
    expect(text()).not.toContain('No blockers');
  });

  test('a decision waiting on the owner says so, in the row and beside the name', () => {
    renderRows([dormant(summary({ ownerActionRequired: true }))]);
    expect(text()).toContain('Waiting on your decision');
    expect(screen.getByText('Needs you')).toBeTruthy();
  });

  test('absent values stay absent: no phase active, and counts or status that were not read are not known', () => {
    renderRows([
      dormant(
        summary({
          activePhaseId: null,
          acceptedPhaseCount: null,
          totalPhaseCount: 5,
          planStatus: null,
          nextSafeAction: null,
        }),
      ),
    ]);
    const said = text();
    expect(said).toContain('No phase active');
    expect(said).toContain('phase count not known');
    expect(said).toContain('Plan: status not known');
    expect(said).toContain('Next step not known');
  });
});

describe('liveness is exactly what the summary reports', () => {
  test('RUNNING is shown as running', () => {
    renderRows([dormant(summary({ liveness: 'RUNNING' }))]);
    expect(text()).toContain('Running now');
    expect(text()).not.toContain('not known');
  });

  test('UNKNOWN is shown as not known — never idle, stopped or not running', () => {
    renderRows([dormant(summary({ liveness: 'UNKNOWN' }))]);
    const said = text();
    expect(said).toContain('Worker status not known');
    for (const invented of [/idle/i, /stopped/i, /not running/i]) {
      expect(said).not.toMatch(invented);
    }
  });
});

describe('an unreadable project says so, in the daemon’s words', () => {
  test('the daemon-provided detail is shown, and nothing reads as healthy', () => {
    renderRows([
      dormant(summary({ available: false, unavailableDetail: 'project config unreadable', planStatus: null })),
    ]);
    const said = text();
    expect(said).toContain('ProjectOS could not read this project');
    expect(said).toContain('project config unreadable');
    expect(said).not.toContain('No blockers');
    expect(said).not.toContain('Nothing waiting on you');
    expect(said).not.toContain('Plan:');
  });

  test('with no detail it says none was given rather than inventing one', () => {
    renderRows([dormant(summary({ available: false, unavailableDetail: null }))]);
    expect(text()).toContain('No reason was given');
  });
});

describe('the honest line and the live row are unchanged', () => {
  test('a row with no summary keeps: Open to see what is happening here', () => {
    renderRows([dormant(null)]);
    expect(screen.getByText('Open to see what is happening here')).toBeTruthy();
  });

  test('a summary never bleeds into the selected project’s row, which keeps its full projection', () => {
    renderRows([live(), dormant(summary({ blockerCount: 1, firstBlocker: 'Dormant-only blocker' }))]);
    const rows = document.querySelectorAll('li.ux-projrow');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('Plan 1.7 · Step 1 of 1');
    expect(rows[0]?.textContent).not.toContain('Dormant-only blocker');
    expect(rows[1]?.textContent).toContain('Blocked: Dormant-only blocker');
  });
});

describe('the summary is plain text and drawing it starts nothing', () => {
  test('markup inside a summary field is shown as text, and no field becomes a link', () => {
    const hostile = '<img src=x onerror="alert(1)"><a href="https://example.invalid">click</a>';
    const { container } = renderRows([
      dormant(summary({ firstBlocker: hostile, blockerCount: 1, nextSafeAction: hostile, activePhaseId: hostile })),
      dormant(summary({ available: false, unavailableDetail: hostile }), 'other', 'Other'),
    ]);
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelectorAll('a').length).toBe(0);
    expect(container.querySelectorAll('[href]').length).toBe(0);
    expect(text()).toContain(hostile);
  });

  test('rendering selects nothing, invokes no host command and makes no request; Open is an explicit click', () => {
    const invoke = vi.fn();
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const onOpen = vi.fn();
    const { rerender } = renderRows([dormant(summary({ liveness: 'RUNNING', ownerActionRequired: true }))], onOpen);
    rerender(
      <ProjectsScreen
        model={model([dormant(summary({ liveness: 'UNKNOWN' }))])}
        onOpen={onOpen}
        onAddProject={() => {}}
      />,
    );
    expect(onOpen).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('polygo');
  });
});
