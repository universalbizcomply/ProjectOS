"use strict";
/**
 * Owner CLI — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A.
 *
 *   projectos credentials set|delete|status|doctor
 *   projectos session     start|status|stop
 *   projectos providers   verify
 *   projectos operation   run
 *
 * Hidden input rules, enforced here and not merely documented:
 *  - A credential value can ONLY be typed at an interactive prompt with echo disabled. There is no
 *    `--value` flag; passing one is a hard error naming the reason, so a value cannot land in a shell
 *    history file, a process listing, a script, or this repository.
 *  - stdin must be a TTY. A piped or redirected value is refused rather than silently accepted, because a
 *    piped value came from somewhere that already recorded it.
 *  - Nothing this CLI prints contains a credential. `status` and `doctor` show references, presence,
 *    risk class and a short non-reversible fingerprint; that is the entire value-derived surface.
 *
 * Live provider access is out of scope for this phase: `providers verify` prints the read-only plan each
 * adapter WOULD run and evaluates any observation supplied from a file. It contacts nothing.
 */

const fs = require("fs");
const path = require("path");

const { createCredentialVault } = require("../credentials/vault.cjs");
const { createWindowsCredentialStore, isAvailable } = require("../credentials/windows-credential-store.cjs");
const { createOperationGate } = require("../credentials/operation-gate.cjs");
const { parseReference, OPERATION_CREDENTIALS } = require("../credentials/reference.cjs");
const { createSessionRouter, loadConnection } = require("../session-router/router.cjs");
const { createRegistry } = require("../providers/registry.cjs");
const { PROFILE_NAMES, getProfile, mintProfilePermit } = require("../session-router/session-profiles.cjs");
const { createRepositoryReader } = require("../session-router/repository-facts.cjs");
const { createProjectRegistry } = require("../session-router/project-registry.cjs");
const { createApprovalQueue } = require("../approval/approval-queue.cjs");

/** Flags that would place a secret on a command line. Refused by name so the reason is unambiguous. */
const FORBIDDEN_FLAGS = ["--value", "--secret", "--password", "--token", "--key"];

function parseArgs(argv) {
  const positional = [];
  const flags = Object.create(null);
  let passthrough = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") { passthrough = argv.slice(i + 1); break; }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
      if (FORBIDDEN_FLAGS.includes(name)) {
        throw new Error("refusing '" + name + "': a credential value must be typed at the hidden prompt, never passed on a command line");
      }
      if (inline !== null) { flags[name.slice(2)] = inline; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { flags[name.slice(2)] = true; continue; }
      flags[name.slice(2)] = next;
      i += 1;
    } else positional.push(arg);
  }
  return { positional, flags, passthrough };
}

/** Read one line with echo disabled. Refuses anything that is not an interactive terminal. */
function readHiddenLine(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      reject(new Error("a credential value must be typed at an interactive terminal — piped input is refused"));
      return;
    }
    process.stdout.write(prompt);
    // Code points, not UTF-16 units: `for...of` yields whole code points, so backspace must remove a
    // whole code point too. Slicing the string by -1 would leave an unpaired surrogate behind.
    const codePoints = [];
    let controlSeen = null;
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          input.setRawMode(false);
          input.pause();
          input.removeListener("data", onData);
          process.stdout.write("\n");
          if (codePoints.length === 0 && controlSeen !== null) {
            reject(new Error(
              "nothing was entered except a control key (U+" +
              controlSeen.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase() +
              "). This prompt runs in raw mode, where Ctrl+V is delivered as a control character " +
              "instead of pasting. Use RIGHT-CLICK to paste, or Ctrl+Shift+V in Windows Terminal, " +
              "then run the command again. Nothing was stored."
            ));
            return;
          }
          resolve(codePoints.join(""));
          return;
        }
        if (ch === "\u0003") { // Ctrl-C — abandon without storing anything
          input.setRawMode(false);
          input.pause();
          input.removeListener("data", onData);
          process.stdout.write("\n");
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\b" || ch === "\u007f") { codePoints.pop(); continue; }
        // A CONTROL CHARACTER IS NEVER PART OF A CREDENTIAL, and in raw mode the terminal delivers
        // Ctrl-V as the literal SYN character (U+0016) rather than performing a paste. Accepting it
        // silently is how a one-character "credential" gets stored and only fails much later, at the
        // provider, with an error pointing nowhere near the prompt. Observed for real on 2026-08-18:
        // a stored value of exactly U+0016. Refused here, where the cause is obvious.
        if (ch < " " || ch === "") { controlSeen = ch; continue; }
        codePoints.push(ch);
      }
    };
    input.on("data", onData);
  });
}

