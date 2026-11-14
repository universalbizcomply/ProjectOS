// Origin: original ProjectOS code
/**
 * One model call, as the broker makes it. Nothing here opens a socket: the transport, the clock, the sleep and the
 * ledger are all handed in, and every test hands in a fake.
 *
 * EVERY CALL IS P3 AND CARRIES A BUDGET. A request with no budget, a zero budget or a budget that is not a whole
 * positive number of micro-USD is refused before the grant is asked and before the transport is reached. So is a
 * call the provider-spend grant does not confirm with exactly `true`, and a call whose worst case does not fit.
 *
 * THE BUDGET IS A BOUND, NOT A CLAIM. The caller's input-token estimate is raised to what the prompt itself needs,
 * measured by the cost ledger's own estimator, so a caller that says "zero tokens" for half a megabyte is refused.
 *
 * RETRIES SPEND THE BUDGET TOO. Each attempt reserves its worst case against the call's budget before it is
 * dispatched. A failure that is known to have cost nothing (a rate limit, a refusal, an outage) releases its
 * reservation; one that may have been billed (a timeout after send, an answer that was an error) keeps it.
 *
 * THE KEY IS THE REQUEST'S, AND IT TRAVELS. The idempotency key is derived from the tenant, project, request id and
 * prompt, and a request whose key is not that is refused. The attempt count and the cooldowns are kept per tenant and
 * project. The key is passed to the transport, a call that may have acted is retried only on the same route with the
 * same key and never falls back to another provider, and a finished request is answered from memory on a repeat.
 *
 * REFUSALS ARE VALUES. A business refusal comes back as `{ ok: false, refusal }` with a machine-readable code, and
 * nothing is thrown. A transport failure is the transport's to throw, and it is classed here, not rethrown.
 */

import { estimateCostMicroUsd, estimateInputTokensFromText, recordCall, type LedgerEntry, type RateCard } from '../gatekeeperCostLedger.js';
import { isProjectId, isTenantId } from '../tenant.js';
import { rateCardFor, type PricingTable } from './committedPricing.js';
import {
  NO_COOLDOWNS,
  armCooldown,
  clearCooldown,
  cooldownEndsAt,
  type CooldownState,
  type FailoverReason,
} from './cooldown.js';
import { chooseRoute, type ChosenRoute, type RouteSkip } from './fallback.js';
import { isNotPortedName, type ProviderRegistry } from './providerRegistry.js';
import type { RetryConfig } from './retry.js';
import { bindingKeyOf, fingerprintOf } from './requestKey.js';
import {
  AttemptStoreFull,
  MAX_MODEL_ATTEMPTS,
  brokerRetryConfig,
  isModelIdempotencyKey,
  retryModelCall,
  type AttemptScope,
  type AttemptStore,
  type StoredRequest,
} from './retryPolicy.js';
import { routeKeyOf, type RouteEntry } from './routeTypes.js';
import {
  isStopReason,
  promptTokensOf,
  usageProblem,
  type ModelTransport,
  type ModelTransportRequest,
  type ModelTransportResult,
  type StopReason,
  type TokenCounts,
} from './transportTypes.js';

/** Every model call is a paid call. The action registry owns the class; this is the class this module acts as. */
export const MODEL_CALL_CLASS = 'P3' as const;

const MAX_CHAIN = 8;
const MAX_TEXT = 128;
/** The most answer text one call may hand back. More is refused, after its spend has been recorded. */
export const MAX_RESULT_TEXT = 1_000_000;

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
  readonly tenant: string;
  /** `sha256:<64 hex>`, and exactly `bindingKeyOf` of this request. The attempt count is kept against it. */
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly project: string;
  readonly phaseId: string;
  readonly chain: readonly RouteEntry[];
  readonly prompt: string;
  /** The caller's estimate. It is raised to what the prompt needs and never lowered. */
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
  /** Mandatory, in whole micro-USD, above zero. */
  readonly budget: { readonly maxMicroUsd: number };
}

/** Cooldowns, one state per tenant and project. */
export interface CooldownBook {
  get(scope: AttemptScope): CooldownState;
  set(scope: AttemptScope, state: CooldownState): void;
}

