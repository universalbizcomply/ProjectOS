/**
 * WebdriverIO configuration for the genuine Tauri desktop proof (T1-T21).
 *
 * Route history, so nobody re-walks it: the raw `tauri-driver` route was classified UPSTREAM
 * TOOLING and abandoned, and the WDIO EXTERNAL provider reproduced the same session-creation
 * failure. The EMBEDDED provider is the supported route that remains — the WebDriver server runs
 * inside the app itself, compiled in only under the `webdriver-e2e` Cargo feature.
 *
 * The capability shape below mirrors the maintained upstream embedded reference. An earlier version
 * of this file carried only `browserName` and named the binary once at service level; that produced
 * a session attached to a blank `data:,` document with msedgedriver running, i.e. WDIO negotiating
 * an ordinary browser session instead of the app's embedded server.
 *
 * NOTHING about the application under test is faked: this drives the REAL binary, carrying the real
 * React Control Centre, real Tauri IPC, the real sidecar, and the canonical @projectos/agent ->
 * @projectos/core runtime writing durable .projectops state. The ONLY difference from an ordinary
 * build is the compiled-in WebDriver server.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */

/**
 * The E2E artifact lives in its OWN target directory, so the WebDriver-enabled executable can never
 * be mistaken for — or picked up in place of — the ordinary release artifact at
 * `target/release/projectos-control-center.exe`. The production executable contract is unchanged.
 */
const APP_BINARY = './src-tauri/target/webdriver-e2e/release/projectos-control-center.exe';

const driverProvider = process.env.PROJECTOS_DRIVER_PROVIDER ?? 'embedded';
if (driverProvider !== 'external' && driverProvider !== 'embedded') {
  throw new Error(
    `PROJECTOS_DRIVER_PROVIDER must be 'external' or 'embedded'; got '${driverProvider}'. ` +
      'The paid CrabNebula provider is not permitted for this proof.',
  );
}

export const config = {
  runner: 'local',
  specs: ['./test-desktop/e2e/**/*.spec.ts'],
  // The Control Centre enforces a real single-instance authority guard; a second worker would race
  // it, and the guard must not be weakened to suit a test.
  maxInstances: 1,

  services: [['@wdio/tauri-service', { appBinaryPath: APP_BINARY, driverProvider }]],

  capabilities: [
    {
      browserName: 'tauri',
      // Force WebDriver Classic. The embedded server speaks Classic; leaving BiDi negotiation on is
      // part of how a session ends up on an ordinary browser driver instead.
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': { application: APP_BINARY },
      'wdio:tauriServiceOptions': { appBinaryPath: APP_BINARY, driverProvider },
    },
  ],

  logLevel: process.env.PROJECTOS_WDIO_LOGLEVEL ?? 'info',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
};
