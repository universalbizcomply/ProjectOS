"use strict";
/**
 * THE CONSTITUTIONAL OWNER-ONLY FLOOR REACHES THE LIVE GATE —
 * PROJECTOS-LIVE-GATE-OWNER-FLOOR-HARDENING1A.
 *
 * `ALWAYS_OWNER_ONLY` is the set of actions whose whole purpose is that a human decided. It was
 * written as "a floor, not the list": enforced regardless of what a phase remembered to declare.
 *
 * It was applied in degraded mode and in `reconcile`, and NOWHERE ELSE. The live gatekeeper turn —
 * the one transition that takes a real reviewer's answer and applies it — was handed
 * `brief.phase.requiredOwnerGates` verbatim, so the approved plan was the only thing standing between
 * a model's decision and a protected action. A phase that omitted `push` from its gates made `push`
 * grantable, and the floor was untouched the entire time. A protection that exists but does not cover
 * the live path is not a protection, and "the constant is still there" is not evidence that it is.
 *
 * The unit tests in `test/liveGateOwnerFloor.test.ts` prove today's behaviour. This pins the SHAPE
 * that keeps it true: the floor still has content, the turn still derives from it, and — the rule
 * that actually matters — the turn never again passes the caller's narrower list straight through.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not scan for the words `commit` or `push` across the
 * agent: git utilities, commit-message helpers and refusal prose all legitimately contain them, and a
 * validator that fails correct code teaches people to work around it. Every rule below names one file
 * and one specific construct.
 *
 * Reads files. Runs nothing, calls no provider, mutates nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * The module that owns the floor. The only place it may be declared.
 *
 * IT LIVES IN CORE FOR A REASON THIS VALIDATOR EXISTS TO KEEP. It was first written in the agent's
 * degraded-mode module, beside the disk and git code that reads a risk-acceptance grant — and there
 * it could only protect paths that imported that module. `gatekeeperTurn.ts` has a deliberately
 * narrow permitted-dependency list (`val-projectos-gatekeeper-contract1a`) which that module is not
 * on, and correctly refused the import. Moving the constant to core reached the live gate without
 * widening the boundary; the agent module re-exports it so no caller had to change.
 */
const FLOOR_REL = "projectos/core/src/ownerOnlyActions.ts";
/** The agent module that re-exports it, so every pre-existing caller keeps its spelling. */
const FLOOR_REEXPORT_REL = "projectos/agent/src/loop/degradedMode.ts";
/** The live gatekeeper transition this phase hardened. */
const TURN_REL = "projectos/agent/src/loop/gatekeeperTurn.ts";
/** The pure checker the turn's verdict is judged by. */
const CHECKER_REL = "projectos/core/src/gatekeeperDecision.ts";
/** The proof that the union is enforced rather than merely written. */
const TEST_REL = "projectos/agent/test/liveGateOwnerFloor.test.ts";
/** The proof of the conditional split: what yields, what never does, and that the plan still wins. */
const CONDITIONAL_TEST_REL = "projectos/agent/test/conditionalTechnicalFloor.test.ts";

/**
 * The actions the floor must keep carrying.
 *
 * Pinned by NAME rather than by count, so that adding a sixth protected action is allowed and
 * quietly dropping one is not. These five are the ones whose absence would be invisible: each is
 * also declared by the active plan today, so a regression would still pass every live run until the
 * day a plan stopped declaring it.
 */
