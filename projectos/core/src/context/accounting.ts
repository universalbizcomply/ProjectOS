// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/context_compressor.py; agent/context_engine.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; a shared mutable engine became one immutable account per agent, reached by name; the raise-only floors that could push a trigger towards the limit were replaced by a refusal; the trigger also fires on what is about to arrive; cooldowns, durable breaker rows, prompt-cache rearm and per-model overrides not ported
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * How much of its window each agent has used, and when it must compact.
 *
 * THE TRIGGER FIRES BEFORE THE LIMIT, AND THIS IS WHAT MAKES THAT TRUE. Output space comes out of the
 * same window, so the percentage is taken of what is left for input. The ratio is capped, so the trigger
 * can never reach that input window. Upstream raises its trigger with a floor and then has to catch the
 * floor eating the whole window; a window that cannot hold a trigger is refused here instead. And the
 * test is on what is about to arrive as well as what has: a tool result can jump from under the trigger
 * to past the limit in one step, so asking only about the past would answer too late.
 *
 * ONE ACCOUNT PER AGENT. Upstream shares one mutable engine and clones it per agent. Accounts here are
 * values in a map keyed by agent, each with its own window, and every change returns a new map, so a
 * child's reading cannot reach its parent's account.
 *
 * A COMPACTION IS JUDGED BY THE NEXT REAL READING. Upstream's reasoning holds: a compaction can only shrink
 * the messages, and the system prompt and tool schemas are a floor it cannot touch. If that floor reaches
 * the trigger, every pass shrinks something and nothing is ever under it, so the judge is "did the prompt
 * clear the trigger", once, on the first provider reading after the compaction. Two strikes block
 * automatic compaction, and the account says so. Whether to stop is the kernel's decision: `overLimit`
 * gives it the fact, and nothing here sends or drops anything. Pure.
 */
import { contextOk, contextRefused, isContextLabel, type ContextResult } from './refusal.js';

export const MIN_TRIGGER_RATIO = 0.1;
export const MAX_TRIGGER_RATIO = 0.85;
export const MIN_INPUT_WINDOW_TOKENS = 1000;
export const MAX_INEFFECTIVE_STRIKES = 2;

const MIN_SUMMARY_TOKENS = 2000;
const SUMMARY_RATIO = 0.2;
const SUMMARY_WINDOW_SHARE = 0.05;
const SUMMARY_TOKENS_CEILING = 10_000;

export interface ContextWindow {
  readonly limitTokens: number;
  /** Output space the provider holds back out of the same window. */
  readonly reservedOutputTokens: number;
  readonly triggerRatio: number;
}

export interface AgentContextAccount {
  readonly agentId: string;
  readonly window: ContextWindow;
  readonly triggerTokens: number;
  /** The provider's last count of the prompt. Zero until a reading arrives, and again after a compaction. */
  readonly lastPromptTokens: number;
  readonly lastCompletionTokens: number;
  readonly compactions: number;
  readonly ineffectiveStrikes: number;
  /** A compaction ran, and no reading has judged it yet. */
  readonly awaitingVerdict: boolean;
}

export type ContextAccounts = ReadonlyMap<string, AgentContextAccount>;

