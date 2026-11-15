#!/usr/bin/env node
/**
 * PROJECTOS-MEMORY-EXIT-PROOF1A (plan v1.36, last phase) - the Stage 3 exit proof, judged over the recorded evidence.
 *
 * WHAT THIS PINS. On 2026-11-15 a governed phase (SEO-AGENCY-MEMORY-PROOF1A) ran live on the agency project: run 1 was killed after the
 * worker wrote one of three files, and ONE fresh `projectos continue --execute` (a different process, a different parent, no session, no
 * objective, no note) resumed it, got an independent APPROVE from a different provider, the gatekeeper approved, ProjectOS committed, and
 * the closure authority closed it. The raw records are committed under docs/finish/PROJECTOS-MEMORY-EXIT-PROOF1A/. Each rule below is one
 * way that story could be false, written as a pure function over an in-memory bundle of those records. Each rule has named mutations: an
 * edit of a deep copy of the bundle that makes the wrong thing true, which the rule must refuse. A mutation counts only when its OWN rule
 * fires (and, where one change is wrong for two rules, exactly the rules named). Mutations are named after the BODY of the rule they break.
 *
 *   EP-1  "the files are the files"            a committed manifest of sha256 covers every evidence file; a changed, added or missing file fails
 *   EP-2  "it was cut off partway"              run 1 was killed with a non-zero exit, left a non-terminal work record, and never reached review
 *   EP-3  "a fresh process, nothing relayed"    one bare `continue --execute` from another process; no session, objective or note anywhere
 *   EP-4  "the retrieved state was used"        the ledger chain verifies; run 2 was shown the cut-off state, run 1 could not have been
 *   EP-5  "worker text is not a decision"       every resumed item ranks below every decision and plan memory, is never labelled committed
 *   EP-6  "it reached closed by itself"         validators, a different-provider APPROVE, the gatekeeper and the closure authority, no owner act
 *   EP-7  "the broker meter says what it said"  the METERED BROKER spend (gatekeeper and closure calls) in the gatekeeper ledger equals the log and stays under the $1.50 cap; worker and reviewer CLI costs are not metered here
 *   EP-8  "this phase changes no product"       the notes say so, and this validator reads files and nothing else
 *   EP-9  "register it last"                    both runners run this file once, as the last entry, in the same order
 *
 * WHAT IT CANNOT CATCH. Someone who edits the logs and records consistently and re-seals the manifest and the notes hashes together passes
 * every rule: the mutations hard-code the real pids and costs, which is a brake for accident, not a defence against a forger.
 *
 * Reads files only. A green proof does not lift D4.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-memory-exit-proof1a";
const CONNECTOR_VALIDATOR = "val-projectos-connector-contract1a";
const PHASE = "PROJECTOS-MEMORY-EXIT-PROOF1A";
const AGENCY_PHASE = "SEO-AGENCY-MEMORY-PROOF1A";
const PROJECT = "seo-agency";
const TENANT = "agency-business";
const DOMAIN = "business";
const CAP_MICRO_USD = 1_500_000;

const EVIDENCE = "docs/finish/PROJECTOS-MEMORY-EXIT-PROOF1A";
const NOTES = "docs/finish/PROJECTOS-MEMORY-EXIT-PROOF1A-validator-notes.md";
const VA = "projectos/validators/validate-all.cjs";
const CR = "projectos/speed/cached-runner.cjs";
const MANIFEST = "MANIFEST.json";
const MANIFEST_SCHEMA = "projectos.memory-exit-proof-manifest/1";

const LOG1 = "run1-cutoff.log";
const LOG2 = "run2-resume.log";
const TIMES = "run2-times.txt";
const REC = "agency-records/";
const LED = "context-ledger/";
const ledgerFile = (n) => `${LED}${String(n).padStart(6, "0")}.json`;
const EXPECTED_FILES = [
  LOG1, LOG2, TIMES,
  ledgerFile(1), ledgerFile(2), ledgerFile(3), ledgerFile(4),
  ...[
    "closure-decision.json", "cutoff-humans.txt", "cutoff-phase-record.json", "cutoff-work.v1.json", "final-humans.txt", "final-phase-record.json",
    "final-work.v1.json", "gatekeeper-decision.json", "gatekeeper-ledger.json", "run1.brief.json", "run1.context.md", "run1.invocation.json", "run2.brief.json",
    "run2.effects.json", "run2.evidence.json", "run2.findings.json", "run2.invocation.json", "run2.reviewer.json", "run2.session.json",
  ].map((name) => `${REC}${name}`),
];

const MODULE_COMMENT = "// PROJECTOS-MEMORY-EXIT-PROOF1A - the Stage 3 exit proof over the recorded live run: a cut-off phase resumed by one fresh continue, the retrieval ledger, worker text never ranked as a decision, spend under the cap; a manifest pins every evidence file.";
const MODULE_BLOCK = `,\n  ${MODULE_COMMENT}\n  "${THIS_VALIDATOR}"\n];`;

const HUMANS = ["/* TEAM */", "Site: SEO & Social Agency", "Contact: hello@example.com", "/* SITE */", "Standards: HTML5, CSS3"];
const RESUME_IDS = ["resume:cut-off-attempt", "resume:dirty-paths"];
const KINDS = ["committed-decision", "approved-memory", "plan-memory", "execution-record", "finding", "summary", "recollection"];
const TIERS = { "committed-decision": 0, "approved-memory": 1, "plan-memory": 1, "execution-record": 2, finding: 2, summary: 3, recollection: 3 };
const SOURCES = ["committed", "index", "approved-decision", "working-tree", "loop-observed"];
const WORKER_SOURCES = ["working-tree", "loop-observed"];
const LEDGER_SCHEMA = "projectos.context-retrieval/1";
const ENTRY_KEYS = [
  "event", "sessionId", "tenant", "domain", "project", "envelopeId", "headCommit", "at", "attempt", "shown", "withheld", "omitted", "decisions",
  "compactor", "compactionId", "estimatedTokens", "taintsRun", "fileHash", "refusal", "schema", "seq", "prevHash", "entryHash",
];
const ITEM_KEYS = ["id", "kind", "effectiveKind", "rank", "tier", "contentHash", "bytes", "truncated", "source", "freshness", "unverifiedClaim", "overruledBy"];
const BRIEF_KEYS = {
  "": ["schemaVersion", "briefId", "generatedAt", "projectId", "projectName", "repository", "plan", "phase", "records", "verification", "boundaries"],
  repository: ["root", "remote", "branch", "head"],
  plan: ["path", "planId", "planVersion"],
  phase: ["phaseId", "description", "dependsOn", "acceptanceCriteria", "riskLevel", "autonomyLevel", "requiredValidators", "requiredReviews", "requiredBrowserProof", "requiredOwnerGates"],
  records: ["briefPath", "findingsPath", "effectsPath", "evidencePath", "contextPath", "effectsContract"],
  verification: ["runner", "checkIds"],
  boundaries: ["forbiddenActions", "approvalGates", "protectedBranches", "productionFreeze"],
  effectsContract: ["location", "valueType", "requiredFields"],
};
const RECORD_SUFFIXES = { briefPath: ".brief.json", findingsPath: ".findings.json", effectsPath: ".effects.json", evidencePath: ".evidence.json", contextPath: ".context.md" };
const EFFECT_FIELDS = ["productionTouched", "deploymentOccurred", "databaseMutationOccurred", "externalSendOccurred", "paymentOccurred", "rawSecretStored"];
const RELAY_FLAGS = ["--session", "--objective", "--note"];
const ALLOWED_IMPORTS = ["fs", "path", "crypto"];

const HEX64 = /^[0-9a-f]{64}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

const RULE_NAMES = {
  "EP-1": "an evidence file is not the committed one",
  "EP-2": "the first run was not cut off partway",
  "EP-3": "the resume was not one bare continue from a fresh process",
  "EP-4": "the retrieval ledger does not show the cut-off state reached the new worker",
  "EP-5": "worker-authored text ranked or was labelled as a decision",
  "EP-6": "the phase did not reach closed through the validators, the review, the gatekeeper and the closure authority",
  "EP-7": "the metered broker spend (gatekeeper and closure calls) is not the logged spend or is over the cap",
  "EP-8": "this phase changed product code, or this validator does more than read files",
  "EP-9": "the validator is not registered once, last, in both runners",
};
const RULE_FIXES = {
  "EP-1": "restore the committed evidence file, or re-run the live proof and regenerate MANIFEST.json and the hashes in the notes",
  "EP-2": "the evidence of the cut-off run is not the recorded one; restore it, or re-run the proof from a run that is really killed partway",
  "EP-3": "restore the recorded invocation, brief and log; a resume with a relayed session, objective or note is not this proof",
  "EP-4": "restore the ledger and the stored-context record; the ledger must chain, and run 2 must have been shown the cut-off state",
  "EP-5": "a resumed worker record must stay an execution record below every decision and plan memory; fix the retrieval ranking, not the evidence",
  "EP-6": "restore the log and the review, gatekeeper, closure and phase records; the phase must reach closed with no owner act",
  "EP-7": "restore the gatekeeper ledger and the log; the two metered broker calls (gatekeeper and closure) must equal what the log printed and stay under the cap",
  "EP-8": "keep the notes' statements and keep this validator to the fs, path and crypto modules, reading only",
  "EP-9": "register the validator once, as the last entry, in validate-all.cjs and cached-runner.cjs, in the same order",
};

// ---------------------------------------------------------------------------------------------------------
// The bundle: every evidence file as text, the manifest, the notes, the two runner lists and this file.
// ---------------------------------------------------------------------------------------------------------

const sha = (text) => crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const canon = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
};
const same = (a, b) => canon(a) === canon(b);
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
const lines = (text) => text.replace(/\r\n/g, "\n").split("\n");

/** Walk without following a link: a symbolic link is recorded and never read through. */
function walk(dir, base, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isSymbolicLink()) found.links.push(rel);
    else if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, found);
    else found.files.push(rel);
  }
  return found;
}

/** The evidence as text. The bytes must be UTF-8; line endings are not evidence (a checkout that converts them must not change a hash). */
function deriveFiles(raw) {
  const files = {};
  const problems = [];
  for (const rel of Object.keys(raw)) {
    const bytes = Buffer.from(raw[rel], "latin1");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) problems.push(`${rel} is not valid UTF-8 text`);
    files[rel] = text.replace(/\r\n/g, "\n");
  }
  return { files, problems };
}

const TEXT_KEYS = ["notes", "validateAll", "cachedRunner", "selfSource"];
function normaliseBundle(b) {
  for (const key of TEXT_KEYS) if (typeof b[key] === "string") b[key] = b[key].replace(/\r\n/g, "\n");
  return b;
}

function loadBundle() {
  const loadProblems = [];
  const links = [];
  const raw = {};
  const dir = path.join(ROOT, ...EVIDENCE.split("/"));
  if (!fs.existsSync(dir)) loadProblems.push(`${EVIDENCE}/ is missing`);
  else if (fs.lstatSync(dir).isSymbolicLink()) links.push(EVIDENCE);
  else {
    const found = walk(dir, "", { files: [], links: [] });
    links.push(...found.links);
    for (const rel of found.files) if (rel !== MANIFEST) raw[rel] = fs.readFileSync(path.join(dir, ...rel.split("/"))).toString("latin1");
  }
  const derived = deriveFiles(raw);
  loadProblems.push(...derived.problems);
  const asText = (rel) => {
    const abs = path.join(ROOT, ...rel.split("/"));
    if (!fs.existsSync(abs)) return null;
    if (fs.lstatSync(abs).isSymbolicLink()) {
      links.push(rel);
      return null;
    }
    return fs.readFileSync(abs).toString("utf8");
  };
  return normaliseBundle({
    files: derived.files, loadProblems, links, manifest: asText(`${EVIDENCE}/${MANIFEST}`), notes: asText(NOTES), validateAll: asText(VA), cachedRunner: asText(CR),
    selfSource: fs.readFileSync(__filename, "utf8"),
  });
}

function view(b) {
  const cache = new Map();
  const j = (rel) => {
    if (!cache.has(rel)) {
      let parsed;
      try {
        parsed = typeof b.files[rel] === "string" ? JSON.parse(b.files[rel]) : undefined;
      } catch {
        parsed = undefined;
      }
      cache.set(rel, parsed);
    }
    return cache.get(rel);
  };
  return { j };
}

/** A parsed JSON object, or null with a problem named. */
function need(v, rel, out) {
  const value = v.j(rel);
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    out.push(`${rel} is missing or is not a JSON object`);
    return null;
  }
  return value;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const ms = (value) => (typeof value === "string" ? Date.parse(value) : Number.NaN);
const baseName = (value) => String(value).split(/[\\/]/).pop();
const slash = (value) => String(value).replace(/\\/g, "/");

// ---------------------------------------------------------------------------------------------------------
// The rules: each is a pure function of the bundle and returns its problems.
// ---------------------------------------------------------------------------------------------------------

function ep1(b) {
  const out = [...b.loadProblems];
  for (const rel of b.links) out.push(`${rel} is a symbolic link: the evidence is regular files only, and a link is never read through`);
  let m = null;
  try {
    m = JSON.parse(b.manifest ?? "");
  } catch {
    m = null;
  }
  if (!isObject(m)) return [...out, `${EVIDENCE}/${MANIFEST} is missing or is not a JSON object`];
  if (m.schema !== MANIFEST_SCHEMA) out.push(`the manifest schema is not ${MANIFEST_SCHEMA}`);
  if (!isObject(m.files)) return [...out, "the manifest has no files table"];
  const listed = Object.keys(m.files);
  const present = Object.keys(b.files);
  for (const rel of listed) {
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(rel) || rel.split("/").some((part) => part === "." || part === "..")) {
      out.push(`the manifest lists a path that is not inside the evidence folder: ${rel}`);
      continue;
    }
    if (!(rel in b.files)) {
      out.push(`${rel} is listed in the manifest but is missing from the folder`);
      continue;
    }
    if (typeof m.files[rel] !== "string" || !HASH.test(m.files[rel])) out.push(`${rel} has no sha256 in the manifest`);
    else if (m.files[rel] !== `sha256:${sha(b.files[rel])}`) out.push(`${rel} has changed since the manifest was written`);
  }
  for (const rel of present) if (!listed.includes(rel)) out.push(`${rel} is in the evidence folder but not in the manifest`);
  for (const rel of EXPECTED_FILES) if (!(rel in b.files) || !listed.includes(rel)) out.push(`${rel} is part of the evidence and is not in both the folder and the manifest`);
  for (const rel of present) if (!EXPECTED_FILES.includes(rel)) out.push(`${rel} is not one of the ${EXPECTED_FILES.length} evidence files`);
  if (typeof b.notes !== "string") out.push(`${NOTES} is missing`);
  else {
    for (const log of [LOG1, LOG2]) {
      if (typeof b.files[log] === "string" && !b.notes.includes(sha(b.files[log]))) out.push(`${NOTES} does not carry the sha256 of ${log}`);
    }
  }
  return out;
}

