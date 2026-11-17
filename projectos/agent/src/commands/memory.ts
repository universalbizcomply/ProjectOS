// Origin: original ProjectOS code
/**
 * `projectos memory`: THE OWNER'S COMMANDS FOR MEMORY (PROJECTOS-MEMORY-OWNER-COMMANDS1A, Stage 3 carry-forward).
 *
 *   projectos memory index rebuild               build this project's derived search index (local, no owner)
 *   projectos memory index delete [--reason ..]  delete this project's derived index (local, no owner, recorded)
 *   projectos memory delete --path P --reason R [--hash H]   delete one memory item: the owner, at a terminal
 *   projectos memory proposals [--id mem-..]     list the proposals waiting, or read one (read-only)
 *   projectos memory approve --id mem-..         land one pending proposal: the owner, at a terminal
 *   projectos memory reject --id mem-..          reject one pending proposal: the owner, at a terminal
 *
 * THIS IS WIRING AND OWNER PROOF, NOT NEW MEMORY LOGIC. Every rule is a function that already existed and had no caller:
 * `deleteMemoryItem` and `deleteDerivedIndex` (with the deletion ledger), `approveMemoryProposal` and `rejectMemoryProposal`,
 * `rebuildProject` with `collectDocumentSources` and `collectStoreSources`, `provenanceReplacementProblem`, and the typed terminal
 * confirmation the tenant receipt uses. What is new is only the order they are called in and the refusal each one is given.
 *
 * THE PROJECT IS NEVER AN ARGUMENT. The tenant and the project are what the installation's tenant registry says this checkout is
 * (`checkoutIdentityOf`). A `--tenant` or `--project` flag is not read, and a checkout the registry does not name refuses every
 * command, with the cause.
 *
 * NOTHING DECIDES WITHOUT THE OWNER AT A TERMINAL. A deletion, an approval and a rejection ask `terminalAvailable` first (both
 * streams must be a TTY, so an agent, a pipe or a redirect gets a refusal and nothing is written), then the typed confirmation
 * bound to the item, its hash, the tenant and the project. The verifier is a parameter that production never passes: a context is
 * a bag callers assemble, and an owner check reachable through it would be one they could satisfy by attaching a function.
 *
 * A DELETION IS RECORDED BEFORE IT HAPPENS. `deleteMemoryItem` appends `authorised` to the deletion ledger, removes the item, and
 * appends `deleted`; every refusal is a ledger entry too. This command prints where the ledger stands (the count and the hash of
 * the last entry) so the owner can commit it: a chain cannot show that its newest entries were cut off, and a hash kept in git can.
 *
 * AN ITEM A COMMITTED DECISION CITES IS NOT DELETED HERE, and neither is one whose decisions cannot be read. The deletion rule
 * itself lets the owner delete a cited item; this command is stricter on purpose, because the owner cannot see through a
 * decision's text what rests on it. The refusal is made inside the ask, so it is recorded with its `citedByDecision` value and the
 * owner is never asked about an item the command will not remove.
 *
 * STORED TEXT IS DATA. Nothing from a store, a proposal or a reason is printed except through `fencedStoredText` or `visibleText`.
 *
 * `index rebuild` WRITES ONE FILE, the project's own index under the installation state directory, and records the commit HEAD was
 * at BEFORE the sources were read. It writes nothing inside the project tree.
 */
import {
  MEMORY_DELETION_LEDGER_DIR,
  decisionCitesItem,
  isProjectId,
  isTenantId,
  memoryCharLimit,
  memoryClassOfPath,
  provenanceReplacementProblem,
  sha256Hex,
  type MemoryDeletionClaim,
  type MemoryDeletionCode,
  type MemoryProposal,
  type MemoryRefusalCode,
  type MemoryResult,
  type OwnerDeletionVerifier,
  type ProvenanceReplacementCode,
} from '@projectos/core';
import { checkoutIdentityOf } from '../context/contextCheckout.js';
import type { ContextCheckoutIdentity, ContextCheckoutProblem } from '../context/contextPorts.js';
import type { CommandContext, CommandResult } from '../context.js';
import { type Flags, str } from '../flags.js';
import {
  MAX_DELETABLE_ITEM_BYTES,
  approveMemoryProposal,
  deleteDerivedIndex,
  deleteMemoryItem,
  listPendingMemoryProposals,
  loadMemoryProposal,
  readCommittedDecisionTexts,
  readDeletionLedger,
  readMemoryStore,
  rejectMemoryProposal,
  type DeletionFiles,
  type MemoryCaller,
  type MemoryDeletionRefusal,
} from '../memory/index.js';
import {
  OWNER_CONFIRMATION_STATEMENT,
  fencedStoredText,
  PROMPT_MAX_LINES,
  fencedWholeText,
  indexDeletionClaimOf,
  lineCountOf,
  proposalDecisionClaimOf,
  terminalAvailable,
  terminalDeletionVerifier,
  terminalIndexVerifier,
  terminalProposalVerifier,
  visibleText,
  type OwnerTerminal,
} from '../memory/ownerTerminalVerifier.js';
import { nodeInstallationStateDir } from '../nodeRuntimeRoot.js';
import {
  collectDocumentSources,
  collectStoreSources,
  documentFsOver,
  gitRunnerOver,
  nodeEnsureDirectory,
  nodeEntryProbe,
  openProjectSearchIndex,
  projectIndexLocation,
  searchClockOver,
  searchHeadOver,
  type DocumentFs,
  type EntryProbe,
} from '../search/index.js';
import type { System } from '../system.js';
import { nodeTerminal } from './tenant.js';

