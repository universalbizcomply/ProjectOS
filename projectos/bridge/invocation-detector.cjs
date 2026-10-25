"use strict";
/**
 * Real tool-restriction DETECTION contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§5).
 *
 * Replaces a self-declared `verified: true` invocation profile with a VERIFICATION RECORD produced by a
 * detector. The record binds the restriction to the EXACT executable (content hash + version), the operation
 * mode, the sandbox provider, and the policy version, and records a safe NEGATIVE-CAPABILITY test (attempts
 * to invoke forbidden shell / network / git-write capabilities, expecting "DENIED BY TECHNICAL CONTROL").
 *
 * A manually-supplied profile with plausible strings and `verified:true` (but no detector record, or a record
 * bound to a different executable / version, or expired) is REJECTED. This module defines + verifies the
 * contract; the real detection runs on an owner machine. Synthetic providers prove the verifier.
 */

const crypto = require("crypto");
const { canonicalJson } = require("./attestation.cjs");

const DETECTOR_VERSION = "detector-1.0";
const NEGATIVE_TESTS = ["shell", "network", "git-write"];
const DENIED = "DENIED BY TECHNICAL CONTROL";
// Tool names that grant a forbidden capability; a permitted-tools list may never contain any of them, and a
// forbidden-tools list must contain at least the shell/web/git ones.
const DANGEROUS_TOOLS = ["Bash", "Shell", "Execute", "Run", "WebFetch", "WebSearch", "Git", "GitWrite", "Provider", "Database", "Deploy"];
const MUST_FORBID = ["Bash", "Shell", "WebFetch", "Git"];
const RECORD_FIELDS = [
  "detectorVersion", "resolvedExecutablePath", "executableContentHash", "cliVersion", "restrictionMechanism",
  "permittedTools", "forbiddenTools", "permittedCommands", "shellDisabled", "gitWriteDisabled",
  "networkDisabled", "providerToolsDisabled", "databaseToolsDisabled", "deploymentToolsDisabled",
  "commandExecutionDisabled", "negativeTests", "operationMode", "sandboxProviderId", "policyVersion",
  "argumentTemplate", "promptArgPosition", "argTemplateHash", "shellPossible", "commandExecutionPossible",
  "timestamp", "expiry", "recordHash",
];
const MUST_DISABLE = ["shellDisabled", "gitWriteDisabled", "networkDisabled", "providerToolsDisabled", "databaseToolsDisabled", "deploymentToolsDisabled"];
// Invocation-restriction verification outcomes (§12).
const INVOCATION_STATUS = { NOT_VERIFIED: "NOT VERIFIED", VERIFIED_NOT_APPLIED: "VERIFIED BUT NOT APPLIED", APPLIED_VERIFIED: "APPLIED AND VERIFIED" };
// Token markers the argument template may contain; ProjectOS substitutes them — never a caller function.
const TPL_TOOLS = "{tools}", TPL_PROMPT = "{prompt}";
// The only literal (non-placeholder, non-mechanism) flags an argument template may carry for the first proof.
const ALLOWED_PRINT_FLAGS = ["-p", "--print"];
// Substrings that must NEVER appear in a final argv element.
const ARGV_BANNED = /^--?(dangerously-skip-permissions|no-sandbox|allow-all|yolo|permission-mode=bypass|shell|exec|command)/i;

// §7 — the supported restriction-mechanism REGISTRY for the first controlled-change proof. A mechanism outside
// this set (for the detected CLI version) is refused. The registry is BOUND to the executable content hash, the
// CLI version, the detector version, and the policy version (via `mechanismRegistry`), so a record cannot claim
// an unsupported/forged mechanism for a different CLI.
const SUPPORTED_MECHANISMS = ["--allowedTools"];

function hashObj(o) { return require("crypto").createHash("sha256").update(canonicalJson(o || {})).digest("hex"); }
function hashTemplate(tpl) { return require("crypto").createHash("sha256").update(canonicalJson(tpl || [])).digest("hex"); }

