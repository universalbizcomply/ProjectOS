/**
 * Whose work this is, as the INSTALLATION records it (ADR-T1 §3, §4, §5).
 *
 * `core/src/tenant.ts` judges what it is handed and does no I/O. This is the other half: the code that
 * reads the facts it is handed, and the only caller of `resolveTenant`.
 *
 * COMMITTED BYTES ONLY. The registry is read from the installation's git object store at HEAD, the same
 * read `projectAllowlist.ts` uses. A working-tree edit has no authority, and a dirty file refuses.
 *
 * THE WHOLE FILE, BEFORE ANY MATCH. `parseTenantRegistry` judges every line, and only the registry it
 * returns can be resolved against. A contradiction anywhere refuses every project, and the refusal is
 * named after the first problem, so a duplicate reads `TENANT_REGISTRY_DUPLICATE` and not "unknown".
 *
 * THE OWNER RECEIPT (ADR-T1 §3, chosen here). Every commit on this machine is named Murad, agent commits
 * included, so a last-commit check cannot tell the owner from an agent. Instead the registry's blob sha
 * must match `tenant-registry-receipt.json` in the installation state directory, written only by
 * `projectos tenant receipt` after a person retypes the sha in an interactive terminal. A changed
 * registry is a new blob, so it carries no authority until the owner confirms it. There is one receipt,
 * not one per blob, so going back to an older registry needs a new confirmation too.
 *
 * WHAT THE RECEIPT DOES NOT DO, said plainly. It is a file, and everything here runs as one Windows user.
 * `tenant receipt` refuses with no terminal, so an agent following the kernel's route cannot make one,
 * and a registry commit alone can no longer move a tenant. But a process can drive a console, and a
 * process can write the file directly, exactly as it can rewrite the emergency stop record. Neither is
 * stopped. `TENANT_RECEIPT_STATEMENT` says so wherever a receipt is shown.
 *
 * A LINKED WORKTREE HAS NO IDENTITY OF ITS OWN (ADR-T1 §5). The listing is taken here and nowhere else,
 * at the root the registry names, so no caller can hand in a `WorktreeListing` it built by hand.
 * `--git-common-dir` is never asked, and the worktree's `.git` file never attaches anything. It can only
 * take away: real git keeps listing a removed worktree's path, unmarked, once something new stands there
 * with a `.git` of its own, so a listed path whose pointer leads elsewhere is refused.
 *
 * THE CHECKOUT IS CANONICAL BEFORE IT IS JUDGED. `resolveTenant` compares the strings it is handed, so a
 * path that is not its own realpath is a second spelling and is refused by name: an 8.3 short name, a
 * junction, a symlink, a device or UNC prefix, a trailing dot, an alternate data stream.
 *
 * A LOGIN CARRIES NOTHING HERE. Nothing in this file reads an identity from a cloud session.
 *
 * R4 HOLDS ON THE DISK. `appendDurableLine` writes under an exclusive lock, through a temporary file and
 * a rename, and reads the line back before believing it. It answers `false` rather than dropping
 * anything, and a file it cannot read is never overwritten. The idempotency store keeps one file per key
 * in the same state directory, outside every repository.
 *
 * Created in PROJECTOS-TENANT-PRINCIPAL1A.
 */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  linkedWorktreesFromPorcelain,
  parseActionRegistry,
  parseTenantRegistry,
  registeredRootOf,
  resolveTenant,
  type ActionRegistry,
  type EnvelopeGrantPort,
  type EnvelopeRecord,
  type EnvelopeRecorder,
  type TaskEnvelope,
  type TenantRegistry,
  type TenantRegistryCode,
  type TenantResolution,
  type WorktreeListing,
} from '@projectos/core';
import type { System } from '../system.js';
import { canonicalRepositoryIdentity } from './projectAllowlist.js';

/** Where the records live, relative to the installation root. */
export const TENANT_REGISTRY_REL = 'projectos/security/tenant-registry.json';
export const ACTION_REGISTRY_REL = 'projectos/security/action-registry.json';

/** Beside the stop record and the ledgers, outside every repository. */
export const TENANT_RECEIPT_FILENAME = 'tenant-registry-receipt.json';
export const ENVELOPE_RECORDS_FILENAME = 'envelope-records.jsonl';
export const ENVELOPE_IDEMPOTENCY_DIRNAME = 'envelope-idempotency';

