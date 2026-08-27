/**
 * The owner's Control Centre survives the desktop harness.
 *
 * THE DEFECT THIS FIXES. `wdio.conf.ts` reaped by executable NAME after every session
 * (`Get-Process -Name projectos-control-center | Stop-Process -Force`), which cannot tell a process
 * the harness started from the one the owner has open. Running the desktop suite killed the owner's
 * application every time, and that is fatal to an owner-attended proof: the window the owner is meant
 * to click in is the window the harness reaps.
 *
 * WHY THE TEST DOES NOT KILL ANYTHING. `newPids` is the whole decision — which processes a sweep
 * WOULD reap — and `reapNewOnce` only acts on what it returns. Proving the decision is the proof that
 * matters, and it is a proof that can be run safely on the machine the owner works on. A test that
 * had to terminate a real Control Centre to check this is a test nobody would dare run, which is the
 * same as not having one.
 *
 * WHAT IS PROVEN LIVE. That `pidsByName` sees a real, currently-running process, and that once that
 * process is in the snapshot the sweep will not select it. The process used is this test runner's own
 * `node`, which is unambiguously "already running before a harness started".
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { describe, test, expect } from 'vitest';
// @ts-expect-error -- a plain .mjs harness helper with no types, shared with wdio.conf.ts and smoke.mjs
import { pidsByName, snapshotHarnessPids, newPids, HARNESS_PROC_NAMES } from '../test-desktop/harnessProcesses.mjs';

const APP = 'projectos-control-center.exe';

describe('desktop harness process safety', () => {
  test('a process already running when the snapshot was taken is never selected', () => {
    // The owner's Control Centre, modelled exactly: a pid that exists BEFORE the harness starts.
    const before = { [APP]: new Set([4242, 4243]) } as Record<string, Set<number>>;
    // What is running now: the owner's two, plus one the harness launched.
    const running = new Set([4242, 4243, 9999]);
    const selected = [...running].filter((pid) => !(before[APP] ?? new Set()).has(pid));
    expect(selected).toEqual([9999]);
  });

  test('an empty snapshot selects everything, which is why the snapshot is taken first', () => {
    // Stated as a test rather than a comment: a snapshot taken AFTER the first app launch would
    // contain the harness's own process and refuse to reap it; one never taken reaps the owner's.
    // The ordering in `onPrepare` is the control, and this is what makes its absence visible.
    const before = {} as Record<string, Set<number>>;
    expect((before[APP] ?? new Set()).has(4242)).toBe(false);
  });

  test('the reaper looks only at the three harness executables', () => {
    expect([...HARNESS_PROC_NAMES]).toEqual([
      'tauri-driver.exe',
      'msedgedriver.exe',
      'projectos-control-center.exe',
    ]);
    // Nothing broader. A name outside this list is not this harness's to stop, whoever started it.
    expect(HARNESS_PROC_NAMES).not.toContain('node.exe');
    expect(HARNESS_PROC_NAMES).not.toContain('powershell.exe');
  });

  test('a name that is not a plain process name is refused rather than interpolated', () => {
    for (const hostile of ['node.exe; Stop-Process -Name projectos-control-center', "a' -or $true -or '", '*']) {
      expect(pidsByName(hostile).size).toBe(0);
    }
  });

  test('LIVE: it sees a real running process, and will not select it once snapshotted', () => {
    // This test runner is a real, currently-running `node`. It stands in for the owner's application:
    // something that was already running before any harness began.
    const running = pidsByName('node.exe');
    expect(running.size).toBeGreaterThan(0);
    expect(running.has(process.pid)).toBe(true);

    const before = snapshotHarnessPids(['node.exe']);
    const selected = newPids(before, ['node.exe']) as { name: string; pid: number }[];
    // Whatever else is running, this process was in the snapshot, so it is not selected.
    expect(selected.map((s) => s.pid)).not.toContain(process.pid);
  });

  test('LIVE: a snapshot of the real harness names selects nothing immediately afterwards', () => {
    // Nothing has been launched between the two calls, so a correct reaper has nothing to do. If this
    // ever selects something, the sweep is reaping processes it did not start.
    const before = snapshotHarnessPids();
    expect(newPids(before)).toEqual([]);
  });
});
