// Origin: original ProjectOS code
/**
 * One model call, as the broker makes it. Nothing here opens a socket: the transport, the clock, the sleep and the
 * ledger are all handed in, and every test hands in a fake.
 *
 * EVERY CALL IS P3 AND CARRIES A BUDGET. A request with no budget, a zero budget or a budget that is not a whole
 * positive number of micro-USD is refused before the grant is asked and before the transport is reached. So is a
 * call the provider-spend grant does not confirm with exactly `true`, and a call whose worst case does not fit.
 *
 * RETRIES SPEND THE BUDGET TOO. Each attempt reserves its worst case against the call's budget before it is
 * dispatched, and an attempt that no longer fits is refused. The count of attempts is the store's, keyed by the
 * request's idempotency key: the request carries no history, so a caller cannot reset it.
 */

import { estimateCostMicroUsd, recordCall, type LedgerEntry, type RateCard } from '../gatekeeperCostLedger.js';
import { isProjectId } from '../tenant.js';
import { rateCardFor, type PricingTable } from './committedPricing.js';
import {
  NO_COOLDOWNS,
  armCooldown,
  clearCooldown,
  type CooldownState,
  type FailoverReason,
} from './cooldown.js';
import { chooseRoute, type ChosenRoute, type RouteSkip } from './fallback.js';
import type { ProviderRegistry } from './providerRegistry.js';
import type { RetryConfig } from './retry.js';
import { MAX_MODEL_ATTEMPTS, isModelIdempotencyKey, retryModelCall, type AttemptStore } from './retryPolicy.js';
import { routeKeyOf, type RouteEntry } from './routeTypes.js';
import { promptTokensOf, usageProblem, isStopReason, type ModelTransport, type ModelTransportResult, type TokenCounts } from './transportTypes.js';

/** Every model call is a paid call. The action registry owns the class; this is the class this module acts as. */
export const MODEL_CALL_CLASS = 'P3' as const;

const MAX_CHAIN = 8;
const MAX_TEXT = 128;

export class ModelCallError extends Error {
  readonly reason: FailoverReason;
  readonly retryAfterMs: number | undefined;
  readonly resetAtMs: number | undefined;

  constructor(reason: FailoverReason, message: string, extra: { readonly retryAfterMs?: number; readonly resetAtMs?: number } = {}) {
    super(message);
    this.name = 'ModelCallError';
    this.reason = reason;
    this.retryAfterMs = extra.retryAfterMs;
    this.resetAtMs = extra.resetAtMs;
  }
}

class AttemptsExhausted extends Error {}
class BudgetExhausted extends Error {}

export interface ModelCallRequest {
  /** `sha256:<64 hex>`. The attempt count is kept against it by the store. */
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly project: string;
  readonly phaseId: string;
  readonly chain: readonly RouteEntry[];
  readonly prompt: string;
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
  /** Mandatory, in whole micro-USD, above zero. */
  readonly budget: { readonly maxMicroUsd: number };
}

export interface CooldownBook {
  get(): CooldownState;
  set(state: CooldownState): void;
}

export function createCooldownBook(): CooldownBook {
  let state: CooldownState = NO_COOLDOWNS;
  return { get: () => state, set: (next) => void (state = next) };
}

export interface ModelBrokerDeps {
  readonly registry: ProviderRegistry;
  readonly pricing: PricingTable;
  readonly transport: ModelTransport;
  /** The provider-spend grant. Only a result of exactly `true` is a grant; a throw is not one. */
  readonly grant: (request: ModelCallRequest) => boolean | Promise<boolean>;
  readonly attempts: AttemptStore;
  readonly cooldowns: CooldownBook;
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** The per-call record (G-BUDGET). */
  readonly record: (entry: LedgerEntry) => void | Promise<void>;
  readonly retry?: RetryConfig;
}

export type ModelCallRefusalCode =
  | 'BUDGET_REQUIRED' | 'REQUEST_INVALID' | 'NO_GRANT' | 'NO_ROUTE' | 'OVER_BUDGET'
  | 'ATTEMPTS_EXHAUSTED' | 'CALL_FAILED' | 'USAGE_UNREADABLE' | 'RESPONSE_INVALID';

export interface ModelCallRefusal {
  readonly code: ModelCallRefusalCode;
  readonly reason: string;
  readonly skipped?: readonly RouteSkip[];
}

