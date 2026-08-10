"use strict";
/**
 * The Phase-17 zero-relay acceptance proof, as a runnable harness.
 *
 * It is committed rather than run once from a scratchpad so the proof is REPRODUCIBLE: the evidence
 * this leaves behind is only worth anything if someone else can regenerate it and get the same
 * ledger shape from the same code.
 *
 * TWO RUNS, because the two properties cannot both be shown by one:
 *
 *   1. OWNER STOP. The owner stops the project in the window between the continuation permit and the
 *      spawn. The executor's last check catches it, records that the stop was honoured, and starts
 *      NOTHING. The absence of a spawn in that ledger is the evidence.
 *   2. COMPLETE HANDOFF. Worker A takes ownership, works, checkpoints, releases, and PROVES the
 *      release by being refused its next write. Its process exits. ProjectOS then decides and starts
 *      Worker B, which independently re-derives the world, matches it against the checkpoint,
 *      refuses a protected action, performs the one stored continuation, and updates durable state.
 *
 * BETWEEN A AND B NOTHING IS TYPED. The supervisor reads durable state, asks the planner, asks the
 * executor; the executor hands the child identifiers only. What this does NOT prove is that no human
 * was in the room — see the validator, which states the same limit.
 *
 * The owner-stop run acts with the owner's authority, which the Phase-17 directive grants for this
 * proof specifically. It restores the previous state afterwards.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
const fs = require("fs");
const path = require("path");

const supervisor = require("./continuation-supervisor.cjs");
const ownerControl = require("./owner-control.cjs");
const ledgerLib = require("./continuity-ledger.cjs");

/** A stable session id per run kind, so a re-run replaces its own evidence rather than accumulating. */
function sessionIdFor(phaseId, kind) {
  return "zr-" + phaseId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + kind;
}

/** Remove a previous run's records for this session so a re-run is a fresh proof, not an append. */
function clearSession(root, sessionId) {
  const dir = ledgerLib.continuityDir(root);
  for (const suffix of [".json", ".checkpoint.json", ".brief.json", ".continuation.json"]) {
    const p = path.join(dir, sessionId + suffix);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

async function ownerStopRun(root, projectId, phaseId) {
  const sessionId = sessionIdFor(phaseId, "ownerstop");
  clearSession(root, sessionId);
  const before = ownerControl.read(root);
  try {
    ownerControl.set(root, "running", "owner (Phase-17 proof authorisation)");
    const result = await supervisor.runHandoff(root, {
      sessionId: sessionId,
      projectId: projectId,
      phaseId: phaseId,
      checkpointId: sessionId + "-cp1",
      boundary: "owner-stop proof: stop arrives after the permit",
      nextSafeAction: {
        kind: "record-continuation-note",
        params: { note: "This continuation must never run: the owner stops the project before the spawn." },
      },
      // The stop lands in the only window where S15 is the control that catches it.
      onPermitted: () => {
        ownerControl.set(root, "stopped", "owner (Phase-17 proof authorisation)");
      },
    });
    return { sessionId: sessionId, result: result };
  } finally {
    // Restore whatever the owner's standing instruction was before the proof touched it.
    if (before.source === "absent (no owner intervention recorded)") {
      const p = ownerControl.controlPath(root);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } else {
      ownerControl.set(root, before.state, "owner (restored after the Phase-17 proof)");
    }
  }
}

async function handoffRun(root, projectId, phaseId) {
  const sessionId = sessionIdFor(phaseId, "handoff");
  clearSession(root, sessionId);
  const result = await supervisor.runHandoff(root, {
    sessionId: sessionId,
    projectId: projectId,
    phaseId: phaseId,
    checkpointId: sessionId + "-cp1",
    boundary: "capacity boundary reached; smallest atomic unit complete",
    nextSafeAction: {
      kind: "record-continuation-note",
      params: {
        note:
          "Resumed from the durable checkpoint with no prompt relay: repository, branch, active plan " +
          "version, phase, head and checkpoint id were all re-derived by this worker and matched.",
      },
    },
  });
  return { sessionId: sessionId, result: result };
}

async function main(argv) {
  const root = path.resolve(argv[0] || path.join(__dirname, "..", ".."));
  const projectId = argv[1] || "projectos";
  const phaseId = argv[2];
  if (typeof phaseId !== "string" || phaseId.length === 0) {
    process.stderr.write("usage: node zero-relay-proof.cjs <root> <projectId> <phaseId>\n");
    return 1;
  }

  const stop = await ownerStopRun(root, projectId, phaseId);
  const stopOk = stop.result.ok === false && stop.result.stage === "executor";
  process.stdout.write(
    "owner-stop run   : " + (stopOk ? "REFUSED as required" : "UNEXPECTED — " + JSON.stringify(stop.result)) + "\n" +
    "                   session " + stop.sessionId + "\n",
  );

  const handoff = await handoffRun(root, projectId, phaseId);
  process.stdout.write(
    "handoff run      : " + (handoff.result.ok ? "COMPLETE" : "FAILED at " + handoff.result.stage + " — " + handoff.result.detail) + "\n" +
    "                   session " + handoff.sessionId + "\n",
  );
  if (handoff.result.ok) {
    process.stdout.write(
      "                   supervisor pid " + handoff.result.supervisorPid +
      ", worker A pid " + handoff.result.workerA.pid +
      ", worker B pid " + handoff.result.workerB.pid + "\n" +
      "                   worker B argv " + JSON.stringify(handoff.result.argv) + "\n",
    );
  }
  return stopOk && handoff.result.ok ? 0 : 1;
}

module.exports = { sessionIdFor, clearSession, ownerStopRun, handoffRun, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
