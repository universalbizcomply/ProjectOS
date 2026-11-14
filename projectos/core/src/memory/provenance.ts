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
 * else: an item that carries text, or any other field, is refused, so stored text has no way to choose its own tier. A
 * claim to tier 0 or 1 is believed only with `committed: { commit, blob }`, the proof a committed-bytes read returns
 * (`committedBytes.ts`). A claim with no proof is ranked as a recollection and marked `unverifiedClaim`: it is neither hidden
 * nor believed.
 *
 * A DECISION OUTRANKS ANYTHING THAT CONTRADICTS IT. An item names the decisions it contradicts in `contradicts` (ids, set by
 * the kernel, never found by reading text). A lower-tier item that contradicts a proven decision in the set is marked
 * `overruledBy` it and sorts after every item of its tier that is not overruled. A summary is tier 3, so it sorts below
 * every decision whether or not it is marked.
 *
 * A SUMMARY NEVER REPLACES A DECISION. `provenanceReplacementProblem` is the question to ask before anything lets one stored
 * item stand in for another. It returns a machine-readable code, or null. Null is NOT an approval: it means this rule has no
 * objection, and the proposal door and the owner's approval still decide.
 *
 * ORDER DOES NOT DECIDE. Two items with one id (compared in NFKC and lower case, so a width or case variant cannot shadow a
 * decision) keep the higher tier whichever came first. Inside a tier the newer item ranks first, then the id.
 *
 * Pure: no I/O, no clock. Every item is read once, into a frozen copy.
 */
import { isGitObjectId, hasInvisibleCharacter, plainRecordOf } from './memoryShapes.js';

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

/** The proof that an item's bytes were read from a commit. Made by the committed-bytes read, not by a caller's say-so. */
export interface CommittedProof {
  readonly commit: string;
  readonly blob: string;
}

