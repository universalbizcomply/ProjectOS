import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * T22 — the Phase-18 final smoke proof.
 *
 * This is NOT a rerun of the Phase-12 matrix. Phase 12 proved the governed write path, refusal
 * honesty, disconnect honesty and the whole T2–T21 progression, and that evidence is accepted. What
 * Phase 18 has to establish is narrower and different: that the REAL desktop Control Centre, built
 * from the CURRENT source, still tells the truth about the programme at the moment it is closed.
 *
 * Everything asserted about the UI is corroborated against the durable records on disk, and the
 * durable records are only ever READ here. A surface that agreed with itself would prove nothing;
 * the point is that the surface agrees with the canonical state, and that both agree with 18 / 19.
 *
 * No mutation, no production action, no protected effect: the only click is Refresh, which reads.
 *
 * Created in PROJECTOS-V3-FINAL-E2E-CLOSURE1A.
 */

const REPO = resolve(process.cwd(), '..', '..');
const PHASE_18 = 'PROJECTOS-V3-FINAL-E2E-CLOSURE1A';
const PHASE_17 = 'PROJECTOS-V3-RELIABILITY-HARDENING1A';

function json(...parts: string[]): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(REPO, ...parts), 'utf8')) as Record<string, unknown>;
}
const phaseRecord = (id: string) => json('.projectops', 'phases', `${id}.json`) as unknown as { status: string };
const plan = () => json('projectos', 'state', 'projectos-v3.plan.json') as unknown as { planVersion: string };
const state = () =>
  json('projectos', 'state', 'projectos-v3.current-state.json') as unknown as {
    acceptedPhaseCount: number;
    totalPhaseCount: number;
    completionPercentage: number;
    activePhase: string | null;
  };

function procCount(name: string): number {
  try {
    return (
      Number(
        execFileSync(
          'powershell',
          ['-NoProfile', '-Command', `(Get-Process -Name ${name} -ErrorAction SilentlyContinue | Measure-Object).Count`],
          { encoding: 'utf8' },
        ).trim(),
      ) || 0
    );
  } catch {
    return 0;
  }
}

async function sourceText(): Promise<string> {
  return (await $('[data-testid="ocp-source"]').getText()).replace(/\s+/g, ' ');
}

async function offeredActions(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.ocp-actions button')).map((b) => (b.textContent ?? '').trim()),
  );
}

