/**
 * WebdriverIO configuration for the genuine Tauri desktop proof (T1-T21).
 *
 * The raw `tauri-driver` route was classified UPSTREAM TOOLING and abandoned: the app launches but
 * the WebDriver session never establishes (DevToolsActivePort), and no ProjectOS production change
 * is justified to make it pass. This is the supported route.
 *
 * `driverProvider` is read from the environment so the ONE bounded external-provider smoke and the
 * embedded fallback share a single configuration rather than diverging into two frameworks.
 * The service treats `embedded` as the default when unset; here it must be chosen explicitly so a
 * run always records which provider actually produced the proof.
 *
 * NOTHING about the application under test is faked: this drives the REAL release binary, which
 * carries the real React Control Centre, real Tauri IPC, the real sidecar, and the canonical
 * @projectos/agent -> @projectos/core runtime writing durable .projectops state.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
const APP_BINARY = './src-tauri/target/release/projectos-control-center.exe';

const driverProvider = process.env.PROJECTOS_DRIVER_PROVIDER ?? 'external';
if (driverProvider !== 'external' && driverProvider !== 'embedded') {
  throw new Error(
    `PROJECTOS_DRIVER_PROVIDER must be 'external' or 'embedded'; got '${driverProvider}'. ` +
      'The paid CrabNebula provider is not permitted for this proof.',
  );
}

export const config = {
  runner: 'local',
  specs: ['./test-desktop/e2e/**/*.spec.ts'],
  // The Control Centre enforces a single instance; a second worker would race that guard, and the
  // guard must not be weakened to suit a test.
  maxInstances: 1,

  services: [['@wdio/tauri-service', { appBinaryPath: APP_BINARY, driverProvider }]],

  // Only `browserName`. The application is named ONCE, in the service's `appBinaryPath` above.
  // Naming it again under `tauri:options.application` makes two launch requests, and the Control
  // Centre's single-instance guard correctly refuses the second — which surfaced as a session
  // attached to a blank `data:,` document instead of the real window. The guard is right; the
  // duplicate request was the defect.
  capabilities: [{ browserName: 'tauri' }],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
};
