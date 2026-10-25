/**
 * Plugin registry: register and resolve plugins by capability.
 *
 * Future integrations (GitHub, Vercel, Supabase, Playwright, ECC, Slack, ...) register
 * as plugins declaring one or more capabilities. The registry is immutable: register
 * returns a new registry. Resolution is by capability id. No plugin is executed here —
 * the core only tracks what is available.
 */
import type { Result } from './types.js';
import { ok, err } from './types.js';

export interface PluginManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  /** Whether using this plugin performs external calls (owner-gated by policy). */
  readonly external: boolean;
}

export type PluginRegistry = Readonly<Record<string, PluginManifest>>;

export const EMPTY_REGISTRY: PluginRegistry = {};

/** Register a plugin, returning a new registry. Fails on duplicate id. */
export function register(
  registry: PluginRegistry,
  plugin: PluginManifest,
): Result<PluginRegistry> {
  if (plugin.id in registry) {
    return err(`Plugin already registered: ${plugin.id}`);
  }
  if (plugin.capabilities.length === 0) {
    return err(`Plugin '${plugin.id}' declares no capabilities`);
  }
  return ok({ ...registry, [plugin.id]: plugin });
}

export function get(registry: PluginRegistry, id: string): PluginManifest | undefined {
  return registry[id];
}

/** All plugins providing a given capability. */
export function withCapability(
  registry: PluginRegistry,
  capability: string,
): readonly PluginManifest[] {
  return Object.values(registry).filter((p) => p.capabilities.includes(capability));
}

export function list(registry: PluginRegistry): readonly PluginManifest[] {
  return Object.values(registry);
}