export type ModelCallOutcome =
  | {
      readonly ok: true;
      readonly text: string;
      readonly usage: TokenCounts;
      readonly costMicroUsd: number;
      readonly route: RouteEntry;
      readonly attempts: number;
      /** The answer cost more than the budget. The call happened and is recorded, and the caller must see this. */
      readonly overBudget: boolean;
      /** False when the ledger refused the record: the call happened and is not in the ledger. */
      readonly recorded: boolean;
    }
  | { readonly ok: false; readonly refusal: ModelCallRefusal };

const refuse = (code: ModelCallRefusalCode, reason: string, skipped?: readonly RouteSkip[]): ModelCallOutcome => ({
  ok: false,
  refusal: { code, reason, ...(skipped === undefined ? {} : { skipped }) },
});

const isCount = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const isName = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEXT;

function budgetOf(request: ModelCallRequest): number | null {
  const maxMicroUsd = (request?.budget as { maxMicroUsd?: unknown } | undefined)?.maxMicroUsd;
  return isCount(maxMicroUsd, 1) ? maxMicroUsd : null;
}

function requestProblem(request: ModelCallRequest): string | null {
  if (!isModelIdempotencyKey(request.idempotencyKey)) return 'the idempotency key is not sha256:<64 hex>';
  if (!isName(request.requestId) || !isName(request.phaseId)) return 'the request or phase id is not a name';
  if (!isProjectId(request.project)) return 'the project is not a project id';
  if (typeof request.prompt !== 'string') return 'the prompt is not text';
  if (!isCount(request.estimatedInputTokens, 0) || !isCount(request.maxOutputTokens, 1)) return 'the token counts are not whole numbers';
  const chain = request.chain;
  if (!Array.isArray(chain) || chain.length === 0 || chain.length > MAX_CHAIN) return `the chain is not one to ${MAX_CHAIN} routes`;
  return chain.every((entry) => isName(entry?.provider) && isName(entry?.model)) ? null : 'a route in the chain is not a provider and a model';
}

/** A time `Date` can hold: finite and inside its range. */
const clockIsUsable = (now: unknown): now is number => typeof now === 'number' && Number.isFinite(now) && Math.abs(now) <= 8.64e15;

async function granted(request: ModelCallRequest, deps: ModelBrokerDeps): Promise<boolean> {
  try {
    return (await deps.grant(request)) === true;
  } catch {
    return false;
  }
}

const FALLBACK_REASONS: readonly FailoverReason[] = ['rate_limit', 'billing', 'upstream_rate_limit', 'upstream_unavailable'];
const RETRY_REASONS: readonly FailoverReason[] = ['rate_limit', 'upstream_rate_limit', 'upstream_unavailable'];

const isRetryable = (err: unknown): boolean => err instanceof ModelCallError && RETRY_REASONS.includes(err.reason);

interface Budget {
  readonly cap: number;
  reserved: number;
  attempts: number;
}

/** Retries on one route, each reserving its worst case first. Throws what the last attempt threw. */
function attemptRoute(request: ModelCallRequest, route: ChosenRoute, worst: number, budget: Budget, deps: ModelBrokerDeps): Promise<ModelTransportResult> {
  return retryModelCall(
    async () => {
      if (budget.reserved + worst > budget.cap) throw new BudgetExhausted();
      const attempt = await deps.attempts.begin(request.idempotencyKey);
      if (attempt > MAX_MODEL_ATTEMPTS) throw new AttemptsExhausted();
      budget.reserved += worst;
      budget.attempts = attempt;
      return deps.transport({
        provider: route.provider,
        model: route.model,
        api: route.record.api,
        ...(route.record.baseUrl === undefined ? {} : { baseUrl: route.record.baseUrl }),
        prompt: request.prompt,
        maxOutputTokens: request.maxOutputTokens,
      });
    },
    {
      ...(deps.retry === undefined ? {} : { requested: deps.retry }),
      shouldRetry: isRetryable,
      retryAfterMs: (err) => (err instanceof ModelCallError ? err.retryAfterMs : undefined),
      sleep: deps.sleep,
      ...(deps.random === undefined ? {} : { random: deps.random }),
    },
  );
}

/** Whether the ledger took the record. A ledger that throws does not lose the answer, and the outcome says so. */
async function recorded(deps: ModelBrokerDeps, entry: LedgerEntry): Promise<boolean> {
  try {
    await deps.record(entry);
    return true;
  } catch {
    return false;
  }
}

