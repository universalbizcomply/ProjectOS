"use strict";
/**
 * MODEL BROKER — PROJECTOS-PORT-PROVIDERS1A (plan v1.36, port 2 of the V4 ports, C11).
 *
 * The retry runner, the pricing tiers and the transport shape come from OpenClaw under MIT, the provider registry
 * and the cooldown from Hermes under MIT, and the rest is ours. A model call is paid, so every softening of this
 * phase reads reasonably in a diff:
 *
 *   PP-1  "one more helper file"                 — and an uncredited file lands in a port directory
 *   PP-2  "the header says OpenClaw"             — and it no longer says which upstream file
 *   PP-3  "it is obviously ours"                 — and a file carries no statement of origin
 *   PP-4  "the credit rule runs elsewhere"       — and a ported file has no notices entry
 *   PP-5  "core can read the clock"              — and the pure kernel has a timer, a file system or a network
 *   PP-6  "the agent only needs a little more"   — and it reads a file, opens a socket or spawns
 *   PP-7  "it is only a small package"           — and a dependency lands outside the locked stack
 *   PP-8  "grok is just another adapter"         — and an xAI or Grok path arrives
 *   PP-9  "the budget can default"               — and a call with no budget reaches the transport
 *   PP-10 "the caller is trusted"                — and a P3 call goes out with no spend grant
 *   PP-11 "let the caller pick the delay"        — and a retry runs below the backoff floor
 *   PP-12 "more attempts cannot hurt"            — and a key is retried past its cap
 *   PP-13 "the caller knows its history"         — and an empty history resets the count
 *   PP-14 "a retry is the same call"             — and retries spend past the budget
 *   PP-15 "the table is just JSON"               — and a price that was not committed is used
 *   PP-16 "a RateCard of our own"                — and a second price shape drifts from the ledger
 *   PP-17 "cache writes are cheap"               — and a call is under-estimated
 *   PP-18 "fall back to anything that answers"   — and a provider outside the registry is called
 *   PP-19 "the limit will pass"                  — and a limited provider is hammered, or rested for ever
 *   PP-20 "it looks like localhost"              — and a non-loopback host is probed as a local model
 *   PP-21 "rotate the keys"                      — and a credential is held, or rotated round a cap
 *   PP-22 "export it later"                      — and the next phase re-implements it
 *   PP-23 "register it later"                    — and nothing ever runs this file
 *   PP-24 "just one caller"                      — and "unwired" stops being true
 *   PP-25 "no usage, no cost"                    — and an answer with unreadable usage is free
 *   PP-26 "retry everything"                     — and a call that may have been dispatched is repeated
 *   PP-27 "custom means anywhere"                — and a custom endpoint reaches this machine or its network
 *   PP-28 "the caller knows its prompt"          — and a budget is a claim, not a bound
 *   PP-29 "any key will do"                      — and a made-up key mints a count, or one tenant's count is another's
 *   PP-30 "just retry it"                        — and a call that may have acted is repeated without its key, or elsewhere
 *   PP-31 "an answer is an answer"               — and a stop reason of error or abort is returned as ok
 *   PP-32 "a failure costs nothing"              — and failed attempts are unaccounted, or the refusal says nothing
 *   PP-33 "honour the hint"                      — and a long Retry-After is waited out, or ignored by the cooldown
 *   PP-34 "the clock was fine a moment ago"      — and a spent call is lost to a date, a huge answer, or a store that grows
 *   PP-35 "two at once is fine"                  — and two simultaneous calls with one key both reach the transport
 *   PP-36 "the last failure is the story"        — and an unknown outcome is overwritten, or masked by a safe-looking refusal
 *   PP-37 "make room, forget the oldest"         — and an exhausted key is evicted and its cap is reset
 *   PP-38 "the key is enough"                    — and the same key with other terms is served, or a replay skips the grant
 *   PP-39 "the clock is only a clock"            — and a bad time skips every cooldown
 *   PP-T  "the tests exist"                      — and `.skip` keeps the proof while dropping the run
 *
 * THE MUTATIONS ARE IN THE BODIES. A pin on a call site survives a gutted function, so pins are taken from inside
 * the function that decides. `selfTest` applies each mutation in memory and counts it killed only when its own rule
 * fires and no rule it did not declare. The real tree passing with no mutation is the positive control.
 *
 * TEXT PINS PROVE PRESENCE, NOT BEHAVIOUR. So the code also runs. `behaviour` copies this phase's own TypeScript
 * and the kernel files it imports into one scratch directory, and Node's type stripping runs it there. Each `B`
 * mutation changes that copy, and counts as killed only when exactly its own rule's probes fail.
 *
 * Comments are stripped before anything is judged, except the credit header, which lives in comments. Reads files,
 * asks git what is tracked, and runs this phase's own code in its scratch directory: no network, no write outside
 * it. The credit judgement is borrowed from val-projectos-port-credit1a, unchanged.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const scratch = require("./lib/scratch.cjs");
const credit = require("./val-projectos-port-credit1a.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-port-providers1a";
const THIS_REL = `projectos/validators/${THIS_VALIDATOR}.cjs`;
const CORE_DIR = "projectos/core/src/modelBroker";
const AGENT_DIR = "projectos/agent/src/modelBroker";
const NOTICES_REL = "THIRD_PARTY_NOTICES";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const CORE_BARREL_REL = "projectos/core/src/index.ts";
const CORE_PACKAGE_REL = "projectos/core/package.json";
const AGENT_PACKAGE_REL = "projectos/agent/package.json";
/** A pseudo-file: what the two directories really hold, one path a line. */
const LISTING = "@listing";
/** A pseudo-file: what git tracks in them. A file git ignores passes on one disk and breaks every other checkout. */
const TRACKED = "@tracked";
/** A pseudo-file: every tracked source file that imports the module or names what it exports, outside it. */
const IMPORTERS = "@importers";

const OPENCLAW = "c5b56f2505c4f6a5803125d2923e2934c5f750af";
const HERMES = "d3e586881eacb132595edcbe4c170be8381e40c5";
const core = (name) => `${CORE_DIR}/${name}`;
const agent = (name) => `${AGENT_DIR}/${name}`;
const RETRY = core("retry.ts");
const TRANSPORT = core("transportTypes.ts");
const TIERS = core("pricingTiers.ts");
const REGISTRY = core("providerRegistry.ts");
const COOLDOWN = core("cooldown.ts");
const ROUTES = core("routeTypes.ts");
const PRICING = core("committedPricing.ts");
const ENDPOINTS = core("endpoints.ts");
const POLICY = core("retryPolicy.ts");
const FALLBACK = core("fallback.ts");
const CALL = core("callModel.ts");
const KEYFILE = core("requestKey.ts");
const BARREL = core("index.ts");
const CONFIG = agent("committedConfig.ts");
const LOCAL = agent("localModels.ts");
const AGENT_BARREL = agent("index.ts");

/** Every ported file, the source it came from, and exactly the upstream files it took. */
const PORTED = {
  [RETRY]: { source: "openclaw", sha: OPENCLAW, paths: ["packages/retry/src/index.ts"] },
  [TRANSPORT]: { source: "openclaw", sha: OPENCLAW, paths: ["packages/llm-core/src/model-data.ts", "packages/llm-core/src/types.ts"] },
  [TIERS]: { source: "openclaw", sha: OPENCLAW, paths: ["packages/llm-core/src/usage-cost.ts", "packages/model-catalog-core/src/model-catalog-pricing.ts"] },
  [REGISTRY]: { source: "hermes-agent", sha: HERMES, paths: ["agent/provider_registry.py", "agent/provider_base.py"] },
  [COOLDOWN]: { source: "hermes-agent", sha: HERMES, paths: ["agent/fallback_cooldown.py"] },
};
const ORIGINAL = [ROUTES, PRICING, ENDPOINTS, POLICY, FALLBACK, CALL, KEYFILE, BARREL, CONFIG, LOCAL, AGENT_BARREL];
const FILES = [...Object.keys(PORTED), ...ORIGINAL];
const ORIGIN_LINE = "// Origin: original ProjectOS code";
const piLineOf = (notices) => `// Also-Credits: pi-mono (${credit.parseNotices(notices).find((r) => r.kind === "NOTE" && r.id === "pi-mono")?.fields["Copyright"]}, MIT)`;

/** What the copy needs from the rest of core: the kernel files the module imports, found by following its imports. */
const KERNEL_ROOTS = ["projectos/core/src/gatekeeperCostLedger.ts", "projectos/core/src/connectorContract.ts", "projectos/core/src/tenant.ts"];

