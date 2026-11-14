// Origin: original ProjectOS code
/**
 * COMMITTED DECISIONS OUTRANK RECOLLECTION (PROJECTOS-MEMORY-PROVENANCE1A, plan 3.3).
 *
 * Retrieved items are ranked by where they came from, never by what they say:
 *
 *   tier 0  a committed decision
 *   tier 1  approved memory, plan memory
 *   tier 2  an execution record, a finding
 *   tier 3  a summary, a recollection
 *
 * THE RANK IS COMPUTED FROM FIELDS THE KERNEL SETS. An item is `{ id, kind, timeMs, committed?, contradicts? }` and nothing
 * else: an item that carries text, or any other field, is refused, so stored text has no way to choose its own tier.
 *
 * A CLAIM TO TIER 0 OR 1 IS BELIEVED ONLY WITH A MINTED PROOF (fix round 1, H1). A proof is the object a committed read made
 * (`committedProof.ts`), registered where only that file can reach. A plain object holding two hex names, a copy of a real
 * proof, a `structuredClone` and a JSON round-trip are not proofs, and an item that offers one is REFUSED by its own code
 * (`PROVENANCE_PROOF_NOT_MINTED`). A proof also names the one file it read and the kind that file is: it must equal the item's id
 * and kind (`..._PATH_MISMATCH`, `..._KIND_MISMATCH`), so a proof for the memory file cannot make a decision. An item that
 * claims a committed kind and offers NO proof is not refused: it ranks as a recollection and says `unverifiedClaim`.
 *
 * A PROOF IS BOUND TO THE HEAD IT WAS MINTED AT (final round, N2). `rankByProvenance` takes the CURRENT head commit, and a proof minted at
 * another commit is refused (`PROVENANCE_PROOF_STALE_HEAD`): a decision removed since cannot keep ranking tier 0 on an old proof. With no
 * valid head, nothing that offers a proof ranks above a recollection: each such item is refused `PROVENANCE_HEAD_MISSING`.
 *
 * A DECISION OUTRANKS ANYTHING THAT CONTRADICTS IT. An item names the decisions it contradicts in `contradicts` (exact ids, set
 * by the kernel, never found by reading text). A lower-tier item that contradicts a proven decision in the set is marked
 * `overruledBy` it and sorts after every item of its tier that is not overruled.
 *
 * A SUMMARY NEVER REPLACES A DECISION. `provenanceReplacementProblem` is the question to ask before anything lets one stored
 * item stand in for another. It returns a machine-readable code, or null. Null is NOT an approval.
 *
 * ORDER DOES NOT DECIDE, AND NOTHING VANISHES UNSAID. Two items with one id keep the higher tier and the other is refused. Items
 * whose ids differ only by case or width (NFKC, lower case) are a COLLISION: every item with a proof stays ranked (a proof is
 * bound to its path, so it cannot shadow another), the collision is listed in `collisions`, and an item without a proof that
 * collides is refused naming every id in the group. Inside a tier the newer item ranks first, then the id.
 *
 * HOSTILE INPUT IS A REFUSAL, NOT AN EXCEPTION. Every item and every list is read once into a frozen copy from its data
 * properties; a getter, a hole, an extra own key, a method a list carries and a trap that throws all become a refusal value.
 *
 * Pure: no I/O, no clock.
 */
import { isCommittedProof, type CommittedProof } from './committedProof.js';
import { hasInvisibleCharacter, isGitObjectId, plainListOf, plainRecordOf } from './memoryShapes.js';

export const PROVENANCE_KINDS = [
  'committed-decision',
  'approved-memory',
  'plan-memory',
  'execution-record',
  'finding',
  'summary',
  'recollection',
] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** Lower ranks first. The one table every rule reads. */
export const PROVENANCE_TIERS: Readonly<Record<ProvenanceKind, number>> = Object.freeze({
  'committed-decision': 0,
  'approved-memory': 1,
  'plan-memory': 1,
  'execution-record': 2,
  finding: 2,
  summary: 3,
  recollection: 3,
});

export const MAX_PROVENANCE_ITEMS = 500;
export const MAX_PROVENANCE_ID_CHARS = 256;
const MAX_CONTRADICTS = 20;

export interface ProvenanceItem {
  readonly id: string;
  readonly kind: ProvenanceKind;
  readonly timeMs: number;
  /** The proof a committed read minted (`CommittedRead.proof`). Anything else offered here is refused. */
  readonly committed?: CommittedProof | null;
  readonly contradicts?: readonly string[];
}

