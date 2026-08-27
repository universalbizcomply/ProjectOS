/**
 * Reach the Owner Control surface in the redesigned shell.
 *
 * WHAT CHANGED AND WHAT DID NOT. Owner Control used to be the landing surface, so a spec could wait
 * for `[data-testid="ocp-source"]` the moment the app booted. The approved redesign makes the
 * project workspace the landing surface and moves Owner Control behind Advanced — the surface, its
 * behaviour and everything these specs assert about it are unchanged; only the route to it is.
 * This helper walks that route, so each spec keeps its own expectations verbatim.
 *
 * FOUR ROUND TRIPS, NO PAUSES. Two costs pull against each other here. React renders the next screen
 * after the click returns, not during it, so the steps cannot be collapsed into one in-page script —
 * a single script clicked "Settings" and then looked for a button that had not been rendered yet.
 * But every WebDriver command in this harness carries a `beforeCommand` hook that waits five seconds
 * for a Tauri window-state call that never answers, so each extra round trip is five seconds of a
 * `before` hook's hundred-and-twenty. So: one command per step, no `pause`, no redundant `#root`
 * waits, and an early return the moment the surface is on screen.
 *
 * Both shapes of the shell are handled, because both are real: with a project registered, Advanced
 * opens the workspace's technical detail (and Owner Control is one link inside it); with none, and
 * when the runtime has not reported, Advanced opens the surface directly.
 */
import { browser, $ } from '@wdio/globals';

/** Click the first button with exactly this text. Returns whether Owner Control is now on screen. */
async function step(text: string | null): Promise<boolean> {
  return browser.execute((t: string | null) => {
    if (t !== null) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === t,
      ) as HTMLElement | undefined;
      btn?.click();
    }
    return document.querySelector('[data-testid="ocp-source"]') !== null;
  }, text);
}

async function hasTechnicalPanel(): Promise<boolean> {
  return browser.execute(() => document.querySelector('.os-tech') !== null);
}

export async function openOwnerControl(timeout = 30_000): Promise<void> {
  const taken: string[] = [];

  if (await step(null)) return;

  for (const text of ['Settings', 'Advanced and technical details']) {
    taken.push(text);
    if (await step(text)) return;
  }

  // The populated shape: the workspace opened with its technical detail expanded.
  if (!(await hasTechnicalPanel())) {
    taken.push('Technical detail');
    if (await step('Technical detail')) return;
  }

  taken.push('Owner Control');
  if (await step('Owner Control')) return;

  await $('[data-testid="ocp-source"]').waitForExist({
    timeout,
    timeoutMsg: `Owner Control never appeared. Route steps taken: ${taken.join(' -> ')}`,
  });
}
