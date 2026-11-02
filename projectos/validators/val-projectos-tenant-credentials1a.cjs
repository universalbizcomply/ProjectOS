"use strict";
/**
 * WHO MAY HAVE A CREDENTIAL, ASKED OF A KERNEL-ISSUED RUN HANDLE — PROJECTOS-TENANT-CREDENTIALS1A.
 *
 * The operation path used to compare a reference with itself. This pins what replaced that, and each way of
 * softening it that reads reasonably in a diff:
 *
 *   TCR-1  "a string will do"                     — and any caller is whoever it says it is
 *   TCR-2  "the run is wherever the process is"   — and cwd is the requester again
 *   TCR-3  "read the file, it is right there"     — and a working-tree edit or a replace ref moves a tenant
 *   TCR-4  "the registry is usually fine"         — and a contradiction further down is never seen
 *   TCR-5  "the reference knows its project"      — and the vault compares a reference with itself
 *   TCR-6  "a receipt is a confirmation"          — and a console prompt becomes a credential grant
 *   TCR-7  "the project check covers it"          — and only one rule stands between two tenants
 *   TCR-8  "tenant. is just a prefix"             — and a project calls itself a tenant, in some case
 *   TCR-9  "the gatekeeper key is a credential"   — and it is handed to a tenant
 *   TCR-10 "it is in the right tenant"            — and auto-load, with no owner step, loads a tenant secret
 *   TCR-11 "a token is a project's"               — and an account-wide token crosses tenants
 *   TCR-12 "only releases matter"                 — and a run overwrites another tenant's secret
 *   TCR-13 "the audit can stay in memory"         — and a process exit erases who took what
 *   TCR-14 "the audit is enough"                  — and a release has no envelope
 *   TCR-15 "the vault will catch it"              — and a too-wide token is a failed start with a lease held
 *   TCR-16 "a flag is convenient"                 — and an agent with no terminal mints its own console run
 *   TCR-17 "the crossing already checked"         — and the broker believes the project it is told
 *   TCR-18 "a login proves who it is"             — and a JWT reaches the kernel's credential path
 *   TCR-19 "an environment variable is convenient" — and one variable points authority at a forgery
 *   TCR-20 "register it later"                    — and nothing ever runs this file
 *   TCR-21 "the next phase will know"             — and the lead's decisions and what is unwired are nowhere
 *   TCR-22 "the old pins can go"                  — and a validator loses a rule to a new call shape
 *   TCR-23 "the adapter needs a small change"     — and a protected file moves
 *   TCR-24 "the run is over when it is over"      — and a handle never ends, and a run cannot spend
 *   TCR-25 "the record can catch up"              — and the ADR and the action registry keep the withdrawn grant
 *   TCR-26 "any phase's approval will do"         — and a gate scoped to the gatekeeper key releases a production secret
 *   TCR-27 "the code knows where it is"           — and a worktree of the installation commits its own grant
 *   TCR-28 "a commit is an owner act"             — and any commit at HEAD is a release
 *   TCR-29 "a TTY is a person"                    — and a hidden window confirms with a flag
 *   TCR-30 "the MCP client will say"              — and a server starts with no credential behind it
 *   TCR-31 "the action says what it does"         — and a grant covers any command
 *   TCR-T  "the tests exist"                      — and `.skip` keeps the proof while dropping the run
 *
 * THE PINS ARE IN THE BODIES. Each is taken from inside the function that decides, and each mutation is named
 * after what that function stops doing. `selfTest` applies each in memory and counts it killed only when ITS
 * OWN rule fires. Comments are stripped first.
 *
 * `syntheticWorld` is here because the three older credential validators need a requester too, and only a
 * real run can be one: a real git installation with a synthetic registry, a synthetic receipt, no real name
 * and no real store. `behaviour` runs the plan's criteria over one, so this validator is more than its pins.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const VAULT_REL = "projectos/credentials/vault.cjs";
const META_REL = "projectos/credentials/credential-metadata.cjs";
const REF_REL = "projectos/credentials/reference.cjs";
const GATE_REL = "projectos/credentials/operation-gate.cjs";
const CLI_REL = "projectos/scripts/projectos-credential-router.cjs";
const ROUTER_REL = "projectos/session-router/router.cjs";
const BROKER_REL = "projectos/security/gatekeeper-transport-broker.cjs";
const GC_REL = "projectos/agent/src/governedContext.ts";
const ADR_REL = "docs/adr/ADR-T1-tenant-boundary.md";
const AREG_REL = "projectos/security/action-registry.json";
const SET_CRED_REL = "projectos/control-center/src-tauri/src/set_credential.rs";
const HOST_TEST_REL = "projectos/host/gatekeeper-review-composition/src/host_ports_tests.rs";
const PROFILES_REL = "projectos/session-router/session-profiles.cjs";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const EVIDENCE_REL = "docs/finish/PROJECTOS-TENANT-CREDENTIALS1A.md";
const LEGACY_VAULT_REL = "projectos/validators/val-projectos-credential-vault1a.cjs";
const LEGACY_ADV_REL = "projectos/validators/val-projectos-credential-router-adversarial1a.cjs";
const LEGACY_SESSION_REL = "projectos/validators/val-projectos-session-router1a.cjs";
const STORE_JS_REL = "projectos/credentials/windows-credential-store.cjs";
const STORE_PS_REL = "projectos/credentials/windows-credential-store.ps1";
const THIS_VALIDATOR = "val-projectos-tenant-credentials1a";
const SOURCES = [VAULT_REL, META_REL, REF_REL, GATE_REL, CLI_REL, ROUTER_REL, BROKER_REL, VA_REL, CR_REL, GC_REL, SET_CRED_REL, HOST_TEST_REL, PROFILES_REL];

/** The protected adapter, line endings aside, as this phase found it. */
const STORE_HASHES = {
  [STORE_JS_REL]: "60fd883535630b6b3efc007670e9b473c969b422d633619b34eadf61741a8ebc",
  [STORE_PS_REL]: "b79bafd8bda9e8fd3b319640460ecf510379ce4f8fbb0c8431d9765daaa8a10d",
};

/** What each older validator must still say: the rules this phase moved to a new call shape and no further. */
const LEGACY_INVARIANTS = {
  [LEGACY_VAULT_REL]: Array.from({ length: 20 }, (_, i) => `invariant ${i + 1}`).concat(["invariant 16b", "invariant 16c", "invariant 18b", '"another project"', '"operation-class"', '"CREDENTIAL MISSING"', '"OWNER PERMIT REQUIRED"', '"not recognised"', '"already used"']),
  [LEGACY_ADV_REL]: ["invariant 1b", "invariant 13c", "invariant 13g", "invariant 14 (vault.provision)", "invariant 14 (vault.authoriseOperationRelease)", "invariant 14 (gate.run)", "invariant 18", "invariant 20"],
  [LEGACY_SESSION_REL]: Array.from({ length: 26 }, (_, i) => `invariant ${i + 1}`),
};

