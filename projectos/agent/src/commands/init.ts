/**
 * `projectos init` — scaffold a .projectops/project-config.json for the current project,
 * plus empty phases/ and reports/ folders. The generated config is validated through the
 * core before it is written, so init can never emit an invalid config.
 *
 * Flags: --id, --name, --type, --owner, --repo, --path, --force
 */
import type { CommandContext, CommandResult } from '../context.js';
import { configPath, projectopsDir, join, ok, fail } from '../context.js';
import { parseProjectConfig } from '@projectos/core';
import { buildProjectConfig } from '../templates.js';
import { type Flags, str } from '../flags.js';

export function init(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const path = configPath(root);

  if (sys.exists(path) && flags['force'] !== true) {
    return fail(2, [`Refusing to overwrite ${path} (pass --force to replace)`]);
  }

  const id = str(flags, 'id');
  const name = str(flags, 'name', id);
  if (id === '') {
    return fail(1, ['`init` requires --id <project-slug>']);
  }

  const cfg = buildProjectConfig({
    projectId: id,
    projectName: name,
    projectType: str(flags, 'type', 'saas'),
    owner: str(flags, 'owner', 'Murad'),
    repo: str(flags, 'repo', 'none'),
    localPath: str(flags, 'path', root),
  });

  const check = parseProjectConfig(cfg);
  if (!check.ok) {
    return fail(1, [`Generated config failed validation: ${check.error}`]);
  }

  sys.writeText(path, JSON.stringify(cfg, null, 2) + '\n');
  sys.writeText(join(projectopsDir(root), 'phases', '.gitkeep'), '');
  sys.writeText(join(projectopsDir(root), 'reports', '.gitkeep'), '');

  return ok([
    `Created ${path}`,
    `Created ${join(projectopsDir(root), 'phases')}/`,
    `Created ${join(projectopsDir(root), 'reports')}/`,
    `installStatus=planned, productionFreeze=on. Edit the config, then commit.`,
  ]);
}