export function createCooldownBook(): CooldownBook {
  const states = new Map<string, CooldownState>();
  const at = (scope: AttemptScope): string => `${scope.tenant}/${scope.project}`;
  return { get: (scope) => states.get(at(scope)) ?? NO_COOLDOWNS, set: (scope, state) => void states.set(at(scope), state) };
}

/** One attempt that did not give an answer, for the audit record. */
export interface AttemptRecord {
  readonly tenant: string;
  readonly project: string;
  readonly requestId: string;
  readonly provider: string;
  readonly model: string;
  readonly attempt: number;
  readonly reason: FailoverReason;
  /** What the attempt may have cost: zero when it is known to have been free. */
  readonly possiblySpentMicroUsd: number;
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
  /** The ledger: answers, and attempts that may have been billed (`unresolved`). */
  readonly record: (entry: LedgerEntry) => void | Promise<void>;
  /** The per-attempt audit record (G-BUDGET): every failed attempt, with its reason and what it may have cost. */
  readonly recordAttempt: (detail: AttemptRecord) => void | Promise<void>;
  readonly retry?: RetryConfig;
}

export type ModelCallRefusalCode =
  | 'BUDGET_REQUIRED' | 'REQUEST_INVALID' | 'NO_GRANT' | 'NO_ROUTE' | 'OVER_BUDGET'
  | 'ATTEMPTS_EXHAUSTED' | 'CALL_FAILED' | 'OUTCOME_UNKNOWN' | 'USAGE_UNREADABLE' | 'RESPONSE_INVALID'
  | 'IDEMPOTENCY_MISMATCH' | 'STORE_FULL';

/** What happened on one route, for a caller that has to decide what to do next. */
export interface RouteFailure extends RouteEntry {
  readonly reason: FailoverReason;
  readonly attempts: number;
  readonly possiblySpentMicroUsd: number;
}

export interface ModelCallRefusal {
  /** Machine-readable. */
  readonly code: ModelCallRefusalCode;
  readonly reason: string;
  /** When every route is cooling down, the earliest instant one is free again. */
  readonly retryAtMs?: number;
  /** One entry per route that was tried. */
  readonly failures?: readonly RouteFailure[];
  readonly skipped?: readonly RouteSkip[];
  /** For a refusal after a spend: whether the ledger took the record. */
  readonly recorded?: boolean;
  /** True when this is the remembered refusal of an earlier identical request: nothing was spent again. */
  readonly replayed?: boolean;
}

export interface ModelCallSuccess {
  readonly ok: true;
  readonly text: string;
  readonly usage: TokenCounts;
  /** `length` means the answer was cut. The caller must look. */
  readonly stopReason: StopReason;
  readonly costMicroUsd: number;
  readonly route: RouteEntry;
  readonly attempts: number;
  /** The answer cost more than the budget. The call happened and is recorded, and the caller must see this. */
  readonly overBudget: boolean;
  /** False when the ledger refused the record: the call happened and is not in the ledger. */
  readonly recorded: boolean;
  /** True when this is the remembered answer of an earlier identical request, and no call was made. */
  readonly replayed: boolean;
  /** On a replay only: what the ORIGINAL call did. This replay made no attempt and cost nothing now. */
  readonly original?: { readonly attempts: number; readonly costMicroUsd: number; readonly overBudget: boolean; readonly recorded: boolean };
}

export type ModelCallOutcome = ModelCallSuccess | { readonly ok: false; readonly refusal: ModelCallRefusal };

const refuse = (code: ModelCallRefusalCode, reason: string, extra: Omit<ModelCallRefusal, 'code' | 'reason'> = {}): ModelCallOutcome => ({
  ok: false,
  refusal: { code, reason, ...extra },
});

const isCount = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const isName = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEXT;

function budgetOf(request: ModelCallRequest): number | null {
  const maxMicroUsd = (request?.budget as { maxMicroUsd?: unknown } | undefined)?.maxMicroUsd;
  return isCount(maxMicroUsd, 1) ? maxMicroUsd : null;
}

function routeProblem(entry: RouteEntry): string | null {
  if (!isName(entry?.provider) || !isName(entry?.model)) return 'a route in the chain is not a provider and a model';
  return isNotPortedName(entry.provider) || isNotPortedName(entry.model) ? 'a route in the chain names an xAI or Grok provider or model, which is not ported' : null;
}

