// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/fallback_cooldown.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; state kept on a mutable agent became an immutable value per provider; the clock is passed in; a provider-declared reset is capped at the ceiling so one provider cannot rest for ever; the opt-in switch deferral and the entitlement-rejection marker are not ported
// Notice: full licence text in THIRD_PARTY_NOTICES

/** Why a call failed, as far as routing is concerned. */
export const FAILOVER_REASONS = ['rate_limit', 'billing', 'upstream_rate_limit', 'upstream_unavailable', 'authentication', 'invalid_request', 'unknown'] as const;
export type FailoverReason = (typeof FAILOVER_REASONS)[number];

const RATE_LIMIT_FAILOVER_REASONS: readonly FailoverReason[] = ['rate_limit', 'billing', 'upstream_rate_limit'];

/** 60 s, then 2 m, doubling to 4 h. */
export const COOLDOWN_BASE_SECONDS = 60;
export const COOLDOWN_MAX_SECONDS = 14_400;
const MAX_LEVEL = 12;

export interface CooldownState {
  /** The instant, in milliseconds, each provider rests until. */
  readonly until: ReadonlyMap<string, number>;
  /** How many times each provider has been limited since it last answered. */
  readonly levels: ReadonlyMap<string, number>;
}

export const NO_COOLDOWNS: CooldownState = Object.freeze({ until: new Map<string, number>(), levels: new Map<string, number>() });

/** Seconds until the provider-declared reset, or null when it is missing, invalid or already past. */
function providerResetDelay(resetAtMs: number | undefined, nowMs: number): number | null {
  if (typeof resetAtMs !== 'number' || !Number.isFinite(resetAtMs)) return null;
  const delay = (resetAtMs - nowMs) / 1000;
  return Number.isFinite(delay) && delay > 0 ? delay : null;
}

export interface ArmedCooldown {
  readonly state: CooldownState;
  /** The cooldown armed, in seconds, or null when this reason arms none. */
  readonly cooldownSeconds: number | null;
}

/**
 * Arm a provider's cooldown until its declared reset, or by exponential backoff: 60 s, 120 s, to 4 h.
 * Only the rate-limit family arms one. The state given is not changed.
 */
export function armCooldown(state: CooldownState, provider: string, reason: FailoverReason, nowMs: number, resetAtMs?: number): ArmedCooldown {
  if (!RATE_LIMIT_FAILOVER_REASONS.includes(reason)) return { state, cooldownSeconds: null };
  const level = state.levels.get(provider) ?? 0;
  const declared = providerResetDelay(resetAtMs, nowMs);
  const cooldownSeconds =
    declared === null ? Math.min(COOLDOWN_BASE_SECONDS * 2 ** level, COOLDOWN_MAX_SECONDS) : Math.min(Math.ceil(declared), COOLDOWN_MAX_SECONDS);
  const until = new Map(state.until).set(provider, nowMs + cooldownSeconds * 1000);
  const levels = new Map(state.levels).set(provider, Math.min(level + 1, MAX_LEVEL));
  return { state: Object.freeze({ until, levels }), cooldownSeconds };
}

/** A provider that answered is no longer resting, and starts again from the first step. */
export function clearCooldown(state: CooldownState, provider: string): CooldownState {
  if (!state.until.has(provider) && !state.levels.has(provider)) return state;
  const until = new Map(state.until);
  const levels = new Map(state.levels);
  until.delete(provider);
  levels.delete(provider);
  return Object.freeze({ until, levels });
}

/** Whether the provider is still resting at this instant. It rests until its end and not a moment longer. */
export function isCoolingDown(state: CooldownState, provider: string, nowMs: number): boolean {
  const until = state.until.get(provider);
  return until !== undefined && until > nowMs;
}
