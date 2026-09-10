"use strict";
/**
 * PERSISTED GATEKEEPER DECISIONS ARE EVIDENCE, NOT PERMITS —
 * PROJECTOS-EXECUTION-DECISION-PROVENANCE-FIX1A.
 *
 * ProjectOS now keeps what the gatekeeper decided: verdict, grounds, and what it permitted, bound to
 * the project, phase, subject commit and request digest the decision contract already enforces. That
 * record exists so a run can be audited and so an autonomous loop can say what it acted on.
 *
 * IT IS ALSO THE MOST DANGEROUS FILE IN THE REPOSITORY TO GET WRONG. The implementer can write to the
 * governed checkout. If any execution path ever derives permission from this store — reads it back,
 * resumes from it, treats its presence as approval — then Claude can grant itself exactly the
 * authority `checkGatekeeperDecision` was built to deny, by writing a JSON file. Authority must keep
 * coming from a live answer checked inside the transition that asked the question.
 *
 * The unit tests prove today's behaviour. This proves the SHAPE that keeps it true: that the store
 * has a writer and no reader, and that no new module starts consulting it. The failure mode is a
 * future edit that looks helpful — "resume the approval after a restart" — and quietly inverts the
 * model.
 *
 * Reads files. Runs nothing, calls no provider, touches no credential.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const AGENT_SRC = path.join(ROOT, "projectos", "agent", "src");

/** The module that owns the store. The only place a writer may live. */
const OWNER_REL = "projectos/agent/src/loop/gatekeeperConfig.ts";

/**
 * Names that would turn THIS store's evidence into authority. Absent everywhere, owner module
 * included.
 *
 * DELIBERATELY NARROW, AND THE FIRST DRAFT WAS NOT. It also banned bare `loadApproval` and
 * `readPersistedDecision`, which flagged `approvalStore.ts`, `commands/approve.ts` and `mcp/bridge.ts`
 * — the OWNER approval store, a different and entirely legitimate mechanism that has always read its
 * own records back. A validator that fails correct pre-existing code teaches people to work around
 * it. The general rule is carried by the store-location check below instead, which cannot collide
 * with another subsystem because it matches the path, not a word.
 */
const AUTHORITY_READER_NAMES = Object.freeze([
  "readGatekeeperDecisionAsAuthority",
  "resumeGatekeeperApproval",
  "authoriseFromPersistedDecision",
  "readGatekeeperDecisionEvidence",
  "gatekeeperDecisionEvidenceGrants",
  "approvalFromDecisionEvidence",
]);

/** The store's location, as the writer spells it. A second speller would be a second store. */
const STORE_LITERAL = ".projectops/gatekeeper-decisions";