const USAGE: readonly string[] = [
  'Usage:',
  '  projectos memory index rebuild               build this project’s derived search index (local, no owner)',
  '  projectos memory index delete [--reason ..]  delete this project’s derived search index (local, recorded)',
  '  projectos memory delete --path <p> --reason <why> [--hash <sha256>]  delete one memory item: the owner, in a terminal',
  '  projectos memory proposals [--id <mem-..>]   list the proposals waiting, or read one: read-only',
  '  projectos memory approve --id <mem-..>       land one pending proposal: the owner, in a terminal',
  '  projectos memory reject --id <mem-..>        reject one pending proposal: the owner, in a terminal',
];

/** The things this command reaches outside the process for. A test passes its own; production never passes any. */
export interface MemoryCommandDeps {
  /** What this checkout is governed as, from the installation's tenant registry. Never from an argument. */
  readonly identity: (ctx: CommandContext) => ContextCheckoutIdentity | ContextCheckoutProblem | null;
  readonly terminal: () => OwnerTerminal;
  /** The installation's directory for per-project indexes, or null when there is no installation state. */
  readonly indexDirectory: () => string | null;
  readonly entryProbe: EntryProbe;
  readonly ensureDirectory: (directory: string) => void;
  /** The text of every committed decision, or null when they cannot be read. */
  readonly committedDecisions: (ctx: CommandContext) => readonly string[] | null;
}

function nodeDeps(): MemoryCommandDeps {
  return {
    identity: (ctx) => checkoutIdentityOf(ctx.sys, ctx.root),
    terminal: nodeTerminal,
    indexDirectory: () => {
      const state = nodeInstallationStateDir();
      return state === null ? null : `${state}/search-index`;
    },
    entryProbe: nodeEntryProbe,
    ensureDirectory: nodeEnsureDirectory,
    committedDecisions: (ctx) => readCommittedDecisionTexts(gitRunnerOver(ctx.sys, ctx.root)),
  };
}

type LocalCode =
  | 'MEMORY_COMMAND_USAGE'
  | 'MEMORY_CHECKOUT_NO_PROJECT_CONFIG'
  | 'MEMORY_CHECKOUT_REGISTRY_UNREADABLE'
  | 'MEMORY_CHECKOUT_NOT_REGISTERED'
  | 'MEMORY_CHECKOUT_UNKNOWN'
  | 'MEMORY_OWNER_NEEDS_A_TERMINAL'
  | 'MEMORY_OWNER_NOT_CONFIRMED'
  | 'MEMORY_DELETE_CITED_BY_DECISION'
  | 'MEMORY_DELETE_DECISIONS_UNREADABLE'
  | 'MEMORY_DELETE_PATH_SPELLING'
  | 'MEMORY_DELETE_ITEM_CHANGED'
  | 'MEMORY_TEXT_NOT_SHOWN_IN_FULL'
  | 'MEMORY_TEXT_TOO_MANY_LINES'
  | 'MEMORY_DECISION_NOT_CHANGED_HERE'
  | 'MEMORY_INDEX_NO_STATE_DIRECTORY'
  | 'MEMORY_INDEX_UNAVAILABLE';

type KnownCode = LocalCode | MemoryDeletionRefusal | MemoryDeletionCode | MemoryRefusalCode | ProvenanceReplacementCode;

