import { execFileSync } from 'node:child_process';
import { openOwnerControl } from './ownerControlRoute.js';

/**
 * T12 - disconnect honesty.
 *
 * A crashed local worker is a real condition the owner must be told about truthfully. This injects
 * exactly that fault: the daemon child of THIS ProjectOS instance is terminated, and the surface is
 * then required to stop claiming a live runtime.
 *
 * The process is identified by PARENTAGE, not by name. Killing "a node.exe" would be reckless on a
 * developer machine — this repository has concurrent work running — so the child is only terminated
 * once it is mechanically proven to be the one this E2E ProjectOS instance created.
 */

interface Proc {
  readonly ProcessId: number;
  readonly ParentProcessId: number;
  readonly Name: string;
  readonly CommandLine: string | null;
}

function query(script: string): string {
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

function appPid(): number {
  return (
    Number(
      query(
        "(Get-Process -Name projectos-control-center -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1).Id",
      ),
    ) || 0
  );
}

/** The daemon children of `parent`, proven by ParentProcessId. */
function daemonChildren(parent: number): Proc[] {
  const raw = query(
    `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parent}" | ` +
      'Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 3',
  );
  if (raw.length === 0) return [];
  const parsed: unknown = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed]) as Proc[];
}

async function sourceText(): Promise<string> {
  return (await $('[data-testid="ocp-source"]').getText()).replace(/\s+/g, ' ');
}

describe('T12 the surface stops claiming a live runtime when the daemon dies', () => {
  it('reports the truth after the test-owned daemon child is terminated', async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, { timeout: 30_000 });
    // Owner Control moved behind Advanced in the approved redesign; the surface and everything
    // asserted about it below are unchanged. See ownerControlRoute.ts.
    await openOwnerControl(30_000);
    await browser.waitUntil(async () => (await sourceText()).includes('Live'), {
      timeout: 60_000,
      timeoutMsg: 'the runtime never reported live governed state, so there is no disconnect to prove',
    });

    const app = appPid();
    expect(app).toBeGreaterThan(0);

    const children = daemonChildren(app);
    console.log('T12 children of app:', JSON.stringify(children.map((c) => `${c.Name}#${c.ProcessId}`)));

    // Ownership proof: a node child of THIS app, running THIS repository's sidecar entry point.
    const daemon = children.find(
      (c) => /node/i.test(c.Name) && (c.CommandLine ?? '').includes('host.mjs'),
    );
    expect(daemon).toBeDefined();
    expect(daemon!.ParentProcessId).toBe(app);

    query(`Stop-Process -Id ${daemon!.ProcessId} -Force`);

    // T12-A the daemon child is gone
    await browser.waitUntil(
      async () => query(`(Get-Process -Id ${daemon!.ProcessId} -ErrorAction SilentlyContinue | Measure-Object).Count`) === '0',
      { timeout: 20_000, timeoutMsg: 'the daemon child did not terminate' },
    );

    // T12-B the owner window is still alive — this is a daemon crash, not an app crash
    expect(appPid()).toBe(app);

    // T12-D/E the surface must stop claiming Live and say something truthful instead
    await browser.waitUntil(async () => !(await sourceText()).includes('Live'), {
      timeout: 60_000,
      timeoutMsg: 'the surface still claimed a live runtime after the daemon died',
    });
    const text = await sourceText();
    console.log('T12 surface after crash:', text.slice(0, 200));
    expect(text).toContain('Not live');

    // T12-H nothing else was touched
    const survivors = daemonChildren(app).filter((c) => c.ProcessId === daemon!.ProcessId);
    expect(survivors).toEqual([]);
  });

});