/**
 * THE STATE DIRECTORY IS NOT CALLER-SELECTABLE.
 *
 * The owner project registry is the trust anchor: it is the half of the identity comparison that a
 * checkout cannot choose. But the Windows Credential Manager is machine-wide and addressed purely by
 * reference string — it is NOT scoped to the state directory. So if a caller could point the registry at
 * a directory it controls, it could register a forged checkout as `polygo` in its own registry, pass the
 * preflight against itself, and have the vault release the REAL PolyGo credential from the shared store.
 *
 * There is therefore no `--state-dir` flag. The registry, the metadata sidecar, the leases and the session
 * records always resolve to `%LOCALAPPDATA%\ProjectOS`. Validators inject a state directory through the
 * programmatic API instead, where no real credential store is involved.
 */
function buildVault() {
  if (!isAvailable()) throw new Error("the Windows Credential Manager store is unavailable on this platform — refusing to substitute a weaker store");
  return createCredentialVault({ store: createWindowsCredentialStore({}) });
}

function requireReference(flags) {
  const parsed = parseReference(flags.ref);
  if (!parsed.ok) throw new Error("invalid --ref (" + parsed.reason + "). Expected ProjectOS/<project>/<environment>/<provider>/<credential>");
  return parsed.ref;
}

async function credentialsCommand(sub, flags) {
  const vault = buildVault();
  if (sub === "set") {
    const ref = requireReference(flags);
    const value = await readHiddenLine("Value for " + ref.reference + " (input hidden): ");
    if (!value) throw new Error("no value entered — nothing stored");
    const result = vault.provision({
      reference: ref.reference,
      replace: flags.replace === true || flags.replace === "true",
      note: typeof flags.note === "string" ? flags.note : undefined,
      expiresAt: typeof flags.expires === "string" ? flags.expires : undefined,
      readValue: () => value,
    });
    console.log((result.replaced ? "replaced" : "stored") + "  " + result.reference);
    console.log("  risk        " + result.risk);
    console.log("  fingerprint " + result.fingerprint);
    return 0;
  }
  if (sub === "delete") {
    const ref = requireReference(flags);
    const removed = vault.remove({ reference: ref.reference });
    console.log(removed ? "deleted  " + ref.reference : "not found  " + ref.reference);
    return removed ? 0 : 3;
  }
  if (sub === "status") {
    const rows = vault.status({ project: flags.project, environment: flags.environment, provider: flags.provider });
    if (!rows.length) { console.log("no credentials recorded for this filter"); return 0; }
    for (const row of rows) {
      console.log([
        row.present ? "present" : "MISSING",
        row.risk.padEnd(9),
        (row.fingerprint || "-").padEnd(12),
        row.expired ? "EXPIRED" : (row.expiresAt ? "expires " + row.expiresAt : "no-expiry"),
        row.reference,
      ].join("  "));
    }
    return 0;
  }
  if (sub === "doctor") {
    const rows = vault.status({ project: flags.project });
    const problems = [];
    for (const row of rows) {
      if (!row.present) problems.push("CREDENTIAL MISSING  " + row.reference);
      else if (row.expired) problems.push("CREDENTIAL EXPIRED  " + row.reference);
      else if (!row.managed) problems.push("unmanaged (no ProjectOS metadata)  " + row.reference);
    }
    console.log("store           " + vault.storeName);
    console.log("metadata file   " + vault.metadataPath);
    console.log("credentials     " + rows.length);
    console.log("operation-class " + OPERATION_CREDENTIALS.join(", "));
    if (!problems.length) console.log("result          OK — every recorded credential is present, unexpired and managed");
    else { console.log("result          " + problems.length + " problem(s)"); problems.forEach((p) => console.log("  " + p)); }
    return problems.length ? 1 : 0;
  }
  throw new Error("unknown credentials subcommand '" + String(sub) + "'");
}