function requestProblem(request: ModelCallRequest): string | null {
  if (!isTenantId(request.tenant)) return 'the tenant is not a tenant id';
  if (!isProjectId(request.project)) return 'the project is not a project id';
  if (!isName(request.requestId) || !isName(request.phaseId)) return 'the request or phase id is not a name';
  if (typeof request.prompt !== 'string') return 'the prompt is not text';
  if (!isModelIdempotencyKey(request.idempotencyKey)) return 'the idempotency key is not sha256:<64 hex>';
  if (request.idempotencyKey !== bindingKeyOf(request)) return 'the idempotency key is not the one this tenant, project, request and prompt give';
  if (!isCount(request.estimatedInputTokens, 0) || !isCount(request.maxOutputTokens, 1)) return 'the token counts are not whole numbers';
  const chain = request.chain;
  if (!Array.isArray(chain) || chain.length === 0 || chain.length > MAX_CHAIN) return `the chain is not one to ${MAX_CHAIN} routes`;
  return chain.map(routeProblem).find((problem) => problem !== null) ?? null;
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

const FALLBACK_REASONS: readonly FailoverReason[] = ['rate_limit', 'billing', 'upstream_rate_limit', 'upstream_unavailable', 'provider_error'];
const RETRY_REASONS: readonly FailoverReason[] = ['rate_limit', 'upstream_rate_limit', 'upstream_unavailable', 'may_have_acted'];
/** A failure after which the provider is known not to have acted, so the reservation is released. */
const KNOWN_FREE_REASONS: readonly FailoverReason[] = ['rate_limit', 'upstream_rate_limit', 'billing', 'upstream_unavailable', 'authentication', 'invalid_request'];

/** Mutable state of one call: what is reserved, how many attempts it has used. */
interface CallRun {
  readonly request: ModelCallRequest;
  readonly deps: ModelBrokerDeps;
  readonly scope: AttemptScope;
  readonly cap: number;
  readonly inputTokens: number;
  readonly startedAtMs: number;
  readonly fingerprint: string;
  reserved: number;
  attempts: number;
}

interface RouteRun {
  attempts: number;
  spent: number;
  reason: FailoverReason | null;
  /** Sticky: once any attempt on this route may have acted, the run can never fall back to another provider. */
  mayHaveActed: boolean;
}

const reasonOf = (err: unknown): FailoverReason => (err instanceof ModelCallError ? err.reason : 'unknown');

/** Only the same route, only with the key in the request, and not when the provider asked for longer than the cap. */
function isRetryable(err: unknown, sent: ModelTransportRequest, longestWaitMs: number): boolean {
  if (!(err instanceof ModelCallError) || !RETRY_REASONS.includes(err.reason)) return false;
  if (!isModelIdempotencyKey(sent.idempotencyKey)) return false;
  return !(typeof err.retryAfterMs === 'number' && err.retryAfterMs > longestWaitMs);
}

const isoNow = (run: CallRun): string => {
  const now = run.deps.clock();
  return new Date(clockIsUsable(now) ? now : run.startedAtMs).toISOString();
};

/** Whether the ledger took the record. A ledger that throws does not lose the answer, and the outcome says so. */
async function recorded(deps: ModelBrokerDeps, entry: LedgerEntry): Promise<boolean> {
  try {
    await deps.record(entry);
    return true;
  } catch {
    return false;
  }
}

async function noteAttempt(run: CallRun, detail: AttemptRecord): Promise<void> {
  try {
    await run.deps.recordAttempt(detail);
  } catch {
    // the audit record is best effort: the failure it describes is already on the call's way out
  }
}

/** The ledger entry for spend that may have happened and cannot be priced: the reserved worst case, unresolved. */
function unresolvedEntry(run: CallRun, route: ChosenRoute, worst: number): LedgerEntry {
  const { request } = run;
  return {
    requestId: request.requestId,
    projectId: request.project,
    phaseId: request.phaseId,
    model: route.rate.model,
    usage: { inputTokens: run.inputTokens, outputTokens: request.maxOutputTokens },
    costMicroUsd: worst,
    at: isoNow(run),
    unresolved: true,
  };
}

/** What a failed attempt costs the call: nothing when it is known free, otherwise its reservation stays. */
async function failedAttempt(run: CallRun, route: ChosenRoute, worst: number, routeRun: RouteRun, err: unknown): Promise<void> {
  const reason = reasonOf(err);
  const spent = KNOWN_FREE_REASONS.includes(reason) ? 0 : worst;
  if (spent === 0) run.reserved -= worst;
  else await recorded(run.deps, unresolvedEntry(run, route, worst));
  routeRun.spent += spent;
  routeRun.reason = reason;
  if (reason === 'may_have_acted') routeRun.mayHaveActed = true;
  await noteAttempt(run, { tenant: run.scope.tenant, project: run.scope.project, requestId: run.request.requestId, provider: route.provider, model: route.model, attempt: run.attempts, reason, possiblySpentMicroUsd: spent });
}

/** One dispatch. An answer that is itself an error or an abort is a failure, never an ok answer. */
async function dispatch(run: CallRun, route: ChosenRoute, worst: number, routeRun: RouteRun, sent: ModelTransportRequest & RouteEntry): Promise<ModelTransportResult> {
  let result: ModelTransportResult;
  try {
    result = await run.deps.transport(sent);
  } catch (err) {
    await failedAttempt(run, route, worst, routeRun, err);
    throw err;
  }
  if (result?.stopReason === 'error' || result?.stopReason === 'aborted') {
    const failure = new ModelCallError('provider_error', `the provider ended the answer with ${result.stopReason}`);
    await failedAttempt(run, route, worst, routeRun, failure);
    throw failure;
  }
  return result;
}

/** Retries on one route, each reserving its worst case first. Throws what the last attempt threw. */
function attemptRoute(run: CallRun, route: ChosenRoute, worst: number, routeRun: RouteRun): Promise<ModelTransportResult> {
  const { request, deps } = run;
  const sent: ModelTransportRequest & RouteEntry = {
    idempotencyKey: request.idempotencyKey,
    provider: route.provider,
    model: route.model,
    api: route.record.api,
    ...(route.record.baseUrl === undefined ? {} : { baseUrl: route.record.baseUrl }),
    prompt: request.prompt,
    maxOutputTokens: request.maxOutputTokens,
  };
  const longestWaitMs = brokerRetryConfig(deps.retry).maxDelayMs;
  return retryModelCall(
    async () => {
      if (run.reserved + worst > run.cap) throw new BudgetExhausted();
      const attempt = await deps.attempts.begin(run.scope, request.idempotencyKey, run.fingerprint);
      if (attempt > MAX_MODEL_ATTEMPTS) throw new AttemptsExhausted();
      run.reserved += worst;
      run.attempts = attempt;
      routeRun.attempts += 1;
      return dispatch(run, route, worst, routeRun, sent);
    },
    {
      ...(deps.retry === undefined ? {} : { requested: deps.retry }),
      shouldRetry: (err) => isRetryable(err, sent, longestWaitMs),
      retryAfterMs: (err) => (err instanceof ModelCallError ? err.retryAfterMs : undefined),
      sleep: deps.sleep,
      ...(deps.random === undefined ? {} : { random: deps.random }),
    },
  );
}

/** Remember what a spent call came to, so a repeat of the same request is answered from memory and not billed again. */
async function keep(run: CallRun, outcome: ModelCallOutcome): Promise<ModelCallOutcome> {
  try {
    await run.deps.attempts.remember(run.scope, run.request.idempotencyKey, run.fingerprint, outcome);
  } catch {
    // an outcome that cannot be remembered is still an outcome: a repeat will call again, inside the attempt cap
  }
  return outcome;
}

/** What an answered call costs and records. An answer whose usage cannot be read keeps its reserved worst case. */
async function settle(run: CallRun, route: ChosenRoute, result: ModelTransportResult, worst: number): Promise<ModelCallOutcome> {
  const { request, deps } = run;
  const unreadable = usageProblem(result?.usage) ?? (typeof result?.text === 'string' && isStopReason(result.stopReason) ? null : 'RESPONSE');
  if (unreadable !== null) {
    // The provider answered, so the spend may have happened: keep the worst case counted, never a free call.
    const taken = await recorded(deps, unresolvedEntry(run, route, worst));
    return keep(run, unreadable === 'RESPONSE'
      ? refuse('RESPONSE_INVALID', 'the provider answer is not text with a stop reason', { recorded: taken })
      : refuse('USAGE_UNREADABLE', unreadable, { recorded: taken }));
  }
  const actual = rateCardFor(deps.pricing, route.provider, route.model, promptTokensOf(result.usage));
  const rate: RateCard = actual.ok ? actual.rate : route.rate;
  const usage = { inputTokens: result.usage.input + result.usage.cacheWrite, cachedInputTokens: result.usage.cacheRead, outputTokens: result.usage.output };
  const entry = recordCall({ requestId: request.requestId, projectId: request.project, phaseId: request.phaseId, usage, rate, at: isoNow(run) });
  const wasRecorded = await recorded(deps, entry);
  if (result.text.length > MAX_RESULT_TEXT) return keep(run, refuse('RESPONSE_INVALID', `the answer is longer than ${MAX_RESULT_TEXT} characters`, { recorded: wasRecorded }));
  deps.cooldowns.set(run.scope, clearCooldown(deps.cooldowns.get(run.scope), route.provider));
  const done: ModelCallSuccess = {
    ok: true,
    text: result.text,
    usage: result.usage,
    stopReason: result.stopReason,
    costMicroUsd: entry.costMicroUsd,
    route: { provider: route.provider, model: route.model },
    attempts: run.attempts,
    overBudget: entry.costMicroUsd > run.cap,
    recorded: wasRecorded,
    replayed: false,
  };
  return keep(run, done);
}

const isOutcome = (value: unknown): value is ModelCallOutcome => typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean';

async function recalled(request: ModelCallRequest, deps: ModelBrokerDeps, scope: AttemptScope): Promise<StoredRequest | null> {
  try {
    return await deps.attempts.recall(scope, request.idempotencyKey);
  } catch {
    return null;
  }
}

/** A remembered outcome served again. It made no attempt and costs nothing now; what the original did is labelled as the original's. */
function replayOf(outcome: ModelCallOutcome): ModelCallOutcome {
  if (!outcome.ok) return { ok: false, refusal: { ...outcome.refusal, replayed: true } };
  return {
    ...outcome,
    replayed: true,
    attempts: 0,
    costMicroUsd: 0,
    overBudget: false,
    original: { attempts: outcome.attempts, costMicroUsd: outcome.costMicroUsd, overBudget: outcome.overBudget, recorded: outcome.recorded },
  };
}

const mismatch = (): ModelCallOutcome => refuse('IDEMPOTENCY_MISMATCH', 'this key was used with a different chain, output cap, phase or budget ceiling');

function retryAtOf(skipped: readonly RouteSkip[], state: CooldownState): number | undefined {
  const ends = skipped.filter((s) => s.reason === 'cooling-down').map((s) => cooldownEndsAt(state, s.provider)).filter((end): end is number => end !== null);
  return ends.length === 0 ? undefined : Math.min(...ends);
}

/** The cooldown a failure earns: from the provider's own reset, or from how long it asked to be left alone. */
function armFailure(run: CallRun, route: ChosenRoute, err: unknown): void {
  const reason = reasonOf(err);
  const now = run.deps.clock();
  const hinted = err instanceof ModelCallError ? (err.resetAtMs ?? (typeof err.retryAfterMs === 'number' && clockIsUsable(now) ? now + err.retryAfterMs : undefined)) : undefined;
  const armed = armCooldown(run.deps.cooldowns.get(run.scope), route.provider, reason, clockIsUsable(now) ? now : run.startedAtMs, hinted);
  run.deps.cooldowns.set(run.scope, armed.state);
}

/** Try the chain's routes in order until one answers or the call must stop. */
async function walkRoutes(run: CallRun): Promise<ModelCallOutcome> {
  const { request, deps } = run;
  const tried = new Set<string>();
  const failures: RouteFailure[] = [];
  let overBudget = false;
  let lastFailure = 'no route in the chain can be used';
  for (;;) {
    const state = deps.cooldowns.get(run.scope);
    const nowMs = deps.clock();
    if (!clockIsUsable(nowMs)) return refuse('REQUEST_INVALID', 'the clock did not give a time', { failures });
    const choice = chooseRoute({ chain: request.chain, registry: deps.registry, cooldowns: state, pricing: deps.pricing, nowMs, promptTokens: run.inputTokens, tried });
    if (!choice.ok) {
      const retryAtMs = retryAtOf(choice.skipped, state);
      const extra = { failures, skipped: choice.skipped, ...(retryAtMs === undefined ? {} : { retryAtMs }) };
      return overBudget ? refuse('OVER_BUDGET', 'no route fits inside the budget', extra) : refuse('NO_ROUTE', lastFailure, extra);
    }
    const route = choice.route;
    tried.add(routeKeyOf(route));
    const worst = estimateCostMicroUsd({ inputTokens: run.inputTokens, outputTokens: request.maxOutputTokens }, route.rate);
    if (run.reserved + worst > run.cap) {
      overBudget = true;
      continue;
    }
    const routeRun: RouteRun = { attempts: 0, spent: 0, reason: null, mayHaveActed: false };
    let answer: ModelTransportResult;
    try {
      answer = await attemptRoute(run, route, worst, routeRun);
    } catch (err) {
      const reason = routeRun.mayHaveActed ? 'may_have_acted' : (routeRun.reason ?? reasonOf(err));
      if (routeRun.attempts > 0) failures.push({ provider: route.provider, model: route.model, reason, attempts: routeRun.attempts, possiblySpentMicroUsd: routeRun.spent });
      // An unknown outcome is checked first and never masked: a later safe-looking failure or a spent budget cannot hide it.
      if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN', 'the call may have been acted on and is not repeated on another provider', { failures });
      if (err instanceof AttemptStoreFull) return refuse('STORE_FULL', 'this tenant and project hold as many request keys as the store keeps', { failures });
      if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED', `this key has used its ${MAX_MODEL_ATTEMPTS} attempts`, { failures });
      if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET', 'the next attempt does not fit inside the budget', { failures });
      if (!FALLBACK_REASONS.includes(reason)) return refuse('CALL_FAILED', `the call failed: ${reason}`, { failures });
      armFailure(run, route, err);
      lastFailure = `every usable route failed, the last with ${reason}`;
      continue;
    }
    return settle(run, route, answer, worst);
  }
}

interface Flight {
  readonly fingerprint: string;
  readonly outcome: Promise<ModelCallOutcome>;
}

/** The calls in flight, one map per attempt store, so two calls sharing a store share their place. */
const FLIGHTS = new WeakMap<object, Map<string, Flight>>();

async function runCall(request: ModelCallRequest, deps: ModelBrokerDeps, scope: AttemptScope, cap: number, fingerprint: string, startedAtMs: number): Promise<ModelCallOutcome> {
  // The grant is asked before anything is served, a replay included.
  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);
  const held = await recalled(request, deps, scope);
  if (held !== null && held.fingerprint !== fingerprint) return mismatch();
  if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);
  const inputTokens = Math.max(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));
  return walkRoutes({ request, deps, scope, cap, inputTokens, startedAtMs, fingerprint, reserved: 0, attempts: 0 });
}

