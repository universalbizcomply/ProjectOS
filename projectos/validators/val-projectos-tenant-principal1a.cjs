"use strict";
/**
 * THE TENANT, READ FROM COMMITTED BYTES AND MINTED AT REAL CROSSINGS — PROJECTOS-TENANT-PRINCIPAL1A.
 *
 * PROJECTOS-TENANT-CONTRACT1A wrote the rules. This phase makes the kernel obey them, and every way of
 * softening that reads reasonably in a diff:
 *
 *   TP-1  "read the file, it is right there"        — and a working-tree edit moves a tenant
 *   TP-2  "match first, the file is usually fine"   — and a contradiction further down is never seen
 *   TP-3  "the last commit is the owner's"          — and every agent commit is named Murad
 *   TP-4  "a flag will do for the receipt"          — and an agent confirms its own registry
 *   TP-5  "the path is the path"                    — and a junction or 8.3 name passes for a root
 *   TP-6  "the worktree knows what it is"           — and its own `.git` file picks its tenant
 *   TP-7  "let the caller say"                      — and R2 is gone, or a login carries authority
 *   TP-8  "the envelope can be built here"          — and the core's door is decoration
 *   TP-9  "a record is best effort"                 — and R4 is a log, not a door
 *   TP-10 "the refusal already refused"             — and it vanishes when the lock is held
 *   TP-11 "the project check covers it"             — and only one rule stands between two tenants
 *   TP-12 "tell the far end why"                    — and a refusal hands it a path
 *   TP-13 "run.ts can take a bit more"              — and a protected file grows a second authority
 *   TP-14 "the sidecar is only a surface"           — and a restored selection never meets the rule
 *   TP-15 "wire it later"                           — and `tenant show` does not exist
 *   TP-16 "grant it, it is only this once"          — and P5 has a default
 *   TP-17 "a key is derived, that is enough"        — and a duplicate is not stopped
 *   TP-18 "a dry run can leave a line"              — and a dry run has written something
 *   TP-19 "an environment variable is convenient"   — and one variable points authority at a forgery
 *   TP-20 "it stops an agent, say that"             — and the limit disappears from the page
 *   TP-21 "mock it for the suite"                   — and the rule itself is never run
 *   TP-22 "register it later"                       — and nothing ever runs this file
 *   TP-23 "the crossing can mint its own run"       — and the next phase has nothing to link to
 *   TP-24 "the owner confirmed it"                  — and a console is promoted to a person
 *   TP-25 "a receipt is a receipt"                  — and a moved tenant is confirmed unseen, or a file is copied
 *   TP-26 "records are small, locks are brief"      — and a busy bridge fails a run
 *   TP-27 "the next phase will know"                — and what binds it, and who is locked out, is nowhere written
 *   TP-28 "the records can catch up later"          — and the registry and ADR-T1 still say what the code stopped doing
 *   TP-29 "the console script is handy"             — and production gains a way to answer its own prompt
 *   TP-T  "the tests exist"                         — and `.skip` keeps the proof while dropping the run
 *
 * THE PINS ARE IN THE BODIES. A pin on a call site survives a gutted function, so each pin is taken from
 * inside the function that decides, and each mutation is named after what that function stops doing.
 * `selfTest` applies each in memory and counts it killed only when ITS OWN rule fires.
 *
 * Comments are stripped before anything is judged. Reads files; runs nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const REG_REL = "projectos/agent/src/installation/tenantRegistry.ts";
const ALLOWLIST_REL = "projectos/agent/src/installation/projectAllowlist.ts";
const TREG_REL = "projectos/security/tenant-registry.json";
const ADR_REL = "docs/adr/ADR-T1-tenant-boundary.md";
const GC_REL = "projectos/agent/src/governedContext.ts";
const CMD_REL = "projectos/agent/src/commands/tenant.ts";
const RUN_REL = "projectos/agent/src/commands/run.ts";
const CLI_REL = "projectos/agent/src/cli.ts";
const BRIDGE_REL = "projectos/agent/src/mcp/bridge.ts";
const HOST_REL = "projectos/control-center/sidecar/host.mjs";
const SETUP_REL = "projectos/agent/test/setup.ts";
const EVIDENCE_REL = "docs/finish/PROJECTOS-TENANT-PRINCIPAL1A.md";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const SOURCES = [REG_REL, ALLOWLIST_REL, GC_REL, CMD_REL, RUN_REL, CLI_REL, BRIDGE_REL, HOST_REL, SETUP_REL, VA_REL, CR_REL];
const THIS_VALIDATOR = "val-projectos-tenant-principal1a";
const RECEIPT_LIMIT = "It does not stop a process that drives a console or writes the receipt and its line directly";
const RECEIPT_CLAIM = "a person or a process confirmed this registry blob at a console, nothing more";
/** What the evidence must keep saying, in plain words, for a later reader. */
const EVIDENCE_NEEDLES = [
  "any process of this user can write the receipt and its line directly",
  "It does not stop: a process that drives a console",
  "`run-start` has no execution line",
  "a repeat `run-start` is counted, not stopped",
  "cwd selects the checkout. The tenant value is derived",
  "the requester is a kernel-issued run handle that survives process boundaries, never cwd",
  "worktree binding alone releases nothing",
  "a receipt is never a credential-release grant",
  "no JWT or OAuth requester",
  "`run-start` has a budget",
  "`dead-aisle`, `jd-testing`, `criclocal`",
  "`brik`, `trading-bot`, `bizcomply-v2`",
  "`tkn`, `erp-system`, `wizard-probe`. They have",
  "an agent could run it",
];

const TESTS = {
  "projectos/agent/test/tenantPrincipal.test.ts": [
    "derives each project its own tenant and domain from committed bytes",
    "refuses a registry edited in the working tree, and a commit of it is what would carry authority",
    "a duplicate entry refuses the whole file by name, the perfect lines included",
    "a wildcard refuses the whole file by name",
    "reads the REAL committed registries of this repository",
    "refuses a registry with no receipt by name, though its last commit is named Murad, and names the one line to run",
    "a registry changed by a later commit carries no authority until the owner confirms the new blob",
    "going back to an older registry needs a new confirmation: there is one receipt, not one per blob",
    "does not believe a damaged receipt, one with an extra field, or one of another kind",
    "an environment variable cannot point the receipt somewhere else",
    "refuses with NO TERMINAL: the production confirmation answers no-terminal unless stdin and stdout are both a TTY",
    "this very process has no terminal: the real command refuses by name and writes no receipt",
    "refuses a WRONG typed confirmation, near misses included",
    "a person typing it makes the receipt, through the door at P5, and the registry then carries authority",
    "an admission that cannot be recorded makes no receipt",
    "the grant is for this blob alone: the door refuses the same action on any other subject",
    "an unlisted project is refused by name and never falls back to the owner",
    "a project claiming a listed id from another repository is refused: the id is a string in its own file",
    "R2: a tenant in argv, the environment, agent text or a project file changes nothing",
    "`tenant show` writes nothing, anywhere",
    "refuses a REAL junction to a registered root, where the plain string compare would be misled",
    "refuses an 8.3 short name: its realpath is another spelling",
    "a worktree the registered root lists takes that project and tenant, and says how it was bound",
    "the listing is asked of the registered root, never of the checkout",
    "a directory whose `.git` FILE points at the registered repository is refused: it is not in the listing",
    "something new at a removed worktree\\'s path is refused, though real git still lists that path and does not call it prunable",
    "a removed worktree git does call prunable attaches nothing: a plain directory at that path is refused",
    "a governed run stays admitted in a worktree, and its record shows the worktree",
    "refuses an unlisted project before anything starts, recorded, in both forms of the command",
    "refuses every project until the owner confirms the registry, and says exactly what to run",
    "a real governed `run --dry-run` walks to the worker in a linked worktree, and the same worktree is refused once its project is unlisted",
    "a run whose admission cannot be recorded does not start",
    "a refusal that cannot be recorded stops the operation, and says it was not recorded",
    "the same commit is the same key with the attempt counted; a new commit is a new key",
    "a run an earlier run already completed returns the earlier outcome rather than running again",
    "a selection that cannot be recorded did not happen",
    "a selection whose outcome cannot be recorded did not happen either",
    "a verb refused under a stale lock prints the lock hint, so a person can clear it",
    "a working-tree edit hidden from `git diff` still has no authority: the bytes judged are the committed ones",
    "other verbs need a tenant too; only refresh, project.select and run.stop do not",
    "never replaces a file it cannot read, which would erase what it holds",
    "a key admitted and never settled is a duplicate, because its effect may have happened, unless the caller says a repeat is safe",
  ],
  "projectos/agent/test/tenantBridgeRule.test.ts": [
    "still refuses a read across tenants, by the tenant rule\\'s own name",
    "POSITIVE CONTROL: a second project in the same tenant is answered, so that refusal was not a default",
    "the check really is disabled: the same read with it intact is the project check\\'s refusal",
    "is a recorded crossing with the derived tenant, and a named tenant changes nothing",
    "does nothing until the owner has confirmed the registry, and tells the far end no path",
    "`stop-work` needs no tenant: it works with the registry unconfirmed",
    "a contract refusal says it was not recorded, where it used to vanish without a word",
    "a derivation refusal that cannot be written says so, beside one that was",
    "a read whose admission cannot be written is not answered",
    "a read whose outcome cannot be written is not answered either",
  ],
  "projectos/agent/test/tenantReviewRound.test.ts": [
    "a replace ref cannot change the bytes judged under a receipted blob name",
    "`refs/replace` is shared across linked worktrees, and an installation in one is not fooled either",
    "bytes that do not hash to the named blob are refused, whatever produced them",
    "every git call on the registry refuses replacement objects",
    "a crossing can be minted from the run this context admitted, and it passes the door tied to that run",
    "a dry run, another context and a refused run hold nothing to link",
    "cwd does: a second `run --execute` from another tenant\\'s root gets that tenant, and nothing ties the two",
    "records the confirmation method, and does not claim the owner",
    "no answer says the owner did it",
    "shows the change against the last receipted blob at the prompt",
    "a receipt with no admission line carries no authority: a copied file is not a confirmation",
    "waits for a lock another process lets go of, and the line lands",
    "a busy bridge does not fail `run --execute`",
    "the wait is bounded: a lock nobody releases refuses, and no unwritable directory waits at all",
    "rotates past its size, losing nothing",
    "the real default refuses `C:/PROGRA~1`, which exists and which plain realpathSync leaves unexpanded",
    "a real short name of a registered root is refused by name, and its long name binds",
    "the real CLI, `run` and `continue` all reach the real rule",
    "quotes the printed command, so a path with spaces works",
    "a corrupt idempotency file names its fix",
  ],
  "projectos/agent/test/tenantSidecar.test.ts": [
    "selects a listed project through the envelope, and refuses an unlisted one before it takes effect",
    "a verb on a project that has lost its tenant is refused, while refresh and run.stop still answer",
    "a remembered selection goes through the envelope at start, and one with no tenant is not restored",
    "a default selection of the only project goes through the rule too",
    "a verb refused under a stale lock prints the lock hint on the real channel",
    "a selection that falls back to the default on a refresh goes through the rule too",
    "the prompt reads what is typed, a wrong answer is refused, and no receipt is written",
    "a correct answer at a real console makes the receipt, through the door, and the bindings were on the screen",
  ],
};
/** What ships, or starts what ships. A console script reachable from any of these answers its own prompt. */
const PRODUCTION_REL = [
  REG_REL, ALLOWLIST_REL, GC_REL, CMD_REL, RUN_REL, CLI_REL, BRIDGE_REL, HOST_REL,
  "projectos/agent/src/index.ts",
  "projectos/agent/bin/projectos.js",
  "projectos/agent/bin/projectos-bridge.js",
  "projectos/agent/package.json",
  "projectos/control-center/sidecar/governedWorker.mjs",
  "projectos/control-center/packaging/build-daemon-bundle.mjs",
  "projectos/control-center/packaging/build-release-payload.mjs",
];
const CONSOLE_REL = "projectos/agent/test/support/conpty.ps1";
const DRIVER_REL = "projectos/agent/test/support/receiptDriver.mjs";
const TEST_ONLY_NAMES = /conpty|receiptDriver|sidecarPreload/i;
const ALL_SOURCES = [...new Set([...SOURCES, ...PRODUCTION_REL, CONSOLE_REL, DRIVER_REL, EVIDENCE_REL, TREG_REL, ADR_REL, ...Object.keys(TESTS)])];

/**
 * `[rule, rel, function or null, the text that must be there]`. Judged on comment-stripped source, so a
 * pin kept alive in a comment does not count. Function pins are taken from inside the function.
 */