/** What a call that was answered costs and records. A usage that cannot be read keeps its reserved worst case. */
async function settle(request: ModelCallRequest, route: ChosenRoute, result: ModelTransportResult, budget: Budget, worst: number, deps: ModelBrokerDeps): Promise<ModelCallOutcome> {
  const at = new Date(deps.clock()).toISOString();
  const ledger = { requestId: request.requestId, projectId: request.project, phaseId: request.phaseId, at };
  const unreadable = usageProblem(result?.usage) ?? (typeof result?.text === 'string' && isStopReason(result.stopReason) ? null : 'RESPONSE');
  if (unreadable !== null) {
    // The provider answered, so the spend may have happened: keep the worst case counted, never a free call.
    await recorded(deps, { ...ledger, model: route.rate.model, usage: { inputTokens: request.estimatedInputTokens, outputTokens: request.maxOutputTokens }, costMicroUsd: worst, unresolved: true });
    return unreadable === 'RESPONSE' ? refuse('RESPONSE_INVALID', 'the provider answer is not text with a stop reason') : refuse('USAGE_UNREADABLE', unreadable);
  }
  const actual = rateCardFor(deps.pricing, route.provider, route.model, promptTokensOf(result.usage));
  const rate: RateCard = actual.ok ? actual.rate : route.rate;
  const usage = { inputTokens: result.usage.input + result.usage.cacheWrite, cachedInputTokens: result.usage.cacheRead, outputTokens: result.usage.output };
  const entry = recordCall({ ...ledger, usage, rate });
  const costMicroUsd = entry.costMicroUsd;
  const wasRecorded = await recorded(deps, entry);
  deps.cooldowns.set(clearCooldown(deps.cooldowns.get(), route.provider));
  return { ok: true, text: result.text, usage: result.usage, costMicroUsd, route: { provider: route.provider, model: route.model }, attempts: budget.attempts, overBudget: costMicroUsd > budget.cap, recorded: wasRecorded };
}

/** Carry out one request. Always answers: a refusal is a value with a code, and the transport is reached only after every check. */
export async function callModel(request: ModelCallRequest, deps: ModelBrokerDeps): Promise<ModelCallOutcome> {
  const cap = budgetOf(request);
  if (cap === null) return refuse('BUDGET_REQUIRED', 'a model call needs a budget: whole micro-USD, above zero');
  const problem = requestProblem(request);
  if (problem !== null) return refuse('REQUEST_INVALID', problem);
  if (!clockIsUsable(deps.clock())) return refuse('REQUEST_INVALID', 'the clock did not give a time');
  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);

  const budget: Budget = { cap, reserved: 0, attempts: 0 };
  const tried = new Set<string>();
  let overBudget = false;
  let lastFailure = 'no route in the chain can be used';
  for (;;) {
    const choice = chooseRoute({ chain: request.chain, registry: deps.registry, cooldowns: deps.cooldowns.get(), pricing: deps.pricing, nowMs: deps.clock(), promptTokens: request.estimatedInputTokens, tried });
    if (!choice.ok) return overBudget ? refuse('OVER_BUDGET', 'no route fits inside the budget', choice.skipped) : refuse('NO_ROUTE', lastFailure, choice.skipped);
    const route = choice.route;
    tried.add(routeKeyOf(route));
    const worst = estimateCostMicroUsd({ inputTokens: request.estimatedInputTokens, outputTokens: request.maxOutputTokens }, route.rate);
    if (budget.reserved + worst > cap) {
      overBudget = true;
      continue;
    }
    let answer: ModelTransportResult;
    try {
      answer = await attemptRoute(request, route, worst, budget, deps);
    } catch (err) {
      if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED', `this key has used its ${MAX_MODEL_ATTEMPTS} attempts`);
      if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET', 'the next attempt does not fit inside the budget');
      const reason: FailoverReason = err instanceof ModelCallError ? err.reason : 'unknown';
      if (!FALLBACK_REASONS.includes(reason)) return refuse('CALL_FAILED', `the call failed: ${reason}`);
      const armed = armCooldown(deps.cooldowns.get(), route.provider, reason, deps.clock(), err instanceof ModelCallError ? err.resetAtMs : undefined);
      deps.cooldowns.set(armed.state);
      lastFailure = `every usable route failed, the last with ${reason}`;
      continue;
    }
    return settle(request, route, answer, budget, worst, deps);
  }
}