async function sessionCommand(sub, flags, passthrough) {
  const vault = buildVault();
  const router = createSessionRouter({ vault });
  if (sub === "start") {
    const profile = getProfile(flags.profile);
    if (!profile) throw new Error("--profile must be one of: " + PROFILE_NAMES.join(", "));
    const command = Array.isArray(passthrough) && passthrough.length ? passthrough[0] : null;
    const args = Array.isArray(passthrough) && passthrough.length > 1 ? passthrough.slice(1) : [];
    const observations = typeof flags.observations === "string" ? JSON.parse(fs.readFileSync(flags.observations, "utf8")) : {};
    const checkoutPath = flags.checkout || process.cwd();

    // A profile that is not automatically loadable needs an owner-confirmed SESSION permit naming this
    // project, environment and profile. `--owner-confirm` is the owner asserting it at the keyboard.
    let permit = null;
    if (profile.autoLoadable !== true || profile.requiresOwnerPermit === true) {
      if (flags["owner-confirm"] !== true) throw new Error("OWNER PERMIT REQUIRED — profile '" + profile.name + "' is never loaded automatically; re-run with --owner-confirm");
      const loaded = loadConnection(checkoutPath);
      if (!loaded.ok) throw new Error(loaded.reason);
      permit = mintProfilePermit({ projectId: loaded.connection.projectId, environment: flags.environment, profile: profile.name, capability: { ownerConfirmation: true }, phaseId: typeof flags.phase === "string" ? flags.phase : null });
    }

    const outcome = router.start({
      slot: flags.slot,
      profileName: profile.name,
      environment: flags.environment,
      checkoutPath,
      observations,
      permit,
      command,
      args,
      phaseId: typeof flags.phase === "string" ? flags.phase : null,
    });
    if (!outcome.ready) {
      console.error(outcome.blocker);
      console.error("  " + (outcome.detail || ""));
      return 1;
    }
    console.log("READY");
    console.log("  slot        " + outcome.record.slot);
    console.log("  project     " + outcome.record.projectId);
    console.log("  profile     " + outcome.record.profile + " / " + outcome.record.environment);
    console.log("  checkout    " + outcome.record.checkoutPath + " (" + outcome.record.branch + ")");
    console.log("  credentials " + outcome.record.credentialReferences.length + " projected by reference");
    console.log("  env scrub   " + outcome.envSummary.scrubbed.length + " inherited provider variable(s) removed");

    // Stay alive for the child. If this process exited now, the router's exit handler could never fire and
    // the writer lease would sit on the checkout until its TTL expired.
    if (outcome.child && typeof outcome.child.on === "function") {
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (code) => { if (!settled) { settled = true; resolve(typeof code === "number" ? code : 1); } };
        outcome.child.on("exit", (code) => finish(code));
        outcome.child.on("error", (e) => { console.error("the session command could not start: " + String(e && e.message ? e.message : e)); finish(1); });
      });
    }
    return 0;
  }
  if (sub === "status") {
    const records = router.status({ slot: flags.slot });
    if (!records.length) { console.log("no active sessions"); return 0; }
    for (const r of records) console.log([r.slot.padEnd(14), r.projectId.padEnd(14), r.profile.padEnd(20), r.environment.padEnd(12), r.leaseHeld ? "writer" : "reader", r.checkoutPath].join("  "));
    return 0;
  }
  if (sub === "stop") {
    const result = router.stop({ slot: flags.slot });
    console.log(result.ok ? "stopped  " + String(flags.slot) : "not stopped: " + result.reason);
    return result.ok ? 0 : 1;
  }
  throw new Error("unknown session subcommand '" + String(sub) + "'");
}

