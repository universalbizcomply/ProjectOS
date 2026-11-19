/**
 * Built 2026-11-19 from the draft prepared on 2026-11-18, tuned against the real evidence (attempts A1, A2, B1 and B2) and to the plan v1.45
 * amendment of SP-2 and SP-4 (owner-approved 2026-11-19, docs/changes/delta_spec.md). Registered before val-projectos-memory-stores1a.
 *
 * PROJECTOS-STAGE4-EXIT-PROOF1A - the Stage 4 exit proof, judged over the recorded evidence. Modelled on val-projectos-memory-exit-proof1a.
 *
 * WHAT THIS PINS. One governed agency phase (SEO-AGENCY-STAGE4-PROOF1A, writes site/colophon.txt) was run by a throwaway ProjectOS runtime in two
 * configurations: config A (Claude implements, Codex reviews) and config B (Codex implements through codex-implementer-cli, Claude reviews).
 * Each run is ONE bare `projectos continue --execute`. The raw records are committed under docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A/ (one folder
 * per attempt, named in setup.json). Each rule below is one way the story could be false, written as a pure function over an in-memory bundle of
 * those records. Each rule has named mutations: an edit of a deep copy of the bundle that makes the wrong thing true, which the rule must refuse.
 * A mutation counts only when its OWN rule fires (and, where one change is wrong for two rules, exactly the rules named).
 *
 *   SP-1  "the files are the files"           a committed manifest of sha256 covers every evidence file; a changed, added or missing file fails
 *   SP-2  "same phase, same source, a clean runtime"  every attempt records its own runtime, which differs from its plan head only by the temporary allowlist
 *                                              file; the two closed runs carry one pinned phase text, one source tree outside .projectops and a committed config that
 *                                              differs only in execution and plan pointers; if they ran on different runtimes the notes say so (plan v1.45)
 *   SP-3  "the swap is the config"            config A and config B are exactly the pinned worker pairs; each run is a bare continue from its own process
 *   SP-4  "the reviewer is another provider"  each closed run's reviewer record: provider-distinct kinds, an APPROVE with no unresolved MEDIUM, HIGH or CRITICAL
 *                                              finding (a LOW stays as the reviewer wrote it, plan v1.45), bound to the evidence
 *   SP-5  "the write scope held"              the paths a closed run changed are site/colophon.txt plus the loop's own records, nothing else; the file is exact
 *   SP-6  "it reached closed by itself"       validators, an independent APPROVE, the gatekeeper, the closure authority, no owner act, one handover STOPPED line
 *   SP-7  "the metered spend is what it says" broker calls equal the log, each run is under 1,500,000 micro-USD and the attempts together under 3,000,000
 *   SP-8  "a refusal is never hidden"         every attempt is listed and has an outcome that matches what its log says; the notes name each one
 *   SP-9  "no product, nothing but a read"    the notes say so, this file only reads, and it is registered once, before val-projectos-memory-stores1a, in both runners
 *
 * PROVEN OR NOT. The validator passes only when a closed config A attempt AND a closed config B attempt exist and every rule is clean. A recorded,
 * honest refusal of config B makes every rule clean and the verdict NOT PROVEN (exit 1): the phase cannot close green on a refusal. Refused or stopped
 * attempts (A1 and B1 here) stay in the evidence as declared, hashed, unedited records. They get SP-1, SP-3, SP-7, SP-8 and the per-attempt part of SP-2
 * (a clean runtime of their own, the live run, the source digest); the cross-run identity of SP-2, and SP-4, SP-5 and SP-6, judge the closed runs only.
 *
 * WHAT IT CANNOT CATCH. Someone who edits logs and records consistently and re-seals the manifest and the notes passes every rule. The
 * mutations hard-code the real closed attempt ids A2 and B2; this is a brake for accident, not a defence against a forger. It does not show that a
 * worker READ anything (D4 stands), and provider distinctness is by worker kind as the loop records it (independentReview.ts), not by identity.
 *
 * Reads files only. A green proof does not lift D4.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-stage4-exit-proof1a";
const BEFORE_VALIDATOR = "val-projectos-memory-stores1a";
const PHASE = "PROJECTOS-STAGE4-EXIT-PROOF1A";
const AGENCY_PHASE = "SEO-AGENCY-STAGE4-PROOF1A";
const PROJECT = "seo-agency";
const CAP_RUN = 1_500_000;
const CAP_TOTAL = 3_000_000;
const MAX_ATTEMPTS = { A: 2, B: 2 };

const EVIDENCE = "docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A";
const NOTES = "docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A-validator-notes.md";
const VA = "projectos/validators/validate-all.cjs";
const CR = "projectos/speed/cached-runner.cjs";
const MANIFEST = "MANIFEST.json";
const SCHEMAS = {
  manifest: "projectos.stage4-exit-proof-manifest/1",
  setup: "projectos.stage4-exit-proof-setup/1",
  runtime: "projectos.stage4-exit-proof-runtime/1",
  source: "projectos.stage4-exit-proof-source/1",
};
const ALLOWLIST = "projectos/security/installation-project-allowlist.json";
const CONFIG_VARIES = ["execution", "planMemory", "planSources"];
const RUNTIME_DIFFERENCE_STATEMENT = "the closed runs ran on different runtimes";

const MODULE_COMMENT = "// PROJECTOS-STAGE4-EXIT-PROOF1A - the Stage 4 exit proof over the recorded live runs: one agency phase run with the implementer and reviewer providers swapped by committed config alone, a clean runtime per attempt and one source, provider-distinct approvals, the write scope held, spend under the caps, every attempt recorded and none hidden.";

// A star is spelled through STAR so that no string in this file holds a slash-star or star-slash pair, which the comment stripper in SP-9 would read as a comment.
const STAR = "*";
const COLOPHON_TITLE = `/${STAR} COLOPHON ${STAR}/`;
const PHASE_DESCRIPTION =
  `Add site/colophon.txt with exactly these four lines: '${COLOPHON_TITLE}', 'Site: SEO & Social Agency', 'Built with: static HTML and CSS', 'Proof: ProjectOS Stage 4, provider roles swapped'. Change no other file. This is the ProjectOS Stage 4 exit-proof phase: the same phase is run twice with the implementer and reviewer providers swapped, and only the committed worker configuration differs between the two runs.`;
const COLOPHON = [COLOPHON_TITLE, "Site: SEO & Social Agency", "Built with: static HTML and CSS", "Proof: ProjectOS Stage 4, provider roles swapped"];

const CLAUDE_EXE = "claude.exe";
const CODEX_EXE = "codex.exe";
const CONFIGS = {
  A: { implementer: ["claude-local", "claude-code-cli", CLAUDE_EXE], reviewer: ["codex-reviewer", "codex-cli", CODEX_EXE] },
  B: { implementer: ["codex-implementer", "codex-implementer-cli", CODEX_EXE], reviewer: ["claude-reviewer", "claude-code-cli", CLAUDE_EXE] },
};
const PROVIDER_OF = { "claude-code-cli": "anthropic", "codex-cli": "openai", "codex-implementer-cli": "openai" };
const RECORD_GRANTS = [
  `Write(.projectops/execution/${STAR}.findings.json)`,
  `Edit(.projectops/execution/${STAR}.findings.json)`,
  `Write(.projectops/execution/${STAR}.effects.json)`,
  `Edit(.projectops/execution/${STAR}.effects.json)`,
];
const READ_GRANT = /^(Read|Grep|Glob|LS)(\(.*\))?$/;
const REQUIRED_REVIEWS = ["Implementer self-review", "Independent code review"];
const EFFECT_FIELDS = ["productionTouched", "deploymentOccurred", "databaseMutationOccurred", "externalSendOccurred", "paymentOccurred", "rawSecretStored"];
const RELAY_FLAGS = ["--session", "--objective", "--note", "--worker"];

const ATTEMPT_ID = /^[A-Z][A-Za-z0-9]{0,7}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SESSION = `${AGENCY_PHASE}-[0-9a-f]{12}-[0-9a-f]{8}`;
const LOOP_PATHS = [
  /^\.projectops\/current-state-[0-9a-f]{16}-[0-9a-f]{12}\.json$/,
  new RegExp(`^\\.projectops/execution/${SESSION}\\.(?:brief|invocation|effects|evidence|findings|reviewer|session)\\.json$`),
  new RegExp(`^\\.projectops/execution/${SESSION}\\.context\\.md$`),
  /^\.projectops\/gatekeeper-decisions\/GKDEC-GKREQ-[0-9a-f]{24}\.json$/,
  /^\.projectops\/gatekeeper-ledger\.json$/,
  /^\.projectops\/gatekeeper-thread\.json$/,
  new RegExp(`^\\.projectops/phases/${AGENCY_PHASE}\\.json$`),
  /^\.projectops\/work\.v1\.json$/,
  new RegExp(`^\\.projectops/closure/${AGENCY_PHASE}\\.json$`),
  new RegExp(`^\\.projectops/closure/decisions/${AGENCY_PHASE}\\.json$`),
  new RegExp(`^\\.projectops/gates/${AGENCY_PHASE}\\.secrets-handling\\.json$`),
  /^\.projectops\/validation\/[0-9a-f]{40}\.json$/,
  new RegExp(`^knowledge/reports/${AGENCY_PHASE}-closure-evidence\\.md$`),
];

const RUN_ALWAYS = [
  "run.log", "times.txt", "outcome.json", "source-digest.json", "records/invocation.json", "records/brief.json", "records/project-config.json",
  "records/work.v1.json", "records/phase-record.json",
];
const RUN_CLOSED = [
  "changed-paths.txt", "records/session.json", "records/findings.json", "records/effects.json", "records/evidence.json", "records/reviewer.json",
  "records/gatekeeper-decision.json", "records/gatekeeper-ledger.json", "records/closure-decision.json", "records/colophon.txt",
];

const LOG = {
  worker: /^Worker: (\S+) \(([\w-]+)\)$/m,
  invocation: /^Invocation: ([0-9a-f]+) \(pid (\d+), parent (\d+)\)$/m,
  first: /^attempt 1: started (\S+); worker exited (-?\d+)$/m,
  review: /^ {2}independent review by (\S+): ([A-Z]+)$/m,
  gk: /^gatekeeper answered; recorded (\d+) micro-USD against (GKREQ-[0-9a-f]{24})$/m,
  cl: /^closure authority answered; this call cost (\d+) micro-USD \((CLREQ-[0-9a-f]{24})\)$/m,
  exit: /^exit=(-?\d+)$/m,
};

const RULE_NAMES = {
  "SP-1": "an evidence file is not the committed one",
  "SP-2": "an attempt's runtime is not clean, or the closed runs did not share one pinned phase and one source tree",
  "SP-3": "the swap is not exactly the pinned worker config, or a run was not one bare continue",
  "SP-4": "a closed run's reviewer record is not an independent, provider-distinct approval, or carries an unresolved MEDIUM or worse finding",
  "SP-5": "a closed run changed a path outside the write grants and the loop's own records",
  "SP-6": "a run claimed closed did not reach closed through the validators, the review, the gatekeeper and the closure authority",
  "SP-7": "the metered spend is not the logged spend or is over a cap",
  "SP-8": "an attempt is unlisted, unrecorded or its outcome is not what its log shows",
  "SP-9": "the notes, this validator or its registration are not as pinned",
};
const RULE_FIXES = {
  "SP-1": "restore the committed evidence file, or re-run the live proof and regenerate MANIFEST.json and the hashes in the notes",
  "SP-2": "restore the runtime records, the briefs, the source digests and the committed configs; the closed runs must differ only in the worker config, and a difference of runtime must be stated in the notes",
  "SP-3": "restore the committed configs and the invocation records; each run is exactly [node, projectos.js, continue, --execute]",
  "SP-4": "restore the reviewer record and its evidence hash; a same-provider, non-APPROVE or MEDIUM-finding review is not this proof",
  "SP-5": "restore changed-paths.txt, the colophon and the effects record; a path outside the grants is a breach, not a rounding",
  "SP-6": "restore the log and the gate, closure and phase records; the phase must reach closed with no owner act",
  "SP-7": "restore the ledger and the log; the metered broker calls must equal what the log printed and stay under the caps",
  "SP-8": "list every attempt in setup.json, keep its outcome true to its log, and name it in the notes; never delete a refusal",
  "SP-9": "keep the notes' statements, keep this validator to fs, path and crypto reading only, and register it once before val-projectos-memory-stores1a in both runners",
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
const lines = (text) => String(text ?? "").replace(/\r\n/g, "\n").split("\n");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const ms = (value) => (typeof value === "string" ? Date.parse(value) : Number.NaN);
const baseName = (value) => String(value ?? "").split(/[\\/]/).pop();
const slash = (value) => String(value ?? "").replace(/\\/g, "/");
const realLines = (text) => lines(text).filter((line, i, all) => line !== "" || i < all.length - 1);

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

/** The evidence as text. The bytes must be UTF-8; line endings are not evidence. */
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
  if (!isObject(value)) {
    out.push(`${rel} is missing or is not a JSON object`);
    return null;
  }
  return value;
}