/** Every code this command can print, each with the plain next step. Typed over the closed code sets, so a new code is a compile error until it has one. */
const NEXT_STEP: Readonly<Record<KnownCode, string>> = {
  MEMORY_COMMAND_USAGE: 'run `projectos memory` for the commands and their flags',
  MEMORY_CHECKOUT_NO_PROJECT_CONFIG: 'run this from a governed project checkout, one with .projectops/project-config.json',
  MEMORY_CHECKOUT_REGISTRY_UNREADABLE: 'run `projectos tenant show`: the installation tenant registry must be committed and readable',
  MEMORY_CHECKOUT_NOT_REGISTERED: 'this checkout is not in the installation tenant registry; adding it is the owner act `tenant-registry-change`',
  MEMORY_CHECKOUT_UNKNOWN: 'run `projectos tenant show` and `projectos doctor`; nothing was changed',
  MEMORY_OWNER_NEEDS_A_TERMINAL: 'run this yourself in PowerShell or Windows Terminal; Git Bash, a pipe, a redirect and an agent give no terminal',
  MEMORY_OWNER_NOT_CONFIRMED: 'run the command again and retype the code exactly as it is shown',
  MEMORY_DELETE_CITED_BY_DECISION: 'a committed decision names this item; replace that decision with a new committed one first, then delete',
  MEMORY_DELETE_DECISIONS_UNREADABLE: 'the committed decisions could not all be read; check `git status` for this checkout and try again',
  MEMORY_DELETE_PATH_SPELLING: 'give the path exactly as the directory spells it, in the same case, with no trailing dot or space and no ~1 short name; `git ls-files` shows it',
  MEMORY_DELETE_ITEM_CHANGED: 'the item changed after it was read, so what was shown is not what would be deleted; run the command again',
  MEMORY_TEXT_NOT_SHOWN_IN_FULL: 'the text is longer than the store allows, so it cannot be shown in full and is not asked about; reject it with `projectos memory reject --id <id>` (reject shows the text cut, with its hash and size), and have it proposed again within the limit',
  MEMORY_TEXT_TOO_MANY_LINES: 'the text has more lines than a prompt shows, so it is not asked about; reject it with `projectos memory reject --id <id>` (reject shows the text cut, with its hash and size), and have it proposed again in fewer lines',
  MEMORY_DECISION_NOT_CHANGED_HERE: 'a decision is changed by committing a new decision, not by a proposal; reject this one',
  MEMORY_INDEX_NO_STATE_DIRECTORY: 'the installation has no state directory; run `projectos doctor`',
  MEMORY_INDEX_UNAVAILABLE: 'the index could not be opened or built; it is derived, so `projectos memory index delete` and a rebuild are safe',
  DELETE_REQUEST_INVALID: 'give --path, --reason (one line, 500 characters at most) and, if you give one, a --hash of 64 hex characters',
  DELETE_BINDING_INVALID: 'the checkout path cannot be named in a confirmation; run this from the project root',
  DELETE_NOT_A_MEMORY_ITEM: 'only files under .projectops/ that belong to a memory class can be deleted here; a document is not one',
  DELETE_ITEM_ABSENT: 'there is no such item at that path; check the path with `git status`',
  DELETE_HASH_MISMATCH: 'the item changed or the hash is not its own; leave out --hash and read what is shown',
  DELETE_OWNER_VERIFIER_MISSING: 'no owner check is available in this process; run it yourself in a terminal',
  DELETE_OWNER_NOT_VERIFIED: 'the code was not typed exactly; run the command again and retype it as shown',
  DELETE_ITEM_NOT_REGULAR: 'that path is a link, a directory or too large to be an item; nothing was removed',
  DELETE_NOT_THIS_PROJECT: 'the request named another project; this command only acts on the checkout it runs in',
  DELETE_REMOVE_FAILED: 'the file could not be removed and the ledger says so; check the file is not open elsewhere and try again',
  DELETION_LEDGER_UNAVAILABLE: 'the deletion ledger could not be read or written, so nothing was removed; check .projectops/memory-deletions',
  DELETION_CLOCK_UNAVAILABLE: 'the system clock gave no usable time, so nothing was removed; try again',
  MEMORY_EMPTY: 'the proposal holds no text; reject it',
  MEMORY_ENTRY_SPLITS: 'the proposal would not read back as one entry; reject it and propose it again',
  MEMORY_OVER_LIMIT: 'the store would be over its size cap; free room first by approving a remove, then try again',
  MEMORY_RENDERED_OVER_LIMIT: 'the store would be over its size cap when shown; free room first, then try again',
  MEMORY_THREAT: 'the text matches a threat pattern; reject the proposal',
  MEMORY_CREDENTIAL: 'the text holds a credential; reject the proposal and rotate the credential if it was real',
  MEMORY_INSTRUCTION_SHAPED: 'the text reads as an instruction to a model; reject the proposal',
  MEMORY_LOSSY_TEXT: 'the text has characters that do not survive storage; reject the proposal',
  MEMORY_DUPLICATE: 'that text is already held; reject the proposal',
  MEMORY_NO_MATCH: 'no entry matches the proposal; reject it',
  MEMORY_AMBIGUOUS: 'more than one entry matches the proposal; reject it and propose it again more exactly',
  MEMORY_STALE: 'the store or the proposal changed since it was read; read it again with `projectos memory proposals --id <id>` and decide again',
  MEMORY_TAMPERED: 'the proposal file is not what its hash says; do not approve it, and reject it',
  MEMORY_NOT_OWNER: 'only the owner decides a proposal, and this process is not the owner',
  MEMORY_NOT_APPROVED: 'the proposal was not approved here, so nothing landed',
  MEMORY_ALREADY_DECIDED: 'the proposal is already decided; list the waiting ones with `projectos memory proposals`',
  MEMORY_DECISION_PROTECTED: 'that entry is a decision or has no record of its origin; only the owner’s own writing, not a summary, may change it',
  MEMORY_PROVENANCE: 'the proposal names no author, session or time; reject it',
  MEMORY_LEDGER_REF: 'a decision must point at its record in git; reject the proposal and propose it with a reference',
  MEMORY_UNREADABLE: 'a memory file exists and cannot be read, so nothing was written; check .projectops/memory',
  MEMORY_NOT_FOUND: 'there is no such proposal; list the waiting ones with `projectos memory proposals`',
  MEMORY_LOCKED: 'another memory write holds the lock; if none is running, remove the .memory.lock file the message names',
  MEMORY_WRITE_FAILED: 'the memory files could not be written; check .projectops/memory and try again',
  MEMORY_LANDED_INCOMPLETE: 'the entry landed but its records did not finish; do not approve it again; another write will prune them',
  MEMORY_QUEUE_FULL: 'the queue is full; decide some of the waiting proposals first',
  PROVENANCE_REPLACEMENT_INVALID: 'the replacement could not be judged; reject the proposal',
  PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION: 'a summary never replaces a decision; reject the proposal',
  PROVENANCE_DECISION_NOT_REPLACEABLE: 'a committed decision is not replaced by a proposal; supersede it with a new committed decision',
  PROVENANCE_LOWER_RANK_CANNOT_REPLACE: 'approved memory outranks what a worker or a summary proposes; reject it, or have the owner write the change as an owner proposal',
};

/** Every code this command can print, so a test and a validator can see none lacks a next step. */
export const MEMORY_COMMAND_CODES: readonly string[] = Object.freeze(Object.keys(NEXT_STEP));

const REFUSED_EXIT = 2;
const USAGE_EXIT = 1;
const REASON_CAP = 300;

function refusal(code: KnownCode, reason: string, exit = REFUSED_EXIT): CommandResult {
  return { code: exit, lines: [`REFUSED (${code}): ${visibleText(reason, REASON_CAP)}`, `  next: ${NEXT_STEP[code]}`] };
}

