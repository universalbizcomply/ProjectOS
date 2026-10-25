"use strict";
/**
 * A RECORD IS NOT A RUNNING PROCESS — PROJECTOS-PROVIDER-RUNTIME-TRUTH-FIX1A.
 *
 * The Health surface used to derive current activity from session RECORDS: any session whose state
 * was not `exited` counted as running. A session record is written when a worker starts and
 * rewritten when it exits, so a worker killed, crashed or lost to a reboot leaves `started` on disk
 * for ever — and nothing can correct it, because the record carries no process identity. Health then
 * reported "Working" and "Running now: 1" for a process that no longer existed.
 *
 * Under the Autonomy Bootstrap that is worse than a misleading screen: a loop reading it would
 * believe work is in progress and wait for something that will never finish.
 *
 * WHY A VALIDATOR AND NOT ONLY A TEST. The unit tests prove the model's behaviour today. This proves
 * the SHAPE that keeps it true: that the health model still takes a live fact, that the surfaces
 * still pass one, and — the part a test cannot easily pin — that nobody has reintroduced a
 * session-record filter as the source of "running". The failure mode is a future edit that looks
 * harmless and silently restores the old claim.
 *
 * It asserts SOURCE SHAPE, not wording: headline text may change, where liveness comes from may not.
 *
 * Reads files. Runs nothing, calls no provider, touches no credential.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const HEALTH_MODEL = "projectos/control-center/src/ux/healthModel.ts";
/** Every surface that renders the four health groups. Each must pass a live fact, not omit it. */
const CONSUMERS = Object.freeze([
  "projectos/control-center/src/ux/HealthScreen.tsx",
  "projectos/control-center/src/ux/CommandHud.tsx",
  "projectos/control-center/src/ux/commandHudModel.ts",
]);

function read(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments, so a rule is never satisfied — or broken — by prose describing it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const modelRaw = read(HEALTH_MODEL);
  if (modelRaw === null) {
    E(`${HEALTH_MODEL} is missing — the health model is the subject of this check`);
    return errors;
  }
  const model = code(modelRaw);

  // 1. THE LIVE FACT EXISTS AND IS THE INPUT.
  if (!/export interface LiveRunFact\b/.test(model)) {
    E("healthModel no longer declares LiveRunFact — liveness must be an input, not a derivation");
  }
  if (!/function buildHealthModel\s*\([\s\S]{0,300}?liveRun\s*:\s*LiveRunFact\s*\|\s*null/.test(model)) {
    E("buildHealthModel no longer accepts a LiveRunFact — the health model would have to infer liveness");
  }

  // 2. THE EXECUTION GROUP RECEIVES IT.
  if (!/function executionGroup\s*\([\s\S]{0,200}?liveRun\s*:\s*LiveRunFact\s*\|\s*null/.test(model)) {
    E("executionGroup no longer receives the live fact — only it may claim current activity");
  }

  // 3. THE DEFECT ITSELF: a session-record filter must not be the source of "running".
  //
  // The old line was `live.sessions.filter((s) => s.state !== 'exited')` assigned to `running`.
  // Records may still be COUNTED — that is legitimate history — but the binding that feeds an
  // activity claim must not be named as the live one.
  if (/\brunning\s*=\s*live\.sessions\.filter/.test(model)) {
    E(
      "'running' is derived from session records again — a record says a run BEGAN, never that one " +
        "is running; this is the exact defect this phase removed",
    );
  }

  // 4. "Working" must be gated on the live answer, never on a record count.
  const working = /['"`]Working['"`]/.test(model);
  if (working && !/activeNow\s*===\s*true[\s\S]{0,120}?['"`]Working['"`]/.test(model)) {
    E("the 'Working' headline is no longer gated on the live answer being true");
  }

  // 5. UNKNOWN MUST NOT BECOME READY. An unfinished record with no live confirmation is not 'ok'.
  if (!/unconfirmed[\s\S]{0,200}?['"`]unknown['"`]/.test(model)) {
    E("an unconfirmed run no longer produces the 'unknown' tone — not knowing is not being fine");
  }

  // 6. EVERY SURFACE PASSES A LIVE FACT. A consumer that omits it silently gets the null default,
  //    which is safe, but it would also mean the screen can never report real work — and the two
  //    surfaces showing the same groups would disagree.
  for (const rel of CONSUMERS) {
    const raw = read(rel);
    if (raw === null) {
      E(`${rel} is missing — it renders health groups and must supply the live fact`);
      continue;
    }
    const src = code(raw);
    const buildsHealth = /buildHealthModel\s*\(/.test(src);
    const buildsHud = /buildCommandHud\s*\(/.test(src);
    if (!buildsHealth && !buildsHud) continue;

    // It must either read the daemon's live run, or forward one it was given.
    const readsLive = /useGovernedRun\s*\(/.test(src);
    const forwardsLive = /liveRun/.test(src);
    if (!readsLive && !forwardsLive) {
      E(`${rel} builds a health view without supplying a live run fact — activity would be unprovable`);
    }
  }

  // 7. NO PROBE WAS ADDED. This phase corrects a projection; it does not start contacting anyone.
  for (const rel of [HEALTH_MODEL, ...CONSUMERS]) {
    const raw = read(rel);
    if (raw === null) continue;
    const src = code(raw);
    if (/\bfetch\s*\(|XMLHttpRequest|axios|WebSocket\s*\(/.test(src)) {
      E(`${rel} performs a network call — health is derived from what ProjectOS already records`);
    }
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-live-worker-truth1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-live-worker-truth1a: PASS");
}

module.exports = { run, HEALTH_MODEL, CONSUMERS };
