/**
 * The OpenAI Responses transport: everything except the network call and the secret.
 *
 * WHAT "COMPLETE UP TO THE CREDENTIAL BOUNDARY" MEANS HERE. This module builds the real request body,
 * declares the strict JSON schema the reply must satisfy, resolves the credential through a port that
 * currently refuses, performs the call through an injected HTTP port, and turns whatever comes back
 * into either a decision record or a refusal. The only things it does not do are hold a secret and
 * open a socket — and both are injected, so the whole path is exercised deterministically in tests
 * with no key on the machine and no network.
 *
 * WHY A STRICT SCHEMA RATHER THAN PARSING PROSE. The Responses API supports
 * `text.format: {type: 'json_schema', strict: true}`, which is the difference between a reviewer that
 * returns a decision and a reviewer that returns an essay somebody then has to interpret. Interpreting
 * an essay is exactly where a governance system starts believing what it wants to hear. If the reply
 * does not satisfy the schema, that is a refusal, not something to salvage.
 *
 * THE REPLY IS UNTRUSTED, INCLUDING WHEN IT IS WELL-FORMED. This module never decides anything: it
 * produces a candidate record which `checkGatekeeperDecision` then judges against expectations the
 * runtime established. A schema proves shape, never authority — a perfectly-shaped decision for
 * another phase is still refused downstream.
 *
 * NOTHING HERE LOGS A CREDENTIAL. The secret is used inside `resolve().use()` to build one header and
 * is never placed in a variable that outlives that callback, never interpolated into a message, and
 * never returned. Refusals quote status codes and bounded body excerpts, never headers.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import {
  GATEKEEPER_DECISION_SCHEMA_VERSION,
  GATEKEEPER_VERDICTS,
  gatekeeperRequestDigest,
  type GatekeeperRequest,
  type GatekeeperDecisionRecord,
  type GatekeeperUnavailabilityCause,
} from '@projectos/core';
import type { CredentialResolver } from '../credentialResolver.js';
import type { BrokeredTransport } from './brokeredHttpPort.js';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** The HTTP edge, injected. Kept tiny so a fake is trivial and the real one has nowhere to hide. */
export interface HttpPort {
  post(request: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly timeoutMs: number;
  }): HttpResponse;
}

export type HttpResponse =
  | { readonly kind: 'response'; readonly status: number; readonly body: string }
  | { readonly kind: 'transport-error'; readonly detail: string };

/**
 * The schema the reviewer's reply must satisfy.
 *
 * It mirrors the fields `checkGatekeeperDecision` requires, so a reply that satisfies the schema is
 * at least the right SHAPE to be judged. `additionalProperties: false` matters: without it a model
 * can return extra fields that look meaningful and are silently ignored, which is how a reviewer
 * ends up believing it communicated something it did not.
 */