const usageRefusal = (reason: string): CommandResult => ({ code: USAGE_EXIT, lines: [...refusal('MEMORY_COMMAND_USAGE', reason).lines, ...USAGE] });

/** A decision's answer, refusal or success, carries what a typed confirmation does and does not prove. */
const decided = (result: CommandResult): CommandResult => ({ code: result.code, lines: [...result.lines, OWNER_CONFIRMATION_STATEMENT] });

const memoryRefusal = (result: Extract<MemoryResult<unknown>, { ok: false }>): CommandResult => refusal(result.refusal.code, result.refusal.message);

type Identity = { readonly ok: true; readonly tenant: string; readonly project: string } | { readonly ok: false; readonly result: CommandResult };

function problemRefusal(found: ContextCheckoutIdentity | ContextCheckoutProblem | null): CommandResult {
  const cause = found === null ? null : (found as ContextCheckoutProblem).cause;
  switch (cause) {
    case 'no-project-config':
      return refusal('MEMORY_CHECKOUT_NO_PROJECT_CONFIG', 'this directory names no project: it has no readable project configuration');
    case 'registry-unreadable':
      return refusal('MEMORY_CHECKOUT_REGISTRY_UNREADABLE', 'the installation tenant registry could not be read');
    case 'not-registered':
      return refusal('MEMORY_CHECKOUT_NOT_REGISTERED', 'the installation tenant registry does not name this checkout');
    default:
      return refusal('MEMORY_CHECKOUT_UNKNOWN', 'the installation could not say what this checkout is governed as');
  }
}

/** The tenant and project this checkout is, from the registry and from nothing the caller typed. */
function identityOf(ctx: CommandContext, deps: MemoryCommandDeps): Identity {
  let found: ContextCheckoutIdentity | ContextCheckoutProblem | null;
  try {
    found = deps.identity(ctx);
  } catch {
    found = null;
  }
  const { tenant, project } = (found ?? {}) as Partial<ContextCheckoutIdentity>;
  if (isTenantId(tenant) && isProjectId(project)) return { ok: true, tenant, project };
  return { ok: false, result: problemRefusal(found) };
}

function terminalOf(deps: MemoryCommandDeps): OwnerTerminal | null {
  try {
    const terminal = deps.terminal();
    return terminalAvailable(terminal) ? terminal : null;
  } catch {
    return null;
  }
}

const needsTerminal = (): CommandResult =>
  decided(refusal('MEMORY_OWNER_NEEDS_A_TERMINAL', 'this is decided in an interactive terminal: standard input and standard output must both be one, and this process has none'));

const SHA256 = /^[0-9a-f]{64}$/;
const ZERO_HASH = '0'.repeat(64);

function deletionFilesOver(sys: System): DeletionFiles {
  return {
    readText: (path) => sys.readText(path),
    listDir: (path) => sys.listDir(path),
    exists: (path) => sys.exists(path),
    createExclusive: (path, content) => sys.createExclusive(path, content),
    removeFile: (path) => sys.removeFile(path),
  };
}

/** Where the deletion ledger stands, for the owner to commit. */
function ledgerLines(sys: System, root: string): readonly string[] {
  const ledger = readDeletionLedger(deletionFilesOver(sys), root);
  if (!ledger.ok) return [`deletion ledger: not readable (${ledger.code}); fix it before the next deletion`];
  return [
    `deletion ledger: ${ledger.count} entries, head ${ledger.lastHash}`,
    `  commit ${MEMORY_DELETION_LEDGER_DIR} so this record is in git; this command does not commit`,
  ];
}

/** The item as the owner will see it, read the way the deletion reads it: every directory asked, a link never followed, a size cap first. */
function readRegularItem(fs: DocumentFs, root: string, path: string): { readonly hash: string; readonly text: string } | null {
  if (memoryClassOfPath(path) === null) return null;
  const segments = path.split('/');
  for (let length = 1; length < segments.length; length += 1) {
    const stat = fs.stat(`${root}/${segments.slice(0, length).join('/')}`);
    if (stat === null || stat.kind !== 'directory') return null;
  }
  const stat = fs.stat(`${root}/${path}`);
  if (stat === null || stat.kind !== 'file' || stat.size > MAX_DELETABLE_ITEM_BYTES) return null;
  const text = fs.readText(`${root}/${path}`);
  return text === null ? null : { hash: sha256Hex(text), text };
}

function decisionsOf(ctx: CommandContext, deps: MemoryCommandDeps): readonly string[] | null {
  try {
    return deps.committedDecisions(ctx);
  } catch {
    return null;
  }
}

const BACKSLASH = String.fromCharCode(92);
const SHORT_NAME = /~\d/;
const TRAILING_DOT_OR_SPACE = /[. ]$/;

/** A citation compared the way Windows compares a path: case-folded, one separator, no doubled ones. */
const foldedCitation = (text: string): string => text.split(BACKSLASH).join('/').replace(/\/+/g, '/').toLowerCase();

/** Whether a decision names the item by path or hash in ANY case or separator, which the core's exact match would miss. */
function citedWhenFolded(texts: readonly string[] | null, path: string, hash: string): boolean {
  if (texts === null) return false;
  const wantedPath = foldedCitation(path);
  const wantedHash = hash.toLowerCase();
  return texts.some((text) => {
    const folded = foldedCitation(text);
    return folded.includes(wantedPath) || folded.includes(wantedHash);
  });
}

/**
 * The path must be spelled exactly as each directory holds it, segment by segment: a case difference, a trailing dot or space and an
 * 8.3 short name are the same file on Windows but a different string to the citation check. A name no directory holds at all is left to
 * the deletion rule, which records it as absent.
 */
