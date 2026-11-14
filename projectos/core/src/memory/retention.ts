// Origin: original ProjectOS code
/**
 * RETENTION AND DELETION, PER MEMORY CLASS (PROJECTOS-MEMORY-PROVENANCE1A, plan 3.3).
 *
 * The six classes are the ones in `docs/architecture/memory-classes.md`, in that order and under those names. Each says how
 * long it keeps what it holds. NO CLASS DELETES BY ITSELF: a deletion is always somebody's act, judged here and recorded in
 * the append-only deletion ledger (`deletionLedger.ts`).
 *
 * WHICH ACTION COVERS WHICH DELETION. The registry (`projectos/security/action-registry.json`, owner act O1) has exactly two
 * entries that touch deletion, and no weaker one:
 *
 *   `memory-delete`         P5, owner only, every time. Registered for "approved memory or anything a decision cites".
 *   `memory-index-rebuild`  P2, local. Registered for "derived indexes only".
 *
 * So classes 1 to 4 (programme and project memory, execution memory, curated memory, skills) are ALL `memory-delete`: approved
 * memory and what a decision cites are named by the registry, and everything else in those stores (a pending or rejected
 * proposal, an execution record no decision cites, a promoted skill) has NO entry of its own, so this rule gives it the
 * strictest entry rather than none. It over-covers on purpose: owner only. The cost is an owner prompt to remove an
 * uncited execution record, and a lighter entry for that is the owner's to register (a residual, not a gap that deletes freely).
 * Class 5, the retrieval index, is the one derived store and is `memory-index-rebuild`. Class 6 has no store yet.
 *
 * AN OWNER CHECK IS A PORT THAT ANSWERS EXACTLY `true`. A record that is merely well-formed is not an approval. The verifier
 * gets a frozen claim bound to this item's hash, tenant, project, path and reason AND to the checkout it will be removed from
 * (`root`) and to whether a committed decision cites it (`citedByDecision`), with a `claimHash` over all of it, so what the owner
 * approves is what is removed, where it is removed, and what relies on it. It is asked once, and anything but `true`
 * (a throw, a Promise, `'true'`, `1`, no verifier at all) refuses. The item's current hash must equal the hash asked about,
 * so an approval cannot be spent on bytes the owner never saw.
 *
 * `decisionCitesItem` only ever ADDS protection: a committed decision that mentions the item's path or hash marks the item
 * as cited. No text is read for meaning, and a decision that cannot be read marks the item `unknown`, which also needs the owner.
 *
 * Pure: no I/O, no clock.
 */
import { canonicalStringify, sha256Hex } from '../execution/evidence.js';
import { isProjectId, isTenantId } from '../tenant.js';
import { hasInvisibleCharacter, isSha256Hex, memoryPathShapeProblem, plainRecordOf } from './memoryShapes.js';

export const MEMORY_CLASS_IDS = ['programme-project-memory', 'execution-memory', 'curated-memory', 'skills', 'retrieval-index', 'code-intelligence-memory'] as const;
export type MemoryClassId = (typeof MEMORY_CLASS_IDS)[number];

export const MEMORY_DELETE_ACTION = Object.freeze({ id: 'memory-delete', class: 'P5' } as const);
export const MEMORY_INDEX_REBUILD_ACTION = Object.freeze({ id: 'memory-index-rebuild', class: 'P2' } as const);

export interface MemoryClassRetention {
  readonly id: MemoryClassId;
  /** As `docs/architecture/memory-classes.md` names it. */
  readonly name: string;
  readonly store: string;
  readonly retention: string;
  /** No class removes anything on a timer. */
  readonly autoDelete: false;
  readonly deleteAction: 'memory-delete' | 'memory-index-rebuild' | null;
  readonly deleteActionClass: 'P5' | 'P2' | null;
  readonly ownerRequired: boolean;
}

const retention = (entry: MemoryClassRetention): MemoryClassRetention => Object.freeze(entry);