export interface ContextUsage {
  readonly agentId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export type ContextAction = 'none' | 'compact' | 'blocked';

export interface ContextPressure {
  readonly agentId: string;
  readonly usedTokens: number;
  /** What is used, plus what is about to arrive. */
  readonly projectedTokens: number;
  readonly triggerTokens: number;
  readonly inputTokens: number;
  readonly remainingTokens: number;
  readonly percentUsed: number;
  readonly action: ContextAction;
  readonly overLimit: boolean;
}

const isWholeCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** What the window leaves for input once the provider's output space is held back. */
export function inputWindowTokens(window: ContextWindow): number {
  return window.limitTokens - window.reservedOutputTokens;
}

export function compactionTriggerTokens(window: ContextWindow): number {
  return Math.floor(inputWindowTokens(window) * window.triggerRatio);
}

function windowProblem(window: ContextWindow): string | null {
  if (!isWholeCount(window.limitTokens) || !isWholeCount(window.reservedOutputTokens)) return 'whole token counts';
  if (inputWindowTokens(window) < MIN_INPUT_WINDOW_TOKENS) return `at least ${MIN_INPUT_WINDOW_TOKENS} tokens of input`;
  const ratio = window.triggerRatio;
  if (typeof ratio !== 'number' || !(ratio >= MIN_TRIGGER_RATIO && ratio <= MAX_TRIGGER_RATIO)) {
    return `a trigger ratio from ${MIN_TRIGGER_RATIO} to ${MAX_TRIGGER_RATIO}`;
  }
  return null;
}

/** A new map holding this agent's own account. */
export function openContextAccount(accounts: ContextAccounts, agentId: string, window: ContextWindow): ContextResult<ContextAccounts> {
  if (!isContextLabel(agentId)) return contextRefused('CONTEXT_ACCOUNT_INVALID', 'An account needs an agent id of a closed shape.');
  if (accounts.has(agentId)) return contextRefused('CONTEXT_ACCOUNT_INVALID', `Agent ${agentId} already has an account.`);
  const problem = windowProblem(window);
  if (problem !== null) return contextRefused('CONTEXT_WINDOW_INVALID', `A context window needs ${problem}.`);
  return contextOk(
    new Map(accounts).set(agentId, {
      agentId,
      window,
      triggerTokens: compactionTriggerTokens(window),
      lastPromptTokens: 0,
      lastCompletionTokens: 0,
      compactions: 0,
      ineffectiveStrikes: 0,
      awaitingVerdict: false,
    }),
  );
}

function accountOf(accounts: ContextAccounts, agentId: string): ContextResult<AgentContextAccount> {
  const account = accounts.get(agentId);
  return account === undefined ? contextRefused('CONTEXT_NO_ACCOUNT', `Agent ${agentId} has no context account.`) : contextOk(account);
}

/** A reading from the provider, posted to the agent it names. A reading under the trigger clears the strikes. */
export function recordContextUsage(accounts: ContextAccounts, usage: ContextUsage): ContextResult<ContextAccounts> {
  const held = accountOf(accounts, usage.agentId);
  if (!held.ok) return held;
  const account = held.value;
  if (!isWholeCount(usage.promptTokens) || usage.promptTokens === 0 || !isWholeCount(usage.completionTokens)) {
    return contextRefused('CONTEXT_USAGE_INVALID', 'A reading needs a prompt count above zero and a whole completion count.');
  }
  const cleared = usage.promptTokens < account.triggerTokens;
  const strikes = cleared ? 0 : account.ineffectiveStrikes + (account.awaitingVerdict ? 1 : 0);
  return contextOk(
    new Map(accounts).set(account.agentId, {
      ...account,
      lastPromptTokens: usage.promptTokens,
      lastCompletionTokens: usage.completionTokens,
      ineffectiveStrikes: strikes,
      awaitingVerdict: false,
    }),
  );
}

/** A compaction ran. The old reading no longer describes the prompt, and the next one judges it. */
export function noteContextCompaction(accounts: ContextAccounts, agentId: string): ContextResult<ContextAccounts> {
  const held = accountOf(accounts, agentId);
  if (!held.ok) return held;
  const account = held.value;
  return contextOk(
    new Map(accounts).set(agentId, { ...account, lastPromptTokens: 0, compactions: account.compactions + 1, awaitingVerdict: true }),
  );
}

/** Where this agent stands, given a fresh estimate of its thread and what is about to arrive. */
export function contextPressure(accounts: ContextAccounts, agentId: string, estimatedTokens: number, incomingTokens = 0): ContextResult<ContextPressure> {
  const held = accountOf(accounts, agentId);
  if (!held.ok) return held;
  const account = held.value;
  if (!isWholeCount(estimatedTokens) || !isWholeCount(incomingTokens)) {
    return contextRefused('CONTEXT_USAGE_INVALID', 'An estimate must be a whole count of tokens.');
  }
  const usedTokens = Math.max(account.lastPromptTokens, estimatedTokens);
  const projectedTokens = usedTokens + incomingTokens;
  const inputTokens = inputWindowTokens(account.window);
  const due = projectedTokens >= account.triggerTokens;
  const blocked = account.ineffectiveStrikes >= MAX_INEFFECTIVE_STRIKES;
  return contextOk({
    agentId,
    usedTokens,
    projectedTokens,
    triggerTokens: account.triggerTokens,
    inputTokens,
    remainingTokens: inputTokens - projectedTokens,
    percentUsed: Math.round((projectedTokens / inputTokens) * 100),
    action: !due ? 'none' : blocked ? 'blocked' : 'compact',
    overLimit: projectedTokens >= inputTokens,
  });
}

/** The agents that should compact now. An agent with no estimate is judged on its last reading alone. */
export function agentsToCompact(accounts: ContextAccounts, estimates: ReadonlyMap<string, number>): readonly string[] {
  return [...accounts.keys()].filter((agentId) => {
    const pressure = contextPressure(accounts, agentId, estimates.get(agentId) ?? 0);
    return pressure.ok && pressure.value.action === 'compact';
  });
}

/** What a summary may spend: a share of what it replaces, between a floor and a ceiling set by the window. */
export function summaryBudgetTokens(window: ContextWindow, replacedTokens: number): number {
  const ceiling = Math.min(Math.floor(window.limitTokens * SUMMARY_WINDOW_SHARE), SUMMARY_TOKENS_CEILING);
  return Math.max(MIN_SUMMARY_TOKENS, Math.min(Math.floor(replacedTokens * SUMMARY_RATIO), ceiling));
}