export const TENANT_RECEIPT_SCHEMA_VERSION = '1.0.0';
export const TENANT_RECEIPT_KIND = 'tenant-registry-owner-receipt';
const TENANT_RECEIPT_CONFIRMATION = 'typed-in-an-interactive-terminal';
const TENANT_RECEIPT_FIELDS = ['schemaVersion', 'kind', 'registryBlob', 'confirmedAt', 'confirmation', 'statement'];

/** Printed with every receipt answer, and written into the receipt. */
export const TENANT_RECEIPT_STATEMENT =
  'An owner receipt is an owner-intent check at this Windows account: a person retyped the registry blob in an interactive terminal. ' +
  'It stops an agent with no terminal from using this command, and it stops a registry commit alone from moving a tenant. ' +
  'It does not stop a process that drives a console or writes the receipt file directly, because everything here runs as one Windows user (ADR-T1 section 10).';

/** A git object name. */
const GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export type TenantRefusalCode =
  | 'TENANT_UNKNOWN'
  | 'TENANT_MISMATCH'
  | 'TENANT_CHECKOUT_ALIAS'
  | 'TENANT_REGISTRY_UNREADABLE'
  | 'TENANT_REGISTRY_NO_OWNER_RECEIPT'
  | 'ACTION_REGISTRY_UNREADABLE'
  | TenantRegistryCode;

export interface TenantRefusal {
  readonly ok: false;
  readonly code: TenantRefusalCode;
  readonly reasons: readonly string[];
}

/** Which installation answers, and where it keeps what no repository may hold. */
export interface TenantSource {
  readonly installRoot: string;
  /** `null` when no state directory can be established, which refuses. */
  readonly stateDir: string | null;
}

function refusal(code: TenantRefusalCode, reasons: readonly string[]): TenantRefusal {
  return { ok: false, code, reasons };
}

type CommittedBytes = { readonly ok: true; readonly text: string; readonly blob: string; readonly commit: string } | TenantRefusal;

/** One record's committed bytes at the installation's HEAD. Absent, unreadable or dirty all refuse. */
function committedBytes(sys: System, install: string, rel: string, code: 'TENANT_REGISTRY_UNREADABLE' | 'ACTION_REGISTRY_UNREADABLE'): CommittedBytes {
  const logged = sys.exec('git', ['-C', install, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) {
    return refusal(code, [`this ProjectOS installation commits no ${rel}, so it records no such authority`]);
  }
  const dirty = sys.exec('git', ['-C', install, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0 || dirty.stdout.trim().length > 0) {
    return refusal(code, [`${rel} has been changed in the working tree; only the committed bytes carry authority, and an edited file carries none`]);
  }
  const head = sys.exec('git', ['-C', install, 'rev-parse', '--verify', 'HEAD']);
  const commit = head.stdout.trim();
  if (head.code !== 0 || !GIT_OBJECT.test(commit)) return refusal(code, [`the installation's HEAD could not be read, so ${rel} cannot be`]);
  // PINNED TO ONE COMMIT, so the blob named and the bytes judged cannot come from two different HEADs.
  const named = sys.exec('git', ['-C', install, 'rev-parse', `${commit}:./${rel}`]);
  const blob = named.stdout.trim();
  const shown = sys.exec('git', ['-C', install, 'show', `${commit}:./${rel}`]);
  if (named.code !== 0 || !GIT_OBJECT.test(blob) || shown.code !== 0 || shown.stdout.trim().length === 0) {
    return refusal(code, [`the committed ${rel} could not be read`]);
  }
  return { ok: true, text: shown.stdout, blob, commit };
}

export type CommittedTenantRegistry =
  | { readonly ok: true; readonly registry: TenantRegistry; readonly blob: string; readonly commit: string }
  | TenantRefusal;

/** The committed registry, judged whole, or a refusal named after its first problem. */
export function readCommittedTenantRegistry(sys: System, installRoot: string): CommittedTenantRegistry {
  const bytes = committedBytes(sys, installRoot, TENANT_REGISTRY_REL, 'TENANT_REGISTRY_UNREADABLE');
  if (!bytes.ok) return bytes;
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.text) as unknown;
  } catch {
    return refusal('TENANT_REGISTRY_UNREADABLE', [`the committed ${TENANT_REGISTRY_REL} is not readable JSON`]);
  }
  const parsed = parseTenantRegistry(raw);
  if (!parsed.ok) {
    const first = parsed.problems[0];
    return refusal(first?.code ?? 'TENANT_REGISTRY_INVALID', parsed.problems.map((problem) => `${problem.code}: ${problem.message}`));
  }
  return { ok: true, registry: parsed.registry, blob: bytes.blob, commit: bytes.commit };
}