/** Supported mechanisms + a binding hash for (exe hash, CLI version, detector version, policy version). */
function mechanismRegistry(bindCtx) {
  const c = bindCtx || {};
  const mechanisms = SUPPORTED_MECHANISMS.slice();
  const registryHash = hashObj({ mechanisms, executableContentHash: c.executableContentHash || null, cliVersion: c.cliVersion || null, detectorVersion: DETECTOR_VERSION, policyVersion: c.policyVersion || null });
  return { mechanisms, registryHash };
}
function isSupportedMechanism(mech, bindCtx) { return mechanismRegistry(bindCtx).mechanisms.indexOf(mech) >= 0; }

/**
 * §7 EXACT INVOCATION GRAMMAR — for the first controlled-change proof accept ONE argument grammar only:
 *   [ VERIFIED_RESTRICTION_MECHANISM, EXACT_PERMITTED_TOOLS_VALUE, "-p", PROMPT ]
 * Requires exactly four arguments, each token exactly once (outside the prompt — the prompt is DATA and is never
 * scanned), the prompt as the final argument, no empty tool entry, deterministic (sorted) tool ordering, and a
 * mechanism that is in the supported registry for the detected CLI version. Returns { ok, errors, registryHash }.
 */
function verifyGrammar(argv, record, prompt, bindCtx) {
  const errors = [];
  const rec = record || {};
  const mech = rec.restrictionMechanism;
  const toolList = (rec.permittedTools || []).map(String);
  const tools = toolList.join(",");
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return { ok: false, errors: ["grammar: argv must be a string array"], registryHash: null };
  if (argv.length !== 4) errors.push("grammar: expected exactly 4 arguments, got " + argv.length);
  // positional form
  if (argv[0] !== mech) errors.push("grammar: arg0 must be the restriction mechanism");
  if (argv[1] !== tools) errors.push("grammar: arg1 must be the exact permitted-tools value");
  if (ALLOWED_PRINT_FLAGS.indexOf(argv[2]) < 0) errors.push("grammar: arg2 must be an approved print flag (-p/--print)");
  if (argv[argv.length - 1] !== String(prompt)) errors.push("grammar: the final argument must be the prompt");
  // single occurrence each, scanning only the NON-prompt positions (prompt is data, never scanned).
  const nonPrompt = argv.slice(0, Math.max(0, argv.length - 1));
  if (nonPrompt.filter((x) => x === mech).length !== 1) errors.push("grammar: restriction mechanism must appear exactly once");
  if (nonPrompt.filter((x) => x === tools).length !== 1) errors.push("grammar: tools value must appear exactly once");
  if (nonPrompt.filter((x) => ALLOWED_PRINT_FLAGS.indexOf(x) >= 0).length !== 1) errors.push("grammar: print flag must appear exactly once");
  // no empty tool entry + deterministic ordering
  if (toolList.some((t) => t.trim() === "")) errors.push("grammar: empty tool entry");
  const sorted = toolList.slice().sort();
  if (JSON.stringify(toolList) !== JSON.stringify(sorted)) errors.push("grammar: permitted tools are not in deterministic (sorted) order");
  // mechanism must be in the supported registry for the detected CLI version
  if (!isSupportedMechanism(mech, bindCtx)) errors.push("grammar: restriction mechanism '" + String(mech) + "' is not in the supported registry for this CLI version");
  return { ok: errors.length === 0, errors, registryHash: mechanismRegistry(bindCtx).registryHash };
}

function hashRecord(rec) { const c = Object.assign({}, rec); delete c.recordHash; return crypto.createHash("sha256").update(canonicalJson(c)).digest("hex"); }

/**
 * Verify a detection record against the current binding context. Returns { ok, errors }.
 * @param rec detection record (from a real detector, or syntheticRecord for tests)
 * @param ctx { executableContentHash, cliVersion, operationMode, sandboxProviderId, policyVersion, now, firstControlledChange }
 */
