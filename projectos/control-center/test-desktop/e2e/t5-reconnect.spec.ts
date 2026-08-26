import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openOwnerControl } from './ownerControlRoute.js';

/**
 * T13 - reconnect, through the architecture ProjectOS actually has.
 *
 * The safe recovery from a crashed daemon in this design is to restart ProjectOS; there is no
 * in-app reconnect command, and inventing one to satisfy a test would be adding product surface to
 * pass a proof. WebdriverIO gives each spec file a fresh session and therefore a fresh ProjectOS
 * process, so this file IS the restart — it runs after the T12 crash and proves recovery is real.
 *
 * The point is that recovery reloads DURABLE truth: the phase must come back exactly where the
 * lifecycle left it, with its history intact and nothing recreated or invented.
 */

const REPO = resolve(process.cwd(), '..', '..');
const PHASE_ID = 'PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A';

function phaseRecord(): { status: string; history: readonly { from: string; to: string }[] } {
  return JSON.parse(readFileSync(resolve(REPO, '.projectops', 'phases', `${PHASE_ID}.json`), 'utf8'));
}

function planRecord(): { planVersion: string } {
  return JSON.parse(readFileSync(resolve(REPO, 'projectos', 'state', 'projectos-v3.plan.json'), 'utf8'));
}

async function sourceText(): Promise<string> {
  return (await $('[data-testid="ocp-source"]').getText()).replace(/\s+/g, ' ');
}

function procCount(name: string): number {
  return (
    Number(
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process -Name ${name} -ErrorAction SilentlyContinue | Measure-Object).Count`],
        { encoding: 'utf8' },
      ).trim(),
    ) || 0
  );
}

describe('T13 a restarted ProjectOS recovers from durable state', () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, { timeout: 30_000 });
    await $('#root').waitForExist({ timeout: 30_000 });
    // Owner Control moved behind Advanced in the approved redesign; the surface and everything
    // asserted about it below are unchanged. See ownerControlRoute.ts.
    await openOwnerControl(30_000);
  });

  it('comes back live with the canonical plan and phase, history intact', async () => {
    // T13-A/B a fresh app started and its daemon became live again after the crash
    await browser.waitUntil(async () => (await sourceText()).includes('Live'), {
      timeout: 90_000,
      timeoutMsg: 'the restarted ProjectOS never reported live governed state',
    });
    const text = await sourceText();

    // T13-D/E the plan and its readiness are read again from the canonical engine
    expect(text).toContain(`plan ${planRecord().planVersion}`);
    expect(text).toContain('PLAN READY (recomputed)');

    // T13-F/G/H/I the phase reloads exactly where the lifecycle left it, with its history intact.
    // Nothing was recreated and no status was invented to make recovery look clean.
    const rec = phaseRecord();
    expect(rec.status).toBe('awaiting_closure');
    const walk = rec.history.map((h) => `${h.from}->${h.to}`);
    expect(walk).toContain('validating->evidence');
    expect(walk).toContain('evidence->awaiting_review');
    expect(walk).toContain('awaiting_review->awaiting_closure');

    // and the surface offers the action that status implies, not a stale one
    const offered = await browser.execute(() =>
      Array.from(document.querySelectorAll('.ocp-actions button')).map((b) => (b.textContent ?? '').trim()),
    );
    expect(offered.some((l) => l.startsWith('Close as'))).toBe(true);

    // T13-J exactly one ProjectOS instance is running — recovery did not leave a duplicate
    expect(procCount('projectos-control-center')).toBe(1);
  });
});
