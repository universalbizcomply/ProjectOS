/**
 * THE SAME DEFECT, ON THE TWO ROUTES THAT HAD NOT SPENT PAST IT YET.
 *
 * Plan authoring paid for this lesson: a 2,000-token "ceiling" that was only ever an estimate, never
 * sent to the provider, let one call bill $0.026306 against an approved $0.023888. The adversarial
 * review that followed found the identical shape on `gatekeeperTurn` and `reconciliation` — both
 * reserved 800 output tokens as a bare literal, and `buildResponsesBody` carried no limit at all.
 * Neither had exceeded it yet. That is luck, not a control.
 *
 * WHY 800 AND NOT 3,000. Because 800 is the number these routes have always reserved, and settled
 * gatekeeper outputs in this repository run to 675 — the figure is right. Copying authoring's 3,000
 * here would have quadrupled the worst-case price of every governance decision while fixing a bug
 * that is about enforcement, not size.
 *
 * These tests assert on the SERIALIZED body. A test that only read the constant would have passed
 * throughout the incident, because the constant was always there — it just never left the process.
 *
 * Created in PROJECTOS-FINAL-PAID-AUTHORING-REMAINING-PAID-ROUTE-OUTPUT-ENFORCEMENT1A.
 */
import { describe, test, expect } from 'vitest';
import {
  buildResponsesBody,
  gatekeeperOutputAnomaly,
  GATEKEEPER_OUTPUT_TOKEN_LIMIT,
} from '../src/loop/transports/openaiResponses.js';
import { estimateCostMicroUsd } from '@projectos/core';

const REQUEST = {
  schemaVersion: '1.0.0',
  requestId: 'GKREQ-000000000000000000000000',
  projectId: 'projectos',
  phaseId: 'PHASE1A',
  subjectCommit: 'a'.repeat(40),
  ask: 'evidence-review',
  evidenceDigests: ['sha256:' + 'b'.repeat(64)],
  ownerOnlyActions: ['production.deploy'],
} as unknown as Parameters<typeof buildResponsesBody>[0];

const CONFIG = (over: Record<string, unknown> = {}) =>
  ({
    model: 'gpt-5.6-terra',
    decidedBy: 'ChatGPT',
    credentialRef: 'OPENAI_GATEKEEPER_KEY',
    previousResponseId: null,
    ...over,
  }) as unknown as Parameters<typeof buildResponsesBody>[2];

const wire = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  JSON.parse(buildResponsesBody(REQUEST, 'evidence text', CONFIG(over))) as Record<string, unknown>;

const RATE = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

describe('the governance request carries an enforced output maximum', () => {
  test('max_output_tokens is on the serialized body', () => {
    expect(wire()).toHaveProperty('max_output_tokens');
  });

  test('its value is 800', () => {
    expect(wire()['max_output_tokens']).toBe(800);
    expect(GATEKEEPER_OUTPUT_TOKEN_LIMIT).toBe(800);
  });

  test('it serializes as a number, not a string', () => {
    expect(typeof wire()['max_output_tokens']).toBe('number');
  });

  test('it is NOT authoring 3000 — these are different response contracts', () => {
    expect(wire()['max_output_tokens']).not.toBe(3000);
  });
});

describe('nothing else about the request moved', () => {
  test('model, instructions, input and the decision schema are unchanged', () => {
    const b = wire();
    expect(b['model']).toBe('gpt-5.6-terra');
    expect(typeof b['instructions']).toBe('string');
    expect(Array.isArray(b['input'])).toBe(true);
    expect((b['text'] as Record<string, Record<string, unknown>>)['format']['name']).toBe(
      'projectos_gatekeeper_decision',
    );
  });

  test('store stays true — the governance thread keeps its memory', () => {
    expect(wire()['store']).toBe(true);
  });

  test('previous_response_id is still omitted when there is no thread', () => {
    expect(wire()).not.toHaveProperty('previous_response_id');
  });

  test('previous_response_id is still sent when there is one', () => {
    expect(wire({ previousResponseId: 'resp_abc123' })['previous_response_id']).toBe('resp_abc123');
  });
});

describe('the reservation is the enforced maximum, on both paid routes', () => {
  test('gatekeeperTurn reserves the same constant it sends', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/loop/gatekeeperTurn.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('outputTokens: GATEKEEPER_OUTPUT_TOKEN_LIMIT');
    expect(src).not.toMatch(/outputTokens:\s*800/);
  });

  test('reconciliation reserves the same constant it sends', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/loop/reconciliation.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('outputTokens: GATEKEEPER_OUTPUT_TOKEN_LIMIT');
    expect(src).not.toMatch(/outputTokens:\s*800/);
  });

  test('a call generating the full allowance cannot exceed its reservation', () => {
    const reserved = estimateCostMicroUsd({ inputTokens: 1600, outputTokens: GATEKEEPER_OUTPUT_TOKEN_LIMIT }, RATE);
    const worstPermitted = estimateCostMicroUsd(
      { inputTokens: 1600, outputTokens: wire()['max_output_tokens'] as number },
      RATE,
    );
    expect(worstPermitted).toBeLessThanOrEqual(reserved);
  });

  test('the highest settled gatekeeper output on record still fits', () => {
    // 675 tokens, from the accepted ledger. The limit is not being tightened onto real traffic.
    expect(675).toBeLessThanOrEqual(GATEKEEPER_OUTPUT_TOKEN_LIMIT);
  });
});

describe('a provider that bills past its own limit is surfaced, not absorbed', () => {
  test('usage at or under the limit behaves normally', () => {
    expect(gatekeeperOutputAnomaly(675)).toBe(null);
    expect(gatekeeperOutputAnomaly(GATEKEEPER_OUTPUT_TOKEN_LIMIT)).toBe(null);
  });

  test('usage above the limit is reported with both numbers', () => {
    const msg = gatekeeperOutputAnomaly(801);
    expect(msg).not.toBe(null);
    expect(msg).toContain('800');
    expect(msg).toContain('801');
  });

  test('it refuses to call the decision a normally bounded result', () => {
    expect(gatekeeperOutputAnomaly(1200)).toContain('not a normally bounded result');
  });

  test('it does not clamp the bill', () => {
    expect(gatekeeperOutputAnomaly(1200)).toContain('records what was billed');
  });

  test('it never suggests a retry', () => {
    expect(gatekeeperOutputAnomaly(1200)).toContain('do not retry');
  });

  test('an unusable token count is an anomaly, not a pass', () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      expect(gatekeeperOutputAnomaly(bad)).not.toBe(null);
    }
  });

  test('the anomaly joins the problems that stop a verdict being applied', async () => {
    // The smallest existing mechanism: a non-empty `problems` list already prevents
    // `applyVerdictToStop` treating the answer as a clean decision. The anomaly is prepended to it.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/loop/gatekeeperTurn.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('const outputAnomaly = gatekeeperOutputAnomaly(outcome.usage.outputTokens)');
    expect(src).toContain('outputAnomaly === null ? checked : [outputAnomaly, ...checked]');
    // And the bill is recorded from real reported usage BEFORE any of this.
    expect(src.indexOf('usage: outcome.usage')).toBeLessThan(src.indexOf('const outputAnomaly'));
  });

  test('no retry or fallback provider exists on these routes', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/loop/transports/openaiResponses.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/fallbackModel|retryRequest|for\s*\(\s*let\s+attempt/);
  });
});
