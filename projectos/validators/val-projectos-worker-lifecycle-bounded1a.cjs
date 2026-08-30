"use strict";
/**
 * A WORKER ATTEMPT CAN BE ENDED, AND ONLY THE RIGHT PROCESS IS EVER ENDED —
 * PROJECTOS-WORKER-CHANNEL-HARDENING1A.
 *
 * Two properties, and they pull in opposite directions, which is why both are pinned here rather
 * than left to whoever edits this code next.
 *
 * THE FIRST: an attempt must be bounded. The runtime starts a worker and waits for it synchronously,
 * so an unbounded wait is not a slow run — it is a run that cannot end, holding the phase and the
 * process open with no remedy inside ProjectOS. That is what it did before this phase. The unit
 * tests prove today's bound; this proves the SHAPE that keeps it: the runner still honours a bound,
 * the adapter still passes one to every worker spawn, and the outcome of reaching one is still its
 * own thing rather than a number borrowed from an exit code.
 *
 * THE SECOND: reaching for a bigger hammer must stay impossible. The obvious way to "really make
 * sure the worker is gone" is to kill by executable name — `taskkill /im`, `Stop-Process -Name`,
 * `pkill`. On this owner's machine that would terminate their own editor, their own shells and their
 * own Claude sessions, none of which ProjectOS started. Termination is by the exact pid this runtime
 * created, or it does not happen.
 *
 * DELIBERATELY SCOPED TO PRODUCTION SOURCE. A previous validator in this repository banned a bare
 * name and failed legitimate code that had always used it, and a validator that fails correct code
 * teaches people to work around it. Test and tooling directories are not scanned: a test that starts
 * a process it owns and then ends it is doing exactly the right thing.
 *
 * Reads files. Runs nothing, kills nothing, calls no provider, selects no project.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

/** The one adapter directory. A second file here would be a second way to start a worker. */
const ADAPTER_DIR = "projectos/agent/src/loop/adapters";
const ADAPTER_REL = `${ADAPTER_DIR}/claudeCodeCli.ts`;
const SYSTEM_REL = "projectos/agent/src/system.ts";
const WORKERS_REL = "projectos/agent/src/loop/workers.ts";
const RUNNER_REL = "projectos/agent/src/loop/runner.ts";
const ROUTING_REL = "projectos/agent/src/loop/gatekeeperRouting.ts";
/** The only two places in the product that terminate a process tree. */
const SIDECAR_REL = "projectos/control-center/sidecar/host.mjs";
const OFF_LOOP_REL = "projectos/control-center/sidecar/offLoopCommand.mjs";

/** Production source that may never reach for a name-matched kill. */
const SCANNED_DIRS = [
  "projectos/agent/src",
  "projectos/control-center/src",
  "projectos/control-center/sidecar",
  "projectos/core/src",
];

/**
 * Ways of ending a process that do not name a pid.
 *
 * Each of these kills by what a process IS rather than by which one this runtime started, so each
 * would reach processes the owner started themselves. `taskkill /im` is the exact spelling that
 * would have taken every Claude session on the machine, including the one doing the work.
 */
