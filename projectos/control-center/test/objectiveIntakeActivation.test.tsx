// @vitest-environment jsdom
/**
 * OWNER-WORKFLOW-PLAN-ACTIVATION1A — the owner surface must be truthful about what it can do.
 *
 * The risk this guards is not a crash. It is a screen that reads as though a browser could approve a
 * plan, or that reports success the runtime never granted. So these assert wording and verbatim
 * reporting, which are the properties an owner actually relies on.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const sent: Array<{ verb: string; args: Record<string, unknown> }> = [];
let reply: { ok: boolean; lines: readonly string[] } = { ok: true, lines: ['ok'] };

vi.mock('../src/governed/governedClient', () => ({
  requestGovernedCommand: (_bridge: unknown, verb: string, args: Record<string, unknown>) => {
    sent.push({ verb, args });
    return Promise.resolve(reply);
  },
}));
vi.mock('../src/daemon/tauriBridge', () => ({ tauriBridge: {} }));

const { ObjectiveIntake } = await import('../src/owner/ObjectiveIntake.js');

afterEach(() => {
  cleanup();
  sent.length = 0;
  reply = { ok: true, lines: ['ok'] };
});

function mount() {
  return render(<ObjectiveIntake projectName="ProjectOS" repository="universalbizcomply/ProjectOS" drafts={[]} />);
}

function typeInto(el: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the owner surface never claims to approve', () => {
  test('the activation control says ACTIVATE, never APPROVE', () => {
    mount();
    const button = screen.getByRole('button', { name: /activate approved plan/i });
    expect(button).toBeTruthy();
    // No control anywhere offers to approve.
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/^\s*approve/i);
    }
  });

  test('it states plainly that approving is not something this screen does', () => {
    mount();
    expect(document.body.textContent).toMatch(/approving is a separate, recorded decision/i);
    expect(document.body.textContent).toMatch(/not something this screen can do/i);
  });

  test('activation is unavailable until BOTH identifiers are supplied', () => {
    mount();
    const button = screen.getByRole('button', { name: /activate approved plan/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    typeInto(screen.getByLabelText('Draft'), 'draft-20260813-a1b2c3');
    expect(button.disabled).toBe(true);
    typeInto(screen.getByLabelText('Decision'), 'PROJECTOS-DECISION1A');
    expect(button.disabled).toBe(false);
  });

  test('it sends plan.activate with the two identifiers and NOTHING else', async () => {
    mount();
    typeInto(screen.getByLabelText('Draft'), 'draft-20260813-a1b2c3');
    typeInto(screen.getByLabelText('Decision'), 'PROJECTOS-DECISION1A');
    await act(async () => {
      screen.getByRole('button', { name: /activate approved plan/i }).click();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.verb).toBe('plan.activate');
    expect(Object.keys(sent[0]!.args).sort()).toEqual(['decisionId', 'draftId']);
    // No role, no approver, no path, no authority of any kind.
    for (const forbidden of ['role', 'approver', 'decision', 'planPath', 'delegation', 'note']) {
      expect(sent[0]!.args).not.toHaveProperty(forbidden);
    }
  });

  test('a runtime REFUSAL is shown verbatim and never softened into success', async () => {
    reply = {
      ok: false,
      lines: ['REFUSED (NO_DECISION): this draft was not approved.', "no committed plan-approval decision exists for draft 'draft-1'."],
    };
    mount();
    typeInto(screen.getByLabelText('Draft'), 'draft-20260813-a1b2c3');
    typeInto(screen.getByLabelText('Decision'), 'PROJECTOS-DECISION1A');
    await act(async () => {
      screen.getByRole('button', { name: /activate approved plan/i }).click();
    });
    const status = screen.getAllByRole('status').map((n) => n.textContent ?? '').join('\n');
    expect(status).toContain('REFUSED (NO_DECISION): this draft was not approved.');
    expect(status).toContain("no committed plan-approval decision exists for draft 'draft-1'.");
    // The refusal is rendered as a failure, not as an activated plan.
    expect(status).not.toMatch(/activated|PLAN READY/i);
  });

  test('success is the runtime’s own words, not an optimistic local state', async () => {
    reply = { ok: true, lines: ['Plan activated.', 'planStatus: PLAN READY'] };
    mount();
    typeInto(screen.getByLabelText('Draft'), 'draft-20260813-a1b2c3');
    typeInto(screen.getByLabelText('Decision'), 'PROJECTOS-DECISION1A');
    await act(async () => {
      screen.getByRole('button', { name: /activate approved plan/i }).click();
    });
    const status = screen.getAllByRole('status').map((n) => n.textContent ?? '').join('\n');
    expect(status).toContain('Plan activated.');
    expect(status).toContain('planStatus: PLAN READY');
  });
});