export type CommittedActionRegistry = { readonly ok: true; readonly actions: ActionRegistry } | TenantRefusal;

/** The committed action registry, judged whole. */
export function readCommittedActionRegistry(sys: System, installRoot: string): CommittedActionRegistry {
  const bytes = committedBytes(sys, installRoot, ACTION_REGISTRY_REL, 'ACTION_REGISTRY_UNREADABLE');
  if (!bytes.ok) return bytes;
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.text) as unknown;
  } catch {
    return refusal('ACTION_REGISTRY_UNREADABLE', [`the committed ${ACTION_REGISTRY_REL} is not readable JSON`]);
  }
  const parsed = parseActionRegistry(raw);
  if (!parsed.ok) return refusal('ACTION_REGISTRY_UNREADABLE', parsed.problems.map((problem) => `${problem.code}: ${problem.message}`));
  return { ok: true, actions: parsed.registry };
}

/* ----------------------------------------------------------------------------------------------
 * THE OWNER RECEIPT.
 * ------------------------------------------------------------------------------------------- */

export interface TenantRegistryReceipt {
  readonly schemaVersion: string;
  readonly kind: string;
  readonly registryBlob: string;
  readonly confirmedAt: string;
  readonly confirmation: string;
  readonly statement: string;
}

export type TenantReceiptRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly why: string }
  | { readonly kind: 'ok'; readonly receipt: TenantRegistryReceipt };

export function tenantReceiptPath(stateDir: string): string {
  return join(stateDir, TENANT_RECEIPT_FILENAME);
}

function parseReceipt(text: string): TenantRegistryReceipt | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Readonly<Record<string, unknown>>;
  const blob = record['registryBlob'];
  const shaped =
    Object.keys(record).length === TENANT_RECEIPT_FIELDS.length &&
    TENANT_RECEIPT_FIELDS.every((field) => typeof record[field] === 'string') &&
    record['schemaVersion'] === TENANT_RECEIPT_SCHEMA_VERSION &&
    record['kind'] === TENANT_RECEIPT_KIND &&
    record['confirmation'] === TENANT_RECEIPT_CONFIRMATION &&
    typeof blob === 'string' &&
    GIT_OBJECT.test(blob);
  return shaped ? (record as unknown as TenantRegistryReceipt) : null;
}

/** What the state directory holds. "Never made" is kept apart from "cannot be believed". */
export function readTenantReceipt(sys: System, stateDir: string): TenantReceiptRead {
  const path = tenantReceiptPath(stateDir);
  const text = sys.readText(path);
  if (text === null) return sys.exists(path) ? { kind: 'unreadable', why: 'it exists but could not be read' } : { kind: 'absent' };
  const receipt = parseReceipt(text);
  return receipt === null ? { kind: 'unreadable', why: 'it is not a valid owner receipt' } : { kind: 'ok', receipt };
}

/** The one line the owner runs. Absolute, so it works from any directory. */
export function tenantReceiptCommand(installRoot: string, blob: string): string {
  return `node ${installRoot.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '')}/projectos/agent/bin/projectos.js tenant receipt --blob ${blob}`;
}

