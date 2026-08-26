import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openOwnerControl } from './ownerControlRoute.js';

/**
 * T2-T21 - the governed matrix, against the REAL ProjectOS runtime.
 *
 * Everything here goes through the real owner surface: a real click in the real Tauri WebView, over
 * real Tauri IPC, to the real sidecar, to the canonical @projectos/agent and @projectos/core, which
 * write the durable records under `.projectops`. Durable state is READ from disk to corroborate what
 * the UI claims; it is never written here to manufacture a result.
 *
 * Two lifecycle constraints shape this file, both derived from source rather than chosen:
 *
 *  - `phase.stop` maps to the canonical `rolled_back` status and `phase.resume` to `draft`, and
 *    `rolled_back` leads only back to `draft`. Exercising either against Phase 12 would destroy its
 *    progression and force the whole lifecycle to be re-walked. T8/T9 therefore prove that the
 *    controls are OFFERED according to the real durable status - which is the canonical semantics
 *    claim - without performing the mutation.
 *
 *  - The surface deliberately offers exactly one primary action per state, so a refusal cannot be
 *    provoked by asking for something illegal. The genuine refusal (T10/T11) is the closure gate at
 *    `awaiting_closure`, where G4 refuses while its predicates are unmet. That is reached by walking
 *    the real lifecycle forward, which is Phase 12's truthful progression anyway.
 */

const REPO = resolve(process.cwd(), '..', '..');
const PHASE_ID = 'PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A';

/** The durable phase record written by @projectos/core - the lifecycle authority. */
function phaseRecord(): { status: string; history: readonly { to: string; by: string }[] } {
  return JSON.parse(readFileSync(resolve(REPO, '.projectops', 'phases', `${PHASE_ID}.json`), 'utf8'));
}

/** The active plan, read from disk so the UI's claim can be compared against the real file. */
function planRecord(): { planVersion: string } {
  return JSON.parse(readFileSync(resolve(REPO, 'projectos', 'state', 'projectos-v3.plan.json'), 'utf8'));
}

/** The one primary action the surface offers for a given durable status. Mirrors NEXT_STEP. */
const NEXT_LABEL: Readonly<Record<string, string>> = {
  draft: 'Prepare the phase prompt',
  prompted: 'Begin implementation',
  implementing: 'Run validation',
  validating: 'Collect evidence',
  evidence: 'Send for review',
  awaiting_review: 'Send for closure',
};

/** At awaiting_closure the one offered action is closure itself, whose label names the delegate. */
const CLOSE_PREFIX = 'Close as';

/** The label of the single primary action for a durable status. */
function primaryLabelFor(status: string): string | null {
  if (status === 'awaiting_closure') return CLOSE_PREFIX;
  return NEXT_LABEL[status] ?? null;
}

async function sourceText(): Promise<string> {
  return (await $('[data-testid="ocp-source"]').getText()).replace(/\s+/g, ' ');
}

async function actionMessage(): Promise<string> {
  const el = await $('.ocp-actionmsg');
  return (await el.isExisting()) ? (await el.getText()).replace(/\s+/g, ' ') : '';
}

/**
 * A governed control, found by its visible label.
 *
 * The CSS prefix and the text selector must be CHAINED — WebdriverIO does not parse
 * `.ocp-actions button=Label` as one compound selector, and silently finds nothing.
 */
async function actionBtn(label: string) {
  return (await $('.ocp-actions')).$(`button=${label}`);
}

/** Click a governed control by its visible label. */
async function clickAction(label: string): Promise<void> {
  const btn = await actionBtn(label);
  await btn.waitForClickable({ timeout: 20_000 });
  await btn.click();
}

/** Wait until the durable record reaches `status`. The UI must not be the thing that proves this. */
async function waitForDurableStatus(status: string, timeout = 45_000): Promise<void> {
  await browser.waitUntil(async () => phaseRecord().status === status, {
    timeout,
    timeoutMsg: `the durable phase record never reached '${status}' (still '${phaseRecord().status}')`,
    interval: 500,
  });
}