export interface ProvenanceItem {
  readonly id: string;
  readonly kind: ProvenanceKind;
  readonly timeMs: number;
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
  | 'PROVENANCE_DUPLICATE_ID';

export interface RankedProvenanceItem {
  readonly rank: number;
  readonly id: string;
  /** What the item claimed. */
  readonly kind: ProvenanceKind;
  /** What it is ranked as: a claim to tier 0 or 1 without proof is a recollection. */
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
}

export type ProvenanceRanking =
  | { readonly ok: true; readonly ranked: readonly RankedProvenanceItem[]; readonly refused: readonly ProvenanceRefusal[] }
  | { readonly ok: false; readonly code: 'PROVENANCE_ITEMS_NOT_A_LIST' | 'PROVENANCE_TOO_MANY_ITEMS' };

const isKind = (value: unknown): value is ProvenanceKind => typeof value === 'string' && (PROVENANCE_KINDS as readonly string[]).includes(value);

/** A claim to a committed tier needs proof; the rest need none. */
const needsProof = (kind: ProvenanceKind): boolean => PROVENANCE_TIERS[kind] <= 1;

function idProblem(id: unknown): boolean {
  return typeof id !== 'string' || id.length === 0 || id.length > MAX_PROVENANCE_ID_CHARS || id !== id.trim() || hasInvisibleCharacter(id);
}

/** The proof, copied, or null when it is not exactly a commit name and a blob name. */
function proofOf(value: unknown): CommittedProof | null {
  const read = plainRecordOf(value, ['commit', 'blob']);
  if (!read.ok) return null;
  const { commit, blob } = read.value;
  return isGitObjectId(commit) && isGitObjectId(blob) ? Object.freeze({ commit, blob }) : null;
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

function snapshotOf(raw: unknown): Read {
  const read = plainRecordOf(raw, ['id', 'kind', 'timeMs', 'committed', 'contradicts']);
  if (!read.ok) return { ok: false, code: read.reason === 'unknown-field' ? 'PROVENANCE_ITEM_FIELD_UNKNOWN' : 'PROVENANCE_ITEM_NOT_PLAIN', id: null };
  const { id, kind, timeMs, committed, contradicts } = read.value;
  if (idProblem(id)) return { ok: false, code: 'PROVENANCE_ID_INVALID', id: null };
  const name = id as string;
  if (!isKind(kind)) return { ok: false, code: 'PROVENANCE_KIND_UNKNOWN', id: name };
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs < 0) return { ok: false, code: 'PROVENANCE_TIME_INVALID', id: name };
  if (contradicts !== undefined && (!Array.isArray(contradicts) || contradicts.length > MAX_CONTRADICTS || contradicts.some(idProblem))) {
    return { ok: false, code: 'PROVENANCE_CONTRADICTS_INVALID', id: name };
  }
  return { ok: true, item: { id: name, kind, timeMs, committed: proofOf(committed), contradicts: Object.freeze([...((contradicts as readonly string[] | undefined) ?? [])]) } };
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type Placed = Omit<RankedProvenanceItem, 'rank'>;

const compareRanked = (a: Placed, b: Placed): number =>
  a.tier - b.tier ||
  Number(a.overruledBy.length > 0) - Number(b.overruledBy.length > 0) ||
  b.timeMs - a.timeMs ||
  compareText(a.id, b.id);

/** Order every item by provenance, then freshness. Items are read once; the result is frozen. */
export function rankByProvenance(items: unknown): ProvenanceRanking {
  if (!Array.isArray(items)) return { ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' };
  if (items.length > MAX_PROVENANCE_ITEMS) return { ok: false, code: 'PROVENANCE_TOO_MANY_ITEMS' };
  const list: readonly unknown[] = Array.from(items);
  const refused: ProvenanceRefusal[] = [];
  const read: { readonly index: number; readonly item: Snapshot }[] = [];
  list.forEach((raw, index) => {
    const snap = snapshotOf(raw);
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
    const key = canonicalId(candidate.entry.id);
    const held = best.get(key);
    if (held === undefined || compareRanked(candidate.entry, held.entry) < 0) best.set(key, candidate);
  }
  const kept = new Set(best.values());
  for (const candidate of placed) {
    if (!kept.has(candidate)) refused.push({ index: candidate.index, id: candidate.entry.id, code: 'PROVENANCE_DUPLICATE_ID' });
  }

  // A proven decision overrules a lower-tier item that names it. A decision is never overruled.
  const decisions = new Map<string, string>();
  for (const candidate of kept) if (candidate.entry.effectiveKind === 'committed-decision') decisions.set(canonicalId(candidate.entry.id), candidate.entry.id);
  const finished = [...kept].map(({ entry, contradicts }) => {
    if (entry.tier === 0) return entry;
    const names = new Set(contradicts.flatMap((name) => decisions.get(canonicalId(name)) ?? []));
    return { ...entry, overruledBy: Object.freeze([...names].sort(compareText)) };
  });

  const ranked = finished
    .sort(compareRanked)
    .map((entry, position) => Object.freeze({ ...entry, rank: position + 1 }));
  return { ok: true, ranked: Object.freeze(ranked), refused: Object.freeze(refused.sort((a, b) => a.index - b.index).map((entry) => Object.freeze(entry))) };
}

export type ProvenanceReplacementCode =
  | 'PROVENANCE_REPLACEMENT_INVALID'
  | 'PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION'
  | 'PROVENANCE_DECISION_NOT_REPLACEABLE'
  | 'PROVENANCE_LOWER_RANK_CANNOT_REPLACE';

interface Party {
  readonly kind: ProvenanceKind;
  readonly effectiveKind: ProvenanceKind;
}

function partyOf(value: unknown): Party | null {
  const read = plainRecordOf(value, ['kind', 'committed']);
  if (!read.ok || !isKind(read.value.kind)) return null;
  return { kind: read.value.kind, effectiveKind: effectiveKindOf(read.value.kind, proofOf(read.value.committed)) };
}

/**
 * May this writer stand in for this target? A code says no; null says this rule has no objection, which is not an approval.
 * The WRITER is judged as it is proven (an unproven claim to a decision is a recollection) and the TARGET as it is claimed
 * (an item that says it is a decision is protected as one): both choices lean to refusing.
 */
export function provenanceReplacementProblem(writer: unknown, target: unknown): ProvenanceReplacementCode | null {
  const by = partyOf(writer);
  const over = partyOf(target);
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