export const MEMORY_RETENTION: readonly MemoryClassRetention[] = Object.freeze([
  retention({
    id: 'programme-project-memory',
    name: 'Programme and project memory',
    store: '.projectops/plan-*.json, current-state-*.json, project-config.json and .projectops/closure/',
    retention: 'Permanent, in git. It is authority: deleting anything a decision cites is memory-delete, owner only, every time.',
    autoDelete: false,
    deleteAction: 'memory-delete',
    deleteActionClass: 'P5',
    ownerRequired: true,
  }),
  retention({
    id: 'execution-memory',
    name: 'Execution memory',
    store: '.projectops/execution/ and .projectops/continuity/',
    retention: 'Kept with the run records in git, with no automatic deletion. Any deletion is memory-delete, owner only: the registry has no lighter entry.',
    autoDelete: false,
    deleteAction: 'memory-delete',
    deleteActionClass: 'P5',
    ownerRequired: true,
  }),
  retention({
    id: 'curated-memory',
    name: 'Curated memory',
    store: '.projectops/memory/ (MEMORY.md, USER.md, their provenance files and the proposals queue)',
    retention: 'Capped. An entry stays until the owner removes it by another approved proposal. Deleting approved memory is memory-delete, owner only.',
    autoDelete: false,
    deleteAction: 'memory-delete',
    deleteActionClass: 'P5',
    ownerRequired: true,
  }),
  retention({
    id: 'skills',
    name: 'Skills',
    store: '.projectops/skills/promoted/ and .projectops/skills/proposals/',
    retention: 'Versioned by its pin; a promoted skill stays until a new proposal replaces it. Its deletion has no entry of its own, so it is memory-delete, owner only.',
    autoDelete: false,
    deleteAction: 'memory-delete',
    deleteActionClass: 'P5',
    ownerRequired: true,
  }),
  retention({
    id: 'retrieval-index',
    name: 'Retrieval index',
    store: 'One SQLite file per tenant and project under the installation index directory',
    retention: 'Disposable: derived, so deleting the file and rebuilding answers the same. memory-index-rebuild, P2, local, no owner.',
    autoDelete: false,
    deleteAction: 'memory-index-rebuild',
    deleteActionClass: 'P2',
    ownerRequired: false,
  }),
  retention({
    id: 'code-intelligence-memory',
    name: 'Code-intelligence memory',
    store: 'None yet',
    retention: 'Not built. Nothing is stored, so nothing is retained or deleted, and a deletion here is refused.',
    autoDelete: false,
    deleteAction: null,
    deleteActionClass: null,
    ownerRequired: false,
  }),
]);

const PLAN_FILE = /^(?:(?:plan|current-state)-[A-Za-z0-9][A-Za-z0-9._-]*|project-config)\.json$/;

/** Which class a stored path belongs to, by where it is. Null for anything that is not a memory item (a document, say). */
export function memoryClassOfPath(path: unknown): MemoryClassId | null {
  if (memoryPathShapeProblem(path) !== null) return null;
  const segments = (path as string).split('/');
  if (segments[0] !== '.projectops' || segments.length < 2) return null;
  const [, area = '', ...rest] = segments;
  if (segments.length === 2) return PLAN_FILE.test(area) ? 'programme-project-memory' : null;
  if (rest.length === 0) return null;
  switch (area) {
    case 'closure':
      return 'programme-project-memory';
    case 'execution':
    case 'continuity':
      return 'execution-memory';
    case 'memory':
      return 'curated-memory';
    case 'skills':
      return 'skills';
    default:
      return null;
  }
}

export const MAX_DELETION_REASON_CHARS = 500;

/** A reason is recorded, so it must be one line of text a person could read. */
export function deletionReasonProblem(reason: unknown): boolean {
  return typeof reason !== 'string' || reason.trim() === '' || reason.length > MAX_DELETION_REASON_CHARS || hasInvisibleCharacter(reason);
}

export type MemoryDeletionCode =
  | 'DELETE_REQUEST_INVALID'
  | 'DELETE_BINDING_INVALID'
  | 'DELETE_NOT_A_MEMORY_ITEM'
  | 'DELETE_ITEM_ABSENT'
  | 'DELETE_HASH_MISMATCH'
  | 'DELETE_OWNER_VERIFIER_MISSING'
  | 'DELETE_OWNER_NOT_VERIFIED';

/** What the owner is asked to approve, and what a verifier binds to. Frozen; the verifier cannot change what was asked. */
export interface MemoryDeletionClaim {
  readonly action: 'memory-delete' | 'memory-index-rebuild';
  readonly actionClass: 'P5' | 'P2';
  readonly tenant: string;
  readonly project: string;
  readonly memoryClass: MemoryClassId;
  readonly path: string;
  readonly itemHash: string;
  /** The checkout this item is removed from, so an approval for one checkout cannot be spent in another. */
  readonly root: string;
  /** Where the deletion ledger stood when the owner was asked (entries, and the hash of the last): an approval for an old position cannot be replayed. */
  readonly ledgerCount: number;
  readonly ledgerHead: string;
  /** Whether a committed decision names the item (`'unknown'` when the decisions could not be read): the owner sees what relies on it. */
  readonly citedByDecision: boolean | 'unknown';
  readonly reason: string;
  /** sha-256 over every other field in canonical form, for a verifier to bind to. */
  readonly claimHash: string;
}

