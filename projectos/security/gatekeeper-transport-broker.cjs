"use strict";
/**
 * The trusted side of the gatekeeper transport — PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 *
 * WHY THIS EXISTS. The agent used to resolve the OpenAI credential into its own process and build the
 * `Authorization` header there. That put the raw value inside the same process as generated agent
 * code running against an untrusted governed project, and the whole authority chain — "is this
 * project allowed?", "did its owner approve?" — was evaluated by that same code. An adversarial
 * review named it: the check verifies the one file the attacker least needs, using an oracle the
 * attacker can select, from code the attacker can rewrite.
 *
 * WHAT MOVED. Everything that decides whether the credential may be used, and the use itself:
 *   - the installation's committed project allowlist,
 *   - the governed project's committed `secrets-handling` receipt,
 *   - the binding between the request and that project and phase,
 *   - resolving the value out of the Windows Credential Manager,
 *   - the HTTPS call.
 * What comes back is a status and a body. The value never crosses back.
 *
 * HOW IT IS TRUSTED. The caller reads these bytes from the INSTALLATION's git object store, checks
 * them against the working-tree copy, and executes THE BYTES IT READ — `node -e <source>` — rather
 * than a path. There is therefore no window in which the verified file and the executed file can
 * differ: the thing verified is the thing run. That is what closes the verify-then-spawn race; it is
 * not solved by re-reading a path more carefully.
 *
 * WHERE "THIS INSTALLATION" COMES FROM. Executed as `node -e <source>`, this file has no `__dirname`
 * to anchor itself with, and an install root taken from the REQUEST would make every check circular:
 * a caller could name any repository it controls, commit a malicious adapter and a matching allowlist
 * into it, and every question here would answer yes against genuine git. So the agent-side verifier
 * PINS the root into the source it runs, as `TRUSTED_INSTALL_ROOT`, derived from the running code's
 * own location. A governed project cannot move the installation's files, and a caller that omits the
 * pin gets a refusal rather than a default.
 *
 * WHAT IT WILL NOT DO. It takes no URL, no headers, no install root and no command from its caller. The endpoint is a
 * constant here, the only header it adds is the one it builds from the credential it resolved, and
 * the credential reference must be one this file names. A caller can supply a model, a body, a
 * timeout, and the identity of the project it claims to be — and every one of those claims is
 * re-checked here against committed records rather than believed.
 *
 * IT PRINTS ONE JSON OBJECT AND NOTHING ELSE. Its stdout is parsed by the caller; a stray
 * diagnostic would corrupt the result, and a diagnostic quoting the request is how a key reaches a
 * log file.
 */

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ALLOWLIST_REL = "projectos/security/installation-project-allowlist.json";
const ADAPTER_REL = "projectos/credentials/windows-credential-store.ps1";

/** The only credential references this broker will resolve, and what they are in the vault. */
const VAULT_REFERENCE = Object.freeze({
  OPENAI_GATEKEEPER_KEY: "ProjectOS/projectos/development/openai/gatekeeper-api-key",
});

const POWERSHELL_BASENAME = /^powershell\.exe$/i;
const REF_SHAPE = /^[A-Z][A-Z0-9_]{7,63}$/;

function isUnc(p) {
  return p.startsWith("\\\\") || p.startsWith("//");
}

function fail(reason) {
  process.stdout.write(JSON.stringify({ error: reason }));
  process.exit(0);
}

const GIT_BASENAME = process.platform === "win32" ? /^git\.exe$/i : /^git$/;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The git that answers every authority question here — absolute, or nothing.
 *
 * THE BARE NAME WAS A COMPLETE BYPASS. This process inherits the agent's working directory, which is
 * the GOVERNED CHECKOUT, and on Windows an unqualified command resolves against the current directory
 * before PATH — trying the name as given, then `.com`, then `.exe`. So a `git.com` dropped in the root
 * of the repository the loop is already working in would have answered "is this project allowlisted",
 * "did its owner approve" and "is the adapter the committed one". Found by adversarial review; the
 * capability needed was one file write, uncommitted, unreviewed.
 *
 * PATH IS NOT SEARCHED. The untrusted side may reasonably look for an operator's git; the trusted side
 * takes the one it was given or refuses.
 */