function verifyDetectionRecord(rec, ctx) {
  const errors = [];
  const c = ctx || {};
  if (!rec || typeof rec !== "object") return { ok: false, errors: ["detection: not a record (a bare verified:true profile fails)"] };
  for (const f of RECORD_FIELDS) if (!(f in rec)) errors.push("detection: missing '" + f + "'");
  if (rec.detectorVersion !== DETECTOR_VERSION) errors.push("detection: unknown detectorVersion");

  // binding — a missing ctx value is a failure (never a silently-skipped binding).
  const bind = ["executableContentHash", "cliVersion", "operationMode", "sandboxProviderId", "policyVersion"];
  for (const k of bind) { if (c[k] === undefined || c[k] === null) { errors.push("detection: incomplete verification context (missing " + k + ")"); continue; } if (rec[k] !== c[k]) errors.push("detection: " + k + " does not match (record bound to a different " + k + ")"); }
  if (!rec.executableContentHash) errors.push("detection: no executable content hash");

  // freshness
  const now = typeof c.now === "number" ? c.now : Date.now();
  if (typeof rec.timestamp !== "number" || typeof rec.expiry !== "number") errors.push("detection: timestamp/expiry must be numbers");
  else if (rec.expiry <= now) errors.push("detection: verification record expired");

  // hard disables
  for (const k of MUST_DISABLE) if (rec[k] !== true) errors.push("detection: " + k + " is not proven true");

  // tool-LIST content must agree with the disable flags: no permitted tool may grant a forbidden capability,
  // and the forbidden list must include the dangerous ones (a self-contradictory record is refused).
  const permitted = Array.isArray(rec.permittedTools) ? rec.permittedTools.map(String) : [];
  const forbidden = Array.isArray(rec.forbiddenTools) ? rec.forbiddenTools.map(String) : [];
  for (const t of permitted) if (DANGEROUS_TOOLS.indexOf(t) >= 0) errors.push("detection: permittedTools contains a dangerous-capability tool '" + t + "'");
  for (const t of MUST_FORBID) if (forbidden.indexOf(t) < 0) errors.push("detection: forbiddenTools must include '" + t + "'");

  // negative-capability tests: each must be DENIED BY TECHNICAL CONTROL
  const nt = Array.isArray(rec.negativeTests) ? rec.negativeTests : [];
  for (const name of NEGATIVE_TESTS) {
    const t = nt.find((x) => x && x.capability === name);
    if (!t) { errors.push("detection: missing negative test for '" + name + "'"); continue; }
    if (t.result !== DENIED) errors.push("detection: negative test '" + name + "' did not report '" + DENIED + "'");
  }

  // first controlled-change: command execution disabled + no permitted commands
  if (c.firstControlledChange) {
    if (rec.commandExecutionDisabled !== true) errors.push("detection: commandExecutionDisabled must be true for the first proof");
    if (Array.isArray(rec.permittedCommands) && rec.permittedCommands.length > 0) errors.push("detection: permittedCommands must be empty for the first proof");
    if (rec.shellPossible !== false) errors.push("detection: shellPossible must be false for the first proof");
    if (rec.commandExecutionPossible !== false) errors.push("detection: commandExecutionPossible must be false for the first proof");
  }

  // the canonical argument template must be well-formed: an array that INCLUDES the restriction mechanism and
  // the {prompt} token, with a matching argTemplateHash. ProjectOS builds the final argv from this — a record
  // whose template omits the restriction mechanism cannot drive a restricted real run.
  if (typeof rec.restrictionMechanism !== "string" || !rec.restrictionMechanism.length) errors.push("detection: restrictionMechanism must be a non-empty string");
  if (!Array.isArray(rec.argumentTemplate)) errors.push("detection: argumentTemplate must be an array");
  else {
    // ALLOWLIST the template tokens: exactly the restriction mechanism, {tools}, an approved print flag, and
    // {prompt} — NOTHING else. This blocks smuggling a bypass/out-of-band flag as a space-separated element
    // (e.g. ["--permission-mode","bypassPermissions",…]) that a token-substring scan would miss.
    const allowed = new Set([rec.restrictionMechanism, "{tools}", "{prompt}"].concat(ALLOWED_PRINT_FLAGS));
    for (const tok of rec.argumentTemplate) if (!allowed.has(tok)) errors.push("detection: unrecognized argumentTemplate token '" + String(tok) + "' (only mechanism / {tools} / -p / {prompt} are allowed)");
    if (typeof rec.restrictionMechanism === "string" && rec.restrictionMechanism.length && rec.argumentTemplate.indexOf(rec.restrictionMechanism) < 0) errors.push("detection: argumentTemplate omits the restrictionMechanism");
    if (rec.argumentTemplate.indexOf("{tools}") < 0) errors.push("detection: argumentTemplate omits the {tools} token (restriction would not be applied)");
    const pIdx = rec.argumentTemplate.indexOf("{prompt}");
    if (pIdx < 0) errors.push("detection: argumentTemplate omits the {prompt} token");
    if (typeof rec.promptArgPosition === "number" && rec.promptArgPosition !== pIdx) errors.push("detection: promptArgPosition does not match the {prompt} token position");
    if (typeof rec.argTemplateHash !== "string" || rec.argTemplateHash !== hashTemplate(rec.argumentTemplate)) errors.push("detection: argTemplateHash mismatch (modified)");
  }

  // integrity — recordHash MUST be a well-formed sha256 hex and is ALWAYS compared (a blanked/absent hash
  // fails; it never skips). Integrity, not authenticity (see report trust boundary).
  if (typeof rec.recordHash !== "string" || !/^[0-9a-f]{64}$/.test(rec.recordHash)) errors.push("detection: recordHash missing/invalid");
  else if (hashRecord(rec) !== rec.recordHash) errors.push("detection: recordHash mismatch (modified)");

  return { ok: errors.length === 0, errors };
}

