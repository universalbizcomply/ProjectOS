/**
 * Which projects an installation will spend its credential on, proven against real repositories.
 *
 * TWO REAL CHECKOUTS. The installation and the governed project are separate git repositories here,
 * because the whole point of the policy is that one of them cannot write the other's answer. The
 * "external project" in these tests does exactly what the finding described: it writes itself an
 * APPROVE receipt and a gatekeeper config, and it is still refused — by the installation, not by
 * anything it controls.
 *
 * Created under the gatekeeper ruling of 2026-08-20 (HIGH-1, credential scope).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import {
  installationAllowsProject,
  canonicalRepositoryIdentity,
  INSTALLATION_ALLOWLIST_REL,
} from '../src/installation/projectAllowlist.js';

const PROJECT = 'projectos';
const REPO = 'github.com/universalbizcomply/ProjectOS';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function nodeLikeSystem(): System {
  return {
    now: () => '2026-08-20T21:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    renameFile: () => true,
    exec: (command: string, args: readonly string[]) => {
      try {
        return { code: 0, stdout: execFileSync(command, [...args], { encoding: 'utf8' }), stderr: '' };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  } as unknown as System;
}

function repo(originUrl: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'projectos-alw-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  if (originUrl !== null) git('remote', 'add', 'origin', originUrl);
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'baseline');
  return root;
}

/** An installation whose allowlist is written, and optionally committed. */
function installation(entries: unknown, opts: { commit?: boolean } = {}): string {
  const root = repo('https://github.com/universalbizcomply/ProjectOS.git');
  const abs = join(root, ...INSTALLATION_ALLOWLIST_REL.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(
    abs,
    `${JSON.stringify({ schemaVersion: '1.0.0', policy: 'installation-project-allowlist', projects: entries }, null, 2)}\n`,
  );
  if (opts.commit !== false) {
    execFileSync('git', ['-C', root, 'add', '--', INSTALLATION_ALLOWLIST_REL], { encoding: 'utf8' });
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'policy: installation allowlist'], { encoding: 'utf8' });
  }
  return root;
}

const runtimeAt = (installRoot: string) => ({
  installRoot,
  adapterRelPath: 'projectos/credentials/windows-credential-store.ps1',
});

describe('the canonical identity of a checkout', () => {
  it('is host/owner/name from origin, by the rule the rest of the system uses', () => {
    const sys = nodeLikeSystem();
    expect(canonicalRepositoryIdentity(sys, repo('https://github.com/universalbizcomply/ProjectOS.git'))).toBe(REPO);
    expect(canonicalRepositoryIdentity(sys, repo('git@github.com:universalbizcomply/ProjectOS.git'))).toBe(REPO);
  });

  it('is null when there is no origin to derive it from', () => {
    expect(canonicalRepositoryIdentity(nodeLikeSystem(), repo(null))).toBeNull();
  });
});