const PINS = [
  // TP-1: committed bytes.
  ["TP-1", REG_REL, "committedBytes", "'log', '-1', '--format=%H', '--', rel"],
  ["TP-1", REG_REL, "committedBytes", "'diff', '--name-only', 'HEAD', '--', rel"],
  ["TP-1", REG_REL, "committedBytes", "dirty.stdout.trim().length > 0"],
  ["TP-1", REG_REL, "committedBytes", "'show', `${commit}:./${rel}`"],
  ["TP-1", REG_REL, "committedBytes", "'rev-parse', `${commit}:./${rel}`"],
  ["TP-1", REG_REL, "gitAt", "sys.exec('git', ['--no-replace-objects', '-C', install, ...args])"],
  ["TP-1", REG_REL, "committedBytes", "if (blobNameOf(shown.stdout, blob) !== blob) return refusal(code,"],
  ["TP-1", ALLOWLIST_REL, "blobNameOf", "createHash(blob.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\\0`).update(bytes)"],
  ["TP-1", ALLOWLIST_REL, "installationAllowsProject", "sys.exec('git', ['--no-replace-objects', '-C', install, ...args])"],
  ["TP-1", ALLOWLIST_REL, "installationAllowsProject", "if (named.code !== 0 || blobNameOf(shown.stdout, blob) !== blob) {"],
  ["TP-1", REG_REL, "registryAtBlob", "blobNameOf(shown.stdout, blob) !== blob"],
  ["TP-1", REG_REL, "readCommittedTenantRegistry", "committedBytes(sys, installRoot, TENANT_REGISTRY_REL, 'TENANT_REGISTRY_UNREADABLE')"],
  ["TP-1", REG_REL, "readCommittedActionRegistry", "committedBytes(sys, installRoot, ACTION_REGISTRY_REL, 'ACTION_REGISTRY_UNREADABLE')"],
  // TP-2: the whole file, then the owner, then the match.
  ["TP-2", REG_REL, "readCommittedTenantRegistry", "parseTenantRegistry(raw)"],
  ["TP-2", REG_REL, "readCommittedTenantRegistry", "if (!parsed.ok) {"],
  ["TP-2", REG_REL, "readCommittedTenantRegistry", "first?.code ?? 'TENANT_REGISTRY_INVALID'"],
  ["TP-2", REG_REL, "readCommittedActionRegistry", "if (!parsed.ok) return refusal('ACTION_REGISTRY_UNREADABLE'"],
  ["TP-2", GC_REL, "deriveTenant", "if (!registries.ok) return registries;"],
  // TP-3: the owner receipt.
  ["TP-3", GC_REL, "deriveTenant", "const unconfirmed = receiptRefusal(sys, source, registries.blob);"],
  ["TP-3", GC_REL, "deriveTenant", "if (unconfirmed !== null) return unconfirmed;"],
  ["TP-3", REG_REL, "receiptRefusal", "read.kind === 'ok' && read.receipt.registryBlob === blob"],
  ["TP-3", REG_REL, "receiptRefusal", "refusal('TENANT_REGISTRY_NO_RECEIPT'"],
  ["TP-3", REG_REL, "receiptRefusal", "tenantReceiptCommand(source.installRoot, blob)"],
  ["TP-3", REG_REL, "tenantReceiptCommand", "`node \"${"],
  ["TP-3", REG_REL, "parseReceipt", "Object.keys(record).length === TENANT_RECEIPT_FIELDS.length"],
  ["TP-3", REG_REL, "parseReceipt", "record['kind'] === TENANT_RECEIPT_KIND"],
  ["TP-3", REG_REL, "parseReceipt", "record['schemaVersion'] === TENANT_RECEIPT_SCHEMA_VERSION"],
  ["TP-3", REG_REL, "parseReceipt", "record['confirmation'] === TENANT_RECEIPT_CONFIRMATION"],
  ["TP-3", REG_REL, "parseReceipt", "GIT_OBJECT.test(blob)"],
  ["TP-3", REG_REL, "tenantReceiptPath", "join(stateDir, TENANT_RECEIPT_FILENAME)"],
  // TP-4: created only by a person, in a terminal.
  ["TP-4", CMD_REL, "terminalTenantReceiptConfirm", "t.stdinIsTTY !== true || t.stdoutIsTTY !== true"],
  ["TP-4", CMD_REL, "terminalTenantReceiptConfirm", "return { kind: 'no-terminal' }"],
  ["TP-4", CMD_REL, "terminalTenantReceiptConfirm", "typed === null ? { kind: 'no-terminal' }"],
  ["TP-4", CMD_REL, "tenant", "confirm: TenantReceiptConfirm = terminalTenantReceiptConfirm()"],
  ["TP-4", CMD_REL, "receipt", "const confirmation = confirm(blob, [...changesSinceLastReceipt("],
  ["TP-4", CMD_REL, "receipt", "if (confirmation.kind !== 'typed') {"],
  ["TP-4", CMD_REL, "receipt", "TENANT_RECEIPT_NEEDS_A_TERMINAL"],
  ["TP-4", CMD_REL, "receipt", "if (confirmation.text !== blob.slice(0, CONFIRMATION_LENGTH)) {"],
  ["TP-4", CMD_REL, "receipt", "if (blob !== registries.blob) {"],
  ["TP-4", CLI_REL, "run", "return tenant(ctx, flags, positionals);"],
  // TP-5: one spelling.
  ["TP-5", REG_REL, "canonicalCheckoutRoot", "real = realpath(resolve(root));"],
  ["TP-5", REG_REL, "canonicalCheckoutRoot", "if (pathKey(real) !== pathKey(root)) {"],
  ["TP-5", REG_REL, "canonicalCheckoutRoot", "realpath: (path: string) => string = realpathSync.native"],
  ["TP-5", REG_REL, "resolveCheckout", "const canonical = canonicalCheckoutRoot(root);"],
  ["TP-5", REG_REL, "resolveCheckout", "if (!canonical.ok) return canonical;"],
  ["TP-5", REG_REL, "resolveCheckout", "root: canonical.root,"],
  // TP-6: the listing, at the registered root.
  ["TP-6", REG_REL, "readWorktreeListing", "'-C', registeredRoot, 'worktree', 'list', '--porcelain'"],
  ["TP-6", REG_REL, "readWorktreeListing", "linkedWorktreesFromPorcelain(listed.stdout, registeredRoot)"],
  ["TP-6", REG_REL, "resolveCheckout", "const registered = registeredRootOf(registry, projectId);"],
  ["TP-6", REG_REL, "resolveCheckout", "registered === null ? null : readWorktreeListing(sys, registered)"],
  ["TP-6", REG_REL, "resolveCheckout", "pointsIntoRegisteredRoot(sys, canonical.root, resolved.binding.governedRoot)"],
  ["TP-6", REG_REL, "pointsIntoRegisteredRoot", ".startsWith(`${pathKey(registeredRoot)}/.git/worktrees/`)"],
  // TP-8: through the core's door.
  ["TP-8", GC_REL, "admitBoundary", "binding: derived.binding, registry: derived.actions"],
  ["TP-8", GC_REL, "admitBoundary", "return admitEnvelope(minted, now, recorder, grant);"],
  ["TP-8", GC_REL, "admitBoundary", "recorder: EnvelopeRecorder = envelopeRecorder(sys, stateDir)"],
  ["TP-8", GC_REL, "runStartTenantRefusal", "action: 'run-start',"],
  ["TP-8", GC_REL, "runStartTenantRefusal", "principal: 'implementer',"],
  ["TP-8", GC_REL, "projectSelectionRefusal", "action: 'project-selection',"],
  ["TP-8", BRIDGE_REL, "admitBridgeRead", "action: 'bridge-read',"],
  ["TP-8", BRIDGE_REL, "admitBridgeRead", "principal: 'advisor',"],
  ["TP-8", GC_REL, "checkoutSubject", "'rev-parse', '--verify', 'HEAD'"],
  // TP-9: R4 on the disk.
  ["TP-9", REG_REL, "appendDurableLine", "if (!takeRecordLock(sys, lock)) return false;\n  try {"],
  ["TP-9", REG_REL, "appendDurableLine", "if (held === null && sys.exists(path)) return false;"],
  ["TP-9", REG_REL, "appendDurableLine", "if (!sys.renameFile(temporary, path)) {"],
  ["TP-9", REG_REL, "appendDurableLine", "return sys.readText(path)?.endsWith(line) === true;"],
  ["TP-9", REG_REL, "appendDurableLine", "} catch {\n    return false;\n  }"],
  ["TP-9", REG_REL, "envelopeRecorder", "stateDir !== null && appendDurableLine("],
  ["TP-9", GC_REL, "runStartTenantRefusal", "if (!admission.admitted) return admissionRefusalLines(admission);"],
  ["TP-9", GC_REL, "projectSelectionRefusal", "if (!admission.admitted) return admissionRefusalLines(admission);"],
  ["TP-9", GC_REL, "projectSelectionRefusal", "return recorded ? null :"],
  ["TP-9", GC_REL, "admissionRefusalLines", "admission.rule === 'R4' ? 'ENVELOPE_NOT_RECORDED'"],
  ["TP-9", CMD_REL, "receipt", "if (!admission.admitted) return receiptAnswer(2, admissionRefusalLines(admission));"],
  // TP-10: a refusal that cannot be recorded says so.
  ["TP-10", BRIDGE_REL, "appendRefusal", "return appendDurableLine(sys, join(stateDir, 'bridge-refusals.jsonl'), entry);"],
  ["TP-10", BRIDGE_REL, "refusalResult", "recorded ? lines : [...lines,"],
  ["TP-10", BRIDGE_REL, "refusalResult", "REFUSAL_NOT_RECORDED"],
  ["TP-10", BRIDGE_REL, "handleBridgeRpc", "refusalResult(['REFUSED', ...verdict.reasons.map((r) => `- ${r}`)], recorded)"],
  ["TP-10", BRIDGE_REL, "handleBridgeRpc", "],\n        recorded,\n      ),"],
  ["TP-10", GC_REL, "recordedRefusalLines", "recorded ? tenantRefusalLines(r) : [...tenantRefusalLines(r), REFUSAL_NOT_RECORDED_LINE, RECORD_LOCK_HINT]"],
  ["TP-10", GC_REL, "recordTenantRefusal", "return !door.admitted && door.recorded;"],
  // TP-11: the tenant rule stands alone.
  ["TP-11", REG_REL, "crossTenantRefusal", "wanted === undefined"],
  ["TP-11", REG_REL, "crossTenantRefusal", "refusal('TENANT_UNKNOWN'"],
  ["TP-11", REG_REL, "crossTenantRefusal", "wanted.tenant === boundTenant"],
  ["TP-11", REG_REL, "crossTenantRefusal", "refusal('TENANT_MISMATCH'"],
  ["TP-11", BRIDGE_REL, "admitBridgeRead", "const crossing = crossTenantRefusal(derived.registry, derived.binding.tenant, requested);"],
  ["TP-11", BRIDGE_REL, "admitBridgeRead", "if (crossing !== null) return refused(crossing.code,"],
  ["TP-11", BRIDGE_REL, "admitBridgeRead", "const derived = deriveTenant(sys, root, deps.projectId, source);"],
  ["TP-11", BRIDGE_REL, "handleBridgeRpc", "if (!read.admitted) return ok(request, refusalResult(read.lines, read.recorded));"],
  ["TP-11", BRIDGE_REL, "handleBridgeRpc", "if (!recordExecution(read.envelope, 'allowed', null,"],
  // TP-14: the sidecar asks.
  ["TP-14", HOST_REL, "handleGovernedCommand", "projectSelectionRefusal(tenantContext(resolveProjectRoot(inventory, outcome.projectId)))"],
  ["TP-14", HOST_REL, "handleGovernedCommand", "controlCenterTenantRefusal(tenantContext(root), check.request.verb)"],
  ["TP-14", HOST_REL, "tenantContext", "tenantInstallRoot: installRoot"],
  ["TP-14", HOST_REL, null, "let selectedProjectId = admittedSelection(initialSelection());"],
  ["TP-14", HOST_REL, "refreshInventory", "selectedProjectId = admittedSelection(defaultSelection(inventory));"],
  ["TP-14", HOST_REL, "admittedSelection", "projectSelectionRefusal(tenantContext(root))"],
  ["TP-14", HOST_REL, "admittedSelection", "if (refused === null) return projectId;"],
  ["TP-14", GC_REL, "controlCenterTenantRefusal", "if (CONTROL_CENTER_VERBS_WITHOUT_TENANT.includes(verb)) return null;"],
  // TP-15: wired.
  ["TP-15", CMD_REL, "show", "deriveProjectTenant(ctx.sys, ctx.root, source)"],
  ["TP-15", CLI_REL, "run", "case 'tenant':\n      return tenant("],
  ["TP-15", CLI_REL, null, "export { controlCenterTenantRefusal, projectSelectionRefusal } from './governedContext.js';"],
  ["TP-15", CLI_REL, "readOnlyUnderPlatformStop", "case 'tenant':\n      return sub === undefined || sub === 'show';"],
  // TP-16: no grant by default.
  ["TP-16", REG_REL, null, "export const NO_GRANT: EnvelopeGrantPort = () => false;"],
  ["TP-16", GC_REL, "admitBoundary", "grant: EnvelopeGrantPort = NO_GRANT"],
  ["TP-16", CMD_REL, "tenantReceiptGrant", "envelope.action === 'tenant-registry-change' && envelope.subjectHash === blob"],
  ["TP-16", CMD_REL, "receipt", "action: 'tenant-registry-change',"],
  // TP-17: the store.
  ["TP-17", REG_REL, "claimIdempotencyKey", "if (sys.createExclusive(path,"],
  ["TP-17", REG_REL, "claimIdempotencyKey", "if (earlier === null) return { kind: 'unavailable'"],
  ["TP-17", REG_REL, "claimIdempotencyKey", "a person may remove that file"],
  ["TP-17", REG_REL, "claimIdempotencyKey", "earlier.outcome === 'completed' || (earlier.outcome === 'admitted' && options.retryUnsettled !== true)"],
  ["TP-17", REG_REL, "claimIdempotencyKey", "const attempt = earlier.attempts + 1;"],
  ["TP-17", REG_REL, "claimIdempotencyKey", "if (stateDir === null) return { kind: 'unavailable'"],
  ["TP-17", REG_REL, "settleIdempotencyKey", "earlier !== null && replaceIdempotencyEntry("],
  ["TP-17", GC_REL, "runStartTenantRefusal", "claimIdempotencyKey(sys, source.stateDir, admission.envelope, sys.now(), { retryUnsettled: true })"],
  ["TP-17", GC_REL, "runStartTenantRefusal", "if (claim.kind !== 'first' && claim.kind !== 'retry') {"],
  // TP-18: a dry run mints nothing.
  ["TP-18", GC_REL, "runStartTenantRefusal", "if (!execute) return null;"],
  ["TP-18", GC_REL, "runStartTenantRefusal", "if (!derived.ok) return execute ? recordedRefusalLines(sys, source, derived) : tenantRefusalLines(derived);"],
  // TP-19: which installation.
  ["TP-19", GC_REL, "tenantSourceOf", "nodeProjectosRuntime().installRoot"],
  ["TP-19", GC_REL, "tenantSourceOf", "(ctx as { readonly tenantInstallRoot?: unknown }).tenantInstallRoot"],
  ["TP-19", GC_REL, "tenantSourceOf", "stateDir: platformStopDirOf(ctx),"],
  // TP-20: the limit stays on the page.
  ["TP-20", CMD_REL, "receiptAnswer", "[...lines, TENANT_RECEIPT_STATEMENT]"],
  ["TP-20", CMD_REL, "show", "TENANT_RECEIPT_STATEMENT,"],
  // TP-23: the admitted run stays, narrowly.
  ["TP-23", GC_REL, "runStartTenantRefusal", "ADMITTED_RUNS.delete(ctx);"],
  ["TP-23", GC_REL, "runStartTenantRefusal", "ADMITTED_RUNS.set(ctx, { envelope: admission.envelope, derived });"],
  ["TP-23", GC_REL, "admittedRunEnvelopeOf", "ADMITTED_RUNS.get(ctx)?.envelope ?? null"],
  ["TP-23", GC_REL, "mintRunCrossing", "if (admitted === undefined) return { ok: false, rule: 'RUN_LINK'"],
  ["TP-23", GC_REL, "mintRunCrossing", "return mintCrossing("],
  ["TP-23", GC_REL, null, "const ADMITTED_RUNS = new WeakMap<object,"],
  // TP-24: a method, not a person.
  ["TP-24", REG_REL, null, "export const TENANT_RECEIPT_CONFIRMATION = 'typed-terminal';"],
  ["TP-24", CMD_REL, "receipt", "principal: 'implementer',"],
  ["TP-24", CMD_REL, "receipt", "`confirmation:${TENANT_RECEIPT_CONFIRMATION}`"],
  // TP-25: seen, and reconciled.
  ["TP-25", CMD_REL, "changesSinceLastReceipt", "registryAtBlob(ctx.sys, installRoot, last)"],
  ["TP-25", CMD_REL, "changeOf", "CHANGED"],
  ["TP-25", CMD_REL, "receipt", "...changesSinceLastReceipt(ctx, source.installRoot, before, derived.registry)"],
  ["TP-25", CMD_REL, "changesSinceLastReceipt", "REMOVED"],
  ["TP-25", CMD_REL, "changesSinceLastReceipt", "ADDED"],
  ["TP-25", CMD_REL, "changeOf", "(['tenant', 'domain', 'repository', 'governedRoot'] as const)"],
  ["TP-25", REG_REL, "receiptRefusal", "if (matches && hasAdmissionLine(sys, source.stateDir, read.receipt)) return null;"],
  ["TP-25", REG_REL, "hasAdmissionLine", "record?.stage === 'admission'"],
  ["TP-25", REG_REL, "hasAdmissionLine", "record.outcome === 'allowed'"],
  ["TP-25", REG_REL, "hasAdmissionLine", "envelope.envelopeId === receipt.envelopeId"],
  ["TP-25", REG_REL, "hasAdmissionLine", "envelope.subjectHash === receipt.registryBlob"],
  ["TP-25", CMD_REL, "receipt", "envelopeRecorder(sys, source.stateDir, TENANT_CHANGE_RECORDS_FILENAME)"],
  ["TP-25", CMD_REL, "receipt", "writeTenantReceipt(sys, source.stateDir, blob, sys.now(), admission.envelope.envelopeId)"],
  // TP-26: bounded waits, bounded files.
  ["TP-26", REG_REL, "takeRecordLock", "for (let step = 0; step < LOCK_WAIT_STEPS; step += 1) {"],
  ["TP-26", REG_REL, "takeRecordLock", "Atomics.wait(pause, 0, 0, LOCK_WAIT_STEP_MS);"],
  ["TP-26", REG_REL, "takeRecordLock", "if (!sys.exists(lock)) return sys.createExclusive(lock, content);"],
  ["TP-26", REG_REL, null, "const LOCK_WAIT_STEPS = 40;"],
  ["TP-26", REG_REL, null, "export const DURABLE_LINE_ROTATE_BYTES = 1_048_576;"],
  ["TP-26", REG_REL, "appendDurableLine", "Buffer.byteLength(held, 'utf8') >= DURABLE_LINE_ROTATE_BYTES"],
  ["TP-26", REG_REL, "appendDurableLine", "-${randomBytes(4).toString('hex')}`)) return false;\n      existing = null;"],
];

