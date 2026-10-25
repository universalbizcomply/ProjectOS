// @vitest-environment jsdom
/**
 * A SENTENCE THAT DESCRIBES WORK THAT WILL NEVER HAPPEN IS A LIE, HOWEVER POLITELY IT IS WORDED.
 *
 * Observed directly against a real unsigned packaged build: the window opened, the daemon was
 * refused before it started — which is the correct design, failure is refusal — and the owner was
 * shown "Reading the list of projects on this computer…" for ever. The screen had one waiting state
 * and no way to stop waiting, so silence and progress looked identical.
 *
 * These tests pin the three cases apart: no bridge at all, a bridge that has not answered YET, and a
 * bridge that has not answered at all. The third says so, and says what it does not know.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ProjectsScreen } from '../src/ux/ProjectsScreen';
import type { ProjectsModel } from '../src/ux/projectsModel';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The bridge the desktop shell exposes; its absence is what `hasLocalHost()` reads. */
function withDesktopBridge(present: boolean): void {
  if (present) vi.stubGlobal('__TAURI_INTERNALS__', {});
  else vi.unstubAllGlobals();
}

function model(over: Partial<ProjectsModel> = {}): ProjectsModel {
  return {
    rows: [],
    unknown: true,
    empty: true,
    registryProblem: null,
    refusedCount: 0,
    ...over,
  } as unknown as ProjectsModel;
}

function renderScreen(m: ProjectsModel) {
  return render(<ProjectsScreen model={m} onOpen={() => {}} onAddProject={() => {}} />);
}

describe('waiting for the runtime', () => {
  test('before the wait is up it says it is reading, which is true', () => {
    vi.useFakeTimers();
    withDesktopBridge(true);
    renderScreen(model());
    expect(screen.getByText(/Reading the list of projects/)).toBeTruthy();
    expect(screen.queryByText(/could not start its runtime/)).toBeNull();
  });

  test('once nothing has answered it says so, and stops claiming to be reading', () => {
    vi.useFakeTimers();
    withDesktopBridge(true);
    renderScreen(model());
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.queryByText(/Reading the list of projects/)).toBeNull();
    expect(screen.getByText(/could not start its runtime/)).toBeTruthy();
  });

  test('it reports its own silence, never a diagnosis it cannot establish', () => {
    vi.useFakeTimers();
    withDesktopBridge(true);
    renderScreen(model());
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    const said = document.body.textContent ?? '';
    // "Nothing answered" is a fact about our waiting. An empty list is a different claim entirely,
    // and the owner's records being untouched is the thing they will actually worry about.
    expect(said).toContain('Nothing answered');
    expect(said).toContain('not an empty list');
    expect(said).toContain('untouched');
  });

  test('an answer that arrives clears the waiting state rather than latching it', () => {
    vi.useFakeTimers();
    withDesktopBridge(true);
    const { rerender } = renderScreen(model());
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText(/could not start its runtime/)).toBeTruthy();
    rerender(<ProjectsScreen model={model({ unknown: false })} onOpen={() => {}} onAddProject={() => {}} />);
    expect(screen.queryByText(/could not start its runtime/)).toBeNull();
  });

  test('with no desktop bridge at all the message is the browser one, and never becomes a runtime failure', () => {
    vi.useFakeTimers();
    withDesktopBridge(false);
    renderScreen(model());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/cannot reach them/)).toBeTruthy();
    expect(screen.queryByText(/could not start its runtime/)).toBeNull();
    expect(screen.queryByText(/Reading the list of projects/)).toBeNull();
  });
});
