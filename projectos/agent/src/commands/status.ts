/**
 * `projectos status` — summarise the current project: git branch/remote, the installed
 * .projectops config (validated via the core), and how many phase reports exist / await
 * review. Read-only.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { configPath, reportsDir } from '../context.js';
import { parseProjectConfig, parseRemoteUrl, isProtectedBranch } from '@projectos/core';

export function status(ctx: CommandContext): CommandResult {
  const { sys, root } = ctx;
  const lines: string[] = ['ProjectOS status'];
  let code = 0;

  const branchRes = sys.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.code === 0 ? branchRes.stdout.trim() : '(unknown)';
  const remoteRes = sys.exec('git', ['remote', 'get-url', 'origin']);
  const remote = remoteRes.code === 0 ? remoteRes.stdout.trim() : '';
  const repoRef = remote ? parseRemoteUrl(remote) : null;
  lines.push(`  branch: ${branch}`);
  lines.push(`  repo:   ${repoRef ? repoRef.slug : '(no origin)'}`);

  const cfgText = sys.readText(configPath(root));
  if (cfgText === null) {
    lines.push('  project: (no .projectops/project-config.json — run `projectos init`)');
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cfgText);
    } catch {
      lines.push('  project-config.json: INVALID JSON');
      return { code: 1, lines };
    }
    const r = parseProjectConfig(parsed);
    if (!r.ok) {
      lines.push(`  project-config: INVALID — ${r.error}`);
      code = 1;
    } else {
      const c = r.value;
      lines.push(`  project: ${c.projectName} (${c.projectId})`);
      lines.push(`  install: ${c.installStatus}`);
      lines.push(`  protected branch: ${isProtectedBranch(branch, c.protectedBranches) ? 'YES' : 'no'}`);
      lines.push(`  production freeze: ${c.productionFreeze ? 'ON' : 'off'}`);
    }
  }

  const reports = sys.listDir(reportsDir(root)).filter((f) => f.endsWith('.md'));
  const awaiting = reports.filter((f) => f.includes('AWAITING'));
  lines.push(`  reports: ${reports.length} (${awaiting.length} awaiting review/closure)`);

  return { code, lines };
}
