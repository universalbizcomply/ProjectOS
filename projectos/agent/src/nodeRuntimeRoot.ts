/**
 * Where the TRUSTED ProjectOS installation is — as distinct from the project being governed.
 *
 * TWO ROOTS, AND CONFLATING THEM WAS A DEFECT. `processRoot` is the governed project: whichever
 * checkout the operator pointed the CLI at, and content that is untrusted until the owner reviews it.
 * This is the other one: the installation whose code is currently running. The credential adapter
 * belongs to the second, and resolving it from the first meant two things at once — an external
 * project could never reach the adapter at all (found live: a governed witness refused with "the
 * Windows Credential Manager could not be reached"), and any project that DID carry a file at that
 * path would have had it executed as the credential process.
 *
 * DISCOVERED FROM `import.meta.url`, WHICH IS NOT THE AMBIENT-CWD MISTAKE. This is the running code
 * asking where it itself lives, exactly as `nodeGovernanceEngines` resolves the engines that govern a
 * project from beside this package rather than from inside the project. A governed repository cannot
 * move this file, so it cannot move the answer.
 *
 * IN ITS OWN MODULE, deliberately: the packaged daemon composes its runtime differently and must not
 * inherit a development checkout's layout. A composition that cannot answer this question refuses,
 * rather than falling back to the governed root.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A under the delegated continuation of 2026-08-20.
 */
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo-relative path of the credential adapter WITHIN the ProjectOS installation. */
export const CREDENTIAL_ADAPTER_REL = 'projectos/credentials/windows-credential-store.ps1';

/** What a credential resolver needs to know about the installation it may trust. */
export interface ProjectosRuntime {
  /** Absolute path of the ProjectOS installation root — the repository this code was installed from. */
  readonly installRoot: string;
  /** The adapter's path relative to `installRoot`, so committed-bytes checks can name it to git. */
  readonly adapterRelPath: string;
}

/**
 * Where this installation keeps state the governed project must not be able to erase.
 *
 * OUTSIDE EVERY REPOSITORY, ON PURPOSE. Degraded-mode consumption used to live only inside the
 * governed project, where `rm` made a spent grant look unused. This is the operator's own
 * application-data directory: a bounded worker writes inside its project, and this is not inside any
 * project. `null` when the platform gives no such location — callers refuse rather than guess, since
 * a state directory chosen by falling back to the current directory would be the defect again.
 */
export function nodeInstallationStateDir(env: NodeJS.ProcessEnv = process.env): string | null {
  // NO ENVIRONMENT OVERRIDE. There was one, justified as the packaged host's way of naming its own
  // state location — and nothing in the tree ever set it, while anything that could set an environment
  // variable could point the sole authority at an empty directory. An empty ledger reads as "nothing
  // was ever spent", which refunds every grant and clears every debt in one move. A control that one
  // variable disables is not a control, and the host will get a location it derives rather than one it
  // is told.
  const base = env['LOCALAPPDATA'] ?? env['XDG_STATE_HOME'] ?? env['HOME'];
  if (typeof base !== 'string' || base.trim() === '' || !isAbsolute(base)) return null;
  return resolve(base, 'ProjectOS', 'installation-state').split(String.fromCharCode(92)).join('/');
}

/**
 * This installation, resolved from this module's own location.
 *
 * `dist/nodeRuntimeRoot.js` sits at `<install>/projectos/agent/dist/`, so the install root is three
 * levels up — the same arithmetic `nodeGovernanceEngines` uses to reach `projectos/validators`.
 */
export function nodeProjectosRuntime(): ProjectosRuntime {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    installRoot: resolve(here, '..', '..', '..').replace(/\\/g, '/'),
    adapterRelPath: CREDENTIAL_ADAPTER_REL,
  };
}
