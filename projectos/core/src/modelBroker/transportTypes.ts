// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: packages/llm-core/src/model-data.ts; packages/llm-core/src/types.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: only the API names ProjectOS may call, the stop reasons and the four token buckets are kept; usage is a record of whole counts that is judged before it is trusted, the streaming and thinking shapes are cut, and the transport is one injected function
// Notice: full licence text in THIRD_PARTY_NOTICES

import type { RouteEntry } from './routeTypes.js';

/** The wire shapes a provider record may name. A closed list: a new one is a reviewed change. */
export const MODEL_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'ollama'] as const;
export type ModelApi = (typeof MODEL_APIS)[number];

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
const STOP_REASONS: readonly unknown[] = ['stop', 'length', 'toolUse', 'error', 'aborted'];

/** The four separately billed token buckets of one answer, whole numbers from 0. */
export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

const BUCKETS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

/** Why a usage report cannot be priced, or null. A NaN, a negative or a fraction is not a count. */
export function usageProblem(usage: unknown): string | null {
  if (typeof usage !== 'object' || usage === null) return 'usage is not a record';
  for (const bucket of BUCKETS) {
    const value = (usage as Record<string, unknown>)[bucket];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return `usage.${bucket} is not a whole count`;
  }
  return null;
}

/** The cache-inclusive prompt-token axis that picks a pricing tier. */
export function promptTokensOf(usage: TokenCounts): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

export interface ModelTransportRequest {
  /** The request's idempotency key. A transport that can resend must pass it on, so a repeat is not a second action. */
  readonly idempotencyKey: string;
  readonly api: ModelApi;
  readonly baseUrl?: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
}

export interface ModelTransportResult {
  readonly text: string;
  readonly stopReason: StopReason;
  readonly usage: TokenCounts;
}

/**
 * The transport is a port. Nothing in this module opens a socket: a later phase supplies the function that does,
 * and every test supplies a fake.
 */
export type ModelTransport = (route: RouteEntry & ModelTransportRequest) => Promise<ModelTransportResult>;

export function isStopReason(value: unknown): value is StopReason {
  return STOP_REASONS.includes(value);
}
