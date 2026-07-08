/**
 * Plugin catalog: the built-in set of integration plugin manifests.
 *
 * These are INERT declarations only — capability + whether the integration performs
 * external calls (owner-gated by policy). No plugin is executed by the core. They give the
 * roadmap's future integrations (GitHub, Vercel, Supabase, ...) a registered identity that
 * surfaces can list and that phases can require.
 */
import type { PluginManifest, PluginRegistry } from './plugins.js';
import { EMPTY_REGISTRY, register } from './plugins.js';

export const CATALOG_PLUGINS: readonly PluginManifest[] = [
  { id: 'github', displayName: 'GitHub', version: '0.0.0', capabilities: ['scm', 'pr', 'issues'], external: true },
  { id: 'github-actions', displayName: 'GitHub Actions', version: '0.0.0', capabilities: ['ci'], external: true },
  { id: 'vercel', displayName: 'Vercel', version: '0.0.0', capabilities: ['deploy', 'hosting'], external: true },
  { id: 'supabase', displayName: 'Supabase', version: '0.0.0', capabilities: ['database', 'auth', 'storage'], external: true },
  { id: 'docker', displayName: 'Docker', version: '0.0.0', capabilities: ['container'], external: false },
  { id: 'playwright', displayName: 'Playwright', version: '0.0.0', capabilities: ['e2e', 'browser'], external: false },
  { id: 'ecc', displayName: 'ECC Reviews', version: '0.0.0', capabilities: ['code-review', 'security-review'], external: false },
  { id: 'figma', displayName: 'Figma', version: '0.0.0', capabilities: ['design'], external: true },
  { id: 'slack', displayName: 'Slack', version: '0.0.0', capabilities: ['notify'], external: true },
  { id: 'teams', displayName: 'Microsoft Teams', version: '0.0.0', capabilities: ['notify'], external: true },
  { id: 'jira', displayName: 'Jira', version: '0.0.0', capabilities: ['issues', 'planning'], external: true },
  { id: 'azure-devops', displayName: 'Azure DevOps', version: '0.0.0', capabilities: ['scm', 'ci', 'issues'], external: true },
];

/** A registry pre-loaded with the catalog. */
export function defaultCatalog(): PluginRegistry {
  let registry: PluginRegistry = EMPTY_REGISTRY;
  for (const p of CATALOG_PLUGINS) {
    const r = register(registry, p);
    if (r.ok) registry = r.value;
  }
  return registry;
}
