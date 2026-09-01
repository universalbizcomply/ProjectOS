"use strict";
/**
 * A TECHNICAL CONTINUATION NEEDS FOUR AUTHORITIES, AND CANNOT RUN A COMMAND —
 * PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 *
 * This is the first machinery in ProjectOS that performs a git operation because a model said so. The
 * unit tests prove today's behaviour; this pins the SHAPE that keeps it safe as the code changes,
 * because every failure mode here reads perfectly reasonably in a diff:
 *
 *   - "just pass the action through, the caller already checked" — and the conjunction is gone
 *   - "resume from the checkpoint's approved action" — and a writable file becomes permission
 *   - "let the decision name the branch" — and a model chooses the refspec
 *   - "add a generic run-command action, it will be useful" — and there is a shell
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not scan the agent for the words `commit` or `push`: git
 * utilities, refusal prose and commit-message helpers all legitimately contain them, and a validator
 * that fails correct code teaches people to work around it. Every rule below names one file and one
 * construct.
 *
 * Reads files. Runs nothing, calls no provider, mutates nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

/** The pure decision. The only place a continuation is authorised. */
const CONTRACT_REL = "projectos/core/src/technicalContinuation.ts";
/** The executor. The only place a git operation is performed on a gatekeeper's say-so. */
const EXECUTOR_REL = "projectos/agent/src/loop/technicalContinuation.ts";
/** Naming the exact bytes. Without it the decision is about a base commit and nothing else. */
const CANDIDATE_REL = "projectos/agent/src/loop/candidateIdentity.ts";
/** Where the delegable vocabulary lives. */
const SCOPES_REL = "projectos/core/src/closureAuthority.ts";
/** The committed record that grants the capability. */
const DELEGATION_REL = ".projectops/authority/closure-delegation.json";
/** The proofs. A pinned shape whose behaviour nobody runs is a shape, not a protection. */
const TESTS = [
  "projectos/agent/test/technicalContinuation.test.ts",
  "projectos/agent/test/candidateIdentity.test.ts",
  // The governed chain through the canonical loop, against a real repository. Without it the pieces
  // above are proven and their REACHABILITY is not — which is the state this phase found.
  "projectos/agent/test/continuationEndToEnd.test.ts",
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments, so a rule is never satisfied — or broken — by prose describing it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function sources(dir, out) {
  const acc = out || [];
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) sources(abs, acc);
    else if (ent.name.endsWith(".ts")) acc.push(abs);
  }
  return acc;
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const contractRaw = read(CONTRACT_REL);
  const executorRaw = read(EXECUTOR_REL);
  if (contractRaw === null || executorRaw === null) {
    E(`${CONTRACT_REL} or ${EXECUTOR_REL} is missing — the continuation contract is not present`);
    return errors;
  }
  const contract = code(contractRaw);
  const executor = code(executorRaw);

  // 1. THE CONJUNCTION. Each limb is a different authority, and losing any one of them silently is
  //    the failure this validator exists for.
  for (const [re, what] of [
    [/decisionProblems\.length > 0/, "the decision must have passed checkGatekeeperDecision"],
    [/delegationProblems\.length > 0/, "the delegation must be valid"],
    [/carriesTechnicalScope !== true/, "the delegation must carry the technical scope"],
    [/!isTechnicalAction\(action\)/, "the action must be one ProjectOS can perform"],
    [/allowed\.includes\(String\(action\)\)/, "the action must be in the decision's allowedActions"],
    [/ownerOnlyActions\.map\(String\)\.includes\(String\(action\)\)/, "an owner-only action must be refused"],
    [/decision\.reviewedCandidateDigest !== context\.currentCandidate\.digest/, "the candidate must still be the reviewed one"],
    [/decision\.subjectCommit !== context\.currentHead/, "HEAD must still be the reviewed base"],
    [/decision\.projectId !== context\.projectId/, "the decision must be for this project"],
    [/decision\.phaseId !== context\.phaseId/, "the decision must be for this phase"],
    [/context\.currentBranch !== context\.expectedBranch/, "the branch must be the expected one"],
  ]) {
    if (!re.test(contract)) E(`${CONTRACT_REL} no longer refuses on: ${what}`);
  }

  // A CALLER THAT DOES NOT SAY WHETHER IT CHECKED HAS NOT CHECKED. A non-array `problems` must read as
  // a failure, or forgetting to check looks like passing.
  if (!/Array\.isArray\(decision\?\.problems\)/.test(contract) || !/Array\.isArray\(delegation\?\.problems\)/.test(contract)) {
    E(`${CONTRACT_REL} no longer treats a missing check result as a failure`);
  }

  // 2. THE GRANT IS A CAPABILITY TOKEN. Without the private brand the split between deciding and
  //    performing is a naming convention, and the executor is one hand-written object from running.
  if (!/declare const AUTHORISED: unique symbol/.test(contract)) {
    E(`${CONTRACT_REL} no longer brands AuthorisedContinuation with a module-private symbol — a caller could construct one`);
  }
  if (!/grant: \{ action: action as TechnicalAction \} as AuthorisedContinuation/.test(contract)) {
    E(`${CONTRACT_REL} no longer mints the grant at the single point past every refusal`);
  }

  // 3. THE VOCABULARY IS CLOSED, AND SHORT. Growth here is a governance act, not a convenience.
  const vocab = /export const TECHNICAL_ACTIONS = \[([\s\S]*?)\] as const;/.exec(contract);
  if (vocab === null) {
    E(`${CONTRACT_REL} no longer declares TECHNICAL_ACTIONS as a closed const array`);
  } else {
    const names = [...vocab[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const required of ["commit", "push", "ff-only-integration"]) {
      if (!names.includes(required)) E(`TECHNICAL_ACTIONS no longer contains '${required}'`);
    }
    for (const name of names) {
      if (!["commit", "push", "ff-only-integration"].includes(name)) {
        E(
          `TECHNICAL_ACTIONS gained '${name}'. Ordinary source-control continuation is the whole ` +
            "boundary; a new member is an owner decision with its own review, not a code change",
        );
      }
    }
  }

  // 4. NO ARBITRARY EXECUTION, ANYWHERE IN THE EXECUTOR. Not guarded against — absent.
  for (const forbidden of ["'--force'", "'--force-with-lease'", "'--amend'", "'--tags'", "'--delete'", "'--hard'", "'rebase'", "'tag'"]) {
    if (executor.includes(forbidden)) {
      E(`${EXECUTOR_REL} names ${forbidden} — the executor performs ordinary continuation only`);
    }
  }
  for (const shell of ["child_process", "execSync", "spawnSync", "shell: true", "powershell", "cmd.exe"]) {
    if (executor.toLowerCase().includes(shell.toLowerCase())) {
      E(`${EXECUTOR_REL} reaches for '${shell}' — every process this module starts goes through the governed sys.exec`);
    }
  }
  // A FIELD THROUGH WHICH A COMMAND COULD ARRIVE IS THE SAME PROBLEM ONE STEP EARLIER.
  for (const field of ["args", "argv", "flags", "command", "script", "refspec"]) {
    if (new RegExp(`readonly ${field}\\??:`).test(executor)) {
      E(`${EXECUTOR_REL} accepts a '${field}' field — operational parameters come from governed context, never from a caller`);
    }
  }

  // 5. THE PRODUCTION PATH DERIVES THE OWNER-ONLY FLOOR ITSELF, so no caller can narrow it. This is
  //    also what keeps `commit` and `push` unreachable until an owner-attended change says otherwise.
  if (!/const ownerOnlyActions = enforcedOwnerOnlyActions\(\s*request\.phaseOwnerGates,\s*technicalDelegationCondition\(request\.delegation\),?\s*\)/.test(executor)) {
    E(
      `${EXECUTOR_REL} no longer derives the enforced owner-only set from the constitutional floor and ` +
        "this request's own delegation",
    );
  }
  // THE CONDITION IS MINTED FROM THE REQUEST'S DELEGATION, never accepted as an argument. A field for
  // it would let a caller relax the floor without a delegation having been resolved at all.
  if (/readonly technicalDelegation\??:/.test(executor)) {
    E(
      `${EXECUTOR_REL} accepts a technicalDelegation condition as a field — it must be minted from the ` +
        "delegation this request carries, so an unproven delegation is exactly as restrictive as none",
    );
  }

  // 6. THE EXECUTOR IS REACHED FROM ONE PLACE IN PRODUCTION. The split exists so the commit and push
  //    machinery can be exercised at all; it must not become a second entry point.
  const callers = [];
  for (const abs of sources(path.join(ROOT, "projectos", "agent", "src"))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (rel === EXECUTOR_REL) continue;
    if (code(read(rel) || "").includes("executeAuthorisedContinuation")) callers.push(rel);
  }
  if (callers.length > 0) {
    E(
      `executeAuthorisedContinuation is called from ${callers.join(", ")} — in production it is reached ` +
        `only from runTechnicalContinuation, which derives the owner-only floor first`,
    );
  }

  // 7. THE CANDIDATE IS NAMED, AND NAMED COMPLETELY.
  const candidate = code(read(CANDIDATE_REL) || "");
  if (candidate === "") {
    E(`${CANDIDATE_REL} is missing — without it a decision is bound to a base commit and nothing else`);
  } else {
    // `-uall`, or a wholly-untracked directory collapses to one unhashable entry and every file
    // beneath it is invisible to the identity. Found by test, not by reading.
    if (!/'--untracked-files=all'/.test(candidate)) {
      E(`${CANDIDATE_REL} no longer lists untracked files individually — an untracked directory would hide its contents from the candidate`);
    }
    // No `-w`: naming the candidate must not write objects into the repository being judged.
    if (/hash-object[^\]]*'-w'/.test(candidate)) {
      E(`${CANDIDATE_REL} writes objects while naming the candidate — naming must not mutate the repository`);
    }
    if (!/state === 'present' && e\.blob === null/.test(candidate)) {
      E(`${CANDIDATE_REL} no longer refuses a present path with no content digest — it would encode identically to a deleted one`);
    }
  }

  // 8. THE CANDIDATE REACHES THE REVIEWER. The binding is transitive through the evidence; if the
  //    identity is not IN the evidence, nothing downstream is bound to it however carefully it is compared.
  const runner = code(read("projectos/agent/src/loop/runner.ts") || "");
  if (!/candidate: candidateEvidence\(\)/.test(runner) || !/computeCandidateIdentity\(sys, root\)/.test(runner)) {
    E(
      "projectos/agent/src/loop/runner.ts no longer puts the candidate identity into the gatekeeper's " +
        "evidence — the decision would once again be about a base commit and nothing else",
    );
  }

  // 9. NO HISTORICAL RECORD BECOMES PERMISSION. The contract must have no route to either store.
  for (const name of ["work.v1.json", "gatekeeper-decisions", "readWorkRecord", "readCommittedDecision"]) {
    if (contract.includes(name)) {
      E(`${CONTRACT_REL} references '${name}' — authority comes from a live checked decision, never from a stored record`);
    }
  }
  if (/generation-loop/.test(contract) || /generation-loop/.test(executor)) {
    E("the technical continuation references the Forge generation loop — Forge stays outside the governed runtime");
  }

  // 10. THE DELEGATION IS RECORDED, SCOPED, AND EXCLUDES PROTECTED ACTIONS.
  const scopes = code(read(SCOPES_REL) || "");
  if (!/export const TECHNICAL_CONTINUATION_SCOPE = 'technical-continuation'/.test(scopes)) {
    E(`${SCOPES_REL} no longer declares the technical-continuation scope`);
  }
  const delegationRaw = read(DELEGATION_REL);
  if (delegationRaw === null) {
    E(`${DELEGATION_REL} is missing — nothing grants the capability`);
  } else {
    let record = null;
    try {
      record = JSON.parse(delegationRaw);
    } catch {
      E(`${DELEGATION_REL} is not valid JSON, so it delegates nothing`);
    }
    if (record !== null) {
      const scope = Array.isArray(record.delegatedScope) ? record.delegatedScope.map(String) : [];
      if (!scope.includes("technical-continuation")) {
        E(`${DELEGATION_REL} does not carry 'technical-continuation'`);
      }
      // THE EXISTING SCOPES MUST SURVIVE. An amendment that added one capability by dropping another
      // would be a silent revocation.
      for (const kept of ["phase-closure", "programme-closure", "gatekeeper-review-decisions"]) {
        if (!scope.includes(kept)) E(`${DELEGATION_REL} lost the '${kept}' scope — an amendment must not revoke by omission`);
      }
      if (record.excludesProtectedActions !== true) {
        E(`${DELEGATION_REL} no longer states excludesProtectedActions: true`);
      }
      if (typeof record.projectId !== "string" || record.projectId.trim() === "") {
        E(`${DELEGATION_REL} names no projectId, so the delegation is not bound to a project`);
      }
      if (typeof record.programmeScope !== "string" || record.programmeScope.trim() === "") {
        E(`${DELEGATION_REL} names no programmeScope, so the delegation is not bound to a programme`);
      }
    }
  }

  // 11. THE SCOPE HAS A READER. A capability written into a governance record that nothing consults
  //     is worse than no capability: it reads, to anyone auditing the file, as an authority in force.
  const config = code(read("projectos/agent/src/loop/gatekeeperConfig.ts") || "");
  if (!/export function resolveTechnicalDelegation\(/.test(config)) {
    E(
      "projectos/agent/src/loop/gatekeeperConfig.ts no longer resolves the technical delegation — the " +
        "scope would be recorded and never consulted",
    );
  }
  if (!/resolveDelegatedDecider\(sys, root, programmeId, TECHNICAL_CONTINUATION_SCOPE\)/.test(config)) {
    E(
      "the technical delegation is no longer judged against TECHNICAL_CONTINUATION_SCOPE — a delegation " +
        "granting only review or closure would resolve as granting a continuation",
    );
  }

  // 12. THE SUCCESS STOP EXISTS, IS THE REVIEWER'S, AND IS THE ONLY WAY IN.
  //
  //     Every other stop the loop can reach is a failure. Without this one a finished run ends having
  //     asked nobody anything, and the executor above is unreachable by any real run — which is
  //     exactly the state this phase found the loop in.
  const outcome = code(read("projectos/agent/src/loop/outcome.ts") || "");
  const routing = code(read("projectos/agent/src/loop/gatekeeperRouting.ts") || "");
  const turn = code(read("projectos/agent/src/loop/gatekeeperTurn.ts") || "");
  const loopRunner = code(read("projectos/agent/src/loop/runner.ts") || "");

  if (!/\|\s*'CONTINUATION_READY'/.test(outcome)) {
    E("projectos/agent/src/loop/outcome.ts no longer declares the CONTINUATION_READY stop code");
  }
  if (!/code:\s*'CONTINUATION_READY'/.test(outcome)) {
    E("projectos/agent/src/loop/outcome.ts no longer raises CONTINUATION_READY for completed work");
  }
  // A DECLARED PROTECTION IS NOT A PENDING ACTION. Reverting to a gate COUNT would send every phase
  // that declares a standing protection to the owner forever, and say something false while doing it.
  if (!/const pendingOwnerActions = gates\.filter\(\(g\) => \(TECHNICAL_ACTIONS as readonly string\[\]\)\.includes\(g\)\)/.test(outcome)) {
    E(
      "projectos/agent/src/loop/outcome.ts no longer distinguishes a pending owner ACTION from a " +
        "declared protection — a gate count would stop completed work for protections nobody proposed to exercise",
    );
  }
  const route = /CONTINUATION_READY:\s*\{([\s\S]*?)\},/.exec(routing);
  if (route === null) {
    E("projectos/agent/src/loop/gatekeeperRouting.ts does not route CONTINUATION_READY");
  } else {
    if (!/audience:\s*'gatekeeper'/.test(route[1])) {
      E("CONTINUATION_READY is no longer routed to the gatekeeper — a success stop sent to the owner asks nobody anything");
    }
    for (const verdict of ["APPROVED_TO_PROCEED", "AMENDMENT_REQUIRED", "DO_NOT_PROCEED", "AWAITING_OWNER"]) {
      if (!route[1].includes(verdict)) E(`CONTINUATION_READY no longer accepts ${verdict}`);
    }
    // The owner-gated verdicts must stay out of it: technical authority travels in allowedActions.
    for (const owned of ["APPROVED_TO_COMMIT", "APPROVED_TO_PUSH", "APPROVED_FOR_CLOSURE"]) {
      if (route[1].includes(owned)) {
        E(`CONTINUATION_READY accepts ${owned} — an owner-gated verdict must never answer a stop`);
      }
    }
  }
  // OWNER_GATE WAS NOT REPURPOSED. It still carries genuinely owner-required work to the owner.
  const ownerGate = /OWNER_GATE:\s*\{([\s\S]*?)\},/.exec(routing);
  if (ownerGate === null || !/audience:\s*'owner'/.test(ownerGate[1]) || !/applicableVerdicts:\s*\[\]/.test(ownerGate[1])) {
    E("OWNER_GATE is no longer owner-routed with no answerable verdict — it must not become a review question");
  }
  if (!/CONTINUATION_READY:\s*'evidence-review'/.test(turn)) {
    E("projectos/agent/src/loop/gatekeeperTurn.ts no longer asks the existing evidence-review question for CONTINUATION_READY");
  }

  // 13. THE RUNNER REACHES THE EXECUTOR ONLY FROM AN APPROVED SUCCESS STOP.
  if (!/answered === 'proceed' && decision\.reason\.code === 'CONTINUATION_READY'/.test(loopRunner)) {
    E(
      "projectos/agent/src/loop/runner.ts no longer gates the technical continuation on an approved " +
        "CONTINUATION_READY — any other condition would let a different stop reach the executor",
    );
  }
  if (!/acceptedDecision = turn\.checkedDecision/.test(loopRunner)) {
    E("projectos/agent/src/loop/runner.ts no longer captures the CHECKED decision from the turn");
  }
  // The candidate the reviewer was shown, not whatever the tree holds later.
  if (!/reviewedCandidateDigest: reviewedCandidate\.digest/.test(loopRunner)) {
    E("projectos/agent/src/loop/runner.ts no longer binds the continuation to the candidate the reviewer saw");
  }

  // 14. THE BEHAVIOUR IS PROVEN, NOT ONLY SHAPED.
  for (const rel of TESTS) {
    if (read(rel) === null) E(`${rel} is missing — the continuation's behaviour is no longer proven`);
  }
  const proof = read(TESTS[0]) || "";
  if (!/refusesUnderCurrentPlan/.test(proof)) {
    E(
      `${TESTS[0]} no longer proves that commit and push are refused under the plan as it stands — ` +
        "the moment that stops being true it must be a deliberate, visible change",
    );
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-technical-continuation1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-technical-continuation1a: PASS");
}

module.exports = { run, CONTRACT_REL, EXECUTOR_REL, CANDIDATE_REL, SCOPES_REL, DELEGATION_REL, TESTS };
