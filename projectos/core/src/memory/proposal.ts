// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/write_approval.py; tools/memory_tool_store.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the config boolean, inline prompt and background origin replaced by one queue with no way around it; a pending record pinned by entry hash, carrying provenance, owner-decided; the decision rule added
// SPDX-License-Identifier: MIT
// Ported-From: oh-my-hermes https://github.com/rlaope/oh-my-hermes
// Source-Path: src/plugin_bundle/omh/memory_admission.py
// Source-Commit: 612a1cd9c44a19ecddcd263865e40e8c3910a514
// Source-Copyright: Copyright (c) 2026 oh-my-hermes contributors
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the review revision became a mandatory hash over everything the reviewer sees, not an optional one over a card
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * A memory write is a proposal. Nothing lands without the owner's approval.
 *
 * Upstream gates its writes with one boolean, off by default, and writes freely when it is off. That
 * behaviour is what this file replaces: there is no off here, no inline prompt and no second route.
 * `applyMemoryProposal` returns entries only for a proposal the owner approved, and the agent's queue
 * calls it in one place.
 *
 * WHAT AN APPROVAL IS BOUND TO. Two hashes. `targetEntryHash` pins the exact entry a replace or remove
 * was reviewed against, so any change to that entry makes the proposal stale. `proposalHash` covers
 * everything the reviewer sees, so an approval names the text that was actually read, and a changed
 * proposal file cannot borrow it. Upstream's revision check is optional; here it is required.
 *
 * WHAT MEMORY IS NOT. An approval here lets one entry land in a capped note. It is not a gate receipt
 * and proves nothing about a phase, a plan or a decision. A `decision` entry is a recollection that
 * points at its ledger record, and the git record stays the fact.
 *
 * Applying a proposal is pure: it returns what the store should become, and the agent persists it.
 */
import { createHash } from 'node:crypto';
import { ROLES, type Role } from '../types.js';
import { admitMemoryContent, normalizedEntryKey, relativeTimePhrase } from './admission.js';
import type { HashPinnedDecision, HashPinnedOutcome, HashPinnedProposal } from './hashPinned.js';
import { memoryOk, memoryRefused, type MemoryResult } from './refusal.js';
import {
  MEMORY_TARGETS,
  findMemoryEntry,
  memoryCharLimit,
  memoryEntriesRoundTrip,
  memoryEntryHash,
  memoryStoreChars,
  type MemoryTarget,
} from './store.js';

export const MEMORY_ENTRY_KINDS = ['fact', 'decision', 'lesson', 'procedure', 'summary'] as const;
export type MemoryEntryKind = (typeof MEMORY_ENTRY_KINDS)[number];

export const MEMORY_OPS = ['add', 'replace', 'remove'] as const;
export type MemoryOp = (typeof MEMORY_OPS)[number];

export const MEMORY_PROPOSAL_STATES = ['pending', 'approved', 'applied', 'rejected'] as const;
export type MemoryProposalState = (typeof MEMORY_PROPOSAL_STATES)[number];

export type MemoryDecisionOutcome = HashPinnedOutcome;