/** `null` when the owner confirmed exactly this blob; otherwise the refusal, carrying the fix. */
export function ownerReceiptRefusal(sys: System, source: TenantSource, blob: string): TenantRefusal | null {
  if (source.stateDir === null) {
    return refusal('TENANT_REGISTRY_NO_OWNER_RECEIPT', ['no installation state directory can be established, so no owner receipt can be read']);
  }
  const read = readTenantReceipt(sys, source.stateDir);
  if (read.kind === 'ok' && read.receipt.registryBlob === blob) return null;
  const finding =
    read.kind === 'absent'
      ? `the committed tenant registry (blob ${blob}) has no owner receipt`
      : read.kind === 'unreadable'
        ? `the owner receipt at ${tenantReceiptPath(source.stateDir)} cannot be trusted (${read.why})`
        : `the committed tenant registry is blob ${blob}, and the owner receipt names ${read.receipt.registryBlob}`;
  return refusal('TENANT_REGISTRY_NO_OWNER_RECEIPT', [
    `${finding}, so it carries no authority and no tenant can be derived`,
    'the owner confirms it once, in PowerShell or Windows Terminal (Git Bash gives no terminal), with this one line:',
    `  ${tenantReceiptCommand(source.installRoot, blob)}`,
  ]);
}

/**
 * Write the receipt. Only `commands/tenant.ts` calls this, after the typed confirmation, and only after
 * the door has recorded the P5 admission. `true` means the bytes were read back.
 */
export function writeTenantReceipt(sys: System, stateDir: string, blob: string, at: string): boolean {
  const path = tenantReceiptPath(stateDir);
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const receipt: TenantRegistryReceipt = {
    schemaVersion: TENANT_RECEIPT_SCHEMA_VERSION,
    kind: TENANT_RECEIPT_KIND,
    registryBlob: blob,
    confirmedAt: at,
    confirmation: TENANT_RECEIPT_CONFIRMATION,
    statement: TENANT_RECEIPT_STATEMENT,
  };
  try {
    sys.writeText(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
    if (!sys.renameFile(temporary, path)) {
      sys.removeFile(temporary);
      return false;
    }
  } catch {
    return false;
  }
  const back = readTenantReceipt(sys, stateDir);
  return back.kind === 'ok' && back.receipt.registryBlob === blob;
}

/* ----------------------------------------------------------------------------------------------
 * THE CHECKOUT.
 * ------------------------------------------------------------------------------------------- */

const pathKey = (path: string): string =>
  path.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').replace(/[A-Z]/g, (letter) => letter.toLowerCase());

export type CanonicalCheckout = { readonly ok: true; readonly root: string } | TenantRefusal;

/**
 * The checkout's own realpath, or a refusal by name.
 *
 * ONE RULE COVERS EVERY ALIAS. A path that is not its own realpath, separators and ASCII case aside, is
 * a second spelling, and refusing that closes 8.3 names, junctions, symlinks, `\\?\` and UNC forms, a
 * trailing dot and an alternate data stream without a list of them that could be incomplete.
 */
export function canonicalCheckoutRoot(root: string, realpath: (path: string) => string = realpathSync.native): CanonicalCheckout {
  if (!isAbsolute(root)) return refusal('TENANT_CHECKOUT_ALIAS', [`${root} is not an absolute path, so it is not one place`]);
  let real: string;
  try {
    real = realpath(resolve(root));
  } catch {
    return refusal('TENANT_CHECKOUT_ALIAS', [`${root} cannot be resolved to one real directory`]);
  }
  if (pathKey(real) !== pathKey(root)) {
    return refusal('TENANT_CHECKOUT_ALIAS', [`${root} is a second spelling of ${real}; work from the real path, because a tenant is judged on one spelling`]);
  }
  return { ok: true, root: real.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '') };
}

/**
 * What git lists, asked at the registered root and nowhere else.
 *
 * `null` when it will not answer, and `resolveTenant` then finds no route for a worktree.
 */
export function readWorktreeListing(sys: System, registeredRoot: string): WorktreeListing | null {
  const listed = sys.exec('git', ['-C', registeredRoot, 'worktree', 'list', '--porcelain']);
  return listed.code === 0 ? linkedWorktreesFromPorcelain(listed.stdout, registeredRoot) : null;
}

/**
 * Does this checkout's `.git` FILE lead into the registered repository's worktree records?
 *
 * ONLY EVER A REASON TO REFUSE. The listing is what attaches a worktree. A path it names can outlive the
 * worktree: delete the directory, `git init` there, set the same origin, and git still lists that path
 * and does not call it prunable, because a `.git` exists. This is what tells that directory from the
 * worktree that used to be there.
 */
