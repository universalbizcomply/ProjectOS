/**
 * RUNNING ONE GOVERNED COMMAND WITHOUT BLOCKING THE DAEMON.
 *
 * THE OUTAGE THIS CLOSES. `plan.draft --authored` reaches a provider through the trusted broker, and
 * the broker is invoked with `spawnSync`. Called in-process, that stops the sidecar's event loop for
 * the whole of the provider's latency — eighteen seconds on the first live call. The daemon
 * heartbeats every five seconds against a twelve-second liveness window, so a blocked daemon and a
 * dead one are the same thing from outside: the renderer concluded RUNTIME_STOPPED, unmounted the
 * panel holding the owner's in-flight command, and the answer to a call that had already cost real
 * money arrived at a component that no longer existed. The owner saw a blank form and pressed again.
 *
 * IT IS ITS OWN FILE SO IT CAN BE PROVEN. The property that matters — this process keeps running
 * while the command does not — is invisible to a unit test of a function buried in the daemon's
 * dispatch. Here it can be driven against a real child process with a real clock.
 *
 * IT IS NOT A JOB SYSTEM. No queue, no persistence, no resumption, no second command vocabulary: the
 * caller has already validated the request, and this starts one child, waits, and reports once.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A (post-live-call correction).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { platform } from 'node:process';

/**
 * The most time one off-loop governed command may take before it is stopped.
 *
 * ABOVE THE PROVIDER'S OWN CEILING, ON PURPOSE. The trusted broker aborts at 120s by default and
 * refuses to be asked for more than 300s, so a bound below that would kill a call the provider was
 * still legitimately answering — and a killed authoring call is one that may have been paid for and
 * can never be asked again. This is a backstop against a hung child, not a second opinion about how
 * long a provider may take.
 */
export const OFF_LOOP_COMMAND_TIMEOUT_MS = 330_000;

/**
 * The most output one worker may produce before it is treated as faulty.
 *
 * The worker prints ONE result line. Anything approaching this is a worker that has gone wrong, and
 * accumulating it without limit would let a faulty child exhaust the daemon's memory — the sibling
 * broker spawn bounds itself with `maxBuffer` for the same reason.
 */
const MAX_WORKER_OUTPUT_BYTES = 1_000_000;

/**
 * The process tool, resolved to ONE ABSOLUTE EXECUTABLE — never spawned by bare name.
 *
 * Same rule this runtime already applies to git, to PowerShell and to the governed worker. A bare
 * name resolves against the spawning process's current directory before anything else, and in a
 * development launch that directory is inside the ProjectOS checkout: a `taskkill.exe` committed to
 * a governed repository would otherwise be executed with the daemon's authority the moment a command
 * ran long. Null when it cannot be resolved, and the caller then falls back to the single-process
 * kill and reaches no further than the one pid it owns.
 */
function taskkillPath() {
  const root = process.env.SystemRoot ?? process.env.windir;
  if (typeof root !== 'string' || root.trim() === '') return null;
  const exe = joinPath(root, 'System32', 'taskkill.exe');
  return existsSync(exe) ? exe : null;
}

/**
 * Stop the worker AND anything it started.
 *
 * WHY `child.kill()` IS NOT ENOUGH, found by adversarial review. The worker reaches the provider
 * through the trusted broker, and the broker is invoked with `spawnSync` — so at the exact moment
 * this backstop is most likely to fire, the worker is blocked inside a GRANDCHILD process that holds
 * the credential and is making the real call. `kill()` terminates one pid; on Windows it does not
 * touch descendants. That would leave a paid call running with nothing alive to record its outcome:
 * the very loss this correction exists to prevent, reintroduced by its own timeout.
 */
