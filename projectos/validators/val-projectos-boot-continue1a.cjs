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
  ],
  "projectos/agent/test/closureEndToEnd.test.ts": ["waits, boundedly, for the owner commit", "projectos continue routes on recorded state"],
  "projectos/agent/test/loopToolGrants.test.ts": ["passes through a link", "differs in case", "the retired source grant", "the execution records directory", "a star glob", "also excludes", "git-ignored output", "the closure delegation", "governed files", "Hands off"],
  "projectos/agent/test/loopRunner.test.ts": ["FIRST dispatch only"],
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
  for (const rel of [BRIEF_REL, CLOSURE_GATE_REL, VERIFICATION_REL, HANDOFF_REL, CONTINUATION_REL, RUN_REL, CLOSURE_REL, WORKERS_REL, RUNNER_REL, RECONCILE_REL]) {
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

  // (8) THE IMPLEMENTER'S GRANT IS THE APPROVED SCOPE, AND THE OLD ROUTE IS GONE.
  const workers = files[WORKERS_REL];
  if (/WORKER_SOURCE_GRANTS|committedSourceGrants|worker-source-grant/.test(workers)) E("BC-8a: the retired source-grant route is back in the worker seam");
  if (!/export function toolGrantProblems\(args: readonly string\[\]\): readonly string\[\]/.test(workers)) {
    E("BC-8b: configuration may again be widened by a second grant source");
  }
  const judge = fnBody(workers, "judgeScopePath") || "";
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
    ["BC-8r", /if \(NEGATION\.test\(scope\)\)/, "paths in a scope that also excludes"],
    ["BC-8s", /if \(!rel\.includes\('\/'\) && !word\.startsWith\('\.\/'\) && !statedDirectory\) \{\s*return fail\(`is a bare filename/, "bare filenames that may match at any depth"],
    ["BC-8t", /PROJECTOPS_DECLARABLE\.some\(/, "runtime records under .projectops"],
  ]) {
    if (!re.test(judge)) E(`${id}: the scope grant no longer refuses ${what}`);
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
  if (!/const judged = judgeScopePath\(root, word, scope, inspectDirectory, governed\);/.test(fnBody(workers, "scopeWriteGrants") || "")) {
    E("BC-8z: the exclusion test no longer reads the WHOLE scope");
  }
  const declarable = (/const PROJECTOPS_DECLARABLE: readonly string\[\] = \[([\s\S]*?)\];/.exec(workers) || [])[1] || "";
  if (/execution|closure|validation|phases|gatekeeper-ledger|gatekeeper-decisions|gatekeeper-interactive|work\.v1|current-state/.test(declarable)) {
    E("BC-8u: a record the runtime writes is declarable by scope");
  }
  const runner = files[RUNNER_REL];
  if (!/const scopeGrant = scopeWriteGrants\(root, phaseScopeText\(context\.plan, phaseId\), gitDirectoryInspector\(sys, root\), \[\s*\.\.\.\(memory\?\.planPath === undefined/.test(runner) ||
      !/\.\.\.\(memory\?\.currentStatePath === undefined \? \[\] : \[memory\.currentStatePath\]\)/.test(runner) ||
      !/REFUSED \(SCOPE_WRITE_GRANT_REFUSED\)/.test(runner)) {
    E("BC-8m: the runner no longer derives the grant from the approved scope, or no longer refuses on a bad one");
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
  if (!/n\['’\]t\\b/.test(workers)) E("BC-8ae: a typographic apostrophe defeats the exclusion test");
  if (!/if \(directory && governed\.some\(\(g\) => underOrEqual\(/.test(judge)) E("BC-8af: a directory over a governed file is grantable");
  if (!/itself\.failure !== undefined/.test(fnBody(workers, "gitDirectoryInspector") || "")) {
    E("BC-8ag: a check-ignore that timed out or never started reads as 'not ignored'");
  }
  if (!/const attemptGrants = \[\.\.\.\(scopeGrantSpent \? \[\] : scopeGrant\.grants\), \.\.\.correctionGrants\];\s*scopeGrantSpent = true;/.test(runner) ||
      (runner.match(/scopeGrantSpent = /g) || []).length !== 2) {
    E("BC-8n: a correction dispatch can carry the implementer's scope grant, or the first dispatch lost it");
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
