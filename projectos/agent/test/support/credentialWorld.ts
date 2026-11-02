/**
 * The credential modules, over a real installation, real git and synthetic secrets.
 *
 * NOTHING HERE REACHES THE WINDOWS CREDENTIAL MANAGER. The store is the in-memory double, or a double that
 * folds case the way a Windows target name may, and every value is synthetic. The installation, the tenant
 * registry, the receipt and the record files are real files in real repositories, because that is what the
 * rules are about.
 *
 * `CRED_UNDER_TEST` points the modules at another tree. It is how the operation test is run against the
 * code before this phase, so that it fails on behaviour rather than on a missing function. Only this file
 * reads it.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitAll, makeInstallation, makeProject, AGENCY_TENANT, FIXTURE_NOW, OWNER_TENANT, type Installation } from './tenantWorld.js';
import type { System } from '../../src/system.js';

const load = createRequire(import.meta.url);

export const PROJECTOS_ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const UNDER_TEST = process.env['CRED_UNDER_TEST'] ?? PROJECTOS_ROOT;

/* eslint-disable @typescript-eslint/no-explicit-any -- these are CommonJS modules with no types. */
export const metadata: any = load(join(PROJECTOS_ROOT, 'credentials/credential-metadata.cjs'));
export const memory: any = load(join(PROJECTOS_ROOT, 'credentials/memory-credential-store.cjs'));
export const reference: any = load(join(PROJECTOS_ROOT, 'credentials/reference.cjs'));
export const vaultModule: any = load(join(PROJECTOS_ROOT, 'credentials/vault.cjs'));
export const routerModule: any = load(join(PROJECTOS_ROOT, 'session-router/router.cjs'));
export const projectRegistryModule: any = load(join(PROJECTOS_ROOT, 'session-router/project-registry.cjs'));
export const cli: any = load(join(PROJECTOS_ROOT, 'scripts/projectos-credential-router.cjs'));

/** The gate and vault the operation test judges: this tree's, or the tree `CRED_UNDER_TEST` names. */
export const underTest: { readonly gate: any; readonly vault: any } = {
  gate: load(join(UNDER_TEST, 'credentials/operation-gate.cjs')),
  vault: load(join(UNDER_TEST, 'credentials/vault.cjs')),
};

export const PHASE = 'CRED-FIXTURE1A';
export const FIXED_NOW_MS = Date.parse(FIXTURE_NOW);
export const nowMs = (): number => FIXED_NOW_MS;

export interface Project {
  readonly root: string;
  readonly repository: string;
}

export interface CredentialWorld {
  readonly installation: Installation;
  /** `alpha`, `beta` and `projectos` hold one tenant; `gamma` holds the other. */
  readonly alpha: Project;
  readonly beta: Project;
  readonly gamma: Project;
  readonly projectos: Project;
  readonly authority: any;
  readonly store: any;
  readonly vault: any;
  readonly stateDir: string;
  /** A run the console route issued, for setting a world up. Real runs come from the kernel in the tests. */
  readonly console: (projectId: string) => any;
}

export function grantPhase(project: Project, phaseId: string = PHASE): void {
  mkdirSync(join(project.root, '.projectops', 'gates'), { recursive: true });
  writeFileSync(join(project.root, '.projectops', 'gates', `${phaseId}.secrets-handling.json`), JSON.stringify({ gateName: 'secrets-handling', phaseId, ownerChoice: 'APPROVE' }));
  commitAll(project.root, 'owner record');
}

/** A real installation with its registry confirmed, as a receipt would leave it. */
export function credentialWorld(made: string[], sys: System, options: { readonly confirmed?: boolean } = {}): CredentialWorld {
  const alpha = makeProject(made, 'alpha');
  const beta = makeProject(made, 'beta');
  const gamma = makeProject(made, 'gamma');
  const projectos = makeProject(made, 'projectos');
  const installation = makeInstallation(made, [
    { projectId: 'alpha', repository: alpha.repository, governedRoot: alpha.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'beta', repository: beta.repository, governedRoot: beta.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'projectos', repository: projectos.repository, governedRoot: projectos.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'gamma', repository: gamma.repository, governedRoot: gamma.root, tenant: AGENCY_TENANT, domain: 'business' },
  ]);
  if (options.confirmed !== false) installation.confirm(sys);
  const authority = metadata.createRequesterAuthority({ installRoot: installation.root, stateDir: installation.stateDir, nowMs });
  const store = memory.createMemoryCredentialStore({ acknowledgedNonPersistent: true });
  const vault = vaultModule.createCredentialVault({ store, stateDir: join(installation.stateDir, 'vault'), nowMs });
  return {
    installation,
    alpha,
    beta,
    gamma,
    projectos,
    authority,
    store,
    vault,
    stateDir: installation.stateDir,
    console: (projectId) => authority.issueConsoleRun({ projectId }),
  };
}

/** The message a refusal carries, or `''` when nothing was refused. */
export function refusalOf(fn: () => unknown): { readonly code: string | undefined; readonly message: string } {
  try {
    fn();
    return { code: undefined, message: '' };
  } catch (e) {
    return { code: (e as { code?: string }).code, message: String((e as Error).message) };
  }
}
