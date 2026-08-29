/**
 * The daemon redactor must see the two providers ProjectOS actually spends with.
 *
 * WHY THIS IS A SEPARATE FILE. `utils.test.ts` covers the redactor's underscore-delimited families,
 * which were correct and are unchanged. These are the hyphen-delimited families that every one of
 * ProjectOS's five secret detectors missed for the same structural reason, and grouping them keeps the
 * regression legible: if this file goes red, a provider key can reach a log.
 *
 * NO REAL KEY APPEARS HERE. Every fixture is built from a fixed filler string; none was issued by any
 * provider and none authenticates anywhere.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { describe, test, expect } from 'vitest';
import { redact, redactValue, containsSecret } from '../src/utils/redact.js';

const FILLER = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const body = (n: number): string => FILLER.repeat(Math.ceil(n / FILLER.length)).slice(0, n);

const PROVIDER_KEYS: readonly { readonly family: string; readonly value: string }[] = [
  { family: 'openai-project', value: `sk-proj-${body(64)}` },
  { family: 'openai-service-account', value: `sk-svcacct-${body(64)}` },
  { family: 'openai-admin', value: `sk-admin-${body(64)}` },
  { family: 'openai-legacy', value: `sk-${body(48)}` },
  { family: 'anthropic', value: `sk-ant-api03-${body(95)}` },
];

describe('provider model keys', () => {
  for (const { family, value } of PROVIDER_KEYS) {
    test(`redacts an ${family} key`, () => {
      const out = redact(`authorization: Bearer ${value}`);
      expect(out).toContain('[REDACTED]');
      // The whole token, not a prefix of it. A partially-redacted key is still a leaked key.
      expect(out).not.toContain(value.slice(0, 24));
      expect(containsSecret(out)).toBe(false);
    });

    test(`detects an ${family} key`, () => {
      expect(containsSecret(value)).toBe(true);
    });
  }

  test('scrubs a provider key nested inside a structure', () => {
    const out = redactValue({ headers: { authorization: `Bearer ${PROVIDER_KEYS[0].value}` } });
    expect(JSON.stringify(out)).toContain('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain(PROVIDER_KEYS[0].value.slice(0, 24));
  });

  test('a variant tag it has never seen is still an Anthropic key', () => {
    // `api03` is today's tag. The pattern treats the tag as body precisely so a future `api04` — or
    // `admin01`, or `sid01` — is not a shape this redactor has to be taught.
    for (const tag of ['api04', 'admin01', 'sid01']) {
      expect(containsSecret(`sk-ant-${tag}-${body(95)}`)).toBe(true);
    }
  });

  test('leaves ordinary hyphenated prose alone', () => {
    // The legacy bare OpenAI pattern is the one with no prefix to lean on, so this is the case that
    // proves its 40-character floor and hyphen-free body are doing real work.
    for (const benign of [
      'the sk-learning module',
      'skip-the-first-two-and-carry-on-with-a-long-hyphenated-sentence',
      'sk-ant',
      'sk-proj',
    ]) {
      expect(containsSecret(benign)).toBe(false);
      expect(redact(benign)).toBe(benign);
    }
  });
});
