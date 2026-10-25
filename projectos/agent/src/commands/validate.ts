/**
 * `projectos validate` — validate the installed .projectops/project-config.json through
 * the core. With --framework, additionally shell out to the repo's `npm run validate`
 * (the existing .cjs framework validators) and report their exit code.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { configPath, ok, fail } from '../context.js';
import { parseProjectConfig } from '@projectos/core';
import { type Flags, bool } from '../flags.js';

export function validate(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const path = configPath(root);
  const text = sys.readText(path);
  if (text === null) {
    return fail(1, [`No config at ${path} — run \`projectos init\``]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(1, [`${path}: invalid JSON`]);
  }
  const r = parseProjectConfig(parsed);
  if (!r.ok) {
    return fail(1, [`INVALID: ${r.error}`]);
  }

  const lines: string[] = [`OK: ${path} is a valid project-config`];
  if (bool(flags, 'framework')) {
    const res = sys.exec('npm', ['run', 'validate']);
    const tail = res.stdout.trim().split('\n').slice(-3);
    lines.push(`framework validators: exit ${res.code}`, ...tail);
    return { code: res.code === 0 ? 0 : 1, lines };
  }
  return ok(lines);
}
