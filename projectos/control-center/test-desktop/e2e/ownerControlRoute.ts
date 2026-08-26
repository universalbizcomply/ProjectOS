/**
 * Reach the Owner Control surface in the redesigned shell.
 *
 * WHAT CHANGED AND WHAT DID NOT. Owner Control used to be the landing surface, so a spec could wait
 * for `[data-testid="ocp-source"]` the moment the app booted. The approved redesign makes the
 * project workspace the landing surface and moves Owner Control behind Advanced — the surface, its
 * behaviour and everything these specs assert about it are unchanged; only the route to it is.
 * This helper walks that route, so each spec keeps its own expectations verbatim.
 *
 * Both shapes of the shell are handled, because both are real: with a project registered, Advanced
 * opens the workspace's technical detail (and Owner Control is one link inside it); with none, there
 * is no workspace, and Advanced opens the surface directly.
 */
import { browser, $ } from '@wdio/globals';

/** Click the first button whose visible text matches, in the live document. */
async function clickByText(text: string): Promise<boolean> {
  return browser.execute((t: string) => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').trim() === t,
    ) as HTMLElement | undefined;
    if (btn === undefined) return false;
    btn.click();
    return true;
  }, text);
}

async function present(selector: string): Promise<boolean> {
  return $(selector).isExisting();
}

/** Navigate to Owner Control and wait for it. Throws with what it saw if the route is gone. */
export async function openOwnerControl(timeout = 30_000): Promise<void> {
  await $('#root').waitForExist({ timeout });
  await browser.waitUntil(async () => (await $('#root').getHTML(false)).trim().length > 0, {
    timeout,
    timeoutMsg: '#root never rendered any content',
  });

  if (await present('[data-testid="ocp-source"]')) return;

  await clickByText('Settings');
  await browser.pause(400);
  await clickByText('Advanced and technical details');
  await browser.pause(600);

  if (await present('[data-testid="ocp-source"]')) return;

  // The populated shape: the workspace opened with its technical detail expanded.
  if (!(await present('.os-tech'))) await clickByText('Technical detail');
  await browser.pause(300);
  await clickByText('Owner Control');
  await browser.pause(600);

  await $('[data-testid="ocp-source"]').waitForExist({ timeout });
}
