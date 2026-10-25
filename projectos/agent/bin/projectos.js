#!/usr/bin/env node
/**
 * ProjectOS CLI entrypoint. Thin: composes the real program and prints the result.
 * Run `npm run build` in projectos/agent first (imports ../dist).
 *
 * THIS IS THE COMPOSITION ROOT, and it composes two things the library no longer assumes for itself:
 *
 *   * the governance engines — resolved from beside this package, as they always were, but now
 *     supplied explicitly instead of each consumer reaching for the filesystem on its own;
 *   * the process root — the CLI is cwd-rooted BY DESIGN, so this is the one place where the ambient
 *     working directory is a legitimate input rather than an accident. The library takes it as a
 *     value; it never reads `process.cwd()` itself, because a packaged daemon has no meaningful cwd
 *     and must not derive a governed location from wherever it happened to be started.
 */
import { run } from '../dist/cli.js';
import { nodeSystem, setProcessRoot } from '../dist/system.js';
import { installNodeGovernanceEngines } from '../dist/nodeGovernanceEngines.js';

installNodeGovernanceEngines();
setProcessRoot(process.cwd());

const argv = process.argv.slice(2);
const ctx = { sys: nodeSystem, root: nodeSystem.cwd() };
const result = run(ctx, argv);
for (const line of result.lines) {
  console.log(line);
}
process.exit(result.code);
