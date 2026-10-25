import { describe, it, expect } from 'vitest';
import { CATALOG_PLUGINS, defaultCatalog } from '../src/plugin-catalog.js';
import { get, withCapability, list } from '../src/plugins.js';

describe('plugin catalog', () => {
  it('registers every catalog plugin without duplicates', () => {
    const reg = defaultCatalog();
    expect(list(reg)).toHaveLength(CATALOG_PLUGINS.length);
    expect(get(reg, 'supabase')?.displayName).toBe('Supabase');
  });

  it('resolves plugins by capability', () => {
    const reg = defaultCatalog();
    expect(withCapability(reg, 'deploy').map((p) => p.id)).toContain('vercel');
    expect(withCapability(reg, 'notify').map((p) => p.id).sort()).toEqual(['slack', 'teams']);
  });

  it('marks external integrations', () => {
    const reg = defaultCatalog();
    expect(get(reg, 'github')?.external).toBe(true);
    expect(get(reg, 'playwright')?.external).toBe(false);
  });
});
