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

/**
 * Render an untrusted value as one line of DISPLAY text.
 *
 * Control characters are removed, not escaped: a value carrying a newline could otherwise forge
 * extra lines in this block and make an instruction appear to say something it does not. Nothing
 * here is quoting for a shell, because nothing here is handed to one.
 */
function printable(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) out += value[i];
  }
  return out;
}

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
    '',
    // REGISTRATION IS A SEPARATE, OUT-OF-BAND ADMINISTRATOR ACTION.
    //
    // This command runs as you, unelevated, and cannot register anything: the installed ProjectOS
    // keeps its project list in protected machine configuration that ordinary users may read and not
    // write. So this prints the next step rather than performing it, and the desktop app has no
    // "Add project" button for the same reason.
    //
    // THE VALUES ARE PRINTED AS FIELDS, NEVER SPLICED INTO A COMMAND LINE. This text is meant to be
    // read beside an ADMINISTRATOR terminal, and `--id` / `--target` are whatever the caller typed.
    // A path is allowed to contain `$`, `(`, `)` and a backtick, so a directory named
    // `C:\proj\$(...)` pasted inside a quoted argument would be evaluated by PowerShell before the
    // registration command ever ran — an injection into an elevated shell, contributed by us. There
    // is no command line here to inject into.
    //
    // The digest is deliberately NOT computed here either. It is a digest of the canonical registry
    // bytes, and a second implementation of that encoding in this file could drift from the one that
    // actually writes them — so the registration command computes and shows it instead.
    'To let the installed ProjectOS govern this project, an administrator registers it once.',
    'In an Administrator terminal, run `projectos-register-project plan` with these values:',
    `  id             ${printable(id)}`,
    `  root           ${printable(target)}`,
    '  environments   development',
    '  frozen         true',
    'It writes nothing. It prints the full proposal — including the registry digest and where it',
    'would be written — and then the exact publish command to run.',
  ]);
}
