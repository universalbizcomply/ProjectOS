/**
 * Test composition root.
 *
 * The library no longer resolves the governance engines or the process root for itself — an
 * entrypoint composes them (see `src/governanceEngines.ts` for why). The CLI does it in
 * `bin/projectos.js`; the packaged daemon does it in `sidecar/host.mjs`; tests do it here, once,
 * before any test file runs.
 *
 * This uses the SAME development composition the CLI uses, so the tests exercise the real engines
 * from `projectos/validators/` rather than a stand-in. Nothing about governance behaviour is mocked
 * by this file — only the wiring that an entrypoint would otherwise have done.
 *
 * Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (packaged daemon dependency closure).
 */
import { installNodeGovernanceEngines } from '../src/nodeGovernanceEngines.js';
import { setProcessRoot } from '../src/system.js';

installNodeGovernanceEngines();
setProcessRoot(process.cwd());
