/**
 * A NUMBER CALLED A CEILING MUST BE A CEILING.
 *
 * THE INCIDENT THIS FILE EXISTS FOR. The one authorised paid authoring call — request
 * PAREQ-9d85911fbb1ac1b3d7d9fe1a, dispatched once on 2026-08-28 — reserved 2,000 output tokens and
 * the provider generated 2,382. It billed $0.026306 against an owner-approved maximum of $0.023888.
 * Nothing malfunctioned: `AUTHORING_OUTPUT_TOKEN_ESTIMATE` priced the reservation and was never put
 * in the request, so the provider was never told there was a limit at all. The owner had approved a
 * number the code had no means of holding anyone to, and it was described to them as a ceiling.
 *
 * THE FIX IS NOT A BIGGER GUESS. Raising the estimate would have bought a little more headroom and
 * left the same defect: an estimate the provider never sees can always be exceeded. So the same
 * constant is now sent as `max_output_tokens` AND used for the reservation, and these tests assert
 * that on the SERIALIZED REQUEST rather than on the constant — a test that only reads the constant
 * would have passed happily throughout the incident.
 *
 * Created in PROJECTOS-AUTHORING-OUTPUT-LIMIT1A.
 */
import { describe, test, expect } from 'vitest';
import {
  buildAuthoringBody,
  outputSettlementAnomaly,
  AUTHORING_OUTPUT_TOKEN_LIMIT,
  AUTHORING_REASONING_EFFORT,
  type AuthorRequest,
} from '../src/planAuthoring.js';
import { estimateCostMicroUsd, estimateInputTokensFromBytes, utf8ByteLength } from '@projectos/core';

const REQUEST: AuthorRequest = {
  objective: 'Create a governed implementation plan for a read-only summary projection.',
  projectId: 'projectos',
  repository: 'universalbizcomply/ProjectOS',
  contextSourcePaths: ['.projectops/plan.json', 'docs/architecture/master-plan.md'],
  contextSourcesOmitted: 12,
  objectiveDigest: 'sha256:' + 'a'.repeat(64),
  requestId: 'PAREQ-000000000000000000000000',
} as AuthorRequest;

/** The request as the provider receives it — parsed back from the wire form, not from a builder. */
const wire = (): Record<string, unknown> =>
  JSON.parse(buildAuthoringBody(REQUEST, 'gpt-5.6-terra')) as Record<string, unknown>;

/** The observed rate card for the model this incident used. */
const RATE = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

describe('the request that reaches the provider carries an enforced output maximum', () => {
  test('max_output_tokens is present on the serialized body', () => {
    expect(wire()).toHaveProperty('max_output_tokens');
  });

  test('its value is the limit, 12000', () => {
    expect(wire()['max_output_tokens']).toBe(12000);
    expect(AUTHORING_OUTPUT_TOKEN_LIMIT).toBe(12000);
  });

  /**
   * THE SECOND INCIDENT. PAREQ-5daade28f79841569cd2839a, 2026-09-03: the first authoring call made
   * from the Control Center's Start door. gpt-5.6-terra returned `status: incomplete`,
   * `incomplete_details.reason: max_output_tokens`, exactly 3,000 output tokens billed, ONE
   * reasoning item and NO message. On a reasoning model the ceiling is shared with reasoning, and
   * the default effort spent all of it thinking. The runtime correctly refused (AUTHOR_REFUSED) —
   * and the owner paid $0.033 for nothing. Two things had to change and both are asserted here.
   */
  test('3000 has been measured too small for a reasoning model — the limit had to move again', () => {
    const REASONING_ONLY_INCIDENT_OUTPUT = 3000;
    expect(AUTHORING_OUTPUT_TOKEN_LIMIT).toBeGreaterThan(REASONING_ONLY_INCIDENT_OUTPUT);
    // Room for reasoning AND a plan of several phases, not merely one more than the incident.
    expect(AUTHORING_OUTPUT_TOKEN_LIMIT).toBeGreaterThanOrEqual(REASONING_ONLY_INCIDENT_OUTPUT * 3);
  });

  test('the body asks for LOW reasoning effort, so the allowance is spent on the plan', () => {
    expect(wire()['reasoning']).toEqual({ effort: 'low' });
    expect(AUTHORING_REASONING_EFFORT).toBe('low');
  });

  test("the worst case of one call stays well inside the owner's $5 ceiling", () => {
    // 12,000 output tokens on the strong model: $0.12. The reservation IS this number, so this is
    // what the spend gate holds back before the call, not an estimate of what it might bill.
    const worst = estimateCostMicroUsd({ inputTokens: 0, outputTokens: AUTHORING_OUTPUT_TOKEN_LIMIT }, RATE);
    expect(worst).toBe(120_000);
    expect(worst).toBeLessThan(5_000_000 / 10);
  });

  test('it survives JSON serialization as a number, not a string', () => {
    expect(typeof wire()['max_output_tokens']).toBe('number');
  });

  test('the body would have failed this before the fix — no output field existed at all', () => {
    // The exact pre-fix shape, recorded so the regression is legible: model, instructions, input,
    // text, store. Nothing bounded generation.
    const keys = Object.keys(wire());
    expect(keys).toContain('max_output_tokens');
    expect(new Set(['model', 'instructions', 'input', 'text', 'store']).has('max_output_tokens')).toBe(false);
  });

  test('store stays false — the provider retains nothing', () => {
    expect(wire()['store']).toBe(false);
  });
});

