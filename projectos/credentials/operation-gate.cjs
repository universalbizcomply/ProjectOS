"use strict";
/**
 * Operation gate — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L4).
 *
 * The only path by which a high-risk credential — a database password, a service-role key, a production
 * deploy token, a real-send credential, a payment credential — is ever used. It never enters a session.
 *
 * The chain, in order, every link fail-closed:
 *   1. PROVIDER INTENT. The action is classified by the EXISTING provider context guards. A prohibited
 *      action is refused here and never reaches a credential; a production-targeting action on a frozen
 *      project is refused; anything else is owner-gated, which enqueues an approval item.
 *   2. OWNER PERMIT. A permit must name this project, this environment, this reference and this action,
 *      must carry an explicit owner confirmation, and must not have expired. ProjectOS cannot mint one for
 *      itself: `grantPermit` requires the owner-confirmation capability that only the owner-facing flow sets.
 *   3. ARGUMENT HYGIENE. The command line is refused if it carries a token-shaped argument, so the secret
 *      cannot reach a process listing. The value travels in the CHILD's environment under one named
 *      variable, and the child gets a minimal environment — nothing of this process's own is forwarded.
 *   4. SINGLE COMMAND. Exactly one command is run, synchronously, inside `vault.useValue`. The value is
 *      materialised only inside that closure.
 *   5. NO RETURN PATH. The result carries an exit code and REDACTED output. The value is never returned,
 *      logged, or written to disk, and both output streams are scrubbed through the shared redactor before
 *      they are handed back.
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const crypto = require("crypto");
const { evaluateProviderIntent, REFUSED } = require("../guards/provider-context-guards.cjs");
const { parseReference } = require("./reference.cjs");
const vercel = require("../providers/vercel.provider.cjs");

const DEFAULT_PERMIT_TTL_MS = 10 * 60 * 1000;
const MAX_OUTPUT = 256 * 1024;
/** Argument shapes that would place a credential in a process listing. */
const SECRET_ARGUMENT_RE = /^(--token|--password|--pass|--secret|--key|--api-key)(=|$)/i;
/**
 * Environment variable names the credential may NOT be delivered under. Writing a secret into PATH (or
 * COMSPEC, or SystemRoot) would both break the child and route the value into "command not found"
 * diagnostics, where exact-string redaction is least likely to catch it.
 */
const RESERVED_ENV_NAMES = new Set(["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "PROJECTOS_CREDENTIAL_VALUE"]);

/**
 * Resolve a command to a real executable BEFORE a single-use grant is spent. Without this, a typo or a
 * `.cmd` shim (which Windows `CreateProcess` cannot launch directly) consumes the owner's one-time permit
 * and returns nothing but a null exit code.
 */
function resolveExecutable(command, cwd) {
  if (typeof command !== "string" || !command) return null;
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  // A relative, separator-bearing command must resolve against the directory the command will actually
  // RUN in — not this process's cwd. Resolving against `process.cwd()` would look for the binary in the
  // router's own directory while `spawnSync` runs it elsewhere, which is how a credential ends up handed
  // to a same-named binary in the wrong tree.
  const base = typeof cwd === "string" && cwd ? cwd : process.cwd();
  const candidates = path.isAbsolute(command) || command.includes(path.sep) || command.includes("/")
    ? [path.resolve(base, command)]
    : (process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, command));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    if (process.platform === "win32") {
      for (const ext of exts) {
        const withExt = candidate + ext;
        if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;
      }
    }
  }
  return null;
}

/** Coarse size buckets so a withheld-output report cannot leak the credential's length. */
function sizeBucket(length) {
  if (length === 0) return "none";
  if (length < 1024) return "under-1KB";
  if (length < 64 * 1024) return "under-64KB";
  return "over-64KB";
}

