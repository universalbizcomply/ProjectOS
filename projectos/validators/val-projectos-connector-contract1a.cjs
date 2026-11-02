"use strict";
/**
 * THE CONNECTOR CONTRACT — PROJECTOS-CONNECTOR-CONTRACT1A (V4 Stage 2, owner decision D5).
 *
 * The rules every connector will have to pass, with no connector yet. Nothing runs against these rules
 * until Stage 5, so they are all there is, and each way of softening them reads reasonably in a diff:
 *
 *   CC-1  "the entry parsed, so it is all there"     — and a declared field never reaches the gate
 *   CC-2  "it will be the owner's"                   — and a connector has no tenant at all
 *   CC-3  "the secret can be wired later"            — and the entry names nothing to release
 *   CC-4  "it passed last time"                      — and a connector registers with no passing record
 *   CC-5  "it is only a reference field"             — and a raw credential sits in a committed file
 *   CC-6  "any reference will do"                    — and a connector reads another tenant's secret
 *   CC-7  "a pass is a pass"                         — and a record for another connector qualifies this one
 *   CC-8  "accepted once, accepted for good"         — and a future date hides staleness for ever
 *   CC-9  "be liberal in what you accept"            — and tenantOverride becomes a habit
 *   CC-10 "use the good lines"                       — and a bad line leaves the rest live
 *   CC-11 "an unknown action is probably harmless"   — and R5 is gone for connectors
 *   CC-12 "it says read-only"                        — and the class is said, not looked up
 *   CC-13 "map it to something friendly"             — and a timeout on a write reads as safe to retry
 *   CC-14 "the retry will sort it out"               — and a charge or a message goes out twice
 *   CC-15 "we checked, it is fine"                   — and nothing records who checked, or on what
 *   CC-16 "retry everything the same way"            — and a refusal is retried without end
 *   CC-17 "skip the line it cannot read"             — and that line was the one that mattered
 *   CC-18 "keep the response for debugging"          — and a payload or a secret lands in the audit trail
 *   CC-19 "the receipt is from the connector"        — and one tenant's receipt closes another's work
 *   CC-20 "the eight will pass when we get there"    — and a definition is counted as a pass
 *   CC-21 "the connector is registered, so it is fine" — and one tenant's work uses another's connector
 *   CC-22 "the shape is the proof"                   — and a forged envelope reaches a provider
 *   CC-23 "nobody will edit it"                      — and a value changes after it was judged
 *   CC-24 "pure enough"                              — and the contract reads the clock, or the network
 *   CC-25 "one connector will not hurt"              — and a live connector arrives without its phase
 *   CC-26 "the schema is documentation"              — and it describes a different registry from the code
 *   CC-27 "register it later"                        — and nothing ever runs this file
 *   CC-28 "the tests exist"                          — and `.skip` keeps the proof while dropping the run
 *   CC-29 "the reader validates the file"            — and the committed file is broken on arrival
 *
 * Added in the review round (ECC SECURITY, ECC CODE):
 *
 *   CC-30 "it will write the receipt afterwards"     — and a crash after the write is retried
 *   CC-31 "a reconciliation is a reconciliation"     — and an old answer clears a new unknown, or anyone answers
 *   CC-32 "the last line says where it stands"       — and a later rate limit reopens a refused key
 *   CC-33 "it is in the registry, so a connector can hold it" — and a connector holds approve
 *   CC-34 "it said it succeeded"                     — and missing-evidence cannot be enforced
 *   CC-35 "refused is refused"                       — and a duplicate gets no earlier outcome
 *   CC-36 "it was valid when we looked"              — and a getter answers differently the second time
 *   CC-37 "show the value in the message"            — and a credential lands in a log
 *
 * THE RULES ARE RUN, NOT READ, as in val-projectos-port-context1a. Node 24 strips the types, so `load` copies
 * the real source to a scratch directory and imports it, and each probe calls the real function with the real
 * committed registries and the real door. A named mutation changes the source in memory and is loaded the same
 * way. It counts as killed only when EXACTLY its own rule fires, plus any rule declared as also true of it, so
 * an earlier check cannot take the credit. Every refusal has a positive control beside it.
 *
 * Comments are stripped before any "must be absent" scan. Fixture credentials are assembled from pieces at run
 * time and are not credentials. Reads files; runs nothing outside its scratch directory.
 */

