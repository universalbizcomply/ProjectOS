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
 * THE BYTES ARE THE BLOB'S BYTES. A receipt names a blob, so nothing may change what that name yields. A
 * `git replace` ref does exactly that, with no commit and no diff, and `refs/replace` is shared across
 * linked worktrees. So every git call here passes `--no-replace-objects`, and the bytes judged must also
 * hash to the blob they came from, which holds whatever else stands between git and this code.
 *
 * THE RECEIPT (ADR-T1 §3, chosen here). Every commit on this machine is named Murad, agent commits
 * included, so a last-commit check cannot tell the owner from an agent. Instead the registry's blob sha
 * must match `tenant-registry-receipt.json` in the installation state directory, written only by
 * `projectos tenant receipt` after the sha is retyped in an interactive terminal, and that receipt must
 * have its admission line. A changed registry is a new blob, so it carries no authority until it is
 * confirmed. There is one receipt, not one per blob, so going back to an older registry needs a new one.
 *
 * WHAT THE RECEIPT SHOWS, said plainly. A person or a process confirmed this blob at a console, nothing
 * more. It is not the owner's signature. It records `typed-terminal`, and an envelope does not claim the
 * owner for it. It is two files, and everything here runs as one Windows user: `tenant receipt` refuses
 * with no terminal, so an agent following the kernel's route cannot make one, and a registry commit alone
 * can no longer move a tenant. But a process can drive a console, and a process can write both files,
 * exactly as it can rewrite the emergency stop record. Neither is stopped.
 * `TENANT_RECEIPT_STATEMENT` says so wherever a receipt is shown.
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
 * a rename, and reads the line back before believing it. It waits a bounded time for a busy lock, rotates
 * past a size, and answers `false` rather than dropping anything; a file it cannot read is never
 * overwritten. The idempotency store keeps one file per key in the same state directory, outside every
 * repository.
 *
 * Created in PROJECTOS-TENANT-PRINCIPAL1A.
 */
import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
/** A receipt's own lines: few, never rotated, so a later read can always find a receipt's admission. */
export const TENANT_CHANGE_RECORDS_FILENAME = 'tenant-registry-changes.jsonl';
export const ENVELOPE_IDEMPOTENCY_DIRNAME = 'envelope-idempotency';

/** Past this, a record moves aside. Every line rewrites the file, so its size is what keeps that cheap. */
export const DURABLE_LINE_ROTATE_BYTES = 1_048_576;
/** How long a line waits for a busy record: long enough for any writer, and then a refusal. */
const LOCK_WAIT_STEP_MS = 50;
const LOCK_WAIT_STEPS = 40;

export const TENANT_RECEIPT_SCHEMA_VERSION = '1.0.0';
export const TENANT_RECEIPT_KIND = 'tenant-registry-receipt';
/** How it was confirmed. A method, not a person. */
export const TENANT_RECEIPT_CONFIRMATION = 'typed-terminal';
const TENANT_RECEIPT_FIELDS = ['schemaVersion', 'kind', 'registryBlob', 'confirmedAt', 'confirmation', 'envelopeId', 'statement'];

/** Printed with every receipt answer, and written into the receipt. */
export const TENANT_RECEIPT_STATEMENT =
  'A tenant receipt shows that a person or a process confirmed this registry blob at a console, nothing more. ' +
  'It stops an agent with no terminal from using this command, and it stops a registry commit alone from moving a tenant. ' +
  'It does not stop a process that drives a console or writes the receipt and its line directly, because everything here runs as one Windows user (ADR-T1 section 10).';

/** A git object name. */
const GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export type TenantRefusalCode =
  | 'TENANT_UNKNOWN'
  | 'TENANT_MISMATCH'
  | 'TENANT_CHECKOUT_ALIAS'
  | 'TENANT_REGISTRY_UNREADABLE'
  | 'TENANT_REGISTRY_NO_RECEIPT'
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

/** Git, with replacement objects off: a `git replace` ref must not change what a name yields. */
function gitAt(sys: System, install: string, ...args: readonly string[]) {
  return sys.exec('git', ['--no-replace-objects', '-C', install, ...args]);
}

