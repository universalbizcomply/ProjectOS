import { execFileSync } from 'node:child_process';

/**
 * T1 - the genuine ProjectOS desktop session.
 *
 * T1 asks one question the whole matrix depends on: is WDIO actually driving the REAL ProjectOS
 * WebView through the app's own embedded WebDriver server?
 *
 * It is deliberately not satisfied by "a session exists". An earlier run produced a live session
 * that was attached to a blank `data:,` document with msedgedriver running — a session against an
 * ordinary browser driver, which would prove nothing about ProjectOS. So T1 asserts the CONNECTION,
 * the PROCESS OWNERSHIP and the RENDERED APPLICATION, not merely the handshake.
 *
 * These assertions must not be relaxed to obtain a pass.
 */

/** Count running processes by image name. */
function procCount(name: string): number {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Name ${name} -ErrorAction SilentlyContinue | Measure-Object).Count`],
      { encoding: 'utf8' },
    );
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

/** Which PID owns the listener on this port, and what executable is it? */
function listenerOwner(port: number): { pids: string; addresses: string; image: string } {
  try {
    const raw = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$c = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue; ` +
          `if ($c) { $pids = ($c.OwningProcess | Sort-Object -Unique) -join ','; ` +
          `$addr = ($c.LocalAddress | Sort-Object -Unique) -join ','; ` +
          `$img = (Get-Process -Id ($c.OwningProcess | Select-Object -First 1) -ErrorAction SilentlyContinue).ProcessName; ` +
          `Write-Output "$pids|$addr|$img" } else { Write-Output "||" }`,
      ],
      { encoding: 'utf8' },
    ).trim();
    const [pids, addresses, image] = raw.split('|');
    return { pids: pids ?? '', addresses: addresses ?? '', image: image ?? '' };
  } catch {
    return { pids: '', addresses: '', image: '' };
  }
}

describe('T1 genuine ProjectOS desktop session', () => {
  it('drives the real ProjectOS WebView through the app-owned embedded WebDriver server', async () => {
    // ---- A-D: where is WDIO actually connected, and who owns that listener? --------------------
    const opts = browser.options as { hostname?: string; port?: number };
    const hostname = opts.hostname ?? '';
    const port = opts.port ?? 0;
    const owner = listenerOwner(port);
    const appProcs = procCount('projectos-control-center');
    const edgeDrivers = procCount('msedgedriver');

    console.log(`T1 endpoint=${hostname}:${port}`);
    console.log(`T1 listener pids=${owner.pids} addresses=${owner.addresses} image=${owner.image}`);
    console.log(`T1 processes app=${appProcs} msedgedriver=${edgeDrivers}`);

    // The proof must run against the loopback interface only.
    expect(['127.0.0.1', 'localhost']).toContain(hostname);

    // P8, live: the listening socket must be loopback, never a wildcard or a routable address.
    for (const addr of owner.addresses.split(',').filter((a) => a.length > 0)) {
      expect(['127.0.0.1', '::1']).toContain(addr);
    }

    // The embedded server is IN the app, so the app process must own the listener. If msedgedriver
    // owns it, WDIO is on an ordinary browser driver and the proof is worthless.
    expect(owner.image.toLowerCase()).toContain('projectos-control-center');
    expect(appProcs).toBeGreaterThan(0);

    // ---- J-M: is this the real rendered application? ------------------------------------------
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, {
      timeout: 30_000,
      timeoutMsg: 'the WebView never produced a document title',
    });

    const url = await browser.getUrl();
    console.log(`T1 url=${url} title=${JSON.stringify(await browser.getTitle())}`);

    // A blank `data:,` document is one failure this test exists to catch.
    expect(url.startsWith('data:')).toBe(false);

    // The other is subtler and would have gone unnoticed: a `cargo build --release` binary still
    // loads `devUrl`, so it serves the frontend from a Vite dev server if one happens to be running.
    // That proves the shipped application only by coincidence, and breaks the moment the unrelated
    // dev server is not up. The E2E binary is built through `tauri build`, so the frontend must come
    // from the embedded bundle on the tauri scheme — never from a dev-server origin.
    expect(url).not.toContain('localhost:5178');
    expect(/^(tauri:\/\/|https?:\/\/tauri\.localhost)/.test(url)).toBe(true);
    expect(await browser.getTitle()).toContain('ProjectOS');

    const root = await $('#root');
    await root.waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await root.getHTML(false)).trim().length > 0, {
      timeout: 30_000,
      timeoutMsg: '#root never rendered any content',
    });

    // The real Control Centre shell, not an error boundary or an empty document.
    expect(await $('nav[aria-label="Primary"]').isExisting()).toBe(true);
  });
});