function killTree(child) {
  const exe = platform === 'win32' ? taskkillPath() : null;
  if (exe !== null && typeof child.pid === 'number') {
    try {
      // Fire-and-forget: this runs on the daemon's loop and must not block it. The `error` listener
      // is not decoration — an unhandled `error` event on a child process ends this process, and
      // `spawn` reports a failure to start asynchronously, so the `catch` below can never see it.
      nodeSpawn(exe, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
      return;
    } catch {
      /* fall through to the single-process kill below */
    }
  }
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}

/**
 * Start one governed command in a child process and report its result EXACTLY ONCE.
 *
 * Close, spawn failure and the timeout all race, and every one of them wants to report. A latch
 * makes the first the only one: a second `governed-result` for a single correlation id would resolve
 * a promise that a different outcome had already settled.
 */
export function startOffLoopCommand({
  root,
  invocation,
  verb,
  emit,
  onSettled = () => {},
  active,
  workerPath,
  spawnFn = nodeSpawn,
  timeoutMs = OFF_LOOP_COMMAND_TIMEOUT_MS,
}) {
  // ONE AT A TIME, PER PROJECT. Two provider-backed commands for one project is two chances to spend,
  // and the deterministic request id means the second is refused anyway — after the money.
  if (active.has(root)) {
    emit(
      2,
      [
        'REFUSED (COMMAND_ALREADY_ACTIVE): a governed command that calls out to a provider is already',
        '  running for this project. Wait for it to finish — asking twice can spend twice.',
      ],
      verb,
    );
    return;
  }
  if (typeof workerPath !== 'string' || workerPath === '') {
    emit(2, ['REFUSED (RUNTIME_ERROR): the governed worker is not present in this installation.'], verb);
    return;
  }

  let child;
  try {
    // NODE_OPTIONS IS NOT INHERITED. `NODE_OPTIONS=--require ./x.js` preloads arbitrary code into a
    // spawned Node process before a single line of the worker runs, and this worker goes on to load
    // the governance engines and reach the credential broker. The sibling broker spawn names this
    // threat explicitly and passes an allowlist; the worker legitimately needs the daemon's own
    // environment (its bound git, its state directory), so the preload vector is removed rather than
    // the environment rebuilt.
    const env = { ...process.env };
    delete env['NODE_OPTIONS'];
    child = spawnFn(process.execPath, [workerPath], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    emit(2, ['REFUSED (RUNTIME_ERROR): the governed command could not be started.'], verb);
    return;
  }

  active.set(root, child);

  let settled = false;
  let stdout = '';
  let timer = null;

  const done = (code, lines) => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    active.delete(root);
    emit(code, lines, verb);
    // Durable state is re-read AFTER the command, exactly as the in-process path does, so the surface
    // shows what actually persisted rather than what the command was expected to do.
    onSettled();
  };

  timer = setTimeout(() => {
    killTree(child);
    done(2, [
      'REFUSED (COMMAND_TIMEOUT): the governed command did not finish in time and was stopped.',
      '  A stopped call may still have been dispatched and paid for, and stopping it means no',
      '  attempt evidence could be written. The installation call ledger is what actually answers',
      '  whether the provider replied — this message cannot.',
    ]);
  }, timeoutMs);

  child.stdout.on('data', (chunk) => {
    if (stdout.length > MAX_WORKER_OUTPUT_BYTES) return;
    stdout += chunk.toString('utf8');
    if (stdout.length > MAX_WORKER_OUTPUT_BYTES) {
      killTree(child);
      done(2, ['REFUSED (RUNTIME_ERROR): the governed command produced more output than it may.']);
    }
  });
  // The worker redacts before it writes and its stderr is a marker, not a message; the owner is shown
  // the command's own words instead.
  child.stderr.on('data', () => {});
  child.on('error', () => {
    done(2, ['REFUSED (RUNTIME_ERROR): the governed command could not be started.']);
  });
  child.on('close', () => {
    const line = stdout.split('\n').find((l) => l.trim() !== '');
    if (line === undefined) {
      done(2, ['REFUSED (RUNTIME_ERROR): the governed command reported no result.']);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      done(2, ['REFUSED (RUNTIME_ERROR): the governed command reported an unreadable result.']);
      return;
    }
    const lines = Array.isArray(parsed.lines) ? parsed.lines.filter((l) => typeof l === 'string') : [];
    done(typeof parsed.code === 'number' ? parsed.code : 2, lines);
  });

  try {
    child.stdin.end(JSON.stringify({ root, ...invocation }));
  } catch {
    done(2, ['REFUSED (RUNTIME_ERROR): the governed command could not be given its request.']);
  }
}
