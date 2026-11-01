/**
 * Loaded by `node --import` into a REAL `control-center/sidecar/host.mjs` under test. It changes where the
 * process looks, and nothing about what it does.
 *
 * THE PROFILE. The installation state directory is what the operating system says it is, which is the
 * point of it, so a child under test would otherwise read and write the owner's real state. The account
 * profile is moved to a throwaway directory, as `test/setup.ts` does for the suite.
 *
 * THE AGENT. `@projectos/agent` resolves through `node_modules`, which in a phase worktree is a junction to
 * another checkout. This points it at the build of the code under test.
 */
import os from 'node:os';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const profile = process.env['PROJECTOS_TEST_PROFILE'];
const agentEntry = process.env['PROJECTOS_TEST_AGENT_ENTRY'];
if (!profile || !agentEntry) throw new Error('sidecarPreload needs its two variables');

const realUserInfo = os.userInfo.bind(os);
os.userInfo = (options) => ({ ...realUserInfo(options), homedir: profile });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@projectos/agent') return { url: pathToFileURL(agentEntry).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