const MEMORY_PROPOSAL_SCHEMA = 'projectos.memory-proposal/1';
const PROPOSAL_ID = /^mem-[0-9a-f]{24}$/;
const ENTRY_HASH = /^sha256:[0-9a-f]{64}$/;
/** A closed shape, because these values reach a prompt and a file name. Text would need its own scan. */
const ACTOR_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** A commit, or a path inside the repository, with an optional anchor. Never a climb out of it. */
const LEDGER_REF = /^(?:[0-9a-f]{7,40}|\.?[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/\.?[A-Za-z0-9_][A-Za-z0-9._-]*)*(?:#[A-Za-z0-9._-]+)?)$/;

/** Who proposed this, in which session, when, and over which text. Upstream records none of it. */
export interface MemoryProvenance {
  readonly author: string;
  readonly authorRole: Role;
  readonly session: string;
  readonly proposedAt: string;
  /** The hash of the content; for a remove, of the entry being removed. */
  readonly contentHash: string;
}

export type MemoryDecision = HashPinnedDecision;

interface MemoryProposalBody {
  readonly target: MemoryTarget;
  readonly op: MemoryOp;
  readonly kind: MemoryEntryKind;
  /** The whole new entry. Null only for a remove. */
  readonly content: string | null;
  /** The whole entry a replace or remove acts on, so the reviewer reads what would be lost. */
  readonly targetEntry: string | null;
  readonly targetEntryHash: string | null;
  /** Where the ledger holds this decision. Set for a `decision`. */
  readonly ledgerRef: string | null;
  /** A relative-time phrase in the content, shown to the reviewer: it will read wrong later. */
  readonly timeSensitive: string | null;
  readonly provenance: MemoryProvenance;
}

export interface MemoryProposal extends MemoryProposalBody, HashPinnedProposal<MemoryProposalState> {
  readonly schema: typeof MEMORY_PROPOSAL_SCHEMA;
}

/** What is recorded for each entry in a store. Written only when a proposal is applied. */
export interface MemoryEntryProvenance {
  readonly entryHash: string;
  readonly kind: MemoryEntryKind;
  readonly author: string;
  readonly authorRole: Role;
  readonly session: string;
  readonly proposedAt: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly approvedBy: Role;
  readonly approvedAt: string;
  readonly ledgerRef: string | null;
}

/** A store as read: its entries, and the provenance held for them, by entry hash. */
export interface MemoryStoreState {
  readonly entries: readonly string[];
  readonly provenance: ReadonlyMap<string, MemoryEntryProvenance>;
}

export interface MemoryWriteInput {
  readonly target: MemoryTarget;
  readonly op: MemoryOp;
  readonly kind: MemoryEntryKind;
  readonly content?: string;
  /** Selects the entry for a replace or remove. It is resolved once, here, and pinned by hash. */
  readonly oldText?: string;
  readonly ledgerRef?: string;
  readonly author: string;
  readonly authorRole: Role;
  readonly session: string;
  readonly proposedAt: string;
}

function hashBody(body: MemoryProposalBody): string {
  const fields = [
    MEMORY_PROPOSAL_SCHEMA,
    body.target,
    body.op,
    body.kind,
    body.content,
    body.targetEntry,
    body.targetEntryHash,
    body.ledgerRef,
    body.timeSensitive,
    body.provenance.author,
    body.provenance.authorRole,
    body.provenance.session,
    body.provenance.proposedAt,
    body.provenance.contentHash,
  ];
  return `sha256:${createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex')}`;
}

function sealProposal(body: MemoryProposalBody): MemoryProposal {
  const proposalHash = hashBody(body);
  return {
    ...body,
    schema: MEMORY_PROPOSAL_SCHEMA,
    id: `mem-${proposalHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    proposalHash,
    state: 'pending',
    decision: null,
  };
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function provenanceProblem(fields: {
  readonly author: unknown;
  readonly authorRole: unknown;
  readonly session: unknown;
  readonly proposedAt: unknown;
}): string | null {
  if (typeof fields.author !== 'string' || !ACTOR_LABEL.test(fields.author)) return 'an author';
  if (!isOneOf(fields.authorRole, ROLES)) return 'an author role';
  if (typeof fields.session !== 'string' || !ACTOR_LABEL.test(fields.session)) return 'a session';
  if (typeof fields.proposedAt !== 'string' || !ISO_INSTANT.test(fields.proposedAt)) return 'a time';
  return null;
}

function ledgerRefProblem(kind: MemoryEntryKind, ledgerRef: string | null): boolean {
  if (kind === 'decision' && ledgerRef === null) return true;
  return ledgerRef !== null && !LEDGER_REF.test(ledgerRef);
}

/** The entry a replace or remove acts on. An add has none. */
function locateTarget(input: MemoryWriteInput, entries: readonly string[]): MemoryResult<string | null> {
  if (input.op === 'add') return memoryOk(null);
  const oldText = (input.oldText ?? '').trim();
  if (oldText === '') return memoryRefused('MEMORY_NO_MATCH', `A ${input.op} must say which entry it acts on.`);
  const match = findMemoryEntry(entries, oldText);
  if (match.kind === 'ambiguous') {
    return memoryRefused('MEMORY_AMBIGUOUS', `${match.count} entries match that text. Be more specific.`);
  }
  if (match.kind === 'none') return memoryRefused('MEMORY_NO_MATCH', 'No entry matches that text.');
  return memoryOk(entries[match.index] ?? null);
}

/**
 * Whether this proposal may touch this entry at all.
 *
 * A SUMMARY NEVER OVERWRITES A DECISION. Not by the owner's approval either: approval is the wrong
 * tool, because a tired reviewer approving a tidy summary is exactly how a decision gets lost. A
 * decision is held by what the store recorded when it landed, never by what the proposal claims about
 * its target. Only the owner's own writing may replace or remove one, and that writing may not be a
 * summary. An entry with no provenance is treated as a decision: unknown is not safe to overwrite.
 */
function decisionProblem(proposal: MemoryProposal, targetKind: MemoryEntryKind | null): MemoryResult<null> | null {
  if (targetKind !== 'decision' && targetKind !== null) return null;
  if (proposal.provenance.authorRole === 'owner' && proposal.kind !== 'summary') return null;
  return memoryRefused(
    'MEMORY_DECISION_PROTECTED',
    'That entry is a decision, or has no provenance. A summary cannot overwrite it, and only the owner may change it.',
  );
}

function duplicateProblem(content: string, others: readonly string[]): MemoryResult<null> | null {
  const key = normalizedEntryKey(content);
  const held = others.find((entry) => normalizedEntryKey(entry) === key);
  if (held === undefined) return null;
  return memoryRefused('MEMORY_DUPLICATE', `That text is already held as ${memoryEntryHash(held)}. Nothing was proposed.`);
}

function nextEntries(proposal: MemoryProposal, entries: readonly string[], index: number): MemoryResult<readonly string[]> {
  const others = entries.filter((_, position) => position !== index);
  const content = proposal.content;
  if (content !== null) {
    const duplicate = duplicateProblem(content, others);
    if (duplicate !== null) return duplicate as MemoryResult<never>;
  }
  const next =
    proposal.op === 'add'
      ? [...entries, content ?? '']
      : proposal.op === 'replace'
        ? entries.map((entry, position) => (position === index ? (content ?? '') : entry))
        : others;
  const limit = memoryCharLimit(proposal.target);
  const total = memoryStoreChars(next);
  if (proposal.op !== 'remove' && total > limit) {
    return memoryRefused(
      'MEMORY_OVER_LIMIT',
      `This would put ${proposal.target} at ${total}/${limit} chars: free at least ${total - limit} chars first.`,
    );
  }
  if (!memoryEntriesRoundTrip(next)) {
    return memoryRefused('MEMORY_ENTRY_SPLITS', 'This text would not read back as one entry: it holds the § delimiter on a line of its own.');
  }
  return memoryOk(next);
}

/**
 * What the store would become, or why it must not.
 *
 * The same rules run at proposal and at approval, so nothing is approved that would then fail, and a
 * store that moved in between is judged as it is now. It decides nothing about approval.
 */
export function checkMemoryProposal(proposal: MemoryProposal, state: MemoryStoreState): MemoryResult<readonly string[]> {
  const intact = proposalIntegrityProblem(proposal);
  if (intact !== null) return memoryRefused('MEMORY_TAMPERED', intact);
  if (proposal.content !== null) {
    const admitted = admitMemoryContent(proposal.content, proposal.provenance.authorRole);
    if (!admitted.ok) return admitted;
  }
  const index = state.entries.findIndex((entry) => memoryEntryHash(entry) === proposal.targetEntryHash);
  if (proposal.op !== 'add') {
    if (index < 0) {
      return memoryRefused('MEMORY_STALE', 'The entry changed since this was proposed, so it was not applied. Propose it again.');
    }
    const held = state.provenance.get(proposal.targetEntryHash ?? '');
    const protectedEntry = decisionProblem(proposal, held?.kind ?? null);
    if (protectedEntry !== null) return protectedEntry as MemoryResult<never>;
  }
  return nextEntries(proposal, state.entries, index);
}

/** Turn a write into a proposal. It touches nothing; persisting the proposal is the queue's job. */
export function buildMemoryProposal(input: MemoryWriteInput, state: MemoryStoreState): MemoryResult<MemoryProposal> {
  const missing = provenanceProblem(input);
  if (missing !== null) return memoryRefused('MEMORY_PROVENANCE', `A memory proposal must name ${missing}.`);
  if (!isOneOf(input.target, MEMORY_TARGETS) || !isOneOf(input.op, MEMORY_OPS) || !isOneOf(input.kind, MEMORY_ENTRY_KINDS)) {
    return memoryRefused('MEMORY_PROVENANCE', 'A memory proposal must name a known target, operation and kind.');
  }
  const ledgerRef = input.ledgerRef ?? null;
  if (ledgerRefProblem(input.kind, ledgerRef)) {
    return memoryRefused('MEMORY_LEDGER_REF', 'A decision must point at its record in git, as a commit or a repository path.');
  }
  const located = locateTarget(input, state.entries);
  if (!located.ok) return located;
  const targetEntry = located.value;
  const content = input.op === 'remove' ? null : (input.content ?? '').trim();
  if (content === '') return memoryRefused('MEMORY_EMPTY', 'Content cannot be empty. Use remove to delete an entry.');
  const targetEntryHash = targetEntry === null ? null : memoryEntryHash(targetEntry);
  const proposal = sealProposal({
    target: input.target,
    op: input.op,
    kind: input.kind,
    content,
    targetEntry,
    targetEntryHash,
    ledgerRef,
    timeSensitive: content === null ? null : relativeTimePhrase(content) || null,
    provenance: {
      author: input.author,
      authorRole: input.authorRole,
      session: input.session,
      proposedAt: input.proposedAt,
      contentHash: content === null ? (targetEntryHash ?? '') : memoryEntryHash(content),
    },
  });
  const checked = checkMemoryProposal(proposal, state);
  return checked.ok ? memoryOk(proposal) : checked;
}

/** Null when this proposal is what it says it is. */
function proposalIntegrityProblem(proposal: MemoryProposal): string | null {
  const { content, targetEntry, targetEntryHash, op, provenance } = proposal;
  if (proposal.schema !== MEMORY_PROPOSAL_SCHEMA) return 'its schema is not one this version reads';
  if ((op === 'remove') !== (content === null)) return 'its content does not fit its operation';
  if ((op === 'add') !== (targetEntry === null)) return 'its target does not fit its operation';
  if (targetEntry === null ? targetEntryHash !== null : targetEntryHash !== memoryEntryHash(targetEntry)) {
    return 'its pin is not the hash of its target entry';
  }
  if (provenance.contentHash !== (content === null ? targetEntryHash : memoryEntryHash(content))) {
    return 'its provenance hash is not the hash of its content';
  }
  if (proposal.proposalHash !== hashBody(proposal)) return 'its hash does not match what it says';
  if (!proposal.id.startsWith(`mem-${proposal.proposalHash.slice('sha256:'.length, 'sha256:'.length + 24)}`)) {
    return 'its id does not match its hash';
  }
  return null;
}

function decisionFrom(raw: unknown): MemoryDecision | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const { outcome, by, at, proposalHash } = raw as Record<string, unknown>;
  const valid =
    (outcome === 'approved' || outcome === 'rejected') &&
    isOneOf(by, ROLES) &&
    typeof at === 'string' &&
    typeof proposalHash === 'string';
  return valid ? { outcome, by, at, proposalHash } : undefined;
}

const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';

/**
 * A proposal read back from a file, or the reason it is not one.
 *
 * A file is only a file. Every field is checked and the hash is recomputed, so a proposal edited on
 * disk is refused rather than approved under the text the reviewer read.
 */
export function readMemoryProposal(raw: unknown): MemoryResult<MemoryProposal> {
  const refuse = (why: string): MemoryResult<MemoryProposal> => memoryRefused('MEMORY_TAMPERED', `That proposal is not valid: ${why}.`);
  if (raw === null || typeof raw !== 'object') return refuse('it is not a record');
  const r = raw as Record<string, unknown>;
  const provenance = (r['provenance'] ?? {}) as Record<string, unknown>;
  const missing = provenanceProblem({
    author: provenance['author'],
    authorRole: provenance['authorRole'],
    session: provenance['session'],
    proposedAt: provenance['proposedAt'],
  });
  if (missing !== null) return refuse(`it does not name ${missing}`);
  const decision = decisionFrom(r['decision'] ?? null);
  if (
    decision === undefined ||
    r['schema'] !== MEMORY_PROPOSAL_SCHEMA ||
    typeof r['id'] !== 'string' ||
    !PROPOSAL_ID.test(r['id']) ||
    typeof r['proposalHash'] !== 'string' ||
    !ENTRY_HASH.test(r['proposalHash']) ||
    !isOneOf(r['target'], MEMORY_TARGETS) ||
    !isOneOf(r['op'], MEMORY_OPS) ||
    !isOneOf(r['kind'], MEMORY_ENTRY_KINDS) ||
    !isOneOf(r['state'], MEMORY_PROPOSAL_STATES) ||
    !nullableText(r['content']) ||
    !nullableText(r['targetEntry']) ||
    !nullableText(r['targetEntryHash']) ||
    !nullableText(r['ledgerRef']) ||
    !nullableText(r['timeSensitive']) ||
    typeof provenance['contentHash'] !== 'string'
  ) {
    return refuse('a field is missing or the wrong type');
  }
  const proposal: MemoryProposal = {
    schema: MEMORY_PROPOSAL_SCHEMA,
    id: r['id'],
    proposalHash: r['proposalHash'],
    state: r['state'],
    decision,
    target: r['target'],
    op: r['op'],
    kind: r['kind'],
    content: r['content'],
    targetEntry: r['targetEntry'],
    targetEntryHash: r['targetEntryHash'],
    ledgerRef: r['ledgerRef'],
    timeSensitive: r['timeSensitive'],
    provenance: {
      author: provenance['author'] as string,
      authorRole: provenance['authorRole'] as Role,
      session: provenance['session'] as string,
      proposedAt: provenance['proposedAt'] as string,
      contentHash: provenance['contentHash'],
    },
  };
  const problem = proposalIntegrityProblem(proposal);
  return problem === null ? memoryOk(proposal) : refuse(problem);
}

/**
 * The owner's decision on one proposal.
 *
 * Only the owner decides, only once, and only over the hash the owner reviewed: `reviewedHash` is
 * mandatory, so a decision cannot be recorded against text nobody read. This is a pure transform; it
 * says what was decided and lands nothing.
 */
export function decideMemoryProposal(
  proposal: MemoryProposal,
  outcome: MemoryDecisionOutcome,
  by: Role,
  at: string,
  reviewedHash: string,
): MemoryResult<MemoryProposal> {
  const intact = proposalIntegrityProblem(proposal);
  if (intact !== null) return memoryRefused('MEMORY_TAMPERED', `That proposal is not valid: ${intact}.`);
  if (proposal.state !== 'pending') {
    return memoryRefused('MEMORY_ALREADY_DECIDED', `Proposal ${proposal.id} is already ${proposal.state}.`);
  }
  if (by !== 'owner') return memoryRefused('MEMORY_NOT_OWNER', `Deciding a memory proposal requires the owner, got '${by}'.`);
  if (reviewedHash !== proposal.proposalHash) {
    return memoryRefused('MEMORY_STALE', 'The proposal is not the one that was reviewed. Read it again and decide again.');
  }
  return memoryOk({
    ...proposal,
    state: outcome,
    decision: { outcome, by, at, proposalHash: proposal.proposalHash },
  });
}

export interface AppliedMemoryProposal {
  readonly entries: readonly string[];
  readonly proposal: MemoryProposal;
  /** The new entry's provenance. Null for a remove. */
  readonly record: MemoryEntryProvenance | null;
}

/** What an approved proposal does to this store. The only function that yields entries to persist. */
export function applyMemoryProposal(proposal: MemoryProposal, state: MemoryStoreState): MemoryResult<AppliedMemoryProposal> {
  const decision = proposal.decision;
  if (proposal.state !== 'approved' || decision === null || decision.outcome !== 'approved') {
    return memoryRefused('MEMORY_NOT_APPROVED', `Proposal ${proposal.id} has not been approved, so nothing lands.`);
  }
  if (decision.by !== 'owner') return memoryRefused('MEMORY_NOT_OWNER', 'Only the owner can approve a memory write.');
  if (decision.proposalHash !== proposal.proposalHash) {
    return memoryRefused('MEMORY_STALE', 'The approval was given to a different text.');
  }
  const next = checkMemoryProposal(proposal, state);
  if (!next.ok) return next;
  const { provenance } = proposal;
  const record: MemoryEntryProvenance | null =
    proposal.content === null
      ? null
      : {
          entryHash: memoryEntryHash(proposal.content),
          kind: proposal.kind,
          author: provenance.author,
          authorRole: provenance.authorRole,
          session: provenance.session,
          proposedAt: provenance.proposedAt,
          proposalId: proposal.id,
          proposalHash: proposal.proposalHash,
          approvedBy: decision.by,
          approvedAt: decision.at,
          ledgerRef: proposal.ledgerRef,
        };
  return memoryOk({ entries: next.value, proposal: { ...proposal, state: 'applied' }, record });
}
