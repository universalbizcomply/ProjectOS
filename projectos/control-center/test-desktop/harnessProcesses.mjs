/**
 * Kill what the harness started, and NOTHING the owner started.
 *
 * THE DEFECT THIS REPLACES. `wdio.conf.ts` tore down every session with
 *
 *     Get-Process -Name projectos-control-center | Stop-Process -Force
 *
 * — a sweep BY EXECUTABLE NAME, run after every spec. It cannot tell a process the harness launched
 * from the Control Centre the owner has open on the same machine, so running the desktop suite killed
 * the owner's own application. That was reported as "the installed Control Centre is undriveable
 * while E2E runs", and it is fatal to the one proof this phase most needs: an owner-attended live
 * approval, where the window the owner is meant to click in is the window the harness reaps.
 *
 * THE FIX IS NOT NEW. `smoke.mjs` already did the right thing — snapshot the pids that exist BEFORE
 * the harness starts, and afterwards kill only pids that were not in that set. This file is that
 * logic extracted so both harnesses share one implementation rather than one having it and the other
 * not. No new cleanup system was invented; the existing one was moved to where both callers can
 * reach it.
 *
 * WHY THE RETRY LOOP IS PART OF IT. msedgedriver tears the application down ASYNCHRONOUSLY after a
 * session ends, and the app's pid can re-materialise just after a single sweep. One pass leaves
 * orphans; the loop settles and re-sweeps until nothing new lingers.
 *
 * A PID CAN BE REUSED, and this is honest about it: if Windows recycles a reaped pid to a process the
 * owner starts mid-run, the snapshot will not contain it and it would be reaped. That window is
 * seconds wide and vastly narrower than killing by name, which reaps the owner's process every single
 * time. Stated rather than hidden.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/** The processes a desktop run is allowed to reap, by executable name. */
export const HARNESS_PROC_NAMES = Object.freeze([
  'tauri-driver.exe',
  'msedgedriver.exe',
  'projectos-control-center.exe',
]);

/**
 * A process name this module will look for.
 *
 * NARROW BECAUSE IT IS INTERPOLATED. The names come from the frozen list above and never from a
 * caller's input, but this function is exported and a later caller could pass anything. Checking the
 * shape here — rather than trusting the call site — is what keeps the interpolation below safe under
 * a change nobody remembers to re-audit.
 */
const PROC_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Pids currently running under `name`. Empty on any failure — never a guess, never a wildcard.
 *
 * `execFileSync`, NOT `execSync`: the arguments go straight to the program instead of through a
 * shell, so nothing here is re-parsed for metacharacters. This codebase has already paid once for
 * spawning through a shell (`cmd /c move`, resolved against the governed checkout), and a test
 * harness is not a reason to do it again.
 */
export function pidsByName(name) {
  if (!PROC_NAME.test(name)) return new Set();
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process -Name '${name.replace(/\.exe$/, '')}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    return new Set(
      out
        .split(/\r?\n/)
        .map((l) => Number(l.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
  } catch {
    return new Set();
  }
}

/**
 * What was already running before the harness touched anything.
 *
 * TAKEN ONCE, AS EARLY AS POSSIBLE. A snapshot taken after the first app launch would contain the
 * harness's own process and then refuse to reap it, which is the opposite failure and just as bad.
 */
export function snapshotHarnessPids(names = HARNESS_PROC_NAMES) {
  const before = {};
  for (const n of names) before[n] = pidsByName(n);
  return before;
}

/**
 * Which pids this sweep WOULD reap — the whole decision, separated from the killing.
 *
 * SEPARATED SO IT CAN BE PROVEN. "The owner's Control Centre survives teardown" is a claim about
 * exactly this function, and a test that had to kill a real process to check it would be a test
 * nobody dares run on the machine the owner works on. This is the part that decides; the caller
 * below is the part that acts.
 */
export function newPids(before, names = HARNESS_PROC_NAMES) {
  const out = [];
  for (const n of names) {
    const known = before[n] ?? new Set();
    for (const pid of pidsByName(n)) {
      if (!known.has(pid)) out.push({ name: n, pid });
    }
  }
  return out;
}

/** One sweep. Returns how many processes it reaped. */
export function reapNewOnce(before, names = HARNESS_PROC_NAMES) {
  let killed = 0;
  for (const { pid } of newPids(before, names)) {
    killed += 1;
    try {
      // The pid is already proven to be a positive integer by `pidsByName`, and it travels as an
      // argument rather than inside a command string, so there is nothing for a shell to reinterpret.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* already gone, or not ours to stop; the count below reports what remains */
    }
  }
  return killed;
}

/**
 * Settle, sweep, repeat — then say what is left.
 *
 * `remaining` is reported rather than thrown on, because a lingering harness process is information
 * the caller decides what to do with: `smoke.mjs` records it as a failure, and a WDIO `afterSession`
 * must not throw or it masks the spec result that actually matters.
 */
export async function reapHarnessProcesses(before, { rounds = 8, pauseMs = 500, names = HARNESS_PROC_NAMES } = {}) {
  let reaped = 0;
  for (let i = 0; i < rounds; i += 1) {
    await sleep(pauseMs);
    reaped += reapNewOnce(before, names);
  }
  let remaining = 0;
  for (const n of names) {
    const known = before[n] ?? new Set();
    for (const pid of pidsByName(n)) if (!known.has(pid)) remaining += 1;
  }
  return { reaped, remaining };
}
