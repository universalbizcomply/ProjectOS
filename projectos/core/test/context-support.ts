import { memoryEntryHash } from '../src/memory/store.js';
import type { MemoryTarget } from '../src/memory/store.js';
import {
  appendContextTurn,
  contextThreadHash,
  openContextAccount,
  openContextThread,
  withApprovedDecision,
  type AgentContextAccount,
  type ApprovedDecision,
  type CompactionDraft,
  type ContextAccounts,
  type ContextOrigin,
  type ContextResult,
  type ContextRole,
  type ContextThread,
  type ContextTurn,
  type ContextWindow,
} from '../src/context/index.js';

export const AT = '2026-11-01T10:00:00Z';
export const LEDGER = 'docs/changes/delta_spec_V4_PORTS.md';
/** 9,000 tokens of input, a trigger at 6,750 and a tail of 2,000. */
export const WINDOW: ContextWindow = { limitTokens: 10_000, reservedOutputTokens: 1_000, triggerRatio: 0.75 };
export const AGENT = 'agent-1';

export function must<T>(result: ContextResult<T>): T {
  if (!result.ok) throw new Error(`${result.refusal.code}: ${result.refusal.message}`);
  return result.value;
}

export const codeOf = (result: ContextResult<unknown>): string => (result.ok ? 'ok' : result.refusal.code);

export const turnOf = (id: string, role: ContextRole, origin: ContextOrigin, text: string, over: Partial<ContextTurn> = {}): ContextTurn => ({
  id,
  role,
  origin,
  text,
  toolCalls: [],
  toolCallId: null,
  source: null,
  ...over,
});

export const kernelTurn = (id: string, text: string): ContextTurn => turnOf(id, 'system', 'kernel', text);
export const ownerTurn = (id: string, text: string): ContextTurn => turnOf(id, 'user', 'owner', text);
export const agentTurn = (id: string, text: string): ContextTurn => turnOf(id, 'assistant', 'agent', text);
export const callTurn = (id: string, callId: string): ContextTurn =>
  turnOf(id, 'assistant', 'agent', 'reading', { toolCalls: [{ id: callId, name: 'read_file', args: '{}' }] });
export const resultTurn = (id: string, callId: string, text: string, sourceId?: string, origin: ContextOrigin = 'tool'): ContextTurn =>
  turnOf(id, 'tool', origin, text, {
    toolCallId: callId,
    source: sourceId === undefined ? null : { sourceId, contentHash: memoryEntryHash(text) },
  });

export const decisionOf = (entry: string, ledgerRef: string = LEDGER, target: MemoryTarget = 'memory'): ApprovedDecision => ({
  target,
  entry,
  record: {
    entryHash: memoryEntryHash(entry),
    kind: 'decision',
    author: 'owner',
    authorRole: 'owner',
    session: 'sess-0',
    proposedAt: AT,
    proposalId: 'mem-000000000000000000000000',
    proposalHash: `sha256:${'0'.repeat(64)}`,
    approvedBy: 'owner',
    approvedAt: AT,
    ledgerRef,
  },
});

export function accountsFor(agentId: string = AGENT, window: ContextWindow = WINDOW): ContextAccounts {
  return must(openContextAccount(new Map(), agentId, window));
}

export function accountOf(accounts: ContextAccounts, agentId: string = AGENT): AgentContextAccount {
  const account = accounts.get(agentId);
  if (account === undefined) throw new Error(`no account for ${agentId}`);
  return account;
}

export function threadOf(turns: readonly ContextTurn[], decisions: readonly ApprovedDecision[] = [], agentId: string = AGENT): ContextThread {
  const start = must(openContextThread(agentId));
  const withTurns = turns.reduce((thread, turn) => must(appendContextTurn(thread, turn)), start);
  return decisions.reduce((thread, decision) => must(withApprovedDecision(thread, decision)), withTurns);
}

export const draftFor = (thread: ContextThread, text: string, over: Partial<CompactionDraft> = {}): CompactionDraft => ({
  threadHash: contextThreadHash(thread),
  text,
  summarisedBy: 'summary-model',
  session: 'sess-1',
  at: AT,
  ...over,
});

/** `count` assistant turns of about 1,000 tokens each, so a thread reaches a trigger in a known number of steps. */
export const longTurns = (prefix: string, count: number): readonly ContextTurn[] =>
  Array.from({ length: count }, (_, index) => agentTurn(`${prefix}${index}`, `${prefix} ${index} `.padEnd(4_000, 'x')));