function providersCommand(sub, flags) {
  if (sub !== "verify") throw new Error("unknown providers subcommand '" + String(sub) + "'");
  const checkout = flags.checkout || process.cwd();
  const loaded = loadConnection(checkout);
  if (!loaded.ok) throw new Error(loaded.reason);
  const connection = loaded.connection;
  const registry = createRegistry();
  const errors = registry.validateConnection(connection);
  if (errors.length) { errors.forEach((e) => console.error("invalid connection profile: " + e)); return 1; }

  const environment = flags.environment || "staging";
  const facts = createRepositoryReader().read(checkout);
  console.log("project    " + connection.projectId);
  console.log("checkout   " + (facts.ok ? facts.facts.canonicalRoot : "(unreadable: " + facts.reason + ")"));
  console.log("branch     " + (facts.ok ? facts.facts.branch : "-"));
  console.log("remote     " + (facts.ok ? facts.facts.remoteRepositoryFullName || "(non-GitHub or unset)" : "-"));

  const observations = typeof flags.observations === "string" ? JSON.parse(fs.readFileSync(flags.observations, "utf8")) : null;
  for (const name of connection.providers) {
    const adapter = registry.get(name);
    const plan = adapter.buildVerificationPlan(connection, environment);
    console.log("\n" + name + " — read-only verification plan (" + plan.steps.length + " step(s), nothing executed):");
    plan.steps.forEach((s) => console.log("  " + s.id + ": " + s.description));
    if (observations) {
      const observed = Object.prototype.hasOwnProperty.call(observations, name) ? observations[name] : null;
      const verdict = adapter.evaluateObservation(connection, environment, observed);
      console.log("  verdict: " + (verdict.ok ? "MATCH — " + verdict.detail : verdict.blocker + " — " + verdict.detail));
    }
  }
  console.log("\nNo provider was contacted. Supply --observations <file.json> to evaluate measurements taken elsewhere.");
  return 0;
}

function operationCommand(sub, flags, passthrough) {
  if (sub !== "run") throw new Error("unknown operation subcommand '" + String(sub) + "'");
  const vault = buildVault();
  // The approval queue records the owner-gated intent before anything runs, so an operation always leaves
  // a redacted, reviewable trace even when the owner confirms it in the same breath.
  const approvalQueue = createApprovalQueue({});
  const gate = createOperationGate({ vault, approvalQueue });
  const ref = requireReference(flags);
  if (!Array.isArray(passthrough) || !passthrough.length) throw new Error("pass the command after '--', e.g. operation run --ref ... -- <executable> <args>");
  if (typeof flags.action !== "string" || !flags.action) throw new Error("--action is required and names the provider action being performed, e.g. --action read-config");
  if (typeof flags["env-var"] !== "string" || !flags["env-var"]) throw new Error("--env-var is required and names the environment variable the credential is delivered under");
  if (flags["owner-confirm"] !== true) throw new Error("OWNER PERMIT REQUIRED — re-run with --owner-confirm to record your explicit confirmation");

  const productionFrozen = flags["production-unfrozen"] === true ? false : true;
  const intent = gate.requestPermit({ reference: ref.reference, action: flags.action, productionFrozen });
  if (intent.decision === "REFUSED") {
    console.error("PRODUCTION PROFILE REFUSED");
    console.error("  the provider guard refused this action: " + String(intent.reason));
    return 1;
  }

  const permit = gate.grantPermit({ reference: ref.reference, action: flags.action, capability: { ownerConfirmation: true }, phaseId: typeof flags.phase === "string" ? flags.phase : null });
  const result = gate.run({
    reference: ref.reference,
    action: flags.action,
    permit,
    capability: { ownerConfirmation: true },
    command: passthrough[0],
    args: passthrough.slice(1),
    envVarName: flags["env-var"],
    cwd: flags.checkout,
    includeOutput: flags["show-output"] === true,
    productionFrozen,
  });
  if (result.blocker) { console.error(result.blocker); return 1; }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.outputWithheld) {
    console.log("output withheld (stdout " + String(result.stdoutSize || "none") + ", stderr " + String(result.stderrSize || "none") + ").");
    console.log("Exact-string redaction cannot survive a child that re-encodes or wraps the value; pass --show-output to accept that risk.");
  }
  console.log("exit code " + String(result.exitCode) + " — the credential was never returned to this process's output");
  return result.ok ? 0 : 1;
}

