"use strict";
/**
 * PROVIDER ROLES — PROJECTOS-PROVIDER-ROLES1A (plan 4.2, first slice).
 *
 * A committed role registry names which already-authorised worker, or the committed gatekeeper route, fills each
 * role, with capabilities from a closed list and a cost class. Selection and recording only. Each rule below is
 * pinned because every way of undoing it reads reasonably in a diff:
 *
 *   PR-1  "a role may name any provider"          — and a role names a worker the project never authorised, or a route
 *         that is not the committed gatekeeper
 *   PR-2  "a price can be filled in later"        — and a metered cost names no rate card, or a zero price
 *   PR-3  "another capability is harmless"        — and the closed list is open
 *   PR-4  "a reference to the login is fine"      — and a key, a credential or an address field is read; or a hostile
 *         object answers differently the second time or makes the judge throw; or a huge file is parsed; or a hidden character
 *         or a key written twice is let through
 *   PR-5  "the working tree is the same file"     — and the registry is trusted from an edit nobody committed
 *   PR-6  "one worker can do both"                — and the implementer reviews its own work
 *   PR-7  "selection can say yes"                 — and a selection carries a verdict, or a gatekeeper role is
 *         reported as decided
 *   PR-8  "just one caller"                       — and the model broker is imported outside the report, or the report
 *         imports more than the registry reader
 *   PR-9  "wire it in later"                      — and the command is not dispatched, not read-only under the platform
 *         stop, or the validator is not registered where the Stage 3 validators expect it
 *   PR-10 "the record is only data"               — and the committed record names something the committed config
 *         does not authorise
 *   PR-11 "core can read the file"                — and the pure registry reaches outside itself
 *   PR-12 "let the loop consult it"               — and a run chooses a worker from a registry nobody reviewed for that
 *   PR-13 "any role may claim any capability"     — and a reviewer claims to implement, no implementer is named, or a reviewer is
 *         a worker that holds write grants
 *
 * Each rule has a NAMED MUTATION; `selfTest` applies it in memory and counts it killed only when THAT rule alone
 * fires. Comments are stripped first. Reads files; runs nothing, calls no provider.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-provider-roles1a";
const REGISTRY_REL = "projectos/core/src/modelBroker/roleRegistry.ts";
const CORE_BARREL_REL = "projectos/core/src/modelBroker/index.ts";
const CORE_INDEX_REL = "projectos/core/src/index.ts";
const CONFIG_REL = "projectos/agent/src/modelBroker/committedConfig.ts";
const ROLES_REL = "projectos/agent/src/commands/roles.ts";
const CLI_REL = "projectos/agent/src/cli.ts";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const RECORD_REL = ".projectops/provider-roles.json";
const PROJECT_CONFIG_REL = ".projectops/project-config.json";
const GATEKEEPER_REL = ".projectops/gatekeeper.json";
const PLATFORM_STOP_TEST_REL = "projectos/agent/test/platformStop.test.ts";
const CORE_SRC = "projectos/core/src";
const AGENT_SRC = "projectos/agent/src";
const CORE_BROKER_DIR = "projectos/core/src/modelBroker";
const AGENT_BROKER_DIR = "projectos/agent/src/modelBroker";
const RUNNER_REL = `${AGENT_SRC}/loop/runner.ts`;
const WORKERS_REL = `${AGENT_SRC}/loop/workers.ts`;
const STATUS_REL = `${AGENT_SRC}/commands/status.ts`;
const FIXED = [REGISTRY_REL, CORE_BARREL_REL, CORE_INDEX_REL, CONFIG_REL, ROLES_REL, CLI_REL, VA_REL, CR_REL];
const FOLLOWER = "val-projectos-memory-stores1a";

const TESTS = {
  "projectos/core/test/modelBroker-roles.test.ts": [
    "accepts a registry whose workers and transport are all known: the positive control",
    "refuses a worker that is not in the committed execution workers, and says what to do",
    "refuses a gatekeeper transport that is not the committed one, and any gatekeeper when none is committed",
    "refuses a worker role that names a transport and a gatekeeper role that names a worker",
    "a registry that parses is not thereby approved: it carries no verdict field",
    "refuses a metered model that has no committed rate card",
    "refuses a zero, missing or negative price, whichever side it is on",
    "refuses a metered cost with no model, an unmetered cost with a model, and a class that is neither",
    "the list is the one the roles actually use",
    "refuses a capability outside the list, an empty list, a duplicate and a non-array",
    "refuses a field named %s with its own code",
    "refuses the same name on the top level, inside a cost and inside the roles map",
    "refuses a note that carries a URL, a key-shaped run or a control character",
    "a name that is only a refusal reason: the report carries the name, never a value it held",
    "refuses a field that is an accessor, and never calls it",
    "refuses an object that is not plain: a class instance, a Map or an array where a record belongs",
    "the result does not move when the input is changed after it was read",
    "what comes back is frozen all the way down",
    "refuses a text over the size cap before it parses it, and text that is not JSON",
    "caps the refusals it returns, so a hostile file cannot make a report of any size",
    "every refusal is a value with a machine code, a plain reason and a next step",
    "refuses both roles naming the same worker, and names the worker",
    "accepts two different workers, and a registry with only one of the two roles",
    "an unknown worker does not hide the same-worker refusal, and both are reported",
    "returns the entry for an assigned worker role",
    "returns nothing for a role the registry does not carry, and for a name that is not a role",
    "a gatekeeper role reports awaiting: it is a route to a decision, and no decision is held here",
    "no selection carries a verdict, an approval or a decision",
    "selecting does not change the registry",
    "refuses the swap: the reviewer may not be the worker that holds write grants",
    "refuses a reviewer with any non-read grant, an ambiguous grant, or an unbalanced one, and accepts reads and no grants",
    "binds capabilities to roles: each role must carry its own, and none that belongs to another",
    "a gatekeeper may carry any mix of the gatekeeper capabilities so long as it carries gatekeeper-review",
    "requires an implementer: a registry with only a reviewer or only the gatekeeper is refused",
    "refuses a Proxy whose ownKeys throws, and a revoked Proxy, as NOT_A_RECORD",
    "a getPrototypeOf trap that throws is refused the same way",
    "a throwing getter is refused as ACCESSOR without being called, and a throwing toJSON is never called",
    "a Proxy whose descriptor or get trap throws is refused the same way",
    "text that is not a string, and sources that throw when read, are typed refusals and never a throw",
    "selecting with a hostile role name returns nothing instead of throwing",
    "still accepts ordinary text with accents and punctuation",
    "refuses a duplicate implementer role, a duplicate field inside a role and a duplicate top-level key",
    "sees through an escaped spelling of the same key",
    "does not mistake the same key in two different records, or a repeated string value, for a duplicate",
    "names the key, never a value",
  ],
  "projectos/agent/test/modelBroker-roles.test.ts": [
    "loads a registry through the committed reader and asks for that one path: the positive control",
    "a working-tree-only registry is refused: the reader has no committed copy to give",
    "refuses text that was not read at a commit, such as a working-tree read",
    "refuses a path that leaves the repository or names another file kind, so a path cannot pick other bytes",
    "judges committed text against what is authorised: an unknown worker or a credential field is refused",
    "prints each role, its worker, capabilities, cost and standing, and where it was read: the positive control",
    "writes nothing, and runs only git reads",
    "flags a working copy that differs from the committed one, and still shows the committed bytes",
    "refuses a registry that exists only in the working tree, and prints the next step",
    "refuses when there is no commit to read at, rather than reading the working tree",
    "prints registry text inert and capped: a control character or escape cannot reach the terminal",
    "is dispatched, appears in help and stays available while the platform stop is engaged",
    "reports TOO_LARGE with exit 2 when git output overflows the read bound",
    "a file that is simply not committed is still NOT_COMMITTED",
    "agrees with roleBindingProblems on %s",
    "the cases include both outcomes, so the agreement is not vacuous",
  ],
};

const PIN = {
  // The closed lists, as the code holds them.
  roleIds: "export const ROLE_IDS = ['implementer', 'reviewer', 'gatekeeper'] as const;",
  capabilities: "export const ROLE_CAPABILITIES = ['implement', 'review', 'gatekeeper-review', 'plan-authoring', 'closure-question'] as const;",
  costClasses: "export const COST_CLASSES = ['unmetered', 'metered'] as const;",
  // PR-1
  workerKnown: "const worker = typeof id === 'string' ? known.workers.find((w) => w.workerId === id) : undefined;",
  workerRefused: "if (worker === undefined) return [refusal('UNKNOWN_WORKER',",
  transportKnown: "const ok = typeof id === 'string' && known.gatekeeperTransportId !== null && id === known.gatekeeperTransportId;",
  routeUsed: "...routeProblems(role, row, known, at),",
  unknownWorker: "refusal('UNKNOWN_WORKER',",
  unknownTransport: "refusal('UNKNOWN_TRANSPORT',",
  workerKeys: "const WORKER_ROLE_KEYS = ['workerId', 'capabilities', 'cost', 'notes'];",
  gatekeeperKeys: "const GATEKEEPER_ROLE_KEYS = ['transportId', 'capabilities', 'cost', 'notes'];",
  roleKeysUsed: "...nameProblems(row, role === 'gatekeeper' ? GATEKEEPER_ROLE_KEYS : WORKER_ROLE_KEYS, at),",
  rolesClosed: "refusals.push(...names.filter((n) => !(ROLE_IDS as readonly string[]).includes(n)).map((n) =>",
  entryOnlyClean: "if (refusals.length > 0) return { entry: null, refusals };",
  okOnlyClean: "return refusals.length > 0 ? { ok: false, refusals: Object.freeze(refusals.slice(0, MAX_ROLE_REFUSALS)) } : { ok: true, registry: buildRegistry(entries) };",
  // PR-2
  rateCardImport: "import { rateCardProblems, type RateCard } from '../gatekeeperCostLedger.js';",
  cardLookup: "const card = Object.prototype.hasOwnProperty.call(known.rateCards, model) ? known.rateCards[model] : undefined;",
  noCard: "if (card === undefined) return [...problems, refusal('UNKNOWN_MODEL',",
  zeroPrice: "if (rateCardProblems(card).length > 0) return [...problems, refusal('ZERO_PRICE',",
  unmeteredNoModel: "return cost['model'] === undefined ? problems : [...problems, refusal('BAD_COST',",
  classClosed: "if (cost['class'] !== 'metered') return [...problems, refusal('BAD_COST',",
  meteredNeedsModel: "if (typeof model !== 'string' || model === '') return [...problems, refusal('BAD_COST',",
  costUsed: "...costProblems(row['cost'], known, at),",
  // PR-3
  capabilityFilter: "const outside = list.filter((item) => !(typeof item === 'string' && (ROLE_CAPABILITIES as readonly string[]).includes(item)));",
  capabilityOutside: "if (outside.length > 0) out.push(refusal('UNKNOWN_CAPABILITY',",
  capabilityDuplicate: "if (new Set(list).size !== list.length) out.push(refusal('BAD_CAPABILITIES',",
  capabilityEmpty: "if (list === null || list.length === 0 || list.length > ROLE_CAPABILITIES.length) {",
  capabilitiesUsed: "...capabilityProblems(role, row['capabilities'], at),",
  // PR-4
  credentialName: "const CREDENTIAL_NAME = /key|secret|token|cred|passw|endpoint|url|uri|auth|header/i;",
  credentialTest: "const isCredentialName = (name: string): boolean => CREDENTIAL_NAME.test(name);",
  unknownNameFilter: ".filter((name) => !allowed.includes(name))",
  credentialField: "? refusal('CREDENTIAL_FIELD', `${at}.${safeName(name)}`",
  unknownField: ": refusal('UNKNOWN_FIELD', `${at}.${safeName(name)}`",
  roleNameCredential: "? refusal('CREDENTIAL_FIELD', `roles.${safeName(n)}`",
  topNames: "const refusals: RoleRefusal[] = nameProblems(top, TOP_KEYS, 'registry');",
  costNames: "const problems = nameProblems(cost, COST_KEYS, `${at}.cost`);",
  descriptors: "const descriptors = Object.getOwnPropertyDescriptors(value as object);",
  accessor: "descriptor.get !== undefined || descriptor.set !== undefined",
  accessorRefused: "refusals.push(refusal('ACCESSOR',",
  plainProto: "if (proto !== null && proto !== Object.prototype && !(isArray && proto === Array.prototype)) {",
  symbolKey: "if (typeof name === 'symbol') {",
  nullProto: "const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;",
  frozenCopy: "return { value: Object.freeze(copy), refusals };",
  snapshotTaken: "const snap = safeSnapshot(raw);",
  snapshotGuarded: "return snapshotOf(raw, 'registry', 0);\n  } catch {",
  judgeGuarded: "return judgeRoleRegistry(raw, known);\n  } catch {",
  sourcesGuarded: "  } catch {\n    ok = false;",
  controlChars: "const CONTROL_CHARS = /[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]|\\udb40[\\udc00-\\udc7f]/;",
  controlTest: "if (CONTROL_CHARS.test(raw)) return bad('carries a control character');",
  duplicateCall: "const twice = duplicateKey(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);",
  duplicateRefused: "if (twice !== null) {",
  duplicateSeen: "if (scope.has(key)) return key;",
  duplicateRemembered: "scope.add(key);",
  duplicateCode: "refusal('DUPLICATE_KEY',",
  snapshotRead: "const top = asRecord(snap.value);",
  snapshotRefused: "if (snap.refusals.length > 0) return { ok: false, refusals: snap.refusals.slice(0, MAX_ROLE_REFUSALS) };",
  sizeCap: "if (text.length > MAX_ROLE_REGISTRY_BYTES || new TextEncoder().encode(text).length > MAX_ROLE_REGISTRY_BYTES) {",
  parseCall: "parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);",
  sizeConst: "export const MAX_ROLE_REGISTRY_BYTES = 16384;",
  refusalCap: "export const MAX_ROLE_REFUSALS = 20;",
  urlShaped: "const URL_SHAPED = /:\\/\\/|www\\./i;",
  longRun: "const LONG_ALNUM_RUN = /[A-Za-z0-9]{24}/;",
  keyPrefix: "const KEY_PREFIX = /(?:^|[^A-Za-z0-9])(?:sk-|ghp_|gho_|xox[abp]-|AKIA)/;",
  notesTest: "if (URL_SHAPED.test(raw) || LONG_ALNUM_RUN.test(raw) || KEY_PREFIX.test(raw)) return bad(",
  notesUsed: "...notesProblems(row['notes'], at),",
  safeName: "const safeName = (name: string): string => (/^[A-Za-z0-9_.-]{1,40}$/.test(name) ? name : '<unprintable name>');",
  noValueInReason: "`${at} has a field named like a key, a credential or an address`",
  // PR-5
  committedFound: "const found = committedText(params.read, params.path);",
  committedRefusal: "code: 'NOT_COMMITTED'",
  parsedFromCommitted: "const parsed = parseRoleRegistry(found.text, params.known);",
  loaderUsed: "const loaded = loadCommittedRoleRegistry({ read: committedRead(ctx.sys, ctx.root), path: ROLE_REGISTRY_REL, known: known.known });",
  gitBase: "const base = ['--no-replace-objects', '-C', root];",
  gitShow: "const shown = sys.exec('git', [...base, 'show', `HEAD:./${path}`], options);",
  gitOptions: "const options = { isolatedGit: {}, maxOutputBytes: GIT_READ_BYTES };",
  gitHead: "const head = sys.exec('git', [...base, 'rev-parse', 'HEAD'], options);",
  gitBoth: "return head.code === 0 && shown.code === 0 ? { text: shown.stdout, commit: head.stdout.trim() } : null;",
  workingCompared: "const differs = working === null || !sameBytes(working, loaded.text);",
  flagged: "return fail(2, [...report, `FLAGGED (WORKING_COPY_DIFFERS):",
  reportFromCommitted: "...ROLE_IDS.flatMap((role) => roleLines(loaded.registry, role)),",
  refusedFirst: "if (!loaded.ok) return refusalReport(loaded.refusals);",
  // PR-6
  sharedWorker: "return typeof implementer === 'string' && implementer === idOf('reviewer') ? implementer : null;",
  sharedUsed: "const clash = sharedWorker(roles);",
  sharedRefused: "if (clash !== null) refusals.push(refusal('SAME_WORKER',",
  // PR-7
  selectNames: "if (typeof role !== 'string' || !(ROLE_IDS as readonly string[]).includes(role)) return null;",
  selectResult: "return entry === undefined ? null : Object.freeze({ role: entry.role, entry, standing: entry.role === 'gatekeeper' ? ('awaiting' as const) : ('assigned' as const) });",
  awaitingText: "awaiting: a decision is not held in this registry",
  noApprovalText: "nothing in it is an approval",
  // PR-13
  ownerImplement: "implement: 'implementer',",
  ownerReview: "review: 'reviewer',",
  ownerGatekeeper: "'gatekeeper-review': 'gatekeeper',",
  requiredCapability: "const REQUIRED_CAPABILITY: Readonly<Record<RoleId, RoleCapability>> = Object.freeze({ implementer: 'implement', reviewer: 'review', gatekeeper: 'gatekeeper-review' });",
  foreignFilter: "const foreign = list.filter((item) => CAPABILITY_OWNER[item as RoleCapability] !== role);",
  missingRequired: "const missing = list.includes(REQUIRED_CAPABILITY[role]) ? [] : [REQUIRED_CAPABILITY[role]];",
  bindingClean: "if (foreign.length === 0 && missing.length === 0) return [];",
  bindingRefusal: "return [refusal('CAPABILITY_MISMATCH',",
  bindingUsed: "if (out.length === 0) out.push(...bindingProblems(role, list as readonly string[], at));",
  noImplementer: "else if (!names.includes('implementer')) refusals.push(refusal('NO_IMPLEMENTER',",
  reviewerChecked: "return role === 'reviewer' ? reviewerProblems(worker, at) : [];",
  readOnlyGrant: "const READ_ONLY_GRANT = /^(Read|Grep|Glob|LS)(\\(.*\\))?$/;",
  nonReadGrants: "const bad = worker.grants.filter((grant) => ambiguous(grant) || !READ_ONLY_GRANT.test(grant));",
  nonReadClean: "if (bad.length === 0) return [];",
  nonReadRefusal: "return [refusal('REVIEWER_NOT_READ_ONLY',",
  grantsRead: "const knownWorkers = workers.workers.map((w) => ({ workerId: w.workerId, grants: argvGrants(w.args) }));",
  grantsImport: "import { argvGrants, authorisedWorkers, committedExecutionProblems } from '../loop/workers.js';",
  // PR-5 (the read bound)
  oversizeText: "const OVERSIZE_TEXT = ' '.repeat(MAX_ROLE_REGISTRY_BYTES + 1);",
  oversizeFound: "if (head.code === 0 && shown.failure === 'output-overflow') return { text: OVERSIZE_TEXT, commit: head.stdout.trim() };",
  // PR-9
  cliImport: "import { roles } from './commands/roles.js';",
  cliHelp: "'  roles                        Which authorised worker or route fills each role, from committed bytes (read-only)',",
  cliDispatch: "case 'roles':\n      return roles(ctx, flags, positionals);",
  cliReadOnly: "case 'roles':\n      return sub === undefined;",
  rolesNoArgs: "if (positionals.length > 0) return fail(1, [USAGE]);",
  barrelExport: "  validateRoleRegistry,\n} from './roleRegistry.js';",
};

/** A pattern the registry module must never contain. */
const REACHES_OUT = /\bnode:|\bprocess\.|\bfetch\(|\brequire\(|\bimport\(|\bnew Date\(|\bDate\.now\(|\bMath\.random\(|\bsetTimeout|\bsetInterval|\bchild_process|\bnew URL\(|\bXMLHttpRequest|\bWebSocket/;
/** What a selection or a parse result must never say: only an operator's decision, held elsewhere, can. */
const VERDICT_WORDS = /\b(?:verdict|approved|approve|granted|accepted)\b/i;
/** Names that make the model broker callable, as the broker's own validator lists them. */
const BROKER_NAMES = /\b(?:bindingKeyOf|callModel|createProviderRegistry|loadCommittedBrokerConfig|detectLocalModels|parseCommittedPricing|retryModelCall|chooseRoute|createCooldownBook|createMemoryAttemptStore|isLoopbackHost|localEndpointProblem)\b/;
const BROKER_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`]([^'"`]*modelBroker[^'"`]*)['"`]/g;
/** A load computed at run time: the report has no use for one, so it holds none. */
const DYNAMIC_LOAD = /\b(?:import|require)\s*\(/;
/** A re-export of any form: it would hand the module on to whoever imports the report. */
const REEXPORT = /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*from\b/;

/** String concatenation and a quoted template part folded into one literal, so a specifier written in parts reads as the path it makes. */
function foldSpecifiers(text) {
  let out = text;
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/(['"`])\s*\+\s*(['"`])/g, "").replace(/\$\{\s*(['"])([^'"`$]*)\1\s*\}/g, "$2");
    if (next === out) break;
    out = next;
  }
  return out;
}
/** The registry's own names: only the registry, its reader and the report may say them. */
const REGISTRY_NAMES = /\b(?:selectForRole|loadCommittedRoleRegistry|parseRoleRegistry|validateRoleRegistry|provider-roles)\b/;
/** The reader the report may import, from the one file it lives in, and nothing else. */
const ROLES_IMPORT_SPEC = "../modelBroker/committedConfig.js";
const ROLES_IMPORT_NAMES = ["loadCommittedRoleRegistry"];
const CREDENTIAL_NAME = /key|secret|token|cred|passw|endpoint|url|uri|auth|header/i;
const MAX_RECORD_BYTES = 16384;
/** Which role a capability belongs to, and the one each role must carry: the record is judged by the same binding as the code. */
const OWNER = { implement: "implementer", review: "reviewer", "gatekeeper-review": "gatekeeper", "plan-authoring": "gatekeeper", "closure-question": "gatekeeper" };
const REQUIRED = { implementer: "implement", reviewer: "review", gatekeeper: "gatekeeper-review" };
const CLOSED = {
  roles: ["implementer", "reviewer", "gatekeeper"],
  capabilities: ["implement", "review", "gatekeeper-review", "plan-authoring", "closure-question"],
  costs: ["unmetered", "metered"],
};

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments outside strings. CRLF is folded to LF first. */
function code(raw) {
  const text = raw.replace(/\r\n/g, "\n");
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

/** Every `.ts` file under a directory, as repository-relative paths. */
function tsFilesUnder(dir) {
  const abs = path.join(ROOT, ...dir.split("/"));
  if (!fs.existsSync(abs)) return [];
  const found = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/${e.name}`);
      else if (e.name.endsWith(".ts")) found.push(`${rel}/${e.name}`);
    }
  };
  walk(abs, dir);
  return found;
}

const modulesOf = (text) => {
  const start = text.indexOf("const MODULES = [");
  const end = text.indexOf("\n];", start);
  return start < 0 || end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

const missing = (text, pins) => pins.filter((p) => !text.includes(p));
const insideBroker = (rel) => rel.startsWith(`${CORE_BROKER_DIR}/`) || rel.startsWith(`${AGENT_BROKER_DIR}/`);

/** The names a statement imports from one specifier, from the comment-stripped text. */
function importedNames(text, spec) {
  const found = [];
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
    if (m[2] === spec) found.push(...m[1].split(",").map((n) => n.replace(/^\s*type\s+/, "").trim()).filter(Boolean));
  }
  return found;
}

/** PR-8: who may import the model broker, and what the one allowed file may take. Returns the offenders. */
function brokerImportProblems(raw, scanned) {
  const out = [];
  for (const rel of scanned) {
    if (insideBroker(rel) || raw[rel] === null || raw[rel] === undefined) continue;
    const text = foldSpecifiers(code(raw[rel]));
    const specs = [...text.matchAll(BROKER_IMPORT)].map((m) => m[1]);
    if (rel === CORE_INDEX_REL) {
      if (specs.length !== 1 || specs[0] !== "./modelBroker/index.js") out.push(`${rel} imports ${specs.join(", ") || "nothing"} from the broker, not only its barrel`);
      continue;
    }
    if (rel === ROLES_REL) {
      const names = importedNames(text, ROLES_IMPORT_SPEC).sort();
      if (specs.length !== 1 || specs[0] !== ROLES_IMPORT_SPEC) out.push(`${rel} imports ${specs.join(", ") || "nothing"} from the broker, not only ${ROLES_IMPORT_SPEC}`);
      if (JSON.stringify(names) !== JSON.stringify(ROLES_IMPORT_NAMES)) out.push(`${rel} takes ${names.join(", ") || "nothing"} from the reader file, not exactly ${ROLES_IMPORT_NAMES.join(", ")}`);
      if (BROKER_NAMES.test(text)) out.push(`${rel} names ${BROKER_NAMES.exec(text)[0]}, which makes the broker callable`);
      if (DYNAMIC_LOAD.test(text)) out.push(`${rel} loads a module at run time (import() or require()), which no static check can follow`);
      if (REEXPORT.test(text)) out.push(`${rel} re-exports from another file, which would hand the module on to its importers`);
      continue;
    }
    if (specs.length > 0) out.push(`${rel} imports ${specs.join(", ")}`);
    else if (BROKER_NAMES.test(text)) out.push(`${rel} names ${BROKER_NAMES.exec(text)[0]}`);
  }
  return out;
}

/** PR-12: nothing but the registry, its reader and the report says the registry's names. */
function consultedBy(raw, scanned) {
  return scanned.filter((rel) => !insideBroker(rel) && rel !== ROLES_REL && raw[rel] !== null && raw[rel] !== undefined && REGISTRY_NAMES.test(code(raw[rel])));
}

/** PR-10: the committed record, judged against the committed config with its own small judge. */
function recordProblems(raw) {
  const out = [];
  const text = raw[RECORD_REL];
  if (text === null || text === undefined) return [`${RECORD_REL} is missing`];
  if (Buffer.byteLength(text, "utf8") > MAX_RECORD_BYTES) return [`${RECORD_REL} is larger than ${MAX_RECORD_BYTES} bytes`];
  let doc;
  let config;
  let gatekeeper = null;
  try {
    doc = JSON.parse(text);
    config = JSON.parse(raw[PROJECT_CONFIG_REL]);
    gatekeeper = raw[GATEKEEPER_REL] === null || raw[GATEKEEPER_REL] === undefined ? null : JSON.parse(raw[GATEKEEPER_REL]);
  } catch {
    return [`${RECORD_REL}, ${PROJECT_CONFIG_REL} or ${GATEKEEPER_REL} does not parse`];
  }
  const workers = ((config.execution || {}).workers || []).map((w) => w.workerId);
  const transport = gatekeeper === null ? null : (gatekeeper.transport || {}).transportId;
  const cards = gatekeeper === null ? {} : gatekeeper.rateCards || {};
  if (doc.schema !== 1 || Object.keys(doc).sort().join() !== "roles,schema") out.push("the record is not exactly { schema: 1, roles }");
  const roles = doc.roles || {};
  const names = Object.keys(roles);
  if (names.length === 0) out.push("the record names no role");
  else if (!names.includes("implementer")) out.push("the record names no implementer");
  for (const name of names) {
    const row = roles[name];
    const at = `roles.${name}`;
    if (!CLOSED.roles.includes(name)) {
      out.push(`${at} is not a role`);
      continue;
    }
    const allowed = name === "gatekeeper" ? ["transportId", "capabilities", "cost", "notes"] : ["workerId", "capabilities", "cost", "notes"];
    for (const key of Object.keys(row)) {
      if (CREDENTIAL_NAME.test(key)) out.push(`${at}.${key} is named like a key, a credential or an address`);
      else if (!allowed.includes(key)) out.push(`${at}.${key} is not a field of a ${name} role`);
    }
    if (name === "gatekeeper") {
      if (transport === null || row.transportId !== transport) out.push(`${at}.transportId is not the committed gatekeeper transport`);
    } else if (!workers.includes(row.workerId)) out.push(`${at}.workerId is not in the committed execution.workers`);
    const caps = Array.isArray(row.capabilities) ? row.capabilities : [];
    if (caps.length === 0 || new Set(caps).size !== caps.length || caps.some((c) => !CLOSED.capabilities.includes(c))) out.push(`${at}.capabilities is not a non-empty list from the closed list`);
    if (caps.some((c) => OWNER[c] !== name) || !caps.includes(REQUIRED[name])) out.push(`${at}.capabilities do not fit a ${name} role`);
    const cost = row.cost || {};
    if (!CLOSED.costs.includes(cost.class)) out.push(`${at}.cost.class is not in the closed list`);
    else if (cost.class === "metered") {
      const card = Object.prototype.hasOwnProperty.call(cards, cost.model) ? cards[cost.model] : null;
      if (card === null) out.push(`${at}.cost.model is not in the committed rate cards`);
      else if (!(card.inputMicroUsdPerMillion > 0) || !(card.outputMicroUsdPerMillion > 0)) out.push(`${at}.cost.model has a zero price`);
    } else if (cost.model !== undefined) out.push(`${at}.cost is unmetered and names a model`);
    if (typeof row.notes !== "string" || row.notes.length > 400 || /:\/\/|[A-Za-z0-9]{24}|[\u0000-\u001f]/.test(row.notes)) out.push(`${at}.notes is not short plain text`);
  }
  if (roles.implementer && roles.reviewer && roles.implementer.workerId === roles.reviewer.workerId) out.push("the implementer and the reviewer are one worker");
  return out;
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  if (raw[ROLES_REL] === null || raw[ROLES_REL] === undefined) {
    E("PR-8", `${ROLES_REL} is missing, so what the report imports of the model broker cannot be judged`);
    return errors;
  }
  for (const rel of FIXED) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("PR-0", `${rel} is missing`);
      return errors;
    }
  }
  const R = code(raw[REGISTRY_REL]);
  const K = code(raw[CONFIG_REL]);
  const C = code(raw[ROLES_REL]);
  const L = code(raw[CLI_REL]);
  const B = code(raw[CORE_BARREL_REL]);


  // PR-1
  const p1 = missing(R, [PIN.roleIds, PIN.workerKnown, PIN.workerRefused, PIN.transportKnown, PIN.routeUsed, PIN.unknownWorker, PIN.unknownTransport, PIN.workerKeys, PIN.gatekeeperKeys, PIN.roleKeysUsed, PIN.rolesClosed, PIN.entryOnlyClean, PIN.okOnlyClean]);
  if (p1.length > 0) E("PR-1", "a role can name a worker the project does not authorise, a route that is not the committed gatekeeper, or a field of another kind of role");
  // PR-2
  if (!raw[REGISTRY_REL].replace(/\r\n/g, "\n").includes(PIN.rateCardImport) || missing(R, [PIN.costClasses, PIN.cardLookup, PIN.noCard, PIN.zeroPrice, PIN.unmeteredNoModel, PIN.classClosed, PIN.meteredNeedsModel, PIN.costUsed]).length > 0) {
    E("PR-2", "a metered cost no longer has to name a model with a committed, non-zero rate card, or an unmetered one may carry a model");
  }
  // PR-3
  if (missing(R, [PIN.capabilities, PIN.capabilityFilter, PIN.capabilityOutside, PIN.capabilityDuplicate, PIN.capabilityEmpty, PIN.capabilitiesUsed]).length > 0) {
    E("PR-3", "the capability list is no longer closed, or an empty, repeated or unknown capability is no longer refused");
  }
  // PR-4
  const sizeAt = R.indexOf(PIN.sizeCap);
  const parseAt = R.indexOf(PIN.parseCall);
  const pins4 = [PIN.credentialName, PIN.credentialTest, PIN.unknownNameFilter, PIN.credentialField, PIN.unknownField, PIN.roleNameCredential, PIN.topNames, PIN.costNames, PIN.descriptors, PIN.accessor, PIN.accessorRefused, PIN.plainProto, PIN.symbolKey, PIN.nullProto, PIN.frozenCopy, PIN.snapshotTaken, PIN.snapshotRead, PIN.snapshotRefused, PIN.sizeConst, PIN.refusalCap, PIN.urlShaped, PIN.longRun, PIN.keyPrefix, PIN.notesTest, PIN.notesUsed, PIN.safeName, PIN.noValueInReason, PIN.snapshotGuarded, PIN.judgeGuarded, PIN.sourcesGuarded, PIN.controlChars, PIN.controlTest, PIN.duplicateCall, PIN.duplicateRefused, PIN.duplicateSeen, PIN.duplicateRemembered, PIN.duplicateCode];
  if (missing(R, pins4).length > 0 || sizeAt < 0 || parseAt < 0 || sizeAt > parseAt || /\braw\[/.test(R.slice(R.indexOf("function judgeRoleRegistry")).replace(PIN.snapshotTaken, ""))) {
    E("PR-4", "a key, credential or address field is no longer refused by name, an accessor is read, the input is read more than once or not as a frozen snapshot, the size is no longer judged before the parse, a hostile object can make the judge throw, a hidden or reordering character is let into notes, or a key written twice is read as its last value");
  }
  // PR-5
  const pins5 = [PIN.oversizeText, PIN.oversizeFound, PIN.loaderUsed, PIN.gitBase, PIN.gitShow, PIN.gitOptions, PIN.gitHead, PIN.gitBoth, PIN.workingCompared, PIN.flagged, PIN.reportFromCommitted, PIN.refusedFirst];
  const workingReads = (C.match(/\.readText\(/g) || []).length;
  if (missing(K, [PIN.committedFound, PIN.committedRefusal, PIN.parsedFromCommitted]).length > 0 || missing(C, pins5).length > 0 || workingReads !== 1) {
    E("PR-5", "the registry is no longer read from committed bytes only: the reader does not refuse a copy with no commit, the report reads content from the working tree, or a differing working copy is no longer flagged");
  }
  // PR-13
  const pins13 = [PIN.ownerImplement, PIN.ownerReview, PIN.ownerGatekeeper, PIN.requiredCapability, PIN.foreignFilter, PIN.missingRequired, PIN.bindingClean, PIN.bindingRefusal, PIN.bindingUsed, PIN.noImplementer, PIN.reviewerChecked, PIN.readOnlyGrant, PIN.nonReadGrants, PIN.nonReadClean, PIN.nonReadRefusal];
  if (missing(R, pins13).length > 0 || missing(C, [PIN.grantsRead, PIN.grantsImport]).length > 0) {
    E("PR-13", "a role no longer has to fit its capabilities and its worker: a reviewer or gatekeeper may claim an implement capability, an implementer may lack one, no implementer is required, or a reviewer may name a worker that holds a non-read grant");
  }
  // PR-6
  if (missing(R, [PIN.sharedWorker, PIN.sharedUsed, PIN.sharedRefused]).length > 0) E("PR-6", "the implementer and the reviewer may name the same worker");
  // PR-7
  if (missing(R, [PIN.selectNames, PIN.selectResult]).length > 0 || !C.includes(PIN.awaitingText) || !C.includes(PIN.noApprovalText) || VERDICT_WORDS.test(R)) {
    E("PR-7", "a selection can carry a verdict or an approval, returns more than an entry and its standing, or a gatekeeper role is no longer reported as awaiting");
  }
  // PR-8
  const scanned = Object.keys(raw).filter((rel) => rel.startsWith(`${CORE_SRC}/`) || rel.startsWith(`${AGENT_SRC}/`));
  const imports = brokerImportProblems(raw, scanned);
  if (imports.length > 0) E("PR-8", `the model broker is imported outside the report, or the report takes more than the registry reader: ${imports.join("; ")}`);
  // PR-9
  const wired = [PIN.cliImport, PIN.cliHelp, PIN.cliDispatch, PIN.cliReadOnly].filter((p) => !L.includes(p));
  const barrel = [PIN.barrelExport].filter((p) => !B.includes(p));
  const register = [];
  for (const [rel, name] of [[VA_REL, "validate-all"], [CR_REL, "cached-runner"]]) {
    const modules = modulesOf(code(raw[rel]));
    const at = modules === null ? -1 : modules.indexOf(THIS_VALIDATOR);
    if (at < 0 || modules[at + 1] !== FOLLOWER) register.push(`${THIS_VALIDATOR} is not registered immediately before ${FOLLOWER} in ${name}`);
  }
  const stopTable = raw[PLATFORM_STOP_TEST_REL] === null || raw[PLATFORM_STOP_TEST_REL] === undefined ? "" : raw[PLATFORM_STOP_TEST_REL];
  if (wired.length > 0 || barrel.length > 0 || register.length > 0 || !C.includes(PIN.rolesNoArgs) || !/\n {2}\['roles'\],\n/.test(stopTable)) {
    E("PR-9", `the command is not dispatched, listed in help, read-only under the platform stop, exported or registered${register.length > 0 ? ` (${register.join("; ")})` : ""}`);
  }
  // PR-10
  const record = recordProblems(raw);
  if (record.length > 0) E("PR-10", `the committed record is refused: ${record.join("; ")}`);
  // PR-11
  const importsOk = [...R.matchAll(/\bfrom\s+'([^']+)'/g)].every((m) => m[1] === "../gatekeeperCostLedger.js");
  if (REACHES_OUT.test(R) || !importsOk || !raw[REGISTRY_REL].includes("// Origin: original ProjectOS code")) {
    E("PR-11", "the pure registry reaches outside itself: a node import, a clock, a timer, a network, a file, or any import but the rate card shape");
  }
  // PR-12
  const consulting = consultedBy(raw, scanned);
  if (consulting.length > 0) E("PR-12", `something other than the report consults the role registry: ${consulting.join(", ")}`);
  return errors;
}

const rep = (rel, from, to) => ({ rel, from, to });
const MUTATIONS = [
  // PR-1
  { name: "worker-not-checked-against-the-config", rule: "PR-1", ...rep(REGISTRY_REL, PIN.workerKnown, "const worker = typeof id === 'string' ? known.workers[0] : undefined;") },
  { name: "any-transport-accepted", rule: "PR-1", ...rep(REGISTRY_REL, PIN.transportKnown, "const ok = typeof id === 'string';") },
  { name: "route-not-judged", rule: "PR-1", ...rep(REGISTRY_REL, PIN.routeUsed, "") },
  { name: "worker-role-may-carry-a-transport", rule: "PR-1", ...rep(REGISTRY_REL, PIN.workerKeys, "const WORKER_ROLE_KEYS = ['workerId', 'transportId', 'capabilities', 'cost', 'notes'];") },
  { name: "unknown-role-accepted", rule: "PR-1", ...rep(REGISTRY_REL, PIN.rolesClosed, "refusals.push(...names.filter(() => false).map((n) =>") },
  { name: "refused-role-still-an-entry", rule: "PR-1", ...rep(REGISTRY_REL, PIN.entryOnlyClean, "") },
  { name: "refusals-do-not-stop-the-registry", rule: "PR-1", ...rep(REGISTRY_REL, "return refusals.length > 0 ? { ok: false,", "return false ? { ok: false,") },
  // PR-2
  { name: "unknown-model-accepted", rule: "PR-2", ...rep(REGISTRY_REL, PIN.noCard, "if (false) return [...problems, refusal('UNKNOWN_MODEL',") },
  { name: "zero-price-accepted", rule: "PR-2", ...rep(REGISTRY_REL, PIN.zeroPrice, "if (false) return [...problems, refusal('ZERO_PRICE',") },
  { name: "price-looked-up-by-prototype", rule: "PR-2", ...rep(REGISTRY_REL, PIN.cardLookup, "const card = known.rateCards[model];") },
  { name: "unmetered-may-name-a-model", rule: "PR-2", ...rep(REGISTRY_REL, PIN.unmeteredNoModel, "return problems; [...problems, refusal('BAD_COST',") },
  { name: "unknown-cost-class-accepted", rule: "PR-2", ...rep(REGISTRY_REL, PIN.classClosed, "if (false) return [...problems, refusal('BAD_COST',") },
  { name: "metered-without-a-model-accepted", rule: "PR-2", ...rep(REGISTRY_REL, PIN.meteredNeedsModel, "if (false) return [...problems, refusal('BAD_COST',") },
  { name: "rate-card-shape-copied", rule: "PR-2", ...rep(REGISTRY_REL, PIN.rateCardImport, "import { type RateCard } from '../gatekeeperCostLedger.js';\nconst rateCardProblems = (card: RateCard): readonly string[] => (card.model === '' ? ['x'] : []);") },
  // PR-3
  { name: "capability-list-grows", rule: "PR-3", ...rep(REGISTRY_REL, PIN.capabilities, "export const ROLE_CAPABILITIES = ['implement', 'review', 'gatekeeper-review', 'plan-authoring', 'closure-question', 'deploy'] as const;") },
  { name: "unknown-capability-accepted", rule: "PR-3", ...rep(REGISTRY_REL, PIN.capabilityOutside, "if (false) out.push(refusal('UNKNOWN_CAPABILITY',") },
  { name: "repeated-capability-accepted", rule: "PR-3", ...rep(REGISTRY_REL, PIN.capabilityDuplicate, "if (false) out.push(refusal('BAD_CAPABILITIES',") },
  { name: "empty-capability-list-accepted", rule: "PR-3", ...rep(REGISTRY_REL, PIN.capabilityEmpty, "if (list === null || list.length > ROLE_CAPABILITIES.length) {") },
  { name: "capabilities-not-judged", rule: "PR-3", ...rep(REGISTRY_REL, PIN.capabilitiesUsed, "") },
  // PR-4
  { name: "key-names-pass", rule: "PR-4", ...rep(REGISTRY_REL, PIN.credentialName, "const CREDENTIAL_NAME = /secret|token|cred|passw|endpoint|url|uri|auth|header/i;") },
  { name: "address-names-pass", rule: "PR-4", ...rep(REGISTRY_REL, PIN.credentialName, "const CREDENTIAL_NAME = /key|secret|token|cred|passw|auth|header/i;") },
  { name: "credential-name-test-off", rule: "PR-4", ...rep(REGISTRY_REL, PIN.credentialTest, "const isCredentialName = (name: string): boolean => false && CREDENTIAL_NAME.test(name);") },
  { name: "unknown-names-pass", rule: "PR-4", ...rep(REGISTRY_REL, PIN.unknownNameFilter, ".filter((name) => false)") },
  { name: "cost-names-unchecked", rule: "PR-4", ...rep(REGISTRY_REL, PIN.costNames, "const problems: RoleRefusal[] = [];") },
  { name: "top-names-unchecked", rule: "PR-4", ...rep(REGISTRY_REL, PIN.topNames, "const refusals: RoleRefusal[] = [];") },
  { name: "accessor-is-read", rule: "PR-4", ...rep(REGISTRY_REL, PIN.accessor, "false") },
  { name: "non-plain-object-read", rule: "PR-4", ...rep(REGISTRY_REL, PIN.plainProto, "if (false) {") },
  { name: "symbol-keys-read", rule: "PR-4", ...rep(REGISTRY_REL, PIN.symbolKey, "if (false) {") },
  { name: "snapshot-is-not-frozen", rule: "PR-4", ...rep(REGISTRY_REL, PIN.frozenCopy, "return { value: copy, refusals };") },
  { name: "proto-key-can-reach-the-copy", rule: "PR-4", ...rep(REGISTRY_REL, PIN.nullProto, "const copy: Record<string, unknown> = {};") },
  { name: "validation-reads-the-raw-input", rule: "PR-4", ...rep(REGISTRY_REL, PIN.snapshotRead, "const top = asRecord(raw);") },
  { name: "size-judged-after-the-parse", rule: "PR-4", ...rep(REGISTRY_REL, PIN.sizeCap, "if (false) {") },
  { name: "size-cap-raised", rule: "PR-4", ...rep(REGISTRY_REL, PIN.sizeConst, "export const MAX_ROLE_REGISTRY_BYTES = 16777216;") },
  { name: "url-in-notes-passes", rule: "PR-4", ...rep(REGISTRY_REL, PIN.notesTest, "if (LONG_ALNUM_RUN.test(raw) || KEY_PREFIX.test(raw)) return bad(") },
  { name: "key-shaped-notes-pass", rule: "PR-4", ...rep(REGISTRY_REL, PIN.longRun, "const LONG_ALNUM_RUN = /[A-Za-z0-9]{240}/;") },
  { name: "reason-quotes-the-field-value", rule: "PR-4", ...rep(REGISTRY_REL, PIN.noValueInReason, "`${at} has a field named like a key: ${JSON.stringify(record[name])}`") },
  { name: "unprintable-names-echoed", rule: "PR-4", ...rep(REGISTRY_REL, PIN.safeName, "const safeName = (name: string): string => name;") },
  // PR-5
  { name: "reader-ignores-the-commit", rule: "PR-5", ...rep(CONFIG_REL, PIN.committedFound, "const found = { text: params.read(params.path)?.text ?? '', commit: 'x' };") },
  { name: "reader-judges-the-wrong-bytes", rule: "PR-5", ...rep(CONFIG_REL, PIN.parsedFromCommitted, "const parsed = parseRoleRegistry(params.path, params.known);") },
  { name: "no-committed-copy-is-not-refused", rule: "PR-5", ...rep(CONFIG_REL, PIN.committedRefusal, "code: 'NOT_JSON'") },
  { name: "report-reads-the-working-tree", rule: "PR-5", ...rep(ROLES_REL, PIN.gitShow, "const shown = { code: 0, stdout: sys.readText(path) ?? '' };") },
  { name: "replacement-objects-allowed", rule: "PR-5", ...rep(ROLES_REL, PIN.gitBase, "const base = ['-C', root];") },
  { name: "git-reads-run-unisolated", rule: "PR-5", ...rep(ROLES_REL, PIN.gitOptions, "const options = { maxOutputBytes: GIT_READ_BYTES };") },
  { name: "head-not-asked", rule: "PR-5", ...rep(ROLES_REL, PIN.gitBoth, "return shown.code === 0 ? { text: shown.stdout, commit: 'working' } : null;") },
  { name: "differing-working-copy-not-flagged", rule: "PR-5", ...rep(ROLES_REL, PIN.workingCompared, "const differs = false;") },
  { name: "flag-does-not-fail", rule: "PR-5", ...rep(ROLES_REL, PIN.flagged, "return ok([...report, `FLAGGED (WORKING_COPY_DIFFERS):") },
  { name: "report-shows-the-working-copy", rule: "PR-5", ...rep(ROLES_REL, PIN.reportFromCommitted, "...ROLE_IDS.flatMap((role) => roleLines(JSON.parse(working ?? '{}'), role)),") },
  // PR-6
  { name: "same-worker-passes", rule: "PR-6", ...rep(REGISTRY_REL, PIN.sharedRefused, "if (false) refusals.push(refusal('SAME_WORKER',") },
  { name: "same-worker-compared-loosely", rule: "PR-6", ...rep(REGISTRY_REL, PIN.sharedWorker, "return typeof implementer === 'string' && implementer !== idOf('reviewer') ? implementer : null;") },
  { name: "same-worker-never-asked", rule: "PR-6", ...rep(REGISTRY_REL, PIN.sharedUsed, "const clash: string | null = null;") },
  // PR-7
  { name: "selection-gains-a-verdict", rule: "PR-7", ...rep(REGISTRY_REL, PIN.selectResult, "return entry === undefined ? null : Object.freeze({ role: entry.role, entry, standing: 'assigned' as const, verdict: 'approved' });") },
  { name: "gatekeeper-reported-as-assigned", rule: "PR-7", ...rep(REGISTRY_REL, PIN.selectResult, "return entry === undefined ? null : Object.freeze({ role: entry.role, entry, standing: 'assigned' as const });") },
  { name: "report-calls-the-gatekeeper-decided", rule: "PR-7", ...rep(ROLES_REL, PIN.awaitingText, "decided") },
  { name: "report-claims-an-approval", rule: "PR-7", ...rep(ROLES_REL, PIN.noApprovalText, "everything in it is approved") },
  { name: "unknown-role-name-selected", rule: "PR-7", ...rep(REGISTRY_REL, PIN.selectNames, "if (typeof role !== 'string') return null;") },
  // PR-8
  { name: "an-agent-file-imports-the-broker", rule: "PR-8", ...rep(RUNNER_REL, "export function runLoop(", "import { detectLocalModels } from '../modelBroker/index.js';\nexport function runLoop(") },
  { name: "roles-ts-imports-callModel", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';\nimport { callModel } from '../modelBroker/callModel.js';") },
  { name: "roles-ts-takes-the-broker-config-loader", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedBrokerConfig, loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';") },
  { name: "roles-ts-imports-the-whole-barrel", rule: "PR-8", ...rep(ROLES_REL, "from '../modelBroker/committedConfig.js';", "from '../modelBroker/index.js';") },
  { name: "another-command-imports-the-broker", rule: "PR-8", ...rep(STATUS_REL, "import { configPath, reportsDir } from '../context.js';", "import { configPath, reportsDir } from '../context.js';\nimport { detectLocalModels } from '../modelBroker/index.js';") },
  { name: "core-names-the-broker-outside-its-barrel", rule: "PR-8", ...rep(CORE_INDEX_REL, "export * from './modelBroker/index.js';", "export * from './modelBroker/index.js';\nexport { callModel as call } from './modelBroker/callModel.js';") },
  // PR-9
  { name: "command-not-dispatched", rule: "PR-9", ...rep(CLI_REL, PIN.cliDispatch, "case 'roles':\n      return fail(1, ['no']);") },
  { name: "command-not-in-help", rule: "PR-9", ...rep(CLI_REL, PIN.cliHelp, "") },
  { name: "command-refused-under-the-stop", rule: "PR-9", ...rep(CLI_REL, PIN.cliReadOnly, "case 'roles':\n      return false;") },
  { name: "command-takes-arguments", rule: "PR-9", ...rep(ROLES_REL, PIN.rolesNoArgs, "") },
  { name: "validator-moved-from-before-stage-3", rule: "PR-9", ...rep(VA_REL, `"${THIS_VALIDATOR}",\n  // PROJECTOS-MEMORY-STORES1A`, `"${FOLLOWER}",\n  // PROJECTOS-MEMORY-STORES1A`) },
  { name: "validator-not-in-the-cached-runner", rule: "PR-9", ...rep(CR_REL, `"${THIS_VALIDATOR}",\n  // PROJECTOS-MEMORY-STORES1A`, `"${FOLLOWER}",\n  // PROJECTOS-MEMORY-STORES1A`) },
  { name: "stop-table-row-removed", rule: "PR-9", ...rep(PLATFORM_STOP_TEST_REL, "\n  ['roles'],\n", "\n") },
  { name: "barrel-drops-the-registry", rule: "PR-9", ...rep(CORE_BARREL_REL, PIN.barrelExport, "} from './retry.js';") },
  // PR-10
  { name: "record-names-an-unauthorised-worker", rule: "PR-10", ...rep(RECORD_REL, '"workerId": "claude-local"', '"workerId": "ghost-worker"') },
  { name: "record-uses-one-worker-twice", rule: "PR-10", ...rep(RECORD_REL, '"workerId": "claude-reviewer"', '"workerId": "claude-local"') },
  { name: "record-names-another-route", rule: "PR-10", ...rep(RECORD_REL, '"transportId": "openai-primary"', '"transportId": "other-route"') },
  { name: "record-prices-an-unpriced-model", rule: "PR-10", ...rep(RECORD_REL, '"model": "gpt-5.6-terra"', '"model": "gpt-unpriced"') },
  { name: "record-grows-a-capability", rule: "PR-10", ...rep(RECORD_REL, '"capabilities": ["implement"]', '"capabilities": ["implement", "deploy"]') },
  { name: "record-carries-a-key-field", rule: "PR-10", ...rep(RECORD_REL, '"capabilities": ["implement"],', '"capabilities": ["implement"], "apiKey": "x",') },
  { name: "record-carries-an-address", rule: "PR-10", ...rep(RECORD_REL, '"capabilities": ["review"],', '"capabilities": ["review"], "baseUrl": "x",') },
  { name: "record-reviewer-claims-to-implement", rule: "PR-10", ...rep(RECORD_REL, '"capabilities": ["review"],', '"capabilities": ["review", "implement"],') },
  { name: "record-gatekeeper-lacks-its-capability", rule: "PR-10", ...rep(RECORD_REL, '"capabilities": ["gatekeeper-review", "plan-authoring", "closure-question"],', '"capabilities": ["plan-authoring", "closure-question"],') },
  { name: "record-has-no-implementer", rule: "PR-10", ...rep(RECORD_REL, '"implementer": {', '"planner-x": {') },
  { name: "record-drops-the-schema", rule: "PR-10", ...rep(RECORD_REL, '"schema": 1,', "") },
  { name: "record-names-an-extra-role", rule: "PR-10", ...rep(RECORD_REL, '"roles": {', '"roles": { "planner": { "workerId": "claude-local" },') },
  { name: "record-notes-hold-an-address", rule: "PR-10", ...rep(RECORD_REL, "so none is recorded.\"\n    },\n    \"reviewer\"", "so none is recorded, see https://example.invalid/x\"\n    },\n    \"reviewer\"") },
  // PR-11
  { name: "registry-imports-node", rule: "PR-11", ...rep(REGISTRY_REL, PIN.rateCardImport, `${PIN.rateCardImport}\nimport { readFileSync } from 'node:fs';`) },
  { name: "registry-reads-the-clock", rule: "PR-11", ...rep(REGISTRY_REL, PIN.sizeConst, `${PIN.sizeConst}\nconst STARTED = Date.now();`) },
  { name: "registry-imports-the-broker", rule: "PR-11", ...rep(REGISTRY_REL, PIN.rateCardImport, `${PIN.rateCardImport}\nimport { chooseRoute } from './fallback.js';`) },
  { name: "registry-loses-its-origin-mark", rule: "PR-11", ...rep(REGISTRY_REL, "// Origin: original ProjectOS code\n", "") },
  // PR-12
  { name: "loop-selects-a-worker-from-the-registry", rule: "PR-12", ...rep(WORKERS_REL, "export function resolveWorker(", "const FROM_ROLES = (registry: never) => selectForRole(registry, 'implementer');\nexport function resolveWorker(") },
  { name: "runner-reads-the-registry-file", rule: "PR-12", ...rep(RUNNER_REL, "export function runLoop(", "const ROLES = '.projectops/provider-roles.json';\nexport function runLoop(") },
  { name: "another-command-loads-the-registry", rule: "PR-12", ...rep(STATUS_REL, "import { configPath, reportsDir } from '../context.js';", "import { configPath, reportsDir } from '../context.js';\nconst LOAD = loadCommittedRoleRegistry;") },
  // PR-4 (review round: hostile input, hidden characters, duplicate keys)
  { name: "snapshot-throw-not-caught", rule: "PR-4", ...rep(REGISTRY_REL, PIN.snapshotGuarded, "return snapshotOf(raw, 'registry', 0);\n  } catch (e) { throw e; } {") },
  { name: "judge-throw-not-caught", rule: "PR-4", ...rep(REGISTRY_REL, PIN.judgeGuarded, "return judgeRoleRegistry(raw, known);\n  } catch (e) { throw e; } {") },
  { name: "hostile-sources-throw", rule: "PR-4", ...rep(REGISTRY_REL, PIN.sourcesGuarded, "  } catch (e) { throw e; } {\n    ok = false;") },
  { name: "tag-characters-pass-in-notes", rule: "PR-4", ...rep(REGISTRY_REL, "|\\udb40[\\udc00-\\udc7f]/;", "/;") },
  { name: "c1-controls-pass-in-notes", rule: "PR-4", ...rep(REGISTRY_REL, "\\u007f-\\u009f", "\\u007f") },
  { name: "bidi-overrides-pass-in-notes", rule: "PR-4", ...rep(REGISTRY_REL, "\\u202a-\\u202e\\u2066-\\u2069", "") },
  { name: "control-character-test-off", rule: "PR-4", ...rep(REGISTRY_REL, PIN.controlTest, "") },
  { name: "duplicate-key-not-asked", rule: "PR-4", ...rep(REGISTRY_REL, PIN.duplicateRefused, "if (false) {") },
  { name: "duplicate-key-not-seen", rule: "PR-4", ...rep(REGISTRY_REL, PIN.duplicateSeen, "") },
  { name: "keys-are-not-remembered", rule: "PR-4", ...rep(REGISTRY_REL, PIN.duplicateRemembered, "") },
  // PR-5 (review round: a file over the read bound)
  { name: "oversize-file-reported-as-missing", rule: "PR-5", ...rep(ROLES_REL, PIN.oversizeFound, "") },
  { name: "oversize-stand-in-fits-the-cap", rule: "PR-5", ...rep(ROLES_REL, PIN.oversizeText, "const OVERSIZE_TEXT = ' '.repeat(1);") },
  // PR-8 (review round: spellings of an import the fence must still see)
  { name: "roles-ts-loads-the-broker-by-template", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';\nconst later = import(`../modelBroker/callModel.js`);") },
  { name: "roles-ts-concatenates-the-broker-path", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';\nconst later = require('../model' + 'Broker/callModel.js');") },
  { name: "roles-ts-builds-the-path-in-a-template", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';\nconst later = import(`../model${'Broker'}/index.js`);") },
  { name: "roles-ts-loads-something-at-run-time", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';\nconst later = import(name);") },
  { name: "roles-ts-reexports-the-broker-barrel", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';\nexport * from '../modelBroker/index.js';") },
  { name: "roles-ts-reexports-the-reader", rule: "PR-8", ...rep(ROLES_REL, "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';", "import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';\nexport { loadCommittedRoleRegistry as load } from '../modelBroker/committedConfig.js';") },
  { name: "another-command-loads-the-broker-by-template", rule: "PR-8", ...rep(STATUS_REL, "import { configPath, reportsDir } from '../context.js';", "import { configPath, reportsDir } from '../context.js';\nconst later = import(`../modelBroker/index.js`);") },
  { name: "another-command-concatenates-the-broker-path", rule: "PR-8", ...rep(STATUS_REL, "import { configPath, reportsDir } from '../context.js';", "import { configPath, reportsDir } from '../context.js';\nconst later = import('../model' + 'Broker/index.js');") },
  { name: "another-command-reexports-the-broker-barrel", rule: "PR-8", ...rep(STATUS_REL, "import { configPath, reportsDir } from '../context.js';", "import { configPath, reportsDir } from '../context.js';\nexport * from '../modelBroker/index.js';") },
  { name: "roles-ts-is-missing", rule: "PR-8", rel: ROLES_REL, missing: true },
  // PR-13 (review round: a role fits its capabilities and its worker)
  { name: "implement-belongs-to-the-gatekeeper", rule: "PR-13", ...rep(REGISTRY_REL, PIN.ownerImplement, "implement: 'gatekeeper',") },
  { name: "review-belongs-to-the-implementer", rule: "PR-13", ...rep(REGISTRY_REL, PIN.ownerReview, "review: 'implementer',") },
  { name: "gatekeeper-review-belongs-to-the-reviewer", rule: "PR-13", ...rep(REGISTRY_REL, PIN.ownerGatekeeper, "'gatekeeper-review': 'reviewer',") },
  { name: "implementer-needs-review", rule: "PR-13", ...rep(REGISTRY_REL, PIN.requiredCapability, "const REQUIRED_CAPABILITY: Readonly<Record<RoleId, RoleCapability>> = Object.freeze({ implementer: 'review', reviewer: 'review', gatekeeper: 'gatekeeper-review' });") },
  { name: "foreign-capabilities-not-asked", rule: "PR-13", ...rep(REGISTRY_REL, PIN.foreignFilter, "const foreign = list.filter(() => false);") },
  { name: "required-capability-not-asked", rule: "PR-13", ...rep(REGISTRY_REL, PIN.missingRequired, "const missing: RoleCapability[] = [];") },
  { name: "mismatch-always-clean", rule: "PR-13", ...rep(REGISTRY_REL, PIN.bindingClean, "if (true) return [];") },
  { name: "capabilities-not-bound-to-roles", rule: "PR-13", ...rep(REGISTRY_REL, PIN.bindingUsed, "") },
  { name: "no-implementer-is-fine", rule: "PR-13", ...rep(REGISTRY_REL, PIN.noImplementer, "else if (false) refusals.push(refusal('NO_IMPLEMENTER',") },
  { name: "reviewer-grants-not-asked", rule: "PR-13", ...rep(REGISTRY_REL, PIN.reviewerChecked, "return [];") },
  { name: "reviewer-may-hold-a-shell", rule: "PR-13", ...rep(REGISTRY_REL, PIN.readOnlyGrant, "const READ_ONLY_GRANT = /^(Read|Grep|Glob|LS|Bash)(\\(.*\\))?$/;") },
  { name: "ambiguous-grant-allowed", rule: "PR-13", ...rep(REGISTRY_REL, PIN.nonReadGrants, "const bad = worker.grants.filter((grant) => !READ_ONLY_GRANT.test(grant));") },
  { name: "non-read-grant-not-refused", rule: "PR-13", ...rep(REGISTRY_REL, PIN.nonReadClean, "if (true) return [];") },
  { name: "report-hands-over-no-grants", rule: "PR-13", ...rep(ROLES_REL, PIN.grantsRead, "const knownWorkers = workers.workers.map((w) => ({ workerId: w.workerId, grants: [] as string[] }));") },
];

/** Every named mutation must be killed by its own rule alone. Applied to CRLF-folded text, as `check` reads it. */
function selfTest(raw) {
  const errors = [];
  const seen = new Set();
  for (const m of MUTATIONS) {
    if (seen.has(m.name)) errors.push(`PR-M: two mutations share the name '${m.name}'`);
    seen.add(m.name);
    const text = raw[m.rel] === null || raw[m.rel] === undefined ? null : raw[m.rel].replace(/\r\n/g, "\n");
    if (text === null || (!m.missing && !text.includes(m.from))) {
      errors.push(`PR-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = [...new Set(check({ ...raw, [m.rel]: m.missing ? null : text.replace(m.from, m.to) }).map(([rule]) => rule))];
    if (!fired.includes(m.rule)) errors.push(`PR-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
    else if (fired.length > 1) errors.push(`PR-M: mutation '${m.name}' also fired ${fired.filter((r) => r !== m.rule).join(", ")}, so ${m.rule} does not carry it alone`);
  }
  const proved = new Set(MUTATIONS.map((m) => m.rule));
  for (let n = 1; n <= 13; n += 1) if (!proved.has(`PR-${n}`)) errors.push(`PR-M: rule PR-${n} has no named mutation`);
  return errors;
}

function readAll() {
  const raw = {};
  for (const rel of [...tsFilesUnder(CORE_SRC), ...tsFilesUnder(AGENT_SRC)]) raw[rel] = read(rel);
  for (const rel of [...FIXED, RECORD_REL, PROJECT_CONFIG_REL, GATEKEEPER_REL, PLATFORM_STOP_TEST_REL]) raw[rel] = read(rel);
  return raw;
}

function run() {
  const raw = readAll();
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      errors.push(`PR-T: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`PR-T: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error(`${THIS_VALIDATOR}: ${e.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