/** The injected owner check. It must answer exactly `true`; the one thing it may not be is the caller's own say-so. */
export type OwnerDeletionVerifier = (claim: MemoryDeletionClaim) => boolean;

export interface MemoryDeletionFacts {
  /** The checkout the agent will remove the item from, which the owner's claim names. */
  readonly root: string;
  /** The verified ledger's position now. */
  readonly ledger: { readonly count: number; readonly lastHash: string };
  /** The sha-256 of the item's bytes now, or null when it is not there. */
  readonly currentItemHash: string | null;
  readonly citedByDecision: boolean | 'unknown';
  readonly ownerVerifier?: OwnerDeletionVerifier | undefined;
}

export type MemoryDeletionJudgement =
  | {
      readonly ok: true;
      readonly action: 'memory-delete';
      readonly actionClass: 'P5';
      readonly memoryClass: MemoryClassId;
      readonly citedByDecision: boolean | 'unknown';
      readonly path: string;
      readonly itemHash: string;
    }
  | { readonly ok: false; readonly code: MemoryDeletionCode };

export interface MemoryDeletionRequest {
  readonly tenant: string;
  readonly project: string;
  readonly path: string;
  readonly itemHash: string;
  readonly reason: string;
}

/** A deletion request read once into a frozen copy, or null when it is not exactly the five fields, each well-formed. */
export function memoryDeletionRequestOf(raw: unknown): MemoryDeletionRequest | null {
  const read = plainRecordOf(raw, ['tenant', 'project', 'path', 'itemHash', 'reason']);
  if (!read.ok) return null;
  const { tenant, project, path, itemHash, reason } = read.value;
  if (!isTenantId(tenant) || !isProjectId(project) || typeof path !== 'string' || !isSha256Hex(itemHash) || deletionReasonProblem(reason)) return null;
  return Object.freeze({ tenant, project, path, itemHash, reason: reason as string });
}

/** A checkout path the claim can name: one line, a bounded length. */
export const deletionRootProblem = (root: unknown): boolean => typeof root !== 'string' || root.length === 0 || root.length > MAX_ROOT_CHARS || hasInvisibleCharacter(root);
const rootProblem = deletionRootProblem;
const MAX_ROOT_CHARS = 512;

/** A ledger position: a count of entries and the sha-256 of the last, or null. */
function ledgerPositionOf(value: unknown): { readonly count: number; readonly lastHash: string } | null {
  const read = plainRecordOf(value, ['count', 'lastHash']);
  if (!read.ok) return null;
  const { count, lastHash } = read.value;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && isSha256Hex(lastHash) ? { count, lastHash } : null;
}

const isCited = (value: unknown): value is boolean | 'unknown' => value === true || value === false || value === 'unknown';

/** The claim an owner verifier is asked about, for this request: frozen, bound to the hash, tenant, project and path. */
export function deletionOwnerClaimOf(
  request: unknown,
  memoryClass: MemoryClassId,
  action: MemoryDeletionClaim['action'],
  actionClass: MemoryDeletionClaim['actionClass'],
  binding: { readonly root: string; readonly citedByDecision: boolean | 'unknown'; readonly ledger: { readonly count: number; readonly lastHash: string } },
): MemoryDeletionClaim | null {
  const read = memoryDeletionRequestOf(request);
  const ledger = ledgerPositionOf(binding.ledger);
  if (read === null || ledger === null || rootProblem(binding.root) || !isCited(binding.citedByDecision)) return null;
  const fields = {
    action,
    actionClass,
    tenant: read.tenant,
    project: read.project,
    root: binding.root,
    memoryClass,
    path: read.path,
    itemHash: read.itemHash,
    citedByDecision: binding.citedByDecision,
    ledgerCount: ledger.count,
    ledgerHead: ledger.lastHash,
    reason: read.reason,
  };
  return Object.freeze({ ...fields, claimHash: sha256Hex(canonicalStringify(fields)) });
}

