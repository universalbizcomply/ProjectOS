/**
 * A real installation and real governed projects, on disk, in real git repositories.
 *
 * The tenant rules are about what git says and what is committed, so a fake `exec` here would prove the
 * fake. Each world has its own installation repository holding a committed tenant registry written from
 * the shape of the real one, the real committed action registry bytes, and a throwaway state directory.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBoundGit, type System } from '../../src/system.js';
import { writeTenantReceipt } from '../../src/installation/tenantRegistry.js';

const GIT = resolveBoundGit(process.env) as string;
const REAL_SECURITY = new URL('../../../security/', import.meta.url);

export const OWNER_TENANT = 'owner-personal';
export const AGENCY_TENANT = 'agency-business';
export const FIXTURE_NOW = '2026-11-01T12:00:00.000Z';

export interface RegistryLine {
  readonly projectId: string;
  readonly repository: string;
  readonly governedRoot: string;
  readonly tenant: string;
  readonly domain: string;
}

export function forward(path: string): string {
  return path.split(String.fromCharCode(92)).join('/');
}

/** A fresh directory by its real, long, forward-slash path. */
export function tempDir(made: string[], prefix: string): string {
  const dir = forward(realpathSync.native(mkdtempSync(join(tmpdir(), prefix))));
  made.push(dir);
  return dir;
}

export function cleanUp(made: string[]): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** Every commit here carries the owner's name, as every commit on the real machine does. */
export function commitAll(root: string, message: string): void {
  git(root, 'add', '--all');
  git(root, '-c', 'user.name=Murad', '-c', 'user.email=owner@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', message);
}

/** The real registry's header, with the world's own project lines. */
export function registryText(lines: readonly RegistryLine[], over: Readonly<Record<string, unknown>> = {}): string {
  const real = JSON.parse(readFileSync(new URL('tenant-registry.json', REAL_SECURITY), 'utf8')) as Record<string, unknown>;
  return `${JSON.stringify({ ...real, projects: lines.map((line) => ({ ...line, note: 'fixture' })), ...over }, null, 2)}\n`;
}

export function projectConfig(projectId: string, root: string, extra: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    projectId,
    projectName: projectId,
    projectType: 'delivery-os',
    owner: 'Murad',
    repo: `fixture/${projectId}`,
    localPath: root,
    environments: {},
    installStatus: 'installed',
    protectedBranches: ['main'],
    productionFreeze: false,
    allowedActions: ['inspect-repository'],
    forbiddenActions: ['production-deploy'],
    approvalGates: ['phase-closure'],
    validators: ['validate-project-config'],
    evidenceRequirements: ['phase-report'],
    secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
    ...extra,
  });
}

/** A project repository with a committed config and an origin, at a real path. */
export function makeProject(made: string[], projectId: string, config: Readonly<Record<string, unknown>> = {}): { readonly root: string; readonly repository: string } {
  const root = tempDir(made, `projectos-tenant-${projectId}-`);
  const repository = `github.com/fixture/${projectId}`;
  git(root, 'init', '--quiet');
  git(root, 'remote', 'add', 'origin', `https://${repository}.git`);
  mkdirSync(join(root, '.projectops'), { recursive: true });
  writeFileSync(join(root, '.projectops', 'project-config.json'), projectConfig(projectId, root, config));
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  commitAll(root, 'fixture');
  return { root, repository };
}

/**
 * A project a real `projectos run --dry-run` can walk: a committed config, a READY plan and a current
 * state. The plan is the repository's own PLAN READY record with only what must differ overridden, as
 * `continuationEndToEnd.test.ts` does, so this fixture does not encode the readiness rules a second time.
 */