function logOneFacts(text) {
  const started = /^\[cutoff\] started pid (\d+) at (\S+)$/m.exec(text);
  const wrote = /^\[cutoff\] worker wrote (\[.*\]) at (\S+); killing the tree$/m.exec(text);
  const killed = /^\[cutoff\] killed at (\S+)$/m.exec(text);
  const exited = /^\[cutoff\] child exited code (-?\d+) at (\S+)$/m.exec(text);
  return { started, wrote, killed, exited };
}

function ep2(b) {
  const out = [];
  const v = view(b);
  const inv1 = need(v, `${REC}run1.invocation.json`, out);
  const inv2 = need(v, `${REC}run2.invocation.json`, out);
  const work = need(v, `${REC}cutoff-work.v1.json`, out);
  const phase = need(v, `${REC}cutoff-phase-record.json`, out);
  const reviewer = need(v, `${REC}run2.reviewer.json`, out);
  const log = b.files[LOG1];
  if (typeof log !== "string") out.push(`${LOG1} is missing`);
  else {
    const f = logOneFacts(log);
    if (f.started === null) out.push(`${LOG1} has no line for the start of run 1`);
    if (f.wrote === null) out.push(`${LOG1} does not show the worker writing a file and the tree being killed`);
    if (f.killed === null) out.push(`${LOG1} has no line saying the process was killed`);
    if (f.exited === null) out.push(`${LOG1} has no line for the exit of the killed child`);
    else if (Number(f.exited[1]) === 0) out.push(`${LOG1} shows the killed child exiting zero, which is a finished run, not a cut-off one`);
    if (f.wrote !== null) {
      let written = null;
      try {
        written = JSON.parse(f.wrote[1]);
      } catch {
        written = null;
      }
      if (!same(written, ["site/humans.txt"])) out.push(`${LOG1} shows more or fewer than the one file (site/humans.txt) written before the kill`);
    }
    if (f.started !== null && f.wrote !== null && f.killed !== null && f.exited !== null) {
      const t = [f.started[2], f.wrote[2], f.killed[1], f.exited[2]].map(ms);
      if (t.some(Number.isNaN) || !(t[0] < t[1] && t[1] <= t[2] && t[2] <= t[3])) out.push(`${LOG1} times do not run start, write, kill, exit`);
    }
    if (f.started !== null && inv1 !== null) {
      if (!isObject(inv1.process) || Number(f.started[1]) !== inv1.process.pid) out.push(`${LOG1} names a different process than ${REC}run1.invocation.json`);
      const created = ms(inv1.createdAt);
      if (!(ms(f.started[2]) <= created && (f.killed === null || created < ms(f.killed[1])))) out.push("run 1 recorded its invocation outside its own start-to-kill window");
    }
  }
  if (inv1 !== null && inv2 !== null) {
    if (inv1.phaseId !== AGENCY_PHASE || inv1.projectId !== PROJECT) out.push("run 1 ran another phase or project than the proof phase");
    if (!isObject(inv1.repository) || !isObject(inv2.repository) || !COMMIT.test(inv1.repository.head) || inv1.repository.head !== inv2.repository.head) {
      out.push("run 1 and run 2 did not run at the same commit");
    }
    const id = String(inv1.invocationId);
    if (inv1.sessionId !== `${AGENCY_PHASE}-${String(inv1.repository?.head).slice(0, 12)}-${id.slice(0, 8)}`) out.push("run 1's session id was not minted by run 1's own invocation");
  }
  if (work !== null) {
    if (work.state !== "WAITING_AI") out.push(`the work record right after the kill is ${work.state}, not WAITING_AI`);
    if (work.lastCompletedStep !== "dispatched claude-local") out.push("the work record right after the kill does not end at 'dispatched claude-local'");
    if (work.phaseId !== AGENCY_PHASE || work.projectId !== PROJECT) out.push("the work record right after the kill is for another phase or project");
    if (inv1 !== null && work.sessionId !== inv1.sessionId) out.push("the work record right after the kill is not run 1's session");
    if (work.gateDecisionId !== null || work.evidenceSessionId !== null) out.push("the work record right after the kill already names evidence or a gate decision");
    if (work.ownerRequired !== false) out.push("the work record right after the kill asks for the owner");
  }
  if (phase !== null) {
    if (phase.phaseId !== AGENCY_PHASE || phase.project !== PROJECT) out.push("the phase record right after the kill is for another phase or project");
    if (!["draft", "prompted", "implementing"].includes(phase.status)) out.push(`the phase record right after the kill is ${phase.status}, which is not before review`);
  }
  const cutHumans = b.files[`${REC}cutoff-humans.txt`];
  if (typeof cutHumans !== "string") out.push("cutoff-humans.txt is missing: run 1 did not write the file the log says it wrote");
  else if (!same(lines(cutHumans).filter((line, i, all) => line !== "" || i < all.length - 1), HUMANS)) out.push("cutoff-humans.txt is not the five lines the worker was asked to write");
  if (reviewer !== null && inv1 !== null && reviewer.sessionId === inv1.sessionId) out.push("a reviewer record exists for run 1's session: run 1 reached review, so it was not cut off");
  const run1Only = Object.keys(b.files).filter((rel) => rel.startsWith(`${REC}run1.`)).map((rel) => baseName(rel));
  const reached = run1Only.filter((name) => !["run1.brief.json", "run1.context.md", "run1.invocation.json"].includes(name));
  if (reached.length > 0) out.push(`run 1 left records beyond its brief, context file and invocation (${reached.join(", ")}): it got further than a cut-off run`);
  return out;
}

function argvProblem(argv, label) {
  if (!Array.isArray(argv) || argv.length !== 4) return `${label} argv is not exactly [node, projectos.js, continue, --execute]`;
  if (!/^node(?:\.exe)?$/i.test(baseName(argv[0]))) return `${label} argv[0] is not node`;
  if (baseName(argv[1]) !== "projectos.js") return `${label} argv[1] is not projectos.js`;
  if (argv[2] !== "continue" || argv[3] !== "--execute") return `${label} argv is not 'continue --execute'`;
  return null;
}

function unknownKeys(value, keys, where, out) {
  if (!isObject(value)) {
    out.push(`${where} is not an object`);
    return;
  }
  for (const key of Object.keys(value)) if (!keys.includes(key)) out.push(`${where} carries a field outside the known brief keys: ${key}`);
}

function briefShape(brief, label, out) {
  unknownKeys(brief, BRIEF_KEYS[""], `${label} brief`, out);
  for (const part of ["repository", "plan", "phase", "records", "verification", "boundaries"]) unknownKeys(brief?.[part], BRIEF_KEYS[part], `${label} brief.${part}`, out);
  unknownKeys(brief?.records?.effectsContract, BRIEF_KEYS.effectsContract, `${label} brief.records.effectsContract`, out);
}

function normalisedBrief(brief, sessionId) {
  const copy = JSON.parse(JSON.stringify(brief));
  delete copy.generatedAt;
  return JSON.stringify(copy).split(sessionId).join("<SESSION>");
}

function ep3(b) {
  const out = [];
  const v = view(b);
  const inv1 = need(v, `${REC}run1.invocation.json`, out);
  const inv2 = need(v, `${REC}run2.invocation.json`, out);
  const brief1 = need(v, `${REC}run1.brief.json`, out);
  const brief2 = need(v, `${REC}run2.brief.json`, out);
  const session = need(v, `${REC}run2.session.json`, out);
  const evidence = need(v, `${REC}run2.evidence.json`, out);
  const log = b.files[LOG2];
  if (typeof log !== "string") out.push(`${LOG2} is missing`);
  if (inv1 === null || inv2 === null) return out;
  for (const [inv, label] of [[inv1, "run 1"], [inv2, "run 2"]]) {
    const problem = argvProblem(inv.process?.argv, label);
    if (problem !== null) out.push(problem);
    if (!isCount(inv.process?.pid, 1) || !isCount(inv.process?.ppid, 1)) out.push(`${label} has no integer pid and parent pid`);
    else if (inv.process.pid === inv.process.ppid) out.push(`${label} is its own parent`);
  }
  if (inv1.process?.argv?.[1] !== inv2.process?.argv?.[1]) out.push("run 1 and run 2 did not start the same projectos.js");
  if (inv1.process?.pid === inv2.process?.pid) out.push("run 2 has the same process id as run 1: it is not a fresh process");
  if (inv1.process?.ppid === inv2.process?.ppid) out.push("run 2 has the same parent process as run 1: it was not started separately");
  if (inv2.phaseId !== AGENCY_PHASE || inv2.projectId !== PROJECT || inv2.executionMode !== "live") out.push("run 2 is not a live run of the proof phase");
  if (inv1.sessionId === inv2.sessionId) out.push("run 2 rejoined run 1's session instead of starting its own");
  if (inv1.invocationId === inv2.invocationId) out.push("run 2 has run 1's invocation id");
  if (inv2.sessionId !== `${AGENCY_PHASE}-${String(inv2.repository?.head).slice(0, 12)}-${String(inv2.invocationId).slice(0, 8)}`) out.push("run 2's session id was not minted by run 2's own invocation");
  if (session !== null) {
    for (const key of ["sessionId", "invocationId", "phaseId", "briefId"]) {
      const expected = key === "briefId" ? inv2.brief?.briefId : inv2[key];
      if (session[key] !== expected) out.push(`run 2's session record disagrees with its invocation on ${key}`);
    }
    if (session.exitCode !== 0 || session.timedOut !== false) out.push("run 2's worker did not exit zero in time");
  }
  for (const [inv, rel, label] of [[inv1, `${REC}run1.brief.json`, "run 1"], [inv2, `${REC}run2.brief.json`, "run 2"]]) {
    let digest = null;
    try {
      digest = `sha256:${sha(JSON.stringify(JSON.parse(b.files[rel])))}`;
    } catch {
      digest = null;
    }
    if (digest === null || inv.brief?.digest !== digest) out.push(`${label}'s invocation names a brief digest that is not the digest of the committed brief ${rel}`);
  }
  if (brief1 !== null && brief2 !== null) {
    briefShape(brief1, "run 1", out);
    briefShape(brief2, "run 2", out);
    if (brief2.briefId !== inv2.brief?.briefId) out.push("run 2's brief is not the brief its invocation names");
    if (normalisedBrief(brief1, String(inv1.sessionId)) !== normalisedBrief(brief2, String(inv2.sessionId))) {
      out.push("run 2's brief differs from run 1's by more than the session it names: something was added to it");
    }
    const records = brief2.records;
    const root = slash(brief2.repository?.root);
    if (isObject(records)) {
      for (const [key, suffix] of Object.entries(RECORD_SUFFIXES)) {
        const value = records[key];
        const expected = `${root}/.projectops/execution/${inv2.sessionId}${suffix}`;
        if (typeof value !== "string" || slash(value) !== expected) out.push(`run 2's brief.records.${key} is not ${expected}`);
      }
      const contract = records.effectsContract;
      if (!isObject(contract) || contract.location !== "top-level" || contract.valueType !== "boolean" || !same(contract.requiredFields, EFFECT_FIELDS)) {
        out.push("run 2's brief.records.effectsContract is not the closed effects contract");
      }
    }
  }
  if (evidence !== null) {
    if (evidence.sessionId !== inv2.sessionId || evidence.invocationId !== inv2.invocationId) out.push("run 2's evidence is not for run 2's session and invocation");
    if (evidence.storedContext?.contextPath !== `.projectops/execution/${inv2.sessionId}.context.md`) out.push("run 2's stored-context path is not its own session's context file");
  }
  if (typeof log === "string") {
    const runLines = lines(log).filter((line) => line.startsWith("projectos continue: run"));
    if (runLines.length !== 1) out.push(`${LOG2} has ${runLines.length} 'projectos continue: run' lines, not exactly one`);
    for (const flag of RELAY_FLAGS) if (log.includes(flag)) out.push(`${LOG2} contains ${flag}: something was relayed to the resumed run`);
    const mark = /^Invocation: ([0-9a-f]+) \(pid (\d+), parent (\d+)\)$/m.exec(log);
    if (mark === null) out.push(`${LOG2} has no Invocation line`);
    else {
      if (mark[1] !== inv2.invocationId) out.push(`${LOG2} names another invocation than ${REC}run2.invocation.json`);
      if (Number(mark[2]) !== inv2.process?.pid) out.push(`${LOG2} names another pid than ${REC}run2.invocation.json`);
      if (Number(mark[3]) !== inv2.process?.ppid) out.push(`${LOG2} names another parent pid than ${REC}run2.invocation.json`);
    }
    const prior = /^Prior work: .* session (\S+)$/m.exec(log);
    if (prior === null) out.push(`${LOG2} has no Prior work line: the resume did not find the cut-off phase`);
    else if (prior[1] !== inv1.sessionId) out.push(`${LOG2} found prior work from a session that is not run 1's`);
    if (!/^attempt 1: started claude-local; worker exited 0$/m.test(log)) out.push(`${LOG2} does not show a fresh worker start that exited zero`);
  }
  const killed = typeof b.files[LOG1] === "string" ? logOneFacts(b.files[LOG1]).killed : null;
  if (killed !== null && !(ms(killed[1]) < ms(inv2.createdAt))) out.push("run 2 started before run 1 was killed");
  const times = typeof b.files[TIMES] === "string" ? lines(b.files[TIMES]).filter((line) => line !== "") : [];
  if (times.length !== 2 || times.some((t) => Number.isNaN(ms(t))) || !(ms(times[0]) < ms(times[1]))) out.push(`${TIMES} is not a start and a later end`);
  else if (killed !== null && !(ms(killed[1]) <= ms(times[0]) + 1000 && ms(times[0]) <= ms(inv2.createdAt) && ms(inv2.createdAt) <= ms(times[1]))) out.push(`${TIMES} does not bracket run 2 after the kill`);
  return out;
}

/** The four ledger entries, parsed in order, with each problem named once. */
function ledgerOf(v, out) {
  const entries = [];
  for (let n = 1; n <= 4; n += 1) entries.push(need(v, ledgerFile(n), out));
  return entries;
}

function chainProblems(entries) {
  const out = [];
  let prev = null;
  entries.forEach((entry, index) => {
    const label = ledgerFile(index + 1);
    if (entry === null) return;
    const keys = Object.keys(entry).sort();
    if (!same(keys, [...ENTRY_KEYS].sort())) out.push(`${label} has fields other than the ledger entry's`);
    if (entry.schema !== LEDGER_SCHEMA) out.push(`${label} is not a ${LEDGER_SCHEMA} entry`);
    if (entry.seq !== index + 1) out.push(`${label} is entry ${entry.seq}, not ${index + 1}: the sequence has a gap or a repeat`);
    if (entry.prevHash !== prev) out.push(`${label} does not chain to the entry before it`);
    const { entryHash, ...fields } = entry;
    if (entryHash !== `sha256:${sha(canon(fields))}`) out.push(`${label} does not hash to its own entryHash`);
    prev = typeof entryHash === "string" ? entryHash : prev;
  });
  return out;
}

const itemIds = (shown) => (Array.isArray(shown) ? shown.map((item) => item?.id) : []);