const FLOOR_MEMBERS = Object.freeze([
  "commit",
  "push",
  "phase-closure",
  "secrets-handling",
  "payment-or-live-charge",
]);

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/**
 * Strip comments, so a rule is never satisfied — or broken — by prose describing it.
 *
 * This module's own subject explains itself at length in comments, including quoting the exact
 * expression the regression rule forbids. Without this the rule would fail on its own documentation.
 */
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

  // 1. THE FLOOR STILL EXISTS, AND STILL HAS CONTENT.
  const floorRaw = read(FLOOR_REL);
  if (floorRaw === null) {
    E(`${FLOOR_REL} is missing — it owns the constitutional owner-only floor`);
    return errors;
  }
  const floor = code(floorRaw);

  const decl = /export const ALWAYS_OWNER_ONLY\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(floor);
  if (decl === null) {
    E(`${FLOOR_REL} no longer declares ALWAYS_OWNER_ONLY as a const array — the floor is the thing a phase cannot narrow`);
  } else {
    for (const member of FLOOR_MEMBERS) {
      if (!new RegExp(`['"]${member}['"]`).test(decl[1])) {
        E(
          `ALWAYS_OWNER_ONLY no longer contains '${member}' — removing a protected action from the ` +
            "floor makes it grantable by a gatekeeper decision the moment a plan stops declaring it",
        );
      }
    }
  }

  // The union itself. A floor that REPLACED the phase's declaration would silently drop
  // phase-specific gates; one that ignored the floor is the defect this phase closed.
  if (!/export function enforcedOwnerOnlyActions\s*\(/.test(floor)) {
    E(`${FLOOR_REL} no longer exports enforcedOwnerOnlyActions — the union has no canonical spelling`);
  }
  // THE UNION, IN ITS CONDITIONAL FORM. `ABSOLUTE_OWNER_ONLY` and `declared` are added
  // UNCONDITIONALLY; only the conditionally-delegable pair depends on the condition. Pinning the
  // expression rather than the outcome is what makes a future edit that moved `ABSOLUTE_OWNER_ONLY`
  // behind the condition — the one change that would actually matter — fail here.
  if (!/\[\s*\.\.\.new Set\(\[\s*\.\.\.ABSOLUTE_OWNER_ONLY\s*,\s*\.\.\.conditional\s*,\s*\.\.\.declared\s*\]\)\s*\]/.test(floor)) {
    E(
      `${FLOOR_REL} no longer computes enforcedOwnerOnlyActions as the deduplicated union of the ` +
        "absolute floor, the conditional pair and the declared gates — neither source may replace another",
    );
  }
  // THE RELAXATION IS OPT-IN AND LIMITED. An absent condition must restore the whole floor, and a
  // present one must subtract nothing but `CONDITIONALLY_DELEGABLE_TECHNICAL`.
  if (!/const conditional = condition === undefined \|\| condition === null \? CONDITIONALLY_DELEGABLE_TECHNICAL : \[\]/.test(floor)) {
    E(
      `${FLOOR_REL} no longer makes the relaxation opt-in and limited to CONDITIONALLY_DELEGABLE_TECHNICAL`,
    );
  }
  // THE TWO LISTS, AND THE FACT THAT NOTHING CAN SUBTRACT FROM THE ABSOLUTE ONE.
  const absolute = /export const ABSOLUTE_OWNER_ONLY\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(floor);
  const conditional = /export const CONDITIONALLY_DELEGABLE_TECHNICAL\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(floor);
  if (absolute === null || conditional === null) {
    E(`${FLOOR_REL} no longer declares both ABSOLUTE_OWNER_ONLY and CONDITIONALLY_DELEGABLE_TECHNICAL as const arrays`);
  } else {
    const names = (m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const abs = names(absolute);
    const cond = names(conditional);
    // ONLY THE OWNER'S TWO. A third member here would extend a governance decision by code change.
    if (cond.sort().join(",") !== "commit,push") {
      E(
        `CONDITIONALLY_DELEGABLE_TECHNICAL is [${cond.join(", ")}] — the owner's decision names commit and ` +
          "push, and extending it is a governance act with its own approval, not a code change",
      );
    }
    for (const protectedAction of ["phase-closure", "secrets-handling", "payment-or-live-charge"]) {
      if (!abs.includes(protectedAction)) {
        E(`ABSOLUTE_OWNER_ONLY no longer contains '${protectedAction}' — it would become reachable through a delegation`);
      }
      if (cond.includes(protectedAction)) {
        E(`'${protectedAction}' was moved into the conditionally delegable list — it must never yield to a delegation`);
      }
    }
    // The two lists must still account for the whole default floor, or the union above silently shrinks.
    for (const member of FLOOR_MEMBERS) {
      if (!abs.includes(member) && !cond.includes(member)) {
        E(`'${member}' is in ALWAYS_OWNER_ONLY but in neither the absolute nor the conditional list`);
      }
    }
  }
  // THE CONDITION IS A BRANDED TOKEN, NOT A BOOLEAN. Without the private symbol a caller could relax
  // the floor by writing an object literal.
  if (!/declare const DELEGATED: unique symbol/.test(floor)) {
    E(`${FLOOR_REL} no longer brands TechnicalDelegationCondition with a module-private symbol`);
  }
  if (!/carriesTechnicalScope !== true/.test(floor) || !/Array\.isArray\(delegation\?\.problems\)/.test(floor)) {
    E(`${FLOOR_REL} no longer refuses to mint a condition from an unproven delegation`);
  }

  // 2. THE LIVE TURN DERIVES THE SET RATHER THAN RECEIVING IT.
  const turnRaw = read(TURN_REL);
  if (turnRaw === null) {
    E(`${TURN_REL} is missing — it is the live gatekeeper transition this rule protects`);
    return errors;
  }
  const turn = code(turnRaw);

  // FROM CORE, which is on the turn's permitted-dependency list. Importing it from the agent's
  // degraded-mode module instead would reach the same constant by dragging disk, git and the
  // installation ledger into a module whose whole testability argument is that it depends on none of
  // them — and `val-projectos-gatekeeper-contract1a` refuses exactly that.
  if (!/import \{[\s\S]*?\benforcedOwnerOnlyActions\b[\s\S]*?\} from '@projectos\/core'/.test(turn)) {
    E(`${TURN_REL} no longer imports enforcedOwnerOnlyActions from '@projectos/core'`);
  }
  // THE CONDITION IS READ FROM THE INPUT AND DEFAULTS TO NULL. `?? null` is the load-bearing half: a
  // caller that supplies nothing gets the full floor, which is what keeps the relaxation opt-in.
  if (!/const ownerOnlyActions\s*=\s*enforcedOwnerOnlyActions\(\s*input\.ownerOnlyActions\s*,\s*input\.technicalDelegation \?\? null\s*\)/.test(turn)) {
    E(
      `${TURN_REL} no longer derives its owner-only set as ` +
        "enforcedOwnerOnlyActions(input.ownerOnlyActions, input.technicalDelegation ?? null) — the phase's " +
        "declaration alone is not the protected set, and an absent delegation must not relax it",
    );
  }

  // 3. THE REGRESSION ITSELF. This is the exact expression that was there before, and the exact
  //    shape a well-meaning revert would restore. Both the request the reviewer is sent and the
  //    expectations its answer is judged against must use the derived set; passing `input`'s
  //    narrower list to either one reopens the gap on its own.
  if (/ownerOnlyActions:\s*input\.ownerOnlyActions/.test(turn)) {
    E(
      `${TURN_REL} passes input.ownerOnlyActions straight through — the live gate would enforce only ` +
        "what the phase declared, so a plan that omitted a protected action would make it grantable",
    );
  }

  // 4. THE CONSUMER STILL REFUSES. A derived set nothing acts on is decoration.
  const checkerRaw = read(CHECKER_REL);
  if (checkerRaw === null) {
    E(`${CHECKER_REL} is missing — it is where an owner-only grant is refused`);
  } else if (!/expect\.ownerOnlyActions\.includes\(name\)/.test(code(checkerRaw))) {
    E(
      `${CHECKER_REL} no longer refuses a decision whose allowedActions names an owner-only action — ` +
        "the floor would be computed and then ignored",
    );
  }

  // 5. ONE FLOOR, ONE DECLARER. A second copy is how two answers to "what is protected" begin, and
  //    the day they disagree the permissive one wins. A re-export is not a declaration and is how
  //    the agent's degraded-mode callers keep the spelling they already had.
  const reexport = code(read(FLOOR_REEXPORT_REL) || "");
  if (!/export \{[^}]*\bALWAYS_OWNER_ONLY\b[^}]*\} from '@projectos\/core'/.test(reexport)) {
    E(
      `${FLOOR_REEXPORT_REL} no longer re-exports ALWAYS_OWNER_ONLY from core — either a caller lost ` +
        "its import or a second copy of the floor was declared to replace it",
    );
  }

  const sources = [
    ...agentSources(path.join(ROOT, "projectos", "agent", "src")),
    ...agentSources(path.join(ROOT, "projectos", "core", "src")),
  ];
  if (sources.length === 0) E("no sources were found — the one-declarer rule would pass vacuously");
  for (const abs of sources) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (rel === FLOOR_REL) continue;
    if (/(?:const|let|var)\s+ALWAYS_OWNER_ONLY\s*=/.test(code(read(rel) || ""))) {
      E(`${rel} declares its own ALWAYS_OWNER_ONLY — only ${FLOOR_REL} may, or the floor has two versions`);
    }
  }

  // 6. THE BEHAVIOUR IS PROVEN, NOT ONLY SHAPED. A validator pinning a call site while the tests
  //    that exercise it were deleted would report a protection nobody had run.
  // THE SPLIT IS PROVEN, INCLUDING THE PART THAT MATTERS MOST — that degraded mode never yields, and
  // that the ACTIVE plan still refuses commit and push. A shape pinned above whose behaviour nobody
  // runs is a shape, not a protection.
  const conditionalProof = read(CONDITIONAL_TEST_REL);
  if (conditionalProof === null) {
    E(`${CONDITIONAL_TEST_REL} is missing — the conditional floor's behaviour is no longer proven`);
  } else {
    // WHAT THE PROOF MUST STILL CONTAIN — and note what is deliberately NOT pinned here any more.
    //
    // This rule used to require the test to prove "the real plan record still refuses commit and
    // push". That was true until the owner amended the plan, at which point the validator was
    // demanding a proof of something the governance had legitimately changed. A rule that pins a
    // POLICY OUTCOME fails the day the owner exercises the policy; a rule that pins the MECHANISM
    // keeps working. So what is required now is that the test resolves the active plan canonically —
    // through planMemory, never a hardcoded path — and asserts the absolute floor holds whatever that
    // plan says.
    for (const [needle, what] of [
      ["degraded mode never yields", "that degraded mode cannot be relaxed by a delegation"],
      ["cfg.planMemory?.planPath", "that it resolves the ACTIVE plan canonically rather than assuming a path"],
      ["ABSOLUTE_OWNER_ONLY", "that the absolute floor holds whatever the active plan declares"],
    ]) {
      if (!conditionalProof.includes(needle)) {
        E(`${CONDITIONAL_TEST_REL} no longer proves ${what}`);
      }
    }
  }

  const testRaw = read(TEST_REL);
  if (testRaw === null) {
    E(`${TEST_REL} is missing — the floor's behaviour on the live path is no longer proven`);
  } else if (!/it\.each\(\[\.\.\.ALWAYS_OWNER_ONLY\]\)/.test(testRaw)) {
    E(
      `${TEST_REL} no longer exercises every member of ALWAYS_OWNER_ONLY — a floor action added later ` +
        "would go unproven on the live path",
    );
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-live-gate-owner-floor1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-live-gate-owner-floor1a: PASS");
}

module.exports = { run, FLOOR_REL, FLOOR_REEXPORT_REL, TURN_REL, CHECKER_REL, TEST_REL, CONDITIONAL_TEST_REL, FLOOR_MEMBERS };