/** Build a SYNTHETIC detection record (labelled) bound to a context — proves the verifier accepts a good one. */
function syntheticRecord(ctx, opts) {
  const o = opts || {};
  const c = ctx || {};
  const now = typeof o.now === "number" ? o.now : Date.now();
  const neg = NEGATIVE_TESTS.map((cap) => ({ capability: cap, attempted: "invoke " + cap, expected: DENIED, result: o.negFail === cap ? "ALLOWED" : DENIED }));
  const rec = {
    detectorVersion: DETECTOR_VERSION,
    resolvedExecutablePath: o.resolvedExecutablePath || "/sandbox/bin/claude",
    executableContentHash: c.executableContentHash || "exe-hash",
    cliVersion: c.cliVersion || "1.9.0", restrictionMechanism: o.restrictionMechanism || "--allowedTools",
    permittedTools: (o.permittedTools || ["Read", "Edit"]).slice().sort(), forbiddenTools: o.forbiddenTools || ["Bash", "Shell", "WebFetch", "Git"],
    permittedCommands: o.permittedCommands || [],
    shellDisabled: o.shellDisabled !== false, gitWriteDisabled: o.gitWriteDisabled !== false, networkDisabled: o.networkDisabled !== false,
    providerToolsDisabled: o.providerToolsDisabled !== false, databaseToolsDisabled: o.databaseToolsDisabled !== false, deploymentToolsDisabled: o.deploymentToolsDisabled !== false,
    commandExecutionDisabled: o.commandExecutionDisabled !== false,
    negativeTests: neg, operationMode: c.operationMode || "first-controlled-change",
    sandboxProviderId: c.sandboxProviderId || null, policyVersion: c.policyVersion || "policy-1",
    argumentTemplate: o.argumentTemplate || ["--allowedTools", TPL_TOOLS, "-p", TPL_PROMPT],
    promptArgPosition: o.promptArgPosition === undefined ? 3 : o.promptArgPosition,
    shellPossible: o.shellPossible === true, commandExecutionPossible: o.commandExecutionPossible === true,
    timestamp: now, expiry: now + (o.ttlMs || 300000),
  };
  rec.argTemplateHash = hashTemplate(rec.argumentTemplate);
  rec.recordHash = hashRecord(rec);
  if (o.tamper) rec.cliVersion = "9.9.9"; // do NOT re-hash → mismatch
  return rec;
}