/** The listed attempts, as setup.json states them. Pure: the problems with setup.json are SP-8's. */
function attemptsOf(v) {
  const setup = v.j("setup.json");
  const list = isObject(setup) && Array.isArray(setup.attempts) ? setup.attempts : [];
  const seen = new Set();
  const clean = [];
  for (const a of list) {
    if (!isObject(a) || !ATTEMPT_ID.test(String(a.id)) || !["A", "B"].includes(a.config) || typeof a.branch !== "string" || a.branch === "" || seen.has(a.id)) continue;
    seen.add(a.id);
    clean.push({ id: a.id, config: a.config, branch: a.branch });
  }
  return clean;
}

/** Does the evidence hold anything for this attempt? A listed attempt with no folder is SP-1's (missing files) and SP-8's (never recorded) to report, not every rule's. */
const hasFolder = (b, a) => Object.keys(b.files).some((rel) => rel.startsWith(`${a.id}/`));

/** The ONE rule for what a log says happened. The collector uses the same rule. */
function statusFromLog(text) {
  const log = String(text ?? "");
  const stopped = lines(log).filter((line) => line.startsWith("STOPPED"));
  const handover = new RegExp(`^STOPPED \\(OWNER_DECISION_REQUIRED\\): phase '${AGENCY_PHASE}' is awaiting_closure; that is not a state the loop may move it from$`, "m");
  const closedLine = new RegExp(`^${AGENCY_PHASE}: awaiting_closure -> closed \\(by advisor\\)`, "m");
  const failed = /^[ \t]*(?:FAIL|REFUSED)\b/m.test(log) || /\bREFUSED \(/.test(log);
  const exitLine = LOG.exit.exec(log);
  if (closedLine.test(log) && exitLine !== null && exitLine[1] === "0" && !failed && stopped.length === 1 && handover.test(log)) return "closed";
  if (failed || /WORKER_REFUSED/.test(log)) return "refused";
  return "stopped";
}

/** An attempt that claims to be closed: by its outcome record or by its log. The rules that judge a closed run apply to either claim. */
function claimsClosed(b, v, a) {
  const outcome = v.j(`${a.id}/outcome.json`);
  return (isObject(outcome) && outcome.status === "closed") || statusFromLog(b.files[`${a.id}/run.log`]) === "closed";
}

// ---------------------------------------------------------------------------------------------------------
// The rules: each is a pure function of the bundle and returns its problems.
// ---------------------------------------------------------------------------------------------------------

function expectedFiles(v, attempts) {
  const required = ["setup.json", "runtime.json"];
  const optional = [];
  for (const a of attempts) {
    const outcome = v.j(`${a.id}/outcome.json`);
    const closed = isObject(outcome) && outcome.status === "closed";
    for (const f of RUN_ALWAYS) required.push(`${a.id}/${f}`);
    for (const f of RUN_CLOSED) (closed ? required : optional).push(`${a.id}/${f}`);
    optional.push(`${a.id}/runtime.json`);
  }
  return { required, allowed: [...required, ...optional] };
}

function sp1(b) {
  const out = [...b.loadProblems];
  for (const rel of b.links) out.push(`${rel} is a symbolic link: the evidence is regular files only, and a link is never read through`);
  let m = null;
  try {
    m = JSON.parse(b.manifest ?? "");
  } catch {
    m = null;
  }
  if (!isObject(m)) return [...out, `${EVIDENCE}/${MANIFEST} is missing or is not a JSON object`];
  if (m.schema !== SCHEMAS.manifest) out.push(`the manifest schema is not ${SCHEMAS.manifest}`);
  if (!isObject(m.files)) return [...out, "the manifest has no files table"];
  const v = view(b);
  if (!isObject(v.j("setup.json"))) out.push("setup.json is missing or is not a JSON object, so the expected evidence files cannot be named");
  const attempts = attemptsOf(v);
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
  const { required, allowed } = expectedFiles(v, attempts);
  for (const rel of required) if (!(rel in b.files) || !listed.includes(rel)) out.push(`${rel} is part of the evidence and is not in both the folder and the manifest`);
  for (const rel of present) if (!allowed.includes(rel)) out.push(`${rel} is not an evidence file of any attempt setup.json lists`);
  if (typeof b.notes !== "string") out.push(`${NOTES} is missing`);
  else {
    for (const a of attempts) {
      const log = b.files[`${a.id}/run.log`];
      if (typeof log === "string" && !b.notes.includes(sha(log))) out.push(`${NOTES} does not carry the sha256 of ${a.id}/run.log`);
    }
  }
  return out;
}

/** The runtime record an attempt ran on: its own `<id>/runtime.json` when it has one, else the shared `runtime.json`. */
function runtimeOf(b, v, a) {
  const rel = `${a.id}/runtime.json`;
  // A file the attempt has is ITS runtime record, whatever it holds: a broken one is reported by runtimeProblems, never swapped for the shared one.
  if (rel in b.files) return { rel, record: v.j(rel) };
  return { rel: "runtime.json", record: v.j("runtime.json") };
}

function runtimeProblems(runtime, rel, label, out) {
  if (!isObject(runtime)) {
    out.push(`${label}'s runtime record (${rel}) is missing or is not a JSON object`);
    return;
  }
  if (runtime.schema !== SCHEMAS.runtime) out.push(`${rel} is not a ${SCHEMAS.runtime} record`);
  if (!COMMIT.test(String(runtime.planBranchHead)) || !COMMIT.test(String(runtime.runtimeHead))) out.push(`${rel} has no 40-hex planBranchHead and runtimeHead`);
  if (!same(runtime.changedPathsVsPlanHead, [ALLOWLIST])) out.push(`the runtime in ${rel} differs from its plan-branch head by more than the one temporary allowlist file: ${label} did not use the plan's code`);
  if (runtime.worktreeClean !== true) out.push(`the runtime in ${rel} was not clean`);
  if (typeof runtime.runtimeRoot !== "string" || runtime.runtimeRoot === "") out.push(`${rel} names no runtime root`);
}

function sp2(b) {
  const out = [];
  const v = view(b);
  const attempts = attemptsOf(v);
  const setup = v.j("setup.json");
  if (!isObject(setup)) return [...out, "setup.json is missing or is not a JSON object"];
  if (setup.phaseId !== AGENCY_PHASE || setup.projectId !== PROJECT) out.push("setup.json names another phase or project than the proof phase");
  if (!COMMIT.test(String(setup.baseCommit)) || !COMMIT.test(String(setup.planHead))) out.push("setup.json has no 40-hex baseCommit and planHead");
  if (setup.capMicroUsdPerRun !== CAP_RUN || setup.capMicroUsdTotal !== CAP_TOTAL) out.push("setup.json does not carry the owner-approved caps ($1.50 per run, $3.00 in total)");
  const declared = Array.isArray(setup.attempts) ? setup.attempts : [];
  const checkedRuntimes = new Set();
  const closedRuntimes = new Map();
  let firstPhase = null;
  let firstDigest = null;
  let firstConfig = null;
  for (const a of attempts) {
    if (!hasFolder(b, a)) continue;
    const label = `attempt ${a.id}`;
    const closed = claimsClosed(b, v, a);
    const { rel, record: runtime } = runtimeOf(b, v, a);
    if (!checkedRuntimes.has(rel)) {
      checkedRuntimes.add(rel);
      runtimeProblems(runtime, rel, label, out);
    }
    if (isObject(runtime) && closed) closedRuntimes.set(a.id, runtime.runtimeHead);
    const inv = need(v, `${a.id}/records/invocation.json`, out);
    const brief = need(v, `${a.id}/records/brief.json`, out);
    const src = need(v, `${a.id}/source-digest.json`, out);
    const cfg = need(v, `${a.id}/records/project-config.json`, out);
    const entry = declared.find((x) => isObject(x) && x.id === a.id);
    const base = isObject(entry) && COMMIT.test(String(entry.baseCommit)) ? entry.baseCommit : setup.baseCommit;
    if (inv !== null) {
      if (inv.phaseId !== AGENCY_PHASE || inv.projectId !== PROJECT || inv.executionMode !== "live") out.push(`${label} did not run the proof phase live`);
      const wanted = `${slash(isObject(runtime) ? runtime.runtimeRoot : "")}/projectos/agent/bin/projectos.js`;
      if (isObject(runtime) && slash(inv.process?.argv?.[1]) !== wanted) out.push(`${label} ran ${slash(inv.process?.argv?.[1])}, not the runtime's ${wanted}`);
    }
    if (brief !== null) {
      if (!isObject(brief.phase) || brief.phase.phaseId !== AGENCY_PHASE) out.push(`${label}'s brief is not for the proof phase`);
      else if (closed && brief.phase.description !== PHASE_DESCRIPTION) out.push(`${label}'s brief carries another phase text than the pinned one`);
      if (closed) {
        const judged = canon({ phase: brief.phase, boundaries: brief.boundaries, verification: brief.verification });
        if (firstPhase === null) firstPhase = judged;
        else if (judged !== firstPhase) out.push(`${label}'s brief differs from the other closed run's in the phase, boundaries or verification`);
      }
    }
    if (src !== null) {
      if (src.schema !== SCHEMAS.source || src.attempt !== a.id) out.push(`${label}'s source digest record is not its own`);
      if (src.baseCommit !== base) out.push(`${label} forked from another BASE than setup.json names for it`);
      if (src.baseIsAncestor !== true) out.push(`${label}'s pre-run head does not descend from its BASE`);
      if (!HASH.test(String(src.sourceDigest))) out.push(`${label} has no source digest`);
      if (inv !== null && src.preRunHead !== inv.repository?.head) out.push(`${label}'s source digest is for another head than the run started at`);
      if (closed) {
        if (firstDigest === null) firstDigest = src.sourceDigest;
        else if (src.sourceDigest !== firstDigest) out.push(`${label}'s tree outside .projectops differs from the other closed run's: the source was not the same`);
      }
    }
    if (cfg !== null && closed) {
      const rest = { ...cfg };
      for (const key of CONFIG_VARIES) delete rest[key];
      const judged = canon(rest);
      if (firstConfig === null) firstConfig = judged;
      else if (judged !== firstConfig) out.push(`${label}'s committed project config differs from the other closed run's outside ${CONFIG_VARIES.join(", ")}`);
    }
  }
  const heads = new Set(closedRuntimes.values());
  if (heads.size > 1 && (typeof b.notes !== "string" || !b.notes.includes(RUNTIME_DIFFERENCE_STATEMENT))) {
    out.push(`the closed runs ran on different runtimes (${[...closedRuntimes.entries()].map(([id, head]) => `${id} on ${head.slice(0, 8)}`).join(", ")}) and ${NOTES} does not say '${RUNTIME_DIFFERENCE_STATEMENT}'`);
  }
  return out;
}

function argvProblem(argv, label) {
  if (!Array.isArray(argv) || argv.length !== 4) return `${label} argv is not exactly [node, projectos.js, continue, --execute]`;
  if (!/^node(?:\.exe)?$/i.test(baseName(argv[0]))) return `${label} argv[0] is not node`;
  if (baseName(argv[1]) !== "projectos.js") return `${label} argv[1] is not projectos.js`;
  if (argv[2] !== "continue" || argv[3] !== "--execute") return `${label} argv is not 'continue --execute'`;
  return null;
}

function grantsOf(args) {
  const out = [];
  const add = (value) => {
    let depth = 0;
    let current = "";
    for (const ch of value) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === "," || /\s/.test(ch))) {
        if (current !== "") out.push(current);
        current = "";
      } else current += ch;
    }
    if (current !== "") out.push(current);
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--allowedTools") continue;
    for (let j = i + 1; j < args.length && !String(args[j]).startsWith("-"); j += 1) add(String(args[j]));
  }
  return out;
}

