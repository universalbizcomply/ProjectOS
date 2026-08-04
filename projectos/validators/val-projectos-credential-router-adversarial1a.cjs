"use strict";
/**
 * Adversarial and asset pass for PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A. SYNTHETIC VALUES ONLY.
 * Nothing here contacts a provider, spawns PowerShell, or touches the machine's real credential store —
 * the Windows adapter is exercised through an injected `spawnSync` that records what it was asked to do.
 *
 * Invariants:
 *   1  every schema and template ships, parses, and carries no credential-value field
 *  1b  no shipped file is excluded by .gitignore (a silently ignored module breaks every clone)
 *   2  the .mcp.json template uses placeholders only, and every placeholder is a declared provider variable
 *   3  every credential reference in the connection template parses
 *   4  the Windows adapter never places the value in argv, and does place it on the environment channel
 *   5  the Windows adapter gives the child a MINIMAL environment — the parent's provider state is not forwarded
 *   6  the Windows adapter refuses a malformed reference and a wildcard listing prefix BEFORE spawning
 *   7  a not-found credential is reported, not thrown as an error carrying store detail
 *   8  a store error message never carries the child's stderr verbatim
 *   9  the PowerShell helper validates its target, takes the value only from the environment, and never uses cmdkey
 *  10  the in-memory store refuses to exist without an explicit non-persistence acknowledgement
 *  11  the CLI refuses every value-carrying flag by name
 *  12  the CLI exposes no flag that could supply a credential value
 *  13  environment projection refuses an undeclared provider variable
 *  14  junk, oversized and prototype-polluting input fails closed at every entry point, with no crash
 *  15  no Object.prototype pollution results from any of it
 *  16  no new module source contains an endpoint, credential-shaped string, or a `gh auth switch` call
 *  17  a token-like string is redacted out of any text the vault hands back
 *  18  a memory-store listing prefix cannot match a sibling project by string prefix alone
 *  19  the provider registry refuses an adapter that does not satisfy the contract
 *  20  every provider adapter's declared env vars appear in the registry's scrub union
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const scratch = require("./lib/scratch.cjs");

const ROOT = path.resolve(__dirname, "..");
const { createWindowsCredentialStore } = require("../credentials/windows-credential-store.cjs");
const { createMemoryCredentialStore } = require("../credentials/memory-credential-store.cjs");
const { createCredentialVault } = require("../credentials/vault.cjs");
const { createOperationGate } = require("../credentials/operation-gate.cjs");
const { createSessionRouter } = require("../session-router/router.cjs");
const { buildChildEnvironment, extractPlaceholders, validateMcpConfig } = require("../session-router/env-projection.cjs");
const { createProjectRegistry } = require("../session-router/project-registry.cjs");
const { RESERVED_ENV_NAMES } = require("../credentials/operation-gate.cjs");
const { createMetadataStore } = require("../credentials/credential-metadata.cjs");
const { createRegistry } = require("../providers/registry.cjs");
const { parseReference } = require("../credentials/reference.cjs");
const cli = require("../scripts/projectos-credential-router.cjs");

const SYNTHETIC = "synthetic-adversarial-value-9999";

const ASSETS = [
  "schemas/connection-profile.schema.json",
  "schemas/capability-policy.schema.json",
  "schemas/session-profile.schema.json",
  "templates/projectops/connections.template.json",
  "templates/projectops/capability-policy.template.json",
  "templates/projectops/mcp.template.json",
  "templates/projectops/sessions/readonly-reviewer.template.json",
  "templates/projectops/sessions/staging-writer.template.json",
  "templates/projectops/sessions/proof-runner.template.json",
];

const NEW_SOURCES = [
  "credentials/reference.cjs", "credentials/vault.cjs", "credentials/credential-metadata.cjs", "credentials/credential-shapes.cjs",
  "credentials/memory-credential-store.cjs", "credentials/windows-credential-store.cjs", "credentials/operation-gate.cjs",
  "session-router/session-profiles.cjs", "session-router/writer-lease.cjs", "session-router/identity-preflight.cjs",
  "session-router/env-projection.cjs", "session-router/repository-facts.cjs", "session-router/router.cjs",
  "session-router/project-registry.cjs",
  "providers/registry.cjs", "providers/github.provider.cjs", "providers/supabase.provider.cjs", "providers/vercel.provider.cjs",
];

/** Inputs that must never crash a boundary or widen a decision. */
const JUNK = [
  undefined, null, 0, 1, -1, "", "x", true, false, [], {}, () => {},
  { __proto__: { polluted: true } },
  JSON.parse('{"__proto__": {"polluted": true}}'),
  { constructor: { prototype: { polluted: true } } },
  { reference: "x".repeat(5000) },
  { reference: { toString: () => "ProjectOS/a/staging/github/gh-token" } },
];

