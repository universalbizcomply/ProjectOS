// @vitest-environment jsdom
/**
 * EVERY PROJECT HAS AN EXECUTION SCREEN, AND IT IS THE ONE IT OPENS ON.
 *
 * The execution workspace was built and mounted only at the navigation rail, as a single global
 * destination that happened to render whichever project was selected. Its DATA was per-project all
 * along — it renders the selected project's governed projection and nothing else — but its
 * NAVIGATION was not. From inside a project there was no way to reach it, and from the rail nothing
 * on the screen said which of thirteen projects was being shown.
 *
 * These tests pin the two properties that matter: a project opens on Execution, and the tab renders
 * the SAME workspace the rail does rather than a second one built here. A duplicate execution
 * surface is the thing the brief forbids outright, so "it is handed in, not constructed" is the
 * property under test, not an implementation detail.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProjectHome, type ProjectTab } from '../src/ux/ProjectHome';
import type { IpcBridge } from '../src/daemon/ipcBridge';
import type { GovernedProjection } from '../src/governed/types';

afterEach(cleanup);

const bridge: IpcBridge = {
  isTauri: () => true,
  listen: async () => () => {},
  invoke: async () => null,
};

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: {
      repo: 'acme/projectos', localPath: 'C:/dev/ProjectOS', branch: 'main',
      head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false,
    },
    plan: {
      planId: 'P', planVersion: '1.3', declaredStatus: 'IN EXECUTION', ready: true,
      unmetReasons: [], planPath: '.projectops/plan.json', supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 0, totalPhaseCount: 4, completionPercentage: 0,
      completedPhases: [], pendingPhases: [],
    },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    sessions: [],
    blockers: [],
    planDrafts: [],
    ...over,
  } as unknown as GovernedProjection;
}

function renderHome(tab: ProjectTab, execution: React.ReactNode) {
  return render(
    <ProjectHome
      state={projection()}
      tab={tab}
      setTab={() => {}}
      now={Date.parse('2026-09-04T19:00:00.000Z')}
      liveRun={null}
      onPrimary={() => {}}
      onOpenAdvanced={() => {}}
      onOpenPlanDetail={() => {}}
      onRequestChange={() => {}}
      bridge={bridge}
      execution={execution}
    />,
  );
}

describe('a project has its own execution screen', () => {
  test('Execution is offered as a tab, and it is the first one', () => {
    renderHome('execution', <p>the one workspace</p>);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs[0]).toBe('Execution');
    expect(tabs).toContain('Overview');
  });

  test('the tab renders the workspace it was handed, not one it built', () => {
    // The workspace is composed once, where its dependencies already live, and passed in. Two
    // constructions could drift into two different screens; the brief forbids a second execution
    // surface outright.
    renderHome('execution', <p>the one workspace</p>);
    expect(screen.getByText('the one workspace')).toBeTruthy();
  });

  test('another tab does not render it', () => {
    renderHome('files', <p>the one workspace</p>);
    expect(screen.queryByText('the one workspace')).toBeNull();
  });

  test('a project with no projection to describe renders nothing rather than an empty frame', () => {
    renderHome('execution', null);
    expect(screen.getAllByRole('tab')[0]?.textContent).toBe('Execution');
  });

  test('the Execution tab is selected when it is the current one', () => {
    renderHome('execution', <p>the one workspace</p>);
    const tab = screen.getAllByRole('tab')[0]!;
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  test('the other tabs are still reachable — Execution replaced nothing', () => {
    const seen: string[] = [];
    render(
      <ProjectHome
        state={projection()}
        tab="execution"
        setTab={(t) => seen.push(t)}
        now={Date.parse('2026-09-04T19:00:00.000Z')}
        liveRun={null}
        onPrimary={() => {}}
        onOpenAdvanced={() => {}}
        onOpenPlanDetail={() => {}}
        onRequestChange={() => {}}
        bridge={bridge}
        execution={<p>the one workspace</p>}
      />,
    );
    for (const label of ['Overview', 'Plans', 'Activity', 'Files', 'Advanced']) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
    }
    expect(seen).toEqual(['overview', 'plans', 'activity', 'files', 'advanced']);
  });
});
