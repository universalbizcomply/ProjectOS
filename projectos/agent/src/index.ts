/** ProjectOS Local Agent — public API (for tests and programmatic use). */
export * from './system.js';
// The composition seam. An entrypoint supplies the governance engines; this package never resolves
// them for itself. `nodeGovernanceEngines.js` is deliberately NOT re-exported here: it carries the
// development-tree paths, and re-exporting it would drag them into every consumer's module graph —
// including the packaged daemon bundle, which is the one place they must not appear.
export * from './governanceEngines.js';
export * from './context.js';
export * from './flags.js';
export * from './templates.js';
export * from './phaseStore.js';
export * from './approvalStore.js';
export * from './cli.js';
export { status } from './commands/status.js';
export { init } from './commands/init.js';
export { install } from './commands/install.js';
export { validate } from './commands/validate.js';
export { prompt } from './commands/prompt.js';
export { report } from './commands/report.js';
export { close } from './commands/close.js';
export { phase } from './commands/phase.js';
export { approve } from './commands/approve.js';
export { plan } from './commands/plan.js';
export { plugins } from './commands/plugins.js';
