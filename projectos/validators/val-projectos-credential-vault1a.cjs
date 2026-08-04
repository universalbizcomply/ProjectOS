"use strict";
/**
 * Proves the credential vault, reference, metadata and operation-gate invariants of
 * PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A. SYNTHETIC VALUES ONLY — no real credential, no provider
 * contact, no Windows Credential Manager access. If any invariant regresses, `run()` returns a non-empty
 * error list and validate-all fails.
 *
 * Invariants:
 *   1  a PolyGo session cannot authorise a JD Testing credential (cross-project refusal)
 *   2  a JD Testing session cannot authorise a BizComply credential
 *   3  risk classification is fail-closed: an unknown credential name is operation-class
 *   4  an operation-class credential can never be authorised for a session
 *   5  a missing credential fails closed with CREDENTIAL MISSING
 *   6  an operation-class credential requires an owner-confirmed permit
 *   7  a permit bound to another project/environment/reference is refused
 *   8  an expired permit is refused
 *   9  a hand-built look-alike grant is refused
 *  10  a grant is single-use
 *  11  the released value never appears in the vault audit trail
 *  12  the released value never appears in a status report or its serialisation
 *  13  the metadata file on disk never contains the value
 *  14  the metadata store refuses value-shaped fields and over-long notes
 *  15  fingerprints are stable, non-reversible and differ per value
 *  16  the operation gate refuses a secret-shaped command argument
 *  17  the operation gate never places the value in argv, and does place it in the child environment
 *  18  the operation gate returns an exit code and redacted output, never the value
 *  19  a prohibited provider action is refused before any credential is touched
 *  20  malformed references are refused at every entry point (fail closed, no throw-through)
 */

const fs = require("fs");
const path = require("path");
const scratch = require("./lib/scratch.cjs");

