/**
 * `projectos plugins` — list the built-in integration catalog (inert): id, capabilities,
 * and whether the integration is external (owner-gated by policy). Read-only.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok } from '../context.js';
import { defaultCatalog, list } from '@projectos/core';

export function plugins(_ctx: CommandContext): CommandResult {
  const reg = defaultCatalog();
  const items = list(reg);
  const lines = [`Integration catalog (${items.length}, inert):`];
  for (const p of items) {
    const ext = p.external ? 'external (owner-gated)' : 'local';
    lines.push(`  ${p.id.padEnd(15)} ${ext.padEnd(22)} ${p.capabilities.join(', ')}`);
  }
  return ok(lines);
}