function minimalChildEnv(extra) {
  const env = Object.create(null);
  for (const key of ["SystemRoot", "windir", "PATHEXT", "TEMP", "TMP", "COMSPEC", "HOME", "USERPROFILE"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  if (typeof process.env.Path === "string") env.Path = process.env.Path;
  else if (typeof process.env.PATH === "string") env.PATH = process.env.PATH;
  return Object.assign(env, extra || {});
}

function createOperationGate(opts) {
  const options = opts || {};
  const vault = options.vault;
  if (!vault || typeof vault.authoriseOperationRelease !== "function") throw new Error("operation-gate: a credential vault is required");
  const approvalQueue = options.approvalQueue || null;
  const spawnSync = typeof options.spawnSync === "function" ? options.spawnSync : childProcess.spawnSync;
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : () => Date.now();
  const audit = [];

  function log(event) {
    audit.push({
      action: event.action,
      reference: event.reference || null,
      projectId: event.projectId || null,
      environment: event.environment || null,
      providerAction: event.providerAction || null,
      permitId: event.permitId || null,
      ok: !!event.ok,
      reason: event.reason || null,
      exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,
    });
  }

  /**
   * Classify the intent and, when it is permissible at all, enqueue an owner approval item. Returns the
   * guard decision; a REFUSED decision means no permit can ever be granted for this action.
   */
  function requestPermit(input) {
    const req = input || {};
    const parsed = parseReference(req.reference);
    if (!parsed.ok) throw new Error("operation-gate: " + parsed.reason);
    const ref = parsed.ref;
    const decision = evaluateProviderIntent(
      { provider: ref.provider, action: req.action, projectId: ref.project, environment: ref.environment, productionFrozen: req.productionFrozen },
      { approvalQueue }
    );
    log({ action: "request-permit", reference: ref.reference, projectId: ref.project, environment: ref.environment, providerAction: req.action, ok: decision.decision !== REFUSED, reason: decision.reason });
    return { ...decision, reference: ref.reference };
  }

  /**
   * Mint a permit. Requires the owner-confirmation capability — this function is the trust boundary, and
   * automation must never plumb `ownerConfirmation` through from its own input.
   */
  function grantPermit(input) {
    const req = input || {};
    const capability = req.capability || {};
    const parsed = parseReference(req.reference);
    if (!parsed.ok) throw new Error("operation-gate: " + parsed.reason);
    const ref = parsed.ref;
    if (capability.ownerConfirmation !== true) {
      log({ action: "grant-permit", reference: ref.reference, projectId: ref.project, environment: ref.environment, ok: false, reason: "owner-confirmation-required" });
      throw new Error("OWNER PERMIT REQUIRED");
    }
    const ttl = Number.isFinite(req.ttlMs) && req.ttlMs > 0 ? req.ttlMs : DEFAULT_PERMIT_TTL_MS;
    const permit = Object.freeze({
      permitId: "permit_" + crypto.randomBytes(9).toString("hex"),
      projectId: ref.project,
      environment: ref.environment,
      reference: ref.reference,
      action: req.action,
      phaseId: typeof req.phaseId === "string" ? req.phaseId : null,
      ownerConfirmation: true,
      expiresAtMs: nowMs() + ttl,
    });
    log({ action: "grant-permit", reference: ref.reference, projectId: ref.project, environment: ref.environment, providerAction: req.action, permitId: permit.permitId, ok: true });
    return permit;
  }

  function refuse(reason, event) {
    log({ ...event, ok: false, reason });
    return { ok: false, blocker: reason, exitCode: null, stdout: "", stderr: "" };
  }

  /**
   * Run exactly one command with the credential in its environment.
   * @param input { reference, permit, capability, command, args, envVarName, cwd, productionFrozen }
   * @returns { ok, blocker, exitCode, stdout, stderr } — output redacted, value never present
   */
  function run(input) {
    const req = input || {};
    const parsed = parseReference(req.reference);
    if (!parsed.ok) throw new Error("operation-gate: " + parsed.reason);
    const ref = parsed.ref;
    const base = { action: "run", reference: ref.reference, projectId: ref.project, environment: ref.environment, providerAction: req.action, permitId: req.permit ? req.permit.permitId : null };

    // 1. Provider intent — a prohibited action never reaches a credential.
    const intent = evaluateProviderIntent(
      { provider: ref.provider, action: req.action, projectId: ref.project, environment: ref.environment, productionFrozen: req.productionFrozen },
      {}
    );
    if (intent.decision === REFUSED) return refuse("PRODUCTION PROFILE REFUSED", { ...base, reason: intent.reason });

    // 2. Permit binding — project, environment, reference and action must all match this exact request.
    const permit = req.permit || null;
    if (!permit || permit.ownerConfirmation !== true || permit.reference !== ref.reference || permit.projectId !== ref.project || permit.environment !== ref.environment || permit.action !== req.action) {
      return refuse("OWNER PERMIT REQUIRED", base);
    }
    if (permit.expiresAtMs <= nowMs()) return refuse("OWNER PERMIT REQUIRED", base);

    // 2b. Provider-specific gates. A production Vercel deploy needs its own named permit, and no provider
    // may be handed a token as a command argument.
    if (ref.provider === "vercel") {
      const argumentsClean = vercel.assertCommandArgumentsClean(req.args);
      if (argumentsClean.allowed !== true) return refuse("CREDENTIAL MISSING", { ...base, reason: "token-shaped-argument" });
      // Scoped to DEPLOY actions only. Reading a production configuration is still gated by the permit
      // chain above; it should not be refused with a deploy-specific blocker it has nothing to do with.
      if (typeof req.action === "string" && /deploy/i.test(req.action)) {
        const deploy = vercel.evaluateDeploy({ projectId: ref.project, vercel: {} }, ref.environment, permit && permit.action === "vercel-production-deploy" ? permit : null);
        if (deploy.allowed !== true) return refuse(deploy.blocker, { ...base, reason: deploy.reason });
      }
    }

    // 3. Argument hygiene — the value must not be expressible on the command line.
    const args = Array.isArray(req.args) ? req.args : [];
    if (typeof req.command !== "string" || !req.command) return refuse("OWNER PERMIT REQUIRED", base);
    if (args.some((a) => typeof a !== "string" || SECRET_ARGUMENT_RE.test(a))) {
      return refuse("CREDENTIAL MISSING", { ...base, reason: "secret-shaped-argument" });
    }
    const envVarName = typeof req.envVarName === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(req.envVarName) ? req.envVarName : null;
    if (!envVarName || RESERVED_ENV_NAMES.has(envVarName.toUpperCase())) {
      return refuse("OWNER PERMIT REQUIRED", { ...base, reason: "env-var-name-required-and-not-reserved" });
    }

    // 3b. Resolve the executable BEFORE the grant is minted. A single-use owner permit must not be spent
    // on a command that was never going to start.
    const executable = resolveExecutable(req.command, typeof req.cwd === "string" && req.cwd ? req.cwd : null);
    if (!executable) return refuse("COMMAND NOT EXECUTABLE", { ...base, reason: "command-not-resolvable" });

    // 4/5. One command, value only inside the closure. Output is WITHHELD by default: exact-string
    // redaction cannot survive a child that re-encodes or line-wraps the value, and this is the highest
    // risk credential class there is. `includeOutput` is an explicit, informed opt-in.
    const grant = vault.authoriseOperationRelease({ reference: ref.reference, projectId: ref.project, permit, capability: req.capability || {} });
    const result = vault.useValue(grant, (value) =>
      spawnSync(executable, args, {
        cwd: typeof req.cwd === "string" && req.cwd ? req.cwd : undefined,
        env: minimalChildEnv({ [envVarName]: value }),
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: MAX_OUTPUT,
      })
    );

    if (result && result.error) {
      // Distinct from a non-zero exit: the process never ran. Report it as such rather than as "failed".
      log({ ...base, ok: false, exitCode: null, reason: "spawn-failed" });
      return { ok: false, blocker: "COMMAND NOT EXECUTABLE", exitCode: null, stdout: "", stderr: "", outputWithheld: true };
    }

    const exitCode = result && Number.isInteger(result.status) ? result.status : null;
    const includeOutput = req.includeOutput === true;
    const out = includeOutput
      ? { stdout: vault.redactText(String((result && result.stdout) || "")), stderr: vault.redactText(String((result && result.stderr) || "")), outputWithheld: false }
      // Coarse buckets, not exact lengths: for a command whose whole output IS the credential, an exact
      // byte count would be a length side-channel on the secret.
      : { stdout: "", stderr: "", outputWithheld: true, stdoutSize: sizeBucket(String((result && result.stdout) || "").length), stderrSize: sizeBucket(String((result && result.stderr) || "").length) };
    log({ ...base, ok: exitCode === 0, exitCode, reason: exitCode === 0 ? null : "non-zero-exit" });
    return { ok: exitCode === 0, blocker: null, exitCode, ...out };
  }

  function getAuditLog() {
    return audit.map((e) => ({ ...e }));
  }

  return { requestPermit, grantPermit, run, getAuditLog };
}

module.exports = { createOperationGate, resolveExecutable, DEFAULT_PERMIT_TTL_MS, SECRET_ARGUMENT_RE, RESERVED_ENV_NAMES };