/** A second call with the same key waits for the first and takes its outcome: no second transport call, no second record. */
async function joined(flight: Flight, request: ModelCallRequest, deps: ModelBrokerDeps, fingerprint: string): Promise<ModelCallOutcome> {
  if (flight.fingerprint !== fingerprint) return mismatch();
  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);
  return replayOf(await flight.outcome);
}

/** Carry out one request. Always answers: a refusal is a value with a code, and the transport is reached only after every check. */
export async function callModel(request: ModelCallRequest, deps: ModelBrokerDeps): Promise<ModelCallOutcome> {
  const cap = budgetOf(request);
  if (cap === null) return refuse('BUDGET_REQUIRED', 'a model call needs a budget: whole micro-USD, above zero');
  const problem = requestProblem(request);
  if (problem !== null) return refuse('REQUEST_INVALID', problem);
  const startedAtMs = deps.clock();
  if (!clockIsUsable(startedAtMs)) return refuse('REQUEST_INVALID', 'the clock did not give a time');
  const scope: AttemptScope = { tenant: request.tenant, project: request.project };
  const fingerprint = fingerprintOf(request);
  const flights = FLIGHTS.get(deps.attempts) ?? new Map<string, Flight>();
  FLIGHTS.set(deps.attempts, flights);
  const place = `${scope.tenant}/${scope.project}/${request.idempotencyKey}`;
  const flying = flights.get(place);
  if (flying !== undefined) return joined(flying, request, deps, fingerprint);
  const flight: Flight = { fingerprint, outcome: runCall(request, deps, scope, cap, fingerprint, startedAtMs) };
  flights.set(place, flight);
  try {
    return await flight.outcome;
  } finally {
    if (flights.get(place) === flight) flights.delete(place);
  }
}