const fs = require("fs");
const path = require("path");
const scratch = require("./lib/scratch.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-connector-contract1a";
const SRC = "projectos/core/src";
const CONTRACT = `${SRC}/connectorContract.ts`;
const ACTION = `${SRC}/actionRegistry.ts`;
const TENANT = `${SRC}/tenant.ts`;
const ENVELOPE = `${SRC}/taskEnvelope.ts`;
const LOADED = [CONTRACT, ACTION, TENANT, ENVELOPE, `${SRC}/ownerOnlyActions.ts`, `${SRC}/permissions.ts`, `${SRC}/types.ts`, `${SRC}/context/redact.ts`, `${SRC}/memory/store.ts`];
const BARREL = `${SRC}/index.ts`;
const AREG = "projectos/security/action-registry.json";
const TREG = "projectos/security/tenant-registry.json";
const REGISTRY = "projectos/connectors/registry.json";
const SCHEMA = "projectos/schemas/connector-registry.schema.json";
const REFERENCE = "projectos/credentials/reference.cjs";
const VA = "projectos/validators/validate-all.cjs";
const CR = "projectos/speed/cached-runner.cjs";
const TEST_FILE = "projectos/core/test/connector-contract.test.ts";
const SOURCES = [...LOADED, BARREL, AREG, TREG, REGISTRY, SCHEMA, REFERENCE, VA, CR, TEST_FILE];

const RULE_NAMES = {
  "CC-1": "a complete entry registers with what it declared",
  "CC-2": "a connector with no declared tenant is refused",
  "CC-3": "a connector with no secret reference is refused",
  "CC-4": "a connector with no passing release record is refused",
  "CC-5": "a raw credential in the reference field is refused, and not repeated",
  "CC-6": "a reference has the store's shape and the connector's own tenant",
  "CC-7": "a release record binds its connector, version, tenant and date",
  "CC-8": "acceptance is judged per connector against time handed in",
  "CC-9": "an unknown field is refused",
  "CC-10": "the file is judged whole",
  "CC-11": "an unregistered action is P5 and refused",
  "CC-12": "read-only is checked against the action registry",
  "CC-13": "the error vocabulary is closed",
  "CC-14": "a retry after outcome_unknown is refused until reconciled",
  "CC-15": "reconciliation is explicit and leaves evidence",
  "CC-16": "every other code has its stated retry rule",
  "CC-17": "history that cannot be trusted fails closed",
  "CC-18": "a receipt has the standard fields and no room for content",
  "CC-19": "a receipt must match its admitted call",
  "CC-20": "nine scenarios are defined, one proved, none counted as passed",
  "CC-21": "cross-tenant denial holds at the gate",
  "CC-22": "the gate takes only what was admitted",
  "CC-23": "no input is mutated, and what comes back is frozen",
  "CC-24": "the contract stays pure",
  "CC-25": "zero live connectors",
  "CC-26": "the schema agrees with the code",
  "CC-27": "the contract is exported and this validator registered",
  "CC-28": "the proofs exist and run",
  "CC-29": "the committed registry passes the real reader",
  "CC-30": "a start with no valid receipt is outcome_unknown",
  "CC-31": "a reconciliation answers one attempt, through an admitted envelope",
  "CC-32": "a stop reads the whole history",
  "CC-33": "a connector may hold only what the door allows it",
  "CC-34": "a success points at its provider receipt",
  "CC-35": "a duplicate returns the earlier outcome",
  "CC-36": "everything is judged on a plain copy, and only that comes back",
  "CC-37": "no refusal repeats a value that could be a credential",
};

const CHECKLIST = [
  "provider-identity", "actions-and-scopes-documented", "authentication-and-revocation", "tenant-and-resource-bound",
  "read-and-write-verified", "denied-actions-fail", "rate-limits-and-retries", "provider-receipts", "audit-logs", "operational-owner",
];
const SCENARIOS = [
  "cross-tenant-denial", "duplicate-webhook-delivery", "expired-approval", "token-revocation",
  "prompt-injection-in-retrieved-content", "process-crash-after-write", "cancellation", "missing-evidence", "provider-outage",
];
const ERROR_CODES = ["authentication_required", "permission_denied", "rate_limited", "invalid_input", "approval_required", "upstream_unavailable", "outcome_unknown"];
const RETRY_TABLE = {
  authentication_required: "after-reauthentication", permission_denied: "never", rate_limited: "after-backoff", invalid_input: "never",
  approval_required: "after-approval", upstream_unavailable: "after-backoff", outcome_unknown: "after-reconciliation",
};

/** A proof that does not run proves nothing, and its name still satisfies a needle. */
const NOT_RUN = /\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|fails|skipIf|runIf)\b|\.(?:skip|only)\(|\b(?:xit|fit|xdescribe|fdescribe)\(/;
const NEEDLES = [
  "the committed registry is empty and valid: zero live connectors",
  "a complete entry is accepted: the positive control for every refusal below",
  "malformed input fails closed: %s",
  "an unknown field in %s is refused",
  "a wildcard in %s is named as a wildcard, ahead of the shape rule that would also refuse it",
  "one bad line refuses the good lines too: no registry is returned",
  "a connector with no tenant is refused, by name",
  "a connector with no secret reference is refused, by name",
  "a connector with no release record is refused, by name",
  "%s in the reference field is refused as a raw credential, and not repeated",
  "a reference to %s is refused: a connector reads only its own tenant",
  "%s is not a passing record",
  "a release record for %s is refused",
  "holds on the last day and lapses one millisecond later",
  "an acceptance dated after now is refused: a future date must not hide staleness",
  "a lapsed acceptance blocks that connector and leaves the other tenant working",
  "an unregistered action is P5 and refuses the entry",
  "an action dropped from the registry after registration is P5 and refused at the gate",
  "is exactly the seven codes of the contract",
  "the unknown code %j is refused, never mapped to a friendly one",
  "states a retry rule for every code, and names each one",
  "a retry after outcome_unknown is refused until reconciled",
  "a later failure does not clear an unreconciled unknown: it stays until reconciled",
  "a success after an unknown does not clear it: no later line says what the first write did",
  "the same key through another connector of the tenant is still refused",
  "history that is %s fails closed",
  "leaves evidence: what was found, on what, and which admitted envelope said so",
  "takes tenant, connector and action from the attempt: nothing the caller says can move them",
  "fails closed today: the committed action registry does not register its action",
  "a copy of a reconciliation answers nothing: the second unknown stays open",
  "a start with no receipt counts as outcome_unknown: a crash after the write stops the retry",
  "a refused receipt leaves the start open, so the retry stays stopped",
  "a second admit that sees the first start is stopped",
  "%s stops the key across the whole history: a later rate limit does not reopen it",
  "the door would refuse %s to a connector, by its own rule %s, so it cannot register",
  "a duplicate returns the earlier outcome (ADR-K1 §2), not a bare refusal",
  "a value that could be a credential is never repeated by a refusal",
  "what comes back is only the plain copy: a getter cannot change its answer after the check",
  "%s is refused: reconciliation is explicit or it did not happen",
  "the field %s is refused: a receipt has no room for content",
  "a credential fits the name shape of %s, and is still refused",
  "a receipt whose tenant differs from the envelope is refused",
  "a call the gate did not admit proves nothing: a perfect copy is refused",
  "the same tenant is admitted: the pair that lets this proof fail",
  "an envelope of one tenant cannot use a connector of the other, in either direction",
  "two tenants in the same domain are refused on the tenant alone",
  "a forged envelope is refused: shape is not admission",
  "are defined as data, exactly the nine the blueprint requires",
  "the other eight are defined, first run in Stage 5, and carry no proof",
  "the tally never counts a defined scenario as passed",
  "what comes back is frozen all the way down, and shares nothing with the input",
];

/** Every way a module names another: `import x from`, `export x from`, and the bare `import 'x'`. */
const SPECIFIERS = [/^\s*import\s*['"]([^'"]+)['"]/gm, /^\s*import\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, /^\s*export\b[^'"=]*?\bfrom\s*['"]([^'"]+)['"]/gm];
const PURE_IMPORTS = ["./actionRegistry.js", "./context/redact.js", "./taskEnvelope.js", "./tenant.js"];
const IMPURE = /\bprocess\s*[.[]|\bperformance\s*[.[]|\bglobalThis\b|\bglobal\s*[.[]|\bimport\s*\(|\bimport\.meta\b|\brequire\(|\beval\(|\bnew Function\b|Date\.now|new Date\(\)|Math\.random|\bfetch\(|\bconsole\.|\breadFile|\bwriteFile|\bexecSync|\bspawn\(/;

// ---------------------------------------------------------------------------------------------------------
// Reading and loading the real source
// ---------------------------------------------------------------------------------------------------------

const normalise = (text) => text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? normalise(fs.readFileSync(abs, "utf8")) : null;
}

/** Strip comments outside strings: the same walk `val-projectos-tenant-contract1a` uses. */
function code(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function jsonOf(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The list between `const MODULES = [` and its closing bracket, comments already stripped. */
function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  if (start < 0) return null;
  const end = text.indexOf("\n];", start);
  return end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const scratchPath = (rel) => `core/${rel.slice(SRC.length + 1).replace(/\.ts$/, ".mts")}`;
const rewriteImports = (text) => text.replace(/(from\s+['"]\.{1,2}\/[A-Za-z/]+)\.js(['"])/g, "$1.mts$2");

let loadCount = 0;
/** Copy these sources to a fresh directory, and import the real modules from it. */
function load(dir, sources) {
  const base = path.join(dir, `v${loadCount++}`);
  for (const rel of LOADED) {
    const abs = path.join(base, ...scratchPath(rel).split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, rewriteImports(sources[rel]));
  }
  const module = (name) => require(path.join(base, "core", `${name}.mts`));
  return { ...module("actionRegistry"), ...module("tenant"), ...module("taskEnvelope"), ...module("connectorContract") };
}

// ---------------------------------------------------------------------------------------------------------
// The fixtures: real committed registries, the real door
// ---------------------------------------------------------------------------------------------------------

const NOW = "2026-11-01T12:00:00.000Z";
const LATER = "2026-11-01T13:00:00.000Z";
const FAR = "2027-12-01T00:00:00.000Z";
const ACCEPTED = "2026-10-15T09:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
const after = (ms) => new Date(Date.parse(ACCEPTED) + ms).toISOString();
const KEY = `sha256:${"b".repeat(64)}`;
const OTHER_KEY = `sha256:${"c".repeat(64)}`;
const NO_FACTS = { reauthenticated: false, approved: false };
const ACTOR = { agent: "claude-code-cli", provider: "anthropic", model: "claude-opus-5-5" };
const OWNER_FACTS = { projectId: "polygo", repository: "github.com/polygonia-apres/polygo", root: "C:/dev/Polygo/polygo", worktrees: null };
const AGENCY_FACTS = { projectId: "seo-agency", repository: "127.0.0.1:47900/SEOAgency-remote/seo-agency", root: "C:/dev/SEOAgency", worktrees: null };
const FAKE_PREFIXED = ["sk", "ant", "api03", "abcdefghij", "klmnopqrst", "uvwxyz0123"].join("-");
const FAKE_BARE = "a1B2".repeat(10);
const FAKE_JWT = ["eyJ", "abcdefghij_klmnopqrst", ".", "b".repeat(12)].join("");
const FAKE_UUID = ["550e8400", "e29b", "41d4", "a716", "446655440000"].join("-");
const FAKE_SPLIT = ["abcdefgh", "ijklmnop", "qrstuvwx", "yz012345"].join("-");
const FAR_DATE = "+010000-01-01T00:00:00.000Z";
const REFERENCE_OF = (segment, credential = "mail-refresh") => `ProjectOS/${segment}/production/google/${credential}`;

function kit(m, raw) {
  const unwrap = (parsed, label) => {
    if (!parsed.ok) throw new Error(`${label}: ${parsed.problems.map((problem) => problem.message).join("; ")}`);
    return parsed.registry;
  };
  const actionsRaw = jsonOf(raw[AREG]);
  let cachedActions = null;
  const actions = () => (cachedActions ??= unwrap(m.parseActionRegistry(actionsRaw), "action registry"));
  const actionsPlus = (id, cls) =>
    unwrap(m.parseActionRegistry({ ...actionsRaw, actions: [...actionsRaw.actions, { id, governanceAction: null, ownerOnlyAction: null, class: cls, environment: "production" }] }), "action registry");
  let cachedTenants = null;
  const tenants = () => (cachedTenants ??= unwrap(m.parseTenantRegistry(jsonOf(raw[TREG])), "tenant registry"));
  const scenarioIds = () => m.ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id);
  const release = (over = {}) => ({
    connectorId: "fixture-mail", version: "1.0.0", tenant: "agency-business", result: "passed", acceptedAt: ACCEPTED,
    checklist: [...m.RELEASE_CHECKLIST], scenarios: scenarioIds(), evidence: "docs/finish/FIXTURE-CONNECTOR.md", ...over,
  });
  const entry = (over = {}) => ({
    connectorId: "fixture-mail", version: "1.0.0", tenant: "agency-business", domain: "business", scopes: ["mail.read"],
    secretReference: REFERENCE_OF("tenant.agency-business"), dataCategories: ["enquiry-text"], idempotency: "read-only",
    actions: ["bridge-read"], lastAcceptanceDate: ACCEPTED, releaseRecord: release(), ...over,
  });
  const ownerEntry = (over = {}) =>
    entry({
      connectorId: "fixture-calendar", tenant: "owner-personal", domain: "develop", secretReference: REFERENCE_OF("tenant.owner-personal", "calendar-refresh"),
      releaseRecord: release({ connectorId: "fixture-calendar", tenant: "owner-personal" }), ...over,
    });
  const file = (connectors, over = {}) => ({
    schemaVersion: "1.0.0", policy: "connector-registry", note: "Fixture.", authority: "owner", authorisedBy: "Murad",
    provenance: "Fixture.", trustBasis: "Fixture.", connectors, ...over,
  });
  const parse = (rawFile, actionRegistry = actions()) => m.parseConnectorRegistry(rawFile, { actions: actionRegistry, tenants: tenants() });
  const codes = (rawFile, actionRegistry) => {
    const parsed = parse(rawFile, actionRegistry);
    return parsed.ok ? [] : parsed.problems.map((problem) => problem.code);
  };
  const registry = (connectors, actionRegistry) => unwrap(parse(file(connectors), actionRegistry), "connector registry");
  const binding = (facts) => {
    const resolved = m.resolveTenant(tenants(), facts);
    if (!resolved.ok) throw new Error(resolved.reasons.join("; "));
    return resolved.binding;
  };
  let nextId = 1;
  const REQUEST = { action: "bridge-read", subjectHash: "a".repeat(40), scope: ["mail"], budget: 0, expiry: LATER, intentScope: "RUN-1" };
  const mint = (facts, request = {}, actionRegistry = actions(), principal = "implementer") =>
    m.mintEnvelope({ binding: binding(facts), registry: actionRegistry, principal, actor: ACTOR, envelopeId: `ENV-${String(nextId++).padStart(24, "0")}` }, { ...REQUEST, ...request });
  const envelope = (facts, request, actionRegistry, principal) => {
    const admission = m.admitEnvelope(mint(facts, request, actionRegistry, principal), NOW, () => true, () => true);
    if (!admission.admitted) throw new Error(admission.reasons.join("; "));
    return admission.envelope;
  };
  const agency = (request, actionRegistry) => envelope(AGENCY_FACTS, request, actionRegistry);
  const owner = (request, actionRegistry, principal) => envelope(OWNER_FACTS, request, actionRegistry, principal);
  const gate = (over = {}) =>
    m.admitConnectorCall({ registry: registry([entry()]), actions: actions(), connectorId: "fixture-mail", envelope: agency(), history: [], facts: NO_FACTS, now: NOW, ...over });
  const call = (over) => {
    const admission = gate(over);
    if (!admission.admitted) throw new Error(admission.reasons.join("; "));
    return admission.call;
  };
  const receipt = (over = {}) => ({ tenant: "agency-business", connector: "fixture-mail", action: "bridge-read", idempotencyKey: KEY, attempt: 1, outcome: "succeeded", errorCode: null, providerReceipt: "provider:receipt-77", ...over });
  const failed = (errorCode, over = {}) => receipt({ outcome: "failed", errorCode, providerReceipt: null, ...over });
  const unknown = (over = {}) => receipt({ outcome: "unknown", errorCode: "outcome_unknown", providerReceipt: null, ...over });
  const started = (attempt, over = {}) => ({ tenant: "agency-business", connector: "fixture-mail", action: "bridge-read", idempotencyKey: KEY, attempt, envelopeId: `ENV-${"a".repeat(24)}`, ...over });
  const reconciliation = (finding, over = {}) => ({
    tenant: "agency-business", connector: "fixture-mail", action: "bridge-read", idempotencyKey: KEY, finding, evidence: "provider:message-4471",
    reconciledBy: "implementer", reconcilerEnvelope: `ENV-${"c".repeat(24)}`, reconciledAt: NOW, ...over,
  });
  /** Lines as the gate and a connector leave them: each receipt gets its start, each reconciliation the latest attempt. */
  const story = (steps) => {
    if (!Array.isArray(steps)) return steps;
    let attempt = 0;
    return [...steps].flatMap((step) => {
      if (typeof step !== "object" || step === null) return [step];
      if ("finding" in step) return [{ attempt, ...step }];
      if ("envelopeId" in step) return [step];
      attempt += 1;
      return [started(attempt, { tenant: step.tenant, connector: step.connector, action: step.action, idempotencyKey: step.idempotencyKey }), { ...step, attempt }];
    });
  };
  const raw2 = (history, facts = NO_FACTS, key = KEY, tenant = "agency-business") => m.decideConnectorRetry(history, key, tenant, facts);
  const decide = (history, facts, key) => raw2(story(history), facts, key);
  let cachedReconcile = null;
  const reconcileActions = () => (cachedReconcile ??= actionsPlus(m.CONNECTOR_RECONCILE_ACTION, "P2"));
  const reconciler = (request = {}) => agency({ action: m.CONNECTOR_RECONCILE_ACTION, ...request }, reconcileActions());
  const asking = (over = {}) => ({ idempotencyKey: KEY, finding: "not_completed", evidence: "provider:message-4471", envelope: reconciler(), actions: reconcileActions(), now: NOW, ...over });
  const reconcile = (history, over) => m.reconcileConnectorOutcome(history, asking(over));
  return {
    actions, actionsPlus, tenants, release, entry, ownerEntry, file, parse, codes, registry, binding, mint, agency, owner, gate, call,
    receipt, failed, unknown, started, reconciliation, story, raw2, decide, reconcileActions, reconciler, asking, reconcile,
  };
}

const deepFreeze = (value) => {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// ---------------------------------------------------------------------------------------------------------
// The probes: every rule, called on the loaded code
// ---------------------------------------------------------------------------------------------------------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shows = (result) => JSON.stringify(result);
const refused = (E, result, code, label) => {
  const got = result.code ?? (result.ok ? "accepted" : "?");
  if (got !== code) E(`${label}: wanted ${code}, got ${got}`);
};
const refusedBy = (E, codes, code, label) => {
  if (!codes.includes(code)) E(`${label}: wanted ${code}, got ${codes.join(", ") || "accepted"}`);
};

const PROBES = [
  ["CC-1", (k, E) => {
    const declared = k.entry();
    const parsed = k.parse(k.file([declared, k.ownerEntry()]));
    if (!parsed.ok) return E("a complete registry was refused");
    const connector = parsed.registry.connectors[0];
    for (const field of ["connectorId", "version", "tenant", "domain", "scopes", "secretReference", "dataCategories", "idempotency", "actions", "lastAcceptanceDate"]) {
      if (!same(connector[field], declared[field])) E(`${field} did not reach the registry as declared`);
    }
    for (const field of Object.keys(declared.releaseRecord)) {
      if (!same(connector.releaseRecord[field], declared.releaseRecord[field])) E(`releaseRecord.${field} did not reach the registry as declared`);
    }
    if (parsed.registry.connectors.length !== 2) E("a connector was dropped");
  }],
  ["CC-2", (k, E) => {
    refusedBy(E, k.codes(k.file([k.entry({ tenant: undefined })])), "CONNECTOR_TENANT_MISSING", "no tenant");
    refusedBy(E, k.codes(k.file([k.entry({ tenant: "" })])), "CONNECTOR_TENANT_MISSING", "a blank tenant");
    refusedBy(E, k.codes(k.file([k.entry({ tenant: "someone-else", releaseRecord: k.release({ tenant: "someone-else" }) })])), "CONNECTOR_TENANT_UNKNOWN", "an undeclared tenant");
  }],
  ["CC-3", (k, E) => {
    for (const value of [undefined, " ", 7]) refusedBy(E, k.codes(k.file([k.entry({ secretReference: value })])), "CONNECTOR_SECRET_MISSING", `the reference ${shows(value)}`);
  }],
  ["CC-4", (k, E, m) => {
    if (!same([...m.RELEASE_CHECKLIST], CHECKLIST)) E("the release checklist is not the blueprint's ten items");
    for (const value of [undefined, null, "passed"]) refusedBy(E, k.codes(k.file([k.entry({ releaseRecord: value })])), "CONNECTOR_RELEASE_MISSING", `the record ${shows(value)}`);
    const list = [...m.RELEASE_CHECKLIST];
    const ids = m.ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id);
    const rows = {
      "a failed result": { result: "failed" }, "no result": { result: undefined }, "a truthy result": { result: true },
      "a checklist item missing": { checklist: list.slice(1) }, "a repeated checklist item": { checklist: [...list.slice(1), list[1]] },
      "an extra checklist item": { checklist: [...list, "looked-fine"] }, "a scenario missing": { scenarios: ids.slice(1) },
      "an extra scenario": { scenarios: [...ids, "looked-fine"] }, "no evidence": { evidence: "" }, "prose evidence": { evidence: "it worked here" },
      "a word for evidence": { evidence: "nothing" }, "evidence holding a credential": { evidence: `provider:${FAKE_PREFIXED}` }, "evidence holding a long run": { evidence: `provider:${FAKE_BARE}` },
    };
    for (const [label, over] of Object.entries(rows)) refusedBy(E, k.codes(k.file([k.entry({ releaseRecord: k.release(over) })])), "CONNECTOR_RELEASE_NOT_PASSED", label);
  }],
  ["CC-5", (k, E) => {
    const values = [FAKE_PREFIXED, FAKE_JWT, REFERENCE_OF("tenant.agency-business", FAKE_PREFIXED), REFERENCE_OF("tenant.agency-business", FAKE_BARE), REFERENCE_OF("tenant.agency-business", FAKE_UUID), REFERENCE_OF("tenant.agency-business", FAKE_SPLIT), `ProjectOS/tenant.agency-business/production/${FAKE_BARE}/mail-refresh`];
    for (const value of values) {
      const parsed = k.parse(k.file([k.entry({ secretReference: value })]));
      if (parsed.ok) { E("a credential in the reference field was accepted"); continue; }
      refusedBy(E, parsed.problems.map((problem) => problem.code), "CONNECTOR_SECRET_VALUE", "a credential in the reference field");
      if (shows(parsed.problems).includes(value)) E("a refusal repeated the credential");
    }
    if (k.codes(k.file([k.entry({ secretReference: REFERENCE_OF("tenant.agency-business", "production-deploy-token") })])).length !== 0) E("a credential name of ordinary words was refused");
  }],
  ["CC-6", (k, E) => {
    const bad = (value, entry = k.entry) => k.codes(k.file([entry({ secretReference: value })]));
    for (const value of ["ProjectOS/tenant.agency-business/google", "Vault/tenant.agency-business/production/google/mail-refresh", "ProjectOS/tenant.agency-business/live/google/mail-refresh", "ProjectOS/tenant.agency-business/production/../mail-refresh", "OPENAI_GATEKEEPER_KEY"]) {
      refusedBy(E, bad(value), "CONNECTOR_SECRET_REFERENCE_INVALID", value);
    }
    for (const segment of ["tenant.owner-personal", "polygo", "unlisted", "TENANT.owner-personal"]) refusedBy(E, bad(REFERENCE_OF(segment)), "CONNECTOR_SECRET_WRONG_TENANT", segment);
    refusedBy(E, k.codes(k.file([k.ownerEntry({ domain: "personal", secretReference: REFERENCE_OF("polygo") })])), "CONNECTOR_SECRET_WRONG_TENANT", "a project of another domain");
    for (const segment of ["seo-agency", "Tenant.agency-business"]) if (bad(REFERENCE_OF(segment)).length !== 0) E(`'${segment}' is this tenant's and was refused`);
  }],
  ["CC-7", (k, E) => {
    const rows = { "connector": { connectorId: "fixture-other" }, "version": { version: "0.9.0" }, "tenant": { tenant: "owner-personal" }, "date": { acceptedAt: "2026-10-14T09:00:00.000Z" } };
    for (const [label, over] of Object.entries(rows)) refusedBy(E, k.codes(k.file([k.entry({ releaseRecord: k.release(over) })])), "CONNECTOR_RELEASE_MISMATCH", `a record for another ${label}`);
    refusedBy(E, k.codes(k.file([k.entry({ version: "1.1.0" })])), "CONNECTOR_RELEASE_MISMATCH", "a new version under the old record");
  }],
  ["CC-8", (k, E, m) => {
    const connector = k.registry([k.entry()]).connectors[0];
    const maxMs = 90 * DAY_MS;
    if (m.CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS !== 90) E("the acceptance window is not the stated 90 days");
    if (m.connectorAcceptanceRefusal(connector, after(maxMs)) !== null) E("the last day was refused");
    if (m.connectorAcceptanceRefusal(connector, after(maxMs + 1)) === null) E("one millisecond past the window was accepted");
    if (m.connectorAcceptanceRefusal(connector, after(-1)) === null) E("an acceptance dated after now was accepted");
    for (const now of ["soon", "2026-11-01", ""]) if (m.connectorAcceptanceRefusal(connector, now) === null) E(`the time ${shows(now)} was accepted`);
    refused(E, k.gate({ envelope: k.agency({ expiry: FAR }), now: after(maxMs + 1) }), "CONNECTOR_ACCEPTANCE_STALE", "a stale connector at the gate");
    const lapsed = "2026-07-01T00:00:00.000Z";
    const mixed = k.parse(k.file([k.entry({ lastAcceptanceDate: lapsed, releaseRecord: k.release({ acceptedAt: lapsed }) }), k.ownerEntry()]));
    if (!mixed.ok) return E("a lapsed connector refused the whole file: one tenant's lapse stopped the other's");
    refused(E, k.gate({ registry: mixed.registry }), "CONNECTOR_ACCEPTANCE_STALE", "the lapsed connector");
    if (!k.gate({ registry: mixed.registry, connectorId: "fixture-calendar", envelope: k.owner() }).admitted) E("the other tenant's connector stopped working");
  }],
  ["CC-9", (k, E) => {
    const rows = {
      "the header": k.file([], { tenantOverride: "owner-personal" }),
      "an entry": k.file([k.entry({ tenantOverride: "owner-personal" })]),
      "a release record": k.file([k.entry({ releaseRecord: k.release({ reviewerOverride: true }) })]),
    };
    for (const [label, raw] of Object.entries(rows)) refusedBy(E, k.codes(raw), "CONNECTOR_REGISTRY_INVALID", `an unknown field in ${label}`);
    const polluted = JSON.parse(JSON.stringify(k.file([k.entry()])).replace('"connectorId":"fixture-mail"', '"__proto__":{"tenant":"owner-personal"},"connectorId":"fixture-mail"'));
    refusedBy(E, k.codes(polluted), "CONNECTOR_REGISTRY_INVALID", "a field named __proto__");
  }],
  ["CC-10", (k, E) => {
    const { connectors: _gone, ...noList } = k.file([]);
    const malformed = ["text", [], null, noList, k.file([], { connectors: {} }), k.file([], { schemaVersion: "2.0.0" }), k.file([], { policy: "tenant-registry" }), k.file([], { authority: " " }), k.file(["fixture-mail"])];
    for (const raw of malformed) refusedBy(E, k.codes(raw), "CONNECTOR_REGISTRY_INVALID", `malformed ${shows(raw).slice(0, 50)}`);
    const shapes = [{ connectorId: "fixture mail" }, { version: "latest" }, { domain: "everything" }, { scopes: "mail.read" }, { scopes: [] }, { scopes: new Array(2) }, { scopes: [7] },
      { scopes: ["mail read"] }, { dataCategories: [] }, { dataCategories: ["enquiry text"] }, { idempotency: "best-effort" }, { idempotency: undefined }, { actions: [] }, { actions: ["Bridge Read"] }, { lastAcceptanceDate: "last week" },
      { lastAcceptanceDate: FAR_DATE, releaseRecord: k.release({ acceptedAt: FAR_DATE }) },
      { lastAcceptanceDate: "2026-02-31T00:00:00.000Z", releaseRecord: k.release({ acceptedAt: "2026-02-31T00:00:00.000Z" }) }];
    for (const over of shapes) refusedBy(E, k.codes(k.file([k.ownerEntry(), k.entry(over)])), "CONNECTOR_REGISTRY_INVALID", `the bad value ${shows(over)}`);
    for (const over of [{ connectorId: "fixture-*" }, { scopes: ["mail.*"] }, { dataCategories: ["enquiry-?"] }, { actions: ["bridge-*"] }, { tenant: "agency-*" }]) {
      refusedBy(E, k.codes(k.file([k.entry(over)])), "CONNECTOR_REGISTRY_WILDCARD", `the wildcard ${shows(over)}`);
    }
    refusedBy(E, k.codes(k.file([k.entry(), k.entry()])), "CONNECTOR_REGISTRY_DUPLICATE", "a connector twice");
    for (const over of [{ scopes: ["mail.read", "mail.read"] }, { dataCategories: ["enquiry-text", "enquiry-text"] }, { actions: ["bridge-read", "bridge-read"] }]) {
      refusedBy(E, k.codes(k.file([k.entry(over)])), "CONNECTOR_REGISTRY_DUPLICATE", `the repeat ${shows(over)}`);
    }
    if (k.parse(k.file([k.ownerEntry(), k.entry({ tenant: undefined })])).ok) E("one bad line left the good line live");
  }],
  ["CC-11", (k, E) => {
    const writes = (over) => k.entry({ idempotency: "provider-key", ...over });
    const parsed = k.parse(k.file([writes({ actions: ["send-the-email"] })]));
    if (parsed.ok) E("an unregistered action was accepted");
    else {
      const problem = parsed.problems.find((candidate) => candidate.code === "CONNECTOR_ACTION_UNREGISTERED");
      if (problem === undefined) E("an unregistered action was not refused by name");
      else if (!problem.message.includes("P5")) E("an unregistered action was not called P5");
    }
    for (const action of ["bridge_read", "constructor"]) if (!same(k.codes(k.file([writes({ actions: [action] })])), ["CONNECTOR_ACTION_UNREGISTERED"])) E(`the near miss ${action} is not exactly unregistered`);
    const forged = { actions: [{ id: "bridge-read", governanceAction: null, ownerOnlyAction: null, actionClass: "P1", environment: "local" }] };
    refusedBy(E, k.codes(k.file([k.entry()]), forged), "CONNECTOR_ACTION_UNREGISTERED", "an unvalidated action registry");
    const wider = k.actionsPlus("fixture-read", "P1");
    const admission = k.gate({ registry: k.registry([k.entry({ actions: ["fixture-read"] })], wider), actions: k.actions(), envelope: k.agency({ action: "fixture-read" }, wider) });
    refused(E, admission, "CONNECTOR_ACTION_UNREGISTERED", "an action dropped after registration");
    if (admission.admitted || !admission.reasons.join(" ").includes("P5")) E("the gate did not call the dropped action P5");
  }],
  ["CC-12", (k, E) => {
    refusedBy(E, k.codes(k.file([k.entry({ actions: ["bridge-read", "generate_report"] })])), "CONNECTOR_IDEMPOTENCY_MISMATCH", "a P2 action under read-only");
    if (k.codes(k.file([k.entry({ idempotency: "provider-key", actions: ["bridge-read", "generate_report"] })])).length !== 0) E("the same actions under provider-key were refused");
    const wider = k.actionsPlus("fixture-read", "P1");
    const moved = k.gate({ registry: k.registry([k.entry({ actions: ["fixture-read"] })], wider), actions: k.actionsPlus("fixture-read", "P3"), envelope: k.agency({ action: "fixture-read" }, wider) });
    refused(E, moved, "CONNECTOR_IDEMPOTENCY_MISMATCH", "an action that moved from P1 to P3");
  }],
  ["CC-13", (k, E, m) => {
    if (!same([...m.CONNECTOR_ERROR_CODES], ERROR_CODES)) E("the vocabulary is not exactly the seven codes");
    for (const code of ERROR_CODES) if (!same(m.parseConnectorError(code), { ok: true, code })) E(`${code} did not parse as itself`);
    for (const value of ["timeout", "Rate_Limited", "rate_limited ", "unknown", "constructor", "__proto__", "", 7, null, undefined, { code: "rate_limited" }]) {
      const parsed = m.parseConnectorError(value);
      if (parsed.ok || parsed.code !== "CONNECTOR_ERROR_UNKNOWN") E(`the unknown code ${shows(value)} was ${shows(parsed)}`);
    }
  }],
  ["CC-14", (k, E) => {
    refused(E, k.decide([k.unknown()]), "RETRY_UNRECONCILED", "a retry after unknown");
    refused(E, k.decide([k.unknown()], { reauthenticated: true, approved: true }), "RETRY_UNRECONCILED", "a retry with every fact");
    refused(E, k.decide([k.unknown(), k.failed("rate_limited")]), "RETRY_UNRECONCILED", "a later failure");
    refused(E, k.decide([k.unknown(), k.receipt()]), "RETRY_UNRECONCILED", "a later success");
    refused(E, k.decide([k.unknown(), k.reconciliation("not_completed"), k.unknown()]), "RETRY_UNRECONCILED", "a second unknown");
    if (!same(k.decide([k.unknown()], NO_FACTS, OTHER_KEY), { allowed: true, attempt: 1, rule: "first-attempt" })) E("another key's unknown blocked this key");
    const envelope = k.agency();
    const history = k.story([k.unknown({ idempotencyKey: envelope.idempotencyKey })]);
    refused(E, k.gate({ envelope, history }), "RETRY_UNRECONCILED", "the gate");
    const second = k.agency();
    if (second.idempotencyKey !== envelope.idempotencyKey) E("the same intent got a new key");
    refused(E, k.gate({ envelope: second, history }), "RETRY_UNRECONCILED", "a new envelope for the same intent");
    const sibling = k.registry([k.entry(), k.entry({ connectorId: "fixture-mail-two", releaseRecord: k.release({ connectorId: "fixture-mail-two" }) })]);
    refused(E, k.gate({ registry: sibling, connectorId: "fixture-mail-two", envelope, history }), "RETRY_UNRECONCILED", "the same key through a sibling connector");
  }],
  ["CC-15", (k, E, m) => {
    const history = deepFreeze(k.story([k.unknown()]));
    const envelope = k.reconciler();
    const result = k.reconcile(history, { envelope });
    if (!result.ok) return E("a sound reconciliation was refused");
    const wanted = { ...k.reconciliation("not_completed"), attempt: 1, reconciledBy: envelope.principal, reconcilerEnvelope: envelope.envelopeId };
    if (Object.keys(result.record).length !== Object.keys(wanted).length || Object.keys(wanted).some((field) => result.record[field] !== wanted[field])) E("the record does not say what was found, on what, and by which envelope");
    if (result.history.length !== 3 || !same(result.history[1], history[1])) E("the reconciliation did not append to the history");
    if (!same(k.raw2(result.history), { allowed: true, attempt: 2, rule: "after-reconciliation" })) E("not_completed did not open the retry");
    refused(E, k.decide([k.unknown(), k.reconciliation("completed")]), "RETRY_ALREADY_COMPLETED", "completed");
    const moved = k.reconcile(k.story([k.unknown()]), { tenant: "owner-personal", connector: "other", action: "broker-call" });
    if (!moved.ok || moved.record.tenant !== "agency-business" || moved.record.connector !== "fixture-mail" || moved.record.action !== "bridge-read") E("the caller moved the tenant, connector or action");
    for (const lines of [[], k.story([k.failed("rate_limited")]), k.story([k.receipt()]), k.story([k.unknown(), k.reconciliation("not_completed")])]) {
      refused(E, k.reconcile(lines), "RECONCILE_NOTHING_OPEN", `${lines.length} lines`);
    }
    for (const evidence of ["", "looked fine to me", "nothing", `provider:${FAKE_PREFIXED}`, `provider:${FAKE_BARE}`, 7]) refused(E, k.reconcile(k.story([k.unknown()]), { evidence }), "RECONCILE_EVIDENCE_REQUIRED", `the evidence ${shows(evidence)}`);
    refused(E, k.reconcile(k.story([k.unknown()]), { finding: "probably" }), "RECONCILE_INVALID", "an unknown finding");
    refused(E, k.reconcile(["ok"]), "RETRY_HISTORY_INVALID", "malformed history");
  }],
  ["CC-16", (k, E, m) => {
    if (!same({ ...m.CONNECTOR_RETRY_RULES }, RETRY_TABLE)) E("the retry table is not the stated one");
    for (const code of ["permission_denied", "invalid_input"]) refused(E, k.decide([k.failed(code)], { reauthenticated: true, approved: true }), "RETRY_NEVER", code);
    for (const code of ["rate_limited", "upstream_unavailable"]) if (!same(k.decide([k.failed(code)]), { allowed: true, attempt: 2, rule: "after-backoff" })) E(`${code} is not retried after backoff`);
    refused(E, k.decide([k.failed("authentication_required")], { reauthenticated: false, approved: true }), "RETRY_NEEDS_REAUTHENTICATION", "no re-authentication");
    if (!same(k.decide([k.failed("authentication_required")], { reauthenticated: true, approved: false }), { allowed: true, attempt: 2, rule: "after-reauthentication" })) E("re-authentication did not open the retry");
    refused(E, k.decide([k.failed("approval_required")], { reauthenticated: true, approved: false }), "RETRY_NEEDS_APPROVAL", "no approval");
    if (!same(k.decide([k.failed("approval_required")], { reauthenticated: false, approved: true }), { allowed: true, attempt: 2, rule: "after-approval" })) E("an approval did not open the retry");
    for (const fact of [1, "yes", null]) refused(E, k.decide([k.failed("approval_required")], { reauthenticated: false, approved: fact }), "RETRY_NEEDS_APPROVAL", `the fact ${shows(fact)}`);
    for (const fact of [1, "yes", null]) refused(E, k.decide([k.failed("authentication_required")], { reauthenticated: fact, approved: false }), "RETRY_NEEDS_REAUTHENTICATION", `the fact ${shows(fact)}`);
    refused(E, k.decide([k.receipt()]), "RETRY_ALREADY_COMPLETED", "a success");
    if (m.CONNECTOR_MAX_ATTEMPTS !== 5) E("attempts are not bounded at the stated 5");
    const edge = Array.from({ length: 4 }, () => k.failed("rate_limited"));
    if (!same(k.decide(edge), { allowed: true, attempt: 5, rule: "after-backoff" })) E("the last attempt was refused or miscounted");
    refused(E, k.decide([...edge, k.failed("rate_limited")]), "RETRY_ATTEMPTS_EXHAUSTED", "one attempt too many");
    if (!same(k.decide([]), { allowed: true, attempt: 1, rule: "first-attempt" })) E("a new key is not a first attempt");
    const envelope = k.agency();
    if (k.gate({ envelope, history: k.story([k.failed("rate_limited", { idempotencyKey: envelope.idempotencyKey })]) }).call?.attempt !== 2) E("the gate did not carry the attempt");
  }],
  ["CC-17", (k, E) => {
    const rows = {
      "not a list": { lines: [] }, "a sparse list": new Array(1), "a line that is not a record": ["ok"],
      "an unknown code under another key": k.story([k.failed("timeout", { idempotencyKey: OTHER_KEY })]),
      "a reconciliation with no evidence": k.story([k.unknown(), k.reconciliation("not_completed", { evidence: "" })]),
      "a reconciliation with an unknown field": k.story([k.unknown(), k.reconciliation("not_completed", { note: "x" })]),
      "a reconciliation with a free-text reconciler": k.story([k.unknown(), k.reconciliation("not_completed", { reconciledBy: "looked at it" })]),
      "a reconciliation naming no envelope": k.story([k.unknown(), k.reconciliation("not_completed", { reconcilerEnvelope: "owner" })]),
      "a key crossing tenants": k.story([k.failed("rate_limited"), k.failed("rate_limited", { tenant: "owner-personal" })]),
      "a key crossing actions": k.story([k.failed("rate_limited"), k.failed("rate_limited", { action: "broker-call" })]),
    };
    for (const [label, history] of Object.entries(rows)) refused(E, k.raw2(history), "RETRY_HISTORY_INVALID", label);
    refused(E, k.raw2([], NO_FACTS, "RUN-1"), "RETRY_KEY_INVALID", "a malformed key");
    const envelope = k.agency();
    refused(E, k.gate({ envelope, history: k.story([k.failed("rate_limited", { tenant: "owner-personal", idempotencyKey: envelope.idempotencyKey })]) }), "RETRY_HISTORY_INVALID", "a line of another tenant at the gate");
  }],
  ["CC-18", (k, E, m) => {
    if (!same(m.parseConnectorReceipt(k.receipt()), { ok: true, receipt: k.receipt() })) E("a sound receipt was refused or changed");
    if (!m.parseConnectorReceipt(k.failed("rate_limited")).ok) E("a sound failure was refused");
    if (!m.parseConnectorReceipt(k.unknown()).ok) E("a sound unknown was refused");
    for (const field of ["payload", "body", "secret", "providerResponse", "credential"]) refused(E, m.parseConnectorReceipt(k.receipt({ [field]: "x" })), "RECEIPT_INVALID", `the field ${field}`);
    for (const field of ["tenant", "connector", "action", "idempotencyKey", "attempt", "outcome", "errorCode", "providerReceipt"]) {
      const { [field]: _gone, ...rest } = k.receipt();
      refused(E, m.parseConnectorReceipt(rest), "RECEIPT_INVALID", `no ${field}`);
    }
    const smuggled = { tenant: "Dear customer", connector: "not a name", action: "send the email", idempotencyKey: "RUN-1", outcome: "done", attempt: "first" };
    for (const [field, value] of Object.entries(smuggled)) refused(E, m.parseConnectorReceipt(k.receipt({ [field]: value })), "RECEIPT_INVALID", `the ${field} ${value}`);
    for (const field of ["tenant", "connector", "action"]) {
      const result = m.parseConnectorReceipt(k.receipt({ [field]: FAKE_PREFIXED }));
      refused(E, result, "RECEIPT_INVALID", `a credential as the ${field}`);
      if (shows(result).includes(FAKE_PREFIXED)) E("a refusal repeated the credential");
    }
    for (const raw of ["ok", [], null]) refused(E, m.parseConnectorReceipt(raw), "RECEIPT_INVALID", shows(raw));
    refused(E, m.parseConnectorReceipt(k.failed("timeout")), "RECEIPT_ERROR_CODE_UNKNOWN", "an unknown code");
    const lies = [k.receipt({ errorCode: "rate_limited" }), k.receipt({ outcome: "failed", errorCode: null }), k.receipt({ outcome: "failed", errorCode: "outcome_unknown" }),
      k.receipt({ errorCode: "outcome_unknown" }), k.receipt({ outcome: "unknown", errorCode: "rate_limited" }), k.receipt({ outcome: "unknown", errorCode: null })];
    for (const raw of lies) refused(E, m.parseConnectorReceipt(raw), "RECEIPT_INVALID", `${raw.outcome}/${raw.errorCode}`);
  }],
  ["CC-19", (k, E, m) => {
    const envelope = k.agency();
    const presented = (over = {}) => k.receipt({ idempotencyKey: envelope.idempotencyKey, ...over });
    const call = k.call({ envelope });
    if (!m.checkConnectorReceipt(presented(), call).ok) E("a receipt matching its call was refused");
    refused(E, m.checkConnectorReceipt(presented({ tenant: "owner-personal" }), call), "RECEIPT_TENANT_MISMATCH", "another tenant");
    for (const over of [{ connector: "fixture-other" }, { action: "broker-call" }, { idempotencyKey: OTHER_KEY }, { attempt: 2 }]) refused(E, m.checkConnectorReceipt(presented(over), call), "RECEIPT_CALL_MISMATCH", shows(over));
    refused(E, m.checkConnectorReceipt(presented(), { ...call }), "RECEIPT_CALL_UNADMITTED", "a copied call");
    refused(E, m.checkConnectorReceipt(presented({ payload: "x" }), call), "RECEIPT_INVALID", "a malformed receipt");
  }],
  ["CC-20", (k, E, m) => {
    const all = m.ACCEPTANCE_SCENARIOS;
    if (!same(all.map((scenario) => scenario.id), SCENARIOS)) E("the scenarios are not exactly the blueprint's nine");
    if (all.some((scenario) => typeof scenario.given !== "string" || scenario.given.trim() === "" || typeof scenario.expect !== "string" || scenario.expect.trim() === "")) E("a scenario does not say what is done and what must hold");
    const [first, ...rest] = all;
    if (first === undefined || first.id !== "cross-tenant-denial" || first.status !== "proved" || first.firstRun !== "stage-2" || first.proof !== TEST_FILE) E("cross-tenant denial is not the one proved here");
    if (rest.some((scenario) => scenario.status !== "defined" || scenario.firstRun !== "stage-5" || scenario.proof !== null)) E("a scenario beyond the first is not defined, Stage 5, with no proof");
    if (!same(m.scenarioTally(), { total: all.length, proved: all.filter((scenario) => scenario.status === "proved").length, defined: all.filter((scenario) => scenario.status === "defined").length })) E("the tally does not count the table");
    if (Object.keys(m.scenarioTally()).includes("passed")) E("the tally counts passes");
    if (!Object.isFrozen(all) || !all.every((scenario) => Object.isFrozen(scenario))) E("the scenario table can be edited in place");
  }],
  ["CC-21", (k, E) => {
    const both = k.registry([k.entry(), k.ownerEntry()]);
    if (!k.gate({ registry: both, envelope: k.agency() }).admitted) E("the same tenant was refused");
    if (!k.gate({ registry: both, connectorId: "fixture-calendar", envelope: k.owner() }).admitted) E("the same tenant was refused, the other way");
    refused(E, k.gate({ registry: both, envelope: k.owner() }), "CONNECTOR_CROSS_TENANT", "owner work on an agency connector");
    refused(E, k.gate({ registry: both, connectorId: "fixture-calendar", envelope: k.agency() }), "CONNECTOR_CROSS_TENANT", "agency work on an owner connector");
    refused(E, k.gate({ registry: both, envelope: k.owner(undefined, undefined, "owner") }), "CONNECTOR_CROSS_TENANT", "the owner's own work");
    // Only the tenant differs here. Every pair above also differs in domain, so without this the domain check would pass for the tenant rule.
    const sameDomain = k.registry([k.ownerEntry({ domain: "business" })]);
    refused(E, k.gate({ registry: sameDomain, connectorId: "fixture-calendar", envelope: k.agency() }), "CONNECTOR_CROSS_TENANT", "two tenants in one domain");
    refused(E, k.gate({ registry: k.registry([k.ownerEntry({ domain: "personal" })]), connectorId: "fixture-calendar", envelope: k.owner() }), "CONNECTOR_CROSS_TENANT", "another domain of the same tenant");
    refused(E, k.gate({ registry: both, envelope: k.owner({ action: "cross-tenant-access" }) }), "CONNECTOR_CROSS_TENANT", "an admitted cross-tenant envelope");
  }],
  ["CC-22", (k, E) => {
    const real = k.registry([k.entry()]);
    refused(E, k.gate({ registry: { ...real } }), "CONNECTOR_REGISTRY_INVALID", "a copied registry");
    refused(E, k.gate({ connectorId: "fixture-unknown" }), "CONNECTOR_UNKNOWN", "an unlisted connector");
    refused(E, k.gate({ envelope: { ...k.agency() } }), "CONNECTOR_ENVELOPE_NOT_ADMITTED", "a copied envelope");
    const minted = k.mint(AGENCY_FACTS);
    refused(E, k.gate({ envelope: minted.envelope }), "CONNECTOR_ENVELOPE_NOT_ADMITTED", "a minted envelope the door never saw");
    refused(E, k.gate({ now: LATER }), "CONNECTOR_ENVELOPE_EXPIRED", "an expired envelope");
    refused(E, k.gate({ envelope: k.agency({ action: "project-selection" }) }), "CONNECTOR_ACTION_UNDECLARED", "an undeclared action");
    const envelope = k.agency();
    const call = k.call({ envelope });
    if (call.envelope !== envelope || call.connector.connectorId !== "fixture-mail" || call.attempt !== 1) E("the admitted call does not carry its envelope, connector and attempt");
  }],
  ["CC-23", (k, E, m) => {
    const raw = deepFreeze(k.file([k.entry()]));
    const before = JSON.stringify(raw);
    const parsed = k.parse(raw);
    if (!parsed.ok || JSON.stringify(raw) !== before) return E("a frozen file was refused or changed");
    const connector = parsed.registry.connectors[0];
    const frozen = [parsed.registry, parsed.registry.connectors, connector, connector.scopes, connector.actions, connector.dataCategories, connector.releaseRecord, connector.releaseRecord.checklist, connector.releaseRecord.scenarios];
    if (!frozen.every((value) => Object.isFrozen(value))) E("a value came back unfrozen");
    const open = k.file([k.entry()]);
    const live = k.parse(open);
    open.connectors[0].scopes.push("everything");
    open.connectors[0].releaseRecord.checklist.push("x");
    if (!live.ok || live.registry.connectors[0].scopes.length !== 1 || live.registry.connectors[0].releaseRecord.checklist.length !== m.RELEASE_CHECKLIST.length) E("the result shares a list with the input");
    if (!Object.isFrozen(m.parseConnectorReceipt(deepFreeze(k.receipt())).receipt)) E("a receipt came back unfrozen");
    if (k.raw2(deepFreeze(k.story([k.failed("rate_limited")]))).code === "RETRY_HISTORY_INVALID") E("frozen history was refused");
    const result = k.reconcile(deepFreeze(k.story([k.unknown()])));
    if (!result.ok || !Object.isFrozen(result.record) || !Object.isFrozen(result.history)) E("a reconciliation came back unfrozen");
    if (!Object.isFrozen(k.call())) E("an admitted call came back unfrozen");
    if (!Object.isFrozen(m.CONNECTOR_RETRY_RULES)) E("the retry table can be edited in place");
  }],
  ["CC-26", (k, E, m, raw) => {
    const schema = jsonOf(raw[SCHEMA]);
    const both = (label, connectors, over = {}) => {
      const rawFile = k.file(connectors, over);
      if (k.parse(rawFile).ok) E(`the code accepts ${label}`);
      if (schema !== null && schemaErrors(schema, JSON.parse(JSON.stringify(rawFile)), schema, "$").length === 0) E(`the schema accepts ${label}`);
    };
    both("a date past four year digits", [k.entry({ lastAcceptanceDate: FAR_DATE, releaseRecord: k.release({ acceptedAt: FAR_DATE }) })]);
    both("whitespace for prose", [], { authority: "   " });
    for (const value of [FAKE_PREFIXED, FAKE_BARE, FAKE_JWT]) both(`the evidence ${value.slice(0, 4)}`, [k.entry({ releaseRecord: k.release({ evidence: `provider:${value}` }) })]);
    for (const value of [FAKE_PREFIXED, FAKE_BARE, FAKE_UUID, FAKE_SPLIT]) both(`the last segment ${value.slice(0, 4)}`, [k.entry({ secretReference: REFERENCE_OF("tenant.agency-business", value) })]);
    if (schema !== null && schemaErrors(schema, JSON.parse(JSON.stringify(k.file([k.entry()]))), schema, "$").length !== 0) E("the schema refuses what the code accepts");
  }],
  ["CC-29", (k, E, m, raw) => {
    const committed = k.parse(jsonOf(raw[REGISTRY]));
    if (!committed.ok) E(`the committed registry is refused: ${committed.problems.map((problem) => problem.message).join("; ")}`);
  }],
  ["CC-30", (k, E) => {
    refused(E, k.raw2([k.started(1)]), "RETRY_UNRECONCILED", "a start with no receipt");
    refused(E, k.raw2([k.started(1), k.started(2)]), "RETRY_UNRECONCILED", "two starts");
    refused(E, k.raw2([k.started(1), k.started(2), k.failed("rate_limited", { attempt: 2 })]), "RETRY_UNRECONCILED", "a superseded start");
    refused(E, k.raw2([k.started(1), k.receipt({ attempt: 2 })]), "RETRY_HISTORY_INVALID", "a receipt for another attempt");
    refused(E, k.raw2([k.started(1), k.receipt({ connector: "fixture-other" })]), "RETRY_HISTORY_INVALID", "a receipt from another connector");
    refused(E, k.raw2([k.started(1), k.failed("rate_limited"), k.failed("rate_limited")]), "RETRY_HISTORY_INVALID", "a second receipt");
    refused(E, k.raw2([k.started(2)]), "RETRY_HISTORY_INVALID", "a start out of order");
    refused(E, k.raw2([k.receipt()]), "RETRY_HISTORY_INVALID", "a receipt with no start");
    refused(E, k.raw2([k.started(1, { note: "x" })]), "RETRY_HISTORY_INVALID", "a start with an unknown field");
    refused(E, k.raw2([k.started(1, { envelopeId: "owner" })]), "RETRY_HISTORY_INVALID", "a start with no envelope");
    const envelope = k.agency();
    const first = k.gate({ envelope });
    if (!first.admitted || !same(first.started, { tenant: "agency-business", connector: "fixture-mail", action: "bridge-read", idempotencyKey: envelope.idempotencyKey, attempt: 1, envelopeId: envelope.envelopeId })) return E("admission did not return the start");
    if (!Object.isFrozen(first.started)) E("the start came back unfrozen");
    refused(E, k.gate({ envelope: k.agency(), history: [first.started] }), "RETRY_UNRECONCILED", "a second admit that sees the start");
    const retry = k.gate({ envelope, history: k.story([k.failed("rate_limited", { idempotencyKey: envelope.idempotencyKey })]) });
    if (retry.started?.attempt !== 2) E("the start does not name its attempt");
  }],
  ["CC-31", (k, E, m) => {
    const open = k.story([k.unknown()]);
    refused(E, k.reconcile(open, { actions: k.actions() }), "RECONCILE_ACTION_UNREGISTERED", "the committed action registry");
    if (m.CONNECTOR_RECONCILE_ACTION !== "connector-reconcile" || !k.actions().actions.every((action) => action.id !== m.CONNECTOR_RECONCILE_ACTION)) E("the reconcile action is not the one nothing registers yet");
    const replay = k.reconciliation("not_completed", { attempt: 1 });
    const replayed = k.story([k.unknown(), replay, k.unknown(), replay]);
    refused(E, k.raw2(replayed), "RETRY_UNRECONCILED", "a copy of a reconciliation");
    const answered = k.reconcile(replayed);
    if (!answered.ok || answered.record.attempt !== 2) E("a replay stopped the real answer");
    refused(E, k.raw2(k.story([k.unknown(), k.reconciliation("not_completed", { connector: "fixture-other" })])), "RETRY_UNRECONCILED", "another connector's reconciliation");
    for (const [label, history] of Object.entries({
      "nothing open": [k.reconciliation("not_completed", { attempt: 1 })],
      "a plain failure": k.story([k.failed("rate_limited"), k.reconciliation("not_completed")]),
      "an attempt that never was": k.story([k.unknown(), k.reconciliation("not_completed", { attempt: 9 })]),
    })) refused(E, k.raw2(history), "RETRY_HISTORY_INVALID", `a reconciliation of ${label}`);
    const minted = k.mint(AGENCY_FACTS, { action: m.CONNECTOR_RECONCILE_ACTION }, k.reconcileActions());
    for (const [label, over] of Object.entries({
      "a copied envelope": { envelope: { ...k.reconciler() } },
      "a minted envelope": { envelope: minted.envelope },
      "another action": { envelope: k.agency() },
      "another tenant": { envelope: k.owner({ action: m.CONNECTOR_RECONCILE_ACTION }, k.reconcileActions()) },
      "an expired envelope": { now: LATER },
      "an unreadable time": { now: "today" },
    })) refused(E, k.reconcile(open, over), "RECONCILE_UNAUTHORISED", label);
    const envelope = k.reconciler();
    const named = k.reconcile(open, { envelope, reconciledBy: "owner" });
    if (!named.ok || named.record.reconciledBy !== envelope.principal || named.record.reconcilerEnvelope !== envelope.envelopeId) E("the reconciler did not come from the envelope");
    const crash = k.reconcile([k.started(1)]);
    if (!crash.ok || crash.record.attempt !== 1 || !k.raw2(crash.history).allowed) E("a crash could not be reconciled");
    const two = k.reconcile([k.started(1), k.started(2)]);
    if (!two.ok || two.record.attempt !== 1) E("the oldest open attempt was not answered first");
  }],
  ["CC-32", (k, E) => {
    for (const code of ["permission_denied", "invalid_input"]) refused(E, k.decide([k.failed(code), k.failed("rate_limited")]), "RETRY_NEVER", `${code} then a rate limit`);
    refused(E, k.decide([k.failed("authentication_required"), k.failed("rate_limited")]), "RETRY_NEEDS_REAUTHENTICATION", "an old authentication stop");
    refused(E, k.decide([k.failed("approval_required"), k.failed("upstream_unavailable")]), "RETRY_NEEDS_APPROVAL", "an old approval stop");
    if (!same(k.decide([k.failed("authentication_required"), k.failed("rate_limited")], { reauthenticated: true, approved: false }), { allowed: true, attempt: 3, rule: "after-backoff" })) E("a met condition still stopped the key");
  }],
  ["CC-33", (k, E) => {
    const refusedByDoor = (action, rule, actionRegistry) => {
      const parsed = k.parse(k.file([k.entry({ idempotency: "provider-key", actions: ["bridge-read", action] })]), actionRegistry);
      if (parsed.ok) return E(`${action} registered`);
      if (!parsed.problems.some((problem) => problem.code === "CONNECTOR_ACTION_DOOR_REFUSED" && problem.message.includes(rule))) E(`${action} was not refused as ${rule}: ${parsed.problems.map((problem) => problem.code).join(", ")}`);
      return undefined;
    };
    for (const [action, rule] of [["credential-release", "RUN_LINK_REQUIRED"], ["broker-call", "RUN_LINK_REQUIRED"], ["commit", "RUN_LINK_REQUIRED"], ["cross-tenant-access", "P5_NO_GRANT"], ["tenant-registry-change", "P5_NO_GRANT"], ["approve", "P5_NO_GRANT"]]) refusedByDoor(action, rule);
    for (const [cls, rule] of [["P3", "P3_NO_GRANT"], ["P4", "P4_NO_GRANT"], ["P5", "P5_NO_GRANT"], ["P6", "P6_PROHIBITED"]]) refusedByDoor("fixture-class", rule, k.actionsPlus("fixture-class", cls));
    if (k.codes(k.file([k.entry({ idempotency: "provider-key", actions: ["bridge-read", "generate_report"] })])).length !== 0) E("P1 and P2 did not pass the door");
  }],
  ["CC-34", (k, E, m) => {
    for (const over of [{ providerReceipt: null }, { providerReceipt: "docs/finish/FIXTURE.md" }, { providerReceipt: "nothing" }, { providerReceipt: `provider:${FAKE_BARE}` }]) refused(E, m.parseConnectorReceipt(k.receipt(over)), "RECEIPT_INVALID", `a success with ${shows(over)}`);
  }],
  ["CC-35", (k, E) => {
    const earlier = k.decide([k.receipt()]);
    if (earlier.earlier?.providerReceipt !== "provider:receipt-77") E("a duplicate did not return the earlier receipt");
    if (k.decide([k.unknown(), k.reconciliation("completed")]).earlier?.finding !== "completed") E("a duplicate did not return the reconciliation that completed it");
    if (k.decide([k.failed("rate_limited"), k.receipt()]).earlier?.outcome !== "succeeded") E("the outcome that completed the key is not the one returned");
    const envelope = k.agency();
    const gated = k.gate({ envelope, history: k.story([k.receipt({ idempotencyKey: envelope.idempotencyKey })]) });
    if (gated.admitted || gated.code !== "RETRY_ALREADY_COMPLETED" || gated.earlier?.outcome !== "succeeded") E("the gate did not hand the earlier outcome back");
  }],
  ["CC-36", (k, E, m) => {
    const twoFaced = (target) => {
      let reads = 0;
      Object.defineProperty(target, "tenant", { enumerable: true, get: () => { reads += 1; return reads === 1 ? "agency-business" : "owner-personal"; } });
      return () => reads;
    };
    const presented = k.receipt();
    const readsOf = twoFaced(presented);
    const parsed = m.parseConnectorReceipt(presented);
    if (readsOf() !== 1 || !parsed.ok || parsed.receipt.tenant !== "agency-business") E("a receipt was read twice, or the original came back");
    const rawFile = k.file([k.entry()]);
    const entryReads = twoFaced(rawFile.connectors[0]);
    const judged = k.parse(rawFile);
    if (entryReads() !== 1 || !judged.ok || judged.registry.connectors[0].tenant !== "agency-business") E("a registry entry was read twice, or the original came back");
    const throwing = k.receipt();
    Object.defineProperty(throwing, "tenant", { enumerable: true, get: () => { throw new Error("boom"); } });
    refused(E, m.parseConnectorReceipt(throwing), "RECEIPT_INVALID", "a getter that throws");
  }],
  ["CC-37", (k, E) => {
    const shaped = FAKE_PREFIXED;
    const results = [
      k.parse(k.file([k.entry({ idempotency: "provider-key", actions: [shaped] })])),
      k.parse(k.file([k.entry({ actions: [shaped] })]), k.actionsPlus(shaped, "P2")),
      k.parse(k.file([k.entry({ connectorId: shaped, releaseRecord: k.release({ connectorId: shaped }) }), k.entry({ connectorId: shaped, releaseRecord: k.release({ connectorId: shaped }) })])),
    ];
    for (const result of results) {
      if (!result.ok && shows(result).includes(shaped)) E("a refusal repeated a value that could be a credential");
    }
  }],
];

function behaviourProblems(m, raw) {
  const problems = [];
  const k = kit(m, raw);
  for (const [rule, probe] of PROBES) {
    const E = (message) => problems.push([rule, `${rule} ${RULE_NAMES[rule]}: ${message}`]);
    try {
      probe(k, E, m, raw);
    } catch (error) {
      E(`a probe threw: ${error.message}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------
// The schema, run rather than compared
// ---------------------------------------------------------------------------------------------------------

/** The draft-07 subset this schema uses. Anything else in it is a failure, not a pass. */
const SCHEMA_KEYWORDS = new Set(["$schema", "$id", "title", "description", "definitions", "type", "additionalProperties", "required", "properties", "items", "$ref", "const", "enum", "pattern", "not", "minItems", "maxItems", "uniqueItems", "minLength"]);

function schemaErrors(schema, value, root, at) {
  const errors = [];
  const unknownKeyword = Object.keys(schema).find((keyword) => !SCHEMA_KEYWORDS.has(keyword));
  if (unknownKeyword !== undefined) return [`${at}: the keyword ${unknownKeyword} is not understood here`];
  if (schema.$ref !== undefined) return schemaErrors(root.definitions[schema.$ref.slice("#/definitions/".length)], value, root, at);
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  if (schema.type === "object" && !isObject) errors.push(`${at}: not an object`);
  if (schema.type === "array" && !Array.isArray(value)) errors.push(`${at}: not an array`);
  if (schema.type === "string" && typeof value !== "string") errors.push(`${at}: not a string`);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: not the constant`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) errors.push(`${at}: not in the enum`);
  if (typeof value === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: pattern`);
    if (schema.not?.pattern !== undefined && new RegExp(schema.not.pattern).test(value)) errors.push(`${at}: excluded pattern`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: too short`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: too few`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: too many`);
    if (schema.uniqueItems === true && new Set(value).size !== value.length) errors.push(`${at}: repeats`);
    if (schema.items !== undefined) value.forEach((item, index) => errors.push(...schemaErrors(schema.items, item, root, `${at}[${index}]`)));
  }
  if (isObject) {
    for (const field of schema.required ?? []) if (!Object.hasOwn(value, field)) errors.push(`${at}: no ${field}`);
    for (const [field, child] of Object.entries(value)) {
      const rule = schema.properties?.[field];
      if (rule !== undefined) errors.push(...schemaErrors(rule, child, root, `${at}.${field}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: extra ${field}`);
    }
  }
  return errors;
}

const SCHEMA_RELEASE = { connectorId: "fixture-mail", version: "1.0.0", tenant: "agency-business", result: "passed", acceptedAt: ACCEPTED, checklist: CHECKLIST, scenarios: SCENARIOS, evidence: "docs/finish/FIXTURE.md" };
const SCHEMA_ENTRY = {
  connectorId: "fixture-mail", version: "1.0.0", tenant: "agency-business", domain: "business", scopes: ["mail.read"], secretReference: REFERENCE_OF("tenant.agency-business"),
  dataCategories: ["enquiry-text"], idempotency: "read-only", actions: ["bridge-read"], lastAcceptanceDate: ACCEPTED, releaseRecord: SCHEMA_RELEASE,
};
const SCHEMA_HEADER = { schemaVersion: "1.0.0", policy: "connector-registry", note: "x", authority: "owner", authorisedBy: "Murad", provenance: "x", trustBasis: "x" };
const without = (record, field) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
const SCHEMA_REFUSES = {
  "a registry with an extra field": { ...SCHEMA_HEADER, connectors: [], tenantOverride: "x" },
  "an entry with an extra field": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, tenantOverride: "x" }] },
  "a record with an extra field": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, releaseRecord: { ...SCHEMA_RELEASE, note: "x" } }] },
  "a failed record": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, releaseRecord: { ...SCHEMA_RELEASE, result: "failed" } }] },
  "a short checklist": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, releaseRecord: { ...SCHEMA_RELEASE, checklist: CHECKLIST.slice(1) } }] },
  "a short scenario list": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, releaseRecord: { ...SCHEMA_RELEASE, scenarios: SCENARIOS.slice(1) } }] },
  "a long run in the reference": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, secretReference: REFERENCE_OF("tenant.agency-business", FAKE_BARE) }] },
  "whitespace for prose": { ...SCHEMA_HEADER, authority: "  ", connectors: [] },
  "a date past four year digits": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, lastAcceptanceDate: FAR_DATE, releaseRecord: { ...SCHEMA_RELEASE, acceptedAt: FAR_DATE } }] },
  ...Object.fromEntries([FAKE_PREFIXED, FAKE_BARE, FAKE_JWT].map((value, index) => [`credential-shaped evidence ${index}`, { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, releaseRecord: { ...SCHEMA_RELEASE, evidence: `provider:${value}` } }] }])),
  ...Object.fromEntries([FAKE_PREFIXED, FAKE_BARE, FAKE_UUID, FAKE_SPLIT].map((value, index) => [`a credential-shaped last segment ${index}`, { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, secretReference: REFERENCE_OF("tenant.agency-business", value) }] }])),
  "evidence that is a word": { ...SCHEMA_HEADER, connectors: [{ ...SCHEMA_ENTRY, releaseRecord: { ...SCHEMA_RELEASE, evidence: "nothing" } }] },
  ...Object.fromEntries(["tenant", "secretReference", "releaseRecord", "scopes", "dataCategories", "idempotency", "actions", "lastAcceptanceDate"].map((field) => [`an entry with no ${field}`, { ...SCHEMA_HEADER, connectors: [without(SCHEMA_ENTRY, field)] }])),
};