export type ProvenanceRefusalCode =
  | 'PROVENANCE_ITEM_NOT_PLAIN'
  | 'PROVENANCE_ITEM_FIELD_UNKNOWN'
  | 'PROVENANCE_ID_INVALID'
  | 'PROVENANCE_KIND_UNKNOWN'
  | 'PROVENANCE_TIME_INVALID'
  | 'PROVENANCE_CONTRADICTS_INVALID'
  | 'PROVENANCE_PROOF_NOT_MINTED'
  | 'PROVENANCE_PROOF_PATH_MISMATCH'
  | 'PROVENANCE_PROOF_KIND_MISMATCH'
  | 'PROVENANCE_PROOF_STALE_HEAD'
  | 'PROVENANCE_HEAD_MISSING'
  | 'PROVENANCE_DUPLICATE_ID'
  | 'PROVENANCE_ID_COLLISION';

export interface RankedProvenanceItem {
  readonly rank: number;
  readonly id: string;
  /** What the item claimed. */
  readonly kind: ProvenanceKind;
  /** What it is ranked as: a claim to tier 0 or 1 without a proof is a recollection. */
  readonly effectiveKind: ProvenanceKind;
  readonly tier: number;
  readonly timeMs: number;
  readonly committed: CommittedProof | null;
  readonly overruledBy: readonly string[];
  readonly unverifiedClaim: boolean;
}

export interface ProvenanceRefusal {
  readonly index: number;
  readonly id: string | null;
  readonly code: ProvenanceRefusalCode;
  /** For a duplicate or a collision: every id involved, so none disappears unnamed. */
  readonly ids?: readonly string[];
}

export type ProvenanceRanking =
  | {
      readonly ok: true;
      readonly ranked: readonly RankedProvenanceItem[];
      readonly refused: readonly ProvenanceRefusal[];
      /** Groups of ids that differ only by case or width. Every item with a proof in a group is still in `ranked`. */
      readonly collisions: readonly (readonly string[])[];
    }
  | { readonly ok: false; readonly code: 'PROVENANCE_ITEMS_NOT_A_LIST' | 'PROVENANCE_TOO_MANY_ITEMS' };

const isKind = (value: unknown): value is ProvenanceKind => typeof value === 'string' && (PROVENANCE_KINDS as readonly string[]).includes(value);

/** A claim to a committed tier needs proof; the rest need none. */
const needsProof = (kind: ProvenanceKind): boolean => PROVENANCE_TIERS[kind] <= 1;

function idProblem(id: unknown): boolean {
  return typeof id !== 'string' || id.length === 0 || id.length > MAX_PROVENANCE_ID_CHARS || id !== id.trim() || hasInvisibleCharacter(id);
}

const canonicalId = (id: string): string => id.normalize('NFKC').toLowerCase();

/** What a kind is ranked as, given its proof. */
function effectiveKindOf(kind: ProvenanceKind, proof: CommittedProof | null): ProvenanceKind {
  return needsProof(kind) && proof === null ? 'recollection' : kind;
}

interface Snapshot {
  readonly id: string;
  readonly kind: ProvenanceKind;
  readonly timeMs: number;
  readonly committed: CommittedProof | null;
  readonly contradicts: readonly string[];
}

type Read = { readonly ok: true; readonly item: Snapshot } | { readonly ok: false; readonly code: ProvenanceRefusalCode; readonly id: string | null };

/** The proof an item may rank on: none offered, one minted for this very file and kind, or a refusal by code. */
function proofOfItem(offered: unknown, id: string, kind: ProvenanceKind, head: unknown): { readonly proof: CommittedProof | null } | { readonly code: ProvenanceRefusalCode } {
  if (!needsProof(kind) || offered === undefined || offered === null) return { proof: null };
  if (!isCommittedProof(offered)) return { code: 'PROVENANCE_PROOF_NOT_MINTED' };
  if (offered.path !== id) return { code: 'PROVENANCE_PROOF_PATH_MISMATCH' };
  if (offered.kind !== kind) return { code: 'PROVENANCE_PROOF_KIND_MISMATCH' };
  if (!isGitObjectId(head)) return { code: 'PROVENANCE_HEAD_MISSING' };
  if (offered.commit !== head) return { code: 'PROVENANCE_PROOF_STALE_HEAD' };
  return { proof: offered };
}

