#!/usr/bin/env node
/**
 * ProjectOS CLI entrypoint. Thin: wires the real nodeSystem into the pure dispatcher and
 * prints the result. Run `npm run build` in projectos/agent first (imports ../dist).
 */
import { run } from '../dist/cli.js';
import { nodeSystem } from '../dist/system.js';

const argv = process.argv.slice(2);
const ctx = { sys: nodeSystem, root: nodeSystem.cwd() };
const result = run(ctx, argv);
for (const line of result.lines) {
  console.log(line);
}
process.exit(result.code);