/** Is `child` at or inside `parent`? Compared the way `samePath` compares, prefix-wise. */
function isInside(parent, child) {
  const norm = (p) => p.split(String.fromCharCode(92)).join("/").replace(/\/+$/, "").toLowerCase();
  const a = norm(parent);
  const b = norm(child);
  return b === a || b.startsWith(a + "/");
}

/**
 * The git this side will use, and where it may not come from.
 *
 * GIT IS THE ORACLE FOR EVERY OTHER CLAIM HERE — whether the allowlist is committed, whether the
 * owner's receipt is committed, what the origin says, what shape the checkout is, and which bytes the
 * credential adapter really is. A caller who chooses the binary chooses all of those answers. The
 * agent side already refuses a bound path inside the governed checkout and says why; this side, which
 * is the one that actually decides, did not — so `PROJECTOS_GIT_EXE=<governed>\tools\git.exe`, an
 * ordinary working-tree file, forged every authority question at once and then had its forged
 * "committed" adapter text executed by real PowerShell. Found by the second adversarial review.
 */
/**
 * The governed checkout this request is about, pinned once when the request is parsed.
 *
 * A MODULE-LEVEL PIN, NOT A PARAMETER PASSED DOWN. `git()` is asked about two different roots — the
 * installation's and the project's — so an exclusion derived from whichever root a given call happens
 * to name would leave the other one open. There is exactly one governed root per invocation of this
 * process, and this is it.
 */
let GOVERNED_ROOT = null;

function boundGit(governedRoot) {
  const bound = process.env.PROJECTOS_GIT_EXE;
  if (
    typeof bound === "string" &&
    bound &&
    path.isAbsolute(bound) &&
    !isUnc(bound) &&
    GIT_BASENAME.test(path.basename(bound)) &&
    isFile(bound) &&
    !isInside(TRUSTED_INSTALL_ROOT, bound) &&
    !(typeof governedRoot === "string" && governedRoot && isInside(governedRoot, bound))
  ) {
    return bound;
  }
  return null;
}

/**
 * Run git against a root, with nothing inherited that could change what it answers.
 *
 * `GIT_CONFIG_*`, `GIT_DIR`, `GIT_OBJECT_DIRECTORY` and their relatives redirect what `HEAD:./<rel>`
 * resolves to even when the binary is genuine, so the child gets a minimal environment rather than
 * this process's. `cwd` is the root being asked about, never whatever directory this process started
 * in.
 */
