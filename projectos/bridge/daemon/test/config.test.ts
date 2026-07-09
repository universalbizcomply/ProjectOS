import { describe, test, expect } from 'vitest';
import { loadConfig } from '../src/config/configLoader.js';
import { DEFAULT_CONFIG } from '../src/constants.js';

describe('loadConfig', () => {
  test('null/empty → defaults with warning', () => {
    expect(loadConfig(null).config).toEqual(DEFAULT_CONFIG);
    expect(loadConfig('   ').warnings.length).toBeGreaterThan(0);
  });

  test('invalid JSON → defaults', () => {
    const r = loadConfig('{not json');
    expect(r.config).toEqual(DEFAULT_CONFIG);
    expect(r.warnings[0]).toContain('invalid JSON');
  });

  test('non-object JSON → defaults', () => {
    expect(loadConfig('[1,2,3]').warnings[0]).toContain('not an object');
  });

  test('valid config parsed', () => {
    const r = loadConfig(
      JSON.stringify({
        watchRoots: ['/a', '/b'],
        watchIntervalMs: 2000,
        debounceMs: 300,
        ignoredFolders: ['tmp'],
        dashboardSync: false,
        logLevel: 'WARN',
        plugins: ['p1'],
      }),
    );
    expect(r.config.watchRoots).toEqual(['/a', '/b']);
    expect(r.config.watchIntervalMs).toBe(2000);
    expect(r.config.dashboardSync).toBe(false);
    expect(r.config.logLevel).toBe('WARN');
    expect(r.config.plugins).toEqual(['p1']);
  });

  test('clamps out-of-range interval + debounce', () => {
    const r = loadConfig(JSON.stringify({ watchIntervalMs: 999999, debounceMs: 999999 }));
    expect(r.config.watchIntervalMs).toBe(60000);
    expect(r.config.debounceMs).toBe(10000);
    expect(r.warnings.some((w) => w.includes('clamped'))).toBe(true);
  });

  test('unknown logLevel warns and keeps default', () => {
    const r = loadConfig(JSON.stringify({ logLevel: 'LOUD' }));
    expect(r.config.logLevel).toBe('INFO');
    expect(r.warnings.some((w) => w.includes('unknown logLevel'))).toBe(true);
  });

  test('non-array fields fall back to defaults', () => {
    const r = loadConfig(JSON.stringify({ watchRoots: 'x', ignoredFolders: 5 }));
    expect(r.config.watchRoots).toEqual([]);
    expect(r.config.ignoredFolders).toEqual([...DEFAULT_CONFIG.ignoredFolders]);
  });
});