/** The proofs. A pin whose behaviour nobody runs is a shape, not a protection. */
const TESTS = {
  "projectos/agent/test/tenantCredentials.test.ts": [
    "survives the process boundary, and the directory a process stands in counts for nothing",
    "holds nothing but what the line and the registry say: a tenant named in text, argv or the environment changes nothing",
    "refuses a plain string and a perfect copy at every door, and a live requester passes",
    "refuses a requester outside the reference\\'s project, and runs nothing",
    "positive control: the same call from the project\\'s own run starts the command",
    "a tenant receipt is not a grant: the registry is confirmed, the permit is good, and nothing is released",
    "releases to a second project in the same tenant, and refuses across tenants",
    "matches %s case-insensitively, both ways",
    "refuses a connection calling itself tenant.<id>, in any case, before anything is read",
    "releases the gatekeeper key to no one, with every other gate open",
    "is released to no tenant session, by its own rule",
    "does not project an account-wide token into another tenant\\'s session, and only the reach rule refuses",
    "a linked worktree\\'s binding alone releases nothing, and the same credential loads from the root",
    "a session across tenants is refused by the tenant rule alone, and a second project in the tenant passes",
    "each refuses across a project and across a tenant, with the store untouched, and passes for its own",
    "survives the vault that wrote it, and holds no value",
    "stops before the store changes when a line cannot be written",
    "refuses a project the allowlist admits and the tenant registry does not list",
    "does not read through a replace ref",
  ],
  "projectos/agent/test/tenantCredentialsRecheck.test.ts": [
    "a linked worktree of the installation is no installation, so its own grant releases nothing",
    "a clone elsewhere is not the installation the registry names",
    "a worktree the registry itself names is still refused: the git rule decides alone",
    "a .git file pointing at the installation is refused, though both directories agree",
    "positive control: the main checkout passes, in any spelling Windows treats as the same path",
    "a committed grant with no receipt releases nothing, and the same grant with one does",
    "a changed grant is a new blob, so its old receipt releases nothing",
    "a receipt file copied in with no admission line releases nothing",
    "the command shows what the grant names, asks for the blob, and writes the receipt",
    "--owner-confirm with a spoofed TTY and no typed answer is refused, on every verb",
    "declaring a reach needs the typed answer, at set and at reach",
    "changing the platform key needs the typed answer",
    "a Supabase server in the project\\'s config refuses the session, by its server rule",
    "a placeholder for a token this session will not hold refuses, on any server",
    "a different argument releases nothing",
    "a different executable releases nothing, and the same path in another spelling is the same one",
    "a `supabase-pat` declared project-wide is refused for what it is called",
  ],
  "projectos/agent/test/tenantCredentialsReview.test.ts": [
    "a gatekeeper secrets-handling gate is never a grant, whatever it approves",
    "positive control: a grant naming the project, the exact reference, the action and a live expiry releases",
    "a record with %s releases nothing",
    "an uncommitted grant, and a grant committed only in the project, release nothing",
    "a replace ref cannot forge the owner\\'s approval",
    "a replace ref cannot forge the installation allowlist",
    "a console handle read back elsewhere is not a console, and with no terminal it is nothing",
    "--owner-confirm needs a real terminal, on every verb that takes it",
    "a new value clears the old reach",
    "auto-load takes project reach only",
    "the operation path refuses an undeclared reach and a reach into another tenant, with a good grant",
    "an expired credential is refused at the vault on both paths",
    "a Supabase personal access token is account-wide, whatever it declares",
    "a real process that exits with %s writes its end line, and the handle stops",
    "records the command and its exit code on disk, before and after, and no value",
    "records the session id, and the old and new reach",
    "a failed audit stops the command before it starts",
    "is the committed per-phase cap, and a paid crossing within it passes the mint",
  ],
};
/** What ADR-T1 must say about the grant, and how far any of this goes. */
const ADR_NEEDLES = [
  "is withdrawn",
  "projectos/security/credential-grants/<PHASE>.credential-release.json",
  "None exists yet, so operation release fails closed.",
  "Only provider-side scope, expiry and revocation are real boundaries.",
  "`via: console` is a label",
];
const RECHECK_REL = "projectos/agent/test/tenantCredentialsRecheck.test.ts";
const NOT_RUN = /\b(?:it|test|describe)\.(?:skip|only|todo|fails)\b|\b(?:xit|xdescribe|fit|fdescribe)\b|\.skipIf\(|\.runIf\(/;

/** What the evidence must keep saying, in plain words, for a later reader. */
const EVIDENCE_NEEDLES = [
  "The lead's remaining decisions, for the owner to overrule",
  "The lead's first grant decision is WITHDRAWN",
  "No grant exists yet, so operation release fails closed",
  "Creating one is an owner act",
  "`credential-release` stays P5",
  "Session auto-load is kept for PROJECT-class credentials only",
  "A platform credential serves every tenant through the broker and is released to none",
  "the handle names a record and is not a secret",
  "any process of this Windows user",
  "`via: console` is a label under F7",
  "the Control Center's Add credential is refused",
  "The broker cannot tell which run asked",
  "`status` stays unbound",
  "A worker can still reach any tenant's secrets",
  "Agency `secrets-credential-hygiene-engineer`: BLOCK",
  "ECC SECURITY: APPROVE WITH CHANGES",
  "ECC SECURITY recheck: BLOCK",
  "Agency recheck: APPROVE WITH CHANGES",
  "The router must run from the main checkout",
  "This raises the bar and is not a boundary",
  "A receipt proves a console confirmation and nothing more",
];

/**
 * `[rule, rel, function or null, the text that must be there]`, judged on comment-stripped source, so a pin
 * kept alive in a comment does not count.
 */
const PINS = [
  // TCR-1: the brand, and nothing else, says who is asking.
  ["TCR-1", META_REL, null, "const LIVE_REQUESTERS = new WeakMap();"],
  ["TCR-1", META_REL, "requesterState", 'typeof value === "object" && value !== null && LIVE_REQUESTERS.get(value)'],
  ["TCR-1", META_REL, "bindRun", "LIVE_REQUESTERS.set(requester, { authority, expiresAtMs, entries: registry.entries, atConsole });"],
  ["TCR-1", META_REL, "bindRun", "const requester = Object.freeze({"],
  ["TCR-1", VAULT_REL, "liveRequester", "state !== null && state.expiresAtMs > nowMs()"],
  ["TCR-1", VAULT_REL, "requireRequester", 'throw refusal("REQUESTER_REQUIRED",'],
  ["TCR-1", GATE_REL, "grantPermit", "requesterState(req.requester) === null"],
  // TCR-2: the handle is the run-start line, whatever directory holds it.
  ["TCR-2", META_REL, "bindRun", 'typeof handle !== "string" || !RUN_HANDLE_RE.test(handle)'],
  ["TCR-2", META_REL, "bindRun", 'line.stage === "admission" && line.outcome === "allowed" && envelope.envelopeVersion === 2 && envelope.action === "run-start" && envelope.parentEnvelopeId === null'],
  ["TCR-2", META_REL, "bindRun", "if (admissions.length !== 1) throw refusal("],
  ["TCR-2", META_REL, "bindRun", 'if (lines.some((line) => line.stage === "execution")) throw refusal("RUN_HANDLE_ENDED"'],
  ["TCR-2", META_REL, "bindRun", 'expiresAtMs <= nowMs()) throw refusal("RUN_HANDLE_EXPIRED"'],
  ["TCR-2", META_REL, "bindRun", "if (!REQUESTER_ROUTES.includes(via))"],
  ["TCR-2", META_REL, "bindRun", "entry.tenant !== envelope.tenant || entry.domain !== envelope.domain"],
  ["TCR-2", META_REL, "bindRun", "tenant: entry.tenant,"],
  ["TCR-2", META_REL, "fromRun", 'if (requester.via === "console") {'],
  ["TCR-2", META_REL, "fromRun", 'throw refusal("RUN_HANDLE_CONSOLE_ONLY"'],
  ["TCR-2", META_REL, "fromRun", "const requester = bindRun(handle, false);"],
  ["TCR-2", META_REL, "recordLines", 'name.startsWith(ENVELOPE_RECORDS_FILENAME + ".") && !name.endsWith(".lock") && !name.endsWith(".tmp")'],
  // TCR-3: committed bytes, confirmed.
  ["TCR-3", META_REL, "git", '["--no-replace-objects", "-C", root, ...args]'],
  ["TCR-3", META_REL, "git", 'for (const name of ["SystemRoot", "windir", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME"])'],
  ["TCR-3", META_REL, "git", '{ encoding: "utf8", windowsHide: true, cwd: installRoot, env }'],
  ["TCR-3", META_REL, "readCommitted", 'git(root, ["diff", "--name-only", "HEAD", "--", rel])'],
  ["TCR-3", META_REL, "readCommitted", "if (dirty.code !== 0 || dirty.stdout.trim()) return null;"],
  ["TCR-3", META_REL, "readCommitted", "blobNameOf(shown.stdout, blob) !== blob"],
  ["TCR-3", META_REL, "readRegistry", "if (!receiptConfirms(bytes.blob)) {"],
  ["TCR-3", META_REL, "receiptStands", 'receipt.confirmation !== "typed-terminal" || receipt[spec.blobField] !== blob'],
  ["TCR-3", META_REL, "receiptStands", "envelope.action === spec.action && envelope.envelopeId === receipt.envelopeId && envelope.subjectHash === blob"],
  ["TCR-3", META_REL, "receiptConfirms", 'kind: "tenant-registry-receipt", blobField: "registryBlob"'],
  ["TCR-3", META_REL, "boundGit", "isInsidePath(installRoot, candidate)"],
  // TCR-4: the whole file, before any match.
  ["TCR-4", META_REL, "readRegistry", "const problem = registryProblem(raw);"],
  ["TCR-4", META_REL, "readRegistry", "if (problem !== null) throw refusal(problem.code, problem.message);"],
  ["TCR-4", META_REL, "registryProblem", 'return problem("TENANT_REGISTRY_WILDCARD"'],
  ["TCR-4", META_REL, "registryProblem", 'return problem("TENANT_REGISTRY_RESERVED_ID"'],
  ["TCR-4", META_REL, "registryProblem", '!once("project:", asciiLower(entry.projectId)) || !once("repository:", asciiLower(entry.repository)) || !once("root:", root)'],
  ["TCR-4", META_REL, "registryProblem", 'return problem("TENANT_REGISTRY_NESTED_ROOT"'],
  ["TCR-4", META_REL, "registryProblem", "!tenantIds.includes(entry.tenant) || !DOMAINS.includes(entry.domain)"],
  // TCR-5: the operation path asks who is asking.
  ["TCR-5", GATE_REL, "run", "vault.authoriseOperationRelease({ reference: ref.reference, requester: req.requester, permit, capability: req.capability || {}, command: [executable, ...args] })"],
  ["TCR-5", GATE_REL, "run", 'return refuse(typeof e.code === "string" ? e.code : "OWNER PERMIT REQUIRED", base);'],
  ["TCR-5", GATE_REL, "grantPermit", "runHandle: req.requester.runHandle,"],
  ["TCR-5", VAULT_REL, "authoriseOperationRelease", "const outside = boundaryRefusal(ref, requester, state);"],
  ["TCR-5", VAULT_REL, "authoriseOperationRelease", "permit.runHandle !== requester.runHandle"],
  // TCR-6: the P5 grant is the owner's committed record, at the registered root.
  ["TCR-6", VAULT_REL, "authoriseOperationRelease", "const ungranted = state.authority.operationGrantRefusal(requester, ref, permit, command);"],
  ["TCR-6", VAULT_REL, "authoriseOperationRelease", 'refuseRelease(ref, requester, "authorise-operation", ungranted, "CREDENTIAL_GRANT_REQUIRED");'],
  // TCR-26: the grant names what it releases.
  ["TCR-26", META_REL, "operationGrantRefusal", 'readCommitted(installRoot, CREDENTIAL_GRANTS_REL + phaseId + ".credential-release.json")'],
  ["TCR-26", META_REL, "operationGrantRefusal", "const malformed = grantShapeProblem(grant);"],
  ["TCR-26", META_REL, "operationGrantRefusal", "if (malformed !== null) return malformed;"],
  ["TCR-26", META_REL, "grantShapeProblem", "keys.length !== CREDENTIAL_GRANT_FIELDS.length || !CREDENTIAL_GRANT_FIELDS.every((field) => keys.includes(field))"],
  ["TCR-26", META_REL, "grantShapeProblem", 'grant.schemaVersion !== "1.0.0" || grant.kind !== CREDENTIAL_GRANT_KIND'],
  ["TCR-26", META_REL, "grantShapeProblem", 'typeof grant.grantedBy !== "string" || grant.grantedBy.trim() === ""'],
  ["TCR-26", META_REL, "operationGrantRefusal", "if (grant.phaseId !== phaseId)"],
  ["TCR-26", META_REL, "operationGrantRefusal", "if (grant.projectId !== requester.project)"],
  ["TCR-26", META_REL, "operationGrantRefusal", "!grant.references.includes(ref.reference)"],
  ["TCR-26", META_REL, "operationGrantRefusal", "grant.action !== permit.action"],
  ["TCR-26", META_REL, "grantShapeProblem", "new Date(expiresAtMs).toISOString() !== grant.expiresAt"],
  ["TCR-26", META_REL, "operationGrantRefusal", "if (Date.parse(grant.expiresAt) <= nowMs())"],
  ["TCR-26", META_REL, "operationGrantRefusal", "!PHASE_ID_RE.test(phaseId)"],
  ["TCR-26", META_REL, null, 'const CREDENTIAL_GRANT_FIELDS = Object.freeze(["schemaVersion", "kind", "phaseId", "projectId", "references", "action", "command", "expiresAt", "grantedBy"]);'],
  // TCR-7: two questions, each able to refuse alone.
  ["TCR-7", VAULT_REL, "boundaryRefusal", 'return ref.tenantId === requester.tenant ? null : { code: "TENANT_MISMATCH", reason: "cross-tenant-refused" };'],
  ["TCR-7", VAULT_REL, "boundaryRefusal", 'if (!belongsToProject(ref, requester.project)) return { code: "CROSS_PROJECT_REFUSED", reason: "cross-project-refused" };'],
  ["TCR-7", VAULT_REL, "boundaryRefusal", "const entry = state.entries.get(ref.project);"],
  ["TCR-7", VAULT_REL, "boundaryRefusal", 'return entry.tenant === requester.tenant ? null : { code: "TENANT_MISMATCH", reason: "cross-tenant-refused" };'],
  // TCR-8: the classes, and the case.
  ["TCR-8", REF_REL, "isReservedProjectId", "asciiLower(projectId).startsWith(TENANT_PREFIX)"],
  ["TCR-8", REF_REL, "asciiLower", 'text.replace(/[A-Z]/g,'],
  ["TCR-8", REF_REL, "parseReference", "isReservedProjectId(project) ? asciiLower(project).slice(TENANT_PREFIX.length) : null"],
  ["TCR-8", REF_REL, "parseReference", 'if (tenantId !== null && !isTenantId(tenantId)) return { ok: false, reason: "reference-invalid-tenant-segment" };'],
  ["TCR-8", REF_REL, "parseReference", 'credentialClass: PLATFORM_SET.has(asciiLower(text)) ? "platform" : tenantId !== null ? "tenant" : "project",'],
  ["TCR-8", REF_REL, null, 'const PLATFORM_REFERENCES = Object.freeze(["ProjectOS/projectos/development/openai/gatekeeper-api-key"]);'],
  ["TCR-8", REF_REL, null, 'const TENANT_PREFIX = "tenant.";'],
  ["TCR-8", REF_REL, null, "const PLATFORM_SET = new Set(PLATFORM_REFERENCES.map(asciiLower));"],
  // TCR-9: released to none, changed from a console.
  ["TCR-9", VAULT_REL, "authoriseOperationRelease", 'if (ref.credentialClass === "platform") {'],
  ["TCR-9", VAULT_REL, "authoriseOperationRelease", 'throw refusal("PLATFORM_RELEASED_TO_NONE"'],
  ["TCR-9", VAULT_REL, "sessionRefusal", 'if (ref.credentialClass === "platform") return { code: "PLATFORM_RELEASED_TO_NONE"'],
  ["TCR-9", VAULT_REL, "requireMutator", "if (!atConsole(requester)) {"],
  ["TCR-9", VAULT_REL, "atConsole", "state !== null && state.atConsole === true"],
  // TCR-10: auto-load is for a project's own credential.
  ["TCR-10", VAULT_REL, "sessionRefusal", 'if (ref.credentialClass === "tenant") return { code: "TENANT_CLASS_NOT_SESSION"'],
  ["TCR-10", VAULT_REL, "sessionRefusal", 'if (requester.via === "linked-worktree") return { code: "LINKED_WORKTREE_ALONE"'],
  ["TCR-10", VAULT_REL, "sessionRefusal", 'if (ref.risk !== "session") return { code: "OPERATION_CLASS"'],
  ["TCR-10", VAULT_REL, "sessionRefusal", "const refused = boundaryRefusal(ref, requester, state);"],
  ["TCR-10", VAULT_REL, "authoriseSessionRelease", "const refused = sessionRefusal(ref, requester, state);"],
  // TCR-11: reach.
  ["TCR-11", VAULT_REL, "fitnessRefusal", 'if (!REACHES.includes(declared)) return { code: "REACH_UNDECLARED"'],
  ["TCR-11", VAULT_REL, "fitnessRefusal", 'if (record && metadata.isExpired(record, new Date(nowMs()).toISOString())) return { code: "CREDENTIAL_EXPIRED"'],
  ["TCR-11", VAULT_REL, "fitnessRefusal", 'return declared === "project" && !accountWide ? null : { code: "REACH_WIDER_THAN_PROJECT"'],
  ["TCR-11", VAULT_REL, "fitnessRefusal", 'const accountWide = isAccountWide(ref.credential) || declared === "account";'],
  ["TCR-11", REF_REL, "isAccountWide", "ACCOUNT_WIDE_CREDENTIALS.includes(credentialName) || ACCOUNT_WIDE_NAME_RE.test(credentialName)"],
  ["TCR-11", VAULT_REL, "fitnessRefusal", "tenants.some((tenant) => tenant !== requester.tenant)"],
  ["TCR-11", VAULT_REL, "authoriseSessionRelease", 'const unfit = fitnessRefusal(ref, requester, "session");'],
  ["TCR-11", VAULT_REL, "authoriseOperationRelease", 'const unfit = fitnessRefusal(ref, requester, "operation");'],
  ["TCR-11", VAULT_REL, "requireConsoleForReach", "if (!atConsole(input.requester)) {"],
  ["TCR-11", REF_REL, null, 'const ACCOUNT_WIDE_CREDENTIALS = Object.freeze(["supabase-access-token"]);'],
  ["TCR-11", PROFILES_REL, null, 'credentials: ["gh-token", "vercel-token"],'],
  ["TCR-11", VAULT_REL, "provision", 'requireConsoleForReach(input, ref, "provision");'],
  ["TCR-11", VAULT_REL, "rotateMetadata", 'requireConsoleForReach(input, ref, "rotate-metadata");'],
  ["TCR-11", META_REL, "assertNonSecret", "if (!REACHES.includes(record.reach))"],
  ["TCR-11", META_REL, "assertNonSecret", '!Array.isArray(tenants) || tenants.length === 0 || !tenants.every(isTenantId)'],
  ["TCR-11", META_REL, "statedReach", "reach: stated ? record.reach : null"],
  ["TCR-11", META_REL, "recordProvisionLocked", "...statedReach(record),"],
  // TCR-12: the mutators are bound, and say so before they act.
  ["TCR-12", VAULT_REL, "provision", 'const ref = requireMutator(input, "provision");'],
  ["TCR-12", VAULT_REL, "remove", 'const ref = requireMutator(input, "delete");'],
  ["TCR-12", VAULT_REL, "present", 'const ref = requireMutator(input, "present");'],
  ["TCR-12", VAULT_REL, "rotateMetadata", 'const ref = requireMutator(input, "rotate-metadata");'],
  ["TCR-12", VAULT_REL, "requireMutator", "const refused = boundaryRefusal(ref, requester, state);"],
  // TCR-13: the audit is on disk or nothing happened.
  ["TCR-13", VAULT_REL, "writeAuditLine", 'throw refusal("AUDIT_NOT_RECORDED"'],
  ["TCR-13", VAULT_REL, "writeAuditLine", "fs.appendFileSync(auditPath, redactor.redactText(JSON.stringify(entry))"],
  ["TCR-13", VAULT_REL, "writeAuditLine", "fs.statSync(auditPath).size >= AUDIT_ROTATE_BYTES"],
  ["TCR-13", VAULT_REL, "log", 'writeAuditLine({ ...entry, at: new Date(nowMs()).toISOString() });'],
  ["TCR-13", VAULT_REL, "requireRef", "log({ action, ok: false, reason: parsed.reason });"],
  ["TCR-13", VAULT_REL, null, 'const AUDIT_FILE_NAME = "credential-audit.jsonl";'],
  ["TCR-13", VAULT_REL, "log", "sessionId: event.sessionId || null,"],
  ["TCR-13", VAULT_REL, "log", "command: event.command || null,"],
  ["TCR-13", VAULT_REL, "log", "exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,"],
  ["TCR-13", VAULT_REL, "log", "reachBefore: event.reachBefore || null,"],
  ["TCR-13", VAULT_REL, "log", "reachAfter: event.reachAfter || null,"],
  ["TCR-13", VAULT_REL, "rotateMetadata", "reachBefore, reachAfter: record.reach"],
  ["TCR-13", GATE_REL, "run", 'vault.auditOperation({ ...audited, action: "operation-start", command: executable'],
  ["TCR-13", GATE_REL, "run", 'return refuse("AUDIT_NOT_RECORDED", base);'],
  ["TCR-13", GATE_REL, "run", 'vault.auditOperation({ ...audited, action: "operation-end", exitCode'],
  ["TCR-13", GATE_REL, "run", 'return { ok: false, blocker: "AUDIT_NOT_RECORDED", exitCode'],
  ["TCR-13", GATE_REL, "run", 'matchedShapes(a).length ? "[credential-shaped]" : a'],
  // TCR-14: a release goes through an envelope, recorded first.
  ["TCR-14", VAULT_REL, "recordReleaseAdmission", 'if (!state.authority.recordRelease(requester, ref, { outcome: "allowed", rule: null, reasons: [], intent, grantSource })) {'],
  ["TCR-14", VAULT_REL, "recordReleaseAdmission", 'throw refusal("ENVELOPE_NOT_RECORDED"'],
  ["TCR-14", VAULT_REL, "authoriseSessionRelease", 'recordReleaseAdmission(ref, requester, state, "session:" + String(id), "session-auto-load");'],
  ["TCR-14", VAULT_REL, "authoriseOperationRelease", 'recordReleaseAdmission(ref, requester, state, "operation:" + String(permitId), "credential-release:" + permit.phaseId);'],
  ["TCR-14", VAULT_REL, "refuseRelease", 'throw refusal("REFUSAL_NOT_RECORDED"'],
  ["TCR-14", META_REL, "recordRelease", 'const action = actionEntry("credential-release");'],
  ["TCR-14", META_REL, "recordRelease", 'scope: ["run:" + requester.runHandle],'],
  ["TCR-14", META_REL, "recordRelease", "actionClass: action.class,"],
  ["TCR-14", META_REL, "recordRelease", "runLinked: true"],
  ["TCR-14", META_REL, "appendRecord", 'const lock = file + ".lock";'],
  ["TCR-14", META_REL, "appendRecord", "if (!takeRecordLock(lock)) return false;"],
  ["TCR-14", META_REL, "appendRecord", 'return fs.readFileSync(file, "utf8").endsWith(line);'],
  ["TCR-14", META_REL, "takeRecordLock", '{ flag: "wx" }'],
  ["TCR-14", META_REL, "takeRecordLock", "step < RECORD_LOCK_WAIT_STEPS"],
  ["TCR-14", META_REL, "idempotencyKeyOf", "JSON.stringify([intent.tenant, intent.project, intent.action, intent.subjectHash, intent.intentScope])"],
  ["TCR-14", META_REL, null, 'const IDEMPOTENCY_DOMAIN = "projectos-envelope-idempotency-v2:";'],
  // TCR-15: the session router asks before it acquires.
  ["TCR-15", ROUTER_REL, "prepare", 'if (isReservedProjectId(connection.projectId)) {'],
  ["TCR-15", ROUTER_REL, "prepare", "const notThisRequester = vault.requesterRefusalFor(req.requester, connection.projectId);"],
  ["TCR-15", ROUTER_REL, "prepare", "if (notThisRequester !== null) {"],
  ["TCR-15", ROUTER_REL, "prepare", "credential.present ? vault.sessionReleaseRefusal({ reference: credential.reference, requester: req.requester }) : null"],
  ["TCR-15", ROUTER_REL, "projectEnvironment", "requester: prepared.requester, sessionId: prepared.sessionId"],
  ["TCR-15", ROUTER_REL, "buildRecord", "tenant: prepared.requester.tenant,"],
  ["TCR-15", VAULT_REL, "requesterRefusalFor", 'if (requester.project !== projectId) return "CROSS_PROJECT_REFUSED";'],
  ["TCR-15", VAULT_REL, "requesterRefusalFor", 'return entry.tenant === requester.tenant ? null : "TENANT_MISMATCH";'],
  // TCR-16: a console is both ends, and a project the registry lists.
  ["TCR-16", CLI_REL, "requesterFor", "if (flags.run !== undefined) return authority.fromRun(flags.run);"],
  ["TCR-16", CLI_REL, "requesterFor", "if (!atRealTerminal(deps)) {"],
  ["TCR-16", CLI_REL, "requesterFor", "return authority.issueConsoleRun({ projectId: flags.project });"],
  ["TCR-16", CLI_REL, "credentialsCommand", "const requester = requesterFor(flags, deps);\n    await confirmSensitive(ref, flags, deps);\n    const fromEnv"],
  ["TCR-16", CLI_REL, "credentialsCommand", "const removed = vault.remove({ reference: ref.reference, requester });"],
  ["TCR-16", CLI_REL, "sessionCommand", "requester: requesterFor(flags, deps),"],
  ["TCR-16", CLI_REL, "operationCommand", "const requester = requesterFor(flags, deps);"],
  ["TCR-16", CLI_REL, "operationCommand", 'throw new Error("--phase is required'],
  ["TCR-16", META_REL, "issueConsoleRun", "const entry = registry.entries.get(projectId);"],
  ["TCR-16", META_REL, "issueConsoleRun", 'via: "console"'],
  ["TCR-16", META_REL, "issueConsoleRun", "return bindRun(envelopeId, true);"],
  ["TCR-16", CLI_REL, "atRealTerminal", "terminal.stdin.isTTY === true && terminal.stdout.isTTY === true"],
  // TCR-17: the broker's own check.
  ["TCR-17", BROKER_REL, "git", 'spawnSync(exe, ["--no-replace-objects", "-C", root, ...args]'],
  ["TCR-17", BROKER_REL, "readCommitted", 'git(root, ["diff", "--name-only", "HEAD", "--", rel])'],
  ["TCR-17", BROKER_REL, "readCommitted", "return named === blob ? shown.stdout : null;"],
  ["TCR-17", BROKER_REL, "tenantOfProject", "readCommitted(installRoot, TENANT_REGISTRY_REL)"],
  ["TCR-17", BROKER_REL, "tenantRegistryProblem", '/^[a-z][a-z0-9-]{1,56}$/.test(id)'],
  ["TCR-17", BROKER_REL, "tenantRegistryProblem", '["develop", "business", "personal", "phone"].indexOf(entry.domain) === -1'],
  ["TCR-17", BROKER_REL, "tenantOfProject", "const wrong = tenantRegistryProblem(registry);"],
  ["TCR-17", BROKER_REL, "tenantOfProject", 'return { problem: "TENANT_UNKNOWN: project '],
  ["TCR-17", BROKER_REL, "tenantOfProject", "repository.toLowerCase() !== entry.repository.toLowerCase()"],
  ["TCR-17", BROKER_REL, "tenantOfProject", "if (!sameRealPath(entry.governedRoot, governedRoot)) {"],
  ["TCR-17", BROKER_REL, "tenantRegistryProblem", 'return "TENANT_REGISTRY_WILDCARD: a project line has a wildcard"'],
  ["TCR-17", BROKER_REL, "tenantRegistryProblem", 'if (key(entry.projectId).startsWith("tenant."))'],
  ["TCR-17", BROKER_REL, "tenantRegistryProblem", 'repeated("project", entry.projectId) || repeated("repository", entry.repository) || repeated("root", root)'],
  ["TCR-17", BROKER_REL, "tenantRegistryProblem", 'return "TENANT_REGISTRY_NESTED_ROOT: one project'],
  ["TCR-17", BROKER_REL, "tenantRegistryProblem", "if (tenants.indexOf(entry.tenant) === -1)"],
  ["TCR-17", BROKER_REL, "reserveSpend", "tenant: tenant,"],
  ["TCR-17", BROKER_REL, null, "const bound = tenantOfProject(installRoot, governedRoot, projectId);"],
  ["TCR-17", BROKER_REL, null, "if (bound.problem !== undefined) return bound.problem;"],
  ["TCR-17", BROKER_REL, null, "const overspend = reserveSpend(projectId, spendKey, requestId, spendLimit, boundTenant);"],
  ["TCR-17", BROKER_REL, null, 'const VAULT_REFERENCE = Object.freeze({\n  OPENAI_GATEKEEPER_KEY: "ProjectOS/projectos/development/openai/gatekeeper-api-key",\n});'],
  // TCR-27: the installation is the main checkout the registry names.
  ["TCR-27", META_REL, "requireSources", 'const asked = ["--git-dir", "--git-common-dir"].map((flag) => git(installRoot, ["rev-parse", flag]));'],
  ["TCR-27", META_REL, "requireSources", "dirs[0] !== dirs[1] || dirs[0] !== pathKey(path.join(installRoot, \".git\"))"],
  ["TCR-27", META_REL, "requireSources", 'throw refusal("INSTALLATION_NOT_MAIN_CHECKOUT"'],
  ["TCR-27", META_REL, "readRegistry", "const self = raw.projects.find((entry) => entry.projectId === INSTALLATION_PROJECT_ID);"],
  ["TCR-27", META_REL, "readRegistry", "self === undefined || pathKey(self.governedRoot) !== pathKey(installRoot)"],
  ["TCR-27", META_REL, "pathKey", 'process.platform === "win32" ? asciiLower(forward) : forward'],
  // TCR-28: a grant needs its receipt.
  ["TCR-28", META_REL, "operationGrantRefusal", "if (!grantReceiptConfirms(bytes.blob)) return"],
  ["TCR-28", META_REL, "grantReceiptConfirms", 'kind: GRANT_RECEIPT_KIND, blobField: "grantBlob", changes: GRANT_CHANGE_RECORDS_FILENAME, action: "credential-release"'],
  ["TCR-28", META_REL, "grantReceiptPath", "path.join(stateDir, GRANT_RECEIPTS_DIRNAME, blob + \".json\")"],
  ["TCR-28", META_REL, "confirmGrant", "if (typed !== blob.slice(0, GRANT_CONFIRMATION_LENGTH)) {"],
  ["TCR-28", META_REL, "confirmGrant", "const grant = describeGrant(blob);"],
  ["TCR-28", META_REL, "confirmGrant", "if (!grantReceiptConfirms(blob)) throw refusal("],
  ["TCR-28", META_REL, "describeGrant", 'git(installRoot, ["ls-tree", "-r", "HEAD", "--", CREDENTIAL_GRANTS_REL])'],
  ["TCR-28", META_REL, "describeGrant", "if (bytes === null || bytes.blob !== blob) throw missing();"],
  ["TCR-28", META_REL, "describeGrant", "if (grantShapeProblem(grant) !== null) throw missing();"],
  ["TCR-28", META_REL, null, "A grant receipt shows that a person or a process confirmed this grant blob at a console, nothing more."],
  ["TCR-28", META_REL, null, "It does not stop a process that drives a console or writes the receipt and its line directly"],
  ["TCR-28", CLI_REL, "grantReceiptCommand", "if (!atRealTerminal(deps)) throw new Error(noConsole);"],
  ["TCR-28", CLI_REL, "grantReceiptCommand", "const grant = authority.describeGrant(blob);"],
  ["TCR-28", CLI_REL, "grantReceiptCommand", 'console.log("  command     " + grant.command.join(" "));'],
  ["TCR-28", CLI_REL, "grantReceiptCommand", "authority.confirmGrant({ blob, typed });"],
  // TCR-29: a flag confirms nothing.
  ["TCR-29", CLI_REL, "typedConfirmation", "(await askTerminal('Type \"' + expected + '\" to confirm: ', deps)) !== expected"],
  ["TCR-29", CLI_REL, "askTerminal", 'if (!atRealTerminal(deps) || typeof terminal.readLine !== "function") return null;'],
  ["TCR-29", CLI_REL, "requireOwnerConfirm", "await typedConfirmation(deps, expected, message);"],
  ["TCR-29", CLI_REL, "confirmSensitive", 'ref.credentialClass === "platform" || flags.reach !== undefined'],
  ["TCR-29", CLI_REL, "confirmSensitive", "await typedConfirmation(deps, ref.reference,"],
  ["TCR-29", CLI_REL, "readTypedLine", 'input.on("end", onEnd);'],
  // TCR-30: a server needs a projected credential.
  ["TCR-30", ROUTER_REL, "prepare", "if (permitsCredential(profile.name, entry.credential)) standIns[entry.key] = \"declared\";"],
  ["TCR-30", ROUTER_REL, "prepare", "Object.assign(declaredEnv, adapter.projectEnvironment(connection, environment, standIns));"],
  ["TCR-30", ROUTER_REL, "prepare", "const allowedServers = declaredProviders.filter((name) => profile.mcpServers.includes(name));"],
  ["TCR-30", ROUTER_REL, "prepare", "env: declaredEnv, allowedServers });"],
  ["TCR-30", PROFILES_REL, null, 'mcpServers: ["github", "vercel"],'],
  // TCR-31: a grant names the exact command.
  ["TCR-31", META_REL, "operationGrantRefusal", "if (!sameCommand(grant.command, command)) return"],
  ["TCR-31", META_REL, "sameCommand", "running.length === granted.length && pathKey(granted[0]) === pathKey(running[0]) && granted.every((item, index) => index === 0 || item === running[index])"],
  ["TCR-31", META_REL, "grantShapeProblem", "if (!textList(grant.command)) return"],
  ["TCR-31", VAULT_REL, "authoriseOperationRelease", "const { requester, permit, command } = input || {};"],
  ["TCR-31", GATE_REL, "run", "command: [executable, ...args] });"],
  // TCR-24: a run ends on the record, and has a budget.
  ["TCR-24", GC_REL, "endAdmittedRuns", "exitCode === 0 ? 'allowed' : 'failed', `run-ended:${exitCode}`"],
  ["TCR-24", GC_REL, "endAdmittedRuns", "LIVE_RUNS.delete(run);"],
  ["TCR-24", GC_REL, "holdRunUntilExit", "process.once('exit', endAdmittedRuns);"],
  ["TCR-24", GC_REL, "runStartTenantRefusal", "holdRunUntilExit({ sys, stateDir: source.stateDir, envelope: admission.envelope });"],
  ["TCR-24", GC_REL, "runStartTenantRefusal", "budget: committedPhaseCap(sys, root),"],
  ["TCR-24", GC_REL, "admitBoundary", "budget: request.budget ?? 0,"],
  ["TCR-24", GC_REL, "committedPhaseCap", "'--no-replace-objects', '-C', root, 'show', `HEAD:./${GATEKEEPER_CONFIG_REL}`"],
  ["TCR-24", GC_REL, "committedPhaseCap", "?.budget?.phaseHardStopAtMicroUsd"],
  ["TCR-24", GC_REL, "committedPhaseCap", "Number.isSafeInteger(cap) && cap > 0 ? cap : 0"],
  // TCR-25: what the owner reads says what is true, and the Add credential route explains itself.
  // TCR-19: the state directory and the installation are the kernel's.
  ["TCR-19", META_REL, "installationStateDir", 'key(derived) === key(stated)'],
  ["TCR-19", META_REL, "installationStateDir", "os.userInfo().homedir"],
  ["TCR-19", META_REL, "requireSources", "!path.isAbsolute(stateDir)"],
  ["TCR-19", CLI_REL, "authorityOf", "createRequesterAuthority({ installRoot: INSTALL_ROOT, stateDir: installationStateDir() })"],
  ["TCR-19", CLI_REL, null, 'const INSTALL_ROOT = path.resolve(__dirname, "..", "..")'],
];

const M = (name, rule, rel, from, to) => ({ name, rule, rel, from, to });

const MUTATIONS = [
  // TCR-1
  M("brand-accepts-any-object", "TCR-1", META_REL, 'return (typeof value === "object" && value !== null && LIVE_REQUESTERS.get(value)) || null;', 'return (typeof value === "object" && value !== null && { expiresAtMs: Infinity }) || null;'),
  M("requester-never-branded", "TCR-1", META_REL, "LIVE_REQUESTERS.set(requester, { authority, expiresAtMs, entries: registry.entries, atConsole });", ""),
  M("requester-not-frozen", "TCR-1", META_REL, "const requester = Object.freeze({", "const requester = ({"),
  M("stale-requester-passes", "TCR-1", VAULT_REL, "return state !== null && state.expiresAtMs > nowMs() ? state : null;", "return state;"),
  M("string-reads-as-a-requester", "TCR-1", VAULT_REL, 'throw refusal("REQUESTER_REQUIRED", "credential-vault: REQUESTER REQUIRED — only a live kernel-issued run handle may ask");', 'return { entries: new Map() };'),
  M("permit-for-anyone", "TCR-1", GATE_REL, "if (requesterState(req.requester) === null) {", "if (false) {"),
  // TCR-2
  M("handle-any-text", "TCR-2", META_REL, 'if (typeof handle !== "string" || !RUN_HANDLE_RE.test(handle)) {', 'if (typeof handle !== "string") {'),
  M("handle-from-any-action", "TCR-2", META_REL, 'envelope.action === "run-start" && envelope.parentEnvelopeId === null;', "envelope.parentEnvelopeId === null;"),
  M("handle-from-a-refused-line", "TCR-2", META_REL, 'line.stage === "admission" && line.outcome === "allowed" && envelope.envelopeVersion === 2', 'line.stage === "admission" && envelope.envelopeVersion === 2'),
  M("two-lines-one-handle", "TCR-2", META_REL, "if (admissions.length !== 1) throw refusal(", "if (admissions.length === 0) throw refusal("),
  M("ended-run-asks", "TCR-2", META_REL, 'if (lines.some((line) => line.stage === "execution")) throw refusal("RUN_HANDLE_ENDED", "this run has recorded its end, so it asks for nothing more");', ""),
  M("expired-run-asks", "TCR-2", META_REL, 'expiresAtMs <= nowMs()) throw refusal("RUN_HANDLE_EXPIRED"', 'false) throw refusal("RUN_HANDLE_EXPIRED"'),
  M("any-route-on-a-line", "TCR-2", META_REL, "if (!REQUESTER_ROUTES.includes(via))", "if (false)"),
  M("line-not-held-to-the-registry", "TCR-2", META_REL, "if (entry.tenant !== envelope.tenant || entry.domain !== envelope.domain) {", "if (false) {"),
  M("tenant-taken-from-the-line", "TCR-2", META_REL, "      tenant: entry.tenant,\n      domain: entry.domain,\n      project: entry.projectId,\n      via,", "      tenant: envelope.tenant,\n      domain: entry.domain,\n      project: entry.projectId,\n      via,"),
  M("rotated-record-not-read", "TCR-2", META_REL, '.filter((name) => name === ENVELOPE_RECORDS_FILENAME || (name.startsWith(ENVELOPE_RECORDS_FILENAME + ".") && !name.endsWith(".lock") && !name.endsWith(".tmp")))', ".filter((name) => name === ENVELOPE_RECORDS_FILENAME)"),
  M("handle-reads-cwd", "TCR-2", META_REL, "    const registry = readRegistry();\n    const lines = recordLines()", "    const registry = readRegistry();\n    const here = process.cwd();\n    const lines = recordLines()"),
  M("console-handle-travels", "TCR-2", META_REL, '    if (requester.via === "console") {\n      LIVE_REQUESTERS.delete(requester);\n      throw refusal("RUN_HANDLE_CONSOLE_ONLY", "a console run\'s authority ends with the process that minted it, so its handle is nobody\'s elsewhere");\n    }\n', ""),
  M("from-run-claims-the-console", "TCR-2", META_REL, "const requester = bindRun(handle, false);", "const requester = bindRun(handle, true);"),
  M("console-run-reads-cwd", "TCR-2", META_REL, "    const projectId = (input || {}).projectId;\n", "    const projectId = (input || {}).projectId || process.cwd();\n"),
  // TCR-3
  M("replace-refs-allowed", "TCR-3", META_REL, '["--no-replace-objects", "-C", root, ...args]', '["-C", root, ...args]'),
  M("git-inherits-the-environment", "TCR-3", META_REL, "const r = childProcess.spawnSync(exe, [\"--no-replace-objects\", \"-C\", root, ...args], { encoding: \"utf8\", windowsHide: true, cwd: installRoot, env });", "const r = childProcess.spawnSync(exe, [\"--no-replace-objects\", \"-C\", root, ...args], { encoding: \"utf8\", windowsHide: true, cwd: installRoot, env: process.env });"),
  M("dirty-registry-accepted", "TCR-3", META_REL, "if (dirty.code !== 0 || dirty.stdout.trim()) return null;", "if (dirty.code !== 0) return null;"),
  M("bytes-not-hashed", "TCR-3", META_REL, " || blobNameOf(shown.stdout, blob) !== blob) return null;", ") return null;"),
  M("no-receipt-passes", "TCR-3", META_REL, "if (!receiptConfirms(bytes.blob)) {", "if (false) {"),
  M("any-receipt-will-do", "TCR-3", META_REL, 'receipt.confirmation !== "typed-terminal" || receipt[spec.blobField] !== blob', 'receipt.confirmation !== "typed-terminal"'),
  M("receipt-needs-no-line", "TCR-3", META_REL, "envelope.action === spec.action && envelope.envelopeId === receipt.envelopeId && envelope.subjectHash === blob", "envelope.action === spec.action"),
  M("git-from-the-installation", "TCR-3", META_REL, "if (isInsidePath(installRoot, candidate) || ", "if ("),
  // TCR-4
  M("registry-not-judged-whole", "TCR-4", META_REL, "const problem = registryProblem(raw);", "const problem = null;"),
  M("registry-problem-ignored", "TCR-4", META_REL, "if (problem !== null) throw refusal(problem.code, problem.message);", ""),
  M("wildcard-matches-nothing", "TCR-4", META_REL, 'if (fields.some((field) => WILDCARD_RE.test(field))) return problem("TENANT_REGISTRY_WILDCARD", "a project line has a wildcard");', ""),
  M("reserved-id-allowed", "TCR-4", META_REL, 'if (isReservedProjectId(entry.projectId)) return problem("TENANT_REGISTRY_RESERVED_ID", "a project id starts with the reserved tenant prefix");', ""),
  M("duplicates-ignore-the-repository", "TCR-4", META_REL, ' || !once("repository:", asciiLower(entry.repository))', ""),
  M("duplicates-fold-nothing", "TCR-4", META_REL, '!once("project:", asciiLower(entry.projectId))', '!once("project:", entry.projectId)'),
  M("nested-roots-allowed", "TCR-4", META_REL, 'return problem("TENANT_REGISTRY_NESTED_ROOT", "one project\'s root is inside another\'s");', "return null;"),
  M("undeclared-tenant-allowed", "TCR-4", META_REL, "!tenantIds.includes(entry.tenant) || !DOMAINS.includes(entry.domain)", "!DOMAINS.includes(entry.domain)"),
  // TCR-5
  M("gate-compares-the-reference-with-itself", "TCR-5", GATE_REL, "grant = vault.authoriseOperationRelease({ reference: ref.reference, requester: req.requester, permit, capability: req.capability || {}, command: [executable, ...args] });", "grant = vault.authoriseOperationRelease({ reference: ref.reference, projectId: ref.project, permit, capability: req.capability || {}, command: [executable, ...args] });"),
  M("gate-refusal-escapes", "TCR-5", GATE_REL, 'return refuse(typeof e.code === "string" ? e.code : "OWNER PERMIT REQUIRED", base);', "throw e;"),
  M("permit-names-no-run", "TCR-5", GATE_REL, "      runHandle: req.requester.runHandle,\n", ""),
  M("operation-skips-the-boundary", "TCR-5", VAULT_REL, "const outside = boundaryRefusal(ref, requester, state);", "const outside = null;"),
  M("permit-for-any-run", "TCR-5", VAULT_REL, " || permit.runHandle !== requester.runHandle) {", ") {"),
  // TCR-6
  M("no-grant-asked", "TCR-6", VAULT_REL, "const ungranted = state.authority.operationGrantRefusal(requester, ref, permit, command);", "const ungranted = null;"),
  M("grant-refusal-not-recorded", "TCR-6", VAULT_REL, 'refuseRelease(ref, requester, "authorise-operation", ungranted, "CREDENTIAL_GRANT_REQUIRED");', ""),
  M("grant-reads-a-receipt", "TCR-6", META_REL, "  function operationGrantRefusal(requester, ref, permit, command) {\n", "  function operationGrantRefusal(requester, ref, permit, command) {\n    if (receiptConfirms(ref.reference)) return null;\n"),
  // TCR-26
  M("grant-read-from-the-project", "TCR-26", META_REL, 'readCommitted(installRoot, CREDENTIAL_GRANTS_REL + phaseId + ".credential-release.json")', 'readCommitted(requesterState(requester).entries.get(requester.project).governedRoot, CREDENTIAL_GRANTS_REL + phaseId + ".credential-release.json")'),
  M("grant-any-gate-file", "TCR-26", META_REL, 'CREDENTIAL_GRANTS_REL + phaseId + ".credential-release.json"', '".projectops/gates/" + phaseId + ".secrets-handling.json"'),
  M("grant-any-fields", "TCR-26", META_REL, 'if (keys.length !== CREDENTIAL_GRANT_FIELDS.length || !CREDENTIAL_GRANT_FIELDS.every((field) => keys.includes(field))) {', "if (false) {"),
  M("grant-any-kind", "TCR-26", META_REL, 'if (grant.schemaVersion !== "1.0.0" || grant.kind !== CREDENTIAL_GRANT_KIND) return', "if (false) return"),
  M("grant-names-nobody", "TCR-26", META_REL, 'if (typeof grant.grantedBy !== "string" || grant.grantedBy.trim() === "") return', "if (false) return"),
  M("grant-any-phase", "TCR-26", META_REL, 'if (grant.phaseId !== phaseId) return "the committed credential-release grant is for another phase";', ""),
  M("grant-any-project", "TCR-26", META_REL, 'if (grant.projectId !== requester.project) return "the committed credential-release grant is for another project";', ""),
  M("grant-any-reference", "TCR-26", META_REL, 'if (!grant.references.includes(ref.reference)) return "the committed credential-release grant does not name this exact reference";', ""),
  M("grant-any-action", "TCR-26", META_REL, 'if (grant.action !== permit.action) return "the committed credential-release grant is for another action";', ""),
  M("grant-any-date-text", "TCR-26", META_REL, " || new Date(expiresAtMs).toISOString() !== grant.expiresAt) return", ") return"),
  M("shape-not-asked", "TCR-26", META_REL, "    const malformed = grantShapeProblem(grant);\n    if (malformed !== null) return malformed;\n", ""),
  M("grant-never-expires", "TCR-26", META_REL, 'if (Date.parse(grant.expiresAt) <= nowMs()) return "the committed credential-release grant has expired";', ""),
  M("phase-names-any-path", "TCR-26", META_REL, 'if (typeof phaseId !== "string" || !PHASE_ID_RE.test(phaseId)) return', 'if (typeof phaseId !== "string") return'),
  // TCR-7
  M("tenant-class-not-compared", "TCR-7", VAULT_REL, 'return ref.tenantId === requester.tenant ? null : { code: "TENANT_MISMATCH", reason: "cross-tenant-refused" };', "return null;"),
  M("project-check-gone", "TCR-7", VAULT_REL, 'if (!belongsToProject(ref, requester.project)) return { code: "CROSS_PROJECT_REFUSED", reason: "cross-project-refused" };', ""),
  M("tenant-rule-reduced-to-the-project-check", "TCR-7", VAULT_REL, 'return entry.tenant === requester.tenant ? null : { code: "TENANT_MISMATCH", reason: "cross-tenant-refused" };', "return null;"),
  M("tenant-rule-asks-the-requester-of-itself", "TCR-7", VAULT_REL, "const entry = state.entries.get(ref.project);", "const entry = state.entries.get(requester.project);"),
  // TCR-8
  M("reserved-prefix-case-sensitive", "TCR-8", REF_REL, "asciiLower(projectId).startsWith(TENANT_PREFIX)", "projectId.startsWith(TENANT_PREFIX)"),
  M("fold-any-unicode", "TCR-8", REF_REL, "return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));", "return text.toLowerCase();"),
  M("tenant-segment-keeps-its-case", "TCR-8", REF_REL, "isReservedProjectId(project) ? asciiLower(project).slice(TENANT_PREFIX.length) : null", "isReservedProjectId(project) ? project.slice(TENANT_PREFIX.length) : null"),
  M("malformed-tenant-segment-accepted", "TCR-8", REF_REL, 'if (tenantId !== null && !isTenantId(tenantId)) return { ok: false, reason: "reference-invalid-tenant-segment" };', ""),
  M("platform-match-is-exact", "TCR-8", REF_REL, 'credentialClass: PLATFORM_SET.has(asciiLower(text)) ? "platform"', 'credentialClass: PLATFORM_REFERENCES.includes(text) ? "platform"'),
  M("tenant-class-reads-as-project", "TCR-8", REF_REL, 'tenantId !== null ? "tenant" : "project",', '"project",'),
  M("platform-list-emptied", "TCR-8", REF_REL, 'const PLATFORM_REFERENCES = Object.freeze(["ProjectOS/projectos/development/openai/gatekeeper-api-key"]);', "const PLATFORM_REFERENCES = Object.freeze([]);"),
  M("reserved-prefix-renamed", "TCR-8", REF_REL, 'const TENANT_PREFIX = "tenant.";', 'const TENANT_PREFIX = "tenant:";'),
  M("platform-set-not-folded", "TCR-8", REF_REL, "const PLATFORM_SET = new Set(PLATFORM_REFERENCES.map(asciiLower));", "const PLATFORM_SET = new Set(PLATFORM_REFERENCES);"),
  // TCR-9
  M("platform-reaches-an-operation", "TCR-9", VAULT_REL, '    if (ref.credentialClass === "platform") {\n      refuseRelease(ref, requester, "authorise-operation", "platform-credential-released-to-none", "PLATFORM_RELEASED_TO_NONE");\n      throw refusal("PLATFORM_RELEASED_TO_NONE", "credential-vault: a platform credential is released to nobody; it serves every tenant through the broker");\n    }\n', ""),
  M("platform-reaches-a-session", "TCR-9", VAULT_REL, 'if (ref.credentialClass === "platform") return { code: "PLATFORM_RELEASED_TO_NONE", reason: "platform-credential-released-to-none", message: "credential-vault: a platform credential is released to nobody; it serves every tenant through the broker" };', ""),
  M("run-overwrites-the-platform-key", "TCR-9", VAULT_REL, "      if (!atConsole(requester)) {\n        log({ action, ...refFields(ref), ...requesterFields(requester), ok: false, reason: \"platform-credential-console-only\" });", "      if (false) {\n        log({ action, ...refFields(ref), ...requesterFields(requester), ok: false, reason: \"platform-credential-console-only\" });"),
  M("console-authority-reads-the-label", "TCR-9", VAULT_REL, "return state !== null && state.atConsole === true;", 'return state !== null && requester.via === "console";'),
  // TCR-10
  M("tenant-class-auto-loaded", "TCR-10", VAULT_REL, 'if (ref.credentialClass === "tenant") return { code: "TENANT_CLASS_NOT_SESSION", reason: "tenant-class-not-session-released", message: "credential-vault: a tenant-class credential is never loaded into a session" };', ""),
  M("worktree-alone-releases", "TCR-10", VAULT_REL, 'if (requester.via === "linked-worktree") return { code: "LINKED_WORKTREE_ALONE", reason: "linked-worktree-alone-releases-nothing", message: "credential-vault: a linked worktree\'s binding alone releases nothing, and session auto-load has no owner step" };', ""),
  M("operation-class-auto-loaded", "TCR-10", VAULT_REL, 'if (ref.risk !== "session") return { code: "OPERATION_CLASS", reason: "operation-class-credential", message: "credential-vault: this credential is operation-class and cannot be loaded into a session" };', ""),
  M("session-skips-the-boundary", "TCR-10", VAULT_REL, "    const refused = boundaryRefusal(ref, requester, state);\n    if (refused !== null) return { ...refused, message: BOUNDARY_MESSAGE[refused.code] };", "    const refused = null;\n    if (refused !== null) return { ...refused, message: BOUNDARY_MESSAGE[refused.code] };"),
  M("session-release-unasked", "TCR-10", VAULT_REL, '    const refused = sessionRefusal(ref, requester, state);\n    if (refused !== null) {\n      refuseRelease(ref, requester, "authorise-session", refused.reason, refused.code);', '    const refused = null;\n    if (refused !== null) {\n      refuseRelease(ref, requester, "authorise-session", refused.reason, refused.code);'),
  // TCR-11
  M("provision-skips-the-reach-rule", "TCR-11", VAULT_REL, '    requireConsoleForReach(input, ref, "provision");\n', ""),
  M("rotate-skips-the-reach-rule", "TCR-11", VAULT_REL, '    requireConsoleForReach(input, ref, "rotate-metadata");\n', ""),
  M("reach-any-word", "TCR-11", META_REL, 'if (!REACHES.includes(record.reach)) throw new Error("credential-metadata: reach must be one of " + REACHES.join(", "));', ""),
  M("account-names-no-tenants", "TCR-11", META_REL, '!Array.isArray(tenants) || tenants.length === 0 || !tenants.every(isTenantId)', "false"),
  M("run-declares-its-own-reach", "TCR-11", VAULT_REL, "if (!atConsole(input.requester)) {", "if (false) {"),
  M("undeclared-reach-passes", "TCR-11", VAULT_REL, 'if (!REACHES.includes(declared)) return { code: "REACH_UNDECLARED", reason: "reach-undeclared", message: "credential-vault: this credential declares no reach, so it is not released" };', ""),
  M("expired-passes", "TCR-11", VAULT_REL, 'if (record && metadata.isExpired(record, new Date(nowMs()).toISOString())) return { code: "CREDENTIAL_EXPIRED", reason: "credential-expired", message: "credential-vault: this credential has passed its recorded expiry" };', ""),
  M("auto-load-takes-any-reach", "TCR-11", VAULT_REL, 'return declared === "project" && !accountWide ? null : { code: "REACH_WIDER_THAN_PROJECT", reason: "reach-wider-than-project", message: "credential-vault: this credential reaches beyond its project, so it is not projected into a session" };', "return null;"),
  M("account-reach-any-tenant", "TCR-11", VAULT_REL, " || tenants.some((tenant) => tenant !== requester.tenant)", ""),
  M("declared-project-believed", "TCR-11", VAULT_REL, 'const accountWide = isAccountWide(ref.credential) || declared === "account";', 'const accountWide = declared === "account";'),
  M("name-pattern-not-asked", "TCR-11", REF_REL, " || ACCOUNT_WIDE_NAME_RE.test(credentialName)", ""),
  M("session-not-asked-fitness", "TCR-11", VAULT_REL, 'const unfit = fitnessRefusal(ref, requester, "session");', "const unfit = null;"),
  M("operation-not-asked-fitness", "TCR-11", VAULT_REL, 'const unfit = fitnessRefusal(ref, requester, "operation");', "const unfit = null;"),
  M("pat-reads-as-project-reach", "TCR-11", REF_REL, 'const ACCOUNT_WIDE_CREDENTIALS = Object.freeze(["supabase-access-token"]);', "const ACCOUNT_WIDE_CREDENTIALS = Object.freeze([]);"),
  M("profile-offers-the-pat", "TCR-11", PROFILES_REL, 'credentials: ["gh-token", "vercel-token"],', 'credentials: ["gh-token", "supabase-access-token", "vercel-token"],'),
  M("reach-inherited-on-replace", "TCR-11", META_REL, "...statedReach(record),\n    };\n    writeAll(all);", 'reach: typeof record.reach === "string" ? record.reach : previous ? previous.reach : null,\n      reachTenants: typeof record.reach === "string" ? record.reachTenants || null : previous ? previous.reachTenants : null,\n    };\n    writeAll(all);'),
  // TCR-12
  M("provision-unbound", "TCR-12", VAULT_REL, 'const ref = requireMutator(input, "provision");', 'const ref = requireRef((input || {}).reference, "provision");'),
  M("remove-unbound", "TCR-12", VAULT_REL, 'const ref = requireMutator(input, "delete");', 'const ref = requireRef((input || {}).reference, "delete");'),
  M("present-unbound", "TCR-12", VAULT_REL, 'const ref = requireMutator(input, "present");', 'const ref = requireRef((input || {}).reference, "present");'),
  M("rotate-unbound", "TCR-12", VAULT_REL, 'const ref = requireMutator(input, "rotate-metadata");', 'const ref = requireRef((input || {}).reference, "rotate-metadata");'),
  M("mutators-skip-the-boundary", "TCR-12", VAULT_REL, "    const refused = boundaryRefusal(ref, requester, state);\n    if (refused !== null) {\n      log({ action, ...refFields(ref), ...requesterFields(requester), ok: false, reason: refused.reason });", "    const refused = null;\n    if (refused !== null) {\n      log({ action, ...refFields(ref), ...requesterFields(requester), ok: false, reason: refused.reason });"),
  // TCR-13
  M("unwritten-audit-reads-as-written", "TCR-13", VAULT_REL, 'throw refusal("AUDIT_NOT_RECORDED", "the vault audit line could not be written, so this operation did not happen");', "return;"),
  M("audit-not-redacted", "TCR-13", VAULT_REL, 'fs.appendFileSync(auditPath, redactor.redactText(JSON.stringify(entry)) + "\\n"', 'fs.appendFileSync(auditPath, JSON.stringify(entry) + "\\n"'),
  M("audit-never-rotates", "TCR-13", VAULT_REL, "fs.statSync(auditPath).size >= AUDIT_ROTATE_BYTES", "false"),
  M("audit-stays-in-memory", "TCR-13", VAULT_REL, "    writeAuditLine({ ...entry, at: new Date(nowMs()).toISOString() });\n", ""),
  M("audit-file-renamed", "TCR-13", VAULT_REL, 'const AUDIT_FILE_NAME = "credential-audit.jsonl";', 'const AUDIT_FILE_NAME = "audit.log";'),
  M("delete-before-its-line", "TCR-13", VAULT_REL, '    log({ action: "delete-intent", ...refFields(ref), ...requesterFields(input.requester), ok: true });\n    const deleted = store.del(ref.reference);', '    const deleted = store.del(ref.reference);\n    log({ action: "delete-intent", ...refFields(ref), ...requesterFields(input.requester), ok: true });'),
  M("audit-loses-the-session", "TCR-13", VAULT_REL, "      sessionId: event.sessionId || null,\n", ""),
  M("audit-loses-the-command", "TCR-13", VAULT_REL, "      command: event.command || null,\n", ""),
  M("audit-loses-the-exit", "TCR-13", VAULT_REL, "      exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,\n", ""),
  M("audit-loses-the-old-reach", "TCR-13", VAULT_REL, "      reachBefore: event.reachBefore || null,\n", ""),
  M("audit-loses-the-new-reach", "TCR-13", VAULT_REL, "      reachAfter: event.reachAfter || null,\n", ""),
  M("rotate-hides-the-reach-change", "TCR-13", VAULT_REL, 'fingerprint: record.fingerprint, reachBefore, reachAfter: record.reach, ok: true });\n    return record;', "fingerprint: record.fingerprint, ok: true });\n    return record;"),
  M("command-not-on-the-record", "TCR-13", GATE_REL, '      vault.auditOperation({ ...audited, action: "operation-start", command: executable, args: args.map((a) => (matchedShapes(a).length ? "[credential-shaped]" : a)), ok: true });\n', ""),
  M("failed-audit-still-starts", "TCR-13", GATE_REL, 'return refuse("AUDIT_NOT_RECORDED", base);', ""),
  M("exit-not-on-the-record", "TCR-13", GATE_REL, 'vault.auditOperation({ ...audited, action: "operation-end", exitCode, ok: exitCode === 0, reason: result && result.error ? "spawn-failed" : exitCode === 0 ? null : "non-zero-exit" });', ""),
  M("failed-end-line-unsaid", "TCR-13", GATE_REL, 'return { ok: false, blocker: "AUDIT_NOT_RECORDED", exitCode, stdout: "", stderr: "", outputWithheld: true };', ""),
  M("argument-not-masked", "TCR-13", GATE_REL, 'args.map((a) => (matchedShapes(a).length ? "[credential-shaped]" : a))', "args"),
  M("store-changes-before-its-line", "TCR-13", VAULT_REL, '    log({ action: "provision-intent", ...refFields(ref), ...requesterFields(input.requester), ok: true });\n    const reachBefore = declaredReach(ref);\n    store.set(ref.reference, value);', '    const reachBefore = declaredReach(ref);\n    store.set(ref.reference, value);\n    log({ action: "provision-intent", ...refFields(ref), ...requesterFields(input.requester), ok: true });'),
  // TCR-14
  M("unrecorded-release-proceeds", "TCR-14", VAULT_REL, 'throw refusal("ENVELOPE_NOT_RECORDED", "credential-vault: the release could not be recorded, so it did not happen. " + RECORD_LOCK_HINT);', ""),
  M("operation-release-unrecorded", "TCR-14", VAULT_REL, '    recordReleaseAdmission(ref, requester, state, "operation:" + String(permitId), "credential-release:" + permit.phaseId);\n', ""),
  M("session-release-unrecorded", "TCR-14", VAULT_REL, '    recordReleaseAdmission(ref, requester, state, "session:" + String(id), "session-auto-load");\n', ""),
  M("grant-before-the-line", "TCR-14", VAULT_REL, '    recordReleaseAdmission(ref, requester, state, "session:" + String(id), "session-auto-load");\n    const grant = mintGrant(ref, "session", { sessionId: id });', '    const grant = mintGrant(ref, "session", { sessionId: id });\n    recordReleaseAdmission(ref, requester, state, "session:" + String(id), "session-auto-load");'),
  M("unrecorded-refusal-reads-as-recorded", "TCR-14", VAULT_REL, 'throw refusal("REFUSAL_NOT_RECORDED", "credential-vault: this refusal has no envelope line, and the operation is stopped. " + RECORD_LOCK_HINT);', ""),
  M("unparsed-text-reaches-the-audit", "TCR-13", VAULT_REL, '      log({ action, ok: false, reason: parsed.reason });', '      log({ action, reference: String(reference), ok: false, reason: parsed.reason });'),
  M("release-class-stated-here", "TCR-14", META_REL, '    const action = actionEntry("credential-release");\n', '    const action = { class: "P1", environment: "local" };\n'),
  M("release-loses-its-run", "TCR-14", META_REL, 'scope: ["run:" + requester.runHandle],', "scope: [],"),
  M("release-not-run-linked", "TCR-14", META_REL, "via: requester.via, runLinked: true, reasons, grantSource", "via: requester.via, runLinked: false, reasons, grantSource"),
  M("record-takes-no-lock", "TCR-14", META_REL, "if (!takeRecordLock(lock)) return false;", ""),
  M("record-not-read-back", "TCR-14", META_REL, 'return fs.readFileSync(file, "utf8").endsWith(line);', "return true;"),
  M("lock-not-exclusive", "TCR-14", META_REL, 'try { fs.writeFileSync(lock, "{}\\n", { flag: "wx" }); return true; }', 'try { fs.writeFileSync(lock, "{}\\n"); return true; }'),
  M("lock-wait-unbounded", "TCR-14", META_REL, "for (let step = 0; step < RECORD_LOCK_WAIT_STEPS; step += 1) {", "for (let step = 0; ; step += 1) {"),
  M("idempotency-omits-the-tenant", "TCR-14", META_REL, "JSON.stringify([intent.tenant, intent.project, intent.action, intent.subjectHash, intent.intentScope])", "JSON.stringify([intent.project, intent.action, intent.subjectHash, intent.intentScope])"),
  M("idempotency-domain-drifts", "TCR-14", META_REL, 'const IDEMPOTENCY_DOMAIN = "projectos-envelope-idempotency-v2:";', 'const IDEMPOTENCY_DOMAIN = "projectos-credential-idempotency:";'),
  // TCR-15
  M("reserved-connection-allowed", "TCR-15", ROUTER_REL, "if (isReservedProjectId(connection.projectId)) {", "if (false) {"),
  M("session-requester-unasked", "TCR-15", ROUTER_REL, "const notThisRequester = vault.requesterRefusalFor(req.requester, connection.projectId);", "const notThisRequester = null;"),
  M("session-refusal-ignored", "TCR-15", ROUTER_REL, "if (notThisRequester !== null) {", "if (false) {"),
  M("credentials-unasked-before-the-lease", "TCR-15", ROUTER_REL, "credential.present ? vault.sessionReleaseRefusal({ reference: credential.reference, requester: req.requester }) : null", "null"),
  M("router-passes-the-project-id", "TCR-15", ROUTER_REL, "requester: prepared.requester, sessionId: prepared.sessionId", "projectId: prepared.projectId, sessionId: prepared.sessionId"),
  M("record-loses-the-tenant", "TCR-15", ROUTER_REL, "      tenant: prepared.requester.tenant,\n", ""),
  M("requester-check-ignores-the-project", "TCR-15", VAULT_REL, 'if (requester.project !== projectId) return "CROSS_PROJECT_REFUSED";', ""),
  M("requester-check-ignores-the-tenant", "TCR-15", VAULT_REL, 'return entry.tenant === requester.tenant ? null : "TENANT_MISMATCH";', "return null;"),
  // TCR-16
  M("run-handle-only-if-a-string", "TCR-16", CLI_REL, "if (flags.run !== undefined) return authority.fromRun(flags.run);", 'if (typeof flags.run === "string") return authority.fromRun(flags.run);'),
  M("console-run-trusts-the-reference", "TCR-16", CLI_REL, "return authority.issueConsoleRun({ projectId: flags.project });", 'return authority.issueConsoleRun({ projectId: parseReference(flags.ref).ref.project });'),
  M("one-tty-is-enough", "TCR-16", CLI_REL, "return terminal.stdin.isTTY === true && terminal.stdout.isTTY === true;", "return terminal.stdin.isTTY === true;"),
  M("no-terminal-needed", "TCR-16", CLI_REL, "if (!atRealTerminal(deps)) {", "if (false) {"),
  M("phase-optional-at-the-cli", "TCR-16", CLI_REL, '  if (typeof flags.phase !== "string" || !flags.phase) throw new Error("--phase is required and names the phase whose committed credential-release grant covers this");\n', ""),
  M("set-unbound-at-the-cli", "TCR-16", CLI_REL, "    const requester = requesterFor(flags, deps);\n    await confirmSensitive(ref, flags, deps);\n    const fromEnv", "    const requester = null;\n    await confirmSensitive(ref, flags, deps);\n    const fromEnv"),
  M("delete-unbound-at-the-cli", "TCR-16", CLI_REL, "const removed = vault.remove({ reference: ref.reference, requester });", "const removed = vault.remove({ reference: ref.reference, requester: null });"),
  M("session-unbound-at-the-cli", "TCR-16", CLI_REL, "      requester: requesterFor(flags, deps),\n      slot: flags.slot,", "      requester: null,\n      slot: flags.slot,"),
  M("operation-unbound-at-the-cli", "TCR-16", CLI_REL, "  const requester = requesterFor(flags, deps);\n\n  const productionFrozen", "  const requester = null;\n\n  const productionFrozen"),
  M("console-run-for-any-project", "TCR-16", META_REL, "    const entry = registry.entries.get(projectId);\n    if (entry === undefined) throw refusal(\"TENANT_UNKNOWN\", \"project '\" + String(projectId) + \"' is not in the tenant registry\");\n    const action = actionEntry(\"run-start\");", "    const entry = [...registry.entries.values()][0];\n    const action = actionEntry(\"run-start\");"),
  M("console-run-bypasses-the-one-route", "TCR-16", META_REL, "    return bindRun(envelopeId, true);\n", "    return Object.freeze({ runHandle: envelopeId, tenant: entry.tenant, project: entry.projectId });\n"),
  M("console-run-claims-a-checkout", "TCR-16", META_REL, 'envelope, registered: true, via: "console", runLinked: false, reasons: [] });', 'envelope, registered: true, via: "governed-root", runLinked: false, reasons: [] });'),
  // TCR-17
  M("broker-reads-through-replace-refs", "TCR-17", BROKER_REL, 'spawnSync(exe, ["--no-replace-objects", "-C", root, ...args]', 'spawnSync(exe, ["-C", root, ...args]'),
  M("broker-accepts-a-dirty-record", "TCR-17", BROKER_REL, '  const dirty = git(root, ["diff", "--name-only", "HEAD", "--", rel]);\n  if (dirty.code !== 0 || dirty.stdout.trim()) return null;\n', ""),
  M("broker-bytes-not-hashed", "TCR-17", BROKER_REL, "return named === blob ? shown.stdout : null;", "return shown.stdout;"),
  M("broker-reads-the-working-tree", "TCR-17", BROKER_REL, "const raw = readCommitted(installRoot, TENANT_REGISTRY_REL);", 'const raw = fs.readFileSync(path.join(installRoot, TENANT_REGISTRY_REL), "utf8");'),
  M("broker-reads-a-receipt-as-a-grant", "TCR-17", BROKER_REL, "const raw = readCommitted(installRoot, TENANT_REGISTRY_REL);", 'const raw = readCommitted(installRoot, TENANT_REGISTRY_REL); fs.existsSync(path.join(TRUSTED_STATE_DIR, "tenant-registry-receipt.json"));'),
  M("broker-tenant-id-any-shape", "TCR-17", BROKER_REL, '  if (tenants.some((id) => typeof id !== "string" || !/^[a-z][a-z0-9-]{1,56}$/.test(id))) {\n    return "TENANT_REGISTRY_INVALID: a tenant line has no valid tenantId";\n  }\n', ""),
  M("broker-domain-any-word", "TCR-17", BROKER_REL, '    if (["develop", "business", "personal", "phone"].indexOf(entry.domain) === -1) return "TENANT_REGISTRY_INVALID: a project line names an unknown domain";\n', ""),
  M("broker-not-judged-whole", "TCR-17", BROKER_REL, "const wrong = tenantRegistryProblem(registry);", "const wrong = null;"),
  M("broker-unlisted-passes", "TCR-17", BROKER_REL, `if (entry === undefined) return { problem: "TENANT_UNKNOWN: project '" + projectId + "' is not in the tenant registry" };`, 'if (entry === undefined) return { tenant: "owner-personal" };'),
  M("broker-ignores-the-repository", "TCR-17", BROKER_REL, "if (repository === null || repository.toLowerCase() !== entry.repository.toLowerCase()) {", "if (repository === null) {"),
  M("broker-ignores-the-root", "TCR-17", BROKER_REL, "if (!sameRealPath(entry.governedRoot, governedRoot)) {", "if (false) {"),
  M("broker-wildcard-matches-nothing", "TCR-17", BROKER_REL, 'if (fields.some((field) => /[*?]/.test(field))) return "TENANT_REGISTRY_WILDCARD: a project line has a wildcard";', ""),
  M("broker-reserved-id-allowed", "TCR-17", BROKER_REL, 'if (key(entry.projectId).startsWith("tenant.")) return "TENANT_REGISTRY_RESERVED_ID: a project id starts with the reserved tenant prefix";', ""),
  M("broker-duplicates-ignored", "TCR-17", BROKER_REL, 'if (repeated("project", entry.projectId) || repeated("repository", entry.repository) || repeated("root", root)) {', "if (false) {"),
  M("broker-nested-roots-allowed", "TCR-17", BROKER_REL, `return "TENANT_REGISTRY_NESTED_ROOT: one project's root is inside another's";`, "return null;"),
  M("broker-undeclared-tenant-allowed", "TCR-17", BROKER_REL, 'if (tenants.indexOf(entry.tenant) === -1) return "TENANT_REGISTRY_INVALID: a project line names a tenant the registry does not declare";', ""),
  M("broker-row-loses-the-tenant", "TCR-17", BROKER_REL, "      tenant: tenant,\n", ""),
  M("broker-skips-the-tenant", "TCR-17", BROKER_REL, "const bound = tenantOfProject(installRoot, governedRoot, projectId);", 'const bound = { tenant: "owner-personal" };'),
  M("broker-problem-ignored", "TCR-17", BROKER_REL, "if (bound.problem !== undefined) return bound.problem;", ""),
  M("broker-tenant-from-the-request", "TCR-17", BROKER_REL, "    boundTenant = bound.tenant;\n", "    boundTenant = String(req.tenant || bound.tenant);\n"),
  M("broker-spends-before-the-tenant", "TCR-17", BROKER_REL, "const overspend = reserveSpend(projectId, spendKey, requestId, spendLimit, boundTenant);", 'const overspend = reserveSpend(projectId, spendKey, requestId, spendLimit, "owner-personal");'),
  M("broker-holds-another-credential", "TCR-17", BROKER_REL, '  OPENAI_GATEKEEPER_KEY: "ProjectOS/projectos/development/openai/gatekeeper-api-key",\n', '  OPENAI_GATEKEEPER_KEY: "ProjectOS/projectos/development/openai/gatekeeper-api-key",\n  TENANT_KEY: "ProjectOS/tenant.agency-business/staging/x/y",\n'),
  // TCR-27
  M("worktree-is-an-installation", "TCR-27", META_REL, 'const asked = ["--git-dir", "--git-common-dir"].map((flag) => git(installRoot, ["rev-parse", flag]));', 'const asked = ["--git-dir", "--git-dir"].map((flag) => git(installRoot, ["rev-parse", flag]));'),
  M("git-dir-compared-with-nothing", "TCR-27", META_REL, 'dirs[0] !== dirs[1] || dirs[0] !== pathKey(path.join(installRoot, ".git"))', "false"),
  M("pointer-to-another-repository-passes", "TCR-27", META_REL, ' || dirs[0] !== pathKey(path.join(installRoot, ".git"))', ""),
  M("refusal-loses-its-name", "TCR-27", META_REL, 'throw refusal("INSTALLATION_NOT_MAIN_CHECKOUT", "this code is not running from the main checkout of the installation, so it holds no authority. Run it from the checkout the tenant registry names");', "return;"),
  M("registry-root-not-compared", "TCR-27", META_REL, "self === undefined || pathKey(self.governedRoot) !== pathKey(installRoot)", "self === undefined"),
  M("any-project-is-the-installation", "TCR-27", META_REL, "const self = raw.projects.find((entry) => entry.projectId === INSTALLATION_PROJECT_ID);", "const self = raw.projects.find((entry) => pathKey(entry.governedRoot) === pathKey(installRoot));"),
  M("paths-compared-by-spelling", "TCR-27", META_REL, 'return process.platform === "win32" ? asciiLower(forward) : forward;', "return forward;"),
  // TCR-28
  M("commit-alone-releases", "TCR-28", META_REL, '    if (!grantReceiptConfirms(bytes.blob)) return "the committed credential-release grant (blob " + bytes.blob + ") has no receipt with its admission line. A person confirms it with: credentials grant-receipt --blob " + bytes.blob;\n', ""),
  M("grant-receipt-keyed-to-the-tenant", "TCR-28", META_REL, 'kind: GRANT_RECEIPT_KIND, blobField: "grantBlob", changes: GRANT_CHANGE_RECORDS_FILENAME, action: "credential-release"', 'kind: "tenant-registry-receipt", blobField: "registryBlob", changes: TENANT_CHANGE_RECORDS_FILENAME, action: "tenant-registry-change"'),
  M("receipt-written-in-a-repository", "TCR-28", META_REL, "path.join(stateDir, GRANT_RECEIPTS_DIRNAME, blob + \".json\")", "path.join(installRoot, GRANT_RECEIPTS_DIRNAME, blob + \".json\")"),
  M("any-typed-text-confirms", "TCR-28", META_REL, "if (typed !== blob.slice(0, GRANT_CONFIRMATION_LENGTH)) {", "if (false) {"),
  M("receipt-not-read-back", "TCR-28", META_REL, 'if (!grantReceiptConfirms(blob)) throw refusal("ENVELOPE_NOT_RECORDED", "the grant receipt did not read back, so nothing is confirmed");', ""),
  M("receipt-for-an-uncommitted-blob", "TCR-28", META_REL, "if (bytes === null || bytes.blob !== blob) throw missing();", "if (bytes === null) throw missing();"),
  M("malformed-grant-confirmed", "TCR-28", META_REL, "if (grantShapeProblem(grant) !== null) throw missing();", ""),
  M("grant-listed-from-a-working-tree", "TCR-28", META_REL, 'git(installRoot, ["ls-tree", "-r", "HEAD", "--", CREDENTIAL_GRANTS_REL])', 'git(installRoot, ["ls-files", "--stage", "--", CREDENTIAL_GRANTS_REL])'),
  M("statement-overclaims", "TCR-28", META_REL, "A grant receipt shows that a person or a process confirmed this grant blob at a console, nothing more.", "A grant receipt shows that the owner approved this grant."),
  M("statement-hides-the-direct-write", "TCR-28", META_REL, "It does not stop a process that drives a console or writes the receipt and its line directly", "It stops every process"),
  M("receipt-needs-no-terminal", "TCR-28", CLI_REL, "if (!atRealTerminal(deps)) throw new Error(noConsole);", ""),
  M("receipt-hides-the-grant", "TCR-28", CLI_REL, '  console.log("  command     " + grant.command.join(" "));\n', ""),
  M("receipt-flag-confirms", "TCR-28", CLI_REL, "authority.confirmGrant({ blob, typed });", "authority.confirmGrant({ blob, typed: blob.slice(0, 12) });"),
  // TCR-29
  M("flag-alone-confirms", "TCR-29", CLI_REL, "  await typedConfirmation(deps, expected, message);\n}", "}"),
  M("any-answer-confirms", "TCR-29", CLI_REL, "(await askTerminal('Type \"' + expected + '\" to confirm: ', deps)) !== expected", "(await askTerminal('Type \"' + expected + '\" to confirm: ', deps)) === null"),
  M("no-reader-reads-as-a-person", "TCR-29", CLI_REL, 'if (!atRealTerminal(deps) || typeof terminal.readLine !== "function") return null;', ""),
  M("reach-needs-no-typing", "TCR-29", CLI_REL, 'ref.credentialClass === "platform" || flags.reach !== undefined', 'ref.credentialClass === "platform"'),
  M("platform-needs-no-typing", "TCR-29", CLI_REL, 'ref.credentialClass === "platform" || flags.reach !== undefined', "flags.reach !== undefined"),
  M("sensitive-confirm-removed", "TCR-29", CLI_REL, 'await typedConfirmation(deps, ref.reference, "OWNER PERMIT REQUIRED — a reach or the platform key is confirmed by typing at a real terminal");', ""),
  M("input-end-hangs", "TCR-29", CLI_REL, '    input.on("end", onEnd);\n', ""),
  // TCR-30
  M("every-provider-variable-declared", "TCR-30", ROUTER_REL, 'if (permitsCredential(profile.name, entry.credential)) standIns[entry.key] = "declared";', 'standIns[entry.key] = "declared";'),
  M("declared-env-empty", "TCR-30", ROUTER_REL, "Object.assign(declaredEnv, adapter.projectEnvironment(connection, environment, standIns));", ""),
  M("any-provider-server-allowed", "TCR-30", ROUTER_REL, "const allowedServers = declaredProviders.filter((name) => profile.mcpServers.includes(name));", "const allowedServers = declaredProviders;"),
  M("profile-offers-the-supabase-server", "TCR-30", PROFILES_REL, 'mcpServers: ["github", "vercel"],', 'mcpServers: ["github", "supabase", "vercel"],'),
  // TCR-31
  M("grant-any-command", "TCR-31", META_REL, 'if (!sameCommand(grant.command, command)) return "the committed credential-release grant is for another command";', ""),
  M("command-prefix-matches", "TCR-31", META_REL, "running.length === granted.length && ", ""),
  M("executable-any-path", "TCR-31", META_REL, "pathKey(granted[0]) === pathKey(running[0]) && ", ""),
  M("arguments-not-compared", "TCR-31", META_REL, " && granted.every((item, index) => index === 0 || item === running[index])", ""),
  M("command-optional-in-a-grant", "TCR-31", META_REL, 'if (!textList(grant.command)) return "the committed credential-release grant names no command";', ""),
  M("vault-drops-the-command", "TCR-31", VAULT_REL, "const { requester, permit, command } = input || {};", "const { requester, permit } = input || {}; const command = null;"),
  M("gate-claims-another-command", "TCR-31", GATE_REL, "capability: req.capability || {}, command: [executable, ...args] });", 'capability: req.capability || {}, command: ["node", "--version"] });'),
  // TCR-24
  M("run-end-reads-as-a-success", "TCR-24", GC_REL, "exitCode === 0 ? 'allowed' : 'failed',", "'allowed',"),
  M("run-ends-twice", "TCR-24", GC_REL, "    LIVE_RUNS.delete(run);\n", ""),
  M("exit-hook-not-armed", "TCR-24", GC_REL, "  process.once('exit', endAdmittedRuns);\n", ""),
  M("run-not-held-to-its-end", "TCR-24", GC_REL, "  holdRunUntilExit({ sys, stateDir: source.stateDir, envelope: admission.envelope });\n", ""),
  M("run-has-no-budget", "TCR-24", GC_REL, "    budget: committedPhaseCap(sys, root),\n", ""),
  M("boundary-drops-the-budget", "TCR-24", GC_REL, "budget: request.budget ?? 0,", "budget: 0,"),
  M("cap-read-through-replace-refs", "TCR-24", GC_REL, "'--no-replace-objects', '-C', root, 'show',", "'-C', root, 'show',"),
  M("cap-from-another-limit", "TCR-24", GC_REL, "?.budget?.phaseHardStopAtMicroUsd", "?.budget?.hardStopAtMicroUsd"),
  M("cap-any-number", "TCR-24", GC_REL, "Number.isSafeInteger(cap) && cap > 0 ? cap : 0", "cap"),
  // TCR-25
  M("adr-hides-the-withdrawal", "TCR-25", ADR_REL, "is **withdrawn**", "stands"),
  M("adr-hides-the-format", "TCR-25", ADR_REL, "projectos/security/credential-grants/<PHASE>.credential-release.json", "a record"),
  M("adr-says-a-grant-exists", "TCR-25", ADR_REL, "None exists yet, so operation release fails closed.", "One exists."),
  M("adr-overclaims-the-boundary", "TCR-25", ADR_REL, "Only provider-side scope, expiry and revocation are real boundaries.", "The kernel's routes are a boundary."),
  M("adr-hides-the-console-label", "TCR-25", ADR_REL, "is a label. Stage 4", "is proof. Stage 4"),
  M("registry-keeps-the-open-grant", "TCR-25", AREG_REL, "a gatekeeper secrets-handling gate is not one", "a gatekeeper secrets-handling gate is one"),
  M("registry-overclaims-the-boundary", "TCR-25", AREG_REL, "only provider-side scope, expiry and revocation are real boundaries until Stage 4", "these are boundaries"),
  M("refusal-goes-unseen", "TCR-25", SET_CRED_REL, "Some(_) => Err(refusal_sentence(&String::from_utf8_lossy(&output.stderr), &value)),", 'Some(_) => Err("ProjectOS did not store that credential.".to_string()),'),
  M("stderr-discarded", "TCR-25", SET_CRED_REL, ".stderr(Stdio::piped());", ".stderr(Stdio::null());"),
  M("refusal-may-repeat-the-value", "TCR-25", SET_CRED_REL, "if !value.is_empty() && line.contains(value) {", "if false {"),
  M("refusal-unbounded", "TCR-25", SET_CRED_REL, ".take(REFUSAL_MAX_CHARS)", ".take(usize::MAX)"),
  M("vault-overclaims-the-chokepoint", "TCR-25", VAULT_REL, "so this\n * prevents accidents on the kernel's routes", "so this\n * is the boundary"),
  M("vault-overclaims-the-confirmation", "TCR-25", VAULT_REL, "so it prevents accidents and proves no one", "so ProjectOS cannot self-confirm"),
  M("gate-overclaims-the-confirmation", "TCR-25", GATE_REL, "it prevents accidents and proves no one", "ProjectOS cannot mint one for itself"),
  M("host-fixture-loses-its-line", "TCR-25", HOST_TEST_REL, '"projectos/security/tenant-registry.json",', '"projectos/security/other.json",'),
  // TCR-18
  M("jwt-reaches-the-requester", "TCR-18", META_REL, "  function fromRun(handle) {\n", '  function fromRun(handle) {\n    if (String(handle).startsWith("eyJ")) return decodeJwt(handle);\n'),
  M("oauth-reaches-the-cli", "TCR-18", CLI_REL, "function requesterFor(flags, deps) {\n", "function requesterFor(flags, deps) {\n  if (flags.oauth) return flags.oauth;\n"),
  M("supabase-session-reaches-the-vault", "TCR-18", VAULT_REL, "function liveRequester(requester) {\n", 'function liveRequester(requester) {\n    if (requester && requester.access_token) return requester;\n'),
  // TCR-19
  M("state-dir-from-the-environment", "TCR-19", META_REL, "return key(derived) === key(stated) ? derived.split(String.fromCharCode(92)).join(\"/\") : null;", "return stated.split(String.fromCharCode(92)).join(\"/\");"),
  M("state-dir-not-from-the-account", "TCR-19", META_REL, "try { home = os.userInfo().homedir; } catch (e) { return null; }", "home = process.env.USERPROFILE;"),
  M("sources-not-required", "TCR-19", META_REL, ' || !path.isAbsolute(stateDir)) {', ") {"),
  M("cli-reads-a-state-dir-flag", "TCR-19", CLI_REL, "createRequesterAuthority({ installRoot: INSTALL_ROOT, stateDir: installationStateDir() })", 'createRequesterAuthority({ installRoot: INSTALL_ROOT, stateDir: flags["state-dir"] })'),
  M("cli-reads-an-install-root-flag", "TCR-19", CLI_REL, "createRequesterAuthority({ installRoot: INSTALL_ROOT, stateDir: installationStateDir() })", 'createRequesterAuthority({ installRoot: flags["install-root"], stateDir: installationStateDir() })'),
  M("install-root-from-cwd", "TCR-19", CLI_REL, 'const INSTALL_ROOT = path.resolve(__dirname, "..", "..")', "const INSTALL_ROOT = process.cwd()"),
  // TCR-20
  M("validate-all-omits-this-validator", "TCR-20", VA_REL, `"${THIS_VALIDATOR}"`, '"val-projectos-tenant-removed"'),
  M("cached-runner-omits-this-validator", "TCR-20", CR_REL, `"${THIS_VALIDATOR}"`, '"val-projectos-tenant-removed"'),
  // TCR-21
  M("evidence-hides-whose-decision", "TCR-21", EVIDENCE_REL, "The lead's remaining decisions, for the owner to overrule", "decided"),
  M("evidence-keeps-the-withdrawn-grant", "TCR-21", EVIDENCE_REL, "The lead's first grant decision is WITHDRAWN", "The grant decision stands"),
  M("evidence-says-a-grant-exists", "TCR-21", EVIDENCE_REL, "No grant exists yet, so operation release fails closed", "A grant exists"),
  M("evidence-lets-an-agent-grant", "TCR-21", EVIDENCE_REL, "Creating one is an owner act", "Creating one is routine"),
  M("evidence-calls-the-console-proof", "TCR-21", EVIDENCE_REL, "`via: console` is a label under F7", "`via: console` proves the owner"),
  M("evidence-hides-the-block", "TCR-21", EVIDENCE_REL, "Agency `secrets-credential-hygiene-engineer`: BLOCK", "Agency reviewed it"),
  M("evidence-hides-ecc", "TCR-21", EVIDENCE_REL, "ECC SECURITY: APPROVE WITH CHANGES", "ECC SECURITY reviewed it"),
  M("evidence-hides-the-ecc-block", "TCR-21", EVIDENCE_REL, "ECC SECURITY recheck: BLOCK", "ECC SECURITY rechecked it"),
  M("evidence-hides-the-agency-recheck", "TCR-21", EVIDENCE_REL, "Agency recheck: APPROVE WITH CHANGES", "Agency rechecked it"),
  M("evidence-hides-the-main-checkout", "TCR-21", EVIDENCE_REL, "The router must run from the main checkout", "The router runs anywhere"),
  M("evidence-calls-typing-a-boundary", "TCR-21", EVIDENCE_REL, "This raises the bar and is not a boundary", "This is a boundary"),
  M("evidence-overclaims-the-grant-receipt", "TCR-21", EVIDENCE_REL, "A receipt proves a console confirmation and nothing more", "A receipt proves the owner approved"),
  M("evidence-hides-the-p5-source", "TCR-21", EVIDENCE_REL, "`credential-release` stays P5", "`credential-release` is decided"),
  M("evidence-hides-auto-load", "TCR-21", EVIDENCE_REL, "Session auto-load is kept for PROJECT-class credentials only", "Session auto-load is kept"),
  M("evidence-hides-the-platform-rule", "TCR-21", EVIDENCE_REL, "A platform credential serves every tenant through the broker and is released to none", "A platform credential is special"),
  M("evidence-calls-the-handle-a-secret", "TCR-21", EVIDENCE_REL, "the handle names a record and is not a secret", "the handle is a secret"),
  M("evidence-hides-the-one-user-limit", "TCR-21", EVIDENCE_REL, "any process of this Windows user", "a hostile process"),
  M("evidence-hides-add-credential", "TCR-21", EVIDENCE_REL, "the Control Center's Add credential is refused", "the Control Center is unchanged"),
  M("evidence-hides-the-broker-limit", "TCR-21", EVIDENCE_REL, "The broker cannot tell which run asked", "The broker checks the run"),
  M("evidence-hides-status", "TCR-21", EVIDENCE_REL, "`status` stays unbound", "`status` is fine"),
  M("evidence-hides-worker-reach", "TCR-21", EVIDENCE_REL, "A worker can still reach any tenant's secrets", "A worker cannot reach another tenant's secrets"),
  // TCR-22
  M("vault-validator-drops-an-invariant", "TCR-22", LEGACY_VAULT_REL, 'expectThrow(errors, "invariant 4", () => vault.authoriseSessionRelease({ reference: REF.polygoServiceRole, requester: polygo }), "operation-class");', ""),
  M("vault-validator-loses-its-expiry-rule", "TCR-22", LEGACY_VAULT_REL, 'expectThrow(errors, "invariant 8",', 'expectThrow(errors, "expired permit",'),
  M("adversarial-validator-drops-the-junk-pass", "TCR-22", LEGACY_ADV_REL, 'failsClosed(errors, "invariant 14 (gate.run)", () => gate.run(junk));', ""),
  M("session-validator-drops-an-invariant", "TCR-22", LEGACY_SESSION_REL, 'errors.push("invariant 21: an unregistered project was not refused', 'errors.push("an unregistered project was not refused'),
  // TCR-23
  M("adapter-js-moved", "TCR-23", STORE_JS_REL, '"use strict";', '"use strict"; '),
  M("adapter-ps-moved", "TCR-23", STORE_PS_REL, "PROJECTOS_CREDENTIAL_VALUE", "PROJECTOS_CREDENTIAL_VALUES"),
  // TCR-T
  M("a-proof-skipped", "TCR-T", "projectos/agent/test/tenantCredentials.test.ts", "  it('survives the vault that wrote it, and holds no value'", "  it.skip('survives the vault that wrote it, and holds no value'"),
  M("a-proof-isolated", "TCR-T", "projectos/agent/test/tenantCredentials.test.ts", "  it('refuses a requester outside the reference\\'s project, and runs nothing'", "  it.only('refuses a requester outside the reference\\'s project, and runs nothing'"),
  M("a-proof-deleted", "TCR-T", "projectos/agent/test/tenantCredentials.test.ts", "releases to a second project in the same tenant, and refuses across tenants", "releases to a project"),
  M("a-proof-commented-out", "TCR-T", "projectos/agent/test/tenantCredentials.test.ts", "  it('stops before the store changes when a line cannot be written'", "  // it('stops before the store changes when a line cannot be written'"),
];

const ALL_SOURCES = [...new Set([...SOURCES, EVIDENCE_REL, ADR_REL, AREG_REL, LEGACY_VAULT_REL, LEGACY_ADV_REL, LEGACY_SESSION_REL, STORE_JS_REL, STORE_PS_REL, ...Object.keys(TESTS)])];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
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

/** A function's text, to the closing brace at its own indent. Nested functions work the same way. */
function fnSpan(text, name) {
  const found = new RegExp(`(^|\\n)( *)(?:export )?(?:async )?function ${name}\\(`).exec(text);
  if (found === null) return "";
  const indent = found[2];
  const end = text.indexOf(`\n${indent}}`, found.index + found[0].length);
  return end < 0 ? text.slice(found.index) : text.slice(found.index, end + indent.length + 2);
}

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  if (start < 0) return null;
  const end = text.indexOf("\n];", start);
  return end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const prose = (text) => text.replace(/\*\*/g, "").replace(/\s+/g, " ");
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  const src = {};
  for (const rel of ALL_SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("TCR-0", `${rel} is missing`);
      return errors;
    }
    src[rel] = rel.endsWith(".md") || rel.endsWith(".json") ? raw[rel] : code(raw[rel]);
  }

  for (const [rule, rel, fn, needle] of PINS) {
    const text = fn === null ? src[rel] : fnSpan(src[rel], fn);
    if (!text.includes(needle)) E(rule, `${rel}${fn === null ? "" : ` ${fn}`} no longer holds: ${needle}`);
  }

  // TCR-2: no route to a requester reads where the process stands.
  for (const fn of ["fromRun", "bindRun", "issueConsoleRun", "readRegistry", "recordLines"]) {
    if (/process\.cwd\(/.test(fnSpan(src[META_REL], fn))) E("TCR-2", `${fn} reads the working directory, and cwd is never the requester`);
  }

  // TCR-5: the reference may not stand in for the requester anywhere on the release path.
  if (/projectId: ref\.project,? permit/.test(fnSpan(src[GATE_REL], "run"))) E("TCR-5", "run hands the reference's own project to the vault");
  if (/\bprojectId\b/.test(fnSpan(src[VAULT_REL], "authoriseOperationRelease").replace(/permit\.projectId/g, ""))) E("TCR-5", "authoriseOperationRelease reads a caller's project id");
  if (/\bprojectId\b/.test(fnSpan(src[VAULT_REL], "authoriseSessionRelease"))) E("TCR-5", "authoriseSessionRelease reads a caller's project id");

  // TCR-6: a tenant receipt grants nothing, anywhere here.
  if (/TENANT_RECEIPT_FILENAME|receiptConfirms/.test(fnSpan(src[META_REL], "operationGrantRefusal"))) E("TCR-6", "the operation grant reads a tenant receipt");

  // TCR-13: the order in the mutators: the line, then the store.
  const provision = fnSpan(src[VAULT_REL], "provision");
  if (!(provision.indexOf('action: "provision-intent"') >= 0 && provision.indexOf('action: "provision-intent"') < provision.indexOf("store.set("))) E("TCR-13", "provision changes the store before its line");
  const remove = fnSpan(src[VAULT_REL], "remove");
  if (!(remove.indexOf('action: "delete-intent"') >= 0 && remove.indexOf('action: "delete-intent"') < remove.indexOf("store.del("))) E("TCR-13", "remove changes the store before its line");

  // TCR-14: the line, then the grant.
  const session = fnSpan(src[VAULT_REL], "authoriseSessionRelease");
  if (!(session.indexOf("recordReleaseAdmission(") >= 0 && session.indexOf("recordReleaseAdmission(") < session.indexOf("mintGrant("))) E("TCR-14", "a session grant exists before its envelope line");
  const operation = fnSpan(src[VAULT_REL], "authoriseOperationRelease");
  if (!(operation.indexOf("recordReleaseAdmission(") >= 0 && operation.indexOf("recordReleaseAdmission(") < operation.indexOf("mintGrant("))) E("TCR-14", "an operation grant exists before its envelope line");

  // TCR-15: all of it before the lease.
  const prepare = fnSpan(src[ROUTER_REL], "prepare");
  const leaseAt = prepare.indexOf("leases.acquire(");
  for (const needle of ["vault.requesterRefusalFor(", "vault.sessionReleaseRefusal("]) {
    if (!(prepare.indexOf(needle) >= 0 && prepare.indexOf(needle) < leaseAt)) E("TCR-15", `${needle} is not asked before the lease`);
  }

  // TCR-16: nothing on the requester path reads a tenant from a flag or the environment.
  if (/flags\.tenant|flags\["tenant"\]|process\.env\.[A-Z_]*TENANT/.test(src[CLI_REL] + src[META_REL])) E("TCR-16", "a tenant is read from a flag or the environment");

  // TCR-17: the broker's tenant comes from no request field, and its registry from no receipt.
  if (/req\.tenant|req\.requesterTenant/.test(src[BROKER_REL])) E("TCR-17", "the broker reads a tenant from the request");
  if (/tenant-registry-receipt/.test(src[BROKER_REL])) E("TCR-17", "the broker reads a receipt, which grants nothing");
  const reference = [...src[BROKER_REL].matchAll(/ProjectOS\/[^"]+/g)].map((m) => m[0]);
  if (new Set(reference).size !== 1) E("TCR-17", "the broker holds a credential beyond the platform key");

  // TCR-18: no login on this path.
  for (const rel of [META_REL, VAULT_REL, GATE_REL, CLI_REL]) {
    if (/\bjwt\b|decodeJwt|oauth|access_token|getSession|getUser\b/i.test(src[rel])) E("TCR-18", `${rel} names a login: no JWT or OAuth requester`);
  }

  // TCR-19: one spelling of where the kernel keeps its records.
  if (/flags\[\s*["'](?:state-dir|install-root)["']\s*\]/.test(src[CLI_REL])) E("TCR-19", "the CLI reads a caller-supplied state directory or installation");

  // TCR-20: registered in both runners.
  for (const rel of [VA_REL, CR_REL]) {
    if (!(modulesOf(raw[rel]) || []).includes(THIS_VALIDATOR)) E("TCR-20", `${rel} does not run ${THIS_VALIDATOR}`);
  }

  // TCR-21: what the evidence must say.
  const evidence = prose(src[EVIDENCE_REL]);
  for (const needle of EVIDENCE_NEEDLES) if (!evidence.includes(needle)) E("TCR-21", `the evidence no longer says: ${needle}`);

  // TCR-22: the older validators keep every rule they had.
  for (const [rel, needles] of Object.entries(LEGACY_INVARIANTS)) {
    for (const needle of needles) if (!src[rel].includes(needle)) E("TCR-22", `${rel} no longer holds '${needle}'`);
  }

  // TCR-23: the protected adapter is untouched.
  for (const [rel, hash] of Object.entries(STORE_HASHES)) if (sha256(raw[rel]) !== hash) E("TCR-23", `${rel} changed, and this phase may not change it`);

  // TCR-25: what the owner reads says what is true.
  const adr = prose(raw[ADR_REL]);
  for (const needle of ADR_NEEDLES) if (!adr.includes(needle)) E("TCR-25", `ADR-T1 no longer says: ${needle}`);
  for (const needle of ["a gatekeeper secrets-handling gate is not one", "only provider-side scope, expiry and revocation are real boundaries until Stage 4"]) {
    if (!raw[AREG_REL].includes(needle)) E("TCR-25", `the action registry no longer says: ${needle}`);
  }
  for (const [rel, needle] of [[VAULT_REL, "prevents accidents on the kernel's routes"], [VAULT_REL, "so it prevents accidents and proves no one"], [GATE_REL, "it prevents accidents and proves no one"]]) {
    if (!prose(raw[rel].replace(/\n *\* ?/g, " ")).includes(needle)) E("TCR-25", `${rel} overclaims again: ${needle}`);
  }
  for (const needle of ["Some(_) => Err(refusal_sentence(&String::from_utf8_lossy(&output.stderr), &value)),", ".stderr(Stdio::piped());", "if !value.is_empty() && line.contains(value) {", ".take(REFUSAL_MAX_CHARS)"]) {
    if (!raw[SET_CRED_REL].includes(needle)) E("TCR-25", `set_credential.rs no longer holds: ${needle}`);
  }
  if (!raw[HOST_TEST_REL].includes('"projectos/security/tenant-registry.json",')) E("TCR-25", "the host's real-broker fixture has no tenant registry");

  // TCR-T: every proof exists, and every proof runs.
  for (const [rel, needles] of Object.entries(TESTS)) {
    for (const n of needles) if (!src[rel].includes(n)) E("TCR-T", `${rel} no longer proves "${n}"`);
    if (NOT_RUN.test(src[rel])) E("TCR-T", `${rel} skips or isolates a test: ${NOT_RUN.exec(src[rel])[0]}`);
  }
  return errors;
}

/** Every named mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`TCR-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, () => m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`TCR-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("TCR-M: two mutations share a name");
  const rules = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of [...Array.from({ length: 31 }, (_, i) => `TCR-${i + 1}`), "TCR-T"]) {
    if (!rules.has(rule)) errors.push(`TCR-M: rule ${rule} has no named mutation`);
  }
  return errors;
}

const GIT_ENV = { GIT_AUTHOR_NAME: "Synthetic", GIT_AUTHOR_EMAIL: "synthetic@example.invalid", GIT_COMMITTER_NAME: "Synthetic", GIT_COMMITTER_EMAIL: "synthetic@example.invalid" };
const gitIn = (root, ...args) => execFileSync("git", ["-C", root, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: "pipe", env: { ...process.env, ...GIT_ENV } });

/**
 * A real git installation with a synthetic registry and receipt, under `dir`. `agencyProjects` go in the second
 * tenant. Nothing here is a real name, and no real store or state directory is touched.
 */
function syntheticWorld(dir, projectIds, agencyProjects = []) {
  const { createRequesterAuthority } = require("../credentials/credential-metadata.cjs");
  const forward = (p) => p.split(String.fromCharCode(92)).join("/");
  const real = (p) => forward(fs.realpathSync.native(p));
  fs.mkdirSync(dir, { recursive: true });
  const base = real(dir);
  const repo = (name) => {
    const root = `${base}/${name}`;
    fs.mkdirSync(root, { recursive: true });
    gitIn(root, "init", "--quiet");
    return root;
  };
  const installRoot = repo("installation");
  const roots = new Map();
  const line = (projectId, tenant) => {
    const root = repo(`project-${projectId}`);
    roots.set(projectId, root);
    gitIn(root, "commit", "--quiet", "--allow-empty", "-m", "fixture");
    return { projectId, repository: `github.com/synthetic/${projectId}`, governedRoot: root, tenant, domain: "develop" };
  };
  const registry = {
    schemaVersion: "1.0.0",
    policy: "tenant-registry",
    tenants: [{ tenantId: "owner-personal", name: "Synthetic owner" }, { tenantId: "agency-business", name: "Synthetic agency" }],
    // THE INSTALLATION IS `projectos`, or it holds no authority.
    projects: [
      { projectId: "projectos", repository: "github.com/synthetic/projectos", governedRoot: installRoot, tenant: "owner-personal", domain: "develop" },
      ...projectIds.filter((id) => id !== "projectos").map((id) => line(id, "owner-personal")),
      ...agencyProjects.map((id) => line(id, "agency-business")),
    ],
  };
  const stateDir = `${base}/state`;
  fs.mkdirSync(`${installRoot}/projectos/security`, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(`${installRoot}/projectos/security/tenant-registry.json`, JSON.stringify(registry, null, 2));
  fs.copyFileSync(path.join(ROOT, "projectos/security/action-registry.json"), `${installRoot}/projectos/security/action-registry.json`);
  gitIn(installRoot, "add", "--all");
  gitIn(installRoot, "commit", "--quiet", "-m", "synthetic installation");
  const blob = gitIn(installRoot, "rev-parse", "HEAD:projectos/security/tenant-registry.json").trim();
  const envelopeId = `ENV-${blob.slice(0, 24)}`;
  fs.writeFileSync(`${stateDir}/tenant-registry-receipt.json`, JSON.stringify({ kind: "tenant-registry-receipt", confirmation: "typed-terminal", registryBlob: blob, envelopeId }));
  fs.writeFileSync(`${stateDir}/tenant-registry-changes.jsonl`, `${JSON.stringify({ stage: "admission", outcome: "allowed", envelope: { envelopeId, action: "tenant-registry-change", subjectHash: blob } })}\n`);
  const authority = createRequesterAuthority({ installRoot, stateDir });
  const requesters = new Map();
  return {
    authority,
    stateDir,
    /** One console run per project: the same route the router uses, so it is a real requester. */
    requesterFor(projectId) {
      if (!requesters.has(projectId)) requesters.set(projectId, authority.issueConsoleRun({ projectId }));
      return requesters.get(projectId);
    },
    /** Commit a synthetic credential-release grant here, and confirm it unless told not to. Never a real one. */
    grant(projectId, phaseId, references, action, command, options = {}) {
      const grants = `${installRoot}/projectos/security/credential-grants`;
      fs.mkdirSync(grants, { recursive: true });
      const file = `${grants}/${phaseId}.credential-release.json`;
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: "1.0.0", kind: "credential-release-grant", phaseId, projectId, references, action, command, expiresAt: "2099-01-01T00:00:00.000Z", grantedBy: "Synthetic" }));
      gitIn(installRoot, "add", "--all");
      gitIn(installRoot, "commit", "--quiet", "-m", "synthetic grant");
      const blob = gitIn(installRoot, "rev-parse", `HEAD:projectos/security/credential-grants/${phaseId}.credential-release.json`).trim();
      if (options.confirmed !== false) authority.confirmGrant({ blob, typed: blob.slice(0, 12) });
    },
  };
}

/** The plan's criteria, run. Only in-memory stores and synthetic values. */
function behaviour() {
  const scratch = require("./lib/scratch.cjs");
  const { createCredentialVault } = require("../credentials/vault.cjs");
  const { createOperationGate } = require("../credentials/operation-gate.cjs");
  const { createMemoryCredentialStore } = require("../credentials/memory-credential-store.cjs");
  const errors = [];
  const fail = (message) => errors.push(`TCR-B: ${message}`);
  const VALUE = "synthetic-credential-value-1111";
  const PHASE = "TENANT-CREDENTIALS-FIXTURE1A";
  const codeOf = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return e.code || String(e.message);
    }
  };
  scratch.withScratch("tenant-credentials", (dir) => {
    const world = syntheticWorld(path.join(dir, "world"), ["alpha", "beta", "projectos"], ["gamma"]);
    const store = createMemoryCredentialStore({ acknowledgedNonPersistent: true });
    const vault = createCredentialVault({ store, stateDir: path.join(dir, "vault") });
    const spawned = [];
    const gate = createOperationGate({ vault, spawnSync: (...args) => { spawned.push(args); return { status: 0, stdout: "", stderr: "" }; } });
    const [alpha, beta, gamma] = ["alpha", "beta", "gamma"].map((id) => world.requesterFor(id));

    const run = (reference, requester) => {
      const permit = gate.grantPermit({ reference, action: "read-config", requester, phaseId: PHASE, capability: { ownerConfirmation: true } });
      return gate.run({ reference, action: "read-config", requester, permit, capability: { ownerConfirmation: true }, command: process.execPath, args: ["--version"], envVarName: "SYNTHETIC_VALUE" });
    };

    // The operation path refuses a requester outside the reference's project, and a plain string.
    const alphaOp = "ProjectOS/alpha/staging/supabase/service-role-key";
    vault.provision({ reference: alphaOp, requester: alpha, reach: "project", readValue: () => VALUE });
    if (run(alphaOp, alpha).blocker !== "CREDENTIAL_GRANT_REQUIRED" || spawned.length !== 0) fail("a release went out with no credential-release grant");
    const command = [process.execPath, "--version"];
    world.grant("alpha", PHASE, [alphaOp], "read-config", command, { confirmed: false });
    if (run(alphaOp, alpha).blocker !== "CREDENTIAL_GRANT_REQUIRED" || spawned.length !== 0) fail("a grant with no receipt released a credential");
    world.grant("alpha", PHASE, [alphaOp], "read-config", ["some-other-command"]);
    if (run(alphaOp, alpha).blocker !== "CREDENTIAL_GRANT_REQUIRED" || spawned.length !== 0) fail("a grant for another command released a credential");
    world.grant("alpha", PHASE, [alphaOp], "read-config", command);
    if (run(alphaOp, beta).blocker !== "CROSS_PROJECT_REFUSED" || spawned.length !== 0) fail("the operation path let a requester outside the reference's project through");
    if (!run(alphaOp, alpha).ok || spawned.length !== 1) fail("the operation path refused the project's own run");
    if (codeOf(() => vault.authoriseSessionRelease({ reference: alphaOp, requester: "alpha" })) !== "REQUESTER_REQUIRED") fail("a plain string passed as a requester");

    // A tenant secret: a second project in the tenant, then another tenant, and only the tenant rule decides.
    const ownerSecret = "ProjectOS/tenant.owner-personal/staging/supabase/service-role-key";
    vault.provision({ reference: ownerSecret, requester: alpha, reach: "tenant", readValue: () => VALUE });
    world.grant("beta", PHASE, [ownerSecret], "read-config", command);
    if (!run(ownerSecret, beta).ok) fail("a tenant secret was refused to a second project in the same tenant");
    world.grant("gamma", PHASE, [ownerSecret], "read-config", command);
    if (run(ownerSecret, gamma).blocker !== "TENANT_MISMATCH") fail("a tenant secret crossed tenants");

    // A project id starting with tenant., in any case; and the mutators.
    if (codeOf(() => world.authority.issueConsoleRun({ projectId: "Tenant.Stray" })) !== "TENANT_UNKNOWN") fail("a reserved project id was given a requester");
    for (const door of [() => vault.present({ reference: alphaOp, requester: gamma }), () => vault.remove({ reference: alphaOp, requester: gamma }), () => vault.provision({ reference: alphaOp, requester: gamma, replace: true, readValue: () => "overwritten" })]) {
      if (codeOf(door) !== "CROSS_PROJECT_REFUSED") fail("a mutator crossed a project");
    }
    if (store.get(alphaOp) !== VALUE) fail("a refused mutator changed the store");

    // The platform credential, with its own project asking.
    const platform = "ProjectOS/projectos/development/openai/gatekeeper-api-key";
    store.set(platform, VALUE);
    if (codeOf(() => vault.authoriseSessionRelease({ reference: platform, requester: world.requesterFor("projectos") })) !== "PLATFORM_RELEASED_TO_NONE") fail("the platform credential reached a session");

    // An account-wide token stored under another tenant's project: only the reach rule can refuse this.
    const gammaToken = "ProjectOS/gamma/staging/vercel/vercel-token";
    vault.provision({ reference: gammaToken, requester: gamma, reach: "account", reachTenants: ["owner-personal"], readValue: () => VALUE });
    if (codeOf(() => vault.authoriseSessionRelease({ reference: gammaToken, requester: gamma })) !== "REACH_WIDER_THAN_PROJECT") fail("an account-wide token was projected into a session");
    const alphaToken = "ProjectOS/alpha/staging/vercel/vercel-token";
    vault.provision({ reference: alphaToken, requester: alpha, reach: "project", readValue: () => VALUE });
    if (codeOf(() => vault.authoriseSessionRelease({ reference: alphaToken, requester: alpha })) !== null) fail("a project-reach token was refused in its own project");

    // Durable: a new vault finds what the old one wrote, and no value is in it.
    const audit = fs.readFileSync(vault.auditPath, "utf8");
    if (!audit.includes('"reason":"cross-project-refused"') || audit.includes(VALUE)) fail("the durable audit is missing a refusal, or holds a value");
  });
  return errors;
}

function run() {
  const raw = {};
  for (const rel of ALL_SOURCES) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  if (errors.length === 0) errors.push(...behaviour());
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error(`${THIS_VALIDATOR}: ${e.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${MUTATIONS.length} named mutations killed, each by its own rule)`);
}

module.exports = { run, check, selfTest, behaviour, syntheticWorld, MUTATIONS, TESTS };
