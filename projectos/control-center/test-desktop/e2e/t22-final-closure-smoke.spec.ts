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

describe('T22 final V3 closure smoke — the real desktop surface tells the truth at 19 / 19', () => {
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

  it('T22d shows the programme at 19 / 19 after closure, and no stale 94.7', async () => {
    // Before closure this asserted 18/19 and `< 100`. The programme is now CLOSED on the owner's
    // explicit approval and the gatekeeper's ruling, so the truthful surface is 19/19 — and the
    // assertion moved with the truth rather than being deleted.
    const st = state();
    expect(st.acceptedPhaseCount).toBe(19);
    expect(st.totalPhaseCount).toBe(19);
    expect(st.completionPercentage).toBe(100);
    const meter = await $('.ocp-meter [role="progressbar"]');
    await meter.waitForExist({ timeout: 20_000 });
    const shown = Number(await meter.getAttribute('aria-valuenow'));
    expect(shown).toBe(st.completionPercentage);
    expect(shown).toBe(100);
    // No stale claim left behind on the canonical surface.
    expect(await $('body').getText()).not.toContain('94.7');
  });

  it('T22e Phases 17 AND 18 are CLOSED, and no phase is active', async () => {
    expect(phaseRecord(PHASE_17).status).toBe('closed');
    expect(phaseRecord(PHASE_18).status).toBe('closed');
    expect(state().activePhase).toBeNull();

    // A closed phase is terminal, so the surface must offer NO lifecycle action for it. Offering one
    // would be the false-active-Phase-18 state this check exists to rule out.
    const offered = await offeredActions();
    for (const wrong of ['Prepare the phase prompt', 'Begin implementation', 'Run validation', 'Collect evidence', 'Send for review', 'Send for closure']) {
      expect(offered).not.toContain(wrong);
    }
    expect(offered.some((l) => l.startsWith('Close as'))).toBe(false);
  });

  it('T22f the closed programme offers no stop/resume for a terminal phase', async () => {
    const offered = await offeredActions();
    expect(offered).not.toContain('Stop');
    expect(offered).not.toContain('Resume');
  });

  it.skip('T22i AN ELIGIBLE GATE DOES NOT CLOSE THE PHASE — superseded by the real closure', async () => {
    // Kept, not deleted, and skipped rather than rewritten: it proved that an eligible gate does NOT
    // close a phase, and it did that against a phase at `awaiting_closure`. Phase 18 is now CLOSED
    // by the owner's approval and the gatekeeper's decision, so the surface no longer offers a
    // closure control to click and the scenario cannot be reconstructed here. The property it proved
    // is permanently covered by closureAuthorityBreach.test.ts R1–R8 and closure-decision.test.ts,
    // which do not depend on the programme's position.
    // The Phase-18 authority defect in one assertion. All seventeen G4 predicates are satisfied at
    // this subject, so the ONLY thing standing between this surface and a closed programme is the
    // requirement that the gatekeeper have actually decided. Clicking Close must surface that
    // refusal, and the durable record must not move.
    //
    // This is the one place the proof deliberately clicks a governed control: the whole question is
    // what happens when someone does.
    const before = phaseRecord(PHASE_18).status;
    expect(before).toBe('awaiting_closure');

    const close = await (await $('.ocp-actions')).$$('button');
    let clicked = false;
    for (const btn of close) {
      if ((await btn.getText()).trim().startsWith('Close as')) {
        await btn.waitForClickable({ timeout: 20_000 });
        await btn.click();
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);

    const msg = await $('.ocp-actionmsg');
    await browser.waitUntil(async () => ((await msg.isExisting()) ? (await msg.getText()).length > 0 : false), {
      timeout: 30_000,
      timeoutMsg: 'the runtime returned no answer to the closure request',
    });
    // The surfaced string is a UI rendering of the runtime's refusal, so it is matched loosely — the
    // load-bearing assertions are the durable ones below. What must not happen is a SUCCESS message.
    const said = (await msg.getText()).replace(/\s+/g, ' ');
    console.log(`T22i runtime answered: ${said}`);
    expect(said.length).toBeGreaterThan(0);
    expect(/REFUS|GATEKEEPER|not a decision|eligib/i.test(said)).toBe(true);
    expect(/closed\b/i.test(said) && !/REFUS/i.test(said)).toBe(false);

    // NOTHING MOVED. Not the durable record, not the counters, not the surface's claim.
    expect(phaseRecord(PHASE_18).status).toBe('awaiting_closure');
    expect(state().acceptedPhaseCount).toBe(18);
    const meter = await $('.ocp-meter [role="progressbar"]');
    expect(Number(await meter.getAttribute('aria-valuenow'))).toBe(94.7);
    expect(await $('body').getText()).not.toContain('19 / 19');
  });

  it.skip('T22g Refresh traverses the real runtime — superseded by the closed programme', async () => {
    // Skipped, not deleted, and for the same reason as T22i: the governed action panel renders for a
    // phase in flight, and with the programme CLOSED there is no phase to act on, so the Refresh
    // control this exercised does not exist. That absence is itself the truthful post-closure state
    // and is asserted by T22e/T22f. Refresh traversing the real chain was proven in the pre-closure
    // run at 18/19, which the Phase-18 evidence pack records.
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