/** The object name of these bytes as a blob: what git itself computes, so a lie between us shows. */
function blobNameOf(text: string, blob: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return createHash(blob.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** One record's committed bytes at the installation's HEAD. Absent, unreadable or dirty all refuse. */
function committedBytes(sys: System, install: string, rel: string, code: 'TENANT_REGISTRY_UNREADABLE' | 'ACTION_REGISTRY_UNREADABLE'): CommittedBytes {
  const logged = gitAt(sys, install, 'log', '-1', '--format=%H', '--', rel);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) {
    return refusal(code, [`this ProjectOS installation commits no ${rel}, so it records no such authority`]);
  }
  const dirty = gitAt(sys, install, 'diff', '--name-only', 'HEAD', '--', rel);
  if (dirty.code !== 0 || dirty.stdout.trim().length > 0) {
    return refusal(code, [`${rel} has been changed in the working tree; only the committed bytes carry authority, and an edited file carries none`]);
  }
  const head = gitAt(sys, install, 'rev-parse', '--verify', 'HEAD');
  const commit = head.stdout.trim();
  if (head.code !== 0 || !GIT_OBJECT.test(commit)) return refusal(code, [`the installation's HEAD could not be read, so ${rel} cannot be`]);
  // PINNED TO ONE COMMIT, so the blob named and the bytes judged cannot come from two different HEADs.
  const named = gitAt(sys, install, 'rev-parse', `${commit}:./${rel}`);
  const blob = named.stdout.trim();
  const shown = gitAt(sys, install, 'show', `${commit}:./${rel}`);
  if (named.code !== 0 || !GIT_OBJECT.test(blob) || shown.code !== 0 || shown.stdout.trim().length === 0) {
    return refusal(code, [`the committed ${rel} could not be read`]);
  }
  if (blobNameOf(shown.stdout, blob) !== blob) return refusal(code, [`what git showed for ${rel} does not hash to blob ${blob}, so it is not those bytes`]);
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

/**
 * The registry an older blob holds, judged whole, for comparing at the prompt. `null` when that blob is
 * gone or does not hold one. It decides nothing: it only shows a person what moved.
 */
export function registryAtBlob(sys: System, installRoot: string, blob: string): TenantRegistry | null {
  const shown = gitAt(sys, installRoot, 'show', blob);
  if (shown.code !== 0 || blobNameOf(shown.stdout, blob) !== blob) return null;
  try {
    const parsed = parseTenantRegistry(JSON.parse(shown.stdout) as unknown);
    return parsed.ok ? parsed.registry : null;
  } catch {
    return null;
  }
}

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
 * THE RECEIPT.
 * ------------------------------------------------------------------------------------------- */

export interface TenantRegistryReceipt {
  readonly schemaVersion: string;
  readonly kind: string;
  readonly registryBlob: string;
  readonly confirmedAt: string;
  readonly confirmation: string;
  /** The admission the door recorded for this receipt. */
  readonly envelopeId: string;
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

/** The one line a person runs. Absolute and quoted, so it works from any directory and with spaces. */
export function tenantReceiptCommand(installRoot: string, blob: string): string {
  return `node "${installRoot.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '')}/projectos/agent/bin/projectos.js" tenant receipt --blob ${blob}`;
}

/** Did the door record this receipt? A receipt with no admission line is a copied file. */
function hasAdmissionLine(sys: System, stateDir: string, receipt: TenantRegistryReceipt): boolean {
  const lines = sys.readText(join(stateDir, TENANT_CHANGE_RECORDS_FILENAME));
  return (lines ?? '').split('\n').some((line) => {
    try {
      const record = JSON.parse(line) as Partial<EnvelopeRecord> | null;
      const envelope = record?.envelope;
      return (
        record?.stage === 'admission' &&
        record.outcome === 'allowed' &&
        envelope?.action === 'tenant-registry-change' &&
        envelope.envelopeId === receipt.envelopeId &&
        envelope.subjectHash === receipt.registryBlob
      );
    } catch {
      return false;
    }
  });
}

/** `null` when exactly this blob has a receipt and that receipt its line; otherwise the refusal, with the fix. */
export function receiptRefusal(sys: System, source: TenantSource, blob: string): TenantRefusal | null {
  if (source.stateDir === null) {
    return refusal('TENANT_REGISTRY_NO_RECEIPT', ['no installation state directory can be established, so no receipt can be read']);
  }
  const read = readTenantReceipt(sys, source.stateDir);
  const matches = read.kind === 'ok' && read.receipt.registryBlob === blob;
  if (matches && hasAdmissionLine(sys, source.stateDir, read.receipt)) return null;
  const finding =
    read.kind === 'absent'
      ? `the committed tenant registry (blob ${blob}) has no receipt`
      : read.kind === 'unreadable'
        ? `the receipt at ${tenantReceiptPath(source.stateDir)} cannot be trusted (${read.why})`
        : matches
          ? `the receipt for blob ${blob} has no admission line in ${TENANT_CHANGE_RECORDS_FILENAME}`
          : `the committed tenant registry is blob ${blob}, and the receipt names ${read.receipt.registryBlob}`;
  return refusal('TENANT_REGISTRY_NO_RECEIPT', [
    `${finding}, so it carries no authority and no tenant can be derived`,
    'a person confirms it once, in PowerShell or Windows Terminal (Git Bash gives no terminal), with this one line:',
    `  ${tenantReceiptCommand(source.installRoot, blob)}`,
  ]);
}

/**
 * Write the receipt. Only `commands/tenant.ts` calls this, after the typed confirmation, and only after
 * the door has recorded the P5 admission, whose id it carries. `true` means the bytes were read back.
 */
export function writeTenantReceipt(sys: System, stateDir: string, blob: string, at: string, envelopeId: string): boolean {
  const path = tenantReceiptPath(stateDir);
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const receipt: TenantRegistryReceipt = {
    schemaVersion: TENANT_RECEIPT_SCHEMA_VERSION,
    kind: TENANT_RECEIPT_KIND,
    registryBlob: blob,
    confirmedAt: at,
    confirmation: TENANT_RECEIPT_CONFIRMATION,
    envelopeId,
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
 * a second spelling, and refusing that closes relative paths, 8.3 names, junctions, symlinks, `\\?\` and
 * UNC forms, a trailing dot and an alternate data stream without a list that could be incomplete.
 */
export function canonicalCheckoutRoot(root: string, realpath: (path: string) => string = realpathSync.native): CanonicalCheckout {
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
 * Take a record's lock, waiting a bounded time while another process holds it.
 *
 * A lock that is not there after a failed create was not held: either its holder just let go, which one
 * more try answers, or this directory cannot be written, and waiting would not help.
 */
function takeRecordLock(sys: System, lock: string): boolean {
  const content = `{"heldSince":"${sys.now()}"}\n`;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let step = 0; step < LOCK_WAIT_STEPS; step += 1) {
    if (sys.createExclusive(lock, content)) return true;
    if (!sys.exists(lock)) return sys.createExclusive(lock, content);
    Atomics.wait(pause, 0, 0, LOCK_WAIT_STEP_MS);
  }
  return false;
}

/**
 * Append one JSON line, or answer `false`. It never drops a line and calls that a success.
 *
 * A LOCK HELD PAST THE BOUND IS A FAILURE TO RECORD, and the caller stops, so a busy bridge delays a run
 * and a dead process's lock refuses by name. A file that exists and cannot be read is never replaced,
 * because replacing it would erase what it holds. Past its size the record moves aside, kept, under the
 * same lock; if it cannot move, nothing is written.
 */
export function appendDurableLine(sys: System, path: string, entry: unknown): boolean {
  const lock = `${path}.lock`;
  if (!takeRecordLock(sys, lock)) return false;
  try {
    const held = sys.readText(path);
    if (held === null && sys.exists(path)) return false;
    let existing = held;
    if (held !== null && Buffer.byteLength(held, 'utf8') >= DURABLE_LINE_ROTATE_BYTES) {
      if (!sys.renameFile(path, `${path}.${sys.now().replace(/[^0-9TZ]/g, '')}-${randomBytes(4).toString('hex')}`)) return false;
      existing = null;
    }
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
export function envelopeRecorder(sys: System, stateDir: string | null, filename: string = ENVELOPE_RECORDS_FILENAME): EnvelopeRecorder {
  return (record: EnvelopeRecord) => stateDir !== null && appendDurableLine(sys, join(stateDir, filename), record);
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
  if (earlier === null) return { kind: 'unavailable', why: `the idempotency record ${path} cannot be read or written; if no run is in progress at this commit, a person may remove that file` };
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