function workerProblems(worker, expected, role, label, out) {
  const [id, kind, exe] = expected;
  if (!isObject(worker)) {
    out.push(`${label}'s ${role} worker is missing from the committed execution block`);
    return;
  }
  if (worker.workerId !== id || worker.kind !== kind) out.push(`${label}'s ${role} is ${worker.workerId} (${worker.kind}), not ${id} (${kind})`);
  if (typeof worker.command !== "string" || !/^[A-Za-z]:[\\/]/.test(worker.command) || baseName(worker.command) !== exe) out.push(`${label}'s ${role} command is not an absolute path to ${exe}`);
  if (!isCount(worker.timeoutMs, 1000)) out.push(`${label}'s ${role} declares no usable attempt bound`);
  const args = Array.isArray(worker.args) ? worker.args : [];
  const grants = grantsOf(args);
  if (role === "implementer" && grants.some((g) => !RECORD_GRANTS.includes(g))) out.push(`${label}'s implementer holds a grant beyond the four worker-owned record grants: ${grants.filter((g) => !RECORD_GRANTS.includes(g)).join(", ")}`);
  if (role === "reviewer" && grants.some((g) => !READ_GRANT.test(g))) out.push(`${label}'s reviewer holds a non-read grant: ${grants.filter((g) => !READ_GRANT.test(g)).join(", ")}`);
}

function sp3(b) {
  const out = [];
  const v = view(b);
  const attempts = attemptsOf(v);
  const seen = { pid: new Map(), ppid: new Map(), invocation: new Map(), session: new Map() };
  for (const a of attempts) {
    if (!hasFolder(b, a)) continue;
    const label = `attempt ${a.id}`;
    const want = CONFIGS[a.config];
    const inv = need(v, `${a.id}/records/invocation.json`, out);
    const brief = need(v, `${a.id}/records/brief.json`, out);
    const cfg = need(v, `${a.id}/records/project-config.json`, out);
    const log = b.files[`${a.id}/run.log`];
    const session = v.j(`${a.id}/records/session.json`);
    if (cfg !== null) {
      const execution = cfg.execution;
      if (!isObject(execution)) out.push(`${label}'s committed config has no execution block`);
      else {
        const workers = Array.isArray(execution.workers) ? execution.workers : [];
        if (workers.length !== 2) out.push(`${label}'s execution block does not hold exactly the implementer and the reviewer`);
        workerProblems(workers[0], want.implementer, "implementer", label, out);
        workerProblems(workers[1], want.reviewer, "reviewer", label, out);
        if (execution.reviewerWorkerId !== want.reviewer[0]) out.push(`${label}'s reviewerWorkerId is ${execution.reviewerWorkerId}, not ${want.reviewer[0]}`);
        if ("defaultWorkerId" in execution) out.push(`${label}'s execution block names a defaultWorkerId: the implementer must be the one worker that is not the reviewer`);
      }
    }
    if (inv !== null) {
      const problem = argvProblem(inv.process?.argv, label);
      if (problem !== null) out.push(problem);
      if (!isCount(inv.process?.pid, 1) || !isCount(inv.process?.ppid, 1)) out.push(`${label} has no integer pid and parent pid`);
      else if (inv.process.pid === inv.process.ppid) out.push(`${label} is its own parent`);
      if (inv.workerId !== want.implementer[0] || inv.workerKind !== want.implementer[1]) out.push(`${label}'s invocation names ${inv.workerId} (${inv.workerKind}), not ${want.implementer[0]} (${want.implementer[1]})`);
      if (inv.sessionId !== `${AGENCY_PHASE}-${String(inv.repository?.head).slice(0, 12)}-${String(inv.invocationId).slice(0, 8)}`) out.push(`${label}'s session id was not minted by its own invocation`);
      for (const [key, value] of [["pid", inv.process?.pid], ["ppid", inv.process?.ppid], ["invocation", inv.invocationId], ["session", inv.sessionId]]) {
        if (seen[key].has(value)) out.push(`${label} and attempt ${seen[key].get(value)} share a ${key}: they were not two separate runs`);
        else seen[key].set(value, a.id);
      }
      if (brief !== null) {
        let digest = null;
        try {
          digest = `sha256:${sha(JSON.stringify(JSON.parse(b.files[`${a.id}/records/brief.json`])))}`;
        } catch {
          digest = null;
        }
        if (digest === null || inv.brief?.digest !== digest) out.push(`${label}'s invocation names a brief digest that is not the digest of the committed brief`);
      }
      if (isObject(session) && (session.workerId !== inv.workerId || session.kind !== inv.workerKind)) out.push(`${label}'s session record is not the invocation's worker`);
    }
    if (typeof log === "string") {
      const w = LOG.worker.exec(log);
      if (w === null) out.push(`${label}'s log has no Worker line`);
      else if (w[1] !== want.implementer[0] || w[2] !== want.implementer[1]) out.push(`${label}'s log names ${w[1]} (${w[2]}) as the worker, not ${want.implementer[0]} (${want.implementer[1]})`);
      const mark = LOG.invocation.exec(log);
      if (mark === null) out.push(`${label}'s log has no Invocation line`);
      else if (inv !== null && (mark[1] !== inv.invocationId || Number(mark[2]) !== inv.process?.pid || Number(mark[3]) !== inv.process?.ppid)) out.push(`${label}'s log names another invocation, pid or parent than its invocation record`);
      const runLines = lines(log).filter((line) => line.startsWith("projectos continue: run"));
      if (runLines.length !== 1) out.push(`${label}'s log has ${runLines.length} 'projectos continue: run' lines, not exactly one`);
      for (const flag of RELAY_FLAGS) if (log.includes(flag)) out.push(`${label}'s log contains ${flag}: something was relayed to the run`);
    }
  }
  return out;
}

