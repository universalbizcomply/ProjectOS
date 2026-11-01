// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/write_approval.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript onto the agent's System port; every write stages, with no boolean, no inline prompt and no background origin; staging refuses rather than losing a write silently
// SPDX-License-Identifier: MIT
// Ported-From: oh-my-hermes https://github.com/rlaope/oh-my-hermes
// Source-Path: src/plugin_bundle/omh/memory_admission.py
// Source-Commit: 612a1cd9c44a19ecddcd263865e40e8c3910a514
// Source-Copyright: Copyright (c) 2026 oh-my-hermes contributors
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the read, check and write under one lock kept; the reviewed hash made mandatory; auto-safe approval removed
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The proposal queue: the only code that writes a memory store.
 *
 * `proposeMemoryWrite` touches no store. It records what someone wants, for the owner to see.
 * `approveMemoryProposal` is the one route by which text lands, and it reads, checks and writes under
 * one hold of the lock: a check made outside the lock is advisory, because a write could land between
 * the check and the save.
 *
 * THE ORDER OF THE WRITES IS THE CRASH STORY. Provenance gains the new entry first, then the store
 * moves, then provenance drops what left, then the proposal is marked. A crash at any point leaves
 * spare provenance at worst, which the next write prunes, and never an entry that lost its record. If
 * the proposal was not marked, approving it again cannot land the text twice: an add is then a
 * duplicate, and a replace or remove has lost its pin.
 *
 * NO WAY TO WRITE WITHOUT THE OWNER. Nothing here runs on a timer or a loop. There is no consolidation
 * and no self-review; a proposal is made by a caller, and decided by the owner.
 *
 * THE CALLER'S IDENTITY IS NOT PART OF THE REQUEST. The kernel supplies `MemoryCaller`, and anything in
 * the request that claims otherwise is overwritten. It stays what the caller asserts until owner proof
 * exists, so it opens only the decision rule, and no screen depends on it.
 */
import {
  applyMemoryProposal,
  buildMemoryProposal,
  decideMemoryProposal,
  memoryEntryHash,
  memoryOk,
  memoryRefused,
  readMemoryProposal,
  type MemoryDecisionOutcome,
  type MemoryProposal,
  type MemoryRefused,
  type MemoryResult,
  type MemoryStoreState,
  type MemoryTarget,
  type MemoryWriteInput,
  type Role,
} from '@projectos/core';
import { containsSecret } from '../authoringEvidence.js';
import { join } from '../context.js';
import type { System } from '../system.js';
import {
  memoryDir,
  readMemoryStore,
  underMemoryLock,
  writeFileAtomically,
  writeMemoryEntries,
  writeMemoryProvenance,
} from './memoryFiles.js';

const PROPOSAL_ID = /^mem-[0-9a-f]{24}$/;
/** What may wait for the owner at once, so a loop cannot bury the queue the owner has to read. */
const MAX_PENDING_PROPOSALS = 50;

function proposalsDir(root: string): string {
  return join(memoryDir(root), 'proposals');
}

function proposalPath(root: string, id: string): string {
  return join(proposalsDir(root), `${id}.json`);
}

const asFile = (proposal: MemoryProposal): string => `${JSON.stringify(proposal, null, 2)}\n`;

/** Credentials never enter memory, and the agent's own vocabulary is what recognises one. */
function credentialRefusal(content: string | null): MemoryRefused | null {
  if (content === null || !containsSecret(content)) return null;
  return memoryRefused('MEMORY_CREDENTIAL', 'That text holds a credential. Nothing was proposed, and it is not repeated here.');
}

/** Who is calling, supplied by the kernel. Never read from a request, a proposal or a file. */
export interface MemoryCaller {
  readonly author: string;
  readonly role: Role;
  readonly session: string;
}

export type MemoryWriteRequest = Pick<MemoryWriteInput, 'target' | 'op' | 'kind' | 'content' | 'oldText' | 'ledgerRef'>;

/** Record a proposed write for the owner to see. The store is not touched. */
export function proposeMemoryWrite(sys: System, root: string, caller: MemoryCaller, request: MemoryWriteRequest): MemoryResult<MemoryProposal> {
  if (listPendingMemoryProposals(sys, root).pending.length >= MAX_PENDING_PROPOSALS) {
    return memoryRefused('MEMORY_QUEUE_FULL', `${MAX_PENDING_PROPOSALS} proposals are already waiting for the owner. Nothing was proposed.`);
  }
  const state = readMemoryStore(sys, root, request.target);
  if (!state.ok) return state;
  const input = { ...request, author: caller.author, authorRole: caller.role, session: caller.session, proposedAt: sys.now() };
  const proposal = buildMemoryProposal(input, state.value);
  if (!proposal.ok) return proposal;
  const credential = credentialRefusal(proposal.value.content);
  if (credential !== null) return credential;
  // Create-if-absent: a proposal is never written over another. Upstream logs a failed stage and
  // reports success; here the caller is told, because a write it believes is queued would be lost.
  return sys.createExclusive(proposalPath(root, proposal.value.id), asFile(proposal.value))
    ? proposal
    : memoryRefused('MEMORY_WRITE_FAILED', `Proposal ${proposal.value.id} could not be recorded.`);
}

