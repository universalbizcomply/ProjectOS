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
import { commitAll, git, makeInstallation, makeProject, AGENCY_TENANT, FIXTURE_NOW, OWNER_TENANT, type Installation } from './tenantWorld.js';
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

/** Where a credential-release grant lives in an installation. */
export const GRANT_REL = (phaseId: string): string => `projectos/security/credential-grants/${phaseId}.credential-release.json`;

/** The command a synthetic grant covers unless it says otherwise: what the gate tests run. */
export const GRANTED_COMMAND: readonly string[] = [process.execPath, '--version'];

/**
 * A synthetic `credential-release` grant, committed in this world's own installation and given no receipt.
 * A field set to `undefined` is left out. Creating a real one is an owner act, and nothing here can reach a
 * real installation. Returns the grant's blob.
 */
export function commitGrant(w: CredentialWorld, over: Readonly<Record<string, unknown>>, phaseId: string = PHASE): string {
  const record = {
    schemaVersion: '1.0.0',
    kind: 'credential-release-grant',
    phaseId,
    projectId: 'alpha',
    references: ['ProjectOS/alpha/staging/supabase/service-role-key'],
    action: 'read-config',
    command: GRANTED_COMMAND,
    expiresAt: '2027-01-01T00:00:00.000Z',
    grantedBy: 'Synthetic',
    ...over,
  };
  const path = join(w.installation.root, ...GRANT_REL(phaseId).split('/'));
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(record));
  commitAll(w.installation.root, 'synthetic grant');
  return git(w.installation.root, 'hash-object', path).trim();
}

/** The confirmation a person would type, through the real authority. */
export function confirmGrant(w: CredentialWorld, blob: string): void {
  w.authority.confirmGrant({ blob, typed: blob.slice(0, 12) });
}

/** A receipt and its line, written directly, as any process of this user can (ADR-T1 section 10). */
export function forgeReceipt(w: CredentialWorld, blob: string): void {
  const envelopeId = `ENV-${blob.slice(0, 24)}`;
  mkdirSync(join(w.stateDir, 'credential-grant-receipts'), { recursive: true });
  writeFileSync(join(w.stateDir, 'credential-grant-receipts', `${blob}.json`), JSON.stringify({ kind: 'credential-grant-receipt', grantBlob: blob, confirmation: 'typed-terminal', envelopeId }));
  writeFileSync(join(w.stateDir, 'credential-grant-changes.jsonl'), `${JSON.stringify({ stage: 'admission', outcome: 'allowed', envelope: { envelopeId, action: 'credential-release', subjectHash: blob } })}\n`);
}

/** A grant, committed and confirmed: what a release needs. */
export function grantRelease(w: CredentialWorld, over: Readonly<Record<string, unknown>>, phaseId: string = PHASE): void {
  confirmGrant(w, commitGrant(w, over, phaseId));
}

/** A real installation with its registry confirmed, as a receipt would leave it. */
export function credentialWorld(made: string[], sys: System, options: { readonly confirmed?: boolean } = {}): CredentialWorld {
  const alpha = makeProject(made, 'alpha');
  const beta = makeProject(made, 'beta');
  const gamma = makeProject(made, 'gamma');
  const installation = makeInstallation(made, [
    { projectId: 'alpha', repository: alpha.repository, governedRoot: alpha.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'beta', repository: beta.repository, governedRoot: beta.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'gamma', repository: gamma.repository, governedRoot: gamma.root, tenant: AGENCY_TENANT, domain: 'business' },
  ], 'projectos');
  if (options.confirmed !== false) installation.confirm(sys);
  const authority = metadata.createRequesterAuthority({ installRoot: installation.root, stateDir: installation.stateDir, nowMs });
  const store = memory.createMemoryCredentialStore({ acknowledgedNonPersistent: true });
  const vault = vaultModule.createCredentialVault({ store, stateDir: join(installation.stateDir, 'vault'), nowMs });
  return {
    installation,
    alpha,
    beta,
    gamma,
    // THE INSTALLATION IS `projectos`, as on the real machine: the registry's line for it is its own root.
    projectos: { root: installation.root, repository: installation.repository },
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