function sp4(b) {
  const out = [];
  const v = view(b);
  for (const a of attemptsOf(v)) {
    if (!claimsClosed(b, v, a)) continue;
    const label = `attempt ${a.id}`;
    const want = CONFIGS[a.config];
    const inv = v.j(`${a.id}/records/invocation.json`);
    const reviewer = need(v, `${a.id}/records/reviewer.json`, out);
    const evidence = need(v, `${a.id}/records/evidence.json`, out);
    if (reviewer === null) continue;
    if (isObject(inv) && (reviewer.sessionId !== inv.sessionId || reviewer.phaseId !== AGENCY_PHASE || reviewer.baseHead !== inv.repository?.head)) out.push(`${label}'s reviewer record is not for its session, phase and commit`);
    if (reviewer.implementerWorkerId !== want.implementer[0] || reviewer.implementerKind !== want.implementer[1]) out.push(`${label}'s reviewer record names ${reviewer.implementerWorkerId} (${reviewer.implementerKind}) as the implementer`);
    if (reviewer.reviewerWorkerId !== want.reviewer[0] || reviewer.reviewerKind !== want.reviewer[1]) out.push(`${label}'s reviewer record names ${reviewer.reviewerWorkerId} (${reviewer.reviewerKind}) as the reviewer`);
    if (reviewer.implementerWorkerId === reviewer.reviewerWorkerId || reviewer.implementerKind === reviewer.reviewerKind) out.push(`${label}'s reviewer is the implementer, or the same kind of worker`);
    const providers = [PROVIDER_OF[reviewer.implementerKind], PROVIDER_OF[reviewer.reviewerKind]];
    if (providers[0] === undefined || providers[1] === undefined || providers[0] === providers[1]) out.push(`${label}'s implementer and reviewer are not from different providers (${providers.join(" and ")})`);
    if (reviewer.providerDistinct !== true) out.push(`${label}'s reviewer record does not say the provider is distinct`);
    if (reviewer.verdict !== "APPROVE") out.push(`${label}'s reviewer verdict is not APPROVE`);
    const findings = Array.isArray(reviewer.findings) ? reviewer.findings : null;
    if (findings === null) out.push(`${label}'s reviewer record has no findings list`);
    else for (const finding of findings) if (!isObject(finding) || (finding.severity !== "LOW" && finding.resolved !== true)) out.push(`${label}'s reviewer record carries an unresolved finding above LOW (${isObject(finding) ? `${finding.id} ${finding.severity}` : "not an object"}): plan v1.45 allows a LOW only`);
    const requested = reviewer.reviewsRequested;
    if (!Array.isArray(requested) || !REQUIRED_REVIEWS.slice(1).every((review) => requested.includes(review))) out.push(`${label}'s reviewer record did not request the independent code review`);
    if (!Array.isArray(requested) || !Array.isArray(reviewer.reviewsPerformed) || !requested.every((review) => reviewer.reviewsPerformed.includes(review))) out.push(`${label}: a requested independent review was not performed`);
    const text = b.files[`${a.id}/records/reviewer.json`];
    if (evidence !== null && (typeof text !== "string" || evidence.reviewerSha256 !== sha(text))) out.push(`${label}'s evidence reviewerSha256 is not the sha256 of the committed reviewer record`);
  }
  return out;
}

function sp5(b) {
  const out = [];
  const v = view(b);
  for (const a of attemptsOf(v)) {
    if (!claimsClosed(b, v, a)) continue;
    const label = `attempt ${a.id}`;
    const changed = b.files[`${a.id}/changed-paths.txt`];
    if (typeof changed !== "string") out.push(`${label} has no changed-paths.txt`);
    else {
      const paths = lines(changed).filter((line) => line !== "");
      const stray = paths.filter((p) => p !== "site/colophon.txt" && !LOOP_PATHS.some((re) => re.test(p)));
      for (const p of stray) out.push(`${label} changed ${p}, which is neither the one write path nor one of the loop's own records`);
      if (!paths.includes("site/colophon.txt")) out.push(`${label} did not change site/colophon.txt`);
      if (new Set(paths).size !== paths.length) out.push(`${label}'s changed-paths.txt lists a path twice`);
    }
    const colophon = b.files[`${a.id}/records/colophon.txt`];
    if (typeof colophon !== "string" || !same(realLines(colophon), COLOPHON)) out.push(`${label}'s site/colophon.txt is not the four lines the phase asked for`);
    const effects = need(v, `${a.id}/records/effects.json`, out);
    if (effects !== null && (!same(Object.keys(effects).sort(), [...EFFECT_FIELDS].sort()) || EFFECT_FIELDS.some((field) => effects[field] !== false))) out.push(`${label} recorded a prohibited effect, or its effects record is not the six closed fields all false`);
    const evidence = v.j(`${a.id}/records/evidence.json`);
    const effectsText = b.files[`${a.id}/records/effects.json`];
    if (isObject(evidence) && (typeof effectsText !== "string" || evidence.effectsSha256 !== sha(effectsText))) out.push(`${label}'s evidence effectsSha256 is not the sha256 of the committed effects record`);
  }
  return out;
}

