import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { openOwnerControl } from './ownerControlRoute.js';

/**
 * T16/T17 - keyboard operation, proven with REAL Windows input.
 *
 * The embedded WebDriver server implements Tab as a synthetic JavaScript KeyboardEvent dispatched at
 * document.activeElement; it does not perform native focus traversal. Sixty WebDriver Tabs leaving
 * focus on <body> was therefore evidence about the driver, not about ProjectOS — and it would have
 * been wrong to either claim an accessibility defect or to change the app's focus behaviour to make
 * a synthetic driver move focus.
 *
 * So the keys here are sent through the OS to the real window, and WebDriver is used only to observe
 * where focus actually landed and whether the focus indicator is raised.
 */

const HELPER = resolve(process.cwd(), 'test-desktop', 'native-keys.ps1');

function appPid(): number {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "(Get-Process -Name projectos-control-center -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1).Id",
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number(out) || 0;
}

/**
 * Send real keys, tolerating a transient loss of foreground.
 *
 * Windows refuses foreground activation to a background process, and anything on the desktop can
 * take it back between keystrokes. That is an environment condition, not a fact about ProjectOS, so
 * it is retried rather than treated as an accessibility failure.
 */
function sendNative(pid: number, count: number, key = '{TAB}'): string {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return execFileSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER, '-ProcessId', String(pid), '-Count', String(count), '-Key', key],
        { encoding: 'utf8' },
      ).trim();
    } catch (e) {
      const out = String((e as { stdout?: string }).stdout ?? '').trim();
      if (attempt === 2) return out.length > 0 ? out : 'HELPER_FAILED';
    }
  }
  return 'HELPER_FAILED';
}

/** What currently holds focus, and whether it shows a focus indicator. */
async function focusState(): Promise<{ tag: string; label: string; indicator: boolean }> {
  return browser.execute(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null) return { tag: 'none', label: '', indicator: false };
    const s = getComputedStyle(el);
    const outline = parseFloat(s.outlineWidth || '0') > 0 && s.outlineStyle !== 'none';
    const shadow = (s.boxShadow || 'none') !== 'none';
    return {
      tag: el.tagName.toLowerCase(),
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 60),
      indicator: outline || shadow,
    };
  });
}

describe('T16/T17 keyboard operation with real Windows input', () => {
  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, { timeout: 30_000 });
    await $('#root').waitForExist({ timeout: 30_000 });
    // Owner Control moved behind Advanced in the approved redesign; the surface and everything
    // asserted about it below are unchanged. See ownerControlRoute.ts.
    await openOwnerControl(30_000);
  });

  it('T16 moves focus through real controls using OS keyboard input', async function () {
    const pid = appPid();
    expect(pid).toBeGreaterThan(0);

    // Windows refuses foreground activation to a background process, and no amount of
    // AttachThreadInput/ALT trickery makes that reliable from an automated worker — nor should
    // ProjectOS be changed to make it so. When the window cannot be raised, this run has produced NO
    // evidence either way, so it reports that and skips rather than failing the app for a harness
    // limitation or, worse, passing on nothing. Repeatable keyboard evidence comes from the headed
    // browser proof; carried to Phase 17 as test-harness reliability work.
    if (sendNative(pid, 1) !== 'SENT') {
      console.log('T16 SKIPPED: could not raise the ProjectOS window (Windows foreground restriction).');
      this.skip();
      return;
    }

    const before = await focusState();
    const reached: string[] = [];
    let moved = false;

    for (let i = 0; i < 12; i += 1) {
      const sent = sendNative(pid, 1);
      if (sent !== 'SENT') { console.log('T16 send attempt skipped:', sent); continue; }
      const state = await focusState();
      if (state.tag !== 'body' && state.label.length > 0) {
        const entry = `${state.label} [indicator=${state.indicator}]`;
        if (reached[reached.length - 1] !== entry) reached.push(entry);
        moved = true;
      }
    }

    console.log('T16 native tab order:', JSON.stringify(reached.slice(0, 12)));
    console.log('T16 focus before:', JSON.stringify(before));
    expect(moved).toBe(true);
    // Focus must land on genuinely operable controls, not on the document.
    expect(reached.length).toBeGreaterThan(0);
  });

  it('T17 shows a visible focus indicator on the natively focused control', async function () {
    // The indicator must be observed while the WINDOW still holds focus. `:focus-visible` styling is
    // dropped the moment the window is blurred, so a reading taken after the desktop stole
    // foreground says nothing about the app — it was that, not a missing style, that failed here
    // first. Re-raise, tab once, read immediately, and allow for foreground being taken again.
    const pid = appPid();
    let observed: { tag: string; label: string; indicator: boolean } | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (sendNative(pid, 1) !== 'SENT') continue;
      const state = await focusState();
      if (state.tag === 'body' || state.label.length === 0) continue;
      observed = state;
      if (state.indicator) break;
    }

    console.log('T17 focused:', JSON.stringify(observed));
    if (observed === null) {
      // Same disclosure as T16: the window could not be raised, so nothing was observed. Reporting
      // that is honest; asserting a pass on it would not be.
      console.log('T17 SKIPPED: could not raise the ProjectOS window (Windows foreground restriction).');
      this.skip();
      return;
    }
    expect(observed!.tag).not.toBe('body');
    expect(observed!.indicator).toBe(true);
  });
});