/** Lines only `tenantRegistry.ts` may reach: one caller, or the rule has a second door. */
const NOT_IN_CALLERS = [GC_REL, CMD_REL, RUN_REL, CLI_REL, BRIDGE_REL];

const MUTATIONS = [
  // TP-1
  { name: "registry-read-from-the-working-tree", rule: "TP-1", rel: REG_REL, from: "const shown = gitAt(sys, install, 'show', `${commit}:./${rel}`);", to: "const shown = { code: 0, stdout: sys.readText(join(install, rel)) ?? '' };" },
  { name: "dirty-registry-accepted", rule: "TP-1", rel: REG_REL, from: "if (dirty.code !== 0 || dirty.stdout.trim().length > 0) {", to: "if (dirty.code !== 0) {" },
  { name: "uncommitted-registry-accepted", rule: "TP-1", rel: REG_REL, from: "const logged = gitAt(sys, install, 'log', '-1', '--format=%H', '--', rel);", to: "const logged = { code: 0, stdout: 'x' };" },
  { name: "blob-named-from-a-moving-head", rule: "TP-1", rel: REG_REL, from: "const named = gitAt(sys, install, 'rev-parse', `${commit}:./${rel}`);", to: "const named = gitAt(sys, install, 'rev-parse', `HEAD:./${rel}`);" },
  { name: "action-registry-from-another-rel", rule: "TP-1", rel: REG_REL, from: "committedBytes(sys, installRoot, ACTION_REGISTRY_REL, 'ACTION_REGISTRY_UNREADABLE')", to: "committedBytes(sys, installRoot, TENANT_REGISTRY_REL, 'ACTION_REGISTRY_UNREADABLE')" },
  // TP-2
  { name: "registry-not-judged-whole", rule: "TP-2", rel: REG_REL, from: "const parsed = parseTenantRegistry(raw);\n  if (!parsed.ok) {", to: "const parsed = parseTenantRegistry(raw);\n  if (false) {" },
  { name: "refusal-loses-the-duplicate-name", rule: "TP-2", rel: REG_REL, from: "first?.code ?? 'TENANT_REGISTRY_INVALID'", to: "'TENANT_REGISTRY_INVALID'" },
  { name: "action-registry-not-judged-whole", rule: "TP-2", rel: REG_REL, from: "if (!parsed.ok) return refusal('ACTION_REGISTRY_UNREADABLE'", to: "if (false) return refusal('ACTION_REGISTRY_UNREADABLE'" },
  // TP-3
  { name: "receipt-not-asked", rule: "TP-3", rel: GC_REL, from: "if (unconfirmed !== null) return unconfirmed;", to: "" },
  { name: "printed-command-unquoted", rule: "TP-3", rel: REG_REL, from: "return `node \"${", to: "return `node ${" },
  { name: "receipt-checked-after-the-match", rule: "TP-3", rel: GC_REL, from: "  const unconfirmed = receiptRefusal(sys, source, registries.blob);\n  if (unconfirmed !== null) return unconfirmed;\n  return bindCheckout(sys, root, projectId, registries);", to: "  const bound = bindCheckout(sys, root, projectId, registries);\n  if (bound.ok) return bound;\n  const unconfirmed = receiptRefusal(sys, source, registries.blob);\n  if (unconfirmed !== null) return unconfirmed;\n  return bound;" },
  { name: "any-receipt-will-do", rule: "TP-3", rel: REG_REL, from: "const matches = read.kind === 'ok' && read.receipt.registryBlob === blob;", to: "const matches = read.kind === 'ok';" },
  { name: "no-receipt-passes", rule: "TP-3", rel: REG_REL, from: "const matches = read.kind === 'ok' && read.receipt.registryBlob === blob;", to: "if (read.kind !== 'unreadable') return null;\n  const matches = read.kind === 'ok' && read.receipt.registryBlob === blob;" },
  { name: "refusal-hides-the-command", rule: "TP-3", rel: REG_REL, from: "`  ${tenantReceiptCommand(source.installRoot, blob)}`,", to: "" },
  { name: "receipt-tolerates-extra-fields", rule: "TP-3", rel: REG_REL, from: "Object.keys(record).length === TENANT_RECEIPT_FIELDS.length &&", to: "" },
  { name: "receipt-any-kind", rule: "TP-3", rel: REG_REL, from: "record['kind'] === TENANT_RECEIPT_KIND &&", to: "" },
  { name: "receipt-any-version", rule: "TP-3", rel: REG_REL, from: "record['schemaVersion'] === TENANT_RECEIPT_SCHEMA_VERSION &&", to: "" },
  { name: "receipt-any-confirmation", rule: "TP-3", rel: REG_REL, from: "record['confirmation'] === TENANT_RECEIPT_CONFIRMATION &&", to: "" },
  { name: "receipt-any-blob-text", rule: "TP-3", rel: REG_REL, from: "typeof blob === 'string' &&\n    GIT_OBJECT.test(blob);", to: "typeof blob === 'string';" },
  { name: "receipt-path-moved", rule: "TP-3", rel: REG_REL, from: "return join(stateDir, TENANT_RECEIPT_FILENAME);", to: "return join(stateDir, 'receipts', TENANT_RECEIPT_FILENAME);" },
  { name: "owner-check-falls-back-to-a-git-name", rule: "TP-3", rel: REG_REL, from: "const read = readTenantReceipt(sys, source.stateDir);\n  const matches", to: "const read = readTenantReceipt(sys, source.stateDir);\n  if (sys.exec('git', ['-C', source.installRoot, 'log', '-1', '--format=%an']).stdout.trim() === 'Murad') return null;\n  const matches" },
  // TP-4
  { name: "one-tty-is-enough", rule: "TP-4", rel: CMD_REL, from: "t.stdinIsTTY !== true || t.stdoutIsTTY !== true", to: "t.stdinIsTTY !== true && t.stdoutIsTTY !== true" },
  { name: "no-tty-means-yes", rule: "TP-4", rel: CMD_REL, from: "if (t.stdinIsTTY !== true || t.stdoutIsTTY !== true) return { kind: 'no-terminal' };", to: "if (t.stdinIsTTY !== true || t.stdoutIsTTY !== true) return { kind: 'typed', text: blob.slice(0, CONFIRMATION_LENGTH) };" },
  { name: "unreadable-terminal-means-yes", rule: "TP-4", rel: CMD_REL, from: "return typed === null ? { kind: 'no-terminal' } : { kind: 'typed', text: typed };", to: "return { kind: 'typed', text: typed ?? blob.slice(0, CONFIRMATION_LENGTH) };" },
  { name: "confirmation-comes-from-the-context", rule: "TP-4", rel: CMD_REL, from: "confirm: TenantReceiptConfirm = terminalTenantReceiptConfirm(),", to: "confirm: TenantReceiptConfirm = (ctx as unknown as { confirm: TenantReceiptConfirm }).confirm,", },
  { name: "confirmation-not-required", rule: "TP-4", rel: CMD_REL, from: "if (confirmation.kind !== 'typed') {", to: "if (false) {" },
  { name: "any-typed-text-confirms", rule: "TP-4", rel: CMD_REL, from: "if (confirmation.text !== blob.slice(0, CONFIRMATION_LENGTH)) {", to: "if (confirmation.kind !== 'typed') {" },
  { name: "as-owner-skips-the-terminal", rule: "TP-4", rel: CMD_REL, from: "const confirmation = confirm(blob, [...changesSinceLastReceipt(", to: "const confirmation = flags['as'] === 'owner' ? { kind: 'typed' as const, text: blob.slice(0, CONFIRMATION_LENGTH) } : confirm(blob, [...changesSinceLastReceipt(" },
  { name: "receipt-for-a-named-blob", rule: "TP-4", rel: CMD_REL, from: "if (blob !== registries.blob) {", to: "if (false) {" },
  { name: "receipt-written-outside-the-command", rule: "TP-4", rel: BRIDGE_REL, from: "function appendRefusal(sys: System,", to: "void writeTenantReceipt;\nfunction appendRefusal(sys: System," },
  { name: "cli-gives-the-tenant-command-a-confirm", rule: "TP-4", rel: CLI_REL, from: "return tenant(ctx, flags, positionals);", to: "return tenant(ctx, flags, positionals, () => ({ kind: 'typed', text: str(flags, 'blob').slice(0, 12) }));" },
  // TP-5
  { name: "alias-canonicalised-and-trusted", rule: "TP-5", rel: REG_REL, from: "if (pathKey(real) !== pathKey(root)) {", to: "if (false) {" },
  { name: "realpath-not-native", rule: "TP-5", rel: REG_REL, from: "realpath: (path: string) => string = realpathSync.native", to: "realpath: (path: string) => string = realpathSync" },
  { name: "realpath-skipped", rule: "TP-5", rel: REG_REL, from: "real = realpath(resolve(root));", to: "real = resolve(root);" },
  { name: "checkout-not-canonicalised", rule: "TP-5", rel: REG_REL, from: "if (!canonical.ok) return canonical;", to: "" },
  { name: "raw-root-handed-to-resolve", rule: "TP-5", rel: REG_REL, from: "root: canonical.root,", to: "root," },
  // TP-6
  { name: "listing-taken-at-the-checkout", rule: "TP-6", rel: REG_REL, from: "registered === null ? null : readWorktreeListing(sys, registered)", to: "readWorktreeListing(sys, canonical.root)" },
  { name: "listing-reader-wrong-root", rule: "TP-6", rel: REG_REL, from: "linkedWorktreesFromPorcelain(listed.stdout, registeredRoot)", to: "linkedWorktreesFromPorcelain(listed.stdout, sys.cwd())" },
  { name: "worktree-asks-its-common-dir", rule: "TP-6", rel: REG_REL, from: "const registered = registeredRootOf(registry, projectId);", to: "const registered = sys.exec('git', ['-C', canonical.root, 'rev-parse', '--git-common-dir']).stdout.trim();" },
  { name: "new-directory-at-a-listed-path-attaches", rule: "TP-6", rel: REG_REL, from: "if (!resolved.ok || resolved.binding.via !== 'linked-worktree' || pointsIntoRegisteredRoot(sys, canonical.root, resolved.binding.governedRoot)) return resolved;", to: "if (!resolved.ok || resolved.binding.via !== 'linked-worktree') return resolved;" },
  { name: "any-worktree-pointer-will-do", rule: "TP-6", rel: REG_REL, from: ".startsWith(`${pathKey(registeredRoot)}/.git/worktrees/`)", to: ".startsWith('')" },
  { name: "a-caller-hands-in-a-listing", rule: "TP-6", rel: REG_REL, from: "export function resolveCheckout(sys: System, registry: TenantRegistry, root: string, projectId: string): TenantResolution | TenantRefusal {", to: "export function resolveCheckout(sys: System, registry: TenantRegistry, root: string, projectId: string, worktrees?: WorktreeListing): TenantResolution | TenantRefusal {" },
  { name: "resolve-tenant-called-from-a-second-place", rule: "TP-6", rel: GC_REL, from: "function newEnvelopeId(): string {", to: "void resolveTenant;\nfunction newEnvelopeId(): string {" },
  // TP-7
  { name: "derivation-reads-a-flag", rule: "TP-7", rel: GC_REL, from: "export function deriveProjectTenant(sys: System, root: string, source: TenantSource): TenantDerivation {\n  const projectId = declaredProjectId(sys, root);", to: "export function deriveProjectTenant(sys: System, root: string, source: TenantSource, flags: Record<string, string> = {}): TenantDerivation {\n  const projectId = flags['tenant'] ?? declaredProjectId(sys, root);" },
  { name: "derivation-reads-the-environment", rule: "TP-7", rel: REG_REL, from: "const named = gitAt(sys, install, 'rev-parse', `${commit}:./${rel}`);", to: "const named = process.env['PROJECTOS_TENANT'] ? { code: 0, stdout: 'a' } : gitAt(sys, install, 'rev-parse', `${commit}:./${rel}`);" },
  { name: "tenant-show-reads-a-flag", rule: "TP-7", rel: CMD_REL, from: "`tenant: ${binding.tenant}`,", to: "`tenant: ${String(flagsTenant)}`," },
  { name: "a-login-picks-the-tenant", rule: "TP-7", rel: GC_REL, from: "function newEnvelopeId(): string {", to: "const fromSupabaseSession = (session: { tenant: string }) => session.tenant;\nfunction newEnvelopeId(): string {" },
  { name: "envelope-tenant-from-the-request", rule: "TP-7", rel: GC_REL, from: "action: request.action,\n      subjectHash", to: "action: request.action,\n      tenant: 'owner-personal',\n      subjectHash" },
  // TP-8
  { name: "envelope-hand-built", rule: "TP-8", rel: GC_REL, from: "return admitEnvelope(minted, now, recorder, grant);", to: "return { admitted: true, envelope: minted as never };" },
  { name: "binding-not-the-derived-one", rule: "TP-8", rel: GC_REL, from: "binding: derived.binding, registry: derived.actions", to: "binding: { ...derived.binding }, registry: derived.actions" },
  { name: "run-mints-another-action", rule: "TP-8", rel: GC_REL, from: "action: 'run-start',", to: "action: 'project-selection'," },
  { name: "run-claims-the-owner", rule: "TP-8", rel: GC_REL, from: "principal: 'implementer',", to: "principal: 'owner'," },
  { name: "selection-mints-another-action", rule: "TP-8", rel: GC_REL, from: "action: 'project-selection',", to: "action: 'bridge-read'," },
  { name: "bridge-mints-another-action", rule: "TP-8", rel: BRIDGE_REL, from: "action: 'bridge-read',", to: "action: 'project-selection'," },
  { name: "bridge-claims-the-owner", rule: "TP-8", rel: BRIDGE_REL, from: "principal: 'advisor',", to: "principal: 'owner'," },
  { name: "subject-is-not-the-checkout", rule: "TP-8", rel: GC_REL, from: "const head = sys.exec('git', ['-C', root, 'rev-parse', '--verify', 'HEAD']);", to: "const head = sys.exec('git', ['-C', root, 'rev-parse', 'origin/main']);" },
  // TP-9
  { name: "held-lock-reads-as-written", rule: "TP-9", rel: REG_REL, from: "if (!takeRecordLock(sys, lock)) return false;", to: "if (!takeRecordLock(sys, lock)) return true;" },
  { name: "unreadable-file-replaced", rule: "TP-9", rel: REG_REL, from: "if (held === null && sys.exists(path)) return false;", to: "" },
  { name: "rename-failure-ignored", rule: "TP-9", rel: REG_REL, from: "if (!sys.renameFile(temporary, path)) {\n      sys.removeFile(temporary);\n      return false;\n    }\n    return sys.readText(path)?.endsWith(line) === true;", to: "sys.renameFile(temporary, path);\n    return sys.readText(path)?.endsWith(line) === true;" },
  { name: "line-not-read-back", rule: "TP-9", rel: REG_REL, from: "return sys.readText(path)?.endsWith(line) === true;", to: "return true;" },
  { name: "write-throw-reads-as-written", rule: "TP-9", rel: REG_REL, from: "return sys.readText(path)?.endsWith(line) === true;\n  } catch {\n    return false;\n  }", to: "return sys.readText(path)?.endsWith(line) === true;\n  } catch {\n    return true;\n  }" },
  { name: "no-state-dir-reads-as-recorded", rule: "TP-9", rel: REG_REL, from: "stateDir !== null && appendDurableLine(", to: "stateDir === null || appendDurableLine(" },
  { name: "run-starts-unrecorded", rule: "TP-9", rel: GC_REL, from: "intentScope: 'governed-run',\n  });\n  if (!admission.admitted) return admissionRefusalLines(admission);", to: "intentScope: 'governed-run',\n  });\n  if (!admission.admitted) return null;" },
  { name: "selection-proceeds-unrecorded", rule: "TP-9", rel: GC_REL, from: "intentScope: 'control-center-selection',\n  });\n  if (!admission.admitted) return admissionRefusalLines(admission);", to: "intentScope: 'control-center-selection',\n  });\n  if (!admission.admitted) return null;" },
  { name: "selection-outcome-ignored", rule: "TP-9", rel: GC_REL, from: "return recorded ? null :", to: "return recorded || true ? null :" },
  { name: "not-recorded-loses-its-name", rule: "TP-9", rel: GC_REL, from: "admission.rule === 'R4' ? 'ENVELOPE_NOT_RECORDED'", to: "admission.rule === 'R9' ? 'ENVELOPE_NOT_RECORDED'" },
  { name: "receipt-written-without-admission", rule: "TP-9", rel: CMD_REL, from: "if (!admission.admitted) return receiptAnswer(2, admissionRefusalLines(admission));", to: "" },
  // TP-10
  { name: "append-refusal-drops-again", rule: "TP-10", rel: BRIDGE_REL, from: "return appendDurableLine(sys, join(stateDir, 'bridge-refusals.jsonl'), entry);", to: "appendDurableLine(sys, join(stateDir, 'bridge-refusals.jsonl'), entry);\n  return true;" },
  { name: "unrecorded-refusal-not-said", rule: "TP-10", rel: BRIDGE_REL, from: "return toolResult(recorded ? lines : [...lines, `- ${unrecorded}`], true);", to: "return toolResult(lines, true);" },
  { name: "contract-refusal-outcome-ignored", rule: "TP-10", rel: BRIDGE_REL, from: "return ok(request, refusalResult(['REFUSED', ...verdict.reasons.map((r) => `- ${r}`)], recorded));", to: "return ok(request, refusalResult(['REFUSED', ...verdict.reasons.map((r) => `- ${r}`)], true));" },
  { name: "unimplemented-refusal-outcome-ignored", rule: "TP-10", rel: BRIDGE_REL, from: "`- '${verdict.operation}' is part of the bridge contract but this revision does not implement it`,\n        ],\n        recorded,", to: "`- '${verdict.operation}' is part of the bridge contract but this revision does not implement it`,\n        ],\n        true," },
  { name: "cli-refusal-outcome-ignored", rule: "TP-10", rel: GC_REL, from: "recorded ? tenantRefusalLines(r) : [...tenantRefusalLines(r), REFUSAL_NOT_RECORDED_LINE, RECORD_LOCK_HINT]", to: "tenantRefusalLines(r)" },
  { name: "refusal-record-always-claims-written", rule: "TP-10", rel: GC_REL, from: "return !door.admitted && door.recorded;", to: "return true;" },
  // TP-11
  { name: "tenant-rule-compares-nothing", rule: "TP-11", rel: REG_REL, from: "return wanted.tenant === boundTenant\n    ? null", to: "return wanted.tenant !== ''\n    ? null" },
  { name: "unlisted-project-passes-the-rule", rule: "TP-11", rel: REG_REL, from: "if (wanted === undefined) return refusal('TENANT_UNKNOWN', [`project '${requestedProjectId}' is not in the tenant registry`]);", to: "if (wanted === undefined) return null;" },
  { name: "rule-reduced-to-the-project-check", rule: "TP-11", rel: REG_REL, from: "return wanted.tenant === boundTenant\n    ? null", to: "return wanted.projectId === requestedProjectId && wanted.tenant !== ''\n    ? null" },
  { name: "bridge-skips-the-tenant-rule", rule: "TP-11", rel: BRIDGE_REL, from: "if (crossing !== null) return refused(crossing.code, recordTenantRefusal(sys, source.stateDir, crossing));", to: "" },
  { name: "tenant-rule-compares-the-asked-with-itself", rule: "TP-11", rel: BRIDGE_REL, from: "crossTenantRefusal(derived.registry, derived.binding.tenant, requested)", to: "crossTenantRefusal(derived.registry, derived.binding.tenant, deps.projectId)" },
  { name: "bridge-checks-after-reading", rule: "TP-11", rel: BRIDGE_REL, from: "  const read = admitBridgeRead(deps, verdict.operation, requested);\n  if (!read.admitted) return ok(request, refusalResult(read.lines, read.recorded));\n  const recorder = envelopeRecorder(deps.ctx.sys, read.source.stateDir);\n  let lines: readonly string[];\n  try {\n    lines = perform(verdict.operation, deps);", to: "  let lines: readonly string[];\n  const early = perform(verdict.operation, deps);\n  const read = admitBridgeRead(deps, verdict.operation, requested);\n  if (!read.admitted) return ok(request, refusalResult(read.lines, read.recorded));\n  const recorder = envelopeRecorder(deps.ctx.sys, read.source.stateDir);\n  try {\n    lines = early;" },
  { name: "unrecorded-read-answered", rule: "TP-11", rel: BRIDGE_REL, from: "if (!read.admitted) return ok(request, refusalResult(read.lines, read.recorded));", to: "" },
  { name: "read-outcome-not-recorded", rule: "TP-11", rel: BRIDGE_REL, from: "if (!recordExecution(read.envelope, 'allowed', null, deps.ctx.sys.now(), recorder)) {", to: "if (false) {" },
  { name: "stop-work-needs-a-tenant", rule: "TP-11", rel: BRIDGE_REL, from: "  if (verdict.operation === 'stop-work') {\n    const engaged = stopWork(deps);", to: "  if (verdict.operation === 'stop-work' && admitBridgeRead(deps, verdict.operation, deps.projectId).admitted) {\n    const engaged = stopWork(deps);" },
  { name: "bridge-binds-the-requested-project", rule: "TP-11", rel: BRIDGE_REL, from: "const derived = deriveTenant(sys, root, deps.projectId, source);", to: "const derived = deriveTenant(sys, root, requested, source);" },
  // TP-12
  { name: "bridge-refusal-returns-the-reasons", rule: "TP-12", rel: BRIDGE_REL, from: "if (!derived.ok) return refused(derived.code, recordTenantRefusal(sys, source.stateDir, derived));", to: "if (!derived.ok) return refused(derived.reasons.join('; '), recordTenantRefusal(sys, source.stateDir, derived));" },
  { name: "bridge-crossing-returns-the-reasons", rule: "TP-12", rel: BRIDGE_REL, from: "if (crossing !== null) return refused(crossing.code, recordTenantRefusal(sys, source.stateDir, crossing));", to: "if (crossing !== null) return refused(crossing.reasons.join('; '), recordTenantRefusal(sys, source.stateDir, crossing));" },
  { name: "tenant-refusal-not-recorded-at-the-bridge", rule: "TP-12", rel: BRIDGE_REL, from: "if (!derived.ok) return refused(derived.code, recordTenantRefusal(sys, source.stateDir, derived));", to: "if (!derived.ok) return refused(derived.code, true);" },
  { name: "crossing-not-recorded-at-the-bridge", rule: "TP-12", rel: BRIDGE_REL, from: "if (crossing !== null) return refused(crossing.code, recordTenantRefusal(sys, source.stateDir, crossing));", to: "if (crossing !== null) return refused(crossing.code, true);" },
  // TP-13
  { name: "run-loses-the-entry-refusal", rule: "TP-13", rel: RUN_REL, from: "  if (tenantRefused !== null) return fail(2, [...tenantRefused, '', 'Nothing was prepared and nothing was started.']);\n", to: "" },
  { name: "run-asks-after-the-gatekeeper", rule: "TP-13", rel: RUN_REL, from: "  const { gatekeeper, expectedDecider } = composed;\n", to: "  const { gatekeeper, expectedDecider } = composed;\n  runStartTenantRefusal(ctx, execute);\n" },
  { name: "run-skips-the-execute-flag", rule: "TP-13", rel: RUN_REL, from: "const tenantRefused = runStartTenantRefusal(ctx, execute);", to: "const tenantRefused = runStartTenantRefusal(ctx, true);" },
  { name: "compose-gatekeeper-learns-the-tenant", rule: "TP-13", rel: RUN_REL, from: "  const modeResolution = resolveGatekeeperMode(ctx.sys, ctx.root);", to: "  runStartTenantRefusal(ctx, false);\n  const modeResolution = resolveGatekeeperMode(ctx.sys, ctx.root);" },
  // TP-14
  { name: "selection-not-asked", rule: "TP-14", rel: HOST_REL, from: "const selectionRefused = projectSelectionRefusal(tenantContext(resolveProjectRoot(inventory, outcome.projectId)));", to: "const selectionRefused = null;" },
  { name: "selection-set-before-it-is-asked", rule: "TP-14", rel: HOST_REL, from: "    const selectionRefused = projectSelectionRefusal(", to: "    selectedProjectId = outcome.projectId;\n    const selectionRefused = projectSelectionRefusal(" },
  { name: "selection-refusal-ignored", rule: "TP-14", rel: HOST_REL, from: "if (selectionRefused !== null) {", to: "if (false) {" },
  { name: "verbs-not-asked", rule: "TP-14", rel: HOST_REL, from: "const tenantRefused = controlCenterTenantRefusal(tenantContext(root), check.request.verb);", to: "const tenantRefused = null;" },
  { name: "verbs-asked-after-the-act", rule: "TP-14", rel: HOST_REL, from: "  const tenantRefused = controlCenterTenantRefusal(", to: "  startGovernedRun(root, '', undefined);\n  const tenantRefused = controlCenterTenantRefusal(" },
  { name: "packaged-daemon-ignores-its-system-root", rule: "TP-14", rel: HOST_REL, from: "tenantInstallRoot: installRoot", to: "tenantInstallRoot: root" },
  { name: "every-verb-exempt", rule: "TP-14", rel: GC_REL, from: "if (CONTROL_CENTER_VERBS_WITHOUT_TENANT.includes(verb)) return null;", to: "if (verb !== '') return null;" },
  { name: "start-exempt", rule: "TP-14", rel: GC_REL, from: "['refresh', 'project.select', 'run.stop']", to: "['refresh', 'project.select', 'run.stop', 'run.start']" },
  // TP-15
  { name: "tenant-command-unwired", rule: "TP-15", rel: CLI_REL, from: "    case 'tenant':\n      return tenant(ctx, flags, positionals);\n", to: "" },
  { name: "sidecar-cannot-reach-the-rule", rule: "TP-15", rel: CLI_REL, from: "export { controlCenterTenantRefusal, projectSelectionRefusal } from './governedContext.js';\n", to: "" },
  { name: "receipt-allowed-under-the-stop", rule: "TP-15", rel: CLI_REL, from: "    case 'tenant':\n      return sub === undefined || sub === 'show';", to: "    case 'tenant':\n      return true;" },
  { name: "show-looks-elsewhere", rule: "TP-15", rel: CMD_REL, from: "const derived = deriveProjectTenant(ctx.sys, ctx.root, source);\n  if (!derived.ok) return { code: 2, lines: tenantRefusalLines(derived) };", to: "const derived = deriveProjectTenant(ctx.sys, source.installRoot, source);\n  if (!derived.ok) return { code: 2, lines: tenantRefusalLines(derived) };" },
  // TP-16
  { name: "port-grants-by-default", rule: "TP-16", rel: REG_REL, from: "export const NO_GRANT: EnvelopeGrantPort = () => false;", to: "export const NO_GRANT: EnvelopeGrantPort = () => true;" },
  { name: "boundary-port-grants-by-default", rule: "TP-16", rel: GC_REL, from: "grant: EnvelopeGrantPort = NO_GRANT,", to: "grant: EnvelopeGrantPort = () => true," },
  { name: "receipt-grant-covers-any-subject", rule: "TP-16", rel: CMD_REL, from: "envelope.action === 'tenant-registry-change' && envelope.subjectHash === blob", to: "envelope.action === 'tenant-registry-change'" },
  { name: "receipt-grant-covers-any-action", rule: "TP-16", rel: CMD_REL, from: "envelope.action === 'tenant-registry-change' && envelope.subjectHash === blob", to: "envelope.subjectHash === blob" },
  { name: "grant-built-before-the-terminal", rule: "TP-16", rel: CMD_REL, from: "  const confirmation = confirm(blob, [...changes", to: "  const earlyGrant = tenantReceiptGrant(blob);\n  void earlyGrant;\n  const confirmation = confirm(blob, [...changes" },
  { name: "receipt-is-not-the-p5-action", rule: "TP-16", rel: CMD_REL, from: "action: 'tenant-registry-change',", to: "action: 'project-selection'," },
  // TP-17
  { name: "claim-always-first", rule: "TP-17", rel: REG_REL, from: "if (sys.createExclusive(path, `${JSON.stringify(entry(1))}\\n`)) return { kind: 'first', attempt: 1 };", to: "sys.createExclusive(path, `${JSON.stringify(entry(1))}\\n`);\n  return { kind: 'first', attempt: 1 };" },
  { name: "unreadable-key-reads-as-new", rule: "TP-17", rel: REG_REL, from: "if (earlier === null) return { kind: 'unavailable', why: `the idempotency record ${path} cannot be read or written; if no run is in progress at this commit, a person may remove that file` };", to: "if (earlier === null) return { kind: 'first', attempt: 1 };" },
  { name: "completed-key-runs-again", rule: "TP-17", rel: REG_REL, from: "if (earlier.outcome === 'completed' || (earlier.outcome === 'admitted' && options.retryUnsettled !== true)) return { kind: 'duplicate', earlier };", to: "if (earlier.outcome === 'admitted' && options.retryUnsettled !== true) return { kind: 'duplicate', earlier };" },
  { name: "unsettled-key-always-retried", rule: "TP-17", rel: REG_REL, from: "(earlier.outcome === 'admitted' && options.retryUnsettled !== true)", to: "false" },
  { name: "attempt-not-counted", rule: "TP-17", rel: REG_REL, from: "const attempt = earlier.attempts + 1;", to: "const attempt = earlier.attempts;" },
  { name: "no-store-reads-as-new", rule: "TP-17", rel: REG_REL, from: "if (stateDir === null) return { kind: 'unavailable', why: 'no installation state directory can be established' };", to: "if (stateDir === null) return { kind: 'first', attempt: 1 };" },
  { name: "settle-without-a-claim", rule: "TP-17", rel: REG_REL, from: "return earlier !== null && replaceIdempotencyEntry(", to: "return replaceIdempotencyEntry(" },
  { name: "run-never-claims-its-key", rule: "TP-17", rel: GC_REL, from: "const claim = claimIdempotencyKey(sys, source.stateDir, admission.envelope, sys.now(), { retryUnsettled: true });", to: "const claim = { kind: 'first' } as { kind: 'first' } | { kind: 'retry' } | { kind: 'duplicate'; earlier: { outcome: string } } | { kind: 'unavailable'; why: string };" },
  { name: "run-ignores-a-duplicate", rule: "TP-17", rel: GC_REL, from: "if (claim.kind !== 'first' && claim.kind !== 'retry') {", to: "if (false) {" },
  // TP-18
  { name: "dry-run-mints", rule: "TP-18", rel: GC_REL, from: "  if (!execute) return null;\n  const admission", to: "  const admission" },
  { name: "dry-run-records-its-refusal", rule: "TP-18", rel: GC_REL, from: "if (!derived.ok) return execute ? recordedRefusalLines(sys, source, derived) : tenantRefusalLines(derived);", to: "if (!derived.ok) return recordedRefusalLines(sys, source, derived);" },
  // TP-19
  { name: "registry-read-from-the-project", rule: "TP-19", rel: GC_REL, from: "installRoot: typeof named === 'string' && named.trim() !== '' ? named : nodeProjectosRuntime().installRoot,", to: "installRoot: (ctx as { root: string }).root," },
  { name: "state-dir-from-the-environment", rule: "TP-19", rel: GC_REL, from: "stateDir: platformStopDirOf(ctx),", to: "stateDir: process.env['LOCALAPPDATA'] ?? null," },
  { name: "install-root-from-the-environment", rule: "TP-19", rel: GC_REL, from: "const named = (ctx as { readonly tenantInstallRoot?: unknown }).tenantInstallRoot;", to: "const named = process.env['PROJECTOS_INSTALL_ROOT'];" },
  // TP-20
  { name: "statement-hides-the-direct-write", rule: "TP-20", rel: REG_REL, from: "It does not stop a process that drives a console or writes the receipt and its line directly", to: "It does not stop a process that drives a console" },
  { name: "statement-claims-a-person", rule: "TP-20", rel: REG_REL, from: "a person or a process confirmed this registry blob at a console, nothing more", to: "the owner confirmed this registry blob" },
  { name: "statement-overclaims", rule: "TP-20", rel: REG_REL, from: "because everything here runs as one Windows user (ADR-T1 section 10).", to: "and it proves the owner confirmed it." },
  { name: "refusal-drops-the-statement", rule: "TP-20", rel: CMD_REL, from: "return { code, lines: [...lines, TENANT_RECEIPT_STATEMENT] };", to: "return { code, lines };" },
  { name: "show-drops-the-statement", rule: "TP-20", rel: CMD_REL, from: "      TENANT_RECEIPT_STATEMENT,\n", to: "" },
  { name: "evidence-hides-the-direct-write", rule: "TP-20", rel: EVIDENCE_REL, from: "process of this user can write the receipt and its line directly", to: "the receipt is safe" },
  { name: "evidence-hides-the-console", rule: "TP-20", rel: EVIDENCE_REL, from: "**It does not stop:** a process that drives a console.", to: "**It does not stop:** a process." },
  { name: "evidence-hides-the-missing-outcome-line", rule: "TP-20", rel: EVIDENCE_REL, from: "`run-start` has no execution line", to: "`run-start` is fully recorded" },
  { name: "evidence-hides-the-unstopped-duplicate", rule: "TP-20", rel: EVIDENCE_REL, from: "a repeat `run-start` is counted, not stopped", to: "a repeat `run-start` is stopped" },
  // TP-21
  { name: "suite-mocks-the-whole-module", rule: "TP-21", rel: SETUP_REL, from: "  ...(await importOriginal<typeof import('../src/governedContext.js')>()),\n", to: "" },
  { name: "suite-mocks-a-second-rule", rule: "TP-21", rel: SETUP_REL, from: "  runStartTenantRefusal: () => null,\n", to: "  runStartTenantRefusal: () => null,\n  projectSelectionRefusal: () => null,\n" },
  { name: "real-rule-never-unmocked", rule: "TP-21", rel: "projectos/agent/test/tenantPrincipal.test.ts", from: "vi.unmock('../src/governedContext.js');", to: "" },
  { name: "src-grows-a-test-switch", rule: "TP-21", rel: GC_REL, from: "export function runStartTenantRefusal(ctx: CommandContext, execute: boolean): readonly string[] | null {\n", to: "export function runStartTenantRefusal(ctx: CommandContext, execute: boolean): readonly string[] | null {\n  if (process.env['VITEST']) return null;\n" },
  { name: "src-reads-a-context-bypass", rule: "TP-21", rel: GC_REL, from: "export function runStartTenantRefusal(ctx: CommandContext, execute: boolean): readonly string[] | null {\n", to: "export function runStartTenantRefusal(ctx: CommandContext, execute: boolean): readonly string[] | null {\n  if ((ctx as unknown as { skipTenant?: boolean }).skipTenant === true) return null;\n" },
  // TP-22
  { name: "validate-all-omits-this-validator", rule: "TP-22", rel: VA_REL, from: "  \"val-projectos-tenant-principal1a\"", to: "  \"val-projectos-tenant-rls1a-copy\"" },
  { name: "cached-runner-omits-this-validator", rule: "TP-22", rel: CR_REL, from: "  \"val-projectos-tenant-principal1a\"", to: "  \"val-projectos-tenant-rls1a-copy\"" },
  // Review round: TP-1
  { name: "replace-objects-allowed", rule: "TP-1", rel: REG_REL, from: "sys.exec('git', ['--no-replace-objects', '-C', install, ...args])", to: "sys.exec('git', ['-C', install, ...args])" },
  { name: "bytes-not-hashed", rule: "TP-1", rel: REG_REL, from: "if (blobNameOf(shown.stdout, blob) !== blob) return refusal(code,", to: "if (false) return refusal(code," },
  { name: "allowlist-replace-objects-allowed", rule: "TP-1", rel: ALLOWLIST_REL, from: "sys.exec('git', ['--no-replace-objects', '-C', install, ...args])", to: "sys.exec('git', ['-C', install, ...args])" },
  { name: "allowlist-bytes-not-hashed", rule: "TP-1", rel: ALLOWLIST_REL, from: "if (named.code !== 0 || blobNameOf(shown.stdout, blob) !== blob) {", to: "if (false) {" },
  { name: "hash-ignores-the-length", rule: "TP-1", rel: ALLOWLIST_REL, from: ".update(`blob ${bytes.length}\\0`)", to: ".update('blob ')" },
  { name: "a-call-bypasses-the-flag", rule: "TP-1", rel: REG_REL, from: "const head = gitAt(sys, install, 'rev-parse', '--verify', 'HEAD');", to: "const head = sys.exec('git', ['-C', install, 'rev-parse', '--verify', 'HEAD']);" },
  { name: "old-blob-not-hashed", rule: "TP-1", rel: REG_REL, from: "if (shown.code !== 0 || blobNameOf(shown.stdout, blob) !== blob) return null;", to: "if (shown.code !== 0) return null;" },
  // TP-14
  { name: "restored-selection-unasked", rule: "TP-14", rel: HOST_REL, from: "let selectedProjectId = admittedSelection(initialSelection());", to: "let selectedProjectId = initialSelection();" },
  { name: "default-selection-unasked", rule: "TP-14", rel: HOST_REL, from: "selectedProjectId = admittedSelection(defaultSelection(inventory));", to: "selectedProjectId = defaultSelection(inventory);" },
  { name: "restored-refusal-ignored", rule: "TP-14", rel: HOST_REL, from: "if (refused === null) return projectId;", to: "if (refused !== undefined) return projectId;" },
  // TP-17
  { name: "corrupt-key-names-no-fix", rule: "TP-17", rel: REG_REL, from: "; if no run is in progress at this commit, a person may remove that file", to: "" },
  // TP-23
  { name: "run-discarded", rule: "TP-23", rel: GC_REL, from: "  ADMITTED_RUNS.set(ctx, { envelope: admission.envelope, derived });\n", to: "" },
  { name: "run-kept-before-the-claim", rule: "TP-23", rel: GC_REL, from: "  if (!admission.admitted) return admissionRefusalLines(admission);\n  const claim = claimIdempotencyKey(", to: "  if (!admission.admitted) return admissionRefusalLines(admission);\n  ADMITTED_RUNS.set(ctx, { envelope: admission.envelope, derived });\n  const claim = claimIdempotencyKey(" },
  { name: "stale-run-survives-a-refusal", rule: "TP-23", rel: GC_REL, from: "  ADMITTED_RUNS.delete(ctx);\n", to: "" },
  { name: "crossing-needs-no-run", rule: "TP-23", rel: GC_REL, from: "if (admitted === undefined) return { ok: false, rule: 'RUN_LINK', reasons: ['this context admitted no run, so it can link nothing'] };", to: "if (admitted === undefined) return { ok: true, envelope: {} as TaskEnvelope };" },
  { name: "accessor-hands-out-the-derivation", rule: "TP-23", rel: GC_REL, from: "export function admittedRunEnvelopeOf(ctx: CommandContext): TaskEnvelope | null {", to: "export function admittedRunDerivationOf(ctx: CommandContext): DerivedTenant | null {\n  return ADMITTED_RUNS.get(ctx)?.derived ?? null;\n}\n\nexport function admittedRunEnvelopeOf(ctx: CommandContext): TaskEnvelope | null {" },
  { name: "run-held-on-the-context", rule: "TP-23", rel: GC_REL, from: "const ADMITTED_RUNS = new WeakMap<object,", to: "const ADMITTED_RUNS = new Map<object," },
  // TP-24
  { name: "receipt-claims-the-owner", rule: "TP-24", rel: CMD_REL, from: "principal: 'implementer',", to: "principal: 'owner'," },
  { name: "method-not-recorded", rule: "TP-24", rel: CMD_REL, from: ", `confirmation:${TENANT_RECEIPT_CONFIRMATION}`]", to: "]" },
  { name: "method-names-a-person", rule: "TP-24", rel: REG_REL, from: "export const TENANT_RECEIPT_CONFIRMATION = 'typed-terminal';", to: "export const TENANT_RECEIPT_CONFIRMATION = 'typed-by-owner';" },
  { name: "wording-claims-the-owner", rule: "TP-24", rel: CMD_REL, from: "already has a receipt:", to: "was already confirmed by the owner:" },
  { name: "refusal-name-claims-the-owner", rule: "TP-24", rel: REG_REL, from: "  | 'TENANT_REGISTRY_NO_RECEIPT'\n", to: "  | 'TENANT_REGISTRY_NO_OWNER_RECEIPT'\n" },
  // TP-25
  { name: "prompt-hides-the-change", rule: "TP-25", rel: CMD_REL, from: "confirm(blob, [...changesSinceLastReceipt(ctx, source.installRoot, before, derived.registry), ...registrySummary(derived)])", to: "confirm(blob, [...registrySummary(derived)])" },
  { name: "change-ignores-the-tenant", rule: "TP-25", rel: CMD_REL, from: "(['tenant', 'domain', 'repository', 'governedRoot'] as const)", to: "(['domain', 'repository', 'governedRoot'] as const)" },
  { name: "removed-project-not-shown", rule: "TP-25", rel: CMD_REL, from: "`  REMOVED ${old.projectId}: tenant ${old.tenant}, domain ${old.domain}`", to: "''" },
  { name: "receipt-needs-no-line", rule: "TP-25", rel: REG_REL, from: "if (matches && hasAdmissionLine(sys, source.stateDir, read.receipt)) return null;", to: "if (matches) return null;" },
  { name: "any-line-will-do", rule: "TP-25", rel: REG_REL, from: "envelope.envelopeId === receipt.envelopeId &&\n", to: "" },
  { name: "line-for-any-blob", rule: "TP-25", rel: REG_REL, from: "envelope.subjectHash === receipt.registryBlob\n", to: "true\n" },
  { name: "refused-line-counts", rule: "TP-25", rel: REG_REL, from: "record.outcome === 'allowed' &&\n", to: "" },
  { name: "receipt-lines-in-the-rotated-file", rule: "TP-25", rel: CMD_REL, from: "envelopeRecorder(sys, source.stateDir, TENANT_CHANGE_RECORDS_FILENAME)", to: "envelopeRecorder(sys, source.stateDir)" },
  { name: "receipt-names-no-envelope", rule: "TP-25", rel: CMD_REL, from: "writeTenantReceipt(sys, source.stateDir, blob, sys.now(), admission.envelope.envelopeId)", to: "writeTenantReceipt(sys, source.stateDir, blob, sys.now(), '')" },
  // TP-26
  { name: "no-wait-for-the-lock", rule: "TP-26", rel: REG_REL, from: "    Atomics.wait(pause, 0, 0, LOCK_WAIT_STEP_MS);\n", to: "    return false;\n" },
  { name: "unbounded-wait", rule: "TP-26", rel: REG_REL, from: "for (let step = 0; step < LOCK_WAIT_STEPS; step += 1) {", to: "for (;;) {" },
  { name: "wait-grows-past-its-bound", rule: "TP-26", rel: REG_REL, from: "const LOCK_WAIT_STEPS = 40;", to: "const LOCK_WAIT_STEPS = 4000;" },
  { name: "unwritable-directory-waits", rule: "TP-26", rel: REG_REL, from: "    if (!sys.exists(lock)) return sys.createExclusive(lock, content);\n", to: "" },
  { name: "never-rotates", rule: "TP-26", rel: REG_REL, from: "Buffer.byteLength(held, 'utf8') >= DURABLE_LINE_ROTATE_BYTES", to: "false" },
  { name: "rotation-failure-ignored", rule: "TP-26", rel: REG_REL, from: "-${randomBytes(4).toString('hex')}`)) return false;\n      existing = null;", to: "-${randomBytes(4).toString('hex')}`)) existing = null;\n      existing = null;" },
  { name: "rotation-size-grows", rule: "TP-26", rel: REG_REL, from: "export const DURABLE_LINE_ROTATE_BYTES = 1_048_576;", to: "export const DURABLE_LINE_ROTATE_BYTES = 1_073_741_824;" },
  // TP-28
  { name: "registry-trust-basis-claims-the-owner", rule: "TP-28", rel: TREG_REL, from: "A receipt shows that a person or a process confirmed this blob at a console, nothing more", to: "A receipt shows the owner confirmed this blob" },
  { name: "registry-loses-dead-aisle", rule: "TP-28", rel: TREG_REL, from: "\"projectId\": \"dead-aisle\",", to: "\"projectId\": \"dead-aisle-renamed\"," },
  { name: "dead-aisle-entered-as-its-worktree", rule: "TP-28", rel: TREG_REL, from: "\"governedRoot\": \"C:/dev/deadaisle\",", to: "\"governedRoot\": \"C:/dev/deadaisle-phase6-proof1a\"," },
  { name: "added-project-moved-to-the-agency", rule: "TP-28", rel: TREG_REL, from: "\"repository\": \"github.com/jdonlinetesting/JDtesting\",\n      \"governedRoot\": \"C:/dev/JD Project\",\n      \"tenant\": \"owner-personal\",", to: "\"repository\": \"github.com/jdonlinetesting/JDtesting\",\n      \"governedRoot\": \"C:/dev/JD Project\",\n      \"tenant\": \"agency-business\"," },
  { name: "adr-hides-cwd", rule: "TP-28", rel: ADR_REL, from: "- **cwd selects the checkout.** The tenant is derived", to: "- The tenant is derived" },
  { name: "adr-overclaims-the-receipt", rule: "TP-28", rel: ADR_REL, from: "**A receipt proves a console confirmation and nothing more.** It shows", to: "It shows" },
  { name: "adr-drops-the-replace-ref-lesson", rule: "TP-28", rel: ADR_REL, from: "**The replace-ref lesson.**", to: "**A note.**" },
  { name: "adr-drops-what-git-is-read-for", rule: "TP-28", rel: ADR_REL, from: "**What the `.git` file IS read for.** It can only refuse, and it attaches nothing.", to: "**The `.git` file.**" },
  { name: "adr-drops-the-binding", rule: "TP-28", rel: ADR_REL, from: "the requester is a kernel-issued run handle that survives process boundaries, never\n  cwd", to: "the requester is known" },
  // TP-27
  { name: "evidence-drops-cwd", rule: "TP-27", rel: EVIDENCE_REL, from: "**cwd selects the checkout.** The tenant value is derived", to: "The tenant value is derived" },
  { name: "evidence-drops-the-handle", rule: "TP-27", rel: EVIDENCE_REL, from: "the requester is a kernel-issued run handle that survives process boundaries, never cwd", to: "the requester is known" },
  { name: "evidence-drops-worktree-rule", rule: "TP-27", rel: EVIDENCE_REL, from: "worktree binding alone releases nothing", to: "worktrees are fine" },
  { name: "evidence-drops-receipt-rule", rule: "TP-27", rel: EVIDENCE_REL, from: "a receipt is never a credential-release grant", to: "a receipt helps" },
  { name: "evidence-drops-jwt-rule", rule: "TP-27", rel: EVIDENCE_REL, from: "no JWT or OAuth requester", to: "requesters vary" },
  { name: "evidence-drops-the-budget", rule: "TP-27", rel: EVIDENCE_REL, from: "`run-start` has a budget", to: "budgets exist" },
  { name: "evidence-hides-dead-aisle", rule: "TP-27", rel: EVIDENCE_REL, from: "`dead-aisle`, `jd-testing`, `criclocal`", to: "`jd-testing`, `criclocal`" },
  { name: "evidence-hides-bizcomply", rule: "TP-27", rel: EVIDENCE_REL, from: "`brik`, `trading-bot`, `bizcomply-v2`", to: "`brik`, `trading-bot`" },
  { name: "evidence-hides-who-stays-refused", rule: "TP-27", rel: EVIDENCE_REL, from: "`tkn`, `erp-system`, `wizard-probe`.\n", to: "a few.\n" },
  { name: "evidence-hides-the-console-script", rule: "TP-27", rel: EVIDENCE_REL, from: "an agent could run it", to: "it is only a test" },
  // TP-10, review
  { name: "stale-lock-hint-dropped", rule: "TP-10", rel: GC_REL, from: "recorded ? tenantRefusalLines(r) : [...tenantRefusalLines(r), REFUSAL_NOT_RECORDED_LINE, RECORD_LOCK_HINT]", to: "recorded ? tenantRefusalLines(r) : [...tenantRefusalLines(r), REFUSAL_NOT_RECORDED_LINE]" },
  // TP-29
  { name: "cli-reaches-the-console-script", rule: "TP-29", rel: CLI_REL, from: "import { tenant } from './commands/tenant.js';", to: "import { tenant } from './commands/tenant.js';\nconst CONSOLE = 'test/support/conpty.ps1';" },
  { name: "tenant-command-reaches-the-console-script", rule: "TP-29", rel: CMD_REL, from: "const CONFIRMATION_LENGTH = 12;", to: "const CONFIRMATION_LENGTH = 12;\nconst DRIVER = 'receiptDriver.mjs';" },
  { name: "sidecar-reaches-the-console-script", rule: "TP-29", rel: HOST_REL, from: "import { gitBoundSystem } from './gitBoundSystem.mjs';", to: "import { gitBoundSystem } from './gitBoundSystem.mjs';\nconst CONSOLE = 'conpty.ps1';" },
  { name: "cli-binary-reaches-the-console-script", rule: "TP-29", rel: "projectos/agent/bin/projectos.js", from: "setProcessRoot(process.cwd());", to: "setProcessRoot(process.cwd());\nconst CONSOLE = 'conpty.ps1';" },
  { name: "package-script-reaches-the-console-script", rule: "TP-29", rel: "projectos/agent/package.json", from: "\"test\": \"vitest run\",", to: "\"test\": \"vitest run\",\n    \"confirm\": \"powershell -File test/support/conpty.ps1\"," },
  { name: "payload-carries-the-console-script", rule: "TP-29", rel: "projectos/control-center/packaging/build-release-payload.mjs", from: "// THE BUNDLE IS ONLY AS CURRENT AS THE `dist` IT LINKS.", to: "const CONSOLE = 'conpty.ps1';\n// THE BUNDLE IS ONLY AS CURRENT AS THE `dist` IT LINKS." },
  { name: "console-script-loses-its-label", rule: "TP-29", rel: CONSOLE_REL, from: "TEST ONLY. Nothing in production may call this", to: "A helper" },
  { name: "driver-loses-its-label", rule: "TP-29", rel: DRIVER_REL, from: "TEST ONLY. Nothing in production may call this", to: "A helper" },
  { name: "evidence-softens-the-console-script", rule: "TP-29", rel: EVIDENCE_REL, from: "makes a genuine-looking receipt and admission pair in one command", to: "is a test helper" },
  // TP-T
  { name: "a-proof-skipped", rule: "TP-T", rel: "projectos/agent/test/tenantBridgeRule.test.ts", from: "  it('still refuses a read across tenants", to: "  it.skip('still refuses a read across tenants" },
  { name: "a-proof-isolated", rule: "TP-T", rel: "projectos/agent/test/tenantPrincipal.test.ts", from: "  it('a run whose admission cannot be recorded does not start'", to: "  it.only('a run whose admission cannot be recorded does not start'" },
  { name: "a-proof-commented-out", rule: "TP-T", rel: "projectos/agent/test/tenantBridgeRule.test.ts", from: "  it('POSITIVE CONTROL: a second project in the same tenant is answered, so that refusal was not a default', () => {", to: "  // it('POSITIVE CONTROL: a second project in the same tenant is answered, so that refusal was not a default', () => {\n  it('gone', () => {" },
  { name: "a-proof-deleted", rule: "TP-T", rel: "projectos/agent/test/tenantPrincipal.test.ts", from: "a refusal that cannot be recorded stops the operation, and says it was not recorded", to: "a nice test" },
];

