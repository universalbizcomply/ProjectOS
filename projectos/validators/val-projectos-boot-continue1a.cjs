"use strict";
/**
 * SAFE CONTINUATION ACROSS APPROVED PHASES — PROJECTOS-BOOT-CONTINUE1A.
 *
 * The unit and end-to-end tests prove today's behaviour; this pins the SHAPE of each new rule, because
 * every way of undoing one reads reasonably in a diff:
 *
 *   - "a prose gate is just documentation"            — and a plan's reservation stops binding
 *   - "no run evidence, assume no effect"             — and G4-11 fails open again
 *   - "checks run until they finish"                  — and one hung suite holds a run for ever
 *   - "delete the stale question"                     — and a planted answer can be revived
 *   - "a selection stop is a refusal"                 — and a finished phase reads as a broken run
 *   - "let continue pass an identity through"         — and the router becomes an authority
 *   - "prepare may as well commit"                    — and closure evidence commits itself
 *   - "the scope grant can be a directory"            — and governance files ride along with it
 *   - "keep the source-grant record as a fallback"    — and there are two grant routes again
 *
 * PROJECTOS-FINISH-WRITEPATHS1A adds section (10):
 *
 *   - "the scope sentence names the paths anyway"      — and prose is a grant route again
 *   - "a bad entry can just be skipped"                — and a grant quietly differs from the list
 *   - "the validator in the tree is the validator"     — and a worker grades its own work
 *   - "pinning can be optional"                         — and one call site runs the tree's copy
 *
 * PROJECTOS-FINISH-MULTIPROJECT1A adds section (11):
 *
 *   - "closure is for projectos"                       — and no other project's phase can ever close
 *   - "while we are committing, take the rest too"     — and unreviewed work rides a records commit
 *   - "the owner gate is only for the work"            — and a reserved phase commits behind the owner
 *   - "the decision is a record like the others"       — and ProjectOS commits its own closure decision
 *
 * PROJECTOS-FINISH-API-GATEKEEPER1A adds section (12):
 *
 *   - "the broker is just another transport"           — and a configured Host route is bypassed
 *   - "the agent may as well resolve it"               — and the key enters the agent process
 *   - "allowlist everything while we are here"         — and the credential pays for any project
 *
 * Every rule names one file and one construct. Comments are stripped first, so prose describing a rule
 * can neither satisfy nor break it. Reads files; runs nothing, calls no provider, mutates nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const BRIEF_REL = "projectos/agent/src/loop/brief.ts";
const CLOSURE_GATE_REL = "projectos/agent/src/closureGate.ts";
const VERIFICATION_REL = "projectos/agent/src/loop/verification.ts";
const HANDOFF_REL = "projectos/agent/src/loop/gatekeeperHandoff.ts";
const CONTINUATION_REL = "projectos/agent/src/loop/programmeContinuation.ts";
const RUN_REL = "projectos/agent/src/commands/run.ts";
const CLOSURE_REL = "projectos/agent/src/commands/closure.ts";
const WORKERS_REL = "projectos/agent/src/loop/workers.ts";
const RUNNER_REL = "projectos/agent/src/loop/runner.ts";
const CONFIG_REL = ".projectops/project-config.json";
const RETIRED_GRANT_REL = ".projectops/authority/worker-source-grant.json";
const RECONCILE_REL = "projectos/agent/src/commands/reconcile.ts";
const PINNED_REL = "projectos/agent/src/loop/pinnedValidators.ts";
const PLAN_APPROVAL_REL = "projectos/agent/src/planApproval.ts";
const ENGINE_REL = "projectos/validators/plan-discovery-engine.cjs";
const SCHEMA_REL = "projectos/schemas/project-plan.schema.json";
const FINISH_PLAN_REL = "docs/projectos-finish-phases.json";
const TECHNICAL_REL = "projectos/agent/src/loop/technicalContinuation.ts";
const ELIGIBILITY_REL = "projectos/core/src/closureEligibility.ts";
const ALLOWLIST_REL = "projectos/security/installation-project-allowlist.json";
const CORE_AUTHORITY_REL = "projectos/core/src/closureAuthority.ts";
const CORE_TRANSPORT_REL = "projectos/core/src/closureTransport.ts";
const CLOSURE_WAIT_REL = "projectos/agent/src/closureWait.ts";
const CLOSURE_TURN_REL = "projectos/agent/src/loop/closureTurn.ts";
const GK_CONFIG_REL = "projectos/agent/src/loop/gatekeeperConfig.ts";
const CLOSURE_RESPONSES_REL = "projectos/agent/src/loop/transports/closureResponses.ts";

/** The proofs. A pinned shape whose behaviour nobody runs is a shape, not a protection. */
const TESTS = {
  "projectos/agent/test/ownerGateClassification.test.ts": ["FAIL CLOSED"],
  "projectos/agent/test/protectedEffectsEvidence.test.ts": ["rewritten", "PLANTED evidence record", "EVERY run counts"],
  "projectos/agent/test/checkTimeout.test.ts": ["timedOut"],
  "projectos/agent/test/staleInteractiveRequest.test.ts": ["already answered and acted on"],
  "projectos/agent/test/continuationEndToEnd.test.ts": [
    "prose owner gate",
    "AWAITING_CLOSURE",
    "HANDS OFF to the existing closure route",
    "closure prepare generates the closure records from the run",
    "SUBJECT_NOT_FROM_RUN",
    "FINDINGS_NOT_BOUND",
    "GIT-IGNORED content under its grant",
    "NESTED REPOSITORY under its grant",
    "with no writePaths, grants the worker-owned records only",
    "BASE-COMMIT validator, never the copy the run itself rewrote",
    "a FILE grant made into a directory",
    "ProjectOS commits and pushes EXACTLY those three, and G4 accepts",
    "without a proven technical delegation, closure prepare only GENERATES the three records",
    "the run's own records are committed and pushed, and the tree holds none",
  ],
  "projectos/agent/test/closureEndToEnd.test.ts": ["waits, boundedly, for the owner commit", "projectos continue routes on recorded state"],
  "projectos/agent/test/loopToolGrants.test.ts": ["passes through a link", "differs in case", "the retired source grant", "the execution records directory", "a star glob", "a sentence as an entry", "git-ignored output", "the closure delegation", "governed files", "the list alone decides", "not a non-empty path string", "Every plan v1.9 phase carries writePaths", "an agent instruction file", "flags a hook or settings directory", "FILE grant the worker made into a directory"],
  "projectos/agent/test/loopRunner.test.ts": ["FIRST dispatch only"],
  // PROJECTOS-FINISH-WRITEPATHS1A.
  "projectos/agent/test/pinnedValidators.test.ts": [
    "does NOT change the check result",
    "the child a pinned validator spawns is pinned too",
    "still judges the WORKER's tree",
    "a validator the worker ADDED cannot judge the phase",
    "outside the checkout and is removed afterwards",
    "reached through a JUNCTION still judges from the base commit",
    "leaves no directory behind",
    "removes the pin even when the work it wraps throws",
  ],
  "projectos/agent/test/loopOutcome.test.ts": ["a validator absent from the base commit cannot judge the phase", "never run unpinned"],
  "projectos/agent/test/planAuthoring.test.ts": ["writePaths are projected exactly, absent stays absent, and a malformed list is refused"],
  // PROJECTOS-FINISH-MULTIPROJECT1A.
  "projectos/agent/test/ownRecordsCommit.test.ts": [
    "commits and pushes EXACTLY the records",
    "when any uncommitted path is not one of the records",
    "when the phase reserves commit or push, or when no technical delegation is proven",
    "a head the remote does not already hold",
    "an unreadable owner-gate list reserves every technical action",
  ],
  "projectos/core/test/closure-eligibility.test.ts": ["a governed project other than projectos satisfies G4-1", "a plan for another project, or an unknown project, refuses"],
  // PROJECTOS-FINISH-API-GATEKEEPER1A.
  "projectos/agent/test/hostReviewPath.e2e.test.ts": ["NO broker opt-in, nothing is composed", "the trusted BROKER is composed in the pre-hybrid shape", "refused before dispatch: nothing posted, no ledger", "reaches the broker exactly once", "refused as ambiguous"],
  "projectos/agent/test/hybridClosureReconcile.test.ts": ["closure composes the trusted broker only on the committed opt-in with no Host route; reconcile composes none", "on the broker opt-in, a project the installation does not allowlist is refused before the closure request", "ProjectOS commits the decision, the phase closes and the close is persisted", "an INTERACTIVE answer is never committed by ProjectOS, grant or not", "without the grant the owner commit is required exactly as before, and a ProjectOS-identity commit is refused", "a delegation ProjectOS committed itself grants nothing", "a wait whose provenance was stripped is not an answer produced in the call", "with the grant but no technical delegation, nothing is committed"],
  // PROJECTOS-FINISH-CONTINUE-INTEGRITY1A.
  "projectos/agent/test/continueIntegrity.test.ts": ["is added for a required validator the write paths name exactly", "is NOT added when the write paths do not cover the validator", "never turns an unsafe validator name into a path", "a phase copy that changes the checkout while it runs FAILS", "reads the checkout picture with a buffer large enough for a real checkout"],
  "projectos/agent/test/continuationEndToEnd.test.ts": ["one continue carries on from a preparation that committed its records", "a preparation that only GENERATES its records (no technical delegation) stops there", "that BREAKS it fails on the phase copy", "CHANGES it and keeps it passing runs BOTH copies, in the run and in closure preparation"],
  // PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A.
  "projectos/agent/test/zeroTouchClosure.test.ts": ["with the grant, commits and pushes exactly the closure decision", "without the grant — absent, refused or judged invalid — commits nothing", "the grant never lifts a reserved commit or push", "with the grant, every other implementer-shaped or foreign identity is still refused"],
  "projectos/agent/test/closureTurn.test.ts": ["an invented decision time", "the request actually sent names the time of the question"],
  "projectos/core/test/closure-transport.test.ts": ["refuses the invented time the live agency closure carried", "an interactive answer saved while an earlier run waited has no lower bound"],
};

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/**
 * Strip comments, so a rule is never satisfied — or broken — by prose describing it.
 *
 * STRING-AWARE. A regex stripper treats `/**` inside a template literal (`${rel}/**`) as a comment
 * opener and swallows real code up to the next `*\/`, so a pin could pass or fail by accident of
 * ordering. This walks the text, skipping quoted strings and templates (keeping them), and removes
 * only comments outside them. A regex literal containing a quote is not modelled; the rules below
 * never depend on a regex literal's interior being stripped.
 */