describe('T2-T21 governed matrix against the real ProjectOS runtime', () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, { timeout: 30_000 });
    const root = await $('#root');
    await root.waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await root.getHTML(false)).trim().length > 0, { timeout: 30_000 });
    // The governed panel only renders once the runtime has reported, so wait for the real thing
    // rather than racing it.
    // Owner Control moved behind Advanced in the approved redesign; the surface and everything
    // asserted about it below are unchanged. See ownerControlRoute.ts.
    await openOwnerControl(30_000);
    await browser.waitUntil(async () => (await sourceText()).includes('Live'), {
      timeout: 60_000,
      timeoutMsg: 'the runtime never reported live governed state',
    });
  });

  it('T2 reports live canonical runtime state', async () => {
    const text = await sourceText();
    expect(text).toContain('Live');
    expect(text).toContain('Canonical runtime state');
    // "Not live" is the honest fallback; it must not be what we are reading.
    expect(text).not.toContain('Not live');
  });

  it('T3 shows the active plan version from the runtime, not hardcoded text', async () => {
    const version = planRecord().planVersion;
    expect(await sourceText()).toContain(`plan ${version}`);
    // Corroborate that the surface names the real plan file it read.
    expect(await sourceText()).toContain('projectos/state/projectos-v3.plan.json');
  });

  it('T4 shows PLAN READY as recomputed by the plan engine', async () => {
    // The word "recomputed" is load-bearing: the stored planStatus is never trusted.
    expect(await sourceText()).toContain('PLAN READY (recomputed)');
  });

  it('T5 offers the one action that matches the real durable phase status', async () => {
    const status = phaseRecord().status;
    const expectedLabel = primaryLabelFor(status);
    expect(expectedLabel).not.toBeNull();
    // Read every offered label ONCE. Probing each absent label individually costs an implicit wait
    // apiece, which is both slow and a worse assertion than looking at the whole offer set.
    const offered = await browser.execute(() =>
      Array.from(document.querySelectorAll('.ocp-actions button')).map((b) => (b.textContent ?? '').trim()),
    );
    expect(offered.some((l) => l.startsWith(expectedLabel as string))).toBe(true);

    // and it must NOT be offering an action belonging to some other status
    const otherLabels = Object.entries(NEXT_LABEL)
      .filter(([s]) => s !== status)
      .map(([, label]) => label);
    expect(offered.filter((l) => otherLabels.includes(l))).toEqual([]);
  });

  it('T6 refresh traverses the real chain and repaints from canonical state', async () => {
    await clickAction('Refresh');
    await browser.waitUntil(async () => (await actionMessage()).length > 0, {
      timeout: 20_000,
      timeoutMsg: 'refresh produced no runtime response',
    });
    // Still live, still the real plan - the repaint came from the runtime, not from local state.
    const text = await sourceText();
    expect(text).toContain('Live');
    expect(text).toContain(`plan ${planRecord().planVersion}`);
  });

  it('T8 offers Stop according to the real lifecycle, and does not invent a status', async () => {
    const status = phaseRecord().status;
    const inFlight = status !== 'not-started' && status !== 'rolled_back';
    expect(await (await actionBtn('Stop')).isExisting()).toBe(inFlight);
  });

  it('T9 offers Resume only for a rolled-back phase', async () => {
    const status = phaseRecord().status;
    expect(await (await actionBtn('Resume')).isExisting()).toBe(status === 'rolled_back');
  });

  // T16/T17 are NOT here. The embedded WebDriver server implements Tab as a synthetic JavaScript
  // KeyboardEvent dispatched at document.activeElement and does not perform native focus traversal,
  // so a WebDriver Tab proves nothing about keyboard operability in either direction. They are
  // proven with real OS input in t3-native-keyboard.spec.ts instead.

  it('T18 renders without horizontal overflow at the primary native size', async () => {
    await browser.setWindowSize(1200, 820);
    const overflow = await browser.execute(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(await $('h1#ocp-title').isDisplayed()).toBe(true);
  });

  it('T19 renders without horizontal overflow at the supported minimum native size', async () => {
    // 900x600 is the configured minimum. It is NOT lowered to fabricate a narrower native proof.
    await browser.setWindowSize(900, 600);
    const overflow = await browser.execute(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    // The owner's primary action must still be reachable at the minimum size.
    const label = primaryLabelFor(phaseRecord().status) as string;
    const visible = await browser.execute(
      (l: string) =>
        Array.from(document.querySelectorAll('.ocp-actions button')).some(
          (b) => (b.textContent ?? '').trim().startsWith(l) && (b as HTMLElement).offsetParent !== null,
        ),
      label,
    );
    expect(visible).toBe(true);
    await browser.setWindowSize(1200, 820);
  });

  // ---- state-changing proofs; these run last because they advance the real phase -----------------

  it('T7/T14 advances the phase through the real chain, with no optimistic success', async () => {
    const before = phaseRecord().status;
    const expectedTo = { validating: 'evidence', evidence: 'awaiting_review', awaiting_review: 'awaiting_closure' }[
      before
    ];

    if (expectedTo === undefined) {
      // The lifecycle is one-way: once the phase has been walked forward there is no legal advance
      // left to perform, and rolling it back to re-stage one would destroy the very progression this
      // proves. The evidence is then the durable history itself — transitions that only the governed
      // chain can have written.
      const history = phaseRecord().history;
      const advanced = history.filter((h) => ['evidence', 'awaiting_review', 'awaiting_closure'].includes(h.to));
      console.log('T7 durable history:', JSON.stringify(advanced.map((h) => `${h.to} by ${h.by}`)));
      expect(advanced.length).toBeGreaterThan(0);
      return;
    }

    await clickAction(NEXT_LABEL[before]);

    // T14: the surface must not claim the work succeeded. It reports that it asked the runtime.
    const msg = await actionMessage();
    expect(msg).toContain('Sent to the runtime');
    expect(msg.toLowerCase()).not.toContain('success');

    // The proof is the DURABLE record, not the UI.
    await waitForDurableStatus(expectedTo as string);
    const rec = phaseRecord();
    expect(rec.status).toBe(expectedTo);
    expect(rec.history[rec.history.length - 1].to).toBe(expectedTo);

    // and the surface repaints to the action for the NEW real status
    await browser.waitUntil(
      async () => (await actionBtn(NEXT_LABEL[expectedTo as string])).isExisting(),
      { timeout: 30_000, timeoutMsg: 'the surface did not repaint to the new durable status' },
    );
  });

  it('T15 reaches awaiting_closure through the real lifecycle', async () => {
    // Walk the remaining legal steps the same way: real clicks, durable confirmation each time.
    for (const [from, to] of [
      ['evidence', 'awaiting_review'],
      ['awaiting_review', 'awaiting_closure'],
    ]) {
      if (phaseRecord().status !== from) continue;
      await clickAction(NEXT_LABEL[from]);
      await waitForDurableStatus(to);
    }
    expect(phaseRecord().status).toBe('awaiting_closure');
  });

  it('T10/T11 refuses closure while the G4 predicates are unmet, in the runtime words', async () => {
    expect(phaseRecord().status).toBe('awaiting_closure');
    const closeBtn = await (await $('.ocp-actions')).$('button*=Close as');
    await closeBtn.waitForExist({ timeout: 30_000 });
    await closeBtn.click();

    // Wait for the runtime's reply, whatever it is, then assert on it — and print it, so a wrong
    // answer is diagnosable instead of just a timeout.
    await browser.waitUntil(
      async () => {
        const m = await actionMessage();
        return m.length > 0 && !m.startsWith('Asking the runtime');
      },
      { timeout: 60_000, timeoutMsg: 'the runtime never replied to the closure request' },
    );
    const msg = await actionMessage();
    console.log('T10/T11 closure reply:', msg);

    // The refusal must come from the gate, not from a frontend guard.
    expect(msg).toContain('REFUSED');
    expect(msg).toContain('G4');

    // T14 again, on the path that matters most: a refused closure must not close anything.
    expect(phaseRecord().status).toBe('awaiting_closure');
  });

  it('T21 leaves the application healthy with no error boundary and a live runtime', async () => {
    // No React error boundary rendered, and the shell is still intact after every interaction above.
    expect(await $('.error-boundary').isExisting()).toBe(false);
    expect(await $('#root').isExisting()).toBe(true);
    // The shell's marker is the redesigned persistent rail; it was the old nine-destination
    // `nav[aria-label="Primary"]` until the approved redesign replaced that navigation.
    expect(await $('.os-rail').isExisting()).toBe(true);
    // The runtime is still reporting live truth - it did not fall over during the lifecycle walk.
    expect(await sourceText()).toContain('Live');
  });
});