/** Added in this phase, in `owner-personal` under D2. Dead Aisle's governed checkout is a worktree of this root. */
const ADDED_PROJECTS = [
  ["dead-aisle", "C:/dev/deadaisle"],
  ["jd-testing", "C:/dev/JD Project"],
  ["criclocal", "C:/dev/CricLocal/criclocal-repo"],
  ["coverdrive", "C:/dev/Coverdrive/coverdrive"],
  ["boithok-khana", "C:/dev/Boithok Khana"],
  ["brik", "C:/dev/Brik"],
  ["trading-bot", "C:/dev/Trading Bot"],
  ["bizcomply-v2", "C:/dev/BizComply V2/Source"],
];
const ADR_NEEDLES = [
  "cwd selects the checkout. The tenant is derived",
  "A receipt proves a console confirmation and nothing more. It shows",
  "The replace-ref lesson.",
  "What the `.git` file IS read for. It can only refuse, and it attaches nothing.",
  "the requester is a kernel-issued run handle that survives process boundaries, never cwd",
];
const NOT_RUN = /\b(?:it|test|describe)\.(?:skip|only|todo|fails)\b|\b(?:xit|xdescribe|fit|fdescribe)\b|\.skipIf\(|\.runIf\(/;

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

/** A function's text from its declaration to the next top-level declaration. */
function fnSpan(text, name) {
  const start = text.search(new RegExp(String.raw`(export )?function ${name}\(`));
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:function |const [A-Za-z_]+\b|type |interface |declare |\/\* ---)/);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

const prose = (text) => text.replace(/\*\*/g, "").replace(/\s+/g, " ");

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  if (start < 0) return null;
  const end = text.indexOf("\n];", start);
  return end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  const src = {};
  for (const rel of ALL_SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("TP-0", `${rel} is missing`);
      return errors;
    }
    src[rel] = rel.endsWith(".md") || rel.endsWith(".json") ? raw[rel] : code(raw[rel]);
  }

  for (const [rule, rel, fn, needle] of PINS) {
    const text = fn === null ? src[rel] : fnSpan(src[rel], fn);
    if (!text.includes(needle)) E(rule, `${rel}${fn === null ? "" : ` ${fn}`} no longer holds: ${needle}`);
  }

  // TP-3: a git name is not an owner. Nothing here may read one.
  if (/--format=%(?:an|ae|cn|ce)/.test(src[REG_REL]) || /--format=%(?:an|ae|cn|ce)/.test(fnSpan(src[GC_REL], "deriveTenant"))) {
    E("TP-3", "the owner check reads a git name, which cannot tell the owner from an agent (ADR-T1 section 3)");
  }
  // TP-3: the order in the one derivation: the file, then the owner, then the match.
  const derive = fnSpan(src[GC_REL], "deriveTenant");
  const fileAt = derive.indexOf("readInstallationRegistries(");
  const ownerAt = derive.indexOf("receiptRefusal(");
  const matchAt = derive.indexOf("bindCheckout(");
  if (!(fileAt >= 0 && fileAt < ownerAt && ownerAt < matchAt)) E("TP-3", "deriveTenant no longer asks the file, then the owner, then the match");

  // TP-3: one way to pass the receipt.
  if ((fnSpan(src[REG_REL], "receiptRefusal").match(/return null;/g) || []).length !== 1) E("TP-3", "receiptRefusal has more than one way to pass");

  // TP-1: nothing on a registry read reaches git except through the one call with replacement objects off.
  if (/sys\.exec\(/.test(fnSpan(src[REG_REL], "committedBytes")) || /sys\.exec\(/.test(fnSpan(src[REG_REL], "registryAtBlob"))) {
    E("TP-1", "a registry read reaches git without --no-replace-objects");
  }

  // TP-4: the receipt is written by the one command, and no context property can stand in for the terminal.
  for (const rel of [GC_REL, RUN_REL, CLI_REL, BRIDGE_REL, HOST_REL]) {
    if (src[rel].includes("writeTenantReceipt")) E("TP-4", `${rel} can write the owner receipt`);
  }
  const receiptFn = fnSpan(src[CMD_REL], "receipt");
  if (receiptFn.indexOf("confirm(blob") < 0 || receiptFn.indexOf("confirm(blob") > receiptFn.indexOf("writeTenantReceipt(")) {
    E("TP-4", "the receipt is written without, or before, the typed confirmation");
  }
  if (/\bctx\s+as\b[^\n]*confirm/.test(src[CMD_REL]) || /\.confirm\b/.test(src[CMD_REL])) E("TP-4", "the confirmation is reachable through the context");
  if (/return tenant\(ctx, flags, positionals,/.test(src[CLI_REL])) E("TP-4", "production passes its own confirmation");

  // TP-5: the checkout is canonical before it is judged, and only this file judges.
  // TP-6: one caller of `resolveTenant`, no listing from outside.
  for (const rel of NOT_IN_CALLERS) {
    if (/\bresolveTenant\b/.test(src[rel])) E("TP-6", `${rel} reaches resolveTenant, which only tenantRegistry.ts may call`);
    if (/\blinkedWorktreesFromPorcelain\b/.test(src[rel])) E("TP-6", `${rel} builds a worktree listing`);
  }
  if ((src[REG_REL].match(/\bresolveTenant\(/g) || []).length !== 1) E("TP-6", "resolveTenant is called other than once");
  if (/--git-common-dir|--git-dir/.test(src[REG_REL])) E("TP-6", "a worktree's own claim is consulted");
  if (/WorktreeListing\b[^\n]*\{\s*$/m.test(fnSpan(src[REG_REL], "resolveCheckout").split("\n")[0]) || /worktrees\?:/.test(fnSpan(src[REG_REL], "resolveCheckout"))) {
    E("TP-6", "resolveCheckout takes a listing from its caller");
  }

  // TP-7: derived, never supplied, and no login in sight.
  const derivation = [fnSpan(src[GC_REL], "tenantSourceOf"), fnSpan(src[GC_REL], "readInstallationRegistries"), fnSpan(src[GC_REL], "bindCheckout"), derive, fnSpan(src[GC_REL], "declaredProjectId"), fnSpan(src[GC_REL], "deriveProjectTenant"), fnSpan(src[GC_REL], "admitBoundary")].join("\n");
  if (/\bflags\b|\bargv\b/.test(derivation)) E("TP-7", "the derivation reads a flag or argv");
  if (/process\.env/.test(src[REG_REL]) || /process\.env/.test(derivation)) E("TP-7", "the derivation reads the environment by name");
  if (/flagsTenant|flags\[['"](?:tenant|domain)['"]\]|str\(flags, ['"](?:tenant|domain)['"]\)/.test(src[CMD_REL])) E("TP-7", "`tenant` reads a tenant from a flag");
  for (const rel of [REG_REL, CMD_REL]) if (/supabase|\bjwt\b/i.test(src[rel])) E("TP-7", `${rel} mentions a cloud login, which carries no kernel authority`);
  if (/supabase|\bjwt\b/i.test(derivation) || /fromSupabaseSession|supabase/i.test(src[GC_REL])) E("TP-7", "the governed context mentions a cloud login, which carries no kernel authority");
  if (/\btenant: '|\bdomain: '/.test(fnSpan(src[GC_REL], "admitBoundary"))) E("TP-7", "the envelope request names a tenant");

  // TP-8: nothing outside the core builds an envelope.
  for (const rel of [REG_REL, GC_REL, CMD_REL, BRIDGE_REL, RUN_REL]) {
    if (/envelopeVersion/.test(src[rel])) E("TP-8", `${rel} builds an envelope by hand`);
  }
  if (/\{ \.\.\.derived\.binding \}/.test(src[GC_REL])) E("TP-8", "a copy of the binding is not a binding");

  // TP-23: held in a weak map, kept only after the whole admission, and one accessor out.
  const runStartBody = fnSpan(src[GC_REL], "runStartTenantRefusal");
  if (runStartBody.indexOf("ADMITTED_RUNS.set(") < runStartBody.indexOf("if (claim.kind !== 'first'")) E("TP-23", "the run is kept before its key was claimed");
  if ((src[GC_REL].match(/ADMITTED_RUNS\.get\(/g) || []).length !== 2 || /export (?:const|function) \w*Derivation\w*Of\b/.test(src[GC_REL])) E("TP-23", "the admitted run leaves through something other than its narrow accessor");

  // TP-24: nothing says the owner did it. Code is checked here; the code name is one word everywhere.
  for (const rel of [REG_REL, CMD_REL, GC_REL, BRIDGE_REL]) {
    if (/NO_OWNER_RECEIPT|principal: 'owner'|by the owner|owner confirmed/i.test(src[rel])) E("TP-24", `${rel} claims the owner where only a console was shown`);
  }

  // TP-11: order in the handler: the contract, then stop-work, then the tenant, then the read.
  const handler = fnSpan(src[BRIDGE_REL], "handleBridgeRpc");
  const stopAt = handler.indexOf("verdict.operation === 'stop-work'");
  const admitAt = handler.indexOf("admitBridgeRead(deps, verdict.operation, requested)");
  const performAt = handler.indexOf("perform(verdict.operation, deps)");
  if (!(stopAt >= 0 && stopAt < admitAt && admitAt < performAt) || (handler.match(/perform\(/g) || []).length !== 1) {
    E("TP-11", "the bridge no longer asks the tenant rule before it reads, or stop-work now passes through it");
  }
  if (/admitBridgeRead\(deps, verdict\.operation, deps\.projectId\)/.test(handler)) E("TP-11", "stop-work passes through the tenant rule");

  // TP-12: the far end gets a code.
  const bridgeRead = fnSpan(src[BRIDGE_REL], "admitBridgeRead");
  if (/\.reasons/.test(bridgeRead)) E("TP-12", "a tenant refusal's reasons travel back over the bridge");
  if (/refused\([^,]+, true\)/.test(bridgeRead)) E("TP-12", "a bridge refusal claims a record it did not check");

  // TP-13: one entry refusal, after the git check and before the gatekeeper, and no more.
  const run = src[RUN_REL];
  const runFn = fnSpan(run, "run");
  const refusalAt = runFn.indexOf("runStartTenantRefusal(ctx, execute)");
  const gitAt = runFn.indexOf("REFUSED (GIT_UNAVAILABLE)");
  const gatekeeperAt = runFn.indexOf("composeGatekeeper(ctx,");
  if ((run.match(/\brunStartTenantRefusal\(/g) || []).length !== 1 || !(gitAt >= 0 && gitAt < refusalAt && refusalAt < gatekeeperAt) ||
      !/const tenantRefused = runStartTenantRefusal\(ctx, execute\);\s*if \(tenantRefused !== null\) return fail\(2, \[\.\.\.tenantRefused, '', 'Nothing was prepared and nothing was started\.'\]\);/.test(run)) {
    E("TP-13", "run.ts no longer holds exactly one entry refusal, after git and before the gatekeeper");
  }
  if (/tenant/i.test(fnSpan(run, "composeGatekeeper"))) E("TP-13", "composeGatekeeper learned about the tenant");

  // TP-14: selection is asked before it takes effect, and verbs are asked before they act.
  const host = fnSpan(src[HOST_REL], "handleGovernedCommand");
  const askedAt = host.indexOf("projectSelectionRefusal(");
  const setAt = host.indexOf("selectedProjectId = outcome.projectId;");
  const verbAskedAt = host.indexOf("controlCenterTenantRefusal(");
  const actAt = Math.min(...["startGovernedRun(root,", "startOffLoopCommand({", "const COMMANDS = {"].map((n) => {
    const i = host.indexOf(n);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }));
  if (!(askedAt >= 0 && askedAt < setAt) || !/if \(selectionRefused !== null\) \{/.test(host)) E("TP-14", "a project is selected before its tenant is asked");
  if (!(verbAskedAt >= 0 && verbAskedAt < actAt) || !/if \(tenantRefused !== null\) \{/.test(host)) E("TP-14", "a verb acts before its tenant is asked");
  const exempt = /CONTROL_CENTER_VERBS_WITHOUT_TENANT: readonly string\[\] = \[([^\]]*)\]/.exec(src[GC_REL]);
  if (exempt === null || exempt[1] !== "'refresh', 'project.select', 'run.stop'") E("TP-14", "the verbs that skip the tenant are not exactly refresh, project.select and run.stop");
  if (/import \{[^}]*\bcontrolCenterTenantRefusal\b[^}]*\} from '@projectos\/agent'/.test(src[HOST_REL]) === false) E("TP-14", "the sidecar keeps a copy of the rule instead of importing the agent's");

  // TP-16: the grant closure comes after the terminal.
  const grantAt = receiptFn.indexOf("tenantReceiptGrant(blob)");
  if (grantAt < receiptFn.indexOf("if (confirmation.text !==") || (receiptFn.match(/tenantReceiptGrant\(/g) || []).length !== 1) {
    E("TP-16", "the receipt's grant exists before the person has typed");
  }

  // TP-20: the honest limit, in the code and in the evidence.
  const statement = /TENANT_RECEIPT_STATEMENT =([\s\S]*?);\n/.exec(src[REG_REL]);
  if (statement === null || !statement[1].includes(RECEIPT_LIMIT) || !statement[1].includes(RECEIPT_CLAIM) || !statement[1].includes("one Windows user")) {
    E("TP-20", "the receipt's statement no longer says what it does not stop");
  }
  const evidence = prose(src[EVIDENCE_REL]);
  for (const needle of EVIDENCE_NEEDLES.slice(0, 4)) if (!evidence.includes(needle)) E("TP-20", `the evidence no longer says: ${needle}`);
  for (const needle of EVIDENCE_NEEDLES.slice(4)) if (!evidence.includes(needle)) E("TP-27", `the evidence no longer says: ${needle}`);

  // TP-21: the suite's one replacement stays one, and src has no switch for it.
  const setup = src[SETUP_REL];
  const mockAt = /vi\.mock\('\.\.\/src\/governedContext\.js', async \(importOriginal\) => \(\{\s*\.\.\.\(await importOriginal<typeof import\('\.\.\/src\/governedContext\.js'\)>\(\)\),\s*runStartTenantRefusal: \(\) => null,\s*\}\)\);/;
  if (!mockAt.test(setup) || (setup.match(/vi\.mock\(/g) || []).length !== 1) E("TP-21", "the suite's mock is no longer exactly one function");
  if (!/vi\.unmock\('\.\.\/src\/governedContext\.js'\);/.test(src["projectos/agent/test/tenantPrincipal.test.ts"])) E("TP-21", "nothing runs the real entry refusal");
  const runStart = fnSpan(src[GC_REL], "runStartTenantRefusal");
  if (/VITEST|NODE_ENV|skipTenant|process\.env/.test(runStart) || /\(ctx as [^)]*\)/.test(runStart)) E("TP-21", "the run entry has a switch");

  // TP-22: registered, in both lists, identically.
  const va = modulesOf(src[VA_REL]);
  const cr = modulesOf(src[CR_REL]);
  if (va === null || !va.includes(THIS_VALIDATOR)) E("TP-22", "validate-all does not run this validator");
  if (cr === null || !cr.includes(THIS_VALIDATOR)) E("TP-22", "cached-runner does not run this validator");

  // TP-28: the registry's added lines, and what ADR-T1 now rules.
  let registry = null;
  try {
    registry = JSON.parse(raw[TREG_REL]);
  } catch {
    registry = null;
  }
  const lines = registry !== null && Array.isArray(registry.projects) ? registry.projects : [];
  const line = (id) => lines.find((entry) => entry.projectId === id);
  for (const [id, governedRoot] of ADDED_PROJECTS) {
    const entry = line(id);
    if (entry === undefined || entry.tenant !== "owner-personal" || entry.governedRoot !== governedRoot) E("TP-28", `the registry's line for '${id}' is not the one this phase added`);
  }
  if (registry === null || typeof registry.trustBasis !== "string" || !registry.trustBasis.includes(RECEIPT_CLAIM.replace("this registry blob", "this blob")) || !registry.trustBasis.includes("replacement objects off")) {
    E("TP-28", "the registry's trustBasis no longer says what a receipt shows, or how its bytes are read");
  }
  const adr = prose(src[ADR_REL]);
  for (const needle of ADR_NEEDLES) if (!adr.includes(needle)) E("TP-28", `ADR-T1 no longer says: ${needle}`);

  // TP-29: the console script stays a test's. Raw text, so a comment that names it counts as well.
  for (const rel of PRODUCTION_REL) if (TEST_ONLY_NAMES.test(raw[rel])) E("TP-29", `${rel} reaches a test-only console script`);
  for (const rel of [CONSOLE_REL, DRIVER_REL]) if (!raw[rel].includes("TEST ONLY. Nothing in production may call this")) E("TP-29", `${rel} no longer says it is test-only`);
  if (!prose(raw[EVIDENCE_REL]).includes("makes a genuine-looking receipt and admission pair in one command")) E("TP-29", "the evidence no longer says what the console script can do");

  // TP-T: every proof exists, and every proof runs.
  for (const [rel, needles] of Object.entries(TESTS)) {
    for (const n of needles) if (!src[rel].includes(n)) E("TP-T", `${rel} no longer proves "${n}"`);
    if (NOT_RUN.test(src[rel])) E("TP-T", `${rel} skips or isolates a test: ${NOT_RUN.exec(src[rel])[0]}`);
  }
  return errors;
}

/** Every named mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`TP-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, () => m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`TP-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("TP-M: two mutations share a name");
  const rules = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of [...Array.from({ length: 29 }, (_, i) => `TP-${i + 1}`), "TP-T"]) {
    if (!rules.has(rule)) errors.push(`TP-M: rule ${rule} has no named mutation`);
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
