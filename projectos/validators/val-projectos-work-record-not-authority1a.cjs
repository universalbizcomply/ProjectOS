"use strict";
/**
 * A WORK CHECKPOINT REMEMBERS; IT NEVER PERMITS —
 * PROJECTOS-GOVERNED-WORK-QUEUE-CHECKPOINT1A.
 *
 * `.projectops/work.v1.json` records where autonomous work reached: which phase, which state, at
 * which commit, why it stopped, what might be considered next. It exists so a process that ends does
 * not take that knowledge with it.
 *
 * IT IS ALSO THE EASIEST FORGERY IN THE SYSTEM, if anything ever reads it as permission. The
 * implementer can write to the governed checkout. A record saying `state: GATE_APPROVED` or
 * `nextCandidateAction: 'commit'` is one file away, so the moment an execution path derives authority
 * from this store, Claude can grant itself what the gatekeeper contract denies it — by writing JSON.
 *
 * The unit tests prove today's behaviour. This proves the SHAPE that keeps it true as the code
 * changes: the record has a writer and no authority reader, the loop takes a write-only port, and
 * nothing new starts consulting the store to decide what may happen. The failure mode is a future
 * edit that reads perfectly reasonably — "resume from the checkpoint's approved state" — and quietly
 * inverts the model.
 *
 * It also pins that no SECOND orchestrator appeared beside `runLoop`, which is the other way
 * Programme B could go wrong.
 *
 * Reads files. Runs nothing, calls no provider, selects no project.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const AGENT_SRC = path.join(ROOT, "projectos", "agent", "src");

/** The module that owns the record. The only place its location may be named. */
const OWNER_REL = "projectos/agent/src/loop/workRecord.ts";
/** The one execution loop. */
const RUNNER_REL = "projectos/agent/src/loop/runner.ts";
/** The entrypoint that owns durability, as it already does for the ledger and decision evidence. */
const ENTRY_REL = "projectos/agent/src/commands/run.ts";

/**
 * Names that would turn a checkpoint into a permit.
 *
 * DELIBERATELY SPECIFIC TO THIS STORE. A previous validator in this repository banned a bare
 * `loadApproval` and failed `approvalStore.ts` — the OWNER approval store, a different and entirely
 * legitimate mechanism that has always read its own records back. A validator that fails correct code
 * teaches people to work around it, so the general rule below matches the record's PATH, which cannot
 * collide with another subsystem.
 */
const AUTHORITY_NAMES = Object.freeze([
  "workRecordAuthorises",
  "authoriseFromWorkRecord",
  "approveFromCheckpoint",
  "resumeAuthorityFromWork",
  "workRecordGrants",
]);

