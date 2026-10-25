"use strict";
/**
 * The declared trust boundary must be the one the code actually implements.
 *
 * A trust-boundary document is worthless the moment it becomes aspirational: it then reassures a
 * reader about a property nothing enforces. So this validator does two jobs. It checks the record's
 * SHAPE — every declared subject present, nothing on both sides of the line — and it checks a small
 * set of CODE FACTS that would have to change for the record to become false. If somebody moves
 * "Claude output" onto the trusted side, or makes policy readable from the working tree, or lets an
 * environment variable relocate the installation's own state, this fails.
 *
 * IT ADDS NO MECHANISM. Every fact checked here is already enforced elsewhere and already proven by
 * the agent test suite; this validator only refuses to let the description drift away from them.
 *
 * Written for PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A, section 4 of the gatekeeper ruling of
 * 2026-08-21.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const RECORD_REL = "projectos/security/trust-boundary.json";

/** Exactly what must be declared. A missing id is a silent narrowing of the boundary. */
const REQUIRED_TRUSTED = [
  "owner-windows-account",
  "projectos-installation",
  "committed-projectos-code",
  "installation-authority-state",
];
const REQUIRED_UNTRUSTED = [
  "external-governed-repositories",
  "claude-output",
  "project-worktree-changes",
  "model-text",
  "project-evidence-mirrors",
  "authored-plan-material",
];

function readSource(errors, rel) {
  const abs = path.join(ROOT, rel.split("/").join(path.sep));
  if (!fs.existsSync(abs)) {
    errors.push("missing source referenced by the trust boundary: " + rel);
    return null;
  }
  return fs.readFileSync(abs, "utf8");
}

/**
 * Strip comments so a claim in prose cannot satisfy a "code must contain" check.
 *
 * TRAILING COMMENTS COUNT. This stripped only comments that BEGAN a line, so `const x = 1; // HEAD:./`
 * satisfied the committed-read check, and the same trick worked for every other substring here. The
 * URL guard keeps `https://` from being mistaken for the start of a comment.
 */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Strip import statements too.
 *
 * A NAME IN AN IMPORT IS NOT A USE OF IT, and the ordering check below compares where two names first
 * appear. Both appear in the import block long before either is called, so the check was comparing two
 * import lines: reordering the imports turned it red, and moving the actual call sites past each other
 * left it green. It proved the opposite of nothing — it proved something irrelevant.
 */
function withoutImports(text) {
  return code(text)
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, "")
    .replace(/^import\s+['"][^'"]+['"];\s*$/gm, "");
}

/**
 * Is this name actually CALLED, as opposed to merely defined?
 *
 * A bare `indexOf("installationAllows(")` is satisfied by the line that DECLARES the function, so
 * deleting every call to it left the validator green — the same "a mention is not a use" mistake that
 * `withoutImports` exists to correct, one level down. A definition plus at least one call means the
 * name occurs more than once, and the declaration itself is excluded before counting.
 */
function isCalled(src, name) {
  // The marker goes INSIDE the name, so the declaration no longer contains `name(` at all. Putting it
  // in front left the substring intact and the check kept passing on the declaration alone.
  const broken = name.slice(0, 1) + "\u0000" + name.slice(1);
  const withoutDeclaration = src
    .split("function " + name + "(").join("function " + broken + "(")
    .split("const " + name + " = ").join("const " + broken + " = ");
  return withoutDeclaration.split(name + "(").length - 1 > 0;
}

function ids(list) {
  return Array.isArray(list) ? list.map((e) => (e && typeof e.id === "string" ? e.id : "")) : [];
}