/** Ask once. Only the boolean `true` is an owner; a throw, a Promise and every other value is not. */
function ownerAnswered(verifier: OwnerDeletionVerifier, claim: MemoryDeletionClaim): boolean {
  try {
    return (verifier(claim) as unknown) === true;
  } catch {
    return false;
  }
}

/**
 * May this item be deleted? Classes 1 to 4 are `memory-delete` (P5) and need the owner whether or not a decision cites the
 * item. A refusal is a value with a code and quotes no text of the item.
 */
export function judgeMemoryDeletion(rawRequest: unknown, rawFacts: MemoryDeletionFacts): MemoryDeletionJudgement {
  const request = memoryDeletionRequestOf(rawRequest);
  if (request === null) return { ok: false, code: 'DELETE_REQUEST_INVALID' };
  const memoryClass = memoryClassOfPath(request.path);
  const entry = MEMORY_RETENTION.find((candidate) => candidate.id === memoryClass);
  if (memoryClass === null || entry === undefined || entry.deleteAction !== MEMORY_DELETE_ACTION.id) return { ok: false, code: 'DELETE_NOT_A_MEMORY_ITEM' };
  // The facts are the agent's, but they are read once and checked like anything else: wrong types are a refusal, not a throw.
  const read = plainRecordOf(rawFacts, ['root', 'ledger', 'currentItemHash', 'citedByDecision', 'ownerVerifier']);
  if (!read.ok) return { ok: false, code: 'DELETE_BINDING_INVALID' };
  const { root, ledger, currentItemHash, citedByDecision, ownerVerifier } = read.value;
  const position = ledgerPositionOf(ledger);
  if (rootProblem(root) || position === null || !isCited(citedByDecision)) return { ok: false, code: 'DELETE_BINDING_INVALID' };
  if (currentItemHash !== null && !isSha256Hex(currentItemHash)) return { ok: false, code: 'DELETE_BINDING_INVALID' };
  if (currentItemHash === null) return { ok: false, code: 'DELETE_ITEM_ABSENT' };
  if (currentItemHash !== request.itemHash) return { ok: false, code: 'DELETE_HASH_MISMATCH' };
  if (typeof ownerVerifier !== 'function') return { ok: false, code: 'DELETE_OWNER_VERIFIER_MISSING' };
  const claim = deletionOwnerClaimOf(request, memoryClass, MEMORY_DELETE_ACTION.id, MEMORY_DELETE_ACTION.class, { root: root as string, citedByDecision, ledger: position });
  if (claim === null || !ownerAnswered(ownerVerifier as OwnerDeletionVerifier, claim)) return { ok: false, code: 'DELETE_OWNER_NOT_VERIFIED' };
  return { ok: true, action: MEMORY_DELETE_ACTION.id, actionClass: MEMORY_DELETE_ACTION.class, memoryClass, citedByDecision, path: request.path, itemHash: request.itemHash };
}

export type IndexDeletionJudgement =
  | {
      readonly ok: true;
      readonly action: 'memory-index-rebuild';
      readonly actionClass: 'P2';
      readonly memoryClass: 'retrieval-index';
      readonly tenant: string;
      readonly project: string;
      readonly reason: string;
    }
  | { readonly ok: false; readonly code: 'DELETE_REQUEST_INVALID' };

/** Deleting a DERIVED index is `memory-index-rebuild`, P2, local: it needs no owner, because nothing is lost that cannot be rebuilt. */
export function judgeIndexDeletion(rawRequest: unknown): IndexDeletionJudgement {
  const read = plainRecordOf(rawRequest, ['tenant', 'project', 'reason']);
  if (!read.ok) return { ok: false, code: 'DELETE_REQUEST_INVALID' };
  const { tenant, project, reason } = read.value;
  if (!isTenantId(tenant) || !isProjectId(project) || deletionReasonProblem(reason)) return { ok: false, code: 'DELETE_REQUEST_INVALID' };
  return { ok: true, action: MEMORY_INDEX_REBUILD_ACTION.id, actionClass: MEMORY_INDEX_REBUILD_ACTION.class, memoryClass: 'retrieval-index', tenant, project, reason: reason as string };
}

/** Does this decision's text mention the item's path or hash? Substring search: linear, reads no meaning, adds protection only. */
export function decisionCitesItem(decisionText: unknown, item: { readonly path: string; readonly hash: string }): boolean {
  if (typeof decisionText !== 'string') return false;
  return (item.path !== '' && decisionText.includes(item.path)) || (item.hash !== '' && decisionText.includes(item.hash));
}
