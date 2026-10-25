"use strict";
/**
 * THE CLOSURE TRANSPORT CANNOT BECOME AUTHORITY — PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A.
 *
 * This is the first machinery in ProjectOS that asks a model whether a phase should be CLOSED. The
 * unit and end-to-end tests prove today's behaviour; this pins the SHAPE that keeps it safe as the
 * code changes, because every failure mode below reads perfectly reasonably in a diff:
 *
 *   - "the decision is checked already, just close it here" — and there are two closure engines
 *   - "reuse the gatekeeper verdicts, APPROVED_FOR_CLOSURE already exists" — and an ordinary evidence
 *     review becomes convertible into a closure
 *   - "stamp the bindings like the technical transport does" — and the record stops being the
 *     authority's own statement, which is the whole of Route A
 *   - "mark the decision consumed once we've seen it" — and a decision is spent by the route that
 *     wrote it rather than by the closure that used it
 *   - "read the decision from disk, it's the same file" — and a symlink makes the committed bytes and
 *     the checked bytes different things
 *   - "commit the accounting so the tree is clean" — and G4-12 sees a substantive change
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not scan for the words `commit` or `close`: refusal
 * prose, git helpers and the word "closure" itself all legitimately contain them, and a validator
 * that fails correct code teaches people to work around it. Every rule below names one file and one
 * construct.
 *
 * Reads files. Runs nothing, calls no provider, mutates nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

/** The pure contract: what a closure request is, and what makes an answer usable. */
const CONTRACT_REL = "projectos/core/src/closureTransport.ts";
/** The transition: one question, one checked answer, no durability and no decision of its own. */
const TURN_REL = "projectos/agent/src/loop/closureTurn.ts";
/** The transport: the closure schema on the existing endpoint and the existing broker. */
const TRANSPORT_REL = "projectos/agent/src/loop/transports/closureResponses.ts";
/** What was presented to the owner, so what they committed can be compared with it. */
const WAIT_REL = "projectos/agent/src/closureWait.ts";
/** The composition, and the only place that touches the filesystem on this route. */
const COMMAND_REL = "projectos/agent/src/commands/closure.ts";
/** The EXISTING closure gate. This route must not acquire a second copy of any of it. */
const GATE_REL = "projectos/agent/src/closureGate.ts";
/** The trusted side, whose closed ask vocabulary this route joins rather than bypasses. */
const BROKER_REL = "projectos/security/gatekeeper-transport-broker.cjs";
/** Where `phase-closure` is held to be owner-only whatever is delegated or decided. */
const OWNER_ONLY_REL = "projectos/core/src/ownerOnlyActions.ts";
/** Where the closure tail is declared, and where the ledger had to be admitted to it. */
const TAIL_REL = "projectos/core/src/closureEligibility.ts";
/** This file. It is subject to rule 15 as much as anything it checks. */
const VALIDATOR_REL = "projectos/validators/val-projectos-closure-transport1a.cjs";