describe('T22 final V3 closure smoke — the real desktop surface tells the truth at 18 / 19', () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, { timeout: 30_000 });
    const root = await $('#root');
    await root.waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await root.getHTML(false)).trim().length > 0, { timeout: 30_000 });
    await $('[data-testid="ocp-source"]').waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await sourceText()).includes('Live'), {
      timeout: 60_000,
      timeoutMsg: 'the runtime never reported live governed state',
    });
  });

  it('T22a is the genuine ProjectOS desktop application, not a browser session or a dev server', async () => {
    // The three ways this proof could be worthless, each refused explicitly.
    const url = await browser.getUrl();
    expect(url.startsWith('data:')).toBe(false); // a blank driver document
    expect(url).not.toContain('localhost:5178'); // the frontend served by a Vite dev server
    expect(/^(tauri:\/\/|https?:\/\/tauri\.localhost)/.test(url)).toBe(true); // the embedded bundle
    expect(await browser.getTitle()).toContain('ProjectOS');
    expect(procCount('projectos-control-center')).toBeGreaterThan(0);
    expect(await $('nav[aria-label="Primary"]').isExisting()).toBe(true);
  });

  it('T22b reports LIVE canonical runtime state — not a snapshot, and not a false live claim', async () => {
    const text = await sourceText();
    expect(text).toContain('Live');
    expect(text).toContain('Canonical runtime state');
    // "Not live" is the honest fallback. Reading it here would mean the surface is showing the last
    // recorded position while claiming nothing — which is honest, but is not this proof.
    expect(text).not.toContain('Not live');
    expect(text).toContain('projectos/state/projectos-v3.plan.json');
  });

  it('T22c shows the ACTIVE plan version v1.3 and PLAN READY as recomputed', async () => {
    const version = plan().planVersion;
    expect(version).toBe('1.3');
    const text = await sourceText();
    expect(text).toContain(`plan ${version}`);
    // "recomputed" is load-bearing: the stored planStatus string is never trusted by the engine.
    expect(text).toContain('PLAN READY (recomputed)');
    expect(text).not.toContain('NOT ready');
  });

  it('T22d shows the programme at 18 / 19 BEFORE final closure, and never at 19 / 19', async () => {
    const st = state();
    expect(st.acceptedPhaseCount).toBe(18);
    expect(st.totalPhaseCount).toBe(19);
    expect(st.completionPercentage).toBe(94.7);
    const meter = await $('.ocp-meter [role="progressbar"]');
    await meter.waitForExist({ timeout: 20_000 });
    const shown = Number(await meter.getAttribute('aria-valuenow'));
    expect(shown).toBe(st.completionPercentage);
    // The one number that must not appear anywhere before the owner decides.
    expect(shown).toBeLessThan(100);
  });

  it('T22e Phase 17 is CLOSED and Phase 18 is the phase the surface is governing', async () => {
    expect(phaseRecord(PHASE_17).status).toBe('closed');
    expect(phaseRecord(PHASE_18).status).toBe('prompted');
    expect(state().activePhase).toBe(PHASE_18);

    // The surface offers exactly the one action that matches Phase 18's real durable status. It
    // could only do that by having read Phase 18 — so this is what proves WHICH phase it is on.
    const offered = await offeredActions();
    expect(offered.some((l) => l === 'Begin implementation')).toBe(true);
    // and not an action belonging to some other lifecycle state
    for (const wrong of ['Prepare the phase prompt', 'Run validation', 'Collect evidence', 'Send for review', 'Send for closure']) {
      expect(offered).not.toContain(wrong);
    }
  });

  it('T22f owner pause/stop authority is present and truthful', async () => {
    const offered = await offeredActions();
    // Offered, per the real durable status — NOT exercised. `phase.stop` maps to `rolled_back`,
    // which leads only back to `draft`, so clicking it would destroy Phase 18's progression to prove
    // a control that is already visible. The control being offered is the claim; using it is not.
    expect(offered).toContain('Stop');
    expect(offered).not.toContain('Resume'); // Resume belongs to a rolled-back phase, and 18 is not
  });

  it('T22g Refresh traverses the real runtime and repaints from canonical state', async () => {
    const before = await sourceText();
    const btn = await (await $('.ocp-actions')).$('button=Refresh');
    await btn.waitForClickable({ timeout: 20_000 });
    await btn.click();
    const msg = await $('.ocp-actionmsg');
    await browser.waitUntil(async () => ((await msg.isExisting()) ? (await msg.getText()).length > 0 : false), {
      timeout: 20_000,
      timeoutMsg: 'refresh produced no response from the runtime',
    });
    // Still live, still the same canonical facts: a refresh that traversed the chain and came back
    // with a different plan version or a lost live state would be the interesting failure.
    const after = await sourceText();
    expect(after).toContain('Live');
    expect(after).toContain(`plan ${plan().planVersion}`);
    expect(after).toBe(before);
  });

  it('T22h no unexplained console or runtime error', async () => {
    const logs = await browser.execute(
      () => (window as unknown as { __projectosConsoleErrors?: string[] }).__projectosConsoleErrors ?? null,
    );
    // The app does not install an error collector, so absence of one is expected and is NOT read as
    // "no errors". What is asserted instead is observable: the shell rendered, the governed panel
    // rendered, and no error boundary is showing.
    expect(await $('#root').isExisting()).toBe(true);
    expect(await $('[data-testid="ocp-source"]').isExisting()).toBe(true);
    const bodyText = await $('body').getText();
    expect(bodyText).not.toContain('Something went wrong');
    expect(bodyText).not.toContain('Unhandled');
    if (logs !== null) expect(logs).toEqual([]);
  });
});