function sp6(b) {
  const out = [];
  const v = view(b);
  for (const a of attemptsOf(v)) {
    if (!claimsClosed(b, v, a)) continue;
    const label = `attempt ${a.id}`;
    const want = CONFIGS[a.config];
    const inv = v.j(`${a.id}/records/invocation.json`);
    const session = need(v, `${a.id}/records/session.json`, out);
    const evidence = need(v, `${a.id}/records/evidence.json`, out);
    const work = need(v, `${a.id}/records/work.v1.json`, out);
    const phase = need(v, `${a.id}/records/phase-record.json`, out);
    const closure = need(v, `${a.id}/records/closure-decision.json`, out);
    const gate = need(v, `${a.id}/records/gatekeeper-decision.json`, out);
    const log = b.files[`${a.id}/run.log`];
    if (typeof log !== "string") out.push(`${label}'s run.log is missing`);
    else {
      const stops = log.match(/OWNER_DECISION_REQUIRED/g) ?? [];
      const handover = new RegExp(`^STOPPED \\(OWNER_DECISION_REQUIRED\\): phase '${AGENCY_PHASE}' is awaiting_closure; that is not a state the loop may move it from$`, "m");
      if (stops.length !== 1 || !handover.test(log)) out.push(`${label}'s log stops for the owner other than at the loop's own awaiting_closure handover`);
      if (lines(log).filter((line) => line.startsWith("STOPPED")).length !== 1) out.push(`${label}'s log has other than exactly one STOPPED line`);
      if (/^[ \t]*(?:FAIL|REFUSED)\b/m.test(log) || /\bREFUSED \(/.test(log)) out.push(`${label}'s log shows a failure or a refusal`);
      const first = LOG.first.exec(log);
      const review = LOG.review.exec(log);
      if (first !== null && review !== null && first.index < review.index) {
        const section = log.slice(first.index, review.index);
        if (!/^ {2}PASS validator validate-site$/m.test(section)) out.push(`${label}'s log has no 'PASS validator validate-site' line between the worker and the independent review`);
      }
      if (first !== null && first[1] !== want.implementer[0]) out.push(`${label}'s first worker attempt was started by ${first[1]}, not ${want.implementer[0]}`);
      if (review !== null && review[1] !== want.reviewer[0]) out.push(`${label}'s independent review was by ${review[1]}, not ${want.reviewer[0]}`);
      const steps = [
        /^attempt 1: started \S+; worker exited 0$/m, /^ {2}independent review by \S+: APPROVE$/m,
        /^ {2}gatekeeper: the gatekeeper reviewed CONTINUATION_READY and approved continuation$/m,
        handover, new RegExp(`^closure prepared for ${AGENCY_PHASE} at subject [0-9a-f]{40}$`, "m"), /^ {2}reviews \(credited\): complete$/m, /^ {2}unresolved CRITICAL\/HIGH: 0$/m,
        new RegExp(`^carrying on: projectos closure request --id ${AGENCY_PHASE} --execute$`, "m"), new RegExp(`^the closure authority decided to close ${AGENCY_PHASE} at [0-9a-f]{7,40}$`, "m"),
        new RegExp(`^${AGENCY_PHASE}: awaiting_closure -> closed \\(by advisor\\)`, "m"), /^ {2}state: {5}active=none, (\d+)\/\1 complete$/m, /^exit=0$/m,
      ];
      let from = 0;
      steps.forEach((step, index) => {
        const hit = step.exec(log.slice(from));
        if (hit === null) out.push(`${label}'s log lacks step ${index + 1} of the run (${String(step).slice(1, 70)}...) at or after the step before it`);
        else from += hit.index + hit[0].length;
      });
      if (lines(log).filter((line) => line !== "").pop() !== "exit=0") out.push(`${label}'s log does not end with exit=0`);
      const gk = /^gatekeeper request (GKREQ-[0-9a-f]{24}) \(evidence-review\) for CONTINUATION_READY$/m.exec(log);
      const cl = /^closure request (CLREQ-[0-9a-f]{24}) \(closure-review\) for SEO-AGENCY-STAGE4-PROOF1A at ([0-9a-f]{7,40})$/m.exec(log);
      if (gk === null || gate === null || gate.decisionId !== `GKDEC-${gk[1]}`) out.push(`${label}'s gatekeeper decision is not the one for the request in the log`);
      if (cl === null || closure === null || closure.decisionId !== cl[1] || !String(closure.evidenceSubjectHead).startsWith(cl[2])) out.push(`${label}'s closure decision is not the one for the request in the log`);
      if (!/^ {2}gatekeeper decision provenance: InstallationBrokerProviderAnswer$/m.test(log)) out.push(`${label}'s log does not show the gatekeeper decision coming from the broker's provider answer`);
      if (!/^closure decision provenance: InstallationBrokerProviderAnswer \(provider response resp_[0-9a-f]+\)$/m.test(log)) out.push(`${label}'s log does not show the closure decision coming from the broker's provider answer`);
    }
    if (session !== null) {
      if (isObject(inv) && (session.sessionId !== inv.sessionId || session.invocationId !== inv.invocationId)) out.push(`${label}'s session record is not its own invocation's`);
      if (session.exitCode !== 0 || session.timedOut !== false) out.push(`${label}'s worker did not exit zero in time`);
    }
    if (evidence !== null) {
      const findingsText = b.files[`${a.id}/records/findings.json`];
      if (typeof findingsText !== "string" || evidence.findingsSha256 !== sha(findingsText)) out.push(`${label}'s evidence findingsSha256 is not the sha256 of the committed findings record`);
      const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
      const check = checks.find((entry) => entry?.id === "validate-site");
      if (!isObject(check) || check.passed !== true || check.exitCode !== 0 || check.kind !== "validator") out.push(`${label}'s evidence has no passing validator check for validate-site`);
    }
    if (work !== null) {
      if (work.state !== "COMPLETE" || work.ownerRequired !== false) out.push(`${label}'s final work record is not COMPLETE with no owner required`);
      if (isObject(inv) && work.sessionId !== inv.sessionId) out.push(`${label}'s final work record is not its session`);
      if (gate !== null && work.gateDecisionId !== gate.decisionId) out.push(`${label}'s final work record does not name the gatekeeper's decision`);
    }
    if (phase !== null) {
      const history = Array.isArray(phase.history) ? phase.history : [];
      const last = history[history.length - 1];
      if (phase.phaseId !== AGENCY_PHASE || phase.project !== PROJECT || phase.status !== "closed") out.push(`${label}'s final phase record is not the proof phase closed`);
      if (!isObject(last) || last.from !== "awaiting_closure" || last.to !== "closed" || (closure !== null && !String(last.note).includes(String(closure.decisionId)))) out.push(`${label}'s final phase record does not end awaiting_closure to closed on the closure decision`);
    }
    if (gate !== null) {
      if (gate.decision !== "APPROVED_TO_PROCEED" || gate.ownerApprovalRequired !== false || gate.phaseId !== AGENCY_PHASE || gate.projectId !== PROJECT) out.push(`${label}'s gatekeeper did not approve this phase without the owner`);
      if (gate.decidedBy !== "ChatGPT") out.push(`${label}'s gatekeeper decision was decided by ${JSON.stringify(gate.decidedBy)}, not by the provider answer (ChatGPT)`);
      if (gate.provenance !== "InstallationBrokerProviderAnswer") out.push(`${label}'s gatekeeper decision's provenance is ${JSON.stringify(gate.provenance)}, not InstallationBrokerProviderAnswer`);
      if (!Array.isArray(gate.allowedActions) || gate.allowedActions.includes("phase-closure") || !Array.isArray(gate.forbiddenActions) || !gate.forbiddenActions.includes("phase-closure")) out.push(`${label}'s gatekeeper decision allows closure, which is the closure authority's`);
    }
    if (closure !== null) {
      if (closure.decision !== "close" || closure.phaseId !== AGENCY_PHASE || closure.projectId !== PROJECT || closure.scope !== "phase-closure") out.push(`${label}'s closure decision is not 'close' for the proof phase`);
      if (closure.decidedBy !== "ChatGPT") out.push(`${label}'s closure was decided by ${JSON.stringify(closure.decidedBy)}, not by the closure authority's provider answer (ChatGPT)`);
      if (!same(closure.ownerAcceptedFindings, [])) out.push(`${label}'s closure decision carries an owner-accepted finding`);
    }
  }
  return out;
}

function sp7(b) {
  const out = [];
  const v = view(b);
  let total = 0;
  for (const a of attemptsOf(v)) {
    if (!hasFolder(b, a)) continue;
    const label = `attempt ${a.id}`;
    const log = b.files[`${a.id}/run.log`];
    if (typeof log !== "string") {
      out.push(`${label}'s run.log is missing`);
      continue;
    }
    const printed = [LOG.gk.exec(log), LOG.cl.exec(log)].filter((hit) => hit !== null);
    const ledger = v.j(`${a.id}/records/gatekeeper-ledger.json`);
    if (!isObject(ledger)) {
      if (printed.length > 0 || claimsClosed(b, v, a)) out.push(`${label}'s metered broker calls cannot be checked: records/gatekeeper-ledger.json is missing or is not a JSON object`);
      continue;
    }
    const entries = (Array.isArray(ledger.entries) ? ledger.entries : []).filter((entry) => isObject(entry) && entry.phaseId === AGENCY_PHASE);
    if (entries.some((entry) => entry.projectId !== PROJECT)) out.push(`${label}: a metered broker call for the proof phase belongs to another project`);
    if (!same(entries.map((entry) => entry.requestId), printed.map((hit) => hit[2]))) out.push(`${label}: the metered broker calls for the phase are not exactly the requests the log names`);
    for (const entry of entries) if (!isCount(entry.costMicroUsd, 0)) out.push(`${label}: the metered cost of ${entry.requestId} is not a whole non-negative number of micro-USD`);
    const costs = entries.map((entry) => entry.costMicroUsd);
    if (!same(costs, printed.map((hit) => Number(hit[1])))) out.push(`${label}: the metered broker costs in the ledger (${costs.join(", ")}) are not the amounts the log printed (${printed.map((hit) => hit[1]).join(", ")})`);
    const sum = costs.reduce((acc, cost) => acc + (isCount(cost, 0) ? cost : 0), 0);
    if (sum > CAP_RUN) out.push(`${label}: the metered broker spend ${sum} micro-USD is over the ${CAP_RUN} per-run cap`);
    total += sum;
    const times = lines(b.files[`${a.id}/times.txt`]).filter((line) => line !== "");
    for (const entry of entries) {
      if (times.length !== 2 || !(ms(times[0]) - 1000 <= ms(entry.at) && ms(entry.at) <= ms(times[1]) + 1000)) out.push(`${label}: ${entry.requestId} was metered outside the run's window`);
    }
  }
  if (total > CAP_TOTAL) out.push(`the metered broker spend of all attempts, ${total} micro-USD, is over the ${CAP_TOTAL} total cap`);
  return out;
}

function sp8(b) {
  const out = [];
  const v = view(b);
  const setup = v.j("setup.json");
  if (!isObject(setup)) return ["setup.json is missing or is not a JSON object"];
  if (setup.schema !== SCHEMAS.setup) out.push(`setup.json is not a ${SCHEMAS.setup} record`);
  const listed = Array.isArray(setup.attempts) ? setup.attempts : [];
  const attempts = attemptsOf(v);
  if (attempts.length !== listed.length) out.push("setup.json lists an attempt that is not {id, config A or B, branch}, or lists one twice");
  for (const config of ["A", "B"]) {
    const count = attempts.filter((a) => a.config === config).length;
    if (count === 0) out.push(`setup.json lists no config ${config} attempt`);
    if (count > MAX_ATTEMPTS[config]) out.push(`setup.json lists ${count} config ${config} attempts, over the ${MAX_ATTEMPTS[config]} the runbook allows`);
  }
  const folders = new Set(Object.keys(b.files).map((rel) => rel.split("/")[0]).filter((name) => !["setup.json", "runtime.json"].includes(name)));
  for (const folder of folders) if (!attempts.some((a) => a.id === folder)) out.push(`the evidence has a folder ${folder} that setup.json does not list as an attempt: an attempt was recorded and not declared`);
  for (const a of attempts) {
    const label = `attempt ${a.id}`;
    if (!hasFolder(b, a)) {
      out.push(`${label} is listed in setup.json and has no evidence folder: it was declared and never recorded`);
      continue;
    }
    const outcome = need(v, `${a.id}/outcome.json`, out);
    const log = b.files[`${a.id}/run.log`];
    const times = lines(b.files[`${a.id}/times.txt`]).filter((line) => line !== "");
    if (outcome === null || typeof log !== "string") continue;
    const status = statusFromLog(log);
    if (!["closed", "refused", "stopped"].includes(outcome.status)) out.push(`${label}'s outcome status is not closed, refused or stopped`);
    else if (outcome.status !== status) out.push(`${label}'s outcome says ${outcome.status} but its log shows ${status}`);
    if (outcome.id !== a.id || outcome.config !== a.config || outcome.branch !== a.branch) out.push(`${label}'s outcome record is not for the attempt setup.json lists`);
    const exit = LOG.exit.exec(log);
    if (exit === null || outcome.exitCode !== Number(exit[1])) out.push(`${label}'s outcome exit code is not the one its log ends with`);
    if (times.length !== 2 || outcome.startedAt !== times[0] || outcome.endedAt !== times[1] || !(ms(times[0]) <= ms(times[1]))) out.push(`${label}'s outcome times are not the times file's start and end`);
    if (status === "closed" || outcome.status === "closed") {
      if (outcome.reason !== null) out.push(`${label} is recorded closed and still carries a refusal reason`);
    } else if (typeof outcome.reason !== "string" || outcome.reason.trim() === "" || !log.includes(outcome.reason)) out.push(`${label} did not close and its outcome carries no reason that appears in its log`);
    if (typeof b.notes === "string" && !b.notes.split("\n").some((line) => line.includes(`attempt ${a.id}: ${status}`))) out.push(`${NOTES} does not say 'attempt ${a.id}: ${status}'`);
  }
  return out;
}

// The words are built from pieces so that this file never contains the very text it forbids.
const FORBIDDEN_WORDS = [["write", "File"], ["append", "File"], ["mk", "dir"], ["rm", "Sync"], ["unlink", "Sync"], ["re", "name"], ["child_", "process"], ["fe", "tch"], ["ht", "tp"], ["n", "et"], ["ev", "al"]].map((pieces) => pieces.join(""));
const FS_READ_ONLY = ["readFileSync", "readdirSync", "lstatSync", "existsSync"];
const ALLOWED_IMPORTS = ["fs", "path", "crypto"];

function modulesOf(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("const MODULES = [");
  if (start < 0) return null;
  const end = text.indexOf("\n];", start);
  return end < 0 ? null : text.slice(start, end);
}

function sp9(b) {
  const out = [];
  if (typeof b.notes !== "string") out.push(`${NOTES} is missing`);
  else for (const phrase of ["no product code", "no model call", "does not lift D4"]) if (!b.notes.includes(phrase)) out.push(`${NOTES} does not say '${phrase}'`);
  const code = withoutComments(b.selfSource);
  const named = [...code.matchAll(/\brequire\(\s*(["'`])([^"'`]+)\1\s*\)/g)].map((hit) => hit[2]);
  const identifiers = (code.match(/\brequire\b/g) ?? []).length;
  if (identifiers !== named.length) out.push("this validator uses the module loader other than as a call with a literal module name");
  if (!same([...named].sort(), [...ALLOWED_IMPORTS].sort())) out.push(`this validator loads ${named.join(", ") || "nothing"}; it must load exactly ${ALLOWED_IMPORTS.join(", ")}, once each, by literal name`);
  for (const word of FORBIDDEN_WORDS) if (new RegExp(`\\b${word}\\b`).test(code)) out.push(`this validator contains the word ${word}`);
  for (const use of new Set([...code.matchAll(/\bfs\.(\w+)/g)].map((hit) => hit[1]))) if (!FS_READ_ONLY.includes(use)) out.push(`this validator uses fs.${use}, which is not one of ${FS_READ_ONLY.join(", ")}`);
  if (/\bnew\s+Function\b|\bimport\s*\(/.test(code)) out.push("this validator builds code from text or imports dynamically");
  // The loader word is built from pieces so that this file holds exactly its three real loads and nothing the loader count above would read.
  if (!new RegExp(`^const fs = ${["req", "uire"].join("")}\\("fs"\\);$`, "m").test(code)) out.push("this validator does not load the file system with its one plain const fs line");
  if (new RegExp(`\\bfs\\s*\\[|=\\s*fs\\s*[;,)]|\\{[^}]*\\}\\s*=\\s*(?:fs\\b|${["req", "uire"].join("")}\\()`).test(code)) out.push("this validator reaches the file system through an alias, an index or a destructuring, not through fs.<name> calls");
  const lists = [];
  for (const [text, name] of [[b.validateAll, "validate-all"], [b.cachedRunner, "cached-runner"]]) {
    const slice = modulesOf(text);
    if (slice === null) {
      out.push(`${name} has no MODULES list`);
      continue;
    }
    const rows = slice.split("\n");
    const names = [...rows.filter((row) => !/^\s*\/\//.test(row)).join("\n").matchAll(/"([^"]+)"/g)].map((hit) => hit[1]);
    lists.push(names);
    const count = names.filter((entry) => entry === THIS_VALIDATOR).length;
    if (count !== 1) out.push(`${THIS_VALIDATOR} is in ${name} ${count} times, not once`);
    else {
      if (!names.includes(BEFORE_VALIDATOR) || names.indexOf(THIS_VALIDATOR) > names.indexOf(BEFORE_VALIDATOR)) out.push(`${THIS_VALIDATOR} is not registered before ${BEFORE_VALIDATOR} in ${name}`);
      const at = rows.findIndex((row) => row.includes(`"${THIS_VALIDATOR}"`));
      if (at < 1 || !/^\s*\/\/ PROJECTOS-STAGE4-EXIT-PROOF1A\b/.test(rows[at - 1])) out.push(`${THIS_VALIDATOR} has no PROJECTOS-STAGE4-EXIT-PROOF1A comment line above it in ${name}`);
    }
  }
  if (lists.length === 2 && !same(lists[0], lists[1])) out.push("validate-all and the cached runner do not list the same validators in the same order");
  return out;
}

const RULES = [["SP-1", sp1], ["SP-2", sp2], ["SP-3", sp3], ["SP-4", sp4], ["SP-5", sp5], ["SP-6", sp6], ["SP-7", sp7], ["SP-8", sp8], ["SP-9", sp9]];

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

/** Proven only when a closed config A attempt and a closed config B attempt exist. Never a rule problem: an honest refusal is a verdict, not a lie. */
function proofStatus(b) {
  const v = view(b);
  const attempts = attemptsOf(v);
  const closed = attempts.filter((a) => statusFromLog(b.files[`${a.id}/run.log`]) === "closed");
  const others = attempts.filter((a) => !closed.includes(a)).map((a) => `${a.id} (config ${a.config}) ${statusFromLog(b.files[`${a.id}/run.log`])}`);
  return { proven: closed.some((a) => a.config === "A") && closed.some((a) => a.config === "B"), closed: closed.map((a) => a.id), others };
}

// ---------------------------------------------------------------------------------------------------------
// The mutation kit: every edit re-seals the manifest and the notes, so only the rule meant to see it does.
// ---------------------------------------------------------------------------------------------------------

const A = "A2";
const B = "B2";
const R = (id, name) => `${id}/records/${name}`;

function reseal(b, rel, old) {
  const manifest = JSON.parse(b.manifest);
  if (rel in manifest.files && rel in b.files) manifest.files[rel] = `sha256:${sha(b.files[rel])}`;
  b.manifest = JSON.stringify(manifest, null, 2);
  if (rel.endsWith("/run.log") && typeof old === "string" && typeof b.notes === "string") b.notes = b.notes.split(sha(old)).join(sha(b.files[rel]));
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
const setupEdit = (b, fn) => jsonEdit(b, "setup.json", fn);
const runtimeEdit = (b, fn) => jsonEdit(b, `${B}/runtime.json`, fn);
const inv = (b, id, fn) => jsonEdit(b, R(id, "invocation.json"), fn);
const cfgEdit = (b, id, fn) => jsonEdit(b, R(id, "project-config.json"), fn);
const logEdit = (b, id, from, to) => textEdit(b, `${id}/run.log`, from, to);
const outcomeEdit = (b, id, fn) => jsonEdit(b, `${id}/outcome.json`, fn);
/** Edit a record the evidence hashed, and record its new hash in the evidence. */
const bound = (b, id, name, key, fn) => {
  jsonEdit(b, R(id, name), fn);
  jsonEdit(b, R(id, "evidence.json"), (ev) => { ev[key] = sha(b.files[R(id, name)]); });
};
const reviewerEdit = (b, id, fn) => bound(b, id, "reviewer.json", "reviewerSha256", fn);
const effectsEdit = (b, id, fn) => bound(b, id, "effects.json", "effectsSha256", fn);
const briefWith = (b, id, fn) => {
  jsonEdit(b, R(id, "brief.json"), fn);
  inv(b, id, (i) => { i.brief.digest = `sha256:${sha(JSON.stringify(JSON.parse(b.files[R(id, "brief.json")])))}`; });
};
const gate = (b, id, fn) => jsonEdit(b, R(id, "gatekeeper-decision.json"), fn);
const closure = (b, id, fn) => jsonEdit(b, R(id, "closure-decision.json"), fn);
const ledger = (b, id, fn) => jsonEdit(b, R(id, "gatekeeper-ledger.json"), (l) => fn(l.entries.filter((e) => e.phaseId === AGENCY_PHASE)));
const changedWith = (b, id, add, remove = null) => {
  const rel = `${id}/changed-paths.txt`;
  const kept = lines(b.files[rel]).filter((line) => line !== "" && line !== remove);
  put(b, rel, `${[...kept, ...add].join("\n")}\n`);
};
const without = (text, pattern) => {
  if (!pattern.test(text)) throw new Error("mutation target not found in a runner list");
  return text.replace(pattern, "");
};
const REGISTRATION = /  \/\/ PROJECTOS-STAGE4-EXIT-PROOF1A[^\n]*\n  "val-projectos-stage4-exit-proof1a",\n/;
const COMMENT_LINE = /  \/\/ PROJECTOS-STAGE4-EXIT-PROOF1A[^\n]*\n(?=  "val-projectos-stage4-exit-proof1a",\n)/;
const registered = (b, key, fn) => { b[key] = fn(b[key]); };

/** `expect` names text the rule's own problem must contain: proof the mutation is killed by that check and not by a cascade. */
const X = (name, rule, apply, also = [], expect = null) => ({ name, rule, apply, also, expect });

const MUTATIONS = [
  // SP-1 the files are the files
  X("a-changed-log-is-refused", "SP-1", (b) => put(b, `${A}/run.log`, `${b.files[`${A}/run.log`]}\n`, false)),
  X("a-changed-first-log-is-refused", "SP-1", (b) => put(b, `${B}/run.log`, `${b.files[`${B}/run.log`]}\n`, false)),
  X("a-changed-record-is-refused", "SP-1", (b) => put(b, R(A, "closure-decision.json"), `${b.files[R(A, "closure-decision.json")]}\n`, false)),
  X("an-added-evidence-file-is-refused", "SP-1", (b) => put(b, R(A, "extra.json"), "{}", false)),
  X("an-added-evidence-file-in-the-manifest-too-is-refused", "SP-1", (b) => {
    b.files[R(A, "extra.json")] = "{}";
    manifestEdit(b, (m) => { m.files[R(A, "extra.json")] = `sha256:${sha("{}")}`; });
  }),
  X("a-missing-evidence-file-is-refused", "SP-1", (b) => drop(b, R(A, "closure-decision.json"), false), ["SP-6"]),
  X("an-evidence-file-dropped-from-folder-and-manifest-is-refused", "SP-1", (b) => drop(b, R(A, "closure-decision.json")), ["SP-6"]),
  X("a-file-left-out-of-the-manifest-is-refused", "SP-1", (b) => manifestEdit(b, (m) => { delete m.files[R(A, "reviewer.json")]; })),
  X("a-manifest-hash-that-is-another-files-is-refused", "SP-1", (b) => manifestEdit(b, (m) => { m.files[`${A}/run.log`] = m.files[`${B}/run.log`]; })),
  X("a-manifest-entry-for-a-file-that-is-not-there-is-refused", "SP-1", (b) => manifestEdit(b, (m) => { m.files[R(A, "ghost.json")] = m.files[`${A}/run.log`]; })),
  X("a-manifest-path-that-leaves-the-folder-is-refused", "SP-1", (b) => manifestEdit(b, (m) => { m.files["../outside.json"] = m.files[`${A}/run.log`]; })),
  X("a-manifest-with-another-schema-is-refused", "SP-1", (b) => manifestEdit(b, (m) => { m.schema = "other/1"; })),
  X("a-manifest-with-no-files-table-is-refused", "SP-1", (b) => manifestEdit(b, (m) => { delete m.files; })),
  X("notes-without-a-log-hash-are-refused", "SP-1", (b) => { b.notes = b.notes.split(sha(b.files[`${B}/run.log`])).join("0".repeat(64)); }),
  X("no-notes-file-is-refused", "SP-1", (b) => { b.notes = null; }, ["SP-2", "SP-9"]),
  X("a-log-that-is-not-utf8-is-refused", "SP-1", (b) => {
    const bytes = `\xff\n${Buffer.from(b.files[`${A}/run.log`], "utf8").toString("latin1")}`;
    const derived = deriveFiles({ [`${A}/run.log`]: bytes });
    b.loadProblems.push(...derived.problems);
    put(b, `${A}/run.log`, derived.files[`${A}/run.log`]);
  }, [], "not valid UTF-8"),
  X("a-symbolic-link-in-the-evidence-is-refused", "SP-1", (b) => { b.links.push(R(A, "brief.json")); }, [], "symbolic link"),
  X("an-attempt-listed-but-never-run-is-refused", "SP-1", (b) => setupEdit(b, (s) => { s.attempts.push({ id: "B3", config: "B", branch: "s4proof-b3" }); }), ["SP-8"], "is part of the evidence"),
  // SP-2 same runtime, same phase, same source
  X("a-runtime-that-changed-another-path-is-refused", "SP-2", (b) => runtimeEdit(b, (r) => { r.changedPathsVsPlanHead.push("projectos/agent/src/loop/runner.ts"); })),
  X("a-runtime-that-is-not-the-allowlist-only-is-refused", "SP-2", (b) => runtimeEdit(b, (r) => { r.changedPathsVsPlanHead = []; })),
  X("a-dirty-runtime-is-refused", "SP-2", (b) => runtimeEdit(b, (r) => { r.worktreeClean = false; })),
  X("a-runtime-with-no-plan-head-is-refused", "SP-2", (b) => runtimeEdit(b, (r) => { r.planBranchHead = "not-a-commit"; })),
  X("an-attempts-own-runtime-record-that-is-not-an-object-is-refused", "SP-2", (b) => put(b, `${B}/runtime.json`, "[]"), [], "is missing or is not a JSON object"),
  X("an-attempts-own-runtime-record-that-is-unparsable-is-refused", "SP-2", (b) => put(b, `${B}/runtime.json`, "{not json"), [], "is missing or is not a JSON object"),
  X("an-older-runtime-that-changed-another-path-is-refused", "SP-2", (b) => jsonEdit(b, "runtime.json", (r) => { r.changedPathsVsPlanHead = ["projectos/agent/src/loop/runner.ts"]; })),
  X("closed-runs-on-different-runtimes-with-no-statement-are-refused", "SP-2", (b) => { b.notes = b.notes.split(RUNTIME_DIFFERENCE_STATEMENT).join("the closed runs ran on one runtime"); }, [], "ran on different runtimes"),
  X("a-run-of-another-entry-script-is-refused", "SP-2", (b) => inv(b, B, (i) => { i.process.argv[1] = "C:\\dev\\other\\projectos\\agent\\bin\\projectos.js"; })),
  X("caps-other-than-the-owners-are-refused", "SP-2", (b) => setupEdit(b, (s) => { s.capMicroUsdTotal = 6_000_000; })),
  X("a-setup-for-another-phase-is-refused", "SP-2", (b) => setupEdit(b, (s) => { s.phaseId = "OTHER-PHASE"; })),
  X("a-run-of-another-phase-text-is-refused", "SP-2", (b) => briefWith(b, B, (br) => { br.phase.description = `${br.phase.description} Also change site/index.html.`; })),
  X("a-run-of-another-phase-is-refused", "SP-2", (b) => inv(b, A, (i) => { i.phaseId = "OTHER-PHASE"; })),
  X("a-different-source-tree-is-refused", "SP-2", (b) => jsonEdit(b, `${B}/source-digest.json`, (s) => { s.sourceDigest = `sha256:${"b".repeat(64)}`; })),
  X("a-different-base-is-refused", "SP-2", (b) => jsonEdit(b, `${B}/source-digest.json`, (s) => { s.baseCommit = "2".repeat(40); })),
  X("a-run-that-did-not-descend-from-base-is-refused", "SP-2", (b) => jsonEdit(b, `${B}/source-digest.json`, (s) => { s.baseIsAncestor = false; })),
  X("a-digest-for-another-head-is-refused", "SP-2", (b) => jsonEdit(b, `${B}/source-digest.json`, (s) => { s.preRunHead = "3".repeat(40); })),
  X("a-config-that-differs-outside-execution-is-refused", "SP-2", (b) => cfgEdit(b, B, (c) => { c.productionFreeze = false; })),
  // SP-3 the swap is the config
  X("a-config-b-reviewer-that-is-codex-is-refused", "SP-3", (b) => cfgEdit(b, B, (c) => { c.execution.reviewerWorkerId = "codex-reviewer"; })),
  X("a-config-b-implementer-of-the-reviewer-kind-is-refused", "SP-3", (b) => cfgEdit(b, B, (c) => { c.execution.workers[0].kind = "codex-cli"; })),
  X("a-config-b-implementer-behind-a-shim-is-refused", "SP-3", (b) => cfgEdit(b, B, (c) => { c.execution.workers[0].command = "C:/Users/murad/AppData/Roaming/npm/codex.cmd"; })),
  X("a-config-b-reviewer-with-a-write-grant-is-refused", "SP-3", (b) => cfgEdit(b, B, (c) => { c.execution.workers[1].args.splice(2, 0, "Write(site/colophon.txt)"); })),
  X("a-config-b-implementer-with-a-wider-grant-is-refused", "SP-3", (b) => cfgEdit(b, B, (c) => { c.execution.workers[0].args[1] += ",Write(site/index.html)"; })),
  X("a-config-with-a-default-worker-is-refused", "SP-3", (b) => cfgEdit(b, B, (c) => { c.execution.defaultWorkerId = "codex-implementer"; })),
  X("a-config-a-that-is-not-the-pinned-pair-is-refused", "SP-3", (b) => cfgEdit(b, A, (c) => { c.execution.workers[1].kind = "claude-code-cli"; })),
  X("a-relayed-session-flag-is-refused", "SP-3", (b) => inv(b, A, (i) => { i.process.argv.push("--session", "x"); })),
  X("a-worker-flag-is-refused", "SP-3", (b) => inv(b, B, (i) => { i.process.argv.push("--worker", "claude-local"); })),
  X("a-dry-run-with-no-execute-is-refused", "SP-3", (b) => inv(b, B, (i) => { i.process.argv.pop(); })),
  X("another-interpreter-is-refused", "SP-3", (b) => inv(b, A, (i) => { i.process.argv[0] = "C:\\bin\\python.exe"; })),
  X("an-invocation-of-another-worker-is-refused", "SP-3", (b) => inv(b, B, (i) => { i.workerId = "claude-local"; i.workerKind = "claude-code-cli"; })),
  X("a-log-naming-another-worker-is-refused", "SP-3", (b) => logEdit(b, A, /^Worker: .*$/m, "Worker: codex-reviewer (codex-cli)")),
  X("a-reused-process-id-is-refused", "SP-3", (b) => {
    const pid = JSON.parse(b.files[R(A, "invocation.json")]).process.pid;
    const ppid = JSON.parse(b.files[R(B, "invocation.json")]).process.ppid;
    inv(b, B, (i) => { i.process.pid = pid; });
    logEdit(b, B, /\(pid \d+, parent \d+\)/, `(pid ${pid}, parent ${ppid})`);
  }, [], "share a pid"),
  X("a-reused-invocation-id-is-refused", "SP-3", (b) => {
    const id = JSON.parse(b.files[R(A, "invocation.json")]).invocationId;
    inv(b, B, (i) => { i.invocationId = id; });
  }, ["SP-6"], "share a invocation"),
  X("a-brief-digest-that-is-not-the-brief-is-refused", "SP-3", (b) => inv(b, B, (i) => { i.brief.digest = `sha256:${"c".repeat(64)}`; })),
  X("a-session-not-minted-by-its-own-invocation-is-refused", "SP-3", (b) => inv(b, A, (i) => { i.sessionId = `${AGENCY_PHASE}-000000000000-00000000`; }), ["SP-4", "SP-6"]),
  X("a-log-with-two-continue-lines-is-refused", "SP-3", (b) => logEdit(b, A, /^projectos continue: run.*$/m, "$&\nprojectos continue: run again")),
  // SP-4 the reviewer is another provider
  X("a-reviewer-that-is-not-provider-distinct-is-refused", "SP-4", (b) => reviewerEdit(b, B, (r) => { r.providerDistinct = false; })),
  X("a-reviewer-of-the-implementers-kind-is-refused", "SP-4", (b) => reviewerEdit(b, B, (r) => { r.reviewerKind = r.implementerKind; })),
  X("a-reviewer-that-is-the-implementer-is-refused", "SP-4", (b) => reviewerEdit(b, A, (r) => { r.reviewerWorkerId = r.implementerWorkerId; })),
  X("a-concerns-verdict-is-refused", "SP-4", (b) => reviewerEdit(b, A, (r) => { r.verdict = "CONCERNS"; })),
  X("a-review-with-an-unresolved-medium-finding-is-refused", "SP-4", (b) => reviewerEdit(b, B, (r) => { r.findings.push({ id: "reviewer:x", severity: "MEDIUM", category: "c", summary: "s", resolved: false }); }), [], "above LOW"),
  X("a-review-with-an-unresolved-high-finding-is-refused", "SP-4", (b) => reviewerEdit(b, A, (r) => { r.findings = [{ id: "reviewer:y", severity: "HIGH", category: "c", summary: "s", resolved: false }]; }), [], "above LOW"),
  X("a-review-with-no-findings-list-is-refused", "SP-4", (b) => reviewerEdit(b, B, (r) => { delete r.findings; }), [], "no findings list"),
  X("a-requested-review-not-performed-is-refused", "SP-4", (b) => reviewerEdit(b, A, (r) => { r.reviewsPerformed = []; })),
  X("a-reviewer-record-for-another-session-is-refused", "SP-4", (b) => reviewerEdit(b, B, (r) => { r.sessionId = `${AGENCY_PHASE}-000000000000-00000000`; })),
  X("a-reviewer-record-not-bound-to-the-evidence-is-refused", "SP-4", (b) => jsonEdit(b, R(A, "reviewer.json"), (r) => { r.recordedAt = "2020-01-01T00:00:00.000Z"; })),
  // SP-5 the write scope held
  X("a-vendor-file-in-the-changed-paths-is-refused", "SP-5", (b) => changedWith(b, B, ["vendor/autosocial/x.txt"])),
  X("an-authority-record-in-the-changed-paths-is-refused", "SP-5", (b) => changedWith(b, B, [".projectops/authority/closure-delegation.json"])),
  X("the-project-config-in-the-changed-paths-is-refused", "SP-5", (b) => changedWith(b, B, [".projectops/project-config.json"])),
  X("the-gatekeeper-config-in-the-changed-paths-is-refused", "SP-5", (b) => changedWith(b, A, [".projectops/gatekeeper.json"])),
  X("a-run-that-did-not-write-the-colophon-is-refused", "SP-5", (b) => changedWith(b, B, [], "site/colophon.txt")),
  X("a-colophon-with-other-lines-is-refused", "SP-5", (b) => put(b, R(B, "colophon.txt"), `${COLOPHON_TITLE}\n`)),
  X("a-prohibited-effect-is-refused", "SP-5", (b) => effectsEdit(b, B, (e) => { e.externalSendOccurred = true; })),
  X("an-effects-record-not-bound-to-the-evidence-is-refused", "SP-5", (b) => put(b, R(A, "effects.json"), `${b.files[R(A, "effects.json")]}\n`)),
  // SP-6 it reached closed by itself
  X("a-log-with-no-clean-exit-is-refused", "SP-6", (b) => logEdit(b, B, /^exit=0$/m, "exit=1"), ["SP-8"]),
  X("a-second-stop-is-refused", "SP-6", (b) => logEdit(b, A, /^exit=0$/m, "STOPPED (OWNER_DECISION_REQUIRED): something else\nexit=0"), ["SP-8"]),
  X("a-log-with-no-independent-approval-is-refused", "SP-6", (b) => logEdit(b, B, /^ {2}independent review by \S+: APPROVE\n/m, "")),
  X("a-log-with-no-validator-pass-is-refused", "SP-6", (b) => logEdit(b, A, /^ {2}PASS validator validate-site\n/m, "")),
  X("a-gatekeeper-decision-not-from-the-broker-is-refused", "SP-6", (b) => gate(b, B, (g) => { g.provenance = "OwnerAnswer"; })),
  X("a-gatekeeper-that-needs-the-owner-is-refused", "SP-6", (b) => gate(b, A, (g) => { g.ownerApprovalRequired = true; })),
  X("a-gatekeeper-decision-for-another-request-is-refused", "SP-6", (b) => gate(b, B, (g) => { g.decisionId = "GKDEC-GKREQ-000000000000000000000000"; })),
  X("a-closure-decided-by-the-owner-is-refused", "SP-6", (b) => closure(b, A, (c) => { c.decidedBy = "Murad"; })),
  X("a-closure-that-rejects-is-refused", "SP-6", (b) => closure(b, B, (c) => { c.decision = "reject"; })),
  X("a-phase-that-is-not-closed-is-refused", "SP-6", (b) => jsonEdit(b, R(B, "phase-record.json"), (p) => { p.status = "awaiting_closure"; })),
  X("a-work-record-that-is-not-complete-is-refused", "SP-6", (b) => jsonEdit(b, R(A, "work.v1.json"), (w) => { w.state = "AWAITING_GATE"; })),
  X("a-worker-that-did-not-exit-zero-is-refused", "SP-6", (b) => jsonEdit(b, R(B, "session.json"), (s) => { s.exitCode = 1; })),
  X("a-check-that-did-not-pass-is-refused", "SP-6", (b) => jsonEdit(b, R(A, "evidence.json"), (e) => { e.checks.find((c) => c.id === "validate-site").passed = false; })),
  X("findings-not-bound-to-the-evidence-are-refused", "SP-6", (b) => put(b, R(B, "findings.json"), `${b.files[R(B, "findings.json")]}\n`)),
  // SP-7 the metered spend
  X("a-ledger-cost-that-is-not-the-logged-cost-is-refused", "SP-7", (b) => ledger(b, A, (entries) => { entries[0].costMicroUsd += 1; })),
  X("an-extra-metered-call-is-refused", "SP-7", (b) => jsonEdit(b, R(B, "gatekeeper-ledger.json"), (l) => { const mine = l.entries.filter((e) => e.phaseId === AGENCY_PHASE); l.entries.push({ ...mine[0], requestId: "GKREQ-000000000000000000000000" }); })),
  X("a-missing-metered-call-is-refused", "SP-7", (b) => jsonEdit(b, R(A, "gatekeeper-ledger.json"), (l) => { l.entries = l.entries.filter((e) => !(e.phaseId === AGENCY_PHASE && /^CLREQ/.test(e.requestId))); })),
  X("a-run-over-its-cap-is-refused", "SP-7", (b) => {
    ledger(b, A, (entries) => { entries[0].costMicroUsd = 1_600_000; });
    logEdit(b, A, /recorded \d+ micro-USD/, "recorded 1600000 micro-USD");
  }),
  X("a-call-outside-the-run-window-is-refused", "SP-7", (b) => ledger(b, B, (entries) => { entries[0].at = "2020-01-01T00:00:00.000Z"; })),
  X("a-call-for-another-project-is-refused", "SP-7", (b) => ledger(b, A, (entries) => { entries[0].projectId = "other"; })),
  // SP-8 a refusal is never hidden
  X("a-closed-claim-over-a-refused-log-is-refused", "SP-8", (b) => logEdit(b, B, /^exit=0$/m, "REFUSED (WORKER_REFUSED): a worker was refused\nexit=0"), ["SP-6"]),
  X("an-outcome-that-contradicts-its-log-is-refused", "SP-8", (b) => outcomeEdit(b, B, (o) => { o.status = "refused"; o.reason = "x"; })),
  X("a-closed-outcome-with-a-reason-is-refused", "SP-8", (b) => outcomeEdit(b, A, (o) => { o.reason = "something"; })),
  X("an-outcome-for-another-attempt-is-refused", "SP-8", (b) => outcomeEdit(b, B, (o) => { o.config = "A"; })),
  X("an-outcome-with-another-exit-code-is-refused", "SP-8", (b) => outcomeEdit(b, A, (o) => { o.exitCode = 1; })),
  X("an-outcome-with-other-times-is-refused", "SP-8", (b) => outcomeEdit(b, A, (o) => { o.endedAt = "2020-01-01T00:00:00Z"; })),
  X("an-attempt-recorded-but-not-declared-is-refused", "SP-8", (b) => put(b, "B3/outcome.json", "{}"), ["SP-1"]),
  X("too-many-config-b-attempts-are-refused", "SP-8", (b) => setupEdit(b, (s) => { s.attempts.push({ id: "B3", config: "B", branch: "s4proof-b3" }); }), ["SP-1"]),
  X("a-setup-with-no-config-b-attempt-is-refused", "SP-8", (b) => setupEdit(b, (s) => { s.attempts = s.attempts.filter((a) => a.config === "A"); }), ["SP-1"]),
  X("a-declared-attempt-with-no-folder-is-refused", "SP-8", (b) => setupEdit(b, (s) => { s.attempts.push({ id: "B3", config: "B", branch: "s4proof-b3" }); }), ["SP-1"], "declared and never recorded"),
  X("notes-that-do-not-name-an-attempt-are-refused", "SP-8", (b) => { b.notes = b.notes.split("\n").filter((line) => !line.includes(`attempt ${B}:`)).join("\n"); }),
  // SP-9 no product, nothing but a read, registered
  X("notes-without-the-no-model-call-statement-are-refused", "SP-9", (b) => { b.notes = b.notes.split("no model call").join("a model call"); }),
  X("notes-without-the-d4-statement-are-refused", "SP-9", (b) => { b.notes = b.notes.split("does not lift D4").join("lifts D4"); }),
  // The mutation texts are built from pieces so that this file never contains what the lint forbids.
  X("a-validator-that-writes-is-refused", "SP-9", (b) => { b.selfSource += `\n${["fs", "writeFileSync"].join(".")}('x', 'y');\n`; }),
  X("a-validator-that-loads-another-module-is-refused", "SP-9", (b) => { b.selfSource += `\nconst extra = ${["req", "uire"].join("")}("os");\n`; }),
  X("a-validator-that-aliases-the-file-system-is-refused", "SP-9", (b) => { b.selfSource += `\nconst alias = ${["f", "s"].join("")};\n`; }),
  X("a-validator-that-destructures-a-write-is-refused", "SP-9", (b) => { b.selfSource += `\nconst { ${["write", "FileSync"].join("")} } = ${["f", "s"].join("")};\n`; }),
  X("a-validator-that-builds-code-is-refused", "SP-9", (b) => { b.selfSource += `\nconst built = ${["new Fun", "ction"].join("")}('return 1');\n`; }),
  X("a-validator-not-registered-in-validate-all-is-refused", "SP-9", (b) => registered(b, "validateAll", (t) => without(t, REGISTRATION))),
  X("a-validator-not-registered-in-the-cached-runner-is-refused", "SP-9", (b) => registered(b, "cachedRunner", (t) => without(t, REGISTRATION))),
  X("a-validator-registered-twice-is-refused", "SP-9", (b) => registered(b, "validateAll", (t) => t.replace(REGISTRATION, (m) => m + m))),
  X("a-validator-registered-after-memory-stores-is-refused", "SP-9", (b) => registered(b, "cachedRunner", (t) => without(t, REGISTRATION).replace(`  "${BEFORE_VALIDATOR}",\n`, (m) => `${m}  "${THIS_VALIDATOR}",\n`))),
  X("a-registration-with-no-comment-line-is-refused", "SP-9", (b) => registered(b, "validateAll", (t) => without(t, COMMENT_LINE))),
];

/** A file that parses as null, a list, a string, a number or an empty object, and every runner text gone or empty, must never crash a rule. */
function crashErrors(base) {
  const errors = [];
  let runs = 0;
  const check = (label, copy) => {
    runs += 1;
    for (const [id, problems] of Object.entries(judge(copy))) if (problems.some((problem) => problem.startsWith(`${id} threw:`))) errors.push(`SP-F: ${id} threw on ${label}: ${problems.find((problem) => problem.includes("threw:"))}`);
  };
  for (const rel of Object.keys(base.files).filter((name) => name.endsWith(".json"))) {
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

function selfTest(base) {
  const errors = [];
  const results = [];
  const clean = judge(base);
  if (Object.keys(clean).length > 0) return { errors: [`SP-M: the unmutated evidence does not pass: ${Object.keys(clean).join(", ")}`], results, extras: [] };
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("SP-M: two mutations share a name");
  for (const m of MUTATIONS) {
    const copy = structuredClone(base);
    try {
      m.apply(copy);
    } catch (error) {
      errors.push(`SP-M: mutation '${m.name}' no longer applies: ${error.message}`);
      continue;
    }
    if (canon(copy) === canon(base)) {
      errors.push(`SP-M: mutation '${m.name}' changed nothing`);
      continue;
    }
    const all = judge(copy);
    const fired = Object.keys(all).sort();
    const wanted = [...new Set([m.rule, ...m.also])].sort();
    const own = all[m.rule] ?? [];
    const matched = m.expect === null ? null : own.find((problem) => problem.includes(m.expect));
    results.push({ name: m.name, rule: m.rule, fired, matched: matched ?? null });
    if (Object.values(all).some((problems) => problems.some((problem) => / threw: /.test(problem)))) errors.push(`SP-M: mutation '${m.name}' made a rule throw instead of refuse`);
    if (!fired.includes(m.rule)) errors.push(`SP-M: mutation '${m.name}' survived; ${m.rule} did not fire (${fired.join(", ") || "nothing"})`);
    else if (!same(fired, wanted)) errors.push(`SP-M: mutation '${m.name}' wanted ${wanted.join(", ")} and fired ${fired.join(", ")}`);
    else if (m.expect !== null && matched === undefined) errors.push(`SP-M: mutation '${m.name}' was killed by ${m.rule} but not by the check that names '${m.expect}'`);
  }
  const proved = new Set(MUTATIONS.map((m) => m.rule));
  for (const [id] of RULES) if (!proved.has(id)) errors.push(`SP-M: rule ${id} has no named mutation`);
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
    if (m.rule in judge(copy, m.rule)) errors.push(`SP-D: mutation '${m.name}' still fires ${m.rule} with that rule's body replaced by an empty one`);
  }
  const crash = crashErrors(base);
  errors.push(...crash.errors);
  const extras = [
    `  dead-rule control: ${deadRuns} mutations all survive a judge whose own rule body is replaced by an empty one`,
    `  crash resistance: ${crash.runs} judge runs on files holding null, a list, a string, a number or an empty object: no rule threw`,
  ];
  return { errors, results, extras };
}

/** The verdict for validate-all: the problems, or the refusal that makes the proof NOT PROVEN, or nothing. */
function run() {
  const bundle = loadBundle();
  const fired = judge(bundle);
  if (Object.keys(fired).length > 0) return messagesOf(fired);
  const status = proofStatus(bundle);
  if (!status.proven) return [`PROOF NOT PROVEN: closed attempts [${status.closed.join(", ")}]; recorded and not closed: [${status.others.join("; ") || "none"}]. A closed config A attempt and a closed config B attempt are both required`];
  return selfTest(bundle).errors;
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(__filename)) {
  const bundle = loadBundle();
  const fired = judge(bundle);
  const errors = Object.keys(fired).length > 0 ? messagesOf(fired) : [];
  const status = errors.length === 0 ? proofStatus(bundle) : null;
  if (status !== null && !status.proven) errors.push(`PROOF NOT PROVEN: closed attempts [${status.closed.join(", ")}]; recorded and not closed: [${status.others.join("; ") || "none"}]. A closed config A attempt and a closed config B attempt are both required`);
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
  console.log(`${THIS_VALIDATOR}: PASS (${RULES.length} rules over ${Object.keys(bundle.files).length} evidence files; ${test.results.length} named mutations killed; proven by attempts ${proofStatus(bundle).closed.join(", ")})`);
}

module.exports = { run, judge, selfTest, loadBundle, proofStatus, MUTATIONS, RULE_NAMES, MODULE_COMMENT };
