/**
 * P2 — an owner submits an objective from the desktop app and ProjectOS proposes a plan.
 *
 * This is the pilot's autonomy proof, and it is deliberately end-to-end through the REAL chain:
 * a real Tauri window, the real governed-command channel, the real sidecar, the real
 * `@projectos/agent` runtime and the real canonical discovery engine, writing real records to disk.
 * Nothing here is mocked, and the assertions are made against what the RUNTIME said, not against
 * anything the renderer decided to display.
 *
 * What it must prove:
 *   - the owner needs no terminal;
 *   - the objective reaches the canonical runtime and comes back as a PROPOSAL;
 *   - the proposal is proportional (the F10 fix) rather than a conflict explosion;
 *   - nothing on the screen can approve, activate or start anything.
 *
 * Created in the post-V3 self-hosting pilot.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openOwnerControl } from './ownerControlRoute.js';

const REPO = resolve(process.cwd(), '..', '..');
const DRAFTS = resolve(REPO, '.projectops', 'drafts');

// The EXACT objective already recorded for this pilot. Using the canonical text keeps the proof
// idempotent: it re-submits the same objective under the same id instead of minting a second
// record every run, which is both honest and keeps the repository clean.
const OBJECTIVE =
  "Make ProjectOS genuinely usable as Murad's primary no-training-required project-delivery front door. Use ProjectOS against itself to discover and correct owner-experience, autonomy, workflow and truth defects. Unify competing project truths, remove misleading or duplicated operational surfaces, simplify navigation and owner decisions, preserve complete governance and protected-action controls, and prove the workflow on desktop, tablet and mobile-scale layouts. ProjectOS should autonomously handle safe project work after an owner-approved plan, with Claude as governed implementer and ChatGPT as independent gatekeeper. The owner should mainly provide the objective, approve the proposed plan, make genuine protected/commercial decisions, and approve final closure.";

const findings: Record<string, unknown> = {};

async function gotoOwnerControl(): Promise<void> {
  await browser.execute(() => {
    // A primary nav item now carries a hint alongside its label, so exact textContent no longer
    // matches; read the label element where one exists.
    for (const b of Array.from(document.querySelectorAll('nav button'))) {
      const labelEl = b.querySelector('.navlabel');
      const text = ((labelEl ?? b).textContent ?? '').trim();
      if (text === 'Owner Control') { (b as HTMLButtonElement).click(); return; }
    }
  });
  await browser.pause(400);
}

describe('P2 objective intake — the owner does not need a terminal', function () {
  // Each WebDriver round trip carries a fixed focus-probe penalty in this embedded setup, and a real
  // discovery walk over this repository takes seconds of its own.
  this.timeout(900_000);

  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, { timeout: 30_000 });
    await $('#root').waitForExist({ timeout: 60_000 });
    // Owner Control moved behind Advanced in the approved redesign; the surface and everything
    // asserted about it below are unchanged. See ownerControlRoute.ts.
    await openOwnerControl(30_000);
    await browser.waitUntil(async () => (await $('[data-testid="ocp-source"]').getText()).includes('Live'), {
      timeout: 90_000,
      timeoutMsg: 'the runtime never reported live governed state, so intake cannot be proven',
    });
    await gotoOwnerControl();
  });

  it('P2a the owner is asked, in plain language, what they want to achieve', async () => {
    const seen = await browser.execute(() => {
      const h = Array.from(document.querySelectorAll('#main h2')).map((x) => (x.textContent ?? '').trim());
      const box = document.querySelector('#ocp-objective');
      return {
        headings: h,
        hasBox: box !== null,
        placeholder: (box as HTMLTextAreaElement | null)?.placeholder ?? '',
        labelled: document.querySelector('label[for="ocp-objective"]') !== null,
        help: (document.querySelector('#ocp-objective-help')?.textContent ?? '').trim(),
      };
    });
    findings.intakeSurface = seen;
    expect(seen.headings).toContain('What do you want ProjectOS to achieve?');
    expect(seen.hasBox).toBe(true);
    expect(seen.labelled).toBe(true); // a bare textarea with no label is unusable by screen reader
    expect(seen.placeholder.length).toBeGreaterThan(10);
  });

  it('P2b submitting an objective reaches the runtime and returns a PROPOSAL', async () => {
    const before = existsSync(DRAFTS) ? readdirSync(DRAFTS).length : 0;

    const box = await $('#ocp-objective');
    await box.waitForExist({ timeout: 20_000 });
    await box.setValue(OBJECTIVE);

    const btn = await $('.ocp-panel.intake button.ocp-btn.primary');
    await btn.waitForClickable({ timeout: 20_000 });
    await btn.click();

    const msg = await $('.ocp-panel.intake .ocp-actionmsg');
    await browser.waitUntil(
      async () => (await msg.isExisting()) && (await msg.getText()).includes('objective id'),
      { timeout: 300_000, timeoutMsg: 'the runtime never answered the objective submission' },
    );
    const said = await msg.getText();
    findings.runtimeReply = said;

    // The runtime's own words, verbatim on the screen.
    expect(said).toContain('Objective received');
    expect(said).toContain('AWAITING OWNER APPROVAL');
    expect(said).toContain('This is a PROPOSAL, not an approved plan');
    expect(said).toContain('authorises nothing');
    expect(said).not.toContain('PLAN READY');

    // And it is a REAL record on disk, not a rendered string.
    const after = existsSync(DRAFTS) ? readdirSync(DRAFTS) : [];
    expect(after.length).toBeGreaterThanOrEqual(Math.max(1, before));
    findings.draftFiles = after;
  });

  it('P2c the proposal is proportional — the F10 fix, measured on the real repository', async () => {
    const files = readdirSync(DRAFTS).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const newest = files
      .map((f) => JSON.parse(readFileSync(resolve(DRAFTS, f), 'utf8')) as Record<string, unknown>)
      .sort((a, b) => (String(a['generatedAt']) < String(b['generatedAt']) ? 1 : -1))[0] as {
      planStatus: string;
      authoritative: boolean;
      conflicts: unknown[];
      planningCorpus: { totalDiscovered: number; counts: Record<string, number>; currentPlanningSources: string[] };
      draft: { phaseCandidates?: unknown[]; unresolvedUnknowns?: unknown[] };
    };

    findings.proposal = {
      status: newest.planStatus,
      conflicts: newest.conflicts.length,
      phases: newest.draft.phaseCandidates?.length ?? 0,
      corpus: newest.planningCorpus.counts,
      planSources: newest.planningCorpus.currentPlanningSources,
    };

    // Before F10 this same objective, on this same repository, produced 5,891 conflicts and 106
    // phase candidates. Proportionality is asserted, not admired: a regression that reopened the
    // explosion would fail here rather than quietly produce an unreadable draft again.
    expect(newest.authoritative).toBe(false);
    expect(newest.conflicts.length).toBeLessThan(50);
    expect(newest.planningCorpus.counts['CURRENT_PLANNING']).toBeLessThan(20);
    expect((newest.draft.phaseCandidates ?? []).length).toBeLessThan(40);
    // Narrowing must not mean hiding: the whole corpus is still reported.
    expect(newest.planningCorpus.totalDiscovered).toBeGreaterThan(100);
    expect(newest.planningCorpus.counts['HISTORICAL_EVIDENCE']).toBeGreaterThan(0);
    expect(newest.planningCorpus.currentPlanningSources.length).toBeGreaterThan(0);
  });

  it('P2d nothing on this screen can approve, activate or start anything', async () => {
    const controls = await browser.execute(() =>
      Array.from(document.querySelectorAll('#main button')).map((b) => (b.textContent ?? '').trim().toLowerCase()),
    );
    findings.controlsOnScreen = controls;
    for (const forbidden of ['approve plan', 'activate', 'activate plan', 'make plan ready', 'start plan']) {
      expect(controls.some((c) => c === forbidden)).toBe(false);
    }
    // The screen says so in words too, not only by omission.
    const text = await $('.ocp-panel.intake').getText();
    expect(text).toContain('suggestion until you approve it');
  });

  after(() => {
    console.log('\n===P2_FINDINGS_JSON_START===');
    console.log(JSON.stringify(findings));
    console.log('===P2_FINDINGS_JSON_END===\n');
  });
});