function git(root, args) {
  const exe = boundGit(GOVERNED_ROOT ?? root);
  if (exe === null) return { code: 127, stdout: "", stderr: "no trusted git executable is bound" };
  const env = {};
  for (const name of ["SystemRoot", "windir", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"]) {
    if (typeof process.env[name] === "string") env[name] = process.env[name];
  }
  const r = spawnSync(exe, ["-C", root, ...args], { encoding: "utf8", windowsHide: true, cwd: root, env });
  return { code: r.status === null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/**
 * A record read from the git object store, proven committed and unmodified first.
 *
 * `HEAD:./<rel>` — the pathspec resolves against `-C root`, and `<rev>:<path>` would otherwise
 * resolve against the top of the working tree, which is a different file in a nested checkout.
 */
function readCommitted(root, rel) {
  const logged = git(root, ["log", "-1", "--format=%H", "--", rel]);
  if (logged.code !== 0 || !logged.stdout.trim()) return null;
  const dirty = git(root, ["diff", "--name-only", "HEAD", "--", rel]);
  if (dirty.code !== 0 || dirty.stdout.trim()) return null;
  const shown = git(root, ["show", "HEAD:./" + rel]);
  if (shown.code !== 0 || !shown.stdout.trim()) return null;
  return shown.stdout;
}

function canonicalRepository(root) {
  const remote = git(root, ["remote", "get-url", "origin"]);
  if (remote.code !== 0) return null;
  const url = remote.stdout.trim();
  const ssh = /^[^@]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  const https = /^https?:\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  const m = ssh || https;
  if (!m) return null;
  return m[1].toLowerCase() + "/" + m[2] + "/" + m[3];
}

/**
 * The path the filesystem actually means, or `null` if it will not say.
 *
 * A JUNCTION OR SYMLINK IS NOT A SPELLING DIFFERENCE. `samePath` normalises separators and case, which
 * settles `C:\dev\ProjectOS` against `c:/dev/projectos/` and nothing harder. A directory junction at
 * the authorised path resolves somewhere else entirely while spelling identically, so a comparison of
 * strings agrees and a comparison of identities does not. The credential-bearing root is compared by
 * identity. `.native` because on Windows it returns the true cased path from the filesystem rather
 * than a reconstruction.
 */
function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Both paths resolved, then compared. `false` if either will not resolve — absent is not equal. */
function sameRealPath(a, b) {
  const ra = realPath(a);
  const rb = realPath(b);
  if (ra === null || rb === null) return false;
  return samePath(ra, rb);
}

function samePath(a, b) {
  const norm = (p) => p.split(String.fromCharCode(92)).join("/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * An ordinary full checkout, rooted exactly here — or a reason why not.
 *
 * Git discovery walks upward, so a directory inside a clone inherits that clone's identity; and a
 * `.git` FILE points at another repository's data, which would let a directory answer as a repository
 * it is not. Credential-bearing projects in either shape are refused.
 */
function checkoutShapeProblem(root) {
  const toplevel = git(root, ["rev-parse", "--show-toplevel"]);
  if (toplevel.code !== 0 || !toplevel.stdout.trim()) {
    return "the governed directory is not a git checkout";
  }
  if (!sameRealPath(toplevel.stdout.trim(), root)) {
    return "the governed directory is inside the repository at " + toplevel.stdout.trim() + ", not its root";
  }
  // AND `.git` MUST BE REAL. A junction there keeps every reported path spelled exactly right while
  // the history behind them belongs to another repository — both sides of a realpath comparison
  // resolve to the same target, so only asking what the entry ITSELF is catches it.
  const dotGit = path.join(root, ".git");
  try {
    if (fs.lstatSync(dotGit).isSymbolicLink()) {
      return "the governed checkout's .git is a link, so its history is not its own";
    }
  } catch {
    return "the governed checkout has no .git entry";
  }

  const gitDir = git(root, ["rev-parse", "--absolute-git-dir"]);
  if (gitDir.code !== 0 || !gitDir.stdout.trim()) return "the governed checkout has no readable git directory";
  const expected = root.split(String.fromCharCode(92)).join("/").replace(/\/+$/, "") + "/.git";
  // AND THE GIT DIRECTORY BY IDENTITY TOO. A junction at `.git` keeps both reported paths spelled
  // exactly right while the history behind them belongs to another repository entirely.
  if (!sameRealPath(gitDir.stdout.trim(), expected)) {
    return "the governed checkout keeps its git data elsewhere; that shape is not supported for credential use";
  }
  return null;
}

/**
 * The four lines that bind a question to the authority that pays for it.
 *
 * READ AS FIELDS, AT THEIR OWN POSITIONS. This used to be `body.includes("project: " + projectId)`
 * over the whole payload — and the payload is the caller's own bytes. Writing `project: projectos`
 * anywhere at all, inside user content, inside a JSON string, inside a quoted piece of evidence,
 * satisfied the test while the request asked something else entirely. That is not a binding; it is a
 * search. A line that IS the field, exactly once, with a value that is exactly the authorised one, is.
 */
const BINDING_KEYS = ["project", "phase", "subject", "ask"];
const BINDING_LINE = /^ {2}(project|phase|subject|ask):[ \t]*(\S+)[ \t]*$/;

function bindingLines(instructions) {
  const found = Object.create(null);
  const duplicated = [];
  for (const line of instructions.split("\n")) {
    const m = BINDING_LINE.exec(line);
    if (m === null) continue;
    // A SECOND STATEMENT OF THE SAME FIELD IS AMBIGUITY, and ambiguity about what was authorised is
    // refused rather than resolved — whichever one a reader picked would be a guess.
    if (found[m[1]] !== undefined) {
      if (duplicated.indexOf(m[1]) === -1) duplicated.push(m[1]);
      continue;
    }
    found[m[1]] = m[2];
  }
  return { found: found, duplicated: duplicated };
}

/**
 * Why this request may not be paid for, or `null`.
 *
 * Everything is compared with exact equality against what the CALLER SEPARATELY DECLARED and the
 * installation independently authorised. Nothing here is inferred from prose.
 */
function requestBindingProblem(body, expected) {
  for (const key of BINDING_KEYS.concat(["requestId"])) {
    if (!expected[key]) return "the transport broker was not told the " + key + " this call is bound to";
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "the request body is not a structured request and cannot be bound to an authority";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "the request body is not a structured request and cannot be bound to an authority";
  }
  if (typeof parsed.instructions !== "string") {
    return "the request carries no instruction block, so it states no project, phase, subject or ask";
  }
  const read = bindingLines(parsed.instructions);
  if (read.duplicated.length > 0) {
    return "the request states '" + read.duplicated[0] + "' more than once, so what it is bound to is ambiguous";
  }
  for (const key of BINDING_KEYS) {
    if (read.found[key] === undefined) {
      return "the request states no " + key + ", so it cannot be shown to be the authorised one";
    }
    if (read.found[key] !== expected[key]) {
      return "the request is for " + key + " '" + read.found[key] + "', not the authorised '" + expected[key] + "'";
    }
  }
  // THE REQUEST'S OWN IDENTITY, ALSO AT ITS OWN POSITION: the first line of the user text, which is
  // where the runtime writes it and the only place it counts.
  const input = parsed.input;
  const first = Array.isArray(input) ? input[0] : null;
  const content = first && typeof first === "object" && Array.isArray(first.content) ? first.content[0] : null;
  const text = content && typeof content === "object" ? content.text : null;
  if (typeof text !== "string") {
    return "the request carries no reviewable content, so its identity cannot be checked";
  }
  if (text.split("\n")[0] !== "requestId: " + expected.requestId) {
    return "the request does not open with the request id this call was authorised for";
  }
  return null;
}

/**
 * Every question ProjectOS itself knows how to ask.
 *
 * A CLOSED VOCABULARY, ON THE TRUSTED SIDE. The owner's receipt says a project may spend the
 * installation's credential; it does not say a caller may compose any question it likes and have it
 * paid for. These are the asks the runtime generates — the loop's stop codes and the reconciliation —
 * and anything else is a question ProjectOS did not ask.
 */
const KNOWN_ASKS = [
  "security-review",
  "correction-exhausted",
  "evidence-review",
  "worker-refusal",
  "effects-unattested",
  "ambiguity",
  "degraded-mode-reconciliation",
];

/**
 * How many calls one committed receipt may fund for one phase.
 *
 * THE DEFECT THIS BOUNDS. A secrets-handling receipt is committed once and is permanent, so it used
 * to authorise unlimited future spend: every gate this side applied was about WHETHER a project could
 * spend, never HOW MUCH. A phase that finished months ago still carried a receipt, and a receipt was
 * all a caller needed. The number is deliberately generous — a real phase has used single digits, and
 * the point is a ceiling that exists, not one that gets in the way of autonomy.
 */
const MAX_CALLS_PER_PHASE = 200;

/**
 * Where this installation counts what it has spent.
 *
 * PINNED, NOT READ FROM THE ENVIRONMENT. It used to be `LOCALAPPDATA || XDG_STATE_HOME || HOME`, all
 * three of which were forwarded from the caller — so one assignment pointed the count at an empty
 * directory, and an empty count reads as "nothing spent": no ceiling, no replay refusal, on every
 * call. That is the fail-open this whole file exists to avoid.
 *
 * The residual is stated plainly rather than papered over: the value is resolved by the installation's
 * own runtime and pinned into these bytes, exactly as `TRUSTED_INSTALL_ROOT` is, so it is as trustworthy
 * as the process that spawned this one — and no more. What it is no longer is a variable this process
 * reads for itself after being handed it.
 */
function installationStateDir() {
  const pinnedDir = typeof TRUSTED_STATE_DIR === "string" ? TRUSTED_STATE_DIR : "";
  if (!pinnedDir || !path.isAbsolute(pinnedDir)) return null;
  return pinnedDir;
}

function spendPath(stateDir) {
  return path.join(stateDir, "gatekeeper-spend.json");
}

/**
 * Reserve this call against the installation's own durable count, or say why it may not be made.
 *
 * RESERVED BEFORE THE CREDENTIAL, NOT RECORDED AFTER IT. A call that happened and was not counted is
 * a call that can be made again, so the row is written first and the credential is only reached if
 * that write landed. The same reasoning the degraded ledger uses, for the same reason.
 *
 * The lock is one create-if-absent file: two brokers may run at once, and a lost update here is a
 * lost spend. A busy ledger refuses; there is no waiting inside a governance decision.
 */
function reserveSpend(projectId, phaseId, requestId) {
  const stateDir = installationStateDir();
  if (stateDir === null) return "this installation cannot locate its own state, so it cannot govern what it spends";
  const file = spendPath(stateDir);
  const lock = file + ".lock";
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {
    return "the installation state directory could not be created, so this call cannot be counted";
  }
  try {
    fs.writeFileSync(lock, "{}", { flag: "wx" });
  } catch {
    return "another ProjectOS process is recording a gatekeeper call; nothing was spent";
  }
  try {
    let ledger = { schemaVersion: "1.0.0", calls: [] };
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (raw !== null) {
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return "the installation record of gatekeeper spending cannot be read, so nothing further is spent";
      }
      if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.calls)) {
        return "the installation record of gatekeeper spending is malformed, so nothing further is spent";
      }
      ledger = parsed;
    }
    // ASKED AND ANSWERED IS FINAL; ASKED AND UNANSWERED MAY BE ASKED ONCE MORE.
    //
    // `requestId` is deterministic by design — the same question re-derives the same id after a
    // restart — so a single-state row refused the honest retry: the provider timed out, no decision
    // existed, and the question could never be put again without hand-editing this file. Meanwhile it
    // stopped no adversary at all, because changing one byte of evidence changes the id. Two states
    // keep the replay refusal where it belongs and let a lost answer be re-sought exactly once. Both
    // attempts are counted, so nothing becomes un-metered.
    const existing = ledger.calls.find((c) => c && c.requestId === requestId);
    if (existing !== undefined) {
      if (existing.outcome === "answered") {
        return "request " + requestId + " has already been answered; the recorded answer stands";
      }
      if ((existing.reuses || 0) >= 1) {
        return (
          "request " + requestId + " was already re-attempted after an unanswered call; a third " +
          "attempt is an owner decision, not a retry"
        );
      }
      existing.reuses = (existing.reuses || 0) + 1;
      const tmpAgain = file + ".tmp";
      fs.writeFileSync(tmpAgain, JSON.stringify(ledger, null, 2) + "\n");
      fs.renameSync(tmpAgain, file);
      return null;
    }
    const forPhase = ledger.calls.filter(
      (c) => c && c.projectId === projectId && c.phaseId === phaseId,
    ).length;
    if (forPhase >= MAX_CALLS_PER_PHASE) {
      return (
        "phase " + phaseId + " has already spent " + forPhase + " gatekeeper calls, which is this " +
        "installation's ceiling; a committed receipt authorises a project, not unlimited spending"
      );
    }
    ledger.calls.push({
      projectId: projectId,
      phaseId: phaseId,
      requestId: requestId,
      outcome: "reserved",
      reuses: 0,
      at: new Date().toISOString(),
    });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n");
    fs.renameSync(tmp, file);
    const back = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!back.calls.some((c) => c && c.requestId === requestId)) {
      return "the gatekeeper call could not be recorded, so it is not made";
    }
    return null;
  } catch (e) {
    return "the installation record of gatekeeper spending could not be updated";
  } finally {
    try {
      fs.rmSync(lock, { force: true });
    } catch {
      /* the next call refuses and names the file */
    }
  }
}

/** Record that this question came back with something, so it may not be put again. */
function markAnswered(projectId, phaseId, requestId) {
  const stateDir = installationStateDir();
  if (stateDir === null) return;
  const file = spendPath(stateDir);
  const lock = file + ".lock";
  try {
    fs.writeFileSync(lock, "{}", { flag: "wx" });
  } catch {
    return;
  }
  try {
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (raw === null) return;
    const ledger = JSON.parse(raw);
    if (!ledger || !Array.isArray(ledger.calls)) return;
    const row = ledger.calls.find(
      (c) => c && c.requestId === requestId && c.projectId === projectId && c.phaseId === phaseId,
    );
    if (row === undefined) return;
    row.outcome = "answered";
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch {
    /* the row stays reserved, which allows exactly one honest retry */
  } finally {
    try {
      fs.rmSync(lock, { force: true });
    } catch {
      /* the next call refuses and names the file */
    }
  }
}

/** The installation's committed policy: is this project one it will spend on at all? */
function installationAllows(installRoot, governedRoot, projectId) {
  const raw = readCommitted(installRoot, ALLOWLIST_REL);
  if (raw === null) return "this ProjectOS installation commits no usable credential allowlist";
  let policy;
  try {
    policy = JSON.parse(raw);
  } catch {
    return "the installation credential allowlist is not readable JSON";
  }
  if (policy.schemaVersion !== "1.0.0" || !Array.isArray(policy.projects)) {
    return "the installation credential allowlist is not a policy this broker recognises";
  }
  const repository = canonicalRepository(governedRoot);
  if (repository === null) {
    return "the governed checkout has no readable origin, so its identity cannot be established";
  }
  for (const entry of policy.projects) {
    const id = typeof entry.projectId === "string" ? entry.projectId : "";
    const repo = typeof entry.repository === "string" ? entry.repository : "";
    const authorisedRoot = typeof entry.governedRoot === "string" ? entry.governedRoot : "";
    if (id.includes("*") || repo.includes("*") || authorisedRoot.includes("*")) {
      return "the installation credential allowlist contains a wildcard entry, which it may never do";
    }
    if (id !== projectId || repo.toLowerCase() !== repository.toLowerCase()) continue;
    // IDENTITY, NOT SPELLING — IN BOTH DIRECTIONS. A different spelling of the authorised directory is
    // the same directory and is accepted; a path that spells like it but resolves elsewhere is not.
    if (!authorisedRoot || !sameRealPath(authorisedRoot, governedRoot)) {
      return (
        "project '" + projectId + "' is authorised at " + (authorisedRoot || "no path") +
        ", and this checkout is at " + governedRoot
      );
    }
    const shape = checkoutShapeProblem(governedRoot);
    if (shape !== null) return shape;
    return null;
  }
  return "this installation does not authorise project '" + projectId + "' at " + repository;
}

/** The governed project's own committed owner decision for this phase. */
function ownerApproved(governedRoot, phaseId) {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(phaseId)) return "the phase id could not safely name a receipt";
  const rel = ".projectops/gates/" + phaseId + ".secrets-handling.json";
  const raw = readCommitted(governedRoot, rel);
  if (raw === null) return "no committed secrets-handling receipt approves credential use for this phase";
  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch {
    return "the committed secrets-handling receipt is not readable JSON";
  }
  if (receipt.ownerChoice !== "APPROVE") return "the committed secrets-handling receipt does not approve";
  if (receipt.gateName !== "secrets-handling") return "the committed receipt answers a different gate";
  if (receipt.phaseId !== phaseId) return "the committed receipt is for a different phase";
  return null;
}

/** PowerShell, absolute or not at all. PATH is never consulted: shadowing it is the attack. */
function boundPowerShell() {
  const bound = process.env.PROJECTOS_POWERSHELL_EXE;
  if (
    typeof bound === "string" &&
    bound &&
    path.isAbsolute(bound) &&
    !isUnc(bound) &&
    POWERSHELL_BASENAME.test(path.basename(bound)) &&
    isFile(bound) &&
    // THE SAME EXCLUSIONS `boundGit` HAS. This is the process that handles the secret, and it was the
    // laxer of the two: a `powershell.exe` committed into the governed checkout would have been run by
    // the trusted side and handed the credential adapter.
    !isInside(TRUSTED_INSTALL_ROOT, bound) &&
    !(typeof GOVERNED_ROOT === "string" && GOVERNED_ROOT && isInside(GOVERNED_ROOT, bound))
  ) {
    return bound;
  }
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (typeof systemRoot !== "string" || !systemRoot || !path.isAbsolute(systemRoot) || isUnc(systemRoot)) {
    return null;
  }
  const canonical = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return isFile(canonical) ? canonical : null;
}

/**
 * The adapter is not read from disk at all: the committed text IS what runs.
 *
 * VERIFY-THEN-EXECUTE-A-PATH WAS THE SAME RACE, ONE LAYER DOWN. This used to compare the working-tree
 * `.ps1` against the committed object and then hand PowerShell the PATH — so the bytes verified and
 * the bytes executed were two different opens of a file an attacker can swap between them, or
 * redirect with a directory junction and no race at all. The script's own job is to print the
 * credential, so winning that race yields the key.
 *
 * The committed text now goes to PowerShell on STDIN, wrapped in a script block so the file's
 * `param()` binding still applies. Nothing on disk is consulted, which also disposes of the
 * line-ending normalisation and the encoding mismatch between how Node read the file and how
 * PowerShell would have parsed it.
 */
function committedAdapter(installRoot) {
  return readCommitted(installRoot, ADAPTER_REL);
}

/**
 * Resolve the credential and hand it to `use`, which must not let it escape.
 *
 * The value lives in one local binding inside this function and is never returned, logged, or placed
 * in an error. The environment handed to the adapter drops credential-shaped names and the names that
 * decide which code a shell loads.
 */
function withCredential(installRoot, ref, use) {
  if (!REF_SHAPE.test(ref)) return { error: "the credential reference is not a valid reference name" };
  const vaultRef = VAULT_REFERENCE[ref];
  if (vaultRef === undefined) return { error: "credential '" + ref + "' is not one this broker holds" };

  const adapter = committedAdapter(installRoot);
  if (adapter === null) {
    return { error: "the credential adapter is not committed in this installation, so it is not run" };
  }
  const shell = boundPowerShell();
  if (shell === null) return { error: "no trusted PowerShell executable is bound" };

  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i.test(k)) continue;
    if (/^(PSModulePath|PATHEXT|COMSPEC)$/i.test(k)) continue;
    env[k] = v;
  }

  // `-EncodedCommand` carries the script, not a file, so there is still nothing on disk to swap and
  // `-ExecutionPolicy Bypass` is still unnecessary — an execution policy governs files, not this.
  //
  // WHY NOT `-Command -` (stdin). That was the original choice and it silently broke on Windows
  // PowerShell 5.1's console host: fed via stdin, `-Command -` parses and executes MULTI-LINE input
  // line-by-line rather than as one script, so any brace block spanning more than one line — an
  // `if`, a `function`, or this adapter's `& { <multi-line adapter> } -Action get -Target ...` —
  // silently produced no output and exit code 0. The credential adapter is inherently multi-line, so
  // EVERY call through this path failed exactly the same way, indistinguishable from an absent value.
  // `-EncodedCommand` (UTF-16LE, base64) is parsed as a single complete script regardless of line
  // breaks, which is the standard fix for this known 5.1 behaviour, and it keeps the same guarantee
  // stdin gave: the bytes verified above are the exact bytes executed, with no file and no race.
  const script = ["& {", adapter, "} -Action get -Target " + JSON.stringify(vaultRef), ""].join(String.fromCharCode(10));
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const r = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    encoding: "utf8",
    env,
    cwd: installRoot,
    windowsHide: true,
  });
  if (r.status !== 0) return { error: "the Windows Credential Manager could not be reached" };
  const value = (r.stdout || "").replace(/\r?\n$/, "");
  if (!value) return { error: "no value is stored under this credential reference" };
  // A value that cannot be a header value would otherwise be quoted back by fetch's own error.
  if (/[\r\n\0]/.test(value) || /[^\x20-\x7e]/.test(value)) {
    return { error: "the stored credential is not usable as an HTTP header value" };
  }
  return use(value);
}