export function loadMemoryProposal(sys: System, root: string, id: string): MemoryResult<MemoryProposal> {
  if (!PROPOSAL_ID.test(id)) return memoryRefused('MEMORY_NOT_FOUND', 'That is not a memory proposal id.');
  const text = sys.readText(proposalPath(root, id));
  if (text === null) return memoryRefused('MEMORY_NOT_FOUND', `There is no proposal ${id}.`);
  try {
    const proposal = readMemoryProposal(JSON.parse(text) as unknown);
    if (proposal.ok && proposal.value.id !== id) return memoryRefused('MEMORY_TAMPERED', `The file named ${id} holds another proposal.`);
    return proposal;
  } catch {
    return memoryRefused('MEMORY_TAMPERED', `Proposal ${id} is not valid JSON.`);
  }
}

export interface MemoryProposalListing {
  readonly pending: readonly MemoryProposal[];
  /** Files in the queue that did not read back as a proposal. Named, never dropped silently. */
  readonly unreadable: readonly string[];
}

/** Everything awaiting the owner, oldest first. */
export function listPendingMemoryProposals(sys: System, root: string): MemoryProposalListing {
  const ids = sys
    .listDir(proposalsDir(root))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
  const read = ids.map((id) => ({ id, result: loadMemoryProposal(sys, root, id) }));
  return {
    pending: read
      .flatMap(({ result }) => (result.ok ? [result.value] : []))
      .sort((a, b) => a.provenance.proposedAt.localeCompare(b.provenance.proposedAt)),
    unreadable: read.flatMap(({ id, result }) => (result.ok || result.refusal.code === 'MEMORY_ALREADY_DECIDED' ? [] : [id])),
  };
}

export interface MemoryDecisionRequest {
  readonly id: string;
  /** The hash the decider reviewed. Mandatory: a decision over unread text is not a decision. */
  readonly reviewedHash: string;
}

function decided(sys: System, root: string, caller: MemoryCaller, request: MemoryDecisionRequest, outcome: MemoryDecisionOutcome): MemoryResult<MemoryProposal> {
  const proposal = loadMemoryProposal(sys, root, request.id);
  if (!proposal.ok) return proposal;
  return decideMemoryProposal(proposal.value, outcome, caller.role, sys.now(), request.reviewedHash);
}

function land(sys: System, root: string, proposal: MemoryProposal, state: MemoryStoreState): MemoryResult<MemoryProposal> {
  const applied = applyMemoryProposal(proposal, state);
  if (!applied.ok) return applied;
  const { entries, record } = applied.value;
  const target: MemoryTarget = proposal.target;
  const widened = new Map(state.provenance);
  if (record !== null) widened.set(record.entryHash, record);
  const failed = memoryRefused('MEMORY_WRITE_FAILED', 'The memory store could not be written. The proposal stays pending.');
  if (!writeMemoryProvenance(sys, root, target, widened)) return failed;
  if (!writeMemoryEntries(sys, root, target, entries)) return failed;
  // THE STORE HAS MOVED. From here the text is in memory, so "failed" and "pending" would both be false.
  const held = new Set(entries.map(memoryEntryHash));
  const pruned = writeMemoryProvenance(sys, root, target, new Map([...widened].filter(([hash]) => held.has(hash))));
  const marked = writeFileAtomically(sys, proposalPath(root, proposal.id), asFile(applied.value.proposal));
  return pruned && marked
    ? memoryOk(applied.value.proposal)
    : memoryRefused('MEMORY_LANDED_INCOMPLETE', `The entry landed, but the records for ${proposal.id} could not be finished. Do not approve it again; another write will prune them.`);
}

/** The owner approves one proposal, and it lands, or it does not land at all. */
export function approveMemoryProposal(sys: System, root: string, caller: MemoryCaller, request: MemoryDecisionRequest): MemoryResult<MemoryProposal> {
  return underMemoryLock(sys, root, () => {
    const approved = decided(sys, root, caller, request, 'approved');
    if (!approved.ok) return approved;
    const state = readMemoryStore(sys, root, approved.value.target);
    if (!state.ok) return state;
    const credential = credentialRefusal(approved.value.content);
    if (credential !== null) return credential;
    return land(sys, root, approved.value, state.value);
  });
}

/** The owner rejects one proposal. It stays on file, decided, and nothing lands. */
export function rejectMemoryProposal(sys: System, root: string, caller: MemoryCaller, request: MemoryDecisionRequest): MemoryResult<MemoryProposal> {
  return underMemoryLock(sys, root, () => {
    const rejected = decided(sys, root, caller, request, 'rejected');
    if (!rejected.ok) return rejected;
    return writeFileAtomically(sys, proposalPath(root, request.id), asFile(rejected.value))
      ? rejected
      : memoryRefused('MEMORY_WRITE_FAILED', `Proposal ${request.id} could not be marked rejected.`);
  });
}