export const GATEKEEPER_DECISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'decision',
    'reason',
    'nextClaudeInstruction',
    'allowedActions',
    'forbiddenActions',
    'ownerApprovalRequired',
    'risks',
    'carryForward',
  ],
  properties: {
    decision: { type: 'string', enum: [...GATEKEEPER_VERDICTS] },
    reason: { type: 'string' },
    // Nullable rather than optional: a strict schema requires every property, so "no instruction" has
    // to be sayable. `null` says it; an absent field would just fail.
    nextClaudeInstruction: { type: ['string', 'null'] },
    allowedActions: { type: 'array', items: { type: 'string' } },
    forbiddenActions: { type: 'array', items: { type: 'string' } },
    ownerApprovalRequired: { type: 'boolean' },
    risks: { type: 'array', items: { type: 'string' } },
    carryForward: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * What the reviewer is told about its own limits.
 *
 * REPEATED IN THE PROMPT EVEN THOUGH IT IS ENFORCED IN CODE. The enforcement is what makes it true;
 * saying it is what stops the reviewer wasting a decision on something it was never able to grant,
 * and stops it inferring authority from silence.
 */
export function systemInstruction(request: GatekeeperRequest): string {
  return [
    'You are the ProjectOS governance gatekeeper. You review evidence and return one decision.',
    'You are structurally read-only: you cannot modify source, commit, push, deploy, mutate a database,',
    'transmit an external message, make a payment, or reach credential material. Do not ask to.',
    '',
    'Your decision is checked against bindings the runtime established before it is applied. It will be',
    'refused unless it concerns exactly this project, phase and subject commit.',
    `  project: ${request.projectId}`,
    `  phase:   ${request.phaseId}`,
    `  subject: ${request.subjectCommit}`,
    `  ask:     ${request.ask}`,
    '',
    'These actions belong to the owner alone. You may RECOMMEND one; you can never authorise one, and',
    'listing one in allowedActions causes your whole decision to be refused:',
    ...request.ownerOnlyActions.map((a) => `  - ${a}`),
    '',
    'If a verdict continues the work, nextClaudeInstruction must say what to do next. If you are not',
    'able to decide, return AWAITING_OWNER rather than guessing.',
  ].join('\n');
}

export interface OpenAiTransportConfig {
  readonly model: string;
  /**
   * Who this endpoint IS, as configured — stamped onto the record as its provenance.
   *
   * NOT THE SAME VALUE AS `expectedDecider`, and deliberately not derived from it. GK-SEC-004 was
   * raised against a hardcoded 'ChatGPT' here, and the obvious repair — stamp whatever the runtime
   * expects — would have been worse: `checkGatekeeperDecision` compares the record's `decidedBy`
   * against the decider the governing authority names, and if both sides came from one value that
   * comparison could never fail. This says what the configured transport claims to be; the plan's
   * delegation says who is permitted to decide; the check is the meeting of two independent sources.
   */
  readonly decidedBy: string;
  readonly credentialRef: string;
  /** The provider thread this project's governance lives in, when one has been established. */
  readonly previousResponseId?: string | null;
  readonly timeoutMs?: number;
  /**
   * The trusted installation-side transport, when one is composed.
   *
   * WHEN THIS IS PRESENT THE CREDENTIAL NEVER ENTERS THIS PROCESS. The broker validates the
   * installation allowlist and the project's committed receipt itself, resolves the value inside its
   * own process, makes the call and returns a status and a body. The resolver below is not consulted
   * at all — the live path passes one that refuses, so there is no in-process value even to leak.
   *
   * Absent, the direct port is used with a resolved credential, which is what every test does and
   * what any non-brokered composition still does.
   */
  readonly broker?: {
    readonly transport: BrokeredTransport;
    readonly governedRoot: string;
    readonly projectId: string;
    readonly phaseId: string;
    /**
     * The installation's committed policy on whether it will spend on this project at all.
     *
     * ASKED HERE SO THE ANSWER IS KNOWABLY PRE-DISPATCH. The broker enforces this itself and refuses
     * before it reserves or sends anything — but it reports that refusal down the same channel as a
     * failure mid-flight, and everything arriving that way is read as PROVIDER_UNAVAILABLE: a cause
     * that may have been dispatched, whose reservation is therefore conservatively retained. So a
     * project the installation does not authorise accumulated a charge for a call that provably never
     * happened, and could never be asked again. Asking the same committed policy on this side, before
     * the broker is invoked at all, makes "nothing was sent" a fact rather than an inference.
     *
     * It does not replace the broker's own check, which still refuses independently. It only ensures
     * the refusal is classified for what it is.
     */
    readonly installationAllows?: () => { readonly allowed: boolean; readonly reasons: readonly string[] };
  };
}

/** The request body, built from the governed request. Pure — inspectable without sending anything. */
export function buildResponsesBody(
  request: GatekeeperRequest,
  evidenceText: string,
  config: OpenAiTransportConfig,
): string {
  const body: Record<string, unknown> = {
    model: config.model,
    instructions: systemInstruction(request),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              `requestId: ${request.requestId}`,
              `requestDigest: ${gatekeeperRequestDigest(request)}`,
              '',
              evidenceText,
            ].join('\n'),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'projectos_gatekeeper_decision',
        strict: true,
        schema: GATEKEEPER_DECISION_JSON_SCHEMA,
      },
    },
    // A reviewer that keeps its own memory of the thread is the per-project governance thread; when
    // there is none yet the field is omitted rather than sent as null.
    ...(config.previousResponseId != null && config.previousResponseId !== ''
      ? { previous_response_id: config.previousResponseId }
      : {}),
    store: true,
  };
  return JSON.stringify(body);
}

export type TransportOutcome =
  | {
      readonly kind: 'decision';
      /** A CANDIDATE record. It has not been judged; `checkGatekeeperDecision` does that. */
      readonly record: GatekeeperDecisionRecord;
      readonly providerResponseId: string | null;
      readonly usage: { readonly inputTokens: number; readonly cachedInputTokens: number; readonly outputTokens: number };
    }
  | {
      readonly kind: 'unavailable';
      /** The MATERIAL cause. An outage identity binds this; it never binds `reasons`. */
      readonly cause: GatekeeperUnavailabilityCause;
      readonly reasons: readonly string[];
      /** True when the provider itself said the spend limit stopped this, not the network. */
      readonly spendLimited: boolean;
    };