function snapshotOf(raw: unknown, head: unknown): Read {
  const read = plainRecordOf(raw, ['id', 'kind', 'timeMs', 'committed', 'contradicts']);
  if (!read.ok) return { ok: false, code: read.reason === 'unknown-field' ? 'PROVENANCE_ITEM_FIELD_UNKNOWN' : 'PROVENANCE_ITEM_NOT_PLAIN', id: null };
  const { id, kind, timeMs, committed, contradicts } = read.value;
  if (idProblem(id)) return { ok: false, code: 'PROVENANCE_ID_INVALID', id: null };
  const name = id as string;
  if (!isKind(kind)) return { ok: false, code: 'PROVENANCE_KIND_UNKNOWN', id: name };
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs < 0) return { ok: false, code: 'PROVENANCE_TIME_INVALID', id: name };
  const names = contradicts === undefined ? [] : plainListOf(contradicts, MAX_CONTRADICTS);
  if (names === null || names.some(idProblem)) return { ok: false, code: 'PROVENANCE_CONTRADICTS_INVALID', id: name };
  const proved = proofOfItem(committed, name, kind, head);
  if ('code' in proved) return { ok: false, code: proved.code, id: name };
  return { ok: true, item: { id: name, kind, timeMs, committed: proved.proof, contradicts: names as readonly string[] } };
}