function pointsIntoRegisteredRoot(sys: System, checkoutRoot: string, registeredRoot: string): boolean {
  const pointer = /^gitdir: (.+)$/m.exec(sys.readText(join(checkoutRoot, '.git')) ?? '')?.[1]?.trim();
  return pointer !== undefined && pathKey(resolve(checkoutRoot, pointer)).startsWith(`${pathKey(registeredRoot)}/.git/worktrees/`);
}

/**
 * The only caller of `resolveTenant`. `projectId` is a claim from the project's own file, until the
 * repository and the root agree. The registry is read from the installation; this asks the checkout
 * for its `origin`, and asks the registered root for the listing.
 */
export function resolveCheckout(sys: System, registry: TenantRegistry, root: string, projectId: string): TenantResolution | TenantRefusal {
  const canonical = canonicalCheckoutRoot(root);
  if (!canonical.ok) return canonical;
  const registered = registeredRootOf(registry, projectId);
  const resolved = resolveTenant(registry, {
    projectId,
    repository: canonicalRepositoryIdentity(sys, canonical.root),
    root: canonical.root,
    worktrees: registered === null ? null : readWorktreeListing(sys, registered),
  });
  if (!resolved.ok || resolved.binding.via !== 'linked-worktree' || pointsIntoRegisteredRoot(sys, canonical.root, resolved.binding.governedRoot)) return resolved;
  return refusal('TENANT_MISMATCH', [`git lists ${canonical.root} under ${resolved.binding.governedRoot}, and what stands there now is not that worktree`]);
}

/**
 * A bridge read may name a project. The tenant rule, on its own terms: that project must be listed, and
 * in the tenant this work is bound to. It does not ask whether the two are the same project; that is the
 * project check's job, and a second project in the same tenant is what shows this rule decides alone.
 */
export function crossTenantRefusal(registry: TenantRegistry, boundTenant: string, requestedProjectId: string): TenantRefusal | null {
  const wanted = registry.projects.find((entry) => entry.projectId === requestedProjectId);
  if (wanted === undefined) return refusal('TENANT_UNKNOWN', [`project '${requestedProjectId}' is not in the tenant registry`]);
  return wanted.tenant === boundTenant
    ? null
    : refusal('TENANT_MISMATCH', [`project '${requestedProjectId}' belongs to tenant '${wanted.tenant}', and this work is bound to tenant '${boundTenant}'`]);
}

/* ----------------------------------------------------------------------------------------------
 * DURABLE RECORDS.
 * ------------------------------------------------------------------------------------------- */

/**
 * Append one JSON line, or answer `false`. It never drops a line and calls that a success.
 *
 * A LOCK THAT IS HELD IS A FAILURE TO RECORD, and the caller stops. It does not wait, as `underLedgerLock`
 * does not. A file that exists and cannot be read is never replaced, because replacing it would erase
 * what it holds.
 */
export function appendDurableLine(sys: System, path: string, entry: unknown): boolean {
  const lock = `${path}.lock`;
  if (!sys.createExclusive(lock, `{"heldSince":"${sys.now()}"}\n`)) return false;
  try {
    const existing = sys.readText(path);
    if (existing === null && sys.exists(path)) return false;
    const line = `${JSON.stringify(entry)}\n`;
    const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    sys.writeText(temporary, `${existing ?? ''}${line}`);
    if (!sys.renameFile(temporary, path)) {
      sys.removeFile(temporary);
      return false;
    }
    return sys.readText(path)?.endsWith(line) === true;
  } catch {
    return false;
  } finally {
    sys.removeFile(lock);
  }
}

/** R4's port: one line per decision, in the installation state. With no state directory, nothing records. */
export function envelopeRecorder(sys: System, stateDir: string | null): EnvelopeRecorder {
  return (record: EnvelopeRecord) => stateDir !== null && appendDurableLine(sys, join(stateDir, ENVELOPE_RECORDS_FILENAME), record);
}

/**
 * The grant port for everything this phase admits, because none of it needs one: `run-start` is P2 and
 * `project-selection` and `bridge-read` are P1, and the door asks the port only about P3 and P5. So it
 * says no, and a P3 or P5 action reaching a route that passes this port stops at the door. `tenant
 * receipt` is the one P5 action here, and it passes its own port, built only after the typed
 * confirmation. CREDENTIALS1A decides the grant for `credential-release`.
 */