function readAsset(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^﻿/, "");
}

function failsClosed(errors, label, fn) {
  try {
    const out = fn();
    // A boundary may legitimately return a refusal object rather than throwing; what it must never do is
    // return something that reads as success.
    if (out && typeof out === "object" && (out.ok === true || out.ready === true || out.allowed === true)) {
      errors.push(label + ": junk input produced a success-shaped result");
    }
  } catch (e) {
    if (e instanceof RangeError && /call stack/i.test(String(e.message))) errors.push(label + ": junk input caused a stack overflow");
  }
}

function run() {
  const errors = [];

  // 1: assets ship and parse; no value-carrying field anywhere in them.
  const valueFieldRe = /"(token|secret|password|apiKey|api_key|serviceRoleKey|service_role_key|accessToken|access_token)"\s*:\s*"(?!\$\{)[^"]+"/;
  for (const rel of ASSETS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) { errors.push("invariant 1: missing asset " + rel); continue; }
    const text = readAsset(rel);
    try { JSON.parse(text); } catch (e) { errors.push("invariant 1: " + rel + " is not valid JSON: " + e.message); continue; }
    if (valueFieldRe.test(text)) errors.push("invariant 1: " + rel + " carries a literal credential-value field");
  }

  // 1b: NOTHING this capability ships may be swallowed by .gitignore. The repository ignores `secret*`,
  // `*token*`, `*.key` and `*.pem` — sensible for secrets, lethal for a source file that happens to match.
  // An ignored module is absent from the commit and every clone fails at require time, silently.
  const ignoreProbe = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: ROOT,
    input: [...NEW_SOURCES, ...ASSETS, "credentials/windows-credential-store.ps1", "scripts/projectos-credential-router.cjs", "docs/credential-router.md"].join("\n"),
    encoding: "utf8",
  });
  if (ignoreProbe.error) errors.push("invariant 1b: could not run git check-ignore: " + String(ignoreProbe.error.message));
  else {
    for (const ignored of String(ignoreProbe.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      errors.push("invariant 1b: .gitignore excludes a shipped file — it would be missing from the commit: " + ignored);
    }
  }

  // 2: the MCP template is placeholders only, and every placeholder is a declared provider variable.
  const registry = createRegistry();
  const declared = new Set(registry.allEnvVars());
  const mcpText = readAsset("templates/projectops/mcp.template.json");
  const mcp = JSON.parse(mcpText);
  for (const name of extractPlaceholders(mcp)) {
    if (!declared.has(name)) errors.push("invariant 2: MCP template references undeclared variable ${" + name + "}");
  }
  if (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(mcpText) === false) errors.push("invariant 2: the MCP template contains no placeholders at all");
  for (const server of Object.keys(mcp.mcpServers || {})) {
    const envBlock = mcp.mcpServers[server].env || {};
    for (const [key, value] of Object.entries(envBlock)) {
      if (!/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(String(value))) errors.push("invariant 2: MCP server '" + server + "' env '" + key + "' is not a bare placeholder");
    }
  }

  // 3: every reference in the connection template parses.
  const connections = JSON.parse(readAsset("templates/projectops/connections.template.json"));
  for (const reference of connections.credentialReferences || []) {
    if (!parseReference(reference).ok) errors.push("invariant 3: connection template reference does not parse: " + reference);
  }

  // 4-8: the Windows adapter, driven through an injected spawnSync.
  const calls = [];
  const store = createWindowsCredentialStore({
    spawnSync: (command, args, options) => {
      calls.push({ command, args, env: options.env });
      const action = args[args.indexOf("-Action") + 1];
      if (action === "get") return { status: 0, stdout: SYNTHETIC, stderr: "" };
      if (action === "exists") return { status: 3, stdout: "", stderr: "" };
      if (action === "delete") return { status: 3, stdout: "", stderr: "" };
      if (action === "list") return { status: 1, stdout: "", stderr: "SENSITIVE-CHILD-STDERR " + SYNTHETIC };
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  const reference = "ProjectOS/polygo/staging/github/gh-token";
  const parentGhToken = "synthetic-parent-inherited-token1";
  const savedGhToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = parentGhToken;
  try {
    store.set(reference, SYNTHETIC);
    const setCall = calls[0];
    if (JSON.stringify(setCall.args).includes(SYNTHETIC)) errors.push("invariant 4: the value appeared in the PowerShell command arguments");
    if (setCall.env.PROJECTOS_CREDENTIAL_VALUE !== SYNTHETIC) errors.push("invariant 4: the value did not reach the environment channel");
    if (Object.prototype.hasOwnProperty.call(setCall.env, "GH_TOKEN")) errors.push("invariant 5: the parent's GH_TOKEN was forwarded to the credential-store child");
    if (setCall.env.PROJECTOS_CREDENTIAL_VALUE && !setCall.args.includes("-File")) errors.push("invariant 4: the helper was not invoked as a script file");
  } finally {
    if (savedGhToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedGhToken;
  }

  for (const bad of ["", "not-a-reference", "ProjectOS/a/b", "Other/polygo/staging/github/gh-token"]) {
    const before = calls.length;
    let threw = false;
    try { store.get(bad); } catch (e) { threw = true; }
    if (!threw) errors.push("invariant 6: a malformed reference was not refused: " + bad);
    if (calls.length !== before) errors.push("invariant 6: a malformed reference reached the child process");
  }
  for (const badPrefix of ["ProjectOS/*", "*", "../ProjectOS", "ProjectOS/polygo/staging/github/gh-token/extra"]) {
    const before = calls.length;
    let threw = false;
    try { store.list(badPrefix); } catch (e) { threw = true; }
    if (!threw) errors.push("invariant 6: a wildcard/invalid listing prefix was accepted: " + badPrefix);
    if (calls.length !== before) errors.push("invariant 6: an invalid listing prefix reached the child process");
  }

  if (store.exists(reference) !== false) errors.push("invariant 7: a not-found credential was not reported as absent");
  if (store.del(reference) !== false) errors.push("invariant 7: deleting an absent credential did not report false");
  try {
    store.list("ProjectOS/polygo");
    errors.push("invariant 8: a failing store call did not raise");
  } catch (e) {
    if (String(e.message).includes(SYNTHETIC) || String(e.message).includes("SENSITIVE-CHILD-STDERR")) {
      errors.push("invariant 8: the store error carried the child's stderr verbatim");
    }
  }

  // 9: the PowerShell helper.
  const ps = fs.readFileSync(path.join(ROOT, "credentials", "windows-credential-store.ps1"), "utf8");
  if (!ps.includes("PROJECTOS_CREDENTIAL_VALUE")) errors.push("invariant 9: the helper does not read the value from the environment channel");
  if (/\[string\]\$(Value|Password|Secret)/i.test(ps)) errors.push("invariant 9: the helper declares a value parameter");
  if (/\bcmdkey\b/i.test(ps)) errors.push("invariant 9: the helper shells out to cmdkey (which would put the value in argv)");
  if (!ps.includes("targetPattern")) errors.push("invariant 9: the helper does not validate its target name");
  if (/Start-Transcript/i.test(ps)) errors.push("invariant 9: the helper starts a transcript");

  // 10: the in-memory store cannot be created by accident.
  let memoryRefused = false;
  try { createMemoryCredentialStore({}); } catch (e) { memoryRefused = true; }
  if (!memoryRefused) errors.push("invariant 10: the in-memory store was created without an acknowledgement");

  // 11 / 12: the CLI refuses value-carrying flags.
  for (const flag of cli.FORBIDDEN_FLAGS) {
    let refused = false;
    try { cli.parseArgs(["credentials", "set", flag, "anything"]); } catch (e) { refused = String(e.message).includes("hidden prompt"); }
    if (!refused) errors.push("invariant 11: the CLI accepted " + flag);
  }
  const cliSource = fs.readFileSync(path.join(ROOT, "scripts", "projectos-credential-router.cjs"), "utf8");
  if (/flags\.(value|secret|password)\b/.test(cliSource)) errors.push("invariant 12: the CLI reads a value-carrying flag");
  if (!cliSource.includes("isTTY")) errors.push("invariant 12: the CLI does not require an interactive terminal for hidden input");

  // 13: environment projection refuses an undeclared variable.
  let undeclaredRefused = false;
  try {
    buildChildEnvironment({ baseEnv: {}, providerEnvVars: ["GH_TOKEN"], contributions: { SOMETHING_ELSE: "x" } });
  } catch (e) { undeclaredRefused = String(e.message).includes("undeclared"); }
  if (!undeclaredRefused) errors.push("invariant 13: an undeclared provider variable was projected");

  // 13b: the MCP structural rule — a credential-named key must hold a bare placeholder. This is what
  // catches a provider (Vercel, say) whose token has no distinctive prefix for a regex to recognise.
  const rawVercelToken = { mcpServers: { vercel: { env: { VERCEL_TOKEN: "AbCdEf0123456789AbCdEf01" } } } };
  const structural = validateMcpConfig({ mcpConfig: rawVercelToken, env: {}, allowedServers: ["vercel"] });
  if (structural.ok || !structural.literalSecrets.length) errors.push("invariant 13b: a raw provider token with no recognisable prefix was accepted in an MCP config");

  // 13c: the owner project registry fails closed and cannot be written by automation.
  scratch.withScratch("credential-registry", (dir) => {
    const projects = createProjectRegistry({ stateDir: dir });
    let refused = false;
    try { projects.register({ connection: { projectId: "polygo" }, checkoutPath: dir, capability: {} }); }
    catch (e) { refused = String(e.message).includes("OWNER PERMIT REQUIRED"); }
    if (!refused) errors.push("invariant 13c: a project was registered without owner confirmation");
    const verdict = projects.verify({ connection: { projectId: "polygo" }, environment: "staging", canonicalRoot: "c:/anywhere" });
    if (verdict.ok !== false || verdict.blocker !== "REPOSITORY MISMATCH") errors.push("invariant 13c: an unregistered project was not refused");
    // A registry we cannot parse must not degrade into an empty (and therefore permissive-looking) one.
    fs.writeFileSync(path.join(dir, "projects.json"), "{ not json", "utf8");
    let threw = false;
    try { projects.list(); } catch (e) { threw = true; }
    if (!threw) errors.push("invariant 13c: a corrupt registry file was silently treated as empty");
  });

  // 13d: a literal secret NESTED under a credential-shaped key must still be refused. The structural rule
  // has to carry the key context down through objects and arrays, or the check is one wrapper deep.
  for (const nested of [
    { mcpServers: { x: { env: { GH_TOKEN: { raw: "unprefixed-secret-value-0123456789" } } } } },
    { mcpServers: { x: { env: { GH_TOKEN: ["unprefixed-secret-value-0123456789"] } } } },
    { mcpServers: { x: { env: { apiKeyId: "unprefixed-secret-value-0123456789" } } } },
  ]) {
    const verdict = validateMcpConfig({ mcpConfig: nested, env: {}, allowedServers: ["x"] });
    if (verdict.ok || !verdict.literalSecrets.length) errors.push("invariant 13d: a nested literal secret under a credential key was accepted");
  }
  // ...and `PATHEXT` must NOT be treated as a credential key just because it starts with "PAT".
  const pathext = validateMcpConfig({ mcpConfig: { mcpServers: { x: { env: { PATHEXT: ".EXE;.CMD" } } } }, env: {}, allowedServers: ["x"] });
  if (!pathext.ok) errors.push("invariant 13d: PATHEXT was wrongly classified as a credential key");

  // 13e: the CLI exposes no state-directory flag. The Windows Credential Manager is machine-wide and is
  // NOT scoped by state directory, so a caller-selectable registry location would let a forged checkout
  // register itself as a real project and have the vault release that project's real credential.
  const cliText = fs.readFileSync(path.join(ROOT, "scripts", "projectos-credential-router.cjs"), "utf8");
  if (/flags\[\s*["']state-dir["']\s*\]/.test(cliText)) errors.push("invariant 13e: the CLI reads a caller-supplied state directory");

  // 13f: the metadata sidecar refuses a free-text expiry, which would otherwise be a second unscanned
  // door into a file documented as non-secret.
  scratch.withScratch("credential-expiry", (dir) => {
    const meta = createMetadataStore({ stateDir: dir });
    let refused = false;
    try { meta.recordProvision("ProjectOS/polygo/staging/github/gh-token", SYNTHETIC, { expiresAt: "ghp_" + "a".repeat(36) }); }
    catch (e) { refused = String(e.message).includes("ISO-8601"); }
    if (!refused) errors.push("invariant 13f: a free-text expiresAt was accepted");
    // A well-formed instant is still accepted.
    try { meta.recordProvision("ProjectOS/polygo/staging/github/gh-token", SYNTHETIC, { expiresAt: "2027-01-31T00:00:00Z" }); }
    catch (e) { errors.push("invariant 13f: a valid ISO-8601 expiry was rejected: " + e.message); }

    // 13g: a lock held by a LIVE process is never stolen, however old it looks. The holder is ANOTHER
    // live process (this process's parent), so the self-pid short-circuit cannot mask the liveness check.
    const lockFile = path.join(dir, "credential-metadata.lock");
    for (const holderPid of [process.ppid, process.pid]) {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: holderPid, takenAtMs: 1 }), "utf8");
      let blocked = false;
      try { meta.recordProvision("ProjectOS/polygo/staging/vercel/vercel-token", SYNTHETIC, {}); }
      catch (e) { blocked = String(e.message).includes("could not acquire"); }
      fs.rmSync(lockFile, { force: true });
      if (!blocked) errors.push("invariant 13g: a stale-looking lock held by live pid " + String(holderPid) + " was stolen");
    }
    // A lock whose recorded holder is gone IS reclaimable, so the guard cannot deadlock the store.
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 0x7ffffffe, takenAtMs: 1 }), "utf8");
    let reclaimed = true;
    try { meta.recordProvision("ProjectOS/polygo/staging/vercel/vercel-token", SYNTHETIC, {}); }
    catch (e) { reclaimed = false; }
    fs.rmSync(lockFile, { force: true });
    if (!reclaimed) errors.push("invariant 13g: an abandoned lock was not reclaimable");
  });

  // 14 / 15: junk input across every boundary.
  scratch.withScratch("credential-adversarial", (dir) => {
    const memory = createMemoryCredentialStore({ acknowledgedNonPersistent: true });
    const vault = createCredentialVault({ store: memory, stateDir: dir });
    const gate = createOperationGate({ vault, spawnSync: () => ({ status: 0, stdout: "", stderr: "" }) });
    const router = createSessionRouter({ vault, stateDir: path.join(dir, "state"), spawn: () => ({ pid: 1, on: () => {} }) });
    for (const junk of JUNK) {
      failsClosed(errors, "invariant 14 (vault.provision)", () => vault.provision(junk));
      failsClosed(errors, "invariant 14 (vault.present)", () => vault.present(junk));
      failsClosed(errors, "invariant 14 (vault.authoriseSessionRelease)", () => vault.authoriseSessionRelease(junk));
      failsClosed(errors, "invariant 14 (vault.authoriseOperationRelease)", () => vault.authoriseOperationRelease(junk));
      failsClosed(errors, "invariant 14 (vault.releaseIntoChildEnvironment)", () => vault.releaseIntoChildEnvironment(junk));
      failsClosed(errors, "invariant 14 (gate.requestPermit)", () => gate.requestPermit(junk));
      failsClosed(errors, "invariant 14 (gate.grantPermit)", () => gate.grantPermit(junk));
      failsClosed(errors, "invariant 14 (gate.run)", () => gate.run(junk));
      failsClosed(errors, "invariant 14 (router.prepare)", () => router.prepare(junk));
      failsClosed(errors, "invariant 14 (router.start)", () => router.start(junk));
      failsClosed(errors, "invariant 14 (router.stop)", () => router.stop(junk));
      failsClosed(errors, "invariant 14 (buildChildEnvironment)", () => buildChildEnvironment(junk));
    }
    if ({}.polluted !== undefined) errors.push("invariant 15: Object.prototype was polluted");
    if (Object.prototype.polluted !== undefined) errors.push("invariant 15: Object.prototype carries a polluted key");

    // 17: a token-like string is redacted out of anything the vault hands back.
    vault.provision({ reference: "ProjectOS/polygo/staging/github/gh-token", readValue: () => SYNTHETIC });
    const redacted = vault.redactText("log line carrying " + SYNTHETIC + " in the middle");
    if (redacted.includes(SYNTHETIC)) errors.push("invariant 17: a known value was not redacted from text");
    if (!redacted.includes("«secret:")) errors.push("invariant 17: redaction did not substitute a placeholder");

    // 18: a listing prefix must not match a sibling project by string prefix alone — at the store AND at
    // the vault, which re-checks rather than trusting the store's prefix semantics.
    memory.set("ProjectOS/polygo2/staging/github/gh-token", SYNTHETIC);
    const listed = memory.list("ProjectOS/polygo");
    if (listed.some((r) => r.startsWith("ProjectOS/polygo2/"))) errors.push("invariant 18: a prefix listing matched a sibling project");
    const permissiveStore = { name: "permissive", set: () => true, get: () => null, exists: () => true, del: () => true, list: () => ["ProjectOS/polygo2/staging/github/gh-token", "ProjectOS/polygo/staging/github/gh-token"] };
    const permissiveVault = createCredentialVault({ store: permissiveStore, stateDir: path.join(dir, "permissive") });
    if (permissiveVault.status({ project: "polygo" }).some((r) => r.project !== "polygo")) {
      errors.push("invariant 18: the vault trusted a store that over-matched the project prefix");
    }

    // 18b: a note containing credential-shaped text is refused rather than persisted next to the metadata.
    const meta = createMetadataStore({ stateDir: path.join(dir, "notes") });
    let noteRefused = false;
    try { meta.recordProvision("ProjectOS/polygo/staging/github/gh-token", SYNTHETIC, { note: "ghp_" + "a".repeat(36) }); }
    catch (e) { noteRefused = String(e.message).includes("credential-shaped"); }
    if (!noteRefused) errors.push("invariant 18b: a credential-shaped note was persisted into the metadata sidecar");

    // 18c: a credential may not be delivered under a reserved environment variable name.
    for (const reserved of ["PATH", "COMSPEC", "USERPROFILE"]) {
      if (!RESERVED_ENV_NAMES.has(reserved)) errors.push("invariant 18c: '" + reserved + "' is not on the reserved environment-name list");
    }
  });

  // 16: no endpoint / credential-shaped string / global auth mutation in the new sources.
  const forbiddenInSource = [
    { name: "http endpoint", re: /https?:\/\/(?!json-schema\.org|projectos\.local)/ },
    { name: "credential-shaped literal", re: /(gh[pousr]_[A-Za-z0-9]{20,}|sbp_[a-f0-9]{20,}|sk_(live|test)_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}\.)/ },
    { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  ];
  for (const rel of NEW_SOURCES) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const pattern of forbiddenInSource) {
      if (pattern.re.test(text)) errors.push("invariant 16: " + rel + " contains a " + pattern.name);
    }
    // `gh auth switch` may appear only in the refusal list that names it.
    const authSwitchLines = text.split("\n").filter((l) => l.includes("gh auth switch"));
    for (const line of authSwitchLines) {
      if (!/FORBIDDEN_COMMANDS|forbidden|refus/i.test(line)) errors.push("invariant 16: " + rel + " mentions 'gh auth switch' outside the refusal list");
    }
  }

  // 19: the registry enforces its adapter contract.
  for (const bad of [{}, { name: "x" }, { name: "x", envVars: ["A"] }, { name: "x", envVars: "A", validateConnection: () => [], buildVerificationPlan: () => ({}), evaluateObservation: () => ({}), projectEnvironment: () => ({}) }]) {
    let refused = false;
    try { createRegistry([bad]); } catch (e) { refused = true; }
    if (!refused) errors.push("invariant 19: the registry accepted an adapter that does not satisfy the contract");
  }

  // 20: every adapter's declared variables are in the scrub union.
  for (const name of registry.names()) {
    for (const envVar of registry.get(name).envVars) {
      if (!declared.has(envVar)) errors.push("invariant 20: " + name + " declares " + envVar + " but it is absent from the scrub union");
    }
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("val-projectos-credential-router-adversarial1a: " + e.length + " error(s)"); process.exit(1); }
  console.log("val-projectos-credential-router-adversarial1a: PASS");
}
module.exports = { run };
