/**
 * A GOVERNED COMMAND LONGER THAN THE LIVENESS WINDOW MUST STILL BE REPORTABLE.
 *
 * THE OUTAGE THIS FILE EXISTS FOR. `plan.draft --authored` calls a provider through the trusted
 * broker, and the broker is invoked with `spawnSync`. Run in the daemon's own process, that stops its
 * event loop for the entire provider latency — at least eighteen seconds on the first live call. The
 * daemon heartbeats every five seconds against a TWELVE-SECOND liveness window, so a blocked daemon
 * is indistinguishable from a dead one: the renderer declared RUNTIME_STOPPED, unmounted the panel
 * holding the owner's in-flight command, and the result of a call that had already cost real money
 * arrived nowhere. The owner saw a blank form and pressed again — a second paid attempt for one
 * deliberate act, refused only because the request id is deterministic.
 *
 * THIS IS NOT AUTHORING-SPECIFIC, which is why the proof is not authoring-specific either. The
 * subject is the runner, driven with real child processes and a real clock; the "provider" here is a
 * script that sleeps. Nothing in this file makes a network call or spends anything.
 *
 * THE CONTROL MATTERS AS MUCH AS THE PROOF. The first test below reproduces the DEFECT — `spawnSync`
 * really does starve this process's timers — so the passing tests that follow are known to be
 * capable of failing. A regression test that cannot detect the bug it was written for is decoration.
 */
import { describe, test, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startOffLoopCommand } from '../sidecar/offLoopCommand.mjs';

/** Longer than the daemon's 12-second liveness window, with margin. */
const BEYOND_LIVENESS_MS = 13_500;

const dir = mkdtempSync(join(tmpdir(), 'projectos-offloop-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in worker: sleeps, then speaks the worker protocol. Never touches a network. */
function worker(name: string, body: string): string {
  const path = join(dir, `${name}.mjs`);
  writeFileSync(path, body, 'utf8');
  return path;
}

const sleepThenReport = (ms: number, code: number, lines: readonly string[]) => `
const until = Date.now() + ${ms};
const tick = () => {
  if (Date.now() >= until) {
    process.stdout.write(JSON.stringify({ kind: 'governed-worker-result', code: ${code}, lines: ${JSON.stringify(lines)} }) + '\\n');
    process.exit(0);
  }
  setTimeout(tick, 25);
};
tick();
`;

const SILENT = (ms: number) => `setTimeout(() => process.exit(0), ${ms});`;

type Emission = { code: number; lines: readonly string[]; verb: string };

/** Run one command and resolve with every emission it produced, plus how freely this loop ran. */
function run(opts: {
  workerPath: string;
  timeoutMs?: number;
  active?: Map<string, unknown>;
  alsoStartSecond?: boolean;
}): Promise<{ emissions: Emission[]; ticks: number; settledCalls: number; elapsedMs: number }> {
  return new Promise((resolve) => {
    const emissions: Emission[] = [];
    let settledCalls = 0;
    let ticks = 0;
    const started = Date.now();
    // THE HEARTBEAT, STOOD IN FOR. The daemon proves it is alive by answering on a timer; if this
    // interval stops firing, so does that.
    const beat = setInterval(() => {
      ticks += 1;
    }, 250);

    const active = opts.active ?? new Map<string, unknown>();
    const emit = (code: number, lines: readonly string[], verb: string) => {
      emissions.push({ code, lines, verb });
      // Deliberately NOT resolving here: a second emission would be the defect, so the promise waits
      // for the clock instead of for the first answer.
    };
    startOffLoopCommand({
      root: dir,
      invocation: { command: 'plan', positionals: ['draft'], flags: { objective: 'x', authored: 'true' } },
      verb: 'plan.draft',
      emit,
      onSettled: () => {
        settledCalls += 1;
      },
      active,
      workerPath: opts.workerPath,
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });

    if (opts.alsoStartSecond === true) {
      startOffLoopCommand({
        root: dir,
        invocation: { command: 'plan', positionals: ['draft'], flags: { objective: 'y', authored: 'true' } },
        verb: 'plan.draft',
        emit,
        onSettled: () => {
          settledCalls += 1;
        },
        active,
        workerPath: opts.workerPath,
      });
    }

    const finish = () => {
      clearInterval(beat);
      resolve({ emissions, ticks, settledCalls, elapsedMs: Date.now() - started });
    };
    // Wait for the command AND a grace period, so a duplicate emission has time to appear.
    const waitFor = (opts.timeoutMs ?? BEYOND_LIVENESS_MS) + 2_500;
    setTimeout(finish, waitFor);
  });
}

describe('the defect is real and this file can see it', () => {
  test('spawnSync starves this process — the mechanism that made a live daemon look dead', () => {
    let ticks = 0;
    const beat = setInterval(() => {
      ticks += 1;
    }, 50);
    const blocked = Date.now();
    // Exactly what `brokeredHttpPort` does to reach the broker, on a much shorter sleep.
    spawnSync(process.execPath, ['-e', 'const u=Date.now()+2000; while(Date.now()<u){}'], { windowsHide: true });
    const elapsed = Date.now() - blocked;
    clearInterval(beat);

    expect(elapsed).toBeGreaterThanOrEqual(1_800);
    // A 50ms interval across ~2 seconds would fire around forty times if the loop were free. It is
    // not: the callbacks cannot run at all while spawnSync holds the thread.
    expect(ticks).toBeLessThan(5);
  }, 20_000);
});

describe('a command longer than the liveness window', () => {
  test('does not block this process, and reports exactly once', async () => {
    const path = worker('long-ok', sleepThenReport(BEYOND_LIVENESS_MS, 0, ['Proposed a plan.', 'Draft abc123.']));
    const { emissions, ticks, settledCalls, elapsedMs } = await run({ workerPath: path });

    // THE COMMAND REALLY DID OUTLAST THE WINDOW the daemon would have died inside.
    expect(elapsedMs).toBeGreaterThan(12_000);
    // THE LOOP KEPT RUNNING THROUGHOUT. A 250ms interval over 16 seconds is ~64 ticks; anything near
    // that means the daemon could have gone on answering snapshots, which is the whole fix.
    expect(ticks).toBeGreaterThan(40);
    // EXACTLY ONE RESULT, and it is the command's own words.
    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.code).toBe(0);
    expect(emissions[0]!.lines).toEqual(['Proposed a plan.', 'Draft abc123.']);
    expect(emissions[0]!.verb).toBe('plan.draft');
    // Durable state is re-read once, after the command.
    expect(settledCalls).toBe(1);
  }, 40_000);

  test('a refusal is reported verbatim, and is still exactly one result', async () => {
    const path = worker(
      'long-refusal',
      sleepThenReport(13_000, 2, ['REFUSED (AUTHOR_REFUSED): the author returned no structured plan material']),
    );
    const { emissions, ticks } = await run({ workerPath: path });

    expect(ticks).toBeGreaterThan(40);
    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.code).toBe(2);
    expect(emissions[0]!.lines[0]).toContain('AUTHOR_REFUSED');
  }, 40_000);
});

