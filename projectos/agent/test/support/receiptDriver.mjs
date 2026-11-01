/**
 * The real `tenant receipt`, with its real terminal confirmation, against a throwaway installation.
 *
 * Started inside a real console by `conpty.ps1`. It names the fixture's installation and state directory on
 * the context, so a correct confirmation can be typed without any receipt reaching the owner's real state.
 * Exactly as production, it passes no confirmation: the command asks the real terminal itself.
 *
 *   node receiptDriver.mjs <agent dist> <installRoot> <stateDir> <blob>
 */
import { pathToFileURL } from 'node:url';

const [dist, installRoot, stateDir, blob] = process.argv.slice(2);
const { tenant } = await import(pathToFileURL(`${dist}/commands/tenant.js`).href);
const { nodeSystem } = await import(pathToFileURL(`${dist}/system.js`).href);
const ctx = { sys: nodeSystem, root: installRoot, tenantInstallRoot: installRoot, platformStopStateDir: stateDir };
const result = tenant(ctx, { blob }, ['receipt']);
process.stdout.write(`${result.lines.join('\n')}\n`);
process.exitCode = result.code;