/** An item read for the ranking. A read that throws is a refusal value, never an exception. */
function safeSnapshotOf(raw: unknown, head: unknown): Read {
  try {
    return snapshotOf(raw, head);
  } catch {
    return { ok: false, code: 'PROVENANCE_ITEM_NOT_PLAIN', id: null };
  }
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type Placed = Omit<RankedProvenanceItem, 'rank'>;

const compareRanked = (a: Placed, b: Placed): number =>
  a.tier - b.tier ||
  Number(a.overruledBy.length > 0) - Number(b.overruledBy.length > 0) ||
  b.timeMs - a.timeMs ||
  compareText(a.id, b.id);

/** Order every item by provenance, then freshness, against the CURRENT head commit. Items are read once; the result is frozen. */
export function rankByProvenance(items: unknown, headCommit: unknown): ProvenanceRanking {
  if (!Array.isArray(items)) return { ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' };
  if (items.length > MAX_PROVENANCE_ITEMS) return { ok: false, code: 'PROVENANCE_TOO_MANY_ITEMS' };
  const list = plainListOf(items, MAX_PROVENANCE_ITEMS);
  if (list === null) return { ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' };
  const refused: ProvenanceRefusal[] = [];
  const read: { readonly index: number; readonly item: Snapshot }[] = [];
  list.forEach((raw, index) => {
    const snap = safeSnapshotOf(raw, headCommit);
    if (snap.ok) read.push({ index, item: snap.item });
    else refused.push({ index, id: snap.id, code: snap.code });
  });

  const placed = read.map(({ index, item }) => {
    const effectiveKind = effectiveKindOf(item.kind, item.committed);
    const entry: Placed = {
      id: item.id,
      kind: item.kind,
      effectiveKind,
      tier: PROVENANCE_TIERS[effectiveKind],
      timeMs: item.timeMs,
      committed: item.committed,
      overruledBy: [],
      unverifiedClaim: effectiveKind !== item.kind,
    };
    return { index, entry, contradicts: item.contradicts };
  });

  // One id, one item: the higher tier stays, whichever came first. Duplicates are refused by code, not dropped silently.
  const best = new Map<string, (typeof placed)[number]>();
  for (const candidate of placed) {
    const held = best.get(candidate.entry.id);
    if (held === undefined || compareRanked(candidate.entry, held.entry) < 0) best.set(candidate.entry.id, candidate);
  }
  const unique = new Set(best.values());
  for (const candidate of placed) {
    if (!unique.has(candidate)) refused.push({ index: candidate.index, id: candidate.entry.id, code: 'PROVENANCE_DUPLICATE_ID', ids: [candidate.entry.id] });
  }

  // Ids that differ only by case or width: a proven item stays (its proof names its path), the rest are refused, and the group is named.
  const groups = new Map<string, (typeof placed)[number][]>();
  for (const candidate of unique) {
    const key = canonicalId(candidate.entry.id);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const collisions: (readonly string[])[] = [];
  const kept = new Set<(typeof placed)[number]>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.add(group[0] as (typeof placed)[number]);
      continue;
    }
    const names = Object.freeze(group.map((candidate) => candidate.entry.id).sort(compareText));
    collisions.push(names);
    for (const candidate of group) {
      if (candidate.entry.committed !== null) kept.add(candidate);
      else refused.push({ index: candidate.index, id: candidate.entry.id, code: 'PROVENANCE_ID_COLLISION', ids: names });
    }
  }

  // A proven decision overrules a lower-tier item that names it by id. A decision is never overruled.
  const decisions = new Set<string>();
  for (const candidate of kept) if (candidate.entry.effectiveKind === 'committed-decision') decisions.add(candidate.entry.id);
  const finished = [...kept].map(({ entry, contradicts }) => {
    if (entry.tier === 0) return entry;
    const names = new Set(contradicts.filter((name) => decisions.has(name)));
    return { ...entry, overruledBy: Object.freeze([...names].sort(compareText)) };
  });

  const ranked = finished.sort(compareRanked).map((entry, position) => Object.freeze({ ...entry, rank: position + 1 }));
  return {
    ok: true,
    ranked: Object.freeze(ranked),
    refused: Object.freeze(refused.sort((a, b) => a.index - b.index).map((entry) => Object.freeze(entry))),
    collisions: Object.freeze(collisions.sort((a, b) => compareText(a.join('\n'), b.join('\n')))),
  };
}

export type ProvenanceReplacementCode =
  | 'PROVENANCE_REPLACEMENT_INVALID'
  | 'PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION'
  | 'PROVENANCE_DECISION_NOT_REPLACEABLE'
  | 'PROVENANCE_LOWER_RANK_CANNOT_REPLACE';

interface Party {
  readonly kind: ProvenanceKind;
  readonly effectiveKind: ProvenanceKind;
  /** The file this party is about: what its proof read, else the `path` it states, else none. */
  readonly path: string | null;
}

/** A party read once. `boundTo` is the path a WRITER's proof must have read to count: a proof of another file is no proof here. */
function partyOf(value: unknown, boundTo: string | null | 'target'): Party | null {
  const read = plainRecordOf(value, boundTo === 'target' ? ['kind', 'committed', 'path'] : ['kind', 'committed']);
  if (!read.ok || !isKind(read.value.kind)) return null;
  const kind = read.value.kind;
  const offered = read.value.committed;
  const stated = read.value['path'];
  if (stated !== undefined && (typeof stated !== 'string' || stated.length === 0 || stated.length > 512)) return null;
  // The proof must be a minted one, of this kind (a proof from a memory read does not make a decision), and for a writer of the target's file.
  const minted = isCommittedProof(offered) && offered.kind === kind ? offered : null;
  const proof = minted !== null && (boundTo === 'target' || (boundTo !== null && minted.path === boundTo)) ? minted : null;
  return { kind, effectiveKind: effectiveKindOf(kind, proof), path: minted !== null ? minted.path : (stated ?? null) };
}

/**
 * May this writer stand in for this target? A code says no; null says this rule has no objection, which is not an approval.
 * The WRITER is judged as it is proven (an unproven claim to a decision is a recollection) and the TARGET as it is claimed
 * (an item that says it is a decision is protected as one): both choices lean to refusing.
 */
export function provenanceReplacementProblem(writer: unknown, target: unknown): ProvenanceReplacementCode | null {
  const over = partyOf(target, 'target');
  const by = partyOf(writer, over === null ? null : over.path);
  if (by === null || over === null) return 'PROVENANCE_REPLACEMENT_INVALID';
  if (over.kind === 'committed-decision') {
    return PROVENANCE_TIERS[by.effectiveKind] === PROVENANCE_TIERS['summary'] ? 'PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION' : 'PROVENANCE_DECISION_NOT_REPLACEABLE';
  }
  return PROVENANCE_TIERS[by.effectiveKind] > PROVENANCE_TIERS[over.kind] ? 'PROVENANCE_LOWER_RANK_CANNOT_REPLACE' : null;
}

const NAME = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}';
const DECISION_PATH = new RegExp(`^\\.projectops/closure/decisions/${NAME}\\.json$`);
const MEMORY_PATH = /^\.projectops\/memory\/(?:MEMORY|USER)\.md$/;
const PLAN_PATH = new RegExp(`^\\.projectops/(?:plan|current-state)-${NAME}\\.json$`);
const EXECUTION_PATH = new RegExp(`^\\.projectops/execution/${NAME}\\.json$`);
const FINDINGS_SUFFIX = '.findings.json';

/** What a stored file IS, from where it is. A path claims a kind and proves nothing: the proof is a committed read. */
export function provenanceKindOfPath(path: unknown): ProvenanceKind | null {
  if (typeof path !== 'string' || path.length > 512) return null;
  if (DECISION_PATH.test(path)) return 'committed-decision';
  if (MEMORY_PATH.test(path)) return 'approved-memory';
  if (PLAN_PATH.test(path)) return 'plan-memory';
  if (EXECUTION_PATH.test(path)) return path.endsWith(FINDINGS_SUFFIX) ? 'finding' : 'execution-record';
  return null;
}