const { createCredentialVault } = require("../credentials/vault.cjs");
const { createMemoryCredentialStore } = require("../credentials/memory-credential-store.cjs");
const { createMetadataStore } = require("../credentials/credential-metadata.cjs");
const { createOperationGate } = require("../credentials/operation-gate.cjs");
const { parseReference, classifyRisk, fingerprint } = require("../credentials/reference.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const POLYGO_TOKEN = "synthetic-polygo-gh-token-000000";
const JDTESTING_TOKEN = "synthetic-jdtesting-gh-token-111";
const BIZCOMPLY_TOKEN = "synthetic-bizcomply-gh-token-222";
const SERVICE_ROLE = "synthetic-polygo-service-role-333";

const REF = {
  polygoGh: "ProjectOS/polygo/staging/github/gh-token",
  jdGh: "ProjectOS/jdtesting/staging/github/gh-token",
  bizGh: "ProjectOS/bizcomply/staging/github/gh-token",
  polygoServiceRole: "ProjectOS/polygo/production/supabase/service-role-key",
  absent: "ProjectOS/polygo/staging/vercel/vercel-token",
};

function seedVault(stateDir) {
  const redactor = createRedactor();
  const store = createMemoryCredentialStore({ acknowledgedNonPersistent: true });
  const vault = createCredentialVault({ store, redactor, stateDir });
  vault.provision({ reference: REF.polygoGh, readValue: () => POLYGO_TOKEN });
  vault.provision({ reference: REF.jdGh, readValue: () => JDTESTING_TOKEN });
  vault.provision({ reference: REF.bizGh, readValue: () => BIZCOMPLY_TOKEN });
  vault.provision({ reference: REF.polygoServiceRole, readValue: () => SERVICE_ROLE });
  return { vault, store, redactor };
}

function expectThrow(errors, label, fn, expectedFragment) {
  try {
    fn();
    errors.push(label + ": expected a refusal, but the call succeeded");
  } catch (e) {
    const message = String(e && e.message ? e.message : e);
    if (expectedFragment && !message.includes(expectedFragment)) {
      errors.push(label + ": refused for the wrong reason — " + message);
    }
  }
}

function run() {
  const errors = [];
  scratch.withScratch("credential-vault", (dir) => {
    const { vault, store } = seedVault(dir);

    // 1 / 2: cross-project authorisation is refused before the store is consulted.
    expectThrow(errors, "invariant 1", () => vault.authoriseSessionRelease({ reference: REF.jdGh, projectId: "polygo" }), "another project");
    expectThrow(errors, "invariant 2", () => vault.authoriseSessionRelease({ reference: REF.bizGh, projectId: "jdtesting" }), "another project");

    // 3: fail-closed classification.
    if (classifyRisk("gh-token") !== "session") errors.push("invariant 3: gh-token is not session-class");
    for (const name of ["db-password", "service-role-key", "production-deploy-token", "totally-new-credential"]) {
      if (classifyRisk(name) !== "operation") errors.push("invariant 3: '" + name + "' is not operation-class");
    }

    // 4: an operation-class credential can never be authorised for a session.
    expectThrow(errors, "invariant 4", () => vault.authoriseSessionRelease({ reference: REF.polygoServiceRole, projectId: "polygo" }), "operation-class");

    // 5: missing credential fails closed.
    expectThrow(errors, "invariant 5", () => vault.authoriseSessionRelease({ reference: REF.absent, projectId: "polygo" }), "CREDENTIAL MISSING");

    // 6: operation-class release requires an owner-confirmed permit.
    const goodPermit = { permitId: "permit_test", projectId: "polygo", environment: "production", reference: REF.polygoServiceRole, expiresAtMs: Date.now() + 60000 };
    expectThrow(errors, "invariant 6a", () => vault.authoriseOperationRelease({ reference: REF.polygoServiceRole, projectId: "polygo", permit: goodPermit, capability: {} }), "OWNER PERMIT REQUIRED");
    expectThrow(errors, "invariant 6b", () => vault.authoriseOperationRelease({ reference: REF.polygoServiceRole, projectId: "polygo", permit: null, capability: { ownerConfirmation: true } }), "OWNER PERMIT REQUIRED");

    // 7: permit binding must match exactly.
    for (const bad of [
      { ...goodPermit, projectId: "jdtesting" },
      { ...goodPermit, environment: "staging" },
      { ...goodPermit, reference: REF.polygoGh },
    ]) {
      expectThrow(errors, "invariant 7", () => vault.authoriseOperationRelease({ reference: REF.polygoServiceRole, projectId: "polygo", permit: bad, capability: { ownerConfirmation: true } }), "OWNER PERMIT REQUIRED");
    }

    // 8: expired permit.
    expectThrow(errors, "invariant 8", () => vault.authoriseOperationRelease({ reference: REF.polygoServiceRole, projectId: "polygo", permit: { ...goodPermit, expiresAtMs: Date.now() - 1 }, capability: { ownerConfirmation: true } }), "OWNER PERMIT REQUIRED");

    // 9: a hand-built look-alike grant is not redeemable.
    const realGrant = vault.authoriseSessionRelease({ reference: REF.polygoGh, projectId: "polygo" });
    const forged = { ...realGrant, grantId: "grant_forged" };
    expectThrow(errors, "invariant 9", () => vault.releaseIntoChildEnvironment(forged), "not recognised");

    // 10: single use.
    const released = vault.releaseIntoChildEnvironment(realGrant);
    if (released !== POLYGO_TOKEN) errors.push("invariant 10: the released value was not the provisioned value");
    expectThrow(errors, "invariant 10", () => vault.releaseIntoChildEnvironment(realGrant), "already used");

    // 11: no value in the audit trail.
    const auditText = JSON.stringify(vault.getAuditLog());
    for (const [label, value] of [["polygo", POLYGO_TOKEN], ["jdtesting", JDTESTING_TOKEN], ["bizcomply", BIZCOMPLY_TOKEN], ["service-role", SERVICE_ROLE]]) {
      if (auditText.includes(value)) errors.push("invariant 11: the " + label + " value appears in the audit trail");
    }
    try { vault.assertNoValueInAudit(); } catch (e) { errors.push("invariant 11: " + e.message); }

    // 12: no value in a status report.
    const statusText = JSON.stringify(vault.status({}));
    for (const value of [POLYGO_TOKEN, JDTESTING_TOKEN, BIZCOMPLY_TOKEN, SERVICE_ROLE]) {
      if (statusText.includes(value)) errors.push("invariant 12: a credential value appears in the status report");
    }
    if (!statusText.includes(fingerprint(POLYGO_TOKEN))) errors.push("invariant 12: the status report does not carry the expected fingerprint");

    // 13: no value in the metadata file on disk.
    const metadataFile = path.join(dir, "credential-metadata.json");
    if (!fs.existsSync(metadataFile)) errors.push("invariant 13: no metadata file was written");
    else {
      const onDisk = fs.readFileSync(metadataFile, "utf8");
      for (const value of [POLYGO_TOKEN, JDTESTING_TOKEN, BIZCOMPLY_TOKEN, SERVICE_ROLE]) {
        if (onDisk.includes(value)) errors.push("invariant 13: a credential value was written to the metadata file");
      }
    }

    // 14: the metadata store refuses value-shaped fields and over-long notes.
    const meta = createMetadataStore({ stateDir: dir });
    for (const field of ["value", "secret", "password", "token", "key"]) {
      expectThrow(errors, "invariant 14 (" + field + ")", () => meta.recordProvision(REF.polygoGh, POLYGO_TOKEN, { [field]: "x" }), "refusing to persist");
    }
    expectThrow(errors, "invariant 14 (note)", () => meta.recordProvision(REF.polygoGh, POLYGO_TOKEN, { note: "n".repeat(500) }), "non-secret length limit");

    // 15: fingerprints are stable, distinct, and do not contain the value.
    if (fingerprint(POLYGO_TOKEN) !== fingerprint(POLYGO_TOKEN)) errors.push("invariant 15: fingerprint is not stable");
    if (fingerprint(POLYGO_TOKEN) === fingerprint(JDTESTING_TOKEN)) errors.push("invariant 15: two different values share a fingerprint");
    if (fingerprint(POLYGO_TOKEN).includes(POLYGO_TOKEN.slice(0, 6))) errors.push("invariant 15: the fingerprint leaks value material");

    // 16-18: operation gate.
    const spawnCalls = [];
    const gate = createOperationGate({
      vault,
      spawnSync: (command, args, options) => {
        spawnCalls.push({ command, args, env: options.env });
        // A hostile child that echoes its own credential must still not reach the caller unredacted.
        return { status: 0, stdout: "using " + options.env.SUPABASE_SERVICE_ROLE_KEY + "\n", stderr: "" };
      },
    });
    const permit = gate.grantPermit({ reference: REF.polygoServiceRole, action: "read-config", capability: { ownerConfirmation: true } });

    const withSecretArg = gate.run({
      reference: REF.polygoServiceRole, action: "read-config", permit, capability: { ownerConfirmation: true },
      command: "node", args: ["--token=" + SERVICE_ROLE], envVarName: "SUPABASE_SERVICE_ROLE_KEY",
    });
    if (withSecretArg.ok !== false) errors.push("invariant 16: a secret-shaped command argument was not refused");
    if (spawnCalls.length !== 0) errors.push("invariant 16: a command ran despite a secret-shaped argument");

    // 16b: a reserved environment variable name is refused — a credential must never be delivered as PATH.
    const permitReserved = gate.grantPermit({ reference: REF.polygoServiceRole, action: "read-config", capability: { ownerConfirmation: true } });
    const reserved = gate.run({
      reference: REF.polygoServiceRole, action: "read-config", permit: permitReserved, capability: { ownerConfirmation: true },
      command: "node", args: ["--version"], envVarName: "PATH",
    });
    if (reserved.ok !== false) errors.push("invariant 16b: a reserved environment variable name was accepted");

    // 16c: an unresolvable command is refused BEFORE the single-use grant is spent.
    const permitMissing = gate.grantPermit({ reference: REF.polygoServiceRole, action: "read-config", capability: { ownerConfirmation: true } });
    const unresolvable = gate.run({
      reference: REF.polygoServiceRole, action: "read-config", permit: permitMissing, capability: { ownerConfirmation: true },
      command: "projectos-command-that-does-not-exist", args: [], envVarName: "SUPABASE_SERVICE_ROLE_KEY",
    });
    if (unresolvable.blocker !== "COMMAND NOT EXECUTABLE") errors.push("invariant 16c: an unresolvable command was not refused (got " + String(unresolvable.blocker) + ")");
    if (spawnCalls.length !== 0) errors.push("invariant 16c: a command ran despite being unresolvable");

    // 18b: output is WITHHELD by default — the caller must opt in to see it at all.
    const permitQuiet = gate.grantPermit({ reference: REF.polygoServiceRole, action: "read-config", capability: { ownerConfirmation: true } });
    const quiet = gate.run({
      reference: REF.polygoServiceRole, action: "read-config", permit: permitQuiet, capability: { ownerConfirmation: true },
      command: "node", args: ["--version"], envVarName: "SUPABASE_SERVICE_ROLE_KEY",
    });
    if (quiet.outputWithheld !== true || quiet.stdout !== "") errors.push("invariant 18b: operation output was returned without an explicit opt-in");
    if (String(JSON.stringify(quiet)).includes(SERVICE_ROLE)) errors.push("invariant 18b: the credential appeared in a withheld-output result");
    spawnCalls.length = 0;

    const permit2 = gate.grantPermit({ reference: REF.polygoServiceRole, action: "read-config", capability: { ownerConfirmation: true } });
    const result = gate.run({
      reference: REF.polygoServiceRole, action: "read-config", permit: permit2, capability: { ownerConfirmation: true },
      command: "node", args: ["--version"], envVarName: "SUPABASE_SERVICE_ROLE_KEY", includeOutput: true,
    });
    if (spawnCalls.length !== 1) errors.push("invariant 17: expected exactly one command to run, saw " + spawnCalls.length);
    else {
      const call = spawnCalls[0];
      if (JSON.stringify(call.args).includes(SERVICE_ROLE)) errors.push("invariant 17: the credential appeared in the command arguments");
      if (call.env.SUPABASE_SERVICE_ROLE_KEY !== SERVICE_ROLE) errors.push("invariant 17: the credential did not reach the child environment");
      if (Object.prototype.hasOwnProperty.call(call.env, "GH_TOKEN")) errors.push("invariant 17: the child environment inherited an unrelated provider variable");
    }
    if (result.exitCode !== 0) errors.push("invariant 18: expected exit code 0, saw " + String(result.exitCode));
    if (String(result.stdout).includes(SERVICE_ROLE)) errors.push("invariant 18: the credential survived into the returned output");
    if (!String(result.stdout).includes("«secret:")) errors.push("invariant 18: the returned output was not redacted");
    if (JSON.stringify(gate.getAuditLog()).includes(SERVICE_ROLE)) errors.push("invariant 18: the credential appears in the operation-gate audit log");

    // 19: a prohibited provider action is refused before any credential is touched.
    const before = spawnCalls.length;
    const prohibited = gate.run({
      reference: REF.polygoServiceRole, action: "mutate-production-db", permit: permit2, capability: { ownerConfirmation: true },
      command: "node", args: ["--version"], envVarName: "SUPABASE_SERVICE_ROLE_KEY", includeOutput: true,
    });
    if (prohibited.ok !== false || prohibited.blocker !== "PRODUCTION PROFILE REFUSED") errors.push("invariant 19: a prohibited provider action was not refused");
    if (spawnCalls.length !== before) errors.push("invariant 19: a command ran for a prohibited action");

    // 20: malformed references fail closed everywhere.
    const malformed = ["", "ProjectOS/polygo", "ProjectOS/polygo/staging/github", "Other/polygo/staging/github/gh-token", "ProjectOS/polygo/nonsense/github/gh-token", "ProjectOS/../../etc/passwd/x", "ProjectOS/polygo/staging/github/gh-token/extra"];
    for (const bad of malformed) {
      if (parseReference(bad).ok) errors.push("invariant 20: parseReference accepted '" + bad + "'");
      expectThrow(errors, "invariant 20 (vault)", () => vault.present({ reference: bad }));
      expectThrow(errors, "invariant 20 (store)", () => store.get(bad));
    }
  });
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("val-projectos-credential-vault1a: " + e.length + " error(s)"); process.exit(1); }
  console.log("val-projectos-credential-vault1a: PASS");
}
module.exports = { run };
