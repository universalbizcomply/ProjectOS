// @vitest-environment jsdom
/**
 * OWNER-WORKFLOW-PLAN-ACTIVATION1A — the owner surface must be truthful about what it can do.
 *
 * The risk this guards is not a crash. It is a screen that reads as though a browser could approve a
 * plan, or that reports success the runtime never granted. So these assert wording and verbatim
 * reporting, which are the properties an owner actually relies on.
 *
 * WHAT CHANGED, AND WHY THE ASSERTIONS CHANGED WITH IT (PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-
 * DECISION1A). This screen used to say "approving is not something this screen can do", and that was
 * TRUE: the runtime could check a plan-approval decision and consume one, and nothing anywhere could
 * write one. Approve and Reject now exist, so repeating the old sentence would make the screen
 * untruthful in the opposite direction — which is exactly the failure this file exists to catch. The
 * property under test is unchanged: the surface must say what it really does. What it really does is
 * send a draft id and a verdict, and the runtime derives every field that carries authority.
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
    // ACTIVATION and APPROVAL stay different words for different acts. With no proposal on screen
    // there is nothing to approve, so no approve control exists either.
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/^\s*approve/i);
    }
  });

  test('Start Something New asks for AUTHORING, never for corpus import', async () => {
    // THE DEFECT THIS PINS. This screen sent only the objective, so the runtime answered it by
    // importing whatever the repository already described — the author was never reached and no
    // provider call could be made from the product. The screen exists to answer ONE objective with a
    // bounded proposal; that is the authored operation, and it now says so.
    mount();
    const box = screen.getByLabelText('Objective');
    typeInto(box, 'Create the smallest credible one-phase read-only plan and report on it please.');
    await act(async () => {
      screen.getByRole('button', { name: /propose a plan/i }).click();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.verb).toBe('plan.draft');
    expect(sent[0]!.args['authored']).toBe('true');
    // And nothing else: no project, no path, no authority of any kind.
    expect(Object.keys(sent[0]!.args).sort()).toEqual(['authored', 'objective']);
  });

  test('it states plainly that approving is a separate, recorded decision that is the owner’s', () => {
    mount();
    expect(document.body.textContent).toMatch(/approving is a separate, recorded decision/i);
    expect(document.body.textContent).toMatch(/yours alone to make/i);
    // AND IT NO LONGER CLAIMS THE OPPOSITE. The screen can now record a decision; saying it cannot
    // would be the same untruthfulness this file was written to prevent, pointing the other way.
    expect(document.body.textContent).not.toMatch(/not something this screen can do/i);
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


/**
 * REVIEW PLAN — the owner's two answers.
 *
 * The claim under test is NOT that a button exists. It is that pressing it sends a draft id and a
 * word, and that nothing this screen can send names a project, a digest, a decider or a path. A
 * caller that could name `decidedBy` would be naming the authority whose name confers the power.
 */
describe('the owner can decide, and can assert nothing while doing it', () => {
  const undecided = [
    {
      draftId: 'a1b2c3d4e5f60718',
      planStatus: 'PLAN DRAFTED',
      generatedAt: '2026-08-27T12:00:00.000Z',
      decisionState: 'none' as const,
      decisionId: null,
    },
  ];
  const approved = [{ ...undecided[0]!, decisionState: 'approved' as const, decisionId: 'PLANDEC-abcdef012345' }];
  const refused = [{ ...undecided[0]!, decisionState: 'refused' as const, decisionId: 'PLANDEC-abcdef012345' }];

  const mountWith = (drafts: readonly (typeof undecided)[number][]) =>
    render(
      <ObjectiveIntake
        projectName="ProjectOS"
        repository="universalbizcomply/ProjectOS"
        drafts={drafts as never}
      />,
    );

  test('an undecided proposal offers Approve and Reject, and NOT Activate', () => {
    mountWith(undecided);
    expect(screen.getByRole('button', { name: /^approve plan$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /activate this plan/i })).toBeNull();
  });

  test('an approved proposal offers Activate, and no second decision', () => {
    mountWith(approved);
    expect(screen.getByRole('button', { name: /activate this plan/i })).toBeTruthy();
    // A decision is not revisable, so the controls that would revise it are gone.
    expect(screen.queryByRole('button', { name: /^approve plan$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^reject$/i })).toBeNull();
  });

  test('a REJECTED proposal offers nothing, and is not deleted', () => {
    mountWith(refused);
    expect(screen.queryByRole('button', { name: /activate this plan/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^approve plan$/i })).toBeNull();
    // The proposal stays on screen as the evidence it is.
    expect(document.body.textContent).toContain('a1b2c3d4e5f60718');
    expect(document.body.textContent).toMatch(/does not approve this draft/i);
  });

  test('Approve sends plan.decide with the draft id and the verdict, and nothing else', async () => {
    mountWith(undecided);
    await act(async () => {
      screen.getByRole('button', { name: /^approve plan$/i }).click();
    });
    // The first click ASKS. Nothing has been decided yet.
    expect(sent).toHaveLength(0);
    await act(async () => {
      screen.getByRole('button', { name: /^confirm approve$/i }).click();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.verb).toBe('plan.decide');
    expect(sent[0]!.args).toEqual({ draftId: 'a1b2c3d4e5f60718', decision: 'approve' });
    for (const forbidden of ['decidedBy', 'projectId', 'planDigest', 'baseHead', 'role', 'planPath', 'decisionId']) {
      expect(sent[0]!.args).not.toHaveProperty(forbidden);
    }
  });

  test('Reject sends the same shape with the other verdict', async () => {
    mountWith(undecided);
    await act(async () => {
      screen.getByRole('button', { name: /^reject$/i }).click();
    });
    expect(sent).toHaveLength(0);
    await act(async () => {
      screen.getByRole('button', { name: /^confirm reject$/i }).click();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args).toEqual({ draftId: 'a1b2c3d4e5f60718', decision: 'reject' });
  });

  test('a refusal to record a decision is shown verbatim and never softened', async () => {
    reply = {
      ok: false,
      lines: [
        'REFUSED (DECISION_EXISTS): no decision was recorded.',
        '  - a decision has already been recorded for this proposal',
      ],
    };
    mountWith(undecided);
    await act(async () => {
      screen.getByRole('button', { name: /^approve plan$/i }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: /^confirm approve$/i }).click();
    });
    const status = screen.getAllByRole('status').map((n) => n.textContent ?? '').join('\n');
    expect(status).toContain('REFUSED (DECISION_EXISTS): no decision was recorded.');
    expect(status).not.toMatch(/approved|activated/i);
  });

  test('the technical record is available, and is behind Advanced', () => {
    mountWith(undecided);
    // The normal path is the summary and two buttons. The evidence is one disclosure away — a
    // governance surface that hides its own record is asking to be trusted rather than checked.
    const summary = screen.getByText(/view details/i);
    expect(summary.closest('details')).toBeTruthy();
    expect(document.body.textContent).toMatch(/authoring from your objective|importing what this repository/i);
  });

  test('a recorded decision is reported in the runtime’s own words', async () => {
    reply = { ok: true, lines: ['Murad approved this plan.', '  decision:      PLANDEC-abcdef012345'] };
    mountWith(undecided);
    await act(async () => {
      screen.getByRole('button', { name: /^approve plan$/i }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: /^confirm approve$/i }).click();
    });
    const status = screen.getAllByRole('status').map((n) => n.textContent ?? '').join('\n');
    expect(status).toContain('Murad approved this plan.');
    expect(status).toContain('PLANDEC-abcdef012345');
  });
});