describe('an installation spends its credential only on projects it named', () => {
  it('allows the project it committed, at the repository it named', () => {
    const install = installation([{ projectId: PROJECT, repository: REPO }]);
    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), install, PROJECT);
    expect(d.allowed).toBe(true);
    expect(d.repository).toBe(REPO);
  });

  it('refuses when the installation commits no allowlist at all', () => {
    const install = repo('https://github.com/universalbizcomply/ProjectOS.git');
    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), install, PROJECT);
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(' ')).toContain('commits no credential allowlist');
  });

  it('gives an UNCOMMITTED allowlist zero authority', () => {
    const install = installation([{ projectId: PROJECT, repository: REPO }], { commit: false });
    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), install, PROJECT);
    expect(d.allowed).toBe(false);
  });

  it('gives a committed allowlist that was then edited zero authority', () => {
    const install = installation([{ projectId: PROJECT, repository: REPO }]);
    const abs = join(install, ...INSTALLATION_ALLOWLIST_REL.split('/'));
    const widened = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    (widened['projects'] as unknown[]).push({ projectId: 'someone-elses-project', repository: 'github.com/x/y' });
    writeFileSync(abs, JSON.stringify(widened, null, 2));

    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), install, 'someone-elses-project');
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(' ')).toContain('changed in the working tree');
  });

  it('refuses an external project that wrote itself every approval it can write', () => {
    const install = installation([{ projectId: PROJECT, repository: REPO }]);
    const external = repo('https://github.com/someone/else.git');
    // The external project commits its own gatekeeper config and its own APPROVE receipt. Both are
    // real, both are committed, and neither is the installation's decision.
    mkdirSync(join(external, '.projectops', 'gates'), { recursive: true });
    writeFileSync(
      join(external, '.projectops', 'gatekeeper.json'),
      JSON.stringify({ transport: { credentialRef: 'OPENAI_GATEKEEPER_KEY' } }),
    );
    writeFileSync(
      join(external, '.projectops', 'gates', 'X1A.secrets-handling.json'),
      JSON.stringify({ gateName: 'secrets-handling', phaseId: 'X1A', ownerChoice: 'APPROVE' }),
    );
    execFileSync('git', ['-C', external, 'add', '-A'], { encoding: 'utf8' });
    execFileSync('git', ['-C', external, 'commit', '-q', '-m', 'self-approval'], { encoding: 'utf8' });

    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), external, 'someone-elses-project');
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(' ')).toContain('does not authorise');
  });

  it('refuses the right project id at the wrong repository', () => {
    const install = installation([{ projectId: PROJECT, repository: REPO }]);
    const impostor = repo('https://github.com/someone/ProjectOS.git');
    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), impostor, PROJECT);
    expect(d.allowed).toBe(false);
    expect(d.repository).toBe('github.com/someone/ProjectOS');
  });

  it('refuses a checkout with no origin, rather than matching on the project id alone', () => {
    const install = installation([{ projectId: PROJECT, repository: REPO }]);
    const anonymous = repo(null);
    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), anonymous, PROJECT);
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(' ')).toContain('no readable `origin` remote');
  });

  it.each([
    ['a wildcard project', [{ projectId: '*', repository: REPO }]],
    ['a wildcard repository', [{ projectId: PROJECT, repository: '*' }]],
    ['a partial wildcard', [{ projectId: PROJECT, repository: 'github.com/universalbizcomply/*' }]],
  ])('refuses %s even when it would otherwise match', (_label, entries) => {
    const install = installation(entries);
    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), install, PROJECT);
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(' ')).toContain('wildcard');
  });

  it('asks the INSTALLATION about the policy, not the governed project', () => {
    // The governed project commits an allowlist naming itself. It is not the installation's.
    const install = installation([{ projectId: PROJECT, repository: REPO }]);
    const external = repo('https://github.com/someone/else.git');
    const abs = join(external, ...INSTALLATION_ALLOWLIST_REL.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(
      abs,
      JSON.stringify({
        schemaVersion: '1.0.0',
        projects: [{ projectId: 'someone-elses-project', repository: 'github.com/someone/else' }],
      }),
    );
    execFileSync('git', ['-C', external, 'add', '-A'], { encoding: 'utf8' });
    execFileSync('git', ['-C', external, 'commit', '-q', '-m', 'self-allowlist'], { encoding: 'utf8' });

    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), external, 'someone-elses-project');
    expect(d.allowed).toBe(false);
  });

  it('refuses a policy whose schema it does not recognise', () => {
    const install = repo('https://github.com/universalbizcomply/ProjectOS.git');
    const abs = join(install, ...INSTALLATION_ALLOWLIST_REL.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, JSON.stringify({ schemaVersion: '9.9.9', projects: [{ projectId: PROJECT, repository: REPO }] }));
    execFileSync('git', ['-C', install, 'add', '-A'], { encoding: 'utf8' });
    execFileSync('git', ['-C', install, 'commit', '-q', '-m', 'policy'], { encoding: 'utf8' });

    const d = installationAllowsProject(nodeLikeSystem(), runtimeAt(install), install, PROJECT);
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(' ')).toContain('schemaVersion');
  });
});
