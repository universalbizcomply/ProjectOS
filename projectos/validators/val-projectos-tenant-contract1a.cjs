"use strict";
/**
 * THE TENANT CONTRACT — PROJECTOS-TENANT-CONTRACT1A (plan v1.28, V4 Stage 2).
 *
 * ADR-T1, the two committed registries and the pure rules behind them. The kernel does not read any of
 * this until PROJECTOS-TENANT-PRINCIPAL1A, so today the contract is all there is, and every way of
 * softening a contract reads reasonably in a diff:
 *
 *   TC-1  "the ADR can stop at what it does"        — and nobody reads what it does not do
 *   TC-2  "the hard rule is implied by the limits"  — and a second party's data lands on this machine
 *   TC-3  "the ADR need not rule on the awkward bits" — and each gets decided by accident in a later phase
 *   TC-4  "the ADR passed review, so it is Accepted" — and the implementer has accepted its own design
 *   TC-5  "ADR-K1 is Accepted, everyone knows"      — and the status names no owner decision
 *   TC-6  "a binding is a value like any other"     — and the agency moves tenant in a one-word diff
 *   TC-7  "the reader validates the file"           — and the committed file is broken on arrival
 *   TC-8  "the schema is documentation"             — and it describes a different registry from the code
 *   TC-9  "the records speak for themselves"        — and the trust boundary omits two pieces of authority
 *   TC-10 "the registry was complete when written"  — and a new action defaults past its owner floor
 *   TC-11 "the tenant actions can be ordinary"      — and crossing a tenant is P4
 *   TC-12 "a class is only a label in a file"       — and a one-word edit lowers phase closure
 *   TC-13 "the action file is short enough to eyeball" — and one spelling carries two classes
 *   TC-14 "pure enough"                             — and the tenant depends on an environment variable
 *   TC-15 "stop at the first good line"             — and a contradiction further down is never seen
 *   TC-16 "the shape checks catch wildcards"        — and `C:/dev/*` is a perfectly shaped path
 *   TC-17 "project ids are the identity"            — and one repository sits under two tenants
 *   TC-18 "tenant. is an unlikely project name"     — and a project shares a name with a tenant's secrets
 *   TC-19 "unlisted means the owner's"              — and the mistake is invisible
 *   TC-20 "the id is enough"                        — and a project id in a project's own file picks its tenant
 *   TC-21 "a worktree knows what it is"             — and its own `.git` file picks its tenant
 *   TC-22 "the shape is the proof"                  — and `{ tenant: 'agency-business' }` is a binding
 *   TC-23 "a missing field has a sensible default"  — and R1 is gone
 *   TC-24 "the caller knows best"                   — and R2 is gone
 *   TC-25 "a child is the same task, mostly"        — and R3 stops being equality
 *   TC-26 "a child can have a little more room"     — and R3 stops being at-most
 *   TC-27 "record it afterwards"                    — and R4 is a log, not a door
 *   TC-28 "an unknown action is probably harmless"  — and R5 is gone
 *   TC-29 "validate what you can use"               — and a bad action file stays live
 *   TC-30 "keep a copy of the vocabularies here"    — and the copy drifts
 *   TC-31 "export it later"                         — and the next phase re-implements it
 *   TC-32 "register it later"                       — and nothing ever runs this file
 *   TC-33 "the docs are nearly right"               — and they mislead the next reader
 *
 * Added in the review round (ECC SECURITY, Agency software-architect):
 *
 *   TC-34 "a full-shape envelope is an envelope"    — and `{ ok: true, envelope: { ...'P1' } }` is admitted
 *   TC-35 "the door only records"                   — and P5 and P6 walk through it
 *   TC-36 "a crossing is a child of its run"        — and R3 bends, or the link to the run is lost
 *   TC-37 "the shape looks fine"                    — and `C:/dev/x:y`, `~1`, `%41` and U+212A are aliases
 *   TC-38 "a listing is a listing"                  — and one taken anywhere attaches a worktree anywhere
 *   TC-39 "the table is in the file"                — and one word moves a class or an environment
 *   TC-40 "the boundary actions are ordinary lines" — and a crossing drops below its floor
 *   TC-T  "the tests exist"                         — and `.skip` keeps the proof while dropping the run
 *
 * THE MUTATIONS ARE IN THE BODIES. A pin on a call site survives a gutted function, so each pin is taken
 * from inside the function that decides, and each mutation is named after what the function stops doing.
 * `selfTest` applies each in memory and counts it killed only when ITS OWN rule fires.
 *
 * Comments are stripped before anything is judged. Reads files; runs nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const TENANT_REL = "projectos/core/src/tenant.ts";
const ACTION_REL = "projectos/core/src/actionRegistry.ts";
const ENVELOPE_REL = "projectos/core/src/taskEnvelope.ts";
const BARREL_REL = "projectos/core/src/index.ts";
const OWNER_REL = "projectos/core/src/ownerOnlyActions.ts";
const PERMISSIONS_REL = "projectos/core/src/permissions.ts";
const ALLOWLIST_REL = "projectos/agent/src/installation/projectAllowlist.ts";
const TREG_REL = "projectos/security/tenant-registry.json";
const AREG_REL = "projectos/security/action-registry.json";
const SCHEMA_REL = "projectos/schemas/tenant-registry.schema.json";
const TRUST_REL = "projectos/security/trust-boundary.json";
const ADR_T_REL = "docs/adr/ADR-T1-tenant-boundary.md";
const ADR_K_REL = "docs/adr/ADR-K1-kernel-contract.md";
const BASE_REL = "docs/00_Baseline_State.md";
const PRD_REL = "docs/01_PRD.md";
const TRD_REL = "docs/04_TRD.md";
const SCHEMADOC_REL = "docs/05_Schema.md";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const SOURCES = [
  TENANT_REL, ACTION_REL, ENVELOPE_REL, BARREL_REL, OWNER_REL, PERMISSIONS_REL, ALLOWLIST_REL,
  TREG_REL, AREG_REL, SCHEMA_REL, TRUST_REL, ADR_T_REL, ADR_K_REL, BASE_REL, PRD_REL, TRD_REL, SCHEMADOC_REL,
  VA_REL, CR_REL,
];
const THIS_VALIDATOR = "val-projectos-tenant-contract1a";

const TESTS = {
  "projectos/core/test/tenant.test.ts": [
    "binds exactly the projects the owner decided, to the tenants the owner decided (D2)",
    "canonicalises each repository with the rule the allowlist uses, parseRemoteUrl",
    "a valid addition is accepted: the positive control for every refusal below",
    "a wildcard %s refuses the whole file, by name",
    "a wildcard is named as a wildcard, ahead of the shape rule that would also refuse it",
    "%s refuses the whole file, by name",
    "one bad line refuses the good lines too: nothing in the file can be resolved",
    "a project id using the reserved tenant prefix is refused, in any case",
    "derives each tenant from the registry: two real tenants, two real answers",
    "refuses an unlisted project by name, and never defaults to the owner",
    "a project id claimed from the wrong repository is a mismatch, not the claimed tenant",
    "the right repository at the wrong root is a mismatch: a copy elsewhere is a different project",
    "refuses a registry that did not come from parseTenantRegistry",
    "a worktree the registered root lists takes its tenant and domain",
    "a directory the registered root does not list is refused, whatever the directory says",
    "parses the listing git prints, dropping the registered root and anything prunable",
    "a structurally perfect copy is not one",
  ],
  "projectos/core/test/action-registry.test.ts": [
    "names every spelling of both existing vocabularies",
    "gives the two spellings of closing a phase one answer",
    "%s is registered as P5",
    "a registered action keeps its own class: the positive control",
    "an unknown action is P5 in the strictest environment",
    "the near miss %j is not a synonym",
    "the object-prototype name %s is unregistered",
    "a registry that did not pass parseActionRegistry registers nothing, whatever it says",
    "a wildcard %s refuses the whole file, by name",
    "%s refuses the whole file, by name",
    "losing %s from a vocabulary refuses the whole file",
    "inventing a spelling under a vocabulary column refuses the whole file",
    "%s written down as %s is refused: a class is never lowered (R6)",
    "%s is the ONLY rule refusing %s at %s, so removing it fails this test",
  ],
  "projectos/core/test/task-envelope.test.ts": [
    "a complete envelope parses: the positive control",
    "the code requires exactly the fields of the contract",
    "a missing %s is refused, by name",
    "an unparseable %s (%j) is refused, by name",
    "an unknown field is refused: there is no tolerated tenantOverride",
    "labels on the request change nothing: this request names another tenant and a lower class",
    "a binding resolveTenant did not produce is refused: the real one is the positive control",
    "the idempotency key is derived from the intent",
    "an unchanged child passes: the positive control for every refusal below",
    "a child that changes %s and nothing else is refused, naming it",
    "a child naming the same project and another tenant is refused",
    "a child that widens %s is refused, naming it",
    "a second project in the SAME tenant is a different project: refused for project alone",
    "a child minted under another tenant binding is refused: cross-tenant work is a new root",
    "nothing is admitted when the line could not be written: the same envelope, a failing port",
    "a recorder that throws is a recorder that failed, and the throw goes no further",
    "a refusal that cannot be recorded stays a refusal and says so",
    "a forged { ok: true } is refused at the door and recorded",
    "an unregistered action is recorded at the class it deserves, and refused",
  ],
  "projectos/core/test/tenant-contract-review.test.ts": [
    "the forged full-shape envelope the reviewer built is refused at the door, and recorded",
    "a perfect copy of a minted envelope is not minted",
    "parsing is not minting: parseEnvelope output is refused at the door",
    "a persisted envelope is re-admitted through its derived binding and the registry",
    "a persisted envelope with a different %s is refused, naming it",
    "checkChildEnvelope re-derives the class: a child labelled lower than the registry is refused",
    "R3 requires the principal to equal the parent: same everything else passes",
    "a child cannot be minted from a forged parent: its budget would be a claim",
    "P6 is refused by name even with a grant, and the port is not asked",
    "an unregistered action mints at P5 (R5) and is refused at the door by name, with a grant, and recorded",
    "a registered P5 is refused without a grant and admitted with one: the port decides",
    "a grant port that throws or answers vaguely has not granted",
    "P4 cannot run: ADR-K1 §4 gives it no grant, and a yes from the port changes nothing",
    "the record line carries registered and via",
    "neither fact became an envelope field: ADR-K1 is accepted, and action is the one addition",
    "%s cannot be a child",
    "a crossing linked to its run passes: the positive control",
    "a crossing that does not name the run is refused, so a release cannot lose its run",
    "a crossing that differs from its run in %s alone is refused, naming it",
    "broker-call and push leave the machine, so neither is local",
    "case folding is ASCII only: a Kelvin sign does not match a registered k",
    "the same listing taken anywhere else attaches nothing",
    "a checkout under another entry root is refused, even when listed",
    "the listing drops the record equal to the root, wherever it sits, and not the first record",
    "a registry root under another entry root refuses the whole file; a shared prefix does not",
    "action-registry-change is registered as P5: ADR-T1 §3 \"same terms\" rests on this",
    "a sparse scope is refused: every() skips holes",
    "a paid action with no budget is refused (ADR-K1 §2); with one it mints",
  ],
};
const ALL_SOURCES = [...SOURCES, ...Object.keys(TESTS)];
/** A proof that does not run proves nothing, and its name still satisfies a needle. */
const NOT_RUN = /\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|fails|skipIf|runIf)\b|\.(?:skip|only)\(|\b(?:xit|fit|xdescribe|fdescribe)\(/;

/** A pin: this text, in this file, inside this function when one is named. */
const P = (rel, fn, pin) => ({ rel, fn, pin });
const T = (fn, pin) => P(TENANT_REL, fn, pin);
const A = (fn, pin) => P(ACTION_REL, fn, pin);
const E_ = (fn, pin) => P(ENVELOPE_REL, fn, pin);

/** ADR-T1 §10 and §11, as prose with the line wrapping and bold removed. */
const LIMITS = {
  workerReach: "A worker can still reach any tenant's secrets and files outside the kernel, as the owner's Windows user",
  realFixes: "The real fixes are Host service custody for secrets and Stage 4.3 isolation for files.",
  gitName: "The registry's owner check rests on a git name, which cannot tell the owner from an agent",
  noProductFlow: "No product flow uses the tenant tables yet",
  eightOfNine: "Eight of the nine connector scenarios are defined in Stage 2 and first run in Stage 5.",
  bothTenants: "One owner sees both tenants, by membership",
};
const HARD_RULE = "No other party's data or credentials go on this machine until Stage 4 isolation and service-held secrets are done.";
const RULINGS = {
  principal: "The principal is the Windows operator plus the kernel-bound work context",
  supabase: "A Supabase identity carries no kernel authority.",
  tenantDomain: "Tenant = whose data and authority.",
  trustBasis: "Committed bytes only, read from the installation's git object store at `HEAD` of the installation checkout: `git show HEAD:./projectos/security/tenant-registry.json`",
  selfHosted: "For `projectos`, the installation is the project.",
  allMurad: "All commits on this machine carry the name Murad, agent commits included.",
  ownerCheckLimit: "`tenant-registry-change` protects nothing beyond repo write access until an owner-only signature or an owner-gate receipt naming the registry blob sha exists.",
  sameTerms: "changing it is the P5 action `action-registry-change`, with a floor in code",
  domains: "The domain on each registry line is the lead's reading of what the project is, not an owner decision.",
  r3Principal: "`tenant`, `domain`, `project`, `environment` and `principal` (R3)",
  listingAtRoot: "one taken anywhere else attaches nothing",
  allowlistScope: "The installation allowlist guards gatekeeper spend only, not session release",
  worktreeSecret: "Worktree tenant identity alone must never release a secret.",
  releaseOpen: "OPEN, the owner decides at PROJECTOS-TENANT-CREDENTIALS1A.",
  releaseNoStep: "session release has no owner step today",
  postgres: "Postgres is never authority.",
  gitWins: "the git registry wins",
  crossingsRoots: "Boundary crossings are roots.",
  runLink: "`run:<envelopeId>` in its scope",
  honestEnvironment: "`broker-call` and `push` are `production`",
  worktreeProof: "git -C <governedRoot> worktree list --porcelain",
  worktreeLimit: "It grants tenant identity and nothing else.",
  classProject: "Inherits its project's tenant",
  classTenant: "tenant.<tenantId>",
  classPlatform: "Serves every tenant through the broker. Released to none",
  ownerBoth: "One owner JWT and one owner desktop see both, by membership.",
  serviceRole: "The service role bypasses RLS entirely",
  stopWork: "Account-wide `stop-work`.",
  oneUser: "One user. Everything runs as one Windows user, for one owner, on one machine.",
};

/** The three bindings the owner decided (D2), and nothing about any other line. */
const BINDINGS = [
  { projectId: "projectos", repository: "github.com/universalbizcomply/ProjectOS", governedRoot: "C:/dev/ProjectOS", tenant: "owner-personal", domain: "develop" },
  { projectId: "polygo", repository: "github.com/polygonia-apres/polygo", governedRoot: "C:/dev/Polygo/polygo", tenant: "owner-personal", domain: "develop" },
  { projectId: "seo-agency", repository: "127.0.0.1:47900/SEOAgency-remote/seo-agency", governedRoot: "C:/dev/SEOAgency", tenant: "agency-business", domain: "business" },
];
const RESERVED_ACTIONS = ["cross-tenant-access", "tenant-registry-change", "action-registry-change"];
/** The whole committed table. A new action is a deliberate change here as well as in the file. */
const ACTION_TABLE = {
  create_phase: "P2/local", prompt_phase: "P2/local", implement: "P2/local", run_validators: "P1/local",
  generate_evidence: "P2/local", generate_report: "P2/local", request_approval: "P2/local", request_review: "P2/local",
  perform_review: "P1/local", architect_phase: "P1/local", recommend_closure: "P1/local",
  approve: "P5/local", reject: "P5/local", override_gate: "P5/local", rollback: "P2/local",
  "phase-closure": "P5/local", commit: "P3/local", push: "P3/production",
  "secrets-handling": "P5/local", "payment-or-live-charge": "P5/production",
  "cross-tenant-access": "P5/production", "tenant-registry-change": "P5/local", "action-registry-change": "P5/local",
  "run-start": "P2/local", "credential-release": "P5/local", "broker-call": "P3/production",
  "project-selection": "P1/local", "bridge-read": "P1/local",
};
/** The class ADR-K1 §3 and §4 give each protected spelling. */
const CLASS_OF = { "phase-closure": "P5", close_phase: "P5", approve: "P5", reject: "P5", override_gate: "P5", "secrets-handling": "P5", "payment-or-live-charge": "P5", commit: "P3", push: "P3" };

const RULES = [
  {
    rule: "TC-15",
    says: "the tenant registry is no longer judged whole before anything can use it",
    pins: [
      T("parseTenantRegistry", "...(tenants ?? []).flatMap((entry, index) => tenantProblems(entry, index)),"),
      T("parseTenantRegistry", "...(projects ?? []).flatMap((entry, index) => projectProblems(entry, index, new Set(tenantIds))),"),
      T("parseTenantRegistry", "...duplicateProblems(projects ?? []),"),
      T("parseTenantRegistry", "...nestedRootProblems(projects ?? []),"),
      T("parseTenantRegistry", "if (problems.length > 0) return { ok: false, problems };"),
      T("parseTenantRegistry", "LIVE_REGISTRIES.add(registry);"),
      T("headerProblems", "if (root['schemaVersion'] !== TENANT_REGISTRY_SCHEMA_VERSION) {"),
      T("headerProblems", "...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map("),
    ],
    order: [T("parseTenantRegistry", "if (problems.length > 0) return { ok: false, problems };"), T("parseTenantRegistry", "LIVE_REGISTRIES.add(registry);")],
  },
  {
    rule: "TC-16",
    says: "a wildcard in a binding field no longer refuses the tenant registry by name",
    pins: [
      T(null, "const WILDCARD = /[*?]/;"),
      T("projectProblems", "if (WILDCARD.test(value)) {\n      problems.push({ code: 'TENANT_REGISTRY_WILDCARD', message: `${label} has a wildcard ${field}` });\n      continue;\n    }"),
      T("tenantProblems", "if (typeof id === 'string' && WILDCARD.test(id)) {\n    problems.push({ code: 'TENANT_REGISTRY_WILDCARD',"),
      T(null, "const BINDING_FIELDS = ['projectId', 'repository', 'governedRoot', 'tenant', 'domain'] as const;"),
    ],
  },
  {
    rule: "TC-17",
    says: "a duplicate project, repository or root no longer refuses the tenant registry, in any case",
    pins: [
      T("duplicateProblems", "['projectId', asciiLower],"),
      T("duplicateProblems", "['repository', asciiLower],"),
      T("duplicateProblems", "['governedRoot', rootKey],"),
      T("duplicateProblems", ".filter((value, index) => values.indexOf(value) !== index)"),
      T("duplicateProblems", "code: 'TENANT_REGISTRY_DUPLICATE'"),
      T("rootKey", "return asciiLower(path.split(String.fromCharCode(92)).join('/').replace(/\\/+$/, ''));"),
    ],
  },
  {
    rule: "TC-18",
    says: "a project id may read as a tenant-class credential segment",
    pins: [
      T(null, "export const TENANT_CREDENTIAL_PREFIX = 'tenant.';"),
      T("isReservedProjectId", "return asciiLower(projectId).startsWith(TENANT_CREDENTIAL_PREFIX);"),
      T("projectProblems", "if (typeof projectId === 'string' && isReservedProjectId(projectId)) {\n    problems.push({\n      code: 'TENANT_REGISTRY_RESERVED_ID',"),
    ],
  },
  {
    rule: "TC-19",
    says: "an unlisted project, or an unvalidated registry, is no longer refused by name",
    pins: [
      T("resolveTenant", "if (!LIVE_REGISTRIES.has(registry)) {\n    return { ok: false, code: 'TENANT_REGISTRY_INVALID',"),
      T("resolveTenant", "const entry = registry.projects.find((candidate) => candidate.projectId === checkout.projectId);\n  if (entry === undefined) {\n    return { ok: false, code: 'TENANT_UNKNOWN',"),
    ],
  },
  {
    rule: "TC-20",
    says: "a checkout can take a listed project's tenant from a different repository or root",
    pins: [
      T("resolveTenant", "if (checkout.repository === null || asciiLower(checkout.repository) !== asciiLower(entry.repository)) {\n    return {\n      ok: false,\n      code: 'TENANT_MISMATCH',"),
      T("resolveTenant", "if (via === null) {\n    return {\n      ok: false,\n      code: 'TENANT_MISMATCH',"),
      T("checkoutRoute", "if (rootKey(entry.governedRoot) === rootKey(checkout.root)) return 'governed-root';"),
    ],
  },
  {
    rule: "TC-21",
    says: "the linked-worktree rule no longer rests on the registered root's own listing, or it reached the allowlist",
    pins: [
      T("checkoutRoute", "const attached = listing.paths.some((path) => rootKey(path) === rootKey(checkout.root));"),
      T("checkoutRoute", "return attached ? 'linked-worktree' : null;"),
      T("linkedWorktreesFromPorcelain", "if (rootKey(path) === rootKey(takenAtRoot)) return [];"),
      T("linkedWorktreesFromPorcelain", "if (!head.startsWith('worktree ')) return [];"),
      T("linkedWorktreesFromPorcelain", "return lines.some((line) => line === 'prunable' || line.startsWith('prunable ')) ? [] : [path];"),
      T("registeredRootOf", "return registry.projects.find((entry) => entry.projectId === projectId)?.governedRoot ?? null;"),
      P(ALLOWLIST_REL, "checkoutShapeProblem", "'credential-bearing projects in that shape are not supported and are refused'"),
      P(ALLOWLIST_REL, "installationAllowsProject", "const shape = checkoutShapeProblem(sys, governedRoot);"),
    ],
  },
  {
    rule: "TC-22",
    says: "something other than resolveTenant can stand in as a derived binding",
    pins: [
      T("resolveTenant", "const binding: TenantBinding = Object.freeze({ ...entry, via });\n  LIVE_BINDINGS.add(binding);\n  return { ok: true, binding };"),
      T("isDerivedBinding", "return typeof value === 'object' && value !== null && LIVE_BINDINGS.has(value);"),
      E_("mintEnvelope", "if (!isDerivedBinding(binding)) {\n    return refused('R2',"),
    ],
  },
  {
    rule: "TC-23",
    says: "a missing, unparseable or unknown envelope field is no longer refused (R1)",
    pins: [
      E_("parseEnvelope", "if (!Object.hasOwn(record, field)) return [`the envelope has no ${field}`];"),
      E_("parseEnvelope", "return FIELD_CHECKS[field](record[field]) ? [] : [`the envelope's ${field} is unparseable`];"),
      E_("parseEnvelope", ".filter((key) => !(ENVELOPE_FIELDS as readonly string[]).includes(key))"),
      E_("parseEnvelope", "if (reasons.length > 0) return refused('R1', reasons);"),
      E_(null, "envelopeVersion: (value) => value === ENVELOPE_VERSION,"),
      E_(null, "action: isActionName,"),
      A("isActionName", "return typeof value === 'string' && ACTION_ID.test(value);"),
      E_("parseEnvelope", "const actor = Object.freeze({ ...(record['actor'] as EnvelopeActor) });"),
      E_("parseEnvelope", "Object.freeze({ ...(record as unknown as TaskEnvelope), scope, actor })"),
      E_(null, "export const ENVELOPE_VERSION = 2;"),
      E_("instantOf", "return Number.isNaN(at) || new Date(at).toISOString() !== value ? null : at;"),
      E_("isActor", "return Object.keys(record).length === ACTOR_FIELDS.length && ACTOR_FIELDS.every((field) => nonBlank(record[field]));"),
      E_("nonBlank", "return typeof value === 'string' && value.trim() !== '';"),
      E_("envelopeExpired", "return expiry === null || at === null || expiry <= at;"),
      E_(null, "scope: (value) => Array.isArray(value) && [...value].every(nonBlank),"),
      E_("parseEnvelope", "...((PAID_ACTIONS as readonly unknown[]).includes(record['action']) && record['budget'] === 0"),
      A(null, "export const PAID_ACTIONS = ['broker-call'] as const;"),
    ],
  },
  {
    rule: "TC-24",
    says: "an envelope can take tenant, domain, project, environment or class from the caller (R2)",
    pins: [
      E_("mintEnvelope", "const { action, subjectHash, scope, budget, expiry, intentScope } = request;"),
      E_("mintEnvelope", "const { binding, registry, principal, actor, envelopeId } = context;"),
      E_("mintEnvelope", "const resolved = resolveAction(registry, action);"),
      E_("mintEnvelope", "tenant: binding.tenant,"),
      E_("mintEnvelope", "domain: binding.domain,"),
      E_("mintEnvelope", "project: binding.projectId,"),
      E_("mintEnvelope", "environment: resolved.environment,"),
      E_("mintEnvelope", "actionClass: resolved.actionClass,"),
      E_("mintEnvelope", "idempotencyKey: deriveIdempotencyKey({ tenant: binding.tenant, project: binding.projectId, action, subjectHash, intentScope }),"),
      E_("deriveIdempotencyKey", "const canonical = JSON.stringify([intent.tenant, intent.project, intent.action, intent.subjectHash, intent.intentScope]);"),
    ],
  },
  {
    rule: "TC-25",
    says: "a child envelope may differ from its parent in tenant, domain, project or environment (R3)",
    pins: [
      E_("checkChildEnvelope", "...(['tenant', 'domain', 'project', 'environment', 'principal'] as const).flatMap((field) =>\n      down[field] === up[field] ? [] :"),
      E_("checkChildEnvelope", "...(down.parentEnvelopeId === up.envelopeId ? [] :"),
      E_("checkChildEnvelope", "const parsedChild = parseEnvelope(child);\n  if (!parsedChild.ok) return parsedChild;"),
      E_("checkChildEnvelope", "return reasons.length > 0 ? refused('R3', reasons) : parsedChild;"),
      E_("mintEnvelope", "const result = parent === null ? parseEnvelope(candidate) : checkChildEnvelope(parent, candidate, registry);"),
    ],
  },
  {
    rule: "TC-26",
    says: "a child envelope may exceed its parent's scope, budget, expiry or class (R3)",
    pins: [
      E_("checkChildEnvelope", "...down.scope.filter((item) => !up.scope.includes(item)).map("),
      E_("checkChildEnvelope", "...(down.budget <= up.budget ? [] :"),
      E_("checkChildEnvelope", "...((instantOf(down.expiry) as number) <= (instantOf(up.expiry) as number) ? [] :"),
      E_("checkChildEnvelope", "...(classAtMost(down.actionClass, up.actionClass) ? [] :"),
      A("classAtMost", "return childAt >= 0 && parentAt >= 0 && childAt <= parentAt;"),
      A(null, "export const ACTION_CLASSES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;"),
    ],
  },
  {
    rule: "TC-27",
    says: "an operation can proceed without its admission being recorded (R4)",
    pins: [
      E_("recorded", "return recorder(record) === true;\n  } catch {\n    return false;\n  }"),
      E_("admitEnvelope", "if (!minted.ok) return refuse(minted.rule, minted.reasons, null, null);"),
      E_("admitEnvelope", "if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })) {\n    return { admitted: false, rule: 'R4',"),
      E_("admitEnvelope", "const wrote = recorded(recorder, { ...at, outcome: 'refused', rule, envelope,"),
      E_("admitEnvelope", "if (envelopeExpired(envelope, now)) return refuse('EXPIRED',"),
      E_("recordExecution", "return recorded(recorder, { stage: 'execution', outcome, rule, envelope,"),
    ],
    order: [
      E_("admitEnvelope", "if (envelopeExpired(envelope, now)) return refuse('EXPIRED',"),
      E_("admitEnvelope", "const refusal = classRefusal(envelope, provenance, grant);"),
      E_("admitEnvelope", "if (!recorded(recorder, { ...at, outcome: 'allowed',"),
      E_("admitEnvelope", "return { admitted: true, envelope };"),
    ],
  },
  {
    rule: "TC-28",
    says: "an unregistered action is no longer P5 in the strictest environment (R5)",
    pins: [
      A(null, "export const UNREGISTERED_ACTION_CLASS: ActionClass = 'P5';"),
      A(null, "export const UNREGISTERED_ACTION_ENVIRONMENT: KernelEnvironment = 'production';"),
      A("resolveAction", "const entry = LIVE_REGISTRIES.get(registry)?.get(action);"),
      A("resolveAction", "? { action, registered: false, actionClass: UNREGISTERED_ACTION_CLASS, environment: UNREGISTERED_ACTION_ENVIRONMENT }"),
      A("resolveAction", ": { action, registered: true, actionClass: entry.actionClass, environment: entry.environment };"),
      A(null, "const LIVE_REGISTRIES = new WeakMap<ActionRegistry, ReadonlyMap<string, ActionEntry>>();"),
    ],
  },
  {
    rule: "TC-29",
    says: "the action registry is no longer judged whole, with its floors, before anything can use it",
    pins: [
      A("parseActionRegistry", "...actions.flatMap((entry, index) => entryProblems(entry, index)),"),
      A("parseActionRegistry", "...duplicateProblems(records),"),
      A("parseActionRegistry", "...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map("),
      A("parseActionRegistry", "...vocabularyProblems(records),"),
      A("parseActionRegistry", "...records.flatMap(floorProblems),"),
      A("parseActionRegistry", "if (problems.length > 0) return { ok: false, problems };"),
      A("parseActionRegistry", "LIVE_REGISTRIES.set(registry, new Map("),
      A(null, "const WILDCARD = /[*?]/;"),
      A("entryProblems", "if (WILDCARD.test(spelling)) {\n      problems.push({ code: 'ACTION_REGISTRY_WILDCARD',"),
      A("duplicateProblems", ".filter((spelling, index) => spellings.indexOf(spelling) !== index)"),
      A("floorProblems", "...(spellings.some(isAbsolutelyOwnerOnly) ? lowered('P5', 'it is absolutely owner-only') : []),"),
      A("floorProblems", "...(spellings.some((spelling) => isOwnerOnly(spelling as GovernanceAction)) ? lowered('P5', 'it is an owner-only governance action') : []),"),
      A("floorProblems", "...(spellings.some((spelling) => (ALWAYS_OWNER_ONLY as readonly string[]).includes(spelling)) ? lowered(OWNER_ONLY_FLOOR, 'it is on the owner floor') : []),"),
      A("floorProblems", "...(spellings.some((spelling) => (RESERVED_P5_ACTIONS as readonly string[]).includes(spelling)) && declared !== 'P5'"),
      A("floorProblems", "classAtMost(floor, declared) ? [] :"),
      A(null, "const OWNER_ONLY_FLOOR: ActionClass = 'P3';"),
      A(null, "export const RESERVED_P5_ACTIONS = ['cross-tenant-access', 'tenant-registry-change', 'action-registry-change'] as const;"),
    ],
    order: [A("parseActionRegistry", "if (problems.length > 0) return { ok: false, problems };"), A("parseActionRegistry", "LIVE_REGISTRIES.set(registry, new Map(")],
  },
  {
    rule: "TC-30",
    says: "the action registry stopped reading the two vocabularies from where they live",
    pins: [
      A(null, "import { ALWAYS_OWNER_ONLY, isAbsolutelyOwnerOnly } from './ownerOnlyActions.js';"),
      A(null, "import { actionsFor, isOwnerOnly, type GovernanceAction } from './permissions.js';"),
      A("vocabularyProblems", "...vocabulary('governanceAction', actionsFor('owner'), 'permissions.ts'),"),
      A("vocabularyProblems", "...vocabulary('ownerOnlyAction', ALWAYS_OWNER_ONLY, 'ownerOnlyActions.ts'),"),
      A("vocabularyProblems", "...known.filter((spelling) => !named.includes(spelling)),\n      ...named.filter((spelling) => !known.includes(spelling)),"),
      A("vocabularyProblems", "...[...RESERVED_P5_ACTIONS, ...BOUNDARY_ACTIONS].filter((action) => !ids.includes(action)).map("),
    ],
  },
  {
    rule: "TC-31",
    says: "the core barrel no longer exports the tenant contract",
    pins: [
      P(BARREL_REL, null, "export * from './tenant.js';"),
      P(BARREL_REL, null, "export * from './actionRegistry.js';"),
      P(BARREL_REL, null, "export * from './taskEnvelope.js';"),
    ],
  },
  {
    rule: "TC-34",
    says: "something other than a minted or re-derived envelope can reach the door",
    pins: [
      E_(null, "const LIVE_ENVELOPES = new WeakMap<TaskEnvelope, EnvelopeProvenance>();"),
      E_("branded", "if (result.ok) LIVE_ENVELOPES.set(result.envelope, provenance);"),
      E_("admitEnvelope", "const provenance = LIVE_ENVELOPES.get(envelope);\n  if (provenance === undefined) return refuse('R2',"),
      E_("mintEnvelope", "if (parent !== null && !LIVE_ENVELOPES.has(parent)) {\n    return refused('R2',"),
      E_("mintEnvelope", "return branded(result, { registered: resolved.registered, via: binding.via });"),
      E_("readmitEnvelope", "if (!isDerivedBinding(binding)) {\n    return refused('R2',"),
      E_("readmitEnvelope", "const parsed = parseEnvelope(raw);\n  if (!parsed.ok) return parsed;"),
      E_("readmitEnvelope", "const resolved = resolveAction(registry, envelope.action);"),
      E_("readmitEnvelope", "tenant: binding.tenant,"),
      E_("readmitEnvelope", "domain: binding.domain,"),
      E_("readmitEnvelope", "project: binding.projectId,"),
      E_("readmitEnvelope", "environment: resolved.environment,"),
      E_("readmitEnvelope", "actionClass: resolved.actionClass,"),
      E_("readmitEnvelope", "envelope[field] === derived[field] ? [] :"),
      E_("readmitEnvelope", "return reasons.length > 0 ? refused('R2', reasons) : branded(parsed, { registered: resolved.registered, via: binding.via });"),
      E_("checkChildEnvelope", "const resolved = resolveAction(registry, down.action);"),
      E_("checkChildEnvelope", "...(down.actionClass === resolved.actionClass ? [] :"),
      E_("checkChildEnvelope", "...(down.environment === resolved.environment ? [] :"),
    ],
  },
  {
    rule: "TC-35",
    says: "the door no longer gates the class, or its record lost what only the kernel knows",
    pins: [
      E_("classRefusal", "if (actionClass === 'P6') return { rule: 'P6_PROHIBITED',"),
      E_("classRefusal", "if (!provenance.registered) return { rule: 'UNREGISTERED_ACTION',"),
      E_("classRefusal", "if (actionClass === 'P4') return { rule: 'P4_NO_GRANT',"),
      E_("classRefusal", "if (actionClass === 'P5' && !granted(grant, envelope)) return { rule: 'P5_NO_GRANT',"),
      E_("granted", "return grant(envelope) === true;\n  } catch {\n    return false;\n  }"),
      E_("admitEnvelope", "const refusal = classRefusal(envelope, provenance, grant);\n  if (refusal !== null) return refuse(refusal.rule, refusal.reasons, envelope, provenance);"),
      E_("admitEnvelope", "registered: provenance?.registered ?? null, via: provenance?.via ?? null, reasons });"),
      E_("admitEnvelope", "outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })"),
      E_("recordExecution", "registered: provenance?.registered ?? null, via: provenance?.via ?? null, reasons: [], at: now });"),
    ],
    order: [
      E_("classRefusal", "if (actionClass === 'P6') return { rule: 'P6_PROHIBITED',"),
      E_("classRefusal", "if (!provenance.registered) return { rule: 'UNREGISTERED_ACTION',"),
      E_("classRefusal", "if (actionClass === 'P5' && !granted(grant, envelope)) return { rule: 'P5_NO_GRANT',"),
    ],
  },
  {
    rule: "TC-36",
    says: "a boundary crossing can be a child, or checkRunLink no longer ties it to its run",
    pins: [
      E_("checkChildEnvelope", "...(isBoundaryAction(down.action) ? ["),
      A("isBoundaryAction", "return BOUNDARY_ACTIONS.includes(action);"),
      A(null, "export const BOUNDARY_ACTIONS: readonly string[] = BOUNDARY_FLOORS.map(([action]) => action);"),
      E_(null, "const RUN_ACTION = 'run-start';"),
      E_("runLinkScope", "return `run:${runEnvelopeId}`;"),
      E_("checkRunLink", "const parsedCrossing = parseEnvelope(crossing);\n  if (!parsedCrossing.ok) return"),
      E_("checkRunLink", "...(up.action === RUN_ACTION ? [] :"),
      E_("checkRunLink", "...(down.parentEnvelopeId === null ? [] :"),
      E_("checkRunLink", "...(['tenant', 'domain', 'project', 'principal'] as const).flatMap((field) =>\n      down[field] === up[field] ? [] :"),
      E_("checkRunLink", "...(down.scope.includes(link) ? [] :"),
      E_("checkRunLink", "return reasons.length > 0 ? { ok: false, rule: 'RUN_LINK', reasons } : { ok: true };"),
    ],
  },
  {
    rule: "TC-37",
    says: "a registry value can spell one identity two ways",
    pins: [
      T(null, String.raw`const GOVERNED_ROOT = /^[A-Za-z]:(?:\/[A-Za-z0-9_][A-Za-z0-9._ -]*)+$/;`),
      T(null, String.raw`const GOVERNED_ROOT_ALIAS = /[. ](\/|$)/;`),
      T(null, String.raw`const REPOSITORY = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|127\.0\.0\.1:[0-9]{1,5})\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;`),
      T(null, String.raw`const REPOSITORY_SUFFIX = /\.[Gg][Ii][Tt]$/;`),
      T("bindingFieldProblem", "return REPOSITORY.test(value) && !REPOSITORY_SUFFIX.test(value) ? null :"),
      T("bindingFieldProblem", "return GOVERNED_ROOT.test(value) && !GOVERNED_ROOT_ALIAS.test(value) ? null :"),
      T("asciiLower", "return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));"),
    ],
  },
  {
    rule: "TC-38",
    says: "a listing or a nested root can attach a checkout to the wrong project",
    pins: [
      T("isAtOrUnder", "return path === root || path.startsWith(`${root}/`);"),
      T("nestedRootProblems", ".filter((root) => roots.some((other) => other !== root && isAtOrUnder(root, other)))"),
      T("nestedRootProblems", "code: 'TENANT_REGISTRY_NESTED_ROOT'"),
      T("checkoutRoute", "if (listing === null || rootKey(listing.takenAtRoot) !== rootKey(entry.governedRoot)) return null;"),
      T("resolveTenant", "const foreign = registry.projects.find((other) => other !== entry && isAtOrUnder(rootKey(checkout.root), rootKey(other.governedRoot)));\n  if (foreign !== undefined) {\n    return {\n      ok: false,\n      code: 'TENANT_MISMATCH',"),
      T(null, "export interface WorktreeListing {\n  readonly takenAtRoot: string;\n  readonly paths: readonly string[];\n}"),
    ],
  },
  {
    rule: "TC-40",
    says: "a boundary action lost its floor in code",
    pins: [
      A(null, "const BOUNDARY_FLOORS: readonly (readonly [string, ActionClass])[] = [\n  ['run-start', 'P2'],\n  ['credential-release', 'P5'],\n  ['broker-call', 'P3'],\n  ['project-selection', 'P1'],\n  ['bridge-read', 'P1'],\n];"),
      A("floorProblems", "...BOUNDARY_FLOORS.filter(([action]) => spellings.includes(action)).flatMap(([, floor]) => lowered(floor, 'it is a boundary action')),"),
    ],
  },
];

/** What `mintEnvelope`'s own span may never contain, and what no type a caller fills may declare. */
const MINT_FORBIDDEN = /\.\.\.request|\.\.\.context|\(request as|\(context as|request\[|context\[/;
const REQUEST_TYPE_FORBIDDEN = /\b(tenant|domain|project|environment|actionClass|principal|actor|idempotencyKey)\b/;
const PURITY = {
  [TENANT_REL]: [],
  [ACTION_REL]: ["./ownerOnlyActions.js", "./permissions.js"],
  [ENVELOPE_REL]: ["node:crypto", "./types.js", "./actionRegistry.js", "./tenant.js"],
};
/** Every way a module names another: `import x from`, `export x from`, and the bare `import 'x'`. */
const SPECIFIERS = [/^\s*import\s+['"]([^'"]+)['"]/gm, /^\s*import\s[^'"]*?\sfrom\s*['"]([^'"]+)['"]/gm, /^\s*export\s[^'"=]*?\sfrom\s*['"]([^'"]+)['"]/gm];
const IMPURE = /\bprocess\s*[.[]|\bglobalThis\b|\bglobal\s*[.[]|\bimport\s*\(|\bimport\.meta\b|\brequire\(|\beval\(|\bnew Function\b|Date\.now|new Date\(\)|Math\.random|\bfetch\(|\bconsole\.|\breadFile|\bwriteFile|\bexecSync|\bspawn\(/;
/** Unicode case mapping folds U+212A onto `k`, so tenant.ts may not reach for it at all. */
const UNICODE_FOLDING = /\.(?:toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase|localeCompare|normalize)\(/;

const entryText = (id, governance, ownerOnly, cls) =>
  `"id": "${id}",\n      "governanceAction": ${governance},\n      "ownerOnlyAction": ${ownerOnly},\n      "class": "${cls}"`;
const lowered = (name, rule, id, governance, ownerOnly, from, to) => ({
  name, rule, rel: AREG_REL, from: entryText(id, governance, ownerOnly, from), to: entryText(id, governance, ownerOnly, to),
});

const MUTATIONS = [
  // TC-1
  { name: "adr-hides-worker-reach", rule: "TC-1", rel: ADR_T_REL, from: "- **A worker can still reach any tenant's secrets and files** outside the kernel, as the owner's Windows\n  user (F7).", to: "- Workers run inside the kernel's boundary." },
  { name: "adr-hides-the-real-fixes", rule: "TC-1", rel: ADR_T_REL, from: "The real fixes are Host service custody for secrets and Stage 4.3 isolation for files.", to: "This is acceptable." },
  { name: "adr-hides-git-name-limit", rule: "TC-1", rel: ADR_T_REL, from: "- **The registry's owner check rests on a git name,** which cannot tell the owner from an agent (§3).\n", to: "" },
  { name: "adr-hides-harness-only-proof", rule: "TC-1", rel: ADR_T_REL, from: "- **No product flow uses the tenant tables yet** (F2). The database boundary is proved by the harness.\n", to: "" },
  { name: "adr-hides-unrun-scenarios", rule: "TC-1", rel: ADR_T_REL, from: "- **Eight of the nine connector scenarios** are defined in Stage 2 and first run in Stage 5.\n", to: "" },
  { name: "adr-hides-owner-sees-both", rule: "TC-1", rel: ADR_T_REL, from: "- **One owner sees both tenants,** by membership (§7).\n", to: "" },
  // TC-2
  { name: "adr-softens-hard-rule", rule: "TC-2", rel: ADR_T_REL, from: "**No other party's data or credentials go on this machine until Stage 4 isolation and service-held\nsecrets are done.**", to: "**Other parties' data should wait for Stage 4 where practical.**" },
  { name: "adr-exit-proof-lifts-hard-rule", rule: "TC-2", rel: ADR_T_REL, from: "A green exit proof does not lift it:", to: "A green exit proof lifts it, as does" },
  // TC-3
  { name: "adr-drops-principal", rule: "TC-3", rel: ADR_T_REL, from: "- **The principal is the Windows operator plus the kernel-bound work context:** which project this run\n  or session is for. Both come from the kernel.\n", to: "" },
  { name: "adr-gives-supabase-authority", rule: "TC-3", rel: ADR_T_REL, from: "- **A Supabase identity carries no kernel authority.** Sign-in reaches the cloud tables only.", to: "- A Supabase identity selects the tenant." },
  { name: "adr-drops-tenant-versus-domain", rule: "TC-3", rel: ADR_T_REL, from: "- **Tenant** = whose data and authority.\n", to: "" },
  { name: "adr-drops-trust-basis", rule: "TC-3", rel: ADR_T_REL, from: "- **Committed bytes only,** read from the installation's git object store at `HEAD` of the installation\n", to: "- Read from the installation\n" },
  { name: "adr-drops-self-hosted-rationale", rule: "TC-3", rel: ADR_T_REL, from: "- **For `projectos`, the installation is the project.**", to: "- **Self-hosting.**" },
  { name: "adr-hides-that-all-commits-are-murad", rule: "TC-3", rel: ADR_T_REL, from: "the name Murad, agent commits included.**", to: "the owner's name.**" },
  { name: "adr-overclaims-the-owner-check", rule: "TC-3", rel: ADR_T_REL, from: "protects nothing beyond repo write access", to: "protects the registry" },
  { name: "adr-unbacks-same-terms", rule: "TC-3", rel: ADR_T_REL, from: "the same terms: changing it is the P5 action `action-registry-change`, with a floor in code, and the", to: "the same terms, and the" },
  { name: "adr-claims-domains-were-decided", rule: "TC-3", rel: ADR_T_REL, from: "The domain on each registry line is the lead's reading of what the project is,\nnot an owner decision.", to: "D2 fixed the domains too." },
  { name: "adr-drops-principal-from-r3", rule: "TC-3", rel: ADR_T_REL, from: "`environment` and\n  `principal` (R3).", to: "and `environment` (R3)." },
  { name: "adr-any-listing-attaches", rule: "TC-3", rel: ADR_T_REL, from: "so one taken\n   anywhere else attaches nothing,", to: "so it should be\n   taken there," },
  { name: "adr-claims-allowlist-guards-release", rule: "TC-3", rel: ADR_T_REL, from: "only, not session release, so it does not cover this.", to: "and session release, so it covers this." },
  { name: "adr-worktree-may-release", rule: "TC-3", rel: ADR_T_REL, from: "**Worktree tenant identity alone must never", to: "**Worktree tenant identity may" },
  { name: "adr-closes-the-release-grant", rule: "TC-3", rel: ADR_T_REL, from: "**OPEN, the owner decides at PROJECTOS-TENANT-CREDENTIALS1A.**", to: "**Decided.**" },
  { name: "adr-hides-no-owner-step", rule: "TC-3", rel: ADR_T_REL, from: "release has no owner step today", to: "release is owner-gated today" },
  { name: "adr-drops-postgres-rule", rule: "TC-3", rel: ADR_T_REL, from: "- **Postgres is never authority.**", to: "- **Postgres.**" },
  { name: "adr-postgres-wins", rule: "TC-3", rel: ADR_T_REL, from: "disagree, the git registry wins,", to: "disagree, the cloud table wins," },
  { name: "adr-drops-roots-ruling", rule: "TC-3", rel: ADR_T_REL, from: "- **Boundary crossings are roots.**", to: "- **Boundaries.**" },
  { name: "adr-drops-run-link", rule: "TC-3", rel: ADR_T_REL, from: "`run:<envelopeId>` in its scope", to: "a note" },
  { name: "adr-keeps-broker-call-local", rule: "TC-3", rel: ADR_T_REL, from: "`broker-call` and `push` are `production`", to: "`broker-call` and `push` are `local`" },
  { name: "adr-worktree-trusts-itself", rule: "TC-3", rel: ADR_T_REL, from: "`git -C <governedRoot> worktree list --porcelain`", to: "`git rev-parse --git-common-dir` in the worktree" },
  { name: "adr-worktree-grants-spend", rule: "TC-3", rel: ADR_T_REL, from: "**It grants tenant identity and nothing else.**", to: "**It grants the registered root's full authority.**" },
  { name: "adr-drops-tenant-class", rule: "TC-3", rel: ADR_T_REL, from: "| **Tenant** | `ProjectOS/tenant.<tenantId>/…` |", to: "| **Tenant** | to be decided |" },
  { name: "adr-drops-platform-class", rule: "TC-3", rel: ADR_T_REL, from: "| Serves every tenant through the broker. Released to none |", to: "| Released as needed |" },
  { name: "adr-drops-project-class", rule: "TC-3", rel: ADR_T_REL, from: "| Inherits its project's tenant |", to: "| Free for any tenant |" },
  { name: "adr-drops-owner-sees-both-ruling", rule: "TC-3", rel: ADR_T_REL, from: "- **The owner sees both tenants.** One owner JWT and one owner desktop see both, by membership. That is\n  not a cross-tenant breach.", to: "- Owner access is out of scope." },
  { name: "adr-drops-service-role", rule: "TC-3", rel: ADR_T_REL, from: "- **The service role bypasses RLS entirely,** and so does any token that can reach it.", to: "- The service role is subject to RLS." },
  { name: "adr-drops-stop-work", rule: "TC-3", rel: ADR_T_REL, from: "- **Account-wide `stop-work`.**", to: "- **Stopping.**" },
  { name: "adr-drops-one-user-limit", rule: "TC-3", rel: ADR_T_REL, from: "- **One user.** Everything runs as one Windows user, for one owner, on one machine.", to: "- **Users.** Isolation is complete." },
  // TC-4
  { name: "adr-t1-accepts-itself", rule: "TC-4", rel: ADR_T_REL, from: "**Status:** PROPOSED in phase PROJECTOS-TENANT-CONTRACT1A", to: "**Status:** ACCEPTED in phase PROJECTOS-TENANT-CONTRACT1A" },
  // TC-5
  { name: "adr-k1-still-proposed", rule: "TC-5", rel: ADR_K_REL, from: "**Status:** ACCEPTED by the owner, 2026-11-01:", to: "**Status:** PROPOSED on 2026-11-01:" },
  { name: "adr-k1-names-no-owner-word", rule: "TC-5", rel: ADR_K_REL, from: "decision D3, \"Accept it (Recommended)\",", to: "accepted," },
  { name: "adr-k1-status-rule-dropped", rule: "TC-5", rel: ADR_K_REL, from: "**Only the owner marks an ADR Accepted.**", to: "" },
  // TC-6
  { name: "registry-moves-agency-to-owner", rule: "TC-6", rel: TREG_REL, from: "\"tenant\": \"agency-business\",", to: "\"tenant\": \"owner-personal\"," },
  { name: "registry-changes-a-domain", rule: "TC-6", rel: TREG_REL, from: "\"domain\": \"business\",", to: "\"domain\": \"develop\"," },
  { name: "registry-moves-a-root", rule: "TC-6", rel: TREG_REL, from: "\"governedRoot\": \"C:/dev/SEOAgency\",", to: "\"governedRoot\": \"C:/dev/ProjectOS-worktrees/seo\"," },
  { name: "registry-repository-not-canonical", rule: "TC-6", rel: TREG_REL, from: "\"repository\": \"github.com/polygonia-apres/polygo\",", to: "\"repository\": \"https://github.com/polygonia-apres/polygo.git\"," },
  { name: "registry-loses-polygo", rule: "TC-6", rel: TREG_REL, from: "\"projectId\": \"polygo\",", to: "\"projectId\": \"polygo-renamed\"," },
  // TC-7
  { name: "registry-duplicate-repository", rule: "TC-7", rel: TREG_REL, from: "\"repository\": \"github.com/polygonia-apres/polygo\",", to: "\"repository\": \"GitHub.com/universalbizcomply/ProjectOS\"," },
  { name: "registry-duplicate-root", rule: "TC-7", rel: TREG_REL, from: "\"governedRoot\": \"C:/dev/Polygo/polygo\",", to: "\"governedRoot\": \"c:/dev/PROJECTOS\"," },
  { name: "registry-duplicate-project", rule: "TC-7", rel: TREG_REL, from: "\"projectId\": \"polygo\",", to: "\"projectId\": \"ProjectOS\"," },
  { name: "registry-wildcard-root", rule: "TC-7", rel: TREG_REL, from: "\"governedRoot\": \"C:/dev/Polygo/polygo\",", to: "\"governedRoot\": \"C:/dev/*\"," },
  { name: "registry-wildcard-repository", rule: "TC-7", rel: TREG_REL, from: "\"repository\": \"github.com/polygonia-apres/polygo\",", to: "\"repository\": \"github.com/polygonia-apres/*\"," },
  { name: "registry-reserved-project-id", rule: "TC-7", rel: TREG_REL, from: "\"projectId\": \"seo-agency\",", to: "\"projectId\": \"Tenant.seo-agency\"," },
  { name: "registry-undeclared-tenant", rule: "TC-7", rel: TREG_REL, from: "\"tenantId\": \"agency-business\",", to: "\"tenantId\": \"agency\"," },
  { name: "registry-unknown-domain", rule: "TC-7", rel: TREG_REL, from: "\"domain\": \"business\",", to: "\"domain\": \"marketing\"," },
  { name: "registry-nested-root", rule: "TC-7", rel: TREG_REL, from: "\"governedRoot\": \"C:/dev/Polygo/polygo\",", to: "\"governedRoot\": \"C:/dev/ProjectOS/polygo\"," },
  // TC-8
  { name: "schema-tolerates-extra-project-fields", rule: "TC-8", rel: SCHEMA_REL, from: "\"additionalProperties\": false,\n        \"required\": [\n          \"projectId\",", to: "\"additionalProperties\": true,\n        \"required\": [\n          \"projectId\"," },
  { name: "schema-domain-enum-drifts", rule: "TC-8", rel: SCHEMA_REL, from: "\"personal\",\n              \"phone\"", to: "\"personal\"" },
  { name: "schema-tenant-pattern-drifts", rule: "TC-8", rel: SCHEMA_REL, from: "\"pattern\": \"^[a-z][a-z0-9-]{1,56}$\",\n            \"description\": \"At most 57", to: "\"pattern\": \"^.+$\",\n            \"description\": \"At most 57" },
  { name: "schema-allows-reserved-prefix", rule: "TC-8", rel: SCHEMA_REL, from: "\"not\": {\n              \"pattern\": \"^[Tt][Ee][Nn][Aa][Nn][Tt]\\\\.\"\n            },\n", to: "" },
  { name: "schema-root-pattern-drifts", rule: "TC-8", rel: SCHEMA_REL, from: "\"pattern\": \"^[A-Za-z]:(?:/[A-Za-z0-9_][A-Za-z0-9._ -]*)+$\",", to: "\"pattern\": \"^[A-Za-z]:/.*$\"," },
  { name: "schema-root-alias-dropped", rule: "TC-8", rel: SCHEMA_REL, from: "\"pattern\": \"[. ](/|$)\"", to: "\"pattern\": \"^$\"" },
  { name: "schema-repository-pattern-drifts", rule: "TC-8", rel: SCHEMA_REL, from: "|127\\\\.0\\\\.0\\\\.1:[0-9]{1,5})", to: "|[^/]+:[0-9]+)" },
  { name: "schema-allows-dot-git", rule: "TC-8", rel: SCHEMA_REL, from: "\"pattern\": \"\\\\.[Gg][Ii][Tt]$\"", to: "\"pattern\": \"^$\"" },
  { name: "code-root-rule-drifts-from-schema", rule: "TC-8", rel: TENANT_REL, from: String.raw`const GOVERNED_ROOT = /^[A-Za-z]:(?:\/[A-Za-z0-9_][A-Za-z0-9._ -]*)+$/;`, to: String.raw`const GOVERNED_ROOT = /^[A-Za-z]:(?:\/[A-Za-z0-9_~][A-Za-z0-9._ ~-]*)+$/;` },
  // TC-9
  { name: "trust-boundary-omits-tenant-registry", rule: "TC-9", rel: TRUST_REL, from: "\"tenantRegistry\": \"projectos/security/tenant-registry.json\",", to: "\"tenantRegistry\": \"\"," },
  { name: "trust-boundary-omits-action-registry", rule: "TC-9", rel: TRUST_REL, from: "\"actionRegistry\": \"projectos/security/action-registry.json\",", to: "\"actionRegistry\": \"\"," },
  { name: "trust-boundary-claims-enforcement", rule: "TC-9", rel: TRUST_REL, from: "so until then they declare the boundary and enforce nothing at run time.", to: "so the boundary is enforced." },
  // TC-10
  { name: "registry-loses-a-governance-spelling", rule: "TC-10", rel: AREG_REL, from: "\"id\": \"override_gate\",\n      \"governanceAction\": \"override_gate\",", to: "\"id\": \"override_gate\",\n      \"governanceAction\": null," },
  { name: "registry-loses-an-owner-only-spelling", rule: "TC-10", rel: AREG_REL, from: "\"id\": \"push\",\n      \"governanceAction\": null,\n      \"ownerOnlyAction\": \"push\",", to: "\"id\": \"push\",\n      \"governanceAction\": null,\n      \"ownerOnlyAction\": null," },
  { name: "registry-splits-phase-closure", rule: "TC-10", rel: AREG_REL, from: "\"id\": \"phase-closure\",\n      \"governanceAction\": \"close_phase\",", to: "\"id\": \"phase-closure\",\n      \"governanceAction\": null," },
  { name: "registry-invents-a-spelling", rule: "TC-10", rel: AREG_REL, from: "\"id\": \"run-start\",\n      \"governanceAction\": null,", to: "\"id\": \"run-start\",\n      \"governanceAction\": \"start_run\"," },
  { name: "governance-vocabulary-outgrows-registry", rule: "TC-10", rel: PERMISSIONS_REL, from: "  | 'rollback';", to: "  | 'rollback'\n  | 'wipe_all';" },
  { name: "owner-floor-outgrows-registry", rule: "TC-10", rel: OWNER_REL, from: "  'payment-or-live-charge',\n] as const;", to: "  'payment-or-live-charge',\n  'deploy',\n] as const;" },
  // TC-11
  lowered("cross-tenant-access-lowered", "TC-11", "cross-tenant-access", "null", "null", "P5", "P4"),
  lowered("tenant-registry-change-lowered", "TC-11", "tenant-registry-change", "null", "null", "P5", "P3"),
  { name: "cross-tenant-access-unlisted", rule: "TC-11", rel: AREG_REL, from: "\"id\": \"cross-tenant-access\",", to: "\"id\": \"cross-tenant-readonly\"," },
  lowered("action-registry-change-lowered", "TC-11", "action-registry-change", "null", "null", "P5", "P3"),
  // TC-12
  lowered("phase-closure-lowered", "TC-12", "phase-closure", "\"close_phase\"", "\"phase-closure\"", "P5", "P4"),
  lowered("secrets-handling-lowered", "TC-12", "secrets-handling", "null", "\"secrets-handling\"", "P5", "P3"),
  lowered("approve-lowered", "TC-12", "approve", "\"approve\"", "null", "P5", "P4"),
  lowered("commit-lowered", "TC-12", "commit", "null", "\"commit\"", "P3", "P2"),
  // TC-13
  { name: "action-registry-duplicate-spelling", rule: "TC-13", rel: AREG_REL, from: "\"id\": \"run-start\",", to: "\"id\": \"commit\"," },
  { name: "action-registry-wildcard", rule: "TC-13", rel: AREG_REL, from: "\"id\": \"run-start\",", to: "\"id\": \"run-*\"," },
  // TC-14
  { name: "tenant-reads-environment", rule: "TC-14", rel: TENANT_REL, from: "const entry = registry.projects.find((candidate) => candidate.projectId === checkout.projectId);", to: "const entry = registry.projects.find((candidate) => candidate.projectId === (process.env['PROJECTOS_PROJECT'] ?? checkout.projectId));" },
  { name: "tenant-imports-the-filesystem", rule: "TC-14", rel: TENANT_REL, from: "export const TENANT_REGISTRY_SCHEMA_VERSION", to: "import { readFileSync } from 'node:fs';\nexport const TENANT_REGISTRY_SCHEMA_VERSION" },
  { name: "envelope-reads-the-clock", rule: "TC-14", rel: ENVELOPE_REL, from: "const at = instantOf(now);", to: "const at = Date.now();" },
  { name: "action-registry-imports-a-module", rule: "TC-14", rel: ACTION_REL, from: "export const ACTION_REGISTRY_SCHEMA_VERSION", to: "import { execSync } from 'node:child_process';\nexport const ACTION_REGISTRY_SCHEMA_VERSION" },
  { name: "tenant-bare-import", rule: "TC-14", rel: TENANT_REL, from: "export const TENANT_REGISTRY_SCHEMA_VERSION", to: "import 'node:fs';\nexport const TENANT_REGISTRY_SCHEMA_VERSION" },
  { name: "tenant-dynamic-import", rule: "TC-14", rel: TENANT_REL, from: "export const TENANT_REGISTRY_SCHEMA_VERSION", to: "void import('./outside.js');\nexport const TENANT_REGISTRY_SCHEMA_VERSION" },
  { name: "tenant-reexport-from-a-module", rule: "TC-14", rel: TENANT_REL, from: "export const TENANT_REGISTRY_SCHEMA_VERSION", to: "export { readFileSync as read } from 'node:fs';\nexport const TENANT_REGISTRY_SCHEMA_VERSION" },
  { name: "tenant-reaches-process-by-bracket", rule: "TC-14", rel: TENANT_REL, from: "const entry = registry.projects.find((candidate) => candidate.projectId === checkout.projectId);", to: "const entry = registry.projects.find((candidate) => candidate.projectId === ((globalThis as unknown as Record<string, { env: Record<string, string> }>)['process']?.env['X'] ?? checkout.projectId));" },
  // TC-15
  { name: "registry-live-despite-problems", rule: "TC-15", rel: TENANT_REL, from: "  if (problems.length > 0) return { ok: false, problems };\n\n  const registry: TenantRegistry", to: "  const registry: TenantRegistry" },
  { name: "registry-skips-project-lines", rule: "TC-15", rel: TENANT_REL, from: "    ...(projects ?? []).flatMap((entry, index) => projectProblems(entry, index, new Set(tenantIds))),\n", to: "" },
  { name: "registry-skips-tenant-lines", rule: "TC-15", rel: TENANT_REL, from: "    ...(tenants ?? []).flatMap((entry, index) => tenantProblems(entry, index)),\n", to: "" },
  { name: "registry-skips-duplicates", rule: "TC-15", rel: TENANT_REL, from: "    ...duplicateProblems(projects ?? []),\n", to: "" },
  { name: "registry-any-schema-version", rule: "TC-15", rel: TENANT_REL, from: "  if (root['schemaVersion'] !== TENANT_REGISTRY_SCHEMA_VERSION) {", to: "  if (false) {" },
  { name: "registry-prose-optional", rule: "TC-15", rel: TENANT_REL, from: "    ...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map((field) => invalid(`the tenant registry has no ${field}`)),\n", to: "" },
  { name: "registry-never-marked-live", rule: "TC-15", rel: TENANT_REL, from: "  LIVE_REGISTRIES.add(registry);\n", to: "" },
  // TC-16
  { name: "wildcard-matches-nothing", rule: "TC-16", rel: TENANT_REL, from: "const WILDCARD = /[*?]/;", to: "const WILDCARD = /^$/;" },
  { name: "project-wildcard-falls-to-shape", rule: "TC-16", rel: TENANT_REL, from: "    if (WILDCARD.test(value)) {\n      problems.push({ code: 'TENANT_REGISTRY_WILDCARD', message: `${label} has a wildcard ${field}` });\n      continue;\n    }\n", to: "" },
  { name: "tenant-wildcard-falls-to-shape", rule: "TC-16", rel: TENANT_REL, from: "if (typeof id === 'string' && WILDCARD.test(id)) {", to: "if (false) {" },
  { name: "wildcard-scan-skips-repository", rule: "TC-16", rel: TENANT_REL, from: "const BINDING_FIELDS = ['projectId', 'repository', 'governedRoot', 'tenant', 'domain'] as const;", to: "const BINDING_FIELDS = ['projectId', 'tenant', 'domain'] as const;" },
  // TC-17
  { name: "duplicate-project-case-sensitive", rule: "TC-17", rel: TENANT_REL, from: "['projectId', asciiLower],", to: "['projectId', (value) => value]," },
  { name: "duplicate-ignores-repository", rule: "TC-17", rel: TENANT_REL, from: "    ['repository', asciiLower],\n", to: "" },
  { name: "duplicate-ignores-root", rule: "TC-17", rel: TENANT_REL, from: "    ['governedRoot', rootKey],\n", to: "" },
  { name: "duplicate-filter-keeps-nothing", rule: "TC-17", rel: TENANT_REL, from: ".filter((value, index) => values.indexOf(value) !== index)", to: ".filter(() => false)" },
  { name: "root-key-case-sensitive", rule: "TC-17", rel: TENANT_REL, from: "return asciiLower(path.split(String.fromCharCode(92)).join('/').replace(/\\/+$/, ''));", to: "return path;" },
  // TC-18
  { name: "reserved-prefix-case-sensitive", rule: "TC-18", rel: TENANT_REL, from: "return asciiLower(projectId).startsWith(TENANT_CREDENTIAL_PREFIX);", to: "return projectId.startsWith(TENANT_CREDENTIAL_PREFIX);" },
  { name: "reserved-prefix-never-matches", rule: "TC-18", rel: TENANT_REL, from: "return asciiLower(projectId).startsWith(TENANT_CREDENTIAL_PREFIX);", to: "return false;" },
  { name: "reserved-check-not-asked", rule: "TC-18", rel: TENANT_REL, from: "if (typeof projectId === 'string' && isReservedProjectId(projectId)) {", to: "if (false) {" },
  // TC-19
  { name: "unlisted-falls-to-first-project", rule: "TC-19", rel: TENANT_REL, from: "const entry = registry.projects.find((candidate) => candidate.projectId === checkout.projectId);", to: "const entry = registry.projects.find((candidate) => candidate.projectId === checkout.projectId) ?? registry.projects[0];" },
  { name: "unvalidated-registry-resolves", rule: "TC-19", rel: TENANT_REL, from: "if (!LIVE_REGISTRIES.has(registry)) {", to: "if (false) {" },
  // TC-20
  { name: "repository-not-compared", rule: "TC-20", rel: TENANT_REL, from: "if (checkout.repository === null || asciiLower(checkout.repository) !== asciiLower(entry.repository)) {", to: "if (checkout.repository === null) {" },
  { name: "no-origin-accepted", rule: "TC-20", rel: TENANT_REL, from: "if (checkout.repository === null || asciiLower(checkout.repository) !== asciiLower(entry.repository)) {", to: "if (checkout.repository !== null && asciiLower(checkout.repository) !== asciiLower(entry.repository)) {" },
  { name: "root-compare-always-true", rule: "TC-20", rel: TENANT_REL, from: "if (rootKey(entry.governedRoot) === rootKey(checkout.root)) return 'governed-root';", to: "return 'governed-root';" },
  { name: "route-refusal-removed", rule: "TC-20", rel: TENANT_REL, from: "  if (via === null) {\n    return {\n      ok: false,\n      code: 'TENANT_MISMATCH',", to: "  if (false) {\n    return {\n      ok: false,\n      code: 'TENANT_REGISTRY_INVALID'," },
  // TC-21
  { name: "linked-worktree-any-directory", rule: "TC-21", rel: TENANT_REL, from: "return attached ? 'linked-worktree' : null;", to: "return 'linked-worktree';" },
  { name: "linked-worktree-listing-not-matched", rule: "TC-21", rel: TENANT_REL, from: "const attached = listing.paths.some((path) => rootKey(path) === rootKey(checkout.root));", to: "const attached = listing.paths.length > 0;" },
  { name: "porcelain-keeps-the-root", rule: "TC-21", rel: TENANT_REL, from: "    if (rootKey(path) === rootKey(takenAtRoot)) return [];\n", to: "" },
  { name: "porcelain-keeps-prunable", rule: "TC-21", rel: TENANT_REL, from: "return lines.some((line) => line === 'prunable' || line.startsWith('prunable ')) ? [] : [path];", to: "return [path];" },
  { name: "asked-root-is-not-the-registered-one", rule: "TC-21", rel: TENANT_REL, from: "return registry.projects.find((entry) => entry.projectId === projectId)?.governedRoot ?? null;", to: "return projectId;" },
  { name: "allowlist-now-admits-linked-worktrees", rule: "TC-21", rel: ALLOWLIST_REL, from: "    const shape = checkoutShapeProblem(sys, governedRoot);", to: "    const shape = null as string | null;" },
  { name: "allowlist-shape-check-gutted", rule: "TC-21", rel: ALLOWLIST_REL, from: "      'credential-bearing projects in that shape are not supported and are refused'", to: "      'noted'" },
  // TC-22
  { name: "binding-brand-accepts-any-object", rule: "TC-22", rel: TENANT_REL, from: "return typeof value === 'object' && value !== null && LIVE_BINDINGS.has(value);", to: "return typeof value === 'object' && value !== null;" },
  { name: "binding-not-frozen", rule: "TC-22", rel: TENANT_REL, from: "const binding: TenantBinding = Object.freeze({ ...entry, via });", to: "const binding: TenantBinding = { ...entry, via };" },
  { name: "binding-never-branded", rule: "TC-22", rel: TENANT_REL, from: "  LIVE_BINDINGS.add(binding);\n", to: "" },
  { name: "mint-skips-the-brand", rule: "TC-22", rel: ENVELOPE_REL, from: "if (!isDerivedBinding(binding)) {", to: "if (false) {" },
  // TC-23
  { name: "envelope-field-dropped", rule: "TC-23", rel: ENVELOPE_REL, from: "  tenant: isTenantId,\n", to: "" },
  { name: "budget-field-dropped", rule: "TC-23", rel: ENVELOPE_REL, from: "  budget: (value) => Number.isSafeInteger(value) && (value as number) >= 0,\n", to: "" },
  { name: "missing-field-tolerated", rule: "TC-23", rel: ENVELOPE_REL, from: "if (!Object.hasOwn(record, field)) return [`the envelope has no ${field}`];", to: "if (!Object.hasOwn(record, field)) return [];" },
  { name: "unparseable-field-tolerated", rule: "TC-23", rel: ENVELOPE_REL, from: "return FIELD_CHECKS[field](record[field]) ? [] : [`the envelope's ${field} is unparseable`];", to: "return [];" },
  { name: "unknown-field-tolerated", rule: "TC-23", rel: ENVELOPE_REL, from: ".filter((key) => !(ENVELOPE_FIELDS as readonly string[]).includes(key))", to: ".filter(() => false)" },
  { name: "reasons-do-not-refuse", rule: "TC-23", rel: ENVELOPE_REL, from: "  if (reasons.length > 0) return refused('R1', reasons);\n", to: "" },
  { name: "any-envelope-version", rule: "TC-23", rel: ENVELOPE_REL, from: "envelopeVersion: (value) => value === ENVELOPE_VERSION,", to: "envelopeVersion: () => true," },
  { name: "expiry-any-date-text", rule: "TC-23", rel: ENVELOPE_REL, from: "return Number.isNaN(at) || new Date(at).toISOString() !== value ? null : at;", to: "return Number.isNaN(at) ? null : at;" },
  { name: "actor-any-object", rule: "TC-23", rel: ENVELOPE_REL, from: "return Object.keys(record).length === ACTOR_FIELDS.length && ACTOR_FIELDS.every((field) => nonBlank(record[field]));", to: "return true;" },
  { name: "blank-is-a-value", rule: "TC-23", rel: ENVELOPE_REL, from: "return typeof value === 'string' && value.trim() !== '';", to: "return typeof value === 'string';" },
  { name: "action-any-text", rule: "TC-23", rel: ENVELOPE_REL, from: "  action: isActionName,\n", to: "  action: nonBlank,\n" },
  { name: "action-name-shape-gutted", rule: "TC-23", rel: ACTION_REL, from: "return typeof value === 'string' && ACTION_ID.test(value);", to: "return typeof value === 'string';" },
  { name: "actor-shared-with-the-source", rule: "TC-23", rel: ENVELOPE_REL, from: "Object.freeze({ ...(record as unknown as TaskEnvelope), scope, actor })", to: "Object.freeze({ ...(record as unknown as TaskEnvelope), scope })" },
  { name: "expiry-never-expires", rule: "TC-23", rel: ENVELOPE_REL, from: "return expiry === null || at === null || expiry <= at;", to: "return false;" },
  { name: "sparse-scope-accepted", rule: "TC-23", rel: ENVELOPE_REL, from: "scope: (value) => Array.isArray(value) && [...value].every(nonBlank),", to: "scope: (value) => Array.isArray(value) && value.every(nonBlank)," },
  { name: "paid-action-needs-no-budget", rule: "TC-23", rel: ENVELOPE_REL, from: "...((PAID_ACTIONS as readonly unknown[]).includes(record['action']) && record['budget'] === 0", to: "...(false" },
  { name: "broker-call-not-paid", rule: "TC-23", rel: ACTION_REL, from: "export const PAID_ACTIONS = ['broker-call'] as const;", to: "export const PAID_ACTIONS = [] as const;" },
  // TC-24
  { name: "mint-spreads-the-request", rule: "TC-24", rel: ENVELOPE_REL, from: "    idempotencyKey: deriveIdempotencyKey({ tenant: binding.tenant, project: binding.projectId, action, subjectHash, intentScope }),\n  };", to: "    idempotencyKey: deriveIdempotencyKey({ tenant: binding.tenant, project: binding.projectId, action, subjectHash, intentScope }),\n    ...request,\n  };" },
  { name: "mint-takes-tenant-from-the-request", rule: "TC-24", rel: ENVELOPE_REL, from: "    tenant: binding.tenant,\n    domain: binding.domain,", to: "    tenant: (request as unknown as { tenant?: string }).tenant ?? binding.tenant,\n    domain: binding.domain," },
  { name: "mint-takes-class-from-the-request", rule: "TC-24", rel: ENVELOPE_REL, from: "    actionClass: resolved.actionClass,", to: "    actionClass: (request as unknown as { actionClass?: ActionClass }).actionClass ?? resolved.actionClass," },
  { name: "mint-takes-environment-from-the-context", rule: "TC-24", rel: ENVELOPE_REL, from: "    environment: resolved.environment,", to: "    environment: (context as unknown as { environment?: KernelEnvironment }).environment ?? resolved.environment," },
  { name: "request-type-gains-a-tenant", rule: "TC-24", rel: ENVELOPE_REL, from: "export interface EnvelopeRequest {\n  readonly action: string;", to: "export interface EnvelopeRequest {\n  readonly tenant?: string;\n  readonly action: string;" },
  { name: "mint-skips-the-registry", rule: "TC-24", rel: ENVELOPE_REL, from: "const resolved = resolveAction(registry, action);", to: "const resolved = { environment: 'local' as const, actionClass: 'P1' as const };" },
  { name: "idempotency-key-omits-tenant", rule: "TC-24", rel: ENVELOPE_REL, from: "const canonical = JSON.stringify([intent.tenant, intent.project, intent.action, intent.subjectHash, intent.intentScope]);", to: "const canonical = JSON.stringify([intent.project, intent.action, intent.subjectHash, intent.intentScope]);" },
  // TC-25
  { name: "child-tenant-not-compared", rule: "TC-25", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'environment', 'principal'] as const)", to: "...(['domain', 'project', 'environment', 'principal'] as const)" },
  { name: "child-domain-not-compared", rule: "TC-25", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'environment', 'principal'] as const)", to: "...(['tenant', 'project', 'environment', 'principal'] as const)" },
  { name: "child-project-not-compared", rule: "TC-25", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'environment', 'principal'] as const)", to: "...(['tenant', 'domain', 'environment', 'principal'] as const)" },
  { name: "child-environment-not-compared", rule: "TC-25", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'environment', 'principal'] as const)", to: "...(['tenant', 'domain', 'project', 'principal'] as const)" },
  { name: "child-principal-not-compared", rule: "TC-25", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'environment', 'principal'] as const)", to: "...(['tenant', 'domain', 'project', 'environment'] as const)" },
  { name: "child-equality-always-holds", rule: "TC-25", rel: ENVELOPE_REL, from: "down[field] === up[field] ? [] :", to: "true ? [] :" },
  { name: "child-lineage-not-compared", rule: "TC-25", rel: ENVELOPE_REL, from: "...(down.parentEnvelopeId === up.envelopeId ? [] :", to: "...(true ? [] :" },
  { name: "child-not-parsed", rule: "TC-25", rel: ENVELOPE_REL, from: "  if (!parsedChild.ok) return parsedChild;\n", to: "" },
  { name: "child-reasons-do-not-refuse", rule: "TC-25", rel: ENVELOPE_REL, from: "return reasons.length > 0 ? refused('R3', reasons) : parsedChild;", to: "return parsedChild;" },
  { name: "minted-child-not-checked", rule: "TC-25", rel: ENVELOPE_REL, from: "const result = parent === null ? parseEnvelope(candidate) : checkChildEnvelope(parent, candidate, registry);", to: "const result = parseEnvelope(candidate);" },
  // TC-26
  { name: "child-scope-widens", rule: "TC-26", rel: ENVELOPE_REL, from: "...down.scope.filter((item) => !up.scope.includes(item)).map(", to: "...down.scope.filter(() => false).map(" },
  { name: "child-budget-widens", rule: "TC-26", rel: ENVELOPE_REL, from: "...(down.budget <= up.budget ? [] :", to: "...(true ? [] :" },
  { name: "child-expiry-widens", rule: "TC-26", rel: ENVELOPE_REL, from: "...((instantOf(down.expiry) as number) <= (instantOf(up.expiry) as number) ? [] :", to: "...(true ? [] :" },
  { name: "child-class-widens", rule: "TC-26", rel: ENVELOPE_REL, from: "...(classAtMost(down.actionClass, up.actionClass) ? [] :", to: "...(true ? [] :" },
  { name: "class-order-gutted", rule: "TC-26", rel: ACTION_REL, from: "return childAt >= 0 && parentAt >= 0 && childAt <= parentAt;", to: "return true;" },
  { name: "class-order-reversed", rule: "TC-26", rel: ACTION_REL, from: "export const ACTION_CLASSES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;", to: "export const ACTION_CLASSES = ['P6', 'P5', 'P4', 'P3', 'P2', 'P1'] as const;" },
  // TC-27
  { name: "recorder-falsy-accepted", rule: "TC-27", rel: ENVELOPE_REL, from: "return recorder(record) === true;", to: "return recorder(record) !== false;" },
  { name: "recorder-throw-reads-as-written", rule: "TC-27", rel: ENVELOPE_REL, from: "  } catch {\n    return false;\n  }", to: "  } catch {\n    return true;\n  }" },
  { name: "minted-refusal-not-carried-to-the-door", rule: "TC-27", rel: ENVELOPE_REL, from: "  if (!minted.ok) return refuse(minted.rule, minted.reasons, null, null);\n", to: "  if (!minted.ok) return { admitted: false, rule: minted.rule, reasons: minted.reasons, recorded: false };\n" },
  { name: "unrecorded-admission-proceeds", rule: "TC-27", rel: ENVELOPE_REL, from: "if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })) {\n    return { admitted: false, rule: 'R4',", to: "recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] });\n  if (false) {\n    return { admitted: false, rule: 'R4'," },
  { name: "admitted-before-recorded", rule: "TC-27", rel: ENVELOPE_REL, from: "  if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })) {", to: "  if (minted.ok) return { admitted: true, envelope };\n  if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })) {" },
  { name: "refusal-not-recorded", rule: "TC-27", rel: ENVELOPE_REL, from: "const wrote = recorded(recorder, { ...at, outcome: 'refused', rule, envelope, registered: provenance?.registered ?? null, via: provenance?.via ?? null, reasons });", to: "const wrote = true;" },
  { name: "expiry-not-asked-at-admission", rule: "TC-27", rel: ENVELOPE_REL, from: "if (envelopeExpired(envelope, now)) return refuse('EXPIRED',", to: "if (false) return refuse('EXPIRED'," },
  { name: "class-asked-after-the-line-is-written", rule: "TC-27", rel: ENVELOPE_REL, from: "  const refusal = classRefusal(envelope, provenance, grant);\n  if (refusal !== null) return refuse(refusal.rule, refusal.reasons, envelope, provenance);\n  if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })) {\n    return { admitted: false, rule: 'R4', reasons: ['the admission could not be recorded, so the operation does not run'], recorded: false };\n  }\n", to: "  if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })) {\n    return { admitted: false, rule: 'R4', reasons: ['the admission could not be recorded, so the operation does not run'], recorded: false };\n  }\n  const refusal = classRefusal(envelope, provenance, grant);\n  if (refusal !== null) return refuse(refusal.rule, refusal.reasons, envelope, provenance);\n" },
  { name: "execution-record-reports-success", rule: "TC-27", rel: ENVELOPE_REL, from: "return recorded(recorder, { stage: 'execution', outcome, rule, envelope,", to: "void recorder;\n  return true || recorded(recorder, { stage: 'execution', outcome, rule, envelope," },
  // TC-28
  { name: "unregistered-action-is-p1", rule: "TC-28", rel: ACTION_REL, from: "export const UNREGISTERED_ACTION_CLASS: ActionClass = 'P5';", to: "export const UNREGISTERED_ACTION_CLASS: ActionClass = 'P1';" },
  { name: "unregistered-action-is-local", rule: "TC-28", rel: ACTION_REL, from: "export const UNREGISTERED_ACTION_ENVIRONMENT: KernelEnvironment = 'production';", to: "export const UNREGISTERED_ACTION_ENVIRONMENT: KernelEnvironment = 'local';" },
  { name: "unregistered-reads-as-registered", rule: "TC-28", rel: ACTION_REL, from: "? { action, registered: false, actionClass:", to: "? { action, registered: true, actionClass:" },
  { name: "unvalidated-registry-answers", rule: "TC-28", rel: ACTION_REL, from: "const entry = LIVE_REGISTRIES.get(registry)?.get(action);", to: "const entry = registry.actions.find((candidate) => candidate.id === action);" },
  { name: "lookup-folds-case", rule: "TC-28", rel: ACTION_REL, from: "const entry = LIVE_REGISTRIES.get(registry)?.get(action);", to: "const entry = LIVE_REGISTRIES.get(registry)?.get(action.trim().toLowerCase());" },
  { name: "registered-class-ignored", rule: "TC-28", rel: ACTION_REL, from: ": { action, registered: true, actionClass: entry.actionClass, environment: entry.environment };", to: ": { action, registered: true, actionClass: 'P1', environment: 'local' };" },
  // TC-29
  { name: "action-registry-live-despite-problems", rule: "TC-29", rel: ACTION_REL, from: "  if (problems.length > 0) return { ok: false, problems };\n\n  const entries", to: "  const entries" },
  { name: "action-floors-skipped", rule: "TC-29", rel: ACTION_REL, from: "    ...records.flatMap(floorProblems),\n", to: "" },
  { name: "action-duplicates-skipped", rule: "TC-29", rel: ACTION_REL, from: "    ...duplicateProblems(records),\n", to: "" },
  { name: "action-vocabulary-skipped", rule: "TC-29", rel: ACTION_REL, from: "    ...vocabularyProblems(records),\n", to: "" },
  { name: "action-entries-skipped", rule: "TC-29", rel: ACTION_REL, from: "    ...actions.flatMap((entry, index) => entryProblems(entry, index)),\n", to: "" },
  { name: "action-prose-optional", rule: "TC-29", rel: ACTION_REL, from: "    ...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map((field) => invalid(`the action registry has no ${field}`)),\n", to: "" },
  { name: "action-wildcard-matches-nothing", rule: "TC-29", rel: ACTION_REL, from: "const WILDCARD = /[*?]/;", to: "const WILDCARD = /^$/;" },
  { name: "action-wildcard-not-asked", rule: "TC-29", rel: ACTION_REL, from: "if (WILDCARD.test(spelling)) {", to: "if (false) {" },
  { name: "action-duplicate-filter-keeps-nothing", rule: "TC-29", rel: ACTION_REL, from: ".filter((spelling, index) => spellings.indexOf(spelling) !== index)", to: ".filter(() => false)" },
  { name: "absolute-floor-dropped", rule: "TC-29", rel: ACTION_REL, from: "    ...(spellings.some(isAbsolutelyOwnerOnly) ? lowered('P5', 'it is absolutely owner-only') : []),\n", to: "" },
  { name: "governance-floor-dropped", rule: "TC-29", rel: ACTION_REL, from: "    ...(spellings.some((spelling) => isOwnerOnly(spelling as GovernanceAction)) ? lowered('P5', 'it is an owner-only governance action') : []),\n", to: "" },
  { name: "owner-floor-dropped", rule: "TC-29", rel: ACTION_REL, from: "    ...(spellings.some((spelling) => (ALWAYS_OWNER_ONLY as readonly string[]).includes(spelling)) ? lowered(OWNER_ONLY_FLOOR, 'it is on the owner floor') : []),\n", to: "" },
  { name: "reserved-floor-allows-any-class", rule: "TC-29", rel: ACTION_REL, from: "(RESERVED_P5_ACTIONS as readonly string[]).includes(spelling)) && declared !== 'P5'", to: "(RESERVED_P5_ACTIONS as readonly string[]).includes(spelling)) && false" },
  { name: "floor-test-always-passes", rule: "TC-29", rel: ACTION_REL, from: "classAtMost(floor, declared) ? [] :", to: "true ? [] :" },
  { name: "owner-floor-lowered-in-code", rule: "TC-29", rel: ACTION_REL, from: "const OWNER_ONLY_FLOOR: ActionClass = 'P3';", to: "const OWNER_ONLY_FLOOR: ActionClass = 'P1';" },
  { name: "reserved-action-unlisted-in-code", rule: "TC-29", rel: ACTION_REL, from: "export const RESERVED_P5_ACTIONS = ['cross-tenant-access', 'tenant-registry-change', 'action-registry-change'] as const;", to: "export const RESERVED_P5_ACTIONS = ['cross-tenant-access', 'tenant-registry-change'] as const;" },
  // TC-30
  { name: "governance-vocabulary-copied-locally", rule: "TC-30", rel: ACTION_REL, from: "...vocabulary('governanceAction', actionsFor('owner'), 'permissions.ts'),", to: "...vocabulary('governanceAction', ['approve'], 'permissions.ts')," },
  { name: "owner-vocabulary-copied-locally", rule: "TC-30", rel: ACTION_REL, from: "...vocabulary('ownerOnlyAction', ALWAYS_OWNER_ONLY, 'ownerOnlyActions.ts'),", to: "...vocabulary('ownerOnlyAction', ['commit'], 'ownerOnlyActions.ts')," },
  { name: "vocabulary-check-one-directional", rule: "TC-30", rel: ACTION_REL, from: "      ...named.filter((spelling) => !known.includes(spelling)),\n", to: "" },
  { name: "reserved-presence-not-checked", rule: "TC-30", rel: ACTION_REL, from: "...[...RESERVED_P5_ACTIONS, ...BOUNDARY_ACTIONS].filter((action) => !ids.includes(action)).map(", to: "...RESERVED_P5_ACTIONS.filter((action) => !ids.includes(action)).map(" },
  // TC-31
  { name: "barrel-omits-tenant", rule: "TC-31", rel: BARREL_REL, from: "export * from './tenant.js';\n", to: "" },
  { name: "barrel-omits-action-registry", rule: "TC-31", rel: BARREL_REL, from: "export * from './actionRegistry.js';\n", to: "" },
  { name: "barrel-omits-envelope", rule: "TC-31", rel: BARREL_REL, from: "export * from './taskEnvelope.js';\n", to: "" },
  // TC-32
  { name: "validate-all-omits-this-validator", rule: "TC-32", rel: VA_REL, from: `  "${THIS_VALIDATOR}"`, to: `  "val-projectos-tenant-contract1a-disabled"` },
  { name: "cached-runner-omits-this-validator", rule: "TC-32", rel: CR_REL, from: `  "${THIS_VALIDATOR}"`, to: `  "val-projectos-tenant-contract1a-disabled"` },
  // TC-33
  { name: "trd-denies-engines-again", rule: "TC-33", rel: TRD_REL, from: "| Runtime | Node.js | `engines` `>=24.14.1 <25` (root, `agent`, `core`) |", to: "| Runtime | Node.js | (no `engines`) |" },
  { name: "baseline-denies-engines-again", rule: "TC-33", rel: BASE_REL, from: "`engines` pins `>=24.14.1 <25` in the root, `agent` and `core` manifests. There is no `.nvmrc` or `.node-version`.", to: "There is **no** `engines` field, `.nvmrc` or `.node-version`." },
  { name: "baseline-loses-the-tenant-records", rule: "TC-33", rel: BASE_REL, from: "10. **Tenant and domain.** See `docs/adr/ADR-T1-tenant-boundary.md`.", to: "10. See the ADRs." },
  { name: "baseline-count-of-record-dropped", rule: "TC-33", rel: BASE_REL, from: "so `validate-all.cjs` is the count of record", to: "so counts vary" },
  { name: "prd-loses-the-tenant-vocabulary", rule: "TC-33", rel: PRD_REL, from: "**Tenant vocabulary (plan v1.28;", to: "**Words (plan v1.28;" },
  { name: "prd-loses-the-hard-rule", rule: "TC-33", rel: PRD_REL, from: "No other party's data or\n  credentials go on this machine until Stage 4 isolation and service-held secrets are done (D4).", to: "Others may join when ready." },
  { name: "trd-loses-the-tenant-section", rule: "TC-33", rel: TRD_REL, from: "## 6. Tenant boundary (V4 Stage 2)", to: "## 6. Notes" },
  { name: "schema-doc-loses-tenant-registry", rule: "TC-33", rel: SCHEMADOC_REL, from: "| `projectos/security/tenant-registry.json` (installation record, not `.projectops/`) |", to: "| (removed) |" },
  { name: "schema-doc-loses-action-registry", rule: "TC-33", rel: SCHEMADOC_REL, from: "| `projectos/security/action-registry.json` (installation record, not `.projectops/`) |", to: "| (removed) |" },
  // TC-34
  { name: "door-takes-unbranded", rule: "TC-34", rel: ENVELOPE_REL, from: "if (provenance === undefined) return refuse('R2', ['this envelope was not minted or re-admitted by the kernel'], null, null);", to: "if (provenance === undefined) return { admitted: true, envelope };" },
  { name: "brand-never-set", rule: "TC-34", rel: ENVELOPE_REL, from: "  if (result.ok) LIVE_ENVELOPES.set(result.envelope, provenance);\n", to: "" },
  { name: "mint-does-not-brand", rule: "TC-34", rel: ENVELOPE_REL, from: "  return branded(result, { registered: resolved.registered, via: binding.via });\n}\n\n/**\n * Bring a persisted", to: "  return result;\n}\n\n/**\n * Bring a persisted" },
  { name: "parse-brands-its-output", rule: "TC-34", rel: ENVELOPE_REL, from: "  return { ok: true, envelope: Object.freeze({ ...(record as unknown as TaskEnvelope), scope, actor }) };", to: "  return branded({ ok: true, envelope: Object.freeze({ ...(record as unknown as TaskEnvelope), scope, actor }) }, { registered: true, via: 'governed-root' });" },
  { name: "forged-parent-accepted", rule: "TC-34", rel: ENVELOPE_REL, from: "if (parent !== null && !LIVE_ENVELOPES.has(parent)) {", to: "if (false) {" },
  { name: "readmit-takes-a-copied-binding", rule: "TC-34", rel: ENVELOPE_REL, from: "export function readmitEnvelope(raw: unknown, binding: TenantBinding, registry: ActionRegistry): EnvelopeResult {\n  if (!isDerivedBinding(binding)) {", to: "export function readmitEnvelope(raw: unknown, binding: TenantBinding, registry: ActionRegistry): EnvelopeResult {\n  if (false) {" },
  { name: "readmit-trusts-its-tenant", rule: "TC-34", rel: ENVELOPE_REL, from: "  const derived = {\n    tenant: binding.tenant,\n", to: "  const derived = {\n" },
  { name: "readmit-trusts-its-domain", rule: "TC-34", rel: ENVELOPE_REL, from: "    domain: binding.domain,\n    project: binding.projectId,\n    environment: resolved.environment,\n    actionClass: resolved.actionClass,\n  } as const;", to: "    project: binding.projectId,\n    environment: resolved.environment,\n    actionClass: resolved.actionClass,\n  } as const;" },
  { name: "readmit-trusts-its-project", rule: "TC-34", rel: ENVELOPE_REL, from: "    project: binding.projectId,\n    environment: resolved.environment,\n    actionClass: resolved.actionClass,\n  } as const;", to: "    environment: resolved.environment,\n    actionClass: resolved.actionClass,\n  } as const;" },
  { name: "readmit-trusts-its-environment", rule: "TC-34", rel: ENVELOPE_REL, from: "    environment: resolved.environment,\n    actionClass: resolved.actionClass,\n  } as const;", to: "    actionClass: resolved.actionClass,\n  } as const;" },
  { name: "readmit-trusts-its-class", rule: "TC-34", rel: ENVELOPE_REL, from: "    actionClass: resolved.actionClass,\n  } as const;", to: "  } as const;" },
  { name: "readmit-compare-always-holds", rule: "TC-34", rel: ENVELOPE_REL, from: "envelope[field] === derived[field] ? [] :", to: "true ? [] :" },
  { name: "readmit-reasons-do-not-refuse", rule: "TC-34", rel: ENVELOPE_REL, from: "return reasons.length > 0 ? refused('R2', reasons) : branded(parsed,", to: "return branded(parsed," },
  { name: "readmit-derives-from-the-record", rule: "TC-34", rel: ENVELOPE_REL, from: "const resolved = resolveAction(registry, envelope.action);", to: "const resolved = { environment: envelope.environment, actionClass: envelope.actionClass, registered: true };" },
  { name: "child-class-not-rederived", rule: "TC-34", rel: ENVELOPE_REL, from: "...(down.actionClass === resolved.actionClass ? [] :", to: "...(true ? [] :" },
  { name: "child-environment-not-rederived", rule: "TC-34", rel: ENVELOPE_REL, from: "...(down.environment === resolved.environment ? [] :", to: "...(true ? [] :" },
  { name: "child-derives-from-itself", rule: "TC-34", rel: ENVELOPE_REL, from: "const resolved = resolveAction(registry, down.action);", to: "const resolved = { actionClass: down.actionClass, environment: down.environment };" },
  // TC-35
  { name: "p6-reaches-the-port", rule: "TC-35", rel: ENVELOPE_REL, from: "  if (actionClass === 'P6') return { rule: 'P6_PROHIBITED', reasons: [`'${action}' is P6: nobody may authorise it, ever`] };\n", to: "" },
  { name: "port-asked-before-p6", rule: "TC-35", rel: ENVELOPE_REL, from: "  if (actionClass === 'P6') return { rule: 'P6_PROHIBITED',", to: "  if (actionClass === 'P5' && !granted(grant, envelope)) return { rule: 'P5_NO_GRANT', reasons: [] };\n  if (actionClass === 'P6') return { rule: 'P6_PROHIBITED'," },
  { name: "unregistered-reaches-the-port", rule: "TC-35", rel: ENVELOPE_REL, from: "  if (!provenance.registered) return { rule: 'UNREGISTERED_ACTION', reasons: [`'${action}' is not in the action registry`] };\n", to: "" },
  { name: "p4-reaches-the-door", rule: "TC-35", rel: ENVELOPE_REL, from: "  if (actionClass === 'P4') return { rule: 'P4_NO_GRANT', reasons: [`'${action}' is P4, and no P4 grant exists yet (ADR-K1 §4)`] };\n", to: "" },
  { name: "p5-needs-no-grant", rule: "TC-35", rel: ENVELOPE_REL, from: "if (actionClass === 'P5' && !granted(grant, envelope)) return", to: "if (false) return" },
  { name: "grant-truthy-accepted", rule: "TC-35", rel: ENVELOPE_REL, from: "return grant(envelope) === true;", to: "return grant(envelope) !== false;" },
  { name: "grant-throw-reads-as-granted", rule: "TC-35", rel: ENVELOPE_REL, from: "return grant(envelope) === true;\n  } catch {\n    return false;", to: "return grant(envelope) === true;\n  } catch {\n    return true;" },
  { name: "class-refusal-ignored", rule: "TC-35", rel: ENVELOPE_REL, from: "  if (refusal !== null) return refuse(refusal.rule, refusal.reasons, envelope, provenance);\n", to: "" },
  { name: "allowed-line-omits-provenance", rule: "TC-35", rel: ENVELOPE_REL, from: "outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })", to: "outcome: 'allowed', rule: null, envelope, registered: null, via: null, reasons: [] })" },
  { name: "refusal-line-omits-provenance", rule: "TC-35", rel: ENVELOPE_REL, from: "registered: provenance?.registered ?? null, via: provenance?.via ?? null, reasons });", to: "registered: null, via: null, reasons });" },
  { name: "execution-line-omits-provenance", rule: "TC-35", rel: ENVELOPE_REL, from: "registered: provenance?.registered ?? null, via: provenance?.via ?? null, reasons: [], at: now });", to: "registered: null, via: null, reasons: [], at: now });" },
  { name: "envelope-gains-a-registered-field", rule: "TC-35", rel: ENVELOPE_REL, from: "  readonly idempotencyKey: string;\n}", to: "  readonly idempotencyKey: string;\n  readonly registered: boolean;\n}" },
  { name: "envelope-gains-a-via-field", rule: "TC-35", rel: ENVELOPE_REL, from: "  readonly idempotencyKey: string;\n}", to: "  readonly idempotencyKey: string;\n  readonly via: string;\n}" },
  // TC-36
  { name: "crossing-may-be-a-child", rule: "TC-36", rel: ENVELOPE_REL, from: "...(isBoundaryAction(down.action) ? [", to: "...(false ? [" },
  { name: "boundary-test-always-false", rule: "TC-36", rel: ACTION_REL, from: "return BOUNDARY_ACTIONS.includes(action);", to: "return false;" },
  { name: "run-link-omits-tenant", rule: "TC-36", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'principal'] as const)", to: "...(['domain', 'project', 'principal'] as const)" },
  { name: "run-link-omits-domain", rule: "TC-36", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'principal'] as const)", to: "...(['tenant', 'project', 'principal'] as const)" },
  { name: "run-link-omits-project", rule: "TC-36", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'principal'] as const)", to: "...(['tenant', 'domain', 'principal'] as const)" },
  { name: "run-link-omits-principal", rule: "TC-36", rel: ENVELOPE_REL, from: "...(['tenant', 'domain', 'project', 'principal'] as const)", to: "...(['tenant', 'domain', 'project'] as const)" },
  { name: "run-link-scope-unchecked", rule: "TC-36", rel: ENVELOPE_REL, from: "...(down.scope.includes(link) ? [] :", to: "...(true ? [] :" },
  { name: "run-link-accepts-a-child", rule: "TC-36", rel: ENVELOPE_REL, from: "...(down.parentEnvelopeId === null ? [] :", to: "...(true ? [] :" },
  { name: "run-link-to-anything", rule: "TC-36", rel: ENVELOPE_REL, from: "...(up.action === RUN_ACTION ? [] :", to: "...(true ? [] :" },
  { name: "run-link-reasons-dropped", rule: "TC-36", rel: ENVELOPE_REL, from: "return reasons.length > 0 ? { ok: false, rule: 'RUN_LINK', reasons } : { ok: true };", to: "return { ok: true };" },
  { name: "run-link-crossing-not-parsed", rule: "TC-36", rel: ENVELOPE_REL, from: "  if (!parsedCrossing.ok) return { ok: false, rule: 'R1', reasons: parsedCrossing.reasons };\n", to: "" },
  { name: "run-link-scope-any-text", rule: "TC-36", rel: ENVELOPE_REL, from: "return `run:${runEnvelopeId}`;", to: "return 'run';" },
  // TC-37
  { name: "root-admits-any-text", rule: "TC-37", rel: TENANT_REL, from: String.raw`const GOVERNED_ROOT = /^[A-Za-z]:(?:\/[A-Za-z0-9_][A-Za-z0-9._ -]*)+$/;`, to: String.raw`const GOVERNED_ROOT = /^[A-Za-z]:\/[^\\]*$/;` },
  { name: "root-alias-not-asked", rule: "TC-37", rel: TENANT_REL, from: "return GOVERNED_ROOT.test(value) && !GOVERNED_ROOT_ALIAS.test(value) ? null :", to: "return GOVERNED_ROOT.test(value) ? null :" },
  { name: "repository-admits-any-segments", rule: "TC-37", rel: TENANT_REL, from: String.raw`const REPOSITORY = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|127\.0\.0\.1:[0-9]{1,5})\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;`, to: String.raw`const REPOSITORY = /^[^\s/]+\/[^\s/]+\/\S+$/;` },
  { name: "repository-admits-any-port", rule: "TC-37", rel: TENANT_REL, from: String.raw`|127\.0\.0\.1:[0-9]{1,5})`, to: String.raw`|[A-Za-z0-9.-]+:[0-9]{1,5})` },
  { name: "repository-keeps-git-suffix", rule: "TC-37", rel: TENANT_REL, from: "return REPOSITORY.test(value) && !REPOSITORY_SUFFIX.test(value) ? null :", to: "return REPOSITORY.test(value) ? null :" },
  { name: "ascii-lower-folds-unicode", rule: "TC-37", rel: TENANT_REL, from: "return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));", to: "return text.toLowerCase();" },
  { name: "repository-compare-folds-unicode", rule: "TC-37", rel: TENANT_REL, from: "asciiLower(checkout.repository) !== asciiLower(entry.repository)", to: "checkout.repository.toLowerCase() !== entry.repository.toLowerCase()" },
  // TC-38
  { name: "listing-from-anywhere-attaches", rule: "TC-38", rel: TENANT_REL, from: "if (listing === null || rootKey(listing.takenAtRoot) !== rootKey(entry.governedRoot)) return null;", to: "if (listing === null) return null;" },
  { name: "checkout-under-foreign-root-allowed", rule: "TC-38", rel: TENANT_REL, from: "  if (foreign !== undefined) {\n    return {\n      ok: false,\n      code: 'TENANT_MISMATCH',", to: "  if (false) {\n    return {\n      ok: false,\n      code: 'TENANT_MISMATCH'," },
  { name: "at-or-under-drops-the-slash", rule: "TC-38", rel: TENANT_REL, from: "return path === root || path.startsWith(`${root}/`);", to: "return path.startsWith(root);" },
  { name: "nested-roots-not-judged", rule: "TC-38", rel: TENANT_REL, from: ".filter((root) => roots.some((other) => other !== root && isAtOrUnder(root, other)))", to: ".filter(() => false)" },
  { name: "listing-loses-its-root", rule: "TC-38", rel: TENANT_REL, from: "export interface WorktreeListing {\n  readonly takenAtRoot: string;\n", to: "export interface WorktreeListing {\n" },
  { name: "registry-skips-nested-roots", rule: "TC-15", rel: TENANT_REL, from: "    ...nestedRootProblems(projects ?? []),\n", to: "" },
  // TC-39
  { name: "table-broker-call-back-to-local", rule: "TC-39", rel: AREG_REL, from: "\"class\": \"P3\",\n      \"environment\": \"production\",\n      \"note\": \"Stage 2 envelope boundary: a paid provider call", to: "\"class\": \"P3\",\n      \"environment\": \"local\",\n      \"note\": \"Stage 2 envelope boundary: a paid provider call" },
  { name: "table-push-back-to-local", rule: "TC-39", rel: AREG_REL, from: "\"class\": \"P3\",\n      \"environment\": \"production\",\n      \"note\": \"production because it writes to the shared remote", to: "\"class\": \"P3\",\n      \"environment\": \"local\",\n      \"note\": \"production because it writes to the shared remote" },
  lowered("table-run-start-raised", "TC-39", "run-start", "null", "null", "P2", "P3"),
  lowered("table-bridge-read-raised", "TC-39", "bridge-read", "null", "null", "P1", "P2"),
  { name: "table-gains-an-action", rule: "TC-39", rel: AREG_REL, from: "\"id\": \"bridge-read\",", to: "\"id\": \"bridge-write\"," },
  // TC-40
  { name: "boundary-floors-not-applied", rule: "TC-40", rel: ACTION_REL, from: "    ...BOUNDARY_FLOORS.filter(([action]) => spellings.includes(action)).flatMap(([, floor]) => lowered(floor, 'it is a boundary action')),\n", to: "" },
  { name: "credential-release-floor-lowered-in-code", rule: "TC-40", rel: ACTION_REL, from: "  ['credential-release', 'P5'],\n", to: "  ['credential-release', 'P1'],\n" },
  { name: "broker-call-floor-lowered-in-code", rule: "TC-40", rel: ACTION_REL, from: "  ['broker-call', 'P3'],\n", to: "  ['broker-call', 'P1'],\n" },
  { name: "run-start-floor-lowered-in-code", rule: "TC-40", rel: ACTION_REL, from: "  ['run-start', 'P2'],\n", to: "  ['run-start', 'P1'],\n" },
  // TC-T
  { name: "a-proof-skipped", rule: "TC-T", rel: "projectos/core/test/task-envelope.test.ts", from: "  it('a complete envelope parses: the positive control', () => {", to: "  it.skip('a complete envelope parses: the positive control', () => {" },
  { name: "a-proof-isolated", rule: "TC-T", rel: "projectos/core/test/tenant.test.ts", from: "  it('refuses an unlisted project by name, and never defaults to the owner', () => {", to: "  it.only('refuses an unlisted project by name, and never defaults to the owner', () => {" },
  { name: "a-table-skipped", rule: "TC-T", rel: "projectos/core/test/action-registry.test.ts", from: "  it.each(['cross-tenant-access', 'tenant-registry-change', 'action-registry-change'])('%s is registered as P5', (action) => {", to: "  it.skip.each(['cross-tenant-access', 'tenant-registry-change', 'action-registry-change'])('%s is registered as P5', (action) => {" },
  { name: "a-suite-skipped", rule: "TC-T", rel: "projectos/core/test/tenant-contract-review.test.ts", from: "describe('HIGH 1: envelope provenance', () => {", to: "describe.skip('HIGH 1: envelope provenance', () => {" },
  { name: "a-proof-deleted", rule: "TC-T", rel: "projectos/core/test/tenant-contract-review.test.ts", from: "the forged full-shape envelope the reviewer built is refused at the door, and recorded", to: "a nice test" },
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
}

/** Strip comments outside strings: the same walk `val-projectos-kernel-cost-cap1a` uses. */
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

/** A function's text from its declaration to the next top-level declaration. */
function fnSpan(text, name) {
  const start = text.search(new RegExp(String.raw`(export )?function ${name}\(`));
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.search(/\n(export )?(function |const [A-Za-z_]+\b|type |interface |declare )/);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

/** ADR prose with line wrapping and emphasis gone, so a limit is judged by what it says. */
const prose = (text) => text.replace(/\*\*/g, "").replace(/\s+/g, " ");

function jsonOf(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const rootKey = (p) => p.split(String.fromCharCode(92)).join("/").replace(/\/+$/, "").toLowerCase();

/** The list between `const MODULES = [` and its closing bracket, comments already stripped. */
function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  if (start < 0) return null;
  const end = text.indexOf("\n];", start);
  return end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function pinText(src, { rel, fn }) {
  return fn === null ? src[rel] : fnSpan(src[rel], fn);
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  const src = {};
  for (const rel of ALL_SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("TC-0", `${rel} is missing`);
      return errors;
    }
    src[rel] = rel.endsWith(".ts") ? code(raw[rel]) : raw[rel];
  }
  const adrT = prose(raw[ADR_T_REL]);
  const adrK = prose(raw[ADR_K_REL]);

  // TC-1: every limit in "What Stage 2 does not prove", in ADR-T1 itself.
  for (const [key, limit] of Object.entries(LIMITS)) {
    if (!adrT.includes(limit)) E("TC-1", `ADR-T1 no longer states the limit '${key}'`);
  }
  if (!adrT.includes("## 10. What Stage 2 does not prove")) E("TC-1", "ADR-T1 has no section on what Stage 2 does not prove");
  // TC-2: the owner's hard rule, verbatim, and no exit proof lifts it.
  if (!adrT.includes(HARD_RULE) || !adrT.includes("A green exit proof does not lift it:")) {
    E("TC-2", "ADR-T1 no longer states the owner's hard rule in full");
  }
  // TC-3: the rulings the delta requires.
  for (const [key, ruling] of Object.entries(RULINGS)) {
    if (!adrT.includes(ruling)) E("TC-3", `ADR-T1 no longer rules on '${key}'`);
  }
  // TC-4: only the owner marks an ADR Accepted.
  if (!adrT.includes("Status: PROPOSED in phase PROJECTOS-TENANT-CONTRACT1A") || !adrT.includes("Only the owner marks an ADR Accepted.")) {
    E("TC-4", "ADR-T1 no longer stays Proposed until the owner accepts it");
  }
  // TC-5: ADR-K1 is Accepted on the owner's word, and says whose word.
  if (!adrK.includes("Status: ACCEPTED by the owner, 2026-11-01: decision D3, \"Accept it (Recommended)\", recorded in `docs/changes/delta_spec.md`.") ||
      !adrK.includes("Only the owner marks an ADR Accepted.")) {
    E("TC-5", "ADR-K1's status no longer cites the owner's decision D3");
  }

  // TC-6: the three bindings are exactly what the owner decided.
  const treg = jsonOf(raw[TREG_REL]);
  const projects = treg !== null && Array.isArray(treg.projects) ? treg.projects : null;
  if (projects === null) {
    E("TC-6", "the tenant registry does not parse or has no projects list");
  } else {
    for (const want of BINDINGS) {
      const entry = projects.find((p) => p.projectId === want.projectId);
      const same = entry !== undefined && Object.keys(want).every((k) => entry[k] === want[k]);
      if (!same) E("TC-6", `the registry's binding for '${want.projectId}' is not the one the owner decided (D2)`);
    }
    // TC-7: the committed file would pass the reader's whole-file rules. Checked here too, so a broken
    // record fails before any reader exists to refuse it.
    const tenantIds = Array.isArray(treg.tenants) ? treg.tenants.map((t) => t.tenantId) : [];
    const domains = (/export const DOMAINS = \[([^\]]*)\] as const;/.exec(src[TENANT_REL]) || [, ""])[1];
    const domainList = [...domains.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    const seen = new Set();
    for (const p of projects) {
      for (const [field, key] of [["projectId", (v) => v.toLowerCase()], ["repository", (v) => v.toLowerCase()], ["governedRoot", rootKey]]) {
        const value = `${field}:${key(String(p[field]))}`;
        if (seen.has(value)) E("TC-7", `the tenant registry has a duplicate ${field}: ${p[field]}`);
        seen.add(value);
      }
      for (const field of ["projectId", "repository", "governedRoot", "tenant", "domain"]) {
        if (/[*?]/.test(String(p[field]))) E("TC-7", `the tenant registry has a wildcard ${field}`);
      }
      if (String(p.projectId).toLowerCase().startsWith("tenant.")) E("TC-7", `the project id '${p.projectId}' uses the reserved prefix`);
      if (!tenantIds.includes(p.tenant)) E("TC-7", `the project '${p.projectId}' names an undeclared tenant`);
      if (!domainList.includes(p.domain)) E("TC-7", `the project '${p.projectId}' names an unknown domain`);
    }
    const roots = projects.map((p) => rootKey(String(p.governedRoot)));
    if (roots.some((root) => roots.some((other) => other !== root && root.startsWith(`${other}/`)))) {
      E("TC-7", "the tenant registry has a governedRoot inside another entry's root");
    }

    // TC-8: the schema describes the registry the code enforces.
    const schema = jsonOf(raw[SCHEMA_REL]);
    const items = schema?.properties?.projects?.items;
    const tenantItems = schema?.properties?.tenants?.items;
    // The schema's patterns are the code's regexes, so neither can drift away from the other.
    const literal = (name) => {
      const found = new RegExp(String.raw`const ${name} = /(.+)/;`).exec(src[TENANT_REL]);
      return found === null ? null : found[1].replace(/\\\//g, "/");
    };
    const tenantPin = literal("TENANT_ID");
    if (schema === null || schema.additionalProperties !== false || items?.additionalProperties !== false || tenantItems?.additionalProperties !== false ||
        JSON.stringify(items?.properties?.domain?.enum) !== JSON.stringify(domainList) ||
        tenantItems?.properties?.tenantId?.pattern !== tenantPin || items?.properties?.tenant?.pattern !== tenantPin ||
        items?.properties?.projectId?.pattern !== literal("PROJECT_ID") || items?.properties?.projectId?.not?.pattern === undefined ||
        items?.properties?.governedRoot?.pattern !== literal("GOVERNED_ROOT") || items?.properties?.governedRoot?.not?.pattern !== literal("GOVERNED_ROOT_ALIAS") ||
        items?.properties?.repository?.pattern !== literal("REPOSITORY") || items?.properties?.repository?.not?.pattern !== literal("REPOSITORY_SUFFIX") ||
        !["projectId", "repository", "governedRoot", "tenant", "domain"].every((f) => items?.required?.includes(f))) {
      E("TC-8", "the tenant registry schema no longer agrees with the rules in tenant.ts");
    }
  }

  // TC-9: both records are listed in the trust boundary, and the listing is honest about today.
  const trust = jsonOf(raw[TRUST_REL]);
  const records = trust?.installationRecords;
  if (records?.tenantRegistry !== TREG_REL || records?.actionRegistry !== AREG_REL ||
      !String(records?.note).includes("they declare the boundary and enforce nothing at run time")) {
    E("TC-9", "the trust boundary does not list both records, or claims they are enforced today");
  }

  // TC-10..13: the committed action registry against the two vocabularies where they live.
  const areg = jsonOf(raw[AREG_REL]);
  const actions = areg !== null && Array.isArray(areg.actions) ? areg.actions : null;
  if (actions === null) {
    E("TC-10", "the action registry does not parse or has no actions list");
  } else {
    const governance = [...(/export type GovernanceAction =([\s\S]*?);/.exec(src[PERMISSIONS_REL]) || [, ""])[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const ownerOnly = [...(/export const ALWAYS_OWNER_ONLY = \[([\s\S]*?)\] as const;/.exec(src[OWNER_REL]) || [, ""])[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    const named = (column) => actions.map((a) => a[column]).filter((v) => typeof v === "string").sort();
    if (governance.length === 0 || ownerOnly.length === 0 ||
        JSON.stringify(named("governanceAction")) !== JSON.stringify([...governance].sort()) ||
        JSON.stringify(named("ownerOnlyAction")) !== JSON.stringify([...ownerOnly].sort()) ||
        !actions.some((a) => a.governanceAction === "close_phase" && a.ownerOnlyAction === "phase-closure")) {
      E("TC-10", "the action registry does not name exactly the two vocabularies, with close_phase and phase-closure as one action");
    }
    const entry = (spelling) => actions.find((a) => a.id === spelling || a.governanceAction === spelling || a.ownerOnlyAction === spelling);
    for (const id of RESERVED_ACTIONS) {
      if (entry(id)?.class !== "P5") E("TC-11", `the tenant action '${id}' is not registered as P5`);
    }
    for (const [spelling, cls] of Object.entries(CLASS_OF)) {
      if (entry(spelling)?.class !== cls) E("TC-12", `'${spelling}' is not ${cls}, the class ADR-K1 gives it`);
    }
    const spellings = actions.flatMap((a) => [...new Set([a.id, a.governanceAction, a.ownerOnlyAction].filter((v) => typeof v === "string"))]);
    if (new Set(spellings).size !== spellings.length) E("TC-13", "the action registry gives one spelling more than one entry");
    if (spellings.some((s) => /[*?]/.test(s))) E("TC-13", "the action registry has a wildcard spelling");
    // TC-39: the full table, both directions, so a new line is as deliberate as a changed one.
    const table = Object.fromEntries(actions.map((a) => [a.id, `${a.class}/${a.environment}`]));
    for (const [id, want] of Object.entries(ACTION_TABLE)) {
      if (table[id] !== want) E("TC-39", `the action '${id}' is ${table[id]}, and the pinned table says ${want}`);
    }
    for (const id of Object.keys(table)) {
      if (!(id in ACTION_TABLE)) E("TC-39", `the action '${id}' is not in the pinned table`);
    }
  }

  // TC-14: the pure modules stay pure.
  for (const [rel, allowed] of Object.entries(PURITY)) {
    const imports = SPECIFIERS.flatMap((pattern) => [...src[rel].matchAll(pattern)].map((m) => m[1]));
    const foreign = imports.filter((name) => !allowed.includes(name));
    if (foreign.length > 0) E("TC-14", `${rel} imports ${foreign.join(", ")}, and is pure`);
    if (IMPURE.test(src[rel])) E("TC-14", `${rel} reaches outside itself: ${IMPURE.exec(src[rel])[0]}`);
  }

  // TC-15..31: the rules' own bodies.
  for (const { rule, says, pins, order } of RULES) {
    for (const pin of pins) {
      if (!pinText(src, pin).includes(pin.pin)) E(rule, `${says} (${pin.rel}${pin.fn === null ? "" : ` ${pin.fn}`})`);
    }
    if (order !== undefined) {
      const at = order.map((pin) => pinText(src, pin).indexOf(pin.pin));
      if (at.some((i) => i < 0) || at.some((i, k) => k > 0 && i < at[k - 1])) E(rule, `${says} (the order changed)`);
    }
  }
  if ((fnSpan(src[ENVELOPE_REL], "admitEnvelope").match(/return \{ admitted: true/g) || []).length !== 1) {
    E("TC-27", "an operation can proceed without its admission being recorded (R4) (a second way to admit)");
  }
  // TC-34 (one way to brand): only `branded` marks an envelope, and parsing never does.
  if ((src[ENVELOPE_REL].match(/LIVE_ENVELOPES\.set\(/g) || []).length !== 1 || fnSpan(src[ENVELOPE_REL], "parseEnvelope").includes("branded(")) {
    E("TC-34", "something other than a mint or a re-admission can brand an envelope");
  }
  // TC-35 (no new field): `registered` and `via` stay on the record line. ADR-K1 was accepted by the owner.
  const envelopeType = /export interface TaskEnvelope \{([\s\S]*?)\n\}/.exec(src[ENVELOPE_REL]);
  if (envelopeType === null || /\b(registered|via)\b/.test(envelopeType[1])) E("TC-35", "the envelope gained a field the owner did not accept");
  // TC-37 (no Unicode folding): U+212A lowercases to `k`.
  if (UNICODE_FOLDING.test(src[TENANT_REL])) E("TC-37", "tenant.ts folds case through Unicode, so a non-ASCII spelling can equal a registered one");
  // TC-22 (one way to brand): the module's only `.add` for a binding is inside `resolveTenant`.
  if ((src[TENANT_REL].match(/LIVE_BINDINGS\.add\(/g) || []).length !== 1 || (src[TENANT_REL].match(/LIVE_REGISTRIES\.add\(/g) || []).length !== 1) {
    E("TC-22", "a second place can brand a binding or a registry");
  }
  // TC-24 (no way in): nothing the caller fills can name a tenant, and mint never spreads or casts its inputs.
  if (MINT_FORBIDDEN.test(fnSpan(src[ENVELOPE_REL], "mintEnvelope"))) E("TC-24", "mintEnvelope reads more of its inputs than the named fields");
  const requestType = /export interface EnvelopeRequest \{([\s\S]*?)\n\}/.exec(src[ENVELOPE_REL]);
  if (requestType === null || REQUEST_TYPE_FORBIDDEN.test(requestType[1])) E("TC-24", "EnvelopeRequest declares something only the kernel may decide");
  // TC-23 (the field list): the sixteen fields of the contract, each with a check.
  const fields = /const FIELD_CHECKS:.* = \{\n([\s\S]*?)\n\};/.exec(src[ENVELOPE_REL]);
  const declared = fields === null ? [] : [...fields[1].matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]);
  const required = ["envelopeVersion", "envelopeId", "parentEnvelopeId", "principal", "actor", "tenant", "domain", "project", "environment", "action", "actionClass", "subjectHash", "scope", "budget", "expiry", "idempotencyKey"];
  if (JSON.stringify(declared) !== JSON.stringify(required)) E("TC-23", "FIELD_CHECKS no longer covers exactly the sixteen envelope fields");

  // TC-32: registered in both runners, by the same rule FU-6 enforces for all of them.
  for (const [rel, name] of [[VA_REL, "validate-all"], [CR_REL, "cached-runner"]]) {
    const modules = modulesOf(code(raw[rel]));
    if (modules === null || !modules.includes(THIS_VALIDATOR)) E("TC-32", `${THIS_VALIDATOR} is not registered in ${name}`);
  }

  // TC-33: the stale claims stay fixed, and the tenant vocabulary stays in the context set.
  if (src[TRD_REL].includes("(no `engines`)") || !src[TRD_REL].includes("`>=24.14.1 <25`") || !src[TRD_REL].includes("## 6. Tenant boundary (V4 Stage 2)") || !src[TRD_REL].includes("is the count of record")) {
    E("TC-33", "docs/04_TRD.md lost the engine pin, the count of record or the tenant boundary");
  }
  if (src[BASE_REL].includes("There is **no** `engines` field") || !src[BASE_REL].includes("`>=24.14.1 <25`") ||
      !src[BASE_REL].includes("10. **Tenant and domain.**") || !src[BASE_REL].includes("is the count of record")) {
    E("TC-33", "docs/00_Baseline_State.md lost the engine pin, the count of record or the tenant records");
  }
  if (!src[PRD_REL].includes("**Tenant vocabulary (plan v1.28;") || !prose(src[PRD_REL]).includes(HARD_RULE.replace(".", " (D4)."))) {
    E("TC-33", "docs/01_PRD.md lost the tenant vocabulary or the owner's hard rule");
  }
  if (!src[SCHEMADOC_REL].includes(`| \`${TREG_REL}\` (installation record`) || !src[SCHEMADOC_REL].includes(`| \`${AREG_REL}\` (installation record`)) {
    E("TC-33", "docs/05_Schema.md no longer lists the two installation records");
  }

  // TC-T: every proof exists, and every proof runs.
  for (const [rel, needles] of Object.entries(TESTS)) {
    for (const n of needles) if (!raw[rel].includes(n)) E("TC-T", `${rel} no longer proves "${n}"`);
    if (NOT_RUN.test(src[rel])) E("TC-T", `${rel} skips or isolates a test: ${NOT_RUN.exec(src[rel])[0]}`);
  }
  return errors;
}

/** Every named mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`TC-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`TC-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("TC-M: two mutations share a name");
  const rules = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of [...Array.from({ length: 40 }, (_, i) => `TC-${i + 1}`), "TC-T"]) {
    if (!rules.has(rule)) errors.push(`TC-M: rule ${rule} has no named mutation`);
  }
  return errors;
}

function run() {
  const raw = {};
  for (const rel of ALL_SOURCES) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
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