export function makeGovernedProject(made: string[], projectId: string): { readonly root: string; readonly repository: string } {
  const planRel = 'state/plan.json';
  const { root, repository } = makeProject(made, projectId, {
    schemaVersion: '1.0.0',
    planMemory: { planPath: planRel, currentStatePath: 'state/current.json' },
    planSources: [planRel],
    allowedActions: ['inspect-repository', 'create-local-files', 'run-local-validation'],
    execution: { workers: [{ workerId: 'claude', kind: 'claude-code-cli', command: 'C:/fixture/claude.exe' }, { workerId: 'reviewer', kind: 'claude-code-cli', command: 'C:/fixture/claude.exe' }], reviewerWorkerId: 'reviewer' },
  });
  const real = JSON.parse(readFileSync(new URL('../../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const phases = real['phases'] as Record<string, unknown>[];
  const governance: Record<string, unknown> = { ...(real['governance'] as Record<string, unknown>), owner: 'Murad' };
  delete governance['closureDelegation'];
  const plan = {
    ...real,
    projectId,
    projectName: projectId,
    programmeId: `${projectId}-programme`,
    planId: `plan-${projectId}`,
    repository: { ...(real['repository'] as Record<string, unknown>), repositoryPath: root, expectedRemote: repository, protectedBranches: ['main'] },
    governance,
    phases: [{ ...phases[0], phaseId: 'TENANT-FIXTURE1A', description: 'a phase in a fixture', scope: '', dependsOn: [], requiredBrowserProof: false }],
  };
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, planRel), JSON.stringify(plan, null, 2));
  writeFileSync(join(root, 'state', 'current.json'), JSON.stringify({ completedPhases: [], activePhase: 'TENANT-FIXTURE1A' }, null, 2));
  commitAll(root, 'governed fixture');
  return { root, repository };
}

export interface Installation {
  readonly root: string;
  readonly stateDir: string;
  readonly repository: string;
  /** What a command's context carries so that it reads this installation. */
  readonly ctxFields: { readonly tenantInstallRoot: string; readonly platformStopStateDir: string };
  /** The registry blob at HEAD. */
  readonly blob: () => string;
  /** Commit a registry whose lines are this installation's own plus these. */
  readonly commitLines: (lines: readonly RegistryLine[], over?: Readonly<Record<string, unknown>>) => void;
  /** Write the raw bytes and commit them. */
  readonly commitRegistryText: (text: string) => void;
  /** Write the receipt a person would have made for the blob at HEAD. A fixture, for the tests that need one. */
  readonly confirm: (sys: System) => void;
}

export function makeInstallation(made: string[], lines: readonly RegistryLine[]): Installation {
  const { root, repository } = makeProject(made, 'installation');
  const stateDir = tempDir(made, 'projectos-tenant-state-');
  const self: RegistryLine = { projectId: 'installation', repository, governedRoot: root, tenant: OWNER_TENANT, domain: 'develop' };
  const registryPath = join(root, 'projectos', 'security', 'tenant-registry.json');
  mkdirSync(join(root, 'projectos', 'security'), { recursive: true });
  writeFileSync(join(root, 'projectos', 'security', 'action-registry.json'), readFileSync(new URL('action-registry.json', REAL_SECURITY)));
  const commitRegistryText = (text: string): void => {
    writeFileSync(registryPath, text);
    commitAll(root, 'tenant registry');
  };
  const commitLines = (next: readonly RegistryLine[], over: Readonly<Record<string, unknown>> = {}): void => commitRegistryText(registryText([self, ...next], over));
  commitLines(lines);
  const blob = (): string => git(root, 'rev-parse', 'HEAD:projectos/security/tenant-registry.json').trim();
  return {
    root,
    stateDir,
    repository,
    ctxFields: { tenantInstallRoot: root, platformStopStateDir: stateDir },
    blob,
    commitLines,
    commitRegistryText,
    confirm: (sys) => {
      if (!writeTenantReceipt(sys, stateDir, blob(), FIXTURE_NOW)) throw new Error('the fixture receipt was not written');
    },
  };
}

/** Plant the record's lock, as a process that died holding it would leave it. */
export function holdRecordLock(stateDir: string, filename: string): void {
  writeFileSync(join(stateDir, `${filename}.lock`), '{}\n');
}

export function linesOf(stateDir: string, filename: string): readonly Record<string, unknown>[] {
  let text: string;
  try {
    text = readFileSync(join(stateDir, filename), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