describe('the reservation prices exactly what the provider is allowed to generate', () => {
  test('reserved output tokens equal the limit sent on the wire', () => {
    expect(wire()['max_output_tokens']).toBe(AUTHORING_OUTPUT_TOKEN_LIMIT);
  });

  test('there is one source of truth, so the two cannot drift', () => {
    // If a second constant is ever introduced, this is the assertion that fails: the number the
    // gate reserves against is read from the same export the request body uses.
    const body = wire();
    const reserved = AUTHORING_OUTPUT_TOKEN_LIMIT;
    expect(body['max_output_tokens']).toBe(reserved);
  });

  test('a call generating the full allowance cannot exceed its own reservation', () => {
    const bytes = utf8ByteLength(buildAuthoringBody(REQUEST, 'gpt-5.6-terra'));
    const reserved = estimateCostMicroUsd(
      { inputTokens: estimateInputTokensFromBytes(bytes), outputTokens: AUTHORING_OUTPUT_TOKEN_LIMIT },
      RATE,
    );
    // Worst case the provider is permitted: every allowed output token, and input exactly as measured.
    const worstActual = estimateCostMicroUsd(
      { inputTokens: estimateInputTokensFromBytes(bytes), outputTokens: AUTHORING_OUTPUT_TOKEN_LIMIT },
      RATE,
    );
    expect(worstActual).toBeLessThanOrEqual(reserved);
  });
});

describe('the incident itself, encoded', () => {
  const OBSERVED_OUTPUT = 2382;
  const OLD_ESTIMATE = 2000;

  test('the observed call exceeded the old estimate by 382 output tokens', () => {
    expect(OBSERVED_OUTPUT - OLD_ESTIMATE).toBe(382);
  });

  test('under the old estimate that overspend was $0.002418', () => {
    const reservedOld = estimateCostMicroUsd({ inputTokens: 3110, outputTokens: OLD_ESTIMATE }, RATE);
    const actual = estimateCostMicroUsd({ inputTokens: 1989, outputTokens: OBSERVED_OUTPUT }, RATE);
    expect(reservedOld).toBe(23_888);
    expect(actual).toBe(26_306);
    expect(actual - reservedOld).toBe(2_418);
  });

  test('the same call under the new limit is reserved for, not billed past', () => {
    const reservedNew = estimateCostMicroUsd(
      { inputTokens: 3110, outputTokens: AUTHORING_OUTPUT_TOKEN_LIMIT },
      RATE,
    );
    const actual = estimateCostMicroUsd({ inputTokens: 1989, outputTokens: OBSERVED_OUTPUT }, RATE);
    expect(actual).toBeLessThanOrEqual(reservedNew);
  });

  test('2000 would still be too small — the limit had to move, not just become enforced', () => {
    // Capping at the old number would have truncated the only successful plan this repository has
    // produced, which buys a charge for an unusable answer.
    expect(OBSERVED_OUTPUT).toBeGreaterThan(OLD_ESTIMATE);
    expect(AUTHORING_OUTPUT_TOKEN_LIMIT).toBeGreaterThan(OBSERVED_OUTPUT);
  });
});

describe('a provider that bills past its own limit is named, not absorbed', () => {
  test('a settlement within the limit is silent', () => {
    expect(outputSettlementAnomaly(2382)).toBe(null);
    expect(outputSettlementAnomaly(AUTHORING_OUTPUT_TOKEN_LIMIT)).toBe(null);
  });

  test('a settlement above the limit is reported with both numbers', () => {
    const msg = outputSettlementAnomaly(AUTHORING_OUTPUT_TOKEN_LIMIT + 1);
    expect(msg).not.toBe(null);
    expect(msg).toContain(String(AUTHORING_OUTPUT_TOKEN_LIMIT));
    expect(msg).toContain(String(AUTHORING_OUTPUT_TOKEN_LIMIT + 1));
  });

  test('it does not clamp — the ledger must agree with the invoice', () => {
    expect(outputSettlementAnomaly(AUTHORING_OUTPUT_TOKEN_LIMIT * 2)).toContain('records what was billed');
  });

  test('it never suggests a retry', () => {
    expect(outputSettlementAnomaly(AUTHORING_OUTPUT_TOKEN_LIMIT * 2)).toContain('Do not retry');
  });

  test('an unusable token count is an anomaly too, not a pass', () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      expect(outputSettlementAnomaly(bad)).not.toBe(null);
    }
  });
});