const BROAD_KILLS = Object.freeze([
  { re: /taskkill[^\n]*\/im\b/i, why: "taskkill /im ends every process with that image name" },
  { re: /Stop-Process[^\n]*-Name\b/i, why: "Stop-Process -Name ends every process with that name" },
  { re: /\bpkill\b/i, why: "pkill matches on name, not on a pid this runtime created" },
  { re: /\bkillall\b/i, why: "killall matches on name, not on a pid this runtime created" },
  { re: /taskkill[^\n]*\/fi\b/i, why: "taskkill /fi selects processes by filter rather than by pid" },
]);

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments, so a rule is never satisfied — or broken — by prose describing it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function sourcesUnder(dir, out) {
  const acc = out || [];
  const abs = path.join(ROOT, ...dir.split("/"));
  if (!fs.existsSync(abs)) return acc;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|cjs|js)$/.test(ent.name)) acc.push(p);
    }
  };
  walk(abs);
  return acc;
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  // 1. ONE CANONICAL ADAPTER. A second file here is a second worker channel, and a second channel is
  //    a second set of rules about bounds, cleanup and truthfulness that nobody reconciled.
  const adapterDirAbs = path.join(ROOT, ...ADAPTER_DIR.split("/"));
  if (!fs.existsSync(adapterDirAbs)) {
    E(`${ADAPTER_DIR} is missing — it holds the one worker adapter`);
    return errors;
  }
  const adapterFiles = fs.readdirSync(adapterDirAbs).filter((f) => f.endsWith(".ts"));
  if (adapterFiles.length !== 1 || adapterFiles[0] !== "claudeCodeCli.ts") {
    E(
      `${ADAPTER_DIR} holds ${adapterFiles.length} adapter(s) (${adapterFiles.join(", ") || "none"}); ` +
        "exactly one canonical Claude adapter may exist",
    );
  }

  const adapterRaw = read(ADAPTER_REL);
  if (adapterRaw === null) {
    E(`${ADAPTER_REL} is missing — it is the one way a worker is started`);
    return errors;
  }
  const adapter = code(adapterRaw);

  // 2. EVERY WORKER SPAWN CARRIES A BOUND. Counted, not merely present once: the adapter starts a
  //    worker in two places, and a bound on only one of them leaves the other able to hang forever.
  //    SCANNED PER CALL SITE, not counted as one literal spelling. Pinning the exact text
  //    `timeoutMs: worker.timeoutMs` would fail a future refactor that built the options through a
  //    shared helper — correct code, refused. What matters is that a bound reaches every spawn, so
  //    each call's own arguments are what gets read.
  const execSites = [];
  for (let i = adapter.indexOf("sys.exec("); i !== -1; i = adapter.indexOf("sys.exec(", i + 1)) {
    execSites.push(adapter.slice(i, adapter.indexOf(");", i) + 2));
  }
  if (execSites.length === 0) {
    E(`${ADAPTER_REL} no longer spawns anything — the rule below would pass vacuously`);
  }
  for (const [i, site] of execSites.entries()) {
    // A DECLARED OPTION, not merely the word somewhere nearby. The window a call site occupies can
    // reach into the enclosing expression — the adapter wraps each spawn in a call that also takes
    // the bound — so testing for the bare word passed even with the option removed. Measured that
    // way round: the negative case was run before this rule was trusted.
    //
    // If a future refactor builds these options through a shared helper, this fires on correct code.
    // That is the deliberate direction to fail in: a rule that shouts at a refactor gets read, and a
    // rule that misses a spawn losing its bound does not.
    if (!/timeoutMs\s*:/.test(site)) {
      E(
        `${ADAPTER_REL} spawn #${i + 1} carries no attempt bound; ` +
          "an attempt without one cannot be ended from inside the runtime",
      );
    }
  }
  // AND IT REFUSES A WORKER THAT CARRIES NO BOUND, rather than spawning it unbounded.
  if (!/boundProblem\(/.test(adapter)) {
    E(`${ADAPTER_REL} no longer refuses a worker that declares no attempt bound`);
  }

  // 3. THE PROCESS RUNNER HONOURS THE BOUND AND REPORTS WHAT HAPPENED.
  const system = read(SYSTEM_REL);
  if (system === null) {
    E(`${SYSTEM_REL} is missing — it is the only impure edge that spawns anything`);
  } else {
    const sys = code(system);
    if (!/timeout:\s*options\.timeoutMs/.test(sys)) {
      E(`${SYSTEM_REL} no longer passes the requested bound to the spawn, so nothing is actually bounded`);
    }
    if (!/killSignal/.test(sys)) {
      E(`${SYSTEM_REL} no longer forces the kill signal; a bound a child may decline is not a bound`);
    }
    // A killed child and a child that never existed both report a null status. Collapsing either into
    // an exit code states an exit that never happened.
    if (!/ETIMEDOUT/.test(sys) || !/failure/.test(sys)) {
      E(`${SYSTEM_REL} no longer distinguishes a bound that was reached from an ordinary exit`);
    }
  }

  // 4. THE THREE OUTCOMES STAY THREE. A timeout folded back into a refusal tells a reviewer the
  //    worker said something it never said; folded into an exit code, it invents a status.
  const workers = read(WORKERS_REL);
  if (workers === null) {
    E(`${WORKERS_REL} is missing — it declares the worker seam`);
  } else if (!/kind:\s*'timedOut'/.test(code(workers))) {
    E(`${WORKERS_REL} no longer declares a distinct outcome for an attempt that was ended`);
  }
  const runner = read(RUNNER_REL);
  if (runner === null) {
    E(`${RUNNER_REL} is missing — it is the one execution loop`);
  } else {
    const r = code(runner);
    if (!/WORKER_TIMED_OUT/.test(r)) {
      E(`${RUNNER_REL} no longer produces a distinct stop for an attempt that ran past its bound`);
    }
  }
  const routing = read(ROUTING_REL);
  if (routing === null) {
    E(`${ROUTING_REL} is missing — it decides who may answer a stop`);
  } else {
    // MATCHED AS AN ENTRY, not as a substring split. A second occurrence of the name elsewhere in the
    // file — a `case` label, say — would silently move which text this rule inspects, and a rule that
    // reads the wrong text can pass while the thing it guards is broken.
    const routingCode = code(routing);
    const LABEL = "WORKER_TIMED_OUT:";
    const entries = routingCode.split(LABEL).length - 1;
    if (entries !== 1) {
      E(
        `${ROUTING_REL} declares ${entries} route entries for WORKER_TIMED_OUT; ` +
          "exactly one is expected, and this rule cannot say which of several it read",
      );
    }
    const at = routingCode.indexOf(LABEL);
    // The entry closes at its own first `},` — its verdicts are an array and its rationale a
    // string, so nothing nested can end it earlier.
    const timedOut = at === -1 ? undefined : routingCode.slice(at, routingCode.indexOf("},", at) + 2);
    if (timedOut === undefined) {
      E(`${ROUTING_REL} does not route WORKER_TIMED_OUT, so the stop would have no audience`);
    } else if (/APPROVED_TO_PROCEED/.test(timedOut)) {
      E(
        `${ROUTING_REL} allows APPROVED_TO_PROCEED for a run that was cut off; there is no finished ` +
          "work there to approve, and certifying it would rest on a single word",
      );
    }
  }

  // 5. THE ONE TERMINATION PATH IN THE PRODUCT KILLS AN EXACT PID, WITH AN ABSOLUTE EXECUTABLE.
  const sidecar = read(SIDECAR_REL);
  if (sidecar === null) {
    E(`${SIDECAR_REL} is missing — it owns the only stop the owner can press`);
  } else {
    const host = code(sidecar);
    if (!/\/pid/.test(host)) {
      E(`${SIDECAR_REL} no longer terminates by pid; nothing else identifies the run this sidecar started`);
    }
    // A bare command name resolves against the spawning process's current directory before anything
    // else — and in a development launch that directory is inside a governed checkout.
    if (/spawn(Sync)?\(\s*['"]taskkill['"]/.test(host)) {
      E(
        `${SIDECAR_REL} spawns 'taskkill' by bare name; it must resolve an absolute executable, as ` +
          "this runtime already does for git, PowerShell and the worker",
      );
    }
    if (!/taskkillPath\(/.test(host)) {
      E(`${SIDECAR_REL} no longer resolves the process tool to an absolute path before using it`);
    }
    // Fire-and-forget cannot report what it did: `spawn` fails asynchronously, so a `try/catch`
    // around it never runs and an unhandled error event ends this process.
    //
    // READ FROM THE FUNCTION'S OWN BODY, not by matching a local variable's name. Pinning the
    // spelling `spawnSync(exe` would fail the moment somebody renamed a variable without changing
    // any behaviour at all.
    // A newline built rather than written as an escape: this file has been edited through
    // tooling that mangles backslash escapes, and a silently broken needle here would make
    // the rule read an empty string and pass.
    const NL = String.fromCharCode(10);
    const stopBody = host.slice(host.indexOf("function stopGovernedRun"));
    const stopFn = stopBody.slice(0, stopBody.indexOf(NL + "}") + 2);
    if (stopFn.trim() === "" || !/spawnSync\(/.test(stopFn)) {
      E(`${SIDECAR_REL} does not wait for the termination it reports, so its answer cannot be true`);
    }
    if (/spawn\(/.test(stopFn)) {
      E(`${SIDECAR_REL} terminates asynchronously; a spawn failure there is unobservable and ends this process`);
    }
  }

  // 5b. THE OTHER BOUNDED CHANNEL. Off-loop governed commands already had a bound before this phase,
  //     and stopped a hung one the same way — by an exact pid, through a bare command name. One
  //     absolute-path rule enforced on one of two identical spawns teaches that the rule is arbitrary.
  const offLoop = read(OFF_LOOP_REL);
  if (offLoop === null) {
    E(`${OFF_LOOP_REL} is missing — it bounds the off-loop governed command channel`);
  } else {
    const o = code(offLoop);
    if (/spawn(Sync)?\(\s*['"]taskkill['"]|nodeSpawn\(\s*['"]taskkill['"]/.test(o)) {
      E(`${OFF_LOOP_REL} spawns 'taskkill' by bare name; it must resolve an absolute executable`);
    }
    if (!/OFF_LOOP_COMMAND_TIMEOUT_MS\s*=/.test(o)) {
      E(`${OFF_LOOP_REL} no longer bounds an off-loop governed command`);
    }
    // `spawn` fails asynchronously, so an unhandled `error` event would end the daemon.
    if (!/on\(\s*['"]error['"]/.test(o)) {
      E(`${OFF_LOOP_REL} does not handle a spawn failure on the process tool; an unhandled error event ends the daemon`);
    }
  }

  // 6. NOTHING IN PRODUCTION SOURCE KILLS BY NAME.
  let scanned = 0;
  for (const dir of SCANNED_DIRS) {
    for (const abs of sourcesUnder(dir)) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const src = code(fs.readFileSync(abs, "utf8"));
      scanned += 1;
      for (const { re, why } of BROAD_KILLS) {
        if (re.test(src)) {
          E(`${rel} terminates processes by name or filter — ${why}; only an exact owned pid may be ended`);
        }
      }
    }
  }
  if (scanned === 0) E("no production sources were scanned — the name-kill rule would pass vacuously");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-worker-lifecycle-bounded1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-worker-lifecycle-bounded1a: PASS");
}

module.exports = { run, ADAPTER_REL, SIDECAR_REL, BROAD_KILLS };
