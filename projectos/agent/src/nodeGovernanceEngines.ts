/**
 * Compose the governance engines by resolving them from THIS package's own location.
 *
 * This is the DEVELOPMENT and CLI composition: the ProjectOS checkout is present, the canonical
 * engines live beside this package in it, and resolving them from `import.meta.url` is exactly the
 * right thing — it keeps a governed project from substituting the code that governs it.
 *
 * IT IS DELIBERATELY IN ITS OWN MODULE. The packaged daemon does not import this file, so the
 * `../../validators/…` paths below never enter the packaged bundle and the packaged artefact carries
 * no reference to a development checkout at all. That separation is the whole point: the two
 * compositions differ, the program does not. There is one daemon, one CLI and one set of engines —
 * only the route by which the engines arrive changes with the runtime context.
 *
 * Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (packaged daemon dependency closure).
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  setGovernanceEngines,
  type DiscoveryEngineModule,
  type GovernanceEngineModule,
} from './governanceEngines.js';

/**
 * Resolve the canonical engines and schemas from beside this package, and register them.
 *
 * Safe to call more than once: the registry accepts a repeat of the same unit, and this builds a
 * fresh object each time, so callers should call it once. `installOnce` below is the ergonomic form.
 */
export function installNodeGovernanceEngines(): void {
  const require_ = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const load = (relative: string): unknown => require_(resolve(here, relative)) as unknown;

  setGovernanceEngines({
    governance: load('../../validators/plan-governance-engine.cjs') as GovernanceEngineModule,
    discovery: load('../../validators/plan-discovery-engine.cjs') as DiscoveryEngineModule,
    planSchema: load('../../schemas/project-plan.schema.json'),
    currentStateSchema: load('../../schemas/current-project-state.schema.json'),
  });
}

let installed = false;

/** Install exactly once per process. Convenient for tests, which import many modules. */
export function installNodeGovernanceEnginesOnce(): void {
  if (installed) return;
  installNodeGovernanceEngines();
  installed = true;
}