function run() {
  const errors = [];
  const abs = path.join(ROOT, RECORD_REL.split("/").join(path.sep));
  if (!fs.existsSync(abs)) {
    errors.push("the trust-boundary record " + RECORD_REL + " does not exist");
    return errors;
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    errors.push("the trust-boundary record does not parse: " + e.message);
    return errors;
  }

  // ---- shape -------------------------------------------------------------------------------
  const trusted = ids(record.trusted);
  const untrusted = ids(record.untrusted);
  for (const id of REQUIRED_TRUSTED) {
    if (!trusted.includes(id)) errors.push("the trust boundary no longer declares '" + id + "' as trusted");
  }
  for (const id of REQUIRED_UNTRUSTED) {
    if (!untrusted.includes(id)) errors.push("the trust boundary no longer declares '" + id + "' as untrusted");
  }
  for (const id of trusted) {
    if (untrusted.includes(id)) errors.push("'" + id + "' is declared both trusted and untrusted");
  }
  for (const list of ["trusted", "untrusted", "outOfScope"]) {
    const entries = Array.isArray(record[list]) ? record[list] : [];
    if (entries.length === 0) errors.push("the trust boundary declares nothing under '" + list + "'");
    for (const e of entries) {
      if (!e || typeof e.subject !== "string" || e.subject.trim() === "") {
        errors.push("an entry under '" + list + "' names no subject");
      }
      // A boundary without reasons is a boundary nobody can argue with, or correct.
      if (!e || typeof e.why !== "string" || e.why.trim().length < 20) {
        errors.push("an entry under '" + list + "' gives no reason");
      }
    }
  }
  if (!record.selfHosted || record.selfHosted.projectId !== "projectos") {
    errors.push("the trust boundary does not declare the self-hosted project");
  }
  if (!record.external || typeof record.external.allowlist !== "string") {
    errors.push("the trust boundary does not say what governs external projects");
  }

  // ---- the code facts the record depends on -------------------------------------------------

  // committed-projectos-code: the installation allowlist is read from the object store, having first
  // established that the path is committed and unmodified. Reading the working tree would make an
  // uncommitted edit authoritative, which is the whole claim this entry makes.
  // THE TRUSTED SIDE IS THE ONE THAT DECIDES. This checked only the agent's copy — which the broker
  // itself calls "defence in depth, not the control" — so replacing the broker's committed read with a
  // plain working-tree read, the exact drift `committed-projectos-code` forbids, produced no error.
  const broker = readSource(errors, "projectos/security/gatekeeper-transport-broker.cjs");
  if (broker !== null) {
    const src = withoutImports(broker);
    if (!src.includes("HEAD:./")) {
      errors.push("the trusted broker no longer reads policy from the committed git object store");
    }
    if (!src.includes("--format=%H")) {
      errors.push("the trusted broker no longer checks that a policy file is committed");
    }
    if (!src.includes("--name-only")) {
      errors.push("the trusted broker no longer checks that a policy file is unmodified");
    }
    if (src.includes("readFileSync(path.join(root")) {
      errors.push("the trusted broker reads a policy file straight from the working tree");
    }
    // external: BOTH factors, and both on the trusted side.
    if (!isCalled(src, "installationAllows")) {
      errors.push("the trusted broker no longer consults the installation credential allowlist");
    }
    if (!isCalled(src, "ownerApproved")) {
      errors.push("the trusted broker no longer requires the project's own committed owner receipt");
    }
    // selfHosted: the identity is the authorised PATH as well as the origin.
    if (!isCalled(src, "samePath") || !isCalled(src, "checkoutShapeProblem")) {
      errors.push("the trusted broker no longer binds a project's identity to its authorised path");
    }
  }

  const allowlist = readSource(errors, "projectos/agent/src/installation/projectAllowlist.ts");
  if (allowlist !== null) {
    const src = withoutImports(allowlist);
    if (!src.includes("HEAD:./") || !src.includes("--format=%H") || !src.includes("--name-only")) {
      errors.push("the agent-side allowlist read is no longer bound to the committed tree");
    }
    if (!isCalled(src, "samePath") || !isCalled(src, "checkoutShapeProblem")) {
      errors.push("the agent-side identity check no longer requires the authorised path");
    }
  }
  if (record.external && typeof record.external.allowlist === "string") {
    const policy = path.join(ROOT, record.external.allowlist.split("/").join(path.sep));
    if (!fs.existsSync(policy)) {
      errors.push("the allowlist the trust boundary names does not exist: " + record.external.allowlist);
    }
  }

  // installation-authority-state: outside every repository, and not relocatable by environment. An
  // override would let anything that can set a variable point the sole authority at an empty
  // directory, and an empty ledger reads as "nothing was ever spent".
  const runtimeRoot = readSource(errors, "projectos/agent/src/nodeRuntimeRoot.ts");
  if (runtimeRoot !== null) {
    const src = withoutImports(runtimeRoot);
    if (src.includes("PROJECTOS_INSTALLATION_STATE_DIR")) {
      errors.push("an environment variable can relocate the installation's own state again");
    }
    if (!src.includes("LOCALAPPDATA")) {
      errors.push("the installation state directory is no longer derived from the user's application data");
    }
    // projectos-installation: located from its OWN module path, so a governed project cannot stand in
    // for it. Changing this to `process.cwd()` or to a caller-supplied value used to pass silently.
    if (!src.includes("import.meta.url")) {
      errors.push("the trusted installation is no longer located from its own module path");
    }
    if (src.includes("process.cwd()")) {
      errors.push("the trusted installation root can be taken from the ambient working directory");
    }
  }

  // project-evidence-mirrors: the gate reads the installation ledger first. If the block were derived
  // from the project's own files, deleting them would clear the debt — the exact defect the durable
  // ledger exists to close.
  const degraded = readSource(errors, "projectos/agent/src/loop/degradedMode.ts");
  if (degraded !== null) {
    const src = code(degraded);
    if (!src.includes("authoritativeState")) {
      errors.push("the reconciliation debt block no longer consults the installation ledger");
    }
  }

  // model-text: a verdict is honoured only after it is bound to project, phase, subject and request.
  const recon = readSource(errors, "projectos/agent/src/loop/reconciliation.ts");
  if (recon !== null) {
    const src = withoutImports(recon);
    // CALL SITES, NOT MENTIONS. The parenthesis is what makes it a use.
    const checked = src.indexOf("checkGatekeeperDecision(");
    const discharge = src.lastIndexOf("settleAsk(");
    if (checked === -1) {
      errors.push("a reconciliation no longer checks the decision against what was asked");
    }
    if (discharge === -1) {
      errors.push("a reconciliation no longer records its discharge in the installation ledger");
    }
    if (checked !== -1 && discharge !== -1 && checked > discharge) {
      errors.push("a reconciliation is recorded before its decision is checked");
    }
    // ASKED ONCE, BY WORK ITEM. Keyed on the request id alone, the guard was defeated by any change
    // to the evidence wording — including the one the mirror-free path introduced.
    if (!src.includes("askedWorkIds")) {
      errors.push("a second gatekeeper ask is no longer refused by the work item it is about");
    }
    // ONE WRITE, NOT TWO. The question and the discharge it authorises settle together, so there is no
    // state in which the ask is recorded and the accepted discharge is not — which used to leave a
    // paid-for, approved debt permanently unaskable.
    if (src.indexOf("settleAsk(") === -1) {
      errors.push("a gatekeeper call and its discharge are no longer settled together and durably");
    }
  }

  // credential-values: the raw value is resolved on the trusted side and leaves it only as an
  // outbound request header. The agent side asks the broker for an ANSWER, never for the value.
  if (broker !== null && !withoutImports(broker).includes("Authorization")) {
    errors.push("the trusted broker no longer sends the credential as a request header");
  }

  // ---- plan authoring: a second KIND of call, not a widened ask ------------------------------
  //
  // Everything below exists because the addition of authoring could go wrong in five specific ways,
  // each of which would look fine in a diff: the ask vocabulary could be widened so authoring
  // inherits phase gates; the second factor could be dropped so the installation allowlist alone
  // releases the credential; the binding could be dropped so a request need not say what it is for;
  // the ceiling could be taken from the record that asks for it; or the agent could start resolving
  // the credential itself. A record claiming otherwise is refused against the code that decides.
  const authoring = record.planAuthoring;
  if (!authoring || typeof authoring !== "object") {
    errors.push("the trust boundary does not declare the plan-authoring path");
  } else {
    const kinds = Array.isArray(authoring.requestKinds) ? authoring.requestKinds : [];
    for (const kind of ["gatekeeper", "plan-authoring"]) {
      if (!kinds.includes(kind)) errors.push("the trust boundary does not declare the '" + kind + "' request kind");
    }
    if (typeof authoring.permission !== "string" || !authoring.permission.startsWith(".projectops/")) {
      errors.push("the trust boundary names no committed plan-authoring permission record");
    }
    if (typeof authoring.spendKey !== "string" || !authoring.spendKey.startsWith("@")) {
      errors.push("the trust boundary names no authoring spend key that a phase id could not collide with");
    }
    if (typeof authoring.maxCallsPerProject !== "number" || authoring.maxCallsPerProject <= 0) {
      errors.push("the trust boundary declares no authoring call ceiling");
    }
  }

  if (broker !== null && authoring && typeof authoring === "object") {
    const src = withoutImports(broker);
    // THE SECOND FACTOR EXISTS AND IS CALLED. Without it the installation allowlist alone releases
    // the credential, and the governed project's own owner is no longer part of the decision.
    if (!isCalled(src, "authoringPermitted")) {
      errors.push("the trusted broker no longer requires the project's own committed authoring permission");
    }
    // AND IT IS THE COMMITTED ONE THE RECORD NAMES.
    if (src.indexOf(JSON.stringify(authoring.permission)) === -1) {
      errors.push("the trusted broker does not read the authoring permission the trust boundary names");
    }
    // THE BINDING EXISTS. A request that need not say what it is for is a request that can be about
    // anything, which is the substring-search defect this file already refuses on the review path.
    if (!isCalled(src, "authoringBindingProblem")) {
      errors.push("an authoring request is no longer bound to the project and objective it claims to be for");
    }
    // THE ASK VOCABULARY WAS NOT WIDENED. Authoring inheriting a phase-scoped gate it cannot satisfy
    // is the exact mistake the separate kind exists to prevent.
    const asks = /const KNOWN_ASKS = \[([\s\S]*?)\]/.exec(src);
    if (asks === null) {
      errors.push("the trusted broker no longer declares the asks it will pay for");
    } else if (asks[1].indexOf("plan-authoring") !== -1) {
      errors.push("plan authoring was added to KNOWN_ASKS, so it can take the gatekeeper's route");
    }
    // THE CEILING IS THE INSTALLATION'S. `Math.min` against the constant is what stops a committed
    // record authorising unbounded spend by writing a large number.
    if (src.indexOf("AUTHORING_CALL_CEILING = " + String(authoring.maxCallsPerProject)) === -1) {
      errors.push("the trusted broker's authoring ceiling is not the one the trust boundary declares");
    }
    // THE CLAMP, NOT THE FUNCTION. Checking for `Math.min` alone was satisfied by the timeout clamp
    // elsewhere in the same file, so deleting the ceiling clamp changed nothing this validator could
    // see — the "a mention is not a use" mistake this file already warns about, made one more time.
    // Found by mutation testing the check itself.
    if (src.indexOf("Math.min(Math.floor(asked), AUTHORING_CALL_CEILING)") === -1) {
      errors.push("a committed permission can now raise the installation's authoring ceiling");
    }
    // SPEND IS RESERVED BEFORE THE CREDENTIAL, for authoring exactly as for review.
    if (!isCalled(src, "reserveSpend")) {
      errors.push("the trusted broker no longer counts what it spends before it spends it");
    }
    if (src.indexOf(JSON.stringify(authoring.spendKey)) === -1) {
      errors.push("the trusted broker does not count authoring against the key the trust boundary names");
    }
  }

  // THE AGENT-SIDE COPY OF THE SAME CEILING, pinned to the same number. It exists so a refusal is
  // knowably pre-dispatch; a copy that drifted upward would let the agent admit calls the broker then
  // refuses, which is the confusing half of a failure rather than a safe one.
  const permissionSrc = readSource(errors, "projectos/agent/src/planAuthoringPermission.ts");
  if (permissionSrc !== null && authoring && typeof authoring === "object") {
    const src = withoutImports(permissionSrc);
    if (src.indexOf("PLAN_AUTHORING_CALL_CEILING = " + String(authoring.maxCallsPerProject)) === -1) {
      errors.push("the agent-side authoring ceiling is not the one the trust boundary declares");
    }
    if (src.indexOf("Math.min(Math.floor(asked), PLAN_AUTHORING_CALL_CEILING)") === -1) {
      errors.push("the agent-side check lets a committed permission raise the authoring ceiling");
    }
    if (src.indexOf("HEAD:./") === -1) {
      errors.push("the agent-side authoring permission is no longer read from the committed tree");
    }
  }

  // A CREDENTIAL REFERENCE IS A NAME, AND ALL THREE COPIES MUST AGREE WHAT A NAME LOOKS LIKE.
  //
  // `REF_SHAPE` now exists in three files: the trusted broker (which decides), the agent-side
  // permission check (which exists so a refusal is knowably pre-dispatch), and `credentialResolver`
  // (which refuses a secret sitting where a name belongs). Every OTHER duplicated authoring invariant
  // in this change is pinned here; this one was not, and a copy that drifted would either refuse
  // before dispatch what the broker would accept, or admit what the broker still refuses — the second
  // being a "this call was never made" promise the rest of the code relies on and would no longer
  // earn. Flagged by code review of this phase.
  const REF_SHAPE_LITERAL = "/^[A-Z][A-Z0-9_]{7,63}$/";
  for (const rel of [
    "projectos/security/gatekeeper-transport-broker.cjs",
    "projectos/agent/src/planAuthoringPermission.ts",
    "projectos/agent/src/loop/credentialResolver.ts",
  ]) {
    const text = readSource(errors, rel);
    if (text === null) continue;
    if (code(text).indexOf(REF_SHAPE_LITERAL) === -1) {
      errors.push(rel + " no longer agrees what a credential REFERENCE looks like");
    }
  }

  // credential-values, on the authoring path: the agent composes a BROKERED author and no other.
  // A resolver reaching the live composition would put the installation owner's key back inside the
  // process running generated code against an untrusted project — the whole reason the broker exists.
  const planCmd = readSource(errors, "projectos/agent/src/commands/plan.ts");
  if (planCmd !== null) {
    const src = withoutImports(planCmd);
    if (!isCalled(src, "brokeredAuthorPort")) {
      errors.push("the live author is no longer composed through the trusted broker");
    }
    if (src.indexOf("openAiAuthorPort") !== -1) {
      errors.push("the live author composition reaches the direct OpenAI port, which resolves a credential in the agent");
    }
    if (/Authorization|Bearer/i.test(src)) {
      errors.push("the agent-side authoring composition builds a provider authorization header");
    }
    if (!isCalled(src, "admitGatekeeperSpend")) {
      errors.push("an authoring call is no longer admitted against the owner's spend ceiling before it is made");
    }
    if (!isCalled(src, "checkPlanAuthoringPermission")) {
      errors.push("the agent no longer asks the committed authoring permission before invoking the broker");
    }
  }

  // The untrusted side of the authoring transport must not name a credential value either — the same
  // rule already applied to `brokeredHttpPort.ts`, applied to the module that builds the request.
  const authoringSrc = readSource(errors, "projectos/agent/src/planAuthoring.ts");
  if (authoringSrc !== null && /apiKey|credentialValue/i.test(code(authoringSrc))) {
    errors.push("the authoring transport names a credential value");
  }

  const port = readSource(errors, "projectos/agent/src/loop/transports/brokeredHttpPort.ts");
  if (port !== null && /secret|apiKey|credentialValue/i.test(code(port))) {
    errors.push("the untrusted side of the broker names a credential value again");
  }

  return errors;
}

module.exports = { run };