function code(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The body of one top-level function, from its signature to the next top-level declaration. */
function fnBody(src, name) {
  const start = src.search(new RegExp(`(?:export )?function ${name}\\b`));
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:function|const|interface|type) /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);
  const files = {};
  for (const rel of [BRIEF_REL, CLOSURE_GATE_REL, VERIFICATION_REL, HANDOFF_REL, CONTINUATION_REL, RUN_REL, CLOSURE_REL, WORKERS_REL, RUNNER_REL, RECONCILE_REL, PINNED_REL, PLAN_APPROVAL_REL, ENGINE_REL, TECHNICAL_REL, ELIGIBILITY_REL]) {
    const raw = read(rel);
    if (raw === null) {
      E(`${rel} is missing`);
      return errors;
    }
    files[rel] = code(raw.replace(/\r\n/g, "\n"));
  }

  // (1) PROSE OWNER GATES BIND. The brief carries the classified gates, an unclassifiable reservation
  // reserves every delegable technical action, and the brief is checked against a re-derivation.
  const brief = files[BRIEF_REL];
  if (!/requiredOwnerGates: classifyOwnerGates\(/.test(brief)) E("BC-1a: the brief no longer classifies the plan's owner gates");
  const classify = fnBody(brief, "classifyOwnerGates") || "";
  if (!/TECHNICAL_ACTIONS/.test(classify)) E("BC-1b: an unclassifiable owner gate no longer reserves every technical action");
  if (!/for \(const \[pattern, token\] of PROSE_ACTION_TOKENS\) \{\s*if \(pattern\.test\(gate\)\) gates\.add\(token\);\s*\}\s*reserveEveryTechnicalAction = true;/.test(classify)) {
    E("BC-1d: a prose owner gate can reserve less than every technical action");
  }
  if ((brief.match(/classifyOwnerGates\(declaredOwnerGates\(phase\['requiredOwnerGates'\]\)\)/g) || []).length !== 2) {
    E("BC-1e: a malformed owner-gate declaration can read as no gates");
  }
  if (!/ownerGateDerivationProblems\(/.test(fnBody(brief, "briefProvenanceProblems") || "")) {
    E("BC-1c: the brief's owner gates are no longer checked against a re-derivation from the plan");
  }

  // (2) G4-11 FAILS CLOSED on EVERY bound runner-recorded run of this phase.
  const gate = files[CLOSURE_GATE_REL];
  const effects = fnBody(gate, "protectedEffectOccurred") || "";
  const attested = fnBody(gate, "runAttestedNoEffect") || "";
  const runs = fnBody(gate, "phaseRunEvidence") || "";
  if (!/if \(runs\.length === 0\) return true;/.test(effects)) E("BC-2a: absent run evidence no longer counts as a protected effect");
  if (!/digest\('hex'\) !== recorded\) return false;/.test(attested)) E("BC-2b: a rewritten effects attestation is no longer refused");
  if (!/PROTECTED_EFFECT_FIELDS\.every\(\(field\) => \(effects as Record<string, unknown>\)\[field\] === false\)/.test(attested)) {
    E("BC-2c: a protected effect field that is not exactly false is no longer an effect");
  }
  if (/projectos-v3\.session\.json/.test(gate)) E("BC-2d: the closure gate reads the retired V3 session file again");
  if (!/return !runs\.every\(\(run\) => runAttestedNoEffect\(sys, root, run\)\);/.test(effects)) {
    E("BC-2e: G4-11 no longer judges every run of the phase; a later clean run can hide an earlier effect");
  }
  if (!/if \(name !== `\$\{sessionId\}\.evidence\.json`\) continue;/.test(runs) || !/session\['phaseId'\] !== phaseId/.test(runs)) {
    E("BC-2f: run evidence is no longer bound to the runner's session record, so a planted record counts as a run");
  }
  if (!/catch \{\s*return true;\s*\}/.test(effects)) E("BC-2g: G4-11 can throw instead of failing closed");
  const verificationSrc = files[VERIFICATION_REL];
  if (!/findingsSha256: findingsText === null \? null : createHash\('sha256'\)/.test(verificationSrc)) {
    E("BC-2h: the runner no longer records the digest of the findings it collected");
  }

  // (3) EVERY CHECK IS BOUNDED, AND A TIMEOUT IS NOT A PASS.
  const verification = files[VERIFICATION_REL];
  const runCheck = fnBody(verification, "runCheck") || "";
  if (!/timeoutMs,\s*\}\);/.test(runCheck)) E("BC-3a: a check is no longer run under a timeout");
  if (!/passed: r\.code === 0 && !timedOut,/.test(runCheck)) E("BC-3b: a check that timed out can pass");
  if (!/MAX_CHECK_TIMEOUT_MINUTES = 240;/.test(verification)) E("BC-3c: the check timeout ceiling changed");

  // (4) A STALE QUESTION IS ARCHIVED, NEVER DELETED, AND AN ACTED-ON ONE IS NEVER REVIVED.
  const handoff = files[HANDOFF_REL];
  const supersede = fnBody(handoff, "nodeInteractivePort") || "";
  if (!/consumed/.test(supersede) || !/already answered and acted on/.test(handoff)) E("BC-4a: superseding no longer refuses a consumed question");
  if (!/renameFile\(/.test(supersede) || /removeFile\(/.test(supersede)) E("BC-4b: a stale question is deleted rather than archived");

  // (5) A SELECTION STOP IS A RESULT, AND NONE OF THEM CONTINUES.
  const continuation = files[CONTINUATION_REL];
  const may = fnBody(continuation, "mayContinueAfter") || "";
  const selBranch = may.slice(may.indexOf("if (sel !== null)"), may.indexOf("if (!attempt.ok)"));
  if (selBranch.length === 0) E("BC-5a: selection stops are no longer answered before the refusal branch");
  if (/continue: true/.test(selBranch)) E("BC-5b: a selection stop can continue the programme");
  if (!/sel\.phaseStatus === 'awaiting_closure'/.test(selBranch)) E("BC-5c: AWAITING_CLOSURE is no longer limited to a phase recorded awaiting_closure");
  if (!/const ownersStop = sel\.code === 'OWNER_DECISION_REQUIRED' \|\| sel\.code === 'PHASE_BLOCKED';/.test(selBranch) ||
      !/end: ownersStop \? 'STOPPED' : 'REFUSED',/.test(selBranch)) {
    E("BC-5d: a defect-class selection stop no longer ends REFUSED (non-zero) under --continue");
  }

  // (6) `continue` IS A ROUTER: it forwards waits and recovery choices, never an identity or authority.
  const runCmd = files[RUN_REL];
  if (!/const CONTINUE_FORWARDED_FLAGS = \['gate-wait-minutes', 'owner-wait-minutes', 'supersede-stale-request', 'worker'\] as const;/.test(runCmd)) {
    E("BC-6a: the flags `continue` forwards are no longer exactly its four waits and recovery choices");
  }
  const prepared = fnBody(runCmd, "closurePrepared") || "";
  if (!/evidence\['validatorsPass'\] !== true \|\| evidence\['checksPass'\] !== true/.test(prepared) ||
      !/since\.isAncestor && since\.substantive\.length === 0/.test(prepared)) {
    E("BC-6c: continue routes to the closure request on stale or failing closure records");
  }
  if (!/if \(route\.kind === 'defect'\) return fail\(1, /.test(fnBody(runCmd, "continueCommand") || "")) {
    E("BC-6e: projectos continue exits 0 on a defect-class selection stop");
  }
  if (!/supersedeStale: flags\['supersede-stale-request'\] === true,/.test(files[RECONCILE_REL])) {
    E("BC-6d: reconcile ignores --supersede-stale-request, the recovery the shared refusal names");
  }
  const cont = fnBody(runCmd, "continueCommand") || "";
  if (/delegated|'as'|identity|decidedBy/.test(cont) || /delegated|identity/.test(fnBody(runCmd, "handToClosure") || "")) {
    E("BC-6b: the continuation router passes an authority or identity to the command it routes to");
  }

  // (7) PREPARE GENERATES AND COMMITS NOTHING, FROM A RUN BOUND TO THE SUBJECT.
  const closure = files[CLOSURE_REL];
  const prepareFns = ["closurePrepare", "boundRun", "preparationTreeAnswer", "writePreparedRecords", "dirtyPaths", "aheadBehind"].map(
    (n) => fnBody(closure, n) || "",
  );
  if (prepareFns.some((b) => /'commit'|'push'|'add'/.test(b))) E("BC-7a: closure prepare runs a git commit, add or push");
  const writes = prepareFns.reduce((n, b) => n + (b.match(/sys\.writeText\(/g) || []).length, 0);
  if (writes !== 3 || (prepareFns[3].match(/sys\.writeText\(/g) || []).length !== 3) {
    E(`BC-7b: closure prepare writes ${writes} file(s), not exactly its three closure-tail records`);
  }
  if (!/workingTreeCleanAtRunStart: true/.test(prepareFns[3]) || !/if \(!git\.clean\)/.test(prepareFns[2])) {
    E("BC-7c: the validation record can claim a clean tree that was not checked");
  }
  const [prepare, bound] = prepareFns;
  for (const [id, re, what] of [
    ["BC-7f", /if \(suites\.problems\.length > 0\) \{\s*return fail\(2, \['REFUSED \(BAD_CHECK_CONFIG\)/, "a check configuration problem is silently dropped"],
    ["BC-7g", /REFUSED \(CHECK_SET_CHANGED\)/, "a check the run ran can vanish from the subject's checks"],
    ["BC-7h", /if \(after\.head !== subject \|\| !after\.reconciled\)/, "the subject is not re-pinned after the checks"],
  ]) {
    if (!re.test(prepare)) E(`${id}: closure prepare no longer refuses when ${what}`);
  }
  if (!/REFUSED \(FINDINGS_NOT_BOUND\)/.test(bound) || !/sha256\(findingsText\) !== recordedFindings/.test(bound)) {
    E("BC-7i: findings edited after the run are accepted as closure evidence");
  }
  if (!/REFUSED \(SUBJECT_NOT_FROM_RUN\)/.test(bound) || !/!isRunRecordPath\(l\) && !changed\.has\(l\)\);/.test(bound)) {
    E("BC-7j: the subject may carry changes the run did not make");
  }
  if (!/reviewsSource: 'worker-attested/.test(prepareFns[3])) E("BC-7k: the review claim is no longer labelled as the worker's");
  const wait = fnBody(closure, "awaitOwnerCommit") || "";
  if (!/for \(let i = 0; i < polls && !\(observed\.committed && observed\.matchesPresented\); i \+= 1\)/.test(wait)) {
    E("BC-7d: the owner-commit wait is no longer bounded by polls, or accepts something other than the presented commit");
  }
  if (!/MAX_OWNER_WAIT_MINUTES = 240;/.test(closure)) E("BC-7e: the owner-commit wait ceiling changed");

  // (8) THE IMPLEMENTER'S GRANT IS THE APPROVED writePaths, AND THE OLD ROUTES ARE GONE.
  const workers = files[WORKERS_REL];
  if (/WORKER_SOURCE_GRANTS|committedSourceGrants|worker-source-grant/.test(workers)) E("BC-8a: the retired source-grant route is back in the worker seam");
  if (!/export function toolGrantProblems\(args: readonly string\[\]\): readonly string\[\]/.test(workers)) {
    E("BC-8b: configuration may again be widened by a second grant source");
  }
  const judge = fnBody(workers, "judgeWritePath") || "";
  for (const [id, re, what] of [
    ["BC-8c", /rel\.startsWith\('\/'\) \|\| \/\^\[A-Za-z\]:\/\.test\(rel\)/, "absolute paths and drive letters"],
    ["BC-8d", /rel\.includes\(':'\)/, "alternate data streams"],
    ["BC-8e", /seg === '' \|\| seg === '\.' \|\| seg === '\.\.'/, "empty, dot and dot-dot segments"],
    ["BC-8f", /seg\.includes\('~'\)/, "8.3 short names"],
    ["BC-8g", /isSymbolicLink\(\)/, "links and junctions"],
    ["BC-8h", /differs in case from/, "case variants"],
    ["BC-8i", /if \(directory && FILE_ONLY_ROOTS\.some\(\(r\) => underOrEqual\(lower, r\) \|\| underOrEqual\(r, lower\)\)\) \{/, "directories that are, are inside, or contain governance roots"],
    ["BC-8j", /startsWith\(`\$\{absRoot\}\$\{sep\}`\)/, "paths that resolve outside the checkout"],
    ["BC-8q", /if \(!PATH_WORD\.test\(word\)\)/, "globs and characters outside the path alphabet"],
    ["BC-8s", /if \(!rel\.includes\('\/'\) && !word\.startsWith\('\.\/'\) && !statedDirectory\) \{\s*return fail\(`is a bare filename/, "bare filenames that may match at any depth"],
    ["BC-8t", /PROJECTOPS_DECLARABLE\.some\(/, "runtime records under .projectops"],
  ]) {
    if (!re.test(judge)) E(`${id}: the write grant no longer refuses ${what}`);
  }
  if (!/const PATH_WORD = \/\^\[A-Za-z0-9_\.\\-\/\\\\\]\+\$\/;/.test(workers)) {
    E("BC-8v: the path alphabet widened; a glob or lookalike can become part of a grant");
  }
  if (!/FILE_ONLY_ROOTS: readonly string\[\] = \['\.projectops', 'projectos\/validators', 'knowledge\/reports'\];/.test(workers)) {
    E("BC-8k: the file-only write roots changed");
  }
  if (!workers.includes("const NEVER_WRITABLE_SEGMENT = /^(?:\\.git.*|\\.claude|\\.husky|\\.vscode|con|prn|aux|nul|com\\d|lpt\\d)(?:\\..*)?$/i;") ||
      !/segments\.some\(\(seg\) => NEVER_WRITABLE_SEGMENT\.test\(seg\)\)/.test(judge)) {
    E("BC-8l: a repository database, hook or settings directory, or device name is writable by scope at some depth");
  }
  if (!/if \(isClosureTailPath\(rel, governed\)\) \{\s*return fail\(/.test(judge)) E("BC-8w: a closure record or the plan's governed state is grantable by scope");
  if (!/const PROJECTOPS_DECLARABLE: readonly string\[\] = \['\.projectops\/proof\/'\];/.test(workers)) {
    E("BC-8x: a governance trust root under .projectops is declarable by scope");
  }
  if (!/const inspected = inspectDirectory\(rel\);\s*if \(inspected === null\) return fail\(/.test(judge) || !/if \(inspected\.ignored\) \{\s*return fail\(/.test(judge) || !/if \(directory && inspected\.packageRoot\) \{\s*return fail\(/.test(judge)) {
    E("BC-8y: a directory grant can reach git-ignored output or a package root, or is granted when git cannot describe it");
  }
  const grantFn = fnBody(workers, "writePathGrants") || "";
  if (!/for \(const \[i, word\] of entries\.entries\(\)\) \{\s*if \(typeof word !== 'string' \|\| word === ''\) \{\s*problems\.push\(/.test(grantFn) ||
      !/const judged = judgeWritePath\(root, word, inspectDirectory, governed\);/.test(grantFn)) {
    E("BC-8z: a writePaths entry is no longer judged exactly as written, or a non-string entry is skipped instead of refused");
  }
  const declarable = (/const PROJECTOPS_DECLARABLE: readonly string\[\] = \[([\s\S]*?)\];/.exec(workers) || [])[1] || "";
  if (/execution|closure|validation|phases|gatekeeper-ledger|gatekeeper-decisions|gatekeeper-interactive|work\.v1|current-state/.test(declarable)) {
    E("BC-8u: a record the runtime writes is declarable by scope");
  }
  const runner = files[RUNNER_REL];
  if (!/const declaredWritePaths = phaseWritePaths\(context\.plan, phaseId\);/.test(runner) ||
      !/const writeGrant = writePathGrants\(root, declaredWritePaths\.entries, gitDirectoryInspector\(sys, root\), \[\s*\.\.\.\(memory\?\.planPath === undefined/.test(runner) ||
      !/\.\.\.\(memory\?\.currentStatePath === undefined \? \[\] : \[memory\.currentStatePath\]\)/.test(runner) ||
      !/const grantProblems = \[\.\.\.declaredWritePaths\.problems, \.\.\.writeGrant\.problems\];\s*if \(grantProblems\.length > 0\) \{\s*return refused\(/.test(runner) ||
      !/REFUSED \(WRITE_PATHS_REFUSED\)/.test(runner)) {
    E("BC-8m: the runner no longer derives the grant from the approved writePaths, or no longer refuses on a bad list");
  }
  // N7: new git-ignored content under a grant ends the run for the owner.
  if (!/const ignoredBefore = gitIgnoredUnder\(sys, root, attemptGranted\);/.test(runner) ||
      !/const ignoredAfter = gitIgnoredUnder\(sys, root, attemptGranted\);/.test(runner) ||
      !/if \(createdIgnored === null \|\| createdIgnored\.length > 0\) \{\s*stop = \{\s*code: 'SCOPE_DECISION',/.test(runner)) {
    E("BC-8aa: a worker can create git-ignored content under its grant without the run stopping");
  }
  if (!/const attemptGranted = grantedPaths\(argvGrants\(attemptWorker\.args\)\);/.test(runner)) {
    E("BC-8ab: the hidden-content snapshot no longer covers every write grant the worker holds");
  }
  if (!/if \(ignoredBefore === null\) \{[\s\S]{0,400}?code: 'SCOPE_DECISION',[\s\S]{0,300}?break;/.test(runner)) {
    E("BC-8ac: a worker is dispatched when git cannot take the before-picture");
  }
  const hidden = fnBody(workers, "gitIgnoredUnder") || "";
  if (!/l\.startsWith\('\?\? '\) && path\.endsWith\('\/'\)/.test(hidden) || !/path\.split\('\/'\)\.some\(\(seg\) => \/\^\\\.git\/i\.test\(seg\)\)/.test(hidden)) {
    E("BC-8ad: a nested repository or a new .git* file under a grant is no longer hidden content");
  }

  if (!/if \(directory && governed\.some\(\(g\) => underOrEqual\(/.test(judge)) E("BC-8af: a directory over a governed file is grantable");
  if (!/itself\.failure !== undefined/.test(fnBody(workers, "gitDirectoryInspector") || "")) {
    E("BC-8ag: a check-ignore that timed out or never started reads as 'not ignored'");
  }
  if (!/const attemptGrants = \[\.\.\.\(writeGrantSpent \? \[\] : writeGrant\.grants\), \.\.\.correctionGrants\];\s*writeGrantSpent = true;/.test(runner) ||
      (runner.match(/writeGrantSpent = /g) || []).length !== 2) {
    E("BC-8n: a correction dispatch can carry the implementer's write grant, or the first dispatch lost it");
  }
  if (read(RETIRED_GRANT_REL) !== null) E(`BC-8o: the retired ${RETIRED_GRANT_REL} is present again`);
  // THE WORKER ARGS ONLY: the Speed benchmark CHECK legitimately names its own script.
  let workerArgs = "";
  try {
    const cfg = JSON.parse(read(CONFIG_REL) || "{}");
    workerArgs = JSON.stringify(((cfg.execution || {}).workers || []).map((w) => w.args || []));
  } catch {
    E("BC-8p: the project configuration is not readable JSON");
  }
  if (/projectos\/speed|docs\/speed|validate-speed-/.test(workerArgs)) E("BC-8p: the worker configuration still carries the retired Speed grants");

  // (10) WRITE GRANTS ARE DATA; VALIDATORS JUDGE FROM THE BASE COMMIT — PROJECTOS-FINISH-WRITEPATHS1A.
  // FW-1: prose is no grant route. The negation list, the path-word parser and the scope reader are gone
  // from the worker seam, and the list reader reads `writePaths` alone.
  if (/\bNEGATION\b|scopePathWords|scopeWriteGrants|BARE_FILE/.test(workers)) E("FW-1a: a prose grant route (negation list, path-word parser or scope reader) is back in the worker seam");
  const listFn = fnBody(workers, "phaseWritePaths") || "";
  if (!/const raw = phase\?\.\['writePaths'\];/.test(listFn) || /scope/i.test(listFn) || /scope/i.test(grantFn)) {
    E("FW-1b: the write grant reads something other than the phase's writePaths");
  }
  if (!/if \(!Array\.isArray\(raw\)\) return \{ entries: \[\], problems: \[`phase \$\{phaseId\} declares writePaths that is not a list`\] \};/.test(listFn)) {
    E("FW-1c: a writePaths that is not a list reads as no paths instead of refusing");
  }
  if (/phaseScopeText\(context\.plan, phaseId\), gitDirectoryInspector/.test(runner)) E("FW-1d: the runner builds a grant from the scope text again");
  // FW-2: every validator check is built from a pin, and there is no unpinned way to build one.
  const checksFn = fnBody(verification, "checksFor") || "";
  if (!/configured: readonly ConfiguredCheck\[\],\s*pin: ValidatorPin,\s*\): readonly CheckSpec\[\]/.test(checksFn)) E("FW-2a: checksFor no longer requires a validator pin");
  if (!/args: \['--require', pin\.loader, script\],/.test(checksFn) || (checksFn.match(/args: \[script\]/g) || []).length !== 0) {
    E("FW-2b: a validator check can run the working tree's copy instead of the pinned one");
  }
  if (!/if \(!pin\.ok\) \{[\s\S]{0,300}?unrunnable:/.test(checksFn) || !/if \(!pin\.files\.has\(`\$\{PINNED_VALIDATOR_ROOT\}\/\$\{name\}\.cjs`\)\) \{[\s\S]{0,400}?unrunnable:/.test(checksFn)) {
    E("FW-2c: a validator absent from the base commit, or an unpinnable base, no longer makes the check unrunnable");
  }
  if (!/pin: ValidatorPin,\s*\): readonly CheckSpec\[\] \{\s*return checksFor\(sys, root, brief\.phase\.requiredValidators, configured, pin\);/.test(fnBody(verification, "requiredChecks") || "")) {
    E("FW-2d: requiredChecks no longer passes its pin through");
  }
  // FW-3: both call sites pin — the run to the brief's base commit, closure preparation to the run's.
  // (PROJECTOS-FINISH-CONTINUE-INTEGRITY1A adds the phase copy beside the pinned checks; CI-3 pins that.)
  if (!/withPinnedValidators\(sys, root, String\(brief\.repository\.head\), \(pin\) => \[\s*\.\.\.runChecks\(sys, root, requiredChecks\(sys, root, brief, suites\.checks, pin\)\),/.test(runner)) {
    E("FW-3a: the loop's checks are no longer pinned to the brief's base commit");
  }
  const prepareFn = fnBody(files[CLOSURE_REL], "closurePrepare") || "";
  if (!/const base = typeof run\['baseHead'\] === 'string' \? run\['baseHead'\] : '';\s*if \(!\/\^\[0-9a-f\]\{40\}\$\/\.test\(base\)\) \{\s*return fail\(2, \['REFUSED \(RUN_BASE_UNKNOWN\)/.test(prepareFn) ||
      !/withPinnedValidators\(sys, root, base, \(pin\) => \{[\s\S]{0,400}?const pinnedSpecs = checksFor\(sys, root, names\('requiredValidators'\), suites\.checks, pin\);/.test(prepareFn)) {
    E("FW-3b: closure preparation no longer runs the validators from the run's base commit");
  }
  // FW-4: the pin itself — what is pinned, from where, and that it cannot leak into the checkout.
  const pinned = files[PINNED_REL];
  if (!/export const PINNED_VALIDATOR_ROOT = 'projectos\/validators';/.test(pinned) || !/const PINNED_CODE = \/\\\.\(\?:js\|cjs\|json\)\$\/i;/.test(pinned)) {
    E("FW-4a: the pinned code set changed");
  }
  const pinFn = fnBody(pinned, "pinValidators") || "";
  if (!/if \(!\/\^\[0-9a-f\]\{40\}\$\/\.test\(commit\)\) return fail\(/.test(pinFn) || !/mkdtempSync\(join\(tmpdir\(\), 'projectos-pinned-'\)\)/.test(pinFn)) {
    E("FW-4b: the pin accepts a movable revision, or is written somewhere other than a fresh directory outside the checkout");
  }
  if (!/if \(blob\.code !== 0 \|\| blob\.failure !== undefined\) \{[\s\S]{0,200}?return fail\(/.test(pinFn)) E("FW-4c: a validator file git cannot show is skipped instead of failing the pin");
  // The loader is a template whose own lines start with `const`, so it is sliced to the next export.
  const loaderAt = pinned.indexOf("export function pinnedLoaderSource");
  const loaderSrc = loaderAt < 0 ? "" : pinned.slice(loaderAt, pinned.indexOf("export function pinValidators", loaderAt));
  if (!/Module\._extensions\[".js"\] = function/.test(loaderSrc) || !/Module\._extensions\[".json"\] = function/.test(loaderSrc) ||
      !/process\.env\.NODE_OPTIONS = /.test(loaderSrc) || !/is not in the phase's base commit/.test(loaderSrc) ||
      !/const p = pinnedPath\(filename\);\s*if \(p === null\) \{[\s\S]{0,240}?return js\(module, filename\);\s*\}\s*module\._compile\(fs\.readFileSync\(p, "utf8"\)/.test(loaderSrc) ||
      !/const p = pinnedPath\(filename\);\s*if \(p === null\) return json\(module, filename\);\s*module\.exports = JSON\.parse\(fs\.readFileSync\(p, "utf8"\)/.test(loaderSrc)) {
    E("FW-4d: the loader no longer compiles every pinned code file from the base commit, or no longer pins child processes");
  }
  // FW-4e (ECC SECURITY H1): a root reached through a junction or link still pins, and validator code the
  // loader cannot place under the root — or an entry it did not pin — refuses instead of loading the tree's copy.
  if (!/try \{ ROOTS\.push\(fs\.realpathSync\.native\(CFG\.root\)\); \} catch/.test(loaderSrc) ||
      !/if \(rel === null\) \{\s*if \(\/\[\\\\\\\\\/\]projectos\[\\\\\\\\\/\]validators\[\\\\\\\\\/\]\/i\.test\(abs\)\) \{\s*throw new Error\(/.test(loaderSrc) ||
      !/if \(p === null\) \{\s*if \(module\.id === "\."\) throw new Error\(/.test(loaderSrc)) {
    E("FW-4e: a governed root reached through a junction, or an unpinnable validator entry, falls through to the working tree's copy");
  }
  if (!/for \(const ext of Object\.keys\(Module\._extensions\)\) \{\s*if \(ext === "\.js" \|\| ext === "\.json"\) continue;[\s\S]{0,400}?throw new Error\(/.test(loaderSrc)) {
    E("FW-4f: validator code of another registered extension loads from the working tree instead of refusing");
  }
  if (!/\} catch \{\s*removeDir\(dir\);\s*return fail\('the pinned validators could not be written outside the checkout'\);/.test(pinFn)) {
    E("FW-4g: a pin that cannot be written throws out of the run, or leaves its directory behind");
  }
  // FW-7 (ECC SECURITY M3, M4): what a worker creates beneath a grant is held to the entry rules.
  const hiddenFn = fnBody(workers, "gitIgnoredUnder") || "";
  if (!/\.some\(\(seg\) => NEVER_WRITABLE_SEGMENT\.test\(seg\)\) \|\|\s*AGENT_INSTRUCTION_FILE\.test\(/.test(hiddenFn)) {
    E("FW-7a: a hook or settings directory or an agent instruction file created beneath a directory grant no longer stops the run");
  }
  if (!/if \(AGENT_INSTRUCTION_FILE\.test\(segments\[segments\.length - 1\] \?\? ''\)\) \{\s*return fail\(/.test(judge) ||
      !/const AGENT_INSTRUCTION_FILE = \/\^\(\?:CLAUDE\|AGENTS\|GEMINI\)\(\?:\\\.local\)\?\\\.md\$\/i;/.test(workers)) {
    E("FW-7b: an agent instruction file is grantable as a write path");
  }
  if (!/\.\.\.ignoredAfter\.filter\(\(p\) => !ignoredBefore\.includes\(p\)\), \.\.\.fileGrantsNotFiles\(root, argvGrants\(attemptWorker\.args\)\)\]/.test(runner) ||
      !/if \(!lstatSync\(resolvePath\(root, .*\.isFile\(\)\) out\.push\(rel\);/.test(fnBody(workers, "fileGrantsNotFiles") || "")) {
    E("FW-7c: a file grant the worker made into a directory no longer stops the run");
  }
  // FW-5: the plan carries writePaths exactly — engine, approval and schema.
  if (!/\.\.\.\(p\.writePaths === undefined \? \{\} : \{ writePaths: Array\.isArray\(p\.writePaths\) \? p\.writePaths\.slice\(\) : p\.writePaths \}\),/.test(files[ENGINE_REL])) {
    E("FW-5a: the plan engine no longer carries writePaths exactly as stated");
  }
  if (!/problems\.push\(`phase \$\{id\} declares writePaths that is not a list of non-empty path strings`\);/.test(files[PLAN_APPROVAL_REL])) {
    E("FW-5b: plan approval accepts a writePaths list the runtime could not use as written");
  }
  try {
    const schema = JSON.parse(read(SCHEMA_REL) || "{}");
    const wp = (((schema.properties || {}).phases || {}).items || {}).properties || {};
    if (!wp.writePaths || wp.writePaths.type !== "array" || (wp.writePaths.items || {}).minLength !== 1) E("FW-5c: the plan schema no longer types writePaths as a list of non-empty strings");
  } catch {
    E("FW-5c: the plan schema is not readable JSON");
  }
  // FW-6: the plan v1.9 phases themselves carry writePaths.
  try {
    const finish = JSON.parse(read(FINISH_PLAN_REL) || "{}");
    const phases = Array.isArray(finish.phases) ? finish.phases : [];
    if (phases.length === 0 || phases.some((p) => !Array.isArray(p.writePaths) || p.writePaths.length === 0)) E("FW-6: a plan v1.9 phase carries no writePaths");
  } catch {
    E("FW-6: the plan v1.9 source is not readable JSON");
  }

  // (11) CLOSURE FOR ANY GOVERNED PROJECT; ONE OWNER COMMIT PER PHASE — PROJECTOS-FINISH-MULTIPROJECT1A.
  const eligibility = files[ELIGIBILITY_REL];
  if (!/check\(\s*'G4-1',\s*facts\.governedProjectId\.trim\(\) !== '' && facts\.planProjectId === facts\.governedProjectId,/.test(eligibility) ||
      /=== 'projectos'/.test(eligibility)) {
    E("MP-1: G4-1 no longer judges the governed project by its own id, or is scoped to one project again");
  }
  const technical = files[TECHNICAL_REL];
  const ownFn = fnBody(technical, "commitOwnRecords") || "";
  if (!/const ownerOnly = enforcedOwnerOnlyActions\(request\.phaseOwnerGates, technicalDelegationCondition\(request\.delegation\)\)/.test(ownFn) ||
      !/const reserved = \['commit', 'push'\]\.filter\(\(a\) => ownerOnly\.includes\(a\)\);\s*if \(reserved\.length > 0\) \{\s*return \{ kind: 'RESERVED'/.test(ownFn)) {
    E("MP-2a: ProjectOS commits its records when the phase or the constitutional floor reserves commit or push");
  }
  const foreignAt = ownFn.search(/const foreign = dirty\.filter\(\(p\) => p\.endsWith\('\/'\) \|\| !request\.isOwnRecord\(p\)\);\s*if \(foreign\.length > 0\) \{\s*return refuseNow\(/);
  const addAt = ownFn.indexOf("'add'");
  if (foreignAt < 0 || addAt < 0 || foreignAt > addAt) E("MP-2b: a records commit can carry a path that is not one of the caller's records");
  const aheadAt = ownFn.search(/if \(m\[1\] !== '0' \|\| m\[2\] !== '0'\) \{/);
  if (aheadAt < 0 || addAt < 0 || aheadAt > addAt) E("MP-2c: a records commit can be made on a head the remote does not already hold");
  if (!/const parent = git\(sys, root, \['rev-parse', 'HEAD~1'\]\);\s*if \(!parent\.ok \|\| parent\.out !== head\.out\) \{/.test(ownFn) ||
      !/const upstream = `refs\/remotes\/\$\{expectedRemote\}\/\$\{expectedBranch\}`;/.test(ownFn)) {
    E("MP-2f: the records push can carry a commit other than the records commit, or reads a shadowable remote ref");
  }
  if (!/p\.endsWith\('\/'\) \|\| !request\.isOwnRecord\(p\)/.test(ownFn) || (ownFn.match(/'--literal-pathspecs'/g) || []).length < 3) {
    E("MP-2g: a directory entry can be a record, or a record path is read as a pathspec pattern");
  }
  // MP-7 (ECC SECURITY M1): every ProjectOS commit carries the implementer identity the owner check refuses.
  // The identity is named once; PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A exports it for the grant's exact match.
  if (!/export const PROJECTOS_COMMIT_NAME = 'ProjectOS implementer';/.test(technical) ||
      !/export const PROJECTOS_COMMIT_EMAIL = 'projectos-implementer@projectos\.invalid';/.test(technical) ||
      !/const PROJECTOS_COMMIT_IDENTITY: readonly string\[\] = \['-c', `user\.name=\$\{PROJECTOS_COMMIT_NAME\}`, '-c', `user\.email=\$\{PROJECTOS_COMMIT_EMAIL\}`\];/.test(technical) ||
      (technical.match(/\.\.\.PROJECTOS_COMMIT_IDENTITY, /g) || []).length !== 2 ||
      (technical.match(/'commit', '-m'/g) || []).length !== 2) {
    E("MP-7: a ProjectOS commit can carry the checkout's (owner's) identity");
  }
  if (/--all|--force|-A'|'\.'/.test(ownFn) || !/\['--literal-pathspecs', '-C', root, 'add', '--', \.\.\.dirty\]/.test(ownFn) ||
      !/\[\.\.\.PROJECTOS_COMMIT_IDENTITY, '--literal-pathspecs', '-C', root, 'commit', '-m', message, '--', \.\.\.dirty\]/.test(ownFn)) {
    E("MP-2d: the records commit stages or commits anything but the exact record paths");
  }
  if (!/return classifyOwnerGates\(malformed \? \[\.\.\.read, 'the declared owner gates could not be read'\] : read\);/.test(fnBody(technical, "ownerGatesOfPlanPhase") || "")) {
    E("MP-2e: an unreadable owner-gate list no longer reserves every technical action");
  }
  const prepareCommit = fnBody(files[CLOSURE_REL], "closurePrepare") || "";
  if (!/const tail = new Set\(\[`\.projectops\/validation\/\$\{subject\}\.json`, `\.projectops\/closure\/\$\{id\}\.json`, closureReportRelPath\(id\)\]\);\s*const committed = commitOwnRecordsFor\(sys, root, gc\.context, id, 'closure-tail', \(p\) => tail\.has\(p\)\);/.test(prepareCommit)) {
    E("MP-3: closure prepare commits something other than exactly its three closure-tail records");
  }
  const run = files[RUN_REL];
  // MP-4 (ECC SECURITY H1, ECC CODE M1): the fold runs only after an approved technical continuation —
  // no stop, not degraded, HEAD moved — and carries only the writers' own record shapes.
  if (!/if \(!result\.ok \|\| dryRun \|\| result\.stop !== null \|\| result\.degraded !== undefined\) return result;/.test(run) ||
      !/if \(!\/\^\[0-9a-f\]\{40\}\$\/\.test\(headAfter\) \|\| headAfter === headBefore\) return result;\s*return foldRunRecords\(ctx, result\);/.test(run) ||
      !/commitOwnRecordsFor\(ctx\.sys, ctx\.root, gc\.context, result\.phaseId, 'run-records', \(p\) => isFoldableRunRecord\(p, result\.phaseId, stateTail\)\)/.test(fnBody(run, "foldRunRecords") || "")) {
    E("MP-4: the run's records are folded after a stopped, degraded or commit-less run, or by a classifier other than the exact record shapes");
  }
  // MP-5: the fold classifier admits neither worker-written bytes nor any closure or authority record.
  const foldable = fnBody(run, "isFoldableRunRecord") || "";
  if (foldable === "" || /findings|effects|degraded|closure|decision|gates|authority/i.test(foldable.replace(/GATEKEEPER_DECISIONS_REL/g, "")) ||
      !foldable.includes("inFlat('.projectops/execution', /^[A-Za-z0-9_.-]{1,200}\\.(?:brief|session|evidence|invocation)\\.json$/)") ||
      !/if \(p\.includes\('\.\.'\) \|\| p\.endsWith\('\/'\)\) return false;/.test(foldable)) {
    E("MP-5: the fold classifier admits worker-written findings or effects, a degraded-use record, a closure or authority record, or a directory");
  }
  // MP-6: closure PREPARE commits only its closure-tail records, and only when every check passed. Request and
  // resume commit only the grant-gated kinds (ZT-2) — request the closure decision, resume the persisted close
  // (PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A); without the owner's grant both commit nothing.
  const closureSrc = files[CLOSURE_REL];
  const kindsIn = (fn) => ((fnBody(closureSrc, fn) || "").match(/commitOwnRecordsFor\([^)]*?'[a-z-]+'/g) || []).map((m) => m.slice(m.lastIndexOf("'", m.length - 2) + 1, -1));
  if ((closureSrc.match(/commitOwnRecordsFor\(/g) || []).length !== 3 ||
      JSON.stringify(kindsIn("closureRequest")) !== JSON.stringify(["closure-decision"]) ||
      JSON.stringify(kindsIn("closureResume")) !== JSON.stringify(["post-close"]) ||
      !/if \(!results\.every\(\(r\) => r\.passed\)\) return written;\s*const tail = new Set/.test(prepareCommit)) {
    E("MP-6: a closure step other than prepare commits, or prepare commits a failing record");
  }

  // (12) THE GATEKEEPER ANSWERS WITHOUT A RELAY THROUGH THE TRUSTED BROKER — PROJECTOS-FINISH-API-GATEKEEPER1A.
  // AG-1: the run composes the broker ONLY on the committed opt-in, in the pre-hybrid shape (no `mode`,
  // which means Host-attested); otherwise `mode: 'unattended'` with the Host route or nothing. Both at
  // once refuses. The agent's own resolver refuses by construction.
  const compose = fnBody(run, "composeGatekeeper") || "";
  if (!/const brokerRoute = brokerRouteOptedIn\(ctx\.sys, ctx\.root\);\s*if \(brokerRoute && hostReview !== undefined\) \{\s*return \{\s*ok: false,/.test(compose) ||
      !/\.\.\.\(brokerRoute\s*\?\s*\{ broker: trustedBroker\(ctx\.sys, ctx\.root, governedProjectId\(ctx\)\) \}\s*:\s*\{ mode: 'unattended' as const, \.\.\.\(hostReview === undefined \? \{\} : \{ hostReview \}\) \}\),/.test(compose) ||
      !/resolver: unprovisionedResolver\(/.test(compose)) {
    E("AG-1: the run composes the broker without the committed opt-in, beside a Host route, in Host-attested mode, or with a resolver that can resolve a credential");
  }
  // AG-2: one broker composition — the trusted installation transport, asked about THIS project first.
  const brokerFn = fnBody(run, "trustedBroker") || "";
  if (!/transport: nodeBrokeredTransport\(sys, nodeProjectosRuntime\(\)\),/.test(brokerFn) ||
      !/governedRoot: root,/.test(brokerFn) ||
      !/installationAllows: \(\) => installationAllowsProject\(sys, nodeProjectosRuntime\(\), root, projectId\),/.test(brokerFn) ||
      /process\.env|apiKey|Authorization|Bearer/i.test(brokerFn)) {
    E("AG-2: the broker is not the trusted installation transport asked about this project first, or reads a credential itself");
  }
  // AG-6 (ECC SECURITY M2): the opt-in is the COMMITTED configuration AND the working copy, exactly.
  const optIn = fnBody(run, "brokerRouteOptedIn") || "";
  if (!/sys\.exec\('git', \['-C', root, 'show', 'HEAD:\.\/\.projectops\/gatekeeper\.json'\]\)/.test(optIn) ||
      !/committed\.code === 0 &&\s*routeOf\(committed\.stdout\) === INSTALLATION_BROKER_ROUTE &&\s*routeOf\(sys\.readText\(join\(root, '\.projectops', 'gatekeeper\.json'\)\)\) === INSTALLATION_BROKER_ROUTE/.test(optIn) ||
      !/export const INSTALLATION_BROKER_ROUTE = 'installation-broker';/.test(run)) {
    E("AG-6: the broker route no longer needs the owner's committed opt-in in both the commit and the working copy");
  }
  // AG-3: closure uses the same opt-in and the same broker, never beside a Host route.
  const closureSrc12 = files[CLOSURE_REL];
  const closureDeps = fnBody(closureSrc12, "productionClosureDeps") || "";
  if (!/\.\.\.\(args\.hostReview === undefined && brokerRouteOptedIn\(sys, root\)\s*\?\s*\{ broker: trustedBroker\(sys, root, args\.projectId\) \}\s*:\s*\{ mode: 'unattended' as const, \.\.\.\(args\.hostReview === undefined \? \{\} : \{ hostReview: args\.hostReview \}\) \}\),/.test(closureDeps) ||
      !/resolver: unprovisionedResolver\(/.test(closureDeps) || /process\.env|apiKey|Bearer|nodeBrokeredTransport/i.test(closureDeps) ||
      !/if \(hostClosureReview !== undefined && brokerRouteOptedIn\(sys, root\)\) \{\s*return fail\(2, \[/.test(closureSrc12)) {
    E("AG-3: closure composes the broker without the opt-in, beside a Host route, in Host-attested mode, by its own transport, or with a resolver that can resolve a credential");
  }
  // AG-4: degraded-mode reconciliation composes no paid route of any kind.
  if (/nodeBrokeredTransport|installationAllowsProject|trustedBroker|brokerRouteOptedIn|\bbroker\b/.test(files[RECONCILE_REL])) {
    E("AG-4: degraded-mode reconciliation now composes a paid route");
  }
  // AG-5: the installation allowlist is exactly ProjectOS and the agency project.
  try {
    const allow = JSON.parse(read(ALLOWLIST_REL) || "{}");
    const ids = (allow.projects || []).map((p) => `${p.projectId}@${p.repository}@${p.governedRoot}`).sort();
    const want = ["projectos@github.com/universalbizcomply/ProjectOS@C:/dev/ProjectOS", "seo-agency@127.0.0.1:47900/SEOAgency-remote/seo-agency@C:/dev/SEOAgency"];
    if (JSON.stringify(ids) !== JSON.stringify(want)) E(`AG-5: the installation allowlist is not exactly ProjectOS and the agency project (${ids.join(", ")})`);
  } catch {
    E("AG-5: the installation allowlist is not readable JSON");
  }

  // (13) ZERO-TOUCH CLOSURE — PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A.
  const zt = {};
  for (const rel of [CORE_AUTHORITY_REL, CORE_TRANSPORT_REL, CLOSURE_WAIT_REL, CLOSURE_TURN_REL, GK_CONFIG_REL]) {
    const raw = read(rel);
    zt[rel] = raw === null ? "" : code(raw.replace(/\r\n/g, "\n"));
    if (raw === null) E(`ZT: ${rel} is missing`);
  }
  // ZT-1: the owner's grant is a delegable scope that is NOT a closure scope, so on its own it closes nothing.
  const authority = zt[CORE_AUTHORITY_REL];
  const closureScopes = /export const CLOSURE_SCOPES[^;]*;/.exec(authority);
  if (!/export const CLOSURE_DECISION_COMMIT_SCOPE = 'closure-decision-commit';/.test(authority) ||
      !/DELEGABLE_SCOPES: readonly DelegableScope\[\] = \[[^\]]*CLOSURE_DECISION_COMMIT_SCOPE,?\s*\]/.test(authority) ||
      closureScopes === null || /closure-decision-commit|CLOSURE_DECISION_COMMIT_SCOPE/.test(closureScopes[0])) {
    E("ZT-1: closure-decision-commit is not a delegable scope outside the closure scopes");
  }
  // ZT-2: the closure kinds are committed only with the grant, on top of commit and push, and the grant
  // is read only for those kinds, from the committed delegation by the one reader.
  const technical13 = files[TECHNICAL_REL];
  const ownRecords = fnBody(technical13, "commitOwnRecords") || "";
  const reservedAt = ownRecords.indexOf("if (reserved.length > 0)");
  const grantAt = ownRecords.indexOf("if (CLOSURE_COMMIT_KINDS.includes(request.kind) && request.closureCommit?.granted !== true) {");
  if (reservedAt < 0 || grantAt < reservedAt || !/const CLOSURE_COMMIT_KINDS: readonly OwnRecordsKind\[\] = \['closure-decision', 'post-close'\];/.test(technical13) ||
      !/closureCommit\?\.granted !== true\) \{\s*return \{\s*kind: 'RESERVED',/.test(ownRecords) ||
      !/\.\.\.\(CLOSURE_COMMIT_KINDS\.includes\(kind\) \? \{ closureCommit: resolveClosureCommitDelegation\(sys, root, programme\) \} : \{\}\),/.test(fnBody(technical13, "commitOwnRecordsFor") || "")) {
    E("ZT-2: ProjectOS can commit a closure decision without the owner's grant, or before the commit and push reservation");
  }
  // ...and counts only when the OWNER made the last commit to the delegation (ECC SECURITY H1): judged by
  // the owner-commit rule with no exception passed, so a delegation ProjectOS committed grants nothing.
  const zeroTouchGrantFn = fnBody(zt[GK_CONFIG_REL], "resolveClosureCommitDelegation") || "";
  if (!/const judged = resolveDelegatedDecider\(sys, root, programmeId, CLOSURE_DECISION_COMMIT_SCOPE\);\s*if \(!judged\.ok\) return \{ granted: false, problems: judged\.problems \};/.test(zeroTouchGrantFn) ||
      !/const authored = ownerCommitIdentityProblems\(commitIdentityOf\(sys, root, CLOSURE_DELEGATION_REL\), owner, null\);\s*if \(authored\.length > 0\) \{\s*return \{\s*granted: false,/.test(zeroTouchGrantFn) ||
      !/const CLOSURE_DELEGATION_REL = '\.projectops\/authority\/closure-delegation\.json';/.test(zt[GK_CONFIG_REL])) {
    E("ZT-2: the grant is not judged from the committed delegation by the one reader, or counts without the owner's own commit of it");
  }
  // ZT-3: the one non-owner identity the commit check accepts is exactly the one passed, name AND email,
  // and only when passed; every other implementer-shaped identity is still refused after it.
  const identityFn = fnBody(zt[CLOSURE_WAIT_REL], "ownerCommitIdentityProblems") || "";
  const exceptionAt = identityFn.indexOf("if (delegatedCommitter !== null && identity.name === delegatedCommitter.name && identity.email === delegatedCommitter.email) {");
  const implementerAt = identityFn.indexOf("if (isImplementerName(identity.name) || isImplementerName(identity.email)) {");
  if (exceptionAt < 0 || implementerAt < exceptionAt || !/delegatedCommitter: DelegatedCommitter \| null = null,/.test(identityFn)) {
    E("ZT-3: the owner-commit check accepts a non-owner identity other than exactly the granted ProjectOS one");
  }
  // ZT-4: closure passes that identity only under the grant and never for an interactive wait; ProjectOS
  // self-commits only an UNATTENDED answer (ECC SECURITY C1), and only the presented bundle and the exact
  // post-close records (ECC SECURITY M2: the two path sets are pinned whole).
  const closure13 = files[CLOSURE_REL];
  const resume13 = fnBody(closure13, "closureResume") || "";
  const request13 = fnBody(closure13, "closureRequest") || "";
  if (!/const answeredInCall =\s*committedMode\.ok &&\s*committedMode\.mode === 'unattended' &&\s*\(waiting\.provenance === 'HostIndependentProviderAttestation' \|\| \(waiting\.provenance === undefined && brokerRouteOptedIn\(sys, root\)\)\);/.test(resume13) ||
      !/const committedMode = resolveGatekeeperMode\(sys, root\);/.test(resume13) ||
      !/const delegatedCommitter = grant\.granted && answeredInCall \? \{ name: PROJECTOS_COMMIT_NAME, email: PROJECTOS_COMMIT_EMAIL \} : null;/.test(resume13) ||
      !/observeOwnerCommit\(sys, root, waiting, planOwner\(gc\.context\.plan\), delegatedCommitter\)/.test(resume13) ||
      !/const tail = new Set\(\[closureDecisionRelPath\(id\), `\.projectops\/phases\/\$\{id\}\.json`, DEFAULT_STATE_REL, \.\.\.programmeStateTailPaths\(gc\.context\)\]\);/.test(resume13) ||
      !/const persisted = grant\.granted\s*\?\s*ownRecordsLines\(commitOwnRecordsFor\(sys, root, gc\.context, id, 'post-close', \(p\) => tail\.has\(p\)\), 'post-close'\)/.test(resume13) ||
      !/if \(modeResolution\.mode !== 'unattended' \|\| !closureCommitGrant\(sys, root, gc\.context\)\.granted\) \{\s*return ok\(\[\.\.\.trace, '', \.\.\.ownerAskLines\(wait\)\]\);/.test(request13) ||
      !/const bundlePaths = new Set\(bundle\.entries\.map\(\(b\) => b\.path\)\);/.test(request13) ||
      !/commitOwnRecordsFor\(sys, root, gc\.context, id, 'closure-decision', \(p\) => bundlePaths\.has\(p\)\)/.test(request13) ||
      !/const DEFAULT_STATE_REL = '\.projectops\/current-state\.json';/.test(closure13)) {
    E("ZT-4: closure commits or accepts a ProjectOS closure commit without the owner's grant, for an interactive answer, or beyond the presented bundle and the post-close records");
  }
  // ZT-6: the closure prompt tells the authority the time of the question, in the priced and the sent body alike.
  const responses13 = read(CLOSURE_RESPONSES_REL);
  const respCode = responses13 === null ? "" : code(responses13.replace(/\r\n/g, "\n"));
  if (!/instructions: closureSystemInstruction\(request, config\.askedAt\),/.test(respCode) ||
      !/at or just after \$\{askedAt\}, the time this question was asked/.test(respCode) ||
      ((zt[CLOSURE_TURN_REL].match(/^\s*askedAt: input\.at,$/gm) || []).length !== 2)) {
    E("ZT-6: the closure prompt no longer tells the authority when the question was asked, or the priced and sent bodies differ");
  }
  // ZT-5: a closure answer's decidedAt is judged against the window of its question, and an answer
  // produced in the call is held to the lower bound.
  if (!/const when = decidedAtProblem\(decidedAt, expect\.decidedAtWindow\);/.test(fnBody(zt[CORE_TRANSPORT_REL], "checkClosureResponse") || "") ||
      !/if \(window\.answeredInCall && decided < asked - DECIDED_AT_SKEW_MS\) \{/.test(zt[CORE_TRANSPORT_REL])) {
    E("ZT-5: a closure answer's decidedAt is no longer judged against the window of its question");
  }
  const turn13 = zt[CLOSURE_TURN_REL];
  if (!/decidedAtWindow: \{ askedAt: input\.at, answeredInCall \},/.test(turn13) ||
      !/checkClosureResponse\(record, closureExpectations\(input, request, deps\.consumedDecisionIds, true\)\)/.test(fnBody(turn13, "takeClosureTurn") || "") ||
      !/checkClosureResponse\(record, closureExpectations\(input, request, deps\.consumedDecisionIds, false\)\)/.test(fnBody(turn13, "takeInteractiveClosureTurn") || "")) {
    E("ZT-5: the closure turn no longer gives the decision-time window, or marks the wrong route as answered in the call");
  }

  // (14) ONE CONTINUE REACHES CLOSED; A PHASE CANNOT GRADE ITS OWN NEW CHECK WITH THE OLD ONE —
  // PROJECTOS-FINISH-CONTINUE-INTEGRITY1A.
  // CI-1 (D7): a preparation that committed its records carries on into the request, once; a failed
  // preparation, or records left uncommitted, stops as before.
  const dispatch14 = fnBody(files[RUN_REL], "dispatchContinueRoute") || "";
  if (!/const prepared = closurePrepare\(ctx, \{ id: route\.phaseId \}\);\s*if \(prepared\.code !== 0\) return prepared;\s*const next = closureRouteFor\(ctx, route\.phaseId\);\s*if \(next\.kind === 'refused'\) return \{ code: prepared\.code, lines: \[\.\.\.prepared\.lines, '', \.\.\.next\.lines\] \};\s*if \(next\.kind !== 'closure-request'\) return prepared;\s*const asked = closureRequest\(ctx, continueForwarded\(flags, \{ id: next\.phaseId, execute: true \}\)\);/.test(dispatch14) ||
      // "Committed" is what the route's own clean-tree requirement means (ECC SECURITY round 1, L2).
      !/return closurePrepared\(ctx, gc\.context, phaseId\) \? \{ kind: 'closure-request', phaseId \} : \{ kind: 'closure-prepare', phaseId \};/.test(files[RUN_REL])) {
    E("CI-1: continue no longer carries a committed preparation into the closure request, or carries one that failed or was not committed");
  }
  // CI-2 (D8): the phase copy is selected only for a SAFE required validator name its write paths cover,
  // and runs the subject's file without the pin loader, under its own id.
  const phaseCopy = fnBody(files[VERIFICATION_REL], "phaseCopyChecks") || "";
  if (!/\.filter\(\(name\) => SAFE_VALIDATOR_NAME\.test\(name\) && covered\(`projectos\/validators\/\$\{name\}\.cjs`\)\)/.test(phaseCopy) ||
      !/id: `\$\{name\}\$\{PHASE_COPY_SUFFIX\}`,/.test(phaseCopy) ||
      !/args: \[script\],/.test(phaseCopy) || /--require/.test(phaseCopy) ||
      // The pinned node runner and a short bound (ECC SECURITY round 1, M1 and M2); an exact-file match only.
      !/command: VALIDATOR_RUNNER,/.test(phaseCopy) || !/timeoutMs: PHASE_COPY_TIMEOUT_MS,/.test(phaseCopy) ||
      !phaseCopy.includes("const covered = (rel: string): boolean => paths.some((p) => p.replace(/\\\\/g, '/').replace(/^\\.[/]/, '') === rel);") ||
      !/export const PHASE_COPY_SUFFIX = '@phase-copy';/.test(files[VERIFICATION_REL]) ||
      !/export const PHASE_COPY_TIMEOUT_MS = 10 \* 60_000;/.test(files[VERIFICATION_REL])) {
    E("CI-2: the phase copy of a granted validator is selected wrongly, run with the pin, unbounded, by another runner, or reported under the base copy's id");
  }
  // CI-3 (D8): it is ADDED to the pinned checks, in the run and in closure preparation alike, through the
  // runner that fails a copy which changed the checkout (ECC SECURITY round 1, M1).
  const copyRunner = fnBody(files[VERIFICATION_REL], "runPhaseCopyChecks") || "";
  if (!/\.\.\.runPhaseCopyChecks\(sys, root, phaseCopyChecks\(sys, root, brief\.phase\.requiredValidators, writeGrant\.paths\)\),/.test(files[RUNNER_REL]) ||
      !/const writePaths = phaseWritePaths\(gc\.context\.plan, id\)\.entries\.filter\(\(p\): p is string => typeof p === 'string'\);/.test(fnBody(files[CLOSURE_REL], "closurePrepare") || "") ||
      !/const copySpecs = phaseCopyChecks\(sys, root, names\('requiredValidators'\), writePaths\);/.test(fnBody(files[CLOSURE_REL], "closurePrepare") || "") ||
      !/return \[\.\.\.runChecks\(sys, root, pinnedSpecs\), \.\.\.runPhaseCopyChecks\(sys, root, copySpecs\)\];/.test(fnBody(files[CLOSURE_REL], "closurePrepare") || "") ||
      !/'status', '--porcelain', '--ignored', '--untracked-files=all'\], \{\s*maxOutputBytes: PHASE_COPY_PICTURE_MAX_BYTES,\s*\}\)/.test(copyRunner) ||
      !/export const PHASE_COPY_PICTURE_MAX_BYTES = 256 \* 1024 \* 1024;/.test(files[VERIFICATION_REL]) ||
      !/if \(before !== null && after !== null && before === after\) return result;\s*return \{\s*\.\.\.result,\s*passed: false,/.test(copyRunner)) {
    E("CI-3: the phase copy is not added to the pinned checks in both the run and closure preparation, or a copy that changed the checkout can pass");
  }

  // (9) PROVEN.
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      E(`BC-9: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) E(`BC-9: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-boot-continue1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-boot-continue1a: PASS");
}

module.exports = { run, TESTS };