/** The proofs. A pinned shape whose behaviour nobody runs is a shape, not a protection. */
const TESTS = [
  "projectos/core/test/closure-transport.test.ts",
  "projectos/agent/test/closureTurn.test.ts",
  "projectos/agent/test/closureOwnerCommit.test.ts",
  // The governed chain against a real repository. Without it the pieces above are proven and their
  // REACHABILITY is not — which is the state B6's executor was found in.
  "projectos/agent/test/closureEndToEnd.test.ts",
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments, so a rule is never satisfied — or broken — by prose describing it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function run() {
  const errors = [];
  const files = {};
  for (const rel of [CONTRACT_REL, TURN_REL, TRANSPORT_REL, WAIT_REL, COMMAND_REL, GATE_REL, BROKER_REL, OWNER_ONLY_REL, TAIL_REL]) {
    const text = read(rel);
    if (text === null) {
      errors.push("missing " + rel);
      continue;
    }
    files[rel] = code(text);
  }
  for (const rel of TESTS) {
    if (read(rel) === null) errors.push("missing proof " + rel);
  }
  if (errors.length > 0) return errors;

  // 1. ONE CLOSURE ENGINE. The route must reach CLOSED through the existing phase-advance path, and
  //    must not transition, save or grant a phase itself.
  for (const forbidden of ["transitionPhase", "savePhase", "authoriseClosure", "markDecisionConsumed"]) {
    if (files[COMMAND_REL].includes(forbidden)) {
      errors.push(
        COMMAND_REL + " calls " + forbidden + " directly; the closure route must hand closure to " +
          "`phase advance --to closed --delegated` so there is one closure engine, not two",
      );
    }
  }
  if (!files[COMMAND_REL].includes("phaseCommand(")) {
    errors.push(COMMAND_REL + " no longer delegates to the existing phase-advance command");
  }

  // 2. THE VOCABULARIES STAY DISJOINT. A technical verdict must not be a closure answer.
  const decisions = /CLOSURE_RESPONSE_DECISIONS\s*=\s*\[([^\]]*)\]/.exec(files[CONTRACT_REL]);
  if (decisions === null) {
    errors.push(CONTRACT_REL + " declares no CLOSURE_RESPONSE_DECISIONS vocabulary");
  } else {
    for (const technical of ["APPROVED_TO_PROCEED", "APPROVED_TO_COMMIT", "APPROVED_TO_PUSH", "APPROVED_FOR_CLOSURE", "AMENDMENT_REQUIRED", "DO_NOT_PROCEED", "AWAITING_OWNER"]) {
      if (decisions[1].includes(technical)) {
        errors.push(
          CONTRACT_REL + " admits the technical verdict " + technical + " as a closure answer; the two " +
            "vocabularies must stay disjoint or an ordinary evidence review becomes convertible into a closure",
        );
      }
    }
  }

  // 3. THE ANSWER IS THE AUTHORITY'S OWN STATEMENT. `closureDecisionRecordFrom` must copy, never
  //    substitute: no runtime value may be written into the record it builds.
  const builder = /export function closureDecisionRecordFrom\([\s\S]*?\n}/.exec(files[CONTRACT_REL]);
  if (builder === null) {
    errors.push(CONTRACT_REL + " no longer exports closureDecisionRecordFrom");
  } else {
    // EVERY PROPERTY, NOT JUST THE FIRST. A stamped field arrives as `scope: 'phase-closure',` —
    // a property assignment, not an `=` — so the rule reads the properties themselves. Each value
    // must be `response.<field>` and nothing else; a literal, a constant or a computed value there is
    // ProjectOS authoring a sentence it would then attribute to the closure authority.
    const properties = builder[0].match(/^\s{4}([A-Za-z][A-Za-z0-9_]*):\s*(.+?),\s*$/gm) || [];
    if (properties.length === 0) {
      errors.push(CONTRACT_REL + " closureDecisionRecordFrom builds no record properties this rule can read");
    }
    for (const line of properties) {
      const parsed = /^\s{4}([A-Za-z][A-Za-z0-9_]*):\s*(.+?),\s*$/.exec(line);
      if (parsed !== null && parsed[2] !== "response." + parsed[1]) {
        errors.push(
          CONTRACT_REL + " closureDecisionRecordFrom sets '" + parsed[1] + "' to " + parsed[2] +
            " rather than copying the authority's own value; the committed record must be the closure " +
            "authority's statement, not ProjectOS's paraphrase of it",
        );
      }
    }
  }

  // 4. THE TURN OWNS NO DURABILITY. It must not be able to write a file or run git.
  for (const forbidden of ["node:fs", "writeText(", "sys.exec", "System"]) {
    if (files[TURN_REL].includes(forbidden)) {
      errors.push(
        TURN_REL + " references " + forbidden + "; the closure turn decides nothing about durability " +
          "and must not be able to write the record it produces",
      );
    }
  }

  // 5. THE COMMITTED BYTES ARE READ FROM THE GIT OBJECT, never the working tree.
  if (!files[WAIT_REL].includes("HEAD:./")) {
    errors.push(
      WAIT_REL + " no longer reads the committed decision from the git object store; reading the " +
        "working tree would digest bytes git never saw, and a tracked symlink would make the two differ",
    );
  }

  // 6. THE ROUTE MAKES NO MUTATING GIT CALL. Every git invocation in these files must be read-only.
  const MUTATING = ["'commit'", "'push'", "'merge'", "'add'", "'reset'", "'checkout'", "'tag'"];
  for (const rel of [WAIT_REL, COMMAND_REL, TURN_REL, TRANSPORT_REL]) {
    for (const verb of MUTATING) {
      if (new RegExp("exec\\(\\s*['\"]git['\"][^)]*" + verb.replace(/'/g, "['\"]")).test(files[rel])) {
        errors.push(rel + " issues a mutating git " + verb + "; the closure route observes the owner's commit and never makes one");
      }
    }
  }

  // 7. THE EXISTING GATE IS REUSED, NOT REIMPLEMENTED. These predicates must still live in one place.
  for (const fn of ["decisionIsCommitted", "readCommittedDecision", "closureDecisionProblems"]) {
    if (!files[GATE_REL].includes("export function " + fn)) {
      errors.push(GATE_REL + " no longer exports " + fn + ", which the closure route depends on");
    }
    if (files[WAIT_REL].includes("export function " + fn) || files[COMMAND_REL].includes("export function " + fn)) {
      errors.push("the closure route redefines " + fn + "; there must be one committed-decision predicate, not two");
    }
  }

  // 8. THE TRUSTED VOCABULARY GAINED ONE WORD AND LOST NONE.
  const asks = /const KNOWN_ASKS = \[([\s\S]*?)\];/.exec(files[BROKER_REL]);
  if (asks === null) {
    errors.push(BROKER_REL + " no longer declares KNOWN_ASKS");
  } else {
    for (const required of [
      "security-review",
      "correction-exhausted",
      "evidence-review",
      "worker-refusal",
      "effects-unattested",
      "ambiguity",
      "degraded-mode-reconciliation",
      "closure-review",
    ]) {
      if (!asks[1].includes('"' + required + '"')) {
        errors.push(BROKER_REL + " KNOWN_ASKS no longer admits '" + required + "'");
      }
    }
  }

  // 9. CLOSURE IS STILL ABSOLUTELY OWNER-ONLY. Nothing on this route may relax it.
  if (!/ABSOLUTE_OWNER_ONLY = \[[^\]]*'phase-closure'/.test(files[OWNER_ONLY_REL])) {
    errors.push(OWNER_ONLY_REL + " no longer holds 'phase-closure' in ABSOLUTE_OWNER_ONLY");
  }
  if (files[COMMAND_REL].includes("enforcedOwnerOnlyActions") || files[TURN_REL].includes("enforcedOwnerOnlyActions")) {
    errors.push(
      "the closure route computes an owner-only set; it has no protected actions to grant and must " +
        "not acquire the vocabulary for doing so",
    );
  }

  // 10. THE PAID CALL IS NOT REACHABLE BY ACCIDENT, and the injection seam is not reachable from the CLI.
  if (!/bool\(flags, 'execute'\)/.test(files[COMMAND_REL])) {
    errors.push(COMMAND_REL + " no longer requires --execute before making a paid closure call");
  }
  if (/case 'request':\s*return closureRequest\(ctx, flags, /.test(files[COMMAND_REL])) {
    errors.push(
      COMMAND_REL + " passes a deps maker from the command dispatcher; the injection seam exists for " +
        "tests and must not be reachable from the CLI",
    );
  }

  // 11. THE OWNER'S COMMIT IS ATTRIBUTED, NOT MERELY COUNTED.
  //
  // `decisionIsCommitted` asks only whether A commit exists. This route makes "get one commit onto
  // HEAD" the sole remaining human step, so an unattributed commit gate is the difference between a
  // decision the owner made and one an implementer's `git add -A` sweep picked up. Raised as HIGH by
  // the ECC security review against this correction.
  if (!files[WAIT_REL].includes("ownerCommitIdentityProblems")) {
    errors.push(WAIT_REL + " no longer judges WHO committed the closure decision");
  }
  if (!/observeOwnerCommit\([\s\S]{0,400}expectedOwner/.test(files[WAIT_REL])) {
    errors.push(WAIT_REL + " observeOwnerCommit no longer takes the expected owner, so it cannot attribute the commit");
  }
  if (!files[COMMAND_REL].includes("planOwner(gc.context.plan)")) {
    errors.push(
      COMMAND_REL + " no longer passes the ACTIVE PLAN's owner to the commit observation; an owner " +
        "taken from anywhere else would be a caller's claim about who may close",
    );
  }

  // 12. THE FREE TEXT A HUMAN IS ASKED TO READ IS HELD TO WHAT CAN BE READ SAFELY.
  //
  // Route A rests on the owner READING the decision before committing it. A bidirectional override in
  // the note makes the rendered text disagree with the bytes, so a matching digest would be a match on
  // bytes nobody actually read. Raised as HIGH by BOTH ECC reviews.
  //
  // THE RULE IS THAT IT IS CALLED, not that it exists. A first version of this check asked only
  // whether the predicate was declared in the file, and a mutation that kept the declaration and
  // stopped invoking it passed — which is a validator that pins a shape while the behaviour is gone.
  const responseCheck = /export function checkClosureResponse\([\s\S]*?\n}/.exec(files[CONTRACT_REL]);
  if (!/REORDERING\s*=\s*\//.test(files[CONTRACT_REL]) || !files[CONTRACT_REL].includes("unreadableTextProblem")) {
    errors.push(
      CONTRACT_REL + " no longer declares the reordering/invisible-character rule for the closure note; the " +
        "owner is asked to read this record, and text that renders differently from its bytes defeats that",
    );
  } else if (responseCheck === null) {
    errors.push(CONTRACT_REL + " no longer exports checkClosureResponse");
  } else if (!responseCheck[0].includes("unreadableTextProblem(")) {
    errors.push(
      CONTRACT_REL + " checkClosureResponse no longer APPLIES the reordering/invisible-character rule; " +
        "declaring it and not calling it is a shape, not a protection",
    );
  }
  if (files[CONTRACT_REL].includes("replace(REORDERING")) {
    errors.push(
      CONTRACT_REL + " STRIPS the offending characters instead of refusing; stripping changes the bytes, " +
        "and the committed record must be the closure authority's own statement",
    );
  }

  // 13. THE PAID CALL IS ACCOUNTED FOR. The owner's dollar ceiling lives in one place and reads one
  //     file; a closure call that never reaches it drifts that ceiling for the life of the project.
  //     Raised as HIGH by the ECC code review against this correction.
  for (const port of ["admitSpend", "settleGatekeeperSpend", "resolveSpend"]) {
    if (!files[COMMAND_REL].includes(port)) {
      errors.push(COMMAND_REL + " no longer wires " + port + "; the closure call's cost would go unrecorded");
    }
  }
  if (!files[TAIL_REL].includes("'.projectops/gatekeeper-ledger.json'")) {
    errors.push(
      TAIL_REL + " no longer admits the gatekeeper ledger as a closure-tail path; without it the ledger " +
        "entry a closure call necessarily writes after the evidence subject reads as a substantive change",
    );
  }

  // 14. THE EVIDENCE IS PRESENTED AS DATA. It carries repository text an injection could reach.
  if (!/EVIDENCE, NOT INSTRUCTION/.test(files[TRANSPORT_REL])) {
    errors.push(
      TRANSPORT_REL + " no longer tells the closure authority that the evidence is data rather than " +
        "instruction; the pack carries repository-authored free text",
    );
  }

  // 15. NO CLOSURE SOURCE FILE MAY BE BINARY TO GIT.
  //
  // A single C0 byte — a NUL above all — makes git classify a source file as binary, so its diff
  // reads `Bin 0 -> N bytes` and `grep` answers "Binary file matches". This programme has been
  // bitten by it once already, in `gatekeeperRequestDigest`, and this correction reproduced it: the
  // first version of the control-character class in `closureTransport.ts` was written with literal
  // control characters. An unreadable diff defeats the owner's commit gate, which is the only real
  // boundary this whole route depends on — so it is refused here rather than trusted to habit.
  //
  // Bytes are read RAW, not through `code()`: a comment cannot make a byte acceptable.
  for (const rel of [CONTRACT_REL, TURN_REL, TRANSPORT_REL, WAIT_REL, COMMAND_REL, VALIDATOR_REL]) {
    const abs = path.join(ROOT, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const bytes = fs.readFileSync(abs);
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i];
      // Tab, LF and CR are the only control bytes a source file may hold.
      if (b === 9 || b === 10 || b === 13) continue;
      if (b < 32 || b === 127) {
        errors.push(
          rel + " contains control byte 0x" + b.toString(16) + " at offset " + i +
            ", which makes the file BINARY to git. Its diff would read as a byte count instead of code, " +
            "and an unreadable diff defeats the owner commit gate this route depends on. Write the " +
            "character as a \\uXXXX escape.",
        );
        break;
      }
    }
  }

  // 16. THE WHOLE OWNER-COMMIT BUNDLE IS BYTE-BOUND, NOT JUST THE DECISION.
  //
  // The owner commits two governed files: the decision, and the ledger entry the paid call wrote
  // after the evidence subject. An earlier version of this route bound only the first, so the ask
  // could truthfully say "commit these two exactly" while ProjectOS would afterwards verify one —
  // and an older ledger, a ledger with an extra entry, or a ledger from another run could enter the
  // repository inside a commit this route then treats as the owner's act. Ruled insufficient by the
  // ChatGPT architecture gate; this is what keeps the repair from being undone.
  if (!/readonly bundle: readonly ClosureBundleEntry\[\]/.test(files[WAIT_REL])) {
    errors.push(WAIT_REL + " no longer records the closure bundle, so only part of the owner commit could be bound");
  }
  const observe = /export function observeOwnerCommit\([\s\S]*?\n}/.exec(files[WAIT_REL]);
  if (observe === null) {
    errors.push(WAIT_REL + " no longer exports observeOwnerCommit");
  } else {
    // IT MUST ITERATE THE BUNDLE, not check one path. A version that reads a single blob is exactly
    // the shape the gate refused.
    if (!/for \(const entry of wait\.bundle\)/.test(observe[0])) {
      errors.push(
        WAIT_REL + " observeOwnerCommit no longer verifies every bundle entry; binding one file of a " +
          "two-file commit is the defect this amendment exists to close",
      );
    }
    // AND FROM THE COMMITTED BLOB. A working-tree read would let a later correction stand in for a
    // wrong committed blob.
    if (!/HEAD:\.\/\$\{entry\.path\}/.test(observe[0])) {
      errors.push(WAIT_REL + " observeOwnerCommit no longer reads each bundle entry from the git object");
    }
    if (!/every\(\(o\) => o\.matches\)/.test(observe[0])) {
      errors.push(WAIT_REL + " observeOwnerCommit no longer requires EVERY bundle entry to match");
    }
  }
  // THE BUNDLE IS CLOSED. Only the decision and the one approved accounting path may be in it; a
  // third name here would be a third file the owner is asked to commit with no ruling behind it.
  const also = /const ALSO_IN_BUNDLE: readonly string\[\] = \[([^\]]*)\]/.exec(files[COMMAND_REL]);
  if (also === null) {
    errors.push(COMMAND_REL + " no longer declares the closed set of non-decision bundle paths");
  } else {
    const names = also[1].split(",").map((n) => n.trim()).filter((n) => n.length > 0);
    if (names.length !== 1 || names[0].indexOf("gatekeeper-ledger.json") === -1) {
      errors.push(
        COMMAND_REL + " admits " + names.length + " non-decision path(s) into the closure bundle; the " +
          "architecture gate approved exactly one, the gatekeeper ledger",
      );
    }
  }
  // AND UNTRACKED FILES ARE LISTED INDIVIDUALLY. Plain `--porcelain` collapses a new directory to
  // its name, so a bundle built from it would name a directory and digest nothing.
  if (!/status.*-uall/.test(files[COMMAND_REL])) {
    errors.push(
      COMMAND_REL + " reads git status without -uall; an untracked directory would then be named in " +
        "the bundle instead of the files inside it, and the byte-binding would be over a path git " +
        "does not store",
    );
  }

  // 17. THE COMMIT IS BOUNDED TO THE BUNDLE, AND A PATH CANNOT BE CRAFTED TO LOOK LIKE ANOTHER.
  //
  // Two HIGH findings from the ECC security review of this amendment, and both are the kind that
  // read as harmless in a diff:
  //
  //   - "just check the files we named" — and a file dropped into a closure-tail directory during
  //     the wait rides into the owner's commit unexamined, invisible to the bundle AND to G4-12;
  //   - "trim the path, git pads it" — and a decoy whose name is the decision plus a non-breaking
  //     space collapses onto the decision's own path, is never digested, and is never named.
  const bounded = /export function observeOwnerCommit\([\s\S]*?\n}/.exec(files[WAIT_REL]);
  if (bounded === null || !bounded[0].includes("introducedBeyondBundle(")) {
    errors.push(
      WAIT_REL + " observeOwnerCommit no longer bounds the owner's commit to the bundle; verifying the " +
        "named files says nothing about what else the same commit carried, and several governed " +
        "directories are closure-tail paths G4-12 waves through",
    );
  }
  if (!/readonly headAtRequest: string/.test(files[WAIT_REL])) {
    errors.push(WAIT_REL + " no longer records the head the ask was made against, so the commit cannot be bounded");
  }
  if (!/merge-base.*--is-ancestor/.test(files[WAIT_REL])) {
    errors.push(
      WAIT_REL + " no longer requires the recorded head to be an ancestor of HEAD; rewritten history " +
        "would then be treated as a bounded commit",
    );
  }
  const parser = /function dirtyGovernedPaths\([\s\S]*?\n}/.exec(files[COMMAND_REL]);
  if (parser === null) {
    errors.push(COMMAND_REL + " no longer declares dirtyGovernedPaths");
  } else if (/slice\(3\)[^\n]*\.trim\(\)/.test(parser[0])) {
    errors.push(
      COMMAND_REL + " trims the porcelain path again; a filename differing from the decision's only " +
        "by an invisible character then compares equal to it and is never digested",
    );
  }
  if (!/UNSAFE_IN_PATH/.test(files[COMMAND_REL])) {
    errors.push(
      COMMAND_REL + " no longer refuses governed paths carrying whitespace or control characters; a " +
        "name a person cannot tell apart from another must not enter the bundle",
    );
  }

  return errors;
}

module.exports = { run };