/** A regular expression literal's source, as JSON Schema would hold it. */
const literal = (text, name) => {
  const found = new RegExp(String.raw`const ${name} = /(.+)/;`).exec(text);
  return found === null ? null : found[1].replace(/\\\//g, "/");
};
const listOf = (text, name) => {
  const found = new RegExp(String.raw`export const ${name} = \[([^\]]*)\] as const;`).exec(text);
  return found === null ? [] : [...found[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

function schemaProblems(raw, src, E) {
  const schema = jsonOf(raw[SCHEMA]);
  if (schema === null) return E("CC-26", "the schema does not parse");
  const def = schema.definitions?.connector?.properties ?? {};
  const release = schema.definitions?.releaseRecord?.properties ?? {};
  const contract = src[CONTRACT];
  const agree = [
    ["connectorId", schema.definitions?.connectorId?.pattern, literal(contract, "CONNECTOR_ID")],
    ["version", schema.definitions?.version?.pattern, literal(contract, "VERSION")],
    ["tenant", schema.definitions?.tenant?.pattern, literal(src[TENANT], "TENANT_ID")],
    ["scopes", def.scopes?.items?.pattern, literal(contract, "SCOPE")],
    ["secretReference", def.secretReference?.pattern, literal(contract, "SECRET_REFERENCE")],
    ["the raw run", String(def.secretReference?.not?.pattern).split("|").slice(0, 2).join("|"), `${literal(contract, "RAW_CREDENTIAL_RUN")}|${literal(contract, "SPLIT_CREDENTIAL_RUN")}`],
    ["dataCategories", def.dataCategories?.items?.pattern, literal(contract, "DATA_CATEGORY")],
    ["actions", def.actions?.items?.pattern, literal(src[ACTION], "ACTION_ID")],
    ["evidence", release.evidence?.pattern, literal(contract, "EVIDENCE")],
  ];
  for (const [label, inSchema, inCode] of agree) if (inSchema === undefined || inSchema !== inCode) E("CC-26", `the schema's ${label} is not the code's`);
  if (!same(def.domain?.enum, listOf(src[TENANT], "DOMAINS"))) E("CC-26", "the schema's domains are not the code's");
  if (!same(def.idempotency?.enum, listOf(contract, "CONNECTOR_IDEMPOTENCY"))) E("CC-26", "the schema's idempotency values are not the code's");
  if (!same(release.checklist?.items?.enum, CHECKLIST)) E("CC-26", "the schema's checklist is not the code's");
  if (!same(release.scenarios?.items?.enum, SCENARIOS)) E("CC-26", "the schema's scenarios are not the code's");
  const fileErrors = schemaErrors(schema, jsonOf(raw[REGISTRY]), schema, "$");
  if (fileErrors.length > 0) E("CC-26", `the committed registry is not schema-valid: ${fileErrors[0]}`);
  const accepted = schemaErrors(schema, { ...SCHEMA_HEADER, connectors: [SCHEMA_ENTRY] }, schema, "$");
  if (accepted.length > 0) E("CC-26", `the schema refuses a complete entry: ${accepted[0]}`);
  for (const [label, value] of Object.entries(SCHEMA_REFUSES)) if (schemaErrors(schema, value, schema, "$").length === 0) E("CC-26", `the schema accepts ${label}`);
  // The reference shape is the credential store's, so it is rebuilt from the file that owns it.
  const segment = (/const SEGMENT_RE = \/\^(.+)\$\/;/.exec(raw[REFERENCE]) || [])[1];
  const root = (/const ROOT = "([^"]+)";/.exec(raw[REFERENCE]) || [])[1];
  const environments = [...((/const ENVIRONMENTS = Object\.freeze\(\[([^\]]*)\]\)/.exec(raw[REFERENCE]) || [])[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (literal(contract, "SECRET_REFERENCE") !== `^${root}/(${segment})/(?:${environments.join("|")})/${segment}/${segment}$`) E("CC-26", "the reference shape is not the credential store's");
  if (literal(contract, "IDEMPOTENCY_KEY") !== literal(src[ENVELOPE], "IDEMPOTENCY_KEY")) E("CC-26", "the idempotency key shape is not the envelope's");
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------
// The text rules
// ---------------------------------------------------------------------------------------------------------

function textProblems(raw) {
  const problems = [];
  const E = (rule, message) => problems.push([rule, `${rule} ${RULE_NAMES[rule]}: ${message}`]);
  const src = { ...raw };
  for (const rel of [...LOADED, BARREL, TEST_FILE]) src[rel] = code(raw[rel]);

  // CC-24: pure, judged on code with comments gone. The two controls prove this scan reads real bytes.
  const imports = SPECIFIERS.flatMap((pattern) => [...src[CONTRACT].matchAll(pattern)].map((m) => m[1]));
  const foreign = imports.filter((name) => !PURE_IMPORTS.includes(name));
  if (foreign.length > 0) E("CC-24", `the contract imports ${foreign.join(", ")}`);
  if (IMPURE.test(src[CONTRACT])) E("CC-24", `the contract reaches outside itself: ${IMPURE.exec(src[CONTRACT])[0]}`);
  if (!IMPURE.test("const at = Date.now();") || IMPURE.test(code("// Date.now()\nconst at = 1;\n"))) E("CC-24", "the purity scan does not read real bytes");
  if (!NOT_RUN.test("it.skip('x', () => {});") || NOT_RUN.test("const tied = 1;")) E("CC-24", "the skip scan does not read real bytes");
  if (raw[CONTRACT].includes("\u0008")) E("CC-24", "the contract holds a backspace byte: a mangled escape");

  // CC-25: zero live connectors.
  const registry = jsonOf(raw[REGISTRY]);
  if (registry === null || !Array.isArray(registry.connectors) || registry.connectors.length !== 0) E("CC-25", "the committed registry names a connector");

  schemaProblems(raw, src, E);

  // CC-27: exported, and registered in both runners.
  if (!src[BARREL].includes("export * from './connectorContract.js';")) E("CC-27", "the barrel does not export the contract");
  for (const [rel, name] of [[VA, "validate-all"], [CR, "cached-runner"]]) {
    const modules = modulesOf(code(raw[rel]));
    if (modules === null || !modules.includes(THIS_VALIDATOR)) E("CC-27", `${THIS_VALIDATOR} is not registered in ${name}`);
  }

  // CC-28: every proof exists, and every proof runs.
  for (const needle of NEEDLES) if (!src[TEST_FILE].includes(needle)) E("CC-28", `${TEST_FILE} no longer proves "${needle}"`);
  if (NOT_RUN.test(src[TEST_FILE])) E("CC-28", `${TEST_FILE} skips or isolates a test: ${NOT_RUN.exec(src[TEST_FILE])[0]}`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------
// The named mutations
// ---------------------------------------------------------------------------------------------------------

/** M changes the source and reloads it; `also` names another rule true of the same change. T skips the reload. */
const M = (name, rule, rel, from, to, also = []) => ({ name, rule, rel, from, to, also });
const T = (name, rule, rel, from, to, also = []) => ({ name, rule, rel, from, to, also, text: true });
const C = (name, rule, from, to, also = []) => M(name, rule, CONTRACT, from, to, also);
const GONE = "";
const FIRST_BAD = "if (problems.length > 0) return { ok: false, problems };";
const QUALIFIED = JSON.stringify({
  connectorId: "fixture-mail", version: "1.0.0", tenant: "agency-business", domain: "business", scopes: ["mail.read"], secretReference: REFERENCE_OF("tenant.agency-business"),
  dataCategories: ["enquiry-text"], idempotency: "read-only", actions: ["bridge-read"], lastAcceptanceDate: ACCEPTED,
  releaseRecord: { connectorId: "fixture-mail", version: "1.0.0", tenant: "agency-business", result: "passed", acceptedAt: ACCEPTED, checklist: CHECKLIST, scenarios: SCENARIOS, evidence: "docs/finish/FIXTURE.md" },
});
const UNQUALIFIED = JSON.stringify({ connectorId: "fixture-mail" });
const NO_CONNECTORS = '"connectors": []';

const MUTATIONS = [
  // CC-1
  C("entry-scopes-lost", "CC-1", "scopes: freezeList(entry['scopes']),", "scopes: freezeList([]),", ["CC-23"]),
  C("entry-secret-reference-lost", "CC-1", "return Object.freeze({ ...entry, ...lists, releaseRecord }) as unknown as ConnectorEntry;", "return Object.freeze({ ...entry, ...lists, releaseRecord, secretReference: '' }) as unknown as ConnectorEntry;"),
  C("entry-data-categories-lost", "CC-1", "dataCategories: freezeList(entry['dataCategories']),", "dataCategories: freezeList([]),"),
  C("entry-idempotency-lost", "CC-1", "return Object.freeze({ ...entry, ...lists, releaseRecord }) as unknown as ConnectorEntry;", "return Object.freeze({ ...entry, ...lists, releaseRecord, idempotency: 'provider-key' }) as unknown as ConnectorEntry;", ["CC-12"]),
  C("record-evidence-lost", "CC-1", "Object.freeze({ ...release, checklist:", "Object.freeze({ ...release, evidence: '', checklist:"),
  C("record-checklist-lost", "CC-1", "checklist: freezeList(release['checklist'])", "checklist: freezeList([])", ["CC-23"]),
  // CC-2
  C("tenant-missing-not-named", "CC-2", "if (typeof value !== 'string' || value === '') return [{ code: 'CONNECTOR_TENANT_MISSING', message: `${label} names no tenant` }];\n", GONE),
  C("tenant-blank-allowed", "CC-2", "if (typeof value !== 'string' || value === '') return [{ code: 'CONNECTOR_TENANT_MISSING'", "if (typeof value !== 'string') return [{ code: 'CONNECTOR_TENANT_MISSING'"),
  C("tenant-undeclared-allowed", "CC-2", "const declared = tenants.tenants.some((tenant) => tenant.tenantId === value);", "const declared = isTenantId(value);"),
  C("tenant-optional", "CC-2", "...tenantProblems(entry['tenant'], context.tenants, label),\n", GONE, ["CC-10"]),
  // CC-3
  C("secret-missing-not-named", "CC-3", "if (typeof value !== 'string' || value.trim() === '') return [{ code: 'CONNECTOR_SECRET_MISSING', message: `${label} has no secretReference` }];\n", GONE),
  C("secret-blank-allowed", "CC-3", "if (typeof value !== 'string' || value.trim() === '') return [{ code: 'CONNECTOR_SECRET_MISSING'", "if (typeof value !== 'string') return [{ code: 'CONNECTOR_SECRET_MISSING'"),
  C("secret-optional", "CC-3", "...secretProblems(entry, context.tenants, label),\n", GONE, ["CC-5", "CC-6", "CC-26"]),
  // CC-4
  C("release-record-optional", "CC-4", "if (record === null) return [{ code: 'CONNECTOR_RELEASE_MISSING', message: `${label} has no release record` }];", "if (record === null) return [];"),
  C("release-missing-misnamed", "CC-4", "return [{ code: 'CONNECTOR_RELEASE_MISSING', message:", "return [{ code: 'CONNECTOR_RELEASE_NOT_PASSED', message:"),
  C("release-never-judged", "CC-4", "    ...releaseProblems(entry, label),\n", GONE, ["CC-7", "CC-9", "CC-26"]),
  C("result-not-asked", "CC-4", "    ...(record['result'] === 'passed' ? [] : [notPassed('does not say passed')]),\n", GONE),
  C("result-truthy", "CC-4", "...(record['result'] === 'passed' ? []", "...(record['result'] ? []"),
  C("checklist-not-asked", "CC-4", "    ...(isExactly(record['checklist'], RELEASE_CHECKLIST) ? [] : [notPassed('does not confirm exactly the release checklist')]),\n", GONE),
  C("scenarios-not-asked", "CC-4", "    ...(isExactly(record['scenarios'], scenarioIds) ? [] : [notPassed('does not list exactly the nine acceptance scenarios')]),\n", GONE),
  C("evidence-not-asked", "CC-4", "    ...(isEvidence(record['evidence']) ? [] : [notPassed('points at no evidence')]),\n", GONE, ["CC-26"]),
  C("exactly-allows-extras", "CC-4", "items.length === required.length && ", GONE),
  C("exactly-allows-gaps", "CC-4", "required.every((item) => items.includes(item))", "true"),
  C("checklist-loses-an-item", "CC-4", " 'audit-logs',", GONE, ["CC-26"]),
  // CC-5
  C("credential-shape-not-asked", "CC-5", "if (holdsSecretShape(value) || RAW_CREDENTIAL_RUN.test(value) || SPLIT_CREDENTIAL_RUN.test(value)) {", "if (RAW_CREDENTIAL_RUN.test(value) || SPLIT_CREDENTIAL_RUN.test(value)) {"),
  C("raw-run-not-asked", "CC-5", "if (holdsSecretShape(value) || RAW_CREDENTIAL_RUN.test(value) || SPLIT_CREDENTIAL_RUN.test(value)) {", "if (holdsSecretShape(value) || SPLIT_CREDENTIAL_RUN.test(value)) {"),
  C("split-run-not-asked", "CC-5", "if (holdsSecretShape(value) || RAW_CREDENTIAL_RUN.test(value) || SPLIT_CREDENTIAL_RUN.test(value)) {", "if (holdsSecretShape(value) || RAW_CREDENTIAL_RUN.test(value)) {", ["CC-26"]),
  C("split-run-weakened", "CC-5", String.raw`const SPLIT_CREDENTIAL_RUN = /\/(?:[A-Za-z0-9][._-]?){24,}$/;`, String.raw`const SPLIT_CREDENTIAL_RUN = /\/(?:[A-Za-z0-9][._-]?){60,}$/;`, ["CC-26"]),
  C("credential-falls-to-shape", "CC-5", "return [{ code: 'CONNECTOR_SECRET_VALUE', message:", "return [{ code: 'CONNECTOR_SECRET_REFERENCE_INVALID', message:"),
  C("credential-repeated-in-the-refusal", "CC-5", "secretReference looks like a credential, not a reference to one`", "secretReference looks like a credential: ${value}`"),
  C("raw-run-weakened", "CC-5", "const RAW_CREDENTIAL_RUN = /[A-Za-z0-9]{24,}/;", "const RAW_CREDENTIAL_RUN = /[A-Za-z0-9]{64,}/;", ["CC-4", "CC-15", "CC-26", "CC-34"]),
  // CC-6
  C("reference-any-environment", "CC-6", "\\/(?:development|staging|production)\\/", "\\/[a-z]+\\/", ["CC-26"]),
  C("reference-any-root", "CC-6", "const SECRET_REFERENCE = /^ProjectOS\\/", "const SECRET_REFERENCE = /^[A-Za-z]+\\/", ["CC-26"]),
  C("reference-any-shape", "CC-6", "  if (reference === null) return [{ code: 'CONNECTOR_SECRET_REFERENCE_INVALID', message: `${label}.secretReference is not a five-segment credential reference` }];\n", "  if (reference === null) return [];\n"),
  C("reference-any-tenant", "CC-6", "return referenceBelongs(reference[1] as string, entry, tenants)\n", "return reference[1] !== undefined\n"),
  C("reference-any-listed-project", "CC-6", "return project !== undefined && project.tenant === entry['tenant'] && project.domain === entry['domain'];", "return project !== undefined;"),
  C("reference-any-domain", "CC-6", " && project.domain === entry['domain'];", ";"),
  C("reference-any-tenant-class", "CC-6", "return segment.slice(TENANT_CREDENTIAL_PREFIX.length) === entry['tenant'];", "return true;"),
  // CC-7
  C("record-any-connector", "CC-7", "const RELEASE_BOUND_FIELDS = ['connectorId', 'version', 'tenant'] as const;", "const RELEASE_BOUND_FIELDS = ['version', 'tenant'] as const;"),
  C("record-any-version", "CC-7", "const RELEASE_BOUND_FIELDS = ['connectorId', 'version', 'tenant'] as const;", "const RELEASE_BOUND_FIELDS = ['connectorId', 'tenant'] as const;"),
  C("record-any-tenant", "CC-7", "const RELEASE_BOUND_FIELDS = ['connectorId', 'version', 'tenant'] as const;", "const RELEASE_BOUND_FIELDS = ['connectorId', 'version'] as const;"),
  C("record-any-date", "CC-7", "    ...(record['acceptedAt'] === entry['lastAcceptanceDate'] ? [] : [mismatch('is not dated the entry\\'s lastAcceptanceDate')]),\n", GONE),
  // CC-8
  C("never-stale", "CC-8", "return at - accepted > CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS * DAY_MS\n", "return false\n"),
  C("stale-one-early", "CC-8", "at - accepted > CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS", "at - accepted >= CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS"),
  C("window-raised", "CC-8", "CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS = 90;", "CONNECTOR_ACCEPTANCE_MAX_AGE_DAYS = 900;"),
  C("future-date-allowed", "CC-8", "  if (accepted > at) return `the acceptance of '${connector.connectorId}' is dated after now`;\n", GONE),
  C("unreadable-now-is-fresh", "CC-8", "if (accepted === null || at === null) return `the acceptance of '${connector.connectorId}' cannot be judged: a date is unreadable`;", "if (accepted === null || at === null) return null;"),
  C("gate-skips-acceptance", "CC-8", "  if (lapsed !== null) return callRefused('CONNECTOR_ACCEPTANCE_STALE', [lapsed]);\n", GONE),
  C("lapse-refuses-the-whole-file", "CC-8", "    ...releaseProblems(entry, label),\n", "    ...releaseProblems(entry, label),\n    ...(Date.parse(String(entry['lastAcceptanceDate'])) < Date.parse('2026-08-01T00:00:00.000Z') ? [invalid('stale')] : []),\n"),
  // CC-9
  C("header-unknown-field-tolerated", "CC-9", "    ...unknownFieldProblems(root, HEADER_FIELDS, 'the connector registry'),\n", GONE),
  C("entry-unknown-field-tolerated", "CC-9", "    ...unknownFieldProblems(entry, ENTRY_FIELDS, label),\n", GONE),
  C("record-unknown-field-tolerated", "CC-9", "    ...unknownFieldProblems(record, RELEASE_FIELDS, `${label}.releaseRecord`),\n", GONE),
  C("entry-fields-gain-an-override", "CC-9", "const ENTRY_FIELDS = ['connectorId',", "const ENTRY_FIELDS = ['tenantOverride', 'connectorId',"),
  C("unknown-field-filter-keeps-nothing", "CC-9", ".filter((key) => !allowed.includes(key))", ".filter((key) => allowed.includes(key) && false)", ["CC-17", "CC-30"]),
  // CC-10
  C("file-live-despite-problems", "CC-10", "  " + FIRST_BAD + "\n", GONE, ["CC-2", "CC-3", "CC-4", "CC-5", "CC-6", "CC-7", "CC-9", "CC-11", "CC-12", "CC-26", "CC-33"]),
  C("wildcard-matches-nothing", "CC-10", "const WILDCARD = /[*?]/;", "const WILDCARD = /[~]/;"),
  C("id-wildcard-falls-to-shape", "CC-10", "  if (typeof value === 'string' && WILDCARD.test(value)) return [{ code: 'CONNECTOR_REGISTRY_WILDCARD', message: `${label} has a wildcard connectorId` }];\n", GONE),
  C("tenant-wildcard-falls-to-shape", "CC-10", "  if (WILDCARD.test(value)) return [{ code: 'CONNECTOR_REGISTRY_WILDCARD', message: `${label} has a wildcard tenant` }];\n", GONE),
  C("list-wildcard-falls-to-shape", "CC-10", "      if (WILDCARD.test(item)) return [{ code: 'CONNECTOR_REGISTRY_WILDCARD', message: `${label}.${field}[${index}] is a wildcard` }];\n", GONE),
  C("duplicate-connector-allowed", "CC-10", "    ...duplicateProblems(connectors ?? []),\n", GONE),
  C("list-repeats-allowed", "CC-10", ".filter((item, index) => items.indexOf(item) !== index)\n", ".filter(() => false)\n"),
  C("any-schema-version", "CC-10", "    ...(root['schemaVersion'] === CONNECTOR_REGISTRY_SCHEMA_VERSION ? [] : [invalid('the connector registry has the wrong schemaVersion')]),\n", GONE),
  C("any-policy", "CC-10", "    ...(root['policy'] === CONNECTOR_REGISTRY_POLICY ? [] : [invalid('the connector registry has the wrong policy')]),\n", GONE),
  C("prose-optional", "CC-10", "    ...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map((field) => invalid(`the connector registry has no ${field}`)),\n", GONE, ["CC-26"]),
  C("no-list-reads-as-empty", "CC-10", "    ...(connectors === null ? [invalid('the connector registry declares no connectors list')] : []),\n", GONE),
  C("empty-list-is-a-declaration", "CC-10", "if (items === null || items.length === 0) return [invalid(`${label} declares no ${field}`)];", "if (items === null) return [invalid(`${label} declares no ${field}`)];"),
  C("version-any-text", "CC-10", "    ...(matches(VERSION, entry['version']) ? [] : [invalid(`${label} has no valid version`)]),\n", GONE),
  C("domain-any-text", "CC-10", "    ...((DOMAINS as readonly unknown[]).includes(entry['domain']) ? [] : [invalid(`${label} names an unknown domain`)]),\n", GONE),
  C("id-any-text", "CC-10", "  return matches(CONNECTOR_ID, value) ? [] : [invalid(`${label} has no valid connectorId`)];\n", "  return [];\n"),
  C("idempotency-any-text", "CC-10", "    ...((CONNECTOR_IDEMPOTENCY as readonly unknown[]).includes(entry['idempotency']) ? [] : [invalid(`${label} declares no known idempotency`)]),\n", GONE),
  C("date-any-text", "CC-10", "    ...(readInstant(entry['lastAcceptanceDate']) !== null ? [] : [invalid(`${label} has no readable lastAcceptanceDate`)]),\n", GONE, ["CC-26"]),
  C("year-past-four-digits", "CC-10", "  if (!matches(FOUR_DIGIT_YEAR, value)) return null;\n", "  if (typeof value !== 'string') return null;\n", ["CC-26"]),
  C("a-date-that-does-not-exist", "CC-10", "return Number.isNaN(at) || new Date(at).toISOString() !== value ? null : at;", "return Number.isNaN(at) ? null : at;", ["CC-8"]),
  C("scope-any-text", "CC-10", "...listProblems(entry['scopes'], 'scopes', (item) => SCOPE.test(item), label),", "...listProblems(entry['scopes'], 'scopes', () => true, label),"),
  C("category-any-text", "CC-10", "...listProblems(entry['dataCategories'], 'dataCategories', (item) => DATA_CATEGORY.test(item), label),", "...listProblems(entry['dataCategories'], 'dataCategories', () => true, label),"),
  C("action-any-text", "CC-10", "...listProblems(entry['actions'], 'actions', isActionName, label),", "...listProblems(entry['actions'], 'actions', () => true, label),"),
  // CC-11
  C("unregistered-action-accepted", "CC-11", "      if (!resolved.registered) return [{ code: 'CONNECTOR_ACTION_UNREGISTERED', message: `${at} is not in the action registry, so it is ${resolved.actionClass} and refused` }];\n", GONE),
  C("unregistered-action-not-called-p5", "CC-11", "`${at} is not in the action registry, so it is ${resolved.actionClass} and refused`", "`${at} is not in the action registry`"),
  C("gate-skips-the-action-registry", "CC-11", "  if (!resolved.registered) return callRefused('CONNECTOR_ACTION_UNREGISTERED', [`'${envelope.action}' is not in the action registry, so it is ${resolved.actionClass} and refused`]);\n", GONE),
  C("gate-hides-the-class", "CC-11", "[`'${envelope.action}' is not in the action registry, so it is ${resolved.actionClass} and refused`]", "[`'${envelope.action}' is not in the action registry`]"),
  // CC-12
  C("read-only-not-checked", "CC-12", "return entry['idempotency'] === 'read-only' && resolved.actionClass !== READ_ONLY_CLASS\n", "return false\n"),
  C("gate-skips-the-class", "CC-12", "  if (connector.idempotency === 'read-only' && resolved.actionClass !== READ_ONLY_CLASS) return callRefused('CONNECTOR_IDEMPOTENCY_MISMATCH', [`'${connector.connectorId}' says read-only, and '${envelope.action}' is now ${resolved.actionClass}`]);\n", GONE),
  C("read-only-any-class", "CC-12", "return entry['idempotency'] === 'read-only' && resolved.actionClass !== READ_ONLY_CLASS\n", "return entry['idempotency'] === 'read-only' && resolved.actionClass === 'P5'\n"),
  C("read-only-applies-to-all", "CC-12", "return entry['idempotency'] === 'read-only' && resolved.actionClass !== READ_ONLY_CLASS\n", "return resolved.actionClass !== READ_ONLY_CLASS\n", ["CC-33"]),
  // CC-13
  C("vocabulary-gains-timeout", "CC-13", "'upstream_unavailable', 'outcome_unknown'] as const;", "'upstream_unavailable', 'outcome_unknown', 'timeout'] as const;", ["CC-17", "CC-18"]),
  C("vocabulary-loses-outcome-unknown", "CC-13", "'upstream_unavailable', 'outcome_unknown'] as const;", "'upstream_unavailable'] as const;", ["CC-14", "CC-15", "CC-18", "CC-23", "CC-31", "CC-35"]),
  C("unknown-code-mapped", "CC-13", ": { ok: false, code: 'CONNECTOR_ERROR_UNKNOWN', reasons: ['the error is not a code of the connector contract'] };", ": { ok: true, code: 'upstream_unavailable' };", ["CC-17", "CC-18"]),
  C("code-folds-case", "CC-13", "return (CONNECTOR_ERROR_CODES as readonly unknown[]).includes(value)\n", "return (CONNECTOR_ERROR_CODES as readonly unknown[]).includes(String(value).toLowerCase())\n"),
  C("code-trims", "CC-13", "return (CONNECTOR_ERROR_CODES as readonly unknown[]).includes(value)\n", "return (CONNECTOR_ERROR_CODES as readonly unknown[]).includes(String(value).trim())\n"),
  // CC-14
  C("unknown-ignored", "CC-14", "  if (openAttempts(state).length > 0) return retryRefused('RETRY_UNRECONCILED', 'an earlier attempt is outcome_unknown and has not been reconciled');\n", GONE, ["CC-30", "CC-31"]),
  C("unknown-cleared-by-a-later-failure", "CC-14", "return { ...closed, failures: [...state.failures, code], lastRule: CONNECTOR_RETRY_RULES[code] };", "return { ...closed, unanswered: [], failures: [...state.failures, code], lastRule: CONNECTOR_RETRY_RULES[code] };", ["CC-30"]),
  C("unknown-cleared-by-a-later-success", "CC-14", "if (line.outcome === 'succeeded') return { ...closed, earlier: state.earlier ?? line };", "if (line.outcome === 'succeeded') return { ...closed, unanswered: [], earlier: state.earlier ?? line };"),
  C("completed-asked-before-unknown", "CC-14", "  if (openAttempts(state).length > 0) return retryRefused('RETRY_UNRECONCILED', 'an earlier attempt is outcome_unknown and has not been reconciled');\n  if (state.earlier !== null) return { ...retryRefused('RETRY_ALREADY_COMPLETED', 'this key already completed, so it does not run again'), earlier: state.earlier };\n", "  if (state.earlier !== null) return { ...retryRefused('RETRY_ALREADY_COMPLETED', 'this key already completed, so it does not run again'), earlier: state.earlier };\n  if (openAttempts(state).length > 0) return retryRefused('RETRY_UNRECONCILED', 'an earlier attempt is outcome_unknown and has not been reconciled');\n"),
  C("a-fact-clears-the-unknown", "CC-14", "if (openAttempts(state).length > 0) return retryRefused(", "if (openAttempts(state).length > 0 && facts.approved !== true) return retryRefused("),
  C("keyed-by-the-connector", "CC-14", "const retry = decideConnectorRetry(history, envelope.idempotencyKey, envelope.tenant, facts);", "const retry = decideConnectorRetry((history as readonly { connector?: string }[]).filter((line) => line.connector === connector.connectorId), envelope.idempotencyKey, envelope.tenant, facts);"),
  C("every-key-blocks-every-key", "CC-14", "const own = lines.filter((line) => line.idempotencyKey === idempotencyKey);", "const own = lines;"),
  C("gate-skips-the-retry-rule", "CC-14", "  if (!retry.allowed) return { ...callRefused(retry.code, retry.reasons), ...(retry.earlier === undefined ? {} : { earlier: retry.earlier }) };\n", GONE, ["CC-17", "CC-30", "CC-35"]),
  C("gate-reads-a-fresh-history", "CC-14", "const retry = decideConnectorRetry(history, envelope.idempotencyKey, envelope.tenant, facts);", "const retry = decideConnectorRetry([], envelope.idempotencyKey, envelope.tenant, facts);", ["CC-16", "CC-17", "CC-30", "CC-35"]),
  // CC-15
  C("reconcile-needs-no-evidence", "CC-15", "  if (!isEvidence(evidence)) return reconciliationRefused('RECONCILE_EVIDENCE_REQUIRED', 'a reconciliation points at its evidence, and this does not');\n", GONE),
  C("reconcile-with-nothing-open", "CC-15", "  if (attempt === undefined) return reconciliationRefused('RECONCILE_NOTHING_OPEN', 'no outcome_unknown is open under this key');\n", GONE),
  C("reconcile-any-finding", "CC-15", "  if (!(RECONCILIATION_FINDINGS as readonly unknown[]).includes(finding)) return reconciliationRefused('RECONCILE_INVALID', 'a reconciliation states a known finding');\n", GONE),
  C("completed-reopens", "CC-15", "earlier: state.earlier ?? (line.finding === 'completed' ? line : null),", "earlier: state.earlier,", ["CC-35"]),
  C("not-completed-closes", "CC-15", "earlier: state.earlier ?? (line.finding === 'completed' ? line : null),", "earlier: state.earlier ?? line,", ["CC-31"]),
  C("reconcile-rewrites-the-history", "CC-15", "history: Object.freeze([...lines, record]) };", "history: Object.freeze([record]) };", ["CC-31"]),
  C("reconcile-takes-the-callers-tenant", "CC-15", "const { tenant, connector, action } = state.starts[attempt - 1] as ConnectorStart;", "const { tenant, connector, action } = { ...state.starts[attempt - 1], ...request } as unknown as ConnectorStart;"),
  C("reconcile-drops-the-evidence", "CC-15", "idempotencyKey, attempt, finding, evidence, reconciledBy:", "idempotencyKey, attempt, finding, evidence: 'none', reconciledBy:", ["CC-31"]),
  C("evidence-may-hold-a-credential", "CC-15", "return matches(EVIDENCE, value) && !holdsSecretShape(value) && !RAW_CREDENTIAL_RUN.test(value);", "return matches(EVIDENCE, value) && !RAW_CREDENTIAL_RUN.test(value);", ["CC-4", "CC-26"]),
  C("evidence-long-run-not-scanned", "CC-15", "return matches(EVIDENCE, value) && !holdsSecretShape(value) && !RAW_CREDENTIAL_RUN.test(value);", "return matches(EVIDENCE, value) && !holdsSecretShape(value);", ["CC-4", "CC-26", "CC-34"]),
  C("evidence-any-word", "CC-15", String.raw`const EVIDENCE = /^(?:provider:|commit:|docs\/)[A-Za-z0-9]`, String.raw`const EVIDENCE = /^(?:provider:|commit:|docs\/|)[A-Za-z0-9]`, ["CC-4", "CC-26"]),
  // CC-16
  ...Object.entries({ "rate-limited-never": ["rate_limited: 'after-backoff',", "rate_limited: 'never',"], "upstream-never": ["upstream_unavailable: 'after-backoff',", "upstream_unavailable: 'never',"],
    "denied-retried": ["permission_denied: 'never',", "permission_denied: 'after-backoff',"], "invalid-retried": ["invalid_input: 'never',", "invalid_input: 'after-backoff',"],
    "auth-retried-blind": ["authentication_required: 'after-reauthentication',", "authentication_required: 'after-backoff',"], "approval-retried-blind": ["approval_required: 'after-approval',", "approval_required: 'after-backoff',"] })
    .map(([name, [from, to]]) => C(name, "CC-16", from, to, name === "rate-limited-never" ? ["CC-30", "CC-32"] : ["CC-32"])),
  C("unknown-rule-misstated", "CC-16", "outcome_unknown: 'after-reconciliation',", "outcome_unknown: 'after-backoff',"),
  C("never-means-maybe", "CC-16", "  if (rules.includes('never')) return retryRefused('RETRY_NEVER', 'this cannot succeed under this key: a changed request is a new intent');\n", GONE, ["CC-32"]),
  C("reauthentication-ignored", "CC-16", "  if (rules.includes('after-reauthentication') && facts.reauthenticated !== true) return retryRefused('RETRY_NEEDS_REAUTHENTICATION', 'the connector needs re-authenticating first');\n", GONE, ["CC-32"]),
  C("approval-ignored", "CC-16", "  if (rules.includes('after-approval') && facts.approved !== true) return retryRefused('RETRY_NEEDS_APPROVAL', 'this needs an approval first');\n", GONE, ["CC-32"]),
  C("reauthentication-truthy", "CC-16", "facts.reauthenticated !== true", "!facts.reauthenticated"),
  C("approval-truthy", "CC-16", "facts.approved !== true) return retryRefused('RETRY_NEEDS_APPROVAL'", "!facts.approved) return retryRefused('RETRY_NEEDS_APPROVAL'"),
  C("success-repeated", "CC-16", "  if (state.earlier !== null) return { ...retryRefused('RETRY_ALREADY_COMPLETED', 'this key already completed, so it does not run again'), earlier: state.earlier };\n", GONE, ["CC-15", "CC-35"]),
  C("attempts-unbounded", "CC-16", "  if (state.starts.length >= CONNECTOR_MAX_ATTEMPTS) return retryRefused('RETRY_ATTEMPTS_EXHAUSTED', `this key has used its ${CONNECTOR_MAX_ATTEMPTS} attempts`);\n", GONE),
  C("attempts-one-late", "CC-16", "state.starts.length >= CONNECTOR_MAX_ATTEMPTS", "state.starts.length > CONNECTOR_MAX_ATTEMPTS"),
  C("attempts-one-early", "CC-16", "state.starts.length >= CONNECTOR_MAX_ATTEMPTS", "state.starts.length + 1 >= CONNECTOR_MAX_ATTEMPTS"),
  C("bound-raised", "CC-16", "CONNECTOR_MAX_ATTEMPTS = 5;", "CONNECTOR_MAX_ATTEMPTS = 50;"),
  C("attempt-not-counted", "CC-16", "return { allowed: true, attempt: state.starts.length + 1, rule: state.lastRule as ConnectorRetryRule };", "return { allowed: true, attempt: 1, rule: state.lastRule as ConnectorRetryRule };", ["CC-15", "CC-30", "CC-32"]),
  C("gate-drops-the-attempt", "CC-16", "const call: ConnectorCall = Object.freeze({ connector, envelope, attempt: retry.attempt });", "const call: ConnectorCall = Object.freeze({ connector, envelope, attempt: 1 });"),
  // CC-17
  C("bad-line-skipped", "CC-17", "return lines === null || lines.some((line) => line === null) ? null : (lines as readonly HistoryLine[]);", "return lines === null ? null : (lines.filter((line) => line !== null) as readonly HistoryLine[]);", ["CC-15", "CC-30"]),
  C("no-history-reads-as-empty", "CC-17", "const lines = itemsOf(plainCopy(history))?.map(parseHistoryLine) ?? null;", "const lines = itemsOf(plainCopy(history))?.map(parseHistoryLine) ?? [];"),
  C("tenant-crossing-tolerated", "CC-17", "own.some((line) => line.tenant !== tenant) || ", GONE),
  C("action-crossing-tolerated", "CC-17", " || new Set(own.map((line) => line.action)).size > 1", GONE),
  C("reconciliation-with-nothing-open-tolerated", "CC-31", "return state.answered.includes(line.attempt) ? state : { ...state, broken: true };", "return state;"),
  C("reconciliation-line-needs-no-evidence", "CC-17", "includes(record['finding']) && isEvidence(record['evidence']);", "includes(record['finding']);"),
  C("reconciliation-line-any-field", "CC-17", "unknownFieldProblems(record, RECONCILIATION_FIELDS, 'a reconciliation').length === 0 && ", GONE),
  C("reconciliation-line-free-text-reconciler", "CC-17", "const signed = matches(RECONCILER, record['reconciledBy']) && ", "const signed = "),
  C("reconciliation-line-names-no-envelope", "CC-17", "matches(ENVELOPE_ID, record['reconcilerEnvelope']) && ", GONE),
  C("key-shape-not-asked", "CC-17", "  if (!matches(IDEMPOTENCY_KEY, idempotencyKey)) return retryRefused('RETRY_KEY_INVALID', 'that is not an idempotency key');\n", GONE),
  C("broken-history-judged-anyway", "CC-30", "return contradicts || state.broken ? null : state;", "return contradicts ? null : state;", ["CC-31"]),
  // CC-18
  C("receipt-unknown-field-tolerated", "CC-18", "    ...Object.keys(record)\n      .filter((key) => !(RECEIPT_FIELDS as readonly string[]).includes(key))\n      .map((key) => `the receipt carries an unknown field '${key}'`),\n", GONE, ["CC-19"]),
  C("receipt-field-optional", "CC-18", "      if (!Object.hasOwn(record, field)) return [`the receipt has no ${field}`];\n", "      if (!Object.hasOwn(record, field)) return [];\n"),
  C("receipt-field-unjudged", "CC-18", "return RECEIPT_CHECKS[field](record[field]) ? [] : [`the receipt's ${field} is unparseable`];", "return [];", ["CC-34"]),
  C("receipt-credential-not-scanned", "CC-18", "    ...RECEIPT_FIELDS.filter((field) => typeof record[field] === 'string' && holdsSecretShape(record[field])).map((field) => `the receipt's ${field} looks like a credential`),\n", GONE),
  C("receipt-credential-repeated", "CC-18", "`the receipt's ${field} looks like a credential`", "`the receipt's ${field} looks like a credential: ${String(record[field])}`"),
  C("receipt-unknown-code-not-named", "CC-18", "return receiptRefused('RECEIPT_ERROR_CODE_UNKNOWN',", "return receiptRefused('RECEIPT_INVALID',"),
  C("receipt-unknown-code-tolerated", "CC-18", "  if (receipt.errorCode !== null && !parseConnectorError(receipt.errorCode).ok) return receiptRefused('RECEIPT_ERROR_CODE_UNKNOWN', ['the receipt names an error that is not a code of the contract']);\n", GONE, ["CC-17"]),
  C("receipt-outcome-unchecked", "CC-18", "return problem === null ? { ok: true, receipt } : receiptRefused('RECEIPT_INVALID', [problem]);", "return { ok: true, receipt };", ["CC-34"]),
  C("success-may-carry-a-code", "CC-18", "    if (errorCode !== null) return 'a success carries no error code';\n", GONE),
  C("unknown-may-carry-any-code", "CC-18", "if (outcome === 'unknown') return errorCode === 'outcome_unknown' ? null : 'an unknown outcome carries outcome_unknown';", "if (outcome === 'unknown') return null;"),
  C("failure-may-claim-unknown", "CC-18", "return errorCode === null || errorCode === 'outcome_unknown' ? 'a failure names", "return errorCode === null ? 'a failure names"),
  C("failure-needs-no-code", "CC-18", "return errorCode === null || errorCode === 'outcome_unknown' ? 'a failure names", "return errorCode === 'outcome_unknown' ? 'a failure names"),
  C("receipt-gains-a-payload", "CC-18", "const RECEIPT_FIELDS = [...CALL_FIELDS, 'outcome', 'errorCode', 'providerReceipt'] as const;", "const RECEIPT_FIELDS = [...CALL_FIELDS, 'outcome', 'errorCode', 'providerReceipt', 'payload'] as const;", ["CC-14", "CC-15", "CC-16", "CC-19", "CC-23", "CC-30", "CC-31", "CC-32", "CC-35", "CC-36"]),
  // CC-19
  C("receipt-tenant-not-compared", "CC-19", "  if (receipt.tenant !== envelope.tenant) return receiptRefused('RECEIPT_TENANT_MISMATCH', [`the receipt is for ${receipt.tenant}, and the envelope is ${envelope.tenant}`]);\n", GONE),
  C("receipt-tenant-misnamed", "CC-19", "return receiptRefused('RECEIPT_TENANT_MISMATCH',", "return receiptRefused('RECEIPT_CALL_MISMATCH',"),
  C("receipt-connector-not-compared", "CC-19", "const expected = { connector: connector.connectorId, action: envelope.action, idempotencyKey: envelope.idempotencyKey, attempt } as const;", "const expected = { action: envelope.action, idempotencyKey: envelope.idempotencyKey, attempt } as const;"),
  C("receipt-action-not-compared", "CC-19", "const expected = { connector: connector.connectorId, action: envelope.action, idempotencyKey: envelope.idempotencyKey, attempt } as const;", "const expected = { connector: connector.connectorId, idempotencyKey: envelope.idempotencyKey, attempt } as const;"),
  C("receipt-key-not-compared", "CC-19", "const expected = { connector: connector.connectorId, action: envelope.action, idempotencyKey: envelope.idempotencyKey, attempt } as const;", "const expected = { connector: connector.connectorId, action: envelope.action, attempt } as const;"),
  C("receipt-attempt-not-compared", "CC-19", "const expected = { connector: connector.connectorId, action: envelope.action, idempotencyKey: envelope.idempotencyKey, attempt } as const;", "const expected = { connector: connector.connectorId, action: envelope.action, idempotencyKey: envelope.idempotencyKey } as const;"),
  C("receipt-mismatch-ignored", "CC-19", "return differs.length > 0 ? receiptRefused('RECEIPT_CALL_MISMATCH', differs.map((field) => `the receipt's ${field} is not the call's`)) : parsed;", "return parsed;"),
  C("receipt-takes-any-call", "CC-19", "  if (!LIVE_CALLS.has(call)) return receiptRefused('RECEIPT_CALL_UNADMITTED', ['the gate did not admit this call']);\n", GONE),
  C("call-never-branded", "CC-19", "  LIVE_CALLS.add(call);\n", GONE),
  // CC-20
  C("scenario-dropped", "CC-20", "  defined('cancellation', 'The owner cancels work in flight.', 'No new connector call starts, and an in-flight call reports how it ended.'),\n", GONE, ["CC-26"]),
  C("scenario-renamed", "CC-20", "defined('provider-outage',", "defined('provider-down',", ["CC-26"]),
  C("scenario-given-blank", "CC-20", "defined('cancellation', 'The owner cancels work in flight.',", "defined('cancellation', ' ',"),
  C("a-defined-scenario-counted-as-proved", "CC-20", "Object.freeze({ id, given, expect, status: 'defined', firstRun: 'stage-5', proof: null });", "Object.freeze({ id, given, expect, status: 'proved', firstRun: 'stage-5', proof: null });"),
  C("a-defined-scenario-runs-in-stage-2", "CC-20", "status: 'defined', firstRun: 'stage-5', proof: null });", "status: 'defined', firstRun: 'stage-2', proof: null });"),
  C("a-defined-scenario-claims-a-proof", "CC-20", "status: 'defined', firstRun: 'stage-5', proof: null });", "status: 'defined', firstRun: 'stage-5', proof: 'x' });"),
  C("cross-tenant-only-defined", "CC-20", "    status: 'proved',\n    firstRun: 'stage-2',\n", "    status: 'defined',\n    firstRun: 'stage-5',\n"),
  C("cross-tenant-names-no-proof", "CC-20", "    proof: 'projectos/core/test/connector-contract.test.ts',\n", "    proof: null,\n"),
  C("tally-counts-defined-as-proved", "CC-20", "proved: count('proved'), defined: count('defined') };", "proved: ACCEPTANCE_SCENARIOS.length, defined: count('defined') };"),
  C("tally-gains-a-passed-count", "CC-20", "proved: count('proved'), defined: count('defined') };", "proved: count('proved'), defined: count('defined'), passed: ACCEPTANCE_SCENARIOS.length };"),
  C("scenario-table-editable", "CC-20", "export const ACCEPTANCE_SCENARIOS: readonly AcceptanceScenario[] = Object.freeze([", "export const ACCEPTANCE_SCENARIOS: readonly AcceptanceScenario[] = ([", []),
  // CC-21
  C("tenant-not-compared", "CC-21", "if (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain) return", "if (connector.domain !== envelope.domain) return"),
  C("domain-not-compared", "CC-21", "if (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain) return", "if (connector.tenant !== envelope.tenant) return"),
  C("cross-tenant-never", "CC-21", "if (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain) return", "if (false) return"),
  C("cross-tenant-misnamed", "CC-21", "return callRefused('CONNECTOR_CROSS_TENANT',", "return callRefused('CONNECTOR_UNKNOWN',"),
  C("owner-passes-the-tenant-check", "CC-21", "if (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain) return", "if (envelope.principal !== 'owner' && (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain)) return"),
  C("cross-tenant-action-opens-the-door", "CC-21", "if (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain) return", "if (envelope.action !== 'cross-tenant-access' && (connector.tenant !== envelope.tenant || connector.domain !== envelope.domain)) return"),
  // CC-22
  C("gate-takes-any-registry", "CC-22", "  if (!LIVE_REGISTRIES.has(registry)) return callRefused('CONNECTOR_REGISTRY_INVALID', ['this registry did not pass whole-file validation']);\n", GONE),
  C("registry-never-branded", "CC-22", "  LIVE_REGISTRIES.add(registry);\n", GONE, ["CC-8", "CC-11", "CC-12", "CC-14", "CC-16", "CC-17", "CC-19", "CC-21", "CC-23", "CC-30", "CC-35"]),
  C("gate-takes-any-envelope", "CC-22", "  if (!admittedAtTheDoor(envelope, now)) return callRefused('CONNECTOR_ENVELOPE_NOT_ADMITTED', ['this envelope was not admitted at the door']);\n", GONE),
  C("door-probe-always-yes", "CC-22", "return recordExecution(envelope, 'allowed', null, now, () => true);", "return true;", ["CC-31"]),
  C("door-probe-always-no", "CC-22", "return recordExecution(envelope, 'allowed', null, now, () => true);", "return false;", ["CC-8", "CC-11", "CC-12", "CC-14", "CC-15", "CC-16", "CC-17", "CC-19", "CC-21", "CC-23", "CC-30", "CC-31", "CC-35"]),
  C("gate-skips-expiry", "CC-22", "  if (envelopeExpired(envelope, now)) return callRefused('CONNECTOR_ENVELOPE_EXPIRED', [`the envelope expired at ${envelope.expiry}`]);\n", GONE),
  C("undeclared-action-allowed", "CC-22", "  if (!connector.actions.includes(envelope.action)) return callRefused('CONNECTOR_ACTION_UNDECLARED', [`'${connector.connectorId}' does not declare '${envelope.action}'`]);\n", GONE),
  C("unlisted-connector-falls-to-the-first", "CC-22", "const connector = registry.connectors.find((candidate) => candidate.connectorId === connectorId);", "const connector = registry.connectors[0];", ["CC-8", "CC-21"]),
  // CC-23
  C("registry-not-frozen", "CC-23", "const registry: ConnectorRegistry = Object.freeze({ connectors: Object.freeze((connectors as readonly unknown[]).map(connectorOf)) });", "const registry: ConnectorRegistry = { connectors: Object.freeze((connectors as readonly unknown[]).map(connectorOf)) };"),
  C("connector-list-not-frozen", "CC-23", "Object.freeze({ connectors: Object.freeze((connectors as readonly unknown[]).map(connectorOf)) });", "Object.freeze({ connectors: (connectors as readonly unknown[]).map(connectorOf) });"),
  C("entry-not-frozen", "CC-23", "return Object.freeze({ ...entry, ...lists, releaseRecord }) as unknown as ConnectorEntry;", "return ({ ...entry, ...lists, releaseRecord }) as unknown as ConnectorEntry;"),
  C("record-not-frozen", "CC-23", "const releaseRecord = Object.freeze({ ...release,", "const releaseRecord = ({ ...release,"),
  C("list-not-frozen", "CC-23", "return Object.freeze([...textsOf(value)]);", "return [...textsOf(value)];"),
  C("receipt-not-frozen", "CC-23", "const receipt = Object.freeze(record) as unknown as ConnectorReceipt;", "const receipt = record as unknown as ConnectorReceipt;"),
  C("reconciliation-not-frozen", "CC-23", "const record: ConnectorReconciliation = Object.freeze({ tenant,", "const record: ConnectorReconciliation = ({ tenant,"),
  C("new-history-not-frozen", "CC-23", "history: Object.freeze([...lines, record]) };", "history: [...lines, record] };"),
  C("call-not-frozen", "CC-23", "const call: ConnectorCall = Object.freeze({ connector, envelope, attempt: retry.attempt });", "const call: ConnectorCall = { connector, envelope, attempt: retry.attempt };"),
  C("retry-table-editable", "CC-23", "Readonly<Record<ConnectorErrorCode, ConnectorRetryRule>> = Object.freeze({", "Readonly<Record<ConnectorErrorCode, ConnectorRetryRule>> = ({"),
  // CC-30
  C("a-start-with-no-receipt-is-fine", "CC-30", "return state.awaiting === null ? state.unanswered : [...state.unanswered, state.awaiting];", "return state.unanswered;", ["CC-31"]),
  C("a-superseded-start-is-forgotten", "CC-30", "const unanswered = state.awaiting === null ? state.unanswered : [...state.unanswered, state.awaiting];", "const unanswered = state.unanswered;", ["CC-31"]),
  C("a-receipt-closes-any-attempt", "CC-30", "if (state.awaiting !== line.attempt || state.starts[line.attempt - 1]?.connector !== line.connector) return { ...state, broken: true };", "if (state.starts[line.attempt - 1]?.connector !== line.connector) return { ...state, broken: true };"),
  C("a-receipt-closes-any-connector", "CC-30", "if (state.awaiting !== line.attempt || state.starts[line.attempt - 1]?.connector !== line.connector) return { ...state, broken: true };", "if (state.awaiting !== line.attempt) return { ...state, broken: true };"),
  C("a-start-may-come-in-any-order", "CC-30", "  if (line.attempt !== state.starts.length + 1) return { ...state, broken: true };\n", GONE),
  C("admission-returns-no-start", "CC-30", "started: Object.freeze({ tenant, connector: connector.connectorId, action, idempotencyKey, attempt: retry.attempt, envelopeId }) };", "started: null as never };"),
  C("the-start-names-the-wrong-attempt", "CC-30", "action, idempotencyKey, attempt: retry.attempt, envelopeId }) };", "action, idempotencyKey, attempt: 1, envelopeId }) };"),
  C("the-start-is-not-frozen", "CC-30", "started: Object.freeze({ tenant, connector: connector.connectorId, action, idempotencyKey, attempt: retry.attempt, envelopeId }) };", "started: { tenant, connector: connector.connectorId, action, idempotencyKey, attempt: retry.attempt, envelopeId } };"),
  C("a-start-line-any-field", "CC-30", "const sound = unknownFieldProblems(record, START_FIELDS, 'a start').length === 0 && namesItsCall(record)", "const sound = namesItsCall(record)"),
  C("a-start-line-any-envelope", "CC-30", " && namesItsCall(record) && matches(ENVELOPE_ID, record['envelopeId']);", " && namesItsCall(record);"),
  // CC-31
  C("a-copy-answers-again", "CC-31", "const open = state.awaiting === line.attempt || state.unanswered.includes(line.attempt);", "const open = state.awaiting !== null || state.unanswered.length > 0;"),
  C("another-connector-answers", "CC-31", "  if (state.starts[line.attempt - 1]?.connector !== line.connector) return state;\n", GONE),
  C("reconcile-action-not-asked", "CC-31", "  if (!resolveAction(actions, CONNECTOR_RECONCILE_ACTION).registered) return reconciliationRefused('RECONCILE_ACTION_UNREGISTERED', `'${CONNECTOR_RECONCILE_ACTION}' is not in the action registry yet`);\n", GONE),
  C("reconcile-any-envelope", "CC-31", "if (!admittedAtTheDoor(envelope, now) || envelopeExpired(envelope, now) ||", "if (envelopeExpired(envelope, now) ||"),
  C("reconcile-after-expiry", "CC-31", "if (!admittedAtTheDoor(envelope, now) || envelopeExpired(envelope, now) ||", "if (!admittedAtTheDoor(envelope, now) ||"),
  C("reconcile-any-action", "CC-31", " || envelope.action !== CONNECTOR_RECONCILE_ACTION || foreign) {", " || foreign) {"),
  C("reconcile-any-tenant", "CC-31", " || envelope.action !== CONNECTOR_RECONCILE_ACTION || foreign) {", " || envelope.action !== CONNECTOR_RECONCILE_ACTION) {"),
  C("reconciler-from-free-text", "CC-31", "reconciledBy: envelope.principal, reconcilerEnvelope", "reconciledBy: String((request as unknown as Record<string, unknown>)['reconciledBy'] ?? envelope.principal), reconcilerEnvelope"),
  C("reconciler-names-no-envelope", "CC-31", "reconcilerEnvelope: envelope.envelopeId,", "reconcilerEnvelope: DOOR_PROBE_ID,", ["CC-15"]),
  C("newest-attempt-answered-first", "CC-31", "const attempt = openAttempts(state)[0];", "const attempt = openAttempts(state).at(-1);"),
  C("reconcile-action-renamed", "CC-31", "export const CONNECTOR_RECONCILE_ACTION = 'connector-reconcile';", "export const CONNECTOR_RECONCILE_ACTION = 'bridge-read';", ["CC-15", "CC-23"]),
  // CC-32
  C("a-stop-reads-only-the-last-line", "CC-32", "const rules = state.failures.map((code) => CONNECTOR_RETRY_RULES[code]);", "const rules = state.failures.slice(-1).map((code) => CONNECTOR_RETRY_RULES[code]);"),
  // CC-33
  C("the-door-is-not-asked", "CC-33", "const refusal = doorRefusal(action, context);", "const refusal = null as string | null;"),
  C("the-door-answer-is-ignored", "CC-33", "return admission.admitted ? null : admission.rule;", "return null;"),
  C("the-door-grants-everything", "CC-33", "admitEnvelope(minted, DOOR_PROBE_NOW, () => true, () => false);", "admitEnvelope(minted, DOOR_PROBE_NOW, () => true, () => true);"),
  C("the-door-refusal-says-nothing", "CC-33", "`the door refuses ${at} to a connector: ${refusal}`", "`the door refuses ${at} to a connector`"),
  C("the-door-probe-always-refuses", "CC-33", "return admission.admitted ? null : admission.rule;", "return admission.admitted ? 'P5_NO_GRANT' : admission.rule;", ["CC-1", "CC-5", "CC-6", "CC-8", "CC-11", "CC-12", "CC-14", "CC-16", "CC-17", "CC-19", "CC-21", "CC-22", "CC-23", "CC-30", "CC-35", "CC-36"]),
  // CC-34
  C("a-success-needs-no-receipt", "CC-34", "return providerReceipt === null ? 'a success points at its provider receipt' : null;", "return null;"),
  C("a-provider-receipt-may-point-anywhere", "CC-34", "(matches(PROVIDER_RECEIPT, value) && isEvidence(value))", "isEvidence(value)"),
  C("a-provider-receipt-may-be-any-text", "CC-34", "(matches(PROVIDER_RECEIPT, value) && isEvidence(value))", "typeof value === 'string'"),
  // CC-35
  C("a-duplicate-gets-a-bare-refusal", "CC-35", "'this key already completed, so it does not run again'), earlier: state.earlier };", "'this key already completed, so it does not run again') };"),
  C("the-gate-drops-the-earlier-outcome", "CC-35", "if (!retry.allowed) return { ...callRefused(retry.code, retry.reasons), ...(retry.earlier === undefined ? {} : { earlier: retry.earlier }) };", "if (!retry.allowed) return callRefused(retry.code, retry.reasons);"),
  C("the-first-outcome-is-overwritten", "CC-35", "if (line.outcome === 'succeeded') return { ...closed, earlier: state.earlier ?? line };", "if (line.outcome === 'succeeded') return { ...closed, earlier: null };", ["CC-16"]),
  // CC-36
  C("the-receipt-is-judged-in-place", "CC-36", "const record = asRecord(plainCopy(raw));\n  if (record === null) return receiptRefused(", "const record = asRecord(raw);\n  if (record === null) return receiptRefused("),
  C("the-registry-is-judged-in-place", "CC-36", "const root = asRecord(plainCopy(raw));", "const root = asRecord(raw);", ["CC-10"]),
  C("a-throwing-getter-escapes", "CC-36", "  try {\n    return JSON.parse(JSON.stringify(raw) ?? 'null');\n  } catch {\n    return undefined;\n  }\n", "  return JSON.parse(JSON.stringify(raw) ?? 'null');\n"),
  // CC-37
  C("an-unregistered-action-is-repeated", "CC-37", "`${at} is not in the action registry, so it is ${resolved.actionClass} and refused`", "`${action} is not in the action registry, so it is ${resolved.actionClass} and refused`"),
  C("a-read-only-action-is-repeated", "CC-37", "`${label} says read-only, and ${at} is ${resolved.actionClass}`", "`${label} says read-only, and ${action} is ${resolved.actionClass}`"),
  C("a-repeated-id-is-repeated", "CC-37", "`connectors[${index}] repeats an earlier connector's id`", "`connectors[${index}] repeats the id ${id}`"),
  // CC-24
  T("contract-reads-the-clock", "CC-24", CONTRACT, "const at = readInstant(now);", "const at = Date.now();"),
  T("contract-news-a-date", "CC-24", CONTRACT, "const at = readInstant(now);", "const at = new Date().getTime();"),
  T("contract-reads-the-environment", "CC-24", CONTRACT, "const at = readInstant(now);", "const at = readInstant(process.env.NOW);"),
  T("contract-imports-the-filesystem", "CC-24", CONTRACT, "import { holdsSecretShape } from './context/redact.js';", "import { holdsSecretShape } from './context/redact.js';\nimport { readFileSync } from 'node:fs';"),
  T("contract-gains-a-dependency", "CC-24", CONTRACT, "import { holdsSecretShape } from './context/redact.js';", "import { holdsSecretShape } from './context/redact.js';\nimport { z } from 'zod';"),
  T("contract-calls-the-network", "CC-24", CONTRACT, "  const retry = decideConnectorRetry(history,", "  void fetch('https://example.invalid');\n  const retry = decideConnectorRetry(history,"),
  T("contract-imports-dynamically", "CC-24", CONTRACT, "  const retry = decideConnectorRetry(history,", "  void import('node:fs');\n  const retry = decideConnectorRetry(history,"),
  T("contract-holds-a-mangled-escape", "CC-24", CONTRACT, "const VERSION = /^", "const VERSION = /\u0008^", ["CC-26"]),
  T("contract-falls-back-to-the-clock", "CC-24", CONTRACT, "const at = readInstant(now);", "const at = readInstant(now) ?? Date.now();"),
  // CC-25
  M("registry-gains-a-qualified-connector", "CC-25", REGISTRY, NO_CONNECTORS, `"connectors": [${QUALIFIED}]`),
  M("registry-gains-an-unqualified-connector", "CC-25", REGISTRY, NO_CONNECTORS, `"connectors": [${UNQUALIFIED}]`, ["CC-26", "CC-29"]),
  // CC-26
  T("schema-pattern-drifts-id", "CC-26", SCHEMA, '"pattern": "^[a-z][a-z0-9-]{1,63}$"\n    },\n    "version"', '"pattern": "^.+$"\n    },\n    "version"'),
  T("schema-pattern-drifts-reference", "CC-26", SCHEMA, '"pattern": "^ProjectOS/(', '"pattern": "^(?:.+)ProjectOS/('),
  T("schema-tenant-drifts", "CC-26", SCHEMA, '"pattern": "^[a-z][a-z0-9-]{1,56}$"', '"pattern": "^[a-z].*$"'),
  T("schema-action-drifts", "CC-26", SCHEMA, '"pattern": "^[a-z][a-z0-9_-]{1,63}$"', '"pattern": "^.+$"'),
  T("schema-evidence-drifts", "CC-26", SCHEMA, '"pattern": "^(?:provider:|commit:|docs/)', '"pattern": "^(?:|provider:|commit:|docs/)'),
  T("schema-raw-run-dropped", "CC-26", SCHEMA, '"pattern": "[A-Za-z0-9]{24,}|/(?:', '"pattern": "x{99}|/(?:'),
  T("schema-split-run-dropped", "CC-26", SCHEMA, '|/(?:[A-Za-z0-9][._-]?){24,}$|', '|'),
  T("schema-evidence-credential-allowed", "CC-26", SCHEMA, '"pattern": "[A-Za-z0-9]{24,}|[:/](?:', '"pattern": "x{99}|[:/]x(?:'),
  T("schema-prose-may-be-blank", "CC-26", SCHEMA, '"authority": {\n      "type": "string",\n      "minLength": 1,\n      "pattern": "\\\\S"\n    }', '"authority": {\n      "type": "string",\n      "minLength": 1\n    }'),
  T("schema-year-any-length", "CC-26", SCHEMA, '"pattern": "^[0-9]{4}-[0-9]{2}', '"pattern": "^[+0-9]+-[0-9]{2}'),
  T("schema-tolerates-extra-registry-fields", "CC-26", SCHEMA, '"type": "object",\n  "additionalProperties": false,', '"type": "object",\n  "additionalProperties": true,'),
  T("schema-tolerates-extra-entry-fields", "CC-26", SCHEMA, '"connector": {\n      "type": "object",\n      "additionalProperties": false,', '"connector": {\n      "type": "object",\n      "additionalProperties": true,'),
  T("schema-tolerates-extra-record-fields", "CC-26", SCHEMA, '"releaseRecord": {\n      "type": "object",\n      "additionalProperties": false,', '"releaseRecord": {\n      "type": "object",\n      "additionalProperties": true,'),
  T("schema-tenant-optional", "CC-26", SCHEMA, '"version",\n        "tenant",\n        "domain",', '"version",\n        "domain",'),
  T("schema-reference-optional", "CC-26", SCHEMA, '"scopes",\n        "secretReference",\n', '"scopes",\n'),
  T("schema-release-optional", "CC-26", SCHEMA, '"lastAcceptanceDate",\n        "releaseRecord"\n', '"lastAcceptanceDate"\n'),
  T("schema-result-any", "CC-26", SCHEMA, '"result": {\n          "const": "passed"\n        }', '"result": {\n          "type": "string"\n        }'),
  T("schema-domain-drifts", "CC-26", SCHEMA, '"personal",\n            "phone"\n', '"personal"\n'),
  T("schema-idempotency-gains-none", "CC-26", SCHEMA, '"read-only"\n', '"read-only",\n            "none"\n'),
  T("schema-checklist-drifts", "CC-26", SCHEMA, '"audit-logs",\n              "operational-owner"\n', '"operational-owner"\n'),
  T("schema-scenario-drifts", "CC-26", SCHEMA, '"missing-evidence",\n              "provider-outage"\n', '"provider-outage"\n'),
  T("schema-keyword-not-understood", "CC-26", SCHEMA, '"title": "ProjectOS Connector Registry",', '"title": "ProjectOS Connector Registry",\n  "if": {},'),
  T("reference-format-drifts", "CC-26", REFERENCE, "const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;", "const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;"),
  T("reference-environment-drifts", "CC-26", REFERENCE, 'const ENVIRONMENTS = Object.freeze(["development", "staging", "production"]);', 'const ENVIRONMENTS = Object.freeze(["development", "production"]);'),
  T("idempotency-shape-drifts", "CC-26", ENVELOPE, "const IDEMPOTENCY_KEY = /^sha256:[0-9a-f]{64}$/;", "const IDEMPOTENCY_KEY = /^sha512:[0-9a-f]{128}$/;"),
  // CC-27
  T("barrel-omits-the-contract", "CC-27", BARREL, "export * from './connectorContract.js';\n", GONE),
  T("validate-all-omits-this-validator", "CC-27", VA, `,\n  // PROJECTOS-CONNECTOR-CONTRACT1A — the connector rules with no connector: registry, release gate, receipt, error vocabulary.\n  "${THIS_VALIDATOR}"\n`, "\n"),
  T("cached-runner-omits-this-validator", "CC-27", CR, `,\n  // PROJECTOS-CONNECTOR-CONTRACT1A — the connector rules with no connector: registry, release gate, receipt, error vocabulary.\n  "${THIS_VALIDATOR}"\n`, "\n"),
  // CC-28
  T("a-proof-skipped", "CC-28", TEST_FILE, "it('a retry after outcome_unknown is refused until reconciled'", "it.skip('a retry after outcome_unknown is refused until reconciled'"),
  T("a-proof-isolated", "CC-28", TEST_FILE, "it('a receipt whose tenant differs from the envelope is refused'", "it.only('a receipt whose tenant differs from the envelope is refused'"),
  T("a-table-skipped", "CC-28", TEST_FILE, "it.each([\n    ['another tenant', 'ProjectOS/tenant.owner-personal/production/google/mail-refresh'],", "it.skip.each([\n    ['another tenant', 'ProjectOS/tenant.owner-personal/production/google/mail-refresh'],"),
  T("a-suite-skipped", "CC-28", TEST_FILE, "describe('cross-tenant denial', () => {", "describe.skip('cross-tenant denial', () => {"),
  T("a-proof-commented-out", "CC-28", TEST_FILE, "  it('an envelope of one tenant cannot use a connector of the other, in either direction'", "  // it('an envelope of one tenant cannot use a connector of the other, in either direction'"),
  T("a-proof-deleted", "CC-28", TEST_FILE, "it('the tally never counts a defined scenario as passed'", "it('the tally is a tally'"),
  // CC-29
  M("registry-loses-its-policy", "CC-29", REGISTRY, '"policy": "connector-registry"', '"policy": "tenant-registry"', ["CC-26"]),
  M("registry-loses-its-authority", "CC-29", REGISTRY, '"authority": "owner"', '"authority": ""', ["CC-26"]),
  M("registry-any-schema-version", "CC-29", REGISTRY, '"schemaVersion": "1.0.0"', '"schemaVersion": "2.0.0"', ["CC-26"]),
];

const apply = (text, m) => text.split(m.from).join(m.to);

function selfTest(raw, dir) {
  const errors = [];
  for (const m of MUTATIONS) {
    if (typeof raw[m.rel] !== "string" || !raw[m.rel].includes(m.from)) {
      errors.push(`CC-M: mutation '${m.name}' no longer applies to ${m.rel}; update it with the rule`);
      continue;
    }
    const changed = { ...raw, [m.rel]: apply(raw[m.rel], m) };
    const fired = textProblems(changed).map(([rule]) => rule);
    if (m.text !== true) {
      try {
        fired.push(...behaviourProblems(load(dir, changed), changed).map(([rule]) => rule));
      } catch (error) {
        errors.push(`CC-M: mutation '${m.name}' would not load: ${error.message}`);
        continue;
      }
    }
    const got = [...new Set(fired)].sort();
    const wanted = [...new Set([m.rule, ...m.also])].sort();
    if (!same(got, wanted)) errors.push(`CC-M: mutation '${m.name}' wanted ${wanted.join(", ")} and fired ${got.join(", ") || "nothing"}`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("CC-M: two mutations share a name");
  const proved = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of Object.keys(RULE_NAMES)) if (!proved.has(rule)) errors.push(`CC-M: rule ${rule} has no named mutation`);
  return errors;
}

function readAll() {
  return Object.fromEntries(SOURCES.map((rel) => [rel, read(rel)]));
}

function run() {
  if (process.features.typescript === false) return [`${THIS_VALIDATOR} needs Node's built-in type stripping, and this Node has none`];
  const raw = readAll();
  const missing = Object.keys(raw).filter((rel) => raw[rel] === null);
  if (missing.length > 0) return missing.map((rel) => `CC-27 ${RULE_NAMES["CC-27"]}: ${rel} is missing`);
  return scratch.withScratch("connector-contract", (dir) => {
    const base = [...textProblems(raw), ...behaviourProblems(load(dir, raw), raw)].map(([, message]) => message);
    return base.length > 0 ? base : selfTest(raw, dir);
  });
}

if (require.main === module) {
  const errors = run();
  if (errors.length > 0) {
    errors.forEach((x) => console.error(`FAIL: ${x}`));
    console.error(`${THIS_VALIDATOR}: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${Object.keys(RULE_NAMES).length} rules; ${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, selfTest, readAll, textProblems, behaviourProblems, applyMutation: apply, MUTATIONS, RULE_NAMES };
