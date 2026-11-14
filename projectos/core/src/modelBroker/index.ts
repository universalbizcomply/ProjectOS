// Origin: original ProjectOS code
/**
 * The model broker (PROJECTOS-PORT-PROVIDERS1A): a provider registry, retries with a backoff floor, committed
 * prices that feed the existing RateCard, a fallback chain with cooldowns, custom endpoint records and a
 * loopback-only local model rule. Unwired: nothing outside this directory and its tests imports it except this
 * barrel, nothing reaches a live provider, and the transport is a port.
 */
export { MODEL_APIS, isStopReason, promptTokensOf, usageProblem } from './transportTypes.js';
export type { ModelApi, ModelTransport, ModelTransportRequest, ModelTransportResult, StopReason, TokenCounts } from './transportTypes.js';
export type { RouteEntry } from './routeTypes.js';
export { routeKeyOf } from './routeTypes.js';
export { RETRY_ATTEMPT_CEILING, RETRY_FLOOR_MS, createRetryRunner, resolveRetryConfig, resolveRetryDelayMs, toRetryError } from './retry.js';
export type { RetryConfig, RetryInfo, RetryOptions, RetryRuntime } from './retry.js';
export {
  BACKOFF_CEILING_MS,
  BACKOFF_FLOOR_MS,
  AttemptStoreFull,
  MAX_MODEL_ATTEMPTS,
  brokerRetryConfig,
  createMemoryAttemptStore,
  isModelIdempotencyKey,
  retryModelCall,
} from './retryPolicy.js';
export type { AttemptScope, AttemptStore, ModelRetryOptions, StoredRequest } from './retryPolicy.js';
export { bindingKeyOf, fingerprintOf } from './requestKey.js';
export type { FingerprintedFields, KeyedRequestFields } from './requestKey.js';
export { normalizeUpstreamModelPricing, selectPricingRates } from './pricingTiers.js';
export type { ModelPricing, PricingRates, PricingTier } from './pricingTiers.js';
export { COMMIT_SHA, parseCommittedPricing, rateCardFor } from './committedPricing.js';
export type { CommittedText, PricingEntry, PricingParse, PricingTable, RateCardResult } from './committedPricing.js';
export { PROVIDER_KINDS, endpointProblem, isLoopbackHost, localEndpointProblem } from './endpoints.js';
export type { ProviderKind } from './endpoints.js';
export { createProviderRegistry, isNotPortedName, providerKeyOf } from './providerRegistry.js';
export type { ProviderRecord, ProviderRegistry, RegistryParse } from './providerRegistry.js';
export { COOLDOWN_BASE_SECONDS, COOLDOWN_MAX_SECONDS, COOLDOWN_OUTAGE_SECONDS, FAILOVER_REASONS, NO_COOLDOWNS, armCooldown, clearCooldown, cooldownEndsAt, isCoolingDown } from './cooldown.js';
export type { ArmedCooldown, CooldownState, FailoverReason } from './cooldown.js';
export { chooseRoute } from './fallback.js';
export type { ChooseRouteParams, ChosenRoute, RouteChoice, RouteSkip, RouteSkipReason } from './fallback.js';
export { MAX_RESULT_TEXT, MODEL_CALL_CLASS, ModelCallError, callModel, createCooldownBook } from './callModel.js';
export type { AttemptRecord, CooldownBook, ModelBrokerDeps, ModelCallOutcome, ModelCallRefusal, ModelCallRefusalCode, ModelCallRequest, ModelCallSuccess, RouteFailure } from './callModel.js';
