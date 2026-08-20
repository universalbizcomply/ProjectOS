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
function boundGit() {
  const bound = process.env.PROJECTOS_GIT_EXE;
  if (
    typeof bound === "string" &&
    bound &&
    path.isAbsolute(bound) &&
    !isUnc(bound) &&
    GIT_BASENAME.test(path.basename(bound)) &&
    isFile(bound)
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
  const exe = boundGit();
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
    if (id.includes("*") || repo.includes("*")) {
      return "the installation credential allowlist contains a wildcard entry, which it may never do";
    }
    if (id === projectId && repo.toLowerCase() === repository.toLowerCase()) return null;
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
    POWERSHELL_BASENAME.test(path.basename(bound))
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

  // `-Command -` reads the script from stdin. There is no file, so there is nothing to swap, and
  // `-ExecutionPolicy Bypass` is no longer needed — an execution policy governs files.
  const r = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    input: ["& {", adapter, "} -Action get -Target " + JSON.stringify(vaultRef), ""].join(String.fromCharCode(10)),
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

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  raw += c;
});
process.stdin.on("end", async () => {
  let req;
  try {
    req = JSON.parse(raw);
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
  const projectId = String(req.projectId || "");
  const phaseId = String(req.phaseId || "");
  if (!governedRoot || !projectId || !phaseId) {
    fail("the transport broker was not told which project and phase this call is for");
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

  // THE BODY MUST BE ABOUT WHAT WAS AUTHORISED.
  //
  // Checking the caller's claimed project and phase authorises the SPEND; without this the request
  // itself could describe a different phase entirely, and the reviewer would answer a question nobody
  // approved paying for. The system instruction prints these three lines verbatim, so requiring them
  // binds the question to the authority without this file having to understand the prompt.
  const body = String(req.body || "");
  if (!body.includes("project: " + projectId) || !body.includes("phase:   " + phaseId)) {
    fail("the request body is not about the project and phase this call was authorised for");
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
    const body = await res.text();
    process.stdout.write(JSON.stringify({ status: res.status, body }));
  } catch (e) {
    // A FIXED SHAPE, NEVER THE EXCEPTION'S OWN TEXT. Node quotes an invalid header VALUE in its
    // message, so repeating that message is a way for the credential to leave this process.
    process.stdout.write(
      JSON.stringify({ error: e && e.name === "AbortError" ? "the request timed out" : "the gatekeeper transport failed" })
    );
  } finally {
    clearTimeout(timer);
  }
});