function read(abs) {
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments, so a rule is never satisfied — or broken — by prose describing it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Every .ts file under the agent source tree. */
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

  const ownerAbs = path.join(ROOT, ...OWNER_REL.split("/"));
  const ownerRaw = read(ownerAbs);
  if (ownerRaw === null) {
    E(`${OWNER_REL} is missing — it owns the decision evidence store`);
    return errors;
  }
  const owner = code(ownerRaw);

  // 1. THE WRITER EXISTS AND IS WRITE-ONLY.
  if (!/export function recordGatekeeperDecisionEvidence\s*\(/.test(owner)) {
    E("the decision evidence writer is gone — an accepted decision would stop being recorded");
  }
  // Create-new is what stops a second, different answer replacing the one the runtime acted on.
  if (!/createExclusive\s*\(/.test(owner)) {
    E(
      "the writer no longer uses createExclusive — contradictory decision evidence could silently " +
        "overwrite the record of the decision that actually drove the run",
    );
  }

  // 2. NO AUTHORITY READER, ANYWHERE IN THE AGENT.
  const sources = agentSources(AGENT_SRC);
  if (sources.length === 0) {
    E("no agent sources were found to check — the rule would pass vacuously");
  }
  for (const abs of sources) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const src = code(read(abs) || "");

    for (const name of AUTHORITY_READER_NAMES) {
      if (src.includes(name)) {
        E(
          `${rel} declares or calls '${name}' — a persisted decision must never be read back as ` +
            "authority; permission comes from a live answer checked in the transition that asked",
        );
      }
    }

    // 3. NOBODY ELSE ADDRESSES THE STORE. One writer, one location, no second speller — and in
    //    particular no execution path opening the directory for itself.
    if (rel !== OWNER_REL && src.includes(STORE_LITERAL)) {
      E(
        `${rel} names the decision evidence store directly — only ${OWNER_REL} may address it, so a ` +
          "reader cannot appear beside the writer",
      );
    }
  }

  // 4. THE TURN HOLDS A WRITE PORT AND NO READER. It is where a verdict is applied, so it is where a
  //    reader would do the most damage.
  const turnRel = "projectos/agent/src/loop/gatekeeperTurn.ts";
  const turn = read(path.join(ROOT, ...turnRel.split("/")));
  if (turn === null) {
    E(`${turnRel} is missing — it is the transition that applies a verdict`);
  } else {
    const turnCode = code(turn);
    if (!/recordDecisionEvidence\?\s*:/.test(turnCode)) {
      E(`${turnRel} no longer takes a write-only evidence port`);
    }
    if (/gatekeeperDecisionEvidenceRelPath|GATEKEEPER_DECISIONS_REL/.test(turnCode)) {
      E(`${turnRel} reaches for the evidence store's location — the turn writes through a port and reads nothing`);
    }
    // 5. RECORDED ONLY AFTER THE CHECK. Persisting a refused or malformed answer would leave a record
    //    that looks exactly like an accepted one.
    if (!/problems\.length === 0[\s\S]{0,200}?recordDecisionEvidence/.test(turnCode)) {
      E(
        `${turnRel} no longer records evidence strictly after the decision checker accepted the ` +
          "record — a refused decision must leave no accepted-decision record behind",
      );
    }

    // 6. AND RECORDED BEFORE THE VERDICT IS APPLIED, WITH A FAIL-CLOSED BRANCH.
    //
    //    This is the rule the phase was amended for. Recording was best-effort at first: the verdict
    //    applied whether or not the write landed, so ProjectOS could act on a decision it could not
    //    afterwards account for — the untraceable step the whole provenance contract exists to
    //    prevent. Durable provenance is a PRECONDITION of acting.
    //
    //    Checked positionally rather than by wording, because a comment claiming the order proves
    //    nothing: the recording call must physically precede `applyVerdictToStop`.
    //    `lastIndexOf` for the apply, deliberately: an EARLIER `applyVerdictToStop(` exists on the
    //    "not asked" early-return path, which never reaches a decision at all. Comparing against the
    //    first occurrence compared the recording to the wrong call and failed correct code — this
    //    validator caught that in itself before it could be pinned as the rule.
    const recordAt = turnCode.indexOf("recordDecisionEvidence(");
    const applyAt = turnCode.lastIndexOf("applyVerdictToStop(");
    if (recordAt === -1 || applyAt === -1 || recordAt > applyAt) {
      E(
        `${turnRel} applies the verdict before recording the decision — durable provenance is a ` +
          "precondition of acting, not a courtesy afterwards",
      );
    }
    if (!/recorded !== 'written'[\s\S]{0,400}?return \{[\s\S]{0,200}?ownerAction/.test(turnCode)) {
      E(
        `${turnRel} no longer stops the turn when the decision could not be recorded — a failed or ` +
          "contradicted write must refuse the action, never continue past it",
      );
    }
  }

  // 7. THE SECOND ACCEPTED-DECISION PATH CARRIES THE SAME RULE.
  //
  //    Reconciliation also accepts a checked gatekeeper decision. Covering only the governance turn
  //    would leave half of ProjectOS's accepted decisions able to act without provenance.
  const reconRel = "projectos/agent/src/loop/reconciliation.ts";
  const recon = read(path.join(ROOT, ...reconRel.split("/")));
  if (recon === null) {
    E(`${reconRel} is missing — it is the other path that accepts a gatekeeper decision`);
  } else {
    const reconCode = code(recon);
    const keptAt = reconCode.indexOf("recordDecisionEvidence?.(");
    const verdictAt = reconCode.indexOf("RECONCILIATION_ACCEPTED_VERDICT)");
    if (keptAt === -1) {
      E(`${reconRel} no longer records the accepted decision at all`);
    } else if (verdictAt !== -1 && keptAt > verdictAt) {
      E(`${reconRel} reads the verdict before recording the decision`);
    }
    if (!/kept !== 'written'[\s\S]{0,400}?PERSIST_FAILED/.test(reconCode)) {
      E(
        `${reconRel} no longer refuses when the decision could not be recorded — a debt must not be ` +
          "discharged on a decision ProjectOS cannot account for",
      );
    }
  }

  // 8. THE THIRD ACCEPTED-DECISION PATH — THE INTERACTIVE GATEKEEPER (hybrid routing).
  //
  //    Same rule, same reason: a decision the owner relayed from the ChatGPT gatekeeper is recorded
  //    only after the checks accepted it, recorded AND spent before its verdict is applied, and a
  //    failed record refuses the action.
  const interRel = "projectos/agent/src/loop/interactiveGatekeeper.ts";
  const inter = read(path.join(ROOT, ...interRel.split("/")));
  if (inter === null) {
    E(`${interRel} is missing — it is the path that accepts an interactive gatekeeper decision`);
  } else {
    const interCode = code(inter);
    if (/gatekeeperDecisionEvidenceRelPath|GATEKEEPER_DECISIONS_REL/.test(interCode)) {
      E(`${interRel} reaches for the evidence store's location — it writes through a port and reads nothing`);
    }
    if (!/problems\.length === 0[\s\S]{0,200}?recordDecisionEvidence/.test(interCode)) {
      E(`${interRel} no longer records evidence strictly after the decision checker accepted the record`);
    }
    const recordAt = interCode.indexOf("recordDecisionEvidence(");
    const spendAt = interCode.indexOf("consumeDecision(");
    const applyAt = interCode.lastIndexOf("applyVerdictToStop(");
    if (recordAt === -1 || spendAt === -1 || applyAt === -1 || recordAt > applyAt || spendAt > applyAt) {
      E(`${interRel} applies the verdict before recording and spending the decision — both are preconditions of acting`);
    }
    if (!/recorded !== 'written'[\s\S]{0,400}?return result\(/.test(interCode)) {
      E(`${interRel} no longer stops the turn when the decision could not be recorded`);
    }
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-gate-decision-evidence1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-gate-decision-evidence1a: PASS");
}

module.exports = { run, OWNER_REL, AUTHORITY_READER_NAMES };