/**
 * The request arrives as a file, named by the caller in the environment.
 *
 * The SOURCE of this program came in as bytes on stdin and is what was verified; the request is the
 * caller's own untrusted input, so where it travels changes nothing about who is trusted. It is read
 * once and the caller removes it.
 */
async function main() {
  let req;
  try {
    const where = String(process.env.PROJECTOS_BROKER_REQUEST || "");
    if (!where || !path.isAbsolute(where)) {
      fail("the transport broker was not told where its request is");
      return;
    }
    const bytes = fs.readFileSync(where);
    // THE REQUEST THAT RUNS IS THE REQUEST THAT WAS WRITTEN. It travels as a file so the program can
    // travel as bytes; without this, a second process running as the same user could rewrite it
    // between the write and this read, keep every label the binding checks, and swap the question.
    const seen = crypto.createHash("sha256").update(bytes).digest("hex");
    const wanted = typeof TRUSTED_REQUEST_SHA256 === "string" ? TRUSTED_REQUEST_SHA256 : "";
    if (!wanted || seen !== wanted) {
      fail("the request is not the one this call was prepared for");
      return;
    }
    req = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("the transport broker received an unreadable request");
    return;
  }

  // PINNED BY THE VERIFIER, NEVER SENT. `TRUSTED_INSTALL_ROOT` is prepended to these bytes after they
  // are proven to be the installation's committed source; without it there is no installation to be
  // trusted and nothing here may run.
  const installRoot = typeof TRUSTED_INSTALL_ROOT === "string" ? TRUSTED_INSTALL_ROOT : "";
  if (!installRoot || !path.isAbsolute(installRoot)) {
    fail("the transport broker was not pinned to a trusted installation");
    return;
  }
  const governedRoot = String(req.governedRoot || "");
  // PINNED BEFORE ANY GIT RUNS. Every authority question below is answered by git, so the exclusion
  // that keeps the binary out of the governed checkout has to be in place before the first one.
  GOVERNED_ROOT = governedRoot;
  const projectId = String(req.projectId || "");
  const phaseId = String(req.phaseId || "");
  if (!governedRoot || !projectId || !phaseId) {
    fail("the transport broker was not told which project and phase this call is for");
    return;
  }

  // THE BODY MUST BE ABOUT WHAT WAS AUTHORISED, AND "ABOUT" IS A FIELD, NOT A SUBSTRING.
  //
  // CHECKED BEFORE THE TWO FACTORS, because it needs no git and no policy: a request that cannot
  // be shown to be the one it claims to be is refused before this process does any work on its
  // behalf, let alone reaches a credential.
  const body = String(req.body || "");
  const misbound = requestBindingProblem(body, {
    project: projectId,
    phase: phaseId,
    subject: String(req.subjectCommit || ""),
    ask: String(req.ask || ""),
    requestId: String(req.requestId || ""),
  });
  if (misbound !== null) {
    fail(misbound);
    return;
  }

  // BOTH FACTORS, HERE, ON THE TRUSTED SIDE. The agent may have checked them too; that is defence in
  // depth, not the control. This is the control.
  const notAllowed = installationAllows(installRoot, governedRoot, projectId);
  if (notAllowed !== null) {
    fail(notAllowed);
    return;
  }
  const notApproved = ownerApproved(governedRoot, phaseId);
  if (notApproved !== null) {
    fail(notApproved);
    return;
  }

  // A QUESTION PROJECTOS ITSELF KNOWS HOW TO ASK.
  const askedFor = String(req.ask || "");
  if (KNOWN_ASKS.indexOf(askedFor) === -1) {
    fail("'" + askedFor + "' is not a question ProjectOS asks, so it is not one this installation pays for");
    return;
  }

  // AND ABOUT BYTES THAT REALLY EXIST. A subject the governed repository does not contain is not a
  // review of anything; it is a question composed to look like one.
  const subject = String(req.subjectCommit || "");
  if (!/^[0-9a-f]{40}$/.test(subject)) {
    fail("the subject this call names is not a commit id");
    return;
  }
  const known = git(governedRoot, ["cat-file", "-e", subject + "^{commit}"]);
  if (known.code !== 0) {
    fail("the governed repository contains no commit " + subject + ", so there is nothing to review");
    return;
  }

  // AND WITHIN WHAT THIS INSTALLATION IS WILLING TO SPEND, counted where the project cannot reach it.
  const overspend = reserveSpend(projectId, phaseId, String(req.requestId || ""));
  if (overspend !== null) {
    fail(overspend);
    return;
  }

  const outcome = withCredential(installRoot, String(req.credentialRef || ""), (secret) => ({
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
  }));
  if (outcome && outcome.error) {
    fail(outcome.error);
    return;
  }

  const controller = new AbortController();
  const MAX_TIMEOUT_MS = 300000;
  const asked = typeof req.timeoutMs === "number" && req.timeoutMs > 0 ? req.timeoutMs : 120000;
  const timeoutMs = Math.min(asked, MAX_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: outcome.headers,
      body,
      signal: controller.signal,
    });
    // NAMED APART FROM THE REQUEST BODY. `const body = await res.text()` sat in the same block as the
    // `body` handed to fetch, so that reference resolved to the response binding while it was still in
    // its temporal dead zone: every call threw a ReferenceError, the catch below swallowed it, and the
    // caller saw "the gatekeeper transport failed". The trusted path had never carried a live call.
    // Found by the second adversarial review, 2026-08-21.
    const responseText = await res.text();
    // THE QUESTION IS NOW ANSWERED, so it may never be put again. Recorded before the answer is handed
    // back: a reply that reached the caller and was not marked would be a question re-askable forever.
    markAnswered(projectId, phaseId, String(req.requestId || ""));
    process.stdout.write(JSON.stringify({ status: res.status, body: responseText }));
  } catch (e) {
    // A FIXED SHAPE, NEVER THE EXCEPTION'S OWN TEXT. Node quotes an invalid header VALUE in its
    // message, so repeating that message is a way for the credential to leave this process.
    process.stdout.write(
      JSON.stringify({ error: e && e.name === "AbortError" ? "the request timed out" : "the gatekeeper transport failed" })
    );
  } finally {
    clearTimeout(timer);
  }
}

void main();