/**
 * Characters that are printable but reorder what a reader sees.
 *
 * SEC-001. Filtering on `ch >= ' '` alone keeps every Unicode bidirectional override and format
 * character: U+202A-U+202E and U+2066-U+2069 are all above the space. Provider-controlled text
 * carrying them can render in an order that has nothing to do with its bytes, so an error excerpt
 * quoted into a governance record can be made to READ as the opposite of what it says. Stripped,
 * not escaped — the same pattern already applied in gatekeeperRouting.ts and gatekeeperBridge.ts.
 */
const REORDERING = /[‪-‮⁦-⁩‎‏؜]/g;

/** Trim anything quoted from the provider before it reaches a record or a report. */
export function safeExcerpt(text: string, limit = 300): string {
  return Array.from(text.replace(REORDERING, ''))
    .filter((ch) => ch >= ' ' || ch === '\n')
    .join('')
    .slice(0, limit);
}

/**
 * Error codes the provider returns when a configured spend limit stops the call.
 *
 * DISTINGUISHED FROM AN ORDINARY 429 ON PURPOSE. Rate limiting says "later"; a spend limit says
 * "not until somebody decides something". Treating the second as the first produces a loop that
 * retries against a wall, which is the shape of an outage rather than of a budget working.
 */
const SPEND_LIMIT_CODES = ['organization_spend_limit_exceeded', 'project_spend_limit_exceeded'];

/**
 * Submit a governed request and return a candidate decision, or refuse.
 *
 * EVERY FAILURE PATH IS `unavailable`, which the caller turns into the owner's explicit choice. There
 * is no path that returns a decision the provider did not actually produce.
 */
export function submitToOpenAi(
  request: GatekeeperRequest,
  evidenceText: string,
  config: OpenAiTransportConfig,
  resolver: CredentialResolver,
  http: HttpPort,
): TransportOutcome {
  // THE TRUSTED ROUTE FIRST. Nothing below this branch runs when a broker is composed: no resolver
  // call, no header built here, no value in this process.
  if (config.broker !== undefined) {
    // NOT AUTHORISED MEANS NOT SENT. Returning before the broker is invoked is what makes the
    // no-dispatch classification true by construction rather than by reading a message.
    const policy = config.broker.installationAllows?.();
    if (policy !== undefined && !policy.allowed) {
      return {
        kind: 'unavailable',
        cause: 'TRANSPORT_NOT_APPROVED',
        reasons: [
          'this installation does not authorise the governed project to spend its credential, so no ' +
            'request was made',
          ...policy.reasons,
        ],
        spendLimited: false,
      };
    }
    const brokered = config.broker.transport.post({
      // THE KIND IS STATED, NOT INFERRED. The broker now carries two questions and refuses a request
      // that does not say which it is; a gatekeeper review says so here.
      kind: 'gatekeeper',
      governedRoot: config.broker.governedRoot,
      projectId: config.broker.projectId,
      phaseId: config.broker.phaseId,
      // FROM THE REQUEST ITSELF, not from the broker configuration: these are what the question IS.
      subjectCommit: request.subjectCommit,
      ask: request.ask,
      requestId: request.requestId,
      credentialRef: config.credentialRef,
      body: buildResponsesBody(request, evidenceText, config),
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    });
    return interpretHttpResponse(request, config, brokered);
  }

  const credential = resolver.resolve(config.credentialRef);
  if (!credential.ok) {
    return {
      kind: 'unavailable',
      cause: 'CREDENTIAL_UNAVAILABLE',
      reasons: credential.reasons,
      spendLimited: false,
    };
  }

  const body = buildResponsesBody(request, evidenceText, config);

  // The secret exists only inside this callback. What comes out is the HTTP result, never the header.
  const response = credential.use((secret) =>
    http.post({
      url: OPENAI_RESPONSES_URL,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body,
      timeoutMs: config.timeoutMs ?? 120_000,
    }),
  );

  return interpretHttpResponse(request, config, response);
}

/**
 * Turn whatever came back into a candidate decision, or a refusal.
 *
 * SHARED BY BOTH ROUTES ON PURPOSE. The brokered and direct transports differ only in who holds the
 * credential; what an answer means must not differ with it, or the trusted path would quietly get its
 * own interpretation of "usable".
 */