function projectsCommand(sub, flags) {
  const registry = createProjectRegistry({});
  if (sub === "register") {
    if (flags["owner-confirm"] !== true) throw new Error("OWNER PERMIT REQUIRED — registering a project pins its identity; re-run with --owner-confirm");
    const checkout = flags.checkout || process.cwd();
    const loaded = loadConnection(checkout);
    if (!loaded.ok) throw new Error(loaded.reason);
    const record = registry.register({ connection: loaded.connection, checkoutPath: checkout, capability: { ownerConfirmation: true } });
    console.log("registered  " + record.projectId);
    record.canonicalRepositoryRoots.forEach((root) => console.log("  root      " + root));
    console.log("  registry  " + registry.filePath);
    return 0;
  }
  if (sub === "list") {
    const records = registry.list();
    if (!records.length) { console.log("no projects registered — a session cannot start until its project is registered"); return 0; }
    for (const record of records) {
      console.log(record.projectId + "  (" + record.canonicalRepositoryRoots.length + " root(s), registered " + record.registeredAt + ")");
      record.canonicalRepositoryRoots.forEach((root) => console.log("    " + root));
    }
    return 0;
  }
  if (sub === "unregister") {
    if (flags["owner-confirm"] !== true) throw new Error("OWNER PERMIT REQUIRED — re-run with --owner-confirm");
    const removed = registry.unregister({ projectId: flags.project, checkoutPath: flags.checkout, capability: { ownerConfirmation: true } });
    console.log(removed ? "unregistered  " + String(flags.project) : "not registered  " + String(flags.project));
    return removed ? 0 : 3;
  }
  throw new Error("unknown projects subcommand '" + String(sub) + "'");
}

function usage() {
  console.log([
    "projectos projects register --checkout <path> --owner-confirm    (pins this project's identity; required before any session)",
    "projectos projects list",
    "projectos projects unregister --project <id> [--checkout <path>] --owner-confirm",
    "projectos credentials set    --ref <reference> [--replace] [--note <text>] [--expires <iso>]",
    "projectos credentials delete --ref <reference>",
    "projectos credentials status [--project <id>] [--environment <env>] [--provider <name>]",
    "projectos credentials doctor [--project <id>]",
    "projectos session start --slot <slot> --profile <profile> --environment <env> [--checkout <path>] [--observations <file>] [-- <command> ...]",
    "projectos session status [--slot <slot>]",
    "projectos session stop   --slot <slot>",
    "projectos providers verify [--checkout <path>] [--environment <env>] [--observations <file>]",
    "projectos operation run --ref <reference> --action <action> --env-var <VAR> --owner-confirm [--show-output] -- <command> ...",
    "",
    "profiles: " + PROFILE_NAMES.join(", "),
    "A credential value is only ever typed at a hidden prompt. There is no flag that accepts one.",
  ].join("\n"));
}

async function main(argv) {
  const { positional, flags, passthrough } = parseArgs(argv);
  const [group, sub] = positional;
  if (!group || group === "help" || flags.help === true) { usage(); return 0; }
  if (group === "projects") return projectsCommand(sub, flags);
  if (group === "credentials") return credentialsCommand(sub, flags);
  if (group === "session") return sessionCommand(sub, flags, passthrough);
  if (group === "providers") return providersCommand(sub, flags);
  if (group === "operation") return operationCommand(sub, flags, passthrough);
  throw new Error("unknown command group '" + String(group) + "'");
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(typeof code === "number" ? code : 0))
    .catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exit(1); });
}

module.exports = { parseArgs, usage, FORBIDDEN_FLAGS, main, SCRIPT_PATH: path.resolve(__filename) };