function pathSpellingProblem(fs: DocumentFs, root: string, path: string): boolean {
  const segments = path.split('/');
  // A path that climbs, or names nothing, is not asked about here: the deletion rule refuses it, and no directory outside the checkout is listed.
  if (path.length > 512 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  if (segments.some((segment) => TRAILING_DOT_OR_SPACE.test(segment) || SHORT_NAME.test(segment))) return true;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    const parent = index === 0 ? root : `${root}/${segments.slice(0, index).join('/')}`;
    const names = fs.listDir(parent);
    if (names.includes(segment)) continue;
    if (names.some((name) => name.toLowerCase() === segment.toLowerCase())) return true;
    return false;
  }
  return false;
}

type CitedStop = 'cited' | 'unknown' | 'changed' | null;

/** The owner is not asked about an item the command will not remove: a cited or unknowable item is declined inside the ask, so the ledger records it. */
function decliningCited(inner: OwnerDeletionVerifier, stop: { value: CitedStop }, shown: { readonly hash: string | null; readonly citedFolded: boolean }): OwnerDeletionVerifier {
  return (claim: MemoryDeletionClaim) => {
    // WHAT THE OWNER IS ASKED ABOUT IS WHAT THEY WERE SHOWN: the claim's hash must be the hash of the bytes displayed.
    if (shown.hash !== null && claim.itemHash !== shown.hash) {
      stop.value = 'changed';
      return false;
    }
    if (claim.citedByDecision === true || shown.citedFolded) {
      stop.value = 'cited';
      return false;
    }
    if (claim.citedByDecision !== false) {
      stop.value = 'unknown';
      return false;
    }
    return inner(claim);
  };
}

function deletionRefusal(code: MemoryDeletionRefusal, stop: CitedStop): CommandResult {
  if (code === 'DELETE_OWNER_NOT_VERIFIED' && stop === 'changed') return refusal('MEMORY_DELETE_ITEM_CHANGED', 'the hash being asked about is not the hash of the text that was shown');
  if (code === 'DELETE_OWNER_NOT_VERIFIED' && stop === 'cited') return refusal('MEMORY_DELETE_CITED_BY_DECISION', 'a committed decision names this item (its path or its hash), so it is not deleted here');
  if (code === 'DELETE_OWNER_NOT_VERIFIED' && stop === 'unknown') return refusal('MEMORY_DELETE_DECISIONS_UNREADABLE', 'the committed decisions could not be read, so it is not known whether one relies on this item');
  return refusal(code, `the deletion was refused by rule ${code}`);
}

function deleteCommand(ctx: CommandContext, flags: Flags, who: { tenant: string; project: string }, deps: MemoryCommandDeps): CommandResult {
  const path = str(flags, 'path');
  const reason = str(flags, 'reason');
  const hash = str(flags, 'hash');
  if (path === '' || reason === '') return usageRefusal('`memory delete` needs --path and --reason');
  if (hash !== '' && !SHA256.test(hash)) return usageRefusal('--hash must be a sha-256 in 64 hex characters');
  const terminal = terminalOf(deps);
  if (terminal === null) return needsTerminal();

  const { sys, root } = ctx;
  const fs = documentFsOver(sys, deps.entryProbe);
  if (pathSpellingProblem(fs, root, path)) {
    return decided(refusal('MEMORY_DELETE_PATH_SPELLING', 'the path is not spelled as the directory spells it (case, a trailing dot or space, or a short name)'));
  }
  const item = readRegularItem(fs, root, path);
  const stop: { value: CitedStop } = { value: null };
  const itemHash = hash !== '' ? hash : (item?.hash ?? ZERO_HASH);
  const citedFolded = citedWhenFolded(decisionsOf(ctx, deps), path, itemHash);
  const verifier = decliningCited(terminalDeletionVerifier(() => terminal, item === null ? [] : fencedStoredText('the item', item.text, 400)), stop, { hash: item?.hash ?? null, citedFolded });
  const outcome = deleteMemoryItem(
    { owner: who, files: deletionFilesOver(sys), fs: documentFsOver(sys, deps.entryProbe), clock: searchClockOver(sys), committedDecisions: () => decisionsOf(ctx, deps), ownerVerifier: verifier },
    root,
    { tenant: who.tenant, project: who.project, path, itemHash, reason },
  );
  const ledger = ledgerLines(sys, root);
  if (!outcome.ok) return decided({ code: REFUSED_EXIT, lines: [...deletionRefusal(outcome.code, stop.value).lines, ...(outcome.recorded ? [] : ['  (this refusal could not be written to the ledger)']), ...ledger] });
  return decided({
    code: 0,
    lines: [
      `DELETED ${visibleText(outcome.path, 200)} (hash ${outcome.itemHash ?? itemHash}) for tenant ${who.tenant}, project ${who.project}.`,
      ...(outcome.recorded ? [] : ['  WARNING: the closing ledger entry could not be written; the deletion stands and its first entry is on file']),
      ...ledger,
      '  git still holds the committed bytes of a deleted file; commit the deletion so the working tree and git agree',
    ],
  });
}