describe('the runner reports once, whatever happens', () => {
  test('a second command for the same project while one is in flight is refused, and spawns nothing', async () => {
    const path = worker('dup', sleepThenReport(3_000, 0, ['Proposed a plan.']));
    const active = new Map<string, unknown>();
    const { emissions } = await run({ workerPath: path, timeoutMs: 8_000, active, alsoStartSecond: true });

    // The duplicate is refused IMMEDIATELY and the first still answers for itself.
    const refusals = emissions.filter((e) => e.lines.join(' ').includes('COMMAND_ALREADY_ACTIVE'));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.code).toBe(2);
    expect(refusals[0]!.lines.join(' ')).toContain('asking twice can spend twice');
    expect(emissions.filter((e) => e.code === 0)).toHaveLength(1);
    // And the slot is released, so the project is not wedged.
    expect(active.size).toBe(0);
  }, 30_000);

  test('a child that never answers is stopped and reported once, not left hanging', async () => {
    const path = worker('hangs', SILENT(20_000));
    const { emissions, settledCalls } = await run({ workerPath: path, timeoutMs: 1_500 });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.code).toBe(2);
    // A silent child that is killed produces no result line, so the runner says so rather than
    // inventing an outcome; either honest wording is acceptable, a second emission is not.
    expect(emissions[0]!.lines.join(' ')).toMatch(/COMMAND_TIMEOUT|reported no result/);
    expect(settledCalls).toBe(1);
  }, 30_000);

  test('an unreadable result is a refusal, never a silent success', async () => {
    const path = worker('garbage', "process.stdout.write('not json\\n'); process.exit(0);");
    const { emissions } = await run({ workerPath: path, timeoutMs: 4_000 });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.code).toBe(2);
    expect(emissions[0]!.lines.join(' ')).toContain('unreadable result');
  }, 20_000);

  test('an absent worker refuses immediately and starts nothing', async () => {
    const emissions: Emission[] = [];
    startOffLoopCommand({
      root: dir,
      invocation: { command: 'plan', positionals: ['draft'], flags: {} },
      verb: 'plan.draft',
      emit: (code: number, lines: readonly string[], verb: string) => emissions.push({ code, lines, verb }),
      active: new Map(),
      workerPath: '',
    });
    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.lines.join(' ')).toContain('governed worker is not present');
  });
});