/** How the record's location is spelled. A second speller would be a second store. */
const STORE_LITERAL = ".projectops/work.v1.json";

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments, so a rule is never satisfied — or broken — by prose describing it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function agentSources(dir, out) {
  const acc = out || [];
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) agentSources(abs, acc);
    else if (ent.name.endsWith(".ts")) acc.push(abs);
  }
  return acc;
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  // 1. THE RECORD EXISTS AND IS IDENTITY-STABLE.
  const ownerRaw = read(OWNER_REL);
  if (ownerRaw === null) {
    E(`${OWNER_REL} is missing — it owns the durable work record`);
    return errors;
  }
  const owner = code(ownerRaw);

  for (const [re, what] of [
    [/export function beginWork\s*\(/, "beginWork"],
    [/export function advanceWork\s*\(/, "advanceWork"],
    [/export function readWorkRecord\s*\(/, "readWorkRecord"],
    [/export function writeWorkRecord\s*\(/, "writeWorkRecord"],
    [/export function resumeProblems\s*\(/, "resumeProblems"],
  ]) {
    if (!re.test(owner)) E(`${OWNER_REL} no longer exports ${what}`);
  }

  // A progression that could change project or phase would let one project's checkpoint become
  // another's — the single worst thing this record could do.
  if (!/Omit<\s*WorkRecord\s*,\s*'schemaVersion'\s*\|\s*'projectId'\s*\|\s*'phaseId'/.test(owner)) {
    E(
      `${OWNER_REL} no longer fixes projectId and phaseId against progression — a checkpoint that ` +
        "can be moved between projects or phases can continue the wrong work",
    );
  }

  // A resume must be able to refuse. Without the commit comparison, a moved repository resumes
  // silently as though its completed steps still described these bytes.
  if (!/subjectCommit !== expect\.subjectCommit/.test(owner)) {
    E(`${OWNER_REL} no longer compares the checkpoint's subject commit against the checkout`);
  }
  if (!/record\.projectId !== expect\.projectId/.test(owner)) {
    E(`${OWNER_REL} no longer refuses another project's checkpoint`);
  }

  // 2. NO AUTHORITY NAME, ANYWHERE IN THE AGENT.
  const sources = agentSources(AGENT_SRC);
  if (sources.length === 0) E("no agent sources were found — the rule would pass vacuously");
  for (const abs of sources) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const src = code(read(rel) || "");
    for (const name of AUTHORITY_NAMES) {
      if (src.includes(name)) {
        E(
          `${rel} declares or calls '${name}' — a work checkpoint must never be read back as ` +
            "authority; permission comes from a live decision checked in the transition that asked",
        );
      }
    }
    // 3. ONE STORE, ONE SPELLER. Nothing else addresses the record's location.
    if (rel !== OWNER_REL && src.includes(STORE_LITERAL)) {
      E(`${rel} names the work record's location directly — only ${OWNER_REL} may address it`);
    }
  }

  // 4. THE LOOP REPORTS, AND WHAT IT READS BACK CAN NEVER AUTHORISE.
  const runner = read(RUNNER_REL);
  if (runner === null) {
    E(`${RUNNER_REL} is missing — it is the one execution loop`);
  } else {
    const runnerCode = code(runner);
    if (!/onWorkState\?\s*:/.test(runnerCode)) {
      E(`${RUNNER_REL} no longer takes a write-only work-state port`);
    }
    // PINNED ON AUTHORITY, NOT ON READING — and this had to change, rather than being worked around.
    //
    // The absolute form ("never read the record") was the strict reading of a rule about AUTHORITY,
    // and PROJECTOS-OWNER-ESCALATION-WAIT1A found a defect it made unfixable. An owner receipt binds
    // to the subject at which OWNER_GATE was raised, and the commit that RECORDS the owner's answer
    // moves HEAD — so a fresh run compared the receipt against the new head, called it stale, and
    // threw it away. Every owner decision was refused by the act of recording it. Knowing WHICH
    // waiting instance is being resumed requires the record; the gatekeeper ruled that state and
    // context are permitted and authority is not, so that is the line drawn here.
    //
    // WHAT IS STILL FORBIDDEN, and now by name rather than by implication: the fields through which
    // a written record could stand in for a decision. `subjectCommit` only says which subject a
    // committed owner receipt is checked against — and whatever it names, the receipt must still be
    // committed there, decided by the plan's owner, bound to this project, phase and gate, unspent
    // and provably spendable. A forged record points at a passage that does not exist.
    if (/resumeProblems|workRecordPath/.test(runnerCode)) {
      E(
        `${RUNNER_REL} resolves or re-judges the work record itself — it may recover context from ` +
          "the record, never treat it as a resumable authority",
      );
    }
    for (const bearing of ['gateDecisionId', 'nextCandidateAction', 'GATE_APPROVED']) {
      if (runnerCode.includes(`record.${bearing}`) || runnerCode.includes(`.value?.${bearing}`)) {
        E(
          `${RUNNER_REL} reads '${bearing}' from the work record — a checkpoint may name which work ` +
            "this is, and must never name what may be done to it",
        );
      }
    }
    // And the one field it may take is taken as an identity question, guarded by the stop that
    // raised the wait. Without this guard the record could nominate any subject at all.
    if (/readWorkRecord/.test(runnerCode) && !/lastStopCode !== 'OWNER_GATE'/.test(runnerCode)) {
      E(
        `${RUNNER_REL} reads the work record without binding the read to the OWNER_GATE stop that ` +
          "raised the wait — an unguarded record could nominate any subject",
      );
    }
    // The loop still decides nothing about durability: the entrypoint writes.
    if (/writeWorkRecord/.test(runnerCode)) {
      E(`${RUNNER_REL} writes the work record directly — durability belongs to the entrypoint`);
    }
    // 5. THE CANONICAL LOOP AND PHASE SELECTION ARE STILL THE ONLY ONES.
    if (!/export function runLoop\s*\(/.test(runnerCode)) {
      E(`${RUNNER_REL} no longer exports runLoop — it is the one canonical execution loop`);
    }
    if (!/selectNextPhase\(/.test(runnerCode)) {
      E(`${RUNNER_REL} no longer uses selectNextPhase — phase selection must not be re-implemented`);
    }
  }

  // 6. THE ENTRYPOINT WRITES, AND THE WORK RECORD NEVER GATES EXECUTION THERE EITHER.
  const entry = read(ENTRY_REL);
  if (entry === null) {
    E(`${ENTRY_REL} is missing — it is the only place that may persist work state`);
  } else {
    const entryCode = code(entry);
    if (!/writeWorkRecord\(/.test(entryCode)) {
      E(`${ENTRY_REL} no longer persists work state`);
    }
    if (/if\s*\([^)]*work[^)]*\.state\s*===/.test(entryCode)) {
      E(
        `${ENTRY_REL} branches on a stored work state — a checkpoint must not decide whether the ` +
          "loop runs; that is authority",
      );
    }
  }

  // 7. NO FORGE GENERATION LOOP. Programme B must not absorb or extend it.
  for (const abs of sources) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if ((read(rel) || "").includes("generation-loop")) {
      E(`${rel} references the Forge generation loop — Forge stays outside the governed runtime`);
    }
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-work-record-not-authority1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-work-record-not-authority1a: PASS");
}

module.exports = { run, OWNER_REL, RUNNER_REL, ENTRY_REL, AUTHORITY_NAMES };