function ep4(b) {
  const out = [];
  const v = view(b);
  const inv1 = need(v, `${REC}run1.invocation.json`, out);
  const inv2 = need(v, `${REC}run2.invocation.json`, out);
  const evidence = need(v, `${REC}run2.evidence.json`, out);
  const entries = ledgerOf(v, out);
  out.push(...chainProblems(entries));
  const [e1, e2, e3, e4] = entries;
  if (e1 === null || e2 === null || e3 === null || e4 === null || inv1 === null || inv2 === null) return out;
  let listsOk = true;
  for (const [entry, event, inv, label] of [[e1, "retrieved", inv1, "run 1"], [e2, "placed", inv1, "run 1"], [e3, "retrieved", inv2, "run 2"], [e4, "placed", inv2, "run 2"]]) {
    const where = ledgerFile(entry.seq);
    for (const list of ["shown", "withheld", "omitted", "decisions"]) {
      if (!Array.isArray(entry[list])) {
        out.push(`${where} has no ${list} list`);
        listsOk = false;
      }
    }
    if (entry.event !== event) out.push(`${where} is a '${entry.event}' entry, not '${event}'`);
    if (entry.sessionId !== inv.sessionId) out.push(`${where} is not ${label}'s session`);
    if (entry.tenant !== TENANT || entry.domain !== DOMAIN || entry.project !== PROJECT) out.push(`${where} is not for ${TENANT}/${PROJECT}`);
    if (entry.headCommit !== inv.repository?.head) out.push(`${where} is not at ${label}'s commit`);
    if (event === "placed" && entry.attempt !== 1) out.push(`${where} says attempt ${entry.attempt}, not 1`);
    if (event === "retrieved" && entry.attempt !== null) out.push(`${where} is a retrieval that names an attempt`);
    if (entry.refusal !== null) out.push(`${where} is a refusal`);
    for (const item of Array.isArray(entry.shown) ? entry.shown : []) {
      if (!isObject(item) || !same(Object.keys(item).sort(), [...ITEM_KEYS].sort())) out.push(`${where} lists an item with fields other than the ledger item's`);
    }
  }
  if (!listsOk) return out;
  if (e1.envelopeId !== e2.envelopeId || e3.envelopeId !== e4.envelopeId || e1.envelopeId === e3.envelopeId) out.push("the envelopes are not one per run");
  const at = [e1, e2, e3, e4].map((entry) => ms(entry.at));
  if (at.some(Number.isNaN) || !(at[0] < at[1] && at[1] < at[2] && at[2] < at[3])) out.push("the ledger entries are not in time order");
  else if (at[2] < ms(inv2.createdAt)) out.push("run 2's retrieval was written before run 2 started");
  if (!same(e1.shown, e2.shown) || !same(e3.shown, e4.shown)) out.push("a placement shows other items than the retrieval before it");
  if (e1.fileHash !== e2.fileHash || e3.fileHash !== e4.fileHash || !HASH.test(String(e3.fileHash)) || e1.fileHash === e3.fileHash) out.push("the context files are not one per run, placed as retrieved");
  const ids1 = itemIds(e1.shown);
  const ids2 = itemIds(e3.shown);
  for (const id of RESUME_IDS) {
    if (ids1.includes(id)) out.push(`run 1 was shown ${id}: there was nothing cut off for it to retrieve`);
    if (!ids2.includes(id)) out.push(`run 2 was not shown ${id}: the cut-off state did not reach the new worker`);
  }
  const context1 = b.files[`${REC}run1.context.md`];
  if (typeof context1 !== "string") out.push(`${REC}run1.context.md is missing: nothing shows what run 1's worker was pointed at`);
  else {
    if (`sha256:${sha(context1)}` !== e1.fileHash || e1.fileHash !== e2.fileHash) out.push("run 1's context file is not the file the ledger says was placed (its sha256 is not the entries' fileHash)");
    if (!context1.includes(inv1.sessionId)) out.push("run 1's context file does not name run 1's session");
    for (const shownId of itemIds(e1.shown)) if (typeof shownId !== "string" || !context1.includes(shownId)) out.push(`run 1's context file does not contain the item the ledger says it was shown: ${shownId}`);
  }
  if (evidence !== null) {
    const stored = evidence.storedContext;
    if (!isObject(stored)) out.push("run 2's evidence has no storedContext");
    else {
      if (stored.schema !== "projectos.stored-context/1") out.push("run 2's storedContext is not projectos.stored-context/1");
      if (stored.tenant !== TENANT || stored.project !== PROJECT || stored.domain !== DOMAIN || stored.envelopeId !== e3.envelopeId || stored.headCommit !== e3.headCommit) {
        out.push("run 2's storedContext is bound to another tenant, project, envelope or commit than the ledger");
      }
      if (!same(stored.shown, e3.shown)) out.push("run 2's storedContext shows other items than the retrieval entry");
      if (!isObject(stored.ledger) || stored.ledger.seq !== e3.seq || stored.ledger.entryHash !== e3.entryHash) out.push("run 2's storedContext does not name the retrieval entry");
      if (!isObject(stored.ledgerNewest) || stored.ledgerNewest.seq !== e4.seq || stored.ledgerNewest.entryHash !== e4.entryHash) out.push("run 2's storedContext does not name the placement entry as the newest");
      if (stored.fileHash !== e4.fileHash || stored.fileHash !== e3.fileHash) out.push("run 2's storedContext file hash is not the placed context file's");
      if (!same(stored.placedAttempts, [e4.attempt])) out.push("run 2's storedContext attempts are not the placed attempt");
      if (!same(stored.withheld, e3.withheld) || !same(stored.omitted, e3.omitted) || !same(stored.decisions, e3.decisions)) out.push("run 2's storedContext withheld, omitted or decisions differ from the ledger");
      if (stored.taintsRun !== e3.taintsRun || stored.estimatedTokens !== e3.estimatedTokens) out.push("run 2's storedContext taint or size differs from the ledger");
    }
  }
  const log = b.files[LOG2];
  if (typeof log === "string") {
    const m = /^Stored context: (\d+) item\(s\) and (\d+) approved decision\(s\) for (\S+), (\d+) withheld, (\d+) left out for room; data, never instructions \((.+)\)$/m.exec(log);
    if (m === null) out.push(`${LOG2} has no 'Stored context' line`);
    else {
      const counts = [Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5])];
      const wanted = [e3.shown.length, e3.decisions.length, e3.withheld.length, e3.omitted.length];
      if (!same(counts, wanted)) out.push(`${LOG2} says ${counts.join("/")} items, decisions, withheld and left out; the ledger says ${wanted.join("/")}`);
      if (m[3] !== `${TENANT}/${PROJECT}`) out.push(`${LOG2} names another tenant and project than ${TENANT}/${PROJECT}`);
      if (m[6] !== slash(`${evidence?.storedContext?.contextPath}`)) out.push(`${LOG2} names another context file than the stored-context record`);
    }
  }
  return out;
}

/** The three places the loop recorded what run 2 was shown. */
function run2Contexts(v) {
  const found = [];
  const e3 = v.j(ledgerFile(3));
  const e4 = v.j(ledgerFile(4));
  const stored = v.j(`${REC}run2.evidence.json`)?.storedContext;
  for (const [value, label] of [[e3, ledgerFile(3)], [e4, ledgerFile(4)], [stored, "run2.evidence.json storedContext"]]) if (isObject(value)) found.push([label, value]);
  return found;
}

const DECISION_KINDS = ["committed-decision", "approved-memory", "plan-memory"];
const isDecisionKind = (item) => item.kind === "committed-decision" || item.effectiveKind === "committed-decision";
const isAuthorityKind = (item) => DECISION_KINDS.includes(item.kind) || DECISION_KINDS.includes(item.effectiveKind);

function rankingProblems(label, context, out) {
  const shown = context.shown;
  const items = shown.filter(isObject);
  if (items.length !== shown.length) out.push(`${label} lists something that is not an item`);
  if (!items.every((item, index) => item.rank === index + 1)) out.push(`${label} ranks are not 1..n in strictly increasing order along the list`);
  if (!items.every((item, index) => index === 0 || item.tier >= items[index - 1].tier)) out.push(`${label} tiers are not non-decreasing along the ranks`);
  if (!items.some(isDecisionKind)) out.push(`${label} shows no committed decision, so the ranking rule would hold over an empty set`);
  const authority = items.filter(isAuthorityKind);
  for (const item of items) {
    if (!KINDS.includes(item.kind) || !KINDS.includes(item.effectiveKind)) out.push(`${label} item ${item.id} has a kind the ledger does not allow`);
    else if (item.tier !== TIERS[item.effectiveKind]) out.push(`${label} item ${item.id} has tier ${item.tier}, not its kind's`);
    if (!SOURCES.includes(item.source)) out.push(`${label} item ${item.id} has a source the ledger does not allow`);
    if (!Array.isArray(item.overruledBy) || item.overruledBy.some((entry) => typeof entry !== "string")) out.push(`${label} item ${item.id} has no overruledBy list`);
    if (isDecisionKind(item) && Array.isArray(item.overruledBy) && item.overruledBy.length > 0) out.push(`${label} committed decision ${item.id} is overruled by ${item.overruledBy.join(", ")}`);
    if (item.source === "committed") continue;
    if (isAuthorityKind(item)) out.push(`${label} item ${item.id} is labelled ${item.effectiveKind} with source ${item.source}: only committed bytes make a decision or plan memory`);
    if (item.kind !== "execution-record" || item.effectiveKind !== "execution-record") out.push(`${label} item ${item.id} (source ${item.source}) is labelled ${item.kind}/${item.effectiveKind}, not an execution record`);
    if (!(item.tier >= 2)) out.push(`${label} item ${item.id} (source ${item.source}) is in tier ${item.tier}, above tier 2`);
    for (const other of authority) if (!(item.rank > other.rank)) out.push(`${label} item ${item.id} (source ${item.source}, rank ${item.rank}) does not rank below ${other.id} (rank ${other.rank})`);
  }
  for (const item of items) {
    if (typeof item.id === "string" && item.id.startsWith("resume:") && !WORKER_SOURCES.includes(item.source)) out.push(`${label} resumed item ${item.id} has source ${item.source}, not one the loop read from the working tree`);
  }
  const outside = items.filter((item) => item.source !== "committed").map((item) => item.contentHash);
  for (const decision of context.decisions) {
    if (!isObject(decision) || !HASH.test(String(decision.hash)) || !["memory", "user"].includes(decision.target)) out.push(`${label} lists a decision that is not a hash and a memory or user target`);
    else if (outside.includes(decision.hash)) out.push(`${label} lists an item from outside the committed bytes as an approved decision`);
  }
  if (outside.length > 0 && context.taintsRun !== true) out.push(`${label} showed text from outside the committed bytes and does not mark the run tainted`);
}

function ep5(b) {
  const out = [];
  const v = view(b);
  const contexts = run2Contexts(v).filter(([, context]) => Array.isArray(context.shown) && Array.isArray(context.decisions));
  if (contexts.length === 0) return ["there is no usable record of what run 2 was shown"];
  for (const [label, context] of contexts) rankingProblems(label, context, out);
  for (const n of [1, 2]) {
    const entry = v.j(ledgerFile(n));
    if (isObject(entry) && entry.taintsRun !== true) out.push(`${ledgerFile(n)} (run 1) does not mark the run tainted, though stored text reached it`);
  }
  return out;
}