export const NO_GRANT: EnvelopeGrantPort = () => false;

export type IdempotencyOutcome = 'admitted' | 'completed' | 'failed';

export interface IdempotencyEntry {
  readonly key: string;
  readonly envelopeId: string;
  readonly action: string;
  readonly outcome: IdempotencyOutcome;
  readonly attempts: number;
  readonly at: string;
}

export type IdempotencyClaim =
  | { readonly kind: 'first'; readonly attempt: 1 }
  | { readonly kind: 'retry'; readonly attempt: number }
  | { readonly kind: 'duplicate'; readonly earlier: IdempotencyEntry }
  | { readonly kind: 'unavailable'; readonly why: string };

function idempotencyPath(stateDir: string, key: string): string {
  return join(stateDir, ENVELOPE_IDEMPOTENCY_DIRNAME, `${key.replace(/^sha256:/, '')}.json`);
}

function readIdempotencyEntry(sys: System, path: string): IdempotencyEntry | null {
  const text = sys.readText(path);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<IdempotencyEntry> | null;
    const known = parsed?.outcome === 'admitted' || parsed?.outcome === 'completed' || parsed?.outcome === 'failed';
    return known && Number.isSafeInteger(parsed?.attempts) ? (parsed as IdempotencyEntry) : null;
  } catch {
    return null;
  }
}

function replaceIdempotencyEntry(sys: System, path: string, entry: IdempotencyEntry): boolean {
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    sys.writeText(temporary, `${JSON.stringify(entry)}\n`);
    if (!sys.renameFile(temporary, path)) {
      sys.removeFile(temporary);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Has this intent happened before? ADR-K1 §2, across processes and restarts.
 *
 * `first` proceeds. `completed` is a `duplicate`: the earlier outcome comes back, and the caller must not
 * run again. `failed` is a `retry`, under the same key, with the attempt counted. A key that was admitted
 * and never settled is a `duplicate` too, because its effect may have happened, unless the caller says
 * a repeat is safe: `retryUnsettled` is for `run-start`, whose end is not recorded (see the evidence),
 * and a run that did its work moved HEAD and so has a new key.
 *
 * ANYTHING UNCLEAR IS `unavailable`, and the caller stops. A store that cannot answer has not said "new".
 */
export function claimIdempotencyKey(
  sys: System,
  stateDir: string | null,
  envelope: TaskEnvelope,
  at: string,
  options: { readonly retryUnsettled?: boolean } = {},
): IdempotencyClaim {
  if (stateDir === null) return { kind: 'unavailable', why: 'no installation state directory can be established' };
  const path = idempotencyPath(stateDir, envelope.idempotencyKey);
  const entry = (attempts: number): IdempotencyEntry => ({
    key: envelope.idempotencyKey,
    envelopeId: envelope.envelopeId,
    action: envelope.action,
    outcome: 'admitted',
    attempts,
    at,
  });
  if (sys.createExclusive(path, `${JSON.stringify(entry(1))}\n`)) return { kind: 'first', attempt: 1 };
  const earlier = readIdempotencyEntry(sys, path);
  if (earlier === null) return { kind: 'unavailable', why: `the idempotency record ${path} cannot be read or written` };
  if (earlier.outcome === 'completed' || (earlier.outcome === 'admitted' && options.retryUnsettled !== true)) return { kind: 'duplicate', earlier };
  const attempt = earlier.attempts + 1;
  return replaceIdempotencyEntry(sys, path, entry(attempt)) ? { kind: 'retry', attempt } : { kind: 'unavailable', why: `the idempotency record ${path} could not be updated` };
}

/** Record how a claimed key ended, so a later duplicate gets this answer. `false` means it was not recorded. */
export function settleIdempotencyKey(sys: System, stateDir: string | null, key: string, outcome: 'completed' | 'failed', at: string): boolean {
  if (stateDir === null) return false;
  const path = idempotencyPath(stateDir, key);
  const earlier = readIdempotencyEntry(sys, path);
  return earlier !== null && replaceIdempotencyEntry(sys, path, { ...earlier, outcome, at });
}
