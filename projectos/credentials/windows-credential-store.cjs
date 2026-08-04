"use strict";
/**
 * Windows Credential Manager store adapter — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L2).
 *
 * Node-side wrapper around `windows-credential-store.ps1`. It implements the small store contract the
 * vault depends on:
 *
 *     set(reference, value) -> true          get(reference)    -> string | null
 *     del(reference)        -> boolean       exists(reference) -> boolean
 *     list(prefix)          -> string[]      (target NAMES only)
 *
 * Secret-handling rules enforced here:
 *  - The value is passed to the child process ONLY through the `PROJECTOS_CREDENTIAL_VALUE` environment
 *    variable. It is never an argv element, never written to a file, and never logged.
 *  - The child receives a MINIMAL environment (the few variables PowerShell needs plus the value). The
 *    parent's own environment — which may carry another project's session credentials — is not forwarded.
 *  - `get` returns the value to the caller and nothing else; this module never logs a returned value.
 *  - Every reference is re-validated here AND again inside the PowerShell script (defence in depth), so a
 *    malformed reference cannot reach the Win32 credential API.
 *
 * Availability: this adapter is Windows-only. `isAvailable()` reports whether it can be used; callers
 * must fail closed rather than silently substituting a weaker store.
 */

const path = require("path");
const childProcess = require("child_process");
const { parseReference, ROOT } = require("./reference.cjs");

const SCRIPT = path.join(__dirname, "windows-credential-store.ps1");
const DEFAULT_POWERSHELL = "powershell.exe";
const EXIT_OK = 0;
const EXIT_NOT_FOUND = 3;
const MAX_BUFFER = 1024 * 1024;
// Only a literal reference prefix may be used to enumerate; '*' and other wildcards are refused so a
// caller cannot broaden a listing beyond the namespace it asked for.
const PREFIX_RE = new RegExp("^" + ROOT + "(/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,4}$");

/** The minimal environment a PowerShell child needs. Nothing project- or provider-specific is forwarded. */
function baseChildEnv() {
  const env = Object.create(null);
  for (const key of ["SystemRoot", "windir", "PATHEXT", "TEMP", "TMP", "PSModulePath", "COMSPEC"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  // PowerShell resolves its own location from PATH; keep it, but nothing else.
  if (typeof process.env.Path === "string") env.Path = process.env.Path;
  else if (typeof process.env.PATH === "string") env.PATH = process.env.PATH;
  return env;
}

function assertReference(reference) {
  const parsed = parseReference(reference);
  if (!parsed.ok) throw new Error("windows-credential-store: " + parsed.reason);
  return parsed.ref;
}

function createWindowsCredentialStore(opts) {
  const options = opts || {};
  const powershell = typeof options.powershellPath === "string" && options.powershellPath ? options.powershellPath : DEFAULT_POWERSHELL;
  const scriptPath = typeof options.scriptPath === "string" && options.scriptPath ? options.scriptPath : SCRIPT;
  // Injectable purely so the validator can exercise argument/environment construction without touching
  // the machine's real credential store. Production callers never pass this.
  const spawnSync = typeof options.spawnSync === "function" ? options.spawnSync : childProcess.spawnSync;

  function invoke(args, secretValue) {
    const env = baseChildEnv();
    if (typeof secretValue === "string") env.PROJECTOS_CREDENTIAL_VALUE = secretValue;
    const result = spawnSync(
      powershell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      { env, encoding: "utf8", windowsHide: true, maxBuffer: MAX_BUFFER }
    );
    if (result.error) throw new Error("windows-credential-store: could not run the credential store helper");
    return { status: result.status, stdout: typeof result.stdout === "string" ? result.stdout : "", stderr: typeof result.stderr === "string" ? result.stderr : "" };
  }

  /** Never include stderr verbatim in a thrown message — it is produced by a child that saw the value. */
  function fail(action, status) {
    return new Error("windows-credential-store: " + action + " failed (status " + String(status) + ")");
  }

  function set(reference, value) {
    assertReference(reference);
    if (typeof value !== "string" || !value) throw new Error("windows-credential-store: value required");
    const r = invoke(["-Action", "set", "-Target", reference], value);
    if (r.status !== EXIT_OK) throw fail("set", r.status);
    return true;
  }

  function get(reference) {
    assertReference(reference);
    const r = invoke(["-Action", "get", "-Target", reference]);
    if (r.status === EXIT_NOT_FOUND) return null;
    if (r.status !== EXIT_OK) throw fail("get", r.status);
    return r.stdout;
  }

  function exists(reference) {
    assertReference(reference);
    const r = invoke(["-Action", "exists", "-Target", reference]);
    if (r.status === EXIT_NOT_FOUND) return false;
    if (r.status !== EXIT_OK) throw fail("exists", r.status);
    return true;
  }

  function del(reference) {
    assertReference(reference);
    const r = invoke(["-Action", "delete", "-Target", reference]);
    if (r.status === EXIT_NOT_FOUND) return false;
    if (r.status !== EXIT_OK) throw fail("delete", r.status);
    return true;
  }

  function list(prefix) {
    const p = typeof prefix === "string" && prefix ? prefix : ROOT;
    if (!PREFIX_RE.test(p)) throw new Error("windows-credential-store: invalid listing prefix");
    const r = invoke(["-Action", "list", "-Prefix", p]);
    if (r.status !== EXIT_OK) throw fail("list", r.status);
    return r.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && parseReference(line).ok);
  }

  return { name: "windows-credential-manager", set, get, exists, del, list };
}

/** Windows-only. Callers must fail closed elsewhere rather than substituting a weaker store. */
function isAvailable() {
  return process.platform === "win32";
}

module.exports = { createWindowsCredentialStore, isAvailable, SCRIPT_PATH: SCRIPT };