/**
 * A decision is asked twice.
 *
 * ONE DECISION PER PROPOSAL, IN EITHER DIRECTION, WITH NO UNDO — so a mis-click is permanent and the
 * only defence is that a single click cannot make one. What is asserted here is not that a panel
 * appears; it is that NOTHING REACHES THE RUNTIME until the owner says so a second time, and that
 * every way of walking away — Cancel, Escape, simply not answering — sends nothing at all.
 *
 * Added in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A under the gatekeeper's pre-commit ruling.
 */
describe('the second question', () => {
  const undecided = [
    {
      draftId: 'a1b2c3d4e5f60718',
      planStatus: 'PLAN DRAFTED',
      generatedAt: '2026-08-27T12:00:00.000Z',
      decisionState: 'none' as const,
      decisionId: null,
    },
  ];

  const mountWith = (drafts: readonly (typeof undecided)[number][]) =>
    render(
      <ObjectiveIntake
        projectName="ProjectOS"
        repository="universalbizcomply/ProjectOS"
        drafts={drafts as never}
      />,
    );

  const ask = async (name: RegExp): Promise<void> => {
    await act(async () => {
      screen.getByRole('button', { name }).click();
    });
  };

  test('the question is the owner’s own words — no Git, no JSON, no digest, no branch', async () => {
    mountWith(undecided);
    await ask(/^approve plan$/i);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Approve this plan?');
    expect(text).toContain('This permanently records your decision for this exact proposal.');
    expect(text).toContain('It does not start the work.');
    for (const jargon of ['commit', 'git', 'JSON', 'digest', 'branch', '.projectops', 'SHA', 'HEAD']) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });

  test('rejection asks its own question, and says what remains possible afterwards', async () => {
    mountWith(undecided);
    await ask(/^reject$/i);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Reject this plan?');
    expect(text).toContain('This permanently records your rejection.');
    expect(text).toContain('You can create a revised proposal afterwards.');
  });

  test('CANCEL records nothing and returns the owner to the two choices', async () => {
    mountWith(undecided);
    await ask(/^approve plan$/i);
    await ask(/^cancel$/i);
    expect(sent).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Approve this plan?');
    expect(screen.getByRole('button', { name: /^approve plan$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeTruthy();
  });

  test('ESCAPE records nothing', async () => {
    mountWith(undecided);
    await ask(/^reject$/i);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(sent).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Reject this plan?');
  });

  test('a key that is not Escape decides nothing and dismisses nothing', async () => {
    mountWith(undecided);
    await ask(/^approve plan$/i);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(sent).toHaveLength(0);
    expect(document.body.textContent).toContain('Approve this plan?');
  });

  test('switching from Approve to Reject before confirming sends nothing', async () => {
    mountWith(undecided);
    await ask(/^approve plan$/i);
    await ask(/^cancel$/i);
    await ask(/^reject$/i);
    expect(sent).toHaveLength(0);
    expect(document.body.textContent).toContain('Reject this plan?');
  });

  test('CONFIRM sends exactly one decision, and a second click cannot send another', async () => {
    mountWith(undecided);
    await ask(/^approve plan$/i);
    const confirm = screen.getByRole('button', { name: /^confirm approve$/i });
    // Two clicks in the same tick — the case a `busy` flag alone does not cover, because both reads
    // happen before React re-renders.
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args).toEqual({ draftId: 'a1b2c3d4e5f60718', decision: 'approve' });
  });

  test('the question disappears once it has been answered, so it cannot be answered twice', async () => {
    mountWith(undecided);
    await ask(/^approve plan$/i);
    await ask(/^confirm approve$/i);
    expect(sent).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^confirm approve$/i })).toBeNull();
    expect(document.body.textContent).not.toContain('Approve this plan?');
  });

  test('no confirmation control exists until one is asked for', () => {
    mountWith(undecided);
    expect(screen.queryByRole('button', { name: /^confirm approve$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^confirm reject$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
  });
});
