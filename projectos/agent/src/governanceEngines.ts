/**
 * THE seam through which the governance engines and schemas reach this package.
 *
 * WHY THIS EXISTS. Every consumer used to resolve the engines for itself:
 *
 *     const require_ = createRequire(import.meta.url);
 *     require_(resolve(dirname(fileURLToPath(import.meta.url)), '../../validators/…'));
 *
 * The intent was sound — resolve from THIS package's own location so a governed project cannot
 * substitute the code that governs it — and that intent is preserved. What it could not survive is
 * PACKAGING. `../../validators` from the packaged daemon's own location points outside the packaged
 * payload, back into a ProjectOS development checkout that an installation does not have. The
 * dependency-closure gate reports exactly that, and it is right to.
 *
 * A computed `require_(resolve(here, …))` is also invisible to a bundler: the path is data, not a
 * specifier, so nothing can inline it. Making the dependency EXPLICIT fixes both problems at once —
 * a bundler can see a static import, and a packaged entrypoint can supply the engines it shipped.
 *
 * WHAT THIS IS NOT. It is not a plugin system and not a runtime package loader. There is one
 * registry, set once by whichever entrypoint composes the program, and read by this package. There
 * is no search path, no fallback and no default: an unset registry REFUSES rather than quietly
 * resolving something from wherever it happens to be running.
 *
 * WHO SETS IT:
 *   * the packaged daemon — `control-center/sidecar/host.mjs`, from artefacts bundled INTO it;
 *   * the CLI and the tests — `installNodeGovernanceEngines()` in `nodeGovernanceEngines.ts`, which
 *     is deliberately in a separate module so the packaged bundle never imports it, and therefore
 *     never carries a development-tree path at all.
 *
 * Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (packaged daemon dependency closure).
 */

/** The canonical governance engine (`validators/plan-governance-engine.cjs`). */
export interface GovernanceEngineModule {
  validateAgainstSchema(obj: unknown, schema: unknown): readonly string[];
  evaluatePlanReady(plan: unknown): { readonly ready: boolean; readonly reasons: readonly string[] };
  isSafeRepoRelativePath(p: unknown): boolean;
  isImplementerIdentity(name: unknown): boolean;
}

/** The canonical discovery engine (`validators/plan-discovery-engine.cjs`). */
export type DiscoveryEngineModule = Record<string, unknown>;

/** Everything this package needs from outside itself, supplied as ONE explicit unit. */
export interface GovernanceEngines {
  readonly governance: GovernanceEngineModule;
  readonly discovery: DiscoveryEngineModule;
  readonly planSchema: unknown;
  readonly currentStateSchema: unknown;
}

let registered: GovernanceEngines | null = null;

/**
 * Supply the engines. Called once by the entrypoint that composes the program.
 *
 * Idempotent for the same object so a re-imported entrypoint is harmless; a DIFFERENT set is
 * refused, because silently swapping the code that governs a project is precisely the substitution
 * the resolve-from-own-location rule existed to prevent.
 */
export function setGovernanceEngines(engines: GovernanceEngines): void {
  if (registered !== null && registered !== engines) {
    throw new Error(
      'GOVERNANCE_ENGINES_ALREADY_SET: the governance engines are composed once, by the entrypoint. ' +
        'Replacing them would substitute the code that governs a project.',
    );
  }
  registered = engines;
}

/** TEST-ONLY. Clear the registry so a test can prove the refusal path. */
export function resetGovernanceEnginesForTest(): void {
  registered = null;
}

/** Whether the engines have been composed yet. */
export function governanceEnginesInstalled(): boolean {
  return registered !== null;
}

/**
 * Read the engines, refusing when nothing composed them.
 *
 * REFUSES rather than resolves. A fallback that reached for the filesystem here would reintroduce
 * the exact dependency this seam removes — and it would do so on the one path nobody tests, because
 * every entrypoint sets the registry.
 */
export function governanceEngines(): GovernanceEngines {
  if (registered === null) {
    throw new Error(
      'GOVERNANCE_ENGINES_NOT_INSTALLED: the entrypoint must call setGovernanceEngines() (packaged ' +
        'daemon) or installNodeGovernanceEngines() (CLI/tests) before governed operations run.',
    );
  }
  return registered;
}