/**
 * ProjectOS constructs the FINAL argv itself from the verified record's canonical template — a caller function
 * is NEVER trusted to build a real-run argv. Substitutes {tools} → the exact permitted-tool list and {prompt}
 * → the approved prompt. Returns { argv, promptIndex }.
 */
function buildArgv(record, prompt) {
  const tpl = Array.isArray(record.argumentTemplate) ? record.argumentTemplate : [];
  const tools = (record.permittedTools || []).join(",");
  const argv = []; let promptIndex = -1;
  for (const tok of tpl) {
    if (tok === TPL_TOOLS) argv.push(tools);
    else if (tok === TPL_PROMPT) { promptIndex = argv.length; argv.push(String(prompt)); }
    else argv.push(String(tok));
  }
  return { argv, promptIndex };
}

/**
 * Verify a FINAL argv exactly encodes the record's restriction: the restriction mechanism is present, the
 * permitted-tool list is encoded exactly, no forbidden/shell/network/git-write/bypass token appears, the prompt
 * sits at the expected position, and no unknown argument exists. Returns { status, argvHash, errors }.
 *   APPLIED AND VERIFIED — restriction encoded + everything matches
 *   VERIFIED BUT NOT APPLIED — argv is well-formed but the restriction mechanism is absent (e.g. `-p prompt`)
 *   NOT VERIFIED — argv contradicts the record (forbidden token / unknown arg / wrong prompt position)
 */
function verifyInvocation(argv, record, prompt) {
  const errors = [];
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return { status: INVOCATION_STATUS.NOT_VERIFIED, argvHash: null, errors: ["argv-not-string-array"] };
  const argvHash = require("crypto").createHash("sha256").update(canonicalJson(argv)).digest("hex");
  const mech = record.restrictionMechanism;
  const tools = (record.permittedTools || []).join(",");
  const forbidden = (record.forbiddenTools || []).concat(["Bash", "Shell", "WebFetch", "WebSearch", "Git", "GitWrite", "Provider", "Database", "Deploy"]);
  const built = buildArgv(record, prompt);
  // The PROMPT is data (the `-p` value), not an argument — never scan it for tool/flag tokens (a benign prompt
  // like "Git" or "use Run,Deploy" must not falsely block). Scan only the NON-prompt argv positions.
  for (let i = 0; i < argv.length; i++) {
    if (i === built.promptIndex) continue;
    const a = argv[i];
    if (ARGV_BANNED.test(a)) errors.push("banned argv token: " + a);
    for (const f of forbidden) if (a === f || a.split(",").indexOf(f) >= 0) errors.push("forbidden tool encoded: " + f);
  }
  // prompt at the expected position
  if (built.promptIndex < 0 || argv[built.promptIndex] !== String(prompt)) errors.push("prompt not at the expected argument position");
  // no unknown argument: the argv must equal what ProjectOS itself would build from the template
  if (canonicalJson(argv) !== canonicalJson(built.argv)) errors.push("argv contains an unknown/altered argument (does not match the canonical template)");

  if (errors.length) return { status: INVOCATION_STATUS.NOT_VERIFIED, argvHash, errors };
  // restriction mechanism must be present AND carry exactly the permitted-tool list
  const mi = mech ? argv.indexOf(mech) : -1;
  const applied = mi >= 0 && argv[mi + 1] === tools;
  return { status: applied ? INVOCATION_STATUS.APPLIED_VERIFIED : INVOCATION_STATUS.VERIFIED_NOT_APPLIED, argvHash, errors: applied ? [] : ["restriction mechanism '" + mech + "' not applied in argv"] };
}

module.exports = {
  verifyDetectionRecord, syntheticRecord, hashRecord, buildArgv, verifyInvocation, verifyGrammar,
  mechanismRegistry, isSupportedMechanism, hashTemplate, DETECTOR_VERSION, NEGATIVE_TESTS, DENIED,
  RECORD_FIELDS, INVOCATION_STATUS, SUPPORTED_MECHANISMS,
};
