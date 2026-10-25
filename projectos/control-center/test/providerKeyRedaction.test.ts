/**
 * The renderer-side redactor must see the two providers ProjectOS actually spends with.
 *
 * DEFENCE IN DEPTH, AND THE DEPTH MATTERS HERE. The daemon redacts before anything leaves it, and
 * this scrubs again so a value can never reach the DOM. Both lists missed OpenAI and Anthropic for
 * the same structural reason — every shape they carried was underscore-delimited — so "two layers"
 * was one blind spot twice. This is the regression that keeps them apart.
 *
 * NO REAL KEY APPEARS HERE. Every fixture is built from a fixed filler string.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { describe, test, expect } from 'vitest';
import { redact, containsSecret } from '../src/daemon/redact.js';

const FILLER = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const body = (n: number): string => FILLER.repeat(Math.ceil(n / FILLER.length)).slice(0, n);

const PROVIDER_KEYS: readonly { readonly family: string; readonly value: string }[] = [
  { family: 'openai-project', value: `sk-proj-${body(64)}` },
  { family: 'openai-service-account', value: `sk-svcacct-${body(64)}` },
  { family: 'openai-admin', value: `sk-admin-${body(64)}` },
  { family: 'openai-legacy', value: `sk-${body(48)}` },
  { family: 'anthropic', value: `sk-ant-api03-${body(95)}` },
];

describe('provider model keys in the renderer', () => {
  for (const { family, value } of PROVIDER_KEYS) {
    test(`never reaches the DOM: ${family}`, () => {
      const out = redact(`the broker replied for ${value}`);
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain(value.slice(0, 24));
      expect(containsSecret(out)).toBe(false);
    });
  }

  test('a future Anthropic variant tag is still recognised', () => {
    for (const tag of ['api04', 'admin01', 'sid01']) {
      expect(containsSecret(`sk-ant-${tag}-${body(95)}`)).toBe(true);
    }
  });

  test('ordinary hyphenated prose survives untouched', () => {
    for (const benign of ['the sk-learning module', 'sk-ant', 'sk-proj', 'skip-the-hyphenated-sentence-here']) {
      expect(containsSecret(benign)).toBe(false);
      expect(redact(benign)).toBe(benign);
    }
  });
});