function rebuildIndex(ctx: CommandContext, who: { tenant: string; project: string }, deps: MemoryCommandDeps): CommandResult {
  const directory = deps.indexDirectory();
  if (directory === null) return refusal('MEMORY_INDEX_NO_STATE_DIRECTORY', 'the installation has no state directory to keep the index in');
  const { sys, root } = ctx;
  const fs = documentFsOver(sys, deps.entryProbe);
  const opened = (() => {
    try {
      return openProjectSearchIndex(directory, who, { clock: searchClockOver(sys), ensureDirectory: deps.ensureDirectory, head: searchHeadOver(gitRunnerOver(sys, root)) });
    } catch (error: unknown) {
      return refusal('MEMORY_INDEX_UNAVAILABLE', `the index could not be opened: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  })();
  if ('code' in opened) return opened;
  if (!opened.ok) return refusal('MEMORY_INDEX_UNAVAILABLE', `the index file cannot be named for this tenant and project (${opened.reason})`);
  const { index } = opened;
  try {
    // HEAD IS TAKEN BEFORE THE SOURCES ARE READ, so a commit made while they are read leaves the index stale and not fresh.
    const builtAt = index.currentHead();
    const documents = collectDocumentSources({ project: who.project, root, fs });
    const stores = collectStoreSources({ project: who.project, root, fs });
    const built = index.rebuildProject(who.project, [...documents.sources, ...stores.sources], { builtAtCommit: builtAt });
    if (!built.ok) return refusal('MEMORY_INDEX_UNAVAILABLE', built.problem);
    const skipped = [...documents.skipped, ...stores.skipped, ...built.skipped];
    return {
      code: 0,
      lines: [
        `INDEX REBUILT for tenant ${who.tenant}, project ${who.project}: indexed ${built.sources} sources, ${built.chunks} chunks, skipped ${skipped.length}${skippedReasons(skipped)}.`,
        builtAt === null ? '  HEAD could not be read, so no commit is recorded and every citation from this index reads stale' : `  built at commit ${builtAt}; a citation is stale once HEAD moves`,
        `  written: ${opened.location} (the installation state, nothing in the project tree)`,
      ],
    };
  } catch (error: unknown) {
    return refusal('MEMORY_INDEX_UNAVAILABLE', `the index could not be built: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    index.close();
  }
}

function skippedReasons(skipped: readonly { readonly reason: string }[]): string {
  if (skipped.length === 0) return '';
  const counts = new Map<string, number>();
  for (const { reason } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return ` (${[...counts].map(([reason, count]) => `${visibleText(reason, 40)} ${count}`).join(', ')})`;
}

function deleteIndex(ctx: CommandContext, flags: Flags, who: { tenant: string; project: string }, deps: MemoryCommandDeps): CommandResult {
  const directory = deps.indexDirectory();
  if (directory === null) return refusal('MEMORY_INDEX_NO_STATE_DIRECTORY', 'the installation has no state directory to keep the index in');
  // THE TERMINAL IS ASKED FIRST, and a refusal here writes nothing: an agent with no terminal cannot fill the deletion ledger.
  const terminal = terminalOf(deps);
  if (terminal === null) return needsTerminal();
  const { sys, root } = ctx;
  const where = projectIndexLocation(directory, who);
  if (!where.ok) return refusal('MEMORY_INDEX_UNAVAILABLE', `the index file cannot be named for this tenant and project (${where.reason})`);
  // NOTHING TO DELETE IS NOT AN ATTEMPT: no ledger entry is made for an index that is not there.
  if (!sys.exists(where.location)) return { code: 0, lines: [`NOTHING TO DELETE: there is no derived index for tenant ${who.tenant}, project ${who.project}; \`memory index rebuild\` makes one.`] };
  const indexFile = where.location.slice(where.location.lastIndexOf('/') + 1);
  const claim = indexDeletionClaimOf({ action: 'memory-index-delete', tenant: who.tenant, project: who.project, root, indexFile });
  if (terminalIndexVerifier(() => terminal)(claim) !== true) {
    return decided(refusal('MEMORY_OWNER_NOT_CONFIRMED', 'what was typed is not the code for deleting this index, so nothing was deleted'));
  }
  const reason = str(flags, 'reason', 'the derived index was deleted so it can be rebuilt');
  const outcome = deleteDerivedIndex({ owner: who, files: deletionFilesOver(sys), clock: searchClockOver(sys) }, root, directory, { tenant: who.tenant, project: who.project, reason });
  const ledger = ledgerLines(sys, root);
  if (!outcome.ok) return decided({ code: REFUSED_EXIT, lines: [...deletionRefusal(outcome.code, null).lines, ...ledger] });
  return decided({ code: 0, lines: [`INDEX DELETED for tenant ${who.tenant}, project ${who.project}; \`memory index rebuild\` makes it again.`, ...ledger] });
}

const OWNER_CALLER: MemoryCaller = Object.freeze({ author: 'owner-terminal', role: 'owner', session: 'typed-terminal' });
const LIST_CAP = 20;

function proposalLine(proposal: MemoryProposal): string {
  const { author, proposedAt } = proposal.provenance;
  return `  ${proposal.id}  ${proposal.op} ${proposal.kind} on ${proposal.target}  by ${visibleText(author, 64)}  at ${visibleText(proposedAt, 40)}  hash ${proposal.proposalHash}`;
}

/**
 * THE WHOLE TEXT, OR NO QUESTION. The proposed text and the entry it would replace are shown to the last character, the cap being the
 * store's own limit (`memoryCharLimit`), so the owner approves what they read. If anything would still be cut, there is no block and the
 * caller refuses to ask: text the owner was not shown is never asked about.
 */
export function proposalTextBlocks(proposal: Pick<MemoryProposal, 'target' | 'content' | 'targetEntry'>): readonly string[] | null {
  const cap = memoryCharLimit(proposal.target);
  const proposed = proposal.content === null ? [] : fencedWholeText('proposed text', proposal.content, cap);
  const replaced = proposal.targetEntry === null ? [] : fencedWholeText('the entry it would replace or remove', proposal.targetEntry, cap);
  return proposed === null || replaced === null ? null : [...proposed, ...replaced];
}

const REJECT_CUT_CHARS = 600;

/** Why a proposal's text cannot be shown in full: too many characters for the store, or too many lines for a prompt. */
function textProblemOf(proposal: Pick<MemoryProposal, 'target' | 'content' | 'targetEntry'>): 'characters' | 'lines' | null {
  const cap = memoryCharLimit(proposal.target);
  const texts = [proposal.content, proposal.targetEntry].filter((text): text is string => text !== null);
  if (texts.some((text) => text.length > cap * 2 || [...text].length > cap)) return 'characters';
  return texts.some((text) => lineCountOf(text) > PROMPT_MAX_LINES) ? 'lines' : null;
}

/**
 * What `reject` and `proposals --id` show when the text cannot be shown in full: the size, the hash, and the text CUT and marked as cut.
 * A rejection lands nothing, so the owner may decide it on the cut text; an approval may not (`MEMORY_TEXT_NOT_SHOWN_IN_FULL`).
 */
function cutTextBlocks(proposal: MemoryProposal): readonly string[] {
  const sizeOf = (label: string, text: string | null): readonly string[] => (text === null ? [] : [`  ${label}: ${text.length} characters in ${lineCountOf(text)} lines`]);
  return [
    `  THE TEXT BELOW IS CUT: it is longer than the store or a prompt allows, so this proposal cannot be approved (it can be rejected)`,
    ...sizeOf('proposed text', proposal.content),
    ...sizeOf('the entry it would replace or remove', proposal.targetEntry),
    `  proposal hash ${proposal.proposalHash}`,
    ...(proposal.content === null ? [] : fencedStoredText('proposed text, CUT', proposal.content, REJECT_CUT_CHARS)),
    ...(proposal.targetEntry === null ? [] : fencedStoredText('the entry it would replace or remove, CUT', proposal.targetEntry, REJECT_CUT_CHARS)),
  ];
}

/** The deciding facts on ONE line, printed again right before the code is asked for, so the text above cannot scroll them away. */
function decidingFacts(proposal: MemoryProposal): readonly string[] {
  const { author, authorRole } = proposal.provenance;
  return [
    `DECIDING FACTS: author ${visibleText(author, 64)}, claimed role ${visibleText(authorRole, 32)}, kind ${visibleText(proposal.kind, 16)}, target ${visibleText(proposal.target, 16)}, ${visibleText(proposal.op, 16)}, proposal hash ${proposal.proposalHash}`,
  ];
}

/** Who proposed it, in which role, of what kind: inert, capped text. The role is what the queue file CLAIMS, and decides nothing here. */
function proposalFacts(proposal: MemoryProposal): readonly string[] {
  const { author, authorRole, session, proposedAt } = proposal.provenance;
  return [
    `  proposed by ${visibleText(author, 64)}, role ${visibleText(authorRole, 32)} (as the queue file claims; it decides nothing), session ${visibleText(session, 64)}, at ${visibleText(proposedAt, 40)}`,
    `  kind ${visibleText(proposal.kind, 16)}${proposal.ledgerRef === null ? '' : `, ledger reference ${visibleText(proposal.ledgerRef, 200)}`}`,
  ];
}

function showProposal(proposal: MemoryProposal): readonly string[] {
  const whole = proposalTextBlocks(proposal);
  return [
    `proposal ${proposal.id}: ${proposal.state}`,
    `  ${proposal.op} ${proposal.kind} on the ${proposal.target} store`,
    ...proposalFacts(proposal),
    `  proposal hash ${proposal.proposalHash}`,
    ...(proposal.timeSensitive === null ? [] : [`  time-sensitive wording: ${visibleText(proposal.timeSensitive, 100)}`]),
    ...(whole ?? cutTextBlocks(proposal)),
    `  decide it, in a terminal: projectos memory approve --id ${proposal.id}   or   projectos memory reject --id ${proposal.id}`,
  ];
}

function proposalsCommand(ctx: CommandContext, flags: Flags): CommandResult {
  const id = str(flags, 'id');
  if (id !== '') {
    const loaded = loadMemoryProposal(ctx.sys, ctx.root, id);
    return loaded.ok ? { code: 0, lines: showProposal(loaded.value) } : memoryRefusal(loaded);
  }
  const { pending, unreadable } = listPendingMemoryProposals(ctx.sys, ctx.root);
  const shown = pending.slice(0, LIST_CAP);
  return {
    code: 0,
    lines: [
      pending.length === 0 ? 'No proposals are waiting.' : `${pending.length} proposals waiting${pending.length > shown.length ? `, the first ${shown.length} shown` : ''}:`,
      ...shown.map(proposalLine),
      ...(unreadable.length === 0 ? [] : [`${unreadable.length} files in the queue did not read back as a proposal: ${unreadable.slice(0, 5).map((name) => visibleText(name, 40)).join(', ')}`]),
      '  read one with `projectos memory proposals --id <id>`',
    ],
  };
}

/**
 * The rank rule, asked before the owner is. A role read from the queue file is a claim, not proof, so it exempts nothing from the rule
 * about decisions: through this command a proposal that would replace or remove an entry that is a decision (or that has no record of
 * its origin, which is protected as one) is always refused. A decision is changed by committing a new decision.
 *
 * FINAL ROUND, A: NO ROLE READ FROM THE FILE SKIPS THE RANK RULE EITHER. The rule runs for every replace and remove, whatever role the
 * file claims, with the rank the proposal really has (a summary, or a worker's recollection). So through this command a proposal can
 * ADD an entry, and can replace or remove only what that rank allows, which for approved memory is nothing. Anything else is the owner
 * editing and committing the file. (No product path writes an owner-role proposal: the proposal door refuses owner-role callers.)
 */
function replacementProblem(ctx: CommandContext, proposal: MemoryProposal): CommandResult | null {
  if (proposal.op === 'add') return null;
  const store = readMemoryStore(ctx.sys, ctx.root, proposal.target);
  if (!store.ok) return memoryRefusal(store);
  const held = store.value.provenance.get(proposal.targetEntryHash ?? '')?.kind;
  if (held === undefined || held === 'decision') {
    return refusal('MEMORY_DECISION_NOT_CHANGED_HERE', `proposal ${proposal.id} would ${proposal.op} an entry that is a decision or has no record of its origin`);
  }
  const writer = { kind: proposal.kind === 'summary' ? 'summary' : 'recollection' };
  const target = { kind: 'approved-memory', path: `.projectops/memory/${proposal.target === 'user' ? 'USER' : 'MEMORY'}.md` };
  const code = provenanceReplacementProblem(writer, target);
  return code === null ? null : refusal(code, `proposal ${proposal.id} would stand in for an entry that approved memory already holds`);
}

function decideCommand(ctx: CommandContext, flags: Flags, who: { tenant: string; project: string }, deps: MemoryCommandDeps, verb: 'approve' | 'reject'): CommandResult {
  const id = str(flags, 'id');
  if (id === '') return usageRefusal(`\`memory ${verb}\` needs --id <proposal id>`);
  const terminal = terminalOf(deps);
  if (terminal === null) return needsTerminal();
  const { sys, root } = ctx;
  const loaded = loadMemoryProposal(sys, root, id);
  if (!loaded.ok) return decided(memoryRefusal(loaded));
  const proposal = loaded.value;
  if (verb === 'approve') {
    const problem = replacementProblem(ctx, proposal);
    if (problem !== null) return decided(problem);
  }
  const claim = proposalDecisionClaimOf({
    action: verb === 'approve' ? 'memory-approve' : 'memory-reject',
    tenant: who.tenant,
    project: who.project,
    root,
    proposalId: proposal.id,
    proposalHash: proposal.proposalHash,
    target: proposal.target,
    op: proposal.op,
  });
  const blocks = proposalTextBlocks(proposal);
  // APPROVING NEEDS THE WHOLE TEXT. REJECTING LANDS NOTHING, so it may be decided on the text cut and marked, with its hash and size.
  if (blocks === null && verb === 'approve') {
    return textProblemOf(proposal) === 'lines'
      ? decided(refusal('MEMORY_TEXT_TOO_MANY_LINES', `proposal ${proposal.id} has more than ${PROMPT_MAX_LINES} lines of text, so a prompt cannot show it in full`))
      : decided(refusal('MEMORY_TEXT_NOT_SHOWN_IN_FULL', `proposal ${proposal.id} holds text longer than the store allows, so it cannot be shown in full`));
  }
  const extra = [...proposalFacts(proposal), ...(blocks ?? cutTextBlocks(proposal))];
  // Asked once, for this proposal and the hash just read. The role is the owner's only now, only for this one call.
  if (terminalProposalVerifier(() => terminal, extra, decidingFacts(proposal))(claim) !== true) {
    return decided(refusal('MEMORY_OWNER_NOT_CONFIRMED', 'what was typed is not the code for this proposal, so it was not decided'));
  }
  const request = { id: proposal.id, reviewedHash: proposal.proposalHash };
  const result = verb === 'approve' ? approveMemoryProposal(sys, root, OWNER_CALLER, request) : rejectMemoryProposal(sys, root, OWNER_CALLER, request);
  if (!result.ok) return decided(memoryRefusal(result));
  return decided({
    code: 0,
    lines: [verb === 'approve' ? `APPROVED ${proposal.id}: it is now ${result.value.state}, in the ${proposal.target} store, for tenant ${who.tenant}, project ${who.project}.` : `REJECTED ${proposal.id}: nothing landed, and no store changed.`],
  });
}

/**
 * THE DEPENDENCIES ARE A PARAMETER, AND PRODUCTION NEVER PASSES ONE. The same rule as `tenant` and `stop`: the CLI calls this with
 * three arguments, and a test passes its own as the fourth, in the open.
 */
export function memory(ctx: CommandContext, flags: Flags, positionals: readonly string[], overrides: Partial<MemoryCommandDeps> = {}): CommandResult {
  const [first, second] = positionals;
  if (first === undefined) return { code: USAGE_EXIT, lines: USAGE };
  const known = first === 'delete' || first === 'proposals' || first === 'approve' || first === 'reject' || (first === 'index' && (second === 'rebuild' || second === 'delete'));
  if (!known) return usageRefusal(`there is no \`memory ${positionals.slice(0, 2).map((word) => visibleText(word, 30)).join(' ')}\` command`);
  const deps: MemoryCommandDeps = { ...nodeDeps(), ...overrides };
  const found = identityOf(ctx, deps);
  if (!found.ok) return found.result;
  const who = { tenant: found.tenant, project: found.project };
  switch (first) {
    case 'index':
      return second === 'rebuild' ? rebuildIndex(ctx, who, deps) : deleteIndex(ctx, flags, who, deps);
    case 'delete':
      return deleteCommand(ctx, flags, who, deps);
    case 'proposals':
      return proposalsCommand(ctx, flags);
    case 'approve':
      return decideCommand(ctx, flags, who, deps, 'approve');
    default:
      return decideCommand(ctx, flags, who, deps, 'reject');
  }
}