function interpretHttpResponse(
  request: GatekeeperRequest,
  config: OpenAiTransportConfig,
  response: HttpResponse,
): TransportOutcome {
  if (response.kind === 'transport-error') {
    return {
      kind: 'unavailable',
      cause: 'PROVIDER_UNAVAILABLE',
      reasons: [`the gatekeeper transport failed: ${safeExcerpt(response.detail)}`],
      spendLimited: false,
    };
  }

  if (response.status !== 200) {
    const spendLimited = SPEND_LIMIT_CODES.some((code) => response.body.includes(code));
    return {
      kind: 'unavailable',
      // A budget refusal is not a transient failure, and risk accepted for one is not risk accepted
      // for the other — so they are different outages, not one outage worded two ways.
      cause: spendLimited ? 'PROVIDER_SPEND_LIMITED' : 'PROVIDER_UNAVAILABLE',
      spendLimited,
      reasons: [
        `the gatekeeper returned HTTP ${response.status}` +
          (spendLimited ? ' because a configured spend limit was reached' : ''),
        safeExcerpt(response.body),
        ...(spendLimited
          ? [
              'this is a budget decision, not a temporary failure; retrying cannot resolve it and the ' +
                'loop does not try',
            ]
          : []),
      ],
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    return {
      kind: 'unavailable',
      cause: 'PROVIDER_UNAVAILABLE',
      reasons: ['the gatekeeper reply was not JSON', safeExcerpt(response.body)],
      spendLimited: false,
    };
  }

  const decisionJson = extractStructuredOutput(parsed);
  if (decisionJson === null) {
    return {
      kind: 'unavailable',
      cause: 'PROVIDER_UNAVAILABLE',
      reasons: [
        'the gatekeeper reply contained no structured decision; a reply that does not satisfy the ' +
          'declared schema is refused rather than interpreted',
        safeExcerpt(response.body),
      ],
      spendLimited: false,
    };
  }

  // THE BINDINGS ARE STAMPED BY THE RUNTIME, NOT BY THE REPLY. The model is never asked for the
  // project, phase, subject or digest — if it were, a wrong answer would be self-consistent and the
  // downstream check would pass. It supplies the judgement; the runtime supplies what it is about.
  const record: GatekeeperDecisionRecord = {
    schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
    decisionId: `GKDEC-${request.requestId}`,
    projectId: request.projectId,
    phaseId: request.phaseId,
    subjectCommit: request.subjectCommit,
    requestDigest: gatekeeperRequestDigest(request),
    decision: decisionJson['decision'],
    allowedActions: decisionJson['allowedActions'],
    forbiddenActions: decisionJson['forbiddenActions'],
    ownerApprovalRequired: decisionJson['ownerApprovalRequired'],
    reason: decisionJson['reason'],
    nextClaudeInstruction: decisionJson['nextClaudeInstruction'],
    risks: decisionJson['risks'],
    carryForward: decisionJson['carryForward'],
    decidedBy: config.decidedBy,
    decidedAt: readString(parsed, 'created_at') ?? '',
  };

  return {
    kind: 'decision',
    record,
    providerResponseId: readString(parsed, 'id'),
    usage: readUsage(parsed),
  };
}

function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * 1000).toISOString();
  return null;
}

function readNumber(o: Record<string, unknown> | undefined, key: string): number {
  const v = o?.[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Token usage as reported by the provider. Absent or malformed counts read as zero, never as a guess.
 *
 * EXPORTED so the plan-authoring transport settles its ledger by exactly the same reading. A second
 * implementation of "what did this cost" is a second answer waiting to disagree with the first, and
 * the cached-token subtraction below is precisely the detail a re-derivation gets wrong.
 */
export function readUsage(parsed: Record<string, unknown>): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
} {
  const usage = parsed['usage'] as Record<string, unknown> | undefined;
  const details = usage?.['input_tokens_details'] as Record<string, unknown> | undefined;
  const cached = readNumber(details, 'cached_tokens');
  const input = readNumber(usage, 'input_tokens');
  return {
    // The provider reports total input INCLUDING cached, and the ledger prices the two separately —
    // so the cached portion is subtracted here rather than counted at both rates.
    inputTokens: Math.max(0, input - cached),
    cachedInputTokens: cached,
    outputTokens: readNumber(usage, 'output_tokens'),
  };
}

/**
 * Pull the structured decision out of a Responses reply.
 *
 * The reply nests content under `output[].content[]`, and a refusal appears as its own content type.
 * Both are handled: a refusal is NOT a decision and must not be parsed as one.
 */
export function extractStructuredOutput(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const output = parsed['output'];
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = (item as Record<string, unknown>)?.['content'];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as Record<string, unknown>;
      if (p['type'] === 'refusal') return null;
      const text = p['text'];
      if (typeof text !== 'string') continue;
      try {
        const value = JSON.parse(text) as unknown;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // Not the structured part; keep looking rather than failing on a stray text block.
      }
    }
  }
  return null;
}
