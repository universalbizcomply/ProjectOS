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
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { installNodeGovernanceEngines } from '../src/nodeGovernanceEngines.js';
import { setProcessRoot } from '../src/system.js';

/*
 * A PRIVATE INSTALLATION STATE FOR THE WHOLE SUITE (PROJECTOS-KERNEL-PLATFORM-STOP1A, M5).
 *
 * The owner may engage the emergency stop on this machine at any time, and an engaged stop refuses
 * nearly everything — so a suite that read the real installation state would turn red for a reason that
 * has nothing to do with the code under test, and worse, a test could write the owner's real ledger.
 * LOCALAPPDATA, XDG_STATE_HOME and HOME all point at one temporary directory instead.
 *
 * THE OPERATING SYSTEM HAS TO AGREE. The stop derives its directory from `os.userInfo().homedir`, not
 * from the environment, and treats any disagreement as unverifiable — which is stopped. So the account
 * profile the stop sees is pointed at the same temporary directory here, and only here: this file is the
 * test composition root and nothing in `src/` can reach it. A test that wants an engaged stop still names
 * its own directory on the context, which takes precedence over this default.
 *
 * GIT KEEPS ITS OWN GLOBAL CONFIGURATION. Git finds `~/.gitconfig` through HOME; moving HOME would quietly
 * change how every fixture repository commits. The suite home's `.gitconfig` includes the real one.
 */
const realHome = os.userInfo().homedir;
const priorHome = process.env['HOME'];
const suiteHome = mkdtempSync(join(os.tmpdir(), 'projectos-suite-home-'));
const suiteLocal = process.platform === 'win32' ? join(suiteHome, 'AppData', 'Local') : suiteHome;
mkdirSync(suiteLocal, { recursive: true });
const realGitconfig = [priorHome, process.env['USERPROFILE'], realHome]
  .filter((h): h is string => typeof h === 'string' && h !== '')
  .map((h) => join(h, '.gitconfig'))
  .find((p) => existsSync(p));
// AN INCLUDE, NOT A COPY AND NOT GIT_CONFIG_GLOBAL: the suite home's own `.gitconfig` points at the real one,
// so git behaves as before while a test that moves HOME or USERPROFILE still controls what git reads.
if (realGitconfig !== undefined) {
  writeFileSync(join(suiteHome, '.gitconfig'), `[include]
	path = ${realGitconfig.split(String.fromCharCode(92)).join('/')}
`);
}
process.env['LOCALAPPDATA'] = suiteLocal;
process.env['XDG_STATE_HOME'] = suiteLocal;
process.env['HOME'] = suiteHome;
/*
 * THE PROFILE FOLLOWS A TEST THAT MOVES LOCALAPPDATA ON PURPOSE. Several tests point LOCALAPPDATA at their
 * own disposable `<base>/AppData/Local`; the simulated profile is then `<base>`, exactly as the operating
 * system would place it, so they keep running. Any other value — the M1 test's deliberately foreign
 * directory, for one — leaves the profile at the suite home, and the stop reads it as unverifiable.
 */
const simulatedHome = (): string => {
  const local = process.env['LOCALAPPDATA'];
  if (typeof local === 'string' && /[\\/]AppData[\\/]Local[\\/]?$/.test(local)) {
    return process.platform === 'win32' ? dirname(dirname(local)) : local;
  }
  return suiteHome;
};
const realUserInfo = os.userInfo.bind(os);
(os as { userInfo: typeof os.userInfo }).userInfo = ((options?: { encoding: BufferEncoding }) => ({
  ...realUserInfo(options),
  homedir: simulatedHome(),
})) as typeof os.userInfo;

installNodeGovernanceEngines();
setProcessRoot(process.cwd());