const CORE_IMPORTS = /^(?:\.\/[A-Za-z0-9]+\.js|\.\.\/gatekeeperCostLedger\.js|\.\.\/connectorContract\.js|\.\.\/tenant\.js|\.\.\/execution\/evidence\.js)$/;
const AGENT_IMPORTS = /^(?:@projectos\/core|\.\/[A-Za-z0-9]+\.js)$/;
const CORE_FORBIDDEN = /\bprocess\.|\bDate\.now\(|new Date\(\)|\bMath\.random\(|\bfetch\(|\brequire\(|\bimport\(|\bsetTimeout|\bsetInterval|\bsetImmediate|\bchild_process|\bnode:|\bXMLHttpRequest|\bWebSocket|\bnew URL\(/;
const AGENT_FORBIDDEN = /\bnode:|child_process|\bfetch\(|\beval\(|new Function\b|\bprocess\.|\bXMLHttpRequest|\bWebSocket|\brequire\(|\bimport\(|\bsetTimeout|\bsetInterval/;
const NOT_PORTED_FORBIDDEN = /xai|x-ai|x\.ai|grok/i;
const CREDENTIAL_FORBIDDEN = /credential_pool|credentialPool|rotat|process\.env|api_?key|bearer/i;
const OWN_RATECARD = /^\s*(?:export\s+)?(?:interface\s+RateCard\b|type\s+RateCard\s*[=<])/m;
const NOT_RUN = /\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|fails|skipIf|runIf)\b|\.(?:skip|only)\(|\b(?:xit|fit|xdescribe|fdescribe)\(/;
/** What the module exports that a caller would name. A later phase wires it; nothing may before then. */
const EXPORTED_NAMES = /\b(?:bindingKeyOf|callModel|createProviderRegistry|loadCommittedBrokerConfig|detectLocalModels|parseCommittedPricing|retryModelCall|chooseRoute|createCooldownBook|createMemoryAttemptStore|isLoopbackHost|localEndpointProblem)\b/;
const IMPORT_OF_MODULE = /(?:\bfrom\s+|\bimport\(\s*|\brequire\(\s*|\bimport\s+)['"][^'"]*modelBroker[^'"]*['"]/;
/** The only tracked file outside the module allowed to say its name: the core barrel's one export line. */
const ALLOWED_IMPORTERS = [CORE_BARREL_REL];

/** The dependency lists of both packages, whole. A new one is a deliberate change here, in TRD and by the owner. */
const DEPENDENCIES = {
  [CORE_PACKAGE_REL]: { dependencies: [], devDependencies: ["@types/node", "@vitest/coverage-v8", "typescript", "vitest"] },
  [AGENT_PACKAGE_REL]: { dependencies: ["@projectos/core"], devDependencies: ["@types/node", "@vitest/coverage-v8", "typescript", "vitest"] },
};

const TESTS = {
  "projectos/core/test/modelBroker-retry.test.ts": [
    "a caller asking for no delay still waits the floor: the positive control is a longer wait staying longer",
    "full jitter with a zero draw does not go under the floor",
    "a provider that says retry in 0 ms is held to the floor, and one that says 20 s is honoured",
    "a NaN or negative request falls back to the floor rather than to no wait",
    "a caller asking for 99 attempts gets the cap",
    "a decision not to retry stops at once",
    "counts per key, and a second key starts from one",
    "refuses a key that is not a key, so an odd spelling cannot open a fresh count",
    "is bounded per tenant and project by refusing new keys, never by forgetting one: an exhausted key keeps its count",
    "remembers a completed outcome with its fingerprint per scope and key, and answers nothing for another",
    "moves with the chain, the output cap, the phase and the budget ceiling, and not otherwise",
    "the exported runner, given no minimum, a zero maximum and 99 attempts, still waits the floor and stops at the ceiling",
    "a random source that answers NaN never skips the sleep: the wait is finite and at least the floor",
    "is deterministic, shaped sha256:<64 hex>, and moves with each part",
    "counts per tenant and project: the same key under another scope is a fresh count",
  ],
  "projectos/core/test/modelBroker-pricing.test.ts": [
    "a committed price becomes a RateCard the ledger accepts: the positive control",
    "text that does not carry a 40-character commit is not committed bytes",
    "an unpriced model is refused, not priced at zero",
    "a price of zero, a missing price and a price with more than six decimals are all refused whole",
    "cache-write dearer than input is carried as the input rate, so a call is never under-estimated",
    "a free cache rate is not a free cache: it is priced as fresh input",
    "refuses a duplicate model, an unknown schema, unknown fields and a non-array",
    "a larger prompt selects the dearer whole-request tier, and the nearest lower tier covers a gap",
    "two tiers at one threshold cannot select one price, so the whole price is refused",
  ],
  "projectos/core/test/modelBroker-routing.test.ts": [
    "registers by lower-cased name and answers get, has and a sorted list: the positive control",
    "refuses a duplicate name, where upstream let the last one win",
    "a record that carries a key is refused: no credential is read or held here",
    "refuses an xAI or Grok provider, which this plan does not port",
    "refuses an xAI or Grok model in the price table, as it refuses the provider",
    "matches xAI and Grok as whole tokens: an unrelated name that contains the letters is fine",
    "fails closed when the clock gives no time: no route is chosen, so no cooldown is skipped by accident",
    "arms 60 s, then 120 s, doubling to a 4 h ceiling",
    "is skipped until the injected clock reaches the end, and not a moment longer",
    "follows a provider-declared reset when it is in the future, capped at the ceiling",
    "arms only for the rate-limit family, and a success clears the level",
    "skips a provider that is priced but not registered, and says so",
    "skips a provider in cooldown until its end, by the injected clock",
    "is not led by the chain into a provider the registry has not got, whatever its spelling",
  ],
  "projectos/core/test/modelBroker-endpoints.test.ts": [
    "accepts the loopback forms: the positive control",
    "refuses everything else, including names that only look local",
    "refuses internal-looking and wildcard-DNS names, which can resolve to this machine or its network",
    "judges the host the URL really names, not the text before an @",
    "a local provider record must name a loopback endpoint, and a hosted one may not",
    "refuses an address that points back at this machine or its network, so a custom record cannot reach them",
  ],
  "projectos/core/test/modelBroker-call.test.ts": [
    "is a P3 call",
    "refuses a call with no budget, a zero budget, or a budget that is not a whole positive number, before the transport",
    "refuses when no provider-spend grant answers true, and a throwing grant is not a grant",
    "refuses a call whose worst case is over its budget, before the transport",
    "records each answered call through the ledger with the committed RateCard price",
    "refuses an answer whose usage cannot be read, and keeps the worst case counted rather than recording a free call",
    "waits at least the floor between attempts, and stops at the cap",
    "a caller passing an empty history cannot reset the count",
    "retries that may have been billed cannot spend past the budget: the next attempt is refused when its worst case no longer fits",
    "does not retry what is not safe to repeat: an unknown failure and a refusal of the request",
    "moves to the next registered provider after a rate limit, and leaves the first resting",
    "returns to the first provider once its cooldown has ended",
    "refuses a 500 KB prompt whose caller claimed zero input tokens, one output token and a budget of 1",
    "the same request twice with a successful transport reaches the transport once and the ledger once",
    "refuses a key the caller made up, and one bound to a different prompt",
    "a cooldown belongs to a tenant and a project too",
    "passes the idempotency key in every transport request",
    "retries a call that may have acted on the same route with the same key, never falls back, and says the outcome is unknown",
    "carries \"length\" on the success so the caller can see the answer was cut",
    "treats \"error\" and \"aborted\" as failures that fall back, and neither is an ok answer",
    "a rate limit that cost nothing releases its reservation, so a cheap backup route is still tried",
    "a Retry-After above the cap skips the retries, arms the cooldown from it, and falls back",
    "an outage arms a short cooldown of its own",
    "says when to come back when every route is cooling down",
    "a clock that goes bad after the spend still returns the answer, dated from the start of the call",
    "an answer over the text cap is refused and its spend is still recorded",
    "never calls a provider that is not in the registry, even if it is named first",
    "two simultaneous calls reach the transport once and the ledger once, and both get the answer",
    "a waiting call is still held to the grant, and to the same terms",
    "clears its place when the call fails, so a later call is not held behind it",
    "stays unknown after a later attempt fails safely: may_have_acted, then a rate limit, then exhaustion never falls back",
    "reports the unknown outcome even when the attempt cap runs out next",
    "refuses the same key with a different chain, output cap, phase or budget ceiling, and serves nothing",
    "asks for the grant before serving a replay",
    "refuses a new key when the tenant and project have too many, and an exhausted key stays exhausted",
    "refuses before the transport when the clock stops giving a time, rather than skipping cooldowns",
    "a repeat of a request whose answer was too long is answered from memory: one transport call, one ledger record",
  ],
  "projectos/agent/test/modelBroker.test.ts": [
    "loads a registry and a price table through the committed reader: the positive control",
    "refuses a reader that returns something with no commit, such as a working-tree read",
    "refuses a path that leaves the repository or names another file kind, so a path cannot pick other bytes",
    "the loaded config drives the core broker end to end, with a fake transport",
    "asks a loopback OpenAI-compatible endpoint for its models: the positive control",
    "refuses any other host and never calls the port for it",
    "reports an unreachable or malformed local answer without throwing, and caps what it keeps",
  ],
};

const RULE_NAMES = {
  "PP-1": "unlisted file",
  "PP-2": "wrong upstream record",
  "PP-3": "no origin mark",
  "PP-4": "credit refused",
  "PP-5": "core is not pure",
  "PP-6": "the agent reaches out",
  "PP-7": "dependency added",
  "PP-8": "an xAI or Grok path",
  "PP-9": "a call without a budget reaches the transport",
  "PP-10": "a call without the P3 grant",
  "PP-11": "a retry below the backoff floor",
  "PP-12": "a retry past the attempt cap",
  "PP-13": "the caller holds the attempt count",
  "PP-14": "retries are not charged to the budget",
  "PP-15": "a price is not from committed bytes",
  "PP-16": "the RateCard is not the ledger's",
  "PP-17": "a call is under-estimated",
  "PP-18": "a fallback leaves the registry",
  "PP-19": "the cooldown is not held",
  "PP-20": "the loopback rule is open",
  "PP-21": "a credential is held or rotated",
  "PP-22": "not exported",
  "PP-23": "not registered",
  "PP-24": "an importer outside the module",
  "PP-25": "unreadable usage is free",
  "PP-26": "an unsafe repeat or fallback",
  "PP-27": "a custom endpoint reaches this machine",
  "PP-28": "the budget is a claim, not a bound",
  "PP-29": "the key is not bound or not scoped",
  "PP-30": "a call that may have acted is repeated",
  "PP-31": "a stop reason is dropped",
  "PP-32": "a failed attempt is unaccounted",
  "PP-33": "a retry hint is not honoured",
  "PP-34": "a spent call is lost",
  "PP-35": "concurrent calls are not single-flight",
  "PP-36": "an unknown outcome is lost",
  "PP-37": "the attempt store forgets",
  "PP-38": "the same key is served with other terms",
  "PP-39": "a bad clock is not refused",
  "PP-T": "the proof does not run",
};

/** A pin: this text, in this file, inside this function when one is named. */
const P = (rel, fn, pin) => ({ rel, fn, pin });
const PIN_RULES = [
  { rule: "PP-8", says: "the xAI refusal is gone", pins: [
    P(REGISTRY, null, "const NOT_PORTED = /(?:^|[^a-z0-9])(?:xai|x-ai|x\\.ai)(?![a-z0-9])|(?:^|[^a-z0-9])grok/i;"),
    P(REGISTRY, "recordProblems", "NOT_PORTED.test(value)"),
    P(REGISTRY, "recordProblems", "names an xAI or Grok provider, which is not ported"),
    P(REGISTRY, null, "export const isNotPortedName = (value: unknown): boolean => typeof value === 'string' && NOT_PORTED.test(value);"),
    P(PRICING, "entryProblems", "if (isNotPortedName(model) || isNotPortedName(provider))"),
    P(CALL, "routeProblem", "isNotPortedName(entry.provider) || isNotPortedName(entry.model)"),
  ] },
  { rule: "PP-9", says: "a budget is no longer required", pins: [
    P(CALL, null, "const isCount = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;"),
    P(CALL, "budgetOf", "return isCount(maxMicroUsd, 1) ? maxMicroUsd : null;"),
    P(CALL, "callModel", "if (cap === null) return refuse('BUDGET_REQUIRED'"),
    P(CALL, "callModel", "const cap = budgetOf(request);"),
  ] },
  { rule: "PP-10", says: "the P3 grant is no longer asked", pins: [
    P(CALL, null, "export const MODEL_CALL_CLASS = 'P3' as const;"),
    P(CALL, "granted", "return (await deps.grant(request)) === true;"),
    P(CALL, "granted", "  } catch {\n    return false;"),
    P(CALL, "runCall", "if (!(await granted(request, deps))) return refuse('NO_GRANT'"),
    P(CALL, null, "readonly grant: (request: ModelCallRequest) => boolean | Promise<boolean>;"),
  ] },
  { rule: "PP-11", says: "the backoff floor is gone", pins: [
    P(POLICY, null, "export const BACKOFF_FLOOR_MS = RETRY_FLOOR_MS;"),
    P(RETRY, null, "export const RETRY_FLOOR_MS = 1_000;"),
    P(RETRY, "createRetryRunner", "const minDelayMs = Math.max(resolved.minDelayMs, RETRY_FLOOR_MS);"),
    P(RETRY, "createRetryRunner", "if (!Number.isFinite(delay)) delay = minDelayMs;"),
    P(POLICY, null, "minDelayMs: BACKOFF_FLOOR_MS, maxDelayMs: 30_000"),
    P(POLICY, "brokerRetryConfig", "const minDelayMs = Math.min(Math.max(merged.minDelayMs, BACKOFF_FLOOR_MS), BACKOFF_CEILING_MS);"),
    P(POLICY, "brokerRetryConfig", "maxDelayMs: Math.min(Math.max(merged.maxDelayMs, minDelayMs), BACKOFF_CEILING_MS),"),
    P(POLICY, "retryModelCall", "...brokerRetryConfig(options.requested),"),
    P(RETRY, "createRetryRunner", "delay = Math.min(Math.max(delay, minDelayMs), delayCap);"),
    P(RETRY, "createRetryRunner", "? Math.max(retryAfterMs, minDelayMs)"),
    P(RETRY, "createRetryRunner", ": Math.max(resolvedConfiguredDelay, minDelayMs);"),
  ] },
  { rule: "PP-12", says: "the attempt cap is gone", pins: [
    P(POLICY, null, "export const MAX_MODEL_ATTEMPTS = CONNECTOR_MAX_ATTEMPTS;"),
    P(POLICY, "brokerRetryConfig", "attempts: Math.min(merged.attempts, MAX_MODEL_ATTEMPTS, RETRY_ATTEMPT_CEILING),"),
    P(RETRY, null, "export const RETRY_ATTEMPT_CEILING = 5;"),
    P(RETRY, "createRetryRunner", "const maxAttempts = Math.min(resolved.attempts, RETRY_ATTEMPT_CEILING);"),
    P(CALL, "attemptRoute", "if (attempt > MAX_MODEL_ATTEMPTS) throw new AttemptsExhausted();"),
    P(CALL, "walkRoutes", "if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED'"),
    P(RETRY, "createRetryRunner", "if (attempt >= maxAttempts || runtime.shouldRetry?.(err) === false || !shouldRetry(err, attempt)) {"),
  ] },
  { rule: "PP-13", says: "the attempt count is no longer the store's", pins: [
    P(CALL, "attemptRoute", "const attempt = await deps.attempts.begin(run.scope, request.idempotencyKey, run.fingerprint);"),
    P(CALL, null, "readonly attempts: AttemptStore;"),
    P(POLICY, "createMemoryAttemptStore", "entries.set(at, { fingerprint: held?.fingerprint ?? fingerprint, count: (held?.count ?? 0) + 1, outcome: held?.outcome ?? null });"),
    P(POLICY, "createMemoryAttemptStore", "if (!isModelIdempotencyKey(key)) throw new Error('that is not an idempotency key');"),
    P(CALL, "requestProblem", "if (!isModelIdempotencyKey(request.idempotencyKey)) return"),
  ] },
  { rule: "PP-14", says: "retries are no longer charged to the budget", pins: [
    P(CALL, "attemptRoute", "if (run.reserved + worst > run.cap) throw new BudgetExhausted();"),
    P(CALL, "attemptRoute", "run.reserved += worst;"),
    P(CALL, "walkRoutes", "if (run.reserved + worst > run.cap) {"),
    P(CALL, "walkRoutes", "if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET'"),
  ] },
  { rule: "PP-15", says: "a price is no longer read from committed bytes only", pins: [
    P(PRICING, null, "export const COMMIT_SHA = /^[0-9a-f]{40}$/;"),
    P(PRICING, "parseCommittedPricing", "!COMMIT_SHA.test(committed.commit)"),
    P(PRICING, "parseCommittedPricing", "if (problems.length > 0) return { ok: false, problems };"),
    P(PRICING, "parseCommittedPricing", "if (entries.has(key)) problems.push("),
    P(PRICING, "parseCommittedPricing", "parsed['schema'] !== PRICING_SCHEMA"),
    P(PRICING, "rateCardFor", "if (entry === undefined) return { ok: false, reason: 'unpriced'"),
    P(PRICING, "microOf", "return Math.abs(scaled - whole) > 1e-3 || !Number.isSafeInteger(whole) ? null : whole;"),
    P(PRICING, "entryProblems", "if (!(rates.input > 0) || !(rates.output > 0))"),
    P(PRICING, "entryProblems", "!ENTRY_KEYS.has(key)"),
    P(CONFIG, "committedText", "typeof found.commit === 'string' && COMMIT_SHA.test(found.commit)"),
    P(CONFIG, null, "const pathProblem = (path: string): string | null =>"),
    P(CONFIG, null, "!path.split('/').some((segment) => segment === '.' || segment === '..')"),
    P(CONFIG, null, "CONFIG_PATH = /^[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+)*\\.json$/;"),
    P(CONFIG, "loadCommittedBrokerConfig", "if (typeof pricingText === 'string' || typeof registryText === 'string') return { ok: false, problems };"),
    P(CALL, "walkRoutes", "pricing: deps.pricing"),
  ] },
  { rule: "PP-16", says: "the price no longer feeds the ledger's RateCard", pins: [
    P(PRICING, null, "import { rateCardProblems, type RateCard } from '../gatekeeperCostLedger.js';"),
    P(PRICING, "rateCardFor", "const problems = rateCardProblems(rate);"),
    P(PRICING, "rateCardFor", "const rate: RateCard = {"),
    P(CALL, null, "import { estimateCostMicroUsd, estimateInputTokensFromText, recordCall, type LedgerEntry, type RateCard } from '../gatekeeperCostLedger.js';"),
    P(CALL, "settle", "const entry = recordCall({ requestId: request.requestId, projectId: request.project, phaseId: request.phaseId, usage, rate, at: isoNow(run) });"),
    P(CALL, "walkRoutes", "const worst = estimateCostMicroUsd({ inputTokens: run.inputTokens, outputTokens: request.maxOutputTokens }, route.rate);"),
  ] },
  { rule: "PP-17", says: "cache writes are no longer priced at the dearer rate", pins: [
    P(PRICING, "rateCardFor", "const input = microOf(Math.max(rates.input, rates.cacheWrite));"),
    P(PRICING, "rateCardFor", "...(cached > 0 ? { cachedInputMicroUsdPerMillion: cached } : {})"),
    P(CALL, "settle", "inputTokens: result.usage.input + result.usage.cacheWrite"),
    P(CALL, "settle", "const actual = rateCardFor(deps.pricing, route.provider, route.model, promptTokensOf(result.usage));"),
    P(TIERS, "selectPricingRates", "return matched ?? [...sorted].reverse().find((tier) => promptTokens >= tier.range[0]) ?? sorted[0] ?? cost;"),
    P(TIERS, "withContextPrices", "if (next === tier.size) {"),
  ] },
  { rule: "PP-18", says: "a fallback can leave the registry", pins: [
    P(FALLBACK, "skipOf", "if (record === undefined || record.name !== entry.provider) return { reason: 'not-registered' };"),
    P(FALLBACK, "skipOf", "if (params.tried.has(routeKeyOf(entry))) return { reason: 'already-tried' };"),
    P(FALLBACK, "skipOf", "if (!priced.ok) return { reason: 'unpriced' };"),
    P(REGISTRY, null, "const PROVIDER_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;"),
    P(REGISTRY, "createProviderRegistry", "const registry: ProviderRegistry = Object.freeze({"),
    P(REGISTRY, "createProviderRegistry", "if (byKey.has(key)) problems.push("),
    P(REGISTRY, "createProviderRegistry", "if (problems.length > 0) return { ok: false, problems };"),
    P(CALL, "walkRoutes", "chain: request.chain, registry: deps.registry"),
  ] },
  { rule: "PP-19", says: "the cooldown is not held to its clock", pins: [
    P(COOLDOWN, null, "export const COOLDOWN_BASE_SECONDS = 60;"),
    P(COOLDOWN, null, "export const COOLDOWN_MAX_SECONDS = 14_400;"),
    P(COOLDOWN, "isCoolingDown", "return until !== undefined && until > nowMs;"),
    P(COOLDOWN, "armCooldown", "if (!RATE_LIMIT_FAILOVER_REASONS.includes(reason)) return { state, cooldownSeconds: null };"),
    P(COOLDOWN, "armCooldown", "declared === null ? Math.min(COOLDOWN_BASE_SECONDS * 2 ** level, COOLDOWN_MAX_SECONDS) : Math.min(Math.max(Math.ceil(declared), COOLDOWN_BASE_SECONDS), COOLDOWN_MAX_SECONDS);"),
    P(COOLDOWN, "armCooldown", "if (reason === 'upstream_unavailable') {"),
    P(COOLDOWN, null, "export const COOLDOWN_OUTAGE_SECONDS = 30;"),
    P(COOLDOWN, "armCooldown", "const until = new Map(state.until).set(provider, nowMs + cooldownSeconds * 1000);"),
    P(COOLDOWN, "providerResetDelay", "return Number.isFinite(delay) && delay > 0 ? delay : null;"),
    P(FALLBACK, "skipOf", "if (isCoolingDown(params.cooldowns, record.name, params.nowMs)) return { reason: 'cooling-down' };"),
    P(CALL, "armFailure", "run.deps.cooldowns.set(run.scope, armed.state);"),
    P(CALL, "settle", "deps.cooldowns.set(run.scope, clearCooldown(deps.cooldowns.get(run.scope), route.provider));"),
  ] },
  { rule: "PP-20", says: "the loopback rule is no longer exact", pins: [
    P(ENDPOINTS, "isLoopbackHost", "if (host === '[::1]' || host === '::1') return true;"),
    P(ENDPOINTS, "isLoopbackHost", "return octets !== null && octets[0] === 127;"),
    P(ENDPOINTS, "ipv4Octets", "(part.length > 1 && part.startsWith('0') ? Number.NaN : Number(part))"),
    P(ENDPOINTS, "ipv4Octets", "octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)"),
    P(ENDPOINTS, "parseEndpoint", "if (authority.includes('@')) return { ok: false, problem: 'the address carries credentials' };"),
    P(ENDPOINTS, "parseEndpoint", "if (!PATH.test(rest)) return { ok: false, problem: 'the address carries a query or a fragment' };"),
    P(ENDPOINTS, "parseEndpoint", "if (port !== null && !(port >= 1 && port <= 65535))"),
    P(ENDPOINTS, "localEndpointProblem", "return isLoopbackHost(parsed.value.host) ? null : 'the host is not a loopback address';"),
    P(ENDPOINTS, "endpointProblem", "return localEndpointProblem(record.baseUrl);"),
    P(REGISTRY, "recordProblems", "const endpoint = endpointProblem({ kind: kind as ProviderKind, baseUrl });"),
    P(LOCAL, "detectOne", "const problem = localEndpointProblem(endpoint.baseUrl);"),
    P(LOCAL, "detectOne", "if (problem !== null) return { baseUrl: endpoint.baseUrl, status: 'refused', reason: problem };"),
  ] },
  { rule: "PP-21", says: "a provider record can hold a credential", pins: [
    P(REGISTRY, null, "const RECORD_KEYS = new Set(['name', 'kind', 'api', 'baseUrl', 'credentialRef']);"),
    P(REGISTRY, "recordProblems", ".filter((key) => !RECORD_KEYS.has(key))"),
    P(REGISTRY, "recordProblems", "LONG_ALNUM_RUN.test(credentialRef)"),
    P(REGISTRY, "recordProblems", "KEY_PREFIX.test(credentialRef)"),
    P(REGISTRY, null, "const CREDENTIAL_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;"),
  ] },
  { rule: "PP-28", says: "the budget is no longer a bound", pins: [
    P(CALL, null, "import { estimateCostMicroUsd, estimateInputTokensFromText, recordCall, type LedgerEntry, type RateCard } from '../gatekeeperCostLedger.js';"),
    P(CALL, "runCall", "const inputTokens = Math.max(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));"),
    P(CALL, "walkRoutes", "promptTokens: run.inputTokens, tried"),
  ] },
  { rule: "PP-29", says: "the key is no longer the request's, or no longer scoped", pins: [
    P(KEYFILE, "bindingKeyOf", "return `sha256:${sha256Hex(`${part(fields.tenant)}${part(fields.project)}${part(fields.requestId)}${part(sha256Hex(fields.prompt))}`)}`;"),
    P(KEYFILE, null, "const part = (value: string): string => `${value.length}:${value}`;"),
    P(CALL, "requestProblem", "if (request.idempotencyKey !== bindingKeyOf(request)) return"),
    P(CALL, "requestProblem", "if (!isTenantId(request.tenant)) return"),
    P(CALL, "runCall", "const held = await recalled(request, deps, scope);"),
    P(CALL, "runCall", "if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);"),
    P(CALL, "keep", "await run.deps.attempts.remember(run.scope, run.request.idempotencyKey, run.fingerprint, outcome);"),
    P(CALL, "createCooldownBook", "const at = (scope: AttemptScope): string => `${scope.tenant}/${scope.project}`;"),
    P(POLICY, "createMemoryAttemptStore", "return `${scopeOf(scope)}/${key}`;"),
    P(POLICY, "createMemoryAttemptStore", "const scopeOf = (scope: AttemptScope): string => `${scope.tenant}/${scope.project}`;"),
    P(CALL, "callModel", "const scope: AttemptScope = { tenant: request.tenant, project: request.project };"),
  ] },
  { rule: "PP-30", says: "the key no longer travels, or a call that may have acted is repeated elsewhere", pins: [
    P(CALL, "attemptRoute", "idempotencyKey: request.idempotencyKey,"),
    P(CALL, "isRetryable", "if (!isModelIdempotencyKey(sent.idempotencyKey)) return false;"),
    
    P(TRANSPORT, null, "readonly idempotencyKey: string;"),
  ] },
  { rule: "PP-31", says: "a stop reason is no longer part of the answer", pins: [
    P(CALL, "dispatch", "if (result?.stopReason === 'error' || result?.stopReason === 'aborted') {"),
    P(CALL, "dispatch", "const failure = new ModelCallError('provider_error'"),
    P(CALL, "settle", "stopReason: result.stopReason,"),
    P(CALL, null, "readonly stopReason: StopReason;"),
  ] },
  { rule: "PP-32", says: "a failed attempt is no longer accounted for", pins: [
    P(CALL, "failedAttempt", "const spent = KNOWN_FREE_REASONS.includes(reason) ? 0 : worst;"),
    P(CALL, "failedAttempt", "if (spent === 0) run.reserved -= worst;"),
    P(CALL, "failedAttempt", "else await recorded(run.deps, unresolvedEntry(run, route, worst));"),
    P(CALL, "failedAttempt", "await noteAttempt(run, {"),
    P(CALL, "walkRoutes", "if (routeRun.attempts > 0) failures.push({"),
    P(CALL, "walkRoutes", "...(retryAtMs === undefined ? {} : { retryAtMs })"),
    P(CALL, "settle", "const taken = await recorded(deps, unresolvedEntry(run, route, worst));"),
    P(CALL, "settle", "{ recorded: taken }"),
    P(CALL, null, "const KNOWN_FREE_REASONS: readonly FailoverReason[] = ['rate_limit', 'upstream_rate_limit', 'billing', 'upstream_unavailable', 'authentication', 'invalid_request'];"),
  ] },
  { rule: "PP-33", says: "a provider's request to be left alone is no longer honoured", pins: [
    P(CALL, "isRetryable", "return !(typeof err.retryAfterMs === 'number' && err.retryAfterMs > longestWaitMs);"),
    P(CALL, "armFailure", "err.resetAtMs ?? (typeof err.retryAfterMs === 'number' && clockIsUsable(now) ? now + err.retryAfterMs : undefined)"),
    P(CALL, "attemptRoute", "const longestWaitMs = brokerRetryConfig(deps.retry).maxDelayMs;"),
  ] },
  { rule: "PP-34", says: "a spent call can be lost", pins: [
    P(CALL, "isoNow", "return new Date(clockIsUsable(now) ? now : run.startedAtMs).toISOString();"),
    P(CALL, "settle", "if (result.text.length > MAX_RESULT_TEXT) return keep(run, refuse('RESPONSE_INVALID'"),
    P(POLICY, null, "export const DEFAULT_ATTEMPT_STORE_KEYS = 4096;"),
  ] },
  { rule: "PP-35", says: "concurrent calls with one key no longer share one call", pins: [
    P(CALL, null, "const FLIGHTS = new WeakMap<object, Map<string, Flight>>();"),
    P(CALL, "callModel", "const flights = FLIGHTS.get(deps.attempts) ?? new Map<string, Flight>();"),
    P(CALL, "callModel", "if (flying !== undefined) return joined(flying, request, deps, fingerprint);"),
    P(CALL, "callModel", "flights.set(place, flight);"),
    P(CALL, "callModel", "if (flights.get(place) === flight) flights.delete(place);"),
    P(CALL, "joined", "return replayOf(await flight.outcome);"),
    P(CALL, "joined", "if (!(await granted(request, deps))) return refuse('NO_GRANT'"),
  ] },
  { rule: "PP-36", says: "an unknown outcome is no longer sticky and first", pins: [
    P(CALL, "failedAttempt", "if (reason === 'may_have_acted') routeRun.mayHaveActed = true;"),
    P(CALL, "walkRoutes", "const reason = routeRun.mayHaveActed ? 'may_have_acted' : (routeRun.reason ?? reasonOf(err));"),
    P(CALL, "walkRoutes", "if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN'"),
  ] },
  { rule: "PP-37", says: "the attempt store forgets a key, or is not bounded per scope", pins: [
    P(POLICY, null, "export class AttemptStoreFull extends Error {}"),
    P(POLICY, null, "export const DEFAULT_ATTEMPT_STORE_KEYS = 4096;"),
    P(POLICY, "createMemoryAttemptStore", "const held = perScope.get(scopeOf(scope)) ?? 0;"),
    P(POLICY, "createMemoryAttemptStore", "if (held >= maxKeys) throw new AttemptStoreFull("),
    P(POLICY, "createMemoryAttemptStore", "perScope.set(scopeOf(scope), held + 1);"),
    P(CALL, "walkRoutes", "if (err instanceof AttemptStoreFull) return refuse('STORE_FULL'"),
  ] },
  { rule: "PP-38", says: "a key is served with other terms, or a replay skips the grant or hides its original", pins: [
    P(KEYFILE, "fingerprintOf", "return sha256Hex(`${part(routes)}${part(String(fields.maxOutputTokens))}${part(fields.phaseId)}${part(String(fields.budget.maxMicroUsd))}`);"),
    P(KEYFILE, "fingerprintOf", "const routes = fields.chain.map((entry) => `${part(entry.provider)}${part(entry.model)}`).join('|');"),
    P(CALL, "callModel", "const fingerprint = fingerprintOf(request);"),
    P(CALL, "runCall", "if (held !== null && held.fingerprint !== fingerprint) return mismatch();"),
    P(CALL, "joined", "if (flight.fingerprint !== fingerprint) return mismatch();"),
    P(CALL, "replayOf", "costMicroUsd: 0,"),
    P(CALL, "replayOf", "original: { attempts: outcome.attempts, costMicroUsd: outcome.costMicroUsd, overBudget: outcome.overBudget, recorded: outcome.recorded },"),
    P(CALL, "replayOf", "if (!outcome.ok) return { ok: false, refusal: { ...outcome.refusal, replayed: true } };"),
    P(CALL, "settle", "{ recorded: wasRecorded }));"),
  ] },
  { rule: "PP-39", says: "a bad clock no longer refuses the call", pins: [
    P(CALL, "walkRoutes", "if (!clockIsUsable(nowMs)) return refuse('REQUEST_INVALID', 'the clock did not give a time', { failures });"),
    P(FALLBACK, "chooseRoute", "if (typeof params.nowMs !== 'number' || !Number.isFinite(params.nowMs)) {"),
  ] },
  { rule: "PP-22", says: "the broker is not exported", pins: [
    P(CORE_BARREL_REL, null, "export * from './modelBroker/index.js';"),
    P(BARREL, null, "export { MAX_RESULT_TEXT, MODEL_CALL_CLASS, ModelCallError, callModel, createCooldownBook } from './callModel.js';"),
    P(BARREL, null, "export { createProviderRegistry, isNotPortedName, providerKeyOf } from './providerRegistry.js';"),
    P(BARREL, null, "export { COMMIT_SHA, parseCommittedPricing, rateCardFor } from './committedPricing.js';"),
    P(BARREL, null, "export { PROVIDER_KINDS, endpointProblem, isLoopbackHost, localEndpointProblem } from './endpoints.js';"),
    P(BARREL, null, "export { chooseRoute } from './fallback.js';"),
    P(BARREL, null, "export { COOLDOWN_BASE_SECONDS, COOLDOWN_MAX_SECONDS, COOLDOWN_OUTAGE_SECONDS, FAILOVER_REASONS, NO_COOLDOWNS, armCooldown, clearCooldown, cooldownEndsAt, isCoolingDown } from './cooldown.js';"),
    P(BARREL, null, "export { bindingKeyOf, fingerprintOf } from './requestKey.js';"),
    P(BARREL, null, "export { RETRY_ATTEMPT_CEILING, RETRY_FLOOR_MS, createRetryRunner,"),
    P(BARREL, null, "  BACKOFF_FLOOR_MS,\n"),
    P(BARREL, null, "  MAX_MODEL_ATTEMPTS,\n"),
    P(BARREL, null, "  retryModelCall,\n"),
    P(BARREL, null, "  createMemoryAttemptStore,\n"),
    P(AGENT_BARREL, null, "loadCommittedBrokerConfig,"),
    P(AGENT_BARREL, null, "detectLocalModels,"),
  ] },
  { rule: "PP-25", says: "an answer with unreadable usage can be free", pins: [
    P(CALL, "settle", "const unreadable = usageProblem(result?.usage) ??"),
    P(CALL, "settle", "if (unreadable !== null) {"),
    P(CALL, "unresolvedEntry", "costMicroUsd: worst,"),
    P(TRANSPORT, "usageProblem", "if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return"),
  ] },
  { rule: "PP-26", says: "a call that may have been dispatched can be repeated", pins: [
    P(CALL, null, "const RETRY_REASONS: readonly FailoverReason[] = ['rate_limit', 'upstream_rate_limit', 'upstream_unavailable', 'may_have_acted'];"),
    P(CALL, null, "const FALLBACK_REASONS: readonly FailoverReason[] = ['rate_limit', 'billing', 'upstream_rate_limit', 'upstream_unavailable', 'provider_error'];"),
    P(CALL, "attemptRoute", "shouldRetry: (err) => isRetryable(err, sent, longestWaitMs),"),
    P(CALL, null, "const reasonOf = (err: unknown): FailoverReason => (err instanceof ModelCallError ? err.reason : 'unknown');"),
    P(CALL, "walkRoutes", "if (!FALLBACK_REASONS.includes(reason)) return refuse('CALL_FAILED'"),
  ] },
  { rule: "PP-27", says: "a custom endpoint is no longer held to the public internet", pins: [
    P(ENDPOINTS, "customEndpointProblem", "if (scheme !== 'https') return 'a custom endpoint must be https';"),
    P(ENDPOINTS, "customEndpointProblem", "if (host.startsWith('[')) return"),
    P(ENDPOINTS, "customEndpointProblem", "if (isLoopbackHost(host) || isNonPublicLiteral(host)) return"),
    P(ENDPOINTS, "customEndpointProblem", "if (!DNS_NAME.test(host)) return"),
    P(ENDPOINTS, "customEndpointProblem", "if (INTERNAL_SUFFIX.test(host)) return"),
    P(ENDPOINTS, null, String.raw`const INTERNAL_SUFFIX = /(?:^|\.)(?:localhost|internal|local|nip\.io|sslip\.io|xip\.io|lvh\.me|localtest\.me|vcap\.me|lacolhost\.com|traefik\.me)$/i;`),
    P(ENDPOINTS, "isNonPublicLiteral", "a === 10 || a === 127"),
    P(ENDPOINTS, "endpointProblem", "return record.baseUrl === undefined ? null :"),
  ] },
];

const normalise = (text) => text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
/** Block comments, then whole-line and trailing line comments. A pin in a comment is not a pin. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/ .*$/gm, "");
const withoutJsComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

function bodyOf(text, fn) {
  const start = new RegExp(String.raw`^(?:export )?(?:async )?function\*? ${fn}\b|^(?:export )?const ${fn}\b`, "m").exec(text);
  if (start === null) return null;
  // A multi-line parameter list or return type also closes at column 0, and that is not the end of the body.
  const end = /\n\}(?!\)| \{)/.exec(text.slice(start.index));
  return end === null ? null : text.slice(start.index, start.index + end.index);
}

const importsOf = (text) => [...text.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]);

function creditProblems(raw) {
  const records = credit.parseNotices(raw[NOTICES_REL]);
  return FILES.flatMap((rel) => (raw[rel] === null ? [] : credit.judgeFile(rel, raw[rel], records, { sources: credit.SOURCES })));
}

function packageProblems(raw, E) {
  for (const [rel, want] of Object.entries(DEPENDENCIES)) {
    let manifest = null;
    try {
      manifest = JSON.parse(raw[rel]);
    } catch {
      E("PP-7", `${rel} does not parse`);
      continue;
    }
    for (const kind of ["dependencies", "devDependencies"]) {
      const names = Object.keys(manifest[kind] ?? {}).sort();
      if (JSON.stringify(names) !== JSON.stringify(want[kind])) E("PP-7", `${rel} ${kind} are ${names.join(", ") || "none"}, not the pinned list`);
    }
  }
}

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  const end = text.indexOf("\n];", start);
  return start < 0 || end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function headerProblems(raw, E) {
  for (const [rel, want] of Object.entries(PORTED)) {
    const header = raw[rel];
    const line = /^\/\/ Source-Path: (.+)$/m.exec(header);
    if (line === null || line[1] !== want.paths.join("; ")) E("PP-2", `${rel} does not name exactly ${want.paths.join("; ")}`);
    if (!header.includes(`// Source-Commit: ${want.sha}`)) E("PP-2", `${rel} is not pinned at ${want.sha}`);
    if (!header.includes(`// Ported-From: ${want.source} `)) E("PP-2", `${rel} does not name ${want.source}`);
    if (want.source === "openclaw" && !header.includes(piLineOf(raw[NOTICES_REL]))) E("PP-2", `${rel} does not carry the Pi credit`);
    if (!/^\/\/ Modified-By: ProjectOS \d{4}-\d{2}-\d{2}: modified for ProjectOS\. CHANGED: \S/m.test(header)) E("PP-2", `${rel} does not state what ProjectOS changed`);
  }
  for (const rel of ORIGINAL) {
    if (raw[rel].split("\n")[0] !== ORIGIN_LINE) E("PP-3", `${rel} does not open with the original mark`);
  }
}

function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule} ${RULE_NAMES[rule]}: ${msg}`]);
  const missing = Object.keys(raw).filter((rel) => raw[rel] === null);
  if (missing.length > 0) {
    missing.forEach((rel) => E("PP-1", `${rel} is missing`));
    return errors;
  }

  // PP-1: the two directories hold exactly the listed files, and git tracks them all (tests and builds run from disk).
  const listed = raw[LISTING].split("\n").filter(Boolean).sort();
  if (JSON.stringify(listed) !== JSON.stringify([...FILES].sort())) E("PP-1", `the broker directories hold ${listed.length} files, and they are not the ${FILES.length} this validator lists`);
  const tracked = raw[TRACKED].split("\n");
  for (const rel of FILES) if (!tracked.includes(rel)) E("PP-1", `${rel} is on disk and not tracked: check .gitignore`);

  headerProblems(raw, E);
  for (const refusal of creditProblems(raw)) E("PP-4", refusal.message);

  const code = Object.fromEntries(Object.entries(raw).map(([rel, text]) => [rel, withoutComments(text)]));
  const coreFiles = FILES.filter((rel) => rel.startsWith(CORE_DIR));
  const agentFiles = FILES.filter((rel) => rel.startsWith(AGENT_DIR));

  // PP-5: core imports nothing outside the kernel and holds no timer, clock, random source, file or network.
  for (const rel of coreFiles) {
    for (const spec of importsOf(code[rel])) if (!CORE_IMPORTS.test(spec)) E("PP-5", `${rel} imports ${spec}`);
    if (CORE_FORBIDDEN.test(code[rel])) E("PP-5", `${rel} reaches outside: ${CORE_FORBIDDEN.exec(code[rel])[0]}`);
  }

  // PP-6: the agent half reads nothing, writes nothing and opens nothing: it is handed ports.
  for (const rel of agentFiles) {
    for (const spec of importsOf(code[rel])) if (!AGENT_IMPORTS.test(spec)) E("PP-6", `${rel} imports ${spec}`);
    if (AGENT_FORBIDDEN.test(code[rel])) E("PP-6", `${rel} reaches outside: ${AGENT_FORBIDDEN.exec(code[rel])[0]}`);
  }

  packageProblems(raw, E);

  // PP-8: no xAI or Grok path in code. The one refusal that names it is the registry's own pattern.
  for (const rel of FILES) {
    const scanned = code[rel].replace(/^const NOT_PORTED = .*$/m, "").replace(/an xAI or Grok [a-z ]*(?:, which is not ported)?/g, "");
    if (NOT_PORTED_FORBIDDEN.test(scanned)) E("PP-8", `${rel} carries ${NOT_PORTED_FORBIDDEN.exec(scanned)[0]}`);
  }

  // PP-21: nothing reads a credential, and nothing rotates round a cap.
  for (const rel of FILES) {
    if (CREDENTIAL_FORBIDDEN.test(code[rel])) E("PP-21", `${rel} carries ${CREDENTIAL_FORBIDDEN.exec(code[rel])[0]}`);
  }

  // PP-16: no second price shape.
  for (const rel of coreFiles) if (OWN_RATECARD.test(code[rel])) E("PP-16", `${rel} declares a RateCard of its own`);

  // PP-9 and PP-10: the budget and the grant are asked before anything else, and the transport is reached once, last.
  const body = bodyOf(code[CALL], "callModel") ?? "";
  const order = ["BUDGET_REQUIRED", "REQUEST_INVALID", "runCall("].map((needle) => body.indexOf(needle));
  if (order.some((at) => at < 0) || order.some((at, i) => i > 0 && at < order[i - 1])) E("PP-9", "a check moved after the step it guards");
  const run = bodyOf(code[CALL], "runCall") ?? "";
  const runOrder = ["granted(request", "recalled(", "walkRoutes("].map((needle) => run.indexOf(needle));
  if (runOrder.some((at) => at < 0) || runOrder.some((at, i) => i > 0 && at < runOrder[i - 1])) E("PP-38", "a replay is served before the grant is asked, or the call starts before the replay is judged");
  const walk = bodyOf(code[CALL], "walkRoutes") ?? "";
  const catchOrder = ["if (routeRun.mayHaveActed) return refuse(", "if (err instanceof AttemptStoreFull)", "if (err instanceof AttemptsExhausted)", "if (err instanceof BudgetExhausted)"].map((needle) => walk.indexOf(needle));
  if (catchOrder.some((at) => at < 0) || catchOrder.some((at, i) => i > 0 && at < catchOrder[i - 1])) E("PP-36", "an unknown outcome is checked after a refusal that could mask it");
  if (code[CALL].split("deps.transport(").length - 1 !== 1) E("PP-9", "the transport is reached from somewhere other than the one dispatch");
  const attempt = bodyOf(code[CALL], "attemptRoute") ?? "";
  const gate = ["throw new BudgetExhausted()", "deps.attempts.begin(", "run.reserved += worst", "dispatch("].map((needle) => attempt.indexOf(needle));
  if (gate.some((at) => at < 0) || gate.some((at, i) => i > 0 && at < gate[i - 1])) E("PP-14", "an attempt reaches the transport before the budget and the cap have been asked");

  // PP-13: the request has no field a caller could use to hand in a history or a count.
  const requestType = /export interface ModelCallRequest \{[\s\S]*?\n\}/.exec(code[CALL])?.[0] ?? "";
  if (/history|attempt|count/i.test(requestType)) E("PP-13", "the request carries a field a caller could use to set the attempt count");
  if (/request\.(?:history|attempts?|attemptHistory)/.test(code[CALL])) E("PP-13", "the call reads a count or a history from the request");

  // PP-20: the address is read as text, so an alias spelling cannot become loopback after parsing.
  const detect = bodyOf(code[LOCAL], "detectOne") ?? "";
  if (!(detect.indexOf("localEndpointProblem(") >= 0 && detect.indexOf("localEndpointProblem(") < detect.indexOf("getJson("))) E("PP-20", "the port is reached before the loopback rule has judged the address");

  // PP-23
  for (const [rel, name] of [[VA_REL, "validate-all"], [CR_REL, "cached-runner"]]) {
    const modules = modulesOf(withoutJsComments(raw[rel]));
    if (modules === null || !modules.includes(THIS_VALIDATOR)) E("PP-23", `${THIS_VALIDATOR} is not registered in ${name}`);
  }

  // PP-24: "unwired" is enforced. Only the core barrel's one export line may name the module.
  const importers = raw[IMPORTERS].split("\n").filter(Boolean).sort();
  if (JSON.stringify(importers) !== JSON.stringify([...ALLOWED_IMPORTERS].sort())) {
    E("PP-24", `outside the module, ${importers.filter((rel) => !ALLOWED_IMPORTERS.includes(rel)).join(", ") || "nothing"} names it, and ${ALLOWED_IMPORTERS.filter((rel) => !importers.includes(rel)).join(", ") || "nothing allowed is missing"}`);
  }

  // The pins, each inside its function when one is named.
  for (const { rule, says, pins } of PIN_RULES) {
    for (const { rel, fn, pin } of pins) {
      const scope = fn === null ? code[rel] : bodyOf(code[rel], fn);
      if (scope === null || !scope.includes(pin)) E(rule, `${says}: ${rel}${fn === null ? "" : ` ${fn}`} lost: ${pin}`);
    }
  }

  // PP-T
  for (const [rel, needles] of Object.entries(TESTS)) {
    for (const needle of needles) if (!raw[rel].includes(needle)) E("PP-T", `${rel} no longer proves "${needle}"`);
    if (NOT_RUN.test(raw[rel])) E("PP-T", `${rel} skips or isolates a test: ${NOT_RUN.exec(raw[rel])[0]}`);
  }
  return errors;
}

const PROBE = String.raw`
const core = await import('./core/src/shim.ts');
const ledger = await import('./core/src/gatekeeperCostLedger.ts');
const { loadCommittedBrokerConfig, detectLocalModels } = await import('./agent/src/modelBroker/index.ts');
const failed = new Set();
let count = 0;
const expectIt = async (rule, run) => {
  count += 1;
  try {
    if ((await run()) !== true) failed.add(rule);
  } catch {
    failed.add(rule);
  }
};
const KEY = (c) => 'sha256:' + c.repeat(64);
const COMMIT = 'a'.repeat(40);
const SCOPE = { tenant: 'acme-co', project: 'alpha-project' };
const price = (provider, model, extra = {}) => ({ provider, model, input: 1, output: 2, source: 's', pricedAt: '2026-11-01', ...extra });
const tableOf = (...rows) => {
  const parsed = core.parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: rows }), commit: COMMIT });
  if (!parsed.ok) throw new Error('table');
  return parsed.table;
};
const registryOf = (...records) => {
  const made = core.createProviderRegistry(records);
  if (!made.ok) throw new Error('registry');
  return made.registry;
};
const OK = { text: 'hello', stopReason: 'stop', usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } };
const rig = (transport, over = {}) => {
  const calls = [];
  const sent = [];
  const sleeps = [];
  const records = [];
  const attempts = [];
  const clock = { now: 10000 };
  const deps = {
    registry: registryOf({ name: 'primary', kind: 'hosted', api: 'openai-completions' }, { name: 'backup', kind: 'hosted', api: 'anthropic-messages' }),
    pricing: tableOf(price('primary', 'big'), price('backup', 'small')),
    transport: async (route) => {
      calls.push(route.provider);
      sent.push(route);
      return transport(route.provider, calls.length);
    },
    grant: () => true,
    attempts: core.createMemoryAttemptStore(),
    cooldowns: core.createCooldownBook(),
    clock: () => clock.now,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    record: (entry) => void records.push(entry),
    recordAttempt: (detail) => void attempts.push(detail),
    ...over,
  };
  return { deps, calls, sent, sleeps, records, attempts, clock };
};
const request = (extra = {}) => {
  const base = {
    tenant: 'acme-co', requestId: 'req-1', project: 'alpha-project', phaseId: 'PHASE-1',
    chain: [{ provider: 'primary', model: 'big' }, { provider: 'backup', model: 'small' }],
    prompt: 'say hello', estimatedInputTokens: 1000, maxOutputTokens: 500, budget: { maxMicroUsd: 1000000 }, ...extra,
  };
  return { ...base, idempotencyKey: 'idempotencyKey' in extra ? extra.idempotencyKey : core.bindingKeyOf(base) };
};
const limited = (after) => new core.ModelCallError('rate_limit', 'slow', after === undefined ? {} : { retryAfterMs: after });
const unsure = () => new core.ModelCallError('may_have_acted', 'timeout after send');
const lone = { chain: [{ provider: 'primary', model: 'big' }] };

// PP-9: a call with no usable budget never reaches the transport, and one with a budget does.
await expectIt('PP-9', async () => {
  const r = rig(async () => OK);
  return (await core.callModel(request(), r.deps)).ok === true && r.calls.length === 1;
});
await expectIt('PP-9', async () => {
  for (const budget of [undefined, null, {}, { maxMicroUsd: 0 }, { maxMicroUsd: -1 }, { maxMicroUsd: 1.5 }, { maxMicroUsd: Number.NaN }, { maxMicroUsd: '5' }, 7]) {
    const r = rig(async () => OK);
    const out = await core.callModel(request({ budget }), r.deps);
    if (out.ok !== false || out.refusal.code !== 'BUDGET_REQUIRED' || r.calls.length !== 0) return false;
  }
  return true;
});

// PP-10: a P3 call needs a grant that answers exactly true.
await expectIt('PP-10', async () => {
  for (const grant of [() => false, () => 'yes', () => undefined, () => { throw new Error('boom'); }]) {
    const r = rig(async () => OK, { grant });
    const out = await core.callModel(request(), r.deps);
    if (out.ok !== false || out.refusal.code !== 'NO_GRANT' || r.calls.length !== 0) return false;
  }
  return core.MODEL_CALL_CLASS === 'P3';
});

// PP-11: no retry waits less than the floor, whatever is asked or said, and the raw runner holds it too.
await expectIt('PP-11', async () => {
  const sleeps = [];
  const run = (options) => core.retryModelCall(async () => { throw new Error('x'); }, { sleep: async (ms) => void sleeps.push(ms), random: () => 0, ...options }).catch(() => undefined);
  await run({ requested: { attempts: 3, minDelayMs: 0, maxDelayMs: 0, jitter: 'full' } });
  await run({ requested: { attempts: 2, minDelayMs: -5 }, retryAfterMs: () => 0 });
  await run({ requested: { attempts: 2, minDelayMs: Number.NaN } });
  return sleeps.length === 4 && sleeps.every((ms) => ms >= core.BACKOFF_FLOOR_MS);
});
await expectIt('PP-11', async () => {
  const sleeps = [];
  await core.retryModelCall(async () => { throw new Error('x'); }, { requested: { attempts: 2, minDelayMs: 5000 }, sleep: async (ms) => void sleeps.push(ms), random: () => 0 }).catch(() => undefined);
  await core.retryModelCall(async () => { throw new Error('x'); }, { requested: { attempts: 2 }, retryAfterMs: () => 20000, sleep: async (ms) => void sleeps.push(ms), random: () => 0 }).catch(() => undefined);
  return sleeps.join(',') === '5000,20000';
});
await expectIt('PP-11', async () => {
  const sleeps = [];
  const retry = core.createRetryRunner({ sleep: async (ms) => void sleeps.push(ms), random: () => 0 });
  await retry(async () => { throw new Error('x'); }, { attempts: 3, minDelayMs: 0, maxDelayMs: 0, jitter: 0 }).catch(() => undefined);
  const nan = [];
  const wild = core.createRetryRunner({ sleep: async (ms) => void nan.push(ms), random: () => Number.NaN });
  await wild(async () => { throw new Error('x'); }, { attempts: 3, jitter: 'full' }).catch(() => undefined);
  return sleeps.length === 2 && sleeps.every((ms) => ms >= core.RETRY_FLOOR_MS) && nan.length === 2 && nan.every((ms) => Number.isFinite(ms) && ms >= core.RETRY_FLOOR_MS);
});

// PP-12: the cap holds for one call and for a key, however many attempts are asked for.
await expectIt('PP-12', async () => {
  let n = 0;
  await core.retryModelCall(async () => { n += 1; throw new Error('x'); }, { requested: { attempts: 99 }, sleep: async () => undefined, random: () => 0 }).catch(() => undefined);
  let m = 0;
  await core.createRetryRunner({ sleep: async () => undefined, random: () => 0 })(async () => { m += 1; throw new Error('x'); }, { attempts: 99 }).catch(() => undefined);
  return n === core.MAX_MODEL_ATTEMPTS && m === core.RETRY_ATTEMPT_CEILING;
});
await expectIt('PP-12', async () => {
  const r = rig(async () => { throw unsure(); }, { retry: { attempts: 99 } });
  await core.callModel(request(lone), r.deps);
  const first = r.calls.length;
  const again = await core.callModel(request(lone), r.deps);
  return first === core.MAX_MODEL_ATTEMPTS && r.calls.length === core.MAX_MODEL_ATTEMPTS && again.ok === false && again.refusal.code === 'ATTEMPTS_EXHAUSTED';
});

// PP-13: a key's count is the store's, so an empty history from the caller resets nothing.
await expectIt('PP-13', async () => {
  const r = rig(async () => { throw unsure(); });
  for (let i = 0; i < 4; i += 1) await core.callModel(request({ ...lone, history: [], attempts: 0, attemptHistory: [] }), r.deps);
  const after = await core.callModel(request({ ...lone, history: [] }), r.deps);
  return r.calls.length === core.MAX_MODEL_ATTEMPTS && after.ok === false && after.refusal.code === 'ATTEMPTS_EXHAUSTED';
});
await expectIt('PP-13', async () => {
  const store = core.createMemoryAttemptStore();
  let refused = 0;
  for (const key of ['', 'SHA256:' + 'a'.repeat(64), 'sha256:abc']) await store.begin(SCOPE, key, 'f').catch(() => void (refused += 1));
  return refused === 3 && (await store.begin(SCOPE, KEY('a'), 'f')) === 1 && (await store.begin(SCOPE, KEY('a'), 'f')) === 2 && (await store.begin(SCOPE, KEY('b'), 'f')) === 1;
});

// PP-14: each attempt reserves its worst case, so retries that may have been billed cannot spend past the budget. One attempt is 2000.
await expectIt('PP-14', async () => {
  const r = rig(async () => { throw unsure(); });
  const out = await core.callModel(request({ ...lone, budget: { maxMicroUsd: 5000 } }), r.deps);
  return out.ok === false && out.refusal.code === 'OUTCOME_UNKNOWN' && r.calls.length === 2;
});
await expectIt('PP-14', async () => {
  const r = rig(async () => OK);
  const out = await core.callModel(request({ budget: { maxMicroUsd: 10 } }), r.deps);
  return out.ok === false && out.refusal.code === 'OVER_BUDGET' && r.calls.length === 0;
});

// PP-15: only committed bytes, only priced models, only whole positive prices.
await expectIt('PP-15', async () => {
  const text = JSON.stringify({ schema: 1, models: [price('p', 'm')] });
  const noCommit = ['', 'HEAD', 'a'.repeat(39), 'A'.repeat(40)].every((commit) => core.parseCommittedPricing({ text, commit }).ok === false);
  const bad = [{ input: 0 }, { output: 0 }, { input: -1 }, { input: 3.0000001 }, { output: '2' }].every((change) => core.parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [price('p', 'm', change)] }), commit: COMMIT }).ok === false);
  const dup = core.parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [price('p', 'm'), price('p', 'm')] }), commit: COMMIT }).ok === false;
  const unknown = core.parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [price('p', 'm', { apiKey: 'x' })] }), commit: COMMIT }).ok === false;
  return noCommit && bad && dup && unknown && tableOf(price('p', 'm')).commit === COMMIT;
});
await expectIt('PP-15', async () => {
  const r = rig(async () => OK);
  const out = await core.callModel(request({ chain: [{ provider: 'primary', model: 'unlisted' }] }), r.deps);
  return out.ok === false && out.refusal.code === 'NO_ROUTE' && r.calls.length === 0 && core.rateCardFor(tableOf(price('p', 'm')), 'p', 'other', 1).reason === 'unpriced';
});
await expectIt('PP-15', async () => {
  const prices = JSON.stringify({ schema: 1, models: [price('p', 'm')] });
  const providers = JSON.stringify({ schema: 1, providers: [{ name: 'p', kind: 'hosted', api: 'openai-completions' }] });
  const files = { 'a/prices.json': prices, 'a/providers.json': providers, '../a/prices.json': prices, 'a/../a/prices.json': prices };
  const ask = (commit) => (path) => (path in files ? { text: files[path], commit } : null);
  const good = loadCommittedBrokerConfig({ read: ask(COMMIT), pricingPath: 'a/prices.json', registryPath: 'a/providers.json' });
  const wrongCommit = loadCommittedBrokerConfig({ read: ask('working-tree'), pricingPath: 'a/prices.json', registryPath: 'a/providers.json' });
  const paths = ['../a/prices.json', '/a/prices.json', 'a/../a/prices.json', 'a/prices.txt', 'C:/a/prices.json', ''].every((pricingPath) => loadCommittedBrokerConfig({ read: ask(COMMIT), pricingPath, registryPath: 'a/providers.json' }).ok === false);
  const missing = loadCommittedBrokerConfig({ read: () => null, pricingPath: 'a/prices.json', registryPath: 'a/providers.json' }).ok === false;
  const mixed = loadCommittedBrokerConfig({ read: (path) => ({ text: files[path], commit: path === 'a/providers.json' ? 'working-tree' : COMMIT }), pricingPath: 'a/prices.json', registryPath: 'a/providers.json' }).ok === false;
  return mixed && good.ok === true && good.pricing.commit === COMMIT && wrongCommit.ok === false && paths && missing;
});

// PP-16: the price is the ledger's RateCard, and the ledger prices the call.
await expectIt('PP-16', async () => {
  const found = core.rateCardFor(tableOf(price('p', 'm', { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 })), 'p', 'm', 10);
  const ledgerOk = found.ok && ledger.rateCardProblems(found.rate).length === 0 && ledger.estimateCostMicroUsd({ inputTokens: 1000000, outputTokens: 1000000 }, found.rate) === 18750000;
  const r = rig(async () => OK);
  const out = await core.callModel(request(), r.deps);
  return ledgerOk && out.ok === true && out.costMicroUsd === 200 && r.records.length === 1 && r.records[0].costMicroUsd === 200 && r.records[0].model === 'primary/big';
});

// PP-17: a dearer cache write is carried as the input price; a free cache read is not free.
await expectIt('PP-17', async () => {
  const dear = core.rateCardFor(tableOf(price('p', 'm', { input: 1, cache_write: 5 })), 'p', 'm', 1);
  const free = core.rateCardFor(tableOf(price('p', 'm', { cache_read: 0 })), 'p', 'm', 1);
  return dear.ok && dear.rate.inputMicroUsdPerMillion === 5000000 && free.ok && !('cachedInputMicroUsdPerMillion' in free.rate);
});
await expectIt('PP-17', async () => {
  const tiered = tableOf(price('p', 'm', { input: 3, output: 15, context_over_200k: { input: 6, output: 22.5 } }));
  const small = core.rateCardFor(tiered, 'p', 'm', 1000);
  const large = core.rateCardFor(tiered, 'p', 'm', 250000);
  const clash = core.parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [price('p', 'm', { tiers: [{ tier: { type: 'context', size: 9 }, input: 4, output: 5 }, { tier: { type: 'context', size: 9 }, input: 5, output: 6 }] })] }), commit: COMMIT }).ok === false;
  const r = rig(async () => ({ ...OK, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 1000000 } }), { pricing: tableOf(price('primary', 'big', { input: 1, output: 2, cache_write: 5 })) });
  const out = await core.callModel(request({ ...lone, estimatedInputTokens: 10, maxOutputTokens: 10, budget: { maxMicroUsd: 99999999 } }), r.deps);
  return small.rate.outputMicroUsdPerMillion === 15000000 && large.rate.outputMicroUsdPerMillion === 22500000 && clash && out.ok === true && out.costMicroUsd === 5000000;
});

// PP-18: a fallback never calls a provider the registry has not got, whatever its spelling.
await expectIt('PP-18', async () => {
  const r = rig(async () => OK);
  const out = await core.callModel(request({ chain: [{ provider: 'rogue', model: 'big' }, { provider: 'Primary', model: 'big' }, { provider: 'primary ', model: 'big' }, { provider: 'backup', model: 'small' }] }), r.deps);
  return out.ok === true && out.route.provider === 'backup' && r.calls.join() === 'backup';
});
await expectIt('PP-18', async () => {
  const dup = core.createProviderRegistry([{ name: 'one', kind: 'hosted', api: 'openai-completions' }, { name: 'one', kind: 'hosted', api: 'openai-completions' }]).ok === false;
  const upper = core.createProviderRegistry([{ name: 'UPPER', kind: 'hosted', api: 'openai-completions' }]).ok === false;
  const registry = registryOf({ name: 'zeta', kind: 'hosted', api: 'openai-completions' }, { name: 'alpha', kind: 'hosted', api: 'openai-completions' });
  return dup && upper && Object.isFrozen(registry) && registry.has('ZETA') && registry.list().map((p) => p.name).join() === 'alpha,zeta';
});
await expectIt('PP-18', async () => {
  const table = tableOf(price('a', 'm1'), price('b', 'm2'));
  const base = { registry: registryOf({ name: 'a', kind: 'hosted', api: 'openai-completions' }), cooldowns: core.NO_COOLDOWNS, pricing: table, nowMs: 5, promptTokens: 1, tried: new Set() };
  const unregistered = core.chooseRoute({ ...base, chain: [{ provider: 'b', model: 'm2' }] });
  const tried = core.chooseRoute({ ...base, chain: [{ provider: 'a', model: 'm1' }], tried: new Set(['a/m1']) });
  const unpriced = core.chooseRoute({ ...base, chain: [{ provider: 'a', model: 'zz' }] });
  return unregistered.ok === false && tried.ok === false && unpriced.ok === false && core.chooseRoute({ ...base, chain: [{ provider: 'a', model: 'm1' }] }).ok === true;
});

// PP-19: a limited provider rests until its end by the injected clock, not for longer than the ceiling, and never less than the base.
await expectIt('PP-19', async () => {
  const first = core.armCooldown(core.NO_COOLDOWNS, 'p', 'rate_limit', 1000);
  const second = core.armCooldown(first.state, 'p', 'rate_limit', 1000);
  let state = core.NO_COOLDOWNS;
  let last = 0;
  for (let i = 0; i < 12; i += 1) {
    const armed = core.armCooldown(state, 'p', 'rate_limit', 0);
    state = armed.state;
    last = armed.cooldownSeconds;
  }
  const declared = core.armCooldown(core.NO_COOLDOWNS, 'p', 'rate_limit', 0, 90000).cooldownSeconds;
  const forever = core.armCooldown(core.NO_COOLDOWNS, 'p', 'rate_limit', 0, 1e15).cooldownSeconds;
  const past = core.armCooldown(core.NO_COOLDOWNS, 'p', 'rate_limit', 5000, 10).cooldownSeconds;
  const short = core.armCooldown(core.NO_COOLDOWNS, 'p', 'rate_limit', 0, 5000).cooldownSeconds;
  const outage = core.armCooldown(core.NO_COOLDOWNS, 'p', 'upstream_unavailable', 0).cooldownSeconds;
  return first.cooldownSeconds === 60 && second.cooldownSeconds === 120 && last === core.COOLDOWN_MAX_SECONDS && declared === 90 && forever === core.COOLDOWN_MAX_SECONDS && past === 60 && short === 60 && outage === core.COOLDOWN_OUTAGE_SECONDS;
});
await expectIt('PP-19', async () => {
  const { state } = core.armCooldown(core.NO_COOLDOWNS, 'p', 'rate_limit', 1000);
  const none = core.armCooldown(core.NO_COOLDOWNS, 'p', 'authentication', 1000);
  const cleared = core.armCooldown(core.clearCooldown(core.armCooldown(state, 'p', 'billing', 1000).state, 'p'), 'p', 'rate_limit', 1000).cooldownSeconds;
  return core.isCoolingDown(state, 'p', 60999) && !core.isCoolingDown(state, 'p', 61000) && !core.isCoolingDown(state, 'q', 1000) && none.cooldownSeconds === null && cleared === 60;
});
await expectIt('PP-19', async () => {
  let limit = true;
  const r = rig(async (provider) => {
    if (provider === 'primary' && limit) throw limited();
    return OK;
  }, { retry: { attempts: 1 } });
  const first = await core.callModel(request(), r.deps);
  const second = await core.callModel(request({ requestId: 'req-2' }), r.deps);
  limit = false;
  r.clock.now += 60001;
  const third = await core.callModel(request({ requestId: 'req-3' }), r.deps);
  return first.ok && first.route.provider === 'backup' && second.ok && second.route.provider === 'backup' && third.ok && third.route.provider === 'primary' && r.calls.join() === 'primary,backup,backup,primary';
});
await expectIt('PP-19', async () => {
  const r = rig(async (provider) => { if (provider === 'primary') throw new core.ModelCallError('upstream_unavailable', 'down'); return OK; }, { retry: { attempts: 1 } });
  await core.callModel(request(), r.deps);
  const during = await core.callModel(request({ requestId: 'req-2' }), r.deps);
  return during.ok && r.calls.join() === 'primary,backup,backup';
});

// PP-20: loopback addresses only, read as text; the port is never reached for anything else.
await expectIt('PP-20', async () => {
  const yes = ['127.0.0.1', '127.9.9.9', '[::1]', '::1', 'localhost', 'LOCALHOST'].every((host) => core.isLoopbackHost(host));
  const no = ['0.0.0.0', '10.0.0.1', '128.0.0.1', '2130706433', '0x7f000001', '127.1', '127.0.0.256', '127.0.0.1.nip.io', 'localhost.evil.com', '[::ffff:127.0.0.1]', '[::]', '', '127.00.0.1'].every((host) => !core.isLoopbackHost(host));
  return yes && no;
});
await expectIt('PP-20', async () => {
  const yes = ['http://127.0.0.1:11434', 'http://localhost:1234/v1', 'http://[::1]:8080'].every((url) => core.localEndpointProblem(url) === null);
  const no = ['http://127.0.0.1@evil.com/', 'http://evil.com/127.0.0.1', 'http://10.0.0.2:11434', 'https://api.openai.com', 'ftp://127.0.0.1', 'http://user:pw@127.0.0.1', 'http://127.0.0.1:11434/?x=1', 'http://127.0.0.1:99999', 'http://2130706433', 'not a url', undefined].every((url) => core.localEndpointProblem(url) !== null);
  const kinds = core.createProviderRegistry([{ name: 'o', kind: 'local', api: 'ollama', baseUrl: 'http://127.0.0.1:11434' }]).ok === true &&
    core.createProviderRegistry([{ name: 'o', kind: 'local', api: 'ollama', baseUrl: 'http://10.1.1.1:11434' }]).ok === false &&
    core.createProviderRegistry([{ name: 'o', kind: 'local', api: 'ollama' }]).ok === false &&
    core.createProviderRegistry([{ name: 'h', kind: 'hosted', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1' }]).ok === false;
  return yes && no && kinds;
});
await expectIt('PP-20', async () => {
  const asked = [];
  const found = await detectLocalModels({
    endpoints: ['http://10.0.0.5:11434', 'https://api.openai.com', 'http://127.0.0.1@evil.com', 'http://localhost.evil.com:11434', 'http://0.0.0.0:1234'].map((baseUrl) => ({ baseUrl, api: 'openai-completions' })),
    getJson: async (url) => (asked.push(url), { data: [] }),
  });
  const local = await detectLocalModels({ endpoints: [{ baseUrl: 'http://127.0.0.1:1234', api: 'openai-completions' }], getJson: async (url) => (asked.push(url), { data: [{ id: 'm' }] }) });
  return found.every((f) => f.status === 'refused') && asked.join() === 'http://127.0.0.1:1234/v1/models' && local[0].status === 'found';
});

// PP-21: a record names a credential, never holds one.
await expectIt('PP-21', async () => {
  const keyed = ['apiKey', 'api_key', 'token', 'secret', 'password', 'credentialPool'].every((field) => core.createProviderRegistry([{ name: 'x', kind: 'hosted', api: 'openai-completions', [field]: 'v' }]).ok === false);
  const refs = core.createProviderRegistry([{ name: 'x', kind: 'hosted', api: 'openai-completions', credentialRef: 'provider.x' }]).ok === true &&
    core.createProviderRegistry([{ name: 'x', kind: 'hosted', api: 'openai-completions', credentialRef: 'sk-abcdefghijklmnop' }]).ok === false &&
    core.createProviderRegistry([{ name: 'x', kind: 'hosted', api: 'openai-completions', credentialRef: 'a'.repeat(30) }]).ok === false;
  return keyed && refs;
});

// PP-8: no xAI or Grok provider or model is accepted, and an unrelated name that holds the letters is.
await expectIt('PP-8', async () => ['xai', 'grok', 'x-ai', 'grok-4'].every((name) => core.createProviderRegistry([{ name, kind: 'hosted', api: 'openai-completions' }]).ok === false));
await expectIt('PP-8', async () => {
  const table = core.parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [price('p', 'grok-4')] }), commit: COMMIT }).ok === false;
  const whole = core.parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [price('p', 'relaxai-7b')] }), commit: COMMIT }).ok === true;
  const r = rig(async () => OK);
  const out = await core.callModel(request({ chain: [{ provider: 'primary', model: 'x-ai/some-model' }, { provider: 'backup', model: 'small' }] }), r.deps);
  return table && whole && out.ok === false && out.refusal.code === 'REQUEST_INVALID' && r.calls.length === 0;
});

// PP-25: an answer with unreadable usage keeps its worst case counted, and is never a free call.
await expectIt('PP-25', async () => {
  const r = rig(async () => ({ ...OK, usage: { input: Number.NaN, output: -1, cacheRead: 0, cacheWrite: 0 } }));
  const out = await core.callModel(request(), r.deps);
  const odd = rig(async () => ({ text: 'x', stopReason: 'weird', usage: OK.usage }));
  const oddOut = await core.callModel(request(), odd.deps);
  return out.ok === false && out.refusal.code === 'USAGE_UNREADABLE' && r.records.length === 1 && r.records[0].costMicroUsd === 2000 && r.records[0].unresolved === true && oddOut.ok === false && oddOut.refusal.code === 'RESPONSE_INVALID';
});

// PP-26: only a failure known not to have acted is repeated elsewhere, and only a limit or an outage falls back.
await expectIt('PP-26', async () => {
  for (const failure of [new Error('socket closed after write'), new core.ModelCallError('invalid_request', 'bad'), new core.ModelCallError('authentication', 'no')]) {
    const r = rig(async () => { throw failure; });
    const out = await core.callModel(request(), r.deps);
    if (out.ok !== false || out.refusal.code !== 'CALL_FAILED' || r.calls.length !== 1) return false;
  }
  const down = rig(async (provider) => { if (provider === 'primary') throw new core.ModelCallError('upstream_unavailable', 'down'); return OK; }, { retry: { attempts: 1 } });
  const moved = await core.callModel(request(), down.deps);
  return moved.ok === true && moved.route.provider === 'backup';
});

// PP-27: a custom endpoint is https, a public name, and never this machine, its network or an internal or wildcard-DNS name.
await expectIt('PP-27', async () => {
  const custom = (baseUrl) => core.createProviderRegistry([{ name: 'mine', kind: 'custom-openai-compatible', api: 'openai-completions', baseUrl }]).ok;
  const yes = custom('https://llm.example.com/v1') === true && custom('https://notnip.io/v1') === true;
  const no = ['http://llm.example.com/v1', undefined, 'https://user:pw@llm.example.com', 'https://llm.example.com/v1?key=1', 'https://127.0.0.1/v1', 'https://localhost/v1', 'https://[::1]/v1', 'https://10.0.0.1/v1', 'https://192.168.0.1/v1', 'https://172.20.0.1/v1', 'https://169.254.169.254/latest', 'https://0.0.0.0/', 'https://[2001:db8::1]/v1', 'https://0x7f.1/', 'https://intranet/', 'https://api.localhost/v1', 'https://svc.internal/v1', 'https://printer.local/v1', 'https://127.0.0.1.nip.io/v1', 'https://a.sslip.io/v1', 'https://b.xip.io/v1', 'https://c.lvh.me/v1', 'https://d.localtest.me/v1', 'https://e.vcap.me/v1', 'https://f.lacolhost.com/v1', 'https://g.traefik.me/v1'].every((url) => custom(url) === false);
  return yes && no && core.endpointProblem({ kind: 'custom-openai-compatible', baseUrl: 'https://llm.example.com' }) === null;
});

// PP-28: the budget is a bound: the estimate is raised to what the prompt needs.
await expectIt('PP-28', async () => {
  const r = rig(async () => OK);
  const out = await core.callModel(request({ prompt: 'x'.repeat(500000), estimatedInputTokens: 0, maxOutputTokens: 1, budget: { maxMicroUsd: 100 } }), r.deps);
  const small = rig(async () => OK);
  const fine = await core.callModel(request({ prompt: 'hi', estimatedInputTokens: 0, maxOutputTokens: 1, budget: { maxMicroUsd: 1000 } }), small.deps);
  return out.ok === false && out.refusal.code === 'OVER_BUDGET' && r.calls.length === 0 && fine.ok === true;
});

// PP-29: the key is bound, the count and the cooldown are scoped, and a finished request is answered once.
await expectIt('PP-29', async () => {
  const r = rig(async () => OK);
  const forged = await core.callModel(request({ idempotencyKey: KEY('c') }), r.deps);
  const first = await core.callModel(request(), r.deps);
  const second = await core.callModel(request(), r.deps);
  return forged.ok === false && forged.refusal.code === 'REQUEST_INVALID' && first.ok === true && first.replayed === false && second.ok === true && second.replayed === true && second.text === 'hello' && r.calls.length === 1 && r.records.length === 1;
});
await expectIt('PP-29', async () => {
  const base = { tenant: 'acme-co', project: 'alpha-project', requestId: 'r', prompt: 'p' };
  const key = core.bindingKeyOf(base);
  const moves = [{ tenant: 'other-co' }, { project: 'beta-project' }, { requestId: 'r2' }, { prompt: 'p2' }].every((change) => core.bindingKeyOf({ ...base, ...change }) !== key);
  const boundary = core.bindingKeyOf({ ...base, project: 'a', requestId: 'bc' }) !== core.bindingKeyOf({ ...base, project: 'ab', requestId: 'c' });
  return moves && boundary && /^sha256:[0-9a-f]{64}$/.test(key);
});
await expectIt('PP-29', async () => {
  const store = core.createMemoryAttemptStore();
  await store.begin(SCOPE, KEY('a'), 'f');
  const otherTenant = await store.begin({ tenant: 'other-co', project: 'alpha-project' }, KEY('a'), 'f');
  const otherProject = await store.begin({ tenant: 'acme-co', project: 'beta-project' }, KEY('a'), 'f');
  const book = core.createCooldownBook();
  book.set(SCOPE, core.armCooldown(core.NO_COOLDOWNS, 'p', 'rate_limit', 0).state);
  return otherTenant === 1 && otherProject === 1 && book.get({ tenant: 'other-co', project: 'alpha-project' }) === core.NO_COOLDOWNS && book.get(SCOPE) !== core.NO_COOLDOWNS;
});

// PP-30: the key reaches the transport, and a call that may have acted is retried only on its own route with that key.
await expectIt('PP-30', async () => {
  const r = rig(async () => { throw unsure(); });
  const req = request();
  const out = await core.callModel(req, r.deps);
  return out.ok === false && out.refusal.code === 'OUTCOME_UNKNOWN' && r.calls.length > 1 && r.calls.every((p) => p === 'primary') && r.sent.every((s) => s.idempotencyKey === req.idempotencyKey);
});

// PP-31: a stop reason is part of the answer.
await expectIt('PP-31', async () => {
  for (const stopReason of ['error', 'aborted']) {
    const r = rig(async (provider) => (provider === 'primary' ? { ...OK, stopReason } : OK));
    const out = await core.callModel(request(), r.deps);
    if (!(out.ok === true && out.route.provider === 'backup' && r.calls.join() === 'primary,backup')) return false;
  }
  const len = rig(async () => ({ ...OK, stopReason: 'length' }));
  const cut = await core.callModel(request(), len.deps);
  return cut.ok === true && cut.stopReason === 'length';
});

// PP-32: a failed attempt is accounted for: a free one releases its reservation, a possibly billed one keeps it, and the refusal says what happened.
await expectIt('PP-32', async () => {
  const r = rig(async (provider) => { if (provider === 'primary') throw limited(); return OK; }, { retry: { attempts: 1 } });
  const out = await core.callModel(request({ budget: { maxMicroUsd: 3000 } }), r.deps);
  const k = rig(async () => { throw unsure(); });
  await core.callModel(request(lone), k.deps);
  return out.ok === true && out.route.provider === 'backup' && r.attempts[0].reason === 'rate_limit' && r.attempts[0].possiblySpentMicroUsd === 0 && k.attempts.length > 0 && k.attempts.every((a) => a.possiblySpentMicroUsd === 2000) && k.records.length === k.attempts.length;
});
await expectIt('PP-32', async () => {
  const r = rig(async () => { throw limited(); }, { retry: { attempts: 1 } });
  const first = await core.callModel(request(lone), r.deps);
  const second = await core.callModel(request({ ...lone, requestId: 'req-2' }), r.deps);
  const bad = rig(async () => ({ ...OK, usage: { input: Number.NaN, output: 0, cacheRead: 0, cacheWrite: 0 } }), { record: () => { throw new Error('x'); } });
  const badOut = await core.callModel(request(), bad.deps);
  const failures = first.ok === false ? first.refusal.failures : [];
  return second.ok === false && second.refusal.retryAtMs === 70000 && failures.length === 1 && failures[0].reason === 'rate_limit' && failures[0].attempts === 1 && badOut.ok === false && badOut.refusal.recorded === false;
});

// PP-33: a provider's own request to be left alone is honoured: no retry past the cap, and the cooldown follows it.
await expectIt('PP-33', async () => {
  const r = rig(async (provider) => { if (provider === 'primary') throw limited(120000); return OK; });
  const out = await core.callModel(request(), r.deps);
  r.clock.now += 119000;
  const during = await core.callModel(request({ requestId: 'req-2' }), r.deps);
  r.clock.now += 2000;
  const after = await core.callModel(request({ requestId: 'req-3' }), r.deps);
  return out.ok === true && out.route.provider === 'backup' && r.sleeps.length === 0 && during.ok === true && after.ok === true && r.calls.join() === 'primary,backup,backup,primary,backup';
});

// PP-34: a bad clock after the spend, an oversized answer and a full store do not break the call.
await expectIt('PP-34', async () => {
  let reads = 0;
  const r = rig(async () => OK, { clock: () => (++reads > 2 ? Number.NaN : 10000) });
  const out = await core.callModel(request(), r.deps);
  const big = rig(async () => ({ ...OK, text: 'x'.repeat(1000001) }));
  const bigOut = await core.callModel(request(), big.deps);
  return out.ok === true && r.records[0].at === new Date(10000).toISOString() && bigOut.ok === false && bigOut.refusal.code === 'RESPONSE_INVALID' && big.records.length === 1;
});

// PP-35: simultaneous calls with one key share one call, and a waiter is held to the grant and the terms.
await expectIt('PP-35', async () => {
  let release = () => undefined;
  const gate = new Promise((resolve) => { release = resolve; });
  const r = rig(async () => { await gate; return OK; });
  const req = request();
  const a = core.callModel(req, r.deps);
  const b = core.callModel(req, r.deps);
  release();
  const [x, y] = await Promise.all([a, b]);
  const later = rig(async () => { throw new core.ModelCallError('invalid_request', 'bad'); });
  await core.callModel(request(), later.deps);
  await core.callModel(request(), later.deps);
  return r.calls.length === 1 && r.records.length === 1 && x.ok === true && y.ok === true && [x, y].filter((o) => o.replayed).length === 1 && later.calls.length === 2;
});
await expectIt('PP-35', async () => {
  let release = () => undefined;
  const gate = new Promise((resolve) => { release = resolve; });
  let asked = 0;
  const r = rig(async () => { await gate; return OK; }, { grant: () => ++asked === 1 });
  const a = core.callModel(request(), r.deps);
  const b = core.callModel(request(), r.deps);
  const c = core.callModel(request({ budget: { maxMicroUsd: 900000 } }), r.deps);
  release();
  const [x, y, z] = await Promise.all([a, b, c]);
  return x.ok === true && y.ok === false && y.refusal.code === 'NO_GRANT' && z.ok === false && z.refusal.code === 'IDEMPOTENCY_MISMATCH' && r.calls.length === 1;
});

// PP-36: an unknown outcome stays unknown, and is reported before any refusal that could hide it.
await expectIt('PP-36', async () => {
  const r = rig(async (provider, n) => { throw n === 1 ? unsure() : limited(); });
  const out = await core.callModel(request(), r.deps);
  const b = rig(async () => { throw unsure(); });
  await core.callModel(request(lone), b.deps);
  const exhausted = await core.callModel(request(lone), b.deps);
  const budget = rig(async () => { throw unsure(); });
  const spent = await core.callModel(request({ ...lone, budget: { maxMicroUsd: 5000 } }), budget.deps);
  return out.ok === false && out.refusal.code === 'OUTCOME_UNKNOWN' && r.calls.length === 3 && r.calls.every((p) => p === 'primary') && exhausted.ok === false && exhausted.refusal.code === 'OUTCOME_UNKNOWN' && spent.ok === false && spent.refusal.code === 'OUTCOME_UNKNOWN' && budget.calls.length === 2;
});

// PP-37: the store refuses a new key past its bound per tenant and project, and never forgets one.
await expectIt('PP-37', async () => {
  const store = core.createMemoryAttemptStore({ maxKeysPerScope: 2 });
  for (let i = 0; i < 5; i += 1) await store.begin(SCOPE, KEY('a'), 'f');
  await store.begin(SCOPE, KEY('b'), 'f');
  let full = false;
  try {
    await store.begin(SCOPE, KEY('c'), 'f');
  } catch (error) {
    full = error instanceof core.AttemptStoreFull;
  }
  const other = await store.begin({ tenant: 'other-co', project: 'alpha-project' }, KEY('c'), 'f');
  return full && (await store.count(SCOPE, KEY('a'))) === 5 && (await store.begin(SCOPE, KEY('a'), 'f')) === 6 && other === 1;
});
await expectIt('PP-37', async () => {
  const r = rig(async () => OK, { attempts: core.createMemoryAttemptStore({ maxKeysPerScope: 1 }) });
  await core.callModel(request({ requestId: 'a' }), r.deps);
  const full = await core.callModel(request({ requestId: 'b' }), r.deps);
  const other = await core.callModel(request({ requestId: 'b', tenant: 'other-co' }), r.deps);
  return full.ok === false && full.refusal.code === 'STORE_FULL' && other.ok === true;
});

// PP-38: the same key with other terms is refused, a replay is held to the grant and labelled as the original's, and a billed refusal is replayed too.
await expectIt('PP-38', async () => {
  const r = rig(async () => OK);
  await core.callModel(request(), r.deps);
  const key = request().idempotencyKey;
  let all = true;
  for (const change of [{ chain: [{ provider: 'backup', model: 'small' }] }, { maxOutputTokens: 400 }, { phaseId: 'PHASE-2' }, { budget: { maxMicroUsd: 900000 } }]) {
    const out = await core.callModel(request({ ...change, idempotencyKey: key }), r.deps);
    all = all && out.ok === false && out.refusal.code === 'IDEMPOTENCY_MISMATCH';
  }
  const replay = await core.callModel(request(), r.deps);
  const denied = rig(async () => OK, { attempts: r.deps.attempts, grant: () => false });
  const d = await core.callModel(request(), denied.deps);
  return all && r.calls.length === 1 && replay.ok === true && replay.replayed === true && replay.costMicroUsd === 0 && replay.attempts === 0 && replay.original.costMicroUsd === 200 && replay.original.attempts === 1 && d.ok === false && d.refusal.code === 'NO_GRANT';
});
await expectIt('PP-38', async () => {
  const r = rig(async () => ({ ...OK, text: 'x'.repeat(1000001) }));
  const first = await core.callModel(request(), r.deps);
  const again = await core.callModel(request(), r.deps);
  return first.ok === false && again.ok === false && again.refusal.replayed === true && r.calls.length === 1 && r.records.length === 1;
});
await expectIt('PP-38', async () => {
  const base = { chain: [{ provider: 'a', model: 'm' }], maxOutputTokens: 10, phaseId: 'P', budget: { maxMicroUsd: 100 } };
  const fp = core.fingerprintOf(base);
  return [{ chain: [{ provider: 'b', model: 'm' }] }, { maxOutputTokens: 11 }, { phaseId: 'Q' }, { budget: { maxMicroUsd: 101 } }].every((change) => core.fingerprintOf({ ...base, ...change }) !== fp);
});

// PP-39: a bad clock refuses the call before any spend, and the route choice fails closed on it.
await expectIt('PP-39', async () => {
  let reads = 0;
  const r = rig(async () => OK, { clock: () => (++reads > 1 ? Number.NaN : 10000) });
  const out = await core.callModel(request(), r.deps);
  const choice = core.chooseRoute({ registry: registryOf({ name: 'a', kind: 'hosted', api: 'openai-completions' }), cooldowns: core.NO_COOLDOWNS, pricing: tableOf(price('a', 'm1')), nowMs: Number.NaN, promptTokens: 1, tried: new Set(), chain: [{ provider: 'a', model: 'm1' }] });
  return out.ok === false && out.refusal.code === 'REQUEST_INVALID' && r.calls.length === 0 && choice.ok === false;
});

console.log(JSON.stringify({ count, failed: [...failed].sort() }));
`;

const M = (name, rule, rel, from, to, also = []) => ({ name, rule, rel, from, to, also });
const B = (name, rule, rel, from, to, also = [], more = []) => ({ name, rule, rel, from, to, also, more });
const FIRST_NOTICE = "Source-Path: packages/retry/src/index.ts\n";
const TEST_CALL = "projectos/core/test/modelBroker-call.test.ts";
const TEST_ENDPOINTS = "projectos/core/test/modelBroker-endpoints.test.ts";

const MUTATIONS = [
  M("a-stray-file-lands-in-core-broker", "PP-1", LISTING, `${RETRY}\n`, `${RETRY}\n${core("stray.ts")}\n`),
  M("a-listed-file-goes-missing", "PP-1", LISTING, `${AGENT_BARREL}\n`, ""),
  M("a-listed-file-is-not-tracked", "PP-1", TRACKED, `${core("fallback.ts")}\n`, ""),
  M("a-header-names-a-different-upstream-file", "PP-2", RETRY, "packages/retry/src/index.ts\n", "packages/retry/src/other.ts\n", ["PP-4"]),
  M("a-second-upstream-file-loses-its-credit", "PP-2", TIERS, "; packages/model-catalog-core/src/model-catalog-pricing.ts", ""),
  M("a-header-drops-the-pi-credit", "PP-2", RETRY, "// Also-Credits: pi-mono", "// Also-Credit: pi-mono", ["PP-4"]),
  M("a-header-stops-saying-what-changed", "PP-2", TRANSPORT, "CHANGED: ", "Changes: "),
  M("a-header-moves-to-another-commit", "PP-2", COOLDOWN, HERMES, "0".repeat(40), ["PP-4"]),
  M("a-hermes-file-claims-openclaw", "PP-2", COOLDOWN, "// Ported-From: hermes-agent ", "// Ported-From: openclaw ", ["PP-4"]),
  M("an-original-file-loses-its-mark", "PP-3", FALLBACK, `${ORIGIN_LINE}\n`, "", ["PP-4"]),
  M("the-mark-moves-below-the-first-line", "PP-3", CALL, `${ORIGIN_LINE}\n`, `// Note.\n${ORIGIN_LINE}\n`),
  M("a-notices-entry-goes-missing", "PP-4", NOTICES_REL, FIRST_NOTICE, "Source-Path: packages/retry/src/gone.ts\n"),
  M("core-imports-the-file-system", "PP-5", POLICY, "import { CONNECTOR_MAX_ATTEMPTS } from '../connectorContract.js';", "import { CONNECTOR_MAX_ATTEMPTS } from '../connectorContract.js';\nimport { readFileSync } from 'node:fs';"),
  M("core-reads-the-clock", "PP-5", CALL, "const MAX_CHAIN = 8;", "const MAX_CHAIN = 8;\nconst bootTime = Date.now();"),
  M("core-reads-a-random-source", "PP-5", RETRY, "const runtimeRandom = runtime.random;", "const runtimeRandom = () => Math.random();"),
  M("core-arms-a-timer", "PP-5", RETRY, "const runtimeSleep = runtime.sleep;", "const runtimeSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));"),
  M("core-imports-another-module", "PP-5", FALLBACK, "from './cooldown.js'", "from '../workers.js'"),
  M("core-parses-an-address-with-url", "PP-5", ENDPOINTS, "const split = /^(https?)", "const alias = new URL(String(address));\n  const split = /^(https?)"),
  M("the-agent-imports-the-file-system", "PP-6", CONFIG, "import { COMMIT_SHA,", "import { readFileSync } from 'node:fs';\nimport { COMMIT_SHA,"),
  M("the-agent-opens-a-socket", "PP-6", LOCAL, "export const MAX_LOCAL_MODELS = 100;", "export const MAX_LOCAL_MODELS = 100;\nconst probe = fetch('http://example.test');"),
  M("the-agent-reads-the-environment", "PP-6", LOCAL, "export const MAX_LOCAL_MODELS = 100;", "export const MAX_LOCAL_MODELS = process.cwd().length + 100;"),
  M("the-agent-gains-a-dependency", "PP-7", AGENT_PACKAGE_REL, `"@projectos/core": "file:../core"`, `"@projectos/core": "file:../core",\n    "openai": "5.0.0"`),
  M("core-gains-a-dependency", "PP-7", CORE_PACKAGE_REL, `"devDependencies": {`, `"dependencies": { "undici": "7.0.0" },\n  "devDependencies": {`),
  M("an-xai-adapter-arrives", "PP-8", CALL, "export const MODEL_CALL_CLASS", "export const XAI_BASE_URL = 'https://api.x.ai/v1';\nexport const MODEL_CALL_CLASS"),
  M("a-grok-model-is-named", "PP-8", ROUTES, "export const routeKeyOf", "export const GROK_DEFAULT = 'grok-4';\nexport const routeKeyOf"),
  M("the-xai-refusal-goes", "PP-8", REGISTRY, "NOT_PORTED.test(value)", "false"),
  M("the-xai-pattern-matches-inside-words", "PP-8", REGISTRY, "const NOT_PORTED = /(?:^|[^a-z0-9])(?:xai|x-ai|x\\.ai)(?![a-z0-9])|(?:^|[^a-z0-9])grok/i;", "const NOT_PORTED = /xai|x-ai|x\\.ai|grok/i;"),
  M("a-missing-budget-is-allowed", "PP-9", CALL, "return isCount(maxMicroUsd, 1) ? maxMicroUsd : null;", "return typeof maxMicroUsd === 'number' ? maxMicroUsd : 1;"),
  M("a-zero-budget-is-allowed", "PP-9", CALL, "return isCount(maxMicroUsd, 1) ? maxMicroUsd : null;", "return isCount(maxMicroUsd, 0) ? maxMicroUsd : null;"),
  M("a-fractional-budget-is-allowed", "PP-9", CALL, "Number.isSafeInteger(value) && value >= min;", "Number.isFinite(value) && value >= min;"),
  M("the-budget-check-is-dropped", "PP-9", CALL, "  if (cap === null) return refuse('BUDGET_REQUIRED', 'a model call needs a budget: whole micro-USD, above zero');\n", ""),

  M("the-transport-is-reached-from-a-second-place", "PP-9", CALL, "async function granted(", "const sneak = (deps: ModelBrokerDeps) => deps.transport({} as never);\nasync function granted("),
  M("any-grant-answer-passes", "PP-10", CALL, "return (await deps.grant(request)) === true;", "return Boolean(await deps.grant(request));"),
  M("a-throwing-grant-passes", "PP-10", CALL, "  } catch {\n    return false;", "  } catch {\n    return true;"),
  M("the-grant-is-not-asked", "PP-10", CALL, "if (!(await granted(request, deps))) return refuse('NO_GRANT'", "if (!(await granted(request, deps)) && false) return refuse('NO_GRANT'", ["PP-35"]),
  M("the-class-is-not-p3", "PP-10", CALL, "export const MODEL_CALL_CLASS = 'P3' as const;", "export const MODEL_CALL_CLASS = 'P2' as const;"),
  M("the-floor-drops-to-zero", "PP-11", POLICY, "export const BACKOFF_FLOOR_MS = RETRY_FLOOR_MS;", "export const BACKOFF_FLOOR_MS = 0;"),
  M("the-request-may-go-below-the-floor", "PP-11", POLICY, "Math.max(merged.minDelayMs, BACKOFF_FLOOR_MS)", "merged.minDelayMs"),
  M("the-default-delay-is-not-the-floor", "PP-11", POLICY, "minDelayMs: BACKOFF_FLOOR_MS, maxDelayMs: 30_000", "minDelayMs: 0, maxDelayMs: 30_000"),
  M("the-max-delay-may-undercut-the-min", "PP-11", POLICY, "maxDelayMs: Math.min(Math.max(merged.maxDelayMs, minDelayMs), BACKOFF_CEILING_MS),", "maxDelayMs: merged.maxDelayMs,"),
  M("the-config-is-not-the-brokers", "PP-11", POLICY, "...brokerRetryConfig(options.requested),", "...(options.requested ?? {}),"),
  M("the-final-clamp-goes", "PP-11", RETRY, "delay = Math.min(Math.max(delay, minDelayMs), delayCap);", "delay = Math.min(delay, delayCap);"),
  M("a-provider-hint-skips-the-floor", "PP-11", RETRY, "? Math.max(retryAfterMs, minDelayMs)", "? retryAfterMs"),
  M("a-configured-delay-skips-the-floor", "PP-11", RETRY, ": Math.max(resolvedConfiguredDelay, minDelayMs);", ": resolvedConfiguredDelay;"),
  M("the-cap-is-not-applied", "PP-12", POLICY, "attempts: Math.min(merged.attempts, MAX_MODEL_ATTEMPTS, RETRY_ATTEMPT_CEILING),", "attempts: merged.attempts,"),
  M("the-cap-is-ours-and-higher", "PP-12", POLICY, "export const MAX_MODEL_ATTEMPTS = CONNECTOR_MAX_ATTEMPTS;", "export const MAX_MODEL_ATTEMPTS = 50;"),
  M("an-exhausted-key-still-calls", "PP-12", CALL, "if (attempt > MAX_MODEL_ATTEMPTS) throw new AttemptsExhausted();", ""),
  M("an-exhausted-key-is-a-plain-failure", "PP-12", CALL, "if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED'", "if (false) return refuse('ATTEMPTS_EXHAUSTED'", ["PP-36"]),
  M("the-runner-ignores-the-attempt-limit", "PP-12", RETRY, "if (attempt >= maxAttempts || runtime.shouldRetry?.(err) === false || !shouldRetry(err, attempt)) {", "if (runtime.shouldRetry?.(err) === false || !shouldRetry(err, attempt)) {"),
  M("the-request-carries-a-history", "PP-13", CALL, "  readonly requestId: string;\n  readonly project: string;", "  readonly requestId: string;\n  readonly attemptHistory?: readonly number[];\n  readonly project: string;"),
  M("the-call-reads-a-count-from-the-request", "PP-13", CALL, "const attempt = await deps.attempts.begin(run.scope, request.idempotencyKey, run.fingerprint);", "const attempt = (request as unknown as { attempts: number }).attempts ?? await deps.attempts.begin(run.scope, request.idempotencyKey, run.fingerprint);", ["PP-12"]),
  M("the-store-is-bypassed", "PP-13", CALL, "readonly attempts: AttemptStore;", "readonly attempts: { begin(scope: AttemptScope, key: string): Promise<number> };"),
  M("a-fresh-spelling-starts-a-fresh-count", "PP-13", POLICY, "if (!isModelIdempotencyKey(key)) throw new Error('that is not an idempotency key');", "if (typeof key !== 'string') throw new Error('that is not an idempotency key');"),
  M("the-count-restarts-each-call", "PP-13", POLICY, "count: (held?.count ?? 0) + 1, outcome: held?.outcome ?? null });", "count: 1, outcome: held?.outcome ?? null });"),
  M("the-key-is-not-checked-at-the-door", "PP-13", CALL, "if (!isModelIdempotencyKey(request.idempotencyKey)) return", "if (false) return"),
  M("an-attempt-is-not-checked-against-the-budget", "PP-14", CALL, "      if (run.reserved + worst > run.cap) throw new BudgetExhausted();\n", ""),
  M("an-attempt-reserves-nothing", "PP-14", CALL, "      run.reserved += worst;\n", ""),
  M("the-first-attempt-is-not-checked", "PP-14", CALL, "    if (run.reserved + worst > run.cap) {", "    if (false) {"),
  M("budget-exhaustion-is-a-plain-failure", "PP-14", CALL, "if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET'", "if (false) return refuse('OVER_BUDGET'", ["PP-36"]),
  M("the-budget-check-moves-after-the-store", "PP-14", CALL, "      if (run.reserved + worst > run.cap) throw new BudgetExhausted();\n      const attempt = await deps.attempts.begin(run.scope, request.idempotencyKey, run.fingerprint);\n", "      const attempt = await deps.attempts.begin(run.scope, request.idempotencyKey, run.fingerprint);\n      if (run.reserved + worst > run.cap) throw new BudgetExhausted();\n"),
  M("a-price-needs-no-commit", "PP-15", PRICING, "!COMMIT_SHA.test(committed.commit)", "false"),
  M("any-text-is-a-commit", "PP-15", PRICING, "export const COMMIT_SHA = /^[0-9a-f]{40}$/;", "export const COMMIT_SHA = /^.*$/;"),
  M("a-bad-row-is-skipped-not-refused", "PP-15", PRICING, "  if (problems.length > 0) return { ok: false, problems };\n  if (entries.size === 0)", "  if (entries.size === 0)"),
  M("a-duplicate-model-overwrites", "PP-15", PRICING, "if (entries.has(key)) problems.push(", "if (false) problems.push("),
  M("another-schema-is-read", "PP-15", PRICING, "parsed['schema'] !== PRICING_SCHEMA", "false"),
  M("an-unpriced-model-is-priced-at-zero", "PP-15", PRICING, "if (entry === undefined) return { ok: false, reason: 'unpriced'", "if (false) return { ok: false, reason: 'unpriced'"),
  M("a-price-with-many-decimals-passes", "PP-15", PRICING, "Math.abs(scaled - whole) > 1e-3 || !Number.isSafeInteger(whole) ? null : whole;", "Number.isSafeInteger(whole) ? whole : null;"),
  M("a-zero-price-passes", "PP-15", PRICING, "if (!(rates.input > 0) || !(rates.output > 0))", "if (false)"),
  M("an-unknown-price-field-passes", "PP-15", PRICING, "!ENTRY_KEYS.has(key)", "false"),
  M("a-working-tree-read-is-accepted", "PP-15", CONFIG, "typeof found.commit === 'string' && COMMIT_SHA.test(found.commit)", "typeof found.commit === 'string'"),
  M("a-path-can-leave-the-repository", "PP-15", CONFIG, "!path.split('/').some((segment) => segment === '.' || segment === '..')", "true"),
  M("the-path-shape-is-open", "PP-15", CONFIG, String.raw`CONFIG_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/;`, "CONFIG_PATH = /^.*$/;"),
  M("one-missing-file-is-ignored", "PP-15", CONFIG, "if (typeof pricingText === 'string' || typeof registryText === 'string') return { ok: false, problems };", ""),
  M("the-call-prices-from-somewhere-else", "PP-15", CALL, "pricing: deps.pricing", "pricing: ({ entries: new Map() } as never)"),
  M("a-rate-card-of-our-own", "PP-16", PRICING, "export interface CommittedText {", "interface RateCard { readonly model: string }\nexport interface CommittedText {"),
  M("the-ledger-import-goes", "PP-16", PRICING, "import { rateCardProblems, type RateCard } from '../gatekeeperCostLedger.js';", "import { rateCardProblems } from '../gatekeeperCostLedger.js';\ntype RateCard = Parameters<typeof rateCardProblems>[0];"),
  M("the-card-is-not-checked-by-the-ledger", "PP-16", PRICING, "const problems = rateCardProblems(rate);", "const problems: string[] = [];"),
  M("the-ledger-record-is-hand-made", "PP-16", CALL, "const entry = recordCall({ requestId: request.requestId, projectId: request.project, phaseId: request.phaseId, usage, rate, at: isoNow(run) });", "const entry = { requestId: request.requestId, projectId: request.project, phaseId: request.phaseId, at: isoNow(run), model: rate.model, usage, costMicroUsd: 0 };"),
  M("the-worst-case-is-not-the-ledgers", "PP-16", CALL, "const worst = estimateCostMicroUsd({ inputTokens: run.inputTokens, outputTokens: request.maxOutputTokens }, route.rate);", "const worst = run.inputTokens + request.maxOutputTokens;"),
  M("cache-writes-are-priced-as-input", "PP-17", PRICING, "const input = microOf(Math.max(rates.input, rates.cacheWrite));", "const input = microOf(rates.input);"),
  M("a-free-cache-is-free", "PP-17", PRICING, "...(cached > 0 ? { cachedInputMicroUsdPerMillion: cached } : {})", "cachedInputMicroUsdPerMillion: cached"),
  M("cache-writes-are-left-out-of-the-cost", "PP-17", CALL, "inputTokens: result.usage.input + result.usage.cacheWrite", "inputTokens: result.usage.input"),
  M("the-actual-tier-is-not-used", "PP-17", CALL, "const actual = rateCardFor(deps.pricing, route.provider, route.model, promptTokensOf(result.usage));", "const actual = { ok: false } as ReturnType<typeof rateCardFor>;"),
  M("a-tier-gap-is-not-covered", "PP-17", TIERS, "return matched ?? [...sorted].reverse().find((tier) => promptTokens >= tier.range[0]) ?? sorted[0] ?? cost;", "return matched ?? cost;"),
  M("two-tiers-at-one-threshold-pass", "PP-17", TIERS, "if (next === tier.size) {", "if (false) {"),
  M("a-spelling-opens-the-registry", "PP-18", FALLBACK, "if (record === undefined || record.name !== entry.provider) return { reason: 'not-registered' };", "if (record === undefined) return { reason: 'not-registered' };"),
  M("an-unregistered-provider-is-called", "PP-18", FALLBACK, "if (record === undefined || record.name !== entry.provider) return { reason: 'not-registered' };", "if (false) return { reason: 'not-registered' };"),
  M("a-tried-route-is-tried-again", "PP-18", FALLBACK, "if (params.tried.has(routeKeyOf(entry))) return { reason: 'already-tried' };", ""),
  M("an-unpriced-route-is-chosen", "PP-18", FALLBACK, "if (!priced.ok) return { reason: 'unpriced' };", ""),
  M("the-registry-is-not-frozen", "PP-18", REGISTRY, "const registry: ProviderRegistry = Object.freeze({", "const registry: ProviderRegistry = ({"),
  M("a-duplicate-provider-overwrites", "PP-18", REGISTRY, "if (byKey.has(key)) problems.push(", "if (false) problems.push("),
  M("a-bad-registry-is-built-anyway", "PP-18", REGISTRY, "  if (problems.length > 0) return { ok: false, problems };\n  const sorted", "  const sorted"),
  M("any-spelling-names-a-provider", "PP-18", REGISTRY, "const PROVIDER_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;", "const PROVIDER_NAME = /^.*$/;"),
  M("the-chain-is-not-the-requests-registry", "PP-18", CALL, "chain: request.chain, registry: deps.registry", "chain: request.chain, registry: ({ get: (name: string) => ({ name, kind: 'hosted', api: 'openai-completions' }), has: () => true, list: () => [], size: 0 } as never)"),
  M("the-cooldown-never-ends", "PP-19", COOLDOWN, "return until !== undefined && until > nowMs;", "return until !== undefined;"),
  M("the-cooldown-ends-late", "PP-19", COOLDOWN, "return until !== undefined && until > nowMs;", "return until !== undefined && until >= nowMs;"),
  M("every-failure-arms-a-cooldown", "PP-19", COOLDOWN, "if (!RATE_LIMIT_FAILOVER_REASONS.includes(reason)) return { state, cooldownSeconds: null };", ""),
  M("the-cooldown-has-no-ceiling", "PP-19", COOLDOWN, "declared === null ? Math.min(COOLDOWN_BASE_SECONDS * 2 ** level, COOLDOWN_MAX_SECONDS) : Math.min(Math.max(Math.ceil(declared), COOLDOWN_BASE_SECONDS), COOLDOWN_MAX_SECONDS);", "declared === null ? COOLDOWN_BASE_SECONDS * 2 ** level : Math.ceil(declared);"),
  M("the-cooldown-does-not-grow", "PP-19", COOLDOWN, "Math.min(COOLDOWN_BASE_SECONDS * 2 ** level, COOLDOWN_MAX_SECONDS)", "COOLDOWN_BASE_SECONDS"),
  M("the-ceiling-is-a-week", "PP-19", COOLDOWN, "export const COOLDOWN_MAX_SECONDS = 14_400;", "export const COOLDOWN_MAX_SECONDS = 604_800;"),
  M("the-cooldown-starts-in-the-wrong-unit", "PP-19", COOLDOWN, "nowMs + cooldownSeconds * 1000", "nowMs + cooldownSeconds"),
  M("a-past-reset-is-honoured", "PP-19", COOLDOWN, "return Number.isFinite(delay) && delay > 0 ? delay : null;", "return Number.isFinite(delay) ? delay : null;"),
  M("a-cooling-provider-is-chosen", "PP-19", FALLBACK, "if (isCoolingDown(params.cooldowns, record.name, params.nowMs)) return { reason: 'cooling-down' };", ""),
  M("a-limit-arms-nothing", "PP-19", CALL, "run.deps.cooldowns.set(run.scope, armed.state);", ""),
  M("an-answer-does-not-clear-the-level", "PP-19", CALL, "deps.cooldowns.set(run.scope, clearCooldown(deps.cooldowns.get(run.scope), route.provider));", ""),
  M("an-alias-host-is-loopback", "PP-20", ENDPOINTS, "(part.length > 1 && part.startsWith('0') ? Number.NaN : Number(part))", "Number(part)"),
  M("any-octet-count-is-loopback", "PP-20", ENDPOINTS, "octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)", "true"),
  M("the-whole-127-block-is-not-checked", "PP-20", ENDPOINTS, "return octets !== null && octets[0] === 127;", "return octets !== null && octets[0] === 127 || octets !== null && octets[0] === 0;"),
  M("ipv6-loopback-goes", "PP-20", ENDPOINTS, "if (host === '[::1]' || host === '::1') return true;", ""),
  M("userinfo-is-allowed", "PP-20", ENDPOINTS, "if (authority.includes('@')) return { ok: false, problem: 'the address carries credentials' };", ""),
  M("a-query-is-allowed", "PP-20", ENDPOINTS, "if (!PATH.test(rest)) return { ok: false, problem: 'the address carries a query or a fragment' };", ""),
  M("a-port-is-not-range-checked", "PP-20", ENDPOINTS, "if (port !== null && !(port >= 1 && port <= 65535))", "if (false)"),
  M("a-non-loopback-host-is-local", "PP-20", ENDPOINTS, "return isLoopbackHost(parsed.value.host) ? null : 'the host is not a loopback address';", "return null;"),
  M("a-local-record-skips-the-rule", "PP-20", ENDPOINTS, "return localEndpointProblem(record.baseUrl);", "return null;"),
  M("the-registry-skips-the-endpoint-rule", "PP-20", REGISTRY, "const endpoint = endpointProblem({ kind: kind as ProviderKind, baseUrl });", "const endpoint = null as string | null;"),
  M("the-port-is-reached-before-the-rule", "PP-20", LOCAL, "  const problem = localEndpointProblem(endpoint.baseUrl);\n  if (problem !== null) return { baseUrl: endpoint.baseUrl, status: 'refused', reason: problem };\n  try {\n    const answer = await getJson(", "  try {\n    const answer = await getJson("),
  M("a-refused-address-is-not-reported", "PP-20", LOCAL, "if (problem !== null) return { baseUrl: endpoint.baseUrl, status: 'refused', reason: problem };", "if (problem !== null) return { baseUrl: endpoint.baseUrl, status: 'unreachable', reason: problem };"),
  M("a-key-field-is-allowed", "PP-21", REGISTRY, "const RECORD_KEYS = new Set(['name', 'kind', 'api', 'baseUrl', 'credentialRef']);", "const RECORD_KEYS = new Set(['name', 'kind', 'api', 'baseUrl', 'credentialRef', 'apiKey']);"),
  M("unknown-fields-are-allowed", "PP-21", REGISTRY, ".filter((key) => !RECORD_KEYS.has(key))", ".filter(() => false)"),
  M("a-long-secret-is-a-reference", "PP-21", REGISTRY, "LONG_ALNUM_RUN.test(credentialRef)", "false"),
  M("a-key-prefix-is-a-reference", "PP-21", REGISTRY, "KEY_PREFIX.test(credentialRef)", "false"),
  M("a-reference-may-be-anything", "PP-21", REGISTRY, "const CREDENTIAL_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;", "const CREDENTIAL_REF = /^.*$/;"),
  M("a-credential-pool-arrives", "PP-21", CALL, "export const MODEL_CALL_CLASS", "export const credentialPool: string[] = [];\nexport const MODEL_CALL_CLASS"),
  M("keys-rotate-round-a-cap", "PP-21", FALLBACK, "export type RouteSkipReason", "export const rotateKeys = true;\nexport type RouteSkipReason"),
  M("the-core-barrel-drops-the-broker", "PP-22", CORE_BARREL_REL, "export * from './modelBroker/index.js';\n", ""),
  M("the-broker-barrel-drops-the-call", "PP-22", BARREL, "callModel, ", ""),
  M("the-broker-barrel-drops-the-floor", "PP-22", BARREL, "  BACKOFF_FLOOR_MS,\n", ""),
  M("the-agent-barrel-drops-the-loader", "PP-22", AGENT_BARREL, "loadCommittedBrokerConfig, ", ""),
  M("validate-all-omits-this-validator", "PP-23", VA_REL, `  "${THIS_VALIDATOR}"`, `  "${THIS_VALIDATOR}-disabled"`),
  M("cached-runner-omits-this-validator", "PP-23", CR_REL, `  "${THIS_VALIDATOR}"`, `  "${THIS_VALIDATOR}-disabled"`),
  M("validate-all-comments-this-validator-out", "PP-23", VA_REL, `  "${THIS_VALIDATOR}"`, `  // "${THIS_VALIDATOR}"`),
  M("an-agent-file-imports-the-broker", "PP-24", IMPORTERS, `${CORE_BARREL_REL}\n`, `${CORE_BARREL_REL}\nprojectos/agent/src/loop/runner.ts\n`),
  M("the-barrel-line-goes-and-the-record-with-it", "PP-24", IMPORTERS, `${CORE_BARREL_REL}\n`, ""),
  M("an-answer-with-no-usage-is-free", "PP-25", CALL, "const unreadable = usageProblem(result?.usage) ??", "const unreadable = null as string | null; void "),
  M("an-unreadable-answer-is-not-recorded", "PP-25", CALL, "    costMicroUsd: worst,\n    at: isoNow(run),", "    costMicroUsd: 0,\n    at: isoNow(run),"),
  M("an-unreadable-answer-is-accepted", "PP-25", CALL, "  if (unreadable !== null) {\n    // The provider answered", "  if (false) {\n    // The provider answered"),
  M("a-negative-count-is-usage", "PP-25", TRANSPORT, "if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return", "if (typeof value !== 'number') return"),
  M("an-unknown-failure-is-retried", "PP-26", CALL, "const RETRY_REASONS: readonly FailoverReason[] = ['rate_limit', 'upstream_rate_limit', 'upstream_unavailable', 'may_have_acted'];", "const RETRY_REASONS: readonly FailoverReason[] = ['rate_limit', 'upstream_rate_limit', 'upstream_unavailable', 'may_have_acted', 'unknown'];"),
  M("an-auth-failure-falls-back", "PP-26", CALL, "const FALLBACK_REASONS: readonly FailoverReason[] = ['rate_limit', 'billing', 'upstream_rate_limit', 'upstream_unavailable', 'provider_error'];", "const FALLBACK_REASONS: readonly FailoverReason[] = ['rate_limit', 'billing', 'upstream_rate_limit', 'upstream_unavailable', 'provider_error', 'authentication', 'unknown'];"),
  M("every-failure-is-retried", "PP-26", CALL, "shouldRetry: (err) => isRetryable(err, sent, longestWaitMs),", "shouldRetry: () => true,"),
  M("a-foreign-error-is-a-rate-limit", "PP-26", CALL, "(err instanceof ModelCallError ? err.reason : 'unknown');", "(err instanceof ModelCallError ? err.reason : 'rate_limit');"),
  M("a-failed-call-always-falls-back", "PP-26", CALL, "if (!FALLBACK_REASONS.includes(reason)) return refuse('CALL_FAILED'", "if (false) return refuse('CALL_FAILED'"),
  M("a-custom-endpoint-may-be-http", "PP-27", ENDPOINTS, "if (scheme !== 'https') return 'a custom endpoint must be https';", ""),
  M("a-custom-endpoint-may-be-ipv6", "PP-27", ENDPOINTS, "if (host.startsWith('[')) return", "if (false) return"),
  M("a-custom-endpoint-may-be-this-machine", "PP-27", ENDPOINTS, "if (isLoopbackHost(host) || isNonPublicLiteral(host)) return", "if (false) return"),
  M("a-custom-endpoint-may-be-any-name", "PP-27", ENDPOINTS, "if (!DNS_NAME.test(host)) return", "if (false) return"),
  M("a-private-range-is-public", "PP-27", ENDPOINTS, "a === 10 || a === 127", "a === 127"),
  M("a-hosted-provider-may-name-an-address", "PP-27", ENDPOINTS, "return record.baseUrl === undefined ? null :", "return null; const unused = "),
  M("a-test-is-skipped", "PP-T", TEST_CALL, "it('a caller passing an empty history cannot reset the count'", "it.skip('a caller passing an empty history cannot reset the count'"),
  M("a-proof-is-renamed-away", "PP-T", TEST_ENDPOINTS, "refuses everything else, including names that only look local", "refuses a few things"),
  M("the-estimate-is-the-callers", "PP-28", CALL, "const inputTokens = Math.max(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));", "const inputTokens = request.estimatedInputTokens;"),
  M("the-floor-is-a-ceiling", "PP-28", CALL, "const inputTokens = Math.max(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));", "const inputTokens = Math.min(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));"),
  M("the-tier-is-picked-from-the-claim", "PP-28", CALL, "promptTokens: run.inputTokens, tried", "promptTokens: request.estimatedInputTokens, tried"),
  M("the-ledgers-estimator-is-rewritten", "PP-28", CALL, "import { estimateCostMicroUsd, estimateInputTokensFromText, recordCall, type LedgerEntry, type RateCard } from '../gatekeeperCostLedger.js';", "import { estimateCostMicroUsd, recordCall, type LedgerEntry, type RateCard } from '../gatekeeperCostLedger.js';\nconst estimateInputTokensFromText = (text: string): number => text.length / 100;", ["PP-16"]),
  M("a-made-up-key-is-accepted", "PP-29", CALL, "if (request.idempotencyKey !== bindingKeyOf(request)) return", "if (false) return"),
  M("the-key-ignores-the-tenant", "PP-29", KEYFILE, "${part(fields.tenant)}${part(fields.project)}", "${part(fields.project)}"),
  M("the-key-ignores-the-project", "PP-29", KEYFILE, "${part(fields.project)}${part(fields.requestId)}", "${part(fields.requestId)}"),
  M("the-key-ignores-the-request-id", "PP-29", KEYFILE, "${part(fields.requestId)}${part(sha256Hex(fields.prompt))}", "${part(sha256Hex(fields.prompt))}"),
  M("the-key-ignores-the-prompt", "PP-29", KEYFILE, "${part(fields.requestId)}${part(sha256Hex(fields.prompt))}", "${part(fields.requestId)}"),
  M("the-key-has-no-length-prefix", "PP-29", KEYFILE, "const part = (value: string): string => `${value.length}:${value}`;", "const part = (value: string): string => `${value}`;"),
  M("the-tenant-is-not-checked", "PP-29", CALL, "if (!isTenantId(request.tenant)) return", "if (false) return"),
  M("a-finished-request-calls-again", "PP-29", CALL, "if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);", ""),
  M("an-answer-is-not-remembered", "PP-29", CALL, "await run.deps.attempts.remember(run.scope, run.request.idempotencyKey, run.fingerprint, outcome);", ""),
  M("the-count-ignores-the-tenant-and-project", "PP-29", POLICY, "return `${scopeOf(scope)}/${key}`;", "return key;"),
  M("the-cooldown-book-is-global", "PP-29", CALL, "const at = (scope: AttemptScope): string => `${scope.tenant}/${scope.project}`;", "const at = (scope: AttemptScope): string => 'all';"),
  M("the-scope-is-not-the-requests", "PP-29", CALL, "const scope: AttemptScope = { tenant: request.tenant, project: request.project };", "const scope: AttemptScope = { tenant: 'shared', project: 'shared' };"),
  M("the-key-is-not-sent", "PP-30", CALL, "    idempotencyKey: request.idempotencyKey,\n    provider: route.provider,", "    provider: route.provider,"),
  M("a-retry-needs-no-key", "PP-30", CALL, "  if (!isModelIdempotencyKey(sent.idempotencyKey)) return false;\n", ""),
  M("a-call-that-may-have-acted-falls-back", "PP-36", CALL, "if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN'", "if (false) return refuse('OUTCOME_UNKNOWN'"),
  M("the-transport-request-has-no-key-field", "PP-30", TRANSPORT, "  readonly idempotencyKey: string;\n", ""),
  M("an-error-stop-is-an-ok-answer", "PP-31", CALL, "if (result?.stopReason === 'error' || result?.stopReason === 'aborted') {", "if (false) {"),
  M("the-provider-error-is-not-classed", "PP-31", CALL, "const failure = new ModelCallError('provider_error'", "const failure = new ModelCallError('unknown'"),
  M("the-stop-reason-is-dropped", "PP-31", CALL, "stopReason: result.stopReason,", "stopReason: 'stop',"),
  M("the-success-has-no-stop-reason", "PP-31", CALL, "  readonly stopReason: StopReason;\n", ""),
  M("a-free-failure-keeps-its-reservation", "PP-32", CALL, "if (spent === 0) run.reserved -= worst;", "if (spent === 0) run.reserved -= 0;"),
  M("a-possibly-billed-failure-is-free", "PP-32", CALL, "const spent = KNOWN_FREE_REASONS.includes(reason) ? 0 : worst;", "const spent = 0;"),
  M("a-possibly-billed-failure-is-not-in-the-ledger", "PP-32", CALL, "else await recorded(run.deps, unresolvedEntry(run, route, worst));", ""),
  M("a-failed-attempt-is-not-noted", "PP-32", CALL, "await noteAttempt(run, {", "void ({"),
  M("the-refusal-forgets-its-routes", "PP-32", CALL, "if (routeRun.attempts > 0) failures.push({", "if (false) failures.push({"),
  M("the-refusal-forgets-when-to-return", "PP-32", CALL, "...(retryAtMs === undefined ? {} : { retryAtMs })", ""),
  M("the-unresolved-record-is-not-checked", "PP-32", CALL, "const taken = await recorded(deps, unresolvedEntry(run, route, worst));", "await recorded(deps, unresolvedEntry(run, route, worst));\n    const taken = true;"),
  M("an-outage-is-a-known-free-failure-no-more", "PP-32", CALL, "'billing', 'upstream_unavailable', 'authentication', 'invalid_request'];", "'billing', 'upstream_unavailable', 'authentication', 'invalid_request', 'may_have_acted', 'unknown'];"),
  M("a-long-retry-after-is-waited-out", "PP-33", CALL, "return !(typeof err.retryAfterMs === 'number' && err.retryAfterMs > longestWaitMs);", "return true;"),
  M("the-retry-after-is-not-the-cooldown", "PP-33", CALL, "err.resetAtMs ?? (typeof err.retryAfterMs === 'number' && clockIsUsable(now) ? now + err.retryAfterMs : undefined)", "err.resetAtMs"),
  M("the-longest-wait-is-not-the-brokers", "PP-33", CALL, "const longestWaitMs = brokerRetryConfig(deps.retry).maxDelayMs;", "const longestWaitMs = Number.POSITIVE_INFINITY;"),
  M("a-bad-clock-after-the-spend-throws", "PP-34", CALL, "return new Date(clockIsUsable(now) ? now : run.startedAtMs).toISOString();", "return new Date(now).toISOString();"),
  M("an-answer-has-no-size-cap", "PP-34", CALL, "if (result.text.length > MAX_RESULT_TEXT) return keep(run, refuse('RESPONSE_INVALID'", "if (false) return keep(run, refuse('RESPONSE_INVALID'"),
  M("a-custom-endpoint-may-be-an-internal-name", "PP-27", ENDPOINTS, "if (INTERNAL_SUFFIX.test(host)) return", "if (false) return"),
  M("a-wildcard-dns-name-is-public", "PP-27", ENDPOINTS, "|xip\\.io|lvh\\.me|localtest\\.me|vcap\\.me|lacolhost\\.com|traefik\\.me)", "|xip\\.io)"),
  M("a-grok-model-is-priced", "PP-8", PRICING, "if (isNotPortedName(model) || isNotPortedName(provider))", "if (false)"),
  M("a-grok-model-is-called", "PP-8", CALL, "isNotPortedName(entry.provider) || isNotPortedName(entry.model)", "false"),
  M("the-pattern-is-not-exported", "PP-8", REGISTRY, "export const isNotPortedName = (value: unknown): boolean => typeof value === 'string' && NOT_PORTED.test(value);", "export const isNotPortedName = (value: unknown): boolean => false;"),
  M("the-budget-check-moves-after-the-checks", "PP-9", CALL, "  if (cap === null) return refuse('BUDGET_REQUIRED', 'a model call needs a budget: whole micro-USD, above zero');\n  const problem = requestProblem(request);\n  if (problem !== null) return refuse('REQUEST_INVALID', problem);\n  const startedAtMs = deps.clock();\n  if (!clockIsUsable(startedAtMs)) return refuse('REQUEST_INVALID', 'the clock did not give a time');\n", "  const problem = requestProblem(request);\n  if (problem !== null) return refuse('REQUEST_INVALID', problem);\n  const startedAtMs = deps.clock();\n  if (!clockIsUsable(startedAtMs)) return refuse('REQUEST_INVALID', 'the clock did not give a time');\n  if (cap === null) return refuse('BUDGET_REQUIRED', 'a model call needs a budget: whole micro-USD, above zero');\n"),
  M("a-second-call-with-the-same-key-starts-its-own", "PP-35", CALL, "if (flying !== undefined) return joined(flying, request, deps, fingerprint);", ""),
  M("the-flight-is-never-cleared", "PP-35", CALL, "if (flights.get(place) === flight) flights.delete(place);", ""),
  M("the-flights-are-per-call", "PP-35", CALL, "const flights = FLIGHTS.get(deps.attempts) ?? new Map<string, Flight>();", "const flights = new Map<string, Flight>();"),
  M("a-flight-is-not-recorded", "PP-35", CALL, "flights.set(place, flight);", ""),
  M("a-waiter-skips-the-grant", "PP-35", CALL, "return mismatch();\n  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);\n  return replayOf(await flight.outcome);", "return mismatch();\n  return replayOf(await flight.outcome);"),
  M("a-waiter-with-other-terms-is-served", "PP-38", CALL, "if (flight.fingerprint !== fingerprint) return mismatch();", ""),
  M("the-last-failure-overwrites-the-unknown", "PP-36", CALL, "if (reason === 'may_have_acted') routeRun.mayHaveActed = true;", ""),
  M("the-reason-ignores-the-sticky-flag", "PP-36", CALL, "const reason = routeRun.mayHaveActed ? 'may_have_acted' : (routeRun.reason ?? reasonOf(err));", "const reason = routeRun.reason ?? reasonOf(err);"),
  M("the-unknown-is-checked-after-the-refusals", "PP-36", CALL, "      if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN', 'the call may have been acted on and is not repeated on another provider', { failures });\n      if (err instanceof AttemptStoreFull) return refuse('STORE_FULL', 'this tenant and project hold as many request keys as the store keeps', { failures });\n      if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED', `this key has used its ${MAX_MODEL_ATTEMPTS} attempts`, { failures });\n      if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET', 'the next attempt does not fit inside the budget', { failures });\n", "      if (err instanceof AttemptStoreFull) return refuse('STORE_FULL', 'this tenant and project hold as many request keys as the store keeps', { failures });\n      if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED', `this key has used its ${MAX_MODEL_ATTEMPTS} attempts`, { failures });\n      if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET', 'the next attempt does not fit inside the budget', { failures });\n      if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN', 'the call may have been acted on and is not repeated on another provider', { failures });\n"),
  M("the-store-takes-new-keys-without-end", "PP-37", POLICY, "if (held >= maxKeys) throw new AttemptStoreFull(", "if (false) throw new AttemptStoreFull("),
  M("the-store-bound-is-huge", "PP-37", POLICY, "export const DEFAULT_ATTEMPT_STORE_KEYS = 4096;", "export const DEFAULT_ATTEMPT_STORE_KEYS = 1e12;", ["PP-34"]),
  M("a-full-store-is-a-plain-failure", "PP-37", CALL, "if (err instanceof AttemptStoreFull) return refuse('STORE_FULL'", "if (false) return refuse('STORE_FULL'", ["PP-36"]),
  M("the-store-bound-is-global", "PP-37", POLICY, "const held = perScope.get(scopeOf(scope)) ?? 0;", "const held = entries.size;"),
  M("the-store-does-not-count-its-keys", "PP-37", POLICY, "perScope.set(scopeOf(scope), held + 1);", ""),
  M("the-fingerprint-ignores-the-budget", "PP-38", KEYFILE, "${part(fields.phaseId)}${part(String(fields.budget.maxMicroUsd))}", "${part(fields.phaseId)}"),
  M("the-fingerprint-ignores-the-phase", "PP-38", KEYFILE, "${part(String(fields.maxOutputTokens))}${part(fields.phaseId)}", "${part(String(fields.maxOutputTokens))}"),
  M("the-fingerprint-ignores-the-output-cap", "PP-38", KEYFILE, "${part(routes)}${part(String(fields.maxOutputTokens))}", "${part(routes)}"),
  M("the-fingerprint-ignores-the-chain", "PP-38", KEYFILE, "const routes = fields.chain.map((entry) => `${part(entry.provider)}${part(entry.model)}`).join('|');", "const routes = '';"),
  M("a-different-chain-is-served-the-old-answer", "PP-38", CALL, "if (held !== null && held.fingerprint !== fingerprint) return mismatch();", ""),
  M("the-call-has-no-fingerprint", "PP-38", CALL, "const fingerprint = fingerprintOf(request);", "const fingerprint = 'same';"),
  M("a-replay-is-billed-again-in-its-labels", "PP-38", CALL, "    costMicroUsd: 0,\n    overBudget: false,", "    costMicroUsd: outcome.costMicroUsd,\n    overBudget: false,"),
  M("a-replay-hides-the-original", "PP-38", CALL, "    original: { attempts: outcome.attempts, costMicroUsd: outcome.costMicroUsd, overBudget: outcome.overBudget, recorded: outcome.recorded },\n", ""),
  M("a-replayed-refusal-is-not-marked", "PP-38", CALL, "refusal: { ...outcome.refusal, replayed: true } };", "refusal: { ...outcome.refusal } };"),
  M("a-replay-is-served-before-the-grant", "PP-38", CALL, "  // The grant is asked before anything is served, a replay included.\n  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);\n  const held = await recalled(request, deps, scope);\n  if (held !== null && held.fingerprint !== fingerprint) return mismatch();\n  if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);\n", "  // The grant is asked before anything is served, a replay included.\n  const held = await recalled(request, deps, scope);\n  if (held !== null && held.fingerprint !== fingerprint) return mismatch();\n  if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);\n  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);\n"),
  M("an-oversize-answer-is-not-remembered", "PP-38", CALL, "return keep(run, refuse('RESPONSE_INVALID', `the answer is longer than ${MAX_RESULT_TEXT} characters`, { recorded: wasRecorded }));", "return refuse('RESPONSE_INVALID', `the answer is longer than ${MAX_RESULT_TEXT} characters`, { recorded: wasRecorded });", ["PP-34"]),
  M("a-bad-clock-skips-the-cooldowns", "PP-39", CALL, "    if (!clockIsUsable(nowMs)) return refuse('REQUEST_INVALID', 'the clock did not give a time', { failures });\n", ""),
  M("the-route-choice-trusts-a-bad-clock", "PP-39", FALLBACK, "if (typeof params.nowMs !== 'number' || !Number.isFinite(params.nowMs)) {", "if (false) {"),
  M("a-pin-moved-into-a-comment-does-not-count", "PP-19", COOLDOWN, "return until !== undefined && until > nowMs;", "// return until !== undefined && until > nowMs;\n  return true;"),
];

const BEHAVIOUR_MUTATIONS = [
  B("a-call-with-no-budget-is-sent", "PP-9", CALL, "return isCount(maxMicroUsd, 1) ? maxMicroUsd : null;", "return isCount(maxMicroUsd, 1) ? maxMicroUsd : 1;"),
  B("a-zero-budget-is-sent", "PP-9", CALL, "return isCount(maxMicroUsd, 1) ? maxMicroUsd : null;", "return isCount(maxMicroUsd, 0) ? maxMicroUsd : null;"),
  B("a-call-goes-out-with-no-grant", "PP-10", CALL, "return (await deps.grant(request)) === true;", "return true;", ["PP-35", "PP-38"]),
  B("a-truthy-grant-is-a-grant", "PP-10", CALL, "return (await deps.grant(request)) === true;", "return Boolean(await deps.grant(request));"),
  B("a-retry-waits-no-time-at-all", "PP-11", POLICY, "Math.max(merged.minDelayMs, BACKOFF_FLOOR_MS)", "merged.minDelayMs", [], [[RETRY, "const minDelayMs = Math.max(resolved.minDelayMs, RETRY_FLOOR_MS);", "const minDelayMs = resolved.minDelayMs;"]]),
  B("the-raw-runner-has-no-floor", "PP-11", RETRY, "const minDelayMs = Math.max(resolved.minDelayMs, RETRY_FLOOR_MS);", "const minDelayMs = resolved.minDelayMs;"),
  B("a-random-source-of-nan-skips-the-sleep", "PP-11", RETRY, "if (!Number.isFinite(delay)) delay = minDelayMs;", ""),
  B("a-key-is-retried-without-end", "PP-12", POLICY, "attempts: Math.min(merged.attempts, MAX_MODEL_ATTEMPTS, RETRY_ATTEMPT_CEILING),", "attempts: merged.attempts,", [], [[RETRY, "const maxAttempts = Math.min(resolved.attempts, RETRY_ATTEMPT_CEILING);", "const maxAttempts = resolved.attempts;"]]),
  B("the-raw-runner-has-no-ceiling", "PP-12", RETRY, "const maxAttempts = Math.min(resolved.attempts, RETRY_ATTEMPT_CEILING);", "const maxAttempts = resolved.attempts;"),
  B("an-exhausted-key-keeps-calling", "PP-13", CALL, "      if (attempt > MAX_MODEL_ATTEMPTS) throw new AttemptsExhausted();\n", "", ["PP-12"]),
  B("the-store-count-restarts", "PP-13", POLICY, "count: (held?.count ?? 0) + 1, outcome: held?.outcome ?? null });", "count: 1, outcome: held?.outcome ?? null });", ["PP-12", "PP-37"]),
  B("a-retry-is-not-charged-to-the-budget", "PP-14", CALL, "      run.reserved += worst;\n", "", ["PP-36"]),
  B("an-attempt-ignores-the-budget", "PP-14", CALL, "      if (run.reserved + worst > run.cap) throw new BudgetExhausted();\n", "", ["PP-36"]),
  B("a-price-needs-no-commit", "PP-15", PRICING, "!COMMIT_SHA.test(committed.commit)", "false"),
  B("a-zero-price-is-accepted", "PP-15", PRICING, "if (!(rates.input > 0) || !(rates.output > 0))", "if (false)"),
  B("an-unpriced-model-is-chosen", "PP-15", FALLBACK, "if (!priced.ok) return { reason: 'unpriced' };", "", ["PP-18"]),
  B("a-working-tree-read-passes-for-committed", "PP-15", CONFIG, "typeof found.commit === 'string' && COMMIT_SHA.test(found.commit)", "typeof found.commit === 'string'"),
  B("a-path-leaves-the-repository", "PP-15", CONFIG, "!path.split('/').some((segment) => segment === '.' || segment === '..')", "true"),
  B("the-ledger-record-costs-nothing", "PP-16", CALL, "const entry = recordCall({ requestId: request.requestId, projectId: request.project, phaseId: request.phaseId, usage, rate, at: isoNow(run) });", "const entry = { requestId: request.requestId, projectId: request.project, phaseId: request.phaseId, at: isoNow(run), model: rate.model, usage, costMicroUsd: 0 };", ["PP-17", "PP-38"]),
  B("cache-writes-are-priced-as-input", "PP-17", PRICING, "const input = microOf(Math.max(rates.input, rates.cacheWrite));", "const input = microOf(rates.input);", ["PP-16"]),
  B("the-tier-is-never-selected", "PP-17", TIERS, "  if (!sorted) {", "  if (true) {"),
  B("two-tiers-at-one-threshold-pass", "PP-17", TIERS, "if (next === tier.size) {", "if (false) {"),
  B("any-spelling-names-a-registered-provider", "PP-18", FALLBACK, "if (record === undefined || record.name !== entry.provider) return { reason: 'not-registered' };", "if (record === undefined) return { reason: 'not-registered' };"),
  B("the-registry-takes-a-duplicate", "PP-18", REGISTRY, "if (byKey.has(key)) problems.push(", "if (false) problems.push("),
  B("a-cooling-provider-is-chosen", "PP-19", FALLBACK, "if (isCoolingDown(params.cooldowns, record.name, params.nowMs)) return { reason: 'cooling-down' };", "", ["PP-32", "PP-33"]),
  B("the-cooldown-never-ends", "PP-19", COOLDOWN, "return until !== undefined && until > nowMs;", "return until !== undefined;", ["PP-33"]),
  B("the-cooldown-has-no-ceiling", "PP-19", COOLDOWN, "declared === null ? Math.min(COOLDOWN_BASE_SECONDS * 2 ** level, COOLDOWN_MAX_SECONDS) : Math.min(Math.max(Math.ceil(declared), COOLDOWN_BASE_SECONDS), COOLDOWN_MAX_SECONDS);", "declared === null ? COOLDOWN_BASE_SECONDS * 2 ** level : Math.ceil(declared);"),
  B("a-provider-reset-shortens-the-cooldown", "PP-19", COOLDOWN, "Math.min(Math.max(Math.ceil(declared), COOLDOWN_BASE_SECONDS), COOLDOWN_MAX_SECONDS);", "Math.min(Math.ceil(declared), COOLDOWN_MAX_SECONDS);"),
  B("an-outage-arms-no-cooldown", "PP-19", COOLDOWN, "  if (reason === 'upstream_unavailable') {", "  if (false) {"),
  B("a-limit-arms-no-cooldown", "PP-19", CALL, "run.deps.cooldowns.set(run.scope, armed.state);", "", ["PP-32", "PP-33"]),
  B("every-failure-arms-a-cooldown", "PP-19", COOLDOWN, "if (!RATE_LIMIT_FAILOVER_REASONS.includes(reason)) return { state, cooldownSeconds: null };", ""),
  B("an-alias-host-is-loopback", "PP-20", ENDPOINTS, "(part.length > 1 && part.startsWith('0') ? Number.NaN : Number(part))", "Number(part)"),
  B("any-host-is-local", "PP-20", ENDPOINTS, "return isLoopbackHost(parsed.value.host) ? null : 'the host is not a loopback address';", "return null;"),
  B("the-port-is-reached-before-the-rule", "PP-20", LOCAL, "  const problem = localEndpointProblem(endpoint.baseUrl);\n  if (problem !== null) return { baseUrl: endpoint.baseUrl, status: 'refused', reason: problem };\n", ""),
  B("a-record-may-carry-a-key", "PP-21", REGISTRY, ".filter((key) => !RECORD_KEYS.has(key))", ".filter(() => false)"),
  B("a-secret-is-a-reference", "PP-21", REGISTRY, "LONG_ALNUM_RUN.test(credentialRef)", "false"),
  B("grok-is-a-provider", "PP-8", REGISTRY, "NOT_PORTED.test(value)", "false"),
  B("the-xai-pattern-matches-inside-words", "PP-8", REGISTRY, "const NOT_PORTED = /(?:^|[^a-z0-9])(?:xai|x-ai|x\\.ai)(?![a-z0-9])|(?:^|[^a-z0-9])grok/i;", "const NOT_PORTED = /xai|x-ai|x\\.ai|grok/i;"),
  B("unreadable-usage-costs-nothing", "PP-25", CALL, "    costMicroUsd: worst,\n    at: isoNow(run),", "    costMicroUsd: 0,\n    at: isoNow(run),"),
  B("an-unreadable-answer-is-accepted", "PP-25", TRANSPORT, "if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return", "if (typeof value !== 'number') return", ["PP-32"]),
  B("an-unknown-failure-is-retried", "PP-26", CALL, "shouldRetry: (err) => isRetryable(err, sent, longestWaitMs),", "shouldRetry: () => true,", ["PP-31", "PP-33", "PP-35"]),
  B("a-refused-request-falls-back", "PP-26", CALL, "if (!FALLBACK_REASONS.includes(reason)) return refuse('CALL_FAILED'", "if (false) return refuse('CALL_FAILED'", ["PP-35"]),
  B("a-custom-endpoint-may-be-http", "PP-27", ENDPOINTS, "if (scheme !== 'https') return 'a custom endpoint must be https';", ""),
  B("a-custom-endpoint-may-be-a-bare-name", "PP-27", ENDPOINTS, "if (!DNS_NAME.test(host)) return", "if (false) return"),
  B("the-estimate-is-the-callers", "PP-28", CALL, "const inputTokens = Math.max(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));", "const inputTokens = request.estimatedInputTokens;"),
  B("the-floor-is-a-ceiling", "PP-28", CALL, "const inputTokens = Math.max(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));", "const inputTokens = Math.min(request.estimatedInputTokens, estimateInputTokensFromText(request.prompt));", ["PP-14", "PP-25", "PP-32", "PP-36"]),
  B("a-made-up-key-is-accepted", "PP-29", CALL, "if (request.idempotencyKey !== bindingKeyOf(request)) return", "if (false) return"),
  B("the-key-ignores-the-tenant", "PP-29", KEYFILE, "${part(fields.tenant)}${part(fields.project)}", "${part(fields.project)}"),
  B("the-key-ignores-the-prompt", "PP-29", KEYFILE, "${part(fields.requestId)}${part(sha256Hex(fields.prompt))}", "${part(fields.requestId)}"),
  B("the-key-has-no-length-prefix", "PP-29", KEYFILE, "const part = (value: string): string => `${value.length}:${value}`;", "const part = (value: string): string => `${value}`;"),
  B("a-finished-request-calls-again", "PP-29", CALL, "if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);", "", ["PP-38"]),
  B("an-answer-is-not-remembered", "PP-29", CALL, "await run.deps.attempts.remember(run.scope, run.request.idempotencyKey, run.fingerprint, outcome);", "", ["PP-38"]),
  B("the-count-ignores-the-tenant-and-project", "PP-29", POLICY, "return `${scopeOf(scope)}/${key}`;", "return key;"),
  B("the-cooldown-book-is-global", "PP-29", CALL, "const at = (scope: AttemptScope): string => `${scope.tenant}/${scope.project}`;", "const at = (scope: AttemptScope): string => 'all';"),
  B("the-key-is-not-sent", "PP-30", CALL, "    idempotencyKey: request.idempotencyKey,\n    provider: route.provider,", "    provider: route.provider,", ["PP-12", "PP-13", "PP-14", "PP-36"]),
  B("a-call-that-may-have-acted-falls-back", "PP-36", CALL, "if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN'", "if (false) return refuse('OUTCOME_UNKNOWN'", ["PP-14", "PP-30"]),
  B("an-error-stop-is-an-ok-answer", "PP-31", CALL, "if (result?.stopReason === 'error' || result?.stopReason === 'aborted') {", "if (false) {"),
  B("an-aborted-stop-is-an-ok-answer", "PP-31", CALL, " || result?.stopReason === 'aborted') {", ") {"),
  B("the-stop-reason-is-dropped", "PP-31", CALL, "stopReason: result.stopReason,", "stopReason: 'stop',"),
  B("a-provider-error-does-not-fall-back", "PP-31", CALL, "'upstream_unavailable', 'provider_error'];", "'upstream_unavailable'];"),
  B("a-free-failure-keeps-its-reservation", "PP-32", CALL, "if (spent === 0) run.reserved -= worst;", "if (spent === 0) run.reserved -= 0;"),
  B("a-possibly-billed-failure-is-free", "PP-32", CALL, "const spent = KNOWN_FREE_REASONS.includes(reason) ? 0 : worst;", "const spent = 0;", ["PP-14", "PP-36"]),
  B("a-failed-attempt-is-not-noted", "PP-32", CALL, "await noteAttempt(run, {", "void ({"),
  B("the-refusal-forgets-when-to-return", "PP-32", CALL, "...(retryAtMs === undefined ? {} : { retryAtMs })", ""),
  B("the-refusal-forgets-its-routes", "PP-32", CALL, "if (routeRun.attempts > 0) failures.push({", "if (false) failures.push({"),
  B("the-unresolved-record-is-not-checked", "PP-32", CALL, "const taken = await recorded(deps, unresolvedEntry(run, route, worst));", "await recorded(deps, unresolvedEntry(run, route, worst));\n    const taken = true;"),
  B("a-long-retry-after-is-waited-out", "PP-33", CALL, "return !(typeof err.retryAfterMs === 'number' && err.retryAfterMs > longestWaitMs);", "return true;"),
  B("the-retry-after-is-not-the-cooldown", "PP-33", CALL, "err.resetAtMs ?? (typeof err.retryAfterMs === 'number' && clockIsUsable(now) ? now + err.retryAfterMs : undefined)", "err.resetAtMs"),
  B("a-bad-clock-after-the-spend-throws", "PP-34", CALL, "return new Date(clockIsUsable(now) ? now : run.startedAtMs).toISOString();", "return new Date(now).toISOString();"),
  B("an-answer-has-no-size-cap", "PP-34", CALL, "if (result.text.length > MAX_RESULT_TEXT) return keep(run, refuse('RESPONSE_INVALID'", "if (false) return keep(run, refuse('RESPONSE_INVALID'", ["PP-38"]),
  B("a-custom-endpoint-may-be-an-internal-name", "PP-27", ENDPOINTS, "if (INTERNAL_SUFFIX.test(host)) return", "if (false) return"),
  B("a-grok-model-is-priced", "PP-8", PRICING, "if (isNotPortedName(model) || isNotPortedName(provider))", "if (false)"),
  B("a-grok-model-is-called", "PP-8", CALL, "isNotPortedName(entry.provider) || isNotPortedName(entry.model)", "false"),
  B("a-second-call-with-the-same-key-starts-its-own", "PP-35", CALL, "if (flying !== undefined) return joined(flying, request, deps, fingerprint);", "", []),
  B("the-flight-is-never-cleared", "PP-35", CALL, "if (flights.get(place) === flight) flights.delete(place);", "", ["PP-12", "PP-13"]),
  B("a-waiter-skips-the-grant", "PP-35", CALL, "return mismatch();\n  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);\n  return replayOf(await flight.outcome);", "return mismatch();\n  return replayOf(await flight.outcome);"),
  B("the-last-failure-overwrites-the-unknown", "PP-36", CALL, "if (reason === 'may_have_acted') routeRun.mayHaveActed = true;", "", ["PP-14", "PP-30"]),
  B("the-unknown-is-checked-after-the-refusals", "PP-36", CALL, "      if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN', 'the call may have been acted on and is not repeated on another provider', { failures });\n      if (err instanceof AttemptStoreFull) return refuse('STORE_FULL', 'this tenant and project hold as many request keys as the store keeps', { failures });\n      if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED', `this key has used its ${MAX_MODEL_ATTEMPTS} attempts`, { failures });\n      if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET', 'the next attempt does not fit inside the budget', { failures });\n", "      if (err instanceof AttemptStoreFull) return refuse('STORE_FULL', 'this tenant and project hold as many request keys as the store keeps', { failures });\n      if (err instanceof AttemptsExhausted) return refuse('ATTEMPTS_EXHAUSTED', `this key has used its ${MAX_MODEL_ATTEMPTS} attempts`, { failures });\n      if (err instanceof BudgetExhausted) return refuse('OVER_BUDGET', 'the next attempt does not fit inside the budget', { failures });\n      if (routeRun.mayHaveActed) return refuse('OUTCOME_UNKNOWN', 'the call may have been acted on and is not repeated on another provider', { failures });\n", ["PP-14"]),
  B("the-store-takes-new-keys-without-end", "PP-37", POLICY, "if (held >= maxKeys) throw new AttemptStoreFull(", "if (false) throw new AttemptStoreFull("),
  B("the-store-bound-is-global", "PP-37", POLICY, "const held = perScope.get(scopeOf(scope)) ?? 0;", "const held = entries.size;"),
  B("a-full-store-is-a-plain-failure", "PP-37", CALL, "if (err instanceof AttemptStoreFull) return refuse('STORE_FULL'", "if (false) return refuse('STORE_FULL'"),
  B("a-different-chain-is-served-the-old-answer", "PP-38", CALL, "if (held !== null && held.fingerprint !== fingerprint) return mismatch();", ""),
  B("the-fingerprint-ignores-the-budget", "PP-38", KEYFILE, "${part(fields.phaseId)}${part(String(fields.budget.maxMicroUsd))}", "${part(fields.phaseId)}", ["PP-35"]),
  B("the-fingerprint-ignores-the-chain", "PP-38", KEYFILE, "const routes = fields.chain.map((entry) => `${part(entry.provider)}${part(entry.model)}`).join('|');", "const routes = '';"),
  B("a-replay-is-billed-again-in-its-labels", "PP-38", CALL, "    costMicroUsd: 0,\n    overBudget: false,", "    costMicroUsd: outcome.costMicroUsd,\n    overBudget: false,"),
  B("a-replay-hides-the-original", "PP-38", CALL, "    original: { attempts: outcome.attempts, costMicroUsd: outcome.costMicroUsd, overBudget: outcome.overBudget, recorded: outcome.recorded },\n", ""),
  B("a-replay-is-served-before-the-grant", "PP-38", CALL, "  // The grant is asked before anything is served, a replay included.\n  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);\n  const held = await recalled(request, deps, scope);\n  if (held !== null && held.fingerprint !== fingerprint) return mismatch();\n  if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);\n", "  // The grant is asked before anything is served, a replay included.\n  const held = await recalled(request, deps, scope);\n  if (held !== null && held.fingerprint !== fingerprint) return mismatch();\n  if (held !== null && isOutcome(held.outcome)) return replayOf(held.outcome);\n  if (!(await granted(request, deps))) return refuse('NO_GRANT', `no provider-spend grant confirms this ${MODEL_CALL_CLASS} call`);\n", ["PP-35"]),
  B("an-oversize-answer-is-not-remembered", "PP-38", CALL, "return keep(run, refuse('RESPONSE_INVALID', `the answer is longer than ${MAX_RESULT_TEXT} characters`, { recorded: wasRecorded }));", "return refuse('RESPONSE_INVALID', `the answer is longer than ${MAX_RESULT_TEXT} characters`, { recorded: wasRecorded });"),
  B("a-bad-clock-skips-the-cooldowns", "PP-39", CALL, "    if (!clockIsUsable(nowMs)) return refuse('REQUEST_INVALID', 'the clock did not give a time', { failures });\n", ""),
];

/** The change a copy needs to run: each relative import at its `.ts` path, and the package at the local shim. */
const runnable = (text) => text.replace(/from '(\.{1,2}\/[^']+)\.js'/g, "from '$1.ts'").replace(/from '@projectos\/core'/g, "from '../../../core/src/shim.ts'");
const copyPath = (dir, rel) => path.join(dir, ...rel.replace(/^projectos\//, "").split("/"));

function writeCopy(dir, rel, text) {
  const abs = copyPath(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, runnable(text));
}

/** The kernel files the module imports, followed through their own imports. They are read from the repository. */
function kernelClosure() {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel) || rel.startsWith(`${CORE_DIR}/`)) return;
    const abs = path.join(ROOT, ...rel.split("/"));
    if (!fs.existsSync(abs)) return;
    seen.add(rel);
    const text = fs.readFileSync(abs, "utf8");
    for (const spec of importsOf(withoutComments(text))) {
      if (spec.startsWith(".")) visit(path.posix.join(path.posix.dirname(rel), spec).replace(/\.js$/, ".ts"));
    }
  };
  for (const root of [...KERNEL_ROOTS, ...coreFilesImports()]) visit(root);
  return [...seen];
}
/** The kernel files the module's own files import, one step. */
function coreFilesImports() {
  return FILES.filter((rel) => rel.startsWith(CORE_DIR)).flatMap((rel) => {
    const abs = path.join(ROOT, ...rel.split("/"));
    if (!fs.existsSync(abs)) return [];
    return importsOf(withoutComments(fs.readFileSync(abs, "utf8"))).filter((spec) => spec.startsWith("../")).map((spec) => path.posix.join(CORE_DIR, spec).replace(/\.js$/, ".ts"));
  });
}

/** Every probe, from a fresh run directory. Null when the code would not run at all, which is also a failure. */
function probed(dir) {
  const run = fs.mkdtempSync(path.join(dir, "run-"));
  const done = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(dir, "probe.mjs")], { cwd: run, encoding: "utf8", timeout: 120000 });
  fs.rmSync(run, { recursive: true, force: true, maxRetries: 3 });
  try {
    return done.status === 0 ? JSON.parse(done.stdout.trim().split("\n").at(-1)) : null;
  } catch {
    return null;
  }
}

/** The phase's own code, run. The unmutated copy must pass every probe; each mutation must fail its rule's alone. */
function behaviour(raw) {
  return scratch.withScratch("port-providers", (dir) => {
    for (const rel of [...FILES, ...kernelClosure()]) writeCopy(dir, rel, raw[rel] ?? fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8"));
    fs.writeFileSync(path.join(dir, "core", "src", "shim.ts"), "export * from './modelBroker/index.ts';\n");
    fs.writeFileSync(path.join(dir, "probe.mjs"), PROBE);

    const control = probed(dir);
    if (control === null || control.count === 0 || control.failed.length > 0) {
      return [`PP-M: the behavioural positive control failed: ${control === null ? "the copy did not run" : control.failed.join(", ")}`];
    }
    const errors = [];
    for (const m of BEHAVIOUR_MUTATIONS) {
      if (!raw[m.rel].includes(m.from)) {
        errors.push(`PP-M: behavioural mutation '${m.name}' no longer applies to ${m.rel}`);
        continue;
      }
      const touched = [m.rel, ...m.more.map(([rel]) => rel)];
      writeCopy(dir, m.rel, raw[m.rel].split(m.from).join(m.to));
      for (const [rel, from, to] of m.more) writeCopy(dir, rel, raw[rel].split(from).join(to));
      const result = probed(dir);
      for (const rel of touched) writeCopy(dir, rel, raw[rel]);
      const fired = result === null ? "the copy did not run" : result.failed.join(", ") || "nothing";
      const wanted = [m.rule, ...m.also].sort().join(", ");
      if (fired !== wanted) errors.push(`PP-M: behavioural mutation '${m.name}' wanted ${wanted} and failed ${fired}`);
    }
    return errors;
  });
}

/** Every named mutation must fire its own rule, and only rules it declares. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`PP-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = [...new Set(check({ ...raw, [m.rel]: text.split(m.from).join(m.to) }).map(([rule]) => rule))].sort();
    if (!fired.includes(m.rule)) {
      errors.push(`PP-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
      continue;
    }
    const stranger = fired.filter((rule) => rule !== m.rule && !m.also.includes(rule));
    if (stranger.length > 0) errors.push(`PP-M: mutation '${m.name}' also fired ${stranger.join(", ")}, so ${m.rule} does not carry it alone`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("PP-M: two mutations share a name");
  errors.push(...behaviour(raw));
  const proved = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of Object.keys(RULE_NAMES)) {
    if (!proved.has(rule)) errors.push(`PP-M: rule ${rule} has no named mutation`);
  }
  return errors;
}

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? normalise(fs.readFileSync(abs, "utf8")) : null;
}

/** Tracked source outside the module that imports it, or names what it exports. The core barrel's one line is the only one allowed. */
function importersOf() {
  const tracked = spawnSync("git", ["-C", ROOT, "ls-files", "-z", "--", "projectos"], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (tracked.status !== 0) return null;
  const inModule = (rel) => rel.startsWith(`${CORE_DIR}/`) || rel.startsWith(`${AGENT_DIR}/`) || /\/test\/modelBroker[-.]/.test(rel);
  return tracked.stdout.split("\0").filter((rel) => /\.(?:[cm]?[jt]sx?)$/.test(rel) && !/(?:^|\/)(?:node_modules|dist)\//.test(rel) && !inModule(rel) && rel !== THIS_REL && fs.existsSync(path.join(ROOT, ...rel.split("/"))))
    .filter((rel) => {
      const code = withoutComments(normalise(fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8")));
      return IMPORT_OF_MODULE.test(code) || (EXPORTED_NAMES.test(code) && !/^projectos\/validators\//.test(rel));
    });
}

function readAll() {
  const raw = {};
  for (const rel of [...FILES, ...Object.keys(TESTS), NOTICES_REL, VA_REL, CR_REL, CORE_BARREL_REL, CORE_PACKAGE_REL, AGENT_PACKAGE_REL]) raw[rel] = read(rel);
  raw[LISTING] = [CORE_DIR, AGENT_DIR]
    .flatMap((dir) => (fs.existsSync(path.join(ROOT, ...dir.split("/"))) ? fs.readdirSync(path.join(ROOT, ...dir.split("/"))).map((name) => `${dir}/${name}`) : []))
    .join("\n")
    .concat("\n");
  const tracked = spawnSync("git", ["-C", ROOT, "ls-files", "--", CORE_DIR, AGENT_DIR], { encoding: "utf8" });
  raw[TRACKED] = tracked.status === 0 ? tracked.stdout.replace(/\r/g, "") : "";
  const importers = importersOf();
  raw[IMPORTERS] = importers === null ? "@git-unavailable\n" : importers.join("\n").concat("\n");
  return raw;
}

function run() {
  const raw = readAll();
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  return errors;
}

if (require.main === module) {
  const errors = run();
  if (errors.length > 0) {
    errors.forEach((x) => console.error(`FAIL: ${x}`));
    console.error(`${THIS_VALIDATOR}: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${FILES.length} real files judged; ${MUTATIONS.length} text and ${BEHAVIOUR_MUTATIONS.length} behavioural mutations killed)`);
}

module.exports = { run, check, selfTest, behaviour, MUTATIONS, BEHAVIOUR_MUTATIONS, TESTS, RULE_NAMES };
