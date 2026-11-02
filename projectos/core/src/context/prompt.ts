// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/context_compressor.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-02: modified for ProjectOS. CHANGED: upstream's labelled, redacted records for the summariser became fenced turns with their marks, redacted and with hidden characters removed; the prompt sections, ranks and stale flag are ProjectOS's
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * How a thread reaches a prompt, and how its turns reach a summariser.
 *
 * Nothing calls this yet. It is here because the marks only mean something if they survive to the reader.
 *
 * EVERY UNTRUSTED TEXT IS FENCED, at every step: a source in the tail, a source on its way to the summariser,
 * and the summary that came out, in `fence.ts`. A summary opens with its own label and its later lines are indented, so it cannot put a
 * decision line at the start of a line. Source text stays verbatim inside its fence, because a tool result
 * with its lines moved is no longer the source. `authority` here is a closed field.
 *
 * WHAT OUTRANKS A SUMMARY. Approved decisions go through `renderMemoryBlock`, the one way memory reaches a
 * prompt, so they keep every screen they have there. They sit outside the summary and above it. A source the
 * summary read that has since changed is named on the summary itself, from the current sources the caller
 * passes and from any newer read in the thread, so the reader is told which of its claims are out of date.
 * Pure.
 */
import { MEMORY_TARGETS, type MemoryTarget } from '../memory/store.js';
import type { CompactionPlan } from './compaction.js';
import { decisionBlock, fencedSummary, fencedTurn, renderedTurnText } from './fence.js';
import { cleanForSummariser } from './redact.js';
import { contextOk, contextRefused, type ContextResult } from './refusal.js';
import { checkContextThread, type ApprovedDecision, type ContextSummary, type ContextThread } from './thread.js';
import { isContextSourceRef, trustOfOrigin, type ContextRole, type ContextSourceRef, type ContextToolCall, type ContextTrust, type ContextTurn } from './turn.js';
import { headEndOf } from './window.js';

/** Highest first. A summary is last, whatever it says, and a reader is told so in its fence. */
export const CONTEXT_RANKS = ['kernel', 'approved-decision', 'current', 'summary'] as const;
export type ContextRank = (typeof CONTEXT_RANKS)[number];

export interface ContextPromptSection {
  readonly rank: ContextRank;
  readonly trust: ContextTrust;
  readonly authority: 'none';
  readonly role: ContextRole;
  readonly text: string;
  readonly toolCalls: readonly ContextToolCall[];
  readonly toolCallId: string | null;
}

export interface ContextPrompt {
  readonly agentId: string;
  /** A prompt never carries authority. A closed field, so no caller can read one into it. */
  readonly authority: 'none';
  readonly sections: readonly ContextPromptSection[];
  /** Sources the summary read that have since changed. */
  readonly staleSources: readonly string[];
  /** Decisions the memory screens replaced with a placeholder here. Each is still held by the thread. */
  readonly blockedDecisions: readonly string[];
}

function turnSection(turn: ContextTurn, rank: ContextRank): ContextPromptSection {
  return {
    rank,
    trust: trustOfOrigin(turn.origin),
    authority: 'none',
    role: turn.role,
    text: renderedTurnText(turn),
    toolCalls: turn.toolCalls,
    toolCallId: turn.toolCallId,
  };
}

/** The sources this summary read whose content is no longer what it read. */
function staleSourcesOf(thread: ContextThread, currentSources: readonly ContextSourceRef[]): readonly string[] {
  const read = thread.summary?.carriedSources ?? [];
  const current = [...currentSources, ...thread.turns.flatMap((turn) => (turn.source === null ? [] : [turn.source]))];
  const moved = read.filter((source) => current.some((now) => now.sourceId === source.sourceId && now.contentHash !== source.contentHash));
  return [...new Set(moved.map((source) => source.sourceId))];
}

interface DecisionSection {
  readonly section: ContextPromptSection;
  readonly blocked: readonly string[];
}

function decisionSection(target: MemoryTarget, decisions: readonly ApprovedDecision[]): ContextResult<DecisionSection> {
  const block = decisionBlock(target, decisions);
  if (!block.ok) return contextRefused('CONTEXT_DECISIONS_REFUSED', block.refusal.message, block.refusal.code);
  const section: ContextPromptSection = { rank: 'approved-decision', trust: 'untrusted', authority: 'none', role: 'user', text: block.value.text, toolCalls: [], toolCallId: null };
  return contextOk({ section, blocked: block.value.blocked });
}

/** One section for each memory target that holds a decision. */
function decisionSections(thread: ContextThread): ContextResult<readonly DecisionSection[]> {
  const sections: DecisionSection[] = [];
  for (const target of MEMORY_TARGETS) {
    const decisions = thread.decisions.filter((decision) => decision.target === target);
    if (decisions.length === 0) continue;
    const section = decisionSection(target, decisions);
    if (!section.ok) return section;
    sections.push(section.value);
  }
  return contextOk(sections);
}

/** A model wrote this, so it goes at the role a model's words have. The system role carries a privilege a fence cannot take away. */
function summarySection(summary: ContextSummary, stale: readonly string[]): ContextPromptSection {
  return { rank: 'summary', trust: 'untrusted', authority: 'none', role: 'assistant', text: fencedSummary(summary.text, summary.compactionId, stale), toolCalls: [], toolCallId: null };
}

/** The thread as a reader sees it, or why it must not be sent. */
export function renderContextPrompt(thread: ContextThread, currentSources: readonly ContextSourceRef[] = []): ContextResult<ContextPrompt> {
  const checked = checkContextThread(thread);
  if (!checked.ok) return checked;
  if (!currentSources.every(isContextSourceRef)) return contextRefused('CONTEXT_TURN_INVALID', 'A current source must be of a closed shape.');
  const decisions = decisionSections(thread);
  if (!decisions.ok) return decisions;
  const staleSources = staleSourcesOf(thread, currentSources);
  const headEnd = headEndOf(thread.turns);
  return contextOk({
    agentId: thread.agentId,
    authority: 'none',
    sections: [
      ...thread.turns.slice(0, headEnd).map((turn) => turnSection(turn, 'kernel')),
      ...decisions.value.map(({ section }) => section),
      ...(thread.summary === null ? [] : [summarySection(thread.summary, staleSources)]),
      ...thread.turns.slice(headEnd).map((turn) => turnSection(turn, 'current')),
    ],
    staleSources,
    blockedDecisions: decisions.value.flatMap(({ blocked }) => blocked),
  });
}

/**
 * What the summariser reads. It holds the same fences, so the marks survive the step that could lose them, and
 * no turn reaches it unclean: a secret or a hidden character stops here, before a model can carry it forward.
 */
export function renderSummaryInput(plan: CompactionPlan): string {
  const turns = plan.summarise.map((turn) => {
    const text = cleanForSummariser(turn.text);
    return trustOfOrigin(turn.origin) === 'trusted' ? `[${turn.origin} turn ${turn.id}]\n${text}` : fencedTurn({ ...turn, text });
  });
  const prior = plan.priorSummary;
  return [...(prior === null ? [] : [fencedSummary(prior.text, prior.compactionId)]), ...turns].join('\n\n');
}
