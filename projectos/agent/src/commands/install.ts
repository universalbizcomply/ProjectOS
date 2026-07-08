/**
 * `projectos install` — install a config-only .projectops/ into a target product repo.
 *
 * Richer than `init`: writes into an arbitrary --target directory, auto-detects the git
 * remote, sets installStatus=installed, and drops a README + phases/reports folders.
 * ProjectOS never edits product code — it only adds the governance folder. The generated
 * config is validated through the core before anything is written.
 *
 * Flags: --target (required), --id (required), --name, --type, --owner, --repo, --force
 */
import type { CommandContext, CommandResult } from '../context.js';
import { configPath, projectopsDir, join, ok, fail } from '../context.js';
import { parseProjectConfig, parseRemoteUrl } from '@projectos/core';
import { buildProjectConfig, renderInstallReadme } from '../templates.js';
import { type Flags, str, bool } from '../flags.js';

export function install(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys } = ctx;
  const target = str(flags, 'target');
  if (target === '') return fail(1, ['`install` requires --target <repo-path>']);
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`install` requires --id <project-slug>']);

  const cfgPath = configPath(target);
  if (sys.exists(cfgPath) && !bool(flags, 'force')) {
    return fail(2, [`Refusing to overwrite ${cfgPath} (pass --force)`]);
  }

  let repo = str(flags, 'repo');
  if (repo === '') {
    const r = sys.exec('git', ['-C', target, 'remote', 'get-url', 'origin']);
    if (r.code === 0) {
      const ref = parseRemoteUrl(r.stdout.trim());
      repo = ref ? ref.slug : 'none';
    } else {
      repo = 'none';
    }
  }

  const name = str(flags, 'name', id);
  const cfg = {
    ...buildProjectConfig({
      projectId: id,
      projectName: name,
      projectType: str(flags, 'type', 'saas'),
      owner: str(flags, 'owner', 'Murad'),
      repo,
      localPath: target,
    }),
    installStatus: 'installed' as const,
  };

  const check = parseProjectConfig(cfg);
  if (!check.ok) {
    return fail(1, [`Generated config failed validation: ${check.error}`]);
  }

  sys.writeText(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  sys.writeText(join(projectopsDir(target), 'phases', '.gitkeep'), '');
  sys.writeText(join(projectopsDir(target), 'reports', '.gitkeep'), '');
  sys.writeText(join(projectopsDir(target), 'README.md'), renderInstallReadme(name));

  return ok([
    `Installed .projectops into ${target}`,
    `  project:       ${id} (${name})`,
    `  repo:          ${repo}`,
    `  installStatus: installed, productionFreeze: on`,
    'Config-only — ProjectOS did not touch product code. Review + commit it in the product repo yourself.',
  ]);
}
