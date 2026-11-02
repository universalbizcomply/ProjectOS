/**
 * A real process that admits a real run and exits. `tenantCredentialsReview.test.ts` spawns this with
 * vite-node, because the exit hook can only be proved by a process exiting. TEST ONLY.
 */
import { admittedRunEnvelopeOf, runStartTenantRefusal } from '../../src/governedContext.js';
import type { CommandContext } from '../../src/context.js';
import { nodeSystem } from '../../src/system.js';

const [root, installRoot, stateDir, exitCode] = process.argv.slice(2);
const ctx = { sys: nodeSystem, root, tenantInstallRoot: installRoot, platformStopStateDir: stateDir } as unknown as CommandContext;
const refused = runStartTenantRefusal(ctx, true);
if (refused !== null) {
  process.stderr.write(refused.join('\n'));
  process.exit(99);
}
process.stdout.write(`HANDLE ${String(admittedRunEnvelopeOf(ctx)?.envelopeId)}\n`);
process.exit(Number(exitCode));