function ep6(b) {
  const out = [];
  const v = view(b);
  const inv2 = need(v, `${REC}run2.invocation.json`, out);
  const reviewer = need(v, `${REC}run2.reviewer.json`, out);
  const session = need(v, `${REC}run2.session.json`, out);
  const evidence = need(v, `${REC}run2.evidence.json`, out);
  const effects = need(v, `${REC}run2.effects.json`, out);
  const work = need(v, `${REC}final-work.v1.json`, out);
  const phase = need(v, `${REC}final-phase-record.json`, out);
  const closure = need(v, `${REC}closure-decision.json`, out);
  const gate = need(v, `${REC}gatekeeper-decision.json`, out);
  const log = b.files[LOG2];
  if (typeof log !== "string") out.push(`${LOG2} is missing`);
  else {
    const stops = log.match(/OWNER_DECISION_REQUIRED/g) ?? [];
    const handover = new RegExp(`^STOPPED \\(OWNER_DECISION_REQUIRED\\): phase '${AGENCY_PHASE}' is awaiting_closure; that is not a state the loop may move it from$`, "m");
    if (stops.length !== 1 || !handover.test(log)) out.push(`${LOG2} stops for the owner other than at the loop's own awaiting_closure handover`);
    if (lines(log).filter((line) => line.startsWith("STOPPED")).length !== 1) out.push(`${LOG2} has other than exactly one STOPPED line`);
    if (/^[ \t]*(?:FAIL|REFUSED)\b/m.test(log) || /\bREFUSED \(/.test(log)) out.push(`${LOG2} shows a failure or a refusal`);
    const attempt = /^attempt 1: started claude-local; worker exited 0$/m.exec(log);
    const review = /^ {2}independent review by codex-reviewer: APPROVE$/m.exec(log);
    if (attempt !== null && review !== null && attempt.index < review.index) {
      const section = log.slice(attempt.index, review.index);
      for (const copy of ["validate-site", "validate-site@phase-copy"]) {
        if (!new RegExp(`^ {2}PASS validator ${copy}$`, "m").test(section)) out.push(`${LOG2} has no 'PASS validator ${copy}' line in run 2's attempt section, before the independent review`);
      }
    }
    const steps = [
      /^attempt 1: started claude-local; worker exited 0$/m, /^ {2}independent review by codex-reviewer: APPROVE$/m,
      /^ {2}gatekeeper: the gatekeeper reviewed CONTINUATION_READY and approved continuation$/m,
      handover, /^closure prepared for SEO-AGENCY-MEMORY-PROOF1A at subject [0-9a-f]{40}$/m, /^ {2}reviews \(credited\): complete$/m, /^ {2}unresolved CRITICAL\/HIGH: 0$/m,
      /^carrying on: projectos closure request --id SEO-AGENCY-MEMORY-PROOF1A --execute$/m, /^the closure authority decided to close SEO-AGENCY-MEMORY-PROOF1A at [0-9a-f]{7,40}$/m,
      /^SEO-AGENCY-MEMORY-PROOF1A: awaiting_closure -> closed \(by advisor\)/m, /^ {2}state: {5}active=none, 5\/5 complete$/m, /^exit=0$/m,
    ];
    let from = 0;
    steps.forEach((step, index) => {
      const hit = step.exec(log.slice(from));
      if (hit === null) out.push(`${LOG2} lacks step ${index + 1} of the run (${String(step).slice(1, 70)}...) at or after the step before it`);
      else from += hit.index + hit[0].length;
    });
    if (lines(log).filter((line) => line !== "").pop() !== "exit=0") out.push(`${LOG2} does not end with exit=0`);
    const gk = /^gatekeeper request (GKREQ-[0-9a-f]{24}) \(evidence-review\) for CONTINUATION_READY$/m.exec(log);
    const cl = /^closure request (CLREQ-[0-9a-f]{24}) \(closure-review\) for SEO-AGENCY-MEMORY-PROOF1A at ([0-9a-f]{7,40})$/m.exec(log);
    if (gk === null || gate === null || gate.decisionId !== `GKDEC-${gk[1]}`) out.push("the gatekeeper decision is not the one for the request in the log");
    if (cl === null || closure === null || closure.decisionId !== cl[1] || !String(closure.evidenceSubjectHead).startsWith(cl[2])) out.push("the closure decision is not the one for the request in the log");
    if (!/^ {2}gatekeeper decision provenance: InstallationBrokerProviderAnswer$/m.test(log)) out.push(`${LOG2} does not show the gatekeeper decision coming from the broker's provider answer`);
    if (!/^closure decision provenance: InstallationBrokerProviderAnswer \(provider response resp_[0-9a-f]+\)$/m.test(log)) out.push(`${LOG2} does not show the closure decision coming from the broker's provider answer`);
  }
  if (reviewer !== null && inv2 !== null) {
    if (reviewer.sessionId !== inv2.sessionId || reviewer.phaseId !== AGENCY_PHASE || reviewer.baseHead !== inv2.repository?.head) out.push("the reviewer record is not for run 2's session, phase and commit");
    if (reviewer.providerDistinct !== true) out.push("the reviewer record does not say the provider is distinct");
    if (reviewer.implementerKind !== "claude-code-cli" || reviewer.reviewerKind !== "codex-cli" || reviewer.implementerKind === reviewer.reviewerKind) out.push("the implementer and reviewer are not claude-code-cli and codex-cli");
    if (reviewer.implementerWorkerId === reviewer.reviewerWorkerId || (session !== null && (session.workerId !== reviewer.implementerWorkerId || session.kind !== reviewer.implementerKind))) out.push("the reviewer is the implementer, or the implementer is not the session's worker");
    if (reviewer.verdict !== "APPROVE" || !same(reviewer.findings, [])) out.push("the reviewer verdict is not APPROVE with no findings");
    const requested = reviewer.reviewsRequested;
    if (!Array.isArray(requested) || requested.length === 0 || !requested.every((review) => Array.isArray(reviewer.reviewsPerformed) && reviewer.reviewsPerformed.includes(review))) out.push("a requested independent review was not performed");
  }
  if (evidence !== null) {
    for (const [key, rel] of [["effectsSha256", "run2.effects.json"], ["findingsSha256", "run2.findings.json"], ["reviewerSha256", "run2.reviewer.json"]]) {
      if (typeof b.files[`${REC}${rel}`] !== "string" || evidence[key] !== sha(b.files[`${REC}${rel}`])) out.push(`the evidence's ${key} is not the sha256 of the committed ${rel}`);
    }
    const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
    for (const id of ["validate-site", "validate-site@phase-copy"]) {
      const check = checks.find((entry) => entry?.id === id);
      if (!isObject(check) || check.passed !== true || check.exitCode !== 0 || check.kind !== "validator") out.push(`the evidence has no passing validator check for ${id}`);
    }
  }
  if (effects !== null) {
    if (!same(Object.keys(effects).sort(), [...EFFECT_FIELDS].sort()) || EFFECT_FIELDS.some((field) => effects[field] !== false)) out.push("the run recorded a prohibited effect, or its effects record is not the six closed fields all false");
  }
  if (work !== null) {
    if (work.state !== "COMPLETE" || work.ownerRequired !== false) out.push("the final work record is not COMPLETE with no owner required");
    if (inv2 !== null && work.sessionId !== inv2.sessionId) out.push("the final work record is not run 2's session");
    if (gate !== null && work.gateDecisionId !== gate.decisionId) out.push("the final work record does not name the gatekeeper's decision");
  }
  if (phase !== null) {
    const history = Array.isArray(phase.history) ? phase.history : [];
    const last = history[history.length - 1];
    if (phase.phaseId !== AGENCY_PHASE || phase.project !== PROJECT || phase.status !== "closed") out.push("the final phase record is not the proof phase closed");
    if (!isObject(last) || last.from !== "awaiting_closure" || last.to !== "closed" || (closure !== null && !String(last.note).includes(String(closure.decisionId)))) out.push("the final phase record does not end awaiting_closure to closed on the closure decision");
  }
  if (gate !== null) {
    if (gate.decision !== "APPROVED_TO_PROCEED" || gate.ownerApprovalRequired !== false || gate.phaseId !== AGENCY_PHASE || gate.projectId !== PROJECT) out.push("the gatekeeper did not approve this phase without the owner");
    if (gate.decidedBy !== "ChatGPT") out.push(`the gatekeeper decision was decided by ${JSON.stringify(gate.decidedBy)}, not by the provider answer (ChatGPT)`);
    if (gate.provenance !== "InstallationBrokerProviderAnswer") out.push(`the gatekeeper decision's provenance is ${JSON.stringify(gate.provenance)}, not InstallationBrokerProviderAnswer`);
    if (!Array.isArray(gate.allowedActions) || gate.allowedActions.includes("phase-closure") || !Array.isArray(gate.forbiddenActions) || !gate.forbiddenActions.includes("phase-closure")) out.push("the gatekeeper's decision allows closure, which is the closure authority's");
  }
  if (closure !== null) {
    if (closure.decision !== "close" || closure.phaseId !== AGENCY_PHASE || closure.projectId !== PROJECT || closure.scope !== "phase-closure") out.push("the closure decision is not 'close' for the proof phase");
    if (closure.decidedBy !== "ChatGPT") out.push(`the closure was decided by ${JSON.stringify(closure.decidedBy)}, not by the closure authority's provider answer (ChatGPT)`);
    if (!same(closure.ownerAcceptedFindings, [])) out.push("the closure decision carries an owner-accepted finding");
  }
  const final = b.files[`${REC}final-humans.txt`];
  if (typeof final !== "string" || !same(lines(final).filter((line, i, all) => line !== "" || i < all.length - 1), HUMANS)) out.push("final-humans.txt is not the five lines the phase asked for");
  return out;
}

function ep7(b) {
  const out = [];
  const v = view(b);
  const ledger = need(v, `${REC}gatekeeper-ledger.json`, out);
  const log = b.files[LOG2];
  if (typeof log !== "string") return [...out, `${LOG2} is missing`];
  if (ledger === null) return out;
  const gk = /^gatekeeper answered; recorded (\d+) micro-USD against (GKREQ-[0-9a-f]{24})$/m.exec(log);
  const cl = /^closure authority answered; this call cost (\d+) micro-USD \((CLREQ-[0-9a-f]{24})\)$/m.exec(log);
  if (gk === null || cl === null) return [...out, `${LOG2} does not print both the gatekeeper and the closure-authority broker spend`];
  const entries = (Array.isArray(ledger.entries) ? ledger.entries : []).filter((entry) => isObject(entry) && entry.phaseId === AGENCY_PHASE);
  const mine = entries.filter((entry) => entry.projectId === PROJECT);
  if (mine.length !== entries.length) out.push("a metered broker call for the proof phase belongs to another project");
  if (!same(mine.map((entry) => entry.requestId), [gk[2], cl[2]])) out.push("the metered broker calls for the phase are not exactly the two requests the log names");
  for (const entry of mine) if (!isCount(entry.costMicroUsd, 0)) out.push(`the metered cost of ${entry.requestId} is not a whole non-negative number of micro-USD`);
  const costs = mine.map((entry) => entry.costMicroUsd);
  if (!same(costs, [Number(gk[1]), Number(cl[1])])) out.push(`the metered broker costs in the ledger (${costs.join(", ")}) are not the amounts the log printed (${gk[1]}, ${cl[1]})`);
  const total = costs.reduce((sum, cost) => sum + (isCount(cost, 0) ? cost : 0), 0);
  if (total > CAP_MICRO_USD) out.push(`the metered broker spend ${total} micro-USD is over the ${CAP_MICRO_USD} cap`);
  if (Number(gk[1]) + Number(cl[1]) > CAP_MICRO_USD) out.push("the metered broker spend the log printed is over the cap");
  const months = [...log.matchAll(/^budget OK: month (\d+) micro-USD/gm)].map((hit) => Number(hit[1]));
  if (!same(months, [0, Number(gk[1])])) out.push(`${LOG2} budget lines (${months.join(", ")}) do not show the metered month starting at 0 and then the first call's cost`);
  const times = typeof b.files[TIMES] === "string" ? lines(b.files[TIMES]).filter((line) => line !== "") : [];
  for (const entry of mine) {
    if (times.length !== 2 || !(ms(times[0]) <= ms(entry.at) && ms(entry.at) <= ms(times[1]))) out.push(`${entry.requestId} was metered outside run 2's window`);
  }
  return out;
}

// The words are built from pieces so that this file never contains the very text it forbids.
const FORBIDDEN_WORDS = [["write", "File"], ["append", "File"], ["mk", "dir"], ["rm", "Sync"], ["unlink", "Sync"], ["re", "name"], ["child_", "process"], ["fe", "tch"], ["ht", "tp"], ["n", "et"], ["ev", "al"]].map((pieces) => pieces.join(""));
const FS_READ_ONLY = ["readFileSync", "readdirSync", "lstatSync", "existsSync"];

function ep8(b) {
  const out = [];
  if (typeof b.notes !== "string") out.push(`${NOTES} is missing`);
  else {
    for (const phrase of ["no product code", "no model call", "does not lift D4"]) if (!b.notes.includes(phrase)) out.push(`${NOTES} does not say '${phrase}'`);
  }
  const code = withoutComments(b.selfSource);
  const named = [...code.matchAll(/\brequire\(\s*(["'`])([^"'`]+)\1\s*\)/g)].map((hit) => hit[2]);
  const identifiers = (code.match(/\brequire\b/g) ?? []).length;
  if (identifiers !== named.length) out.push("this validator uses the module loader other than as a call with a literal module name (an alias, a computed name or a property)");
  if (!same([...named].sort(), [...ALLOWED_IMPORTS].sort())) out.push(`this validator loads ${named.join(", ") || "nothing"}; it must load exactly ${ALLOWED_IMPORTS.join(", ")}, once each, by literal name`);
  for (const word of FORBIDDEN_WORDS) if (new RegExp(`\\b${word}\\b`).test(code)) out.push(`this validator contains the word ${word}`);
  for (const use of new Set([...code.matchAll(/\bfs\.(\w+)/g)].map((hit) => hit[1]))) if (!FS_READ_ONLY.includes(use)) out.push(`this validator uses fs.${use}, which is not one of ${FS_READ_ONLY.join(", ")}`);
  if (/\bnew\s+Function\b|\bimport\s*\(/.test(code)) out.push("this validator builds code from text or imports dynamically");
  return out;
}

function modulesOf(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("const MODULES = [");
  if (start < 0) return null;
  const end = text.indexOf("\n];", start);
  return end < 0 ? null : text.slice(start, end);
}

function ep9(b) {
  const out = [];
  const lists = [];
  for (const [text, name] of [[b.validateAll, "validate-all"], [b.cachedRunner, "cached-runner"]]) {
    const slice = modulesOf(text);
    if (slice === null) {
      out.push(`${name} has no MODULES list`);
      continue;
    }
    const rows = slice.split("\n");
    const live = rows.filter((row) => !/^\s*\/\//.test(row)).join("\n");
    const names = [...live.matchAll(/"([^"]+)"/g)].map((hit) => hit[1]);
    lists.push(names);
    const count = names.filter((entry) => entry === THIS_VALIDATOR).length;
    if (count !== 1) out.push(`${THIS_VALIDATOR} is in ${name} ${count} times, not once`);
    else {
      if (names[names.length - 1] !== THIS_VALIDATOR) out.push(`${THIS_VALIDATOR} is not the last entry in ${name}`);
      if (names[names.length - 2] !== CONNECTOR_VALIDATOR) out.push(`${THIS_VALIDATOR} does not come right after ${CONNECTOR_VALIDATOR} in ${name}`);
      const at = rows.findIndex((row) => row.includes(`"${THIS_VALIDATOR}"`));
      if (at < 1 || !/^\s*\/\/ PROJECTOS-MEMORY-EXIT-PROOF1A\b/.test(rows[at - 1])) out.push(`${THIS_VALIDATOR} has no PROJECTOS-MEMORY-EXIT-PROOF1A comment line above it in ${name}`);
    }
  }
  if (lists.length === 2 && !same(lists[0], lists[1])) out.push("validate-all and the cached runner do not list the same validators in the same order");
  return out;
}

const RULES = [
  ["EP-1", ep1], ["EP-2", ep2], ["EP-3", ep3], ["EP-4", ep4], ["EP-5", ep5], ["EP-6", ep6], ["EP-7", ep7], ["EP-8", ep8], ["EP-9", ep9],
];

/**
 * Every rule that fires on a bundle, in order, with its problems. A rule that throws is a problem of that rule, never a crash.
 * `dead` names one rule whose body is replaced by `return []`: the control that shows a mutation needs its rule.
 */
function judge(b, dead = null) {
  const fired = {};
  for (const [id, rule] of RULES) {
    let problems;
    if (id === dead) problems = [];
    else {
      try {
        problems = rule(b);
      } catch (error) {
        problems = [`${id} threw: ${error instanceof Error ? error.message : String(error)}`];
      }
    }
    if (problems.length > 0) fired[id] = problems;
  }
  return fired;
}

function messagesOf(fired) {
  return Object.entries(fired).flatMap(([id, problems]) => problems.map((problem) => `${id} ${RULE_NAMES[id]}: ${problem}. Fix: ${RULE_FIXES[id]}`));
}

// ---------------------------------------------------------------------------------------------------------
// The mutation kit: every edit re-seals the manifest and the notes, so only the rule meant to see it does.
// ---------------------------------------------------------------------------------------------------------

function reseal(b, rel, old) {
  const manifest = JSON.parse(b.manifest);
  if (rel in manifest.files && rel in b.files) manifest.files[rel] = `sha256:${sha(b.files[rel])}`;
  b.manifest = JSON.stringify(manifest, null, 2);
  if ((rel === LOG1 || rel === LOG2) && typeof old === "string") b.notes = b.notes.split(sha(old)).join(sha(b.files[rel]));
}
function put(b, rel, text, seal = true) {
  const old = b.files[rel];
  b.files[rel] = text;
  if (seal) reseal(b, rel, old);
}
function jsonEdit(b, rel, fn, seal = true) {
  const value = JSON.parse(b.files[rel]);
  fn(value);
  put(b, rel, JSON.stringify(value, null, 2), seal);
}
function textEdit(b, rel, from, to, seal = true) {
  const old = b.files[rel];
  const at = typeof from === "string" ? old.indexOf(from) : old.search(from);
  if (at < 0) throw new Error(`mutation target not found in ${rel}: ${String(from)}`);
  put(b, rel, typeof from === "string" ? old.replace(from, () => to) : old.replace(from, to), seal);
}
function drop(b, rel, seal = true) {
  delete b.files[rel];
  if (seal) {
    const manifest = JSON.parse(b.manifest);
    delete manifest.files[rel];
    b.manifest = JSON.stringify(manifest, null, 2);
  }
}
function manifestEdit(b, fn) {
  const manifest = JSON.parse(b.manifest);
  fn(manifest);
  b.manifest = JSON.stringify(manifest, null, 2);
}
function sealLedger(b) {
  let prev = null;
  for (let n = 1; n <= 4; n += 1) {
    const rel = ledgerFile(n);
    if (!(rel in b.files)) break;
    const entry = JSON.parse(b.files[rel]);
    const { entryHash: _ignored, ...fields } = { ...entry, prevHash: prev };
    const sealed = { ...fields, entryHash: `sha256:${sha(canon(fields))}` };
    put(b, rel, JSON.stringify(sealed));
    prev = sealed.entryHash;
  }
  const three = JSON.parse(b.files[ledgerFile(3)]);
  const four = JSON.parse(b.files[ledgerFile(4)]);
  jsonEdit(b, `${REC}run2.evidence.json`, (ev) => {
    ev.storedContext.ledger.entryHash = three.entryHash;
    ev.storedContext.ledgerNewest.entryHash = four.entryHash;
  });
}
function entryEdit(b, n, fn, seal = true) {
  jsonEdit(b, ledgerFile(n), fn, !seal);
  if (!seal) return;
  sealLedger(b);
}
/** Apply one edit to everything that records what run 2 was shown, then re-chain. */
function run2Edit(b, fn) {
  jsonEdit(b, ledgerFile(3), fn);
  jsonEdit(b, ledgerFile(4), fn);
  jsonEdit(b, `${REC}run2.evidence.json`, (ev) => fn(ev.storedContext));
  sealLedger(b);
}
const item = (target, id) => target.shown.find((entry) => entry.id === id);
const RESUME = "resume:dirty-paths";
const CUT = "resume:cut-off-attempt";
const DECISION = ".projectops/closure/decisions/SEO-AGENCY-SITE-CHECK3A.json";
const PLAN = ".projectops/plan-f3614f2ecf63116f-82af6c940086.json";
const inv2 = (b, fn, seal = true) => jsonEdit(b, `${REC}run2.invocation.json`, fn, seal);
const inv1 = (b, fn, seal = true) => jsonEdit(b, `${REC}run1.invocation.json`, fn, seal);
/** Edit a brief and record its new digest in the invocation, so only the check meant to see the edit does. */
const briefWith = (b, n, fn) => {
  jsonEdit(b, `${REC}run${n}.brief.json`, fn);
  jsonEdit(b, `${REC}run${n}.invocation.json`, (i) => { i.brief.digest = `sha256:${sha(JSON.stringify(JSON.parse(b.files[`${REC}run${n}.brief.json`])))}`; });
};
const brief2 = (b, fn) => briefWith(b, 2, fn);
const log2 = (b, from, to) => textEdit(b, LOG2, from, to);
const log1 = (b, from, to) => textEdit(b, LOG1, from, to);
/** Edit a record the evidence hashed, and record its new hash in the evidence. */
const bound = (b, rel, key, fn) => {
  jsonEdit(b, `${REC}${rel}`, fn);
  jsonEdit(b, `${REC}run2.evidence.json`, (ev) => { ev[key] = sha(b.files[`${REC}${rel}`]); });
};
const reviewer = (b, fn) => bound(b, "run2.reviewer.json", "reviewerSha256", fn);
const effectsWith = (b, fn) => bound(b, "run2.effects.json", "effectsSha256", fn);
/** A different context file for run 1: the ledger entries are re-sealed to name it. */
const context1With = (b, fn) => {
  const rel = `${REC}run1.context.md`;
  put(b, rel, fn(b.files[rel]));
  for (const n of [1, 2]) entryEdit(b, n, (e) => { e.fileHash = `sha256:${sha(b.files[rel])}`; });
};
const shownItem = (id, over) => ({
  id, kind: "execution-record", effectiveKind: "execution-record", rank: 1, tier: 2, contentHash: `sha256:${"a".repeat(64)}`, bytes: 1, truncated: false,
  source: "working-tree", freshness: null, unverifiedClaim: false, overruledBy: [], ...over,
});
const renumber = (c) => { c.shown = c.shown.map((entry, index) => ({ ...entry, rank: index + 1 })); };
const gate = (b, fn) => jsonEdit(b, `${REC}gatekeeper-decision.json`, fn);
const closure = (b, fn) => jsonEdit(b, `${REC}closure-decision.json`, fn);
const spend = (b, fn) => jsonEdit(b, `${REC}gatekeeper-ledger.json`, (ledger) => fn(ledger.entries.filter((entry) => entry.phaseId === AGENCY_PHASE)));
const registered = (b, key, fn) => {
  b[key] = fn(b[key]);
};
const without = (text, block) => {
  if (!text.includes(block)) throw new Error("mutation target not found in a runner list");
  return text.replace(block, "\n];");
};

/** `expect` names text the rule's own problem must contain: proof the mutation is killed by that check and not by a cascade. */
const X = (name, rule, apply, also = [], expect = null) => ({ name, rule, apply, also, expect });

const MUTATIONS = [
  // EP-1 the files are the files
  X("a-changed-log-byte-is-refused", "EP-1", (b) => put(b, LOG2, b.files[LOG2].replace("Worker: claude-local", "Worker: claude-loca1"), false)),
  X("a-changed-first-log-byte-is-refused", "EP-1", (b) => put(b, LOG1, ` ${b.files[LOG1]}`, false)),
  X("a-changed-ledger-byte-is-refused", "EP-1", (b) => put(b, ledgerFile(3), `${b.files[ledgerFile(3)]}\n`, false)),
  X("a-changed-record-byte-is-refused", "EP-1", (b) => put(b, `${REC}closure-decision.json`, `${b.files[`${REC}closure-decision.json`]}\n`, false)),
  X("an-added-evidence-file-is-refused", "EP-1", (b) => put(b, `${REC}extra.json`, "{}", false)),
  X("an-added-evidence-file-in-the-manifest-too-is-refused", "EP-1", (b) => {
    b.files[`${REC}extra.json`] = "{}";
    manifestEdit(b, (m) => { m.files[`${REC}extra.json`] = `sha256:${sha("{}")}`; });
  }),
  X("a-missing-evidence-file-is-refused", "EP-1", (b) => drop(b, `${REC}run2.findings.json`, false), ["EP-6"]),
  X("an-evidence-file-dropped-from-both-folder-and-manifest-is-refused", "EP-1", (b) => drop(b, `${REC}run2.findings.json`), ["EP-6"]),
  X("a-file-left-out-of-the-manifest-is-refused", "EP-1", (b) => manifestEdit(b, (m) => { delete m.files[`${REC}run2.findings.json`]; })),
  X("a-manifest-hash-that-is-another-files-is-refused", "EP-1", (b) => manifestEdit(b, (m) => { m.files[LOG1] = m.files[LOG2]; })),
  X("a-manifest-entry-for-a-file-that-is-not-there-is-refused", "EP-1", (b) => manifestEdit(b, (m) => { m.files[`${REC}ghost.json`] = m.files[LOG1]; })),
  X("a-manifest-hash-that-is-not-sha256-is-refused", "EP-1", (b) => manifestEdit(b, (m) => { m.files[TIMES] = "abc"; })),
  X("a-manifest-path-that-leaves-the-folder-is-refused", "EP-1", (b) => manifestEdit(b, (m) => { m.files["../outside.json"] = m.files[LOG1]; })),
  X("a-manifest-with-another-schema-is-refused", "EP-1", (b) => manifestEdit(b, (m) => { m.schema = "other/1"; })),
  X("a-manifest-with-no-files-table-is-refused", "EP-1", (b) => manifestEdit(b, (m) => { delete m.files; })),
  X("notes-without-the-first-log-hash-are-refused", "EP-1", (b) => { b.notes = b.notes.split(sha(b.files[LOG1])).join("0".repeat(64)); }),
  X("notes-without-the-resume-log-hash-are-refused", "EP-1", (b) => { b.notes = b.notes.split(sha(b.files[LOG2])).join("0".repeat(64)); }),
  X("no-notes-file-is-refused", "EP-1", (b) => { b.notes = null; }, ["EP-8"]),
  X("a-log-that-is-not-utf8-is-refused", "EP-1", (b) => {
    const bytes = Buffer.from(b.files[LOG2], "utf8").toString("latin1").replace("Worker: claude-local", "Worker: claude-local\xff");
    const derived = deriveFiles({ [LOG2]: bytes });
    b.loadProblems.push(...derived.problems);
    put(b, LOG2, derived.files[LOG2]);
  }, [], "not valid UTF-8"),
  X("a-symbolic-link-in-the-evidence-is-refused", "EP-1", (b) => { b.links.push(`${REC}run2.brief.json`); }, [], "symbolic link"),
  X("a-symbolic-link-for-the-evidence-folder-is-refused", "EP-1", (b) => { b.links.push(EVIDENCE); }, [], "symbolic link"),
  // EP-2 it was cut off partway
  X("a-run-that-was-never-killed-is-refused", "EP-2", (b) => log1(b, /^\[cutoff\] worker wrote .*$/m, "[cutoff] the worker finished")),
  X("a-run-with-no-kill-line-is-refused", "EP-2", (b) => log1(b, /^\[cutoff\] killed at .*$/m, "")),
  X("a-killed-child-that-exited-zero-is-refused", "EP-2", (b) => log1(b, "child exited code 1", "child exited code 0")),
  X("a-run-with-no-child-exit-line-is-refused", "EP-2", (b) => log1(b, /^\[cutoff\] child exited code .*$/m, "")),
  X("a-run-that-wrote-all-three-files-is-refused", "EP-2", (b) => log1(b, '["site/humans.txt"]', '["site/humans.txt","projectos/validators/validate-site.cjs","projectos/validators/validate-site.fixtures.cjs"]')),
  X("a-log-for-another-process-is-refused", "EP-2", (b) => log1(b, "started pid 5704", "started pid 5705")),
  X("a-kill-before-the-start-is-refused", "EP-2", (b) => log1(b, /killed at \S+/, "killed at 2026-11-15T22:37:00.000Z")),
  X("a-cutoff-record-that-is-complete-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-work.v1.json`, (w) => { w.state = "COMPLETE"; })),
  X("a-cutoff-record-awaiting-the-gate-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-work.v1.json`, (w) => { w.state = "AWAITING_GATE"; })),
  X("a-cutoff-record-past-the-dispatch-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-work.v1.json`, (w) => { w.lastCompletedStep = "technical-continuation:push"; })),
  X("a-cutoff-record-of-another-session-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-work.v1.json`, (w) => { w.sessionId = "SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-00000000"; })),
  X("a-cutoff-record-that-names-a-gate-decision-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-work.v1.json`, (w) => { w.gateDecisionId = "GKDEC-x"; })),
  X("a-cutoff-phase-that-is-closed-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-phase-record.json`, (p) => { p.status = "closed"; })),
  X("a-cutoff-phase-that-is-awaiting-review-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-phase-record.json`, (p) => { p.status = "awaiting_review"; })),
  X("a-cutoff-phase-of-another-project-is-refused", "EP-2", (b) => jsonEdit(b, `${REC}cutoff-phase-record.json`, (p) => { p.project = "other"; })),
  X("a-cutoff-with-no-humans-file-is-refused", "EP-2", (b) => drop(b, `${REC}cutoff-humans.txt`, false), ["EP-1"]),
  X("a-cutoff-humans-file-with-other-words-is-refused", "EP-2", (b) => put(b, `${REC}cutoff-humans.txt`, "/* TEAM */\n")),
  X("a-reviewer-record-for-the-first-session-is-refused", "EP-2", (b) => reviewer(b, (r) => { r.sessionId = "SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e"; }), ["EP-6"]),
  X("a-first-run-record-of-an-evidence-is-refused", "EP-2", (b) => put(b, `${REC}run1.evidence.json`, "{}"), ["EP-1"]),
  X("a-first-run-on-another-commit-is-refused", "EP-2", (b) => inv1(b, (i) => { i.repository.head = "1".repeat(40); }), ["EP-4"]),
  X("a-first-run-of-another-phase-is-refused", "EP-2", (b) => inv1(b, (i) => { i.phaseId = "OTHER-PHASE"; })),
  X("a-first-session-not-minted-by-its-own-invocation-is-refused", "EP-2", (b) => inv1(b, (i) => { i.invocationId = "00000000deadbeef"; })),
  // EP-3 a fresh process, nothing relayed
  X("a-relayed-session-flag-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv.push("--session", "x"); })),
  X("a-relayed-objective-flag-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv.push("--objective", "finish it"); })),
  X("a-relayed-note-flag-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv.push("--note", "hint"); })),
  X("a-trailing-argument-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv.push("extra"); })),
  X("a-dry-run-with-no-execute-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv.pop(); })),
  X("another-subcommand-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv[2] = "run"; })),
  X("another-entry-script-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv[1] = "C:\\tmp\\evil.js"; })),
  X("another-interpreter-is-refused", "EP-3", (b) => inv2(b, (i) => { i.process.argv[0] = "C:\\bin\\python.exe"; })),
  X("a-first-run-with-a-relayed-flag-is-refused", "EP-3", (b) => inv1(b, (i) => { i.process.argv.push("--session", "x"); })),
  X("two-runs-of-different-entry-scripts-are-refused", "EP-3", (b) => inv1(b, (i) => { i.process.argv[1] = "C:\\other\\projectos.js"; })),
  X("a-reused-process-id-is-refused", "EP-3", (b) => { inv2(b, (i) => { i.process.pid = 5704; }); log2(b, "(pid 33112,", "(pid 5704,"); }, [], "same process id"),
  X("a-reused-parent-process-id-is-refused", "EP-3", (b) => { inv2(b, (i) => { i.process.ppid = 35388; }); log2(b, "parent 2732)", "parent 35388)"); }, [], "same parent process"),
  X("a-process-id-that-is-not-a-number-is-refused", "EP-3", (b) => { inv2(b, (i) => { i.process.pid = "33112"; }); }, [], "no integer pid"),
  X("a-process-that-is-its-own-parent-is-refused", "EP-3", (b) => { inv2(b, (i) => { i.process.ppid = i.process.pid; }); log2(b, "parent 2732)", "parent 33112)"); }, [], "its own parent"),
  X("a-brief-changed-after-its-digest-was-recorded-is-refused", "EP-3", (b) => jsonEdit(b, `${REC}run2.brief.json`, (v) => { v.phase.riskLevel = "high"; }), [], "digest"),
  X("a-first-brief-changed-after-its-digest-was-recorded-is-refused", "EP-3", (b) => jsonEdit(b, `${REC}run1.brief.json`, (v) => { v.phase.riskLevel = "high"; }), [], "digest"),
  X("a-recorded-brief-digest-that-is-another-hash-is-refused", "EP-3", (b) => inv2(b, (i) => { i.brief.digest = `sha256:${"0".repeat(64)}`; }), [], "digest"),
  X("a-recorded-first-brief-digest-that-is-another-hash-is-refused", "EP-3", (b) => inv1(b, (i) => { i.brief.digest = `sha256:${"0".repeat(64)}`; }), [], "digest"),
  X("a-brief-digest-of-the-pretty-printed-text-is-refused", "EP-3", (b) => inv2(b, (i) => { i.brief.digest = `sha256:${sha(JSON.stringify(JSON.parse(b.files[`${REC}run2.brief.json`]), null, 2))}`; }), [], "digest"),
  X("a-log-with-another-pid-is-refused", "EP-3", (b) => log2(b, "(pid 33112, parent 2732)", "(pid 33113, parent 2732)")),
  X("a-log-with-another-parent-is-refused", "EP-3", (b) => log2(b, "(pid 33112, parent 2732)", "(pid 33112, parent 2733)")),
  X("a-log-with-another-invocation-is-refused", "EP-3", (b) => log2(b, "Invocation: b7c6fada59098a27", "Invocation: 27a8176ef17ae4d3")),
  X("a-log-that-ran-two-continues-is-refused", "EP-3", (b) => log2(b, "Continuing SEO-AGENCY", "projectos continue: run again\nContinuing SEO-AGENCY")),
  X("a-log-with-no-continue-line-is-refused", "EP-3", (b) => log2(b, /^projectos continue: run.*$/m, "")),
  X("a-log-with-a-session-flag-is-refused", "EP-3", (b) => log2(b, "Continuing SEO", "projectos run --session abc\nContinuing SEO")),
  X("a-log-with-an-objective-flag-is-refused", "EP-3", (b) => log2(b, "Continuing SEO", "projectos run --objective abc\nContinuing SEO")),
  X("a-log-with-a-note-flag-is-refused", "EP-3", (b) => log2(b, "Continuing SEO", "projectos run --note abc\nContinuing SEO")),
  X("a-log-with-no-prior-work-line-is-refused", "EP-3", (b) => log2(b, /^Prior work: .*$/m, "")),
  X("a-log-with-prior-work-from-another-session-is-refused", "EP-3", (b) => log2(b, "session SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e", "session SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-99999999")),
  X("a-log-where-the-worker-did-not-start-fresh-is-refused", "EP-3", (b) => log2(b, "attempt 1: started claude-local; worker exited 0", "attempt 1: rejoined claude-local; worker exited 0"), ["EP-6"]),
  X("a-resume-that-rejoined-the-first-session-is-refused", "EP-3", (b) => inv2(b, (i) => { i.sessionId = "SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e"; }), ["EP-4", "EP-6"]),
  X("a-resume-whose-session-is-not-its-invocations-is-refused", "EP-3", (b) => inv2(b, (i) => { i.invocationId = "0000000000000000"; })),
  X("a-resume-with-the-first-invocation-id-is-refused", "EP-3", (b) => inv2(b, (i) => { i.invocationId = "27a8176ef17ae4d3"; })),
  X("a-resume-that-is-not-live-is-refused", "EP-3", (b) => inv2(b, (i) => { i.executionMode = "dry-run"; })),
  X("a-resume-session-record-of-another-invocation-is-refused", "EP-3", (b) => jsonEdit(b, `${REC}run2.session.json`, (s) => { s.invocationId = "27a8176ef17ae4d3"; })),
  X("a-resume-worker-that-timed-out-is-refused", "EP-3", (b) => jsonEdit(b, `${REC}run2.session.json`, (s) => { s.timedOut = true; })),
  X("a-brief-with-a-field-outside-the-known-keys-is-refused", "EP-3", (b) => brief2(b, (v) => { v.objective = "do this instead"; })),
  X("a-brief-phase-with-an-added-field-is-refused", "EP-3", (b) => brief2(b, (v) => { v.phase.note = "remember to use blue"; })),
  X("a-brief-records-table-with-an-added-field-is-refused", "EP-3", (b) => brief2(b, (v) => { v.records.hintPath = "x"; })),
  X("a-brief-with-reworded-phase-text-is-refused", "EP-3", (b) => brief2(b, (v) => { v.phase.description += " Also do X."; })),
  X("a-brief-with-an-added-acceptance-line-is-refused", "EP-3", (b) => brief2(b, (v) => { v.phase.acceptanceCriteria.push("The footer is blue."); })),
  X("a-brief-record-path-outside-the-execution-folder-is-refused", "EP-3", (b) => brief2(b, (v) => { v.records.briefPath = "C:\\dev\\SEOAgency/notes/x.brief.json"; })),
  X("a-brief-record-path-naming-another-session-is-refused", "EP-3", (b) => brief2(b, (v) => { v.records.findingsPath = v.records.findingsPath.replace("b7c6fada", "27a8176e"); })),
  X("a-brief-context-path-of-another-kind-is-refused", "EP-3", (b) => brief2(b, (v) => { v.records.contextPath = v.records.contextPath.replace(".context.md", ".context.txt"); })),
  X("a-brief-effects-contract-with-another-field-is-refused", "EP-3", (b) => brief2(b, (v) => { v.records.effectsContract.requiredFields.pop(); })),
  X("a-brief-for-another-invocation-is-refused", "EP-3", (b) => brief2(b, (v) => { v.briefId = "SEO-AGENCY-MEMORY-PROOF1A@" + "1".repeat(40); })),
  X("an-evidence-for-another-session-is-refused", "EP-3", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.sessionId = "SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e"; })),
  X("a-stored-context-path-of-another-session-is-refused", "EP-3", (b) => run2Edit(b, (c) => { if ("contextPath" in c) c.contextPath = c.contextPath.replace("b7c6fada", "27a8176e"); }), ["EP-4"]),
  X("a-resume-that-started-before-the-kill-is-refused", "EP-3", (b) => inv2(b, (i) => { i.createdAt = "2026-11-15T22:37:30.000Z"; })),
  X("a-times-file-that-runs-backwards-is-refused", "EP-3", (b) => put(b, TIMES, "2026-11-15T22:39:53Z\n2026-11-15T22:38:05Z\n"), ["EP-7"]),
  // EP-4 the retrieved state was used
  X("a-flipped-previous-hash-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.prevHash = `sha256:${"0".repeat(64)}`; }, false)),
  X("a-changed-entry-hash-is-refused", "EP-4", (b) => entryEdit(b, 2, (e) => { e.entryHash = `sha256:${"1".repeat(64)}`; }, false)),
  X("a-body-edit-with-no-new-hash-is-refused", "EP-4", (b) => entryEdit(b, 2, (e) => { e.estimatedTokens += 1; }, false)),
  X("a-gap-in-the-sequence-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.seq = 5; }, false)),
  X("a-first-entry-that-names-a-previous-hash-is-refused", "EP-4", (b) => entryEdit(b, 1, (e) => { e.prevHash = `sha256:${"2".repeat(64)}`; }, false)),
  X("a-ledger-with-the-fourth-entry-gone-is-refused", "EP-4", (b) => drop(b, ledgerFile(4)), ["EP-1"]),
  X("a-ledger-entry-with-another-schema-is-refused", "EP-4", (b) => entryEdit(b, 2, (e) => { e.schema = "other/1"; })),
  X("a-ledger-entry-with-an-added-field-is-refused", "EP-4", (b) => entryEdit(b, 2, (e) => { e.note = "x"; })),
  X("a-retrieval-for-the-wrong-session-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.sessionId = "SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e"; })),
  X("a-placement-for-the-wrong-envelope-is-refused", "EP-4", (b) => entryEdit(b, 4, (e) => { e.envelopeId = "ENV-000000000000000000000000"; })),
  X("one-envelope-for-both-runs-is-refused", "EP-4", (b) => { for (const n of [3, 4]) entryEdit(b, n, (e) => { e.envelopeId = "ENV-cae847da44936a98c9bd3fd5"; }); }),
  X("a-retrieval-for-another-tenant-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.tenant = "other-tenant"; })),
  X("a-retrieval-for-another-project-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.project = "other-project"; })),
  X("a-retrieval-at-another-commit-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.headCommit = "3".repeat(40); })),
  X("a-retrieval-recorded-as-a-placement-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.event = "placed"; })),
  X("a-placement-of-the-second-attempt-is-refused", "EP-4", (b) => entryEdit(b, 4, (e) => { e.attempt = 2; })),
  X("a-placed-file-that-is-not-the-stored-one-is-refused", "EP-4", (b) => entryEdit(b, 4, (e) => { e.fileHash = `sha256:${"4".repeat(64)}`; })),
  X("a-placement-that-shows-another-item-is-refused", "EP-4", (b) => entryEdit(b, 4, (e) => { item(e, RESUME).contentHash = `sha256:${"5".repeat(64)}`; })),
  X("a-refused-retrieval-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { e.refusal = "CONTEXT_REFUSED"; })),
  X("a-ledger-out-of-time-order-is-refused", "EP-4", (b) => entryEdit(b, 2, (e) => { e.at = "2026-11-15T22:40:00.000Z"; })),
  X("a-stored-context-with-another-shown-list-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.shown.pop(); })),
  X("a-stored-ledger-hash-that-is-not-the-retrieval-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.ledger.entryHash = `sha256:${"6".repeat(64)}`; })),
  X("a-stored-ledger-number-that-is-not-the-retrieval-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.ledger.seq = 2; })),
  X("a-stored-newest-that-is-not-the-placement-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.ledgerNewest.entryHash = `sha256:${"7".repeat(64)}`; })),
  X("a-stored-file-hash-that-is-not-the-placed-one-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.fileHash = `sha256:${"8".repeat(64)}`; })),
  X("a-stored-attempt-list-that-is-not-the-placement-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.placedAttempts = [1, 2]; })),
  X("a-stored-context-for-another-tenant-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.tenant = "other-tenant"; })),
  X("a-stored-context-for-another-envelope-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.envelopeId = "ENV-000000000000000000000000"; })),
  X("a-stored-context-that-is-another-schema-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.schema = "other/1"; })),
  X("a-stored-withheld-list-that-differs-is-refused", "EP-4", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.storedContext.withheld = []; })),
  X("a-shown-set-without-the-dirty-paths-is-refused", "EP-4", (b) => run2Edit(b, (c) => { c.shown = c.shown.filter((entry) => entry.id !== RESUME); })),
  X("a-shown-set-without-the-cut-off-attempt-is-refused", "EP-4", (b) => run2Edit(b, (c) => { c.shown = c.shown.filter((entry) => entry.id !== CUT).map((entry, index) => ({ ...entry, rank: index + 1 })); })),
  X("a-first-run-shown-the-dirty-paths-is-refused", "EP-4", (b) => {
    const resume = item(JSON.parse(b.files[ledgerFile(3)]), RESUME);
    for (const n of [1, 2]) entryEdit(b, n, (e) => { e.shown.push({ ...resume, rank: e.shown.length + 1 }); }, n === 2);
  }),
  X("a-first-run-shown-the-cut-off-attempt-is-refused", "EP-4", (b) => {
    const resume = item(JSON.parse(b.files[ledgerFile(3)]), CUT);
    for (const n of [1, 2]) entryEdit(b, n, (e) => { e.shown.push({ ...resume, rank: e.shown.length + 1 }); }, n === 2);
  }),
  X("a-log-item-count-that-is-not-the-ledgers-is-refused", "EP-4", (b) => log2(b, "Stored context: 4 item(s)", "Stored context: 5 item(s)")),
  X("a-log-decision-count-that-is-not-the-ledgers-is-refused", "EP-4", (b) => log2(b, "and 0 approved decision(s)", "and 2 approved decision(s)")),
  X("a-log-withheld-count-that-is-not-the-ledgers-is-refused", "EP-4", (b) => log2(b, "1 withheld", "0 withheld")),
  X("a-log-for-another-tenant-and-project-is-refused", "EP-4", (b) => log2(b, "for agency-business/seo-agency", "for other-tenant/other-project")),
  X("a-log-context-file-of-another-session-is-refused", "EP-4", (b) => log2(b, /\(\.projectops\/execution\/[^)]*\.context\.md\)/, "(.projectops/execution/SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e.context.md)")),
  X("a-log-with-no-stored-context-line-is-refused", "EP-4", (b) => log2(b, /^Stored context: .*$/m, "")),
  X("a-retrieval-with-no-decisions-list-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { delete e.decisions; }), [], "no decisions list"),
  X("a-retrieval-with-no-shown-list-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { delete e.shown; }), [], "no shown list"),
  X("a-retrieval-with-no-withheld-list-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { delete e.withheld; }), [], "no withheld list"),
  X("a-retrieval-with-no-omitted-list-is-refused", "EP-4", (b) => entryEdit(b, 3, (e) => { delete e.omitted; }), [], "no omitted list"),
  X("a-placement-whose-lists-are-not-lists-is-refused", "EP-4", (b) => entryEdit(b, 4, (e) => { e.shown = "x"; e.decisions = 7; }), [], "no decisions list"),
  X("a-first-run-context-file-changed-is-refused", "EP-4", (b) => put(b, `${REC}run1.context.md`, `${b.files[`${REC}run1.context.md`]}extra\n`), [], "not the file the ledger says"),
  X("a-first-run-ledger-file-hash-that-is-not-the-files-is-refused", "EP-4", (b) => entryEdit(b, 2, (e) => { e.fileHash = `sha256:${"b".repeat(64)}`; }), [], "not the file the ledger says"),
  X("a-first-run-context-file-naming-another-session-is-refused", "EP-4", (b) => context1With(b, (t) => t.split("SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e").join("SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-99999999")), [], "does not name run 1"),
  X("a-first-run-context-file-without-a-shown-item-is-refused", "EP-4", (b) => context1With(b, (t) => t.split(".projectops/closure/decisions/SEO-AGENCY-SITE-CHECK3A.json").join("a-decision")), [], "does not contain the item"),
  X("no-first-run-context-file-is-refused", "EP-4", (b) => drop(b, `${REC}run1.context.md`), ["EP-1"], "run1.context.md is missing"),
  // EP-5 worker text is not a decision
  X("a-resumed-item-called-a-committed-decision-is-refused", "EP-5", (b) => run2Edit(b, (c) => { const it = item(c, RESUME); it.kind = "committed-decision"; it.effectiveKind = "committed-decision"; it.tier = 0; })),
  X("a-resumed-item-called-approved-memory-is-refused", "EP-5", (b) => run2Edit(b, (c) => { const it = item(c, RESUME); it.kind = "approved-memory"; it.effectiveKind = "approved-memory"; it.tier = 1; })),
  X("a-resumed-item-whose-effective-kind-is-a-decision-is-refused", "EP-5", (b) => run2Edit(b, (c) => { const it = item(c, CUT); it.effectiveKind = "committed-decision"; it.tier = 0; })),
  X("a-resumed-item-called-plan-memory-is-refused", "EP-5", (b) => run2Edit(b, (c) => { const it = item(c, CUT); it.kind = "plan-memory"; it.effectiveKind = "plan-memory"; it.tier = 1; })),
  X("a-resumed-item-ranked-zero-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, RESUME).rank = 0; })),
  X("a-resumed-item-ranked-before-the-plan-memory-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.shown = [c.shown[0], item(c, CUT), c.shown[1], item(c, RESUME)].map((entry, index) => ({ ...entry, rank: index + 1 })); })),
  X("a-resumed-item-ranked-equal-to-the-plan-memory-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, CUT).rank = 2; })),
  X("a-resumed-item-in-the-memory-tier-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, RESUME).tier = 1; })),
  X("a-resumed-item-in-the-decision-tier-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, RESUME).tier = 0; })),
  X("a-resumed-item-sourced-as-committed-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, CUT).source = "committed"; })),
  X("a-resumed-item-with-an-unknown-source-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, CUT).source = "model"; })),
  X("a-resumed-item-with-an-unknown-kind-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, CUT).kind = "chat"; })),
  X("a-resumed-item-with-no-tier-is-refused", "EP-5", (b) => run2Edit(b, (c) => { delete item(c, CUT).tier; }), ["EP-4"]),
  X("a-committed-decision-sourced-from-the-working-tree-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, DECISION).source = "working-tree"; })),
  X("a-committed-decision-overruled-by-a-resumed-item-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, DECISION).overruledBy = [RESUME]; })),
  X("approved-memory-from-the-working-tree-is-refused", "EP-5", (b) => run2Edit(b, (c) => { const it = item(c, PLAN); it.kind = "approved-memory"; it.effectiveKind = "approved-memory"; it.source = "loop-observed"; })),
  X("a-decision-list-naming-a-resumed-item-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.decisions = [{ hash: item(c, RESUME).contentHash, target: "memory" }]; }), ["EP-4"]),
  X("a-decision-with-no-hash-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.decisions = [{ hash: "abc", target: "memory" }]; }), ["EP-4"]),
  X("a-decision-for-a-worker-target-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.decisions = [{ hash: `sha256:${"9".repeat(64)}`, target: "worker" }]; }), ["EP-4"]),
  X("worker-text-shown-to-an-untainted-run-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.taintsRun = false; })),
  X("a-shown-list-with-a-gap-in-its-ranks-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, RESUME).rank = 9; })),
  X("a-resumed-item-whose-tier-is-not-its-kinds-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, CUT).tier = 3; })),
  X("a-worker-note-at-rank-one-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.shown.unshift(shownItem("worker-notes:x", {})); renumber(c); }), ["EP-4"], "worker-notes:x"),
  X("a-worker-note-ranked-below-the-decision-only-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.shown.splice(1, 0, shownItem("worker-notes:y", {})); renumber(c); }), ["EP-4"], "worker-notes:y"),
  X("a-worker-note-called-a-finding-is-refused", "EP-5", (b) => run2Edit(b, (c) => { const it = item(c, CUT); it.kind = "finding"; it.effectiveKind = "finding"; }), [], "not an execution record"),
  X("a-shown-list-with-no-committed-decision-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.shown = c.shown.filter((entry) => entry.id !== DECISION); renumber(c); }), ["EP-4"], "no committed decision"),
  X("a-shown-list-with-tiers-out-of-order-is-refused", "EP-5", (b) => run2Edit(b, (c) => { c.shown = [c.shown[0], item(c, CUT), c.shown[1], item(c, RESUME)]; renumber(c); }), [], "tiers are not non-decreasing"),
  X("a-committed-decision-sourced-from-an-index-is-refused", "EP-5", (b) => run2Edit(b, (c) => { item(c, DECISION).source = "index"; }), [], "only committed bytes make a decision"),
  X("a-first-run-that-is-not-tainted-is-refused", "EP-5", (b) => { entryEdit(b, 1, (e) => { e.taintsRun = false; }); entryEdit(b, 2, (e) => { e.taintsRun = false; }); }, [], "run 1"),
  // EP-6 it reached closed by itself
  X("a-run-with-no-first-validator-pass-is-refused", "EP-6", (b) => log2(b, "  PASS validator validate-site\n", ""), [], "attempt section"),
  X("validator-passes-only-after-the-review-are-refused", "EP-6", (b) => {
    log2(b, "  PASS validator validate-site\n", "");
    log2(b, "  PASS validator validate-site@phase-copy\n", "");
    log2(b, "  independent review by codex-reviewer: APPROVE\n", "  independent review by codex-reviewer: APPROVE\n  PASS validator validate-site\n  PASS validator validate-site@phase-copy\n");
  }, [], "attempt section"),
  X("a-run-with-no-phase-copy-validator-pass-is-refused", "EP-6", (b) => log2(b, "  PASS validator validate-site@phase-copy\n", ""), [], "validate-site@phase-copy"),
  X("a-run-whose-review-did-not-approve-is-refused", "EP-6", (b) => log2(b, "independent review by codex-reviewer: APPROVE", "independent review by codex-reviewer: REQUEST_CHANGES")),
  X("a-run-with-no-gatekeeper-approval-is-refused", "EP-6", (b) => log2(b, "approved continuation", "stopped continuation")),
  X("a-run-that-never-closed-is-refused", "EP-6", (b) => log2(b, "awaiting_closure -> closed", "awaiting_closure -> awaiting_closure")),
  X("a-run-that-is-not-five-of-five-is-refused", "EP-6", (b) => log2(b, "5/5 complete", "4/5 complete")),
  X("a-run-that-exited-non-zero-is-refused", "EP-6", (b) => log2(b, /^exit=0$/m, "exit=1")),
  X("a-run-with-a-line-after-the-exit-is-refused", "EP-6", (b) => log2(b, /exit=0\s*$/, "exit=0\nextra line\n")),
  X("a-second-owner-stop-is-refused", "EP-6", (b) => log2(b, "carrying on:", "STOPPED (OWNER_DECISION_REQUIRED): the owner must close it\ncarrying on:")),
  X("an-owner-stop-that-is-not-the-closure-handover-is-refused", "EP-6", (b) => log2(b, "STOPPED (OWNER_DECISION_REQUIRED): phase 'SEO-AGENCY-MEMORY-PROOF1A' is awaiting_closure; that is not a state the loop may move it from", "STOPPED (OWNER_DECISION_REQUIRED): the owner must accept the work")),
  X("a-run-whose-steps-are-out-of-order-is-refused", "EP-6", (b) => {
    const text = b.files[LOG2];
    const line = "  gatekeeper: the gatekeeper reviewed CONTINUATION_READY and approved continuation\n";
    put(b, LOG2, text.replace(line, "").replace("exit=0", `${line}exit=0`));
  }),
  X("a-run-with-a-refusal-line-is-refused", "EP-6", (b) => log2(b, "Workforce: not active", "REFUSED (X): nothing\nWorkforce: not active")),
  X("a-reviewer-that-is-not-provider-distinct-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.providerDistinct = false; })),
  X("a-reviewer-of-the-implementers-kind-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.reviewerKind = "claude-code-cli"; })),
  X("a-reviewer-that-is-the-implementer-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.reviewerWorkerId = r.implementerWorkerId; })),
  X("a-reviewer-verdict-that-is-not-approve-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.verdict = "REQUEST_CHANGES"; })),
  X("a-reviewer-with-findings-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.findings = [{ id: "F1" }]; })),
  X("a-review-requested-but-not-performed-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.reviewsPerformed = []; })),
  X("a-reviewer-record-for-another-session-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.sessionId = "SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-99999999"; })),
  X("a-reviewer-record-at-another-commit-is-refused", "EP-6", (b) => reviewer(b, (r) => { r.baseHead = "4".repeat(40); })),
  X("a-failed-validator-check-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.checks[0].passed = false; })),
  X("a-validator-check-with-a-non-zero-exit-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.checks[1].exitCode = 1; })),
  X("a-prohibited-effect-is-refused", "EP-6", (b) => effectsWith(b, (e) => { e.productionTouched = true; })),
  X("an-effects-record-with-a-missing-field-is-refused", "EP-6", (b) => effectsWith(b, (e) => { delete e.rawSecretStored; })),
  X("an-effects-record-changed-after-the-evidence-hashed-it-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.effects.json`, () => {}), [], "effectsSha256"),
  X("a-findings-record-changed-after-the-evidence-hashed-it-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.findings.json`, () => {}), [], "findingsSha256"),
  X("a-reviewer-record-changed-after-the-evidence-hashed-it-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.reviewer.json`, () => {}), [], "reviewerSha256"),
  X("an-evidence-effects-hash-that-is-another-hash-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.effectsSha256 = "0".repeat(64); }), [], "effectsSha256"),
  X("an-evidence-findings-hash-that-is-another-hash-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.findingsSha256 = "0".repeat(64); }), [], "findingsSha256"),
  X("an-evidence-reviewer-hash-that-is-another-hash-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}run2.evidence.json`, (e) => { e.reviewerSha256 = "0".repeat(64); }), [], "reviewerSha256"),
  X("a-closure-decided-by-a-person-is-refused", "EP-6", (b) => closure(b, (c) => { c.decidedBy = "Murad"; }), [], "decided by"),
  X("a-closure-decided-by-an-owner-ish-string-is-refused", "EP-6", (b) => closure(b, (c) => { c.decidedBy = "ChatGPT (typed by the owner)"; }), [], "decided by"),
  X("a-gatekeeper-decided-by-a-person-is-refused", "EP-6", (b) => gate(b, (g) => { g.decidedBy = "Murad"; }), [], "gatekeeper decision was decided by"),
  X("a-gatekeeper-decision-typed-by-hand-is-refused", "EP-6", (b) => gate(b, (g) => { g.provenance = "OwnerTypedByHand"; }), [], "provenance"),
  X("a-gatekeeper-decision-with-no-provenance-is-refused", "EP-6", (b) => gate(b, (g) => { delete g.provenance; }), [], "provenance"),
  X("a-log-where-the-gatekeeper-answer-is-not-the-brokers-is-refused", "EP-6", (b) => log2(b, "gatekeeper decision provenance: InstallationBrokerProviderAnswer", "gatekeeper decision provenance: OwnerTypedByHand"), [], "broker's provider answer"),
  X("a-log-where-the-closure-answer-is-not-the-brokers-is-refused", "EP-6", (b) => log2(b, "closure decision provenance: InstallationBrokerProviderAnswer", "closure decision provenance: OwnerTypedByHand"), [], "broker's provider answer"),
  X("a-final-work-record-that-is-not-complete-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}final-work.v1.json`, (w) => { w.state = "AWAITING_GATE"; })),
  X("a-final-work-record-asking-for-the-owner-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}final-work.v1.json`, (w) => { w.ownerRequired = true; })),
  X("a-final-work-record-of-the-first-session-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}final-work.v1.json`, (w) => { w.sessionId = "SEO-AGENCY-MEMORY-PROOF1A-0ade0a9a7195-27a8176e"; })),
  X("a-final-work-record-with-another-gate-decision-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}final-work.v1.json`, (w) => { w.gateDecisionId = "GKDEC-other"; })),
  X("a-final-phase-that-is-not-closed-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}final-phase-record.json`, (p) => { p.status = "awaiting_closure"; })),
  X("a-final-phase-with-no-closing-step-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}final-phase-record.json`, (p) => { p.history.pop(); })),
  X("a-final-phase-closed-on-another-decision-is-refused", "EP-6", (b) => jsonEdit(b, `${REC}final-phase-record.json`, (p) => { p.history[p.history.length - 1].note = "closed by hand"; })),
  X("a-closure-decision-that-holds-is-refused", "EP-6", (b) => closure(b, (c) => { c.decision = "hold"; })),
  X("a-closure-decision-for-another-phase-is-refused", "EP-6", (b) => closure(b, (c) => { c.phaseId = "OTHER-PHASE"; })),
  X("a-closure-decision-for-another-project-is-refused", "EP-6", (b) => closure(b, (c) => { c.projectId = "other"; })),
  X("a-closure-decision-with-an-owner-accepted-finding-is-refused", "EP-6", (b) => closure(b, (c) => { c.ownerAcceptedFindings = ["F1"]; })),
  X("a-closure-decided-by-the-owner-is-refused", "EP-6", (b) => closure(b, (c) => { c.decidedBy = "owner"; })),
  X("a-closure-decision-that-is-not-the-logged-request-is-refused", "EP-6", (b) => closure(b, (c) => { c.decisionId = "CLREQ-000000000000000000000000"; }), []),
  X("a-closure-decision-of-another-subject-is-refused", "EP-6", (b) => closure(b, (c) => { c.evidenceSubjectHead = "6".repeat(40); })),
  X("a-gatekeeper-that-did-not-approve-is-refused", "EP-6", (b) => gate(b, (g) => { g.decision = "ESCALATE_TO_OWNER"; })),
  X("a-gatekeeper-that-needed-the-owner-is-refused", "EP-6", (b) => gate(b, (g) => { g.ownerApprovalRequired = true; })),
  X("a-gatekeeper-that-allowed-closure-is-refused", "EP-6", (b) => gate(b, (g) => { g.allowedActions.push("phase-closure"); })),
  X("a-gatekeeper-decision-that-is-not-the-logged-request-is-refused", "EP-6", (b) => gate(b, (g) => { g.decisionId = "GKDEC-GKREQ-000000000000000000000000"; })),
  X("a-gatekeeper-decision-for-another-phase-is-refused", "EP-6", (b) => gate(b, (g) => { g.phaseId = "OTHER-PHASE"; })),
  X("a-humans-file-that-is-not-the-asked-five-lines-is-refused", "EP-6", (b) => put(b, `${REC}final-humans.txt`, "/* TEAM */\nContact: hello@example.com\n")),
  // EP-7 it cost what it said
  X("a-spend-over-the-cap-is-refused", "EP-7", (b) => {
    spend(b, (entries) => { entries[0].costMicroUsd = 1_500_000 - 6196 + 1; });
    log2(b, "recorded 384 micro-USD", `recorded ${1_500_000 - 6196 + 1} micro-USD`);
    log2(b, "budget OK: month 384", `budget OK: month ${1_500_000 - 6196 + 1}`);
  }),
  X("a-spend-of-both-calls-over-the-cap-is-refused", "EP-7", (b) => spend(b, (entries) => { entries.forEach((entry) => { entry.costMicroUsd = 1_000_000; }); })),
  X("a-ledger-cost-that-is-not-the-logged-gatekeeper-cost-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[0].costMicroUsd = 385; })),
  X("a-ledger-cost-that-is-not-the-logged-closure-cost-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[1].costMicroUsd = 6197; })),
  X("a-log-amount-that-is-not-the-ledgers-is-refused", "EP-7", (b) => log2(b, "this call cost 6196 micro-USD", "this call cost 6195 micro-USD")),
  X("a-missing-closure-spend-entry-is-refused", "EP-7", (b) => jsonEdit(b, `${REC}gatekeeper-ledger.json`, (l) => { l.entries = l.entries.filter((entry) => !String(entry.requestId).startsWith("CLREQ-6aa39")); })),
  X("an-extra-spend-entry-for-the-phase-is-refused", "EP-7", (b) => jsonEdit(b, `${REC}gatekeeper-ledger.json`, (l) => { l.entries.push({ ...l.entries[l.entries.length - 1], requestId: "GKREQ-ffffffffffffffffffffffff" }); })),
  X("a-spend-entry-with-another-request-id-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[0].requestId = "GKREQ-000000000000000000000000"; })),
  X("a-spend-entry-in-another-project-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[0].projectId = "other"; })),
  X("a-negative-cost-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[0].costMicroUsd = -384; })),
  X("a-fractional-cost-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[0].costMicroUsd = 384.5; })),
  X("a-cost-written-as-text-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[0].costMicroUsd = "384"; })),
  X("a-spend-recorded-outside-the-run-is-refused", "EP-7", (b) => spend(b, (entries) => { entries[1].at = "2026-10-30T17:42:14.902Z"; })),
  X("a-month-figure-that-is-not-the-first-calls-cost-is-refused", "EP-7", (b) => log2(b, "budget OK: month 384", "budget OK: month 385")),
  X("a-log-with-no-gatekeeper-spend-line-is-refused", "EP-7", (b) => log2(b, /^gatekeeper answered; recorded .*$/m, "")),
  // EP-8 this phase changes no product
  X("notes-that-do-not-say-no-product-code-are-refused", "EP-8", (b) => { b.notes = b.notes.split("no product code").join("some product code"); }),
  X("notes-that-do-not-say-no-model-call-are-refused", "EP-8", (b) => { b.notes = b.notes.split("no model call").join("a model call"); }),
  X("notes-that-do-not-say-d4-stays-are-refused", "EP-8", (b) => { b.notes = b.notes.split("does not lift D4").join("lifts D4"); }),
  X("a-validator-that-imports-core-source-is-refused", "EP-8", (b) => { b.selfSource += `\nconst coreSource = req${"uire"}("../core/src/index.js");\n`; }, [], "must load exactly"),
  X("a-validator-that-imports-agent-source-is-refused", "EP-8", (b) => { b.selfSource += `\nconst agentSource = req${"uire"}("../agent/src/context/contextManager.js");\n`; }, [], "must load exactly"),
  X("a-validator-that-imports-a-package-is-refused", "EP-8", (b) => { b.selfSource += `\nconst tool = req${"uire"}("vitest");\n`; }, [], "must load exactly"),
  X("a-validator-that-imports-the-os-module-is-refused", "EP-8", (b) => { b.selfSource += `\nconst system = req${"uire"}("os");\n`; }, [], "must load exactly"),
  X("a-validator-that-loads-a-module-twice-is-refused", "EP-8", (b) => { b.selfSource += `\nconst again = req${"uire"}("fs");\n`; }, [], "must load exactly"),
  X("a-validator-that-drops-an-import-is-refused", "EP-8", (b) => { b.selfSource = b.selfSource.replace(`const crypto = req${"uire"}("crypto");`, "const crypto = null;"); }, [], "must load exactly"),
  X("a-validator-that-imports-by-a-computed-name-is-refused", "EP-8", (b) => { b.selfSource += `\nconst name = "f" + "s";\nreq${"uire"}(name);\n`; }, [], "module loader"),
  X("a-validator-that-aliases-the-module-loader-is-refused", "EP-8", (b) => { b.selfSource += `\nconst load = req${"uire"};\nload("fs");\n`; }, [], "module loader"),
  X("a-validator-that-calls-the-module-loader-through-a-property-is-refused", "EP-8", (b) => { b.selfSource += `\nreq${"uire"}.resolve("fs");\n`; }, [], "module loader"),
  X("a-validator-that-writes-a-file-is-refused", "EP-8", (b) => { b.selfSource += `\nf${"s"}.write${"FileSync"}("x", "y");\n`; }, [], "s.writeFileSync"),
  X("a-validator-that-creates-a-folder-is-refused", "EP-8", (b) => { b.selfSource += `\nf${"s"}.mk${"dirSync"}("x");\n`; }, [], "s.mkdirSync"),
  X("a-validator-that-removes-a-file-is-refused", "EP-8", (b) => { b.selfSource += `\nf${"s"}.rm${"Sync"}("x");\n`; }, [], "s.rm" + "Sync"),
  X("a-validator-that-names-a-write-without-fs-is-refused", "EP-8", (b) => { b.selfSource += `\nconst sink = { write${"File"}: 1 };\n`; }, [], "word"),
  X("a-validator-that-names-a-process-spawner-is-refused", "EP-8", (b) => { b.selfSource += `\nconst spawner = "child_" + "process";\nconst child_${"process"} = 1;\n`; }, [], "word"),
  X("a-validator-that-calls-the-network-is-refused", "EP-8", (b) => { b.selfSource += `\nfe${"tch"}("x");\n`; }, [], "word"),
  X("a-validator-that-names-the-web-module-is-refused", "EP-8", (b) => { b.selfSource += `\nconst h = ht${"tp"};\n`; }, [], "word"),
  X("a-validator-that-evaluates-text-is-refused", "EP-8", (b) => { b.selfSource += `\nev${"al"}("1");\n`; }, [], "word"),
  X("a-validator-that-builds-code-from-text-is-refused", "EP-8", (b) => { b.selfSource += `\nnew Fun${"ction"}("return 1");\n`; }, [], "builds code"),
  X("a-validator-that-imports-dynamically-is-refused", "EP-8", (b) => { b.selfSource += `\nim${"port"}("x");\n`; }, [], "builds code"),
  // EP-9 register it last
  X("a-validator-missing-from-validate-all-is-refused", "EP-9", (b) => registered(b, "validateAll", (t) => without(t, MODULE_BLOCK))),
  X("a-validator-missing-from-the-cached-runner-is-refused", "EP-9", (b) => registered(b, "cachedRunner", (t) => without(t, MODULE_BLOCK))),
  X("a-validator-listed-twice-is-refused", "EP-9", (b) => registered(b, "cachedRunner", (t) => t.replace(MODULE_BLOCK, () => `,\n  "${THIS_VALIDATOR}"${MODULE_BLOCK}`))),
  X("a-validator-registered-before-the-connector-entry-is-refused", "EP-9", (b) => registered(b, "validateAll", (t) => t.replace("  // PROJECTOS-CONNECTOR-CONTRACT1A", () => "  " + MODULE_COMMENT + "\n  \"" + THIS_VALIDATOR + "\",\n  // PROJECTOS-CONNECTOR-CONTRACT1A").replace(MODULE_BLOCK, () => "\n];"))),
  X("a-validator-followed-by-another-entry-is-refused", "EP-9", (b) => registered(b, "cachedRunner", (t) => t.replace(MODULE_BLOCK, () => `${MODULE_BLOCK.slice(0, -3)},\n  "val-zzz"\n];`))),
  X("a-validator-with-no-comment-line-is-refused", "EP-9", (b) => registered(b, "validateAll", (t) => t.replace(MODULE_BLOCK, () => `,\n  "${THIS_VALIDATOR}"\n];`))),
  X("a-validator-with-another-phases-comment-is-refused", "EP-9", (b) => registered(b, "cachedRunner", (t) => t.replace(MODULE_BLOCK, () => `,\n  // PROJECTOS-SOMETHING-ELSE - not this one.\n  "${THIS_VALIDATOR}"\n];`))),
  X("two-lists-in-another-order-are-refused", "EP-9", (b) => registered(b, "cachedRunner", (t) => t.replace('  "val-projectos-skills-adopt1a",\n', () => '').replace('  "val-projectos-resume1a",\n', () => '  "val-projectos-resume1a",\n  "val-projectos-skills-adopt1a",\n'))),
  X("a-runner-with-no-modules-list-is-refused", "EP-9", (b) => registered(b, "validateAll", (t) => t.replace("const MODULES = [", () => "const OTHER = ["))),
];

// ---------------------------------------------------------------------------------------------------------

const MAX_RULE_MS = 200;
const HOSTILE_BYTES = 262144;

/** Hostile logs, each 256 KiB: a rule that reads a log must stay linear on all of them. */
function hostileLogs() {
  return {
    "blank lines": "\n".repeat(HOSTILE_BYTES),
    "CRLF blank lines": "\r\n".repeat(HOSTILE_BYTES / 2),
    "space-only lines": " \n".repeat(HOSTILE_BYTES / 2),
    "one very long line": "a".repeat(HOSTILE_BYTES),
    "a long line of the prior-work shape": `Prior work: ${" session".repeat(HOSTILE_BYTES / 8)}`,
    "a long line of the cut-off shape": `[cutoff] worker wrote [${"[]".repeat(HOSTILE_BYTES / 4)}`,
    "many lines that start like a real one": "Stored context: 1 item(s) and\n".repeat(HOSTILE_BYTES / 30),
  };
}

function timingErrors(base) {
  const errors = [];
  let runs = 0;
  for (const [name, text] of Object.entries(hostileLogs())) {
    const copy = structuredClone(base);
    copy.files[LOG1] = text;
    copy.files[LOG2] = text;
    for (const [id, rule] of RULES) {
      if (!["EP-2", "EP-3", "EP-4", "EP-6", "EP-7"].includes(id)) continue;
      const started = Date.now();
      try {
        rule(copy);
      } catch (error) {
        errors.push(`EP-T: ${id} threw on the ${name} log: ${error instanceof Error ? error.message : String(error)}`);
      }
      const took = Date.now() - started;
      runs += 1;
      if (took > MAX_RULE_MS) errors.push(`EP-T: ${id} took ${took} ms on a 256 KiB log of ${name}; a log pattern is not linear`);
    }
  }
  return { errors, runs };
}

/** A file that parses as null, a list, a string, a number or an empty object, and every runner text gone or empty, must never crash a rule. */
function crashErrors(base) {
  const errors = [];
  let runs = 0;
  const check = (label, copy) => {
    runs += 1;
    for (const [id, problems] of Object.entries(judge(copy))) if (problems.some((problem) => problem.startsWith(`${id} threw:`))) errors.push(`EP-F: ${id} threw on ${label}: ${problems.find((problem) => problem.includes("threw:"))}`);
  };
  for (const rel of EXPECTED_FILES.filter((name) => name.endsWith(".json"))) {
    for (const body of ["null", "[]", "\"x\"", "7", "{}"]) {
      const copy = structuredClone(base);
      put(copy, rel, body);
      check(`${rel} holding ${body}`, copy);
    }
  }
  for (const key of ["notes", "validateAll", "cachedRunner", "manifest"]) {
    for (const body of [null, "", "[]"]) {
      const copy = structuredClone(base);
      copy[key] = body;
      check(`${key} holding ${JSON.stringify(body)}`, copy);
    }
  }
  return { errors, runs };
}

/** Line endings in the notes, this file and the two runner lists change nothing: the clean judge and every EP-9 mutation behave the same. */
function lineEndingErrors(base) {
  const errors = [];
  const crlf = structuredClone(base);
  for (const key of TEXT_KEYS) if (typeof crlf[key] === "string") crlf[key] = crlf[key].replace(/\n/g, "\r\n");
  normaliseBundle(crlf);
  if (!same(crlf, base)) errors.push("EP-L: normalising CRLF copies of the notes, this file and the runner lists does not give the LF text");
  if (Object.keys(judge(crlf)).length > 0) errors.push("EP-L: the clean judge fails on CRLF copies of the notes, this file and the runner lists");
  let runs = 0;
  for (const m of MUTATIONS.filter((entry) => entry.rule === "EP-9")) {
    const copy = structuredClone(base);
    for (const key of TEXT_KEYS) if (typeof copy[key] === "string") copy[key] = copy[key].replace(/\n/g, "\r\n");
    normaliseBundle(copy);
    m.apply(copy);
    runs += 1;
    if (!(m.rule in judge(copy))) errors.push(`EP-L: mutation '${m.name}' survives on CRLF copies`);
  }
  return { errors, runs };
}

function selfTest(base) {
  const errors = [];
  const results = [];
  const clean = judge(base);
  if (Object.keys(clean).length > 0) return { errors: [`EP-M: the unmutated evidence does not pass: ${Object.keys(clean).join(", ")}`], results, extras: [] };
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("EP-M: two mutations share a name");
  for (const m of MUTATIONS) {
    const copy = structuredClone(base);
    try {
      m.apply(copy);
    } catch (error) {
      errors.push(`EP-M: mutation '${m.name}' no longer applies: ${error.message}`);
      continue;
    }
    if (canon(copy) === canon(base)) {
      errors.push(`EP-M: mutation '${m.name}' changed nothing`);
      continue;
    }
    const all = judge(copy);
    const fired = Object.keys(all).sort();
    const wanted = [...new Set([m.rule, ...m.also])].sort();
    const own = all[m.rule] ?? [];
    const matched = m.expect === null ? null : own.find((problem) => problem.includes(m.expect));
    results.push({ name: m.name, rule: m.rule, fired, matched: matched ?? null });
    if (Object.values(all).some((problems) => problems.some((problem) => / threw: /.test(problem)))) errors.push(`EP-M: mutation '${m.name}' made a rule throw instead of refuse`);
    if (!fired.includes(m.rule)) errors.push(`EP-M: mutation '${m.name}' survived; ${m.rule} did not fire (${fired.join(", ") || "nothing"})`);
    else if (!same(fired, wanted)) errors.push(`EP-M: mutation '${m.name}' wanted ${wanted.join(", ")} and fired ${fired.join(", ")}`);
    else if (m.expect !== null && matched === undefined) errors.push(`EP-M: mutation '${m.name}' was killed by ${m.rule} but not by the check that names '${m.expect}'`);
  }
  const proved = new Set(MUTATIONS.map((m) => m.rule));
  for (const [id] of RULES) if (!proved.has(id)) errors.push(`EP-M: rule ${id} has no named mutation`);
  // The control: with a rule's body replaced by `return []`, every one of that rule's mutations must survive.
  let deadRuns = 0;
  for (const m of MUTATIONS) {
    const copy = structuredClone(base);
    try {
      m.apply(copy);
    } catch {
      continue;
    }
    deadRuns += 1;
    if (m.rule in judge(copy, m.rule)) errors.push(`EP-D: mutation '${m.name}' still fires ${m.rule} with that rule's body replaced by an empty one`);
  }
  const timing = timingErrors(base);
  const crash = crashErrors(base);
  const endings = lineEndingErrors(base);
  errors.push(...timing.errors, ...crash.errors, ...endings.errors);
  const extras = [
    `  dead-rule control: ${deadRuns} mutations all survive a judge whose own rule body is replaced by an empty one`,
    `  regex timing: ${timing.runs} rule runs on 256 KiB hostile logs, each under ${MAX_RULE_MS} ms`,
    `  crash resistance: ${crash.runs} judge runs on files holding null, a list, a string, a number or an empty object: no rule threw`,
    `  line endings: the clean judge and ${endings.runs} EP-9 mutations behave the same on CRLF copies`,
  ];
  return { errors, results, extras };
}

function run() {
  const bundle = loadBundle();
  const fired = judge(bundle);
  if (Object.keys(fired).length > 0) return messagesOf(fired);
  return selfTest(bundle).errors;
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(__filename)) {
  const bundle = loadBundle();
  const fired = judge(bundle);
  const errors = Object.keys(fired).length > 0 ? messagesOf(fired) : [];
  const test = errors.length === 0 ? selfTest(bundle) : { errors: [], results: [], extras: [] };
  const all = [...errors, ...test.errors];
  if (all.length > 0) {
    all.forEach((error) => console.error(`FAIL: ${error}`));
    console.error(`${THIS_VALIDATOR}: ${all.length} error(s)`);
    process.exit(1);
  }
  if (process.argv.includes("--verbose")) for (const r of test.results) console.log(`  killed by ${r.fired.join("+")}: ${r.name}${r.matched === null ? "" : ` [${r.matched.slice(0, 90)}]`}`);
  for (const [id] of RULES) {
    const mine = test.results.filter((r) => r.rule === id);
    const exact = mine.filter((r) => r.matched !== null).length;
    console.log(`  ${id} ${RULE_NAMES[id]}: ${mine.length} named mutations killed by ${id} (${exact} also checked against the exact problem text)`);
  }
  for (const line of test.extras) console.log(line);
  console.log(`${THIS_VALIDATOR}: PASS (${RULES.length} rules over ${Object.keys(bundle.files).length} evidence files; ${test.results.length} named mutations killed)`);
}

module.exports = { run, judge, selfTest, loadBundle, MUTATIONS, RULE_NAMES };
