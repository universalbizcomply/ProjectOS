// @vitest-environment jsdom
/**
 * No phase-stage action may claim to do work it does not do.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, found by driving the installed application. The primary action on
 * Owner Control was labelled "Run validation". It dispatches `phase.advance` with `toStatus:
 * 'validating'` — a recorded status transition and nothing else. No validator runs; there is no
 * validation verb in GOVERNED_VERBS at all, and `projectos validate` is a separate CLI command this
 * surface cannot reach. An owner who clicked it and saw the phase become "validating" would
 * reasonably conclude the code had been checked.
 *
 * It was never one bad label. Every entry in the map was imperative — "Collect evidence", "Send for
 * review" — and each made the same promise about work the button does not perform. So these tests
 * cover ALL SIX mappings, and assert the two halves that matter together: the visible wording is
 * honest, AND the dispatched command is unchanged. A future change that quietly wires execution
 * behind any of these buttons has to fail here.
 *
 * Driven through the mounted component, not by reading source strings: every assertion goes through
 * render + role queries + a real click.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { GovernedActions } from '../src/owner/GovernedActions.js';
import * as governedClient from '../src/governed/governedClient.js';
import { GOVERNED_VERBS } from '../src/governed/governedCommands.js';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STAGE_ONLY_NOTE =
  'This only changes the recorded phase stage. It does not perform the work or send anything.';

/** Every mapped lifecycle step: the status shown, what it must say, and where it must go. */
const LIFECYCLE = [
  { from: 'draft', label: 'Record prompt ready', to: 'prompted' },
  { from: 'prompted', label: 'Move to implementation', to: 'implementing' },
  { from: 'implementing', label: 'Move to validation', to: 'validating' },
  { from: 'validating', label: 'Move to evidence', to: 'evidence' },
  { from: 'evidence', label: 'Move to review', to: 'awaiting_review' },
  { from: 'awaiting_review', label: 'Move to closure review', to: 'awaiting_closure' },
] as const;

/** The imperative wording that each of these replaced. None may reappear on a mounted surface. */
const OLD_MISLEADING_LABELS = [
  'Prepare the phase prompt',
  'Begin implementation',
  'Run validation',
  'Collect evidence',
  'Send for review',
  'Send for closure',
] as const;

function projection(status: string): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: {
      repo: 'universalbizcomply/ProjectOS',
      localPath: 'C:/dev/ProjectOS',
      branch: 'projectos-post-v3-selfhost-pilot1a',
      head: 'a'.repeat(40),
      protectedBranches: ['main'],
      onProtectedBranch: false,
    },
    plan: {
      planId: 'projectos-operational-recovery-plan',
      planVersion: '1.0',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'projectos/state/projectos-recovery.plan.json',
      supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 4,
      totalPhaseCount: 6,
      completionPercentage: 66.7,
      completedPhases: [],
      pendingPhases: [],
    },
    phases: [],
    activePhase: {
      phaseId: 'PROJECTOS-RECOVERY-INSTALLED-APP1A',
      status,
      startable: false,
    } as GovernedProjection['activePhase'],
    nextStartablePhase: null,
    authority: {
      owner: 'Murad',
      gatekeeper: 'ChatGPT',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      closureDelegation: null,
      ownerOnlyActions: [],
    },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-13T14:00:00.000Z',
  } as GovernedProjection;
}

describe.each(LIFECYCLE)('the $from stage action tells the truth', ({ from, label, to }) => {
  test(`shows "${label}" and none of the old imperative labels`, () => {
    render(<GovernedActions state={projection(from)} />);
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
    for (const old of OLD_MISLEADING_LABELS) {
      expect(screen.queryByRole('button', { name: old }), `"${old}" must not be mounted`).toBeNull();
    }
  });

  test('shows the stage-only explanation as the button\'s accessible description', () => {
    render(<GovernedActions state={projection(from)} />);
    const note = screen.getByText(STAGE_ONLY_NOTE);
    const button = screen.getByRole('button', { name: label });
    // Not merely present somewhere on the page — bound to the control, so a screen-reader user
    // receives it with the button rather than after it.
    expect(button.getAttribute('aria-describedby')).toBe(note.getAttribute('id'));
    expect(note.getAttribute('id')).toBeTruthy();
    expect(document.querySelectorAll(`#${note.getAttribute('id')}`).length).toBe(1);
  });

  test(`still dispatches phase.advance to "${to}" as implementer — copy changed, behaviour did not`, async () => {
    const spy = vi
      .spyOn(governedClient, 'requestGovernedCommand')
      .mockResolvedValue({ ok: true, lines: ['ok'] } as never);
    render(<GovernedActions state={projection(from)} />);
    fireEvent.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [, verb, args] = spy.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>];
    expect(verb).toBe('phase.advance');
    expect(args['toStatus']).toBe(to);
    expect(args['role']).toBe('implementer');
    expect(args['phaseId']).toBe('PROJECTOS-RECOVERY-INSTALLED-APP1A');
  });
});

describe('the panel offers no route to execution', () => {
  test('exactly one primary stage action is offered', () => {
    render(<GovernedActions state={projection('implementing')} />);
    const primaries = Array.from(document.querySelectorAll('button.ocp-btn.primary'));
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toBe('Move to validation');
  });

  test('no validation, execution or shell verb exists in the governed channel', () => {
    // The honest fix was to correct the wording, NOT to add a way to run validators from the
    // browser. If a future change adds one it must be a deliberate governed decision, not a side
    // effect of making these buttons read better.
    for (const verb of GOVERNED_VERBS) {
      expect(verb).not.toMatch(/validate|validation|exec|shell|command|spawn/i);
    }
  });

  test('genuine non-stage actions are untouched', () => {
    render(<GovernedActions state={projection('implementing')} />);
    // Refresh really does refresh; Stop really does stop. Neither was renamed.
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});
