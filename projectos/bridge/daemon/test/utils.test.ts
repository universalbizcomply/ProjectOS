import { describe, test, expect } from 'vitest';
import { redact, redactValue, containsSecret } from '../src/utils/redact.js';
import { parseJsonl, toJsonl, toJsonlLine } from '../src/utils/jsonl.js';
import { Debouncer } from '../src/utils/debounce.js';
import { uptimeMs } from '../src/utils/clock.js';

describe('redact', () => {
  test('scrubs known token shapes', () => {
    const s = 'pat=sbp_abcdefghijklmnopqrstuvwxyz012345 svc=sb_secret_abcdefghijklmnopqrst';
    const out = redact(s);
    expect(out).not.toContain('sbp_abcdefghijkl');
    expect(out).not.toContain('sb_secret_abcdefghij');
    expect(out).toContain('[REDACTED]');
  });

  test('scrubs vercel/github/stripe/resend/jwt shapes', () => {
    const inputs = [
      'vcp_abcdefghijklmnopqrstuvwx',
      'ghp_abcdefghijklmnopqrstuvwxyz01',
      'github_pat_abcdefghijklmnopqrst',
      'sk_live_abcdefghijklmnopqrstuvwx',
      're_abcdefghijklmnopqrstuvwx',
      'eyJhbGciOiJexample.eyJzdWIiOexample.sigpart',
    ];
    for (const i of inputs) expect(redact(i)).toContain('[REDACTED]');
  });

  test('redacts key=value secrets regardless of value shape', () => {
    expect(redact('password: hunter2xyz')).toContain('[REDACTED]');
    expect(redact('api_key="short12"')).toContain('[REDACTED]');
  });

  test('leaves clean text untouched', () => {
    expect(redact('hello world')).toBe('hello world');
  });

  test('containsSecret detects and clears', () => {
    expect(containsSecret('sbp_abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(containsSecret('nothing here')).toBe(false);
  });

  test('redactValue walks nested structures', () => {
    const out = redactValue({
      a: 'sbp_abcdefghijklmnopqrstuvwxyz012345',
      b: [1, 'vcp_abcdefghijklmnopqrstuvwx', { c: 'ok' }],
      d: 42,
      e: null,
    });
    expect(JSON.stringify(out)).not.toContain('sbp_abcdefghijkl');
    expect(JSON.stringify(out)).toContain('[REDACTED]');
    expect((out as { d: number }).d).toBe(42);
  });
});

describe('jsonl', () => {
  test('parses and skips malformed/blank lines', () => {
    const text = '{"a":1}\n\n{bad}\n{"a":2}\n';
    const { records, skipped } = parseJsonl<{ a: number }>(text);
    expect(records).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  test('serialises lines and documents', () => {
    expect(toJsonlLine({ a: 1 })).toBe('{"a":1}');
    expect(toJsonl([{ a: 1 }, { a: 2 }])).toBe('{"a":1}\n{"a":2}\n');
    expect(toJsonl([])).toBe('');
  });
});

describe('Debouncer', () => {
  test('coalesces and fires after delay', () => {
    const d = new Debouncer(100);
    d.schedule('x', 0);
    d.schedule('x', 50); // pushes fire time to 150
    expect(d.due(120)).toEqual([]);
    expect(d.size).toBe(1);
    expect(d.due(150)).toEqual(['x']);
    expect(d.size).toBe(0);
  });

  test('negative delay clamps to zero', () => {
    const d = new Debouncer(-5);
    d.schedule('y', 10);
    expect(d.due(10)).toEqual(['y']);
  });
});

describe('uptimeMs', () => {
  test('non-negative elapsed', () => {
    expect(uptimeMs(100, 350)).toBe(250);
    expect(uptimeMs(500, 100)).toBe(0);
  });
});
